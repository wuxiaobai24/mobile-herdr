import { Pressable, Text, View } from 'react-native';
import { ArrowRight, Bell, Check } from 'lucide-react-native';
import type { AttentionTarget } from '../../shared/attention';
import { useTheme } from '../theme';
interface Props { items: (AttentionTarget & { stale: boolean })[]; query: string; error: string; onSelect: (target: AttentionTarget) => void }
export function AttentionInbox({ items, query, error, onSelect }: Props): React.JSX.Element {
  const { colors, styles } = useTheme();
  const needle = query.trim().toLocaleLowerCase();
  const shown = items.filter(row => [row.machine.name, row.session, row.workspace, row.tab, row.pane.label, row.pane.pane_id, row.pane.agent].join(' ').toLocaleLowerCase().includes(needle));
  return <View testID="attention-inbox" style={{ gap: 6 }}>
    {!!error && <Text style={[styles.muted, { padding: 12, color: colors.amber }]}>{error}</Text>}
    {!shown.length && <View style={{ padding: 18, gap: 8 }}><Text style={styles.text}>{needle ? '没有找到匹配的会话' : '暂时没有需要处理的会话'}</Text><Text style={styles.muted}>等待确认和新完成的任务会出现在这里。</Text></View>}
    {shown.map(row => <Pressable key={`${row.machine.id}:${row.session}:${row.pane.terminal_id}`} accessibilityRole="button" accessibilityLabel={`处理 ${row.machine.name} ${row.session} ${row.pane.pane_id}`} onPress={() => onSelect(row)}
      style={[styles.row, { minHeight: 88, gap: 10, padding: 12, borderRadius: 10, backgroundColor: colors.surface }]}>
      {row.kind === 'blocked' ? <Bell size={17} color={colors.amber} /> : <Check size={17} color={colors.blue} />}
      <View style={{ flex: 1, gap: 5 }}><Text numberOfLines={1} style={styles.text}>{row.pane.label ?? row.pane.terminal_title_stripped ?? row.pane.pane_id}</Text>
        <Text numberOfLines={2} style={styles.muted}>{row.machine.name} · {row.session} · {row.workspace} / {row.tab} · {row.pane.pane_id}</Text>
        <Text style={{ fontSize: 12, color: row.stale ? colors.amber : colors.muted }}>{row.stale ? '待重新连接核对' : row.kind === 'blocked' ? '等待你确认' : '已完成 · 未读'}</Text></View><ArrowRight size={16} color={colors.dim} />
    </Pressable>)}
  </View>;
}
