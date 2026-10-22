// Reference implementation of the Grok Bot local-exec daemon CONTRACT,
// reconstructed statically from the shipped artifact (D:/Grok_Bot/Grok Bot/resources/app.asar,
// member dist/local-exec-daemon/main.cjs).
//
// This is ORIGINAL code written from observed structure (kind allowlist, policy precedence,
// error routing, idempotency, fail-closed behaviour). No code was copied from the target.
// Anything the artifact left ambiguous is marked `inferred:` below and is configurable.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

// Observed: yMt = new Set(["exec","upload","download","retire-approval","cancel","welcome",
// "messages-op","discover-ai-tool"]) and every inbound message is additionally zod-validated.
export const INBOUND_KINDS = Object.freeze(['exec', 'upload', 'download', 'retire-approval',
  'cancel', 'welcome', 'messages-op', 'discover-ai-tool']);

// Observed terminal event set: exit | rejected | permissionDenied | sandboxUnsupported | backgrounded
export const TERMINAL_EVENTS = Object.freeze(['exit', 'rejected', 'permissionDenied',
  'sandboxUnsupported', 'backgrounded']);

export const POLICY_TYPES = Object.freeze(['workspace_readwrite', 'workspace_readonly', 'insecure_none']);

export class ProtocolError extends Error { }

// Numbers arriving from a caller are never trusted: clamp to the documented window, else default.
const clampInt = (value, dflt, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return dflt;
  const i = Math.floor(n);
  if (i < min) return dflt;
  return i > max ? max : i;
};

// Single-execution bounds (A5). A run that outlives its budget, floods its pipes or arrives while
// the machine is already saturated must not be able to take the plugin down with it.
export const EXEC_LIMITS = Object.freeze({
  timeoutMs: 120_000,
  maxTimeoutMs: 600_000,
  maxOutputBytes: 1024 * 1024,
  maxOutputCap: 16 * 1024 * 1024,
  maxConcurrency: 4,
});

