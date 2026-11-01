// Browser app: screens, tree canvas, replay/generations player, side panel, live polling.
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as T from './tree.js';
import * as G from './view.js';

const UNION = 8, PHOTO = 40, COUPLE_GAP = 28;
const PORTS = ['top', 'bottom', 'left', 'right'];
const PORT_DIR = { top: 'parent', bottom: 'child', left: 'partner', right: 'partner' };
const PORT_HELP = { top: 'Drag to add a parent', bottom: 'Drag to add a child', left: 'Drag to add a partner', right: 'Drag to add a partner' };
const POLL_MS = 5000;
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
// typeToConfirm: the action stays disabled until that exact text is typed.
function ask(title, body, action, { danger = false, dismiss = 'Cancel', typeToConfirm } = {}) {
  return new Promise((resolve) => {
    const yes = h('button', { class: danger ? 'btn danger-solid' : 'btn', value: 'yes', disabled: !!typeToConfirm }, action);
    const typed = typeToConfirm && h('input', { autocomplete: 'off', spellcheck: 'false',
      oninput: (ev) => { yes.disabled = ev.target.value.trim() !== typeToConfirm; } });
    const dlg = h('dialog', { class: 'ask', 'aria-labelledby': 'ask-title' },
      h('form', { method: 'dialog', class: 'stack' },
        h('h2', { id: 'ask-title' }, title),
        h('p', {}, body),
        typed && h('label', { class: 'field' }, `Type ${typeToConfirm} to confirm`, typed),
        h('div', { class: 'row' }, yes,
          h('button', { class: 'btn quiet', value: 'no', autofocus: !typed }, dismiss))));
    if (typed) queueMicrotask(() => typed.focus());
    // Settle on the button press itself rather than the 'close' event, which browsers may defer.
    const done = (answer) => { dlg.close(); dlg.remove(); resolve(answer); };
    dlg.querySelector('form').addEventListener('submit', (ev) => { ev.preventDefault(); done(ev.submitter?.value === 'yes'); });
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); done(false); });
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
const nameOf = (e) => T.displayName(e?.data) || 'Unknown';
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
    me = await api('/me').catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (url.pathname === '/signin' && !me) return loginScreen();
    if (me && !me.user.name) return nameScreen();
    return treeScreen();
  } catch (e) {
    frontScreen(h('div', { class: 'sheet' }, h('h2', {}, 'That didn’t work'), h('p', {}, e.message), h('a', { href: '/', class: 'btn', onclick: (ev) => { ev.preventDefault(); go('/'); } }, 'Go to the tree')));
  }
}

// ---------- front screens ----------

function frontScreen(...content) {
  root.replaceChildren(h('div', { class: 'front ground' }, h('div', { class: 'front-inner' },
    h('div', {}, h('h1', { class: 'wordmark' }, 'Ancestree'), h('p', { class: 'wordmark-sub' }, 'One human tree. Free to view. Open to registered contributors.')),
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
  }, h('h2', {}, 'What name should appear with your edits?'), h('label', { class: 'field' }, 'Your name', name),
  h('p', { class: 'hint' }, 'It appears next to your edits and comments.'), h('button', { class: 'btn' }, 'Save name')));
  name.focus();
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
  quick = null;
  clearInterval(V.pollTimer);
  V.playing = false;
  V = null;
}

const editor = (person) => T.canEdit(me?.user.id, person);

