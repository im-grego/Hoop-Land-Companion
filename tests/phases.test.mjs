// Usage: node tests/phases.test.mjs <pre-lottery-file> [post-draft-file fa-day-1-file]
// Runs a whole offseason in code: lottery -> draft -> free agency days 1-3
// -> offseason bump, then checks the exported file. With the post-draft and
// Day 1 saves, also checks that opening free agency signs rookies exactly
// as the game does.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSave, serializeSave, leaguePlayers, leagueRookies } from '../js/savefile.js';
import { lotterySetup, drawLottery, actualDraftOrder, cpuPick, prospectValue, teamRecord } from '../js/draft.js';
import { DEFAULT_PARAMS, mulberry32, runProgression, buildSkillProfiles, productionScores } from '../js/progression.js';
import { applyLottery, preLotteryOrder, startFreeAgency, nextFreeAgencyDay } from '../js/phases.js';
import { applyDraft, newLiveDraft, clockIndex, makeSelection, takenIds, livePicks } from '../js/livedraft.js';
import * as FA from '../js/freeagency.js';

const data = parseSave(readFileSync(process.argv[2], 'utf8'));
const L = data.seasonLeagues[0];
assert.equal(L.season.phase, 2, 'needs a Pre-Lottery save');
const rng = mulberry32(21);

// Lottery
const setup = lotterySetup(L, 'auto', 4);
const pre = preLotteryOrder(L);
const drawn = drawLottery(pre.slice(0, setup.lotteryTeams.length), setup.odds, setup.draws, rng, setup.floor).map(r => r.team);
applyLottery(L, [...drawn, ...pre.filter(t => !drawn.includes(t))]);
assert.equal(L.season.phase, 4);
const order = actualDraftOrder(L);
assert.ok(order && order.length === L.teams.length * 2, 'full two-round order');
assert.equal(order[0].orig.id, drawn[0].id, 'lottery winner picks first');
const yr = L.season.currentYear;
for (const t of L.teams) assert.equal(t.season.find(s => s.yr === yr).pick, drawn.concat(pre.filter(x => !drawn.includes(x))).indexOf(t), 'row pick = first-round slot');

// Draft
const live = newLiveDraft();
for (let i = clockIndex(live, order); i >= 0; i = clockIndex(live, order)) {
  makeSelection(live, order, i, cpuPick(order[i].owner, L.draftClass.filter(p => !takenIds(live).has(p.id)), p => prospectValue(p), rng).id);
}
applyDraft(L, livePicks(live, order));
assert.equal(L.season.phase, 5);

// Free agency
const signed = startFreeAgency(L, { r2Years: 2 });
assert.equal(L.season.phase, 6);
assert.equal(L.season.currentDay, 1);
assert.ok(signed.every(x => x.p.status === 3 && x.p.contract.opt === 1));
assert.ok(signed.filter(x => x.p.history.draft.rd === 2).every(x => x.yrs === 2));
let total = 0;
const used = { mle: new Set() };
for (let day = 1; day <= 3; day++) {
  const market = FA.buildMarket(L, day);
  const bids = new Map();
  FA.cpuBids(L, market, bids, day, new Set(), rng, used);
  FA.raiseRound(L, market, bids, day, rng, used);
  total += FA.decide(L, market, bids, day, used).length;
  if (day < 3) nextFreeAgencyDay(L);
}
assert.equal(L.season.currentDay, 3);
assert.throws(() => nextFreeAgencyDay(L), /last day/);

// Offseason bump
const injuryYear = Math.max(...L.teams.map(t => teamRecord(t).yr || 0));
const production = productionScores(leaguePlayers(L).map(e => e.p), 0, injuryYear, DEFAULT_PARAMS);
const rookieIds = new Set(leagueRookies(L).map(r => r.p.id));
const entries = leaguePlayers(L).filter(e => !rookieIds.has(e.p.id))
  .map(e => ({ ...e, leagueIdx: 0, injuryYear, totalGames: L.season.totalGames, rolled: true, production, spend: false }));
const awards = runProgression(entries, { ...DEFAULT_PARAMS, seed: 3 }, buildSkillProfiles(entries.map(e => e.p)));

// Export
const L2 = parseSave(serializeSave(data)).seasonLeagues[0];
assert.equal(L2.season.phase, 6);
assert.equal(L2.season.currentDay, 3);
assert.equal(L2.draftClass.length, 0);
assert.ok(L2.teams.every(t => t.draftPicks.every(pk => pk.yr > yr)), 'used picks gone');
console.log(`offseason run OK: lottery won by ${drawn[0].shortName}, ${order.length} picks, ${signed.length} rookie deals, ${total} free-agent signings over 3 days, bump +${[...awards.values()].reduce((a, b) => a + b, 0)}`);

// Opening free agency matches the game.
if (process.argv[4]) {
  const P = JSON.parse(readFileSync(process.argv[3], 'utf8')).seasonLeagues[0];
  const F = JSON.parse(readFileSync(process.argv[4], 'utf8')).seasonLeagues[0];
  const game = new Map(F.teams.flatMap(t => t.roster).map(p => [p.id, p]));
  const out = startFreeAgency(P, { r2Years: 4 });
  const same = out.filter(x => JSON.stringify(x.p.contract) === JSON.stringify(game.get(x.p.id).contract)).length;
  const gameSigned = [...game.values()].filter(p => p.history.draft.yr === F.season.currentYear && p.status === 3).length;
  assert.equal(same, gameSigned, 'every rookie the game signed gets the same contract');
  console.log(`free agency start OK: ${same} rookie contracts match the game (${out.length - same} more the game left unsigned)`);
}
