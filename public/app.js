// Browser app: screens, tree canvas, replay/generations player, side panel, live polling.
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as T from './tree.js';

const NODE_W = 188, NODE_H = 58, UNION = 8, PHOTO = 40, COUPLE_GAP = 28;
const BAR_BASE = 14, BAR_STEP = 9, BAR_GAP = 12, MAX_TRACKS = 4; // sibling bar heights above the child row
const POLL_MS = 5000;
const ROLE_WORD = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' };
const STEP_MS = 900; // one replay step at 1x
const YEAR_MS = 220; // one generations year at 1x
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.getElementById('root');

// ---------- small helpers ----------

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

// Like replaceChildren, but skips the false/null left by `cond && node`.
const fill = (el, ...parts) => el.replaceChildren(...parts.flat().filter((p) => p != null && p !== false));

async function api(path, { method = 'GET', body, raw, type } = {}) {
  const opts = { method, headers: {} };
  if (raw) { opts.body = raw; opts.headers['content-type'] = type; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  const r = await fetch('/api' + path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status, conflict: data.conflict });
  return data;
}

let toastTimer;
function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), kind === 'error' ? 7000 : 3500);
}

// In-app replacement for confirm(): a modal <dialog> that names the action on its button.
function ask(title, body, action, { danger = false, dismiss = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'ask', 'aria-labelledby': 'ask-title' },
      h('form', { method: 'dialog', class: 'stack' },
        h('h2', { id: 'ask-title' }, title),
        h('p', {}, body),
        h('div', { class: 'row' },
          h('button', { class: danger ? 'btn danger-solid' : 'btn', value: 'yes' }, action),
          h('button', { class: 'btn quiet', value: 'no', autofocus: true }, dismiss))));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(dlg.returnValue === 'yes'); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const rel = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(ms) {
  const s = (ms - Date.now()) / 1000;
  for (const [unit, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= n) return rel.format(Math.round(s / n), unit);
  }
  return 'just now';
}
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' });
const monthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
// Partial dates stay partial: 1950, April 1950, April 21, 1950.
function formatDate(s) {
  const [y, m, d] = (s || '').split('-').map(Number);
  if (!m) return s;
  const date = new Date(Date.UTC(y, m - 1, d || 1));
  return d ? longDate.format(date) : monthYear.format(date);
}
// Dates are typed US-style (mm/dd/yyyy, mm/yyyy or yyyy) and stored as ISO partial dates.
// Returns '' for blank, null when it can't be read.
function parseDate(text) {
  const s = text.trim();
  if (!s) return '';
  const iso = (y, m, d) => {
    if (m && (m < 1 || m > 12)) return null;
    if (d && new Date(Date.UTC(y, m - 1, d)).getUTCDate() !== Number(d)) return null;
    return [y, m && String(m).padStart(2, '0'), d && String(d).padStart(2, '0')].filter(Boolean).join('-');
  };
  let m;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return iso(m[3], +m[1], +m[2]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{4})$/))) return iso(m[2], +m[1]);
  if ((m = s.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/))) return iso(m[1], m[2] && +m[2], m[3] && +m[3]);
  return null;
}
function usDate(iso) {
  const [y, m, d] = (iso || '').split('-');
  return d ? `${m}/${d}/${y}` : m ? `${m}/${y}` : y || '';
}
// Robert “Bob” Kato
function fullName(d) {
  return d.nickname && d.given ? `${d.given} “${d.nickname}” ${d.surname || ''}`.trim() : T.displayName(d);
}
// Second line of a person card: the legal first name when they went by a nickname, and dates once they've died.
const cardSubtitle = (d) => [d.nickname && d.given, T.lifespan(d)].filter(Boolean).join(', ');

const nameOf = (e) => T.displayName(e?.data) || 'Unnamed';
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ---------- routing ----------

const go = (path) => { history.pushState(null, '', path); route(); };
addEventListener('popstate', () => route());

let me = null;

async function route() {
  stopTree();
  const url = new URL(location.href);
  try {
    if (url.pathname === '/auth') {
      await api('/auth/verify', { method: 'POST', body: { token: url.searchParams.get('token') } });
      history.replaceState(null, '', '/');
      return route();
    }
    if (url.pathname === '/invite') {
      const { tree } = await api('/invites/accept', { method: 'POST', body: { token: url.searchParams.get('token') } });
      toast(`You joined ${tree.name}`);
      history.replaceState(null, '', `/t/${tree.id}`);
      return route();
    }
    me = await api('/me').catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!me) return loginScreen();
    if (!me.user.name) return nameScreen();
    const m = url.pathname.match(/^\/t\/([\w-]+)$/);
    if (m) return treeScreen(m[1]);
    return treesScreen();
  } catch (e) {
    frontScreen(h('div', { class: 'sheet' }, h('h2', {}, 'That didn’t work'), h('p', {}, e.message), h('a', { href: '/', class: 'btn', onclick: (ev) => { ev.preventDefault(); go('/'); } }, 'Go to your trees')));
  }
}

// ---------- front screens ----------

function frontScreen(...content) {
  root.replaceChildren(h('div', { class: 'front ground' }, h('div', { class: 'front-inner' },
    h('div', {}, h('h1', { class: 'wordmark' }, 'Ancestree'), h('p', { class: 'wordmark-sub' }, 'A family tree your whole family builds together.')),
    ...content)));
}

