<div align="center">

<img src="extension/icons/icon128.png" width="88" alt="Geo Helper"/>

# Geo Helper

**图寻街景坐标解析助手 · 本地 ~400ms 判定方位，AI 深度分析自动接力**

[![Chrome](https://img.shields.io/badge/Chrome-111%2B-4285F4?logo=GoogleChrome&logoColor=white)](https://support.google.com/chrome/answer/95414)
[![Manifest](https://img.shields.io/badge/Manifest-V3-34A853)](extension/manifest.json)
[![Version](https://img.shields.io/badge/version-8.4-00d1b2.svg)](extension/manifest.json)
[![License: MIT](https://img.shields.io/github/license/a1175815821/geo-helper.svg?color=blue)](LICENSE)
[![Stars](https://img.shields.io/github/stars/a1175815821/geo-helper?style=social)](https://github.com/a1175815821/geo-helper/stargazers)

[它能做什么](#它能做什么) · [快速开始](#快速开始) · [配置说明](#配置说明) · [工作原理](#工作原理) · [反检测设计](#反检测设计) · [FAQ](#faq)

</div>

> ⚠️ **免责声明**：本工具仅供学习与研究用途。使用本工具违反[图寻](https://tuxun.fun)用户协议，账号有被封禁的风险，作者不对任何因使用导致的后果负责。

---

## 它能做什么

进入图寻街景对局后，扩展在页面内部自动完成三件事，全程无需操作：

1. **读坐标** — 拦截街景元数据请求，解出精确经纬度（带 panoId 校验，过滤反作弊注入的假街景）
2. **判位置** — 本地方位引擎 ~400ms 先给出大洲/国家/八方位；若配置了 AI，深度分析（省市区 + 辨识特征）完成后自动覆盖
3. **悬浮窗展示** — 结果显示在可拖动的悬浮窗中，F8 一键隐藏，一键直达 Google Maps

```
对局开始 → 拦截街景响应 → 坐标解析 ─┬─ 本地方位引擎    ~400ms ✅ 先出
                                    └─ AI 深度分析    2~20s  ✅ 自动覆盖
```

## 功能特性

| 特性 | 说明 |
|---|---|
| ⚡ 双线程引擎 | 本地方位与 AI 分析异步并发，先到先展示、AI 到后覆盖，不白等 |
| 🌍 三街景源 | Google Street View（经 chao-fan 代理）/ 百度 / 腾讯，统一解析流程 |
| 🧭 本地方位算法 | 纯函数 + 静态数据表，离线判定 195+ 国家大洲与八方位，零外部依赖 |
| 🤖 AI 增强 | 任意 OpenAI 兼容端（DeepSeek / LongCat / 本地 Ollama…），兼容 `reasoning_content` |
| 🛡️ 反检测设计 | SW 收敛全部外联、closed Shadow DOM、Proxy 透明 hook、per-session 随机事件名 |
| 🪟 悬浮窗 | 可拖动 + 位置记忆、首装引导、小窗适配、来源标识 |
| 🔒 隐私 | 所有 Key 存 `chrome.storage`，页面 JS 不可读；外部请求全部由 Service Worker 发起，页面 Network 面板不可见 |

## 快速开始

前置：Chrome / Edge ≥ 111（Chromium 系浏览器）

1. 下载本仓库（`git clone` 或 Code → Download ZIP 后解压）
2. 打开 `chrome://extensions`，右上角开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择仓库中的 `extension/` 目录
4. 点击工具栏图标完成配置（见下表），进入图寻对局即可自动解析

<details>
<summary><b>按场景选择最小配置</b>（点开）</summary>

| 你的情况 | 最小配置 |
|---|---|
| 有"魔法" | 什么都不填，开箱即用（默认 OSM 源） |
| 无"魔法" | 申请一个高德 Key 填入即可（[高德开放平台](https://console.amap.com) → 创建应用 → 服务平台选「Web 服务」，免费） |
| 想要更准 | 再配任意 OpenAI 兼容 AI（见下方配置说明） |

</details>

## 使用

- 进入街景对局自动解析，按 **F8** 显示/隐藏悬浮窗（输入框内不触发）
- 悬浮窗可拖动，位置自动记忆；点击链接直达 Google Maps 定位
- 底部标识信息来源：`AI 解析` / `本地结果` / `本地模式`（未配置 AI）
- **反检测建议**：拿到答案后延迟 20–40 秒再提交，且故意点偏 1–3 公里

## 配置说明

| 配置项 | 建议 | 说明 |
|---|---|---|
| 启用 / AI 增强解析 | — | 总开关，默认开 |
| 地图源 | 推荐 | `高德 (需Key)` 国内直连；`OSM (需魔法)` 全球覆盖，默认 |
| 高德 Web 服务 Key | 选高德源必填 | 32 位字母数字，高德开放平台免费申请 |
| AI BaseURL | 可选 | OpenAI 兼容端地址，**必须以 `/v1` 结尾** |
| AI Key / 模型名 | 可选 | 与所选服务的 Key 和模型名一致 |

<details>
<summary><b>AI 配置示例</b>（DeepSeek / LongCat / 本地 Ollama）</summary>

| 服务 | BaseURL | 模型名 |
|---|---|---|
| DeepSeek 官方 | `https://api.deepseek.com/v1` | `deepseek-chat` |
| LongCat | `https://api.longcat.chat/openai/v1` | `LongCat-Flash-Chat` |
| 本地 Ollama | `http://localhost:11434/v1` | 如 `qwen2.5:7b` |

> Ollama 不校验 Key，但表单要求非空，填 `sk-1111111111` 之类的占位符即可。

</details>

## 工作原理

```
页面 (tuxun.fun)
  inject.js (MAIN world)        ← Proxy 包装 fetch/XHR 读取街景响应体
                                  + hook setPano 拿真实 panoId（过滤注入的假街景）
      ↓ CustomEvent（per-session 16 字节随机事件名）
  content.js (ISOLATED world)   ← 结构校验 + 限速后转发；closed Shadow DOM 悬浮窗渲染
      ↓ chrome.runtime.sendMessage
  background.js (service worker) ← 坐标解析 + 并发调用 高德/OSM/AI + 同 pano 去重缓存
  direction.js                  ← 本地方位：静态数据表（CC/CTR/cnMap/REG）+ dirOf 纯函数
```

所有外部 API（高德 / OSM / AI）均由 Service Worker 发起，页面 CSP 与 Network 面板完全不可见。

## 反检测设计

| 检测面 | 应对 |
|---|---|
| MutationObserver / `elementFromPoint` | `:host` CSS 隐藏，0×0 宿主 |
| 配置读取 | `chrome.storage.sync`，页面 JS 不可读 |
| 外部请求泄漏 | 全部由 SW 发起，页面不可见 |
| fetch/XHR 原型完整性 | `Proxy` + `Reflect.apply`，`toString` 透明 |
| 控制台日志 | `__GEO_DEBUG__=false` 生产静默 |
| CustomEvent 事件指纹 | per-session 16 字节随机事件名 + 转发结构校验/限速 |
| Service Worker 30s 终止 | 22–28s jitter 心跳（标签页隐藏时暂停） |
| popup 截屏/录屏 | Key 占位符脱敏 |
| 反作弊注入假街景请求 | hook `setPano` 拿真实 panoId，响应体延迟 400ms 校验后转发（仅 Google 源参与比较） |

<details>
<summary><b>已知不可前端修复的检测面</b>（点开）</summary>

- IP 时序关联 / 答题精度统计 / 答题时延 / 视角移动模式 — 由服务端判定
- 反作弊主动伪造随机事件消息 — 事件名可从 `<html data-v>` 读出、内容可伪造；已加结构校验 + 限速抬高成本，但与 inject.js 同源的伪造无法完全区分

</details>

## FAQ

**Q：悬浮窗一直「等待中」？**
进入街景对局、页面发出街景请求后才会触发。若提示「点击工具栏扩展图标完成配置」，先完成配置再开一局。

**Q：没有"魔法"能用吗？**
能。地图源选高德 + 高德 Key 即可正常拿地址；OSM 不可达时会 5–6s 超时降级，不阻塞 AI 与悬浮窗展示。

**Q：AI 一直超时或不出结果？**
检查 BaseURL 是否以 `/v1` 结尾、Key 与模型名是否匹配。AI 失败会自动降级为本地结果（底部标识「本地结果」）；v8.4 起不兼容 `response_format` 的中转会自动去掉该字段重试。

**Q：为什么响应要延迟 400ms 才解析？**
用于 panoId 校验：确保 `setPano` 已更新后再比对，过滤反作弊注入的假街景响应（仅 Google 源参与比较，百度/腾讯源不受影响）。

**Q：换局后结果不更新？**
v8.1 已修复多局复用问题；v8.4 修复了混源对局（Google 之后接百度/腾讯）被误杀的问题。请确认扩展为 v8.4+。

## 版本历史

### v8.4（当前）

- 修复跨源误杀：panoId 校验仅对 Google 源生效，百度/腾讯源放行（此前玩过 Google 局后，百度/腾讯局会被整局丢弃）
- 修复 SW 重启丢结果：序列号改用时间戳，SW 被杀重启后推送不再被乱序过滤静默丢弃
- 反检测补漏：`setPano` hook 改 Proxy 包装（toString 透明）；fetch hook 兼容 `URL` 对象；XHR hook 兼容二进制响应
- 事件通道加固：content 侧转发加结构校验 + 限速
- 同 pano 去重缓存（5 分钟），省重复 AI 调用；OSM 按 1 req/s 节流；AI 400 自动去掉 `response_format` 重试
- `localInfo` 新增 REG 地区表兜底；清理死代码；manifest 补 `minimum_chrome_version` 与图标

<details>
<summary><b>历史版本</b>（v8.3 及更早，点开）</summary>

### v8.3

- OSM 超时 + 高德分支解耦：无魔法下不再 `本地解析失败`，降级未知后 AI 照常覆盖
- 悬浮窗可点 Maps 链接、位置记忆、首装引导、小窗适配；popup Keys 脱敏 + 版本号

### v8.2

- 反作弊注入防护（Google 源）：grpc-web 响应递归提取 panoId，统一参与校验
- 修复全球模式下错误坐标闪现问题

### v8.1

- 反作弊注入防护：hook `StreetViewPanorama.prototype.setPano` 拿真实 panoId
- 响应体延迟 400ms 转发并校验 panoId 匹配，过滤反作弊注入的假请求
- 修复第二局坐标不更新问题

### v8.0

- 商用生产级反检测重构：`__GEO_DEBUG__` 编译开关、Proxy 包装、Shadow DOM template 派生、随机事件名、heartbeat jitter、F8 canvas focus gate、popup 占位符脱敏

</details>

## 支持一下

如果 Geo Helper 帮到了你，欢迎点一个 ⭐ [Star](https://github.com/a1175815821/geo-helper/stargazers) —— 这是对持续维护最大的鼓励。遇到问题请提 [Issue](https://github.com/a1175815821/geo-helper/issues)，附上悬浮窗底部来源标识与控制台报错（开启 `__GEO_DEBUG__` 后重现）。

## License

[MIT](LICENSE)
