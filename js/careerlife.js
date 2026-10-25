// Career mode, the life around the games: contract talks, the power a star earns, the press, the feed, rivalries,
// summers, mentors, goals, endorsements, the Hall of Fame chase and the last chapter. Pure reads and plans here; the
// app applies them to the save.
import { playerName, ATTRS, ATTR_MAX } from './savefile.js';
import { shownLevel as levelOf } from './regression.js';
import { tr } from './traits.js';
import { egoVal } from './ego.js';
import { seasonLine } from './storylines.js';
import * as FA from './freeagency.js';
import { cityOf } from './destination.js';
import { RANKS, rankIdx, trophies, careerLog } from './career.js';

const pick = (r, list) => list[Math.floor(r * list.length) % list.length];
const coachOf = team => (team?.frontOffice?.staff || []).find(s => s.pos === 1) || null;
const lastLine = p => { const l = careerLog(p); return l[l.length - 1] || null; };

// ---------------------------------------------------------------------------
// 1. Extension talks: in the last two years of his deal, his team can extend him. All-NBA (or the Rose rule) puts
// the supermax on the table.
export function extensionTalks(L, p, team) {
  const c = p.contract || {};
  if (!team || p.status !== 3 || !c.yrs || c.yrs > 2 || c.ext?.yrs > 0) return null;
  const ask = FA.baseAsk(L, p), max = FA.maxSalary(L, p, false, c.yrs), superMax = FA.maxSalary(L, p, true, c.yrs);
  const lv = levelOf(p), keen = lv >= 85 || (p.age <= 24 && p.pot >= 9) ? 1 : lv >= 78 ? 0.92 : 0.82;
  const sal = Math.max(FA.minFor(p), Math.min(max, Math.round(ask * keen)));
  const yrs = p.age <= 27 ? 4 : p.age <= 31 ? 3 : 2;
  return { sal, yrs, ask, max, superMax, superOk: superMax > max, label: FA.maxLabel(L, p) };
}

// ---------------------------------------------------------------------------
// 2. Player empowerment: an All Star or better can push his team to go get a player. Free agents only (a signing the
// app can make): friends first, then the best on the market.
export const EMPOWER_RANK = 4;
export function recruitTargets(L, p, team) {
  if (!team || rankIdx(p) < EMPOWER_RANK) return [];
  const pool = FA.marketPlayers(L).map(m => m.p).filter(x => x.id !== p.id && !team.roster.includes(x));
  return pool.map(x => ({ x, bond: x.season?.relationship || 0, lv: levelOf(x) }))
    .filter(e => e.lv >= 72 || e.bond >= 20)
    .sort((a, b) => (b.bond >= 20) - (a.bond >= 20) || b.lv - a.lv).slice(0, 6);
}
// His pull: rank, the coach's ear, his fans, and how close he is with the target.
export function recruitOdds(L, p, team, target) {
  const c = coachOf(team), fans = L.career?.fans || 0;
  return Math.max(0.1, Math.min(0.85, 0.2 + (rankIdx(p) - 3) * 0.08 + (c?.rp || 0) / 200 + Math.min(0.1, fans / 100000) + (target.season?.relationship || 0) / 120));
}

// ---------------------------------------------------------------------------
// 3. The coach: a franchise player at war with his coach (bond -15 or worse) can go over his head.
export function coachRift(L, p, team, standingRank) {
  const c = coachOf(team);
  if (!c || (c.rp || 0) > -15) return null;
  const power = standingRank === 1 && rankIdx(p) >= 3;
  return { coach: c, power, odds: power ? Math.max(0.15, Math.min(0.75, 0.3 + (rankIdx(p) - 3) * 0.1 + (-(c.rp || 0) - 15) / 100)) : 0 };
}
// Who'd replace him: the best coach in the free pool.
export const bestPoolCoach = L => [...(L.coaches || [])].filter(c => c.attributes).sort((a, b) => sumAttrs(b) - sumAttrs(a))[0] || null;
const sumAttrs = c => Object.values(c.attributes || {}).reduce((s, v) => s + (v?.[0] || 0), 0);

