import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { codexOptions, piResumeId, assertSessionAvailable } from '../scripts/agent-options';
import { acquireLaunchLock, clearStaleLaunchLock, launchLockPath, launchLockState } from '../scripts/agent-lock';
import { createNativeFixture } from './native-fixture';

const id = '12345678-1234-1234-1234-123456789abc';

test('launcher preserves shared Codex config and rejects ambiguous or conflicting entry points before spawning', () => {
  expect(codexOptions(['-c', 'model="local"', '--config=web_search="disabled"', '--enable', 'feature_a', '--disable=feature_b', '--strict-config', '-m', 'local', '--no-alt-screen']).serverArgs)
    .toEqual(['-c', 'model="local"', '--config', 'web_search="disabled"', '--enable', 'feature_a', '--disable', 'feature_b', '--strict-config']);
  expect(codexOptions(['-C', '/tmp/resume', 'resume', '-m', 'local', id]).resumeId).toBe(id);
  expect(codexOptions(['--', 'resume']).resumeId).toBeUndefined();
  expect(codexOptions(['-m', 'local', '--image', 'private.png', '--', 'initial prompt']).reattachArgs).toEqual(['-m', 'local']);
  for (const args of [['--remote=ws://elsewhere'], ['exec', 'hello'], ['resume'], ['resume', '--last'], ['resume', 'short-id'], ['-m'], ['--profile', 'work'], ['--unknown=value']]) {
    expect(() => codexOptions(args)).toThrow();
  }
});

test('launcher resolves exact Pi file identity and refuses implicit resume or noninteractive modes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mh-options-'));
  try {
    await writeFile(join(directory, 'session with spaces.jsonl'), JSON.stringify({ type: 'session', id }) + '\n' + 'private transcript '.repeat(5000));
    expect(await piResumeId(['--session', './session with spaces.jsonl'], directory)).toBe(id);
    expect(await piResumeId(['--session=' + id])).toBe(id);
    expect(await piResumeId(['--model', 'resume', '--', '--resume'])).toBeUndefined();
    for (const args of [['--continue'], ['--resume'], ['--session', 'short-id'], ['--mode', 'rpc'], ['--print'], ['auth', 'list']]) {
      await expect(piResumeId(args, directory)).rejects.toThrow();
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('launcher mutex blocks concurrent attach, survives pane alias changes, and only explicitly clears dead owners', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mh-lock-'));
  const identity = { herdrSocket: '/owned-test.sock', paneId: 'w1:p1', terminalId: 'test-terminal' };
  const path = launchLockPath(directory, identity);
  try {
    expect(launchLockPath(directory, { ...identity, paneId: 'moved-pane' })).toBe(path);
    const unlock = await acquireLaunchLock(path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(acquireLaunchLock(path)).rejects.toThrow('已有启动器');
    await expect(clearStaleLaunchLock(path)).rejects.toThrow('仍在运行');
    await unlock();
    expect(await launchLockState(path)).toBeUndefined();
    const child = Bun.spawn([process.execPath, '-e', ''], { stdout: 'ignore', stderr: 'ignore' });
    await child.exited;
    await writeFile(path, JSON.stringify({ pid: child.pid }), { mode: 0o600 });
    expect((await launchLockState(path))?.alive).toBe(false);
    expect(await clearStaleLaunchLock(path)).toBe(true);
    expect(await clearStaleLaunchLock(path)).toBe(false);
    const again = await acquireLaunchLock(path); await again();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('launcher status/doctor are scoped read-only queries and never print conversation contents or credentials', async () => {
  const fixture = await createNativeFixture();
  const env = { ...process.env, HERDR_SOCKET_PATH: fixture.config.socket, HERDR_PANE_ID: fixture.snapshot.panes[0].pane_id, MOBILE_HERDR_STATE: fixture.directory };
  try {
    fixture.control.message({ id: 'private', role: 'user', text: 'DO_NOT_PRINT_CHAT_OR_TOKEN' });
    const child = Bun.spawn([process.execPath, 'run', resolve('scripts/agent.ts'), 'status', '--json'], { env, stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    const status = JSON.parse(output);
    expect(status.runtime).toBe(fixture.control.state.runtimeId);
    expect(status.conversation).toBe('test-thread-original');
    expect(output).not.toContain('DO_NOT_PRINT_CHAT_OR_TOKEN');
    expect(output).not.toContain(fixture.config.token);
    const other = { ...fixture.snapshot.panes[1], agent_session: { agent: 'codex', kind: 'id' as const, source: 'test', value: id } };
    expect(() => assertSessionAvailable([other], fixture.snapshot.panes[0], id)).toThrow('另一个 Herdr pane');
    const doctor = Bun.spawn([process.execPath, 'run', resolve('scripts/agent.ts'), 'doctor', '--json'], { env, stdout: 'pipe', stderr: 'pipe' });
    const checks = JSON.parse(await new Response(doctor.stdout).text());
    expect(await doctor.exited).toBe(0);
    expect(checks.herdr).toBe('已连接当前 pane');
    const stopHelp = Bun.spawn([process.execPath, 'run', resolve('scripts/agent.ts'), 'stop', '--help'], { env, stdout: 'ignore', stderr: 'pipe' });
    expect(await stopHelp.exited).toBe(0);
    expect(fixture.control.state.connected).toBe(true);
    expect(fixture.calls.every(call => call.method === 'session.snapshot')).toBe(true);
  } finally { await fixture.close(); }
});

test('CLI help/version do not require or contact Herdr and cannot create a background agent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mh-help-'));
  try {
    const entry = join(directory, 'fake-codex');
    await writeFile(entry, '#!/bin/sh\nprintf "original-cli-help\\n"\n', { mode: 0o755 });
    const env = { ...process.env, MOBILE_HERDR_CODEX_BINARY: entry, HERDR_SOCKET_PATH: join(directory, 'missing.sock'), HERDR_PANE_ID: 'absent', MOBILE_HERDR_STATE: directory };
    const child = Bun.spawn([process.execPath, 'run', resolve('scripts/agent.ts'), 'codex', '--help'], { env, stdout: 'pipe', stderr: 'pipe' });
    expect(await new Response(child.stdout).text()).toBe('original-cli-help\n');
    expect(await child.exited).toBe(0);
    expect(await stat(join(directory, 'native')).catch(() => null)).toBe(null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a dedicated shared Codex backend does not pass no-daemon to its remote TUI', () => { expect(codexOptions(['--no-daemon']).reattachArgs).toEqual([]); });
