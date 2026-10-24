// One-on-one player meetings: instead of a blanket tendency drift, you sit a player down and tell him one thing. The
// talking points come from where his game and his habits disagree: a rating at 10 of 20 is the break point, so a
// 16 three-point shooter who rarely shoots threes is leaving points on the floor, and an 8 stealer who gambles all
// night is giving them away. Each topic is a choice between two messages (more of it, or less of it).
import { coachVal } from './traits.js';
import { egoVal } from './ego.js';

const clampT = v => Math.max(-5, Math.min(5, v));
// The topics, the tendencies each covers (with the rating behind them), and the two messages.
export const TOPICS = {
  shooting: { label: 'Shot selection', keys: { threePoint: 'TPT', twoPoint: 'MID', fades: 'MID', post: 'INS', hook: 'INS', dunk: 'DNK', floater: 'LAY' },
    up: { icon: '🎯', label: 'Find your shot', says: 'You can score. Stop passing up good looks.' },
    down: { icon: '🥗', label: 'Smart shot diet', says: 'Take the shots you make. Leave the rest.' } },
  defense: { label: 'Defense', keys: { stealOnBall: 'STL', stealOffBall: 'STL', block: 'BLK' },
    up: { icon: '🔥', label: 'Get aggressive', says: 'You have the hands and the timing. Go get it.' },
    down: { icon: '🧱', label: 'Stay disciplined', says: 'Stop gambling. Stay in front, stay down.' } },
  glass: { label: 'Rebounding', keys: { offReb: 'ORE', defReb: 'DRE' },
    up: { icon: '💪', label: 'Get on the glass', says: 'Every miss is yours. Go get it.' },
    down: { icon: '🏃', label: 'Get back on D', says: 'Leave the offensive glass. Get back and set the defense.' } },
  passing: { label: 'Playmaking', keys: { pass: 'PAS', lob: 'PAS' },
    up: { icon: '👀', label: 'Keep your head up', says: 'You see the floor. Find your teammates.' },
    down: { icon: '🙅', label: 'Make the simple play', says: 'No home-run passes. Swing it and keep it moving.' } },
  handle: { label: 'Ball handling', keys: { cross: 'DRB', spin: 'DRB', step: 'DRB' },
    up: { icon: '⚡', label: 'Attack off the dribble', says: 'Your handle is a weapon. Use it.' },
    down: { icon: '🧘', label: 'Keep it simple', says: 'Fewer moves. Get to your spot and make a decision.' } },
};

// Where his habit should sit for his rating: 10 of 20 is neutral (0), 20 is all in (+5), 0 is never (-5).
const wantFor = r => (r - 10) / 2;
// Every tendency the topic covers, with its gap (positive: he does it less than his rating says he should).
function gaps(p, topic) {
  const t = p.tendencies || {};
  return Object.entries(TOPICS[topic].keys).filter(([k, a]) => t[k] !== undefined && p.attributes?.[a])
    .map(([k, a]) => { const r = p.attributes[a][0]; return { k, a, r, t: t[k], gap: wantFor(r) - t[k] }; });
}
// The talks worth having with him: the two topics where his habits and his ratings disagree most. The message that
// fits is marked; the other is still there to choose.
export function talkPoints(p) {
  if (!p.tendencies || !p.attributes) return [];
  const out = [];
  for (const topic of Object.keys(TOPICS)) {
    const g = gaps(p, topic);
    const under = g.filter(x => x.gap >= 2 && x.r >= 11).sort((a, b) => b.gap - a.gap);
    const over = g.filter(x => x.gap <= -2 && x.r <= 10).sort((a, b) => a.gap - b.gap);
    const su = under.reduce((s, x) => s + x.gap, 0), so = -over.reduce((s, x) => s + x.gap, 0);
    if (!su && !so) continue;
    const fit = su >= so ? 'up' : 'down', top = (fit === 'up' ? under : over)[0];
    out.push({ topic, fit, score: Math.max(su, so), why: top, under, over });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 2);
}
// How much he takes in: two tendencies a talk; a Coachable one (16+) three, the first by two; an Uncoachable one (4 or
// less) one, and half the time he tunes it out. Young players listen more; an Alpha told to shoot less hears one.
export function reach(p, topic, dir) {
  const c = coachVal(p);
  let n = c >= 16 ? 3 : c <= 4 ? 1 : 2;
  if (p.age <= 23) n++;
  if (topic === 'shooting' && dir === 'down' && egoVal(p) >= 16) n = Math.max(1, n - 1);
  return { n: Math.min(4, n), deep: c >= 16, deaf: c <= 4 ? 0.5 : 0 };
}
// Have the talk: move his tendencies in the message's direction, the biggest gaps first (any of the topic's habits
// when nothing is out of line). orig: where he started the offseason (a habit moves at most `lim` from it).
// Returns the changes [[k, from, to]] (empty when he tuned it out).
export function haveTalk(p, topic, dir, { orig = null, lim = 3, rng = Math.random } = {}) {
  const t = p.tendencies, r = reach(p, topic, dir), sign = dir === 'up' ? 1 : -1;
  if (!t || rng() < r.deaf) return [];
  const o = orig || t;
  // The habits out of line in this direction; when none are, the one closest to it (he still hears the message).
  const all = gaps(p, topic).sort((a, b) => sign * (b.gap - a.gap) || sign * (b.r - a.r));
  const order = all.filter(x => sign * x.gap >= 1).length ? all.filter(x => sign * x.gap >= 1) : all.slice(0, 1);
  const out = [];
  let n = r.n;
  for (const x of order) {
    if (n <= 0) break;
    const step = r.deep && !out.length && Math.abs(x.gap) >= 3 ? 2 : 1;
    const to = clampT(Math.max((o[x.k] ?? 0) - lim, Math.min((o[x.k] ?? 0) + lim, t[x.k] + sign * step)));
    if (to === t[x.k]) continue;
    out.push([x.k, t[x.k], to]);
    t[x.k] = to;
    n--;
  }
  return out;
}
// How many talks a team gets: three, two more with a great motivator (one with a good one), plus the scheme tier of
// the coaching tree.
export function talkBudget(coach, schemeTier = 0) {
  const m = (coach?.attributes?.motivation?.[0] ?? 0) / 2;
  return 3 + (m >= 8 ? 2 : m >= 6 ? 1 : 0) + (schemeTier || 0);
}
