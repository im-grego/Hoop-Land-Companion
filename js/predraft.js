// Pre-draft events: the Draft Combine (measurements, drills, Hoop Gram
// trending posts) and the combine's effect on draft stock.
//
// Every result comes from the prospect's ratings plus a stable random
// factor (same save + prospect = same result), so drills hint at ratings
// without showing them.

import { mulberry32 } from './progression.js';
import { injuryName, injuryPart, playerName } from './savefile.js';

const A = (p, k) => p.attributes?.[k]?.[0] ?? 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function rngFor(salt, id, n) {
  return mulberry32(((salt ^ Math.imul(id + 1, 2654435761) ^ Math.imul(n + 1, 40503)) >>> 0) || 1);
}
function gauss(rng) {
  const u = Math.max(1e-9, rng()), w = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
}
const q = v => Math.round(v * 4) / 4;     // quarter inches
const lc = t => t.toLowerCase().replace(/\b(acl|mcl)\b/g, m => m.toUpperCase());

export const DRILLS = [
  { k: 'sprint', short: '¾ Sprint', name: '3/4-Court Sprint', unit: 's', low: true, dec: 2, group: 'ath' },
  { k: 'lane', short: 'Lane Agility', name: 'Lane Agility', unit: 's', low: true, dec: 2, group: 'ath' },
  { k: 'shuttle', short: 'Shuttle Run', name: 'Shuttle Run', unit: 's', low: true, dec: 2, group: 'ath' },
  { k: 'maxVert', short: 'Max Vert', name: 'Max Vertical', unit: '"', dec: 1, group: 'ath' },
  { k: 'standVert', short: 'Standing Vert', name: 'Standing Vertical', unit: '"', dec: 1, group: 'ath' },
  { k: 'bench', short: 'Bench Press', name: 'Bench Press (185 lb)', unit: ' reps', dec: 0, group: 'ath' },
  { k: 'spot', short: 'Spot-Up', name: 'Spot-Up Shooting', unit: '/25', dec: 0, group: 'shoot' },
  { k: 'dribble', short: 'Off Dribble', name: 'Off-the-Dribble Shooting', unit: '/25', dec: 0, group: 'shoot' },
  { k: 'ft', short: 'Free Throws', name: 'Free Throws', unit: '/25', dec: 0, group: 'shoot' },
];
export const MEASURES = [
  { k: 'htNs', name: 'Height (no shoes)' },
  { k: 'ws', name: 'Wingspan' },
  { k: 'reach', name: 'Standing Reach' },
  { k: 'wt', name: 'Weight' },
];

// Inches as 6'7.25".
export const inchStr = v => {
  const ft = Math.floor(v / 12), inch = v - ft * 12;
  return `${ft}'${Number.isInteger(inch) ? inch : inch.toFixed(2).replace(/0$/, '')}"`;
};
export const fmtDrill = (d, v) => v == null ? 'DNP' : `${v.toFixed(d.dec)}${d.unit}`;

// Medical flags from the prospect's injury history in the save.
export function medicalFlag(p) {
  const list = (p.history?.injuries || []).filter(i => i.gamesOut > 0);
  if (!list.length) return null;
  const major = list.filter(i => i.majorSeverity > 0).sort((a, b) => b.gamesOut - a.gamesOut)[0];
  const byPart = new Map();
  for (const i of list) { const k = injuryPart(i); if (k) byPart.set(k, (byPart.get(k) || 0) + 1); }
  const [part, n] = [...byPart].sort((a, b) => b[1] - a[1])[0] || [];
  if (major) return { level: 'red', text: `${injuryName(major)} (${major.gamesOut} games missed)`, major, list };
  if (n >= 2) return { level: 'yellow', text: `Recurring ${part.toLowerCase()} issues (${n} injuries)`, list };
  return { level: 'note', text: `${injuryName(list[list.length - 1])} in college`, list };
}

