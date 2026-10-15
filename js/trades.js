// Trades of players and draft picks (draft day and offseason), with a rough
// value model so CPU teams can accept or decline.

import { pickValue, tradePicks, samePick } from './draft.js';
import { seasonLine } from './storylines.js';
import { jerseyNumber } from './savefile.js';

// Value of a pick in this draft by its overall slot (#1 ≈ 133, #10 ≈ 69,
// #30 ≈ 17, #60 ≈ 4), on the same scale as future picks' pickValue.
export const slotValue = overall => 3 + 130 * Math.exp(-0.075 * (overall - 1));

// Rough value of a player: last season's production, youth and upside,
// age decline, and salary.
export function playerValue(p, leagueIdx, year) {
  const l = seasonLine(p, leagueIdx, year);
  const gs = l ? Math.max(0, l.gs) * Math.min(1, l.gp / 40) : 0;
  let v = gs * 4.2;                                   // ~20 GS star ≈ 84
  if (p.age <= 25) v += Math.max(0, p.pot - 5) * 6 * (26 - p.age) / 6;
  if (p.age > p.regressionAge) v *= Math.max(0.4, 1 - 0.12 * (p.age - p.regressionAge));
  if (p.contract?.sal) v -= Math.max(0, p.contract.sal - gs * 1.2) * 0.6;
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
