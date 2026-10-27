// Coach profiles: scheme in the game's words, career record, job security and a
// plain-language philosophy, all read from the coach's own save data.

import { PLAN, planOption, COACH_ARCHETYPES, COACH_STRENGTHS } from './coaching.js';

export const archName = c => COACH_ARCHETYPES[c.arc] || 'Coach';
export const strengthName = i => COACH_STRENGTHS[i] || '';
// The game shows half the saved rating; stars are the saved potential in half-stars.
export const shownRating = (c, k) => (c.attributes?.[k]?.[0] ?? 0) / 2;
export const shownCeiling = (c, k) => (c.attributes?.[k]?.[1] ?? 0) / 2;
export const potentialStars = c => (c.pot || 0) / 2;

// The scheme as [{ group, items: [[label, option]] }].
export function schemeOf(c) {
  const t = c.tendencies || {};
  return PLAN.map(g => ({ group: g.group, items: g.keys.map(([k, label]) => [label, planOption(k, t[k] ?? 0)]) }));
}

// Career from the per-season rows: totals, titles, playoff trips, recent seasons.
export function careerOf(c) {
  const rows = (c.career?.teamHistory || []).map(h => {
    const s = h.season || [], W = s.reduce((a, x) => a + (x.W || 0), 0), L = s.reduce((a, x) => a + (x.L || 0), 0);
    return { yr: h.yr, tid: s[s.length - 1]?.tid, W, L, po: h.playoffs?.GP > 0 ? { W: h.playoffs.W, L: h.playoffs.L } : null, round: h.round || 0 };
  }).filter(r => r.W + r.L > 0);
  // Career line as the game's profile shows it: regular season plus playoffs.
  const cs = c.career?.season, cp = c.career?.playoffs;
  const haveCareer = cs && (cs.W || cs.L || cp?.W || cp?.L);
  const W = haveCareer ? cs.W + (cp?.W || 0) : rows.reduce((a, r) => a + r.W, 0);
  const L = haveCareer ? cs.L + (cp?.L || 0) : rows.reduce((a, r) => a + r.L, 0);
  const titles = (c.awards || []).reduce((a, x) => a + (x.yearsWon?.length || 0), 0);
  const titleYears = (c.awards || []).flatMap(x => x.yearsWon || []).sort();
  const po = rows.filter(r => r.po);
  return {
    rows, W, L, pct: W + L ? W / (W + L) : 0, seasons: rows.length || (W + L ? 1 : 0), titles, titleYears,
    playoffTrips: po.length, poW: cp?.W ?? po.reduce((a, r) => a + r.po.W, 0), poL: cp?.L ?? po.reduce((a, r) => a + r.po.L, 0),
    best: rows.reduce((b, r) => (!b || r.W / (r.W + r.L) > b.W / (b.W + b.L) ? r : b), null),
    last: rows[rows.length - 1] || null,
  };
}

// Job security from the deal and the last full season. A coach on a long deal
// or a winner is safe; a short deal after a losing year is the hot seat.
export function securityOf(c, car = careerOf(c)) {
  const yrs = (c.contract?.yrs ?? 0) + (c.contract?.ext?.yrs ?? 0), last = car.last, lastPct = last ? last.W / (last.W + last.L) : null;
  let tag, why;
  if (!yrs) { tag = 'Unsigned'; why = 'No contract.'; }
  else if (lastPct != null && lastPct < 0.4 && yrs <= 2) { tag = 'Hot Seat'; why = `A ${last.W}-${last.L} season with ${yrs === 1 ? 'one year' : 'two years'} left.`; }
  else if (yrs === 1) { tag = 'Final Year'; why = 'The last year of the deal.'; }
  else if (yrs >= 3 || (lastPct != null && lastPct >= 0.6)) { tag = 'Secure'; why = yrs >= 3 ? `${yrs} years left on the deal.` : `A ${last.W}-${last.L} season keeps him safe.`; }
  else { tag = 'Stable'; why = `${yrs} years left.`; }
  return { tag, why, yrs, sal: c.contract?.sal ?? 0 };
}

// A few sentences on how he coaches, built from archetype, scheme and strengths.
export function philosophyOf(c) {
  const t = c.tendencies || {}, name = planOption;
  const off = [], def = [], rot = [];
  const focus = name('offFocus', t.offFocus ?? 0);
  if (focus === 'Inside') off.push('runs the offense through the paint');
  else if (focus === 'Midrange') off.push('builds the offense around mid-range shot-making');
  else if (focus === 'Outside') off.push('lives on the three-point line');
  else off.push('keeps the offense balanced');
  if (t.offTempo === 1) off.push('pushes the pace');
  const orb = name('offRebounding', t.offRebounding ?? 0);
  if (orb === 'Crash Boards') off.push('sends players to the offensive glass');
  else if (orb === 'Get Back On D') off.push('sacrifices offensive rebounds to get back on defense');
  const df = name('defFocus', t.defFocus ?? 0);
  if (df === 'Interior') def.push('protects the paint first');
  else if (df === 'Perimeter') def.push('guards the perimeter first');
  const ag = name('defAggression', t.defAggression ?? 0);
  if (ag === 'Physical') def.push('plays physical, in-your-face defense');
  else if (ag === 'Conservative') def.push('stays conservative and avoids fouls');
  const dr = name('defRebounding', t.defRebounding ?? 0);
  if (dr === 'Crash Boards') def.push('crashes the defensive glass');
  else if (dr === 'Fast Break') def.push('leaks out to run after a miss');
  const bd = name('benchDepth', t.benchDepth ?? 0), bu = name('benchUtilization', t.benchUtilization ?? 0);
  if (bd === 'Deep') rot.push('goes deep into the bench');
  else if (bd === 'Short') rot.push('shortens the rotation');
  if (bu === 'High') rot.push('leans on his reserves');
  else if (bu === 'Low') rot.push('keeps his starters on the floor');
  rot.push(t.closingLineup === 1 ? 'closes with whoever is playing best' : 'closes with his starters');
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const join = a => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');
  const strong = [c.pri, c.sec].map(strengthName).filter(Boolean);
  const dev = { Development: 'a teacher who gets young players better', Motivation: 'a motivator who gets the most from his group', Leadership: 'a leader whose locker room follows him' };
  const bits = [`${cap(join(off))}.`, def.length ? `${cap(join(def))}.` : '', `${cap(join(rot))}.`].filter(Boolean).join(' ');
  return `${archName(c)}. ${bits}${strong.length ? ` ${strong.length > 1 ? `Best known as ${dev[strong[0]]}, and also ${dev[strong[1]]}.` : `Best known as ${dev[strong[0]]}.`}` : ''}`;
}

