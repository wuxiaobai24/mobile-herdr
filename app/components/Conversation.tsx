import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronDown, ChevronRight, Code2, Link2, MessageSquare, TerminalSquare } from 'lucide-react-native';
import type { ChatMessage, Conversation as ConversationData, Machine, Pane } from '../../shared/protocol';
import { api, panePath } from '../../shared/client';
import { colors, mono, styles } from '../theme';
import MessageBody from './MessageBody';

function ToolGroup({ messages }: { messages: ChatMessage[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return <View style={{ marginVertical: 6 }}><Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={[styles.row, { gap: 9, paddingVertical: 10 }]}>
    {expanded ? <ChevronDown size={16} color={colors.muted} /> : <ChevronRight size={16} color={colors.muted} />}<Code2 size={16} color={colors.dim} /><Text style={styles.muted}>{messages.length} 项工具操作</Text><Text numberOfLines={1} style={[styles.muted, { flex: 1, fontFamily: mono }]}>{[...new Set(messages.map(message => message.toolName))].join(' · ')}</Text>
  </Pressable>{expanded && <View style={{ gap: 12, paddingLeft: 25 }}>{messages.map(message => <View key={message.id} style={{ gap: 6 }}><Text style={{ color: colors.accent, fontSize: 13, fontFamily: mono }}>{message.toolName}</Text><Text selectable style={{ color: colors.muted, fontFamily: mono, fontSize: 13, lineHeight: 21 }}>{message.text}</Text>{!!message.output && <Text selectable style={{ color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 21 }}>{message.output}</Text>}</View>)}</View>}</View>;
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
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const nearBottom = useRef(true);
  const [binding, setBinding] = useState(false);
  const [unread, setUnread] = useState(false);
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
  return <View style={{ flex: 1, minHeight: 0 }}><ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 28, paddingBottom: 32, flexGrow: 1 }}
    onContentSizeChange={() => { if (nearBottom.current) scroll.current?.scrollToEnd({ animated: false }); }}
    scrollEventThrottle={80} onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 100; if (nearBottom.current) setUnread(false); }}>
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
      <View style={[styles.row, { justifyContent: 'center', gap: 7, marginBottom: 30 }]}><Link2 size={12} color={colors.dim} /><Text style={[styles.muted, { fontSize: 12 }]}>{chat.truncated ? '显示最近的对话' : native ? '已连接原生 Agent' : '已连接原生聊天记录'} · {chat.source}</Text></View>
      {chat.messages.length === 0 && <Text style={styles.muted}>写下接下来要做的事。</Text>}
      {groups(chat.messages).map(group => group[0].role === 'tool' ? <ToolGroup key={group[0].id} messages={group} /> : <View key={group[0].id} style={{ marginVertical: 12, alignItems: group[0].role === 'user' ? 'flex-end' : 'stretch' }}>
        {group[0].role === 'user' ? <View style={{ backgroundColor: colors.hover, borderRadius: 12, padding: 14, maxWidth: '94%' }}><Text selectable style={styles.text}>{group[0].text}</Text></View> : <View style={{ gap: 10 }}><Text style={{ fontSize: 13, color: colors.accent, fontWeight: '600' }}>{pane.agent === 'codex' ? 'Codex' : pane.agent === 'claude' ? 'Claude Code' : pane.agent}</Text><MessageBody text={group[0].text} /></View>}
      </View>)}
      {pane.agent_status === 'working' && <View style={[styles.row, { gap: 10, paddingTop: 18 }]}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.muted}>Agent 正在工作…</Text></View>}
    </>}
    {footer}
  </ScrollView>{unread && <Pressable onPress={() => { nearBottom.current = true; setUnread(false); scroll.current?.scrollToEnd({ animated: true }); }} style={[styles.button, styles.secondary, { position: 'absolute', bottom: 12, alignSelf: 'center', minHeight: 36 }]}><ChevronDown size={15} color={colors.text} /><Text style={{ color: colors.text, fontSize: 13 }}>新消息</Text></Pressable>}</View>;
}
