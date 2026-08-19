# 腾讯 WorkBuddy 功能调研

> 调研日期：2026 年 7 月 17 日
> 资料范围：腾讯云产品页、WorkBuddy 官方文档、近期更新记录

## 一、产品定位

WorkBuddy 是腾讯推出的全场景 AI 办公工作台。它不只是回答问题，还可以理解自然语言任务、自主拆解执行步骤、调用工具、操作获得授权的文件，并交付文档、表格、PPT、网页等可以直接验收的成果。

从产品形态来看，它更接近一个“桌面 AI 同事”，主要由以下几部分组成：

- 本地文件和电脑任务执行
- 云端长任务托管
- 专家、专家团和多 Agent 协作
- Skills 技能与第三方连接器
- 自动化和手机远程控制
- 团队项目、资料库和任务流转

官方资料：

- [腾讯云 WorkBuddy 产品页](https://cloud.tencent.com/product/workbuddy)
- [WorkBuddy 官方功能概览](https://www.workbuddy.cn/docs/workbuddy/Overview)

## 二、主要功能

| 功能模块 | 主要能力 |
| --- | --- |
| AI 任务执行 | 理解自然语言，自主拆解步骤、调用工具、执行并自检，支持多个任务并行 |
| 办公文档 | 生成和修改 Word、PPT、PDF、方案、周报、技术文档及会议纪要 |
| 数据分析 | 读取 Excel、CSV 等数据，进行清洗、统计、绘图和报告生成 |
| 本地文件操作 | 批量读取、分类、重命名、转换和整理文件，将成果直接保存到指定目录 |
| 深度研究 | 联网搜集信息、整理来源、分析数据并生成结构化研究报告 |
| 内容创作 | 生成小红书选题与文案、短视频脚本、口播稿、分镜和封面文案 |
| 设计创意 | 生成 UI、网站页面、Logo、海报、Banner 和 PPT，并通过画布继续修改 |
| 应用开发 | 用自然语言生成本地网页或小应用，运行、预览、排查报错并持续升级 |
| 自动化 | 定时生成日报、周报、资讯简报和数据汇总，并推送结果 |
| 远程控制 | 通过微信、企业微信、QQ、元宝、飞书、钉钉等平台向电脑端下达任务 |
| 专家与多 Agent | 调用招聘、投研、法务、营销、前端等领域专家，复杂任务可由专家团并行完成 |
| Skills 技能 | 安装、查找、启停和创建自定义技能，并兼容 OpenClaw 社区技能 |
| 连接器 | 操作 QQ 邮箱、腾讯文档、腾讯会议、腾讯乐享、TAPD、腾讯网盘及自定义 MCP 服务 |
| 团队项目 | 共享项目指令、资料、专家、技能和连接器，支持任务分享、转交和多人协作 |
| 记忆与模型 | 记住个人偏好，支持自动选择模型、多个内置模型和自定义第三方模型 |

## 三、核心任务执行方式

WorkBuddy 提供三种工作模式：

| 模式 | 行为 | 适用场景 |
| --- | --- | --- |
| 问一问（Ask） | 只进行问答和信息查看，不修改文件 | 了解资料、分析问题、确认需求 |
| 做一做（Craft） | 直接执行任务并修改文件 | 文档生成、表格处理、文件整理 |
| 想一想（Plan） | 先生成执行计划，用户确认后再操作 | 多步骤任务、重要文件、需要审核改动范围的任务 |

每个对话对应一个独立任务和工作空间。任务之间分别维护上下文，并可同时运行。

官方资料：[任务模式说明](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar)

## 四、办公文档与本地文件

### 1. 文档生成和修改

WorkBuddy 可以：

- 根据目标、读者和语气生成正式 Word 文档
- 根据材料、提纲或模板生成 PPT
- 在已有文档基础上继续增删内容、调整结构和改写语气
- 生成通知、制度、方案、申请、汇报材料和会议纪要
- 在右侧结果区预览产物、查看全部文件和修改记录

官方资料：[文档生成与编辑案例](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Practice-Two)

### 2. 批量文件处理

在用户授权的目录中，WorkBuddy 可以：

- 根据文件内容或属性批量重命名
- 按主题、日期或类型进行分类和归档
- 转换文件格式
- 从 PDF、Word、Excel、PPT、图片和文本文件中提取信息
- 整理会议记录、字幕和外文资料

对于批量重命名、删除或写入等操作，可以先要求它输出预览和对照表，确认后再真正执行。

官方资料：[文件内容识别与处理案例](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Practice-One)

## 五、数据分析与研究

WorkBuddy 可以直接读取 Excel、CSV 等文件，并完成：

- 数据清洗和汇总
- 按时间、产品、地区等维度统计
- 生成柱状图、折线图等可视化图表
- 提炼核心结论和趋势
- 输出面向管理层的完整分析报告

如果数据尚未整理成文件，它也可以联网搜集公开资料，将搜索、筛选、分析、绘图和报告排版串成完整流程。

官方资料：[数据分析与可视化案例](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Practice-Three)

## 六、内容创作与设计

### 1. 自媒体内容

WorkBuddy 支持生成：

- 小红书选题、标题、正文、标签和封面文案
- 短视频脚本、开头钩子、口播稿、分镜和行动引导
- 针对不同平台、受众和账号定位调整内容风格

官方资料：[自媒体运营案例](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Practice-Four)

### 2. WorkBuddy × Ardot 设计创意

WorkBuddy 的设计创意模式集成了腾讯 Ardot 画布，可以通过自然语言生成：

- 移动端 App 界面
- 网站和 Landing Page
- 品牌 Logo
- 海报和 Banner
- PPT 演示文稿

生成后，可以继续用对话修改，也可以跳转到 Ardot 进行像素级编辑、图层管理、组件化调整和多格式导出。设计稿完成后，还能生成可运行的应用代码。

官方资料：[设计创意功能说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Design-Idea)

## 七、应用开发

WorkBuddy 支持用自然语言完成本地应用开发：

1. 描述应用目标和功能。
2. 自动设计应用结构并生成完整代码。
3. 尝试运行应用并提供预览。
4. 根据报错或反馈定位问题。
5. 持续修改功能和界面。

适合无代码基础的用户制作个人工具，也适合快速验证产品原型。

官方资料：[零代码制作本地应用](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Practice-Seven)

## 八、专家、专家团与 Skills

### 1. 专家

专家是带有特定人设、方法论和工具链的 AI 角色，可从专业视角完成招聘、投研、法务、营销、前端等领域任务。

### 2. 专家团

专家团是由多位专家组成的多 Agent 团队：

- 团长自动拆解任务
- 将子任务分配给适合的专家
- 多个专家并行执行
- 最后统一汇总和交付

### 3. Skills

Skill 是让 WorkBuddy 具备某项具体能力的技能包。用户可以：

- 安装推荐技能
- 导入本地技能包
- 根据任务描述自动查找技能
- 用自然语言创建自定义技能
- 随时启用、关闭或卸载技能
- 导入兼容的 OpenClaw 社区技能

三者的区别可以概括为：

| 类型 | 定位 |
| --- | --- |
| Skill | 让 AI 能做某件事的工具能力 |
| 专家 | 带有专业经验和方法论的 AI 角色 |
| 专家团 | 多位专家组成的协作团队 |

官方资料：

- [专家功能说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Expert-Center)
- [Skills 功能说明](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)

## 九、连接器与腾讯办公生态

连接器让 WorkBuddy 可以访问和操作外部系统。当前官方文档列出的主要连接器包括：

- QQ 邮箱
- 腾讯文档
- 腾讯会议
- 腾讯乐享
- TAPD
- 腾讯网盘
- 自定义 MCP 连接器

典型能力包括：

- 搜索、读取、汇总、发送和整理 QQ 邮件
- 搜索、创建和管理知识库内容
- 查询和编辑腾讯文档
- 预约、修改、取消和查询腾讯会议
- 获取会议录制、转写和智能纪要
- 调用第三方 API、数据库、网盘和消息服务

官方资料：

- [连接器功能说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector)
- [腾讯会议管理案例](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Practice-Ten)

## 十、自动化与远程控制

### 1. 自动化

自动化功能适合周期性、重复性任务，例如：

- 每日资讯简报
- 周报汇总
- 定时数据整理
- 工作日财经新闻推送
- 天气、待办和行业信息汇总

自动化任务可以配置名称、工作空间、提示词、模型、技能、执行频率和有效日期。完成后可将结果推送到 WorkBuddy 小程序。

官方资料：

- [自动化功能说明](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)
- [每日资讯简报案例](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Practice-Five)

### 2. 手机远程控制

用户可以通过以下即时通讯平台，在手机上给电脑端 WorkBuddy 下达任务：

- 微信助理
- 企业微信
- QQ 机器人
- 元宝机器人
- 飞书
- 钉钉
- Slack
- Telegram
- Discord

任务完成后，结果可以返回到手机聊天窗口。

需要注意：这种本地远程控制方式通常要求电脑保持开机、联网，并运行 WorkBuddy 客户端。

官方资料：[助理远程控制](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Assistant)

## 十一、团队项目与资料库

WorkBuddy 的项目功能用于团队协作。项目可以统一配置：

- 项目名称和全局指令
- 外部连接器
- 领域专家
- Skills 技能
- 项目资料库

项目成员创建任务时，这些配置会自动加入任务上下文。团队还可以：

- 分享任务链接
- 多人参与同一任务
- 将任务连同上下文、进度和产物转交给其他成员
- 将任务成果保存到项目资料库
- 通过 RAG 让 AI 使用项目资料
- 查看资料更新人和更新时间

项目资料库支持文档、表格、PPT、PDF、图片、音视频、Markdown 和网站链接等内容。

官方资料：[项目功能说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project)

## 十二、记忆与模型

### 1. 个人记忆

WorkBuddy 可以从对话中提取用户偏好和习惯，并在未来任务中使用。用户可以查看、编辑、导入或要求它忘记特定记忆。

官方资料：[记忆功能说明](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Memory)

### 2. 模型配置

WorkBuddy 支持：

- Auto 自动选择模型
- 腾讯混元系列
- GLM 系列
- MiniMax 系列
- Kimi 系列
- DeepSeek 系列
- 自定义第三方模型

用户可根据数据分析、视觉理解、复杂推理、中文写作等任务选择不同模型。自定义模型的 API Key 按官方说明保存在本地配置中。

模型名单会随版本持续调整，应以客户端和最新官方文档为准。

官方资料：[模型配置说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)

## 十三、安全、隐私与使用边界

### 1. 权限模式

WorkBuddy 提供默认权限和完全访问权限两种模式。

默认权限下，以下操作通常需要用户再次确认：

- 写入受保护或敏感路径
- 删除重要文件、目录或批量删除
- 执行脚本、命令或外部程序
- 访问网络或调用其他高风险能力

完全访问权限可以减少确认步骤，但风险更高，只适合可恢复、可隔离且用户充分信任的任务。

官方资料：[权限模式说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes)

### 2. 数据边界

根据官方文档：

- 本地文件默认在本机处理
- WorkBuddy 只能访问用户主动授权的目录
- 服务端可能处理完成任务所需的数据片段
- 项目配置和项目资料库属于云端团队数据
- Ardot 设计稿存储在云端
- 第三方连接器会按照相应授权访问外部服务

因此，处理合同、财务、密钥、个人隐私等敏感资料时，仍应使用独立工作目录、文件副本和最小权限，并对最终成果进行人工检查。

### 3. 可靠性和成本

- 复杂任务可能发生报错、重试或卡顿，需要人工验收。
- 专家团、多模型和长流程任务通常消耗更多积分。
- 本地长任务需要设备保持在线；云端托管任务可以在客户端关闭后继续运行。
- 批量改名、删除或覆盖重要文件前应先备份并查看预览。

## 十四、版本与定价

WorkBuddy 当前提供免费体验版、多个个人订阅档位，以及 SaaS 企业版和专有云企业版。不同版本主要在以下方面存在差异：

- 每月积分
- 可选择的模型
- 自动化任务数量
- 可创建项目数量
- 单个项目成员上限
- 个人助理数量
- 企业坐席和部署方式

价格和限时赠送政策变化较快，应以官方定价页为准。

官方资料：[WorkBuddy 官方定价](https://www.workbuddy.cn/docs/workbuddy/Pricing)

## 十五、综合判断

WorkBuddy 最有辨识度的能力不是单独生成一段文字，而是把多个办公步骤串成完整工作流，例如：

> 搜集行业资料 → 读取本地 Excel → 分析并生成图表 → 制作汇报 PPT → 发送邮件或安排会议

它目前的主要优势包括：

1. 可以操作本地文件并交付真实成果。
2. 深度连接微信、QQ、腾讯文档和腾讯会议等腾讯生态。
3. 同时提供专家、专家团、Skills 和 MCP 连接器。
4. 支持手机远程下达任务和定时自动执行。
5. 兼顾个人任务与团队项目协作。
6. 将办公、设计和简单应用开发放在同一工作台内。

主要限制包括：

1. 产品仍处在快速迭代阶段，复杂任务稳定性需要持续观察。
2. 权限、Skills、连接器和模型较多，首次配置存在一定学习成本。
3. 高强度使用依赖积分和付费套餐。
4. 专业、投资、法律等高风险结果不能替代人工判断。
5. 涉及本地文件、连接器和云端项目时，需要认真管理权限与敏感数据。

整体来看，WorkBuddy 可以理解为“腾讯生态版的桌面 AI 同事”：将本地执行型 Agent、OpenClaw 技能生态、专业专家团、远程控制和腾讯办公连接器整合到一个工作台中。
