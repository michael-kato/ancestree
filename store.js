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

// Trees and membership

export async function treesFor(db, userId) {
  const { results } = await db.prepare(
    'SELECT t.id, t.name, t.seq, m.role FROM member m JOIN tree t ON t.id = m.tree_id WHERE m.user_id = ? ORDER BY t.name',
  ).bind(userId).all();
  return results;
}

export async function createTree(db, id, name, userId, now) {
  await db.batch([
    db.prepare('INSERT INTO tree (id, name, created_by, created_at) VALUES (?, ?, ?, ?)').bind(id, name, userId, now),
    db.prepare("INSERT INTO member (tree_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(id, userId, now),
  ]);
}

export function membership(db, treeId, userId) {
  return db.prepare('SELECT t.id, t.name, t.seq, m.role FROM member m JOIN tree t ON t.id = m.tree_id WHERE m.tree_id = ? AND m.user_id = ?')
    .bind(treeId, userId).first();
}

export async function members(db, treeId) {
  const { results } = await db.prepare(
    'SELECT u.id, u.name, u.email, m.role FROM member m JOIN users u ON u.id = m.user_id WHERE m.tree_id = ? ORDER BY u.name, u.email',
  ).bind(treeId).all();
  return results;
}

export async function ownerCount(db, treeId) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM member WHERE tree_id = ? AND role = 'owner'").bind(treeId).first();
  return r.n;
}

export function setRole(db, treeId, userId, role) {
  return db.prepare('UPDATE member SET role = ? WHERE tree_id = ? AND user_id = ?').bind(role, treeId, userId).run();
}

export function removeMember(db, treeId, userId) {
  return db.prepare('DELETE FROM member WHERE tree_id = ? AND user_id = ?').bind(treeId, userId).run();
}

export function addInvite(db, tokenHash, treeId, email, role, invitedBy, expiresAt) {
  return db.prepare('INSERT INTO invite (token_hash, tree_id, email, role, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(tokenHash, treeId, email, role, invitedBy, expiresAt).run();
}

export function invite(db, tokenHash) {
  return db.prepare('SELECT i.tree_id, i.email, i.role, i.expires_at, t.name AS tree_name FROM invite i JOIN tree t ON t.id = i.tree_id WHERE i.token_hash = ?')
    .bind(tokenHash).first();
}

// Keeps the stronger role if the user is already a member.
export async function acceptInvite(db, tokenHash, inv, userId, now) {
  await db.batch([
    db.prepare(
      `INSERT INTO member (tree_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (tree_id, user_id) DO UPDATE SET role = CASE WHEN member.role = 'viewer' THEN excluded.role ELSE member.role END`,
    ).bind(inv.tree_id, userId, inv.role, now),
    db.prepare('DELETE FROM invite WHERE token_hash = ?').bind(tokenHash),
  ]);
}

// Versioned tree data

export async function entities(db, treeId) {
  const { results } = await db.prepare('SELECT id, kind, rev, data, deleted, created_seq, seq FROM entity WHERE tree_id = ?').bind(treeId).all();
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
        `INSERT INTO entity (tree_id, id, kind, rev, data, deleted, created_seq, seq) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT (tree_id, id) DO UPDATE SET rev = excluded.rev, data = excluded.data, deleted = excluded.deleted, seq = excluded.seq`,
      ).bind(treeId, r.entity_id, r.kind, r.rev, data, r.deleted, seq),
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
    'SELECT entity_id, kind, rev, seq, data, deleted FROM revision WHERE tree_id = ? AND seq BETWEEN ? AND ? ORDER BY seq',
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
  await db.prepare('INSERT INTO media (tree_id, id, entity_id, content_type, bytes, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(treeId, m.id, m.entity_id, m.content_type, m.bytes, m.uploaded_by, m.created_at).run();
}

export function getMedia(bucket, treeId, id) {
  return bucket.get(mediaKey(treeId, id));
}

// Email

export function sendMail(env, to, subject, text) {
  return env.EMAIL.send({ to, from: { email: env.MAIL_FROM, name: 'Ancestree' }, subject, text });
}
