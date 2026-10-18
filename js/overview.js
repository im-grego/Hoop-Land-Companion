// Offseason Overview: where a team stands, its books, its real roster needs
// (depth, upside, age and play style), its draft position; plus the league
// rumor mill and play-style reads from the save's tendencies.

import { levelOf, playerName } from './savefile.js';
import { teamRecord, teamStatus, lotterySetup, lotteryOdds, seedOrder, standings } from './draft.js';
import { seasonLine } from './storylines.js';
import { tr, traitsSet } from './traits.js';

const GROUPS = { guards: 'Guards', wings: 'Wings', bigs: 'Bigs' };
export const groupOf = p => (p.pos <= 2 ? 'guards' : p.pos <= 5 ? 'wings' : 'bigs');
const lastYr = L => Math.max(...L.teams.map(t => teamRecord(t).yr || 0));

// ---------------------------------------------------------------------------
// Tendencies (-5..5 in the save): what a player looks to do on the floor.
// Each style reads one or more sliders; a player shows the styles he leans
// into hardest. `neg` styles are things he won't do.
export const TEND_LABELS = {
  dunk: 'Dunk', floater: 'Floater', hook: 'Hook', post: 'Post-up', twoPoint: 'Midrange', threePoint: 'Three',
  pumpFake: 'Pump fake', fades: 'Fadeaway', pass: 'Pass', lob: 'Lob', cross: 'Crossover', spin: 'Spin',
  step: 'Step-back', offReb: 'Off. glass', runPlay: 'Run plays', defReb: 'Def. glass', takeCharge: 'Take charges',
  stealOnBall: 'On-ball steals', stealOffBall: 'Passing lanes', block: 'Block shots',
};
export const TEND_GROUPS = [
  ['Scoring', ['dunk', 'floater', 'hook', 'post', 'twoPoint', 'threePoint']],
  ['Creating', ['pumpFake', 'fades', 'cross', 'spin', 'step', 'pass', 'lob', 'runPlay']],
  ['Effort & Defense', ['offReb', 'defReb', 'takeCharge', 'stealOnBall', 'stealOffBall', 'block']],
];
const STYLES = [
  { k: 'shooter', label: 'Floor spacer', icon: '🎯', f: t => t.threePoint, min: 3, text: 'lives beyond the arc' },
  { k: 'rim', label: 'Rim attacker', icon: '💥', f: t => (t.dunk * 2 + t.floater) / 3, min: 2.5, text: 'gets downhill and finishes at the rim' },
  { k: 'mid', label: 'Midrange scorer', icon: '🧈', f: t => (t.twoPoint * 2 + t.fades) / 3, min: 2.5, text: 'pulls up from the midrange' },
  { k: 'post', label: 'Post scorer', icon: '🧱', f: t => (t.post * 2 + t.hook) / 3, min: 2.5, text: 'wants it on the block' },
  { k: 'creator', label: 'Shot creator', icon: '🪄', f: t => (t.step + t.cross + t.spin + t.fades) / 4, min: 2.5, text: 'creates his own shot off the dribble' },
  { k: 'playmaker', label: 'Playmaker', icon: '🧠', f: t => (t.pass * 2 + t.runPlay) / 3, min: 2.5, text: 'looks to set teammates up' },
  { k: 'lob', label: 'Lob threat', icon: '🛫', f: t => t.lob, min: 3, text: 'throws and catches lobs' },
  { k: 'glass', label: 'Glass cleaner', icon: '🧹', f: t => (t.offReb + t.defReb) / 2, min: 3, text: 'crashes the boards' },
  { k: 'protector', label: 'Rim protector', icon: '🛡️', f: t => t.block, min: 3, text: 'goes for blocks' },
  { k: 'pest', label: 'Ball hawk', icon: '🦅', f: t => (t.stealOnBall + t.stealOffBall) / 2, min: 2.5, text: 'jumps passing lanes and pokes at the ball' },
  { k: 'charge', label: 'Takes charges', icon: '🪨', f: t => t.takeCharge, min: 3, text: 'stands his ground for charges' },
];
const WONT = [
  { k: 'threePoint', max: -4, text: "won't shoot threes" },
  { k: 'pass', max: -4, text: 'rarely gives it up' },
  { k: 'dunk', max: -4, text: "doesn't play above the rim" },
  { k: 'defReb', max: -4, text: "doesn't rebound" },
];
// Pros and prospects lean differently (prospect sliders run higher), so a
// style counts when a player is in the top ~20% of his own pool (pros or
// the draft class) and clearly positive. setStyleRefs() reads the league.
let REFS = null;
export function setStyleRefs(L) {
  const cut = ps => Object.fromEntries(STYLES.map(st => {
    const v = ps.filter(p => p.tendencies).map(p => st.f(p.tendencies)).sort((a, b) => b - a);
    return [st.k, Math.max(1, v[Math.floor(v.length * 0.2)] ?? st.min)];
  }));
  REFS = { pro: cut(L.teams.flatMap(t => t.roster)), draft: cut(L.draftClass || []) };
}
const refFor = p => (REFS ? (p.status === 1 ? REFS.draft : REFS.pro) : null);
// A player's styles, strongest first: [{ k, label, icon, text, v }].
export function playStyles(p, n = 3) {
  const t = p.tendencies;
  if (!t) return [];
  const ref = refFor(p);
  return STYLES.map(s => ({ ...s, v: s.f(t), cut: ref ? ref[s.k] : s.min })).filter(s => s.v >= s.cut).sort((a, b) => (b.v - b.cut) - (a.v - a.cut)).slice(0, n);
}
export const wontDo = p => (p.tendencies ? WONT.filter(w => p.tendencies[w.k] <= w.max).map(w => w.text) : []);
// One line for a scouting report: "Floor spacer: lives beyond the arc; won't post up."
export function styleLine(p) {
  const s = playStyles(p, 2), w = wontDo(p);
  if (!s.length && !w.length) return 'Balanced: no strong lean in his game.';
  const lead = s.length ? `${s.map(x => x.label).join(' · ')}: ${s.map(x => x.text).join(', ')}` : 'No real specialty';
  return `${lead}${w.length ? `; ${w.slice(0, 2).join(', ')}` : ''}.`;
}

