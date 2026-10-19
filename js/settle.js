// An estimate of what the game does with expiring contracts when a league
// loads: some players re-sign, the rest go to free agency. Fitted to one
// league where the game settled 133 expiring players (80 re-signed, 53 went):
//   - the odds follow level (under 55 rarely stay, 60s about 40%, 70-74 about
//     80%, 75+ nearly all), with older players less likely to stay;
//   - good players get roughly their fair salary for 3 years (1 for the very
//     old); the rest mostly sign a $1M two-year deal with a team option.
// It is a stand-in, not the game's own rule.
import { shownLevel } from './regression.js';
import { fairSalary } from './trades.js';
import { mulberry32 } from './progression.js';

const EXPIRING = 4, SIGNED = 3, FREE = 5;

export const stayOdds = (level, age) => {
  const base = level >= 75 ? 0.96 : level >= 70 ? 0.8 : level >= 65 ? 0.45 : level >= 60 ? 0.38 : level >= 55 ? 0.16 : 0.03;
  const a = age >= 33 ? 0.45 : age >= 30 ? 0.7 : age <= 24 ? 1.1 : 1;
  return Math.min(0.98, base * a);
};

function dealFor(p, rng) {
  const lv = shownLevel(p), fair = fairSalary(lv);
  if (lv >= 74) {
    const sal = Math.max(1, Math.round(fair * (0.9 + rng() * 0.25)));
    return { sal, yrs: p.age >= 34 ? 1 : p.age >= 31 ? 2 : lv >= 85 && p.age < 30 ? 4 : 3, opt: 0 };
  }
  if (rng() < 0.78) return { sal: 1, yrs: 2, opt: 1 };
  return { sal: Math.max(2, Math.round(fair * (0.9 + rng() * 0.6))), yrs: p.age >= 31 ? 2 : 3, opt: 0 };
}

// Settles every expiring player on a roster (status 4) in place; returns
// { stayed, left }.
export function settleExpiring(L, seed = 0x5e771e) {
  const rng = mulberry32(seed >>> 0);
  let stayed = 0, left = 0;
  L.freeAgents ||= [];
  for (const t of L.teams) {
    for (const p of [...t.roster]) {
      if (p.status !== EXPIRING) continue;
      if (rng() < stayOdds(shownLevel(p), p.age)) {
        const d = dealFor(p, rng);
        p.status = SIGNED;
        p.contract = { ...p.contract, tid: t.id, pid: p.id, type: 0, yrs: d.yrs, sal: d.sal, nil: 0, opt: d.opt, noTrd: 0, canExt: false, ext: { yrs: 0, sal: 0, opt: 0, noTrd: 0 } };
        stayed++;
      } else {
        t.roster.splice(t.roster.indexOf(p), 1);
        Object.assign(p, { tid: 0, status: FREE, linePos: -1 });
        p.contract = { ...p.contract, tid: 0, pid: 0, yrs: 0, sal: 0, opt: 0, ext: { yrs: 0, sal: 0, opt: 0, noTrd: 0 } };
        L.freeAgents.push(p);
        left++;
      }
    }
  }
  return { stayed, left };
}
