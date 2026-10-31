import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, register } from './database.js';
import * as T from '../public/tree.js';
import * as S from '../store.js';

const migration = readFileSync(new URL('../migrations/0003_shared_tree.sql', import.meta.url), 'utf8');

test('migration combines trees without losing people, revisions, comments or stored media', async () => {
  const db = database({ legacy: true }), sql = db.sqlite;
  await register(db, 'alice');
  await register(db, 'bob');
  for (const [tree, user] of [['first', 'alice'], ['second', 'bob']]) {
    sql.prepare('INSERT INTO tree (id, name, created_by, created_at, seq) VALUES (?, ?, ?, 0, 4)').run(tree, tree, user);
    sql.prepare("INSERT INTO member VALUES (?, ?, 'owner', 0)").run(tree, user);
    const entities = [
      ['same', 'person', { given: user, photo: 'photo' }],
      [`${tree}-child`, 'person', { given: `${user} child` }],
      ['edge', 'parent', { parent: 'same', child: `${tree}-child`, type: 'birth' }],
    ];
    for (let seq = 1; seq <= 2; seq++) {
      sql.prepare('INSERT INTO changeset VALUES (?, ?, ?, ?, ?)').run(tree, seq, seq === 1 ? user : 'bob', 'Edit', seq);
      for (const [id, kind, data] of entities) sql.prepare('INSERT INTO revision VALUES (?, ?, ?, ?, ?, ?, 0)').run(tree, id, seq, seq, kind, JSON.stringify(data));
    }
    for (const [id, kind, data] of entities) sql.prepare('INSERT INTO entity VALUES (?, ?, ?, 2, ?, 0, 1, 2)').run(tree, id, kind, JSON.stringify(data));
    sql.prepare('INSERT INTO media VALUES (?, ?, ?, ?, 4, ?, 0)').run(tree, 'photo', 'same', 'image/png', user);
    sql.prepare('INSERT INTO comment (tree_id, id, seq, target_id, user_id, body, created_at) VALUES (?, ?, 3, ?, ?, ?, 0)').run(tree, 'note', 'same', user, 'Public comment');
    sql.prepare('INSERT INTO comment (tree_id, id, seq, target_id, parent_id, user_id, body, created_at) VALUES (?, ?, 4, ?, ?, ?, ?, 0)').run(tree, 'reply', 'same', 'note', user, 'Reply');
  }
  sql.exec(migration);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM tree').get().n, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM entity').get().n, 6);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM revision').get().n, 12);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM changeset').get().n, 4);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM comment').get().n, 4);
  for (const table of ['member', 'invite']) assert.throws(() => sql.prepare(`SELECT * FROM ${table}`).all(), /no such table/);
  assert.deepEqual(sql.prepare('PRAGMA table_info(tree)').all().map((c) => c.name), ['id', 'seq', 'created_at']);
  const entities = await S.entities(db, 'human'), state = T.fromRows(8, entities);
  for (const user of ['alice', 'bob']) {
    const parent = entities.find((e) => e.data.given === user), child = entities.find((e) => e.data.given === `${user} child`);
    assert.equal(parent.created_by, user);
    assert.equal(parent.data.locked, false);
    assert.equal(T.relatives(state).parents.get(child.id)[0].id, parent.id);
    const media = sql.prepare('SELECT * FROM media WHERE id = ?').get(parent.data.photo);
    assert.equal(media.entity_id, parent.id);
    assert.equal(media.storage_key, `trees/${user === 'alice' ? 'first' : 'second'}/media/photo`);
    const notes = await S.comments(db, 'human', parent.id);
    assert.equal(notes.length, 2);
    assert.equal(notes[1].parent_id, notes[0].id);
    assert.equal((await S.getMedia(db, { get: async (key) => key }, 'human', parent.data.photo)), media.storage_key);
  }
  const log = await S.changesets(db, 'human', 0, 500);
  assert.deepEqual(log.map((c) => c.seq), [1, 2, 5, 6]);
  const replayed = new T.Replayer(log).at(log.length);
  for (const entity of entities) {
    assert.deepEqual(replayed.entities.get(entity.id).data, entity.data);
    assert.equal(replayed.entities.get(entity.id).created_by, entity.created_by);
  }
  assert.equal((await S.sharedTree(db)).seq, 8);
});

test('migration works on an empty installation', () => {
  const db = database();
  assert.deepEqual({ ...db.sqlite.prepare('SELECT * FROM tree').get() }, { id: 'human', seq: 0, created_at: 0 });
});