async function treeScreen() {
  const [data] = await Promise.all([api('/tree'), document.fonts.load('600 15px "Atkinson Hyperlegible Next"').catch(() => [])]);
  const state = T.fromRows(data.tree.seq, data.entities), selected = G.defaultFocus(state);
  V = {
    tree: data.tree,
    state, cursor: data.tree.seq,
    replayer: null, logLoading: null,
    mode: 'live', frame: 0, year: null, playing: false, speed: 1,
    selected, tab: selected ? 'person' : 'chat', form: null,
    comments: new Map(), drawn: null, drawToken: 0, fitted: false, sound: true,
    counts: new Map(Object.entries(data.comment_counts)), loadedAt: data.now, noteLive: new Map(),
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
    modeBtn('live', 'Tree'), modeBtn('replay', 'Edits'), modeBtn('generations', 'Timelapse'));
  V.el.svg = d3.create('svg').attr('aria-label', 'Shared human tree');
  V.el.svg.append('defs').html('<clipPath id="avatar" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>');
  V.el.view = V.el.svg.append('g');
  V.el.edges = V.el.view.append('g');
  V.el.people = V.el.view.append('g');
  V.zoom = d3.zoom().scaleExtent([0.15, 2.5]).on('zoom', (ev) => V.el.view.attr('transform', ev.transform));
  V.el.svg.call(V.zoom).on('dblclick.zoom', null);
  V.el.svg.on('click', (ev) => { if (ev.target === V.el.svg.node()) { closeQuickAdd(); select(null); } });
  V.el.empty = h('div', { class: 'empty' });
  V.el.player = h('div', { class: 'player', hidden: true });
  V.el.find = h('select', { class: 'person-picker', 'aria-label': 'Find a person', onchange: (ev) => { if (ev.target.value) select(ev.target.value); ev.target.value = ''; } });
  V.el.overview = h('button', { class: 'btn quiet small', onclick: () => select(null) }, 'Clear selection');
  V.el.sound = h('button', { class: 'btn quiet small', 'aria-pressed': 'true', onclick: () => {
    V.sound = !V.sound;
    V.el.sound.textContent = V.sound ? 'Sound on' : 'Sound off';
    V.el.sound.setAttribute('aria-pressed', String(V.sound));
    if (V.sound) enableAudio();
  } }, 'Sound on');
  V.el.stage = h('main', { class: 'stage ground' }, V.el.svg.node(), V.el.empty, V.el.player);
  V.el.tabs = h('nav', { class: 'tabs', role: 'tablist' });
  V.el.body = h('div', { class: 'panel-body' });
  root.replaceChildren(h('div', { class: 'app' },
    h('header', { class: 'bar' },
      h('a', { class: 'home', href: '/', onclick: (ev) => { ev.preventDefault(); go('/'); } }, 'Ancestree'),
      h('span', { class: 'spacer' }), V.el.find, V.el.overview, V.el.modes, V.el.sound,
      editor() && h('button', { class: 'btn quiet small', onclick: () => { V.selected = null; openForm({ type: 'add', relation: 'first' }); } }, 'Add person'),
      me ? h('button', { class: 'btn quiet small', onclick: signOut }, 'Sign out')
        : h('a', { class: 'btn quiet small', href: '/signin', onclick: (ev) => { ev.preventDefault(); go('/signin'); } }, 'Sign in to edit')),
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
let audio;

function enableAudio() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    audio ||= new Context();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch { return; }
}

document.addEventListener('pointerdown', enableAudio, { once: true });
document.addEventListener('keydown', enableAudio, { once: true });

function popSound() {
  if (!V.sound || !audio || audio.state !== 'running') return;
  const now = audio.currentTime, oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(450, now);
  oscillator.frequency.exponentialRampToValueAtTime(180, now + 0.06);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.045, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.06);
}

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
function elkGraph(g, blocks, cards) {
  const blockOf = new Map(), offset = new Map(), vertical = new Map();
  const heights = blocks.map((members) => Math.max(...members.map((id) => cards.get(id).height)));
  blocks.forEach((members, b) => {
    let x = 0;
    for (const id of members) {
      blockOf.set(id, b);
      offset.set(id, x);
      vertical.set(id, (heights[b] - cards.get(id).height) / 2);
      x += cards.get(id).width + COUPLE_GAP;
    }
  });
  const port = (id, x, y, side) => ({ id, x, y, width: 1, height: 1, layoutOptions: { 'elk.port.side': side } });
  const bottom = blocks.map(() => []);
  const edges = [], unionNodes = [];
  const center = (id) => offset.get(id) + cards.get(id).width / 2;
  for (const u of g.unions) {
    if (!u.children.length) continue;
    const b = blockOf.get(u.parents[0]);
    const together = u.parents.every((p) => blockOf.get(p) === b);
    if (together) {
      const x = u.parents.reduce((sum, id) => sum + center(id), 0) / u.parents.length;
      bottom[b].push(port(`pb:${u.id}`, x, heights[b], 'SOUTH'));
      u.children.forEach((c) => edges.push({ id: `${u.id}>${c}`, sources: [`pb:${u.id}`], targets: [`pt:${c}`] }));
    } else {
      unionNodes.push({ id: u.id, width: UNION, height: UNION });
      u.parents.forEach((p) => {
        const pid = `pb:${u.id}:${p}`;
        bottom[blockOf.get(p)].push(port(pid, center(p), vertical.get(p) + cards.get(p).height, 'SOUTH'));
        edges.push({ id: `${p}>${u.id}`, sources: [pid], targets: [u.id] });
      });
      u.children.forEach((c) => edges.push({ id: `${u.id}>${c}`, sources: [u.id], targets: [`pt:${c}`] }));
    }
  }
  const children = blocks.map((members, b) => ({
    id: `b:${members[0]}`,
    width: members.reduce((sum, id) => sum + cards.get(id).width + COUPLE_GAP, -COUPLE_GAP), height: heights[b],
    layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
    ports: [...members.map((id) => port(`pt:${id}`, center(id), vertical.get(id), 'NORTH')), ...bottom[b]],
  }));
  return { graph: { id: 'root', layoutOptions: ELK_OPTIONS, children: [...children, ...unionNodes], edges }, offset, vertical };
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

async function layoutTree(g, state, cards) {
  elk ||= new window.ELK();
  let blocks = T.partnerBlocks(state, g.people);
  for (let pass = 0; ; pass++) {
    const { graph, offset, vertical } = elkGraph(g, blocks, cards);
    const layout = await elk.layout(graph);
    const pos = new Map();
    for (const n of layout.children) {
      if (n.id.startsWith('b:')) {
        blocks.find((m) => `b:${m[0]}` === n.id).forEach((id) => pos.set(id, { x: n.x + offset.get(id), y: n.y + vertical.get(id), ...cards.get(id) }));
      } else pos.set(n.id, { x: n.x, y: n.y });
    }
    const next = pass === 0 && flipBlocks(blocks, pos, state);
    if (!next) return { layout, pos, blocks };
    blocks = next;
  }
}

function measureCards(people) {
  const context = document.createElement('canvas').getContext('2d');
  context.font = `600 15px ${getComputedStyle(document.body).fontFamily}`;
  const measure = (text) => context.measureText(text).width;
  return new Map(people.map((person) => [person.id, G.cardLayout(fullName(person.data) || 'Unknown', T.lifespan(person.data), Boolean(person.data.photo), measure)]));
}

function cardText(text, lines, x, y, step) {
  text.attr('x', x).attr('y', y).attr('text-anchor', 'middle').selectAll('tspan').data(lines).join('tspan')
    .attr('x', x).attr('dy', (_, i) => i ? step : 0).text((line) => line);
}

async function draw({ highlight = new Set(), duration = 450, fit = false } = {}) {
  const token = ++V.drawToken;
  // Dots for growing the tree only make sense when editing the live tree.
  V.el.stage.classList.toggle('can-grow', editor() && V.mode === 'live');
  const { state, visible } = shownState();
  const g = T.familyGraph(state, visible);
  const layoutGraph = V.mode === 'generations' ? T.familyGraph(state) : g;
  let cached = V.mode === 'generations' && V.generationLayout?.state === state && V.generationLayout;
  if (!cached) {
    const cards = measureCards(layoutGraph.people);
    cached = { state, cards, ...await layoutTree(layoutGraph, state, cards) };
    if (V && token === V.drawToken && V.mode === 'generations') V.generationLayout = cached;
  }
  if (!V || token !== V.drawToken) return;
  const { cards, layout, pos } = cached;
  const previous = V.renderedIds;
  const incoming = previous ? g.people.filter((p) => !previous.has(p.id)) : [];
  const relationships = T.relatives(state);
  if (incoming.length && (V.mode !== 'generations' || (V.lastGenerationYear != null && V.year > V.lastGenerationYear))) popSound();
  V.renderedIds = new Set(g.people.map((p) => p.id));
  if (V.mode === 'generations') V.lastGenerationYear = V.year;
  V.cards = cards;
  V.pos = pos;
  fill(V.el.find, h('option', { value: '' }, 'Find a person…'), g.people.map((p) => h('option', { value: p.id }, fullName(p.data) || 'Unknown')));
  const t = d3.transition().duration(reduceMotion ? 0 : duration).ease(d3.easeCubicInOut);
  const visiblePos = new Map(g.people.map((p) => [p.id, pos.get(p.id)]));
  const edgeData = G.connectionPaths(state, g, visiblePos);
  V.el.edges.selectAll('path').data(edgeData, (d) => d.id).join(
    (enter) => enter.append('path').attr('class', 'edge').attr('d', (d) => d.d).attr('opacity', 0).call((s) => s.transition(t).attr('opacity', 1)),
    (update) => update.classed('exiting', false).call((s) => s.transition(t).attr('d', (d) => d.d).attr('opacity', 1)),
    (exit) => exit.classed('exiting', true).call((s) => s.transition(t).style('opacity', 0).remove()),
  ).classed('chosen', (d) => !!d.chosen).classed('mixed', (d) => !!d.mixed);

  const at = (d) => `translate(${pos.get(d.id).x},${pos.get(d.id).y})`;
  V.el.people.selectAll('g.person').data(g.people, (d) => d.id).join(
    (enter) => enter.append('g').attr('class', 'person').attr('tabindex', 0).attr('role', 'button')
      .attr('transform', (d) => {
        const card = cards.get(d.id), relative = previous && G.arrivalOrigin(relationships, d.id, previous);
        const origin = V.spawn?.id === d.id ? V.spawn : pos.get(relative);
        return origin ? `translate(${origin.x + (origin.width || 0) / 2 - card.width * 0.15},${origin.y + (origin.height || 0) / 2 - card.height * 0.15}) scale(0.3)` : at(d);
      })
      .on('click', (ev, d) => { ev.stopPropagation(); select(d.id); })
      .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(d.id); } })
      .call((s) => {
        const body = s.append('g').attr('class', 'appearance').attr('opacity', 0);
        body.append('rect').attr('rx', 10);
        body.append('image').attr('x', 9).attr('width', PHOTO).attr('height', PHOTO).attr('clip-path', 'url(#avatar)').attr('preserveAspectRatio', 'xMidYMid slice');
        body.append('text').attr('class', 'name').attr('y', 25);
        body.append('text').attr('class', 'years').attr('y', 43);
        body.append('text').attr('class', 'lock').attr('text-anchor', 'end');
        s.append('title');
        const b = body.append('g').attr('class', 'badge').attr('aria-hidden', 'true');
        b.append('circle').attr('r', 11);
        b.append('text').attr('text-anchor', 'middle').attr('dy', 4);
        for (const side of PORTS) {
          const port = body.append('g').attr('class', `port ${side}`)
            .on('click', (ev) => ev.stopPropagation()).call(portDrag(side));
          port.append('circle').attr('class', 'hit').attr('r', 16);
          port.append('circle').attr('class', 'dot').attr('r', 6);
          port.append('title').text(PORT_HELP[side]);
        }
        body.transition(t).attr('opacity', 1);
      })
      .call((s) => s.transition(t).attr('transform', at)),
    (update) => update.classed('exiting', false).style('pointer-events', null).call((s) => { s.select('.appearance').transition(t).attr('opacity', 1); s.transition(t).attr('transform', at); }),
    (exit) => exit.classed('exiting', true).attr('aria-hidden', 'true').attr('tabindex', -1).style('pointer-events', 'none')
      .call((s) => { s.select('.appearance').transition(t).attr('opacity', 0); s.transition(t).remove(); }),
  ).each(function (d) {
    const g = d3.select(this), photo = d.data.photo, card = cards.get(d.id);
    g.classed('editable', editor(d));
    g.select('rect').attr('width', card.width).attr('height', card.height);
    g.select('.lock').attr('x', card.width - 10).attr('y', card.height - 7).text(d.data.locked ? 'Locked' : '');
    g.select('.badge').attr('transform', `translate(${card.width - 4},4)`);
    for (const [side, x, y] of G.ports(card)) g.select(`.port.${side}`).attr('transform', `translate(${x},${y})`);
    setBadge(g, d);
    g.select('image').attr('y', (card.height - PHOTO) / 2).attr('href', photo ? `/api/tree/media/${photo}` : null).attr('display', photo ? null : 'none');
    cardText(g.select('.name'), card.nameLines, card.textX, card.nameY, 20);
    cardText(g.select('.years'), card.subtitleLines, card.textX, card.subtitleY, 17);
    g.classed('lit', false);
    if (highlight.has(d.id)) {
      void this.getBoundingClientRect(); // restart the expose animation
      g.classed('lit', true);
    }
  });
  colorPeople(state, visible);

  V.spawn = null;
  renderEmpty(g.people.length);
  if (fit || !V.fitted) { fitView(layout, duration, visible); V.fitted = true; }
  V.pos = pos;
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

