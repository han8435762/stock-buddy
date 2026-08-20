# StockBuddy

[使用教程](https://x92l0onftm.feishu.cn/wiki/H9tNwppURiVPDakRsgVc0cKCnpc?from=from_copylink) · [生成研报合集](https://x92l0onftm.feishu.cn/wiki/ERlHwinyxinTY7k66jocOZw8n5d?from=from_copylink)

[![访问官网](https://img.shields.io/badge/访问官网-stock--buddy.top-1f6feb?style=for-the-badge)](https://www.stock-buddy.top/)

StockBuddy 是一个面向 A 股个股研究的本地优先 AI 投研工作台。

它把分散在公告、财报、调研记录和财务数据中的信息，整理成以公司为中心的本地资料库；再结合 AI 研究会话、可复用的研究 Skills 和可核验的引用，帮助你把一次性的查资料，变成可以持续积累的研究系统。

> 产品官网：[https://www.stock-buddy.top/](https://www.stock-buddy.top/)

## 核心功能

### 以公司为中心的研究资料库

- 添加并管理多家 A 股上市公司
- 为每家公司建立独立的本地研究空间
- 集中保存公告、定期报告、财报、调研资料和手动导入文件
- 按公司查看资料状态、转换进度、研究会话和研究产物

### 资料发现、更新与整理

- 根据公司名称、股票代码或行业关键词查找公司
- 获取并整理公司披露资料与财务数据快照
- 支持资料下载、格式转换、质量检查和索引
- 通过更新中心查看运行中的任务、异常和历史记录
- 支持手动更新与定时更新，持续维护公司的研究底座

### AI 公司研究

- 研究会话始终绑定当前公司，减少上下文混淆
- 可基于公司全部资料，或选择指定资料发起研究
- 支持围绕基本面、财务变化、公告和经营问题进行追问
- 研究过程、历史会话和最终产物保存在对应公司的本地目录
- 可以回到历史研究继续追问，而不必从零开始

### 引用核验与研究产物

- AI 回答要求关联来源文件、页码或数据字段
- 在研究上下文中查看本次使用的资料范围
- 快速定位引用原文，方便复核结论和关键数据
- 保存问答、研报和 Skills 输出，形成可编辑、可复用的研究产物

### 可复用的研究 Skills

内置研究 Skills 覆盖常见的公司研究任务，例如：

- 首次覆盖研究与深度研报
- 年报精读
- 财务变化分析
- 重要公告解读
- 生成向公司提问的问题清单

研究 Skills 可以按公司和资料范围执行，也可以创建副本进行编辑和扩展。

### 本地优先

- 公司资料、研究会话和研究产物默认保存在本地
- 研究上下文按公司隔离，避免不同公司的资料互相串联
- 模型、数据源和隐私相关设置由用户控制
- 适合希望长期跟踪少量公司、积累个人研究资产的投资者和研究者

## 项目结构

```text
 AionUi/
 ├── packages/
 │   ├── desktop/         # StockBuddy Electron 桌面端与主要业务界面
 │   ├── web-cli/         # 独立 WebUI 运行时 CLI
 │   ├── web-host/        # WebUI 服务端宿主与静态资源服务
 │   └── shared-scripts/  # 跨包复用的构建与开发脚本
 ├── mobile/              # 移动端相关代码与资源
 ├── examples/            # 扩展与第三方集成示例
 ├── docs/                # 开发指南、产品文档与使用说明
 ├── resources/           # 应用资源、演示素材与静态文件
 ├── scripts/             # 构建、打包、发布和辅助脚本
 ├── tests/               # E2E、集成测试、单元测试与测试夹具
 ├── public/              # 公共静态资源
 ├── patches/             # 依赖补丁
 ├── package.json         # 项目脚本、依赖与 Electron 配置
 └── readme.md            # AionUi 基础项目说明
```

StockBuddy 基于 [AionUi](https://github.com/iofficeai/aionui) 进行二次开发，复用了其桌面端基础设施、AI Agent 会话能力和技能系统，并围绕 A 股公司研究重新组织产品体验。

## 官网

访问 [stock-buddy.top](https://www.stock-buddy.top/) 了解产品定位、研究流程和最新信息。

## 开发

所有桌面端开发命令都在 `AionUi/` 目录下执行。

### 环境要求

- Node.js `>=22 <25`
- [Bun](https://bun.sh/)
- Git
- Rust stable + Cargo：当需要重新编译本地 AionCore 后端或当前平台缺少对应后端二进制时使用
- Windows 构建需要 Visual Studio C++ Build Tools；macOS 构建需要 Xcode Command Line Tools

当前仓库已包含 macOS arm64 与 x64 的 AionCore 后端资源。Windows/Linux 构建前，请确认 `AionUi/resources/bundled-aioncore/` 中存在对应平台和架构的后端文件。

### 安装依赖

```bash
cd AionUi
bun install
```

`postinstall` 会安装 Electron 原生依赖。首次安装或切换 Electron 版本后，如果原生模块加载失败，可以执行：

```bash
bunx electron-rebuild -f -w better-sqlite3
```

### 启动开发环境

```bash
cd AionUi
bun run dev
```

`bun run dev` 会启动 Electron + Vite 热更新开发环境，并执行开发环境下的 AionCore 资源准备。也可以使用以下命令：

```bash
bun run start          # 启动桌面端开发环境
bun run start:multi    # 允许同时启动多个实例
bun run webui          # 以浏览器 WebUI 模式运行
```

如果启动时提示找不到 `aioncore`，请先确认对应二进制可执行，并从同一个终端启动开发环境：

```bash
# macOS / Linux
which aioncore
aioncore --help

# Windows PowerShell
where.exe aioncore
aioncore --help
```

### 代码检查与测试

```bash
cd AionUi

bun run lint           # 检查代码
bun run format:check   # 检查格式
bun run test           # 运行单元测试
bun run test:integration
bun run test:e2e       # 运行 Playwright 端到端测试
```

开发过程中也可以使用：

```bash
bun run lint:fix       # 自动修复部分 lint 问题
bun run format         # 自动格式化代码
bun run test:watch     # 监听模式运行测试
```

### 生成桌面应用

先进入 `AionUi/` 并安装依赖。生成应用前建议先运行 `bun run lint` 和 `bun run test`。

#### 仅构建应用代码

只执行 Electron 主进程、预加载脚本和渲染层构建，不生成安装包：

```bash
bun run package
```

构建产物输出到 `AionUi/out/`。

#### 构建当前平台安装包

```bash
bun run dist
```

安装包和可分发产物输出到 `AionUi/out/`。构建脚本会根据当前平台执行 Electron Builder。

#### 指定目标平台

```bash
# macOS，默认构建 arm64 + x64
bun run build-mac

# macOS Apple Silicon
bun run build-mac:arm64

# macOS Intel
bun run build-mac:x64

# Windows，自动识别架构
bun run build-win

# Windows ARM64 / x64
bun run build-win:arm64
bun run build-win:x64

# Linux .deb
bun run build-deb
```

也可以直接使用按平台命名的命令：

```bash
bun run dist:mac
bun run dist:win
bun run dist:linux
```

构建结果的文件名格式为 `StockBuddy-版本号-平台-架构`。macOS 生成 `.dmg`，Windows 生成 NSIS `.exe` 安装程序，Linux 生成 `.deb` 安装包。

更完整的构建预检、原生模块重建和平台构建说明，请参考 [`AionUi/justfile`](AionUi/justfile)、[`AionUi/docs/contributing/development.md`](AionUi/docs/contributing/development.md) 和 [`AionUi/packages/desktop/electron-builder.yml`](AionUi/packages/desktop/electron-builder.yml)。

## 致谢

感谢 [iOfficeAI/AionUi](https://github.com/iofficeai/aionui) 开源项目提供的基础能力与工程实践。StockBuddy 在其基础上进行产品化和领域化改造，专注于 A 股个股研究场景。

## 免责声明

StockBuddy 仅提供资料整理、研究辅助和信息分析工具，不构成任何投资建议、买卖建议或收益承诺。投资有风险，请独立判断并自行承担投资决策责任。
