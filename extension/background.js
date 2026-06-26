// background.js - service worker
// 只负责外部 API 调用（高德/OSM/AI），不碰网络拦截
// 响应体由 content.js 在页面内 hook fetch 拿到后发过来

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
  if (msg.type === 'ping') { sendResponse({ ok: true }); return true; }
  // content 拿到街景响应体后发来 url + body，由 background 解析+调外部 API
  if (msg.type === 'streetview') {
    console.log('[BG] 收到 streetview 消息, url:', msg.url, 'body 长度:', msg.body?.length);
    handleBody(msg.url, msg.body, sender.tab?.id).catch((e) => console.log('[BG] handleBody 异常:', e));
    sendResponse({ ok: true });
    return true;
  }
  sendResponse(null);
  return true;
});

// ============== Google GetMetadata 递归解析 ==============
// Google grpc-web 响应是嵌套数组，坐标格式固定为 [null, null, lat, lng]
// panoId 格式为 [2, "base64url字符串"]
function searchGoogleMetadata(node) {
  const result = { coord: null, pano: null, str: '' };
  const panoRe = /^[A-Za-z0-9_-]{16,40}$/;
  const visited = new WeakSet();

  function walk(n) {
    if (result.coord && result.pano) return;
    if (typeof n !== 'object' || n === null) return;
    if (visited.has(n)) return;
    visited.add(n);

    if (Array.isArray(n)) {
      // 优先匹配坐标：[null, null, lat, lng] 格式
      // lat/lng 必须是浮点数（含小数点），范围 -90~90 / -180~180
      if (n.length >= 4 && n[0] === null && n[1] === null
          && typeof n[2] === 'number' && typeof n[3] === 'number'
          && n[2] >= -90 && n[2] <= 90 && n[3] >= -180 && n[3] <= 180
          && (!Number.isInteger(n[2]) || !Number.isInteger(n[3]))) {
        if (!result.coord) {
          result.coord = { lat: n[2], lng: n[3] };
        }
      }
      // 匹配 panoId：[2, "string"]
      if (n.length === 2 && n[0] === 2 && typeof n[1] === 'string') {
        if (!result.pano && panoRe.test(n[1])) {
          result.pano = n[1];
        }
      }
      // 匹配地名：[null, null, [["地名","zh"]]]
      if (n.length === 3 && n[0] === null && n[1] === null && Array.isArray(n[2])) {
        try {
          const inner = n[2][0];
          if (Array.isArray(inner) && typeof inner[0] === 'string' && inner[1] === 'zh') {
            if (!result.str) result.str = inner[0];
          }
        } catch (e) {}
      }
      for (const item of n) walk(item);
    } else {
      for (const k of Object.keys(n)) walk(n[k]);
    }
  }
  walk(node);
  return (result.coord && result.pano) ? result : null;
}

// ============== 响应体解析 ==============
async function handleBody(url, body, tabId) {
  try {
    const c = await cfg();
    if (c.enabled === false) return;
    const result = await Promise.race([
      parseAndEnrich(url, body, c),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000))
    ]);
    if (!result) {
      push(tabId, null, '未识别到坐标');
      return;
    }
    push(tabId, result);
  } catch (e) {
    const errMsg = e.message === 'timeout' ? 'AI 请求超时，已降级' : '处理失败: ' + e.message;
    // 超时降级
    if (e.message === 'timeout') {
      try {
        const c = await cfg();
        const r = await parseAndEnrich(url, body, c, true);
        if (r) { push(tabId, r); return; }
      } catch {}
    }
    push(tabId, null, errMsg);
  }
}

function push(tabId, result, errMsg) {
  if (!tabId || tabId < 0) {
    console.log('[BG] push 跳过: tabId 无效', tabId);
    return;
  }
  const payload = result
    ? { type: 'result', data: result }
    : { type: 'result', data: null, error: errMsg };
  console.log('[BG] 推送到 tab', tabId, 'payload:', result ? `lat=${result.coord?.lat} lng=${result.coord?.lng}` : errMsg);
  chrome.tabs.sendMessage(tabId, payload).then(() => {
    console.log('[BG] 推送成功');
  }).catch((e) => {
    console.log('[BG] 推送失败:', e.message);
  });
}

