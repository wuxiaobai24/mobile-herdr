import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, Download, File, Folder, RefreshCw, Search, X } from 'lucide-react-native';
import type { Machine } from '../../shared/protocol';
import { api } from '../../shared/client';
import { filePath, fileSize, type FileListing, type FilePreview, type ProjectFile } from '../../shared/files';
import { useFileDownload } from '../useFileDownload';
import { DownloadStatus } from './DownloadStatus';
import { mono, useTheme } from '../theme';

interface Props { machine: Machine; session: string; pane: string; onClose: () => void }
export function FileBrowser({ machine, session, pane, onClose }: Props): React.JSX.Element {
  const { colors, styles } = useTheme();
  const root = useRef<string>(undefined);
  const mounted = useRef(true);
  const [path, setPath] = useState(''), [selected, setSelected] = useState<ProjectFile>();
  const [listing, setListing] = useState<FileListing>(), [preview, setPreview] = useState<FilePreview>();
  const [query, setQuery] = useState(''), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const transfer = useFileDownload();
  const [downloadName, setDownloadName] = useState('');
  const [downloadPath, setDownloadPath] = useState('');
  const downloading = transfer.busy ? downloadPath : '';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let closed = false;
    setBusy(true); setError(''); setPreview(undefined);
    if (!selected) setListing(undefined);
    const endpoint = filePath(session, pane, selected?.path ?? path, root.current, selected ? 'preview' : undefined);
    void api<FileListing | FilePreview>(machine, endpoint).then(value => {
      if (closed) return;
      if ('entries' in value) { root.current = value.root; setListing(value); } else setPreview(value);
    }).catch(error => { if (!closed) setError(error instanceof Error ? error.message : '读取失败，请重试。'); })
      .finally(() => { if (!closed) setBusy(false); });
    return () => { closed = true; };
  }, [machine, session, pane, path, selected, revision]);
  function back(): void {
    setError(''); setNotice('');
    if (selected) setSelected(undefined);
    else if (path) { setPath(path.split('/').slice(0, -1).join('/')); setQuery(''); }
    else onClose();
  }
  async function download(entry: ProjectFile): Promise<void> {
    if (downloading) return;
    setDownloadPath(entry.path); setDownloadName(entry.name); setError(''); setNotice('');
    await transfer.start(machine, filePath(session, pane, entry.path, root.current, 'download'), entry.name);
  }
  function icon(label: string, run: () => void, child: React.ReactNode, disabled = false): React.JSX.Element {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={run} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: pressed ? colors.hover : 'transparent', opacity: disabled ? 0.45 : 1 })}>{child}</Pressable>;
  }
  const entries = listing?.entries.filter(entry => entry.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  const title = selected?.name ?? (path ? path.split('/').at(-1) : '项目文件');
  return <Modal visible animationType="slide" onRequestClose={back}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><View testID="file-browser" style={{ flex: 1, minHeight: 0, width: '100%', maxWidth: 1000, alignSelf: 'center' }}>
      <View style={[styles.row, { minHeight: 56, paddingHorizontal: 8, gap: 4, borderBottomWidth: 1, borderColor: colors.line }]}>
        {icon('返回文件目录', back, <ArrowLeft size={20} color={colors.muted} />)}
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{title}</Text><Text numberOfLines={1} style={[styles.muted, { fontSize: 11 }]}>{machine.name} · {pane}{preview ? ` · ${fileSize(preview.size)}` : ''}</Text></View>
        {selected && icon('下载当前文件', () => void download(selected), downloading ? <ActivityIndicator color={colors.accent} /> : <Download size={19} color={colors.muted} />, !!downloading || busy)}
        {icon('刷新文件', () => setRevision(value => value + 1), <RefreshCw size={18} color={colors.muted} />, busy)}
        {icon('关闭文件浏览', onClose, <X size={20} color={colors.muted} />)}
      </View>
      {!selected && <View style={{ paddingHorizontal: 12, borderBottomWidth: 1, borderColor: colors.line }}>
        <View style={[styles.row, { gap: 8 }]}><Search size={16} color={colors.muted} /><TextInput accessibilityLabel="筛选当前目录" value={query} onChangeText={setQuery} placeholder="筛选文件" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, minWidth: 0, minHeight: 44, color: colors.text, fontSize: 16 }} />{!!query && icon('清空文件筛选', () => setQuery(''), <X size={16} color={colors.muted} />)}</View>
        <Text numberOfLines={1} accessibilityLabel={`当前文件目录 ${root.current ?? ''}/${path}`} style={[styles.muted, { fontSize: 12, paddingBottom: 8 }]}>{path ? './' + path : root.current ?? '项目目录'}</Text>
      </View>}
      {!!error && <View style={{ padding: 12, gap: 8 }}><Text accessibilityRole="alert" style={{ color: colors.red, lineHeight: 21 }}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="重试读取文件" onPress={() => setRevision(value => value + 1)} style={[styles.button, styles.secondary]}><RefreshCw size={16} color={colors.text} /><Text style={styles.text}>重试</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="重新打开项目目录" onPress={() => { root.current = undefined; setSelected(undefined); setPath(''); setRevision(value => value + 1); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.muted}>重新打开项目目录</Text></Pressable></View>}
      <DownloadStatus download={transfer} name={downloadName} />
      {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: colors.accent, padding: 12 }}>{notice}</Text>}
      {busy ? <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View> : selected ? <>
        {preview?.kind === 'image' && <Image accessibilityLabel={`图片预览 ${preview.name}`} source={{ uri: preview.uri }} onError={() => setError('图片无法解码，请下载后查看。')} resizeMode="contain" style={{ flex: 1, minHeight: 80, margin: 12 }} />}
        {preview?.kind === 'text' && <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}><ScrollView horizontal><Text selectable testID="file-text-preview" style={{ color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 21 }}>{preview.text || '（空文件）'}</Text></ScrollView>{preview.truncated && <Text style={[styles.muted, { marginTop: 16 }]}>仅预览前 256 KB，下载可查看完整文件。</Text>}</ScrollView>}
        {preview?.kind === 'binary' && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}><File size={36} color={colors.muted} /><Text style={styles.muted}>此格式暂不支持预览</Text><Pressable accessibilityRole="button" accessibilityLabel="下载后查看" disabled={!!downloading} onPress={() => void download(selected)} style={styles.button}><Download size={18} color={colors.accentInk} /><Text style={styles.buttonText}>下载后查看</Text></Pressable></View>}
      </> : <FlatList style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }} data={entries} keyExtractor={entry => entry.path} initialNumToRender={16} windowSize={5}
        renderItem={({ item: entry }) => <View key={entry.path} style={[styles.row, { borderBottomWidth: 1, borderColor: colors.line }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`打开${entry.kind === 'directory' ? '目录' : '文件'} ${entry.name}`} disabled={entry.kind === 'blocked'} onPress={() => { setNotice(''); if (entry.kind === 'directory') { setPath(entry.path); setQuery(''); } else setSelected(entry); }} style={({ pressed }) => [styles.row, { minHeight: 52, gap: 10, flex: 1, minWidth: 0, backgroundColor: pressed ? colors.hover : 'transparent', opacity: entry.kind === 'blocked' ? 0.45 : 1 }]}>
            {entry.kind === 'directory' ? <Folder size={19} color={colors.accent} /> : <File size={18} color={colors.muted} />}<View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.text, fontSize: 14 }}>{entry.name}</Text>{entry.size !== undefined && <Text style={[styles.muted, { fontSize: 11 }]}>{fileSize(entry.size)}</Text>}{entry.kind === 'blocked' && <Text style={[styles.muted, { fontSize: 11 }]}>不可访问</Text>}</View>{entry.kind === 'directory' && <ChevronRight size={16} color={colors.dim} />}
          </Pressable>
          {entry.kind === 'file' && icon(`下载文件 ${entry.name}`, () => void download(entry), downloading === entry.path ? <ActivityIndicator color={colors.accent} /> : <Download size={17} color={colors.muted} />, !!downloading)}
        </View>}
        ListEmptyComponent={!error ? <Text style={[styles.muted, { paddingVertical: 24 }]}>{query ? '没有匹配的文件' : '目录为空'}</Text> : undefined}
        ListFooterComponent={listing?.truncated ? <Text style={[styles.muted, { paddingVertical: 12 }]}>目录过大，仅显示前 1000 项。请进入子目录继续浏览。</Text> : undefined}
      />}
    </View></SafeAreaView>
  </Modal>;
}
