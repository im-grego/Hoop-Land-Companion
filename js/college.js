// College franchise mode: recognizing it and the college offseason steps.
// The save has a pro league and a college league (leagueType 1); you run a
// college team when the college league's season.teamId is yours (the pro
// league's is 0). Game phases seen so far: 15 end of season (draft
// departures, transfer portal entries), 8 offseason start, 5 All-American
// Showcase, 6 recruiting (3 days), 9 the new season.

import { playerName } from './savefile.js';
import { seasonLine } from './storylines.js';

export function detectMode(data) {
  const leagues = data.seasonLeagues || [];
  const ci = leagues.findIndex(L => L.leagueType === 1 && L.season?.teamId > 0 && L.teams.some(t => t.id === L.season.teamId));
  const pi = leagues.findIndex(L => L.leagueType !== 1 && L.season?.teamId > 0);
  if (ci >= 0 && pi < 0) return { kind: 'college', li: ci, pro: leagues.findIndex(L => L.leagueType !== 1) };
  return { kind: 'pro', li: 0 };
}

// Tournament round names by how many teams are left (64-team field: Round
// of 64 … Championship).
export function roundName(round, rounds) {
  const left = 2 ** (rounds - round + 1);
  return left === 2 ? 'the Championship' : left === 4 ? 'the Final Four' : left === 8 ? 'the Elite Eight' : left === 16 ? 'the Sweet 16' : `the Round of ${left}`;
}

const rowOf = (team, yr) => (team.season || []).find(s => s.yr === yr);
const lastDone = L => Math.max(...L.teams.map(t => Math.max(0, ...(t.season || []).filter(s => s.seasonStats?.GP > 0).map(s => s.yr))));

// Everyone who could have played in this league last season (still on a
// college roster, in the college pool, or gone to the pros). Player ids are
// per league, so the same id in two leagues is two different players.
function everyone(data) {
  const out = [];
  for (const L of data.seasonLeagues) {
    for (const t of L.teams) for (const p of t.roster) out.push(p);
    for (const p of L.freeAgents || []) out.push(p);
  }
  return out;
}

