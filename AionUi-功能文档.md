# AionUi 功能探索文档

> 本文基于对 `AionUi/` 仓库的源码探索整理而成（v2.1.47）。探索范围覆盖 `packages/desktop`（Electron 主进程 + 渲染进程）、`packages/web-host`、`packages/web-cli`、`mobile`、`examples`、`docs` 及项目内协作文档（`.aionui/`）。

---

## 1. 项目概览

### 1.1 定位

AionUi 是一个**免费开源的多 AI Agent 桌面协同（Cowork）平台**：把命令行 AI Agent（Claude Code、Codex、Gemini CLI 等）变成带图形界面的现代 AI 聊天/办公应用。其核心差异化在于——不只是聊天客户端，而是让 Agent 真正在用户电脑上"干活"（读写文件、执行任务、自动化办公），并支持多 Agent 并行、远程访问与 24/7 定时自动化。

一句话总结：**内置 Agent 引擎（零配置）+ 多 CLI Agent 统一接入 + WebUI/移动端/IM 远程协同 + 定时任务自动化**。

### 1.2 核心数据

| 项目 | 说明 |
|---|---|
| 名称 / 版本 | AionUi v2.1.47（productName: AionUi） |
| 许可证 | Apache-2.0 |
| 平台 | macOS / Windows / Linux（Electron 桌面端） |
| 后端 | 独立 Rust 后端 **aioncore**（AionCore 仓库构建，v0.1.58） |
| 前端技术栈 | Electron 37 + React 19 + TypeScript 5.8 + Vite( electron-vite ) + UnoCSS + Arco Design |
| 本地存储 | SQLite（better-sqlite3 驱动，schema 版本 v26）+ 本地 JSON 配置 |
| 数据安全 | 数据全部存本地 SQLite，不上传服务器 |
| 语言 | i18n 覆盖 14 种语言 |

### 1.3 产品形态（4 种）

1. **桌面端**（Electron）：主形态，完整功能。
2. **WebUI 模式**：通过浏览器远程访问（同一台/局域网/跨网/服务器部署），支持 PWA。
3. **移动端**（Expo React Native）：扫码连接桌面端，聊天 + 文件浏览。
4. **IM 渠道**：Telegram / Lark(飞书) / DingTalk / 微信 / 企业微信 机器人，7×24 个人终端助手。

---

## 2. 总体架构

### 2.1 仓库结构

```
AionUi/
├── packages/
│   ├── desktop/          # Electron 桌面应用（主进程 + 渲染进程 + preload）
│   ├── web-host/         # WebUI 运行时核心（零 Electron 依赖）
│   └── web-cli/          # 独立 WebUI 单文件二进制 (aionui-web)
├── mobile/               # 移动端 Expo / React Native app
├── examples/             # 5 个扩展示例（aion-extension.json 清单型）
├── docs/                 # readme 多语言 / PRD / 主题 / 指南
├── public/               # PWA 资源 + 桌面宠物 SVG 状态集
├── scripts/              # 构建/打包/冒烟/i18n/基准 脚本
├── .aionui/              # AI 协作功能开发方案文档（含 Channel 插件系统设计）
└── resources/            # 宣传素材、图标、演示 gif
```

### 2.2 双进程架构（Electron）

按 `AGENTS.md` 的强制约束，主进程与渲染进程**禁止混用 API**：

| 进程 | 路径 | 职责 | 限制 |
|---|---|---|---|
| Main（主进程） | `packages/desktop/src/process/` | 窗口/系统能力、后端生命周期、托盘、宠物、更新、IPC 桥 | 无 DOM API |
| Renderer（渲染进程） | `packages/desktop/src/renderer/` | 全部 UI 页面与交互 | 无 Node.js API |
| Preload | `packages/desktop/src/preload/` | 跨进程通信桥（IPC） | — |

跨进程通信走 **IPC 桥**（`common/adapter/ipcBridge.ts`）。渲染进程内的业务数据统一通过 `api/client.ts`（HTTP）访问 aioncore 后端，仅 Electron 原生能力（窗口、对话框、通知、主题、CDP 等）保留 IPC。

