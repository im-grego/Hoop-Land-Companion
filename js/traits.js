// Personality traits. Hoop Land keeps eight trait fields on every player
// (traits: durability, winning, money, loyalty, motor, lockerRoom,
// playoffRiser, roadWarrior) but never uses them, so the app fills and uses
// seven of them on a 1–20 scale (0 = not set). roadWarrior is left alone.
// Real players we know get judged values (REAL, by full name); everyone
// else is generated from his own data plus a little stable noise.

// Scale: 0-4 the low name, 5-9 Low, 10-15 Solid, 16-20 the high name.
export const TRAITS = [
  { k: 'durability', label: 'Durability', icon: '🩹', lo: 'Injury-prone', hi: 'Ironman', loIcon: '🩹', hiIcon: '🦾', loSays: 'always seems to be hurting', hiSays: 'rarely misses time' },
  { k: 'winning', label: 'Winning', icon: '🏆', lo: 'Indifferent', hi: 'Competitor', loIcon: '😐', hiIcon: '🏆', loSays: 'doesn\'t much care about the standings', hiSays: 'lives to win' },
  { k: 'money', label: 'Money', icon: '💰', lo: 'Team-friendly', hi: 'Bag-Chaser', loIcon: '🧢', hiIcon: '💰', loSays: 'plays for the team, not the contract', hiSays: 'follows the money' },
  { k: 'loyalty', label: 'Loyalty', icon: '🤝', lo: 'Mercenary', hi: 'Committed', loIcon: '🗡️', hiIcon: '🤝', loSays: 'goes where the offer is best', hiSays: 'stays where he\'s wanted' },
  { k: 'motor', label: 'Motor', icon: '⚙️', lo: 'Lazy', hi: 'Relentless', loIcon: '😴', hiIcon: '🔋', loSays: 'coasts when he can', hiSays: 'never stops working' },
  { k: 'lockerRoom', label: 'Locker Room', icon: '🗣️', lo: 'Cancer', hi: 'Leader', loIcon: '☣️', hiIcon: '🗣️', loSays: 'is a problem in the locker room', hiSays: 'sets the tone in the locker room' },
  { k: 'playoffRiser', label: 'Playoff Riser', icon: '🔥', lo: 'Shrinks', hi: 'Shines', loIcon: '🥶', hiIcon: '✨', loSays: 'shrinks in the big moments', hiSays: 'gets better when it matters' },
];
export const traitLabel = (t, v) => (v >= 16 ? t.hi : v <= 4 ? t.lo : v <= 9 ? 'Low' : 'Solid');
// The tag a trait earns at either end of the scale: { icon, label } or null.
export const traitTag = (t, v) => (v >= 16 ? { icon: t.hiIcon, label: t.hi } : v > 0 && v <= 4 ? { icon: t.loIcon, label: t.lo } : null);
// A line on his personality from the strongest traits (`keys` limits which
// ones are known).
export function personality(p, keys = null) {
  const says = TRAITS.filter(t => !keys || keys.includes(t.k)).map(t => ({ t, v: p.traits?.[t.k] || 0 }))
    .filter(x => x.v >= 16 || (x.v > 0 && x.v <= 4))
    .sort((a, b) => Math.abs(b.v - 10) - Math.abs(a.v - 10)).slice(0, 3)
    .map(x => (x.v >= 16 ? x.t.hiSays : x.t.loSays));
  if (!says.length) return 'A steady pro with no strong tendencies either way.';
  const text = says.length === 1 ? says[0] : `${says.slice(0, -1).join(', ')} and ${says[says.length - 1]}`;
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}
export const TRAIT_KEYS = TRAITS.map(t => t.k);
export const traitWord = v => v >= 16 ? 'High' : v >= 10 ? 'Solid' : v >= 5 ? 'Low' : 'Very low';
export const traitsSet = p => !!p.traits && TRAIT_KEYS.some(k => (p.traits[k] || 0) > 0);
export const tr = (p, k, d = 10) => (p.traits && p.traits[k] > 0 ? p.traits[k] : d);

