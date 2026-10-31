// Usage: node tests/freeagency.test.mjs <free-agency-file> [day]
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSave, serializeSave, playerName } from '../js/savefile.js';
import { mulberry32 } from '../js/progression.js';
import * as FA from '../js/freeagency.js';

const text = readFileSync(process.argv[2], 'utf8');
const data = parseSave(text);
const L = data.seasonLeagues[0];
const day = +(process.argv[3] || L.season.currentDay || 1);
const O = FA.FA_DEFAULTS;
const market = FA.buildMarket(L, day);
assert.ok(market.length > 0, 'there is a market');
for (const m of market) {
  assert.ok(m.ask >= O.minSalary && m.ask <= FA.maxSalary(L, m.p), `${playerName(m.p)} ask in range`);
  assert.ok(FA.MOTIVES[m.motive], 'motive');
}
const before = new Map(L.teams.map(t => [t.id, { pay: FA.payroll(t), n: FA.signedRoster(t).length }]));

// A user offer for the best player, from the team with the most space.
const user = [...L.teams].sort((a, b) => FA.capSpace(L, b) - FA.capSpace(L, a))[0];
const star = [...market].sort((a, b) => b.ask - a.ask).find(m => m.ask <= FA.capSpace(L, user));
const bids = new Map();
if (star) bids.set(star.p.id, [{ tid: user.id, sal: star.ask, yrs: 3, opt: FA.OPT_PLAYER, cpu: false }]);
const rng = mulberry32(11);
const used = { mle: new Set() };
FA.cpuBids(L, market, bids, day, new Set([user.id]), rng, used);
for (let i = 0; i < 3; i++) FA.raiseRound(L, market, bids, day, rng, used);
for (const [pid, list] of bids) {
  assert.ok(list.filter(b => b.tid === user.id).every(b => !b.cpu), 'CPU never bids for the user team');
  for (const b of list) assert.ok(b.sal <= FA.maxSalary(L, market.find(m => m.p.id === pid).p), 'bids under the max');
}
const signings = FA.decide(L, market, bids, day, used);
assert.ok(signings.length > 0, 'someone signs');
for (const t of L.teams) {
  assert.ok(FA.signedRoster(t).length <= Math.max(O.rosterMax, before.get(t.id).n), `${t.shortName} roster limit`);
  const added = signings.filter(x => x.team === t);
  const spaceUsed = added.filter(x => x.kind === 'space').reduce((a, x) => a + x.offer.sal, 0);
  assert.ok(spaceUsed <= Math.max(0, L.season.salaryCap - before.get(t.id).pay), `${t.shortName} stays under the cap with space signings`);
  assert.ok(added.filter(x => x.kind === 'mle').length <= 1, 'one MLE per team');
}
for (const x of signings) {
  const { p, team, offer } = x;
  assert.ok(team.roster.includes(p) && !L.freeAgents.includes(p), 'on the roster');
  assert.equal(p.status, FA.STATUS_SIGNED);
  assert.equal(p.tid, team.id);
  // A signed deal is written the way the game writes one: no team or player id (those mark pending offers).
  assert.deepEqual([p.contract.tid, p.contract.pid, p.contract.sal, p.contract.yrs], [0, 0, offer.sal, offer.yrs]);
  // Free among the players staying: an expiring (4) or released (5) player's number is up for grabs.
  if (x.rec.fromTeam !== team) assert.ok(team.roster.every(q => q === p || q.status === 4 || q.status === 5 || q.num !== p.num), 'free jersey number');
  assert.ok(!L.contractOffers.some(o => o.pid === p.id), 'pending offers cleared');
  if (x.kind === 'mle') assert.ok(offer.sal <= O.mle && offer.yrs <= O.mleMaxYears);
  if (x.kind === 'vetMin') assert.ok(offer.sal === O.vetMin && offer.yrs === 1 && p.age >= O.vetMinAge);
  const row = p.stats.filter(s => s.yr === L.season.currentYear && s.league === 0).pop();
  if (row) assert.equal(row.sal, offer.sal, 'stats row salary');
}
const reread = parseSave(serializeSave(data)).seasonLeagues[0];
assert.equal(reread.teams.flatMap(t => t.roster).length, L.teams.flatMap(t => t.roster).length);
// Undo restores the file byte for byte.
for (const x of [...signings].reverse()) FA.unsignPlayer(L, x.rec);
const after = serializeSave(data);
if (after !== text) { let i = 0; while (after[i] === text[i]) i++; assert.fail(`undo differs at ${i}: ${text.slice(i - 200, i + 80)} ||| ${after.slice(i - 200, i + 80)}`); }
const wars = signings.filter(x => x.bidders >= 3);
console.log(`free agency day ${day} OK: ${market.length} on the market, ${signings.length} signed (${wars.length} bidding wars), kinds ${[...new Set(signings.map(x => x.kind))].join('/')}` +
  (star ? `; user bid for ${playerName(star.p)}: ${signings.find(x => x.p === star.p)?.team.shortName || 'unsigned'}` : ''));

// Restricted free agents: a CPU team matches a fair offer sheet, and a
// user team's "match" keeps the player.
{
  const d2 = parseSave(text);
  const L2 = d2.seasonLeagues[0];
  const mk = FA.buildMarket(L2, day);
  const rfa = mk.find(m => m.from && FA.isRestricted(L2, m.p));
  if (rfa) {
    const other = L2.teams.find(t => t !== rfa.from && FA.capSpace(L2, t) > rfa.ask + 5 && FA.signedRoster(t).length < O.rosterMax);
    if (other) {
      const sheet = { tid: other.id, sal: rfa.ask + 2, yrs: 4, opt: 0, cpu: true };
      const bids = new Map([[rfa.p.id, [sheet]]]);
      const users = new Set([rfa.from.id]);
      const pend = FA.pendingMatches(L2, [rfa], bids, day, users);
      assert.equal(pend.length, 1, 'your RFA with an offer sheet needs a decision');
      const [s1] = FA.decide(L2, [rfa], bids, day, {}, O, { matches: new Map([[rfa.p.id, true]]), userTeams: users });
      assert.ok(s1?.matched && s1.team === rfa.from, 'matched: stays with the old team');
      assert.equal(s1.offer.sal, sheet.sal, 'on the offer sheet terms');
      console.log(`restricted FA OK: ${playerName(rfa.p)} matched by ${rfa.from.shortName} at $${sheet.sal}M × 4`);
    }
  }
}
// After the last day, players without deals leave their teams (and undo puts them back).
{
  const d3 = parseSave(text);
  const L3 = d3.seasonLeagues[0];
  const t0 = serializeSave(d3);
  const n = L3.teams.flatMap(t => t.roster).filter(p => p.status === FA.STATUS_EXPIRING).length;
  const recs = FA.releaseUnsigned(L3);
  assert.equal(recs.length, n, 'every expiring player released');
  assert.ok(L3.teams.every(t => t.roster.every(p => p.status !== FA.STATUS_EXPIRING)), 'no expiring players left on rosters');
  assert.ok(recs.every(r => L3.freeAgents.includes(r.p) && r.p.status === FA.STATUS_FREE && r.p.tid === 0), 'now free agents');
  FA.unreleaseUnsigned(L3, recs);
  assert.equal(serializeSave(d3), t0, 'undo restores the file');
  console.log(`release OK: ${n} unsigned players to free agency`);
}