### 2.3 双仓库开发模式

- **AionCore**（`github.com/iOfficeAI/AionCore`，Rust）：编译本地后端二进制 `aioncore`，提供 REST `/api/*` + WebSocket + 认证。
- **AionUi**（`github.com/iOfficeAI/AionUi`）：Electron 前端壳，启动时自动 spawn `aioncore` 子进程，通过 `startWebHost`/`BackendLifecycleManager` 管理其生命周期（/health 轮询 + `AIONCORE_READY` 标记双通道就绪判定、崩溃指数退避重启、进程树清理）。

### 2.4 通信适配层（common/adapter）

`ipcBridge.ts`（约 2187 行）定义了渲染进程调用的全部业务 API 域，绝大多数经 `httpBridge.ts` 的 REST/WS 转发给 aioncore。覆盖域包括：

`shell` · `assistants` · `conversation`（消息/流/确认/审批/artifact/usage/slash-commands/fork）· `runtime` · `project` · `application` · `update`/`autoUpdate` · `dialog` · `fs` · `workspaceOfficeWatch` · `fileStream` · `google`/`bedrock` · `mode`（provider CRUD）· `acpConversation` · `mcpService` · `openclawConversation` · `remoteAgent` · `database` · `previewHistory`/`preview`/`document` · `deepLink` · `windowControls` · `theme` · `systemSettings` · `notification` · `webui` · `cron` · `extensions` · `channel` · `hub` · `team`

---

## 3. 核心功能模块（桌面端）

### 3.1 多 Agent 支持（Multi-Agent Mode）

**能力**：AionUi 内置完整 Agent 引擎（装好即用、零配置），同时自动检测本机已安装的 CLI Agent 并统一接入。

- **支持的 Agent 类型**（`common/types/agent/detectedAgent.ts`）：`acp`（涵盖 Claude / Codex / Qwen 等 ACP CLI）· `aionrs`（本地 Rust 运行时）· `openclaw-gateway` · `nanobot` · `remote`（远端 OpenClaw / Zeroclaw / ACP 协议 agent）
- **已适配的 CLI Agent（20+）**：Claude Code、Codex、Qwen Code、Goose AI、OpenClaw、Augment Code、CodeBuddy、Kimi CLI、OpenCode、Factory Droid、GitHub Copilot、Qoder CLI、Mistral Vibe、Nanobot、Aion CLI（aionrs）、Snow CLI、Hermes Agent、Cursor Agent、Antigravity (agy) 等
- **核心特性**：
  - **自动检测**：识别已安装的 CLI 工具
  - **统一界面**：同一 Cowork 平台管理所有 Agent
  - **并行会话**：多 Agent 同时运行、上下文独立
  - **MCP 统一管理**：配置一次 MCP 工具，自动同步到所有 Agent
  - **YOLO 模式 / 全自动模式**：一键绕过权限确认，无人值守执行
  - **Agent 市场（Hub）**：`AgentHubModal`，可安装/管理 Agent

### 3.2 团队模式（Team Mode）

多 Agent 编排协作：**Leader** 接收用户指令 → 拆解子任务 → 委派给并行执行的 **Teammate**，通过内置 Team MCP Server 协作，结果经异步 mailbox 汇聚，写入共享任务看板。

- **后端支持**：Claude Code、Codex、Hermes Agent、Gemini、Snow CLI、Aion CLI（aionrs）；其他带 `mcpCapabilities.stdio` 的 ACP 后端自动支持
- **UI 能力**（`pages/team/`）：
  - 并行多列视图 / 单聊视图切换（按团队记忆视图模式）
  - **成员身份色系统**：按 slot_id 绑定颜色，区分并行消息归属；顶部胶囊成员栏 + 气泡色条 + 选中高亮
  - **Warmup 预热**：磨砂遮罩 + 成员逐个点亮 + 进度条，Leader 就绪即撤除；teammate 失败不阻塞、可重试
  - **活动/任务看板**（`TeamActivityView`）：mailbox 与 task-board
  - 成员动态增删、静默成员自动升级为失败、权限确认独立对话框 + 侧栏待审批徽标
  - 手动成员管理、`@` 文件分享

