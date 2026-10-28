import { useEffect, useRef, useState } from 'react';
import type { Machine } from '../shared/protocol';
import { downloadLabel, downloadResultLabel, type DownloadProgress } from '../shared/download';
import { ApiError } from '../shared/client';
import { saveProjectFile } from './file-transfer';
export function useFileDownload() {
  const current = useRef<AbortController | undefined>(undefined), mounted = useRef(true), lastUpdate = useRef(0);
  const lastPhase = useRef('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [progress, setProgress] = useState<DownloadProgress>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; current.current?.abort(); }; }, []);
  async function start(machine: Machine, path: string, name: string): Promise<void> {
    if (current.current) return;
    const controller = new AbortController(); current.current = controller;
    setBusy(true); setMessage(''); setError(''); setProgress({ phase: 'downloading', loaded: 0 }); lastUpdate.current = 0;
    try {
      const result = await saveProjectFile(machine, path, name, { signal: controller.signal, onProgress(value) {
        if (mounted.current && (Date.now() - lastUpdate.current > 150 || value.phase !== lastPhase.current || value.loaded === value.total)) { lastUpdate.current = Date.now(); lastPhase.current = value.phase; setProgress(value); }
      } });
      if (mounted.current) setMessage(downloadResultLabel(result));
    } catch (error) {
      if (mounted.current) {
        if (error instanceof ApiError && error.code === 'download_cancelled') setMessage(error.message);
        else setError(error instanceof Error ? error.message : '下载失败，请重试。');
      }
    } finally { current.current = undefined; if (mounted.current) { setBusy(false); setProgress(undefined); } }
  }
  return { busy, error, message: busy && progress ? downloadLabel(progress) : message, progress, start, cancel: () => current.current?.abort() };
}
