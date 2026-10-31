// A coach's own system and how it evolves. Every coach has a signature
// playbook from his philosophy and installs it when he arrives. After that
// the roster pulls on it: big signings, high picks and years together move the
// playbook (and sometimes his offensive focus) toward what the group does best.

import { PRESETS } from './plays.js';
import { playStyles } from './overview.js';
import { shownLevel } from './regression.js';
import { planOption } from './coaching.js';

const KEYS = ['creator', 'shooter', 'rim', 'mid', 'post', 'playmaker', 'lob'];
export const STYLE_WORD = { creator: 'shot creation', shooter: 'shooting', rim: 'rim attacking', mid: 'mid-range scoring', post: 'post scoring', playmaker: 'playmaking', lob: 'lob finishing' };
// What each playbook leans on.
const PRESET_VEC = {
  'Pace & Space': { creator: 0.4, shooter: 0.25, rim: 0.15, playmaker: 0.2 },
  'Iso & Spread': { creator: 0.45, rim: 0.2, shooter: 0.2, mid: 0.15 },
  'Flow Offense': { playmaker: 0.35, shooter: 0.25, mid: 0.15, rim: 0.1, lob: 0.15 },
  'Off-Ball Movement': { shooter: 0.5, playmaker: 0.2, mid: 0.15, creator: 0.15 },
  'Inside-Out': { post: 0.4, playmaker: 0.2, rim: 0.15, lob: 0.1, shooter: 0.15 },
  'Half-Court Grind': { post: 0.3, mid: 0.25, rim: 0.2, creator: 0.15, lob: 0.1 },
};
const FOCUS_KEYS = { Inside: ['rim', 'post', 'lob'], Midrange: ['mid', 'creator'], Outside: ['shooter', 'playmaker'] };
const FOCUS_ID = { Inside: 1, Midrange: 2, Outside: 3 };

const vec = o => KEYS.map(k => o[k] || 0);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cos = (a, b) => { const d = Math.sqrt(dot(a, a) * dot(b, b)); return d ? dot(a, b) / d : 0; };
const share = (v, keys) => keys.reduce((s, k) => s + (v[KEYS.indexOf(k)] || 0), 0);

// What the roster is built to do: its top nine, weighted by level, stars counting extra.
export function rosterVector(team) {
  const top = [...team.roster].filter(p => p.status !== 4).sort((a, b) => shownLevel(b) - shownLevel(a)).slice(0, 9);
  const v = KEYS.map(() => 0);
  for (const p of top) {
    const lv = shownLevel(p), w = (lv / 100) ** 2 * (lv >= 86 ? 1.4 : 1);
    playStyles(p, 3).forEach((s, i) => { const k = KEYS.indexOf(s.k); if (k >= 0) v[k] += w * (1 - i * 0.25); });
  }
  const t = v.reduce((a, b) => a + b, 0) || 1;
  return v.map(x => x / t);
}
// What his offense asks for, from his own settings.
export function coachVector(coach) {
  const t = coach.tendencies || {}, o = {};
  const f = planOption('offFocus', t.offFocus ?? 0);
  if (f === 'Inside') Object.assign(o, { rim: 0.3, post: 0.3, lob: 0.1, playmaker: 0.15 });
  else if (f === 'Midrange') Object.assign(o, { mid: 0.45, creator: 0.2, playmaker: 0.1 });
  else if (f === 'Outside') Object.assign(o, { shooter: 0.5, playmaker: 0.15, creator: 0.1 });
  else for (const k of KEYS) o[k] = 0.14;
  if (t.offTempo === 1) { o.creator = (o.creator || 0) + 0.1; o.rim = (o.rim || 0) + 0.1; }
  if (planOption('offRebounding', t.offRebounding ?? 0) === 'Crash Boards') { o.post = (o.post || 0) + 0.05; o.rim = (o.rim || 0) + 0.05; }
  return vec(o);
}
const best = v => PRESETS.map(p => ({ p, s: cos(v, vec(PRESET_VEC[p.name] || {})) })).sort((a, b) => b.s - a.s)[0].p;
// The playbook he brings: his philosophy, whatever the roster looks like.
export const signatureOf = coach => best(coachVector(coach)).name;
export const focusOfRoster = rv => Object.entries(FOCUS_KEYS).map(([f, keys]) => [f, share(rv, keys)]).sort((a, b) => b[1] - a[1])[0];

// How far the roster pulls on the system this summer (0 to ~0.85), and why.
export function rosterPull(league, team, coach, { yrsWith = 0, signed = new Set(), fx = {} } = {}) {
  const cur = league.season.currentYear, reasons = [];
  let w = 0.12 * Math.min(3, yrsWith);
  if (yrsWith >= 1) reasons.push(`${yrsWith} season${yrsWith > 1 ? 's' : ''} together`);
  for (const p of team.roster) {
    const lv = shownLevel(p), st = playStyles(p, 1)[0];
    if (signed.has(p.id) && lv >= 80) { w += 0.18; reasons.push(`signed ${p.fn} ${p.ln}${st ? `, a ${STYLE_WORD[st.k] || st.label.toLowerCase()} player` : ''}`); }
    const d = p.history?.draft;
    if (d && d.yr === cur && d.rd === 1 && d.pk <= 10) { w += 0.15; reasons.push(`drafted ${p.fn} ${p.ln} at #${d.pk}${st ? `, a ${STYLE_WORD[st.k] || st.label.toLowerCase()} player` : ''}`); }
  }
  const age = coach.age >= 60 ? 0.7 : coach.age <= 45 ? 1.15 : 1;
  return { w: Math.max(0, Math.min(0.85, w * age * (fx.adapt || 1) * (fx.hold || 1))), reasons };
}

// Where his system lands this summer: a playbook and, when the pull is strong, an offensive focus.
export function evolve(league, team, coach, opts = {}) {
  const first = !!opts.first, rv = rosterVector(team), cv = coachVector(coach);
  const { w, reasons } = first ? { w: 0, reasons: [] } : rosterPull(league, team, coach, opts);
  const score = p => { const v = vec(PRESET_VEC[p.name] || {}); return (1 - w) * cos(cv, v) + w * cos(rv, v); };
  const style = [...PRESETS].sort((a, b) => score(b) - score(a))[0].name;
  let focus = null;
  const curFocus = planOption('offFocus', coach.tendencies?.offFocus ?? 0);
  const [top, topShare] = focusOfRoster(rv);
  const curShare = FOCUS_KEYS[curFocus] ? share(rv, FOCUS_KEYS[curFocus]) : 0.3;
  if (!first && w >= 0.4 && top !== curFocus && topShare - curShare >= 0.1) focus = top;
  return { style, focus, focusId: focus ? FOCUS_ID[focus] : null, w, reasons: first ? ['his own philosophy'] : reasons, rosterStyle: KEYS[rv.indexOf(Math.max(...rv))] };
}
