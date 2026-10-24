// 能力：笔记本 —— 每个 bot 的外置记忆与规则本。
// 纯逻辑在 ./rules.mjs（从旧 core/brain.mjs + core/obsidian.mjs 合并而来，行为不变）；
// 这里只做三件事：注册 brain_* 工具、把现行规则注入 bot 的系统提示、按粗粒度定时器
// 把本子镜像到 Obsidian。json 本子是真相之源，Obsidian 只是备份，坏了不阻塞任何写入。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadBrain, saveBrain, emptyBrain, add as noteAdd, recall, findConflicts,
  retire, integrate, ledgerFor, ACTIONS, stripNotes, notesBlock,
  planWrites, diffPlan, applyPlan, botDir,
} from './rules.mjs';
import { INBOX_HINT, parseInbox, consumeInbox, rejectBlock } from './inbox.mjs';

const BRAIN_MIRROR_MS = 8 * 60 * 60 * 1000;    // 一天三遍，够了
const BRAIN_MIRROR_TICK_MS = 10 * 60 * 1000;   // 粗粒度唤醒，干净时开销可忽略

export function register(rt) {
  const BRAIN_FILE = rt.stateFile('brain.json');
  const readBrain = () => { try { return loadBrain(BRAIN_FILE); } catch { return emptyBrain(); } };
  const writeBrain = (b) => {
    try { saveBrain(BRAIN_FILE, b); brainDirty = true; }
    catch (e) { rt.crash('brain-save', e); }
  };
  // 宿主停机期间本子可能变过：挂载即视为脏，镜像定时器会把第一遍补上。
  let brainDirty = true;
  let brainMirroredAt = 0;

  const COMMUNITY_FILE = process.env.DSH_AGENT_COMMUNITY_STATE
    || path.join(os.homedir(), '.dsh', 'agent-community', 'state.json');

  // vault 是 dsh-obsidian 指向的那一个；不知道就退回 Obsidian 当前打开的那个。
  // 永不凭空捏造，环境变量可覆盖。
  const resolveVault = () => {
    if (process.env.DSH_OBSIDIAN_VAULT) return process.env.DSH_OBSIDIAN_VAULT;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'AppData', 'Roaming', 'obsidian', 'obsidian.json'), 'utf8'));
      const vs = Object.values(cfg.vaults ?? {});
      return (vs.find(v => v.open) ?? vs[0])?.path ?? null;
    } catch { return null; }
  };

  // agent-community 状态的只读投影：镜像与快照都从这里来，本插件从不写那个文件。
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

  // 镜像失败绝不能传进 bot 的回合：记下来，保持脏，等下一个窗口。
  function mirrorBrainNow(reason) {
    if (!brainDirty) return { ok: true, skipped: 'clean' };
    const vault = resolveVault();
    if (!vault) return { ok: false, skipped: 'no-vault' };
    const snap = communitySnapshot();
    if (!snap) return { ok: false, skipped: 'no-community' };
    try {
      const out = applyPlan(planWrites(vault, snap), { vaultRoot: vault });
      brainDirty = false;
      brainMirroredAt = Date.now();
      const created = out.filter(o => o.action === 'create').length;
      const updated = out.filter(o => o.action === 'update').length;
      rt.log('info', 'local-computer: brain mirror (' + reason + ') create=' + created + ' update=' + updated);
      return { ok: true, created, updated };
    } catch (e) {
      rt.crash('brain-mirror', e);
      return { ok: false, reason: String((e && e.message) || e) };
    }
  }

  // 把每个 bot 的现行规则推进它的 instructions，但只在渲染结果真变了的时候：
  // 每次轮询都裸重写会碰所有 bot 记录，把 updatedAt 搅得全是噪声。
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
    } catch (e) { rt.crash('notes-sync', e); }
  }

  // 备份跑在粗定时器上而不是每次写都跑：bot 连写十条规矩不该产生三十次 vault 写入。
  rt.interval(BRAIN_MIRROR_TICK_MS, () => {
    if (!brainDirty) return;
    if (Date.now() - brainMirroredAt < BRAIN_MIRROR_MS) return;
    mirrorBrainNow('scheduled');
  });

  // org 任命后把一条流水记进团队账本（跨能力只走事件，不碰对方的账本文件）。
  rt.on('team-ledger', (row) => {
    try {
      const b = readBrain();
      noteAdd(b, { ...row, text: String(row.text ?? '').slice(0, 500) });
      writeBrain(b); void syncNotes(rt.community());
    } catch (e) { rt.crash('team-ledger', e); }
  });

  const botNameOf = (botId) => {
    try { return (rt.community()?.listBots?.() ?? []).find(b => b.id === botId)?.name ?? ''; } catch { return ''; }
  };
  // 等级归 org 能力管；org 缺席时一律按非总理处理（fail-closed：团队那本谁也写不了）。
  const rankOf = async (botId) => (await rt.request('rank-of', botId)) ?? 'execution';

  const brief = (e) => ({
    id: e.id, text: e.text, kind: e.kind, tags: e.tags, scope: e.scope,
    writtenAt: e.writtenAt, aboutDate: e.aboutDate ?? null, expiresAt: e.expiresAt ?? null,
  });

  // ---- 工具：先看后写，绝不盲目追加 -----------------------------------------
  rt.tools.add({
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
        const c = rt.caller(exec);
        if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
        const hits = recall(readBrain(), {
          botId: c.botId, query: String(args.query ?? ''), tags: args.tags ?? [], limit: args.limit ?? 5,
          includeExpired: !!args.include_expired, includeRetired: !!args.include_retired,
        });
        return { ok: true, count: hits.length, hits: hits.map(h => ({ ...brief(h.entry), why: h.why })) };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
  });

  rt.tools.add({
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
        const c = rt.caller(exec);
        if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
        const b = readBrain();
        const e = noteAdd(b, {
          botId: c.botId, botName: botNameOf(c.botId), text: args.text, kind: 'log',
          tags: args.tags ?? [], about: args.about ?? null, expires: args.expires ?? null,
        });
        writeBrain(b); void syncNotes(rt.community());
        return { ok: true, entry: brief(e) };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
  });

  rt.tools.add({
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
        const c = rt.caller(exec);
        if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
        const text = String(args.text ?? '').trim();
        if (!text) return { ok: false, error: '要立的规矩是什么？' };
        if (args.scope === 'team' && (await rankOf(c.botId)) !== 'boss') {
          return { ok: false, error: '团队那本只有「总理」能写。你自己的本子照常写，或者把这条发给总理。' };
        }
        const b = readBrain();
        const ids = (args.target_ids ?? []).filter(x => typeof x === 'string');
        const conflicts = findConflicts(b, { botId: c.botId, text });
        // Bot 踩了团队那本是跨 bot 冲突，总理才是它的主人——所以要去公司大群里知会，
        // 而不是只写进这一次的返回值。
        const teamClash = conflicts.find(x => x.entry.scope === 'team');
        if (teamClash && (await rankOf(c.botId)) !== 'boss') {
          try {
            const svc = rt.community();
            const primeBotId = (await rt.request('prime-id')) ?? null;
            const me = botNameOf(c.botId);
            // 公司大群按名字找（房间 id 在 org 的账里）；找不到就不打扰，只留本子层面的痕迹
            const cid = (svc?.listRooms?.() ?? []).find(r => r.name === '公司大群')?.id ?? null;
            if (svc?.postTeamMessage && primeBotId && cid) {
              await svc.postTeamMessage({
                roomId: cid,
                sender: { kind: 'bot', botId: c.botId, name: me },
                text: '@总理 ' + me + ' 想立一条规矩，和团队那本里的这条撞了：「' + teamClash.entry.text.slice(0, 60) + '」。要立的：「' + text.slice(0, 60) + '」。请裁定谁生效。',
                kind: 'conflict', targetNames: [botNameOf(primeBotId) || '总理'], targetBotIds: [], origin: 'a2a',
              });
              if (svc?.queueRoomRun) {
                svc.queueRoomRun(cid, primeBotId, '有一条跨 bot 规则冲突要你裁定，见本群最近一条 conflict 消息。', 'a2a');
                try { svc.executor?.nudge?.(); } catch { }
              }
            }
          } catch (e) { rt.crash('brain-conflict-report', e); }
        }
        if (!args.action) {
          if (!conflicts.length) {
            const e = noteAdd(b, { botId: c.botId, botName: botNameOf(c.botId), text, kind: 'rule', tags: args.tags ?? [], scope: args.scope ?? 'bot', about: args.about ?? null, expires: args.expires ?? null });
            writeBrain(b); void syncNotes(rt.community());
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
          writeBrain(b); void syncNotes(rt.community());
          return { ok: true, action: 'embed', entry: brief(e), kept: ids };
        }
        if (!ids.length) return { ok: false, error: `${args.action} 需要 target_ids：要处理哪几条旧条目。` };
        if (args.action === 'retire') {
          const done = ids.map(id => retire(b, id, { reason: args.reason ?? '被新规矩取代' })).filter(Boolean).length;
          const e = noteAdd(b, { ...who, text, kind: 'rule', tags: args.tags ?? [], scope: args.scope ?? 'bot', about: args.about ?? null, expires: args.expires ?? null });
          writeBrain(b); void syncNotes(rt.community());
          return { ok: true, action: 'retire', retired: done, entry: brief(e) };
        }
        const merged = integrate(b, { ids, text, action: args.action, reason: args.reason ?? '', tags: args.tags ?? [], about: args.about ?? null, expires: args.expires ?? null });
        if (!merged) return { ok: false, error: 'target_ids 里没有匹配的条目。' };
        writeBrain(b); void syncNotes(rt.community());
        return { ok: true, action: args.action, entry: brief(merged), mergedFrom: merged.mergedFrom };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
  });

  rt.tools.add({
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
        const c = rt.caller(exec);
        if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
        const b = readBrain();
        const target = b.entries.find(e => e.id === args.entry_id);
        if (!target) return { ok: false, error: '这条不存在。' };
        if (target.botId !== c.botId && target.scope !== 'team') return { ok: false, error: '只能下线你自己写的条目。' };
        if (target.scope === 'team' && (await rankOf(c.botId)) !== 'boss') return { ok: false, error: '团队那本只有总理能改。' };
        const e = retire(b, args.entry_id, { reason: args.reason ?? '', supersededBy: args.superseded_by ?? null });
        if (!e) return { ok: false, error: '这条已经下线过了。' };
        writeBrain(b); void syncNotes(rt.community());
        return { ok: true, entry: brief(e) };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
  });

  rt.tools.add({
    name: 'brain_ledger',
    description: '查你这本账的改动记录：什么时候新增/嵌入/整合/下线了什么、为什么。规则丢了能从这儿查回来。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { limit: { type: 'number', description: '最多返回几条，默认 20' } },
      required: [],
    },
    async execute(args, exec) {
      try {
        const c = rt.caller(exec);
        if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
        const b = readBrain();
        return { ok: true, rows: ledgerFor(b, { botId: c.botId, limit: args.limit ?? 20 }) };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
  });

  // ---- 收件箱：Obsidian 双向同步的"进"方向 ----------------------------------
  // 用户在 vault 的 Bots/<bot>/收件箱.md 里一行一条写规矩，这里轮询收割：
  // 走 consumeInbox 的查冲突流程；成功的立即镜像回 规则.md，被拒的退到 收件箱-退回.md。
  // 收件箱文件永远归用户所有——镜像（planWrites/applyPlan）从不写它。
  const INBOX_POLL_MS = 15_000;
  const INBOX_NAME = '收件箱.md';
  const REJECT_NAME = '收件箱-退回.md';
  const TEAM_INBOX = '_团队收件箱.md';
  const inboxStore = rt.state('brain-inbox');
  const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

  async function scanInboxes(reason = 'poll') {
    try {
      const vault = resolveVault();
      if (!vault) return;
      const snap = communitySnapshot();
      if (!snap) return;
      const primeId = (await rt.request('prime-id')) ?? 'user';
      const seen = inboxStore.load() ?? {};
      const wanted = new Set();
      const jobs = snap.bots.map(bot => ({
        file: path.join(vault, botDir(bot.name), INBOX_NAME),
        scope: 'bot', botId: bot.id, botName: bot.name,
      }));
      jobs.push({ file: path.join(vault, 'Bots', TEAM_INBOX), scope: 'team', botId: primeId, botName: '团队' });

      let brain = readBrain();
      let added = 0;
      for (const job of jobs) {
        wanted.add(job.file);
        let content;
        try { content = fs.readFileSync(job.file, 'utf8'); }
        catch {
          // 还没有收件箱就播种一份带说明的空文件；之后它完全归用户
          try {
            fs.mkdirSync(path.dirname(job.file), { recursive: true });
            fs.writeFileSync(job.file, INBOX_HINT, 'utf8');
            seen[job.file] = sha1(INBOX_HINT);
          } catch { }
          continue;
        }
        const hash = sha1(content);
        if (seen[job.file] === hash) continue;          // 没变，别打扰
        const lines = parseInbox(content);
        if (!lines.length) { seen[job.file] = hash; continue; }
        const res = consumeInbox(brain, { ...job, lines });
        added += res.added.length;
        if (res.rejected.length) {
          try {
            fs.mkdirSync(path.dirname(job.file), { recursive: true });
            fs.appendFileSync(path.join(path.dirname(job.file), REJECT_NAME), rejectBlock(res.rejected) + '\n', 'utf8');
          } catch (e) { rt.crash('inbox-reject', e); }
        }
        // 清空收件箱（保留说明头）。若在读取与写回之间用户又改了文件（哈希对不上），
        // 这轮放弃清空，下一轮会重新收割那部分——绝不吞掉用户正在打的字。
        const after = INBOX_HINT;
        try {
          const nowHash = sha1(fs.readFileSync(job.file, 'utf8'));
          if (nowHash === hash) {
            fs.writeFileSync(job.file, after, 'utf8');
            seen[job.file] = sha1(after);
          }
        } catch (e) { rt.crash('inbox-writeback', e); }
      }
      for (const k of Object.keys(seen)) if (!wanted.has(k)) delete seen[k];
      inboxStore.save(seen);
      if (added > 0) {
        writeBrain(brain);
        void syncNotes(rt.community());
        mirrorBrainNow(reason);                        // 立即镜像：几秒内 规则.md 就能看到新规矩
      }
    } catch (e) { rt.crash('brain-inbox', e); }
  }
  void scanInboxes('mount');
  rt.interval(INBOX_POLL_MS, () => void scanInboxes());

  return {
    scanInboxes,                                        // 测试与排障入口
    dispose() { },
  };
}
