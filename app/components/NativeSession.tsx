import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeftRight, ChevronDown, Monitor, Smartphone, X } from 'lucide-react-native';
import type { NativeState } from '../../shared/native';
import type { NativeControl } from '../useNativeControl';
import { colors, mono, styles } from '../theme';

interface Props { state?: NativeState | null; control: NativeControl; provider?: string; online: boolean; compact?: boolean; onError: (text: string) => void }
export function NativeSession({ state, control, provider, online, compact, onError }: Props): React.JSX.Element | null {
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  async function handoff(): Promise<void> {
    setBusy(true);
    try { await control.act(control.owns ? 'release' : 'claim'); }
    catch (error) { onError(error instanceof Error ? error.message : '切换失败。'); }
    finally { setBusy(false); }
  }
  if (!state && !['codex', 'pi'].includes(provider ?? '')) return null;
  const connected = state?.connected;
  const ready = connected && !!state?.conversationId && state.ready !== false;
  const other = state && state.owner !== 'desktop' && !control.owns;
  const disabled = busy || !online || !connected || (!control.owns && !ready) || !!other || !control.clientId;
  function controlLabel(): string {
    if (!state) return '终端兼容模式';
    if (!connected) return '原生连接中断';
    if (control.owns) return '你正在手机上继续';
    return other ? '另一台设备正在控制' : '电脑正在控制';
  }
  function controlHint(): string {
    if (!connected) return '恢复后可继续操作';
    if (!ready) return '等待电脑完成会话恢复';
    if (control.owns) return '电脑按 Ctrl+] 接回';
    return other ? '等待对方交还输入权' : '接管后发送，随时交还';
  }
  return <>
    <View style={[styles.row, { gap: 10, paddingHorizontal: 16, paddingVertical: state && !compact ? 8 : 2, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: control.owns ? '#14261f' : colors.sidebar }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="查看原生连接详情" onPress={() => setDetails(true)} style={[styles.row, { gap: 9, flex: 1, minHeight: 44 }]}>
        {control.owns ? <Smartphone size={17} color={colors.accent} /> : <Monitor size={17} color={colors.muted} />}
        <View style={{ flex: 1, gap: 3 }}><Text style={{ color: control.owns ? colors.accent : colors.text, fontSize: 13, fontWeight: '600' }}>{controlLabel()}</Text>
          {state && !compact && <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{controlHint()}</Text>}</View>{!state && <Text style={{ color: colors.accent, fontSize: 13 }}>启用手机接管</Text>}<ChevronDown size={13} color={colors.muted} />
      </Pressable>
      {state && <Pressable accessibilityRole="button" accessibilityLabel={control.owns ? '交还电脑' : '在手机继续'} disabled={disabled} onPress={handoff}
        style={[styles.row, { gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: control.owns ? colors.hover : colors.accent, opacity: disabled ? 0.45 : 1 }]}>
        {busy ? <ActivityIndicator size="small" color={colors.accentInk} /> : <ArrowLeftRight size={15} color={control.owns ? colors.text : colors.accentInk} />}<Text style={{ color: control.owns ? colors.text : colors.accentInk, fontSize: 13, fontWeight: '600' }}>{control.owns ? '交还电脑' : '在手机继续'}</Text>
      </Pressable>}
    </View>
    <Modal visible={details} transparent animationType="slide" onRequestClose={() => setDetails(false)}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#070b0bdc' }}><View style={{ maxHeight: '80%', backgroundColor: colors.sidebar, padding: 22, borderTopLeftRadius: 18, borderTopRightRadius: 18, gap: 18, borderWidth: 1, borderColor: colors.line }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={{ color: colors.text, fontSize: 20, fontWeight: '600' }}>电脑与手机，接着做</Text><Pressable onPress={() => setDetails(false)} accessibilityLabel="关闭原生连接详情" style={{ padding: 10 }}><X size={20} color={colors.muted} /></Pressable></View>
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
        {state ? <>
          <Text style={styles.text}>在手机点「在手机继续」，消息直接进入当前 agent。交还电脑，或在 Herdr 中按 Ctrl+]，即可接回输入权。</Text>
          <Text style={styles.muted}>刷新、断线和关闭手机页面都不会停止 agent。切换时不复制对话，也不启动第二个 agent。</Text>
          {!!state.error && <Text selectable style={{ color: colors.amber, fontSize: 14, lineHeight: 22 }}>{state.error}</Text>}
          <Text selectable style={{ color: colors.muted, fontFamily: mono, fontSize: 12, lineHeight: 20 }}>{state.provider} · {state.conversationId ?? '等待电脑打开对话'}{'\n'}运行实例 {state.runtimeId}</Text>
          {state.capabilities.models && control.owns && <ModelOption state={state} control={control} onError={onError} />}
          {state.provider === 'pi' && <Text style={styles.muted}>Pi 标准确认框和问题可直接在对话中处理。其他扩展的自定义终端界面需交还电脑处理。</Text>}
        </> : <>
          <Text style={styles.text}>先在 Herdr 的空闲终端里运行：</Text>
          <Text selectable style={{ color: colors.accent, fontFamily: mono, fontSize: 16 }}>mherdr {provider}</Text>
          <Text style={styles.muted}>现有会话继续使用原终端连接。首次迁移时，先结束当前任务并退出旧 CLI，再通过会话 ID 恢复。不会自动退出或复制你正在运行的 agent。</Text>
          <Text selectable style={{ color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 22 }}>{provider === 'codex' ? 'mherdr codex resume <会话 ID>' : 'mherdr pi --session <会话 ID>'}</Text>
          <Text style={styles.muted}>启用后回到这里，页面会自动显示「在手机继续」。</Text>
        </>}
      </ScrollView>
    </View></View></Modal>
  </>;
}
function ModelOption({ state, control, onError }: { state: NativeState; control: NativeControl; onError: (text: string) => void }): React.JSX.Element {
  const [model, setModel] = useState(state.model ?? '');
  const [busy, setBusy] = useState(false);
  async function save(): Promise<void> {
    setBusy(true); try { await control.act('model', { model }); } catch (error) { onError(error instanceof Error ? error.message : '切换失败。'); } finally { setBusy(false); }
  }
  const choices = state.models?.filter(row => !model || row.id.toLowerCase().includes(model.toLowerCase()) || row.name.toLowerCase().includes(model.toLowerCase())) ?? [];
  return <View style={{ gap: 8 }}><Text style={styles.text}>{state.provider === 'codex' ? '下次手机任务使用的模型' : '当前会话模型'}</Text><TextInput accessibilityLabel="原生模型 ID" value={model} onChangeText={setModel} autoCapitalize="none" style={[styles.field, { fontSize: 16 }]} placeholder="搜索可用模型" placeholderTextColor={colors.dim} />
    {choices.slice(0, 12).map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`选择模型 ${row.name}`} onPress={() => setModel(row.id)} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line }}><Text style={{ color: model === row.id ? colors.accent : colors.text, fontSize: 14 }}>{row.name}</Text><Text style={styles.muted}>{row.id}</Text></Pressable>)}
    <Pressable accessibilityRole="button" disabled={busy || state.status !== 'idle'} onPress={save} style={[styles.button, styles.secondary]}><Text style={styles.text}>{busy ? '正在切换…' : '应用模型'}</Text></Pressable></View>;
}
