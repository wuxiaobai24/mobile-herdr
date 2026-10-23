import { copyText } from '../clipboard';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileDiff, Copy, Check, X } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme, mono } from '../theme';
import { conversationChanges, type ConversationChange } from '../../shared/conversation-diff';
import type { ChatMessage } from '../../shared/protocol';
import { DiffView } from './DiffView';

function Change({ file }: { file: ConversationChange }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const [open, setOpen] = useState(false), [copied, setCopied] = useState(false), [error, setError] = useState('');
  async function copy(): Promise<void> { try { await copyText(file.patches.join('\n\n')); setCopied(true); } catch { setError('复制失败，请选择补丁文本。'); } }
  return <View style={{ borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 4 }}>
    <View style={[styles.row, { gap: 8 }]}><Pressable accessibilityRole="button" accessibilityLabel={`查看文件改动 ${file.path}`} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={[styles.row, { gap: 8, minHeight: 56, flex: 1 }]}>
      {open ? <ChevronDown size={16} color={colors.muted} /> : <ChevronRight size={16} color={colors.muted} />}<Text style={{ flex: 1, color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 20 }}>{file.path}</Text><Text style={{ color: colors.addedText, fontSize: 12 }}>+{file.added}</Text><Text style={{ color: colors.removedText, fontSize: 12 }}>−{file.removed}</Text>
    </Pressable><Pressable accessibilityRole="button" accessibilityLabel={`复制文件改动 ${file.path}`} onPress={() => void copy()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>{copied ? <Check size={16} color={colors.accent} /> : <Copy size={16} color={colors.muted} />}</Pressable></View>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.red }}>{error}</Text>}
    {open && <View style={{ gap: 14, paddingBottom: 12 }}>{file.patches.map((patch, index) => <View key={index} style={{ gap: 8 }}>{file.patches.length > 1 && <Text style={styles.muted}>第 {index + 1} 次修改</Text>}<DiffView value={patch} hideHeader /></View>)}</View>}
  </View>;
}
export function ChangesPanel({ visible, onClose, messages }: { visible: boolean; onClose: () => void; messages: ChatMessage[] }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const files = useMemo(() => visible ? conversationChanges(messages) : [], [messages, visible]);
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: colors.bg, width: '100%', maxWidth: 1000, alignSelf: 'center' }}>
      <View style={[styles.row, { paddingHorizontal: 16, minHeight: 60, gap: 10, borderBottomWidth: 1, borderColor: colors.line }]}><FileDiff size={20} color={colors.muted} /><Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', flex: 1 }}>改动 · {files.length} 个文件</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭改动视图" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={colors.muted} /></Pressable></View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text style={[styles.muted, { marginBottom: 12 }]}>当前对话已上报的改动。</Text>
        {files.map(file => <Change key={file.path} file={file} />)}
        {!files.length && <Text style={styles.text}>当前对话还没有文件改动。新的补丁会自动显示在这里。</Text>}
      </ScrollView>
    </View>
  </Modal>;
}
