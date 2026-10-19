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

// Spread a player's rating ceilings so they add up to what his potential
// allows, but only when his ceilings are used up (every rating at its max) and
// his potential says there's more level to reach. The extra room goes to what
// he's good at and does most, instead of the game's flat +4 on everything.
export function refitCeilings(p) {
  if (!p.attributes || !p.pot) return 0;
  const A = k => p.attributes[k][0];
  const ceil = k => Math.max(A(k), p.attributes[k][1]);
  const t = p.tendencies || {};
  const tendOf = k => Object.entries(TEND_ATTR).filter(([, a]) => a === k).reduce((m, [x]) => Math.max(m, t[x] || 0), -5);
  const weight = k => (A(k) + 2) * (1 + 0.12 * Math.max(0, tendOf(k)));
  const target = capTotal(p.pot);
  let total = SKILL_KEYS.reduce((a, k) => a + ceil(k), 0);
  const nowTotal = SKILL_KEYS.reduce((a, k) => a + A(k), 0);
  // Only a player who has used up his ceilings (or been padded past his potential).
  const room = total - nowTotal;
  if (total < target && room <= 2 && nowTotal < target - 4) {
    let need = target - total;
    while (need > 0) {
      const k = SKILL_KEYS.filter(x => ceil(x) < CAP20(x)).sort((a, b) => weight(b) * (1 - ceil(b) / 22) - weight(a) * (1 - ceil(a) / 22))[0];
      if (!k) break;
      p.attributes[k][1] = ceil(k) + 1;
      need--; total++;
    }
    return target - total === 0 ? 1 : 0;
  }
  return 0;
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
