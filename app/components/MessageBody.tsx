import { memo, useMemo, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Copy, Check } from 'lucide-react-native';
import type { Definition, Nodes, RootContent } from 'mdast';
import { parseMarkdown, safeExternalUrl } from '../../shared/markdown';
import { suppliedChanges } from '../../shared/diff';
import { copyText } from '../clipboard';
import { useTheme, mono } from '../theme';
import { DiffView } from './DiffView';
import { ProjectFileLink } from './ProjectFileLink';
import { MessageImage } from './MessageImage';

function CodeBlock({ value, language }: { value: string; language?: string | null }): React.JSX.Element {
  const { colors, styles, appearance } = useTheme();
  const [copied, setCopied] = useState(false), [error, setError] = useState('');
  if (['diff', 'patch'].includes(language ?? '') && suppliedChanges(value).length) return <DiffView value={value} />;
  return <View style={{ backgroundColor: colors.sidebar, borderColor: colors.line, borderWidth: 1, borderRadius: 10, overflow: 'hidden' }}>
    <View style={[styles.row, { paddingLeft: 12, justifyContent: 'space-between' }]}><Text style={styles.muted}>{language ?? '代码'}</Text><Pressable accessibilityRole="button" accessibilityLabel="复制代码" onPress={() => { void copyText(value).then(() => { setCopied(true); setError(''); }).catch(() => setError('复制失败，请长按选择。')); }} style={[styles.row, { gap: 6, paddingHorizontal: 12, minHeight: 44 }]}>{copied ? <Check size={15} color={colors.accent} /> : <Copy size={15} color={colors.muted} />}<Text style={styles.muted}>{copied ? '已复制' : '复制'}</Text></Pressable></View>
    <ScrollView horizontal contentContainerStyle={{ padding: 12, paddingTop: 4 }}><Text selectable style={{ color: colors.text, fontFamily: mono, fontSize: appearance.readingSize - 1, lineHeight: Math.round(appearance.readingSize * 1.6) }}>{value}</Text></ScrollView>
    {!!error && <Text style={[styles.muted, { padding: 12 }]}>{error}</Text>}
  </View>;
}

export default memo(function MessageBody({ text }: { text: string }): React.JSX.Element {
  const { colors, styles, appearance } = useTheme();
  const tree = useMemo(() => parseMarkdown(text), [text]);
  const [error, setError] = useState('');
  const definitions = new Map<string, Definition>(tree.children.filter((node): node is Definition => node.type === 'definition').map(node => [node.identifier.toLowerCase(), node]));
  function link(url: string, children: ReactNode, key: number): ReactNode {
    const target = safeExternalUrl(url);
    if (!target) return <ProjectFileLink key={key} url={url}>{children}</ProjectFileLink>;
    return <Text key={key} accessibilityRole={target ? 'link' : undefined} style={target ? { color: colors.accent, textDecorationLine: 'underline' } : undefined}
      onPress={target ? () => { void Linking.openURL(target).catch(() => setError('无法打开此链接。')); } : undefined}>{children}</Text>;
  }
  function inline(nodes: Nodes[]): ReactNode[] {
    return nodes.map((node, key) => {
      switch (node.type) {
        case 'text': return node.value;
        case 'inlineCode': return <Text key={key} style={{ fontFamily: mono, backgroundColor: colors.hover }}>{node.value}</Text>;
        case 'strong': return <Text key={key} style={{ fontWeight: '700' }}>{inline(node.children)}</Text>;
        case 'emphasis': return <Text key={key} style={{ fontStyle: 'italic' }}>{inline(node.children)}</Text>;
        case 'delete': return <Text key={key} style={{ textDecorationLine: 'line-through' }}>{inline(node.children)}</Text>;
        case 'break': return '\n';
        case 'link': return link(node.url, inline(node.children), key);
        case 'linkReference': return link(definitions.get(node.identifier.toLowerCase())?.url ?? '', inline(node.children), key);
        case 'image': case 'imageReference': return `[图片${node.alt ? `：${node.alt}` : ''}]`;
        case 'html': return null;
        default: return 'children' in node ? inline(node.children) : 'value' in node ? String(node.value) : null;
      }
    });
  }
  function listMarker(checked: boolean | null | undefined, ordered: boolean | null | undefined, number: number): string {
    if (checked != null) return checked ? '☑' : '☐';
    return ordered ? `${number}.` : '•';
  }
  function blocks(nodes: RootContent[]): ReactNode[] {
    return nodes.map((node, key) => {
      switch (node.type) {
        case 'paragraph': {
          const parts: ReactNode[] = []; let text: Nodes[] = [];
          function flush(): void { if (text.length) { parts.push(<Text selectable key={parts.length} style={styles.text}>{inline(text)}</Text>); text = []; } }
          for (const child of node.children) {
            if (child.type === 'image' || child.type === 'imageReference') {
              flush(); parts.push(<MessageImage key={parts.length} src={child.type === 'image' ? child.url : definitions.get(child.identifier.toLowerCase())?.url} alt={child.alt ?? '图片'} />);
            } else if (child.type === 'link' && !safeExternalUrl(child.url)) {
              flush(); parts.push(<ProjectFileLink key={parts.length} url={child.url}>{inline(child.children)}</ProjectFileLink>);
            } else text.push(child);
          }
          flush(); return <View key={key} style={{ gap: 10 }}>{parts}</View>;
        }
        case 'heading': return <Text selectable key={key} accessibilityRole="header" style={[styles.text, { fontSize: appearance.readingSize + Math.max(1, 7 - node.depth * 2), fontWeight: '700' }]}>{inline(node.children)}</Text>;
        case 'code': return <CodeBlock key={key} value={node.value} language={node.lang} />;
        case 'blockquote': return <View key={key} style={{ paddingLeft: 12, borderLeftWidth: 2, borderColor: colors.line, gap: 8 }}>{blocks(node.children)}</View>;
        case 'list': return <View key={key} style={{ gap: 8 }}>{node.children.map((item, index) => <View key={index} style={[styles.row, { gap: 8, alignItems: 'flex-start' }]}><Text style={styles.text}>{listMarker(item.checked, node.ordered, (node.start ?? 1) + index)}</Text><View style={{ flex: 1, gap: 8 }}>{blocks(item.children)}</View></View>)}</View>;
        case 'table': return <ScrollView key={key} horizontal><View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8 }}>{node.children.map((row, index) => <View key={index} style={[styles.row, { alignItems: 'stretch', backgroundColor: index === 0 ? colors.hover : 'transparent' }]}>{row.children.map((cell, column) => <Text selectable key={column} style={[styles.text, { width: 180, padding: 10, borderWidth: 0.5, borderColor: colors.line, fontWeight: index === 0 ? '600' : '400' }]}>{inline(cell.children)}</Text>)}</View>)}</View></ScrollView>;
        case 'thematicBreak': return <View key={key} style={{ borderBottomWidth: 1, borderColor: colors.line }} />;
        case 'definition': case 'html': return null;
        default: return 'children' in node ? <View key={key} style={{ gap: 8 }}>{blocks(node.children as RootContent[])}</View> : null;
      }
    });
  }
  return <View style={{ gap: 12 }}>{blocks(tree.children)}{!!error && <Text style={{ color: colors.amber }}>{error}</Text>}</View>;
});
