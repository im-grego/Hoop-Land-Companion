// Facilities: the four buildings every team has (frontOffice.facilities,
// tier 1-4 in the save). Tier 1 comes with the team and does nothing; each
// upgrade (tiers 2, 3, 4) gets the game's own benefit (injury prevention, XP
// gains, coin income: 5%, 10%, 25%; scouting assignments 3 / 5 / 10) plus the
// app's own perks on top, each wired to something the app does. Coins buy
// the upgrades. Complete rules only.

export const FACILITIES = [
  { k: 'medical', type: 0, label: 'Medical', icon: '🩺', tiers: [
    { name: 'Training Room', lines: ['Standard issue, no bonuses'] },
    { name: 'Sports Medicine', lines: ['Game: injury prevention +5%', 'Injury-driven potential loss 15% less likely', 'Injuries cost veterans 15% less regression delay', 'Nagging injuries cost 25% fewer progression points'] },
    { name: 'Recovery Center', lines: ['Game: injury prevention +10%', 'Potential loss 35% less likely', 'Regression delay 35% less affected', 'Nagging injuries cost half the progression points'] },
    { name: 'Medical Institute', lines: ['Game: injury prevention +25%', 'Potential loss 60% less likely', 'Regression delay 60% less affected', 'Nagging injuries cost no progression points', 'Structural injuries are treated like ordinary ones'] },
  ] },
  { k: 'training', type: 1, label: 'Training', icon: '🏋️', tiers: [
    { name: 'Basic Gym', lines: ['Standard issue, no bonuses'] },
    { name: 'Performance Center', lines: ['Game: XP gains +5%', '+4% offseason progression', 'Strength program gains +10%'] },
    { name: 'Elite Lab', lines: ['Game: XP gains +10%', '+8% offseason progression', 'Strength program gains +20%', 'Players learn new skills 15% more often', 'Potential bumps 10% likelier for players 21 and under'] },
    { name: 'Training Campus', lines: ['Game: XP gains +25%', '+16% offseason progression', 'Strength program gains +40%', 'Players learn new skills 30% more often', 'Potential bumps 25% likelier for players 21 and under'] },
  ] },
  { k: 'scouting', type: 2, label: 'Scouting', icon: '🔭', tiers: [
    { name: 'Local Scouts', lines: ['Standard issue, no bonuses'] },
    { name: 'Regional Network', lines: ['Game: 3 scouting assignments', 'Instant read: confirm the true potential of 2 prospects', 'Potential reads 10% tighter'] },
    { name: 'National Network', lines: ['Game: 5 scouting assignments', 'Instant read on 4 prospects', 'Potential reads 25% tighter', '50% more rating ceilings known before a workout'] },
    { name: 'Global Network', lines: ['Game: 10 scouting assignments', 'Instant read on 8 prospects', 'Potential reads 40% tighter', 'Double the rating ceilings known before a workout', 'Good cop, bad cop: ask all six interview questions'] },
  ] },
  { k: 'arena', type: 3, label: 'Arena', icon: '🏟️', tiers: [
    { name: 'Neighborhood Arena', lines: ['Standard issue, no bonuses'] },
    { name: 'Modern Arena', lines: ['Game: coin income +5%', 'Free agents like your offers a bit more (+3%)', '+1 morale for every player each summer', 'One more private workout slot'] },
    { name: 'Showcase Arena', lines: ['Game: coin income +10%', 'Free agents like your offers more (+6%)', '+2 morale each summer', 'Two more private workout slots', 'Your players re-sign for 3% less', 'Stars ask out 10% less often', 'Tax and teardown morale hits 25% smaller'] },
    { name: 'Landmark Arena', lines: ['Game: coin income +25%', 'Free agents like your offers much more (+12%)', '+3 morale each summer', 'Three more private workout slots', 'Your players re-sign for 6% less', 'Stars ask out 20% less often', 'Tax and teardown morale hits 50% smaller'] },
  ] },
];
export const MAX_FAC_TIER = 4;
export const UPGRADE_COST = [0, 100, 150, 250];       // coins to go up from tier 1, 2, 3 (indexed by the tier you're on)

let ON = true;
export function setFacilitiesOn(on) { ON = !!on; }

export const facilityOf = (team, k) => (team?.frontOffice?.facilities || []).find(f => f.type === FACILITIES.find(x => x.k === k).type) || null;
export const tierIn = (team, k) => Math.max(1, Math.min(MAX_FAC_TIER, facilityOf(team, k)?.tier || 1));
export const upgradeCost = tier => UPGRADE_COST[tier] ?? 0;   // cost to go from `tier` to `tier + 1`

// What a team's buildings do in the app, as numbers (neutral at tier 1 and
// with the simple rules). Arrays are indexed by tier (index 0 unused).
export function facilityFx(team) {
  const T = k => (ON && team?.frontOffice ? tierIn(team, k) : 1);
  const m = T('medical'), r = T('training'), s = T('scouting'), a = T('arena');
  const at = (arr, t) => arr[t - 1];
  return {
    potLossMult: at([1, 0.85, 0.65, 0.4], m),
    longCutMult: at([1, 0.85, 0.65, 0.4], m),
    nagMult: at([1, 0.75, 0.5, 0], m),
    structStd: m >= 4,
    devMult: at([1, 1.04, 1.08, 1.16], r),
    strMult: at([1, 1.1, 1.2, 1.4], r),
    skillMult: at([1, 1, 1.15, 1.3], r),
    youngPot: at([1, 1, 1.1, 1.25], r),
    fog: at([1, 0.9, 0.75, 0.6], s),
    reveals: at([0, 2, 4, 8], s),
    ceilMult: at([1, 1, 1.5, 2], s),
    goodCop: s >= 4,
    fa: at([0, 0.03, 0.06, 0.12], a),
    morale: at([0, 1, 2, 3], a),
    workouts: at([0, 1, 2, 3], a),
    askMult: at([1, 1, 0.97, 0.94], a),
    requestCut: at([0, 0, 0.1, 0.2], a),
    taxCut: at([0, 0, 0.25, 0.5], a),
  };
}
