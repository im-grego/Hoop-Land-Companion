// Usage: node tests/storylines.test.mjs <path-to-season-file>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSave } from '../js/savefile.js';
import { buildStorylines } from '../js/storylines.js';

const data = parseSave(readFileSync(process.argv[2], 'utf8'));
const stories = buildStorylines(data.seasonLeagues[0]);
assert.ok(stories.length > 0 && stories.length <= 10, 'one to ten storylines');
const kinds = {};
for (const s of stories) {
  assert.ok(s.title && s.text && s.icon, 'every story has an icon, title and text');
  assert.ok(!/undefined|NaN|null/.test(s.title + s.text), `no missing data: ${s.title}`);
  kinds[s.kind] = (kinds[s.kind] || 0) + 1;
}
for (const [k, n] of Object.entries(kinds)) assert.ok(n <= (['move', 'hump'].includes(k) ? 3 : 2), `too many ${k} stories`);
for (let i = 1; i < stories.length; i++) assert.ok(stories[i - 1].score >= stories[i].score, 'ranked by score');
console.log(`storylines OK: ${stories.map(s => s.kind).join(', ')}`);
