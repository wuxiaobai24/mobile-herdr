import { join, resolve } from 'node:path';
import { NativeController } from '../server/native/controller';
import { CodexRuntime } from '../server/native/codex';
import { createFixture } from './fixture';

export async function createNativeFixture() {
  const fixture = await createFixture();
  const pane = fixture.snapshot.panes[0];
  pane.agent = 'codex';
  const control = new NativeController(join(fixture.directory, 'native'), { herdrSocket: fixture.config.socket!, paneId: pane.pane_id, terminalId: pane.terminal_id }, 'codex');
  const runtime = new CodexRuntime(control, process.execPath, [resolve('tests/fake-codex.ts')]);
  await runtime.listen(0); await control.listen();
  const desktop = new WebSocket(`ws://127.0.0.1:${runtime.port}`);
  let counter = 0;
  const frames: any[] = [];
  const pending = new Map<number, (frame: any) => void>();
  desktop.onmessage = event => { const frame = JSON.parse(String(event.data)); frames.push(frame); if (frame.id !== undefined && !frame.method) { pending.get(frame.id)?.(frame); pending.delete(frame.id); } };
  await new Promise<void>((resolve, reject) => { desktop.onopen = () => resolve(); desktop.onerror = reject; });
  function desktopCall(method: string, params = {}): Promise<any> {
    return new Promise(resolve => { const id = ++counter; pending.set(id, resolve); desktop.send(JSON.stringify({ id, method, params })); });
  }
  await desktopCall('initialize'); desktop.send(JSON.stringify({ method: 'initialized' }));
  await desktopCall('thread/start');
  return { ...fixture, control, runtime, desktop, frames, desktopCall,
    async close() { desktop.close(); await runtime.close(); await control.close(); await fixture.close(); } };
}
