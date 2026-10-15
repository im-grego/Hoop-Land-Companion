// Live draft: run the draft in the app (with trades) and write the result
// into a Pre-Draft save the way the game itself does, leaving it at the
// Post-Draft phase.
//
// What the game does at the draft (from comparing a save before and after):
// - drafted prospects join their team's roster (status 2, `tid`, draft
//   history { yr, rd, pk: overall 1-based, tid: drafting team, otid: 0 }),
//   undrafted prospects become free agents (status 5);
// - the −4 draft drop on the 12 skill ratings (current value only, never
//   below 2);
// - college career stats move to history.collegeStats, career, game and
//   season stats reset, years in college move to history.yrs;
// - a zeroed stats row for the new season is added;
// - every team's picks for this draft (and older) are removed;
// - one news item per pick; the phase goes 4 → 5.

import { draftDrop, SKILL_ATTRS } from './draft.js';
import { PHASE_PRE_DRAFT, PHASE_POST_DRAFT, jerseyNumber } from './savefile.js';

const KEEP = new Set(['tid', 'num']);

// Zero every number (and number array) in a stats object, keeping tid/num.
function zeroed(obj) {
  if (Array.isArray(obj)) return obj.map(v => (typeof v === 'number' ? 0 : zeroed(v)));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = KEEP.has(k) ? v : typeof v === 'number' ? 0 : zeroed(v);
    return out;
  }
  return obj;
}
function zeroInPlace(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (KEEP.has(k)) continue;
    if (typeof v === 'number') obj[k] = 0;
    else if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === 'number') v[i] = 0; else if (x && typeof x === 'object') zeroInPlace(x); });
    else if (v && typeof v === 'object') zeroInPlace(v);
  }
}

// history.collegeStats += careerStats (sums; highs take the max).
function archiveCollegeStats(p) {
  const into = p.history.collegeStats, from = p.careerStats;
  if (!into || !from) return;
  for (const [part, src] of Object.entries(from)) {
    const dst = into[part];
    if (!dst) continue;
    const high = /Highs$/.test(part);
    for (const [k, v] of Object.entries(src)) {
      if (KEEP.has(k)) continue;
      if (typeof v === 'number') dst[k] = high ? Math.max(dst[k] || 0, v) : (dst[k] || 0) + v;
      else if (Array.isArray(v)) v.forEach((x, i) => { dst[k][i] = high ? Math.max(dst[k][i] || 0, x) : (dst[k][i] || 0) + x; });
    }
  }
}

// Reset a prospect the way the game does when the draft is held.
function resetProspect(p, leagueIdx, year, tid) {
  archiveCollegeStats(p);
  zeroInPlace(p.careerStats);
  zeroInPlace(p.gameStats);
  p.minutes = p.minutes.map(() => 0);
  p.season.xp = p.season.xp.map(() => 0);
  p.season.ap = p.season.ap.map(() => 0);
  zeroInPlace(p.season.injury);
  p.history.yrs = (p.history.yrs || 0) + (p.yrs || 0);
  p.yrs = 0;
  Object.assign(p.contract, { tid: 0, pid: 0, yrs: 0, sal: 0 });
  for (const k of SKILL_ATTRS) p.attributes[k][0] = draftDrop(p.attributes[k][0]);
  const template = zeroed(p.careerStats.season);
  p.stats.push({ league: leagueIdx, yr: year, sal: 0, season: [{ ...template, tid, num: p.num }], playoffs: [], finals: [] });
}

// One news item, shaped like the game's (cloned from an existing item).
function draftNews(league, template, { pid, tid, rd, pk, year, rating }) {
  const n = structuredClone(template);
  zeroInPlace(n.data);
  Object.assign(n, { league: n.league, rating, date: 0, phase: PHASE_PRE_DRAFT, category: 0, type: 2, tid, pid, gid: 0, read: false });
  Object.assign(n.data.contract, { canExt: true });
  n.data.draftPick = { pk, rd, tid, otid: 0, yr: year };
  if (n.data.trade) { n.data.trade.teams = []; n.data.trade.tradeGap = -1; }
  if (n.data.facility) n.data.facility.condition = 5;
  return n;
}

// picks: [{ rd, overall, by (drafting team id), to (final team id), pid }]
// in draft order. Mutates the league. Returns { drafted, undrafted }.
export function applyDraft(league, picks, leagueIdx = 0) {
  if (league.season.phase !== PHASE_PRE_DRAFT) throw new Error('The save must be at the Pre-Draft phase.');
  const year = league.season.currentYear;
  const teams = new Map(league.teams.map(t => [t.id, t]));
  const prospects = new Map(league.draftClass.map(p => [p.id, p]));
  const news = league.season.news;
  const template = news.find(n => n.data?.draftPick) || news[0];
  let drafted = 0;
  for (const pk of picks) {
    const p = prospects.get(pk.pid);
    const team = teams.get(pk.to);
    if (!p || !team) continue;
    prospects.delete(pk.pid);
    p.num = jerseyNumber(team, p);
    resetProspect(p, leagueIdx, year, team.id);
    p.tid = team.id;
    p.status = 2;
    p.contract.canExt = true;
    Object.assign(p.history.draft, { yr: year, rd: pk.rd, pk: pk.overall, tid: pk.by, otid: 0 });
    p.linePos = team.roster.length;
    p.posRnk = team.roster.filter(x => x.teamPos === p.teamPos).length;
    team.roster.push(p);
    if (template) news.push(draftNews(league, template, { pid: p.id, tid: pk.by, rd: pk.rd, pk: pk.overall, year, rating: pk.overall <= 13 && p.pot >= 9 ? 6 : 5 }));
    drafted++;
  }
  // Everyone left goes to free agency.
  const undrafted = [...prospects.values()];
  for (const p of undrafted) {
    resetProspect(p, leagueIdx, year, 0);
    p.status = 5;
    for (const s of p.stats) if (s.league !== leagueIdx) s.sal = 0;
    league.freeAgents.push(p);
  }
  league.draftClass.length = 0;
  for (const t of league.teams) t.draftPicks = t.draftPicks.filter(pk => pk.yr > year);
  league.season.phase = PHASE_POST_DRAFT;
  return { drafted, undrafted: undrafted.length };
}