// How good he is now and how far he can go. Level is the mean of his three
// shown ratings (0-10), ranked against the league's head coaches; the ceiling
// is the mean of his three ratings' caps. Room to grow is the gap, read with
// his age (older coaches rarely reach the cap).
const KEYS = ['development', 'motivation', 'leadership'];
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
export const coachLevel = c => mean(KEYS.map(k => shownRating(c, k)));
export const coachCeiling = c => mean(KEYS.map(k => shownCeiling(c, k)));
export function coachGrade(c, field = []) {
  const now = coachLevel(c), ceil = Math.max(now, coachCeiling(c));
  const lv = field.map(coachLevel);
  const below = lv.filter(v => v < now).length, same = lv.filter(v => v === now).length;
  const pct = lv.length ? (below + same / 2) / lv.length : 0.5;
  const tier = pct >= 0.9 ? 'Elite' : pct >= 0.7 ? 'Strong' : pct >= 0.4 ? 'Solid' : pct >= 0.15 ? 'Below Average' : 'Weak';
  const room = ceil - now;
  const young = c.age <= 45, old = c.age >= 58;
  const growth = room < 0.75 ? 'At his ceiling' : room < 1.75 ? (old ? 'Little room left' : 'Some room to grow') : (old ? 'Room on paper, short on time' : 'A lot of room to grow');
  const rank = lv.length ? lv.filter(v => v > now).length + 1 : null;
  const line = `${tier} coach${rank ? ` (#${rank} of ${lv.length})` : ''}. ${growth}${room >= 0.75 ? `: ${now.toFixed(1)} now, up to ${ceil.toFixed(1)}` : ''}.${young && room >= 1.75 ? ' Young enough to get there.' : ''}`;
  return { now, ceil, room, tier, growth, rank, of: lv.length, line };
}

// What a free-agent coach asks for: three years, priced on the real market:
// about $3M at the bottom, $8M to $10M for the going rate, $17M for the best.
export function askingContract(c, field = []) {
  const g = coachGrade(c, field), pct = field.length ? (g.of - (g.rank || 1)) / Math.max(1, g.of - 1) : 0.5;
  const q = Math.max(0, Math.min(1, pct));
  return { yrs: 3, sal: Math.round(3 + 12 * q + 2 * q * q) };
}

// Swap the pool coach in as the team's head coach; the old one goes to the pool.
// The free-agent coach pool, the way the game keeps it: no team, free (status 3), an empty contract. A coach who goes
// back to the pool with pieces of his old job (still marked hired, his team or his own id left on the contract)
// doesn't show up as available in the game. Returns how many were cleaned.
// A coach the game has marked as passed away (cause of death set, status 4) stays where the game left him: never
// hireable, never "cleaned" back to available.
export const coachGone = c => (c?.causeOfDeath || 0) > 0 || c?.status === 4;
export function cleanCoachPool(league) {
  let n = 0;
  for (const c of league.coaches || []) {
    if (coachGone(c)) continue;
    const ok = c.tid === 0 && c.status === 3 && c.contract && !c.contract.tid && !c.contract.pid && !c.contract.yrs && !c.contract.sal;
    if (ok) continue;
    c.tid = 0; c.status = 3;
    c.contract = { tid: 0, pid: 0, type: 0, yrs: 0, sal: 0, nil: 0, opt: 0, noTrd: 0, canExt: true, ext: { yrs: 0, sal: 0, opt: 0, noTrd: 0 } };
    n++;
  }
  return n;
}
export function hireHeadCoach(league, team, coach) {
  const staff = team.frontOffice?.staff || [];
  const i = staff.findIndex(s => s.pos === 1);
  if (i < 0) return null;
  const old = staff[i], ask = askingContract(coach, league.teams.map(t => (t.frontOffice?.staff || []).find(s => s.pos === 1)).filter(Boolean));
  const empty = tid => ({ tid, pid: 0, type: 0, yrs: 0, sal: 0, nil: 0, opt: 0, noTrd: 0, canExt: true, ext: { yrs: 0, sal: 0, opt: 0, noTrd: 0 } });
  const pool = league.coaches || (league.coaches = []);
  const j = pool.indexOf(coach);
  if (j >= 0) pool.splice(j, 1);
  coach.tid = team.id; coach.status = 1; coach.pos = 1;
  coach.contract = { tid: team.id, pid: coach.id, type: 0, yrs: ask.yrs, sal: ask.sal, nil: 0, opt: 0, noTrd: 0, canExt: false, ext: { yrs: 0, sal: 0, opt: 0, noTrd: 0 } };
  staff[i] = coach;
  old.tid = 0; old.status = 3; old.contract = empty(0);
  pool.push(old);
  return { old, ask };
}
