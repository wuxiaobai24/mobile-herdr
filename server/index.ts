import { join } from 'node:path';
import { loadConfig } from './config';
import { createBridge } from './server';
import { serveManagement } from './management';
import { SshMachines } from './ssh-machines';

const config = await loadConfig();
const remotes = process.env.MOBILE_HERDR_SSH_DISCOVERY === '0' ? undefined : new SshMachines();
remotes?.start();
const server = createBridge(config, { remotes });
console.log(`Mobile Herdr · http://${config.host}:${server.port}`);
console.log(`连接密钥文件：${join(config.stateDir, 'token')}（或 MOBILE_HERDR_TOKEN）`);
console.log('Bridge 不会启动、替换或停止已有 Herdr session。');
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return; stopping = true;
  await Promise.all([server.stop(true), remotes?.close(), management?.close()]); process.exit(0);
}
const management = await serveManagement(config, server.port!, () => void stop());
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void stop());