// ---------- growing the tree from a card's dots ----------

// Drag from a dot: a line follows the pointer. Drop on a card to link that person, or anywhere
// else (or just click the dot) to create someone new there.
function portDrag(side) {
  let line, origin, from, target;
  const curve = (x, y) => `M${origin[0]},${origin[1]}C${origin[0]},${(origin[1] + y) / 2} ${x},${(origin[1] + y) / 2} ${x},${y}`;
  const sideCurve = (x, y) => `M${origin[0]},${origin[1]}C${(origin[0] + x) / 2},${origin[1]} ${(origin[0] + x) / 2},${y} ${x},${y}`;
  const path = (x, y) => (side === 'left' || side === 'right' ? sideCurve(x, y) : curve(x, y));
  return d3.drag()
    .filter((ev, d) => editor(d) && V.mode === 'live' && !ev.button)
    .container(() => V.el.view.node())
    .on('start', function (ev, d) {
      closeQuickAdd();
      from = d.id;
      const p = V.pos.get(d.id), [, px, py] = G.ports(V.cards.get(d.id)).find(([s]) => s === side);
      origin = [p.x + px, p.y + py];
      line = V.el.view.append('path').attr('class', 'drag-line').attr('d', path(...origin));
      target = null;
    })
    .on('drag', (ev) => {
      line.attr('d', path(ev.x, ev.y));
      const el = document.elementFromPoint(ev.sourceEvent.clientX, ev.sourceEvent.clientY)?.closest('g.person');
      const over = el && d3.select(el).datum().id !== from ? d3.select(el).datum().id : null;
      if (over !== target) {
        V.el.people.selectAll('g.person').classed('drop-target', (p) => p.id === over);
        target = over;
      }
    })
    .on('end', (ev) => {
      V.el.people.selectAll('g.person').classed('drop-target', false);
      const moved = Math.hypot(ev.x - origin[0], ev.y - origin[1]) > 8;
      if (target) { line.remove(); return linkPeople(from, PORT_DIR[side], target); }
      // A click (or a short drag) places the new card a step away in that direction.
      const step = { top: [0, -120], bottom: [0, 120], left: [-V.cards.get(from).width - 60, 0], right: [V.cards.get(from).width + 60, 0] }[side];
      const at = moved ? [ev.x, ev.y] : [origin[0] + step[0], origin[1] + step[1]];
      line.attr('d', path(...at));
      openQuickAdd(from, PORT_DIR[side], at, line);
    });
}

