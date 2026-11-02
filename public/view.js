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
  const textWidth = 144;
  const nameLines = wrapText(name, textWidth, measure);
  const subtitleLines = wrapText(subtitle, textWidth, measure);
  const textHeight = nameLines.length * 20 + subtitleLines.length * 17 + (subtitleLines.length ? 4 : 0);
  const contentHeight = textHeight + (photo ? 52 : 0);
  const width = Math.max(172, Math.hypot(textWidth, contentHeight) + 32);
  const nameY = (width - contentHeight) / 2 + (photo ? 52 : 0) + 15;
  return { width, height: width, textX: width / 2, textWidth, nameLines, subtitleLines, nameY, subtitleY: nameY + nameLines.length * 20 + 4, photoY: (width - contentHeight) / 2 };
}

export const ZOOM_EXTENT = [0.005, 2.5];

export function fitTransform(bounds, width, height) {
  const k = Math.max(ZOOM_EXTENT[0], Math.min(1, (width - 80) / (bounds.width || 1), (height - 80) / (bounds.height || 1)));
  return { x: (width - bounds.width * k) / 2, y: (height - bounds.height * k) / 2, k };
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

const center = (p) => [p.x + p.width / 2, p.y + p.height / 2];

function junction(union, pos) {
  if (pos.has(union.id)) return center(pos.get(union.id));
  const points = [...union.parents, ...union.children].map((id) => center(pos.get(id)));
  return [0, 1].map((axis) => points.reduce((sum, p) => sum + p[axis], 0) / points.length);
}

function circlePort(card, point) {
  const origin = center(card), dx = point[0] - origin[0], dy = point[1] - origin[1];
  const length = Math.hypot(dx, dy) || 1;
  return [origin[0] + dx / length * card.width / 2, origin[1] + dy / length * card.height / 2];
}

function segmentClearance(a, b, card) {
  const c = center(card), dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(c[0] - a[0] - t * dx, c[1] - a[1] - t * dy) - card.width / 2;
}

function closestPoint(points, distance, visited) {
  let best = -1;
  for (let i = 0; i < points.length; i++) if (!visited.has(i) && (best < 0 || distance[i] < distance[best])) best = i;
  return best;
}

function relaxRoutes(current, points, obstacles, distance, previous, visited) {
  for (let next = 0; next < points.length; next++) {
    if (visited.has(next)) continue;
    const cost = distance[current] + Math.hypot(points[next][0] - points[current][0], points[next][1] - points[current][1]);
    if (cost >= distance[next] || obstacles.some((o) => segmentClearance(points[current], points[next], o) < 12)) continue;
    distance[next] = cost;
    previous[next] = current;
  }
}

function shortestRoute(a, b, obstacles, offset) {
  const points = [a, b, ...obstacles.flatMap((o) => Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 6, radius = (o.width / 2 + 18 + offset) / Math.cos(Math.PI / 12), c = center(o);
    return [c[0] + Math.cos(angle) * radius, c[1] + Math.sin(angle) * radius];
  }))];
  const distance = points.map(() => Infinity), previous = [], visited = new Set();
  distance[0] = 0;
  for (;;) {
    const current = closestPoint(points, distance, visited);
    if (current < 0 || distance[current] === Infinity) return [a, b];
    if (current === 1) break;
    visited.add(current);
    relaxRoutes(current, points, obstacles, distance, previous, visited);
  }
  const route = [];
  for (let i = 1; i != null; i = previous[i]) route.unshift(points[i]);
  return route;
}

function routedPoints(card, hub, obstacles, offset) {
  const start = center(card), blockers = new Set();
  let points = [start, hub];
  for (let pass = 0; pass < 12; pass++) {
    const added = obstacles.filter((o) => !blockers.has(o) && points.some((p, i) => i && segmentClearance(points[i - 1], p, o) < 12));
    if (!added.length) break;
    added.forEach((o) => blockers.add(o));
    points = shortestRoute(start, hub, [...blockers], offset);
  }
  points[0] = circlePort(card, points[1]);
  return points;
}

function familySegment(union, id, points, records, people, child = null) {
  const chosen = records.some((e) => e.kind === 'parent' && e.data.type !== 'birth');
  const birth = records.some((e) => e.kind === 'parent' && e.data.type === 'birth');
  return { id: `${union.id}:${id}`, family: union.id, child, a: people[0], b: people.at(-1), people, refs: records.map((e) => e.id), chosen: chosen && !birth, mixed: chosen && birth, points, d: roundedPath(points) };
}

function unionPaths(union, index, graph, pos, links) {
  const hub = junction(union, pos);
  const parents = links.filter((e) => e.kind === 'parent' && union.parents.includes(e.data.parent) && union.children.includes(e.data.child));
  const partner = links.find((e) => e.kind === 'partner' && union.parents.length === 2 && union.parents.includes(e.data.a) && union.parents.includes(e.data.b));
  const route = (id) => routedPoints(pos.get(id), hub, graph.people.filter((p) => p.id !== id).map((p) => pos.get(p.id)), index * 0.13);
  const paths = union.parents.map((p) => {
    const records = parents.filter((e) => e.data.parent === p);
    if (partner) records.push(partner);
    return familySegment(union, `parent:${p}`, route(p), records, [...union.parents, ...union.children]);
  });
  for (const c of union.children) paths.push(familySegment(union, `child:${c}`, route(c).reverse(), parents.filter((e) => e.data.child === c), [...union.parents, c], c));
  return paths;
}

export function connectionPaths(state, graph, pos) {
  const links = [...state.entities.values()].filter((e) => isLive(e) && e.kind !== 'person');
  return graph.unions.flatMap((union, index) => unionPaths(union, index, graph, pos, links));
}
