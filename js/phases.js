// Advance the offseason inside the app, the way the game does, so a save
// can be imported once (Pre-Lottery) and exported once (Free Agency Day 3):
//
//   Pre-Lottery (2) --lottery--> Pre-Draft (4) --draft (livedraft.js)-->
//   Post-Draft (5) --open free agency--> Free Agency Day 1 (6) --> Day 2 --> Day 3
//
// What the game writes at each step (from saves before and after):
// - Lottery: this year's picks get `pk` (0-based slot in their round);
//   each team's new-season row keeps its pre-lottery slot in `poll` and its
//   first-round slot in `pick`; one news item names the winner; phase 4.
// - Free agency: drafted rookies sign (status 2 → 3): first round on the
//   rookie scale for 4 years with a team option, second round at the
//   minimum; contract { tid, pid, sal, yrs, opt: 1, canExt: false }, the
//   new-season stats row gets the salary; phase 6, day 1.
// - Each day: currentDay + 1 (signings are the app's free agency).

import { PHASE_PRE_LOTTERY, PHASE_PRE_DRAFT, PHASE_POST_DRAFT, PHASE_FREE_AGENCY } from './savefile.js';
import { standings } from './draft.js';

const row = (team, yr) => (team.season || []).find(s => s.yr === yr);

// Teams worst to best before the lottery: the game's own slot (`pick` on
// the new-season row) when the save has one, else by record.
export function preLotteryOrder(league) {
  const yr = league.season.currentYear;
  const slots = league.teams.map(t => row(t, yr)?.pick);
  const valid = slots.every(x => Number.isInteger(x)) && new Set(slots).size === league.teams.length;
  if (league.season.phase === PHASE_PRE_LOTTERY && valid) {
    return [...league.teams].sort((a, b) => row(a, yr).pick - row(b, yr).pick);
  }
  return standings(league).map(r => r.team);
}

// `r1` = all teams in first-round order (lottery winners first). Second
// round goes by record. Returns a record for undo.
export function applyLottery(league, r1) {
  if (league.season.phase !== PHASE_PRE_LOTTERY) throw new Error('The save must be at the Pre-Lottery phase.');
  const yr = league.season.currentYear;
  const r2 = preLotteryOrder(league);
  const slot1 = new Map(r1.map((t, i) => [t.id, i]));
  const slot2 = new Map(r2.map((t, i) => [t.id, i]));
  for (const t of league.teams) {
    for (const pk of t.draftPicks) {
      if (pk.yr !== yr) continue;
      const s = (pk.rd === 1 ? slot1 : slot2).get(pk.otid);
      if (s != null) pk.pk = s;
    }
    const r = row(t, yr);
    if (r) { r.poll = r.pick ?? slot2.get(t.id); r.pick = slot1.get(t.id); }
  }
  const news = league.season.news;
  const template = news.find(n => n.data?.contract) || news[0];
  if (template) {
    const n = structuredClone(template);
    Object.assign(n, { league: 0, rating: 10, date: 0, phase: PHASE_PRE_LOTTERY, category: 0, type: 1, tid: r1[0].id, pid: 0, gid: 0, read: false });
    if (n.data?.contract) Object.assign(n.data.contract, { tid: 0, pid: 0, type: 0, yrs: 0, sal: 0, nil: 0, opt: 0, noTrd: 0, canExt: false });
    if (n.data?.draftPick) n.data.draftPick = { pk: 0, rd: 0, tid: 0, otid: 0, yr: 0 };
    news.push(n);
  }
  league.season.phase = PHASE_PRE_DRAFT;
}

// Rookie scale by first-round slot (as the game pays it, $M on a $200M cap).
const SCALE = [10, 10, 9, 9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 7, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 2];
export const rookieScale = (league, overall) =>
  Math.max(2, Math.round((SCALE[Math.min(overall, SCALE.length) - 1] ?? 2) * (league.season.salaryCap || 200) / 200));

// Open free agency: sign this year's draft picks and move to Day 1.
// Returns the signings [{ p, team, sal, yrs }].
export function startFreeAgency(league, { r2Years = 2, rosterMax = 15, minSalary = 2 } = {}) {
  if (league.season.phase !== PHASE_POST_DRAFT) throw new Error('The save must be at the Post-Draft phase.');
  const yr = league.season.currentYear;
  const out = [];
  for (const team of league.teams) {
    const signed = () => team.roster.filter(p => p.status === 3).length;
    const rookies = team.roster.filter(p => p.status === 2 && p.history?.draft?.yr === yr)
      .sort((a, b) => a.history.draft.pk - b.history.draft.pk);
    for (const p of rookies) {
      const d = p.history.draft;
      if (d.rd !== 1 && signed() >= rosterMax) continue;
      const sal = d.rd === 1 ? rookieScale(league, d.pk) : minSalary;
      const yrs = d.rd === 1 ? 4 : r2Years;
      Object.assign(p.contract, { tid: team.id, pid: p.id, sal, yrs, opt: 1, canExt: false });
      p.status = 3;
      const s = (p.stats || []).filter(x => x.yr === yr && x.league === 0).pop();
      if (s) s.sal = sal;
      out.push({ p, team, sal, yrs });
    }
  }
  league.season.phase = PHASE_FREE_AGENCY;
  league.season.currentDay = 1;
  return out;
}

export function nextFreeAgencyDay(league) {
  const s = league.season;
  if (s.phase !== PHASE_FREE_AGENCY) throw new Error('Not in free agency.');
  const last = s.signingDays || 3;
  if (s.currentDay >= last) throw new Error(`Day ${last} is the last day of free agency.`);
  s.currentDay++;
}