let turnstileReady;
function loadTurnstile() {
  turnstileReady ||= new Promise((resolve, reject) => {
    const s = h('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true });
    s.onload = resolve;
    s.onerror = () => reject(new Error('The robot check could not load. Check your connection and reload.'));
    document.head.append(s);
  });
  return turnstileReady;
}

async function loginScreen() {
  const email = h('input', { type: 'email', required: true, autocomplete: 'email', placeholder: 'you@example.com' });
  const widget = h('div');
  const err = h('p', { class: 'error', role: 'alert' });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Email me a sign-in link');
  let widgetId;
  const form = h('form', {
    class: 'sheet', onsubmit: async (ev) => {
      ev.preventDefault();
      err.textContent = '';
      submit.disabled = true;
      try {
        await api('/auth/login', { method: 'POST', body: { email: email.value, turnstile: window.turnstile?.getResponse(widgetId) } });
        form.replaceChildren(h('h2', {}, 'Check your inbox'),
          h('p', {}, `We sent a sign-in link to ${email.value.trim()}. It works once, for 15 minutes.`),
          h('button', { class: 'link', type: 'button', onclick: () => loginScreen() }, 'Use a different address'));
      } catch (e) {
        err.textContent = e.message;
        window.turnstile?.reset(widgetId);
        submit.disabled = false;
      }
    },
  },
  h('h2', {}, 'Sign in'),
  h('label', { class: 'field' }, 'Email address', email),
  widget, err, submit,
  h('p', { class: 'hint' }, 'No password needed. New here? The same link creates your account.'));
  frontScreen(form);
  try {
    const [{ turnstile_sitekey }] = await Promise.all([api('/config'), loadTurnstile()]);
    widgetId = window.turnstile.render(widget, { sitekey: turnstile_sitekey, appearance: 'interaction-only' });
  } catch (e) { err.textContent = e.message; }
}

function nameScreen() {
  const name = h('input', { required: true, maxlength: 80, autocomplete: 'name' });
  frontScreen(h('form', {
    class: 'sheet', onsubmit: async (ev) => {
      ev.preventDefault();
      try { await api('/me', { method: 'PATCH', body: { name: name.value } }); route(); } catch (e) { toast(e.message, 'error'); }
    },
  }, h('h2', {}, 'What should your family call you?'), h('label', { class: 'field' }, 'Your name', name),
  h('p', { class: 'hint' }, 'It appears next to your edits and comments.'), h('button', { class: 'btn' }, 'Save name')));
  name.focus();
}

function treesScreen() {
  const name = h('input', { required: true, maxlength: 80 });
  frontScreen(
    h('div', { class: 'sheet' },
      h('h2', {}, 'Your family trees'),
      me.trees.length
        ? h('ul', { class: 'tree-list' }, me.trees.map((t) => h('li', {}, h('a', { href: `/t/${t.id}`, onclick: (ev) => { ev.preventDefault(); go(`/t/${t.id}`); } },
          h('span', { class: 'tree-name' }, t.name), h('span', { class: 'role' }, ROLE_WORD[t.role])))))
        : h('p', {}, 'You’re not in any family trees yet. Start one, or ask a relative to invite you.'),
      h('form', {
        class: 'stack', onsubmit: async (ev) => {
          ev.preventDefault();
          try { const { tree } = await api('/trees', { method: 'POST', body: { name: name.value } }); go(`/t/${tree.id}`); } catch (e) { toast(e.message, 'error'); }
        },
      }, h('label', { class: 'field' }, 'Name a new tree', name), h('div', {}, h('button', { class: 'btn' }, 'Create tree'))),
      h('p', { class: 'hint' }, `Signed in as ${me.user.email}. `, h('button', { class: 'link', onclick: signOut }, 'Sign out'))));
}

async function signOut() {
  await api('/auth/logout', { method: 'POST', body: {} });
  me = null;
  go('/');
}

// ---------- tree workspace state ----------

let V = null; // the open tree

function stopTree() {
  if (!V) return;
  clearInterval(V.pollTimer);
  V.playing = false;
  V = null;
}

const editor = () => T.canEdit(V.role);

async function treeScreen(treeId) {
  const data = await api(`/trees/${treeId}`);
  V = {
    id: treeId, tree: data.tree, role: data.role, members: data.members,
    state: T.fromRows(data.tree.seq, data.entities), cursor: data.tree.seq,
    replayer: null, logLoading: null,
    mode: 'live', frame: 0, year: null, playing: false, speed: 1,
    selected: null, tab: 'chat', form: null,
    comments: new Map(), drawn: null, drawToken: 0, fitted: false,
    counts: new Map(Object.entries(data.comment_counts)), loadedAt: data.now, noteLive: new Map(),
    invites: [], membersFresh: false,
  };
  buildWorkspace();
  draw({ fit: true });
  renderPanel();
  V.pollTimer = setInterval(() => document.visibilityState === 'visible' && poll(), POLL_MS);
}

function buildWorkspace() {
  const modeBtn = (mode, label) => h('button', { 'aria-pressed': String(V.mode === mode), onclick: () => setMode(mode) }, label);
  V.el = {};
  V.el.modes = h('div', { class: 'modes', role: 'group', 'aria-label': 'View' },
    modeBtn('live', 'Tree'), modeBtn('replay', 'Replay edits'), modeBtn('generations', 'Generations'));
  V.el.svg = d3.create('svg').attr('aria-label', `Family tree: ${V.tree.name}`);
  V.el.svg.append('defs').html('<clipPath id="avatar" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>');
  V.el.view = V.el.svg.append('g');
  V.el.edges = V.el.view.append('g');
  V.el.unions = V.el.view.append('g');
  V.el.people = V.el.view.append('g');
  V.zoom = d3.zoom().scaleExtent([0.15, 2.5]).on('zoom', (ev) => V.el.view.attr('transform', ev.transform));
  V.el.svg.call(V.zoom).on('dblclick.zoom', null);
  V.el.svg.on('click', (ev) => { if (ev.target === V.el.svg.node()) select(null); });
  V.el.empty = h('div', { class: 'empty' });
  V.el.player = h('div', { class: 'player', hidden: true });
  V.el.stage = h('main', { class: 'stage ground' }, V.el.svg.node(), V.el.empty, V.el.player);
  V.el.tabs = h('nav', { class: 'tabs', role: 'tablist' });
  V.el.body = h('div', { class: 'panel-body' });
  root.replaceChildren(h('div', { class: 'app' },
    h('header', { class: 'bar' },
      h('a', { class: 'home', href: '/', onclick: (ev) => { ev.preventDefault(); go('/'); } }, 'Ancestree'),
      h('h1', { class: 'tree-title' }, V.tree.name),
      h('span', { class: 'spacer' }), V.el.modes,
      h('button', { class: 'btn quiet small', onclick: signOut }, 'Sign out')),
    V.el.stage,
    h('aside', { class: 'panel', 'aria-label': 'Details' }, V.el.tabs, V.el.body)));
}

// ---------- canvas ----------

const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60', // room for MAX_TRACKS sibling bars
  'elk.spacing.nodeNode': '26',
  'elk.spacing.componentComponent': '60',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};
let elk;

// What the canvas shows right now, depending on mode.
function shownState() {
  if (V.mode === 'replay' && V.replayer) return { state: V.replayer.at(V.frame) };
  if (V.mode === 'generations' && V.year != null) {
    const visible = new Set([...V.years].filter(([, y]) => y != null && y <= V.year).map(([id]) => id));
    return { state: V.state, visible };
  }
  return { state: V.state };
}

// Couples are laid out as one block node with fixed ports, so ELK keeps partners together
// while it minimises crossings: a top port per member, a bottom port per set of their children.
function elkGraph(g, blocks) {
  const blockOf = new Map(), offset = new Map();
  blocks.forEach((members, b) => members.forEach((id, i) => { blockOf.set(id, b); offset.set(id, i * (NODE_W + COUPLE_GAP)); }));
  const port = (id, x, y, side) => ({ id, x, y, width: 1, height: 1, layoutOptions: { 'elk.port.side': side } });
  const bottom = blocks.map(() => []);
  const edges = [], unionNodes = [];
  const down = (u) => u.parents.map((p) => offset.get(p) + NODE_W / 2).reduce((a, b) => a + b) / u.parents.length;
  for (const u of g.unions) {
    if (!u.children.length) continue;
    const b = blockOf.get(u.parents[0]);
    const together = u.parents.every((p) => blockOf.get(p) === b);
    if (together) {
      bottom[b].push(port(`pb:${u.id}`, down(u), NODE_H, 'SOUTH'));
      u.children.forEach((c) => edges.push({ id: `${u.id}>${c}`, sources: [`pb:${u.id}`], targets: [`pt:${c}`] }));
    } else {
      // Co-parents who aren't partners meet at a small junction node.
      unionNodes.push({ id: u.id, width: UNION, height: UNION });
      u.parents.forEach((p) => {
        const pid = `pb:${u.id}:${p}`;
        bottom[blockOf.get(p)].push(port(pid, offset.get(p) + NODE_W / 2, NODE_H, 'SOUTH'));
        edges.push({ id: `${p}>${u.id}`, sources: [pid], targets: [u.id] });
      });
      u.children.forEach((c) => edges.push({ id: `${u.id}>${c}`, sources: [u.id], targets: [`pt:${c}`] }));
    }
  }
  const children = blocks.map((members, b) => ({
    id: `b:${members[0]}`,
    width: members.length * NODE_W + (members.length - 1) * COUPLE_GAP, height: NODE_H,
    layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
    ports: [...members.map((id) => port(`pt:${id}`, offset.get(id) + NODE_W / 2, 0, 'NORTH')), ...bottom[b]],
  }));
  return { graph: { id: 'root', layoutOptions: ELK_OPTIONS, children: [...children, ...unionNodes], edges }, offset };
}

