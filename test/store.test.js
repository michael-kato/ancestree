import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, register } from './database.js';
import * as S from '../store.js';
import * as T from '../public/tree.js';

test('a stale transaction cannot overwrite a concurrent lock', async () => {
  const db = database();
  await register(db, 'alice');
  await register(db, 'bob');
  const first = T.validate(T.emptyState(), [{ id: 'a', kind: 'person', base_rev: 0, data: { given: 'A' } }], 'alice');
  assert.equal(await S.writeChangeset(db, 'human', 0, 'alice', 'Create', first, 0), 1);
  const snapshot = T.fromRows(1, await S.entities(db, 'human'));
  const p = snapshot.entities.get('a');
  const lock = T.validate(snapshot, [{ id: 'a', base_rev: 1, data: { ...p.data, locked: true } }], 'alice');
  const stale = T.validate(snapshot, [{ id: 'a', base_rev: 1, data: { ...p.data, given: 'Bad' } }], 'bob');
  assert.equal(await S.writeChangeset(db, 'human', 1, 'alice', 'Lock', lock, 1), 2);
  assert.equal(await S.writeChangeset(db, 'human', 1, 'bob', 'Stale', stale, 2), null);
  assert.equal(await S.treeSeq(db, 'human'), 2);
  const current = T.fromRows(2, await S.entities(db, 'human'));
  assert.equal(current.entities.get('a').data.locked, true);
  assert.equal(current.entities.get('a').data.given, 'A');
  assert.throws(() => T.validate(current, [{ id: 'a', base_rev: 2, data: { given: 'Bad', locked: true } }], 'bob'), T.Forbidden);
  assert.equal((await S.changesets(db, 'human', 0, 500)).length, 2);
});

test('new and migrated media use their stored object keys', async () => {
  const db = database();
  await register(db, 'alice');
  const objects = new Map();
  const bucket = { put: async (key, body) => objects.set(key, body), get: async (key) => objects.get(key) };
  await S.putMedia(db, bucket, 'human', { id: 'photo', entity_id: null, content_type: 'image/png', bytes: 4, uploaded_by: 'alice', created_at: 0 }, 'body');
  assert.equal(await S.getMedia(db, bucket, 'human', 'photo'), 'body');
  assert.equal(await S.getMedia(db, bucket, 'human', 'missing'), null);
  assert.ok(objects.has('trees/human/media/photo'));
});
