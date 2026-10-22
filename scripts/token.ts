import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { saveToken, stateDirectory, validateToken } from '../server/auth-token';

async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('请在终端中运行，或使用 token set --stdin 从标准输入读取。不要把密钥放在命令参数中。');
  const hidden = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output: hidden, terminal: true });
  const cancel = new AbortController(); input.once('SIGINT', () => cancel.abort());
  process.stderr.write('自定义连接密钥（至少 8 字符，输入不回显）：');
  try { return await input.question('', { signal: cancel.signal }); }
  catch { throw new Error('已取消，未修改连接密钥。'); }
  finally { input.close(); process.stderr.write('\n'); }
}
async function stdinSecret(): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 4098) throw new Error('连接密钥过长，未修改。'); chunks.push(bytes); }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}
const args = process.argv.slice(2);
try {
  if (!args.length || ['--help', '-h', 'help'].includes(args[0])) {
    console.log('用法：mobile-herdr token set [--stdin] | status\nset 隐藏输入并持久保存；--stdin 供脚本使用。不会打印密钥，不自动重启服务。');
  } else if (args.length === 1 && args[0] === 'status') {
    if (process.env.MOBILE_HERDR_TOKEN !== undefined) { validateToken(process.env.MOBILE_HERDR_TOKEN); console.log('当前进程使用 MOBILE_HERDR_TOKEN 环境变量（优先于 token 文件）。'); }
    else console.log(await access(join(stateDirectory(), 'token')).then(() => '已保存连接密钥。').catch(() => '尚未保存；首次启动或配对将自动生成。'));
  } else if (args[0] === 'set' && (args.length === 1 || (args.length === 2 && args[1] === '--stdin'))) {
    await saveToken(stateDirectory(), args[1] === '--stdin' ? await stdinSecret() : await readSecret());
    console.log('连接密钥已保存（权限 0600）。重启 Mobile Herdr bridge 后生效，再运行 pair 更新手机连接。Herdr 和 agent 无需重启。');
    if (process.env.MOBILE_HERDR_TOKEN !== undefined) console.log('注意：当前环境的 MOBILE_HERDR_TOKEN 会覆盖文件；使用已保存值前请取消该环境变量。');
  } else throw new Error('未知参数；请用 token --help 查看用法。密钥只能通过隐藏输入或 --stdin 提供。');
} catch (error) { console.error(error instanceof Error ? error.message : '连接密钥设置失败。'); process.exitCode = 1; }
