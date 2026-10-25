// 能力：组织 —— 总理、公司大群与等级制。
//
// 规则（原样沿自旧版，经真机验证）：
//   - 只有「总理」可以新建 Bot；守卫做在服务层（patch agentCommunity），不是写在提示词里。
//   - 总理由首次使用时创建，受删除保护；模型一律跟随 profile 的 agent-default-model。
//   - 等级（direction/officer/execution）与负责范围是本插件自己的账，不依赖服务字段，
//     服务重置不会悄悄降级任何人；总理不可被任命或降级。
//   - 一个公司大群容纳全部名册，总理任 leader，新成员自动进群。
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

const PRIME_NAME = '总理';
const COMPANY_NAME = '公司大群';
const PRIME_PROMPT = `你是这个团队的「总理」，所有 Bot 的管理者，也是团队里唯一可以新建 Bot 的角色。整个团队在一个叫「公司大群」的群里办公，你是这个群的 leader。

你的职责：
1. 维护 Bot 名册：谁负责什么、能力边界、当前是否在忙。用户问起团队情况时，先用一两句话概括名册。
2. 处理增员申请：申请会以「@总理 申请新建 Bot」的形式出现在「公司大群」里，内容包含申请人、需要的能力、为什么现有 Bot 不够、建议的名字与职责。先看名册，能复用现有 Bot 就复用；确实需要新能力时才批准。批准时直接在这个大群里用 spawn_bot 新建，并且必须加 collaborate: true，让新 Bot 自动进入公司大群；description 写清它的身份与专长，instructions 写清它每轮都要遵守的规矩，reason 写一句给用户看的理由。
3. 新建成功后，在公司大群回复：新 Bot 的名字、职责，以及申请人接下来怎么找它（用 dm_bot 或直接在群里 @ 它）；同时向用户说明建了谁、为什么。
4. 你不能调用 agent_community_create_bot（这条路径对 Bot 已关闭）；新建 Bot 一律用 spawn_bot。
5. 公司等级从高到低：总理（你）> 管方向（拆任务、派活、控运行）> 小官（独管一个具体领域，例如「生活」「工作」）> 组长（最底层干活，只执行别人派的任务）。派活前先用 org_roster 看每个人的等级和负责范围，把任务给对的人；「小官」和「组长」没有管理权，不要让他们去控制别人。
6. 定级归你：用 org_appoint(bot, rank, domain, reason) 任命或调整某个 Bot，任命会自动在公司大群公告并记进团队账本。你自己不能被改级；觉得某人该升职或降级就直说，别绕。
7. 不要删除其他 Bot，除非用户明确要求，并且先确认它没有正在进行的任务。
8. 你拥有全部权限：可以用 org_plan 设目标、拆任务、派活，用 org_control 取消/转向/重试运行；其他 Bot 的等级限制不适用于你。
8b. 建 Bot 只有一种方式：spawn_bot（总理专用章）。收到增员申请并批准后，用 spawn_bot 正式建人。不要用 spawn_teammate / team_* 官方工具建人——那是主会话的体系，在本房间会被拒绝。
9. 回复简洁、结论先行；不替用户做未经确认的高风险决定。`;

const RANK_NAME = { boss: '总理', direction: '管方向', officer: '小官', execution: '组长' };
const RANKS = ['direction', 'officer', 'execution'];

