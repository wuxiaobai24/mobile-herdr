import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import type { Machine } from '../../shared/protocol';
import type { UpdateState } from '../../server/updates';
import { api } from '../../shared/client';
import { useTheme } from '../theme';

export function UpdatePanel({ visible, onClose, machine }: { visible: boolean; onClose: () => void; machine?: Machine }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const [state, setState] = useState<UpdateState>();
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  useEffect(() => {
    if (!visible || !machine) return;
    let closed = false, timer: ReturnType<typeof setTimeout>;
    setState(undefined); setError('');
    async function poll(): Promise<void> {
      try {
        const next = await api<UpdateState>(machine!, '/api/update');
        if (closed) return;
        setState(next); setError('');
        if (next.phase === 'ready' && Platform.OS === 'web') {
          const registration = await navigator.serviceWorker?.getRegistration();
          await registration?.update();
        }
      } catch (error) { if (!closed) setError(error instanceof Error ? error.message : '检查失败。'); }
      if (!closed) timer = setTimeout(() => void poll(), 2000);
    }
    void poll(); return () => { closed = true; clearTimeout(timer); };
  }, [visible, machine?.id]);
  const active = pending || state?.phase === 'installing' || state?.phase === 'restarting';
  async function update(): Promise<void> {
    if (!machine || active) return;
    setPending(true); setError('');
    try { setState(await api<UpdateState>(machine, '/api/update', { body: {} })); }
    catch (error) { setError(error instanceof Error ? error.message : '更新提交失败，请先检查状态。'); }
    finally { setPending(false); }
  }
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}><View style={{ backgroundColor: colors.sidebar, padding: 22, gap: 18, borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
    <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={{ color: colors.text, fontSize: 20, fontWeight: '600' }}>更新 Mobile Herdr</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭版本更新" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={colors.muted} /></Pressable></View>
    {state ? <><Text style={styles.text}>当前 {state.current}{state.latest ? ` · 最新 ${state.latest}` : ''}</Text><Text accessibilityLiveRegion="polite" style={styles.text}>{state.message}</Text></> : <ActivityIndicator color={colors.accent} />}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.red, lineHeight: 22 }}>{error}</Text>}
    <Text style={styles.muted}>自动下载发布包并校验 SHA-256，切换 Web bridge。当前 agent 和对话继续运行；启动检查失败时自动回滚。</Text>
    {state && !state.supported && <Text style={styles.muted}>当前 bridge 未由服务命令管理。请让部署 agent 使用 mobile-herdr background 启动后再更新。</Text>}
    {state?.phase === 'ready' && Platform.OS === 'web' ? <Pressable accessibilityRole="button" onPress={() => window.location.reload()} style={styles.button}><Text style={styles.buttonText}>加载新版本</Text></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="一键更新到最新版本" disabled={!state?.available || !state?.supported || active} onPress={() => void update()} style={[styles.button, { opacity: !state?.available || !state?.supported || active ? 0.45 : 1 }]}>{active ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>更新到最新版本</Text>}</Pressable>}
  </View></View></Modal>;
}
