// Coaching tree: the same for college and the pros. The head coach earns
// points each offseason from how the season went; you spend them in three
// branches. The hired coach's own ratings (development, motivation,
// leadership, 0-20 in the save) start some tiers already unlocked.
//
// - Player Development: more offseason progression points and better odds
//   of a potential bump for your players.
// - Scheme: tendency nudges in Training Camp / Summer Development.
// - Culture: locker room and loyalty for your roster (pros), recruiting pull
//   (college).

export const BRANCHES = [
  { k: 'dev', label: 'Development', icon: '📈', rating: 'development',
    tiers: ['+10% offseason progression, +15% potential odds', '+20% progression, +30% potential odds', '+30% progression, +45% potential odds'] },
  { k: 'culture', label: 'Motivation', icon: '🤝', rating: 'motivation',
    tiers: ['+1 Locker Room and Loyalty (up to 14) · +10% recruiting pull', '+2 (up to 16) · +20% recruiting pull', '+3 (up to 18) · +30% recruiting pull'] },
  { k: 'scheme', label: 'Leadership', icon: '🧠', rating: 'leadership',
    tiers: ['2 tendency nudges per player · game plan: offense', '3 nudges per player · game plan: defense', '4 nudges per player; a tendency can move 3 · game plan: rotation'] },
];
export const TIER_COST = [1, 2, 3];
export const MAX_TIER = 3;

// The tree, top down, five rows deep. Each branch is a spine of three tiers
// (the old tree, opened by tokens or by the coach's own rating) with side
// nodes beside it, a row of two more, and a capstone that needs both. Tokens
// (franchise tokens, earned each season) buy everything. `spine` nodes are
// the tiers; the rest are the Complete rules' additions.
export const NODES = {
  dev: [
    { id: 'd1', row: 1, col: 0, spine: 1, label: 'Fundamentals' },
    { id: 'd2', row: 2, col: 0, spine: 2, label: 'Film Study' },
    { id: 'dA', row: 2, col: 1, label: 'Strength Lab', text: 'Strength program: +30% odds of a gain', pts: 2, req: ['d1'] },
    { id: 'd3', row: 3, col: 0, spine: 3, label: 'Elite Development' },
    { id: 'dB', row: 3, col: 1, label: 'Veteran Care', text: '+50% odds to push a veteran\'s regression back a year', pts: 3, req: ['dA'] },
    { id: 'dC', row: 4, col: 0, label: 'Skill Workshop', text: 'Players learn new skills 30% more often', pts: 4, req: ['d3'] },
    { id: 'dD', row: 4, col: 1, label: 'Late Bloomers', text: '+12% progression for players 24 to 27', pts: 4, req: ['dB'] },
    { id: 'd4', row: 5, col: 0, wide: true, label: 'Player Lab', text: '+15% progression for players 23 and under; potential bumps 25% likelier for 21 and under', pts: 6, req: ['dC', 'dD'] },
  ],
  culture: [
    { id: 'm1', row: 1, col: 0, spine: 1, label: 'Team Culture' },
    { id: 'm2', row: 2, col: 0, spine: 2, label: 'Locker Room' },
    { id: 'mA', row: 2, col: 1, label: 'Open Door', text: '+3 morale for everyone each summer · stars ask out 20% less often', pts: 2, req: ['m1'] },
    { id: 'm3', row: 3, col: 0, spine: 3, label: 'Brotherhood' },
    { id: 'mB', row: 3, col: 1, label: 'Win-Now Voice', text: 'Your players re-sign for 5% less · tax and request morale hits halved', pts: 3, req: ['mA'] },
    { id: 'mC', row: 4, col: 0, label: 'Player Council', text: 'Stars ask out 40% less often', pts: 4, req: ['m3'] },
    { id: 'mD', row: 4, col: 1, label: 'Hometown Discount', text: 'Your players re-sign for another 5% less', pts: 4, req: ['mB'] },
    { id: 'm4', row: 5, col: 0, wide: true, label: 'Franchise Identity', text: 'Morale can\'t fall under 40 · only Lv 90+ stars can ask out', pts: 6, req: ['mC', 'mD'] },
  ],
  scheme: [
    { id: 's1', row: 1, col: 0, spine: 1, label: 'Playbook' },
    { id: 's2', row: 2, col: 0, spine: 2, label: 'Defensive Systems' },
    { id: 'sA', row: 2, col: 1, label: 'Clipboard', text: 'One more tendency nudge for players 28 and older', pts: 2, req: ['s1'] },
    { id: 's3', row: 3, col: 0, spine: 3, label: 'Rotation Control' },
    { id: 'sB', row: 3, col: 1, label: 'Film Breakdown', text: 'A tendency can move one step further', pts: 3, req: ['sA'] },
    { id: 'sC', row: 4, col: 0, label: 'Motor Skills', text: 'High-motor players (15+) get two extra nudges', pts: 4, req: ['s3'] },
    { id: 'sD', row: 4, col: 1, label: 'Locker Room Trust', text: 'Your promises are believed: +10% odds on pitches and promises', pts: 4, req: ['sB'] },
    { id: 's4', row: 5, col: 0, wide: true, label: 'Franchise Voice', text: 'One more nudge for every player · promises believed another +10%', pts: 6, req: ['sC', 'sD'] },
  ],
};
export const EXTRA_IDS = Object.values(NODES).flat().filter(n => !n.spine).map(n => n.id);