// Flip a couple when each partner's parents sit on the other side, then lay out again.
function flipBlocks(blocks, pos, state) {
  const { parents } = T.relatives(state);
  let flipped = false;
  const out = blocks.map((members) => {
    const xs = members.map((id) => {
      const ps = (parents.get(id) || []).map((r) => pos.get(r.id)).filter(Boolean);
      return ps.length ? ps.reduce((a, p) => a + p.x, 0) / ps.length : null;
    });
    const known = xs.map((x, i) => [x, i]).filter(([x]) => x != null);
    if (known.length >= 2 && known[0][0] > known[known.length - 1][0]) { flipped = true; return [...members].reverse(); }
    return members;
  });
  return flipped ? out : null;
}

async function layoutTree(g, state) {
  elk ||= new window.ELK();
  let blocks = T.partnerBlocks(state, g.people);
  for (let pass = 0; ; pass++) {
    const { graph, offset } = elkGraph(g, blocks);
    const layout = await elk.layout(graph);
    const pos = new Map();
    for (const n of layout.children) {
      if (n.id.startsWith('b:')) {
        blocks.find((m) => `b:${m[0]}` === n.id).forEach((id) => pos.set(id, { x: n.x + offset.get(id), y: n.y }));
      } else pos.set(n.id, { x: n.x, y: n.y });
    }
    const next = pass === 0 && flipBlocks(blocks, pos, state);
    if (!next) return { layout, pos, blocks };
    blocks = next;
  }
}

async function draw({ highlight = new Set(), duration = 450, fit = false } = {}) {
  const token = ++V.drawToken;
  const { state, visible } = shownState();
  const g = T.familyGraph(state, visible);
  const { layout, pos, blocks } = await layoutTree(g, state);
  if (!V || token !== V.drawToken) return;
  const t = d3.transition().duration(reduceMotion ? 0 : duration).ease(d3.easeCubicInOut);
  const parentsOf = T.relatives(state).parents;
  const inBlock = new Map(blocks.flatMap((m, b) => m.map((id) => [id, b])));

  // Partner lines join couples at mid-height; descent lines drop from the middle of that line
  // (or from a lone parent) to each child. Each kind keeps one path shape so it tweens.
  const edgeData = [], descents = [];
  for (const u of g.unions) {
    const P = u.parents.map((p) => pos.get(p));
    const together = u.parents.every((p) => inBlock.get(p) === inBlock.get(u.parents[0]));
    if (u.parents.length === 2 && together) {
      const [l, r] = P[0].x < P[1].x ? P : [P[1], P[0]];
      edgeData.push({ id: `m:${u.id}`, d: `M${l.x + NODE_W},${l.y + NODE_H / 2}H${r.x}` });
    }
    if (!u.children.length) continue;
    let sx, sy;
    if (together) {
      sx = P.reduce((a, p) => a + p.x + NODE_W / 2, 0) / P.length;
      sy = P[0].y + (P.length > 1 ? NODE_H / 2 : NODE_H);
    } else {
      const U = pos.get(u.id);
      sx = U.x + UNION / 2; sy = U.y + UNION / 2;
      u.parents.forEach((p) => {
        const Q = pos.get(p), x = Q.x + NODE_W / 2, y = Q.y + NODE_H;
        edgeData.push({ id: `${p}>${u.id}`, d: `M${x},${y}V${(y + sy) / 2}H${sx}V${sy}` });
      });
    }
    descents.push({
      u, sx, sy,
      kids: u.children.map((c) => {
        const C = pos.get(c);
        const kinds = (parentsOf.get(c) || []).filter((r) => u.parents.includes(r.id)).map((r) => r.type);
        return { c, x: C.x + NODE_W / 2, y: C.y, chosen: kinds.length > 0 && !kinds.includes('birth') };
      }),
    });
  }
  const tracks = siblingTracks(descents);
  for (const dsc of descents) {
    const lift = BAR_BASE + tracks.get(dsc) * BAR_STEP;
    for (const k of dsc.kids) {
      edgeData.push({ id: `${dsc.u.id}>${k.c}`, d: `M${dsc.sx},${dsc.sy}V${k.y - lift}H${k.x}V${k.y}`, chosen: k.chosen });
    }
  }
  V.el.edges.selectAll('path').data(edgeData, (d) => d.id).join(
    (enter) => enter.append('path').attr('class', 'edge').attr('d', (d) => d.d).attr('opacity', 0).call((s) => s.transition(t).attr('opacity', 1)),
    (update) => update.call((s) => s.transition(t).attr('d', (d) => d.d).attr('opacity', 1)),
    (exit) => exit.call((s) => s.transition(t).attr('opacity', 0).remove()),
  ).classed('chosen', (d) => !!d.chosen);

  const junctions = g.unions.filter((u) => pos.has(u.id));
  V.el.unions.selectAll('circle').data(junctions, (d) => d.id).join(
    (enter) => enter.append('circle').attr('class', 'union').attr('r', 3.5)
      .attr('cx', (d) => pos.get(d.id).x + UNION / 2).attr('cy', (d) => pos.get(d.id).y + UNION / 2)
      .attr('opacity', 0).call((s) => s.transition(t).attr('opacity', 1)),
    (update) => update.call((s) => s.transition(t).attr('cx', (d) => pos.get(d.id).x + UNION / 2).attr('cy', (d) => pos.get(d.id).y + UNION / 2)),
    (exit) => exit.call((s) => s.transition(t).attr('opacity', 0).remove()),
  );

  const at = (d) => `translate(${pos.get(d.id).x},${pos.get(d.id).y})`;
  V.el.people.selectAll('g.person').data(g.people, (d) => d.id).join(
    (enter) => enter.append('g').attr('class', 'person').attr('tabindex', 0).attr('role', 'button')
      .attr('transform', at).attr('opacity', 0)
      .on('click', (ev, d) => { ev.stopPropagation(); select(d.id); })
      .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(d.id); } })
      .call((s) => {
        s.append('rect').attr('width', NODE_W).attr('height', NODE_H).attr('rx', 10);
        s.append('image').attr('x', 9).attr('y', 9).attr('width', PHOTO).attr('height', PHOTO).attr('clip-path', 'url(#avatar)').attr('preserveAspectRatio', 'xMidYMid slice');
        s.append('text').attr('class', 'name').attr('y', 25);
        s.append('text').attr('class', 'years').attr('y', 43);
        const b = s.append('g').attr('class', 'badge').attr('aria-hidden', 'true').attr('transform', `translate(${NODE_W - 4},4)`);
        b.append('circle').attr('r', 11);
        b.append('text').attr('text-anchor', 'middle').attr('dy', 4);
      })
      .call((s) => s.transition(t).attr('opacity', 1)),
    (update) => update.call((s) => s.transition(t).attr('transform', at).attr('opacity', 1)),
    (exit) => exit.call((s) => s.transition(t).attr('opacity', 0).remove()),
  ).each(function (d) {
    const g = d3.select(this), photo = d.data.photo, x = photo ? 58 : 14;
    g.classed('selected', d.id === V.selected);
    setBadge(g, d);
    g.select('image').attr('href', photo ? `/api/trees/${V.id}/media/${photo}` : null).attr('display', photo ? null : 'none');
    const years = cardSubtitle(d.data);
    g.select('.name').attr('x', x).attr('y', years ? 25 : NODE_H / 2 + 5).text(clip(nameOf(d), photo ? 17 : 21));
    g.select('.years').attr('x', x).text(years);
    g.classed('lit', false);
    if (highlight.has(d.id)) {
      void this.getBoundingClientRect(); // restart the expose animation
      g.classed('lit', true);
    }
  });

  renderEmpty(g.people.length);
  if (fit || V.mode !== 'live' || !V.pos?.size) fitView(layout, duration);
  V.pos = pos;
}

