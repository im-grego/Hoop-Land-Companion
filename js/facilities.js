// Facilities: the four buildings every team has (frontOffice.facilities,
// tier 1-3 in the save). The game reads the tier for its own benefits (coin
// income, scouting assignments, XP, injury prevention); these are the
// app's own effects on top, each one wired to something the app does.
// Coins buy the upgrades. Complete rules only.

export const FACILITIES = [
  { k: 'arena', type: 0, label: 'Arena', icon: '🏟️', tiers: [
    { name: 'Standard Arena', lines: ['The building as it stands'] },
    { name: 'Modern Arena', lines: ['+1 morale for every player each summer', 'Free agents like your offers more (+4%)', 'Stars ask out 10% less often', 'Tax and teardown morale hits 25% smaller'] },
    { name: 'Showcase Arena', lines: ['+2 morale for every player each summer', 'Free agents like your offers much more (+9%)', 'Stars ask out 20% less often', 'Tax and teardown morale hits 50% smaller'] },
  ] },
  { k: 'scouting', type: 1, label: 'Scouting', icon: '🔭', tiers: [
    { name: 'Local Scouts', lines: ['Potential reads as they are'] },
    { name: 'Regional Network', lines: ['Draft potential reads 20% tighter'] },
    { name: 'Global Network', lines: ['Draft potential reads 40% tighter', 'A fourth interview question: pick one of two, four times'] },
  ] },
  { k: 'training', type: 2, label: 'Training', icon: '🏋️', tiers: [
    { name: 'Basic Gym', lines: ['Offseason work as usual'] },
    { name: 'Performance Center', lines: ['+8% offseason progression', 'Strength program gains +20%'] },
    { name: 'Elite Lab', lines: ['+16% offseason progression', 'Strength program gains +40%', 'Players learn new skills 30% more often', 'Potential bumps 20% likelier for players 21 and under'] },
  ] },
  { k: 'medical', type: 3, label: 'Medical', icon: '🩺', tiers: [
    { name: 'Training Room', lines: ['Injuries cost what they cost'] },
    { name: 'Sports Medicine', lines: ['Injury-driven potential loss 30% less likely', 'Injuries cost 30% less of a veteran\'s regression delay', 'Nagging injuries cost half the progression points'] },
    { name: 'Recovery Center', lines: ['Injury-driven potential loss 60% less likely', 'Injuries cost 60% less of a veteran\'s regression delay', 'Nagging injuries cost no progression points', 'Structural injuries are treated like ordinary ones'] },
  ] },
];
export const MAX_FAC_TIER = 3;
export const UPGRADE_COST = [0, 150, 300];            // coins to reach tier 1, 2, 3

let ON = true;
export function setFacilitiesOn(on) { ON = !!on; }

export const facilityOf = (team, k) => (team?.frontOffice?.facilities || []).find(f => f.type === FACILITIES.find(x => x.k === k).type) || null;
export const tierIn = (team, k) => Math.max(1, Math.min(MAX_FAC_TIER, facilityOf(team, k)?.tier || 1));
export const upgradeCost = tier => UPGRADE_COST[tier] ?? 0;   // cost to go from `tier` to `tier + 1`

// What a team's buildings do, as numbers (neutral at tier 1 or with the simple rules).
export function facilityFx(team) {
  const t = k => (ON ? tierIn(team, k) - 1 : 0);
  const a = t('arena'), s = t('scouting'), r = t('training'), m = t('medical');
  return {
    morale: [0, 1, 2][a],
    fa: [0, 0.04, 0.09][a],
    requestCut: [0, 0.1, 0.2][a],
    taxCut: [0, 0.25, 0.5][a],
    fog: [1, 0.8, 0.6][s],
    interviews: [0, 0, 1][s],
    devMult: [1, 1.08, 1.16][r],
    strMult: [1, 1.2, 1.4][r],
    skillMult: [1, 1, 1.3][r],
    youngPot: [1, 1, 1.2][r],
    potLossMult: [1, 0.7, 0.4][m],
    longCutMult: [1, 0.7, 0.4][m],
    nagMult: [1, 0.5, 0][m],
    structStd: m >= 2,
  };
}
