import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { NativeRequest, NativeState } from '../../shared/native';
import type { NativeControl } from '../useNativeControl';
import { requestId } from '../../shared/client';
import { suppliedChanges } from '../../shared/diff';
import { DiffView } from './DiffView';
import { useTheme } from '../theme';

export function NativeRequests({ state, control, online, onError }: { state: NativeState; control: NativeControl; online: boolean; onError: (text: string) => void }): React.JSX.Element | null {
  const request = state.requests[0];
  if (!request) return null;
  return <RequestCard key={request.id} request={request} control={control} enabled={online && control.owns && state.connected} onError={onError} count={state.requests.length} />;
}
function RequestCard({ request, control, enabled, onError, count }: { request: NativeRequest; control: NativeControl; enabled: boolean; onError: (text: string) => void; count: number }): React.JSX.Element {
  const { colors, styles } = useTheme();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const receipt = useRef<{ key: string; id: string } | undefined>(undefined);
  async function reply(decision?: 'accept' | 'decline'): Promise<void> {
    setBusy(true);
    try {
      const key = JSON.stringify({ decision, answers });
      if (receipt.current?.key !== key) receipt.current = { key, id: requestId() };
      await control.act('reply', { request: request.id, decision, answers }, receipt.current.id);
    }
    catch (error) { onError(error instanceof Error ? error.message : '提交失败。'); }
    finally { setBusy(false); }
  }
  return <View style={{ maxHeight: 480, marginHorizontal: 16, marginVertical: 8, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.warningSurface }}>
    <Text style={{ color: colors.amber, fontSize: 14, fontWeight: '600' }}>{request.title}{count > 1 ? ` · ${count} 项待处理` : ''}</Text>
    {request.approvalType === 'files' && !request.changes?.length && <Text style={{ color: colors.amber, fontSize: 13, lineHeight: 21 }}>尚未收到修改内容，请交还电脑查看。</Text>}
    <ScrollView contentContainerStyle={{ gap: 12 }}>{!!request.cwd && <Text selectable style={styles.muted}>目录 · {request.cwd}</Text>}{!!request.command && <View style={{ backgroundColor: colors.bg, borderRadius: 8, padding: 12 }}><Text style={styles.label}>执行命令</Text><Text selectable style={styles.text}>{request.command}</Text></View>}{!!request.changes?.length && <DiffView value={request.changes} />}{!!request.detail && (suppliedChanges(request.detail).length ? <DiffView value={request.detail} /> : <Text selectable style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>{request.detail}</Text>)}
      {request.questions?.map(question => <View key={question.id} style={{ gap: 8 }}><Text style={styles.text}>{question.question}</Text>
        {question.options?.map(option => <Pressable key={option.label} disabled={!enabled || busy} onPress={() => setAnswers({ ...answers, [question.id]: [option.label] })} style={{ padding: 10, borderRadius: 8, backgroundColor: answers[question.id]?.[0] === option.label ? colors.hover : colors.surface, borderWidth: 1, borderColor: answers[question.id]?.[0] === option.label ? colors.accent : colors.line }}><Text style={styles.text}>{option.label}</Text>{!!option.description && <Text style={styles.muted}>{option.description}</Text>}</Pressable>)}
        <TextInput accessibilityLabel={`回答 ${question.id}`} value={answers[question.id]?.[0] ?? ''} editable={enabled && !busy} onChangeText={text => setAnswers({ ...answers, [question.id]: [text] })} placeholder="输入回答" placeholderTextColor={colors.muted} style={[styles.field, { fontSize: 16 }]} />
      </View>)}
    </ScrollView>
    {busy ? <ActivityIndicator color={colors.accent} /> : request.kind === 'approval' ? <View style={[styles.row, { gap: 10 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="拒绝本次操作" disabled={!enabled} onPress={() => reply('decline')} style={[styles.button, styles.secondary, { flex: 1, opacity: enabled ? 1 : 0.5 }]}><Text style={styles.text}>拒绝</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="允许本次操作" disabled={!enabled || (request.approvalType === 'files' && !request.changes?.length)} onPress={() => reply('accept')} style={[styles.button, { flex: 1, opacity: enabled ? 1 : 0.5 }]}><Text style={styles.buttonText}>允许本次</Text></Pressable>
    </View> : request.kind === 'question' ? <Pressable accessibilityRole="button" accessibilityLabel="提交回答" disabled={!enabled || !request.questions?.every(question => answers[question.id]?.[0]?.trim())} onPress={() => reply()} style={styles.button}><Text style={styles.buttonText}>提交回答</Text></Pressable> : <Text style={styles.muted}>交还电脑后处理此请求。</Text>}
  </View>;
}
