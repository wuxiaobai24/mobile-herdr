import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ScanLine, X } from 'lucide-react-native';
import { parsePairing, type Pairing } from '../../shared/pairing';
import { useTheme } from '../theme';

export function PairingScanner({ onPairing }: { onPairing: (pairing: Pairing) => void }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const consumed = useRef(false);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') setOpen(false); });
    return () => listener.remove();
  }, []);
  async function start(): Promise<void> {
    setError(''); consumed.current = false;
    try {
      const granted = permission?.granted || (await requestPermission()).granted;
      if (granted) setOpen(true);
      else setError('相机权限未开启，可以手动填写连接信息。');
    } catch { setError('无法打开相机，可以手动填写连接信息。'); }
  }
  return <View style={{ gap: 10 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="扫描配对二维码" onPress={start} style={[styles.button, styles.secondary]}><ScanLine size={18} color={colors.text} /><Text style={{ color: colors.text, fontSize: 14 }}>扫描配对二维码</Text></Pressable>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.amber, fontSize: 14, lineHeight: 21 }}>{error}</Text>}
    {!!error && permission?.canAskAgain === false && <Pressable accessibilityRole="button" onPress={() => { void Linking.openSettings(); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>打开应用权限设置</Text></Pressable>}
    {open && <View style={{ gap: 8 }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}><Text style={styles.muted}>扫描开发机运行 pair 后显示的二维码</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭扫码" onPress={() => setOpen(false)} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}><X size={20} color={colors.text} /></Pressable></View>
      <CameraView style={{ height: 220, borderRadius: 12, overflow: 'hidden' }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onMountError={() => { setOpen(false); setError('相机不可用，可以手动填写连接信息。'); }}
        onBarcodeScanned={({ data }) => {
          if (consumed.current || AppState.currentState !== 'active') return;
          const pairing = parsePairing(data);
          if (!pairing) { setError('这不是有效的 Mobile Herdr 配对码。'); return; }
          consumed.current = true; setOpen(false); setError(''); onPairing(pairing);
        }} />
    </View>}
  </View>;
}