export function createDaemon(opts = {}) {
  const hostPlatform = opts.hostPlatform ?? process.platform;
  // inferred: which policies the current host can actually enforce. The artifact contains no
  // OS-sandbox fingerprints (bwrap/sandbox-exec/AppContainer/icacls all absent) and emits
  // `sandboxUnsupported` "on this host", so the faithful default is: no OS enforcement anywhere.
  const enforceable = opts.enforceablePolicies ?? new Set(['insecure_none']);
  const approvals = new Map();       // approvalId -> {kind, requestId, consumed}
  const inflight = new Set();
  const replay = new Map();          // sendKey -> result   (observed: replayedSend / withSendKey)
  const log = [];
  const maxConcurrency = clampInt(opts.maxConcurrency, EXEC_LIMITS.maxConcurrency, 1, 64);
  const defaultTimeoutMs = clampInt(opts.timeoutMs, EXEC_LIMITS.timeoutMs, 1, EXEC_LIMITS.maxTimeoutMs);
  const defaultMaxOutputBytes = clampInt(opts.maxOutputBytes, EXEC_LIMITS.maxOutputBytes, 1024, EXEC_LIMITS.maxOutputCap);
  let active = 0;

  function issueApproval(kind, requestId) {
    const id = 'ap_' + crypto.randomBytes(8).toString('hex');
    approvals.set(id, { kind, requestId, consumed: false });
    return id;
  }

  function retireApproval(approvalId) {
    if (!approvalId) throw new ProtocolError('retire-approval requires approvalId');
    const rec = approvals.get(approvalId);
    if (!rec) return { kind: 'rejected', reason: 'unknown-approval' };
    approvals.delete(approvalId);
    return { kind: 'exit', retired: approvalId };
  }

  // Observed verbatim logic in wy(): teamAdmin?.type ?? perRepo?.type ?? perUser?.type ?? "insecure_none"
  function resolvePolicy(scope = {}) {
    return scope.teamAdmin?.type ?? scope.perRepo?.type ?? scope.perUser?.type ?? 'insecure_none';
  }

  // Observed: mixing policy types in one request throws ("All policies must be of the same type")
  function mergePolicies(policies) {
    const types = new Set(policies.filter(Boolean).map(p => p.type));
    if (types.size > 1) {
      throw new ProtocolError('cannot merge policies of different types: ' + [...types].join(' vs '));
    }
    return types.size ? [...types][0] : null;
  }

  function validate(msg) {
    if (!msg || typeof msg.kind !== 'string') throw new ProtocolError('message.kind must be a string');
    if (!INBOUND_KINDS.includes(msg.kind)) throw new ProtocolError('kind not in allowlist: ' + msg.kind);
    if (typeof msg.requestId !== 'string' || !msg.requestId) throw new ProtocolError('requestId required');
    if (msg.kind === 'retire-approval' && !msg.approvalId) throw new ProtocolError('approvalId required');
    return msg;
  }

  // Observed routing in Gl(): different failure payload per inbound kind
  function errorFor(msg, err) {
    switch (msg.kind) {
      case 'exec': return { kind: 'error', requestId: msg.requestId, error: String(err.message || err) };
      case 'upload':
      case 'download':
      case 'discover-ai-tool':
        return { kind: 'file-error', requestId: msg.requestId, error: String(err.message || err) };
      case 'messages-op': return { kind: 'messages-error', requestId: msg.requestId, error: String(err.message || err) };
      default: return { kind: 'rejected', requestId: msg.requestId, error: String(err.message || err) };
    }
  }

  function runCommand(msg) {
    if (active >= maxConcurrency) {
      log.push({ at: 'busy', requestId: msg.requestId, active, maxConcurrency });
      return Promise.resolve({ kind: 'busy', requestId: msg.requestId, active, maxConcurrency });
    }
    const timeoutMs = clampInt(msg.timeoutMs, defaultTimeoutMs, 1, EXEC_LIMITS.maxTimeoutMs);
    const maxOutputBytes = clampInt(msg.maxOutputBytes, defaultMaxOutputBytes, 1024, EXEC_LIMITS.maxOutputCap);
    active += 1;
    return new Promise(resolve => {
      const startedAt = Date.now();
      let settled = false;
      let timedOut = false;
      let termTimer = null;
      let killTimer = null;
      const finish = (res) => {
        if (settled) return;
        settled = true;
        active = Math.max(0, active - 1);
        if (termTimer) clearTimeout(termTimer);
        if (killTimer) clearTimeout(killTimer);
        resolve({ requestId: msg.requestId, ...res, durationMs: Date.now() - startedAt, timedOut });
      };
      let cmd;
      try {
        cmd = spawn(msg.command, msg.args ?? [], {
          cwd: msg.cwd, env: msg.env ?? process.env, shell: false,
        });
      } catch (e) {
        finish({ kind: 'rejected', error: String(e.message) });
        return;
      }
      // each stream is capped independently; once the cap is hit the rest is dropped and flagged,
      // so a runaway command cannot balloon this process's memory.
      const cap = (limit) => {
        const parts = [];
        let bytes = 0;
        let truncated = false;
        return {
          push(chunk) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
            if (bytes >= limit) { truncated = true; return; }
            const room = limit - bytes;
            const part = buf.length > room ? buf.subarray(0, room) : buf;
            if (part.length < buf.length) truncated = true;
            bytes += part.length;
            parts.push(part);
          },
          get truncated() { return truncated; },
          get bytes() { return bytes; },
          text() { return Buffer.concat(parts).toString('utf8'); },
        };
      };
      const outCap = cap(maxOutputBytes);
      const errCap = cap(maxOutputBytes);
      cmd.stdout.on('data', d => outCap.push(d));
      cmd.stderr.on('data', d => errCap.push(d));

      // SIGTERM first so a well-behaved child can flush, SIGKILL three seconds later because a
      // runaway one will not.
      termTimer = setTimeout(() => {
        timedOut = true;
        try { cmd.kill('SIGTERM'); } catch { /* already gone */ }
        killTimer = setTimeout(() => { try { cmd.kill('SIGKILL'); } catch { /* already gone */ } }, 3000);
        if (typeof killTimer.unref === 'function') killTimer.unref();
      }, timeoutMs);
      if (typeof termTimer.unref === 'function') termTimer.unref();

      cmd.on('error', e => finish({ kind: 'rejected', error: String(e.message) }));
      cmd.on('close', (code, signal) => finish({
        kind: timedOut ? 'timeout' : 'exit',
        code: code ?? null,
        signal: signal ?? null,
        stdout: outCap.text(),
        stderr: errCap.text(),
        stdoutTruncated: outCap.truncated,
        stderrTruncated: errCap.truncated,
        aborted: timedOut,
      }));
    });
  }

  // The target's own shape conflates two things: the sandbox *policy* and whether a human
  // approved. With the observed default policy (`insecure_none`) it executes with no consent at
  // all, which is only safe because a server upstream decided and annotated the frame. Here the
  // local machine IS the enforcement point, so consent is required independently of policy.
  // `consentMode: 'policy-derived'` restores the observed behaviour for reproduction tests.
  const consentMode = opts.consentMode ?? 'required';
  const standing = opts.standingActions ?? null;   // Set/array of actions pre-authorized locally
  // The consent authority is injected so the daemon and the caller can share ONE source of truth
  // (here: state/computer.json, where the human's verdict actually lands). Without it the daemon
  // falls back to the tickets it issued itself, which keeps standalone use fail-closed.
  const verifyConsent = opts.verifyConsent ?? null;

  async function handleExec(msg, scope) {
    const policyType = mergePolicies([scope?.teamAdmin, scope?.perRepo, scope?.perUser]) ?? resolvePolicy(scope);
    if (!enforceable.has(policyType)) {
      // Observed fail-closed shape: log "sandbox policy unsupported on this host", then emit the
      // terminal event and return WITHOUT executing.
      log.push({ at: 'sandboxUnsupported', policyType, reason: 'host cannot enforce policy' });
      return {
        kind: 'sandboxUnsupported', requestId: msg.requestId, policyType,
        isReadonly: policyType === 'workspace_readonly', executed: false,
      };
    }

    const consent = msg.consent ?? (msg.approvalId ? { kind: 'approval', approvalId: msg.approvalId } : null);
    if (consentMode === 'required') {
      const local = consent?.kind === 'approval'
        ? (() => { const rec = approvals.get(consent.approvalId); return !!rec && !rec.consumed; })()
        : consent?.kind === 'standing' && (!standing || new Set(standing).has(consent.action));
      const ok = consent ? (verifyConsent ? await verifyConsent(consent, msg) : local) : false;
      if (!ok) {
        const rec = consent?.kind === 'approval' ? approvals.get(consent.approvalId) : null;
        if (rec?.consumed) return { kind: 'permissionDenied', requestId: msg.requestId, reason: 'approval-already-consumed' };
        // with no external authority injected, this daemon's own ledger is the authority, so an
        // id it never issued is a forgery rather than something still waiting on a human.
        if (consent?.kind === 'approval' && !verifyConsent && !rec) {
          return { kind: 'permissionDenied', requestId: msg.requestId, reason: 'unknown-approval' };
        }
        const id = consent?.kind === 'approval' ? consent.approvalId : issueApproval('exec', msg.requestId);
        log.push({ at: 'permissionPending', requestId: msg.requestId, approvalId: id, reason: consent ? 'consent-not-verified' : 'no-consent' });
        return { kind: 'permissionPending', requestId: msg.requestId, approvalId: id };
      }
      if (consent.kind === 'approval') {
        const rec = approvals.get(consent.approvalId);
        if (rec) rec.consumed = true;
      } else {
        log.push({ at: 'standingConsent', requestId: msg.requestId, action: consent.action });
      }
      return await runCommand(msg);
    }

    // --- observed legacy path (reproduction only) --------------------------------
    if (policyType !== 'insecure_none' && !msg.approvalId) {
      const id = issueApproval('exec', msg.requestId);
      return { kind: 'permissionPending', requestId: msg.requestId, approvalId: id };
    }
    if (msg.approvalId) {
      const rec = approvals.get(msg.approvalId);
      if (!rec) return { kind: 'permissionDenied', requestId: msg.requestId, reason: 'unknown-approval' };
      if (rec.consumed) return { kind: 'permissionDenied', requestId: msg.requestId, reason: 'approval-already-consumed' };
      rec.consumed = true;
    }
    return await runCommand(msg);
  }

  async function send(msg, scope) {
    try {
      validate(msg);
    } catch (e) {
      return { kind: 'rejected', requestId: msg?.requestId ?? null, error: String(e.message) };
    }
    if (msg.sendKey && replay.has(msg.sendKey)) {
      return { ...replay.get(msg.sendKey), replayed: true };
    }
    if (msg.kind === 'retire-approval') return retireApproval(msg.approvalId);
    if (msg.kind === 'cancel') {
      inflight.delete(msg.requestId);
      return { kind: 'rejected', requestId: msg.requestId, cancelled: true };
    }
    if (inflight.has(msg.requestId)) {
      return { kind: 'rejected', requestId: msg.requestId, reason: 'inflight-duplicate' };
    }
    inflight.add(msg.requestId);
    let res;
    try {
      if (msg.kind === 'exec') res = await handleExec(msg, scope);
      else res = { kind: 'exit', requestId: msg.requestId, unhandledKind: msg.kind };
    } catch (e) {
      res = errorFor(msg, e);
    } finally {
      inflight.delete(msg.requestId);
    }
    if (msg.sendKey) replay.set(msg.sendKey, res);
    return res;
  }

  return {
    send, issueApproval, retireApproval, resolvePolicy, mergePolicies,
    approvals, replay, log, hostPlatform, enforceable,
    limits: { maxConcurrency, defaultTimeoutMs, defaultMaxOutputBytes, maxTimeoutMs: EXEC_LIMITS.maxTimeoutMs, maxOutputCap: EXEC_LIMITS.maxOutputCap },
    activeCount: () => active,
  };
}