// ---------------------------------------------------------------------------
// Live draft session. Picks are recorded in `live.sel` (overall -> { pid, by,
// to, at }) and only written to the save by applyDraft() at the end; pick
// and player trades go straight into the save (and can be undone).

export function newLiveDraft() {
  return { sel: {}, trades: [], log: [] };
}

// The next pick without a selection, as an index into `order`.
export const clockIndex = (live, order) => order.findIndex(o => !live.sel[o.overall]);

export function makeSelection(live, order, idx, pid) {
  const o = order[idx];
  live.sel[o.overall] = { pid, by: o.owner.id, to: o.owner.id, at: idx };
  live.log.push({ type: 'pick', overall: o.overall });
}

export function takenIds(live) {
  return new Set(Object.values(live.sel).map(s => s.pid));
}

// A drafted player can still be moved in a draft-and-trade for `window`
// picks after being taken.
export function tradeableProspects(live, order, teamId, window = 8) {
  const now = clockIndex(live, order);
  const cur = now < 0 ? order.length : now;
  return Object.entries(live.sel)
    .filter(([, s]) => s.to === teamId && cur - s.at <= window)
    .map(([overall, s]) => ({ overall: +overall, ...s }));
}

export function livePicks(live, order) {
  return order.filter(o => live.sel[o.overall]).map(o => {
    const s = live.sel[o.overall];
    return { rd: o.rd, overall: o.overall, by: s.by, to: s.to, pid: s.pid };
  });
}

// This year's pick object behind a slot in the order.
export function slotPick(league, o) {
  const yr = league.season.currentYear;
  return o.owner.draftPicks.find(pk => pk.yr === yr && pk.rd === o.rd && pk.otid === o.orig.id);
}

// Trade-up offers for the team on the clock: teams picking 3–8 slots later
// offer their pick plus future picks for this one. `value(pk)` values a
// future pick, `slot(overall)` a pick in this draft. Returns
// [{ team, give: [pick objects], get: pick object, worth }].
export function tradeUpOffers(league, order, idx, { value, slot, rng, min = 3, max = 8, count = 2, eager = 0.5 }) {
  const here = order[idx];
  const target = slotPick(league, here);
  if (!target) return [];
  const want = slot(here.overall);
  const offers = [];
  const seen = new Set([here.owner.id]);
  for (let j = idx + min; j <= Math.min(order.length - 1, idx + max); j++) {
    const o = order[j];
    if (seen.has(o.owner.id) || o.rd !== here.rd) continue;
    seen.add(o.owner.id);
    if (rng() > eager) continue;
    const mine = slotPick(league, o);
    if (!mine) continue;
    const give = [mine];
    let total = slot(o.overall);
    const future = o.owner.draftPicks.filter(pk => pk.yr > league.season.currentYear).sort((a, b) => value(a) - value(b));
    for (const pk of future) {
      if (total >= want * 1.05) break;
      if (pk.rd === 1 && give.some(g => g.rd === 1 && g !== mine)) break;    // at most one future first
      give.push(pk);
      total += value(pk);
    }
    if (total >= want * 1.05 && total <= want * 1.6) offers.push({ team: o.owner, give, get: target, worth: total, from: o.overall });
    if (offers.length >= count) break;
  }
  return offers;
}

// ---------------------------------------------------------------------------
// Rookie contracts. The game signs this year's draft picks on Free Agency
// Day 1: first-rounders get a 4-year scale deal with a team option (opt 1),
// second-rounders the same 4 years at the minimum. This shortens
// second-round deals (team option kept). Returns [{ p, before }] for undo.

export function rookieContractTargets(league, r2Years = 2) {
  const yr = league.season.currentYear;
  const out = [];
  for (const t of league.teams) {
    for (const p of t.roster) {
      const d = p.history?.draft;
      if (d?.yr === yr && d.rd === 2 && p.contract?.yrs > r2Years) out.push(p);
    }
  }
  return out;
}

export function applyRookieContracts(league, r2Years = 2) {
  return rookieContractTargets(league, r2Years).map(p => {
    const before = { yrs: p.contract.yrs, opt: p.contract.opt };
    p.contract.yrs = r2Years;
    p.contract.opt = 1;
    return { p, before };
  });
}

export function undoRookieContracts(changes) {
  for (const { p, before } of changes) Object.assign(p.contract, before);
}