// Pan (keeping the zoom) so a person is on screen, e.g. after adding them or picking them from a list.
function ensureVisible(id) {
  const p = V.pos?.get(id);
  if (!p) return;
  const svg = V.el.svg.node(), { width, height } = svg.getBoundingClientRect();
  const tr = d3.zoomTransform(svg), [x, y] = tr.apply([p.x, p.y]);
  const margin = 24;
  if (x >= margin && y >= margin && x + NODE_W * tr.k <= width - margin && y + NODE_H * tr.k <= height - margin) return;
  const next = d3.zoomIdentity.translate(width / 2 - (p.x + NODE_W / 2) * tr.k, height / 2 - (p.y + NODE_H / 2) * tr.k).scale(tr.k);
  V.el.svg.transition().duration(reduceMotion ? 0 : 450).call(V.zoom.transform, next);
}

// Sibling bars of different families between the same two generations would sit on one line
// and read as one family; give families whose bars overlap horizontally separate heights.
function siblingTracks(descents) {
  const tracks = new Map(), byLayer = new Map();
  for (const d of descents) {
    const xs = [d.sx, ...d.kids.map((k) => k.x)];
    d.span = [Math.min(...xs), Math.max(...xs)];
    const layer = Math.round(Math.min(...d.kids.map((k) => k.y)));
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(d);
  }
  for (const group of byLayer.values()) {
    const ends = []; // rightmost x used on each track
    for (const d of group.sort((a, b) => a.span[0] - b.span[0])) {
      let t = ends.findIndex((end) => end + BAR_GAP < d.span[0]);
      if (t < 0 || t >= MAX_TRACKS) t = ends.length < MAX_TRACKS ? ends.length : ends.indexOf(Math.min(...ends));
      ends[t] = Math.max(ends[t] ?? -Infinity, d.span[1]);
      tracks.set(d, t);
    }
  }
  return tracks;
}

function setBadge(g, d) {
  const n = V.counts.get(d.id) || 0, years = T.lifespan(d.data);
  g.attr('aria-label', [nameOf(d), years, n && `${n} ${n === 1 ? 'comment' : 'comments'}`].filter(Boolean).join(', '));
  g.select('.badge').attr('display', n ? null : 'none').select('text').text(n > 99 ? '99+' : n || '');
}

// Keeps per-person comment counts current. Comments created before the tree loaded were
// already in the server's count; anything newer is counted the first time it's seen.
function countNote(n) {
  if (!n.target_id) return;
  const live = !n.deleted_at;
  const was = V.noteLive.get(n.id) ?? n.created_at <= V.loadedAt;
  V.noteLive.set(n.id, live);
  if (live === was) return;
  V.counts.set(n.target_id, (V.counts.get(n.target_id) || 0) + (live ? 1 : -1));
  V.el.people.selectAll('g.person').filter((d) => d.id === n.target_id).each(function (d) { setBadge(d3.select(this), d); });
}

function fitView(layout, duration) {
  const { width, height } = V.el.svg.node().getBoundingClientRect();
  if (!width || !layout.width) return;
  const playerSpace = V.mode === 'live' ? 0 : 150;
  const pad = 40;
  const k = Math.min(1.1, (width - pad * 2) / layout.width, (height - playerSpace - pad * 2) / layout.height);
  const x = (width - layout.width * k) / 2, y = (height - playerSpace - layout.height * k) / 2;
  V.el.svg.transition().duration(reduceMotion ? 0 : duration).call(V.zoom.transform, d3.zoomIdentity.translate(x, y).scale(k));
}

function renderEmpty(count) {
  if (count) { V.el.empty.hidden = true; return; }
  V.el.empty.hidden = false;
  let msg;
  if (V.mode === 'replay') msg = V.frame === 0 ? 'Before the first edit. Press play to watch the tree grow.' : 'Nobody was in the tree at this step.';
  else if (V.mode === 'generations') msg = V.years?.size ? 'Nobody with a known birth year yet. Move the slider forward.' : 'Add birth years to see the tree grow by generation.';
  else msg = editor() ? 'Start with yourself, or the oldest relative you know.' : 'Nobody has been added to this tree yet.';
  V.el.empty.replaceChildren(h('div', {}, h('p', {}, msg),
    V.mode === 'live' && editor() && h('button', { class: 'btn', onclick: () => openForm({ type: 'add', relation: 'first' }) }, 'Add the first person')));
}

function select(id) {
  V.selected = id;
  V.form = null;
  V.tab = id ? 'person' : 'chat';
  V.el.people.selectAll('g.person').classed('selected', (d) => d.id === id);
  if (id) ensureVisible(id);
  renderPanel();
}

// ---------- modes: replay and generations ----------

async function loadLog() {
  V.logLoading ||= (async () => {
    const replayer = new T.Replayer();
    let after = 0, more = true;
    while (more) {
      const r = await api(`/trees/${V.id}/log?after=${after}`);
      r.changesets.forEach((cs) => replayer.push(cs));
      after = r.changesets.at(-1)?.seq ?? after;
      more = r.more;
    }
    V.replayer = replayer;
  })();
  return V.logLoading;
}

async function setMode(mode) {
  V.playing = false;
  V.mode = mode;
  V.el.modes.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(['live', 'replay', 'generations'][i] === mode)));
  if (mode === 'replay') {
    await loadLog();
    V.frame = V.replayer.length;
  }
  if (mode === 'generations') {
    V.years = T.birthYears(V.state);
    const ys = [...V.years.values()].filter((y) => y != null);
    V.yearRange = ys.length ? [Math.min(...ys) - 1, Math.max(new Date().getFullYear(), Math.max(...ys))] : null;
    V.year = V.yearRange ? V.yearRange[1] : null;
  }
  renderPlayer();
  draw({ fit: true });
}

function playerRange() {
  if (V.mode === 'replay') return [0, V.replayer.length, V.frame];
  if (V.yearRange) return [...V.yearRange, V.year];
  return [0, 0, 0];
}

function renderPlayer() {
  const p = V.el.player;
  if (V.mode === 'live') { p.hidden = true; return; }
  p.hidden = false;
  const [min, max, value] = playerRange();
  const icon = (label, path, onclick, cls = '') =>
    h('button', { class: 'icon ' + cls, 'aria-label': label, title: label, onclick }, svgIcon(path));
  V.el.range = h('input', {
    type: 'range', min, max, value, step: 1, 'aria-label': V.mode === 'replay' ? 'Edit step' : 'Year',
    oninput: (ev) => { V.playing = false; seek(Number(ev.target.value), 250); },
  });
  V.el.playBtn = icon(V.playing ? 'Pause' : 'Play', V.playing ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5l11 7-11 7z', togglePlay, 'play');
  V.el.caption = h('div', { class: 'caption', 'aria-live': 'polite' });
  p.replaceChildren(
    h('div', { class: 'controls' },
      icon('Step back', 'M6 5h2v14H6zM18 5L9 12l9 7z', () => { V.playing = false; seek(current() - 1); }),
      V.el.playBtn,
      icon('Step forward', 'M16 5h2v14h-2zM6 5l9 7-9 7z', () => { V.playing = false; seek(current() + 1); })),
    V.el.range,
    h('select', { 'aria-label': 'Speed', onchange: (ev) => (V.speed = Number(ev.target.value)) },
      [1, 2, 4, 8, 16].map((s) => h('option', { value: s, selected: s === V.speed }, `${s}×`))),
    V.el.caption);
  renderCaption();
}

function svgIcon(d) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d); p.setAttribute('fill', 'currentColor');
  s.append(p);
  return s;
}

const current = () => (V.mode === 'replay' ? V.frame : V.year);

