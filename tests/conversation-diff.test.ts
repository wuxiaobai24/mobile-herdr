import { expect, test } from 'bun:test';
import { conversationChanges } from '../shared/conversation-diff';
test('conversation changes deduplicate repeated provider patches and retain successive edits per file', () => {
  const patch = '--- a/app/a.ts\n+++ b/app/a.ts\n@@ -1 +1 @@\n-old\n+new\n';
  const second = patch.replace('-old\n+new', '-new\n+newer');
  const files = conversationChanges([{ id: '1', role: 'assistant', text: '```diff\n' + patch + '```' }, { id: '2', role: 'tool', text: patch, output: patch }, { id: '3', role: 'tool', text: second }]);
  expect(files).toEqual([{ path: 'app/a.ts', patches: [patch, second], added: 2, removed: 2 }]);
});