export function seasonReview(data, li, team) {
  const L = data.seasonLeagues[li];
  const yr = lastDone(L);
  const row = rowOf(team, yr);
  const st = row?.seasonStats || {};
  const gp = st.GP || 0;
  const pct = (a, b) => (b ? (a / b) * 100 : 0);
  const stats = gp ? {
    ppg: st.PTS / gp, opp: st.OPP / gp, fg: pct(st.FGM, st.FGA), tp: pct(st.TPM, st.TPA), ft: pct(st.FTM, st.FTA),
    rpg: st.REB / gp, apg: st.AST / gp, home: st.HOME, away: st.AWAY, conf: st.CONF, top25: st.TOP25, div: st.DIV,
    l10: (st.L10 || []).filter(x => x === 1).length, streak: st.STRK,
  } : null;
  // Tournament.
  const bracket = (L.season.playoffs || []).find(p => p.yr === yr && p.rounds?.length);
  const rounds = bracket?.rounds.length || 0;
  const T = new Map(L.teams.map(t => [t.id, t]));
  let champ = null, runnerUp = null, finalFour = [];
  if (bracket) {
    const fin = bracket.rounds[rounds - 1].series[0];
    champ = T.get(fin.winner) || null;
    runnerUp = T.get(fin.winner === fin.topSeed ? fin.lowerSeed : fin.topSeed) || null;
    finalFour = (bracket.rounds[rounds - 2]?.series || []).flatMap(s => [s.topSeed, s.lowerSeed]).map(id => T.get(id)).filter(Boolean);
  }
  const round = row?.round || 0;
  const won = champ === team;
  const finish = won ? '🏆 National Champions' : round ? `Lost in ${roundName(round, rounds || 6)}` : 'Missed the tournament';
  // Team leaders (per game), including players who have since left.
  const lines = everyone(data).map(p => ({ p, l: seasonLine(p, li, yr) })).filter(x => x.l && x.l.tid === team.id && x.l.gp >= 5);
  const lead = (k, label) => { const x = [...lines].sort((a, b) => b.l[k] - a.l[k])[0]; return x ? { label, p: x.p, v: x.l[k] } : null; };
  const leaders = [lead('ppg', 'Points'), lead('rpg', 'Rebounds'), lead('apg', 'Assists')].filter(Boolean);
  // Awards this season (league `li`).
  const AW = L.awards || [];
  const won_ = [];
  for (const p of everyone(data)) for (const a of p.awards || []) {
    if (a.league === li && (a.yearsWon || []).includes(yr) && AW[a.id]?.enabled !== false) won_.push({ p, id: a.id, name: AW[a.id]?.name || `Award ${a.id}`, team: AW[a.id]?.team ? a.team : null });
  }
  const mineIds = new Set(lines.map(x => x.p));
  const mine = won_.filter(w => mineIds.has(w.p));
  const national = won_.filter(w => !AW[w.id]?.team && w.id !== 0);
  const allTeams = won_.filter(w => AW[w.id]?.team && w.team === 0);
  // Division standings.
  const divs = L.divisions || [];
  const standings = L.teams.filter(t => t.division === team.division).map(t => {
    const r = rowOf(t, yr)?.seasonStats || {};
    return { t, W: r.W || 0, L: r.L || 0, cW: r.CONF?.[0] || 0, cL: r.CONF?.[1] || 0 };
  }).sort((a, b) => b.W / Math.max(1, b.W + b.L) - a.W / Math.max(1, a.W + a.L) || b.cW - a.cW);
  return { yr, row, stats, finish, won, round, rounds, seed: row?.seed || 0, champ, runnerUp, finalFour, leaders, mine, national, allTeams,
    division: divs[team.division] || '', standings, place: standings.findIndex(x => x.t === team) + 1 };
}

const C_PHASES = { 15: 'Season Complete', 8: 'Offseason', 5: 'All-American Showcase', 6: 'Recruiting', 9: 'New Season' };
export const collegePhaseName = s => (s.phase === 6 ? `Recruiting · Day ${s.currentDay || 1}` : C_PHASES[s.phase] || `Phase ${s.phase}`);

// Class year from the save's `yrs` (college: 0 freshman … 3 senior; a
// player who left keeps it in history.yrs).
export const CLASSES = ['Freshman', 'Sophomore', 'Junior', 'Senior'];
export const classOf = y => CLASSES[Math.max(0, Math.min(3, y))];

// Draft departures: players who left this college league for the pros. A
// drafted player keeps his college past in history: coll = the college
// league's index, id = his college id, tid = his school, yearDeclared.
export function draftDepartures(data, li) {
  const C = data.seasonLeagues[li];
  const yr = C.season.currentYear;
  const schools = new Map(C.teams.map(t => [t.id, t]));
  const out = [];
  data.seasonLeagues.forEach((L, pi) => {
    if (pi === li) return;
    const add = (p, team) => {
      const h = p.history || {};
      if (h.coll !== li || h.yearDeclared !== yr) return;
      const seasons = (p.stats || []).filter(x => x.league === li && (x.season || []).some(r => r.GP > 0)).length;
      const line = seasonLine(p, li, yr - 1);
      out.push({ p, pro: team, school: schools.get(h.tid) || null, pick: h.draft?.rd ? { rd: h.draft.rd, pk: h.draft.pk } : null,
        cls: classOf(h.yrs ?? 0), seasons, line, li: pi });
    };
    for (const t of L.teams) for (const p of t.roster) add(p, t);
    for (const p of L.freeAgents || []) add(p, null);
  });
  return out.sort((a, b) => (a.pick ? a.pick.pk : 999) - (b.pick ? b.pick.pk : 999));
}
