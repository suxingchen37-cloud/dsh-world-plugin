// dsh-local-computer · 客户端入口（DSH 渲染层）。
//
// 职责只有两件：在 DeepSeek 侧栏挂「共振」入口；点开后在应用内全屏承载控制台页面
// （iframe 指向宿主插件的 loopback 服务，端口 47941 起自动探测）。
// 页面本体在 host/capabilities/console/web/ —— 这里不做任何业务。
//
// 加载契约（test/test_client_loader.mjs 逐条守着，违反任何一条都会让 web boot 失败）：
//   1. 本文件被宿主当【普通脚本】求值：绝不出现 ESM 的 import/export 语句。
//   2. 末尾 window.__ModuleLoader__.load({ id, factory })，factory(require) 返回
//      { inject: ['slots'], apply(ctx) }。
//   3. apply 里的一切都要兜异常——这个模块永远不能成为 web boot 失败的原因。
(function (root) {
  'use strict';
  var NS = 'dsh-local-computer';
  var VIEW_KEY = 'resonance';
  var PORT_BASE = 47941, PORT_TRIES = 5;
  var resolvedPort = null;
  var React = null;      // factory(require('react')) 之后才有
  var C = null;          // defineComponents() 之后的 { Glyph, ConsolePage }

  function h(tag, props) {
    var children = Array.prototype.slice.call(arguments, 2);
    return { tag: tag, props: props || {}, children: children };
  }
  function crash(where, e) {
    try { console.error('[' + NS + '] ' + where + ' failed:', e && (e.stack || e.message) || e); } catch (_) { }
  }

  // 端口探测：宿主插件起的 loopback 服务在 47941-47945。iframe onload = 端口活着
  // （无论返回什么内容）；onerror/超时 = 换下一个。全程不依赖 CORS。
  function probePort(i, onOk, onFail) {
    if (typeof document === 'undefined') return onFail();
    if (i >= PORT_TRIES) return onFail();
    var port = PORT_BASE + i;
    var frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    var done = false;
    var settle = function (ok) {
      if (done) return; done = true;
      clearTimeout(timer);
      try { document.body.removeChild(frame); } catch (_) { }
      if (ok) { resolvedPort = port; onOk(port); } else probePort(i + 1, onOk, onFail);
    };
    var timer = setTimeout(function () { settle(false); }, 1200);
    frame.onload = function () { settle(true); };
    frame.onerror = function () { settle(false); };
    frame.src = 'http://127.0.0.1:' + port + '/health?t=' + Date.now();
    try { document.body.appendChild(frame); } catch (_) { settle(false); }
  }

  // React 拿到之后才能定义组件类（生命周期要挂原型）。
  function defineComponents() {
    var Glyph = function () {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
        style: { display: 'block' },
      },
        h('path', { d: 'M3 8a5 5 0 0 1 10 0', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
        h('path', { d: 'M5.5 8a2.5 2.5 0 0 1 5 0', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
        h('circle', { cx: 8, cy: 10.5, r: 1.4, fill: 'currentColor' }));
    };

    var Boundary = function (props) {
      React.Component.call(this, props);
      this.state = { error: null };
    };
    Boundary.prototype = Object.create(React.Component.prototype);
    Boundary.prototype.constructor = Boundary;
    Boundary.prototype.render = function () {
      if (!this.state.error) return this.props.children;
      return h('div', { style: { padding: 40, fontFamily: 'sans-serif' } },
        h('b', null, '共振界面渲染失败'),
        h('p', { style: { color: '#6e7178' } }, String(this.state.error && this.state.error.message || this.state.error)),
        h('button', { onClick: function () { this.setState({ error: null }); }.bind(this) }, '重试'));
    };

    var ConsolePage = function () {
      React.Component.call(this, arguments[0] || {});
      this.state = { port: resolvedPort, failed: false };
    };
    ConsolePage.prototype = Object.create(React.Component.prototype);
    ConsolePage.prototype.constructor = ConsolePage;
    ConsolePage.prototype.render = function () {
      var self = this;
      if (self.state.port) {
        return h('iframe', {
          src: 'http://127.0.0.1:' + self.state.port + '/',
          style: { width: '100%', height: '100%', border: 'none', display: 'block', background: '#ffffff' },
          title: '共振',
        });
      }
      if (self.state.failed) {
        return h('div', { style: { height: '100%', display: 'grid', placeItems: 'center', fontFamily: 'sans-serif' } },
          h('div', { style: { textAlign: 'center' } },
            h('b', null, '控制台没有响应'),
            h('p', { style: { color: '#6e7178' } }, '宿主插件可能没有挂载（127.0.0.1:' + PORT_BASE + '-' + (PORT_BASE + PORT_TRIES - 1) + ' 都不通）。'),
            h('button', { onClick: function () { self.setState({ failed: false }); probe(function () { self.setState({ port: resolvedPort, failed: false }); }, function () { self.setState({ failed: true }); }); } }, '重 试')));
      }
      return h('div', { style: { height: '100%', display: 'grid', placeItems: 'center', fontFamily: 'sans-serif', color: '#6e7178' } }, '正在连接控制台…');
    };
    ConsolePage.prototype.componentDidMount = function () {
      var self = this;
      if (self.state.port) return;
      probe(function (port) { try { self.setState({ port: port, failed: false }); } catch (_) { } },
            function () { try { self.setState({ failed: true }); } catch (_) { } });
    };
    function probe(onOk, onFail) { probePort(0, onOk, onFail); }

    return { Glyph: Glyph, ConsolePage: ConsolePage, Boundary: Boundary };
  }

  function withBoundary(Inner, where) {
    return function (props) {
      try { return h(C.Boundary, null, h(Inner, props)); }
      catch (e) { crash('slot ' + where, e); return null; }
    };
  }

  function apply(ctx) {
    // cordis 的 ctx 对未声明服务直接抛异常：一切超出 inject 声明的访问都进兜底。
    var reg = function (name, fn) {
      try { fn(); return 'ok'; } catch (e) { crash('slot ' + name, e); return String(e && e.message || e); }
    };
    var r1 = reg('sidebar.panellist', function () {
      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist', id: VIEW_KEY, order: 10,
          label: function () { return '共振'; },
        }, withBoundary(C.Glyph, 'sidebar.panellist'));
      });
    });
    var r2 = reg('main', function () {
      ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: VIEW_KEY }, withBoundary(C.ConsolePage, 'main'));
      });
    });
    try { console.log('[' + NS + '] client mounted, slots:', r1, r2); } catch (_) { }
  }

  // 自注册：与宿主自带 client bundle 同一通道。factory 里拿 React、定义组件类。
  if (root && root.__ModuleLoader__ && root.__ModuleLoader__.load) {
    root.__ModuleLoader__.load({
      id: NS,
      factory: function (require) {
        try { React = require('react'); } catch (e) { crash('require react', e); }
        try { C = defineComponents(); } catch (e) { crash('define components', e); C = null; }
        return {
          inject: ['slots'],
          apply: function (ctx) {
            try { return apply(ctx); }
            catch (e) {
              crash('apply', e);
              return { inject: [] };       // 宁可没有入口，也不能连累 web boot
            }
          },
        };
      },
    });
  } else {
    crash('boot', new Error('__ModuleLoader__ 不存在——宿主加载通道变了'));
  }

  root.__DSH_LOCAL_COMPUTER_CLIENT__ = { viewKey: VIEW_KEY, portBase: PORT_BASE };
})(typeof window !== 'undefined' ? window : globalThis);
