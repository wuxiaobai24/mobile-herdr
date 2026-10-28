# 手机聊天、附件与终端历史

保留现有主题、单行手机输入框和底部快捷选项。主动作仍是发送消息；附件托盘只在选中文件时出现。320px 窄屏使用短占位文字，避免工具按钮挤出第二行。技能使用现有底部选择器，支持名称、用途搜索以及输入 `$` 后补全。

## 命令与技能

已接入的操作继续调用同一个会话的 provider API。Codex 技能由该会话 `cwd` 的 `skills/list` 提供，忽略禁用技能，并响应 `skills/changed`。发送时使用真实的 `skill` 输入项和已发现的路径；同名技能要求从选择器明确选择。技能路径、文本草稿和操作回执一起保留。

Codex CLI 的其他公开命令在菜单中标为“原终端”。这些入口保留命令草稿并解释如何在终端执行，不能视为已经完整实现了 CLI。不会把未知 slash command 当成模型提示词，也不会通过恢复另一个 Codex 进程来执行命令。CLI 命令的实际可用性取决于安装版本。

## 附件与图片

每条消息最多 6 个附件，每个不超过 8 MB。Web 使用文件选择器，Android 使用系统文档选择器并复制到私有缓存，读取后清理缓存。上传不会提交 agent 消息；发送时才交给所选机器、session、pane 和会话。

附件保存在 bridge 私有 state 目录，以请求 ID 去重，并检查原会话身份。Codex 图片使用 `localImage` 输入；普通文件提供开发机真实路径。Pi 与 legacy agent 使用附件路径，并沿用其现有消息入口，legacy 始终调用 `agent.prompt`。不会自动重发。已上传附件保留在草稿；未完成的上传在重载后保留待处理提示，需要重新选择，原始文件字节不放入浏览器 localStorage。

聊天可以显示上传图片、消息中的 Markdown 图片和 provider 报告的图片；点击后打开大图。项目内图片沿用鉴权文件预览接口；项目外图片必须由当前会话明确报告。所有 bridge 请求均在 Authorization header 中携带密钥。文件消息可下载，下载沿用 Web 下载或 Android 保存位置选择器。

## 工具调用与终端

工具组先显示数量，组内每条操作显示名称、摘要、运行状态和可用的耗时。点击展开查看输入、输出、Diff 或图片；长输出可横向和纵向滚动。没有 provider 状态时不推断成功。展开反馈沿用 Pressable，图片预览使用淡入 Modal，选择器沿用现有 slide 转场；Web 遵守 reduced motion。

普通终端支持触摸滚动和惯性。全屏应用没有本地 scrollback 时，向历史方向滑动会在同一区域加载 Herdr 历史，并延续这次手势；保留工具栏、快捷键和“回到实时”。搜索、复制仍从“历史”入口进入。浏览操作不向程序发送方向键或鼠标报告。

## 升级边界与验证

bridge 更新不会自动替换已运行的 Codex broker 或 Pi 扩展。“原生连接详情 → 用新版 mherdr 重启”显式等待当前任务完成，验证原实例、输入权、shell 和终端，确认旧实例退出后，用新版启动器恢复准确的原对话。等待可取消；不可逆阶段暂停手机写入；重启请求落盘去重，断线不会重放。模型、思考强度和模式沿用原值，草稿按对话和终端保存，旧实例中结果不明的发送不会再次提交。

## 历史和 Herdr 布局

对话上滑至顶部自动分页，补入记录时保持阅读位置；失败原地提示和重试，不隐藏在菜单里。旧 Codex 不支持 `thread/turns/list` 时，回退读取准确 thread 的 `thread/read`，不按目录猜测其他记录。

会话列表支持新建工作区、创建标签页、向右或向下分屏、重命名工作区 / 标签页 / 终端。所有操作显式指定机器、session 和目标，创建使用 `focus:false`，保留电脑焦点。新终端仅在手机打开。创建回执保存在 bridge 私有目录，bridge 重启后同一请求不会重复创建；表单失败保留草稿。

验证入口：`bun run typecheck`、`bun test tests`、重新构建后的 `bun run test:ui`、`bun run build:android` 与专用模拟器上的 `bun run test:android`。专项截图、录屏和报告位于 `artifacts/controls-ui/`，Android 位于 `artifacts/android/ui/`。本次局部界面由主 agent 自检，未进行独立视觉评审。真实手机的键盘、系统后台和省电行为仍需单独验收。

2026-10-24 附件与技能阶段：类型检查通过；单元 / fixture 测试 64 通过、6 项 opt-in 跳过、0 失败，447 次断言；Web 全套 215 项通过，39 项交互专项连续三次通过；签名 APK 在独立 `mobile-herdr-slash-test` 模拟器上 36 项通过；Linux x64 发布包 32 项校验通过。日志副本在 `artifacts/chat-upgrade/`。

本机 bridge 从 0.2.2-beta.6 更新到 0.2.2-beta.8，保留原地址与密钥。通过私有管理 socket 重启该 bridge，前后核对 pane 的 terminal ID 以及原生 runtime ID / PID 均保持一致；记录在 `artifacts/deployment/local-upgrade.json`。没有停止、升级或重启 Herdr，也没有重启运行中的 agent。

2026-10-24 历史与管理阶段：类型检查通过；单元 / fixture 测试 69 通过、6 项 opt-in 跳过、0 失败，475 次断言；Web 全套 227 项通过，12 项历史与布局专项连续三次通过；最终签名 APK 在独立 `mobile-herdr-management-test` 模拟器上 42 项通过；Linux x64 发布包 32 项通过。另在测试自己创建的真实 Herdr session 内验证布局操作，以及安装的 Codex / Pi 一键重启：保持准确对话和终端，保留模型设置，不重放提示词，新适配器可继续发送。日志在 `artifacts/management-upgrade/`，截图在 `artifacts/management-ui/` 与 `artifacts/android/ui/`。独立模拟器验证包含系统键盘与前后台基本路径；实体手机的中文输入法、省电和后台限制尚未验收。

本机 bridge 已从 beta.8 更新到 beta.9，地址、密钥、原 Herdr terminal ID 和存活的 native runtime ID / PID 前后保持一致。记录在 `artifacts/deployment/management-upgrade.json`。已运行的用户 agent 没有被重启；是否使用新版适配器由用户从详情入口显式触发。此版本尚未发布到 GitHub。
