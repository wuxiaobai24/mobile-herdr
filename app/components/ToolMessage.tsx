import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Check, ChevronDown, ChevronRight, FileDiff, Search, TerminalSquare, Wrench, X } from 'lucide-react-native';
import type { ChatMessage } from '../../shared/protocol';
import { suppliedChanges } from '../../shared/diff';
import { useTheme, mono } from '../theme';
import { DiffView } from './DiffView';
import { MessageImage } from './MessageImage';

function toolSummary(message: ChatMessage): { title: string; detail: string } {
  let input: any;
  try { input = JSON.parse(message.text); } catch { input = {}; }
  const tool = message.toolName ?? 'tool';
  const detail = input?.cmd ?? input?.command ?? input?.path ?? input?.file_path ?? input?.query ?? message.text;
  if (/command|exec|bash|shell/i.test(tool)) return { title: '执行命令', detail: String(detail) };
  if (/fileChange|patch|edit|write|diff/i.test(tool)) return { title: '修改文件', detail: suppliedChanges(message.text).map(file => file.path).join(' · ') || String(detail) };
  if (/search|find|web/i.test(tool)) return { title: '搜索', detail: String(detail) };
  if (/read|view/i.test(tool)) return { title: '读取内容', detail: String(detail) };
  return { title: tool.replace(/^.*[./]/, ''), detail: String(detail) };
}
export function ToolMessage({ message, targeted }: { message: ChatMessage; targeted: boolean }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const [open, setOpen] = useState(targeted);
  useEffect(() => { if (targeted) setOpen(true); }, [targeted]);
  const summary = toolSummary(message);
  const Icon = summary.title === '执行命令' ? TerminalSquare : summary.title === '修改文件' ? FileDiff : summary.title === '搜索' ? Search : Wrench;
  const status = message.toolStatus;
  const statusLabel = status === 'running' ? '运行中' : status === 'failed' ? '失败' : status === 'completed' ? '完成' : '';
  function output(value: string): React.JSX.Element {
    if (suppliedChanges(value).length) return <DiffView value={value} />;
    let pretty = value;
    try { pretty = JSON.stringify(JSON.parse(value), null, 2); } catch { /* Terminal output stays verbatim. */ }
    return <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled><ScrollView horizontal contentContainerStyle={{ padding: 12 }}><Text selectable style={{ color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 21 }}>{pretty}</Text></ScrollView></ScrollView>;
  }
  return <View testID="tool-operation" style={{ borderRadius: 10, backgroundColor: colors.sidebar, overflow: 'hidden' }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${open ? '收起' : '展开'}工具 ${message.id}`} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={[styles.row, { padding: 12, minHeight: 54, gap: 10 }]}>
      <Icon size={16} color={colors.muted} /><View style={{ flex: 1, minWidth: 0, gap: 4 }}><View style={[styles.row, { gap: 8 }]}><Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{summary.title}</Text>{status === 'running' ? <ActivityIndicator size="small" color={colors.muted} /> : status === 'failed' ? <X size={13} color={colors.amber} /> : status === 'completed' ? <Check size={13} color={colors.success} /> : null}<Text style={[styles.muted, { fontSize: 12 }]}>{statusLabel}{message.durationMs !== undefined ? ` · ${(message.durationMs / 1000).toFixed(1)}s` : ''}</Text></View><Text numberOfLines={open ? 3 : 1} style={[styles.muted, { fontFamily: mono, fontSize: 13 }]}>{summary.detail}</Text></View>{open ? <ChevronDown size={15} color={colors.muted} /> : <ChevronRight size={15} color={colors.muted} />}
    </Pressable>
    {open && <View style={{ borderTopWidth: 1, borderColor: colors.line, gap: 8, paddingBottom: 8 }}>
      {output(message.text)}{!!message.output && <View style={{ borderTopWidth: 1, borderColor: colors.line }}>{output(message.output)}</View>}
      {message.media?.map((media, index) => media.type === 'image' && <MessageImage key={index} media={media} />)}
      {message.exitCode !== undefined && message.exitCode !== 0 && <Text style={[styles.muted, { paddingHorizontal: 12 }]}>退出码 {message.exitCode}</Text>}
      {message.truncated && <Text style={[styles.muted, { paddingHorizontal: 12 }]}>当前展示部分结果，完整内容请在电脑查看。</Text>}
    </View>}
  </View>;
}