// ---------------------------------------------------------------------------
// 4. Media Day: three questions about him, each with three answers. fx: { fans (share), ego, coach, morale,
// bond: [pid, n], mates (bond with every teammate) }.
export function mediaQuestions(L, p, team, ctx) {
  const r = n => ((Math.imul(p.id + n, 2654435761) ^ L.season.currentYear) >>> 0) % 1000 / 1000;
  const qs = [];
  const t = team?.shortName || 'the team', c = coachOf(team), cn = c ? c.ln : 'the coach';
  if (ctx.newTeam) qs.push({ k: 'new', q: pick(r(1), [`Why ${t}?`, `What sold you on ${t}?`, `First year in ${t}. What do you bring?`]), a: [
    { t: 'This is where I can win. That\'s all I care about.', fx: { fans: 0.02, coach: 2 } },
    { t: 'They made me the guy. I\'m here to run it.', fx: { fans: 0.04, ego: 1, mates: -2 } },
    { t: 'Honestly? The money was right.', fx: { fans: -0.02, morale: 2 } }] });
  if (ctx.rival) qs.push({ k: 'rival', who: ctx.rival.id, q: pick(r(2), [`What's the deal between you and ${playerName(ctx.rival)}?`, `${ctx.rival.ln} had some words about you this summer. Your response?`]), a: [
    { t: 'Nothing. Respect to him.', fx: { bond: [ctx.rival.id, 8], fans: -0.01 } },
    { t: 'He knows what it is. We\'ll see on the court.', fx: { bond: [ctx.rival.id, -4], fans: 0.03 } },
    { t: 'Who? Next question.', fx: { bond: [ctx.rival.id, -10], fans: 0.05, ego: 1 } }] });
  if (ctx.alpha) qs.push({ k: 'alpha', who: ctx.alpha.id, q: `Can you and ${playerName(ctx.alpha)} coexist?`, a: [
    { t: 'Easily. He\'s the best player I\'ve played with.', fx: { bond: [ctx.alpha.id, 8], ego: -1 } },
    { t: 'We\'ll figure it out. Winning fixes everything.', fx: { bond: [ctx.alpha.id, 2] } },
    { t: 'It\'s my team. He knows that.', fx: { bond: [ctx.alpha.id, -10], ego: 1, fans: 0.03, coach: -3 } }] });
  if (ctx.contractYear) qs.push({ k: 'contract', q: 'It\'s a contract year. Are you thinking about free agency?', a: [
    { t: 'I want to be here long term. Simple as that.', fx: { coach: 3, fans: 0.02 } },
    { t: 'I\'m focused on the season. My agent handles the rest.', fx: {} },
    { t: 'I\'m going to get paid. Here or somewhere else.', fx: { coach: -4, fans: 0.02, ego: 1 } }] });
  qs.push({ k: 'goal', q: pick(r(3), ['What\'s the goal this season?', 'What does a good year look like for you?', 'Where does this team finish?']), a: [
    { t: 'A ring. Nothing else counts.', fx: { fans: 0.03, mates: 2 } },
    { t: 'Get better every night and let the results come.', fx: { coach: 3 } },
    { t: 'MVP. I\'m saying it out loud.', fx: { fans: 0.05, ego: 1 } }] });
  qs.push({ k: 'coach', q: pick(r(4), [`How's your relationship with ${cn}?`, `Is ${cn} the right coach for this group?`]), a: [
    { t: `${cn} gets the best out of me. I trust him.`, fx: { coach: 5 } },
    { t: 'We\'re professionals. We\'ll make it work.', fx: { coach: 0 } },
    { t: 'I think we all need to be better. Him included.', fx: { coach: -8, fans: 0.02, ego: 1 } }] });
  if (ctx.lastPpg >= 20) qs.push({ k: 'star', q: `You put up ${ctx.lastPpg.toFixed(1)} a night last year. Are you a top-10 player?`, a: [
    { t: 'Top five. And I\'m not done.', fx: { fans: 0.04, ego: 1 } },
    { t: 'That\'s for you all to decide. I just hoop.', fx: { fans: 0.01 } },
    { t: 'Numbers don\'t matter if we don\'t win.', fx: { coach: 3, mates: 2, ego: -1 } }] });
  // Three, the situational ones first.
  const order = ['new', 'rival', 'alpha', 'contract', 'star', 'coach', 'goal'];
  return qs.sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)).slice(0, 3);
}

