import { expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { parseProfiles, profileRoute, SshMachines, openSsh, type RemoteEndpoint, type SshProfile } from '../server/ssh-machines';
import { createBridge } from '../server/server';
import { createFixture } from './fixture';
import { createNativeFixture } from './native-fixture';
import { api, panePath } from '../shared/client';
import type { Machine, Snapshot } from '../shared/protocol';
import type { NativeState } from '../shared/native';

const profile: SshProfile = { id: 'owned-profile', label: '远程开发机', target: 'owned-test', session: 'agents', enabled: true };
async function until<T>(read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 200; i++) { const value = await read(); if (value) return value; await Bun.sleep(25); }
  throw new Error('SSH fixture did not become ready.');
}

test('SSH profiles validate routing, isolate destinations and retain connections on catalog errors', async () => {
  expect(parseProfiles([profile])).toEqual([profile]);
  for (const row of [{ ...profile, target: '-oProxyCommand=bad' }, { ...profile, session: '../default' }, { ...profile, enabled: 'yes' }]) expect(() => parseProfiles([row])).toThrow();
  expect(profileRoute({ ...profile, label: 'renamed' })).toBe(profileRoute(profile));
  expect(profileRoute({ ...profile, target: 'different' })).not.toBe(profileRoute(profile));
  expect(profileRoute({ ...profile, session: 'other' })).not.toBe(profileRoute(profile));
  let profiles = [profile]; let failed = false; let connects = 0; let closes = 0;
  const manager = new SshMachines(async () => { if (failed) throw Error('catalog unavailable'); return profiles; }, async () => {
    connects++;
    let finish!: () => void;
    const closed = new Promise<void>(resolve => { finish = resolve; });
    return { url: 'http://127.0.0.1:1', token: 'fixture-only', closed, async close() { closes++; finish(); } };
  });
  try {
    await manager.refresh(); await until(() => connects === 1 && manager.destination(profileRoute(profile)));
    failed = true; await manager.refresh();
    expect((await manager.list()).machines[0].status).toBe('online');
    failed = false; profiles = [{ ...profile, label: '新名称' }]; await manager.refresh();
    expect((await manager.list()).machines[0].name).toBe('新名称'); expect(connects).toBe(1);
    profiles = [{ ...profile, enabled: false }]; await manager.refresh();
    expect(() => manager.destination(profileRoute(profile))).toThrow('禁用'); expect(closes).toBe(1);
    profiles = [{ ...profile, target: 'replacement' }]; await manager.refresh();
    expect(() => manager.destination(profileRoute(profile))).toThrow('更换目标');
    await until(() => connects === 2);
    profiles = []; await manager.refresh(); expect((await manager.list()).machines).toHaveLength(0);
  } finally { await manager.close(); }
});

test('gateway scopes equal pane IDs, request receipts and credentials to the selected SSH machine', async () => {
  const local = await createFixture(); const remote = await createFixture();
  const gateway = new SshMachines(async () => [profile], async () => ({ url: remote.url, token: remote.config.token, closed: new Promise(() => {}), async close() {} }));
  let bridge: ReturnType<typeof createBridge> | undefined;
  try {
    await gateway.refresh(); await until(() => { try { return gateway.destination(profileRoute(profile)); } catch {} });
    bridge = createBridge({ ...local.config, port: 0 }, { remotes: gateway });
    const base: Machine = { id: 'base', url: `http://127.0.0.1:${bridge.port}`, name: 'local', token: local.config.token };
    const selected = { ...base, remote: profileRoute(profile) };
    const path = panePath('default', 'w1:p1', 'prompt');
    await api(base, path, { body: { text: 'only-local' }, id: 'same-scoped-receipt' });
    await Promise.all([api(selected, path, { body: { text: 'only-remote' }, id: 'same-scoped-receipt' }), api(selected, path, { body: { text: 'only-remote' }, id: 'same-scoped-receipt' })]);
    expect(local.calls.filter(call => call.method === 'agent.prompt').map(call => call.params.text)).toEqual(['only-local']);
    expect(remote.calls.filter(call => call.method === 'agent.prompt').map(call => call.params.text)).toEqual(['only-remote']);
    await expect(api({ ...selected, remote: 'unreported-machine' }, path, { body: { text: 'never-send' } })).rejects.toMatchObject({ code: 'ssh_machine_unavailable' });
    const anonymous = await fetch(base.url + '/api/machines'); expect(anonymous.status).toBe(401);
    const catalog = await api<{ machines: unknown[] }>(base, '/api/machines'); expect(catalog.machines).toHaveLength(1);
    expect(JSON.stringify(catalog)).not.toContain(remote.config.token);
    const snapshot = await api<Snapshot>(selected, '/api/snapshot'); expect(snapshot.protocol).toBe(22);
  } finally { bridge?.stop(true); await gateway.close(); await remote.close(); await local.close(); }
});

