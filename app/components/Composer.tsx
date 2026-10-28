import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, AppState, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowUp, Check, FileText, Minimize2, Paperclip, SlidersHorizontal, Square, TerminalSquare, X } from 'lucide-react-native';
import type { Machine, Pane } from '../../shared/protocol';
import type { NativeSkill, NativeState } from '../../shared/native';
import type { NativeControl } from '../useNativeControl';
import { ApiError, api, machineScope, panePath, requestId } from '../../shared/client';
import { loadDraft, saveDraft } from '../storage';
import { useTheme } from '../theme';
import { availableChatCommands, chatCommands, parseChatCommand } from '../../shared/chat-commands';
import { SessionOptions, type OptionsPage } from './SessionOptions';
import { pickAttachments } from '../attachment-picker';
import { MAX_ATTACHMENTS, attachmentSize, type Attachment, type PickedAttachment } from '../../shared/attachments';
import type { MessageQueueControl } from '../useMessageQueue';
import type { QueuedMessage } from '../../shared/queue';
import { QueuedMessages } from './QueuedMessages';
import { MessageImage, MessageMediaContext } from './MessageImage';

interface DraftAttachment extends Attachment { pending?: PickedAttachment; uploading?: boolean; error?: string }
function attachmentDraft(files: DraftAttachment[]): string {
  return JSON.stringify(files.map(({ pending, uploading: _uploading, error, ...file }) => ({ ...file,
    ...(pending ? { error: '附件尚未上传完成，请移除后重新选择。' } : error ? { error } : {}),
  })));
}

const definitiveRejections = new Set(['agent_working', 'agent_blocked', 'agent_not_ready', 'agent_restarting', 'not_an_agent', 'unauthorized', 'invalid_input', 'pane_not_found', 'unsupported_action', 'control_required', 'control_changed', 'conversation_changed', 'runtime_changed', 'queue_unsupported', 'queue_disconnected', 'queue_target_changed', 'queue_full']);
function wasRejected(error: unknown): boolean { return error instanceof ApiError && definitiveRejections.has(error.code); }

