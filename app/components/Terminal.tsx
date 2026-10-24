import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../theme';
import { copyText, readText } from '../clipboard';
import { useNetworkOnline } from '../useNetworkOnline';
import type { Machine } from '../../shared/protocol';

export default function Terminal({ machine, session, pane, active = true }: { machine: Machine; session: string; pane: string; active?: boolean }): React.JSX.Element {
  const { appearance, colors, styles } = useTheme();
  const view = useRef<WebView<object>>(null);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
  const network = useNetworkOnline();
  const enabled = active && foreground && network;
  const uri = machine.url + '/terminal.html';
  const inject = useCallback((message: object) => {
    view.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(JSON.stringify(message))}}));true;`);
  }, []);
  const connect = useCallback(() => {
    inject(enabled ? { type: 'connect', token: machine.token, machine: machine.remote, session, pane, appearance } : { type: 'suspend' });
  }, [enabled, machine.token, machine.remote, session, pane, appearance, inject]);
  useEffect(connect, [connect]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  return <View style={{ flex: 1, minHeight: 0 }}>
    <WebView<object> ref={view} source={{ uri }} style={{ flex: 1, backgroundColor: colors.bg }}
      javaScriptEnabled originWhitelist={[machine.url]} setSupportMultipleWindows={false} allowFileAccess={false} mixedContentMode="never"
      onShouldStartLoadWithRequest={request => request.url === uri || request.url === 'about:blank'}
      onLoadStart={() => { setLoading(true); setFailed(false); }} onLoadEnd={() => { setLoading(false); connect(); }}
      onError={() => { setFailed(true); setLoading(false); }} onHttpError={() => { setFailed(true); setLoading(false); }}
      onRenderProcessGone={() => { setFailed(true); setLoading(false); }}
      onMessage={event => {
        try {
          const message = JSON.parse(event.nativeEvent.data);
          if (message.type === 'terminal-ready') connect();
          if (message.type === 'read-clipboard' && typeof message.requestId === 'string') {
            const requestId = message.requestId;
            void readText().then(text => inject({ type: 'clipboard-text', requestId, text: text.slice(0, 32000) }))
              .catch(() => inject({ type: 'clipboard-text', requestId }));
          }
          if (message.type === 'copy' && typeof message.text === 'string' && message.text.length <= 200000) {
            void copyText(message.text).then(() => inject({ type: 'clipboard-result', ok: true })).catch(() => inject({ type: 'clipboard-result', ok: false }));
          }
        } catch { /* Ignore unknown messages; credentials are only sent to the selected origin. */ }
      }} />
    {loading && <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator color={colors.accent} /></View>}
    {failed && <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24, gap: 16 }}><Text style={styles.text}>终端加载失败，原会话仍在开发机运行。</Text><Pressable accessibilityRole="button" accessibilityLabel="重新加载终端" onPress={() => { setFailed(false); view.current?.reload(); }} style={styles.button}><Text style={styles.buttonText}>重新加载</Text></Pressable></View>}
  </View>;
}
