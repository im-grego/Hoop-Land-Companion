// Usage: node tests/progression.test.mjs <path-to-season-file>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSave, serializeSave, leaguePlayers, snapshot, diffPlayer, ATTRS, lastSeasonMpg } from '../js/savefile.js';
import { DEFAULT_PARAMS, runProgression, buildSkillProfiles, AWARD_CATEGORIES, injuryPotChance, earnsNaturalLongevity, productionScores } from '../js/progression.js';
import { teamRecord } from '../js/draft.js';

const text = readFileSync(process.argv[2], 'utf8');
const P = DEFAULT_PARAMS;
const maxAge = P.ageBands[P.ageBands.length - 1][0];

function run(spend, params = P) {
  const data = parseSave(text);
  const L = data.seasonLeagues[0];
  const injuryYear = Math.max(...L.teams.map(t => teamRecord(t).yr || 0));
  const production = productionScores(leaguePlayers(L).map(e => e.p), 0, injuryYear, params);
  const ctx = { leagueIdx: 0, injuryYear, totalGames: L.season.totalGames, rolled: L.season.currentYear > injuryYear, production };
  const entries = leaguePlayers(L).map(e => ({ ...e, ...ctx, spend }));
  const snaps = new Map(entries.map(e => [e.p.id, snapshot(e.p)]));
  const awards = runProgression(entries, params, buildSkillProfiles(entries.map(e => e.p)));
  return { data, entries, snaps, awards, injuryYear };
}

// 1. Points mode: points are added to season.ap, ratings untouched.
{
  const { entries, snaps, awards, injuryYear } = run(false, { ...P, bumpMode: 'points' });
  let bumped = 0, total = 0, delayed = 0, potUps = 0, potDowns = 0, atRisk = 0, earnedN = 0, sooner = 0;
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
    assert.ok([-1, 0, 1].includes(d.regDelta), 'regression age moves a year at most');
    const earned = earnsNaturalLongevity(p, lastSeasonMpg(p, 0), entries[0], P);
    const z = entries[0].production.get(p.id) ?? null;
    if (earned) { assert.equal(d.regDelta, 1, 'earned longevity is guaranteed'); earnedN++; }
    if (d.regDelta > 0) assert.ok(p.age >= snap.regressionAge - 1 && p.age <= snap.regressionAge, 'delay only at the regression age or the year before');
    if (d.regDelta < 0) {
      assert.ok(p.age >= snap.regressionAge - P.regDownWindow, 'only near regression');
      assert.ok(p.age < snap.regressionAge, 'never once already regressing');
      assert.ok(injuryPotChance(p, injuryYear, P) > 0 || (z != null && z <= P.regDownProdZ), 'sooner only after injury or a poor season');
      sooner++;
    }
    if (d.regDelta > 0) delayed++;
    const risk = injuryPotChance(p, injuryYear, P);
    assert.ok([-1, 0, 1].includes(d.potDelta), 'potential moves by 1 at most');
    if (d.potDelta > 0) { assert.ok(!risk && p.age <= P.potUpMaxAge && p.pot <= 10, 'young, uninjured, max 10'); potUps++; }
    if (d.potDelta < 0) {
      assert.ok(p.pot >= 4, 'never below 4');
      assert.ok(risk > 0 || p.age <= P.potUpMaxAge, 'injury, or a young player (poor season or bad luck)');
      potDowns++;
    }
    if (risk) atRisk++;
  }
  console.log(`bump OK: ${bumped}/${entries.length} players, +${total} points, ${delayed} regressions delayed (${earnedN} earned), ${sooner} sooner, ${potUps} potential upgrades, ${potDowns} potential down (${atRisk} injured at risk)`);
}

// 1b. Train mode (default): ratings go up directly, ap untouched.
{
  const { entries, snaps, awards } = run(false);
  let total = 0;
  for (const { p } of entries) {
    const snap = snaps.get(p.id);
    const d = diffPlayer(p, snap);
    assert.equal(d.points, awards.get(p.id), 'rating gains equal the award');
    assert.ok(d.apDelta.every(v => v === 0), 'no upgrade points added');
    for (const k of ATTRS) {
      const g = p.attributes[k][0] - snap.attributes[k][0];
      assert.ok(g >= 0 && g <= P.trainMaxPerAttr, 'at most +3 per rating');
      if (g) {
        assert.ok(p.attributes[k][0] <= (k === 'FTS' ? 16 : 20), 'free throws stop at 16');
        assert.ok(p.attributes[k][1] >= p.attributes[k][0], 'ceiling rises with rating');
      }
    }
    total += d.points;
  }
  console.log(`train OK: +${total} rating upgrades`);
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