interface Props { queue?: MessageQueueControl; machine: Machine; session: string; pane: Pane; online: boolean; compact?: boolean; native?: NativeState | null; control?: NativeControl; onError: (message: string) => void; onSent: () => void; onTerminal: () => void; onNavigate?: (target: 'search' | 'changes' | 'files') => void }
export function Composer({ queue, machine, session, pane, online, compact = false, native, control, onError, onSent, onTerminal, onNavigate }: Props): React.JSX.Element {
  const { colors, styles } = useTheme();
  const legacyKey = `${machineScope(machine)}:${session}:${pane.pane_id}${native ? `:${native.runtimeId}:${native.conversationId ?? 'starting'}` : ''}`;
  const key = `${machineScope(machine)}:${session}:${pane.pane_id}${native ? `:${native.provider}:${native.conversationId ?? 'starting'}:${pane.terminal_id}` : ''}`;
  const { width } = useWindowDimensions();
  const mobile = width < 900;
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [nativeInputHeight, setNativeInputHeight] = useState(44);
  const [text, setText] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const attachmentRef = useRef<DraftAttachment[]>([]);
  const [picking, setPicking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [optionsPage, setOptionsPage] = useState<OptionsPage>();
  const [submissionError, setSubmissionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<'immediate' | 'next'>('immediate');
  const [stopping, setStopping] = useState(false);
  const [ready, setReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState<'saving' | 'saved' | 'error'>('saved');
  const current = useRef('');
  const mounted = useRef(true);
  const request = useRef<{ text: string; id: string; skills?: string[]; attachments?: string[]; runtimeId?: string; queueEpoch?: number; delivery?: 'immediate' | 'next' } | null>(null);
  const quickRequest = useRef<{ text: string; id: string; runtimeId?: string } | null>(null);
  const working = native ? native.status === 'working' || native.status === 'blocked' : pane.agent_status === 'working';
  const canStop = online && !stopping && (!native || native.connected && !!control?.clientId && (control.owns || native.owner === 'desktop'));
  const blocked = native ? native.requests.length > 0 : pane.agent_status === 'blocked';
  const writable = native ? native.connected && !!control?.owns : !!pane.agent;
  const command = parseChatCommand(text);
  const commands = availableChatCommands(native);
  const mediaContext = useMemo(() => ({ machine, session, pane: pane.pane_id, cwd: pane.foreground_cwd ?? pane.cwd }), [machine.url, machine.token, machine.remote, session, pane.pane_id, pane.foreground_cwd, pane.cwd]);
  const suggestions = /^\/[\w:.-]*$/.test(text) ? commands.filter(command => command.name.toLowerCase().startsWith(text.slice(1).toLowerCase())) : [];
  const skillMention = text.match(/(?:^|\s)\$([\w:.-]*)$/);
  const skillSuggestions = skillMention ? (native?.skills ?? []).filter(skill => `${skill.name} ${skill.title ?? ''}`.toLocaleLowerCase().includes(skillMention[1]!.toLocaleLowerCase())) : [];
  useLayoutEffect(() => {
    if (!mobile || expanded || Platform.OS !== 'web') return;
    const element = input.current as unknown as HTMLTextAreaElement | null;
    if (!element?.style) return;
    if (!text) { element.style.height = '44px'; return; }
    // Reset before measuring so removing lines also shrinks the textarea.
    element.style.height = '0px';
    element.style.height = `${Math.max(44, Math.min(compact ? 100 : 124, element.scrollHeight))}px`;
  }, [text, mobile, width, compact, expanded]);
  useEffect(() => {
    mounted.current = true;
    setReady(false); request.current = null;
    setSelectedSkills([]);
    async function restore(suffix: string): Promise<string> {
      const saved = await loadDraft(key + suffix);
      if (saved || key === legacyKey) return saved;
      let old = await loadDraft(legacyKey + suffix);
      if (old && native && [':delivery', ':quick-delivery'].includes(suffix)) {
        try { old = JSON.stringify({ ...JSON.parse(old), runtimeId: native.runtimeId }); } catch { /* Invalid receipt metadata is handled below. */ }
      }
      if (old) { await saveDraft(key + suffix, old); await saveDraft(legacyKey + suffix, ''); }
      return old;
    }
    void Promise.all(['', ':delivery', ':quick-delivery', ':skills', ':attachments'].map(restore)).then(([value, delivery, quickDelivery, skills, files]) => {
      if (!mounted.current) return;
      if (delivery) { try { request.current = JSON.parse(delivery); if (request.current?.delivery === 'next') setDelivery('next'); } catch { request.current = null; } }
      if (quickDelivery) { try { quickRequest.current = JSON.parse(quickDelivery); } catch { quickRequest.current = null; } }
      try { const paths: unknown = JSON.parse(skills || '[]'); if (Array.isArray(paths) && paths.every(path => typeof path === 'string')) setSelectedSkills(paths); } catch { /* Keep the text draft if metadata is invalid. */ }
      try { const saved: unknown = JSON.parse(files || '[]'); if (Array.isArray(saved) && saved.every(file => typeof file.id === 'string' && typeof file.name === 'string')) { attachmentRef.current = saved; setAttachments(saved); } } catch { /* Preserve the text draft if attachment metadata is invalid. */ }
      current.current = value; setText(value); setReady(true);
    }).catch(() => { if (mounted.current) { setReady(true); onError('无法读取草稿存储。'); } });
    return () => { mounted.current = false; void saveDraft(key, current.current).catch(() => {}); };
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') void saveDraft(key, current.current).catch(() => { setDraftStatus('error'); });
    });
    return () => subscription.remove();
  }, [key, ready]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.all([saveDraft(key, text), saveDraft(key + ':skills', JSON.stringify(selectedSkills)), saveDraft(key + ':attachments', attachmentDraft(attachments))]).then(() => { if (!cancelled) setDraftStatus('saved'); }).catch(() => {
        if (!cancelled) { setDraftStatus('error'); onError('草稿保存失败，请保留当前页面。'); }
      });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, text, selectedSkills, attachments, ready]);
  function updateAttachments(files: DraftAttachment[]): void { attachmentRef.current = files; setAttachments(files); setDraftStatus('saving'); }
  async function upload(file: DraftAttachment): Promise<void> {
    if (!file.pending || file.uploading) return;
    updateAttachments(attachmentRef.current.map(row => row.id === file.id ? { ...row, uploading: true, error: undefined } : row));
    try {
      const stored = await api<Attachment>(machine, panePath(session, pane.pane_id, 'attachments'), { id: file.id, body: { name: file.name, base64: file.pending.base64 } });
      const files: DraftAttachment[] = attachmentRef.current.map(row => row.id === file.id ? stored : row);
      await saveDraft(key + ':attachments', attachmentDraft(files));
      if (mounted.current) updateAttachments(files);
    } catch (error) {
      if (mounted.current) updateAttachments(attachmentRef.current.map(row => row.id === file.id ? { ...row, uploading: false, error: error instanceof Error ? error.message : '上传失败，请重试。' } : row));
    }
  }
  async function attach(): Promise<void> {
    if (busy || picking) return;
    if (native && !native.capabilities.attachments) { onError('当前 agent 适配器尚未支持附件。请在任务结束后使用新版启动器。'); return; }
    setPicking(true);
    try {
      const picked = await pickAttachments();
      if (!mounted.current) return;
      if (attachmentRef.current.length + picked.length > MAX_ATTACHMENTS) throw new Error('每条消息最多选择 6 个附件。');
      const files = picked.map(pending => ({ id: requestId(), name: pending.name, mime: pending.mime, size: pending.size, pending }));
      updateAttachments([...attachmentRef.current, ...files]);
      for (const file of files) await upload(file);
    } catch (error) { onError(error instanceof Error ? error.message : '无法选择附件。'); }
    finally { if (mounted.current) setPicking(false); }
  }
  function edit(value: string): void { current.current = value; setText(value); setDraftStatus('saving'); setSubmissionError(''); }
  function chooseSkill(skill: NativeSkill): void {
    if (busy) return;
    setSelectedSkills(paths => [...new Set([...paths, skill.path])]);
    const draft = current.current;
    const mention = draft.match(/(?:^|\s)\$([\w:.-]*)$/);
    let prefix = draft === '/skills' ? '' : draft;
    if (mention) prefix = draft.slice(0, draft.length - mention[1]!.length - 1);
    else if (prefix) prefix += ' ';
    edit(prefix + `$${skill.name} `);
    setOptionsPage(undefined); input.current?.focus();
  }
  async function runCommand(name: string, argument: string, id: string): Promise<boolean> {
    if (name === 'skills' && native?.capabilities.skills) { setExpanded(false); setOptionsPage('skills'); return false; }
    if (commands.some(command => command.name === name && command.terminal)) throw new Error(`/${name} 由 Codex 原终端处理。请打开「终端」，交还电脑输入权后输入此命令；草稿已保留。`);
    if (name === 'help' || name === 'status' || name === 'model' && !argument || name === 'reasoning' && !argument) {
      setExpanded(false); setOptionsPage(name === 'model' || name === 'reasoning' ? name : 'menu'); return false;
    }
    setOptionsPage(undefined);
    if (name === 'editor') { setExpanded(true); return false; }
    if (name === 'terminal') { setExpanded(false); onTerminal(); return false; }
    if (name === 'search' || name === 'changes' || name === 'files') { setExpanded(false); onNavigate?.(name); return false; }
    if (name === 'stop') { if (!canStop) throw new Error('当前连接无法停止任务。'); await interrupt(id); return false; }
    if (!native || !control || !native.connected || !online) throw new Error('此操作需要连接原生会话；可切换终端执行。');
    if (!control.owns) throw new Error('请先点击「在手机继续」，再执行此操作。');
    if (name === 'model') await control.act('model', { model: argument }, id);
    else if (name === 'reasoning') await control.act('reasoning', { reasoningEffort: argument }, id);
    else if (name === 'compact') await control.act('compact', {}, id);
    else if ((name === 'plan' || name === 'build') && native.capabilities.modes) await control.act('mode', { mode: name === 'plan' ? 'plan' : 'default' }, id);
    else if (name === 'review' && native.capabilities.review) await control.act('review', {}, id);
    else if (name === 'desktop') await control.act('release', {}, id);
    else if (native.commands?.some(command => command.name === name)) await control.act('command', { text: `/${name}${argument ? ' ' + argument : ''}` }, id);
    else throw new Error(`当前会话未提供 /${name}，可切换终端执行。`);
    return true;
  }
  async function quickCommand(name: string): Promise<void> {
    if (busy) return;
    if (!chatCommands.some(command => command.name === name)) {
      if (current.current.trim() && !/^\/[\w:.-]*$/.test(current.current)) { onError('请先处理当前草稿，再填入命令。'); return; }
      setOptionsPage(undefined); edit(`/${name} `); input.current?.focus(); return;
    }
    const fromSlash = /^\/[\w:.-]*$/.test(current.current);
    const submission = current.current;
    const commandText = '/' + name;
    if (quickRequest.current?.text === commandText && quickRequest.current.runtimeId && quickRequest.current.runtimeId !== native?.runtimeId) { onError('旧实例的操作结果未确认，请核对原对话后再选择操作。'); return; }
    if (quickRequest.current?.text !== commandText) quickRequest.current = { text: commandText, id: requestId(), runtimeId: native?.runtimeId };
    setBusy(true);
    try {
      await saveDraft(key + ':quick-delivery', JSON.stringify(quickRequest.current));
      await runCommand(name, '', quickRequest.current.id);
      quickRequest.current = null; await saveDraft(key + ':quick-delivery', '');
      if (fromSlash && current.current === submission) edit('');
    } catch (error) {
      if (wasRejected(error)) { quickRequest.current = null; await saveDraft(key + ':quick-delivery', '').catch(() => {}); }
      onError(error instanceof Error ? error.message : '命令执行失败，请检查当前会话。');
    }
    finally { if (mounted.current) setBusy(false); }
  }
  async function send(): Promise<void> {
    if (text.trim() === '/') { setOptionsPage('menu'); edit(''); return; }
    if (!text.trim() && !attachments.length || !ready || busy || picking || attachments.some(file => file.pending || file.error) || !command && (!online || (working && !native) || blocked && delivery !== 'next' || !writable)) return;
    if (command && attachments.length) { onError('附件会随消息发送，请先输入消息或移除附件，再执行命令。'); return; }
    if (!command && delivery === 'next' && (!native?.capabilities.idlePrompt || !queue?.ready)) { onError('下一轮消息尚未就绪。请检查连接，或在任务结束后用新版 mherdr 重启当前适配器。'); return; }
    const submission = text;
    if (request.current?.text === submission && (request.current.delivery ?? 'immediate') !== delivery) { onError('上次发送结果未确认，请先核对原会话，再更改投递方式。'); return; }
    if (request.current?.text === submission && request.current.runtimeId && request.current.runtimeId !== native?.runtimeId) { onError('旧实例的发送结果未确认。请先核对当前对话，再修改草稿后发送。'); return; }
    const skills = selectedSkills.filter(path => {
      const skill = native?.skills?.find(skill => skill.path === path);
      return !skill || submission.includes('$' + skill.name);
    });
    const files = attachments.map(file => file.id);
    if (request.current?.text !== submission || JSON.stringify(request.current?.skills ?? []) !== JSON.stringify(skills) || JSON.stringify(request.current?.attachments ?? []) !== JSON.stringify(files)) request.current = { text: submission, id: requestId(), skills, attachments: files, runtimeId: native?.runtimeId, queueEpoch: native?.epoch, delivery };
    setBusy(true); setSubmissionError('');
    try {
      // Keep a receipt across refreshes, including ambiguous network failures.
      await saveDraft(key, submission); await saveDraft(key + ':skills', JSON.stringify(selectedSkills)); await saveDraft(key + ':delivery', JSON.stringify(request.current));
      if (command) await runCommand(command.name, command.argument, request.current.id);
      else if (native && delivery === 'next' && queue) await queue.enqueue(pane, { ...native, epoch: request.current.queueEpoch ?? native.epoch }, submission, request.current.skills, request.current.attachments, request.current.id);
      else if (native && control) await control.act('prompt', { text: submission, skills: request.current.skills, attachments: request.current.attachments }, request.current.id);
      else await api(machine, panePath(session, pane.pane_id, 'prompt'), { body: { text: submission, attachments: request.current.attachments }, id: request.current.id });
      // Save against the submitted pane even if navigation happened during the request.
      if (current.current === submission) {
        await saveDraft(key, '');
        if (current.current === submission) {
          current.current = '';
          setSelectedSkills([]); await saveDraft(key + ':skills', '');
          updateAttachments([]); await saveDraft(key + ':attachments', '');
          if (mounted.current) { setText(''); if (!command) setExpanded(false); }
        } else await saveDraft(key, current.current);
      }
      request.current = null;
      await saveDraft(key + ':delivery', '');
      if (mounted.current && !command) { setDelivery('immediate'); onSent(); }
    } catch (error) {
      if (wasRejected(error)) { request.current = null; await saveDraft(key + ':delivery', '').catch(() => {}); }
      if (mounted.current) {
        const message = error instanceof Error ? error.message : '发送失败，草稿已保留。';
        setSubmissionError(message); onError(message);
      }
    }
    finally { if (mounted.current) setBusy(false); }
  }
  async function interrupt(id = requestId()): Promise<void> {
    if (!canStop) return;
    setStopping(true);
    try { if (native && control) await control.interrupt(id); else await api(machine, panePath(session, pane.pane_id, 'interrupt'), { id, body: { terminalId: pane.terminal_id, agent: pane.agent, conversation: pane.agent_session?.value } }); }
    catch (error) { onError(error instanceof Error ? error.message : '中断失败。'); throw error; }
    finally { if (mounted.current) setStopping(false); }
  }
  const disabled = !text.trim() && !attachments.length || busy || picking || attachments.some(file => file.pending || file.error) || !ready || !command && (!online || (working && !native) || blocked && delivery !== 'next' || !writable || !!native && working && delivery === 'immediate' && !native.capabilities.steer || delivery === 'next' && (!native?.capabilities.idlePrompt || !queue?.ready));
  function draftHint(): string {
    if (!online) return '离线 · 可继续编辑';
    if (attachments.some(file => file.uploading)) return '附件上传中…';
    if (attachments.some(file => file.error)) return '附件待处理';
    if (delivery === 'next' && native?.capabilities.idlePrompt) return '空闲后开启下一轮 · 断线后暂停';
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
  function placeholder(): string {
    if (delivery === 'next') return mobile && width < 360 ? '下一轮再做…' : '留到下一轮处理…';
    if (mobile && width < 360 && !expanded) {
      if (blocked) return '等待确认…';
      if (native && !control?.owns) return '先写草稿…';
      if (working && !native) return '工作中…';
      return native && working ? '补充任务…' : '继续任务…';
    }
    if (blocked) return mobile ? '确认后再发送…' : '先完成 agent 当前的确认，草稿会保留…';
    if (native && !control?.owns) return mobile ? '先写草稿，接管后发送…' : '接管后即可发送，草稿可以先写…';
    if (working && !native && mobile) return 'Agent 正在工作…';
    return native && working ? '补充到当前任务…' : '继续交给 agent…';
  }
  async function recover(row: QueuedMessage): Promise<void> {
    if (current.current.trim() || attachments.length) throw new Error('请先处理当前草稿，再取回队列消息。');
    const files = await Promise.all((row.attachments ?? []).map(id => api<Attachment>(machine, panePath(session, pane.pane_id, 'attachments') + '&id=' + encodeURIComponent(id))));
    await Promise.all([saveDraft(key, row.text), saveDraft(key + ':skills', JSON.stringify(row.skills ?? [])), saveDraft(key + ':attachments', attachmentDraft(files))]);
    edit(row.text); setSelectedSkills(row.skills ?? []); updateAttachments(files); setDelivery('immediate');
    // An uncertain delivery remains visible until the user explicitly removes it.
    if (row.status !== 'uncertain') await queue?.change(row, 'discard');
  }
  const queueRows = queue?.rows.filter(row => row.paneId === pane.pane_id) ?? [];
  const queued = <QueuedMessages rows={queueRows} online={online} onError={onError} onChange={async (row, action) => { if (action === 'recover') await recover(row); else await queue?.change(row, action); }} />;
  const deliveryChoice = native && !command && (working || delivery === 'next') && <View testID="delivery-choice" style={[styles.row, { gap: 4, paddingBottom: 4 }]}>
    {(['immediate', 'next'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={value === 'immediate' ? '补充本轮' : '下一轮再做'} accessibilityState={{ selected: delivery === value }} aria-pressed={delivery === value}
      onPress={() => { if (value === 'next' && !native.capabilities.idlePrompt) { onError('当前适配器尚未支持下一轮消息，请在任务结束后用新版 mherdr 重启。'); return; } setDelivery(value); }}
      style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 8, backgroundColor: delivery === value ? colors.hover : 'transparent' }}><Text style={{ color: delivery === value ? colors.text : colors.muted, fontSize: 13 }}>{value === 'immediate' ? '补充本轮' : '下一轮再做'}</Text></Pressable>)}
  </View>;
  const editor = <TextInput ref={input} accessibilityLabel="发给原会话的消息" multiline autoFocus={expanded} numberOfLines={mobile && !expanded ? 1 : undefined} value={text} onChangeText={edit} editable={ready} maxLength={32000}
    placeholder={placeholder()} placeholderTextColor={colors.muted}
    style={{ color: colors.text, fontSize: 16, lineHeight: 24, padding: mobile ? 10 : 16, minWidth: 0,
      flex: expanded || mobile ? 1 : undefined, height: mobile && !expanded ? nativeInputHeight : undefined, minHeight: expanded ? 0 : mobile ? 44 : 68,
      maxHeight: expanded ? undefined : mobile ? 124 : 160, textAlignVertical: 'top' }}
    onContentSizeChange={event => { if (Platform.OS !== 'web' && mobile) setNativeInputHeight(text ? Math.max(44, Math.min(124, event.nativeEvent.contentSize.height)) : 44); }}
    onKeyPress={event => {
      const native = event.nativeEvent as typeof event.nativeEvent & { ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean };
      if (Platform.OS === 'web' && native.key === 'Enter' && (native.ctrlKey || native.metaKey) && !native.isComposing) { event.preventDefault(); void send(); }
    }} />;
  const hint = <View style={[styles.row, { flex: mobile ? undefined : 1, minWidth: 0, gap: 4 }]}>
    {!!text && online && !blocked && writable && draftStatus === 'saved' && !(working && !native) && <Check size={12} color={colors.muted} />}
    <Text numberOfLines={1} accessibilityLiveRegion="polite" style={{ color: !online || draftStatus === 'error' ? colors.amber : colors.muted, fontSize: 12, lineHeight: 16 }}>{draftHint()}</Text>
  </View>;
  const actions = <View style={[styles.row, { gap: 4, alignSelf: mobile ? 'flex-end' : undefined }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="添加图片或文件" disabled={!ready || busy || picking || !online} onPress={() => void attach()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: busy || picking || !online ? 0.4 : 1 }}>{picking ? <ActivityIndicator size="small" color={colors.muted} /> : <Paperclip size={18} color={colors.muted} />}</Pressable>
    {!expanded && <Pressable accessibilityRole="button" accessibilityLabel="会话快捷选项" onPress={() => setOptionsPage('menu')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><SlidersHorizontal size={18} color={colors.muted} /></Pressable>}
    {(working && native || blocked && !native) && <Pressable accessibilityRole="button" onPress={() => { void interrupt().catch(() => {}); }} disabled={!canStop} accessibilityLabel="中断 agent"
      style={[styles.button, styles.secondary, { paddingHorizontal: mobile ? 0 : 10, width: mobile ? 44 : undefined, opacity: canStop ? 1 : 0.4 }]}>
      {stopping ? <ActivityIndicator size="small" color={colors.muted} /> : <Square size={mobile ? 16 : 12} color={colors.text} />}{!mobile && <Text style={{ color: colors.text, fontSize: 13 }}>停止</Text>}
    </Pressable>}
    {working && !native && !command ? <Pressable accessibilityRole="button" onPress={() => { void interrupt().catch(() => {}); }} disabled={!canStop} accessibilityLabel="中断 agent"
      style={[styles.button, styles.secondary, { width: mobile ? 44 : undefined, paddingHorizontal: mobile ? 0 : 14, opacity: canStop ? 1 : 0.4 }]}>
      {stopping ? <ActivityIndicator size="small" color={colors.muted} /> : <Square size={16} color={colors.text} />}{!mobile && <Text style={{ color: colors.text, fontSize: 14 }}>中断</Text>}
    </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="发送消息" disabled={disabled} onPress={send}
      style={[styles.button, { paddingHorizontal: mobile ? 0 : 12, minWidth: mobile ? 44 : 76, gap: 5, backgroundColor: disabled ? colors.hover : colors.accent }]}>
      {busy ? <ActivityIndicator size="small" color={colors.muted} /> : <><ArrowUp size={mobile ? 20 : 17} color={disabled ? colors.dim : colors.accentInk} />{!mobile && <Text style={{ fontSize: 14, fontWeight: '600', color: disabled ? colors.dim : colors.accentInk }}>{delivery === 'next' ? '排队' : native && working ? '补充' : '发送'}</Text>}</>}
    </Pressable>}
  </View>;
  const commandSuggestions = !!suggestions.length && <ScrollView testID="slash-suggestions" keyboardShouldPersistTaps="handled" style={{ maxHeight: 176, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.surface, marginBottom: 6 }}>
    {suggestions.map(command => <Pressable key={command.name} accessibilityRole="button" accessibilityLabel={`使用命令 /${command.name}`} onPress={() => void quickCommand(command.name)} style={[styles.row, { minHeight: 44, paddingHorizontal: 12, gap: 12 }]}><Text style={{ color: colors.accent, fontSize: 14 }}>/{command.name}</Text><Text numberOfLines={1} style={[styles.muted, { flex: 1, textAlign: 'right', fontSize: 13 }]}>{command.terminal ? '在原终端使用' : command.title}</Text></Pressable>)}
  </ScrollView>;
  const skillChoices = !!skillSuggestions.length && <ScrollView testID="skill-suggestions" keyboardShouldPersistTaps="handled" style={{ maxHeight: 176, marginBottom: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.surface }}>
    {skillSuggestions.map(skill => <Pressable key={skill.path} accessibilityRole="button" accessibilityLabel={`使用技能 ${skill.name}`} onPress={() => chooseSkill(skill)} style={{ minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, gap: 4 }}><Text style={{ color: colors.accent, fontSize: 14 }}>${skill.name}</Text><Text numberOfLines={2} style={styles.muted}>{skill.description}</Text></Pressable>)}
  </ScrollView>;
  const attachmentTray = !!attachments.length && <MessageMediaContext.Provider value={mediaContext}><ScrollView horizontal testID="attachment-tray" keyboardShouldPersistTaps="handled" style={{ maxHeight: 112, marginBottom: 8 }} contentContainerStyle={{ gap: 8 }}>
    {attachments.map(file => <View key={file.id} style={{ width: 180, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: 8, gap: 4 }}>
      <View style={[styles.row, { gap: 6 }]}>{file.pending?.mime.startsWith('image/') ? <Image source={{ uri: `data:${file.pending.mime};base64,${file.pending.base64}` }} style={{ width: 36, height: 36, borderRadius: 5 }} /> : file.mime.startsWith('image/') ? <MessageImage thumbnail media={{ type: 'image', name: file.name, attachmentId: file.id }} /> : <FileText size={20} color={colors.muted} />}<Text numberOfLines={1} style={[styles.text, { flex: 1, fontSize: 13 }]}>{file.name}</Text><Pressable accessibilityRole="button" accessibilityLabel={`移除附件 ${file.name}`} disabled={busy || file.uploading} onPress={() => updateAttachments(attachmentRef.current.filter(row => row.id !== file.id))} style={{ width: 32, height: 44, alignItems: 'center', justifyContent: 'center' }}><X size={15} color={colors.muted} /></Pressable></View>
      {file.error ? file.pending ? <Pressable accessibilityRole="button" accessibilityLabel={`重试上传 ${file.name}`} onPress={() => void upload(file)}><Text numberOfLines={2} style={{ color: colors.amber, fontSize: 12 }}>{file.error} · 重试</Text></Pressable> : <Text numberOfLines={2} style={{ color: colors.amber, fontSize: 12 }}>{file.error}</Text> : <Text style={styles.muted}>{file.uploading ? '上传中…' : attachmentSize(file.size)}</Text>}
    </View>)}
  </ScrollView></MessageMediaContext.Provider>;
  if (expanded) return <Modal visible animationType="slide" onRequestClose={() => setExpanded(false)}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, minHeight: 0 }} testID="expanded-composer">
        <View style={[styles.row, { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.line, gap: 12 }]}>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={styles.text}>编辑消息</Text><Text numberOfLines={1} style={styles.muted}>{machine.name} · {session} · {pane.pane_id}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="收起消息编辑器" onPress={() => setExpanded(false)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Minimize2 size={20} color={colors.muted} /></Pressable>
        </View>
        {queued}{deliveryChoice}{commandSuggestions}{skillChoices}{attachmentTray}{editor}
        <View style={{ padding: 12, borderTopWidth: 1, borderColor: colors.line, gap: 8 }}>
          {!!submissionError && <Text accessibilityRole="alert" style={{ color: colors.amber, fontSize: 13, lineHeight: 20 }}>{submissionError}</Text>}
          <View style={[styles.row, { justifyContent: 'space-between', gap: 8 }]}>{hint}<Text style={styles.muted}>{text.length} / 32000</Text>{actions}</View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
  return <View testID="composer-area" style={{ flexShrink: 0, paddingTop: mobile ? 6 : 10, paddingHorizontal: mobile ? 12 : 16, paddingBottom: mobile ? 8 : 12, backgroundColor: colors.bg }}>
    {optionsPage && <SessionOptions state={native} control={control} online={online} page={optionsPage} onPage={setOptionsPage} onClose={() => setOptionsPage(undefined)} onCommand={name => void quickCommand(name)} onSkill={chooseSkill} />}
    {queued}{deliveryChoice}{commandSuggestions}{skillChoices}{attachmentTray}
    <View testID="composer" style={{ borderWidth: 1, borderColor: colors.line, borderRadius: mobile ? 14 : 16, backgroundColor: colors.surface }}>
      {mobile ? <View style={[styles.row, { alignItems: 'flex-end', padding: 4, gap: 4 }]}>{editor}{actions}</View> : <>
        {editor}
        <View style={[styles.row, { paddingHorizontal: 8, paddingBottom: 8, gap: 6 }]}>
          <Pressable onPress={onTerminal} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }} accessibilityRole="button" accessibilityLabel="打开原始终端"><TerminalSquare size={17} color={colors.muted} /></Pressable>
          {hint}{actions}
        </View>
      </>}
    </View>
    {mobile && (!!text || !online || draftStatus === 'error') && <View style={{ paddingHorizontal: 4, paddingTop: 4 }}>{hint}</View>}
    {!compact && Platform.OS === 'web' && !mobile && <Text style={[styles.muted, { alignSelf: 'flex-end', marginTop: 6, fontSize: 12 }]}>⌘ / Ctrl + Enter 发送</Text>}
  </View>;
}
