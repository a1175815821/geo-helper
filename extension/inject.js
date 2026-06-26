// inject.js - MAIN world (V6.0)
// Proxy 包装 fetch/XHR 拦截街景响应体，通过随机事件名传回 content script
// Proxy 透明转发 toString，无需 defineProperty 伪装

(() => {
  'use strict';

  // ============== 调试开关（生产期 false 全部静默）==============
  const __GEO_DEBUG__ = false;
  const _log = console.log.bind(console);
  const dbg = __GEO_DEBUG__ ? (...a) => _log('[Geo]', ...a) : () => {};

  const TARGET = /GetMetadata|getPanoInfo|getQQPanoInfo/;

  // 从 DOM attribute 读取 per-session 随机事件名（不写入代码常量）
  function getEvt() {
    return document.documentElement.getAttribute('data-v') || '';
  }

  // ============== hook fetch（Proxy 包装）==============
  const origFetch = window.fetch;
  const fetchProxy = new Proxy(origFetch, {
    apply(target, thisArg, args) {
      const input = args[0];
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const p = Reflect.apply(target, thisArg, args);
      if (TARGET.test(url)) {
        dbg('[fetch] 命中:', url);
        p.then(function(resp) {
          try {
            const clone = resp.clone();
            clone.text().then(function(body) {
              const evt = getEvt();
              if (evt) window.dispatchEvent(new CustomEvent(evt, { detail: { url, body } }));
            }).catch(function() {});
          } catch (e) {}
        }).catch(function() {});
      }
      return p;
    }
  });
  window.fetch = fetchProxy;

  // ============== hook XMLHttpRequest（Proxy 包装）==============
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  // 用 WeakMap 存 url，不在 XHR 实例上留任何属性
  const urlMap = new WeakMap();

  const openProxy = new Proxy(origOpen, {
    apply(target, thisArg, args) {
      urlMap.set(thisArg, args[1]);
      return Reflect.apply(target, thisArg, args);
    }
  });
  XMLHttpRequest.prototype.open = openProxy;

  const sendProxy = new Proxy(origSend, {
    apply(target, thisArg, args) {
      const url = urlMap.get(thisArg) || '';
      if (TARGET.test(url)) {
        dbg('[XHR] 命中:', url);
        thisArg.addEventListener('load', function() {
          try {
            const body = thisArg.responseText;
            const evt = getEvt();
            if (evt) window.dispatchEvent(new CustomEvent(evt, { detail: { url, body } }));
          } catch (e) {}
        });
      }
      return Reflect.apply(target, thisArg, args);
    }
  });
  XMLHttpRequest.prototype.send = sendProxy;
})();
