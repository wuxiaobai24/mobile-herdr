# 验证记录

日期：2026-10-21。交付范围是移动 Web，不包含原生 App 发布。

## 通过的检查

- `bun run build`：通过，生成 Web 与 xterm 终端页面。
- `bun run typecheck`：通过。
- `MOBILE_HERDR_LIVE=1 bun test tests`：**12 / 12**，40 次断言。覆盖 transcript、鉴权、origin、会话范围、去重、工作 / blocked 状态、文件路径逃逸、显式绑定及进程替换、WebSocket 和真实 Herdr PTY。
- 最终界面版本的 `bun run test:ui` **连续三次通过**：每次 **22 项检查、0 个未捕获或应用控制台错误**。脚本使用 Python 3.12 + Playwright 1.60 + 本机 Chromium。
- 手机视口：320×568、360×740、390×844、430×932、844×390 横屏、768×1024；发送按钮在屏幕内，无整页横向溢出。
- 390×450 的 visualViewport 模拟：输入区在可见范围内，底栏和辅助说明收起，最近的回复与草稿可以同时阅读。
- 浏览器流程：连接、精确 transcript、按 pane 保存草稿、刷新恢复、会话切换、blocked 状态、发送失败保留草稿、成功后从原 transcript 读回、离线禁止发送、恢复连接后保留编辑内容、终端触摸快捷键。
- 局域网 `http://192.168.6.117:7331/` 与 Tailnet `http://100.83.77.94:7331/` 均从本机返回 HTTP 200。此结果证明服务监听正常，不代表已经从用户手机验证网络可达性。

## 真实链路与 fixture 的区别

后端 live test 自动新建独立 Herdr session，创建自己的 shell pane，经 WebSocket → Bun PTY → `herdr terminal attach` 发送 `printf`，从同一 pane 的 API 读回标记；关闭 WebSocket 后检查 terminal ID 与 pane ID 不变，然后停止并清理测试 session。没有向用户已有的 agent 发送测试任务。

浏览器流程使用隔离 Unix socket fixture，包含 Pi 格式 transcript 和 working / blocked agent 状态。这验证界面与协议流程，不是一次真实 LLM 完成任务的性能测试。现有默认 session 的 topology 和 Codex transcript 候选发现另做了只读检查。

## 画面与评审

证据不含用户凭证或私人对话；聊天截图使用测试 fixture。

- `artifacts/ui/phone-chat.png`：390px 手机聊天。
- `artifacts/ui/phone-sessions.png`：手机会话抽屉。
- `artifacts/ui/phone-keyboard-viewport.png`：450px 可见高度。
- `artifacts/ui/phone-blocked.png`、`phone-offline.png`：异常状态。
- `artifacts/ui/desktop-chat.png`：1280px 桌面。
- `artifacts/ui/verification.json`：22 项检查清单。
- `artifacts/motion-final/record.mp4` 与 `motion-start/mid/end.jpg`：连接及抽屉的操作证据，200% 像素密度；截图工具报告无控制台错误、横向溢出或图像失败。

做了一轮独立视觉评审，初版 **8/10**。据此补全手机发送目标（机器、session、pane）、压缩键盘状态固定区域、提高会话标题对比度，并取消连接窗口与对话互相透显的退场。独立复核确认这四项改动可观察生效，未见新的视觉阻断；不重新打分。深色工具界面与聊天 / 终端双入口保留；手机删除桌面快捷键提示，键盘时隐藏重复说明。

三处反馈：主按钮按压反馈、会话抽屉滑动、对话内容轻淡入。连接表单采用即时关闭，避免正文叠影。工具界面不需要滚动叙事。路径、版本、session 标识等 12px 次级元信息保留；正文 15–16px。开启 reduced-motion 时关闭 Web CSS 动效。

## 剩余边界

- **未做真实 iPhone / Android 软键盘、IME、系统返回键和后台冻结实机测试**。模拟视口通过不能替代这些测试。
- 只接受 Herdr protocol 22；其他版本明确拒绝。没有为验证任务更新或重启用户已有 Herdr。
- 初次聊天最多读取末尾 8 MiB JSONL，返回最近 500 条以内，并将消息数据限制在约 256 KiB；不是完整历史分页。身份缺失时需显式关联，不猜同目录中的“最新会话”。手动关联在 bridge 重启后需重新选择。
- Native transcript 格式未来可能变化。缺少记录的 agent 使用原终端；不解析终端像素来伪造聊天。
- 普通 Herdr topology 约 1.5 秒更新；原生会话约 300ms 合并推送。只发送变化部分，尚未实现逐条消息 patch。
- Bridge 的重复请求缓存保留 5 分钟，不承诺无限期 exactly-once。网络结果不确定时草稿保留并提示先检查原会话，不自动重放。
- 浏览器持久化使用 localStorage，不提供每设备独立撤销。已增加原生标准审批、问题和 Codex diff 展示；完整文件 / diff 工作台、原生手机安装包、附件、push、relay 和 SSH bootstrap 未交付。
- Web 主包约 539 kB、gzip 168 kB，终端独立加载；Vite 提示超过 500 kB 的建议性分块警告，当前没有构建失败。

## 原生交接验证（2026-10-22）

