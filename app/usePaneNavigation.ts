import { useEffect, useRef, useState } from 'react';
import type { Machine, Pane } from '../shared/protocol';
import { machineScope } from '../shared/client';
import { emptyNavigation, readNavigation, rememberPane, type PaneMode, type PaneNavigation } from '../shared/navigation';
import { loadDraft, saveDraft } from './storage';

export function usePaneNavigation(machine: Machine | undefined, session: string, pane: Pane | undefined, mode: PaneMode) {
  const key = machine ? `pane-navigation:${machineScope(machine)}:${session}` : '';
  const [saved, setSaved] = useState<{ key: string; memory: PaneNavigation }>();
  const errorKey = useRef('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; setError('');
    if (key) void loadDraft(key).then(raw => { if (active) setSaved({ key, memory: readNavigation(raw) }); })
      .catch(() => { if (active) { setSaved({ key, memory: emptyNavigation() }); setError('无法读取标签页位置。'); } });
    return () => { active = false; };
  }, [key]);
  useEffect(() => {
    if (!pane || saved?.key !== key) return;
    setSaved(previous => {
      if (previous?.key !== key) return previous;
      const memory = rememberPane(previous.memory, pane, mode);
      return memory === previous.memory ? previous : { key, memory };
    });
  }, [key, saved?.key, pane?.pane_id, pane?.terminal_id, pane?.tab_id, mode]);
  useEffect(() => {
    if (!saved || saved.key !== key) return;
    errorKey.current = key;
    void saveDraft(key, JSON.stringify(saved.memory)).catch(() => { if (errorKey.current === key) setError('标签页位置未能保存。'); });
  }, [saved, key]);
  return { memory: saved?.key === key ? saved.memory : emptyNavigation(), error };
}
