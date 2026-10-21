// Trade rules beyond the salary math (freeagency.tradeCheck): open roster
// spots, the Stepien rule, lottery picks before the lottery, and pick
// protections. Sides are { team, players, picks }.

import { signedRoster, FA_DEFAULTS } from './freeagency.js';

// A team taking back more players than it sends needs the roster spots.
export function rosterErrTeam(team, outN, inN, max = FA_DEFAULTS.rosterMax) {
  const n = signedRoster(team).length;
  return inN > outN && n - outN + inN > max ? `${team.shortName} need an open roster spot (${n}/${max})` : null;
}
export function rosterErr(A, B, max) {
  return rosterErrTeam(A.team, (A.players || []).length, (B.players || []).length, max) || rosterErrTeam(B.team, (B.players || []).length, (A.players || []).length, max);
}

// Stepien rule: a team can't go two straight drafts without a first. A
// protected pick doesn't count for the team holding it (it might not
// convey). Gaps already on the books stand; a trade can't add one.
function gaps(league, team, picks, prot) {
  const cur = league.season.currentYear;
  const all = league.teams.flatMap(t => t.draftPicks);
  if (!all.length) return 0;
  const first = all.some(pk => pk.yr === cur) ? cur : cur + 1;
  const last = Math.max(...all.map(pk => pk.yr));
  const has = y => picks.some(pk => pk.rd === 1 && pk.yr === y && !(prot(pk) && pk.otid !== team.id));
  let n = 0;
  for (let y = first; y < last; y++) if (!has(y) && !has(y + 1)) n++;
  return n;
}
export function stepienTeam(league, team, out, inn, prot = () => false) {
  if (!out.some(pk => pk.rd === 1)) return null;
  const after = team.draftPicks.filter(pk => !out.includes(pk)).concat(inn);
  return gaps(league, team, after, prot) > gaps(league, team, team.draftPicks, prot)
    ? `${team.shortName} can't go two straight drafts without a first-round pick (Stepien rule)` : null;
}
export function stepienErr(league, A, B, prot) {
  return stepienTeam(league, A.team, A.picks || [], B.picks || [], prot) || stepienTeam(league, B.team, B.picks || [], A.picks || [], prot);
}
// Touch rule: in a three-team deal every team must send or receive an asset
// with each of the other two. flows = [{ team, sendTo: Map(teamId -> count) }].
export function touchErr(moves, teams) {
  for (const t of teams) for (const u of teams) {
    if (t === u) continue;
    if (!moves.some(m => (m.from === t.id && m.to === u.id) || (m.from === u.id && m.to === t.id))) return `${t.shortName} and ${u.shortName} have to swap something directly (touch rule)`;
  }
  return null;
}

// Pick protections: top-N protected; if it lands in the top N it goes back
// to the team that protected it and the holder gets that team's 2nd that
// year instead. Value to the holder drops with the protection.
export const LOTTERY_PROT = 99;                    // "lottery protected": the size of the lottery (14 or 16) is read when the pick settles
export const PROTECTIONS = [0, 3, 8, LOTTERY_PROT];

// Settle this year's protected picks once the order is set (pk.pk is the
// 0-based slot). `ledger` is [{ otid, yr, top, from }]; returns what
// happened: [{ entry, kept, holder, back }].
export function settleProtections(league, ledger, lotteryN = 14) {
  const yr = league.season.currentYear;
  const out = [];
  for (const e of ledger.filter(x => x.yr === yr && !x.done)) {
    const holder = league.teams.find(t => t.draftPicks.some(pk => pk.yr === yr && pk.rd === 1 && pk.otid === e.otid));
    const pk = holder?.draftPicks.find(x => x.yr === yr && x.rd === 1 && x.otid === e.otid);
    if (!pk) { e.done = true; continue; }
    const from = league.teams.find(t => t.id === e.from);
    const kept = pk.pk < (e.top >= LOTTERY_PROT ? lotteryN : e.top) && from && holder !== from;
    let back = null;
    if (kept) {
      holder.draftPicks.splice(holder.draftPicks.indexOf(pk), 1);
      pk.tid = from.id;
      from.draftPicks.push(pk);
      back = from.draftPicks.find(x => x.yr === yr && x.rd === 2 && x.otid === from.id) || null;
      if (back) { from.draftPicks.splice(from.draftPicks.indexOf(back), 1); back.tid = holder.id; holder.draftPicks.push(back); }
    }
    e.done = true;
    e.result = kept ? 'kept' : 'conveyed';
    out.push({ entry: e, kept, holder, from, back, slot: pk.pk + 1 });
  }
  return out;
}

// Pick swaps: { yr, rd, a, b, x, y, mode } - team a holds pick x, team b holds pick y; once the order is set,
// a gets the better ('best') or worse ('worst') of the two and b gets the other.
export function settleSwaps(league, ledger) {
  const yr = league.season.currentYear;
  const out = [];
  for (const e of ledger.filter(v => v.yr === yr && !v.done)) {
    const find = otid => { for (const t of league.teams) { const pk = t.draftPicks.find(q => q.yr === yr && q.rd === e.rd && q.otid === otid); if (pk) return { t, pk }; } return null; };
    const X = find(e.x), Y = find(e.y);
    const a = league.teams.find(t => t.id === e.a), b = league.teams.find(t => t.id === e.b);
    e.done = true;
    if (!X || !Y || !a || !b) continue;
    const better = X.pk.pk <= Y.pk.pk ? X : Y, worse = better === X ? Y : X;
    const gets = e.mode === 'best' ? better : worse, other = gets === X ? Y : X;
    // team a ends up with `gets`, team b with `other`
    const give = [[gets, a], [other, b]];
    let swapped = false;
    for (const [it, to] of give) if (it.t !== to) swapped = true;
    if (swapped) for (const [it, to] of give) { it.t.draftPicks.splice(it.t.draftPicks.indexOf(it.pk), 1); }
    if (swapped) for (const [it, to] of give) { it.pk.tid = to.id; to.draftPicks.push(it.pk); }
    e.result = swapped ? 'swapped' : 'stayed';
    out.push({ entry: e, a, b, swapped, got: gets.pk, slotA: gets.pk.pk + 1, slotB: other.pk.pk + 1 });
  }
  return out;
}
