// Free agency destination value: what a city and a team offer a free agent besides the money. Each part is a small
// score (about -0.1 to +0.1) and the total folds into how he ranks offers. State income tax also scales what the money
// is worth to him: $40M in Texas keeps more than $40M in California.
import { tr, traitsSet } from './traits.js';
import { teamStatus } from './draft.js';
import { shownLevel as levelOf } from './regression.js';

// By team abbreviation: top state (and city) income tax %, warm weather 0..1, market size 0..1. Teams not listed
// (custom leagues) are neutral.
const CITY = {
  ATL: [5.4, 0.7, 0.6], BOS: [9, 0.1, 0.8], BKN: [14.8, 0.2, 1], CHO: [4.3, 0.6, 0.4], CHA: [4.3, 0.6, 0.4], CHI: [5, 0, 0.9],
  CLE: [3.5, 0.1, 0.3], DAL: [0, 0.8, 0.8], DEN: [4.4, 0.4, 0.5], DET: [6.7, 0.1, 0.5], GSW: [13.3, 0.7, 0.9], GS: [13.3, 0.7, 0.9],
  HOU: [0, 0.8, 0.8], IND: [3.1, 0.2, 0.3], LAC: [13.3, 0.95, 1], LAL: [13.3, 0.95, 1], MEM: [0, 0.6, 0.2], MIA: [0, 1, 0.7],
  MIL: [7.7, 0, 0.2], MIN: [9.9, 0, 0.4], NOP: [3, 0.9, 0.2], NO: [3, 0.9, 0.2], NYK: [14.8, 0.2, 1], NY: [14.8, 0.2, 1],
  OKC: [4.8, 0.6, 0.2], ORL: [0, 0.95, 0.4], PHI: [6.8, 0.3, 0.8], PHX: [2.5, 1, 0.6], PHO: [2.5, 1, 0.6], POR: [9.9, 0.4, 0.4],
  SAC: [13.3, 0.7, 0.3], SAS: [0, 0.8, 0.4], SA: [0, 0.8, 0.4], TOR: [13.4, 0, 0.7], UTA: [4.6, 0.4, 0.2], UTAH: [4.6, 0.4, 0.2],
  WAS: [10.8, 0.5, 0.7],
};
const AVG_TAX = 6.5;
export const cityOf = team => CITY[team?.shortName] || null;
// A roster's potential: its players 25 and under, by how far above average their potential is (7 = 1 … 10 = 4).
const upside = team => team.roster.filter(x => (x.status === 3 || x.status === 2) && x.age <= 25).reduce((a, x) => a + Math.max(0, (x.pot || 0) - 6), 0);
const leagueUpside = league => league.teams.reduce((a, t) => a + upside(t), 0) / Math.max(1, league.teams.length);
const t10 = (p, k) => (traitsSet(p) ? tr(p, k) - 10 : 0);   // -10..10, 0 when unknown

// What he keeps of each dollar there, against a typical city (1 = average).
export const taxKeep = team => { const c = cityOf(team); return c ? (1 - c[0] / 100) / (1 - AVG_TAX / 100) : 1; };

// The parts: [{ k, label, v, text }], v in score units.
export function destinationParts(league, team, p) {
  const c = cityOf(team), out = [];
  const add = (k, label, v, text) => { if (Math.abs(v) >= 0.005) out.push({ k, label, v: Math.round(v * 1000) / 1000, text }); };
  if (c) {
    // Tax works on the money itself (see taxKeep); listed here so the screen can show it.
    out.push({ k: 'tax', label: 'State tax', v: 0, keep: taxKeep(team) - 1, text: c[0] === 0 ? 'no state income tax' : `${c[0]}% state income tax` });
    // Veterans like the weather; everyone a little.
    add('weather', 'Weather', (c[1] - 0.5) * (p.age >= 30 ? 0.06 : 0.03), c[1] >= 0.8 ? 'warm all year' : c[1] <= 0.2 ? 'long cold winters' : '');
    // Big markets pay off for stars and money chasers (endorsements, spotlight).
    const star = levelOf(p) >= 85 ? 1 : levelOf(p) >= 78 ? 0.5 : 0.2;
    add('market', 'Market', (c[2] - 0.5) * (0.04 + 0.04 * star + Math.max(0, t10(p, 'money')) * 0.004), c[2] >= 0.8 ? 'a big market' : c[2] <= 0.3 ? 'a small market' : '');
  }
  // Stage: veterans and competitors want a team going for it. Young players want a team with a lot of potential, a
  // core still rising they can grow with, whether it's winning yet or not.
  const st = teamStatus(league, team);
  const win = Math.max(0, t10(p, 'winning'));
  const stage = st === 'contending' ? 1 : st === 'competing' ? 0.4 : st === 'developing' ? -0.3 : -1;
  if (p.age >= 29) add('stage', 'Team stage', stage * (0.04 + win * 0.006), stage > 0 ? 'a team built to win now' : 'a team that is rebuilding');
  else if (p.age >= 26) add('stage', 'Team stage', stage * (0.02 + win * 0.005), '');
  else {
    const up = upside(team) - leagueUpside(league);
    add('upside', 'Potential', Math.max(-0.05, Math.min(0.05, up * 0.006)) + Math.max(0, stage) * win * 0.003,
      up >= 3 ? 'a roster full of potential' : up <= -3 ? 'little upside on the roster' : '');
  }
  // Construction: a star wants a co-star; anyone avoids a logjam of better players at his spot.
  const roster = team.roster.filter(x => x.status === 3 || x.status === 2);
  const lv = levelOf(p);
  const better = roster.filter(x => levelOf(x) > lv);
  const grp = x => (x.pos <= 2 ? 0 : x.pos <= 5 ? 1 : 2);
  const blocked = better.filter(x => grp(x) === grp(p)).length;
  if (lv >= 84) add('build', 'Roster', better.length || roster.some(x => levelOf(x) >= lv - 3) ? 0.04 : -0.03, better.length ? 'a co-star to play with' : 'no co-star yet');
  if (blocked >= 2) add('build', 'Playing time', -0.02 * (blocked - 1), `${blocked} better players at his spot`);
  return out;
}
export function destinationValue(league, team, p) {
  return destinationParts(league, team, p).reduce((s, x) => s + x.v, 0);
}
// A grade for the offer screen: A+ .. D.
export function destinationGrade(league, team, p) {
  const v = destinationValue(league, team, p) + (taxKeep(team) - 1) * 0.6;
  return v >= 0.1 ? 'A+' : v >= 0.06 ? 'A' : v >= 0.03 ? 'B+' : v >= 0 ? 'B' : v >= -0.03 ? 'C+' : v >= -0.06 ? 'C' : 'D';
}
