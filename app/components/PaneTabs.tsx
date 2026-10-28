import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, ChevronDown, MoreHorizontal, Plus, X } from 'lucide-react-native';
import type { Pane, Snapshot } from '../../shared/protocol';
import { statusLabel } from '../../shared/protocol';
import { tabPane, type PaneNavigation } from '../../shared/navigation';
import { useTheme } from '../theme';

interface Props { snapshot: Snapshot; pane: Pane; memory: PaneNavigation; onSelect: (pane: string) => void; onCreate: () => void; onManage: () => void }
export function PaneTabs({ snapshot, pane, memory, onSelect, onCreate, onManage }: Props): React.JSX.Element | null {
  const { colors, styles } = useTheme();
  const [open, setOpen] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const positions = useRef(new Map<string, { x: number; width: number }>());
  const viewport = useRef(0), offset = useRef(0);
  const tabs = snapshot.tabs.filter(tab => tab.workspace_id === pane.workspace_id);
  const panes = snapshot.panes.filter(row => row.tab_id === pane.tab_id);
  function reveal(): void {
    const row = positions.current.get(pane.tab_id);
    if (!row || !viewport.current) return;
    if (row.x < offset.current) scroll.current?.scrollTo({ x: row.x, animated: false });
    else if (row.x + row.width > offset.current + viewport.current) scroll.current?.scrollTo({ x: row.x + row.width - viewport.current, animated: false });
  }
  useEffect(() => { setOpen(false); reveal(); }, [pane.tab_id, pane.pane_id]);
  if (tabs.length < 2 && panes.length < 2) return null;
  return <>
    <View testID="pane-navigation" style={[styles.row, { minHeight: 44, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: colors.sidebar }]}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel="当前工作区标签页" style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 8, gap: 4 }}
        onLayout={event => { viewport.current = event.nativeEvent.layout.width; reveal(); }} onScroll={event => { offset.current = event.nativeEvent.contentOffset.x; }} scrollEventThrottle={80}>
        {tabs.map(tab => {
          const selected = tab.tab_id === pane.tab_id;
          const members = snapshot.panes.filter(row => row.tab_id === tab.tab_id);
          const color = members.some(row => row.agent_status === 'blocked') ? colors.amber : members.some(row => row.agent_status === 'working') ? colors.accent : colors.dim;
          return <Pressable key={tab.tab_id} accessibilityRole="tab" accessibilityLabel={`切换标签页 ${tab.tab_id}`} accessibilityHint={tab.label ?? tab.tab_id} accessibilityState={{ selected }} aria-selected={selected}
            onLayout={event => { positions.current.set(tab.tab_id, event.nativeEvent.layout); if (selected) reveal(); }}
            onPress={() => { const target = tabPane(snapshot, tab.tab_id, memory); if (target) onSelect(target.pane_id); }}
            style={[styles.row, { gap: 7, minHeight: 44, maxWidth: 176, paddingHorizontal: 12, borderBottomWidth: 2, borderColor: selected ? colors.accent : 'transparent' }]}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} /><Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, color: selected ? colors.text : colors.muted }}>{tab.label ?? tab.tab_id}</Text>
          </Pressable>;
        })}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="选择当前标签页终端" onPress={() => setOpen(true)} style={[styles.row, { gap: 4, minHeight: 44, paddingHorizontal: 8 }]}>
        {panes.length > 1 ? <><Text style={styles.muted}>{panes.findIndex(row => row.pane_id === pane.pane_id) + 1}/{panes.length}</Text><ChevronDown size={16} color={colors.muted} /></> : <MoreHorizontal size={18} color={colors.muted} />}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="在当前工作区新建标签页" onPress={onCreate} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Plus size={18} color={colors.muted} /></Pressable>
    </View>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>
      <Pressable accessibilityLabel="关闭标签页终端选择背景" onPress={() => setOpen(false)} style={{ flex: 1 }} />
      <SafeAreaView edges={['bottom']} style={{ maxHeight: '80%', backgroundColor: colors.sidebar, padding: 16, borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
        <View style={[styles.row, { gap: 8, marginBottom: 8 }]}><Text numberOfLines={2} style={[styles.text, { flex: 1, fontWeight: '600' }]}>{tabs.find(row => row.tab_id === pane.tab_id)?.label ?? pane.tab_id} · {panes.length} 个终端</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭标签页终端选择" onPress={() => setOpen(false)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={colors.muted} /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled">{panes.map(row => <Pressable key={row.pane_id} accessibilityRole="button" accessibilityLabel={`选择标签页终端 ${row.pane_id}`} accessibilityState={{ selected: row.pane_id === pane.pane_id }}
          onPress={() => { onSelect(row.pane_id); setOpen(false); }} style={[styles.row, { minHeight: 60, gap: 12, paddingHorizontal: 8, backgroundColor: row.pane_id === pane.pane_id ? colors.hover : 'transparent', borderRadius: 8 }]}>
          <View style={{ flex: 1, gap: 4 }}><Text numberOfLines={1} style={styles.text}>{row.label ?? row.terminal_title_stripped ?? row.pane_id}</Text><Text style={styles.muted}>{statusLabel[row.agent_status]} · {row.agent ?? 'Shell'} · {row.pane_id}</Text></View>{row.pane_id === pane.pane_id && <Check size={17} color={colors.accent} />}
        </Pressable>)}<Pressable accessibilityRole="button" accessibilityLabel="管理当前标签页" onPress={() => { setOpen(false); onManage(); }} style={{ minHeight: 48, paddingHorizontal: 8, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>管理标签页与终端</Text></Pressable></ScrollView>
      </SafeAreaView>
    </View></Modal>
  </>;
}
