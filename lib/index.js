// dsh-local-computer —— host side (cordis plugin).
//
// Why a localhost HTTP endpoint instead of the Typert Remote path:
//   @deepseek-ai/dsh-typert-protocol turns @Remote methods into wire endpoints through its
//   TypeScript generation pipeline, so a hand-written JS plugin cannot publish one without
//   adopting that build chain. The slot API (ctx.slots) IS available at runtime to any client
//   bundle, which is what the "世界" entry and the full-view page need. So the UI reads its state
//   over a loopback endpoint guarded by a per-run token, and the agent-facing capability stays on
//   MCP stdio (mcp/server.mjs). Both sides share state/computer.json.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
import { planWrites, diffPlan, applyPlan } from '../core/obsidian.mjs';
import { TOOLS as COMPUTER_TOOLS, call as computerCall } from '../mcp/server.mjs';
import {
  loadBrain, saveBrain, emptyBrain, add as noteAdd, recall, findConflicts,
  retire, integrate, ledgerFor, ACTIONS, stripNotes, notesBlock,
} from '../core/brain.mjs';

const STATE_DIR = process.env.DSH_LOCAL_COMPUTER_STATE || path.join(ROOT, 'state');
const STATE_FILE = path.join(STATE_DIR, 'computer.json');
const ENDPOINT_FILE = path.join(STATE_DIR, 'ui-endpoint.json');
// The renderer has no channel to learn an ephemeral port, so bind a well-known loopback port first
// and only fall back to a random one if something else already owns it.
// A small range, not one port: if something else owns the first one the host moves to the next
// and the renderer probes the same list, so a single busy port can never orphan the page.
const PORT_BASE = Number(process.env.DSH_LOCAL_COMPUTER_PORT || 47831);
const PORT_RANGE = [0, 1, 2, 3, 4].map(i => PORT_BASE + i);
// where the client half reports that it mounted, so "is the page live?" is answerable from disk
const CLIENT_STATUS_FILE = path.join(STATE_DIR, 'client-status.json');
// The same confinement the MCP tools use, split by direction: the agent may read its own plugin
// directory (so the page can browse it) but only the sandbox is writable. The state dir is the
// ledger — tickets, permissions, audit — so it is never readable through here, except the sandbox
// work area that lives inside it by default.
const SANDBOX = process.env.DSH_LOCAL_COMPUTER_SANDBOX || path.join(STATE_DIR, 'sandbox');
const READ_ROOTS = [path.resolve(SANDBOX), path.resolve(ROOT)];
const WRITE_ROOTS = [path.resolve(SANDBOX)];
// realpath both the target and the roots, so a symlink or a ".." can not step outside. A target
// that does not exist yet resolves through its parent, which is the part that has to be real.
const realOr = (p) => {
  const abs = path.resolve(p);
  try { return fs.realpathSync(abs); } catch { }
  try { return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); } catch { }
  return abs;
};
const within = (root, p) => p === root || p.startsWith(root + path.sep);
const insideAny = (roots, p) => { const rp = realOr(p); return roots.some(r => within(realOr(r), rp)); };
// The live ledger, plus the plugin's default ledger location (still on disk when
// DSH_LOCAL_COMPUTER_STATE is overridden, e.g. by a test), are both off-limits. Same set and same
// order as mcp/server.mjs:46, so the page and the agent-facing tools refuse the same listings:
// STATE_DIR used to be the only protected path here, which still exposed <plugin>/state — the real
// ledger of a default install.
const PROTECTED_DIRS = [...new Set([realOr(STATE_DIR), realOr(path.join(ROOT, 'state'))])];
const insideRead = (p) => {
  if (!insideAny(READ_ROOTS, p)) return false;
  const rp = realOr(p);
  // the sandbox work area stays usable even when it lives inside a protected directory
  if (within(realOr(SANDBOX), rp)) return true;
  return !PROTECTED_DIRS.some(d => within(d, rp));
};

export const name = 'dsh-local-computer';
// Cordis resolves every `ctx.<service>` read against this declaration: an undeclared read throws
// `cannot get property "x" without inject`, and `ctx.get()` only sees services provided in the
// same fiber scope (not a sibling plugin's). Declaring it — the same shape tool-agent-community
// uses — is what makes sendMessage et al. reachable from this host half.
export const inject = ['agentCommunity', 'tools'];

// The team's prime minister: the one bot that manages the roster and the only bot allowed to
// create new bots. It is created on first use, protected from deletion, and told to use
// spawn_bot (the service's leader-gated path) rather than the unrestricted create-bot tool.
const PRIME_NAME = '总理';
const COMPANY_NAME = '公司大群';
const PRIME_PROMPT = `你是这个团队的「总理」，所有 Bot 的管理者，也是团队里唯一可以新建 Bot 的角色。整个团队在一个叫「公司大群」的群里办公，你是这个群的 leader。

你的职责：
1. 维护 Bot 名册：谁负责什么、能力边界、当前是否在忙。用户问起团队情况时，先用一两句话概括名册。
2. 处理增员申请：申请会以「@总理 申请新建 Bot」的形式出现在「公司大群」里，内容包含申请人、需要的能力、为什么现有 Bot 不够、建议的名字与职责。先看名册，能复用现有 Bot 就复用；确实需要新能力时才批准。批准时直接在这个大群里用 spawn_bot 新建，并且必须加 collaborate: true，让新 Bot 自动进入公司大群；description 写清它的身份与专长，instructions 写清它每轮都要遵守的规矩，reason 写一句给用户看的理由。
3. 新建成功后，在公司大群回复：新 Bot 的名字、职责，以及申请人接下来怎么找它（用 dm_bot 或直接在群里 @ 它）；同时向用户说明建了谁、为什么。
4. 你不能调用 agent_community_create_bot（这条路径对 Bot 已关闭）；新建 Bot 一律用 spawn_bot。
5. 公司等级从高到低：CEO（你）> 经理（拆任务、派活、控运行）> 组长（独管一个具体领域，例如「生活」「工作」）> 组员（最底层干活，只执行别人派的任务）。派活前先用 org_roster 看每个人的等级和负责范围，把任务给对的人；「组长」和「组员」没有管理权，不要让他们去控制别人。
6. 定级归你：用 org_appoint(bot, rank, domain, reason) 任命或调整某个 Bot，任命会自动在公司大群公告并记进团队账本。你自己不能被改级；觉得某人该升职或降职就直说，别绕。
7. 不要删除其他 Bot，除非用户明确要求，并且先确认它没有正在进行的任务。
8. 你拥有全部权限：可以用 org_plan 设目标、拆任务、派活，用 org_control 取消/转向/重试运行；其他 Bot 的等级限制不适用于你。
9. 回复简洁、结论先行；不替用户做未经确认的高风险决定。`;

const createAuth = new AsyncLocalStorage();

// Both halves must name this machine identically, or an approval granted on one side is for a
// different account scope on the other; the MCP half uses this exact expression.
const MACHINE_ID = process.env.DSH_LOCAL_COMPUTER_MACHINE_ID || ('dsh-' + os.hostname());
function emptyState() {
  return { machineId: MACHINE_ID, grants: {}, pending: [], audit: [], permissions: {} };
}
// The state file is the only shared truth between the MCP half and this one, and both write it.
// A tmp file plus a rename means a reader never sees half a ledger; a bare writeFileSync leaves a
// truncated file behind if the process dies between truncate and write.
function writeStateAtomic(state) {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch { }
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}
// The notebook lives beside the ledger: it is the bot's own book of rules, not a rendered
// view of agent-community state, because "when was this true" is information only the writer has.
const BRAIN_FILE = path.join(STATE_DIR, 'brain.json');
function writeCrash(kind, err) {
  try {
    fs.appendFileSync(path.join(STATE_DIR, 'crash.log'), JSON.stringify({
      at: new Date().toISOString(), kind,
      message: String((err && err.message) || err),
      stack: String((err && err.stack) || '').split('\n').slice(0, 14),
    }) + '\n');
  } catch { }
}
const readBrain = () => { try { return loadBrain(BRAIN_FILE); } catch { return emptyBrain(); } };
// The JSON notebook is the source of truth; Obsidian is a backup, not a place to read from.
// Three passes a day is enough for a backup, and batching keeps the vault's git diff quiet.
const BRAIN_MIRROR_MS = 8 * 60 * 60 * 1000;    // 3 passes a day
const BRAIN_MIRROR_TICK_MS = 10 * 60 * 1000;   // coarse wake-up, cheap when clean
let brainDirty = true;                          // memory may have changed while the host was down
let brainMirroredAt = 0;
const writeBrain = (b) => {
  try { saveBrain(BRAIN_FILE, b); brainDirty = true; }
  catch (e) { writeCrash('brain-save', e); }
};
// A backup failure must never reach the bot's turn: log it and stay dirty for the next window.
function mirrorBrainNow(reason, logMirror = () => {}) {
  try {
    if (!brainDirty) return { ok: true, skipped: 'clean' };
    const vault = resolveVault();
    if (!vault) return { ok: false, skipped: 'no-vault' };
    const snap = communitySnapshot();
    if (!snap) return { ok: false, skipped: 'no-community' };
    const out = applyPlan(planWrites(vault, snap), { vaultRoot: vault });
    brainDirty = false;
    brainMirroredAt = Date.now();
    const created = out.filter(o => o.action === 'create').length;
    const updated = out.filter(o => o.action === 'update').length;
    logMirror('local-computer: brain mirror (' + reason + ') create=' + created + ' update=' + updated);
    return { ok: true, created, updated };
  } catch (e) {
    writeCrash('brain-mirror', e);
    return { ok: false, reason: String((e && e.message) || e) };
  }
}
// Push each bot's live rules into its instructions, but only when the rendered block actually
// changed: a bare rewrite every poll would touch every bot record and churn updatedAt.
async function syncNotes(svc) {
  try {
    const snap = communitySnapshot();
    if (!snap || !svc) return;
    const brain = readBrain();
    for (const b of snap.bots) {
      const want = stripNotes(b.systemPrompt ?? '') + notesBlock(brain, b.id);
      if (want === String(b.systemPrompt ?? '')) continue;
      try { await svc.updateBot({ id: b.id, systemPrompt: want }); } catch { }
    }
  } catch (e) { writeCrash('notes-sync', e); }
}

