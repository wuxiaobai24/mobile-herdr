import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ArrowUp, Check, Square, TerminalSquare } from 'lucide-react-native';
import type { Machine, Pane } from '../../shared/protocol';
import type { NativeState } from '../../shared/native';
import type { NativeControl } from '../useNativeControl';
import { ApiError, api, machineScope, panePath, requestId } from '../../shared/client';
import { loadDraft, saveDraft } from '../storage';
import { useTheme } from '../theme';

interface Props { machine: Machine; session: string; pane: Pane; online: boolean; compact?: boolean; native?: NativeState | null; control?: NativeControl; onError: (message: string) => void; onSent: () => void; onTerminal: () => void }
export function Composer({ machine, session, pane, online, compact = false, native, control, onError, onSent, onTerminal }: Props): React.JSX.Element {
  const { colors, styles } = useTheme();
  const key = `${machineScope(machine)}:${session}:${pane.pane_id}${native ? `:${native.runtimeId}:${native.conversationId ?? 'starting'}` : ''}`;
  const { width } = useWindowDimensions();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState<'saving' | 'saved' | 'error'>('saved');
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
    let cancelled = false;
    const timer = setTimeout(() => {
      void saveDraft(key, text).then(() => { if (!cancelled) setDraftStatus('saved'); }).catch(() => {
        if (!cancelled) { setDraftStatus('error'); onError('草稿保存失败，请保留当前页面。'); }
      });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, text, ready]);
  function edit(value: string): void { current.current = value; setText(value); setDraftStatus('saving'); }
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
  function draftHint(): string {
    if (!online) return '离线 · 可继续编辑';
    if (blocked) return '等待确认后发送';
    if (native && !control?.owns) return '接管后即可发送';
    if (working && !native) return '完成后即可发送';
    if (text) {
      if (draftStatus === 'error') return '草稿未保存';
      if (draftStatus === 'saving') return '保存草稿…';
      return '草稿已保存';
    }
    return native && working ? '可补充当前任务' : '继续当前会话';
  }
  return <View style={{ paddingTop: compact ? 6 : 10, paddingHorizontal: compact ? 12 : 16, paddingBottom: compact ? 6 : 12, backgroundColor: colors.bg }}>
    <View testID="composer" style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.surface }}>
      <TextInput accessibilityLabel="发给原会话的消息" multiline value={text} onChangeText={edit} editable={ready} maxLength={32000}
        placeholder={blocked ? '先完成 agent 当前的确认，草稿会保留…' : native && !control?.owns ? '接管后即可发送，草稿可以先写…' : native && working ? '补充到当前任务…' : '继续交给 agent…'} placeholderTextColor={colors.muted}
        style={{ color: colors.text, fontSize: 16, lineHeight: 25, padding: compact ? 12 : 16, paddingBottom: 8, minHeight: compact ? 48 : 68, maxHeight: compact ? 110 : 160, textAlignVertical: 'top' }}
        onKeyPress={event => {
          const native = event.nativeEvent as typeof event.nativeEvent & { ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean };
          if (Platform.OS === 'web' && native.key === 'Enter' && (native.ctrlKey || native.metaKey) && !native.isComposing) { event.preventDefault(); void send(); }
        }} />
      <View style={[styles.row, { paddingHorizontal: 8, paddingBottom: 8, gap: 6 }]}>
        <Pressable onPress={onTerminal} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }} accessibilityRole="button" accessibilityLabel="打开原始终端"><TerminalSquare size={17} color={colors.muted} /></Pressable>
        <View style={[styles.row, { flex: 1, minWidth: 0, gap: 4 }]}>{!!text && online && !blocked && writable && draftStatus === 'saved' && !(working && !native) && <Check size={12} color={colors.muted} />}<Text numberOfLines={1} style={{ color: !online || draftStatus === 'error' ? colors.amber : colors.muted, fontSize: 12 }}>{draftHint()}</Text></View>
        <View style={[styles.row, { gap: 6 }]}>{working && native && <Pressable accessibilityRole="button" onPress={interrupt} disabled={!online || !writable} accessibilityLabel="中断 agent" style={[styles.button, styles.secondary, { paddingHorizontal: 10, opacity: online && writable ? 1 : 0.4 }]}><Square size={12} color={colors.text} /><Text style={{ color: colors.text, fontSize: 13 }}>停止</Text></Pressable>}
        {working && !native ? <Pressable accessibilityRole="button" onPress={interrupt} disabled={!online} accessibilityLabel="中断 agent" style={[styles.button, styles.secondary, { opacity: online ? 1 : 0.4 }]}><Square size={12} color={colors.text} /><Text style={{ color: colors.text, fontSize: 14 }}>中断</Text></Pressable>
          : <Pressable accessibilityRole="button" accessibilityLabel="发送消息" disabled={disabled} onPress={send} style={[styles.button, { paddingHorizontal: 12, minWidth: 76, gap: 5, backgroundColor: disabled ? colors.hover : colors.accent }]}>{busy ? <ActivityIndicator size="small" color={colors.muted} /> : <><ArrowUp size={17} color={disabled ? colors.dim : colors.accentInk} /><Text style={{ fontSize: 14, fontWeight: '600', color: disabled ? colors.dim : colors.accentInk }}>{native && working ? '补充' : '发送'}</Text></>}</Pressable>}
        </View>
      </View>
    </View>
    {!compact && Platform.OS === 'web' && width >= 900 && <Text style={[styles.muted, { alignSelf: 'flex-end', marginTop: 6, fontSize: 12 }]}>⌘ / Ctrl + Enter 发送</Text>}
  </View>;
}
