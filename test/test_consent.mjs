// Consent enforcement at the execution layer.
//
// Why this exists: the target's own handleExec only demands an approvalId when the sandbox policy
// is NOT `insecure_none`, and `insecure_none` is the observed default. In the target that is safe
// because a server upstream decided and annotated the frame. In this plugin the local machine is
// the enforcement point, so exec must be impossible without a locally-verifiable consent — and that
// must hold even when the policy says `insecure_none`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDaemon } from '../core/daemon.mjs';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => path.join(ROOT, p);
const TMP = path.join(R('state'), 'consent-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const marker = tag => path.join(TMP, tag);
const say = t => console.log(t);
const exec = (d, tag, consent) => d.send({
  kind: 'exec', requestId: 'r-' + tag, command: process.execPath,
  args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker(tag))},'ran')`],
  ...(consent ? { consent } : {}),
}, {});

// 1. no consent at all, default policy => refused before executing
{
  const d = createDaemon();
  const r = await exec(d, 'no-consent');
  assert.equal(r.kind, 'permissionPending', 'exec without consent must pend, got ' + r.kind);
  assert.ok(r.approvalId, 'a ticket is issued for the human to answer');
  assert.ok(!fs.existsSync(marker('no-consent')), 'NOTHING may have run');
  say('PASS  fail-closed: insecure_none + no consent -> permissionPending, side effect absent');
}

// 2. a forged / unknown approvalId is not consent
{
  const d = createDaemon();
  const r = await exec(d, 'forged', { kind: 'approval', approvalId: 'ap_deadbeef' });
  assert.equal(r.kind, 'permissionDenied', 'a claim the authority does not recognize must not run');
  assert.equal(r.reason, 'unknown-approval');
  assert.ok(!fs.existsSync(marker('forged')), 'a forged id must not execute');
  say('PASS  forged approvalId -> permissionDenied(unknown-approval), nothing ran');
}

// 3. a standing claim the local policy never granted is not consent either
{
  const d = createDaemon({ standingActions: new Set(['read-file']) });
  const r = await exec(d, 'fake-standing', { kind: 'standing', action: 'run-command' });
  assert.equal(r.kind, 'permissionPending', 'run-command is not in the standing set');
  assert.ok(!fs.existsSync(marker('fake-standing')));
  const ok = await exec(d, 'real-standing', { kind: 'standing', action: 'read-file' });
  assert.equal(ok.kind, 'exit', 'an action the local store really did grant goes through');
  assert.ok(fs.existsSync(marker('real-standing')));
  say('PASS  standing consent is checked against the local grant set, not trusted blindly');
}

// 4. the ticket the daemon issued is single-use
{
  const d = createDaemon();
  const first = await exec(d, 'ticket');
  const second = await exec(d, 'ticket-replay', { kind: 'approval', approvalId: first.approvalId });
  assert.equal(second.kind, 'exit', 'the issued ticket authorizes exactly one exec');
  assert.ok(fs.existsSync(marker('ticket-replay')));
  const third = await exec(d, 'ticket-replay2', { kind: 'approval', approvalId: first.approvalId });
  assert.equal(third.kind, 'permissionDenied');
  assert.equal(third.reason, 'approval-already-consumed');
  assert.ok(!fs.existsSync(marker('ticket-replay2')), 'a spent ticket can never authorize again');
  say('PASS  single-use ticket: issue -> spend -> refuse (non-retroactive)');
}

// 5. the observed target behaviour stays reachable, explicitly labelled
{
  const d = createDaemon({ consentMode: 'policy-derived' });
  const r = await exec(d, 'legacy');
  assert.equal(r.kind, 'exit', 'policy-derived reproduces the artifact: insecure_none execs with no consent');
  assert.ok(fs.existsSync(marker('legacy')));
  say('PASS  reproduction mode: consentMode=policy-derived replays the observed target behaviour');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n5 consent checks passed');
