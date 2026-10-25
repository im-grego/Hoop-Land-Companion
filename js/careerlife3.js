// Career mode, round three: the All-Star break check-in, contract-year stakes, locker room factions, a sneaker
// line, a nemesis, the all-time debate, the entourage and the rookie you call on draft night. Pure reads and plans;
// the app applies them.
import { playerName } from './savefile.js';
import { shownLevel as levelOf } from './regression.js';
import { tr } from './traits.js';
import { egoVal } from './ego.js';
import { seasonLine } from './storylines.js';
import { trophies, careerLog } from './career.js';

const roll = (seed, n) => (((Math.imul(seed + n * 7919, 2654435761) ^ (seed >>> 7)) >>> 0) % 10000) / 10000;

// ---------------------------------------------------------------------------
// 1. The All-Star break: the regular season (phase 9) from a few days before All-Star weekend to the deadline.
export function atAllStarBreak(L) {
  const s = L.season, asw = s.allStarWeekend || 0, dl = s.tradeDeadline || asw + 2;
  return s.phase === 9 && asw > 0 && s.currentDay >= asw - 4 && s.currentDay <= dl;
}
// His first half against last season, the team's record, whether he made the All-Star team.
export function halfway(L, p, team) {
  const y = L.season.currentYear, now = seasonLine(p, 0, y);
  const prev = careerLog(p).filter(x => x.y < y).slice(-1)[0]?.l || null;
  const row = team?.season?.find(r => r.yr === y)?.seasonStats || team?.season?.slice(-1)[0]?.seasonStats || {};
  // Picked: the game's All-Star rosters (starTeams) at the break, the award once it's handed out.
  const allStar = (L.starTeams || []).some(t => (t.roster || []).some(x => x.id === p.id)) || (p.awards || []).some(a => a.id === 101 && (a.league ?? 0) === 0 && (a.yearsWon || []).includes(y));
  const pct = row.GP ? row.W / row.GP : 0.5;
  return { now, prev, w: row.W || 0, l: row.L || 0, pct, allStar, minutesDown: !!(now && prev && now.mpg < prev.mpg - 3), losing: pct < 0.42 && (row.GP || 0) >= 20 };
}
// The All-Star events he can enter: by his best rating.
export const CONTESTS = {
  dunk: { icon: '🛫', label: 'Dunk Contest', attr: 'DNK' },
  three: { icon: '🎯', label: 'Three-Point Contest', attr: 'TPT' },
  skills: { icon: '⚡', label: 'Skills Challenge', attr: 'DRB' },
};
// The game runs its own Three-Point Contest (threePointContestants); when it has one, the app leaves it alone.
export const gameThree = L => (L.threePointContestants || []).length > 0;
export const inGameThree = (L, p) => (L.threePointContestants || []).some(x => x.id === p.id);
export const contestOdds = (p, k) => Math.max(0.08, Math.min(0.7, ((p.attributes?.[CONTESTS[k].attr]?.[0] || 10) - 10) / 14));

// ---------------------------------------------------------------------------
// 2. Contract year: the last year of his deal. Goals hit push his price up, misses pull it down.
export const isContractYear = p => p.status === 3 && p.contract?.yrs === 1;
export const marketSwing = (hits, misses) => Math.max(0.85, Math.min(1.15, 1 + hits * 0.05 - misses * 0.05));

// ---------------------------------------------------------------------------
// 3. Factions: when another star shares his locker room, the room splits. Who's with him: a bond of 6+ (3+ for a
// humble teammate); with the other star: the rest of his alphas, the ones who never warmed to him.
export function factions(L, p, team) {
  if (!team) return null;
  const mates = team.roster.filter(m => m.id !== p.id && m.status === 3);
  const lv = levelOf(p);
  const star = mates.filter(m => levelOf(m) >= lv - 3 && (egoVal(m) >= 13 || levelOf(m) >= lv)).sort((a, b) => levelOf(b) - levelOf(a))[0];
  if (!star) return null;
  const bond = m => m.season?.relationship || 0;
  const mine = [], his = [], neutral = [];
  for (const m of mates) {
    if (m === star) continue;
    if (bond(m) >= 6 || (bond(m) >= 3 && egoVal(m) <= 7)) mine.push(m);
    else if (bond(m) <= -5 || (egoVal(m) >= 14 && bond(m) < 5)) his.push(m);
    else neutral.push(m);
  }
  return { star, mine, his, neutral, share: mine.length / Math.max(1, mine.length + his.length + neutral.length) };
}

// ---------------------------------------------------------------------------
// 4. His sneaker line (with a signature shoe deal): one launch a year, sales next summer from his season and fans.
export const LAUNCHES = {
  home: { icon: '🏡', label: 'Hometown colorway', says: 'For the city that raised you. Steady seller.', mult: 1, fans: 0.02 },
  team: { icon: '🏀', label: 'Team colors', says: 'Sells best when the team wins.', mult: 1.1, team: true },
  limited: { icon: '💎', label: 'Limited drop', says: 'Small run, huge hype: sells out or sits.', mult: 1.6, risky: true },
};
export function shoeSales(k, fans, ppg, pct, seed) {
  const x = LAUNCHES[k];
  let m = x.mult * Math.max(0.5, ppg / 20) * (x.team ? 0.7 + pct : 1);
  if (x.risky && roll(seed, 31) < 0.4) m *= 0.35;
  return Math.round(fans / 120 * m / 5) * 5;
}

