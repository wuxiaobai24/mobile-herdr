import type { TakeoverState } from '../../shared/takeover';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeftRight, ChevronDown, Monitor, Smartphone, X } from 'lucide-react-native';
import type { NativeState } from '../../shared/native';
import type { NativeControl } from '../useNativeControl';
import { useTheme, mono } from '../theme';

interface Props { state?: NativeState | null; control: NativeControl; provider?: string; online: boolean; compact?: boolean; hideBar?: boolean; detailsOpen?: boolean; onDetailsClose?: () => void; onDetailsOpen?: () => void; onError: (text: string) => void; takeover?: TakeoverState | null; enabling?: boolean; onEnable: (cancel?: boolean) => Promise<void>; onRestart?: () => Promise<void> }
export function NativeSession({ state, control, provider, online, compact, hideBar, detailsOpen, onDetailsClose, onDetailsOpen, onError, takeover, enabling, onEnable, onRestart }: Props): React.JSX.Element | null {
  const { colors, styles } = useTheme();
  const [details, setDetails] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (takeover?.phase === 'ready' && control.owns) { setDetails(false); onDetailsClose?.(); } }, [takeover?.phase, control.owns]);
  function closeDetails(): void { setDetails(false); onDetailsClose?.(); }
  async function enable(cancel = false): Promise<void> {
    setSetupError('');
    try { await onEnable(cancel); } catch (error) { setSetupError(error instanceof Error ? error.message : '接管操作未确认，请查看当前状态。'); }
  }
  async function restart(): Promise<void> {
    setSetupError('');
    try { await onRestart?.(); } catch (error) { setSetupError(error instanceof Error ? error.message : '重启结果未确认，请查看原终端。'); }
  }
  async function handoff(): Promise<void> {
    setBusy(true);
    try { await control.act(control.owns ? 'release' : 'claim'); }
    catch (error) { onError(error instanceof Error ? error.message : '切换失败。'); }
    finally { setBusy(false); }
  }
  if (!state && !['codex', 'pi'].includes(provider ?? '')) return null;
  const connected = state?.connected;
  const ready = connected && !!state?.conversationId && state.ready !== false;
  const other = state && control.owner !== 'desktop' && !control.owns;
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
    {!hideBar && <View testID="native-session-bar" style={[styles.row, { gap: 10, paddingHorizontal: 12, paddingVertical: state && !compact ? 8 : 2, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: control.owns ? colors.accentSurface : colors.sidebar }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="查看原生连接详情" onPress={() => { setDetails(true); onDetailsOpen?.(); }} style={[styles.row, { gap: 9, flex: 1, minHeight: 44 }]}>
        {control.owns ? <Smartphone size={17} color={colors.accent} /> : <Monitor size={17} color={colors.muted} />}
        <View style={{ flex: 1, gap: 3 }}><Text style={{ color: control.owns ? colors.accent : colors.text, fontSize: 13, fontWeight: '600' }}>{controlLabel()}</Text>
          {state && !compact && <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{controlHint()}</Text>}</View>{!state && <Text style={{ color: colors.accent, fontSize: 13 }}>启用手机接管</Text>}<ChevronDown size={13} color={colors.muted} />
      </Pressable>
      {state && <Pressable accessibilityRole="button" accessibilityLabel={control.owns ? '交还电脑' : '在手机继续'} disabled={disabled} onPress={handoff}
        style={[styles.row, { gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: control.owns ? colors.hover : colors.accent, opacity: disabled ? 0.45 : 1 }]}>
        {busy ? <ActivityIndicator size="small" color={colors.accentInk} /> : <ArrowLeftRight size={15} color={control.owns ? colors.text : colors.accentInk} />}<Text style={{ color: control.owns ? colors.text : colors.accentInk, fontSize: 13, fontWeight: '600' }}>{control.owns ? '交还电脑' : '在手机继续'}</Text>
      </Pressable>}
    </View>}
    <Modal visible={details || !!detailsOpen} transparent animationType="slide" onRequestClose={closeDetails}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}><View style={{ maxHeight: '80%', backgroundColor: colors.sidebar, padding: 22, borderTopLeftRadius: 18, borderTopRightRadius: 18, gap: 18, borderWidth: 1, borderColor: colors.line }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={{ color: colors.text, fontSize: 20, fontWeight: '600' }}>电脑与手机，接着做</Text><Pressable onPress={closeDetails} accessibilityLabel="关闭原生连接详情" style={{ padding: 10 }}><X size={20} color={colors.muted} /></Pressable></View>
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
        {!!setupError && <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 14, lineHeight: 22 }}>{setupError}</Text>}
        {takeover?.operation === 'restart' && <Text accessibilityLiveRegion="polite" accessibilityRole={takeover.phase === 'failed' ? 'alert' : undefined} style={{ color: takeover.phase === 'failed' ? colors.red : colors.text, fontSize: 14, lineHeight: 22 }}>{takeover.message}</Text>}
        {state ? <>
          <Text style={styles.text}>在手机点「在手机继续」，消息直接进入当前 agent。交还电脑，或在 Herdr 中按 Ctrl+]，即可接回输入权。</Text>
          <Text style={styles.muted}>刷新、断线和关闭手机页面都不会停止 agent。切换时不复制对话，也不启动第二个 agent。</Text>
          {!!state.error && <Text selectable style={{ color: colors.amber, fontSize: 14, lineHeight: 22 }}>{state.error}</Text>}
          <Text selectable style={{ color: colors.muted, fontFamily: mono, fontSize: 12, lineHeight: 20 }}>{state.provider} · {state.conversationId ?? '等待电脑打开对话'}{'\n'}运行实例 {state.runtimeId}</Text>
          {(state.provider === 'pi' || state.provider === 'omp') && <Text style={styles.muted}>标准确认框和问题可在对话中处理。自定义终端界面需交还电脑处理。</Text>}
          <Text style={styles.muted}>适配器 {state.adapterVersion ?? '旧版'}。{state.provider === 'omp' ? 'OMP 请在电脑显式重启连接。' : '用新版重启会等待任务结束，再恢复同一个对话。'}</Text>
          {state.provider !== 'omp' && onRestart && <Pressable accessibilityRole="button" accessibilityLabel="用新版 mherdr 重启当前会话" disabled={enabling || !online || !!other || !!takeover && !['ready', 'failed', 'cancelled'].includes(takeover.phase)} onPress={() => void restart()} style={[styles.button, styles.secondary]}><Text style={styles.text}>用新版 mherdr 重启</Text></Pressable>}
          {takeover?.operation === 'restart' && takeover.cancellable && <Pressable accessibilityRole="button" accessibilityLabel="取消等待重启" onPress={() => void enable(true)} style={[styles.button, styles.secondary]}><Text style={styles.text}>取消等待</Text></Pressable>}
        </> : <>
          <Text style={styles.text}>接入当前 {provider === 'pi' ? 'Pi' : 'Codex'} 会话，将输入权切到手机。</Text>
          <Text style={styles.muted}>{provider === 'pi' ? '保留原 Pi 进程和对话。当前任务完成后开始。' : '首次启用会等待任务完成，退出空闲 Codex 界面，再按准确会话 ID 恢复。之后切换只交接输入权。'}</Text>
          {takeover && <Text accessibilityLiveRegion="polite" accessibilityRole={takeover.phase === 'failed' ? 'alert' : undefined} style={{ color: takeover.phase === 'failed' ? colors.red : colors.text, fontSize: 14, lineHeight: 22 }}>{takeover.message}</Text>}
          {(!takeover || ['failed', 'cancelled'].includes(takeover.phase)) && <Pressable accessibilityRole="button" accessibilityLabel="启用并接管当前会话" disabled={enabling || !online || !control.clientId || !!takeover && !['failed', 'cancelled', 'ready'].includes(takeover.phase)} onPress={() => void enable()} style={[styles.button, { opacity: enabling || !online || !!takeover && !['failed', 'cancelled', 'ready'].includes(takeover.phase) ? 0.5 : 1 }]}><Text style={styles.buttonText}>{enabling ? '正在提交…' : '启用并接管'}</Text></Pressable>}
          {takeover?.cancellable && <Pressable accessibilityRole="button" accessibilityLabel="取消等待接管" onPress={() => void enable(true)} style={[styles.button, styles.secondary]}><Text style={styles.text}>取消等待</Text></Pressable>}

        </>}
      </ScrollView>
    </View></View></Modal>
  </>;
}
