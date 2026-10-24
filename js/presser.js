// Media Day press conference for the teams you run, plus Hoop Gram posts
// about everyone else. Questions come from what's true in the save:
// contracts (final year / extension eligible), position battles, and how
// the offseason went next to the team's star and stage.

import { headCoachOf, playerCoachFit, isStarPlayer } from './coachmarket.js';
import { playerName, POSITIONS } from './savefile.js';
import { shownLevel as levelOf } from './regression.js';
import { tierFor } from './draft.js';
import { teamRecord, teamStatus } from './draft.js';
import { seasonLine } from './storylines.js';
import { tr } from './traits.js';
import { egoVal } from './ego.js';

// A stable pick per team, summer and question: the same summer always asks (and reports) the same way; the next one
// asks differently.
const hashN = (...xs) => { let h = 2166136261; for (const x of xs) for (const c of String(x)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); h ^= h >>> 13; return ((Math.imul(h, 1274126177) >>> 0) % 100000) / 100000; };
const pickV = (arr, ...seed) => arr[Math.floor(hashN(...seed) * arr.length)];
// Who's holding out (the app knows asks and extensions): f(team) -> players.
let HOLD = () => [];
export const setHoldouts = f => { HOLD = f; };
const WHO = ['Beat writer', 'Local TV', 'National insider', 'Team radio', 'Podcast host', 'Columnist', 'Sports talk radio', 'Team website'];
const lastInj = (p, yr) => ((p.stats || []).find(s => s.league === 0 && s.yr === yr)?.season || []).reduce((a, r) => a + (r.INJ || 0), 0);

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
// Stars whose game the coach's system doesn't feature.
export function starClashes(league, team) {
  const c = headCoachOf(team);
  return c ? team.roster.filter(isStarPlayer).filter(p => playerCoachFit(p, team, c).clash).sort((a, b) => levelOf(b) - levelOf(a)) : [];
}
export function presserQuestions(league, team, li = 0) {
  const sit = teamSituation(league, team, li);
  const out = [];
  const c = contractTarget(team, sit);
  if (c) out.push({
    key: 'contract', pid: c.p.id,
    q: c.kind === 'final'
      ? pickV([`${playerName(c.p)} is heading into a contract year with no extension. Is he part of the long-term plan?`,
        `${playerName(c.p)} can walk next summer. Have you started talks?`,
        `There's a lot of noise about ${playerName(c.p)}'s contract year. Where do things stand?`,
        `Is ${playerName(c.p)} a ${team.name} player beyond this season?`], team.id, league.season.currentYear, 'contract')
      : pickV([`${playerName(c.p)} is eligible for an extension. Is that on the table?`,
        `Any update on an extension for ${playerName(c.p)}?`,
        `${playerName(c.p)} has outplayed his deal. Are you ready to pay him?`], team.id, league.season.currentYear, 'contract'),
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
      q: big ? pickV([`You brought in ${playerName(x)} this summer. What do you expect from him?`,
          `What does ${playerName(x)} change for this team?`,
          `Fans are excited about ${playerName(x)}. How big is his role going to be?`], team.id, league.season.currentYear, 'expect')
        : pickV([`Scouts see ${playerName(x)} as ${/^[AEIOU]/.test(tierFor(x.pot || 0)) ? 'an' : 'a'} ${tierFor(x.pot || 0).replace('Hall of Fame', 'Hall of Famer').replace('G-League', 'G-League player')} down the road. What are the expectations?`,
          `How big a jump are you expecting from ${playerName(x)} this year?`,
          `Is this the year ${playerName(x)} breaks out?`], team.id, league.season.currentYear, 'expect'),
      options: big
        ? [{ v: 'star', label: 'He\'s the centerpiece' }, { v: 'fit', label: 'He fits in with the group' }, { v: 'time', label: 'He needs time to settle in' }]
        : [{ v: 'star', label: 'He\'s the future of this team' }, { v: 'fit', label: 'He\'ll earn his minutes' }, { v: 'time', label: 'No rush with him' }],
      ctx: { kind: big ? 'arrival' : 'prospect' },
    });
  }
  if (bt) out.push({
    key: 'battle', pid: bt.a.id, pid2: bt.b.id,
    q: pickV([`${playerName(bt.a)} and ${playerName(bt.b)} can both play ${bt.slot}. Who starts?`,
      `Who's your starting ${bt.slot}: ${playerName(bt.a)} or ${playerName(bt.b)}?`,
      `${playerName(bt.b)} is pushing ${playerName(bt.a)} for the starting job at ${bt.slot}. Is it his to lose?`], team.id, league.season.currentYear, 'battle'),
    ctx: { slot: bt.slot },
    options: [{ v: 'a', label: playerName(bt.a) }, { v: 'b', label: playerName(bt.b) }, { v: 'open', label: 'It\'s an open competition' }],
  });
  // Stars butting heads with the coach: the room hears about it.
  const hot = starClashes(league, team);
  if (hot.length) {
    const [A, B] = hot;
    out.push({
      key: 'lockerroom', pid: A.id, pid2: B?.id,
      q: B ? `There are reports of a players-only meeting and friction between ${playerName(A)}, ${playerName(B)} and the coaching staff. Is there a problem in the locker room?`
        : `There are reports of a players-only meeting and friction between ${playerName(A)} and the coaching staff. Is there a problem in the locker room?`,
      options: [{ v: 'fine', label: 'Everyone is on the same page' }, { v: 'handled', label: 'We handled it in-house' }, { v: 'role', label: 'Roles will be sorted out' }],
      ctx: { n: hot.length },
    });
  }
  // Situational questions: whatever this summer gives the room to ask about. Up to two make it in (more when the
  // roster gave little else), in a different order each summer.
  const yr0 = league.season.currentYear, lyr = yr0 - 1;
  const signed = team.roster.filter(p => p.status === 3 || p.status === 2);
  const extra = [];
  const al = signed.filter(p => egoVal(p) >= 16).sort((a, b) => levelOf(b) - levelOf(a));
  if (al.length >= 2) extra.push({ key: 'alphas', pid: al[0].id, pid2: al[1].id,
    q: pickV([`Can ${playerName(al[0])} and ${playerName(al[1])} share the ball?`, `Two alphas in one locker room: ${playerName(al[0])} and ${playerName(al[1])}. Whose team is it?`, `There's talk ${al[1].fn} wants a bigger role next to ${al[0].fn}. How do you balance them?`], team.id, yr0, 'alphas'),
    options: [{ v: 'share', label: 'They\'ll figure it out together' }, { v: 'pecking', label: `It's ${al[0].fn}'s team` }, { v: 'winning', label: 'Winning fixes everything' }], ctx: {} });
  const hurt = signed.filter(p => lastInj(p, lyr) >= 35 && levelOf(p) >= 72).sort((a, b) => levelOf(b) - levelOf(a))[0];
  if (hurt) extra.push({ key: 'injury', pid: hurt.id,
    q: pickV([`${playerName(hurt)} missed ${lastInj(hurt, lyr)} games last year. How is he doing?`, `Is ${playerName(hurt)} ready for opening night?`, `What's the plan with ${playerName(hurt)} coming off the injury?`], team.id, yr0, 'injury'),
    options: [{ v: 'ready', label: 'He\'s ready to go' }, { v: 'ease', label: 'We\'ll ease him back in' }, { v: 'care', label: 'His long-term health comes first' }], ctx: {} });
  const vet = signed.filter(p => p.age >= 33 && levelOf(p) >= 72).sort((a, b) => b.age - a.age || levelOf(b) - levelOf(a))[0];
  if (vet) extra.push({ key: 'vet', pid: vet.id,
    q: pickV([`Is this ${playerName(vet)}'s last season?`, `${playerName(vet)} is ${vet.age}. How much does he have left?`, `What does ${playerName(vet)} still give this team at ${vet.age}?`], team.id, yr0, 'vet'),
    options: [{ v: 'more', label: 'He has plenty left' }, { v: 'year', label: 'One year at a time' }, { v: 'mentor', label: 'He\'s here to teach the young guys' }], ctx: {} });
  const rk = signed.filter(p => p.history?.draft?.yr === yr0 && p.history.draft.rd === 1 && p.history.draft.pk <= 10).sort((a, b) => a.history.draft.pk - b.history.draft.pk)[0];
  if (rk) extra.push({ key: 'rookie', pid: rk.id,
    q: pickV([`What's the plan for ${playerName(rk)} as a rookie?`, `Does ${playerName(rk)} start on opening night?`, `How much will you lean on ${playerName(rk)} this year?`], team.id, yr0, 'rookie'),
    options: [{ v: 'start', label: 'He\'ll start from day one' }, { v: 'earn', label: 'He\'ll have to earn it' }, { v: 'patience', label: 'We\'ll bring him along slowly' }], ctx: { pk: rk.history.draft.pk } });
  extra.sort((a, b) => hashN(team.id, yr0, a.key) - hashN(team.id, yr0, b.key));
  // A holdout is always the first thing the room asks about.
  const ho = HOLD(team)[0];
  if (ho) extra.unshift({ key: 'holdout', pid: ho.id,
    q: pickV([`${playerName(ho)} skipped camp. Is he holding out?`, `Where do things stand with ${playerName(ho)}? He wasn't at camp.`, `${playerName(ho)} wants a new deal and isn't showing up until he gets one. Your response?`], team.id, yr0, 'holdout'),
    options: [{ v: 'pay', label: 'We\'ll get something done' }, { v: 'stand', label: 'He\'s under contract' }, { v: 'shop', label: 'Everything\'s on the table' }], ctx: {} });
  for (const x of extra.slice(0, out.length >= 3 ? 1 : 2)) out.push(x);
  // Three questions every time: if the roster gave too little to ask about,
  // ask what the season's goal is.
  if (out.length < 2) out.push({
    key: 'goal', pid: sit.star?.id,
    q: sit.status === 'rebuilding' ? pickV(['What does a successful season look like for this team?', 'How will you judge this season?', 'Fans are asking for patience. How much?'], team.id, league.season.currentYear, 'goal')
      : pickV(['What\'s the goal for this team this season?', 'Where does this team finish?', 'What would make this season a success?'], team.id, league.season.currentYear, 'goal'),
    options: [{ v: 'title', label: 'A championship' }, { v: 'playoffs', label: 'Make the playoffs and see' }, { v: 'develop', label: 'Develop the young guys' }],
    ctx: {},
  });
  const s = sit.star ? playerName(sit.star) : null;
  const yr = league.season.currentYear;
  const q = pickV({
    unsupported: [`${s} carried this team last year, and you didn't add anyone. Is the front office doing enough for him?`, `How long can you ask ${s} to do it alone?`, `${s} needed help and didn't get any. What's the message to him?`],
    passive: [`After ${sit.seriesWins === 0 ? 'getting swept' : 'that playoff exit'}, you stood pat this summer. Is internal development enough, or is the front office being passive?`, `Same roster that ${sit.seriesWins === 0 ? 'got swept' : 'went out early'}. Why should fans expect anything different?`],
    allin: sit.tradedFirsts >= 2 ? ['You traded away a lot of the future this summer. Is it title or bust?', 'You mortgaged the future for this roster. Can you live with it if it doesn\'t work?'] : ['Big summer: a lot of new faces. Is it title or bust this year?', 'A lot of new faces. How long before this group clicks?'],
    quiet: ['A quiet summer for a rebuilding team. Fans want to know: what\'s the plan?', 'Nothing much happened this summer. Is that by design?', 'Where are you in the rebuild: year one, or year three?'],
    normal: ['How do you grade your offseason?', 'Better or worse than last year?', 'Was this summer a success?'],
  }[sit.mood], team.id, yr, 'moves');
  out.push({
    key: 'moves', pid: sit.star?.id, q,
    options: [{ v: 'believe', label: 'We believe in this group' }, { v: 'notdone', label: 'We\'re not done' }, { v: 'longterm', label: 'It\'s about the long term' }, { v: 'better', label: 'We have to be better' }],
    ctx: { mood: sit.mood },
  });
  // Who's asking: a different voice for each question, different every summer.
  for (const x of out) x.who = pickV(WHO, team.id, yr, x.key, 'who');
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
    const n0 = out.length;
    try {
    if (q.key === 'followup') {
      const label = q.options.find(o => o.v === a)?.label || '';
      out.push(a === 'clarify'
        ? { kind: 'presser-contract', score: 50, icon: '🎙️', title: `${Place(team)} clarifies`, text: `Pressed on it, the front office added: "${label}."`, pid: q.pid ?? null }
        : { kind: 'presser-contract', score: 50, icon: '🎙️', title: `${Place(team)} won't budge`, text: `Pressed again, the front office stuck to its answer: "${label}."`, pid: q.pid ?? null });
      continue;
    }
    const P = league.teams.flatMap(t => t.roster).find(x => x.id === q.pid);
    if (q.key === 'contract' && P) {
      const n = playerName(P);
      const fin = q.ctx.kind === 'final';
      const t = {
        commit: pickV([[`${Place(team)} wants ${n} long-term`, `"We want him here long-term," the front office said of ${P.fn}.${fin ? ' Now they have to get it done before he hits free agency.' : ' An extension looks like a matter of when.'}`],
          [`${P.fn} is part of the plan in ${place(team)}`, `The front office didn't hedge on ${n}: they want him around.${tr(P, 'loyalty') <= 5 ? ` Whether ${P.fn} wants the same is another question.` : ''}`]], team.id, 'c', a),
        focus: [`No extension talk for ${n}`, `The front office kept it to "our focus is on the season."${fin ? ` A contract year gives ${P.fn} plenty to play for.` : ''}`],
        market: pickV([[`${n}'s future in ${place(team)} is up in the air`, `"We'll see where things land." Not exactly a vote of confidence${fin ? `, with ${P.fn} a year from free agency` : ''}.`],
          [`Mixed signals on ${n}`, `The front office wouldn't commit to ${P.fn}. ${egoVal(P) >= 16 ? 'Someone with his ego will remember that.' : 'Expect his name in trade talks.'}`]], team.id, 'c', a),
      }[a];
      out.push({ kind: 'presser-contract', score: 58, icon: '🎙️', title: t[0], text: t[1], pid: P.id });
    }
    if (q.key === 'expect' && P) {
      const n = playerName(P);
      const arr = q.ctx.kind === 'arrival';
      const t = {
        star: pickV([[`${Place(team)} puts it on ${n}`, arr ? `"He's the centerpiece," the front office said of ${P.fn}. The expectations are sky high.` : `"He's the future of this team." ${P.fn} carries the hopes of ${place(team)}.`],
          [`It's ${P.fn}'s show now`, `${n} heard it straight from the front office: ${arr ? 'he\'s the centerpiece' : 'he\'s the future'}. ${egoVal(P) >= 16 ? 'He won\'t shy away from it.' : egoVal(P) <= 4 ? 'He\'d rather let his game do the talking.' : 'Now he has to live up to it.'}`]], team.id, 'e', a),
        fit: [`${n} is one of the group`, `The front office kept the pressure off ${P.fn}: ${arr ? 'a piece, not the whole puzzle' : 'minutes have to be earned'}.`],
        time: [`${Place(team)} will give ${n} time`, arr ? `"He needs time to settle in." Fans wanted a bigger statement on ${P.fn}.` : `No rush with ${P.fn}. Patience is the plan in ${place(team)}.`],
      }[a];
      out.push({ kind: 'presser-contract', score: 56, icon: '🎙️', title: t[0], text: t[1], pid: P.id });
    }
    if (q.key === 'lockerroom' && P) {
      const n = playerName(P), two = q.ctx?.n > 1;
      const t = {
        fine: [`${Place(team)} denies locker room trouble`, `"Everyone is on the same page." With ${two ? `${P.fn} and others` : P.fn} reportedly frustrated, not everyone in ${place(team)} sees it that way.`],
        handled: [`${Place(team)} says the air was cleared`, `"We handled it in-house." A players-only meeting reportedly cleared the air, for now.`],
        role: [`${Place(team)} promises ${P.fn} a bigger role`, `"Roles will be sorted out." ${n} wants to see it in the game plan, not hear it in the press room.`],
      }[a];
      out.push({ kind: 'presser-lockerroom', score: 62, icon: '🎙️', title: t[0], text: t[1], pid: P.id });
    }
    if (q.key === 'alphas' && P) {
      const B = league.teams.flatMap(t => t.roster).find(x => x.id === q.pid2);
      if (!B) continue;
      const t = {
        share: pickV([[`${Place(team)} bets on ${P.fn} and ${B.fn} sharing it`, `"They'll figure it out together." Two players who want the ball, one ball.`], [`One ball, two alphas in ${place(team)}`, `The front office says ${P.fn} and ${B.fn} will make it work. The first close loss will test that.`]], team.id, 'a', a),
        pecking: [`It's ${P.fn}'s team in ${place(team)}`, `The front office settled it: ${playerName(P)} is the man. ${B.fn} heard it too, and ${egoVal(B) >= 17 ? 'he didn\'t look happy about it' : 'he\'ll have to accept it'}.`],
        winning: [`"Winning fixes everything" in ${place(team)}`, `The front office punted on whose team it is. ${tr(P, 'winning') >= 15 && tr(B, 'winning') >= 15 ? `${P.fn} and ${B.fn} both want rings, so it might even be true.` : 'Until they lose a few.'}`],
      }[a];
      out.push({ kind: 'presser-lockerroom', score: 60, icon: '🎙️', title: t[0], text: t[1], pid: P.id });
    }
    if (q.key === 'injury' && P) {
      const t = {
        ready: [`${playerName(P)} is good to go`, `The front office says ${P.fn} is ready for opening night. ${tr(P, 'durability') <= 6 ? 'His history says to hold your breath.' : 'Fans will take it.'}`],
        ease: [`${Place(team)} will ease ${P.fn} back in`, `A minutes limit to start for ${playerName(P)}. The front office isn't rushing it.`],
        care: [`${Place(team)} plays it safe with ${P.fn}`, `"His long-term health comes first." Don't be surprised to see ${playerName(P)} sit the second night of back-to-backs.`],
      }[a];
      out.push({ kind: 'presser-contract', score: 55, icon: '🎙️', title: t[0], text: t[1], pid: P.id });
    }
    if (q.key === 'vet' && P) {
      const t = {
        more: [`${playerName(P)} has plenty left, says ${place(team)}`, `At ${P.age}, ${P.fn} isn't being eased out. The front office still sees a key piece.`],
        year: [`One year at a time for ${P.fn}`, `The front office won't put a timeline on ${playerName(P)}. ${P.age >= 36 ? 'The farewell tour talk can wait.' : 'He\'ll decide when he decides.'}`],
        mentor: [`${P.fn} the mentor`, `The front office sees ${playerName(P)} as a teacher now. ${egoVal(P) <= 8 || tr(P, 'lockerRoom') >= 14 ? 'He seems to like the sound of that.' : 'He might still think he\'s a starter.'}`],
      }[a];
      out.push({ kind: 'presser-contract', score: 54, icon: '🎙️', title: t[0], text: t[1], pid: P.id });
    }
    if (q.key === 'rookie' && P) {
      const t = {
        start: [`${playerName(P)} starts from day one`, `No easing in for the #${q.ctx.pk} pick. ${place(team)} hands ${P.fn} the keys right away.`],
        earn: [`${P.fn} will have to earn it`, `The #${q.ctx.pk} pick gets no promises from the front office. Camp decides.`],
        patience: [`${Place(team)} takes it slow with ${P.fn}`, `The #${q.ctx.pk} pick will be brought along slowly. ${egoVal(P) >= 13 ? `${P.fn} expected more.` : 'He seems fine with it.'}`],
      }[a];
      out.push({ kind: 'presser-contract', score: 56, icon: '🎙️', title: t[0], text: t[1], pid: P.id });
    }
    if (q.key === 'holdout' && P) {
      const t = {
        pay: [`${Place(team)} wants to end the ${P.fn} holdout`, `"We'll get something done." The ball is in the front office's court now, and ${P.fn}'s agent knows it.`],
        stand: [`${Place(team)} won't blink on ${P.fn}`, `"He's under contract." The front office is calling ${playerName(P)}'s bluff.`],
        shop: [`${playerName(P)} is available`, `"Everything's on the table." The holdout just turned into a trade market.`],
      }[a];
      out.push({ kind: 'presser-lockerroom', score: 64, icon: '🎙️', title: t[0], text: t[1], pid: P.id });
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
      }[q.ctx.mood][a] || [`"We have to be better" in ${place(team)}`, pickV([`No spin from the front office: last season wasn't good enough. The competitors in the room will like hearing it.`, `A blunt answer. ${sn === 'the stars' ? 'The locker room' : sn} heard the message.`], team.id, 'm', a)];
      out.push({ kind: 'presser-moves', score: sit.mood === 'normal' ? 46 : 60, icon: '🎙️', title: T[0], text: T[1], pid: s?.id ?? null });
    }
    } finally {
      // The player gets the last word on the story about him.
      const st = out.length > n0 ? out[out.length - 1] : null, r = st ? playerReplies(league, team, q, a)[0] : null;
      if (st && r) st.text += ` ${r.name}: "${r.text}"`;
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

// ---- Players answer back
// After the press conference the players you talked about get a word in, in their own voice: ego, loyalty, money,
// winning and the locker room decide how. [{ pid, text }].
export function playerReplies(league, team, q, a) {
  const all = league.teams.flatMap(t => t.roster);
  const P = all.find(x => x.id === q.pid), B = all.find(x => x.id === q.pid2);
  const ego = p => egoVal(p), out = [];
  const say = (p, text) => { if (p && text) out.push({ pid: p.id, name: p.fn, text }); };
  const by = (p, cases, dflt) => (cases.find(([ok]) => ok(p)) || [null, dflt])[1];
  if (q.key === 'followup') say(P, a === 'clarify' ? by(P, [[p => ego(p) >= 16, 'About time.']], 'That\'s what I needed to hear.') : by(P, [[p => ego(p) >= 16, 'Noted.']], 'It is what it is.'));
  if (q.key === 'holdout') say(P, {
    pay: by(P, [[p => ego(p) >= 16, 'Then pay me.']], 'That\'s all I\'m asking for.'),
    stand: by(P, [[p => ego(p) >= 16, 'Under contract. Not under their control.'], [p => tr(p, 'loyalty') >= 13, 'I hear them. I just want to be paid fairly.']], 'We\'ll see who blinks.'),
    shop: by(P, [[p => tr(p, 'loyalty') >= 14, 'After everything? Wow.']], 'Good. Let\'s move on.'),
  }[a]);
  if (q.key === 'contract') say(P, {
    commit: by(P, [[p => ego(p) >= 16, 'Good. I want to be here, and I want to be paid like it.'], [p => tr(p, 'loyalty') >= 16, 'This is home. I\'m not going anywhere.'], [p => tr(p, 'money') >= 16, 'Words are nice. We\'ll see what the offer looks like.']], 'Love hearing that. Let\'s get it done.'),
    focus: by(P, [[p => ego(p) >= 16, 'Focus on the season? I\'m focused on my future too.'], [p => tr(p, 'loyalty') >= 15, 'I trust the front office. We\'ll talk when it\'s time.']], 'It\'s business. I\'ll play my game.'),
    market: by(P, [[p => ego(p) >= 16, 'I heard it. Everybody heard it.'], [p => tr(p, 'loyalty') >= 15, 'That one hurt, honestly.'], [p => ego(p) <= 4, 'Whatever happens, happens.']], 'Guess we\'ll see, then.'),
  }[a]);
  if (q.key === 'expect') say(P, {
    star: by(P, [[p => ego(p) >= 16, 'I\'ve been ready for this my whole life.'], [p => ego(p) <= 4, 'I just want to help us win. The spotlight isn\'t my thing.']], 'I\'ll embrace it.'),
    fit: by(P, [[p => ego(p) >= 16, 'Fit in? I came here to lead.']], 'Whatever the team needs.'),
    time: by(P, [[p => ego(p) >= 13, 'I don\'t need time. Put me out there.']], 'One day at a time.'),
  }[a]);
  if (q.key === 'battle' && P && B && a !== 'open') {
    const [w, l] = a === 'b' ? [B, P] : [P, B];
    say(w, by(w, [[p => ego(p) >= 16, 'Never doubted it.']], 'I\'ll earn it every night.'));
    say(l, by(l, [[p => ego(p) >= 16, 'I\'m a starter in this league. Period.'], [p => ego(p) <= 6, 'Whatever helps us win.']], 'I\'ll be ready when my name is called.'));
  }
  if (q.key === 'battle' && a === 'open' && P) say(P, 'Good. Competition makes everybody better.');
  if (q.key === 'lockerroom') say(P, {
    fine: by(P, [[p => tr(p, 'lockerRoom') <= 6, 'Same page? Ask the coaches.']], 'We\'re good. Family business.'),
    handled: 'We talked it out. Moving on.',
    role: by(P, [[p => ego(p) >= 16, 'Now we\'re talking.']], 'I just want to know where I fit.'),
  }[a]);
  if (q.key === 'alphas' && P && B) {
    if (a === 'pecking') { say(P, 'It\'s always been my team.'); say(B, by(B, [[p => ego(p) >= 17, 'Nobody told me.']], 'If that\'s what wins, fine.')); }
    if (a === 'share') for (const x of [P, B]) say(x, by(x, [[p => tr(p, 'winning') >= 15, 'Ball moves, we win.']], 'We\'ll see how that works.'));
    if (a === 'winning') for (const x of [P, B]) if (tr(x, 'winning') >= 15) say(x, 'That\'s all I care about.');
  }
  if (q.key === 'injury') say(P, {
    ready: by(P, [[p => tr(p, 'motor') >= 15, 'I\'ve been ready for weeks.'], [p => tr(p, 'durability') <= 6, 'I feel good. For now.']], 'Ready to go.'),
    ease: 'Smart. I want to be right for the playoffs.',
    care: by(P, [[p => tr(p, 'motor') >= 15, 'I hate sitting. But I get it.']], 'My body will thank them.'),
  }[a]);
  if (q.key === 'vet') say(P, {
    more: 'I\'ve still got it. Watch.',
    year: 'I\'ll know when it\'s time.',
    mentor: by(P, [[p => ego(p) <= 8 || tr(p, 'lockerRoom') >= 14, 'Passing it on is part of the job.']], 'Mentor? I\'m still a starter.'),
  }[a]);
  if (q.key === 'rookie') say(P, {
    start: by(P, [[p => ego(p) >= 13, 'I\'m ready.']], 'I\'ll do everything I can to deserve it.'),
    earn: 'Then I\'ll earn it.',
    patience: by(P, [[p => ego(p) >= 13, 'I\'m ready now, but okay.']], 'I\'m in no rush.'),
  }[a]);
  if (q.key === 'goal' && P) say(P, {
    title: by(P, [[p => tr(p, 'winning') >= 15, 'That\'s the only goal.']], 'Let\'s go get it.'),
    playoffs: by(P, [[p => tr(p, 'winning') >= 15, 'Make the playoffs? I\'m here to win it all.']], ''),
    develop: by(P, [[p => p.age >= 28, 'I\'m not here to develop.']], ''),
  }[a]);
  if (q.key === 'moves' && P) say(P, {
    believe: by(P, [[p => ego(p) >= 16 && q.ctx?.mood === 'unsupported', 'Believe in this group? I believe I need help.']], 'We\'ve got what we need.'),
    notdone: by(P, [[p => ego(p) >= 16, 'Good. We need help.']], ''),
    longterm: by(P, [[p => p.age >= 29, 'I don\'t have long-term.']], ''),
    better: by(P, [[p => tr(p, 'lockerRoom') <= 6, 'Better starts upstairs.'], [p => tr(p, 'winning') >= 15, 'He\'s right. We have to be better.']], ''),
  }[a]);
  return out;
}
