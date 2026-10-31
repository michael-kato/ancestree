// Static files are served from public/ by Workers Assets.
import * as S from './store.js';
import { validate, fromRows, Invalid, Conflict, Forbidden } from './public/tree.js';

const MINUTE = 60_000, DAY = 86_400_000;
const SESSION_MS = 30 * DAY, LOGIN_MS = 15 * MINUTE;
const LOGINS_PER_WINDOW = 3;
const PAGE = 500;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
async function hash(token) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}
const sessionCookie = (token, maxAgeS) => `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeS}`;

function str(v, field, min, max) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) throw new HttpError(400, min ? `${field} must be ${min}–${max} characters` : `${field} is too long`);
  return s;
}
function email(v) {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!EMAIL.test(e) || e.length > 254) throw new HttpError(400, 'Enter a valid email address');
  return e;
}
function id(v, field) {
  if (typeof v !== 'string' || !ID.test(v)) throw new HttpError(400, `${field} must be an id`);
  return v;
}
async function verifyTurnstile(env, token, ip) {
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', String(token || ''));
  if (ip) form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const out = await r.json();
  if (!out.success) throw new HttpError(400, "Confirm you're not a robot, then try again");
}

// Handlers. c = { req, env, url, params, now, user, tree, body }

async function login(c) {
  const { env } = c;
  const addr = email(c.body.email);
  await verifyTurnstile(env, c.body.turnstile, c.req.headers.get('cf-connecting-ip'));
  if ((await S.recentLogins(env.DB, addr, c.now - LOGIN_MS)) >= LOGINS_PER_WINDOW) {
    throw new HttpError(429, 'Too many sign-in links requested. Wait 15 minutes, then try again.');
  }
  const token = newToken();
  await S.addLogin(env.DB, await hash(token), addr, c.now, c.now + LOGIN_MS);
  const link = `${c.url.origin}/auth?token=${token}`;
  await S.sendMail(env, addr, 'Your Ancestree sign-in link',
    `Sign in to Ancestree:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`);
  return json({ ok: true });
}

async function verify(c) {
  const addr = await S.takeLogin(c.env.DB, await hash(String(c.body.token || '')), c.now);
  if (!addr) throw new HttpError(400, 'This sign-in link has expired or was already used. Request a new one.');
  const user = await S.userByEmail(c.env.DB, addr, crypto.randomUUID(), c.now);
  return json({ user }, 200, await startSession(c, user));
}

async function startSession(c, user) {
  const token = newToken();
  await S.addSession(c.env.DB, await hash(token), user.id, c.now + SESSION_MS);
  return { 'set-cookie': sessionCookie(token, SESSION_MS / 1000) };
}

async function logout(c) {
  const token = cookie(c.req, 'sid');
  if (token) await S.dropSession(c.env.DB, await hash(token));
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

const config = (c) => json({ turnstile_sitekey: c.env.TURNSTILE_SITEKEY });

async function me(c) {
  return json({ user: c.user });
}

async function renameMe(c) {
  const name = str(c.body.name, 'Name', 1, 80);
  await S.setUserName(c.env.DB, c.user.id, name);
  return json({ user: { ...c.user, name } });
}

async function getTree(c) {
  // Read the sequence before entities so polling cannot miss an edit.
  const tree = c.tree;
  const [entities, counts] = await Promise.all([
    S.entities(c.env.DB, tree.id), S.commentCounts(c.env.DB, tree.id),
  ]);
  // The client treats comments created by now as already counted.
  return json({ tree, entities, comment_counts: counts, now: c.now });
}

async function commit(c) {
  const { env, tree } = c;
  const message = str(c.body.message || 'Edit', 'message', 1, 200);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, Math.random() * 50 * attempt));
    const seq = await S.treeSeq(env.DB, tree.id);
    const revs = validate(fromRows(seq, await S.entities(env.DB, tree.id)), c.body.ops, c.user.id);
    const newSeq = await S.writeChangeset(env.DB, tree.id, seq, c.user.id, message, revs, c.now);
    if (newSeq) {
      return json({ changeset: { seq: newSeq, user_id: c.user.id, user_name: c.user.name, message, created_at: c.now, ops: revs } }, 201);
    }
  }
  throw new HttpError(503, 'The tree is busy. Try again in a moment.');
}

