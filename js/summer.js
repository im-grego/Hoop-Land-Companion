// Summer League: a quick simulated tournament for every team's young core
// (this year's rookies and second-year players), after the age adjustment.
// Strength comes from the young players' level, draft pedigree and college
// production; the result is a final (box score by quarter, overtime if it's
// tied), a Summer League MVP with his averages, and a small reward for your
// rookies if your team reaches the final (more if you win it). The Final
// Four and the semifinals come back too, for the bracket.

import { levelOf, playerName } from './savefile.js';
import { mulberry32 } from './progression.js';
import { collegeLine } from './draft.js';

const SKILLS = ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS', 'DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK'];

// Rookies and second-year players on a roster.
export function youngCore(league, team) {
  const yr = league.season.currentYear;
  return team.roster.filter(p => {
    const d = p.history?.draft;
    return d?.yr > 0 ? yr - d.yr <= 1 : p.age <= 21;
  });
}

// How good a young player looks in July: level, where he was drafted, and
// what he did in college.
function standout(p, leagues, yr) {
  const d = p.history?.draft;
  const pedigree = d?.yr > 0 ? (d.rd === 1 ? 6 - d.pk / 6 : 0.5) : 0;
  const c = collegeLine(p, leagues);
  const college = c ? Math.min(6, c.pts / 4) : 0;
  const rookie = d?.yr === yr ? 0 : 3; // a year in the league helps in July
  return levelOf(p) + pedigree + college + rookie;
}

const teamScore = (league, team, leagues) => {
  const yr = league.season.currentYear;
  const top = youngCore(league, team).map(p => standout(p, leagues, yr)).sort((a, b) => b - a).slice(0, 5);
  while (top.length < 5) top.push(45); // filled out with camp invites
  return top.reduce((a, b) => a + b, 0) / 5;
};

// Run the tournament: pool play, a Final Four, the championship.
// Deterministic for a seed (no re-rolls).
export function runSummerLeague(league, leagues, seed) {
  const rng = mulberry32(seed);
  const yr = league.season.currentYear;
  const noise = () => (rng() + rng() + rng() - 1.5) * 6;
  const field = league.teams.map(t => ({ team: t, score: teamScore(league, t, leagues) }));
  // Pool play: the four best showings make the Final Four (1 v 4, 2 v 3).
  const ranked = field.map(f => ({ ...f, run: f.score + noise() })).sort((a, b) => b.run - a.run);
  const four = ranked.slice(0, 4);
  const sum = a => a.reduce((x, y) => x + y, 0);
  // One game, quarter by quarter, overtime if it's tied.
  const game = (A, B) => {
    const edge = (A.score - B.score) / 10;
    const q = sign => Math.max(16, Math.round(23.5 + sign * edge + (rng() - 0.5) * 12));
    const quarters = [[], []];
    for (let i = 0; i < 4; i++) { quarters[0].push(q(1)); quarters[1].push(q(-1)); }
    while (sum(quarters[0]) === sum(quarters[1])) {
      quarters[0].push(Math.round(6 + rng() * 8));
      quarters[1].push(Math.round(6 + rng() * 8));
    }
    const w = sum(quarters[0]) > sum(quarters[1]) ? A : B;
    return { teams: [A.team.id, B.team.id], quarters, winner: w.team.id, w, l: w === A ? B : A };
  };
  const semis = [game(four[0], four[3]), game(four[1], four[2])];
  const fin = game(semis[0].w, semis[1].w);
  const winner = fin.w.team, loser = fin.l.team;
  const strip = g => ({ teams: g.teams, quarters: g.quarters, winner: g.winner });
  // MVP: the champion's most pro-ready young player (now and then the
  // runner-up's), with some variance.
  const pool = rng() < 0.85 ? winner : loser;
  const core = youngCore(league, pool);
  const mvp = core.map(p => ({ p, v: standout(p, leagues, yr) + noise() / 2 })).sort((a, b) => b.v - a.v)[0]?.p || null;
  const line = p => {
    const lv = levelOf(p);
    const g = p.pos <= 2 ? 'guard' : p.pos <= 5 ? 'wing' : 'big';
    const ppg = Math.max(15, Math.min(30, 17 + (lv - 55) * 0.35 + (rng() - 0.5) * 5));
    const rpg = (g === 'big' ? 8 : g === 'wing' ? 5 : 3.5) + (rng() - 0.5) * 3;
    const apg = (g === 'guard' ? 5.5 : g === 'wing' ? 2.8 : 1.6) + (rng() - 0.5) * 2;
    return { gp: 5, ppg: ppg.toFixed(1), rpg: rpg.toFixed(1), apg: apg.toFixed(1) };
  };
  return {
    seed,
    four: four.map(f => f.team.id),
    semis: semis.map(strip),
    final: strip(fin),
    mvp: mvp && { pid: mvp.id, tid: pool.id, ...line(mvp) },
  };
}

// Your reward: finalists give two young players +1 on one skill; the
// champion gives three young players +1 on two skills. Never past a
// rating's ceiling or 20. Returns [{ p, gains: { KEY: 1 } }] for undo/display.
export function summerReward(league, team, won, seed) {
  const rng = mulberry32(seed ^ 0x51ee);
  const yr = league.season.currentYear;
  const players = youngCore(league, team).filter(p => p.history?.draft?.yr === yr || p.age <= 22)
    .sort((a, b) => levelOf(b) - levelOf(a)).slice(0, won ? 3 : 2);
  const out = [];
  for (const p of players) {
    const open = SKILLS.filter(k => p.attributes[k][0] < Math.min(20, Math.max(p.attributes[k][1], p.attributes[k][0])));
    const gains = {};
    for (let i = 0; i < (won ? 2 : 1) && open.length; i++) {
      const k = open.splice(Math.floor(rng() * open.length), 1)[0];
      p.attributes[k][0]++;
      gains[k] = 1;
    }
    if (Object.keys(gains).length) out.push({ p, gains });
  }
  return out;
}

export function undoSummerReward(list) {
  for (const { p, gains } of list) for (const k of Object.keys(gains)) p.attributes[k][0]--;
}

export const mvpName = (league, mvp) => {
  const team = league.teams.find(t => t.id === mvp?.tid);
  const p = team?.roster.find(x => x.id === mvp.pid);
  return p ? playerName(p) : '—';
};
