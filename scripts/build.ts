import { build } from 'vite';
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

await build();
const result = await Bun.build({ entrypoints: ['app/terminal.ts'], outdir: 'dist', naming: 'terminal.js', minify: true, target: 'browser' });
if (!result.success) throw new Error(result.logs.join('\n'));
await copyFile('node_modules/@xterm/xterm/css/xterm.css', 'dist/terminal.css');
const assets = (await readdir('dist/assets')).map(file => '/assets/' + file);
const worker = await readFile('public/sw.js', 'utf8');
const buildId = createHash('sha256').update(await readFile('dist/index.html')).update(await readFile('public/manifest.webmanifest')).update(worker).digest('hex').slice(0, 12);
await writeFile('dist/sw.js', worker.replace('__BUILD_ID__', buildId).replace('/*__BUILD_ASSETS__*/ []', JSON.stringify(assets)));
console.log('Web 客户端和原始终端已构建。');
