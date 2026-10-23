import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { api } from '../../shared/client';
import type { Machine } from '../../shared/protocol';
import { exportDiagnostics, type DiagnosticReport } from '../../shared/diagnostics';
import { copyText } from '../clipboard';
import { useTheme } from '../theme';
import { version } from '../../package.json';
export function DiagnosticsPanel({ visible, machine, session, pane, onClose }: { visible: boolean; machine?: Machine; session: string; pane?: string; onClose: () => void }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const [report, setReport] = useState<DiagnosticReport>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false), [generation, refresh] = useState(0);
  useEffect(() => {
    if (!visible || !machine) return;
    let cancelled = false; setBusy(true); setReport(undefined); setError(''); setCopied(false);
    void api<DiagnosticReport>(machine, `/api/diagnostics?${new URLSearchParams({ session, ...(pane ? { pane } : {}) })}`).then(value => { if (!cancelled) setReport(value); }).catch(() => { if (!cancelled) setError('无法取得诊断。请检查连接或更新 bridge 后重试。'); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [visible, machine?.id, machine?.url, machine?.token, session, pane, generation]);
  async function copy(): Promise<void> { if (!report) return; try { await copyText(exportDiagnostics(report, version)); setCopied(true); } catch { setError('复制失败，请重试或手动选择文字。'); } }
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><ScrollView style={{ flex: 1, backgroundColor: colors.overlay }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}><View style={{ width: '100%', maxWidth: 440, backgroundColor: colors.sidebar, borderRadius: 18, padding: 22, gap: 18 }}>
    <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={{ color: colors.text, fontSize: 21, fontWeight: '600' }}>连接诊断</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭连接诊断" onPress={onClose} style={{ padding: 12 }}><X size={20} color={colors.muted} /></Pressable></View>
    <Text style={styles.muted}>页面 {version}{report ? ` · bridge ${report.bridgeVersion}` : ''}</Text>
    {busy && <ActivityIndicator color={colors.accent} />}
    {report && <><Text style={styles.text}>{report.herdr.connected ? 'Herdr 已连接' : 'Herdr 未连接'}{report.herdr.version ? ` · ${report.herdr.version}` : ''}</Text><Text style={styles.muted}>Bun {report.bunVersion} · {report.platform} {report.arch}{'\n'}{report.herdr.sessionCount} 个 session · SSH 在线 {report.ssh.online} / 连接中 {report.ssh.connecting} / 离线 {report.ssh.offline}{'\n'}{report.managed ? 'bridge 正在后台运行' : 'bridge 正在前台运行'}</Text>
      {report.bridgeVersion !== version && <Text style={{ color: colors.amber, fontSize: 14, lineHeight: 22 }}>页面与 bridge 版本不同，更新 bridge 后刷新页面。</Text>}
      {!!report.native && <Text style={styles.muted}>{report.native.provider} · {report.native.connected ? '原生连接正常' : '原生连接离线'} · {report.native.control === 'desktop' ? '电脑控制' : '手机控制'}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="复制诊断报告" onPress={() => void copy()} style={styles.button}><Text style={styles.buttonText}>{copied ? '已复制诊断报告' : '复制诊断报告'}</Text></Pressable>
      <Text style={styles.muted}>报告仅含版本与连接状态，不含密钥、地址、路径或聊天正文。</Text></>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 14, lineHeight: 22 }}>{error}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel="刷新连接诊断" onPress={() => refresh(n => n + 1)} style={[styles.button, styles.secondary]}><Text style={{ color: colors.text, fontSize: 14 }}>重新检查</Text></Pressable>
  </View></ScrollView></Modal>;
}
