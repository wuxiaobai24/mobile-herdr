import type { NativeState } from './native';

export interface ChatCommand { name: string; title: string; description: string; terminal?: boolean }
export const chatCommands: ChatCommand[] = [
  { name: 'model', title: '选择模型', description: '切换当前会话可用的模型' },
  { name: 'reasoning', title: '思考强度', description: '选择当前模型支持的强度' },
  { name: 'skills', title: '选择技能', description: '搜索当前项目可用的 Codex skills' },
  { name: 'stop', title: '停止当前任务', description: '打断执行，保留对话' },
  { name: 'compact', title: '压缩上下文', description: '保留摘要，继续当前会话' },
  { name: 'plan', title: '计划模式', description: '下次任务先制定计划' },
  { name: 'build', title: '执行模式', description: '下次任务执行修改' },
  { name: 'review', title: '审查当前改动', description: '在当前对话审查工作区改动' },
  { name: 'status', title: '会话状态', description: '查看模型、输入权和上下文' },
  { name: 'search', title: '查找与历史', description: '定位消息、加载更早记录' },
  { name: 'files', title: '浏览文件', description: '预览和下载项目文件' },
  { name: 'changes', title: '查看改动', description: '查看当前对话的文件 Diff' },
  { name: 'editor', title: '展开编辑', description: '全屏编辑长消息' },
  { name: 'terminal', title: '打开终端', description: '回到同一个 pane' },
  { name: 'desktop', title: '交还电脑', description: '交还当前会话输入权' },
  { name: 'help', title: '快捷选项', description: '查看可用操作与命令' },
];

// CLI commands are handled by the TUI, not by sending slash text to the model.
// Keep these discoverable while making their terminal requirement explicit.
export const codexTerminalCommands: ChatCommand[] = [
  ['permissions', '权限设置'], ['ide', 'IDE 上下文'], ['keymap', '键盘快捷键'], ['vim', 'Vim 输入模式'],
  ['setup-default-sandbox', 'Windows 沙箱设置'], ['agents', 'Agent 列表'], ['subagents', '子 Agent'],
  ['apps', '应用连接器'], ['plugins', '插件'], ['hooks', '生命周期钩子'], ['clear', '清屏并新建对话'],
  ['rename', '重命名对话'], ['archive', '归档对话'], ['delete', '删除对话'], ['copy', '复制最近回复'],
  ['diff', 'Git Diff'], ['exit', '退出 CLI'], ['quit', '退出 CLI'], ['experimental', '实验功能'],
  ['approve', '重试被拒绝的操作'], ['memories', '记忆设置'], ['import', '导入配置与会话'],
  ['feedback', '反馈'], ['init', '生成 AGENTS.md'], ['logout', '退出登录'], ['mcp', 'MCP 工具'],
  ['mention', '附加文件'], ['fast', '快速服务档位'], ['goal', '任务目标'], ['ps', '后台终端'],
  ['fork', '分叉对话'], ['app', '在桌面应用继续'], ['side', '临时侧边对话'], ['btw', '临时侧边对话'],
  ['raw', '原始滚动模式'], ['resume', '选择历史会话'], ['new', '新建对话'], ['usage', '账号用量'],
  ['debug-config', '配置诊断'], ['statusline', '状态栏设置'], ['title', '终端标题'], ['theme', '终端主题'],
  ['pets', '终端宠物'], ['pet', '终端宠物'], ['tui', '终端显示模式'], ['export', '导出对话'],
  ['recap', '对话摘要'], ['cd', '切换目录'], ['pwd', '当前目录'], ['cwd', '当前目录'],
  ['worktree', 'Git 工作树'], ['daemon', '后台服务控制'], ['warnings', '警告与诊断'],
].map(([name, title]) => ({ name: name!, title: title!, description: '在原终端使用 · 可用性取决于 Codex 版本', terminal: true }));

export function parseChatCommand(text: string): { name: string; argument: string } | undefined {
  const match = text.trim().match(/^\/([\w:.-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return;
  const name = match[1];
  const builtin = chatCommands.find(command => command.name === name.toLowerCase());
  return { name: builtin?.name ?? name, argument: match[2]?.trim() ?? '' };
}

export function availableChatCommands(state?: NativeState | null): ChatCommand[] {
  const builtins = chatCommands.filter(command => {
    if (command.name === 'model') return !!state?.capabilities.models;
    if (command.name === 'reasoning') return !!state?.capabilities.reasoning;
    if (command.name === 'skills') return !!state?.capabilities.skills;
    if (command.name === 'compact') return !!state?.capabilities.compact;
    if (command.name === 'plan' || command.name === 'build') return !!state?.capabilities.modes;
    if (command.name === 'review') return !!state?.capabilities.review;
    if (command.name === 'desktop') return !!state;
    return true;
  });
  const reserved = new Set(chatCommands.map(command => command.name));
  const commands = [...builtins, ...(state?.commands ?? []).filter(command => !reserved.has(command.name)).map(command => ({
    name: command.name, title: '/' + command.name, description: command.description,
  }))];
  const provided = new Set(commands.map(command => command.name));
  return state?.provider === 'codex' ? [...commands, ...codexTerminalCommands.filter(command => !provided.has(command.name))] : commands;
}

export function reasoningLabel(value: string): string {
  const labels: Record<string, string> = { off: '关闭', none: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '更高', max: '最高', ultra: '最高' };
  return labels[value] ?? value;
}
