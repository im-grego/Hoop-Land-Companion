// Preseason GM Survey: every team's GM answers the same questions, the way
// the NBA's annual survey works. Each GM ranks the candidates from what's
// in the save, with their own lean, and can't vote for their own team or
// players. Results are vote shares; last year's winner is kept per save.

import { playerName, POSITIONS, levelOf, injuryHistory, leagueRookies } from './savefile.js';
import { teamRecord, teamStatus } from './draft.js';
import { mulberry32 } from './progression.js';
import { teamSituation } from './presser.js';

const A = (p, k) => p.attributes?.[k]?.[0] ?? 0;
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const skillLv = (p, id) => (p.skills || []).find(s => s.id === id && s.level >= 1)?.level || 0;

// Per-game production for one season in a league (all stints).
function perGame(p, li, yr) {
  const s = (p.stats || []).find(x => x.league === li && x.yr === yr);
  const t = { GP: 0, MIN: 0, PTS: 0, REB: 0, AST: 0, STL: 0, BLK: 0, TO: 0, FGM: 0, FGA: 0, TPM: 0, TPA: 0, FTM: 0, FTA: 0 };
  let tid = null;
  for (const r of s?.season || []) { for (const k of Object.keys(t)) t[k] += k === 'MIN' ? (r.MIN?.[0] || 0) / 60 : (r[k] || 0); tid = r.tid; }
  if (!t.GP) return null;
  const g = k => t[k] / t.GP;
  return {
    gp: t.GP, tid, mpg: g('MIN'), ppg: g('PTS'), rpg: g('REB'), apg: g('AST'), spg: g('STL'), bpg: g('BLK'), tov: g('TO'),
    fga: g('FGA'), fta: g('FTA'), tpa: g('TPA'),
    fg: t.FGA ? t.FGM / t.FGA : 0, tp: t.TPA ? t.TPM / t.TPA : 0, ft: t.FTA ? t.FTM / t.FTA : 0,
    ts: t.FGA + t.FTA ? t.PTS / (2 * (t.FGA + 0.44 * t.FTA)) : 0,
  };
}

// Where a player is from. The field name isn't fixed, so find it: a key
// like country / nationality (string or code). "Home" is the most common
// value in the league (the US in an NBA save, whether stored as text or a
// code), plus anything spelled like the US; everything else is
// international.
const COUNTRY_RE = /country|nation|^cty$|^ctry$|birthplace|^born$/i;
function countryKey(players) {
  const sample = players.slice(0, 60);
  const keys = new Map();
  for (const p of sample) {
    for (const [obj, pre] of [[p, ''], [p.bio, 'bio.'], [p.born, 'born.'], [p.appearance, 'appearance.']]) {
      if (!obj || typeof obj !== 'object') continue;
      for (const [k, v] of Object.entries(obj)) {
        if (!COUNTRY_RE.test(k) || (typeof v !== 'string' && typeof v !== 'number')) continue;
        const key = pre + k;
        if (!keys.has(key)) keys.set(key, new Set());
        keys.get(key).add(v);
      }
    }
  }
  // The key whose values vary (a real country field, not a constant).
  return [...keys].sort((a, b) => b[1].size - a[1].size).find(([, vals]) => vals.size > 1)?.[0] || null;
}
const getPath = (p, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), p);
const isUSA = c => /^(usa|us|u\.s\.a?\.?|united states( of america)?|america)$/i.test(String(c ?? '').trim());
export function countryInfo(players) {
  const key = countryKey(players);
  if (!key) return null;
  const counts = new Map();
  for (const p of players) { const v = getPath(p, key); if (v != null && v !== '') counts.set(v, (counts.get(v) || 0) + 1); }
  const home = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { key, home, of: p => getPath(p, key), intl: p => { const v = getPath(p, key); return v != null && v !== '' && v !== home && !isUSA(v); } };
}
export const countryOf = p => null; // kept for older callers

