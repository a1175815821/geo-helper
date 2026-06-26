// background.js - service worker
// 所有外部请求在此发起，页面 CSP 和反作弊脚本无法检测

const CFG_DEFAULTS = {
  enabled: true,
  mapSource: '',
  amapKey: '',
  aiBase: '',
  aiKey: '',
  aiModel: 'gpt-4o-mini'
};

async function cfg() {
  return await chrome.storage.sync.get(CFG_DEFAULTS);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 心跳：content 定期 ping，保活 SW，避免长 AI 请求期间被终止
  if (msg.type === 'ping') { sendResponse({ ok: true }); return true; }
  sendResponse(null);
  return true;
});

// ============== webRequest 拦截响应体（零二次请求、零原型污染）==============
// 用 filterResponseData 在 onBeforeRequest 里挂 StreamFilter，
// 收集原始响应体后透传给页面，自己只读不改。
const TARGET_RE = /GetMetadata|getPanoInfo|getQQPanoInfo/;

// 并发去重：同一 tab 短时间内的多个目标请求只推送最后一次结果
const pendingTabs = new Map(); // tabId -> setTimeout id

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!TARGET_RE.test(details.url)) return;
    const filter = chrome.webRequest.filterResponseData(details.requestId);
    const chunks = [];
    filter.ondata = (e) => {
      // try-catch 保证异常时仍透传，避免截断街景响应
      try { chunks.push(e.data); } catch {}
      try { filter.write(e.data); } catch {}
    };
    filter.onstop = async () => {
      filter.disconnect();
      let result = null, errMsg = null;
      try {
        const blob = new Blob(chunks);
        const body = await blob.text();
        const c = await cfg();
        if (c.enabled === false) return;
        // AI 调用加 20 秒超时，避免 SW 等待过久被终止
        result = await Promise.race([
          handleBody(details.url, body, c),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000))
        ]);
        if (!result) errMsg = '未识别到坐标';
      } catch (e) {
        errMsg = e.message === 'timeout' ? 'AI 请求超时，已降级' : '处理失败: ' + e.message;
        if (e.message === 'timeout') {
          try {
            const blob = new Blob(chunks);
            const body = await blob.text();
            const c = await cfg();
            result = await handleBody(details.url, body, c, true);
          } catch {}
        }
      }
      // 直接用 details.tabId 推送，无需 tabs 权限
      const tabId = details.tabId;
      if (tabId < 0) return; // 非页面发起的请求
      // 去抖：同一 tab 500ms 内的多次结果只推最后一次
      if (pendingTabs.has(tabId)) clearTimeout(pendingTabs.get(tabId));
      pendingTabs.set(tabId, setTimeout(() => {
        pendingTabs.delete(tabId);
        const payload = result
          ? { type: 'result', data: result }
          : { type: 'result', data: null, error: errMsg };
        chrome.tabs.sendMessage(tabId, payload).catch(() => {});
      }, 500));
    };
    filter.onerror = () => { try { filter.disconnect(); } catch {} };
  },
  { urls: ["*://*.googleapis.com/*", "*://*.google.com/*", "*://tuxun.fun/*", "*://*.bdimg.com/*", "*://sv.map.qq.com/*"] }
);

// ============== 响应体解析 ==============
// skipAI=true 时跳过 AI，直接走本地降级（用于 AI 超时兜底）
async function handleBody(url, body, c, skipAI = false) {
  let coord = null, pano = null, source = null, str = '';

  if (url.includes('GetMetadata')) {
    try {
      let txt = body;
      if (txt.startsWith(")]}'")) txt = txt.slice(4);
      const d = JSON.parse(txt);
      const m = d[1][0];
      coord = { lat: m[5][0][1][0][2], lng: m[5][0][1][0][3] };
      pano = m[1][1];
      source = 'g';
      str = (m[3][2][0] && m[3][2][0][0]) || '';
    } catch (e) { return null; }
  } else if (/getPanoInfo|getQQPanoInfo/.test(url)) {
    try {
      const d = JSON.parse(body);
      if (d && d.data) {
        coord = { lat: d.data.lat, lng: d.data.lng };
        pano = d.data.pano;
        source = url.includes('getQQ') ? 't' : 'b';
      }
    } catch (e) { return null; }
  }

  if (!coord) return null;

  let g = str;
  if (pano) {
    if (source === 'b') { const b = await bdName(pano); if (b) g = b; }
    else if (source === 't') { const t = await qqName(pano); if (t) g = t; }
  }

  let addr = '';
  if (c.mapSource === '1' && c.amapKey) {
    addr = await amapRegeo(coord.lat, coord.lng, c.amapKey);
  } else {
    addr = await osmReverse(coord.lat, coord.lng);
  }

  let info = null;
  if (!skipAI) {
    info = await aiInfo(coord.lat, coord.lng, { p: source, g, r: addr }, c);
  }
  if (!info) info = await localInfo(coord.lat, coord.lng);

  return { coord, addr, panoName: g, info };
}

