import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMapSettings, mapSettingsUrl } from '../public/family-map/settings.js';

const base = 'https://example.test/family-map/';
const people = new Set(['jinpachi', 'person & family']);
const defaults = { person: 'jinpachi', levels: '2' };

test('a share link restores the starting person and level limit', () => {
  for (const levels of ['1', '2', '3', '4', 'unlimited']) {
    const settings = { person: 'person & family', levels };
    const url = mapSettingsUrl(base, settings);
    assert.equal(url.pathname, '/family-map/');
    assert.equal(url.searchParams.get('person'), settings.person);
    assert.equal(url.searchParams.get('levels'), levels);
    assert.deepEqual(readMapSettings(url.href, people, defaults), settings);
  }
});

test('invalid or missing settings fall back independently', () => {
  assert.deepEqual(readMapSettings(base, people, defaults), defaults);
  assert.deepEqual(readMapSettings(base + '?person=removed&levels=4', people, defaults),
    { person: 'jinpachi', levels: '4' });
  for (const levels of ['Infinity', '0', '5', '02', '3.5']) {
    assert.deepEqual(readMapSettings(base + '?person=person+%26+family&levels=' + levels, people, defaults),
      { person: 'person & family', levels: '2' });
  }
});

test('settings updates keep other URL parameters and the fragment', () => {
  const url = mapSettingsUrl(base + '?person=old&levels=1&view=tree#chart', defaults);
  assert.equal(url.searchParams.get('view'), 'tree');
  assert.equal(url.hash, '#chart');
  assert.deepEqual(readMapSettings(url.href, people, defaults), defaults);
});