const RELATION_WORD = { parent: 'a parent', child: 'a child', partner: 'a partner' };

async function linkPeople(from, dir, to) {
  const a = nameOf(V.state.entities.get(from)), b = nameOf(V.state.entities.get(to));
  let ops;
  try { ops = T.relateOps(V.state, from, dir, to, () => crypto.randomUUID()); } catch (e) { return toast(e.message, 'error'); }
  if (await commit(`Linked ${b} as ${RELATION_WORD[dir]} of ${a}`, ops)) toast(`${b} is now ${RELATION_WORD[dir]} of ${a}`);
}

let quick = null; // the open quick-add card: { el, line }

function closeQuickAdd() {
  if (!quick) return;
  quick.el.remove();
  quick.line.remove();
  quick = null;
}

// A small card at the drop point asking for a name; Enter adds the person, Escape cancels.
function openQuickAdd(from, dir, [x, y], line) {
  const subject = V.state.entities.get(from).data;
  const tr = d3.zoomTransform(V.el.svg.node()), { width, height } = V.el.svg.node().getBoundingClientRect();
  // Keep the whole card inside the canvas even when the drop was near an edge.
  const clamp = (v, half, max) => Math.min(Math.max(v, half + 8), max - half - 8);
  const [px, py] = tr.apply([x, y]), sx = clamp(px, 120, width), sy = clamp(py, 80, height);
  const first = h('input', { name: 'given', placeholder: 'First name', autocomplete: 'off', 'aria-label': 'First name' });
  const last = h('input', { name: 'surname', placeholder: 'Last name', autocomplete: 'off', 'aria-label': 'Last name',
    value: dir === 'child' ? subject.surname || '' : '' });
  const form = h('form', {
    class: 'quick-add', style: `left:${sx}px;top:${sy}px`,
    onsubmit: async (ev) => {
      ev.preventDefault();
      const data = { given: first.value, surname: last.value };
      if (!T.displayName(data)) return first.focus();
      const id = crypto.randomUUID();
      let ops;
      try { ops = [{ id, kind: 'person', base_rev: 0, data }, ...T.relateOps(V.state, from, dir, id, () => crypto.randomUUID())]; } catch (e) { return toast(e.message, 'error'); }
      V.spawn = { id, x, y };
      closeQuickAdd();
      if (await commit(`Added ${T.displayName(data)} as ${RELATION_WORD[dir]} of ${T.displayName(subject)}`, ops)) select(id);
    },
    onkeydown: (ev) => { if (ev.key === 'Escape') closeQuickAdd(); },
  },
  h('p', { class: 'quick-title' }, `New ${dir} of ${T.displayName(subject) || 'this person'}`),
  h('div', { class: 'quick-names' }, first, last),
  h('div', { class: 'row' }, h('button', { class: 'btn small' }, 'Add'), h('button', { class: 'btn quiet small', type: 'button', onclick: closeQuickAdd }, 'Cancel')));
  V.el.stage.append(form);
  quick = { el: form, line };
  first.focus();
}