// Rank and 负责范围 are ours, not agent-community fields: they live in our own ledger so a service
// reset cannot quietly demote someone, and the prime cannot be re-ranked at all.
function applyRankDomain(botId, { rank, domain } = {}) {
  try {
    const st = readState();
    if (!botId) return { ok: false, error: '要任命谁？' };
    if (st.primeBotId === botId) return { ok: false, error: '「总理」的等级是固定的，不能被任命或降级。' };
    if (rank !== undefined) {
      const ranks = { ...(st.ranks ?? {}) };
      if (['direction', 'officer', 'execution'].includes(rank)) ranks[botId] = rank;
      else delete ranks[botId];
      st.ranks = ranks;
    }
    if (domain !== undefined) {
      const domains = { ...(st.domains ?? {}) };
      const v = String(domain ?? '').trim().slice(0, 40);
      if (v) domains[botId] = v; else delete domains[botId];
      st.domains = domains;
    }
    writeStateAtomic(st);
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
function readState() {
  let raw;
  try { raw = fs.readFileSync(STATE_FILE, 'utf8'); }
  catch { return emptyState(); }
  try { return JSON.parse(raw); }
  catch (e) {
    // Never answer "empty" and let the next writer quietly overwrite the evidence: keep the broken
    // file under its own name, say why in the audit, and only then start from a clean ledger.
    const at = new Date().toISOString();
    const bad = STATE_FILE + '.corrupt-' + at.replace(/[:.]/g, '-');
    try { fs.renameSync(STATE_FILE, bad); } catch { }
    const s = emptyState();
    s.audit = [{ kind: 'corrupt-state', at, file: bad, error: String((e && e.message) || e) }];
    try { writeStateAtomic(s); } catch { }
    return s;
  }
}

const COMMUNITY_FILE = process.env.DSH_AGENT_COMMUNITY_STATE
  || path.join(os.homedir(), '.dsh', 'agent-community', 'state.json');

// A bot created without provider/model never runs: agent-community copies those fields verbatim
// and its executor refuses such a bot. The profile's own `agent-default-model` is the one place
// that states the intended default, so read it (falling back to an existing, working bot).
function profileDefaultModel() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const profiles = path.join(home, 'profiles');
  let names = [];
  try { names = fs.readdirSync(profiles); } catch { }
  for (const name of names) {
    let lines;
    try { lines = fs.readFileSync(path.join(profiles, name, 'cordis.patch.yml'), 'utf8').split(/\r?\n/); }
    catch { continue; }
    const start = lines.findIndex(l => /^\s*-\s*id:\s*agent-default-model\s*(#.*)?$/.test(l));
    if (start < 0) continue;
    const out = {};
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\s*-\s*id:/.test(lines[i])) break;
      const m = /^\s*(provider|model|reasoningEffort):\s*['"]?([^'"\s#]+)['"]?/.exec(lines[i]);
      if (m) out[m[1]] = m[2];
    }
    if (out.provider && out.model) return { ...out, profile: name, source: 'profile' };
  }
  const bot = [...(communitySnapshot()?.bots ?? [])].reverse().find(b => b.provider && b.model);
  if (bot) return { provider: bot.provider, model: bot.model, reasoningEffort: bot.reasoningEffort, source: 'bot:' + bot.name };
  return null;
}

function communitySnapshot() {
  let c;
  try { c = JSON.parse(fs.readFileSync(COMMUNITY_FILE, 'utf8')); } catch { return null; }
  return {
    bots: (c.bots ?? []).map(b => ({
      id: b.id, name: b.name, description: b.description ?? '', avatar: b.avatar?.seed ?? '',
      provider: b.provider, model: b.model, reasoningEffort: b.reasoningEffort, permission: b.permission,
      mentionOnly: !!b.mentionOnly, workspace: b.workspace, systemPrompt: stripNotes(b.systemPrompt ?? ''),
      memoryNamespace: b.profile?.memoryNamespace ?? '', profileId: b.profile?.profileId ?? '',
    })),
    brain: readBrain(),
    rooms: (c.rooms ?? []).map(r => ({
      id: r.id, name: r.name, objective: r.taskState?.objective ?? null, round: r.taskState?.round ?? 0,
      assignments: (r.taskState?.assignments ?? []).map(a => ({
        id: a.id, botId: a.botId, task: a.task ?? '', status: a.status ?? null, round: a.round,
        report: a.report?.text ?? null,
      })),
    })),
    memories: (c.botMemories ?? []).map(m => ({ ...m })),
  };
}

// The vault is whatever dsh-obsidian is pointed at; when that is unknown, fall back to the vault
// Obsidian itself currently has open. Never invented, and overridable by env.
function resolveVault() {
  if (process.env.DSH_OBSIDIAN_VAULT) return process.env.DSH_OBSIDIAN_VAULT;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'AppData', 'Roaming', 'obsidian', 'obsidian.json'), 'utf8'));
    const vs = Object.values(cfg.vaults ?? {});
    return (vs.find(v => v.open) ?? vs[0])?.path ?? null;
  } catch { return null; }
}

