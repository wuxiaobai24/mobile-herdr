# Android 客户端

Android 使用 Expo / React Native，Web 继续通过 Vite / React Native Web 构建。两端共用主页面、会话列表、输入框、接管/交还、审批、Diff、主题和协议。不要复制一套 Android 页面：新增通用 UI 优先放在现有 `app/components`，只把平台能力放进平台文件。

| 共享内容 | 平台适配 |
| --- | --- |
| `app/App.tsx`、Composer、Conversation、NativeSession、NativeRequests、DiffView | `.web.ts(x)` 由 Vite 优先解析；Android 由 Metro 使用 `.tsx` / `.ts` |
| `shared/client.ts`、protocol、native、diff、themes、pairing | 存储、网络、扫码、剪贴板、生命周期、Markdown 渲染、终端容器 |
| 主题、字号、间距、按钮、消息与审批卡片 | Web 用 DOM Markdown / iframe；Android 用 Text / View Markdown 和独立 WebView 终端 |

## 本地构建 APK

安装与 Expo SDK 匹配的 Android SDK、NDK 和 JDK（建议 JDK 21），配置 `ANDROID_HOME` 和 `JAVA_HOME`，然后运行：

```bash
bun install
bun run build:android
```

脚本通过 Expo Prebuild 生成忽略版本控制的 `android/`，再构建内置 JS / Hermes 字节码的 release APK。安装运行不需要 Expo Go、Metro 或 Expo 账号。默认包含 arm64-v8a 和 x86_64；可以通过 `MOBILE_HERDR_ANDROID_ABIS=arm64-v8a` 只打手机架构。

产物是 `artifacts/android/mobile-herdr.apk` 和 `.sha256`。签名密钥自动创建于 `${XDG_STATE_HOME:-~/.local/state}/mobile-herdr/android-signing/`（目录 0700，密钥与密码文件 0600）；可用 `MOBILE_HERDR_ANDROID_SIGNING_DIR` 指定另一个私有目录。密钥和密码不写进仓库或命令参数。后续构建复用同一密钥；发布新版时增加 `app.json` 的 Android `versionCode`，备份密钥和密码后才能持续覆盖升级。换密钥需要卸载旧包，会丢失本机连接和草稿。

`bun run android` 用于本地开发构建。原生依赖或配置变化后重新构建；普通共享 UI 的 JS 修改可以使用 development build + Metro 调试。不要将 debug APK 当作 release 交付。

## 连接与使用

手机需要能访问开发机的现有 Mobile Herdr bridge（局域网、VPN 或 HTTPS 地址）。直接复用现有 bridge、SSH machine 发现和 Herdr 会话，不在手机启动另一份 agent。

1. 安装 APK，点击「扫描配对二维码」。开发机运行现有 `mobile-herdr pair --url http://开发机地址:7331`，扫描同一个 Web 配对码。
2. 核对地址和名称后点「连接开发机」。相机权限被拒绝时也可以手动填写地址与 token。
3. 也可生成应用专用链接：`bun run pair --url http://开发机地址:7331 --android`。`mobile-herdr://pair#connect=…` 在冷启动和运行中的 App 都会打开确认表单；不会自动连接、发送或接管。
4. 选择原会话，在手机继续；操作规则与 Web 一致。返回键先由系统关闭键盘，之后关闭弹窗/会话抽屉、退出阅读工具或从终端回到聊天。

凭证保存在 SecureStore；草稿、设置、发送回执和最近位置保存在应用私有 SQLite，按机器、session、pane 和对话身份隔离。旧原生起点使用 SecureStore 保存的草稿会按需迁移；长草稿不再被静默截断。应用禁用 Android Auto Backup；卸载后需重新配对。

前台使用 HTTP Bearer 与 WebSocket 首帧鉴权，token 不进入 HTTP 查询或 WebSocket URL。HTTP 局域网连接沿用已有 bridge 能力；跨不可信网络请使用 HTTPS / VPN。终端 WebView 只允许选定 bridge 的终端页，跳转受限制，复制和粘贴读取通过原生剪贴板完成；读取先进入预览，显式确认后才写入终端。

