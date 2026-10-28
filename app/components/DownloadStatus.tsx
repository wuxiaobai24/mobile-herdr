import { Pressable, Text, View } from 'react-native';
import type { useFileDownload } from '../useFileDownload';
import { useTheme } from '../theme';
export function DownloadStatus({ download, name }: { download: ReturnType<typeof useFileDownload>; name?: string }): React.JSX.Element | null {
  const { colors, styles } = useTheme();
  if (!download.message && !download.error) return null;
  return <View testID="download-status" style={{ padding: 10, gap: 6 }}>
    {!!name && <Text numberOfLines={1} style={styles.muted}>{name}</Text>}
    <View style={[styles.row, { gap: 8 }]}><Text accessibilityRole={download.error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ flex: 1, color: download.error ? colors.amber : colors.muted, fontSize: 13, lineHeight: 21 }}>{download.error || download.message}</Text>
      {download.busy && download.progress?.phase !== 'choosing' && <Pressable accessibilityRole="button" accessibilityLabel="取消文件下载" onPress={download.cancel} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.accent }}>取消</Text></Pressable>}
    </View>
  </View>;
}