// A team's head coach: the first coach listed on the team (an array such as
// `coaches`, or a single coach object). Name from fn/ln or name fields;
// potential from pot/potential when present.
function coachOf(t) {
  for (const [k, v] of Object.entries(t)) {
    if (!/coach/i.test(k) || !v || typeof v !== 'object') continue;
    const c = Array.isArray(v) ? v.find(x => x && typeof x === 'object') : v;
    if (!c) continue;
    const fn = c.fn ?? c.firstName ?? c.first, ln = c.ln ?? c.lastName ?? c.last;
    const name = fn || ln ? `${fn || ''} ${ln || ''}`.trim() : (typeof c.name === 'string' ? c.name : null);
    const num = x => (x == null ? null : Number(x.valueOf ? x.valueOf() : x));
    const pot = [c.pot, c.potential, c.rating, c.ovr].map(num).find(x => Number.isFinite(x));
    return { name, pot: pot ?? null, raw: c };
  }
  return null;
}

// Team strength: the top 9 by level, weighted toward the top.
const W = [1, 0.95, 0.9, 0.8, 0.7, 0.55, 0.45, 0.35, 0.25];
const strengthOf = players => [...players].map(levelOf).sort((a, b) => b - a).slice(0, 9).reduce((a, v, i) => a + v * W[i], 0);
const injuredNow = p => (p.season?.injury?.gamesOut || 0) > 20;

