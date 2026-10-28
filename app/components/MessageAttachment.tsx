import { useContext } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Download, FileText } from 'lucide-react-native';
import type { ChatMedia } from '../../shared/protocol';
import { panePath } from '../../shared/client';
import { useFileDownload } from '../useFileDownload';
import { DownloadStatus } from './DownloadStatus';
import { useTheme } from '../theme';
import { MessageImage, MessageMediaContext } from './MessageImage';

export function MessageAttachment({ media }: { media: ChatMedia }): React.JSX.Element {
  const context = useContext(MessageMediaContext), { colors, styles } = useTheme();
  const transfer = useFileDownload(), busy = transfer.busy;
  async function save(): Promise<void> {
    if (context && media.attachmentId) await transfer.start(context.machine, panePath(context.session, context.pane, 'attachments') + `&id=${encodeURIComponent(media.attachmentId)}&mode=download`, media.name);
  }
  if (media.type === 'image') return <MessageImage media={media} />;
  return <View><Pressable accessibilityRole="button" accessibilityLabel={`下载附件 ${media.name}`} disabled={busy || !media.attachmentId} onPress={() => void save()} style={[styles.row, { gap: 8, minHeight: 44, paddingVertical: 8 }]}><FileText size={17} color={colors.muted} /><Text numberOfLines={2} style={[styles.text, { flexShrink: 1, fontSize: 14 }]}>{media.name}</Text>{busy ? <ActivityIndicator size="small" color={colors.muted} /> : <Download size={15} color={colors.muted} />}</Pressable><DownloadStatus download={transfer} /></View>;
}