// ---------------------------------------------------------------------------
// Where the team stands.
export function teamStanding(L, team) {
  const r = teamRecord(team);
  const rows = (team.season || []).filter(s => s.seasonStats?.GP > 0).slice(-3);
  const row = (team.season || []).find(s => s.yr === r.yr);
  const round = row?.round || 0, sw = row?.seriesWins || 0;
  const champ = round === 4 && sw === 4;
  const finish = champ ? '🏆 Won the title' : round === 4 ? 'Lost in the Finals' : round === 3 ? 'Lost in the conference finals'
    : round === 2 ? 'Lost in the second round' : round === 1 ? 'Lost in the first round' : 'Missed the playoffs';
  const trend = rows.map(s => ({ yr: s.yr, W: s.seasonStats.W, L: s.seasonStats.L, pct: s.seasonStats.W / Math.max(1, s.seasonStats.W + s.seasonStats.L) }));
  return { ...r, status: teamStatus(L, team), finish, champ, round, trend };
}

// ---------------------------------------------------------------------------
// The books: expiring deals, options due, extension candidates, restricted
// free agents, committed money and projected space. `level`/`worth` come
// from the app (regression-aware level, fair salary).
export function teamBooks(L, team, { level = levelOf, worth, qoEligible }) {
  const roster = team.roster;
  const expiring = roster.filter(p => p.status === 4).map(p => ({ p, level: level(p), worth: worth(p), rfa: qoEligible(L, p) }))
    .sort((a, b) => b.level - a.level);
  const options = roster.filter(p => p.contract && (p.contract.yrs || 0) <= 1 && (p.contract.opt === 1 || p.contract.opt === 2) && p.status !== 4)
    .map(p => ({ p, kind: p.contract.opt === 1 ? 'team' : 'player', sal: p.contract.sal, worth: worth(p), level: level(p) })).sort((a, b) => b.level - a.level);
  const ext = roster.filter(p => p.status === 3 && (p.contract?.yrs || 0) === 1 && p.contract.canExt !== false && !options.some(o => o.p === p))
    .map(p => ({ p, level: level(p), sal: p.contract.sal, worth: worth(p) })).sort((a, b) => b.level - a.level);
  const committed = roster.filter(p => p.status === 3 && (p.contract?.yrs || 0) >= 1).reduce((a, p) => a + (p.contract.sal || 0), 0);
  const cap = L.season.salaryCap || 200;
  return { expiring, options, ext, committed, cap, space: cap - committed };
}

