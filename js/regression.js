import { ATTRS, levelOf } from './savefile.js';

// In-game regression: the save keeps a player's peak ratings, and the game shows each one as
// floor(peak × rate^year), where year counts the seasons he's played past his regression age (the game's first
// year of decline is the season after he turns it: age − regressionAge − 1). Fitted exactly on a full seven-year
// decline (Harrison Barnes, 79 → 55, every rating every year) and the 20/20 measurements before it. The rates come
// in 2.5% steps: shooting and passing hold up best, athleticism goes first. Retired players show their peak again,
// so the app never writes this to the save.
export const REG_RATE = {
  MID: 0.975, TPT: 0.975, FTS: 0.975, PAS: 0.975,
  LAY: 0.95, DRB: 0.95, SPD: 0.95,
  INS: 0.925, DRE: 0.925, STL: 0.925, STR: 0.925, STM: 0.925,
  ORE: 0.9,
  DNK: 0.875, BLK: 0.875,
};
export const declineYear = p => Math.max(0, (p.age || 0) - (p.regressionAge || 99) - 1);
// The rating the game shows (never below 1).
export function regressed(p, k) {
  const core = p.attributes[k][0];
  const y = declineYear(p);
  if (!(y > 0)) return core;
  return Math.max(1, Math.min(core, Math.floor(core * Math.pow(REG_RATE[k] ?? 0.95, y) + 1e-9)));
}

// Level as the game shows it (from the regressed ratings).
export function shownLevel(p) {
  if (!(declineYear(p) > 0)) return levelOf(p);
  return levelOf({ pot: p.pot, attributes: Object.fromEntries(ATTRS.map(k => [k, [regressed(p, k), p.attributes[k][1]]])) });
}