function renderCaption() {
  const c = V.el.caption;
  if (!c) return;
  if (V.mode === 'generations') {
    if (!V.yearRange) { fill(c, h('span', { class: 'what' }, 'Add birth years to people to see generations.')); return; }
    const shown = [...V.years.values()].filter((y) => y != null && y <= V.year).length;
    const unknown = [...V.years.values()].filter((y) => y == null).length;
    fill(c, h('span', { class: 'big' }, V.year),
      h('span', { class: 'what' }, `${shown} ${shown === 1 ? 'person' : 'people'} born by then`),
      unknown > 0 && h('span', { class: 'when' }, `${unknown} without a birth year or close relative with one aren’t shown`));
    return;
  }
  const n = V.replayer.length;
  if (V.frame === 0) { fill(c, h('span', { class: 'big' }, `0 of ${n}`), h('span', { class: 'what' }, 'Before the first edit')); return; }
  const cs = V.replayer.log[V.frame - 1];
  fill(c,
    h('span', { class: 'big' }, `${V.frame} of ${n}`),
    h('span', { class: 'what' }, h('strong', {}, cs.user_name || 'Someone'), ': ', cs.message),
    h('time', { class: 'when', datetime: new Date(cs.created_at).toISOString() }, when.format(cs.created_at)),
    editor() && V.frame < n && h('span', { class: 'restore' }, h('button', { class: 'btn small', onclick: restoreToFrame }, 'Restore tree to this step')));
}

function touched(cs, state) {
  const ids = new Set();
  for (const op of cs.ops) {
    if (op.kind === 'person') ids.add(op.entity_id);
    else for (const k of ['parent', 'child', 'a', 'b']) if (op.data?.[k] && state.entities.has(op.data[k])) ids.add(op.data[k]);
  }
  return ids;
}

async function seek(value, duration = 600) {
  const [min, max] = playerRange();
  const v = Math.max(min, Math.min(max, value));
  let highlight = new Set();
  if (V.mode === 'replay') {
    if (v > V.frame && v - V.frame === 1) highlight = touched(V.replayer.log[v - 1], V.replayer.at(v));
    V.frame = v;
  } else {
    if (v === V.year) return;
    const prev = V.year;
    V.year = v;
    if (v > prev) for (const [id, y] of V.years) if (y != null && y > prev && y <= v) highlight.add(id);
  }
  if (V.el.range) V.el.range.value = v;
  renderCaption();
  await draw({ highlight, duration });
}

async function togglePlay() {
  if (V.playing) { V.playing = false; renderPlayer(); return; }
  const [min, max] = playerRange();
  if (current() >= max) await seek(min, 300);
  V.playing = true;
  renderPlayer();
  const cur = V;
  while (cur === V && V.playing && current() < playerRange()[1]) {
    const ms = (V.mode === 'replay' ? STEP_MS : YEAR_MS) / V.speed;
    // Pace by the clock, not the animation, so reduced motion still steps at the chosen speed.
    await Promise.all([seek(current() + 1, ms * 0.8), sleep(ms)]);
  }
  if (cur === V) { V.playing = false; renderPlayer(); }
}

async function restoreToFrame() {
  const target = V.replayer.at(V.frame);
  const ops = T.revertOps(V.state, target);
  if (!ops.length) return toast('The tree already looks like this step');
  if (!(await ask(`Restore the tree to step ${V.frame}?`, 'The tree will look the way it did at this step. This is saved as a new edit, so you can undo it later.', 'Restore tree'))) return;
  if (await commit(`Restored tree to step ${V.frame}`, ops)) setMode('live');
}

// ---------- writes and live updates ----------

async function commit(message, ops) {
  try {
    const { changeset } = await api(`/trees/${V.id}/changesets`, { method: 'POST', body: { message, ops } });
    // The log gets it from the next poll, in order; current state can take it now.
    V.state = T.apply(V.state, changeset);
    poll();
    if (V.mode === 'live') await draw({ highlight: touched(changeset, V.state) });
    return changeset;
  } catch (e) {
    toast(e.message, 'error');
    if (e.conflict) poll();
    return null;
  }
}

async function poll() {
  if (!V || V.polling) return;
  const cur = V;
  cur.polling = true;
  try {
    let more = true;
    while (more && cur === V) {
      const r = await api(`/trees/${cur.id}/changes?since=${cur.cursor}`);
      if (cur !== V) return;
      ingest(r.changesets, r.comments);
      cur.cursor = r.next;
      more = r.more;
    }
  } catch (e) {
    if (e.status === 401) location.assign('/');
  } finally {
    cur.polling = false;
  }
}

function ingest(changesets, notes) {
  if (changesets.length) {
    const lit = new Set();
    for (const cs of changesets) {
      const before = V.state;
      V.state = T.apply(V.state, cs);
      if (V.state !== before) touched(cs, V.state).forEach((id) => lit.add(id));
      V.replayer?.push(cs);
    }
    if (V.mode === 'live') draw({ highlight: lit });
    if (V.mode === 'replay') { V.el.range.max = V.replayer.length; renderCaption(); }
    if (V.selected && !T.isLive(V.state.entities.get(V.selected))) { V.selected = null; V.tab = 'chat'; }
    if (!V.form) renderPanel();
  }
  for (const n of notes) {
    countNote(n);
    const key = n.target_id || '';
    const list = V.comments.get(key);
    if (!list) continue;
    const i = list.findIndex((x) => x.id === n.id);
    if (i >= 0) list[i] = n; else list.push(n);
    if (threadKey() === key && !V.form) renderPanel();
  }
}

// ---------- side panel ----------

const threadKey = () => (V.tab === 'person' ? V.selected : V.tab === 'chat' ? '' : null);

function renderPanel() {
  const tabs = [
    V.selected && ['person', V.state.entities.get(V.selected)?.data.given || nameOf(V.state.entities.get(V.selected))],
    ['chat', 'Family chat'], ['history', 'History'], ['members', 'Members'],
  ].filter(Boolean);
  V.el.tabs.replaceChildren(...tabs.map(([key, label]) => h('button', {
    // The first-person form belongs to no tab.
    role: 'tab', 'aria-selected': String(V.tab === key && V.form?.relation !== 'first'),
    onclick: () => { V.tab = key; V.form = null; if (key === 'members') V.membersFresh = false; renderPanel(); },
  }, clip(label, 18))));
  const body = V.form ? formView() : { person: personView, chat: chatView, history: historyView, members: membersView }[V.tab]();
  fill(V.el.body, body);
}

function personView() {
  const p = V.state.entities.get(V.selected);
  if (!T.isLive(p)) return h('p', {}, 'This person was removed from the tree.');
  const d = p.data;
  const { parents, children, partners } = T.relatives(V.state);
  const kinRow = (r, label) => h('li', {}, h('button', { class: 'link', onclick: () => select(r.id) }, nameOf(V.state.entities.get(r.id))), ' ', h('span', { class: 'rel' }, label));
  const kin = [
    ...(parents.get(p.id) || []).map((r) => kinRow(r, r.type === 'birth' ? 'parent' : `${r.type} parent`)),
    ...(partners.get(p.id) || []).map((r) => kinRow(r, r.type === 'married' ? 'spouse' : 'partner')),
    ...(children.get(p.id) || []).map((r) => kinRow(r, r.type === 'birth' ? 'child' : `${r.type} child`)),
  ];
  const fact = (label, date, place) => (date || place) && h('p', {}, `${label} ${[formatDate(date), place && `in ${place}`].filter(Boolean).join(' ')}`);
  return [
    h('div', { class: 'person-head' },
      d.photo && h('img', { class: 'portrait', src: `/api/trees/${V.id}/media/${d.photo}`, alt: `Photo of ${nameOf(p)}` }),
      h('h2', {}, fullName(d) || 'Unnamed'),
      h('div', { class: 'facts' }, fact('Born', d.birth, d.birth_place), fact('Died', d.death)),
      d.notes && h('p', { class: 'notes' }, d.notes)),
    editor() && h('div', { class: 'actions' },
      h('button', { class: 'btn small', onclick: () => openForm({ type: 'edit' }) }, 'Edit details'),
      h('button', { class: 'btn quiet small', onclick: () => openForm({ type: 'add', relation: 'parent' }) }, 'Add parent'),
      h('button', { class: 'btn quiet small', onclick: () => openForm({ type: 'add', relation: 'partner' }) }, 'Add partner'),
      h('button', { class: 'btn quiet small', onclick: () => openForm({ type: 'add', relation: 'child' }) }, 'Add child')),
    !editor() && h('p', { class: 'hint' }, 'You can view this tree and comment. Ask an owner if you’d like to edit it too.'),
    kin.length > 0 && h('section', { class: 'section' }, h('h3', {}, 'Family'), h('ul', { class: 'kin' }, kin)),
    threadSection(p.id, `Comments about ${T.displayName(d) || 'this person'}`, 'Share a memory or ask a question'),
    editor() && h('div', {}, h('button', { class: 'btn danger small', onclick: () => removePerson(p) }, 'Remove from tree')),
  ];
}

