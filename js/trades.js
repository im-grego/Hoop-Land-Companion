// Trades of players and draft picks (draft day and offseason), with a rough
// value model so CPU teams can accept or decline.

import { pickValue, tradePicks, samePick } from './draft.js';
import { seasonLine } from './storylines.js';
import { jerseyNumber, levelOf } from './savefile.js';

// Value of a pick in this draft by its overall slot (#1 ≈ 133, #10 ≈ 69,
// #30 ≈ 17, #60 ≈ 4), on the same scale as future picks' pickValue.
export const slotValue = overall => 3 + 130 * Math.exp(-0.075 * (overall - 1));

// A fair salary ($M a year) for a player's level: a max deal (~$50M) at
// 100, $30M at 90, $26M at 86, $12M at 72, the minimum below the mid-60s.
export const fairSalary = level => Math.max(2, Math.round(level >= 90 ? 30 + (level - 90) * 2 : level - 60));

// What a contract does to a player's trade value. Overpays cost more the
// longer they run; a player option means there's no getting out (it counts
// in full and a bit worse); a team option takes the edge off the last year;
// an expiring deal is mostly harmless and even worth a little as cap room.
// Returns { adj, tag } (tag: 'Expiring' | 'Overpaid' | 'Bargain' | '').
export function contractValue(p) {
  const c = p.contract || {};
  const yrs = c.yrs || 0, sal = c.sal || 0;
  if (!yrs || !sal) return { adj: 0, tag: '' };
  const fair = fairSalary(levelOf(p));
  const over = sal - fair;
  let years = yrs;
  if (c.opt === 1) years -= 0.5;                       // team option: can walk away from the last year
  if (yrs <= 1) {
    return { adj: over > 0 ? 2 - over * 0.15 : Math.min(4, -over * 0.2), tag: 'Expiring' };
  }
  if (over > 0) {
    const pen = Math.min(30, over * Math.min(years, 4) * 0.35 * (c.opt === 2 ? 1.25 : 1));
    return { adj: -pen, tag: over >= 6 ? 'Overpaid' : '' };
  }
  return { adj: Math.min(12, -over * years * 0.25), tag: -over >= 6 ? 'Bargain' : '' };
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
export function executeTrade(A, B, year) {
  tradePicks(A.team, B.team, A.picks || [], B.picks || []);
  const moved = [];
  for (const p of A.players || []) { moved.push({ p, from: A.team, to: B.team, num: p.num, linePos: p.linePos, idx: A.team.roster.indexOf(p) }); movePlayer(p, A.team, B.team, year); }
  for (const p of B.players || []) { moved.push({ p, from: B.team, to: A.team, num: p.num, linePos: p.linePos, idx: B.team.roster.indexOf(p) }); movePlayer(p, B.team, A.team, year); }
  return { A: A.team, B: B.team, picksA: A.picks || [], picksB: B.picks || [], moved, year };
}

export function undoTrade(rec) {
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
