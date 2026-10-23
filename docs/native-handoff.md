# 原生会话与双向交接

交付目标是手机快速继续当前开发任务，同时保留电脑的官方终端界面。Web 与桌面都连接开发机上的同一个运行实例；兼容模式继续连接普通 Herdr CLI，不静默迁移。

## Codex

`mherdr codex` 在当前 Herdr pane 注册一个本地 broker。新建会话时 broker 启动一份 `codex app-server --stdio`；首次接管普通 Codex 默认 daemon 时，通过官方 `app-server proxy` 和 WebSocket Upgrade 复用已加载的原后端，官方 Codex TUI 通过私有 Unix WebSocket 接入 broker。Web bridge 通过另一条私有 Unix socket 访问其状态和操作。

所有 TUI 请求经过同一个连接转发，broker 关联请求 ID，向 TUI转发原始流式事件，将主会话事件规范化给 Web。手机接管时阻止桌面修改型请求和审批响应；接回电脑后恢复。Codex 生成标题等用途的 ephemeral thread 不参与主对话绑定。

手机原生操作包括 `turn/start`、`turn/steer`、`turn/interrupt`、标准命令 / 文件审批和结构化用户问题。未实现的特殊协议请求要求交还电脑。模型列表来自安装的 CLI；手机选定的模型用于之后的手机任务，电脑 TUI 的模型选择仍由其控件管理。

TUI 退出不会停止 broker；重新运行 `mherdr codex` 恢复相同 thread。`mherdr stop` 显式结束当前 pane 的后台原生 agent。首次可从手机“启用并接管”，自动等待空闲、确认会话 ID、退出原 CLI 并恢复；也可手动退出再运行 mherdr。不允许两个独立 app-server 同时恢复相同历史。可识别的其他 Herdr pane 占用会被拒绝；跨 Herdr / 其他产品的占用仍需用户先退出原客户端。

首次启动的 TUI 选项单独保存在私有的 `<runtime>.launch.json`（0600），用于重连；不保存位置参数中的初始提示词或图片参数，不在注册摘要 / HTTP 接口中暴露启动参数。后台停止时清理此文件。重连先通过本地 `attach` 操作暂停接管，等官方 TUI 完成精确 thread 恢复后开放手机写入，避免恢复历史覆盖并发消息。旧版后台没有这份启动配置时明确拒绝重连，不猜原配置、不自动停止它。

`-c`、feature 开关和 strict-config 传给共享 app-server，其他支持的交互选项交给官方 TUI。当前 Codex 0.162.1 的命名 profile 不直接支持独立 app-server 启动，故 `--profile` 明确拒绝；工作树创建也未接入。官方传输参考：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。

启动锁按 Herdr socket + terminal ID 隔离，覆盖启动器的整个前台生命周期，阻止快速重复启动 / 接入。`mherdr doctor --clear-stale-lock` 仅显式清理已退出启动器的锁；不会因进程仍在但连接超时而创建替代后台。`status` / `doctor` 只输出状态摘要，不打印聊天正文或 bridge 密钥。未修改 Herdr 或 shell 启动配置。

## Pi

`mherdr pi` 启动原 Pi TUI并加载项目的桥接扩展。已有普通 Pi 可从手机一键安装托管个人扩展并 `/reload`，在原进程接入；禁用扩展的实例保持原状。扩展在原进程中订阅消息、工具和生命周期事件，通过扩展 API提交消息、steer、停止和切换可用模型，不恢复第二份 Pi。

标准扩展 UI 的 `confirm/select/input/editor` 转发为手机卡片，保留取消信号和超时。交还电脑时未完成的手机弹窗回到原 UI处理；已在电脑打开的弹窗须先完成，再允许接管。其他扩展的自定义终端组件不保证手机原生覆盖。扩展使用 Pi公开的 UI context 包装标准方法；其他扩展若替换或预先缓存方法，仍可能绕过这条转发路径。

Pi 退出会结束运行实例；手机关闭页面不会退出 Pi。

Pi 恢复只接受完整 session UUID 或可读会话文件；只读取文件头的精确 ID 检查其他 Herdr pane 是否占用，不按 cwd 或时间选择文件。继续 / 选择器式恢复和非交互命令不走这个启动器。

## 控制权与投递

- Herdr 上报的 agent / 对话与注册实例不一致时暂停原生写入，不会静默绑定其他对话。
- 绑定由 Herdr socket + terminal ID 确定；pane 移动后 terminal 身份仍可匹配，替换 terminal 不继承旧运行实例。
- 每次切换增加 epoch。操作携带运行实例、对话、设备和 epoch，过期写入拒绝；第二台手机不能静默抢占。
- 桌面 `Ctrl+]` 支持传统控制字节和 CSI-u 编码，始终可以本地接回。
- 浏览器发送前保存草稿与请求 ID。刷新后手动重试使用原请求 ID，不自动重放。
- 投递回执由原生实例持有，bridge 重启不会丢失。当前实例最多保留 4,000 个回执，达到上限明确拒绝新操作；实例退出后不承诺恢复回执。
- 出错后不切回 `agent.prompt`，防止把原生消息误发给终端。普通会话继续走原来的 Herdr 提交路径。
- IPC目录权限 0700、注册文件和 socket 0600。Codex / Pi 协议不直接暴露到网络；浏览器使用原 bridge 的鉴权。

原生重连快照限制最近 160 条、约 120,000 字符，单项文本 / 输出限制 12,000 字符；Codex 恢复时读取最近5个 turn，使用原生 API 向前分页。完整历史仍在 agent 自己的会话存储中。单个 NDJSON 帧按 UTF-8 字节限制64MiB，不将同一读取批次中的多个帧误判为超限。原生流通过约 300ms 合并的 WebSocket 状态更新送达，Herdr topology 约 1.5s 更新。

## 与研究对象的取舍

本次优先完成一条可验证的路径：原终端开发 → 手机原生继续 → 原终端继续，同一实例、同一 thread、同一 terminal。没有声称整体功能或所有设备体验已经超过 Orca / herdr-web-ui；完整文件工作台、附件、push 和长期运行稳定性仍需后续补齐。
