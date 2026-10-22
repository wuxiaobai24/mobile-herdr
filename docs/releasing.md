# Beta 发布流程

当前版本：**0.2.2-beta.5**。源码公开，运行包以 GitHub prerelease 分发；每人自行部署自己的开发机。仍先以少量朋友验收真实设备行为，不需要公共 bridge、账号系统或手机应用商店。

## 交付物

在源码目录安装依赖一次后执行：

```bash
bun install --frozen-lockfile
bun run typecheck
bun test tests
bun run test:release
bun run test:ui
```

`test:release` 会构建 Web、生成运行包、解压到临时目录，再从包目录以外启动验证。它只使用隔离 fixture 和本地协议替身，不向用户的 Herdr / CLI 会话提交任务。它也不会重新安装这台机器已有的 `mherdr`。

beta.4 增加终端 / 对话阅读工具、文件 Diff、连接心跳恢复、脱敏诊断与可控后台 bridge。运行包支持 `./bin/mobile-herdr background|status|stop`，源码对应 `bun run service start|status|stop`；打包测试也检查后台启动、状态与停止不会影响另一份前台 fixture。后台为用户进程，不安装 systemd / launchd 或开机自启。

beta.5 增加根目录 `install.sh` 和 `token set [--stdin] | status`。打包检查通过本地下载替身执行真实安装脚本，覆盖带空格 / 单引号路径、首次与重复安装、SHA-256 错误、已有同名命令、下载失败、缺少 Bun 时独立安装；并检查保存的自定义 token 实际用于 HTTP 鉴权与配对。测试不会往真实 HOME 安装软件，也不会修改本机已有命令。

产物位于 `artifacts/releases/`：

- `mobile-herdr-0.2.2-beta.5.tar.gz`：预构建 Web、bundled bridge / 启动器 / Codex host / Pi 扩展、命令入口、内测指南、第三方许可文件。
- 同名 `.tar.gz.sha256`：压缩包 SHA-256。
- 同名 `.tar.gz.verification.json`：本机验证的平台、版本、包摘要和实际通过项目。它是**打包冒烟测试**，不等同于真实 Herdr、真实 provider、真机或跨平台认证。

`release.json` 记录版本、构建 Bun、构建时间、源码 HEAD 和 dirty 标识。打包使用显式入口清单，静态资源来自重新构建的 `dist/`，不复制 `.env`、本机 token、聊天记录、测试 fixture 或用户 state；第三方依赖只附带许可文件，运行包无需安装 node_modules。

构建使用 [Bun bundler](https://bun.sh/docs/bundler)；保持现有相对入口路径，将运行依赖打进 JS 包。Pi 扩展以 Node 目标构建。选择此方式是为了保留 Bun PTY、独立 Codex host 和 Pi 进程内加载的现有语义；当前不做单个本地可执行文件或 Docker 镜像。朋友仍须自己安装 Bun 与 Herdr。0.2.2-beta.5 另附 `server/ssh-worker.bundle.js`，供 SSH stdin 临时执行；远端无需安装本项目，但需 Bun。打包冒烟测试显式关闭真实机器发现，避免读取或连接测试者的 SSH hosts。

## 发出前

1. 完成本次代码提交，确认改动都在预期范围内。建议从 clean checkout 重新执行上面的验证，使 `release.json.sourceDirty` 为 false，明确关联提交；当前准备阶段的 dirty 包应标注为候选快照。
2. 核对 `.verification.json` 的摘要和 `.sha256` 对应同一个文件。若重新打包，须重新验证；旧验证报告会在打包时删除。
3. 当前仅本机 Linux x64 已验证。收到 macOS / ARM64 使用请求时，先在对应环境按指南完成冒烟、原生交接与浏览器测试，再增加已验收声明。
4. 在真实手机上检查键盘 / 中文输入法、横屏、锁屏、后台恢复。现有 Chromium 移动视口不能替代这些验收；邀请中明确仍需反馈。
5. 若有安装的 Codex / Pi 和 Herdr，可额外跑下列隔离集成测试：

   ```bash
   MOBILE_HERDR_LIVE=1 MOBILE_HERDR_NATIVE_LIVE=1 bun test tests
   bun run test:handoff-live
   MOBILE_HERDR_SSH_LIVE=1 bun test tests/ssh.test.ts
   ```

   这些测试自己创建并清理 session、临时配置和本地模拟模型；不要为测试重启或升级用户已有 Herdr。普通默认测试不会自动开启这些检查。

## 怎么交给朋友

通过你们已有的私人文件渠道发送 **tar.gz + sha256 + 内测指南链接或文件**；可以另附验证报告和 `docs/beta-invitation.md` 的邀请文字。不要把本机配对二维码、token、机器 state 或聊天截图当作安装配置发出。每位朋友扫码连接自己的开发机。

源码仓库 [wuxiaobai24/mobile-herdr](https://github.com/wuxiaobai24/mobile-herdr) 公开。提交并推送候选代码，从 clean HEAD 重新打包，以 `v<package.json.version>` 创建 **prerelease**，上传 tar.gz、sha256、verification.json 和安装脚本。不得把 dirty 快照当作来源明确的发布。一键安装的默认 VERSION 须与已验证的 release tag 相同；它使用明确 tag 的下载地址，能安装 prerelease，不依赖 GitHub 的 stable latest 规则。先上传草稿资产再发布，完成后用匿名下载执行隔离安装，确认别人无需登录。

`package.json.private` 保持 true，用于防止误发布 npm，与 GitHub 仓库可见性无关。源码公开不代表已经选择项目开源许可证；项目许可证另行决定。第三方依赖和主题许可随包保留。

## 收集问题与下一版

统一收集：包版本、源码提交（release.json）、系统与架构、Bun / Herdr / CLI 版本、手机与浏览器、复现步骤、预期与实际结果。问题优先级为投递 / 控制权错误和草稿丢失，其次连接恢复，再是布局。

首轮达到“朋友可独立安装、手机稳定连接、原会话双向交接、失败不丢草稿”后，再扩大范围。新版本修改 `package.json.version`，同步内测指南中的文件名及邀请；按完整验证重新生成新包。用户升级、回退与卸载操作见 [内测指南](beta-guide.md)，不会自动修改 Herdr、CLI 或历史记录。
