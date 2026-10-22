export {};
// An isolated app-server peer: exercises the real broker transport, never a user's agent.
const thread = { id: 'test-thread-original', turns: [] as any[] };
let turn = 0;
let request: number | undefined;
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
    if (frame.method === 'initialize') result = { userAgent: 'isolated-codex-fixture', platformFamily: 'unix', platformOs: 'linux' };
    if (['thread/start', 'thread/resume'].includes(frame.method)) result = { thread: frame.params?.ephemeral ? { ...thread, id: 'title-helper', ephemeral: true } : thread, model: 'fixture-model' };
    if (frame.method === 'thread/turns/list') result = { data: thread.turns, nextCursor: null };
    if (frame.method === 'model/list') result = { data: [{ id: 'fixture-model', model: 'fixture-model' }] };
    if (frame.method === 'turn/start' || frame.method === 'turn/steer') {
      if (frame.method === 'turn/start') { turn++; event('turn/started', { turn: { id: `turn-${turn}`, status: 'inProgress' } }); }
      const text = frame.params.input[0].text;
      event('item/completed', { item: { id: 'user-' + frame.id, type: 'userMessage', content: [{ type: 'text', text }] } });
      event('item/agentMessage/delta', { itemId: 'reply-' + frame.id, delta: '已收到：' + text });
      if (text.includes('审批')) {
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
    send({ id: frame.id, result });
  }
});
