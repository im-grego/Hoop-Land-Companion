// Usage: node tests/draft.test.mjs <path-to-offseason-file-with-draft-class>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSave, serializeSave, playerName, POSITIONS, heightStr } from '../js/savefile.js';
import { draftDrop, buildCompPool, prospectComps, prospectValue, assignClassComps, floorVector, projectedCeiling, lotteryOdds, runLottery, detectLotteryFormat,
  draftOrder, cpuPick, tradePicks } from '../js/draft.js';
import { mulberry32 } from '../js/progression.js';

assert.equal(draftDrop(8), 4);
assert.equal(draftDrop(5), 2);
assert.equal(draftDrop(2), 2);
assert.equal(draftDrop(1), 1);
assert.equal(draftDrop(0), 0);

const text = readFileSync(process.argv[2], 'utf8');
const data = parseSave(text);
const L = data.seasonLeagues[0];
assert.ok(L.draftClass.length > 0, 'file has a draft class');

// Comps
const pool = buildCompPool(L);
const board = [...L.draftClass].sort((a, b) => prospectValue(b) - prospectValue(a));
for (const p of board.slice(0, 5)) {
  const c = prospectComps(p, pool);
  console.log(`${playerName(p).padEnd(22)} ${POSITIONS[p.pos].padEnd(3)} ${heightStr(p.ht)} age ${p.age} pot ${p.pot} | floor: ${c.floor[0].name} (${c.floor[0].group}, ${c.floor[0].sim}) | ceiling: ${c.ceiling[0].name} (${c.ceiling[0].group}, ${c.ceiling[0].sim})`);
}

// Class-wide comps: one each, no repeats, Legends rare and only for 10s.
const classComps = assignClassComps(board, pool, { floorVec: x => floorVector(x), ceilVec: x => projectedCeiling(x) });
const seen = new Set();
let legends = 0;
for (const p of board) {
  const c = classComps.get(p.id);
  for (const x of [...c.floor, ...c.ceiling]) {
    assert.ok(!seen.has(x.id), 'comp used once per class');
    seen.add(x.id);
  }
  if ((c.ceiling[0]?.tier === 'Hall of Fame' || c.ceiling[0]?.tier === 'Legend')) { legends++; assert.equal(p.pot, 10, 'top comps only for 10s'); }
  assert.ok(!['Hall of Fame', 'Legend'].includes(c.floor[0]?.tier), 'no top-tier floors');
}
assert.ok(legends <= 2, 'at most 2 Legend comps per class');
console.log(`class comps OK: ${seen.size} unique comps, ${legends} top-tier (10+)`);
for (const p of board.slice(0, 8)) {
  const c = classComps.get(p.id);
  console.log(`  ${playerName(p).padEnd(22)} pot ${p.pot} | floor ${c.floor[0]?.name} (${c.floor[0]?.tier}) | ceiling ${c.ceiling[0]?.name} (${c.ceiling[0]?.tier})`);
}

// Lottery odds sum to 100% per pick
assert.equal(detectLotteryFormat(L), '321', 'file uses the 3-2-1 lottery');
const odds = lotteryOdds(L, 'auto', 4, 4000);
// 3-2-1: worst three never pick below #12
for (const r of odds.slice(0, 3)) assert.equal(r.pct.slice(12).reduce((a, b) => a + b, 0), 0, 'bottom-3 floor at #12');
for (let pick = 0; pick < odds.length; pick++) {
  const s = odds.reduce((a, r) => a + r.pct[pick], 0);
  assert.ok(Math.abs(s - 100) < 1e-6, 'each pick goes to exactly one team');
}
console.log('lottery #1 odds:', odds.map(r => `${r.team.shortName} ${r.pct[0].toFixed(1)}%`).join(', '));

// Mock draft
const lot = runLottery(L, 'auto', 4, mulberry32(7)).map(r => r.team);
// Classic: only the top 4 are drawn, so a team never picks after its seed + 4.
for (const r of lotteryOdds(L, 'classic', 4, 2000)) {
  r.pct.forEach((v, pick) => { if (v) assert.ok(pick <= r.seed + 4, 'classic: fall at most 4 spots'); });
}
const order = draftOrder(L, lot);
assert.equal(new Set(order.map(o => `${o.rd}:${o.orig.id}`)).size, order.length, 'no duplicate picks');
const avail = [...L.draftClass];
for (const slot of order) {
  const p = cpuPick(slot.owner, avail);
  if (!p) break;
  avail.splice(avail.indexOf(p), 1);
}
console.log(`mock draft: ${order.length} picks, ${avail.length} undrafted`);

// Trade: swap two first-rounders, then swap back -> identical file
const [A, B] = L.teams;
const pa = A.draftPicks.find(p => p.rd === 1);
const pb = B.draftPicks.find(p => p.rd === 1);
tradePicks(A, B, [pa], [pb]);
assert.ok(B.draftPicks.some(p => p === pa && p.tid === B.id));
assert.ok(A.draftPicks.some(p => p === pb && p.tid === A.id));
tradePicks(A, B, [pb], [pa]);
const owners = d => d.seasonLeagues[0].teams.map(t => t.draftPicks.map(p => `${p.yr}:${p.rd}:${p.otid}:${p.tid}`).sort().join());
assert.deepEqual(owners(data), owners(parseSave(text)), 'trade round-trip restores pick ownership');
console.log('draft OK');
