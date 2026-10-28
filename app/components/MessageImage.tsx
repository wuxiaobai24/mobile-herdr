import { createContext, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import type { ChatMedia, Machine } from '../../shared/protocol';
import { api, panePath } from '../../shared/client';
import { safeExternalUrl } from '../../shared/markdown';
import { useTheme } from '../theme';

export const MessageMediaContext = createContext<{ machine: Machine; session: string; pane: string; cwd?: string } | undefined>(undefined);
export function MessageImage({ src, media, alt = '图片', thumbnail = false }: { src?: string; media?: ChatMedia; alt?: string; thumbnail?: boolean }): React.JSX.Element {
  const context = useContext(MessageMediaContext), { colors, styles } = useTheme();
  const [uri, setUri] = useState(''), [error, setError] = useState(''), [open, setOpen] = useState(false);
  const name = media?.name ?? alt;
  useEffect(() => {
    let cancelled = false; setUri(''); setError('');
    async function load(): Promise<string> {
      const value = media?.url ?? media?.path ?? src ?? '';
      if (!media?.attachmentId) {
        if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length < 12000000) return value;
        const external = safeExternalUrl(value);
        if (external?.startsWith('https://') || external?.startsWith('http://')) return external;
      }
      if (!context) throw new Error('图片来源不可用');
      const { machine, session, pane, cwd } = context;
      let path = value.replace(/^file:\/\//, '');
      if (cwd && path.startsWith(cwd.replace(/\/$/, '') + '/')) path = path.slice(cwd.replace(/\/$/, '').length + 1);
      if (!media?.attachmentId && (path.split(/[\\/]/).includes('..') || !path)) throw new Error('图片路径无效');
      let endpoint = panePath(session, pane, 'files') + `&mode=preview&path=${encodeURIComponent(path)}`;
      if (path.startsWith('/')) endpoint = panePath(session, pane, 'media') + `&path=${encodeURIComponent(path)}`;
      if (media?.attachmentId) endpoint = panePath(session, pane, 'attachments') + `&id=${encodeURIComponent(media.attachmentId)}`;
      const result = await api<{ uri?: string }>(machine, endpoint);
      if (!result.uri) throw new Error('此文件无法作为图片预览');
      return result.uri;
    }
    void load().then(value => { if (!cancelled) setUri(value); }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '图片加载失败'); });
    return () => { cancelled = true; };
  }, [src, media?.url, media?.path, media?.attachmentId, context]);
  if (error) return <Text style={[styles.muted, { paddingVertical: 8 }]}>{name} · {error}</Text>;
  if (!uri) return <View style={{ minHeight: thumbnail ? 36 : 80, justifyContent: 'center' }}><ActivityIndicator color={colors.muted} /></View>;
  return <View style={{ width: thumbnail ? 36 : '100%', minWidth: thumbnail ? 36 : 120, maxWidth: 600 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`查看图片 ${name}`} onPress={() => setOpen(true)} style={{ overflow: 'hidden', borderRadius: 12, backgroundColor: colors.sidebar }}>
      <Image accessibilityLabel={name} source={{ uri }} resizeMode="contain" onError={() => setError('图片加载失败')} style={{ width: '100%', height: thumbnail ? 36 : 200 }} />
    </Pressable>
    <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={[styles.row, { paddingHorizontal: 16, minHeight: 52 }]}><Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>{name}</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" onPress={() => setOpen(false)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={colors.text} /></Pressable></View>
        <Image source={{ uri }} resizeMode="contain" accessibilityLabel={`完整图片 ${name}`} style={{ flex: 1, width: '100%' }} />
      </SafeAreaView>
    </Modal>
  </View>;
}
