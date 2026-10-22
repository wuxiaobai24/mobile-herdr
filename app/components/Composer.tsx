import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ArrowUp, Square, TerminalSquare } from 'lucide-react-native';
import type { Machine, Pane } from '../../shared/protocol';
import type { NativeState } from '../../shared/native';
import type { NativeControl } from '../useNativeControl';
import { ApiError, api, panePath, requestId } from '../../shared/client';
import { loadDraft, saveDraft } from '../storage';
import { colors, styles } from '../theme';

interface Props { machine: Machine; session: string; pane: Pane; online: boolean; compact?: boolean; native?: NativeState | null; control?: NativeControl; onError: (message: string) => void; onSent: () => void; onTerminal: () => void }
export function Composer({ machine, session, pane, online, compact = false, native, control, onError, onSent, onTerminal }: Props): React.JSX.Element {
  const key = `${machine.url}:${session}:${pane.pane_id}${native ? `:${native.runtimeId}:${native.conversationId ?? 'starting'}` : ''}`;
  const { width } = useWindowDimensions();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const current = useRef('');
  const mounted = useRef(true);
  const request = useRef<{ text: string; id: string } | null>(null);
  const working = native ? native.status === 'working' || native.status === 'blocked' : pane.agent_status === 'working';
  const blocked = native ? native.requests.length > 0 : pane.agent_status === 'blocked';
  const writable = native ? native.connected && !!control?.owns : !!pane.agent;
  useEffect(() => {
    mounted.current = true;
    setReady(false); request.current = null;
    void Promise.all([loadDraft(key), loadDraft(key + ':delivery')]).then(([value, delivery]) => {
      if (!mounted.current) return;
      if (delivery) { try { request.current = JSON.parse(delivery); } catch { request.current = null; } }
      current.current = value; setText(value); setReady(true);
    }).catch(() => { if (mounted.current) { setReady(true); onError('无法读取草稿存储。'); } });
    return () => { mounted.current = false; void saveDraft(key, current.current).catch(() => {}); };
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void saveDraft(key, text).catch(() => onError('草稿保存失败，请保留当前页面。')), 200);
    return () => clearTimeout(timer);
  }, [key, text, ready]);
  function edit(value: string): void { current.current = value; setText(value); }
  async function send(): Promise<void> {
    if (!text.trim() || busy || !online || (working && !native) || blocked || !writable) return;
    const submission = text;
    if (request.current?.text !== submission) request.current = { text: submission, id: requestId() };
    setBusy(true);
    try {
      // Keep a receipt across refreshes, including ambiguous network failures.
      await saveDraft(key, submission); await saveDraft(key + ':delivery', JSON.stringify(request.current));
      if (native && control) await control.act('prompt', { text: submission }, request.current.id);
      else await api(machine, panePath(session, pane.pane_id, 'prompt'), { body: { text: submission }, id: request.current.id });
      // Save against the submitted pane even if navigation happened during the request.
      if (current.current === submission) { current.current = ''; await saveDraft(key, ''); if (mounted.current) setText(''); }
      request.current = null;
      await saveDraft(key + ':delivery', '');
      if (mounted.current) onSent();
    } catch (error) {
      if (error instanceof ApiError && ['agent_working', 'agent_blocked', 'agent_not_ready', 'not_an_agent', 'unauthorized', 'invalid_input', 'pane_not_found'].includes(error.code)) request.current = null;
      if (mounted.current) onError(error instanceof Error ? error.message : '发送失败，草稿已保留。');
    }
    finally { if (mounted.current) setBusy(false); }
  }
  async function interrupt(): Promise<void> {
    try { if (native && control) await control.act('stop'); else await api(machine, panePath(session, pane.pane_id, 'keys'), { body: { keys: ['ctrl+c'] } }); }
    catch (error) { onError(error instanceof Error ? error.message : '中断失败。'); }
  }
  const disabled = !online || (working && !native) || blocked || !text.trim() || busy || !ready || !writable;
  return <View style={{ paddingTop: compact ? 6 : 12, paddingHorizontal: compact ? 14 : 20, paddingBottom: compact ? 6 : 12, backgroundColor: colors.bg }}>
    <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.surface }}>
      <TextInput accessibilityLabel="发给原会话的消息" multiline value={text} onChangeText={edit} editable={ready} maxLength={32000}
        placeholder={blocked ? '先完成 agent 当前的确认，草稿会保留…' : native && !control?.owns ? '接管后即可发送，草稿可以先写…' : native && working ? '补充到当前任务…' : '继续交给 agent…'} placeholderTextColor={colors.dim}
        style={{ color: colors.text, fontSize: 16, lineHeight: 24, padding: compact ? 12 : 15, paddingBottom: 8, minHeight: compact ? 48 : 64, maxHeight: compact ? 110 : 160, textAlignVertical: 'top' }}
        onKeyPress={event => {
          const native = event.nativeEvent as typeof event.nativeEvent & { ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean };
          if (Platform.OS === 'web' && native.key === 'Enter' && (native.ctrlKey || native.metaKey) && !native.isComposing) { event.preventDefault(); void send(); }
        }} />
      <View style={[styles.row, { justifyContent: 'space-between', paddingHorizontal: 11, paddingBottom: 10 }]}>
        <Pressable onPress={onTerminal} style={[styles.row, { padding: 8, gap: 7 }]} accessibilityRole="button"><TerminalSquare size={15} color={colors.muted} /><Text style={styles.muted}>原始终端</Text></Pressable>
        <View style={[styles.row, { gap: 8 }]}>{working && native && <Pressable onPress={interrupt} disabled={!online || !writable} accessibilityLabel="中断 agent" style={[styles.button, styles.secondary, { minHeight: 44, gap: 6, opacity: writable ? 1 : 0.4 }]}><Square size={12} color={colors.text} /><Text style={{ color: colors.text, fontSize: 13 }}>停止</Text></Pressable>}
        {working && !native ? <Pressable onPress={interrupt} disabled={!online} accessibilityLabel="中断 agent" style={[styles.button, styles.secondary, { minHeight: 36, gap: 6 }]}><Square size={12} color={colors.text} /><Text style={{ color: colors.text, fontSize: 13 }}>中断</Text></Pressable>
          : <Pressable accessibilityRole="button" accessibilityLabel="发送消息" hitSlop={8} disabled={disabled} onPress={send} style={{ backgroundColor: disabled ? colors.hover : colors.accent, borderRadius: 8, width: 44, height: 40, justifyContent: 'center', alignItems: 'center' }}>{busy ? <ActivityIndicator size="small" color={colors.accentInk} /> : <ArrowUp size={20} color={disabled ? colors.dim : colors.accentInk} />}</Pressable>}
        </View>
      </View>
    </View>
    {!compact && (!native || control?.owns) && <View style={[styles.row, { justifyContent: 'space-between', marginTop: 8 }]}><Text style={styles.muted}>{!online ? '连接已断开 · 草稿仍可编辑' : native ? control?.owns ? working ? '补充消息进入当前任务' : '原生连接 · 同一个 agent' : '点击「在手机继续」接管输入' : '发送到原 pane · 保留完整上下文'}</Text>{Platform.OS === 'web' && width >= 900 && <Text style={[styles.muted, { fontSize: 12 }]}>⌘ / Ctrl + Enter</Text>}</View>}
  </View>;
}
