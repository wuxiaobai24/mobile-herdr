import { join } from 'node:path';
import { loadConfig } from './config';
import { createBridge } from './server';
import { SshMachines } from './ssh-machines';

const config = await loadConfig();
const remotes = process.env.MOBILE_HERDR_SSH_DISCOVERY === '0' ? undefined : new SshMachines();
remotes?.start();
const server = createBridge(config, { remotes });
console.log(`Mobile Herdr · http://${config.host}:${server.port}`);
console.log(`连接密钥文件：${join(config.stateDir, 'token')}（或 MOBILE_HERDR_TOKEN）`);
console.log('Bridge 不会启动、替换或停止已有 Herdr session。');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.stop(true); void (remotes?.close() ?? Promise.resolve()).finally(() => process.exit(0)); });