- `MOBILE_HERDR_LIVE=1 MOBILE_HERDR_NATIVE_LIVE=1 bun test tests`：16 个测试通过，69 次断言。
- 本机 Codex 0.162.1：官方 TUI 通过私有 Unix WebSocket 连接 broker；手机提交真实 app-server turn，再回到同一个 TUI 提交第二条消息，thread ID 不变。
- 本机 Pi 1.2.0：桥接扩展与原 Pi 进程通信；真实扩展 confirm / select 请求转发手机，回答后同一 session 继续执行。
- 上述 provider 测试使用临时配置和本地模拟模型，验证协议与进程行为，不能推导真实模型的开发效果或网络性能。
- `bun run test:handoff-live`：独立真实 Herdr 0.9.3 中启动 `mherdr codex`，手机提交、Ctrl+] 接回、Herdr `agent.prompt` 再提交；运行实例、对话和 terminal ID 相同，8 项结果均为 true。测试创建的进程和会话随后清理。
- 浏览器验证包含 22 项兼容模式检查和 20 项原生交接检查；连续三轮分别为 42/42、42/42、42/42，0 uncaught errors。视觉精简和会话恢复后的最终版本另跑三轮，结果仍为 42/42、42/42、42/42。
- 原生浏览器流程包括单次接管、多设备防抢占、任务中补充消息、审批、结构化问题、断网草稿、丢失回执后刷新重试、交还电脑、小屏 / 横屏和 450px 模拟键盘视口。
- 回执测试还真实重启 Web bridge，确认 provider 仍持有同一回执，不重复投递。terminal ID 替换后不继承旧原生实例。

局限：未在真实 iPhone / Android 上测试；Pi 自定义终端组件、所有 Codex 特殊审批类型、全量历史分页和长时间 soak test 未验收。详见 [原生交接设计](native-handoff.md)。

Oil UI 版本检查记录：使用 0.18.1，提示可更新至 0.23.9，本任务未更新技能。可由用户另行执行 `/usr/bin/python3 /home/wxb24/.codex/skills/oil-ui/scripts/check_update.py --update`。

## 启动器与重新接回（0.2.1，2026-10-22）

- 保留 `mherdr` 独立入口；未修改 shell 或 Herdr 配置。开发机 bridge 和已安装启动器已更新至 0.2.1，鉴权后的 `/api/info` 检查通过，连接密钥保持不变。
- `bun run typecheck` 与 `bun run build` 通过。完整测试命令 `MOBILE_HERDR_LIVE=1 MOBILE_HERDR_NATIVE_LIVE=1 bun test tests`：**21 个测试通过，113 次断言**。
- 新增测试覆盖共享 Codex 配置传递、不保留重放提示词 / 图片、精确 Pi 文件 ID、同一 terminal 的启动互斥、拒绝清理活进程锁、显式清理死进程锁、只读状态 / 诊断摘要，以及 `stop --help` 不执行停止。
- `bun run test:handoff-live`：**17 项检查全部为 true**。真实 Codex TUI 与 app-server 在隔离 Herdr session 中完成手机任务、Ctrl+] 接回、电脑任务；退出 TUI 后再次运行启动器并从手机继续，runtime / conversation / terminal 不变。首次 `-c` 的本地模型地址实际用于手机任务，重连保持配置。真实 Pi TUI 也完成手机任务、Ctrl+] 接回和电脑任务，三个身份不变。
- 所有真实 provider 验证仍使用临时配置和 loopback 模拟模型，不使用付费模型或用户会话。测试自己的后台和 Herdr session 随后清理。
- 最终构建的 `bun run test:ui`：**22 项兼容模式 + 20 项原生检查通过，0 uncaught errors**；覆盖既有手机宽度、横屏和缩小 visualViewport。这一轮未改变界面布局，不替代真实手机验收。
- 恢复 TUI 期间通过本地 attach 阶段暂停接管，恢复完成后再开放；协议测试确认此时手机 claim 被拒绝。启动失败且尚未选择对话时清理本次新建后台，不替换已经存在的 agent。
- 当前明确拒绝 Codex `--profile` / `--worktree`；使用支持的 `-c` 配置或原 CLI 的终端兼容模式。旧版运行实例缺少私有重连配置时不猜参数，须先完成任务，再停止并按精确 ID 恢复。其他实机、Pi 自定义 UI 和长期稳定性边界仍如上。

## UI / UX 润色验证（2026-10-22）

- `bun run typecheck`、`bun run build` 和 `git diff --check` 通过。构建仍有主包超过 500 kB 的建议性提示，当前 gzip 约 169 kB。
- `bun test tests`：**18 通过、3 跳过、0 失败，98 次断言**。本轮未开启真实 Herdr / 原生 provider 集成测试，也未操作用户已有 Herdr 服务或会话。
- 修改后的浏览器脚本通过，最终减法前后两次完整结果均为 **31 项兼容模式 + 20 项原生检查通过，0 uncaught errors**。之前增补检查时捕获的抽屉响应式残留已修复，原生 `accessibilityState` 未传递到 Web 的选中语义补为显式 ARIA 属性。短视口测量等待可观察布局，截图等待有限动画结束。
- 新增检查：连接校验失败保留名称 / 地址；草稿存储失败提示并保留输入；历史阅读返回最新；按 agent / pane ID 搜索；搜索无结果和需要处理筛选的恢复入口；横屏抽屉滚动访问；分段选中语义和底板位置；短视口终端边界；减少动态效果。
- 保留原有 320×568、360×740、390×844、430×932、844×390、768×1024 和 450px visualViewport 检查，以及原生接管、第二台设备防抢占、审批、问题、断网与模糊回执重试验证。默认和原生 UI 均使用测试创建的隔离 Unix socket fixture。
- 最终静态证据：`artifacts/ui/phone-chat.png`、`phone-draft.png`、`phone-sessions.png`、`phone-search-empty.png`、`phone-history.png`、`phone-connect.png`、`phone-offline.png`、`phone-keyboard-viewport.png`、`desktop-chat.png`、`phone-detail-2x.png`；原生截图位于 `artifacts/native-ui/`。
- 动效证据：两套 `interaction.webm`、`artifacts/ui/motion-events.json`，以及 `artifacts/ui/motion/` 的对话出场、抽屉与发送的三组采样帧。一轮独立存量润色静态评审后，主 Agent 复看最终截图及动效帧；未对视觉打分。设计取舍和删减文案记录在 `docs/design.md`。

