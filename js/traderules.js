// Trade rules beyond the salary math (freeagency.tradeCheck): open roster
// spots, the Stepien rule, lottery picks before the lottery, and pick
// protections. Sides are { team, players, picks }.

import { signedRoster, FA_DEFAULTS } from './freeagency.js';

// A team taking back more players than it sends needs the roster spots.
export function rosterErr(A, B, max = FA_DEFAULTS.rosterMax) {
  for (const [me, them] of [[A, B], [B, A]]) {
    const out = (me.players || []).length, inn = (them.players || []).length;
    const n = signedRoster(me.team).length;
    if (inn > out && n - out + inn > max) return `${me.team.shortName} need an open roster spot (${n}/${max})`;
  }
  return null;
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
export function stepienErr(league, A, B, prot = () => false) {
  for (const [me, them] of [[A, B], [B, A]]) {
    const out = me.picks || [], inn = them.picks || [];
    if (!out.some(pk => pk.rd === 1)) continue;
    const after = me.team.draftPicks.filter(pk => !out.includes(pk)).concat(inn);
    if (gaps(league, me.team, after, prot) > gaps(league, me.team, me.team.draftPicks, prot)) {
      return `${me.team.shortName} can't go two straight drafts without a first-round pick (Stepien rule)`;
    }
  }
  return null;
}

// Pick protections: top-N protected; if it lands in the top N it goes back
// to the team that protected it and the holder gets that team's 2nd that
// year instead. Value to the holder drops with the protection.
export const PROTECTIONS = [0, 4, 10, 14, 20];
export const protFactor = top => ({ 0: 1, 4: 0.88, 10: 0.72, 14: 0.62, 20: 0.48 }[top] ?? 1);

// Settle this year's protected picks once the order is set (pk.pk is the
// 0-based slot). `ledger` is [{ otid, yr, top, from }]; returns what
// happened: [{ entry, kept, holder, back }].
export function settleProtections(league, ledger) {
  const yr = league.season.currentYear;
  const out = [];
  for (const e of ledger.filter(x => x.yr === yr && !x.done)) {
    const holder = league.teams.find(t => t.draftPicks.some(pk => pk.yr === yr && pk.rd === 1 && pk.otid === e.otid));
    const pk = holder?.draftPicks.find(x => x.yr === yr && x.rd === 1 && x.otid === e.otid);
    if (!pk) { e.done = true; continue; }
    const from = league.teams.find(t => t.id === e.from);
    const kept = pk.pk < e.top && from && holder !== from;
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
