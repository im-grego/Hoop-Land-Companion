// Top storylines of the offseason, built from what's in the save (awards,
// retirements, player movement, the draft, injuries, aging stars) plus the
// development the app applied this session (bump, trainer, mentorship).

import { playerName, injuryName, injuryHistory, skillName, leagueRookies } from './savefile.js';
import { teamRecord, standings } from './draft.js';
import { injuryClass, DEFAULT_PARAMS } from './progression.js';

const AWARD = { CHAMP: 0, FMVP: 1, MVP: 2, DPOY: 3, ROTY: 4, SIXTH: 5, MIP: 6, ALL_NBA: 13 };
const NEWS_SIGNING = { phase: 6, category: 2, type: 3 };
const NEWS_LOTTERY = { phase: 2, category: 0, type: 1 };
const isNews = (n, k) => n.phase === k.phase && n.category === k.category && n.type === k.type;

const teamName = t => (t ? `${t.city} ${t.name}`.trim() : 'free agency');
const money = c => `${c.yrs} yr${c.yrs === 1 ? '' : 's'}, $${c.sal}M${c.opt ? ' (option)' : ''}`;
const ordinal = n => `${n}${(n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;

// Per-game line for a season in a league (all stints combined).
export function seasonLine(p, leagueIdx, year) {
  const s = (p.stats || []).find(x => x.league === leagueIdx && x.yr === year);
  const rows = s?.season || [];
  const t = { GP: 0, MIN: 0, PTS: 0, REB: 0, AST: 0, STL: 0, BLK: 0, TO: 0, FGM: 0, FGA: 0, FTM: 0, FTA: 0 };
  for (const r of rows) for (const k of Object.keys(t)) t[k] += k === 'MIN' ? r.MIN[0] / 60 : r[k];
  if (!t.GP) return null;
  const pg = k => t[k] / t.GP;
  const gs = t.PTS + 0.7 * t.REB + 0.7 * t.AST + t.STL + 0.7 * t.BLK - 0.7 * t.TO
    - 0.4 * (t.FGA - t.FGM) - 0.4 * (t.FTA - t.FTM);
  return {
    gp: t.GP, mpg: pg('MIN'), ppg: pg('PTS'), rpg: pg('REB'), apg: pg('AST'),
    gs: gs / t.GP, tid: rows[rows.length - 1].tid,
  };
}
// Lowercase words, keeping acronyms (ACL, MCL).
const lower = str => str.split(' ').map(w => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(' ');
const statLine = l => (l ? `${l.ppg.toFixed(1)} PPG, ${l.rpg.toFixed(1)} RPG, ${l.apg.toFixed(1)} APG` : '');

const won = (p, id, yr) => (p.awards || []).some(a => a.id === id && a.yearsWon?.includes(yr));
const timesWon = (p, id) => (p.awards || []).filter(a => a.id === id).reduce((n, a) => n + (a.yearsWon?.length || 0), 0);

// Career weight for retirements and legacy stories.
function legacy(p) {
  return timesWon(p, AWARD.MVP) * 10 + timesWon(p, AWARD.FMVP) * 6 + timesWon(p, AWARD.CHAMP) * 3 +
    timesWon(p, AWARD.ALL_NBA) * 2 + timesWon(p, AWARD.DPOY) * 3 + (p.yrs || 0) * 0.3;
}

function accolades(p) {
  const out = [];
  const add = (id, one, many) => { const n = timesWon(p, id); if (n) out.push(n > 1 ? `${n}× ${many}` : one); };
  add(AWARD.MVP, 'MVP', 'MVP');
  add(AWARD.CHAMP, 'champion', 'champion');
  add(AWARD.FMVP, 'Finals MVP', 'Finals MVP');
  add(AWARD.ALL_NBA, 'All-NBA', 'All-NBA');
  add(AWARD.DPOY, 'DPOY', 'DPOY');
  return out.join(', ');
}

// opts: { leagueIdx, params, dev: p => diff | null, mentorships: [{ mentor, mentee, skill }] }
export function buildStorylines(league, opts = {}) {
  const li = opts.leagueIdx ?? 0;
  const yr = Math.max(...league.teams.map(t => teamRecord(t).yr || 0));
  const cur = league.season.currentYear;
  const teams = new Map(league.teams.map(t => [t.id, t]));
  const roster = league.teams.flatMap(t => t.roster.map(p => ({ p, team: t })));
  const everyone = [...roster, ...(league.freeAgents || []).map(p => ({ p, team: null }))];
  const lines = new Map(everyone.map(({ p }) => [p.id, seasonLine(p, li, yr)]));
  const star = p => Math.max(0, lines.get(p.id)?.gs ?? 0); // ~20+ for stars
  const stories = [];
  const add = (kind, score, icon, title, text, pid = null) => stories.push({ kind, score, icon, title, text, pid });

  // Champions, Finals MVP, MVP and the other awards.
  const champs = roster.filter(({ p }) => won(p, AWARD.CHAMP, yr));
  if (champs.length) {
    const fmvp = roster.find(({ p }) => won(p, AWARD.FMVP, yr))?.p;
    // The title team: where the Finals MVP (else most of the champions) played.
    const tids = champs.map(({ p }) => lines.get(p.id)?.tid).filter(x => x != null);
    const tid = (fmvp && lines.get(fmvp.id)?.tid) ??
      tids.sort((a, b) => tids.filter(x => x === b).length - tids.filter(x => x === a).length)[0];
    const t = teams.get(tid);
    const left = champs.filter(({ p, team }) => team.id !== tid && lines.get(p.id)?.tid === tid && star(p) >= 6)
      .sort((a, b) => star(b.p) - star(a.p)).map(({ p, team }) => `${playerName(p)} (${team.shortName || team.name})`);
    add('champion', 100, '🏆', `${teamName(t)} defend the crown`,
      `The ${yr} champions${fmvp ? `, led by Finals MVP ${playerName(fmvp)}` : ''}, go into ${cur === yr ? 'the offseason' : cur} as the team to beat.` +
      (left.length ? ` They lost ${left.slice(0, 3).join(', ')} along the way.` : ' The core is intact.'), fmvp?.id);
  }
  const mvp = roster.find(({ p }) => won(p, AWARD.MVP, yr));
  if (mvp) {
    const n = timesWon(mvp.p, AWARD.MVP);
    add('mvp', 90, '👑', `${playerName(mvp.p)}: ${n > 1 ? `${ordinal(n)} MVP` : 'MVP'}`,
      `${statLine(lines.get(mvp.p.id))} for the ${teamName(mvp.team)}. ${n > 1 ? 'Can anyone stop the run?' : 'Now the bar is set.'}`, mvp.p.id);
  }
  const awardBits = [[AWARD.DPOY, 'DPOY'], [AWARD.ROTY, 'Rookie of the Year'], [AWARD.MIP, 'Most Improved'], [AWARD.SIXTH, 'Sixth Man']]
    .map(([id, name]) => [name, roster.find(({ p }) => won(p, id, yr))?.p]).filter(x => x[1]);
  if (awardBits.length) {
    add('awards', 40, '🎖', 'Award season', awardBits.map(([n, p]) => `${n}: ${playerName(p)}`).join(' · ') + '.');
  }

  // Retirements this offseason.
  const retired = (league.retirees || []).filter(p => p.history?.yearRetired === cur || p.history?.yearRetired === yr + 1)
    .map(p => ({ p, w: legacy(p) })).sort((a, b) => b.w - a.w);
  for (const { p, w } of retired.slice(0, 2)) {
    if (w < 8) break;
    const acc = accolades(p);
    add('retire', 45 + w, '👋', `End of an era: ${playerName(p)} retires`,
      `After ${p.yrs} seasons${acc ? ` (${acc})` : ''}, ${p.fn} calls it a career.`, p.id);
  }
  if (retired.length > 2) {
    add('retire', 20, '👋', `${retired.length} players retire`,
      `Also hanging it up: ${retired.slice(2, 6).map(x => playerName(x.p)).join(', ')}${retired.length > 6 ? ' and more' : ''}.`);
  }

  // Player movement: signings and trades since last season.
  const signings = new Map();
  for (const n of league.season.news || []) if (isNews(n, NEWS_SIGNING)) signings.set(n.pid, n.data.contract);
  const rookieIds = new Set(leagueRookies(league).map(r => r.p.id));
  for (const { p, team } of roster) {
    const l = lines.get(p.id);
    if (!l || rookieIds.has(p.id) || l.tid === team.id || l.gp < 10) continue;
    const from = teams.get(l.tid);
    const c = signings.get(p.id);
    const s = star(p);
    if (s < 8) continue;
    if (c) {
      add('move', 30 + s * 2.5, '✍️', `${playerName(p)} signs with the ${team.name}`,
        `${money(c)}. Leaves the ${teamName(from)} after ${statLine(l)}.`, p.id);
    } else {
      add('move', 32 + s * 2.5, '🔁', `${playerName(p)} traded to the ${team.name}`,
        `The ${teamName(from)} move on from ${p.fn} (${statLine(l)}).`, p.id);
    }
  }
  // Best players still on the market.
  const unsigned = (league.freeAgents || []).filter(p => star(p) >= 12).sort((a, b) => star(b) - star(a));
  if (unsigned.length) {
    const p = unsigned[0];
    add('market', 25 + star(p) * 1.5, '🔎', `${playerName(p)} still on the market`,
      `${statLine(lines.get(p.id))} last season, age ${p.age}.` +
      (unsigned.length > 1 ? ` Also unsigned: ${unsigned.slice(1, 4).map(playerName).join(', ')}.` : ''), p.id);
  }

  // Lottery and the draft.
  const lotto = (league.season.news || []).find(n => isNews(n, NEWS_LOTTERY));
  const worst = standings(league).map(x => x.team.id);
  if (lotto && teams.get(lotto.tid)) {
    const rank = worst.indexOf(lotto.tid) + 1;
    add('draft', rank > 4 ? 60 + rank * 2 : 45, '🎱', `${teamName(teams.get(lotto.tid))} win the lottery`,
      rank === 1 ? 'The worst record pays off with the #1 pick.' : rank ? `From the ${ordinal(rank)}-worst record to the #1 pick.` : 'They pick first.');
  }
  const rookies = leagueRookies(league).filter(r => r.round === 1);
  const first = rookies.find(r => r.pick === 1);
  if (first) {
    add('draft', 55, '🎓', `${playerName(first.p)} goes #1`,
      `The ${teamName(first.team)} take the ${first.p.age}-year-old first overall.`, first.p.id);
  }

  // Injuries hanging over stars.
  for (const { p, team } of roster) {
    const h = injuryHistory(p, yr, 1);
    if (!h || h.games < 15 || star(p) < 14) continue;
    const worstInj = { ...h.worst, gamesOut: h.games };
    const cls = injuryClass(h.worst, opts.params || DEFAULT_PARAMS);
    if (cls === 'standard' && worstInj.gamesOut < 30) continue;
    add('injury', 25 + star(p) * 1.5 + worstInj.gamesOut / 4 + (cls === 'structural' ? 10 : 0), '🩹',
      `${playerName(p)} returns from ${/^[aeiou]/i.test(injuryName(worstInj)) ? 'an' : 'a'} ${lower(injuryName(worstInj))}`,
      `Missed ${worstInj.gamesOut} games last season. ${cls === 'structural' ? 'A structural injury: the ' + team.name + ' will be watching.' : cls === 'nagging' ? 'The kind that tends to come back.' : ''}`, p.id);
  }

  // Aging stars.
  for (const { p, team } of roster) {
    const into = p.age - p.regressionAge;
    if (into < 0 || into > 2 || star(p) < 16) continue;
    add('aging', 20 + star(p) * 1.5, '⏳', into === 0 ? `Last prime year for ${playerName(p)}?` : `${playerName(p)} on the decline`,
      `At ${p.age}, ${into === 0 ? 'decline starts after this season' : `year ${into} of decline`} for the ${team.name} star.`, p.id);
  }

  // Development this offseason (only what the app applied this session).
  if (opts.dev) {
    const devs = everyone.map(({ p, team }) => ({ p, team, d: opts.dev(p) })).filter(x => x.d?.changed);
    const jumps = devs.filter(x => x.d.points >= 4).sort((a, b) => b.d.points - a.d.points || b.p.pot - a.p.pot);
    for (const { p, team, d } of jumps.slice(0, 2)) {
      const top = Object.entries(d.attrs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} +${v}`).join(', ');
      add('dev', 30 + d.points * 3 + p.pot, '📈', `Big summer for ${playerName(p)}`,
        `+${d.points} in ratings (${top}) for the ${team ? team.name : 'free agent'}, age ${p.age}.`, p.id);
    }
    for (const { p, team, d } of devs.filter(x => x.d.potDelta > 0).sort((a, b) => b.p.pot - a.p.pot).slice(0, 2)) {
      add('trainer', 35 + p.pot * 3 + star(p), '⭐', `${playerName(p)}'s ceiling rises`,
        `The trainer sees more in ${p.fn} after last season${lines.get(p.id) ? ` (${statLine(lines.get(p.id))})` : ''}: potential up to ${p.pot / 2} stars.`, p.id);
    }
    for (const { p, team, d } of devs.filter(x => x.d.potDelta < 0 && x.p.pot >= 7).slice(0, 1)) {
      add('trainer', 30 + p.pot * 2, '📉', `Questions about ${playerName(p)}`,
        `The trainer lowered ${p.fn}'s potential to ${p.pot / 2} stars.`, p.id);
    }
    for (const { p, team, d } of devs.filter(x => x.d.regDelta !== 0 && star(x.p) >= 14).sort((a, b) => star(b.p) - star(a.p)).slice(0, 2)) {
      const up = d.regDelta > 0;
      add('trainer', 25 + star(p) * 1.5, up ? '🧬' : '⚠️', up ? `${playerName(p)} turns back the clock` : `The clock speeds up for ${playerName(p)}`,
        up ? `Decline pushed back to after age ${p.regressionAge}.` : `Decline now starts after age ${p.regressionAge}.`, p.id);
    }
  }
  for (const m of (opts.mentorships || []).filter(m => legacy(m.mentor) >= 10).slice(0, 1)) {
    add('mentor', 30 + legacy(m.mentor), '🎓', `${playerName(m.mentor)} mentors ${playerName(m.mentee)}`,
      `The veteran passes on ${skillName(m.skill)}.`, m.mentee.id);
  }

  // Top 10, at most two per kind (moves can take three).
  const cap = { move: 3 };
  const count = {};
  return stories.sort((a, b) => b.score - a.score).filter(s => {
    count[s.kind] = (count[s.kind] || 0) + 1;
    return count[s.kind] <= (cap[s.kind] || 2);
  }).slice(0, 10);
}
