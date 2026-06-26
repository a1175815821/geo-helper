// content.js - 注入到 tuxun.fun (V4)
// 只负责显示悬浮窗，完全不碰网络（响应体由 background 用 webRequest 拦截）
// 不 hook 任何原生 API，不发二次请求，心跳保活 SW
// host 伪装成普通页面元素，规避 MutationObserver + elementFromPoint 检测

(() => {
  'use strict';

  // ============== 悬浮窗（Shadow DOM closed）==============
  const host = document.createElement('div');
  // 伪装成页面普通容器：不带 fixed/0x0/异常 z-index 特征
  // 用 visibility:hidden + 绝对定位到视口外，不参与 hit-test
  host.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none;';
  const sr = host.attachShadow({ mode: 'closed' });
  sr.innerHTML = `
    <style>
      :host { all: initial; }
      #box {
        display: none;
        position: fixed; top: 12px; right: 12px;
        width: 280px; padding: 10px 12px;
        background: rgba(20,22,28,0.92); color: #e8e8e8;
        font-family: -apple-system, "Microsoft YaHei", sans-serif;
        font-size: 12px; line-height: 1.5;
        border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        backdrop-filter: blur(8px);
        cursor: move; user-select: none;
        z-index: 9999;
      }
      #box.show { display: block; }
      .h { color: #ffdd57; font-weight: 600; font-size: 13px; margin-bottom: 4px; }
      .a { color: #00d1b2; font-weight: 600; margin-bottom: 3px; }
      .r { color: #48c774; }
      .d { color: #b86bff; margin-top: 3px; }
      .l { color: #3273dc; margin-top: 4px; font-size: 11px; word-break: break-all; }
      .s { color: #888; font-size: 11px; }
      #dot {
        position: fixed; top: 8px; right: 8px;
        width: 6px; height: 6px; border-radius: 50%;
        background: #48c774; opacity: 0;
        pointer-events: none; z-index: 9999;
        transition: opacity 0.2s;
      }
      #dot.show { opacity: 1; }
      #dot.err { background: #ff3860; }
    </style>
    <div id="dot"></div>
    <div id="box">
      <div class="s" id="status">等待中...</div>
      <div class="a" id="addr"></div>
      <div class="h" id="head"></div>
      <div class="r" id="rough"></div>
      <div class="d" id="desc"></div>
      <div class="l" id="link"></div>
    </div>
  `;
  // document_start 时 documentElement 已存在，立即挂载
  // 伪装成 head 之前的占位元素，不引发可疑的 fixed/0x0 特征
  document.documentElement.appendChild(host);

  const box = sr.getElementById('box');
  const dot = sr.getElementById('dot');
  const elStatus = sr.getElementById('status');
  const elAddr = sr.getElementById('addr');
  const elHead = sr.getElementById('head');
  const elRough = sr.getElementById('rough');
  const elDesc = sr.getElementById('desc');
  const elLink = sr.getElementById('link');

  // ============== 显示/隐藏切换 ==============
  let visible = false;
  function toggle() {
    visible = !visible;
    box.classList.toggle('show', visible);
  }
  // Alt+H 切换（避开 F8 调试冲突、Ctrl+` 输入法冲突）
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      toggle();
    }
  }, true);

  // ============== 拖动（pointer events，仅拖动期间注册 move/up）==============
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

  // ============== 心跳保活 SW ==============
  setInterval(() => {
    chrome.runtime.sendMessage({ type: 'ping' }).catch(() => {});
  }, 25000);

  // ============== 接收 background 推送 ==============
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'result') return;
    if (msg.data) {
      render(msg.data);
      dot.classList.remove('err');
      dot.classList.add('show');
      setTimeout(() => dot.classList.remove('show'), 2000);
    } else {
      elStatus.textContent = msg.error || '未识别到坐标';
      dot.classList.add('err', 'show');
      setTimeout(() => dot.classList.remove('show'), 3000);
    }
  });

  function render(d) {
    elStatus.textContent = '';
    elAddr.textContent = d.addr + (d.panoName ? ` (${d.panoName})` : '');
    if (d.info) {
      const head = [d.info.continent, d.info.country, d.info.dir].filter(Boolean).join('  |  ');
      elHead.textContent = head;
      elRough.textContent = d.info.rough || '';
      elDesc.textContent = d.info.desc || '';
    }
    elLink.textContent = `Google Maps: @${d.coord.lat},${d.coord.lng},6z`;
  }
})();