// ---------------------------------------------------------------------------
// 5. A nemesis: the rival worth a storyline (the worst bond among players near his level), and the head-to-head.
export function nemesisCandidates(L, p) {
  const lv = levelOf(p);
  return L.teams.flatMap(t => t.roster.map(m => ({ m, t }))).filter(x => x.m.id !== p.id && (x.m.season?.relationship || 0) <= -5 && levelOf(x.m) >= lv - 10)
    .sort((a, b) => (a.m.season.relationship || 0) - (b.m.season.relationship || 0)).slice(0, 4);
}
// His team against the nemesis's team this season (the save's schedule).
export function headToHead(L, myTid, theirTid) {
  let w = 0, l = 0;
  for (const d of L.season.schedule || []) for (const g of d.results || []) {
    if (!(g.homeScore > 0) || ![g.homeTeam, g.awayTeam].includes(myTid) || ![g.homeTeam, g.awayTeam].includes(theirTid) || myTid === theirTid) continue;
    if (g.winner === myTid) w++; else l++;
  }
  return { w, l };
}

// ---------------------------------------------------------------------------
// 6. The all-time debate: where he ranks at his position (guards, wings, bigs) among every player the league knows,
// Hall of Famers and retirees included, by what they won and what they scored.
const grp = p => ((p.pos ?? 4) <= 2 ? 'guards' : (p.pos ?? 4) <= 5 ? 'wings' : 'bigs');
export const GROUP_NAME = { guards: 'guards', wings: 'wings', bigs: 'bigs' };
export function legacyScore(p) {
  const t = trophies(p), pts = (p.careerStats?.season?.PTS || 0) || careerLog(p).reduce((s, x) => s + x.l.ppg * x.l.gp, 0);
  return t.mvp * 10 + t.fmvp * 6 + t.rings * 4 + t.allNba * 3 + t.allStar * 1.5 + t.dpoy * 4 + pts / 1500;
}
export function allTimeRank(L, p) {
  const g = grp(p), seen = new Set();
  const all = [...(L.hallOfFame || []), ...(L.retirees || []), ...L.teams.flatMap(t => t.roster), ...(L.freeAgents || [])]
    .filter(x => !seen.has(x.id) && seen.add(x.id) && grp(x) === g && x.id !== p.id);
  const mine = legacyScore(p);
  const ahead = all.filter(x => legacyScore(x) > mine).sort((a, b) => legacyScore(b) - legacyScore(a));
  return { rank: ahead.length + 1, of: all.length + 1, group: g, next: ahead[ahead.length - 1] || null, score: mine };
}

// ---------------------------------------------------------------------------
// 7. The entourage: one ask a summer. yes/no: coins (now), payroll (coins a year), fx, drama (a yearly risk while
// he's on the payroll).
export function entourageAsk(p, seed) {
  const asks = [
    { k: 'cousin', icon: '👨‍👦', text: 'Your cousin wants a job: "personal assistant."', yes: { t: 'Put him on payroll', payroll: 40, fx: { morale: 5 }, drama: 0.15 }, no: { t: 'Family isn\'t business', fx: { morale: -3 } } },
    { k: 'friend', icon: '🎬', text: 'A childhood friend wants a cameo in your next commercial.', yes: { t: 'Get him in', coins: -20, fx: { morale: 4, fans: 0.01 } }, no: { t: 'Not this time', fx: { morale: -2 } } },
    { k: 'chef', icon: '👨‍🍳', text: 'Your boy wants to be your personal chef.', yes: { t: 'Hire him', payroll: 30, fx: { morale: 3 }, durability: 1 }, no: { t: 'Meal prep is fine', fx: {} } },
    { k: 'manager', icon: '🕶️', text: 'An old friend wants to manage your brand.', yes: { t: 'Trust him', payroll: 50, fx: { fans: 0.03 }, drama: 0.25 }, no: { t: 'Leave it to the pros', fx: { morale: -2 } } },
  ];
  return asks[Math.floor(roll(seed, 41) * asks.length)];
}

// ---------------------------------------------------------------------------
// 8. Draft night: the rookies his team took this year.
export function newRookies(L, p, team) {
  if (!team) return [];
  const y = L.season.currentYear;
  return team.roster.filter(m => m.id !== p.id && m.history?.draft?.yr === y && m.history?.draft?.rd > 0).sort((a, b) => a.history.draft.pk - b.history.draft.pk);
}
export const rookieLesson = p => ['motor', 'lockerRoom', 'winning', 'roadWarrior'].sort((a, b) => tr(p, b) - tr(p, a))[0];
export { playerName };
