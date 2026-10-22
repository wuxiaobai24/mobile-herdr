import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { NativeRequest, NativeState } from '../../shared/native';
import type { NativeControl } from '../useNativeControl';
import { colors, styles } from '../theme';

export function NativeRequests({ state, control, online, onError }: { state: NativeState; control: NativeControl; online: boolean; onError: (text: string) => void }): React.JSX.Element | null {
  const request = state.requests[0];
  if (!request) return null;
  return <RequestCard key={request.id} request={request} control={control} enabled={online && control.owns && state.connected} onError={onError} count={state.requests.length} />;
}
function RequestCard({ request, control, enabled, onError, count }: { request: NativeRequest; control: NativeControl; enabled: boolean; onError: (text: string) => void; count: number }): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  async function reply(decision?: 'accept' | 'decline'): Promise<void> {
    setBusy(true);
    try { await control.act('reply', { request: request.id, decision, answers }); }
    catch (error) { onError(error instanceof Error ? error.message : '提交失败。'); }
    finally { setBusy(false); }
  }
  return <View style={{ maxHeight: 290, marginHorizontal: 16, marginVertical: 8, padding: 14, gap: 10, borderWidth: 1, borderColor: '#62512c', borderRadius: 12, backgroundColor: '#29251b' }}>
    <Text style={{ color: colors.amber, fontSize: 14, fontWeight: '600' }}>{request.title}{count > 1 ? ` · ${count} 项待处理` : ''}</Text>
    <ScrollView contentContainerStyle={{ gap: 12 }}>{!!request.detail && <Text selectable style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>{request.detail}</Text>}
      {request.questions?.map(question => <View key={question.id} style={{ gap: 8 }}><Text style={styles.text}>{question.question}</Text>
        {question.options?.map(option => <Pressable key={option.label} disabled={!enabled || busy} onPress={() => setAnswers({ ...answers, [question.id]: [option.label] })} style={{ padding: 10, borderRadius: 8, backgroundColor: answers[question.id]?.[0] === option.label ? colors.hover : colors.surface, borderWidth: 1, borderColor: answers[question.id]?.[0] === option.label ? colors.accent : colors.line }}><Text style={styles.text}>{option.label}</Text>{!!option.description && <Text style={styles.muted}>{option.description}</Text>}</Pressable>)}
        <TextInput accessibilityLabel={`回答 ${question.id}`} value={answers[question.id]?.[0] ?? ''} editable={enabled && !busy} onChangeText={text => setAnswers({ ...answers, [question.id]: [text] })} placeholder="输入回答" placeholderTextColor={colors.dim} style={[styles.field, { fontSize: 16 }]} />
      </View>)}
    </ScrollView>
    {busy ? <ActivityIndicator color={colors.accent} /> : request.kind === 'approval' ? <View style={[styles.row, { gap: 10 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="拒绝本次操作" disabled={!enabled} onPress={() => reply('decline')} style={[styles.button, styles.secondary, { flex: 1, opacity: enabled ? 1 : 0.5 }]}><Text style={styles.text}>拒绝</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="允许本次操作" disabled={!enabled} onPress={() => reply('accept')} style={[styles.button, { flex: 1, opacity: enabled ? 1 : 0.5 }]}><Text style={styles.buttonText}>允许本次</Text></Pressable>
    </View> : request.kind === 'question' ? <Pressable accessibilityRole="button" accessibilityLabel="提交回答" disabled={!enabled || !request.questions?.every(question => answers[question.id]?.[0]?.trim())} onPress={() => reply()} style={styles.button}><Text style={styles.buttonText}>提交回答</Text></Pressable> : <Text style={styles.muted}>交还电脑后处理此请求。</Text>}
  </View>;
}
