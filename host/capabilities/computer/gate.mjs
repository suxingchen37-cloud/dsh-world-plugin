// Local-tool authorization gate, ported from the decision function observed in
// dist/electron-main/main-core.cjs (async function gae/lWe, helpers pd/dWe/uWe/Uj/mae/iae,
// tables ohe/ihe/ahe/th). Table values and control flow are the target's; the refusal wording
// below is MY paraphrase, not the shipped prompt text.
export const ACTION_SCOPE = Object.freeze({
  'run-command': 'global', 'send-input': 'global', 'read-file': 'global', 'list-directory': 'global',
  'write-file': 'global', 'read-ai-tool-setup': 'global', 'read-messages': 'setting',
  'send-imessage': 'subject', 'run-phone-tool': 'call', 'use-app': 'subject',
});
export const MESSAGES_ACTIONS = Object.freeze(['read-messages', 'send-imessage']);
export const PERMISSION_VALUES = Object.freeze(['allow-once', 'deny', 'always', 'never']);
export const PERMISSION_RANK = Object.freeze({ never: 0, ask: 1, always: 2 });

export const ALLOW = { kind: 'allow' };
export const ASK = { kind: 'ask', reason: 'needs-approval' };
export const refuse = (reason) => ({ kind: 'refused', reason });

export const REASON = Object.freeze({
  localToolsOff: 'local-tools-never: shell/read/await-shell with machineId and box copy are disabled; do not retry while the setting stays Never',
  messagesOff: 'messages-feature-off: the user must re-enable Messages in settings; do not retry',
  nowhereToAsk: 'no-approval-channel: this conversation cannot surface an approval prompt',
  unanswered: 'approval-unanswered: nothing ran',
  declined: 'user-declined: do not retry this action',
  notApproved: 'not-approved: ask the user to approve, or to set always-allow',
  alreadyAsked: 'already-asked-and-denied-for-this-task: a later permission change does not authorize it',
});

export function scopeOf(action) { return Object.hasOwn(ACTION_SCOPE, action) ? ACTION_SCOPE[action] : 'subject'; }
export function hasApprovalId(req) { return req.approvalId != null && String(req.approvalId).length > 0; }

// Uj: is this action eligible for standing permission at all
export function standingEligible({ action, ceiling, permission, messagesEnabled }) {
  if (ceiling !== undefined && ceiling !== 'always') return false;
  if (permission === 'never') return false;
  return !!messagesEnabled || !MESSAGES_ACTIONS.includes(action);
}

// strictest-wins merge over the never<ask<always lattice
export function mergePermission(a, b) {
  const rank = p => PERMISSION_RANK[p] ?? 1;
  return rank(a) <= rank(b) ? a : b;
}

export async function decide(req) {
  const { permission, ceiling, messagesEnabled } = req;
  // the shipped function derives scope from the *described action* (pd(t.action)), not a top-level field
  const action = req.action ?? req.describes?.action;
  const scope = req.describes === undefined ? 'global' : scopeOf(action);

  // There is no "the server already decided" shortcut any more: the only ways through are the
  // local standing grant (permission === 'always') or a ticket this machine actually holds.
  if (ceiling === 'never') return refuse(REASON.localToolsOff);
  if (permission === 'always' && scope === 'global') return ALLOW;
  if (permission === 'never' && scope !== 'global') return refuse(REASON.localToolsOff);

  if (scope === 'setting') return messagesEnabled ? ALLOW : refuse(REASON.messagesOff);

  if (scope === 'subject' && req.describes !== undefined) {
    if (!hasApprovalId(req) && req.accountScope !== undefined
      && standingEligible({ action, ceiling, permission, messagesEnabled })) {
      const granted = await (req.standingLookup ?? (async () => false))(req.describes, req);
      if (granted) return ALLOW;
    }
  }

  if (!hasApprovalId(req) || req.describes === undefined) {
    return req.channelAvailable === false ? refuse(REASON.nowhereToAsk) : ASK;
  }
  const rec = (await req.approvalStore()).get(req.approvalId);
  if (rec === undefined) {
    return req.channelAvailable === false ? refuse(REASON.nowhereToAsk) : ASK;
  }
  if (req.retired?.has(req.approvalId)) return refuse(REASON.alreadyAsked);
  const want = req.describes;
  const matches = rec.action === want.action
    && (want.action === 'run-command' ? (rec.resourcePath === undefined || rec.resourcePath === want.resourcePath || want.resourcePath === undefined) : true);
  return matches ? ALLOW : (req.channelAvailable === false ? refuse(REASON.nowhereToAsk) : ASK);
}

// lWe: what the caller actually sees
export async function decideForCaller(req) {
  const d = await decide(req);
  switch (d.kind) {
    case 'allow': return undefined;
    case 'refused': return d.reason;
    case 'ask': return req.permission === 'never' ? REASON.localToolsOff : REASON.notApproved;
  }
}