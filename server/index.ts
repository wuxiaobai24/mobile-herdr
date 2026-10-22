import { join } from 'node:path';
import { loadConfig } from './config';
import { createBridge } from './server';

const config = await loadConfig();
const server = createBridge(config);
console.log(`Mobile Herdr · http://${config.host}:${server.port}`);
console.log(`连接密钥文件：${join(config.stateDir, 'token')}（或 MOBILE_HERDR_TOKEN）`);
console.log('Bridge 不会启动、替换或停止已有 Herdr session。');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.stop(true); process.exit(0); });
