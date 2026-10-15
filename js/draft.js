// Draft tools: prospect comps, lottery simulation, mock drafts, pick trades.

import { ATTRS, PHYSICAL, playerName } from './savefile.js';
import { mulberry32 } from './progression.js';

// The 12 skill ratings (physical ratings aren't kept for retirees).
export const SKILL_ATTRS = ATTRS.filter(k => !PHYSICAL.includes(k));

// Drafted rookies lose 4 from each skill rating, but never drop below 2
// (a rating already at 2 or lower stays where it is).
export const DRAFT_DROP = 4;
export const DRAFT_FLOOR = 2;
export const draftDrop = v => (v <= DRAFT_FLOOR ? v : Math.max(DRAFT_FLOOR, v - DRAFT_DROP));

export function floorVector(p) {
  return SKILL_ATTRS.map(k => draftDrop(p.attributes[k][0]));
}
export function ceilingVector(p) {
  return SKILL_ATTRS.map(k => Math.max(p.attributes[k][0], p.attributes[k][1]));
}

// ---------------------------------------------------------------------------
// Comps

// Comparison pool: active players + free agents (current ratings), retirees
// and Hall of Famers (best of their two stored values).
export function buildCompPool(league) {
  const pool = [];
  const add = (p, group, vec) => {
    if (!p?.attributes || !p.ht) return;
    const v = vec(p);
    if (v.reduce((a, b) => a + b, 0) < 40) return; // empty/placeholder records
    pool.push({ p, group, v, ht: p.ht });
  };
  for (const t of league.teams) for (const p of t.roster) add(p, 'Active', x => SKILL_ATTRS.map(k => x.attributes[k][0]));
  for (const p of league.freeAgents || []) add(p, 'Free Agent', x => SKILL_ATTRS.map(k => x.attributes[k][0]));
  for (const p of league.retirees || []) add(p, 'Retired', ceilingVector);
  for (const p of league.hallOfFame || []) add(p, 'Hall of Fame', ceilingVector);
  return pool;
}

const HEIGHT_WEIGHT = 1.5; // one inch counts like 1.5 rating points

export function compDistance(v, ht, entry) {
  let d = 0;
  for (let i = 0; i < v.length; i++) d += (v[i] - entry.v[i]) ** 2;
  d += (HEIGHT_WEIGHT * (ht - entry.ht)) ** 2;
  return Math.sqrt(d);
}

