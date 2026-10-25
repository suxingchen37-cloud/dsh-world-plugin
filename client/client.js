// dsh-local-computer · 客户端入口（DSH 渲染层）。
//
// 职责只有两件：在 DeepSeek 左侧栏挂「共振」入口；点开后在应用内全屏承载控制台页面
// （iframe 指向宿主插件的 loopback 服务，端口 47941 起自动探测）。
// 页面本体在 host/capabilities/console/web/ —— 这里不做任何业务。
//
// 加载契约（test/test_client_loader.mjs 逐条守着，违反任何一条都会让 web boot 失败）：
//   1. 本文件被宿主当【普通脚本】求值：绝不出现 ESM 的 import/export 语句。
//   2. 末尾 window.__ModuleLoader__.load({ id, factory })，factory(require) 返回
//      { inject: ['slots'], apply(ctx) }。
//   3. apply 里的一切都要兜异常——这个模块永远不能成为 web boot 失败的原因。
//   4. 组件必须返回真正的 React 元素（React.createElement），不能返回 {tag, props,
//      children} 这类普通对象：slot 渲染器是 React，返回普通对象会让该注册渲染失败
//      并被降级（侧栏入口 active:false，用户看不到入口）。
(function (root) {
  'use strict';
  var NS = 'dsh-local-computer';
  var VIEW_KEY = 'resonance';
  var PORT_BASE = 47941;
  var PORT_TRIES = 5;
  var PROBE_DEADLINE = 6000; // 整轮端口探测的总时限（毫秒）

  var React = null;        // factory(require('react')) 之后才有
  var components = null;   // defineComponents() 之后的 { Glyph, ConsolePage, Boundary }
  var resolvedPort = null; // 探测成功的端口，跨组件实例复用

  function crash(where, error) {
    try {
      console.error('[' + NS + '] ' + where + ' failed:', (error && (error.stack || error.message)) || error);
    } catch (_) { /* logging must never throw */ }
  }

  // 一切组件都用 React.createElement；在 factory 里拿到 React 之后再定义，
  // 这样测试里的假 React 也能驱动同一套代码。
  function defineComponents(ReactApi) {
    var h = ReactApi.createElement;

    // 侧栏入口图标：信号弧 + 点（沿用「共振」的旧识别符号）。
    // owner 传 { size, active }——size 跟随侧栏展开/收起。
    function Glyph(props) {
      var size = (props && props.size) || 16;
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', focusable: 'false',
        style: { display: 'block', flex: 'none' },
      },
        h('path', {
          d: 'M3 8a5 5 0 0 1 10 0', stroke: 'currentColor', strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M5.5 8a2.5 2.5 0 0 1 5 0', stroke: 'currentColor', strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 8, cy: 10.5, r: 1.4, fill: 'currentColor' }));
    }

    // 渲染兜底：插件的 UI 出错只让这一格显示错误，不牵连整个 web boot。
    class Boundary extends ReactApi.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error: error };
      }
      componentDidCatch(error, info) {
        crash('slot render', error);
      }
      render() {
        var error = this.state.error;
        if (!error) return this.props.children;
        return h('div', {
          style: {
            padding: 32, fontFamily: 'system-ui, "Segoe UI", sans-serif',
            color: '#6e7178', fontSize: 13, lineHeight: 1.6,
          },
        },
          h('div', { style: { fontWeight: 600, color: '#c0392b', marginBottom: 6 } }, '共振界面渲染失败'),
          h('div', null, String((error && error.message) || error)),
          h('button', {
            type: 'button',
            onClick: function () { this.setState({ error: null }); }.bind(this),
            style: { marginTop: 12, padding: '4px 12px', cursor: 'pointer' },
          }, '重试'));
      }
    }

    // 主面板：承载控制台页面。
    // 端口探测：no-cors fetch——不读响应、不需要 CORS，端口活着就 resolve（哪怕 404），
    // 端口拒绝则 reject。比隐藏 iframe 可靠：iframe 在连接被拒时也可能触发 onload。
    function ConsolePage() {
      var portState = ReactApi.useState(resolvedPort);
      var port = portState[0];
      var setPort = portState[1];
      var failedState = ReactApi.useState(false);
      var failed = failedState[0];
      var setFailed = failedState[1];
      var attemptState = ReactApi.useState(0);
      var attempt = attemptState[0];
      var setAttempt = attemptState[1];

      ReactApi.useEffect(function () {
        if (port) return undefined;
        var live = true;
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var signal = controller ? controller.signal : undefined;
        var deadline = setTimeout(function () { if (controller) controller.abort(); }, PROBE_DEADLINE);

        function probe(candidate) {
          return fetch('http://127.0.0.1:' + candidate + '/health?t=' + Date.now(), {
            mode: 'no-cors', cache: 'no-store', signal: signal,
          }).then(function () { return true; }, function () { return false; });
        }

        (async function () {
          for (var i = 0; i < PORT_TRIES; i += 1) {
            if (!live) return;
            var candidate = PORT_BASE + i;
            var ok = await probe(candidate);
            if (!live) return;
            if (ok) {
              resolvedPort = candidate;
              setFailed(false);
              setPort(candidate);
              return;
            }
          }
          if (live) setFailed(true);
        })();

        setFailed(false);
        return function () {
          live = false;
          clearTimeout(deadline);
          if (controller) { try { controller.abort(); } catch (_) { } }
        };
      }, [port, attempt]);

      if (port) {
        return h('iframe', {
          src: 'http://127.0.0.1:' + port + '/',
          title: '共振',
          style: {
            width: '100%', height: '100%', border: 'none', display: 'block',
            background: '#ffffff',
          },
        });
      }

      if (failed) {
        return h('div', {
          style: {
            height: '100%', display: 'grid', placeItems: 'center',
            fontFamily: 'system-ui, "Segoe UI", sans-serif', color: '#6e7178',
          },
        },
          h('div', { style: { textAlign: 'center', maxWidth: 420, padding: 24, lineHeight: 1.7 } },
            h('div', { style: { fontWeight: 600, color: '#333', marginBottom: 6 } }, '控制台没有响应'),
            h('div', null,
              '宿主插件可能没有挂载（127.0.0.1:' + PORT_BASE + '-' + (PORT_BASE + PORT_TRIES - 1) + ' 都不通）。'),
            h('button', {
              type: 'button',
              onClick: function () { setAttempt(attempt + 1); },
              style: { marginTop: 14, padding: '5px 14px', cursor: 'pointer' },
            }, '重试')));
      }

      return h('div', {
        style: {
          height: '100%', display: 'grid', placeItems: 'center',
          fontFamily: 'system-ui, "Segoe UI", sans-serif', color: '#6e7178',
        },
      }, '正在连接控制台…');
    }

    return { Glyph: Glyph, ConsolePage: ConsolePage, Boundary: Boundary };
  }

  function withBoundary(Inner, where) {
    return function (props) {
      try {
        return React.createElement(components.Boundary, null,
          React.createElement(Inner, props));
      } catch (error) {
        crash('slot ' + where, error);
        return null;
      }
    };
  }

  function apply(ctx) {
    // cordis 的 ctx 对未声明服务直接抛异常：一切超出 inject 声明的访问都进兜底。
    function reg(name, run) {
      try { run(); return 'ok'; } catch (error) { crash('slot ' + name, error); return String((error && error.message) || error); }
    }

    var sidebar = reg('sidebar.panellist', function () {
      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist', id: VIEW_KEY, order: 10,
          label: function () { return '共振'; },
        }, withBoundary(components.Glyph, 'sidebar.panellist'));
      });
    });

    var main = reg('main', function () {
      ctx.slots.inject('main', function () {
        return ctx.slots.register(
          { name: 'main', key: VIEW_KEY },
          withBoundary(components.ConsolePage, 'main'));
      });
    });

    try { console.log('[' + NS + '] client mounted, slots:', sidebar, main); } catch (_) { }
  }

  // 自注册：与宿主自带 client bundle 同一通道。factory 里拿 React、定义组件。
  if (root && root.__ModuleLoader__ && root.__ModuleLoader__.load) {
    root.__ModuleLoader__.load({
      id: NS,
      factory: function (require) {
        try { React = require('react'); } catch (error) { crash('require react', error); }
        if (React && typeof React.createElement === 'function' && typeof React.Component === 'function') {
          try { components = defineComponents(React); } catch (error) { crash('define components', error); components = null; }
        } else {
          components = null;
        }
        return {
          inject: ['slots'],
          apply: function (ctx) {
            try {
              if (!components) {
                crash('apply', new Error('React 不可用，跳过界面注册'));
                return;
              }
              apply(ctx);
            } catch (error) {
              // 宁可没有入口，也不能连累 web boot。
              crash('apply', error);
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