async function removePerson(p) {
  if (!(await ask(`Remove ${nameOf(p)}?`, `${nameOf(p)} and their relationships will be removed from the tree. You can undo this from History.`, 'Remove from tree', { danger: true }))) return;
  if (await commit(`Removed ${nameOf(p)}`, T.deleteOps(V.state, p.id))) select(null);
}

function chatView() {
  return [
    h('p', { class: 'hint' }, 'Talk about the family with everyone in this tree. Select a person to comment on them.'),
    threadSection(null, 'Family chat', 'Write a message to the family'),
  ];
}

function threadSection(targetId, title, placeholder) {
  const key = targetId || '';
  const box = h('section', { class: 'section' }, h('h3', {}, title));
  const list = V.comments.get(key);
  if (!list) {
    box.append(h('p', { class: 'hint' }, 'Loading comments…'));
    api(`/trees/${V.id}/comments${targetId ? `?target=${targetId}` : ''}`).then(({ comments }) => {
      V.comments.set(key, comments);
      if (threadKey() === key) renderPanel();
    }, (e) => toast(e.message, 'error'));
    return box;
  }
  const live = list.filter((n) => !n.deleted_at);
  const top = live.filter((n) => !n.parent_id || !live.some((x) => x.id === n.parent_id));
  box.append(
    top.length ? h('ul', { class: 'thread' }, top.map((n) => {
      const replies = live.filter((x) => x.parent_id === n.id);
      return h('li', {}, noteView(n, targetId), replies.length > 0 && h('ul', { class: 'replies' }, replies.map((r) => h('li', {}, noteView(r, targetId)))));
    })) : h('p', { class: 'hint' }, 'No comments yet.'),
    composer(targetId, null, placeholder));
  return box;
}

function noteView(n, targetId) {
  const mine = n.user_id === me.user.id;
  const wrap = h('div', {});
  const tools = h('div', { class: 'note-tools' },
    !n.parent_id && h('button', {
      class: 'link', onclick: () => {
        const open = wrap.querySelector('.composer');
        if (open) return open.querySelector('textarea').focus();
        const reply = composer(targetId, n.id, `Reply to ${n.user_name}`, () => reply.remove());
        tools.after(reply);
      },
    }, 'Reply'),
    mine && h('button', { class: 'link', onclick: () => editNote(wrap, n) }, 'Edit'),
    (mine || V.role === 'owner') && h('button', { class: 'link', onclick: () => deleteNote(n) }, 'Delete'));
  wrap.append(
    h('div', { class: 'note-head' }, h('strong', {}, n.user_name || 'Someone'),
      h('time', { datetime: new Date(n.created_at).toISOString(), title: when.format(n.created_at) }, ago(n.created_at)),
      n.edited_at && h('span', { class: 'edited' }, '(edited)')),
    h('p', { class: 'note-body' }, n.body), tools);
  return wrap;
}

// onCancel makes it a dismissible reply box, focused on open.
function composer(targetId, parentId, placeholder, onCancel) {
  const text = h('textarea', { placeholder, maxlength: 4000, 'aria-label': placeholder, rows: 3 });
  const form = h('form', {
    class: 'composer', onsubmit: async (ev) => {
      ev.preventDefault();
      if (!text.value.trim()) return;
      try {
        const { comment } = await api(`/trees/${V.id}/comments`, { method: 'POST', body: { target: targetId, parent: parentId, body: text.value } });
        const list = V.comments.get(targetId || '');
        if (!list.some((x) => x.id === comment.id)) list.push(comment);
        countNote(comment);
        renderPanel();
      } catch (e) { toast(e.message, 'error'); }
    },
  }, text, h('div', { class: 'row' }, h('button', { class: 'btn small' }, parentId ? 'Post reply' : 'Post comment'),
    onCancel && h('button', { class: 'btn quiet small', type: 'button', onclick: onCancel }, 'Cancel')));
  if (onCancel) queueMicrotask(() => text.focus());
  return form;
}

function editNote(wrap, n) {
  const text = h('textarea', { maxlength: 4000, 'aria-label': 'Edit comment', value: n.body });
  wrap.replaceChildren(h('form', {
    class: 'composer', onsubmit: async (ev) => {
      ev.preventDefault();
      try {
        await api(`/trees/${V.id}/comments/${n.id}`, { method: 'PATCH', body: { body: text.value } });
        Object.assign(n, { body: text.value.trim(), edited_at: Date.now() });
        renderPanel();
      } catch (e) { toast(e.message, 'error'); }
    },
  }, text, h('div', { class: 'row' }, h('button', { class: 'btn small' }, 'Save comment'), h('button', { class: 'btn quiet small', type: 'button', onclick: renderPanel }, 'Cancel'))));
  text.focus();
}

async function deleteNote(n) {
  if (!(await ask('Delete this comment?', 'Nobody will be able to read it any more.', 'Delete comment', { danger: true }))) return;
  try {
    await api(`/trees/${V.id}/comments/${n.id}`, { method: 'DELETE' });
    n.deleted_at = Date.now();
    countNote(n);
    renderPanel();
  } catch (e) { toast(e.message, 'error'); }
}

function historyView() {
  if (!V.replayer) {
    loadLog().then(() => V?.tab === 'history' && renderPanel(), (e) => toast(e.message, 'error'));
    return h('p', { class: 'hint' }, 'Loading history…');
  }
  const log = V.replayer.log;
  if (!log.length) return h('p', { class: 'hint' }, 'No edits yet. Every change anyone makes shows up here.');
  const items = [];
  for (let i = log.length; i >= 1 && items.length < 300; i--) {
    const cs = log[i - 1];
    items.push(h('li', {},
      h('p', {}, cs.message),
      h('p', { class: 'meta' }, `${cs.user_name || 'Someone'}, ${when.format(cs.created_at)}`),
      h('div', { class: 'row' },
        h('button', { class: 'link', onclick: async () => { await setMode('replay'); seek(i, 300); } }, 'Show in replay'),
        editor() && h('button', { class: 'link', onclick: () => undo(i) }, 'Undo'))));
  }
  return [h('p', { class: 'hint' }, `${log.length} edits. Undo adds a new edit, so nothing is ever lost.`), h('ul', { class: 'history' }, items)];
}

async function undo(step) {
  const cs = V.replayer.log[step - 1];
  const ops = T.revertOps(V.state, V.replayer.at(step - 1), new Set(cs.ops.map((o) => o.entity_id)));
  if (!ops.length) return toast('That edit is already undone');
  if (await commit(`Undid “${cs.message}”`, ops)) toast('Undone');
}

