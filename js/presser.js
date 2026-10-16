// Media Day press conference for the teams you run, plus Hoop Gram posts
// about everyone else. Questions come from what's true in the save:
// contracts (final year / extension eligible), position battles, and how
// the offseason went next to the team's star and stage.

import { playerName, POSITIONS, levelOf } from './savefile.js';
import { teamRecord, teamStatus } from './draft.js';
import { seasonLine } from './storylines.js';

const place = t => t.city || `the ${t.name}`;
const Place = t => { const x = place(t); return x[0].toUpperCase() + x.slice(1); };
const full = t => `${t.city} ${t.name}`.trim();

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
  let mood = 'normal';
  if (arrivals.length >= 2 || tradedFirsts >= 2) mood = 'allin';
  else if (star && !arrivals.length && status !== 'rebuilding') mood = 'unsupported';
  else if (status === 'rebuilding' && !arrivals.length) mood = 'quiet';
  return { star, arrivals, departures, tradedFirsts, status, mood, gs };
}

const yrsLeft = p => p.contract?.yrs ?? 0;

// Contract question target: best player in his final year, else the best
// extension-eligible one.
function contractTarget(team, sit) {
  const byStar = [...team.roster].filter(p => p.status === 3 || p.contract?.tid === team.id).sort((a, b) => sit.gs(b) - sit.gs(a));
  const last = byStar.find(p => yrsLeft(p) === 1 && sit.gs(p) >= 8);
  if (last) return { p: last, kind: 'final' };
  const ext = byStar.find(p => p.contract?.canExt && yrsLeft(p) <= 2 && sit.gs(p) >= 10);
  return ext ? { p: ext, kind: 'ext' } : null;
}

// Two rotation players at the same position with close ratings.
function positionBattle(team) {
  const top = [...team.roster].sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 9);
  let best = null;
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    const a = top[i], b = top[j];
    if (a.pos !== b.pos || Math.abs(levelOf(a) - levelOf(b)) > 2) continue;
    const sc = levelOf(a) + levelOf(b);
    if (!best || sc > best.sc) best = { a, b, sc };
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
    q: c.kind === 'final' ? `${playerName(c.p)} is heading into the final year of his deal. Are extension talks happening?` : `${playerName(c.p)} is eligible for an extension. Is that on the table?`,
    options: [{ v: 'commit', label: 'We want him here long-term' }, { v: 'focus', label: 'Our focus is on the season' }, { v: 'market', label: 'We\'ll see where things land' }],
    ctx: { kind: c.kind },
  });
  const bt = positionBattle(team);
  if (bt) out.push({
    key: 'battle', pid: bt.a.id, pid2: bt.b.id,
    q: `${playerName(bt.a)} and ${playerName(bt.b)} both play ${POSITIONS[bt.a.pos]}. Who starts?`,
    options: [{ v: 'a', label: playerName(bt.a) }, { v: 'b', label: playerName(bt.b) }, { v: 'open', label: 'It\'s an open competition' }],
  });
  const s = sit.star ? playerName(sit.star) : null;
  const q = {
    unsupported: `${s} carried this team last year, and you didn't add anyone. Is the front office doing enough for him?`,
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
export function presserStories(league, team, answers, li = 0) {
  const sit = teamSituation(league, team, li);
  const out = [];
  for (const q of presserQuestions(league, team, li)) {
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
    if (q.key === 'battle') {
      const A = league.teams.flatMap(t => t.roster).find(x => x.id === q.pid), B = league.teams.flatMap(t => t.roster).find(x => x.id === q.pid2);
      if (!A || !B) continue;
      const pos = POSITIONS[A.pos];
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
        allin: {
          believe: [`All-in ${full(team)} stands by its bet`, `"We believe in this group." After this summer, anything short of a deep run will sting.`],
          notdone: [`${Place(team)} still wants more`, `"We're not done," after already pushing the chips in. Title or bust.`],
          longterm: [`${Place(team)} says it's built to last`, `"It's about the long term." A bold claim from a team that ${sit.tradedFirsts >= 2 ? 'just traded away its future picks' : 'just remade its roster'}.`],
        },
        quiet: {
          believe: [`${Place(team)} trusts its kids`, `"We believe in this group." Patience is the plan, and the young core gets the minutes.`],
          notdone: [`${Place(team)} has cap space and plans`, `"We're not done." A quiet summer might not stay quiet.`],
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
      : `${Place(team)} brought in ${sit.arrivals.slice(0, 3).map(playerName).join(', ')}. Desperate or smart?`, sit.arrivals[0]?.id);
    if (sit.mood === 'quiet') add(team, 3, '💤 Quiet', `Not a single real move in ${place(team)} this summer. Tank watch starts now.`);
    const c = contractTarget(team, sit);
    if (c?.kind === 'final' && sit.gs(c.p) >= 15) add(team, 6 + sit.gs(c.p) / 4, '⏳ Contract Year', `${playerName(c.p)} is entering a contract year in ${place(team)}. Every team with cap space next summer is watching.`, c.p.id);
    const gone = sit.departures.sort((a, b) => sit.gs(b) - sit.gs(a))[0];
    if (gone && sit.gs(gone) >= 15 && !sit.arrivals.length) add(team, 5 + sit.gs(gone) / 4, '🚪 Lost', `${Place(team)} lost ${playerName(gone)} and got nothing back. Rough summer.`, gone.id);
  }
  const seenT = new Set(), seenTag = new Map();
  return posts.sort((a, b) => b.score - a.score).filter(x => {
    if (seenT.has(x.team.id) || seenTag.has(x.tag)) return false;
    seenT.add(x.team.id); seenTag.set(x.tag, (seenTag.get(x.tag) || 0) + 1);
    return true;
  }).slice(0, 8);
}
