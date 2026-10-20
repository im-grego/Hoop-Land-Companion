// The team meeting: after the coach talks to the group, every player's play
// style and personality shift a little. Nothing is chosen by hand; it follows
// the coach (development decides how much room there is to move, leadership
// how hard he pushes his scheme and the leadership traits, motivation the
// drive traits), the player (traits, age) and his own ratings.

import { TEND_ATTR } from './autoplay.js';
import { planOption } from './coaching.js';
import { TRAITS } from './traits.js';

// Each trait answers to one side of the coach. Leadership sets the tone and
// the standard; motivation is the drive and the habits. Money is the odd one:
// a coach pulls it down (team-friendly).
export const LEAD_TRAITS = ['winning', 'playoffRiser', 'lockerRoom', 'loyalty'];
export const MOTIV_TRAITS = ['motor', 'durability', 'money'];
export const traitSide = k => (LEAD_TRAITS.includes(k) ? 'leadership' : MOTIV_TRAITS.includes(k) ? 'motivation' : null);
const GOAL = { money: -1 };
export const traitName = k => TRAITS.find(t => t.k === k)?.label || k;

const shown = (c, k) => (c?.attributes?.[k]?.[0] ?? 0) / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// What his offense and defense lean on, as a tendency nudge (about -2 to +2).
function schemeBias(coach) {
  const t = coach?.tendencies || {}, b = {};
  const add = (k, v) => { b[k] = (b[k] || 0) + v; };
  const f = planOption('offFocus', t.offFocus ?? 0);
  if (f === 'Inside') { add('post', 2); add('hook', 1); add('dunk', 1); add('floater', 1); add('threePoint', -1); }
  if (f === 'Midrange') { add('twoPoint', 2); add('fades', 1); add('pumpFake', 1); add('dunk', -1); }
  if (f === 'Outside') { add('threePoint', 2); add('step', 1); add('post', -1); add('hook', -1); }
  if (t.offTempo === 1) { add('runPlay', 1); add('cross', 1); add('floater', 1); }
  if (planOption('offRebounding', t.offRebounding ?? 0) === 'Crash Boards') add('offReb', 2);
  if (planOption('defRebounding', t.defRebounding ?? 0) === 'Crash Boards') add('defReb', 2);
  const df = planOption('defFocus', t.defFocus ?? 0);
  if (df === 'Interior') { add('block', 1); add('takeCharge', 1); }
  if (df === 'Perimeter') { add('stealOnBall', 1); add('stealOffBall', 1); }
  if (planOption('defAggression', t.defAggression ?? 0) === 'Physical') add('takeCharge', 1);
  return b;
}

// How ready he is to change: his own makeup, his age and a good teacher.
export function receptivity(p, coach) {
  const tr = k => (p.traits?.[k] > 0 ? p.traits[k] : 10);
  const age = p.age <= 24 ? 0.15 : p.age >= 31 ? -0.15 : 0;
  return clamp(0.55 + (tr('motor') - 10) * 0.02 + (tr('lockerRoom') - 10) * 0.01 + age + shown(coach, 'development') * 0.02, 0.35, 0.95);
}

// Shifts available to him this summer, from the scheme tier's influence plus what a good development coach adds.
export function shiftBudget(p, coach, base) {
  const dev = shown(coach, 'development');
  const high = (p.pot || 0) >= 8 && p.age <= 25 ? 1 : 0;
  return clamp(base + (dev >= 8 ? 2 : dev >= 6 ? 1 : 0) + high, 2, 9);
}

// One player's meeting. Returns { tend: [[key, change]], traits: [[key, change]], moves }.
export function runMeeting(p, coach, { base = 2, lim = 3, rng = Math.random } = {}) {
  const out = { tend: [], traits: [], moves: 0 };
  const rec = receptivity(p, coach), lead = shown(coach, 'leadership'), motiv = shown(coach, 'motivation');
  // Play style: step toward what his ratings support, leaned toward the coach's scheme.
  const t = p.tendencies;
  if (t && p.attributes) {
    const bias = schemeBias(coach), pull = 0.3 + lead / 20, orig = { ...t };
    const target = k => clamp(Math.round((((p.attributes[TEND_ATTR[k]]?.[0] ?? 10) - 10) * 0.5) + (bias[k] || 0) * pull), -5, 5);
    const keys = Object.keys(TEND_ATTR).filter(k => t[k] !== undefined);
    let budget = shiftBudget(p, coach, base), guard = 0;
    while (budget > 0 && guard++ < 30) {
      const want = keys.map(k => ({ k, d: target(k) - (t[k] || 0) })).filter(x => x.d !== 0 && Math.abs((t[x.k] || 0) + Math.sign(x.d) - (orig[x.k] || 0)) <= lim)
        .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
      if (!want.length) break;
      const { k, d } = want[0];
      budget--;
      if (rng() < rec) t[k] = clamp((t[k] || 0) + Math.sign(d), -5, 5);
    }
    for (const k of keys) if ((t[k] || 0) !== (orig[k] || 0)) { out.tend.push([k, (t[k] || 0) - (orig[k] || 0)]); out.moves += Math.abs((t[k] || 0) - (orig[k] || 0)); }
  }
  // Personality: leadership moves the standard-setting traits, motivation the drive ones. A strong coach lifts them;
  // a weak one can let them slip.
  if (p.traits) {
    for (const k of [...LEAD_TRAITS, ...MOTIV_TRAITS]) {
      const v = p.traits[k];
      if (!(v > 0)) continue;
      const rating = traitSide(k) === 'leadership' ? lead : motiv, goal = GOAL[k] || 1;
      const room = goal > 0 ? (20 - v) / 20 : (v - 1) / 20;
      const up = clamp((rating - 5) / 14, 0, 0.6) * rec * (0.4 + room), down = rating < 6 ? (6 - rating) / 14 * 0.5 : 0.03;
      const r = rng();
      let dv = 0;
      if (r < up) dv = goal * (rating >= 8.5 && rng() < 0.2 ? 2 : 1);
      else if (r > 1 - down) dv = -goal;
      const nv = clamp(v + dv, 1, 20);
      if (nv !== v) { p.traits[k] = nv; out.traits.push([k, nv - v]); out.moves += Math.abs(nv - v); }
    }
  }
  return out;
}
