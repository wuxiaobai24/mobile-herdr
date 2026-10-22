import { createFixture } from './fixture';
import { createNativeFixture } from './native-fixture';
import { createBridge } from '../server/server';
import { BridgeError } from '../server/rpc';

export async function createSshUiFixture() {
  const local = await createFixture();
  const remote = await createNativeFixture();
  remote.snapshot.workspaces[0].label = 'remote-workspace';
  const gateway = {
    async list() { return { machines: [
      { id: 'ssh-owned-online', name: 'SSH 开发机', session: 'agents', status: 'online' as const },
      { id: 'ssh-owned-auth', name: 'SSH 待认证', session: 'default', status: 'offline' as const, error: 'SSH 需要认证。请在开发机运行 herdr machine reconnect owned-auth。' },
      { id: 'ssh-owned-disabled', name: 'SSH 已禁用', session: 'default', status: 'disabled' as const },
    ] }; },
    destination(id: string) {
      if (id !== 'ssh-owned-online') throw new BridgeError('ssh_connecting', 'SSH 需要认证，请在电脑完成后重试。', 503);
      return { url: remote.url, token: remote.config.token, closed: new Promise(() => {}), async close() {} };
    },
  };
  const bridge = createBridge({ ...local.config, port: 0 }, { remotes: gateway });
  return { url: `http://127.0.0.1:${bridge.port}`, token: local.config.token, remote,
    async close() { bridge.stop(true); await remote.close(); await local.close(); } };
}
