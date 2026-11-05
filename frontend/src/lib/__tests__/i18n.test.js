import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import en from '../../i18n/en.json';
import tr from '../../i18n/tr.json';

const flatten = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flatten(v, `${p}${k}.`) : [`${p}${k}`]));
const keysOf = (o) => new Set(flatten(o));
// i18next plural suffixes resolve to the base key
const hasKey = (set, key) => set.has(key) || set.has(`${key}_one`) || set.has(`${key}_other`);

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : sources(p);
    return /\.(jsx?|js)$/.test(d.name) ? [p] : [];
  });
}

describe('translations', () => {
  const root = path.resolve(__dirname, '../..');
  const used = new Set();
  for (const file of sources(root)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*['`]([a-zA-Z_.]+)['`]/g)) used.add(m[1]);
  }
  // dynamic keys built from template strings
  const dynamic = [
    ...['daily', 'weekly', 'monthly', 'yearly'].map((x) => `recurrence.${x}`),
    ...['day', 'week', 'month', 'year'].flatMap((u) => [`recurrence.unit_${u}`, `recurrence.every_${u}`]),
    ...['this', 'following', 'all'].map((x) => `scope.${x}`),
    ...['edit', 'delete', 'move'].map((x) => `scope.title_${x}`),
    ...['day', 'week', 'month', 'year', 'agenda'].map((x) => `views.${x}`),
  ];
  dynamic.forEach((k) => used.add(k));

  for (const [name, dict] of [['en', en], ['tr', tr]]) {
    it(`${name} has every key the code uses`, () => {
      const set = keysOf(dict);
      expect([...used].filter((k) => !hasKey(set, k))).toEqual([]);
    });
  }
  it('en and tr define the same keys', () => {
    expect([...keysOf(en)].sort()).toEqual([...keysOf(tr)].sort());
  });
});
