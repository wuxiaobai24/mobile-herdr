export {};
// An isolated app-server peer: exercises the real broker transport, never a user's agent.
const thread = { id: 'test-thread-original', cwd: '/fixture/project', turns: [] as any[] };
let turn = 0;
let request: number | undefined;
let legacyHistory = false;
function send(frame: object): void { process.stdout.write(JSON.stringify(frame) + '\n'); }
function event(method: string, params: object): void { send({ method, params: { threadId: thread.id, ...params } }); }
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let end: number;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (frame.method === 'initialized') continue;
    if (!frame.method) {
      if (request !== undefined && frame.id === request) { event('serverRequest/resolved', { requestId: request }); request = undefined; }
      continue;
    }
    let result: any = {};
    if (frame.method === 'fixture/legacyHistory') { thread.turns = frame.params.turns; legacyHistory = true; }
    if (frame.method === 'initialize') result = { userAgent: 'isolated-codex-fixture', platformFamily: 'unix', platformOs: 'linux' };
    if (['thread/start', 'thread/resume'].includes(frame.method)) result = { thread: frame.params?.ephemeral ? { ...thread, id: 'title-helper', ephemeral: true } : legacyHistory ? { ...thread, turns: [] } : thread, model: 'fixture-model' };
    if (frame.method === 'thread/turns/list') {
      if (legacyHistory) { send({ id: frame.id, error: { code: -32601, message: 'method not found' } }); continue; }
      result = { data: thread.turns, nextCursor: null };
    }
    if (frame.method === 'thread/read') result = { thread };
    if (frame.method === 'model/list') result = { data: [
      { id: 'fixture-model', model: 'fixture-model', displayName: 'Fixture Model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] },
      { id: 'fixture-fast', model: 'fixture-fast', displayName: 'Fixture Fast', supportedReasoningEfforts: [] },
    ] };
    if (frame.method === 'skills/list') result = { data: [{ cwd: '/fixture/project', skills: [
      { name: 'fixture-skill', path: '/fixture/skills/fixture-skill/SKILL.md', description: '审查移动端交互与布局', enabled: true, interface: { displayName: '移动端审查' } },
      { name: 'disabled-skill', path: '/fixture/skills/disabled/SKILL.md', enabled: false },
    ] }] };
    if (frame.method === 'thread/compact/start') event('fixture/compacted', {});
    if (frame.method === 'config/read' && frame.params?.largeFixture) result = { content: 'x'.repeat(17 * 1024 * 1024) };
    if (frame.method === 'turn/start' || frame.method === 'turn/steer') {
      event('fixture/turnOptions', { model: frame.params.model, effort: frame.params.effort, collaborationMode: frame.params.collaborationMode, input: frame.params.input });
      if (frame.method === 'turn/start') { turn++; event('turn/started', { turn: { id: `turn-${turn}`, status: 'inProgress' } }); }
      const text = frame.params.input[0].text;
      event('item/completed', { item: { id: 'user-' + frame.id, type: 'userMessage', content: frame.params.input.filter((row: any) => ['text', 'localImage', 'image'].includes(row.type)) } });
      event('item/agentMessage/delta', { itemId: 'reply-' + frame.id, delta: '已收到：' + text });
      if (text.includes('文件审批')) {
        request = 900 + turn;
        const changes = text.includes('无内容') ? [] : [{ path: 'app/card.ts', kind: { type: 'update' }, diff: '@@ -1,2 +1,2 @@\n-const color = \"green\";\n+const color = \"blue\";\n export default color;\n' }];
        event('item/started', { item: { id: 'file-change-1', type: 'fileChange', changes } });
        send({ id: request, method: 'item/fileChange/requestApproval', params: { threadId: thread.id, turnId: `turn-${turn}`, itemId: 'file-change-1', startedAtMs: Date.now(), reason: '调整卡片颜色' } });
        event('item/fileChange/patchUpdated', { itemId: 'file-change-1', changes });
      }
      if (text.includes('审批') && !text.includes('文件审批')) {
        request = 900 + turn;
        send({ id: request, method: 'item/commandExecution/requestApproval', params: { threadId: thread.id, turnId: `turn-${turn}`, itemId: 'command-1', command: 'git status --short', reason: '查看工作区状态' } });
      }
      if (text.includes('问题')) {
        request = 900 + turn;
        send({ id: request, method: 'item/tool/requestUserInput', params: { threadId: thread.id, turnId: `turn-${turn}`, itemId: 'question-1', questions: [{ id: 'theme', header: '主题', question: '请选择主题', options: [{ label: '深色', description: '保留当前主题' }, { label: '浅色' }] }] } });
      }
      result = { turn: { id: `turn-${turn}` }, turnId: `turn-${turn}` };
    }
    if (frame.method === 'turn/interrupt') { event('turn/completed', { turn: { id: `turn-${turn}`, status: 'interrupted' } }); }
    if (frame.method === 'review/start') {
      event('fixture/reviewOptions', frame.params);
      result = { reviewThreadId: thread.id, turn: { id: 'review-owned' } };
    }
    send({ id: frame.id, result });
  }
});
