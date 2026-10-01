importScripts('direction.js');

// background.js - service worker
// 只负责外部 API 调用（高德/OSM/AI），不碰网络拦截
// 响应体由 content.js 在页面内 hook fetch 拿到后发过来

// 调试开关（生产期 false 全部静默）
const __GEO_DEBUG__ = false;
const _log = console.log.bind(console);
const dbg = __GEO_DEBUG__ ? (...a) => _log('[Geo]', ...a) : () => {};

// 带超时的 fetch：OSM 在国内无魔法时可能 hang 住，必须能快速失败
// 用 AbortController 主动取消，避免 SW 空挂 + Promise.race 泄漏
async function fetchWithTimeout(url, ms = 5000, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    return r;
  } finally {
    clearTimeout(timer);
  }
}
function timeoutRace(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

const CFG_DEFAULTS = {
  enabled: true,
  aiEnabled: true,
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
    dbg('[BG] 收到 streetview 消息, url:', msg.url, 'body 长度:', msg.body?.length);
    handleBody(msg.url, msg.body, sender.tab?.id).catch((e) => dbg('[BG] handleBody 异常:', e));
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
      // 优先匹配坐标：[null, null, lat, lng] 格式，范围 -90~90 / -180~180
      // 必须至少一个非整数：过滤 grpc-web 里 [null,null,0,0] 类占位，避免全球模式错误闪现
      // 真实街景坐标几乎全是浮点，整数坐标无街景价值
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

// ============== 响应体解析（并发本地+AI，序列号防乱序）==============
let _tabSeq = new Map();
async function handleBody(url, body, tabId) {
  try {
    const c = await cfg();
    if (c.enabled === false) return;

    const seq = (_tabSeq.get(tabId) || 0) + 1;
    _tabSeq.set(tabId, seq);

    // Step 1: Parse coords
    const parsed = await parseCoords(url, body);
    if (!parsed) { push(tabId, null, '未识别到坐标', seq); return; }
    let { coord, pano, source, str } = parsed;

    // Step 2 & 3: Pano name + Address 并发，带超时避免阻塞本地推送
    let panoName = str;
    let panoNamePromise = null;
    if (pano) {
      if (source === 'b') panoNamePromise = bdName(pano);
      else if (source === 't') panoNamePromise = qqName(pano);
    }

    let addrText, osmParts;
    if (c.mapSource === '1' && c.amapKey) {
      // 高德取地址，同时并行取 OSM parts 供本地方位
      // OSM 失败不阻塞：osmParts 为空时 localInfo 直接降级未知，不再二次请求
      const amapP = amapRegeo(coord.lat, coord.lng, c.amapKey);
      const osmP = osmReverse(coord.lat, coord.lng).catch(() => ({ text: '', parts: [] }));
      try {
        const [amapText, osmData] = await Promise.all([
          timeoutRace(amapP, 5000).catch(() => '请求超时'),
          timeoutRace(osmP, 5000).catch(() => ({ text: '', parts: [] }))
        ]);
        addrText = amapText;
        osmParts = osmData && osmData.parts && osmData.parts.length ? osmData.parts : null;
      } catch {
        addrText = '请求失败';
        osmParts = null;
      }
    } else {
      // 默认 OSM 分支：同样 5s 超时，避免无魔法时卡死在“等待中”
      const osmData = await timeoutRace(
        osmReverse(coord.lat, coord.lng).catch(() => ({ text: 'OSM请求失败', parts: [] })),
        6000
      ).catch(() => ({ text: '请求超时', parts: [] }));
      addrText = osmData.text;
      osmParts = osmData.parts;
    }

    // panoName 不阻塞主流程，带 3s 超时
    if (panoNamePromise) {
      try {
        const raced = await Promise.race([
          panoNamePromise,
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
        ]);
        if (raced) panoName = raced;
      } catch {}
    }

    // Step 4: Concurrent local + AI
    const shouldRunAI = c.aiEnabled !== false && c.aiBase && c.aiKey;
    const basePayload = { coord, addr: addrText, panoName, _seq: seq, _t: Date.now() };

    // Start local + AI in parallel
    const localPromise = localInfo(coord.lat, coord.lng, osmParts);
    const aiPromise = shouldRunAI
      ? Promise.race([
          aiInfo(coord.lat, coord.lng, { p: source, g: panoName, r: addrText }, c),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000))
        ])
      : null;

    // Wait for local (always fast, 带超时兜底)
    // 本地失败不再整体失败：降级为未知后继续走 AI，保证高德地址 + AI 仍可见
    let localResult;
    try {
      localResult = await timeoutRace(localPromise, 6000).catch(() => null);
    } catch {
      localResult = null;
    }
    if (!localResult) {
      localResult = { continent: '未知', country: '', dir: '', rough: '', desc: '' };
    }

    // Push local result immediately
    push(tabId, {
      ...basePayload,
      info: localResult,
      aiSource: shouldRunAI ? 'local_pending' : (c.aiEnabled === false ? 'local_disabled' : 'local')
    });

    // If no AI configured, done
    if (!shouldRunAI) return;

    // Wait for AI
    try {
      const aiResult = await aiPromise;
      if (_tabSeq.get(tabId) !== seq) return;
      push(tabId, {
        ...basePayload,
        info: aiResult || localResult,
        aiSource: aiResult ? 'ai' : 'local'
      });
    } catch (e) {
      if (_tabSeq.get(tabId) !== seq) return;
      push(tabId, {
        ...basePayload,
        info: localResult,
        aiSource: 'local(timeout)'
      });
    }

  } catch (e) {
    push(tabId, null, '处理失败: ' + e.message, _tabSeq.get(tabId));
  }
}

