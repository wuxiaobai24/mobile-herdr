import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import AppStatusBar from './components/AppStatusBar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowRight, Bell, Check, ChevronDown, ChevronRight, CircleHelp, Folder, Layers2, Menu, MessageSquare, Monitor, Plus, RefreshCw, Search, Server, TerminalSquare, Trash2, Wifi, X } from 'lucide-react-native';
import type { BridgeInfo, Machine, Pane } from '../shared/protocol';
import { statusLabel } from '../shared/protocol';
import { connect } from '../shared/client';
import { colors, mono, styles } from './theme';
import { loadMachines, saveMachines, loadDraft, saveDraft } from './storage';
import { useConnection } from './useConnection';
import { useKeyboardVisible } from './useKeyboardVisible';
import { consumePairing } from './pairing';
import { ConnectDialog } from './components/ConnectDialog';
import { Composer } from './components/Composer';
import { Conversation } from './components/Conversation';
import Terminal from './components/Terminal';
import { useNativeControl } from './useNativeControl';
import { NativeSession } from './components/NativeSession';
import { NativeRequests } from './components/NativeRequests';

function stateColor(status: string): string {
  if (status === 'working') return colors.accent;
  if (status === 'blocked') return colors.amber;
  if (status === 'done') return colors.blue;
  return colors.dim;
}
function Dot({ status }: { status: string }): React.JSX.Element { return <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: stateColor(status) }} />; }
function HerdMark(): React.JSX.Element { return <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' }}><Layers2 size={20} color={colors.accentInk} strokeWidth={2.1} /></View>; }
function IconButton({ label, onPress, children, active = false }: { label: string; onPress: () => void; children: React.ReactNode; active?: boolean }): React.JSX.Element {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: active ? colors.hover : 'transparent' }}>{children}</Pressable>;
}

