import { mkdir, readdir, stat } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';
import type { Session } from '../shared/protocol';
import { BridgeError } from './rpc';
import { savedToken, stateDirectory, validateToken } from './auth-token';

export interface BridgeConfig {
  host: string; port: number; name: string; token: string; origins: string[];
  herdrHome: string; socket?: string; stateDir: string;
  codexHome: string; claudeHome: string; piHome: string;
}
export async function loadConfig(overrides: { token?: string } = {}): Promise<BridgeConfig> {
  const stateDir = stateDirectory();
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const token = validateToken(overrides.token ?? process.env.MOBILE_HERDR_TOKEN ?? await savedToken(stateDir));
  return {
    host: process.env.MOBILE_HERDR_HOST ?? '127.0.0.1', port: Number(process.env.MOBILE_HERDR_PORT ?? 7331),
    name: process.env.MOBILE_HERDR_NAME ?? hostname(), token,
    origins: (process.env.MOBILE_HERDR_ORIGINS ?? '').split(',').filter(Boolean),
    herdrHome: process.env.MOBILE_HERDR_HERDR_HOME ?? join(homedir(), '.config/herdr'),
    socket: process.env.HERDR_SOCKET ?? process.env.MOBILE_HERDR_SOCKET, stateDir,
    codexHome: process.env.CODEX_HOME ?? join(homedir(), '.codex'),
    claudeHome: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
    piHome: process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent'),
  };
}
export function validToken(config: BridgeConfig, token: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(config.token), digest(token));
}
export function allowedOrigin(config: BridgeConfig, request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin || config.origins.includes(origin);
}
export async function sessions(config: BridgeConfig): Promise<(Session & { socket: string })[]> {
  if (config.socket) return [{ id: 'default', name: '当前 session', socket: config.socket }];
  const candidates = [{ id: 'default', name: 'default', socket: join(config.herdrHome, 'herdr.sock') }];
  const directory = join(config.herdrHome, 'sessions');
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) if (entry.isDirectory()) {
    candidates.push({ id: entry.name, name: entry.name, socket: join(directory, entry.name, 'herdr.sock') });
  }
  const active = await Promise.all(candidates.map(async session => (await stat(session.socket).catch(() => null))?.isSocket() ? session : null));
  return active.filter((session): session is NonNullable<typeof session> => session !== null);
}
export async function resolveSession(config: BridgeConfig, id: string): Promise<string> {
  const session = (await sessions(config)).find(session => session.id === id);
  if (!session) throw new BridgeError('session_not_found', '此 session 已离线，请刷新 session 列表。', 404);
  return session.socket;
}
export function cliEnvironment(socket: string): Record<string, string | undefined> {
  return { ...process.env, HERDR_SOCKET: socket, HERDR_SOCKET_PATH: socket, HERDR_CONFIG_PATH: join(dirname(socket), 'config.toml'), TERM: 'xterm-256color' };
}
