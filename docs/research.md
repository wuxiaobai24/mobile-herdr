# Herdr 移动 Web：调研与实现决策

调研日期：2026-10-21。用户目标是从手机快速连接开发机，继续 **Herdr 中已经运行的 agent**；首版按后续要求集中做移动 Web。下面区分官方资料、本机实测和本项目的取舍。

## 1. 先澄清“同一个 session”

这里有两层 session：Herdr session 是一个常驻 server，拥有 workspace、tab、pane 和终端进程；agent session 是 Codex / Claude Code / Pi 各自的对话上下文。Web 客户端必须同时保留两者。

Herdr 已经承担进程持久化、agent 状态检测、终端布局和远程 SSH 连接。官方的手机路径是 SSH 客户端进入 Herdr TUI，也支持 `herdr --remote` 和保存 SSH machine。关闭客户端不会关闭 server 里的 pane；机器重启后是恢复布局并尝试 resume 支持的 agent，并非原进程跨重启存活。[官方工作流](https://herdr.dev/docs/how-to-work/)、[机器连接](https://herdr.dev/docs/connecting-machines/)、[持久化](https://herdr.dev/docs/persistence-and-remote-access/)。

因此我们不需要实现 agent harness，不应该为了手机接入另起一个 `codex resume` 或 `claude --resume` 进程。控制面接原 pane，阅读面接它的原生 transcript。

## 2. 相关产品

| 产品 | 与已有 Herdr 的关系 | 移动与连接路线 | 对本项目的价值和边界 |
| --- | --- | --- | --- |
| [herdr-web-ui](https://github.com/devswha/herdr-web-ui) | 直接复用 Herdr；读取原生 transcript，终端 attach 原 pane | 浏览器 / PWA，远程机器通过 SSH；插件安装 | 最接近需求的现成实现，功能覆盖很广。若目标只是马上使用，它是优先候选。借鉴聊天与终端双视图、精确会话绑定和提示校验；我们的首版不搬入其全部 provider、更新器和远程管理体系 |
| [Collie](https://github.com/AltanS/collie) | Herdr 是主后端，也适配其他 multiplexer | 自托管 PWA、Tailscale、设备配对、触摸键盘、通知；crew 管理多机 | 借鉴“需要你”的关注队列和手机终端。Crew 与 Herdr 的 machine profiles 是两套连接域，不能把它们当作同一个列表 |
| [Roamgate](https://github.com/powerfooI/roamgate) | Herdr 浏览器客户端 | Web / PWA、远程 SSH profiles | 包含文件、diff、注释、worktree 等完整工作台。适合下一阶段评审文件的参考；首版避免让文件管理挤占手机对话空间 |
| [Whip](https://github.com/KaminariOS/whip) | 直接通过 SSH 读取 Herdr API 和终端协议 | React Native + Rust，iOS / Android；原生聊天和完整终端 | 原生路线中与目标高度一致。说明手机可以不常驻新的 agent runtime；代价是 SSH、host key、SFTP、Rust FFI 与双平台发布，超出本次 Web 首版 |
| [Happy](https://github.com/slopus/happy) | 自有 CLI / harness / relay，不是通用 Herdr pane 客户端 | Expo 的 iOS / Android / Web，以及加密同步 | 借鉴跨端交互和配对。不能假定装上它就能接管任意既有 Herdr pane |
| [HAPI](https://github.com/tiann/hapi) | 包装 agent CLI，提供 hub / runner；官方另有 Codex shared-session 能力 | Web / PWA，原生 iOS / Android，relay 或自托管 | 手机远程开发的成熟参照。其控制协议与 Herdr 不同；本项目无需再引入一套 hub / runner |
| [Paseo](https://github.com/getpaseo/paseo) | 自有 daemon、provider 和 agent 生命周期 | Web、桌面、原生手机，直连 TCP / VPN 或加密 relay | 多机器 agent 工作台的参考；Herdr 复用并不是安装它后的自然结果，需要单独适配 |

资料来自各项目维护者的 README 与官方文档；没有仅根据产品宣传推定兼容性。Herdr Web UI 的 `server/codex.ts` 还专门处理进程、会话索引及同目录多 agent 的绑定问题，说明“找 cwd 下最新 JSONL”不可靠。[源代码](https://github.com/devswha/herdr-web-ui/blob/main/server/codex.ts)。

## 3. 本机实测得到的协议事实

- 已安装 Herdr **0.9.3 / protocol 22**，默认 API socket 为 `~/.config/herdr/herdr.sock`；named sessions 在 `sessions/<name>/herdr.sock`。已运行 session 能直接读取，无需重启或升级。
- `herdr api schema --json` 可导出当前二进制对应的 schema。Socket 使用逐行 JSON：`{id, method, params}`，成功返回 `{id,result}`，失败返回 `{id,error}`，不是标准 JSON-RPC 2.0。
- `session.snapshot` 一次返回 workspace、tab、pane、agent 信息和布局；pane ID 只在当前 server 内唯一。客户端标识必须包含 **machine + Herdr session + pane**。
- `agent.prompt` 会处理 bracketed paste 与 Enter，并在 agent blocked 时拒绝输入。Bridge 额外拒绝 working 状态下的聊天发送；控制与审批留给显式终端操作。
- CLI 的 `recent-unwrapped` 对应原始 API 的 `recent_unwrapped`；`pane.read` 的内容位于 `result.read`，不能按 CLI 文本参数盲拼原始 API。
- `herdr terminal attach <terminal_id>` 能在 PTY 内进入原终端；退出 attach client 后原 shell 仍然存在。本项目用独立测试 session 验证了输入、断开和 terminal ID 保持不变。
- 已有 pane 的 `agent_session` 并非始终存在；上报的文件也可能已被删除。此时必须降级到终端，或让用户明确关联候选记录。

协议设计参考：[Herdr Socket API](https://herdr.dev/docs/socket-api/)。以上更具体的字段与行为以本机 schema 和独立 session 实测为准。

## 4. 选择的最短实现路径

浏览器连接每台开发机上的 Bun bridge（HTTP / WebSocket），bridge 连接该机已有的 Herdr Unix socket。原始终端通过 Bun PTY 运行 attach client。Bridge 从本机的 agent 数据目录只读提取对话。

初版每台开发机运行独立 bridge，客户端保存多个 endpoint。0.2.2-beta.2 补充入口 bridge 自动读取 Herdr SSH profiles：在开发机复用 OpenSSH，远端以 Bun 临时执行 bridge 并转发私有 Unix socket，浏览器只访问入口。独立 bridge 模式继续可用。远端仍需 Bun 和已经运行的 Herdr；不自动部署或替换 Herdr，不把 SSH 私钥放进浏览器，也不依赖中心 relay。

原生 transcript 的归一化模型只有 user / assistant / tool，不把终端文本猜成对话，不转发 system / developer 提示和隐藏推理。优先使用 Herdr 上报的精确 ID / path；缺失时展示该目录的候选记录让用户选择，同目录多个 agent 不自动猜。

React Native Web 负责共享组件结构，Vite 输出静态 Web；这保留了以后复用界面到 Expo 的路径，但 **这次交付只验收 Web，不声称原生 App 已完成**。原生端文件仅是保留的起点。

## 5. 首版能力与明确边界

已实现：多机器 endpoint、运行中 Herdr sessions、workspaces 与 panes、Codex / Claude / Pi transcript、折叠工具操作、Markdown、安全会话关联、原 pane 聊天提交、原始 PTY 终端、触摸快捷键、草稿恢复、连接重试、PWA 壳与二维码连接入口。

首版仅明确接受 protocol 22。其他协议拒绝连接而不盲发控制命令。JSONL 解析是对已观察格式的适配，不承诺兼容所有未来 agent 格式。缺少 transcript 的 agent 仍可使用终端。

未实现：自动抽取审批卡片、文件 / diff 浏览、图片上传、语音、后台 push、relay、SSH bootstrap、新建 Herdr session / workspace 的完整 UI。原生安装包本次不交付。手机真实软键盘、系统后台冻结和 iOS 安装行为仍需要实机验证，桌面模拟器只能验证布局和恢复逻辑。

## 6. 后续优先级

1. 先用真实手机走一周：稳定的连接、精确的 session 绑定、输入和滚动，比增加页面更重要。
2. 用 Herdr integrations 提高 session ID 上报率；更长历史的增量读取、事件订阅和分页。
3. 审批卡片必须绑定实时 prompt 指纹，回答前再次校验，防止点击过期菜单。
4. 加 diff / 文件浏览与图片附件，再评估 Web 已覆盖多少实际开发场景。
5. 如有 Web 无法覆盖的后台通知、系统语音或安全存储需求，再推进 Expo 原生客户端和每设备可撤销的配对凭证。
