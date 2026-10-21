// Pure family-tree logic shared by the Worker and the browser: applying
// changesets, validating edits, building revert ops, replay and graph shape.

export class Invalid extends Error {}
export class Conflict extends Error {}

const MAX_OPS = 200;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const KEYFRAME_EVERY = 100;

const PERSON_TEXT = { given: 80, nickname: 80, surname: 80, birth_place: 160, notes: 4000 };
const SEXES = ['', 'female', 'male', 'other'];
const PARENT_TYPES = ['birth', 'adoptive', 'step', 'foster'];
const PARTNER_TYPES = ['married', 'partner'];

export const canEdit = (role) => role === 'owner' || role === 'editor';

export function emptyState() {
  return { seq: 0, entities: new Map() };
}

export function fromRows(seq, rows) {
  return { seq, entities: new Map(rows.map((r) => [r.id, r])) };
}

// cs: { seq, ops: [{ entity_id, kind, rev, data, deleted }] }
export function apply(state, cs) {
  const entities = new Map(state.entities);
  for (const op of cs.ops) {
    const prev = entities.get(op.entity_id);
    if (prev && prev.rev >= op.rev) continue; // already have this or a newer version
    entities.set(op.entity_id, {
      id: op.entity_id,
      kind: op.kind,
      rev: op.rev,
      data: op.data,
      deleted: op.deleted ? 1 : 0,
      created_seq: prev ? prev.created_seq : cs.seq,
      seq: cs.seq,
    });
  }
  return { seq: Math.max(state.seq, cs.seq), entities };
}

export const isLive = (e) => e && !e.deleted;

function text(v, max, field) {
  if (v == null) return '';
  if (typeof v !== 'string') throw new Invalid(`${field} must be text`);
  const s = v.trim();
  if (s.length > max) throw new Invalid(`${field} is longer than ${max} characters`);
  return s;
}

function date(v, field) {
  const s = text(v, 10, field);
  if (s && !DATE.test(s)) throw new Invalid(`${field} must look like 1950, 1950-04 or 1950-04-21`);
  return s;
}

function oneOf(v, allowed, field) {
  const s = v == null ? allowed[0] : v;
  if (!allowed.includes(s)) throw new Invalid(`${field} must be one of ${allowed.join(', ')}`);
  return s;
}

function ref(v, field) {
  if (typeof v !== 'string' || !ID.test(v)) throw new Invalid(`${field} must be an id`);
  return v;
}

