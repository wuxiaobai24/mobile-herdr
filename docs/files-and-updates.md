# 项目文件与更新修复

手机从“更多 → 浏览项目文件”或 `/files` 进入，桌面使用顶部文件夹。沿用现有主题与全屏工具页；56px 顶栏、52px 文件行，目录切换和下载紧挨对应对象，不增加常驻手机工具栏。文件名是主信息，体积、来源和路径为次信息。长目录按需渲染，按钮提供按压底色，目录页和更新面板沿用 Modal 转场，读取与下载显示旋转状态；录屏在 `artifacts/files-update/ui/video/`。没有新增装饰卡片或重复解释文字，更新说明压缩为一行用途及必要的平台差异。

文件根目录以所选 pane 的 `foreground_cwd ?? cwd` 为准，每次读取重新核对所选 session / pane。后续请求携带已确认根目录，避免 cwd 改变后静默切到另一个项目。路径、外部符号链接与特殊文件受限，下载只输出 attachment；不会执行 HTML / SVG。文本最多预览256 KB，图片最多8 MB，下载上限100 MB，目录最多1000项并明确提示。SSH 使用带鉴权的流式转发，token 不进入 URL。文件浏览只读，不向 Herdr / provider 发送输入。

Web 使用带请求头的 fetch 与 Blob 下载。Android 先下载到私有缓存，再使用系统 CREATE_DOCUMENT 选择保存位置，按64 KB写入文件描述符，最后清理缓存；取消保存返回原预览。不申请广泛存储权限。`expo-intent-launcher@58.0.3` 原生返回值将 `Intent.toString()` 当作 URI，已在 `patches/` 固定为读取 `Intent.data`，由 Bun patchedDependencies 自动应用，Android autolinking 对此模块强制源码编译，避免使用未修复的预编译 AAR。系统文档 URI 直接写入，避免文件复制 API 的路径与覆盖语义。

更新失败的现场记录显示：运行中的 Bridge 为 beta.6，工作区源码为 beta.7；独立更新进程错误地以自身源码版本比较最新 beta.7，提前退出。修复后核对受管理运行实例的版本与身份，再选择相同通道的完整发布包。旧的 ready / failed 状态不会遮挡新版本，失踪的更新进程能退出忙碌态。页面区分检查失败与提交失败，轮询不会立刻抹掉提交错误；不确定投递的主动重试沿用请求 ID。SSH 页面更新明确作用于入口 Bridge，Android APK 与 Bridge 更新分开。

验证记录见 [verification.md](verification.md)。一轮独立静态视觉评审为8/10，未发现窄屏、短视口的布局阻断；评分对交互动效保留意见，完整报告在 `artifacts/files-update/visual-review.md`。自动化录屏提供了流程证据，不能代替实体设备的键盘、系统后台与省电验收。

这些功能随 0.2.2-beta.8 分发；公开更新只安装已发布的版本。发布本身不会重启或升级用户当前的 Bridge、Herdr 或 agent。