function push(tabId, result, errMsg, seq) {
  if (!tabId || tabId < 0) {
    dbg('[BG] push 跳过: tabId 无效', tabId);
    return;
  }
  const payload = result
    ? { type: 'result', data: result, _seq: seq }
    : { type: 'result', data: null, error: errMsg, _seq: seq };
  dbg('[BG] 推送到 tab', tabId, 'seq:', seq, 'payload:', result ? `lat=${result.coord?.lat} lng=${result.coord?.lng}` : errMsg);
  chrome.tabs.sendMessage(tabId, payload).then(() => {
    dbg('[BG] 推送成功');
  }).catch((e) => {
    dbg('[BG] 推送失败:', e.message);
  });
}

async function parseCoords(url, body) {
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
      const found = searchGoogleMetadata(d);
      if (found) {
        coord = found.coord;
        pano = found.pano;
        source = 'g';
        str = found.str || '';
      }
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
  return { coord, pano, source, str };
}

// ============== AI ==============
async function aiInfo(lat, lng, raw, c) {
  if (!c.aiBase || !c.aiKey) {
    dbg('[BG] AI 跳过: 配置缺失, aiBase:', c.aiBase || '(空)', 'aiKey:', c.aiKey ? '(有)' : '(空)');
    return null;
  }
  dbg('[BG] AI 调用开始, base:', c.aiBase, 'model:', c.aiModel);
  const prompt = `你是地理助手。根据坐标和原始信息，用中文给出结构化结果。

坐标：${lat}, ${lng}
街景源：${raw.p || '未知'}
街景名：${raw.g || '无'}
原始地址：${raw.r || '无'}

请严格返回 JSON（不要markdown，不要多余文字）：
{
  "continent": "国家所在的地理分区（中文，如：东亚、西欧、南美东部等）",
  "country": "国家中文名",
  "dir": "输出该国家内的方位（中文，八方位：北部、东北部、东南部、中部等八方位，国家面积较小直接写'中部'）",
  "rough": "详细位置（中文，从大到小：省/州 → 市/区 → 县/镇，尽量具体）",
  "desc": "输出街景坐标中最具辨识度组合特征的实体和最具定位价值的高区分度特征，不超25字。"
}`;
  try {
    const url = `${c.aiBase.replace(/\/+$/, '')}/chat/completions`;
    dbg('[BG] AI 请求 URL:', url);
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
    dbg('[BG] AI 响应状态:', r.status, r.statusText);
    if (!r.ok) {
      const errText = await r.text().catch(() => '(无法读取错误体)');
      dbg('[BG] AI 失败, 响应体:', errText.slice(0, 300));
      return null;
    }
    const d = await r.json();
    dbg('[BG] AI 响应 JSON:', JSON.stringify(d).slice(0, 300));
    // 兼容非标准字段：LongCat 用 reasoning_content，DeepSeek-R1 用 reasoning_content
    const msg = d?.choices?.[0]?.message;
    const txt = msg?.content || msg?.reasoning_content || msg?.text || '';
    if (!txt) {
      dbg('[BG] AI 返回内容为空, 完整响应:', JSON.stringify(d).slice(0, 500));
      return null;
    }
    dbg('[BG] AI 返回文本:', txt.slice(0, 200));
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) {
      dbg('[BG] AI 返回不是 JSON');
      return null;
    }
    const parsed = JSON.parse(m[0]);
    dbg('[BG] AI 解析成功:', parsed);
    return parsed;
  } catch (e) {
    dbg('[BG] AI 异常:', e.message, e.stack);
    return null;
  }
}