本轮仍是桌面 Chromium 的移动视口验证，**未做真实手机键盘、IME 或系统后台行为测试**。

## 私人内测包（0.2.2-beta.1，2026-10-22）

- `bun run test:release`：Linux x64 上 **19 项打包冒烟检查通过**。解压到临时目录后从包目录以外运行，未安装项目依赖；验证预构建 Web / xterm 资源、鉴权、配对 fragment、自定义路径安装 mherdr、防止覆盖其他命令、原生状态隔离、Codex host 本地协议替身启动和关闭，以及 Pi 扩展在 Node 中导入并注册。
- 测试只创建自己的临时文件、fixture socket、bridge 与 provider 替身。未安装或更新本机已有 mherdr，未重启或升级用户的 Herdr，未向用户的 agent 提交测试消息。运行包使用明确的入口清单，附 SHA-256、来源 manifest 和第三方许可文件。
- `bun run typecheck`、`bun test tests`（18 通过、3 跳过、98 次断言）、重建静态资源后的 `bun run test:ui`（31 + 20 项、0 uncaught errors）及 `git diff --check` 通过。未在本轮重跑真实 Herdr / Codex / Pi 集成测试。
- 产物与按实际压缩包 SHA-256 关联的检查清单位于 `artifacts/releases/`。指南见 `docs/beta-guide.md`，维护者流程见 `docs/releasing.md`。当前仅准备本地私人内测包，未上传、创建公开仓库或发布到 npm；macOS / ARM64 与真实手机仍待验收。

## Herdr SSH 自动发现（0.2.2-beta.2，2026-10-22）

- 根因分为两项：旧版仅支持手动保存 bridge endpoint，没有读取 Herdr SSH profiles；现场入口仍是 0.2.1，且该进程环境中的 `herdr machine list --json` 返回空列表。用户确认 profiles 实际保存在另一台电脑，需在那台电脑运行入口，或由用户明确配置当前入口账号的机器目录。未自动复制其他电脑的配置。
- 新增入口侧自动发现、连接、状态和 SSH 转发。远端通过 Bun 临时执行 bundled bridge，只使用已运行的 Herdr；不执行 `machine add`、安装、升级、启动或停止 Herdr，不创建第二份 provider。凭证经 SSH stdin 和内部 WebSocket / HTTP auth 传输，不写入 URL、日志、发布包或浏览器的远端 token 配置。
- `bun run typecheck`、`MOBILE_HERDR_SSH_LIVE=1 bun test tests`：**21 通过、3 跳过、0 失败，124 次断言**。跳过的是独立真实 Herdr 与安装版 Codex / Pi provider 的既有 opt-in 检查。
- 新增 3 项后端测试覆盖 profiles 校验、改名不重连、目标 / session 指纹、禁用移除、目录读取失败保留已有连接、同名 pane 与请求回执隔离，以及真实 OpenSSH 路径。真实 SSH 使用临时 sshd、host/client keys、known_hosts、受限测试环境和 fixture socket，仅连接 loopback。临时服务的 StrictModes 为适配 `/tmp` 所有权路径而关闭；生产客户端始终使用 `StrictHostKeyChecking=yes` / `BatchMode=yes`，不改变用户 sshd 或 SSH 配置。
- OpenSSH 端到端验证临时 worker、原生消息与去重、原始终端收发；断开后原生运行实例和电脑输入权不变，未触碰用户已有主机或密钥。
- `bun run test:release`：**20 项通过**，含预构建 SSH worker 随包分发；该测试关闭真实 machine 发现，避免连接运行测试者的主机。`bun run test:ui` 在重建静态资源后 **31 + 20 + 14 = 65 项通过，0 uncaught errors**。
- 新增浏览器检查覆盖自动显示 online / auth / disabled profiles、初始连接失败后的元信息重试和错误清除、刷新恢复远程选择、同名 pane 草稿隔离、原生接管 / 交还、离线不重放、待认证目标不保留本地可写 pane，以及 320px、390px、横屏和 450px visualViewport。证据为 `artifacts/ssh-ui/`。
- 仍未在用户另一台电脑的实际 SSH profiles、macOS / ARM64 或真实手机上验收；远端需 Bun 1.4+、可发现的 Herdr CLI、运行中的 protocol 22 session 与可用的 Unix socket 转发。失败明确提示，不自动处理认证或部署依赖。停用 SSH 转发不会停止原生 agent；临时 bridge 无活动约 35–40 秒退出。

## 多主题、可调字体与终端浏览（0.2.2-beta.3）

