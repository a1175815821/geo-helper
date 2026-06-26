// ==UserScript==
// @name         图寻辅助 v2
// @version      2.0
// @description  f12打开控制台显示地点信息，接入AI优化输出
// @match        *://tuxun.fun/*
// @author       Yu
// @license      AGPL-3.0
// @namespace https://greasyfork.org/users/1566708
// ==/UserScript==
/*
Github: https://github.com/YU-1021/tuxunScript
v2: 接入 OpenAI 兼容 API，AI 把坐标/街景源/原始地址整合成中文输出（洲/国家/8方位/详细位置/一句描述）
    AI 失败时降级到 v1.1 的 OSM 本地方位算法。
*/

(function() {
    'use strict';
    let _i = null, _l = null, _t, _tm;
    const _k = '_tx_k', _m = '_tx_s';
    // AI 配置 key
    const _aiBase = 'https://api.longcat.chat/openai', _aiKey = 'ak_2vR0Ng5N94w29RV4qH24j4Zq78O2M', _aiModel = 'LongCat-2.0-Preview';

    // ============== 初始化 ==============
    function _init() {
        let s = localStorage.getItem(_m);
        if (!s) {
            if (confirm("请选择地图源：\n\n确定：使用高德 (需输入Key，免费)\n取消：使用OSM (国内不可用，要魔法)")) {
                localStorage.setItem(_m, '1');
                _chk();
            } else {
                localStorage.setItem(_m, '0');
            }
        } else if (s === '1') {
            _chk();
        }
        _aiInit();
    }

    function _chk() {
        if (!localStorage.getItem(_k)) {
            let k = prompt("请输入高德地图Web服务API Key (32位)\n\n提示：后续如需修改或重置，请在游戏中按 'R' 键。", "");
            if (k && k.length === 32) {
                localStorage.setItem(_k, k);
                alert("Key已保存，请刷新页面生效。");
            } else {
                localStorage.removeItem(_m);
                alert("Key无效或取消，已重置设置。");
            }
        }
    }

    // ============== AI 配置 ==============
    function _aiInit() {
        if (!localStorage.getItem(_aiBase)) {
            // 首次进入：询问是否启用 AI
            if (confirm("是否启用 AI 优化输出？\n\n确定：启用 (需 OpenAI 兼容 API，可选填)\n取消：暂不启用，使用本地OSM方位算法")) {
                _aiCfg();
            } else {
                // 暂不启用，写入空标记避免反复弹窗
                localStorage.setItem(_aiBase, '');
            }
        }
    }

    function _aiCfg() {
        let base = prompt("请输入 OpenAI 兼容 API BaseURL\n\n示例:\nhttps://api.openai.com/v1\nhttps://api.deepseek.com/v1\nhttps://open.bigmodel.cn/api/paas/v4\n\n(留空取消)", "https://api.openai.com/v1");
        if (!base) { localStorage.setItem(_aiBase, ''); return; }
        localStorage.setItem(_aiBase, base.replace(/\/+$/, ''));

        let key = prompt("请输入 API Key (sk-xxx):", "");
        if (!key) { localStorage.setItem(_aiBase, ''); alert("未填Key，AI未启用。"); return; }
        localStorage.setItem(_aiKey, key);

        let model = prompt("请输入模型名:", "gpt-4o-mini");
        if (!model) model = 'gpt-4o-mini';
        localStorage.setItem(_aiModel, model);
        alert("AI 配置已保存。按 R 键可重置。");
    }

    _init();

    // ============== AI 调用 ==============
    async function _ai(lat, lng, raw) {
        const base = localStorage.getItem(_aiBase);
        const key = localStorage.getItem(_aiKey);
        const model = localStorage.getItem(_aiModel) || 'gpt-4o-mini';
        if (!base || !key) return null;

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
            const r = await fetch(`${base}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.3,
                    response_format: { type: 'json_object' }
                })
            });
            if (!r.ok) return null;
            const d = await r.json();
            const txt = d?.choices?.[0]?.message?.content;
            if (!txt) return null;
            // 兼容某些不返回 response_format 的服务
            const m = txt.match(/\{[\s\S]*\}/);
            if (!m) return null;
            return JSON.parse(m[0]);
        } catch { return null; }
    }

    // ============== 主流程 ==============
    const _u = async () => {
        if (!_l) return;
        let r = '位置获取中...', g = '', info = null;
        try {
            const isG = localStorage.getItem(_m) === '1';
            const k = localStorage.getItem(_k);
            if (isG && k) {
                r = await _gd(_l.lat, _l.lng, k);
            } else {
                r = await _os(_l.lat, _l.lng);
            }
            if (_i) {
               if (_l.p === 'b') { const b = await _bd(_i); if(b) g = b; }
               else if (_l.p === 't') { const t = await _qq(_i); if(t) g = t; }
               else if (_l.str) { g = _l.str; }
            }

            // 优先 AI，失败降级本地 _info
            info = await _ai(_l.lat, _l.lng, { p: _l.p, g, r });
            if (!info) info = await _info(_l.lat, _l.lng);
        } catch (e) {}

        console.clear();
        console.log(`%c📍 ${r} ${g ? '('+g+')' : ''}`, 'font-size:20px;color:#00d1b2;font-weight:bold;padding-bottom:10px;');
        if (info) {
            const head = [info.continent, info.country, info.dir].filter(Boolean).join('  |  ');
            console.log(`%c🌍 ${head}`, 'font-size:18px;color:#ffdd57;font-weight:bold;padding:4px 0;');
            if (info.rough) console.log(`%c📌 ${info.rough}`, 'font-size:14px;color:#48c774;padding:2px 0;');
            if (info.desc) console.log(`%c💡 ${info.desc}`, 'font-size:14px;color:#b86bff;padding-bottom:8px;');
        }
        console.log(`%c🗺️ Google Maps: https://www.google.com/maps/@${_l.lat},${_l.lng},6z`, 'font-size:13px;color:#3273dc;padding-bottom:8px;');
    };

    const _d = () => { clearTimeout(_tm); _tm = setTimeout(_u, 500); };

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(...args) {
        try {
            this.addEventListener('load', () => {
                if (!this.responseText || !this.responseURL) return;
                try {
                    const d = JSON.parse(this.responseText);
                    let ni = null, np = null;

                    if (this.responseURL.includes('GetMetadata')) {
                        try {
                            const m = d[1][0];
                            ni = m[1][1];
                            np = { lat: m[5][0][1][0][2], lng: m[5][0][1][0][3], p: 'g', str: (m[3][2][0] && m[3][2][0][0]) || '' };
                        } catch(e){}
                    } else if (this.responseURL.match(/getPanoInfo|getQQPanoInfo/)) {
                        if (d && d.data) {
                            ni = d.data.pano;
                            np = { lat: d.data.lat, lng: d.data.lng, p: this.responseURL.includes('getQQ') ? 't' : 'b' };
                        }
                    }

                    if (ni && ni !== _i) {
                        _i = ni; _l = np;
                        _d();
                    }
                } catch (e) {}
            });
        } catch (e) {
            console.error('Tuxun script injection failed:', e);
        }
        return originalSend.apply(this, args);
    };
    XMLHttpRequest.prototype.send.toString = () => originalSend.toString();

    document.addEventListener("keydown", (e) => {
        if (['INPUT','TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
        const k = e.key.toLowerCase();
        if (k === 'i') { _u(); }
        if (k === 'r') {
            localStorage.removeItem(_m);
            localStorage.removeItem(_k);
            localStorage.removeItem(_aiBase);
            localStorage.removeItem(_aiKey);
            localStorage.removeItem(_aiModel);
            alert('设置已重置！请刷新页面重新配置。');
        }
        // A 键：单独重配 AI
        if (k === 'a') { _aiCfg(); }
    }, true);

    // ============== 地理服务 ==============
    function _gd(lt, ln, k) {
        return fetch(`https://restapi.amap.com/v3/geocode/regeo?output=json&location=${ln},${lt}&key=${k}&radius=100`)
            .then(r => r.json()).then(d => {
                if (d.status === '1' && d.regeocode) {
                    const c = d.regeocode.addressComponent;
                    return [c.province, c.city, c.district, c.township].filter(x => x && typeof x === 'string').join('');
                }
                return '未知(Key无效?)';
            }).catch(() => '请求失败');
    }

    function _os(lt, ln) {
        return fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lt}&lon=${ln}&accept-language=cn`)
            .then(r => r.json()).then(d => d.display_name ? d.display_name.split(',').reverse().slice(0,4).join('') : '未知')
            .catch(() => 'OSM请求失败(需魔法)');
    }

    // ============== 本地方位算法（AI 失败时降级用）==============
    const _cc = {
        'China':'亚洲','中国':'亚洲','Japan':'亚洲','日本':'亚洲','South Korea':'亚洲','韩国':'亚洲','North Korea':'亚洲','朝鲜':'亚洲',
        'Mongolia':'亚洲','蒙古':'亚洲','Vietnam':'亚洲','越南':'亚洲','Thailand':'亚洲','泰国':'亚洲','Laos':'亚洲','老挝':'亚洲',
        'Cambodia':'亚洲','柬埔寨':'亚洲','Myanmar':'亚洲','缅甸':'亚洲','Malaysia':'亚洲','马来西亚':'亚洲','Singapore':'亚洲','新加坡':'亚洲',
        'Indonesia':'亚洲','印度尼西亚':'亚洲','Philippines':'亚洲','菲律宾':'亚洲','India':'亚洲','印度':'亚洲','Pakistan':'亚洲','巴基斯坦':'亚洲',
        'Bangladesh':'亚洲','孟加拉国':'亚洲','Sri Lanka':'亚洲','斯里兰卡':'亚洲','Nepal':'亚洲','尼泊尔':'亚洲','Kazakhstan':'亚洲','哈萨克斯坦':'亚洲',
        'Uzbekistan':'亚洲','乌兹别克斯坦':'亚洲','Afghanistan':'亚洲','阿富汗':'亚洲','Iran':'亚洲','伊朗':'亚洲','Iraq':'亚洲','伊拉克':'亚洲',
        'Saudi Arabia':'亚洲','沙特阿拉伯':'亚洲','United Arab Emirates':'亚洲','UAE':'亚洲','阿联酋':'亚洲','Israel':'亚洲','以色列':'亚洲',
        'Taiwan':'亚洲','台湾':'亚洲','Hong Kong':'亚洲','香港':'亚洲','Macau':'亚洲','澳门':'亚洲',
        'Turkey':'亚洲/欧洲','土耳其':'亚洲/欧洲','Russia':'欧洲/亚洲','俄罗斯':'欧洲/亚洲',
        'United States':'北美洲','United States of America':'北美洲','USA':'北美洲','美国':'北美洲',
        'Canada':'北美洲','加拿大':'北美洲','Mexico':'北美洲','墨西哥':'北美洲','Guatemala':'北美洲','危地马拉':'北美洲',
        'Cuba':'北美洲','古巴':'北美洲','Panama':'北美洲','巴拿马':'北美洲','Costa Rica':'北美洲','哥斯达黎加':'北美洲',
        'Dominican Republic':'北美洲','多米尼加':'北美洲','Jamaica':'北美洲','牙买加':'北美洲','Honduras':'北美洲','洪都拉斯':'北美洲',
        'Brazil':'南美洲','巴西':'南美洲','Argentina':'南美洲','阿根廷':'南美洲','Chile':'南美洲','智利':'南美洲',
        'Colombia':'南美洲','哥伦比亚':'南美洲','Peru':'南美洲','秘鲁':'南美洲','Venezuela':'南美洲','委内瑞拉':'南美洲',
        'Bolivia':'南美洲','玻利维亚':'南美洲','Ecuador':'南美洲','厄瓜多尔':'南美洲','Uruguay':'南美洲','乌拉圭':'南美洲','Paraguay':'南美洲','巴拉圭':'南美洲',
        'United Kingdom':'欧洲','U.K.':'欧洲','英国':'欧洲','England':'欧洲','France':'欧洲','法国':'欧洲','Germany':'欧洲','德国':'欧洲',
        'Italy':'欧洲','意大利':'欧洲','Spain':'欧洲','西班牙':'欧洲','Portugal':'欧洲','葡萄牙':'欧洲','Netherlands':'欧洲','荷兰':'欧洲',
        'Belgium':'欧洲','比利时':'欧洲','Switzerland':'欧洲','瑞士':'欧洲','Austria':'欧洲','奥地利':'欧洲','Poland':'欧洲','波兰':'欧洲',
        'Sweden':'欧洲','瑞典':'欧洲','Norway':'欧洲','挪威':'欧洲','Denmark':'欧洲','丹麦':'欧洲','Finland':'欧洲','芬兰':'欧洲',
        'Iceland':'欧洲','冰岛':'欧洲','Ireland':'欧洲','爱尔兰':'欧洲','Czech Republic':'欧洲','捷克':'欧洲','Czechia':'欧洲',
        'Greece':'欧洲','希腊':'欧洲','Hungary':'欧洲','匈牙利':'欧洲','Romania':'欧洲','罗马尼亚':'欧洲','Bulgaria':'欧洲','保加利亚':'欧洲',
        'Ukraine':'欧洲','乌克兰':'欧洲','Belarus':'欧洲','白俄罗斯':'欧洲','Croatia':'欧洲','克罗地亚':'欧洲','Serbia':'欧洲','塞尔维亚':'欧洲',
        'Slovakia':'欧洲','斯洛伐克':'欧洲','Slovenia':'欧洲','斯洛文尼亚':'欧洲','Lithuania':'欧洲','立陶宛':'欧洲','Latvia':'欧洲','拉脱维亚':'欧洲',
        'Estonia':'欧洲','爱沙尼亚':'欧洲','Albania':'欧洲','阿尔巴尼亚':'欧洲','Bosnia and Herzegovina':'欧洲','北马其顿':'欧洲',
        'Australia':'大洋洲','澳大利亚':'大洋洲','New Zealand':'大洋洲','新西兰':'大洋洲','Papua New Guinea':'大洋洲','巴布亚新几内亚':'大洋洲',
        'Fiji':'大洋洲','斐济':'大洋洲','Solomon Islands':'大洋洲','所罗门群岛':'大洋洲',
        'Egypt':'非洲','埃及':'非洲','South Africa':'非洲','南非':'非洲','Nigeria':'非洲','尼日利亚':'非洲','Kenya':'非洲','肯尼亚':'非洲',
        'Morocco':'非洲','摩洛哥':'非洲','Algeria':'非洲','阿尔及利亚':'非洲','Tunisia':'非洲','突尼斯':'非洲','Libya':'非洲','利比亚':'非洲',
        'Ethiopia':'非洲','埃塞俄比亚':'非洲','Ghana':'非洲','加纳':'非洲','Tanzania':'非洲','坦桑尼亚':'非洲','Uganda':'非洲','乌干达':'非洲',
        'Zimbabwe':'非洲','津巴布韦':'非洲','Senegal':'非洲','塞内加尔':'非洲','Cameroon':'非洲','喀麦隆':'非洲','Angola':'非洲','安哥拉':'非洲',
        'Madagascar':'非洲','马达加斯加':'非洲','Sudan':'非洲','苏丹':'非洲','Mozambique':'非洲','莫桑比克':'非洲','Namibia':'非洲','纳米比亚':'非洲'
    };

    const _ctr = {
        '中国': {lat: 35, lng: 105, sz: 'XL'},'Russia': {lat: 61, lng: 100, sz: 'XL'},'俄罗斯': {lat: 61, lng: 100, sz: 'XL'},
        'United States': {lat: 39, lng: -98, sz: 'XL'},'美国': {lat: 39, lng: -98, sz: 'XL'},
        'Canada': {lat: 56, lng: -106, sz: 'XL'},'加拿大': {lat: 56, lng: -106, sz: 'XL'},
        'Brazil': {lat: -10, lng: -55, sz: 'XL'},'巴西': {lat: -10, lng: -55, sz: 'XL'},
        'Australia': {lat: -25, lng: 134, sz: 'XL'},'澳大利亚': {lat: -25, lng: 134, sz: 'XL'},
        'India': {lat: 22, lng: 79, sz: 'L'},'印度': {lat: 22, lng: 79, sz: 'L'},
        'Argentina': {lat: -34, lng: -64, sz: 'L'},'阿根廷': {lat: -34, lng: -64, sz: 'L'},
        'Kazakhstan': {lat: 48, lng: 66, sz: 'L'},'哈萨克斯坦': {lat: 48, lng: 66, sz: 'L'},
        'Mexico': {lat: 23, lng: -102, sz: 'L'},'墨西哥': {lat: 23, lng: -102, sz: 'L'},
        'Saudi Arabia': {lat: 24, lng: 45, sz: 'L'},'沙特阿拉伯': {lat: 24, lng: 45, sz: 'L'},
        'Iran': {lat: 32, lng: 53, sz: 'L'},'伊朗': {lat: 32, lng: 53, sz: 'L'},
        'Turkey': {lat: 39, lng: 35, sz: 'L'},'土耳其': {lat: 39, lng: 35, sz: 'L'},
        'Japan': {lat: 36, lng: 138, sz: 'M'},'日本': {lat: 36, lng: 138, sz: 'M'},
        'South Korea': {lat: 36, lng: 128, sz: 'S'},'韩国': {lat: 36, lng: 128, sz: 'S'},
        'Thailand': {lat: 15, lng: 101, sz: 'M'},'泰国': {lat: 15, lng: 101, sz: 'M'},
        'Vietnam': {lat: 16, lng: 106, sz: 'M'},'越南': {lat: 16, lng: 106, sz: 'M'},
        'Indonesia': {lat: -2, lng: 118, sz: 'XL'},'印度尼西亚': {lat: -2, lng: 118, sz: 'XL'},
        'Philippines': {lat: 13, lng: 122, sz: 'M'},'菲律宾': {lat: 13, lng: 122, sz: 'M'},
        'Malaysia': {lat: 4, lng: 102, sz: 'S'},'马来西亚': {lat: 4, lng: 102, sz: 'S'},
        'United Kingdom': {lat: 54, lng: -2, sz: 'S'},'英国': {lat: 54, lng: -2, sz: 'S'},
        'France': {lat: 46, lng: 2, sz: 'M'},'法国': {lat: 46, lng: 2, sz: 'M'},
        'Germany': {lat: 51, lng: 10, sz: 'M'},'德国': {lat: 51, lng: 10, sz: 'M'},
        'Italy': {lat: 42, lng: 12, sz: 'M'},'意大利': {lat: 42, lng: 12, sz: 'M'},
        'Spain': {lat: 40, lng: -3, sz: 'M'},'西班牙': {lat: 40, lng: -3, sz: 'M'},
        'Portugal': {lat: 39, lng: -8, sz: 'S'},'葡萄牙': {lat: 39, lng: -8, sz: 'S'},
        'Netherlands': {lat: 52, lng: 5, sz: 'S'},'荷兰': {lat: 52, lng: 5, sz: 'S'},
        'Switzerland': {lat: 47, lng: 8, sz: 'S'},'瑞士': {lat: 47, lng: 8, sz: 'S'},
        'Poland': {lat: 52, lng: 19, sz: 'M'},'波兰': {lat: 52, lng: 19, sz: 'M'},
        'Sweden': {lat: 62, lng: 15, sz: 'L'},'瑞典': {lat: 62, lng: 15, sz: 'L'},
        'Norway': {lat: 62, lng: 10, sz: 'L'},'挪威': {lat: 62, lng: 10, sz: 'L'},
        'Finland': {lat: 64, lng: 26, sz: 'L'},'芬兰': {lat: 64, lng: 26, sz: 'L'},
        'Greece': {lat: 39, lng: 22, sz: 'S'},'希腊': {lat: 39, lng: 22, sz: 'S'},
        'Ukraine': {lat: 49, lng: 32, sz: 'L'},'乌克兰': {lat: 49, lng: 32, sz: 'L'},
        'Egypt': {lat: 27, lng: 30, sz: 'L'},'埃及': {lat: 27, lng: 30, sz: 'L'},
        'South Africa': {lat: -29, lng: 24, sz: 'L'},'南非': {lat: -29, lng: 24, sz: 'L'},
        'Nigeria': {lat: 9, lng: 8, sz: 'M'},'尼日利亚': {lat: 9, lng: 8, sz: 'M'},
        'Kenya': {lat: 0, lng: 38, sz: 'M'},'肯尼亚': {lat: 0, lng: 38, sz: 'M'},
        'Morocco': {lat: 32, lng: -7, sz: 'M'},'摩洛哥': {lat: 32, lng: -7, sz: 'M'},
        'Algeria': {lat: 28, lng: 3, sz: 'L'},'阿尔及利亚': {lat: 28, lng: 3, sz: 'L'},
        'New Zealand': {lat: -42, lng: 174, sz: 'S'},'新西兰': {lat: -42, lng: 174, sz: 'S'},
        'Chile': {lat: -33, lng: -71, sz: 'L'},'智利': {lat: -33, lng: -71, sz: 'L'},
        'Peru': {lat: -10, lng: -76, sz: 'L'},'秘鲁': {lat: -10, lng: -76, sz: 'L'},
        'Colombia': {lat: 4, lng: -73, sz: 'M'},'哥伦比亚': {lat: 4, lng: -73, sz: 'M'},
        'Ethiopia': {lat: 9, lng: 40, sz: 'L'},'埃塞俄比亚': {lat: 9, lng: 40, sz: 'L'}
    };

    // 8 方位算法（基于国家中心点 + 面积档位阈值）
    const _dT = { XL: [6, 8], L: [4, 5], M: [2, 3], S: [1, 1] };
    function _dir(lt, ln, c) {
        if (!c) return '';
        const T = _dT[c.sz] || [2, 3];
        const dLat = lt - c.lat, dLng = ln - c.lng;
        let ns = '', ew = '';
        if (dLat > T[0]) ns = '北';
        else if (dLat < -T[0]) ns = '南';
        if (dLng > T[1]) ew = '东';
        else if (dLng < -T[1]) ew = '西';
        if (!ns && !ew) return '中部';
        return ns + ew + '部';
    }

    // 降级路径：OSM 本地解析
    async function _info(lt, ln) {
        try {
            const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lt}&lon=${ln}&accept-language=cn&zoom=10`);
            const d = await r.json();
            if (!d || !d.display_name) return null;
            const parts = d.display_name.split(',').map(s => s.trim()).filter(Boolean);
            const country = parts[parts.length - 1] || '';
            const continent = _cc[country] || '未知';
            const rough = parts.slice(0, 3).join('，');
            const dir = _dir(lt, ln, _ctr[country]);
            return { continent, country, dir, rough, desc: '' };
        } catch { return null; }
    }

    async function _bd(id) {
        try { const r = await fetch(`https://mapsv0.bdimg.com/?qt=sdata&sid=${id}`); const d = await r.json(); return d.content?.[0]?.Rname || ''; } catch { return ''; }
    }

    function _qq(id) {
        return new Promise(r => {
            fetch(`https://sv.map.qq.com/sv?svid=${id}&output=json`).then(x => x.blob()).then(b => {
                const rd = new FileReader();
                rd.onload = () => { try { const j = JSON.parse(rd.result); r(j?.detail?.basic?.append_addr || ''); } catch { r(''); } };
                rd.readAsText(b, 'GBK');
            }).catch(() => r(''));
        });
    }
})();
