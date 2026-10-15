// Usage: node tests/livedraft.test.mjs <pre-draft-file> <post-draft-file> [fa-day-1-file]
// 1. Replaying the game's own picks reproduces its post-draft save.
// 2. A full live draft with trades writes a valid post-draft save.
// 3. Second-round rookie contracts shorten (and undo).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSave, serializeSave, leagueRookies, jerseyNumber } from '../js/savefile.js';
import { actualDraftOrder, cpuPick, prospectValue, pickValue, draftDrop, SKILL_ATTRS } from '../js/draft.js';
import { mulberry32 } from '../js/progression.js';
import { applyDraft, newLiveDraft, clockIndex, makeSelection, takenIds, livePicks, slotPick, tradeUpOffers, tradeableProspects, applyRookieContracts, undoRookieContracts } from '../js/livedraft.js';
import { slotValue, executeTrade, undoTrade, playerValue } from '../js/trades.js';

const preText = readFileSync(process.argv[2], 'utf8');
const post = JSON.parse(readFileSync(process.argv[3], 'utf8')).seasonLeagues[0];

// 0. Jersey rule: own number, then its single digit, then the lowest free one.
{
  const team = { roster: [{ num: 27 }, { num: 0 }, { num: 1 }, { num: 55 }], retiredNumbers: [{ num: 5 }, { num: 2 }] };
  assert.equal(jerseyNumber(team, { num: 33 }), 33);
  assert.equal(jerseyNumber(team, { num: 27 }), 7);
  assert.equal(jerseyNumber(team, { num: 55 }), 3, '55 → 5 is retired → lowest free');
  assert.equal(jerseyNumber(team, { num: 1 }), 3);
  console.log('jersey numbers OK');
}

// 1. Replay.
{
  const L = JSON.parse(preText).seasonLeagues[0];
  const ids = new Set(L.draftClass.map(p => p.id));
  const picks = post.teams.flatMap(t => t.roster).filter(p => ids.has(p.id))
    .map(p => ({ rd: p.history.draft.rd, overall: p.history.draft.pk, by: p.history.draft.tid, to: p.tid, pid: p.id }))
    .sort((a, b) => a.overall - b.overall);
  applyDraft(L, picks);
  const strip = p => { const { linePos, teamPos, posRnk, num, ...rest } = p; rest.stats = rest.stats.map(s => ({ ...s, season: s.season.map(({ num: _, ...r }) => r) })); return JSON.stringify(rest); };
  const byId = X => new Map([...X.teams.flatMap(t => t.roster), ...X.freeAgents].map(p => [p.id, p]));
  const a = byId(L), b = byId(post);
  for (const [id, p] of b) assert.equal(strip(a.get(id)), strip(p), `player ${id} matches the game's draft`);
  for (const t of post.teams) {
    const mine = L.teams.find(x => x.id === t.id);
    assert.equal(JSON.stringify(mine.draftPicks), JSON.stringify(t.draftPicks), `picks of team ${t.id}`);
    assert.deepEqual(new Set(mine.roster.map(p => p.id)), new Set(t.roster.map(p => p.id)), `roster of team ${t.id}`);
  }
  assert.equal(L.season.phase, post.season.phase);
  assert.equal(L.draftClass.length, 0);
  console.log(`replay OK: ${picks.length} picks match the game's post-draft save`);
}

