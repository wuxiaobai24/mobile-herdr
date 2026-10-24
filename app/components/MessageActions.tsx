import { memo, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, Copy } from 'lucide-react-native';
import { copyText } from '../clipboard';
import { useTheme } from '../theme';

export const MessageActions = memo(function MessageActions({ text }: { text: string }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied, text]);
  return <View style={{ alignItems: 'flex-start' }}>
    <Pressable accessibilityRole="button" accessibilityLabel="复制回复" onPress={() => {
      void copyText(text).then(() => { setCopied(true); setError(''); }).catch(() => setError('复制失败，请长按选择正文。'));
    }} style={[styles.row, { width: 44, height: 44, justifyContent: 'center', borderRadius: 8 }]}>
      {copied ? <Check size={15} color={colors.accent} /> : <Copy size={15} color={colors.muted} />}
    </Pressable>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.amber, fontSize: 13 }}>{error}</Text>}
  </View>;
});
