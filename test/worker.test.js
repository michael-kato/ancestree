import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { database, register } from './database.js';

async function setup() {
  const DB = database();
  for (const id of ['alice', 'bob']) await register(DB, id);
  const env = { DB, MEDIA: { get: async (key) => ({ body: key, httpMetadata: { contentType: 'image/png' } }) } };
  return { DB, request: async (path, { user, method = 'GET', body, origin = 'https://tree.test' } = {}) => {
    const headers = { origin, 'content-type': 'application/json' };
    if (user) headers.cookie = `sid=${user}`;
    return worker.fetch(new Request(`https://tree.test/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  } };
}
const add = (id, data = {}) => ({ id, kind: 'person', base_rev: 0, data: { given: id, ...data } });

test('public viewing and registered-user editing need no membership', async () => {
  const { request } = await setup();
  assert.equal((await request('/tree')).status, 200);
  assert.equal((await request('/tree/changesets', { method: 'POST', body: { ops: [add('a')] } })).status, 401);
  const created = await request('/tree/changesets', { user: 'alice', method: 'POST', body: { ops: [add('a')] } });
  assert.equal(created.status, 201, await created.clone().text());
  assert.equal((await request('/tree/changesets', { user: 'bob', method: 'POST', body: { ops: [{ id: 'a', base_rev: 1, data: { given: 'Updated' } }] } })).status, 201);
  const snapshot = await (await request('/tree')).json();
  assert.equal(snapshot.entities[0].created_by, 'alice');
  assert.equal(snapshot.entities[0].data.given, 'Updated');
  assert.equal('members' in snapshot, false);
  for (const path of ['/tree/log', '/tree/changes', '/tree/comments']) assert.equal((await request(path)).status, 200);
  assert.equal((await request('/me', { user: 'bob' })).status, 200);
});

test('server rejects locked edits, stale writes, forged locks and cross-site requests', async () => {
  const { request } = await setup();
  assert.equal((await request('/tree/changesets', { user: 'alice', method: 'POST', body: { ops: [add('a', { locked: true })] } })).status, 201);
  const edit = { id: 'a', base_rev: 1, data: { given: 'Changed', locked: true } };
  assert.equal((await request('/tree/changesets', { user: 'bob', method: 'POST', body: { ops: [edit] } })).status, 403);
  assert.equal((await request('/tree/changesets', { user: 'alice', method: 'POST', body: { ops: [edit] } })).status, 201);
  assert.equal((await request('/tree/changesets', { user: 'alice', method: 'POST', body: { ops: [edit] } })).status, 409);
  assert.equal((await request('/tree/changesets', { user: 'alice', method: 'POST', origin: 'https://other.test', body: { ops: [add('b')] } })).status, 403);
  for (const body of [null, [], 'text']) {
    const response = await request('/tree/changesets', { user: 'alice', method: 'POST', body });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'Send a JSON object');
  }
});

test('family creation, deletion, membership, roles and invites have no endpoints', async () => {
  const { request } = await setup();
  for (const [method, path] of [['POST', '/trees'], ['DELETE', '/tree'], ['GET', '/tree/members'], ['POST', '/tree/invites'], ['POST', '/invites/accept'], ['PATCH', '/tree/members/bob']]) {
    const response = await request(path, { method, user: 'alice', body: method === 'GET' || method === 'DELETE' ? undefined : {} });
    assert.ok([404, 405].includes(response.status), `${method} ${path}: ${response.status}`);
  }
});

test('comment authors keep edit and delete controls without a tree owner', async () => {
  const { request } = await setup();
  const response = await request('/tree/comments', { user: 'alice', method: 'POST', body: { body: 'Hello' } });
  assert.equal(response.status, 201);
  const { comment } = await response.json();
  assert.equal((await request(`/tree/comments/${comment.id}`, { user: 'bob', method: 'DELETE' })).status, 403);
  assert.equal((await request(`/tree/comments/${comment.id}`, { user: 'alice', method: 'PATCH', body: { body: 'Updated' } })).status, 200);
  assert.equal((await request(`/tree/comments/${comment.id}`, { user: 'alice', method: 'DELETE' })).status, 200);
});