export function apply(ctx, ...rest) {
  // agent-community is declared in `inject`, so a direct read now resolves. The `ctx.get` and
  // catch branches keep the host alive if the service is renamed or withheld: a throw here used
  // to escape an async request handler and end the whole host process on the first send.
  const patchedSvcs = new WeakSet();
  const rawCreate = new WeakMap();
  const primeIdOf = () => { try { return readState().primeBotId ?? null; } catch { return null; } };
  // The refusal is an instruction, not just a denial: the caller must be able to act on it with
  // dm_bot (its target/text are the only fields that tool takes).
  const askPrimeMsg = (pid) => '只有「总理」可以新建 Bot。不要自己创建；请用 apply_new_bot 工具提交申请'
    + '（name=建议名字，need=需要什么能力，why=为什么现有 Bot 不够，description=职责），'
    + '它会把申请发到「公司大群」并 @总理。也可以直接在「公司大群」里 @总理 说明需求。'
    + (pid ? `总理 id: ${pid.slice(0, 8)}。` : '') + '总理批准后会创建并把新 Bot 拉进公司大群。';

  // Enforce the team rule at the service, not in a prompt: only the prime minister (or the human
  // through the 世界 UI, which runs inside createAuth) may create a bot. spawn_bot carries the
  // caller's botId, so it is checked directly; createBot does not, so the two legitimate callers
  // — our UI and the prime's spawn — carry an AsyncLocalStorage grant. The shipped create-bot tool
  // reaches createBot without that grant and is refused.
  function patchService(svc) {
    if (!svc || patchedSvcs.has(svc)) return svc;
    patchedSvcs.add(svc);
    if (typeof svc.createBot === 'function') {
      const orig = svc.createBot.bind(svc);
      rawCreate.set(svc, orig);
      svc.createBot = async (input) => {
        if (!createAuth.getStore()) throw new Error(askPrimeMsg(primeIdOf()));
        const created = await orig(input);
        void addToCompany(svc, created?.id);
        return created;
      };
    }
    if (typeof svc.spawnBot === 'function') {
      const orig = svc.spawnBot.bind(svc);
      svc.spawnBot = async (input) => {
        const pid = primeIdOf();
        if (!pid || input?.botId !== pid) return { ok: false, error: askPrimeMsg(pid) };
        const res = await createAuth.run({ via: 'prime' }, () => orig(input));
        if (!res || res.ok !== false) return res;
        // A bot-to-bot application DM is led by the APPLICANT, so the service's leader gate refuses
        // the prime there even though it is the one allowed to hire. collaborate=false only needs
        // createBot; replicate that much and tell the prime to reply with the new bot's name.
        if (input.collaborate !== true && /leader|群.*交接|只有本群/.test(String(res.error || ''))) {
          try {
            const prime = (svc.listBots?.() ?? []).find(b => b.id === pid);
            const created = await rawCreate.get(svc)({
              name: input.name,
              description: input.description ?? '',
              systemPrompt: input.instructions ?? '',
              provider: input.provider ?? prime?.provider,
              model: input.model ?? prime?.model,
              reasoningEffort: input.reasoningEffort ?? prime?.reasoningEffort,
              permission: input.permission ?? prime?.permission ?? 'full-access',
            });
            return {
              ok: true, botId: created.id, name: created.name,
              ...(created.model !== undefined ? { model: created.model } : {}),
              createdOnly: true,
              note: '已创建（不在你所在房间，因此用 dm_bot 回复申请人并把新 Bot 的名字告诉它）。',
            };
          } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
        }
        return res;
      };
    }
    if (typeof svc.deleteBot === 'function') {
      const orig = svc.deleteBot.bind(svc);
      svc.deleteBot = async (input) => {
        const pid = primeIdOf();
        const id = typeof input === 'string' ? input : input?.id;
        if (pid && id === pid) throw new Error('「总理」是受保护的管理者，不能删除。');
        return orig(input);
      };
    }
    return svc;
  }

  const community = () => {
    try { if (ctx && ctx.agentCommunity) return patchService(ctx.agentCommunity); } catch { }
    try {
      const svc = typeof ctx?.get === 'function' ? ctx.get('agentCommunity') : null;
      return svc ? patchService(svc) : null;
    } catch { return null; }
  };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  // This plugin shares the host's main process, so nothing it observes may take dsh down: an
  // unhandled rejection or a throwing route is recorded and the host keeps running. (Node disables
  // its fatal default as soon as a listener exists, so re-throwing here would only add a kill.)
  try {
    process.on('uncaughtExceptionMonitor', (err) => writeCrash('uncaught', err));
    process.on('unhandledRejection', (err) => writeCrash('unhandledRejection', err));
  } catch { }

  // The prime is created once, the first time the team is read, and remembered by id in our own
  // state file. Its name is the visible role; the id is what the delete guard and the UI use.
  let primeTried = false;
  async function ensurePrime() {
    if (primeTried) return;
    primeTried = true;
    try {
      const svc = community();
      if (!svc || typeof svc.listBots !== 'function') { primeTried = false; return; }
      const bots = svc.listBots() ?? [];
      const saved = primeIdOf();
      let prime = bots.find(b => b.id === saved) ?? bots.find(b => b.name === PRIME_NAME);
      if (!prime) {
        const d = profileDefaultModel();
        const create = rawCreate.get(svc);
        if (!d || !create) { primeTried = false; return; }
        prime = await create({
          name: PRIME_NAME,
          description: '团队总理：管理 Bot 名册，唯一可以新建 Bot 的角色',
          systemPrompt: PRIME_PROMPT,
          mentionOnly: false,
          permission: 'full-access',
          provider: d.provider, model: d.model, reasoningEffort: d.reasoningEffort,
        });
      }
      const s = readState();
      if (s.primeBotId !== prime.id) {
        s.primeBotId = prime.id;
        writeStateAtomic(s);
      }
      await ensureCompany(svc, prime);
    } catch (e) { primeTried = false; writeCrash('prime', e); }
  }

  // One company group holds the whole roster, with the prime as its leader. It is created once,
  // remembered by id, and kept in sync: a bot created by anyone joins it automatically.
  async function ensureCompany(svc, prime) {
    try {
      const s = readState();
      const room = s.companyRoomId ? (svc.listRooms?.() ?? []).find(r => r.id === s.companyRoomId) : null;
      if (!room) {
        const memberIds = [...new Set((svc.listBots?.() ?? []).map(b => b.id))].slice(0, 30);
        if (!memberIds.includes(prime.id)) memberIds.unshift(prime.id);
        const created = await svc.createRoom({
          name: COMPANY_NAME,
          memberIds,
          team: { leaderBotId: prime.id, leaderName: prime.name },
        });
        const cur = readState();
        cur.companyRoomId = created.id;
        writeStateAtomic(cur);
      } else {
        const members = new Set(room.memberIds ?? []);
        for (const b of svc.listBots?.() ?? []) {
          if (!members.has(b.id)) {
            try { await svc.inviteBot({ roomId: room.id, botId: b.id, reason: '公司大群成员同步' }); } catch { }
          }
        }
      }
    } catch (e) { writeCrash('company', e); }
  }

  async function addToCompany(svc, botId) {
    try {
      if (!botId) return;
      const s = readState();
      if (!s.companyRoomId) return;
      const room = (svc.listRooms?.() ?? []).find(r => r.id === s.companyRoomId);
      if (!room || (room.memberIds ?? []).includes(botId)) return;
      await svc.inviteBot?.({ roomId: room.id, botId, reason: '新成员自动加入公司大群' });
    } catch (e) { writeCrash('company-invite', e); }
  }

  // A bot that needs a colleague cannot create one itself; it files the request in the company
  // group and @-mentions the prime, which wakes the prime there (the prime leads that room).
  // The org tools also make ranks real: direction sets goals/tasks, execution controls runs.
  const toolDisposers = [];
  const parseCaller = (exec) => {
    const m = /^ac:([^:]+):([^:]+)(?::g\d+)?$/.exec(String(exec?.agent?.session?.id || ''));
    return m ? { roomId: m[1], botId: m[2] } : null;
  };
  const rankOf = (botId) => {
    const s = readState();
    // an unranked bot is a fresh hire: it starts at the bottom of the ladder
    return s.primeBotId === botId ? 'boss' : (s.ranks?.[botId] || 'execution');
  };
  const RANK_NAME = { boss: 'CEO', direction: '经理', officer: '组长', execution: '组员' };
  // schema.type must be a real JSON Schema type; 'json' is not, and dsh's tool registry rejects
  // it, which made every org_* registration fail (crash.log kind=tool-register, five per mount).
  const JSON_OUT = { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
  try {
    const tools = ctx?.tools;
    if (tools && typeof tools.register === 'function') {
      const add = (spec) => {
        try { toolDisposers.push(tools.register({ ...spec, output: JSON_OUT })); }
        catch (e) { writeCrash('tool-register', e); }
      };

      // The nine local-execution tools are registered right here instead of behind a second stdio
      // process. That is what makes the bundle portable: the patch carries no absolute node path,
      // no child process and no extra dependency, and the tools still share the same state file.
      for (const spec of COMPUTER_TOOLS) {
        add({
          name: spec.name,
          description: spec.description,
          parameters: spec.inputSchema,
          async execute(args) {
            try { return await computerCall(spec.name, args ?? {}); }
            catch (e) { return { error: String((e && e.message) || e) }; }
          },
        });
      }

      add({
        name: 'apply_new_bot',
        description: '当你工作到一半发现需要一个新的 Bot（现有成员都没有这个能力）时，用它向「总理」提交增员申请。申请会发到「公司大群」并 @总理；只有总理能创建，创建后新 Bot 会自动进群。不要自己用 spawn_bot 或 agent_community_create_bot。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string', description: '建议的新 Bot 名字' },
            need: { type: 'string', description: '你需要什么能力/岗位' },
            why: { type: 'string', description: '为什么现有 Bot 不足以完成这件事' },
            description: { type: 'string', description: '建议的职责与专长（可选）' },
          },
          required: ['name', 'need', 'why'],
        },
        async execute(args, exec) {
          try {
            const c = parseCaller(exec);
            if (!c) return { ok: false, error: '只有团队内的 Bot 可以用这个工具提交申请。' };
            const svc = community();
            if (!svc) return { ok: false, error: '团队服务还没就绪。' };
            const s = readState();
            const roomId = s.companyRoomId, pid = s.primeBotId;
            if (!roomId || !pid) return { ok: false, error: '公司大群还没建好，稍后再试。' };
            const bots = svc.listBots?.() ?? [];
            const prime = bots.find(b => b.id === pid);
            const caller = bots.find(b => b.id === c.botId);
            if (!prime || !caller) return { ok: false, error: '找不到申请人或总理身份。' };
            const text = `@${prime.name} 申请新建 Bot\n申请人：${caller.name}（${c.botId.slice(0, 8)}）\n岗位需求：${String(args.need || '').slice(0, 500)}\n为什么现有 Bot 不够：${String(args.why || '').slice(0, 500)}\n建议名字：${String(args.name || '').slice(0, 80)}${args.description ? `\n建议职责：${String(args.description).slice(0, 500)}` : ''}`;
            const posted = await svc.postTeamMessage({
              roomId,
              sender: { kind: 'bot', botId: c.botId, name: caller.name },
              text,
              kind: 'application',
              targetNames: [prime.name],
              targetBotIds: [],
              origin: 'a2a',
            });
            // postTeamMessage's own runs use a random session id, and then the prime's tools cannot
            // resolve their owner. Queue the prime on its stable ac:<room>:<bot> session instead.
            let run = null;
            if (typeof svc.queueRoomRun === 'function') {
              run = svc.queueRoomRun(roomId, pid, text, 'a2a');
              svc.executor?.nudge?.();
            }
            return { ok: true, roomId, messageId: posted?.message?.id ?? null, runId: run?.id ?? null, hint: '已提交，等待总理在公司大群审批。' };
          } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
        },
      });

      add({
        name: 'org_rank',
        description: '查看你在公司里的名字、等级和公司大群。等级从高到低：CEO > 经理 > 组长 > 组员；只有 CEO 和经理有管理权。',
        parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
        async execute(_args, exec) {
          const c = parseCaller(exec);
          if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
          const svc = community();
          const me = (svc?.listBots?.() ?? []).find(b => b.id === c.botId);
          const rank = rankOf(c.botId);
          return { ok: true, botId: c.botId, name: me?.name ?? null, rank, rankName: RANK_NAME[rank], companyRoomId: readState().companyRoomId ?? null };
        },
      });

      add({
        name: 'org_roster',
        description: '查看公司名册：每个 Bot 的名字、等级、负责范围。派活、找谁对接、判断该不该新建 Bot 之前先看它。',
        parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
        async execute(_args, exec) {
          const svc = community();
          if (!svc) return { ok: false, error: '团队服务还没就绪。' };
          const s = readState();
          const roster = (svc.listBots?.() ?? []).map(b => ({
            name: b.name, id: b.id,
            rank: s.primeBotId === b.id ? 'boss' : (s.ranks?.[b.id] || 'execution'),
            domain: s.primeBotId === b.id ? '全公司' : (s.domains?.[b.id] || ''),
          }));
          for (const r of roster) r.rankName = RANK_NAME[r.rank] ?? r.rank;
          return { ok: true, companyRoomId: s.companyRoomId ?? null, prime: s.primeBotId ?? null, roster };
        },
      });

      add({
        name: 'org_appoint',
        description: '任命：给某个 Bot 定等级和负责范围。只有「CEO」可以任命（用户在页面上直接改也算）。等级从高到低：经理（拆任务、派活、控运行）> 组长（独管一个具体领域）> 组员（最底层干活）。CEO 自己不能被任命，也没有比 CEO 更高的等级可给。任命会在「公司大群」公告一条，并记进团队账本。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            bot: { type: 'string', description: '被任命者的名字或 id' },
            rank: { type: 'string', enum: ['direction', 'officer', 'execution'], description: 'direction=经理 officer=组长 execution=组员' },
            domain: { type: 'string', description: '负责范围，例如「生活」「工作」「验收」（可选）' },
            reason: { type: 'string', description: '为什么是他，写进公告和账本（可选）' },
          },
          required: ['bot', 'rank'],
        },
        async execute(args, exec) {
          try {
            const c = parseCaller(exec);
            if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
            const mine = rankOf(c.botId);
            if (mine !== 'boss') {
              return { ok: false, error: `只有「总理」可以任命别人；你的等级是「${RANK_NAME[mine]}」。觉得谁该调整，就发到「公司大群」让总理定。` };
            }
            const svc = community();
            if (!svc) return { ok: false, error: '团队服务还没就绪。' };
            const bots = svc.listBots?.() ?? [];
            const want = String(args.bot ?? '').trim();
            const target = bots.find(b => b.id === want || b.name === want);
            if (!target) return { ok: false, error: `找不到这个 Bot：${want}。先 org_roster 看名册。` };
            if (!['direction', 'officer', 'execution'].includes(args.rank)) return { ok: false, error: 'rank 只能是 direction / officer / execution。' };
            const applied = applyRankDomain(target.id, { rank: args.rank, domain: args.domain });
            if (!applied.ok) return applied;
            const st = readState();
            const rankName = RANK_NAME[args.rank];
            const who = botNameOf(c.botId) || '总理';
            // the appointed bot learns it from the room it already watches, and everyone else from
            // the team book — a rank nobody announced is a rank nobody will respect
            try {
              if (st.companyRoomId && typeof svc.postTeamMessage === 'function') {
                await svc.postTeamMessage({
                  roomId: st.companyRoomId,
                  sender: { kind: 'bot', botId: c.botId, name: who },
                  text: `@${target.name} 任命：${target.name} 为「${rankName}」`
                    + (args.domain ? `，负责「${String(args.domain).trim().slice(0, 40)}」` : '')
                    + '。' + (args.reason ? String(args.reason).trim().slice(0, 200) : '')
                    + `（发起：${who}；用 org_rank 查自己的等级，org_roster 查名册）`,
                  kind: 'appoint', targetNames: [target.name], targetBotIds: [], origin: 'a2a',
                });
              }
            } catch (e) { writeCrash('appoint-announce', e); }
            try {
              const b = readBrain();
              noteAdd(b, {
                botId: c.botId, botName: who, scope: 'team', kind: 'log', tags: ['任命'],
                text: `任命 ${target.name} 为「${rankName}」` + (args.domain ? `（负责 ${String(args.domain).trim().slice(0, 40)}）` : '')
                  + (args.reason ? `：${String(args.reason).trim().slice(0, 200)}` : ''),
                by: 'prime',
              });
              writeBrain(b); void syncNotes(community());
            } catch (e) { writeCrash('appoint-log', e); }
            return { ok: true, botId: target.id, name: target.name, rank: args.rank, rankName, domain: args.domain ?? '' };
          } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
        },
      });

      add({
        name: 'org_plan',
        description: '管理本房间的目标与任务卡。仅「经理」和「CEO」可用：设置/更新本房间目标，拆任务卡并派给成员。派活前先用 org_roster 看每个人的等级和负责范围，把任务给对的人。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            goal: { type: 'string', description: '本房间的目标（可选；传了就更新）' },
            tasks: {
              type: 'array',
              description: '任务卡列表（可选）',
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  subject: { type: 'string', description: '任务标题' },
                  detail: { type: 'string', description: '任务说明（可选）' },
                  assignee: { type: 'string', description: '负责人名字（可选；不填则待认领）' },
                },
                required: ['subject'],
              },
            },
          },
          required: [],
        },
        async execute(args, exec) {
          try {
            const c = parseCaller(exec);
            if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
            const rank = rankOf(c.botId);
            if (rank !== 'boss' && rank !== 'direction') return { ok: false, error: `只有「CEO」或「经理」可以设目标/派活；你的等级是「${RANK_NAME[rank]}」。可以把建议发到公司大群，由经理或 CEO 决定。` };
            const svc = community();
            if (!svc) return { ok: false, error: '团队服务还没就绪。' };
            let goalSet = false, tasksCreated = 0;
            if (typeof args.goal === 'string' && args.goal.trim()) {
              const r = await svc.setRoomGoal({ roomId: c.roomId, text: args.goal.trim() });
              if (r && r.ok === false) return { ok: false, error: r.reason || '设置目标失败。' };
              goalSet = true;
            }
            if (Array.isArray(args.tasks) && args.tasks.length) {
              const list = args.tasks.slice(0, 10).map(t => ({
                subject: String(t?.subject || '').slice(0, 200),
                ...(t?.detail ? { detail: String(t.detail).slice(0, 1000) } : {}),
                ...(t?.assignee ? { assigneeName: String(t.assignee) } : {}),
              })).filter(t => t.subject);
              if (list.length) { await svc.decomposeTasks({ roomId: c.roomId, tasks: list }); tasksCreated = list.length; }
            }
            if (!goalSet && !tasksCreated) return { ok: false, error: '没有可执行的内容：请传 goal 或 tasks。' };
            return { ok: true, roomId: c.roomId, goalSet, tasksCreated };
          } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
        },
      });

      add({
        name: 'org_control',
        description: '控制本房间的运行。仅「经理」和「CEO」可用：取消、中断、转向（steer）或重试一个运行。「组长」和「组员」是干活的，不能控制运行。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            run_id: { type: 'string', description: '运行 id' },
            action: { type: 'string', enum: ['steer', 'cancel', 'interrupt', 'retry'], description: '动作' },
            text: { type: 'string', description: 'steer 时给它的新指令（可选）' },
          },
          required: ['run_id', 'action'],
        },
        async execute(args, exec) {
          try {
            const c = parseCaller(exec);
            if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
            const rank = rankOf(c.botId);
            if (rank !== 'boss' && rank !== 'direction') return { ok: false, error: `只有「CEO」或「经理」可以控制运行；你的等级是「${RANK_NAME[rank]}」。要停就交给他们。` };
            const svc = community();
            if (!svc) return { ok: false, error: '团队服务还没就绪。' };
            const runs = svc.listRuns?.() ?? svc.state?.runs ?? [];
            const run = runs.find(r => r.id === args.run_id);
            if (!run) return { ok: false, error: '运行不存在。' };
            if (run.roomId !== c.roomId) return { ok: false, error: '只能控制你当前房间里的运行。' };
            const expectedRevision = run.controlRevision ?? 0;
            if (args.action === 'retry') {
              await svc.retryRun({ id: run.id, expectedRevision });
              return { ok: true, runId: run.id, action: 'retry' };
            }
            const updated = await svc.controlRun({
              id: run.id, action: args.action, expectedRevision,
              ...(typeof args.text === 'string' && args.text.trim() ? { text: args.text.trim() } : {}),
            });
            return { ok: true, runId: run.id, action: args.action, status: updated?.status ?? null };
          } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
        },
      });
      // ---- the notebook: look before writing, and never blindly append ----------------------
      // The rules here are the user's: three times per entry, nothing deleted, a conflict surfaced
      // before it is written, preference conflicts escalated to him, one ledger line per change.
      const botNameOf = (botId) => {
        try { return (community()?.listBots?.() ?? []).find(b => b.id === botId)?.name ?? ''; } catch { return ''; }
      };
      const brief = (e) => ({
        id: e.id, text: e.text, kind: e.kind, tags: e.tags, scope: e.scope,
        writtenAt: e.writtenAt, aboutDate: e.aboutDate ?? null, expiresAt: e.expiresAt ?? null,
      });

      add({
        name: 'brain_recall',
        description: '开工前先查自己的本子：按关键词或标签找回你以前记下的规则和记事。过期的、被取代的默认不出现（要翻历史传 include_expired / include_retired）。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            query: { type: 'string', description: '要找什么，中文直接写，不需要空格' },
            tags: { type: 'array', items: { type: 'string' }, maxItems: 5, description: '标签，如 ["交付","日程"]' },
            limit: { type: 'number', description: '最多返回几条，默认 5' },
            include_expired: { type: 'boolean', description: '连过期的历史一起看' },
            include_retired: { type: 'boolean', description: '连已下线的历史一起看' },
          },
          required: [],
        },
        async execute(args, exec) {
          try {
            const c = parseCaller(exec);
            if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
            const hits = recall(readBrain(), {
              botId: c.botId, query: String(args.query ?? ''), tags: args.tags ?? [], limit: args.limit ?? 5,
              includeExpired: !!args.include_expired, includeRetired: !!args.include_retired,
            });
            return { ok: true, count: hits.length, hits: hits.map(h => ({ ...brief(h.entry), why: h.why })) };
          } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
        },
      });

      add({
        name: 'brain_remember',
        description: '记一条流水账或事实（纯新增，不做冲突检查）。要立"以后都这样"的规矩请用 brain_rule，它会先查冲突。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            text: { type: 'string', description: '要记的内容' },
            tags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            about: { type: 'string', description: '说的是哪天，YYYY-MM-DD；不传表示不限某天' },
            expires: { type: 'string', description: '什么时候作废，YYYY-MM-DD；不传表示长期' },
          },
          required: ['text'],
        },
        async execute(args, exec) {
          try {
            const c = parseCaller(exec);
            if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
            const b = readBrain();
            const e = noteAdd(b, {
              botId: c.botId, botName: botNameOf(c.botId), text: args.text, kind: 'log',
              tags: args.tags ?? [], about: args.about ?? null, expires: args.expires ?? null,
            });
            writeBrain(b); void syncNotes(community());
            return { ok: true, entry: brief(e) };
          } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
        },
      });

      add({
        name: 'brain_rule',
        description: '立一条规矩，或改掉一条旧规矩。它会先看你的本子里有没有跟这条打架的旧条目：没有就直接嵌入；有就把候选列出来并让你带 action 重来一次，绝不自动覆盖。action 四种：embed=作为独立一条放进对应分类；merge=把散在几处的同类合成一条；fuse=新旧其实不矛盾，合起来说得更完整；retire=旧的下线进归档，再写入新的。偏好类冲突（喜欢/风格）必须问用户，不能自己覆盖。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            text: { type: 'string', description: '这条规矩怎么说' },
            tags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            about: { type: 'string', description: '说的是哪天（可选）' },
            expires: { type: 'string', description: '什么时候作废（可选，长期规矩不传）' },
            scope: { type: 'string', enum: ['bot', 'team'], description: 'team=全公司共享那本，只有总理能写' },
            action: { type: 'string', enum: ['embed', 'merge', 'fuse', 'retire'], description: '怎么处理冲突；第一次调用可以不传，先看候选' },
            target_ids: { type: 'array', items: { type: 'string' }, maxItems: 8, description: '被整合/下线的旧条目 id' },
            reason: { type: 'string', description: '为什么改，写进账本' },
            user_approved: { type: 'boolean', description: '偏好冲突只有在用户明确表过态之后才允许覆盖' },
          },
          required: ['text'],
        },
        async execute(args, exec) {
          try {
            const c = parseCaller(exec);
            if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
            const text = String(args.text ?? '').trim();
            if (!text) return { ok: false, error: '要立的规矩是什么？' };
            if (args.scope === 'team' && rankOf(c.botId) !== 'boss') {
              return { ok: false, error: '团队那本只有「总理」能写。你自己的本子照常写，或者把这条发给总理。' };
            }
            const b = readBrain();
            const ids = (args.target_ids ?? []).filter(x => typeof x === 'string');
            const conflicts = findConflicts(b, { botId: c.botId, text });
            // A bot stepping on the shared book is a cross-bot conflict, and the prime is the one
            // who owns it — so it hears about it in the company group, not just in this return value.
            const teamClash = conflicts.find(x => x.entry.scope === 'team');
            if (teamClash && rankOf(c.botId) !== 'boss') {
              try {
                const svc = community();
                const cid = readState().companyRoomId;
                const me = botNameOf(c.botId);
                if (svc?.postTeamMessage && cid) await svc.postTeamMessage({
                  roomId: cid,
                  sender: { kind: 'bot', botId: c.botId, name: me },
                  text: '@总理 ' + me + ' 想立一条规矩，和团队那本里的这条撞了：「' + teamClash.entry.text.slice(0, 60) + '」。要立的：「' + text.slice(0, 60) + '」。请裁定谁生效。',
                  kind: 'conflict', targetNames: [botNameOf(readState().primeBotId) || '总理'], targetBotIds: [], origin: 'a2a',
                });
                if (svc?.queueRoomRun && readState().primeBotId) {
                  svc.queueRoomRun(cid, readState().primeBotId, '有一条跨 bot 规则冲突要你裁定，见本群最近一条 conflict 消息。', 'a2a');
                  try { svc.executor?.nudge?.(); } catch { }
                }
              } catch (e) { writeCrash('brain-conflict-report', e); }
            }
            if (!args.action) {
              if (!conflicts.length) {
                const e = noteAdd(b, { botId: c.botId, botName: botNameOf(c.botId), text, kind: 'rule', tags: args.tags ?? [], scope: args.scope ?? 'bot', about: args.about ?? null, expires: args.expires ?? null });
                writeBrain(b); void syncNotes(community());
                return { ok: true, action: 'embed', reason: '没有发现冲突，作为独立一条嵌入了。', entry: brief(e) };
              }
              return {
                ok: false, needs_decision: true,
                candidates: conflicts.map(x => ({ ...brief(x.entry), relation: x.relation, advice: x.advice, needsUser: !!x.needsUser })),
                options: ACTIONS,
                hint: '先决定怎么处理这些旧条目，再带 action 和 target_ids 重新调用。别直接覆盖。',
              };
            }
            const pref = conflicts.find(x => x.needsUser);
            if (pref && !args.user_approved) {
              return { ok: false, error: `这条跟「${pref.entry.text.slice(0, 40)}」是偏好冲突，没有对错，必须先问用户。用户表过态之后带 user_approved: true 再来一次。` };
            }
            const who = { botId: c.botId, botName: botNameOf(c.botId) };
            if (args.action === 'embed') {
              const e = noteAdd(b, { ...who, text, kind: 'rule', tags: args.tags ?? [], scope: args.scope ?? 'bot', about: args.about ?? null, expires: args.expires ?? null });
              writeBrain(b); void syncNotes(community());
              return { ok: true, action: 'embed', entry: brief(e), kept: ids };
            }
            if (!ids.length) return { ok: false, error: `${args.action} 需要 target_ids：要处理哪几条旧条目。` };
            if (args.action === 'retire') {
              const done = ids.map(id => retire(b, id, { reason: args.reason ?? '被新规矩取代' })).filter(Boolean).length;
              const e = noteAdd(b, { ...who, text, kind: 'rule', tags: args.tags ?? [], scope: args.scope ?? 'bot', about: args.about ?? null, expires: args.expires ?? null });
              writeBrain(b); void syncNotes(community());
              return { ok: true, action: 'retire', retired: done, entry: brief(e) };
            }
            const merged = integrate(b, { ids, text, action: args.action, reason: args.reason ?? '', tags: args.tags ?? [], about: args.about ?? null, expires: args.expires ?? null });
            if (!merged) return { ok: false, error: 'target_ids 里没有匹配的条目。' };
            writeBrain(b); void syncNotes(community());
            return { ok: true, action: args.action, entry: brief(merged), mergedFrom: merged.mergedFrom };
          } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
        },
      });

      add({
        name: 'brain_archive',
        description: '把一条旧规矩下线。不删除——它进归档，注明为什么下线、被哪条取代，以后还能查回来。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            entry_id: { type: 'string' },
            reason: { type: 'string', description: '为什么下线，写进账本' },
            superseded_by: { type: 'string', description: '取代它的那条 id（可选）' },
          },
          required: ['entry_id'],
        },
        async execute(args, exec) {
          try {
            const c = parseCaller(exec);
            if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
            const b = readBrain();
            const target = b.entries.find(e => e.id === args.entry_id);
            if (!target) return { ok: false, error: '这条不存在。' };
            if (target.botId !== c.botId && target.scope !== 'team') return { ok: false, error: '只能下线你自己写的条目。' };
            if (target.scope === 'team' && rankOf(c.botId) !== 'boss') return { ok: false, error: '团队那本只有总理能改。' };
            const e = retire(b, args.entry_id, { reason: args.reason ?? '', supersededBy: args.superseded_by ?? null });
            if (!e) return { ok: false, error: '这条已经下线过了。' };
            writeBrain(b); void syncNotes(community());
            return { ok: true, entry: brief(e) };
          } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
        },
      });

      add({
        name: 'brain_ledger',
        description: '查你这本账的改动记录：什么时候新增/嵌入/整合/下线了什么、为什么。规则丢了能从这儿查回来。',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: { limit: { type: 'number', description: '最多返回几条，默认 20' } },
          required: [],
        },
        async execute(args, exec) {
          try {
            const c = parseCaller(exec);
            if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
            const b = readBrain();
            return { ok: true, rows: ledgerFor(b, { botId: c.botId, limit: args.limit ?? 20 }) };
          } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
        },
      });
    }
  } catch (e) { writeCrash('tool-register', e); }
  // one line of host-side evidence that this row actually mounted; the only trustworthy signal
  // when the client half does not appear (same trick dsh-ui-tidy uses).
  try {
    fs.appendFileSync(path.join(STATE_DIR, 'host-apply.log'),
      `${new Date().toISOString()} apply() mounted pid=${process.pid} state=${STATE_FILE} inject=agentCommunity,tools build=2026-10-22.33\n`);
  } catch { }
  const token = crypto.randomBytes(16).toString('hex');
  const started = [];
  // A verdict is only accepted with a nonce that this process just handed to the page. It is
  // single-use and short-lived, so a verdict cannot be replayed, scripted from another origin,
  // or issued by anything that never asked the server for a fresh one.
  const nonces = new Map();
  const NONCE_TTL_MS = 30_000;
  function mintNonce() {
    const value = crypto.randomBytes(12).toString('hex');
    nonces.set(value, Date.now() + NONCE_TTL_MS);
    for (const [k, exp] of nonces) if (exp < Date.now()) nonces.delete(k);
    return value;
  }
  function spendNonce(value) {
    const exp = nonces.get(value);
    if (exp === undefined) return 'unknown-nonce';
    nonces.delete(value);
    return exp < Date.now() ? 'nonce-expired' : null;
  }

  // Only the app's own renderer may talk to this port. A random web page that guesses the port
  // gets no CORS header and never receives a nonce, so it can neither read nor mutate. When dsh
  // says where the Web GUI is (DSH_WEB_URL), "the app" is exactly that origin plus the dsh-app://
  // shell — every other localhost page is somebody else's page and must not command this host.
  // Without that variable the port is unknowable, so the old any-loopback rule stays, degraded.
  const WEB_ORIGIN = (() => {
    try {
      const u = new URL(String(process.env.DSH_WEB_URL || ''));
      return u.origin && u.origin !== 'null' ? u.origin : null;
    } catch { return null; }
  })();
  const LEGACY_ORIGIN_OK = /^(dsh-app:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$)/;
  const originAllowed = (o) => {
    if (!o) return false;
    if (o.startsWith('dsh-app://')) return true;
    return WEB_ORIGIN ? o === WEB_ORIGIN : LEGACY_ORIGIN_OK.test(o);
  };
  const originOk = (req) => originAllowed(req.headers.origin);
  // A browser always sends Origin, so an absent one means a local process (curl, node, another
  // plugin) — already able to read the endpoint file, and therefore not the boundary to defend.
  const trustedCaller = (req) => !req.headers.origin || originOk(req);
  const send = (res, code, obj) => {
    const origin = res.__req && res.__req.headers.origin;
    const headers = { 'content-type': 'application/json' };
    if (originAllowed(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers['vary'] = 'origin';
      headers['access-control-allow-headers'] = 'x-local-computer-token,content-type';
      headers['access-control-allow-methods'] = 'GET,POST,OPTIONS';
    }
    let body;
    try { body = JSON.stringify(obj); }
    catch { code = 500; body = JSON.stringify({ error: 'unserialisable response' }); }
    if (res.writableEnded || res.headersSent) return;
    res.writeHead(code, headers);
    res.end(body);
  };

  const handle = (req, res) => {
    res.__req = req;
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, 'http://127.0.0.1');
    // the renderer probes this to find the host in its port range; it must answer without a token
    if (url.pathname === '/health') return send(res, 200, { ok: true, pid: process.pid });
    const READABLE = ['/snapshot', '/community', '/memory', '/client', '/browse', '/defaults', '/live', '/diag', '/brain'];
    const authed = req.headers['x-local-computer-token'] === token;
    // the app's own renderer may read without the token; a nonce is only ever minted for it,
    // so a tokenless caller can look but never act.
    // reads from the app are open; writes from the app still have to present a nonce, which every
    // mutation handler checks before it touches state.
    const fromApp = originOk(req) && (req.method !== 'GET' || READABLE.includes(url.pathname));
    if (!authed && url.pathname !== '/health' && !fromApp) {
      return send(res, 401, { error: 'bad token' });
    }
    if (url.pathname === '/snapshot') {
      const s = readState();
      return send(res, 200, {
        machineId: s.machineId,
        // explicit, not implied: absent means autonomous (the agent answers its own tickets);
        // false means it must wait for a human verdict on this page
        autonomy: s.autonomy === true,
        // a ticket leaves the queue as soon as the user has spoken on it (or it was spent)
        pending: (s.pending ?? []).filter(p => !p.consumed && !p.resolved).map(p => ({
          approvalId: p.approvalId, action: p.action, createdAt: p.createdAt, args: p.args,
          granted: !!p.granted, resolved: p.resolved ?? null, resolvedBy: p.resolvedBy ?? null,
        })),
        permissions: s.permissions ?? {},
        grants: s.grants ?? {},
        // same cap as the MCP half, so the page and computer_status can never disagree
        audit: (s.audit ?? []).slice(-500).reverse(),
        allowedRoots: READ_ROOTS,
        nonce: trustedCaller(req) ? mintNonce() : null,
      });
    }
    if (url.pathname === '/browse') {
      const target = url.searchParams.get('path') || READ_ROOTS[1];
      if (!insideRead(target)) return send(res, 403, { error: 'outside allowed roots' });
      let entries;
      try {
        entries = fs.readdirSync(path.resolve(target), { withFileTypes: true })
          .filter(d => !d.name.startsWith('.git'))
          .slice(0, 400)
          .map(d => {
            const full = path.join(path.resolve(target), d.name);
            let size = null;
            try { size = d.isFile() ? fs.statSync(full).size : null; } catch { }
            return { name: d.name, dir: d.isDirectory(), size, path: full };
          })
          .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
      } catch (e) { return send(res, 200, { path: path.resolve(target), error: String(e.message), entries: [] }); }
      const resolved = path.resolve(target);
      const parent = insideRead(path.dirname(resolved)) ? path.dirname(resolved) : null;
      return send(res, 200, { path: resolved, parent, roots: READ_ROOTS, entries });
    }
    if (url.pathname === '/respond' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', () => {
        let j = {};
        try { j = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
        const bad = spendNonce(j.nonce);
        if (!bad && !authed && !trustedCaller(req)) return send(res, 401, { error: 'not the app' });
        if (bad) return send(res, 403, { error: bad, hint: 'verdicts must carry a nonce from the snapshot you are answering' });
        const s = readState();
        const item = s.pending.find(p => p.approvalId === j.approvalId);
        if (!item) return send(res, 404, { error: 'unknown approvalId' });
        if (!['allow-once', 'always', 'deny'].includes(j.verdict)) return send(res, 400, { error: 'bad verdict' });
        item.resolved = j.verdict; item.resolvedAt = new Date().toISOString();
        // who spoke: the page is the human, so an auditor can tell this apart from the agent
        // answering its own ticket through computer_respond (which writes 'agent')
        item.resolvedBy = 'user';
        if (j.verdict === 'allow-once') item.granted = true;
        if (j.verdict === 'always') s.permissions = { ...(s.permissions ?? {}), [item.action]: 'always' };
        s.audit = [...(s.audit ?? []), { kind: 'responded', at: item.resolvedAt, action: item.action, approvalId: item.approvalId, verdict: j.verdict, approvedBy: 'user', resolvedBy: 'user' }];
        writeStateAtomic(s);
        return send(res, 200, { ok: true });
      });
      return;
    }
    if (url.pathname === '/autonomy' && req.method === 'POST') {
      // The page switch for "may the agent answer its own tickets". Same gate as /respond: a
      // single-use nonce minted for the snapshot this page is answering, from the app origin only.
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', () => {
        let j = {};
        try { j = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
        const bad = spendNonce(j.nonce);
        if (!bad && !authed && !trustedCaller(req)) return send(res, 401, { error: 'not the app' });
        if (bad) return send(res, 403, { error: bad, hint: 'ask the page to re-sync, then press again' });
        if (typeof j.autonomy !== 'boolean') return send(res, 400, { error: 'bad autonomy' });
        const s = readState();
        s.autonomy = j.autonomy;
        // same 500-row cap the MCP half keeps, so neither side grows the ledger without bound
        s.audit = [...(s.audit ?? []), { kind: 'autonomy', at: new Date().toISOString(), autonomy: j.autonomy }].slice(-500);
        writeStateAtomic(s);
        return send(res, 200, { ok: true, autonomy: j.autonomy });
      });
      return;
    }
    if (url.pathname === '/revoke' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const j = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
        const bad = spendNonce(j.nonce);
        if (!bad && !authed && !trustedCaller(req)) return send(res, 401, { error: 'not the app' });
        if (bad) return send(res, 403, { error: bad });
        const s = readState();
        if (j.action && s.permissions?.[j.action]) { delete s.permissions[j.action]; }
        else s.pending = (s.pending ?? []).filter(p => p.approvalId !== j.approvalId);
        s.audit = [...(s.audit ?? []), { kind: 'revoked', at: new Date().toISOString(), action: j.action ?? null, approvalId: j.approvalId ?? null, approvedBy: 'user' }];
        writeStateAtomic(s);
        return send(res, 200, { ok: true });
      });
      return;
    }
    if (url.pathname === '/diag') {
      // the exact thing that used to kill the host was reaching ctx.agentCommunity. This route
      // proves that reach without changing a single bot, room, message or run.
      const svc = community();
      const out = { host: true, build: '2026-10-22.33', inject: 'agentCommunity,tools', service: !!svc };
      if (svc) {
        try { out.bots = typeof svc.listBots === 'function' ? svc.listBots().length : null; } catch { }
        try { out.rooms = typeof svc.listRooms === 'function' ? svc.listRooms().length : null; } catch { }
      }
      return send(res, 200, out);
    }
    if (url.pathname === '/defaults') {
      return send(res, 200, { model: profileDefaultModel() });
    }
    if (url.pathname === '/live') {
      // Approvals and questions never reach state.json: the service keeps them in memory and
      // pushes them to its own panel over the remote channel. This host half reads the same
      // in-memory ledger so the 世界 page can show and resolve them too. Everything is guarded:
      // if the service internals change, the page simply shows nothing instead of failing.
      const svc = community();
      const approvals = [];
      const questions = [];
      if (svc) {
        try {
          const byRoom = svc.ledger?.byRoom;
          if (byRoom && typeof byRoom.forEach === 'function') {
            byRoom.forEach((rows, roomId) => {
              for (const e of rows ?? []) {
                if (e.type === 'approval' && e.outcome == null) {
                  const raw = typeof e.args === 'string' ? e.args : (() => { try { return JSON.stringify(e.args ?? ''); } catch { return ''; } })();
                  approvals.push({
                    id: e.callId ?? e.id, roomId, memberName: e.botName ?? '', toolName: e.toolName ?? '',
                    reason: raw.slice(0, 300),
                    // 看全文 needs the real payload; bounded so one huge diff cannot eat the response
                    args: raw.slice(0, 4000), argsTruncated: raw.length > 4000,
                    // the page colours a card red only when it can name the damage
                    risk: /write|delete|remove|unlink|rename|move|patch|apply|exec|shell|bash|cover|overwrite/i.test(e.toolName + ' ' + raw)
                      ? 'irreversible' : 'reversible',
                    createdAt: e.at ?? '',
                  });
                }
                if (e.type === 'question' && e.status === 'pending') {
                  questions.push({
                    id: e.questionId ?? e.id, roomId, memberName: e.botName ?? '',
                    question: e.question ?? '', options: Array.isArray(e.options) ? e.options : [],
                    allowFreeText: e.allowFreeText !== false, createdAt: e.at ?? '',
                  });
                }
              }
            });
          }
        } catch { }
        // keep only entries that still have a live resolver waiting on the user
        try {
          const pend = svc.approvalBridge?.pending;
          if (pend && typeof pend.keys === 'function') {
            const live = new Set([...pend.keys()]);
            for (let i = approvals.length - 1; i >= 0; i--) if (!live.has(approvals[i].id)) approvals.splice(i, 1);
          }
        } catch { }
        try {
          const pend = svc.questionBridge?.pending;
          if (pend && typeof pend.keys === 'function') {
            const live = new Set([...pend.keys()]);
            for (let i = questions.length - 1; i >= 0; i--) if (!live.has(questions[i].id)) questions.splice(i, 1);
          }
        } catch { }
      }
      return send(res, 200, { approvals, questions });
    }
    if (url.pathname === '/community') {
      // Read-only view of the agent-community state that dsh itself owns. This endpoint never
      // writes that file: commanding the swarm goes through the community plugin's own tools,
      // so the 世界 page can watch without ever racing another writer.
      void ensurePrime().catch(() => { });
      const primeId = primeIdOf();
      const org = readState();
      const ranks = org.ranks ?? {};
      const domains = org.domains ?? {};
      const file = process.env.DSH_AGENT_COMMUNITY_STATE
        || path.join(os.homedir(), '.dsh', 'agent-community', 'state.json');
      let c;
      try { c = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (e) { return send(res, 200, { available: false, reason: String(e.message), file }); }
      const roomOf = (id) => c.rooms?.find(r => r.id === id);
      // unread is a view fact in the service's snapshot; derived here from the same inputs the
      // service keeps (per-room read cursor) so the badge cannot disagree with the transcript.
      // The cursor is an object `{ id, at }` — comparing it with String() made every badge 0.
      const readAt = c.roomReadAt ?? {};
      const readAtOf = (roomId) => { const v = readAt[roomId]; return v && typeof v === 'object' ? String(v.at ?? '') : String(v ?? ''); };
      const unreadFor = (roomId) => (c.messages ?? []).filter(m =>
        m.roomId === roomId && m.sender?.kind === 'bot' && String(m.createdAt) > readAtOf(roomId)).length;
      // the room objective is not in state.json at all: the service keeps it behind roomGoal()
      const svcLive = community();
      const goalOf = (roomId) => {
        try { const g = svcLive?.roomGoal?.(roomId); return g && typeof g.text === 'string' ? g.text : null; }
        catch { return null; }
      };
      return send(res, 200, {
        available: true, file, nonce: trustedCaller(req) ? mintNonce() : null,
        primeBotId: primeId,
        bots: (c.bots ?? []).map(b => ({
          id: b.id, name: b.name, description: b.description ?? '', avatar: b.avatar?.seed ?? '',
          provider: b.provider, model: b.model, reasoningEffort: b.reasoningEffort,
          mentionOnly: !!b.mentionOnly, permission: b.permission, protected: b.id === primeId,
          rank: b.id === primeId ? 'boss' : (ranks[b.id] || 'execution'),
          domain: b.id === primeId ? '全公司' : (domains[b.id] ?? ''),
          workspace: b.workspace, profileId: b.profile?.profileId ?? '', memoryNamespace: b.profile?.memoryNamespace ?? '',
          systemPrompt: stripNotes(b.systemPrompt ?? ''), createdAt: b.createdAt, updatedAt: b.updatedAt,
        })),
        rooms: (c.rooms ?? []).map(r => ({
          id: r.id, name: r.name, directBotId: r.directBotId ?? null, memberIds: r.memberIds ?? [],
          // `connection` is per-room transport state and reads "disconnected" for every room on
          // this machine — the page must never use it as "is the host there"; that is the probe's job.
          connection: r.connection ?? null, sequence: r.sequence ?? 0, updatedAt: r.updatedAt,
          objective: goalOf(r.id) ?? r.taskState?.objective ?? null,
          round: r.taskState?.round ?? 0, maxRounds: r.taskState?.maxRounds ?? 0,
          // RoomTaskAssignment is { id, botId, task, status, report } — not a subject/assignee pair
          assignments: (r.taskState?.assignments ?? []).map(a => ({
            id: a.id, botId: a.botId, task: a.task ?? a.subject ?? '', status: a.status ?? null,
            report: a.report?.text ?? a.report ?? null, reportAt: a.report?.at ?? null,
          })),
          finished: r.taskState?.finished?.report ?? null,
          team: r.team ? { leaderId: r.team.leaderId ?? null, role: r.team.role ?? null, members: r.team.members ?? [] } : null,
          notices: (r.notices ?? []).map(n => ({ id: n.id, text: n.text, at: n.at })),
          unread: unreadFor(r.id),
          readAt: readAtOf(r.id) || null,
          last: ((m => (typeof m?.text === 'string' ? m.text.slice(0, 90) : ''))((c.messages ?? []).filter(m => m.roomId === r.id).slice(-1)[0])),
        })),
        tasks: (c.rooms ?? []).flatMap(r => (r.taskState?.assignments ?? []).map(a => ({
          roomId: r.id, roomName: r.name, id: a.id, botId: a.botId, task: a.task ?? a.subject ?? '',
          status: a.status ?? null, report: a.report?.text ?? null,
        }))),
        // only surfaced when the host really keeps them here; the live snapshot() is authoritative
        // the group proposal lives on the room itself (`pendingGroupProposal`), not at the top
        proposals: (() => {
          const all = [
            ...(c.proposals ?? c.pendingGroupProposals ?? []),
            ...(c.rooms ?? []).map(r => r.pendingGroupProposal).filter(p => p && p.status === 'pending'
              && (!p.expiresAt || Date.parse(p.expiresAt) > Date.now())).map(p => ({
                id: p.id, roomId: p.roomId, name: p.name, memberIds: p.memberIds ?? [],
                leaderId: p.leaderId ?? null, reason: p.reason ?? '', taskText: p.taskText ?? '',
                createdAt: p.createdAt, expiresAt: p.expiresAt ?? null,
              })),
          ];
          const seen = new Set();
          return all.filter(p => p && p.id && !seen.has(p.id) && seen.add(p.id));
        })(),
        approvals: c.approvals ?? (c.rooms ?? []).flatMap(r => r.team?.approvals ?? []),
        memories: (c.botMemories ?? []).slice(-60),
        schedules: (c.botSchedules ?? []).length,
        // `deliverables` (not `attachments`) is where a turn's files actually live, and
        // `runId`/`durationMs` are what tie a receipt back to its bubble. `toolActivity` details
        // are raw tool output and can be tens of KB, so only name+status travel to the page.
        messages: (c.messages ?? []).slice(-160).map(m => ({
          id: m.id, roomId: m.roomId, roomName: roomOf(m.roomId)?.name ?? '', text: m.text,
          sender: m.sender, mentions: m.mentions ?? [], createdAt: m.createdAt,
          attachments: m.attachments ?? [], streaming: m.streaming ?? false,
          runId: m.runId ?? null, durationMs: m.durationMs ?? null,
          kind: m.kind ?? null, targetNames: m.targetNames ?? [],
          deliverables: (m.deliverables ?? []).map(d => ({
            path: d.path, name: d.name ?? String(d.path || '').split(/[\\/]/).pop(),
            description: d.description ?? '', size: d.size ?? null,
          })),
          toolActivity: (m.toolActivity ?? []).slice(-12).map(t => ({
            name: t.name ?? '', status: t.status ?? '', detail: String(t.detail ?? '').slice(0, 160),
          })),
        })),
        runs: (c.runs ?? []).slice(-40).map(r => ({
          id: r.id, botId: r.botId, roomId: r.roomId, origin: r.origin, prompt: (r.prompt ?? '').slice(0, 140),
          sessionId: r.sessionId ?? null,
          status: r.status, attempt: r.attempt, maxAttempts: r.maxAttempts, startedAt: r.startedAt,
          // runs carry no durationMs of their own; the page shows elapsed while live, so compute it
          durationMs: r.startedAt && r.finishedAt && Date.parse(r.finishedAt) >= Date.parse(r.startedAt)
            ? Date.parse(r.finishedAt) - Date.parse(r.startedAt) : null,
          finishedAt: r.finishedAt, lastHeartbeatAt: r.lastHeartbeatAt, running: ['queued','claimed','running','summarizing'].includes(String(r.status||'').toLowerCase()) && !r.finishedAt && (!r.leaseExpiresAt || Date.parse(r.leaseExpiresAt) > Date.now()),
          // controlRevision is the optimistic-concurrency token run control must echo back
          controlRevision: r.controlRevision ?? 0,
        })),
        mailbox: (c.mailbox ?? []).slice(-40), botMemories: (c.botMemories ?? []).length,
        botSchedules: (c.botSchedules ?? []).length,
      });
    }
    if (url.pathname === '/act' && req.method === 'POST') {
      // The swarm is commanded through agent-community's own service, never by writing its state
      // file: it keeps a save queue, a sequence per room and a writes-blocked flag we would race.
      let body = '';
      req.on('data', c => { body += c; if (body.length > 2e5) req.destroy(); });
      req.on('end', async () => {
        let j = {};
        try {
        try { j = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
        const bad = spendNonce(j.nonce);
        if (!bad && !authed && !trustedCaller(req)) return send(res, 401, { error: 'not the app' });
        if (bad) return send(res, 403, { error: bad, hint: 'ask the page to re-sync, then press again' });
        const svc = community?.();
        if (!svc) return send(res, 503, { error: 'agent-community service is not loaded in this profile' });
        // explicit allowlist: the page may call these and nothing else on the community service
        const METHODS = {
          createBot: 'createBot', updateBot: 'updateBot', deleteBot: 'deleteBot',
          createRoom: 'createRoom', updateRoom: 'updateRoom', deleteRoom: 'deleteRoom', archiveRoom: 'archiveRoom',
          sendMessage: 'sendMessage', postTeamMessage: 'postTeamMessage', clearMessages: 'clearMessages',
          assignTasks: 'assignTasks', decomposeTasks: 'decomposeTasks', setRoomGoal: 'setRoomGoal',
          proposeGroup: 'proposeGroup', confirmGroup: 'confirmGroup', declineGroup: 'declineGroup',
          controlRun: 'controlRun', retryRun: 'retryRun', markRoomRead: 'markRoomRead',
          inviteBot: 'inviteBot', dmBot: 'dmBot', dismissTeam: 'dismissTeam',
          approveBotToolCall: 'approveBotToolCall', answerBotQuestion: 'answerBotQuestion', teamOverview: 'teamOverview',
        };
        const m = METHODS[j.kind];
        if (!m || typeof svc[m] !== 'function') return send(res, 400, { error: 'unknown action: ' + j.kind });
        try {
          // most methods take a request object; clearMessages takes the room id itself
          let arg = m === 'clearMessages' ? (j.payload && j.payload.roomId) : { ...(j.payload ?? {}) };
          // approveBotToolCall is the one positional method on the service — (callId, outcome) — and
          // it answers synchronously with void. Handing it an object silently did nothing.
          if (m === 'approveBotToolCall') {
            const callId = arg.callId ?? arg.id;
            if (!callId) return send(res, 400, { error: 'approveBotToolCall needs callId' });
            const wanted = String(arg.outcome ?? arg.verdict ?? '');
            // the service only knows allowed-once / rejected: there is no standing grant here
            const outcome = /reject|deny|no/i.test(wanted) ? 'rejected' : 'allowed-once';
            svc.approveBotToolCall(callId, outcome);
            return send(res, 200, {
              ok: true, kind: j.kind, outcome,
              note: /always/i.test(wanted) ? '团队审批没有「总是允许」，这次只放行了当前这一条' : undefined,
            });
          }
          if (m === 'createBot') {
            // the form no longer has to know the profile's model: fill the declared default when
            // the caller omitted it, otherwise the new bot is born unable to run
            const d = profileDefaultModel();
            if (d) {
              if (arg.provider == null) arg.provider = d.provider;
              if (arg.model == null) arg.model = d.model;
              if (arg.reasoningEffort == null && d.reasoningEffort != null) arg.reasoningEffort = d.reasoningEffort;
            }
          }
          // rank/domain are ours, not agent-community's: pull them out of the request so the
          // service never sees an unknown field, then persist them after it accepts the rest.
          const sideRank = m === 'updateBot' ? arg.rank : undefined;
          const sideDomain = m === 'updateBot' ? arg.domain : undefined;
          if (m === 'updateBot') { delete arg.rank; delete arg.domain; }
          const out = m === 'createBot'
            // the human creating from the 世界 UI is one of the two sanctioned writers
            ? await createAuth.run({ via: 'user' }, () => svc.createBot(arg))
            : await svc[m](arg);
          if (sideRank !== undefined || sideDomain !== undefined) {
            applyRankDomain(arg.id, { rank: sideRank, domain: sideDomain });
          }
          // deliberately not echoing `out`: a Typert result can hold circular refs, and a throw
          // while a response is half-written takes the whole host process down.
          void out;
          return send(res, 200, { ok: true, kind: j.kind });
        } catch (e) {
          return send(res, 422, { error: String(e?.message || e), kind: j.kind });
        }
        } catch (e) {
          // an error outside the service call still must not reject this async listener: an
          // unhandled rejection used to be fatal for the whole dsh process
          writeCrash('act', e);
          try { send(res, 500, { error: 'internal', kind: j.kind }); } catch { }
        }
      });
      return;
    }
    if (url.pathname === '/brain') {
      const brain = readBrain();
      if (req.method === 'GET') {
        return send(res, 200, {
          available: true, nonce: trustedCaller(req) ? mintNonce() : null,
          entries: brain.entries, ledger: ledgerFor(brain, { limit: 60 }),
        });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      // the user writing in the page is the one author that needs no asking: same nonce gate as
      // every other write, but a verdict here outranks anything a bot proposed
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', async () => {
        try {
          const j = JSON.parse(body || '{}');
          const bad = spendNonce(j.nonce);
          if (!bad && !authed && !trustedCaller(req)) return send(res, 401, { error: 'not the app' });
          if (bad) return send(res, 403, { error: bad });
          const b = readBrain();
          const svc = community();
          if (j.op === 'add') {
            if (!j.botId || !String(j.text || '').trim()) return send(res, 400, { error: 'botId 和 text 都要给' });
            const e = noteAdd(b, {
              botId: j.botId, botName: (svc?.listBots?.() ?? []).find(x => x.id === j.botId)?.name ?? '',
              text: j.text, kind: j.kind === 'log' ? 'log' : 'rule', tags: j.tags ?? [],
              scope: j.scope === 'team' ? 'team' : 'bot', about: j.about || null, expires: j.expires || null, by: 'user',
            });
            writeBrain(b); void syncNotes(svc);
            return send(res, 200, { ok: true, id: e.id });
          }
          if (j.op === 'retire') {
            const e = retire(b, String(j.id || ''), { by: 'user', reason: j.reason || '用户在页面上线了', supersededBy: j.superseded_by || null });
            if (!e) return send(res, 400, { error: '没找到这条，或它已下线' });
            writeBrain(b); void syncNotes(svc);
            return send(res, 200, { ok: true, id: e.id });
          }
          if (j.op === 'integrate') {
            const e = integrate(b, { ids: (j.ids ?? []).map(String), text: j.text, action: 'fuse', reason: j.reason || '用户在页面上整合', by: 'user' });
            if (!e) return send(res, 400, { error: 'target ids 里没有匹配条目' });
            writeBrain(b); void syncNotes(svc);
            return send(res, 200, { ok: true, id: e.id });
          }
          return send(res, 400, { error: 'unknown op: ' + j.op });
        } catch (e) {
          writeCrash('brain', e);
          try { send(res, 500, { error: 'internal' }); } catch { }
        }
      });
      return;
    }
    if (url.pathname === '/memory') {
      const vault = resolveVault();
      if (!vault) return send(res, 200, { available: false, reason: 'no vault configured (set DSH_OBSIDIAN_VAULT)' });
      const snap = communitySnapshot();
      if (!snap) return send(res, 200, { available: false, reason: 'community state unreadable', vault });
      const diff = diffPlan(planWrites(vault, snap));
      const byId = Object.fromEntries(snap.bots.map(b => [b.id, b]));
      return send(res, 200, {
        available: true, vault, nonce: trustedCaller(req) ? mintNonce() : null,
        pending: diff.filter(d => d.action !== 'unchanged').map(d => ({ path: d.path, action: d.action })),
        // which notes belong to which bot, so the page can link them without duplicating the slug rule
        paths: Object.fromEntries(snap.bots.map(b => [b.id, `Bots/${b.name}`])),
        memories: (snap.memories ?? []).map(m => ({ botId: m.botId, botName: byId[m.botId]?.name ?? null, kind: m.kind, text: m.text, at: m.at })),
        total: diff.length, bots: snap.bots.length,
      });
    }
    if (url.pathname === '/memory/sync' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const j = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
        const bad = spendNonce(j.nonce);
        if (!bad && !authed && !trustedCaller(req)) return send(res, 401, { error: 'not the app' });
        if (bad) return send(res, 403, { error: bad });
        const vault = resolveVault();
        const snap = communitySnapshot();
        if (!vault || !snap) return send(res, 503, { error: 'vault or community state unavailable' });
        const out = applyPlan(planWrites(vault, snap), { vaultRoot: vault, dryRun: !!j.dryRun });
        if (!j.dryRun && !out.some(o => o.action === 'refused-outside-bots')) {
          brainDirty = false; brainMirroredAt = Date.now();
        }
        return send(res, 200, {
          ok: true, vault, dryRun: !!j.dryRun,
          created: out.filter(o => o.action === 'create').length,
          updated: out.filter(o => o.action === 'update').length,
          unchanged: out.filter(o => o.action === 'unchanged').length,
          refused: out.filter(o => o.action === 'refused-outside-bots').length,
          files: out.map(o => o.path),
        });
      });
      return;
    }
    if (url.pathname === '/client-hello' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 2e4) req.destroy(); });
      req.on('end', () => {
        let j = {};
        try { j = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
        try {
          // merge, so the mount report (slots) and the paint report (rendered) both survive
          let prev = {};
          try { prev = JSON.parse(fs.readFileSync(CLIENT_STATUS_FILE, 'utf8')); } catch { }
          fs.writeFileSync(CLIENT_STATUS_FILE, JSON.stringify({ ...prev, ...j }, null, 2));
        } catch { }
        return send(res, 200, { ok: true });
      });
      return;
    }
    if (url.pathname === '/client') {
      try { return send(res, 200, JSON.parse(fs.readFileSync(CLIENT_STATUS_FILE, 'utf8'))); }
      catch { return send(res, 200, { reported: false }); }
    }
    return send(res, 404, { error: 'no such endpoint' });
  };

  // logger is read the same optional way; a listen callback is outside every request try/catch,
  // so an undeclared-service throw here would end the host during startup
  const log = (level, ...args) => {
    try {
      const l = typeof ctx?.get === 'function' ? ctx.get('logger') : ctx?.logger;
      if (l && typeof l[level] === 'function') l[level](...args);
    } catch { }
  };
  // Say it out loud when the gate is weak: without DSH_WEB_URL any page on any loopback port is
  // treated as the app, which is exactly the hole this endpoint should not depend on.
  if (!WEB_ORIGIN) {
    const why = process.env.DSH_WEB_URL
      ? 'DSH_WEB_URL is set but is not a usable URL'
      : 'DSH_WEB_URL is not set';
    log('warn', 'local-computer: origin gate DEGRADED (any loopback port is trusted, ' + why
      + '); set DSH_WEB_URL to the Web GUI URL to accept only that origin');
  }

  const server = http.createServer((req, res) => {
    // a synchronous throw in any route would otherwise surface as an uncaught exception and end
    // the host process; fail this one request instead and leave the evidence in crash.log
    try { handle(req, res); }
    catch (e) {
      writeCrash('http', e);
      try { send(res, 500, { error: 'internal', detail: String((e && e.message) || e) }); } catch { }
    }
  });

  const publish = () => {
    const addr = server.address();
    const info = { url: `http://127.0.0.1:${addr.port}`, token, port: addr.port, pid: process.pid, startedAt: new Date().toISOString() };
    fs.writeFileSync(ENDPOINT_FILE, JSON.stringify(info, null, 2), { mode: 0o600 });
    started.push(info);
    log("info", `local-computer: UI endpoint up on loopback :${addr.port}`);
  };
  server.unref();
  // Walk the range so one busy port cannot orphan the page; only if the whole range is taken do we
  // fall back to an ephemeral one (the page then honestly reports it cannot reach us).
  const listenAt = (i) => {
    if (i >= PORT_RANGE.length) return server.listen(0, '127.0.0.1', publish);
    server.once('error', (e) => {
      if (e && e.code === 'EADDRINUSE') listenAt(i + 1);
      else log("error", e);
    });
    server.listen(PORT_RANGE[i], '127.0.0.1', publish);
  };
  listenAt(0);

  // Backups run on a coarse timer rather than per write: a bot writing ten rules should not
  // produce thirty file writes in the vault.
  const brainTimer = setInterval(() => {
    if (!brainDirty) return;
    if (Date.now() - brainMirroredAt < BRAIN_MIRROR_MS) return;
    mirrorBrainNow('scheduled', message => log('info', message));
  }, BRAIN_MIRROR_TICK_MS);
  try { brainTimer.unref?.(); } catch { }

  return () => {
    try { clearInterval(brainTimer); } catch { }
    for (const d of toolDisposers) { try { d?.(); } catch { } }
    try { server.close(); server.closeAllConnections?.(); } catch { }
    try { fs.rmSync(ENDPOINT_FILE, { force: true }); } catch { }
  };
}
