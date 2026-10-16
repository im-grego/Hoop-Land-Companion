import {
  parseSave, serializeSave, ATTRS, ATTR_NAMES, PHYSICAL, attrMin, skillName, skillCategory, isEliteSkill, isFreeSkill, ELITE_REQUIREMENTS, ELITE_MIN, ATTR_MAX, activeSkills, isLeveled, CATEGORIES, SKILL_MAX_LEVEL, POSITIONS, MODE_NAMES, phaseName, BUMP_PHASES, BUMP_DAY, POT_MIN, POT_MAX, regressionYear, injuryName, PHASE_POST_DRAFT, PHASE_PRE_DRAFT, leagueRookies,
  playerName, heightStr, avgRating, lastSeasonMpg, leaguePlayers, snapshot, restore, diffPlayer, jerseyClashes, fixJerseyNumbers, undoJerseyNumbers, levelOf,
} from './savefile.js';
import { DEFAULT_PARAMS, runProgression, buildSkillProfiles, rankSkillsFor, unlockSkill, mulberry32, runRookieBump, injuryRisk, earnsNaturalLongevity, productionScores } from './progression.js';
import {
  SKILL_ATTRS, DRAFT_DROP, DRAFT_FLOOR, floorVector, rookieLine, ceilingVector, buildCompPool, prospectComps, prospectValue,
  lotterySetup, lotteryOdds, runLottery, drawLottery, draftOrder, teamRecord, cpuPick, tradePicks, pickValue, lotteryDone, actualDraftOrder, rookieComps,
  recoveryFor, projectedRookie, originalRatings, applySummerLeague, tierFor, scoutingReport, projectedCeiling, scoutedPot,
  assignClassComps, rookieFloorVector, collegeLine, rosterSlot,
  needBaseline, teamNeeds, needsFilled, isWinNow, teamStatus, STATUS_NAMES, classScales, draftScore, LOTTERY_FORMATS,
} from './draft.js';
import { mentorPairs, runMentorship } from './mentorship.js';
import { buildStorylines, seasonLine } from './storylines.js';
import { applyDraft, rookieContractTargets, applyRookieContracts, undoRookieContracts, newLiveDraft, clockIndex, makeSelection, takenIds, tradeableProspects, livePicks, slotPick, tradeUpOffers } from './livedraft.js';
import { slotValue, playerValue, cpuAccepts, executeTrade, undoTrade, contractValue } from './trades.js';
import * as FA from './freeagency.js';
import { runSummerLeague, summerReward, undoSummerReward, mvpName } from './summer.js';
import { applyLottery, preLotteryOrder, startFreeAgency, nextFreeAgencyDay } from './phases.js';
import { BUILT_IN_APP_KEY, dropboxConfig, saveDropboxConfig, dropboxConnected, disconnectDropbox, dropboxAuthUrl, dropboxFinishAuth, dropboxUpload, dropboxPath } from './dropbox.js';

const APP_VERSION = '0.28.0';
const $app = document.getElementById('app');

// ---------------------------------------------------------------------------
// State

const state = {
  fileName: null,
  data: null,
  leagueIdx: 0,
  snaps: new Map(),        // `${leagueIdx}:${pid}` -> original attributes/skills
  profiles: [],            // per league skill profiles (from original data)
  leagueAvg: [],           // per league average attribute vector
  userTeams: new Set(),    // team ids the user controls (current league)
  auto: {},                // leagueIdx -> bump summary
  rookieAuto: {},          // leagueIdx -> rookie bump summary
  summer: {},              // leagueIdx -> { players, points } once the age adjustment ran this session
  summerTour: {},          // leagueIdx -> { result, reward } once the summer league tournament ran
  mentor: {},              // leagueIdx -> { seed, list: [{ teamId, mentorId, menteeId, skill, cpu }] }
  contracts: {},           // leagueIdx -> rookie contract changes (for undo)
  fa: {},                  // leagueIdx -> free agency day state
  awards: {},              // leagueIdx -> Map pid -> points awarded
  draft: {},               // leagueIdx -> { lottery, mock, trades }
  compPools: {},
  compCache: {},
  params: loadParams(),
  dirty: false,
  stack: [],
};

function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem('hlc:params'));
    if (saved) {
      // v3 changed the bump to award points; older settings don't apply.
      if ((saved.version || 0) < 3) return structuredClone(DEFAULT_PARAMS);
      // v4 flipped summer league recovery (older rookies win back more).
      if (saved.version < 4) delete saved.recoveryBands;
      // v5 rescaled injury risk for natural (unedited) injuries.
      if (saved.version < 5) for (const k of ['injuryMinGames', 'injuryPotPerGame']) delete saved[k];
      if (saved.version < 7) for (const k of ['softTissueParts', 'softTissueMult', 'softTissuePointsMult', 'structuralParts', 'structuralMult']) delete saved[k]; // v7 injury classes
      if (saved.version < 8) delete saved.structuralParts; // v8 added Ankle, Back
      if (saved.version < 9) for (const k of ['mentorMinAge', 'menteeMaxAge', 'mentorPosRange']) delete saved[k]; // v9 mentorship rules
      if (saved.version < 10) for (const k of ['regDownProdZ', 'regDownProdChance']) delete saved[k]; // v10 trainer tuning
      if (saved.version < 11) for (const k of ['potUpChance', 'prodPotUpPerZ', 'prodPotDownZ', 'prodPotDownChance', 'potDownChance', 'rookieR1Mult', 'rookieR2Mult', 'rookieUndraftedMult']) delete saved[k]; // v11 potential balance
      return { ...structuredClone(DEFAULT_PARAMS), ...saved };
    }
  } catch { /* storage unavailable */ }
  return structuredClone(DEFAULT_PARAMS);
}
function saveParams() {
  try { localStorage.setItem('hlc:params', JSON.stringify({ ...state.params, version: 11 })); } catch { /* ignore */ }
}
function teamsKey() { return `hlc:teams:${league().meta?.saveName || state.fileName}:${state.leagueIdx}`; }
function saveUserTeams() {
  try { localStorage.setItem(teamsKey(), JSON.stringify([...state.userTeams])); } catch { /* ignore */ }
}
function loadUserTeams() {
  let ids = null;
  try { ids = JSON.parse(localStorage.getItem(teamsKey())); } catch { /* ignore */ }
  if (!Array.isArray(ids)) {
    const L = league();
    ids = L.teams.filter(t => t.isPlayer).map(t => t.id);
    // Franchise saves: default to the team the save is built around.
    if (!ids.length && L.season.mode === 0 && L.teams.some(t => t.id === L.season.teamId)) ids = [L.season.teamId];
  }
  state.userTeams = new Set(ids);
}

const league = () => state.data.seasonLeagues[state.leagueIdx];

// Pre-draft ratings and the summer-league-done flag are remembered per
// league + season so they survive switching save files.
const seasonKey = (L = league()) => `${L.shortName}:${L.season.currentYear}`;
function loadOriginals(L = league()) {
  try { return JSON.parse(localStorage.getItem(`hlc:orig:${seasonKey(L)}`)) || {}; } catch { return {}; }
}
function saveOriginals(L, map) {
  const merged = { ...loadOriginals(L), ...map };
  try { localStorage.setItem(`hlc:orig:${seasonKey(L)}`, JSON.stringify(merged)); } catch { /* ignore */ }
  return merged;
}
function summerDone(L = league()) {
  try { return localStorage.getItem(`hlc:summer:${seasonKey(L)}`) === '1'; } catch { return false; }
}
function markSummerDone(L) {
  try { localStorage.setItem(`hlc:summer:${seasonKey(L)}`, '1'); } catch { /* ignore */ }
}
const snapKey = (pid, li = state.leagueIdx) => `${li}:${pid}`;
// Baseline ratings for a player: taken at load, or the first time a player
// shows up later (prospects joining rosters or free agency in-app).
const snapOf = p => {
  const k = snapKey(p.id);
  if (!state.snaps.has(k)) state.snaps.set(k, snapshot(p));
  return state.snaps.get(k);
};
const isUserTeam = t => t && state.userTeams.has(t.id);

function allEntries() { return leaguePlayers(league(), true); }
function findPlayer(pid) { return allEntries().find(e => e.p.id === pid); }

// ---------------------------------------------------------------------------
// Utilities

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function stars(halfStars) {
  const full = Math.floor(halfStars / 2);
  return '★'.repeat(full) + (halfStars % 2 ? '½' : '');
}

function logoUrl(url) {
  if (!url) return '';
  return url.includes('dropbox.com') ? url.replace(/([?&])dl=0/, '$1raw=1') : url;
}
function logoImg(team, cls = 'logo-sm') {
  const u = logoUrl(team.logoURL);
  if (!u) return '';
  return `<img class="${cls}" src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
}

// A notification that slides down from the top, like a text message.
// `detail` adds a second line (trade alerts show the deal).
function toast(msg, detail = '', ms = detail ? 4000 : 2400) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = `<img src="icons/alert.png" alt=""><span><b>${esc(msg)}</b>${detail ? `<span>${esc(detail)}</span>` : ''}</span>`;
  t.addEventListener('click', () => t.classList.add('out'));
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

function overlay(html) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="box">${html}</div>`;
  document.body.appendChild(o);
  return o;
}

function confirmBox(msg, okLabel = 'Confirm', cancelLabel = 'Cancel') {
  return new Promise(resolve => {
    const o = overlay(`<p class="note">${msg}</p>
      <div class="grid2"><button class="btn off" data-r="0">${esc(cancelLabel)}</button><button class="btn focus" data-r="1">${esc(okLabel)}</button></div>`);
    o.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      o.remove();
      resolve(b.dataset.r === '1');
    });
  });
}

const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));

function changeSummary(d) {
  const parts = Object.entries(d.attrs).map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`);
  return parts.join(' ');
}

function skillBadges(d) {
  return d.added.map(id => `<span class="badge new">+${esc(skillName(id))}</span>`).join('') +
    d.leveled.map(id => `<span class="badge lvl">${esc(skillName(id))}↑</span>`).join('') +
    d.removed.map(id => `<span class="badge">−${esc(skillName(id))}</span>`).join('');
}

// "Shooting · elite · TPT · MID"
function skillTag(id) {
  const elite = isEliteSkill(id) ? `elite: ${ELITE_REQUIREMENTS[id] ? `${ELITE_REQUIREMENTS[id]} ${ELITE_MIN}+` : `${ELITE_MIN}/20`}` : '';
  return [skillCategory(id), isFreeSkill(id) ? 'free' : elite, skillHint(id)].filter(Boolean).join(' · ');
}

function skillHint(id) {
  const prof = state.profiles[state.leagueIdx]?.[id];
  const avg = state.leagueAvg[state.leagueIdx];
  if (!prof || !avg) return '';
  return ATTRS.map((k, i) => [k, prof.v[i] - avg[i]])
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join(' · ');
}

// ---------------------------------------------------------------------------
// Layout + routing

function layout({ title, left = '', right = '', body, action = null }) {
  const t = esc(title);
  $app.innerHTML = `
    <div class="header">
      ${state.stack.length > 1 ? `<button class="btn back" data-act="back" aria-label="Back">${BACK_ARROW}</button>` : ''}
      ${left}
      <div class="marquee" role="heading" aria-level="1" aria-label="${t}">
        <div class="marquee-track" aria-hidden="true"><span>${t}</span><span>${t}</span></div>
      </div>
      ${right}
    </div>
    <main class="panel">${body}</main>
    ${action ? `<div class="bottom"><button class="btn action" data-act="${action.act}">${esc(action.label)}</button></div>` : ''}`;
}

const BACK_ARROW = `<svg width="40" height="28" viewBox="0 0 10 7" shape-rendering="crispEdges" aria-hidden="true">
  <path fill="#fff" d="M3 0h1v1h-1zM2 1h2v1h-2zM1 2h9v3h-9zM0 3h1v1h-1zM2 5h2v1h-2zM3 6h1v1h-1z"/></svg>`;

const screens = {};
const actions = {};

function go(name, args = {}) {
  if (!screenAllowed(name)) { toast('Finish the current step on the calendar first'); return; }
  state.stack[state.stack.length - 1].y = window.scrollY;
  state.stack.push({ name, args });
  history.pushState({ depth: state.stack.length }, '');
  render();
}
// The league's logo: the NBA mark for NBA leagues, else Hoop Land's.
function leagueBadge(L) {
  const nba = L.leagueType === 0 && /NBA|National Basketball/i.test(`${L.shortName} ${L.leagueName}`);
  return `<img class="league-logo" src="icons/${nba ? 'nba.png' : L.leagueType !== 0 ? 'league-ball.png' : 'hoopland-logo.png'}" alt="">`;
}

function goHome() {
  const n = state.stack.length - 1;
  state.stack = [{ name: 'main', args: {} }];
  if (n > 0) history.go(-n); else render();
  render();
}
function back() {
  if (state.stack.length > 1) history.back();
}
function replace(name, args = {}) {
  state.stack[state.stack.length - 1] = { name, args };
  render();
}
// Re-rendering the same screen (a tap that updates it) keeps your place;
// a new screen, tab or view starts at the top.
let lastView = '';
function render() {
  const top = state.stack[state.stack.length - 1];
  const view = `${state.stack.length}:${top.name}:${top.args?.tab ?? ''}:${top.args?.view ?? ''}:${top.args?.id ?? ''}`;
  const y = window.scrollY;
  screens[top.name](top.args);
  window.scrollTo(0, view === lastView ? y : top.y ?? 0);
  top.y = null;
  lastView = view;
}

window.addEventListener('popstate', () => {
  if (state.stack.length > 1) { state.stack.pop(); render(); }
});

window.addEventListener('beforeunload', e => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

$app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'back') return back();
  const fn = actions[act];
  if (fn) fn(el.dataset, el, e);
});

$app.addEventListener('change', e => {
  if (e.target.id === 'fileInput' && e.target.files[0]) loadFile(e.target.files[0]);
  if (e.target.id === 'origInput' && e.target.files[0]) loadReference(e.target.files[0]);
});

// ---------------------------------------------------------------------------
// Loading / exporting

async function loadFile(file) {
  if (state.dirty && !(await confirmBox('You have unsaved changes. Load a different file anyway?', 'Load'))) return;
  const o = overlay('<div class="spinner"></div><p class="note">Reading season file…</p>');
  await nextFrame();
  try {
    const text = await file.text();
    const data = parseSave(text);
    if (!Array.isArray(data.seasonLeagues) || !data.seasonLeagues.length) throw new Error('No seasonLeagues found');
    state.fileName = file.name;
    state.undo = null;
    state.cal = {};
    installData(data);
    state.dirty = false;
    o.remove();
    toast(`Loaded ${data.seasonLeagues[0].meta?.saveName || file.name}`);
    render();
  } catch (err) {
    o.remove();
    console.error(err);
    const b = overlay(`<p class="note">Couldn't read that file as a Hoop Land season.<br><span class="muted small">${esc(err.message)}</span></p><button class="btn">OK</button>`);
    b.querySelector('button').onclick = () => b.remove();
  }
}

// Put parsed season data in place. `keepSnaps` keeps the original
// baselines (used when undoing an in-app phase advance).
function installData(data, keepSnaps = false) {
  {
    state.data = data;
    state.leagueIdx = 0;
    if (!keepSnaps) state.snaps.clear();
    state.profiles = [];
    state.leagueAvg = [];
    state.auto = {};
    state.rookieAuto = {};
    state.summer = {};
    state.mentor = {};
    state.contracts = {};
    state.jerseys = {};
    state.fa = {};
    state.awards = {};
    state.draft = {};
    state.compPools = {};
    state.compCache = {};
    data.seasonLeagues.forEach((L, li) => {
      const players = leaguePlayers(L, true).map(e => e.p);
      for (const p of players) if (!keepSnaps || !state.snaps.has(snapKey(p.id, li))) state.snaps.set(snapKey(p.id, li), snapshot(p));
      state.profiles[li] = buildSkillProfiles(players);
      const avg = ATTRS.map(() => 0);
      for (const p of players) ATTRS.forEach((k, i) => { avg[i] += p.attributes[k][0] / players.length; });
      state.leagueAvg[li] = avg;
    });
    data.seasonLeagues.forEach(L => { if (L.draftClass?.length) saveOriginals(L, originalRatings(L)); });
    loadUserTeams();
  }
}

// Read a pre-draft save only to remember the prospects' original ratings.
async function loadReference(file) {
  const o = overlay('<div class="spinner"></div><p class="note">Reading pre-draft ratings…</p>');
  await nextFrame();
  try {
    const ref = parseSave(await file.text());
    const L = ref.seasonLeagues.find(x => x.shortName === league().shortName) || ref.seasonLeagues[0];
    if (!L.draftClass?.length) throw new Error('That file has no draft class. Use a save from before the draft.');
    const rookies = new Set(leagueRookies(league()).map(r => r.p.id));
    const found = Object.keys(originalRatings(L)).filter(id => rookies.has(+id)).length;
    if (!found) throw new Error("None of that file's prospects match this season's rookies.");
    saveOriginals(league(), originalRatings(L));
    state.compCache = {};
    o.remove();
    toast(`Pre-draft ratings found for ${found} rookies`);
    render();
  } catch (err) {
    o.remove();
    const b = overlay(`<p class="note">${esc(err.message)}</p><button class="btn">OK</button>`);
    b.querySelector('button').onclick = () => b.remove();
  }
}

function buildExport() {
  state.data.seasonLeagues.forEach((L, li) => { if (state.summer[li]) markSummerDone(L); });
  const text = serializeSave(state.data);
  return new File([text], state.fileName, { type: 'application/octet-stream' });
}

// Running as a claude.ai artifact: files are saved through the viewer's
// download prompt, which needs an allowed extension (.json).
const inArtifact = () => typeof window.claude?.use === 'function';
const artifactName = name => (/\.[a-z0-9]{2,4}$/i.test(name) ? name : `${name}.json`);

async function artifactSave(name, data) {
  const dl = await window.claude.use('downloads');
  if (!dl) { toast('Saving isn\'t available in this view'); return false; }
  try {
    await dl.save({ filename: artifactName(name), data });
    return true;
  } catch (err) {
    if (err?.code !== 'declined') toast(`Save failed: ${err?.message || err?.code || 'unknown error'}`);
    return false;
  }
}