// Closest pool players to a vector. Similarity is 0-100.
export function findComps(v, ht, pool, n = 3, excludeId = null) {
  return pool
    .filter(e => e.p.id !== excludeId)
    .map(e => ({ ...e, dist: compDistance(v, ht, e) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map(e => ({ name: playerName(e.p), group: e.group, ht: e.ht, pos: e.p.pos, sim: Math.max(0, Math.round(100 - e.dist * 3)), id: e.p.id }));
}

export function prospectComps(p, pool) {
  return {
    floor: findComps(floorVector(p), p.ht, pool, 3, p.id),
    ceiling: findComps(ceilingVector(p), p.ht, pool, 3, p.id),
  };
}

// ---------------------------------------------------------------------------
// Prospect value (used for CPU picks and board order)

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const topN = (a, n) => [...a].sort((x, y) => y - x).slice(0, n);

export function prospectValue(p) {
  const ceil = mean(topN(ceilingVector(p), 8));
  const floor = mean(topN(floorVector(p), 8));
  return ceil * 0.65 + floor * 0.35 + p.pot * 0.4 + (21 - p.age) * 0.25;
}

// ---------------------------------------------------------------------------
// Standings, lottery, draft order

export function teamRecord(team, year) {
  const rows = (team.season || []).filter(s => s.seasonStats?.GP > 0);
  const row = year != null ? rows.find(s => s.yr === year) : rows[rows.length - 1];
  if (!row) return { W: 0, L: 0, pct: 0, yr: null };
  const { W, L } = row.seasonStats;
  return { W, L, pct: W + L ? W / (W + L) : 0, yr: row.yr };
}

// Teams worst to best by last completed season. Ties broken by team id.
export function standings(league) {
  return league.teams
    .map(t => ({ team: t, ...teamRecord(t) }))
    .sort((a, b) => a.pct - b.pct || a.team.id - b.team.id);
}

// Draw the first `drawn` picks from the lottery teams using the league's odds
// (index 0 = worst record); the rest of the lottery follows by record.
export function drawLottery(lotteryTeams, odds, drawn, rng) {
  const pool = lotteryTeams.map((t, i) => ({ t, w: odds[i] ?? 0, seed: i }));
  const order = [];
  for (let n = 0; n < Math.min(drawn, pool.length); n++) {
    const total = pool.reduce((a, x) => a + x.w, 0);
    let r = rng() * total;
    let idx = pool.findIndex(x => (r -= x.w) <= 0);
    if (idx < 0) idx = pool.length - 1;
    order.push(pool.splice(idx, 1)[0]);
  }
  pool.sort((a, b) => a.seed - b.seed);
  return [...order, ...pool].map(x => ({ team: x.t, seed: x.seed }));
}

export function lotterySetup(league) {
  const s = league.season;
  const table = standings(league);
  const n = Math.min(s.lotteryTeams || 14, table.length);
  return { table, lotteryTeams: table.slice(0, n).map(r => r.team), odds: s.lotteryOdds || [] };
}

// Monte Carlo odds: chance of each pick for each lottery team.
export function lotteryOdds(league, drawn, sims = 10000, seed = 1) {
  const { lotteryTeams, odds } = lotterySetup(league);
  const rng = mulberry32(seed);
  const counts = lotteryTeams.map(() => new Array(lotteryTeams.length).fill(0));
  for (let s = 0; s < sims; s++) {
    drawLottery(lotteryTeams, odds, drawn, rng).forEach((r, pick) => { counts[r.seed][pick]++; });
  }
  return lotteryTeams.map((t, i) => ({ team: t, seed: i, weight: odds[i] ?? 0, pct: counts[i].map(c => c / sims * 100) }));
}

// Who owns a team's pick in a given year/round (traded picks move teams).
export function pickOwner(league, year, round, originalTid) {
  for (const t of league.teams) {
    if (t.draftPicks.some(pk => pk.yr === year && pk.rd === round && pk.otid === originalTid)) return t;
  }
  return null;
}

// Full draft order. Round 1 lottery order comes from `lottery` (array of
// teams); everything else goes worst to best record.
export function draftOrder(league, lottery, rounds = 2) {
  const year = league.season.currentYear;
  const table = standings(league).map(r => r.team);
  const r1 = lottery ? [...lottery, ...table.filter(t => !lottery.includes(t))] : table;
  const order = [];
  for (let rd = 1; rd <= rounds; rd++) {
    (rd === 1 ? r1 : table).forEach(orig => {
      const owner = pickOwner(league, year, rd, orig.id);
      if (owner) order.push({ rd, orig, owner, overall: order.length + 1 });
    });
  }
  return order;
}

// Best available for a team: value plus a small bonus for positions the
// roster is thin at.
export function cpuPick(team, available) {
  const counts = {};
  for (const p of team.roster) counts[p.pos] = (counts[p.pos] || 0) + 1;
  let best = null, bestScore = -Infinity;
  for (const p of available) {
    const score = prospectValue(p) + (counts[p.pos] ? 0 : 0.6);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pick trades (written to the save)

const pickKey = pk => `${pk.yr}:${pk.rd}:${pk.otid}`;
export const samePick = (a, b) => pickKey(a) === pickKey(b);

// Move picks between two teams. `fromA` / `fromB` are pick objects currently
// owned by A / B.
export function tradePicks(teamA, teamB, fromA, fromB) {
  const move = (src, dst, picks) => {
    for (const pk of picks) {
      const i = src.draftPicks.findIndex(x => samePick(x, pk));
      if (i < 0) throw new Error('Pick not owned by team');
      const [obj] = src.draftPicks.splice(i, 1);
      obj.tid = dst.id;
      dst.draftPicks.push(obj);
    }
  };
  move(teamA, teamB, fromA);
  move(teamB, teamA, fromB);
}

// Rough pick value for trade evaluation (higher = more valuable).
export function pickValue(league, pk) {
  const year = league.season.currentYear;
  const table = standings(league).map(r => r.team.id);
  const rank = Math.max(0, table.indexOf(pk.otid));
  const base = pk.rd === 1 ? 100 - rank * 2.2 : 30 - rank * 0.6;
  return Math.max(5, base * Math.pow(0.85, Math.max(0, pk.yr - year)));
}