// One prospect's combine.
function testPlayer(p, salt, skipAth) {
  const r = rngFor(salt, p.id, 7);
  const g = () => gauss(r);
  const SPD = A(p, 'SPD'), STR = A(p, 'STR'), STM = A(p, 'STM'), DNK = A(p, 'DNK');
  const ht = p.ht || 78, wt = p.wt || 205;
  const htNs = q(ht - 1.25 + g() * 0.25);
  const ws = q(htNs + 2.8 + ((A(p, 'BLK') + A(p, 'STL') + A(p, 'DRE')) / 3 - 9) * 0.3 + g() * 1.6);
  const reach = q(0.648 * (htNs + ws) + g() * 0.5);
  const res = { htNs, ws, wt, reach, wingDiff: ws - htNs };
  // Draw every random number in the same order whether or not they test,
  // so skipping doesn't shift the shooting results.
  const ath = {
    sprint: 3.62 - (SPD - 8) * 0.04 + (wt - 205) * 0.0012 + g() * 0.12,
    lane: 11.9 - (SPD - 8) * 0.085 + (ht - 78) * 0.035 + g() * 0.38,
    shuttle: 3.35 - (SPD - 8) * 0.022 - (STM - 8) * 0.014 + (ht - 78) * 0.008 + g() * 0.1,
  };
  ath.maxVert = 30 + DNK * 0.32 + (SPD - 8) * 0.38 - (wt - 205) * 0.035 + g() * 2.6;
  ath.standVert = ath.maxVert * 0.79 - 0.5 + g() * 1.6;
  ath.bench = Math.max(0, Math.round(3 + (STR - 8) * 1.45 + (wt - 205) * 0.05 + g() * 3));
  const shot = (base, per, rating, sd) => clamp(Math.round(25 * clamp(base + rating * per, 0, 1) + g() * sd), 0, 25);
  const shoot = {
    spot: shot(0.28, 0.032, A(p, 'TPT'), 2.4),
    dribble: shot(0.22, 0.031, A(p, 'MID') * 0.6 + A(p, 'DRB') * 0.4, 2.4),
    // Free throws: FTS (16 is a real-world elite cap) with a little mid-range touch.
    ft: shot(0.36, 0.032, A(p, 'FTS') * 0.8 + A(p, 'MID') * 0.2, 2.0),
  };
  ath.sprint = +ath.sprint.toFixed(2); ath.lane = +ath.lane.toFixed(2); ath.shuttle = +ath.shuttle.toFixed(2);
  ath.maxVert = +ath.maxVert.toFixed(1); ath.standVert = +ath.standVert.toFixed(1);
  for (const k of Object.keys(ath)) res[k] = skipAth ? null : ath[k];
  Object.assign(res, shoot);
  return res;
}

const SKIP_REASONS = {
  top: 'Projected top pick: no reason to risk his stock in testing',
  private: 'Saving it for private workouts with teams',
};

// The whole class. `top` = prospect ids in projected order (Mock 1.0), used
// to decide who sits out. Returns { byId: Map, drills, skips, stats }.
// Pro height / weight by position (±1 spot), for size checks.
export function proSize(pros) {
  const out = [];
  for (let pos = 0; pos <= 8; pos++) {
    const peers = pros.filter(p => Math.abs(p.pos - pos) <= 1 && p.ht > 0);
    const st = vals => { const m = vals.reduce((a, b) => a + b, 0) / (vals.length || 1); return { m, sd: Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length || 1)) || 1 }; };
    out[pos] = { ht: st(peers.map(p => p.ht)), wt: st(peers.map(p => p.wt).filter(w => w > 0)), stm: st(peers.map(p => A(p, 'STM'))) };
  }
  return out;
}

