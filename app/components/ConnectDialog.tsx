import { useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ArrowRight, KeyRound, Server, X } from 'lucide-react-native';
import { connect, normalizeUrl, requestId } from '../../shared/client';
import type { BridgeInfo, Machine } from '../../shared/protocol';
import { useTheme, mono } from '../theme';
import type { Pairing } from '../pairing';

interface Props { visible: boolean; canClose: boolean; onClose: () => void; onConnect: (machine: Machine, info: BridgeInfo) => Promise<void>; pairing?: Pairing }
export function ConnectDialog({ visible, canClose, onClose, onConnect, pairing }: Props): React.JSX.Element {
  const { colors, styles } = useTheme();
  const { width } = useWindowDimensions();
  const defaultUrl = Platform.OS === 'web' ? `${location.protocol}//${location.hostname}:${location.port === '5173' ? '7331' : location.port || (location.protocol === 'https:' ? '443' : '80')}` : 'http://';
  const [url, setUrl] = useState(pairing?.url ?? defaultUrl);
  const [name, setName] = useState(pairing?.name ?? '');
  const [token, setToken] = useState(pairing?.token ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(): Promise<void> {
    setError(''); setBusy(true);
    try {
      const machine = { id: requestId(), url: normalizeUrl(url), name: name.trim(), token: token.trim() };
      if (machine.token.length < 24) throw new Error('请粘贴开发机上的完整连接密钥。');
      const info = await connect(machine);
      machine.name ||= info.name;
      await onConnect(machine, info);
      setToken('');
    } catch (error) { setError(error instanceof Error ? error.message : '连接失败。'); }
    finally { setBusy(false); }
  }
  return <Modal visible={visible} transparent animationType="none" onRequestClose={canClose ? onClose : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.overlay }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
      <View style={{ width: '100%', maxWidth: 448, backgroundColor: colors.sidebar, padding: width < 400 ? 20 : 28, borderRadius: 20, borderWidth: 1, borderColor: colors.line, gap: 20 }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}><View style={{ backgroundColor: colors.hover, padding: 12, borderRadius: 12 }}><Server size={23} color={colors.accent} /></View>{canClose && <Pressable accessibilityRole="button" accessibilityLabel="关闭连接窗口" onPress={onClose} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={colors.muted} /></Pressable>}</View>
        <View><Text style={{ fontSize: 24, fontWeight: '600', color: colors.text }}>连接你的开发机</Text><Text style={[styles.muted, { marginTop: 8, fontSize: 14, lineHeight: 23 }]}>接着原来的会话，继续电脑上的任务。</Text></View>
        <View><Text style={styles.label}>Bridge 地址</Text><TextInput accessibilityLabel="Bridge 地址" value={url} onChangeText={setUrl} placeholder="https://devbox.example.com" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={[styles.field, { fontFamily: mono }]} /></View>
        <View><Text style={styles.label}>连接密钥</Text><TextInput accessibilityLabel="连接密钥" value={token} onChangeText={setToken} placeholder="粘贴开发机生成的密钥" placeholderTextColor={colors.muted} secureTextEntry autoCapitalize="none" autoCorrect={false} style={styles.field} /></View>
        <View style={[styles.row, { gap: 9, alignItems: 'flex-start' }]}><KeyRound color={colors.dim} size={16} style={{ marginTop: 2 }} /><View style={{ flex: 1, gap: 4 }}><Text style={styles.muted}>开发机运行 bun run pair，扫码即可连接；也可从以下文件复制密钥。</Text><Text selectable style={[styles.muted, { fontFamily: mono, fontSize: 12 }]}>~/.local/state/mobile-herdr/token</Text></View></View>
        <View><Text style={styles.label}>机器名称（可选）</Text><TextInput accessibilityLabel="机器名称" value={name} onChangeText={setName} placeholder="自动使用开发机名称" placeholderTextColor={colors.muted} style={styles.field} /></View>
        {!!error && <Text accessibilityRole="alert" style={{ color: colors.red, lineHeight: 21, fontSize: 14 }}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="连接开发机" onPress={submit} disabled={busy || !token.trim()} style={[styles.button, { opacity: busy || !token.trim() ? 0.5 : 1 }]}>{busy ? <ActivityIndicator color={colors.accentInk} /> : <><Text style={styles.buttonText}>连接开发机</Text><ArrowRight size={17} color={colors.accentInk} /></>}</Pressable>
      </View>
    </ScrollView>
  </Modal>;
}