// ============== AI ==============
async function aiInfo(lat, lng, raw, c) {
  if (!c.aiBase || !c.aiKey) return null;
  const prompt = `你是地理助手。根据坐标和原始信息，用中文给出结构化结果。

坐标：${lat}, ${lng}
街景源：${raw.p || '未知'}
街景名：${raw.g || '无'}
原始地址：${raw.r || '无'}

请严格返回 JSON（不要markdown，不要多余文字）：
{
  "continent": "洲（中文，如 亚洲/欧洲/北美洲/南美洲/非洲/大洋洲）",
  "country": "国家中文名",
  "dir": "在该国家内的方位（中文，八方位：东北部/北部/西部/中部/西南部 等，小国直接写'中部'）",
  "rough": "详细位置（中文，从大到小：省/州 → 市/区 → 县/镇，尽量具体）",
  "desc": "一句话特征描述（帮助玩家识别，如'沙漠中的小镇''海边港口''阿尔卑斯山区'，不超过20字）"
}`;
  try {
    const r = await fetch(`${c.aiBase.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.aiKey}` },
      body: JSON.stringify({
        model: c.aiModel || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });
    if (!r.ok) return null;
    const d = await r.json();
    const txt = d?.choices?.[0]?.message?.content;
    if (!txt) return null;
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch { return null; }
}

// ============== 地理服务 ==============
async function amapRegeo(lat, lng, key) {
  try {
    const r = await fetch(`https://restapi.amap.com/v3/geocode/regeo?output=json&location=${lng},${lat}&key=${key}&radius=100`);
    const d = await r.json();
    if (d.status === '1' && d.regeocode) {
      const c = d.regeocode.addressComponent;
      return [c.province, c.city, c.district, c.township].filter(x => x && typeof x === 'string').join('');
    }
    return '未知(Key无效?)';
  } catch { return '请求失败'; }
}

async function osmReverse(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=cn`);
    const d = await r.json();
    return d.display_name ? d.display_name.split(',').reverse().slice(0, 4).join('') : '未知';
  } catch { return 'OSM请求失败'; }
}

async function bdName(id) {
  try {
    const r = await fetch(`https://mapsv0.bdimg.com/?qt=sdata&sid=${id}`);
    const d = await r.json();
    return d.content?.[0]?.Rname || '';
  } catch { return ''; }
}

async function qqName(id) {
  try {
    const r = await fetch(`https://sv.map.qq.com/sv?svid=${id}&output=json`);
    const buf = await r.arrayBuffer();
    // TextDecoder 在 service worker 中可用，且支持 GBK
    const txt = new TextDecoder('GBK').decode(buf);
    const j = JSON.parse(txt);
    return j?.detail?.basic?.append_addr || '';
  } catch { return ''; }
}