// Opt-in only: creates its own sshd, host/client keys and fixture sockets; never uses user hosts or keys.
test.skipIf(process.env.MOBILE_HERDR_SSH_LIVE !== '1')('real OpenSSH: temporary worker routes native chat and terminal, then detaches without stopping the original agent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mhssh-'));
  const remote = await createNativeFixture();
  let daemon: Bun.Subprocess | undefined; let endpoint: RemoteEndpoint | undefined; let bridge: ReturnType<typeof createBridge> | undefined;
  const savedBinary = process.env.MOBILE_HERDR_SSH_BINARY;
  async function run(args: string[]): Promise<void> {
    const child = Bun.spawn(args, { stdout: 'ignore', stderr: 'pipe' }); const error = await new Response(child.stderr).text();
    if (await child.exited !== 0) throw Error(error);
  }
  function quote(text: string): string { return "'" + text.replaceAll("'", "'\\''") + "'"; }
  try {
    const portServer = createServer(); await new Promise<void>(resolve => portServer.listen(0, '127.0.0.1', resolve));
    const address = portServer.address(); if (!address || typeof address === 'string') throw Error('No test port.');
    const port = address.port; await new Promise<void>(resolve => portServer.close(() => resolve()));
    for (const name of ['host', 'client']) await run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', join(directory, name)]);
    const bin = join(directory, 'bin'); await mkdir(bin);
    const fakeHerdr = `#!${process.execPath}\nif(process.argv.includes('status')) console.log(JSON.stringify({running:true,socket:${JSON.stringify(remote.config.socket)}}));\nelse if(process.argv.includes('terminal')) { console.log('OWNED_SSH_TERMINAL'); process.stdin.on('data', data=>process.stdout.write('OWNED_INPUT:'+data)); }\nelse process.exit(1);\n`;
    await writeFile(join(bin, 'herdr'), fakeHerdr, { mode: 0o755 });
    // A private forced command exposes only this test's runtime environment and fixture.
    const forced = join(directory, 'forced');
    await writeFile(forced, `#!/bin/sh\nexport PATH=${quote(bin + ':' + process.env.PATH)}\nexport MOBILE_HERDR_STATE=${quote(remote.directory)}\nexec /bin/sh -c "$SSH_ORIGINAL_COMMAND"\n`, { mode: 0o700 });
    const publicKey = (await readFile(join(directory, 'client.pub'), 'utf8')).trim();
    await writeFile(join(directory, 'authorized'), `command="${forced}",no-agent-forwarding,no-X11-forwarding ${publicKey}\n`, { mode: 0o600 });
    await writeFile(join(directory, 'known'), `owned-host ${await readFile(join(directory, 'host.pub'), 'utf8')}`);
    await writeFile(join(directory, 'sshd_config'), `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${directory}/host\nPidFile ${directory}/pid\nAuthorizedKeysFile ${directory}/authorized\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nPermitRootLogin no\nStrictModes no\nAllowUsers ${userInfo().username}\nAllowStreamLocalForwarding yes\nLogLevel ERROR\n`);
    await writeFile(join(directory, 'ssh_config'), `Host owned-test\n HostName 127.0.0.1\n Port ${port}\n User ${userInfo().username}\n IdentityFile ${directory}/client\n IdentitiesOnly yes\n UserKnownHostsFile ${directory}/known\n HostKeyAlias owned-host\n ControlMaster no\n`);
    const ssh = Bun.which('ssh')!;
    const wrapper = join(directory, 'ssh-wrapper');
    await writeFile(wrapper, `#!/bin/sh\nexec ${quote(ssh)} -F ${quote(join(directory, 'ssh_config'))} "$@"\n`, { mode: 0o700 });
    process.env.MOBILE_HERDR_SSH_BINARY = wrapper;
    daemon = Bun.spawn([Bun.which('sshd')!, '-D', '-e', '-f', join(directory, 'sshd_config')], { stdout: 'ignore', stderr: 'pipe' });
    await Bun.sleep(100);
    if (daemon.exitCode !== null) throw Error(await new Response(daemon.stderr as ReadableStream<Uint8Array>).text());
    try { endpoint = await openSsh(profile); }
    catch (error) { daemon.kill(); await daemon.exited; throw new Error(String(error) + '\n' + await new Response(daemon.stderr as ReadableStream<Uint8Array>).text()); }
    const gateway = { async list() { return { machines: [{ id: profileRoute(profile), name: profile.label, session: profile.session, status: 'online' as const }] }; }, destination(id: string) { if (id !== profileRoute(profile)) throw Error('Wrong machine.'); return endpoint!; } };
    bridge = createBridge({ ...remote.config, port: 0 }, { remotes: gateway });
    const machine: Machine = { id: 'ssh-live', name: 'owned', url: `http://127.0.0.1:${bridge.port}`, token: remote.config.token, remote: profileRoute(profile) };
    const path = panePath('default', 'w1:p1', 'native');
    const before = await api<NativeState>(machine, path);
    expect(before.runtimeId).toBe(remote.control.state.runtimeId);
    async function act(action: string, values = {}, id: string = crypto.randomUUID()): Promise<void> {
      const current = await api<NativeState>(machine, path);
      await api(machine, path, { id, body: { action, runtimeId: current.runtimeId, conversationId: current.conversationId, epoch: current.epoch, clientId: 'owned-ssh-phone', ...values } });
    }
    await act('claim');
    await act('prompt', { text: 'owned SSH roundtrip' }, 'owned-ssh-once');
    await act('prompt', { text: 'owned SSH roundtrip' }, 'owned-ssh-once');
    expect(remote.control.state.messages.filter(row => row.role === 'user' && row.text === 'owned SSH roundtrip')).toHaveLength(1);
    await act('release');
    const socket = new WebSocket(machine.url.replace('http', 'ws') + '/api/terminal');
    let ready = false; let terminalText = ''; socket.binaryType = 'arraybuffer';
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token: machine.token, machine: machine.remote, session: 'default', pane: 'w1:p1' }));
    socket.onmessage = event => { if (typeof event.data === 'string') { if (JSON.parse(event.data).type === 'ready') ready = true; } else terminalText += new TextDecoder().decode(event.data); };
    await until(() => ready && terminalText.includes('OWNED_SSH_TERMINAL'));
    socket.send(JSON.stringify({ type: 'input', data: 'owned terminal input\n' }));
    await until(() => terminalText.includes('OWNED_INPUT:owned terminal input'));
    socket.close();
    await endpoint.close(); endpoint = undefined;
    expect(remote.control.state.connected).toBe(true); expect(remote.control.state.runtimeId).toBe(before.runtimeId);
    expect(remote.control.state.owner).toBe('desktop');
  } finally {
    if (savedBinary === undefined) delete process.env.MOBILE_HERDR_SSH_BINARY; else process.env.MOBILE_HERDR_SSH_BINARY = savedBinary;
    bridge?.stop(true); await endpoint?.close();
    if (daemon) { daemon.kill(); await daemon.exited; }
    await remote.close(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