const after = (c, name) => Math.max(0, Number.parseInt(c.url.searchParams.get(name) || '0', 10) || 0);

async function log(c) {
  const sets = await S.changesets(c.env.DB, c.tree.id, after(c, 'after'), PAGE);
  const full = sets.length === PAGE;
  // A full page can never change, so the browser may keep it forever.
  return json({ changesets: sets, more: full }, 200, full ? { 'cache-control': 'private, max-age=31536000, immutable' } : {});
}

async function changes(c) {
  const since = after(c, 'since');
  const [sets, notes] = await Promise.all([
    S.changesets(c.env.DB, c.tree.id, since, PAGE),
    S.commentsSince(c.env.DB, c.tree.id, since, PAGE),
  ]);
  // Changesets and comments share seq; a full page caps how far the next poll may skip.
  const seqs = [since, ...sets.map((s) => s.seq), ...notes.map((n) => n.seq)];
  const caps = [sets, notes].filter((l) => l.length === PAGE).map((l) => l[l.length - 1].seq);
  const next = Math.min(Math.max(...seqs), ...caps);
  return json({ changesets: sets.filter((s) => s.seq <= next), comments: notes.filter((n) => n.seq <= next), next, more: caps.length > 0 });
}

async function listComments(c) {
  const target = c.url.searchParams.get('target') || null;
  if (target) id(target, 'target');
  return json({ comments: await S.comments(c.env.DB, c.tree.id, target) });
}

async function addComment(c) {
  const note = {
    id: crypto.randomUUID(),
    target_id: c.body.target ? id(c.body.target, 'target') : null,
    parent_id: c.body.parent ? id(c.body.parent, 'parent') : null,
    user_id: c.user.id,
    body: str(c.body.body, 'Comment', 1, 4000),
    created_at: c.now,
  };
  await S.addComment(c.env.DB, c.tree.id, note);
  return json({ comment: { ...note, user_name: c.user.name } }, 201);
}

async function ownComment(c) {
  const note = await S.comment(c.env.DB, c.tree.id, c.params.id);
  if (!note || note.deleted_at) throw new HttpError(404, 'That comment no longer exists');
  if (note.user_id !== c.user.id) {
    throw new HttpError(403, 'Only the person who wrote this comment can change it');
  }
}

async function editComment(c) {
  await ownComment(c);
  await S.editComment(c.env.DB, c.tree.id, c.params.id, str(c.body.body, 'Comment', 1, 4000), c.now);
  return json({ ok: true });
}

async function deleteComment(c) {
  await ownComment(c);
  await S.deleteComment(c.env.DB, c.tree.id, c.params.id, c.now);
  return json({ ok: true });
}

async function uploadMedia(c) {
  const type = (c.req.headers.get('content-type') || '').split(';')[0].trim();
  if (!MEDIA_TYPES.includes(type)) throw new HttpError(415, 'Upload a JPEG, PNG, WebP, GIF or PDF file');
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) throw new HttpError(400, 'The file is empty');
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new HttpError(413, 'Files can be at most 10 MB');
  const entity = c.url.searchParams.get('entity');
  const m = {
    id: crypto.randomUUID(), entity_id: entity ? id(entity, 'entity') : null, content_type: type,
    bytes: bytes.byteLength, uploaded_by: c.user.id, created_at: c.now,
  };
  await S.putMedia(c.env.DB, c.env.MEDIA, c.tree.id, m, bytes);
  return json({ media: m }, 201);
}

async function getMedia(c) {
  const obj = await S.getMedia(c.env.DB, c.env.MEDIA, c.tree.id, id(c.params.id, 'id'));
  if (!obj) throw new HttpError(404, 'File not found');
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'sandbox',
      etag: obj.httpEtag,
    },
  });
}

