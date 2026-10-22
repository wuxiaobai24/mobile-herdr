import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pane } from '../shared/protocol';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CODEX_VALUES = new Set(['-c', '--config', '--enable', '--disable', '-m', '--model', '-s', '--sandbox', '-C', '--cd', '-a', '--ask-for-approval', '--local-provider', '--add-dir', '-i', '--image']);
const CODEX_SWITCHES = new Set(['--oss', '--approve-for-me', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '--search', '--no-alt-screen', '--no-daemon', '--strict-config', '--all', '--include-non-interactive']);
const CODEX_COMMANDS = new Set(['agents', 'exec', 'e', 'review', 'login', 'logout', 'mcp', 'plugin', 'app-server', 'remote-control', 'completion', 'update', 'doctor', 'sandbox', 'debug', 'apply', 'a', 'queue', 'archive', 'delete', 'migrate-rollouts', 'unarchive', 'cloud', 'exec-server', 'features', 'help']);

export interface CodexOptions { serverArgs: string[]; reattachArgs: string[]; resumeId?: string; command?: 'resume' | 'fork' }

function codexOptionName(token: string): string {
  if (token.startsWith('--')) return token.split('=')[0];
  if (/^-[cmpsCai].+/.test(token)) return token.slice(0, 2);
  return token;
}

function inlineValue(token: string, option: string): string | undefined {
  if (token === option) return;
  if (token.startsWith('--')) return token.slice(option.length + 1);
  return token.slice(2);
}

/** Keep the official TUI's arguments intact, while configuring its shared backend too. */
export function codexOptions(args: string[]): CodexOptions {
  const result: CodexOptions = { serverArgs: [], reattachArgs: [] };
  let positional = false;
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === '--') break;
    const option = codexOptionName(token);
    if (['-p', '--profile'].includes(option)) throw new Error('当前共享连接不支持 Codex --profile；请用 -c 传入所需配置，或使用原 codex --profile 进入终端兼容模式。');
    if (['--remote', '--remote-auth-token-env'].includes(option)) throw new Error('mherdr 管理共享连接，不能覆盖 --remote。连接其他服务请使用原 codex 命令。');
    if (option === '--last') throw new Error('请使用 mherdr codex resume <完整会话 ID>，避免选中仍在其他终端运行的会话。');
    if (CODEX_VALUES.has(option)) {
      const inline = inlineValue(token, option);
      const value = inline ?? args[++index];
      if (!value || value === '--' || (inline === undefined && value.startsWith('-'))) throw new Error(`${option} 缺少参数值。`);
      if (['-c', '--config', '--enable', '--disable'].includes(option)) result.serverArgs.push(option, value);
      if (!['-i', '--image'].includes(option)) result.reattachArgs.push(option, value);
      continue;
    }
    if (CODEX_SWITCHES.has(option) && option === token) {
      if (option === '--strict-config') result.serverArgs.push(token);
      if (!['--all', '--include-non-interactive'].includes(option)) result.reattachArgs.push(token);
      continue;
    }
    if (token.startsWith('-')) throw new Error(`暂不支持 Codex 参数 ${option}；请用 mherdr codex --help 查看 CLI 帮助。`);
    if (!positional) {
      if (CODEX_COMMANDS.has(token)) throw new Error(`${token} 不是交互会话；请直接使用 codex ${token}。`);
      if (token === 'resume' || token === 'fork') { result.command = token; positional = true; continue; }
      positional = true;
    } else if (result.command && !result.resumeId) {
      if (!UUID.test(token)) throw new Error('恢复或 fork 会话请提供完整会话 ID，不使用名称、最近会话或选择器。');
      result.resumeId = token;
    }
  }
  if (result.command && !result.resumeId) throw new Error('请提供完整会话 ID，例如 mherdr codex resume <会话 ID>。');
  return result;
}

export function assertSessionAvailable(panes: Pane[], current: Pane, id?: string): void {
  if (!id) return;
  if (panes.some(pane => pane.terminal_id !== current.terminal_id && pane.agent && pane.agent_session?.value === id)) {
    throw new Error('此会话仍在另一个 Herdr pane 中运行。请先退出原 CLI，避免两个进程写同一段对话。');
  }
}

/** Resolve Pi's exact session header, without loading its transcript or guessing by cwd. */
export async function piResumeId(args: string[], cwd = process.cwd()): Promise<string | undefined> {
  const values = new Set(['--session', '--session-dir', '--session-id', '--fork', '--provider', '--model', '--api-key', '--system-prompt', '--append-system-prompt', '--mode', '--name', '-n', '--models', '--tools', '-t', '--exclude-tools', '-xt', '--thinking', '--extension', '-e', '--skill', '--prompt-template', '--theme', '--use-theme', '--tui-mode']);
  let session: string | undefined;
  let positional = false;
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === '--') break;
    const option = token.split('=')[0];
    if (!token.startsWith('-') && !positional) {
      positional = true;
      if (['install', 'remove', 'uninstall', 'update', 'list', 'config', 'auth', 'mcp'].includes(token)) throw new Error(`${token} 不是 agent 会话；请直接使用 pi ${token}。`);
    }
    if (['--continue', '-c', '--resume', '-r'].includes(option)) throw new Error('请使用 mherdr pi --session <完整会话 ID 或路径>，避免重复打开正在运行的会话。');
    if (['--print', '-p', '--export', '--list-models'].includes(option) || option === '--mode' && (token.includes('=') ? token.slice(7) : args[index + 1]) !== 'text') {
      throw new Error('mherdr pi 用于交互会话；非交互操作请直接使用 pi 命令。');
    }
    if (!values.has(option)) continue;
    const value = token.includes('=') ? token.slice(option.length + 1) : args[++index];
    if (!value || value.startsWith('-')) throw new Error(`${option} 缺少参数值。`);
    if (option === '--session' || option === '--session-id') session = value;
  }
  if (!session || UUID.test(session)) return session;
  const path = resolve(cwd, session);
  const file = await open(path, 'r').catch(() => undefined);
  if (!file) throw new Error('Pi 会话必须使用完整会话 ID 或可读取的会话文件路径。');
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const header = JSON.parse(buffer.toString('utf8', 0, bytesRead).split('\n')[0]);
    if (header.type !== 'session' || !UUID.test(header.id)) throw new Error('invalid_header');
    return header.id;
  } catch { throw new Error('无法读取 Pi 会话标识，请检查会话文件。'); }
  finally { await file.close(); }
}
