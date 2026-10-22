import { useEffect, useRef } from 'react';
import type { Machine } from '../../shared/protocol';

export default function Terminal({ machine, session, pane }: { machine: Machine; session: string; pane: string }): React.JSX.Element {
  const ref = useRef<HTMLIFrameElement>(null);
  function send(): void { ref.current?.contentWindow?.postMessage({ type: 'connect', token: machine.token, session, pane }, machine.url); }
  useEffect(send, [machine.url, machine.token, session, pane]);
  return <iframe ref={ref} className="terminal-frame" title="原始 Herdr 终端" src={machine.url + '/terminal.html'} onLoad={send} />;
}