- `bun run typecheck` 与 `git diff --check` 通过。
- `MOBILE_HERDR_LIVE=1 bun test tests`：23 pass、3 skip、0 fail，172 assertions。包含独立 Herdr session 的原 pane PTY / 历史读取与断开生存验证；3 个未启用项为真实 Codex、Pi 与 OpenSSH 测试，不将它们描述为本轮已验收。新增六主题正文、输入提示与主操作对比度检查（42 assertions）。
- 重建静态资源后，由主 Agent 连续执行 `bun run test:ui` 三次：每次 legacy 31 + native 20 + SSH 14 + appearance/terminal 25 = **90 checks**，三次均通过、零未捕获浏览器错误。覆盖设置刷新读回、设置存储失败、草稿保持、六主题切换、阅读与终端独立字号、等宽字体、320px / 450px / 横屏、历史纵向与横向滚动、刷新位置保持、普通回滚与新输出不抢位置、回到实时、外观切换不重连终端。
- 备用屏幕的滚轮与 Chromium CDP 触控拖动均未产生 input frame。终端浏览脚本使用自有 Unix-socket fixture 和模拟 VT WebSocket 流；后端真实 PTY 由上述独立 Herdr session 另验，不将模拟流描述为用户 agent 的真实输出。
- 根因复现：在测试创建并清理的 Herdr session 中，仅 attach 初始化即观察到 alternate-screen 与 mouse-tracking 控制序列。备用屏幕没有普通 xterm scrollback，旧路径无法提供安全的浏览体验。新路径使用只读 `pane.read` 的 `recent_unwrapped`，默认保留原接口 200 行，可请求 1–5000 行，UI 请求 2000 行；历史保留范围由 Herdr 和原程序决定。
- 证据：`artifacts/appearance-ui/verification.json`、`interaction.webm`、六主题设置 / 阅读 / 终端截图；`desktop-flexoki-chat.png` 为 1280×900，其余主图为 390×844。真实设备键盘、IME、后台恢复仍需独立验收。
- 动效证据：`artifacts/ui/motion/conversation-entry/`、`mode-switch/`、`send-feedback/` 的 start / mid / end 帧。内容淡入为生产 CSS 的重新触发采样；分段切换采样真实 CSS transition；按压使用 Chromium 强制 `:active` 状态采样生产 CSS，发送动作另走真实 click，不能据此宣称物理触屏手感通过。外观面板淡入在 `artifacts/appearance-ui/interaction.webm`；其中的主动页面刷新有意验证设置持久化。
- 完成一轮独立存量界面润色评审，不打分。未发现静态阻断；采纳“长按复制”改为“选择复制”，补齐关键 CSS 动效证据。保留字体预览句和主题深浅说明作为调节依据。报告见 `docs/ui-theme-review.md`。
- `bun run test:release`：21 checks 通过（Linux x64），包含新主题的许可与来源随包分发。源码与运行包为 beta.3；未重启用户现有 Herdr 服务，也未终止任何原生 agent。

## 会话恢复、阅读工具、Diff 与后台运行（0.2.2-beta.4）

- `bun run typecheck`、`bun run build` 与 `git diff --check` 通过。最终代码执行 `MOBILE_HERDR_LIVE=1 MOBILE_HERDR_NATIVE_LIVE=1 MOBILE_HERDR_SSH_LIVE=1 bun test tests`：**32 pass、0 skip、0 fail，241 assertions**。包含真实 Herdr 0.9.3、Codex 0.162.1、Pi 1.2.0 与临时 OpenSSH；provider 请求使用 loopback 模型替身，不调用付费模型。
- 新增后端检查覆盖 207 条含中文、无原生消息 ID 的 transcript 完整分页，追加后游标稳定、身份变化拒绝；240 条原生存档分页不改变控制权和 epoch；静默 WebSocket 超时重连、只发 auth / ping、不重放写入；Diff 行号、多个文件、新增与工具文本；诊断白名单；后台启停、重复启动和篡改 PID / nonce 不结束其他进程。
- Codex 历史读取调用同一已注册 app-server 的 `thread/turns/list`，真实集成检查读取后仍为原 runtime / thread，epoch 不变。官方本机生成的协议 schema 确认文件审批参数通过 itemId 关联此前的 fileChange 与后续 patchUpdated，没有启动第二份 agent。Pi 使用当前运行实例有限存档；旧 broker 能力门控，不自动迁移或重启。
- 重建静态资源后连续三次执行完整 `bun run test:ui`：每次 **31 legacy + 20 native + 14 SSH + 25 appearance/terminal + 20 experience = 110 checks**，均通过，0 uncaught errors。最后补充各 parser 路径的截断标识与对话更换时的存档边界清理后，另重跑上述完整后端测试通过；未改变静态页面布局。
- 新浏览器检查覆盖 Markdown Diff 与补丁复制、前插历史保持锚点、查找较早消息、上一问、聊天 / 终端切换保留阅读位置且终端不重连；终端搜索、选择优先复制、顶部 / 底部；文件审批原位 Diff、拒绝及缺少修改内容时禁止允许；pageshow 恢复读取新控制权并保留草稿；诊断复制脱敏。320px 宽、450px 可视高度与横屏均有布局检查。终端浏览没有产生 input frame。
- 视觉证据在 `artifacts/experience-ui/`，含 `verification.json`、`interaction.webm`、手机 Diff / 文件审批 / 终端查找 / 连接诊断截图。一轮独立存量界面评审后，将终端查找拆为两排，主 Agent 复看修改后的截图；见 `ui-experience-review.md`。六主题 Diff 增删文字另验证 4.5:1 对比度，保留原 ANSI 颜色。
- `bun run test:release`：**24 项打包冒烟检查通过（Linux x64）**，新增运行包后台启动、同一进程状态与仅停止自身 bridge；原前台 fixture 仍可访问。包含预构建页面、管理入口、SSH worker、原生启动器与许可，不需安装依赖。交付前从 clean HEAD 重新打包，使用 `release.json` 与 SHA-256 对应源码和最终文件。
- 所有写入、PTY、管理和 provider 测试只操作自身创建并清理的隔离 fixture / session / 进程。未重启、升级或停止用户的 Herdr，未停止用户的原生 agent，也未替换已运行的旧 bridge。另一台电脑的 SSH profiles 仍需在那台电脑运行入口才能发现。

