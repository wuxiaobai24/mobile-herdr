# Mobile Herdr

从手机浏览器继续开发机上已经运行的 Herdr agent。复用同一个 session、同一个 pane 和同一个 agent 进程。

移动 Web 支持 Codex / Pi 原生 Chat 与电脑终端之间交接控制权，以及原始终端、多开发机、草稿恢复和断网重连。保留 Expo 代码结构供以后做原生端，**本次不交付原生安装包**。

顶栏“外观”支持 Catppuccin 四款与 Flexoki 深浅主题，可调整阅读字体、阅读字号和终端字号。终端支持手势翻阅、历史查找、选择复制与回到实时。对话支持向前分页、查找已加载消息、跳回上一问；补丁和文件审批按文件展示 Diff，可折叠、查看双栏行号并复制。

## 一键安装

当前版本 **0.2.2-beta.6**，源码公开，运行包见 [GitHub Releases](https://github.com/wuxiaobai24/mobile-herdr/releases)。在已有 Herdr 的开发机执行：

```bash
curl -fsSL https://raw.githubusercontent.com/wuxiaobai24/mobile-herdr/master/install.sh | bash
# ~/.local/bin 不在 PATH 时，可使用 ~/.local/bin/mobile-herdr
mobile-herdr token set                              # 可选：隐藏输入自定义 token
MOBILE_HERDR_HOST=0.0.0.0 mobile-herdr background
mobile-herdr pair --url http://你的开发机局域网IP:7331
```

脚本校验 SHA-256，安装 `mobile-herdr` 和 `mherdr`，无需 sudo、git clone、安装前端依赖或构建。缺少 Bun 时从 [Bun 官方安装入口](https://bun.sh/docs/installation) 安装 1.4.0 到本工具目录；已有 Bun 不自动升级。不会安装、启动或停止 Herdr，不自动启动 bridge，不修改 shell 配置。仅 Linux x64 已完成验证；macOS / ARM64 与真实手机仍需验收。

可先下载并阅读脚本，或用 `bash install.sh --help` 查看版本和路径选项。默认包目录 `~/.local/share/mobile-herdr`，命令目录 `~/.local/bin`；旧版本与 token 均保留。升级后需自行停止旧 bridge、再启动新版，原生 agent 能力升级见指南。

Token 不设置时自动生成；`mobile-herdr token set` 将自定义值持久保存在当前 state 的 `token` 文件（0600），启动和配对共用。支持 8–4096 个非空白 ASCII 字符，请使用随机长串。设置后重启 **Mobile Herdr bridge** 并重新配对即可，Herdr / agent 无需重启。`MOBILE_HERDR_TOKEN` 环境变量仍支持，且优先于文件；`mobile-herdr token status` 仅显示配置来源，不打印密钥。自动化可用 `token set --stdin`，不要把密钥写入命令参数或仓库。

- 使用者：[安装、配对、升级与回退](docs/beta-guide.md)
- 维护者：[打包验证与发布步骤](docs/releasing.md)
- [可直接转发的邀请文字](docs/beta-invitation.md)

在源码目录执行 `bun run test:release` 可生成并验证运行包，输出至 `artifacts/releases/`。当前仍为 beta，不发布 npm 或手机安装包。

## 启动

需要 **Bun 1.4+、Herdr 0.9.3 / protocol 22、Linux 或 macOS**。先在开发机启动原来的 Herdr。Bridge 不会替你重启 Herdr。

```bash
bun install
bun run start
```

开发机浏览器打开 http://127.0.0.1:7331。默认只监听 loopback。

希望关闭终端后继续运行 Web bridge，可先 `bun run build`，再执行 `bun run service start`；`bun run service status` 查看版本与状态，`bun run service stop` 停止该命令管理的 bridge。这些命令不停止 Herdr 或 agent，也不接管手动启动的前台 bridge。当前不安装开机自启服务。

手机通过局域网 / Tailscale 直连时：

```bash
MOBILE_HERDR_HOST=0.0.0.0 bun run start
# 另一个终端，把地址替换为手机能访问的开发机地址
bun run pair --url http://192.168.1.8:7331
```

扫描终端二维码，在手机上确认连接。也可以手动输入地址和 `~/.local/state/mobile-herdr/token` 文件里的密钥。二维码包含同一连接凭证，fragment 会在页面读取后立即清除，凭证不会放进 HTTP 查询参数或 WebSocket URL。

在反向代理 / Tailscale Serve 后使用 HTTPS，可以安装为 PWA。普通局域网 HTTP 可以使用 Web 界面，但浏览器通常不会允许安装 service worker。不要把 HTTP 入口直接暴露到不可信网络。

## 继续已有会话

### Codex / Pi：电脑和手机共用一个运行实例

在项目目录安装启动命令一次：

```bash
bun run install:agent
```

之后可以在任意项目的 **Herdr 空闲终端**中运行：

```bash
mherdr codex
# 或
mherdr pi
```

1. 电脑继续使用官方 TUI。手机打开同一 session / pane，点击「在手机继续」。
2. 手机通过结构化事件查看回复、工具进度和 diff；可以补充正在执行的任务、停止、回答问题、审批。
3. 回到电脑，按 **Ctrl+]**，或在手机点「交还电脑」。继续使用相同 agent 和相同对话，不 fork、不重启 agent。

两端都能查看进度，一端拥有输入权。手机刷新、断网、关闭页面和 bridge 重启都不会停止 agent，也不会自动重放消息。第二台手机不能静默抢走控制权。

已有的普通 CLI 会话不会自动迁移。首次启用时，先等当前任务完成、退出旧 CLI，然后使用精确的会话 ID：

```bash
mherdr codex resume <会话-ID>
mherdr pi --session <会话-ID或路径>
```

Codex 的 app-server 独立于 TUI 运行；退出 TUI 后可重新运行 `mherdr codex` 接回。需要结束当前 pane 的后台原生 agent 时，在该 pane 的 shell 执行 `mherdr stop`。Pi 的扩展运行在原 Pi 进程中，退出 Pi 会结束这个运行实例。切换时应保持 Herdr pane 打开。

启动和排障仍用 `mherdr`，安装不会修改 shell 配置或替换原 `codex` / `pi` 命令：

```bash
mherdr status             # 当前 pane 的对话、运行实例和输入权
mherdr doctor             # CLI 路径、Herdr 连接、启动锁与原生状态
mherdr status --json      # 机器可读摘要，不输出聊天正文或连接密钥
mherdr doctor --clear-stale-lock # 仅在启动器异常退出后清理过期锁
```

同一 pane 同时只能运行一个启动器，普通退出会释放启动锁。强制结束启动器后锁可能保留；诊断命令只清理已经退出的进程的锁，不终止正在运行的 agent。Codex 重连沿用首次启动的选项，不重复发送初始提示词和图片。恢复对话期间手机暂停接管，待同一 thread 恢复完毕再继续。

Codex 的 `-c`、`--enable`、`--disable`、`--strict-config` 同时传给共享后台。`--profile` / `--worktree` 暂不支持，会在启动前明确拒绝。恢复会话需完整 ID：不使用 `--last`、选择器或部分 ID 自动猜测。`exec`、登录、安装扩展、非交互模式等继续使用原 CLI；`mherdr codex --help` / `mherdr pi --help` 可查看原 CLI 帮助而不启动后台。

Codex 普通命令 / 文件审批和结构化问题可以在 Chat 中处理；其他特殊协议请求会要求交还电脑。Pi 的标准 `confirm/select/input/editor` 弹窗会转发到手机，第三方自定义终端组件仍需原终端；已经在电脑打开的 Pi 弹窗须先完成再接管。

### 其他已运行会话：终端兼容模式

1. 连接开发机，选择正在运行的 Herdr session。
2. 手机点左上角菜单或底部“会话”，选 workspace / pane。
3. 有精确 session 标识时自动读取 Codex / Claude Code / Pi 的聊天记录。缺少标识时选择对应的原生记录；不会按“最近打开”自动猜。
4. 输入消息，提交到原 pane。桌面也可以用 Ctrl / ⌘ + Enter。
5. 等待确认或需要完整控制时，切到“终端”。Esc、Ctrl C、方向键、Tab、Enter 都有触摸按钮。

兼容模式在 agent 工作中不接受聊天提交，可先等待或中断；审批通过原始终端完成。断网会保留草稿、暂停写入并重连；恢复后由你决定是否发送，不自动重放。

## 多台 remote machine

从 0.2.2-beta.2 起，bridge 会读取同一账号的 `herdr machine list --json`，自动发现并连接启用的 SSH machines，在“开发机”中显示连接、离线、认证和禁用状态。手机只需配对入口 bridge，不必逐台填写远端地址和密钥。新增连接不会切走当前机器，刷新后恢复上次选择。

SSH 使用入口开发机上的 OpenSSH 配置、密钥和 agent；不会把 SSH 凭证发到浏览器。远端需要 **Bun 1.4+**、正在运行且支持 protocol 22 的 Herdr，以及可从 SSH 命令找到的 Herdr CLI。通过 SSH stdin 传入临时 bridge 程序，优先监听远端 `127.0.0.1` 的系统分配端口、建立 SSH TCP 通道并探测就绪；通道失败再尝试 Unix socket 转发。不依赖远端固定的7331端口，不需要提前部署 bridge 或开放公网 Web 端口。不安装远端包、不启动或替换 Herdr、不恢复第二份 agent。SSH 断开后临时 bridge 最迟约 40 秒清理，原生 agent 和 Herdr session 继续运行。

需要认证时，在入口开发机运行页面提示的 `herdr machine reconnect <ID>`。远端 Bun 缺失、session 离线或两种 SSH 通道均不可用时会明确报错，不自动安装、接受新 host key 或修改 sshd 策略。TCP 通道受 `AllowTcpForwarding` / `PermitOpen` 等控制；Unix 回退也受服务端整体转发策略约束，不能保证绕过所有限制。bridge 所在开发机的目录为空时不会跨电脑猜测 profiles；先以启动 bridge 的同一账号检查 `herdr machine list --json`。

Herdr 的 SSH 地址不等于 Web bridge 地址。若远端没有运行 Web bridge，探测 IP 端口也没有可连接的服务，因此自动模式使用上述临时 bridge。已有可直连 bridge 的机器可通过“添加开发机”填写其 URL 和 token；不会猜测端口或将入口 token 发给未知服务。

也可继续在每台开发机独立运行 bridge，并在“添加开发机”手动保存地址和密钥。所有终端、transcript、agent 凭证仍在对应的开发机；当前没有 relay 或 SSH 密钥管理。

如果统一从 A 的 Web 页面访问 B 的 bridge，B 需显式允许 A 的网页 origin：

```bash
MOBILE_HERDR_ORIGINS=https://dev-a.example.com MOBILE_HERDR_HOST=0.0.0.0 bun run start
```

HTTPS 页面应连接 HTTPS / WSS bridge，避免浏览器拦截 mixed content。

## 配置

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `MOBILE_HERDR_HOST` | `127.0.0.1` |
| `MOBILE_HERDR_PORT` | `7331` |
| `MOBILE_HERDR_NAME` | 开发机 hostname |
| `MOBILE_HERDR_TOKEN` | 优先于 token 文件；支持 8–4096 个非空白 ASCII 字符。不设置时读取文件或自动生成 32 字节随机密钥 |
| `MOBILE_HERDR_STATE` | `~/.local/state/mobile-herdr` |
| `MOBILE_HERDR_HERDR_HOME` | `~/.config/herdr`，用于发现 default / named sessions |
| `MOBILE_HERDR_SOCKET` / `HERDR_SOCKET` | 固定使用一个 API socket，覆盖自动发现 |
| `MOBILE_HERDR_SSH_DISCOVERY` | 默认开启；设为 `0` 关闭 Herdr SSH machine 自动发现 |
| `MOBILE_HERDR_SSH_BINARY` | 可选的本地 SSH 可执行文件路径，默认 `ssh` |
| `MOBILE_HERDR_ORIGINS` | 允许的额外浏览器 origins，逗号分隔；默认只允许同源 |
| `CODEX_HOME` | `~/.codex` |
| `CLAUDE_CONFIG_DIR` | `~/.claude` |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` |

浏览器会在当前网站的 localStorage 保存连接凭证与每个 pane 的草稿，以便关闭后快速回到会话；仅在自己的受信任设备上保存。移除开发机会删除该 profile 的密钥；开发机轮换 token 并重启 bridge 可使所有旧凭证失效。当前没有每设备独立撤销。

“开发机 → 连接诊断”可检查页面与 bridge 版本，并复制仅含版本、平台和连接状态的报告。连接心跳和页面返回会重新读取控制权，重连不自动重发写入。诊断只比较当前页面与 bridge，不查询 GitHub 更新。

## 开发与验证

```bash
bun run bridge
# 另一个终端
bun run dev
# Vite 页面访问 bridge 时需配置 MOBILE_HERDR_ORIGINS=http://localhost:5173

bun run typecheck
bun test tests
MOBILE_HERDR_LIVE=1 bun test tests    # 自动创建并清理独立 Herdr session
MOBILE_HERDR_NATIVE_LIVE=1 bun test tests/live-native.test.ts # 本机 Codex / Pi + 本地模拟模型
bun run test:handoff-live            # 独立真实 Herdr 中的 Codex 双向交接
MOBILE_HERDR_SSH_LIVE=1 bun test tests/ssh.test.ts # 临时 sshd / 密钥与 fixture，不使用已有 SSH 主机
bun run build
bun run test:ui                     # 需要 uv、Python 3.12、Chromium
```

浏览器测试覆盖兼容模式和原生接管。原生集成测试使用临时配置和本地模拟模型，不向付费模型发送测试请求；Herdr 测试使用独立 session，均不向你的已有 agent 发送测试任务。手机软键盘和系统后台行为仍需实机验收。

- [详细调研与技术取舍](docs/research.md)
- [移动端设计与验收](docs/design.md)
- [验证结果与已知限制](docs/verification.md)

本项目独立实现，没有复制上述相关产品的源代码。不是 Herdr 官方客户端。
