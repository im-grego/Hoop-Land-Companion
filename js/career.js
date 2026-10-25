// Career mode (season.mode 2): the save follows one player (season.playerId). The game keeps his legacy rank
// (p.season.legacy, 1 = Rookie … 9 = GOAT), legacy points, fans, fame, coins and his bonds with players and his
// coach; the app reads them and writes
// the story around him: his standing on the team, the locker room he walks into, and what the front office thinks.
import { playerName, POSITIONS } from './savefile.js';
import { shownLevel as levelOf } from './regression.js';
import { tr, traitsSet } from './traits.js';
import { egoVal } from './ego.js';
import { seasonLine } from './storylines.js';
import * as FA from './freeagency.js';
import { cityOf } from './destination.js';
import { teamStatus } from './draft.js';

export const RANKS = ['Rookie', 'Bench Warmer', 'Role Player', 'Star Player', 'All Star', 'Superstar', 'Hall of Famer', 'Legend', 'Greatest of All Time'];
export const RANK_ICONS = ['🐣', '🪑', '🧩', '⭐', '🌟', '💫', '🏛️', '👑', '🐐'];
const FAME = ['Unknown', 'Local Legend'];          // the ones we've seen in the game; the rest read "Fame N"
const SLOTS = { 0: 'PG', 2: 'SG', 4: 'SF', 6: 'PF', 8: 'C' };

export const isCareer = L => L?.season?.mode === 2 && L.season.playerId > 0;
export function careerPlayer(L) {
  const id = L.season.playerId;
  for (const t of L.teams) { const p = t.roster.find(x => x.id === id); if (p) return { p, team: t }; }
  const p = (L.freeAgents || []).find(x => x.id === id);
  if (p) return { p, team: null };
  const r = (L.retirees || []).find(x => x.id === id);   // his career is over
  return r ? { p: r, team: null, retired: true } : null;
}
export const rankIdx = p => Math.max(0, Math.min(RANKS.length - 1, (p.season?.legacy ?? 1) - 1));
export const fameName = f => FAME[f] || `Fame ${f}`;
const won = (p, id) => (p.awards || []).filter(a => a.id === id && (a.league ?? 0) === 0).reduce((n, a) => n + (a.yearsWon || []).length, 0);
export const trophies = p => ({ rings: won(p, 0), fmvp: won(p, 1), mvp: won(p, 2), allNba: won(p, 13), allStar: won(p, 101), dpoy: won(p, 3) });   // the game's award ids: 101 All-Star, 3 DPOY

// His role as the game shows it: "Starting SG", "6th Man", "Bench".
export function roleOf(p, team) {
  if (!team) return 'Free agent';
  const slot = SLOTS[p.teamPos] || POSITIONS[p.pos] || '';
  return p.linePos <= 4 ? `Starting ${slot}` : p.linePos === 5 ? '6th Man' : p.linePos <= 9 ? 'Rotation' : 'Bench';
}

