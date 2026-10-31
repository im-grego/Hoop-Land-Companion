// The playoffs, from the bracket the save sets before game 1: series and title odds, what each team is playing for,
// and what happened (read back from the bracket the next time a file comes in).
import { shownLevel as levelOf } from './regression.js';
import { seasonLine } from './storylines.js';
import { playerName } from './savefile.js';

export const thisPlayoffs = L => (L.season.playoffs || []).find(x => x.yr === L.season.currentYear) || null;
export const playoffsOf = (L, yr) => (L.season.playoffs || []).find(x => x.yr === yr) || null;
// Before game 1 of the first round: the bracket is set and nobody has played.
export function atPlayoffStart(L) {
  const po = thisPlayoffs(L);
  return L.season.phase === 11 && !!po && (po.rounds || []).length === 1 && (po.rounds[0].series || []).every(s => (s.currentGame || 0) <= 1);
}
const record = (L, t) => { const r = t.season?.find(x => x.yr === L.season.currentYear)?.seasonStats || {}; return { w: r.W || 0, l: r.L || 0, pct: r.GP ? r.W / r.GP : 0.5 }; };
// Team strength: this season's record and its best three players (by level and this season's production).
export function strength(L, t) {
  const y = L.season.currentYear;
  const top = t.roster.filter(p => p.status === 3 || p.status === 2).map(p => { const l = seasonLine(p, 0, y); return levelOf(p) + (l ? l.gs * 0.6 : 0); }).sort((a, b) => b - a).slice(0, 3);
  return 0.6 * record(L, t).pct + 0.4 * Math.min(1, Math.max(0, (top.reduce((s, v) => s + v, 0) / 3 - 70) / 45));
}
// One game, then a best-of series (first to `need`).
const gameP = (a, b) => 1 / (1 + Math.exp(-(a - b) * 4.5));
export function seriesP(a, b, need = 4) {
  const p = gameP(a, b);
  let win = 0;
  for (let k = 0; k < need; k++) win += comb(need - 1 + k, k) * Math.pow(p, need) * Math.pow(1 - p, k);
  return win;
}
const comb = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
// Every team's odds to reach each round and win it all, through the bracket (series i meets series i^1 next round).
export function bracketOdds(L) {
  const po = thisPlayoffs(L); if (!po) return null;
  const s0 = po.rounds[0].series, need = r => (po.seriesLength?.[r] ?? 4);
  const team = id => L.teams.find(t => t.id === id), st = new Map(L.teams.map(t => [t.id, strength(L, t)]));
  // groups[r][i]: Map team id -> probability of being the winner of slot i after round r.
  let groups = s0.map(s => {
    const a = s.topSeed, b = s.lowerSeed, p = seriesP(st.get(a), st.get(b), need(0));
    return new Map([[a, p], [b, 1 - p]]);
  });
  const reach = new Map(L.teams.map(t => [t.id, [0, 0, 0, 0]]));   // won round 1, 2, conference, title
  groups.forEach(g => g.forEach((v, id) => { reach.get(id)[0] = v; }));
  for (let r = 1; groups.length > 1; r++) {
    const next = [];
    for (let i = 0; i < groups.length; i += 2) {
      const A = groups[i], B = groups[i + 1] || new Map(), m = new Map();
      for (const [a, pa] of A) for (const [b, pb] of B) { const p = seriesP(st.get(a), st.get(b), need(r)); m.set(a, (m.get(a) || 0) + pa * pb * p); m.set(b, (m.get(b) || 0) + pa * pb * (1 - p)); }
      next.push(m);
      m.forEach((v, id) => { reach.get(id)[Math.min(3, r)] = v; });
    }
    groups = next;
  }
  const teams = s0.flatMap(s => [s.topSeed, s.lowerSeed]).map(id => ({ t: team(id), odds: reach.get(id), str: st.get(id), rec: record(L, team(id)) })).filter(x => x.t);
  return { teams, series: s0.map((s, i) => ({ i, a: team(s.topSeed), b: team(s.lowerSeed), p: seriesP(st.get(s.topSeed), st.get(s.lowerSeed), need(0)) })) };
}
// His team's first-round series: { opp, p, slot }.
export function mySeries(L, tid) {
  const b = bracketOdds(L); if (!b) return null;
  const s = b.series.find(x => x.a?.id === tid || x.b?.id === tid); if (!s) return null;
  const me = s.a.id === tid;
  return { opp: me ? s.b : s.a, p: me ? s.p : 1 - s.p, seed: me ? 'higher' : 'lower', i: s.i };
}
// How far a team went in a finished playoffs (read in the offseason, once every series has a winner).
export function runOf(L, yr, tid) {
  const po = playoffsOf(L, yr); if (!po) return null;
  let won = 0, inIt = false;
  for (const rd of po.rounds || []) {
    const s = (rd.series || []).find(x => x.topSeed === tid || x.lowerSeed === tid);
    if (!s) continue;
    inIt = true;
    if (s.winner === tid) won++; else break;
  }
  return { inIt, won, champ: won >= (po.rounds || []).length && won >= 4 };
}
// Seeds by record within each half of the bracket (the first four series are one conference, the last four the other).
export function seeds(L) {
  const po = thisPlayoffs(L); if (!po) return new Map();
  const s0 = po.rounds[0].series, out = new Map(), half = Math.ceil(s0.length / 2);
  for (const part of [s0.slice(0, half), s0.slice(half)]) {
    const ids = part.flatMap(s => [s.topSeed, s.lowerSeed]);
    ids.map(id => ({ id, r: record(L, L.teams.find(t => t.id === id)) })).sort((a, b) => b.r.pct - a.r.pct).forEach((x, i) => out.set(x.id, i + 1));
  }
  return out;
}
// The owner's target by seed: the top two should reach the conference finals, three and four should win a round,
// the rest should make it a series.
export function ownerTarget(L, tid) {
  const seed = seeds(L).get(tid);
  if (!seed) return null;
  return { seed, rounds: seed <= 2 ? 2 : seed <= 4 ? 1 : 0, text: seed <= 2 ? 'reach the conference finals' : seed <= 4 ? 'win a round' : 'make it a series' };
}
// All-Defense and All-Rookie are two teams in real life; the game sometimes names a third, which doesn't count.
// Only All-NBA has three. (award: the table entry; entry: the player's award, whose team is 0 1st, 1 2nd, 2 3rd.)
export const realHonor = (award, entry) => !((entry?.team ?? 0) >= 2 && /all-?def|all-?rook/i.test(`${award?.name || ''} ${award?.shortName || ''}`));
// The award table names team honors after the 1st team ("All-NBA Team 1st Team"); the entry says which he made.
export const honorName = (award, entry) => {
  const base = (award?.name || '').replace(/ Team 1st Team$/, '').replace(/ 1st Team$/, '');
  return /^all-?(nba|league|def|rook)/i.test(award?.shortName || award?.name || '') ? `${base} ${['1st', '2nd', '3rd'][entry?.team ?? 0]} Team` : award?.name || '';
};
// The awards the game handed out this season, by its own award table.
export function awardsThisYear(L) {
  const y = L.season.currentYear, names = new Map((L.awards || []).map(a => [a.id, a]));
  const out = new Map();
  for (const t of L.teams) for (const p of t.roster) for (const a of p.awards || []) {
    if ((a.league ?? 0) !== 0 || !(a.yearsWon || []).includes(y) || a.id === 0 || a.id === 1) continue;
    if (!realHonor(names.get(a.id), a)) continue;
    if (!out.has(a.id)) out.set(a.id, { id: a.id, name: names.get(a.id)?.name || names.get(a.id)?.shortName || `Award ${a.id}`, list: [] });
    out.get(a.id).list.push({ p, t });
  }
  return [...out.values()].sort((a, b) => a.id - b.id);
}
// Who he'd see across from him: their best player at his position group.
export function matchup(p, opp) {
  const g = x => ((x.pos ?? 4) <= 2 ? 0 : (x.pos ?? 4) <= 5 ? 1 : 2);
  return opp.roster.filter(x => x.status === 3 && g(x) === g(p)).sort((a, b) => levelOf(b) - levelOf(a))[0] || null;
}
// What a playoff run does to his next contract: each series won adds 4%, a title 8% more, a first-round flop by a
// featured player costs 6%.
export const runSwing = (won, champ, featured) => 1 + won * 0.04 + (champ ? 0.08 : 0) - (won === 0 && featured ? 0.06 : 0);
export { playerName };
