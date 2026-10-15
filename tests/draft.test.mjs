// Usage: node tests/draft.test.mjs <path-to-offseason-file-with-draft-class>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSave, serializeSave, playerName, POSITIONS, heightStr } from '../js/savefile.js';
import { draftDrop, buildCompPool, prospectComps, prospectValue, lotteryOdds, drawLottery, lotterySetup,
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

// Lottery odds sum to 100% per pick
const odds = lotteryOdds(L, 4, 4000);
for (let pick = 0; pick < odds.length; pick++) {
  const s = odds.reduce((a, r) => a + r.pct[pick], 0);
  assert.ok(Math.abs(s - 100) < 1e-6, 'each pick goes to exactly one team');
}
console.log('lottery #1 odds:', odds.map(r => `${r.team.shortName} ${r.pct[0].toFixed(1)}%`).join(', '));

// Mock draft
const { lotteryTeams, odds: w } = lotterySetup(L);
const lot = drawLottery(lotteryTeams, w, 4, mulberry32(7)).map(r => r.team);
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
