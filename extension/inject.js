// inject.js - MAIN world (V6.1)
// Proxy 包装 fetch/XHR 拦截街景响应体，通过随机事件名传回 content script
// + hook StreetViewPanorama.prototype setPano/setPosition 拿真实坐标，过滤反作弊注入的假请求
// Proxy 透明转发 toString，无需 defineProperty 伪装

(() => {
  'use strict';

  // ============== 调试开关（生产期 false 全部静默）==============
  const __GEO_DEBUG__ = false;
  const _log = console.log.bind(console);
  const dbg = __GEO_DEBUG__ ? (...a) => _log('[Geo]', ...a) : () => {};

  const TARGET = /GetMetadata|getPanoInfo|getQQPanoInfo/;
  // 百度源 URL: tuxun.fun/api/v0/tuxun/mapProxy/getPanoInfo?pano=XXX
  const BAIDU_PANO = /getPanoInfo\?pano=([^&]+)/;

  // 从 DOM attribute 读取 per-session 随机事件名（不写入代码常量）
  function getEvt() {
    return document.documentElement.getAttribute('data-v') || '';
  }

  // ============== 街景实例 panoId 真值跟踪 ==============
  // 反作弊只能注入假 fetch 响应，无法调用 SDK 内部的 setPano
  // 因此 setPano 的参数就是真实街景的 panoId，作为过滤真值
  let currentPano = '';       // 最后一次 setPano 的 panoId

  function installPanoHook() {
    if (typeof google === 'undefined' || !google.maps || !google.maps.StreetViewPanorama) return false;
    const proto = google.maps.StreetViewPanorama.prototype;

    // hook setPano（用作过滤真值）
    const origSetPano = proto.setPano;
    if (origSetPano) {
      proto.setPano = function(p) {
        currentPano = String(p || '');
        _log('[Geo][pano] setPano 触发, panoId:', currentPano, '时间:', Date.now());
        return origSetPano.apply(this, arguments);
      };
    }

    // hook 构造函数（Proxy），拿初始 panoId
    const OrigCtor = google.maps.StreetViewPanorama;
    google.maps.StreetViewPanorama = new Proxy(OrigCtor, {
      construct(target, args) {
        const inst = new target(...args);
        try {
          const opts = args[1] || {};
          if (opts.pano) {
            currentPano = String(opts.pano);
            _log('[Geo][pano] 初始 pano:', currentPano);
          }
        } catch (e) {}
        return inst;
      }
    });

    _log('[Geo][pano] hook 已安装');
    return true;
  }

  // google.maps 可能尚未加载（document_start 时），轮询重试
  function tryHook(retries) {
    if (installPanoHook()) return;
    if (retries > 0) setTimeout(() => tryHook(retries - 1), 100);
  }
  tryHook(100); // 10 秒内重试

  // ============== 响应体 panoId 提取（三源统一）==============
  // 百度/腾讯源：JSON.data.pano 字段
  // Google 源（grpc-web）：递归搜索 [2, "base64url字符串"] 格式
  const PANO_RE = /^[A-Za-z0-9_-]{16,40}$/;

  function extractPanoId(url, body) {
    // 优先尝试 JSON 解析（百度/腾讯源）
    try {
      const d = JSON.parse(body);
      if (d && d.data && d.data.pano) return d.data.pano;
    } catch {}

    // Google 源（GetMetadata）：grpc-web 递归搜索 [2, "string"]
    if (/GetMetadata/.test(url)) {
      let parsed;
      try {
        let txt = body;
        if (txt.startsWith(")]}'")) txt = txt.slice(4);
        try {
          parsed = JSON.parse(txt);
        } catch {
          const code0 = txt.charCodeAt(0);
          if (code0 === 0 || code0 === 1) {
            parsed = JSON.parse(txt.slice(5));
          } else {
            return '';
          }
        }
      } catch { return ''; }

      // 递归找 [2, "base64url字符串"]
      const visited = new WeakSet();
      function walk(n) {
        if (typeof n !== 'object' || n === null) return '';
        if (visited.has(n)) return '';
        visited.add(n);
        if (Array.isArray(n)) {
          if (n.length === 2 && n[0] === 2 && typeof n[1] === 'string' && PANO_RE.test(n[1])) {
            return n[1];
          }
          for (const item of n) {
            const r = walk(item);
            if (r) return r;
          }
        } else {
          for (const k of Object.keys(n)) {
            const r = walk(n[k]);
            if (r) return r;
          }
        }
        return '';
      }
      return walk(parsed);
    }

    return '';
  }

  // ============== 响应体转发（panoId 过滤 + 延迟附加真实坐标）==============
  // 时序（实测）：响应到达(+0) → setPano(+109ms) → setPosition(+112ms)
  // 反作弊会注入假请求让响应在 setPano 之前到达，利用 currentPano 空窗期
  // 修复：必须等 setPano 触发更新 currentPano 后才校验，且 currentPano 为空时拒绝转发
  function forwardBody(url, body) {
    // 提取响应体 panoId（三源统一）
    const respPano = extractPanoId(url, body);

    dbg('[forward] 响应到达, respPano:', respPano, 'currentPano:', currentPano);

    // 延迟 400ms 转发，确保 setPano 已触发更新 currentPano
    setTimeout(() => {
      const evt = getEvt();
      if (!evt) return;

      dbg('[forward] 400ms 后校验, respPano:', respPano, 'currentPano:', currentPano);

      // 校验：currentPano 必须非空，且 respPano 必须匹配 currentPano
      // 反作弊注入的假响应 panoId 不匹配 → 丢弃
      if (!currentPano) {
        dbg('[filter] currentPano 为空，丢弃:', respPano);
        return;
      }
      if (respPano && respPano !== currentPano) {
        dbg('[filter] panoId 不匹配，丢弃:', respPano, '!== current:', currentPano);
        return;
      }

      const detail = { url, body };
      window.dispatchEvent(new CustomEvent(evt, { detail }));
      dbg('[forward] 已转发, respPano:', respPano);
    }, 400);
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
              forwardBody(url, body);
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
            forwardBody(url, body);
          } catch (e) {}
        });
      }
      return Reflect.apply(target, thisArg, args);
    }
  });
  XMLHttpRequest.prototype.send = sendProxy;
})();
