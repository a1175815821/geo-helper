// direction.js - 本地方位算法与地理数据表
// 纯同步函数 + 静态数据，零外部依赖，可被任意项目复用
(function() {
  'use strict';

  // 尺寸等级 → [纬度阈值, 经度阈值]
  const DT = { XL: [6, 8], L: [4, 5], M: [2, 3], S: [1, 1] };

  // 国家/地区 → 所属大洲（多语言兼容）
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

  // 国家/地区 → 中心坐标 + 尺寸等级（用于方位判断）
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

  // 英语 → 中文国家名映射（用于 OSM 返回的英语名转中文）
  const cnMap = {
    'Ireland':'爱尔兰','Turkey':'土耳其','Türkiye':'土耳其','Spain':'西班牙','France':'法国',
    'Germany':'德国','Italy':'意大利','Portugal':'葡萄牙','Netherlands':'荷兰','Switzerland':'瑞士',
    'Poland':'波兰','Sweden':'瑞典','Norway':'挪威','Finland':'芬兰','Greece':'希腊','Ukraine':'乌克兰',
    'United Kingdom':'英国','Russia':'俄罗斯','China':'中国','Japan':'日本','South Korea':'韩国',
    'Vietnam':'越南','Thailand':'泰国','India':'印度','Indonesia':'印度尼西亚','Philippines':'菲律宾',
    'Malaysia':'马来西亚','Singapore':'新加坡','Iran':'伊朗','United States':'美国','USA':'美国',
    'Canada':'加拿大','Mexico':'墨西哥','Brazil':'巴西','Argentina':'阿根廷','Chile':'智利',
    'Colombia':'哥伦比亚','Peru':'秘鲁','Australia':'澳大利亚','New Zealand':'新西兰','Egypt':'埃及',
    'South Africa':'南非','Nigeria':'尼日利亚','Kenya':'肯尼亚','Morocco':'摩洛哥','Algeria':'阿尔及利亚',
    'Senegal':'塞内加尔','Ethiopia':'埃塞俄比亚','Saudi Arabia':'沙特阿拉伯'
  };

  // 计算坐标在大国中的方位
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

  self.GeoDir = { DT, CC, CTR, cnMap, dirOf };
})();
