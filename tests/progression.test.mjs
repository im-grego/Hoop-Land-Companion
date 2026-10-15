// Usage: node tests/progression.test.mjs <path-to-season-file>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSave, serializeSave, leaguePlayers, snapshot, diffPlayer, ATTRS } from '../js/savefile.js';
import { DEFAULT_PARAMS, runProgression, buildSkillProfiles, AWARD_CATEGORIES } from '../js/progression.js';

const text = readFileSync(process.argv[2], 'utf8');
const P = DEFAULT_PARAMS;
const maxAge = P.ageBands[P.ageBands.length - 1][0];

function run(spend, params = P) {
  const data = parseSave(text);
  const entries = leaguePlayers(data.seasonLeagues[0]).map(e => ({ ...e, leagueIdx: 0, spend }));
  const snaps = new Map(entries.map(e => [e.p.id, snapshot(e.p)]));
  const awards = runProgression(entries, params, buildSkillProfiles(entries.map(e => e.p)));
  return { data, entries, snaps, awards };
}

// 1. Default: points are added to season.ap, ratings untouched.
{
  const { entries, snaps, awards } = run(false);
  let bumped = 0, total = 0, delayed = 0, potUps = 0;
  for (const { p } of entries) {
    const d = diffPlayer(p, snaps.get(p.id));
    const award = awards.get(p.id);
    assert.equal(d.points, 0, 'ratings unchanged');
    assert.deepEqual(d.attrs, {}, 'ratings unchanged');
    assert.equal(d.added.length + d.leveled.length, 0, 'no skill changes by default');
    assert.equal(d.apDelta.reduce((a, b) => a + b, 0), award, 'ap gain equals award');
    d.apDelta.forEach((v, i) => {
      assert.ok(v >= 0, 'ap only goes up');
      if (!AWARD_CATEGORIES.includes(i)) assert.equal(v, 0, 'physical untouched');
    });
    if (p.age > maxAge) assert.equal(award, 0, `no bump over ${maxAge}`);
    const band = P.ageBands.find(b => p.age <= b[0]);
    if (band) assert.ok(award <= Math.round(band[2] * P.starterMult), 'within band max');
    if (award) bumped++;
    total += award;
    const snap = snaps.get(p.id);
    assert.ok(d.regDelta === 0 || d.regDelta === 1, 'regression delayed at most a year');
    if (d.regDelta) { assert.ok(p.age > snap.regressionAge, 'only players already past their regression age'); delayed++; }
    assert.ok(d.potDelta === 0 || d.potDelta === 1, 'potential +1 at most');
    if (d.potDelta) { assert.ok(p.age <= P.potUpMaxAge && p.pot <= 10, 'young players, max 10'); potUps++; }
  }
  console.log(`bump OK: ${bumped}/${entries.length} players, +${total} points, ${delayed} regressions delayed, ${potUps} potential upgrades`);
}

// 2. Determinism.
assert.equal(serializeSave(run(false).data), serializeSave(run(false).data), 'deterministic');

// 3. Spend mode: points become ratings, ceilings rise with them.
{
  const { entries, snaps } = run(true);
  let spent = 0;
  for (const { p } of entries) {
    const snap = snaps.get(p.id);
    for (const k of ATTRS) {
      const [c, ceil] = p.attributes[k];
      assert.ok(c >= snap.attributes[k][0], 'never decreases');
      if (c !== snap.attributes[k][0]) assert.ok(c <= ceil && c <= 20, 'ceiling raised with rating');
    }
    p.season.ap.forEach((v, i) => {
      if (v > 0) assert.ok(['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS', 'DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK', 'STR', 'SPD', 'STM']
        .slice(i * 3, i * 3 + 3).every(k => p.attributes[k][0] >= 20), 'leftover points only when category is all 20');
    });
    spent += diffPlayer(p, snap).points;
  }
  console.log(`spend OK: +${spent} rating points`);
}