function fitView(layout, duration, visible) {
  const { width, height } = V.el.svg.node().getBoundingClientRect();
  if (!width || !layout.width) return;
  const playerSpace = V.mode === 'live' ? 0 : 150;
  const pad = 40;
  const focus = (!visible || visible.has(V.selected)) && V.pos.get(V.selected);
  if (focus) {
    const k = Math.min(1, (width - pad * 2) / focus.width);
    const next = d3.zoomIdentity.translate(width / 2 - (focus.x + focus.width / 2) * k, (height - playerSpace) / 2 - (focus.y + focus.height / 2) * k).scale(k);
    V.el.svg.transition().duration(reduceMotion ? 0 : duration).call(V.zoom.transform, next);
    return;
  }
  const k = Math.max(0.8, Math.min(1.1, (width - pad * 2) / layout.width, (height - playerSpace - pad * 2) / layout.height));
  const x = (width - layout.width * k) / 2, y = (height - playerSpace - layout.height * k) / 2;
  V.el.svg.transition().duration(reduceMotion ? 0 : duration).call(V.zoom.transform, d3.zoomIdentity.translate(x, y).scale(k));
}

function renderEmpty(count) {
  if (count) { V.el.empty.hidden = true; return; }
  V.el.empty.hidden = false;
  let msg;
  if (V.mode === 'replay') msg = V.frame === 0 ? 'Before the first edit. Press play to watch the tree grow.' : 'Nobody was in the tree at this step.';
  else if (V.mode === 'generations') msg = V.years?.size ? 'Nobody with a known birth year yet. Move the slider forward.' : 'Add birth years to watch the tree grow in the timelapse.';
  else msg = editor() ? 'Start with yourself, or the oldest relative you know.' : 'Nobody has been added to this tree yet.';
  V.el.empty.replaceChildren(h('div', {}, h('p', {}, msg),
    V.mode === 'live' && editor() && h('button', { class: 'btn', onclick: () => openForm({ type: 'add', relation: 'first' }) }, 'Add the first person')));
}

