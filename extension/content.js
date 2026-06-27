// content.js - ISOLATED world (V6.0)
// 悬浮窗 Shadow DOM closed + template 派生，host 不带 inline style
// 随机事件名通信，F8 canvas focus gate，heartbeat jitter

(() => {
  'use strict';

  // ============== 调试开关（生产期 false 全部静默）==============
  const __GEO_DEBUG__ = false;
  const _log = console.log.bind(console);
  const dbg = __GEO_DEBUG__ ? (...a) => _log('[Geo]', ...a) : () => {};

  // ============== per-session 随机事件名（不写入代码常量）==============
  const EVT = Array.from(crypto.getRandomValues(new Uint8Array(16)),
    b => b.toString(16).padStart(2, '0')).join('');
  try { document.documentElement.setAttribute('data-v', EVT); } catch (e) {}

  // ============== 悬浮窗（Shadow DOM closed + template 派生）==============
  const host = document.createElement('div');
  // host 不设 inline style，特征交给 :host 规则，规避 MutationObserver 属性扫描
  const sr = host.attachShadow({ mode: 'closed' });
  const tpl = document.createElement('template');
  tpl.innerHTML = `
    <style>
      :host {
        all: initial;
        position: absolute;
        left: 0; top: 0;
        width: 0; height: 0;
        overflow: hidden;
        pointer-events: none;
      }
      #box {
        position: fixed; top: 12px; right: 12px;
        width: 300px; padding: 14px 16px;
        background: rgba(18,20,26,0.95); color: #e8e8e8;
        font-family: -apple-system, "Microsoft YaHei", sans-serif;
        font-size: 12px; line-height: 1.6;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        cursor: move; user-select: none;
        z-index: 2147483647;
        visibility: visible;
        opacity: 0; transform: translateY(-8px) scale(0.98);
        transition: opacity 0.18s ease, transform 0.18s ease;
        pointer-events: none;
      }
      #box.show { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
      #box.hide { opacity: 0; transform: translateY(-8px) scale(0.98); pointer-events: none; }
      .row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 5px; }
      .row:last-child { margin-bottom: 0; }
      .ic { flex-shrink: 0; width: 14px; height: 14px; margin-top: 2px; opacity: 0.9; }
      .ic svg { width: 100%; height: 100%; display: block; }
      .tx { flex: 1; min-width: 0; word-break: break-word; }
      .a .tx { color: #00d1b2; font-weight: 600; font-size: 13px; }
      .h .tx { color: #ffdd57; font-weight: 600; font-size: 13px; }
      .r .tx { color: #48c774; }
      .d .tx { color: #b86bff; font-style: italic; }
      .l .tx { color: #3273dc; font-size: 11px; }
      .s .tx { color: #ccc; font-size: 12px; }
      .row.hidden { display: none; }
      .src { color: #666; font-size: 10px; margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; gap: 4px; }
      .src.ai { color: #48c774; }
      .src.local { color: #ffdd57; }
      .src.err { color: #ff3860; }
      .dot-ic { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block; }
    </style>
    <div id="box">
      <div class="row s" id="status-row"><div class="ic" id="status-ic"></div><div class="tx" id="status">等待中...</div></div>
      <div class="row a" id="addr-row"><div class="ic"></div><div class="tx" id="addr"></div></div>
      <div class="row h" id="head-row"><div class="ic"></div><div class="tx" id="head"></div></div>
      <div class="row r" id="rough-row"><div class="ic"></div><div class="tx" id="rough"></div></div>
      <div class="row d" id="desc-row"><div class="ic"></div><div class="tx" id="desc"></div></div>
      <div class="row l" id="link-row"><div class="ic"></div><div class="tx" id="link"></div></div>
      <div class="src" id="src"></div>
    </div>
  `;
  sr.appendChild(tpl.content.cloneNode(true));

  // 挂载 host（优先 documentElement，避免直接 child 到 body 的典型特征）
  function mountHost() {
    try {
      (document.documentElement || document.body).appendChild(host);
      return true;
    } catch (e) { return false; }
  }
  if (!mountHost()) {
    document.addEventListener('DOMContentLoaded', () => mountHost(), { once: true });
  }

  const box = sr.getElementById('box');
  const elStatus = sr.getElementById('status');
  const elAddr = sr.getElementById('addr');
  const elHead = sr.getElementById('head');
  const elRough = sr.getElementById('rough');

  // SVG 图标库（替代 emoji，避免字体不支持）
  const ICONS = {
    addr: '<svg viewBox="0 0 24 24" fill="none" stroke="#00d1b2" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="#ffdd57" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="#48c774" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="#b86bff" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="#3273dc" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="#48c774" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="#ffdd57" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="#ff3860" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };
  function setIcon(rowId, iconKey) {
    const ic = sr.querySelector('#' + rowId + ' .ic');
    if (ic) ic.innerHTML = ICONS[iconKey] || '';
  }
  const elDesc = sr.getElementById('desc');
  const elLink = sr.getElementById('link');
  const elSrc = sr.getElementById('src');

  // ============== 显示/隐藏切换 ==============
  let visible = true;
  box.classList.add('show');
  function toggle() {
    visible = !visible;
    if (visible) {
      box.classList.remove('hide');
      box.classList.add('show');
    } else {
      box.classList.remove('show');
      box.classList.add('hide');
    }
  }
  // F8 切换（canvas focus gate：仅焦点在 canvas 时响应）
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'F8') return;
    const ae = document.activeElement;
    if (!ae || ae.tagName !== 'CANVAS') return;
    e.preventDefault();
    toggle();
  }, true);

  // ============== 拖动 ==============
  let dragging = false, dx = 0, dy = 0;
  const onMove = (e) => {
    if (!dragging) return;
    box.style.left = (e.clientX - dx) + 'px';
    box.style.top = (e.clientY - dy) + 'px';
    box.style.right = 'auto';
  };
  const onUp = () => {
    dragging = false;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
  };
  box.addEventListener('pointerdown', (e) => {
    dragging = true;
    dx = e.clientX - box.offsetLeft;
    dy = e.clientY - box.offsetTop;
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
  });

  // ============== 心跳保活 SW（jitter 22-28s 随机化）==============
  function schedulePing() {
    const jitter = 22000 + Math.random() * 6000;
    setTimeout(() => {
      try {
        if (chrome.runtime?.id) {
          chrome.runtime.sendMessage({ type: 'ping' }).catch(() => {});
        }
      } catch {}
      schedulePing();
    }, jitter);
  }
  schedulePing();

  // ============== 接收 background 推送 ==============
  setIcon('status-row', 'clock');
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'result') return;
    if (msg.data) {
      render(msg.data);
    } else {
      sr.getElementById('status-row').classList.remove('hidden');
      elStatus.textContent = msg.error || '未识别到坐标';
      setIcon('status-row', 'warn');
    }
  });

  function render(d) {
    sr.getElementById('status-row').classList.add('hidden');
    elAddr.textContent = d.addr + (d.panoName ? ` (${d.panoName})` : '');
    setIcon('addr-row', 'addr');
    if (d.info) {
      const head = [d.info.continent, d.info.country, d.info.dir].filter(Boolean).join('  |  ');
      elHead.textContent = head;
      elRough.textContent = d.info.rough || '';
      elDesc.textContent = d.info.desc || '';
      setIcon('head-row', 'globe');
      setIcon('rough-row', 'pin');
      setIcon('desc-row', 'spark');
    }
    const lat = Number(d.coord.lat).toFixed(6);
    const lng = Number(d.coord.lng).toFixed(6);
    elLink.textContent = `Google Maps: @${lat},${lng},6z`;
    setIcon('link-row', 'map');
    elSrc.className = 'src';
    const srcMap = {
      'ai': { cls: 'ai', icon: 'check', text: 'AI 解析' },
      'local': { cls: 'local', icon: 'warn', text: '本地降级 (AI 未配置或失败)' },
      'local(timeout)': { cls: 'local', icon: 'warn', text: '本地降级 (AI 超时)' },
      'none': { cls: 'err', icon: 'cross', text: '无信息源' }
    };
    const s = srcMap[d.aiSource] || { cls: 'err', icon: 'cross', text: '未知: ' + d.aiSource };
    elSrc.classList.add(s.cls);
    elSrc.innerHTML = `<span class="dot-ic"></span>${s.text}`;
  }

  // ============== 监听 inject.js (MAIN world) 通过随机事件名传来的响应体 ==============
  window.addEventListener(EVT, (e) => {
    try {
      const { url, body } = e.detail;
      chrome.runtime.sendMessage({ type: 'streetview', url, body }).catch(() => {});
    } catch (err) {}
  });
})();
