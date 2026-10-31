import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fromRows, relationshipDistances } from '../public/tree.js';

const rows = [], people = 100000;
for (let i = 0; i < people; i++) {
  rows.push({ id: `p${i}`, kind: 'person', data: {}, deleted: 0 });
  if (i) rows.push({ id: `e${i}`, kind: 'parent', deleted: 0, data: { parent: `p${Math.floor((i - 1) / 2)}`, child: `p${i}` } });
}
const state = fromRows(0, rows), start = performance.now();
const distances = relationshipDistances(state, 'p0');
const milliseconds = +(performance.now() - start).toFixed(1);
assert.equal(distances.size, people);
assert.equal(distances.get(`p${people - 1}`), Math.floor(Math.log2(people)));
console.log(JSON.stringify({ people, links: people - 1, reached: distances.size, milliseconds }));