### 3.3 模型与 Provider（30+ AI 平台）

任何 API Key 都能驱动完整 Agent 能力（文件读写、web 搜索、图片生成、工具调用）。

- **官方平台**：Gemini（OAuth personal / API Key）、Vertex AI、Anthropic（Claude）、OpenAI
- **云服务**：AWS Bedrock、New API（统一模型网关）
- **国内平台**：Dashscope(Qwen)、智谱、Moonshot(Kimi)、千帆(百度)、混元(腾讯)、阶跃、ModelScope、InfiniAI、天翼云、SiliconFlow-CN、PPIO 等
- **海外平台**：DeepSeek、MiniMax、Novita、OpenRouter、SiliconFlow、xAI、火山方舟、Poe 等
- **本地模型**：Ollama、LM Studio（经自定义平台本地端点）
- **Provider 认证类型**（`provider/authType.ts`）：`oauth-personal`(Google) / `gemini-api-key` / `vertex-ai` / `openai` / `anthropic` / `bedrock` 等
- **模型选择器**：一级菜单 + 二级子菜单结构；模型数 >5 显示搜索；aionrs 平台按 provider 分组

### 3.4 聊天与对话（conversation）

- **会话页**（`pages/conversation/`）：按会话类型分发到 `AcpChat` / `AionrsChat` / `LegacyReadOnlyConversation`
- **消息渲染**（`Messages/`）：text / thinking（思考过程）/ tool_call / tool_group / plan / agent_status / permission（权限审批面板）/ acp_permission / cron_trigger / skill_suggest / file_changes / tips 等丰富消息块
- **会话历史**（`GroupedHistory/`）：按工作区分组、拖拽排序、置顶、批量选择/删除、会话搜索
- **锚点导航**（anchorRail）：消息章节导航 + 搜索入口
- **发送草稿箱**（sendbox 排队面板）：AI 回复期间消息排队；每条常驻"立即发送/编辑/删除"，支持打断插队、自动/手动发送模式、拖拽排序、清空二次确认
- **斜杠命令**（`common/chat/slash/`）：builtin > ACP > skill 优先级合并
- **`@` 文件引用**（atCommandParser + AtFileMenu）：@路径解析、tab 补全
- **fork 会话**：在指定消息处派生新会话（按 `fork_capability.at_turn` 门控）
- **自动命名**：Agent 驱动的会话自动命名
- **侧问**（sideQuestion）：仅 acp + claude 支持
- **标题迷你地图**（ConversationTitleMinimap）

### 3.5 预览面板（Preview）

预览面板是重量级模块（`pages/conversation/Preview/`），多 Tab 文件查看与编辑系统，支持流式更新（500ms 防抖）、Git 版本历史、分屏、快捷键、脏检测。

- **9+ 查看器**（`components/viewers/`）：MarkdownViewer / ImageViewer / DiffViewer / PDFViewer / OfficeDocViewer(Word) / PptViewer / ExcelViewer / HTMLViewer / URLViewer
- **3 类编辑器**（`components/editors/`）：CodeEditor（CodeMirror 6）/ MarkdownEditor（实时预览+分屏）/ HTMLEditor
- **特殊渲染器**（`components/renderers/`）：HTMLRenderer（iframe + 检查模式）+ SelectionToolbar（元素选中工具栏）
- **浏览器 Tab**（`browser/`）：内嵌浏览器，常驻挂载避免重载，`MAX_BROWSER_TABS` 上限、Agent 活动指示
- **多 Tab 管理**：智能 Tab 复用（`PreviewContext`）、右键菜单、版本历史下拉（Git 快照）
- **支持的预览格式**：PDF、Word(.doc/.docx/.odt)、Excel(.xls/.xlsx/.csv)、PowerPoint(.ppt/.pptx)、30+ 代码语言、Markdown、HTML、图片、diff

