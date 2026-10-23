export interface PwaInstallState { installed: boolean; secure: boolean; available: boolean; install: () => Promise<boolean> }
export function usePwaInstall(): PwaInstallState { return { installed: true, secure: false, available: false, install: async () => false }; }
