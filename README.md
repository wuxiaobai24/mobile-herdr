# Mobile Herdr

从手机浏览器继续开发机上已经运行的 Herdr agent。复用同一个 session、同一个 pane 和同一个 agent 进程。

移动 Web 支持 Codex / Pi 原生 Chat 与电脑终端之间交接控制权，以及原始终端、多开发机、草稿恢复和断网重连。保留 Expo 代码结构供以后做原生端，**本次不交付原生安装包**。

## 启动

需要 **Bun 1.4+、Herdr 0.9.3 / protocol 22、Linux 或 macOS**。先在开发机启动原来的 Herdr。Bridge 不会替你重启 Herdr。

```bash
bun install
bun run start
```

开发机浏览器打开 http://127.0.0.1:7331。默认只监听 loopback。

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

每台开发机分别运行一个 bridge；在“开发机 → 添加开发机”里保存它的可达地址与密钥。所有终端、transcript、agent 凭证仍在对应的开发机。当前不自动导入 Herdr 的 SSH profiles，也不提供 relay 或 SSH 密钥管理。

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
| `MOBILE_HERDR_TOKEN` | 不设置时自动生成 32 字节随机密钥并写入 token 文件；手动设置至少 24 字符 |
| `MOBILE_HERDR_STATE` | `~/.local/state/mobile-herdr` |
| `MOBILE_HERDR_HERDR_HOME` | `~/.config/herdr`，用于发现 default / named sessions |
| `MOBILE_HERDR_SOCKET` / `HERDR_SOCKET` | 固定使用一个 API socket，覆盖自动发现 |
| `MOBILE_HERDR_ORIGINS` | 允许的额外浏览器 origins，逗号分隔；默认只允许同源 |
| `CODEX_HOME` | `~/.codex` |
| `CLAUDE_CONFIG_DIR` | `~/.claude` |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` |

浏览器会在当前网站的 localStorage 保存连接凭证与每个 pane 的草稿，以便关闭后快速回到会话；仅在自己的受信任设备上保存。移除开发机会删除该 profile 的密钥；开发机轮换 token 并重启 bridge 可使所有旧凭证失效。当前没有每设备独立撤销。

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
bun run build
bun run test:ui                     # 需要 uv、Python 3.12、Chromium
```

浏览器测试覆盖兼容模式和原生接管。原生集成测试使用临时配置和本地模拟模型，不向付费模型发送测试请求；Herdr 测试使用独立 session，均不向你的已有 agent 发送测试任务。手机软键盘和系统后台行为仍需实机验收。

- [详细调研与技术取舍](docs/research.md)
- [移动端设计与验收](docs/design.md)
- [验证结果与已知限制](docs/verification.md)

本项目独立实现，没有复制上述相关产品的源代码。不是 Herdr 官方客户端。
