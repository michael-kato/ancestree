import { isLive, relatives } from './tree.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function arrivalOrigin(relationships, id, existing) {
  for (const group of [relationships.parents, relationships.partners, relationships.children]) {
    const match = (group.get(id) || []).find((relative) => existing.has(relative.id));
    if (match) return match.id;
  }
  return null;
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
  const textX = photo ? 60 : 16;
  const width = Math.max(188, Math.min(340, Math.max(measure(name), measure(subtitle)) + textX + 16));
  const nameLines = wrapText(name, width - textX - 16, measure);
  const subtitleLines = wrapText(subtitle, width - textX - 16, measure);
  const textHeight = nameLines.length * 20 + subtitleLines.length * 17 + (subtitleLines.length ? 4 : 0);
  const height = Math.max(76, textHeight + 40);
  const nameY = (height - textHeight) / 2 + 15;
  return { width, height, textX, nameLines, subtitleLines, nameY, subtitleY: nameY + nameLines.length * 20 + 4 };
}

export const ports = ({ width, height }) => [['top', width / 2, 0], ['bottom', width / 2, height], ['left', 0, height / 2], ['right', width, height / 2]];
export const nodeOpacity = (distance, focused) => focused ? ([1, 1, 0.8, 0.5, 0.24][distance] ?? 0) : 1;

export function defaultFocus(state) {
  const { parents, children, partners } = relatives(state);
  const degree = (id) => (parents.get(id) || []).length + (children.get(id) || []).length + (partners.get(id) || []).length;
  const people = [...state.entities.values()].filter((e) => isLive(e) && e.kind === 'person');
  return people.sort((a, b) => degree(b.id) - degree(a.id) || a.id.localeCompare(b.id))[0]?.id ?? null;
}

function anchorColor(id) {
  let hash = 2166136261;
  for (const letter of id) hash = Math.imul(hash ^ letter.codePointAt(0), 16777619);
  const angle = (hash >>> 0) / 4294967296 * Math.PI * 2;
  return [Math.cos(angle) * 0.1, Math.sin(angle) * 0.1];
}

export function branchColors(state) {
  const { parents, children } = relatives(state);
  const people = [...state.entities.values()].filter((e) => isLive(e) && e.kind === 'person');
  const pending = new Map(people.map((p) => [p.id, (parents.get(p.id) || []).length]));
  const queue = people.filter((p) => !pending.get(p.id)).map((p) => p.id);
  const colors = new Map();
  for (const id of queue) {
    const inherited = (parents.get(id) || []).map((p) => colors.get(p.id));
    colors.set(id, inherited.length ? [0, 1].map((axis) => inherited.reduce((sum, c) => sum + c[axis], 0) / inherited.length) : anchorColor(id));
    for (const child of children.get(id) || []) {
      pending.set(child.id, pending.get(child.id) - 1);
      if (!pending.get(child.id)) queue.push(child.id);
    }
  }
  return colors;
}

export const colorCss = ([a, b] = [0, 0]) => `oklab(80% ${a.toFixed(6)} ${b.toFixed(6)})`;

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
  const descents = graph.unions.filter((u) => u.children.length).map((u) => ({
    sx: u.parents.reduce((sum, id) => sum + center(pos.get(id)), 0) / u.parents.length,
    kids: u.children.map((c) => ({ c, x: center(pos.get(c)), y: pos.get(c).y })),
  }));
  const tracks = siblingTracks(descents);
  const lift = new Map(descents.flatMap((d) => d.kids.map((k) => [k.c, 14 + tracks.get(d) * 9])));
  const paths = [];
  for (const edge of state.entities.values()) {
    if (!isLive(edge) || edge.kind === 'person') continue;
    const [a, b] = edge.kind === 'parent' ? [edge.data.parent, edge.data.child] : [edge.data.a, edge.data.b];
    if (!pos.has(a) || !pos.has(b)) continue;
    const A = pos.get(a), B = pos.get(b);
    let points;
    if (edge.kind === 'parent') {
      const y = B.y - lift.get(b);
      points = [[center(A), A.y + A.height], [center(A), y], [center(B), y], [center(B), B.y]];
    } else {
      points = partnerPoints(A, B);
    }
    paths.push({ id: edge.id, a, b, d: roundedPath(points), chosen: edge.kind === 'parent' && edge.data.type !== 'birth' });
  }
  return paths;
}

function partnerPoints(A, B) {
  const [L, R] = A.x < B.x ? [A, B] : [B, A];
  const center = (p) => p.x + p.width / 2;
  return R.x - L.x - L.width > 29
    ? [[center(L), L.y], [center(L), L.y - 24], [center(R), R.y - 24], [center(R), R.y]]
    : [[L.x + L.width, L.y + L.height / 2], [R.x, R.y + R.height / 2]];
}
