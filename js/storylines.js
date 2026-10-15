// Top storylines of the offseason, written for a fan reading the league
// page: built from what's visible in the save (the playoffs, awards,
// retirements, player movement, the draft, injuries, aging stars) plus the
// development the app applied this session, told without the internals
// (no regression ages or potential numbers).

import { playerName, injuryName, injuryHistory, skillName, leagueRookies } from './savefile.js';
import { teamRecord, standings, collegeLine } from './draft.js';
import { injuryClass, DEFAULT_PARAMS } from './progression.js';

const AWARD = { CHAMP: 0, FMVP: 1, MVP: 2, DPOY: 3, ROTY: 4, SIXTH: 5, MIP: 6, ALL_NBA: 13 };
const NEWS_SIGNING = { phase: 6, category: 2, type: 3 };
const NEWS_LOTTERY = { phase: 2, category: 0, type: 1 };
const isNews = (n, k) => n.phase === k.phase && n.category === k.category && n.type === k.type;

const place = t => t.city || `the ${t.name}`;           // "Atlanta"; teams with no city use their name
const Place = t => { const x = place(t); return x[0].toUpperCase() + x.slice(1); };
const full = t => (t ? `${t.city} ${t.name}`.trim() : 'free agency');
const money = c => `$${c.sal * c.yrs}M`;            // contract total reads bigger: $120M, not 4 × $30M
const ordinal = n => `${n}${(n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = n => WORDS[n] || String(n);
const Word = n => { const w = word(n); return w[0].toUpperCase() + w.slice(1); };
const ROUND = { 1: 'first round', 2: 'second round', 3: 'conference finals', 4: 'Finals' };
const andList = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
// Lowercase words, keeping acronyms (ACL, MCL).
const lower = str => str.split(' ').map(w => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(' ');

// What fans would call each rating.
const SKILL_TALK = {
  LAY: 'finishing at the rim', DNK: 'athleticism around the basket', INS: 'post game', MID: 'mid-range pull-up',
  TPT: 'three-point shot', FTS: 'free-throw stroke', DRB: 'handle', PAS: 'playmaking', ORE: 'work on the offensive glass',
  DRE: 'defense', STL: 'hands in the passing lanes', BLK: 'rim protection', STR: 'strength', SPD: 'burst', STM: 'conditioning',
};

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
const f1 = x => x.toFixed(1);
const statLine = l => (l ? `${f1(l.ppg)} points, ${f1(l.rpg)} rebounds and ${f1(l.apg)} assists` : '');
const slash = l => (l ? `${f1(l.ppg)}/${f1(l.rpg)}/${f1(l.apg)}` : '');

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
  add(AWARD.DPOY, 'Defensive Player of the Year', 'DPOY');
  return out.join(', ');
}

// Deepest playoff round a team reached in a year (0 = missed, 4 = Finals),
// games won in its last series, and its record.
function playoffRun(team, yr) {
  const row = (team.season || []).find(s => s.yr === yr);
  return row ? { round: row.round || 0, wins: row.seriesWins || 0, W: row.seasonStats?.W || 0, L: row.seasonStats?.L || 0 } : { round: 0, wins: 0, W: 0, L: 0 };
}
const wonTitle = (team, yr) => { const r = playoffRun(team, yr); return r.round === 4 && r.wins === 4; };

// Who knocked a team out (from that year's bracket), and in how many games.
function eliminatedBy(league, tid, yr) {
  const po = (league.season.playoffs || []).find(x => x.yr === yr);
  for (const r of [...(po?.rounds || [])].reverse()) {
    for (const s of r.series || []) {
      if ((s.topSeed === tid || s.lowerSeed === tid) && s.winner !== tid && s.winner != null) {
        return { by: s.winner, games: s.currentGame };
      }
    }
  }
  return null;
}

// opts: { leagueIdx, leagues, params, dev: p => diff | null, mentorships: [{ mentor, mentee, skill }] }
export function buildStorylines(league, opts = {}) {
  const li = opts.leagueIdx ?? 0;
  const yr = Math.max(...league.teams.map(t => teamRecord(t).yr || 0));
  const cur = league.season.currentYear;
  const next = cur > yr ? cur : yr + 1;               // the season ahead
  const teams = new Map(league.teams.map(t => [t.id, t]));
  const roster = league.teams.flatMap(t => t.roster.map(p => ({ p, team: t })));
  const everyone = [...roster, ...(league.freeAgents || []).map(p => ({ p, team: null }))];
  const lines = new Map(everyone.map(({ p }) => [p.id, seasonLine(p, li, yr)]));
  const star = p => Math.max(0, lines.get(p.id)?.gs ?? 0); // ~20+ for stars
  const best = (team, n = 1, not = null) => team.roster.filter(p => p !== not)
    .sort((a, b) => star(b) - star(a)).slice(0, n);
  const worst = standings(league).map(x => x.team.id);       // worst to best last season
  const badTeam = t => worst.indexOf(t.id) < 10;
  const stories = [];
  const add = (kind, score, icon, title, text, pid = null) => stories.push({ kind, score, icon, title, text, pid });
  // Rotate through phrasings so the same line never shows up twice. A
  // phrase is a placeholder until the top 10 are picked; then each key hands
  // out its versions in order, skipping ones already used.
  const slots = [];
  const vary = (key, arr, seed) => { slots.push({ key, arr, seed }); return `\u0001${slots.length - 1}\u0001`; };
  const usedPhrases = {};
  const resolve = str => str.replace(/\u0001(\d+)\u0001/g, (_, i) => {
    const { key, arr, seed } = slots[+i];
    const used = (usedPhrases[key] ||= new Set());
    const start = Math.abs(seed) % arr.length;
    for (let j = 0; j < arr.length; j++) {
      const k = (start + j) % arr.length;
      if (!used.has(k)) { used.add(k); return resolve(arr[k]); }
    }
    return resolve(arr[start]);
  });
  const ringLine = (p, seed) => {
    const n = timesWon(p, AWARD.CHAMP);
    if (n) return vary('rings', [` ${Word(n)} ring${n > 1 ? 's' : ''} already.`, ` ${Word(n)} title${n > 1 ? 's' : ''} on the résumé.`, ` Already a ${n > 1 ? `${n}-time ` : ''}champion.`], seed);
    return vary('noring', [' Still searching for that first ring.', ' The one thing missing: a ring.', ' No ring yet, and the clock is ticking.', ' A title is the only thing left to chase.'], seed);
  };

  // Champion: can they repeat?
  const champs = roster.filter(({ p }) => won(p, AWARD.CHAMP, yr));
  const fmvp = roster.find(({ p }) => won(p, AWARD.FMVP, yr))?.p;
  let champTid = null;
  if (champs.length) {
    const tids = champs.map(({ p }) => lines.get(p.id)?.tid).filter(x => x != null);
    champTid = (fmvp && lines.get(fmvp.id)?.tid) ??
      tids.sort((a, b) => tids.filter(x => x === b).length - tids.filter(x => x === a).length)[0];
    const t = teams.get(champTid);
    if (t) {
      let streak = 0;
      for (let y = yr; wonTitle(t, y); y--) streak++;
      const left = champs.filter(({ p, team }) => team.id !== champTid && lines.get(p.id)?.tid === champTid && star(p) >= 6)
        .sort((a, b) => star(b.p) - star(a.p)).map(({ p, team }) => `${playerName(p)} (now in ${place(team)})`);
      const po = (league.season.playoffs || []).find(x => x.yr === yr);
      const fin = po?.rounds?.[po.rounds.length - 1]?.series?.[0];
      const opp = fin && fin.winner === champTid ? teams.get(fin.topSeed === champTid ? fin.lowerSeed : fin.topSeed) : null;
      const title = streak >= 2 ? `${Place(t)} goes for ${word(streak + 1)} straight` : pick([
        `Can ${place(t)} run it back?`, `Heavy is the head: the ${t.name} defend the crown`, `The ${t.name} are the hunted now`,
      ], t.id + yr);
      add('champion', 120, '🏆', title,
        `${streak >= 2 ? `${Word(streak)} titles in a row` : `Fresh off the ${yr} title`}${opp ? ` over ${full(opp)}` : ''}` +
        `${fmvp ? `, with ${playerName(fmvp)} as Finals MVP` : ''}. ` +
        (left.length ? `Not everyone is back: ${left.slice(0, 2).join(' and ')} moved on. ` : 'The whole core is back. ') +
        `Everyone in ${next} is chasing ${place(t)}.`, fmvp?.id);
    }
  }

  // MVP.
  const mvp = roster.find(({ p }) => won(p, AWARD.MVP, yr));
  if (mvp) {
    const n = timesWon(mvp.p, AWARD.MVP);
    const l = lines.get(mvp.p.id);
    add('mvp', 95, '👑', n >= 3 ? `${playerName(mvp.p)} is chasing history` : n === 2 ? `Two MVPs and hungry: ${playerName(mvp.p)}` : `${playerName(mvp.p)}: what does the MVP do for an encore?`,
      `${n > 1 ? `${Word(n)} MVPs and counting` : 'A first MVP'} after ${statLine(l)} a night. ` +
      (n >= 3 ? 'Only the all-time greats have more. ' : '') +
      (mvp.team.id === champTid ? 'And the ring to go with it.' : `Next step: getting the ${mvp.team.name} a title.`), mvp.p.id);
  }

  // Contenders who fell short: trying to get over the hump.
  for (const t of league.teams) {
    if (t.id === champTid) continue;
    const run = playoffRun(t, yr);
    if (run.round < 2) continue;
    const ko = eliminatedBy(league, t.id, yr);
    const by = ko && teams.get(ko.by);
    let deep = 0;
    for (let y = yr; y > yr - 4 && playoffRun(t, y).round >= 2 && !wonTitle(t, y); y--) deep++;
    const [s1, s2] = best(t, 2);
    const games = ko ? ko.games : 4 + run.wins;
    const close = run.wins === 3 ? ` in ${games}, one win short` : ` in ${games}`;
    const who = s1 ? `${playerName(s1)}${s2 ? ` and ${playerName(s2)}` : ''}` : '';
    const are = s2 ? 'are' : 'is';
    const lead = s1 ? ' ' + vary('hump-lead', [
      `${who} ${are} still chasing a ring.`,
      `${who} ${are} running out of patience.`,
      `For ${who}, it's title or bust.`,
      `${who} ${are} still waiting for the breakthrough.`,
      `${who} will carry that one into the season.`,
    ], t.id + yr) : '';
    let title;
    if (run.round === 4) title = vary('hump-finals', [`${Place(t)} came up one series short`, `So close for ${place(t)}`, `The ${t.name} got a taste of the Finals`], t.id);
    else if (deep >= 3) title = vary('hump-deep', [`${Place(t)} keeps knocking on the door`, `Is this finally ${place(t)}'s year?`], t.id);
    else if (deep === 2) title = vary('hump-two', [`${Place(t)}: can they get over the hump?`, `${Place(t)} is tired of close calls`], t.id);
    else title = run.round === 3 ? vary('hump-cf', [`${Place(t)} is one round away`, `${Place(t)} wants the last step`], t.id) : vary('hump-r2', [`${Place(t)} wants more`, `${Place(t)} isn't satisfied`, `Next up for ${place(t)}: a deeper run`], t.id);
    const text = run.round === 4
      ? `Lost the ${yr} Finals${by ? ` to ${full(by)}` : ''}${close}.${lead}`
      : `Bounced in the ${ROUND[run.round]}${by ? ` by ${full(by)}` : ''}${close}` +
        `${deep >= 2 ? `, the ${ordinal(deep)} straight year they've come up short` : ''}.${lead}`;
    add('hump', 35 + run.round * 8 + deep * 4 + (run.wins === 3 ? 4 : 0) + (s1 ? star(s1) * 0.3 : 0), run.round === 4 ? '🥈' : '⛰️', title, text, s1?.id);
  }

  // Awards round-up.
  const awardBits = [[AWARD.DPOY, 'Defensive Player of the Year'], [AWARD.ROTY, 'Rookie of the Year'], [AWARD.MIP, 'Most Improved'], [AWARD.SIXTH, 'Sixth Man']]
    .map(([id, name]) => [name, roster.find(({ p }) => won(p, id, yr))?.p]).filter(x => x[1]);
  if (awardBits.length) {
    add('awards', 30, '🎖', 'Hardware handed out', awardBits.map(([n, p]) => `${n}: ${playerName(p)}`).join(' · ') + '.');
  }

  // Retirements this offseason.
  const retired = (league.retirees || []).filter(p => p.history?.yearRetired === cur || p.history?.yearRetired === yr + 1)
    .map(p => ({ p, w: legacy(p) })).sort((a, b) => b.w - a.w);
  for (const { p, w } of retired.slice(0, 2)) {
    if (w < 8) break;
    const acc = accolades(p);
    add('retire', 45 + w, '👋', pick([`End of an era: ${playerName(p)} hangs it up`, `Farewell, ${playerName(p)}`, `${playerName(p)} calls it a career`], p.id),
      `${Word(p.yrs)} seasons${acc ? `, ${acc}` : ''}. The league will look different without ${p.fn}.`, p.id);
  }
  if (retired.length > 2) {
    add('retire', 18, '👋', 'Also saying goodbye',
      `${retired.slice(2, 6).map(x => playerName(x.p)).join(', ')}${retired.length > 6 ? ` and ${retired.length - 6} more` : ''}.`);
  }

  // Player movement: signings and trades since last season, grouped by team.
  const signings = new Map();
  for (const n of league.season.news || []) if (isNews(n, NEWS_SIGNING)) signings.set(n.pid, n.data.contract);
  const rookieIds = new Set(leagueRookies(league).map(r => r.p.id));
  const arrivals = new Map();
  for (const { p, team } of roster) {
    const l = lines.get(p.id);
    if (!l || rookieIds.has(p.id) || l.tid === team.id || l.gp < 10 || star(p) < 8) continue;
    if (!arrivals.has(team.id)) arrivals.set(team.id, []);
    arrivals.get(team.id).push({ p, l, from: teams.get(l.tid), c: signings.get(p.id) });
  }
  // Bidding wars from the app's free agency day.
  const wars = (opts.faSignings || []).filter(x => x.bidders >= 3 && star(x.p) >= 10).sort((a, b) => b.bidders - a.bidders || star(b.p) - star(a.p));
  const warIds = new Set();
  for (const x of wars.slice(0, 2)) {
    warIds.add(x.p.id);
    const l = lines.get(x.p.id);
    add('war', 40 + star(x.p) * 2 + x.bidders * 2, '🔨', pick([`Bidding war: ${playerName(x.p)} picks ${Place(x.team)}`, `${Place(x.team)} wins the ${x.p.ln} sweepstakes`], x.p.id),
      `${Word(x.bidders)} teams chased ${x.p.fn}${l ? ` after ${statLine(l)} a game` : ''}. ${Place(x.team)} won it with a ${money(x.offer)} deal${x.from && x.from.id !== x.team.id ? `, pulling ${x.p.fn} away from ${full(x.from)}` : ''}.`, x.p.id);
  }
  for (const [tid, list] of arrivals) {
    if (list.length === 1 && warIds.has(list[0].p.id)) continue;
    const team = teams.get(tid);
    list.sort((a, b) => star(b.p) - star(a.p));
    const top = list[0];
    const anchor = best(team, 4).find(x => !list.some(a => a.p === x));
    const how = a => (a.c ? `signed for ${money(a.c)}` : 'via trade');
    if (list.length >= 2 && star(list[1].p) >= 12) {
      add('move', 34 + star(top.p) * 2 + star(list[1].p), '🔥', vary('move-group', [`${Place(team)} goes all-in`, `New-look ${team.name}`, `${Place(team)} reloads`, `Big summer in ${place(team)}`, `${Place(team)} wasn't waiting around`], tid),
        `${andList(list.slice(0, 3).map(a => `${playerName(a.p)} (${slash(a.l)}, ${how(a)})`))}` +
        `${anchor ? ` join ${playerName(anchor)}` : ' arrive'}. ` + vary('move-group-end', ['Can it all fit?', 'Now they have to make it work.', 'The pressure is on.', 'One ball, a lot of mouths to feed.'], tid), top.p.id);
      continue;
    }
    const { p, l, from, c } = top;
    const verb = c ? vary('move-verb', ['heads to', 'lands in', 'is off to', 'picks'], p.id) : 'traded to';
    const title = c ? `${playerName(p)} ${verb} ${place(team)}` : `Blockbuster: ${playerName(p)} ${verb} ${place(team)}`;
    add('move', 30 + star(p) * 2.5 + (c ? 0 : 3), c ? '✍️' : '🔁', title,
      `${c ? `A ${money(c)} deal. ` : ''}${p.fn} leaves ${full(from)} after ${statLine(l)} a game` +
      `${anchor ? `, and now teams up with ${playerName(anchor)}` : ''}.` +
      (badTeam(team) ? ` A statement move for a team that won ${playoffRun(team, yr).W} games.` : ''), p.id);
  }
  // Best players still on the market.
  const unsigned = (league.freeAgents || []).filter(p => star(p) >= 12).sort((a, b) => star(b) - star(a));
  if (unsigned.length) {
    const p = unsigned[0];
    add('market', 22 + star(p) * 1.5, '📞', `Who's calling ${playerName(p)}?`,
      `Still unsigned after ${slash(lines.get(p.id))} last season, at ${p.age}.` +
      (unsigned.length > 1 ? ` Also waiting by the phone: ${unsigned.slice(1, 4).map(playerName).join(', ')}.` : ''), p.id);
  }

  // Lottery luck.
  const lotto = (league.season.news || []).find(n => isNews(n, NEWS_LOTTERY));
  if (lotto && teams.get(lotto.tid)) {
    const t = teams.get(lotto.tid);
    const rank = worst.indexOf(lotto.tid) + 1;
    add('draft', rank > 4 ? 55 + rank * 2 : 38, '🎱', rank > 4 ? `Ping-pong miracle in ${place(t)}` : `${Place(t)} wins the lottery`,
      rank > 4 ? `Only the ${ordinal(rank)}-worst record, and they jumped all the way to #1.` : `A ${playoffRun(t, yr).W}-win season pays off with the top pick.`);
  }
  // Top rookies, above all on bad teams: hope arrives.
  for (const r of leagueRookies(league).filter(r => r.round === 1 && r.pick <= 5 && r.team)) {
    const t = r.team;
    const cl = opts.leagues ? collegeLine(r.p, opts.leagues) : null;
    const run = playoffRun(t, yr);
    const young = best(t, 4, r.p).find(x => x.age <= 24 && star(x) >= 12);
    const bad = badTeam(t);
    add('rookie', (bad ? 52 : 40) + (6 - r.pick) * 4, '🌱',
      r.pick === 1 ? vary('no1', [`${playerName(r.p)}: the new face of ${place(t)}`, `The ${playerName(r.p)} era starts in ${place(t)}`, `All eyes on the #1 pick: ${playerName(r.p)}`, `No pressure, ${r.p.fn}: ${place(t)} needs a savior`], r.p.id)
        : bad ? vary('rookie-bad', [`Hope arrives in ${place(t)}`, `${place(t)} has its next building block`, `${playerName(r.p)} gives ${place(t)} something to root for`], r.p.id)
        : vary('rookie-good', [`${playerName(r.p)} lands on a contender`, `A rich team gets richer: ${playerName(r.p)}`], r.p.id),
      `The #${r.pick} pick${cl ? ` (${f1(cl.pts)} points, ${f1(cl.reb)} rebounds, ${f1(cl.ast)} assists at ${cl.team})` : ''} joins a team that went ${run.W}-${run.L}.` +
      (young ? ` Pairing ${r.p.fn} with ${playerName(young)} gives ${place(t)} a young core to build around.` : bad ? ' The rebuild runs through the rookie now.' : ''), r.p.id);
  }

  // Stars coming back from injuries.
  for (const { p, team } of roster) {
    const h = injuryHistory(p, yr, 1);
    if (!h || h.games < 15 || star(p) < 14) continue;
    const cls = injuryClass(h.worst, opts.params || DEFAULT_PARAMS);
    if (cls === 'standard' && h.games < 30) continue;
    const inj = lower(injuryName(h.worst));
    const recurring = (p.history?.injuries || []).filter(i => i.yr < yr && i.yr >= yr - 3 && i.gamesOut > 0 && injuryName(i) === injuryName(h.worst)).length;
    add('injury', 25 + star(p) * 1.5 + h.games / 4 + (cls === 'structural' ? 10 : 0), '🩹',
      cls === 'structural' ? vary('inj-struct', [`Can ${playerName(p)} come all the way back?`, `${playerName(p)}'s road back`, `The ${team.name} hold their breath on ${playerName(p)}`, `Is the old ${playerName(p)} still in there?`], p.id)
        : recurring ? vary('inj-recur', [`${playerName(p)} and that ${inj.split(' ').pop()} again`, `${playerName(p)} needs a clean bill of health`], p.id)
        : vary('inj-std', [`A healthy ${playerName(p)} changes everything`, `${playerName(p)} is back, and ${place(team)} is better for it`, `Welcome back, ${playerName(p)}`], p.id),
      vary('inj-missed', [`Missed ${h.games} games with ${/^[aeiou]/i.test(inj) ? 'an' : 'a'} ${inj}. `, `${h.games} games lost to ${/^[aeiou]/i.test(inj) ? 'an' : 'a'} ${inj} last season. `, `Sidelined ${h.games} games by ${/^[aeiou]/i.test(inj) ? 'an' : 'a'} ${inj}. `], p.id) +
      (cls === 'structural' ? vary('inj-struct-text', [`Injuries like that can take a step from a player; the ${team.name} need the old ${p.fn}.`, `The question isn't if ${p.fn} plays, it's whether the burst is still there.`, `Everything in ${place(team)} hinges on how that ${inj.split(' ').pop()} holds up.`], p.id)
        : recurring ? vary('inj-recur-text', [`Not the first time, either. The ${team.name} will be careful.`, `It keeps coming back, and so do the questions.`], p.id)
        : `Put up ${slash(lines.get(p.id))} when available.`), p.id);
  }

  // Aging stars vs Father Time (ranked by who's slipping, told by age).
  for (const { p, team } of roster) {
    if (p.age < 32 || star(p) < 15) continue;
    const slipping = p.age > p.regressionAge;
    add('aging', 22 + star(p) * 1.4 + (slipping ? 8 : 0) + Math.min(8, legacy(p) * 0.2), '⏳',
      vary('aging-title', [`Will ${p.ln} beat Father Time?`, `How much is left in the tank for ${playerName(p)}?`, `${playerName(p)} isn't done yet`, `${playerName(p)} vs. the calendar`, `One more run for ${playerName(p)}?`], p.id + yr),
      vary('aging-text', [`${p.age} years old and still putting up ${statLine(lines.get(p.id))}.`, `At ${p.age}, still good for ${statLine(lines.get(p.id))}.`, `${statLine(lines.get(p.id))} a night, at ${p.age}.`], p.id) +
      ringLine(p, p.id) +
      vary('aging-end', [` Every season counts now for the ${team.name}.`, ` The ${team.name} will take every good year they can get.`, ` How long can ${p.fn} keep this up?`], p.id), p.id);
  }

  // Development this offseason (what the app applied), told as summer buzz.
  if (opts.dev) {
    // Rookies have nothing to compare to yet: buzz is for second-year players and up.
    const devs = everyone.map(({ p, team }) => ({ p, team, d: opts.dev(p) }))
      .filter(x => x.d?.changed && x.team && !rookieIds.has(x.p.id) && (x.p.yrs || 0) >= 1 && lines.get(x.p.id));
    const jumps = devs.filter(x => x.d.points >= 4).sort((a, b) => b.d.points - a.d.points || b.p.pot - a.p.pot);
    for (const { p, team, d } of jumps.slice(0, 2)) {
      const top = Object.entries(d.attrs).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => SKILL_TALK[k]);
      add('dev', 28 + d.points * 3 + p.pot, '💪', vary('dev-title', [`Summer buzz: ${playerName(p)}`, `${playerName(p)} put in the work`, `Gym rat alert: ${playerName(p)}`, `${playerName(p)} came back different`], p.id),
        vary('dev-text', [`Word out of ${place(team)} is that the ${p.age}-year-old's ${top.join(' and ')} ${top.length > 1 ? 'look' : 'looks'} like a different player's.`,
          `Teammates noticed: ${p.fn}'s ${top.join(' and ')} took a real jump this summer.`,
          `The ${team.name} love what they've seen from ${p.fn}'s ${top.join(' and ')}.`], p.id) +
        ` Coming off ${slash(lines.get(p.id))}.`, p.id);
    }
    // A potential bump reads as a breakout candidate.
    for (const { p, team } of devs.filter(x => x.d.potDelta > 0 && x.p.age <= 25).sort((a, b) => star(b.p) - star(a.p)).slice(0, 2)) {
      const l = lines.get(p.id);
      add('breakout', 34 + p.pot * 2 + star(p), '📈', vary('leap-title', [`Is ${playerName(p)} about to break out?`, `Leap watch: ${playerName(p)}`, `${playerName(p)}'s next step`], p.id),
        `${slash(l)} at ${p.age - (cur > yr ? 1 : 0)}, ` + vary('leap-text', [`and the ${team.name} think there's another level coming.`, `and the ceiling just got higher.`, `and ${place(team)} is betting on a jump.`], p.id), p.id);
    }
  }
  for (const m of (opts.mentorships || []).filter(m => legacy(m.mentor) >= 10).slice(0, 1)) {
    add('mentor', 28 + legacy(m.mentor), '🎓', `Learning from ${playerName(m.mentor)}`,
      `${playerName(m.mentee)} spent the summer at the veteran's side, and it shows: a new ${skillName(m.skill)} game.`, m.mentee.id);
  }

  // Top 10, at most two per kind (moves and contenders can take three).
  const cap = { move: 3, hump: 3 };
  const count = {};
  return stories.sort((a, b) => b.score - a.score).filter(s => {
    count[s.kind] = (count[s.kind] || 0) + 1;
    return count[s.kind] <= (cap[s.kind] || 2);
  }).slice(0, 10).map(s => ({ ...s, title: resolve(s.title), text: resolve(s.text) }));
}