切到后台会暂停实时连接、保存草稿；回来后读取最新会话与输入权，再允许发送。开发机 agent 始终独立运行。断网或请求回执不明时保留草稿和 request ID，不自动重放写入。不提供后台常驻 WebSocket 或后台推送；通知需要单独设计服务端事件订阅和设备授权。

## 验证

```bash
bun run typecheck
bun test tests
bun run build
bun run test:ui
# 先启动专用 Android 模拟器；不要指定个人真机。
MOBILE_HERDR_ANDROID_SERIAL=emulator-5580 bun run test:android
```

Android 检查会安装 APK、清空专用模拟器中的本应用数据、通过 adb reverse 访问测试创建的 bridge。Herdr API 使用隔离 Unix socket，Codex 使用本地协议替身；测试关闭时清理 fixture，不重启或写入用户已有 Herdr / agent。Python UI 自动化由 uv 提供，证据位于 `artifacts/android/ui/`。

终端控件使用本次测试创建的 VT WebSocket peer，验证实际 WebView 的方向键、剪贴板预览和 bracketed paste；不将该 fixture 描述为真实 Herdr PTY。真实 PTY 路径另由隔离 Herdr 的浏览器检查验证。模型、思考强度、slash 和全屏草稿共用 Web 代码，并在独立 APK 中验证。

模拟器检查不等于真机验收。发布给更多用户前还需验证实体 Android 的中文输入法、系统键盘/返回手势、扫码、锁屏、长时间后台与厂商省电策略。当前不交付 iOS 安装包。

## 当前验收记录

2026-10-23：提交前已重建本地签名 release APK，并通过 Android 15 模拟器 19 项完整流程检查；Web 149 项回归、类型检查和 47 项单测通过（6 项环境相关测试未在该轮启用）。详见 [验证结果](verification.md#android-独立客户端2026-10-23)。最低系统声明为 Android 7（API 24），该最低版本及实体手机尚未验收。

视觉方向沿用现有应用：同一套主题、阅读设置、页面结构、输入框、消息、审批和 Diff 卡片。新增扫码入口只出现在 Android 配对表单，交互沿用共享按钮和弹窗；弹窗的 slide / fade 和既有 Web 动效保持原有用途。本轮主 Agent 复看原生配对、键盘、审批、主题和终端截图，未做独立视觉评审。键盘避让与原生测量单独适配；搜索只执行一次定位，后续键盘 / 新消息布局不会把阅读位置拉回旧目标。

终端 WebView 从选定 bridge 加载页面，因此终端原生复制和显式暂停需要包含本轮 `terminal.js` 适配的 bridge；不需要重启或迁移 Herdr / agent。


本轮手机控制优化的最终验收：同签名release APK在专用`emulator-5582`上25项通过；Web三轮各180项通过，完整隔离测试61项通过、0跳过。覆盖新增slash、模型 / 强度、全屏编辑，以及真实WebView内的方向键和显式粘贴。模拟器已在测试完成后关闭，实体手机边界不变；详见[本轮验证记录](verification.md#手机终端slash-与会话控制优化2026-10-23)。

项目文件下载使用系统 CREATE_DOCUMENT 保存位置选择器，再从私有缓存分块写入文档 URI；取消保存不会切换会话。依赖 `expo-file-system` 与 `expo-intent-launcher`。后者58.0.3的原生 URI 返回错误通过 `patches/expo-intent-launcher@58.0.3.patch` 固定，`bun install` 自动应用，package.json 的 Android autolinking 为此模块启用 buildFromSource；不要只复制 node_modules 中的修改。变更后须重建签名 release APK，并在专用模拟器核对目标文件的实际字节与取消返回，不能只看选择器关闭或打包成功。