// Town, State, Country suggestions for birthplaces, from Photon (OpenStreetMap). Proxied so
// browsers only talk to us, and cached at the edge since place names rarely change.
const PLACE_LAYERS = ['city', 'locality', 'district', 'county', 'state', 'country'];
async function places(c) {
  const q = (c.url.searchParams.get('q') || '').trim().slice(0, 100);
  if (q.length < 2) return json({ places: [] });
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '8');
  url.searchParams.set('lang', 'en');
  for (const l of PLACE_LAYERS) url.searchParams.append('layer', l);
  const r = await fetch(url, {
    headers: { 'user-agent': 'Ancestree family tree (+https://ancestree.michaelkato.work)' },
    cf: { cacheTtl: 30 * 86400, cacheEverything: true },
  });
  if (!r.ok) throw new HttpError(502, 'Place suggestions are unavailable right now. Type the place instead.');
  const { features = [] } = await r.json();
  const labels = features.map(({ properties: p }) => [...new Set([p.name, p.state, p.country].filter(Boolean))].join(', '));
  return json({ places: [...new Set(labels)].slice(0, 6) }, 200, { 'cache-control': 'private, max-age=86400' });
}

const ROUTES = [
  ['GET', '/api/config', config, 'public'],
  ['POST', '/api/auth/login', login, 'public'],
  ['POST', '/api/auth/verify', verify, 'public'],
  ['POST', '/api/auth/logout', logout, 'public'],
  ['GET', '/api/me', me, 'user'],
  ['PATCH', '/api/me', renameMe, 'user'],
  ['GET', '/api/places', places, 'user'],
  ['GET', '/api/tree', getTree, 'public'],
  ['POST', '/api/tree/changesets', commit, 'user'],
  ['GET', '/api/tree/log', log, 'public'],
  ['GET', '/api/tree/changes', changes, 'public'],
  ['GET', '/api/tree/comments', listComments, 'public'],
  ['POST', '/api/tree/comments', addComment, 'user'],
  ['PATCH', '/api/tree/comments/:id', editComment, 'user'],
  ['DELETE', '/api/tree/comments/:id', deleteComment, 'user'],
  ['POST', '/api/tree/media', uploadMedia, 'user'],
  ['GET', '/api/tree/media/:id', getMedia, 'public'],
].map(([method, path, handler, access]) => ({
  method, handler, access,
  pattern: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'),
}));

async function handle(req, env) {
  const url = new URL(req.url);
  const candidates = ROUTES.filter((r) => r.pattern.test(url.pathname));
  if (!candidates.length) throw new HttpError(404, 'Not found');
  const route = candidates.find((r) => r.method === req.method);
  if (!route) throw new HttpError(405, 'Method not allowed');
  // Cookie auth + same-origin check blocks cross-site form posts.
  if (req.method !== 'GET' && req.headers.get('origin') !== url.origin) throw new HttpError(403, 'Cross-site request blocked');

  const c = { req, env, url, params: url.pathname.match(route.pattern).groups || {}, now: Date.now(), body: {} };
  if ((req.method === 'POST' || req.method === 'PATCH') && route.handler !== uploadMedia) {
    if (!(req.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'Send JSON');
    c.body = await req.json().catch(() => {
      throw new HttpError(400, 'Request body is not valid JSON');
    });
    if (!c.body || typeof c.body !== 'object' || Array.isArray(c.body)) throw new HttpError(400, 'Send a JSON object');
  }
  if (route.access !== 'public') {
    const token = cookie(req, 'sid');
    c.user = token && (await S.sessionUser(env.DB, await hash(token), c.now));
    if (!c.user) throw new HttpError(401, 'Sign in to continue');
  }
  if (url.pathname === '/api/tree' || url.pathname.startsWith('/api/tree/')) {
    c.tree = await S.sharedTree(env.DB);
    if (!c.tree) throw new HttpError(503, 'The shared tree is not ready');
  }
  return route.handler(c);
}

export default {
  async fetch(req, env) {
    try {
      return await handle(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof Forbidden) return json({ error: e.message }, 403);
      if (e instanceof Invalid) return json({ error: e.message }, 400);
      if (e instanceof Conflict) return json({ error: e.message, conflict: true }, 409);
      console.error(e);
      return json({ error: 'Something went wrong on our side. Try again.' }, 500);
    }
  },
};
