// Career mode, round four: the exit interview, the player option, surgery or rehab, taking less for a teammate,
// stars recruiting him, the no-trade clause, friends traded away, the GM asking his opinion, a superteam demand, the
// playoffs round by round, big playoff moments, his playoff résumé, the parade and the blame game. Pure reads and
// plans; the app applies them.
import { shownLevel as levelOf } from './regression.js';
import { seasonLine } from './storylines.js';
import { careerLog, trophies, rankIdx } from './career.js';
import { playerName } from './savefile.js';

const SKILL_NAMES = { LAY: 'finishing at the rim', DNK: 'dunking', INS: 'the post game', MID: 'the midrange', TPT: 'the three', FTS: 'free throws', DRB: 'ball handling', PAS: 'passing', ORE: 'offensive rebounding', DRE: 'defensive rebounding', STL: 'on-ball defense', BLK: 'rim protection' };
export const skillName = k => SKILL_NAMES[k] || k;

// ---------------------------------------------------------------------------
// 1. Exit interview: a grade for the season (production against his level, and how the team did), the skill to work
// on (the one with the most room that matters for his position), and a role promise for next year.
export function exitInterview(L, p, team, yr) {
  const l = seasonLine(p, 0, yr);
  if (!l || l.gp < 10) return null;
  const lv = levelOf(p), expect = Math.max(4, (lv - 60) * 0.55);   // the game score his level should produce
  const row = team?.season?.find(r => r.yr === yr)?.seasonStats || {}, pct = row.GP ? row.W / row.GP : 0.5;
  const z = (l.gs - expect) / 4 + (pct - 0.5) * 2;
  const grade = z >= 1 ? 'A' : z >= 0.3 ? 'B' : z >= -0.3 ? 'C' : z >= -1 ? 'D' : 'F';
  const grp = (p.pos ?? 4) <= 2 ? ['DRB', 'PAS', 'TPT', 'STL', 'MID'] : (p.pos ?? 4) <= 5 ? ['TPT', 'MID', 'LAY', 'STL', 'DRE'] : ['INS', 'BLK', 'DRE', 'ORE', 'LAY'];
  const work = grp.filter(k => p.attributes?.[k]).sort((a, b) => (p.attributes[b][1] - p.attributes[b][0]) - (p.attributes[a][1] - p.attributes[a][0]) || p.attributes[a][0] - p.attributes[b][0])[0];
  const starter = (l.starts || 0) / l.gp >= 0.5;
  const promise = starter ? { k: 'start', text: 'You stay in the starting five.', need: 41 } : { k: 'earn', text: 'Earn your way into the starting five: 41+ starts next year.', need: 41 };
  return { grade, line: l, pct, work, promise };
}

// ---------------------------------------------------------------------------
// 2. Player option: the last year of his deal is his call (contract.opt 2 with a year left).
export const hasPlayerOption = p => p.status === 3 && p.contract?.opt === 2 && p.contract?.yrs === 1;

// ---------------------------------------------------------------------------
// 3. Hurt at season's end: surgery (miss the start, come back stronger) or rehab (back sooner, it may linger).
export const hurtNow = p => (p.season?.injury?.gamesOut || 0) > 0;

// ---------------------------------------------------------------------------
// 4. Take less: his own team's offer, a friend of his (bond 20+) on an expiring deal there.
export function friendsToKeep(p, team) {
  if (!team) return [];
  return team.roster.filter(m => m.id !== p.id && m.status === 4 && (m.season?.relationship || 0) >= 20).sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 2);
}
export const TAKE_LESS = 0.85;

// ---------------------------------------------------------------------------
// 5. Stars call him: friends (20+) and brothers (40+) on other teams, in order of how close they are.
export function callers(L, p, from) {
  return L.teams.filter(t => t !== from).flatMap(t => t.roster.filter(m => m.status === 3 && (m.season?.relationship || 0) >= 20 && levelOf(m) >= 70).map(m => ({ m, t, bond: m.season.relationship })))
    .sort((a, b) => b.bond - a.bond || levelOf(b.m) - levelOf(a.m)).slice(0, 3);
}

// ---------------------------------------------------------------------------
// 6. The no-trade clause.
export const hasNtc = p => (p.contract?.noTrd || 0) === 1;