// Judged from real careers: [durability, winning, money, loyalty, motor, lockerRoom, playoffRiser].
const REAL = {
  'LeBron James': [17, 19, 15, 6, 15, 15, 19], 'Stephen Curry': [12, 18, 12, 20, 17, 19, 17], 'Kevin Durant': [9, 18, 14, 4, 13, 11, 18],
  'Giannis Antetokounmpo': [15, 18, 13, 17, 20, 17, 17], 'Nikola Jokić': [18, 17, 9, 17, 14, 18, 18], 'Joel Embiid': [5, 16, 15, 15, 12, 13, 9],
  'Luka Dončić': [13, 17, 14, 12, 10, 12, 18], 'Jayson Tatum': [18, 17, 14, 15, 14, 15, 15], 'Kawhi Leonard': [4, 17, 16, 5, 14, 9, 19],
  'James Harden': [15, 13, 17, 3, 9, 7, 6], 'Damian Lillard': [15, 15, 13, 18, 15, 16, 14], 'Anthony Davis': [5, 16, 15, 9, 15, 14, 15],
  'Jimmy Butler': [11, 19, 13, 6, 20, 9, 19], 'Jimmy Butler III': [11, 19, 13, 6, 20, 9, 19], 'Kyrie Irving': [8, 13, 13, 4, 12, 6, 15],
  'Paul George': [10, 15, 15, 7, 13, 12, 9], 'Chris Paul': [12, 17, 13, 7, 16, 11, 12], 'Russell Westbrook': [17, 13, 14, 10, 20, 11, 9],
  'Devin Booker': [14, 15, 13, 17, 14, 14, 17], 'Donovan Mitchell': [15, 14, 14, 10, 15, 14, 16], 'Ja Morant': [9, 14, 15, 13, 17, 6, 14],
  'Zion Williamson': [3, 12, 14, 9, 11, 9, 10], 'Trae Young': [16, 13, 15, 13, 11, 10, 16], 'Shai Gilgeous-Alexander': [16, 17, 13, 15, 15, 17, 17],
  'Anthony Edwards': [17, 16, 14, 14, 16, 13, 17], 'Jaylen Brown': [14, 16, 16, 14, 16, 13, 15], 'Bam Adebayo': [15, 16, 12, 17, 17, 17, 13],
  'Domantas Sabonis': [18, 14, 13, 13, 17, 15, 9], 'De\'Aaron Fox': [15, 13, 13, 14, 16, 14, 13], 'Tyrese Haliburton': [14, 16, 12, 15, 14, 18, 17],
  'Karl-Anthony Towns': [13, 13, 14, 14, 11, 12, 12], 'Rudy Gobert': [16, 16, 13, 13, 16, 9, 7], 'Draymond Green': [15, 19, 12, 16, 19, 8, 17],
  'Klay Thompson': [8, 18, 12, 17, 14, 17, 18], 'Andrew Wiggins': [15, 13, 14, 12, 9, 12, 14], 'Jrue Holiday': [15, 18, 11, 12, 18, 19, 15],
  'Khris Middleton': [9, 16, 13, 17, 13, 15, 15], 'Brook Lopez': [14, 16, 11, 14, 13, 16, 13], 'DeMar DeRozan': [17, 14, 13, 13, 14, 16, 8],
  'Zach LaVine': [10, 11, 15, 12, 12, 11, 9], 'Pascal Siakam': [16, 15, 13, 14, 16, 15, 14], 'Fred VanVleet': [14, 16, 15, 13, 17, 17, 14],
  'Kyle Lowry': [14, 17, 12, 13, 19, 14, 14], 'Julius Randle': [15, 12, 14, 11, 14, 9, 7], 'Jalen Brunson': [16, 17, 12, 13, 17, 18, 18],
  'Mikal Bridges': [20, 15, 12, 14, 16, 16, 13], 'Kristaps Porziņģis': [5, 14, 14, 9, 11, 12, 11], 'Bradley Beal': [10, 11, 16, 15, 12, 12, 9],
  'Paolo Banchero': [16, 15, 13, 14, 15, 15, 15], 'Victor Wembanyama': [12, 17, 12, 15, 17, 17, 14], 'Chet Holmgren': [11, 16, 12, 15, 15, 15, 13],
  'Lauri Markkanen': [12, 13, 13, 14, 13, 15, 10], 'Jamal Murray': [7, 16, 13, 16, 14, 14, 19], 'Michael Porter Jr.': [5, 14, 14, 13, 10, 11, 11],
  'Aaron Gordon': [14, 17, 12, 13, 16, 16, 15], 'Darius Garland': [12, 13, 13, 14, 12, 14, 10], 'Evan Mobley': [15, 15, 12, 15, 15, 15, 12],
  'Jarrett Allen': [14, 14, 12, 14, 14, 15, 9], 'Scottie Barnes': [16, 14, 13, 15, 17, 15, 12], 'Cade Cunningham': [12, 15, 13, 16, 15, 16, 14],
  'Franz Wagner': [15, 15, 12, 16, 15, 16, 13], 'Alperen Şengün': [15, 14, 12, 14, 14, 13, 12], 'Jalen Green': [16, 11, 14, 11, 11, 10, 9],
  'LaMelo Ball': [6, 12, 14, 13, 12, 10, 11], 'Brandon Ingram': [10, 12, 15, 10, 12, 12, 10], 'CJ McCollum': [14, 13, 12, 13, 13, 17, 12],
  'Dejounte Murray': [14, 13, 14, 11, 14, 12, 10], 'Derrick White': [16, 17, 11, 13, 17, 17, 15], 'Al Horford': [14, 18, 11, 12, 15, 19, 15],
  'Marcus Smart': [11, 17, 12, 14, 20, 13, 14], 'Robert Williams III': [4, 14, 12, 14, 14, 15, 11], 'Tobias Harris': [16, 12, 15, 11, 12, 15, 7],
  'Tyrese Maxey': [15, 15, 13, 15, 16, 17, 14], 'Ben Simmons': [5, 10, 14, 7, 7, 5, 4], 'Deandre Ayton': [13, 11, 15, 9, 9, 10, 9],
  'Jaren Jackson Jr.': [10, 14, 13, 14, 15, 14, 10], 'Desmond Bane': [14, 15, 12, 15, 16, 16, 13], 'Myles Turner': [14, 13, 13, 15, 13, 14, 12],
  'Jusuf Nurkić': [9, 12, 13, 12, 13, 11, 8], 'Nikola Vučević': [17, 12, 13, 13, 12, 14, 9], 'Kyle Kuzma': [14, 13, 15, 10, 12, 11, 11],
  'Jerami Grant': [15, 11, 15, 9, 13, 14, 10], 'Harrison Barnes': [18, 14, 12, 13, 13, 17, 12], 'Buddy Hield': [18, 11, 13, 11, 13, 15, 10],
  'Gordon Hayward': [7, 12, 14, 9, 11, 14, 8], 'John Collins': [15, 11, 14, 11, 13, 11, 9], 'Clint Capela': [13, 13, 12, 12, 15, 14, 9],
  'Malcolm Brogdon': [7, 14, 13, 11, 14, 17, 12], 'Spencer Dinwiddie': [13, 11, 14, 8, 12, 12, 10], 'Bojan Bogdanović': [14, 13, 12, 10, 12, 14, 12],
  'Jordan Clarkson': [16, 11, 13, 13, 12, 14, 9], 'Mike Conley': [13, 15, 11, 15, 15, 19, 13], 'Austin Reaves': [15, 15, 13, 14, 16, 16, 15],
  'D\'Angelo Russell': [12, 11, 14, 7, 10, 9, 5], 'Terry Rozier': [15, 12, 14, 11, 14, 12, 12], 'Bogdan Bogdanović': [11, 14, 12, 12, 13, 15, 13],
  'OG Anunoby': [10, 15, 14, 12, 15, 15, 13], 'Jalen Williams': [16, 15, 12, 15, 16, 16, 15], 'Josh Giddey': [15, 12, 13, 12, 12, 10, 7],
  'Dennis Schröder': [16, 12, 14, 7, 15, 10, 11], 'Josh Hart': [17, 16, 12, 13, 20, 16, 16], 'Alex Caruso': [13, 17, 11, 13, 19, 17, 15],
  'P.J. Tucker': [16, 18, 11, 9, 18, 15, 15], 'Joe Ingles': [14, 15, 10, 13, 13, 18, 11], 'Patrick Beverley': [12, 15, 12, 7, 19, 9, 13],
  'Kevin Love': [9, 16, 12, 15, 13, 17, 13], 'Derrick Rose': [3, 14, 12, 12, 15, 17, 12], 'Blake Griffin': [6, 13, 13, 10, 14, 15, 10],
  'Carmelo Anthony': [15, 11, 14, 9, 12, 13, 10], 'Dwight Howard': [12, 13, 13, 6, 14, 7, 9], 'Andre Drummond': [16, 10, 14, 8, 12, 10, 6],
  'Hassan Whiteside': [13, 9, 15, 7, 9, 5, 6], 'Kemba Walker': [8, 12, 12, 16, 14, 17, 11], 'Victor Oladipo': [4, 12, 13, 10, 14, 13, 13],
  'Dwyane Wade': [9, 18, 11, 19, 17, 17, 18], 'Dirk Nowitzki': [17, 17, 6, 20, 15, 18, 17], 'Tim Duncan': [17, 19, 7, 20, 15, 20, 18],
  'Kobe Bryant': [15, 20, 13, 20, 19, 10, 18], 'Tony Parker': [15, 18, 10, 18, 15, 16, 16], 'Manu Ginóbili': [12, 19, 8, 20, 18, 19, 18],
};

