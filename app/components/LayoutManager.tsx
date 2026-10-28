import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, X } from 'lucide-react-native';
import type { Machine, Pane, Snapshot } from '../../shared/protocol';
import type { LayoutAction, LayoutInput, LayoutResult } from '../../shared/layout';
import { api, machineScope, requestId } from '../../shared/client';
import { loadDraft, saveDraft } from '../storage';
import { useTheme } from '../theme';

export interface LayoutTarget { workspaceId: string; tabId?: string; paneId?: string; action?: LayoutAction }
interface Props { target: LayoutTarget; machine: Machine; session: string; snapshot: Snapshot; online: boolean; onClose: () => void; onResult: (result: LayoutResult) => void }
const titles: Record<LayoutAction, string> = { 'workspace.create': '新建工作区', 'tab.create': '新建标签页', 'pane.split': '拆分终端', 'workspace.rename': '重命名工作区', 'tab.rename': '重命名标签页', 'pane.rename': '重命名终端' };
export function LayoutManager({ target, machine, session, snapshot, online, onClose, onResult }: Props): React.JSX.Element {
  const { colors, styles } = useTheme();
  const workspace = snapshot.workspaces.find(row => row.workspace_id === target.workspaceId);
  const tab = snapshot.tabs.find(row => row.tab_id === target.tabId);
  const pane = snapshot.panes.find(row => row.pane_id === target.paneId);
  const [action, setAction] = useState(target.action);
  const [label, setLabel] = useState(''), [cwd, setCwd] = useState(pane?.foreground_cwd ?? pane?.cwd ?? '');
  const [direction, setDirection] = useState<'right' | 'down'>('down');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [ready, setReady] = useState(false);
  const receipt = useRef<{ fingerprint: string; id: string } | undefined>(undefined);
  const key = `layout:${machineScope(machine)}:${session}:${target.workspaceId}:${target.tabId ?? ''}:${target.paneId ?? ''}`;
  useEffect(() => {
    let active = true;
    void loadDraft(key).then(raw => {
      if (!active || !raw) return;
      try { const saved = JSON.parse(raw); if (saved.action in titles) { setAction(saved.action); setLabel(saved.label ?? ''); setCwd(saved.cwd ?? ''); setDirection(saved.direction ?? 'down'); receipt.current = saved.receipt; } } catch { /* A broken form must not prevent managing the current layout. */ }
    }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [key]);
  function choose(next: LayoutAction): void {
    setAction(next); setError(''); receipt.current = undefined;
    setLabel(next === 'workspace.rename' ? workspace?.label ?? '' : next === 'tab.rename' ? tab?.label ?? '' : next === 'pane.rename' ? pane?.label ?? '' : '');
  }
  async function submit(): Promise<void> {
    if (!action || busy || !online || !ready) return;
    const body: LayoutInput = { action, workspaceId: target.workspaceId, tabId: target.tabId, paneId: target.paneId, terminalId: pane?.terminal_id, label, cwd, direction };
    const fingerprint = JSON.stringify(body);
    if (receipt.current?.fingerprint !== fingerprint) receipt.current = { fingerprint, id: requestId() };
    setBusy(true); setError('');
    try {
      await saveDraft(key, JSON.stringify({ action, label, cwd, direction, receipt: receipt.current }));
      const result = await api<LayoutResult>(machine, `/api/layout?session=${encodeURIComponent(session)}`, { body, id: receipt.current.id });
      await saveDraft(key, ''); onResult(result); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作未确认，请刷新列表核对。'); }
    finally { setBusy(false); }
  }
  const creating = action === 'workspace.create' || action === 'tab.create' || action === 'pane.split';
  return <Modal visible transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>
      <Pressable accessibilityLabel="关闭布局管理背景" disabled={busy} onPress={onClose} style={{ flex: 1 }} />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.sidebar, maxHeight: '85%', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: colors.line }}>
        <View style={[styles.row, { minHeight: 56, paddingHorizontal: 12, gap: 8 }]}>
          {action && <Pressable accessibilityRole="button" accessibilityLabel="返回布局操作" disabled={busy} onPress={() => setAction(undefined)} style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}><ArrowLeft size={18} color={colors.muted} /></Pressable>}
          <Text style={[styles.text, { flex: 1, fontWeight: '600' }]}>{action ? titles[action] : '工作区与标签页'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭布局管理" disabled={busy} onPress={onClose} style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}><X size={20} color={colors.muted} /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
          <Text numberOfLines={2} style={styles.muted}>{machine.name} · {session} · {workspace?.label ?? target.workspaceId}{tab ? ' · ' + (tab.label ?? tab.tab_id) : ''}</Text>
          {!action ? (Object.keys(titles) as LayoutAction[]).filter(item => !item.startsWith('pane.') || !!pane).filter(item => item !== 'tab.rename' || !!tab).map(item => <Pressable accessibilityRole="button" accessibilityLabel={titles[item]} key={item} onPress={() => choose(item)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.text}>{titles[item]}</Text></Pressable>) : <>
            {action !== 'pane.split' && <TextInput accessibilityLabel="布局名称" value={label} onChangeText={setLabel} maxLength={120} placeholder={creating ? '名称（可选）' : '名称'} placeholderTextColor={colors.muted} editable={!busy} style={styles.field} />}
            {creating && <TextInput accessibilityLabel="新终端工作目录" value={cwd} onChangeText={setCwd} autoCapitalize="none" placeholder="开发机绝对目录（可选）" placeholderTextColor={colors.muted} editable={!busy} style={styles.field} />}
            {action === 'pane.split' && <View style={[styles.row, { gap: 8 }]}>{(['down', 'right'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value === 'down' ? '向下分屏' : '向右分屏'} accessibilityState={{ checked: direction === value }} disabled={busy} onPress={() => setDirection(value)} style={[styles.button, direction !== value && styles.secondary]}><Text style={direction === value ? styles.buttonText : styles.text}>{value === 'down' ? '向下' : '向右'}</Text></Pressable>)}</View>}
            {creating && <Text style={styles.muted}>创建后在手机打开新终端，保留电脑当前焦点。</Text>}
            {!!error && <Text accessibilityRole="alert" style={{ color: colors.amber, lineHeight: 22 }}>{error}</Text>}
            <Pressable accessibilityRole="button" accessibilityLabel="提交布局操作" disabled={busy || !online || !ready} onPress={() => void submit()} style={[styles.button, { opacity: busy || !online ? .5 : 1 }]}>{busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{creating ? '创建并打开' : '保存名称'}</Text>}</Pressable>
          </>}
        </ScrollView>
      </SafeAreaView>
    </View>
  </Modal>;
}
