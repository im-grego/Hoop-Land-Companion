// Media Day press conference for the teams you run, plus Hoop Gram posts
// about everyone else. Questions come from what's true in the save:
// contracts (final year / extension eligible), position battles, and how
// the offseason went next to the team's star and stage.

import { playerName, POSITIONS } from './savefile.js';
import { shownLevel as levelOf } from './regression.js';
import { tierFor } from './draft.js';
import { teamRecord, teamStatus } from './draft.js';
import { seasonLine } from './storylines.js';

const place = t => t.city || `the ${t.name}`;
const Place = t => { const x = place(t); return x[0].toUpperCase() + x.slice(1); };
const full = t => `${t.city} ${t.name}`.trim();

// League-wide context for "is the star getting help?": each team's
// supporting cast (its 2nd-5th best players) and projected strength.
const W9 = [1, 0.95, 0.9, 0.8, 0.7, 0.55, 0.45, 0.35, 0.25];
const ctxCache = new WeakMap();
function leagueCtx(league) {
  if (ctxCache.has(league)) return ctxCache.get(league);
  const lv = t => [...t.roster].map(levelOf).sort((a, b) => b - a);
  const support = new Map(league.teams.map(t => { const l = lv(t).slice(1, 5); return [t.id, l.reduce((a, b) => a + b, 0) / (l.length || 1)]; }));
  const proj = new Map(league.teams.map(t => [t.id, lv(t).slice(0, 9).reduce((a, v, i) => a + v * W9[i], 0)]));
  const order = [...league.teams].sort((a, b) => proj.get(b.id) - proj.get(a.id)).map(t => t.id);
  const sup = [...support.values()].sort((a, b) => a - b);
  const ctx = { support, projRank: new Map(order.map((id, i) => [id, i + 1])), supportMedian: sup[Math.floor(sup.length / 2)] || 0 };
  ctxCache.set(league, ctx);
  return ctx;
}

// What the team looks like going into the season.
export function teamSituation(league, team, li = 0) {
  const yr = Math.max(...league.teams.map(t => teamRecord(t).yr || 0));
  const cur = league.season.currentYear;
  const line = p => seasonLine(p, li, yr);
  const gs = p => Math.max(0, line(p)?.gs ?? 0);
  const roster = [...team.roster].sort((a, b) => gs(b) - gs(a));
  const star = roster[0] && gs(roster[0]) >= 17 ? roster[0] : null;
  const rookie = p => p.history?.draft?.yr === cur || p.history?.yearDeclared === cur;
  // Arrivals: played somewhere else last season (not rookies).
  const arrivals = team.roster.filter(p => { const l = line(p); return l && !rookie(p) && l.tid !== team.id && l.gp >= 10 && gs(p) >= 9; });
  // Departures: played here last season, now gone.
  const everyone = [...league.teams.flatMap(t => t.roster.map(p => ({ p, t }))), ...(league.freeAgents || []).map(p => ({ p, t: null }))];
  const departures = everyone.filter(({ p, t }) => t !== team && line(p)?.tid === team.id && line(p).gp >= 10 && gs(p) >= 9).map(x => x.p);
  // Own future first-rounders held by someone else.
  const tradedFirsts = league.teams.filter(t => t !== team)
    .flatMap(t => t.draftPicks.filter(pk => pk.rd === 1 && pk.yr > cur && pk.otid === team.id)).length;
  const status = teamStatus(league, team);
  // Last playoffs: knocked out badly (swept or one win in the series they lost).
  const row = (team.season || []).find(s => s.yr === yr);
  const round = row?.round || 0, seriesWins = row?.seriesWins || 0;
  const champ = round === 4 && seriesWins === 4;
  const lostBadly = round >= 1 && !champ && seriesWins <= 1;
  const ctx = leagueCtx(league);
  // No help only when the cast around the star is thin, not when the team is
  // still projected near the top without adding anyone.
  const thinCast = ctx.support.get(team.id) < ctx.supportMedian - 1 && ctx.projRank.get(team.id) > 8;
  let mood = 'normal';
  // All-in takes real talent coming in (Lv 79+, three stars or better).
  if (arrivals.filter(p => levelOf(p) >= 79).length >= 2 || tradedFirsts >= 2) mood = 'allin';
  else if (!arrivals.length && lostBadly && status !== 'rebuilding') mood = 'passive';
  else if (star && !arrivals.length && thinCast && status !== 'rebuilding') mood = 'unsupported';
  else if (status === 'rebuilding' && !arrivals.length) mood = 'quiet';
  return { star, arrivals, departures, tradedFirsts, status, mood, gs, round, seriesWins, lostBadly };
}