// Each GM's ballot: score + their own lean, never their own team.
function ballots(teams, cands, salt, qid, { noise = 0.38, own = c => c.tid } = {}) {
  if (!cands.length) return [];
  const ms = mean(cands.map(c => c.score)), sd = Math.sqrt(mean(cands.map(c => (c.score - ms) ** 2))) || 1;
  const z = cands.map(c => ({ ...c, z: (c.score - ms) / sd })).sort((a, b) => b.z - a.z).slice(0, 14);
  const votes = new Map();
  for (const gm of teams) {
    const rng = mulberry32((salt ^ Math.imul(gm.id + 7, 2654435761) ^ Math.imul(qid + 1, 40503)) >>> 0);
    const g = () => { const u = Math.max(1e-9, rng()), w = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
    let best = null, bs = -Infinity;
    for (const c of z) {
      if (own(c) === gm.id) continue;
      const s = c.z + g() * noise;
      if (s > bs) { bs = s; best = c; }
    }
    if (best) votes.set(best.key, (votes.get(best.key) || { c: best, n: 0 })).get(best.key).n++;
  }
  const total = [...votes.values()].reduce((a, v) => a + v.n, 0) || 1;
  return [...votes.values()].sort((a, b) => b.n - a.n).map(v => ({ ...v.c, votes: v.n, pct: Math.round(v.n / total * 1000) / 10 }));
}

const confOf = (L, t) => ((L.conferences?.length || 0) >= 2 ? (t.division < 3 ? 0 : 1) : 0);
const ALTITUDE = /denver|utah|salt lake/i;

export function runSurvey(L, li = 0, salt = 1) {
  const cur = L.season.currentYear;
  const yr = Math.max(...L.teams.map(t => teamRecord(t).yr || 0));
  const teams = L.teams;
  const rookieIds = new Set(leagueRookies(L).map(r => r.p.id));
  const all = teams.flatMap(t => t.roster.map(p => ({ p, t })));
  const vets = all.filter(({ p }) => !rookieIds.has(p.id));
  const line = new Map(all.map(({ p }) => [p.id, perGame(p, li, yr)]));
  const L_ = p => line.get(p.id);
  const gs = p => { const l = L_(p); return l ? l.ppg + 0.7 * l.rpg + 0.7 * l.apg + l.spg + 0.7 * l.bpg - 0.7 * l.tov : 0; };
  const pct = t => teamRecord(t).pct || 0;
  const sit = new Map(teams.map(t => [t.id, teamSituation(L, t, li)]));

  // Strength now (healthy) vs last season (who actually played, and how much).
  const healthy = t => t.roster.filter(p => !injuredNow(p));
  const now = new Map(teams.map(t => [t.id, strengthOf(healthy(t))]));
  const lastStr = new Map(teams.map(t => {
    const played = vets.filter(({ p }) => L_(p)?.tid === t.id);
    const eff = played.map(({ p }) => levelOf(p) * Math.min(1, (L_(p).gp / 82) * 1.15));
    return [t.id, eff.sort((a, b) => b - a).slice(0, 9).reduce((a, v, i) => a + v * W[i], 0)];
  }));

  const P = (p, t, score, extra = {}) => ({ key: `p${p.id}`, kind: 'player', pid: p.id, name: playerName(p), tid: t.id, team: t.shortName, score, ...extra });
  const T = (t, score) => ({ key: `t${t.id}`, kind: 'team', tid: t.id, name: `${t.city} ${t.name}`.trim(), team: t.shortName, score });
  let q = 0;
  const ask = (id, section, title, cands, opts) => ({ id, section, title, results: ballots(teams, cands, salt, ++q, opts) });

  const out = [];
  // ---- Predictions
  const champMap = new Map(teams.map(t => [t.id, now.get(t.id) * 0.06 + pct(t) * 2 + (teamStatus(L, t) === 'contending' ? 0.6 : 0)]));
  const champScore = t => champMap.get(t.id);
  out.push(ask('finals', 'Predictions', `Who will win the ${cur + 1 > yr + 1 ? cur : yr + 1} Finals?`, teams.map(t => T(t, champScore(t))), { noise: 0.45 }));
  // Seeds: each GM ranks each conference; shown per seed.
  const nConf = (L.conferences?.length || 0) >= 2 ? 2 : 1;
  const seeds = [];
  for (let c = 0; c < nConf; c++) {
    const ct = teams.filter(t => confOf(L, t) === c);
    const tally = [0, 1, 2, 3].map(() => new Map());
    for (const gm of teams) {
      const rng = mulberry32((salt ^ Math.imul(gm.id + 3, 2246822519) ^ (c + 1) * 977) >>> 0);
      const g = () => { const u = Math.max(1e-9, rng()), w = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
      const order = ct.map(t => ({ t, s: champScore(t) + g() * 0.45 })).sort((a, b) => b.s - a.s).slice(0, 4);
      order.forEach(({ t }, i) => tally[i].set(t.id, (tally[i].get(t.id) || 0) + 1));
    }
    seeds.push({ conf: L.conferences?.[c] || 'League', seeds: tally.map(m => [...m].sort((a, b) => b[1] - a[1]).map(([tid, n]) => {
      const t = teams.find(x => x.id === tid);
      return { key: `t${tid}`, kind: 'team', tid, name: `${t.city} ${t.name}`.trim(), team: t.shortName, votes: n, pct: Math.round(n / teams.length * 1000) / 10 };
    })) });
  }

  // ---- Players
  const ppl = (f, filter = () => true) => vets.filter(({ p }) => L_(p)?.gp >= 20 && filter(p)).map(({ p, t }) => P(p, t, f(p, t)));
  out.push(ask('mvp', 'Players', 'Who will win MVP?', ppl((p, t) => gs(p) + pct(t) * 12 + levelOf(p) * 0.15)));
  out.push(ask('franchise', 'Players', 'If you were starting a franchise today and could sign any player, who would you pick?',
    ppl(p => levelOf(p) + (p.pot || 6) * 1.5 + Math.max(-8, (27 - p.age) * 1.6))));
  out.push(ask('adjust', 'Players', 'Which player forces opposing coaches to make the most adjustments?',
    ppl(p => { const l = L_(p); return l.ppg * 1.2 + (l.fga + 0.44 * l.fta) * 0.5 + l.apg * 0.5 + (skillLv(p, 'HOT') + skillLv(p, 'VOL') + skillLv(p, 'UNF') + skillLv(p, 'LIM')) * 1.5; })));
  // Breakout: young, room to grow, and a bigger role (new team or the
  // player ahead of him gone).
  const room = p => ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS', 'DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK'].reduce((a, k) => a + Math.max(0, (p.attributes[k][1] || 0) - A(p, k)), 0);
  const roleRank = (p, t) => 1 + [...t.roster].filter(x => levelOf(x) > levelOf(p)).length;
  out.push(ask('breakout', 'Players', 'Which player is most likely to break out this season?',
    vets.filter(({ p }) => p.age <= 25 && L_(p) && gs(p) < 18).map(({ p, t }) => {
      const l = L_(p);
      const newTeam = l.tid !== t.id;
      const roleUp = roleRank(p, t) <= 5 && l.mpg < 26 ? (26 - l.mpg) * 0.25 : 0;
      return P(p, t, room(p) * 0.12 + (p.pot || 6) * 0.8 + roleUp + (newTeam ? 1.5 : 0) + levelOf(p) * 0.08);
    })));
  const POS_SETS = [['PG', [0, 1]], ['SG', [1, 2, 3]], ['SF', [3, 4, 5]], ['PF', [5, 6, 7]], ['C', [7, 8]]];
  const MAIN = { PG: 0, SG: 2, SF: 4, PF: 6, C: 8 };
  for (const [name, set] of POS_SETS) {
    out.push(ask(`pos${name}`, 'Players', `Who is the best ${name} in the league?`,
      ppl(p => levelOf(p) + gs(p) * 0.4 + (p.pos === MAIN[name] ? 2 : 0), p => set.includes(p.pos))));
  }

  // ---- Offseason
  const arrivals = t => sit.get(t.id).arrivals;
  const departures = t => sit.get(t.id).departures;
  out.push(ask('moves', 'Offseason', 'Who made the best overall moves this offseason?',
    teams.map(t => T(t, arrivals(t).reduce((a, p) => a + levelOf(p), 0) * 0.08 - departures(t).reduce((a, p) => a + levelOf(p), 0) * 0.05 + arrivals(t).length * 0.3))));
  const arr = teams.flatMap(t => arrivals(t).map(p => ({ p, t })));
  out.push(ask('impact', 'Offseason', 'Which player acquisition will have the biggest impact?', arr.map(({ p, t }) => P(p, t, levelOf(p) + gs(p) * 0.5))));
  const impactTop = new Set(out[out.length - 1].results.slice(0, 2).map(r => r.pid));
  out.push(ask('underrated', 'Offseason', 'What was the most underrated player acquisition?',
    arr.filter(({ p }) => !impactTop.has(p.id)).map(({ p, t }) => P(p, t, levelOf(p) * 0.6 + gs(p) * 0.3 - (p.contract?.sal || 0) * 0.5))));
  out.push(ask('improved', 'Offseason', `Which team will be most improved in ${cur + 1 > yr + 1 ? cur : yr + 1}?`,
    teams.map(t => T(t, now.get(t.id) - lastStr.get(t.id)))));

  // ---- Rookies
  const rk = leagueRookies(L).filter(r => r.team);
  const R = (r, score) => P(r.p, r.team, score, { pick: r.pick });
  out.push(ask('roty', 'Rookies', 'Who will win Rookie of the Year?', rk.map(r => R(r, levelOf(r.p) + (6 - Math.min(6, roleRank(r.p, r.team) / 2)) * 1.5))));
  out.push(ask('rookie5', 'Rookies', 'Which rookie will be the best player in five years?', rk.map(r => R(r, (r.p.pot || 6) * 4 + room(r.p) * 0.15 + levelOf(r.p) * 0.3 - Math.max(0, r.p.age - 20) * 1.5))));
  const valueRank = new Map([...rk].sort((a, b) => ((b.p.pot || 6) * 4 + levelOf(b.p)) - ((a.p.pot || 6) * 4 + levelOf(a.p))).map((r, i) => [r.p.id, i + 1]));
  out.push(ask('steal', 'Rookies', 'Which rookie was the biggest steal in the draft?', rk.filter(r => r.pick > 5).map(r => R(r, r.pick - valueRank.get(r.p.id)))));

  // ---- International: any country other than the league's home country.
  const ci = countryInfo([...all.map(x => x.p), ...(L.freeAgents || [])]);
  const intl = ci ? vets.filter(({ p }) => ci.intl(p)) : [];
  const ctry = p => { const v = ci?.of(p); return typeof v === 'string' ? v : undefined; };
  if (intl.length) {
    out.push(ask('intl', 'International', 'Who is the best international player in the league?', intl.filter(({ p }) => L_(p)).map(({ p, t }) => P(p, t, levelOf(p) + gs(p) * 0.4, { country: ctry(p) }))));
    const fa = (L.freeAgents || []).filter(p => ci.intl(p));
    if (fa.length) out.push(ask('intlFA', 'International', 'Who is the best international player not in the league?',
      fa.map(p => ({ key: `p${p.id}`, kind: 'player', pid: p.id, name: playerName(p), tid: -1, team: 'FA', score: levelOf(p) + (p.pot || 6), country: ctry(p) }))));
  }

  // ---- Coaches: last season's record against the roster's talent, this
  // year's projection, and the coach's own potential when the save has it.
  {
    const lastRank = new Map([...teams].sort((a, b) => lastStr.get(b.id) - lastStr.get(a.id)).map((t, i) => [t.id, i]));
    const winOrder = [...teams].sort((a, b) => pct(b) - pct(a));
    const expectPct = t => pct(winOrder[lastRank.get(t.id)] || t);          // the record a team that talented "should" have had
    const over = t => Math.max(-1.5, Math.min(1.5, (pct(t) - expectPct(t)) * 8));   // overachieving (capped so one fluke season can't own the vote)
    const projZ = t => { const v = [...now.values()]; const m = mean(v), sd = Math.sqrt(mean(v.map(x => (x - m) ** 2))) || 1; return (now.get(t.id) - m) / sd; };
    const playoff = t => (t.season || []).find(x => x.yr === yr)?.round || 0;
    const teamLine = t => {
      const ps = vets.filter(({ p }) => L_(p)?.tid === t.id).map(({ p }) => L_(p));
      const sum = k => ps.reduce((a, l) => a + l[k] * l.gp, 0) / 82;
      return { ppg: sum('ppg'), stocks: sum('spg') + sum('bpg') };
    };
    const tl = new Map(teams.map(t => [t.id, teamLine(t)]));
    const offTalent = t => mean([...t.roster].sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 8).map(p => (A(p, 'LAY') + A(p, 'MID') + A(p, 'TPT') + A(p, 'PAS')) / 4));
    const defTalent = t => mean([...t.roster].sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 8).map(p => (A(p, 'STL') + A(p, 'BLK') + A(p, 'DRE') + A(p, 'SPD')) / 4));
    const zMap = f => { const v = teams.map(f); const m = mean(v), sd = Math.sqrt(mean(v.map(x => (x - m) ** 2))) || 1; return new Map(teams.map((t, i) => [t.id, (v[i] - m) / sd])); };
    const offZ = zMap(t => tl.get(t.id).ppg), offTz = zMap(offTalent), defZs = zMap(t => tl.get(t.id).stocks), defTz = zMap(defTalent);
    const coaches = new Map(teams.map(t => [t.id, coachOf(t)]));
    const pots = [...coaches.values()].map(c => c?.pot).filter(x => x != null);
    const pm = mean(pots), psd = Math.sqrt(mean(pots.map(x => (x - pm) ** 2))) || 1;
    const potZ = t => { const c = coaches.get(t.id); return c?.pot != null ? (c.pot - pm) / psd : 0; };
    const C = (t, score) => { const c = coaches.get(t.id); return { ...T(t, score + potZ(t) * 0.6), name: c?.name || `${t.city} ${t.name} head coach`.trim(), coachTeam: c?.name ? `${t.city} ${t.name}`.trim() : null }; };
    out.push(ask('coachBest', 'Coaches', 'Who is the best coach in the league?', teams.map(t => C(t, over(t) * 0.6 + pct(t) * 4 + projZ(t) * 0.6 + playoff(t) * 0.4))));
    out.push(ask('coachMotivate', 'Coaches', 'Who is the best motivator of people?', teams.map(t => C(t, over(t) * 1.1 + (now.get(t.id) - lastStr.get(t.id)) * 0.02 + pct(t)))));
    out.push(ask('coachAdjust', 'Coaches', 'Who makes the best in-game adjustments?', teams.map(t => C(t, playoff(t) * 1.2 + over(t) * 0.6 + pct(t) * 2))));
    out.push(ask('coachOff', 'Coaches', 'Which coach runs the best offense?', teams.map(t => C(t, offZ.get(t.id) * 1.2 + (offZ.get(t.id) - offTz.get(t.id)) * 0.8 + pct(t)))));
    out.push(ask('coachDef', 'Coaches', 'Which coach has the best defensive scheme?', teams.map(t => C(t, defZs.get(t.id) * 1.2 + (defZs.get(t.id) - defTz.get(t.id)) * 0.8 + pct(t)))));
  }

  // ---- Defense
  const defZ = p => 0.3 * A(p, 'STL') + 0.3 * A(p, 'BLK') + 0.25 * A(p, 'DRE') + 0.15 * A(p, 'SPD') +
    ((L_(p)?.spg || 0) + (L_(p)?.bpg || 0)) * 1.2 + (skillLv(p, 'LOC') + skillLv(p, 'CLA') + skillLv(p, 'TWO') + skillLv(p, 'BAL') + skillLv(p, 'SNA')) * 0.8;
  out.push(ask('dpoy', 'Defense', 'Who is the best defensive player in the league?', ppl(p => defZ(p) + (L_(p).mpg / 10))));
  out.push(ask('perimeter', 'Defense', 'Who is the best perimeter defender in the league?',
    ppl(p => A(p, 'STL') * 0.5 + A(p, 'SPD') * 0.3 + (L_(p).spg) * 2 + (skillLv(p, 'LOC') + skillLv(p, 'BAL') + skillLv(p, 'CLA')) * 1.0, p => p.pos <= 5)));
  out.push(ask('interior', 'Defense', 'Who is the best interior defender in the league?',
    ppl(p => A(p, 'BLK') * 0.5 + A(p, 'DRE') * 0.3 + A(p, 'STR') * 0.2 + (L_(p).bpg) * 2 + (skillLv(p, 'SNA') + skillLv(p, 'MAG')) * 1.0, p => p.pos >= 5)));
  out.push(ask('versatileD', 'Defense', 'Who is the most versatile defender in the league?',
    ppl(p => Math.min(A(p, 'STL'), A(p, 'BLK') + 2, A(p, 'DRE'), A(p, 'SPD'), A(p, 'STR')) * 1.5 + mean(['STL', 'BLK', 'DRE', 'SPD', 'STR'].map(k => A(p, k))) * 0.4)));
  out.push(ask('defTeam', 'Defense', 'Which team has the best defense?',
    teams.map(t => T(t, mean([...t.roster].sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 8).map(defZ))))));

  // ---- Miscellaneous: teams
  out.push(ask('fun', 'Miscellaneous', 'Which team is the most fun to watch?',
    teams.map(t => { const top = [...t.roster].sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 8);
      return T(t, top.filter(p => A(p, 'DNK') >= 16).length * 1.2 + top.filter(p => A(p, 'TPT') >= 16).length + top.filter(p => p.age <= 24 && levelOf(p) >= 75).length * 1.5 + mean(top.map(p => L_(p)?.ppg || 0)) * 0.2); })));
  out.push(ask('home', 'Miscellaneous', 'Which team has the best home-court advantage?',
    teams.map(t => T(t, pct(t) * 6 + (ALTITUDE.test(`${t.city} ${t.name}`) ? 2.5 : 0)))));
  const winRank = new Map([...teams].sort((a, b) => pct(b) - pct(a)).map((t, i) => [t.id, i]));
  const strRank = new Map([...teams].sort((a, b) => now.get(b.id) - now.get(a.id)).map((t, i) => [t.id, i]));
  out.push(ask('unpredictable', 'Miscellaneous', 'Which team\'s level of success is the toughest to predict?',
    teams.map(t => T(t, Math.abs(winRank.get(t.id) - strRank.get(t.id)) * 0.4 + arrivals(t).length * 0.8 +
      t.roster.filter(p => { const h = injuryHistory(p, yr); return h && h.games >= 20; }).length * 1.2 + t.roster.filter(p => p.age >= 33 && levelOf(p) >= 75).length))));
  out.push(ask('youngCore', 'Miscellaneous', 'Which team has the most promising young core?',
    teams.map(t => T(t, t.roster.filter(p => p.age <= 23).map(p => levelOf(p) * 0.6 + (p.pot || 6) * 4).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0)))));
  // ---- Miscellaneous: players
  out.push(ask('athletic', 'Miscellaneous', 'Which player is the most athletic?', ppl(p => A(p, 'DNK') * 0.4 + A(p, 'SPD') * 0.35 + A(p, 'STR') * 0.25 + skillLv(p, 'DUN'))));
  out.push(ask('shooter', 'Miscellaneous', 'Who is the best pure shooter?',
    ppl(p => { const l = L_(p); return A(p, 'TPT') * 0.5 + A(p, 'MID') * 0.2 + A(p, 'FTS') * 0.3 + (l.tpa >= 3 ? (l.tp - 0.35) * 40 : 0) + skillLv(p, 'LIM'); })));
  out.push(ask('fastest', 'Miscellaneous', 'Which player is the fastest with the ball?', ppl(p => A(p, 'SPD') * 0.6 + A(p, 'DRB') * 0.4 + skillLv(p, 'STE'))));
  out.push(ask('offBall', 'Miscellaneous', 'Who is the best at moving without the ball?',
    ppl(p => { const l = L_(p); return skillLv(p, 'SPO') * 2.5 + (l.tpa >= 2 ? (l.tp - 0.34) * 30 + l.tpa * 0.4 : 0) + A(p, 'LAY') * 0.15 + A(p, 'ORE') * 0.1 + (l.fg - 0.45) * 15 - Math.max(0, A(p, 'DRB') - 14) * 0.2; })));
  out.push(ask('passer', 'Miscellaneous', 'Who is the best passer?', ppl(p => A(p, 'PAS') * 0.6 + L_(p).apg * 1.1 + skillLv(p, 'DIM') + skillLv(p, 'HOT'))));
  out.push(ask('leader', 'Miscellaneous', 'Who is the best leader?',
    ppl((p, t) => (p.age >= 27 ? 3 : 0) + Math.min(p.yrs || 0, 12) * 0.3 + levelOf(p) * 0.08 + pct(t) * 6 + (roleRank(p, t) <= 3 ? 2 : 0))));
  out.push(ask('versatile', 'Miscellaneous', 'Who is the most versatile player in the league?',
    ppl(p => { const g = [mean(['LAY', 'MID', 'TPT'].map(k => A(p, k))), mean(['DRB', 'PAS'].map(k => A(p, k))), mean(['ORE', 'DRE'].map(k => A(p, k))), mean(['STL', 'BLK'].map(k => A(p, k)))];
      const m = mean(g); return m - Math.sqrt(mean(g.map(x => (x - m) ** 2))) * 1.2; })));
  out.push(ask('iq', 'Miscellaneous', 'Who has the best basketball IQ?',
    ppl(p => { const l = L_(p); const use = l.fga + 0.44 * l.fta + l.apg; return (l.apg + 1) / (l.tov + 1) * 1.5 + (l.ts - 0.52) * 25 + A(p, 'PAS') * 0.15 + Math.min(p.yrs || 0, 10) * 0.15 + use * 0.08; })));
  out.push(ask('lastShot', 'Miscellaneous', 'Which player would you want taking the last shot?',
    ppl(p => skillLv(p, 'CLU') * 3 + L_(p).ppg * 0.3 + A(p, 'MID') * 0.2 + A(p, 'FTS') * 0.15 + skillLv(p, 'UNF') * 1.5)));
  out.push(ask('coach', 'Miscellaneous', 'Which active player will make the best head coach one day?',
    ppl(p => { const l = L_(p); return (p.age >= 29 ? 2 : -3) + Math.min(p.yrs || 0, 14) * 0.25 + A(p, 'PAS') * 0.2 + (l.apg + 1) / (l.tov + 1) - Math.max(0, levelOf(p) - 85) * 0.1; })));

  // Top vote-getters across the player questions.
  const tally = new Map();
  let playerBallots = 0;
  for (const x of out.filter(x => x.results[0]?.kind === 'player')) {
    for (const r of x.results) { tally.set(r.key, { ...r, votes: (tally.get(r.key)?.votes || 0) + r.votes }); playerBallots += r.votes; }
  }
  const topVoted = [...tally.values()].sort((a, b) => b.votes - a.votes).slice(0, 5)
    .map(r => ({ ...r, pct: Math.round(r.votes / (playerBallots || 1) * 1000) / 10 }));
  return { year: cur, questions: out, seeds, topVoted, gms: teams.length, hasIntl: intl.length > 0, countryKey: ci?.key || null };
}

// How lopsided a result is, in words.
export function consensus(results) {
  const top = results[0]?.pct || 0;
  return top >= 60 ? 'Runaway favorite' : top >= 40 ? 'Clear favorite' : top >= 25 ? 'Split vote' : 'Wide open';
}