function select(id) {
  V.selected = id;
  V.form = null;
  V.tab = id ? 'person' : 'chat';
  V.el.people.selectAll('g.person').classed('selected', (d) => d.id === id);
  const shown = shownState();
  colorPeople(shown.state, shown.visible);
  renderPanel();
}

function colorPeople(state, visible) {
  const focus = T.isLive(state.entities.get(V.selected)) && (!visible || visible.has(V.selected)) ? V.selected : null;
  const distances = T.relationshipDistances(state, focus);
  const siblings = G.siblingHighlights(state, focus);
  const colors = V.colorState?.pos === V.pos ? V.colorState.colors : new Map([...V.pos].filter(([, p]) => p.width).map(([id, p]) => [id, G.fieldColor(p.x + p.width / 2, p.y + p.height / 2)]));
  V.colorState = { pos: V.pos, colors };
  const filter = (id) => G.distanceFilter(distances.get(id), Boolean(focus));
  const from = nameOf(state.entities.get(focus));
  V.el.people.selectAll('g.person:not(.exiting)').each(function (d) {
    const distance = distances.get(d.id);
    const label = focus ? (distance == null ? `No recorded path to ${from}` : `${distance} relationship links from ${from}`) : 'Select this person to focus the tree';
    const g = d3.select(this);
    g.classed('selected', d.id === focus).classed('sibling', siblings.people.has(d.id))
      .style('--relation-color', G.colorCss(colors.get(d.id)))
      .attr('data-distance', distance).attr('tabindex', 0).attr('aria-hidden', null);
    g.select('rect').style('filter', siblings.people.has(d.id) ? 'none' : filter(d.id));
    g.attr('aria-label', `${fullName(d.data) || 'Unknown'}. ${label}.${d.data.locked ? ' Locked.' : ''}`);
    g.select('title').text(`${fullName(d.data) || 'Unknown'}: ${label}${d.data.locked ? '. Locked' : ''}`);
  });
  const highlighted = (d) => d.people.includes(focus) || d.refs.some((id) => siblings.edges.has(id));
  V.el.edges.selectAll('path:not(.exiting)').classed('highlighted', highlighted)
    .style('filter', (d) => highlighted(d) ? 'none' : G.distanceFilter(Math.max(distances.get(d.a) ?? Infinity, distances.get(d.b) ?? Infinity), Boolean(focus)))
    .style('--edge-color', (d) => G.colorCss([0, 1, 2].map((axis) => ((colors.get(d.a) || [0.8, 0, 0])[axis] + (colors.get(d.b) || [0.8, 0, 0])[axis]) / 2)));
  V.el.edges.selectAll('.highlighted').raise();
  V.el.overview.disabled = !focus;
}