export function runCombine(cls, salt, top = [], pros = []) {
  const size = proSize(pros);
  const rank = new Map(top.map((id, i) => [id, i]));
  const skips = new Map();
  for (const p of cls) {
    const rk = rank.get(p.id);
    const med = medicalFlag(p);
    const r = rngFor(salt, p.id, 3);
    if (med?.level === 'red' && (rk ?? 99) < 40 && r() < 0.55) skips.set(p.id, `Medical: still working back from a ${med.major ? lc(injuryName(med.major)) : 'past injury'}`);
    else if (rk != null && rk < 6 && r() < 0.4) skips.set(p.id, rk < 2 ? SKIP_REASONS.top : SKIP_REASONS.private);
  }
  const byId = new Map(cls.map(p => {
    const ps = size[p.pos] || size[4];
    const htZ = ((p.ht || 0) - ps.ht.m) / ps.ht.sd, wtZ = p.wt > 0 ? (p.wt - ps.wt.m) / ps.wt.sd : 0;
    const pro = { ht: ps.ht.m, wt: ps.wt.m, htZ, wtZ, sizeZ: 0.65 * htZ + 0.35 * wtZ };
    return [p.id, { ...testPlayer(p, salt, skips.has(p.id)), skip: skips.get(p.id) || null, medical: medicalFlag(p), pro }];
  }));
  // Class means / spreads for each drill.
  const stats = {};
  for (const d of [...DRILLS, { k: 'wingDiff' }]) {
    const vals = [...byId.values()].map(x => x[d.k]).filter(v => v != null);
    const m = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length || 1)) || 1;
    stats[d.k] = { m, sd };
  }
  const z = (k, v, low) => v == null ? null : ((v - stats[k].m) / stats[k].sd) * (low ? -1 : 1);
  for (const [id, x] of byId) {
    const az = DRILLS.filter(d => d.group === 'ath').map(d => z(d.k, x[d.k], d.low) * (d.k === 'bench' ? 0.5 : 1)).filter(v => v != null);
    const sz = DRILLS.filter(d => d.group === 'shoot').map(d => z(d.k, x[d.k], d.low));
    x.athZ = az.length ? az.reduce((a, b) => a + b, 0) / az.length : null;
    x.shootZ = sz.reduce((a, b) => a + b, 0) / sz.length;
    x.wingZ = z('wingDiff', x.wingDiff);
    // Stock: bad physical testing hurts more than good testing helps.
    let b = 0.32 * (x.athZ ?? 0) + 0.12 * x.shootZ + 0.14 * x.wingZ + 0.12 * clamp(x.pro.sizeZ, -2.5, 1.5);
    if (b < 0) b *= 1.7;
    if (x.medical?.level === 'red') b -= 0.25;
    else if (x.medical?.level === 'yellow') b -= 0.1;
    x.bonus = clamp(b, -1.1, 0.55);
  }
  // Leaderboards (best first; DNP last).
  const boards = {};
  for (const d of DRILLS) {
    boards[d.k] = cls.map(p => ({ p, v: byId.get(p.id)[d.k] }))
      .sort((a, b) => (a.v == null) - (b.v == null) || (d.low ? a.v - b.v : b.v - a.v));
  }
  return { byId, boards, skips, stats };
}

// ---------------------------------------------------------------------------
// Hoop Gram: trending posts about the combine's outliers. `rank` maps id →
// projected spot (Mock 1.0), so the feed favours names people know.

const HANDLES = ['@HoopGramDraft', '@CombineCentral', '@DraftIntelHL', '@LaneAgilityGuy', '@MedWatchHL', '@BigBoardBen'];
const handleFor = (id, n) => HANDLES[(id * 7 + n) % HANDLES.length];

