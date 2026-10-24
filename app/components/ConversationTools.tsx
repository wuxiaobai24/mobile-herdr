import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, CornerUpLeft, Search, X } from 'lucide-react-native';
import { ActivityIndicator, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../theme';
import type { ChatMessage } from '../../shared/protocol';

interface Props {
  messages: ChatMessage[];
  onTarget: (id: string) => void;
  onPreviousUser: () => void;
  onOlder: () => void;
  more: boolean;
  busy: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConversationTools({ messages, onTarget, onPreviousUser, onOlder, more, busy, open, onOpenChange }: Props): React.JSX.Element | null {
  const { colors, styles } = useTheme();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>();
  const searchIndex = useMemo(() => messages.map(row => ({ id: row.id, text: `${row.text}\n${row.output ?? ''}`.toLocaleLowerCase() })), [messages]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = useMemo(() => needle ? searchIndex.filter(row => row.text.includes(needle)) : [], [searchIndex, needle]);
  const index = Math.max(0, matches.findIndex(row => row.id === selected));
  function select(id: string): void { setSelected(id); onTarget(id); }
  function go(delta: number): void {
    if (matches.length) select(matches[(index + delta + matches.length) % matches.length].id);
  }
  function edit(value: string): void {
    setQuery(value); setSelected(undefined);
    const needle = value.trim().toLocaleLowerCase();
    const first = needle && searchIndex.find(row => row.text.includes(needle));
    if (first) select(first.id);
  }
  if (width < 900 && !open) return null;
  const iconButton = { minWidth: 44, minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 8 };
  return <View testID="conversation-tools" style={{ paddingHorizontal: 12, paddingVertical: open ? 4 : 0, borderBottomWidth: open ? 1 : 0, borderColor: colors.line }}>
    {open && <View style={[styles.row, { gap: 4 }]}>
      <View style={[styles.row, { flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.surface, paddingLeft: 10, gap: 8 }]}>
        <Search size={16} color={colors.muted} />
        <TextInput accessibilityLabel="查找当前对话" value={query} onChangeText={edit} onSubmitEditing={() => go(1)} returnKeyType="search" blurOnSubmit={false}
          placeholder="查找已加载的消息" placeholderTextColor={colors.muted} style={{ flex: 1, minWidth: 0, minHeight: 44, color: colors.text, fontSize: 16, paddingVertical: 10, paddingRight: 8 }} />
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel="清空对话查找" onPress={() => edit('')} style={iconButton}><X size={15} color={colors.muted} /></Pressable>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭对话查找" onPress={() => { onOpenChange(false); edit(''); }} style={iconButton}><X size={18} color={colors.muted} /></Pressable>
    </View>}
    <View style={[styles.row, { gap: 4, minHeight: 44 }]}>
      {more && <Pressable accessibilityRole="button" accessibilityLabel="加载更早消息" disabled={busy} onPress={onOlder} style={[styles.row, { minHeight: 44, gap: 5, paddingRight: 8 }]}>
        {busy && <ActivityIndicator size="small" color={colors.accent} />}<Text style={{ color: colors.accent, fontSize: 13 }}>{busy ? '加载中…' : '更早消息'}</Text>
      </Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="上一条用户消息" onPress={onPreviousUser} style={[styles.row, iconButton, { paddingHorizontal: 8, gap: 4 }]}><CornerUpLeft size={16} color={colors.muted} />{!open && <Text style={{ color: colors.muted, fontSize: 13 }}>上一问</Text>}</Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>{open && <Text numberOfLines={1} testID="conversation-match-count" accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: 13, textAlign: 'right', paddingRight: 4 }}>{needle ? matches.length ? `${index + 1} / ${matches.length}` : '没有匹配' : ''}</Text>}</View>
      {open ? <>
        <Pressable accessibilityRole="button" accessibilityLabel="上一个匹配" disabled={!matches.length} onPress={() => go(-1)} style={[iconButton, { opacity: matches.length ? 1 : 0.35 }]}><ChevronUp size={18} color={colors.muted} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="下一个匹配" disabled={!matches.length} onPress={() => go(1)} style={[iconButton, { opacity: matches.length ? 1 : 0.35 }]}><ChevronDown size={18} color={colors.muted} /></Pressable>
      </> : <Pressable accessibilityRole="button" accessibilityLabel="查找对话" onPress={() => onOpenChange(true)} style={[styles.row, iconButton, { paddingHorizontal: 8, gap: 5 }]}><Search size={16} color={colors.muted} /><Text style={{ color: colors.muted, fontSize: 13 }}>查找</Text></Pressable>}
    </View>
  </View>;
}