async function parseAndEnrich(url, body, c, skipAI = false) {
  let coord = null, pano = null, source = null, str = '';

  if (url.includes('GetMetadata')) {
    try {
      let txt = body;
      if (txt.startsWith(")]}'")) txt = txt.slice(4);
      let d;
      try {
        d = JSON.parse(txt);
      } catch {
        const code0 = txt.charCodeAt(0);
        if (code0 === 0 || code0 === 1) {
          d = JSON.parse(txt.slice(5));
        } else {
          throw new Error('not json');
        }
      }
      console.log('[BG] GetMetadata 顶层结构:', JSON.stringify(d).slice(0, 300));
      const found = searchGoogleMetadata(d);
      if (found) {
        coord = found.coord;
        pano = found.pano;
        source = 'g';
        str = found.str || '';
        console.log('[BG] 解析成功:', coord, 'pano:', pano);
      } else {
        console.log('[BG] 递归搜索未找到坐标');
      }
    } catch (e) {
      console.log('[BG] GetMetadata 解析失败:', e.message, 'body 前 200 字节:', body.slice(0, 200));
      return null;
    }
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
  let aiSource = 'none';
  if (!skipAI) {
    info = await aiInfo(coord.lat, coord.lng, { p: source, g, r: addr }, c);
    if (info) aiSource = 'ai';
  }
  if (!info) {
    info = await localInfo(coord.lat, coord.lng);
    if (info) aiSource = skipAI ? 'local(timeout)' : 'local';
  }

  return { coord, addr, panoName: g, info, aiSource };
}

// ============== AI ==============
async function aiInfo(lat, lng, raw, c) {
  if (!c.aiBase || !c.aiKey) {
    console.log('[BG] AI 跳过: 配置缺失, aiBase:', c.aiBase || '(空)', 'aiKey:', c.aiKey ? '(有)' : '(空)');
    return null;
  }
  console.log('[BG] AI 调用开始, base:', c.aiBase, 'model:', c.aiModel);
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
    const url = `${c.aiBase.replace(/\/+$/, '')}/chat/completions`;
    console.log('[BG] AI 请求 URL:', url);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.aiKey}` },
      body: JSON.stringify({
        model: c.aiModel || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });
    console.log('[BG] AI 响应状态:', r.status, r.statusText);
    if (!r.ok) {
      const errText = await r.text().catch(() => '(无法读取错误体)');
      console.log('[BG] AI 失败, 响应体:', errText.slice(0, 300));
      return null;
    }
    const d = await r.json();
    console.log('[BG] AI 响应 JSON:', JSON.stringify(d).slice(0, 300));
    // 兼容非标准字段：LongCat 用 reasoning_content，DeepSeek-R1 用 reasoning_content
    const msg = d?.choices?.[0]?.message;
    const txt = msg?.content || msg?.reasoning_content || msg?.text || '';
    if (!txt) {
      console.log('[BG] AI 返回内容为空, 完整响应:', JSON.stringify(d).slice(0, 500));
      return null;
    }
    console.log('[BG] AI 返回文本:', txt.slice(0, 200));
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) {
      console.log('[BG] AI 返回不是 JSON');
      return null;
    }
    const parsed = JSON.parse(m[0]);
    console.log('[BG] AI 解析成功:', parsed);
    return parsed;
  } catch (e) {
    console.log('[BG] AI 异常:', e.message, e.stack);
    return null;
  }
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
  '土耳其':'亚洲/欧洲','Turkey':'亚洲/欧洲','Türkiye':'亚洲/欧洲','俄罗斯':'欧洲/亚洲','Russia':'欧洲/亚洲',
  '美国':'北美洲','United States':'北美洲','USA':'北美洲','加拿大':'北美洲','Canada':'北美洲','墨西哥':'北美洲','Mexico':'北美洲',
  '巴西':'南美洲','Brazil':'南美洲','阿根廷':'南美洲','Argentina':'南美洲','智利':'南美洲','Chile':'南美洲','哥伦比亚':'南美洲','Colombia':'南美洲',
  '秘鲁':'南美洲','Peru':'南美洲','英国':'欧洲','United Kingdom':'欧洲','U.K.':'欧洲','法国':'欧洲','France':'欧洲',
  '德国':'欧洲','Germany':'欧洲','意大利':'欧洲','Italy':'欧洲','西班牙':'欧洲','Spain':'欧洲','葡萄牙':'欧洲','Portugal':'欧洲',
  '荷兰':'欧洲','Netherlands':'欧洲','瑞士':'欧洲','Switzerland':'欧洲','波兰':'欧洲','Poland':'欧洲','瑞典':'欧洲','Sweden':'欧洲',
  '挪威':'欧洲','Norway':'欧洲','芬兰':'欧洲','Finland':'欧洲','希腊':'欧洲','Greece':'欧洲','乌克兰':'欧洲','Ukraine':'欧洲',
  '爱尔兰':'欧洲','Ireland':'欧洲','Éire':'欧洲','Éire / Ireland':'欧洲','Eire / Ireland':'欧洲','Eire/Ireland':'欧洲',
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
    let country = parts[parts.length - 1] || '';
    // 国家名标准化：处理 "Éire / Ireland" 这类本地语+英语混合
    // 1. 去重音
    const normalized = country.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // 2. 如果含 /，取最后一段（通常是英语名）
    if (normalized.includes('/')) {
      const segs = normalized.split('/').map(s => s.trim()).filter(Boolean);
      country = segs[segs.length - 1];
    } else {
      country = normalized;
    }
    // 3. 查表，匹配原名、标准化名、去空格名
    const continent = CC[country] || CC[normalized] || CC[parts[parts.length - 1]] || '未知';
    // 国家名显示用中文优先：如果 CC 表里有中文 key 对应同一洲，尝试匹配
    let displayCountry = country;
    // 简单中文化映射
    const cnMap = { 'Ireland':'爱尔兰','Turkey':'土耳其','Türkiye':'土耳其','Spain':'西班牙','France':'法国','Germany':'德国','Italy':'意大利','Portugal':'葡萄牙','Netherlands':'荷兰','Switzerland':'瑞士','Poland':'波兰','Sweden':'瑞典','Norway':'挪威','Finland':'芬兰','Greece':'希腊','Ukraine':'乌克兰','United Kingdom':'英国','Russia':'俄罗斯','China':'中国','Japan':'日本','South Korea':'韩国','Vietnam':'越南','Thailand':'泰国','India':'印度','Indonesia':'印度尼西亚','Philippines':'菲律宾','Malaysia':'马来西亚','Singapore':'新加坡','Iran':'伊朗','United States':'美国','USA':'美国','Canada':'加拿大','Mexico':'墨西哥','Brazil':'巴西','Argentina':'阿根廷','Chile':'智利','Colombia':'哥伦比亚','Peru':'秘鲁','Australia':'澳大利亚','New Zealand':'新西兰','Egypt':'埃及','South Africa':'南非','Nigeria':'尼日利亚','Kenya':'肯尼亚','Morocco':'摩洛哥','Algeria':'阿尔及利亚','Senegal':'塞内加尔','Ethiopia':'埃塞俄比亚','Saudi Arabia':'沙特阿拉伯' };
    displayCountry = cnMap[country] || country;
    const rough = parts.slice(0, 3).join('，');
    const dir = dirOf(lat, lng, CTR[country]) || dirOf(lat, lng, CTR[displayCountry]);
    return { continent, country: displayCountry, dir, rough, desc: '' };
  } catch { return null; }
}
