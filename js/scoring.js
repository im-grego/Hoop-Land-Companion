// Scoring options: up to three players a team builds its offense around, each
// with a usage rate (5% steps), a focus and a play selection. Play selection is
// always 1 so every team runs its playbook instead of auto play calling. The
// rest of the usage goes to the other starters automatically.

import { shownLevel } from './regression.js';
import { playStyles } from './overview.js';
import { playerCoachFit } from './coachmarket.js';

export const FOCUS = ['Auto', 'Inside', 'Midrange', 'Outside', 'Facilitate'];     // 0-4, as the game numbers them
export const MAX_USAGE = 45, MIN_USAGE = 5, MAX_TOTAL = 85;
const FOCUS_OF_STYLE = { rim: 1, post: 1, lob: 1, mid: 2, shooter: 3, playmaker: 4 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r5 = v => Math.round(v / 5) * 5;
const A = (p, k) => p.attributes?.[k]?.[0] ?? 0;

// What he can score with: his best three scoring ratings.
const scoringPower = p => ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS'].map(k => A(p, k)).sort((x, y) => y - x).slice(0, 3).reduce((s, v) => s + v, 0) / 60;
// How much he wants to shoot: the shot-taking tendencies.
const drive = p => { const t = p.tendencies; if (!t) return 0.5; const ks = ['dunk', 'floater', 'hook', 'post', 'twoPoint', 'threePoint', 'fades', 'step', 'spin', 'cross']; return clamp((ks.reduce((s, k) => s + (t[k] || 0), 0) / ks.length + 5) / 10, 0, 1); };

// The focus that fits him: his leading play style, settled by his ratings when
// it's a creator, and Auto when nothing stands out.
export function focusFor(p) {
  const st = playStyles(p, 3).filter(s => FOCUS_OF_STYLE[s.k] || s.k === 'creator')[0];
  if (!st) return 0;
  if (st.k !== 'creator') return FOCUS_OF_STYLE[st.k];
  const inside = Math.max(A(p, 'LAY'), A(p, 'DNK'), A(p, 'INS')), mid = A(p, 'MID'), out = A(p, 'TPT');
  const best = Math.max(inside, mid, out);
  if (best - Math.min(inside, mid, out) < 2) return 0;
  return best === out ? 3 : best === mid ? 2 : 1;
}

// What the CPU would do in control: scorers who fit the scheme and the playbook.
export function assistantOptions(team, coach, { exclude = [], count = 3 } = {}) {
  const skip = new Set(exclude);
  const pool = [...team.roster].filter(p => p.status !== 4 && !skip.has(p.id)).sort((a, b) => shownLevel(b) - shownLevel(a)).slice(0, 9);
  const scored = pool.map(p => {
    const fit = coach ? playerCoachFit(p, team, coach).fit : 0.6;
    return { p, sc: 0.42 * clamp((shownLevel(p) - 50) / 50, 0, 1) + 0.25 * scoringPower(p) + 0.18 * fit + 0.15 * drive(p) };
  }).sort((a, b) => b.sc - a.sc).slice(0, count);
  const mean = scored.reduce((s, x) => s + x.sc, 0) / (scored.length || 1);
  let used = 0, prev = 40;
  return scored.map((x, i) => {
    const base = [30, 20, 15][i] ?? 10;
    let u = clamp(r5(base + (x.sc - mean) * 40), 10, 40);
    u = Math.min(u, prev, MAX_TOTAL - used);
    prev = u;
    used += u;
    return { pid: x.p.id, usageRate: u, focus: focusFor(x.p), playSelection: 1 };
  });
}

// Make a team's options valid. Missing players are replaced from the assistant's
// picks; a CPU team whose formula broke gets a whole new one. Returns true when anything changed.
export function fixOptions(team, coach, { user = false, fill = true } = {}) {
  const roster = new Set(team.roster.map(p => p.id));
  const had = Array.isArray(team.scoringOptions) ? team.scoringOptions : (team.scoringOptions = []);
  let changed = false;
  for (const o of had) if (o.playSelection !== 1) { o.playSelection = 1; changed = true; }
  const alive = had.filter(o => roster.has(o.pid));
  if (!user) {
    if (alive.length === had.length && had.length >= 3) return changed;
    const next = assistantOptions(team, coach);
    team.scoringOptions = next;
    return true;
  }
  if (alive.length !== had.length) { team.scoringOptions = alive; changed = true; }
  if (fill && team.scoringOptions.length < (had.length ? had.length : 3)) {
    const need = (had.length ? had.length : 3) - team.scoringOptions.length;
    const add = assistantOptions(team, coach, { exclude: team.scoringOptions.map(o => o.pid), count: need });
    let total = team.scoringOptions.reduce((s, o) => s + o.usageRate, 0);
    for (const o of add) { o.usageRate = Math.max(MIN_USAGE, Math.min(o.usageRate, MAX_TOTAL - total)); total += o.usageRate; team.scoringOptions.push(o); }
    changed = true;
  }
  return changed;
}