async function toggleLock(person) {
  if (await commit(person.data.locked ? 'Unlocked node' : 'Locked node', [{
    id: person.id, kind: 'person', base_rev: person.rev, data: { ...person.data, locked: !person.data.locked },
  }])) renderPanel();
}

// ---------- modes: replay and generations ----------

async function loadLog() {
  V.logLoading ||= (async () => {
    const replayer = new T.Replayer();
    let after = 0, more = true;
    while (more) {
      const r = await api(`/tree/log?after=${after}`);
      r.changesets.forEach((cs) => replayer.push(cs));
      after = r.changesets.at(-1)?.seq ?? after;
      more = r.more;
    }
    V.replayer = replayer;
  })();
  return V.logLoading;
}

async function setMode(mode) {
  closeQuickAdd();
  V.playing = false;
  V.mode = mode;
  V.lastGenerationYear = null;
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
    if (!V.yearRange) { fill(c, h('span', { class: 'what' }, 'Add birth years to people to play the timelapse.')); return; }
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
    const { changeset } = await api(`/tree/changesets`, { method: 'POST', body: { message, ops } });
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
      const r = await api(`/tree/changes?since=${cur.cursor}`);
      if (cur !== V) return;
      ingest(r.changesets, r.comments);
      cur.cursor = r.next;
      more = r.more;
    }
  } catch (e) {
    if (e.status === 401) location.assign('/');
    if (e.status === 404 && cur === V) toast('The tree could not be loaded', 'error');
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
    ['chat', 'Chat'], ['history', 'History'],
  ].filter(Boolean);
  V.el.tabs.replaceChildren(...tabs.map(([key, label]) => h('button', {
    // The first-person form belongs to no tab.
    role: 'tab', 'aria-selected': String(V.tab === key && V.form?.relation !== 'first'),
    onclick: () => { V.tab = key; V.form = null; renderPanel(); },
  }, clip(label, 18))));
  const body = V.form ? formView() : { person: personView, chat: chatView, history: historyView }[V.tab]();
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
      d.photo && h('img', { class: 'portrait', src: `/api/tree/media/${d.photo}`, alt: `Photo of ${nameOf(p)}` }),
      h('h2', {}, fullName(d) || 'Unknown'),
      h('div', { class: 'facts' }, fact('Born', d.birth, d.birth_place), fact('Died', d.death)),
      d.notes && h('p', { class: 'notes' }, d.notes)),
    editor(p) && V.mode === 'live' && h('div', { class: 'actions' },
      h('button', { class: 'btn small', onclick: () => openForm({ type: 'edit' }) }, 'Edit details'),
      h('button', { class: 'btn quiet small', onclick: () => openForm({ type: 'add', relation: 'parent' }) }, 'Add parent'),
      h('button', { class: 'btn quiet small', onclick: () => openForm({ type: 'add', relation: 'partner' }) }, 'Add partner'),
      h('button', { class: 'btn quiet small', onclick: () => openForm({ type: 'add', relation: 'child' }) }, 'Add child')),
    editor(p) && h('p', { class: 'hint' }, 'Tip: drag from the dots on a card to add relatives. Drop on another card to link two people.'),
    h('p', { class: 'hint' }, d.locked ? 'Locked. Only the node creator can edit this person and their relationships.' : 'Open to edits by any registered user.'),
    me?.user.id === p.created_by && V.mode === 'live' && h('button', { class: 'btn quiet small', onclick: () => toggleLock(p) }, d.locked ? 'Unlock node' : 'Lock node'),
    kin.length > 0 && h('section', { class: 'section' }, h('h3', {}, 'Family'), h('ul', { class: 'kin' }, kin)),
    threadSection(p.id, `Comments about ${T.displayName(d) || 'this person'}`, 'Share a memory or ask a question'),
    editor(p) && V.mode === 'live' && h('div', {}, h('button', { class: 'btn danger small', onclick: () => removePerson(p) }, 'Remove from tree')),
  ];
}

