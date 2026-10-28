import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { api, machineScope, requestId, websocketUrl } from '../shared/client';
import type { Machine, Pane } from '../shared/protocol';
import type { NativeState } from '../shared/native';
import type { QueuedMessage } from '../shared/queue';
import { useNetworkOnline } from './useNetworkOnline';

export function useMessageQueue(machine: Machine | undefined, session: string, clientId: string) {
  const key = machine ? `${machineScope(machine)}:${session}:${clientId}` : '';
  const [state, setState] = useState<{ key: string; rows: QueuedMessage[] }>({ key: '', rows: [] });
  const [connection, setConnection] = useState<{ key: string; leaseId: string }>();
  const [active, setActive] = useState(Platform.OS === 'web' ? document.visibilityState !== 'hidden' : AppState.currentState !== 'background');
  const network = useNetworkOnline();
  const scope = useRef(key); scope.current = key;
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (Platform.OS !== 'web') setActive(state === 'active'); });
    const visibility = () => setActive(document.visibilityState !== 'hidden');
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', visibility);
    return () => { listener.remove(); if (Platform.OS === 'web') document.removeEventListener('visibilitychange', visibility); };
  }, []);
  async function refresh(): Promise<void> {
    if (!machine || !clientId) return;
    const rows = await api<QueuedMessage[]>(machine, `/api/queue?session=${encodeURIComponent(session)}&clientId=${encodeURIComponent(clientId)}`);
    if (scope.current === key) setState({ key, rows });
  }
  useEffect(() => {
    setConnection(undefined);
    if (!machine || !clientId || !active || !network) return;
    let closed = false, socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout>, heartbeat: ReturnType<typeof setInterval>, polling: ReturnType<typeof setTimeout>;
    let reading = false;
    async function read(): Promise<void> {
      if (closed || reading) return;
      reading = true;
      try { await refresh(); } catch { /* Keep the previous drafts through read failures. */ }
      finally { reading = false; if (!closed) polling = setTimeout(() => void read(), 1000); }
    }
    function open(): void {
      if (closed) return;
      const ws = new WebSocket(websocketUrl(machine!, '/api/queue/watch')); socket = ws;
      let seen = Date.now();
      ws.onopen = () => { if (!closed) ws.send(JSON.stringify({ type: 'auth', token: machine!.token, machine: machine!.remote, session, clientId })); };
      ws.onmessage = event => {
        if (closed || socket !== ws) return;
        try {
          const frame = JSON.parse(String(event.data)); seen = Date.now();
          if (frame.type === 'queue-ready' && typeof frame.leaseId === 'string') { setConnection({ key, leaseId: frame.leaseId }); void refresh().catch(() => {}); }
        } catch { ws.close(); }
      };
      ws.onclose = event => {
        if (closed || socket !== ws) return;
        clearInterval(heartbeat); setConnection(undefined);
        // Reconnect only the read/lease channel. Held messages are never re-armed.
        if (event.code !== 1008) retry = setTimeout(open, 1500);
      };
      ws.onerror = () => ws.close();
      heartbeat = setInterval(() => { if (Date.now() - seen > 12000) ws.close(); else if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' })); }, 3000);
    }
    open(); void read();
    return () => { closed = true; clearTimeout(retry); clearTimeout(polling); clearInterval(heartbeat); socket?.close(); };
  }, [key, machine?.token, active, network]);
  async function enqueue(pane: Pane, native: NativeState, text: string, skills: string[] | undefined, attachments: string[] | undefined, id: string): Promise<void> {
    if (!machine || connection?.key !== key) throw new Error('下一轮队列连接未就绪，草稿已保留。');
    await api(machine, `/api/queue?session=${encodeURIComponent(session)}`, { id, body: { action: 'enqueue', leaseId: connection.leaseId, clientId,
      paneId: pane.pane_id, terminalId: pane.terminal_id, runtimeId: native.runtimeId, conversationId: native.conversationId, epoch: native.epoch, text, skills, attachments } });
    await refresh().catch(() => {});
  }
  async function change(row: QueuedMessage, action: 'send' | 'discard'): Promise<void> {
    if (!machine) return;
    await api(machine, `/api/queue?session=${encodeURIComponent(session)}`, { id: requestId(), body: { action, clientId, id: row.id } });
    await refresh();
  }
  return { rows: state.key === key ? state.rows : [], ready: connection?.key === key && active && network, enqueue, change };
}
export type MessageQueueControl = ReturnType<typeof useMessageQueue>;