// ---------------------------------------------------------------------------
// Roster needs: depth, starter quality, upside and age by position group,
// plus play-style holes. Looks at next season's roster (players under
// contract; options assumed picked up). Severity 1–3.
function leagueCuts(L, level) {
  const lv = L.teams.flatMap(t => t.roster.filter(p => p.status !== 4).map(level)).sort((a, b) => b - a);
  const n = L.teams.length;
  return { starter: lv[n * 5 - 1] ?? 75, rotation: lv[n * 8 - 1] ?? 70 };
}
export function rosterNeeds(L, team, { level = levelOf, li = 0 } = {}) {
  const cuts = leagueCuts(L, level);
  const keep = team.roster.filter(p => p.status !== 4);
  const out = [];
  for (const g of Object.keys(GROUPS)) {
    const ps = keep.filter(p => groupOf(p) === g).sort((a, b) => level(b) - level(a));
    const rot = ps.filter(p => level(p) >= cuts.rotation);
    const best = ps[0];
    const young = ps.filter(p => p.age <= 24 && (p.pot || 0) >= 7);
    const old = rot.filter(p => p.age >= (p.regressionAge || 32) - 1);
    const name = GROUPS[g];
    const want = g === 'wings' ? 3 : 2;
    if (rot.length < want) out.push({ group: g, kind: 'Depth', sev: rot.length === 0 ? 3 : want - rot.length >= 2 ? 3 : 2,
      text: `${rot.length || 'No'} rotation-level ${name.toLowerCase()} under contract${ps.length ? ` (${ps.length} on the roster)` : ''}` });
    if (!best || level(best) < cuts.starter) out.push({ group: g, kind: 'Starter', sev: !best || level(best) < cuts.rotation ? 3 : 2,
      text: best ? `Best of the ${name.toLowerCase()} is ${playerName(best)} (Lv ${level(best)}), below a starter` : `No ${name.toLowerCase()} at all` });
    if (!young.length) out.push({ group: g, kind: 'Upside', sev: 1, text: `No ${name.toLowerCase().slice(0, -1)} 24 or younger with 3½★+ potential` });
    if (old.length && old.length >= Math.max(1, rot.length - 1)) out.push({ group: g, kind: 'Age', sev: old.length >= 2 ? 2 : 1,
      text: `${old.map(p => `${playerName(p)} (${p.age})`).join(', ')} ${old.length > 1 ? 'are' : 'is'} at the end of ${old.length > 1 ? 'their primes' : 'his prime'}` });
  }
  // Play style: what the likely rotation does (top 9 by level).
  const rot9 = [...keep].sort((a, b) => level(b) - level(a)).slice(0, 9);
  const has = k => rot9.filter(p => playStyles(p, 4).some(s => s.k === k));
  const style = (k, need, text, sev = 2) => { const n = has(k).length; if (n < need) out.push({ group: 'style', kind: 'Style', sev: n === 0 ? sev : 1, style: k, text }); };
  style('shooter', 2, has('shooter').length ? `Only ${playerName(has('shooter')[0])} spaces the floor` : 'Nobody in the rotation spaces the floor');
  style('rim', 1, 'Nobody attacks the rim', 2);
  style('playmaker', 1, 'No playmaker: nobody looks to set teammates up', 2);
  style('protector', 1, 'No rim protector', 2);
  style('glass', 1, 'Nobody crashes the boards', 1);
  return out.sort((a, b) => b.sev - a.sev);
}

// Team identity: the rotation's average lean on each slider.
export function teamIdentity(team, level = levelOf) {
  const rot = [...team.roster].filter(p => p.status !== 4 && p.tendencies).sort((a, b) => level(b) - level(a)).slice(0, 9);
  if (!rot.length) return [];
  return STYLES.map(s => ({ ...s, n: rot.filter(p => playStyles(p, 4).some(x => x.k === s.k)).length }))
    .sort((a, b) => b.n - a.n);
}

// ---------------------------------------------------------------------------
// Draft position before the lottery: each of the team's picks this year
// with its slot (or lottery odds).
export function draftPosition(L, team, format = 'auto') {
  const yr = L.season.currentYear;
  const setup = lotterySetup(L, format);
  const order = seedOrder(L).map(r => r.team);
  const odds = setup.lotteryTeams.length ? lotteryOdds(L, format, setup.draws, 4000, 7) : [];
  const r2 = standings(L).map(r => r.team);
  const n = L.teams.length;
  return team.draftPicks.filter(pk => pk.yr === yr).sort((a, b) => a.rd - b.rd).map(pk => {
    const orig = L.teams.find(t => t.id === pk.otid) || team;
    if (pk.rd === 1) {
      const seed = order.indexOf(orig);
      const o = odds.find(x => x.team === orig);
      if (o) {
        const likely = o.pct.indexOf(Math.max(...o.pct)) + 1;
        const exp = o.pct.reduce((a, v, i) => a + v * (i + 1), 0) / 100;
        return { rd: 1, orig, seed: seed + 1, lottery: true, p1: o.pct[0], top4: o.pct.slice(0, 4).reduce((a, b) => a + b, 0), likely, exp, worst: o.pct.reduce((m, v, i) => (v > 0.05 ? i + 1 : m), likely) };
      }
      return { rd: 1, orig, seed: seed + 1, slot: seed + 1, lottery: false };
    }
    return { rd: 2, orig, slot: n + r2.indexOf(orig) + 1, lottery: false };
  });
}

