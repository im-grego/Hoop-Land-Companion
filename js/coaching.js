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
  { k: 'dev', label: 'Player Development', icon: '📈', rating: 'development',
    tiers: ['+10% offseason progression, +15% potential odds', '+20% progression, +30% potential odds', '+30% progression, +45% potential odds'] },
  { k: 'scheme', label: 'Scheme', icon: '🧠', rating: 'leadership',
    tiers: ['2 tendency nudges per player', '3 nudges per player', '4 nudges per player; a tendency can move 3'] },
  { k: 'culture', label: 'Culture', icon: '🤝', rating: 'motivation',
    tiers: ['+1 Locker Room and Loyalty (up to 14) · +10% recruiting pull', '+2 (up to 16) · +20% recruiting pull', '+3 (up to 18) · +30% recruiting pull'] },
];
export const TIER_COST = [1, 2, 3];
export const MAX_TIER = 3;

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
export function nudgesFor(p, schemeTier) {
  let n = 1 + schemeTier + (p.age <= 23 ? 1 : 0) + ((p.traits?.motor || 10) >= 15 ? 1 : 0) - (p.age >= 31 ? 1 : 0);
  return Math.max(1, Math.min(6, n));
}
// How far one tendency can move from where the offseason started.
export const maxShift = schemeTier => (schemeTier >= 3 ? 3 : 2);
