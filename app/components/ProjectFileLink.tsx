import { useContext } from 'react';
import { Text } from 'react-native';
import { MessageMediaContext } from './MessageImage';
import { projectLink } from '../../shared/project-link';
import { filePath } from '../../shared/files';
import { useFileDownload } from '../useFileDownload';
import { useTheme } from '../theme';
export function ProjectFileLink({ url, children }: { url: string; children: React.ReactNode }): React.JSX.Element {
  const context = useContext(MessageMediaContext), { colors, styles } = useTheme(), download = useFileDownload();
  const target = projectLink(url, context?.cwd);
  if (!target || !context) return <Text>{children}<Text style={{ color: colors.muted }}>（文件不在当前项目中，请从对应会话打开）</Text></Text>;
  return <Text style={[styles.text, { minHeight: 44, paddingVertical: 8 }]} accessibilityRole="button" accessibilityLabel={`${download.busy ? '取消下载' : '下载项目文件'} ${target.name}`} onPress={() => download.busy ? download.cancel() : void download.start(context.machine, filePath(context.session, context.pane, target.path, context.cwd, 'download'), target.name)}><Text style={{ color: colors.accent, textDecorationLine: 'underline' }}>{children}{download.busy ? ' · 取消' : ''}</Text>
    {!!(download.message || download.error) && <Text accessibilityRole={download.error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ color: download.error ? colors.amber : colors.muted }}> · {download.error || download.message}</Text>}
  </Text>;
}
