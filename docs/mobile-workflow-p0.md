# 手机多任务 P0 验收（0.2.2-beta.10）

2026-10-24。本轮落实 [Herdr Web UI 对标](herdr-web-ui-benchmark.md) 的 P0；保留现有六主题、单 pane 主视图和原 agent 身份。

- 同工作区横向 tab 导航、分屏 pane 选择、标签名搜索，以及逐 tab 的准确终端 / 视图记忆。Session 选择默认收起；手机导航不改变电脑焦点。
- “需要你”汇总已保存开发机、SSH machine 和 session 中的待确认 pane 与观察到的未读完成；通过只读 native 状态补全 Herdr 状态，排除空闲兄弟 pane。跨机器同名 pane 不混用；前台轮询，不是后台推送。
- 工作中明确选择“补充本轮 / 下一轮再做”。队列绑定 terminal、runtime、conversation、client、epoch 和请求 ID；技能 / 附件保持原身份。切换同一机器 / session 的 pane 仍等待；断线、后台、切换机器 / session、bridge 重启会暂停自动投递。投递不明不重试；可核对、手动发送、取回草稿和移除。
- 队列持久文件为私有权限，每设备最多20条待处理；读取接口只保留有界近期回执，不反复传输已发送正文。Provider 通过 `prompt_idle` 再次原子检查空闲，禁止静默降为 steer。普通 legacy 会话保持原 `agent.prompt` 入口，未加入自动队列。

旧适配器保持原进程。需要队列时，在任务结束后从“更多 → 原生连接详情 → 用新版 mherdr 重启当前会话”显式更新；仍恢复原对话，不重启 Herdr。

## 验证

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript | `bun run typecheck` 通过 | 本轮终端结果 |
| 默认后端 / 共享逻辑 | 78通过、6按环境跳过、0失败，537断言 | `artifacts/navigation-ui/`；测试源 `tests/attention.test.ts`、`navigation.test.ts`、`queue.test.ts` |
| 后续队列读取优化 | 相关9项通过 | 队列、收件箱、导航测试 |
| 全部 Web UI | 246项通过，无未处理浏览器错误 | 各 `artifacts/*-ui/verification.json` |
| 新增手机流程 | 19项连续3次通过 | `artifacts/navigation-ui/verification.json`、截图和 `video/` |
| 本机 Codex / Pi | 2项隔离集成通过，17断言 | 临时配置 + 本地模型替身，`tests/live-native.test.ts` |
| Herdr 真终端 / 布局 | 3项隔离测试通过，31断言 | `tests/live-herdr.test.ts`、`layout.test.ts` |
| 签名 Android release APK | 完整47项通过；原生收件箱额外3项专项通过 | `artifacts/android/ui/verification.json`、`artifacts/android/inbox/verification.json` |
| Linux x64 发布包 | 32项检查通过 | `artifacts/releases/mobile-herdr-0.2.2-beta.10.tar.gz.verification.json` |

Web 重点覆盖10 tabs / 20 panes、320×568、390×450、844×390，实际展开的 pane 面板、跨机器同名目标、未读清除、刷新恢复、保存失败、立即发送、断线后暂停与取回草稿。Android 是独立签名 APK，未依赖 Metro，在测试专用 Android 35 模拟器与隔离 Unix socket / provider fixture 上运行；包含 OS 后台暂停队列、文件系统选择器、图片预览、重装保留存储等。

完成一轮独立存量视觉评审，不打分；修复身份行换行、低高度空态裁切，压缩重复计数和空态文案，补拍面板真正展开的截图。主 Agent 已复看最终图。设计和证据说明见 [设计规范](design.md) 与 `artifacts/navigation-ui/visual-review.md`。

## 本机交付

托管 Mobile Herdr bridge 已由 beta.9 升至 beta.10，仍为 `http://127.0.0.1:7331`。地址、密钥、原 Herdr terminal ID 和存活 native runtime ID / PID 均保持一致；没有重启用户 Herdr 或 agent。记录：`artifacts/deployment/mobile-workflow-p0-upgrade.json`。

Android versionCode 5，沿用仓库外原签名；APK：`artifacts/android/mobile-herdr.apk`，旁边提供 SHA-256。源码工作树和发布包均为未提交候选快照，未执行公开发布。

实体手机的中文输入法、键盘、锁屏与厂商后台行为仍待实机验收。P1 的目录选择、显式新任务启动、仓库 Git diff / worktree、文件编辑等继续保留在对标报告，不在本次 P0 完成范围。