// 2. Live draft with trades (on the lossless parse, then serialize).
{
  const data = parseSave(preText);
  const L = data.seasonLeagues[0];
  const rng = mulberry32(7);
  const live = newLiveDraft();
  const before = new Map(L.draftClass.map(p => [p.id, SKILL_ATTRS.map(k => p.attributes[k][0])]));
  const trades = [];
  let order = actualDraftOrder(L);
  const total = order.length;
  // Trade #3 for a later first + future picks, if anyone bites.
  const offers = tradeUpOffers(L, order, 2, { value: pk => pickValue(L, pk), slot: slotValue, rng: () => 0, count: 1, eager: 1 });
  if (offers.length) {
    const o = order[2];
    trades.push(executeTrade({ team: offers[0].team, picks: offers[0].give }, { team: o.owner, picks: [offers[0].get] }, L.season.currentYear));
    order = actualDraftOrder(L);
    assert.equal(order[2].owner.id, offers[0].team.id, 'trade-up moves the pick');
  }
  for (let i = clockIndex(live, order); i >= 0; i = clockIndex(live, order)) {
    const avail = L.draftClass.filter(p => !takenIds(live).has(p.id));
    makeSelection(live, order, i, cpuPick(order[i].owner, avail, p => prospectValue(p), rng).id);
    if (i === 4) {
      // Draft-and-trade: #5 goes to the team picking 10th for its 1st next year... plus a player swap.
      const s = tradeableProspects(live, order, order[4].owner.id, 8)[0];
      assert.ok(s, 'just-drafted rookie is tradeable');
      live.sel[s.overall].to = order[9].owner.id;
      const vet = order[9].owner.roster[0], vet2 = order[4].owner.roster[0];
      const rec = executeTrade({ team: order[4].owner, players: [vet2] }, { team: order[9].owner, players: [vet] }, L.season.currentYear);
      assert.equal(vet.tid, order[4].owner.id);
      undoTrade(rec);
      assert.equal(vet.tid, order[9].owner.id, 'undo moves players back');
      trades.push(executeTrade({ team: order[4].owner, players: [vet2] }, { team: order[9].owner, players: [vet] }, L.season.currentYear));
    }
  }
  const picks = livePicks(live, order);
  assert.equal(picks.length, total);
  const res = applyDraft(L, picks);
  const text = serializeSave(data);
  const L2 = parseSave(text).seasonLeagues[0];
  assert.equal(L2.season.phase, 5);
  const rookies = leagueRookies(L2);
  assert.equal(rookies.filter(r => r.round > 0).length, total);
  const moved = rookies.find(r => r.pick === 5);
  assert.equal(moved.team.id, order[9].owner.id, 'draft-and-trade rookie lands on the new team');
  assert.equal(moved.p.history.draft.tid, order[4].owner.id, 'draft history keeps the drafting team');
  for (const r of rookies) {
    const was = before.get(r.p.id);
    SKILL_ATTRS.forEach((k, i) => assert.equal(r.p.attributes[k][0], draftDrop(was[i]), `${k} drop`));
    assert.equal(r.p.stats.filter(s => s.yr === L2.season.currentYear && s.league === 0).length, 1, 'one new-season stats row');
  }
  for (const t of L2.teams) {
    const rookieIds = new Set(rookies.map(r => r.p.id));
    for (const p of t.roster.filter(x => rookieIds.has(x.id))) {
      assert.ok(t.roster.every(x => x === p || x.num !== p.num), `rookie ${p.ln} has a free number on ${t.shortName}`);
      assert.ok(!(t.retiredNumbers || []).some(r => r.num === p.num), `rookie ${p.ln} doesn't wear a retired number`);
    }
    assert.ok(t.draftPicks.every(pk => pk.yr > L2.season.currentYear), 'used picks removed');
    for (const p of t.roster) assert.equal(p.tid, t.id, 'player tid matches roster');
  }
  console.log(`live draft OK: ${res.drafted} drafted, ${res.undrafted} undrafted, ${trades.length} trades, value of #1 ${slotValue(1).toFixed(0)}, top vet ${playerValue(L2.teams[0].roster[0], 0, 2027).toFixed(0)}`);
}

// 3. Rookie contracts.
if (process.argv[4]) {
  const L = parseSave(readFileSync(process.argv[4], 'utf8')).seasonLeagues[0];
  const r2 = leagueRookies(L).filter(r => r.round === 2 && r.team && r.p.contract.yrs > 2);
  const changes = applyRookieContracts(L, 2);
  assert.equal(changes.length, r2.length);
  assert.ok(changes.every(c => c.p.contract.yrs === 2 && c.p.contract.opt === 1));
  assert.ok(leagueRookies(L).filter(r => r.round === 1 && r.team).every(r => r.p.contract.yrs !== 2 || r.p.contract.yrs === 0), 'first-rounders untouched');
  undoRookieContracts(changes);
  assert.ok(r2.every(r => r.p.contract.yrs === 4));
  console.log(`rookie contracts OK: ${changes.length} second-rounders → 2 years`);
}
