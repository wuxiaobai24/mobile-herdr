import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { NativeController, type NativeIdentity } from '../server/native/controller';
import { CodexRuntime } from '../server/native/codex';
import { reportToHerdr } from '../server/native/herdr-reporting';

const identity = JSON.parse(process.env.MOBILE_HERDR_NATIVE_IDENTITY ?? '{}') as NativeIdentity;
const directory = process.env.MOBILE_HERDR_NATIVE_DIRECTORY;
if (!directory || !identity.terminalId || !identity.paneId || !identity.herdrSocket) throw new Error('缺少 Herdr 运行实例标识。');
const control = new NativeController(directory, identity, 'codex');
const serverArgs: unknown = JSON.parse(process.env.MOBILE_HERDR_CODEX_SERVER_ARGS ?? '[]');
if (!Array.isArray(serverArgs) || !serverArgs.every(value => typeof value === 'string')) throw new Error('无效的 Codex 后台配置。');
const runtime = new CodexRuntime(control, process.env.MOBILE_HERDR_CODEX_BINARY ?? 'codex', serverArgs, { ...process.env, MOBILE_HERDR_CODEX_PROXY_ADAPTER: join(import.meta.dir, 'codex-proxy.ts') });
try {
  await runtime.listen(join(directory, control.state.runtimeId + '.tui.sock'));
  await control.listen();
} catch (error) { await runtime.close(); throw error; }
const stopReporting = reportToHerdr(control);
let stopping = false;
function shutdown(): void {
  if (stopping) return; stopping = true;
  void stopReporting().finally(() => runtime.close()).finally(() => control.close())
    .finally(() => unlink(join(directory!, control.state.runtimeId + '.launch.json')).catch(() => {})).finally(() => process.exit(0));
}
control.onShutdown = shutdown;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown);
