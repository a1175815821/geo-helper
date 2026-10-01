const KEYS = ['enabled', 'aiEnabled', 'mapSource', 'amapKey', 'aiBase', 'aiKey', 'aiModel'];

chrome.storage.sync.get(KEYS, (s) => {
  KEYS.forEach(k => {
    const el = document.getElementById(k);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = s[k] !== false;
    else el.value = s[k] || '';
  });
});

// 版本号跟随 manifest，避免文档滞后；Keys 默认脱敏
try {
  const verEl = document.getElementById('ver');
  if (verEl && chrome.runtime && chrome.runtime.getManifest) {
    verEl.textContent = 'v' + chrome.runtime.getManifest().version;
  }
} catch {}
const showKeysEl = document.getElementById('showKeys');
if (showKeysEl) {
  showKeysEl.addEventListener('change', () => {
    const t = showKeysEl.checked ? 'text' : 'password';
    const a = document.getElementById('amapKey');
    const k = document.getElementById('aiKey');
    if (a) a.type = t;
    if (k) k.type = t;
  });
}

function validate() {
  const errs = [];
  const amapKey = document.getElementById('amapKey').value.trim();
  const mapSource = document.getElementById('mapSource').value;
  const aiBase = document.getElementById('aiBase').value.trim();
  const aiKey = document.getElementById('aiKey').value.trim();
  const aiModel = document.getElementById('aiModel').value.trim();

  // 高德 Key：选了高德源时必须 32 位
  if (mapSource === '1') {
    if (!amapKey) errs.push('选了高德源但未填 Key');
    else if (!/^[a-zA-Z0-9]{32}$/.test(amapKey)) errs.push('高德 Key 应为 32 位字母数字');
  }

  // AI 配置：填了一项就三项都必须填
  if (aiBase || aiKey || aiModel) {
    if (!aiBase) errs.push('AI BaseURL 未填');
    else if (!/^https?:\/\//.test(aiBase)) errs.push('AI BaseURL 必须以 http:// 或 https:// 开头');
    if (!aiKey) errs.push('AI Key 未填');
    else if (!/^(sk-)?[a-zA-Z0-9\-_]{10,}$/.test(aiKey)) errs.push('AI Key 格式异常');
    if (!aiModel) errs.push('AI 模型名未填');
  }

  return errs;
}

document.getElementById('save').addEventListener('click', () => {
  const errs = validate();
  const tip = document.getElementById('tip');
  if (errs.length) {
    tip.style.color = '#ff3860';
    tip.textContent = errs.join('；');
    return;
  }
  const data = {};
  KEYS.forEach(k => {
    const el = document.getElementById(k);
    if (!el) return;
    data[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
  });
  chrome.storage.sync.set(data, () => {
    const btn = document.getElementById('save');
    btn.textContent = '已保存';
    tip.style.color = '#48c774';
    tip.textContent = '保存成功';
    setTimeout(() => { btn.textContent = '保存'; tip.textContent = ''; }, 1500);
  });
});