const andList = a => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');
const yrsLeft = p => p.contract?.yrs ?? 0;

// Contract question target: best player in his final year, else the best
// extension-eligible one.
function contractTarget(team, sit) {
  const byStar = [...team.roster].filter(p => (p.status === 3 || p.contract?.tid === team.id) && !(p.contract?.ext?.yrs > 0)).sort((a, b) => sit.gs(b) - sit.gs(a));
  // Only someone worth building around: a starter-caliber level as the game
  // shows it (regression included), not a declining veteran.
  const core = p => levelOf(p) >= 74 && p.age <= (p.regressionAge || 32) + 1;
  const last = byStar.find(p => yrsLeft(p) === 1 && sit.gs(p) >= 8 && core(p));
  if (last) return { p: last, kind: 'final' };
  const ext = byStar.find(p => p.contract?.canExt && yrsLeft(p) <= 2 && sit.gs(p) >= 10 && core(p));
  return ext ? { p: ext, kind: 'ext' } : null;
}

// The lineup slot a player fills (teamPos: 0 PG, 2 SG, 4 SF, 6 PF, 8 C).
const SLOT_NAMES = { 0: 'point guard', 2: 'shooting guard', 4: 'small forward', 6: 'power forward', 8: 'center' };
const slotOf = p => SLOT_NAMES[p.teamPos] ? p.teamPos : [0, 2, 4, 6, 8].reduce((a, b) => (Math.abs(b - p.pos) < Math.abs(a - p.pos) ? b : a));
// A starter and a rotation player behind him in the same lineup slot with
// close ratings: who starts there?
function positionBattle(team) {
  const top = [...team.roster].sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 9);
  const starters = top.filter(p => (p.linePos ?? 99) < 5);
  let best = null;
  for (const a of starters) for (const b of top) {
    if (b === a || (b.linePos ?? 99) < 5 || slotOf(a) !== slotOf(b) || Math.abs(levelOf(a) - levelOf(b)) > 2) continue;
    const sc = levelOf(a) + levelOf(b);
    if (!best || sc > best.sc) best = { a, b, sc, slot: SLOT_NAMES[slotOf(a)] };
  }
  return best;
}

// Questions for one of your teams: [{ key, q, options: [{ v, label }], ... }].
export function presserQuestions(league, team, li = 0) {
  const sit = teamSituation(league, team, li);
  const out = [];
  const c = contractTarget(team, sit);
  if (c) out.push({
    key: 'contract', pid: c.p.id,
    q: c.kind === 'final' ? `${playerName(c.p)} is heading into a contract year with no extension. Is he part of the long-term plan?` : `${playerName(c.p)} is eligible for an extension. Is that on the table?`,
    options: [{ v: 'commit', label: 'We want him here long-term' }, { v: 'focus', label: 'Our focus is on the season' }, { v: 'market', label: 'We\'ll see where things land' }],
    ctx: { kind: c.kind },
  });
  // No contract talk to have: ask about the big arrival, else the 4-star kid.
  const bt = positionBattle(team);
  if (!c || !bt) {
    const big = sit.arrivals.filter(p => levelOf(p) >= 78).sort((a, b) => levelOf(b) - levelOf(a))[0];
    const kid = [...team.roster].filter(p => (p.pot || 0) >= 8 && p.age <= 23 && levelOf(p) >= 60).sort((a, b) => (b.pot - a.pot) || (levelOf(b) - levelOf(a)))[0];
    const any = [...team.roster].filter(p => p.age <= 24).sort((a, b) => ((b.pot || 0) - (a.pot || 0)) || (levelOf(b) - levelOf(a)))[0];
    const x = big || kid || ((!c && !bt) ? any : null);
    if (x) out.push({
      key: 'expect', pid: x.id,
      q: big ? `You brought in ${playerName(x)} this summer. What do you expect from him?` : `Scouts see ${playerName(x)} as ${/^[AEIOU]/.test(tierFor(x.pot || 0)) ? 'an' : 'a'} ${tierFor(x.pot || 0).replace('Hall of Fame', 'Hall of Famer').replace('G-League', 'G-League player')} down the road. What are the expectations?`,
      options: big
        ? [{ v: 'star', label: 'He\'s the centerpiece' }, { v: 'fit', label: 'He fits in with the group' }, { v: 'time', label: 'He needs time to settle in' }]
        : [{ v: 'star', label: 'He\'s the future of this team' }, { v: 'fit', label: 'He\'ll earn his minutes' }, { v: 'time', label: 'No rush with him' }],
      ctx: { kind: big ? 'arrival' : 'prospect' },
    });
  }
  if (bt) out.push({
    key: 'battle', pid: bt.a.id, pid2: bt.b.id,
    q: `${playerName(bt.a)} and ${playerName(bt.b)} can both play ${bt.slot}. Who starts?`,
    ctx: { slot: bt.slot },
    options: [{ v: 'a', label: playerName(bt.a) }, { v: 'b', label: playerName(bt.b) }, { v: 'open', label: 'It\'s an open competition' }],
  });
  // Three questions every time: if the roster gave too little to ask about,
  // ask what the season's goal is.
  if (out.length < 2) out.push({
    key: 'goal', pid: sit.star?.id,
    q: sit.status === 'rebuilding' ? 'What does a successful season look like for this team?' : 'What\'s the goal for this team this season?',
    options: [{ v: 'title', label: 'A championship' }, { v: 'playoffs', label: 'Make the playoffs and see' }, { v: 'develop', label: 'Develop the young guys' }],
    ctx: {},
  });
  const s = sit.star ? playerName(sit.star) : null;
  const q = {
    unsupported: `${s} carried this team last year, and you didn't add anyone. Is the front office doing enough for him?`,
    passive: `After ${sit.seriesWins === 0 ? 'getting swept' : 'that playoff exit'}, you stood pat this summer. Is internal development enough, or is the front office being passive?`,
    allin: sit.tradedFirsts >= 2 ? 'You traded away a lot of the future this summer. Is it title or bust?' : 'Big summer: a lot of new faces. Is it title or bust this year?',
    quiet: 'A quiet summer for a rebuilding team. Fans want to know: what\'s the plan?',
    normal: 'How do you grade your offseason?',
  }[sit.mood];
  out.push({
    key: 'moves', pid: sit.star?.id, q,
    options: [{ v: 'believe', label: 'We believe in this group' }, { v: 'notdone', label: 'We\'re not done' }, { v: 'longterm', label: 'It\'s about the long term' }],
    ctx: { mood: sit.mood },
  });
  return out;
}

