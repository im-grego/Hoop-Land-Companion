// Usage: node tests/regression.test.mjs
// The game's regression, checked against a full decline read off the game's Player Upgrades screen: Harrison Barnes
// (peak ratings from the save, regression age 32), one screen a season from age 34 to 40.
import { regressed, shownLevel } from '../js/regression.js';

const K = ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS', 'DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK'];
const peak = { LAY: 16, DNK: 14, INS: 9, MID: 9, TPT: 16, FTS: 13, DRB: 13, PAS: 9, ORE: 5, DRE: 6, STL: 9, BLK: 7, STR: 13, SPD: 14, STM: 17 };
// The game shows ratings out of 10 in halves; these are doubled back to the save's 0-20.
const seen = [
  [72, [15, 12, 8, 8, 15, 12, 12, 8, 4, 5, 8, 6]],
  [69, [14, 10, 7, 8, 15, 12, 11, 8, 4, 5, 7, 5]],
  [66, [13, 9, 7, 8, 14, 12, 11, 8, 3, 4, 7, 4]],
  [63, [13, 8, 6, 8, 14, 11, 10, 8, 3, 4, 6, 4]],
  [60, [12, 7, 6, 7, 14, 11, 10, 7, 2, 4, 6, 3]],
  [57, [11, 6, 5, 7, 13, 11, 9, 7, 2, 3, 5, 3]],
  [55, [11, 5, 5, 7, 13, 10, 9, 7, 2, 3, 5, 2]],
];
let bad = 0;
seen.forEach(([lv, want], i) => {
  const p = { age: 34 + i, regressionAge: 32, pot: 7, attributes: Object.fromEntries(Object.entries(peak).map(([k, v]) => [k, [v, v]])) };
  const got = K.map(k => regressed(p, k));
  const miss = K.filter((k, j) => got[j] !== want[j]);
  if (miss.length || shownLevel(p) !== lv) { bad++; console.error(`age ${p.age}: level ${shownLevel(p)} (game ${lv})`, miss.map(k => `${k} ${got[K.indexOf(k)]}≠${want[K.indexOf(k)]}`).join(', ')); }
});
// Before the first decline year: peak ratings.
const young = { age: 33, regressionAge: 32, pot: 7, attributes: Object.fromEntries(Object.entries(peak).map(([k, v]) => [k, [v, v]])) };
if (shownLevel(young) !== 79) { bad++; console.error('age 33 should still show the peak (79), got', shownLevel(young)); }
if (bad) process.exit(1);
console.log(`regression OK: ${seen.length} seasons × ${K.length} ratings match the game`);