// ---------------------------------------------------------------------------
// 7. Friends traded away: teammates he was close with (20+) who are on another team now.
export function friendsGone(L, p, team, lastMates) {
  if (!team || !lastMates?.length) return [];
  const now = new Set(team.roster.map(m => m.id));
  return lastMates.filter(id => !now.has(id)).map(id => { for (const t of L.teams) { const m = t.roster.find(x => x.id === id); if (m) return { m, t }; } return null; }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 8-9. Trades for a star: who the GM likes at the deadline (a seller's best veteran his team could use) and the
// stars he could demand (Lv 88+, not his teammates).
export function starTargets(L, p, team) {
  return L.teams.filter(t => t !== team).flatMap(t => t.roster.filter(m => m.status === 3 && levelOf(m) >= 86 && m.id !== p.id).map(m => ({ m, t })))
    .sort((a, b) => levelOf(b.m) - levelOf(a.m)).slice(0, 8);
}
export const demandOdds = (p, coachRp) => Math.max(0.1, Math.min(0.75, 0.15 + (rankIdx(p) - 3) * 0.12 + (coachRp || 0) / 150));

// ---------------------------------------------------------------------------
// 10. Between rounds: which round he's in (0 = first round), and whether his team is still alive.
export function playoffRound(L, tid) {
  const po = (L.season.playoffs || []).find(x => x.yr === L.season.currentYear);
  if (L.season.phase !== 11 || !po) return null;
  const r = (po.rounds || []).length - 1, s = (po.rounds[r]?.series || []).find(x => x.topSeed === tid || x.lowerSeed === tid);
  const started = (po.rounds[r]?.series || []).some(x => (x.currentGame || 0) > 1);
  return { r, alive: !!s, s, started, name: ['First Round', 'Conference Semifinals', 'Conference Finals', 'The Finals'][r] || `Round ${r + 1}` };
}

// ---------------------------------------------------------------------------
// 11-12. Playoff numbers: a season's playoff line, his career playoff line, and how he plays when it counts.
const sumRows = rows => rows.reduce((t, r) => { for (const k of ['GP', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'W', 'L']) t[k] = (t[k] || 0) + (r[k] || 0); return t; }, {});
export function playoffLine(p, yr) {
  const s = (p.stats || []).find(x => x.league === 0 && x.yr === yr), t = sumRows(s?.playoffs || []), f = sumRows(s?.finals || []);
  return t.GP ? { gp: t.GP, ppg: t.PTS / t.GP, rpg: t.REB / t.GP, apg: t.AST / t.GP, w: t.W, l: t.L, finals: f.GP ? { gp: f.GP, ppg: f.PTS / f.GP, w: f.W, l: f.L } : null } : null;
}
export function playoffCareer(p) {
  const yrs = (p.stats || []).filter(x => x.league === 0 && (x.playoffs || []).some(r => r.GP > 0));
  const t = sumRows(yrs.flatMap(x => x.playoffs)), f = sumRows(yrs.flatMap(x => x.finals || []));
  const reg = careerLog(p).reduce((a, x) => ({ gp: a.gp + x.l.gp, pts: a.pts + x.l.ppg * x.l.gp }), { gp: 0, pts: 0 });
  if (!t.GP) return null;
  const ppg = t.PTS / t.GP, regPpg = reg.gp ? reg.pts / reg.gp : 0, diff = ppg - regPpg;
  return { seasons: yrs.length, gp: t.GP, ppg, rpg: t.REB / t.GP, apg: t.AST / t.GP, w: t.W, l: t.L, finals: f.GP ? { gp: f.GP, w: f.W, l: f.L } : null, high: p.careerStats?.playoffHighs?.PTS || 0, regPpg, diff,
    label: t.GP >= 10 ? (diff >= 2 ? 'Rises in the playoffs' : diff <= -2 ? 'Shrinks in the playoffs' : 'Steady in the playoffs') : null };
}
// The moments worth a headline from a finished playoff run: a new career playoff high, a big run, the Finals.
export function playoffMoments(p, yr, seenHigh) {
  const out = [], l = playoffLine(p, yr), high = p.careerStats?.playoffHighs?.PTS || 0;
  if (!l) return { out, high };
  if (high >= 35 && high > (seenHigh || 0)) out.push({ k: 'high', text: `dropped ${high} in a playoff game, a career playoff high`, legacy: high >= 50 ? 20 : high >= 40 ? 12 : 6, fans: 0.03 });
  if (l.gp >= 8 && l.ppg >= 25) out.push({ k: 'run', text: `averaged ${l.ppg.toFixed(1)} a night through the playoffs`, legacy: 10, fans: 0.03 });
  if (l.finals) out.push({ k: 'finals', text: `played on the biggest stage: the Finals (${l.finals.w}-${l.finals.l})`, legacy: 10, fans: 0.04 });
  return { out, high };
}

// ---------------------------------------------------------------------------
// 13-14. After the playoffs: a title (the parade, then ring night when the season opens) or an elimination (the
// blame game).
export const BLAME = {
  own: { icon: '🪞', label: 'Own it', says: 'I didn\'t get it done. That\'s on me.', fx: { coach: 3, ego: -1, fans: 0.01 } },
  coach: { icon: '📋', label: 'Point at the coaching', says: 'We needed better answers from the bench.', fx: { coach: -8, ego: 1, fans: 0.02 } },
  mates: { icon: '👉', label: 'Call out teammates', says: 'Some guys weren\'t ready for that stage.', fx: { ego: 1, fans: 0.01, mates: -5 } },
};
export const PARADE = {
  lead: { icon: '🎉', label: 'Lead the parade', says: 'On top of the bus, mic in hand.', fx: { fans: 0.08, morale: 5, ego: 1 } },
  team: { icon: '🤝', label: 'Share the stage', says: 'Every teammate gets the mic.', fx: { fans: 0.04, mates: 5, coach: 2 } },
};
export const isRingNight = L => L.season.phase === 9 && (L.season.currentDay || 0) <= 15;
export { playerName, trophies };
