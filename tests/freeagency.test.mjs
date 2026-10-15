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
  assert.deepEqual([p.contract.tid, p.contract.pid, p.contract.sal, p.contract.yrs], [team.id, p.id, offer.sal, offer.yrs]);
  if (x.rec.fromTeam !== team) assert.ok(team.roster.every(q => q === p || q.num !== p.num), 'free jersey number');
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