export const headCoach = team => (team?.frontOffice?.staff || []).find(s => s.pos === 1) || null;

// Tiers the coach brings: a rating of 13+ is tier 1, 17+ tier 2.
export function coachTiers(coach) {
  const out = {};
  for (const b of BRANCHES) {
    const v = coach?.attributes?.[b.rating]?.[0] ?? 0;
    out[b.k] = v >= 17 ? 2 : v >= 13 ? 1 : 0;
  }
  return out;
}

export const tierOf = (tree, coach, k) => Math.min(MAX_TIER, Math.max(tree.bought[k] || 0, coachTiers(coach)[k]));
export const nodeOwned = (tree, coach, n, k) => n.spine ? tierOf(tree, coach, k) >= n.spine : !!tree.nodes?.[n.id];
// What the extra nodes add (all neutral when none are owned or the simple
// rules are on).
export function effects(tree, coach, on) {
  const has = id => on && !!tree.nodes?.[id];
  return {
    strMult: has('dA') ? 1.3 : 1,
    longMult: has('dB') ? 1.5 : 1,
    skillMult: has('dC') ? 1.3 : 1,
    lateBloom: has('dD') ? 1.12 : 1,
    labYoung: has('d4') ? 1.15 : 1,
    labPot: has('d4') ? 1.25 : 1,
    moraleLift: has('mA') ? 3 : 0,
    requestMult: (has('mA') ? 0.8 : 1) * (has('mC') ? 0.6 : 1),
    askMult: (has('mB') ? 0.95 : 1) * (has('mD') ? 0.95 : 1),
    moodHalf: has('mB'),
    moraleFloor: has('m4') ? 40 : 0,
    requestLv: has('m4') ? 90 : 0,
    nudgeVet: has('sA') ? 1 : 0,
    shiftPlus: has('sB') ? 1 : 0,
    motorPlus: has('sC') ? 2 : 0,
    nudgeAll: has('s4') ? 1 : 0,
    promiseBonus: (has('sD') ? 0.1 : 0) + (has('s4') ? 0.1 : 0),
  };
}

// What a finished season is worth (the last completed season's row).
export function seasonPoints(team, college) {
  const rows = (team.season || []).filter(s => s.seasonStats?.GP > 0);
  const row = rows[rows.length - 1];
  if (!row) return { pts: 1, why: ['A season on the job'], yr: null };
  const { W, L } = row.seasonStats;
  const pct = W + L ? W / (W + L) : 0;
  const why = ['A season on the job'];
  let pts = 1;
  if (pct > 0.5) { pts++; why.push(`Winning record (${W}-${L})`); }
  if (pct >= 0.65) { pts++; why.push('65%+ of games won'); }
  const post = row.playoffStats?.GP > 0;
  if (post) { pts++; why.push(college ? 'Made the tournament' : 'Made the playoffs'); }
  if ((row.seriesWins || 0) >= (college ? 2 : 2)) { pts++; why.push(college ? 'Sweet 16 run' : 'Won two rounds'); }
  const champ = college ? (row.finalsStats?.W || 0) >= 1 && (row.finalsStats?.L || 0) === 0 : (row.finalsStats?.W || 0) >= 4;
  if (champ) { pts++; why.push('Champions'); }
  return { pts, why, yr: row.yr };
}

// Effects.
export const devMult = t => 1 + 0.1 * t;
export const potMult = t => 1 + 0.15 * t;
export const recruitMult = t => 1 + 0.1 * t;
export const cultureCap = t => (t ? 12 + 2 * t : 0);

// Tendency nudges a player takes this offseason: the Scheme tier, plus one
// for young players and high-motor players, minus one for veterans.
export function nudgesFor(p, schemeTier, fx = {}) {
  const motor = (p.traits?.motor || 10) >= 15;
  let n = 1 + schemeTier + (p.age <= 23 ? 1 : 0) + (motor ? 1 + (fx.motorPlus || 0) : 0) - (p.age >= 31 ? 1 : 0)
    + (p.age >= 28 ? fx.nudgeVet || 0 : 0) + (fx.nudgeAll || 0);
  return Math.max(1, Math.min(8, n));
}
// How far one tendency can move from where the offseason started.
export const maxShift = (schemeTier, fx = {}) => (schemeTier >= 3 ? 3 : 2) + (fx.shiftPlus || 0);

// Game plan: the head coach's own scheme settings in the save (the game
// uses them when it sims). Each is a numbered option; 0 is the default most
// coaches use. Option names go in `names` once they're matched to the
// game's coach screen. Scheme tier 1 opens offense, 2 defense, 3 rotation.
export const PLAN = [
  { tier: 1, group: 'Offense', keys: [['offFocus', 'Offensive focus', 3], ['offTempo', 'Tempo', 1], ['offRebounding', 'Offensive rebounding', 2]] },
  { tier: 2, group: 'Defense', keys: [['defFocus', 'Defensive focus', 2], ['defAggression', 'Defensive aggression', 2], ['defRebounding', 'Defensive rebounding', 2]] },
  { tier: 3, group: 'Rotation', keys: [['benchDepth', 'Bench depth', 2], ['benchUtilization', 'Bench usage', 2], ['closingLineup', 'Closing lineup', 1]] },
];
export const PLAN_NAMES = {};
export const planOption = (k, v) => PLAN_NAMES[k]?.[v] || (v === 0 ? 'Default' : `Option ${v}`);
