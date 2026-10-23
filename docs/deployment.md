# 给部署 agent 的配置说明

Web bridge 不管理公司域名、TLS 证书、Caddy、Tailscale 或防火墙。以下配置由部署 agent 按公司环境完成；没有 Tailscale 也可使用。

## 公司内网域名与 HTTPS

让手机能解析并访问开发机的内网域名，例如 `herdr.dev.example.internal`。开发机已有 Herdr 时，构建并以后台服务方式启动 **Mobile Herdr bridge**：

```bash
bun run build
MOBILE_HERDR_HOST=127.0.0.1 \
MOBILE_HERDR_PORT=7331 \
MOBILE_HERDR_ORIGINS=https://herdr.dev.example.internal \
bun run service start
```

发布包安装可将最后一行替换为 `mobile-herdr background`。此服务管理方式支持页面内一键更新；不要另外启动同端口的前台 bridge。原 Herdr 与 agent 无需重启。状态目录默认 `~/.local/state/mobile-herdr`，自定义时为启动、配对和后续管理设置相同的 `MOBILE_HERDR_STATE`。

Caddy 使用公司签发的证书和私钥：

```caddyfile
herdr.dev.example.internal {
    tls /path/to/company-fullchain.pem /path/to/company-key.pem
    reverse_proxy 127.0.0.1:7331
}
```

证书须匹配域名，并由手机信任的 CA 签发。若公司允许 Caddy 本地 CA，可把 `tls ...` 改为 `tls internal`，再由部署 agent 将该 CA 根证书安装并设为手机信任；开发机信任不代表手机自动信任。Caddy 的 `reverse_proxy` 支持 WebSocket 升级。详见 [Caddy TLS 文档](https://caddyserver.com/docs/caddyfile/directives/tls) 与 [反向代理文档](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。

通过 HTTPS 域名配对：

```bash
bun run pair --url https://herdr.dev.example.internal
# 发布包：mobile-herdr pair --url https://herdr.dev.example.internal
```

不要把连接密钥写入 Caddyfile、查询参数或共享日志。代理访问日志应避免记录 Authorization；配对二维码和连接密钥仅交给使用者。

## PWA

在手机浏览器打开该 HTTPS 域名，使用「更多 → 安装到手机」。Android 支持浏览器提供的安装提示；iPhone / iPad 使用 Safari「分享 → 添加到主屏幕」。可信 HTTPS 是 PWA 安装与 Service Worker 的前提，详见 [MDN 安装要求](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)。

应用缓存仅包含公共界面和图标，不缓存 API、会话、凭证响应或写操作。断网后能打开外壳；草稿保存在设备上，重新连接并确认会话后继续编辑，不自动重发。更换 HTTPS 域名会改变浏览器存储来源，需要重新连接。

## 一键接管与更新

普通 Pi / Codex 会话：手机「更多 → 启用手机接管 → 启用并接管」。任务运行时等待，支持取消。Pi 在原进程加载托管个人扩展并执行 `/reload`；禁用扩展的 Pi 无法热接入。Codex 首次自动退出空闲界面、确认原 CLI 已退出并恢复准确 ID。优先使用 Herdr 上报或原进程打开的 rollout 文件确认身份；默认 daemon 模式可向原 CLI 请求 `/status`，再验证该 ID 已在原 daemon 中加载，不按目录选最近记录。无法确认唯一身份时保留原 CLI，不猜测。自动接入当前只验证 Linux `/proc` 环境；已接入的会话仍使用跨平台原生协议。

通过 Herdr SSH machine 连接时，接管组件自动随加密 SSH 通道传至远端私有缓存，保留旧版本供已有 agent 使用，不要求用户手动安装远端 mherdr。

已接入后，手机点「终端」交还输入权，点「对话」重新接管；电脑按 `Ctrl+]` 接回。另一台手机不能抢占。Codex 首次重连终端：默认 daemon 通过官方 proxy 复用原执行后端；内嵌模式先退出原进程再恢复准确 ID。后续切换不重启，Pi 首次也保留进程。自定义 Codex profile、远程 CLI 以及缺少共享连接支持的旧版本会在退出前拒绝接入。

「更多 → 版本更新」查询 GitHub Releases，beta 跟踪 beta / stable，stable 仅跟踪 stable。发布包需包含 tar.gz 与 SHA-256；下载失败或校验失败保留旧版本，新 bridge 启动检查失败自动回滚。只重启此工具创建、通过私有控制 socket 确认身份的 bridge，保留 token、启动地址、原生 broker、Pi 进程及旧版本目录。未由 `background` / `service start` 管理的 bridge 会说明原因，不按 PID 强行停止。

CLI 同样支持 `mobile-herdr update`、`mherdr update`，查询结果用 `mobile-herdr update --check`。自定义安装目录沿用安装元数据。源码运行时将发布包安装至独立运行目录，不覆盖源码工作区。公司网络须允许访问 GitHub API、release 文件及其下载重定向地址。更新只切换 Web bridge，已运行的 agent 使用原版本适配器，等任务完成后再按需要退出并启动新适配器。
