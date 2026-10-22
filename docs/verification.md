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