export function hoopGram(cls, combine, rank = new Map(), salt = 0) {
  const posts = [];
  const name = p => playerName(p);
  const known = p => (rank.get(p.id) ?? 99) < 45;
  const rk = p => rank.get(p.id);
  const proj = p => rk(p) != null && rk(p) < 30 ? ` (No. ${rk(p) + 1} in our first mock)` : '';
  const add = (p, score, text, tag, handle = 0) => posts.push({ p, score, text, tag, handle: handleFor(p.id, handle), likes: 800 + ((Math.imul(p.id + salt, 2654435761) >>> 0) % 9000) + Math.round(score * 900) });
  const C = combine.byId;

  // Perfect / near-perfect shooting.
  for (const p of cls) {
    const x = C.get(p.id);
    for (const [k, label] of [['spot', 'spot-up'], ['dribble', 'off-the-dribble'], ['ft', 'free throw']]) {
      if (x[k] === 25) add(p, 9 + (known(p) ? 2 : 0), `PERFECT. ${name(p)} went 25 for 25 in the ${label} drill${proj(p)}. Scouts in the gym stopped talking.`, '🎯 Perfect', 1);
      else if (x[k] === 24 && known(p)) add(p, 5, `${name(p)} hit 24 of 25 in the ${label} drill${proj(p)}. That jumper is real.`, '🔥 Shooting', 1);
    }
  }
  // Arms.
  const arms = cls.map(p => ({ p, d: C.get(p.id).wingDiff })).sort((a, b) => a.d - b.d);
  for (const { p, d } of arms.filter(a => a.d < 0).slice(0, 2)) {
    add(p, 6 + (known(p) ? 2 : 0) - d, `Measurements are out: ${name(p)} has a ${inchStr(C.get(p.id).ws)} wingspan, ${Math.abs(d).toFixed(2).replace(/\.?0+$/, '')}" SHORTER than his height${proj(p)}. Short arms show up on defense.`, '📏 Short Arms', 2);
  }
  for (const { p, d } of arms.filter(a => a.d >= 7).slice(-2).reverse()) {
    add(p, 5 + (known(p) ? 2 : 0) + d / 3, `${name(p)} measured a ${inchStr(C.get(p.id).ws)} wingspan, +${d.toFixed(2).replace(/\.?0+$/, '')}" on his height${proj(p)}. Those are pterodactyl arms.`, '🦅 Wingspan', 2);
  }
  // Small for the pros at his position (height and weight).
  const POS = ['PG', 'G', 'SG', 'GF', 'SF', 'F', 'PF', 'FC', 'C'];
  const small = cls.filter(known).map(p => ({ p, x: C.get(p.id) })).filter(({ x }) => x.pro.sizeZ < -1.3 || (x.pro.wtZ < -1.6 && x.pro.htZ > -0.6))
    .sort((a, b) => a.x.pro.sizeZ - b.x.pro.sizeZ).slice(0, 2);
  for (const { p, x } of small) {
    const slight = x.pro.wtZ < -1.6 && x.pro.htZ > -0.6;
    const ftIn = v => `${Math.floor(v / 12)}'${Math.round(v % 12)}"`;
    add(p, 6 + (rk(p) < 14 ? 2 : 0), slight
      ? `${name(p)} weighed in at ${p.wt} lb${proj(p)}. The average pro ${POS[p.pos]} is ${Math.round(x.pro.wt)}. He'll need to add weight to hold up.`
      : `${name(p)} measured ${inchStr(x.htNs)} without shoes at ${p.wt} lb${proj(p)}. Small for a pro ${POS[p.pos]} (avg ${ftIn(x.pro.ht)}, ${Math.round(x.pro.wt)} lb).`,
      slight ? '⚖️ Slight Frame' : '📐 Undersized', 2);
  }
  // Leaders.
  const lead = (k, text, tag, h) => { const top = combine.boards[k][0]; if (top?.v != null) add(top.p, 4 + (known(top.p) ? 2 : 0), text(top.p, top.v), tag, h); };
  lead('maxVert', (p, v) => `${name(p)} touched the sky: a ${v.toFixed(1)}" max vertical, best in the class${proj(p)}.`, '🚀 Bounce', 3);
  lead('sprint', (p, v) => `Fastest man in the building: ${name(p)}, ${v.toFixed(2)}s in the 3/4-court sprint${proj(p)}.`, '⚡ Speed', 3);
  lead('bench', (p, v) => `${name(p)} put up 185 lb ${v} times. Grown-man strength${proj(p)}.`, '💪 Strength', 3);
  // Sat out.
  for (const [id, why] of combine.skips) {
    const p = cls.find(x => x.id === id);
    if (!p) continue;
    const reason = why.startsWith('Medical') ? `he's still working back from a ${why.split('from a ')[1]}` : why.startsWith('Projected') ? 'he\'s a projected top pick with nothing to prove in the drills' : 'he\'s saving it for private workouts with teams';
    add(p, 7 + (known(p) ? 2 : 0), `${name(p)} won't take part in athletic testing${proj(p)}. Word from his camp: ${reason}.`, why.startsWith('Medical') ? '🩺 Medical' : '🪑 Sat Out', 4);
  }
  // Medical reports for names people know.
  for (const p of cls.filter(known)) {
    const m = C.get(p.id).medical;
    if (!m || m.level === 'note' || combine.skips.has(p.id)) continue;
    add(p, m.level === 'red' ? 7 : 4, `Medical report on ${name(p)}${proj(p)}: ${m.text}. ${m.level === 'red' ? 'Some teams will have him lower on their boards.' : 'Teams will want a closer look.'}`, '🩺 Medical', 4);
  }
  // Risers and fallers among names people know.
  const movers = cls.filter(known).map(p => ({ p, b: C.get(p.id).bonus })).sort((a, b) => b.b - a.b);
  if (movers[0]?.b > 0.2) add(movers[0].p, 8, `Biggest winner of the combine? ${name(movers[0].p)}${proj(movers[0].p)}. Tested off the charts and is shooting up boards.`, '📈 Riser', 5);
  const worst = movers[movers.length - 1];
  if (worst?.b < -0.3) add(worst.p, 8, `Rough week for ${name(worst.p)}${proj(worst.p)}. The athletic testing didn't back up the tape, and teams noticed.`, '📉 Faller', 5);
  // One post per player and per kind of story: no storyline twice.
  const seenP = new Set(), seenT = new Set();
  return posts.sort((a, b) => b.score - a.score).filter(x => {
    if (seenP.has(x.p.id) || seenT.has(x.tag)) return false;
    seenP.add(x.p.id); seenT.add(x.tag);
    return true;
  }).slice(0, 12);
}
