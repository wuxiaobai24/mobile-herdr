import qrcode from 'qrcode-terminal';
import { loadConfig } from '../server/config';
import { normalizeUrl } from '../shared/client';

const args = process.argv.slice(2);
const position = args.indexOf('--url');
if (position < 0 || !args[position + 1]) {
  console.log('用法：bun run pair --url https://手机可访问的开发机地址');
  console.log('例如：bun run pair --url http://192.168.1.8:7331');
  process.exit(1);
}
const config = await loadConfig();
const url = normalizeUrl(args[position + 1]);
const fragment = Buffer.from(JSON.stringify({ version: 1, url, name: config.name, token: config.token })).toString('base64url');
const link = `${url}/#connect=${fragment}`;
qrcode.generate(link, { small: true });
console.log('用手机扫描，确认连接即可。该链接包含连接密钥，请仅在自己的设备上打开。');
console.log(link);
