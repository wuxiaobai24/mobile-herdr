import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ndjsonLines } from '../server/native/ndjson';
import { codexStatusConversation } from '../server/native/codex-daemon';

test('daemon identity parses only the latest Codex status panel and rejects ambiguous output', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  expect(codexStatusConversation('An assistant wrote Session: ' + id)).toBeUndefined();
  const panel = `/status\n >_ OpenAI Codex (v0.162.1)\n Model: fixture\n Directory: /owned\n Session: ${id}\n`;
  expect(codexStatusConversation(panel)).toBe(id);
  expect(codexStatusConversation(panel + 'Session: 22222222-2222-4222-8222-222222222222\n')).toBeUndefined();
});
test('daemon adapter performs WebSocket upgrade over a private byte proxy and preserves a 17 MiB response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mh-proxy-')), socket = join(directory, 'peer.sock');
  const payload = 'x'.repeat(17 * 1024 * 1024);
  const server = Bun.serve({ unix: socket, fetch(request, server) { if (server.upgrade(request)) return; return new Response(null, {status:400}); }, websocket: {backpressureLimit:128*1024*1024,message(ws, text) { const frame = JSON.parse(String(text)); ws.send(JSON.stringify({ id: frame.id, result: frame.id === 'large' ? payload : 'connected' })); }} });
  const child = Bun.spawn([process.execPath, 'run', resolve('scripts/codex-proxy.ts'), process.execPath, resolve('tests/proxy-peer.ts'), socket], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' });
  const timeout = setTimeout(() => child.kill(), 10000);
  try {
    child.stdin.write('{"id":"large","method":"read"}\n{"id":"next","method":"read"}\n'); await child.stdin.flush();
    const iterator = ndjsonLines(child.stdout);
    const large = JSON.parse((await iterator.next()).value!); expect(large.id).toBe('large'); expect(large.result.length).toBe(payload.length);
    expect(JSON.parse((await iterator.next()).value!)).toEqual({id:'next',result:'connected'});

  } finally { clearTimeout(timeout); child.kill(); await child.exited; server.stop(true); await rm(directory, {recursive:true,force:true}); }
});