actions.download = async () => {
  const o = overlay('<div class="spinner"></div><p class="note">Building file…</p>');
  await nextFrame();
  const file = buildExport();
  if (inArtifact()) {
    o.remove();
    if (await artifactSave(file.name, file)) { state.dirty = false; toast('Season file saved. Remove .json from the name before loading it in Hoop Land.'); }
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  o.remove();
  state.dirty = false;
  toast('Season file saved');
};

actions.share = async () => {
  const o = overlay('<div class="spinner"></div><p class="note">Building file…</p>');
  await nextFrame();
  const file = buildExport();
  o.remove();
  try {
    await navigator.share({ files: [file], title: file.name });
    state.dirty = false;
  } catch (err) {
    if (err.name !== 'AbortError') toast('Sharing failed, use Download instead');
  }
};

// ---------------------------------------------------------------------------
// Offseason timeline: advance the save phase by phase inside the app

// Keep the file as it was before an advance, so it can be undone once.
function checkpoint(label) {
  state.undo = { label, text: serializeSave(state.data), dirty: state.dirty };
}

// ---------------------------------------------------------------------------
// Offseason calendar: one step at a time, June to October

// Where the save is in the offseason (0 = season over, before Pre-Lottery).
function phaseRank(s) {
  if (s.phase === 6) return 3 + Math.max(1, Math.min(3, s.currentDay || 1));
  return { 2: 1, 4: 2, 5: 3 }[s.phase] ?? 0;
}
const calFlags = () => (state.cal ||= {});
const faDone = day => {
  const s = league().season;
  if (phaseRank(s) > 3 + day) return true;
  const fa = state.fa[state.leagueIdx];
  return s.phase === 6 && s.currentDay === day && ((fa?.day === day && fa.stage === 'done') || !!calFlags().faLog?.[day]);
};

// Each step: when, what, whether it's finished, and what it opens.
const CALENDAR = [
  { key: 'office', date: 'Jun 1', title: 'Front Office', blurb: 'Select the teams you run.',
    done: () => calFlags().office },
  { key: 'lottery', date: 'Jun 2', title: 'Draft Lottery', blurb: 'Watch the ping-pong balls decide the fate of your franchise.',
    done: () => phaseRank(league().season) >= 2 },
  { key: 'warroom', date: 'Jun 18', title: 'War Room', blurb: 'Scout the class, build your board, run the mock draft and work the phones in the front office.',
    done: () => calFlags().warroom || phaseRank(league().season) >= 3 },
  { key: 'draft', date: 'Jun 25', title: 'NBA Draft', blurb: 'Two rounds, live, with draft-day trades.',
    done: () => phaseRank(league().season) >= 3 },
  { key: 'camp', date: 'Jul 2', title: 'Summer League', blurb: 'Rookies get their age adjustment, then the young cores head to Las Vegas.',
    done: () => calFlags().camp || phaseRank(league().season) >= 4 },
  { key: 'fa1', date: 'Jul 6', title: 'Free Agency · Day 1', blurb: 'No more collusion: the market opens and the big deals happen today. Draft picks sign their rookie contracts.',
    done: () => faDone(1) },
  { key: 'fa2', date: 'Jul 7', title: 'Free Agency · Day 2', blurb: 'Teams over the cap can use the mid-level exception.',
    done: () => faDone(2) },
  { key: 'fa3', date: 'Jul 8', title: 'Free Agency · Day 3', blurb: 'Last call: veteran minimums, asking prices drop, and anyone left unsigned leaves their old team.',
    done: () => faDone(3) },
  { key: 'dev', date: 'Sep 15', title: 'Training Camp', blurb: 'Mentorship, off-season progression and a check-in with the trainer.',
    done: () => calFlags().dev },
  { key: 'media', date: 'Sep 29', title: 'Media Day', blurb: 'Jersey numbers, then the season preview: the top 10 storylines.',
    done: () => calFlags().media },
  { key: 'export', date: 'Oct 20', title: 'Opening Night', blurb: 'Export the season file and load it in Hoop Land.',
    done: () => false },
];
const currentStep = () => CALENDAR.find(st => !st.done());
const isStep = key => currentStep()?.key === key;

// What finished steps show.
function stepSummary(key) {
  const L = league();
  const yr = L.season.currentYear;
  if (key === 'office') return `Running ${L.teams.filter(isUserTeam).map(t => t.shortName).join(', ') || 'no teams'}.`;
  if (key === 'lottery') {
    const n = L.season.news.filter(x => x.phase === 2 && x.category === 0 && x.type === 1).pop();
    const t = n && L.teams.find(x => x.id === n.tid);
    return t ? `${t.city} ${t.name}`.trim() + ' won the #1 pick.' : 'Draft order set.';
  }
  if (key === 'warroom') return `${myBoard().length || boardStore().board.length} prospects on your board.`;
  if (key === 'draft') {
    const first = leagueRookies(L).find(r => r.pick === 1);
    return first ? `${playerName(first.p)} went #1 to ${first.team?.shortName || '?'}.` : 'Draft complete.';
  }
  if (key === 'camp') { const s = state.summer[state.leagueIdx]; return s ? `${s.players} rookies won back +${s.points} in summer league.` : 'Done in the game.'; }
  if (key.startsWith('fa')) {
    const log = calFlags().faLog?.[+key[2]];
    return log ? `${log.n} signings${log.wars ? `, ${log.wars} bidding war${log.wars > 1 ? 's' : ''}` : ''}${log.top ? `. Biggest: ${log.top}` : ''}.` : 'Done in the game.';
  }
  if (key === 'dev') { const a = state.auto[state.leagueIdx]; return a ? `+${a.points} in ratings upgrades across ${a.players} players.` : 'Done.'; }
  if (key === 'media') return 'Storylines set.';
  return '';
}

// The buttons for the step in progress.
function stepActions(key) {
  const L = league();
  const s = L.season;
  switch (key) {
    case 'office': return `<p class="note small">Your teams: <b>${esc(L.teams.filter(isUserTeam).map(t => `${t.city} ${t.name}`.trim()).join(', ') || 'none yet')}</b></p>
      <div class="grid2"><button class="btn" data-act="nav" data-to="teams">👥 Select Teams</button><button class="btn focus" data-act="calDone" data-k="office" ${L.teams.some(isUserTeam) ? '' : 'disabled'}>✅ Confirm</button></div>`;
    case 'lottery': return `<button class="btn big focus" data-act="nav" data-to="lottery">🎱 Draft Lottery</button>`;
    case 'warroom': return `<div class="grid2"><button class="btn" data-act="nav" data-to="draft">🔎 Scouting</button><button class="btn focus" data-act="calDone" data-k="warroom">⏭ Advance to Draft</button></div>`;
    case 'draft': return `<button class="btn big focus" data-act="nav" data-to="draft">🎓 Go to the Draft</button>`;
    case 'camp': return `<button class="btn big focus" data-act="nav" data-to="camp">🏀 Summer League</button>`;
    case 'fa1': case 'fa2': case 'fa3': {
      const day = +key[2];
      if (s.phase === 5) return `<button class="btn big focus" data-act="advFreeAgency">✍️ Open Free Agency</button>`;
      if (s.currentDay < day) return `<button class="btn big focus" data-act="advDay">▶ Start Day ${day}</button>`;
      return `<button class="btn big focus" data-act="nav" data-to="fa">✍️ Day ${day} Market</button>`;
    }
    case 'dev': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="offseason">🏋️ Begin Training Camp</button><button class="btn" data-act="calDev" ${state.auto[state.leagueIdx] ? '' : 'disabled'}>✅ Wrap Up</button></div>`;
    case 'media': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="storylines">🎤 Media Day</button><button class="btn" data-act="calDone" data-k="media">✅ Wrap Up</button></div>`;
    case 'export': return `<button class="btn big focus" data-act="nav" data-to="export">💾 Export Season File</button>`;
    default: return '';
  }
}

function calendarCard() {
  const s = league().season;
  if (phaseRank(s) === 0) {
    return `<fieldset class="frame"><legend>Offseason</legend><p class="note">This save is at ${esc(phaseName(s))}. Advance once in Hoop Land after the season ends (to the Pre-Lottery phase), export that save and load it here to run the offseason.</p></fieldset>`;
  }
  const cur = currentStep();
  return `<fieldset class="frame"><legend>${s.currentYear} Offseason</legend>
    <ol class="calendar">${CALENDAR.map(st => {
      const state_ = st.done() ? 'done' : st === cur ? 'now' : 'locked';
      return `<li class="cal ${state_}">
        <span class="cal-date">${esc(st.date)}</span>
        <div class="cal-body">
          <b>${state_ === 'done' ? '✓ ' : state_ === 'locked' ? '🔒 ' : ''}${esc(st.title)}</b>
          <p class="note small">${esc(state_ === 'done' ? stepSummary(st.key) : st.blurb)}</p>
          ${state_ === 'now' ? stepActions(st.key) : ''}
        </div>
      </li>`;
    }).join('')}</ol>
    ${state.undo ? `<button class="btn small" data-act="undoAdvance">↺ Undo ${esc(state.undo.label)}</button>` : ''}
  </fieldset>`;
}

actions.calDone = d => { calFlags()[d.k] = true; state.undo = null; render(); };
actions.calCamp = async () => {
  if (summerEligible().length && !state.summer[state.leagueIdx] && !summerDone() &&
    !(await confirmBox('Summer league hasn\'t run. Wrap up anyway? Rookies keep the full draft drop.', 'Wrap Up'))) return;
  calFlags().camp = true;
  state.undo = null;
  render();
};
actions.calDev = () => { calFlags().dev = true; render(); };

// Only the current step's screens open; anything else goes back to the calendar.
const STEP_SCREENS = {
  office: ['teams'], lottery: ['lottery'], warroom: ['draft', 'prospect', 'lottery', 'liveTrade'], draft: ['draft', 'prospect', 'liveTrade'],
  camp: ['camp', 'rookies'], fa1: ['fa'], fa2: ['fa'], fa3: ['fa'],
  dev: ['offseason', 'report', 'mentor', 'rookies', 'trainer'], media: ['storylines'], export: ['export'],
};
const ALWAYS = ['main', 'settings', 'roster', 'player'];
function screenAllowed(name) {
  if (!state.data || ALWAYS.includes(name)) return true;
  if (phaseRank(league().season) === 0) return true;
  const cur = currentStep();
  return !!cur && (STEP_SCREENS[cur.key] || []).includes(name);
}

actions.advLottery = async () => {
  const L = league();
  const P = state.params;
  checkpoint('Lottery');
  const setup = lotterySetup(L, P.lotteryFormat, P.lotteryDraws);
  const order = preLotteryOrder(L);
  const drawn = drawLottery(order.slice(0, setup.lotteryTeams.length), setup.odds, setup.draws, mulberry32(Math.floor(Math.random() * 1e9)), setup.floor);
  const r1 = drawn.map(r => r.team);
  applyLottery(L, [...r1, ...order.filter(t => !r1.includes(t))]);
  draftState().lottery = null;
  draftState().mock = null;
  state.compCache = {};
  state.dirty = true;
  // The result shows on the same lottery screen, revealed from the last
  // lottery pick up to #1.
  state.lotteryReveal = true;
  if (state.stack[state.stack.length - 1].name === 'lottery') render(); else go('lottery');
};

actions.advFreeAgency = async () => {
  const L = league();
  checkpoint('Open Free Agency');
  const signed = startFreeAgency(L, { r2Years: state.params.rookieR2Years });
  state.dirty = true;
  go('fa');
  toast(`Free agency is open: ${signed.length} rookies signed`);
};

actions.advDay = async () => {
  const L = league();
  const fa = state.fa[state.leagueIdx];
  const ran = fa && fa.day === L.season.currentDay && fa.stage === 'done';
  if (!ran && !(await confirmBox(`Free agency hasn't run today. Start Day ${L.season.currentDay + 1} anyway?`, 'Start'))) return;
  checkpoint(`Day ${L.season.currentDay + 1}`);
  nextFreeAgencyDay(L);
  state.dirty = true;
  go('fa');
};

actions.undoAdvance = async () => {
  const u = state.undo;
  if (!u || !(await confirmBox(`Undo ${esc(u.label)}? The save goes back to how it was just before.`, 'Undo'))) return;
  const o = overlay('<div class="spinner"></div><p class="note">Restoring…</p>');
  await nextFrame();
  installData(parseSave(u.text), true);
  state.undo = null;
  state.dirty = u.dirty;
  o.remove();
  goHome();
  toast(`${u.label} undone`);
};

// ---------------------------------------------------------------------------
// Main menu

screens.main = () => {
  if (!state.data) {
    layout({
      title: 'Main Menu',
      body: `
        <img class="hero" src="icons/banner.jpg" alt="Hoop Land">
        <fieldset class="frame"><legend>Hoop Land Companion</legend>
          <div class="stack">
            <p class="note">Load a save from the start of the offseason (Pre-Lottery) and run the whole offseason here: the lottery, the draft, summer league, free agency and player development. Export once at the end and load it in the game. Saves from later in the offseason pick up from where they are.</p>
            <label class="btn big focus"><span class="ico">📂</span> Load Season File
              <input type="file" id="fileInput"></label>
          </div>
        </fieldset>
        <p class="center muted small">Version ${APP_VERSION}</p>`,
    });
    return;
  }
  const L = league();
  const s = L.season;
  const players = leaguePlayers(L, true).length;
  const auto = state.auto[state.leagueIdx];
  const yourTeams = L.teams.filter(isUserTeam).map(t => t.shortName).join(', ') || 'None picked';
  layout({
    title: 'Main Menu',
    body: `
      <div class="league-card">
        ${leagueBadge(L)}
        <div class="grow"><b>${esc(L.meta?.saveName || state.fileName)}</b>
          <span class="note small">${esc(L.leagueName || L.shortName)} · ${esc(phaseName(s))} · Your teams: ${esc(yourTeams)}</span></div>
      </div>
      ${calendarCard()}
      ${L.teams.some(isUserTeam) ? '<button class="btn left" data-act="nav" data-to="roster"><span class="ico">👥</span> Your Roster</button>' : ''}
      <div class="grid2">
        <button class="btn left" data-act="nav" data-to="settings"><span class="ico">☰</span> Settings</button>
        <label class="btn left"><span class="ico">📂</span> Load File<input type="file" id="fileInput"></label>
      </div>
      <p class="center muted small">Version ${APP_VERSION}</p>`,
  });
};

function phaseWarning(s) {
  if (BUMP_PHASES.includes(s.phase) && s.currentDay === BUMP_DAY) return '';
  if (BUMP_PHASES.includes(s.phase)) return `<p class="note gold small" style="margin-top:10px">Best run on Free Agency Day ${BUMP_DAY} (the last day before the new season), once rosters are set. This file is at ${esc(phaseName(s))}.</p>`;
  return `<p class="note gold small" style="margin-top:10px">The offseason bump is meant for free agency (Day ${BUMP_DAY}, before advancing to the new season). This file is at ${esc(phaseName(s))}.</p>`;
}

actions.nav = d => go(d.to, d.arg ? { arg: d.arg } : {});

// ---------------------------------------------------------------------------
// Team selection

screens.teams = (args) => {
  const L = league();
  const conf = args.conf ?? 0;
  const teams = L.teams.filter(t => (t.division < 3 ? 0 : 1) === conf || L.conferences.length < 2);
  layout({
    title: 'Select Your Teams',
    body: `
      ${L.conferences.length >= 2 ? `<div class="tabs">
        ${L.conferences.map((c, i) => `<button class="btn ${i === conf ? 'on focus' : 'off'}" data-act="conf" data-i="${i}">${esc(c)}</button>`).join('')}
      </div>` : ''}
      <p class="note">Tap the teams you control. They are skipped by auto progression and appear under Your Teams for hand-picked upgrades.</p>
      <div class="team-grid">
        ${teams.map(t => `<button class="team-tile ${isUserTeam(t) ? 'sel' : ''}" data-act="toggleTeam" data-id="${t.id}">
          ${t.logoURL ? logoImg(t, '') : `<div class="fallback">${esc(t.shortName)}</div>`}
          <span>${esc(t.shortName)}</span></button>`).join('')}
      </div>
      <p class="note muted small">${state.userTeams.size} selected</p>`,
    action: { act: 'back', label: 'Confirm' },
  });
};

actions.conf = d => replace('teams', { conf: +d.i });

actions.toggleTeam = async d => {
  const id = +d.id;
  if (state.userTeams.has(id)) state.userTeams.delete(id); else state.userTeams.add(id);
  saveUserTeams();
  if (state.auto[state.leagueIdx]?.spent) {
    // CPU points were spent into ratings; redo so the new split is respected.
    applyBump(state.auto[state.leagueIdx].seed);
    toast('Offseason bump re-applied');
  }
  render();
};

// ---------------------------------------------------------------------------
// Offseason bump

// The most recently completed season (the one injuries are judged on).
function lastSeasonYear() {
  return Math.max(...league().teams.map(t => teamRecord(t).yr || 0));
}

// What the bump needs to know about the season just played.
function bumpContext() {
  const L = league();
  const injuryYear = lastSeasonYear();
  const cache = (state.compCache[state.leagueIdx] ||= new Map());
  if (!cache.has('production')) cache.set('production', productionScores(leaguePlayers(L, true).map(e => e.p), state.leagueIdx, injuryYear, state.params));
  return { leagueIdx: state.leagueIdx, injuryYear, totalGames: L.season.totalGames, rolled: L.season.currentYear > injuryYear, production: cache.get('production') };
}

const rookieIds = () => new Set(leagueRookies(league()).map(r => r.p.id));

// Veteran bump: everyone except this year's rookies (they have their own).
function bumpEntries() {
  const rk = rookieIds();
  return leaguePlayers(league(), state.params.includeFreeAgents).filter(e => !rk.has(e.p.id));
}
function vetPlayers() {
  const rk = rookieIds();
  return leaguePlayers(league(), true).filter(e => !rk.has(e.p.id)).map(e => e.p);
}

function applyBump(seed) {
  const li = state.leagueIdx;
  // Start from the original file each time so re-rolls don't stack.
  for (const p of vetPlayers()) restore(p, snapOf(p));
  reapplyMentorship();
  const entries = bumpEntries().map(e => ({ ...e, ...bumpContext(), spend: state.params.spendCpuPoints && !isUserTeam(e.team) }));
  const awards = runProgression(entries, { ...state.params, seed }, state.profiles[li]);
  let players = 0, points = 0, mine = 0;
  for (const [pid, n] of awards) {
    if (!n) continue;
    players++;
    points += n;
  }
  let longevity = 0, potUps = 0, potDowns = 0, earned = 0, regDowns = 0;
  for (const e of entries) {
    if (earnsNaturalLongevity(e.p, lastSeasonMpg(e.p, li), e, state.params)) earned++;
    if (isUserTeam(e.team)) mine += awards.get(e.p.id) || 0;
    const d = diffPlayer(e.p, snapOf(e.p));
    if (d.regDelta > 0) longevity++;
    if (d.regDelta < 0) regDowns++;
    if (d.potDelta > 0) potUps++;
    if (d.potDelta < 0) potDowns++;
  }
  const all = (state.awards[li] ||= new Map());
  for (const p of vetPlayers()) all.delete(p.id);
  for (const [k, v] of awards) all.set(k, v);
  state.auto[li] = { seed, players, points, mine, longevity, earned, regDowns, potUps, potDowns, total: entries.length, spent: state.params.spendCpuPoints };
  state.dirty = true;
}

actions.runAuto = async () => {
  if (state.auto[state.leagueIdx] && !(await confirmBox('Run the bump again? Manual changes made since the last run are reset.', 'Run'))) return;
  const o = overlay('<div class="spinner"></div><p class="note">Awarding offseason points…</p>');
  await nextFrame();
  applyBump(state.params.seed);
  o.remove();
  render();
};

actions.reroll = async () => {
  if (!(await confirmBox('Re-roll with a new seed? Manual changes are reset.', 'Re-roll'))) return;
  state.params.seed = Math.floor(Math.random() * 1e6);
  saveParams();
  const o = overlay('<div class="spinner"></div><p class="note">Awarding offseason points…</p>');
  await nextFrame();
  applyBump(state.params.seed);
  o.remove();
  render();
  toast(`New seed ${state.params.seed}`);
};

actions.undoAuto = async () => {
  if (!(await confirmBox('Undo the offseason bump? Those players return to the original file.', 'Undo'))) return;
  for (const p of vetPlayers()) { restore(p, snapOf(p)); state.awards[state.leagueIdx]?.delete(p.id); }
  reapplyMentorship();
  delete state.auto[state.leagueIdx];
  render();
};

function applyRookieBump(seed) {
  const li = state.leagueIdx;
  const rookies = leagueRookies(league());
  // Reset only the points so summer league gains stay.
  for (const r of rookies) if (r.p.season?.ap) r.p.season.ap = [...snapOf(r.p).ap];
  const entries = rookies.map(r => ({ ...r, spend: state.params.spendCpuPoints && !isUserTeam(r.team) }));
  const awards = runRookieBump(entries, { ...state.params, seed });
  const all = (state.awards[li] ||= new Map());
  let players = 0, points = 0, mine = 0;
  for (const r of rookies) {
    const n = awards.get(r.p.id) || 0;
    all.set(r.p.id, n);
    if (n) players++;
    points += n;
    if (isUserTeam(r.team)) mine += n;
  }
  state.rookieAuto[li] = { seed, players, points, mine, total: rookies.length };
  state.dirty = true;
}

actions.runRookies = () => {
  if (state.rookieAuto[state.leagueIdx]) return;
  applyRookieBump(state.params.seed);
  render();
};

actions.undoRookies = async () => {
  if (!(await confirmBox('Undo summer league?', 'Undo'))) return;
  for (const r of leagueRookies(league())) {
    if (r.p.season?.ap) r.p.season.ap = [...snapOf(r.p).ap];
    state.awards[state.leagueIdx]?.delete(r.p.id);
  }
  delete state.rookieAuto[state.leagueIdx];
  render();
};

const awardOf = p => state.awards[state.leagueIdx]?.get(p.id) || 0;

// ---------------------------------------------------------------------------
// Offseason hub

// Second-round rookie deals: the game gives them 4 years; shorten to
// `rookieR2Years` (team option kept). Free agency, once the game has
// signed the rookies (Day 1+).
function contractCard() {
  const L = league();
  if (L.season.phase !== BUMP_PHASES[0]) return '';
  const li = state.leagueIdx;
  const done = state.contracts?.[li];
  const yrs = state.params.rookieR2Years;
  const targets = rookieContractTargets(L, yrs);
  if (!done && !targets.length) return '';
  return `<fieldset class="frame"><legend>Rookie Contracts</legend><div class="stack">
    ${done ? `<p class="note"><span class="up">${done.length}</span> second-round rookies now on ${yrs}-year deals with a team option.</p>
      <button class="btn small" data-act="undoContracts">↺ Undo</button>`
    : `<p class="note">The game signed ${targets.length} second-round picks to 4-year deals. Shorten them to ${yrs} years with a team option (first-rounders keep their 4-year scale deal and team option).</p>
      <button class="btn focus" data-act="rookieContracts">✍️ Apply ${yrs}-Year Deals</button>`}
  </div></fieldset>`;
}

// Duplicate or retired jersey numbers (the game allows them).
function jerseyCard() {
  const li = state.leagueIdx;
  const done = state.jerseys?.[li];
  const clashes = done ? [] : jerseyClashes(league());
  if (!done && !clashes.length) return '';
  return `<fieldset class="frame"><legend>Jersey Numbers</legend><div class="stack">
    ${done ? `<p class="note"><span class="up">${done.length}</span> players renumbered: ${esc(done.slice(0, 4).map(c => `${c.p.ln} #${c.from}→#${c.to}`).join(', '))}${done.length > 4 ? '…' : ''}</p>
      <button class="btn small" data-act="undoJerseys">↺ Undo</button>`
    : `<p class="note">${clashes.length} players share a number with a teammate or wear a retired number. The longest-tenured player keeps it; the others try the single digit of their number (#27 → 7), then the lowest free one.</p>
      <button class="btn" data-act="fixJerseys">👕 Fix Jersey Numbers</button>`}
  </div></fieldset>`;
}
actions.fixJerseys = () => { (state.jerseys ||= {})[state.leagueIdx] = fixJerseyNumbers(league()); state.dirty = true; render(); };
actions.undoJerseys = () => { undoJerseyNumbers(state.jerseys[state.leagueIdx] || []); delete state.jerseys[state.leagueIdx]; render(); };

actions.rookieContracts = () => {
  (state.contracts ||= {})[state.leagueIdx] = applyRookieContracts(league(), state.params.rookieR2Years);
  state.dirty = true;
  render();
};
actions.undoContracts = () => {
  undoRookieContracts(state.contracts[state.leagueIdx] || []);
  delete state.contracts[state.leagueIdx];
  render();
};

screens.offseason = () => {
  const auto = state.auto[state.leagueIdx];
  const P = state.params;
  const bands = P.ageBands;
  layout({
    title: 'Training Camp',
    body: `
      <img class="hero" src="icons/hero-camp.jpg" alt="">
      ${mentorCard()}
      <fieldset class="frame"><legend>Off-season Progression</legend>
        <div class="stack">
          ${auto ? `
            <dl class="info">
              <dt>Players improved</dt><dd class="up">${auto.players}</dd>
              <dt>Ratings upgrades</dt><dd class="up">+${auto.points}</dd>
              <dt>Your teams</dt><dd class="up">+${auto.mine}</dd>
              <dt>Potential up</dt><dd class="up">${auto.potUps ?? 0}</dd>
              <dt>Potential down</dt><dd class="down">${auto.potDowns ?? 0}</dd>
              <dt>Regression age +1</dt><dd class="up">${auto.longevity ?? 0}</dd>
              <dt>Regression age −1</dt><dd class="down">${auto.regDowns ?? 0}</dd>
            </dl>
            <button class="btn focus" data-act="nav" data-to="report">📋 Progression Report</button>
            <button class="btn" data-act="nav" data-to="trainer">🩺 Meet with the Trainer</button>
            ${P.commissioner ? '<button class="btn small" data-act="undoAuto">↺ Undo</button>' : ''}`
          : `
            <p class="note"><b>Development coach:</b> players ${bands[bands.length - 1][0]} and under get ratings upgrades, based on youth and usage.</p>
            <p class="note"><b>Trainer:</b> last season's production is weighed against players in the same role and age. Standouts can gain potential, or push their regression age back a year if they're at it (or a year away). Poor seasons and injuries can cost potential or bring regression a year sooner, but never for a player who's already declining.</p>
            <button class="btn big focus" data-act="runAuto">▶ Run Off-season Progression</button>`}
        </div>
      </fieldset>
      ${contractCard()}
      <button class="btn big ${auto ? 'focus' : ''}" data-act="calDevBack" ${auto ? '' : 'disabled'}>✅ Wrap Up Training Camp</button>`,
  });
};

// Summer League step: rookies win back draft-drop ratings by age, then the
// rookie bump.
screens.camp = () => {
  const ageDone = !!state.summer[state.leagueIdx] || summerDone();
  layout({
    title: 'Summer League',
    body: `${leagueRookies(league()).length ? ageSection() : '<p class="note">No rookies this year.</p>'}${tourSection(ageDone || !leagueRookies(league()).length)}`,
    action: ageDone || state.summerTour[state.leagueIdx] ? { act: 'calCampBack', label: 'Wrap Up Summer League' } : null,
  });
};
actions.calCampBack = () => { calFlags().camp = true; state.undo = null; goHome(); toast('Next up: Free Agency'); };
actions.calDevBack = () => { calFlags().dev = true; state.undo = null; goHome(); toast('Training camp done. Next up: Media Day.'); };

// Meet with the trainer: your players' health, physicals and what changed.
screens.trainer = () => {
  const L = league();
  const yr = lastSeasonYear();
  const body = L.teams.filter(isUserTeam).map(t => {
    const rows = [...t.roster].sort((a, b) => levelOf(b) - levelOf(a)).map(p => {
      const snap = snapOf(p);
      const d = diffPlayer(p, snap);
      const h = injuryRisk(p, yr, state.params);
      const status = !h ? ['Healthy', 'up'] : h.cls === 'structural' ? ['Structural', 'down'] : h.cls === 'nagging' ? ['Nagging', 'gold'] : ['Recovered', 'muted'];
      const phys = PHYSICAL.map(k => `${k} ${p.attributes[k][0]}`).join(' · ');
      const changes = [
        d.potDelta > 0 ? '<span class="badge new">Potential ▲</span>' : d.potDelta < 0 ? '<span class="badge down-b">Potential ▼</span>' : '',
        d.regDelta > 0 ? `<span class="badge lvl">Regression ${p.regressionAge}</span>` : d.regDelta < 0 ? `<span class="badge down-b">Regression ${p.regressionAge}</span>` : '',
      ].join('');
      return `<div class="trainer-row">
        <div class="tr-top"><b>${esc(playerName(p))}</b> <span class="gold small">Lv ${levelOf(p)}</span><span class="badge ${status[1] === 'up' ? 'lvl' : status[1] === 'down' ? 'down-b' : ''}">${status[0]}</span></div>
        <span class="small muted">${esc(posName(p))} · ${p.age}y · ${phys}</span>
        ${h ? `<span class="small">${esc(injuryName(h.worst))}${h.games ? ` · ${h.games} games missed` : ''}${h.sameType + h.sameArea ? ' · recurring' : ''}</span>` : ''}
        ${changes ? `<span>${changes}</span>` : ''}
      </div>`;
    }).join('');
    return `<fieldset class="frame"><legend>${esc(t.city)} ${esc(t.name)}</legend><div class="stack">${rows}</div></fieldset>`;
  }).join('') || '<p class="note">Select your teams first.</p>';
  layout({ title: 'Trainer', body });
};


function summerEligible() {
  const orig = loadOriginals();
  return leagueRookies(league())
    .filter(r => r.round > 0 || state.params.rookieIncludeUndrafted)
    .filter(r => orig[r.p.id]);
}

actions.runSummer = async () => {
  const bands = state.params.recoveryBands;
  const orig = loadOriginals();
  let players = 0, points = 0;
  for (const r of summerEligible()) {
    const g = applySummerLeague(r.p, orig[r.p.id], bands);
    const n = Object.values(g).reduce((a, b) => a + b, 0);
    if (n) { players++; points += n; }
  }
  state.summer[state.leagueIdx] = { players, points };
  state.compCache = {};
  state.dirty = true;
  render();
  toast(`Age adjustment: +${points} points back across ${players} rookies`);
};

actions.undoSummer = async () => {
  if (!(await confirmBox('Undo the age adjustment? Rookie ratings go back to their post-draft values.', 'Undo'))) return;
  for (const r of leagueRookies(league())) {
    const snap = snapOf(r.p);
    for (const k of SKILL_ATTRS) r.p.attributes[k] = [...snap.attributes[k]];
  }
  delete state.summer[state.leagueIdx];
  state.compCache = {};
  render();
};

// Step 1: the age adjustment. The game's draft takes −${DRAFT_DROP} off every
// rating; older rookies get part of it back on every skill, never past their
// pre-draft rating. Same for everyone the same age: no dice.
function ageSection() {
  const L = league();
  const done = state.summer[state.leagueIdx];
  const bands = state.params.recoveryBands;
  const net = b => DRAFT_DROP - b[1];
  const bandText = bands.map((b, i) => `<li><b>${i === 0 ? `Age ${b[0]} and under` : b[0] >= 99 ? `Age ${bands[i - 1][0] + 1}+` : `Age ${bands[i - 1][0] + 1}–${b[0]}`}</b>: −${net(b)} per skill${b[1] ? ` <span class="up">(+${b[1]} back)</span>` : ''}</li>`).join('');
  let body;
  if (done) {
    const mine = leagueRookies(L).filter(r => isUserTeam(r.team));
    body = `<dl class="info">
        <dt>Points back, league-wide</dt><dd class="up">+${done.points}</dd>
        <dt>Rookies adjusted</dt><dd>${done.players}</dd>
      </dl>
      ${mine.length ? `<div class="stack">${mine.map(r => {
        const d = diffPlayer(r.p, snapOf(r.p));
        return `<div class="row"><span class="grow">${esc(playerName(r.p))} <span class="muted small">${r.p.age}y · ${esc(r.team.shortName)}</span></span><span class="${d.points ? 'up' : 'muted'}">${d.points ? `+${d.points}` : '—'}</span></div>`;
      }).join('')}</div>` : ''}
      ${state.params.commissioner ? '<button class="btn small" data-act="undoSummer">↺ Undo</button>' : ''}`;
  } else if (summerDone(L)) {
    body = `<p class="note">The age adjustment was already applied for ${L.season.currentYear}.</p>`;
  } else if (L.season.phase !== PHASE_POST_DRAFT) {
    body = `<p class="note muted">The age adjustment runs right after the draft (Post-Draft phase). This file is at ${esc(phaseName(L.season))}.</p>`;
  } else {
    const eligible = summerEligible();
    const total = leagueRookies(L).filter(r => r.round > 0 || state.params.rookieIncludeUndrafted).length;
    body = eligible.length
      ? `<p class="note">Hoop Land knocks ${DRAFT_DROP} points off every rating at the draft. Older rookies have less time to grow, so they get part of it back right away, the same on every skill:</p>
        <ul class="age-bands">${bandText}</ul>
        <button class="btn big focus" data-act="runSummer">▶ Run Age Adjustment</button>`
      : `<p class="note">The age adjustment needs the rookies' pre-draft ratings. Load a save of this season from before the draft (it's only read, not changed).</p>`;
    if (eligible.length < total) body += `<label class="btn small">📂 Load Pre-Draft Save<input type="file" id="origInput"></label>`;
  }
  return `<fieldset class="frame"><legend>1 · Age Adjustment</legend><div class="stack">${body}</div></fieldset>`;
}

// Step 2: the summer league tournament (young cores; your team gets a small
// boost for reaching the final).
function tourSection(ready) {
  const L = league();
  const t = state.summerTour[state.leagueIdx];
  let body;
  if (!t) {
    body = ready
      ? `<p class="note">Every team's rookies and second-year players head to Las Vegas. Reach the final and a couple of your young players pick up a rating point; win it and three of them get two.</p>
        <button class="btn big focus" data-act="runTour">🏀 Play Summer League</button>`
      : '<p class="note muted">Run the age adjustment first.</p>';
  } else {
    const r = t.result;
    const [a, b] = r.final.teams.map(id => L.teams.find(x => x.id === id));
    const sum = q => q.reduce((x, y) => x + y, 0);
    const heads = r.final.quarters[0].map((_, i) => i < 4 ? `Q${i + 1}` : i === 4 ? 'OT' : `${i - 3}OT`);
    const mvpTeam = L.teams.find(x => x.id === r.mvp?.tid);
    body = `<p class="note small muted">Championship game</p>
      <div class="box-score" style="--cols:${heads.length}">
        <span></span>${heads.map(h => `<span class="muted">${h}</span>`).join('')}<span class="muted">F</span>
        ${[a, b].map((tm, k) => `<span class="bs-team ${tm.id === r.final.winner ? 'win' : ''}">${logoImg(tm)}${esc(tm.shortName)}</span>${r.final.quarters[k].map(v => `<span>${v}</span>`).join('')}<b class="${tm.id === r.final.winner ? 'gold' : ''}">${sum(r.final.quarters[k])}</b>`).join('')}
      </div>
      <p class="note">🏆 <b>${esc(L.teams.find(x => x.id === r.final.winner).city)} ${esc(L.teams.find(x => x.id === r.final.winner).name)}</b> win the Summer League title.</p>
      ${r.mvp ? `<div class="mvp-card">${logoImg(mvpTeam)}<span class="grow"><span class="small muted">Summer League MVP</span><br><b>${esc(mvpName(L, r.mvp))}</b> <span class="muted small">${esc(mvpTeam.shortName)}</span><br><span class="small">${r.mvp.ppg} PPG · ${r.mvp.rpg} RPG · ${r.mvp.apg} APG</span></span></div>` : ''}
      ${t.reward.length ? `<p class="note small up">${t.reward.map(x => `${esc(playerName(x.p))} ${Object.keys(x.gains).map(k => `${k} +1`).join(', ')}`).join(' · ')}</p>` : ''}`;
  }
  return `<fieldset class="frame"><legend>2 · Summer League</legend><div class="stack">${body}</div></fieldset>`;
}

actions.runTour = () => {
  const L = league();
  const li = state.leagueIdx;
  if (state.summerTour[li]) return;
  const result = runSummerLeague(L, state.data.seasonLeagues, (state.params.seed ^ (L.season.currentYear * 7919)) >>> 0);
  const mine = result.final.teams.map(id => L.teams.find(t => t.id === id)).find(isUserTeam);
  const reward = mine ? summerReward(L, mine, mine.id === result.final.winner, result.seed) : [];
  state.summerTour[li] = { result, reward };
  state.compCache = {};
  state.dirty = true;
  render();
  const champ = L.teams.find(t => t.id === result.final.winner);
  toast(`${champ.shortName} win Summer League${mine ? (mine === champ ? ': your rookies earned a boost!' : ': you reached the final') : ''}`);
};

// ---- Mentorship

const mentorState = () => (state.mentor[state.leagueIdx] ||= { seed: null, list: [] });
const byId = id => findPlayer(id);

// Put the mentee's taught skill back the way the file had it.
function unteach(m) {
  const e = byId(m.menteeId);
  if (!e) return;
  const orig = snapOf(e.p).skills.find(s => s.id === m.skill);
  const i = e.p.skills.findIndex(s => s.id === m.skill);
  if (orig && i >= 0) e.p.skills[i] = { ...orig };
  else if (i >= 0) e.p.skills.splice(i, 1);
}

// Bump resets start from the original file; put taught skills back.
function reapplyMentorship() {
  for (const m of state.mentor[state.leagueIdx]?.list || []) {
    const e = byId(m.menteeId);
    if (e) unlockSkill(e.p, m.skill);
  }
}

function applyCpuMentorship(seed) {
  const ms = mentorState();
  for (const m of ms.list.filter(x => x.cpu)) unteach(m);
  ms.list = ms.list.filter(x => !x.cpu);
  const cpuTeams = league().teams.filter(t => !isUserTeam(t));
  const done = runMentorship(cpuTeams, state.params, state.profiles[state.leagueIdx], seed);
  ms.seed = seed;
  ms.list.push(...done.map(d => ({ teamId: d.team.id, mentorId: d.mentor.id, menteeId: d.mentee.id, skill: d.skill, cpu: true })));
  state.dirty = true;
}

actions.runMentor = () => { applyCpuMentorship(state.params.seed); render(); };
actions.rerollMentor = () => { applyCpuMentorship(Math.floor(Math.random() * 1e6)); render(); };
actions.undoMentor = async () => {
  if (!(await confirmBox('Undo all mentorships (CPU and yours)?', 'Undo'))) return;
  const ms = mentorState();
  for (const m of ms.list) unteach(m);
  state.mentor[state.leagueIdx] = { seed: null, list: [] };
  render();
};

function mentorCard() {
  const ms = mentorState();
  const cpu = ms.list.filter(m => m.cpu);
  const mine = ms.list.filter(m => !m.cpu);
  const P = state.params;
  return `<fieldset class="frame"><legend>Mentorship</legend><div class="stack">
    <p class="note">Veterans (${P.mentorMinAge}+) teach one of their skills to up to ${P.mentorMaxMentees} young teammates (${P.menteeMaxAge} and under) within ${P.mentorPosRange} position step.</p>
    <button class="btn big focus" data-act="nav" data-to="mentor">🎓 Your Mentorships${mine.length ? ` (${mine.length})` : ''}</button>
    ${ms.seed != null
      ? `<p class="note">Around the league: <span class="up">${cpu.length} mentorships</span>.</p>
        ${P.commissioner ? '<button class="btn small" data-act="undoMentor">↺ Undo</button>' : ''}`
      : `<button class="btn" data-act="runMentor">▶ Run League Mentorship</button>`}
  </div></fieldset>`;
}

screens.mentor = () => {
  const L = league();
  const mine = L.teams.filter(isUserTeam);
  const ms = mentorState();
  const name = id => { const e = byId(id); return e ? playerName(e.p) : '?'; };
  const posOf = p => POSITIONS[p.pos] ?? p.pos;
  const body = mine.length ? mine.map(t => {
    const pairs = ms.list.filter(m => m.teamId === t.id);
    // A mentor teaches one skill, to up to mentorMaxMentees players.
    const mentorSkill = new Map(pairs.map(m => [m.mentorId, m.skill]));
    const mentorCount = id => pairs.filter(m => m.mentorId === id).length;
    const taught = new Set(pairs.map(m => m.menteeId));
    const options = mentorPairs(t.roster, state.params, state.profiles[state.leagueIdx])
      .filter(x => mentorCount(x.mentor.id) < state.params.mentorMaxMentees && !taught.has(x.mentee.id))
      .map(x => mentorSkill.has(x.mentor.id) ? { ...x, skills: x.skills.filter(s => s === mentorSkill.get(x.mentor.id)) } : x)
      .filter(x => x.skills.length);
    const byMentor = new Map();
    for (const o of options) (byMentor.get(o.mentor) || byMentor.set(o.mentor, []).get(o.mentor)).push(o);
    return `<fieldset class="frame"><legend>${esc(t.city)} ${esc(t.name)}</legend><div class="stack">
      ${pairs.map(m => `<div class="row"><p class="note grow"><span class="up">✓</span> ${esc(name(m.mentorId))} taught ${esc(name(m.menteeId))} <b>${esc(skillName(m.skill))}</b></p>
        <button class="btn small" data-act="unteach" data-mentee="${m.menteeId}">Undo</button></div>`).join('')}
      ${[...byMentor].map(([mentor, list]) => `<div class="mentor">
        <p class="note"><b>${esc(playerName(mentor))}</b> <span class="muted small">${mentor.age}y · ${esc(posOf(mentor))}</span> can teach:</p>
        ${list.map(o => `<div class="mentee"><span class="small">${esc(playerName(o.mentee))} <span class="muted">${o.mentee.age}y · ${esc(posOf(o.mentee))}</span></span>
          <div class="chips">${o.skills.map(id => `<button class="badge chip" data-act="teach" data-team="${t.id}" data-mentor="${mentor.id}" data-mentee="${o.mentee.id}" data-skill="${esc(id)}">${esc(skillName(id))}</button>`).join('')}</div></div>`).join('')}
      </div>`).join('') || (pairs.length ? '' : '<p class="note muted">No eligible mentor/mentee pairs on this roster.</p>')}
    </div></fieldset>`;
  }).join('') : '<p class="note">Pick your teams first.</p><button class="btn" data-act="nav" data-to="teams">👥 Pick Your Teams</button>';
  layout({
    title: 'Mentorship',
    body: `<p class="note muted small">Tap a skill to have the veteran teach it. Skills are listed best fit first for the young player.</p>${body}`,
  });
};

actions.teach = d => {
  const e = byId(+d.mentee);
  unlockSkill(e.p, d.skill);
  mentorState().list.push({ teamId: +d.team, mentorId: +d.mentor, menteeId: +d.mentee, skill: d.skill, cpu: false });
  state.dirty = true;
  render();
  toast(`${playerName(e.p)} learned ${skillName(d.skill)}`);
};

actions.unteach = d => {
  const ms = mentorState();
  const i = ms.list.findIndex(m => m.menteeId === +d.mentee && !m.cpu);
  if (i < 0) return;
  unteach(ms.list[i]);
  ms.list.splice(i, 1);
  render();
};

screens.rookies = () => {
  const rookies = leagueRookies(league());
  layout({
    title: 'Rookie Class',
    body: `<p class="note muted small">${rookies.length} rookies by draft slot · tap to adjust</p>
      <div class="list">${rookies.map(r => {
        const d = diffPlayer(r.p, snapOf(r.p));
        const award = awardOf(r.p);
        return `<button class="prow ${isUserTeam(r.team) ? 'sel' : ''}" data-act="openPlayer" data-id="${r.p.id}">
          <span class="name">${r.pick ? `#${r.pick} ` : ''}${esc(playerName(r.p))}</span>
          <span class="right"><span class="gold">Lv ${levelOf(r.p)}</span><br>${award ? `<span class="up">+${award} upgrade pts</span>` : '<span class="muted">—</span>'}</span>
          <span class="meta">${r.team ? esc(r.team.shortName) : 'Undrafted'} · ${r.round ? `R${r.round}` : 'FA'} · ${esc(POSITIONS[r.p.pos] ?? '')} · ${r.p.age}y · ${heightStr(r.p.ht)}</span>
          ${d.points ? `<span class="chg">Age adjustment <span class="up">+${d.points}</span></span>` : ''}
        </button>`;
      }).join('')}</div>`,
  });
};

// ---------------------------------------------------------------------------
// Bump report (all teams)

// Stars for a player's current level (Lv 100 = 5, 93 = 4.5, 86 = 4).
const levelStars = p => Math.max(1, Math.min(10, Math.round((5 - (100 - levelOf(p)) / 14) * 2)));

screens.report = (args) => {
  const L = league();
  const groups = [
    ...L.teams.filter(isUserTeam),
    ...L.teams.filter(t => !isUserTeam(t)),
  ].map(t => ({ team: t, title: `${t.city} ${t.name}`, players: t.roster }));
  if (state.params.includeFreeAgents && L.freeAgents?.length) groups.push({ team: null, title: 'Free Agents', players: L.freeAgents });
  const gi = ((args.g ?? 0) % groups.length + groups.length) % groups.length;
  const g = groups[gi];
  const rows = g.players.map(p => ({ p, d: diffPlayer(p, snapOf(p)) })).sort((a, b) => a.p.age - b.p.age);
  const improved = rows.filter(r => awardOf(r.p));
  const total = rows.reduce((a, r) => a + awardOf(r.p), 0);
  const count = f => rows.filter(f).length;
  const summary = [
    `${improved.length} improved <span class="up">+${total}</span>`,
    count(r => r.d.potDelta > 0) && `<span class="up">${count(r => r.d.potDelta > 0)} gained potential</span>`,
    count(r => r.d.potDelta < 0) && `<span class="down">${count(r => r.d.potDelta < 0)} lost potential</span>`,
    count(r => r.d.regDelta > 0) && `<span class="up">${count(r => r.d.regDelta > 0)} regression age +1</span>`,
    count(r => r.d.regDelta < 0) && `<span class="down">${count(r => r.d.regDelta < 0)} regression age −1</span>`,
  ].filter(Boolean).join(' · ');
  layout({
    title: 'Progression Report',
    body: `
      <div class="tsel report-nav">
        <button class="tsel-arrow" data-act="reportNav" data-g="${gi - 1}" aria-label="Previous team">◀</button>
        <span class="tsel-team ${isUserTeam(g.team) ? 'mine' : ''}">${g.team ? logoImg(g.team) : ''}<span class="tsel-name"><b>${esc(g.team ? g.team.shortName : 'FA')}</b><span class="small muted">${esc(g.title)}</span></span></span>
        <button class="tsel-arrow" data-act="reportNav" data-g="${gi + 1}" aria-label="Next team">▶</button>
      </div>
      <p class="note small" style="margin:10px 0">${summary}</p>
      <div class="list">${rows.map(({ p, d }) => reportRow(p, d)).join('')}</div>`,
  });
};

// One player in the progression report (read-only).
function reportRow(p, d) {
  const mpg = lastSeasonMpg(p, state.leagueIdx);
  const award = awardOf(p);
  const ups = Object.entries(d.attrs).map(([k, v]) => `<span class="${v > 0 ? 'up' : 'down'}">${k} ${v > 0 ? '+' : ''}${v}</span>`).join(' ');
  return `<div class="prow rrow">
    <span class="name"><span class="gold">${esc(playerName(p))}</span> <span class="small">Lv ${levelOf(p)}</span></span>
    <span class="right"><span class="stars">${stars(levelStars(p))}</span><br>${award ? `<span class="up">+${award}</span>` : '<span class="muted">—</span>'}</span>
    <span class="meta">${esc(posName(p))} · ${p.age}y · ${heightStr(p.ht)} · ${p.wt} lb · ${p.yrs ? `${p.yrs} yr${p.yrs > 1 ? 's' : ''} exp` : 'Rookie'} · ${mpg ? `${mpg.mpg.toFixed(1)} MPG` : 'DNP'}</span>
    ${ups || d.potDelta || d.regDelta ? `<span class="chg">${ups}${longevityBadges(p, d)}</span>` : ''}
  </div>`;
}

actions.reportNav = d => replace('report', { g: +d.g });

function apSummary(d) {
  return CATEGORIES.map((c, i) => d.apDelta[i] ? `${c.key} ${d.apDelta[i] > 0 ? '+' : ''}${d.apDelta[i]}` : '')
    .filter(Boolean).join(' · ');
}

function playerRow(p, d) {
  const pos = POSITIONS[p.pos] ?? p.pos;
  const mpg = lastSeasonMpg(p, state.leagueIdx);
  const award = awardOf(p);
  const detail = [apSummary(d), d.points ? changeSummary(d) : ''].filter(Boolean).join(' · ');
  return `<button class="prow" data-act="openPlayer" data-id="${p.id}">
    <span class="name">${esc(playerName(p))}</span>
    <span class="right">
      <span class="stars">${stars(p.pot)}</span><br>
      ${award ? `<span class="up">+${award}${state.params.bumpMode === 'train' ? '' : ' pts'}</span>` : '<span class="muted">—</span>'}
    </span>
    <span class="meta">${esc(pos)} · ${p.age}y · ${mpg ? `${mpg.mpg.toFixed(1)} MPG` : 'DNP'} · Lv ${levelOf(p)}</span>
    ${d.changed ? `<span class="chg">${esc(detail)} ${skillBadges(d)}${longevityBadges(p, d)}</span>` : ''}
  </button>`;
}

function injuryBadge(p) {
  const r = injuryRisk(p, lastSeasonYear(), state.params);
  return r ? `<span class="badge down-b">${esc(injuryName(r.worst))} · ${r.cls}</span>` : '';
}

function longevityBadges(p, d) {
  return (d.regDelta ? `<span class="badge ${d.regDelta > 0 ? 'lvl' : 'down-b'}">Regress ${p.regressionAge - d.regDelta + 1}→${p.regressionAge + 1}</span>` : '') +
    (d.potDelta > 0 ? '<span class="badge new">POT ▲</span>' : d.potDelta < 0 ? '<span class="badge down-b">POT ▼</span>' : '') +
    injuryBadge(p);
}

actions.openPlayer = d => go('player', { id: +d.id });

// ---------------------------------------------------------------------------
// Your team roster

screens.roster = (args) => {
  const L = league();
  const mine = L.teams.filter(isUserTeam);
  if (!mine.length) { replace('teams'); return; }
  let idx = mine.findIndex(t => t.id === +args.arg);
  if (idx < 0) idx = 0;
  const t = mine[idx];
  const rows = t.roster.map(p => ({ p, d: diffPlayer(p, snapOf(p)) }));
  const pts = rows.reduce((a, r) => a + r.d.apDelta.reduce((x, y) => x + y, 0), 0);
  const many = mine.length > 1;
  const prevT = mine[(idx - 1 + mine.length) % mine.length];
  const nextT = mine[(idx + 1) % mine.length];
  layout({
    title: 'Team Roster',
    left: many ? `<button class="nav-btn" data-act="nav" data-to="roster" data-arg="${prevT.id}" aria-label="Previous team">${logoImg(prevT)}◀</button>` : '',
    right: many ? `<button class="nav-btn" data-act="nav" data-to="roster" data-arg="${nextT.id}" aria-label="Next team">▶${logoImg(nextT)}</button>` : '',
    body: `
      <h2 class="team-title">${logoImg(t)}${esc(t.city)} ${esc(t.name)}</h2>
      <p class="note">${state.auto[state.leagueIdx] ? `Offseason points added: <span class="up">+${pts}</span>. Tap a player to adjust.` : 'Run the offseason bump first, or tap a player to add points by hand.'}</p>
      <div class="list">${rows.map(({ p, d }) => playerRow(p, d)).join('')}</div>`,
  });
};

// ---------------------------------------------------------------------------
// Player editor

// League ranks for last season's per-game numbers. Qualified = played at
// least half as many games as the league leader in games.
const RANK_STATS = [['PTS', 'Points'], ['REB', 'Rebounds'], ['AST', 'Assists'], ['STL', 'Steals'], ['BLK', 'Blocks']];
// `li` = the league the stats were played in (the NBA, or a college league:
// its players plus this year's draft class).
function seasonRanks(yr, li = state.leagueIdx) {
  const cache = (state.compCache[state.leagueIdx] ||= new Map());
  const key = `ranks:${li}:${yr}`;
  if (!cache.has(key)) {
    const rows = [];
    const pool = new Map();
    for (const { p } of leaguePlayers(state.data.seasonLeagues[li], true)) pool.set(p.id, p);
    if (li !== state.leagueIdx) for (const p of league().draftClass || []) pool.set(p.id, p);
    for (const p of pool.values()) {
      const st = (p.stats || []).find(x => x.league === li && x.yr === yr);
      const t = { GP: 0 };
      for (const r of st?.season || []) { t.GP += r.GP; for (const [k] of RANK_STATS) t[k] = (t[k] || 0) + r[k]; }
      if (t.GP) rows.push({ id: p.id, gp: t.GP, pg: Object.fromEntries(RANK_STATS.map(([k]) => [k, t[k] / t.GP])) });
    }
    const minGp = Math.max(...rows.map(r => r.gp), 0) / 2;
    const q = rows.filter(r => r.gp >= minGp);
    const ranks = new Map(rows.map(r => [r.id, { pg: r.pg, gp: r.gp, qualified: r.gp >= minGp, rank: {} }]));
    for (const [k] of RANK_STATS) [...q].sort((a, b) => b.pg[k] - a.pg[k]).forEach((r, i) => { ranks.get(r.id).rank[k] = i + 1; });
    cache.set(key, { ranks, of: q.length });
  }
  return cache.get(key);
}
// One compact line: "PTS 21.3 (12th) · REB 6.8 (54th) ...".
function rankLine(p) {
  const r = seasonRanks(lastSeasonYear()).ranks.get(p.id);
  if (!r) return '';
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  return `<p class="note small">${RANK_STATS.map(([k]) => `${k} ${r.pg[k].toFixed(1)}${r.rank[k] ? ` <span class="${r.rank[k] <= 10 ? 'gold' : 'muted'}">(${ord(r.rank[k])})</span>` : ''}`).join(' · ')}</p>`;
}
function rankBox(p) {
  const yr = lastSeasonYear();
  const { ranks, of } = seasonRanks(yr);
  const r = ranks.get(p.id);
  if (!r) return '';
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  return `<fieldset class="frame"><legend>${yr} Season</legend>
    <div class="statline rank-line">${RANK_STATS.map(([k, name]) => {
      const n = r.rank[k];
      return `<div><span class="muted small">${k}</span><b>${r.pg[k].toFixed(1)}</b><span class="small ${n && n <= 10 ? 'gold' : n && n <= 30 ? 'up' : 'muted'}">${n ? ord(n) : '—'}</span></div>`;
    }).join('')}</div>
    <p class="note muted small" style="margin-top:6px">${r.qualified ? `League rank among ${of} players with enough games.` : `${r.gp} games: not enough to be ranked.`}</p>
  </fieldset>`;
}

screens.player = (args) => {
  const e = findPlayer(args.id);
  if (!e) { back(); return; }
  const { p, team } = e;
  const snap = snapOf(p);
  const d = diffPlayer(p, snap);
  const ceilMode = !!args.ceil;
  const mpg = lastSeasonMpg(p, state.leagueIdx);
  const ownedOrig = new Set(snap.skills.filter(s => s.level >= 1).map(s => s.id));
  const pos = POSITIONS[p.pos] ?? p.pos;
  layout({
    title: 'Player Development',
    body: `
      <div>
        <h2 class="team-title">${team ? logoImg(team) : ''}${esc(playerName(p))}</h2>
        <p class="note">${esc(team ? `${team.city} ${team.name}` : 'Free Agent')} · ${esc(pos)} · Age ${p.age} · ${heightStr(p.ht)} · <span class="gold">Lv ${levelOf(p)}</span> · <span class="stars">${stars(p.pot)}</span></p>
        <p class="note muted small">${esc(p.arc || '')}${mpg ? ` · ${mpg.yr}: ${mpg.mpg.toFixed(1)} MPG in ${mpg.gp} games` : ''}</p>
      </div>
      ${rankBox(p)}
      ${p.season?.ap ? `<fieldset class="frame"><legend>Upgrade Points</legend>
        <div class="stack">
          ${CATEGORIES.map((c, i) => `<div class="pts-row">
            <span class="grow">${esc(c.name)} <span class="muted small">${c.attrs.join(' · ')}</span></span>
            <button class="btn square" data-act="ap" data-i="${i}" data-dir="-1" aria-label="Fewer ${esc(c.name)} points">−</button>
            <span class="pts-val ${p.season.ap[i] ? 'gold' : 'muted'}">${p.season.ap[i]}${d.apDelta[i] ? `<span class="small ${d.apDelta[i] > 0 ? 'up' : 'down'}"> ${d.apDelta[i] > 0 ? '+' : ''}${d.apDelta[i]}</span>` : ''}</span>
            <button class="btn square" data-act="ap" data-i="${i}" data-dir="1" aria-label="More ${esc(c.name)} points">+</button>
          </div>`).join('')}
        </div>
        <p class="note muted small" style="margin-top:8px">Spent in-game. Green = added this offseason${awardOf(p) ? ` (bump gave +${awardOf(p)})` : ''}.</p>
      </fieldset>` : ''}
      <fieldset class="frame"><legend>Trainer</legend>
        <div class="stack">
          ${productionText(p)}
          <div class="pts-row">
            <span class="grow">Regression age<br><span class="muted small">${regressionText(p)}</span></span>
            <button class="btn square" data-act="regAge" data-dir="-1" aria-label="Earlier regression">−</button>
            <span class="pts-val ${d.regDelta ? 'gold' : ''}">${p.regressionAge}${d.regDelta ? `<span class="small up"> ${d.regDelta > 0 ? '+' : ''}${d.regDelta}</span>` : ''}</span>
            <button class="btn square" data-act="regAge" data-dir="1" aria-label="Later regression">+</button>
          </div>
          <div class="pts-row">
            <span class="grow">Potential<br><span class="stars">${stars(p.pot)}</span>${injuryText(p)}</span>
            <button class="btn square" data-act="potAdj" data-dir="-1" aria-label="Lower potential">−</button>
            <span class="pts-val ${d.potDelta ? 'gold' : ''}">${p.pot}${d.potDelta ? `<span class="small up"> ${d.potDelta > 0 ? '+' : ''}${d.potDelta}</span>` : ''}</span>
            <button class="btn square" data-act="potAdj" data-dir="1" aria-label="Higher potential">+</button>
          </div>
        </div>
      </fieldset>
      <div class="row">
        <p class="note grow">Rating changes: <span class="${d.points > 0 ? 'up' : d.points < 0 ? 'down' : ''}">${d.points > 0 ? '+' : ''}${d.points}</span></p>
        <button class="btn small ${ceilMode ? 'on focus' : 'off'}" data-act="ceilMode">Edit Ceilings</button>
      </div>
      <fieldset class="frame"><legend>Ratings</legend>
        <div class="stack">
          ${ATTRS.map(k => attrRow(p, snap, k, ceilMode)).join('')}
        </div>
        <p class="note muted small" style="margin-top:10px">Bar = current rating, green = gained this offseason, gold mark = ceiling. Raising a rating past its ceiling lifts the ceiling with it.</p>
      </fieldset>
      <fieldset class="frame"><legend>Skills (${activeSkills(p).length})</legend>
        <div class="stack">
          ${p.skills.map((s, i) => s.level < 1 ? '' : `
            <div class="skill ${ownedOrig.has(s.id) ? '' : 'added'}">
              <div><span class="sk-name">${esc(skillName(s.id))}</span><br><span class="hint">${esc(skillTag(s.id))}</span></div>
              <div class="ctrls">
                <button class="btn ${s.equipped ? 'on' : 'off'}" data-act="equip" data-i="${i}" aria-label="Toggle equipped">${s.equipped ? 'ON' : 'OFF'}</button>
                ${isLeveled(s.id) ? `
                <button class="btn" data-act="skillLv" data-i="${i}" data-dir="-1" aria-label="Level down">−</button>
                <span class="lv">Lv ${s.level}</span>
                <button class="btn" data-act="skillLv" data-i="${i}" data-dir="1" aria-label="Level up">+</button>` : '<span class="lv muted small">No levels</span>'}
                <button class="btn" data-act="skillDel" data-i="${i}" aria-label="Remove skill">✕</button>
              </div>
            </div>`).join('')}
          ${activeSkills(p).length ? '' : '<p class="note muted">No skills.</p>'}
          <button class="btn" data-act="addSkill">＋ Add Skill</button>
        </div>
      </fieldset>
      <div class="grid2">
        <button class="btn" data-act="autoOne">🎲 Re-roll Bump</button>
        <button class="btn" data-act="revertOne">↺ Revert</button>
      </div>`,
    action: { act: 'back', label: 'Done' },
  });
};

// Rating bar colors by group: finishing (light blue), shooting (green),
// playmaking/handles (orange), defense (red).
const RATING_GROUP = { LAY: 'fin', DNK: 'fin', INS: 'fin', MID: 'sho', TPT: 'sho', FTS: 'sho', DRB: 'pla', PAS: 'pla', ORE: 'pla', DRE: 'def', STL: 'def', BLK: 'def', STR: 'phy', SPD: 'phy', STM: 'phy' };
const barClass = k => `bar${RATING_GROUP[k] ? ` c-${RATING_GROUP[k]}` : ''}`;

function attrRow(p, snap, k, ceilMode) {
  const [cur, ceil] = p.attributes[k];
  const orig = snap.attributes[k][0];
  const delta = cur - orig;
  const base = Math.min(cur, orig);
  return `<div class="attr">
    <button class="btn square" data-act="attr" data-k="${k}" data-dir="-1" aria-label="Lower ${ATTR_NAMES[k]}">−</button>
    <div class="body">
      <div class="top">
        <span class="lbl">${k} <span class="muted">${ATTR_NAMES[k]}</span></span>
        <span>${cur}${delta ? ` <span class="${delta > 0 ? 'up' : 'down'}">(${delta > 0 ? '+' : ''}${delta})</span>` : ''} <span class="gold">/ ${ceil}</span></span>
      </div>
      <div class="${barClass(k)}">
        <div class="room" style="width:${Math.min(ceil, ATTR_MAX) / ATTR_MAX * 100}%"></div>
        <div class="fill" style="width:${base / ATTR_MAX * 100}%"></div>
        ${delta > 0 ? `<div class="gain" style="left:${orig / ATTR_MAX * 100}%;width:${delta / ATTR_MAX * 100}%"></div>` : ''}
        <div class="ceil" style="left:calc(${Math.min(ceil, ATTR_MAX) / ATTR_MAX * 100}% - 2px)"></div>
      </div>
    </div>
    <button class="btn square" data-act="attr" data-k="${k}" data-dir="1" aria-label="Raise ${ATTR_NAMES[k]}">${ceilMode ? '⇡' : '+'}</button>
  </div>`;
}

function currentPlayer() {
  const a = state.stack[state.stack.length - 1].args;
  return findPlayer(a.id)?.p;
}

actions.ceilMode = () => {
  const a = state.stack[state.stack.length - 1].args;
  replace('player', { ...a, ceil: !a.ceil });
};

actions.attr = d => {
  const p = currentPlayer();
  const a = state.stack[state.stack.length - 1].args;
  const v = p.attributes[d.k];
  const dir = +d.dir;
  if (a.ceil) {
    v[1] = Math.max(v[0], Math.min(ATTR_MAX, v[1] + dir));
  } else {
    v[0] = Math.max(attrMin(d.k), Math.min(ATTR_MAX, v[0] + dir));
    if (v[0] > v[1]) v[1] = v[0];
  }
  state.dirty = true;
  render();
};

const CLASS_LABEL = {
  standard: 'standard',
  nagging: 'nagging (held back)',
  structural: 'structural',
};

function injuryText(p) {
  const yr = lastSeasonYear();
  const r = injuryRisk(p, yr, state.params);
  if (!r) return '';
  const w = r.worst;
  const linger = [r.sameType ? `${r.sameType}× same injury` : '', r.sameArea ? `${r.sameArea}× same area` : ''].filter(Boolean).join(', ');
  return `<br><span class="small down">${yr}: ${esc(injuryName(w))}, ${r.games} games out · ${CLASS_LABEL[r.cls]}${linger ? ` · recurring: ${linger}` : ''}${r.chance ? ` · ${Math.round(r.chance)}% risk` : ''}</span>`;
}

function productionText(p) {
  const prod = bumpContext().production;
  const z = prod.get(p.id);
  if (z == null) return '<p class="note muted small">Production: not enough minutes last season to judge.</p>';
  const word = z >= 1.5 ? 'standout' : z >= 0.5 ? 'above average' : z > -0.5 ? 'average' : z > -1.5 ? 'below average' : 'poor';
  const ages = r => r == null ? 'of all ages' : `aged ${p.age - r}–${p.age + r}`;
  const group = p.pos <= 2 ? 'guards' : p.pos <= 5 ? 'wings' : 'bigs';
  return `<p class="note small">Last season's production vs ${group} ${ages(prod.ranges?.get(p.id))}: <b class="${z >= 0.5 ? 'up' : z <= -0.5 ? 'down' : ''}">${word}</b> (${z >= 0 ? '+' : ''}${z.toFixed(1)} σ)</p>`;
}

function regressionText(p) {
  const ctx = bumpContext();
  const mpg = lastSeasonMpg(p, state.leagueIdx);
  const earned = earnsNaturalLongevity(p, mpg, ctx, state.params)
    ? ` · earned +1 (${mpg.gp} GP, ${mpg.mpg.toFixed(1)} MPG)` : '';
  return regressionStatus(p) + earned;
}

function regressionStatus(p) {
  const y = regressionYear(p);
  if (y < 1) return `Declines after age ${p.regressionAge} (${-y + 1} season${-y + 1 === 1 ? '' : 's'} away)`;
  return y === 1 ? `First season of decline (age ${p.age})` : `Season ${y} of decline (age ${p.age})`;
}

actions.regAge = d => {
  const p = currentPlayer();
  p.regressionAge = Math.max(25, Math.min(45, p.regressionAge + +d.dir));
  state.dirty = true;
  render();
};

actions.potAdj = d => {
  const p = currentPlayer();
  p.pot = Math.max(POT_MIN, Math.min(POT_MAX, p.pot + +d.dir));
  state.dirty = true;
  render();
};

actions.ap = d => {
  const p = currentPlayer();
  const i = +d.i;
  p.season.ap[i] = Math.max(0, p.season.ap[i] + +d.dir);
  state.dirty = true;
  render();
};

actions.equip = d => {
  const s = currentPlayer().skills[+d.i];
  s.equipped = !s.equipped;
  state.dirty = true;
  render();
};

actions.skillLv = d => {
  const s = currentPlayer().skills[+d.i];
  s.level = Math.max(1, Math.min(SKILL_MAX_LEVEL, s.level + +d.dir));
  state.dirty = true;
  render();
};

actions.skillDel = async d => {
  const p = currentPlayer();
  const s = p.skills[+d.i];
  if (!(await confirmBox(`Remove ${esc(skillName(s.id))} from ${esc(playerName(p))}? Its XP is kept.`, 'Remove'))) return;
  if (snapOf(p).skills.some(x => x.id === s.id)) { s.level = 0; s.equipped = false; }
  else p.skills.splice(+d.i, 1);
  state.dirty = true;
  render();
};

function lockedXp(p, id) {
  const s = p.skills.find(x => x.id === id && x.level < 1);
  return s ? s.xp : 0;
}

actions.addSkill = () => {
  const p = currentPlayer();
  const ranked = rankSkillsFor(p, state.profiles[state.leagueIdx]);
  const o = overlay(`
    <p class="note">Add a skill to ${esc(playerName(p))}<br><span class="muted small">Sorted by fit with their ratings</span></p>
    <div class="stack" style="max-height:55vh;overflow:auto">
      ${ranked.map(s => `<button class="btn left" data-id="${esc(s.id)}">
        <span style="flex:1;text-align:left">${esc(skillName(s.id))}<br><span class="muted small">${esc(skillTag(s.id))}</span></span>
        ${lockedXp(p, s.id) ? `<span class="muted small">${lockedXp(p, s.id)} xp</span>` : ''}
        <span class="${s.fit > 0.3 ? 'up' : s.fit > 0 ? '' : 'muted'}">${Math.round(Math.max(0, s.fit) * 100)}%</span>
      </button>`).join('') || '<p class="note">Already has every skill.</p>'}
    </div>
    <button class="btn off" data-close>Cancel</button>`);
  o.addEventListener('click', e => {
    const b = e.target.closest('[data-id],[data-close]');
    if (!b) return;
    if (b.dataset.id) {
      unlockSkill(p, b.dataset.id);
      state.dirty = true;
    }
    o.remove();
    render();
  });
};

actions.autoOne = () => {
  const li = state.leagueIdx;
  const e = findPlayer(state.stack[state.stack.length - 1].args.id);
  restore(e.p, snapOf(e.p));
  reapplyMentorship();
  const awards = runProgression([{ ...e, ...bumpContext(), spend: state.params.spendCpuPoints && !isUserTeam(e.team) }],
    { ...state.params, seed: Math.floor(Math.random() * 1e6) }, state.profiles[li]);
  (state.awards[li] ||= new Map()).set(e.p.id, awards.get(e.p.id));
  state.dirty = true;
  render();
};

actions.revertOne = () => {
  const p = currentPlayer();
  restore(p, snapOf(p));
  state.awards[state.leagueIdx]?.set(p.id, 0);
  const ms = state.mentor[state.leagueIdx];
  if (ms) ms.list = ms.list.filter(m => m.menteeId !== p.id);
  render();
  toast('Reverted to original');
};

// ---------------------------------------------------------------------------
// Settings

const STEP_FIELDS = {
  general: [
    ['seed', 'Random Seed', 1, 0, 999999],
    ['starterMpg', 'Starter MPG (bonus)', 1, 0, 48],
    ['benchMpg', 'Bench MPG (penalty below)', 1, 0, 48],
    ['regFirstYearChance', 'Delay Regression: 1st Year %', 5, 0, 100],
    ['regLaterChance', 'Delay Regression: Later Years %', 5, 0, 100],
    ['prodPotUpPerZ', 'Trainer: Potential Up % Per σ', 2, 0, 50],
    ['prodPotDownChance', 'Trainer: Potential Down %', 1, 0, 50],
    ['regDownStructural', 'Trainer: Regress Sooner, Structural %', 5, 0, 100],
    ['regDownNagging', 'Trainer: Regress Sooner, Nagging %', 5, 0, 100],
    ['regDownStandard', 'Trainer: Regress Sooner, Standard %', 1, 0, 100],
    ['regDownProdChance', 'Trainer: Regress Sooner, Poor Season %', 1, 0, 100],
    ['naturalGamesPct', 'Earned Longevity: % Of Games', 5, 0, 100],
    ['naturalMinutesPct', 'Earned Longevity: % Of Minutes', 2.5, 0, 100],
    ['naturalMinAge', 'Earned Longevity: Min Age', 1, 18, 45],
    ['potUpChance', 'Potential Upgrade %', 1, 0, 100],
    ['potUpMaxAge', 'Potential Upgrade Max Age', 1, 18, 40],
    ['mentorMinAge', 'Mentor: Min Age', 1, 25, 45],
    ['menteeMaxAge', 'Mentee: Max Age', 1, 18, 30],
    ['mentorPosRange', 'Mentor: Position Steps Apart', 1, 0, 8],
    ['mentorMaxMentees', 'Mentor: Players Per Vet', 1, 1, 5],
    ['mentorshipChance', 'Mentor: CPU Chance %', 5, 0, 100],
    ['injuryMinGames', 'Injury: Min Games Missed', 1, 0, 82],
    ['injuryPotPerGame', 'Injury: % Risk Per Game', 0.1, 0, 2],
    ['injuryPotMax', 'Injury: Max Risk %', 5, 0, 100],
    ['injuryLowerBodyMult', 'Injury: Lower-Body Multiplier', 0.1, 1, 2],
    ['injuryLongevityCut', 'Injury: Cut To Regression Delay %', 5, 0, 100],
    ['naggingRiskMult', 'Nagging Injury: Risk ×', 0.05, 1, 3],
    ['naggingPointsMult', 'Nagging Injury: Bump Points ×', 0.05, 0, 1],
    ['structuralRiskMult', 'Structural Injury: Risk ×', 0.05, 1, 3],
    ['structuralLongevityCut', 'Structural: Cut To Regression Delay %', 5, 0, 100],
  ],
  skills: [
    ['newSkillChance', 'New Skill Chance %', 5, 0, 100],
    ['skillMaxAge', 'New Skill Max Age', 1, 18, 45],
    ['skillMinPoints', 'Min Points For New Skill', 1, 0, 20],
    ['maxSkills', 'Max Skills Per Player', 1, 0, 24],
    ['levelUpChance', 'Skill Level-Up Chance %', 5, 0, 100],
    ['levelUpMaxAge', 'Level-Up Max Age', 1, 18, 45],
  ],
};

function stepper(label, act, data, value) {
  return `<fieldset class="frame"><legend>${esc(label)}</legend>
    <div class="stepper">
      <button class="btn square" data-act="${act}" ${data} data-dir="-1" aria-label="Decrease">−</button>
      <div class="val">${esc(value)}</div>
      <button class="btn square" data-act="${act}" ${data} data-dir="1" aria-label="Increase">+</button>
    </div></fieldset>`;
}

function options(label, key, opts) {
  const v = state.params[key];
  return `<fieldset class="frame"><legend>${esc(label)}</legend><div class="opts">
    ${opts.map(([val, text]) => `<button class="btn ${v === val ? 'on focus' : 'off'}" data-act="setOpt" data-k="${key}" data-v='${JSON.stringify(val)}'>${esc(text)}</button>`).join('')}
  </div></fieldset>`;
}

screens.settings = (args) => {
  const tab = args.tab || 'general';
  const P = state.params;
  let body = '';
  if (tab === 'general') {
    body = `
      ${state.data && state.data.seasonLeagues.length > 1 ? `<fieldset class="frame"><legend>League</legend><div class="opts">
        ${state.data.seasonLeagues.map((L, i) => `<button class="btn ${i === state.leagueIdx ? 'on focus' : 'off'}" data-act="setLeague" data-i="${i}">${esc(L.shortName)}</button>`).join('')}
      </div></fieldset>` : ''}
      ${options('Include Free Agents', 'includeFreeAgents', [[false, 'Off'], [true, 'On']])}
      ${options('Offseason Bump', 'bumpMode', [['train', 'Rating Upgrades'], ['points', 'Upgrade Points']])}
      ${options('Mentors Teach Elite Skills', 'mentorTeachElite', [[false, 'No'], [true, 'Yes']])}
      ${options('CPU Points', 'spendCpuPoints', [[false, 'Hold for Game'], [true, 'Spend Now']])}
      <p class="note muted small">Commissioner saves: the CPU holds points unless in-game auto progression is on. "Spend Now" applies CPU points to ratings in this app instead.</p>
      ${options('Point Focus', 'strengthBias', [[0, 'Room to Grow'], [0.5, 'Balanced'], [1, 'Strengths']])}
      ${STEP_FIELDS.general.map(([k, l, s]) => stepper(l, 'step', `data-k="${k}" data-s="${s}"`, P[k])).join('')}
      ${options('Starter Multiplier', 'starterMult', [[1, '×1.0'], [1.25, '×1.25'], [1.5, '×1.5']])}
      ${options('Bench Multiplier', 'benchMult', [[0.5, '×0.5'], [0.75, '×0.75'], [1, '×1.0']])}`;
  } else if (tab === 'ages') {
    let lo = 0;
    body = `<p class="note">Upgrade points each player earns this offseason, by age (before the minutes multiplier). Players older than the last band get nothing.</p>` +
      P.ageBands.map((b, i) => {
        const label = `Age ${lo === 0 ? 'up to ' : `${lo}–`}${b[0]}`;
        lo = b[0] + 1;
        return `<fieldset class="frame"><legend>${label}</legend>
          <div class="grid2">
            <div><p class="note muted small center">Min pts</p><div class="stepper">
              <button class="btn square" data-act="band" data-i="${i}" data-j="1" data-dir="-1" aria-label="Decrease">−</button>
              <div class="val">${b[1]}</div>
              <button class="btn square" data-act="band" data-i="${i}" data-j="1" data-dir="1" aria-label="Increase">+</button></div></div>
            <div><p class="note muted small center">Max pts</p><div class="stepper">
              <button class="btn square" data-act="band" data-i="${i}" data-j="2" data-dir="-1" aria-label="Decrease">−</button>
              <div class="val">${b[2]}</div>
              <button class="btn square" data-act="band" data-i="${i}" data-j="2" data-dir="1" aria-label="Increase">+</button></div></div>
          </div>
          <div class="stepper" style="margin-top:8px">
            <button class="btn square" data-act="band" data-i="${i}" data-j="0" data-dir="-1" aria-label="Decrease">−</button>
            <div class="val small">Up to age ${b[0]}</div>
            <button class="btn square" data-act="band" data-i="${i}" data-j="0" data-dir="1" aria-label="Increase">+</button></div>
        </fieldset>`;
      }).join('');
  } else if (tab === 'rookies') {
    let lo = 0;
    body = `<p class="note">Rookie bump after the draft: upgrade points by age, times a multiplier by draft round.</p>` +
      P.rookieBands.map((b, i) => {
        const last = i === P.rookieBands.length - 1;
        const label = last ? `Age ${lo}+` : `Age ${lo === 0 ? 'up to ' : `${lo}–`}${b[0]}`;
        lo = b[0] + 1;
        const st = (j, v, lbl) => `<div><p class="note muted small center">${lbl}</p><div class="stepper">
          <button class="btn square" data-act="rband" data-i="${i}" data-j="${j}" data-dir="-1" aria-label="Decrease">−</button>
          <div class="val">${v}</div>
          <button class="btn square" data-act="rband" data-i="${i}" data-j="${j}" data-dir="1" aria-label="Increase">+</button></div></div>`;
        return `<fieldset class="frame"><legend>${label}</legend><div class="grid2">${st(1, b[1], 'Min pts')}${st(2, b[2], 'Max pts')}</div></fieldset>`;
      }).join('') +
      `<fieldset class="frame"><legend>Age Adjustment</legend><div class="stack">${P.recoveryBands.map((b, i) => `<div class="pts-row">
        <span class="grow">Age ${i === 0 ? `up to ${b[0]}` : b[0] >= 99 ? `${P.recoveryBands[i - 1][0] + 1}+` : `${P.recoveryBands[i - 1][0] + 1}–${b[0]}`}</span>
        <button class="btn square" data-act="recBand" data-i="${i}" data-dir="-1" aria-label="Less recovery">−</button>
        <span class="pts-val">+${b[1]}</span>
        <button class="btn square" data-act="recBand" data-i="${i}" data-dir="1" aria-label="More recovery">+</button></div>`).join('')}
        <p class="note muted small">Draft-drop points won back right after the draft (of the −${DRAFT_DROP}, at most +2).</p></div></fieldset>` +
      options('Undrafted Rookies', 'rookieIncludeUndrafted', [[false, 'Skip'], [true, 'Include']]) +
      options('Scouting Report Accuracy', 'scoutVariance', [[0, 'Perfect'], [15, 'Sharp'], [25, 'Normal'], [40, 'Murky']]) +
      `<p class="note muted small">How often a prospect's scouting report reads their potential one step high or low (0% / 15% / 25% / 40%).</p>` +
      options('Live Draft: CPU Trade-Ups', 'liveCpuTradeChance', [[0, 'Off'], [5, 'Rare'], [10, 'Normal'], [20, 'Busy']]) +
      options('Commissioner Mode (Trades)', 'commissioner', [[false, 'Off'], [true, 'On']]) +
      `<p class="note muted small">On: trade for any team, force trades through, undo draft-day trades and reset the draft. Off: you trade for the teams you control, CPU teams have to accept, and trades are final.</p>` +
      options('2nd-Round Rookie Deals', 'rookieR2Years', [[2, '2 years'], [3, '3 years'], [4, 'Game default (4)']]) +
      options('Free Agency: Game\'s CPU Offers', 'faClearCpuOffers', [[true, 'Clear after each day'], [false, 'Keep']]) +
      `<p class="note muted small">How often CPU teams trade up before a first-round pick. Just-drafted rookies can be traded right away.</p>`;
  } else {
    body = `<p class="note">Optional: let the bump also unlock or level up skills. Off (0%) by default.</p>` +
      STEP_FIELDS.skills.map(([k, l, s]) => stepper(l, 'step', `data-k="${k}" data-s="${s}"`, P[k])).join('') +
      `<p class="note muted small">New skills are chosen to fit each player's strongest ratings.</p>`;
  }
  layout({
    title: 'Bump Settings',
    body: `
      <div class="tabs">
        ${[['general', 'General'], ['ages', 'Ages'], ['rookies', 'Rookies'], ['skills', 'Skills']].map(([k, l]) =>
          `<button class="btn ${k === tab ? 'on focus' : 'off'}" data-act="setTab" data-t="${k}">${l}</button>`).join('')}
      </div>
      ${body}
      ${state.auto[state.leagueIdx] ? '<p class="note gold small">The bump already ran. Changes apply the next time you run or re-roll it.</p>' : ''}`,
    action: { act: 'resetParams', label: 'Defaults' },
  });
};

actions.setTab = d => replace('settings', { tab: d.t });
actions.setOpt = d => {
  state.params[d.k] = JSON.parse(d.v);
  if (d.k === 'scoutVariance') state.compCache = {};
  if (d.k === 'lotteryFormat' && state.data) { draftState().lottery = null; draftState().mock = null; }
  saveParams();
  render();
};
actions.step = d => {
  const f = [...STEP_FIELDS.general, ...STEP_FIELDS.skills].find(x => x[0] === d.k);
  state.params[d.k] = Math.round(Math.max(f[3], Math.min(f[4], state.params[d.k] + f[2] * +d.dir)) * 100) / 100;
  saveParams();
  render();
};
actions.band = d => {
  const bands = state.params.ageBands;
  const b = bands[+d.i];
  const j = +d.j;
  b[j] = Math.max(0, Math.min(j === 0 ? 60 : 20, b[j] + +d.dir));
  if (j === 1 && b[1] > b[2]) b[2] = b[1];
  if (j === 2 && b[2] < b[1]) b[1] = b[2];
  if (j === 0) {
    const prev = bands[+d.i - 1]?.[0] ?? 15;
    const next = bands[+d.i + 1]?.[0] ?? 99;
    b[0] = Math.max(prev + 1, Math.min(next - 1, b[0]));
  }
  saveParams();
  render();
};
actions.recBand = d => {
  const b = state.params.recoveryBands[+d.i];
  b[1] = Math.max(0, Math.min(2, b[1] + +d.dir)); // capped at +2
  state.compCache = {};
  saveParams();
  render();
};
actions.rband = d => {
  const b = state.params.rookieBands[+d.i];
  const j = +d.j;
  b[j] = Math.max(0, Math.min(20, b[j] + +d.dir));
  if (j === 1 && b[1] > b[2]) b[2] = b[1];
  if (j === 2 && b[2] < b[1]) b[1] = b[2];
  saveParams();
  render();
};
actions.resetParams = async () => {
  if (!(await confirmBox('Reset all bump settings to defaults?', 'Reset'))) return;
  state.params = structuredClone(DEFAULT_PARAMS);
  saveParams();
  render();
};
actions.setLeague = d => {
  state.leagueIdx = +d.i;
  loadUserTeams();
  render();
};

// ---------------------------------------------------------------------------
// Draft room

function draftState() {
  const li = state.leagueIdx;
  return (state.draft[li] ||= { lottery: null, mock: null, trades: [] });
}

function compPool() {
  const li = state.leagueIdx;
  return (state.compPools[li] ||= buildCompPool(league()));
}

// Comps are assigned class-wide (no repeats, Legends rare), best prospects
// first.
function compsFor(p) {
  const cache = (state.compCache[state.leagueIdx] ||= new Map());
  if (!cache.has('class')) {
    const bands = state.params.recoveryBands;
    const base = [...league().draftClass].sort((a, b) => baseValue(b) - baseValue(a));
    cache.set('class', assignClassComps(base, compPool(), {
      floorVec: x => floorVector(x, bands),
      ceilVec: x => projectedCeiling(x, scoutPot(x)),
      potOf: scoutPot,
    }));
  }
  return cache.get('class').get(p.id) || { floor: [], ceiling: [] };
}

const TIER_CLASS = { Legend: 't-legend', 'Hall of Fame': 't-hof', Superstar: 't-super', 'All-Star': 't-star', Starter: 't-start', 'Role Player': 't-role', 'Bench Depth': 't-bench', Project: 't-proj' };
const tierTag = tier => `<span class="tier ${TIER_CLASS[tier] || ''}">${esc(tier)}</span>`;
const compLine = c => c.floor[0] || c.ceiling[0]
  ? `Floor: ${esc(c.floor[0]?.name || '—')} ${c.floor[0] ? tierTag(c.floor[0].tier) : ''} · Ceiling: <span class="up">${esc(c.ceiling[0]?.name || '—')}</span> ${c.ceiling[0] ? tierTag(c.ceiling[0].tier) : ''}`
  : '';

function scoutList(p) {
  const r = scoutingReport(p, league(), scoutPot(p));
  return `<ul class="scout">
    ${r.strengths.map(s => `<li class="plus"><b>${esc(s.text)}</b><span class="muted small"> · ${esc(s.detail)}</span></li>`).join('')}
    ${r.weakness ? `<li class="minus"><b>${esc(r.weakness.text)}</b><span class="muted small"> · ${esc(r.weakness.detail)}</span></li>` : ''}
  </ul>`;
}

// Fogged potential for draft-room views (stable per save + prospect).
function saveSalt() {
  const s = `${league().meta?.saveName || ''}:${league().season.currentYear}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const scoutPot = p => scoutedPot(p, saveSalt(), state.params.scoutVariance);
// Draft board value: projected ceiling at the scouted tier first, then the
// floor, with a bonus for both (see draftScore). Vectors cached per class.
function draftVecs() {
  const cache = (state.compCache[state.leagueIdx] ||= new Map());
  if (!cache.has('vecs')) {
    const bands = state.params.recoveryBands;
    const ceil = new Map(), floor = new Map();
    const fns = {
      ceilOf: p => { if (!ceil.has(p.id)) ceil.set(p.id, projectedCeiling(p, scoutPot(p))); return ceil.get(p.id); },
      floorOf: p => { if (!floor.has(p.id)) floor.set(p.id, floorVector(p, bands)); return floor.get(p.id); },
      potOf: p => scoutPot(p),
    };
    const cls = league().draftClass || [];
    cache.set('vecs', { fns, scales: cls.length ? classScales(cls, fns.ceilOf, fns.floorOf) : { cm: 0, cs: 1, fm: 0, fs: 1 } });
  }
  return cache.get('vecs');
}
const baseValue = p => { const v = draftVecs(); return draftScore(p, v.scales, v.fns, null); };
// Floor and ceiling comps both All-Star or better: the safest stars in the
// class go to the top of every board.
const ALL_STAR = 8;
function eliteBonus(p) {
  const c = compsFor(p);
  const f = c.floor[0]?.pot ?? 0, ce = c.ceiling[0]?.pot ?? 0;
  if (!f || !ce) return 0;
  // The comp tiers count directly (a Hall of Fame ceiling beats a
  // Superstar one, a Starter floor beats Bench Depth)...
  const tiers = 0.9 * (ce - ALL_STAR) + 0.3 * (f - 6);
  // ...and All-Star-or-better on both ends goes to the top.
  return tiers + (f >= ALL_STAR && ce >= ALL_STAR ? 1.5 + (f - ALL_STAR) * 0.3 : 0);
}
const scoutValue = p => baseValue(p) + eliteBonus(p);
// Draft value shown next to prospects: 1–99.
const valueNum = p => Math.max(1, Math.min(99, Math.round(40 + 10 * scoutValue(p))));

// A team's draft outlook: win-now or not, and its two needs.
function teamOutlook(team) {
  const cache = (state.compCache[state.leagueIdx] ||= new Map());
  if (!cache.has('needBase')) cache.set('needBase', needBaseline(league()));
  const baseline = cache.get('needBase');
  const status = teamStatus(league(), team);
  return { status, winNow: status === 'contending', needs: teamNeeds(league(), team, baseline), baseline };
}

// A CPU team's pick: its own value of each prospect plus draft-day noise.
// `noise` is how far a team's own read can stray from the board (the mock
// draft uses more so re-runs differ).
function teamDraftPick(team, available, rng, noise = 0.35) {
  const v = draftVecs();
  const ctx = teamOutlook(team);
  const gauss = () => { const u = Math.max(1e-9, rng()), w = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
  let best = null, bestScore = -Infinity;
  for (const p of available) {
    const sc = draftScore(p, v.scales, v.fns, ctx) + eliteBonus(p) + gauss() * noise;
    if (sc > bestScore) { best = p; bestScore = sc; }
  }
  return best;
}

// Which needs a prospect fills for a team ("Guards · Playmaking").
function fillsFor(team, p) {
  const v = draftVecs();
  const o = teamOutlook(team);
  const c = v.fns.ceilOf(p), f = v.fns.floorOf(p);
  return needsFilled(p, o.needs, o.baseline, c.map((x, i) => (x + f[i]) / 2));
}
// Draft grade: where the board projects them, with a stable scouting
// nudge near the cutoffs so grades read like real projections, not ranks.
const GRADES = [
  ['Consensus #1', 'g-one'], ['Top 5', 'g-top5'], ['Lottery', 'g-lot'], ['First Round', 'g-r1'],
  ['Second Round', 'g-r2'], ['UDFA', 'g-udfa'], ['N/A', 'g-na'],
];
function gradeOf(p) {
  const cache = (state.compCache[state.leagueIdx] ||= new Map());
  if (!cache.has('ranks')) cache.set('ranks', new Map(boardOrder().map((x, i) => [x.id, i + 1])));
  const rank = cache.get('ranks').get(p.id);
  if (!rank) return GRADES[6];
  if (rank === 1) return GRADES[0];
  const n = cache.get('ranks').size;
  const jitter = ((Math.imul(p.id + 7919, 2654435761) >>> 0) / 4294967296 - 0.5) * 0.4;   // ±20%
  const eff = Math.max(2, Math.round(rank * (1 + jitter)));
  if (eff <= 5) return GRADES[1];
  if (eff <= 14) return GRADES[2];
  if (eff <= 30) return GRADES[3];
  if (eff <= 60) return GRADES[4];
  if (eff <= 60 + Math.max(5, Math.ceil((n - 60) / 2))) return GRADES[5];
  return GRADES[6];
}
const valueChip = p => { const [label, cls] = gradeOf(p); return `<span class="grade ${cls}">${label}</span>`; };
// One prospect in the "make your pick" list.
const pickRow = (p, { star = false, fills = [] } = {}) => `<button class="pick-row" data-id="${p.id}">
  <span class="pr-top"><b>${star ? '<span class="gold">★</span> ' : ''}${esc(playerName(p))}</b>${valueChip(p)}</span>
  <span class="pr-meta">${esc(posName(p))} · ${p.age}y · ${classYear(p)} · ${heightStr(p.ht)} · Ceiling ${esc(compsFor(p).ceiling[0]?.name || '—')}</span>
  ${fills.length ? `<span class="pr-fill">Fills ${esc(fills.map(n => n.label).join(', '))}</span>` : ''}
</button>`;
const statusTag = st => `<span class="status s-${st}">${STATUS_NAMES[st]}</span>`;
const needChips = needs => needs.map(n => `<span class="badge need">${esc(n.label)}</span>`).join('');

function rookieCompsFor(p) {
  const cache = (state.compCache[state.leagueIdx] ||= new Map());
  if (!cache.has('rookies')) {
    const pending = !state.summer[state.leagueIdx] && !summerDone();
    const origs = pending ? loadOriginals() : {};
    const bands = state.params.recoveryBands;
    cache.set('rookies', assignClassComps(leagueRookies(league()).map(r => r.p), compPool(), {
      floorVec: x => rookieFloorVector(x, origs[x.id] || null, bands),
      ceilVec: x => projectedCeiling(x, scoutPot(x)),
      potOf: scoutPot,
    }));
  }
  return cache.get('rookies').get(p.id) || { floor: [], ceiling: [] };
}

const avg = v => v.reduce((a, b) => a + b, 0) / v.length;
const posName = p => POSITIONS[p.pos] ?? p.pos;

function boardOrder() {
  const bands = state.params.recoveryBands;
  return [...league().draftClass].sort((a, b) => scoutValue(b) - scoutValue(a));
}

function draftedMap() {
  const m = new Map();
  for (const pk of draftState().mock?.picks || []) if (pk.pid != null) m.set(pk.pid, pk);
  return m;
}

// Your War Room board: prospects you add from Consensus, in your order.
// Remembered per league + season. (Older saves had a watch list; it seeds
// the board.)
function boardStore() {
  let b;
  try { b = JSON.parse(localStorage.getItem(`hlc:board:${seasonKey()}`)) || {}; } catch { b = {}; }
  if (!Array.isArray(b.board)) b.board = [...(b.watch || [])];
  return b;
}
function saveBoardStore(b) {
  try { localStorage.setItem(`hlc:board:${seasonKey()}`, JSON.stringify({ board: b.board })); } catch { /* ignore */ }
}
const onBoard = id => boardStore().board.includes(id);
// Prospects on your board, in your order (drafted ones drop off).
function myBoard() {
  const byId = new Map((league().draftClass || []).map(p => [p.id, p]));
  return boardStore().board.filter(id => byId.has(id)).map(id => byId.get(id));
}
// Your board first, then everyone else in consensus order (the pick list).
function myBoardOrder() {
  const mine = myBoard();
  return [...mine, ...boardOrder().filter(p => !mine.includes(p))];
}

actions.toggleBoard = d => {
  const b = boardStore();
  const id = +d.id;
  b.board = b.board.includes(id) ? b.board.filter(x => x !== id) : [...b.board, id];
  saveBoardStore(b);
  render();
};

// Put a prospect at #1 on your board (adding them if they aren't on it).
actions.topBoard = d => {
  const b = boardStore();
  const id = +d.id;
  b.board = [id, ...myBoard().map(p => p.id).filter(x => x !== id)];
  saveBoardStore(b);
  toast('Moved to #1 on your board');
  render();
};

actions.moveBoard = d => {
  const b = boardStore();
  const ids = myBoard().map(p => p.id);
  const i = ids.indexOf(+d.id), j = i + +d.dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  b.board = ids;
  saveBoardStore(b);
  render();
};

const DRAFT_TABS = [['live', 'Live'], ['consensus', 'Consensus'], ['warroom', 'War Room'], ['office', 'Front Office']];
// Draft-room tabs open in each calendar step.
function draftTabsNow(L = league()) {
  const step = phaseRank(L.season) === 0 ? null : currentStep()?.key;
  if (step === 'draft') return ['live', 'consensus', 'warroom'];
  if (step === 'warroom') return ['consensus', 'warroom', 'office'];
  return DRAFT_TABS.map(([k]) => k).filter(k => k !== 'live' || liveReady(L));
}
const liveReady = (L = league()) => L.season.phase === PHASE_PRE_DRAFT && lotteryDone(L) && L.draftClass?.length > 0;

screens.draft = (args) => {
  const L = league();
  const okTabs = draftTabsNow(L);
  const tab = okTabs.includes(args.tab) ? args.tab : okTabs[0];
  if (!L.draftClass?.length) {
    const rookies = leagueRookies(L);
    layout({
      title: 'Draft Room',
      body: rookies.length ? `
        <div class="tabs"><button class="btn on focus">Rookie Class</button></div>
        <p class="note muted small">The draft is done. Floor = ratings after the −${DRAFT_DROP} drop${state.summer[state.leagueIdx] || summerDone() ? ' and summer league' : ' plus projected summer league recovery (when pre-draft ratings are known)'}; ceiling = top ratings.</p>
        <div class="list">${rookies.map(r => {
          const c = rookieCompsFor(r.p);
          return `<button class="prow ${isUserTeam(r.team) ? 'sel' : ''}" data-act="openPlayer" data-id="${r.p.id}">
            <span class="name">${r.pick ? `#${r.pick} ` : ''}${esc(playerName(r.p))}</span>
            <span class="right"><span class="small">${r.team ? esc(r.team.shortName) : 'FA'}</span></span>
            <span class="meta">${esc(posName(r.p))} · ${r.p.age}y · ${heightStr(r.p.ht)}</span>
            <span class="chg">${compLine(c)}</span>
          </button>`;
        }).join('')}</div>`
      : `<p class="note">This file has no draft class yet. Prospects appear once the offseason starts (before the lottery).</p>`,
    });
    return;
  }
  const allowed = draftTabsNow(L);
  const tabs = `<div class="tabs">${DRAFT_TABS.filter(([k]) => allowed.includes(k)).map(([k, l]) =>
    `<button class="btn ${k === tab ? 'on focus' : 'off'}" data-act="draftTab" data-t="${k}">${l}</button>`).join('')}</div>`;
  const body = { live: draftLive, consensus: draftConsensus, warroom: draftWarRoom, office: draftOffice }[tab](args);
  layout({ title: tab === 'live' ? 'NBA Draft' : 'War Room', body: (tab === 'live' ? '' : outlookCard()) + tabs + body.html, action: body.action });
};

actions.draftTab = d => replace('draft', { tab: d.t });

// Your teams at a glance: stage, needs and draft capital.
function outlookCard() {
  const L = league();
  const mine = L.teams.filter(isUserTeam);
  if (!mine.length) return '';
  const order = actualDraftOrder(L) || [];
  const yr = L.season.currentYear;
  const tname = id => L.teams.find(t => t.id === id)?.shortName || '?';
  return mine.map(t => {
    const o = teamOutlook(t);
    const now = order.filter(q => q.owner.id === t.id).map(q => `#${q.overall}${q.orig.id !== t.id ? ` <span class="muted">(${esc(q.orig.shortName)})</span>` : ''}`);
    const byYear = new Map();
    for (const pk of [...t.draftPicks].filter(pk => pk.yr > yr).sort((a, b) => a.yr - b.yr || a.rd - b.rd)) {
      if (!byYear.has(pk.yr)) byYear.set(pk.yr, []);
      byYear.get(pk.yr).push(`R${pk.rd}${pk.otid !== t.id ? ` <span class="muted">(${esc(tname(pk.otid))})</span>` : ''}`);
    }
    const future = [...byYear].map(([y, list]) => `<div class="ol-yr"><b>${y}</b><span>${list.map(x => `<span class="ol-fp">${x}</span>`).join('')}</span></div>`);
    const need = n => { const [g, k] = n.label.split(' · '); return `<span class="ol-need"><b>${esc(g)}</b>${k ? `<span>${esc(k)}</span>` : ''}</span>`; };
    const [c1, c2] = (t.teamColors || []).map(c => /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : null);
    return `<div class="outlook" ${c1 ? `style="--tc1:${c1};--tc2:${c2 || c1}"` : ''}>
      <div class="outlook-top ${c1 ? 'tc' : ''}">${logoImg(t)}<b>${esc(t.city)} ${esc(t.name)}</b>${statusTag(o.status)}</div>
      <dl class="ol-grid">
        <dt>Needs</dt><dd class="ol-needs">${o.needs.map(need).join('') || '<span class="muted">—</span>'}</dd>
        <dt>This draft</dt><dd class="ol-picks">${now.map(x => `<span class="ol-pick">${x}</span>`).join('') || '<span class="muted">No picks</span>'}</dd>
        <dt>Future</dt><dd class="ol-future">${future.join('') || '<span class="muted">—</span>'}</dd>
      </dl>
    </div>`;
  }).join('');
}

const prospectRow = (p, extra = '') => {
  const c = compsFor(p);
  const t = league().teams.find(isUserTeam);
  const fills = t ? fillsFor(t, p) : [];
  const comp = (label, x, cls = '') => x ? `<span class="pr-comp"><span class="muted">${label}</span><span class="${cls}">${esc(x.name)}</span>${tierTag(x.tier)}</span>` : '';
  return `<button class="prow cprow ${onBoard(p.id) ? 'sel' : ''}" data-act="openProspect" data-id="${p.id}">
  <span class="name">${onBoard(p.id) ? '<span class="gold">★</span> ' : ''}${esc(playerName(p))}</span>
  <span class="meta">${esc(posName(p))} · ${p.age}y · ${heightStr(p.ht)} ${valueChip(p)}</span>
  <span class="chg">${comp('Floor', c.floor[0])}${comp('Ceiling', c.ceiling[0], 'up')}${fills.length ? `<span class="up">Fills ${esc(fills.map(n => n.label).join(', '))}</span>` : ''}${extra}</span>
</button>`;
};

// Consensus: the whole class, ranked by the scouts.
function draftConsensus() {
  const rows = boardOrder();
  return {
    html: `<p class="note muted small">${rows.length} prospects ranked by our scouts: All-Star-or-better floor and ceiling comps first, then projected ceiling, then floor, and younger is better. + Board adds a prospect to your War Room board; ⇡ Top makes them your #1.</p>
      <div class="list">${rows.map((p, i) => `<div class="board-row">${prospectRow(p).replace('<span class="name">', `<span class="name"><span class="rank-no">${i + 1}</span>`)}
        <div class="mv2"><button class="mvbtn ${onBoard(p.id) ? 'on' : ''}" data-act="toggleBoard" data-id="${p.id}" aria-label="${onBoard(p.id) ? 'Remove from' : 'Add to'} your board">${onBoard(p.id) ? '✓<span>On Board</span>' : '+<span>Board</span>'}</button><button class="mvbtn" data-act="topBoard" data-id="${p.id}" aria-label="Make #1 on your board">⇡<span>Top</span></button></div></div>`).join('')}</div>`,
  };
}

// War Room: your board, then the first-round mock draft.
function draftWarRoom() {
  const board = myBoard();
  const mock = mock30();
  const byId = new Map(league().draftClass.map(p => [p.id, p]));
  return {
    html: `<fieldset class="frame"><legend>Your Board</legend>
        ${board.length ? `<div class="brows">${board.map((p, i) => `<div class="brow">
          <span class="rk gold">${i + 1}</span>
          <button class="bname" data-act="openProspect" data-id="${p.id}"><b>${esc(playerName(p))}</b><span class="bmeta"><span class="muted small">${esc(posName(p))} · ${p.age}y · ${heightStr(p.ht)} · ${classYear(p)}</span> ${valueChip(p)}</span>${compsFor(p).ceiling[0] ? `<span class="bceil small"><span class="muted">Ceiling</span> <span class="up">${esc(compsFor(p).ceiling[0].name)}</span></span>` : ''}</button>
          <span class="mv"><button class="mvb" data-act="moveBoard" data-id="${p.id}" data-dir="-1" aria-label="Move up" ${i ? '' : 'disabled'}>▲</button><button class="mvb" data-act="moveBoard" data-id="${p.id}" data-dir="1" aria-label="Move down" ${i < board.length - 1 ? '' : 'disabled'}>▼</button><button class="mvb x" data-act="toggleBoard" data-id="${p.id}" aria-label="Remove">✕</button></span>
        </div>`).join('')}</div>`
        : '<p class="note">Your board is empty. Add prospects from Consensus with +, then order them here. When you\'re on the clock, your board comes first.</p>'}
      </fieldset>
      <fieldset class="frame"><legend>Mock Draft · First Round</legend>
        <p class="note muted small" style="margin-bottom:8px">How the first round could go, from each team's stage, needs and board. Trades in the front office change who picks where.</p>
        <div class="list">${mock.map(m => {
          const p = byId.get(m.pid);
          const t = league().teams.find(x => x.id === m.tid);
          return `<div class="lot-row ${isUserTeam(t) ? 'mine' : ''}"><span class="pk">${m.overall}</span>${logoImg(t)}
            <span class="grow"><b class="small">${esc(t.shortName)}</b> <span class="small">${p ? `${onBoard(p.id) ? '<span class="gold">★</span> ' : ''}${esc(playerName(p))} <span class="muted">${esc(posName(p))} · ${classYear(p)}</span>` : '—'}</span></span>${p ? valueChip(p) : ''}</div>`;
        }).join('')}</div>
        <button class="btn" data-act="mockRerun" style="margin-top:10px">🔄 Re-run Mock</button>
      </fieldset>`,
  };
}

// College class from years already played (Hoop Land's `yrs`).
const classYear = p => ['Fr', 'So', 'Jr', 'Sr'][Math.max(0, Math.min(3, p.yrs ?? (p.age - 18)))];

// First-round mock from the real order, using every team's own picks logic.
function mock30() {
  const ds = draftState();
  const order = (actualDraftOrder(league()) || draftOrder(league(), null, 1)).filter(o => o.rd === 1);
  const sig = order.map(o => o.owner.id).join(',');
  if (!ds.mock30 || ds.mock30.sig !== sig) {
    const rng = mulberry32(ds.mockSeed ||= Math.floor(Math.random() * 1e9));
    const taken = new Set();
    const picks = order.map(o => {
      const p = teamDraftPick(o.owner, league().draftClass.filter(x => !taken.has(x.id)), rng, 0.75);
      if (p) taken.add(p.id);
      return { overall: o.overall, tid: o.owner.id, pid: p?.id };
    });
    ds.mock30 = { sig, picks };
  }
  return ds.mock30.picks;
}
actions.mockRerun = () => { const ds = draftState(); ds.mockSeed = Math.floor(Math.random() * 1e9); ds.mock30 = null; render(); };

// Front Office: your trade block, offers from around the league, and your
// own trades.
function draftOffice() {
  const L = league();
  const ds = draftState();
  const mine = L.teams.filter(isUserTeam);
  if (!mine.length) return { html: '<p class="note">Pick your teams first.</p>' };
  const team = L.teams.find(t => t.id === (ds.officeTeam ?? mine[0].id)) || mine[0];
  const assets = liveAssets(team).filter(x => !x.prospect);
  const block = (ds.block ||= new Set());
  const offers = (ds.offers ||= frontOfficeOffers(team));
  const live = liveState();
  return {
    html: `
      ${mine.length > 1 ? `<div class="opts">${mine.map(t => `<button class="btn small ${t === team ? 'on focus' : 'off'}" data-act="officeTeam" data-id="${t.id}">${esc(t.shortName)}</button>`).join('')}</div>` : ''}
      <fieldset class="frame"><legend>Offers</legend>
        ${offers.length ? `<div class="stack">${offers.map((o, i) => `<div class="offer"><p class="note small"><b>${esc(o.team.shortName)}</b> ${o.kind === 'up' ? 'want to move up' : 'offer'}: ${esc(o.give.map(x => x.text).join(' + '))}<br><span class="muted">for ${esc(o.get.map(x => x.text).join(' + '))}</span></p>
          <button class="btn small" data-act="officeAccept" data-i="${i}">Accept</button></div>`).join('')}</div>`
        : `<p class="note">No offers yet. Put players or picks on the block below${block.size ? ', then field offers' : ''}.</p>`}
        <div class="grid2" style="margin-top:10px">
          <button class="btn focus" data-act="officeField">📞 Field Offers</button>
          <button class="btn" data-act="liveTrade">🔁 Build a Trade</button>
        </div>
      </fieldset>
      <fieldset class="frame"><legend>Trade Block</legend>
        <p class="note muted small" style="margin-bottom:8px">Tap to put a player or pick on the block. Teams pick up the phone for what's on it; teams behind your picks may call about moving up anyway.</p>
        ${(() => {
          const row = x => `<button class="pick ${block.has(x.key) ? 'sel' : ''} ${x.locked ? 'locked' : ''}" ${x.locked ? 'disabled' : `data-act="officeBlock" data-k="${x.key}"`}>
          <span class="check"></span><span class="grow">${x.html ? x.label : esc(x.label)}</span></button>`;
          const picks = assets.filter(x => x.pick), players = assets.filter(x => !x.pick);
          return `${picks.length ? `<div class="pick-grid">${picks.map(row).join('')}</div>` : ''}<div class="list" style="margin-top:8px">${players.map(row).join('')}</div>`;
        })()}
      </fieldset>
      ${live.trades.length ? `<fieldset class="frame"><legend>Trades Made</legend><div class="stack">
        ${live.trades.map((t, i) => `<div class="row"><p class="note grow small">${esc(t.text)}</p>${!t.cpu && state.params.commissioner ? `<button class="btn small" data-act="liveUndoTrade" data-i="${i}">Undo</button>` : ''}</div>`).join('')}
      </div></fieldset>` : ''}`,
  };
}

// Offers for what's on the block (and calls to move up into your picks):
// each CPU team builds a package worth a bit less than what it gets, from
// its own picks and players (never its two best players).
function frontOfficeOffers(team) {
  const L = league();
  const ds = draftState();
  const block = ds.block || new Set();
  const rng = mulberry32((ds.offerSeed ||= Math.floor(Math.random() * 1e9)));
  const mineAll = liveAssets(team).filter(x => !x.locked);
  const onBlock = mineAll.filter(x => block.has(x.key));
  const out = [];
  const ly = lastYear();
  const others = L.teams.filter(t => !isUserTeam(t)).sort(() => rng() - 0.5);
  const text = x => x.pick ? (x.key.startsWith('c:') ? `#${x.key.slice(2)}` : pickLabel(x.pick))
    : `${playerName(x.player)} (Lv ${levelOf(x.player)}${contractText(x.player) ? `, ${contractText(x.player)}` : ''}${contractValue(x.player).tag ? `, ${contractValue(x.player).tag}` : ''})`;
  for (const want of onBlock) {
    let n = 0;
    for (const t of others) {
      if (n >= 3) break;
      if (rng() < 0.45) continue;
      const stars = new Set([...t.roster].sort((a, b) => playerValue(b, state.leagueIdx, ly) - playerValue(a, state.leagueIdx, ly)).slice(0, 2));
      const theirs = liveAssets(t).filter(x => !x.prospect && !x.locked && !(x.player && stars.has(x.player))).sort((a, b) => a.value - b.value);
      const lo = want.value * 0.8, hi = want.value * 1.0;
      let pack = theirs.find(x => x.value >= lo && x.value <= hi);
      if (!pack) {
        outer: for (let i = 0; i < theirs.length; i++) for (let j = i + 1; j < theirs.length; j++) {
          const v = theirs[i].value + theirs[j].value;
          if (v >= lo && v <= hi) { pack = [theirs[i], theirs[j]]; break outer; }
        }
      }
      if (!pack) continue;
      const give = [pack].flat();
      // Skip pointless swaps (their 2030 R1 for your 2030 R1).
      if (give.length === 1 && give[0].pick && want.pick && give[0].pick.yr === want.pick.yr && give[0].pick.rd === want.pick.rd) continue;
      out.push({ team: t, kind: 'block', give: give.map(x => ({ ...x, text: text(x) })), get: [{ ...want, text: text(want) }] });
      n++;
    }
  }
  // Teams a few slots behind your picks calling to move up.
  const order = actualDraftOrder(L) || [];
  order.forEach((o, idx) => {
    if (o.owner.id !== team.id) return;
    for (const x of tradeUpOffers(L, order, idx, { value: futureValue, slot: slotValue, rng, count: 1, eager: 0.7 })) {
      out.push({ team: x.team, kind: 'up',
        give: x.give.map(pk => ({ pick: pk, key: pk.yr === L.season.currentYear ? `c:${order.find(q => slotPick(L, q) === pk)?.overall}` : `f:${pk.yr}:${pk.rd}:${pk.otid}`, text: pk.yr === L.season.currentYear ? `#${order.find(q => slotPick(L, q) === pk)?.overall}` : pickLabel(pk) })),
        get: [{ pick: x.get, key: `c:${o.overall}`, text: `#${o.overall}` }] });
    }
  });
  return out;
}

actions.officeTeam = d => { const ds = draftState(); ds.officeTeam = +d.id; ds.offers = null; render(); };
actions.officeBlock = d => {
  const ds = draftState();
  const b = (ds.block ||= new Set());
  if (b.has(d.k)) b.delete(d.k); else b.add(d.k);
  render();
};
actions.officeField = () => {
  const ds = draftState();
  ds.offerSeed = Math.floor(Math.random() * 1e9);
  const L = league();
  const mine = L.teams.filter(isUserTeam);
  const team = L.teams.find(t => t.id === (ds.officeTeam ?? mine[0]?.id)) || mine[0];
  ds.offers = frontOfficeOffers(team);
  render();
  toast(ds.offers.length ? `${ds.offers.length} offer${ds.offers.length > 1 ? 's' : ''} came in` : 'No takers right now');
};
actions.officeAccept = async d => {
  const ds = draftState();
  const L = league();
  const o = ds.offers?.[+d.i];
  if (!o) return;
  const mine = L.teams.filter(isUserTeam);
  const team = L.teams.find(t => t.id === (ds.officeTeam ?? mine[0].id)) || mine[0];
  if (!(await confirmBox(`Send ${esc(o.get.map(x => x.text).join(' + '))} to ${esc(o.team.shortName)} for ${esc(o.give.map(x => x.text).join(' + '))}?`, 'Accept'))) return;
  const side = (t, items) => ({ team: t, picks: items.filter(x => x.pick).map(x => x.pick), players: items.filter(x => x.player).map(x => x.player), prospects: [] });
  liveExecute(side(team, o.get), side(o.team, o.give));
  for (const x of o.get) ds.block?.delete(x.key);
  ds.offers = null;
  ds.mock30 = null;
  render();
};

// College prospects carry the college league's logo.
const COLLEGE_LOGO = '<img class="college-logo" src="icons/league-ball.png" alt="">';

function collegeRank(p, c, k) {
  if (c.li == null) return '';
  const n = seasonRanks(c.yr, c.li).ranks.get(p.id)?.rank[k];
  if (!n) return '';
  const ord = n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  return `<span class="small ${n <= 10 ? 'gold' : n <= 30 ? 'up' : 'muted'}">${ord}</span>`;
}

function collegeBox(p) {
  const c = collegeLine(p, state.data.seasonLeagues);
  if (!c) return '';
  const f = (v, d = 1) => (v == null ? '—' : v.toFixed(d));
  return `<fieldset class="frame"><legend>College · ${c.yr}</legend>
    <p class="note small college-head">${COLLEGE_LOGO}<span><b>${esc(c.team)}</b><br><span class="muted">${c.gp} games · ${f(c.mpg)} MPG</span></span></p>
    <div class="statline">
      ${[['PTS', f(c.pts)], ['REB', f(c.reb)], ['AST', f(c.ast)], ['STL', f(c.stl)], ['BLK', f(c.blk)],
         ['FG%', f(c.fg)], ['3P%', f(c.tp)], ['3PA', f(c.tpa)], ['FT%', f(c.ft)], ['TOV', f(c.tov)]]
        .map(([k, v], i) => `<div><span class="muted small">${k}</span><b>${v}</b>${i < 5 ? collegeRank(p, c, RANK_STATS[i][0]) : ''}</div>`).join('')}
    </div>${c.li != null && seasonRanks(c.yr, c.li).ranks.get(p.id)?.qualified ? `<p class="note muted small" style="margin-top:6px">Ranks among ${seasonRanks(c.yr, c.li).of} college players with enough games.</p>` : ''}</fieldset>`;
}

// Where the prospect would slot on each of your teams, as a rookie and at
// their projected ceiling.
function slotBox(p, rookieLine, ceilLine) {
  const mine = league().teams.filter(isUserTeam);
  if (!mine.length) return '';
  const role = { guard: 'guards', wing: 'wings', big: 'bigs' };
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const label = n => (n === 1 ? 'Franchise player' : n <= 3 ? 'Core starter' : n <= 5 ? 'Starter' : n <= 8 ? 'Rotation' : n <= 12 ? 'Bench' : 'End of bench');
  const year3 = rookieLine.map((v, i) => Math.round((v + ceilLine[i]) / 2));
  return `<fieldset class="frame"><legend>Fit On Your Team</legend><div class="stack">
    ${mine.map(t => {
      const stops = [['Rookie', rookieLine], ['Year 3', year3], ['Ceiling', ceilLine]].map(([k, line]) => [k, rosterSlot(t.roster, line, p.pos)]);
      return `<div><p class="note"><b>${esc(t.city)} ${esc(t.name)}</b></p>
        <div class="fit">${stops.map(([k, s]) => `<div><span class="muted small">${k}</span><b>${ord(s.rank)}</b><span class="small">${label(s.rank)}</span><span class="muted small">${ord(s.roleRank)} of ${s.roleOf} ${role[s.role]}</span></div>`).join('')}</div></div>`;
    }).join('')}
  </div></fieldset>`;
}

actions.openProspect = d => go('prospect', { id: +d.id });

screens.prospect = (args) => {
  const p = league().draftClass.find(x => x.id === args.id);
  if (!p) { back(); return; }
  const c = compsFor(p);
  const fv = rookieLine(p, state.params.recoveryBands), cv = projectedCeiling(p, scoutPot(p));
  // How much of a dip to expect after the draft: older prospects win
  // more back in summer league.
  const loss = fv.reduce((a, v, i) => a + p.attributes[SKILL_ATTRS[i]][0] - v, 0) / SKILL_ATTRS.length;
  const dip = loss < 1.2 ? ['Small', 'up'] : loss < 2.2 ? ['Moderate', 'gold'] : ['Big', 'down'];
  const compList = (list, cls) => list.map(x => `<div class="comp">
    <span class="grow"><b class="${cls}">${esc(x.name)}</b><br>${tierTag(x.tier)}<br><span class="muted small">${esc(POSITIONS[x.pos] ?? '')} · ${heightStr(x.ht)}${x.wt ? ` · ${x.wt} lb` : ''}</span></span></div>`).join('') || '<p class="note muted">—</p>';
  layout({
    title: 'Prospect',
    body: `
      <div>
        <h2 class="team-title">${esc(playerName(p))}</h2>
        <p class="note">${esc(collegeLine(p, state.data.seasonLeagues)?.team || 'Prospect')} · ${esc(posName(p))} · ${heightStr(p.ht)} · ${p.wt} lb</p>
        <p class="note small"><span class="age-chip">Age ${p.age} · ${classYear(p)}</span> Draft-day dip: <b class="${dip[1]}">${dip[0]}</b> <span class="muted">(older prospects get more of it back in the age adjustment)</span></p>
      </div>
      <button class="btn small ${onBoard(p.id) ? 'on focus' : 'off'}" data-act="toggleBoard" data-id="${p.id}">${onBoard(p.id) ? '★ On Your Board' : '+ Add to Your Board'}</button>
      <fieldset class="frame"><legend>Scouting Report</legend>${scoutList(p)}</fieldset>
      ${collegeBox(p)}
      <div class="grid2">
        <fieldset class="frame"><legend>Floor</legend>${compList(c.floor, '')}</fieldset>
        <fieldset class="frame"><legend>Ceiling</legend>${compList(c.ceiling, 'up')}</fieldset>
      </div>
      ${slotBox(p, fv, cv)}
      <fieldset class="frame"><legend>Ratings</legend>
        <div class="rk-head rk2"><span></span><span>Now</span><span>Ceiling</span></div>
        ${SKILL_ATTRS.map(k => {
          const now = p.attributes[k][0], ceil = Math.max(now, cv[SKILL_ATTRS.indexOf(k)]);
          return `<div class="rk rk2">
          <span>${k} <span class="muted small">${ATTR_NAMES[k]}</span></span>
          <span>${now}</span>
          <span class="gold">${ceil}</span>
          <div class="${barClass(k)}"><div class="room" style="width:${ceil / ATTR_MAX * 100}%"></div><div class="fill" style="width:${now / ATTR_MAX * 100}%"></div><div class="ceil" style="left:calc(${ceil / ATTR_MAX * 100}% - 2px)"></div></div>
        </div>`;
        }).join('')}
        ${PHYSICAL.map(k => { const [now, ceil] = p.attributes[k]; return `<div class="rk rk2"><span>${k} <span class="muted small">${ATTR_NAMES[k]}</span></span><span>${now}</span><span class="gold">${ceil}</span>
          <div class="${barClass(k)}"><div class="room" style="width:${Math.min(ceil, ATTR_MAX) / ATTR_MAX * 100}%"></div><div class="fill" style="width:${now / ATTR_MAX * 100}%"></div><div class="ceil" style="left:calc(${Math.min(ceil, ATTR_MAX) / ATTR_MAX * 100}% - 2px)"></div></div></div>`; }).join('')}
        <p class="note muted small" style="margin-top:8px">The filled bar is today's rating; the outlined part runs to the projected ceiling (the notch). Scouting isn't perfect.</p>
      </fieldset>`,
  });
};

// ---- Lottery

function draftLottery() {
  const L = league();
  const ds = draftState();
  const P = state.params;
  const setup = lotterySetup(L, P.lotteryFormat, P.lotteryDraws);
  const draws = setup.draws;
  const odds = lotteryOdds(L, P.lotteryFormat, P.lotteryDraws, 5000, 1);
  const { table } = setup;
  const rec = new Map(table.map(r => [r.team.id, r]));
  const totalW = odds.reduce((a, r) => a + r.weight, 0) || 1;
  const actual = lotteryDone(L);
  const result = actual
    ? actualDraftOrder(L).filter(o => o.rd === 1).slice(0, setup.lotteryTeams.length)
        .map(o => ({ team: o.orig, seed: setup.lotteryTeams.indexOf(o.orig) }))
    : ds.lottery;
  if (actual) return {
    html: `<fieldset class="frame"><legend>Lottery Result</legend>
      <p class="note muted small" style="margin-bottom:8px">The lottery has been drawn in this save. The mock draft uses this order.</p>
      <div class="list">${result.map((r, i) => {
        const move = r.seed - i;
        const rr = rec.get(r.team.id);
        return `<div class="lot-row ${isUserTeam(r.team) ? 'mine' : ''}"><span class="pk">${i + 1}</span>${logoImg(r.team)}<span class="grow">${esc(r.team.shortName)} <span class="muted small">${rr.W}-${rr.L}</span></span>
          ${move > 0 ? `<span class="up">▲${move}</span>` : move < 0 ? `<span class="down">▼${-move}</span>` : '<span class="muted">—</span>'}</div>`;
      }).join('')}</div>
      <button class="btn" data-act="draftTab" data-t="mock" style="margin-top:10px">▶ Mock Draft</button></fieldset>`,
  };
  return {
    html: `
      ${options('Lottery Format', 'lotteryFormat', [['auto', 'Auto'], ['321', '3-2-1'], ['classic', 'Classic']])}
      ${setup.format === '321'
        ? `<p class="note muted small">${P.lotteryFormat === 'auto' ? 'Detected from your league settings. ' : ''}3-2-1 lottery (NBA 2027+): all ${draws} lottery picks are drawn; the 3 worst teams pick no lower than #12.</p>`
        : `<div class="stepper">
        <button class="btn square" data-act="lotteryDraws" data-dir="-1" aria-label="Fewer picks drawn">−</button>
        <div class="val small">Top ${draws} pick${draws > 1 ? 's' : ''} drawn</div>
        <button class="btn square" data-act="lotteryDraws" data-dir="1" aria-label="More picks drawn">+</button>
      </div>`}
      <button class="btn big focus" data-act="simLottery">🎲 Simulate Lottery</button>
      ${result ? `<fieldset class="frame"><legend>Lottery Result</legend><div class="list">
        ${result.map((r, i) => {
          const move = r.seed - i;
          return `<div class="lot-row ${isUserTeam(r.team) ? 'mine' : ''}"><span class="pk">${i + 1}</span>${logoImg(r.team)}<span class="grow">${esc(r.team.shortName)} <span class="muted small">${rec.get(r.team.id).W}-${rec.get(r.team.id).L}</span></span>
            ${move > 0 ? `<span class="up">▲${move}</span>` : move < 0 ? `<span class="down">▼${-move}</span>` : '<span class="muted">—</span>'}</div>`;
        }).join('')}
      </div>
      <button class="btn" data-act="draftTab" data-t="mock" style="margin-top:10px">▶ Mock Draft With This Order</button></fieldset>` : ''}
      <fieldset class="frame"><legend>Odds</legend>
        <div class="odds-head"><span>Seed</span><span>Team</span><span>Weight</span><span>#1</span><span>Top ${setup.format === '321' ? 4 : draws}</span></div>
        ${odds.map(r => {
          const rr = rec.get(r.team.id);
          const top = r.pct.slice(0, setup.format === '321' ? 4 : draws).reduce((a, b) => a + b, 0);
          return `<div class="odds-row ${isUserTeam(r.team) ? 'mine' : ''}"><span>${r.seed + 1}</span><span>${esc(r.team.shortName)} <span class="muted small">${rr.W}-${rr.L}</span></span><span>${(r.weight / totalW * 100).toFixed(1)}%</span><span>${r.pct[0].toFixed(1)}%</span><span>${top.toFixed(1)}%</span></div>`;
        }).join('')}
        <p class="note muted small" style="margin-top:8px">Weights come from your league's lottery settings (worst record = seed 1). Odds from 5,000 simulations.</p>
      </fieldset>`,
  };
}

// Lottery step, one screen: the format and odds with a Run button, then
// the result in the same place once it's drawn.
screens.lottery = () => {
  const L = league();
  if (lotteryDone(L)) { lotteryResultView(); return; }
  const P = state.params;
  const setup = lotterySetup(L, P.lotteryFormat);
  const odds = lotteryOdds(L, P.lotteryFormat, null, 20000, 1);
  const rec = new Map(setup.table.map(r => [r.team.id, r]));
  const totalW = odds.reduce((a, r) => a + r.weight, 0) || 1;
  const topN = setup.format === 'old' ? 3 : 4;
  const F = LOTTERY_FORMATS[setup.format];
  const out = setup.table.slice(setup.lotteryTeams.length);
  layout({
    title: 'Draft Lottery',
    body: `
      <div class="opts lot-formats">${Object.entries(LOTTERY_FORMATS).map(([k, f]) => `<button class="btn ${k === setup.format ? 'on focus' : 'off'}" data-act="lotFormat" data-f="${k}">${f.name}<span class="small">${f.era}</span></button>`).join('')}</div>
      <button class="btn big focus" data-act="advLottery">🎱 Begin Lottery</button>
      <fieldset class="frame"><legend>${esc(F.name)}</legend>
        <p class="note muted small odds-key"><span class="gold">■</span> #1 pick · <span class="cyan">■</span> top ${topN}</p>
        <div class="odds-head lot"><span>Seed</span><span>Team</span><span>#1</span><span>Top ${topN}</span></div>
        ${odds.map(r => {
          const rr = rec.get(r.team.id);
          const top = Math.min(100, r.pct.slice(0, topN).reduce((a, b) => a + b, 0));
          // Relegation zone: labelled and highlighted, with a red line under its last team.
          const zone = setup.floor && r.seed === 0 ? '<div class="releg-label">Relegation zone</div>' : '';
          const inZone = setup.floor && r.seed < setup.floor.floorTeams;
          const cut = setup.floor && r.seed === setup.floor.floorTeams - 1;
          return `${zone}<div class="odds-row lot ${inZone ? 'releg' : ''} ${cut ? 'releg-cut' : ''} ${isUserTeam(r.team) ? 'mine' : ''}"><span>${r.seed + 1}</span><span>${esc(r.team.shortName)} <span class="muted small">${rr.W}-${rr.L}</span></span><span>${r.pct[0].toFixed(1)}%</span><span>${top.toFixed(1)}%</span>
            <span class="odds-bar" aria-hidden="true"><i class="top" style="width:${top}%"></i><i class="one" style="width:${r.pct[0]}%"></i></span></div>`;
        }).join('')}
        ${out.length ? `<p class="note muted small" style="margin-top:8px">Out of the lottery (pick by record): ${out.map(r => esc(r.team.shortName)).join(', ')}.</p>` : ''}
      </fieldset>`,
  });
};

actions.lotFormat = d => {
  state.params.lotteryFormat = d.f;
  saveParams();
  draftState().lottery = null;
  draftState().mock = null;
  render();
};

// The real lottery's result, right after it's drawn.
function lotteryResultView() {
  const L = league();
  const setup = lotterySetup(L, state.params.lotteryFormat, state.params.lotteryDraws);
  const pre = setup.table.map(r => r.team);
  const rec = new Map(setup.table.map(r => [r.team.id, r]));
  const order = (actualDraftOrder(L) || []).filter(o => o.rd === 1).slice(0, setup.lotteryTeams.length);
  layout({
    title: 'Draft Lottery',
    body: `<div class="list lot-result">${order.map((o, i) => {
        const move = pre.indexOf(o.orig) - i;
        const rr = rec.get(o.orig.id);
        return `<div class="lot-row ${isUserTeam(o.owner) ? 'mine' : ''}" data-pick="${i + 1}" data-name="${esc(`${o.orig.city} ${o.orig.name}`.trim())}" data-move="${move}"><span class="pk">${i + 1}</span>${logoImg(o.orig)}
          <span class="grow">${esc(o.orig.shortName)} <span class="muted small">${rr ? `${rr.W}-${rr.L}` : ''}</span> ${statusTag(teamStatus(L, o.orig))}${o.owner.id !== o.orig.id ? ` <span class="small gold">→ ${esc(o.owner.shortName)}</span>` : ''}</span>
          <span class="mv ${move > 0 ? 'up' : move < 0 ? 'down' : 'muted'}">${move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : '—'}</span></div>`;
      }).join('')}</div>
      <button class="btn big focus" data-act="faHome">📅 Back to the Calendar</button>`,
  });
  if (state.lotteryReveal) { state.lotteryReveal = false; revealLottery(); }
}

// Lottery reveal: the last lottery pick is announced first, then each pick
// above it, the view panning up as it goes. The top 5 take longer, with a
// mystery card before each reveal; #1 gets the big moment.
async function revealLottery() {
  const list = $app.querySelector('.lot-result');
  if (!list) return;
  const rows = [...list.querySelectorAll('.lot-row')];
  const done = $app.querySelector('[data-act=faHome]');
  list.classList.add('revealing');
  if (done) done.style.display = 'none';
  const skip = document.createElement('button');
  skip.className = 'btn small lot-skip';
  skip.textContent = 'Skip ⏭';
  list.before(skip);
  let skipped = false;
  skip.addEventListener('click', () => { skipped = true; });
  const wait = ms => new Promise(r => { const t0 = Date.now(); const tick = () => (skipped || Date.now() - t0 >= ms ? r() : requestAnimationFrame(tick)); tick(); });
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  await wait(500);
  for (const row of [...rows].reverse()) {
    if (!row.isConnected) return; // left the screen
    const pick = +row.dataset.pick;
    const big = pick <= 5;
    row.scrollIntoView({ behavior: skipped ? 'auto' : 'smooth', block: 'center' });
    if (big && !skipped) {
      row.classList.add('tease');
      await wait(pick === 1 ? 2600 : pick === 2 ? 2000 : 1400);
      row.classList.remove('tease');
    }
    row.classList.add('shown');
    if (big) row.classList.add(pick === 1 ? 'top1' : 'big');
    await wait(big ? 900 : 650);
  }
  list.classList.remove('revealing');
  skip.remove();
  if (done) done.style.display = '';
  const top = rows[0];
  if (top) {
    const jump = +top.dataset.move;
    toast(`🎱 ${top.dataset.name} win the lottery!`, jump > 0 ? `Jumped ${jump} spot${jump > 1 ? 's' : ''} to #1.` : 'They held onto the top spot.');
  }
}

actions.lotteryDraws = d => {
  const n = lotterySetup(league()).lotteryTeams.length;
  state.params.lotteryDraws = Math.max(1, Math.min(n, state.params.lotteryDraws + +d.dir));
  saveParams();
  render();
};

actions.simLottery = () => {
  const ds = draftState();
  ds.lottery = runLottery(league(), state.params.lotteryFormat, state.params.lotteryDraws, mulberry32(Math.floor(Math.random() * 1e9)));
  ds.mock = null;
  render();
};

// ---- Mock draft

function ensureMock() {
  const ds = draftState();
  if (!ds.mock) {
    const order = draftOrder(league(), ds.lottery?.map(r => r.team) || null, state.params.draftRounds);
    ds.mock = { picks: order.map(o => ({ ...o, ownerShort: o.owner.shortName, pid: null })) };
  }
  return ds.mock;
}

function mockAvailable(mock) {
  const taken = new Set(mock.picks.map(p => p.pid).filter(x => x != null));
  return league().draftClass.filter(p => !taken.has(p.id));
}

function simMock(untilUser, auto = false) {
  const mock = ensureMock();
  mock.rng ||= mulberry32(Math.floor(Math.random() * 1e9));
  for (const pk of mock.picks) {
    if (pk.pid != null) continue;
    if (untilUser && !auto && isUserTeam(pk.owner)) break;
    const p = teamDraftPick(pk.owner, mockAvailable(mock), mock.rng);
    if (!p) break;
    pk.pid = p.id;
  }
}

function draftMock() {
  const ds = draftState();
  const mock = ensureMock();
  const byId = new Map(league().draftClass.map(p => [p.id, p]));
  const onClock = mock.picks.find(p => p.pid == null);
  const userOnClock = onClock && isUserTeam(onClock.owner);
  return {
    html: `
      <p class="note muted small">${lotteryDone(league()) ? 'Using the real draft order from this save.' : ds.lottery ? 'Using your simulated lottery.' : 'No lottery simulated: order is by record.'} ${state.userTeams.size ? 'You pick for your teams.' : 'Pick your teams to draft for them.'}</p>
      <div class="grid2">
        <button class="btn" data-act="mockSim" data-u="1" ${onClock ? '' : 'disabled'}>⏩ To My Pick</button>
        <button class="btn" data-act="mockSim" data-u="0" ${onClock ? '' : 'disabled'}>⏭ Sim All</button>
      </div>
      ${userOnClock ? `<button class="btn big focus" data-act="mockChoose">🎯 ${esc(onClock.owner.shortName)} on the clock: make pick #${onClock.overall}</button>` : ''}
      <div class="list">
        ${mock.picks.map(pk => {
          const p = pk.pid != null ? byId.get(pk.pid) : null;
          const traded = pk.owner.id !== pk.orig.id;
          return `<div class="lot-row ${isUserTeam(pk.owner) ? 'mine' : ''} ${pk === onClock ? 'clock' : ''}">
            <span class="pk">${pk.overall}</span>${logoImg(pk.owner)}
            <span class="grow">${esc(pk.owner.shortName)}${traded ? ` <span class="muted small">via ${esc(pk.orig.shortName)}</span>` : ''}${pk.rd > 1 ? ` <span class="muted small">R${pk.rd}</span>` : ''}<br>
              ${p ? `${valueChip(p)} <span class="small">${esc(playerName(p))} · ${esc(posName(p))} · ${heightStr(p.ht)}</span><br><span class="small muted">${compLine(compsFor(p))}</span>` : `<span class="small muted">${pk === onClock ? 'On the clock' : '—'}</span>`}</span>
          </div>`;
        }).join('')}
      </div>`,
    action: { act: 'mockReset', label: 'Reset' },
  };
}

actions.mockSim = d => { simMock(d.u === '1'); render(); };
actions.mockReset = () => { draftState().mock = null; render(); };
actions.mockChoose = () => {
  const mock = ensureMock();
  const pk = mock.picks.find(p => p.pid == null);
  const avail = mockAvailable(mock).sort((a, b) => scoutValue(b) - scoutValue(a));
  const o = overlay(`
    <p class="note">${esc(pk.owner.shortName)} · Pick #${pk.overall}</p>
    <div class="pick-list">${avail.map(p => pickRow(p)).join('')}</div>
    <button class="btn off" data-close>Cancel</button>`);
  o.addEventListener('click', e => {
    const b = e.target.closest('[data-id],[data-close]');
    if (!b) return;
    if (b.dataset.id) pk.pid = +b.dataset.id;
    o.remove();
    render();
  });
};

// ---- Live draft

function liveState() {
  const ds = draftState();
  ds.live ||= newLiveDraft();
  ds.live.rng ||= mulberry32(Math.floor(Math.random() * 1e9));
  ds.live.offers ||= {};
  return ds.live;
}
const liveOrder = () => actualDraftOrder(league());
const lastYear = () => Math.max(...league().teams.map(t => teamRecord(t).yr || 0));
const futureValue = pk => pickValue(league(), pk);
const boardRank = p => boardOrder().indexOf(p) + 1 || 60;
const prospectById = id => league().draftClass.find(p => p.id === id);
const liveAvailable = live => league().draftClass.filter(p => !takenIds(live).has(p.id));

// CPU picks, with the odd CPU trade-up in round 1.
function liveCpuStep(live, order, idx) {
  const o = order[idx];
  if (o.rd === 1 && live.rng() * 100 < state.params.liveCpuTradeChance) {
    const [offer] = tradeUpOffers(league(), order, idx, { value: futureValue, slot: slotValue, rng: live.rng, count: 1, eager: 0.6 });
    if (offer) {
      liveExecute({ team: offer.team, picks: offer.give, players: [], prospects: [] },
        { team: o.owner, picks: [offer.get], players: [], prospects: [] }, 'CPU');
      order = liveOrder();
    }
  }
  const team = order[idx].owner;
  const p = teamDraftPick(team, liveAvailable(live), live.rng);
  if (p) makeSelection(live, order, idx, p.id);
  return !!p;
}

function liveSim(mode) {
  const live = liveState();
  let guard = 0;
  while (guard++ < 200) {
    const order = liveOrder();
    const idx = clockIndex(live, order);
    if (idx < 0) break;
    if (mode !== 'all' && isUserTeam(order[idx].owner)) break;
    if (!liveCpuStep(live, order, idx)) break;
    if (mode === 'one') break;
  }
}

const pickLabel = (pk, L = league()) => {
  const t = L.teams.find(x => x.id === pk.otid);
  return `${pk.yr} R${pk.rd}${pk.otid !== pk.tid ? ` (${t?.shortName || '?'})` : ''}`;
};

function draftLive() {
  const L = league();
  if (!liveReady(L)) return { html: '<p class="note">The live draft runs on a Pre-Draft save, after the lottery.</p>' };
  const live = liveState();
  const order = liveOrder();
  const idx = clockIndex(live, order);
  const o = idx >= 0 ? order[idx] : null;
  const user = o && isUserTeam(o.owner);
  const byId = new Map(L.draftClass.map(p => [p.id, p]));
  const teamById = id => L.teams.find(t => t.id === id);
  let offers = [];
  if (user) {
    live.offers[o.overall] ||= tradeUpOffers(L, order, idx, { value: futureValue, slot: slotValue, rng: live.rng })
      .map(x => ({ tid: x.team.id, give: x.give, get: x.get }));
    offers = live.offers[o.overall].filter(x => x.give.every(pk => teamById(x.tid).draftPicks.includes(pk)) && o.owner.draftPicks.includes(x.get));
  }
  const done = idx < 0;
  return {
    html: `
      ${state.userTeams.size ? '' : '<p class="note muted small">Select your teams to draft for them.</p>'}
      ${done ? draftRecap(live, order) : `
      ${user ? '<div class="you-clock">🚨 You are on the clock</div>' : ''}
      <div class="clock-card ${user ? 'mine' : ''}">
        <span class="pk">#${o.overall}</span>${logoImg(o.owner)}
        <span class="grow"><b>${esc(o.owner.city)} ${esc(o.owner.name)}</b><br><span class="small muted">On the clock · R${o.rd}${o.owner.id !== o.orig.id ? ` · via ${esc(o.orig.shortName)}` : ''}</span>
          <span class="needs-line">${needChips(teamOutlook(o.owner).needs)}</span></span>
      </div>
      ${user ? `<button class="btn big focus" data-act="liveChoose">🎯 Make Pick #${o.overall}</button>` : ''}
      ${offers.map((x, i) => `<div class="offer"><p class="note small"><b>${esc(teamById(x.tid).shortName)}</b> offers ${x.give.map(pk => pk.yr === L.season.currentYear ? `#${order.find(q => slotPick(L, q) === pk)?.overall}` : pickLabel(pk)).join(' + ')} for #${o.overall}</p>
        <button class="btn small" data-act="liveOffer" data-i="${i}">Accept</button></div>`).join('')}
      <div class="grid2">
        <button class="btn" data-act="liveSim" data-m="one" ${user ? 'disabled' : ''}>▶ Next Pick</button>
        <button class="btn" data-act="liveSim" data-m="user" ${user ? 'disabled' : ''}>⏩ To My Pick</button>
        <button class="btn" data-act="liveTrade">🔁 Trade</button>
        <button class="btn" data-act="liveSim" data-m="all">⏭ Sim All</button>
      </div>`}
      ${live.trades.length && !done ? tradesBox(live) : ''}
      ${done ? '' : `<div class="list">
        ${order.map((q, j) => {
          const sel = live.sel[q.overall];
          const p = sel ? byId.get(sel.pid) : null;
          const moved = sel && sel.to !== sel.by;
          return `<div class="lot-row ${isUserTeam(q.owner) ? 'mine' : ''} ${j === idx ? 'clock' : ''}">
            <span class="pk">${q.overall}</span>${logoImg(q.owner)}
            <span class="grow">${esc(q.owner.shortName)}${q.owner.id !== q.orig.id ? ` <span class="muted small">via ${esc(q.orig.shortName)}</span>` : ''}${q.rd > 1 ? ` <span class="muted small">R${q.rd}</span>` : ''}<br>
              ${p ? `<span class="small">${esc(playerName(p))} <span class="muted">${esc(posName(p))} · ${p.age}y · ${classYear(p)}</span></span>${moved ? ` <span class="small gold">→ ${esc(teamById(sel.to).shortName)}</span>` : ''}` : `<span class="small muted">${j === idx ? 'On the clock' : '—'}</span>`}</span>
            ${p ? valueChip(p) : ''}
          </div>`;
        }).join('')}
      </div>`}`,
    action: state.params.commissioner ? { act: 'liveReset', label: 'Reset Draft' } : null,
  };
}

// Draft-day trades, newest first (undo only with Commissioner Mode on).
function tradesBox(live) {
  return `<fieldset class="frame"><legend>Draft-Day Trades</legend><div class="stack">
    ${live.trades.map((t, i) => [t, i]).reverse().map(([t, i]) => `<div class="row"><p class="note grow small">${esc(t.text)}</p>${!t.cpu && state.params.commissioner ? `<button class="btn small" data-act="liveUndoTrade" data-i="${i}">Undo</button>` : ''}</div>`).join('')}
  </div></fieldset>`;
}

// After the last pick: every pick with the rookie's projected level after
// the draft dip and summer league, in team colors; sort by pick or level.
function draftRecap(live, order) {
  const L = league();
  const byId = new Map(L.draftClass.map(p => [p.id, p]));
  const sortBy = draftState().recapSort || 'pick';
  const lv = (p, line) => levelOf({ pot: p.pot, attributes: Object.fromEntries(SKILL_ATTRS.map((k, i) => [k, [line[i]]])) });
  const rows = order.filter(q => live.sel[q.overall]).map(q => {
    const sel = live.sel[q.overall];
    const p = byId.get(sel.pid);
    const team = L.teams.find(t => t.id === sel.to);
    return { q, p, team, now: levelOf(p), rookie: lv(p, rookieLine(p, state.params.recoveryBands)) };
  });
  if (sortBy === 'level') rows.sort((a, b) => b.rookie - a.rookie || a.q.overall - b.q.overall);
  const color = t => { const [c1, c2] = (t.teamColors || []).map(c => /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : null); return c1 ? `style="--tc1:${c1};--tc2:${c2 || c1}"` : ''; };
  return `<button class="btn big focus" data-act="liveFinish">✅ Finish Draft</button>
    ${live.trades.length ? tradesBox(live) : ''}
    <fieldset class="frame"><legend>Draft Recap</legend>
      <div class="opts recap-sort"><button class="btn small ${sortBy === 'pick' ? 'on focus' : 'off'}" data-act="recapSort" data-s="pick">By Pick</button><button class="btn small ${sortBy === 'level' ? 'on focus' : 'off'}" data-act="recapSort" data-s="level">Pro Readiness</button></div>
      <p class="note muted small" style="margin:6px 0 8px">Level after the draft drop and the age adjustment (older rookies get more of it back): who's most ready to play now.</p>
      <div class="stack recap">${rows.map(r => `<div class="recap-row" ${color(r.team)}>
        <span class="pk">${r.q.overall}</span>${logoImg(r.team)}
        <span class="grow"><b>${esc(playerName(r.p))}</b><br><span class="small">${esc(r.team.shortName)} · ${esc(posName(r.p))} · ${r.p.age}y · ${classYear(r.p)}</span></span>
        <span class="lv"><b>${r.rookie}</b><span class="small">Lv${r.now !== r.rookie ? ` <s>${r.now}</s>` : ''}</span></span>
      </div>`).join('')}</div>
    </fieldset>`;
}
actions.recapSort = d => { draftState().recapSort = d.s; render(); };

actions.liveSim = d => { liveSim(d.m); render(); };

actions.liveChoose = () => {
  const live = liveState();
  const order = liveOrder();
  const idx = clockIndex(live, order);
  const o = order[idx];
  const watch = new Set(boardStore().board);
  const avail = myBoardOrder().filter(p => !takenIds(live).has(p.id));
  const box = overlay(`
    <p class="note">${esc(o.owner.shortName)} · Pick #${o.overall} · your board order</p>
    <div class="pick-list">${avail.map(p => pickRow(p, { star: watch.has(p.id), fills: fillsFor(o.owner, p) })).join('')}</div>
    <button class="btn off" data-close>Cancel</button>`);
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-id],[data-close]');
    if (!b) return;
    if (b.dataset.id) makeSelection(live, order, idx, +b.dataset.id);
    box.remove();
    render();
  });
};

actions.liveOffer = async d => {
  const live = liveState();
  const L = league();
  const order = liveOrder();
  const o = order[clockIndex(live, order)];
  const x = live.offers[o.overall].filter(y => y.give.every(pk => L.teams.find(t => t.id === y.tid).draftPicks.includes(pk)))[+d.i];
  if (!x) return;
  const team = L.teams.find(t => t.id === x.tid);
  if (!(await confirmBox(`Trade #${o.overall} to ${esc(team.shortName)}?`, 'Trade'))) return;
  liveExecute({ team: o.owner, picks: [x.get], players: [], prospects: [] }, { team, picks: x.give, players: [], prospects: [] });
  render();
};

actions.liveReset = async () => {
  const live = liveState();
  if (live.trades.length && !(await confirmBox('Reset the draft? Draft-day trades are undone too.', 'Reset'))) return;
  for (const t of [...live.trades].reverse()) liveUndo(t);
  draftState().live = null;
  render();
};

// Execute a live trade. Sides: { team, picks, players, prospects: [overall] }.
function liveExecute(A, B, cpu = false) {
  const live = liveState();
  const L = league();
  const rec = executeTrade(A, B, L.season.currentYear);
  const moves = [];
  for (const [from, to] of [[A, B], [B, A]]) {
    for (const ov of from.prospects || []) { moves.push({ ov, from: from.team.id, to: to.team.id }); live.sel[ov].to = to.team.id; }
  }
  const order = liveOrder();
  const label = (side) => [
    ...side.picks.map(pk => pk.yr === L.season.currentYear ? `#${order.find(q => slotPick(L, q) === pk)?.overall ?? '?'}` : pickLabel(pk)),
    ...side.players.map(playerName),
    ...(side.prospects || []).map(ov => `${playerName(prospectById(live.sel[ov].pid))} (#${ov})`),
  ].join(', ') || 'nothing';
  const text = `${A.team.shortName} send ${label(A)} · ${B.team.shortName} send ${label(B)}`;
  live.trades.push({ rec, moves, text, cpu, at: Object.keys(live.sel).length });
  live.offers = {};
  draftState().offers = null;
  draftState().mock30 = null;
  state.dirty = true;
  toast('🚨 Trade Alert', text);
}

function liveUndo(t) {
  const live = liveState();
  draftState().offers = null;
  draftState().mock30 = null;
  undoTrade(t.rec);
  for (const m of t.moves) if (live.sel[m.ov]) live.sel[m.ov].to = m.from;
}

actions.liveUndoTrade = d => {
  const live = liveState();
  const t = live.trades[+d.i];
  liveUndo(t);
  live.trades.splice(+d.i, 1);
  live.offers = {};
  render();
  toast('Trade undone');
};

actions.liveFinish = async () => {
  const L = league();
  const live = liveState();
  const order = liveOrder();
  if (clockIndex(live, order) >= 0) { toast('Finish every pick first'); return; }
  if (!(await confirmBox('Advance in the offseason? Rookies join their teams, the rest become free agents, and we move on to Summer League.', 'Finish'))) return;
  checkpoint('Draft');
  const res = applyDraft(L, livePicks(live, order), state.leagueIdx);
  for (const r of leagueRookies(L)) state.snaps.set(snapKey(r.p.id), snapshot(r.p));
  state.compCache = {};
  state.compPools = {};
  draftState().live = null;
  draftState().mock = null;
  state.dirty = true;
  goHome();
  toast(`Draft complete: ${res.drafted} drafted, ${res.undrafted} to free agency. Next up: Summer League.`);
};

// ---- Live trade builder

// "$24M · 3 yrs" and a value tag (Final Year / Overpaid / Bargain).
function contractText(p) {
  const c = p.contract || {};
  if (!c.sal || !c.yrs) return p.status === 4 ? 'Pending FA' : '';
  return `$${c.sal}M · ${c.yrs} yr${c.yrs > 1 ? 's' : ''}`;
}
function contractBadge(p) {
  const { tag } = contractValue(p);
  return tag ? ` <span class="badge ${tag === 'Overpaid' ? 'down-b' : tag === 'Bargain' ? 'lvl' : 'new'}">${tag}</span>` : '';
}

function liveAssets(team) {
  const L = league();
  const live = liveState();
  const order = liveOrder();
  const yr = L.season.currentYear;
  const ly = lastYear();
  const out = [];
  for (const o of order) {
    if (o.owner.id !== team.id || live.sel[o.overall]) continue;
    const pk = slotPick(L, o);
    if (pk) out.push({ key: `c:${o.overall}`, label: `#${o.overall} (R${o.rd}${o.orig.id !== team.id ? `, via ${o.orig.shortName}` : ''})`, value: slotValue(o.overall), pick: pk });
  }
  for (const pk of [...team.draftPicks].filter(x => x.yr > yr).sort((a, b) => a.yr - b.yr || a.rd - b.rd)) {
    out.push({ key: `f:${pk.yr}:${pk.rd}:${pk.otid}`, label: pickLabel(pk), value: futureValue(pk), pick: pk });
  }
  for (const s of tradeableProspects(live, order, team.id, Infinity)) {
    const p = prospectById(s.pid);
    out.push({ key: `d:${s.overall}`, label: `${playerName(p)} (just drafted, ${gradeOf(p)[0]})`, value: slotValue(boardRank(p)), prospect: s.overall });
  }
  // Players whose contracts are up (pending free agents) can't be traded:
  // they're listed last, greyed out.
  const pending = p => p.status === 4 || !p.contract?.yrs;
  const roster = [...team.roster].sort((a, b) => pending(a) - pending(b) || playerValue(b, state.leagueIdx, ly) - playerValue(a, state.leagueIdx, ly));
  for (const p of roster) {
    const l = seasonLine(p, state.leagueIdx, ly);
    const ct = contractText(p);
    const locked = pending(p);
    out.push({ key: `p:${p.id}`, locked, label: `${esc(playerName(p))} <span class="gold small">Lv ${levelOf(p)}</span>${locked ? ' <span class="badge lock" title="Contract is up: can\'t be traded">🔒 Pending FA</span>' : contractBadge(p)}<br><span class="muted small">${esc(posName(p))} · ${p.age}y${l ? ` · ${l.ppg.toFixed(1)}/${l.rpg.toFixed(1)}/${l.apg.toFixed(1)}` : ''}${ct && !locked ? ` · ${ct}` : ''}</span>`, value: playerValue(p, state.leagueIdx, ly), player: p, html: true });
  }
  return out;
}

screens.liveTrade = (args) => {
  const L = league();
  const teams = [...L.teams].sort((a, b) => a.shortName.localeCompare(b.shortName));
  const order = liveOrder();
  const live = liveState();
  const idx = clockIndex(live, order);
  // Your side: your own teams (any team with Commissioner Mode on).
  const commish = !!state.params.commissioner;
  const mine = teams.filter(isUserTeam);
  const left = commish || !mine.length ? teams : mine;
  const aId = left.some(t => t.id === +args.a) ? +args.a : (left.find(isUserTeam) || order[Math.max(0, idx)]?.owner || left[0]).id;
  const onClock = order[Math.max(0, idx)]?.owner.id;
  const bId = args.b != null && +args.b !== aId ? +args.b : onClock != null && onClock !== aId ? onClock : teams.find(t => t.id !== aId).id;
  args.a = aId; args.b = bId;
  const A = L.teams.find(t => t.id === aId), B = L.teams.find(t => t.id === bId);
  const selA = new Set(args.selA || []), selB = new Set(args.selB || []);
  const aa = liveAssets(A), bb = liveAssets(B);
  const sum = (list, sel) => list.filter(x => sel.has(x.key)).reduce((s, x) => s + x.value, 0);
  const vA = sum(aa, selA), vB = sum(bb, selB);
  const list = (items, sel, side) => items.map(x => `<button class="pick ${sel.has(x.key) ? 'sel' : ''} ${x.locked ? 'locked' : ''}" ${x.locked ? 'disabled' : `data-act="liveToggle" data-side="${side}" data-k="${x.key}"`}>
      <span class="check"></span><span class="grow">${x.html ? x.label : esc(x.label)}</span></button>`).join('') || '<p class="note muted">Nothing to trade.</p>';
  const select = (side, cur) => {
    const T = L.teams.find(t => t.id === cur);
    const many = side === 'b' || left.length > 1;
    const arrow = (dir, ch) => many ? `<button class="tsel-arrow" data-act="liveCycle" data-side="${side}" data-dir="${dir}" aria-label="${dir < 0 ? 'Previous' : 'Next'} team">${ch}</button>` : `<span class="tsel-arrow off" aria-hidden="true"></span>`;
    return `<div class="tsel">${arrow(-1, '◀')}<span class="tsel-team">${logoImg(T)}<span class="tsel-name"><b>${esc(T.shortName)}</b><span class="${isUserTeam(T) ? 'gold' : 'muted'} small">${isUserTeam(T) ? 'You' : esc(T.name)}</span></span></span>${arrow(1, '▶')}</div>`;
  };
  layout({
    title: 'Draft-Day Trade',
    body: `
      <div class="grid2 trade">
        <div class="stack">${select('a', aId)}</div>
        <div class="stack">${select('b', bId)}</div>
      </div>
      ${tradeBar(A, B, vA, vB)}
      <div class="grid2 trade">
        <div class="list">${list(aa, selA, 'a')}</div>
        <div class="list">${list(bb, selB, 'b')}</div>
      </div>
      ${commish ? `<div class="grid2">
        <button class="btn focus" data-act="liveTradeGo" data-force="0">🤝 Propose</button>
        <button class="btn" data-act="liveTradeGo" data-force="1">⚡ Force</button>
      </div>` : '<button class="btn focus" data-act="liveTradeGo" data-force="0">🤝 Propose</button>'}`,
  });
  slideTradeBar();
};

actions.liveTrade = () => { tradeBarPos = 50; go('liveTrade', {}); };

// Trade balance bar. The middle is where the CPU team says yes (they want
// a little more back than they give, so "even" already includes that);
// the marker slides left the more the deal favors the left team and right
// the more it favors the right team. It animates from where it last was.
let tradeBarPos = 50;
function tradeBar(A, B, vA, vB) {
  const empty = !vA && !vB;
  const judge = isUserTeam(B) && !isUserTeam(A) ? A : B;
  const cpu = !isUserTeam(judge);
  const m = cpu ? 1.08 : 1;                                        // cpuAccepts' margin
  // What the left side sends vs what the right side sends, with the CPU's
  // ask folded in: 0 = exactly what they need, + = the right team ahead.
  const a = judge === B ? vA : vA * m, b = judge === B ? vB * m : vB;
  const lean = empty ? 0 : (a - b) / Math.max(a, b, 1);
  const pos = 50 + Math.max(-1, Math.min(1, lean)) * 46;
  const ok = judge === B ? cpuAccepts(vB, vA) : cpuAccepts(vA, vB);
  const zone = judge === B ? 'left:50%;right:0' : 'left:0;right:50%';
  const word = Math.abs(lean) < 0.06 ? 'Even' : lean > 0 ? `Favors ${B.shortName}${Math.abs(lean) > 0.35 ? ' a lot' : ''}` : `Favors ${A.shortName}${Math.abs(lean) > 0.35 ? ' a lot' : ''}`;
  const from = tradeBarPos;
  tradeBarPos = pos;
  return `<div class="tbar-wrap">
    <div class="tbar">${cpu ? `<span class="tbar-ok" style="${zone}"></span>` : ''}<span class="tbar-mid"></span><span class="tbar-mark ${empty ? 'idle' : ''}" style="left:${from}%" data-to="${pos}"></span></div>
    <p class="note center small">${empty ? '<span class="muted">Tap players or picks on either side</span>'
      : `<b>${esc(word)}</b>${cpu ? `${ok ? `<span class="up">${esc(judge.shortName)} would accept</span>` : `<span class="down">${esc(judge.shortName)} would decline</span>`}` : ''}`}</p>
  </div>`;
}
// Slide the marker from its old spot to the new one after a re-render.
function slideTradeBar() {
  const mark = $app.querySelector('.tbar-mark[data-to]');
  if (!mark) return;
  mark.getBoundingClientRect();
  requestAnimationFrame(() => { mark.style.left = `${mark.dataset.to}%`; });
}

// ◀ ▶ team pickers: your side cycles your teams (all teams for a
// Commissioner Mode), the other side cycles everyone else.
actions.liveCycle = d => {
  const L = league();
  const a = tradeArgs();
  const teams = [...L.teams].sort((x, y) => x.shortName.localeCompare(y.shortName));
  const mine = teams.filter(isUserTeam);
  const pool = d.side === 'a'
    ? (state.params.commissioner || !mine.length ? teams : mine)
    : teams.filter(t => t.id !== a.a);
  const cur = pool.findIndex(t => t.id === a[d.side]);
  const next = pool[(cur + +d.dir + pool.length) % pool.length];
  const upd = { ...a, [d.side]: next.id, [d.side === 'a' ? 'selA' : 'selB']: [] };
  if (d.side === 'a' && next.id === a.b) { upd.b = teams.find(t => t.id !== next.id).id; upd.selB = []; }
  replace('liveTrade', upd);
};

actions.liveToggle = d => {
  const a = tradeArgs();
  const k = d.side === 'a' ? 'selA' : 'selB';
  const s = new Set(a[k] || []);
  if (s.has(d.k)) s.delete(d.k); else s.add(d.k);
  replace('liveTrade', { ...a, [k]: [...s] });
};

actions.liveTradeGo = async d => {
  const a = tradeArgs();
  const L = league();
  const A = L.teams.find(t => t.id === +a.a), B = L.teams.find(t => t.id === +a.b);
  const pickSide = (team, keys) => {
    const items = liveAssets(team).filter(x => keys.includes(x.key) && !x.locked);
    return { team, items, picks: items.filter(x => x.pick).map(x => x.pick), players: items.filter(x => x.player).map(x => x.player), prospects: items.filter(x => x.prospect).map(x => x.prospect) };
  };
  const sa = pickSide(A, a.selA || []), sb = pickSide(B, a.selB || []);
  if (!sa.items.length && !sb.items.length) { toast('Tap something on either side first'); return; }
  const vA = sa.items.reduce((s, x) => s + x.value, 0), vB = sb.items.reduce((s, x) => s + x.value, 0);
  if (d.force !== '1' || !state.params.commissioner) {
    const no = [[A, vA, vB], [B, vB, vA]].find(([t, give, get]) => !isUserTeam(t) && !cpuAccepts(give, get));
    if (no) { toast(`${no[0].shortName} decline: they want more back`); return; }
  }
  liveExecute(sa, sb);
  back();
};

// ---- Pick trades

function draftTrades(args) {
  const L = league();
  const teams = [...L.teams].sort((a, b) => a.shortName.localeCompare(b.shortName));
  const mine = teams.filter(isUserTeam);
  const aId = +(args.a ?? (mine[0] || teams[0]).id);
  const bId = +(args.b ?? teams.find(t => t.id !== aId).id);
  const A = L.teams.find(t => t.id === aId), B = L.teams.find(t => t.id === bId);
  const selA = new Set(args.selA || []), selB = new Set(args.selB || []);
  const key = pk => `${pk.yr}:${pk.rd}:${pk.otid}`;
  const tname = id => L.teams.find(t => t.id === id)?.shortName || '?';
  const picks = (T, sel, side) => [...T.draftPicks]
    .filter(pk => pk.yr >= L.season.currentYear)
    .sort((x, y) => x.yr - y.yr || x.rd - y.rd)
    .map(pk => `<button class="pick ${sel.has(key(pk)) ? 'sel' : ''}" data-act="togglePick" data-side="${side}" data-k="${key(pk)}">
      <span class="check"></span><span class="grow">${pk.yr} R${pk.rd}${pk.otid !== T.id ? ` <span class="muted small">(${esc(tname(pk.otid))})</span>` : ''}</span>
      <span class="muted small">${Math.round(pickValue(L, pk))}</span></button>`).join('') || '<p class="note muted">No picks.</p>';
  const valueOf = (T, sel) => T.draftPicks.filter(pk => sel.has(key(pk))).reduce((a, pk) => a + pickValue(L, pk), 0);
  const vA = valueOf(A, selA), vB = valueOf(B, selB);
  const teamSelect = (side, cur, other) => `<select class="sel-team" data-change="tradeTeam" data-side="${side}">
    ${teams.filter(t => t.id !== other).map(t => `<option value="${t.id}" ${t.id === cur ? 'selected' : ''}>${esc(t.shortName)} · ${esc(t.name)}${isUserTeam(t) ? ' (You)' : ''}</option>`).join('')}</select>`;
  const log = draftState().trades;
  return {
    html: `
      <p class="note muted small">Swap draft picks between any two teams. Trades are written to the season file. Value is a rough guide based on last season's record and how far out the pick is.</p>
      <div class="grid2 trade">
        <div class="stack">${teamSelect('a', aId, bId)}<div class="list">${picks(A, selA, 'a')}</div><p class="note center">Sends <b>${Math.round(vA)}</b></p></div>
        <div class="stack">${teamSelect('b', bId, aId)}<div class="list">${picks(B, selB, 'b')}</div><p class="note center">Sends <b>${Math.round(vB)}</b></p></div>
      </div>
      ${log.length ? `<fieldset class="frame"><legend>Trades This Session</legend><div class="stack">
        ${log.map((t, i) => `<div class="row"><p class="note grow small">${esc(t.text)}</p><button class="btn small" data-act="undoTrade" data-i="${i}">Undo</button></div>`).join('')}
      </div></fieldset>` : ''}`,
    action: { act: 'makeTrade', label: selA.size || selB.size ? 'Trade' : 'Pick Picks' },
  };
}

function tradeArgs() { return state.stack[state.stack.length - 1].args; }

$app.addEventListener('change', e => {
  if (e.target.dataset.change !== 'tradeTeam') return;
  const a = tradeArgs();
  replace('draft', { ...a, tab: 'trades', [e.target.dataset.side]: +e.target.value, selA: [], selB: [] });
});

actions.togglePick = d => {
  const a = tradeArgs();
  const k = d.side === 'a' ? 'selA' : 'selB';
  const s = new Set(a[k] || []);
  if (s.has(d.k)) s.delete(d.k); else s.add(d.k);
  replace('draft', { ...a, tab: 'trades', [k]: [...s] });
};

actions.makeTrade = async () => {
  const a = tradeArgs();
  const L = league();
  const teams = [...L.teams].sort((x, y) => x.shortName.localeCompare(y.shortName));
  const mine = teams.filter(isUserTeam);
  const aId = +(a.a ?? (mine[0] || teams[0]).id);
  const bId = +(a.b ?? teams.find(t => t.id !== aId).id);
  const A = L.teams.find(t => t.id === aId), B = L.teams.find(t => t.id === bId);
  const key = pk => `${pk.yr}:${pk.rd}:${pk.otid}`;
  const fromA = A.draftPicks.filter(pk => (a.selA || []).includes(key(pk)));
  const fromB = B.draftPicks.filter(pk => (a.selB || []).includes(key(pk)));
  if (!fromA.length && !fromB.length) { toast('Tap picks on either side first'); return; }
  const tname = id => L.teams.find(t => t.id === id)?.shortName || '?';
  const desc = list => list.map(pk => `${pk.yr} R${pk.rd}${pk.otid !== pk.tid ? ` (${tname(pk.otid)})` : ''}`).join(', ') || 'nothing';
  const text = `${A.shortName} send ${desc(fromA)} · ${B.shortName} send ${desc(fromB)}`;
  if (!(await confirmBox(esc(text), 'Trade'))) return;
  tradePicks(A, B, fromA, fromB);
  draftState().trades.push({ text, a: A.id, b: B.id, fromA, fromB });
  draftState().mock = null;
  state.dirty = true;
  replace('draft', { ...a, tab: 'trades', selA: [], selB: [] });
  toast('Trade complete');
};

actions.undoTrade = d => {
  const ds = draftState();
  const t = ds.trades[+d.i];
  const L = league();
  const A = L.teams.find(x => x.id === t.a), B = L.teams.find(x => x.id === t.b);
  tradePicks(A, B, t.fromB, t.fromA);
  ds.trades.splice(+d.i, 1);
  ds.mock = null;
  render();
  toast('Trade undone');
};

// ---------------------------------------------------------------------------
// Free agency

const FA_DAY_RULES = {
  1: 'No more collusion: the market is open. Teams bid with cap space, a player\'s old team can go over the cap to keep him, and restricted free agents (first-rounders off their rookie deal) can be matched.',
  2: `Adds the mid-level exception: one per team over the cap, up to $${FA.FA_DEFAULTS.mle}M for 1–${FA.FA_DEFAULTS.mleMaxYears} years with an option.`,
  3: `Finalize free agency: veteran minimums ($${FA.FA_DEFAULTS.vetMin}M, 1 year, ages ${FA.FA_DEFAULTS.vetMinAge}+). Veterans who aren't chasing money will take the minimum rather than sit out the season.`,
};
const mleKey = () => `hlc:mle:${league().meta?.saveName || state.fileName}:${seasonKey()}`;
function loadMle() { try { return new Set(JSON.parse(localStorage.getItem(mleKey())) || []); } catch { return new Set(); } }
function saveMle(set) { try { localStorage.setItem(mleKey(), JSON.stringify([...set])); } catch { /* ignore */ } }

function faState() {
  const L = league();
  const li = state.leagueIdx;
  const day = Math.max(1, Math.min(3, L.season.currentDay || 1));
  let s = state.fa[li];
  if (!s || s.day !== day) {
    s = state.fa[li] = { day, stage: 'open', bids: new Map(), used: { mle: loadMle() }, rng: mulberry32(Math.floor(Math.random() * 1e9)), signings: [], cleared: null };
    s.market = FA.buildMarket(L, day);
  }
  return s;
}
const faValue = p => playerValue(p, state.leagueIdx, lastYear());
const offerText = o => `$${o.sal}M × ${o.yrs}${o.opt === FA.OPT_PLAYER ? ' · PO' : o.opt === FA.OPT_TEAM ? ' · TO' : ''}`;
const faBest = (s, m) => {
  const list = s.bids.get(m.p.id) || [];
  if (!list.length) return null;
  const score = b => FA.offerScore(league(), m.p, b, m.ask, m.motive, m.from?.id, m.min < m.ask * 0.75);
  return [...list].sort((a, b) => score(b) - score(a))[0];
};

// Years a player is looking for (shown with the ask).
const askYears = m => m.motive === 'security' ? 4 : m.p.age >= 33 ? 1 : m.p.age >= 30 ? 2 : m.motive === 'control' ? 2 : 3;
// Past their regression age: ratings are already slipping.
const declining = p => p.age > p.regressionAge;
const posGroup = p => (p.pos <= 2 ? 'guards' : p.pos <= 5 ? 'wings' : 'bigs');

screens.fa = (args = {}) => {
  const L = league();
  if (L.season.phase !== BUMP_PHASES[0]) {
    layout({ title: 'Free Agency', body: `<p class="note">Free agency runs on a Free Agency save (Day 1–3). This file is at ${esc(phaseName(L.season))}.</p>` });
    return;
  }
  const s = faState();
  const view = args.view || 'top';
  const mine = L.teams.filter(isUserTeam);
  const teamName = id => L.teams.find(t => t.id === id)?.shortName || '?';
  const signedIds = new Set(s.signings.map(x => x.p.id));
  // Your own players with expiring deals live under Your Books.
  let rows = [...s.market].sort((a, b) => levelOf(b.p) - levelOf(a.p) || faValue(b.p) - faValue(a.p));
  if (view === 'mine') rows = rows.filter(m => isUserTeam(m.from) || (s.bids.get(m.p.id) || []).some(b => isUserTeam({ id: b.tid })));
  else rows = rows.filter(m => !isUserTeam(m.from));
  if (view === 'bids') rows = rows.filter(m => s.bids.get(m.p.id)?.length);
  if (['guards', 'wings', 'bigs'].includes(view)) rows = rows.filter(m => posGroup(m.p) === view);
  const total = rows.length;
  rows = rows.slice(0, args.all ? 400 : 60);
  const views = [['top', 'Best'], ['guards', 'Guards'], ['wings', 'Wings'], ['bigs', 'Bigs'], ['bids', 'Bidding'], ['mine', 'Yours']];
  const O = FA.FA_DEFAULTS;
  const stageBtn = s.stage === 'open'
    ? '<button class="btn big focus" data-act="faOpen">🔨 Open Bidding</button>'
    : s.stage === 'bidding'
      ? '<button class="btn big focus" data-act="faDecide">✅ Players Decide</button>'
      : `<button class="btn big focus" data-act="faHome">📅 Back to the Calendar</button>${state.params.commissioner ? '<button class="btn small" data-act="faUndo">↺ Undo Today</button>' : ''}`;
  const row = m => {
    const list = s.bids.get(m.p.id) || [];
    const best = faBest(s, m);
    const mineBid = list.find(b => isUserTeam({ id: b.tid }));
    const l = seasonLine(m.p, state.leagueIdx, lastYear());
    const M = FA.MOTIVES[m.motive];
    const signed = s.signings.find(x => x.p === m.p);
    const rfa = FA.isRestricted(L, m.p);
    return `<button class="prow ${mineBid ? 'sel' : ''}" data-act="faOffer" data-id="${m.p.id}" ${signedIds.has(m.p.id) || s.stage === 'done' ? 'disabled' : ''}>
      <span class="name">${esc(playerName(m.p))} <span class="${declining(m.p) ? 'decl-lv' : 'gold'} small" ${declining(m.p) ? 'title="Past his regression age"' : ''}>Lv ${levelOf(m.p)}${declining(m.p) ? ' ↓' : ''}</span>${rfa ? ' <span class="badge new">RFA</span>' : ''}</span>
      <span class="right"><span class="small">Asks $${m.ask}M × ${askYears(m)}</span>${s.day >= 3 && m.min === O.vetMin && m.ask > m.min ? '<br><span class="small up">Takes the min</span>' : ''}<br><span class="small" title="${esc(M.text)}">${M.icon} ${esc(M.name)}</span></span>
      <span class="meta">${esc(posName(m.p))} · ${m.p.age}y${l ? ` · ${l.ppg.toFixed(1)}/${l.rpg.toFixed(1)}/${l.apg.toFixed(1)}` : ''} · ${m.from ? esc(m.from.shortName) : 'FA'}</span>
      ${signed ? `<span class="chg up">Signed: ${esc(signed.team.shortName)} ${offerText(signed.offer)}</span>`
      : list.length ? `<span class="chg">${list.length} team${list.length > 1 ? 's' : ''} interested · best ${esc(teamName(best.tid))} ${offerText(best)}${mineBid ? (best === mineBid ? ' · <span class="up">you lead</span>' : ' · <span class="down">you trail</span>') : ''}</span>` : ''}
    </button>`;
  };
  layout({
    title: `Free Agency · Day ${s.day}`,
    body: `
      <img class="hero tall" src="icons/hero-fa.jpg" alt="">
      <p class="note small">${esc(FA_DAY_RULES[s.day])}</p>
      ${mine.length ? `<fieldset class="frame"><legend>Your Books</legend><div class="stack">${mine.map(t => {
        const space = FA.capSpace(L, t);
        const mleOpen = s.day >= 2 && space < O.mle && !s.used.mle.has(t.id);
        const tools = space > 0 ? `<span class="up">$${space}M cap space</span>` : `<span class="down">$${-space}M over the cap</span>`;
        const extra = [
          s.day >= 2 ? (space >= O.mle ? '<span class="muted">Under the cap: offer anyone up to your space</span>' : mleOpen ? `<span class="gold">MLE open · up to $${O.mle}M × ${O.mleMaxYears}</span>` : '<span class="muted">MLE used</span>') : '',
          s.day >= 3 ? `<span class="gold">Vet min · $${O.vetMin}M × 1 (ages ${O.vetMinAge}+)</span>` : '',
        ].filter(Boolean).join('<br>');
        return `<div class="books-row">${logoImg(t)}<span class="grow"><b>${esc(t.shortName)}</b> · ${tools}<br><span class="small">${extra || '<span class="muted">Re-sign your own players over the cap (Bird rights)</span>'}</span></span><span class="small muted">${FA.signedRoster(t).length}/${O.rosterMax}</span></div>`;
      }).join('')}
      </div></fieldset>` : '<p class="note muted small">Select your teams to make offers.</p>'}
      ${s.stage === 'done' ? faResults(s) : ''}
      <div class="stack">${stageBtn}</div>
      ${s.stage === 'open' ? '<p class="note muted small">Make your offers (tap a player), then open bidding.</p>' : s.stage === 'bidding' ? '<p class="note muted small">Raise if you\'re behind. When players decide, other teams get one last chance to outbid you.</p>' : ''}
      <div class="tabs fa-tabs">${views.map(([k, l]) => `<button class="btn ${k === view ? 'on focus' : 'off'}" data-act="faView" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="list">${rows.map(row).join('')}</div>
      ${total > rows.length ? `<button class="btn small" data-act="faAll">Show all ${total}</button>` : ''}`,
  });
};

function faResults(s) {
  if (!s.signings.length) return '<p class="note">No one signed today.</p>';
  const wars = s.signings.filter(x => x.bidders >= 3).length;
  const list = [...s.signings].sort((a, b) => b.offer.sal - a.offer.sal || b.offer.yrs - a.offer.yrs);
  return `<fieldset class="frame"><legend>Day ${s.day} Signings (${s.signings.length})</legend>
    ${wars ? `<p class="note small gold">${wars} bidding war${wars > 1 ? 's' : ''}</p>` : ''}
    <div class="stack">${list.map(x => `<div class="sign-row ${isUserTeam(x.team) ? 'mine' : ''}">${logoImg(x.team)}
      <p class="note small grow"><b>${esc(playerName(x.p))}</b> → ${esc(x.team.shortName)} · ${offerText(x.offer)} <span class="muted">($${x.offer.sal * x.offer.yrs}M)</span>${x.bidders > 1 ? ` <span class="muted">· ${x.bidders} offers</span>` : ''}${x.kind === 'mle' ? ' <span class="badge new">MLE</span>' : x.kind === 'vetMin' ? ' <span class="badge">Vet min</span>' : ''}<br><span class="muted">${esc(x.why)}</span></p></div>`).join('')}
    </div>${s.released?.length ? `<p class="note muted small" style="margin-top:8px">${s.released.length} players without a deal were released to free agency.</p>` : ''}</fieldset>`;
}

actions.faHome = () => goHome();
actions.faView = d => replace('fa', { view: d.v });
actions.faAll = () => replace('fa', { ...state.stack[state.stack.length - 1].args, all: true });

actions.faOpen = () => {
  const s = faState();
  const L = league();
  FA.cpuBids(L, s.market, s.bids, s.day, state.userTeams, s.rng, s.used);
  FA.raiseRound(L, s.market, s.bids, s.day, s.rng, s.used);
  s.stage = 'bidding';
  render();
};

actions.faDecide = async () => {
  const s = faState();
  const L = league();
  for (let i = 0; i < 2; i++) FA.raiseRound(L, s.market, s.bids, s.day, s.rng, s.used);
  // Offer sheets on your restricted free agents: match or let go.
  const matches = new Map();
  for (const { m, best } of FA.pendingMatches(L, s.market, s.bids, s.day, state.userTeams, s.used)) {
    const by = L.teams.find(t => t.id === best.tid);
    const yes = await confirmBox(`<b>${esc(playerName(m.p))}</b> (RFA) signed an offer sheet with <b>${esc(by.shortName)}</b>: ${offerText(best)} ($${best.sal * best.yrs}M). Match it to keep him?`, 'Match', 'Let Go');
    matches.set(m.p.id, yes);
  }
  s.signings = FA.decide(L, s.market, s.bids, s.day, s.used, FA.FA_DEFAULTS, { matches, userTeams: state.userTeams });
  // Last day: anyone still without a deal leaves their old team.
  if (s.day >= (L.season.signingDays || 3)) s.released = FA.releaseUnsigned(L);
  const top = [...s.signings].sort((x, y) => y.offer.sal * y.offer.yrs - x.offer.sal * x.offer.yrs)[0];
  (calFlags().faLog ||= {})[s.day] = { n: s.signings.length, wars: s.signings.filter(x => x.bidders >= 3).length,
    top: top && `${playerName(top.p)} to ${top.team.shortName} ($${top.offer.sal * top.offer.yrs}M)` };
  state.undo = null;
  saveMle(s.used.mle);
  if (state.params.faClearCpuOffers) {
    s.cleared = L.contractOffers.map((o, i) => [o, i]).filter(([o]) => !state.userTeams.has(o.tid));
    L.contractOffers = L.contractOffers.filter(o => state.userTeams.has(o.tid));
  }
  s.stage = 'done';
  state.dirty = true;
  render();
  const mineSigned = s.signings.filter(x => isUserTeam(x.team)).length;
  toast(`${s.signings.length} signed${mineSigned ? `, ${mineSigned} with your teams` : ''}`);
};

actions.faUndo = async () => {
  const s = faState();
  const L = league();
  if (!(await confirmBox('Undo today\'s signings?', 'Undo'))) return;
  if (s.released) { FA.unreleaseUnsigned(L, s.released); s.released = null; }
  if (s.cleared) for (const [o, i] of s.cleared) L.contractOffers.splice(i, 0, o);
  for (const x of [...s.signings].reverse()) FA.unsignPlayer(L, x.rec);
  for (const x of s.signings) if (x.kind === 'mle') s.used.mle.delete(x.team.id);
  saveMle(s.used.mle);
  s.signings = [];
  s.cleared = null;
  s.stage = 'bidding';
  if (calFlags().faLog) delete calFlags().faLog[s.day];
  render();
};

actions.faOffer = d => {
  const s = faState();
  const L = league();
  const m = s.market.find(x => x.p.id === +d.id);
  const mine = L.teams.filter(isUserTeam);
  if (!mine.length) { toast('Pick your teams first'); return; }
  const list = () => (s.bids.get(m.p.id) || []);
  const existing = list().find(b => isUserTeam({ id: b.tid }));
  const draft = existing ? { ...existing } : { tid: (isUserTeam(m.from) ? m.from : mine[0]).id, sal: m.ask, yrs: askYears(m), opt: 0 };
  const box = overlay('');
  const M = FA.MOTIVES[m.motive];
  const O = FA.FA_DEFAULTS;
  // One-tap offers: the mid-level exception (Day 2+, teams over the cap) and
  // the veterans' minimum (Day 3, ages 30+).
  const vetMinOk = team => s.day >= 3 && m.p.age >= O.vetMinAge && !FA.checkOffer(L, team, m.p, { sal: O.vetMin, yrs: 1, opt: 0 }, s.day, s.used);
  const mleOk = team => FA.offerRoom(L, team, m.p, s.day, s.used).mle;
  const quick = team => {
    const btns = [];
    if (mleOk(team)) btns.push(`<button class="btn ${draft.sal === O.mle && draft.yrs === O.mleMaxYears ? 'on focus' : ''}" data-k="mle">📝 Offer MLE · $${O.mle}M × ${O.mleMaxYears}</button>`);
    if (vetMinOk(team)) btns.push(`<button class="btn" data-k="vetmin">⚡ Offer Vet Min · $${O.vetMin}M × 1</button>`);
    return btns.length ? `<div class="stack">${btns.join('')}</div>` : '';
  };
  const paint = () => {
    const team = L.teams.find(t => t.id === draft.tid);
    const err = FA.checkOffer(L, team, m.p, draft, s.day, s.used);
    const kind = err ? null : FA.offerKind(L, team, m.p, draft, s.day, s.used);
    const others = list().filter(b => b.tid !== draft.tid);
    const score = b => FA.offerScore(L, m.p, b, m.ask, m.motive, m.from?.id, m.min < m.ask * 0.75);
    const rival = [...others].sort((a, b) => score(b) - score(a))[0];
    const standing = draft.sal < m.min ? `<span class="down">Below what they'll take ($${m.min}M)</span>`
      : !rival ? (s.stage === 'open' ? 'No other bids yet' : '<span class="up">Only offer</span>')
      : score(draft) >= score(rival) ? `<span class="up">Ahead of ${esc(L.teams.find(t => t.id === rival.tid).shortName)}</span>`
      : `<span class="down">Behind ${esc(L.teams.find(t => t.id === rival.tid).shortName)}</span>`;
    box.querySelector('.box').innerHTML = `
      <p class="note"><b>${esc(playerName(m.p))}</b> <span class="${declining(m.p) ? 'decl-lv' : 'gold'}">Lv ${levelOf(m.p)}${declining(m.p) ? ' ↓' : ''}</span> · ${esc(posName(m.p))} · ${m.p.age}y · asks $${m.ask}M × ${askYears(m)}${FA.isRestricted(L, m.p) ? ' · <span class="badge new">RFA</span>' : ''}</p>
      ${rankLine(m.p)}
      <p class="note small">${M.icon} ${esc(M.name)}: ${esc(M.text)}.</p>
      ${mine.length > 1 ? `<select class="sel-team" data-k="tid">${mine.map(t => `<option value="${t.id}" ${t.id === draft.tid ? 'selected' : ''}>${esc(t.shortName)}</option>`).join('')}</select>` : ''}
      ${quick(team)}
      <div class="pts-row"><span class="grow">Salary</span><button class="btn square" data-k="sal" data-d="-1">−</button><span class="pts-val">$${draft.sal}M</span><button class="btn square" data-k="sal" data-d="1">+</button></div>
      <div class="pts-row"><span class="grow">Years</span><button class="btn square" data-k="yrs" data-d="-1">−</button><span class="pts-val">${draft.yrs}</span><button class="btn square" data-k="yrs" data-d="1">+</button></div>
      <div class="tabs">${[[0, 'No option'], [1, 'Team opt'], [2, 'Player opt']].map(([v, l]) => `<button class="btn ${draft.opt === v ? 'on focus' : 'off'}" data-k="opt" data-v="${v}">${l}</button>`).join('')}</div>
      <p class="note small">Total $${draft.sal * draft.yrs}M · ${err ? `<span class="down">${esc(err)}</span>` : `uses ${{ space: 'cap space', bird: 'Bird rights', mle: 'the MLE', vetMin: 'the vet minimum' }[kind]}`}</p>
      <p class="note small">${standing}</p>
      <div class="grid2">
        <button class="btn off" data-k="close">${existing ? 'Withdraw' : 'Cancel'}</button>
        <button class="btn focus" data-k="submit" ${err ? 'disabled' : ''}>${existing ? 'Update Offer' : 'Make Offer'}</button>
      </div>`;
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (!b || b.tagName === 'SELECT') return;
    const k = b.dataset.k;
    if (k === 'sal') draft.sal = Math.max(FA.FA_DEFAULTS.minSalary, Math.min(FA.maxSalary(L, m.p), draft.sal + +b.dataset.d));
    else if (k === 'yrs') draft.yrs = Math.max(1, Math.min(FA.FA_DEFAULTS.birdMaxYears, draft.yrs + +b.dataset.d));
    else if (k === 'opt') draft.opt = +b.dataset.v;
    else if (k === 'mle') { draft.sal = O.mle; draft.yrs = O.mleMaxYears; }
    else if (k === 'vetmin') {
      const rest = list().filter(x => x !== existing && x.tid !== draft.tid);
      s.bids.set(m.p.id, [...rest, { tid: draft.tid, sal: O.vetMin, yrs: 1, opt: 0, cpu: false }]);
      box.remove(); render();
      toast(`Vet minimum offered to ${playerName(m.p)}`);
      return;
    }
    else if (k === 'close') {
      if (existing) s.bids.set(m.p.id, list().filter(x => x !== existing));
      box.remove(); render(); return;
    } else if (k === 'submit') {
      const rest = list().filter(x => x !== existing && x.tid !== draft.tid);
      s.bids.set(m.p.id, [...rest, { ...draft, cpu: false }]);
      box.remove(); render(); return;
    }
    paint();
  });
  box.addEventListener('change', e => { if (e.target.dataset.k === 'tid') { draft.tid = +e.target.value; paint(); } });
  paint();
};

// ---------------------------------------------------------------------------
// Storylines

function currentStorylines() {
  const li = state.leagueIdx;
  const L = league();
  const players = new Map(leaguePlayers(L, true).map(e => [e.p.id, e.p]));
  const mentorships = (state.mentor[li]?.list || [])
    .map(m => ({ mentor: players.get(m.mentorId), mentee: players.get(m.menteeId), skill: m.skill }))
    .filter(m => m.mentor && m.mentee);
  const dev = p => { const snap = state.snaps.get(snapKey(p.id, li)); return snap ? diffPlayer(p, snap) : null; };
  const faSignings = state.fa[li]?.signings || [];
  return { stories: buildStorylines(L, { leagueIdx: li, leagues: state.data.seasonLeagues, params: state.params, dev, mentorships, faSignings }), players };
}

function storylinesText(stories) {
  const L = league();
  return `${L.shortName || L.leagueName} ${L.season.currentYear} · Top storylines\n\n` +
    stories.map((s, i) => `${i + 1}. ${s.icon} ${s.title}\n${s.text}`).join('\n\n');
}

screens.storylines = () => {
  const { stories, players } = currentStorylines();
  const L = league();
  layout({
    title: 'Media Day',
    body: `
      <img class="hero" src="icons/hero-media.jpg" alt="">
      ${jerseyCard()}
      <h2 class="team-title">Season Preview</h2>
      ${stories.length ? `<ol class="stories">${stories.map((s, i) => `
        <li class="story${players.has(s.pid) ? ' tap' : ''}"${players.has(s.pid) ? ` data-act="openPlayer" data-id="${s.pid}"` : ''}>
          <span class="story-n">${i + 1}</span>
          <div><b>${s.icon} ${esc(s.title)}</b><p class="note small">${esc(s.text)}</p></div>
        </li>`).join('')}</ol>` : '<p class="note">Nothing to report yet.</p>'}
      <div class="stack">
        <button class="btn" data-act="copyStories">📋 Copy as Text</button>
        ${isStep('media') ? '<button class="btn big focus" data-act="mediaDone">✅ Wrap Up Media Day</button>' : ''}
      </div>`,
  });
};

actions.mediaDone = () => { calFlags().media = true; goHome(); toast('Next up: Opening Night'); };

actions.copyStories = async () => {
  const text = storylinesText(currentStorylines().stories);
  try {
    if (!inArtifact() && navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Storylines copied'); }
  } catch (err) {
    if (err.name !== 'AbortError') toast('Copy failed');
  }
};

// ---------------------------------------------------------------------------
// Export

screens.export = () => {
  const canShare = !inArtifact() && typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File(['x'], 'x', { type: 'application/octet-stream' })] });
  layout({
    title: 'Opening Night',
    body: `
      <fieldset class="frame"><legend>Season File</legend>
        <p class="note file-name">${esc(state.fileName)}</p>
        <div class="stack">
          ${canShare ? '<button class="btn big focus" data-act="share">📤 Save to Files / Dropbox</button>' : ''}
          <button class="btn ${canShare ? '' : 'big focus'}" data-act="download">💾 Download File</button>
        </div>
        ${inArtifact() ? `<p class="note gold small">Saves as <b>${esc(artifactName(state.fileName))}</b>: rename it to <b>${esc(state.fileName)}</b> (remove ".json") so Hoop Land can load it.</p>` : ''}
        <p class="note muted small">Load it in Hoop Land and start the season. Keep a backup of the original.</p>
      </fieldset>
      ${inArtifact() ? '' : dropboxFrame()}`,
  });
};

function dropboxFrame() {
  const c = dropboxConfig();
  if (dropboxConnected()) {
    return `<fieldset class="frame"><legend>Dropbox</legend>
      <p class="note small">Saves to <b>${esc(dropboxPath(state.fileName, c.folder))}</b>${c.overwrite ? ' (replacing the file there)' : ' (a copy is renamed if the file exists)'}.</p>
      <div class="stack">
        <button class="btn focus" data-act="dbxUpload">☁️ Upload to Dropbox</button>
        <button class="btn small" data-act="dbxUploadStories">📰 Upload Storylines (.txt)</button>
      </div>
      <label class="field"><span>Folder</span><input type="text" data-dbx="folder" value="${esc(c.folder)}"></label>
      <label class="toggle-row"><input type="checkbox" data-dbx="overwrite"${c.overwrite ? ' checked' : ''}> Replace the file if it exists</label>
      <button class="btn small" data-act="dbxDisconnect">Disconnect</button>
    </fieldset>`;
  }
  return `<details class="frame dbx"><summary>☁️ Upload straight to Dropbox</summary>
    ${BUILT_IN_APP_KEY ? '' : `<p class="note small">One-time setup: create a free Dropbox app at <b>dropbox.com/developers/apps</b> (Scoped access, permission <b>files.content.write</b>) and paste its App key.</p>
    <label class="field"><span>App key</span><input type="text" data-dbx="appKey" value="${esc(c.appKey || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`}
    <label class="field"><span>Folder</span><input type="text" data-dbx="folder" value="${esc(c.folder)}"></label>
    <div class="stack">
      <button class="btn" data-act="dbxConnect">🔗 Connect Dropbox</button>
      ${c.verifier ? `<label class="field"><span>Code from Dropbox</span><input type="text" id="dbxCode" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <button class="btn focus" data-act="dbxFinish">✅ Finish Connecting</button>` : ''}
    </div>
  </details>`;
}

function readDropboxFields() {
  const patch = {};
  for (const el of $app.querySelectorAll('[data-dbx]')) patch[el.dataset.dbx] = el.type === 'checkbox' ? el.checked : el.value.trim();
  return saveDropboxConfig(patch);
}

actions.dbxConnect = async () => {
  const c = readDropboxFields();
  if (!c.appKey) { toast('Paste your Dropbox app key first'); return; }
  const url = await dropboxAuthUrl(c.appKey);
  window.open(url, '_blank', 'noopener');
  render();
  toast('Allow access, then paste the code here');
};

actions.dbxFinish = async () => {
  readDropboxFields();
  const code = document.getElementById('dbxCode')?.value || '';
  if (!code.trim()) { toast('Paste the code Dropbox showed you'); return; }
  try {
    await dropboxFinishAuth(code);
    toast('Dropbox connected');
    render();
  } catch (err) {
    toast(`Dropbox: ${err.message}`);
  }
};

actions.dbxDisconnect = () => { disconnectDropbox(); render(); };

async function dbxSend(blob, name, what) {
  readDropboxFields();
  const o = overlay(`<div class="spinner"></div><p class="note">Uploading ${what}…</p>`);
  try {
    const path = await dropboxUpload(blob, name);
    o.remove();
    toast(`Saved to Dropbox: ${path}`);
    return true;
  } catch (err) {
    o.remove();
    const b = overlay(`<p class="note">Dropbox upload failed: ${esc(err.message)}</p><button class="btn">OK</button>`);
    b.querySelector('button').onclick = () => b.remove();
    return false;
  }
}

actions.dbxUpload = async () => {
  const o = overlay('<div class="spinner"></div><p class="note">Building file…</p>');
  await nextFrame();
  const file = buildExport();
  o.remove();
  if (await dbxSend(file, file.name, 'season file')) state.dirty = false;
};

actions.dbxUploadStories = async () => {
  const text = storylinesText(currentStorylines().stories);
  await dbxSend(new Blob([text], { type: 'text/plain' }), `${state.fileName} storylines ${league().season.currentYear}.txt`, 'storylines');
};

// ---------------------------------------------------------------------------
// Boot

state.stack.push({ name: 'main', args: {} });
history.replaceState({ depth: 1 }, '');
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => reg.update()).catch(() => {});
  // A new version took over: reload into it, unless there's unsaved work.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    if (state.data && state.dirty) { toast('Update ready', 'Export or finish up, then reopen the app to get it.'); return; }
    reloaded = true;
    location.reload();
  });
}
