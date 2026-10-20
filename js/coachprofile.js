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
  const yrs = c.contract?.yrs ?? 0, last = car.last, lastPct = last ? last.W / (last.W + last.L) : null;
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