// One storyline per answered question: { kind, score, icon, title, text, pid }.
// `frozen`: the questions as they were asked (answers can change the roster).
export function presserStories(league, team, answers, li = 0, frozen = null) {
  const sit = teamSituation(league, team, li);
  const out = [];
  for (const q of frozen || presserQuestions(league, team, li)) {
    const a = answers?.[q.key];
    if (!a) continue;
    const P = league.teams.flatMap(t => t.roster).find(x => x.id === q.pid);
    if (q.key === 'contract' && P) {
      const n = playerName(P);
      const fin = q.ctx.kind === 'final';
      const t = {
        commit: [`${Place(team)} wants ${n} long-term`, `"We want him here long-term," the front office said of ${P.fn}.${fin ? ' Now they have to get it done before he hits free agency.' : ' An extension looks like a matter of when.'}`],
        focus: [`No extension talk for ${n}`, `The front office kept it to "our focus is on the season."${fin ? ` A contract year gives ${P.fn} plenty to play for.` : ''}`],
        market: [`${n}'s future in ${place(team)} is up in the air`, `"We'll see where things land." Not exactly a vote of confidence${fin ? `, with ${P.fn} a year from free agency` : ''}.`],
      }[a];
      out.push({ kind: 'presser-contract', score: 58, icon: '🎙️', title: t[0], text: t[1], pid: P.id });
    }
    if (q.key === 'expect' && P) {
      const n = playerName(P);
      const arr = q.ctx.kind === 'arrival';
      const t = {
        star: [`${Place(team)} puts it on ${n}`, arr ? `"He's the centerpiece," the front office said of ${P.fn}. The expectations are sky high.` : `"He's the future of this team." ${P.fn} carries the hopes of ${place(team)}.`],
        fit: [`${n} is one of the group`, `The front office kept the pressure off ${P.fn}: ${arr ? 'a piece, not the whole puzzle' : 'minutes have to be earned'}.`],
        time: [`${Place(team)} will give ${n} time`, arr ? `"He needs time to settle in." Fans wanted a bigger statement on ${P.fn}.` : `No rush with ${P.fn}. Patience is the plan in ${place(team)}.`],
      }[a];
      out.push({ kind: 'presser-contract', score: 56, icon: '🎙️', title: t[0], text: t[1], pid: P.id });
    }
    if (q.key === 'goal') {
      const t = {
        title: [`${Place(team)}: title or bust`, `"A championship." The front office set the bar at the top for ${place(team)}.`],
        playoffs: [`${Place(team)} aims for the playoffs`, `"Make the playoffs and see what happens." A measured goal for ${place(team)}.`],
        develop: [`${Place(team)} bets on its young players`, `"Develop the young guys." The scoreboard comes second in ${place(team)}.`],
      }[a];
      out.push({ kind: 'presser-contract', score: 54, icon: '🎙️', title: t[0], text: t[1], pid: q.pid });
    }
    if (q.key === 'battle') {
      const A = league.teams.flatMap(t => t.roster).find(x => x.id === q.pid), B = league.teams.flatMap(t => t.roster).find(x => x.id === q.pid2);
      if (!A || !B) continue;
      const pos = q.ctx?.slot || POSITIONS[A.pos];
      const [w, l] = a === 'b' ? [B, A] : [A, B];
      out.push(a === 'open'
        ? { kind: 'presser-battle', score: 52, icon: '🎙️', title: `Open competition at ${pos} in ${place(team)}`, text: `${playerName(A)} vs ${playerName(B)}: the front office wouldn't name a starter. Camp decides it.`, pid: A.id }
        : { kind: 'presser-battle', score: 52, icon: '🎙️', title: `${playerName(w)} gets the nod at ${pos}`, text: `The front office named ${w.fn} the starter over ${playerName(l)}. ${l.fn} will have to make the most of his minutes off the bench.`, pid: w.id });
    }
    if (q.key === 'moves') {
      const s = sit.star, sn = s ? playerName(s) : 'the stars';
      const T = {
        unsupported: {
          believe: [`Content in ${place(team)}?`, `"We believe in this group." With ${sn} in his prime and no help added, not everyone in ${place(team)} agrees.`],
          notdone: [`${Place(team)} hints at more`, `"We're not done." The clock is on to get ${sn} some help before the deadline.`],
          longterm: [`Is ${place(team)} wasting ${s ? `${s.fn}'s` : 'its'} prime?`, `"It's about the long term," said the front office. ${sn} may not want to wait.`],
        },
        passive: {
          believe: [`${Place(team)} bets on internal growth`, `"We believe in this group." After ${sit.seriesWins === 0 ? 'a sweep' : 'that playoff exit'}, the plan is development, not new faces.`],
          notdone: [`${Place(team)} promises more after playoff flop`, `"We're not done." Fans in ${place(team)} will hold them to it after a quiet summer.`],
          longterm: [`Patient or passive in ${place(team)}?`, `"It's about the long term." A tough sell after ${sit.seriesWins === 0 ? 'getting swept' : 'going out that easily'}.`],
        },
        allin: {
          believe: [`All-in ${full(team)} stands by its bet`, `"We believe in this group." After this summer, anything short of a deep run will sting.`],
          notdone: [`${Place(team)} still wants more`, `"We're not done," after already pushing the chips in. Title or bust.`],
          longterm: [`${Place(team)} says it's built to last`, `"It's about the long term." A bold claim from a team that ${sit.tradedFirsts >= 2 ? 'just traded away its future picks' : 'just remade its roster'}.`],
        },
        quiet: {
          believe: [`${Place(team)} trusts its kids`, `"We believe in this group." Patience is the plan, and the young core gets the minutes.`],
          notdone: [`${Place(team)} isn't finished building`, `"We're not done." The front office says there's more coming before the season tips off.`],
          longterm: [`The long game in ${place(team)}`, `"It's about the long term." Fans will be watching the lottery odds.`],
        },
        normal: {
          believe: [`${Place(team)} likes what it has`, `"We believe in this group," the front office said. Now they have to prove it.`],
          notdone: [`${Place(team)} keeps the phone lines open`, `"We're not done." Expect ${place(team)} to be in the trade rumors.`],
          longterm: [`${Place(team)} is playing the long game`, `"It's about the long term." No shortcuts this year.`],
        },
      }[q.ctx.mood][a];
      out.push({ kind: 'presser-moves', score: sit.mood === 'normal' ? 46 : 60, icon: '🎙️', title: T[0], text: T[1], pid: s?.id ?? null });
    }
  }
  return out;
}

// Last year's promises: did you keep them? `promises` = [{ yr, tid, pid, v }].
export function promiseStories(league, promises) {
  const out = [];
  const cur = league.season.currentYear;
  for (const pr of promises.filter(x => x.yr === cur - 1 && x.v === 'commit')) {
    const team = league.teams.find(t => t.id === pr.tid);
    const all = [...league.teams.flatMap(t => t.roster.map(p => ({ p, t }))), ...(league.freeAgents || []).map(p => ({ p, t: null }))];
    const hit = all.find(x => x.p.id === pr.pid);
    if (!team || !hit) continue;
    const n = playerName(hit.p);
    if (pr.src === 'option') {
      const promise = { role: 'a bigger role', ext: 'a long-term deal', pay: 'a big contract', win: 'help around him' }[pr.kind] || 'a future';
      out.push(hit.t === team
        ? { kind: 'promise', score: 52, icon: '🤝', title: `${n} opted in on a promise`, text: `${Place(team)} promised ${hit.p.fn} ${promise} to keep him from testing free agency. This is the year it has to show.`, pid: hit.p.id }
        : { kind: 'promise', score: 62, icon: '💔', title: `${Place(team)} promised ${n} ${promise}. He's gone.`, text: `He opted in on their word last summer. ${hit.p.fn} is ${hit.t ? `in ${place(hit.t)} now` : 'still looking for a team'}.`, pid: hit.p.id });
      continue;
    }
    out.push(hit.t === team
      ? { kind: 'promise', score: 50, icon: '🤝', title: `${Place(team)} kept its word`, text: `A year ago the front office said it wanted ${n} long-term. He's still in ${place(team)}.`, pid: hit.p.id }
      : { kind: 'promise', score: 64, icon: '💔', title: `${Place(team)} promised ${n} a future. He's gone.`, text: `"We want him here long-term," they said last Media Day. ${hit.p.fn} is ${hit.t ? `in ${place(hit.t)} now` : 'still looking for a team'}.`, pid: hit.p.id });
  }
  return out;
}

// Hoop Gram: trending around the league (teams you don't run).
const HANDLES = ['@HoopGramNBA', '@CapSpaceKing', '@LockerRoomLeaks', '@TradeMachineTom', '@HoopsTwitterHL', '@BeatWriterBev'];
export function leagueGram(league, skip, li = 0) {
  const posts = [];
  const add = (team, score, tag, text, pid = null) => posts.push({ team, score, tag, text, pid, handle: HANDLES[(team.id * 5 + tag.length) % HANDLES.length], likes: 600 + ((team.id * 2654435761) >>> 0) % 7000 + Math.round(score * 300) });
  for (const team of league.teams.filter(t => !skip(t))) {
    const sit = teamSituation(league, team, li);
    const s = sit.star;
    if (sit.mood === 'unsupported' && s) add(team, 8 + sit.gs(s) / 3, '😬 No Help', `${playerName(s)} put up big numbers and ${place(team)} added... nobody. How long until he asks out?`, s.id);
    if (sit.mood === 'allin') add(team, 7 + sit.arrivals.length + sit.tradedFirsts, '🎰 All In', sit.tradedFirsts >= 2
      ? `${Place(team)} traded ${sit.tradedFirsts} future firsts. Title or bust, no in-between.`
      : `${Place(team)} brought in ${andList(sit.arrivals.slice(0, 3).map(p => p.ln))} for $${sit.arrivals.slice(0, 3).reduce((a, p) => a + (p.contract?.sal || 0), 0)}M a year. Desperate or smart?`, sit.arrivals[0]?.id);
    if (sit.mood === 'passive') add(team, 6 + (s ? sit.gs(s) / 5 : 0), '🤔 Passive?', `${Place(team)} ${sit.seriesWins === 0 ? 'got swept' : 'went out quietly'} in the playoffs and didn't make a single move. Is development enough?`, s?.id);
    if (sit.mood === 'quiet') add(team, 3, '💤 Quiet', `Not a single real move in ${place(team)} this summer. Tank watch starts now.`);
    const c = contractTarget(team, sit);
    if (c?.kind === 'final' && sit.gs(c.p) >= 15) add(team, 6 + sit.gs(c.p) / 4, '⏳ Contract Year', `${playerName(c.p)} is entering a contract year in ${place(team)}. Every team with cap space next summer is watching.`, c.p.id);
    const gone = sit.departures.sort((a, b) => sit.gs(b) - sit.gs(a))[0];
    if (gone && levelOf(gone) >= 86 && !sit.arrivals.length) add(team, 5 + sit.gs(gone) / 4, '🚪 Lost', `${Place(team)} lost ${playerName(gone)} and got nothing back. Rough summer.`, gone.id);
  }
  const seenT = new Set(), seenTag = new Map();
  return posts.sort((a, b) => b.score - a.score).filter(x => {
    if (seenT.has(x.team.id) || seenTag.has(x.tag)) return false;
    seenT.add(x.team.id); seenTag.set(x.tag, (seenTag.get(x.tag) || 0) + 1);
    return true;
  }).slice(0, 8);
}
