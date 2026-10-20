// Trades of players and draft picks (draft day and offseason), with a rough
// value model so CPU teams can accept or decline.

import { pickValue, tradePicks, samePick } from './draft.js';
import { seasonLine } from './storylines.js';
import { jerseyNumber } from './savefile.js';
import { shownLevel as levelOf } from './regression.js';

// Value of a pick in this draft by its overall slot (#1 ≈ 133, #10 ≈ 69,
// #30 ≈ 17, #60 ≈ 4), on the same scale as future picks' pickValue.
export const slotValue = overall => 3 + 130 * Math.exp(-0.075 * (overall - 1));

// A fair salary ($M a year) for a player's level, read off a curve tuned to
// the league's real pay: the top few (level 95+) are max and supermax deals
// in the high 50s and low 60s, a 90 is around $46M, an 80 about $25M, and
// the scale flattens into the single digits for rotation players.
const FAIR = [[100, 62], [97, 58], [94, 54], [92, 50], [90, 46], [88, 42], [86, 38], [84, 34], [82, 29], [80, 25], [78, 20], [76, 15], [74, 12], [72, 10], [70, 8], [68, 6.5], [66, 5], [64, 4], [62, 3.5], [60, 3], [56, 2]];
export const fairSalary = level => {
  if (level >= FAIR[0][0]) return FAIR[0][1] + Math.round((level - FAIR[0][0]) * 0.8);
  for (let i = 1; i < FAIR.length; i++) {
    const [lv, sal] = FAIR[i], [hv, hs] = FAIR[i - 1];
    if (level >= lv) return Math.round(sal + (hs - sal) * (level - lv) / (hv - lv));
  }
  return 2;
};
// How far over (or under) fair a deal must be to carry a tag: about 17% of
// the fair figure, never under $4M, so a star's tag isn't a rounding error
// and a rotation player's isn't a quarter of the deal.
export const tagGap = fair => Math.max(4, fair * 0.17);

// What a contract does to a player's trade value. Overpays cost more the
// longer they run; a player option means there's no getting out (it counts
// in full and a bit worse); a team option takes the edge off the last year;
// an expiring deal is mostly harmless and even worth a little as cap room.
// Returns { adj, tag } (tag: 'Final Year' | 'Overpaid' | 'Bargain' | '').
export function contractValue(p) {
  const c = p.contract || {};
  const yrs = c.yrs || 0, sal = c.sal || 0;
  if (!yrs || !sal) return { adj: 0, tag: '' };
  const fair = fairSalary(levelOf(p));
  const over = sal - fair;
  let years = yrs;
  if (c.opt === 1) years -= 0.5;                       // team option: can walk away from the last year
  if (yrs <= 1) {
    return { adj: over > 0 ? 2 - over * 0.15 : Math.min(4, -over * 0.2), tag: 'Final Year' };
  }
  if (over > 0) {
    const pen = Math.min(30, over * Math.min(years, 4) * 0.35 * (c.opt === 2 ? 1.25 : 1));
    return { adj: -pen, tag: over >= tagGap(fair) ? 'Overpaid' : '' };
  }
  return { adj: Math.min(12, -over * years * 0.25), tag: -over >= tagGap(fair) ? 'Bargain' : '' };
}

// Rough value of a player: level and last season's production, youth and
// upside, age decline, and the contract.
export function playerValue(p, leagueIdx, year) {
  const l = seasonLine(p, leagueIdx, year);
  const gs = l ? Math.max(0, l.gs) * Math.min(1, l.gp / 40) : 0;
  const lv = levelOf(p);
  let v = gs * 2.1 + Math.max(0, lv - 60) * 1.25;     // a ~20 GS, level-100 star ≈ 92
  if (p.age <= 25) v += Math.max(0, p.pot - 5) * 6 * (26 - p.age) / 6;
  if (p.age > p.regressionAge) v *= Math.max(0.4, 1 - 0.12 * (p.age - p.regressionAge));
  v += contractValue(p).adj;
  return Math.max(1, v);
}

// assets: { picks: [pick objects], players: [player objects], prospects:
// [{ p, value }] } (prospects = already-drafted players in a live draft).
export function assetsValue(league, a, leagueIdx, year, curPickValue = null) {
  let v = 0;
  for (const pk of a.picks || []) v += pk.yr === league.season.currentYear && curPickValue ? curPickValue(pk) : pickValue(league, pk);
  for (const p of a.players || []) v += playerValue(p, leagueIdx, year);
  for (const x of a.prospects || []) v += x.value;
  return v;
}

// A CPU team takes a deal when it gets back more than it gives, by a margin.
export function cpuAccepts(give, get, margin = 1.08) {
  return get >= give * margin;
}

// Move a player between rosters, keeping the new season's stats row in step
// (the game rewrites that row's team and number on a move).
export function movePlayer(p, from, to, year) {
  const i = from.roster.indexOf(p);
  if (i < 0) throw new Error('Player not on that roster');
  from.roster.splice(i, 1);
  p.num = jerseyNumber(to, p);
  p.tid = to.id;
  p.linePos = to.roster.length;
  to.roster.push(p);
  const row = (p.stats || []).filter(s => s.yr === year).pop();
  const stint = row?.season?.[row.season.length - 1];
  if (stint && !stint.GP) { stint.tid = to.id; stint.num = p.num; }
}

// Execute a two-team trade. side = { team, picks, players }.
// Returns a record that undoTrade() reverses.
// The app logs every player trade (for the team page's Moves list).
let tradeHook = null;
export const setTradeHook = f => { tradeHook = f; };

export function executeTrade(A, B, year) {
  tradePicks(A.team, B.team, A.picks || [], B.picks || []);
  const moved = [];
  for (const p of A.players || []) { moved.push({ p, from: A.team, to: B.team, num: p.num, linePos: p.linePos, idx: A.team.roster.indexOf(p) }); movePlayer(p, A.team, B.team, year); }
  for (const p of B.players || []) { moved.push({ p, from: B.team, to: A.team, num: p.num, linePos: p.linePos, idx: B.team.roster.indexOf(p) }); movePlayer(p, B.team, A.team, year); }
  const rec = { A: A.team, B: B.team, picksA: A.picks || [], picksB: B.picks || [], moved, year };
  tradeHook?.('do', rec);
  return rec;
}

export function undoTrade(rec) {
  tradeHook?.('undo', rec);
  tradePicks(rec.A, rec.B, rec.picksB, rec.picksA);
  for (const m of [...rec.moved].reverse()) {
    movePlayer(m.p, m.to, m.from, rec.year);
    m.from.roster.splice(m.from.roster.indexOf(m.p), 1);
    m.from.roster.splice(m.idx, 0, m.p);
    m.p.num = m.num;
    m.p.linePos = m.linePos;
    const row = (m.p.stats || []).filter(s => s.yr === rec.year).pop();
    const stint = row?.season?.[row.season.length - 1];
    if (stint && !stint.GP) stint.num = m.num;
  }
}

export { samePick };
