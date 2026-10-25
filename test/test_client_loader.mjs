// 客户端加载契约：这套检查守着"web boot 不能被插件搞挂"的红线（旧版曾因 ESM 语法炸过）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'client', 'client.js'), 'utf8');

// 1) 宿主把它当普通脚本求值：不允许 ESM 语法
assert.ok(!/^\s*export[\s{*]/m.test(src), 'client.js 不得出现 ESM export');
assert.ok(!/^\s*import[\s{*]/m.test(src), 'client.js 不得出现 ESM import（引号内的除外已按行首判断）');
console.log('PASS  无 ESM 语法（宿主按普通脚本求值）');

// 2) 自注册：__ModuleLoader__.load({ id, factory })
assert.ok(/__ModuleLoader__\.load\(/.test(src), '必须自注册 __ModuleLoader__.load');
assert.ok(/id:\s*NS/.test(src), '注册 id 用 NS 常量');
console.log('PASS  自注册 __ModuleLoader__.load({ id, factory })');

// 3) 在 fake 宿主里真实求值一遍
const registered = [];
let React = null;
globalThis.window = {
  __ModuleLoader__: { load: (def) => registered.push(def) },
};
globalThis.document = {
  createElement: () => ({ style: {}, setAttribute() { }, addEventListener() { },
    removeEventListener() { } }),
  body: { appendChild() { }, removeChild() { } },
};
(0, eval)(src);

assert.equal(registered.length, 1, '恰好注册一个模块');
const def = registered[0];
assert.equal(def.id, 'dsh-local-computer', '注册 id = 包名');
console.log('PASS  求值后注册 id="dsh-local-computer"');

// 4) factory(require) → { inject:['slots'], apply }，slot 注册齐全
// createElement 打上 __reactElement 标记：组件必须走 React.createElement，
// 返回 {tag, props, children} 这类普通对象会被 React 渲染器拒绝并降级该注册
// （症状：侧栏入口注册在册但 active:false，用户看不到入口）。
const fakeReact = {
  createElement: (tag, props, ...children) => ({ __reactElement: true, tag, props, children }),
  Component: function (props) { this.props = props ?? {}; this.state = {}; },
};
const mod = def.factory((name) => {
  assert.equal(name, 'react', 'factory 只 require react');
  return fakeReact;
});
assert.deepEqual(mod.inject, ['slots'], 'inject 声明只有 slots');
assert.equal(typeof mod.apply, 'function', 'apply 是函数');

const injected = [], views = [];
const ctx = {
  slots: {
    inject: (name, fn) => { injected.push(name); fn(); },
    register: (cfg, Comp) => views.push({ cfg, Comp }),
  },
};
mod.apply(ctx);
assert.deepEqual(injected, ['sidebar.panellist', 'main'], '注入侧栏入口 + 主视图');
assert.equal(views[0].cfg.id, 'resonance', '侧栏入口 id=resonance');
assert.equal(views[0].cfg.label(), '共振', '侧栏 label=共振');
assert.equal(views[1].cfg.key, 'resonance', '主视图 key 同一 id（点入口即开）');
assert.equal(typeof views[1].Comp, 'function', '主视图是组件');

// 4b) 组件必须产出真正的 React 元素：withBoundary 返回 Boundary 元素，
//     其子元素是入口图标；图标本身渲染出 svg。
for (const [name, view] of [['侧栏', views[0]], ['主视图', views[1]]]) {
  const wrapped = view.Comp({ size: 16, active: false });
  assert.ok(wrapped && wrapped.__reactElement === true,
    `${name}组件必须返回 React.createElement 的元素，而不是普通对象`);
}
const glyph = views[0].Comp({ size: 16, active: false }).children[0];
assert.ok(glyph && glyph.__reactElement === true, '侧栏图标是 React 元素');
const svg = glyph.tag({ size: 16, active: false });
assert.ok(svg && svg.__reactElement === true && svg.tag === 'svg', '侧栏图标渲染出 <svg> 元素');
console.log('PASS  组件走 React.createElement（图标渲染出 <svg>）');
console.log('PASS  slots 注入 sidebar.panellist(共振) + main(resonance)');

// 5) 敌意 ctx（读任何未声明服务都抛）→ apply 必须吞掉，不能带崩 web boot
const hostile = new Proxy({}, { get(t, k) { if (k === 'slots') return ctx.slots; if (typeof k === 'symbol' || k === 'then') return undefined; throw new Error('undeclared: ' + String(k)); } });
let threw = null;
try { mod.apply(hostile); } catch (e) { threw = e; }
assert.equal(threw, null, '敌意 ctx 下 apply 不抛');
console.log('PASS  敌意 ctx 被吞掉，web boot 安全');

// 6) 彻底坏掉的 ctx（连 slots 都抛）→ 同样不抛
const broken = new Proxy({}, { get() { throw new Error('host exploded'); } });
threw = null;
try { mod.apply(broken); } catch (e) { threw = e; }
assert.equal(threw, null, 'slots 都抛时 apply 也不抛');
console.log('PASS  最坏情况（slots 本身抛）也被吞掉');

console.log('\n6 项客户端加载契约全部通过');
