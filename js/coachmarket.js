// The coaching market: how well a coach fits a roster, whether he will sign or
// extend, and when a CPU team sticks with, extends or replaces its head coach.

import { teamStatus, teamRecord } from './draft.js';
import { shownLevel } from './regression.js';
import * as FA from './freeagency.js';
import { coachLevel, coachCeiling, askingContract, careerOf, securityOf } from './coachprofile.js';
import { planOption } from './coaching.js';

export const headCoachOf = team => (team?.frontOffice?.staff || []).find(s => s.pos === 1) || null;

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Roster profile: what the rotation is built to do.

export function rosterProfile(team) {
  const top = [...team.roster].filter(p => p.status !== 4).sort((a, b) => shownLevel(b) - shownLevel(a)).slice(0, 8);
  const att = k => mean(top.map(p => p.attributes?.[k]?.[0] ?? 0));
  const lv = top.map(shownLevel);
  return {
    level: mean(lv), star: lv[0] || 0, top3: mean(lv.slice(0, 3)), depth: lv[lv.length - 1] || 0,
    age: mean(top.map(p => p.age)), young: top.filter(p => p.age <= 24).length / Math.max(1, top.length),
    bigs: top.filter(p => p.pos >= 6).length,
    tpt: att('TPT'), mid: att('MID'), ins: att('INS'), lay: mean([att('LAY'), att('DNK')]), pas: att('PAS'),
    spd: att('SPD'), str: att('STR'), ore: att('ORE'), blk: att('BLK'), stl: att('STL'), dre: att('DRE'),
  };
}
const profiles = league => new Map(league.teams.map(t => [t.id, rosterProfile(t)]));
const pctOf = (map, k, v) => { const all = [...map.values()]; return all.filter(x => x[k] < v).length / Math.max(1, all.length - 1); };

// How well his scheme and strengths suit this roster, 0 to 1, with the reasons.
export function schemeFit(coach, team, league, map = profiles(league)) {
  const P = map.get(team.id) || rosterProfile(team), t = coach.tendencies || {};
  const parts = [], why = [];
  const add = (v, good, bad) => { parts.push(v); if (v >= 0.7) why.push(good); else if (v <= 0.3) why.push(bad); };
  const pc = k => pctOf(map, k, P[k]);
  const of = planOption('offFocus', t.offFocus ?? 0);
  if (of === 'Inside') add((pc('ins') + pc('lay')) / 2, 'inside scorers suit his post-heavy offense', 'too few inside scorers for his offense');
  if (of === 'Midrange') add(pc('mid'), 'mid-range shooters suit his offense', 'too few mid-range shooters for his offense');
  if (of === 'Outside') add(pc('tpt'), 'shooters suit his three-point offense', 'too few shooters for his three-point offense');
  if (t.offTempo === 1) add(pc('spd'), 'the roster has the speed to push the pace', 'the roster is too slow for his pace');
  const orb = planOption('offRebounding', t.offRebounding ?? 0);
  if (orb === 'Crash Boards') add(pc('ore'), 'offensive rebounders suit his glass-crashing', 'no real offensive rebounders for his style');
  const df = planOption('defFocus', t.defFocus ?? 0);
  if (df === 'Interior') add((pc('blk') + pc('dre')) / 2, 'rim protectors suit his interior defense', 'no rim protection for his interior defense');
  if (df === 'Perimeter') add((pc('stl') + pc('spd')) / 2, 'quick defenders suit his perimeter defense', 'too slow for his perimeter defense');
  if (planOption('defAggression', t.defAggression ?? 0) === 'Physical') add(pc('str'), 'the roster is strong enough to play physical', 'not strong enough to play physical');
  const bd = planOption('benchDepth', t.benchDepth ?? 0);
  if (bd === 'Deep') add(pc('depth'), 'a deep bench fits his rotation', 'too thin for his deep rotation');
  if (bd === 'Short') add(pc('top3'), 'top-heavy talent fits his short rotation', 'not enough top-end talent for a short rotation');
  let fit = parts.length ? mean(parts) : 0.55;
  const s = [coach.pri, coach.sec];
  if (s[0] === 0 || s[1] === 0) { const b = (P.young - 0.35) * 0.3; fit += b; if (b > 0.04) why.push('a young group he can develop'); }
  if (s[0] === 2 || s[1] === 2) { const b = (P.age - 26) * 0.01; fit += b; if (b > 0.04) why.push('veterans who follow his leadership'); }
  return { fit: clamp(fit, 0, 1), why: why.slice(0, 3) };
}

