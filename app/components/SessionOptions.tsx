import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Brain, Check, ChevronRight, CircleHelp, ClipboardList, Cpu, FileDiff, Hammer, Maximize2, Minimize2, Monitor, Search, ShieldCheck, Square, TerminalSquare, X } from 'lucide-react-native';
import type { NativeSkill, NativeState } from '../../shared/native';
import { availableChatCommands, reasoningLabel } from '../../shared/chat-commands';
import type { NativeControl } from '../useNativeControl';
import { useTheme } from '../theme';

export type OptionsPage = 'menu' | 'model' | 'reasoning' | 'skills';
const commandIcons: Record<string, typeof Search> = { stop: Square, compact: Minimize2, plan: ClipboardList, build: Hammer, review: ShieldCheck, search: Search, changes: FileDiff, editor: Maximize2, terminal: TerminalSquare, desktop: Monitor };
interface Props {
  state?: NativeState | null; control?: NativeControl; online: boolean;
  page: OptionsPage; onPage: (page: OptionsPage) => void; onClose: () => void;
  onCommand: (name: string) => void;
  onSkill: (skill: NativeSkill) => void;
}
export function SessionOptions({ state, control, online, page, onPage, onClose, onCommand, onSkill }: Props): React.JSX.Element {
  const { colors, styles } = useTheme();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const selectedModel = state?.models?.find(model => model.id === state.model);
  const canChange = online && !!state?.connected && !!control?.owns && state.status === 'idle' && !busy;
  const models = state?.models?.filter(model => `${model.id}\n${model.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];
  const skills = (state?.skills ?? []).filter(skill => `${skill.name} ${skill.title ?? ''} ${skill.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  async function choose(action: 'model' | 'reasoning', value: string): Promise<void> {
    if (!canChange || !control) return;
    setBusy(value); setError('');
    try { await control.act(action, action === 'model' ? { model: value } : { reasoningEffort: value }); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : '切换失败，请重试。'); }
    finally { setBusy(''); }
  }
  const title = { model: '选择模型', reasoning: '思考强度', skills: '选择技能', menu: '会话快捷选项' }[page];
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' }}>
      <Pressable accessibilityLabel="关闭会话快捷选项背景" onPress={onClose} style={{ flex: 1 }} />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.surface, maxHeight: '78%', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: colors.line }}>
        <View style={[styles.row, { minHeight: 52, paddingHorizontal: 12, gap: 8 }]}>
          {page !== 'menu' && <Pressable accessibilityRole="button" accessibilityLabel="返回会话快捷选项" onPress={() => { onPage('menu'); setQuery(''); setError(''); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><ArrowLeft size={18} color={colors.muted} /></Pressable>}
          <Text style={{ flex: 1, color: colors.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭会话快捷选项" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={colors.muted} /></Pressable>
        </View>
        {page === 'model' && <TextInput accessibilityLabel="搜索会话模型" value={query} onChangeText={setQuery} autoCapitalize="none" placeholder="搜索模型" placeholderTextColor={colors.muted} style={[styles.field, { marginHorizontal: 16, marginBottom: 8, fontSize: 16 }]} />}
        {page === 'skills' && <TextInput accessibilityLabel="搜索会话技能" value={query} onChangeText={setQuery} autoCapitalize="none" placeholder="搜索技能名称或用途" placeholderTextColor={colors.muted} style={[styles.field, { marginHorizontal: 16, marginBottom: 8, fontSize: 16 }]} />}
        {!!error && <Text accessibilityRole="alert" style={{ color: colors.amber, paddingHorizontal: 16, paddingBottom: 8, fontSize: 13 }}>{error}</Text>}
        {page !== 'menu' && page !== 'skills' && !canChange && <View style={[styles.row, { gap: 8, paddingHorizontal: 16, paddingBottom: 8 }]}>
          <Text style={[styles.muted, { flex: 1 }]}>{!online ? '连接恢复后可切换' : !control?.owns ? '接管当前会话后可切换' : busy ? '正在切换…' : '任务结束后可切换'}</Text>
          {!!state?.connected && online && !control?.owns && <Pressable accessibilityRole="button" accessibilityLabel="接管并继续设置" onPress={() => { void control?.act('claim').catch(error => setError(error instanceof Error ? error.message : '接管失败。')); }} style={[styles.button, styles.secondary]}><Text style={styles.text}>在手机继续</Text></Pressable>}
        </View>}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          {page === 'menu' && <>
            {!!state?.capabilities.models && <Pressable accessibilityRole="button" accessibilityLabel="选择会话模型" onPress={() => onPage('model')} style={[styles.row, { minHeight: 48, gap: 12 }]}><Cpu size={18} color={colors.muted} /><Text style={{ color: colors.text, fontSize: 14 }}>模型</Text><Text numberOfLines={1} style={[styles.muted, { flex: 1, textAlign: 'right' }]}>{selectedModel?.name ?? state.model ?? '选择'}</Text><ChevronRight size={16} color={colors.dim} /></Pressable>}
            {!!state?.capabilities.reasoning && !!selectedModel?.reasoningEfforts?.length && <Pressable accessibilityRole="button" accessibilityLabel="选择思考强度" onPress={() => onPage('reasoning')} style={[styles.row, { minHeight: 48, gap: 12 }]}><Brain size={18} color={colors.muted} /><Text style={{ color: colors.text, fontSize: 14 }}>思考强度</Text><Text style={[styles.muted, { flex: 1, textAlign: 'right' }]}>{state.reasoningEffort ? reasoningLabel(state.reasoningEffort) : '默认'}</Text><ChevronRight size={16} color={colors.dim} /></Pressable>}
            {state?.context && <View style={[styles.row, { minHeight: 40, gap: 12 }]}><Text style={[styles.muted, { flex: 1 }]}>上下文 · 上次请求</Text><Text style={styles.muted}>{Math.round(state.context.tokens / state.context.window * 100)}% · {state.context.tokens.toLocaleString()} / {state.context.window.toLocaleString()}</Text></View>}
            {availableChatCommands(state).filter(command => !['model', 'reasoning', 'help', 'status'].includes(command.name)).map(command => {
              const Icon = commandIcons[command.name] ?? CircleHelp;
              const selected = command.name === 'plan' && state?.mode === 'plan' || command.name === 'build' && state?.mode === 'default';
              return <Pressable accessibilityRole="button" accessibilityLabel={`命令 /${command.name}`} accessibilityState={{ selected }} key={command.name} onPress={() => onCommand(command.name)} style={[styles.row, { minHeight: 44, gap: 12 }]}><Icon size={18} color={selected ? colors.accent : colors.muted} /><Text style={{ color: colors.text, fontSize: 14, flexShrink: 1 }}>{command.title}</Text><Text numberOfLines={1} style={[styles.muted, { flex: 1, textAlign: 'right', fontSize: 12 }]}>{command.terminal ? '原终端 · ' : ''}/{command.name}</Text>{selected && <Check size={15} color={colors.accent} />}</Pressable>;
            })}
          </>}
          {page === 'skills' && <>
            <Text style={[styles.muted, { paddingBottom: 8 }]}>选择后加入草稿，随下一条消息使用。</Text>
            {skills.map(skill => <Pressable key={skill.path} accessibilityRole="button" accessibilityLabel={`选择技能 ${skill.name}`} onPress={() => onSkill(skill)} style={{ minHeight: 60, paddingVertical: 10, gap: 4 }}><Text style={{ color: colors.text, fontSize: 14 }}>{skill.title ?? skill.name}</Text><Text style={{ color: colors.accent, fontSize: 13 }}>${skill.name}</Text><Text style={[styles.muted, { lineHeight: 20 }]}>{skill.description}</Text></Pressable>)}
            {!skills.length && <Text style={[styles.muted, { paddingVertical: 16 }]}>没有匹配的可用技能</Text>}
          </>}
          {page === 'model' && <>
            {models.map(model => <Pressable key={model.id} accessibilityRole="button" accessibilityLabel={`使用模型 ${model.name}`} accessibilityState={{ selected: state?.model === model.id }} disabled={!canChange} onPress={() => void choose('model', model.id)} style={[styles.row, { minHeight: 52, paddingVertical: 8, gap: 8, opacity: canChange || busy === model.id ? 1 : 0.5 }]}><View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.text, fontSize: 14 }}>{model.name}</Text>{model.id !== model.name && <Text style={[styles.muted, { fontSize: 12 }]}>{model.id}</Text>}</View>{busy === model.id ? <ActivityIndicator color={colors.accent} /> : state?.model === model.id && <Check size={17} color={colors.accent} />}</Pressable>)}
            {!models.length && <Text style={[styles.muted, { paddingVertical: 16 }]}>没有匹配的可用模型</Text>}
          </>}
          {page === 'reasoning' && <>
            {selectedModel?.reasoningEfforts?.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={`使用思考强度 ${option.id}`} accessibilityState={{ selected: state?.reasoningEffort === option.id }} disabled={!canChange} onPress={() => void choose('reasoning', option.id)} style={[styles.row, { minHeight: 48, gap: 12, opacity: canChange || busy === option.id ? 1 : 0.5 }]}><Text style={{ flex: 1, color: colors.text, fontSize: 14 }}>{reasoningLabel(option.id)}</Text>{busy === option.id ? <ActivityIndicator color={colors.accent} /> : state?.reasoningEffort === option.id && <Check size={17} color={colors.accent} />}</Pressable>)}
            {!selectedModel?.reasoningEfforts?.length && <Text style={[styles.muted, { paddingVertical: 16 }]}>当前模型未提供可选的思考强度</Text>}
          </>}
        </ScrollView>
      </SafeAreaView>
    </View>
  </Modal>;
}
