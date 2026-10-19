// Automatic, progression-style upkeep of a player's play style and ceilings:
//  - tendencies follow the ratings behind them (young players change the
//    most), and veterans trade shot attempts and athletic moves for skill;
//  - rating ceilings that are all used up are re-spread so the player can
//    still reach the level his potential allows, instead of the game's flat
//    +4 on every rating.

const SKILL_KEYS = ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS', 'DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK'];
const CAP20 = k => (k === 'FTS' ? 16 : 20);
// Which rating each tendency is about (pump fake, run play, take charge are gameplay-only).
const TEND_ATTR = {
  dunk: 'DNK', floater: 'LAY', post: 'INS', hook: 'INS', twoPoint: 'MID', fades: 'MID', threePoint: 'TPT',
  cross: 'DRB', spin: 'DRB', step: 'DRB', pass: 'PAS', lob: 'PAS', offReb: 'ORE', defReb: 'DRE',
  stealOnBall: 'STL', stealOffBall: 'STL', block: 'BLK',
};
const clampT = v => Math.max(-5, Math.min(5, v));

// Total of the twelve skill ratings a potential allows (level cap 30 + 7 x pot).
export const capTotal = pot => 28 + 14 * (pot || 0);

// Where extra rating room is most likely to go: what he's already good at and
// does most (tendencies), his size (bigs: inside and boards; guards: handle,
// passing, shooting) and age (young players spread it around, veterans
// double down on strengths).
const BIG = ['INS', 'BLK', 'DRE', 'ORE'], GUARD = ['DRB', 'PAS', 'TPT', 'STL'], WING = ['MID', 'TPT', 'LAY', 'DNK'];
function allocWeights(p) {
  const A = k => p.attributes[k][0];
  const t = p.tendencies || {};
  const tendOf = k => Object.entries(TEND_ATTR).filter(([, a]) => a === k).reduce((m, [x]) => Math.max(m, t[x] || 0), -5);
  const grp = p.pos >= 6 ? BIG : p.pos <= 2 ? GUARD : WING;
  const power = p.age <= 24 ? 0.6 : p.age >= 30 ? 1.4 : 1;
  return Object.fromEntries(SKILL_KEYS.map(k => [k, Math.pow((A(k) + 2) * (1 + 0.12 * Math.max(0, tendOf(k))) * (grp.includes(k) ? 1.3 : 1), power)]));
}
// Add `n` points of rating room, one at a time, where it's most likely to be used.
export function addCeilings(p, n) {
  const ceil = k => Math.max(p.attributes[k][0], p.attributes[k][1]);
  const w = allocWeights(p);
  let added = 0;
  while (added < n) {
    const k = SKILL_KEYS.filter(x => ceil(x) < CAP20(x)).sort((a, b) => w[b] * (1 - ceil(b) / 22) - w[a] * (1 - ceil(a) / 22))[0];
    if (!k) break;
    p.attributes[k][1] = ceil(k) + 1;
    added++;
  }
  return added;
}
const ceilTotal = p => SKILL_KEYS.reduce((a, k) => a + Math.max(p.attributes[k][0], p.attributes[k][1]), 0);
const nowTotal = p => SKILL_KEYS.reduce((a, k) => a + p.attributes[k][0], 0);

// A player whose ceilings are all used up while his potential says there's
// more level to reach gets four more points of room (no more than his
// potential allows), instead of the game's flat +4 on every rating.
export function refitCeilings(p) {
  if (!p.attributes || !p.pot) return 0;
  const total = ceilTotal(p), now = nowTotal(p), target = capTotal(p.pot);
  if (total >= target || total - now > 2 || now >= target - 4) return 0;
  return addCeilings(p, Math.min(4, target - total));
}
// A potential bump in the offseason: the new ceilings add up to the new potential.
export function potBumpCeilings(p, oldPot) {
  if (!p.attributes || !p.pot || !(p.pot > oldPot)) return 0;
  return addCeilings(p, Math.max(0, capTotal(p.pot) - ceilTotal(p)));
}