async function removePerson(p) {
  if (!(await ask(`Remove ${nameOf(p)}?`, `${nameOf(p)} and their relationships will be removed from the tree. You can undo this from History.`, 'Remove from tree', { danger: true }))) return;
  if (await commit(`Removed ${nameOf(p)}`, T.deleteOps(V.state, p.id))) select(null);
}

function chatView() {
  return [
    h('p', { class: 'hint' }, 'Discuss the shared tree. Select a person to comment on them.'),
    threadSection(null, 'Chat', 'Write a public message'),
  ];
}

function threadSection(targetId, title, placeholder) {
  const key = targetId || '';
  const box = h('section', { class: 'section' }, h('h3', {}, title));
  const list = V.comments.get(key);
  if (!list) {
    box.append(h('p', { class: 'hint' }, 'Loading comments…'));
    api(`/tree/comments${targetId ? `?target=${targetId}` : ''}`).then(({ comments }) => {
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
    me ? composer(targetId, null, placeholder) : h('p', { class: 'hint' }, h('a', { href: '/signin' }, 'Sign in to comment')));
  return box;
}

function noteView(n, targetId) {
  const mine = n.user_id === me?.user.id;
  const wrap = h('div', {});
  const tools = h('div', { class: 'note-tools' },
    me && !n.parent_id && h('button', {
      class: 'link', onclick: () => {
        const open = wrap.querySelector('.composer');
        if (open) return open.querySelector('textarea').focus();
        const reply = composer(targetId, n.id, `Reply to ${n.user_name}`, () => reply.remove());
        tools.after(reply);
      },
    }, 'Reply'),
    mine && h('button', { class: 'link', onclick: () => editNote(wrap, n) }, 'Edit'),
    mine && h('button', { class: 'link', onclick: () => deleteNote(n) }, 'Delete'));
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
        const { comment } = await api(`/tree/comments`, { method: 'POST', body: { target: targetId, parent: parentId, body: text.value } });
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
        await api(`/tree/comments/${n.id}`, { method: 'PATCH', body: { body: text.value } });
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
    await api(`/tree/comments/${n.id}`, { method: 'DELETE' });
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
        h('button', { class: 'link', onclick: async () => { await setMode('replay'); seek(i, 300); } }, 'Show in Edits'),
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

  const title = f.type === 'edit' ? `Edit ${nameOf(subject)}` : f.relation === 'first' ? 'Add a person'
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
      const { media } = await api(`/tree/media${id ? `?entity=${id}` : ''}`, { method: 'POST', raw: blob, type: blob.type });
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