// ---------------------------------------------------------------------------
// 5. Hoop Gram posts he can make (once an offseason), and what they do.
export const POSTS = {
  hype: { icon: '📸', label: 'Workout clip', text: 'Locked in. Different this year. 🔒', fx: { fans: 0.05 } },
  callout: { icon: '👀', label: 'Call out a rival', text: 'Some of y\'all talk a lot for somebody I cooked. 🍳', fx: { fans: 0.08, ego: 1 } },
  thanks: { icon: '🙏', label: 'Thank the fans', text: 'None of this happens without y\'all. Love. ❤️', fx: { fans: 0.03, morale: 6 } },
  team: { icon: '🤝', label: 'Hype the squad', text: 'This group different. Watch. 💯', fx: { fans: 0.02, mates: 4 } },
};

// ---------------------------------------------------------------------------
// 6. Rivalries: last season's playoff exits and honors. [{ m, d, why }]
export function rivalryDrift(L, p, team, yr) {
  const out = [];
  const po = (L.season.playoffs || []).find(x => x.yr === yr);
  const myTid = lastLine(p)?.l?.tid ?? team?.id;
  if (po && myTid != null) {
    for (const rd of po.rounds || []) for (const s of rd.series || []) {
      const ids = [s.topSeed, s.lowerSeed];
      if (!ids.includes(myTid) || s.winner == null || s.winner < 0) continue;
      const other = ids.find(x => x !== myTid), won = s.winner === myTid;
      const t = L.teams.find(x => x.id === other);
      // Their best two players take it personally.
      for (const m of (t?.roster || []).filter(x => x.status === 3).sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 2)) {
        out.push({ m, d: won ? -5 : -3, why: won ? `you knocked ${t.shortName} out of the playoffs` : `${t.shortName} sent you home` });
      }
    }
  }
  return out;
}
// Enemies: the bad blood worth a headline.
export const enemies = (L, p) => L.teams.flatMap(t => t.roster).filter(m => m.id !== p.id && (m.season?.relationship || 0) <= -40);

// ---------------------------------------------------------------------------
// 7. His draft class, ranked (by trade value from the app).
export function draftClass(L, p, val) {
  const yr = p.history?.draft?.yr;
  if (!yr) return [];
  return L.teams.flatMap(t => t.roster.map(m => ({ m, t }))).filter(e => e.m.history?.draft?.yr === yr && e.m.history?.draft?.rd > 0 || e.m.id === p.id)
    .map(e => ({ ...e, v: val(e.m), lv: levelOf(e.m), pk: e.m.history?.draft?.pk || 0, rd: e.m.history?.draft?.rd || 0 }))
    .sort((a, b) => b.v - a.v);
}

// ---------------------------------------------------------------------------
// 8. Summer programs: one a summer.
export const SUMMERS = {
  legend: { icon: '🐐', label: 'Train with a legend', cost: 200, says: '+2 skill points where you have the most room. 200 coins.' },
  strength: { icon: '🏋️', label: 'Strength program', cost: 0, says: 'Durability +1 and a point of strength. You lose a little quickness work.' },
  national: { icon: '🌎', label: 'National team', cost: 0, says: 'Fans and fame, bonds with the stars from your country. A small injury risk.' },
  rest: { icon: '🏝️', label: 'Rest and recover', cost: 0, says: 'Morale +10 and full conditioning. No growth.' },
};
// The skills with the most room to grow (ceiling minus current).
export const roomiest = (p, n) => ATTRS.filter(k => p.attributes?.[k] && p.attributes[k][0] < Math.min(ATTR_MAX, p.attributes[k][1]))
  .sort((a, b) => (p.attributes[b][1] - p.attributes[b][0]) - (p.attributes[a][1] - p.attributes[a][0])).slice(0, n);
