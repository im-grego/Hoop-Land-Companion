// Usage: node tests/progression.test.mjs <path-to-season-file>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSave, serializeSave, leaguePlayers, snapshot, diffPlayer, ATTRS, UNLEVELED_SKILLS, CATEGORIES } from '../js/savefile.js';
import { DEFAULT_PARAMS, runProgression, buildSkillProfiles } from '../js/progression.js';

const text = readFileSync(process.argv[2], 'utf8');
const data = parseSave(text);
const league = data.seasonLeagues[0];
const entries = leaguePlayers(league).map(e => ({ ...e, leagueIdx: 0 }));
const snaps = new Map(entries.map(e => [e.p.id, snapshot(e.p)]));
const profiles = buildSkillProfiles(entries.map(e => e.p));
runProgression(entries, DEFAULT_PARAMS, profiles);

let changed = 0, pts = 0, newSkills = 0, held = 0;
for (const { p } of entries) {
  const d = diffPlayer(p, snaps.get(p.id));
  if (d.changed) changed++;
  pts += d.points; newSkills += d.added.length; held += d.apSpent;
  CATEGORIES.forEach((c, i) => {
    const ap = p.season.ap[i];
    assert.ok(ap >= 0 && ap <= snaps.get(p.id).ap[i], 'held points only go down');
    if (ap > 0) assert.ok(c.attrs.every(k => p.attributes[k][0] >= 20), 'points left only when category is all 20');
  });
  for (const k of ATTRS) {
    const [c, ceil] = p.attributes[k];
    assert.ok(c >= snaps.get(p.id).attributes[k][0], 'never decreases');
    if (c !== snaps.get(p.id).attributes[k][0]) assert.ok(c <= ceil && c <= 20, 'within ceiling');
    const held = snaps.get(p.id).ap[CATEGORIES.findIndex(cat => cat.attrs.includes(k))] || 0;
    assert.ok(c - snaps.get(p.id).attributes[k][0] <= DEFAULT_PARAMS.maxPerAttr + held, 'age growth capped per rating');
  }
  for (const s of p.skills) if (UNLEVELED_SKILLS.includes(s.id)) assert.equal(s.level, 1, 'unleveled skills stay at 1');
  if (p.age >= 30) assert.equal(d.points, d.apSpent, '30+ only spends held points by default');
}
// Determinism: same seed => same output
const again = parseSave(text);
const e2 = leaguePlayers(again.seasonLeagues[0]).map(e => ({ ...e, leagueIdx: 0 }));
runProgression(e2, DEFAULT_PARAMS, buildSkillProfiles(leaguePlayers(parseSave(text).seasonLeagues[0]).map(e => e.p)));
assert.equal(serializeSave(again), serializeSave(data), 'deterministic');
console.log(`progression OK: ${changed}/${entries.length} players changed, +${pts} pts (${held} from held points), ${newSkills} new skills`);
