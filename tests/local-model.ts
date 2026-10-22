/** Local wire-compatible peers. No paid API, user credential or external model is used. */
export function localModel() {
  let requests = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      requests++; await request.json();
      const headers = { 'content-type': 'text/event-stream' };
      if (new URL(request.url).pathname.endsWith('/responses')) {
        const item = { id: 'msg-local', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '本地隔离验证成功', annotations: [] }] };
        const events: [string, object][] = [
          ['response.created', { response: { id: 'resp-local', object: 'response', status: 'in_progress', output: [] } }],
          ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } }],
          ['response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: '本地隔离验证成功' }],
          ['response.output_item.done', { output_index: 0, item }],
          ['response.completed', { response: { id: 'resp-local', object: 'response', status: 'completed', output: [item], usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } } }],
        ];
        return new Response(events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`).join(''), { headers });
      }
      return new Response([
        { id: 'chat-local', choices: [{ index: 0, delta: { role: 'assistant', content: '本地隔离验证成功' }, finish_reason: null }] },
        { id: 'chat-local', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } },
      ].map(data => `data: ${JSON.stringify(data)}\n\n`).join('') + 'data: [DONE]\n\n', { headers });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, get requests() { return requests; }, close() { server.stop(true); } };
}
