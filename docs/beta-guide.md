# Mobile Herdr Beta 使用指南

用手机浏览器继续自己开发机上的 Herdr 会话。这个包已包含 Web 页面、bridge、Codex broker 和 Pi 扩展，无需 `bun install` 或构建前端。每位使用者在自己的开发机部署一份；手机只需浏览器。源码与下载包见 [GitHub](https://github.com/wuxiaobai24/mobile-herdr)。

## 一键安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/wuxiaobai24/mobile-herdr/master/install.sh | bash
```

脚本从 GitHub 下载固定测试版本 beta.8 并校验 SHA-256，默认把版本放在 `~/.local/share/mobile-herdr/versions`，命令放在 `~/.local/bin`。安装不需要 sudo；缺少 Bun 时从 bun.sh 官方入口安装 Bun 1.4.0 到 `~/.local/share/mobile-herdr/bun`，不升级系统已有 Bun、不修改 shell 配置。已有 Bun 过旧会提示使用者自行处理。自动安装 Bun 需要 unzip，下载与解压还需要 curl、tar、sha256sum 或 shasum。

安装后可直接运行 `mobile-herdr` 和 `mherdr`；若 PATH 未包含 `~/.local/bin`，先 `export PATH="$HOME/.local/bin:$PATH"`，或使用完整路径。下文的 `./bin/mobile-herdr` 均可替换为 `mobile-herdr`，无需进入安装目录。一键安装已装好 `mherdr`，无需再执行 install-agent；手动解压仍按下文安装。

可先下载阅读脚本，再执行 `bash install.sh --help`。支持 `--version 0.2.2-beta.8`、`--prefix <目录>`、`--bin-dir <目录>` 和 `--no-install-bun`。默认版本随经过验证的发布更新，具体旧版必须已有对应 GitHub Release。脚本保留旧版本、不更改 token、不结束已有进程；重复安装同一个包可安全再次执行。已有同名非本工具命令时拒绝覆盖。

安装只准备文件。确认 Herdr 已运行后，执行 `MOBILE_HERDR_HOST=0.0.0.0 mobile-herdr background`，再用手机可达地址运行 `mobile-herdr pair --url ...`；默认未设置 HOST 时只允许本机访问。首次环境要求、HTTPS 与安全配对说明仍见下文。

## 先确认环境

- 首批已验证目标为 Linux x64。包内是 JS / Web 资源，macOS、Linux ARM64 仍需各自完成验证，暂不作为已验收平台。
- Bun **1.4.0 或更新版本**，安装方法见 [Bun 官方文档](https://bun.sh/docs/installation)。
- 正在运行的 Herdr **0.9.3 / protocol 22**。本程序不会安装、升级、启动或停止 Herdr。
- 使用 Codex / Pi 原生交接时，需先自行安装并登录原 CLI。已验证协议版本为 Codex **0.162.1**、Pi **1.2.0**；其他版本尚未验收。
- 当前提供手机优先 Web 与签名 Android APK，不提供 iOS 安装包。真实手机的键盘、输入法和后台恢复仍需反馈。

## 1. 校验并解压

从邀请人获取同一版本的 `.tar.gz` 与 `.tar.gz.sha256`，放在同一目录：

```bash
sha256sum -c mobile-herdr-0.2.2-beta.8.tar.gz.sha256
# macOS 上校验可用：shasum -a 256 -c mobile-herdr-0.2.2-beta.8.tar.gz.sha256

tar -xzf mobile-herdr-0.2.2-beta.8.tar.gz
cd mobile-herdr-0.2.2-beta.8
./bin/mobile-herdr --version
```

保留整个解压目录；运行中的启动器和后台可能仍引用里面的文件。包附带第三方依赖许可文件，见 `THIRD_PARTY_NOTICES.md` 和 `licenses/`。这是 beta 包，尚未发布到 npm / App Store。

## 2. 启动 bridge，并让手机访问

**局域网快速试用**：在受信任的家庭或工作网络中，让手机和开发机互通：

```bash
MOBILE_HERDR_HOST=0.0.0.0 ./bin/mobile-herdr start
```

首次可用前台观察输出。希望关闭终端后继续运行，先在前台按 Ctrl+C 停止这份 bridge，再从同一目录、使用同一环境启动后台：

```bash
MOBILE_HERDR_HOST=0.0.0.0 ./bin/mobile-herdr background
./bin/mobile-herdr status --json
```

后台沿用相同 token 和 state，日志在该 state 目录的 `bridge.log`。它不会安装系统服务、开机自启或自动重启；电脑重启后须再次启动。命令只管理自己创建的 bridge，不能接管另一份前台进程；端口占用时会提示，不结束占用者。

在另一个终端进入同一解压目录，将地址替换为手机可访问的开发机地址：

```bash
./bin/mobile-herdr pair --url http://192.168.1.8:7331
```

手机扫码并确认连接。不要把二维码和配对链接发给其他人；它们包含本机连接密钥。页面读取后会立即清除 fragment。每位朋友应生成自己的配对凭证，不共用邀请人的开发机密钥。

**公司内网域名**：由部署 agent 配置 Caddy 与公司证书，将 HTTPS 域名反向代理到 `127.0.0.1:7331`，设置同一 HTTPS origin 后用该域名配对。无需 Tailscale。可直接转发 [部署配置说明](deployment.md)，其中包括 Caddy、手机证书信任和 PWA 安装步骤。应用不会自行修改这些部署配置。

HTTPS 下从“更多 → 安装到手机”进入 PWA 安装；普通内网 HTTP 可直接使用 Web 界面，但浏览器通常不允许安装 Service Worker。不要向公网直接暴露未受保护的 HTTP bridge。

第一次启动自动生成 `~/.local/state/mobile-herdr/token`（权限 0600）。也可在连接窗口手动填写地址和该文件中的密钥。默认端口为 7331；如冲突，可设置 `MOBILE_HERDR_PORT=7332`，配对地址也要相应调整。

### 自定义 token

```bash
./bin/mobile-herdr token set       # 隐藏输入，不回显
./bin/mobile-herdr token status    # 仅看配置来源，不打印密钥
# 源码目录对应：bun run token set
```

支持 8–4096 个非空白 ASCII 字符，推荐使用密码管理器生成的随机长串。命令原子保存到当前 state 的 token 文件，权限 0600；输入无效时保留原值。安装脚本和升级不覆盖该文件。自动化可将秘密管理器输出管道接到 `mobile-herdr token set --stdin`；不接受把密钥放在命令参数中。

修改后需停止并重新启动 **Mobile Herdr bridge**，运行 pair 生成新二维码，再更新手机连接；旧 token 随旧 bridge 停止而失效，Herdr 和 agent 无需重启。环境变量 `MOBILE_HERDR_TOKEN` 优先于文件；若要使用保存值，须在启动 bridge 和 pair 前取消原环境变量。手动通过环境变量设置时，两个命令须使用同一值。token 不会热更新，也不会自动同步到其他 bridge。

## 3. 自动连接 Herdr SSH machines

入口 bridge 现在会自动发现同一账号下 Herdr 已保存并启用的 SSH machines。配对入口后，打开“开发机”即可看到远端机器与连接状态；不需要再逐台扫码或手动输入远端 token。

1. 在**运行入口 bridge 的开发机、同一账号**执行 `herdr machine list --json`，确认能看到目标机器。保存在另一台电脑上的 profiles 不会自动同步。
2. 本地需要 OpenSSH；远端需要 Bun 1.4+、已运行的 Herdr protocol 22 session，以及 SSH 能找到的 Herdr CLI。无需在远端安装本项目或开放公网 Web 端口。自动模式优先使用 SSH TCP 转发（远端仅监听127.0.0.1），失败再尝试 Unix socket 转发，至少一种通道须能建立。
3. 机器会自动连接；点击对应行进入，或保持当前机器继续工作。禁用的 profile 不会连接。认证失败时按页面提示在入口开发机运行 `herdr machine reconnect <ID>`，完成后自动重试；不要在手机输入 SSH 密码或私钥。

此路径只在 SSH 内临时执行 bridge，远端操作系统自动分配空闲 loopback 端口，入口经隧道探测服务就绪。无需猜测固定端口，也不要求远端已安装 bridge。读取远端 transcript 与已有原生注册实例，不启动第二份 agent，不启动或重启 Herdr，也不安装远端包。关闭入口或失去 SSH 后临时 bridge 自动清理，Herdr session 与原生 agent 保持运行。草稿按机器、session 和 pane 分开，重连不会自动重发。

远端 Bun 缺失、指定 session 离线或 SSH 转发受限时显示错误。TCP 相关策略包括 `AllowTcpForwarding` / `PermitOpen`，Unix socket 对应 `AllowStreamLocalForwarding`；服务端全局或 key 限制可能同时影响两者，回退不保证绕过限制。程序不修改 sshd 配置；可以在电脑补齐环境后重试，或使用独立 bridge 的手动连接方式。远端若使用自定义 `MOBILE_HERDR_STATE`，须让 SSH 环境提供相同值，才能读取该目录中的原生实例。

远端没有 Web bridge 时，直接扫描 IP 端口不能提供 Web 服务；自动模式已代为临时运行所需 bridge。若用户自行部署了可达 bridge，可用“添加开发机”填写其 HTTP(S) URL 和 token 直连；入口不会向猜测的 IP / 端口发送自己的 token。

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

### 会话快捷选项与 slash

输入框旁的滑杆图标打开快捷选项。原生会话可点“模型”或“思考强度”直接选择，也可输入 `/model`、`/reasoning` 打开列表；`/model <ID>`、`/reasoning <值>` 直接设置。列表来自当前运行实例；工作中暂停修改，先用停止图标或 `/stop` 打断任务。Codex 的选择用于下一次任务。

`/compact` 压缩当前上下文；Codex 还支持 `/plan`、`/build` 和 `/review`。`/search`、`/changes`、`/editor`、`/terminal` 分别打开查找、改动、全屏草稿和同一个 pane 的终端。`/desktop` 交还电脑，`/status`、`/help` 打开快捷面板。输入 `/` 会显示候选；未知原生命令保留草稿并说明限制。

Pi 原生组件可上报当前扩展命令、提示词模板和技能，并在原进程执行。Codex 的普通 TUI 命令不能全部直接当消息发送。旧运行实例未提供的新能力不会显示；不会为了补齐菜单自动重启或替换它。更多边界见 [体验对齐分析](mobile-experience-alignment.md)。

长草稿可从快捷选项展开编辑，收起和 Android 返回仍使用同一份草稿。回复作者行旁的复制图标复制 Markdown 正文。

### 外观和终端浏览

顶栏点“外观”可切换 Catppuccin 四款 / Flexoki 深浅两款主题，调整阅读字体、阅读字号（14–20px）与终端字号（11–17px）。设置保存在当前设备，刷新可恢复，不需要重新连接会话。

终端支持手势翻阅较早输出；也可直接点“历史”，查看 Herdr 保留的最近 2000 行。历史内可查找、前后跳转匹配、回到顶部或底部；选中文字后点“复制所选”，未选择时复制整份已收到的历史。历史不会自动刷新，点“刷新”保留阅读位置，点“返回终端”继续实时操作。普通终端有本地回滚时使用“回到实时”。浏览手势不向原程序发送按键；需要输入时点“键盘”或使用快捷键。全屏程序反复覆盖的画面不一定会保存在 Herdr 历史中。聊天与终端切换会保留当前 pane 的终端连接和阅读位置。

底部固定粘贴、方向键和键盘图标；快捷键可横向滑动。Ctrl / Alt 点亮后只作用于下一次输入，再点可取消。方向面板可以拖动，覆盖在终端之上；面板按键会真实发送给原程序，拖动不会发送输入。粘贴先显示可编辑预览，确认后才发送，并沿用终端的 bracketed-paste 模式。断线或失去输入权时保留粘贴草稿，恢复后仍需手动确认。

### 对话查找、历史与 Diff

对话顶端“更早消息”按页读取精确对应的会话，“上一问”跳回当前阅读位置之前的用户消息。“查找”只搜索**已加载消息**和工具输出；要找更早内容，先加载相应页面。切回对话时恢复本次页面内的阅读位置；页面刷新后草稿仍保留，已加载的旧消息需重新读取。

Codex 新版 broker 可只读查询原 thread 历史；Pi 使用当前运行实例保留的历史（最多 5000 条 / 约 8M 字符），超过范围会提示。已有旧 broker 不会自动升级或迁移，缺少历史能力时沿用已上报内容。要更新原生能力，等任务结束后按下节步骤显式停止并按完整 ID 恢复；仅更新 bridge 不需要停止 Herdr。

聊天里的 diff / patch 代码块、文件工具和 Codex 文件审批共用 Diff 卡片，显示文件名、增删数量、旧 / 新行号与上下文。文件可折叠，长行横向滑动，超过 40 行可逐步展开，右上角复制已收到的补丁。工具只提供旧 / 新片段时，行号从片段起始计算。内容过大或历史保留不全会明确提示；不会从工作目录猜测未上报的改动。

文件审批先看 Diff，再点“允许本次”或“拒绝”；未收到改动内容时暂停允许，可交还电脑查看。命令审批分开显示目录、命令与原因。只支持 provider 提供的审批类型；自定义终端界面仍使用电脑。

断网、静默连接超时或从后台回到页面时，会重新建立连接并读取最新状态与输入权。恢复前暂停写入，草稿保留，不自动重发消息。真实手机可能限制后台网络，恢复时间以设备和浏览器为准。

## 5. 日常停止、升级与回退

- **仅停止 Web bridge**：前台启动在原终端按 Ctrl+C；后台启动用同一 state 下的 `./bin/mobile-herdr stop`，再用 `status` 确认。这不会结束已有 agent，也不会关闭 Herdr；后台命令不停止手动启动的前台 bridge。
- **结束本 pane 的 Codex 后台**：在该 pane 的 shell 中执行 `mherdr stop`。先完成任务并交还电脑；该命令会结束当前原生 agent。Pi 退出原 CLI 即结束实例。
- **升级**：解压新版本到新目录。只更新 Web / bridge 时，停止旧 bridge、从新目录启动并刷新手机，原生 agent 可继续运行。若还需升级 Codex broker / Pi 扩展，先完成任务、交还电脑、退出旧启动器；Codex 后台若仍运行，在同一 pane 用旧 `mherdr stop` 显式结束它。保留旧目录，从新目录重新运行 `install-agent`，最后按完整会话 ID 恢复。不要让新旧两个进程同时恢复一段对话。
- **回退**：按同样步骤结束本次运行实例，停掉新 bridge，从保留的旧目录重新启动并重新安装启动器，再用完整 ID 恢复。不自动修改历史记录格式。
- **保留连接**：升级和回退使用相同 state 目录与 token，手机连接信息可复用。不要把 state 目录复制进发布包。
- **卸载**：结束本工具启动的原生实例、停止 bridge，确认 `~/.local/bin/mherdr` 是本工具安装的脚本后删除它和解压目录。浏览器“开发机”中移除保存的连接。state 中可能还有连接密钥，是否保留由使用者决定；无需删除 Herdr 或 agent 的历史。

一键安装的升级仍运行安装命令；它只切换命令入口，不重启已有进程。旧目录保留在 prefix 的 `versions/` 中，正在运行的 agent 仍可引用它。回退到已发布版本可重跑安装脚本加 `--version <版本>`；也可先停止 bridge，再用保留版本目录中的 `bin/mobile-herdr` 启动。卸载前停止本工具进程，确认命令文件的 Mobile Herdr 标记后删除 `mobile-herdr`、`mherdr` 和 prefix；若 Bun 由本脚本安装，也随 prefix 一起移除。独立 token / state 默认保留。

设置了 `MOBILE_HERDR_STATE` 时，bridge、pair 和 Herdr 中的 `mherdr` 必须使用同一值。

## 6. 帮忙验收与反馈

请至少尝试：扫码连接 → 选择原会话 → 发送一条自己需要的任务 → 手机 / 电脑交接 → 写草稿后刷新 → 断网再恢复。重点反馈真机键盘遮挡、中文输入法、返回键、锁屏和切后台后恢复。

遇到问题先打开“开发机 → 连接诊断”，检查页面与 bridge 版本是否一致，复制报告用于反馈。该报告采用字段白名单，仅含版本、平台、连接状态与数量，不含地址、路径、会话标识、密钥或正文；不向外部上传，也不查询 GitHub 是否有新版。另附手机型号、浏览器及复现步骤即可。

电脑上也可运行 `mherdr --version`、`mherdr doctor --json`、`mherdr status --json` 和后台 bridge 的 `./bin/mobile-herdr status --json`。这些 CLI 输出与本机 `bridge.log` 可能包含路径、地址或会话 ID，分享前自行脱敏。不要发送 token、配对二维码、完整聊天记录或未脱敏的截图。

当前边界：没有每设备独立撤销；浏览器保存连接凭证与草稿。历史受 provider 与 Herdr 保留范围限制，不承诺恢复所有历史；搜索不扫描尚未加载内容。附件上传、推送、relay、文件编辑工作台、开机自启和 iOS 安装包未交付；Android 提供签名 APK。初期建议 2–5 位朋友，每人部署自己的开发机，不共享可控制终端的凭证。

### 浏览与下载项目文件

手机点“更多 → 浏览项目文件”，桌面点顶部文件夹，或在输入框执行 `/files`。目录跟随所选开发机、session 和 pane 的 `foreground_cwd` / `cwd`；本机与 Herdr SSH 机器使用相同入口。点目录进入，点文件预览，右侧下载图标可直接保存。

文本、代码和 Markdown 按原文预览（前 256 KB），PNG / JPEG / GIF / WebP 支持 8 MB 内预览。其他格式可下载后打开；单文件下载上限 100 MB。Web 使用浏览器下载；Android 下载完成后弹出系统“另存为”，可选择位置或取消。文件列表可筛选当前已加载的目录，超出 1000 项会提示进入子目录。

文件浏览只读，不能编辑、删除或上传。路径不能越过项目根目录，指向外部的符号链接显示为不可访问；会话报告的目录发生变化后，需重新打开项目目录。连接凭证仅放在请求头中，下载链接不含 token。

版本更新针对 Web Bridge，Android APK 另从发布页下载安装。检查失败可点击刷新重试；上次更新失败或中断不会永久卡在“更新中”。后台更新以实际运行版本判断目标，工作区源码版本不同也能升级。公开更新只安装已有完整 GitHub 发布包，本地未发布的改动不会自动出现在公开更新中。
