import { useState } from 'react';
import { Download, X } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../theme';
import type { PwaInstallState } from '../usePwaInstall';

export function PwaInstallPanel({ visible, onClose, pwa }: { visible: boolean; onClose: () => void; pwa: PwaInstallState }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const [error, setError] = useState('');
  async function install(): Promise<void> {
    try { if (await pwa.install()) onClose(); }
    catch { setError('浏览器未完成安装，请从浏览器菜单添加到主屏幕。'); }
  }
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <ScrollView style={{ flex: 1, backgroundColor: colors.overlay }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
      <View style={{ width: '100%', maxWidth: 400, padding: 22, gap: 18, borderRadius: 18, backgroundColor: colors.sidebar }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={{ color: colors.text, fontSize: 20, fontWeight: '600' }}>安装到手机</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭安装说明" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={colors.muted} /></Pressable></View>
        <Text style={styles.text}>从主屏幕打开，使用独立窗口继续当前会话。</Text>
        {!pwa.secure ? <Text style={styles.text}>请通过公司的 HTTPS 域名打开此页面，再安装到主屏幕。</Text> : <>
          {pwa.available && <Pressable accessibilityRole="button" accessibilityLabel="安装应用" onPress={() => void install()} style={styles.button}><Download size={18} color={colors.accentInk} /><Text style={styles.buttonText}>安装应用</Text></Pressable>}
          <Text style={styles.text}>iPhone / iPad：在 Safari 中点「分享」→「添加到主屏幕」。</Text>
          <Text style={styles.text}>Android：打开浏览器菜单，选择「安装应用」或「添加到主屏幕」。</Text>
        </>}
        {!!error && <Text accessibilityRole="alert" style={{ color: colors.amber, lineHeight: 22 }}>{error}</Text>}
      </View>
    </ScrollView>
  </Modal>;
}