// Members and invites change on other people's devices (an invite gets accepted), so refetch on open.
function refreshMembers() {
  V.membersFresh = true;
  api(`/trees/${V.id}/members`).then(({ members, invites }) => {
    Object.assign(V, { members, invites });
    if (V.tab === 'members' && !V.form) renderPanel();
  }, (e) => toast(e.message, 'error'));
}

function membersView() {
  if (!V.membersFresh) refreshMembers();
  const isOwner = V.role === 'owner';
  const list = h('ul', { class: 'members' }, V.members.map((m) => h('li', {},
    h('div', {}, h('strong', {}, m.name || m.email || 'Someone'), m.id === me.user.id && ' (you)', m.email && isOwner && h('div', { class: 'hint' }, m.email)),
    isOwner && m.id !== me.user.id
      ? h('div', { class: 'row' },
        h('select', { 'aria-label': `Access for ${m.name}`, onchange: (ev) => changeRole(m, ev.target.value) },
          ['owner', 'editor', 'viewer'].map((r) => h('option', { value: r, selected: m.role === r }, ROLE_WORD[r]))),
        h('button', { class: 'link', onclick: () => removeMember(m) }, 'Remove'))
      : h('span', { class: 'hint' }, ROLE_WORD[m.role]))));
  const email = h('input', { type: 'email', required: true, placeholder: 'cousin@example.com' });
  const role = h('select', {}, h('option', { value: 'editor' }, 'Can edit'), h('option', { value: 'viewer' }, 'Can view'));
  return [
    h('section', { class: 'section' }, h('h3', {}, 'People in this tree'), list),
    isOwner && V.invites.length > 0 && h('section', { class: 'section' }, h('h3', {}, 'Waiting to join'),
      h('ul', { class: 'members' }, V.invites.map((i) => h('li', {},
        h('div', {}, h('strong', {}, i.email), h('div', { class: 'hint' }, `${ROLE_WORD[i.role]}, invite expires ${rel.format(Math.ceil((i.expires_at - Date.now()) / 86_400_000), 'day')}`)),
        h('div', { class: 'row' },
          h('button', { class: 'link', onclick: () => resendInvite(i) }, 'Resend'),
          h('button', { class: 'link', onclick: () => cancelInvite(i) }, 'Cancel invite')))))),
    isOwner && h('form', {
      class: 'section', onsubmit: async (ev) => {
        ev.preventDefault();
        try {
          const { invite } = await api(`/trees/${V.id}/invites`, { method: 'POST', body: { email: email.value, role: role.value } });
          V.invites = [...V.invites.filter((i) => i.email !== invite.email), invite].sort((a, b) => a.email.localeCompare(b.email));
          toast(`Invite sent to ${invite.email}`);
          renderPanel();
        } catch (e) { toast(e.message, 'error'); }
      },
    }, h('h3', {}, 'Invite a relative'), h('label', { class: 'field' }, 'Email address', email), h('label', { class: 'field' }, 'Access', role),
    h('div', {}, h('button', { class: 'btn small' }, 'Send invite'))),
    !isOwner && h('div', {}, h('button', { class: 'btn danger small', onclick: () => removeMember(V.members.find((m) => m.id === me.user.id)) }, 'Leave this tree')),
  ];
}

async function resendInvite(i) {
  try {
    const { invite } = await api(`/trees/${V.id}/invites/${i.id}/resend`, { method: 'POST', body: {} });
    Object.assign(i, invite);
    toast(`Invite sent again to ${i.email}. The earlier link no longer works.`);
    renderPanel();
  } catch (e) { toast(e.message, 'error'); }
}

async function cancelInvite(i) {
  if (!(await ask(`Cancel the invite to ${i.email}?`, 'The link in their email will stop working.', 'Cancel invite', { danger: true, dismiss: 'Keep invite' }))) return;
  try {
    await api(`/trees/${V.id}/invites/${i.id}`, { method: 'DELETE' });
    V.invites = V.invites.filter((x) => x.id !== i.id);
    renderPanel();
  } catch (e) { toast(e.message, 'error'); }
}

async function changeRole(m, role) {
  try { await api(`/trees/${V.id}/members/${m.id}`, { method: 'PATCH', body: { role } }); m.role = role; toast(`${m.name || m.email} updated`); } catch (e) { toast(e.message, 'error'); renderPanel(); }
}

