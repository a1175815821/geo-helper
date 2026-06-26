# Geo Helper

图寻（[tuxun.fun](https://tuxun.fun)）街景坐标解析与地理信息展示浏览器扩展。基于 Chrome Manifest V3，通过 `chrome.webRequest` 拦截街景元数据响应体，解析真实坐标后展示洲/国家/方位/详细位置/特征描述，辅助玩家识别位置。

> **免责声明**：本项目仅供学习和研究用途。使用本工具违反图寻用户协议，账号有被封禁的风险。作者不对任何因使用本工具导致的后果负责。请自行评估风险。

---

## 功能特性

- **零二次请求**：通过 `chrome.webRequest.filterResponseData` 拦截原始响应体，透传不改，服务端只看到一次请求
- **零原型污染**：不 hook `XMLHttpRequest`、`fetch` 等原生 API，不修改页面全局对象
- **零控制台输出**：不依赖 F12，不调用 `console.clear`，所有信息显示在 Shadow DOM 悬浮窗
- **零页面存储**：配置存储在 `chrome.storage.sync`，图寻页面 JS 无法读取
- **零外部请求泄露**：所有外部 API（高德/OSM/AI）由 service worker 发起，页面 Network 面板看不到
- **Shadow DOM closed**：悬浮窗内部节点对页面 JS 不可访问
- **host 元素伪装**：悬浮窗宿主元素伪装成普通隐藏容器，规避 MutationObserver 和 `elementFromPoint` 检测
- **AI 增强**：接入 OpenAI 兼容接口，输出中文洲/国家/八方位/特征描述，本地降级兜底
- **心跳保活**：content script 每 25 秒 ping service worker，避免 MV3 30 秒终止
- **并发去抖**：同一标签 500ms 内多次结果只推最后一次，避免悬浮窗闪烁
- **配置校验**：高德 Key 32 位校验、AI BaseURL 协议校验、AI Key 格式校验

## 支持的街景源

| 源 | 接口 | 坐标系 |
|---|---|---|
| Google Street View | `GetMetadata` | WGS-84 |
| 百度街景 | `getPanoInfo` | BD-09 |
| 腾讯街景 | `getQQPanoInfo` | GCJ-02 |

## 安装

1. 下载或克隆本仓库
2. 打开 Chrome / Edge，地址栏输入 `chrome://extensions`
3. 右上角打开「开发者模式」
4. 点击「加载已解压的扩展程序」，选择 `extension/` 文件夹
5. 工具栏出现 Geo Helper 图标即安装成功

## 配置

点击工具栏的 Geo Helper 图标，在弹出的配置窗口中填写：

### 基础配置（必填一项）

| 字段 | 说明 |
|---|---|
| 启用 | 总开关 |
| 地图源 | 高德（需 Key）或 OSM（需魔法上网） |
| 高德 Web 服务 Key | 选高德源时必填，32 位字母数字，去 https://lbs.amap.com 申请 |

### AI 配置（可选，推荐）

| 字段 | 说明 |
|---|---|
| AI API BaseURL | OpenAI 兼容接口地址，如 `https://api.openai.com/v1` |
| AI API Key | API 密钥，`sk-` 开头 |
| AI 模型名 | 如 `gpt-4o-mini`、`deepseek-chat`、`glm-4-flash` 等 |

**兼容服务示例**：
- OpenAI: `https://api.openai.com/v1` + `gpt-4o-mini`
- DeepSeek: `https://api.deepseek.com/v1` + `deepseek-chat`
- 智谱: `https://open.bigmodel.cn/api/paas/v4` + `glm-4-flash`
- OpenRouter: `https://openrouter.ai/api/v1` + `openai/gpt-4o-mini`

不填 AI 配置时自动降级为本地解析（OSM 逆地理 + 本地方位算法）。

## 使用

1. 打开 [tuxun.fun](https://tuxun.fun) 开始游戏
2. 进入街景后，扩展自动解析坐标
3. 右上角出现**绿色小圆点** = 有新结果（红色 = 出错）
4. 按 **`Alt + H`** 弹出/关闭悬浮窗
5. 悬浮窗可拖动到任意位置

### 悬浮窗内容示例

```
浙江省杭州市西湖区xxx (街景名)
亚洲  |  中国  |  东中部
西湖区，杭州市，浙江省
江南水乡，西湖附近
Google Maps: @30.2,120.1,6z
```

### 快捷键

| 快捷键 | 功能 |
|---|---|
| `Alt + H` | 切换悬浮窗显示/隐藏 |

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  tuxun.fun 页面                                              │
│  ┌─────────────┐    ┌──────────────────────────────────────┐│
│  │  游戏街景    │    │  content.js (Shadow DOM closed)      ││
│  │  发起请求    │    │  ┌────────────────────────────┐     ││
│  │      ↓       │    │  │  悬浮窗 #box               │     ││
│  │  接收响应    │←───│  │  地址/洲/国家/方位/描述     │     ││
│  │  (透传未改)  │    │  └────────────────────────────┘     ││
│  └─────────────┘    │  host 伪装成普通隐藏元素             ││
│                     └──────────────────────────────────────┘│
│                                  ↑ sendMessage               │
└──────────────────────────────────┼──────────────────────────┘
                                   │
┌──────────────────────────────────┼──────────────────────────┐
│  background.js (service worker)  │                           │
│  ┌───────────────────────────────┴────────────────────────┐ │
│  │  chrome.webRequest.onBeforeRequest                      │ │
│  │  + filterResponseData(details.requestId)                │ │
│  │  拦截街景响应体 → 解析坐标 → 透传给页面                  │ │
│  └─────┬──────────────┬──────────────┬─────────────────────┘ │
│        ↓              ↓              ↓                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐               │
│  │ 高德regeo│  │ OSM逆向  │  │ AI (可选)    │               │
│  └──────────┘  └──────────┘  └──────────────┘               │
│  所有外部请求由 SW 发起，页面 CSP 和反作弊脚本无法检测        │
└──────────────────────────────────────────────────────────────┘
```

### 反检测设计

| 检测面 | 应对 |
|---|---|
| MutationObserver 遍历 DOM | host 伪装成 `position:absolute;1px;visibility:hidden` 的普通隐藏元素 |
| `elementFromPoint` 命中 | dot 加 `pointer-events:none`，不参与 hit-test |
| 页面 JS 读取配置 | 使用 `chrome.storage.sync`，同源不可读 |
| 页面 CSP 拦截外部请求 | 所有外部请求在 service worker 发起 |
| 原生原型完整性检测 | 不 hook 任何原生 API |
| 控制台异常信号 | 不输出到控制台，不调 `console.clear` |
| `prompt/confirm` 弹窗 | 配置用扩展 popup，不碰页面 dialog |
| service worker 30 秒终止 | content 每 25 秒心跳 ping |
| AI 请求超时 | 20 秒超时后自动降级本地解析 |
| 并发请求多次推送 | 同一 tab 500ms 去抖 |

### 不可前端修复的检测面

以下检测在服务端，前端无法绕过，需玩家自行控制：

- **IP 时序关联**：游戏 IP 与外部 API 请求 IP 一致，服务端可关联
- **答题精度统计**：连续高精度提交触发告警
- **答题时序异常**：街景加载后立即提交
- **视角移动模式**：真实玩家会反复探索，脚本用户往往直接看答案

**建议**：拿到答案后延迟 20-40 秒再提交，且故意点偏 1-3 公里。

## 版本历史

### v4.0（扩展版）

- 架构升级：油猴脚本 → Chrome MV3 扩展
- 零二次请求：`webRequest.filterResponseData` 拦截响应体
- 零原型污染：不 hook 任何原生 API
- Shadow DOM closed 悬浮窗
- host 元素伪装，规避 MutationObserver
- service worker 心跳保活
- 并发去抖，AI 超时降级
- 配置校验

### v2.0（油猴脚本）

- 接入 OpenAI 兼容 AI
- 中文输出洲/国家/八方位
- 去除广告
- Google Maps 直链

### v1.1（油猴脚本）

- 初始版本
- XHR hook 解析街景
- 高德/OSM 逆地理
- 控制台输出

> 油猴脚本版本（`tuxun1.1.js`、`tuxunv2.js`）保留在仓库作为历史参考，不再维护。推荐使用扩展版。

## 文件结构

```
.
├── extension/          # Chrome MV3 扩展（推荐）
│   ├── manifest.json
│   ├── background.js   # service worker，网络拦截与外部请求
│   ├── content.js      # content script，悬浮窗显示
│   ├── popup.html      # 配置界面
│   └── popup.js        # 配置逻辑与校验
├── tuxun1.1.js         # 油猴脚本 v1.1（历史）
├── tuxunv2.js          # 油猴脚本 v2（历史）
├── LICENSE
├── README.md
└── .gitignore
```

## 技术栈

- Chrome Extension Manifest V3
- `chrome.webRequest.filterResponseData` (StreamFilter API)
- Shadow DOM (closed mode)
- `chrome.storage.sync`
- Service Worker + 心跳保活
- OpenAI 兼容 Chat Completions API

## 贡献

欢迎提 Issue 和 PR。请勿在 Issue 中讨论具体作弊方法，只讨论技术实现。

## License

[MIT](LICENSE)