const hash = (a, b) => { let h = (a * 2654435761 ^ b * 40503) >>> 0; h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0; return (h >>> 0) / 4294967296; };
const gauss = (id, salt) => { const u = Math.max(1e-6, hash(id, salt)), v = hash(id, salt + 7); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp20 = v => Math.max(1, Math.min(20, Math.round(v)));
const att = (p, k) => p.attributes?.[k]?.[0] ?? 10;

// Seasons with stats in the pro league (league 0), oldest first, with the
// team each ended on.
function proSeasons(p) {
  return (p.stats || []).filter(s => s.league === 0 && (s.season || []).some(r => r.GP > 0))
    .sort((a, b) => a.yr - b.yr).map(s => ({ yr: s.yr, tid: s.season[s.season.length - 1].tid, rows: s.season, po: s.playoffs || [] }));
}

// Generated from his own data (for players REAL doesn't know).
export function generateTraits(p, teamId = p.tid) {
  const n = (k, sd = 1.6) => gauss(p.id, k.length * 131 + 17) * sd;
  const cs = p.careerStats?.season || {}, po = p.careerStats?.playoffs || {};
  const seasons = proSeasons(p);
  const yrs = Math.max(seasons.length, p.yrs || 0);
  const t = p.tendencies || {};
  // Durability reads the body and the game, not injury history (leagues
  // here carry only a little): frame and strain on it, how much contact his
  // style invites, conditioning, and age.
  const ht = p.ht || 78, wt = p.wt || 210;
  const bmi = wt / (ht * ht) * 703;
  const strain = Math.max(0, bmi - 26) * 0.7 + Math.max(0, ht - 82) * 0.5 + Math.max(0, 74 - ht) * 0.15;
  const contact = ((t.dunk || 0) + (t.post || 0) + (t.hook || 0) + (t.floater || 0) + (t.takeCharge || 0) + (t.offReb || 0) + (t.block || 0)) * 0.12;
  const body = (att(p, 'STR') - 10) * 0.15 + (att(p, 'STM') - 10) * 0.2 + (att(p, 'SPD') > 16 ? -0.5 : 0);
  const durability = 10 + body - strain - contact - Math.max(0, p.age - 29) * 0.45 + (p.age <= 24 ? 0.8 : 0) + n('durability', 2);
  const min36 = (cs.MIN?.[0] || 0) / 60 / 36;
  const hustle = min36 > 5 ? ((cs.ORB || 0) + (cs.STL || 0) * 1.5) / min36 : 3;
  const motor = 3 + att(p, 'STM') * 0.45 + ((t.offReb || 0) + (t.takeCharge || 0) + (t.stealOffBall || 0)) * 0.25 + Math.min(4, hustle * 0.6) + n('motor', 2);
  const wins = (cs.W || 0) + (cs.L || 0) ? (cs.W || 0) / ((cs.W || 0) + (cs.L || 0)) : 0.5;
  const winning = 9 + (wins - 0.5) * 12 + Math.min(4, (po.GP || 0) / 25) + (p.age >= 31 ? 2 : 0) + n('winning', 2.2);
  const money = 10 + (p.age <= 27 ? 1.5 : p.age >= 33 ? -2 : 0) + n('money', 3);
  // Loyalty: seasons in a row with this team, drafted here, few teams.
  let run = 0;
  for (let i = seasons.length - 1; i >= 0 && seasons[i].tid === teamId; i--) run++;
  const teams = new Set(seasons.flatMap(s => s.rows.map(r => r.tid))).size;
  const drafted = p.history?.draft?.tid === teamId && p.history?.draft?.rd > 0;
  const loyalty = 7 + run * 1.1 + (drafted ? 3 : 0) - Math.max(0, teams - 2) * 0.8 + n('loyalty', 2.2);
  const morale = p.season?.morale ?? 70;
  const lockerRoom = 8 + Math.min(5, yrs * 0.5) + (morale - 60) / 15 + Math.min(2, (p.awards || []).length * 0.3) + n('lockerRoom', 2.4);
  const ppm = (st) => (st.MIN?.[0] ? (st.PTS + 0.7 * st.REB + 0.7 * st.AST) / (st.MIN[0] / 60) : 0);
  const playoffRiser = (po.GP || 0) >= 10 && ppm(cs) > 0 ? 10 + (ppm(po) / ppm(cs) - 1) * 25 + n('playoffRiser', 1.5) : 10 + n('playoffRiser', 2.5);
  return { durability, winning, money, loyalty, motor, lockerRoom, playoffRiser };
}

// Fill every unset player (pros, free agents, prospects) in a league.
// Returns how many were filled. Real players get REAL values (by name).
export function fillTraits(L) {
  return fillPairs([...L.teams.flatMap(t => t.roster.map(p => [p, t.id])), ...(L.freeAgents || []).map(p => [p, 0]), ...(L.draftClass || []).map(p => [p, 0])]);
}
// The same for any list of players (retirees, Hall of Famers, all-star squads).
export const fillTraitsList = players => fillPairs(players.map(p => [p, 0]));
function fillPairs(everyone) {
  let n = 0;
  for (const [p, tid] of everyone) {
    // Saves from the newer game builds drop the traits block; make one so the app can keep its own.
    if (!p.traits) p.traits = Object.fromEntries(TRAIT_KEYS.map(k => [k, 0]));
    // Values written on a 0-100 scale (an edited player) come down to 1-20.
    if (TRAIT_KEYS.some(k => p.traits[k] > 20)) {
      for (const k of TRAIT_KEYS) if (p.traits[k] > 0) p.traits[k] = clamp20(p.traits[k] / 5);
      n++;
      continue;
    }
    if (traitsSet(p)) continue;
    const real = REAL[`${p.fn} ${p.ln}`.trim()];
    const g = real ? Object.fromEntries(TRAIT_KEYS.map((k, i) => [k, real[i]])) : generateTraits(p, tid);
    for (const k of TRAIT_KEYS) p.traits[k] = clamp20(g[k]);
    n++;
  }
  return n;
}
export const isReal = p => !!REAL[`${p.fn} ${p.ln}`.trim()];