function clean(kind, d) {
  if (!d || typeof d !== 'object') throw new Invalid('data is required');
  if (kind === 'person') {
    const out = {};
    for (const [f, max] of Object.entries(PERSON_TEXT)) out[f] = text(d[f], max, f);
    out.sex = oneOf(d.sex ?? '', SEXES, 'sex');
    out.birth = date(d.birth, 'birth');
    out.death = date(d.death, 'death');
    out.photo = d.photo ? ref(d.photo, 'photo') : '';
    return out;
  }
  if (kind === 'parent') {
    return { parent: ref(d.parent, 'parent'), child: ref(d.child, 'child'), type: oneOf(d.type, PARENT_TYPES, 'type') };
  }
  if (kind === 'partner') {
    return {
      a: ref(d.a, 'a'), b: ref(d.b, 'b'), type: oneOf(d.type, PARTNER_TYPES, 'type'),
      from: date(d.from, 'from'), to: date(d.to, 'to'),
    };
  }
  throw new Invalid(`unknown kind ${kind}`);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function checkInvariants(entities) {
  const live = [...entities.values()].filter(isLive);
  const person = (id) => isLive(entities.get(id)) && entities.get(id).kind === 'person';
  const name = (id) => displayName(entities.get(id)?.data);
  const seen = new Set();
  const birthParents = new Map();
  const children = new Map();
  for (const e of live) {
    if (e.kind === 'person') continue;
    const [x, y] = e.kind === 'parent' ? [e.data.parent, e.data.child] : [e.data.a, e.data.b];
    if (!person(x) || !person(y)) throw new Invalid('A relationship points to someone who is not in the tree');
    if (x === y) throw new Invalid(`${name(x)} can't be related to themselves`);
    const key = e.kind === 'parent' ? `p:${x}>${y}` : `m:${[x, y].sort().join('+')}`;
    if (seen.has(key)) throw new Invalid(`${name(x)} and ${name(y)} are already linked that way`);
    seen.add(key);
    if (e.kind === 'parent') {
      if (e.data.type === 'birth') {
        const n = (birthParents.get(y) || 0) + 1;
        if (n > 2) throw new Invalid(`${name(y)} already has two birth parents`);
        birthParents.set(y, n);
      }
      if (!children.has(x)) children.set(x, []);
      children.get(x).push(y);
    }
  }
  // Kahn's algorithm: a parent cycle leaves nodes with remaining in-degree.
  const indeg = new Map();
  for (const kids of children.values()) for (const k of kids) indeg.set(k, (indeg.get(k) || 0) + 1);
  const queue = live.filter((e) => e.kind === 'person' && !indeg.get(e.id)).map((e) => e.id);
  let visited = 0;
  while (queue.length) {
    const id = queue.pop();
    visited++;
    for (const k of children.get(id) || []) {
      indeg.set(k, indeg.get(k) - 1);
      if (!indeg.get(k)) queue.push(k);
    }
  }
  const people = live.filter((e) => e.kind === 'person').length;
  if (visited !== people) throw new Invalid('That would make someone their own ancestor');
}

// ops: [{ id, kind, base_rev, data?, deleted? }] -> revisions ready to store.
export function validate(state, ops) {
  if (!Array.isArray(ops) || ops.length === 0) throw new Invalid('ops must be a non-empty list');
  if (ops.length > MAX_OPS) throw new Invalid(`At most ${MAX_OPS} changes at once`);
  const ids = new Set();
  const revs = [];
  for (const op of ops) {
    const id = ref(op?.id, 'id');
    if (ids.has(id)) throw new Invalid(`${id} appears twice`);
    ids.add(id);
    const cur = state.entities.get(id);
    if (op.base_rev !== (cur ? cur.rev : 0)) {
      throw new Conflict(`${cur ? displayName(cur.data) || 'A relationship' : id} was changed by someone else. Reload and try again.`);
    }
    const kind = cur ? cur.kind : op.kind;
    if (op.kind && op.kind !== kind) throw new Invalid(`${id} can't change from ${kind} to ${op.kind}`);
    const deleted = op.deleted ? 1 : 0;
    if (!cur && deleted) throw new Invalid(`${id} doesn't exist`);
    const data = deleted ? cur.data : clean(kind, op.data);
    if (cur && cur.deleted === deleted && same(cur.data, data)) continue;
    revs.push({ entity_id: id, kind, rev: (cur ? cur.rev : 0) + 1, data, deleted });
  }
  if (revs.length === 0) throw new Invalid('Nothing changed');
  checkInvariants(apply(state, { seq: state.seq + 1, ops: revs }).entities);
  return revs;
}

export function relatives(state) {
  const parents = new Map(), children = new Map(), partners = new Map();
  const push = (m, k, v) => (m.has(k) ? m.get(k).push(v) : m.set(k, [v]));
  for (const e of state.entities.values()) {
    if (!isLive(e)) continue;
    if (e.kind === 'parent') {
      push(parents, e.data.child, { edge: e.id, id: e.data.parent, type: e.data.type });
      push(children, e.data.parent, { edge: e.id, id: e.data.child, type: e.data.type });
    } else if (e.kind === 'partner') {
      push(partners, e.data.a, { edge: e.id, id: e.data.b, type: e.data.type });
      push(partners, e.data.b, { edge: e.id, id: e.data.a, type: e.data.type });
    }
  }
  return { parents, children, partners };
}

// Ops linking `from` to `to` as dir ('parent' | 'child' | 'sibling') of `from`. `to` may be a
// person being created in the same changeset (not yet in state). Siblings share parents; if
// neither has any, they get a new unnamed parent so the relationship can be drawn.
export function relateOps(state, from, dir, to, makeId) {
  const { parents, partners } = relatives(state);
  const edge = (parent, child) => ({ id: makeId(), kind: 'parent', base_rev: 0, data: { parent, child, type: 'birth' } });
  const parentsOf = (id) => (parents.get(id) || []).map((r) => r.id);
  const name = (id) => displayName(state.entities.get(id)?.data) || 'They';
  if (dir === 'parent') return [edge(to, from)];
  if (dir === 'child') {
    const ops = [edge(from, to)];
    // A child of someone with exactly one partner is most likely that couple's child.
    const ps = partners.get(from) || [];
    if (ps.length === 1 && parentsOf(to).length === 0) ops.push(edge(ps[0].id, to));
    return ops;
  }
  if (dir !== 'sibling') throw new Invalid(`unknown relationship ${dir}`);
  const a = parentsOf(from), b = parentsOf(to);
  if (a.length && b.length) {
    if (a.length === b.length && a.every((p) => b.includes(p))) throw new Invalid(`${name(to)} is already a sibling`);
    throw new Invalid(`${name(from)} and ${name(to)} already have different parents. Link them through a parent instead.`);
  }
  if (a.length) return a.map((p) => edge(p, to));
  if (b.length) return b.map((p) => edge(p, from));
  const unknown = makeId();
  return [{ id: unknown, kind: 'person', base_rev: 0, data: {} }, edge(unknown, from), edge(unknown, to)];
}

export function deleteOps(state, personId) {
  const ops = [];
  for (const e of state.entities.values()) {
    if (!isLive(e)) continue;
    const touches = e.id === personId || [e.data.parent, e.data.child, e.data.a, e.data.b].includes(personId);
    if (touches) ops.push({ id: e.id, kind: e.kind, base_rev: e.rev, deleted: true });
  }
  return ops;
}

// Ops that turn `current` into `target` for the given ids (default: every entity).
export function revertOps(current, target, ids) {
  const all = ids || new Set([...current.entities.keys(), ...target.entities.keys()]);
  const ops = [];
  for (const id of all) {
    const cur = current.entities.get(id), tgt = target.entities.get(id);
    if (isLive(tgt) && !(isLive(cur) && same(cur.data, tgt.data))) {
      ops.push({ id, kind: tgt.kind, base_rev: cur ? cur.rev : 0, data: tgt.data });
    } else if (isLive(cur) && !isLive(tgt)) {
      ops.push({ id, kind: cur.kind, base_rev: cur.rev, deleted: true });
    }
  }
  return ops;
}

// Random access into a changeset log: at(i) is the tree after the first i changesets.
export class Replayer {
  constructor(log = []) {
    this.log = [];
    this.keyframes = [emptyState()];
    for (const cs of log) this.push(cs);
  }
  get length() {
    return this.log.length;
  }
  push(cs) {
    if (this.log.length && cs.seq <= this.log[this.log.length - 1].seq) return;
    this.log.push(cs);
    if (this.log.length % KEYFRAME_EVERY === 0) {
      const k = this.keyframes.length - 1;
      this.keyframes.push(this.#build(this.keyframes[k], k * KEYFRAME_EVERY, this.log.length));
    }
  }
  at(i) {
    const n = Math.max(0, Math.min(i, this.log.length));
    const k = Math.min(Math.floor(n / KEYFRAME_EVERY), this.keyframes.length - 1);
    return this.#build(this.keyframes[k], k * KEYFRAME_EVERY, n);
  }
  #build(state, from, to) {
    let s = state;
    for (let i = from; i < to; i++) s = apply(s, this.log[i]);
    return s;
  }
}

// Person nodes plus "union" nodes joining a set of parents (or a couple) to their children.
export function familyGraph(state, visible) {
  const show = (id) => {
    const e = state.entities.get(id);
    return isLive(e) && e.kind === 'person' && (!visible || visible.has(id));
  };
  const people = [...state.entities.values()]
    .filter((e) => show(e.id))
    .sort((a, b) => a.created_seq - b.created_seq || (a.id < b.id ? -1 : 1));
  const byChild = new Map();
  const unions = new Map();
  const union = (parents) => {
    const id = 'u:' + [...parents].sort().join('+');
    if (!unions.has(id)) unions.set(id, { id, parents: [...parents].sort(), children: [] });
    return unions.get(id);
  };
  for (const e of state.entities.values()) {
    if (!isLive(e) || e.kind !== 'parent' || !show(e.data.parent) || !show(e.data.child)) continue;
    if (!byChild.has(e.data.child)) byChild.set(e.data.child, new Set());
    byChild.get(e.data.child).add(e.data.parent);
  }
  for (const e of state.entities.values()) {
    if (isLive(e) && e.kind === 'partner' && show(e.data.a) && show(e.data.b)) union([e.data.a, e.data.b]);
  }
  for (const p of people) if (byChild.has(p.id)) union(byChild.get(p.id)).children.push(p.id);
  return { people, unions: [...unions.values()] };
}

// Partners grouped into side-by-side blocks, each ordered along its partner chain.
export function partnerBlocks(state, people) {
  const adj = new Map(people.map((p) => [p.id, []]));
  for (const e of state.entities.values()) {
    if (isLive(e) && e.kind === 'partner' && adj.has(e.data.a) && adj.has(e.data.b)) {
      adj.get(e.data.a).push(e.data.b);
      adj.get(e.data.b).push(e.data.a);
    }
  }
  const seen = new Set(), blocks = [];
  for (const p of people) {
    if (seen.has(p.id)) continue;
    const comp = [], stack = [p.id];
    seen.add(p.id);
    while (stack.length) {
      const id = stack.pop();
      comp.push(id);
      for (const n of adj.get(id)) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    const order = [], walked = new Set();
    let cur = comp.find((id) => adj.get(id).length <= 1) ?? comp[0];
    while (cur && !walked.has(cur)) {
      order.push(cur);
      walked.add(cur);
      cur = adj.get(cur).find((n) => !walked.has(n));
    }
    blocks.push([...order, ...comp.filter((id) => !walked.has(id))]);
  }
  return blocks;
}

export const year = (d) => (d ? Number(d.slice(0, 4)) : null);

// Known birth years, with gaps filled from relatives (about a generation apart).
export function birthYears(state) {
  const GEN = 28;
  const { parents, children, partners } = relatives(state);
  const years = new Map();
  const people = [...state.entities.values()].filter((e) => isLive(e) && e.kind === 'person');
  for (const p of people) years.set(p.id, year(p.data.birth));
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const p of people) {
      if (years.get(p.id) != null) continue;
      const known = (list) => (list || []).map((r) => years.get(r.id)).filter((y) => y != null);
      const fromParents = known(parents.get(p.id)), fromKids = known(children.get(p.id)), fromPartners = known(partners.get(p.id));
      const guess = fromParents.length ? Math.max(...fromParents) + GEN
        : fromKids.length ? Math.min(...fromKids) - GEN
        : fromPartners.length ? fromPartners[0] : null;
      if (guess != null) { years.set(p.id, guess); changed = true; }
    }
    if (!changed) break;
  }
  return years;
}

// The name the family uses: nickname in place of the first name when there is one.
export function displayName(d) {
  return d ? `${d.nickname || d.given || ''} ${d.surname || ''}`.trim() : '';
}

export function legalName(d) {
  return d ? `${d.given || ''} ${d.surname || ''}`.trim() : '';
}

// Only for people who have died; the living are left undated on the tree.
export function lifespan(d) {
  const b = year(d?.birth), x = year(d?.death);
  if (b && x) return `${b}–${x}`;
  if (x) return `Died ${x}`;
  return '';
}