// One offseason of tendency drift. `rng` is a 0-1 generator. Returns how many
// tendencies moved.
export function autoTendencies(p, rng) {
  const t = p.tendencies;
  if (!t || !p.attributes) return 0;
  const A = k => p.attributes[k][0];
  const ceil = k => Math.max(A(k), p.attributes[k][1]);
  const young = p.age <= 24, prime = p.age >= 25 && p.age <= 29, vet = p.age >= 30;
  const fit = young ? 1 : prime ? 0.45 : 0.5;     // how much he re-tunes to his ratings
  const maxMoves = young ? 4 : 3;
  let moves = 0;
  const nudge = (k, d) => { const v = clampT((t[k] || 0) + d); if (v !== t[k] && moves < maxMoves) { t[k] = v; moves++; } };
  // Rein in what he can't do and has no room to ever do; open up what he's earned.
  for (const [k, a] of Object.entries(TEND_ATTR)) {
    if (t[k] === undefined) continue;
    if (t[k] > 0 && ceil(a) < 10 && rng() < 0.55 * fit) nudge(k, -1);
    else if (t[k] <= -2 && A(a) >= 12 && rng() < (young ? 0.45 : 0.15)) nudge(k, 1);
    else if (young && t[k] <= 0 && A(a) >= 15 && rng() < 0.3) nudge(k, 1);
  }
  // Veterans: fewer attempts, more craft. The more years past 30, the more it shows.
  if (vet) {
    const pr = Math.min(0.7, 0.25 + 0.08 * (p.age - 30));
    for (const k of ['dunk', 'step', 'spin', 'cross', 'floater', 'block', 'stealOnBall']) if ((t[k] ?? -5) > -3 && rng() < pr) nudge(k, -1);
    if (p.age >= 33 && (t.threePoint ?? -5) > -2 && rng() < pr * 0.5) nudge('threePoint', -1);
    for (const [k, a] of [['pass', 'PAS'], ['twoPoint', 'MID'], ['fades', 'MID'], ['post', 'INS'], ['hook', 'INS']]) if (t[k] !== undefined && t[k] < 3 && A(a) >= 11 && rng() < pr * 0.7) nudge(k, 1);
  }
  return moves;
}

// Rookie play styles: a draft class comes with tendencies well above the
// active players' (more shots, more moves, no blocking at all). Re-map each
// tendency onto the lower end of the league's own distribution at his position
// group (the 5th to 60th percentile, by his rank in the class), ranking
// prospects by tendency and by the rating behind it so the better-suited
// players keep the higher values. Then lean into his game: a strong rating
// (15+) nudges its tendency up, a weak one (8 or less) down, and his two
// best-fitting tendencies get one more.
const group = p => (p.pos <= 2 ? 0 : p.pos <= 5 ? 1 : 2);
export function shapeRookieTendencies(rookies, active, rng) {
  const changed = [];
  const keys = Object.keys(active.find(p => p.tendencies)?.tendencies || {});
  for (const g of [0, 1, 2]) {
    const cls = rookies.filter(p => p.tendencies && group(p) === g);
    const pool = active.filter(p => p.tendencies && group(p) === g);
    if (cls.length < 4 || pool.length < 20) continue;
    const seen = new Set();
    const touch = p => { if (!seen.has(p)) { seen.add(p); changed.push({ p, was: { ...p.tendencies } }); } };
    const fit = new Map(cls.map(p => [p, {}]));
    for (const k of keys) {
      const ref = pool.map(p => p.tendencies[k]).sort((a, b) => a - b);
      const a = TEND_ATTR[k];
      const attrOf = p => (a ? p.attributes[a][0] : 0);
      const flat = new Set(cls.map(p => p.tendencies[k])).size < 4;        // no spread to rank by (every rookie blocks the same)
      const score = p => (flat ? attrOf(p) : p.tendencies[k] + (a ? 0.35 * (attrOf(p) - 10) : 0));
      const order = [...cls].sort((x, y) => score(x) - score(y) || x.id - y.id);
      order.forEach((p, i) => {
        const q = 0.05 + 0.55 * ((i + 0.5) / order.length);
        let v = ref[Math.min(ref.length - 1, Math.floor(q * ref.length))];
        if (a) {
          const r = attrOf(p);
          if (r >= 17) v += 2; else if (r >= 15) v += 1; else if (r <= 8) v -= 1;
          fit.get(p)[k] = r;
        }
        if (rng() < 0.2) v += rng() < 0.5 ? -1 : 1;
        touch(p);
        p.tendencies[k] = clampT(v);
      });
    }
    // His identity: the two tendencies that sit on his best ratings get one more.
    for (const p of cls) {
      const best = Object.entries(fit.get(p)).sort((x, y) => y[1] - x[1]).slice(0, 2).filter(([, r]) => r >= 13);
      for (const [k] of best) p.tendencies[k] = clampT(p.tendencies[k] + 1);
    }
  }
  return changed;
}
export const normalizeTendencies = shapeRookieTendencies;