// Where he stands on his team: his rank by level, who's pushing him at his spot, the coach.
// val: how the roster is ranked (the app passes trade value; level by default).
export function standing(L, p, team, val = levelOf) {
  if (!team) return null;
  const roster = team.roster.filter(x => x.status !== 7);
  const byLv = [...roster].sort((a, b) => val(b) - val(a));
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

// Who he's close with and who he's beefing with: the game keeps his bond with every player on that player's
// season.relationship (old teammates sit near 50, rivals below 0). The coach's bond is the coach's rp.
export function relationships(L, p) {
  const out = [];
  for (const t of L.teams) for (const m of t.roster) {
    const r = m.season?.relationship || 0;
    if (m.id === p.id || !r) continue;
    out.push({ m, team: t, r, mate: t.id === p.tid || t.roster.some(x => x.id === p.id) });
  }
  return { friends: out.filter(x => x.r > 0).sort((a, b) => b.r - a.r), rivals: out.filter(x => x.r < 0).sort((a, b) => a.r - b.r) };
}
export const coachBond = c => c?.rp ?? 0;
// Bonds run −50 to +50 in the game.
export const BOND_CAP = 50;
export const clampBond = r => Math.max(-BOND_CAP, Math.min(BOND_CAP, Math.round(r)));
export const bondWord = r => (r >= 40 ? 'Brothers' : r >= 20 ? 'Close' : r >= 5 ? 'Friendly' : r > -5 ? 'Neutral' : r > -20 ? 'Tension' : r > -40 ? 'Rivals' : 'Enemies');

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

// ---------------------------------------------------------------------------
// Agents. He hires one; the style decides what he asks for, what deals he chases, what a counter risks, and what the
// people around him think of the man on the phone. The fee comes out of his coins when he hires the agent.
export const CAREER_AGENTS = {
  shark: { icon: '🦈', name: 'Marcus Vane', label: 'The Shark', fa: 'shark', fee: 150, counter: 0.7, walk: 0.35, coach: -3, bond: 0, fans: 0,
    says: 'Gets every dollar. Teams brace when he calls, and coaches remember it.', wants: 'money' },
  brand: { icon: '📣', name: 'Dana Holt', label: 'The Brand Builder', fa: 'fair', fee: 100, counter: 0.5, walk: 0.15, coach: 0, bond: 0, fans: 0.1,
    says: 'Thinks in markets and followers. Big city, bigger stage, more fans.', wants: 'market' },
  family: { icon: '🏠', name: 'Uncle Ray', label: 'The Family Friend', fa: 'friendly', fee: 25, counter: 0.35, walk: 0.05, coach: 3, bond: 4, fans: 0,
    says: 'Has known you since AAU. Cheap and loyal, and teams like dealing with him. He leaves money on the table.', wants: 'fit' },
};
export const AGENT_KEYS = Object.keys(CAREER_AGENTS);

// The market he'd see: every team that can and wants to pay him, as offers { tid, sal, yrs, opt, interest, own }.
// Interest: how much he'd help them (where he'd rank on their roster), his upside, and whether they're built to spend.
// day: the free agency day (1 before it opens). rnd(team id) → 0..1, stable for the offseason.
export function careerOffers(L, p, agentKey, day, rnd, { ringChase = false } = {}) {
  const ag = CAREER_AGENTS[agentKey] || CAREER_AGENTS.brand;
  const ask = FA.baseAsk(L, p), from = L.teams.find(t => t.roster.includes(p)) || null;
  const out = [];
  for (const t of L.teams) {
    const own = from?.id === t.id;
    const room = FA.offerRoom(L, t, p, day);
    if (room.full || room.max < FA.minFor(p)) continue;
    const role = FA.roleFit(L, t, p), st = teamStatus(L, t);
    let interest = 0.35 * role + 0.15 * Math.min(1, Math.max(0, (p.pot - 6) / 4)) * (p.age <= 25 ? 1 : 0.4) + 0.38 * rnd(t.id) + (st === 'rebuilding' && p.age <= 24 ? 0.08 : 0) + (own ? 0.15 : 0);
    if (ag.wants === 'market') interest += ((cityOf(t)?.[2] ?? 0.5) - 0.5) * 0.15;   // she gets the big markets on the phone
    if (ag.wants === 'fit') interest += Math.min(0.12, bondsOn(p, t).friends.length * 0.04);   // he knows the people there
    // A brother on the roster (40+) has been in his ear: those teams call.
    interest += Math.min(0.2, t.roster.filter(m => m.id !== p.id && (m.season?.relationship || 0) >= 40).length * 0.1);
    if (ringChase && FA.teamStrength(L, t) < 0.55) continue;   // ring or bust: contenders only
    if (ringChase) interest += 0.2;
    if (interest < 0.42 && !own) continue;
    // The keenest teams pay his number; the rest come in under it.
    const want = ask * Math.min(1.05, 0.55 + 0.55 * Math.min(1, interest));
    let sal = Math.max(FA.minFor(p), Math.min(room.max, Math.round(want * (ringChase ? 0.7 : 1))));   // he takes less to chase it
    if (interest < 0.85 && !own) sal = Math.min(sal, Math.round(FA.maxSalary(L, p) * 0.88));   // only the teams that really want him go to the max
    if (sal < ask * 0.6 && !own) continue;
    const yrs = p.age <= 25 ? (interest >= 0.7 ? 4 : 3) : p.age <= 29 ? 3 : p.age <= 32 ? 2 : 1;
    out.push({ tid: t.id, sal, yrs, opt: p.age <= 25 && ag.wants === 'money' && interest >= 0.75 ? FA.OPT_PLAYER : FA.OPT_NONE, interest, own, max: room.max });
  }
  return out.sort((a, b) => b.interest - a.interest).filter((o, i) => i < 6 || o.own);   // the six keenest, and always his own team
}

// The people he'd join: friends (bond 20+) and bad blood (-5 or lower) on a roster.
export function bondsOn(p, team) {
  const mates = team.roster.filter(x => x.id !== p.id && x.status !== 7);
  return { friends: mates.filter(x => (x.season?.relationship || 0) >= 20), rivals: mates.filter(x => (x.season?.relationship || 0) <= -5) };
}

// Everything a pitch meeting covers.
export function careerPitch(L, p, offer, agentKey) {
  const team = L.teams.find(t => t.id === offer.tid);
  const roster = team.roster.filter(x => x.id !== p.id && (x.status === 3 || x.status === 2));
  const lv = levelOf(p);
  const rank = roster.filter(x => levelOf(x) > lv).length + 1;
  const role = rank === 1 ? 'The No. 1 option' : rank <= 2 ? 'The No. 2 option' : rank <= 5 ? 'A starter' : rank <= 8 ? 'Rotation minutes' : 'Bench';
  const alphas = roster.filter(x => egoVal(x) >= 16 && levelOf(x) >= lv - 4);
  const coach = (team.frontOffice?.staff || []).find(s => s.pos === 1) || null;
  const ring = FA.teamStrength(L, team), market = cityOf(team)?.[2] ?? 0.5;
  const b = bondsOn(p, team);
  const ag = CAREER_AGENTS[agentKey] || CAREER_AGENTS.brand;
  const total = offer.sal * offer.yrs;
  const money = offer.sal / Math.max(1, FA.baseAsk(L, p));
  const fit = (rank <= 2 ? 0.3 : rank <= 5 ? 0.15 : -0.1) + b.friends.length * 0.08 - b.rivals.length * 0.1 - alphas.length * (egoVal(p) >= 13 ? 0.12 : 0.04) + (coach ? (coach.rp || 0) / 250 : 0) + (offer.own ? 0.08 : 0);
  const score = ag.wants === 'money' ? money * 1.4 + fit * 0.3 + ring * 0.2
    : ag.wants === 'market' ? money + market * 0.6 + ring * 0.2 + fit * 0.3
    : money * 0.7 + fit * 1.2 + ring * 0.3;
  return { team, role, rank, alphas, coach, ring, market, friends: b.friends, rivals: b.rivals, total, score,
    fans: Math.round(((market - 0.5) * 0.3 + ag.fans) * 1000) / 1000, stage: teamStatus(L, team) };
}

// ---------------------------------------------------------------------------
// Role fights: once an offseason, when his spot or his shots are in question.
export function roleFight(L, p, team) {
  if (!team || p.status !== 3) return null;
  const st = standing(L, p, team);
  const lv = levelOf(p);
  const alpha = team.roster.filter(x => x.id !== p.id && x.status !== 7 && egoVal(x) >= 16 && levelOf(x) >= lv - 2).sort((a, b) => levelOf(b) - levelOf(a))[0];
  const yrs = careerLog(p);
  const last = yrs[yrs.length - 1]?.l, prev = yrs[yrs.length - 2]?.l;
  if (alpha && egoVal(p) >= 12) return { kind: 'alpha', rival: alpha, text: `${playerName(alpha)} wants the ball in the big moments, and so do you. There's one ball.` };
  if (st?.push && levelOf(st.push) >= lv - 1) return { kind: 'push', rival: st.push, text: `${playerName(st.push)} is coming for your spot, and the coaches have noticed.` };
  if (last && prev && last.mpg < prev.mpg - 4 && last.gp >= 20) return { kind: 'minutes', rival: null, text: `Your minutes fell from ${prev.mpg.toFixed(0)} to ${last.mpg.toFixed(0)} a night.` };
  if (p.linePos > 4 && lv >= 78) return { kind: 'bench', rival: st?.push || null, text: 'You came off the bench, and you think you should start.' };
  return null;
}
// Can he win it? His level against the rival's, his bond with the coach, his ego.
export function demandOdds(p, fight, coach) {
  const gap = fight.rival ? levelOf(p) - levelOf(fight.rival) : 3;
  return Math.max(0.1, Math.min(0.85, 0.45 + gap * 0.06 + (coach?.rp || 0) / 150));
}

export { playerName };