// Stars from his country (national team mates).
export const countrymen = (L, p) => L.teams.flatMap(t => t.roster).filter(m => m.id !== p.id && m.ctry === p.ctry && m.status === 3 && levelOf(m) >= 85).sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 4);

// ---------------------------------------------------------------------------
// 9. Mentors: a young player learns from a vet teammate; a vet takes a young one under his wing.
export function mentorOptions(L, p, team) {
  if (!team) return { role: null, list: [] };
  const mates = team.roster.filter(x => x.id !== p.id && x.status === 3);
  if (p.age <= 25) return { role: 'learn', list: mates.filter(m => m.age >= 29 && (tr(m, 'lockerRoom') >= 12 || tr(m, 'motor') >= 14 || tr(m, 'roadWarrior') >= 14)).sort((a, b) => levelOf(b) - levelOf(a)).slice(0, 3) };
  if (p.age >= 29) return { role: 'teach', list: mates.filter(m => m.age <= 23).sort((a, b) => b.pot - a.pot || levelOf(b) - levelOf(a)).slice(0, 3) };
  return { role: null, list: [] };
}
// What a mentor passes on: his strongest trait the learner trails him in.
export function mentorLesson(from, to) {
  const keys = ['motor', 'lockerRoom', 'roadWarrior', 'winning'].filter(k => tr(from, k) >= 13 && tr(to, k) <= tr(from, k) - 2);
  return keys.sort((a, b) => tr(from, b) - tr(from, a))[0] || 'lockerRoom';
}

// ---------------------------------------------------------------------------
// 10. Season goals: pick two at Media Day, settled the next offseason. check(line, ctx) → true/false.
export const GOALS = {
  ppg25: { label: 'Average 25 points', pts: 30, check: (l) => l && l.ppg >= 25 },
  ppg20: { label: 'Average 20 points', pts: 15, check: (l) => l && l.ppg >= 20 },
  allstar: { label: 'Make the All-Star team', pts: 30, check: (l, c) => c.allStar },
  allnba: { label: 'Make an All-NBA team', pts: 40, check: (l, c) => c.allNba },
  playoffs: { label: 'Make the playoffs', pts: 15, check: (l, c) => c.playoffs },
  title: { label: 'Win the title', pts: 60, check: (l, c) => c.ring },
  ironman: { label: 'Play 75+ games', pts: 10, check: (l) => l && l.gp >= 75 },
  apg8: { label: 'Average 8 assists', pts: 25, check: (l) => l && l.apg >= 8 },
  rpg10: { label: 'Average 10 rebounds', pts: 25, check: (l) => l && l.rpg >= 10 },
};
export function goalContext(L, p, yr) {
  const has = id => (p.awards || []).some(a => a.id === id && (a.league ?? 0) === 0 && (a.yearsWon || []).includes(yr));
  const tid = seasonLine(p, 0, yr)?.tid;
  const po = (L.season.playoffs || []).find(x => x.yr === yr);
  const playoffs = !!po && (po.rounds?.[0]?.series || []).some(s => s.topSeed === tid || s.lowerSeed === tid);
  return { allStar: has(101), allNba: has(13), ring: has(0), playoffs };
}

