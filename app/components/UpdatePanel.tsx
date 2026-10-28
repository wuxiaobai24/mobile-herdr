import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Download, RefreshCw, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Machine } from '../../shared/protocol';
import type { UpdateState } from '../../server/updates';
import { ApiError, api, machineScope, requestId } from '../../shared/client';
import { useFileDownload } from '../useFileDownload';
import { DownloadStatus } from './DownloadStatus';
import { fileSize } from '../../shared/files';
import { useTheme } from '../theme';

function UpdateContent({ machine, onClose }: { machine: Machine; onClose: () => void }): React.JSX.Element {
  const { colors, styles } = useTheme(), insets = useSafeAreaInsets();
  const [state, setState] = useState<UpdateState>();
  const [checkError, setCheckError] = useState(''), [submitError, setSubmitError] = useState(''), [pending, setPending] = useState(false), [revision, setRevision] = useState(0);
  const transfer = useFileDownload();
  const [apk, setApk] = useState<{ available: boolean; version?: string; size: number }>();
  const [apkNotice, setApkNotice] = useState('');
  useEffect(() => { let live = true; void api<typeof apk>(machine, '/api/android').then(value => { if (live) setApk(value); }).catch(() => {}); return () => { live = false; }; }, [machine]);
  const generation = useRef(0), writing = useRef(false), delivery = useRef<string>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let closed = false, timer: ReturnType<typeof setTimeout>;
    async function poll(): Promise<void> {
      const request = generation.current;
      try {
        if (!writing.current) {
          const next = await api<UpdateState>(machine, '/api/update');
          if (closed || request !== generation.current) return;
          setState(next); setCheckError('');
          if (next.phase !== 'idle') setSubmitError('');
          if (next.phase === 'failed' || !next.available) delivery.current = undefined;
        }
      } catch (error) { if (!closed && request === generation.current) setCheckError(error instanceof Error ? error.message : '检查失败。'); }
      finally { if (!closed) timer = setTimeout(() => void poll(), 5000); }
    }
    void poll(); return () => { closed = true; clearTimeout(timer); };
  }, [machine, revision]);
  const active = pending || state?.phase === 'installing' || state?.phase === 'restarting';
  async function update(): Promise<void> {
    if (active) return;
    generation.current++; writing.current = true; setPending(true); setSubmitError(''); setCheckError('');
    try { const next = await api<UpdateState>(machine, '/api/update', { body: {}, id: delivery.current ??= requestId() }); delivery.current = undefined; if (mounted.current) setState(next); }
    catch (error) { if (error instanceof ApiError && error.status) delivery.current = undefined; if (mounted.current) setSubmitError(error instanceof Error ? error.message : '更新提交失败，请先检查状态。'); }
    finally { writing.current = false; if (mounted.current) { setPending(false); setRevision(value => value + 1); } }
  }
  const error = submitError || checkError;
  const disabled = !state?.available || !state.supported || active;
  return <View testID="update-panel" style={{ maxHeight: '90%', backgroundColor: colors.sidebar, padding: 16, paddingBottom: Math.max(16, insets.bottom), gap: 8, borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
    <View style={[styles.row, { gap: 4 }]}><Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', flex: 1 }}>版本更新</Text><Pressable accessibilityRole="button" accessibilityLabel="重新检查版本" disabled={active} onPress={() => { setCheckError(''); setRevision(value => value + 1); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><RefreshCw size={18} color={colors.muted} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="关闭版本更新" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={colors.muted} /></Pressable></View>
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
      <Text numberOfLines={1} style={styles.muted}>{machine.name} · Web Bridge</Text>
      {state ? <><Text style={styles.text}>当前 {state.current}{state.latest ? ` · 最新 ${state.latest}` : ''}</Text><Text accessibilityLiveRegion="polite" style={styles.text}>{state.message}</Text></> : !error && <ActivityIndicator color={colors.accent} />}
      {!!error && <Text accessibilityRole="alert" style={{ color: colors.red, lineHeight: 22 }}>{error}</Text>}
      <Text style={styles.muted}>校验发布包后切换 Bridge，agent 继续运行。失败时自动恢复。</Text>
      {state && !state.supported && <Text style={styles.muted}>请在此开发机使用 mobile-herdr background 启动，才能在页面内更新。</Text>}
      {Platform.OS === 'android' && <Text style={styles.muted}>此处更新开发机服务。手机 App 请下载并安装新版 APK。</Text>}
    </ScrollView>
    {!!error && !state && <Pressable accessibilityRole="button" accessibilityLabel="重试检查更新" onPress={() => { setCheckError(''); setRevision(value => value + 1); }} style={styles.button}><RefreshCw size={17} color={colors.accentInk} /><Text style={styles.buttonText}>重试</Text></Pressable>}
    {state?.phase === 'ready' && !state.available && Platform.OS === 'web' ? <Pressable accessibilityRole="button" onPress={() => window.location.reload()} style={styles.button}><RefreshCw size={17} color={colors.accentInk} /><Text style={styles.buttonText}>加载新版本</Text></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="一键更新到最新版本" disabled={disabled} onPress={() => void update()} style={[styles.button, { opacity: disabled ? 0.45 : 1 }]}>{active ? <ActivityIndicator color={colors.accentInk} /> : <Download size={17} color={colors.accentInk} />}<Text style={styles.buttonText}>{active ? '更新中' : '更新到最新版本'}</Text></Pressable>}
    {apk?.available && <Pressable accessibilityRole="button" accessibilityLabel="下载最新 Android APK" disabled={transfer.busy} onPress={() => void transfer.start(machine, '/api/android?mode=download', 'mobile-herdr.apk')} style={[styles.button, styles.secondary, { opacity: transfer.busy ? 0.5 : 1 }]}><Download size={17} color={colors.text} /><Text numberOfLines={2} style={[styles.text, { flexShrink: 1 }]}>{transfer.busy ? 'APK 下载中' : `下载本机 APK${apk.version ? ' · ' + apk.version : ''}`} · {fileSize(apk.size)}</Text></Pressable>}
    <DownloadStatus download={transfer} />
    {state?.latest && <Pressable accessibilityRole="button" accessibilityLabel="打开 Android APK 发布页" onPress={() => void Linking.openURL(`https://github.com/wuxiaobai24/mobile-herdr/releases/tag/v${encodeURIComponent(state.latest!)}`).then(() => setApkNotice('已打开发布页，请在浏览器下载 APK，并查看浏览器下载列表。')).catch(() => setApkNotice('无法打开发布页，请检查浏览器。'))} style={[styles.button, styles.secondary]}><Text style={styles.text}>打开 APK 发布页</Text></Pressable>}
    {!!apkNotice && <Text accessibilityLiveRegion="polite" style={styles.muted}>{apkNotice}</Text>}
  </View>;
}
export function UpdatePanel({ visible, onClose, machine }: { visible: boolean; onClose: () => void; machine?: Machine }): React.JSX.Element {
  const { colors } = useTheme();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>{visible && machine && <UpdateContent key={`${machine.id}:${machineScope(machine)}`} machine={machine} onClose={onClose} />}</View></Modal>;
}
