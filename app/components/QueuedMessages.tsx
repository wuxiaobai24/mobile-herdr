import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight, Clock3, X } from 'lucide-react-native';
import { queueStatusLabel, type QueuedMessage } from '../../shared/queue';
import { useTheme } from '../theme';
interface Props { rows: QueuedMessage[]; online: boolean; onChange: (row: QueuedMessage, action: 'send' | 'discard' | 'recover') => Promise<void>; onError: (message: string) => void; copyOnly?: boolean }
export function QueuedMessages({ rows, online, onChange, onError, copyOnly = false }: Props): React.JSX.Element | null {
  const { colors, styles } = useTheme();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pending = rows.filter(row => !['sent', 'cancelled'].includes(row.status));
  useEffect(() => { if (!pending.length) setOpen(false); }, [pending.length]);
  if (!pending.length) return null;
  async function act(row: QueuedMessage, action: 'send' | 'discard' | 'recover'): Promise<void> {
    setBusy(row.id); setError('');
    try { await onChange(row, action); }
    catch (error) { const message = error instanceof Error ? error.message : '无法处理队列消息。'; setError(message); onError(message); }
    finally { setBusy(''); }
  }
  const held = pending.some(row => ['held', 'uncertain'].includes(row.status));
  return <>
    <Pressable testID="queue-summary" accessibilityRole="button" accessibilityLabel="查看下一轮消息" onPress={() => setOpen(true)} style={[styles.row, { gap: 7, minHeight: 44, paddingHorizontal: 6 }]}><Clock3 size={15} color={held ? colors.amber : colors.muted} /><Text style={{ color: held ? colors.amber : colors.muted, fontSize: 13, flex: 1 }}>{held ? '有消息待核对' : '下一轮'} · {pending.length}</Text><ChevronRight size={15} color={colors.dim} /></Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}><View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}>
      <Pressable accessibilityLabel="关闭队列背景" onPress={() => setOpen(false)} style={{ flex: 1 }} />
      <SafeAreaView edges={['bottom']} style={{ maxHeight: '85%', padding: 16, backgroundColor: colors.sidebar, borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
        <View style={[styles.row, { gap: 10 }]}><Text style={[styles.text, { flex: 1, fontWeight: '600' }]}>下一轮消息 · {pending.length}</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭下一轮消息" onPress={() => setOpen(false)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={colors.muted} /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled">{!!error && <Text accessibilityRole="alert" style={{ color: colors.amber, lineHeight: 22, paddingVertical: 8 }}>{error}</Text>}{pending.map(row => <View key={row.id} testID={`queued-${row.id}`} style={{ paddingVertical: 12, gap: 8, borderBottomWidth: 1, borderColor: colors.line }}>
          <Text style={styles.muted}>{row.paneId}</Text><Text style={{ color: ['held', 'uncertain'].includes(row.status) ? colors.amber : colors.muted, fontSize: 13 }}>{queueStatusLabel[row.status]}</Text><Text selectable style={[styles.text, { lineHeight: 22 }]}>{row.text || '附件消息'}</Text>
          {!!row.attachments?.length && <Text style={styles.muted}>{row.attachments.length} 个附件</Text>}{!!row.detail && <Text style={[styles.muted, { lineHeight: 21 }]}>{row.detail}</Text>}
          <View style={[styles.row, { gap: 4, flexWrap: 'wrap' }]}>{row.status !== 'delivering' && <>
            {row.status !== 'uncertain' && <Pressable accessibilityRole="button" accessibilityLabel={`立即发送队列消息 ${row.id}`} disabled={!online || !!busy} onPress={() => void act(row, 'send')} style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', opacity: online && !busy ? 1 : 0.4 }}><Text style={{ color: colors.accent }}>{busy === row.id ? '处理中…' : '立即发送'}</Text></Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel={`${copyOnly ? '复制队列内容' : '取回队列草稿'} ${row.id}`} disabled={!!busy} onPress={() => void act(row, 'recover')} style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }}><Text style={styles.text}>{copyOnly ? '复制内容' : '取回草稿'}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`移除队列消息 ${row.id}`} disabled={!online || !!busy} onPress={() => void act(row, 'discard')} style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', opacity: online && !busy ? 1 : 0.4 }}><Text style={styles.muted}>移除</Text></Pressable>
          </>}</View>
        </View>)}</ScrollView>
      </SafeAreaView>
    </View></Modal>
  </>;
}
