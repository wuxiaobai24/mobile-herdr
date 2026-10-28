import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { ChevronDown, ChevronRight, Code2, Link2, MessageSquare, TerminalSquare } from 'lucide-react-native';
import type { ChatMessage, Conversation as ConversationData, Machine, Pane, HistoryPage } from '../../shared/protocol';
import { api, panePath, machineScope } from '../../shared/client';
import { useTheme, mono } from '../theme';
import { ConversationTools } from './ConversationTools';
import MessageBody from './MessageBody';
import { ToolMessage } from './ToolMessage';
import { MessageMediaContext } from './MessageImage';
import { MessageAttachment } from './MessageAttachment';
import { MessageActions } from './MessageActions';

interface Reading { y: number; near: boolean; older: ChatMessage[]; cursor?: string; hasMore?: boolean }
const readingMemory = new Map<string, Reading>();
type MessageView = ComponentRef<typeof View>;
function ToolGroup({ messages, target, register, onTargetLayout }: { messages: ChatMessage[]; target?: string; register: (id: string, view: MessageView | null) => void; onTargetLayout: (id: string) => void }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (messages.some(row => row.id === target)) setExpanded(true); }, [target]);
  return <View style={{ marginVertical: 6 }}><Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded(!expanded)} style={[styles.row, { gap: 9, minHeight: 44, paddingVertical: 10 }]}>
    {expanded ? <ChevronDown size={16} color={colors.muted} /> : <ChevronRight size={16} color={colors.muted} />}<Code2 size={16} color={colors.dim} /><Text style={styles.muted}>{messages.length} 项工具操作</Text><Text numberOfLines={1} style={[styles.muted, { flex: 1, fontFamily: mono }]}>{[...new Set(messages.map(message => message.toolName))].join(' · ')}</Text>
  </Pressable>{expanded && <View style={{ gap: 8 }}>{messages.map(message => <View key={message.id} ref={view => register(message.id, view)} onLayout={() => onTargetLayout(message.id)} collapsable={false} nativeID={`chat-message-${encodeURIComponent(message.id)}`}><ToolMessage message={message} targeted={message.id === target} /></View>)}</View>}</View>;
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
interface Props { chat?: ConversationData; machine: Machine; session: string; pane: Pane; online: boolean; native?: boolean; footer?: React.ReactNode; toolsOpen: boolean; onToolsOpenChange: (open: boolean) => void; onTerminal: () => void; onBound: () => void; onError: (message: string) => void }
export function Conversation({ chat, machine, session, pane, online, native, footer, toolsOpen, onToolsOpenChange, onTerminal, onBound, onError }: Props): React.JSX.Element {
  const { colors, styles, appearance } = useTheme();
  const { width, height: viewportHeight } = useWindowDimensions();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const messageViews = useRef(new Map<string, MessageView>());
  const pendingNativeTarget = useRef<string | undefined>(undefined);
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
  const loadingHistory = useRef(false), historyScrollStarted = useRef(false);
  const [historyError, setHistoryError] = useState('');
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
    historyScrollStarted.current = false; setHistoryError('');
    pendingNativeTarget.current = undefined;
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
  const messages = useMemo(() => [...new Map([...(olderKey === readingKey ? older : []), ...(chat?.messages ?? [])].map(row => [row.id, row])).values()], [olderKey, readingKey, older, chat?.messages]);
  const messageGroups = useMemo(() => groups(messages), [messages]);
  const moreHistory = (olderKey === readingKey ? hasMore : undefined) ?? !!chat?.history?.hasMore;
  async function loadOlder(): Promise<void> {
    if (loadingHistory.current || !online || !moreHistory) return;
    loadingHistory.current = true; historyScrollStarted.current = false; setLoading(true); setHistoryError(''); nearBottom.current = false;
    const expected = readingKey;
    const requested = (olderKey === readingKey ? cursor : undefined) ?? chat?.history?.cursor ?? '';
    try {
      const page = await api<HistoryPage>(machine, panePath(session, pane.pane_id, 'history') + `&cursor=${encodeURIComponent(requested)}`);
      if (page.identity !== identity || expected !== activeReading.current) throw new Error('历史所属会话已变化，请重新打开。');
      if (page.hasMore && (!page.cursor || page.cursor === requested)) throw new Error('历史分页未前进，请重试或查看原终端。');
      const existing = new Set(messages.map(message => message.id));
      if (page.messages.some(message => !existing.has(message.id))) prepend.current = { height: contentHeight.current, y: y.current };
      setOlder(previous => [...new Map([...page.messages, ...previous].map(row => [row.id, row])).values()]); setCursor(page.cursor); setHasMore(page.hasMore); setHistoryLimited(!!page.limited);
    } catch (error) { if (expected === activeReading.current) setHistoryError(error instanceof Error ? error.message : '历史读取失败。'); }
    finally { loadingHistory.current = false; setLoading(false); }
  }
  function register(id: string, view: MessageView | null): void {
    if (view) messageViews.current.set(id, view); else messageViews.current.delete(id);
  }
  function scrollToNativeMessage(id: string): void {
    if (pendingNativeTarget.current !== id) return;
    const content = scroll.current?.getInnerViewRef();
    if (content) messageViews.current.get(id)?.measureLayout(content, (_x, offset) => {
      if (pendingNativeTarget.current !== id) return;
      pendingNativeTarget.current = undefined;
      scroll.current?.scrollTo({ y: offset, animated: false });
    }, () => {});
  }
  function onTargetLayout(id: string): void { if (typeof document === 'undefined') scrollToNativeMessage(id); }
  function goTo(id: string): void {
    setTarget(id); nearBottom.current = false; setAwayFromBottom(true);
    if (typeof document !== 'undefined') requestAnimationFrame(() => requestAnimationFrame(() => {
      const container = document.querySelector('[data-testid="conversation-scroll"]');
      const element = [...(container?.querySelectorAll<HTMLElement>('[id^="chat-message-"]') ?? [])].find(el => el.id === `chat-message-${encodeURIComponent(id)}`);
      if (element && container) { const offset = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop; scroll.current?.scrollTo({ y: offset, animated: false }); }
    }));
    else { pendingNativeTarget.current = id; requestAnimationFrame(() => scrollToNativeMessage(id)); }
  }
  async function previousUser(): Promise<void> {
    let index = messages.length;
    if (typeof document !== 'undefined') {
      const container = document.querySelector('[data-testid="conversation-scroll"]');
      const top = container?.getBoundingClientRect().top ?? 0;
      const first = [...(container?.querySelectorAll<HTMLElement>('[id^="chat-message-"]') ?? [])].find(el => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().bottom > top + 1);
      if (first) index = messages.findIndex(row => first.id === `chat-message-${encodeURIComponent(row.id)}`);
    } else {
      const content = scroll.current?.getInnerViewRef();
      const locations = await Promise.all(messages.map((row, index) => new Promise<{ index: number; bottom: number } | undefined>(resolve => {
        const view = messageViews.current.get(row.id);
        if (!content || !view) { resolve(undefined); return; }
        view.measureLayout(content, (_x, top, _width, height) => resolve({ index, bottom: top + height }), () => resolve(undefined));
      })));
      const first = locations.find(row => row && row.bottom > y.current + 1);
      if (first) index = first.index;
      else if (target) index = messages.findIndex(row => row.id === target);
    }
    const previous = messages.slice(0, index < 0 ? messages.length : index).reverse().find(row => row.role === 'user');
    if (previous) goTo(previous.id);
  }
  const mediaContext = useMemo(() => ({ machine, session, pane: pane.pane_id, cwd: pane.foreground_cwd ?? pane.cwd }), [machine.url, machine.token, machine.remote, session, pane.pane_id, pane.foreground_cwd, pane.cwd]);
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
  return <MessageMediaContext.Provider value={mediaContext}><View testID="conversation-content" style={{ flex: 1, minHeight: 0 }}>{!!chat && chat.source !== 'unavailable' && <ConversationTools open={toolsOpen} onOpenChange={onToolsOpenChange} key={readingKey} messages={messages} onTarget={goTo} onPreviousUser={previousUser} onOlder={() => void loadOlder()} more={(olderKey === readingKey ? hasMore : undefined) ?? !!chat.history?.hasMore} busy={loading} />}<ScrollView testID="conversation-scroll" ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: width < 900 ? 16 : 32, paddingTop: width < 900 ? 12 : 20, paddingBottom: 16, flexGrow: 1 }}
    onScrollBeginDrag={() => { historyScrollStarted.current = true; }}
    onContentSizeChange={(_width, height) => { contentHeight.current = height; if (chat?.source === 'unavailable') { scroll.current?.scrollTo({ y: 0, animated: false }); return; } restorePosition(); if (!restored.current && chat) { restored.current = true; if (!nearBottom.current) scroll.current?.scrollTo({ y: y.current, animated: false }); } if (prepend.current) { const offset = prepend.current.y + height - prepend.current.height; prepend.current = null; scroll.current?.scrollTo({ y: offset, animated: false }); } else if (nearBottom.current) scroll.current?.scrollToEnd({ animated: false }); }}
    scrollEventThrottle={80} onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; if (pendingRestore.current) return; y.current = contentOffset.y; latestReading.current.y = y.current; nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 100; latestReading.current.near = nearBottom.current; setAwayFromBottom(!nearBottom.current); if (nearBottom.current) setUnread(false); if (contentOffset.y > 100) historyScrollStarted.current = true; if (historyScrollStarted.current && contentOffset.y < 80 && !prepend.current && !historyError) void loadOlder(); }}>
    {moreHistory && <Pressable accessibilityRole="button" accessibilityLabel={historyError ? '重试加载更早记录' : '加载更早记录'} disabled={loading || !online} onPress={() => void loadOlder()} style={[styles.row, { alignSelf: 'center', minHeight: 44, gap: 8, marginBottom: 8 }]}>{loading && <ActivityIndicator size="small" color={colors.muted} />}<Text style={styles.muted}>{loading ? '加载更早记录…' : historyError || '向上滑动加载更早记录'}</Text></Pressable>}
    {!moreHistory && !!older.length && <Text style={[styles.muted, { alignSelf: 'center', paddingVertical: 12 }]}>已到最早记录</Text>}
    {historyLimited && <Text style={[styles.muted, { paddingBottom: 16 }]}>更早记录可能超出当前实例的保留范围；完整历史请在电脑查看。</Text>}
    {!chat && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 15 }}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{online ? '读取原会话…' : '等待开发机连接…'}</Text></View>}
    {chat?.source === 'unavailable' && <View style={{ flexGrow: 1, flexShrink: 0, justifyContent: 'center', gap: viewportHeight < 480 ? 12 : 18, paddingVertical: viewportHeight < 480 ? 12 : 32 }}>
      {viewportHeight >= 480 && <MessageSquare size={30} color={colors.accent} />}<Text style={{ color: colors.text, fontSize: 22, fontWeight: '500' }}>接着原来的对话</Text>
      <Text style={[styles.text, { color: colors.muted }]}>{chat.candidates.length ? '这个 pane 尚未上报聊天记录标识。选择它正在使用的记录，关联后即可在这里继续阅读。' : '暂无可识别聊天记录，可打开原始终端继续。'}</Text>
      {chat.candidates.map(candidate => <Pressable disabled={binding || !online} key={candidate.id} accessibilityRole="button" onPress={() => bind(candidate.id)} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 5 }}>
        <View style={[styles.row, { gap: 9 }]}><Link2 size={15} color={colors.accent} /><Text numberOfLines={2} style={[styles.text, { flex: 1 }]}>{candidate.title}</Text><ChevronRight size={16} color={colors.muted} /></View>
        <Text style={[styles.muted, { fontFamily: mono, fontSize: 12 }]}>{candidate.id}</Text><Text style={styles.muted}>{new Date(candidate.updated).toLocaleString('zh-CN')}</Text>
      </Pressable>)}
      {binding && <ActivityIndicator color={colors.accent} />}
      <Pressable onPress={onTerminal} style={[styles.button, styles.secondary, { alignSelf: 'flex-start' }]}><TerminalSquare color={colors.text} size={17} /><Text style={{ color: colors.text, fontSize: 14 }}>打开原始终端</Text></Pressable>
    </View>}
    {chat && chat.source !== 'unavailable' && <>
      {!native && <View style={[styles.row, { justifyContent: 'center', gap: 7, marginBottom: 24 }]}><Link2 size={12} color={colors.dim} /><Text style={[styles.muted, { fontSize: 12 }]}>已连接原生聊天记录 · {chat.source}</Text></View>}
      {chat.messages.length === 0 && <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 28, gap: 12 }}><MessageSquare size={28} color={colors.accent} /><Text style={{ color: colors.text, fontSize: 20, fontWeight: '600' }}>接着电脑上的任务</Text></View>}
      {messageGroups.map(group => group[0].role === 'tool' ? <ToolGroup key={group[0].id} messages={group} target={target} register={register} onTargetLayout={onTargetLayout} /> : <View key={group[0].id} ref={view => register(group[0].id, view)} onLayout={() => onTargetLayout(group[0].id)} collapsable={false} nativeID={`chat-message-${encodeURIComponent(group[0].id)}`} style={{ backgroundColor: target === group[0].id ? colors.accentSurface : 'transparent', borderRadius: 8, marginVertical: 14, alignItems: group[0].role === 'user' ? 'flex-end' : 'stretch' }}>
        {group[0].role === 'user' ? <View style={{ backgroundColor: colors.hover, borderRadius: 18, borderTopRightRadius: 5, paddingHorizontal: 16, paddingVertical: 13, maxWidth: '92%' }}><Text selectable style={[styles.text, { fontSize: appearance.readingSize, lineHeight: Math.round(appearance.readingSize * 1.65) }]}>{group[0].text}</Text>{group[0].media?.map((media, index) => <MessageAttachment key={index} media={media} />)}</View> : <View style={{ gap: 8 }}><View style={[styles.row, { justifyContent: 'space-between', gap: 8 }]}><Text style={{ fontSize: 13, color: colors.muted, fontWeight: '600' }}>{pane.agent === 'codex' ? 'Codex' : pane.agent === 'claude' ? 'Claude Code' : pane.agent === 'pi' ? 'Pi' : pane.agent}</Text><MessageActions text={group[0].text} /></View><MessageBody text={group[0].text} />{group[0].media?.map((media, index) => <MessageAttachment key={index} media={media} />)}{group[0].truncated && <Text style={styles.muted}>内容较长，当前仅展示部分结果；完整内容请在电脑查看。</Text>}</View>}
      </View>)}
      {width >= 900 && pane.agent_status === 'working' && <View style={[styles.row, { gap: 10, paddingTop: 18 }]}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.muted}>Agent 正在工作…</Text></View>}
    </>}
    {footer}
  </ScrollView>{awayFromBottom && <Pressable accessibilityRole="button" accessibilityLabel={unread ? '查看新消息' : '回到最新消息'} onPress={() => { nearBottom.current = true; setUnread(false); setAwayFromBottom(false); scroll.current?.scrollToEnd({ animated: false }); }} style={[styles.button, styles.secondary, { position: 'absolute', bottom: 12, alignSelf: 'center', borderRadius: 22 }]}><ChevronDown size={15} color={colors.text} /><Text style={{ color: colors.text, fontSize: 13 }}>{unread ? '有新消息' : '回到最新'}</Text></Pressable>}</View></MessageMediaContext.Provider>;
}