// ---------------------------------------------------------------------------
// What a coach is worth to a team, by where the team is headed.

const WEIGHTS = { contending: [0.6, 0.1, 0.3], developing: [0.4, 0.3, 0.3], rebuilding: [0.25, 0.45, 0.3] };
export function coachValue(coach, team, league, map = profiles(league)) {
  const st = teamStatus(league, team), [wn, wc, wf] = WEIGHTS[st] || WEIGHTS.developing;
  const now = coachLevel(coach) / 10, ceil = coachCeiling(coach) / 10;
  const room = Math.max(0, ceil - now) * (coach.age >= 62 ? 0.4 : coach.age >= 56 ? 0.7 : coach.age <= 45 ? 1.15 : 1);
  return wn * now + wc * (now + room) + wf * schemeFit(coach, team, league, map).fit;
}

// ---------------------------------------------------------------------------
// Reputation: how a team's coaching spend looks from outside. A head coach paid
// far under the market reads as penny-pinching (free agents and coaches notice);
// paying up reads as a team that invests.

export function coachReputation(league, team) {
  const c = headCoachOf(team);
  if (!c || !c.contract?.sal) return { score: 0, tag: '', note: '' };
  const mkt = marketSalary(c, league), pay = c.contract.sal, ratio = pay / Math.max(1, mkt);
  const score = clamp((ratio - 0.9) * 0.8, -0.5, 0.4);
  if (ratio <= 0.55) return { score, tag: 'Penny-Pinching', note: `Pays his head coach $${pay}M against a market of about $${mkt}M. Free agents and coaches notice.` };
  if (ratio >= 1.3) return { score, tag: 'Invests in Coaching', note: `Pays his head coach $${pay}M against a market of about $${mkt}M, and it helps in free agency.` };
  return { score, tag: '', note: '' };
}
// Free agents' view of the team: up to a small bonus, or a larger penalty.
FA.setCoachFx((league, team) => coachReputation(league, team).score * 0.1);

// ---------------------------------------------------------------------------
// Will he sign? Offer = { yrs, sal }. A score of 60 or more says yes.

export function marketSalary(coach, league) {
  const field = league.teams.map(headCoachOf).filter(Boolean);
  return askingContract(coach, field).sal;
}
export function coachWillingness(league, team, coach, offer, map = profiles(league)) {
  const st = teamStatus(league, team), P = map.get(team.id) || rosterProfile(team), f = [];
  const add = (label, val, note) => f.push({ label, val: Math.round(val), note });
  const mkt = marketSalary(coach, league);
  add('Pay', clamp((offer.sal / mkt - 1) * 45, -20, 20), `$${offer.sal}M against about $${mkt}M on the market`);
  const lvl = coachLevel(coach), pref = coach.age >= 58 ? 2 : coach.age >= 50 ? 3 : lvl >= 7 ? 5 : 4;
  add('Length', -Math.min(9, Math.abs(offer.yrs - pref) * 3), `${offer.yrs} year${offer.yrs > 1 ? 's' : ''}; he wants about ${pref}`);
  const dev = coach.pri === 0 || coach.sec === 0;
  if (st === 'contending') add('Direction', lvl >= 4 ? 6 : 2, 'a contender');
  else if (st === 'rebuilding') add('Direction', dev ? 6 : lvl >= 6 ? -7 : -2, dev ? 'a rebuild he can develop' : 'a rebuild');
  else add('Direction', dev ? 5 : 2, 'a developing team');
  const talent = pctOf(map, 'level', P.level);
  add('Roster', (talent - 0.5) * 20, talent >= 0.65 ? 'a talented roster' : talent <= 0.35 ? 'a thin roster' : 'an average roster');
  if (FA.capSystemOn()) {
    const room = FA.capLines(league).cap - FA.payroll(team);
    add('Cap space', room >= 15 ? 5 : room >= 0 ? 1 : -4, room >= 0 ? `$${Math.round(room)}M under the cap` : `$${Math.round(-room)}M over the cap`);
  }
  const firsts = team.draftPicks.filter(pk => pk.rd === 1 && pk.yr >= league.season.currentYear).length;
  const prospects = team.roster.filter(p => p.pot >= 8 && p.age <= 24).length;
  add('Assets', clamp(firsts * 1.2 + prospects * 1.5 - 2, -2, 6), `${firsts} first-rounders, ${prospects} young prospects`);
  const fit = schemeFit(coach, team, league, map);
  add('Fit', (fit.fit - 0.5) * 26, fit.why[0] || 'a neutral fit with his scheme');
  const rep = coachReputation(league, team);
  if (rep.tag) add('Reputation', rep.score * 14, rep.tag === 'Penny-Pinching' ? 'a team that pinches pennies on coaches' : 'a team that invests in coaching');
  const score = 50 + f.reduce((a, x) => a + x.val, 0);
  return { score: Math.round(score), accept: score >= 60, factors: f, fit };
}

