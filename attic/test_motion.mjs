// The motion and preference contract, checked against the shipped CSS string. Not a rendering
// test: it asserts the mechanisms exist, so a later edit cannot silently drop them.
import assert from 'node:assert/strict';
import fs from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => path.join(ROOT, p);
for (const f of [R('lib/client.js')]) {
  const src = fs.readFileSync(f, 'utf8');
  const css = /const CSS = `([\s\S]*?)`;/.exec(src)?.[1] ?? '';
  assert.ok(css.length > 10000, 'the stylesheet is embedded in the bundle');
  const say = t => console.log(t);

  // 1. reduced motion turns everything off and restores the press scale
  const rm = /@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  assert.ok(rm, 'a prefers-reduced-motion block exists');
  assert.ok(/--ui-press-scale:1/.test(rm), 'press feedback is cancelled under reduced motion');
  for (const cls of ['.wc-pane', '.wc-stag', '.wc-skel', '.wc-dot-live', '.wc-spin']) {
    assert.ok(rm.includes(cls), `reduced motion names ${cls}`);
  }
  assert.ok(/animation:none/.test(rm), 'animations are switched off, not merely shortened');
  assert.ok(/transition-duration:1ms/.test(rm), 'transitions collapse to 1ms instead of disappearing (states still visible)');
  say('PASS  reduced motion: animations off, press scale 1, transitions 1ms (state changes remain visible)');

  // 2. one authored entrance, not a per-section effect
  assert.ok(/@keyframes wc-pane-wipe/.test(css), 'the pane wipe exists');
  assert.ok(/@keyframes wc-lift/.test(css), 'the row lift exists');
  assert.ok(/animation-delay:calc\(90ms \+ var\(--i,0\) \* 26ms\)/.test(css), 'rows stagger from one authored curve');
  assert.ok(/cubic-bezier\(\.23,1,\.32,1\)/.test(css), "the target's own panel easing is used");
  say('PASS  motion: one authored entrance (wipe + staggered lift), the target\'s easing');

  // 3. both schemes are actually themed
  assert.ok(/@media \(prefers-color-scheme: dark\)/.test(css), 'dark follows the system preference');
  assert.ok(/\[data-scheme="dark"\]/.test(css), 'and can be forced explicitly');
  assert.ok(/::selection/.test(css) && /caret-color/.test(css), 'selection and caret are themed');
  assert.ok(/::-webkit-scrollbar-thumb/.test(css), 'the scrollbar is themed');
  assert.ok(/\[data-kbd="1"\][^{]*:focus-visible/.test(css), 'focus rings appear only for keyboard navigation');
  say('PASS  browser surfaces: selection, caret, scrollbar and keyboard-only focus rings are themed');

  // 4. interactive elements carry their own transition (no unexplained jumps)
  for (const cls of ['.wc-btn{', '.wc-row-link{', '.wc-file{', '.wc-send{', '.wc-toggle{', '.wc-composer{']) {
    const block = new RegExp(cls.replace(/[.{]/g, '\\$&') + '[\\s\\S]{0,900}?\\}')
      .exec(css)?.[0] ?? '';
    assert.ok(/transition/.test(block), cls + ' declares a transition');
  }
  say('PASS  states: every interactive control declares its own transition');
}

console.log('\n4 motion/preference checks passed');