export function register(rt) {
  const orgStore = rt.state('org');
  const emptyOrg = () => ({ primeBotId: null, companyRoomId: null, ranks: {}, domains: {} });

  const readOrg = () => {
    const o = orgStore.load();
    if (!o || typeof o !== 'object') return emptyOrg();
    return { ...emptyOrg(), ...o, ranks: o.ranks ?? {}, domains: o.domains ?? {} };
  };
  const writeOrg = (o) => { try { orgStore.save(o); } catch (e) { rt.crash('org-save', e); } };

  // 一次性迁移：旧版把组织字段（primeBotId/companyRoomId/ranks/domains）和执行账本混在
  // 同一个 computer.json 里，现在组织账单独放 org.json。迁移前留 .pre-org-migration 底。
  function migrateFromLegacy() {
    try {
      const cur = orgStore.load();
      if (cur?.primeBotId) return;                       // 已迁移
      const legacyFile = rt.stateFile('computer.json');
      let legacy;
      try { legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8')); } catch { return; }
      const picked = {};
      for (const k of ['primeBotId', 'companyRoomId', 'ranks', 'domains']) {
        if (legacy[k] !== undefined) picked[k] = legacy[k];
      }
      if (!Object.keys(picked).length) return;
      try { fs.copyFileSync(legacyFile, legacyFile + '.pre-org-migration'); } catch { }
      const cleaned = { ...legacy };
      for (const k of Object.keys(picked)) delete cleaned[k];
      rt.state('computer').save(cleaned);
      orgStore.save({ ...emptyOrg(), ...picked, ...(cur ?? {}) });
      rt.log('info', 'local-computer: org state migrated from legacy computer.json');
    } catch (e) { rt.crash('org-migrate', e); }
  }
  migrateFromLegacy();

  // ---- 服务层守卫 -----------------------------------------------------------
  // 一次性授权：只有总理的 spawn 和（将来）前端以授权上下文发起的创建能通过 createBot。
  const createAuth = new AsyncLocalStorage();
  const rawCreate = new WeakMap();
  // 真身 createBot 的存放点。WeakMap 只认同一个对象，而 cordis 服务代理在不同调用点
  // 可能给出不同包装：补丁拿到的 svc 与 ensurePrime 拿到的 svc 不是同一个对象时，
  // rawCreate.get() 取不到真身，就会退回去调用被守卫包住的 createBot（总理因此永远建
  // 不出来）。真身同时写到服务上的 Symbol，任何包装都能取回。
  const RAW_CREATE = Symbol.for('dsh-local-computer.org.rawCreateBot');
  const trueCreate = (svc) => {
    try { if (typeof svc[RAW_CREATE] === 'function') return svc[RAW_CREATE]; } catch { }
    const viaMap = rawCreate.get(svc);
    return typeof viaMap === 'function' ? viaMap : null;
  };

  const primeIdOf = () => { try { return readOrg().primeBotId ?? null; } catch { return null; } };
  // 拒绝话术本身是指引：调用方必须能拿着它行动（dm_bot 的目标/文本就这两个字段）。
  const askPrimeMsg = (pid) => '只有「总理」可以新建 Bot。不要自己创建；请用 apply_new_bot 工具提交申请'
    + '（name=建议名字，need=需要什么能力，why=为什么现有 Bot 不够，description=职责），'
    + '它会把申请发到「公司大群」并 @总理。也可以直接在「公司大群」里 @总理 说明需求。'
    + (pid ? `总理 id: ${pid.slice(0, 8)}。` : '') + '总理批准后会创建并把新 Bot 拉进公司大群。';

  rt.communityPatch((svc) => {
    if (typeof svc.createBot === 'function') {
      // 重复应用（插件重载）时沿用第一次捕获的真身，只把守卫换成当前实例的——
      // 守卫里读的 createAuth 因此永远是活着的那个实例。
      let orig = trueCreate(svc);
      if (!orig) {
        orig = svc.createBot.bind(svc);
        rawCreate.set(svc, orig);
        try { svc[RAW_CREATE] = orig; } catch { }
      }
      svc.createBot = async (input) => {
        if (!createAuth.getStore()) throw new Error(askPrimeMsg(primeIdOf()));
        const created = await orig(input);
        void addToCompany(svc, created?.id);
        return created;
      };
    }
    if (typeof svc.spawnBot === 'function' && !svc.spawnBot.__orgGuarded) {
      const orig = svc.spawnBot.bind(svc);
      const guarded = async (input) => {
        const pid = primeIdOf();
        if (!pid || input?.botId !== pid) return { ok: false, error: askPrimeMsg(pid) };
        const res = await createAuth.run({ via: 'prime' }, () => orig(input));
        if (!res || res.ok !== false) return res;
        // Bot 对 Bot 的申请 DM 由申请人领队，服务的 leader 闸门会拒绝总理——即便它才是
        // 有权建人的那个。collaborate=false 只需要 createBot：把这一步补上，并让总理
        // 用 dm_bot 把新 Bot 的名字告诉申请人。
        if (input.collaborate !== true && /leader|群.*交接|只有本群/.test(String(res.error || ''))) {
          try {
            const prime = (svc.listBots?.() ?? []).find(b => b.id === pid);
            const raw = trueCreate(svc);
            if (!raw) throw new Error('createBot 真身不可用');
            const created = await raw({
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
      guarded.__orgGuarded = true;
      svc.spawnBot = guarded;
    }
    if (typeof svc.deleteBot === 'function' && !svc.deleteBot.__orgGuarded) {
      const orig = svc.deleteBot.bind(svc);
      const guarded = async (input) => {
        const pid = primeIdOf();
        const id = typeof input === 'string' ? input : input?.id;
        if (pid && id === pid) throw new Error('「总理」是受保护的管理者，不能删除。');
        return orig(input);
      };
      guarded.__orgGuarded = true;
      svc.deleteBot = guarded;
    }
  });

  // ---- 总理与公司大群的引导 -------------------------------------------------
  // 总理只建一次，id 记在自己的账里；名字是可见角色，id 是删除守卫用的身份。
  async function ensurePrime() {
    try {
      const svc = rt.community();
      if (!svc || typeof svc.listBots !== 'function') return false;
      const bots = svc.listBots() ?? [];
      const saved = primeIdOf();
      let prime = bots.find(b => b.id === saved) ?? bots.find(b => b.name === PRIME_NAME);
      if (!prime) {
        const d = rt.defaultModel() ?? [...bots].reverse().find(b => b.provider && b.model);
        let create = trueCreate(svc);
        if (!create && typeof svc.createBot === 'function') {
          // 服务可能是冻结/远程门面，补丁包不上：直接绑定并留证据
          create = svc.createBot.bind(svc);
          rawCreate.set(svc, create);
          rt.crash('prime-raw-fallback', new Error('rawCreate was missing; bound svc.createBot directly'));
        }
        if (!d || !create) {
          rt.crash('prime-skip', new Error(JSON.stringify({ hasModel: !!d, hasCreate: !!create, createBotType: typeof svc.createBot })));
          return false;
        }
        // 走一次内部授权：即使 create 仍是守卫包装（代理取不回真身），引导也能通过。
        // 这个令牌只存在于本函数的异步上下文里，不会放宽任何模型可见的调用。
        prime = await createAuth.run({ via: 'bootstrap' }, () => create({
          name: PRIME_NAME,
          description: '团队总理：管理 Bot 名册，唯一可以新建 Bot 的角色',
          systemPrompt: PRIME_PROMPT,
          mentionOnly: false,
          permission: 'full-access',
          provider: d.provider, model: d.model, reasoningEffort: d.reasoningEffort,
        }));
      }
      const o = readOrg();
      if (o.primeBotId !== prime.id) {
        o.primeBotId = prime.id;
        writeOrg(o);
      }
      await ensureCompany(svc, prime);
      return true;
    } catch (e) { rt.crash('prime', e); return false; }
  }

  // 一个公司大群容纳整个名册，总理任 leader。只建一次，按 id 记住并保持同步。
  async function ensureCompany(svc, prime) {
    try {
      const o = readOrg();
      const room = o.companyRoomId ? (svc.listRooms?.() ?? []).find(r => r.id === o.companyRoomId) : null;
      if (!room) {
        const memberIds = [...new Set((svc.listBots?.() ?? []).map(b => b.id))].slice(0, 30);
        if (!memberIds.includes(prime.id)) memberIds.unshift(prime.id);
        const created = await svc.createRoom({
          name: COMPANY_NAME,
          memberIds,
          team: { leaderBotId: prime.id, leaderName: prime.name },
        });
        const cur = readOrg();
        cur.companyRoomId = created.id;
        writeOrg(cur);
      } else {
        const members = new Set(room.memberIds ?? []);
        for (const b of svc.listBots?.() ?? []) {
          if (!members.has(b.id)) {
            try { await svc.inviteBot({ roomId: room.id, botId: b.id, reason: '公司大群成员同步' }); } catch { }
          }
        }
      }
    } catch (e) { rt.crash('company', e); }
  }

  async function addToCompany(svc, botId) {
    try {
      if (!botId) return;
      const o = readOrg();
      if (!o.companyRoomId) return;
      const room = (svc.listRooms?.() ?? []).find(r => r.id === o.companyRoomId);
      if (!room || (room.memberIds ?? []).includes(botId)) return;
      await svc.inviteBot?.({ roomId: room.id, botId, reason: '新成员自动加入公司大群' });
    } catch (e) { rt.crash('company-invite', e); }
  }

  // 挂载即引导，失败按分钟重试直到成功（旧版靠页面轮询顺带触发，前端移除后改为自驱动）。
  void ensurePrime();
  let primeTimer = rt.interval(60_000, () => {
    void ensurePrime().then(ok => {
      if (ok && primeTimer) { primeTimer(); primeTimer = null; }
    });
  });

  const rankOf = (botId) => {
    const o = readOrg();
    // 没定级的就是新来的：从最底层干起
    return o.primeBotId === botId ? 'boss' : (o.ranks[botId] || 'execution');
  };
  const botNameOf = (botId) => {
    try { return (rt.community()?.listBots?.() ?? []).find(b => b.id === botId)?.name ?? ''; } catch { return ''; }
  };

  // brain 能力写团队账本前会来问等级（团队那本只有总理能写）；org 缺席时对方按非总理处理。
  rt.provide('rank-of', (botId) => rankOf(botId));
  rt.provide('prime-id', () => primeIdOf());

  function applyRankDomain(botId, { rank, domain } = {}) {
    try {
      if (!botId) return { ok: false, error: '要任命谁？' };
      const o = readOrg();
      if (o.primeBotId === botId) return { ok: false, error: '「总理」的等级是固定的，不能被任命或降级。' };
      if (rank !== undefined) {
        const ranks = { ...o.ranks };
        if (RANKS.includes(rank)) ranks[botId] = rank;
        else delete ranks[botId];
        o.ranks = ranks;
      }
      if (domain !== undefined) {
        const domains = { ...o.domains };
        const v = String(domain ?? '').trim().slice(0, 40);
        if (v) domains[botId] = v; else delete domains[botId];
        o.domains = domains;
      }
      writeOrg(o);
      return { ok: true };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }

  // ---- 工具 -----------------------------------------------------------------
  rt.tools.add({
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
        const c = rt.caller(exec);
        if (!c) return { ok: false, error: '只有团队内的 Bot 可以用这个工具提交申请。' };
        const svc = rt.community();
        if (!svc) return { ok: false, error: '团队服务还没就绪。' };
        const o = readOrg();
        const roomId = o.companyRoomId, pid = o.primeBotId;
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
        // postTeamMessage 自己的 run 用随机会话 id，总理的工具就解析不到归属。
        // 把总理排在它稳定的 ac:<room>:<bot> 会话上。
        let run = null;
        if (typeof svc.queueRoomRun === 'function') {
          run = svc.queueRoomRun(roomId, pid, text, 'a2a');
          svc.executor?.nudge?.();
        }
        return { ok: true, roomId, messageId: posted?.message?.id ?? null, runId: run?.id ?? null, hint: '已提交，等待总理在公司大群审批。' };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
  });

  rt.tools.add({
    name: 'org_rank',
    description: '查看你在公司里的名字、等级和公司大群。等级从高到低：总理 > 管方向 > 小官 > 组长；只有总理和管方向有管理权。',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    async execute(_args, exec) {
      const c = rt.caller(exec);
      if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
      const svc = rt.community();
      const me = (svc?.listBots?.() ?? []).find(b => b.id === c.botId);
      const rank = rankOf(c.botId);
      return { ok: true, botId: c.botId, name: me?.name ?? null, rank, rankName: RANK_NAME[rank], companyRoomId: readOrg().companyRoomId ?? null };
    },
  });

  rt.tools.add({
    name: 'org_roster',
    description: '查看公司名册：每个 Bot 的名字、等级、负责范围。派活、找谁对接、判断该不该新建 Bot 之前先看它。',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    async execute(_args, exec) {
      const svc = rt.community();
      if (!svc) return { ok: false, error: '团队服务还没就绪。' };
      const o = readOrg();
      const roster = (svc.listBots?.() ?? []).map(b => ({
        name: b.name, id: b.id,
        rank: o.primeBotId === b.id ? 'boss' : (o.ranks[b.id] || 'execution'),
        domain: o.primeBotId === b.id ? '全公司' : (o.domains[b.id] || ''),
      }));
      for (const r of roster) r.rankName = RANK_NAME[r.rank] ?? r.rank;
      return { ok: true, companyRoomId: o.companyRoomId ?? null, prime: o.primeBotId ?? null, roster };
    },
  });

  rt.tools.add({
    name: 'org_appoint',
    description: '任命：给某个 Bot 定等级和负责范围。只有「总理」可以任命。等级从高到低：管方向（拆任务、派活、控运行）> 小官（独管一个具体领域）> 组长（最底层干活）。「总理」自己不能被任命，也没有比总理更高的等级可给。任命会在「公司大群」公告一条，并记进团队账本。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        bot: { type: 'string', description: '被任命者的名字或 id' },
        rank: { type: 'string', enum: ['direction', 'officer', 'execution'], description: 'direction=管方向 officer=小官 execution=组长' },
        domain: { type: 'string', description: '负责范围，例如「生活」「工作」「验收」（可选）' },
        reason: { type: 'string', description: '为什么是他，写进公告和账本（可选）' },
      },
      required: ['bot', 'rank'],
    },
    async execute(args, exec) {
      try {
        const c = rt.caller(exec);
        if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
        const mine = rankOf(c.botId);
        if (mine !== 'boss') {
          return { ok: false, error: `只有「总理」可以任命别人；你的等级是「${RANK_NAME[mine]}」。觉得谁该调整，就发到「公司大群」让总理定。` };
        }
        const svc = rt.community();
        if (!svc) return { ok: false, error: '团队服务还没就绪。' };
        const bots = svc.listBots?.() ?? [];
        const want = String(args.bot ?? '').trim();
        const target = bots.find(b => b.id === want || b.name === want);
        if (!target) return { ok: false, error: `找不到这个 Bot：${want}。先 org_roster 看名册。` };
        if (!RANKS.includes(args.rank)) return { ok: false, error: 'rank 只能是 direction / officer / execution。' };
        const applied = applyRankDomain(target.id, { rank: args.rank, domain: args.domain });
        if (!applied.ok) return applied;
        const o = readOrg();
        const rankName = RANK_NAME[args.rank];
        const who = botNameOf(c.botId) || '总理';
        // 被任命者从它盯着的那间房得知，其他人从团队账本得知——没人宣布的等级没人会认。
        try {
          if (o.companyRoomId && typeof svc.postTeamMessage === 'function') {
            await svc.postTeamMessage({
              roomId: o.companyRoomId,
              sender: { kind: 'bot', botId: c.botId, name: who },
              text: `@${target.name} 任命：${target.name} 为「${rankName}」`
                + (args.domain ? `，负责「${String(args.domain).trim().slice(0, 40)}」` : '')
                + '。' + (args.reason ? String(args.reason).trim().slice(0, 200) : '')
                + `（发起：${who}；用 org_rank 查自己的等级，org_roster 查名册）`,
              kind: 'appoint', targetNames: [target.name], targetBotIds: [], origin: 'a2a',
            });
          }
        } catch (e) { rt.crash('appoint-announce', e); }
        // 团队账本属于 brain 能力：发事件，不动它的账本文件
        rt.emit('team-ledger', {
          botId: c.botId, botName: who, scope: 'team', kind: 'log', tags: ['任命'], by: 'prime',
          text: `任命 ${target.name} 为「${rankName}」` + (args.domain ? `（负责 ${String(args.domain).trim().slice(0, 40)}）` : '')
            + (args.reason ? `：${String(args.reason).trim().slice(0, 200)}` : ''),
        });
        return { ok: true, botId: target.id, name: target.name, rank: args.rank, rankName, domain: args.domain ?? '' };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
  });

  rt.tools.add({
    name: 'org_plan',
    description: '管理本房间的目标与任务卡。仅「管方向」和「总理」可用：设置/更新本房间目标，拆任务卡并派给成员。派活前先用 org_roster 看每个人的等级和负责范围，把任务给对的人。',
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
        const c = rt.caller(exec);
        if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
        const rank = rankOf(c.botId);
        if (rank !== 'boss' && rank !== 'direction') return { ok: false, error: `只有「总理」或「管方向」可以设目标/派活；你的等级是「${RANK_NAME[rank]}」。可以把建议发到公司大群，由管方向或总理决定。` };
        const svc = rt.community();
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

  rt.tools.add({
    name: 'org_control',
    description: '控制本房间的运行。仅「管方向」和「总理」可用：取消、中断、转向（steer）或重试一个运行。「小官」和「组长」是干活的，不能控制运行。',
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
        const c = rt.caller(exec);
        if (!c) return { ok: false, error: '只有团队内的 Bot 可以使用。' };
        const rank = rankOf(c.botId);
        if (rank !== 'boss' && rank !== 'direction') return { ok: false, error: `只有「总理」或「管方向」可以控制运行；你的等级是「${RANK_NAME[rank]}」。要停就交给他们。` };
        const svc = rt.community();
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

  return {
    dispose() {
      if (primeTimer) { primeTimer(); primeTimer = null; }
    },
  };
}
