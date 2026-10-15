// Usage: node tests/rookies.test.mjs <pre-draft file (phase 4)> <post-draft file (phase 5)>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSave, leagueRookies, snapshot, diffPlayer, PHYSICAL } from '../js/savefile.js';
import { actualDraftOrder, lotteryDone, draftDrop, SKILL_ATTRS, buildCompPool, rookieComps, originalRatings,
  applySummerLeague, projectedRookie, recoveryFor, rookieLine } from '../js/draft.js';
import { DEFAULT_PARAMS, runRookieBump, AWARD_CATEGORIES } from '../js/progression.js';

const pre = parseSave(readFileSync(process.argv[2], 'utf8')).seasonLeagues[0];
const post = parseSave(readFileSync(process.argv[3], 'utf8')).seasonLeagues[0];

// The real draft order from the pre-draft file matches who actually picked.
assert.ok(lotteryDone(pre), 'lottery done in pre-draft file');
const order = actualDraftOrder(pre);
const rookies = leagueRookies(post);
const drafted = rookies.filter(r => r.round > 0);
assert.equal(drafted.length, order.length, 'one rookie per pick');
for (const r of drafted) {
  const slot = order[r.pick - 1];
  assert.equal(slot.owner.id, r.p.history.draft.tid, `pick #${r.pick} owner`);
  assert.equal(slot.rd, r.round);
}
console.log(`draft order OK: ${order.length} picks match the real draft`);

// The -4 drop (min 2) is exactly what the game applied; ceilings and physicals untouched.
const before = new Map(pre.draftClass.map(p => [p.id, p]));
for (const { p } of rookies) {
  const b = before.get(p.id);
  for (const k of SKILL_ATTRS) {
    assert.equal(p.attributes[k][0], draftDrop(b.attributes[k][0]), `${k} drop`);
    assert.equal(p.attributes[k][1], b.attributes[k][1], `${k} ceiling kept`);
  }
  for (const k of PHYSICAL) assert.deepEqual(p.attributes[k], b.attributes[k], `${k} unchanged`);
}
console.log(`draft drop OK: ${rookies.length} rookies (${rookies.length - drafted.length} undrafted)`);

// Summer league: rookies win back drop points by age, never past the
// pre-draft rating; the result matches the prospect floor projection.
const orig = originalRatings(pre);
let regained = 0;
for (const { p } of rookies) {
  const b = before.get(p.id);
  const projected = rookieLine(b);
  const gains = applySummerLeague(p, orig[p.id]);
  const n = recoveryFor(p.age);
  SKILL_ATTRS.forEach((k, i) => {
    const now = p.attributes[k][0];
    assert.ok(now <= orig[p.id][i], 'never past pre-draft rating');
    assert.ok(now - draftDrop(orig[p.id][i]) <= n, 'recovers at most the age amount');
    assert.equal(now, projectedRookie(orig[p.id][i], p.age));
    assert.equal(now, projected[i], 'matches the projected rookie line');
  });
  regained += Object.values(gains).reduce((a, x) => a + x, 0);
  // Applying again changes nothing.
  assert.deepEqual(applySummerLeague(p, orig[p.id]), {}, 'idempotent');
}
console.log(`summer league OK: +${regained} ratings regained`);

// Comps never point at another rookie.
const pool = buildCompPool(post);
const rookieSet = new Set(rookies.map(r => r.p.id));
for (const r of rookies.slice(0, 10)) {
  const c = rookieComps(r.p, pool);
  for (const x of [...c.floor, ...c.ceiling]) assert.ok(!rookieSet.has(x.id), 'comp is not a rookie');
}

// Rookie bump only adds points to the four award categories.
const snaps = new Map(rookies.map(r => [r.p.id, snapshot(r.p)]));
const awards = runRookieBump(rookies.map(r => ({ ...r, spend: false })), DEFAULT_PARAMS);
let total = 0;
for (const r of rookies) {
  const d = diffPlayer(r.p, snaps.get(r.p.id));
  assert.equal(d.points, 0, 'ratings unchanged');
  assert.equal(d.apDelta.reduce((a, b) => a + b, 0), awards.get(r.p.id));
  d.apDelta.forEach((v, i) => { if (!AWARD_CATEGORIES.includes(i)) assert.equal(v, 0); });
  total += awards.get(r.p.id);
}
console.log(`rookie bump OK: +${total} points across ${rookies.length} rookies`);