function Workbench(): React.JSX.Element {
  const { width, height } = useWindowDimensions();
  const desktop = width >= 900;
  const keyboardVisible = useKeyboardVisible();
  const compact = !desktop && (keyboardVisible || height < 560);
  const [pairing] = useState(consumePairing);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [activeId, setActiveId] = useState('');
  const [info, setInfo] = useState<BridgeInfo>();
  const [session, setSession] = useState('default');
  const [paneId, setPaneId] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [machinePanel, setMachinePanel] = useState(false);
  const [mode, setMode] = useState<'chat' | 'terminal'>('chat');
  const [query, setQuery] = useState('');
  const [attention, setAttention] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [help, setHelp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const machine = machines.find(item => item.id === activeId);
  const connection = useConnection(machine, session, paneId);
  const snapshot = connection.snapshot;
  const originalPane = snapshot?.panes.find(item => item.pane_id === paneId);
  const native = connection.native;
  const control = useNativeControl(machine, session, paneId, native);
  const pane = originalPane && native ? { ...originalPane, agent: native.provider, agent_status: native.status === 'offline' ? 'unknown' as const : native.status } : originalPane;
  const workspace = snapshot?.workspaces.find(item => item.workspace_id === pane?.workspace_id);
  const online = connection.status === 'live';
  const counts = { working: snapshot?.panes.filter(item => item.agent && item.agent_status === 'working').length ?? 0, blocked: snapshot?.panes.filter(item => item.agent && item.agent_status === 'blocked').length ?? 0 };

  function notify(text: string, error = false): void { setNotice(text); setNoticeError(error); }
  useEffect(() => {
    void Promise.all([loadMachines(), loadDraft('active-machine')]).then(([saved, active]) => { setMachines(saved); setActiveId(saved.find(item => item.id === active)?.id ?? saved[0]?.id ?? ''); setShowConnect(!!pairing || !saved.length); }).catch(() => { setShowConnect(true); notify('无法读取已保存的开发机。', true); }).finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (!machine) return;
    let cancelled = false;
    setConnecting(true); setRestoring(true); setInfo(undefined); setPaneId(undefined); setSession('default');
    void Promise.all([connect(machine), loadDraft(`location:${machine.url}`)]).then(([result, saved]) => {
      if (cancelled) return;
      let location: { session?: string; pane?: string } = {};
      try { location = JSON.parse(saved || '{}'); } catch { /* Use the first available session. */ }
      const next = result.sessions.find(item => item.id === location.session)?.id ?? result.sessions[0]?.id ?? 'default';
      setInfo(result); setSession(next); setPaneId(next === location.session && typeof location.pane === 'string' ? location.pane : undefined);
    }).catch(error => { if (!cancelled) notify(error.message, true); }).finally(() => { if (!cancelled) { setConnecting(false); setRestoring(false); } });
    return () => { cancelled = true; };
  }, [machine?.id]);
  useEffect(() => {
    if (!snapshot || restoring) return;
    if (!snapshot.panes.some(item => item.pane_id === paneId)) {
      const target = snapshot.panes.find(item => item.pane_id === snapshot.focused_pane_id) ?? snapshot.panes.find(item => item.agent) ?? snapshot.panes[0];
      setPaneId(target?.pane_id);
    }
  }, [snapshot, paneId, restoring]);
  useEffect(() => {
    if (!machine || restoring || !paneId || !snapshot?.panes.some(item => item.pane_id === paneId)) return;
    void Promise.all([saveDraft('active-machine', machine.id), saveDraft(`location:${machine.url}`, JSON.stringify({ session, pane: paneId }))]).catch(() => notify('无法保存上次打开的会话。', true));
  }, [machine?.id, machine?.url, session, paneId, restoring, !!snapshot]);
  useEffect(() => { if (!notice || noticeError) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice, noticeError]);

  async function addMachine(next: Machine, result: BridgeInfo): Promise<void> {
    const existing = machines.find(item => item.url === next.url);
    const saved = existing ? machines.map(item => item.id === existing.id ? { ...next, id: existing.id } : item) : [...machines, next];
    if (saved.length > 16) throw new Error('最多保存 16 台开发机。');
    await saveMachines(saved); setMachines(saved); setActiveId(existing?.id ?? next.id); setInfo(result); setShowConnect(false); setMachinePanel(false);
    if (existing?.id === activeId) connection.reconnect();
  }
  async function removeMachine(id: string): Promise<void> {
    const saved = machines.filter(item => item.id !== id);
    try { await saveMachines(saved); setMachines(saved); if (id === activeId) { setPaneId(undefined); setInfo(undefined); setActiveId(saved[0]?.id ?? ''); } if (!saved.length) setShowConnect(true); }
    catch { notify('移除开发机失败。', true); }
  }
  function selectPane(id: string): void { setPaneId(id); setDrawer(false); setMode('chat'); setNotice(''); }
  const visibleWorkspaces = snapshot?.workspaces.filter(item => {
    const panes = snapshot.panes.filter(pane => pane.workspace_id === item.workspace_id);
    return (!attention || panes.some(pane => pane.agent_status === 'blocked')) && (!query || `${item.label} ${panes.map(pane => pane.terminal_title_stripped ?? pane.cwd).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  }) ?? [];

  const sidebar = <View style={{ width: desktop ? 270 : '100%', flex: desktop ? undefined : 1, flexShrink: 0, backgroundColor: colors.sidebar, borderRightWidth: 1, borderColor: colors.line }}>
    <View style={[styles.row, { minHeight: 69, paddingHorizontal: 20, justifyContent: 'space-between', borderBottomWidth: 1, borderColor: colors.line }]}>
      <Pressable onPress={() => setMachinePanel(true)} style={[styles.row, { gap: 10, flex: 1 }]}><Monitor size={17} color={colors.accent} /><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{machine?.name ?? '开发机'}</Text><Text style={[styles.muted, { fontSize: 12 }]}>{online ? '已连接' : connection.status === 'connecting' ? '连接中' : '已断开'}</Text></View><ChevronDown size={15} color={colors.muted} /></Pressable>
      {!desktop && <IconButton label="关闭会话列表" onPress={() => setDrawer(false)}><X size={18} color={colors.muted} /></IconButton>}
    </View>
    <View style={{ padding: 16, gap: 16 }}>
      <View style={[styles.row, { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 7, paddingHorizontal: 10, gap: 8 }]}><Search size={15} color={colors.dim} /><TextInput accessibilityLabel="搜索会话" value={query} onChangeText={setQuery} placeholder="搜索工作区或会话" placeholderTextColor={colors.dim} style={{ flex: 1, color: colors.text, fontSize: 13, minHeight: 38 }} /></View>
      <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.muted}>Herdr session</Text><Pressable onPress={() => setHelp(true)} accessibilityLabel="Session 说明"><CircleHelp size={14} color={colors.dim} /></Pressable></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>{(info?.sessions ?? [{ id: session, name: session }]).map(item => <Pressable key={item.id} onPress={() => { setPaneId(undefined); setSession(item.id); setNotice(''); }} style={{ backgroundColor: session === item.id ? colors.hover : colors.bg, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 6 }}><Text style={{ color: session === item.id ? colors.accent : colors.muted, fontSize: 13, fontFamily: mono }}>{item.name}</Text></Pressable>)}</ScrollView>
    </View>
    <View style={[styles.row, { paddingHorizontal: 18, paddingTop: 7, paddingBottom: 10, justifyContent: 'space-between' }]}><Text style={styles.muted}>{attention ? '需要你处理' : '工作区'}</Text><Text style={[styles.muted, { fontFamily: mono }]}>{visibleWorkspaces.length.toString().padStart(2, '0')}</Text></View>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 9, paddingBottom: 20, gap: 8 }}>
      {!snapshot && <View style={{ padding: 20, gap: 12 }}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{connecting ? '正在连接开发机…' : '等待 Herdr session…'}</Text></View>}
      {!!snapshot && !visibleWorkspaces.length && <Text style={[styles.muted, { padding: 14 }]}>{attention ? '没有等待处理的 agent。' : '没有匹配的工作区。'}</Text>}
      {visibleWorkspaces.map(item => <View key={item.workspace_id}>
        <Pressable onPress={() => { const target = snapshot?.panes.find(pane => pane.workspace_id === item.workspace_id && pane.tab_id === item.active_tab_id) ?? snapshot?.panes.find(pane => pane.workspace_id === item.workspace_id); if (target) selectPane(target.pane_id); }} style={[styles.row, { paddingHorizontal: 10, paddingVertical: 9, gap: 9 }]}><Folder size={16} color={item.workspace_id === pane?.workspace_id ? colors.accent : colors.dim} /><Text style={{ color: colors.text, fontSize: 14, fontWeight: '500', flex: 1 }}>{item.label ?? item.workspace_id}</Text><ChevronDown size={13} color={colors.dim} /></Pressable>
        {snapshot?.panes.filter(pane => pane.workspace_id === item.workspace_id).map(item => <Pressable key={item.pane_id} onPress={() => selectPane(item.pane_id)} accessibilityRole="button" accessibilityLabel={`打开 ${item.pane_id}`} style={[styles.row, { paddingLeft: 35, paddingRight: 11, paddingVertical: 10, gap: 9, borderRadius: 7, backgroundColor: paneId === item.pane_id ? colors.hover : 'transparent' }]}><Dot status={item.agent_status} /><View style={{ flex: 1, gap: 2 }}><Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>{item.label ?? item.terminal_title_stripped ?? item.agent ?? '终端'}</Text><Text style={{ color: colors.dim, fontSize: 12 }}>{item.agent ?? 'Shell'} · {statusLabel[item.agent_status]}</Text></View></Pressable>)}
      </View>)}
    </ScrollView>
    <View style={[styles.row, { padding: 17, borderTopWidth: 1, borderColor: colors.line, gap: 8 }]}><Wifi size={14} color={online ? colors.accent : colors.amber} /><Text style={[styles.muted, { flex: 1, fontSize: 12 }]}>herdr {snapshot?.version ?? '—'} · p{snapshot?.protocol ?? '—'}</Text><IconButton label="刷新连接" onPress={() => { connection.reconnect(); if (machine) void connect(machine).then(setInfo).catch(error => notify(error.message, true)); }}><RefreshCw size={14} color={colors.dim} /></IconButton></View>
  </View>;

  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}><AppStatusBar style="light" />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {desktop && <View style={{ width: 65, backgroundColor: '#0c1011', borderRightWidth: 1, borderColor: colors.line, alignItems: 'center', paddingVertical: 19, gap: 22 }}><HerdMark /><View style={{ gap: 10 }}><IconButton label="全部会话" active={!attention} onPress={() => setAttention(false)}><Layers2 size={20} color={attention ? colors.dim : colors.accent} /></IconButton><IconButton label="等待处理的 agent" active={attention} onPress={() => setAttention(!attention)}><Bell size={20} color={attention ? colors.amber : colors.dim} /></IconButton><IconButton label="管理开发机" onPress={() => setMachinePanel(true)}><Server size={20} color={colors.dim} /></IconButton></View><View style={{ flex: 1 }} /><IconButton label="使用说明" onPress={() => setHelp(true)}><CircleHelp size={20} color={colors.dim} /></IconButton></View>}
        {desktop && sidebar}
        <View style={{ flex: 1, minWidth: 0, backgroundColor: colors.bg }}>
          <View style={[styles.row, { height: compact ? 54 : 69, paddingHorizontal: desktop ? 26 : 10, gap: 10, borderBottomWidth: 1, borderColor: colors.line }]}>
            {!desktop && <IconButton label="打开会话列表" onPress={() => setDrawer(true)}><Menu size={21} color={colors.text} /></IconButton>}
            <View style={{ flex: 1, gap: 3 }}><View style={[styles.row, { gap: 8 }]}><Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 }}>{workspace?.label ?? 'Mobile Herdr'}</Text>{desktop && <><ChevronRight size={13} color={colors.dim} /><Text style={[styles.muted, { fontFamily: mono }]}>{pane?.pane_id ?? '选择会话'}</Text></>}</View>{desktop ? <Text numberOfLines={1} style={[styles.muted, { fontSize: 12, fontFamily: mono }]}>{pane?.foreground_cwd ?? pane?.cwd ?? '你的开发机，随身继续'}</Text> : <View style={[styles.row, { gap: 4 }]}><Text numberOfLines={1} style={[styles.muted, { fontSize: 12, flexShrink: 1 }]}>{machine ? `${machine.name} · ${session}` : '你的开发机，随身继续'}</Text>{pane && <Text style={[styles.muted, { fontSize: 12, fontFamily: mono }]}>· {pane.pane_id}</Text>}</View>}</View>
            {desktop && <View style={[styles.row, { gap: 13, marginRight: 12 }]}><Text style={styles.muted}>{counts.working} 工作中</Text><Pressable onPress={() => setAttention(!attention)}><Text style={{ color: counts.blocked ? colors.amber : colors.muted, fontSize: 13 }}>{counts.blocked} 需要你</Text></Pressable></View>}
            <View style={[styles.row, { gap: 7, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.surface }]}><Dot status={online ? 'working' : 'blocked'} /><Text style={{ color: online ? colors.accent : colors.amber, fontSize: 12 }}>{online ? '实时连接' : '连接中'}</Text></View>
          </View>
          {!online && !!machine && <Pressable onPress={connection.reconnect} style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#30291e' }}><Text style={{ color: colors.amber, fontSize: 13, lineHeight: 20 }}>{connection.error || '正在连接开发机…'} · 点击重连</Text></Pressable>}
          {!!notice && (!compact || noticeError) && <View style={[styles.row, { backgroundColor: noticeError ? '#33201f' : '#193026', paddingVertical: 10, paddingHorizontal: 18, gap: 9 }]}>{!noticeError && <Check size={16} color={colors.accent} />}<Text accessibilityRole={noticeError ? 'alert' : undefined} style={{ color: noticeError ? colors.red : colors.accent, fontSize: 13, lineHeight: 21, flex: 1 }}>{notice}</Text><Pressable onPress={() => setNotice('')} accessibilityLabel="关闭提示"><X size={16} color={colors.muted} /></Pressable></View>}
          {pane && machine ? <>
            <View style={[styles.row, { paddingHorizontal: desktop ? 26 : 20, minHeight: 52, gap: 16, borderBottomWidth: 1, borderColor: colors.line }]}>
              {(['chat', 'terminal'] as const).map(item => <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === item }} key={item} onPress={() => setMode(item)} style={[styles.row, { gap: 7, minHeight: 51, borderBottomWidth: 2, borderBottomColor: mode === item ? colors.accent : 'transparent' }]}>{item === 'chat' ? <MessageSquare size={15} color={mode === item ? colors.accent : colors.dim} /> : <TerminalSquare size={15} color={mode === item ? colors.accent : colors.dim} />}<Text style={{ color: mode === item ? colors.text : colors.dim, fontSize: 13 }}>{item === 'chat' ? '对话' : '终端'}</Text></Pressable>)}
              <View style={{ flex: 1 }} /><Dot status={pane.agent_status} /><Text style={{ color: stateColor(pane.agent_status), fontSize: 13 }}>{statusLabel[pane.agent_status]}</Text>
            </View>
            {!native && pane.agent_status === 'blocked' && <Pressable onPress={() => setMode('terminal')} style={[styles.row, { gap: 10, backgroundColor: '#30291e', paddingHorizontal: 20, paddingVertical: 12 }]}><Bell size={16} color={colors.amber} /><Text style={{ flex: 1, color: colors.amber, fontSize: 13 }}>Agent 正在等待你确认，打开终端查看并操作。</Text><ArrowRight size={16} color={colors.amber} /></Pressable>}
            <NativeSession state={native} control={control} provider={pane.agent} online={online} compact={compact} onError={text => notify(text, true)} />
            {mode === 'terminal' ? <Terminal key={`${machine.id}:${session}:${pane.pane_id}`} machine={machine} session={session} pane={pane.pane_id} /> : <View style={{ flex: 1, width: '100%', maxWidth: 880, alignSelf: 'center', minHeight: 0 }}>
              <Conversation native={!!native} footer={native && <NativeRequests state={native} control={control} online={online} onError={text => notify(text, true)} />} key={`chat:${machine.id}:${session}:${pane.pane_id}:${native?.runtimeId}:${native?.conversationId}`} chat={connection.chat} machine={machine} session={session} pane={pane} online={online} onTerminal={() => setMode('terminal')} onBound={connection.reconnect} onError={text => notify(text, true)} />
              <Composer native={native} control={control} compact={compact} key={`composer:${machine.id}:${session}:${pane.pane_id}:${native?.runtimeId}:${native?.conversationId}`} machine={machine} session={session} pane={pane} online={online} onError={text => notify(text, true)} onSent={() => native ? undefined : notify('消息已送入原会话')} onTerminal={() => setMode('terminal')} />
            </View>}
          </> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 30 }}><HerdMark /><Text style={{ color: colors.text, fontSize: 24, fontWeight: '500' }}>{machine ? '选择一个原有会话' : '你的开发机，随身继续。'}</Text><Text style={[styles.muted, { textAlign: 'center', maxWidth: 340 }]}>{machine ? '工作区、终端和 agent 都来自开发机上运行中的 Herdr。' : '连接 Herdr，打开原来的 session。离开电脑，agent 的工作仍在继续。'}</Text><Pressable onPress={() => machine ? setDrawer(true) : setShowConnect(true)} style={styles.button}><Text style={styles.buttonText}>{machine ? '查看会话' : '连接开发机'}</Text><ArrowRight size={16} color={colors.accentInk} /></Pressable></View>}
          {!desktop && !compact && <View style={[styles.row, { borderTopWidth: 1, borderColor: colors.line, justifyContent: 'space-around', backgroundColor: colors.sidebar, paddingVertical: 5 }]}><Pressable onPress={() => { setAttention(false); setDrawer(true); }} style={{ alignItems: 'center', padding: 8, minWidth: 70, gap: 4 }}><Layers2 size={19} color={colors.muted} /><Text style={{ color: colors.muted, fontSize: 11 }}>会话</Text></Pressable><Pressable onPress={() => { setAttention(true); setDrawer(true); }} style={{ alignItems: 'center', padding: 8, minWidth: 70, gap: 4 }}><Bell size={19} color={counts.blocked ? colors.amber : colors.muted} /><Text style={{ color: counts.blocked ? colors.amber : colors.muted, fontSize: 11 }}>需要你{counts.blocked ? ` · ${counts.blocked}` : ''}</Text></Pressable><Pressable onPress={() => setMachinePanel(true)} style={{ alignItems: 'center', padding: 8, minWidth: 70, gap: 4 }}><Server size={19} color={colors.muted} /><Text style={{ color: colors.muted, fontSize: 11 }}>开发机</Text></Pressable></View>}
        </View>
      </View>
    </KeyboardAvoidingView>
    <Modal visible={!desktop && drawer} animationType="slide" onRequestClose={() => setDrawer(false)}><SafeAreaView style={{ flex: 1, backgroundColor: colors.sidebar }}>{sidebar}</SafeAreaView></Modal>
    <Modal visible={machinePanel} transparent animationType="fade" onRequestClose={() => setMachinePanel(false)}><View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#070b0bdc', padding: 20 }}><View style={{ width: '100%', maxWidth: 460, backgroundColor: colors.sidebar, borderWidth: 1, borderColor: colors.line, padding: 24, borderRadius: 14, gap: 20 }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={{ color: colors.text, fontSize: 21, fontWeight: '600' }}>开发机</Text><IconButton label="关闭开发机列表" onPress={() => setMachinePanel(false)}><X size={20} color={colors.muted} /></IconButton></View>
      <Text style={styles.muted}>每台机器保留自己的 session。点击即可切换。</Text>
      {machines.map(item => <View key={item.id} style={[styles.row, { gap: 10, borderBottomWidth: 1, borderColor: colors.line, paddingBottom: 16 }]}><Pressable onPress={() => { setActiveId(item.id); setMachinePanel(false); setDrawer(false); }} style={[styles.row, { flex: 1, gap: 12 }]}><Monitor size={20} color={activeId === item.id ? colors.accent : colors.muted} /><View style={{ flex: 1 }}><Text style={styles.text}>{item.name}</Text><Text style={[styles.muted, { fontSize: 12, fontFamily: mono }]}>{item.url}</Text></View>{activeId === item.id && <Check size={16} color={colors.accent} />}</Pressable><IconButton label={`移除 ${item.name}`} onPress={() => removeMachine(item.id)}><Trash2 size={16} color={colors.dim} /></IconButton></View>)}
      <Pressable onPress={() => { setMachinePanel(false); setShowConnect(true); }} style={styles.button}><Plus size={17} color={colors.accentInk} /><Text style={styles.buttonText}>添加开发机</Text></Pressable>
    </View></View></Modal>
    <Modal visible={help} transparent animationType="fade" onRequestClose={() => setHelp(false)}><View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#070b0bdc', padding: 24 }}><View style={{ maxWidth: 440, width: '100%', backgroundColor: colors.sidebar, padding: 26, gap: 18, borderRadius: 14, borderWidth: 1, borderColor: colors.line }}><Text style={{ color: colors.text, fontSize: 21 }}>继续同一个 Herdr</Text><Text style={styles.text}>开发机 → session → workspace → tab → pane。这里读取相同的 session，消息直接发给原 pane 中的 agent。</Text><Text style={styles.muted}>聊天记录优先使用 Herdr 上报的 session 标识。没有标识时，需要选择对应记录。对话和终端可以随时切换。</Text><Text style={styles.muted}>网络断开后会自动重连。草稿保留在当前设备，消息不会自动重发。离开页面或关闭客户端不会停止 agent。</Text><Pressable style={styles.button} onPress={() => setHelp(false)}><Text style={styles.buttonText}>知道了</Text></Pressable></View></View></Modal>
    <ConnectDialog visible={showConnect} canClose={!!machines.length} onClose={() => setShowConnect(false)} onConnect={addMachine} pairing={pairing} />
  </SafeAreaView>;
}

export default function App(): React.JSX.Element { return <SafeAreaProvider><Workbench /></SafeAreaProvider>; }
