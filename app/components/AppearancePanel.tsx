import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Check, Minus, Plus, X } from 'lucide-react-native';
import { themes } from '../../shared/themes';
import { useTheme } from '../theme';

export function AppearancePanel({ visible, onClose }: { visible: boolean; onClose: () => void }): React.JSX.Element {
  const { colors, styles, appearance, updateAppearance, appearanceError, ready } = useTheme();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <ScrollView style={{ flex: 1, backgroundColor: colors.overlay }} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <View style={{ width: '100%', maxWidth: 440, padding: 20, borderRadius: 20, backgroundColor: colors.sidebar, borderWidth: 1, borderColor: colors.line, gap: 18 }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={{ color: colors.text, fontSize: 21, fontWeight: '600' }}>外观</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭外观设置" onPress={onClose} style={{ padding: 12 }}><X size={20} color={colors.muted} /></Pressable></View>
        <View accessibilityRole="radiogroup" accessibilityLabel="主题">
          {themes.map(theme => <Pressable key={theme.id} accessibilityRole="radio" accessibilityLabel={theme.name} accessibilityState={{ checked: appearance.theme === theme.id, disabled: !ready }} disabled={!ready} onPress={() => void updateAppearance({ theme: theme.id })}
            style={[styles.row, { minHeight: 52, paddingHorizontal: 10, gap: 12, borderRadius: 10, backgroundColor: appearance.theme === theme.id ? colors.hover : 'transparent' }]}>
            <View style={{ width: 30, height: 30, backgroundColor: theme.colors.bg, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}><View style={{ width: 12, height: 12, backgroundColor: theme.colors.accent, borderRadius: 6 }} /></View>
            <View style={{ flex: 1, gap: 2 }}><Text style={{ color: colors.text, fontSize: 14, fontWeight: appearance.theme === theme.id ? '600' : '400' }}>{theme.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{theme.detail}</Text></View>
            {appearance.theme === theme.id && <Check size={17} color={colors.accent} />}
          </Pressable>)}
        </View>
        <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 12, gap: 10 }}>
          <SizeControl label="阅读字号" value={appearance.readingSize} values={[14, 16, 18, 20]} onChange={readingSize => void updateAppearance({ readingSize })} disabled={!ready} />
          <SizeControl label="终端字号" value={appearance.terminalSize} values={[11, 13, 15, 17]} onChange={terminalSize => void updateAppearance({ terminalSize })} disabled={!ready} />
          <View style={[styles.row, { justifyContent: 'space-between', gap: 12 }]}><Text style={{ color: colors.muted, fontSize: 14 }}>阅读字体</Text><View style={[styles.row, { gap: 4 }]}>{(['system', 'mono'] as const).map(font => <Pressable key={font} accessibilityRole="button" accessibilityLabel={font === 'system' ? '系统字体' : '等宽字体'} accessibilityState={{ selected: appearance.readingFont === font }} disabled={!ready} onPress={() => void updateAppearance({ readingFont: font })} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 8, backgroundColor: appearance.readingFont === font ? colors.hover : 'transparent' }}><Text style={{ color: appearance.readingFont === font ? colors.text : colors.muted, fontSize: 14 }}>{font === 'system' ? '系统' : '等宽'}</Text></Pressable>)}</View></View>
        </View>
        <Text testID="reading-preview" style={styles.text}>接着原来的对话，专注下一步。</Text>
        {!!appearanceError && <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 13, lineHeight: 21 }}>{appearanceError}</Text>}
      </View>
    </ScrollView>
  </Modal>;
}
function SizeControl({ label, value, values, onChange, disabled }: { label: string; value: number; values: number[]; onChange: (value: number) => void; disabled: boolean }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const index = values.indexOf(value);
  return <View style={[styles.row, { justifyContent: 'space-between', gap: 12 }]}><Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text><View style={[styles.row, { gap: 8 }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`减小${label}`} disabled={disabled || index === 0} onPress={() => onChange(values[index - 1])} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.surface, opacity: index === 0 ? .4 : 1 }}><Minus size={16} color={colors.text} /></Pressable>
    <Text accessibilityLabel={`${label} ${value}`} style={{ color: colors.text, fontSize: 14, width: 40, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{value} px</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`增大${label}`} disabled={disabled || index === values.length - 1} onPress={() => onChange(values[index + 1])} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.surface, opacity: index === values.length - 1 ? .4 : 1 }}><Plus size={16} color={colors.text} /></Pressable>
  </View></View>;
}
