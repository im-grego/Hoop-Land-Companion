// Career mode (season.mode 2): the save follows one player (season.playerId). The game keeps his legacy rank
// (p.season.legacy, 1 = Rookie … 9 = GOAT), legacy points, fans, fame and coins; the app reads them and writes
// the story around him: his standing on the team, the locker room he walks into, and what the front office thinks.
import { playerName, POSITIONS } from './savefile.js';
import { shownLevel as levelOf } from './regression.js';
import { tr, traitsSet } from './traits.js';
import { egoVal } from './ego.js';
import { seasonLine } from './storylines.js';

export const RANKS = ['Rookie', 'Bench Warmer', 'Role Player', 'Star Player', 'All Star', 'Superstar', 'Hall of Famer', 'Legend', 'Greatest of All Time'];
export const RANK_ICONS = ['🐣', '🪑', '🧩', '⭐', '🌟', '💫', '🏛️', '👑', '🐐'];
const FAME = ['Unknown', 'Local Legend'];          // the ones we've seen in the game; the rest read "Fame N"
const SLOTS = { 0: 'PG', 2: 'SG', 4: 'SF', 6: 'PF', 8: 'C' };

export const isCareer = L => L?.season?.mode === 2 && L.season.playerId > 0;
export function careerPlayer(L) {
  const id = L.season.playerId;
  for (const t of L.teams) { const p = t.roster.find(x => x.id === id); if (p) return { p, team: t }; }
  const p = (L.freeAgents || []).find(x => x.id === id);
  return p ? { p, team: null } : null;
}
export const rankIdx = p => Math.max(0, Math.min(RANKS.length - 1, (p.season?.legacy ?? 1) - 1));
export const fameName = f => FAME[f] || `Fame ${f}`;
const won = (p, id) => (p.awards || []).filter(a => a.id === id && (a.league ?? 0) === 0).reduce((n, a) => n + (a.yearsWon || []).length, 0);
export const trophies = p => ({ rings: won(p, 0), fmvp: won(p, 1), mvp: won(p, 2), allNba: won(p, 13), allStar: won(p, 23), dpoy: won(p, 4) });

// His role as the game shows it: "Starting SG", "6th Man", "Bench".
export function roleOf(p, team) {
  if (!team) return 'Free agent';
  const slot = SLOTS[p.teamPos] || POSITIONS[p.pos] || '';
  return p.linePos <= 4 ? `Starting ${slot}` : p.linePos === 5 ? '6th Man' : p.linePos <= 9 ? 'Rotation' : 'Bench';
}

// Where he stands on his team: his rank by level, who's pushing him at his spot, the coach.
export function standing(L, p, team) {
  if (!team) return null;
  const roster = team.roster.filter(x => x.status !== 7);
  const byLv = [...roster].sort((a, b) => levelOf(b) - levelOf(a));
  const rank = byLv.findIndex(x => x.id === p.id) + 1;
  const mine = levelOf(p);
  const sameSpot = roster.filter(x => x.id !== p.id && Math.abs((x.teamPos ?? 0) - (p.teamPos ?? 0)) <= 1);
  const push = sameSpot.filter(x => levelOf(x) >= mine - 3 || (x.age <= 23 && x.pot >= p.pot && levelOf(x) >= mine - 8)).sort((a, b) => levelOf(b) - levelOf(a))[0] || null;
  const coach = (team.frontOffice?.staff || []).find(s => s.pos === 1) || null;
  const top = byLv[0];
  const security = rank === 1 ? 'The franchise player' : p.linePos <= 4 && !push ? 'Locked into the starting five' : p.linePos <= 4 ? 'Starting, with someone pushing' : push ? 'Fighting for minutes' : 'Earning his spot';
  return { rank, of: roster.length, push, coach, top: top.id === p.id ? null : top, security };
}

// The locker room he walks into: the alphas he'll share the ball with, the leaders, the problems.
export function lockerRoom(L, p, team) {
  if (!team) return [];
  const mates = team.roster.filter(x => x.id !== p.id && x.status !== 7 && traitsSet(x));
  const out = [];
  const myLv = levelOf(p), meAlpha = egoVal(p) >= 13;
  for (const m of mates) {
    const lv = levelOf(m), ego = egoVal(m), lr = tr(m, 'lockerRoom');
    if (ego >= 16 && lv >= myLv - 4) out.push({ m, kind: 'alpha', w: 3 + (meAlpha ? 2 : 0), text: meAlpha ? 'another alpha: there is one ball' : 'wants the ball in big moments' });
    else if (lr >= 16) out.push({ m, kind: 'leader', w: 2, text: m.age >= 30 ? 'the veteran voice in the room' : 'keeps the room together' });
    else if (lr <= 4) out.push({ m, kind: 'cancer', w: 2, text: 'a problem in the locker room' });
    if (m.age >= 31 && lr >= 12 && m.teamPos != null && Math.abs(m.teamPos - p.teamPos) <= 2 && p.age <= 24) out.push({ m, kind: 'mentor', w: 1.5, text: 'a vet at his spot who can show him the ropes' });
  }
  const seen = new Set();
  // Leaders count when they carry weight in the room: the two who play the most.
  const lead = out.filter(x => x.kind === 'leader').sort((a, b) => levelOf(b.m) - levelOf(a.m)).slice(2).map(x => x.m.id);
  return out.filter(x => !(x.kind === 'leader' && lead.includes(x.m.id))).sort((a, b) => b.w - a.w).filter(x => (seen.has(x.m.id) ? false : seen.add(x.m.id))).slice(0, 5);
}

// How the front office sees him: worth his deal or not, part of the plan or a trade chip.
export function frontOffice(L, p, team) {
  if (!team) return null;
  const c = p.contract || {}, lv = levelOf(p);
  const fair = lv >= 90 ? 45 : lv >= 85 ? 32 : lv >= 80 ? 20 : lv >= 75 ? 11 : lv >= 70 ? 5 : 2;
  const value = c.sal ? fair / c.sal : 1;
  const young = p.age <= 24 && p.pot >= 9;
  const buzz = Math.max(0.03, Math.min(0.6, (value < 0.7 ? 0.25 : value > 1.5 ? 0.12 : 0.08) + (young ? -0.06 : 0) + (p.age >= 30 ? 0.08 : 0) + (c.yrs === 1 ? 0.06 : 0)));
  const word = value >= 1.5 ? 'a bargain on his deal' : value >= 0.95 ? 'worth what they pay him' : value >= 0.7 ? 'paid a bit ahead of his game' : 'overpaid, and they know it';
  return { value, word, buzz, plan: young || lv >= 85 ? 'Part of the core' : buzz >= 0.25 ? 'On the trade block in whispers' : 'Part of the plan, for now' };
}

// Season by season in the pro league.
export function careerLog(p) {
  const yrs = [...new Set((p.stats || []).filter(s => s.league === 0).map(s => s.yr))].sort((a, b) => a - b);
  return yrs.map(y => ({ y, l: seasonLine(p, 0, y) })).filter(x => x.l);
}
export { playerName };