// ============== 地理服务 ==============
async function amapRegeo(lat, lng, key) {
  try {
    const r = await fetchWithTimeout(`https://restapi.amap.com/v3/geocode/regeo?output=json&location=${lng},${lat}&key=${key}&radius=100`, 5000);
    const d = await r.json();
    if (d.status === '1' && d.regeocode) {
      const c = d.regeocode.addressComponent;
      return [c.province, c.city, c.district, c.township].filter(x => x && typeof x === 'string').join('') || '未知';
    }
    return '未知(Key无效?)';
  } catch (e) {
    return (e && e.name === 'AbortError') ? '请求超时' : '请求失败';
  }
}

async function osmReverse(lat, lng) {
  try {
    const r = await fetchWithTimeout(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=zh-CN`, 5000);
    const d = await r.json();
    const parts = d.display_name ? d.display_name.split(',').map(s => s.trim()).filter(Boolean) : [];
    return {
      text: parts.length ? parts.slice().reverse().slice(0, 4).join('') : '未知',
      parts
    };
  } catch (e) {
    return { text: (e && e.name === 'AbortError') ? '请求超时' : 'OSM请求失败', parts: [] };
  }
}

async function bdName(id) {
  try {
    const r = await fetchWithTimeout(`https://mapsv0.bdimg.com/?qt=sdata&sid=${id}`, 3000);
    const d = await r.json();
    return d.content?.[0]?.Rname || '';
  } catch { return ''; }
}

async function qqName(id) {
  try {
    const r = await fetchWithTimeout(`https://sv.map.qq.com/sv?svid=${id}&output=json`, 3000);
    const buf = await r.arrayBuffer();
    const txt = new TextDecoder('GBK').decode(buf);
    const j = JSON.parse(txt);
    return j?.detail?.basic?.append_addr || '';
  } catch { return ''; }
}

const GEO_UNKNOWN = { continent: '未知', country: '', dir: '', rough: '', desc: '' };

async function localInfo(lat, lng, parts = null) {
  try {
    // parts 为 null/空数组 = 上游 OSM 已试过且失败，直接降级未知，不再二次请求
    // 避免高德分支 5s + 本地 5s 双重等待，以及无魔法下必现“本地解析失败”
    // 仅 parts === undefined（历史直接调用）才回退请求一次
    if (parts === undefined) {
      try {
        const r = await fetchWithTimeout(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=zh-CN&zoom=10`, 5000);
        const d = await r.json();
        if (!d || !d.display_name) return { ...GEO_UNKNOWN };
        parts = d.display_name.split(',').map(s => s.trim()).filter(Boolean);
      } catch {
        return { ...GEO_UNKNOWN };
      }
    }
    if (!parts || (Array.isArray(parts) && parts.length === 0)) {
      return { ...GEO_UNKNOWN };
    }
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
    const continent = GeoDir.CC[country] || GeoDir.CC[normalized] || GeoDir.CC[parts[parts.length - 1]] || '未知';
    const displayCountry = GeoDir.cnMap[country] || country;
    const rough = parts.slice(0, 3).join('，');
    const dir = GeoDir.dirOf(lat, lng, GeoDir.CTR[country]) || GeoDir.dirOf(lat, lng, GeoDir.CTR[displayCountry]);
    return { continent, country: displayCountry, dir, rough, desc: '' };
  } catch { return { ...GEO_UNKNOWN }; }
}
