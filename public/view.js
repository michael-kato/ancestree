import { isLive, relatives } from './tree.js';
import { palette } from './palette.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function arrivalOrigin(relationships, id, existing) {
  for (const group of [relationships.parents, relationships.partners, relationships.children]) {
    const match = (group.get(id) || []).find((relative) => existing.has(relative.id));
    if (match) return match.id;
  }
  return null;
}

export function siblingHighlights(state, id) {
  const { parents, children } = relatives(state);
  const people = new Set(), edges = new Set();
  for (const parent of parents.get(id) || []) {
    for (const child of children.get(parent.id) || []) {
      if (child.id !== id && isLive(state.entities.get(child.id))) {
        people.add(child.id);
        edges.add(child.edge);
      }
    }
  }
  return { people, edges };
}

export function wrapText(text, width, measure) {
  const lines = [];
  let line = '';
  for (const { segment } of segmenter.segment(text)) {
    if (line && measure(line + segment) > width) {
      const space = line.lastIndexOf(' ');
      const end = space > 0 ? space : line.length;
      lines.push(line.slice(0, end).trimEnd());
      line = line.slice(end).trimStart();
    }
    line += segment;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

export function cardLayout(name, subtitle, photo, measure) {
  const padding = photo ? 60 : 16;
  const width = Math.max(188, Math.min(340, Math.max(measure(name), measure(subtitle)) + padding * 2));
  const textX = width / 2, textWidth = width - padding * 2;
  const nameLines = wrapText(name, textWidth, measure);
  const subtitleLines = wrapText(subtitle, textWidth, measure);
  const textHeight = nameLines.length * 20 + subtitleLines.length * 17 + (subtitleLines.length ? 4 : 0);
  const height = Math.max(76, textHeight + 40);
  const nameY = (height - textHeight) / 2 + 15;
  return { width, height, textX, textWidth, nameLines, subtitleLines, nameY, subtitleY: nameY + nameLines.length * 20 + 4 };
}

export const ports = ({ width, height }) => [['top', width / 2, 0], ['bottom', width / 2, height], ['left', 0, height / 2], ['right', width, height / 2]];
export function distanceFilter(distance, focused) {
  if (!focused || distance <= 1) return 'none';
  const amount = Math.min(1, ((distance ?? 4) - 1) / 3);
  return `saturate(${(1 - amount * 0.55).toFixed(2)}) brightness(${distanceBrightness(distance, focused).toFixed(2)})`;
}

export const distanceBrightness = (distance, focused) => !focused || distance <= 1 ? 1 : 1 - Math.min(1, ((distance ?? 4) - 1) / 3) * 0.15;

export function defaultFocus(state) {
  const { parents, children, partners } = relatives(state);
  const degree = (id) => (parents.get(id) || []).length + (children.get(id) || []).length + (partners.get(id) || []).length;
  const people = [...state.entities.values()].filter((e) => isLive(e) && e.kind === 'person');
  return people.sort((a, b) => degree(b.id) - degree(a.id) || a.id.localeCompare(b.id))[0]?.id ?? null;
}

function toOklab(hex) {
  const [r,g,b] = hex.slice(1).match(/../g).map((n) => parseInt(n,16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [0.2104542553*l + 0.793617785*m - 0.0040720468*s, 1.9779984951*l - 2.428592205*m + 0.4505937099*s, 0.0259040371*l + 0.7827717662*m - 0.808675766*s];
}

const paletteLab = palette.map(toOklab);

function cellHash(x, y, salt) {
  let n = Math.imul(x ^ salt, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
}

export function fieldColor(x, y) {
  const px = x / 1000, py = y / 650, gx = Math.floor(px), gy = Math.floor(py);
  const mixed = [0, 0, 0];
  let total = 0;
  for (let i = gx - 2; i <= gx + 2; i++) for (let j = gy - 2; j <= gy + 2; j++) {
    const ax = i + 0.2 + 0.6 * cellHash(i,j,1) / 4294967296;
    const ay = j + 0.2 + 0.6 * cellHash(i,j,2) / 4294967296;
    const distance = Math.hypot(px - ax, py - ay);
    if (distance >= 2) continue;
    const weight = (1 - distance / 2) ** 2 / (distance ** 2 + 0.0001);
    const color = paletteLab[cellHash(i,j,3) % paletteLab.length];
    for (let axis = 0; axis < 3; axis++) mixed[axis] += color[axis] * weight;
    total += weight;
  }
  const color = mixed.map((v) => v / total);
  color[0] = Math.max(0.86, color[0]);
  return color;
}

export const colorCss = ([l, a, b] = [0.8, 0, 0]) => `oklab(${l.toFixed(6)} ${a.toFixed(6)} ${b.toFixed(6)})`;

export function roundedPath(points, radius = 12) {
  const clean = points.filter((p, i) => !i || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  if (!clean.length) return '';
  let path = `M${clean[0]}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const [prev, current, next] = clean.slice(i - 1, i + 2);
    const incoming = Math.hypot(prev[0] - current[0], prev[1] - current[1]);
    const outgoing = Math.hypot(next[0] - current[0], next[1] - current[1]);
    const r = Math.min(radius, incoming / 2, outgoing / 2);
    const towards = (p, length) => current.map((v, axis) => v + (p[axis] - v) * r / length);
    path += `L${towards(prev, incoming)}Q${current} ${towards(next, outgoing)}`;
  }
  return clean.length > 1 ? `${path}L${clean.at(-1)}` : path;
}

export function siblingTracks(descents) {
  const tracks = new Map(), byLayer = new Map();
  for (const d of descents) {
    const xs = [d.sx, ...d.kids.map((k) => k.x)];
    d.span = [Math.min(...xs), Math.max(...xs)];
    const layer = Math.round(Math.min(...d.kids.map((k) => k.y)));
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(d);
  }
  for (const group of byLayer.values()) {
    const ends = [];
    for (const d of group.sort((a, b) => a.span[0] - b.span[0])) {
      let t = ends.findIndex((end) => end + 12 < d.span[0]);
      if (t < 0 || t >= 4) t = ends.length < 4 ? ends.length : ends.indexOf(Math.min(...ends));
      ends[t] = Math.max(ends[t] ?? -Infinity, d.span[1]);
      tracks.set(d, t);
    }
  }
  return tracks;
}

export function connectionPaths(state, graph, pos) {
  const center = (p) => p.x + p.width / 2;
  const links = [...state.entities.values()].filter((e) => isLive(e) && e.kind !== 'person');
  const pairs = new Map(links.filter((e) => e.kind === 'partner').map((e) => [[e.data.a, e.data.b].sort().join('\0'), e]));
  const parents = new Map(links.filter((e) => e.kind === 'parent').map((e) => [`${e.data.parent}\0${e.data.child}`, e]));
  const paths = links.filter((e) => e.kind === 'partner' && pos.has(e.data.a) && pos.has(e.data.b)).map((e) => ({
    id: e.id, a: e.data.a, b: e.data.b, people: [e.data.a, e.data.b], refs: [e.id], d: roundedPath(partnerPoints(pos.get(e.data.a), pos.get(e.data.b))),
  }));
  const descents = graph.unions.filter((u) => u.children.length).map((u) => ({
    union: u, sx: u.parents.reduce((sum, id) => sum + center(pos.get(id)), 0) / u.parents.length,
    kids: u.children.map((c) => ({ c, x: center(pos.get(c)), y: pos.get(c).y })),
  }));
  const tracks = siblingTracks(descents);
  for (const descent of descents) paths.push(...unionPaths(descent, tracks.get(descent), pos, pairs, parents));
  return paths;
}

function unionPaths({ union, kids }, track, pos, pairs, parents) {
  const center = (p) => p.x + p.width / 2;
  const refs = union.parents.flatMap((p) => union.children.map((c) => parents.get(`${p}\0${c}`))).filter(Boolean);
  const trackY = Math.min(...kids.map((k) => k.y)) - 14 - track * 9;
  const { partner, sx, joinY } = unionJunction(union, pos, pairs, trackY);
  const paths = [];
  const add = (id, vertices, records, participants) => paths.push(unionSegment(union, id, vertices, records, participants));
  if (!partner) {
    for (const p of union.parents) {
      const card = pos.get(p);
      add(`parent:${p}`, [[center(card), card.y + card.height], [center(card), joinY]], refs.filter((e) => e.data.parent === p));
    }
    if (union.parents.length > 1) {
      const xs = union.parents.map((p) => center(pos.get(p)));
      add('parents', [[Math.min(...xs), joinY], [Math.max(...xs), joinY]], refs);
    }
  }
  add('stem', [[sx, joinY], [sx, trackY]], refs);
  const xs = [sx, ...kids.map((k) => k.x)];
  if (Math.min(...xs) !== Math.max(...xs)) add('bar', [[Math.min(...xs), trackY], [Math.max(...xs), trackY]], refs);
  for (const k of kids) add(`child:${k.c}`, [[k.x, trackY], [k.x, k.y]], refs.filter((e) => e.data.child === k.c), [...union.parents, k.c]);
  return paths;
}

function unionJunction(union, pos, pairs, trackY) {
  const partner = union.parents.length === 2 && pairs.get(union.parents.join('\0'));
  const points = partner && partnerPoints(pos.get(partner.data.a), pos.get(partner.data.b));
  const mid = points && points.length === 2 ? [0, 1].map((axis) => (points[0][axis] + points[1][axis]) / 2)
    : points && [0, 1].map((axis) => (points[1][axis] + points[2][axis]) / 2);
  const sx = mid ? mid[0] : union.parents.reduce((sum, p) => sum + pos.get(p).x + pos.get(p).width / 2, 0) / union.parents.length;
  const joinY = mid ? mid[1] : Math.min(trackY - 8, Math.max(...union.parents.map((p) => pos.get(p).y + pos.get(p).height)) + 20);
  return { partner, sx, joinY };
}

function unionSegment(union, id, vertices, records, participants = [...union.parents, ...union.children]) {
  const chosen = records.some((e) => e.data.type !== 'birth');
  return { id: `${union.id}:${id}`, a: union.parents[0], b: union.children[0], people: participants, refs: records.map((e) => e.id), chosen: chosen && records.every((e) => e.data.type !== 'birth'), mixed: chosen && records.some((e) => e.data.type === 'birth'), d: roundedPath(vertices) };
}

function partnerPoints(A, B) {
  const [L, R] = A.x < B.x ? [A, B] : [B, A];
  const center = (p) => p.x + p.width / 2;
  return R.x - L.x - L.width > 29
    ? [[center(L), L.y], [center(L), L.y - 24], [center(R), R.y - 24], [center(R), R.y]]
    : [[L.x + L.width, L.y + L.height / 2], [R.x, R.y + R.height / 2]];
}