### 3.6 文件与工作区（explorer / workspace）

- **项目文件浏览器**（`pages/conversation/explorer/`）：文件树、搜索、vscode-icons 文件图标、运行时状态监视、拖拽导入、打开到预览面板、reveal-in-folder
- **智能文件管理**：AI 自动整理文件夹、按类型分类、批量重命名、合并文档
- **工作区**：`ChatSlider` 文件侧栏、`WorkspaceFolderSelect`、最近工作区、工作区记忆（每会话）
- **office 文件实时监视**（`workspaceOfficeWatch`）：文件变化自动刷新预览

### 3.7 定时任务（Cron）

让 Agent 按计划自动执行，24/7 无人值守（`pages/cron/` + 路由 `/scheduled`）。

- **三种调度模式**：标准 cron 表达式（带时区）/ 固定间隔（每 N 分钟/小时）/ 一次性触发
- **执行模式**：续接已有会话（保留上下文）/ 每次新建会话（独立周期报告）
- **其他能力**：任务绑定会话、自动执行、启停/暂停全部、Keep Awake（防止系统睡眠 + 唤醒后补跑错过的触发）、任务级独立模型/工作目录/推理强度、运行历史与立即执行、对话内 AI 自动创建任务、"Create via chat" 分体按钮跳到首页预填提示词
- **对话头部状态图标**：无任务不显示；有关联显示彩色状态（绿=运行中 / 橙=暂停 / 红=出错）
- **队列保护与去重**：防止重复执行

### 3.8 助手与技能（Assistants & Skills）

- **21 个内置专业助手**：Cowork、PPT Creator、Morph PPT / Morph PPT 3D、Pitch Deck Creator、Dashboard Creator、Word Creator、Word Form Creator、Excel Creator、Academic Paper Writer、Financial Model Creator、3D Game、UI/UX Pro Max（57 风格 95 色板）、Planning with Files、HUMAN 3.0 Coach、Social Job Publisher、Beautiful Mermaid、OpenClaw Setup、Story Roleplay 等。每个助手由 markdown 文件定义。
- **自定义助手**：创建自己的助手，自定义规则与能力；`AssistantEditorPage` 含身份/提示词/规则/默认值编辑
- **三层技能系统**：内置技能（随 App 发布，含 pptx/docx/pdf/xlsx/mermaid 等）+ 自定义技能（`skills/` 目录）+ 扩展技能（经 Extension SDK 贡献）；按会话启用/禁用（对话头部技能指示器）
- **技能中心**（`SkillsHubSettings`）：技能详情页、文件浏览器、被哪些助手使用、批量删除、导入历史

### 3.9 设置系统

设置页复用弹窗/页面双形态（`SettingsPageWrapper` + `SettingsModal/contents/*`）：

| 设置页 | 内容 |
|---|---|
| 模型设置 | provider/model CRUD、一键导入、健康检查 |
| Agent 设置 | Agent 卡片、Agent 市场、修复向导、环境变量编辑器、绑定的助手 |
| 助手管理 | My / Official 两个 tab、内置/自定义助手管理 |
| 技能设置 | 技能中心 |
| 工具/MCP | MCP 服务器管理（CRUD、工具列表、json 导入、OAuth） |
| 外观 | CSS 主题预设（10+ 套）、自定义 CSS 皮肤、主题 tokens、背景、字体缩放 |
| WebUI 设置 | WebUI 端口/远程访问、渠道配置 |
| 系统设置 | 关闭到托盘、语音输入、通知、清空浏览器数据、开发者调试 |
| 桌面宠物 | 开关/大小/拖拽/DND |
| 关于/更新 | 版本、更新检查 |
| 扩展设置 Tab | 扩展贡献的 iframe 设置页 |

**渠道绑定配置**（`contents/channels/`）：DingTalkConfigForm / LarkConfigForm / TelegramConfigForm / WecomConfigForm / WeixinConfigForm。