仍未完成真实手机键盘、中文输入法、锁屏 / 系统后台、macOS 或 ARM64 验收。后台命令不安装系统服务，不提供开机自启或崩溃自恢复；诊断仅比较页面与 bridge 版本，不查询远程更新。搜索仅覆盖已加载消息，历史受 provider / Herdr 保留范围限制，详细边界见 `beta-guide.md`。

## 公开分发、一键安装与自定义 token（0.2.2-beta.5）

- `bun run typecheck`、`bash -n install.sh`、`git diff --check` 通过。完整 opt-in 测试：`MOBILE_HERDR_LIVE=1 MOBILE_HERDR_NATIVE_LIVE=1 MOBILE_HERDR_SSH_LIVE=1 bun test tests`，**34 pass、0 fail、263 assertions**。新增 token 持久化 / 原子替换、0600、非法输入保留旧值、CLI 不打印密钥、不接受密钥参数和环境变量优先级检查。
- 独立 Python PTY 在临时 state 中运行实际 `token set`，输入随机密钥，确认退出成功、保存一致、终端输出不含输入内容。没有修改用户 token 或运行中的 bridge。
- `bun run test:release`：**31 checks 通过，Linux x64**。在原24项基础上增加运行包自定义 token，以及真实 shell 安装脚本的6项验证：带空格 / 单引号路径、重复安装、校验失败、同名命令保护、缺失版本、没有 Bun 时安装到独立 prefix。下载 transport 与 Bun 安装源使用本地替身，不修改真实 HOME 或 shell 配置。预构建 bridge 使用保存的自定义 token 完成 HTTP 鉴权，pair 的 fragment 读取相同值。
- 重建静态资源后 `bun run test:ui`：**110 checks 通过、0 uncaught errors**；原手机宽度、450px 可视高度、主题、终端、审批、搜索、SSH 与页面恢复回归均通过。此次没有更改视觉布局，真实手机与跨平台验收边界不变。
- 公开前检查全部 Git 提交差异：未发现常见 GitHub / API / AWS 凭证格式、私钥头、敏感文件名，亦未发现当前本机 token。该检查针对已列模式与本机已知值，不等同于完整安全审计。发布包仍使用显式文件清单，不携带 state、transcript 或本机配置。
- 发布采用 clean HEAD 的源码标识与校验和，GitHub tag 为 `v0.2.2-beta.5`，默认安装版本固定为该已验收版本。安装不会自动停止 / 启动 bridge 或 Herdr；升级与 token 轮换需要使用者显式重启自己的 bridge。源码公开与 beta 分发不改变手机 / macOS / ARM64 尚待验收的状态。

## 8 字符 token 与 SSH 通道兼容（0.2.2-beta.6）

