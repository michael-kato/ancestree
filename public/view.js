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
  return mixed.map((v) => v / total);
}

export const colorCss = ([l, a, b] = [0.8, 0, 0]) => `oklab(${l.toFixed(6)} ${a.toFixed(6)} ${b.toFixed(6)})`;

export function colorLuminance([L, a, b], brightness = 1) {
  const l = (L + 0.3963377774*a + 0.2158037573*b) ** 3;
  const m = (L - 0.1055613458*a - 0.0638541728*b) ** 3;
  const s = (L - 0.0894841775*a - 1.291485548*b) ** 3;
  const rgb = [4.0767416621*l - 3.3077115913*m + 0.2309699292*s, -1.2684380046*l + 2.6097574011*m - 0.3413193965*s, -0.0041960863*l - 0.7034186147*m + 1.707614701*s].map((v) => Math.max(0, Math.min(1, v))).map((v) => {
    const srgb = (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * brightness;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]*0.2126 + rgb[1]*0.7152 + rgb[2]*0.0722;
}

export const cardInk = (color, brightness) => colorLuminance(color, brightness) >= 0.179 ? '#000' : '#fff';

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