### 3.10 桌面宠物（Pet）

透明的置顶小动画角色（仅 Electron 桌面端，`process/pet/` + `renderer/pet/`）。

- **状态机**：22 种状态（`public/pet-states/` 23 个 SVG），优先级/最短展示时长/自动回退，DND 免打扰
- **空闲行为**（`petIdleTicker`）：光标追踪、眼动（SVG viewBox）、随机 idle 动画（random-look / yawn / deep-sleep）
- **事件联动**（`petEventBridge`）：把 `confirmation.add` 和聊天流事件（thinking/text/finish/error）映射为宠物状态
- **确认气泡**（`petConfirmManager`）：AI 工具调用确认气泡窗口，位置锚定、把确认结果转发后端
- **交互**：双窗口（渲染 + 命中检测）、拖拽跟随（60FPS）、右键菜单（抚摸/尺寸/DND/复位/隐藏）

### 3.11 首页引导（guid）

登录后默认首页：集中式输入卡片，选择助手、模型、思考等级、权限模式、技能与 MCP 开关；支持 slash 命令、语音输入、文件上传/工作目录、示例 prompt 快捷填充、打字机占位符。定时任务"Create via chat"由此预填提示词。

### 3.12 登录与认证

- 登录页（用户名/密码、"记住我"、语言切换）
- `aionui://` 深链协议
- WebUI 首次启用自动播种初始密码；`resetpass` 脚本重置密码

---

## 4. 远程访问形态

### 4.1 WebUI 模式（web-host + web-cli + scripts/webui.ts）

**web-host**（`@aionui/web-host`，零 Electron 依赖）是 WebUI 运行时核心：spawn/reuse aioncore 子进程 + 提供静态 SPA + 反代 `/api/*` 与 WebSocket。关键技术点：

- **双层监听器**：外层 `net.Server` peek 首包决定路由——`GET /ws` 与 `/api/stt/stream` 走原始 TCP splice，其余走内部 loopback HTTP server（规避 bun http-compat 缺陷）
- **就绪语义**：`AIONCORE_LISTENING {port}` 报端口 + `AIONCORE_READY` 为权威就绪信号，与 /health 轮询竞速
- **端口安全**：`findAvailablePort()` 跳过 fetch 封禁端口，默认 25808
- **allowRemote**：绑定 `0.0.0.0` 暴露 `networkUrl`/`lanIP`；否则仅 `127.0.0.1`
- **PWA**：`public/` 提供 manifest + Service Worker v2

**web-cli**（`aionui-web` 单文件二进制，~100MB）：无需 Electron 即可远程访问；`start`（默认）/`resetpass`/`version`/`help`；后端缺失时降级为 **frontend-only 模式**（静态服务器 + 502）；数据目录 `~/.aionui-web`。

**启动方式**（`scripts/webui.ts`）：`bun run webui` / `webui:remote` / `webui:prod` / `webui:prod:remote`。

**无头服务器部署**（`docs/guides/deploy-server.md`）：Xvfb 虚拟显示 + nohup 服务脚本 + ngrok/SSH 隧道 + PAC 代理自动回退 + Shell 代理自动检测。

### 4.2 IM 渠道（Channel 插件系统）

通过 Telegram / 飞书 / 钉钉 / 微信 / 企业微信 机器人，把 AI Agent 变成 7×24 个人终端助手。架构详见 `.aionui/FEATURE_CHANNELS.md`：

```
平台消息 → Plugin(平台适配层) → ActionExecutor(Gateway 路由) → Agent(Gemini/ACP/Codex)
                                                         ↓
平台响应 ← Plugin(转换) ← ChannelMessageService ← ChannelEventBus(事件总线)
```