// ---------------------------------------------------------------------------
// 11. Endorsements: brands call when he's famous enough, more in a big market. { k, brand, coins, yrs, fans }
const BRANDS = [['shoe', '👟', ['Stride', 'Apex', 'Vanta']], ['drink', '🥤', ['Bolt', 'Surge', 'Peak']], ['car', '🚗', ['Meridian', 'Kodiak']], ['game', '🎮', ['Hoop Land', 'Courtside']], ['food', '🍔', ['Big Bite', 'Sauce Co.']]];
export function endorsementOffers(L, p, team, rnd, held = []) {
  const r = rankIdx(p), fans = L.career?.fans || 0, market = cityOf(team)?.[2] ?? 0.5;
  const pull = r * 0.6 + Math.min(3, fans / 4000) + market * 1.5;
  if (pull < 2) return [];
  const n = Math.min(3, Math.floor(pull / 2));
  return BRANDS.filter(([k]) => !held.includes(k)).map(([k, icon, names], i) => ({ k, icon, brand: names[Math.floor(rnd(i) * names.length)], i }))
    .sort((a, b) => rnd(a.i + 10) - rnd(b.i + 10)).slice(0, n)
    .map(o => ({ ...o, coins: Math.round((40 + pull * 25) * (o.k === 'shoe' ? 1.6 : 1) / 5) * 5, yrs: 2 + Math.floor(rnd(o.i + 20) * 3), fans: o.k === 'shoe' ? 0.06 : 0.03,
      signature: o.k === 'shoe' && r >= 5 }));
}

// ---------------------------------------------------------------------------
// 12. Hall of Fame: his career against the league's Hall of Famers (their awards), and the pace he's on.
export function hofTrack(L, p) {
  const hof = (L.hallOfFame || []).filter(h => (h.awards || []).length);
  const me = trophies(p);
  // The average Hall of Famer (older ones carry no All-Star selections in the save, so a category nobody has is skipped).
  const avg = k => Math.round(hof.reduce((s, h) => s + trophies(h)[k], 0) / Math.max(1, hof.length) * 10) / 10;
  const bar = { allStar: avg('allStar'), allNba: avg('allNba'), rings: avg('rings'), mvp: avg('mvp') };
  const yrs = careerLog(p).filter(x => x.l.gp >= 20).length || 1;
  const left = Math.max(0, (p.regressionAge || 33) + 3 - p.age);
  const pace = k => me[k] + (me[k] / yrs) * left;
  const keys = ['allStar', 'allNba', 'rings'].filter(k => bar[k] > 0);
  const score = keys.reduce((s, k) => s + Math.min(1.5, pace(k) / bar[k]), 0) / Math.max(1, keys.length) + (me.mvp ? 0.25 : 0);
  return { me, bar, n: hof.length, score, word: score >= 1 ? 'On a Hall of Fame pace' : score >= 0.7 ? 'Borderline: a few big years from it' : score >= 0.4 ? 'A long way to go' : 'A long shot for now', left };
}

// ---------------------------------------------------------------------------
// 13. Rank-up moments: what each new rank means.
export const RANK_MOMENTS = {
  3: 'He\'s a star now. The coaches build the second unit around him.',
  4: 'An All Star. The league knows his name.',
  5: 'A superstar. Brands, magazine covers, and every defense keyed on him.',
  6: 'A Hall of Famer, with years still left to play.',
  7: 'A legend. The kind of player kids pretend to be.',
  8: 'The greatest of all time. The debate is over.',
};
export const rankName = i => RANKS[i] || '';

// ---------------------------------------------------------------------------
// 14. The final chapter: past his regression age (or 33+), how he wants it to end.
export const finalChapterOpen = p => p.age >= 33 || p.age >= (p.regressionAge || 33);
export const CHAPTERS = {
  ring: { icon: '💍', label: 'Chase a ring', says: 'Your agent only takes calls from contenders, and you take less to get there.' },
  mentor: { icon: '🎓', label: 'Be the vet', says: 'Take a smaller role, lead the room. Ego down, locker room up.' },
  farewell: { icon: '👋', label: 'Farewell tour', says: 'Announce this season is your last. Every arena says goodbye.' },
};
