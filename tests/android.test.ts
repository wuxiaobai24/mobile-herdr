import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePairing } from '../shared/pairing';
import { parseMarkdown, safeExternalUrl } from '../shared/markdown';
import { createDraftStore } from '../app/draft-store';

const profile = { version: 1, url: 'http://192.168.1.8:7331', token: 'isolated-fixture-token', name: '开发机 🐑' };
const payload = Buffer.from(JSON.stringify(profile)).toString('base64url');
test('Android scan and deep links accept the existing CLI fragment without sending credentials in queries', () => {
  for (const prefix of [profile.url + '/', 'mobile-herdr://pair']) expect(parsePairing(`${prefix}#connect=${payload}`)).toEqual({ url: profile.url, token: profile.token, name: profile.name });
  for (const link of [`mobile-herdr://other#connect=${payload}`, `mobile-herdr://pair?token=example#connect=${payload}`, `javascript:example#connect=${payload}`, `http://user:password@host/#connect=${payload}`, `https://host/#connect=%%%`, 'x'.repeat(25000)]) expect(parsePairing(link)).toBeUndefined();
  for (const value of [{ ...profile, token: 'short' }, { ...profile, url: 'http://host/?token=example' }, { ...profile, version: 2 }]) expect(parsePairing(`mobile-herdr://pair#connect=${Buffer.from(JSON.stringify(value)).toString('base64url')}`)).toBeUndefined();
});

test('native drafts and delivery receipts survive database reopen without truncation and migrate legacy values safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mobile-herdr-android-storage-'));
  let db = new Database(join(directory, 'drafts.db'));
  const legacyValues = new Map<string, string>();
  const oldKey = (key: string) => 'draft-' + Array.from(key).map(char => char.charCodeAt(0).toString(16)).join('');
  const storage = () => createDraftStore({
    async get(key) { return (db.query('SELECT value FROM drafts WHERE key=?').get(key) as { value: string } | null)?.value ?? null; },
    async set(key, value) { db.query('INSERT INTO drafts VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); },
  }, {
    async get(key) { return legacyValues.get(key) ?? null; },
    async remove(key) { legacyValues.delete(key); },
  });
  try {
    db.exec('CREATE TABLE drafts (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const key = 'machine-a:default:w1:p1:runtime:conversation';
    const long = '中文草稿'.repeat(8000);
    const receipt = JSON.stringify({ text: long, id: 'stable-request-id' });
    const first = storage();
    await Promise.all([first.save(key, long), first.save(key + ':delivery', receipt)]);
    db.close(); db = new Database(join(directory, 'drafts.db'));
    const reopened = storage();
    expect(await reopened.load(key)).toBe(long);
    expect(await reopened.load(key + ':delivery')).toBe(receipt);
    expect(await reopened.load(key.replace('machine-a', 'machine-b'))).toBe('');
    legacyValues.set(oldKey('old'), '旧草稿');
    expect(await reopened.load('old')).toBe('旧草稿');
    expect(legacyValues.has(oldKey('old'))).toBe(false);
    legacyValues.set(oldKey('clear'), '不能恢复的旧草稿');
    await reopened.save('clear', '');
    expect(await reopened.load('clear')).toBe('');
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('a failed draft save preserves the legacy copy and does not block subsequent saves', async () => {
  const values = new Map<string, string>(), old = new Map([['draft-61', 'keep me']]);
  let fail = true;
  const store = createDraftStore({
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { if (fail) throw new Error('disk full'); values.set(key, value); },
  }, { async get(key) { return old.get(key) ?? null; }, async remove(key) { old.delete(key); } });
  await expect(store.save('a', 'new draft')).rejects.toThrow('disk full');
  expect(old.get('draft-61')).toBe('keep me');
  fail = false;
  await store.save('a', 'recovered');
  expect(await store.load('a')).toBe('recovered');
});

test('native Markdown parses GFM and permits external links without executing HTML or local schemes', () => {
  const tree = parseMarkdown('# 中文标题\n\n- [x] 完成\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```diff\n-old\n+new\n```\n');
  expect(tree.children.map(row => row.type)).toEqual(['heading', 'list', 'table', 'code']);
  for (const value of ['javascript:alert(1)', 'file:///private/token', 'intent://example', '/relative', 'https://user:password@host']) expect(safeExternalUrl(value)).toBeUndefined();
  expect(safeExternalUrl('https://example.com/path')).toBe('https://example.com/path');
});