- **ChannelManager 单例**统一管理：PluginManager（插件生命周期：created→initializing→ready→starting→running→stopping→stopped→error）/ SessionManager / PairingService / ActionExecutor / ChannelMessageService
- **统一消息格式**：入站 `IUnifiedIncomingMessage`、出站 `IUnifiedOutgoingMessage`
- **统一 Action 机制**：平台 Action（插件自理）/ 系统 Action（会话管理、设置、帮助）/ 对话 Action（发送、重新生成、继续、停止）
- **配对安全机制**（参考 Clawdbot）：6 位配对码 + 10 分钟有效 + **必须在 AionUi 本地批准**（非 IM 内）+ 用户白名单 + Token bcrypt 加密存储
- **已实现**：
  - **Telegram**：grammY 库，Polling 模式（自动重连），Inline/Reply Keyboard，流式消息（editMessage 更新）
  - **Lark/飞书**：官方 Node SDK，WebSocket 长连接（无需公网 URL），Card 交互，事件去重（5 分钟缓存），HTML→Lark Markdown
  - **钉钉**：AI Card 流式 + 自动回退（CHANGELOG 提及）
- **扩展性**：v15 起放开插件类型约束，支持扩展贡献 channel 插件（见 `examples/ext-wecom-bot`、`ext-feishu`）

### 4.3 移动端 App（mobile/）

Expo / React Native（expo-router，v0.1.0）的移动客户端。

- **连接方式**：扫描二维码或粘贴链接 → `POST /api/auth/qr-login` 换取 JWT → 存 `expo-secure-store` → 同时配置 REST baseURL 与 WS
- **协议对齐**：WS 消息结构与桌面 `adapter/browser.ts` 完全镜像，bridge 复用桌面 subscribe/callback 协议
- **三大 Tab**：Chat / Files / Settings；暗色主题、i18n（en-US/zh-CN/ru-RU/de-DE/uk-UA）
- **认证韧性**：心跳时 token 剩余 <1h 主动 refresh；收到 `auth-expired`/1008 走认证挑战恢复
- **WebSocket 服务**：心跳 ping/pong、指数退避重连（500ms→8s）、死连接检测（50s 无 ping）
- **聊天渲染**：`ChatScreen` / `MessageBubble` / `ToolCallBlock`，连续工具调用聚合为摘要

### 4.4 桌面端 WebUI 内嵌

桌面端也可开启内置 WebUI（`webuiConfig.ts` + `webuiBridge.ts`）：start/stop/getStatus + 首次启用播种初始密码。

---

## 5. 扩展体系

### 5.1 aion-extension.json 清单型扩展

扩展系统采用 **contributes 清单 + 生命周期 + i18n** 设计（`examples/` 5 个示例验证能力）。

**贡献点（HubContributes）**：

| 贡献点 | 说明 | 示例 |
|---|---|---|
| `acpAdapters` | 贡献 ACP adapter（cli / http 类型） | codebuddy CLI、自定义 agent |
| `agents` | 自定义 Agent | hello-world |
| `assistants` | 助手定义 | — |
| `skills` | 技能 | — |
| `mcpServers` | MCP 服务器（stdio / http） | — |
| `channelPlugins` | IM 渠道插件 | ext-wecom-bot、ext-feishu |
| `themes` | 主题 | e2e-*.css |
| `settingsTabs` | 设置页 Tab（iframe） | hello-settings.html |
| `webui` | WebUI API 路由 | ext-feishu 的 /ext-feishu/collect |

**示例**：
- `hello-world-extension`：结构最完整的参考实现（含 `$schema`、engine、lifecycle、permissions、`$file:` 引用拆分）
- `e2e-full-extension`：覆盖**所有** contribute 类型的 CI/E2E 权威 fixture
- `ext-wecom-bot`：企业微信 AI Bot（AES-256-CBC 加密回调 + SHA1 签名 + 流式轮询响应）
- `ext-feishu`：飞书频道（不依赖官方 SDK）
- `acp-adapter-extension`：贡献 ACP adapter

### 5.2 扩展 Hub 市场

`common/types/agent/hub.ts` 定义 `IHubExtension`/`IHubIndex`/`HubContributes`；`scripts/prepareHubResources.js` 下载 AionHub index + 扩展 zip 到 `resources/hub/`；扩展加载含 `hotReload`（ExtensionRegistry）。