// ---------------------------------------------------------------------------
// Rumor mill. Every team's direction, plus stars who might want out and
// veterans a rebuilding team might move. Stars on bad teams aren't unhappy
// by default: big minutes keep morale up; it's losing year after year,
// no co-star and a low mood that build the heat.
export function rumorMill(L, { level = levelOf, li = 0, skip = () => false } = {}) {
  const yr = lastYr(L);
  const out = [];
  const tags = teamTags(L, level);
  for (const team of L.teams) {
    if (skip(team)) continue;
    const st = teamStanding(L, team);
    const roster = [...team.roster].filter(p => p.status !== 4).sort((a, b) => level(b) - level(a));
    const star = roster[0], second = roster[1];
    if (!star) continue;
    const prime = star.age >= 24 && star.age < (star.regressionAge || 32);
    const losing = st.trend.filter(s => s.pct < 0.45).length;
    const l = seasonLine(star, li, yr);
    const mpg = l?.mpg ?? 0;
    const morale = star.season?.morale ?? 70;
    // Disgruntled star.
    if (level(star) >= 80 && prime) {
      let heat = 0;
      const why = [];
      if (losing >= 2) { heat += 2; why.push(`${losing} losing seasons in a row`); } else if (losing === 1) { heat += 1; why.push('a losing season'); }
      if (st.round >= 1 && st.round <= 1 && !st.champ && st.status !== 'rebuilding' && st.trend.length >= 2 && st.trend.every(s => s.pct >= 0.5)) { heat += 1; why.push('another early playoff exit'); }
      if (!second || level(second) < level(star) - 8) { heat += 1.5; why.push('no co-star'); }
      if (st.status === 'rebuilding') { heat += 1; why.push('a team heading into a rebuild'); }
      if (morale < 40) { heat += 2; why.push(`morale at ${morale}`); } else if (morale < 60) { heat += 1; why.push(`morale slipping (${morale})`); }
      if (traitsSet(star)) {
        if (losing && tr(star, 'winning') >= 15) { heat += 1; why.push('wants to win now'); }
        if (tr(star, 'loyalty') >= 16) { heat -= 1.5; }
        if (tr(star, 'lockerRoom') <= 6) { heat += 1; why.push('a difficult locker room presence'); }
      }
      if (mpg >= 33) heat -= 1;      // the minutes keep him happy enough
      if (morale >= 85) heat -= 1;
      if (heat >= 3) out.push({ kind: 'star', p: star, team, heat: Math.min(3, Math.floor(heat / 1.5)), why, level: level(star), mpg, morale });
    }
    // Veterans a rebuilding (or sliding) team might move.
    if (st.status === 'rebuilding' || tags.get(team.id)?.stance === 'seller') {
      for (const p of roster.slice(0, 6)) {
        if (p === star && out.some(x => x.p === p)) continue;
        if (level(p) >= 74 && p.age >= (p.regressionAge || 32) - 4) out.push({ kind: 'vet', p, team, heat: level(p) >= 82 ? 2 : 1, why: [`${p.age} years old on a rebuilding team`], level: level(p), morale: p.season?.morale ?? 70 });
      }
    }
  }
  return out.sort((a, b) => b.heat - a.heat || b.level - a.level);
}
export const statusOfAll = L => L.teams.map(t => ({ team: t, ...teamStanding(L, t) }));

