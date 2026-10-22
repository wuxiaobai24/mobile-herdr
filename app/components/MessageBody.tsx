import { Text, View } from 'react-native';
import { useTheme, mono } from '../theme';

export default function MessageBody({ text }: { text: string }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const chunks = text.split(/(```[\s\S]*?```)/g);
  return <View style={{ gap: 10 }}>{chunks.map((chunk, index) => chunk.startsWith('```')
    ? <View key={index} style={{ backgroundColor: colors.bg, padding: 14, borderRadius: 7 }}><Text selectable style={{ color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 21 }}>{chunk.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</Text></View>
    : <Text key={index} selectable style={styles.text}>{chunk}</Text>)}</View>;
}
