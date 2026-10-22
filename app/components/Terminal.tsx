import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../theme';
import type { Machine } from '../../shared/protocol';

export default function Terminal({ machine, session, pane }: { machine: Machine; session: string; pane: string }): React.JSX.Element {
  const { appearance, colors } = useTheme();
  return <View style={{ flex: 1, minHeight: 250 }}><WebView
    source={{ uri: machine.url + '/terminal.html' }} style={{ flex: 1, backgroundColor: colors.bg }}
    javaScriptEnabled originWhitelist={[machine.url]}
    onShouldStartLoadWithRequest={request => request.url === machine.url + '/terminal.html' || request.url === 'about:blank'}
    injectedJavaScript={`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(JSON.stringify({ type: 'connect', token: machine.token, machine: machine.remote, session, pane, appearance }))}}));true;`}
  /></View>;
}
