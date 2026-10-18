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
  const pro = L.leagueType !== 1;
  // Pro playoff rounds by name, counted back from the Finals.
  const proRound = rd => ['the Finals', 'the Conference Finals', 'the Conference Semifinals', 'the First Round'][(rounds || 4) - rd] || `Round ${rd}`;
  const finish = pro
    ? (won ? '🏆 Champions' : round ? `Lost in ${proRound(round)}` : 'Missed the playoffs')
    : (won ? '🏆 National Champions' : round ? `Lost in ${roundName(round, rounds || 6)}` : 'Missed the tournament');
  // Team leaders (per game), including players who have since left.
  const lines = everyone(data).map(p => ({ p, l: seasonLine(p, li, yr) })).filter(x => x.l && x.l.tid === team.id && x.l.gp >= 5);
  const lead = (k, label) => { const x = [...lines].sort((a, b) => b.l[k] - a.l[k])[0]; return x ? { label, p: x.p, v: x.l[k] } : null; };
  const leaders = [lead('ppg', 'Points'), lead('rpg', 'Rebounds'), lead('apg', 'Assists'), lead('spg', 'Steals'), lead('bpg', 'Blocks')].filter(Boolean);
  // Awards this season (league `li`).
  const AW = L.awards || [];
  const won_ = [];
  for (const p of everyone(data)) for (const a of p.awards || []) {
    if (a.league === li && (a.yearsWon || []).includes(yr) && AW[a.id]?.enabled !== false && (AW[a.id]?.name || L.leagueType === 1)) won_.push({ p, id: a.id, name: AW[a.id]?.name || `Award ${a.id}`, team: AW[a.id]?.team ? a.team : null });
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
  return { pro, yr, row, stats, finish, won, round, rounds, seed: row?.seed || 0, champ, runnerUp, finalFour, leaders, mine, national, allTeams,
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

// Senior Send-off. Graduates who aren't drafted leave the save; the game
// keeps a few in the college league's retirees (status 7, yrs 4) and the
// drafted seniors live on in the pro league (history.yrs 3). Plus your
// rising seniors' last season ahead, and league records your players hold.
const careerOf = p => { const c = (p.history?.collegeStats?.season?.GP ? p.history.collegeStats.season : p.careerStats?.season) || {}; const gp = c.GP || 0; return { gp, pts: c.PTS || 0, ppg: gp ? c.PTS / gp : 0, rpg: gp ? c.REB / gp : 0, apg: gp ? c.AST / gp : 0 }; };
const lastCollegeTid = (p, li) => { const s = (p.stats || []).filter(x => x.league === li && (x.season || []).length).pop(); return s ? s.season[s.season.length - 1].tid : null; };
export function seniorSendoff(data, li, team) {
  const C = data.seasonLeagues[li];
  const schools = new Map(C.teams.map(t => [t.id, t]));
  const yr = C.season.currentYear - 1;
  const grads = [
    ...(C.retirees || []).filter(p => (p.yrs ?? 0) >= 4).map(p => ({ p, school: schools.get(lastCollegeTid(p, li)) || null, outcome: 'Graduated', pro: null })),
    ...draftDepartures(data, li).filter(x => x.cls === 'Senior').map(x => ({ p: x.p, school: x.school, outcome: x.pick ? `Drafted #${x.pick.pk}` : 'Undrafted', pro: x.pro })),
  ].map(g => ({ ...g, career: careerOf(g.p) })).sort((a, b) => b.career.pts - a.career.pts);
  const mineGrads = grads.filter(g => g.school === team);
  const rising = team.roster.filter(p => (p.yrs ?? 0) >= 3).map(p => ({ p, career: careerOf(p), awards: (p.awards || []).filter(a => a.league === li), records: p.records || 0 }))
    .sort((a, b) => b.career.pts - a.career.pts);
  const AW = C.awards || [];
  const awardNames = list => list.map(a => `${AW[a.id]?.name || 'Award'}${a.yearsWon?.length > 1 ? ` ×${a.yearsWon.length}` : ''}`);
  const STAT = { PTS: 'points', FGM: 'field goals', TPM: 'threes', FTM: 'free throws', REB: 'rebounds', AST: 'assists', STL: 'steals', BLK: 'blocks', TO: 'turnovers' };
  const ids = new Set(team.roster.map(p => p.id));
  const records = [];
  for (const [k, list] of Object.entries(C.records?.season || {})) (list || []).forEach((r, i) => { if (ids.has(r.pid) && k !== 'TO') records.push({ stat: STAT[k] || k, value: r.value, yr: r.yr, rank: i + 1, p: team.roster.find(p => p.id === r.pid) }); });
  return { yr, grads, mineGrads, rising, records, awardNames };
}

// Transfer portal. Entries are news type 34 (tid = the school he left);
// portal players wait in the college free-agent pool with high-school
// prospects (they have college stats and a class year of 1+). Eligibility
// left = 4 - class year.
const GROUP = p => (p.pos <= 2 ? 'Guards' : p.pos <= 5 ? 'Wings' : 'Bigs');
const dist = (a, b) => Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
export function rosterNeedsCollege(team, rosterMax = 15) {
  const groups = { Guards: [], Wings: [], Bigs: [] };
  for (const p of team.roster) groups[GROUP(p)].push(p);
  const want = { Guards: 4, Wings: 3, Bigs: 3 };
  const short = Object.entries(want).map(([g, n]) => ({ g, have: groups[g].length, want: n, short: Math.max(0, n - groups[g].length) }));
  return { groups, short, open: Math.max(0, rosterMax - team.roster.length) };
}
export function portalBoard(data, li, team) {
  const C = data.seasonLeagues[li];
  const schools = new Map(C.teams.map(t => [t.id, t]));
  const entries = new Map((C.season.news || []).filter(n => n.type === 34).map(n => [n.pid, n.tid]));
  const onRoster = new Map(C.teams.flatMap(t => t.roster.map(p => [p.id, t])));
  const pool = new Set((C.freeAgents || []).map(p => p.id));
  const yr = C.season.currentYear - 1;
  const needs = rosterNeedsCollege(team);
  const all = [...entries].map(([pid, from]) => {
    const p = (C.freeAgents || []).find(x => x.id === pid) || onRoster.get(pid)?.roster.find(x => x.id === pid);
    if (!p) return null;
    const near = [...C.teams].sort((a, b) => dist(a.location, p.loc) - dist(b.location, p.loc)).indexOf(team) + 1;
    return { p, from: schools.get(from) || null, now: pool.has(pid) ? null : onRoster.get(pid) || null, line: seasonLine(p, li, yr),
      left: Math.max(1, 4 - (p.yrs ?? 0)), cls: classOf(p.yrs ?? 0), group: GROUP(p), near, fit: needs.short.some(s => s.short > 0 && s.g === GROUP(p)) };
  }).filter(Boolean);
  const offers = new Map();
  for (const o of C.contractOffers || []) (offers.get(o.pid) || offers.set(o.pid, []).get(o.pid)).push(o);
  return { all, needs, offers, lost: all.filter(x => x.from === team), schools };
}

// All-American Showcase: the college league's two star teams. Phase 8:
// rosters set, not played. Phase 5: played (the league's currentGame holds
// the score: [total, 1st half, 2nd half]; news category 1 type 9 = MVP).
// Phase 6 on: rosters empty (the players joined the recruiting pool).
export function showcase(C) {
  const teams = (C.starTeams || []).filter(t => t.roster?.length);
  if (!teams.length) return null;
  const g = C.currentGame || {};
  const ids = teams.map(t => t.id);
  const played = ids.includes(g.homeTeam?.id) && ids.includes(g.roadTeam?.id) && teams.some(t => t.roster.some(p => p.gameStats?.GP));
  const side = (id, sc) => ({ t: teams.find(t => t.id === id), total: sc?.[0] ?? 0, halves: (sc || []).slice(1) });
  const score = played ? { home: side(g.homeTeam.id, g.homeScore), road: side(g.roadTeam.id, g.roadScore) } : null;
  const mvpNews = played ? (C.season.news || []).find(n => n.category === 1 && n.type === 9 && n.gid === g.gId) : null;
  const all = teams.flatMap(t => t.roster.map(p => ({ p, t })));
  const mvp = mvpNews ? all.find(x => x.p.id === mvpNews.pid) || null : null;
  const box = p => { const s = p.gameStats || {}; return { pts: s.PTS || 0, reb: s.REB || 0, ast: s.AST || 0, stl: s.STL || 0, blk: s.BLK || 0, fgm: s.FGM || 0, fga: s.FGA || 0, tpm: s.TPM || 0, tpa: s.TPA || 0, min: Math.round((s.MIN?.[0] || 0) / 60) }; };
  return { played, score, mvp, teams: teams.map(t => ({ t, roster: t.roster.map(p => ({ p, box: box(p) })).sort((a, b) => b.box.pts - a.box.pts || b.p.pot - a.p.pot) })) };
}

// Recruiting (phase 6, 3 days). Offers sit in the college league's
// contractOffers (sal = money in millions, opt 2 = home visit, 0 = phone
// call). Each night, recruits sign with one of their highest-money offers;
// among tied offers a home visit and being close to home help (in the
// saves: visits won 14 of 22 mixed ties, the closest school 29 of 60 vs
// ~22 by chance); prestige barely matters. Commitments are news type 14.
export function recruitOdds(C, p, offers) {
  if (!offers.length) return [];
  const top = Math.max(...offers.map(o => o.sal));
  const tied = offers.filter(o => o.sal === top);
  const T = new Map(C.teams.map(t => [t.id, t]));
  const byDist = [...tied].sort((a, b) => dist(T.get(a.tid)?.location, p.loc) - dist(T.get(b.tid)?.location, p.loc));
  const w = o => (o.opt === 2 ? 1.6 : 1) * (1 / (1 + 0.45 * byDist.indexOf(o)));
  const sum = tied.reduce((a, o) => a + w(o), 0);
  return offers.map(o => ({ o, team: T.get(o.tid), pct: o.sal === top ? (w(o) / sum) * 100 : 0, top: o.sal === top })).sort((a, b) => b.pct - a.pct || b.o.sal - a.o.sal);
}
export function recruitBoard(data, li, team) {
  const C = data.seasonLeagues[li];
  const transfers = new Set((C.season.news || []).filter(n => n.type === 34).map(n => n.pid));
  const offers = new Map();
  for (const o of C.contractOffers || []) (offers.get(o.pid) || offers.set(o.pid, []).get(o.pid)).push(o);
  const T = new Map(C.teams.map(t => [t.id, t]));
  const needs = rosterNeedsCollege(team, 15);
  const pool = (C.freeAgents || []).map(p => {
    const offs = offers.get(p.id) || [];
    const odds = recruitOdds(C, p, offs);
    const mine = odds.find(x => x.o.tid === team.id) || null;
    const near = [...C.teams].sort((a, b) => dist(a.location, p.loc) - dist(b.location, p.loc)).indexOf(team) + 1;
    const top = offs.length ? Math.max(...offs.map(o => o.sal)) : 0;
    return { p, transfer: transfers.has(p.id), offs, odds, mine, near, top, leader: odds[0] || null, group: GROUP(p), fit: needs.short.some(s => s.short > 0 && s.g === GROUP(p)),
      watched: !!(p.season?.watch || p.season?.scout) };
  });
  // Commitments so far this offseason.
  const where = new Map(C.teams.flatMap(t => t.roster.map(p => [p.id, { t, p }])));
  const commits = (C.season.news || []).filter(n => n.type === 14).map(n => ({ ...(where.get(n.pid) || {}), tid: n.tid })).filter(x => x.p);
  const classes = new Map();
  for (const c of commits) { const k = c.tid; const v = classes.get(k) || { team: T.get(k), n: 0, stars: 0, players: [] }; v.n++; v.stars += c.p.pot || 0; v.players.push(c.p); classes.set(k, v); }
  const ranking = [...classes.values()].sort((a, b) => b.stars - a.stars || b.n - a.n);
  return { pool, needs, commits, ranking, mineClass: classes.get(team.id) || { n: 0, stars: 0, players: [] }, rank: ranking.findIndex(x => x.team === team) + 1, day: C.season.phase === 6 ? C.season.currentDay || 1 : 0, phase: C.season.phase };
}

// Signing class grades (after recruiting). Each signee's value: potential
// above a 2★ baseline, a bump for All-Americans, and for transfers how much
// they can help now. Letter grades are by rank among schools that signed
// anyone, so a grade means "compared with this year's classes".
const LETTERS = [[0.95, 'A+'], [0.85, 'A'], [0.75, 'A-'], [0.65, 'B+'], [0.55, 'B'], [0.45, 'B-'], [0.35, 'C+'], [0.25, 'C'], [0.15, 'C-'], [0.05, 'D'], [0, 'F']];
export function signingClasses(data, li, aaIds = new Set(), levelOf = p => 50, own = null) {
  const C = data.seasonLeagues[li];
  const T = new Map(C.teams.map(t => [t.id, t]));
  // own: the app's recruiting ({ commits: [{ pid, tid }], transfers: Set }).
  const transfers = own?.transfers || new Set((C.season.news || []).filter(n => n.type === 34).map(n => n.pid));
  const where = new Map(C.teams.flatMap(t => t.roster.map(p => [p.id, { t, p }])));
  const value = p => Math.max(0, (p.pot || 0) - 4) + (aaIds.has(p.id) ? 0.75 : 0) + (transfers.has(p.id) ? Math.max(0, (levelOf(p) - 40) / 15) : 0);
  const classes = new Map();
  for (const n of own?.commits || (C.season.news || []).filter(x => x.type === 14)) {
    const w = where.get(n.pid);
    if (!w) continue;
    const c = classes.get(n.tid) || { team: T.get(n.tid), players: [], score: 0, stars: 0 };
    c.players.push({ p: w.p, transfer: transfers.has(w.p.id), aa: aaIds.has(w.p.id), v: value(w.p) });
    c.score += value(w.p); c.stars += w.p.pot || 0;
    classes.set(n.tid, c);
  }
  const list = [...classes.values()].sort((a, b) => b.score - a.score);
  list.forEach((c, i) => {
    const pct = list.length > 1 ? 1 - i / (list.length - 1) : 1;
    c.rank = i + 1;
    c.grade = LETTERS.find(([cut]) => pct >= cut)[1];
    c.players.sort((a, b) => b.v - a.v);
  });
  return { list, byTeam: classes, noClass: C.teams.filter(t => !classes.has(t.id)) };
}

// Preseason: a projected Top 25 from roster strength (top 9 by level,
// weighted toward the top) blended with last season's record, division picks, Player and Freshman of the
// Year watch lists.
const W9 = [1, 0.95, 0.9, 0.8, 0.7, 0.55, 0.45, 0.35, 0.25];
export function preseason(data, li, team, level) {
  const C = data.seasonLeagues[li];
  const lastYr = C.season.currentYear - 1;
  const strength = t => [...t.roster].map(level).sort((a, b) => b - a).slice(0, 9).reduce((a, v, i) => a + v * W9[i], 0) + (t.prestigePoints || 0) * 0.02;
  const ranked = C.teams.map(t => {
    const row = rowOf(t, lastYr);
    return { t, s: strength(t), W: row?.seasonStats?.W || 0, L: row?.seasonStats?.L || 0, lastRank: row?.rank || 0 };
  });
  // Blend roster strength with last season's record so one offseason
  // doesn't flip the whole league.
  const z = (xs, f) => { const v = xs.map(f), m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1; return x => (f(x) - m) / sd; };
  const zs = z(ranked, x => x.s), zp = z(ranked, x => (x.W + x.L ? x.W / (x.W + x.L) : 0.5));
  ranked.forEach(x => { x.score = 0.65 * zs(x) + 0.35 * zp(x); });
  ranked.sort((a, b) => b.score - a.score);
  ranked.forEach((x, i) => { x.rank = i + 1; });
  const mine = ranked.find(x => x.t === team);
  const division = ranked.filter(x => x.t.division === team.division);
  const players = C.teams.flatMap(t => t.roster.map(p => ({ p, t, line: seasonLine(p, li, lastYr) })));
  const poy = players.filter(x => (x.p.yrs ?? 0) >= 1).map(x => ({ ...x, score: level(x.p) + (x.line ? x.line.ppg * 0.6 + x.line.rpg * 0.3 + x.line.apg * 0.4 : 0) }))
    .sort((a, b) => b.score - a.score).slice(0, 10);
  const foy = players.filter(x => (x.p.yrs ?? 0) === 0).sort((a, b) => (b.p.pot - a.p.pot) || (level(b.p) - level(a.p))).slice(0, 6);
  return { top25: ranked.slice(0, 25), mine, division, poy, foy, divName: (C.divisions || [])[team.division] || 'Division' };
}

// Roster Lock (August): the final roster against the 15-man limit, position
// balance, class-year mix and the eligibility clock.
export function rosterLock(team, level, li) {
  const needs = rosterNeedsCollege(team, 15);
  const players = team.roster.map(p => ({ p, lv: level(p), cls: classOf(p.yrs ?? 0), last: (p.yrs ?? 0) >= 3, fresh: (p.yrs ?? 0) === 0, group: GROUP(p) }))
    .sort((a, b) => b.lv - a.lv);
  const mix = CLASSES.map(c => [c, players.filter(x => x.cls === c).length]);
  const warn = [];
  for (const n of needs.short) if (n.short) warn.push(`Short ${n.short} at ${n.g.toLowerCase()} (${n.have} of ${n.want})`);
  const sr = players.filter(x => x.last).length, fr = players.filter(x => x.fresh).length;
  if (sr >= 5) warn.push(`${sr} seniors: a big turnover coming next spring`);
  if (fr >= 5) warn.push(`${fr} freshmen: a young team`);
  if (!sr && players.length) warn.push('No seniors to lead the locker room');
  return { players, needs, mix, warn, size: players.length };
}

// Practice Begins (September): projected starters (two guards, two wings or
// forwards, a big when the roster allows), the rotation, position battles,
// captains (upperclassmen with the best locker-room trait) and freshmen
// pushing for minutes.
export function practicePlan(team, level, trait = () => 10) {
  const ps = team.roster.map(p => ({ p, lv: level(p), group: GROUP(p) })).sort((a, b) => b.lv - a.lv);
  const starters = [];
  const take = (g, n) => { for (const x of ps.filter(y => y.group === g && !starters.includes(y)).slice(0, n)) starters.push(x); };
  take('Guards', 2); take('Wings', 2); take('Bigs', 1);
  for (const x of ps) if (starters.length < 5 && !starters.includes(x)) starters.push(x);
  const bench = ps.filter(x => !starters.includes(x));
  const rotation = bench.slice(0, 4);
  const battles = [];
  for (const s of starters) {
    const rival = bench.find(b => b.group === s.group && s.lv - b.lv <= 2);
    if (rival && !battles.some(x => x.b === rival)) battles.push({ a: s, b: rival });
  }
  const captains = ps.filter(x => (x.p.yrs ?? 0) >= 2).sort((a, b) => trait(b.p) - trait(a.p) || (b.p.yrs - a.p.yrs) || b.lv - a.lv).slice(0, 2);
  const fifth = starters[starters.length - 1]?.lv ?? 0;
  const pushing = ps.filter(x => (x.p.yrs ?? 0) === 0 && (x.lv >= fifth - 3 || (x.p.pot || 0) >= 8) && !starters.includes(x));
  const freshStarters = starters.filter(x => (x.p.yrs ?? 0) === 0);
  return { starters, rotation, rest: bench.slice(4), battles, captains, pushing, freshStarters };
}
