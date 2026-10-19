import { ATTRS, PHYSICAL, regressionYear, levelOf } from './savefile.js';

// In-game regression: the save keeps a player's peak ratings, and the game
// shows them minus a drop that grows each year past his regression age
// (same points off any rating, measured on a 20/20 player). Retired players
// show their peak again, so the app never writes this to the save.
// Total drop by decline year, LAY → STM (ATTRS order).
const REG_DROP = {
  1: [1, 3, 2, 1, 1, 1, 1, 1, 2, 2, 2, 3, 2, 1, 2],
  2: [2, 5, 3, 1, 1, 1, 2, 1, 4, 3, 3, 5, 3, 2, 3],
  3: [3, 7, 5, 2, 2, 2, 3, 2, 6, 5, 5, 7, 5, 3, 5],
  4: [4, 9, 6, 2, 2, 2, 4, 2, 7, 6, 6, 9, 6, 4, 6],
};
// Past year 4: keep adding the year 3 → 4 step.
function regDrop(year, i) {
  if (year <= 0) return 0;
  if (REG_DROP[year]) return REG_DROP[year][i];
  return REG_DROP[4][i] + (REG_DROP[4][i] - REG_DROP[3][i]) * (year - 4);
}
// The rating the game shows. Skills never go below 1; physicals fall at
// half pace once they're under 8 (4 in the game's 10-point display).
export function regressed(p, k) {
  const core = p.attributes[k][0];
  const y = regressionYear(p);
  if (!(y > 0)) return core;
  const drop = regDrop(y, ATTRS.indexOf(k));
  if (!PHYSICAL.includes(k)) return Math.max(1, core - drop);
  if (core - drop >= 8) return core - drop;
  const above = Math.max(0, core - 8);
  return Math.max(1, Math.min(core, 8) - Math.floor((drop - above) / 2));
}

// Level as the game shows it (from the regressed ratings).
export function shownLevel(p) {
  if (!(p.age > p.regressionAge)) return levelOf(p);
  return levelOf({ pot: p.pot, attributes: Object.fromEntries(ATTRS.map(k => [k, [regressed(p, k), p.attributes[k][1]]])) });
}
