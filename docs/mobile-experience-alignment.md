# 手机端体验对齐与本轮优化

2026-10-23。目标是让手机能够顺畅地继续一个已经运行的 Herdr 会话：终端参考 HerdTerm，Chat 参考 Paseo 和 OpenChamber。优先级是读得下、点得到、少走一步；常驻工具使用图标，模型名称、错误和操作菜单保留必要文字。

## 调研依据

- 本地 HerdTerm，提交 `c6e92f6a5e320d7d11f608a8f8a016ebaf0804dc`。阅读了 `docs/moshi-terminal-ux.md`、`docs/mobile-pane-mode.md`，以及 `ExtraKeysBar.kt`、`StickyMods.kt`、`TerminalDirectionPad.kt` 和 `TerminalView.kt`。参考的是源码和设计记录，未运行或修改它的 App、SSH 连接与服务器。
- [Paseo](https://github.com/getpaseo/paseo/tree/fed19f3d29cbcd21ecd45834af81adc13d9d5a7f)，重点检查 composer 全屏编辑、消息复制、工具折叠和阅读位置同步。其 `chat-find/index.tsx` 明确将原生查找留空，Web 查找另行实现；本项目继续提供共享的手机查找入口。
- [OpenChamber](https://github.com/openchamber/openchamber/tree/5dac7e48077e1f1f85182314dc4ad539efd92de8)，重点检查 `ChatInput.tsx`、`composer/submit/slashCommands.ts` 和模型选择。它把本地动作、提示词命令和运行后端命令分开，手机配置面板按需展开，停止动作针对当前执行目标。
- 原生协议以本机 Codex 0.162.1 生成的 app-server JSON Schema，以及 Pi 1.2.0 扩展 API 为依据。尤其核对了 `turn/start.effort`、`collaborationMode`、`review/start.delivery` 和 Pi 的 `expandPromptTemplates`。调研材料保存在忽略版本控制的 `artifacts/optimization/references/`，第三方源码不进入产品或发布包。

## 终端：哪些体验值得移植

HerdTerm 的优势集中在输入操作。快捷键和系统键盘共用修饰键状态；方向面板悬浮在终端之上；键盘、方向键和文件入口固定，长快捷键列表在剩余空间横向滚动。这样能够在较少可见行数下操作完整 TUI。

| 操作 | 原先的 Mobile Herdr | 本轮结果与边界 |
| --- | --- | --- |
| Ctrl / Alt | 只有固定 Ctrl C | 一次性修饰键；字母、控制字符、方向键经同一编码函数派发，使用后清除。断线、只读、历史模式也清除修饰状态 |
| 方向操作 | 横向快捷条中的上、下 | 固定图标打开可拖动面板，含四向、回车、Esc、Tab、退格和 Delete；拖动本身不发送终端输入 |
| 常用工具 | 键盘在顶栏，重连挤在快捷条末尾 | 粘贴、方向键、键盘固定在底部；重连与历史位于顶栏。快捷条按视口使用完整键宽，保留横向翻阅 |
| 粘贴 | 依赖平台默认粘贴 | 图标打开可编辑预览，显式点击后调用 xterm 的 bracketed paste 路径；Android 使用原生剪贴板。权限失败允许手动粘贴 |
| 断线与只读 | 禁止普通输入 | 新增控件共用同一输入门禁；保留打开的粘贴草稿，恢复后等待用户再次点击，不自动投递 |
| 滚动 | 本地回滚与只读历史 | 保留原行为。HerdTerm 会在部分 TUI 中转发鼠标滚轮，本项目浏览历史仍不向程序发送滚轮或方向键 |
| 选区与复制 | 历史中选择复制 | 继续支持历史选择、查找、复制所选或全部；未宣称实现 HerdTerm 原生画布上的长按拖选 |
| 手势与多 pane | 从明确列表选择 pane | 不引入会改变远端共享布局的缩放、滑动切 pane 手势；继续使用已有明确目标与列表 |

保留 xterm / WebView 的原因是 Web 与 Android 共享终端和主题。没有迁移 HerdTerm 的 Kotlin / libvterm 引擎，也没有复制其实现。

## Chat：以手机操作链对齐

Paseo 的长草稿编辑和消息操作适合直接借鉴；OpenChamber 的关键在于把模型、强度、工作模式、运行控制与输入框结合。手机端通过输入框旁的滑杆图标进入快捷选项，配置不常驻占行。模型与强度直接点选生效，不再放在连接诊断式详情中填写 ID 再提交。

| 能力 | 本轮状态 | 实际执行方式 |
| --- | --- | --- |
| Slash 发现与选择 | 已实现 | 输入 `/` 或前缀显示有高度上限的可滚动候选；手机点选可直接打开对应操作 |
| 模型 | 已实现 | `/model` 打开列表，`/model <ID>` 直接选择；使用当前运行实例提供的模型，任务中禁用切换 |
| 思考强度 | 已实现 | `/reasoning` 或 `/reasoning <值>`；仅显示当前模型提供的选项，切换到不支持的模型时清除无效旧值 |
| 工作模式 | Codex 已实现 | `/plan`、`/build` 设置下次任务的结构化 collaboration mode；不以普通提示词假装切换模式 |
| 停止与补充 | 已实现 | 工作时保持停止图标，`/stop` 也可中断；补充继续走 Codex steer / Pi steer，保持相同 thread 与运行实例 |
| 上下文压缩 | 原生能力提供时可用 | `/compact` 调用 Codex 原生压缩或 Pi context compact，保留当前会话 |
| 改动审查 | Codex 已实现 | `/review` 在当前 thread 内审查未提交改动，明确使用 inline delivery |
| Pi 命令、模板与技能 | 已实现动态目录 | 从原 Pi 扩展 API 获取目录，并使用 `expandPromptTemplates: true` 派发；不把未知命令当作普通消息发送 |
| 上下文用量 | 后端报告时显示 | 快捷面板显示上次请求的 token / 窗口信息；不猜测费用或没有报告的数据 |
| 长消息编辑 | 已实现 | `/editor` 或快捷菜单进入全屏，同一份草稿；收起、Android 返回、刷新与失败均保留内容 |
| 回复复制 | 已实现 | 作者行旁的复制图标，复制真实 Markdown 正文，完成后短暂显示勾选 |
| 阅读与改动 | 已有并优化 | `/search`、`/changes`，历史分页、上一问、查找与 Diff；查找区分空查询和无匹配，导航按消息 ID 保持位置 |
| 输入权 | 保留并统一 | `/desktop`、接管与交还继续使用 client ID、epoch 与准确 runtime / conversation fence |

`/status`、`/help` 打开当前会话快捷选项，`/terminal` 回到同一个 pane。执行动作与输入框发送共用命令定义。未知原生命令保留草稿并明确提示，不会伪装成已经执行。

Pi 的 `new/resume/fork/tree/reload/exit/quit` 不在手机目录中；Codex 的 TUI 命令也不全部等同于 app-server 方法。本轮没有添加新建、恢复第二份 agent 或隐式迁移会话的入口。扩展命令自身仍可能显示自定义终端 UI，这种 UI 继续使用已有“交还电脑处理”的边界。

## 紧凑设计约束

空输入框保持 54px；会话页没有新增常驻模型工具栏。输入框常驻快捷选项与发送图标，工作中再出现停止图标。模型名和强度放在按需展开的面板中，选择后自动返回。终端底栏常用工具固定，方向面板覆盖画布而不压缩终端行数。

查找输入框使用整行可用宽度，关闭与清空使用不同图标位置；第二行放历史、上一问、结果计数和前后匹配。快捷面板、长草稿与终端浮层都检查 320px 窄屏、450px 短视口及横屏。动效复用既有 Modal 进入与按钮反馈，终端浮层使用短进入动画，尊重 reduced motion。

## 性能、稳定性与维护

- 历史读取由固定读取最多 8 MiB 改成从 64 KiB 反向扩展；扩展复用已读字节，总读取范围仍受 8 MiB 限制。JSONL 边界、UTF-8 字节位置、工具结果、半条记录和准确 transcript identity 继续受测试约束。密集 4 MiB 夹具的最新一页只需读取 64 KiB；这个结果不代表所有记录格式都有相同比例的提速。
- 单次读取复用已经校验的路径和文件元信息，消除同次请求内重复定位记录、扫描目录和 stat。未引入按 cwd 猜记录的缓存。
- 轮询短暂报错后，恢复时强制发送完整状态，即使内容没有变化，也能解除客户端离线状态。此恢复只读取状态。
- 消息合并、工具分组、查找索引与 Markdown 渲染复用不变的结果。终端触摸控件从连接传输中分离，按键编码与命令目录有独立类型和测试。
- 提交回执等待期间的新输入不会被旧消息的草稿清理覆盖；已成功发送后清除旧错误提示。Pi 扩展也纳入 TypeScript 检查。

## 对齐边界与后续顺序

本轮覆盖手机 Chat 的主要输入、配置、阅读、审批与运行控制。OpenChamber 的完整 IDE 功能范围更广：图片 / 文件附件、文件提及、显式 follow-up 队列、回滚 / 重做、Git 提交与 PR、编辑器、浏览器预览、多会话并行运行、计划任务和通知均不能据此认定已对齐。

后续应先补附件传输与 provider input schema、队列与回执的明确状态，再考虑文件提及和 Git 工作流。新功能继续围绕手机已有会话，不自动创建第二份 provider。旧的已运行原生组件只会暴露自身实际具备的能力；本轮没有重启、升级或替换用户的 Herdr、agent 或 bridge。

验证证据与本轮结果见 [verification.md](verification.md)。APK 验收使用专用模拟器，浏览器视口和模拟 VT 不等同于真实手机键盘、公网 SSH 或 Android 到真实 Herdr PTY 的全链路验收。
