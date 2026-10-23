import { useEffect, useState } from 'react';
export interface PwaInstallState { installed: boolean; secure: boolean; available: boolean; install: () => Promise<boolean> }
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let pending: InstallPrompt | undefined;
let installed = false;
const listeners = new Set<() => void>();
const display = window.matchMedia('(display-mode: standalone)');
function changed(): void { for (const listener of listeners) listener(); }
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); pending = event as InstallPrompt; changed(); });
window.addEventListener('appinstalled', () => { pending = undefined; installed = true; changed(); });
export function usePwaInstall(): PwaInstallState {
  const [, update] = useState(0);
  useEffect(() => {
    const refresh = () => update(value => value + 1);
    listeners.add(refresh); display.addEventListener('change', refresh);
    return () => { listeners.delete(refresh); display.removeEventListener('change', refresh); };
  }, []);
  async function install(): Promise<boolean> {
    const prompt = pending;
    if (!prompt) return false;
    await prompt.prompt();
    const result = await prompt.userChoice;
    pending = undefined; changed();
    return result.outcome === 'accepted';
  }
  return { installed: installed || display.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
    secure: window.isSecureContext, available: !!pending, install };
}
