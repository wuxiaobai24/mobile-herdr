# Herdr Web UI 深度对标：以手机完成任务为准

2026-10-24。对标对象是原 `devswha/herdr-web-ui`，现名 [Ovis](https://github.com/devswha/ovis)，不是 Herdr 官方 TUI，也不是其他同名 Web 项目。源码固定在 `da04bda178e96f52638b83b87c09b29d6d6527c8`，package 版本 0.4.13；本项目为包含未提交改动的 0.2.2-beta.9 工作树。

**结论：我们已经接上了主要能力，但多会话操作、异步协作和成果检查还没有组成足够顺手的手机工作流。下一轮先做 tab / pane 导航、真正的待处理列表和下一轮消息队列；随后补目录选择、文件直达和仓库 diff。保留现有紧凑输入框、原生输入权与 Android 路线。**

## 证据和边界

- **画面实测**：操作 Ovis 的[公开演示](https://herdrweb.dev/demo/app/)，以及我们自己创建的 Unix socket / native provider fixture。检查 390×844、320×568、390×450、844×390、1280×900。演示站的部署提交没有独立确认，不能把它和固定源码当成同一个构建。
- **源码核验**：固定提交的源文件与文档，重点核对菜单、队列、终端输入、虚拟列表、文件、通知和手机壳。源码清单在 `artifacts/herdr-web-ui-benchmark/reference/`。对方的 demo 使用模拟数据，不能据此认定真实 Herdr、push、语音和远程连接都经过本轮验收。
- **本项目证据**：截图、DOM 几何数据、操作观察在 `artifacts/herdr-web-ui-benchmark/`。原生 APK 的 42 项、Web 的 227 项是前一轮已有验收，本轮没有重新构建或验收 APK。浏览器缩短视口不是实体手机的软键盘、中文 IME 或后台测试。
- 本轮只增加调研报告与隔离的取证脚本，没有改产品交互，没有重启 bridge、Herdr 或用户 agent。没有进行独立性能压测，也不给产品打综合分或编造“对齐率”。

## 1. 首先改变对标单位

一个动作有接口、有按钮、有完整手机流程，是三个不同状态。应该按下面这条实际任务链验收：

打开手机找到待处理 agent → 核对目标并回答 → 留下下一步任务 → 查看文件和改动 → 返回刚才的阅读位置 → 锁屏后收到下一次提醒。

Ovis 的优势是把这些环节连接起来。我们已具备附件、图片、工具详情、原生审批、创建工作区和标签页、分屏、历史分页，但若从“建一个 tab”到“启动新任务”仍要在手机敲 CLI，就还没有完成相同的用户任务。

## 2. 本轮直接发现的差距

### 2.1 有 tab 数据和创建能力，缺少 tab 导航

Ovis 将工作区留在抽屉，将当前工作区的 tabs 放在内容上方；所选 tab 的菜单承载手机上的 pane 选择和 tab 操作。[TabStrip 源码](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/TabStrip.tsx)

我们把同一工作区下不同 tab 的所有 panes 平铺在抽屉，tab 名只是副标题。手机切到另一个 tab 的 pane 至少要“开抽屉 → 选 pane”，而对方的可见 tab 一次点击即可。创建一个空 shell tab，我们目前需要“开抽屉 → 工作区加号 → 提交表单”；对方可从 tab 条的加号直接创建。这里统计的是已有连接状态下的入口动作，不包含输入名称或选择目录。

**额外实测**：fixture 明明有名为 `release` 的 tab，搜索 `release` 却显示“没有找到匹配的会话”。原因是 `App.tsx` 的搜索字段没有 tab label。顶部工作区行重新选择的也是 Herdr 的 active tab / 首个 pane，而不是每个工作区在手机上最后打开的 pane。现在只持久化每台机器的一处 session / pane 位置。

建议：有多个 tab 时提供横向 tab 条；单 tab 时维持紧凑。一个 tab 内多个 panes 用带状态的大尺寸选择器，手机主区域默认一次看一个 pane。每个 machine / session / workspace / tab 分别记住手机选择、Chat / Terminal 模式和阅读锚点。选中和浏览继续不移动电脑焦点。

### 2.2 “需要你”还只是工作区筛选

我们当前只计数所选机器、所选 Herdr session 的 blocked panes。筛选时保留“包含 blocked pane 的整个工作区”，渲染时又列出其中全部 panes。隔离 fixture 中，一个 blocked pane 旁边的 idle pane 仍出现在“需要你”结果里，已截图记录。

Ovis 同时提供全局状态入口、站内提示和后台 push；通知落点包含目标身份。[通知策略入口](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/lib/notifications.ts)、[服务端 push](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/server/push.ts)。本轮只核验源码和 demo 的 Alerts 入口，没有实发对方的 push。

建议先把“需要你”做成真正的 pane 收件箱：审批 / 问题 / 失败在前，未读完成随后；每项展示机器、工作区、tab 和简短原因。点击后先重新验证请求是否仍存在，再打开准确目标。完成后的“已读”是独立状态，不应通过抢电脑焦点来实现。Web push 和 Android 后台通知分平台接入，不能把 PWA 的 service worker 直接当成 APK 通知方案。

### 2.3 立即补充当前任务，与下一轮再做，需要明确区分

我们在 native agent 工作时使用 steer；legacy 工作时保留草稿、拒绝普通发送。这些行为本身合理，但没有独立的下一轮任务队列。例如“做完以后再查 Android，不要打断当前修改”现在仍只能立即补充，或留在一个草稿里。

Ovis 的 pending 行区分下一轮、待显式发送和结果不明，并支持 Send now / Discard；自动投递与手动发送共享消息 ID。[PendingMessages](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/PendingMessages.tsx)、[队列存储](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/lib/messageQueue.ts)、[Codex 队列](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/server/codex-queue.ts)。这是源码确认，不是本轮真实 provider 运行验证。

建议：工作时提供可发现的“补充本轮 / 排到下一轮”选择，不能只藏在长按手势里。每条排队消息绑定原 runtime、conversation、输入权 epoch 和请求 ID。只允许当前连接、当前输入权下明确接受的队列自动进入下一轮；断线后取消自动投递资格，结果不明的项目留待核对，重连不能重新执行写入。

### 2.4 “查看改动”不是仓库状态

我们的 `ChangesPanel` 来自 `conversationChanges(messages)`，汇总已经加载的对话中明确上报的补丁。它不能反映其他终端修改、暂存内容、未跟踪文件，早期没有加载到的补丁也不会自动出现在这里。

Ovis 的仓库查看器有 Working tree / Staged / Commits，手机 diff 使用单列。[RepoChanges](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/RepoChanges.tsx)、[RepoDiffViewer](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/RepoDiffViewer.tsx)

建议保留“本对话补丁”，并新增只读的真实仓库改动视图。先能看到 working tree、staged、untracked 和每个文件的准确状态，再考虑提交等写操作。不要因为已有 diff 渲染器就标记完整 Git 工作流已对齐。

## 3. 能力矩阵

“已有”仅说明当前本机版本有相应入口，不代表覆盖所有 provider。Ovis 一栏来自演示走查与固定源码；未走真实后端的部分不可当作运行验收。

| 维度 | Ovis | Mobile Herdr 当前状态 | 移动端取舍 |
| --- | --- | --- | --- |
| Chat / Terminal 同 pane 切换 | 直接切换，并有命令临时终端视图 | 已有；native 切换同时交接输入权 | 保留明确输入权，减少额外导航 |
| 工作区 / tab / pane 层级 | tab 条、所选 tab 菜单、pane 视图 | 部分；抽屉平铺 panes | 优先补 tab 与 pane 的直接导航 |
| 创建 / 重命名 / 分屏 | 对应菜单；窄屏对布局动作做取舍 | 已有创建、重命名、分屏；没有关闭 / 移动 / 重排 | 先补好导航，关闭必须准确展示影响对象 |
| 置顶 / 最近 / 单工作区记忆 | 有置顶及导航缓存逻辑 | 缺少置顶、最近和逐 tab 的落点记忆 | 先给点选入口，不把拖拽设成唯一入口 |
| 待处理和未读完成 | 状态入口、站内提醒、Web push；原生 push 另有模块与部署前提 | 部分；当前 scope 的 blocked 计数与工作区过滤 | pane 收件箱优先，后台推送分平台；不能把对方原生模块存在当作已上线 |
| 目录选择和新任务启动 | 目录浏览、agent / worktree 流程 | 部分；新布局创建 shell，目录需手输 | 最近项目 + 目录选择 + 显式 agent 启动 |
| Worktree 生命周期 | 创建 / 打开等专用流程 | 缺少 | 对多任务有价值，排在核心导航之后 |
| 工作中继续发消息 | 下一轮排队 + Send now | 部分；native steer，legacy 保留草稿 | 补独立队列，不能改成断线自动重发 |
| Slash / skills | 动态目录，部分命令临时打开终端 | 原生动作与技能已有；CLI 专用命令需手动去终端 | 做完整的命令往返，不承诺全量 CLI API 化 |
| 审批 / 结构化问题 | 支持若干 provider，菜单实时校验 | native Codex / Pi 已有；其他使用终端 | 保留过期校验，明确 provider 边界 |
| 工具调用阅读 | 每轮工作摘要、耗时、变更入口 | 已有分组、状态、输入 / 输出详情 | 补每轮摘要和“跳到文件”，不新增满屏日志 |
| 任务计划 / 后台任务 | 结构化计划和任务数量 | 有 plan 模式；没有统一计划 / 后台任务面板 | plan 模式不等于任务进度；按真实事件展示 |
| 更早记录 | 历史读取与列表管理 | 已有顶部自动分页和重试 | 保留锚点；继续补大记录量验收 |
| 长记录渲染 | ChatTimeline 使用虚拟列表 | 普通 ScrollView 渲染全部已加载消息 | 需要虚拟化，不能以分页代替渲染预算 |
| 阅读位置 | 消息锚点，页生命周期内记忆 | 页面内保存像素位置与已加载页，最多 16 组 | 双方都不能据此声称跨进程完整恢复 |
| 对话查找 | 未独立确认全历史搜索范围 | 已有；明确只搜索已加载消息 | 保留范围说明；不能声称对方全量搜索已验证 |
| 回复 / 代码复制 | Markdown、纯文本、代码块复制 | 回复复制已有，缺代码块专用复制 | 小屏代码复制比更多展示格式优先 |
| 图片 / 文件附件 | 路径附件与图片，声明上限更高 | 已有；6 个，每个 8 MB | 上限不直接代表体验优劣，先保证恢复与进度 |
| 图片全屏查看 | 源码有缩放、复制和下载等功能 | 已有全屏；缺图内缩放和独立图片操作 | 原生与 Web 分别接手势和保存能力 |
| 文件路径直达 / @ 文件 | 路径组件、文件提及 | 缺少聊天内的路径直达和 @ 发现 | 从回复点文件，返回仍在原阅读位置 |
| 项目文件浏览 | 多媒体查看器和大文本处理 | 文本 / 图片预览、下载已有，文本前 256 KB | 先增强常用代码与 Markdown，不急于做 IDE |
| 实际仓库 diff | working / staged / commits | 缺少；现有的是对话补丁 | 只读仓库状态是手机检查成果的关键 |
| 终端触摸历史 | 滚动 Herdr 共享视口 | 已有本地 / 只读历史，保持电脑视口 | 这是产品差异，不能照搬共享滚动 |
| 终端输入 | 直输 / 输入行、可编辑键条、修饰键 | 直输、粘贴预览、方向面板、一次性 Ctrl / Alt | 补输入行和按需键条配置；实测中文 IME |
| 密码 / PIN 特殊输入 | 有清空、非持久化的专用入口 | 没有专用组件；需原终端 | 若补输入行，必须单独处理秘密输入 |
| 防息屏 / 语音 / 用量 | 都有相应可选功能 | 缺少 | 防息屏可先做；语音和用量不挤占核心导航 |
| 设备权限与撤销 | 源码包含设备配对及权限管理 | 共用入口 token，没有逐设备撤销 | 属于多设备产品化事项，不能拿输入权替代认证 |
| 原生交付 | Web / PWA，源码另有 Capacitor Android / iOS 壳 | Web / PWA + 共享 RN 的签名 Android APK | 这是实现路线差异，不能把“有 APK”当独占优势；实体设备和后台能力仍需分别验收 |

矩阵的固定源码索引见文末；当前代码落点分别是 `app/App.tsx`、`Composer.tsx`、`Conversation.tsx`、`ChangesPanel.tsx`、`LayoutManager.tsx`、`MessageImage.tsx`、`app/terminal.ts` 和 `server/native/`。

## 4. 手机尺寸的实际取舍

本次测量记录的是默认主题、空草稿下的 CSS 像素。两边内容和字体没有统一，因此不能把这些数字解释为阅读速度、性能或综合体验排名。阅读净高按对话容器与输入框上边界的交集计算，扣除输入框遮盖区域。

| 视口 | Ovis 对话净高 | 我们的对话净高 | 观察 |
| --- | ---: | ---: | --- |
| 390×844 | 625 px | 671 px | 对方有 tab 条，我们有原生输入权条 |
| 320×568 | 349 px | 395 px | 检查长标题、输入和触摸目标 |
| 390×450 | 231 px | 277 px | 短视口，不等于真实键盘测试 |
| 844×390 | 173 px | 217 px | 对方展开 320px 侧栏；我们仍走紧凑手机布局 |

我们默认空输入框的内框为 54px，对方 demo 的 composer 外框为 122px，组件边界不同，不能简单当作同口径节省一半。上表以字体加载和视口布局稳定后的最后一轮取证为准；不等待字体时，demo 的输入区域曾短暂为 108px，因此早期截图不用于尺寸结论。实际可确认的是：我们的单行输入、更多操作按需展开，以及横屏不立即常驻侧栏，都值得保留。不要为了复制对方 tab 条，再常驻模型行、状态行和计划行，把 450px 高度吃完。

对方 demo 中 Chat / Terminal 按钮的 DOM 边界为 44×28，发送为 32×32；我们采样主界面的带 role 控件均不小于 44×44。DOM 边界不包含所有可能的扩展命中区域，本轮也没有做实体手指测试，不据此下 WCAG 合规结论。我们的抽屉说明图标和附件操作等次级控件仍应单独检查。

## 5. 建议实施顺序与验收条件

| 批次 | 范围 | 能交付的用户结果 | 验收重点 |
| --- | --- | --- | --- |
| 第一批 P0 | tab / pane 直接导航、tab 名搜索、手机落点记忆 | 同工作区换任务不必反复开长抽屉 | 10 tabs / 20 panes；320px；长名称；退出再回来；电脑焦点不变 |
| 第一批 P0 | pane 级“需要你”、未读完成 | 只看到真正需要处理的目标 | 混有 idle 的工作区不夹带结果；请求过期；pane 已关闭；多 machine / session 身份准确 |
| 第二批 P0 | 下一轮队列与立即补充分路 | 手机能安排下一件事，不改变当前任务语义 | 发送 / 自动投递竞争只执行一次；切换 pane；断线、重启和 ambiguous ACK 不重放 |
| 第二批 P1 | 目录选择、最近项目、显式新任务启动 | 创建任务不必在手机输入完整目录和 CLI | 新建独立会话，不恢复第二份已运行 agent；失败保留表单；精确目录和目标 |
| 第三批 P1 | 文件直达 / @、只读仓库 diff、代码复制 | 从回复完成核对成果，再回原对话 | 行号路径、空格和中文文件名；工作区外路径策略；未暂存 / 已暂存 / 未跟踪；返回锚点 |
| 第三批 P1 | CLI 专用命令的临时终端往返 | 点命令、操作原终端面板、回到聊天 | 仅对实际支持的命令路由；不把 slash 当提示词；不启动第二个 agent；旧菜单不得继续发送 |
| 持续 P1 | 虚拟化、图片尺寸稳定、IME / 后台恢复 | 长对话和键盘场景仍能读、能写 | 至少 1000 条混合消息；焦点与选择不丢；图片迟加载不跳锚点；真实 Android / iOS 单独记录 |
| 后续 P1/P2 | Web push / Android 通知、设备撤销、防息屏 | 离开前台仍能接回准确任务 | 分平台；拒绝权限后可用；通知点击先刷新目标；撤销设备后写入无效 |
| 后续 P2 | Worktree 向导、语音、用量、更多 provider | 降低扩展工作流成本 | 沿用真实能力目录；未知值不猜；语音只写草稿；不先做桌面 IDE 功能 |

新流程继续跑项目要求的 typecheck、相关测试、重建后的 UI 回归；涉及共享交互则重新构建签名 release APK，并在专用模拟器验收。物理设备的结果单独列出。当前报告本身不代表这些待办已经实现。

## 6. 需要保留，以及不应直接照搬的部分

1. **保留同一原生 provider 的输入权与准确会话身份。** UI 变短不能以绕开 epoch / runtime / conversation fence 为代价。恢复或重启仍是明确用户动作。
2. **保留本地历史浏览不移动电脑视口。** Ovis 文档明确共享终端滚动会影响其他客户端；我们的阅读行为是不同的产品选择。
3. **保留紧凑输入和单 pane 主视图。** 不把桌面多栏、悬停菜单、鼠标拖边框压缩成手机界面。
4. **保留能力诚实。** plan 模式不等于计划进度，附件列表不等于文件工作台，聊天补丁不等于仓库 diff，PWA 不等于原生后台推送，全量 slash 目录不等于全量可执行。
5. **不要先复制桌面命令面板、完整 IDE、语音和套餐仪表。** 我们最需要缩短的是“找到任务 → 回答 → 安排下一步 → 检查结果”的手机路径。

## 7. 独立评审与本轮交付

按 Oil UI 的“存量已有界面润色评审”完成一轮独立静态评审，不打分。评审者只读取现状规范和截图，没有读取实现或本报告结论。结果与主 agent 的源码核验相互独立：

- 列表已显示 `release`，搜索却没有结果，用户可见名称与查找范围不一致；源码另行确认缺少 tab label。
- 390×844 抽屉中，第一条具体会话到约 396px 才出现。应把机器 / session 身份压缩成清楚的一行，减少进入目标之前的固定内容；建议目标是在同一夹具下让首条 pane 在 280px 内开始出现。
- 工作区菜单混合工作区、标签页、终端三个对象。建议就近分组并显示各组实际目标，不仅依赖一串副标题。
- 工作中草稿同时出现停止图标和发送箭头，却没有就近说明箭头是补充还是排队。应给真实语义短标签。
- 矮横屏的输入权条中间有较大留白。可以在横屏重排，保留明确输入权与不小于 44px 的交接按钮，不能只靠缩小控件来减高。

应保留单 pane 主区域、可辨识发送目标、明确输入权、紧凑输入框和抽屉的勾选状态。截图不能证明动态焦点、菜单滚动到底、实际命中区、IME、后台或动效都正确；本轮不对这些事项给出独立验收结论。

取证脚本最后连续三次完成，两边各五类视口均无整页横向溢出，隔离 Mobile Herdr 页面无未捕获异常。它验证调研证据能够重复取得，不替代产品完整回归。静态报告另验筛选、窄屏排版和截图资源。最终证据、原始观察、脚本与日志位于 `artifacts/herdr-web-ui-benchmark/`。

## 固定源码索引

- 导航：[TabStrip.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/TabStrip.tsx)、[Sidebar.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/Sidebar.tsx)。
- 输入：[Composer.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/Composer.tsx)、[终端输入说明](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/docs/terminal-input.md)、[KeyBarSettings.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/KeyBarSettings.tsx)、[SecretInput.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/SecretInput.tsx)。
- 队列：[PendingMessages.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/PendingMessages.tsx)、[useComposerSends.ts](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/lib/useComposerSends.ts)。
- 阅读：[ChatTimeline.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/ChatTimeline.tsx)、[chatScrollMemory.ts](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/lib/chatScrollMemory.ts)。
- 成果：[FilePathLink.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/FilePathLink.tsx)、[FileViewer.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/FileViewer.tsx)、[RepoChanges.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/RepoChanges.tsx)。公开 demo 的文件链接确实打开查看界面，但本次显示空目录，没有验证文件字节或所有预览格式。
- 新任务：[DirectoryBrowser.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/DirectoryBrowser.tsx)、[WorktreeDialog.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/WorktreeDialog.tsx)。
- 可选能力：[VoiceInput.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/VoiceInput.tsx)、[UsageMeters.tsx](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/src/components/UsageMeters.tsx)、[用户指南](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/docs/guide.md)。
- 手机壳：[原生 App 计划与当前阶段](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/docs/native-app.md)、[Capacitor package](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/app/package.json)、[Android push 模块](https://github.com/devswha/ovis/blob/da04bda178e96f52638b83b87c09b29d6d6527c8/app/android/ovis-push/README.md)。文档有阶段性差异：计划页写 relay 尚未部署，而 Android 模块已有实现和配置说明，因此本报告只确认代码存在，没有认定商店分发或原生后台通知已完整上线。
