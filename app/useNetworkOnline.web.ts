import { useEffect, useState } from 'react';
export function useNetworkOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    function update(): void { setOnline(navigator.onLine); }
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}