async function removeMember(m) {
  const self = m.id === me.user.id;
  const ok = self
    ? await ask('Leave this tree?', 'You’ll need a new invite to come back.', 'Leave tree', { danger: true })
    : await ask(`Remove ${m.name || m.email}?`, 'They’ll lose access to this tree. Their edits and comments stay.', 'Remove member', { danger: true });
  if (!ok) return;
  try {
    await api(`/trees/${V.id}/members/${m.id}`, { method: 'DELETE' });
    if (self) return go('/');
    V.members = V.members.filter((x) => x.id !== m.id);
    renderPanel();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- person forms ----------

function openForm(form) {
  V.form = form;
  if (form.relation === 'first') V.tab = 'chat';
  renderPanel();
}

async function resizeImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1200 / Math.max(img.width, img.height));
  const c = h('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
}

// Text date field (mm/dd/yyyy, mm/yyyy or yyyy) with a calendar button for exact dates.
function dateField(name, label, value) {
  const text = h('input', { name, value: usDate(value), placeholder: 'mm/dd/yyyy', inputmode: 'numeric', autocomplete: 'off' });
  const picker = h('input', { type: 'date', class: 'picker', tabindex: -1, 'aria-hidden': 'true',
    onchange: () => { text.value = usDate(picker.value); text.dispatchEvent(new Event('input')); } });
  const hint = h('span', { class: 'hint' }, 'Just the year is fine if that’s all you know.');
  text.addEventListener('blur', () => {
    const ok = parseDate(text.value) !== null;
    text.setAttribute('aria-invalid', String(!ok));
    hint.textContent = ok ? 'Just the year is fine if that’s all you know.' : 'Use mm/dd/yyyy, mm/yyyy or just the year.';
    hint.classList.toggle('error', !ok);
  });
  const open = () => {
    const iso = parseDate(text.value);
    picker.value = iso && iso.length === 10 ? iso : '';
    picker.showPicker?.();
  };
  return h('label', { class: 'field' }, label,
    h('div', { class: 'with-button' }, text, picker,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Pick ${label.toLowerCase()} date from a calendar`, onclick: open }, svgIcon(CALENDAR))),
    hint);
}
const CALENDAR = 'M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm-2 8h14v10H5V10z';

// Free-text place with Town, State, Country suggestions as you type.
function placeField(name, label, value) {
  const listId = `${name}-options`;
  const input = h('input', { name, value: value || '', autocomplete: 'off', placeholder: 'Town, state, country',
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId });
  const list = h('ul', { class: 'suggest', id: listId, role: 'listbox', hidden: true });
  let items = [], active = -1, timer, seq = 0;
  const show = (places) => {
    items = places;
    active = -1;
    list.replaceChildren(...places.map((p, i) => h('li', { role: 'option', id: `${listId}-${i}`,
      onmousedown: (ev) => { ev.preventDefault(); choose(i); } }, p)));
    list.hidden = !places.length;
    input.setAttribute('aria-expanded', String(!!places.length));
  };
  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `${listId}-${i}`); else input.removeAttribute('aria-activedescendant');
  };
  const choose = (i) => { input.value = items[i]; show([]); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim(), mine = ++seq;
    if (q.length < 2) return show([]);
    timer = setTimeout(async () => {
      try {
        const { places } = await api(`/places?q=${encodeURIComponent(q)}`);
        if (mine === seq && document.activeElement === input) show(places);
      } catch { show([]); } // suggestions are optional; typing still works
    }, 250);
  });
  input.addEventListener('keydown', (ev) => {
    if (list.hidden) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); highlight((active + 1) % items.length); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); highlight((active - 1 + items.length) % items.length); }
    else if (ev.key === 'Enter' && active >= 0) { ev.preventDefault(); choose(active); }
    else if (ev.key === 'Escape') { ev.preventDefault(); show([]); }
  });
  input.addEventListener('blur', () => show([]));
  return h('label', { class: 'field place' }, label, input, list);
}

function formView() {
  const f = V.form;
  const subject = V.selected && V.state.entities.get(V.selected);
  // A new child usually shares a surname with the parent they're added from.
  const base = f.type === 'edit' ? subject.data : f.relation === 'child' ? { surname: subject.data.surname } : {};
  const input = (name, label, attrs = {}) => h('label', { class: 'field' }, label, h('input', { name, value: base[name] || '', ...attrs }));
  const photo = h('input', { type: 'file', name: 'photo', accept: 'image/jpeg,image/png,image/webp,image/gif' });
  const { parents, partners, children } = T.relatives(V.state);

  const who = subject && (subject.data.given || nameOf(subject));
  const choice = (name, label, options) => h('label', { class: 'field' }, label,
    h('select', { name }, options.map(([v, l]) => h('option', { value: v }, l))));
  const check = (name, value, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, value, checked: true }), label);
  // The relationship is the point of an "add relative" form, so it comes first.
  const relation = [];
  if (f.relation === 'child') {
    const ps = partners.get(subject.id) || [];
    if (ps.length) relation.push(choice('other', 'Other parent', [...ps.map((r) => [r.id, nameOf(V.state.entities.get(r.id))]), ['', 'Not known']]));
    relation.push(
      choice('ltype', `Relationship to ${who}`, [['birth', 'Birth child'], ['adoptive', 'Adopted child'], ['step', 'Stepchild'], ['foster', 'Foster child']]));
  } else if (f.relation === 'parent') {
    const ps = parents.get(subject.id) || [];
    relation.push(choice('ltype', `Relationship to ${who}`, [['birth', 'Birth parent'], ['adoptive', 'Adoptive parent'], ['step', 'Step-parent'], ['foster', 'Foster parent']]));
    if (ps.length === 1) relation.push(check('couple', ps[0].id, `Partner of ${nameOf(V.state.entities.get(ps[0].id))}`));
  } else if (f.relation === 'partner') {
    relation.push(choice('ptype', `Relationship to ${who}`, [['married', 'Married'], ['partner', 'Partners']]));
    // Children who so far have only this person as a parent are probably the new partner's too.
    for (const c of children.get(subject.id) || []) {
      if ((parents.get(c.id) || []).length === 1) relation.push(check('coparent', c.id, `Also ${nameOf(V.state.entities.get(c.id))}’s parent`));
    }
  }

  const title = f.type === 'edit' ? `Edit ${nameOf(subject)}` : f.relation === 'first' ? 'Add the first person'
    : `Add a ${f.relation} for ${nameOf(subject)}`;
  const submitLabel = f.type === 'edit' ? 'Save changes' : 'Add to tree';
  const form = h('form', { class: 'stack', onsubmit: (ev) => { ev.preventDefault(); savePerson(form, subject); } },
    h('h2', {}, title),
    relation,
    h('div', { class: 'grid2' }, input('given', 'First name', { autocomplete: 'off' }), input('surname', 'Last name', { autocomplete: 'off' })),
    input('nickname', 'Nickname', { autocomplete: 'off', placeholder: 'What the family called them, if different' }),
    dateField('birth', 'Born', base.birth),
    placeField('birth_place', 'Birthplace', base.birth_place),
    h('details', { class: 'more', open: f.type === 'edit' }, h('summary', {}, 'More details'),
      h('div', { class: 'stack' },
        h('label', { class: 'field' }, 'Sex', h('select', { name: 'sex' },
          [['', 'Not recorded'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']].map(([v, l]) => h('option', { value: v, selected: (base.sex || '') === v }, l)))),
        dateField('death', 'Died', base.death),
        h('label', { class: 'field' }, 'Notes', h('textarea', { name: 'notes', maxlength: 4000, value: base.notes || '' })),
        h('label', { class: 'field' }, base.photo ? 'Replace photo' : 'Photo', photo))),
    h('div', { class: 'row' }, h('button', { class: 'btn', 'data-submit': true }, submitLabel), h('button', { class: 'btn quiet', type: 'button', onclick: () => { V.form = null; renderPanel(); } }, 'Cancel')));
  queueMicrotask(() => form.elements.given.focus());
  return form;
}

async function savePerson(form, subject) {
  const f = V.form, el = form.elements, button = form.querySelector('[data-submit]');
  const fields = ['given', 'nickname', 'surname', 'sex', 'birth_place', 'notes'];
  const data = { ...(f.type === 'edit' ? subject.data : {}), ...Object.fromEntries(fields.map((k) => [k, el[k].value])) };
  for (const k of ['birth', 'death']) {
    data[k] = parseDate(el[k].value);
    if (data[k] === null) { el[k].focus(); return toast('Enter dates as mm/dd/yyyy, mm/yyyy or just the year', 'error'); }
  }
  if (!T.displayName(data)) return toast('Enter at least a first name, nickname or last name', 'error');
  button.disabled = true;
  try {
    const file = el.photo.files[0];
    if (file) {
      const blob = await resizeImage(file);
      const id = f.type === 'edit' ? subject.id : null;
      const { media } = await api(`/trees/${V.id}/media${id ? `?entity=${id}` : ''}`, { method: 'POST', raw: blob, type: blob.type });
      data.photo = media.id;
    }
  } catch (e) { button.disabled = false; return toast(e.message, 'error'); }

  const name = T.displayName(data);
  let ops, message, focus;
  if (f.type === 'edit') {
    ops = [{ id: subject.id, kind: 'person', base_rev: subject.rev, data }];
    message = `Edited ${name}`;
    focus = subject.id;
  } else {
    const id = crypto.randomUUID();
    const link = (kind, d) => ({ id: crypto.randomUUID(), kind, base_rev: 0, data: d });
    ops = [{ id, kind: 'person', base_rev: 0, data }];
    focus = id;
    const lt = el.ltype?.value;
    if (f.relation === 'first') message = `Added ${name}`;
    if (f.relation === 'child') {
      ops.push(link('parent', { parent: subject.id, child: id, type: lt }));
      if (el.other?.value) ops.push(link('parent', { parent: el.other.value, child: id, type: lt }));
      message = `Added ${name} as a child of ${nameOf(subject)}`;
    }
    if (f.relation === 'parent') {
      ops.push(link('parent', { parent: id, child: subject.id, type: lt }));
      const existing = (T.relatives(V.state).parents.get(subject.id) || [])[0];
      if (el.couple?.checked && existing) ops.push(link('partner', { a: existing.id, b: id, type: 'married' }));
      message = `Added ${name} as a parent of ${nameOf(subject)}`;
    }
    if (f.relation === 'partner') {
      ops.push(link('partner', { a: subject.id, b: id, type: el.ptype.value }));
      for (const c of form.querySelectorAll('[name=coparent]:checked')) ops.push(link('parent', { parent: id, child: c.value, type: 'birth' }));
      message = `Added ${name} as a partner of ${nameOf(subject)}`;
    }
  }
  const done = await commit(message, ops);
  button.disabled = false;
  if (done) { V.form = null; select(focus); }
}

route();
