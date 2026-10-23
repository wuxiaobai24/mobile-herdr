import { Bell, Download, FileDiff, Monitor, Palette, Search, Server, X } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../theme';

interface Props {
  visible: boolean; onClose: () => void; title: string; target: string; status: string;
  onReading: () => void; onAppearance: () => void; onMachines: () => void; onAttention: () => void;
  onNativeDetails?: () => void; nativeLabel: string;
  onInstall?: () => void;
  onChanges: () => void; onUpdate: () => void;
}

export function MobileActions({ visible, onClose, title, target, status, onReading, onAppearance, onMachines, onAttention, onNativeDetails, nativeLabel, onInstall, onChanges, onUpdate }: Props): React.JSX.Element {
  const { colors, styles } = useTheme();
  const actions = [
    { label: '查看改动', icon: FileDiff, run: onChanges },
    { label: '查找与历史', icon: Search, run: onReading },
    ...(onNativeDetails ? [{ label: nativeLabel, icon: Monitor, run: onNativeDetails }] : []),
    { label: '查看需要处理的会话', icon: Bell, run: onAttention },
    { label: '管理开发机', icon: Server, run: onMachines },
    { label: '外观设置', icon: Palette, run: onAppearance },
    { label: '版本更新', icon: Download, run: onUpdate },
    ...(onInstall ? [{ label: '安装到手机', icon: Download, run: onInstall }] : []),
  ];
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭更多会话操作" onPress={onClose} style={{ flex: 1 }} />
      <View style={{ maxHeight: '85%', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, backgroundColor: colors.sidebar }}>
        <View style={[styles.row, { gap: 12, paddingLeft: 8, paddingBottom: 12, borderBottomWidth: 1, borderColor: colors.line }]}>
          <View style={{ flex: 1, minWidth: 0, gap: 5 }}><Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{title}</Text><Text style={styles.muted}>{target}</Text><Text style={styles.muted}>{status}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="收起会话操作" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={colors.muted} /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingVertical: 8 }}>
          {actions.map(({ label, icon: Icon, run }) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => { onClose(); run(); }} style={[styles.row, { minHeight: 52, paddingHorizontal: 10, gap: 14, borderRadius: 10 }]}><Icon size={19} color={colors.muted} /><Text style={{ color: colors.text, fontSize: 15 }}>{label}</Text></Pressable>)}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
