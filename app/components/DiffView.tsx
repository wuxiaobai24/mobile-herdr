import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react-native';
import { suppliedChanges, type FileDiff } from '../../shared/diff';
import { copyText } from '../clipboard';
import { mono, useTheme } from '../theme';

export function DiffView({ value }: { value: unknown }): React.JSX.Element | null {
  const files = useMemo(() => suppliedChanges(value), [value]);
  if (!files.length) return null;
  return <View testID="diff-view" style={{ gap: 10 }}>{files.map((file, index) => <FileChange key={`${file.path}:${index}`} file={file} />)}</View>;
}
function FileChange({ file }: { file: FileDiff }): React.JSX.Element {
  const { colors, styles, appearance } = useTheme();
  const [open, setOpen] = useState(true), [limit, setLimit] = useState(40), [copied, setCopied] = useState(false), [error, setError] = useState('');
  async function copy(): Promise<void> { try { await copyText(file.patch); setCopied(true); setError(''); } catch (error) { setError(error instanceof Error ? error.message : '复制失败，请手动选择。'); } }
  return <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, overflow: 'hidden' }}>
    <View style={[styles.row, { gap: 8, backgroundColor: colors.sidebar, paddingHorizontal: 10 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`展开或折叠 ${file.path}`} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={[styles.row, { gap: 8, minHeight: 48, flex: 1 }]}>{open ? <ChevronDown size={15} color={colors.muted} /> : <ChevronRight size={15} color={colors.muted} />}<Text selectable style={{ flex: 1, color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 20 }}>{file.path}</Text></Pressable>
      <Text style={{ color: colors.addedText, fontFamily: mono, fontSize: 12 }}>+{file.added}</Text><Text style={{ color: colors.removedText, fontFamily: mono, fontSize: 12 }}>−{file.removed}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`复制补丁 ${file.path}`} onPress={() => void copy()} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>{copied ? <Check size={16} color={colors.success} /> : <Copy size={16} color={colors.muted} />}</Pressable>
    </View>
    {file.snippet && <Text style={[styles.muted, { paddingHorizontal: 12, paddingBottom: 6 }]}>文本片段 · 行号从片段起始计算</Text>}
    {!!file.previousPath && <Text style={[styles.muted, { paddingHorizontal: 12, paddingBottom: 8 }]}>{file.previousPath} → {file.path}</Text>}
    {open && <><ScrollView horizontal contentContainerStyle={{ flexDirection: 'column', minWidth: '100%' }}>
      {file.lines.slice(0, limit).map((line, i) => <View key={i} style={[styles.row, { minHeight: 22, backgroundColor: line.type === 'add' ? colors.accentSurface : line.type === 'remove' ? colors.errorSurface : colors.bg }]}>
        <Text style={{ color: colors.muted, fontFamily: mono, fontSize: 11, width: 36, textAlign: 'right', paddingRight: 6 }}>{line.old ?? ''}</Text><Text style={{ color: colors.muted, fontFamily: mono, fontSize: 11, width: 36, textAlign: 'right', paddingRight: 8 }}>{line.next ?? ''}</Text>
        <Text selectable style={{ color: line.type === 'add' ? colors.addedText : line.type === 'remove' ? colors.removedText : line.type === 'hunk' ? colors.muted : colors.text, fontFamily: mono, fontSize: Math.max(12, appearance.readingSize - 2), lineHeight: Math.max(21, appearance.readingSize * 1.5), paddingRight: 14 }}>{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}{line.text}</Text>
      </View>)}
    </ScrollView>{file.lines.length > limit && <Pressable accessibilityRole="button" onPress={() => setLimit(limit + 160)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}><Text style={{ color: colors.accent, fontSize: 13 }}>显示更多修改（剩余 {file.lines.length - limit} 行）</Text></Pressable>}{file.truncated && <Text style={[styles.muted, { padding: 12 }]}>补丁较大，显示部分内容；复制可查看已收到的完整补丁。</Text>}</>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.red, padding: 10, fontSize: 13 }}>{error}</Text>}
  </View>;
}