---

## 6. 内置 MCP 与工具

### 6.1 应用内浏览器（CDP 桥）

让 Agent 直接操作 App 内嵌浏览器（`process/resources/builtinMcp/`）。

- `cdpBridge.ts`：`startCdpBridge()` 启动**单目标 CDP 通道**——只暴露侧边浏览器那一个 `webview` 的 webContents（`getType() === 'webview'` 校验，绝不暴露主窗口）；HTTP 发现段不鉴权、WS 段强制 token；`listen(0)` 随机端口
- `cdpTargetProtocol.ts`：把单页面伪装成"只有一标签的浏览器"，本地应答 `Target.*`，拒绝 `Target.createTarget`/`Browser.close` 等危险命令；常量时间 token 比较
- `browserServer.ts`：stdio MCP 启动器，spawn 固定版本 `chrome-devtools-mcp@0.16.0`，缺凭证拒绝启动
- **安全边界**：默认开启（装好即用），设置提供总开关；Agent 首次操作浏览器给一次性知情提示
- **PRD**（`docs/prds/agent-browser/prd.md`）：用户可主动开浏览器 tab（文件树面板下拉菜单 + 预览框 ➕）；登录态（Cookie/本地存储）全局共享、不随项目切换、重启保留、设置可清空；Agent 打开页面实时呈现，用户可随时接管（典型：Agent 打开登录页 → 用户输账号密码 → Agent 继续）

### 6.2 图片生成

内置 MCP stdio 服务器（`imageGenServer.ts`，工具 `aionui_image_generation`）：读取 `AIONUI_IMG_*` env 的 provider 配置，复用 `common/chat/imageGenCore`（多图处理、base64/dataURL、保存到 workspace）。能力：文生图、图编辑、图像识别、批量生成（Gemini 驱动）。

### 6.3 文档转换

`common/chat/document/DocumentConverter.ts`：Markdown 中心化转换——Word↔Markdown（mammoth + turndown）、Excel↔Markdown 表格（SheetJS）；`common/types/office/` 覆盖 Word/Excel/PPT/PDF ↔ markdown/json。

### 6.4 语音输入（STT）

`renderer/services/speech/`：WebSocket 流式 STT 客户端（PCM16 协议）+ PCM 录音 + OpenAI/Deepgram 语音模型预设。

---

## 7. 主题与国际化

### 7.1 主题系统（theming）

基于**语义 Token**（`docs/theming/tokens.md`）的完整主题系统：

- **Token 分层**：品牌色阶 `--aou-1..10` / 背景 `--bg-1..10` / 文字 `--text-*` / 语义状态 `--primary/success/warning/danger` / 边框 / 品牌强调 / 填充反色 / 组件专用
- **生效机制**：基底样式表（`default-color-scheme.css`，light/dark）→ 主题可选 `tokens` 映射（注入 `<style id="theme-tokens">`）→ 装饰主题用 `css` 字段（注入 `<style id="theme-decoration">`）
- **UnoCSS 桥接**：工具类映射到 token 变量（`bg-1` → `var(--bg-1)`），覆盖 token 即全局跟随
- **主题类型**：内置 Light/Dark + 装饰性预设（10+ 套 CSS 皮肤）+ 用户自定义 CSS 皮肤（Settings → Appearance）
- **自动跟随系统**：`systemAppearance` / `systemThemeWatcher`；字体缩放

### 7.2 国际化（i18n）

- **14 种语言**：en-US / zh-CN / zh-TW / ja-JP / ko-KR / tr-TR / ru-RU / uk-UA / pt-BR / de-DE / es-ES / fa-IR（渲染层）+ 主进程 12 种
- **模块化**：每语言含 acp / agent / common / conversation / cron / guid / login / mcp / messages / pet / preview / settings / team / tools 等 JSON 翻译模块
- **强制规范**：新增用户可见文本必须走 i18n key（`scripts/check-i18n.js` 校验、`generate-i18n-types.js` 生成强类型 key）