- token 校验移到 `shared/auth.ts`，CLI、服务端、手动连接和 pairing 均接受8–4096个非空白 ASCII 字符。默认随机生成长度不变。包内真实 HTTP 鉴权与 pair 使用8字符凭证验证；浏览器 fixture 同样使用随机8字符 token，新增无存储上下文扫码配对、清除 fragment 后连接成功的检查，未截取带凭证的页面。
- SSH worker 默认由远端 OS 分配 `127.0.0.1` 空闲端口，通过专用、私有 ControlMaster 添加 TCP 转发并做只读 `/api/info` 探测；只在通道失败时回退原 Unix socket 路径。网络 / 认证 / provider 环境错误不靠重放写入处理。Unix 回退明确禁用共享已有 SSH master，停止只清理本次创建的进程和本地 socket。
- 完整 opt-in 测试：**36 pass、0 fail、278 assertions**，包括真实 Herdr / Codex / Pi 与隔离 sshd。SSH 三种新增场景：`AllowStreamLocalForwarding no` 时真实 TCP 路径完成 native 消息去重及终端收发；fixture 客户端拒绝 `-O forward` 时回退真实 Unix 路径并完成同样操作；TCP / StreamLocal 均禁用时准确报错，原运行实例、输入权和消息保持不变。所有服务、密钥、端口和写入均为测试自身创建，不触碰用户已有 sshd、SSH 配置或 Herdr session。
- `bun run typecheck`、`git diff --check`、重建静态资源后的 `bun run test:ui`（**32 + 20 + 14 + 25 + 20 = 111 checks**，0 uncaught errors）通过。`bun run test:release` **31 checks** 通过（Linux x64），包括8字符 token 的打包鉴权和配对、安装器重复执行与失败保留。
- 错误原因不再仅归于 `AllowStreamLocalForwarding`。[OpenSSH 的路径连接实现](https://github.com/openssh/openssh-portable/blob/V_10_5_P1/channels.c) 还检查整体转发权限；隔离测试发现仅开启 StreamLocal 并不能保证被全局策略限制时可用。因此 Unix 是兼容回退，不能承诺绕过服务端限制。
- 远端没有常驻 Web bridge 时，扫描 IP 端口不能提供 Web 服务。自动模式只经 SSH 启动临时 bridge 并探测实际端口，不猜测固定7331，不向未知端口投递入口 token；现有独立 bridge 可由用户手动添加地址直连。用户另一台电脑的实际 profile 未在本机验证，需在保存 profiles 的入口电脑更新并重启 Mobile Herdr bridge。

## Android 独立客户端（2026-10-23）

- 生成 `artifacts/android/mobile-herdr.apk`：release、非 debuggable、Android versionCode 1 / versionName 0.2.2，minSdk 24 / targetSdk 36，包含 arm64-v8a 与 x86_64。APK 内置 Hermes 字节码，模拟器无 Metro 启动通过。`apksigner verify` 通过，SHA-256 随 APK 输出。
- Expo SDK 58 兼容检查通过，React / React DOM 精确对齐 19.3.0，WebView 使用 SDK 推荐的 14.0.1。签名密钥和密码保存在仓库外的私有 state 目录；Android 原生目录由 Expo Prebuild 生成并忽略版本控制，增量构建使用 `--no-clean`。
- `bun run typecheck` 通过；本轮最终完整 `bun test tests` 为 **42 通过、6 跳过、0 失败**（302 次断言）。其中新增 Android 检查覆盖 CLI / deep-link 配对兼容、非法载荷、32000 字符中文草稿与发送回执重开数据库后完整恢复、旧 SecureStore 草稿迁移、存储失败保留及恢复、Markdown / 外链协议限制。
- 最终 `bun run test:ui` 为 **32 项兼容模式 + 20 项接管 + 14 项 SSH + 25 项外观 / 终端 + 22 项阅读体验**，全部通过、0 uncaught errors。较早的三轮 Web 基线回归也全部通过；新增共享控制权回执修复之后重新构建并完成最终整套检查。短视口检查使用真实溢出的 390×568 fixture，避免对一屏可容纳的内容断言历史按钮。
- `MOBILE_HERDR_ANDROID_SERIAL=emulator-5580 bun run test:android`：**19 项通过**，Android 15 / API 35 专用模拟器、release APK、uiautomator2。覆盖不依赖 Metro 启动、相机拒权回退、冷 / 热启动配对确认、精确 session / pane、Markdown 与搜索定位、接管、单次投递、审批、结构化问题、后台返回并核对桌面输入权、进程重启与同签名覆盖安装保留 SQLite 草稿和 SecureStore 连接、断线不重放、共享主题、系统返回键、WebView 终端历史和原生剪贴板。
- 原生验证暴露并修复 Android 全面屏键盘遮挡输入框，以及搜索目标在后续布局变化时重复定位的问题。接管 / 交还的 HTTP 回执在下一次 watch frame 到达前即参与输入权和 epoch 判断，避免快速切换使用旧 fence；更高 epoch 的服务端状态仍覆盖旧回执。
- `MOBILE_HERDR_LIVE=1 bun test tests/live-herdr.test.ts`：1 项通过，真实独立 Herdr session 的 PTY 在手机分离后继续存活。Android UI 的原始终端验证使用 fixture 的只读历史；不把它描述为真实 Android → Herdr PTY 全链路输入验收。
- 证据：`artifacts/android/ui/verification.json`、`connect.png`、`chat.png`、`reading-search.png`、`keyboard.png`、`sent.png`、`approval.png`、`desktop-owner.png`、`offline.png`、`appearance-light.png`、`terminal-history.png`；完整日志为 `artifacts/android/native-accepted.log`、`web-accepted.log` 和 `build-accepted.log`。主 Agent 自检实际截图，未做独立视觉评审。

边界：未验证实体手机扫码识别、中文输入法组合输入、厂商省电策略、长时间锁屏 / Doze、其他 Android OS / ABI 的实机行为；当前没有后台 push 或常驻连接保证，也不交付 iOS 安装包。终端页面由 bridge 提供，原生复制和显式暂停需使用包含本轮终端适配的 bridge。所有写入、进程重启和覆盖安装只发生于专用模拟器或测试创建的 Unix socket / provider / Herdr session；没有重启、升级或终止用户已有 Herdr 或 agent。

## 2026-10-23 手机界面与首次一键接管

- `bun run typecheck` 通过；默认测试47项通过、6项按环境跳过，320个断言。包含逐帧64MiB限制、17MiB Codex响应、原生控制权、精确身份、中断键映射、补丁聚合、更新失败回滚及远端组件缓存。
- `MOBILE_HERDR_SSH_LIVE=1 bun test tests/ssh.test.ts`：5项通过，真实隔离OpenSSH覆盖TCP、Unix回退、双通道拒绝及原生输入权；只操作fixture和临时sshd。
- `bun scripts/verify-packaged-takeover.ts`：解压后的包接入普通Pi与Codex。Pi PID与会话不变；Codex重连原TUI、daemon PID集合与会话不变，没有新建第二份执行后端。均完成手机任务、交还电脑、桌面再发任务。模型仅使用本地隔离协议服务，没有重放初始提示。
- `bun scripts/verify-terminal-live.ts`：真实Herdr隔离pane中，从浏览器xterm键盘与Enter快捷键发出命令并读取原PTY回显；点击终端可重新聚焦。未向用户会话写入。
- `bun run test:release`：32项通过，包含SHA-256、私有配置、安装器、启动器、后台控制、接管与更新入口和运行包外目录启动。
- 页面回归包含基础32、原生20、SSH14、外观25、阅读 / diff23、手机布局23和PWA12项，共149项；交付前连续三轮结果为149/149、149/149、149/149，每轮0未捕获异常。

PWA检查包含图标解码与尺寸、首次完整预缓存、API与凭证不入缓存、离线外壳及草稿、重连不重放、浏览器安装提示与安装完成事件。没有将模拟浏览器安装事件描述为真实手机安装。

当前源码改动与本地产物尚未作为新的GitHub release发布；更新入口会读取实际已发布的完整运行包。公司HTTPS / Caddy由部署agent按 `deployment.md` 配置，应用未修改此机器的代理、TLS或网络。

已将此项目原先直接启动的Web bridge以相同地址与凭证迁至受管理服务（7331），只向已核验的原Web进程发送SIGTERM；启动后验证原密钥有效、接管API可用及managed诊断标记。没有停止Herdr或用户agent，也没有向用户pane发送命令。当前mherdr启动器指向本工作区代码。

提交前再次通过类型检查、47项单测（6项环境跳过、320个断言）和重建后的149项Web检查。使用原签名重新构建包含最新共享界面的release APK，并在本轮启动的专用 `emulator-5580` 上通过19项Android检查；测试仅使用隔离fixture，结束后关闭该模拟器。日志为 `artifacts/ui/prepush.log`、`artifacts/android/build-prepush.log` 和 `artifacts/android/native-prepush.log`。APK、日志、签名文件均不入库；实体手机边界不变。本次只推送源码，不创建GitHub release或版本标签。


## 手机终端、slash 与会话控制优化（2026-10-23）

- 对照本地 HerdTerm 和固定提交的 Paseo / OpenChamber 源码，梳理结果与功能边界见 [体验对齐分析](mobile-experience-alignment.md)。常驻工具采用图标，空输入框保持54px；模型和思考强度集中到点选面板，工作中保持停止操作。新增 slash 候选、长草稿编辑、回复复制，以及按 provider 能力提供的模型 / 强度 / 压缩 / 计划模式 / 原对话审查和 Pi 命令。
- `bun run typecheck` 与 `git diff --check` 通过。Pi 插件新增纳入 TypeScript 检查。完整 opt-in：`MOBILE_HERDR_LIVE=1 MOBILE_HERDR_NATIVE_LIVE=1 MOBILE_HERDR_SSH_LIVE=1 bun test tests`，**61通过、0跳过、0失败，411次断言**。本轮原生检查明确使用本机 Codex 0.162.1 与 Pi 1.2.0 的固定可执行文件，模型请求仅发到测试本地协议服务。
- 新增读取测试验证密集约4MiB记录的最新一页只读取64KiB；反向扩展复用已读字节，总范围最多8MiB。覆盖UTF-8字节游标、207条无丢失分页、工具结果、大消息截断、超大JSONL记录、半条记录和空文件。WebSocket临时错误后即使内容未变也会重新发送状态，恢复不产生写入。
- 原生控制测试检查模型和强度真实进入同一个 `turn/start`，计划模式使用结构化设置；任务中拒绝配置修改、失效epoch拒绝写入、上下文压缩按请求ID去重，审查明确使用同一thread和inline delivery。真实Pi通过扩展注册测试slash命令，确认原进程执行、未变成模型提示词，并验证实际思考强度切换。停止操作的claim和stop沿用可重试的请求ID。
- 重建静态资源后，主Agent连续三轮 `bun run test:ui`：**180/180、180/180、180/180**，每轮0未捕获异常。每轮包含32兼容、20原生、14 SSH、25外观 / 终端、23阅读、23手机布局、12 PWA和31新增控制检查。新增检查覆盖slash、模型 / 强度、未知命令保留、失败显式重试、全屏同份草稿、刷新 / 存储失败、停止、回复复制、搜索空态、一次性Ctrl / Alt、方向面板拖动不写入、bracketed paste、输入权失去后保留预览且恢复不重放。
- 320×568、390×450、844×390及360px模拟键盘视口均检查控件与横向溢出。393×674主会话可阅读550px，320×568为444px，390×450为326px；空输入框均54px。新增全屏编辑也检查短视口发送操作。浏览器检查等待弹层动画完成，不以过渡中的位置判断稳定布局。
- 复用仓库外原签名构建release APK，`apksigner verify`通过；专用 **emulator-5582 / Android 15** 上 `bun run test:android` **25项通过**。新增原生模型 / 强度点选、slash计划模式、全屏草稿与系统返回；实际WebView方向键和显式剪贴板粘贴到达本次测试拥有的VT peer，读取剪贴板只进入预览。测试期间重启应用、同签名覆盖安装、网络恢复和输入权核对均通过。完成后关闭本轮创建的模拟器。
- `bun scripts/verify-terminal-live.ts` 另通过真实独立Herdr session的浏览器xterm键盘与Enter输入验证；不将Android的VT fixture描述为真实Android到Herdr PTY验收。`bun run test:release` **32项通过（Linux x64）**，包含预构建运行包、原生组件、安装与管理回归；没有发布新的GitHub release或版本标签。
- 按oil-ui进行一轮独立存量界面评审，不打分；未发现所见静态阻断。采纳删除强度重复英文和查找重复提示的建议。主Agent复看修改后的Web截图，以及Android全屏编辑、方向面板和粘贴预览。精确动效时长与实体手机reduced-motion未据此认定通过。
- 证据：`artifacts/optimization-tests.log`、`artifacts/optimization/web-final-1.log`至`web-final-3.log`、`artifacts/optimization/android-build.log`、`android-test.log`、`terminal-live.log`、`release-test.log`；截图 / 视频在`artifacts/controls-ui/`、`artifacts/mobile-layout/`及`artifacts/android/ui/`。独立评审为`artifacts/optimization/visual-review.md`。APK与SHA-256在`artifacts/android/`，均不入版本控制。

限制：实体手机中文输入法组合输入、扫码、厂商省电、长时间锁屏 / Doze与其他Android版本仍未验收。旧的已运行原生组件按自身能力显示选项，未自动替换或重启。附件、文件提及、显式follow-up队列和完整Git / PR工作流尚未对齐。所有写入、PTY、模型、SSH、安装与清理仅作用于测试创建的环境，没有重启、升级或终止用户原有Herdr、agent或bridge。

## 文件浏览与更新修复（2026-10-24）

- 入口与边界见 [项目文件与更新修复](files-and-updates.md)。文件浏览覆盖所选本机 / SSH 的 pane 项目目录、筛选、原文 / 代码与图片预览、二进制下载，未增加编辑、删除或上传。沿用紧凑全屏工具页与图标操作，长列表使用 FlatList 按需渲染。
- 现场只读诊断确认实际运行 beta.6、工作区源码 beta.7，更新 worker 把后者误当运行版本。回归测试现覆盖这种混合版本下成功切换、失败回滚、旧 ready / failed 状态、新版本与丢失 worker。页面提交错误与轮询错误分开；网络结果不明确时不自动重发，用户主动重试沿用同一个请求 ID。
- `bun run typecheck`、`git diff --check`、`bun install --frozen-lockfile` 通过。完整 opt-in `bun test tests` **66通过、0跳过、0失败，455次断言**，使用固定 Codex / Pi 二进制及隔离模型协议服务。文件接口覆盖UTF-8截断、中文文件名、精确二进制、根目录变化、路径越界、外部链接、FIFO、100MB上限、无凭证拒绝，以及SSH流式响应与错误传播。
- 重建静态资源后，主Agent连续三轮 `bun run test:ui` **207/207、207/207、207/207**，均无未捕获异常；包括原有180项与新增27项文件 / 更新流程。新增检查覆盖目录 / 原文 / 图片 / 二进制、中文下载名与字节、读取失败和重试、slash入口、320×568 / 390×450 / 844×390、更新检查失败、投递不明确时不自动提交及同ID重试、重复点击限制和完成刷新。之后修正测试PNG的CRC，再单独通过相同27项检查；PNG实际解码也单独在Android核对像素。
- `bun run build:android` 复用仓库外原签名，apksigner检查通过；专用 **emulator-5582 / Android 15** 的签名独立APK完整回归 **31项通过**。新增检查保存后通过adb读取真实目标文件，与原始UTF-8字节比较；覆盖中文名与空格、系统另存为、取消回原预览、图片解码后的实际RGB像素，以及Bridge更新与APK入口的区分。测试发现并修复了SDK原生URI返回值与预编译AAR绕过补丁的问题，已固定依赖补丁并只对此模块强制源码编译。写入使用文件描述符按64KB分块，清理私有缓存。
- Android UI检查还修正WebView无障碍虚拟节点的选择方式、系统保存按钮随键盘移动时的点击等待，以及截图等待Modal布局稳定。`MOBILE_HERDR_ANDROID_FILES_ONLY=1` 可运行文件专项，不能替代完整Chat与系统生命周期验收；`MOBILE_HERDR_ANDROID_OUTPUT` 可将专项截图与报告保存在独立目录。
- `bun run test:release` **32项通过（Linux x64）**，产物为本地运行包。独立静态视觉评审一轮 **8/10**，所见窄屏与短视口没有布局阻断；动效与交互仍以实际流程记录为证，不以评分宣称通过。已压缩更新说明，未新增常驻文字入口，复用图标与现有主题。
- 日志在 `artifacts/files-update/`：`tests.log`、`web-final-1.log` 至 `web-final-3.log`、`android-build.log`、`android-test.log`、`release-test.log`；27项专项截图、录屏和报告在 `ui/`，独立评审为 `visual-review.md`。完整Android报告31项在 `artifacts/android/ui/verification.json`，补拍的稳定文件 / 更新截图在 `artifacts/files-update/android-ui/`。APK与SHA-256在 `artifacts/android/`，运行包在 `artifacts/releases/`。

没有创建新的公开release或标签；当前用户Bridge仍是原PID与beta.6，没有重启、升级或终止用户Herdr / agent / Bridge。检查与写入仅作用于测试创建的session / Unix socket / provider、临时文件与专用模拟器。实体手机中文输入法、扫码、厂商省电、长时间后台 / Doze及其他系统版本仍需分别验证。