// ---------------------------------------------------------------------------
// Team tags: tier (where they are) and stance (what they're doing).
export const TIERS = {
  favorite: { label: 'Title Favorite', icon: '🏆' }, contender: { label: 'Contender', icon: '⚔️' },
  playoff: { label: 'Playoff Team', icon: '🎟️' }, rising: { label: 'Rising', icon: '📈' },
  treadmill: { label: 'Treadmill', icon: '😐' }, rebuilding: { label: 'Rebuilding', icon: '🧱' },
};
export const STANCES = { buyer: { label: 'Buyer', icon: '🛒' }, seller: { label: 'Seller', icon: '🏷️' }, holding: { label: 'Holding', icon: '⏸️' } };
const W9 = [1, 0.95, 0.9, 0.8, 0.7, 0.55, 0.45, 0.35, 0.25];
export function teamTags(L, level = levelOf) {
  // Projected strength: the top 9 (players whose deals are up count a bit
  // less: some won't be back).
  const proj = new Map(L.teams.map(t => [t.id, [...t.roster].map(p => level(p) * (p.status === 4 ? 0.9 : 1)).sort((a, b) => b - a).slice(0, 9).reduce((a, v, i) => a + v * W9[i], 0)]));
  const rank = new Map([...L.teams].sort((a, b) => proj.get(b.id) - proj.get(a.id)).map((t, i) => [t.id, i + 1]));
  const out = new Map();
  for (const t of L.teams) {
    const st = teamStanding(L, t);
    const r = rank.get(t.id);
    const top5 = [...t.roster].filter(p => p.status !== 4).sort((a, b) => level(b) - level(a)).slice(0, 5);
    const youngCore = top5.filter(p => p.age <= 24 && (p.pot || 0) >= 8).length;
    const avgAge = top5.reduce((a, p) => a + p.age, 0) / (top5.length || 1);
    const prev = st.trend.length >= 2 ? st.trend[st.trend.length - 2].pct : null;
    const climbing = prev != null && st.pct - prev >= 0.08;
    const middling = st.trend.length >= 2 && st.trend.slice(-2).every(x => x.pct >= 0.4 && x.pct <= 0.58);
    let tier;
    if (r <= 3 && (st.pct >= 0.6 || st.round >= 3)) tier = 'favorite';
    else if ((r <= 12 && st.pct >= 0.58) || (r <= 6 && st.pct >= 0.5) || (st.round >= 3 && r <= 12)) tier = 'contender';
    else if ((avgAge <= 25.5 || youngCore >= 2) && (climbing || r <= 16) && st.pct < 0.6) tier = 'rising';
    else if (st.pct < 0.4 || (r >= 24 && st.pct < 0.5)) tier = 'rebuilding';
    else if (middling && !youngCore && r >= 9) tier = 'treadmill';
    else tier = r <= 16 || st.pct >= 0.5 ? 'playoff' : 'treadmill';
    const vets = top5.filter(p => p.age >= 29 && level(p) >= 74).length;
    const lostEarly = st.round >= 1 && st.round <= 2 && !st.champ;
    const stance = tier === 'favorite' || tier === 'contender' || (tier === 'playoff' && lostEarly) ? 'buyer'
      : (tier === 'rebuilding' && vets) || (tier === 'treadmill' && avgAge >= 28) ? 'seller' : 'holding';
    out.set(t.id, { tier, stance, rank: r, ...st });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contract tags: value over the rest of the deal (years and age count), plus
// status chips. `worth` = fair salary today, `maxSal` = his max.
export const CONTRACT_TAGS = {
  steal: { label: 'Steal', icon: '💎', cls: 'new' }, bargain: { label: 'Bargain', icon: '', cls: 'new' }, fair: { label: 'Fair', icon: '', cls: '' },
  overpaid: { label: 'Overpaid', icon: '', cls: 'down-b' }, albatross: { label: 'Albatross', icon: '⚓', cls: 'down-b' },
};
export function contractTag(p, worth, maxSal = 50) {
  const c = p.contract || {};
  const sal = c.sal || 0, yrs = c.yrs || 0;
  const chips = [];
  if (p.status === 4) chips.push('Expiring');
  if (!sal || !yrs) return { tag: null, chips };
  if (yrs === 1) chips.push('Expiring');
  if (p.history?.draft?.rd === 1 && (p.yrs ?? 9) <= 4 && sal <= 12) chips.push('Rookie Deal');
  if (sal >= maxSal * 0.95) chips.push('Max');
  if (c.opt === 1) chips.push('TO'); else if (c.opt === 2) chips.push('PO');
  if (c.ext?.yrs > 0) chips.push('Extended');
  // Worth over the deal: a player past his decline age loses value each year.
  const decline = p.age >= (p.regressionAge || 32) - 1 ? 0.88 : p.age <= 24 ? 1.06 : 1;
  let w = 0;
  for (let i = 0; i < yrs; i++) w += worth * decline ** i;
  const ratio = (w / yrs) / Math.max(1, sal);
  const gap = w / yrs - sal;
  let tag = ratio >= 1.15 ? 'bargain' : ratio < 0.85 ? 'overpaid' : 'fair';
  if (ratio >= 1.5 && gap >= 5 && yrs >= 2) tag = 'steal';
  if ((ratio < 0.7 && yrs >= 3) || (ratio < 0.85 && yrs >= 3 && p.age + yrs >= 34 && sal >= 20)) tag = 'albatross';
  return { tag, chips: [...new Set(chips)] };
}