---

## 8. 更新与分发

### 8.1 更新服务

- **CDN feed**：`static.aionui.com/releases` 按平台/架构 channel（latest.yml / latest-mac.yml / latest-arm64-mac.yml 等），自定义 `CdnGenericProvider`（继承 electron-updater GenericProvider）
- **自动更新状态机**：checking/available/…/cancelled；macOS 原生 Squirrel 安装就绪等待；`quitAndInstall` 前清理（停后端）；Windows 安装器 cwd 迁移
- **手动更新**：CDN 权威 + GitHub API 增强（release notes）；限白名单下载（重定向逐跳校验）
- **更新诊断**：`auto-update-diagnostics.json` 记录事件；安装器失败标记 `installer-last-failure.json` 消费
- **说明**：2.1.47 起停止 App 内更新，引导迁移到官网下载

### 8.2 构建分发

electron-vite 构建（main/preload/renderer 到 `out/`）；electron-builder 打包 macOS（arm64/x64）/ Windows（arm64/x64）/ Linux（.deb）；Homebrew 安装（`brew install aionui`）；Windows 安装器冒烟测试脚本集。

---

## 9. 工程与开发实践

### 9.1 测试体系

- **单元/集成**：Vitest 4，覆盖率目标 ≥80%
- **契约测试**：`test:contract`
- **E2E**：Playwright（含团队用例：创建/生命周期/白名单/通信）
- **基准**：数据库 / 启动 / ACP 启动 / 全量报告
- **Bun 测试**：数据库驱动专项
- **Windows 安装器冒烟**：失败弹窗 / 自锁 / RestartManager UI

### 9.2 质量工具链

- **oxlint + oxfmt**（rust 原生 lint/format）+ prek（CI 复刻检查）+ husky + lint-staged
- **路径别名**：`@/*`（common）、`@process/*`、`@renderer/*`
- **目录规范**：每目录 ≤10 直接子项（architecture skill）
- **just push 门禁**：lint → format → typecheck → test → push

### 9.3 关键启动流程（主进程）

`packages/desktop/src/index.ts`：单实例锁 → Windows PATH 修复（`hydrateWindowsProcessPath`）→ CDP 桥启动 → 架构兼容性检测 → `startBackendOrExit`（后端启动 + 失败分类）→ 创建主窗口 → 宠物/托盘/WebUI/i18n 初始化 → 数据迁移（遗留 DB v26 基线 + config/providers/MCP 迁移）→ quit 清理（停后端、销毁宠物/托盘、10s 超时强制退出）。

---

## 10. 功能地图速查

| 用户诉求 | 对应功能 | 关键路径 |
|---|---|---|
| 让 Agent 干活 | 内置 Agent 引擎 + 多 CLI Agent | `renderer/pages/guid`、`pages/conversation` |
| 多 Agent 并行 | 团队模式 | `pages/team`、`common/types/team` |
| 换模型 | 30+ Provider | `settings/model`、`provider/` |
| 看生成结果 | 预览面板（10+ 格式） | `pages/conversation/Preview` |
| 定时自动化 | Cron 任务 | `pages/cron`、`/scheduled` |
| 远程用手机 | WebUI / 移动端 / IM 渠道 | `packages/web-*`、`mobile/`、`channels` |
| 自定义能力 | 助手 + 三层技能 + 扩展 | `assistants`、`skills`、`examples/` |
| 美化界面 | CSS 皮肤 + 语义主题 | `settings/appearance`、`theming` |
| 工具集成 | MCP 统一管理 + 内置 MCP | `settings/tools`、`builtinMcp` |
| 办公文档 | OfficeCLI + docx/xlsx/pptx 技能 | `common/chat/document` |

---

*本文档基于 AionUi 仓库 v2.1.47 源码、项目内 PRD（`docs/prds/`）、协作文档（`.aionui/`）、CHANGELOG 与 readme 综合整理，主要信息源为代码路径，实际功能以仓库最新代码为准。*
