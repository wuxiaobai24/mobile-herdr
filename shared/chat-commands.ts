import type { NativeState } from './native';

export interface ChatCommand { name: string; title: string; description: string }
export const chatCommands: ChatCommand[] = [
  { name: 'model', title: '选择模型', description: '切换当前会话可用的模型' },
  { name: 'reasoning', title: '思考强度', description: '选择当前模型支持的强度' },
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
    if (command.name === 'compact') return !!state?.capabilities.compact;
    if (command.name === 'plan' || command.name === 'build') return !!state?.capabilities.modes;
    if (command.name === 'review') return !!state?.capabilities.review;
    if (command.name === 'desktop') return !!state;
    return true;
  });
  const reserved = new Set(builtins.map(command => command.name));
  return [...builtins, ...(state?.commands ?? []).filter(command => !reserved.has(command.name)).map(command => ({
    name: command.name, title: '/' + command.name, description: command.description,
  }))];
}

export function reasoningLabel(value: string): string {
  const labels: Record<string, string> = { off: '关闭', none: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '更高', max: '最高', ultra: '最高' };
  return labels[value] ?? value;
}
