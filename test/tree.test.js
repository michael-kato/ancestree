import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/tree.js';

test('lifespan shows an unknown birth year when only death is known', () => {
  assert.equal(T.lifespan({death:'1887'}),'????–1887');
  assert.equal(T.lifespan({birth:'1820',death:'1887'}),'1820–1887');
  assert.equal(T.lifespan({birth:'1820'}),'');
  assert.equal(T.lifespan({}),'');
  assert.equal(T.lifespan(null),'');
});

const person = (id, created_by = 'alice', locked = false) => ({ id, kind: 'person', rev: 1, deleted: 0, created_by, data: { given: id, locked } });
const state = (...rows) => T.fromRows(1, rows);
const edit = (p, data = p.data) => ({ id: p.id, base_rev: p.rev, kind: p.kind, data });

test('any registered user can edit an unlocked person', () => {
  const p = person('a');
  assert.equal(T.canEdit('bob', p), true);
  const [r] = T.validate(state(p), [edit(p, { given: 'Changed' })], 'bob');
  assert.equal(r.data.given, 'Changed');
  assert.equal(r.created_by, 'alice');
});

test('guests cannot edit or create people', () => {
  assert.equal(T.canEdit(null, person('a')), false);
  assert.throws(() => T.validate(state(), [{ id: 'new', kind: 'person', base_rev: 0, data: { given: 'New' } }], null));
});

test('only the creator can change the lock or edit a locked person', () => {
  for (const locked of [false, true]) {
    const p = person('a', 'alice', locked);
    assert.throws(() => T.validate(state(p), [edit(p, { ...p.data, locked: !locked })], 'bob'), /creator|locked/i);
    assert.equal(T.validate(state(p), [edit(p, { ...p.data, locked: !locked })], 'alice')[0].data.locked, !locked);
  }
  const p = person('a', 'alice', true);
  assert.equal(T.canEdit('bob', p), false);
  for (const op of [edit(p, { given: 'Changed', locked: true }), { ...edit(p), deleted: true }]) {
    assert.throws(() => T.validate(state(p), [op], 'bob'), /locked/i);
  }
  assert.throws(() => T.validate(state(p), [edit(p, { ...p.data, locked: 'false' })], 'alice'), /boolean/i);
});

test('new nodes record the actor and are unlocked by default', () => {
  const [r] = T.validate(state(), [{ id: 'a', kind: 'person', base_rev: 0, created_by: 'bob', data: { given: 'A', created_by: 'bob' } }], 'alice');
  assert.equal(r.created_by, 'alice');
  assert.equal(r.data.locked, false);
  const live = T.apply(state(), { seq: 2, user_id: 'alice', ops: [r] }).entities.get('a');
  assert.equal(live.created_by, 'alice');
});

test('locks protect both old and new relationship endpoints and undo', () => {
  const a = person('a', 'alice', true), b = person('b', 'bob'), c = person('c', 'bob');
  for (const [kind, data] of [['parent', { parent: 'a', child: 'b' }], ['partner', { a: 'a', b: 'b' }]]) {
    const edge = { id: 'edge', kind, data, rev: 1, deleted: 0, created_by: 'bob' };
    assert.throws(() => T.validate(state(a, b), [{ id: 'new', kind, base_rev: 0, data }], 'bob'), /locked/i);
    assert.throws(() => T.validate(state(a, b, edge), [{ ...edit(edge), deleted: true }], 'bob'), /locked/i);
    const moved = kind === 'parent' ? { parent: 'c', child: 'b' } : { a: 'c', b: 'b' };
    assert.throws(() => T.validate(state(a, b, c, edge), [edit(edge, moved)], 'bob'), /locked/i);
    assert.equal(T.validate(state(a, b), [{ id: 'new', kind, base_rev: 0, data }], 'alice').length, 1);
  }
  const target = state({ ...a, data: { given: 'Before', locked: true } });
  assert.throws(() => T.validate(state(a), T.revertOps(state(a), target), 'bob'), /locked/i);
});

test('lock cannot be bypassed by restoring a deleted node or forging its creator', () => {
  const p = { ...person('a', 'alice', true), deleted: 1 };
  assert.throws(() => T.validate(state(p), [{ ...edit(p), created_by: 'bob' }], 'bob'), /locked/i);
  const open = person('a');
  const [r] = T.validate(state(open), [{ ...edit(open, { given: 'Changed' }), created_by: 'bob' }], 'bob');
  assert.equal(r.created_by, 'alice');
});

test('distance uses the shortest recorded path, including partners and chosen parents', () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'isolated'].map((id) => person(id));
  const edge = (id, kind, data) => ({ id, kind, rev: 1, deleted: 0, data });
  rows.push(edge('ab', 'parent', { parent: 'a', child: 'b', type: 'adoptive' }), edge('ac', 'parent', { parent: 'a', child: 'c', type: 'birth' }), edge('cd', 'partner', { a: 'c', b: 'd' }), edge('de', 'parent', { parent: 'd', child: 'e' }));
  const distances = T.relationshipDistances(state(...rows), 'b');
  assert.deepEqual([...distances], [['b', 0], ['a', 1], ['c', 2], ['d', 3], ['e', 4]]);
  assert.equal(distances.has('isolated'), false);
  assert.equal(T.relationshipDistances(state(...rows), 'missing').size, 0);
  assert.equal(T.relationshipDistances(state(...rows), null).size, 0);
  rows.push(edge('eb', 'partner', { a: 'e', b: 'b' }));
  assert.equal(T.relationshipDistances(state(...rows), 'b').get('e'), 1);
});

test('no-op edits are rejected and stale edits cannot replace newer data', () => {
  const [r] = T.validate(state(), [{ id: 'a', kind: 'person', base_rev: 0, data: { given: 'A' } }], 'alice');
  const current = T.apply(state(), { seq: 2, user_id: 'alice', ops: [r] });
  const p = current.entities.get('a');
  assert.throws(() => T.validate(current, [edit(p)], 'bob'), /Nothing changed/);
  assert.throws(() => T.validate(current, [{ ...edit(p, { given: 'Bad' }), base_rev: 0 }], 'bob'), T.Conflict);
  const older = T.apply(current, { seq: 1, user_id: 'bob', ops: [{ ...r, created_by: 'bob', data: { given: 'Bad' } }] });
  assert.equal(older.entities.get('a').data.given, 'A');
  assert.equal(older.entities.get('a').created_by, 'alice');
});
