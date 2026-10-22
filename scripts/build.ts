import { build } from 'vite';
import { copyFile } from 'node:fs/promises';

await build();
const result = await Bun.build({ entrypoints: ['app/terminal.ts'], outdir: 'dist', naming: 'terminal.js', minify: true, target: 'browser' });
if (!result.success) throw new Error(result.logs.join('\n'));
await copyFile('node_modules/@xterm/xterm/css/xterm.css', 'dist/terminal.css');
console.log('Web 客户端和原始终端已构建。');
