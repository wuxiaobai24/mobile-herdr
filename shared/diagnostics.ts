export interface DiagnosticReport {
  schemaVersion: 1; bridgeVersion: string; bunVersion: string; platform: string; arch: string;
  herdr: { connected: boolean; version?: string; protocol?: number; sessionCount: number };
  ssh: { enabled: boolean; online: number; connecting: number; offline: number; disabled: number };
  native?: { provider: string; connected: boolean; status: string; control: 'desktop' | 'mobile'; pending: number };
  capabilities: { heartbeat: boolean; history: boolean; diff: boolean }; managed: boolean;
}
/** A strict allowlist prevents new server fields from leaking into shared reports. */
export function exportDiagnostics(report: DiagnosticReport, clientVersion: string): string {
  const safeVersion = (value: string) => typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value) ? value : 'unknown';
  const safeCount = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return JSON.stringify({ schemaVersion: 1, clientVersion: safeVersion(clientVersion), bridgeVersion: safeVersion(report.bridgeVersion), bunVersion: safeVersion(report.bunVersion),
    platform: ['linux', 'darwin', 'win32'].includes(report.platform) ? report.platform : 'other', arch: ['x64', 'arm64'].includes(report.arch) ? report.arch : 'other',
    herdr: { connected: !!report.herdr.connected, version: report.herdr.version ? safeVersion(report.herdr.version) : undefined, protocol: report.herdr.protocol ? safeCount(report.herdr.protocol) : undefined, sessionCount: safeCount(report.herdr.sessionCount) },
    ssh: { enabled: !!report.ssh.enabled, online: safeCount(report.ssh.online), connecting: safeCount(report.ssh.connecting), offline: safeCount(report.ssh.offline), disabled: safeCount(report.ssh.disabled) },
    native: report.native ? { provider: ['codex', 'pi', 'omp'].includes(report.native.provider) ? report.native.provider : 'other', connected: !!report.native.connected, status: ['idle', 'working', 'blocked', 'offline'].includes(report.native.status) ? report.native.status : 'unknown', control: report.native.control === 'desktop' ? 'desktop' : 'mobile', pending: safeCount(report.native.pending) } : undefined,
    capabilities: { heartbeat: !!report.capabilities.heartbeat, history: !!report.capabilities.history, diff: !!report.capabilities.diff }, managed: !!report.managed,
  }, null, 2);
}
