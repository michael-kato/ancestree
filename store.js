// D1, R2 and email access. No HTTP or authorization decisions live here.

const parse = (row) => (row ? { ...row, data: JSON.parse(row.data) } : row);

// Users, logins, sessions

export async function recentLogins(db, email, since) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM login WHERE email = ? AND created_at > ?').bind(email, since).first();
  return r.n;
}

export function addLogin(db, tokenHash, email, now, expiresAt) {
  return db.prepare('INSERT INTO login (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, email, now, expiresAt).run();
}

export async function takeLogin(db, tokenHash, now) {
  const row = await db.prepare('DELETE FROM login WHERE token_hash = ? RETURNING email, expires_at').bind(tokenHash).first();
  return row && row.expires_at > now ? row.email : null;
}

export async function userByEmail(db, email, newId, now) {
  await db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING')
    .bind(newId, email, now).run();
  return db.prepare('SELECT id, email, name FROM users WHERE email = ?').bind(email).first();
}

export function setUserName(db, userId, name) {
  return db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, userId).run();
}

export function addSession(db, tokenHash, userId, expiresAt) {
  return db.prepare('INSERT INTO session (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(tokenHash, userId, expiresAt).run();
}

export function sessionUser(db, tokenHash, now) {
  return db.prepare('SELECT u.id, u.email, u.name FROM session s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(tokenHash, now).first();
}

export function dropSession(db, tokenHash) {
  return db.prepare('DELETE FROM session WHERE token_hash = ?').bind(tokenHash).run();
}

export function sharedTree(db) {
  return db.prepare("SELECT id, seq FROM tree WHERE id = 'human'").first();
}

// Versioned tree data

export async function entities(db, treeId) {
  const { results } = await db.prepare('SELECT id, kind, rev, data, deleted, created_seq, seq, created_by FROM entity WHERE tree_id = ?').bind(treeId).all();
  return results.map(parse);
}

export async function treeSeq(db, treeId) {
  const r = await db.prepare('SELECT seq FROM tree WHERE id = ?').bind(treeId).first();
  return r.seq;
}

const isStale = (e) => /NOT NULL constraint failed: changeset\.seq|UNIQUE constraint failed: revision/.test(String(e?.message));

// Writes atomically only if the tree is still at expectedSeq; returns the new seq, or null if stale.
export async function writeChangeset(db, treeId, expectedSeq, userId, message, revs, now) {
  const seq = expectedSeq + 1;
  const stmts = [
    db.prepare(
      'INSERT INTO changeset (tree_id, seq, user_id, message, created_at) VALUES (?1, (SELECT seq + 1 FROM tree WHERE id = ?1 AND seq = ?2), ?3, ?4, ?5)',
    ).bind(treeId, expectedSeq, userId, message, now),
    db.prepare('UPDATE tree SET seq = ? WHERE id = ?').bind(seq, treeId),
  ];
  for (const r of revs) {
    const data = JSON.stringify(r.data);
    stmts.push(
      db.prepare('INSERT INTO revision (tree_id, entity_id, rev, seq, kind, data, deleted) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(treeId, r.entity_id, r.rev, seq, r.kind, data, r.deleted),
      db.prepare(
        `INSERT INTO entity (tree_id, id, kind, rev, data, deleted, created_seq, seq, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)
         ON CONFLICT (tree_id, id) DO UPDATE SET rev = excluded.rev, data = excluded.data, deleted = excluded.deleted, seq = excluded.seq`,
      ).bind(treeId, r.entity_id, r.kind, r.rev, data, r.deleted, seq, r.created_by),
    );
  }
  try {
    await db.batch(stmts);
    return seq;
  } catch (e) {
    if (isStale(e)) return null;
    throw e;
  }
}

// Changesets with seq > after, each with its revisions as ops.
export async function changesets(db, treeId, after, limit) {
  const { results: sets } = await db.prepare(
    `SELECT c.seq, c.user_id, u.name AS user_name, c.message, c.created_at
     FROM changeset c JOIN users u ON u.id = c.user_id WHERE c.tree_id = ? AND c.seq > ? ORDER BY c.seq LIMIT ?`,
  ).bind(treeId, after, limit).all();
  if (!sets.length) return [];
  const { results: revs } = await db.prepare(
    'SELECT r.entity_id, r.kind, r.rev, r.seq, r.data, r.deleted, e.created_by FROM revision r JOIN entity e ON e.tree_id = r.tree_id AND e.id = r.entity_id WHERE r.tree_id = ? AND r.seq BETWEEN ? AND ? ORDER BY r.seq',
  ).bind(treeId, sets[0].seq, sets[sets.length - 1].seq).all();
  const bySeq = new Map(sets.map((c) => [c.seq, { ...c, ops: [] }]));
  for (const r of revs) {
    const { seq, ...op } = parse(r);
    bySeq.get(seq).ops.push(op);
  }
  return [...bySeq.values()];
}

// Comments

const COMMENT_COLS = `c.id, c.seq, c.target_id, c.parent_id, c.user_id, u.name AS user_name,
  CASE WHEN c.deleted_at IS NULL THEN c.body ELSE '' END AS body, c.created_at, c.edited_at, c.deleted_at`;

export async function comments(db, treeId, targetId) {
  const { results } = await db.prepare(
    `SELECT ${COMMENT_COLS} FROM comment c JOIN users u ON u.id = c.user_id
     WHERE c.tree_id = ? AND c.target_id IS ? ORDER BY c.created_at DESC LIMIT 500`,
  ).bind(treeId, targetId).all();
  return results.reverse();
}

export async function commentsSince(db, treeId, since, limit) {
  const { results } = await db.prepare(
    `SELECT ${COMMENT_COLS} FROM comment c JOIN users u ON u.id = c.user_id WHERE c.tree_id = ? AND c.seq > ? ORDER BY c.seq LIMIT ?`,
  ).bind(treeId, since, limit).all();
  return results;
}

// Live comments per person (the family chat, target NULL, isn't counted).
export async function commentCounts(db, treeId) {
  const { results } = await db.prepare(
    'SELECT target_id, COUNT(*) AS n FROM comment WHERE tree_id = ? AND target_id IS NOT NULL AND deleted_at IS NULL GROUP BY target_id',
  ).bind(treeId).all();
  return Object.fromEntries(results.map((r) => [r.target_id, r.n]));
}

export function comment(db, treeId, id) {
  return db.prepare('SELECT id, user_id, deleted_at FROM comment WHERE tree_id = ? AND id = ?').bind(treeId, id).first();
}

const bumpSeq = (db, treeId) => db.prepare('UPDATE tree SET seq = seq + 1 WHERE id = ?').bind(treeId);
const nextSeq = '(SELECT seq + 1 FROM tree WHERE id = ?)';

export async function addComment(db, treeId, c) {
  await db.batch([
    db.prepare(`INSERT INTO comment (tree_id, id, seq, target_id, parent_id, user_id, body, created_at) VALUES (?, ?, ${nextSeq}, ?, ?, ?, ?, ?)`)
      .bind(treeId, c.id, treeId, c.target_id, c.parent_id, c.user_id, c.body, c.created_at),
    bumpSeq(db, treeId),
  ]);
}

export async function editComment(db, treeId, id, body, now) {
  await db.batch([
    db.prepare(`UPDATE comment SET body = ?, edited_at = ?, seq = ${nextSeq} WHERE tree_id = ? AND id = ?`).bind(body, now, treeId, treeId, id),
    bumpSeq(db, treeId),
  ]);
}

export async function deleteComment(db, treeId, id, now) {
  await db.batch([
    db.prepare(`UPDATE comment SET deleted_at = ?, seq = ${nextSeq} WHERE tree_id = ? AND id = ?`).bind(now, treeId, treeId, id),
    bumpSeq(db, treeId),
  ]);
}

// Media

const mediaKey = (treeId, id) => `trees/${treeId}/media/${id}`;

export async function putMedia(db, bucket, treeId, m, body) {
  await bucket.put(mediaKey(treeId, m.id), body, { httpMetadata: { contentType: m.content_type } });
  await db.prepare('INSERT INTO media (tree_id, id, entity_id, content_type, bytes, uploaded_by, created_at, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(treeId, m.id, m.entity_id, m.content_type, m.bytes, m.uploaded_by, m.created_at, mediaKey(treeId, m.id)).run();
}

export async function getMedia(db, bucket, treeId, id) {
  const row = await db.prepare('SELECT storage_key FROM media WHERE tree_id = ? AND id = ?').bind(treeId, id).first();
  return row ? bucket.get(row.storage_key) : null;
}

// Email

export function sendMail(env, to, subject, text) {
  return env.EMAIL.send({ to, from: { email: env.MAIL_FROM, name: 'Ancestree' }, subject, text });
}
