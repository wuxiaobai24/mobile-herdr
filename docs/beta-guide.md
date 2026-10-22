# Mobile Herdr 私人内测指南

用手机浏览器继续自己开发机上的 Herdr 会话。这个包已包含 Web 页面、bridge、Codex broker 和 Pi 扩展，无需 `bun install` 或构建前端。每位使用者在自己的开发机部署一份；手机只需浏览器。

## 先确认环境

- 首批已验证目标为 Linux x64。包内是 JS / Web 资源，macOS、Linux ARM64 仍需各自完成验证，暂不作为已验收平台。
- Bun **1.4.0 或更新版本**，安装方法见 [Bun 官方文档](https://bun.sh/docs/installation)。
- 正在运行的 Herdr **0.9.3 / protocol 22**。本程序不会安装、升级、启动或停止 Herdr。
- 使用 Codex / Pi 原生交接时，需先自行安装并登录原 CLI。已验证协议版本为 Codex **0.162.1**、Pi **1.2.0**；其他版本尚未验收。
- 当前是手机优先 Web 内测，不提供 iOS / Android 安装包。真实手机的键盘、输入法和后台恢复仍需反馈。

## 1. 校验并解压

从邀请人获取同一版本的 `.tar.gz` 与 `.tar.gz.sha256`，放在同一目录：

```bash
sha256sum -c mobile-herdr-0.2.2-beta.2.tar.gz.sha256
# macOS 上校验可用：shasum -a 256 -c mobile-herdr-0.2.2-beta.2.tar.gz.sha256

tar -xzf mobile-herdr-0.2.2-beta.2.tar.gz
cd mobile-herdr-0.2.2-beta.2
./bin/mobile-herdr --version
```

保留整个解压目录；运行中的启动器和后台可能仍引用里面的文件。包附带第三方依赖许可文件，见 `THIRD_PARTY_NOTICES.md` 和 `licenses/`。这是一份私人内测包，尚未发布到 npm / App Store。

## 2. 启动 bridge，并让手机访问

**局域网快速试用**：在受信任的家庭或工作网络中，让手机和开发机互通：

```bash
MOBILE_HERDR_HOST=0.0.0.0 ./bin/mobile-herdr start
```

在另一个终端进入同一解压目录，将地址替换为手机可访问的开发机地址：

```bash
./bin/mobile-herdr pair --url http://192.168.1.8:7331
```

手机扫码并确认连接。不要把二维码和配对链接发给其他人；它们包含本机连接密钥。页面读取后会立即清除 fragment。每位朋友应生成自己的配对凭证，不共用邀请人的开发机密钥。

**已有 Tailscale 的使用者**：开发机和手机登录自己的 tailnet。先为 loopback 上的 bridge 准备 HTTPS 入口：

```bash
# 先按 Tailscale 提示启用 HTTPS；此命令会改变自己的 Serve 配置。
tailscale serve --bg http://127.0.0.1:7331
tailscale serve status
# 把下面的域名替换为 status 显示的实际 HTTPS 地址（末尾不加 /）。
MOBILE_HERDR_ORIGINS=https://你的开发机.tailnet名称.ts.net ./bin/mobile-herdr start
```

在另一个终端进入解压目录，运行 `./bin/mobile-herdr pair --url https://你的开发机.tailnet名称.ts.net`。具体开关与访问策略见 [Tailscale Serve 官方说明](https://tailscale.com/docs/reference/tailscale-cli/serve)。配置 `MOBILE_HERDR_ORIGINS` 用于允许 HTTPS 页面经本地代理访问 bridge；本包不自动配置 Tailscale、反向代理或防火墙。

HTTPS 下可通过浏览器菜单添加到主屏幕。普通局域网 HTTP 可以使用界面，但通常不能安装 service worker。无需向公网暴露 7331 端口。

第一次启动自动生成 `~/.local/state/mobile-herdr/token`（权限 0600）。也可在连接窗口手动填写地址和该文件中的密钥。默认端口为 7331；如冲突，可设置 `MOBILE_HERDR_PORT=7332`，配对地址也要相应调整。手动通过环境变量设置 token 时，bridge 与 pair 须使用相同环境。

## 3. 自动连接 Herdr SSH machines

入口 bridge 现在会自动发现同一账号下 Herdr 已保存并启用的 SSH machines。配对入口后，打开“开发机”即可看到远端机器与连接状态；不需要再逐台扫码或手动输入远端 token。

1. 在**运行入口 bridge 的开发机、同一账号**执行 `herdr machine list --json`，确认能看到目标机器。保存在另一台电脑上的 profiles 不会自动同步。
2. 本地需要 OpenSSH；远端需要 Bun 1.4+、已运行的 Herdr protocol 22 session，以及 SSH 能找到的 Herdr CLI。无需在远端安装本项目或开放 Web 端口，但 SSH 服务须允许 Unix socket 转发。
3. 机器会自动连接；点击对应行进入，或保持当前机器继续工作。禁用的 profile 不会连接。认证失败时按页面提示在入口开发机运行 `herdr machine reconnect <ID>`，完成后自动重试；不要在手机输入 SSH 密码或私钥。

此路径只在 SSH 内临时执行 bridge，读取远端 transcript 与已有原生注册实例，不启动第二份 agent，不启动或重启 Herdr，也不安装远端包。关闭入口或失去 SSH 后临时 bridge 自动清理，Herdr session 与原生 agent 保持运行。草稿按机器、session 和 pane 分开，重连不会自动重发。

远端 Bun 缺失、指定 session 离线或 SSH 转发受限时显示错误；可以在电脑补齐环境后重试，或继续使用独立 bridge 的手动连接方式。远端若使用自定义 `MOBILE_HERDR_STATE`，须让 SSH 环境提供相同值，才能读取该目录中的原生实例。

## 4. 继续现有会话

打开会话列表，选择原有 session、工作区和 pane。普通会话可查看聊天记录及原始终端；缺少 transcript 身份时需要明确选择记录，不按最近修改时间猜测。聊天记录无法识别时，可先使用“终端”。

启用 Codex / Pi 手机原生交接，先安装独立启动命令：

```bash
./bin/mobile-herdr install-agent
# 默认写入 ~/.local/bin/mherdr；若不在 PATH 中，使用完整路径。
# 可自定义：./bin/mobile-herdr install-agent --bin-dir "$HOME/bin"
```

安装不会修改 shell 配置，也不会替换 `codex` / `pi` 命令。之后在 **Herdr 空闲终端**中运行：

```bash
mherdr codex
# 或
mherdr pi
```

手机点击“在手机继续”；回电脑按 **Ctrl+]**，或手机点击“交还电脑”。两端使用同一个运行实例，只有一端拥有输入权。

已有普通 CLI 会话不会自动迁移。等当前任务完成、退出旧 CLI 后，用完整会话身份恢复：

```bash
mherdr codex resume <完整会话-ID>
mherdr pi --session <完整会话-ID或路径>
```

Codex 暂不支持 `--profile` / `--worktree`、最近会话选择器；可使用受支持的 `-c` 配置。特殊审批或 Pi 自定义终端组件仍需要电脑原界面。刷新、断网和关闭手机页面不会停止 agent；草稿保留，恢复后不会自动重发消息。

## 5. 日常停止、升级与回退

- **仅停止 Web bridge**：在启动 bridge 的终端按 Ctrl+C。这不会结束已有 agent，也不会关闭 Herdr。当前先使用前台启动，不自动安装系统后台服务。
- **结束本 pane 的 Codex 后台**：在该 pane 的 shell 中执行 `mherdr stop`。先完成任务并交还电脑；该命令会结束当前原生 agent。Pi 退出原 CLI 即结束实例。
- **升级**：解压新版本到新目录；先完成任务、交还电脑、退出旧启动器。Codex 后台若仍运行，在同一 pane 用旧 `mherdr stop` 显式结束它。停止旧 bridge，保留旧目录，从新目录启动 bridge 并重新运行 `install-agent`；最后按完整会话 ID 恢复。不要让新旧两个进程同时恢复一段对话。
- **回退**：按同样步骤结束本次运行实例，停掉新 bridge，从保留的旧目录重新启动并重新安装启动器，再用完整 ID 恢复。不自动修改历史记录格式。
- **保留连接**：升级和回退使用相同 state 目录与 token，手机连接信息可复用。不要把 state 目录复制进发布包。
- **卸载**：结束本工具启动的原生实例、停止 bridge，确认 `~/.local/bin/mherdr` 是本工具安装的脚本后删除它和解压目录。浏览器“开发机”中移除保存的连接。state 中可能还有连接密钥，是否保留由使用者决定；无需删除 Herdr 或 agent 的历史。

设置了 `MOBILE_HERDR_STATE` 时，bridge、pair 和 Herdr 中的 `mherdr` 必须使用同一值。

## 6. 帮忙验收与反馈

请至少尝试：扫码连接 → 选择原会话 → 发送一条自己需要的任务 → 手机 / 电脑交接 → 写草稿后刷新 → 断网再恢复。重点反馈真机键盘遮挡、中文输入法、返回键、锁屏和切后台后恢复。

遇到问题可运行 `mherdr --version`、`mherdr doctor --json`、`mherdr status --json`。反馈时提供包版本、系统 / 架构、Bun / Herdr / CLI 版本、手机型号与浏览器、复现步骤及可脱敏的错误。诊断虽不输出正文或密钥，仍可能有机器路径和会话 ID；分享前自行查看。不要发送 token、配对二维码、完整聊天记录或未脱敏的截图。

当前边界：没有每设备独立撤销；浏览器保存连接凭证与草稿。长对话只显示最近部分，尚无全量历史分页；附件、推送、relay、文件工作台和原生安装包未交付。初期建议 2–5 位朋友，每人部署自己的开发机，不共享可控制终端的凭证。
