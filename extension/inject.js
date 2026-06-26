// inject.js - 注入到 page world (MAIN world)
// hook fetch + XMLHttpRequest 拦截街景响应体，通过 CustomEvent 传回 content script
// 用 clone() 读响应不影响游戏，伪装 toString 避免检测

(() => {
  console.log('[Geo Helper] inject.js 已加载到 page world');
  const TARGET = /GetMetadata|getPanoInfo|getQQPanoInfo/;
  const origFetch = window.fetch;

  // ============== hook fetch ==============
  const hookedFetch = function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const p = origFetch.apply(this, arguments);
    if (TARGET.test(url)) {
      console.log('[Geo Helper][fetch] 命中:', url);
      p.then(function(resp) {
        try {
          const clone = resp.clone();
          clone.text().then(function(body) {
            console.log('[Geo Helper][fetch] 响应体长度:', body.length);
            window.dispatchEvent(new CustomEvent('__geo_body__', { detail: { url, body } }));
          }).catch(function(err) { console.log('[Geo Helper][fetch] 读体失败:', err); });
        } catch (e) { console.log('[Geo Helper][fetch] clone 失败:', e); }
      }).catch(function() {});
    }
    return p;
  };
  try { Object.defineProperty(hookedFetch, 'toString', { value: function() { return origFetch.toString(); }, configurable: true }); } catch (e) {}
  try { Object.defineProperty(hookedFetch, 'name', { value: 'fetch' }); } catch (e) {}
  try { Object.defineProperty(hookedFetch, 'length', { value: origFetch.length }); } catch (e) {}
  window.fetch = hookedFetch;
  console.log('[Geo Helper] fetch hook 安装完成');

  // ============== hook XMLHttpRequest ==============
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  const hookedOpen = function(method, url) {
    // 记录 url 到 xhr 实例上，send 时用
    this.__geo_url = url;
    return origOpen.apply(this, arguments);
  };

  const hookedSend = function() {
    const xhr = this;
    const url = xhr.__geo_url || '';
    if (TARGET.test(url)) {
      console.log('[Geo Helper][XHR] 命中:', url);
      xhr.addEventListener('load', function() {
        try {
          const body = xhr.responseText;
          console.log('[Geo Helper][XHR] 响应体长度:', body ? body.length : 0, '前50字节:', body ? body.slice(0, 50) : '');
          window.dispatchEvent(new CustomEvent('__geo_body__', { detail: { url, body } }));
        } catch (e) { console.log('[Geo Helper][XHR] 读体失败:', e); }
      });
    }
    return origSend.apply(this, arguments);
  };

  // 伪装
  try { Object.defineProperty(hookedOpen, 'toString', { value: function() { return origOpen.toString(); }, configurable: true }); } catch (e) {}
  try { Object.defineProperty(hookedOpen, 'name', { value: 'open' }); } catch (e) {}
  try { Object.defineProperty(hookedSend, 'toString', { value: function() { return origSend.toString(); }, configurable: true }); } catch (e) {}
  try { Object.defineProperty(hookedSend, 'name', { value: 'send' }); } catch (e) {}

  XMLHttpRequest.prototype.open = hookedOpen;
  XMLHttpRequest.prototype.send = hookedSend;
  console.log('[Geo Helper] XHR hook 安装完成');
})();
