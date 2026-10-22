import { useEffect, useLayoutEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { ChevronDown, ChevronRight, Code2, Link2, MessageSquare, TerminalSquare } from 'lucide-react-native';
import type { ChatMessage, Conversation as ConversationData, Machine, Pane, HistoryPage } from '../../shared/protocol';
import { api, panePath, machineScope } from '../../shared/client';
import { useTheme, mono } from '../theme';
import { ConversationTools } from './ConversationTools';
import MessageBody from './MessageBody';
import { DiffView } from './DiffView';
import { suppliedChanges } from '../../shared/diff';

interface Reading { y: number; near: boolean; older: ChatMessage[]; cursor?: string; hasMore?: boolean }
const readingMemory = new Map<string, Reading>();
function ToolGroup({ messages, target }: { messages: ChatMessage[]; target?: string }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const [expanded, setExpanded] = useState(() => messages.some(row => suppliedChanges(row.text).length || suppliedChanges(row.output).length));
  useEffect(() => { if (messages.some(row => row.id === target)) setExpanded(true); }, [target]);
  return <View style={{ marginVertical: 6 }}><Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded(!expanded)} style={[styles.row, { gap: 9, minHeight: 44, paddingVertical: 10 }]}>
    {expanded ? <ChevronDown size={16} color={colors.muted} /> : <ChevronRight size={16} color={colors.muted} />}<Code2 size={16} color={colors.dim} /><Text style={styles.muted}>{messages.length} 项工具操作</Text><Text numberOfLines={1} style={[styles.muted, { flex: 1, fontFamily: mono }]}>{[...new Set(messages.map(message => message.toolName))].join(' · ')}</Text>
  </Pressable>{expanded && <View style={{ gap: 12, paddingLeft: 25 }}>{messages.map(message => <View key={message.id} nativeID={`chat-message-${encodeURIComponent(message.id)}`} style={{ gap: 6 }}><Text style={{ color: colors.accent, fontSize: 13, fontFamily: mono }}>{message.toolName}</Text>{suppliedChanges(message.text).length ? <DiffView value={message.text} /> : <Text selectable style={{ color: colors.muted, fontFamily: mono, fontSize: 13, lineHeight: 21 }}>{message.text}</Text>}{!!message.output && (suppliedChanges(message.output).length ? <DiffView value={message.output} /> : <Text selectable style={{ color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 21 }}>{message.output}</Text>)}{message.truncated && <Text style={styles.muted}>内容较长，当前仅展示部分结果；完整内容请在电脑查看。</Text>}</View>)}</View>}</View>;
}
function groups(messages: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = [];
  for (const message of messages) {
    const last = groups.at(-1);
    if (message.role === 'tool' && last?.[0].role === 'tool') last.push(message);
    else groups.push([message]);
  }
  return groups;
}
interface Props { chat?: ConversationData; machine: Machine; session: string; pane: Pane; online: boolean; native?: boolean; footer?: React.ReactNode; onTerminal: () => void; onBound: () => void; onError: (message: string) => void }
export function Conversation({ chat, machine, session, pane, online, native, footer, onTerminal, onBound, onError }: Props): React.JSX.Element {
  const { colors, styles, appearance } = useTheme();
  const { width } = useWindowDimensions();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const nearBottom = useRef(true);
  const [binding, setBinding] = useState(false);
  const [unread, setUnread] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const identity = chat?.history?.identity ?? 'pending';
  const readingKey = `${machineScope(machine)}:${session}:${pane.pane_id}:${identity}`;
  const [olderKey, setOlderKey] = useState('');
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [hasMore, setHasMore] = useState<boolean>();
  const [loading, setLoading] = useState(false);
  const [historyLimited, setHistoryLimited] = useState(false);
  const [target, setTarget] = useState<string>();
  const y = useRef(0), prepend = useRef<{ height: number; y: number } | null>(null), contentHeight = useRef(0), restored = useRef(false);
  const activeReading = useRef(readingKey); activeReading.current = readingKey;
  const pendingRestore = useRef<{ y: number; olderCount: number } | undefined>(undefined);
  const latestReading = useRef<Reading>({ y: 0, near: true, older: [] });
  latestReading.current = { y: y.current, near: nearBottom.current, older, cursor, hasMore };
  useLayoutEffect(() => {
    const element = typeof document === 'undefined' ? undefined : document.querySelector<HTMLElement>('[data-testid="conversation-scroll"]');
    activeReading.current = readingKey;
    const saved = readingMemory.get(readingKey);
    pendingRestore.current = saved && !saved.near ? { y: saved.y, olderCount: saved.older.length } : undefined;
    y.current = saved?.y ?? 0; nearBottom.current = saved?.near ?? true; restored.current = false;
    setOlderKey(readingKey); setOlder(saved?.older ?? []); setCursor(saved?.cursor); setHasMore(saved?.hasMore); setHistoryLimited(false); setTarget(undefined);
    setAwayFromBottom(!nearBottom.current);
    return () => {
      activeReading.current = '';
      const saved = { ...latestReading.current };
      if (element?.isConnected && element.clientHeight) { saved.y = element.scrollTop; saved.near = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }
      if (readingMemory.size >= 16) readingMemory.delete(readingMemory.keys().next().value!);
      readingMemory.set(readingKey, saved);
    };
  }, [readingKey]);
  function restorePosition(): void {
    const pending = pendingRestore.current;
    if (!pending || older.length < pending.olderCount) return;
    scroll.current?.scrollTo({ y: pending.y, animated: false }); y.current = pending.y; latestReading.current.y = pending.y; pendingRestore.current = undefined;
  }
  useEffect(() => { if (pendingRestore.current) { const frame = requestAnimationFrame(restorePosition); return () => cancelAnimationFrame(frame); } }, [older, readingKey]);
  const messages = [...new Map([...(olderKey === readingKey ? older : []), ...(chat?.messages ?? [])].map(row => [row.id, row])).values()];
  async function loadOlder(): Promise<void> {
    if (loading || !online) return;
    setLoading(true); nearBottom.current = false;
    const expected = readingKey;
    try {
      const page = await api<HistoryPage>(machine, panePath(session, pane.pane_id, 'history') + `&cursor=${encodeURIComponent((olderKey === readingKey ? cursor : undefined) ?? chat?.history?.cursor ?? '')}`);
      if (page.identity !== identity || expected !== activeReading.current) throw new Error('历史所属会话已变化，请重新打开。');
      prepend.current = { height: contentHeight.current, y: y.current };
      setOlder(previous => [...new Map([...page.messages, ...previous].map(row => [row.id, row])).values()]); setCursor(page.cursor); setHasMore(page.hasMore); setHistoryLimited(!!page.limited);
    } catch (error) { onError(error instanceof Error ? error.message : '历史读取失败。'); }
    finally { setLoading(false); }
  }
  function goTo(id: string): void {
    setTarget(id); nearBottom.current = false; setAwayFromBottom(true);
    if (typeof document !== 'undefined') requestAnimationFrame(() => requestAnimationFrame(() => {
      const container = document.querySelector('[data-testid="conversation-scroll"]');
      const element = [...(container?.querySelectorAll<HTMLElement>('[id^="chat-message-"]') ?? [])].find(el => el.id === `chat-message-${encodeURIComponent(id)}`);
      if (element && container) { const offset = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop; scroll.current?.scrollTo({ y: offset, animated: false }); }
    }));
  }
  function previousUser(): void {
    let index = messages.length;
    if (typeof document !== 'undefined') {
      const container = document.querySelector('[data-testid="conversation-scroll"]');
      const top = container?.getBoundingClientRect().top ?? 0;
      const first = [...(container?.querySelectorAll<HTMLElement>('[id^="chat-message-"]') ?? [])].find(el => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().bottom > top + 1);
      if (first) index = messages.findIndex(row => first.id === `chat-message-${encodeURIComponent(row.id)}`);
    } else if (target) index = messages.findIndex(row => row.id === target);
    const previous = messages.slice(0, index < 0 ? messages.length : index).reverse().find(row => row.role === 'user');
    if (previous) goTo(previous.id);
  }
  const latest = chat?.messages.at(-1);
  useEffect(() => {
    if (nearBottom.current) scroll.current?.scrollToEnd({ animated: false }); else setUnread(true);
  }, [latest?.id, latest?.text, latest?.output]);
  async function bind(id: string): Promise<void> {
    setBinding(true);
    try { await api(machine, panePath(session, pane.pane_id, 'bind'), { body: { candidateId: id } }); onBound(); }
    catch (error) { onError(error instanceof Error ? error.message : '关联失败。'); }
    finally { setBinding(false); }
  }
  return <View testID="conversation-content" style={{ flex: 1, minHeight: 0 }}>{!!chat && chat.source !== 'unavailable' && <ConversationTools key={readingKey} messages={messages} onTarget={goTo} onPreviousUser={previousUser} onOlder={() => void loadOlder()} more={(olderKey === readingKey ? hasMore : undefined) ?? !!chat.history?.hasMore} busy={loading} />}<ScrollView testID="conversation-scroll" ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: width < 900 ? 20 : 32, paddingTop: 20, paddingBottom: 24, flexGrow: 1 }}
    onContentSizeChange={(_width, height) => { contentHeight.current = height; restorePosition(); if (!restored.current && chat) { restored.current = true; if (!nearBottom.current) scroll.current?.scrollTo({ y: y.current, animated: false }); } if (prepend.current) { scroll.current?.scrollTo({ y: prepend.current.y + height - prepend.current.height, animated: false }); prepend.current = null; } else if (nearBottom.current) scroll.current?.scrollToEnd({ animated: false }); }}
    scrollEventThrottle={80} onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; if (pendingRestore.current) return; y.current = contentOffset.y; latestReading.current.y = y.current; nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 100; latestReading.current.near = nearBottom.current; setAwayFromBottom(!nearBottom.current); if (nearBottom.current) setUnread(false); }}>
    {historyLimited && <Text style={[styles.muted, { paddingBottom: 16 }]}>更早记录可能超出当前实例的保留范围；完整历史请在电脑查看。</Text>}
    {!chat && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 15 }}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{online ? '读取原会话…' : '等待开发机连接…'}</Text></View>}
    {chat?.source === 'unavailable' && <View style={{ flex: 1, justifyContent: 'center', gap: 18, paddingVertical: 32 }}>
      <MessageSquare size={30} color={colors.accent} /><Text style={{ color: colors.text, fontSize: 22, fontWeight: '500' }}>接着原来的对话</Text>
      <Text style={[styles.text, { color: colors.muted }]}>{chat.candidates.length ? '这个 pane 尚未上报聊天记录标识。选择它正在使用的记录，关联后即可在这里继续阅读。' : '这个 pane 暂无可识别的聊天记录。打开原始终端，可以直接继续当前会话。'}</Text>
      {chat.candidates.map(candidate => <Pressable disabled={binding || !online} key={candidate.id} accessibilityRole="button" onPress={() => bind(candidate.id)} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 5 }}>
        <View style={[styles.row, { gap: 9 }]}><Link2 size={15} color={colors.accent} /><Text numberOfLines={2} style={[styles.text, { flex: 1 }]}>{candidate.title}</Text><ChevronRight size={16} color={colors.muted} /></View>
        <Text style={[styles.muted, { fontFamily: mono, fontSize: 12 }]}>{candidate.id}</Text><Text style={styles.muted}>{new Date(candidate.updated).toLocaleString('zh-CN')}</Text>
      </Pressable>)}
      {binding && <ActivityIndicator color={colors.accent} />}
      <Pressable onPress={onTerminal} style={[styles.button, styles.secondary, { alignSelf: 'flex-start' }]}><TerminalSquare color={colors.text} size={17} /><Text style={{ color: colors.text, fontSize: 14 }}>打开原始终端</Text></Pressable>
    </View>}
    {chat && chat.source !== 'unavailable' && <>
      {(!native || chat.truncated) && <View style={[styles.row, { justifyContent: 'center', gap: 7, marginBottom: 24 }]}><Link2 size={12} color={colors.dim} /><Text style={[styles.muted, { fontSize: 12 }]}>{chat.truncated ? '显示最近的对话' : '已连接原生聊天记录'} · {chat.source}</Text></View>}
      {chat.messages.length === 0 && <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 28, gap: 12 }}><MessageSquare size={28} color={colors.accent} /><Text style={{ color: colors.text, fontSize: 20, fontWeight: '600' }}>接着电脑上的任务</Text></View>}
      {groups(messages).map(group => group[0].role === 'tool' ? <ToolGroup key={group[0].id} messages={group} target={target} /> : <View key={group[0].id} nativeID={`chat-message-${encodeURIComponent(group[0].id)}`} style={{ backgroundColor: target === group[0].id ? colors.accentSurface : 'transparent', borderRadius: 8, marginVertical: 14, alignItems: group[0].role === 'user' ? 'flex-end' : 'stretch' }}>
        {group[0].role === 'user' ? <View style={{ backgroundColor: colors.hover, borderRadius: 18, borderTopRightRadius: 5, paddingHorizontal: 16, paddingVertical: 13, maxWidth: '92%' }}><Text selectable style={[styles.text, { fontSize: appearance.readingSize, lineHeight: Math.round(appearance.readingSize * 1.65) }]}>{group[0].text}</Text></View> : <View style={{ gap: 12 }}><Text style={{ fontSize: 13, color: colors.muted, fontWeight: '600' }}>{pane.agent === 'codex' ? 'Codex' : pane.agent === 'claude' ? 'Claude Code' : pane.agent === 'pi' ? 'Pi' : pane.agent}</Text><MessageBody text={group[0].text} />{group[0].truncated && <Text style={styles.muted}>内容较长，当前仅展示部分结果；完整内容请在电脑查看。</Text>}</View>}
      </View>)}
      {pane.agent_status === 'working' && <View style={[styles.row, { gap: 10, paddingTop: 18 }]}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.muted}>Agent 正在工作…</Text></View>}
    </>}
    {footer}
  </ScrollView>{awayFromBottom && <Pressable accessibilityRole="button" accessibilityLabel={unread ? '查看新消息' : '回到最新消息'} onPress={() => { nearBottom.current = true; setUnread(false); setAwayFromBottom(false); scroll.current?.scrollToEnd({ animated: false }); }} style={[styles.button, styles.secondary, { position: 'absolute', bottom: 12, alignSelf: 'center', borderRadius: 22 }]}><ChevronDown size={15} color={colors.text} /><Text style={{ color: colors.text, fontSize: 13 }}>{unread ? '有新消息' : '回到最新'}</Text></Pressable>}</View>;
}
