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
  develop: { label: 'Developing', says: 'Young players with upside start and play through mistakes; vets take a back seat.', w: [0.85, 0.85, 0.85, 0.85, 0.85, 0.66, 0.6, 0.54, 0.46, 0.38, 0.3, 0.26] },
};
const healthy = p => !(p.season?.injury?.gamesOut > 0);
// Who should play, by mode: level; Developing leans to youth and potential, away from veterans.
export function playScore(p, mode) {
  const lv = levelOf(p);
  if (mode === 'develop') return lv + (p.age <= 23 ? Math.max(0, (p.pot || 0) - 5) * 3 : 0) + (p.age <= 25 ? 3 : 0) - (p.age >= 30 ? 6 : 0);
  if (mode === 'normal') return lv + (p.age <= 22 ? Math.max(0, (p.pot || 0) - 6) : 0);
  return lv;
}
const dist = (p, s) => Math.abs((p.pos ?? 4) - SLOT_POS[s]);
// The starting five: the best five players at their spots (all slot orders over the top eight; out of position
// costs about a level and a half a step).
function pickStarters(cands, score) {
  const top = cands.slice(0, 8);
  let best = null, bestV = -Infinity;
  const go = (s, used, pick, v) => {
    if (s === 5) { if (v > bestV) { bestV = v; best = [...pick]; } return; }
    for (const p of top) {
      if (used.has(p)) continue;
      const d = dist(p, s);
      if (d > 3) continue;
      used.add(p); pick.push(p);
      go(s + 1, used, pick, v + score(p) - d * d * 1.5);
      used.delete(p); pick.pop();
    }
  };
  go(0, new Set(), [], 0);
  return best || top.slice(0, 5);
}
// The plan: starters by slot, the bench in order, each player's minutes by slot. size: players in the rotation (7-12).
// over: { pid: total } minutes you've set by hand (the rest share what's left).
export function planLineup(team, { mode = 'normal', size = 9, game = 48, over = {} } = {}) {
  const score = p => playScore(p, mode);
  const roster = team.roster.filter(p => p.status === 3 || p.status === 2);
  // Set to 0 by hand: out of the rotation. Set above 0: in it, whoever else gets squeezed.
  const cands = roster.filter(p => healthy(p) && over[p.id] !== 0).sort((a, b) => score(b) - score(a));
  const starters = pickStarters(cands, score);
  const bench = cands.filter(p => !starters.includes(p));
  // The bench: one backup each for the guards, wings and bigs (when there's one close enough), then the best of the rest.
  const nBench = Math.max(0, Math.min(12, size) - 5), grp = p => ((p.pos ?? 4) <= 2 ? 0 : (p.pos ?? 4) <= 5 ? 1 : 2);
  const picks = bench.filter(p => over[p.id] > 0).slice(0, nBench);
  for (const g of [2, 0, 1]) { const b = bench.find(p => grp(p) === g && !picks.includes(p)); if (b && bench.length && score(b) >= score(bench[0]) - 10 && picks.length < nBench) picks.push(b); }
  for (const p of bench) if (picks.length < nBench && !picks.includes(p)) picks.push(p);
  picks.sort((a, b) => score(b) - score(a));
  const rot = [...starters, ...picks];
  // Minutes each: by the mode's weights, scaled to 5 games' worth of slots, kept between 12% and 80% of a game.
  const W = MODES[mode].w, total = 5 * game, lo = Math.round(game * 0.12), hi = Math.round(game * 0.8);
  const fixed = rot.filter(p => over[p.id] != null), free = rot.filter(p => over[p.id] == null);
  const want = new Map(fixed.map(p => [p, Math.max(0, Math.min(game, over[p.id]))]));
  const left = total - [...want.values()].reduce((s, v) => s + v, 0);
  const wOf = p => W[rot.indexOf(p)] ?? 0.2, sumW = free.reduce((s, p) => s + wOf(p), 0);
  for (const p of free) want.set(p, Math.max(lo, Math.min(hi, Math.round(left * wOf(p) / sumW))));
  // Hand the rounding and the clamps' leftovers to whoever has room, a minute at a time.
  let d = left - free.reduce((s, p) => s + want.get(p), 0);
  for (let i = 0; d !== 0 && i < 2000 && free.length; i++) {
    const p = free[i % free.length], v = want.get(p) + Math.sign(d);
    if (v >= lo && v <= hi) { want.set(p, v); d -= Math.sign(d); }
  }
  // Slots: each starter plays his slot; the bench fills what's left, nearest positions first.
  const slots = new Map(rot.map(p => [p, [0, 0, 0, 0, 0]]));
  const need = [game, game, game, game, game];
  starters.forEach((p, s) => { const m = Math.min(want.get(p), game); slots.get(p)[s] = m; need[s] -= m; });
  // The bench (and any starter with minutes left) covers the slots still short: closest fits first across the whole
  // rotation, so a point guard backs up the point and a big backs up the bigs.
  const restOf = p => want.get(p) - slots.get(p).reduce((a, b) => a + b, 0);
  const pairs = rot.flatMap((p, i) => [0, 1, 2, 3, 4].map(s => ({ p, s, d: dist(p, s), i }))).sort((a, b) => a.d - b.d || a.i - b.i);
  for (const { p, s } of pairs) {
    const m = Math.min(restOf(p), need[s]);
    if (m > 0) { slots.get(p)[s] += m; need[s] -= m; }
  }
  // Trade minutes between players where both end up closer to their positions (a guard playing center and a big
  // playing the wing swap). Starters keep their own slot.
  const locked = (p, s) => starters[s] === p;
  for (let it = 0, moved = true; moved && it < 200; it++) {
    moved = false;
    for (const x of rot) for (const y of rot) {
      if (x === y) continue;
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        if (i === j || locked(x, i) || locked(y, j)) continue;
        const a = slots.get(x)[i], b = slots.get(y)[j];
        if (!a || !b || dist(x, j) + dist(y, i) >= dist(x, i) + dist(y, j)) continue;
        const k = Math.min(a, b);
        slots.get(x)[i] -= k; slots.get(x)[j] += k; slots.get(y)[j] -= k; slots.get(y)[i] += k;
        moved = true;
      }
    }
  }
  // Anything still short goes to whoever fits best and can play more.
  for (let s = 0; s < 5; s++) {
    while (need[s] > 0) {
      const p = [...rot].sort((a, b) => dist(a, s) - dist(b, s)).find(x => slots.get(x).reduce((a, b) => a + b, 0) < game);
      if (!p) break;
      const m = Math.min(need[s], game - slots.get(p).reduce((a, b) => a + b, 0));
      slots.get(p)[s] += m; need[s] -= m;
    }
  }
  const order = [...rot, ...roster.filter(p => !rot.includes(p)).sort((a, b) => score(b) - score(a))];
  return {
    order, starters, rot, game,
    rows: order.map((p, i) => { const sl = slots.get(p) || [0, 0, 0, 0, 0], tot = sl.reduce((a, b) => a + b, 0); return { p, linePos: i, slot: starters.includes(p) ? starters.indexOf(p) : tot ? sl.indexOf(Math.max(...sl)) : nearestSlot(p), minutes: [tot, ...sl], hand: over[p.id] != null }; }),
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
