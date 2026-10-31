// Lineups and minutes, the way the save keeps them: each team's startingLineup is one entry per player in rotation
// order ({ linePos, pid, minutes: [total, PG, SG, SF, PF, C] }), each player carries the same linePos and minutes,
// plus teamPos (his slot: 0 PG, 2 SG, 4 SF, 6 PF, 8 C) and posRnk (his depth at it). Every slot adds up to a full
// game, so the team plays 5 × game length minutes.
import { shownLevel as levelOf } from './regression.js';

export const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
const SLOT_POS = [0, 2, 4, 6, 8];          // player.pos on the game's 0-8 scale (PG, G, SG, GF, SF, F, PF, FC, C)
export const MODES = {
  compete: { label: 'Competing', says: 'The best players play. Stars near 36-38 minutes, a tight bench.', w: [1, 1, 1, 1, 1, 0.62, 0.52, 0.42, 0.32, 0.24, 0.2, 0.18] },
  normal: { label: 'Normal', says: 'A standard rotation: starters around 32, the bench gets real run.', w: [0.9, 0.9, 0.9, 0.9, 0.9, 0.62, 0.56, 0.48, 0.4, 0.32, 0.26, 0.22] },
  playoffs: { label: 'Playoffs', says: 'Tighten it: the best nine at 70/30 starters to bench, or eight at 75/25 for a short-bench coach. Only for the playoffs.', w: [1, 1, 1, 1, 1, 0.5, 0.38, 0.26, 0.15, 0.12, 0.1, 0.1], hi: 0.85, size: 8 },
  develop: { label: 'Developing', says: 'Young players with upside start and play through mistakes; vets take a back seat.', w: [0.85, 0.85, 0.85, 0.85, 0.85, 0.66, 0.6, 0.54, 0.46, 0.38, 0.3, 0.26] },
};
const healthy = p => !(p.season?.injury?.gamesOut > 0);
// Stars in half steps (10 = 5★), the game's scale: 5★ at Lv 97, 4.5★ 90, 4★ 83, 3.5★ 76, 3★ 69.
export const starsOf = p => Math.max(1, Math.min(10, Math.round((5 - (100 - levelOf(p)) / 14) * 2)));
// Minutes by stars on a 48-minute game (scaled for shorter games): [low, high].
export const STAR_MINUTES = { 10: [35, 38], 9: [32, 35], 8: [30, 32], 7: [25, 30] };
// A prospect: 24 or younger, 3★ or below today, 4★+ potential. He's guaranteed real minutes on a developing team, or
// a good one that isn't deep.
export const isProspect = p => p.age <= 24 && starsOf(p) <= 6 && (p.pot || 0) >= 8;
const PROSPECT_MINUTES = [22, 28];
// Deep: the ninth-best player is a 3.5★.
const isDeep = roster => (roster.map(levelOf).sort((a, b) => b - a)[8] ?? 0) >= 76;
const prospectsPlay = (mode, deep) => mode === 'develop' || mode === 'normal' || (mode === 'compete' && !deep);
// Maxed: a veteran already at his potential.
const maxedVet = p => p.age >= 27 && (p.pot || 0) <= starsOf(p);
// Who should play, by mode: level; Developing leans to youth and potential, away from maxed veterans. A prospect gets a
// push wherever he's meant to play.
export function playScore(p, mode, deep = false) {
  const lv = levelOf(p), pro = isProspect(p) && prospectsPlay(mode, deep);
  if (mode === 'develop') return lv + (p.age <= 24 ? Math.max(0, (p.pot || 0) - 5) * 3 : 0) + (p.age <= 25 ? 3 : 0) - (p.age >= 30 ? 6 : 0) - (maxedVet(p) ? 5 : 0);
  if (mode === 'normal') return lv + (p.age <= 22 ? Math.max(0, (p.pot || 0) - 6) : 0) + (pro ? 6 : 0);
  return lv + (pro ? 3 : 0);
}
const dist = (p, s) => Math.abs((p.pos ?? 4) - SLOT_POS[s]);
// In position: his own spot or the next one over on the game's scale (a G plays either guard spot, an FC either big
// spot). Two steps or more is out of position, and only happens when nobody on the roster within 14 levels of the
// worst player in the rotation can play the spot.
export const inPos = (p, s) => dist(p, s) <= 1;
const POS_GAP = 14;
// The starting five: the best five players at their spots, over the top eight plus the best man at each spot. A step
// over costs a little; out of position only when nobody who can play the spot is within 14 levels of the worst
// starter.
function pickStarters(cands, score) {
  const top = [...new Set([...cands.slice(0, 8), ...[0, 1, 2, 3, 4].flatMap(s => cands.filter(q => inPos(q, s)).slice(0, 2))])];
  let best = null, bestV = -Infinity;
  const go = (s, used, pick, v) => {
    if (s === 5) {
      const worst = Math.min(...pick.map(levelOf));
      const ok = pick.every((p, k) => inPos(p, k) || !cands.some(q => !used.has(q) && inPos(q, k) && levelOf(q) >= worst - POS_GAP));
      if (ok && v > bestV) { bestV = v; best = [...pick]; }
      return;
    }
    for (const p of top) {
      if (used.has(p)) continue;
      const d = dist(p, s);
      if (d > 3) continue;
      used.add(p); pick.push(p);
      go(s + 1, used, pick, v + score(p) - (d <= 1 ? d * 1.5 : 3 * d * d));
      used.delete(p); pick.pop();
    }
  };
  go(0, new Set(), [], 0);
  return best || cands.slice(0, 5);
}
// Minutes each: by the mode's weights, scaled to 5 games' worth of slots, kept between 12% and 80% of a game. With a
// share (the starters' part of all minutes, e.g. 0.65), the starters split that part and the bench the rest.
// Players 3.5★ and up, and prospects where they're meant to play, get their range instead (starting in its middle;
// when they'd leave the rest less than a bench minimum, they all give back in proportion), and the rest split
// what's left by the weights.
function minutesFor(rot, mode, game, over, share = null, deep = false, promised = {}) {
  const W = MODES[mode].w, total = 5 * game, lo = Math.round(game * 0.12), hi = Math.round(game * (MODES[mode].hi || 0.8));
  const want = new Map(rot.filter(p => over[p.id] != null).map(p => [p, Math.max(0, Math.min(game, over[p.id]))]));
  const wOf = p => W[rot.indexOf(p)] ?? 0.2;
  const k = game / 48, range = new Map();
  for (const p of rot) {
    if (over[p.id] != null) continue;
    let r = STAR_MINUTES[starsOf(p)] || (isProspect(p) && prospectsPlay(mode, deep) ? PROSPECT_MINUTES : null);
    // A promise from his exit interview: at least what was promised (on a 48-minute game).
    const pm = promised[p.id]?.min;
    if (pm) r = [Math.max(r?.[0] ?? 0, pm), Math.max(r?.[1] ?? 0, pm + 2)];
    if (r) range.set(p, r.map(v => Math.min(hi, Math.round(v * k))));
  }
  if (range.size) {
    const T = [...range.keys()], O = rot.filter(p => over[p.id] == null && !range.has(p));
    const avail = total - rot.filter(p => over[p.id] != null).reduce((a, p) => a + want.get(p), 0);
    // By priority: stars first (5★ down to 3.5★), prospects last. Each pass hands out what's left while the rest keep
    // at least a bench minimum: everyone to the low end of his range, then to its middle.
    const pri = p => (promised[p.id]?.min ? 11 : STAR_MINUTES[starsOf(p)] ? starsOf(p) : 0);
    T.sort((a, b) => pri(b) - pri(a));
    for (const p of T) want.set(p, lo);
    const assigned = () => [...T, ...O].reduce((a, p) => a + (want.get(p) || 0), 0);
    for (const p of O) want.set(p, lo);
    for (const step of [p => range.get(p)[0], p => Math.round((range.get(p)[0] + range.get(p)[1]) / 2)]) {
      for (const p of T) { const room = avail - assigned(); if (room <= 0) break; want.set(p, want.get(p) + Math.max(0, Math.min(room, step(p) - want.get(p)))); }
    }
    const left = avail - T.reduce((a, p) => a + want.get(p), 0);
    // Below 3.5★ nobody tops 32 while a ranged player still has room.
    const oHi = Math.min(hi, Math.round(32 * k)), sumW = O.reduce((a, p) => a + wOf(p), 0);
    for (const p of O) want.set(p, Math.max(lo, Math.min(oHi, Math.round(left * wOf(p) / sumW))));
    // Leftovers: first to the ranged players up to the top of their range, then anyone with room; a shortfall comes
    // back from whoever's furthest past his low end.
    let d = avail - [...T, ...O].reduce((a, p) => a + want.get(p), 0);
    const nudge = (list, cap) => { for (let i = 0; d > 0 && i < 4000 && list.length; i++) { const p = list[i % list.length], v = want.get(p) + 1; if (v <= cap(p)) { want.set(p, v); d--; } else if (list.every(q => want.get(q) >= cap(q))) break; } };
    nudge(T, p => range.get(p)[1]);
    nudge(O, () => oHi);
    nudge([...T, ...O], () => hi);
    for (let i = 0; d < 0 && i < 4000; i++) {
      const p = [...O, ...T].filter(q => want.get(q) > lo).sort((a, b) => (want.get(b) - (range.get(b)?.[0] ?? lo)) - (want.get(a) - (range.get(a)?.[0] ?? lo)))[0];
      if (!p) break;
      want.set(p, want.get(p) - 1); d++;
    }
    // The most each can play when the positions need it: a ranged player the top of his range (or what he was given).
    const cap = new Map([...T.map(p => [p, Math.max(want.get(p), range.get(p)[1])]), ...O.map(p => [p, Math.max(want.get(p), oHi)])]);
    return { want, lo, hi, cap };
  }
  const groups = share != null && rot.length > 5 ? [[rot.slice(0, 5), Math.round(total * share)], [rot.slice(5), total - Math.round(total * share)]] : [[rot, total]];
  const spread = (grp, mins) => {
    const free = grp.filter(p => over[p.id] == null);
    const left = mins - grp.filter(p => over[p.id] != null).reduce((s, p) => s + want.get(p), 0), sumW = free.reduce((s, p) => s + wOf(p), 0);
    for (const p of free) want.set(p, Math.max(lo, Math.min(hi, Math.round(left * wOf(p) / sumW))));
    // The rounding and the clamps' leftovers go to whoever in the group has room, a minute at a time.
    let d = left - free.reduce((s, p) => s + want.get(p), 0);
    for (let i = 0; d !== 0 && i < 2000 && free.length; i++) {
      const p = free[i % free.length], v = want.get(p) + Math.sign(d);
      if (v >= lo && v <= hi) { want.set(p, v); d -= Math.sign(d); }
    }
  };
  for (const [grp, mins] of groups) spread(grp, mins);
  // Anything a group couldn't hold (the clamps) goes to the whole rotation.
  const free = rot.filter(p => over[p.id] == null);
  let d = total - rot.reduce((s, p) => s + want.get(p), 0);
  for (let i = 0; d !== 0 && i < 2000 && free.length; i++) {
    const p = free[i % free.length], v = want.get(p) + Math.sign(d);
    if (v >= lo && v <= hi) { want.set(p, v); d -= Math.sign(d); }
  }
  return { want, lo, hi };
}
// The coach's default rotation, from his game plan in the save: bench depth sets how many play (Short 9, Average 10,
// Deep 11) and bench usage how the minutes split between starters and bench (Low 70/30, Medium 65/35, High 60/40). In
// the playoffs everyone tightens to their best nine at 70/30, or eight at 75/25 for a coach who already runs short.
export function coachRotation(coach, playoffs = false) {
  const tn = coach?.tendencies || {}, bd = tn.benchDepth ?? 0, bu = tn.benchUtilization ?? 1;
  if (playoffs) return bd === 2 ? { size: 8, share: 0.75 } : { size: 9, share: 0.7 };
  return { size: [10, 11, 9][bd] ?? 10, share: [0.7, 0.65, 0.6][bu] ?? 0.65 };
}
// Each player's minutes by slot, as the cheapest way to cover all five spots (a min-cost flow of minutes): a step
// over costs a little, out of position costs far more and grows with the distance, so a power forward covers center
// before a guard does. A player can go past his share of minutes (up to the mode's limit) at a small cost, which is
// how a true center's backup soaks up minutes instead of a forward playing the five. Starters keep at least half
// their minutes at their own spot but can stagger into the next one: with no true center behind them, an FC starting
// at power forward takes the backup center minutes and the bench forwards cover his.
const slotCost = (p, s, own) => (own ? -1 : 0) + (dist(p, s) <= 1 ? dist(p, s) * 3 : 1000 * dist(p, s) ** 2);
const EXTRA = 30;
function assign(rot, starters, want, hi, game, over, cap = null) {
  const slots = new Map(rot.map(p => [p, [0, 0, 0, 0, 0]]));
  const need = [game, game, game, game, game];
  const used = p => slots.get(p).reduce((a, b) => a + b, 0);
  const capOf = p => (over[p.id] != null ? want.get(p) : cap?.get(p) ?? Math.max(want.get(p), hi));
  starters.forEach((p, s) => { const m = Math.ceil(Math.min(game, want.get(p)) / 2); slots.get(p)[s] = m; need[s] -= m; });
  // The cost of one more minute from a player: free up to his share (hand-set minutes come first), a little past it.
  const startCost = p => (used(p) < want.get(p) ? (over[p.id] != null ? -50 : 0) : used(p) < capOf(p) ? EXTRA : Infinity);
  const tierLeft = p => (used(p) < want.get(p) ? want.get(p) - used(p) : capOf(p) - used(p));
  // Successive shortest paths: player → slot at its cost; the residual slot → player edges let a later path move
  // someone already placed (a starter never below half his minutes at his own spot).
  const n = rot.length;
  const keep = (p, s) => (starters[s] === p ? Math.ceil(Math.min(game, want.get(p)) / 2) : 0);
  for (let guard = 0; guard < 500 && need.some(v => v > 0); guard++) {
    const D = new Array(n + 5).fill(Infinity), prev = new Array(n + 5).fill(-1);
    rot.forEach((p, i) => { D[i] = startCost(p); });
    for (let k = 0; k < n + 5; k++) {
      let ch = false;
      for (let i = 0; i < n; i++) if (D[i] < Infinity) for (let s = 0; s < 5; s++) {
        const c = D[i] + slotCost(rot[i], s, starters[s] === rot[i]);
        if (c < D[n + s]) { D[n + s] = c; prev[n + s] = i; ch = true; }
      }
      for (let s = 0; s < 5; s++) if (D[n + s] < Infinity) for (let i = 0; i < n; i++) {
        if (!(slots.get(rot[i])[s] - keep(rot[i], s) > 0)) continue;
        const c = D[n + s] - slotCost(rot[i], s, starters[s] === rot[i]);
        if (c < D[i]) { D[i] = c; prev[i] = n + s; ch = true; }
      }
      if (!ch) break;
    }
    let end = -1;
    for (let s = 0; s < 5; s++) if (need[s] > 0 && D[n + s] < Infinity && (end < 0 || D[n + s] < D[end])) end = n + s;
    if (end < 0) break;
    const path = []; for (let v = end; v !== -1 && path.length <= 2 * (n + 5); v = prev[v]) path.push(v);
    const start = path[path.length - 1];
    if (start >= n) break;
    let f = Math.min(need[end - n], tierLeft(rot[start]));
    for (let k = path.length - 1; k > 0; k--) { const u = path[k], v = path[k - 1]; if (u >= n) f = Math.min(f, slots.get(rot[v])[u - n] - keep(rot[v], u - n)); }
    if (!(f > 0)) break;
    for (let k = path.length - 1; k > 0; k--) { const u = path[k], v = path[k - 1]; if (u < n) slots.get(rot[u])[v - n] += f; else slots.get(rot[v])[u - n] -= f; }
    need[end - n] -= f;
  }
  return { slots, need };
}
const offMinutes = (rot, g) => rot.reduce((a, q) => a + g.slots.get(q).reduce((b, v, t) => b + (inPos(q, t) ? 0 : v), 0), 0);
// The plan: starters by slot, the bench in order, each player's minutes by slot. size: players in the rotation (7-12).
// over: { pid: total } minutes you've set by hand (the rest share what's left).
// promised: { pid: { min, start } } from exit interviews: a floor on his minutes, or a starting spot.
export function planLineup(team, { mode = 'normal', size = 9, game = 48, over = {}, share = null, promised = {} } = {}) {
  const roster = team.roster.filter(p => p.status === 3 || p.status === 2), deep = isDeep(roster);
  const score = p => playScore(p, mode, deep) + (promised[p.id]?.start ? 25 : promised[p.id]?.min ? 8 : 0);
  // Set to 0 by hand: out of the rotation. Set above 0: in it, whoever else gets squeezed.
  const cands = roster.filter(p => healthy(p) && over[p.id] !== 0).sort((a, b) => score(b) - score(a));
  const starters = pickStarters(cands, score);
  const bench = cands.filter(p => !starters.includes(p));
  // The bench: a backup big and a backup guard always (a weaker true center beats a point guard playing the five),
  // a backup wing when there's one close enough, then the best of the rest.
  const nBench = Math.max(0, Math.min(12, size) - 5), grp = p => ((p.pos ?? 4) <= 2 ? 0 : (p.pos ?? 4) <= 5 ? 1 : 2);
  const picks = bench.filter(p => over[p.id] > 0).slice(0, nBench);
  // Prospects where they're meant to play come next (at most two), then the position needs.
  for (const p of bench.filter(q => promised[q.id] && over[q.id] == null && !picks.includes(q))) if (picks.length < nBench) picks.push(p);
  if (prospectsPlay(mode, deep)) for (const p of bench.filter(q => isProspect(q) && over[q.id] == null && !picks.includes(q)).slice(0, 2)) if (picks.length < nBench) picks.push(p);
  for (const g of [2, 0, 1]) { const b = bench.find(p => grp(p) === g && !picks.includes(p)); if (b && picks.length < nBench && (g !== 1 || score(b) >= score(bench[0]) - 10)) picks.push(b); }
  for (const p of bench) if (picks.length < nBench && !picks.includes(p)) picks.push(p);
  picks.sort((a, b) => score(b) - score(a));
  let rot = [...starters, ...picks];
  let { want, hi, cap } = minutesFor(rot, mode, game, over, share, deep, promised), got = assign(rot, starters, want, hi, game, over, cap);
  // Still out of position somewhere? Bring in a bench player who can play the spot, if he's within 14 levels of the
  // worst player in the rotation, in place of the last man whose spots are covered without him. Kept only if it
  // cuts the out-of-position minutes.
  const tried = new Set();
  for (let it = 0; it < 8 && offMinutes(rot, got) > 0; it++) {
    const holes = [0, 1, 2, 3, 4].filter(s => rot.some(q => got.slots.get(q)[s] > 0 && !inPos(q, s)));
    const worst = Math.min(...rot.map(levelOf));
    const add = cands.find(q => !rot.includes(q) && !tried.has(q) && holes.some(s => inPos(q, s)) && levelOf(q) >= worst - POS_GAP);
    if (!add) break;
    tried.add(add);
    const covered = q => [0, 1, 2, 3, 4].every(t => !inPos(q, t) || rot.filter(r => r !== q && inPos(r, t)).length >= 2);
    const drop = rot.length >= Math.min(12, size) ? [...rot.slice(5)].reverse().find(q => over[q.id] == null && !tried.has(q) && covered(q)) : null;
    const nextRot = [...starters, ...[...rot.slice(5).filter(q => q !== drop), add].sort((a, b) => score(b) - score(a))];
    const m2 = minutesFor(nextRot, mode, game, over, share, deep, promised), g2 = assign(nextRot, starters, m2.want, m2.hi, game, over, m2.cap);
    if (offMinutes(nextRot, g2) < offMinutes(rot, got)) { rot = nextRot; want = m2.want; hi = m2.hi; cap = m2.cap; got = g2; }
  }
  // A rotation spot that ends up with no minutes (a third center behind two) goes to the next man who can play.
  for (let it = 0; it < 4; it++) {
    const idle = rot.slice(5).find(q => over[q.id] == null && !got.slots.get(q).some(v => v > 0));
    if (!idle) break;
    let swapped = false;
    for (const add of cands.filter(q => !rot.includes(q) && !tried.has(q)).slice(0, 4)) {
      tried.add(add);
      const nextRot = [...starters, ...[...rot.slice(5).filter(q => q !== idle), add].sort((a, b) => score(b) - score(a))];
      const m2 = minutesFor(nextRot, mode, game, over, share, deep, promised), g2 = assign(nextRot, starters, m2.want, m2.hi, game, over, m2.cap);
      if (g2.slots.get(add).some(v => v > 0) && offMinutes(nextRot, g2) <= offMinutes(rot, got)) { rot = nextRot; want = m2.want; hi = m2.hi; cap = m2.cap; got = g2; swapped = true; break; }
    }
    if (!swapped) { rot = rot.filter(q => q !== idle); break; }
  }
  const { slots, need } = got;
  const order = [...rot, ...roster.filter(p => !rot.includes(p)).sort((a, b) => score(b) - score(a))];
  return {
    order, starters, rot, game,
    rows: order.map((p, i) => { const sl = slots.get(p) || [0, 0, 0, 0, 0], tot = sl.reduce((a, b) => a + b, 0); return { p, linePos: i, slot: starters.includes(p) ? starters.indexOf(p) : tot ? sl.indexOf(Math.max(...sl)) : nearestSlot(p), minutes: [tot, ...sl], hand: over[p.id] != null, promised: !!promised[p.id], off: sl.some((m, k) => m > 0 && !inPos(p, k)) }; }),
    short: need.map((v, i) => ({ slot: SLOTS[i], v })).filter(x => x.v > 0),
  };
}
const nearestSlot = p => [0, 1, 2, 3, 4].sort((a, b) => dist(p, a) - dist(p, b))[0];
// Write it into the save: the starting lineup entries, each player's linePos, minutes, teamPos and posRnk.
export function applyLineup(team, plan) {
  const depth = [0, 0, 0, 0, 0];
  team.startingLineup = plan.rows.map(r => ({ linePos: r.linePos, pid: r.p.id, minutes: [...r.minutes] }));
  for (const r of plan.rows) {
    r.p.linePos = r.linePos;
    r.p.minutes = [...r.minutes];
    r.p.teamPos = SLOT_POS[r.slot];
    r.p.posRnk = depth[r.slot]++;
  }
  // Anyone on the roster the plan left out (unsigned, injured and not listed) goes to the end.
  let n = plan.rows.length;
  for (const p of team.roster) if (!plan.rows.some(r => r.p === p)) { p.linePos = n; p.minutes = [0, 0, 0, 0, 0, 0]; team.startingLineup.push({ linePos: n++, pid: p.id, minutes: [0, 0, 0, 0, 0, 0] }); }
}
