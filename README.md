# Geo Helper

图寻（[tuxun.fun](https://tuxun.fun)）街景坐标解析与地理信息展示浏览器扩展。通过页面内 fetch/XHR hook 读取街景元数据，递归解析坐标后经 AI / OSM / 高德反查位置信息，在 Shadow DOM 悬浮窗中展示。

> **免责声明**：仅供学习和研究用途。使用本工具违反图寻用户协议，账号有被封禁的风险。作者不对任何因使用本工具导致的后果负责。

---

## 功能特性

- **双线程引擎**：本地解析（方向 + 粗略地址）与 AI 深度分析异步并发，本地平均 ~400ms 出结果、AI 跑完后自动覆盖更新，不浪费等待时间
- **跨 world 通信**：`inject.js`（MAIN world）Proxy 包装 fetch/XHR → CustomEvent（随机事件名）→ `content.js`（ISOLATED world）→ background SW
- **零外部请求泄露**：所有 API（高德 / OSM / AI）由 service worker 发起，页面 Network 面板不可见
- **Shadow DOM closed**：悬浮窗在 closed Shadow DOM 内，`:host` CSS 伪装（`0×0` 不可见宿主），规避 `elementFromPoint` / MutationObserver
- **反检测设计**：`Proxy` 包装透明转发 toString；`__GEO_DEBUG__` 编译开关控制台静默；per-session 16 字节随机事件名；heartbeat jitter（22-28s）
- **反作弊注入防护**：hook `google.maps.StreetViewPanorama.prototype.setPano` 拿真实 panoId，响应体延迟 400ms 转发并校验 panoId 匹配（百度/腾讯 `data.pano` 字段 + Google 源 grpc-web 递归提取 `[2, "base64url"]`），过滤反作弊注入的假请求
- **AI 增强**：接入 OpenAI 兼容接口（支持 LongCat/DeepSeek-R1 等 `reasoning_content`），输出中文洲/国家/方位/特征，AI 失败自动降级本地查询
- **本地方位算法**（`direction.js`）：纯函数 + 数据表，零依赖，支持 ≥14 个大国八方位判断
- **三源支持**：Google Street View（`GetMetadata`，经 `chao-fan.com` 代理）、百度（`getPanoInfo`）、腾讯（`getQQPanoInfo`）

## 快速开始

1. 下载仓库，Chrome/Edge 打开 `chrome://extensions`，开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择 `extension/` 目录
3. 点击工具栏图标，填入配置（高德 Key / OSM / AI API），保存即可

## 使用

- 进入 `tuxun.fun` 街景后自动解析坐标，按 **`F8`** 切换悬浮窗显示/隐藏（输入框内不触发）
- 悬浮窗可拖动（位置记忆），底部显示信息来源（AI 解析 / 本地结果）
- 建议：拿到答案后延迟 20-40 秒提交，且故意点偏 1-3 公里

## 架构

```
页面 (tuxun.fun)
  inject.js (MAIN)            ← Proxy 包装 fetch/XHR，读取响应体
      ↓ CustomEvent (随机事件名)
  content.js (ISOLATED)       ← Shadow DOM 悬浮窗，转发给 background
      ↓ chrome.runtime.sendMessage
background.js (service worker) ← 解析坐标 + 调外部 API (高德/OSM/AI) 取回位置
  direction.js                ← 本地方位算法 (静态数据表 + dirOf 纯函数)
```

### 反检测

| 检测面 | 应对 |
|---|---|
| MutationObserver / `elementFromPoint` | `:host` CSS 隐藏，0×0 宿主 |
| 配置读取 | `chrome.storage.sync`，页面 JS 不可读 |
| 外部请求泄漏 | SW 发起，页面 CSP 不可见 |
| fetch/XHR 原型完整性 | `Proxy` + `Reflect.apply`，透明转发 |
| 控制台日志 | `__GEO_DEBUG__=false` 生产静默 |
| CustomEvent 事件指纹 | per-session 16 字节随机事件名 |
| Service Worker 30s 终止 | 22-28s jitter 心跳 |
| popup 截屏/录屏 | 占位符脱敏 |
| 反作弊注入假街景请求 | hook `setPano` 拿真实 panoId，响应体延迟 400ms 校验匹配后转发 |

### 不可前端修复

- IP 时序关联 / 答题精度统计 / 答题时延 / 视角移动模式 — 由服务端判定

## 版本历史

### v8.3（当前）

- OSM 超时 + 高德分支解耦：无魔法下不再 `本地解析失败`，降级未知后 AI 照常覆盖
- 悬浮窗可点 Maps 链接、位置记忆、首装引导、小窗适配；popup Keys 脱敏 + 版本号

### v8.2

- 反作弊注入防护（Google 源）：grpc-web 响应递归提取 `[2, "base64url"]` panoId，统一参与校验
- 修复全球模式下错误坐标闪现问题

### v8.1

- 反作弊注入防护：hook `StreetViewPanorama.prototype.setPano` 拿真实 panoId
- 响应体延迟 400ms 转发并校验 panoId 匹配，过滤反作弊注入的假请求
- 修复第二局坐标不更新问题（`setPosition` 坐标在多局间复用，改用响应体坐标 + panoId 校验）

### v8.0

- 商用生产级反检测重构：`__GEO_DEBUG__` 编译开关、Proxy 包装、Shadow DOM template 派生、随机事件名、heartbeat jitter、F8 canvas focus gate、popup 占位符脱敏

## 文件结构

```
extension/
├── background.js   # service worker，响应体解析 + 外部 API 调用
├── inject.js       # MAIN world，Proxy 包装 fetch/XHR
├── content.js      # ISOLATED world，Shadow DOM 悬浮窗 + 心跳
├── direction.js    # 本地方位算法（纯函数 + 数据表）
├── popup.html      # 配置界面
├── popup.js        # 配置逻辑与校验
└── manifest.json
```

## License

[MIT](LICENSE)