// ============== 本地降级（AI 失败时）==============
const CC = {
  '中国':'亚洲','China':'亚洲','日本':'亚洲','Japan':'亚洲','韩国':'亚洲','South Korea':'亚洲','越南':'亚洲','Vietnam':'亚洲',
  '泰国':'亚洲','Thailand':'亚洲','印度':'亚洲','India':'亚洲','印度尼西亚':'亚洲','Indonesia':'亚洲','菲律宾':'亚洲','Philippines':'亚洲',
  '马来西亚':'亚洲','Malaysia':'亚洲','新加坡':'亚洲','Singapore':'亚洲','伊朗':'亚洲','Iran':'亚洲','沙特阿拉伯':'亚洲','Saudi Arabia':'亚洲',
  '土耳其':'亚洲/欧洲','Turkey':'亚洲/欧洲','俄罗斯':'欧洲/亚洲','Russia':'欧洲/亚洲',
  '美国':'北美洲','United States':'北美洲','USA':'北美洲','加拿大':'北美洲','Canada':'北美洲','墨西哥':'北美洲','Mexico':'北美洲',
  '巴西':'南美洲','Brazil':'南美洲','阿根廷':'南美洲','Argentina':'南美洲','智利':'南美洲','Chile':'南美洲','哥伦比亚':'南美洲','Colombia':'南美洲',
  '秘鲁':'南美洲','Peru':'南美洲','英国':'欧洲','United Kingdom':'欧洲','U.K.':'欧洲','法国':'欧洲','France':'欧洲',
  '德国':'欧洲','Germany':'欧洲','意大利':'欧洲','Italy':'欧洲','西班牙':'欧洲','Spain':'欧洲','葡萄牙':'欧洲','Portugal':'欧洲',
  '荷兰':'欧洲','Netherlands':'欧洲','瑞士':'欧洲','Switzerland':'欧洲','波兰':'欧洲','Poland':'欧洲','瑞典':'欧洲','Sweden':'欧洲',
  '挪威':'欧洲','Norway':'欧洲','芬兰':'欧洲','Finland':'欧洲','希腊':'欧洲','Greece':'欧洲','乌克兰':'欧洲','Ukraine':'欧洲',
  '澳大利亚':'大洋洲','Australia':'大洋洲','新西兰':'大洋洲','New Zealand':'大洋洲',
  '埃及':'非洲','Egypt':'非洲','南非':'非洲','South Africa':'非洲','尼日利亚':'非洲','Nigeria':'非洲','肯尼亚':'非洲','Kenya':'非洲',
  '摩洛哥':'非洲','Morocco':'非洲','阿尔及利亚':'非洲','Algeria':'非洲','塞内加尔':'非洲','Senegal':'非洲','埃塞俄比亚':'非洲','Ethiopia':'非洲'
};

const CTR = {
  '中国': {lat:35,lng:105,sz:'XL'},'China': {lat:35,lng:105,sz:'XL'},
  'United States': {lat:39,lng:-98,sz:'XL'},'美国': {lat:39,lng:-98,sz:'XL'},
  'Russia': {lat:61,lng:100,sz:'XL'},'俄罗斯': {lat:61,lng:100,sz:'XL'},
  'Canada': {lat:56,lng:-106,sz:'XL'},'加拿大': {lat:56,lng:-106,sz:'XL'},
  'Brazil': {lat:-10,lng:-55,sz:'XL'},'巴西': {lat:-10,lng:-55,sz:'XL'},
  'Australia': {lat:-25,lng:134,sz:'XL'},'澳大利亚': {lat:-25,lng:134,sz:'XL'},
  'India': {lat:22,lng:79,sz:'L'},'印度': {lat:22,lng:79,sz:'L'},
  'Argentina': {lat:-34,lng:-64,sz:'L'},'阿根廷': {lat:-34,lng:-64,sz:'L'},
  'Japan': {lat:36,lng:138,sz:'M'},'日本': {lat:36,lng:138,sz:'M'},
  'France': {lat:46,lng:2,sz:'M'},'法国': {lat:46,lng:2,sz:'M'},
  'Germany': {lat:51,lng:10,sz:'M'},'德国': {lat:51,lng:10,sz:'M'},
  'United Kingdom': {lat:54,lng:-2,sz:'S'},'英国': {lat:54,lng:-2,sz:'S'},
  'Egypt': {lat:27,lng:30,sz:'L'},'埃及': {lat:27,lng:30,sz:'L'},
  'Senegal': {lat:14,lng:-14,sz:'S'},'塞内加尔': {lat:14,lng:-14,sz:'S'}
};

const DT = { XL: [6, 8], L: [4, 5], M: [2, 3], S: [1, 1] };

function dirOf(lat, lng, c) {
  if (!c) return '';
  const T = DT[c.sz] || [2, 3];
  const dLat = lat - c.lat, dLng = lng - c.lng;
  let ns = '', ew = '';
  if (dLat > T[0]) ns = '北';
  else if (dLat < -T[0]) ns = '南';
  if (dLng > T[1]) ew = '东';
  else if (dLng < -T[1]) ew = '西';
  if (!ns && !ew) return '中部';
  return ns + ew + '部';
}

async function localInfo(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=cn&zoom=10`);
    const d = await r.json();
    if (!d || !d.display_name) return null;
    const parts = d.display_name.split(',').map(s => s.trim()).filter(Boolean);
    const country = parts[parts.length - 1] || '';
    const continent = CC[country] || '未知';
    const rough = parts.slice(0, 3).join('，');
    const dir = dirOf(lat, lng, CTR[country]);
    return { continent, country, dir, rough, desc: '' };
  } catch { return null; }
}
