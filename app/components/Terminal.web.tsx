import { useEffect, useRef } from 'react';
import { useTheme } from '../theme';
import type { Machine } from '../../shared/protocol';

export default function Terminal({ machine, session, pane }: { machine: Machine; session: string; pane: string; active?: boolean }): React.JSX.Element {
  const { appearance } = useTheme();
  const ref = useRef<HTMLIFrameElement>(null);
  function send(): void { ref.current?.contentWindow?.postMessage({ type: 'connect', token: machine.token, machine: machine.remote, session, pane, appearance }, machine.url); }
  useEffect(send, [machine.url, machine.token, machine.remote, session, pane, appearance]);
  return <iframe ref={ref} className="terminal-frame" title="原始 Herdr 终端" src={machine.url + '/terminal.html'} onLoad={send} />;
}
