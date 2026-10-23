import { ndjsonLines } from './ndjson';
import { version } from '../../package.json';

/** Read-only probe: proxy connects to an existing daemon; it never bootstraps one. */
export async function daemonHasThread(command: string, args: string[], env: Record<string, string | undefined>, conversation: string, adapter: string): Promise<boolean> {
  const child = Bun.spawn([process.execPath, 'run', adapter, command, ...args], { env, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
  const timer = setTimeout(() => child.kill(), 5000);
  function send(frame: object): void { child.stdin.write(JSON.stringify(frame) + '\n'); child.stdin.flush(); }
  try {
    send({ id: 'takeover-initialize', method: 'initialize', params: { clientInfo: { name: 'mobile_herdr_probe', version }, capabilities: { experimentalApi: true } } });
    for await (const line of ndjsonLines(child.stdout)) {
      if (!line.trimStart().startsWith('{')) continue;
      const frame = JSON.parse(line);
      if (frame.error) return false;
      if (frame.id === 'takeover-initialize') { send({ method: 'initialized' }); send({ id: 'takeover-loaded', method: 'thread/loaded/list', params: {} }); }
      if (frame.id === 'takeover-loaded') return Array.isArray(frame.result?.data) && frame.result.data.includes(conversation);
    }
    return false;
  } finally { clearTimeout(timer); child.kill(); await child.exited; }
}
export function codexStatusConversation(text: string): string | undefined {
  const start = text.lastIndexOf('/status');
  if (start < 0) return;
  const panel = text.slice(start);
  if (!panel.includes('>_ OpenAI Codex') || !/^\s*Model:/m.test(panel) || !/^\s*Directory:/m.test(panel)) return;
  const ids = [...panel.matchAll(/^\s*Session:\s*([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\b/gmi)].map(row => row[1]);
  if (ids.length === 1) return ids[0];
}