// ---------------------------------------------------------------------------
// CPU decisions

// How hard the team is pressed to act: underperformance against what the
// roster should win, a hot-seat tag and a long losing streak, eased by a long
// contract and a rebuild.
export function pressureOn(league, team, coach, map = profiles(league)) {
  const P = map.get(team.id) || rosterProfile(team), car = careerOf(coach), sec = securityOf(coach, car);
  const rec = teamRecord(team), actual = rec.W + rec.L ? rec.pct : 0.5;
  const expected = 0.28 + 0.44 * pctOf(map, 'level', P.level);
  const gap = actual - expected;
  const recent = car.rows.slice(-3), mediocre = recent.length >= 3 && recent.every(r => r.W / (r.W + r.L) < 0.5);
  let p = clamp(-gap * 4, -0.4, 1);
  if (sec.tag === 'Hot Seat') p += 0.25;
  if (actual < 0.3) p += 0.2;
  if (mediocre) p += 0.15;
  if (sec.yrs >= 3) p -= 0.25; else if (sec.yrs === 2) p -= 0.1;
  // A cheap coach is hard to let go: a deal well under the market is a saving, and
  // a team already over the tax line has even more reason to keep it.
  const mkt = marketSalary(coach, league), pay = coach.contract?.sal || 0;
  if (pay && pay <= mkt * 0.5) p -= 0.18; else if (pay && pay <= mkt * 0.75) p -= 0.08;
  if (FA.capSystemOn() && FA.payroll(team) > FA.capLines(league).tax) p -= 0.1;
  const st = teamStatus(league, team);
  if (st === 'rebuilding') p -= 0.12;
  return { pressure: p, actual, expected, gap, mediocre, sec, st };
}

// The best available replacement for this team, by value to it.
function bestCandidate(league, team, map) {
  let best = null;
  for (const c of league.coaches || []) {
    if (!c.attributes || !c.fn) continue;
    const v = coachValue(c, team, league, map);
    if (!best || v > best.v) best = { c, v };
  }
  return best;
}

// Decide for one CPU team: { kind: 'fire' | 'keep' | 'extend' | null, ... }.
export function coachDecision(league, team, map = profiles(league)) {
  const cur = headCoachOf(team);
  if (!cur) return null;
  const pr = pressureOn(league, team, cur, map), curV = coachValue(cur, team, league, map), cand = bestCandidate(league, team, map);
  // A new coach costs more than the one being replaced; each extra $10M a year takes 0.1 off the upgrade.
  const extra = cand ? Math.max(0, marketSalary(cand.c, league) - (cur.contract?.sal || 0)) : 0;
  const gain = cand ? cand.v - curV - extra / 100 : -1;
  if (pr.pressure >= 0.45 && cand) {
    const younger = cand.c.age <= cur.age - 8 && coachCeiling(cand.c) >= coachCeiling(cur) + 1;
    if (gain >= 0.08) return { kind: 'fire', cur, cand: cand.c, pr, why: `${gain >= 0.15 ? 'a clear upgrade is available' : 'a better fit is available'}` };
    if (pr.pressure >= 0.75 && gain >= -0.03) return { kind: 'fire', cur, cand: cand.c, pr, why: 'consistent mediocrity, so a lateral move' };
    if (pr.pressure >= 0.65 && younger && gain >= -0.06) return { kind: 'fire', cur, cand: cand.c, pr, why: 'a bet on a younger coach with more upside' };
    return { kind: 'keep', cur, pr, why: 'no available coach is clearly better' };
  }
  const yrs = cur.contract?.yrs ?? 0;
  if (yrs <= 1 && !(cur.contract?.ext?.yrs > 0) && pr.pressure < 0.35 && (!cand || curV >= cand.v - 0.04)) {
    const yearsAsk = cur.age >= 58 ? 2 : cur.age >= 50 ? 3 : coachLevel(cur) >= 7 ? 5 : 4;
    const offer = { yrs: yearsAsk, sal: marketSalary(cur, league) };
    const w = coachWillingness(league, team, cur, offer, map);
    if (w.accept) return { kind: 'extend', cur, offer, pr, why: 'a coach worth keeping' };
  }
  return { kind: null, cur, pr };
}
