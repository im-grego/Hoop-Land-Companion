import {
  parseSave, serializeSave, ATTRS, ATTR_NAMES, PHYSICAL, attrMin, skillName, skillCategory, isEliteSkill, isFreeSkill, ELITE_REQUIREMENTS, ELITE_MIN, ATTR_MAX, activeSkills, isLeveled, CATEGORIES, SKILL_MAX_LEVEL, SKILL_CATEGORIES, POSITIONS, MODE_NAMES, phaseName, BUMP_PHASES, BUMP_DAY, POT_MIN, POT_MAX, regressionYear, injuryName, PHASE_POST_DRAFT, PHASE_PRE_DRAFT, leagueRookies,
  playerName, heightStr, avgRating, lastSeasonMpg, leaguePlayers, snapshot, restore, diffPlayer, jerseyClashes, fixJerseyNumbers, undoJerseyNumbers, levelOf,
} from './savefile.js';
import { DEFAULT_PARAMS, runProgression, buildSkillProfiles, rankSkillsFor, unlockSkill, mulberry32, runRookieBump, injuryRisk, earnsNaturalLongevity, productionScores, spendHeldPoints } from './progression.js';
import {
  SKILL_ATTRS, DRAFT_DROP, DRAFT_FLOOR, floorVector, rookieLine, ceilingVector, buildCompPool, prospectComps, prospectValue,
  lotterySetup, lotteryOdds, runLottery, drawLottery, draftOrder, teamRecord, cpuPick, tradePicks, pickValue, lotteryDone, actualDraftOrder, rookieComps,
  recoveryFor, projectedRookie, originalRatings, setRecoveryBonus, applySummerLeague, tierFor, scoutingReport, projectedCeiling, scoutedPot, compDistance,
  assignClassComps, rookieFloorVector, collegeLine, rosterSlot,
  needBaseline, teamNeeds, needsFilled, isWinNow, teamStatus, STATUS_NAMES, classScales, draftScore, LOTTERY_FORMATS,
} from './draft.js';
import { mentorPairs, runMentorship } from './mentorship.js';
import { buildStorylines, seasonLine } from './storylines.js';
import { applyDraft, rookieContractTargets, applyRookieContracts, undoRookieContracts, newLiveDraft, clockIndex, makeSelection, takenIds, tradeableProspects, livePicks, slotPick, tradeUpOffers, rightsTradeOffer, consolidationOffer } from './livedraft.js';
import { slotValue, playerValue, cpuAccepts, executeTrade, undoTrade, contractValue, fairSalary, tagGap } from './trades.js';
import * as FA from './freeagency.js';
import * as TR from './traderules.js';
import * as FX from './facilities.js';
import { buildPack, savePack, readPack, isPack, packMatch, applyPackTraits, packPickDiffs, applyPackPicks, packTeamDiffs, applyPackTeams } from './leaguepack.js';
import { runSummerLeague, summerReward, undoSummerReward, mvpName } from './summer.js';
import { applyLottery, preLotteryOrder, startFreeAgency, nextFreeAgencyDay, rookieScale, signRookie } from './phases.js';
import { runSurvey, consensus } from './survey.js';
import { regressed } from './regression.js';
import { refitCeilings, potBumpCeilings, autoTendencies, normalizeTendencies } from './autoplay.js';
import { saveToLeague } from './leagueexport.js';
import { SKILL_INFO, skillDoes, skillSays } from './skillinfo.js';
import { TRAITS, TRAIT_KEYS, traitWord, traitLabel, traitTag, personality, traitsSet, tr, fillTraits, isReal } from './traits.js';
import { detectMode, seasonReview, collegePhaseName, draftDepartures, seniorSendoff, portalBoard, showcase, recruitBoard, signingClasses, rosterNeedsCollege, preseason, rosterLock, practicePlan, classOf } from './college.js';
import * as RC from './recruiting.js';
import { leagueLook } from './recruits.js';
import * as CO from './coaching.js';
import { TIER_NAMES, setStyleRefs, teamStanding, teamBooks, rosterNeeds, teamIdentity, draftPosition, rumorMill, playStyles, styleLine, wontDo, TEND_LABELS, TEND_GROUPS, groupOf } from './overview.js';
import { presserQuestions, presserStories, promiseStories, leagueGram, teamSituation } from './presser.js';
import { runCombine, hoopGram, DRILLS, inchStr, fmtDrill, medicalFlag } from './predraft.js';
import { BUILT_IN_APP_KEY, dropboxConfig, saveDropboxConfig, dropboxConnected, disconnectDropbox, dropboxAuthUrl, dropboxFinishAuth, dropboxUpload, dropboxPath } from './dropbox.js';

const APP_VERSION = '0.110.0';
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
  summerTour: {},          // leagueIdx -> { result, stage, reward } once the summer league tournament started
  rookieNums: {},          // leagueIdx -> { locked, picks: { pid: from } } for rookie jersey numbers
  numPick: null,           // rookie whose number wall is open
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
      if (saved.version < 4 || saved.version < 12) delete saved.recoveryBands; // v12: rookies are all 21 or younger
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
// Hoop Land's rookies are all 21 or younger, so age alone gives them little
// back: a 21-year-old gets +2; a prospect graded #1 Pick or Top 5 gets +1;
// never more than +2 in all. The grade is the one scouts gave before the
// draft, remembered per season.
const gradeMemoKey = () => `hlc:grades:${seasonKey()}`;
function gradeMemo() {
  const c = (state.gradeMemo ||= {});
  const k = gradeMemoKey();
  if (!c[k]) { try { c[k] = JSON.parse(localStorage.getItem(k)) || {}; } catch { c[k] = {}; } }
  return c[k];
}
function rememberGrades(L) {
  const m = gradeMemo();
  for (const p of L.draftClass || []) m[p.id] = gradeOf(p)[0];
  try { localStorage.setItem(gradeMemoKey(), JSON.stringify(m)); } catch { /* ignore */ }
}
setRecoveryBonus(p => {
  let g = gradeMemo()[p.id];
  if (!g) { try { if (league().season.phase === PHASE_PRE_DRAFT) g = gradeOf(p)[0]; } catch { /* no class to grade against */ } }
  return g === '#1 Pick' || g === 'Top 5' ? 1 : 0;
});
function saveParams() {
  try { localStorage.setItem('hlc:params', JSON.stringify({ ...state.params, version: 12 })); } catch { /* ignore */ }
}
function teamsKey() { return `hlc:teams:${league().meta?.saveName || state.fileName}:${state.leagueIdx}`; }
function saveUserTeams() {
  try { localStorage.setItem(teamsKey(), JSON.stringify([...state.userTeams])); } catch { /* ignore */ }
}
function loadUserTeams() {
  let ids = null;
  // Franchise saves: always the team the save is built around.
  { const L = league(); if (L.season.mode === 0 && L.teams.some(t => t.id === L.season.teamId)) { state.userTeams = new Set([L.season.teamId]); return; } }
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

// Stars drawn as icons. The row is as long as the player's potential
// (`halfStars`, in half stars; a half star is the left half of a star) and
// always starts where a 5-star row starts, so shorter rows leave the gap on
// the right. Gold fills to his current level (`now`, in stars); red outline
// = what age has taken (`now` up to `peak`); the faint outline beyond is
// room still to grow.
const STAR_PATH = 'M12 2.4l2.95 6.1 6.65.85-4.9 4.55 1.3 6.6L12 17.2l-5.95 3.3 1.3-6.6-4.9-4.55 6.65-.85z';
// The left half of the same star, closed along the middle.
const HALF_PATH = 'M12 2.4V17.2l-5.95 3.3 1.3-6.6-4.9-4.55 6.65-.85z';
function stars(halfStars, now = halfStars / 2, peak = now) {
  const total = halfStars / 2;
  const gold = Math.max(0, Math.min(total, now));
  const red = Math.max(gold, Math.min(total, peak));
  const clip = (a, b) => `clip-path:inset(0 ${(100 - b * 100).toFixed(1)}% 0 ${(a * 100).toFixed(1)}%)`;
  const svg = (cls, a, b, half) => (b > a ? `<svg viewBox="0 0 24 24" class="${cls}" style="${half && b >= 0.5 && a <= 0 ? '' : clip(a, b)}"><path d="${half ? HALF_PATH : STAR_PATH}"/></svg>` : '');
  const out = [];
  for (let i = 0; i < Math.ceil(total); i++) {
    const end = Math.min(1, total - i);
    const g = Math.max(0, Math.min(end, gold - i));
    const r = Math.max(g, Math.min(end, red - i));
    const half = end < 1;
    out.push(`<span class="st"${half ? ' style="width:8.5px"' : ''}>${svg('st-faint', r, end, half)}${svg('st-gold', 0, g, half)}${svg('st-lost', g, r, half)}</span>`);
  }
  const lbl = `${total} star potential, ${Math.round(gold * 10) / 10} now${red > gold ? `, ${Math.round((red - gold) * 10) / 10} lost to age` : ''}`;
  return `<span class="st-row" aria-label="${lbl}">${out.join('')}</span>`;
}

function logoUrl(url) {
  if (!url) return '';
  return url.includes('dropbox.com') ? url.replace(/([?&])dl=0/, '$1raw=1') : url;
}
// Logos load right away (no lazy loading) into a box of fixed size, so a
// slow or missing logo never shifts the layout.
function logoImg(team, cls = 'logo-sm') {
  const u = logoUrl(team.logoURL);
  if (!u) return `<span class="${cls} logo-ph" aria-hidden="true"></span>`;
  return `<img class="${cls}" src="${esc(u)}" alt="" width="34" height="34" decoding="async" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`;
}
// Fetch every team logo as soon as a save loads (and keep them), so screens
// open with their logos already there.
const logoCache = new Map();
function preloadLogos(data) {
  const urls = new Set();
  for (const L of data.seasonLeagues || []) for (const t of L.teams || []) { const u = logoUrl(t.logoURL); if (u) urls.add(u); }
  for (const u of urls) {
    if (logoCache.has(u)) continue;
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    try { img.fetchPriority = 'high'; } catch { /* older browsers */ }
    img.src = u;
    logoCache.set(u, img);
  }
}

// A notification that slides down from the top, like a text message.
// `detail` adds a second line (trade alerts show the deal).
// College runs without the pop-ups; only warnings (a tap that did nothing,
// and why) still show there.
function toast(msg, detail = '', ms = detail ? 4000 : 2400, warning = false) {
  if (!warning && state.data && isCollege()) return;
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

// A question with several answers: choices = [[value, label, class]].
function choiceBox(msg, choices) {
  return new Promise(resolve => {
    const o = overlay(`<p class="note">${msg}</p>
      <div class="stack">${choices.map(([v, l, c]) => `<button class="btn ${c || ''}" data-r="${esc(v)}">${esc(l)}</button>`).join('')}</div>`);
    o.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      o.remove();
      resolve(b.dataset.r);
    });
  });
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

function layout({ title, left = '', right = '', body, action = null, bare = false }) {
  const t = esc(title);
  $app.innerHTML = `
    ${bare ? `<h1 class="sr-only">${t}</h1>` : `<div class="header">
      ${state.stack.length > 1 ? `<button class="btn back" data-act="back" aria-label="Back">${BACK_ARROW}</button>` : ''}
      ${left}
      <div class="marquee" role="heading" aria-level="1" aria-label="${t}">
        <div class="marquee-track" aria-hidden="true"><span>${t}</span><span>${t}</span></div>
      </div>
      ${right}
    </div>`}
    <main class="panel ${bare ? 'bare' : ''}">${body}</main>
    ${action ? `<div class="bottom"><button class="btn action" data-act="${action.act}"${action.k ? ` data-k="${esc(action.k)}"` : ''}>${esc(action.label)}</button></div>` : ''}`;
}

const BACK_ARROW = `<svg width="40" height="28" viewBox="0 0 10 7" shape-rendering="crispEdges" aria-hidden="true">
  <path fill="#fff" d="M3 0h1v1h-1zM2 1h2v1h-2zM1 2h9v3h-9zM0 3h1v1h-1zM2 5h2v1h-2zM3 6h1v1h-1z"/></svg>`;

const screens = {};
const actions = {};

function go(name, args = {}) {
  if (!screenAllowed(name)) { toast('Finish the current step on the calendar first', '', 2400, true); return; }
  state.stack[state.stack.length - 1].y = window.scrollY;
  state.stack.push({ name, args });
  history.pushState({ depth: state.stack.length }, '');
  render();
}
// The league's logo: the pro mark for pro leagues, a ball for college.
function leagueBadge(L) {
  return `<img class="league-logo" src="icons/${L.leagueType === 0 ? 'pro-logo.png' : 'league-ball.png'}" alt="">`;
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
  if (state.data) { FA.setQualifyingOffers(optStore().qo); FA.setCapSystem(isComplete() && state.params.capSystem !== false && !isCollege()); FA.setComplete(isComplete() && !isCollege(), FA.capLines(league()).cap); FX.setFacilitiesOn(isComplete() && !isCollege()); if (!isCollege()) syncGrudges(); if (!isCollege()) syncDead(); }
  if (state.data && isCollege() && state.cal) { try { localStorage.setItem(collegeCalKey(), JSON.stringify(state.cal)); } catch { /* ignore */ } }
  const top = state.stack[state.stack.length - 1];
  const view = `${state.stack.length}:${top.name}:${top.args?.tab ?? ''}:${top.name === 'fa' ? '' : top.args?.view ?? ''}:${top.args?.id ?? ''}`;
  const y = window.scrollY;
  $app.dataset.screen = top.name;
  screens[top.name](top.args);
  const target = view === lastView ? y : top.y ?? 0;
  window.scrollTo(0, target);
  // iOS can drop a scroll made while it's still finishing a tap; put it
  // back once the redraw has settled.
  const keep = () => { if (Math.abs(window.scrollY - target) > 2) window.scrollTo(0, target); };
  requestAnimationFrame(keep);
  setTimeout(keep, 80);
  top.y = null;
  lastView = view;
}

// The app keeps its own scroll positions per screen.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('popstate', () => {
  if (state.stack.length < 2) return;
  // Backing out of the GM survey wraps it up.
  const leaving = state.stack[state.stack.length - 1].name;
  if (leaving === 'survey' && isStep('survey')) { saveSurveyHist(surveyNow()); calFlags().survey = true; toast('Next up: Media Day'); }
  state.stack.pop();
  render();
});

window.addEventListener('beforeunload', e => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

function runAct(el, e) {
  const act = el.dataset.act;
  if (act === 'back') return back();
  const fn = actions[act];
  if (fn) fn(el.dataset, el, e);
}
// Touch taps run on finger-up: iOS sometimes spends the first tap on a
// "hover" and only clicks on the second. A tap that moved (a scroll) or
// was taken over by the browser doesn't count; the click iOS sends after
// a handled tap is skipped.
let tapStart = null, tapDone = null;
$app.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') { tapStart = null; return; }
  const el = e.target.closest('[data-act]');
  tapStart = el ? { el, x: e.clientX, y: e.clientY, t: Date.now() } : null;
});
$app.addEventListener('pointercancel', () => { tapStart = null; });
$app.addEventListener('pointerup', e => {
  const s = tapStart;
  tapStart = null;
  if (!s || e.pointerType === 'mouse') return;
  const el = e.target.closest('[data-act]');
  if (el !== s.el || el.disabled || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10 || Date.now() - s.t > 800) return;
  tapDone = { el, t: Date.now() };
  runAct(el, e);
});
$app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (tapDone && Date.now() - tapDone.t < 800) { tapDone = null; return; }
  runAct(el, e);
});
// No zooming of any kind (pinch included).
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });

$app.addEventListener('change', e => {
  if (e.target.id === 'fileInput' && e.target.files[0]) loadFile(e.target.files[0]);
  if (e.target.id === 'origInput' && e.target.files[0]) loadReference(e.target.files[0]);
});

// ---------------------------------------------------------------------------
// Loading / exporting

// The league pack that belongs to this save, if one is kept here and most of
// its players are in the save.
function matchingPack(L) {
  const pack = readPack(L.shortName || L.leagueName || 'league');
  return pack && packMatch(pack, L) >= 0.8 ? pack : null;
}
// Picks and fan bases a franchise lost on the way through the game, offered once per save.
async function packPrompt(pack) {
  for (let i = 0; i < 60 && document.querySelector('.overlay'); i++) await new Promise(r => setTimeout(r, 500));   // after the rules question
  const L = league();
  const key = `hlc:packdone:${pack.league}:${L.meta?.saveName || ''}:${L.season.currentYear}`;
  try { if (localStorage.getItem(key)) return; } catch {}
  const picks = packPickDiffs(pack, L), teams = packTeamDiffs(pack, L);
  if (!picks.length && !teams.length) return;
  const lines = [...picks.slice(0, 6).map(d => `${dispYr(d.yr)} R${d.rd} (${L.teams.find(t => t.id === d.otid)?.shortName}) back to ${L.teams.find(t => t.id === d.tid)?.shortName}`), ...(picks.length > 6 ? [`and ${picks.length - 6} more picks`] : []), ...(teams.length ? [`${teams.length} teams' fans or tags`] : [])];
  const r = await choiceBox(`<b>${esc(pack.name)}</b> had some things the game dropped:<br><span class="small muted">${lines.map(esc).join('<br>')}</span>`, [['no', 'Leave As Is', 'off'], ['yes', 'Apply My League', 'focus']]);
  try { localStorage.setItem(key, '1'); } catch {}
  if (r !== 'yes') return;
  const n = applyPackPicks(picks, L) + applyPackTeams(teams);
  state.dirty = true; render();
  toast(`Applied ${n} changes`, 'Export the season file to keep them.');
}

async function loadFile(file) {
  if (state.dirty && !(await confirmBox('You have unsaved changes. Load a different file anyway?', 'Load'))) return;
  const o = overlay('<div class="spinner"></div><p class="note">Reading season file…</p>');
  await nextFrame();
  try {
    const text = await file.text();
    let data = parseSave(text);
    if (isPack(data)) {
      savePack(data);
      o.remove();
      toast(`League pack kept: ${data.name}`, `${Object.keys(data.traits).length} players' traits, ${data.picks.length} pick holdings. Load a franchise from that league and it will offer them.`);
      return;
    }
    // A league file is the league object itself (no seasonLeagues wrapper): open it in the editor.
    state.leagueFile = false;
    if (!data.seasonLeagues && Array.isArray(data.teams) && data.season) { data = { seasonLeagues: [data] }; state.leagueFile = true; }
    if (!Array.isArray(data.seasonLeagues) || !data.seasonLeagues.length) throw new Error('No seasonLeagues found');
    state.fileName = file.name;
    state.undo = null;
    state.cal = {}; state.cutSel = {}; state.cutSeeded = false; state.rm = null; state.calLast = undefined;
    preloadLogos(data);   // start the team logos downloading before the heavy setup
    installData(data);
    if (state.leagueFile) {
      leagueTraitsIn(data.seasonLeagues[0]);
      state.depth = 'complete'; state.dirty = false;
      o.remove();
      toast(`Loaded league file: ${data.seasonLeagues[0].meta?.saveName || file.name}`, 'Edit it, then export it as a league file.');
      goHome();
      return;
    }
    freshSaveCheck();
    unstampDraftYear();
    const reopened = reopenOptions();
    const reext = reopenExtensions();
    settlePromises();
    settleIncentives();
    advanceLoads();
    state.dirty = reopened > 0 || reext > 0;
    const held = holdCpuOffers();
    recordSalaries();
    if (isCollege()) { try { state.cal = JSON.parse(localStorage.getItem(collegeCalKey())) || {}; } catch { state.cal = {}; } }
    const kicked = applyExtensions();
    if (!isCollege() && lotteryDone(league())) settleProt(league());
    const filled = fillTraits(data.seasonLeagues[0]) + (state.leagueIdx ? fillTraits(data.seasonLeagues[state.leagueIdx]) : 0);
    if (filled) state.dirty = true;
    const pack = !isCollege() ? matchingPack(data.seasonLeagues[0]) : null;
    if (pack) { const n = applyPackTraits(pack, data.seasonLeagues[0]); if (n) toast(`Your traits restored for ${n} players`, pack.name); setTimeout(() => packPrompt(pack), 700); }
    const signedIn = isCollege() ? applyRecruiting() : 0;
    o.remove();
    if (!isCollege() && !state.depth) setTimeout(depthPrompt, 400);
    toast(`Loaded ${data.seasonLeagues[0].meta?.saveName || file.name}`, [held ? `${held} CPU contract offers held until the options deadline.` : '', kicked ? `${kicked} extension${kicked > 1 ? 's' : ''} signed last summer kicked in.` : '', filled ? `Traits set for ${filled} players.` : '', signedIn ? `${signedIn} recruiting signings written in.` : ''].filter(Boolean).join(' '));
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
    // The lottery format follows the file's year unless picked on the lottery screen.
    state.params.lotteryFormat = 'auto';
    // College franchise saves open on the college league.
    state.mode = detectMode(data);
    state.leagueIdx = state.mode.li;
    if (!keepSnaps) state.snaps.clear();
    state.profiles = [];
    state.leagueAvg = [];
    state.auto = {};
    state.rookieAuto = {};
    state.summer = {};
    state.summerTour = {};
    state.rookieNums = {};
    state.numPick = null;
    state.mentor = {};
    state.contracts = {};
    state.jerseys = {};
    state.fa = {};
    state.awards = {};
    state.draft = {};
    state.compPools = {};
    setStyleRefs(data.seasonLeagues[0]);
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
    preloadLogos(data);
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

// The new season starts with no held upgrade points: everyone's go into
// their ratings (the same weighting the CPU uses).
function spendAllPoints(L) {
  const rng = mulberry32((saveSalt() ^ 0xa9) >>> 0);
  let n = 0;
  for (const p of [...L.teams.flatMap(t => t.roster), ...(L.freeAgents || [])]) n += spendHeldPoints(p, state.params, rng);
  return n;
}
function buildExport() {
  if (state.leagueFile) return buildLeagueExport();
  state.data.seasonLeagues.forEach((L, li) => { if (state.summer[li]) markSummerDone(L); });
  if (!isCollege() && league().season.phase === BUMP_PHASES[0]) spendAllPoints(league());
  // The game's cap becomes this season's 2nd apron (room for in-season
  // moves), with the max contract tiers scaled so a max is still 25 / 30 /
  // 35% of the real cap.
  if (!isCollege() && FA.capSystemOn()) {
    const L = league(), C = FA.capLines(L);
    L.season.salaryCap = C.apron2;
    L.season.maxContract = [25, 30, 35].map(t => Math.round(t * C.cap / C.apron2));
  }
  // College: once Signing Day is written in, the file goes out on the last
  // day of the signing period (like pro free agency), so one more advance
  // in the game starts the new season.
  if (isCollege() && market()?.applied) {
    const s = league().season;
    if (s.phase === 6) s.currentDay = s.signingDays || 3;
  }
  rememberExport();
  // The game extends a pile of players when the season opens, at values we
  // don't want. A file leaving free agency goes out with everyone's extension
  // eligibility off; the next offseason reopens it (reopenExtensions).
  const shut = shutExtensions();
  clearSeasonPoints();
  const stamped = stampDraftYear();
  const text = serializeSave(state.data);
  for (const p of shut) p.contract.canExt = true;
  for (const p of stamped) p.history.draft.yr++;
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

// The game's cap setting in a league file is this season's 2nd apron (the
// highest line, room for in-season moves); the max contract tiers are scaled
// so a max is still 25 / 30 / 35% of the real cap. Same as the season file.
function leagueCapSettings(L) {
  const C = FA.capLines(L);
  return { cap: C.apron2, maxContract: [25, 30, 35].map(t => Math.round(t * C.cap / C.apron2)) };
}

// A franchise save back into a league file, to start new saves from it.
actions.downloadLeague = async () => {
  const L = league();
  // Unsettled contracts: the game decides them itself when a new league loads
  // (who re-signs, and for how much), so finish free agency here first if you
  // want your own deals in the file.
  const open = L.teams.flatMap(t => t.roster).filter(p => p.status === FA.STATUS_EXPIRING).length;
  let settle = false;
  if (open) {
    const pick = await choiceBox(`<b>${open} players</b> still have expiring contracts. The game will re-sign or release them on its own when the league loads, and builds its own extensions. Finish free agency here first to keep your own deals, or let the app estimate who re-signs.`, [['no', 'Cancel', 'off'], ['go', 'Leave to the game', ''], ['settle', 'Estimate re-signings', 'focus']]);
    if (pick !== 'go' && pick !== 'settle') return;
    settle = pick === 'settle';
  }
  const o = overlay('<div class="spinner"></div><p class="note">Building league file…</p>');
  await nextFrame();
  if (L.season.phase === BUMP_PHASES[0]) spendAllPoints(L);
  const C = saveToLeague(L, { keepDraft: L.season.phase < 5, settle, ...(FA.capSystemOn() ? leagueCapSettings(L) : {}) });
  const name = `${state.fileName.replace(/\.[a-z0-9]{2,4}$/i, '')} LEAGUE`;
  const file = new File([serializeSave(C)], name, { type: 'application/octet-stream' });
  // The pack: traits, far-out traded picks, fans and tags, for giving back to a franchise started from this league.
  const pack = buildPack(C, name);
  savePack(pack);
  const packFile = new File([JSON.stringify(pack)], `${name} PACK.json`, { type: 'application/json' });
  o.remove();
  const give = async f => {
    if (inArtifact()) return artifactSave(f.name, f);
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  };
  const ok = await give(file);
  if (ok) await give(packFile);
  if (ok) toast('League file and pack saved', inArtifact() ? 'Remove .json from the league file name. Load the pack file on any device to give a franchise its traits back.' : 'Start a franchise from the league file. The pack gives it your traits, picks and fans back.');
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
  { key: 'office', date: 'May 1', title: 'Front Office', blurb: 'Select the teams you run.',
    done: () => calFlags().office },
  { key: 'review', date: 'May 2', title: 'Season in Review', blurb: 'How your season ended, the league picture, your team leaders and the awards.',
    done: () => !!calFlags().review || phaseRank(league().season) >= 2 },
  { key: 'overview', date: 'May 3', title: 'Offseason Overview', blurb: 'Where you stand: the books, real roster needs, your draft position and the league rumor mill.',
    done: () => !!calFlags().overview || phaseRank(league().season) >= 2 },
  { key: 'preview', date: 'May 5', title: 'Draft Preview', blurb: 'Meet the class before the lottery: the board, who projects in your range and who fits your needs.',
    done: () => !!calFlags().preview || phaseRank(league().season) >= 2 },
  { key: 'lottery', date: 'May 10', title: 'Draft Lottery', blurb: 'Watch the ping-pong balls decide the fate of your franchise.',
    done: () => phaseRank(league().season) >= 2 },
  { key: 'mock1', date: 'May 11', title: 'Mock Draft 1.0', blurb: 'The lottery is set and the first mock of the cycle is out. See where everyone lands.',
    done: () => preDone('mock1') },
  { key: 'scout', date: 'May 12', title: 'Scouting', blurb: 'Scout the class, build your board and work the phones in the front office.',
    done: () => preDone('scout') },
  { key: 'combine', date: 'May 14', title: 'Draft Combine', blurb: 'Measurements, athletic testing and shooting drills. Hoop Gram is buzzing.',
    done: () => preDone('combine') },
  { key: 'mock2', date: 'May 20', title: 'Mock Draft 2.0', blurb: 'Post-combine mock: who rose, who fell and who fell out of the first round.',
    done: () => preDone('mock2') },
  { key: 'workouts', date: 'Jun 1', title: 'Private Workouts', blurb: 'Bring prospects in, see them up close and ask the questions that matter.',
    done: () => preDone('workouts') },
  { key: 'draft', date: 'Jun 23', title: 'NBA Draft', blurb: 'Two rounds, live, with draft-day trades.',
    done: () => phaseRank(league().season) >= 3 },
  { key: 'options', date: 'Jun 29', title: 'Options & Qualifying Offers', blurb: 'Team and player options come due, and teams decide on qualifying offers for their restricted free agents.',
    done: () => !!optStore().done || phaseRank(league().season) >= 4 },
  { key: 'ext', date: 'Jul 1', title: 'Extension Window', blurb: 'Lock up players heading into their final year before they ever reach free agency.',
    done: () => !!extStore().done || phaseRank(league().season) >= 4 },
  { key: 'camp', date: 'Jul 3', title: 'Summer League', blurb: 'Rookies pick their numbers, then the young cores head to Las Vegas.',
    done: () => calFlags().camp || phaseRank(league().season) >= 4 },
  { key: 'fa1', date: 'Jul 6', title: 'Free Agency · Week 1', blurb: 'No more collusion: the market opens and the big deals happen.',
    done: () => faDone(1) },
  { key: 'fa2', date: 'Jul 13', title: 'Free Agency · Week 2', blurb: 'Teams over the cap can use the mid-level exception.',
    done: () => faDone(2) },
  { key: 'fa3', date: 'Jul 20', title: 'Free Agency · Week 3', blurb: 'Last call: asking prices drop, and anyone left unsigned leaves their old team.',
    done: () => faDone(3) },
  { key: 'dev', date: 'Sep 21', title: 'Training Camp', blurb: 'Mentorship, off-season progression and a check-in with the trainer.',
    done: () => calFlags().dev },
  { key: 'survey', date: 'Sep 25', title: 'GM Survey', blurb: 'Every GM in the league weighs in: predictions, players, the offseason, rookies, defense and more.',
    done: () => calFlags().survey || calFlags().media },
  { key: 'media', date: 'Sep 28', title: 'Media Day', blurb: 'Jersey numbers, then the season preview: the top 10 storylines.',
    done: () => calFlags().media },
  { key: 'latefa', date: 'Oct 10', title: 'Late Free Agency', blurb: 'One last crack before final cuts: minimum deals for veterans, cut players and unsigned young guys.',
    done: () => !!calFlags().latefa || !!calFlags().cuts },
  { key: 'cuts', date: 'Oct 18', title: 'Final Cuts', blurb: `Rosters can carry a few extra through the summer. Every team gets down to ${FA.FA_DEFAULTS.seasonMax} before the season.`,
    done: () => !!calFlags().cuts },
  { key: 'export', date: 'Oct 20', title: 'Opening Night', blurb: 'Export the season file and load it in Hoop Land.',
    done: () => false },
];
// College franchise offseason. The game runs the showcase (phase 5) and three
// days of recruiting (6); the app adds everything around them.
const COLLEGE_CAL = [
  { key: 'review', date: 'Apr 7', title: 'Season in Review', blurb: 'How your season ended, the national picture, your leaders and the awards.',
    done: () => !!calFlags().review },
  { key: 'portal', date: 'Apr 8', title: 'Transfer Portal', blurb: 'Who entered, from where, their stats and eligibility, and who fits your needs.',
    done: () => !!calFlags().portal },
  { key: 'showcase', date: 'Apr 12', title: 'All-American Showcase', blurb: 'East vs West: the top of next year\'s class. Every player leaves with an All-American tag.',
    done: () => !!calFlags().showcase },
  { key: 'rw1', date: 'Apr 15', title: 'Recruiting · Week 1', blurb: 'The signing period opens: the full class and the portal, your NIL budget and open spots. Offer, call and visit.',
    done: () => !market() || market().week > 1 },
  { key: 'rw2', date: 'Apr 22', title: 'Recruiting · Week 2', blurb: 'The first commitments are in. Official visits start paying off for everyone.',
    done: () => !market() || market().week > 2 },
  { key: 'rw3', date: 'Apr 29', title: 'Recruiting · Week 3', blurb: 'The big names start deciding. Committed players can still flip.',
    done: () => !market() || market().week > 3 },
  { key: 'rw4', date: 'May 6', title: 'Signing Day', blurb: 'The last week, then everyone signs and every class goes into your save.',
    done: () => !market() || market().week > 4 },
  { key: 'seniors', date: 'May 10', title: 'Senior Send-off', blurb: 'The graduating class, your seniors\' last season ahead and the records your players hold.',
    done: () => !!calFlags().seniors },
  { key: 'departures', date: 'May 28', title: 'Draft Decisions', blurb: 'The withdrawal deadline: who stayed in the draft, where they went and how they project.',
    done: () => !!calFlags().departures },
  { key: 'signing', date: 'Jun 5', title: 'Signing Class Grades', blurb: 'Every school\'s class graded, yours in detail, and the needs still open.',
    done: () => !!calFlags().signing },
  { key: 'summer', date: 'Jun 20', title: 'Summer Workouts', blurb: 'Off-season progression, a check-in with the trainer, mentorship and the strength program.',
    done: () => !!calFlags().summer },
  { key: 'rosterlock', date: 'Aug 15', title: 'Roster Lock', blurb: 'The quiet period: your final 15, position balance, class-year mix and who is in his last year.',
    done: () => !!calFlags().rosterlock },
  { key: 'practice', date: 'Sep 15', title: 'Practice Begins', blurb: 'Starters and rotation, position battles, captains and the freshmen pushing for minutes.',
    done: () => !!calFlags().practice },
  { key: 'preseason', date: 'Oct 24', title: 'Exhibitions & Preseason Polls', blurb: 'The projected Top 25, your division picks, and the Player and Freshman of the Year watch lists.',
    done: () => !!calFlags().preseason },
  { key: 'export', date: 'Nov 4', title: 'Tip-Off', blurb: 'Export the season file and load it in Hoop Land.', done: () => false },
];
const isCollege = () => state.mode?.kind === 'college';
// College steps are remembered per save and season, since the offseason
// spans several game phases (and reloads) for the showcase and recruiting.
const collegeCalKey = () => `hlc:ccal:${league().shortName}:${league().meta?.saveName || ''}:${league().season.currentYear}`;
// Progress (college and pro) is remembered per save and year, but only for the file
// it started from (reloaded) or a file the app exported from it. Any other
// save of that year (say, the original simmed again to the same spot)
// starts the offseason fresh.
const legacyFingerprint = (L = league()) => [L.season.phase, L.season.currentDay || 0, (L.season.news || []).length, L.meta?.uPID || 0, L.teams.reduce((n, t) => n + t.roster.length, 0)].join(':');
// Besides where the season stands, it reads the players themselves (their rating
// totals, ages and contracts), so two franchises started from the same league
// file never look like the same save.
const saveFingerprint = (L = league()) => {
  let h = 0, n = 0;
  for (const t of L.teams) for (const p of t.roster) {
    n++;
    let s = p.age * 7 + (p.contract?.sal || 0) * 13 + (p.contract?.yrs || 0) * 31 + (p.pot || 0);
    for (const k in p.attributes) s += p.attributes[k][0];
    h = (Math.imul(h, 31) + s) | 0;
  }
  const tail = (L.season.news || []).slice(-3).map(x => `${x.type}.${x.pid}.${x.date}`).join(',');
  return [L.season.phase, L.season.currentDay || 0, (L.season.news || []).length, L.meta?.uPID || 0, n, L.season.teamId || 0, (h >>> 0).toString(36), tail].join(':');
};
// Simple or Complete rules, chosen when a save is first opened and kept
// with the save's fingerprint. Simple: the offseason without aprons, tax,
// pick protections, no-trade clauses or trade restrictions.
const isComplete = () => state.depth !== 'simple';
const depthLast = () => { try { return localStorage.getItem('hlc:depth:last') || 'complete'; } catch { return 'complete'; } };
function setDepth(d) {
  state.depth = d;
  try {
    const known = JSON.parse(localStorage.getItem(fpKey())) || { base: saveFingerprint(), exports: [] };
    known.depth = d;
    localStorage.setItem(fpKey(), JSON.stringify(known));
    localStorage.setItem('hlc:depth:last', d);
  } catch { /* ignore */ }
}
function depthPrompt() {
  const o = overlay(`<p class="note"><b>How do you want to run this offseason?</b></p>
    <button class="btn big ${depthLast() === 'simple' ? 'focus' : ''}" data-d="simple"><span style="display:block;text-align:left"><b>Simple</b><span class="small muted" style="display:block;margin-top:4px;font-weight:400">Contracts, draft and free agency. No aprons, tax or trade restrictions.</span></span></button>
    <button class="btn big ${depthLast() === 'complete' ? 'focus' : ''}" data-d="complete" style="margin-top:8px"><span style="display:block;text-align:left"><b>Complete</b><span class="small muted" style="display:block;margin-top:4px;font-weight:400">The full cap, tax and aprons, trade rules, protections, no-trade clauses and trade requests.</span></span></button>
    <p class="note small muted" style="margin-top:8px">You can change it in Settings.</p>`);
  o.addEventListener('click', e => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    setDepth(b.dataset.d);
    o.remove();
    render();
  });
}
const fpKey = () => `hlc:cfp:${league().shortName}:${league().meta?.saveName || ''}:${league().season.currentYear}`;
// Forget this season's stored progress (mocks, scouting, options, extensions, ...).
function forgetProgress() {
  const L = league();
  const tails = [`:${L.shortName}:${L.meta?.saveName || ''}:${L.season.currentYear}`, `:${seasonKey(L)}`];
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('hlc:') && k !== fpKey() && tails.some(t => k.endsWith(t))) drop.push(k);
    }
    drop.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
  state.rm = null;
  for (const k of ['strength', 'opts', 'pre', 'extS', 'tendS', 'survey']) state[k] = {};
  state.cal = {};
}
actions.resetProgress = async () => {
  if (!(await confirmBox('Start this offseason over? Mocks, scouting, options, extensions and the other steps you finished are forgotten. Your players and contracts stay as they are in the file.', 'Start Over'))) return;
  forgetProgress();
  toast('Offseason progress cleared');
  goHome();
};
function freshSaveCheck() {
  const fp = saveFingerprint();
  let known = null;
  try { known = JSON.parse(localStorage.getItem(fpKey())); } catch { known = null; }
  // Progress stored before the fingerprint read the players is matched by the old one, once, and moved over.
  const old = legacyFingerprint();
  if (known && known.base !== fp && !(known.exports || []).includes(fp) && (known.base === old || (known.exports || []).includes(old))) {
    if (known.base === old) known.base = fp;
    known.exports = (known.exports || []).map(x => (x === old ? fp : x));
    try { localStorage.setItem(fpKey(), JSON.stringify(known)); } catch { /* ignore */ }
  }
  state.fromExport = !!known && known.base !== fp && (known.exports || []).includes(fp);
  if (known && (known.base === fp || (known.exports || []).includes(fp))) { state.depth = known.depth || null; return; }
  forgetProgress();                 // a different save (or progress stored before saves were told apart)
  state.depth = null;
  try { localStorage.setItem(fpKey(), JSON.stringify({ base: fp, exports: [] })); } catch { /* ignore */ }
}
function rememberExport() {
  let known = null;
  try { known = JSON.parse(localStorage.getItem(fpKey())) || { base: null, exports: [] }; } catch { known = { base: null, exports: [] }; }
  const fp = saveFingerprint();
  if (!(known.exports ||= []).includes(fp)) known.exports.push(fp);
  try { localStorage.setItem(fpKey(), JSON.stringify(known)); } catch { /* ignore */ }
}
const nextUp = () => { const st = currentStep(); if (st) toast(`Next up: ${st.title}`); };
// Franchise saves (one team, the game's own mode 0) skip Front Office: the
// team is the one the save is built around, like college.
const isFranchise = () => { const L = league(); return L.season.mode === 0 && L.teams.some(t => t.id === L.season.teamId); };
const activeCal = () => (isCollege() ? COLLEGE_CAL : CALENDAR.filter(st => (st.key !== 'office' || !isFranchise()) && (st.key !== 'latefa' || isComplete())));
const currentStep = () => activeCal().find(st => !st.done());
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
  if (key === 'mock1' || key === 'mock2') {
    const m = preStore()[key];
    const p = m && league().draftClass?.find(x => x.id === m[0]?.pid);
    return p ? `${playerName(p)} projected #1.` : 'Mock published.';
  }
  if (key === 'scout') return `${myBoard().length || boardStore().board.length} prospects on your board.`;
  if (key === 'combine') return 'Combine results are in.';
  if (key === 'workouts') { const n = Object.keys(preStore().workouts).length; return `${n} prospect${n === 1 ? '' : 's'} worked out for you.`; }
  if (key === 'draft') {
    const first = leagueRookies(L).find(r => r.pick === 1);
    return first ? `${playerName(first.p)} went #1 to ${first.team?.shortName || '?'}.` : 'Draft complete.';
  }
  if (key === 'options') { const g = optStore().log || {}; return `${g.exercised || 0} options picked up, ${g.out || 0} heading to free agency.`; }
  if (key === 'camp') { const r = state.summerTour[state.leagueIdx]?.result; return r?.mvp ? `Summer League MVP: ${mvpName(L, r.mvp)} (${L.teams.find(t => t.id === r.mvp.tid)?.shortName || '?'}).` : 'Summer League is a wrap.'; }
  if (key.startsWith('fa')) {
    const log = calFlags().faLog?.[+key[2]];
    return log ? (log.best || log.big ? [log.best && `⭐ ${log.best}`, log.big && log.big !== log.best && `💰 ${log.big}`].filter(Boolean).join('\n') : `${log.n} signings.`) : 'Done in the game.';
  }
  if (key === 'dev') { const a = state.auto[state.leagueIdx]; return a ? `+${a.points} in ratings upgrades across ${a.players} players.` : 'Done.'; }
  if (key === 'media') return 'Storylines set.';
  if (key === 'latefa') { const g = calFlags().lateLog; return g ? `${g.n} late signings${g.mine ? `, ${g.mine} for you` : ''}.` : 'Done.'; }
  if (key === 'rosterlock') { const t = league().teams.find(isUserTeam); return t ? `${t.roster.length} of 15 scholarships filled.` : 'Done.'; }
  if (key === 'practice') { const t = league().teams.find(isUserTeam); if (!t) return 'Done.'; const r = practicePlan(t, shownLevel, p => tr(p, 'lockerRoom')); return `Captains: ${r.captains.map(x => playerName(x.p)).join(' and ') || 'none named'}.`; }
  if (key === 'preseason') { const t = league().teams.find(isUserTeam); if (!t) return 'Done.'; const r = preseason(state.data, state.leagueIdx, t, shownLevel); return `Projected No. ${r.mine.rank}. On to tip-off.`; }
  if (key === 'summer') { const a = state.auto[state.leagueIdx]; return a ? `+${a.points} in ratings upgrades across ${a.players} players.` : 'Done.'; }
  if (key === 'signing') { const t = league().teams.find(isUserTeam); const c = t && signingNow().byTeam.get(t.id); return c ? `Your class: ${c.grade}, No. ${c.rank} (${c.players.length} signee${c.players.length > 1 ? 's' : ''}).` : 'No class this year.'; }
  if (/^rw\d$/.test(key)) {
    const M = market(); const n = +key[2]; const e = M?.log.find(l => l.week === n); const t = userSchool();
    if (!e || !t) return 'Done.';
    const all = [...e.commits, ...e.signed, ...e.late];
    if (n === RC.WEEKS) { const r = RC.classRankings(M, rclass(), RC.schoolsOf(league(), M, rclass())).find(c => c.s.t === t); return r ? `Your class: ${r.list.length} signees, ranked No. ${r.rank}.` : 'No class this year.'; }
    return `${all.length} commitment${all.length === 1 ? '' : 's'} nationally, ${all.filter(i => i.to === t.id).length} to you.`;
  }
  if (key === 'showcase') { const a = aaStore(); return a.ids?.length ? `${a.ids.length} All-Americans${a.mvp ? `, MVP ${a.mvp}` : ''}.` : 'Done.'; }
  if (key === 'portal') { const t = league().teams.find(isUserTeam); if (!t) return 'Done.'; const b = portalBoard(state.data, state.leagueIdx, t); return `${b.all.length} in the portal${b.lost.length ? `, ${b.lost.length} from your school` : ''}.`; }
  if (key === 'seniors') { const t = league().teams.find(isUserTeam); if (!t) return 'Done.'; const r = seniorSendoff(state.data, state.leagueIdx, t); return `${r.mineGrads.length} graduate${r.mineGrads.length === 1 ? '' : 's'} sent off; ${r.rising.length} senior${r.rising.length === 1 ? '' : 's'} back for a last season.`; }
  if (key === 'departures') { const d = draftDepartures(state.data, state.leagueIdx); const t = league().teams.find(isUserTeam); const m = d.filter(x => x.school === t).length; return `${d.length} players left for the pros${m ? `, ${m} of them yours` : ''}.`; }
  if (key === 'review') { const t = league().teams.find(isUserTeam); if (!t) return 'Done.'; const r = seasonReview(state.data, state.leagueIdx, t); return `${r.row?.seasonStats?.W ?? 0}-${r.row?.seasonStats?.L ?? 0} · ${r.finish.replace('🏆 ', '')}.`; }
  if (key === 'ext') { const g = extStore().log || {}; return `Extensions: ${g.mine || 0} for you, ${g.cpu || 0} around the league.`; }
  if (key === 'overview') { const t = league().teams.find(isUserTeam); return t ? `${TIER_NAMES[teamStanding(league(), t).tier]}. ${rosterNeeds(league(), t, { level: shownLevel }).filter(n => n.sev >= 2).length} big needs flagged.` : 'Done.'; }
  if (key === 'preview') return `${boardStore().board.length} prospects on your board.`;
  if (key === 'cuts') { const c = calFlags().cutLog; return c ? `${c.n} players cut across the league${c.mine ? `, ${c.mine} of yours` : ''}.` : 'Every roster is set.'; }
  if (key === 'survey') { const q = surveyNow().questions[0]?.results[0]; return q ? `${q.name}: the GMs' pick to win it all (${q.pct}%).` : 'Survey published.'; }
  return '';
}

// The buttons for the step in progress.
function stepActions(key) {
  const L = league();
  const s = L.season;
  const st = activeCal().find(x => x.key === key);
  if (st?.soon) return '<p class="note small muted">Coming soon.</p>';
  switch (key) {
    case 'rosterlock': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="rosterlock">🔒 Roster Lock</button><button class="btn" data-act="calDone" data-k="rosterlock">✅ Wrap Up</button></div>`;
    case 'practice': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="practice">🏀 Practice Begins</button><button class="btn" data-act="calDone" data-k="practice">✅ Wrap Up</button></div>`;
    case 'preseason': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="preseason">📰 Preseason Preview</button><button class="btn" data-act="calDone" data-k="preseason">✅ Wrap Up</button></div>`;
    case 'summer': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="offseason">🏋️ Summer Workouts</button><button class="btn" data-act="calDone" data-k="summer" ${state.auto[state.leagueIdx] ? '' : 'disabled'}>✅ Wrap Up</button></div>`;
    case 'signing': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="signing">🖊️ Signing Classes</button><button class="btn" data-act="calDone" data-k="signing">✅ Wrap Up</button></div>`;
    case 'rw1': case 'rw2': case 'rw3': case 'rw4': return market() ? `<div class="grid2"><button class="btn focus" data-act="nav" data-to="recruit">📋 Recruiting Board</button><button class="btn" data-act="recruitEndWeek">${key === 'rw4' ? '✍️ Signing Day' : '⏭ End Week'}</button></div>` : '';
    case 'showcase': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="showcase">⭐ All-American Showcase</button><button class="btn" data-act="calDone" data-k="showcase">✅ Wrap Up</button></div>`;
    case 'portal': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="portal">🔁 Transfer Portal</button><button class="btn" data-act="calDone" data-k="portal">✅ Wrap Up</button></div>`;
    case 'seniors': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="seniors">🎓 Senior Send-off</button><button class="btn" data-act="calDone" data-k="seniors">✅ Wrap Up</button></div>`;
    case 'departures': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="departures">🎓 Draft Departures</button><button class="btn" data-act="calDone" data-k="departures">✅ Wrap Up</button></div>`;
    case 'review': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="review">📜 Season in Review</button><button class="btn" data-act="calDone" data-k="review">✅ Wrap Up</button></div>`;
    case 'office': return `<p class="note small">Your teams: <b>${esc(L.teams.filter(isUserTeam).map(t => `${t.city} ${t.name}`.trim()).join(', ') || 'none yet')}</b></p>
      <div class="grid2"><button class="btn" data-act="nav" data-to="teams">👥 Select Teams</button><button class="btn focus" data-act="calDone" data-k="office" ${L.teams.some(isUserTeam) ? '' : 'disabled'}>✅ Confirm</button></div>`;
    case 'overview': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="overview">📊 Offseason Overview</button><button class="btn" data-act="calDone" data-k="overview">✅ Wrap Up</button></div>`;
    case 'preview': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="draft">🔭 Draft Preview</button><button class="btn" data-act="calDone" data-k="preview">✅ Wrap Up</button></div>`;
    case 'lottery': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="lottery">🎱 Draw</button><button class="btn" data-act="homeSimLottery">⏭ Sim</button></div>`;
    case 'mock1': return `<div class="grid2"><button class="btn focus" data-act="openMock" data-n="1">📰 Read</button><button class="btn" data-act="preFinish" data-k="mock1">⏭ Skip</button></div>`;
    case 'scout': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="draft">🔎 Begin</button><button class="btn" data-act="preFinish" data-k="scout">⏭ Skip</button></div>`;
    case 'combine': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="combine">⏱ Attend</button><button class="btn" data-act="preFinish" data-k="combine">⏭ Skip</button></div>`;
    case 'mock2': return `<div class="grid2"><button class="btn focus" data-act="openMock" data-n="2">📰 Read</button><button class="btn" data-act="preFinish" data-k="mock2">⏭ Skip</button></div>`;
    case 'workouts': return `<button class="btn big focus" data-act="nav" data-to="workouts">🏋️ Private Workouts</button>
      <button class="btn small off" data-act="preAdvance" data-k="workouts" style="margin-top:8px">Advance to the Draft</button>`;
    case 'draft': return `<button class="btn big focus" data-act="nav" data-to="draft">🎓 Go to the Draft</button>`;
    case 'options': return `<button class="btn big focus" data-act="nav" data-to="options">📝 Options Deadline</button>`;
    case 'ext': return `<button class="btn big focus" data-act="nav" data-to="extensions">🖊️ Extension Window</button>`;
    case 'camp': return `<button class="btn big focus" data-act="nav" data-to="camp">🏀 Summer League</button>`;
    case 'fa1': case 'fa2': case 'fa3': {
      const day = +key[2];
      if (s.phase === 5) return `<button class="btn big focus" data-act="advFreeAgency">✍️ Open Free Agency</button>`;
      if (s.currentDay < day) return `<button class="btn big focus" data-act="advDay">▶ Start Day ${day}</button>`;
      // Trades open after the July moratorium (week 1).
      return day >= 2 && isComplete() ? `<div class="grid2"><button class="btn focus" data-act="nav" data-to="fa">✍️ Day ${day} Market</button><button class="btn" data-act="liveTrade">🔁 Trade</button></div>` : `<button class="btn big focus" data-act="nav" data-to="fa">✍️ Day ${day} Market</button>`;
    }
    case 'dev': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="offseason">🏋️ Begin Training Camp</button><button class="btn" data-act="calDev" ${state.auto[state.leagueIdx] ? '' : 'disabled'}>✅ Wrap Up</button></div>`;
    case 'survey': return `<button class="btn big focus" data-act="nav" data-to="survey">📋 Read the GM Survey</button>`;
    case 'media': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="storylines">🎤 Media Day</button><button class="btn" data-act="calDone" data-k="media">✅ Wrap Up</button></div>`;
    case 'latefa': return `<div class="grid2"><button class="btn focus" data-act="nav" data-to="latefa">📞 Late Free Agency</button><button class="btn" data-act="liveTrade">🔁 Trade</button></div>`;
    case 'cuts': return `<button class="btn big focus" data-act="nav" data-to="cuts">✂️ Final Cuts</button>`;
    case 'export': return `<button class="btn big focus" data-act="nav" data-to="export">💾 Export Season File</button>`;
    default: return '';
  }
}

// ---- Calendar grid (experiment): the month as a phone calendar, an emoji on each step's date,
// finished and passed dates crossed off, the current topic on top.
const CAL_EMOJI = { office: '🏢', review: '📜', overview: '📊', preview: '👀', lottery: '🎱', mock1: '📝', scout: '🔎', combine: '⏱️', mock2: '🗒️', workouts: '🏀', draft: '🎤', options: '📃', ext: '✍️', camp: '🌴', fa1: '💰', fa2: '💰', fa3: '💰', dev: '🏋️', survey: '📋', media: '📸', latefa: '📞', cuts: '✂️', export: '🏁',
  departures: '🚪', seniors: '🎓', portal: '🔀', showcase: '⭐', rw1: '📣', rw2: '📣', rw3: '📣', rw4: '📣', signing: '✍️', preseason: '🏟️', rosterlock: '🔒', practice: '🏃' };
const CAL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CAL_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function calPos(st) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2})$/.exec(st.date);
  return m ? [CAL_MONTHS.indexOf(m[1]), +m[2]] : null;
}
// One month of the grid. `anim` = { fromDay }: those passed days cross off one after another.
function calMonthHtml(cal, cur, mo, anim = null) {
  // A step shows as finished only when it comes before the current one; flags stored from an earlier run never tick a later event.
  const curIdx = cur ? cal.indexOf(cur) : cal.length;
  const isDone = st => cal.indexOf(st) < curIdx;
  const yr = dispYr(league().season.currentYear);
  const curPos = cur ? calPos(cur) : null;
  const first = new Date(yr, mo, 1).getDay(), days = new Date(yr, mo + 1, 0).getDate();
  const byDay = new Map();
  for (const st of cal) { const p = calPos(st); if (p && p[0] === mo) byDay.set(p[1], [...(byDay.get(p[1]) || []), st]); }
  const before = (m, d) => !cur ? true : curPos ? (m < curPos[0] || (m === curPos[0] && d < curPos[1])) : false;
  // The whole run takes about a second and a half, however many dates it crosses.
  let count = 0;
  if (anim) for (let d = anim.fromDay; d <= days; d++) if (before(mo, d)) count++;
  const per = Math.max(25, Math.min(90, Math.round(1500 / Math.max(1, count))));
  let n = 0;
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<span class="cal-day blank"></span>');
  for (let d = 1; d <= days; d++) {
    const here = byDay.get(d) || [];
    const done = here.length && here.every(isDone);
    const now = here.includes(cur);
    const past = done || before(mo, d);
    const animate = anim && past && d >= anim.fromDay;
    const em = here.length ? CAL_EMOJI[(here.find(s => s === cur) || here[0]).key] || '📅' : '';
    cells.push(`<button class="cal-day ${here.length ? 'step' : ''} ${past && !animate ? 'past' : ''} ${animate ? 'anim' : ''} ${done ? 'done' : ''} ${now ? 'now' : ''}" ${animate ? `style="--d:${(n++) * per}ms"` : ''} ${here.length ? `data-act="calPick" data-k="${here[0].key}"` : 'tabindex="-1"'} aria-label="${CAL_MONTHS[mo]} ${d}${here.length ? ': ' + esc(here.map(s => s.title).join(', ')) : ''}"><span class="n">${d}</span>${em ? `<span class="em">${em}</span>` : ''}${done ? '<span class="tick">✓</span>' : ''}</button>`);
  }
  return { n, per, html: `<div class="cal-nav"><b>${CAL_FULL[mo].toUpperCase()} ${yr}</b></div>
    <div class="cal-grid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<span class="cal-dow">${x}</span>`).join('')}${cells.join('')}</div>` };
}
// The calendar follows the current event: it shows that event's month by itself. When the event moves on,
// the dates up to the next one cross off in turn (and the month turns over when the next event is in a later month).
// The page turn: the old month lifts from its bottom-right corner and folds over to the top-left, and the new month is under it.
function calPeel(w, newHtml, finalHtml = newHtml) {
  const oldHtml = w.innerHTML, oldH = w.offsetHeight;
  w.innerHTML = `<div class="peel-stage"><div class="peel-new">${newHtml}</div><div class="peel-old">${oldHtml}</div><div class="peel-flap"></div></div>`;
  const stage = w.firstElementChild, nw = stage.children[0], old = stage.children[1], flap = stage.children[2];
  stage.style.height = `${Math.max(oldH, nw.offsetHeight)}px`;
  const poly = pts => `polygon(${pts.map(([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`).join(',')})`;
  const t0 = performance.now(), dur = 900;
  const frame = now => {
    if (!w.isConnected) return;
    const k = Math.min(1, (now - t0) / dur), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const s = 2.05 - e * 2.25;                                   // the fold line x + y = s travels from beyond the corner to past the origin
    if (s <= 0) { w.innerHTML = finalHtml; return; }
    // The part of the old page still lying flat: x + y <= s, inside the unit square.
    const keep = s > 1 ? [[0, 0], [1, 0], [1, s - 1], [s - 1, 1], [0, 1]] : [[0, 0], [s, 0], [0, s]];
    // What folded over is the removed part reflected across the fold: (x, y) -> (s - y, s - x).
    const gone = s > 1 ? [[1, s - 1], [1, 1], [s - 1, 1]] : [[s, 0], [1, 0], [1, 1], [0, 1], [0, s]];
    const back = gone.map(([x, y]) => [s - y, s - x]);
    old.style.clipPath = poly(keep);
    flap.style.clipPath = poly(back);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function calendarGrid(cal, cur) {
  const months = [...new Set(cal.map(st => calPos(st)).filter(Boolean).map(p => p[0]))].sort((a, b) => a - b);
  if (!months.length) return '';
  const curPos = cur ? calPos(cur) : null;
  const mo = curPos ? curPos[0] : months[months.length - 1];
  const prevKey = state.calLast;
  state.calLast = cur ? cur.key : '__done';
  let from = null;
  if (prevKey && prevKey !== state.calLast) {
    const ps = cal.find(x => x.key === prevKey), pp = ps ? calPos(ps) : null;
    if (pp && (!curPos || pp[0] < curPos[0] || (pp[0] === curPos[0] && pp[1] < curPos[1]))) from = pp;
  }
  if (from && from[0] < mo) {
    const p1 = calMonthHtml(cal, cur, from[0], { fromDay: from[1] });
    // After the dates cross off, the page peels from the bottom-right corner up to the top-left, showing the new month.
    setTimeout(() => {
      const w = document.getElementById('cal-wrap');
      if (w) calPeel(w, calMonthHtml(cal, cur, mo, null).html, calMonthHtml(cal, cur, mo, { fromDay: 1 }).html);
    }, p1.n * p1.per + 600);
    return `<div id="cal-wrap">${p1.html}</div>`;
  }
  return `<div id="cal-wrap">${calMonthHtml(cal, cur, mo, from ? { fromDay: from[0] === mo ? from[1] : 1 } : null).html}</div>`;
}
actions.calPick = d => { const st = activeCal().find(x => x.key === d.k); if (st) { const c = activeCal(), cu = currentStep(); toast(`${st.date} · ${st.title}`, c.indexOf(st) < (cu ? c.indexOf(cu) : c.length) ? 'Done.' : st.blurb, 3200); } };

function calendarCard() {
  const s = league().season;
  if (phaseRank(s) === 0 && !isCollege()) {
    return `<fieldset class="frame"><legend>Offseason</legend><p class="note">This save is at ${esc(phaseName(s))}. Advance once in Hoop Land after the season ends (to the Pre-Lottery phase), export that save and load it here to run the offseason.</p></fieldset>`;
  }
  const cur = currentStep();
  const cal = activeCal();
  const item = st => {
    const state_ = cal.indexOf(st) < (cur ? cal.indexOf(cur) : cal.length) ? 'done' : st === cur ? 'now' : 'locked';
    return `<li class="cal ${state_}">
        <span class="cal-date">${esc(st.date)}</span>
        <div class="cal-body">
          <b>${state_ === 'done' ? '✓ ' : state_ === 'locked' ? '🔒 ' : ''}${esc(st.title)}</b>
          <p class="note small">${esc(state_ === 'done' ? stepSummary(st.key) : st.blurb).replace(/\n/g, '<br>')}</p>
          ${state_ === 'now' ? stepActions(st.key) : ''}
        </div>
      </li>`;
  };
  // The current event on top (gold), the calendar under it, then the rest of the offseason.
  return `<fieldset class="frame"><legend>${dispYr(s.currentYear)} Offseason</legend>
    ${cur ? `<ol class="calendar cal-first">${item(cur)}</ol>` : '<p class="note up">🏁 Offseason complete.</p>'}
    ${calendarGrid(cal, cur)}
    <details class="cal-all"><summary>All steps</summary><ol class="calendar">${cal.filter(st => st !== cur).map(item).join('')}</ol></details>
    ${state.undo ? `<button class="btn small" data-act="undoAdvance">↺ Undo ${esc(state.undo.label)}</button>` : ''}
  </fieldset>`;
}

actions.calDone = d => { if (d.k === 'media') applyPresser(); calFlags()[d.k] = true; state.undo = null; render(); };
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
  office: ['teams'], overview: ['overview'], preview: ['draft', 'prospect', 'overview'], lottery: ['lottery'], mock1: ['mock'], scout: ['draft', 'prospect', 'lottery', 'liveTrade'], combine: ['combine', 'prospect'], mock2: ['mock', 'prospect'], workouts: ['workouts', 'prospect', 'draft', 'liveTrade'], draft: ['draft', 'prospect', 'liveTrade'], options: ['options'], ext: ['extensions'],
  camp: ['camp', 'rookies'], fa1: ['fa'], fa2: ['fa', 'liveTrade'], fa3: ['fa', 'liveTrade'],
  dev: ['offseason', 'report', 'mentor', 'rookies', 'trainer', 'strength', 'coachtree', 'tendencies', 'tendplayer', 'gameplan', 'playbook'], survey: ['survey'], media: ['storylines'], latefa: ['latefa', 'liveTrade'], cuts: ['cuts'], export: ['export'],
  review: ['review'], departures: ['departures'], seniors: ['seniors'], portal: ['portal'], showcase: ['showcase', 'recruitee'], rw1: ['recruit', 'recruitee', 'recruitweek'], rw2: ['recruit', 'recruitee', 'recruitweek'], rw3: ['recruit', 'recruitee', 'recruitweek'], rw4: ['recruit', 'recruitee', 'recruitweek'], signing: ['signing'], preseason: ['preseason'], rosterlock: ['rosterlock'], practice: ['practice'], summer: ['offseason', 'report', 'mentor', 'trainer', 'strength', 'coachtree', 'tendencies', 'tendplayer', 'gameplan', 'playbook'],
};
const ALWAYS = ['main', 'editor', 'settings', 'roster', 'player', 'leaders', 'prospect', 'coachtree', 'facilities', 'gameplan', 'playbook'];
function screenAllowed(name) {
  if (!state.data || ALWAYS.includes(name)) return true;
  if (isCollege()) {
    const cur = currentStep();
    // Recruiting stays open to look back at once the weeks are done.
    if (['recruit', 'recruitee', 'recruitweek'].includes(name) && market()) return true;
    return !cur || (STEP_SCREENS[cur.key] || []).includes(name) || name === 'review';
  }
  if (phaseRank(league().season) === 0) return true;
  const cur = currentStep();
  return !!cur && (STEP_SCREENS[cur.key] || []).includes(name);
}

// Sim: draw it and go straight to the full order, no reveal.
actions.simLotteryNow = () => actions.advLottery({ instant: true });
actions.homeSimLottery = () => actions.advLottery({ instant: true, fromHome: true });

actions.advLottery = async (opts = {}) => {
  const L = league();
  const P = state.params;
  checkpoint('Lottery');
  // A new lottery starts a new draft cycle: whatever an earlier run of this offseason stored for the mocks, scouting,
  // the combine and workouts is forgotten, so the steps after the lottery are really still to do.
  (state.pre ||= {})[seasonKey()] = { steps: {}, workouts: {}, reveals: {} };
  savePre();
  state.compCache = {};
  const setup = lotterySetup(L, P.lotteryFormat, P.lotteryDraws);
  const order = preLotteryOrder(L);
  const drawn = drawLottery(order.slice(0, setup.lotteryTeams.length), setup.odds, setup.draws, mulberry32(Math.floor(Math.random() * 1e9)), setup.floor);
  const r1 = drawn.map(r => r.team);
  const full = [...r1, ...order.filter(t => !r1.includes(t))];
  // 2nd apron, 3 of 5 seasons: that first goes to the end of the round.
  const pen = new Set(apronStore().pen.filter(x => x.yr === L.season.currentYear).map(x => x.otid));
  applyLottery(L, [...full.filter(t => !pen.has(t.id)), ...full.filter(t => pen.has(t.id))]);
  settleProt(L);
  draftState().lottery = null;
  draftState().mock = null;
  state.compCache = {};
  state.dirty = true;
  // The result shows on the same lottery screen, revealed from the last
  // lottery pick up to #1.
  state.lotteryReveal = !opts.instant;
  // From Home, Sim stays on Home: the calendar moves on and the winner is in the toast.
  if (opts.fromHome || state.stack[state.stack.length - 1].name === 'lottery') render(); else go('lottery');
  if (opts.instant) {
    const jump = order.indexOf(r1[0]);
    toast(`🎱 ${`${r1[0].city} ${r1[0].name}`.trim()} win the lottery!`, jump > 0 ? `Jumped ${jump} spot${jump > 1 ? 's' : ''} to #1.` : 'They held onto the top spot.');
  }
};

actions.advFreeAgency = async () => {
  const L = league();
  if (!optStore().done && (optionPlayers(L).length || L.teams.some(t => t.roster.some(p => FA.qoEligible(L, p))))) {
    const mine = optionPlayers(L).filter(x => isUserTeam(x.team)).length + L.teams.filter(isUserTeam).flatMap(t => t.roster.filter(p => FA.qoEligible(L, p))).length;
    if (!(await confirmBox(`The options deadline hasn't been run${mine ? `: you have ${mine} option or qualifying-offer decision${mine > 1 ? 's' : ''} waiting` : ''}. Open free agency anyway? Undecided options stay in the save.`, 'Open Anyway'))) { go('options'); return; }
  }
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
      bare: true,
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
  if (state.leagueFile) { screens.editor({}); return; }
  const L = league();
  const s = L.season;
  const players = leaguePlayers(L, true).length;
  const auto = state.auto[state.leagueIdx];
  const yourTeams = L.teams.filter(isUserTeam).map(t => t.shortName).join(', ') || 'None picked';
  layout({
    title: 'Main Menu',
      bare: true,
    body: `
      <div class="league-card compact">
        ${leagueBadge(L)}
        <div class="grow"><b>${esc(L.leagueName || L.shortName)}</b>
          <span class="note small">${esc(isCollege() ? collegePhaseName(s) : phaseName(s))} · Your ${isCollege() || isFranchise() ? (isCollege() ? 'school' : 'team') : 'teams'}: ${esc(yourTeams)}</span></div>
      </div>
      ${calendarCard()}
      <div class="grid2">
        ${L.teams.some(isUserTeam) ? '<button class="btn left" data-act="nav" data-to="roster"><span class="ico">👥</span> My Team</button>' : ''}
        <button class="btn left" data-act="nav" data-to="editor"><span class="ico">🏀</span> League</button>
      </div>
      <div class="grid3">
        <button class="btn left" data-act="nav" data-to="settings"><span class="ico">☰</span> Settings</button>
        <label class="btn left"><span class="ico">📂</span> Load<input type="file" id="fileInput"></label>
        <button class="btn left" data-act="downloadLeague"><span class="ico">🌐</span> Export</button>
      </div>
      <p class="center muted small">Version ${APP_VERSION}</p>`,
  });
};

function phaseWarning(s) {
  if (BUMP_PHASES.includes(s.phase) && s.currentDay === BUMP_DAY) return '';
  if (BUMP_PHASES.includes(s.phase)) return `<p class="note gold small" style="margin-top:10px">Best run on Free Agency Day ${BUMP_DAY} (the last day before the new season), once rosters are set. This file is at ${esc(phaseName(s))}.</p>`;
  return `<p class="note gold small" style="margin-top:10px">The offseason bump is meant for free agency (Day ${BUMP_DAY}, before advancing to the new season). This file is at ${esc(phaseName(s))}.</p>`;
}

// data-replace: step sideways (next/previous team) without stacking history, so Back still goes Home.
actions.nav = d => (d.replace ? replace(d.to, d.arg ? { arg: d.arg } : {}) : go(d.to, d.arg ? { arg: d.arg } : {}));

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
  // Ceilings that are all used up get re-spread to the level his potential allows.
  if (state.params.dynamicCeilings !== false) for (const p of vetPlayers()) refitCeilings(p);
  const devT = tierNow('dev');
  const entries = bumpEntries().map(e => ({ ...e, ...bumpContext(), spend: state.params.spendCpuPoints && !isUserTeam(e.team),
    ...(() => {
      const F = FX.facilityFx(e.team), u = isUserTeam(e.team), f = u ? fxNow() : null, a = e.p.age;
      const dev = (u && devT ? CO.devMult(devT) * (a <= 23 ? f.labYoung : 1) * (a >= 24 && a <= 27 ? f.lateBloom : 1) : 1) * F.devMult;
      const pot = (u && devT ? CO.potMult(devT) * (a <= 21 ? f.labPot : 1) : 1) * (a <= 21 ? F.youngPot : 1);
      return { ...(dev !== 1 ? { devMult: dev } : {}), ...(pot !== 1 ? { potMult: pot } : {}), longMult: u ? f.longMult : 1, skillMult: (u ? f.skillMult : 1) * F.skillMult,
        potLossMult: F.potLossMult, longCutMult: F.longCutMult, nagMult: F.nagMult, structStd: F.structStd };
    })() }));
  applyCulture();
  const awards = runProgression(entries, { ...state.params, seed }, state.profiles[li]);
  state.potWhy = new Map(awards.why);
  // A potential bump brings new ratings room with it, adding up to the new potential.
  if (state.params.dynamicCeilings !== false) for (const e of entries) potBumpCeilings(e.p, snapOf(e.p).pot);
  // Play styles follow the new ratings and ages (young players move most).
  let tendMoved = 0;
  if (state.params.autoTendencies !== false) {
    const trng = mulberry32((seed ^ 0x7e4d) >>> 0);
    for (const p of vetPlayers()) if (autoTendencies(p, trng)) tendMoved++;
  }
  state.tendMoved = tendMoved;
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
  if (state.tendMoved) toast(`🎛️ ${state.tendMoved} players' play styles shifted`, 'Tendencies follow ratings and age.', 3200);
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
  if (!done && !clashes.length) return '<fieldset class="frame"><legend>Jersey Numbers</legend><p class="note">👕 No jersey number conflicts: every player has his own number.</p></fieldset>';
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

// ---------------------------------------------------------------------------
// Strength program (Training Camp). Physical ratings don't move after the
// draft in the game, so this is the one place they can: players 25 and under
// can add Strength, Speed or Stamina, likelier when young, with room on
// their frame, high potential and draft pedigree. Written to the save.

const STR_FOCUS = [['STR', 'Strength'], ['SPD', 'Speed'], ['STM', 'Stamina']];
const STR_MAX_AGE = 25;
function strengthStore() {
  const key = `hlc:str:${seasonKey()}`;
  const c = (state.strength ||= {});
  if (!c[key]) { let v = {}; try { v = JSON.parse(localStorage.getItem(key)) || {}; } catch { v = {}; } c[key] = { focus: {}, ...v }; }
  return c[key];
}
const saveStrength = () => { try { localStorage.setItem(`hlc:str:${seasonKey()}`, JSON.stringify(strengthStore())); } catch { /* ignore */ } };
const cpuFocus = p => (p.pos >= 6 ? 'STR' : p.pos <= 2 ? 'SPD' : ['SPD', 'STM', 'STR'][p.id % 3]);
// Your players start on their best physical rating that still has room.
const roomFocus = p => [...PHYSICAL].filter(k => p.attributes[k][0] < ATTR_MAX).sort((a, b) => p.attributes[b][0] - p.attributes[a][0])[0] || cpuFocus(p);
const focusOf = (p, team) => (isUserTeam(team) ? strengthStore().focus[p.id] || roomFocus(p) : cpuFocus(p));
function pedigree(p) {
  const d = p.history?.draft;
  if (!d?.yr) return 0;
  return d.rd === 1 ? (d.pk <= 5 ? 1 : d.pk <= 14 ? 0.75 : 0.55) : 0.3;
}
// Chance of a gain this offseason (0–0.85).
function strengthOdds(p) {
  const youth = Math.max(0, Math.min(1, (STR_MAX_AGE - p.age) / 6));
  return Math.max(0.05, Math.min(0.85, 0.1 + youth * 0.3 + frameRoom(p) * 0.25 + (p.pot - 6) * 0.03 + pedigree(p) * 0.1));
}
// Gains for the young (25 and under), plus the odd change of size for
// anyone: an 18–21-year-old can grow an inch, a veteran can slim down.
function runStrength() {
  const L = league();
  const rng = mulberry32((saveSalt() ^ 0x57a3) >>> 0);
  const out = [];
  for (const team of L.teams) for (const p of team.roster) {
    const gains = {};
    let lbs = 0, inch = 0;
    if (p.age <= STR_MAX_AGE) {
      const odds = Math.min(0.95, strengthOdds(p) * (isUserTeam(team) ? fxNow().strMult : 1) * FX.facilityFx(team).strMult);
      const focus = focusOf(p, team);
      const bump = k => { if (p.attributes[k][0] >= ATTR_MAX) return; p.attributes[k][0]++; if (p.attributes[k][1] < p.attributes[k][0]) p.attributes[k][1] = p.attributes[k][0]; gains[k] = (gains[k] || 0) + 1; };
      if (rng() < odds) {
        bump(focus);
        if (rng() < odds * 0.15) bump(focus);                       // a big summer: +2
        else if (rng() < odds * 0.3) bump(PHYSICAL.filter(k => k !== focus)[Math.floor(rng() * 2)]);
      }
      if (gains.STR) lbs = Math.round(gains.STR * (4 + rng() * 5));
    }
    if (p.age >= 18 && p.age <= 21 && rng() < 0.03) inch = 1;
    if (!lbs && p.age >= 27 && p.wt >= 200 && rng() < 0.05) lbs = -Math.round(4 + rng() * 7);
    if (!Object.keys(gains).length && !lbs && !inch) continue;
    p.wt += lbs;
    p.ht += inch;
    out.push({ pid: p.id, tid: team.id, gains, lbs, inch });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coaching tree and tendencies (Training Camp / Summer Development)

const coachKey = () => `hlc:coach:${league().shortName}:${league().meta?.saveName || state.fileName}`;
function treeStore() {
  const c = (state.coachTree ||= {});
  const key = coachKey();
  if (!c[key]) { let v = {}; try { v = JSON.parse(localStorage.getItem(key)) || {}; } catch { v = {}; } c[key] = { bought: {}, spent: 0, earned: {}, culture: {}, ...v }; }
  return c[key];
}
const saveTree = () => { try { localStorage.setItem(coachKey(), JSON.stringify(treeStore())); } catch { /* ignore */ } };
const myCoach = () => CO.headCoach((myTeam() || null));
const tierNow = k => CO.tierOf(treeStore(), myCoach(), k);
// This offseason's points (once per season), plus 2 to start a new tree.
function earnCoachPoints() {
  const tree = treeStore(), t = (myTeam() || null);
  if (!t) return;
  const yr = league().season.currentYear;
  if (!tree.earned.start) tree.earned.start = { pts: isComplete() && !isCollege() ? 3 : 2, why: ['A new staff'] };
  if (!tree.earned[yr]) { const e = CO.seasonPoints(t, isCollege()); if (isComplete() && !isCollege()) { e.pts++; e.why.push('Franchise growth'); } tree.earned[yr] = e; }
  saveTree();
}
const coachPoints = () => { const tr = treeStore(); return Object.values(tr.earned).reduce((a, e) => a + e.pts, 0) - tr.spent; };

function coachCard() {
  const t = (myTeam() || null);
  if (!t) return '';
  earnCoachPoints();
  const c = myCoach(), yr = league().season.currentYear, e = treeStore().earned[yr];
  const r = k => c?.attributes?.[k]?.[0] ?? '—';
  return `<fieldset class="frame"><legend>Coaching Staff</legend><div class="stack">
    <p class="note"><b>${c ? esc(`${c.fn} ${c.ln}`) : 'Head coach'}</b> <span class="muted small">Development ${r('development')} · Motivation ${r('motivation')} · Leadership ${r('leadership')}</span></p>
    <p class="note small">${e ? `This offseason: <span class="up">+${e.pts}</span> (${esc(e.why.join(', '))})` : ''} · <b class="gold">${tokTag(coachPoints())}</b> to spend</p>
    <p class="note small muted">${CO.BRANCHES.map(b => `${b.icon} ${b.label} ${tierNow(b.k)}/${CO.MAX_TIER}`).join(' · ')}</p>
    <div class="grid2"><button class="btn" data-act="nav" data-to="coachtree">🌳 Coaching Tree</button><button class="btn" data-act="nav" data-to="tendencies">🎯 Tendencies</button></div>
    <div class="grid2"><button class="btn" data-act="nav" data-to="gameplan">📋 Game Plan</button><button class="btn" data-act="nav" data-to="playbook">📒 Playbook</button></div>
    ${isComplete() && !isCollege() ? `<button class="btn" data-act="nav" data-to="facilities">🏟️ Facilities · ${coinTag(coinsOf(t))}</button>` : ''}
  </div></fieldset>`;
}

// Effects of the extra tree nodes (Complete rules, pros only).
const fxNow = () => CO.effects(treeStore(), myCoach(), isComplete() && !isCollege());
// Coins: the game's own currency (each team's frontOffice.coins). Here they
// only buy facility upgrades.
const coinsOf = t => t?.frontOffice?.coins ?? 0;
function spendCoins(t, n) {
  if (!t?.frontOffice || coinsOf(t) < n) return false;
  t.frontOffice.coins -= n;
  state.dirty = true;
  return true;
}
const coinTag = n => `🪙${n}`;
const tokTag = n => `🎟️${n}`;

// Facilities: the four buildings, three tiers each. Coins buy the next
// tier; each tier lists exactly what it does in the app.
screens.facilities = () => {
  const t = myTeam();
  if (!t) { back(); return; }
  const coins = coinsOf(t);
  layout({
    title: 'Facilities',
    body: `<fieldset class="frame"><legend>${esc(t.shortName)}</legend>
        <p class="note"><b class="gold">${coinTag(coins)}</b> coins</p>
        <p class="note small muted">Each upgrade also lifts what the game itself does with the building.</p></fieldset>
      ${FX.FACILITIES.map(f => {
        const cur = FX.tierIn(t, f.k), cost = FX.upgradeCost(cur);
        return `<fieldset class="frame"><legend>${f.icon} ${f.label}</legend><div class="tree">${f.tiers.map((tier, i) => {
          const lv = i + 1, have = cur >= lv, next = lv === cur + 1;
          return `${i ? '<div class="tree-link"><span></span></div>' : ''}<div class="tree-node one ${have ? 'have' : next ? 'next' : 'locked'}">
            <b class="tn-name">Tier ${lv} · ${esc(tier.name)}</b>
            <span class="small tn-text">${tier.lines.map(l => `• ${esc(l)}`).join('<br>')}</span>
            ${have ? '<span class="up tn-cost">✓</span>' : next ? `<button class="btn small ${coins >= cost ? 'focus' : ''}" data-act="facUpgrade" data-k="${f.k}" ${coins >= cost ? '' : 'disabled'}>Upgrade ${coinTag(cost)}</button>` : `<span class="muted small tn-cost">${coinTag(FX.upgradeCost(lv - 1))}</span>`}
          </div>`;
        }).join('')}</div></fieldset>`;
      }).join('')}`,
  });
};
actions.facUpgrade = async d => {
  const t = myTeam(), f = FX.FACILITIES.find(x => x.k === d.k);
  const fac = t && FX.facilityOf(t, d.k);
  if (!f || !fac) return;
  const cur = FX.tierIn(t, d.k);
  if (cur >= FX.MAX_FAC_TIER) return;
  const cost = FX.upgradeCost(cur);
  if (coinsOf(t) < cost) { toast('Not enough coins', '', 2400, true); return; }
  if (!(await confirmBox(`Upgrade ${esc(f.label)} to ${esc(f.tiers[cur].name)} for ${coinTag(cost)}?`, 'Upgrade'))) return;
  checkpoint(`Upgrade ${f.label}`);
  spendCoins(t, cost);
  fac.tier = cur + 1;
  state.dirty = true;
  render();
  toast(`${f.label} upgraded`, f.tiers[cur].name);
};

screens.coachtree = () => {
  earnCoachPoints();
  const tree = treeStore(), c = myCoach(), free = CO.coachTiers(c), pts = coachPoints();
  const extras = isComplete() && !isCollege();
  const nodeBtn = (b, n, nodes) => {
    const have = CO.nodeOwned(tree, c, n, b.k);
    const cur = tierNow(b.k);
    const reqOk = n.spine ? n.spine === cur + 1 : n.req.every(id => CO.nodeOwned(tree, c, nodes.find(x => x.id === id), b.k));
    const pc = n.spine ? CO.TIER_COST[n.spine - 1] : n.pts;
    const txt = n.spine ? b.tiers[n.spine - 1] : n.text;
    const afford = pts >= pc;
    const cls = have ? 'have' : reqOk ? 'next' : 'locked';
    return `<div class="tree-node ${cls} ${n.wide ? 'wide' : ''}">
      <b class="tn-name">${esc(n.label)}${have && n.spine && free[b.k] >= n.spine ? ' <span class="muted small">· from your coach</span>' : ''}</b>
      <span class="small tn-text">${esc(txt)}</span>
      ${have ? '<span class="up tn-cost">✓</span>' : reqOk ? `<button class="btn small ${afford ? 'focus' : ''}" data-act="buyNode" data-k="${b.k}" data-id="${n.id}" ${afford ? '' : 'disabled'}>${tokTag(pc)}</button>` : `<span class="muted small tn-cost">${tokTag(pc)}</span>`}
    </div>`;
  };
  const link = '<div class="tree-link"><span></span></div>';
  layout({
    title: 'Skill Tree',
    body: `<fieldset class="frame"><legend>${c ? esc(`${c.fn} ${c.ln}`) : 'Your Staff'}</legend>
        <p class="note">Franchise tokens come from each season: one for the job, more for a winning record, the ${isCollege() ? 'tournament' : 'playoffs'}, a deep run and a title. Your coach's own ratings (13+ and 17+) start tiers unlocked.</p>
        <p class="note"><b class="gold">${tokTag(pts)}</b> franchise token${pts === 1 ? '' : 's'} to spend</p>
        <div class="stack small">${Object.entries(tree.earned).map(([k, e]) => `<span class="muted">${k === 'start' ? 'Start' : k}: +${e.pts} · ${esc(e.why.join(', '))}</span>`).join('')}</div></fieldset>
      ${CO.BRANCHES.map(b => {
        const nodes = CO.NODES[b.k].filter(n => n.spine || extras);
        const row = r => nodes.filter(n => n.row === r);
        const rows = [1, 2, 3, 4].filter(r => row(r).length);
        return `<fieldset class="frame"><legend>${b.icon} ${b.label}</legend><div class="tree">
          ${rows.map((r, i) => `${i ? link : ''}<div class="tree-row2 ${row(r).length === 1 ? 'one' : ''}">${row(r).map(n => nodeBtn(b, n, nodes)).join('')}</div>`).join('')}
        </div></fieldset>`;
      }).join('')}`,
  });
};
actions.buyNode = d => {
  const tree = treeStore(), team = myTeam();
  const b = CO.BRANCHES.find(x => x.k === d.k), n = CO.NODES[d.k].find(x => x.id === d.id);
  if (!b || !n) return;
  const cur = tierNow(d.k);
  const pc = n.spine ? CO.TIER_COST[n.spine - 1] : n.pts;
  if (n.spine ? n.spine !== cur + 1 : !n.req.every(id => CO.nodeOwned(tree, myCoach(), CO.NODES[d.k].find(x => x.id === id), d.k))) return;
  if (coachPoints() < pc) { toast('Not enough tokens', '', 2400, true); return; }
  if (n.spine) tree.bought[d.k] = n.spine; else (tree.nodes ||= {})[n.id] = true;
  tree.spent += pc;
  saveTree();
  if (d.k === 'culture' && n.spine && state.auto[state.leagueIdx]) applyCulture();
  toast(`${n.label} unlocked`, `${tokTag(pc)} spent`);
  render();
};

// Tendencies: you have some influence over each of your players this offseason
// (Scheme tier, youth, motor). Changes go straight into the save; the
// offseason's starting values are kept to reset to.
const tendKey = () => `hlc:tend:${league().meta?.saveName || state.fileName}:${seasonKey()}`;
function tendStore() {
  const c = (state.tendS ||= {});
  const key = tendKey();
  if (!c[key]) { let v = {}; try { v = JSON.parse(localStorage.getItem(key)) || {}; } catch { v = {}; } c[key] = { orig: {}, ...v }; }
  return c[key];
}
const saveTend = () => { try { localStorage.setItem(tendKey(), JSON.stringify(tendStore())); } catch { /* ignore */ } };
const tendPlayers = () => league().teams.filter(isUserTeam).flatMap(t => t.roster.map(p => ({ p, team: t }))).filter(e => e.p.tendencies);
const origTend = p => tendStore().orig[p.id] || p.tendencies;
const nudgesUsed = p => Object.keys(TEND_LABELS).reduce((a, k) => a + Math.abs((p.tendencies[k] || 0) - (origTend(p)[k] || 0)), 0);

screens.tendencies = () => {
  const sch = tierNow('scheme');
  const list = tendPlayers().sort((a, b) => shownLevel(b.p) - shownLevel(a.p));
  state.tendNav = list.map(e => e.p.id);
  layout({
    title: 'Tendencies',
    body: `<p class="note small">Scheme tier ${sch}: every player has ${1 + sch} influence, one more if he's 23 or younger, one more with a high motor, one fewer at 31+. A tendency moves up to ${CO.maxShift(sch, fxNow())} from where the offseason started.</p>
      <div class="list">${list.map(({ p, team }) => {
        const n = CO.nudgesFor(p, sch, fxNow()), used = nudgesUsed(p);
        return `<button class="prow" data-act="openTend" data-id="${p.id}"><span class="name">${esc(playerName(p))}</span>
          <span class="meta">${esc(posName(p))} · ${p.age}y · Lv ${shownLevel(p)}${state.userTeams.size > 1 ? ` · ${esc(team.shortName)}` : ''}</span>
          <span class="chg ${used ? 'up' : 'muted'}">${used}/${n}</span></button>`;
      }).join('') || '<p class="note muted">No players.</p>'}</div>`,
  });
};
actions.openTend = d => go('tendplayer', { id: +d.id });
actions.stepTend = d => replace('tendplayer', { id: +d.id });
screens.tendplayer = ({ id }) => {
  const e = tendPlayers().find(x => x.p.id === id);
  if (!e) { back(); return; }
  const p = e.p, sch = tierNow('scheme'), n = CO.nudgesFor(p, sch, fxNow()), used = nudgesUsed(p), o = origTend(p), lim = CO.maxShift(sch, fxNow());
  const ids = state.tendNav || [], at = ids.indexOf(id);
  const nav = (rid, dir) => rid == null ? '' : `<button class="nav-btn" data-act="stepTend" data-id="${rid}" aria-label="${dir < 0 ? 'Previous' : 'Next'} player">${dir < 0 ? '◀' : '▶'}</button>`;
  const bar = v => `<span class="tbar2"><span class="tb-mid"></span><span class="tb-fill ${v < 0 ? 'neg' : ''}" style="${v >= 0 ? `left:50%;width:${v * 10}%` : `right:50%;width:${-v * 10}%`}"></span></span>`;
  layout({
    title: playerName(p),
    left: nav(at > 0 ? ids[at - 1] : null, -1),
    right: nav(at >= 0 && at < ids.length - 1 ? ids[at + 1] : null, 1),
    body: `<fieldset class="frame"><legend>Influence · ${used}/${n} used</legend>
        <p class="note small">${esc(posName(p))} · ${p.age}y · Motor ${p.traits?.motor || '—'}. ${esc(styleLine(p))}</p>
        ${used ? '<button class="btn small" data-act="resetTend" data-id="' + p.id + '">↺ Reset his tendencies</button>' : ''}</fieldset>
      ${TEND_GROUPS.map(([g, ks]) => `<fieldset class="frame"><legend>${g}</legend><div class="stack">${ks.map(k => {
        const v = p.tendencies[k] || 0, d = v - (o[k] || 0);
        const canUp = v < 5 && d < lim && (d < 0 || used < n), canDn = v > -5 && d > -lim && (d > 0 || used < n);
        return `<div class="tend-row tend-edit"><span class="small">${TEND_LABELS[k]}${d ? ` <span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</span>` : ''}</span>${bar(v)}
          <span class="trait-ctl"><button class="btn tiny" data-act="tendAdj" data-id="${p.id}" data-k="${k}" data-d="-1" ${canDn ? '' : 'disabled'} aria-label="Less ${TEND_LABELS[k]}">−</button><b class="small">${v > 0 ? '+' : ''}${v}</b><button class="btn tiny" data-act="tendAdj" data-id="${p.id}" data-k="${k}" data-d="1" ${canUp ? '' : 'disabled'} aria-label="More ${TEND_LABELS[k]}">+</button></span></div>`;
      }).join('')}</div></fieldset>`).join('')}`,
  });
};
actions.tendAdj = d => {
  const e = tendPlayers().find(x => x.p.id === +d.id);
  if (!e) return;
  const p = e.p, st = tendStore();
  if (!st.orig[p.id]) st.orig[p.id] = { ...p.tendencies };
  const sch = tierNow('scheme'), o = st.orig[p.id], k = d.k, step = +d.d;
  const v = (p.tendencies[k] || 0) + step, dv = v - (o[k] || 0);
  if (v > 5 || v < -5 || Math.abs(dv) > CO.maxShift(sch, fxNow())) return;
  const growing = Math.abs(dv) > Math.abs((p.tendencies[k] || 0) - (o[k] || 0));
  if (growing && nudgesUsed(p) >= CO.nudgesFor(p, sch, fxNow())) { toast('No influence left for him', '', 2400, true); return; }
  p.tendencies[k] = v;
  saveTend();
  state.dirty = true;
  render();
};
actions.resetTend = d => {
  const e = tendPlayers().find(x => x.p.id === +d.id);
  const o = e && tendStore().orig[e.p.id];
  if (!o) return;
  Object.assign(e.p.tendencies, o);
  saveTend();
  render();
};

// Game plan: set the head coach's scheme settings (the Scheme tier opens
// each group). The coach's own settings are kept to reset to.
screens.gameplan = () => {
  const c = myCoach(), sch = tierNow('scheme');
  if (!c?.tendencies) { layout({ title: 'Game Plan', body: '<p class="note">No head coach on your staff.</p>' }); return; }
  const own = treeStore().planOrig?.[c.id] || c.tendencies;
  layout({
    title: 'Game Plan',
    body: `<p class="note small">${esc(`${c.fn} ${c.ln}`)}'s settings, used by the game when it sims. Scheme tier ${sch} of 3: ${['nothing open yet', 'offense open', 'offense and defense open', 'everything open'][sch]}.</p>
      ${CO.PLAN.map(g => `<fieldset class="frame ${sch >= g.tier ? '' : 'plan-locked'}"><legend>${g.group}${sch >= g.tier ? '' : ` · 🔒 Scheme ${g.tier}`}</legend><div class="stack">${g.keys.map(([k, label, max]) => {
        const v = c.tendencies[k] ?? 0;
        return `<div class="plan-row"><span class="small">${label}${v !== (own[k] ?? 0) ? ' <span class="up">•</span>' : ''}</span><div class="plan-opts">${Array.from({ length: max + 1 }, (_, i) => `<button class="btn tiny ${i === v ? 'on focus' : 'off'}" data-act="setPlan" data-k="${k}" data-v="${i}" ${sch >= g.tier ? '' : 'disabled'}>${esc(CO.planOption(k, i))}</button>`).join('')}</div></div>`;
      }).join('')}</div></fieldset>`).join('')}
      ${treeStore().planOrig?.[c.id] ? '<button class="btn small" data-act="resetPlan">↺ Back to his own settings</button>' : ''}`,
  });
};
actions.setPlan = d => {
  const c = myCoach(), tree = treeStore();
  if (!c?.tendencies) return;
  const g = CO.PLAN.find(x => x.keys.some(([k]) => k === d.k));
  if (!g || tierNow('scheme') < g.tier) return;
  (tree.planOrig ||= {})[c.id] ||= { ...c.tendencies };
  c.tendencies[d.k] = +d.v;
  saveTree();
  state.dirty = true;
  render();
};
actions.resetPlan = () => {
  const c = myCoach(), o = treeStore().planOrig?.[c?.id];
  if (!o) return;
  Object.assign(c.tendencies, o);
  delete treeStore().planOrig[c.id];
  saveTree();
  state.dirty = true;
  render();
};

// Playbook: the team's quick plays (4 per position, by the game's play
// number) and scoring options (up to 3 players with usage and focus).
// Playbooks are saved on this device by name and can be installed on your
// team in any file. Scheme 1 installs playbooks; Scheme 2 edits scoring
// options.
const POS5 = ['PG', 'SG', 'SF', 'PF', 'C'];
const pbKey = 'hlc:playbooks';
const loadBooks = () => { try { return JSON.parse(localStorage.getItem(pbKey)) || []; } catch { return []; } };
const saveBooks = b => { try { localStorage.setItem(pbKey, JSON.stringify(b)); } catch { /* ignore */ } };
const hasPlays = t => (t.quickPlays?.positions || []).some(x => x.plays?.length);
const playsGrid = qp => `<div class="pb-grid">${POS5.map((pos, i) => `<span class="pb-pos">${pos}</span>${(qp?.positions?.[i]?.plays || []).map(n => `<span class="pb-play">#${n}</span>`).join('') || '<span class="muted small">—</span>'}`).join('')}</div>`;

screens.playbook = () => {
  const t = myTeam();
  if (!t) { layout({ title: 'Playbook', body: '<p class="note">Pick your team first.</p>' }); return; }
  const sch = tierNow('scheme'), books = loadBooks();
  const so = (t.scoringOptions || []);
  const rosterIds = new Set(t.roster.map(p => p.id));
  const opt = (sel, p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(playerName(p))} · ${esc(posName(p))} · Lv ${shownLevel(p)}</option>`;
  layout({
    title: 'Playbook',
    body: `<fieldset class="frame"><legend>${esc(t.shortName)} Quick Plays</legend>
        ${hasPlays(t) ? playsGrid(t.quickPlays) : '<p class="note small muted">No quick plays set for this team in this file.</p>'}
        <p class="note small muted" style="margin-top:6px">Plays show by the game's play number.</p>
        ${hasPlays(t) ? '<button class="btn small" data-act="savePlaybook">💾 Save as a playbook</button>' : ''}</fieldset>
      <fieldset class="frame"><legend>Saved Playbooks</legend><div class="stack">
        ${books.map((b, i) => `<div class="pb-book"><b>${esc(b.name)}</b>${playsGrid(b.quickPlays)}
          <div class="grid2"><button class="btn small ${sch >= 1 ? 'focus' : ''}" data-act="installPlaybook" data-i="${i}" ${sch >= 1 ? '' : 'disabled'}>${sch >= 1 ? '📥 Install' : '🔒 Scheme 1'}</button><button class="btn small off" data-act="deletePlaybook" data-i="${i}">Delete</button></div></div>`).join('') || '<p class="note small muted">None yet. Load a file where your team has quick plays set and save them here.</p>'}
      </div></fieldset>
      <fieldset class="frame ${sch >= 2 ? '' : 'plan-locked'}"><legend>Scoring Options${sch >= 2 ? '' : ' · 🔒 Scheme 2'}</legend><div class="stack">
        ${so.map((o, i) => `<div class="so-row">
          <select class="sel-team" data-change="soPlayer" data-i="${i}" ${sch >= 2 ? '' : 'disabled'}>${rosterIds.has(o.pid) ? '' : '<option selected>Player no longer on the roster</option>'}${t.roster.map(p => opt(o.pid, p)).join('')}</select>
          <div class="so-ctl"><span class="small">Usage</span><button class="btn tiny" data-act="soAdj" data-i="${i}" data-k="usageRate" data-d="-5" ${sch >= 2 && o.usageRate > 5 ? '' : 'disabled'}>−</button><b>${o.usageRate}%</b><button class="btn tiny" data-act="soAdj" data-i="${i}" data-k="usageRate" data-d="5" ${sch >= 2 && o.usageRate < 40 ? '' : 'disabled'}>+</button>
            <span class="small">Focus</span>${[1, 2, 3, 4].map(f => `<button class="btn tiny ${o.focus === f ? 'on focus' : 'off'}" data-act="soFocus" data-i="${i}" data-v="${f}" ${sch >= 2 ? '' : 'disabled'}>${f}</button>`).join('')}
            <button class="btn tiny off" data-act="soRemove" data-i="${i}" ${sch >= 2 ? '' : 'disabled'} aria-label="Remove">✕</button></div></div>`).join('') || '<p class="note small muted">No scoring options set.</p>'}
        ${so.length < 3 && t.roster.length ? `<button class="btn small" data-act="soAdd" ${sch >= 2 ? '' : 'disabled'}>+ Add a scoring option</button>` : ''}
      </div></fieldset>`,
  });
};
actions.savePlaybook = () => {
  const t = myTeam();
  if (!t || !hasPlays(t)) return;
  const books = loadBooks();
  const name = `${t.city} ${t.name} · ${league().season.currentYear}`;
  const i = books.findIndex(b => b.name === name);
  const book = { name, quickPlays: JSON.parse(JSON.stringify(t.quickPlays)) };
  if (i >= 0) books[i] = book; else books.push(book);
  saveBooks(books);
  render();
};
actions.installPlaybook = d => {
  const t = myTeam(), b = loadBooks()[+d.i];
  if (!t || !b || tierNow('scheme') < 1) return;
  t.quickPlays = JSON.parse(JSON.stringify(b.quickPlays));
  state.dirty = true;
  render();
};
actions.deletePlaybook = async d => {
  const books = loadBooks();
  if (!books[+d.i] || !(await confirmBox(`Delete the playbook "${esc(books[+d.i].name)}"?`, 'Delete'))) return;
  books.splice(+d.i, 1);
  saveBooks(books);
  render();
};
const soEdit = fn => { const t = myTeam(); if (!t || tierNow('scheme') < 2) return; fn(t.scoringOptions ||= []); state.dirty = true; render(); };
actions.soAdj = d => soEdit(so => { const o = so[+d.i]; if (o) o[d.k] = Math.max(5, Math.min(40, o[d.k] + +d.d)); });
actions.soFocus = d => soEdit(so => { const o = so[+d.i]; if (o) o.focus = +d.v; });
actions.soRemove = d => soEdit(so => { so.splice(+d.i, 1); });
actions.soAdd = () => soEdit(so => {
  const t = myTeam(), used = new Set(so.map(o => o.pid));
  const p = [...t.roster].sort((a, b) => shownLevel(b) - shownLevel(a)).find(x => !used.has(x.id));
  if (p && so.length < 3) so.push({ pid: p.id, usageRate: [30, 20, 15][so.length], focus: 1, playSelection: 1 });
});
$app.addEventListener('change', e => {
  if (e.target.dataset.change !== 'soPlayer') return;
  soEdit(so => { const o = so[+e.target.dataset.i]; if (o) o.pid = +e.target.value; });
});

// Culture: once per offseason, your players' Locker Room and Loyalty come up
// toward the tier's cap. Recorded so it never stacks.
function applyCulture() {
  const tree = treeStore(), yr = `${league().season.currentYear}:${state.leagueIdx}`, t = tierNow('culture');
  const prev = tree.culture[yr]?.tier || 0;
  if (t <= prev) return;
  const cap = CO.cultureCap(t);
  for (const { p } of tendPlayers()) {
    if (!p.traits) continue;
    for (const k of ['lockerRoom', 'loyalty']) {
      const v = p.traits[k] || 10;
      p.traits[k] = Math.max(v, Math.min(cap, v + t - prev));
    }
  }
  tree.culture[yr] = { tier: t };
  saveTree();
  state.dirty = true;
}

function strengthCard() {
  const st = strengthStore();
  const res = st.results;
  const mine = res ? res.filter(r => isUserTeam(league().teams.find(t => t.id === r.tid))) : [];
  return `<fieldset class="frame"><legend>Strength Program</legend><div class="stack">
    ${res ? `<dl class="info"><dt>Players stronger, faster or fitter</dt><dd class="up">${res.length}</dd><dt>Your players</dt><dd class="up">${mine.length}</dd></dl>
      <button class="btn" data-act="nav" data-to="strength">🏋️ Strength Program Results</button>`
    : `<p class="note small">Young players can add Strength, Speed or Stamina this summer.</p>
      <button class="btn" data-act="nav" data-to="strength">🏋️ Set Focus &amp; Run</button>`}
  </div></fieldset>`;
}

screens.strength = () => {
  const L = league();
  const st = strengthStore();
  const youngMine = L.teams.filter(isUserTeam).flatMap(t => t.roster.filter(p => p.age <= STR_MAX_AGE).map(p => ({ p, t })))
    .sort((a, b) => strengthOdds(b.p) - strengthOdds(a.p));
  const odds = p => { const o = strengthOdds(p); return o >= 0.55 ? ['High', 'up'] : o >= 0.3 ? ['Fair', 'gold'] : ['Low', 'down']; };
  const gainText = r => [...Object.entries(r.gains).map(([k, v]) => `+${v} ${k}`), r.lbs ? `${r.lbs > 0 ? '+' : '−'}${Math.abs(r.lbs)} lb` : '', r.inch ? `+${r.inch} in` : ''].filter(Boolean).join(' · ');
  let body;
  if (!st.results) {
    body = `<p class="note small">Choose what each young player works on this summer.</p>
      <div class="stack">${youngMine.map(({ p }) => {
        const f = focusOf(p, L.teams.find(t => t.roster.includes(p)));
        const [lbl, cls] = odds(p);
        return `<div class="workout"><div class="wk-head"><b>${esc(playerName(p))}</b> ${lvTag(p)}<br><span class="muted small">${esc(posName(p))} · ${p.age}y · ${heightStr(p.ht)} · ${p.wt} lb</span></div>
          <span class="small">Outlook: <b class="${cls}">${lbl}</b> · STR ${p.attributes.STR[0]} · SPD ${p.attributes.SPD[0]} · STM ${p.attributes.STM[0]}</span>
          <div class="opts">${STR_FOCUS.map(([k, l]) => `<button class="btn small ${f === k ? 'on focus' : 'off'}" data-act="strFocus" data-id="${p.id}" data-k="${k}" ${p.attributes[k][0] >= ATTR_MAX ? 'disabled' : ''}>${l}</button>`).join('')}</div></div>`;
      }).join('') || '<p class="note muted">None of your players are young enough for the program.</p>'}</div>`;
  } else {
    const rows = st.results.map(r => ({ r, team: L.teams.find(t => t.id === r.tid), p: L.teams.flatMap(t => t.roster).find(x => x.id === r.pid) })).filter(x => x.p);
    const mine = rows.filter(x => isUserTeam(x.team)), rest = rows.filter(x => !isUserTeam(x.team));
    const row = x => `<div class="drill-row"><span class="grow"><b>${esc(playerName(x.p))}</b> <span class="muted small">${esc(x.team.shortName)} · ${esc(posName(x.p))} · ${x.p.age}y</span></span><b class="small up">${gainText(x.r)}</b></div>`;
    body = `<fieldset class="frame"><legend>Your Players</legend><div class="stack">${mine.map(row).join('') || '<p class="note muted small">No gains for your players this summer.</p>'}</div></fieldset>
      <fieldset class="frame"><legend>Around the League</legend><div class="stack">${rest.map(row).join('') || '<p class="note muted small">None.</p>'}</div></fieldset>`;
  }
  layout({ title: 'Strength Program', body, action: st.results ? null : { act: 'strRun', label: 'Run Program' } });
};
actions.strFocus = d => { strengthStore().focus[+d.id] = d.k; saveStrength(); render(); };
actions.strRun = async () => {
  const st = strengthStore();
  if (st.results) return;
  checkpoint('Strength program');
  st.results = runStrength();
  saveStrength();
  state.dirty = true;
  render();
  const mine = st.results.filter(r => isUserTeam(league().teams.find(t => t.id === r.tid))).length;
  toast('Strength program done', `${st.results.length} players around the league, ${mine} of yours.`);
};

screens.offseason = () => {
  const auto = state.auto[state.leagueIdx];
  const P = state.params;
  const bands = P.ageBands;
  layout({
    title: isCollege() ? 'Summer Development' : 'Training Camp',
    body: `
      ${isCollege() ? '' : mentorCard()}
      <fieldset class="frame"><legend>Off-season Progression</legend>
        <div class="stack">
          ${auto ? `
            <dl class="info tight">
              <dt>Players improved</dt><dd class="up">${auto.players}</dd>
              <dt>Ratings upgrades</dt><dd class="up">+${auto.points}</dd>
              <dt>Your team</dt><dd class="up">+${auto.mine}</dd>
              <dt>Potential ↑</dt><dd class="up">${auto.potUps ?? 0}</dd>
              <dt>Potential ↓</dt><dd class="down">${auto.potDowns ?? 0}</dd>
              <dt>Regression age ↑</dt><dd class="up">${auto.longevity ?? 0}</dd>
              <dt>Regression age ↓</dt><dd class="down">${auto.regDowns ?? 0}</dd>
            </dl>
            <button class="btn focus" data-act="nav" data-to="report">📋 Progression Report</button>
            ${P.commissioner ? '<button class="btn small" data-act="undoAuto">↺ Undo</button>' : ''}`
          : `
            <p class="note"><b>Development coach:</b> players ${bands[bands.length - 1][0]} and under get ratings upgrades, based on youth and usage.</p>
            <p class="note"><b>Trainer:</b> last season's production is weighed against players in the same role and age. Standouts can gain potential, or push their regression age back a year if they're at it (or a year away). Poor seasons and injuries can cost potential or bring regression a year sooner, but never for a player who's already declining.</p>
            <button class="btn big focus" data-act="runAuto">▶ Run Off-season Progression</button>`}
        </div>
      </fieldset>
      ${strengthCard()}
      ${isCollege() ? '' : `<fieldset class="frame"><legend>Trainer</legend><div class="stack">
        <p class="note small">Health, potential and size changes for your players.</p>
        <button class="btn" data-act="nav" data-to="trainer" ${auto && strengthStore().results ? '' : 'disabled'}>🩺 Meet with the Trainer</button></div></fieldset>`}
      ${coachCard()}
      ${contractCard()}
      <button class="btn big ${auto ? 'focus' : ''}" data-act="calDevBack" ${auto ? '' : 'disabled'}>✅ Wrap Up ${isCollege() ? 'Summer Development' : 'Training Camp'}</button>`,
  });
};

// Your draft picks sign first: first-rounders take their scale deal,
// second-rounders get 2 or 4 years at the minimum (team option either way).
function rookieDealsCard() {
  const L = league();
  if (L.season.phase !== PHASE_POST_DRAFT) return '';
  const yr = L.season.currentYear;
  const mine = L.teams.filter(isUserTeam).flatMap(t => t.roster.filter(p => p.history?.draft?.yr === yr && p.history.draft.rd > 0).map(p => ({ p, t })))
    .sort((a, b) => a.p.history.draft.pk - b.p.history.draft.pk);
  if (!mine.length) return '';
  const min = FA.FA_DEFAULTS.minSalary;
  return `<fieldset class="frame"><legend>Rookie Contracts</legend><div class="list">${mine.map(({ p }) => {
    const d = p.history.draft;
    const signed = p.status === 3;
    return `<div class="prow"><span class="name">${esc(playerName(p))} ${lvTag(p)}</span>
      <span class="right small">R${d.rd} · #${d.pk}</span>
      <span class="meta">${signed ? `<span class="up">✍️ $${p.contract.sal}M × ${p.contract.yrs} · TO</span>` : d.rd === 1 ? `Scale deal: $${rookieScale(L, d.pk)}M × 4 · TO` : `$${min}M · TO`}</span>
      ${signed ? '' : `<span class="opt-btns full">${d.rd === 1
        ? `<button class="btn small focus" data-act="rookieSign" data-id="${p.id}" data-y="4">Sign</button>`
        : `<button class="btn small focus" data-act="rookieSign" data-id="${p.id}" data-y="2">2 Years</button><button class="btn small focus" data-act="rookieSign" data-id="${p.id}" data-y="4">4 Years</button>`}</span>`}
    </div>`;
  }).join('')}</div></fieldset>`;
}
actions.rookieSign = d => {
  const L = league();
  const t = L.teams.find(x => x.roster.some(p => p.id === +d.id));
  const p = t?.roster.find(x => x.id === +d.id);
  if (!p || p.status === 3) return;
  signRookie(L, t, p, +d.y, FA.FA_DEFAULTS.minSalary);
  state.dirty = true;
  render();
};

// Summer League step: rookie deals, numbers, then the tournament.
screens.camp = () => {
  const ageDone = !!state.summer[state.leagueIdx] || summerDone();
  layout({
    title: 'Summer League',
    body: `${rookieDealsCard()}${!leagueRookies(league()).length ? '<p class="note">No rookies this year.</p>' : ageDone ? '' : ageSection()}${numbersSection(ageDone || !leagueRookies(league()).length)}${tourSection((ageDone || !leagueRookies(league()).length) && numbersReady())}`,
    action: (ageDone || state.summerTour[state.leagueIdx]) && (state.summerTour[state.leagueIdx]?.stage || 'final') === 'final' ? { act: 'calCampBack', label: 'Wrap Up Summer League' } : null,
  });
};
actions.calCampBack = () => { calFlags().camp = true; state.undo = null; goHome(); toast('Next up: Free Agency'); };
actions.calDevBack = () => {
  if (isCollege()) { calFlags().summer = true; state.undo = null; goHome(); nextUp(); return; }
  calFlags().dev = true; state.undo = null; goHome(); toast('Training camp done. Next up: Media Day.');
};

// Meet with the trainer: your players' health, physicals and what changed.
screens.trainer = () => {
  const L = league();
  const yr = lastSeasonYear();
  const size = new Map((strengthStore().results || []).map(r => [r.pid, r]));
  const body = L.teams.filter(isUserTeam).map(t => {
    const rows = [...t.roster].sort((a, b) => shownLevel(b) - shownLevel(a)).map(p => {
      const snap = snapOf(p);
      const d = diffPlayer(p, snap);
      const h = injuryRisk(p, yr, state.params);
      const status = !h ? ['Healthy', 'up'] : h.cls === 'structural' ? ['Structural', 'down'] : h.cls === 'nagging' ? ['Nagging', 'gold'] : ['Recovered', 'muted'];
      const phys = PHYSICAL.map(k => `${k} ${p.attributes[k][0]}`).join(' · ');
      const sz = size.get(p.id);
      const changes = [
        longevityBadges(p, d, false),
        sz?.lbs ? `<span class="badge ${sz.lbs > 0 ? 'lvl' : ''}">${sz.lbs > 0 ? 'Bulked up' : 'Slimmed down'} ${sz.lbs > 0 ? '+' : '−'}${Math.abs(sz.lbs)} lb</span>` : '',
        sz?.inch ? `<span class="badge new">Grew +${sz.inch} in</span>` : '',
      ].join('');
      return `<div class="trainer-row">
        <div class="tr-top"><b>${esc(playerName(p))}</b> ${lvTag(p)}<span class="badge ${status[1] === 'up' ? 'lvl' : status[1] === 'down' ? 'down-b' : ''}">${status[0]}</span></div>
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

// Rookies' ratings after the draft dip: older rookies get part of it back.
// Runs as the draft finishes (or here, for a save drafted in the game).
function ageAdjust() {
  const bands = state.params.recoveryBands;
  const orig = loadOriginals();
  let players = 0, points = 0;
  for (const r of summerEligible()) {
    const g = applySummerLeague(r.p, orig[r.p.id], bands);
    const n = Object.values(g).reduce((a, b) => a + b, 0);
    if (n) { players++; points += n; }
  }
  state.summer[state.leagueIdx] = { players, points };
  state.dirty = true;
  return { players, points };
}
actions.runSummer = async () => {
  const { players, points } = ageAdjust();
  state.compCache = {};
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
  return `<fieldset class="frame"><legend>Age Adjustment</legend><div class="stack">${body}</div></fieldset>`;
}

// Step 2: your rookies pick their numbers, from a wall of every number with
// teammates' and retired ones taken. Their college number is marked.
const myRookies = () => leagueRookies(league()).filter(r => r.team && isUserTeam(r.team));
const numsState = () => (state.rookieNums[state.leagueIdx] ||= { locked: false, picks: {} });
const numbersReady = () => !myRookies().length || numsState().locked || !!state.summerTour[state.leagueIdx];
// The number on the player's last college stint.
function collegeNumber(p) {
  const s = (p.stats || []).filter(x => x.league > 0 && state.data.seasonLeagues[x.league]?.leagueType !== 0)
    .sort((a, b) => a.yr - b.yr).pop();
  const row = s?.season?.[s.season.length - 1];
  return row && row.num >= 0 ? row.num : null;
}
// Team's full name for the draft screens: city + name (teams saved without
// a city fall back to their name).
const teamFull = t => (t ? (t.city ? `${t.city} ${t.name}` : t.name || t.shortName || '').trim() : '');
const teamTint = t => {
  const [c1, c2] = (t.teamColors || []).map(c => /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : null);
  return c1 ? `--tc1:${c1};--tc2:${c2 || c1}` : '';
};
const jersey = (t, n, cls = '') => `<span class="jersey ${cls}" style="${teamTint(t)}"><span>${n}</span></span>`;
function setRookieNumber(p, team, n) {
  const ns = numsState();
  if (!(p.id in ns.picks)) ns.picks[p.id] = p.num;
  p.num = n;
  // The new season's stats row carries the number too.
  const row = (p.stats || []).filter(s => s.yr === league().season.currentYear).pop();
  const stint = row?.season?.[row.season.length - 1];
  if (stint && !stint.GP && stint.tid === team.id) stint.num = n;
  state.dirty = true;
}
function numberWall(r) {
  const t = r.team, p = r.p, col = collegeNumber(p);
  const mates = new Map(t.roster.filter(x => x !== p).map(x => [x.num, x]));
  const retired = new Set((t.retiredNumbers || []).map(x => x.num));
  const tiles = [];
  for (let n = 0; n <= 99; n++) {
    const mate = mates.get(n), ret = retired.has(n);
    const cls = [n === p.num ? 'cur' : '', n === col ? 'col' : '', mate || ret ? 'taken' : ''].join(' ');
    tiles.push(`<button class="nw-tile ${cls}" style="${teamTint(t)}" data-act="pickNumber" data-id="${p.id}" data-n="${n}" ${mate || ret ? 'disabled' : ''}>
      <b>${n}</b><span>${ret ? 'Retired' : mate ? esc(mate.ln) : n === col ? 'College' : ''}</span></button>`);
  }
  return `<div class="nw-wall">${tiles.join('')}</div>`;
}
function numbersSection(ready) {
  const mine = myRookies();
  if (!mine.length) return '';
  const ns = numsState();
  const locked = ns.locked || !!state.summerTour[state.leagueIdx];
  let body;
  if (!ready) body = '<p class="note muted">Run the age adjustment first.</p>';
  else {
    body = `${locked ? '' : '<p class="note">Before they head to Vegas, your rookies pick their numbers. Gold marks the number they wore in college; teammates\' numbers and retired jerseys are off the wall.</p>'}
      <div class="stack">${mine.map(r => {
        const col = collegeNumber(r.p);
        const open = !locked && state.numPick === r.p.id;
        const colFree = col != null && col !== r.p.num && !r.team.roster.some(x => x !== r.p && x.num === col) && !(r.team.retiredNumbers || []).some(x => x.num === col);
        return `<div class="nw-row">
          ${jersey(r.team, r.p.num)}
          <span class="grow"><b>${esc(playerName(r.p))}</b><br><span class="muted small">${esc(r.team.shortName)} · ${esc(posName(r.p))}${col != null ? ` · Wore <span class="gold">#${col}</span> in college` : ''}</span></span>
          ${locked ? '' : `<button class="btn small ${open ? 'on' : ''}" data-act="openWall" data-id="${r.p.id}">${open ? 'Close' : '👕 Pick'}</button>`}
        </div>
        ${open ? `${colFree ? `<button class="btn small focus" data-act="pickNumber" data-id="${r.p.id}" data-n="${col}">Keep college #${col}</button>` : ''}${numberWall(r)}` : ''}`;
      }).join('')}</div>
      ${locked ? '<p class="note small up">Numbers locked in.</p>' : '<button class="btn focus" data-act="lockNumbers">✅ Lock In Numbers</button>'}`;
  }
  return `<fieldset class="frame"><legend>Rookie Numbers</legend><div class="stack">${body}</div></fieldset>`;
}
actions.openWall = d => { state.numPick = state.numPick === +d.id ? null : +d.id; render(); };
actions.pickNumber = d => {
  const r = myRookies().find(x => x.p.id === +d.id);
  if (!r) return;
  setRookieNumber(r.p, r.team, +d.n);
  state.numPick = null;
  render();
  toast(`${playerName(r.p)} will wear #${d.n}`);
};
actions.lockNumbers = () => { numsState().locked = true; state.numPick = null; state.dirty = true; render(); };

// Step 3: the summer league tournament: pool play sets a Final Four, then
// the semifinals, then the championship (your team gets a small boost for
// reaching the final).
// `reveal`: cells start hidden and the running score (the F column) climbs
// quarter by quarter; the winner is only marked at the end.
function boxScore(L, g, reveal = false) {
  const [a, b] = g.teams.map(id => L.teams.find(x => x.id === id));
  const sum = q => q.reduce((x, y) => x + y, 0);
  const heads = g.quarters[0].map((_, i) => i < 4 ? `Q${i + 1}` : i === 4 ? 'OT' : `${i - 3}OT`);
  const run = q => q.map((_, i) => sum(q.slice(0, i + 1))).join(',');
  return `<div class="box-score ${reveal ? 'reveal' : ''}" style="--cols:${heads.length}">
    <span></span>${heads.map((h, i) => `<span class="muted"${reveal ? ` data-q="${i}"` : ''}>${h}</span>`).join('')}<span class="muted">F</span>
    ${[a, b].map((tm, k) => `<span class="bs-team ${tm.id === g.winner ? 'win' : ''}"${reveal ? ' data-final' : ''}>${logoImg(tm)}${esc(tm.shortName)}</span>${g.quarters[k].map((v, i) => `<span${reveal ? ` data-q="${i}"` : ''}>${v}</span>`).join('')}<b class="${tm.id === g.winner ? 'gold' : ''}"${reveal ? ` data-run="${run(g.quarters[k])}" data-final` : ''}>${reveal ? '0' : sum(g.quarters[k])}</b>`).join('')}
  </div>`;
}
function tourSection(ready) {
  const L = league();
  const t = state.summerTour[state.leagueIdx];
  let body;
  if (!t) {
    body = ready
      ? `<p class="note">Every team's rookies and young core head to Las Vegas. Reach the championship and your young players earn XP; win it all for even more.</p>
        <button class="btn big focus" data-act="runTour">🏀 Sim Summer League</button>`
      : `<p class="note muted">${myRookies().length ? 'Lock in your rookies\' numbers first.' : 'Run the age adjustment first.'}</p>`;
  } else {
    const r = t.result;
    const team = id => L.teams.find(x => x.id === id);
    const champ = team(r.final.winner);
    const mvpTeam = team(r.mvp?.tid);
    const anim = !!state.summerReveal;
    // Pool play flies by (just for show), then the championship quarter by
    // quarter, then the MVP announcement.
    const ticker = anim ? `<div class="sl-ticker"><p class="note small muted">Simulating Las Vegas…</p><div class="sl-games">${tickerGames(L, r).map(g => `<div class="sl-game">${esc(g[0].shortName)} <b>${g[2]}</b> – <b>${g[3]}</b> ${esc(g[1].shortName)}</div>`).join('')}</div></div>` : '';
    body = `${ticker}
      <div class="sl-final ${anim ? 'pending' : ''}">
        <p class="note small muted">Championship</p>${boxScore(L, r.final, anim)}
        <p class="note sl-champ">🏆 <b>${esc(champ.city)} ${esc(champ.name)}</b> win the Summer League title.</p>
      </div>
      ${r.mvp ? `<div class="sl-mvp ${anim ? 'pending' : ''}"><p class="note small muted">Summer League MVP</p>
        <div class="mvp-card">${logoImg(mvpTeam)}<span class="grow"><b>${esc(mvpName(L, r.mvp))}</b> <span class="muted small">${esc(mvpTeam.shortName)}</span><br><span class="small">${r.mvp.ppg} PPG · ${r.mvp.rpg} RPG · ${r.mvp.apg} APG</span></span></div></div>` : ''}
      ${t.reward.length ? `<p class="note small up sl-reward ${anim ? 'pending' : ''}">${t.reward.map(x => `${esc(playerName(x.p))} ${Object.keys(x.gains).map(k => `${k} +1`).join(', ')}`).join(' · ')}</p>` : ''}`;
  }
  return `<fieldset class="frame"><legend>Summer League</legend><div class="stack">${body}</div></fieldset>`;
}

// Made-up pool-play scores for the sim animation (fixed per season).
function tickerGames(L, r) {
  const rng = mulberry32((r.seed ^ 0x7a11) >>> 0);
  const teams = L.teams;
  const out = [];
  for (let i = 0; i < 24; i++) {
    const a = teams[Math.floor(rng() * teams.length)];
    let b = teams[Math.floor(rng() * teams.length)];
    if (b === a) b = teams[(teams.indexOf(a) + 1) % teams.length];
    out.push([a, b, 68 + Math.floor(rng() * 30), 68 + Math.floor(rng() * 30)]);
  }
  return out;
}

async function revealSummer() {
  const root = $app.querySelector('.sl-final');
  if (!root) return;
  const wait = ms => new Promise(res => setTimeout(res, ms));
  const done = $app.querySelector('.bottom');
  if (done) done.style.visibility = 'hidden';
  // 1. Pool play scrolls by.
  const ticker = $app.querySelector('.sl-ticker');
  const games = ticker ? [...ticker.querySelectorAll('.sl-game')] : [];
  ticker?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  for (const g of games) { if (!g.isConnected) return; g.classList.add('shown'); g.scrollIntoView({ block: 'nearest' }); await wait(95); }
  await wait(400);
  if (ticker) { ticker.classList.add('gone'); await wait(350); ticker.remove(); }
  // 2. The championship, a quarter at a time.
  root.classList.remove('pending');
  root.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const cols = +(root.querySelector('.box-score')?.style.getPropertyValue('--cols') || 4);
  for (let q = 0; q < cols; q++) {
    await wait(750);
    root.querySelectorAll(`[data-q="${q}"]`).forEach(c => c.classList.add('shown'));
    root.querySelectorAll('[data-run]').forEach(c => { c.textContent = c.dataset.run.split(',')[q]; c.classList.add('shown'); });
  }
  await wait(700);
  root.querySelectorAll('[data-final]').forEach(c => c.classList.add('shown'));
  root.querySelector('.sl-champ')?.classList.add('shown');
  // 3. The MVP: a mystery card, then the big reveal.
  const mvp = $app.querySelector('.sl-mvp');
  if (mvp) {
    await wait(1400);
    mvp.classList.remove('pending');
    mvp.classList.add('tease');
    mvp.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await wait(2200);
    mvp.classList.remove('tease');
    mvp.classList.add('reveal');
  }
  await wait(900);
  $app.querySelector('.sl-reward')?.classList.remove('pending');
  if (done) { done.style.visibility = ''; done.classList.add('fade-in'); }
  const t = state.summerTour[state.leagueIdx];
  const L = league();
  const champ = L.teams.find(x => x.id === t.result.final.winner);
  const mine = t.result.final.teams.map(id => L.teams.find(x => x.id === id)).find(isUserTeam);
  toast(`🏆 ${champ.shortName} win Summer League`, mine ? (mine === champ ? 'Your rookies earned a boost!' : 'You reached the championship.') : '');
}

actions.runTour = () => {
  const L = league();
  const li = state.leagueIdx;
  if (state.summerTour[li]) return;
  const result = runSummerLeague(L, state.data.seasonLeagues, Math.floor(Math.random() * 1e9) >>> 0);
  const mine = result.final.teams.map(id => L.teams.find(x => x.id === id)).find(isUserTeam);
  const reward = mine ? summerReward(L, mine, mine.id === result.final.winner, result.seed) : [];
  state.summerTour[li] = { result, stage: 'final', reward };
  numsState().locked = true;
  state.compCache = {};
  state.dirty = true;
  state.summerReveal = true;
  render();
  state.summerReveal = false;
  revealSummer();
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
    body: `<img class="hero" src="icons/hero-mentor.jpg" alt=""><p class="note muted small">Tap a skill to have the veteran teach it. Skills are listed best fit first for the young player.</p>${body}`,
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
          <span class="right">${lvTag(r.p, 'gold')}<br>${award ? `<span class="up">+${award} upgrade pts</span>` : '<span class="muted">—</span>'}</span>
          <span class="meta">${r.team ? esc(r.team.shortName) : 'Undrafted'} · ${r.round ? `R${r.round}` : 'FA'} · ${esc(POSITIONS[r.p.pos] ?? '')} · ${r.p.age}y · ${heightStr(r.p.ht)}</span>
          ${d.points ? `<span class="chg">Age adjustment <span class="up">+${d.points}</span></span>` : ''}
        </button>`;
      }).join('')}</div>`,
  });
};

// ---------------------------------------------------------------------------
// Bump report (all teams)

// Stars for a player's current level (Lv 100 = 5, 93 = 4.5, 86 = 4).
const levelStars = p => Math.max(1, Math.min(10, Math.round((5 - (100 - shownLevel(p)) / 14) * 2)));
// Declining players (past their regression age) lose the stars they've
// slipped below: potential shows no higher than where they are now.
// Potential stars; a declining player's show what age has taken in red:
// 14 rating points (the 12 skill ratings) = half a star.
function regPoints(p) {
  if (!declining(p)) return 0;
  return SKILL_ATTRS.reduce((a, k) => a + Math.max(0, p.attributes[k][0] - regressed(p, k)), 0);
}
// Stars from a 12-skill rating total: 168 = 5 stars, 14 points = half a
// star (not capped at Lv 100, so a star past 168 still shows his decline).
const totalOf = (p, f) => SKILL_ATTRS.reduce((a, k) => a + f(k), 0);
const starsOfTotal = t => 5 - (168 - t) / 28;
const potStars = p => stars(p.pot,
  starsOfTotal(totalOf(p, k => regressed(p, k))),
  starsOfTotal(totalOf(p, k => p.attributes[k][0])));
const levelStarsOf = lv => Math.max(1, Math.min(10, Math.round((5 - (100 - lv) / 14) * 2)));

// Level as the game shows it (from the regressed ratings).
function shownLevel(p) {
  if (!declining(p)) return levelOf(p);
  return levelOf({ pot: p.pot, attributes: Object.fromEntries(ATTRS.map(k => [k, [regressed(p, k), p.attributes[k][1]]])) });
}
// "Lv 84" for lists: red while declining.
const lvTag = (p, cls = 'gold small') => declining(p) ? `<span class="${cls.replace('gold', '')} down">Lv ${shownLevel(p)}</span>` : `<span class="${cls}">Lv ${levelOf(p)}</span>`;

screens.report = (args) => {
  const L = league();
  const groups = [
    ...L.teams.filter(isUserTeam),
    ...L.teams.filter(t => !isUserTeam(t)),
  ].map(t => ({ team: t, title: `${t.city} ${t.name}`, players: t.roster }));
  if (state.params.includeFreeAgents && L.freeAgents?.length) groups.push({ team: null, title: 'Free Agents', players: L.freeAgents });
  const gi = ((args.g ?? 0) % groups.length + groups.length) % groups.length;
  const g = groups[gi];
  const rows = g.players.map(p => ({ p, d: diffPlayer(p, snapOf(p)) })).sort((a, b) => shownLevel(b.p) - shownLevel(a.p) || a.p.age - b.p.age);
  const improved = rows.filter(r => awardOf(r.p));
  const total = rows.reduce((a, r) => a + awardOf(r.p), 0);
  const count = f => rows.filter(f).length;
  const summary = [
    `${improved.length} improved <span class="up">+${total}</span>`,
    count(r => r.d.potDelta > 0) && `<span class="up">Potential ↑ ${count(r => r.d.potDelta > 0)}</span>`,
    count(r => r.d.potDelta < 0) && `<span class="down">Potential ↓ ${count(r => r.d.potDelta < 0)}</span>`,
    count(r => r.d.regDelta > 0) && `<span class="up">Regression age ↑ ${count(r => r.d.regDelta > 0)}</span>`,
    count(r => r.d.regDelta < 0) && `<span class="down">Regression age ↓ ${count(r => r.d.regDelta < 0)}</span>`,
  ].filter(Boolean).join(' · ');
  layout({
    title: 'Progression Report',
    body: `
      <div class="tsel report-nav">
        <button class="tsel-arrow" data-act="reportNav" data-g="${gi - 1}" aria-label="Previous team">◀</button>
        <span class="tsel-team ${isUserTeam(g.team) ? 'mine' : ''}"><span class="tsel-name"><b class="full-name">${esc(g.title)}</b></span></span>
        <button class="tsel-arrow" data-act="reportNav" data-g="${gi + 1}" aria-label="Next team">▶</button>
      </div>
      <p class="note small" style="margin:10px 0">${summary}</p>
      <div class="list">${rows.map(({ p, d }) => reportRow(p, d)).join('')}</div>`,
  });
};

// One player in the progression report (read-only).
function reportRow(p, d) {
  const ups = Object.entries(d.attrs).map(([k, v]) => `<span class="${v > 0 ? 'up' : 'down'}">${k} ${v > 0 ? '+' : ''}${v}</span>`).join(' ');
  return `<div class="prow rrow">
    <span class="name full">${esc(playerName(p))} ${lvTag(p)}</span>
    <span class="stars-line">${potStars(p)}</span>
    <span class="meta">${esc(posName(p))} · ${p.age}y · ${heightStr(p.ht)} · ${p.wt} lb · ${p.yrs ? `${p.yrs} yr${p.yrs > 1 ? 's' : ''} exp` : 'Rookie'}</span>
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
  const award = awardOf(p);
  const detail = [apSummary(d), d.points ? changeSummary(d) : ''].filter(Boolean).join(' · ');
  return `<button class="prow" data-act="openPlayer" data-id="${p.id}">
    <span class="name">${esc(playerName(p))} ${lvTag(p, 'small')}</span>
    <span class="right">
      <span class="stars">${potStars(p)}</span><br>
      ${award ? `<span class="up">+${award}${state.params.bumpMode === 'train' ? '' : ' pts'}</span>` : '<span class="muted">—</span>'}
    </span>
    <span class="meta">${esc(pos)} · ${p.age}y · ${heightStr(p.ht)} · ${p.wt} lb</span>
    ${d.changed ? `<span class="chg">${esc(detail)} ${skillBadges(d)}${longevityBadges(p, d)}</span>` : ''}
  </button>`;
}

function injuryBadge(p) {
  const r = injuryRisk(p, lastSeasonYear(), state.params);
  return r ? `<span class="badge down-b">${esc(injuryName(r.worst))} · ${r.cls}</span>` : '';
}

// Regression age (raw, as the trainer shows it); a player who was already
// regressing and earned a year back has paused it.
const POT_WHY = { injury: 'injury', production: 'production down', minutes: 'barely played', development: 'low usage' };
function longevityBadges(p, d, injury = true) {
  const was = p.regressionAge - d.regDelta;
  const paused = d.regDelta > 0 && p.age > was;
  const why = POT_WHY[state.potWhy?.get(p.id)];
  return (d.regDelta ? `<span class="badge ${d.regDelta > 0 ? 'lvl' : 'down-b'}">${paused ? 'Regression paused' : `Regression age ${was}→${p.regressionAge}`}</span>` : '') +
    (d.potDelta > 0 ? '<span class="badge new">POT ▲</span>' : d.potDelta < 0 ? `<span class="badge down-b">POT ▼${why ? ` · ${why}` : ''}</span>` : '') +
    (injury ? injuryBadge(p) : '');
}

actions.openPlayer = d => go('player', { id: +d.id });

// ---------------------------------------------------------------------------
// Your team roster

screens.roster = (args) => {
  const L = league();
  const mine = L.teams;
  if (!mine.length) { replace('teams'); return; }
  let idx = mine.findIndex(t => t.id === +args.arg);
  if (idx < 0) idx = Math.max(0, mine.findIndex(isUserTeam));
  const t = mine[idx];
  const others = !isUserTeam(t);
  const rows = t.roster.map(p => ({ p, d: diffPlayer(p, snapOf(p)) })).sort((a, b) => shownLevel(b.p) - shownLevel(a.p));
  const pts = rows.reduce((a, r) => a + r.d.apDelta.reduce((x, y) => x + y, 0), 0);
  const many = mine.length > 1;
  const prevT = mine[(idx - 1 + mine.length) % mine.length];
  const nextT = mine[(idx + 1) % mine.length];
  layout({
    title: others ? t.shortName : 'My Team',
    left: many ? `<button class="nav-btn" data-act="nav" data-replace="1" data-to="roster" data-arg="${prevT.id}" aria-label="Previous team">${logoImg(prevT)}◀</button>` : '',
    right: many ? `<button class="nav-btn" data-act="nav" data-replace="1" data-to="roster" data-arg="${nextT.id}" aria-label="Next team">▶${logoImg(nextT)}</button>` : '',
    body: `
      <h2 class="team-title">${logoImg(t)}${esc(t.city)} ${esc(t.name)}</h2>
      ${others ? '' : `<p class="note">${state.auto[state.leagueIdx] ? `Offseason points added: <span class="up">+${pts}</span>. Tap a player to adjust.` : 'Run the offseason bump first, or tap a player to add points by hand.'}</p>`}
      <div class="list">${rows.map(({ p, d }) => playerRow(p, d)).join('')}</div>
      ${movesBox(L, t)}`,
  });
};

// Everyone who joined or left a team since last season, judged by the team on
// each player's last stats line.
function teamMoves(L, t) {
  const yr = lastYear(), cur = L.season.currentYear, li = state.leagueIdx;
  const line = p => seasonLine(p, li, yr);
  const nameOf = id => L.teams.find(x => x.id === id)?.shortName;
  const rookie = p => p.history?.draft?.yr === cur || p.history?.yearDeclared === cur;
  const ins = [], outs = [];
  for (const p of t.roster) {
    const l = line(p);
    if (l && l.tid === t.id) continue;
    ins.push({ p, from: rookie(p) ? 'Draft' : l ? (nameOf(l.tid) || 'Free agency') : 'Signed' });
  }
  const pool = [...L.teams.filter(x => x !== t).flatMap(x => x.roster.map(p => ({ p, to: x.shortName }))), ...(L.freeAgents || []).map(p => ({ p, to: 'Free agency' }))];
  for (const { p, to } of pool) if (line(p)?.tid === t.id) outs.push({ p, to });
  const byLv = (a, b) => shownLevel(b.p) - shownLevel(a.p);
  return { ins: ins.sort(byLv), outs: outs.sort(byLv) };
}
function movesBox(L, t) {
  const { ins, outs } = teamMoves(L, t);
  const row = (p, tag, arrow) => `<div class="small" style="display:flex;justify-content:space-between;gap:8px"><span>${esc(playerName(p))} <span class="gold">Lv ${shownLevel(p)}</span> <span class="muted">${esc(posName(p))} · ${p.age}y</span></span><span class="muted">${arrow} ${esc(tag)}${arrow === '←' ? ` · $${p.contract.sal}M × ${p.contract.yrs}` : ''}</span></div>`;
  return `<details class="frame" style="margin-top:10px" ${state.movesOpen ? 'open' : ''}><summary data-act="movesToggle"><b>Moves</b> <span class="small muted">In ${ins.length} · Out ${outs.length}</span></summary>
    <p class="note small" style="margin-top:6px"><b>In</b></p>${ins.map(m => row(m.p, m.from, '←')).join('') || '<span class="small muted">None</span>'}
    <p class="note small" style="margin-top:6px"><b>Out</b></p>${outs.map(m => row(m.p, m.to, '→')).join('') || '<span class="small muted">None</span>'}
  </details>`;
}
actions.movesToggle = () => { state.movesOpen = !state.movesOpen; replace('roster', state.stack[state.stack.length - 1].args); };

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
    cache.set(key, { ranks, of: q.length, minGp: Math.ceil(minGp), maxGp: Math.max(...rows.map(r => r.gp), 0) });
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
function rankBox(p, mpg = null) {
  const yr = lastSeasonYear();
  const { ranks, of } = seasonRanks(yr);
  const r = ranks.get(p.id);
  if (!r) return '';
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  return `<fieldset class="frame"><legend>${yr} Season</legend>
    ${mpg ? `<p class="note small muted center" style="margin-bottom:6px">${mpg.mpg.toFixed(1)} MPG in ${mpg.gp} games</p>` : ''}
    <div class="statline rank-line">${RANK_STATS.map(([k, name]) => {
      const n = r.rank[k];
      return `<button class="stat-cell" data-act="openLeaders" data-m="stats" data-k="${k}" aria-label="${name} leaders"><span class="muted small">${k}</span><b>${r.pg[k].toFixed(1)}</b><span class="small ${n && n <= 10 ? 'gold' : n && n <= 30 ? 'up' : 'muted'}">${n ? ord(n) : '—'}</span></button>`;
    }).join('')}</div>
    <p class="note muted small" style="margin-top:6px">${r.qualified ? `League rank among ${of} qualified players.` : `${r.gp} games: not enough to be ranked.`}</p>
  </fieldset>`;
}

// ---------------------------------------------------------------------------
// League: every player, sorted by a counting stat (last season, qualified
// players) or by a rating. Highest first; ties go to the higher level.

screens.leaders = (args) => {
  if (args.m === 'college') return collegeLeaders(args);
  const L = league();
  const mode = args.m === 'stats' ? 'stats' : 'ratings';
  const all = leaguePlayers(L, true);
  const tname = e => (e.team ? e.team.shortName : 'FA');
  let rows, k, head, note;
  if (mode === 'stats') {
    k = RANK_STATS.some(([x]) => x === args.k) ? args.k : 'PTS';
    const yr = lastSeasonYear();
    const { ranks, of, minGp } = seasonRanks(yr);
    rows = all.map(e => ({ e, r: ranks.get(e.p.id) })).filter(x => x.r?.qualified)
      .map(x => ({ ...x, v: x.r.pg[k], lv: shownLevel(x.e.p) }))
      .sort((a, b) => b.v - a.v || b.lv - a.lv);
    head = RANK_STATS.map(([x]) => `<button class="btn small ${x === k ? 'on focus' : 'off'}" data-act="openLeaders" data-m="stats" data-k="${x}" data-r="1">${x}</button>`).join('');
    note = `${yr} season, per game. ${of} qualified players (at least ${minGp} games).`;
  } else {
    k = ATTRS.includes(args.k) ? args.k : 'LAY';
    rows = all.map(e => ({ e, v: regressed(e.p, k), core: e.p.attributes[k][0], lv: shownLevel(e.p) })).sort((a, b) => b.v - a.v || b.lv - a.lv);
    head = ATTRS.map(x => `<button class="btn small ${x === k ? 'on focus' : 'off'} ${RATING_GROUP[x] ? `sk-${RATING_GROUP[x]}` : ''}" data-act="openLeaders" data-m="ratings" data-k="${x}" data-r="1">${x}</button>`).join('');
    note = `${ATTR_NAMES[k]}: every player in the league and free agency. Ties go to the higher level.`;
  }
  const shown = args.all ? rows : rows.slice(0, 25);
  const fmt = v => (mode === 'stats' ? v.toFixed(1) : v);
  layout({
    title: 'League',
    body: `<div class="tabs"><button class="btn ${mode === 'stats' ? 'on focus' : 'off'}" data-act="openLeaders" data-m="stats" data-k="${mode === 'stats' ? k : 'PTS'}" data-r="1">Stats</button><button class="btn ${mode === 'ratings' ? 'on focus' : 'off'}" data-act="openLeaders" data-m="ratings" data-k="${mode === 'ratings' ? k : 'LAY'}" data-r="1">Ratings</button></div>
      <div class="opts wrap ld-keys">${head}</div>
      <p class="note muted small" style="margin:6px 0">${esc(note)}</p>
      <div class="stack">${shown.map((x, i) => `<button class="ld-row ${x.e.team && isUserTeam(x.e.team) ? 'mine' : ''}" data-act="openPlayer" data-id="${x.e.p.id}">
        <span class="ld-n">${i + 1}</span>
        <span class="grow"><b>${esc(playerName(x.e.p))}</b> ${lvTag(x.e.p)}<br><span class="small muted">${esc(tname(x.e))} · ${esc(posName(x.e.p))} · ${x.e.p.age}y</span></span>
        <b class="ld-v ${x.core != null && x.v < x.core ? 'down' : ''}">${fmt(x.v)}</b></button>`).join('')}</div>
      ${!args.all && rows.length > 25 ? `<button class="btn small" data-act="leadersAll" style="margin-top:8px">Show all ${rows.length}</button>` : ''}`,
  });
};
// College leaders: one college league's season (its players plus this
// year's draft class), qualified players only, sortable by the five stats.
function collegeLeaders(args) {
  const li = +args.li, yr = +args.yr;
  const CL = state.data.seasonLeagues[li];
  const k = RANK_STATS.some(([x]) => x === args.k) ? args.k : 'PTS';
  const { ranks, of, minGp } = seasonRanks(yr, li);
  const pool = new Map();
  for (const { p } of leaguePlayers(CL, true)) pool.set(p.id, p);
  for (const p of league().draftClass || []) pool.set(p.id, p);
  const prospects = new Set((league().draftClass || []).map(p => p.id));
  const teamOf = p => {
    const st = (p.stats || []).find(x => x.league === li && x.yr === yr);
    const tid = st?.season?.[st.season.length - 1]?.tid;
    const t = CL.teams.find(x => x.id === tid);
    return t ? (t.shortName || t.name) : '';
  };
  const rows = [...ranks].filter(([, r]) => r.qualified).map(([id, r]) => ({ p: pool.get(id), r }))
    .filter(x => x.p).map(x => ({ ...x, v: x.r.pg[k], lv: shownLevel(x.p) }))
    .sort((a, b) => b.v - a.v || b.lv - a.lv);
  const shown = args.all ? rows : rows.slice(0, 25);
  layout({
    title: 'College',
    body: `<p class="note small"><b>${esc(CL.leagueName || CL.shortName)}</b> · ${yr} season</p>
      <div class="opts wrap ld-keys">${RANK_STATS.map(([x]) => `<button class="btn small ${x === k ? 'on focus' : 'off'}" data-act="openLeaders" data-m="college" data-k="${x}" data-li="${li}" data-yr="${yr}" data-r="1">${x}</button>`).join('')}</div>
      <p class="note muted small" style="margin:6px 0">Per game. ${of} qualified players (at least ${minGp} games). Draft prospects open their scouting page.</p>
      <div class="stack">${shown.map((x, i) => {
        const pro = prospects.has(x.p.id);
        const tag = pro ? 'button' : 'div';
        return `<${tag} class="ld-row ${pro ? '' : 'static'}" ${pro ? `data-act="openProspect" data-id="${x.p.id}"` : ''}>
        <span class="ld-n">${i + 1}</span>
        <span class="grow"><b>${esc(playerName(x.p))}</b>${pro ? ' <span class="badge need">Prospect</span>' : ''}<br><span class="small muted">${esc(teamOf(x.p))} · ${esc(posName(x.p))} · ${x.p.age}y · ${classYear(x.p)}</span></span>
        <b class="ld-v">${x.v.toFixed(1)}</b></${tag}>`;
      }).join('')}</div>
      ${!args.all && rows.length > 25 ? `<button class="btn small" data-act="leadersAll" style="margin-top:8px">Show all ${rows.length}</button>` : ''}`,
  });
}

actions.openLeaders = d => {
  const args = { m: d.m, k: d.k, ...(d.li != null ? { li: +d.li, yr: +d.yr } : {}) };
  if (d.r) replace('leaders', args); else go('leaders', args);
};
actions.leadersAll = () => { const a = state.stack[state.stack.length - 1].args || {}; replace('leaders', { ...a, all: true }); };

const ordN = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
// Identity tags for the top of a profile: his play-style tags and the ends of his personality (Leader, Ironman, ...).
function identityChips(p) {
  const chips = [];
  for (const x of playStyles(p, 3)) chips.push(`<span class="style-chip">${x.icon} ${esc(x.label)}</span>`);
  if (traitsSet(p)) for (const t of TRAITS) { const x = traitTag(t, p.traits[t.k] || 0); if (x) chips.push(`<span class="style-chip">${x.icon} ${esc(x.label)}</span>`); }
  return chips.join('');
}
// His place in the league: level rank overall and on his team (cached per league).
function levelRanks(p, team) {
  const cache = (state.compCache[state.leagueIdx] ||= new Map());
  if (!cache.has('lvranks')) {
    const all = leaguePlayers(league(), true).filter(e => e.team).map(e => ({ id: e.p.id, tid: e.team.id, lv: shownLevel(e.p) })).sort((a, b) => b.lv - a.lv);
    const byTeam = new Map();
    cache.set('lvranks', new Map(all.map((e, i) => { const n = (byTeam.get(e.tid) || 0) + 1; byTeam.set(e.tid, n); return [e.id, { league: i + 1, team: n, of: all.length }]; })));
  }
  return cache.get('lvranks').get(p.id) || null;
}
// A short scouting paragraph: where he stands, how he plays, what he's like, where he's headed, what he's paid.
function profileReport(p, team) {
  const out = [];
  const lv = shownLevel(p), rk = levelRanks(p, team);
  if (rk) out.push(`Level ${lv}: ${ordN(rk.league)} in the league and ${ordN(rk.team)} on ${esc(team.shortName)}, ${rk.team <= 5 ? 'a starter' : rk.team <= 9 ? 'a rotation piece' : 'on the fringe of the rotation'}.`);
  else out.push(`Level ${lv}.`);
  if (p.tendencies) {
    out.push(esc(styleLine(p)));
    const sk = earnedSkills(p)[0];
    if (sk) { const w = skillSays(sk.id); out.push(`${esc(w.charAt(0).toUpperCase() + w.slice(1))}.`); }
  }
  if (traitsSet(p)) out.push(esc(personality(p)));
  // Where he's headed
  const y = regressionYear(p), up = tierFor(p.pot);
  const z = bumpContext().production.get(p.id);
  const prod = z == null ? '' : z >= 1.5 ? ' Last season he out-produced his peers by a wide margin.' : z >= 0.5 ? ' Last season he produced above his peers.' : z <= -1.5 ? ' Last season he badly under-produced for his role.' : z <= -0.5 ? ' Last season he produced below his peers.' : '';
  const POT_PHRASE = { Legend: 'an all-time great', 'Hall of Fame': 'a Hall of Famer', Superstar: 'a superstar', 'All-Star': 'an All-Star', 'Quality Starter': 'a quality starter', 'Role Player': 'a role player', 'Rotational Player': 'a rotational player', 'G-League': 'a G-League player' };
  const can = `He has the potential to be ${POT_PHRASE[up] || 'a ' + up}.`;
  const arc = declining(p) ? `He is in decline (age ${p.age}, regression age ${p.regressionAge}).`
    : y >= 0 ? `He is at the age where decline starts (regression age ${p.regressionAge}). ${can}`
    : p.age <= 24 ? `He is still developing. ${can}`
    : `${can} He has ${-y + 1} season${-y + 1 === 1 ? '' : 's'} before decline starts.`;
  out.push(`${arc}${prod}`);
  // What he's paid
  const c = p.contract;
  if (c?.sal && c.yrs) {
    const fair = fairSalary(lv), gap = tagGap(fair);
    out.push(`Paid $${c.sal}M for ${c.yrs} more season${c.yrs > 1 ? 's' : ''}, ${c.sal - fair >= gap ? `above his market value of about $${fair}M` : fair - c.sal >= gap ? `well under his market value of about $${fair}M` : `about his market value ($${fair}M)`}.`);
  }
  return out.join(' ');
}
// Status tags: what's true of him right now (contract, options, injury, trade block, ...).
function playerTags(p) {
  const c = p.contract || {}, t = [];
  const add = (label, cls = '') => t.push(`<span class="badge ${cls}">${label}</span>`);
  if (c.sal && c.yrs) { add(esc(contractText(p))); const v = contractBadge(p).trim(); if (v) t.push(v); }
  if (p.yrs === 0) add('Rookie', 'new');
  if (declining(p)) add('Declining', 'down-b');
  const inj = p.season?.injury?.gamesOut > 0 ? p.season.injury.gamesOut : 0;
  if (inj) add(`Injured · ${inj} g`, 'down-b');
  if (p.status === 4) add('Expiring', 'lvl');
  else if (c.yrs === 1 && c.sal) add('Final Year', 'lvl');
  if (c.opt === 1) add('Team Option');
  if (c.opt === 2) add('Player Option');
  if (c.noTrd) add('No-Trade');
  if (c.ext?.yrs > 0) add(`Extension · $${c.ext.sal}M × ${c.ext.yrs}`, 'new');
  else if (c.canExt) add('Extension Eligible', 'new');
  if (p.season?.onTradeBlock === 1) add('On the Block', 'lvl');
  if (p.season?.onTradeBlock === 2) add('Untouchable', 'you');
  if (p.season && isComplete() && !isCollege()) t.push(moraleTag(p));
  return t.join('');
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
  // Upgrade points: compact rows in the rating colors (no physicals: the
  // game doesn't take points there).
  const apCard = p.season?.ap ? `<fieldset class="frame"><legend>Upgrade Points</legend>
        <div class="ap-grid">
          ${CATEGORIES.filter(c => c.key !== 'PHY').map(c => { const i = CATEGORIES.indexOf(c); return `<div class="ap-row ap-${SKILL_GROUP[c.name] || ''}">
            <span class="grow" title="${esc(c.name)}">${esc(c.name.slice(0, 3).toUpperCase())}</span>
            <button class="mvbtn" data-act="ap" data-i="${i}" data-dir="-1" aria-label="Fewer ${esc(c.name)} points">−</button>
            <b>${p.season.ap[i]}${d.apDelta[i] ? `<span class="small ${d.apDelta[i] > 0 ? 'up' : 'down'}"> ${d.apDelta[i] > 0 ? '+' : ''}${d.apDelta[i]}</span>` : ''}</b>
            <button class="mvbtn" data-act="ap" data-i="${i}" data-dir="1" aria-label="More ${esc(c.name)} points">+</button>
          </div>`; }).join('')}
        </div>
      </fieldset>` : '';
  const tab = ['overview', 'attributes', 'personality', 'stats'].includes(args.tab) ? args.tab : 'overview';
  const trainer = `<fieldset class="frame"><legend>Trainer</legend>
        <div class="stack">
          ${productionText(p)}
          <div class="pts-row">
            <span class="grow">Regression age<br><span class="muted small">${regressionText(p)}</span></span>
            <button class="btn square" data-act="regAge" data-dir="-1" aria-label="Earlier regression">−</button>
            <span class="pts-val ${d.regDelta ? 'gold' : ''}">${p.regressionAge}${d.regDelta ? `<span class="small up"> ${d.regDelta > 0 ? '+' : ''}${d.regDelta}</span>` : ''}</span>
            <button class="btn square" data-act="regAge" data-dir="1" aria-label="Later regression">+</button>
          </div>
          <div class="pts-row">
            <span class="grow">Potential<br><span class="stars">${potStars(p)}</span>${declining(p) ? ' <span class="small down">Declining</span><br>' : ''}${injuryText(p)}</span>
            <button class="btn square" data-act="potAdj" data-dir="-1" aria-label="Lower potential">−</button>
            <span class="pts-val ${d.potDelta ? 'gold' : ''}">${p.pot}${d.potDelta ? `<span class="small up"> ${d.potDelta > 0 ? '+' : ''}${d.potDelta}</span>` : ''}</span>
            <button class="btn square" data-act="potAdj" data-dir="1" aria-label="Higher potential">+</button>
          </div>
        </div>
      </fieldset>`;
  const ratings = `<fieldset class="frame"><legend>Ratings</legend>
        <div class="row" style="justify-content:flex-end;margin-bottom:12px"><button class="btn small ${ceilMode ? 'on focus' : 'off'}" data-act="ceilMode">Edit Ceilings</button></div>
        <div class="stack">
          ${ATTRS.map(k => attrRow(p, snap, k, ceilMode)).join('')}
        </div>
        <p class="note muted small" style="margin-top:10px">Bar = current rating, lighter shade = gained this offseason, white notch = ceiling. Declining players show what the game shows: their peak minus this year's regression (the red number), with the red running up to the peak the save keeps. Raising a rating past its ceiling lifts the ceiling with it.</p>
      </fieldset>`;
  const skills = `<fieldset class="frame"><legend>Skills (${activeSkills(p).length})</legend>
        <div class="stack">
          ${p.skills.map((s, i) => s.level < 1 ? '' : `
            <div class="skill ${ownedOrig.has(s.id) ? '' : 'added'}">
              <div class="sk-line"><span class="sk-name sk-${SKILL_GROUP[skillCategory(s.id)] || ''}">${esc(skillName(s.id))}</span>${isLeveled(s.id) ? ` <span class="gold small">Lv ${s.level}</span>` : ''}</div>
              <div class="ctrls">
                ${isLeveled(s.id) ? `<button class="btn" data-act="skillLv" data-i="${i}" data-dir="-1" aria-label="Level down" ${s.level <= 1 ? 'disabled' : ''}>−</button><button class="btn" data-act="skillLv" data-i="${i}" data-dir="1" aria-label="Level up" ${s.level >= SKILL_MAX_LEVEL ? 'disabled' : ''}>+</button>` : ''}
                <button class="btn" data-act="skillDel" data-i="${i}" aria-label="Remove skill">✕</button>
              </div>
            </div>`).join('')}
          ${activeSkills(p).length ? '' : '<p class="note muted">No skills.</p>'}
          <button class="btn" data-act="addSkill">＋ Add Skill</button>
        </div>
      </fieldset>`;
  const tabsRow = `<div class="tabs pl-tabs">${[['overview', 'Overview'], ['attributes', 'Attributes'], ['personality', 'Personality'], ['stats', 'Stats']].map(([k, l]) => `<button class="btn small ${k === tab ? 'on focus' : 'off'}" data-act="plTab" data-t="${k}">${l}</button>`).join('')}</div>`;
  const personality = (playStyleBox(p) + traitsBox(p)) || '<p class="note muted">Personality isn\'t set for this player yet. Reload the file and it fills in.</p>';
  const content = tab === 'attributes' ? `${ratings}${skills}${apCard}`
    : tab === 'personality' ? personality
    : tab === 'stats' ? statsTab(p, args)
    : `<fieldset class="frame"><legend>Scouting Report</legend>
        <p class="note small scout-p">${profileReport(p, team)}</p>
        ${playerTags(p) ? `<div class="pl-tags">${playerTags(p)}</div>` : ''}
      </fieldset>
      ${rankBox(p, mpg)}${trainer}
      <div class="grid2">
        <button class="btn" data-act="autoOne">🎲 Re-roll Bump</button>
        <button class="btn" data-act="revertOne">↺ Revert</button>
      </div>`;
  layout({
    title: 'Player Profile',
    body: `
      <div>
        <h2 class="team-title pl-name">${esc(playerName(p))} ${lvTag(p, 'gold')}</h2>
        <p class="note">${esc(team ? team.shortName : 'Free Agent')} · ${esc(pos)} · ${p.age} · ${heightStr(p.ht)}, ${p.wt} lb</p>
        <p class="note small pl-meta"><span class="stars">${potStars(p)}</span>${[archName(p) && `<b class="arch">${esc(archName(p))}</b>`, isAllAmerican(p) && '<span class="gold">⭐ All-American</span>'].filter(Boolean).map(x => ` ${x}`).join(' ·')}</p>
        ${identityChips(p) ? `<div class="style-chips pl-chips">${identityChips(p)}</div>` : ''}
      </div>
      ${tabsRow}
      ${content}`,
    action: { act: 'back', label: 'Done' },
  });
};
actions.plTab = d => replace('player', { ...state.stack[state.stack.length - 1].args, tab: d.t });
actions.plStats = d => replace('player', { ...state.stack[state.stack.length - 1].args, sv: d.v });

// Stats tab: season by season, regular season and playoffs, with the highs.
const STAT_COLS = [['GP', r => r.GP], ['MPG', r => r.MIN[0] / 60 / r.GP], ['PTS', r => r.PTS / r.GP], ['REB', r => r.REB / r.GP], ['AST', r => r.AST / r.GP], ['STL', r => r.STL / r.GP], ['BLK', r => r.BLK / r.GP], ['TO', r => r.TO / r.GP],
  ['FG%', r => (r.FGA ? r.FGM / r.FGA * 100 : null)], ['3P%', r => (r.TPA ? r.TPM / r.TPA * 100 : null)], ['FT%', r => (r.FTA ? r.FTM / r.FTA * 100 : null)]];
const sumRows = rows => rows.reduce((t, r) => { for (const k of ['GP', 'GS', 'PTS', 'FGM', 'FGA', 'TPM', 'TPA', 'FTM', 'FTA', 'REB', 'ORB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'DD', 'TD', 'POTG']) t[k] = (t[k] || 0) + (r[k] || 0); t.MIN = [(t.MIN?.[0] || 0) + (r.MIN?.[0] || 0)]; return t; }, {});
function statsTab(p, args) {
  const L = league();
  const sv = args.sv === 'playoffs' ? 'playoffs' : 'season';
  const teamOf = id => L.teams.find(t => t.id === id)?.shortName || '—';
  const years = (p.stats || []).filter(x => x.league === state.leagueIdx);
  const rows = years.flatMap(y => (y[sv] || []).filter(r => r.GP > 0).map(r => ({ yr: y.yr, r })));
  const f = (v, dp = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(dp));
  const line = (label, team, r, cls = '') => `<tr class="${cls}"><td class="yr">${label}</td><td>${team}</td>${STAT_COLS.map(([k, g]) => `<td>${k === 'GP' ? r.GP : f(g(r), k.endsWith('%') ? 1 : 1)}</td>`).join('')}</tr>`;
  const table = rows.length ? `<div class="stat-wrap"><table class="stat-table"><thead><tr><th>Yr</th><th>Tm</th>${STAT_COLS.map(([k]) => `<th>${k}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(({ yr, r }) => line(yr, teamOf(r.tid), r)).join('')}
      ${line('Career', '', sumRows(rows.map(x => x.r)), 'tot')}</tbody></table></div>` : `<p class="note muted">No ${sv === 'playoffs' ? 'playoff' : 'regular season'} games on record.</p>`;
  // Highs: best season averages (20+ games, 5+ in the playoffs), counting stats, and what the game keeps.
  const minGp = sv === 'playoffs' ? 5 : 20;
  const best = rows.filter(x => x.r.GP >= minGp);
  const top = (label, g) => { const x = [...best].sort((a, b) => g(b.r) - g(a.r))[0]; return x ? `<div><span class="muted small">${label}</span><b>${f(g(x.r))}</b><span class="small muted">${x.yr}</span></div>` : ''; };
  const tot = sumRows(rows.map(x => x.r));
  const recs = ['season', 'playoffs', 'finals'].flatMap(kind => Object.entries(L.records?.[kind] || {}).flatMap(([stat, list]) => (list || []).map((x, i) => ({ kind, stat, v: x.value, yr: x.yr, rank: i + 1, pid: x.pid })))).filter(x => x.pid === p.id);
  const g = p.gameStats;
  const recent = g && g.GP ? `${g.PTS} pts · ${g.REB} reb · ${g.AST} ast · ${g.STL} stl · ${g.BLK} blk (${g.FGM}/${g.FGA} FG)` : '';
  return `<div class="tabs fa-tabs">${[['season', 'Regular Season'], ['playoffs', 'Playoffs']].map(([k, l]) => `<button class="btn small ${k === sv ? 'on focus' : 'off'}" data-act="plStats" data-v="${k}">${l}</button>`).join('')}</div>
    <fieldset class="frame"><legend>${sv === 'playoffs' ? 'Playoffs' : 'Regular Season'} by Year</legend>${table}</fieldset>
    ${rows.length ? `<fieldset class="frame"><legend>Highs</legend>
      <div class="statline">${top('PPG', r => r.PTS / r.GP)}${top('RPG', r => r.REB / r.GP)}${top('APG', r => r.AST / r.GP)}${top('SPG', r => r.STL / r.GP)}${top('BPG', r => r.BLK / r.GP)}</div>
      <p class="note small" style="margin-top:8px">${tot.PTS?.toLocaleString() || 0} points · ${tot.REB?.toLocaleString() || 0} rebounds · ${tot.AST?.toLocaleString() || 0} assists · ${tot.DD || 0} double-doubles · ${tot.TD || 0} triple-doubles · ${tot.POTG || 0} player-of-the-game awards</p>
      ${recent ? `<p class="note small muted">Last game: ${esc(recent)}</p>` : ''}
      ${recs.length ? `<p class="note small gold">${recs.map(x => `🏅 ${x.kind === 'season' ? '' : x.kind === 'playoffs' ? 'Playoff ' : 'Finals '}${esc(x.stat)} ${x.v} in a game (${x.yr}), No. ${x.rank} all-time`).join('<br>')}</p>` : ''}
      <p class="note muted small">The game keeps season totals and league records; it doesn't store each player's game highs, so highs here are his best season averages and any record he holds.</p>
    </fieldset>` : ''}`;
}

// Rating bar colors by group: finishing (light blue), shooting (green),
// playmaking/handles (orange), defense (red).
// Skill category → the same colors as the rating bars.
const SKILL_GROUP = { Finishing: 'fin', Shooting: 'sho', Creating: 'pla', Defense: 'def' };
const RATING_GROUP = { LAY: 'fin', DNK: 'fin', INS: 'fin', MID: 'sho', TPT: 'sho', FTS: 'sho', DRB: 'pla', PAS: 'pla', ORE: 'pla', DRE: 'def', STL: 'def', BLK: 'def', STR: 'phy', SPD: 'phy', STM: 'phy' };
const barClass = k => `bar${RATING_GROUP[k] ? ` c-${RATING_GROUP[k]}` : ''}`;

function attrRow(p, snap, k, ceilMode) {
  const [cur, ceil] = p.attributes[k];
  const orig = snap.attributes[k][0];
  const delta = cur - orig;
  const base = Math.min(cur, orig);
  // Declining: the game shows his peak minus this year's regression. The bar
  // fills to that, the red runs from there up to his peak (the rating the
  // save keeps), and there's no growth notch.
  const reg = regressed(p, k);
  const down = reg < cur;
  return `<div class="attr">
    <button class="btn square" data-act="attr" data-k="${k}" data-dir="-1" aria-label="Lower ${ATTR_NAMES[k]}">−</button>
    <div class="body">
      <div class="top">
        <span class="lbl">${k} <span class="muted">${ATTR_NAMES[k]}</span></span>
        <span>${down ? `<span class="down">${reg}</span>` : cur}${delta ? ` <span class="${delta > 0 ? 'up' : 'down'}">(${delta > 0 ? '+' : ''}${delta})</span>` : ''} <span class="${down ? '' : 'gold'}">/ ${down ? cur : ceil}</span></span>
      </div>
      <div class="${barClass(k)}">
        ${down ? `<div class="lost" style="left:${reg / ATTR_MAX * 100}%;width:${(Math.min(cur, ATTR_MAX) - reg) / ATTR_MAX * 100}%"></div>` : `<div class="room" style="width:${Math.min(ceil, ATTR_MAX) / ATTR_MAX * 100}%"></div>`}
        <div class="fill" style="width:${(down ? Math.min(reg, base) : base) / ATTR_MAX * 100}%"></div>
        ${delta > 0 && !down ? `<div class="gain" style="left:${orig / ATTR_MAX * 100}%;width:${delta / ATTR_MAX * 100}%"></div>` : ''}
        ${delta < 0 && !down ? `<div class="lost" style="left:${cur / ATTR_MAX * 100}%;width:${-delta / ATTR_MAX * 100}%"></div>` : ''}
        ${down ? '' : `<div class="ceil" style="left:calc(${Math.min(ceil, ATTR_MAX) / ATTR_MAX * 100}% - 2px)"></div>`}
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
  return `<p class="note small">Last season's production vs ${group} ${ages(prod.ranges?.get(p.id))}: <b class="${z >= 0.5 ? 'up' : z <= -0.5 ? 'down' : ''}">${word}</b></p>`;
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
  if (y < 1) return `${-y + 1} season${-y + 1 === 1 ? '' : 's'} away`;
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
  const order = SKILL_CATEGORIES.flatMap(c => c.skills);
  const ranked = rankSkillsFor(p, state.profiles[state.leagueIdx]).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const o = overlay(`
    <p class="note">Add a skill to ${esc(playerName(p))}</p>
    <div class="add-skill">
      ${ranked.map(s => `<button class="as-row" data-id="${esc(s.id)}">
        <span class="sk-name sk-${SKILL_GROUP[skillCategory(s.id)] || ''}">${esc(skillName(s.id))}</span>
        <span class="as-count"><b>${state.profiles[state.leagueIdx]?.[s.id]?.count ?? 0} players</b><span>with this skill</span></span>
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
    ['seed', 'Random seed', 1, 0, 999999],
    ['starterMpg', 'Starter MPG (bonus at)', 1, 0, 48],
    ['benchMpg', 'Bench MPG (penalty below)', 1, 0, 48],
    ['regFirstYearChance', 'Delay, at regression age %', 5, 0, 100],
    ['regLaterChance', 'Delay, year before / paused %', 5, 0, 100],
    ['prodPotUpPerZ', 'Potential up % per standout step', 2, 0, 50],
    ['prodPotDownChance', 'Potential down %', 1, 0, 50],
    ['regDownStructural', 'Sooner after structural %', 5, 0, 100],
    ['regDownNagging', 'Sooner after nagging %', 5, 0, 100],
    ['regDownStandard', 'Sooner after standard %', 1, 0, 100],
    ['regDownProdChance', 'Sooner after poor season %', 1, 0, 100],
    ['naturalGamesPct', 'Earned year: % of games', 5, 0, 100],
    ['naturalMinutesPct', 'Earned year: % of minutes', 2.5, 0, 100],
    ['naturalMinAge', 'Earned year: min age', 1, 18, 45],
    ['potUpChance', 'Potential up %', 1, 0, 100],
    ['potUpMaxAge', 'Potential up: max age', 1, 18, 40],
    ['mentorMinAge', 'Mentor min age', 1, 25, 45],
    ['menteeMaxAge', 'Mentee max age', 1, 18, 30],
    ['mentorPosRange', 'Position steps apart', 1, 0, 8],
    ['mentorMaxMentees', 'Players per vet', 1, 1, 5],
    ['mentorshipChance', 'CPU chance %', 5, 0, 100],
    ['injuryMinGames', 'Min games missed', 1, 0, 82],
    ['injuryPotPerGame', '% risk per game', 0.1, 0, 2],
    ['injuryPotMax', 'Max risk %', 5, 0, 100],
    ['injuryLowerBodyMult', 'Lower-body ×', 0.1, 1, 2],
    ['injuryLongevityCut', 'Cut to regression delay %', 5, 0, 100],
    ['naggingRiskMult', 'Nagging: risk ×', 0.05, 1, 3],
    ['naggingPointsMult', 'Nagging: bump points ×', 0.05, 0, 1],
    ['structuralRiskMult', 'Structural: risk ×', 0.05, 1, 3],
    ['structuralLongevityCut', 'Structural: delay cut %', 5, 0, 100],
  ],
  skills: [
    ['newSkillChance', 'New skill chance %', 5, 0, 100],
    ['skillMaxAge', 'New skill max age', 1, 18, 45],
    ['skillMinPoints', 'Min points for a new skill', 1, 0, 20],
    ['maxSkills', 'Max skills per player', 1, 0, 24],
    ['levelUpChance', 'Level-up chance %', 5, 0, 100],
    ['levelUpMaxAge', 'Level-up max age', 1, 18, 45],
  ],
};

// Settings rows: label on the left, a small − value + (or a row of option
// buttons underneath) on the right.
const setStep = (label, act, data, value) => `<div class="set-row"><span class="grow">${esc(label)}</span>
  <button class="mvbtn" data-act="${act}" ${data} data-dir="-1" aria-label="Decrease">−</button><b>${esc(value)}</b><button class="mvbtn" data-act="${act}" ${data} data-dir="1" aria-label="Increase">+</button></div>`;
const field = k => { const f = [...STEP_FIELDS.general, ...STEP_FIELDS.skills].find(x => x[0] === k); return setStep(f[1], 'step', `data-k="${k}" data-s="${f[2]}"`, state.params[k]); };
function options(label, key, opts, note = '') {
  const v = state.params[key];
  return `<div class="set-row col"><span class="grow">${esc(label)}</span><div class="seg">
    ${opts.map(([val, text]) => `<button class="btn small ${v === val ? 'on focus' : 'off'}" data-act="setOpt" data-k="${key}" data-v='${JSON.stringify(val)}'>${esc(text)}</button>`).join('')}
  </div>${note ? `<span class="note muted small">${note}</span>` : ''}</div>`;
}
const setGroup = (title, rows) => `<fieldset class="frame"><legend>${esc(title)}</legend><div class="set-list">${rows.join('')}</div></fieldset>`;
const SETTINGS_TABS = [['general', 'General'], ['progress', 'Progression'], ['injury', 'Injuries'], ['rookies', 'Draft'], ['ages', 'Ages'], ['skills', 'Skills']];

screens.settings = (args) => {
  const tab = SETTINGS_TABS.some(([k]) => k === args.tab) ? args.tab : 'general';
  const P = state.params;
  let body = '';
  const band = (act, i, j, v) => `<span class="band-step"><button class="mvbtn" data-act="${act}" data-i="${i}" data-j="${j}" data-dir="-1" aria-label="Decrease">−</button><b>${v}</b><button class="mvbtn" data-act="${act}" data-i="${i}" data-j="${j}" data-dir="1" aria-label="Increase">+</button></span>`;
  if (tab === 'general') {
    body = `
      ${state.data && state.data.seasonLeagues.length > 1 ? setGroup('League', [`<div class="seg">${state.data.seasonLeagues.map((L, i) => `<button class="btn small ${i === state.leagueIdx ? 'on focus' : 'off'}" data-act="setLeague" data-i="${i}">${esc(L.shortName)}</button>`).join('')}</div>`]) : ''}
      ${state.data && !isCollege() ? setGroup('Rules', [`<div class="seg">${[['simple', 'Simple'], ['complete', 'Complete']].map(([k, l]) => `<button class="btn small ${(state.depth || 'complete') === k ? 'on focus' : 'off'}" data-act="setDepth" data-v="${k}">${l}</button>`).join('')}</div>`, '<span class="note muted small">Simple: no aprons, tax, pick protections, no-trade clauses or trade restrictions.</span>']) : ''}
      ${state.data && !isCollege() ? setGroup('Offseason Progress', ['<button class="btn small" data-act="resetProgress">↺ Start This Offseason Over</button>', '<span class="note muted small">Clears the steps marked done (mocks, scouting, options, extensions, ...) for this save.</span>']) : ''}
      ${setGroup('Offseason Bump', [
        options('Bump gives', 'bumpMode', [['train', 'Rating Upgrades'], ['points', 'Upgrade Points']]),
        options('Point focus', 'strengthBias', [[0, 'Room to Grow'], [0.5, 'Balanced'], [1, 'Strengths']]),
        options('Include free agents', 'includeFreeAgents', [[false, 'Off'], [true, 'On']]),
        options('CPU points', 'spendCpuPoints', [[false, 'Hold for Game'], [true, 'Spend Now']], 'Commissioner saves: "Spend Now" applies CPU points to ratings here.'),
        field('seed'),
      ])}
      ${setGroup('Minutes', [
        field('starterMpg'), field('benchMpg'),
        options('Starter multiplier', 'starterMult', [[1, '×1.0'], [1.25, '×1.25'], [1.5, '×1.5']]),
        options('Bench multiplier', 'benchMult', [[0.5, '×0.5'], [0.75, '×0.75'], [1, '×1.0']]),
      ])}
      ${setGroup('Mentorship', [field('mentorMinAge'), field('menteeMaxAge'), field('mentorPosRange'), field('mentorMaxMentees'), field('mentorshipChance'),
        options('Teach elite skills', 'mentorTeachElite', [[false, 'No'], [true, 'Yes']])])}`;
  } else if (tab === 'progress') {
    body = setGroup('Regression', [field('regFirstYearChance'), field('regLaterChance'), field('naturalGamesPct'), field('naturalMinutesPct'), field('naturalMinAge')]) +
      setGroup('Trainer', [field('regDownStructural'), field('regDownNagging'), field('regDownStandard'), field('regDownProdChance')]) +
      setGroup('Potential', [field('potUpChance'), field('potUpMaxAge'), field('prodPotUpPerZ'), field('prodPotDownChance')]);
  } else if (tab === 'injury') {
    body = setGroup('Injury Risk', [field('injuryMinGames'), field('injuryPotPerGame'), field('injuryPotMax'), field('injuryLowerBodyMult'), field('injuryLongevityCut')]) +
      setGroup('Injury Classes', [field('naggingRiskMult'), field('naggingPointsMult'), field('structuralRiskMult'), field('structuralLongevityCut')]);
  } else if (tab === 'ages') {
    let lo = 0;
    body = setGroup('Points by Age', [
      '<div class="band-head"><span>Ages</span><span>Up to</span><span>Min</span><span>Max</span></div>',
      ...P.ageBands.map((b, i) => {
        const label = `${lo === 0 ? '≤' : `${lo}–`}${b[0]}`;
        lo = b[0] + 1;
        return `<div class="band-row"><span>${label}</span>${band('band', i, 0, b[0])}${band('band', i, 1, b[1])}${band('band', i, 2, b[2])}</div>`;
      }),
      '<p class="note muted small">Upgrade points a player earns this offseason by age, before minutes. Older than the last band: none.</p>',
    ]);
  } else if (tab === 'rookies') {
    let lo = 0;
    body = setGroup('Rookie Bump', [
      '<div class="band-head three"><span>Ages</span><span>Min</span><span>Max</span></div>',
      ...P.rookieBands.map((b, i) => {
        const last = i === P.rookieBands.length - 1;
        const label = last ? `${lo}+` : `${lo === 0 ? '≤' : `${lo}–`}${b[0]}`;
        lo = b[0] + 1;
        return `<div class="band-row three"><span>${label}</span>${band('rband', i, 1, b[1])}${band('rband', i, 2, b[2])}</div>`;
      }),
      options('Undrafted rookies', 'rookieIncludeUndrafted', [[false, 'Skip'], [true, 'Include']]),
    ]) +
      setGroup('Age Adjustment', P.recoveryBands.map((b, i) => setStep(`Age ${i === 0 ? `up to ${b[0]}` : b[0] >= 99 ? `${P.recoveryBands[i - 1][0] + 1}+` : `${P.recoveryBands[i - 1][0] + 1}–${b[0]}`}: points back`, 'recBand', `data-i="${i}"`, `+${b[1]}`))) +
      setGroup('Scouting & Draft', [
        options('Scouting accuracy', 'scoutVariance', [[0, 'Perfect'], [15, 'Sharp'], [25, 'Normal'], [40, 'Murky']]),
        options('Private workouts', 'workoutSlots', [[3, '3'], [6, '6'], [9, '9'], [12, '12']]),
        options('CPU draft-day trades', 'liveCpuTradeChance', [[0, 'Off'], [5, 'Rare'], [10, 'Normal'], [20, 'Busy']]),
        options('Commissioner mode', 'commissioner', [[false, 'Off'], [true, 'On']], 'Trade for any team, force trades, undo and reset.'),
      ]) +
      setGroup('Contracts', [
        options('Game option decisions', 'redoOptions', [[true, 'Re-run here'], [false, 'Keep the game\'s']], 'The game decides options before it exports; Re-run reopens them so you and the app decide.'),
        options('Cap system', 'capSystem', [[true, 'NBA cap & aprons'], [false, 'Save\'s cap']], 'NBA: the cap, tax line and aprons by season; the save\'s cap is set to the 2nd apron on export.'),
        options('2nd-round deals (CPU)', 'rookieR2Years', [[2, '2 yrs'], [3, '3 yrs'], [4, '4 yrs']]),
        options('Game\'s CPU offers', 'faClearCpuOffers', [[true, 'Clear daily'], [false, 'Keep']]),
      ]);
  } else {
    body = setGroup('Skills From the Bump', [...STEP_FIELDS.skills.map(([k]) => field(k)), '<p class="note muted small">Off (0%) by default. New skills fit each player\'s best ratings.</p>']);
  }
  layout({
    title: 'Settings',
    body: `
      <div class="sv-tabs">${SETTINGS_TABS.map(([k, l]) => `<button class="btn ${k === tab ? 'on focus' : 'off'}" data-act="setTab" data-t="${k}">${l}</button>`).join('')}</div>
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

const TIER_CLASS = { Legend: 't-legend', 'Hall of Fame': 't-hof', Superstar: 't-super', 'All-Star': 't-star', 'Quality Starter': 't-start', 'Role Player': 't-role', 'Rotational Player': 't-bench', 'G-League': 't-proj' };
const tierTag = tier => `<span class="tier ${TIER_CLASS[tier] || ''}">${esc(tier)}</span>`;
const compLine = c => c.floor[0] || c.ceiling[0]
  ? `Floor: ${esc(c.floor[0]?.name || '—')} ${c.floor[0] ? tierTag(c.floor[0].tier) : ''} · Ceiling: <span class="up">${esc(c.ceiling[0]?.name || '—')}</span> ${c.ceiling[0] ? tierTag(c.ceiling[0].tier) : ''}`
  : '';

function scoutList(p) {
  const r = scoutingReport(p, league(), scoutPot(p), state.data.seasonLeagues, k => ceilKnown(p, k));
  return `<ul class="scout">
    ${[...r.strengths.map(x => ({ ...x, tone: 'plus' })), ...(r.defense ? [r.defense] : []), ...r.weaknesses.map(x => ({ ...x, tone: 'minus' }))]
      // Positives first, then the neutral defense read, then the negatives.
      .sort((a, b) => ({ plus: 0, even: 1, minus: 2 }[a.tone] - { plus: 0, even: 1, minus: 2 }[b.tone]))
      .map(x => `<li class="${x.tone}"><b>${esc(x.text)}</b><span class="muted small"> · ${esc(x.detail)}</span></li>`).join('')}
  </ul>`;
}

// Fogged potential for draft-room views (stable per save + prospect).
function saveSalt() {
  const s = `${league().meta?.saveName || ''}:${league().season.currentYear}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const scoutFog = () => state.params.scoutVariance * FX.facilityFx(myTeam()).fog;
const revealed = id => !!preStore().reveals?.[id];
const scoutPot = p => workoutDone(p.id) || revealed(p.id) ? p.pot : scoutedPot(p, saveSalt(), scoutFog());
// Rating ceilings stay hidden until scouted: a few come out during
// scouting, more at the combine (athletic ones most), and a private workout
// shows them all. Which ones is fixed per save + prospect.
const COMBINE_ATTRS = new Set(['STR', 'SPD', 'STM', 'DNK']);
function ceilStage(p, k) {
  const h = Math.imul((saveSalt() ^ Math.imul(p.id + 1, 2654435761) ^ Math.imul(k.charCodeAt(0) * 131 + k.charCodeAt(2), 40503)) >>> 0, 2246822519) >>> 0;
  const r = h / 4294967296;
  const m = FX.facilityFx(myTeam()).ceilMult;
  return r < 0.15 * m ? 1 : r < (COMBINE_ATTRS.has(k) ? 0.5 : 0.3) * m ? 2 : 9;
}
function ceilKnown(p, k) {
  if (!league().draftClass?.some(x => x.id === p.id)) return true;   // drafted: everything shows
  if (workoutDone(p.id)) return true;
  const reached = combineOn() ? 2 : preDone('mock1') ? 1 : 0;
  return ceilStage(p, k) <= reached;
}
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
  // Superstar one, a Quality Starter floor beats a Rotational Player)...
  const tiers = 0.9 * (ce - ALL_STAR) + 0.3 * (f - 6);
  // ...and All-Star-or-better on both ends goes to the top.
  return tiers + (f >= ALL_STAR && ce >= ALL_STAR ? 1.5 + (f - ALL_STAR) * 0.3 : 0);
}
const scoutValue = p => baseValue(p) + eliteBonus(p) + (combineOn() ? combineBonus(p) : 0);
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
function teamDraftPick(team, available, rng, noise = 0.35, combine = combineOn()) {
  const v = draftVecs();
  const ctx = teamOutlook(team);
  const gauss = () => { const u = Math.max(1e-9, rng()), w = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
  let best = null, bestScore = -Infinity;
  for (const p of available) {
    const sc = draftScore(p, v.scales, v.fns, ctx) + eliteBonus(p) + (combine ? combineBonus(p) : 0) + gauss() * noise;
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
// Draft grades are absolute, not class ranks: what scouts project him to
// become (his ceiling and floor comps' tiers), so a deep class can have
// several Locks or 20 lottery grades and a thin one none. Comp tiers by
// potential: 11 Legend, 10 Hall of Fame, 9 Superstar, 8 All-Star,
// 7 Quality Starter, 6 Role Player, 5 Rotational Player, below that G-League.
const GRADES = [
  ['#1 Pick', 'g-one'], ['Top 5', 'g-top5'], ['Lottery', 'g-lot'], ['First Round', 'g-r1'],
  ['Second Round', 'g-r2'], ['UDFA', 'g-udfa'], ['N/A', 'g-na'],
];
const compAvg = list => { const xs = (list || []).slice(0, 3).map(x => x.pot || 0).filter(Boolean); return xs.length ? xs.reduce((a, v, i) => a + v * [0.5, 0.3, 0.2][i], 0) / [0.5, 0.3, 0.2].slice(0, xs.length).reduce((a, b) => a + b, 0) : 0; };
// Grade score: potential leads (as scouted: 9 = 4½★ is top-five talent,
// a 10 needs the polish to match), then polish (how good his best ratings are
// right now) and how high they can go, younger a little better. A raw
// high-ceiling teenager and a polished five-star freshman with the same
// potential land apart. Thresholds are fixed, so each grade's count
// follows the strength of the class.
function gradeScore(p) {
  const v = draftVecs();
  const top8 = a => { const t = [...a].sort((x, y) => y - x).slice(0, 8); return t.reduce((q, w) => q + w, 0) / (t.length || 1); };
  const age = p.age <= 19 ? (19 - p.age) * 0.15 : -(p.age - 19) * 0.2;
  return scoutPot(p) + 0.5 * (top8(v.fns.floorOf(p)) - 11.5) + 0.25 * (top8(v.fns.ceilOf(p)) - 13) + age;
}
function gradeOf(p) {
  const s = gradeScore(p);
  return GRADES[s >= 10.2 ? 0 : s >= 9.4 ? 1 : s >= 8.2 ? 2 : s >= 7.5 ? 3 : s >= 6.3 ? 4 : s >= 5.6 ? 5 : 6];
}
const valueChip = p => { const [label, cls] = gradeOf(p); return `<span class="grade ${cls}">${label}</span>`; };
// One prospect in the "make your pick" list.
const pickRow = (p, { star = false, fills = [], n = null } = {}) => `<button class="pick-row" data-id="${p.id}">
  <span class="pr-top"><b>${n ? `<span class="rank-no">${n}</span>` : ''}${star ? '<span class="gold">★</span> ' : ''}${esc(playerName(p))}</b><span class="pr-tags">${fills.length ? '<span class="fit-chip">🧩</span>' : ''}${valueChip(p)}</span></span>
  <span class="pr-meta">${esc(posName(p))} · ${p.age}y · ${heightStr(p.ht)}${p.wt ? ` · ${p.wt} lb` : ''}</span>
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
  // Your tier breaks: positions on the board where a new tier starts
  // (a break at 3 = a line between #3 and #4). They stay put when you move
  // players, so moving a player across the line moves him into that tier.
  if (!Array.isArray(b.tiers)) b.tiers = [];
  return b;
}
function saveBoardStore(b) {
  const n = b.board.length;
  b.tiers = [...new Set((b.tiers || []).filter(i => i > 0 && i < n))].sort((x, y) => x - y);
  try { localStorage.setItem(`hlc:board:${seasonKey()}`, JSON.stringify({ board: b.board, tiers: b.tiers })); } catch { /* ignore */ }
}
// Tier number (1-based) of each board position.
const tierAt = (tiers, i) => 1 + tiers.filter(t => t <= i).length;
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
  const k = b.board.indexOf(id);
  if (k >= 0) b.tiers = b.tiers.map(t => (t > k ? t - 1 : t));
  b.board = k >= 0 ? b.board.filter(x => x !== id) : [...b.board, id];
  saveBoardStore(b);
  render();
};
// Add or remove a tier break right below a player on your board.
actions.tierBreak = d => {
  const b = boardStore();
  b.board = myBoard().map(p => p.id);
  const at = +d.i + 1;
  b.tiers = b.tiers.includes(at) ? b.tiers.filter(t => t !== at) : [...b.tiers, at];
  saveBoardStore(b);
  render();
};

// Put a prospect at #1 on your board (adding them if they aren't on it).
actions.topBoard = d => {
  const b = boardStore();
  const id = +d.id;
  const ids = myBoard().map(p => p.id);
  const m = ids.indexOf(id);
  b.tiers = b.tiers.map(t => (m < 0 || t <= m ? t + 1 : t));
  b.board = [id, ...ids.filter(x => x !== id)];
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

const DRAFT_TABS = [['live', 'Live'], ['consensus', 'Prospects'], ['warroom', 'My Board'], ['office', 'Front Office']];
// Draft-room tabs open in each calendar step.
function draftTabsNow(L = league()) {
  const step = phaseRank(L.season) === 0 ? null : currentStep()?.key;
  if (step === 'draft') return liveReady(L) && clockIndex(liveState(), liveOrder()) < 0 ? ['live'] : ['live', 'consensus', 'warroom'];
  if (step === 'scout' || step === 'workouts') return ['consensus', 'warroom', 'office'];
  if (step === 'preview') return ['consensus', 'warroom'];
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
  if (isStep('scout') && !preStore().scoutSeen) { preStore().scoutSeen = true; savePre(); }
  const allowed = draftTabsNow(L);
  const tabs = allowed.length < 2 ? '' : `<div class="tabs">${DRAFT_TABS.filter(([k]) => allowed.includes(k)).map(([k, l]) =>
    `<button class="btn ${k === tab ? 'on focus' : 'off'}" data-act="draftTab" data-t="${k}">${l}</button>`).join('')}</div>`;
  const body = { live: draftLive, consensus: draftConsensus, warroom: draftWarRoom, office: draftOffice }[tab](args);
  const preview = isStep('preview');
  layout({ title: preview ? 'Draft Preview' : tab === 'live' ? 'NBA Draft' : 'War Room', body: (tab === 'live' || isStep('draft') ? '' : outlookCard()) + (preview && !isCollege() ? looksCard() : '') + tabs + body.html, action: preview ? { act: 'previewDone', label: 'Wrap Up the Preview' } : body.action });
  if (tab === 'live') centerBoard();
  if (tab === 'live' && state.pickReveal?.length) { const picks = state.pickReveal; state.pickReveal = null; revealPicks(picks); }
};

// A pick plays out in the clock card: "The pick is in…" over the team that
// made it, then the player. Lottery picks get a longer beat. The board
// fills in without fanfare once the name is out, and nothing else can be
// tapped until it's done.
async function revealPicks(overalls) {
  const card = $app.querySelector('.clock-card');
  if (!card) return;
  const L = league();
  const live = liveState();
  const order = liveOrder();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (const ov of overalls) $app.querySelector(`.lot-row[data-ov="${ov}"]`)?.classList.add('pending');
  state.revealing = true;
  try {
    for (const ov of overalls) {
      const q = order.find(x => x.overall === ov), sel = live.sel[ov];
      if (!q || !sel || !card.isConnected) continue;
      const p = prospectById(sel.pid), team = L.teams.find(t => t.id === sel.by) || q.owner;
      card.setAttribute('style', teamTint(team));
      card.classList.remove('mine', 'named');
      card.classList.add('reveal');
      card.innerHTML = `<span class="pk">#${ov}</span><span class="grow"><b>${esc(teamFull(team))}</b><span class="small muted">R${q.rd}${team.id !== q.orig.id ? ` · via ${esc(q.orig.shortName)}` : ''}</span><span class="pick-in">The pick is in…</span></span>`;
      await wait(ov <= 14 ? 1500 : 1000);
      if (!card.isConnected) break;
      card.classList.add('named');
      card.querySelector('.pick-in').outerHTML = `<span class="pick-name">${esc(playerName(p))}</span><span class="small">${esc(posName(p))} · ${p.age}y · ${heightStr(p.ht)}${p.wt ? ` · ${p.wt} lb` : ''}</span>`;
      $app.querySelector(`.lot-row[data-ov="${ov}"]`)?.classList.remove('pending');
      await wait(ov <= 14 ? 1900 : 1300);
    }
  } finally {
    state.revealing = false;
  }
  if (card.isConnected) render();
}

// Keep the team on the clock in view inside the board's own scroll box.
function centerBoard() {
  const box = $app.querySelector('.draft-board');
  const row = box?.querySelector('.lot-row.clock');
  if (row) box.scrollTop = Math.max(0, row.offsetTop - box.offsetTop - (box.clientHeight - row.offsetHeight) / 2);
}

// The draft class's looks, rebuilt from the league's own players (skin,
// hair, gear); names, stats and ratings stay. Undo keeps the originals.
function looksCard() {
  const done = state.looks?.[seasonKey()];
  return `<fieldset class="frame"><legend>🎨 Class Looks &amp; Builds</legend><div class="row">
    <p class="note small grow">${done ? `✓ ${done.length} prospects restyled to match your league.` : 'Give the class looks from your league\'s players, and spread their regression ages, stamina and tendencies to match the active players. Names and skill ratings stay.'}</p>
    ${done ? '<button class="btn small off" data-act="looksUndo">↺ Undo</button>' : '<button class="btn small focus" data-act="looksMatch">Match My League</button>'}
  </div></fieldset>`;
}
// Builds: the game hands nearly every prospect a regression age of 32 and
// stamina of 20. Spread them by how the player is built and plays: athletes
// and the injury-prone age sooner, shooters and skilled big men age
// gracefully; big bodies carry less stamina than slight, well-framed ones,
// with the odd outlier either way.
function classBuild(p, rng) {
  const A = k => p.attributes[k][0];
  const g = () => { const u = Math.max(1e-9, rng()), w = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
  const ath = (A('SPD') + A('DNK')) / 2, skill = (A('TPT') + A('MID') + A('FTS') + A('PAS')) / 4;
  const m = medicalFlag(p);
  const big = p.ht >= 82 || p.wt >= 250, slight = p.wt > 0 && p.wt / p.ht < 2.55;
  let reg = 32 - Math.max(-1, Math.min(3, (ath - 13) * 0.6)) + Math.max(-1, Math.min(3, (skill - 12) * 0.5))
    - (m?.level === 'red' ? 2 : m?.level === 'yellow' ? 1 : 0) + (big && A('INS') >= 14 ? 1 : 0) + (slight && ath >= 15 ? -1 : 0) + g() * 0.9;
  reg = Math.max(29, Math.min(36, Math.round(reg)));
  let [lo, hi] = big ? [15, 18] : slight ? [18, 20] : [16, 19];
  let stm = lo + Math.floor(rng() * (hi - lo + 1));
  const r = rng();
  if (r < 0.05) stm = 13 + (rng() < 0.5 ? 1 : 0);          // a rare weak engine
  else if (r > 0.92) stm = Math.min(20, stm + 3);           // an outlier with a big motor
  return { reg, stm };
}
actions.looksMatch = () => {
  const L = league();
  const rng = mulberry32((saveSalt() ^ 0x100c) >>> 0);
  const rng2 = mulberry32((saveSalt() ^ 0xb11d) >>> 0);
  const before = [];
  let looks = true;
  for (const p of L.draftClass || []) {
    const look = looks ? leagueLook(L, rng, p) : null;
    if (!look) looks = false;
    const b = classBuild(p, rng2);
    before.push({ p, appearance: structuredClone(p.appearance), accessories: structuredClone(p.accessories), reg: p.regressionAge, stm: [...p.attributes.STM] });
    if (look) Object.assign(p, look);
    p.regressionAge = b.reg;
    p.attributes.STM[0] = p.attributes.STM[1] = b.stm;
  }
  if (!before.length) { toast('Not enough players in the league to draw from'); return; }
  // Rookie play styles in line with the active players'.
  const tn = normalizeTendencies(L.draftClass, L.teams.flatMap(t => t.roster), mulberry32((saveSalt() ^ 0x7e11) >>> 0));
  for (const c of tn) { const b = before.find(x => x.p === c.p); if (b) b.tend = c.was; }
  (state.looks ||= {})[seasonKey()] = before;
  state.dirty = true;
  render();
};
actions.looksUndo = () => {
  const list = state.looks?.[seasonKey()] || [];
  for (const x of list) {
    x.p.appearance = x.appearance; x.p.accessories = x.accessories;
    if (x.reg != null) x.p.regressionAge = x.reg;
    if (x.stm) x.p.attributes.STM = [...x.stm];
    if (x.tend) x.p.tendencies = x.tend;
  }
  delete state.looks[seasonKey()];
  render();
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
    const now = order.length ? order.filter(q => q.owner.id === t.id).map(q => `#${q.overall}${q.orig.id !== t.id ? ` <span class="muted">(${esc(q.orig.shortName)})</span>` : ''}`)
      : draftPosition(L, t, state.params.lotteryFormat).map(x => `${x.lottery ? `Proj #${x.likely}` : `#${x.slot}`}${x.orig.id !== t.id ? ` <span class="muted">(${esc(x.orig.shortName)})</span>` : ''}`);
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

// Who's already gone in the live draft: pid -> { overall, team }.
function goneMap() {
  const L = league();
  const m = new Map();
  if (!liveReady(L) || !isStep('draft')) return m;
  for (const [ov, sel] of Object.entries(liveState().sel)) m.set(sel.pid, { overall: +ov, team: L.teams.find(t => t.id === sel.to) });
  return m;
}
const prospectRow = (p, extra = '', { mine = false } = {}) => {
  const gone = goneMap().get(p.id);
  if (gone) return `<button class="prow cprow gone" data-act="openProspect" data-id="${p.id}">
  <span class="name"><span class="nm">${esc(playerName(p))}</span> <span class="small muted">#${gone.overall}${gone.team ? ` · ${esc(gone.team.shortName)}` : ''}</span></span>
  <span class="meta">${esc(posName(p))} · ${heightStr(p.ht)}${p.wt ? ` · ${p.wt} lb` : ''} · ${p.age}y</span>
</button>`;
  const star = onBoard(p.id) && !mine;
  const c = compsFor(p);
  const t = league().teams.find(isUserTeam);
  const fills = t ? fillsFor(t, p) : [];
  const comp = (label, x) => x ? `<span class="pr-comp"><span class="muted">${label}</span><span>${esc(x.name)}</span></span>` : '';
  const fit = fills.length ? `<span class="fit-chip" title="Fills ${esc(fills.map(n => n.label).join(', '))}" aria-label="Fills ${esc(fills.map(n => n.label).join(', '))}">🧩</span>` : '';
  return `<button class="prow cprow ${star ? 'sel' : ''} ${gone ? 'gone' : ''}" data-act="openProspect" data-id="${p.id}">${fit}
  <span class="name">${star ? '<span class="gold">★</span> ' : ''}<span class="nm">${esc(playerName(p))}</span>${gone ? ` <span class="small muted">#${gone.overall}${gone.team ? ` · ${esc(gone.team.shortName)}` : ''}</span>` : ''}</span>
  <span class="meta">${esc(posName(p))} · ${p.age}y · ${heightStr(p.ht)}${p.wt ? ` · ${p.wt} lb` : ''}${archName(p) ? ` · ${esc(archName(p))}` : ''} ${valueChip(p)}</span>
  <span class="chg">${comp('Ceiling', c.ceiling[0])}${comp('Floor', c.floor[0])}${extra}</span>
</button>`;
};

// Consensus: the whole class, ranked by the scouts.
function draftConsensus() {
  const rows = boardOrder();
  return {
    html: `<p class="note muted small">${rows.length} prospects ranked by our scouts. + adds a prospect to My Board; 🧩 fits a need on your team. Ratings are pre-draft: every rookie dips a little moving up to the pros, and older rookies get some of it back.</p>
      <div class="list">${rows.map((p, i) => `<div class="board-row">${prospectRow(p).replace('<span class="name">', `<span class="name"><span class="rank-no">${i + 1}</span>`)}
        <div class="mv2"><button class="mvbtn ${onBoard(p.id) ? 'on' : ''}" data-act="toggleBoard" data-id="${p.id}" aria-label="${onBoard(p.id) ? 'Remove from' : 'Add to'} your board">${onBoard(p.id) ? '✓' : '+'}</button></div></div>`).join('')}</div>`,
  };
}

// War Room: your board.
function draftWarRoom() {
  const board = myBoard();
  return {
    html: `<fieldset class="frame"><legend>Your Board</legend>
        ${board.length ? `<div class="list">${(() => {
          const tiers = boardStore().tiers;
          const head = n => `<div class="tier-break"><span>Tier ${n}</span></div>`;
          return board.map((p, i) => `${tiers.length && (i === 0 || tiers.includes(i)) ? head(tierAt(tiers, i)) : ''}<div class="board-row">${prospectRow(p, '', { mine: true }).replace('<span class="name">', `<span class="name"><span class="rank-no">${i + 1}</span>`)}
          <div class="mv2 mv3"><button class="mvbtn" data-act="moveBoard" data-id="${p.id}" data-dir="-1" aria-label="Move up" ${i ? '' : 'disabled'}>▲</button><button class="mvbtn" data-act="moveBoard" data-id="${p.id}" data-dir="1" aria-label="Move down" ${i < board.length - 1 ? '' : 'disabled'}>▼</button><button class="mvbtn x" data-act="toggleBoard" data-id="${p.id}" aria-label="Remove from your board">✕</button></div></div>
          ${i < board.length - 1 ? `<button class="tier-add ${tiers.includes(i + 1) ? 'on' : ''}" data-act="tierBreak" data-i="${i}" aria-label="${tiers.includes(i + 1) ? 'Remove the tier break here' : 'Add a tier break here'}">${tiers.includes(i + 1) ? '✕ Remove tier break' : '＋ Tier break'}</button>` : ''}`).join('');
        })()}</div>
        <p class="note muted small" style="margin-top:6px">Tap "＋ Tier break" between two players to start a new tier there.</p>`
        : '<p class="note">Your board is empty. Add prospects from Prospects with +, then order them here. When you\'re on the clock, your board comes first.</p>'}
      </fieldset>`,
  };
}

// ---------------------------------------------------------------------------
// Pre-draft events: Mock 1.0 → Scouting → Combine → Mock 2.0 → Private
// Workouts. Remembered per league + season.

function preStore() {
  const key = seasonKey();
  const cache = (state.pre ||= {});
  if (!cache[key]) {
    let v = {};
    try { v = JSON.parse(localStorage.getItem(`hlc:pre:${key}`)) || {}; } catch { v = {}; }
    cache[key] = { steps: {}, workouts: {}, reveals: {}, ...v };
  }
  return cache[key];
}
function savePre() {
  try { localStorage.setItem(`hlc:pre:${seasonKey()}`, JSON.stringify(preStore())); } catch { /* ignore */ }
}
const preDone = k => !!preStore().steps[k] || phaseRank(league().season) >= 3;
function finishPre(k) {
  preStore().steps[k] = true;
  savePre();
  state.undo = null;
  goHome();
}
actions.preAdvance = async d => {
  const pre = preStore();
  if (d.k === 'scout' && !pre.scoutSeen && !(await confirmBox('You haven\'t opened scouting yet. Skip it and go to the Combine?', 'Skip Scouting'))) return;
  if (d.k === 'workouts' && !Object.keys(pre.workouts).length && !(await confirmBox('No one has worked out for you yet. Go to the draft anyway?', 'Go to Draft'))) return;
  finishPre(d.k);
};
actions.preFinish = d => finishPre(d.k);

// The combine counts toward draft stock once its results are out.
const combineOn = () => !!(state.data && league().draftClass?.length && preStore().combineSeen);
function combineData() {
  const cache = (state.compCache[state.leagueIdx] ||= new Map());
  if (!cache.has('combine')) {
    const top = (mockPicks(1) || []).map(m => m.pid).filter(x => x != null);
    cache.set('combine', runCombine(league().draftClass || [], saveSalt(), top, league().teams.flatMap(t => t.roster)));
  }
  return cache.get('combine');
}
const combineBonus = p => combineData().byId.get(p.id)?.bonus ?? 0;

// The two published mocks are made once and kept. 1.0: first round, a loose
// read of the class. 2.0: the whole draft (for where first-round fallers
// land), tighter, with the combine counted.
function mockPicks(n) {
  const pre = preStore();
  const k = `mock${n}`;
  if (!pre[k] && league().draftClass?.length && lotteryDone(league())) {
    const order = actualDraftOrder(league()).filter(o => n === 2 || o.rd === 1);
    const rng = mulberry32((saveSalt() ^ (n === 1 ? 0x51a7 : 0x2c0e)) >>> 0);
    const taken = new Set();
    pre[k] = order.map(o => {
      const p = teamDraftPick(o.owner, league().draftClass.filter(x => !taken.has(x.id)), rng, n === 1 ? 0.75 : 0.45, n === 2);
      if (p) taken.add(p.id);
      return { overall: o.overall, rd: o.rd, tid: o.owner.id, orig: o.orig.id, pid: p?.id ?? null };
    });
    savePre();
  }
  return pre[k] || null;
}
actions.openMock = d => go('mock', { n: +d.n });
actions.mockView = d => replace('mock', { n: 2, view: d.v });

screens.mock = (args) => {
  const L = league();
  const n = args.n === 2 ? 2 : 1;
  const view = n === 2 && args.view === 'v1' ? 1 : n;
  const m1 = mockPicks(1);
  const m2 = n === 2 ? mockPicks(2) : null;
  if (!m1) { layout({ title: 'Mock Draft', body: '<p class="note">The mock comes out once the lottery is drawn.</p>' }); return; }
  const byId = new Map(L.draftClass.map(p => [p.id, p]));
  const teams = new Map(L.teams.map(t => [t.id, t]));
  const r1 = n === 2 ? m2.filter(x => x.rd === 1) : m1;
  const list = view === 1 ? m1 : r1;
  const slot1 = new Map(m1.map(x => [x.pid, x.overall]));
  const slot2 = new Map((m2 || []).map(x => [x.pid, x.overall]));
  const move = pk => {
    if (view !== 2 || pk.pid == null) return '';
    const was = slot1.get(pk.pid);
    if (was == null) return '<span class="mv-chip new">NEW</span>';
    const d = was - pk.overall;
    return d > 0 ? `<span class="mv-chip up">▲${d}</span>` : d < 0 ? `<span class="mv-chip down">▼${-d}</span>` : '<span class="mv-chip same">—</span>';
  };
  const rows = list.map(pk => {
    const team = teams.get(pk.tid), p = pk.pid != null ? byId.get(pk.pid) : null;
    const via = pk.orig !== pk.tid ? ` <span class="muted">via ${esc(teams.get(pk.orig)?.shortName || '')}</span>` : '';
    return pickCard({ overall: pk.overall, team, p, showLv: false, right: move(pk), cls: isUserTeam(team) ? 'mine' : '',
      extra: { sub: via, star: p && onBoard(p.id) ? '<span class="gold">★</span> ' : '' } });
  }).join('');
  const out = view === 2 ? m1.filter(x => x.pid != null && !r1.some(y => y.pid === x.pid)) : [];
  const outBox = out.length ? `<fieldset class="frame"><legend>Out of the First Round</legend><div class="stack">${out.map(x => {
      const p = byId.get(x.pid);
      const now = slot2.get(x.pid);
      return p ? `<div class="out-row"><b>${esc(playerName(p))}</b> <span class="muted small">${esc(posName(p))}</span>
        <span class="out-mv"><span>#${x.overall}</span> → <span class="down">${now ? `#${now}${now > 30 ? ' <span class="small">R2</span>' : ''}` : 'Undrafted'}</span></span></div>` : '';
    }).join('')}</div></fieldset>` : '';
  const isCur = isStep(`mock${n}`);
  layout({
    title: `Mock Draft ${n}.0`,
    body: `<p class="note small">${n === 1
        ? 'The lottery is set and our first mock of the cycle is out: how the first round shakes out from each team\'s stage, needs and board.'
        : 'After the combine, boards tighten up. Green and red show the move from Mock 1.0.'}</p>
      ${n === 2 ? `<div class="opts recap-sort"><button class="btn small ${view === 2 ? 'on focus' : 'off'}" data-act="mockView" data-v="v2">Mock 2.0</button><button class="btn small ${view === 1 ? 'on focus' : 'off'}" data-act="mockView" data-v="v1">Mock 1.0</button></div>` : ''}
      <div class="stack recap" style="margin-top:8px">${rows}</div>
      ${outBox}`,
    action: isCur ? { act: 'preFinish', label: n === 1 ? 'Continue to Scouting' : 'Continue to Workouts', k: `mock${n}` } : null,
  });
};

// ---- Draft Combine

screens.combine = (args) => {
  const L = league();
  const pre = preStore();
  if (!pre.combineSeen) { pre.combineSeen = true; savePre(); state.compCache = {}; }
  const C = combineData();
  const tab = args.tab || 'measure';
  const rank = new Map((mockPicks(1) || []).map((m, i) => [m.pid, i]));
  const tabs = `<div class="tabs">${[['measure', 'Measured'], ['drills', 'Drills'], ['trending', 'Trending']].map(([k, l]) =>
    `<button class="btn ${k === tab ? 'on focus' : 'off'}" data-act="combineTab" data-t="${k}">${l}</button>`).join('')}</div>`;
  const nameBtn = p => `<button class="linkish" data-act="openProspect" data-id="${p.id}">${esc(playerName(p))}</button>`;
  let body = '';
  if (tab === 'trending') {
    const posts = hoopGram(L.draftClass, C, rank, saveSalt());
    body = `<p class="note muted small">Trending from the combine on Hoop Gram.</p>
      <div class="stack">${posts.map(x => `<div class="hg-post">
        <div class="hg-head"><span class="hg-avatar">HG</span><b>${esc(x.handle)}</b><span class="hg-tag">${esc(x.tag)}</span></div>
        <p class="hg-text">${esc(x.text)}</p>
        <div class="hg-foot"><span>❤️ ${x.likes.toLocaleString()}</span>${nameBtn(x.p)}</div>
      </div>`).join('') || '<p class="note">Quiet combine.</p>'}</div>`;
  } else if (tab === 'drills') {
    const d = DRILLS.find(x => x.k === args.drill) || DRILLS[0];
    const board = C.boards[d.k];
    const dnp = board.filter(r => r.v == null);
    const shown = args.all ? board.filter(r => r.v != null) : board.filter(r => r.v != null).slice(0, 25);
    body = `<div class="drill-opts">${DRILLS.map(x => `<button class="btn small ${x === d ? 'on focus' : 'off'}" data-act="combineDrill" data-d="${x.k}">${esc(x.short || x.name)}</button>`).join('')}</div>
      <fieldset class="frame"><legend>${esc(d.name)}</legend><div class="stack">${shown.map((r, i) => `<div class="drill-row ${rank.has(r.p.id) && rank.get(r.p.id) < 30 ? 'r1' : ''}">
        <span class="pk">${i + 1}</span><span class="grow">${nameBtn(r.p)}<br><span class="small muted">${esc(posName(r.p))} · ${heightStr(r.p.ht)} · ${r.p.wt} lb</span></span>
        <b class="drill-val">${fmtDrill(d, r.v)}</b></div>`).join('')}</div>
        ${!args.all && board.filter(r => r.v != null).length > 25 ? `<button class="btn small" data-act="combineAll" style="margin-top:8px">Show all ${board.filter(r => r.v != null).length}</button>` : ''}
        ${dnp.length ? `<p class="note muted small" style="margin-top:8px">Did not participate: ${dnp.map(r => esc(playerName(r.p))).join(', ')}</p>` : ''}
      </fieldset>`;
  } else {
    const sort = args.sort || 'diff';
    const val = { diff: x => x.wingDiff, ws: x => x.ws, reach: x => x.reach, ht: x => x.htNs, size: x => -x.pro.sizeZ }[sort] || (x => x.wingDiff);
    const rows = L.draftClass.map(p => ({ p, x: C.byId.get(p.id) })).sort((a, b) => val(b.x) - val(a.x));
    const shown = args.all ? rows : rows.slice(0, 30);
    body = `<div class="combine-sorts">${[['diff', 'Ape Index'], ['size', 'Undersized'], ['ws', 'Wingspan'], ['reach', 'Reach']].map(([k, l]) =>
        `<button class="btn small ${k === sort ? 'on focus' : 'off'}" data-act="combineSort" data-s="${k}">${l}</button>`).join('')}</div>
      <p class="note muted small" style="margin:6px 0">Ape index = wingspan minus height (no shoes). Size compares height and weight with pros at his position.</p>
      <div class="stack">${shown.map(({ p, x }) => `<div class="drill-row">
        <span class="grow">${nameBtn(p)}<br><span class="small muted">${esc(posName(p))} · ${inchStr(x.htNs)} · ${x.wt} lb · Reach ${inchStr(x.reach)}</span><br>${sizeLine(p, x)}</span>
        <span class="meas"><b>${inchStr(x.ws)}</b><span class="small ${x.wingDiff < 0 ? 'down' : x.wingDiff >= 6 ? 'up' : 'muted'}">${x.wingDiff >= 0 ? '+' : ''}${x.wingDiff}"</span></span></div>`).join('')}</div>
      ${!args.all && rows.length > 30 ? `<button class="btn small" data-act="combineAll" style="margin-top:8px">Show all ${rows.length}</button>` : ''}`;
  }
  layout({
    title: 'Draft Combine',
    body: tabs + body,
    action: isStep('combine') ? { act: 'preFinish', label: 'Continue to Mock 2.0', k: 'combine' } : null,
  });
};
const combineArgs = () => state.stack[state.stack.length - 1].args || {};
actions.combineTab = d => replace('combine', { tab: d.t });
actions.combineDrill = d => replace('combine', { ...combineArgs(), drill: d.d, all: false });
actions.combineSort = d => replace('combine', { ...combineArgs(), sort: d.s, all: false });
actions.combineAll = () => replace('combine', { ...combineArgs(), all: true });
actions.openProspect = d => go('prospect', { id: +d.id });

// Height and weight against the average pro at his position.
function sizeLine(p, x, label = true) {
  const dh = p.ht - x.pro.ht, dw = p.wt - x.pro.wt;
  const f = (v, u) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}${u}`;
  const cls = x.pro.sizeZ < -1.3 || (x.pro.wtZ < -1.6 && x.pro.htZ > -0.6) ? 'down' : x.pro.sizeZ > 1 ? 'up' : 'muted';
  return `<span class="small ${cls}">${label ? `vs pro ${esc(posName(p))}: ` : ''}${f(dh, '"')} · ${f(dw, ' lb')}</span>`;
}

// "#3 of 11 SF": where a result ranks among prospects at his position.
function posRank(p, d) {
  const C = combineData();
  const v = C.byId.get(p.id)?.[d.k];
  if (v == null) return '';
  const same = league().draftClass.filter(x => x.pos === p.pos).map(x => C.byId.get(x.id)?.[d.k]).filter(y => y != null);
  const rank = 1 + same.filter(y => (d.low ? y < v : y > v)).length;
  return ` <span class="pos-rank${rank <= 3 ? ' top' : ''}">#${rank} of ${same.length} ${esc(posName(p))}</span>`;
}

function combineBox(p) {
  if (!combineOn()) return '';
  const x = combineData().byId.get(p.id);
  if (!x) return '';
  return `<fieldset class="frame"><legend>Draft Combine</legend>
    <div class="combine-grid">
      <span>Height (no shoes)</span><b>${inchStr(x.htNs)}</b><span>Wingspan</span><b>${inchStr(x.ws)} <span class="small ${x.wingDiff < 0 ? 'down' : 'muted'}">(${x.wingDiff >= 0 ? '+' : ''}${x.wingDiff}")</span></b>
      <span>Standing Reach</span><b>${inchStr(x.reach)}</b><span>Weight</span><b>${x.wt} lb</b>
      <span>Vs avg pro ${esc(posName(p))}</span><b>${sizeLine(p, x, false)}</b>
      ${DRILLS.map(d => `<span>${esc(d.name)}</span><b>${fmtDrill(d, x[d.k])}${posRank(p, d)}</b>`).join('')}
    </div>
    ${x.skip ? `<p class="note small muted" style="margin-top:6px">Sat out testing: ${esc(x.skip)}.</p>` : ''}
    ${x.medical && x.medical.level !== 'note' ? `<p class="note small ${x.medical.level === 'red' ? 'down' : 'gold'}" style="margin-top:6px">🩺 ${esc(x.medical.text)}</p>` : ''}
  </fieldset>`;
}

// ---- Private workouts
//
// A prospect comes in, works out and takes three questions. He answers in
// his own words, then our staff adds what they saw. His true ceiling (and
// every rating's ceiling) is revealed once the interview is done.

const interviewQs = () => 3;
const workoutSlots = () => (state.params.workoutSlots ?? 6) * Math.max(1, state.userTeams.size) + FX.facilityFx(myTeam()).workouts;
const workoutDone = id => (preStore().workouts[id]?.qs.length || 0) >= interviewQs();
const vary2 = (p, n, arr) => arr[(p.id * 31 + n * 7) % arr.length];
const myTeam = () => league().teams.find(isUserTeam);
// Each prospect gets six questions in a random order (fixed per save), in
// three pairs: each round you ask one of the two, and the other is gone.
function interviewPairs(p) {
  const rng = mulberry32((saveSalt() ^ Math.imul(p.id + 7, 2654435761)) >>> 0);
  const qs = workoutQs(p).map(x => ({ x, r: rng() })).sort((a, b) => a.r - b.r).slice(0, 6).map(y => y.x);
  return [qs.slice(0, 2), qs.slice(2, 4), qs.slice(4, 6)].filter(x => x.length);
}

// How much a rating can still grow: its ceiling (true potential) minus today.
function roomFor(p, k) {
  const i = SKILL_ATTRS.indexOf(k);
  const now = p.attributes[k][0];
  const top = i >= 0 ? Math.max(now, projectedCeiling(p, p.pot)[i]) : Math.max(now, p.attributes[k][1]);
  return top - now;
}
const GROWTH = {
  LAY: 'finishing', DNK: 'explosiveness at the rim', INS: 'post game', MID: 'pull-up game', TPT: 'three-point shot', FTS: 'free throws',
  DRB: 'handle', PAS: 'passing', ORE: 'work on the offensive glass', DRE: 'rebounding', STL: 'hands on defense', BLK: 'rim protection',
  STR: 'strength', SPD: 'quickness', STM: 'conditioning', SCO: 'scoring', HT: 'frame',
};
// What a scout adds on a weakness: the room to grow, or the strength that
// makes the weakness matter less (a handle that would make a mid-range shot
// unfair, a finisher who doesn't need a jumper).
const COVER = {
  MID: [['DRB', 'with a handle like his, a pull-up would make him unfair'], ['LAY', 'he lives at the rim, so a mid-range game is a luxury'], ['TPT', 'he gets his shots from three; the middy is gravy']],
  TPT: [['MID', 'the mid-range game is real, and it carries him until the three comes'], ['LAY', 'he scores where it matters, in the paint'], ['DNK', 'he\'s a rim-runner, spacing is not what he\'s for']],
  FTS: [['TPT', 'a shooter\'s touch like that says the free throws will come'], ['MID', 'the touch is there, it\'s a matter of reps']],
  LAY: [['DNK', 'he finishes above the rim, so the layup package is not a concern'], ['PAS', 'he beats you with the pass first, finishing is secondary']],
  DNK: [['LAY', 'he finishes with touch, so the dunks aren\'t needed'], ['TPT', 'he wins from the perimeter, not above the rim']],
  INS: [['MID', 'he\'s a face-up big, so back-to-the-basket work is optional'], ['TPT', 'he stretches the floor; the post game is optional'], ['DNK', 'he does his damage above the rim']],
  DRB: [['PAS', 'he\'s a passer first, the dribble is a means to an end'], ['TPT', 'he\'s a spot-up weapon, he doesn\'t need the ball in his hands']],
  PAS: [['LAY', 'he\'s a finisher, the playmaking is a bonus'], ['MID', 'he scores his own shots, the passing is a bonus'], ['TPT', 'he scores his own shots, the passing is a bonus']],
  ORE: [['DRE', 'he\'s a defensive rebounder who gets back in transition, so the offensive glass is optional']],
  DRE: [['ORE', 'he crashes the offensive glass, so the defensive boards will follow']],
  STL: [['BLK', 'he protects the rim, so the steals aren\'t his job']],
  BLK: [['STL', 'he plays the passing lanes, rim protection isn\'t his job'], ['DRE', 'he\'s a rebounder first; the blocks are not his job']],
};
// The game's own read on a player: each skill group's ratings against its
// tendencies (-5..+5), written the way the Tendency & Attribute guide does.
// Single ratings are fine at 10+; combos (several ratings or tendencies) use
// the average rating and the total tendency, break-even at 0. A negative
// tendency on a rating under 5 isn't a weakness. Returns weaknesses and
// strengths: { area, k, kind, label, gap, text, q }.
const GAME_AREAS = [
  { id: 'inside', k: 'INS', attrs: ['LAY', 'INS'], tend: t => t.floater + t.post + t.hook, strong: ['Inside Shooting', 'is a polished inside scorer'], sel: ['Inside Shot Selection', 'takes inside shots he can\'t finish yet', 'You take a lot of tough shots inside. Why?'], hes: ['Inside Shot Hesitance', 'can finish inside but passes up looks', 'You can score inside but you don\'t look for it. Why not?'], size: true },
  { id: 'dunk', k: 'DNK', attrs: ['DNK'], tend: t => t.dunk, strong: ['Strong Finishing', 'is explosive and finishes through contact'], sel: ['Weak Finishing', 'attacks the basket without the athleticism to finish through contact', 'You drive at the rim every chance you get. Can you finish through the contact?'], hes: ['Passive Finishing', 'has the explosiveness to finish through contact but rarely attacks the basket', 'You\'re a freak athlete but you rarely drive. Why not attack the rim?'] },
  { id: 'mid', k: 'MID', attrs: ['MID'], tend: t => t.twoPoint, strong: ['Mid-Range Shooting', 'is a real mid-range threat'], sel: ['Mid-Range Shot Selection', 'settles for pull-up jumpers he doesn\'t make', 'Scouts say you settle for pull-up jumpers. Why?'], hes: ['Mid-Range Shot Hesitance', 'has a mid-range shot he doesn\'t trust', 'You\'re a good mid-range shooter but you rarely take it. Why?'] },
  { id: 'three', k: 'TPT', attrs: ['TPT'], tend: t => t.threePoint, strong: ['3PT Shooting', 'is a legitimate three-point shooter'], sel: ['3PT Shot Selection', 'shoots way too many threes for his skill', 'Scouts say you take too many threes for your percentage. Why?'], hes: ['3PT Shot Hesitance', 'can shoot it but won\'t let it fly', 'You can shoot the three but you pass them up. Why?'] },
  { id: 'dribble', k: 'DRB', attrs: ['DRB'], tend: t => t.cross + t.spin + t.step, strong: ['Ball Handling', 'has real ball handling'], over: ['Over Dribbling', 'over-dribbles and holds the ball too long', 'You put the ball on the floor a lot. Is that who you are?'] },
  { id: 'pass', k: 'PAS', attrs: ['PAS'], tend: t => t.pass + t.lob, strong: ['Court Vision', 'sees the floor'], sel: ['Forcing Passes', 'forces passes he can\'t make', 'You force a lot of passes. Are you a passer?'], hes: ['Tunnel Vision', 'can pass but rarely looks for teammates', 'You can pass but you don\'t. Why not?'] },
  { id: 'oreb', k: 'ORE', attrs: ['ORE'], tend: t => t.offReb, strong: ['Crashing Boards', 'crashes the offensive glass'], sel: ['Getting Back on D', 'gets involved on the glass, but needs more size to really dominate', 'You crash the glass a lot. Do you have the tools for it?'], hes: ['Soft on the Glass', 'has the tools for the offensive glass but won\'t crash it', 'You have the tools on the offensive glass but you don\'t crash. Why?'], size: true },
  { id: 'dreb', k: 'DRE', attrs: ['DRE'], tend: t => t.defReb, strong: ['Defensive Rebounding', 'cleans the defensive glass'], sel: ['Chasing Rebounds', 'chases rebounds he can\'t get to; he needs more size to really dominate', 'You chase every rebound. Is that sustainable?'], hes: ['Soft on the Glass', 'is a good rebounder who doesn\'t go after it; he\'d love to see him try harder on the glass', 'You\'re a good rebounder but you don\'t chase them. Why?'], size: true },
  { id: 'onball', k: 'STL', attrs: ['STL'], tend: t => t.stealOnBall, strong: ['On-Ball Defense', 'is a pest on the ball'], sel: ['Reaching In', 'reaches in and gambles; an undisciplined defender', 'You reach a lot. Is that a concern?'] },
  { id: 'lanes', k: 'STL', attrs: ['STL'], tend: t => t.stealOffBall, strong: ['Passing Lane Defense', 'jumps the passing lanes'], sel: ['Gambling On Passes', 'gambles on passes and gets burned', 'You gamble on passes a lot. Is that smart?'] },
  { id: 'block', k: 'BLK', attrs: ['BLK'], tend: t => t.block, strong: ['Shot Blocking', 'is a real shot blocker'], sel: ['Staying Grounded', 'chases blocks he doesn\'t get; an undisciplined defender who fouls', 'You go for a lot of blocks. Do you foul too much?'], size: true },
];
function gameRead(p) {
  const t = p.tendencies;
  if (!t) return [];
  const out = [];
  for (const ar of GAME_AREAS) {
    const v = ar.attrs.reduce((a, k) => a + p.attributes[k][0], 0) / ar.attrs.length;
    const tv = ar.tend(t);
    const add = (kind, [label, text, q], gap) => out.push({ area: ar.id, k: ar.k, kind, label, text, q, gap, size: !!ar.size });
    if (v < 10 && tv > 0 && ar.sel) add('weak', ar.sel, tv + (10 - v));
    else if (ar.over && tv >= 0 && p.attributes.PAS[0] < 10) add('weak', ar.over, tv + (10 - p.attributes.PAS[0]));
    else if (v >= 12 && tv <= (ar.id === 'inside' ? -5 : ar.id === 'pass' ? -4 : -3) && ar.hes) add('weak', ar.hes, -tv + (v - 11));
    else if (v >= 14 && tv >= 0 && ar.strong) add('strong', ar.strong, v - 13);
  }
  return out;
}
// How he answers, shaped by his personality: motor, drive, confidence, ego.
function traitQuote(p, what, flag) {
  if (!traitsSet(p)) return '';
  const motor = tr(p, 'motor'), win = tr(p, 'winning'), riser = tr(p, 'playoffRiser'), room = tr(p, 'lockerRoom'), money = tr(p, 'money');
  const hes = flag?.label?.includes('Hesitance') || flag?.label === 'Tunnel Vision' || flag?.label === 'Passive Finishing';
  if (motor <= 5) return vary2(p, 21, [`I know I'll get there one day.`, `It'll come with time. I'm not stressing it.`, `I'll figure out my ${what} eventually.`]);
  if (motor >= 16) return vary2(p, 22, [`I'm in the gym before anyone else. My ${what} is getting fixed.`, `That's what summers are for. I'll live in the gym on my ${what}.`]);
  if (hes && riser <= 4) return vary2(p, 23, [`I get in my own head sometimes. I overthink it.`, `When the lights get bright I tighten up. I'm working on it.`]);
  if (win <= 4) return vary2(p, 24, [`I just play my game. The rest takes care of itself.`, `I don't lose sleep over it.`]);
  if (room <= 4) return vary2(p, 25, [`Honestly, that's on how I was coached.`, `Everybody has an opinion. I'll prove them wrong.`]);
  if (money >= 16 && flag && !hes) return vary2(p, 26, [`I play to the numbers. That's what moves the needle.`]);
  return '';
}
// The scouts' side of his work ethic and body, from the traits that bear on it.
function ethicLine(p, flag) {
  if (!traitsSet(p)) return '';
  const motor = tr(p, 'motor'), win = tr(p, 'winning'), dur = tr(p, 'durability'), riser = tr(p, 'playoffRiser'), room = tr(p, 'lockerRoom');
  const hes = flag?.label?.includes('Hesitance') || flag?.label === 'Tunnel Vision' || flag?.label === 'Passive Finishing';
  if (motor <= 5) return 'his work ethic is a real question';
  if (motor >= 16) return 'he\'ll put in the work to get there';
  if (hes && riser <= 4) return 'he tightens up when it counts';
  if (flag && (flag.area === 'dribble' || flag.label === 'Tunnel Vision' || flag.label === 'Forcing Passes') && room <= 4) return 'he plays for himself';
  if (flag && (flag.area === 'dribble' || flag.label === 'Tunnel Vision') && room >= 16) return 'a natural leader, he\'ll learn to share it';
  if (flag?.size && dur <= 4) return 'his body may limit how far it goes';
  if (win <= 4 && flag && ['onball', 'lanes', 'block', 'oreb', 'dreb'].includes(flag.area)) return 'he doesn\'t seem bothered by it';
  return '';
}
// One scout line for a flagged weakness: what the game sees, room to grow
// (with his frame where size matters) and what his traits say about getting there.
// Skills that help a weakness in each area.
const SKILL_COVER = {
  three: ['SPO', 'VOL', 'LIM'], mid: ['UNF', 'STE', 'SPO'], inside: ['CRA', 'SOF', 'TEA', 'BUL'], dunk: ['DUN', 'HIG', 'CRA'],
  dribble: ['FOO', 'STE'], pass: ['DIM', 'CHE', 'HOT'], oreb: ['CLE', 'MAG'], dreb: ['MAG'], onball: ['CLA', 'LOC'], lanes: ['BAL', 'TWO'], block: ['SNA', 'CLA'],
};
// The skills a player has earned (beyond the free ones every player gets).
const earnedSkills = p => (p.skills || []).filter(x => x.level >= 1 && !isFreeSkill(x.id) && SKILL_INFO[x.id])
  .sort((a, b) => (isEliteSkill(b.id) - isEliteSkill(a.id)) || b.level - a.level);
function fullTake(p, f) {
  const room = f.k && SKILL_ATTRS.includes(f.k) ? roomFor(p, f.k) : 0;
  const frame = frameRoom(p);
  let growth = room >= 4 ? 'with a lot of room to grow' : room >= 2 ? 'with some room to grow' : 'with little room left';
  if (f.size) growth = room >= 4 ? (frame >= 0.35 ? 'with a frame to build on and a high ceiling' : 'with a high ceiling but a frame that limits him') : growth;
  const eth = ethicLine(p, f);
  const sk = (SKILL_COVER[f.area] || []).find(id => (p.skills || []).some(x => x.id === id && x.level >= 1));
  return `${f.text}, ${growth}${eth ? `; ${eth}` : ''}${sk ? `. On the plus side, he ${skillSays(sk)} (${skillName(sk)})` : ''}`;
}
const tendFlags = p => gameRead(p).filter(f => f.kind === 'weak').sort((a, b) => b.gap - a.gap).map(f => ({ ...f, quote: traitQuote(p, GROWTH[f.k] || 'game', f) || `I'm working on it.` }));
function scoutTake(p, a, room, what) {
  const tf = tendFlags(p).find(f => f.k === a);
  if (tf) return `Scouts: ${fullTake(p, tf)}.`;
  const hit = (COVER[a] || []).find(([k]) => p.attributes[k][0] >= 15);
  if (hit) return `Scouts: ${hit[1]}.`;
  const tail = room >= 4 ? vary2(p, 11, [`there's a lot of room to grow in his ${what}, and that's where the upside lives.`, `his ${what} has real room; with the right staff it becomes a strength.`])
    : room >= 2 ? vary2(p, 12, [`his ${what} should tick up, but don't count on it becoming a weapon.`, `some room in his ${what}; it gets to average, not much more.`])
    : vary2(p, 13, [`his ${what} is about what it'll be. Teams have to be comfortable with that.`, `don't expect his ${what} to change much; he'll have to win with the rest of his game.`]);
  return `Scouts: ${tail}`;
}
const growthNote = (room, what) => room >= 4 ? `real room to grow in his ${what}.`
  : room >= 2 ? `his ${what} should get better, but not by a lot.`
  : `his ${what} is close to what it'll be.`;
const scoringRoom = p => Math.max(roomFor(p, 'LAY'), roomFor(p, 'MID'), roomFor(p, 'TPT'));
// Physical ratings don't move after the draft in the game, so a frame read
// is about time and room: youth, height and how light he is for a pro at
// his position. 0 (filled out) – 1 (lots of room).
function frameRoom(p) {
  const peers = league().teams.flatMap(t => t.roster).filter(x => Math.abs(x.pos - p.pos) <= 1 && x.wt > 0);
  const avgWt = peers.length ? peers.reduce((a, x) => a + x.wt, 0) / peers.length : p.wt;
  const avgHt = peers.length ? peers.reduce((a, x) => a + x.ht, 0) / peers.length : p.ht;
  const youth = Math.max(0, Math.min(1, (23 - p.age) / 4));          // 19 → 1, 23+ → 0
  const light = Math.max(0, Math.min(1, (avgWt - p.wt) / 25 + 0.4)); // lighter than pros = more to add
  const long = Math.max(0, Math.min(1, (p.ht - avgHt) / 4 + 0.5));   // a taller frame carries more
  return Math.max(0, Math.min(1, youth * 0.5 + light * 0.3 + long * 0.2));
}
// What the strength program can still do for him, from the same odds it
// runs on: age (years left in the program), frame, size and potential.
const frameNote = (p, who = 'Strength staff', kind = 'frame') => {
  const odds = strengthOdds(p), yrs = Math.max(0, STR_MAX_AGE - p.age), r = frameRoom(p);
  const size = `${heightStr(p.ht)}, ${p.wt} lbs`;
  const body = r >= 0.6 ? 'a frame with room to fill out' : r >= 0.35 ? 'a frame that can add a little' : 'a frame that is mostly filled out';
  const what = kind === 'motor' ? 'conditioning' : kind === 'test' ? 'his testing numbers' : 'his strength and physical ratings';
  const horizon = yrs >= 5 ? `${yrs} more summers of program work` : yrs >= 2 ? `a few more summers of program work` : yrs === 1 ? 'one more summer of program work' : 'no more program summers';
  const out = odds >= 0.55 ? `${size}, ${body}. At ${p.age} with ${horizon}, expect ${what} to move for real.`
    : odds >= 0.35 ? `${size}, ${body}. With ${horizon}, ${what} should improve, but gradually.`
    : odds >= 0.2 ? `${size}, ${body}. ${what[0].toUpperCase()}${what.slice(1)} can still tick up some, though not by much, with ${horizon}.`
    : `${size}, ${body}. At ${p.age} the program is mostly maintenance; ${what} won't change much.`;
  return `${who}: ${out}`;
};

// The questions this prospect can be asked: the standard ones, plus his
// scouting report's weaknesses, his motor, and the combine when it matters.
function workoutQs(p) {
  const r = scoutingReport(p, league(), scoutPot(p), state.data.seasonLeagues);
  const qs = r.weaknesses.map(w => ({ k: `w:${w.k}`, q: `Scouts say "${w.text.charAt(0).toLowerCase() + w.text.slice(1)}." What's your answer?` }));
  const peers = league().teams.flatMap(t => t.roster).filter(x => Math.abs(x.pos - p.pos) <= 1);
  const stm = peers.length ? peers.reduce((a, x) => a + x.attributes.STM[0], 0) / peers.length : 14;
  if (!qs.some(x => x.k === 'w:STM') && p.attributes.STM[0] < stm - 1.5) qs.push({ k: 'motor', q: 'Some teams question your motor. What do you say to that?' });
  if (combineOn()) {
    const x = combineData().byId.get(p.id);
    if (x?.skip) qs.push({ k: 'skip', q: 'Why didn\'t you test at the combine?' });
    else if (x && x.bonus < -0.25) qs.push({ k: 'combine', q: 'The combine numbers weren\'t great. What did they get wrong?' });
  }
  const tf = tendFlags(p)[0];
  if (tf) qs.push({ k: `t:${tf.area}`, q: tf.q });
  if (r.strengths.length) qs.push({ k: 'best', q: 'What\'s the best part of your game?' });
  return [...qs,
    { k: 'body', q: 'How\'s the body holding up?' },
    { k: 'ready', q: 'Are you ready to play right away, or do you need time?' },
    { k: 'fit', q: 'How do you see yourself fitting with us?' },
    { k: 'future', q: 'Where do you see yourself in five years?' },
    { k: 'model', q: 'Who do you model your game after?' },
    { k: 'work', q: 'What do you need to work on?' },
  ];
}
const OLD_Q = { work: 'What do you need to work on?' };
const qText = (p, k) => workoutQs(p).find(x => x.k === k)?.q || OLD_Q[k] || '';

// { quote: his words, staff: what our people think }.
function workoutAnswer(p, k) {
  const r = () => scoutingReport(p, league(), p.pot, state.data.seasonLeagues);
  if (k === 'body') {
    const m = medicalFlag(p);
    if (!m) return { quote: vary2(p, 1, ['I feel great. Haven\'t missed time and I don\'t plan to.', 'Never been healthier. I take care of my body.']), staff: 'Doctors: clean bill of health.' };
    const last = m.major || m.list[m.list.length - 1];
    const part = (injuryName(last).split(' ').pop() || 'injury').replace(/^([A-Z]{2,})$/, '$1');
    const quote = m.level === 'red' ? `The ${part.length <= 3 ? part : part.toLowerCase()} was the hardest thing I've been through. I'm stronger for it, and I'm 100% now.`
      : m.level === 'yellow' ? `The ${part.toLowerCase()} acts up sometimes, but I play through it. It's not a concern.` : 'Nothing serious. A little thing here and there, like everybody.';
    return { quote, staff: `Doctors: ${m.list.map(i => `${injuryName(i)} (${i.yr}, ${i.gamesOut} games)`).join('; ')}. ${m.level === 'red' ? 'They flag it.' : m.level === 'yellow' ? 'Worth watching.' : 'Nothing to worry about.'}` };
  }
  if (k === 'work') {
    const w = r().weaknesses;
    const firstPerson = t => t.toLowerCase().replace(/\bhim\b/g, 'me').replace(/\bhis\b/g, 'my').replace(/\bhe\b/g, 'I').replace(/\bhimself\b/g, 'myself');
    // The scouts' side: what the tape says (tendencies vs ratings), then room to grow or cover.
    const takes = [...tendFlags(p).slice(0, 1).map(f => fullTake(p, f)), ...w.filter(x => SKILL_ATTRS.includes(x.k)).slice(0, 2).map(x => scoutTake(p, x.k, roomFor(p, x.k), GROWTH[x.k] || 'game').replace(/^Scouts: /, '').replace(/\.$/, ''))];
    const uniq = [...new Set(takes)].slice(0, 3);
    return { quote: w.length ? `Honestly? ${w.map(x => firstPerson(x.text)).join(', and ')}. I know it.` : 'I don\'t think there\'s one big thing. Just get better everywhere.', staff: '', scout: uniq.length ? `Scouts: ${uniq.join('. ')}.` : '' };
  }
  if (k === 'motor') {
    return { quote: vary2(p, 2, ['People who say that haven\'t watched me in the fourth quarter. But yeah, my conditioning is my summer focus.', 'That\'s fair. I\'m getting in the best shape of my life this summer.']),
      staff: frameNote(p, 'Trainers', 'motor') };
  }
  if (k.startsWith('t:')) {
    const f = tendFlags(p).find(x => x.area === k.slice(2));
    if (f) return { quote: f.quote, staff: '', scout: `Scouts: ${fullTake(p, f)}.` };
  }
  if (k.startsWith('w:')) {
    const a = k.slice(2);
    if (a === 'HT') return { quote: 'I\'ve been the smaller guy my whole life. I play bigger than I measure.', staff: frameNote(p) };
    const what = GROWTH[a] || 'game';
    if (PHYSICAL.includes(a)) return { quote: vary2(p, a.charCodeAt(0), ['I\'m living in the weight room this summer.', 'Give me a year with a real strength program.']), staff: frameNote(p) };
    const room = a === 'SCO' ? scoringRoom(p) : roomFor(p, a);
    return { quote: traitQuote(p, what, null) || vary2(p, a.charCodeAt(0), [`I hear it. I've been in the gym every day working on my ${what}.`, `That's the old me. Wait until you see my ${what} this year.`, `It's a work in progress. I'm not going to pretend it's not.`]),
      staff: `Coaches: ${growthNote(room, what)}`, scout: scoutTake(p, a, room, what) };
  }
  if (k === 'best') {
    const st = r().strengths[0];
    const what = GROWTH[st?.k] || 'game';
    return { quote: `My ${what}. ${vary2(p, 3, ['Nobody in this class does it better.', 'That translates on day one.', 'That\'s what I hang my hat on.'])}`,
      staff: st?.k && SKILL_ATTRS.includes(st.k) || PHYSICAL.includes(st?.k) ? `Coaches: ${roomFor(p, st.k) >= 3 ? `it's already good and there's more coming.` : `it's about as good as it gets already.`}` : '' };
  }
  if (k === 'ready') {
    const t = myTeam();
    const slot = t ? rosterSlot(t.roster, rookieLine(p, state.params.recoveryBands), p.pos).rank : 99;
    return { quote: p.age >= 22 ? 'I\'m ready now. I\'ve played a lot of college basketball.' : vary2(p, 4, ['I\'m ready now. Throw me out there.', 'Whatever the team needs. If I have to earn it, I\'ll earn it.']),
      staff: slot <= 8 ? 'Coaches: he could crack our rotation as a rookie.' : slot <= 11 ? 'Coaches: bench minutes early, more in year two.' : 'Coaches: he\'s a year or two away from real minutes for us.' };
  }
  if (k === 'fit') {
    const t = myTeam();
    const fills = t ? fillsFor(t, p) : [];
    return fills.length
      ? { quote: `You need ${fills[0].label.toLowerCase().replace(' · ', ' who bring ')}. That's exactly what I do.`, staff: `Front office: he fills ${fills.map(n => n.label).join(' and ')}.` }
      : { quote: 'I\'ll do whatever you need. I just want to win.', staff: 'Front office: he doesn\'t fill one of our needs on paper.' };
  }
  if (k === 'skip') {
    const x = combineData().byId.get(p.id);
    const med = x?.skip?.startsWith('Medical');
    return { quote: med ? 'I wanted to be all the way back before I tested. I didn\'t want to rush it.' : 'My agent and I felt the tape speaks for itself. I wanted to show teams in person.',
      staff: frameNote(p, 'Trainers', 'test') };
  }
  if (k === 'combine') {
    return { quote: vary2(p, 5, ['Drills aren\'t basketball. Put on the tape.', 'I had a bad day. I\'m not a 40-yard-dash guy, I\'m a hooper.']),
      staff: frameNote(p, 'Trainers', 'test') };
  }
  if (k === 'future') {
    const reg = p.regressionAge || 30;
    return { quote: vary2(p, 6, ['An All-Star. Nothing less.', 'Winning. Rings. That\'s it.', 'The best player on a really good team.']),
      staff: `Trainers: ${reg >= 33 ? 'built to last, holding his peak into his mid-30s.' : reg >= 31 ? 'takes care of his body, should hold his peak into his early 30s.' : reg >= 29 ? 'a normal arc, holding his peak until about 30.' : 'peaks early, decline could start in his late 20s.'}` };
  }
  const idol = idolFor(p);
  if (!idol) return { quote: 'Nobody. I want to be the first me.', staff: '' };
  const sim = Math.max(0, Math.round(100 - idol.dist * 3));
  // Sometimes the room reads the comparison as a reach: his ceiling is below the idol's.
  const gap = (idol.pot || 0) - (p.pot || 0);
  const roll = ((p.id * 2654435761) >>> 0) % 100;
  const stretch = gap >= 2 ? roll < 80 : gap >= 1 ? roll < 55 : sim < 40 ? roll < 25 : false;
  if (stretch) return { quote: vary2(p, 7, [`${idol.name}. I grew up watching him.`, `${idol.name}, for sure. I had his poster on my wall.`]),
    staff: vary2(p, 8, [`Scouts: that's a stretch. ${idol.last} is a lofty comparison for a player with this ceiling.`, `Scouts: nice to dream, but ${idol.last} is a lofty comparison. Don't count on that ceiling.`, `Scouts: he'd love to be ${idol.last}, but that's a reach for where his game tops out.`]) };
  return { quote: vary2(p, 7, [`${idol.name}. I grew up watching him.`, `${idol.name}, for sure. I had his poster on my wall.`, `${idol.name}. I used to study his tape as a kid.`]),
    staff: sim >= 60 ? `Scouts: you can see a lot of ${idol.last} in his game.` : sim >= 40 ? `Scouts: there are flashes of ${idol.last} in his game.` : `Scouts: different players, but you can see where the inspiration comes from.` };
}

// Who a prospect grew up idolizing: a star (All-Star tier or better) about
// 10–20 years older who was playing in this league while the prospect was a
// kid (ages 8–18), with a game like his. Not his ceiling comp.
function idolFor(p) {
  const L = league();
  const cur = L.season.currentYear;
  const born = cur - p.age;
  const kid = [born + 8, born + 18];
  const v = projectedCeiling(p, p.pot);
  const proYears = x => (x.stats || []).filter(s => s.league === state.leagueIdx && (s.season || []).some(r => r.GP > 0)).map(s => s.yr);
  const bornOf = x => {
    const ys = proYears(x);
    if (x.history?.draft?.yr) return x.history.draft.yr - 20;
    if (ys.length) return Math.min(...ys) - 20;
    return cur - (x.age || 0);
  };
  let best = null;
  for (const e of compPool()) {
    const x = e.p;
    if (x.id === p.id || (x.pot || 0) < 8) continue;
    const gap = born - bornOf(x);
    if (gap < 10 || gap > 20) continue;
    const ys = proYears(x);
    if (ys.length && ys.filter(y => y >= kid[0] && y <= kid[1]).length < 2) continue;
    const d = compDistance(v, { ht: p.ht, wt: p.wt, pos: p.pos }, e) - ((x.pot || 8) - 8) * 2.5;
    if (!best || d < best.score) best = { score: d, dist: compDistance(v, { ht: p.ht, wt: p.wt, pos: p.pos }, e), name: playerName(x), last: x.ln || playerName(x), pot: x.pot || 0 };
  }
  return best;
}
const answerHtml = a => typeof a === 'string' ? esc(a) : `<span class="wk-quote">"${esc(a.quote)}"</span>${a.staff ? `<br><span class="muted">${esc(a.staff)}</span>` : ''}${a.scout ? `<br><span class="muted">${esc(a.scout)}</span>` : ''}`;

function workoutResult(p) {
  if (!workoutDone(p.id)) return `<span class="muted">Workout in progress: the full read comes after the interview.</span>`;
  const before = scoutedPot(p, saveSalt(), scoutFog());
  const t = tierFor(p.pot);
  if (before === p.pot) return `Our scouts had him right: ${t} ceiling. Every rating's ceiling is now on his page.`;
  return before < p.pot ? `<span class="up">Better than we thought: ${t} ceiling (we had ${tierFor(before)}).</span>`
    : `<span class="down">Not what we hoped: ${t} ceiling (we had ${tierFor(before)}).</span>`;
}

// Instant read: the scouting network confirms a prospect's true potential
// (no workout needed), a limited number a draft.
const revealsLeft = () => FX.facilityFx(myTeam()).reveals - Object.keys(preStore().reveals || {}).length;
function revealBox(p) {
  const max = FX.facilityFx(myTeam()).reveals;
  if (!max || workoutDone(p.id)) return '';
  if (revealed(p.id)) return `<p class="note small up">🔍 Scouts confirmed his potential.</p>`;
  const left = revealsLeft();
  return `<button class="btn small ${left > 0 ? '' : 'off'}" data-act="revealPot" data-id="${p.id}" ${left > 0 ? '' : 'disabled'}>🔍 Instant potential read · ${Math.max(0, left)} of ${max} left</button>`;
}
actions.revealPot = d => {
  const pre = preStore();
  if (revealsLeft() <= 0 || revealed(+d.id)) return;
  (pre.reveals ||= {})[+d.id] = true;
  savePre();
  state.compCache = {};
  const p = league().draftClass.find(x => x.id === +d.id);
  if (p) toast(`${playerName(p)}: ${tierFor(p.pot)} potential confirmed`);
  render();
};
function workoutBox(p) {
  const w = preStore().workouts[p.id];
  if (!w) return '';
  return `<fieldset class="frame"><legend>Private Workout${workoutDone(p.id) ? ' ✓' : ''}</legend>
    <p class="note small">${workoutResult(p)}</p>
    ${w.qs.map(k => `<p class="note small wk-a" style="margin-top:6px"><b>${esc(qText(p, k))}</b><br>${answerHtml(workoutAnswer(p, k))}</p>`).join('')}
  </fieldset>`;
}

screens.workouts = (args) => {
  const L = league();
  const pre = preStore();
  const ids = Object.keys(pre.workouts).map(Number);
  const byId = new Map(L.draftClass.map(p => [p.id, p]));
  const cap = workoutSlots();
  const left = cap - ids.length;
  const inGym = ids.map(id => byId.get(id)).filter(Boolean).map(p => {
    const w = pre.workouts[p.id];
    const more = interviewQs() - w.qs.length;
    return `<div class="workout">
      <div class="wk-head"><button class="linkish" data-act="openProspect" data-id="${p.id}">${esc(playerName(p))}</button> <span class="muted small">${esc(posName(p))} · ${p.age}y · ${classYear(p)}</span></div>
      <p class="note small">${workoutResult(p)}</p>
      ${w.qs.map(k => `<p class="note small wk-a"><b>${esc(qText(p, k))}</b><br>${answerHtml(workoutAnswer(p, k))}</p>`).join('')}
      ${w.qs.length >= interviewQs() && FX.facilityFx(myTeam()).goodCop && w.qs.length < 6 ? `<p class="note muted small">Good cop, bad cop: ask the rest.</p>${interviewPairs(p).flat().filter(x => !w.qs.includes(x.k)).map(x => `<button class="btn small off wk-q" data-act="askQ" data-id="${p.id}" data-k="${esc(x.k)}">💬 ${esc(x.q)}</button>`).join('')}` : ''}
      ${more > 0 && interviewPairs(p)[w.qs.length] ? `<p class="note muted small">Question ${w.qs.length + 1} of ${interviewQs()}: pick one.</p>${interviewPairs(p)[w.qs.length].map(x => `<button class="btn small off wk-q" data-act="askQ" data-id="${p.id}" data-k="${esc(x.k)}">💬 ${esc(x.q)}</button>`).join('')}` : ''}
    </div>`;
  }).join('');
  const pool = myBoardOrder().filter(p => !pre.workouts[p.id]);
  const shown = args.all ? pool : pool.slice(0, 40);
  layout({
    title: 'Private Workouts',
    body: `<p class="note small">Bring prospects in to work out. Three rounds of questions: pick one of two each time.${FX.facilityFx(myTeam()).goodCop ? ' Good cop, bad cop: once he\'s done you can ask the other three too.' : ''} After the interview you'll know his true ceiling and every rating's ceiling. <b>${left} of ${cap}</b> slots left.</p>
      ${inGym ? `<fieldset class="frame"><legend>In the Gym</legend><div class="stack">${inGym}</div></fieldset>` : ''}
      <fieldset class="frame"><legend>Invite</legend>
        <p class="note muted small" style="margin-bottom:6px">Your board first, then the rest of the class.</p>
        <div class="stack">${shown.map(p => `<div class="drill-row">
          <span class="grow"><b>${onBoard(p.id) ? '<span class="gold">★</span> ' : ''}${esc(playerName(p))}</b> ${valueChip(p)}<br><span class="small muted">${esc(posName(p))} · ${p.age}y · ${classYear(p)} · ${heightStr(p.ht)}</span></span>
          <button class="btn small ${left ? 'focus' : 'off'}" data-act="invite" data-id="${p.id}" ${left ? '' : 'disabled'}>Bring In</button></div>`).join('')}</div>
        ${!args.all && pool.length > 40 ? `<button class="btn small" data-act="workoutAll" style="margin-top:8px">Show all ${pool.length}</button>` : ''}
      </fieldset>`,
    action: isStep('workouts') ? { act: 'preAdvance', label: 'Advance to the Draft', k: 'workouts' } : null,
  });
};
actions.invite = d => {
  const pre = preStore();
  if (Object.keys(pre.workouts).length >= workoutSlots()) return;
  pre.workouts[+d.id] = { qs: [] };
  savePre();
  render();
};
actions.askQ = d => {
  const w = preStore().workouts[+d.id];
  const p0 = league().draftClass.find(x => x.id === +d.id);
  const cop = FX.facilityFx(myTeam()).goodCop;
  if (!w || !p0 || w.qs.length >= (cop ? 6 : interviewQs()) || w.qs.includes(d.k)) return;
  // Only one of this round's pair can be asked, until the interview is done:
  // then good cop, bad cop opens the rest.
  if (w.qs.length < interviewQs()) { if (!(interviewPairs(p0)[w.qs.length] || []).some(x => x.k === d.k)) return; }
  else if (!interviewPairs(p0).flat().some(x => x.k === d.k)) return;
  w.qs.push(d.k);
  savePre();
  if (w.qs.length === interviewQs()) {
    state.compCache = {};
    const p = league().draftClass.find(x => x.id === +d.id);
    if (p) toast(`Workout done: ${playerName(p)}`, 'His ceiling and every rating\'s ceiling are on his page.');
  }
  render();
};
actions.workoutAll = () => replace('workouts', { all: true });

// College class from years already played (Hoop Land's `yrs`).
const classYear = p => ['Fr', 'So', 'Jr', 'Sr'][Math.max(0, Math.min(3, p.yrs ?? (p.age - 18)))];


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
        ${offers.length ? `<div class="stack">${offers.map((o, i) => `<div class="offer"><p class="note small"><b>${esc(o.team.shortName)}</b> ${o.kind === 'up' ? 'want to move up' : 'offer'} ${offerRating(o)}: ${esc(o.give.map(x => x.text).join(' + '))}<br><span class="muted">for ${esc(o.get.map(x => x.text).join(' + '))}</span></p>
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
// How an offer stacks up against what you're sending.
const offerRating = o => o.ratio == null ? '' : o.ratio >= 0.93 ? '<span class="badge new">Strong</span>' : o.ratio >= 0.78 ? '<span class="badge">Fair</span>' : '<span class="badge down-b">Light</span>';
function frontOfficeOffers(team, { only = null, max = 3 } = {}) {
  const L = league();
  const ds = draftState();
  const block = ds.block || new Set();
  const rng = mulberry32((ds.offerSeed ||= Math.floor(Math.random() * 1e9)));
  const mineAll = liveAssets(team).filter(x => !x.locked);
  const onBlock = mineAll.filter(x => only ? x.key === only : block.has(x.key));
  const out = [];
  const ly = lastYear();
  const others = L.teams.filter(t => !isUserTeam(t)).sort(() => rng() - 0.5);
  const text = x => x.pick ? (x.key.startsWith('c:') ? `#${x.key.slice(2)}` : pickLabel(x.pick))
    : `${playerName(x.player)} (Lv ${shownLevel(x.player)}${contractText(x.player) ? `, ${contractText(x.player)}` : ''}${contractValue(x.player).tag ? `, ${contractValue(x.player).tag}` : ''})`;
  for (const want of onBlock) {
    let n = 0;
    for (const t of others) {
      if (n >= max) break;
      if (rng() < (only ? 0.15 : 0.45)) continue;
      const stars = new Set([...t.roster].sort((a, b) => playerValue(b, state.leagueIdx, ly) - playerValue(a, state.leagueIdx, ly)).slice(0, 2));
      const theirs = liveAssets(t).filter(x => !x.prospect && !x.locked && !(x.player && stars.has(x.player))).sort((a, b) => a.value - b.value);
      // What they'd put up: anywhere from a light offer to full value (the
      // rating shows which).
      const lo = want.value * 0.5, hi = want.value * 1.02, target = want.value * (0.62 + rng() * 0.4);
      const cands = [];
      // Teams over the cap have to send salary back to take his.
      const capOk = c => !FA.tradeCheck(L, { team, players: want.player ? [want.player] : [] }, { team: t, players: c.filter(x => x.player).map(x => x.player) });
      for (let i = 0; i < theirs.length; i++) {
        if (theirs[i].value >= lo && theirs[i].value <= hi && capOk([theirs[i]])) cands.push([theirs[i]]);
        for (let j = i + 1; j < theirs.length && cands.length < 400; j++) {
          const v = theirs[i].value + theirs[j].value;
          if (v >= lo && v <= hi && capOk([theirs[i], theirs[j]])) cands.push([theirs[i], theirs[j]]);
        }
      }
      const val = c => c.reduce((a, x) => a + x.value, 0);
      cands.sort((a, b) => Math.abs(val(a) - target) - Math.abs(val(b) - target));
      const pack = cands[0];
      if (!pack) continue;
      const give = [pack].flat();
      // Skip pointless swaps (their 2030 R1 for your 2030 R1).
      if (give.length === 1 && give[0].pick && want.pick && give[0].pick.yr === want.pick.yr && give[0].pick.rd === want.pick.rd) continue;
      out.push({ team: t, kind: 'block', ratio: give.reduce((a, x) => a + x.value, 0) / Math.max(1, want.value), give: give.map(x => ({ ...x, text: text(x) })), get: [{ ...want, text: text(want) }] });
      n++;
    }
  }
  // Teams a few slots behind your picks calling to move up.
  const order = actualDraftOrder(L) || [];
  order.forEach((o, idx) => {
    if (o.owner.id !== team.id) return;
    for (const x of tradeUpOffers(L, order, idx, { value: futureValue, slot: slotValue, rng, count: 1, eager: 0.7, frozen: frozenFn })) {
      out.push({ team: x.team, kind: 'up',
        give: x.give.map(pk => ({ pick: pk, key: pk.yr === L.season.currentYear ? `c:${order.find(q => slotPick(L, q) === pk)?.overall}` : `f:${pk.yr}:${pk.rd}:${pk.otid}`, text: pk.yr === L.season.currentYear ? `#${order.find(q => slotPick(L, q) === pk)?.overall}` : pickLabel(pk) })),
        get: [{ pick: x.get, key: `c:${o.overall}`, text: `#${o.overall}` }] });
    }
  });
  out.sort((a, b) => (b.ratio ?? 1) - (a.ratio ?? 1));
  // Only deals that work under the cap rules.
  const side = (t, items) => ({ team: t, players: items.filter(x => x.player).map(x => x.player) });
  return out.filter(o => { const a = side(team, o.get), b = side(o.team, o.give); a.picks = o.get.filter(x => x.pick).map(x => x.pick); b.picks = o.give.filter(x => x.pick).map(x => x.pick); return !tradeRulesErr(L, a, b) && !ntcRefusal(L, a, b); });
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
  if (await doOffer(team, o)) { for (const x of o.get) ds.block?.delete(x.key); ds.offers = null; render(); }
};
// Confirm and make an offer's trade. → true when it went through.
async function doOffer(team, o) {
  const L = league();
  if (!(await confirmBox(`Send ${esc(o.get.map(x => x.text).join(' + '))} to ${esc(o.team.shortName)} for ${esc(o.give.map(x => x.text).join(' + '))}?`, 'Accept'))) return false;
  const side = (t, items) => ({ team: t, picks: items.filter(x => x.pick).map(x => x.pick), players: items.filter(x => x.player).map(x => x.player), prospects: [] });
  const sa = side(team, o.get), sb = side(o.team, o.give);
  const capErr = tradeRulesErr(L, sa, sb) || ntcRefusal(L, sa, sb);
  if (capErr) { toast('Trade not allowed', capErr, 3200, true); return false; }
  if (!(await physicals(L, sa, sb))) return false;
  liveExecute(sa, sb);
  return true;
}

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
        .map(([k, v], i) => i < 5 && c.li != null
          ? `<button class="stat-cell" data-act="openLeaders" data-m="college" data-k="${RANK_STATS[i][0]}" data-li="${c.li}" data-yr="${c.yr}" aria-label="College ${RANK_STATS[i][1]} leaders"><span class="muted small">${k}</span><b>${v}</b>${collegeRank(p, c, RANK_STATS[i][0])}</button>`
          : `<div><span class="muted small">${k}</span><b>${v}</b>${i < 5 ? collegeRank(p, c, RANK_STATS[i][0]) : ''}</div>`).join('')}
    </div>${c.li != null && seasonRanks(c.yr, c.li).ranks.get(p.id)?.qualified ? (sr => `<p class="note muted small" style="margin-top:6px">Ranks among ${sr.of} qualified college players. Qualified: at least ${sr.minGp} games played, half of the league high (${sr.maxGp}).</p>`)(seasonRanks(c.yr, c.li)) : ''}</fieldset>`;
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
  const compRow = (label, list) => `<div class="pcomp"><span class="pcomp-lbl">${label}</span><div class="pcomp-list">${list.map(x => `<div>
    <div class="pcomp-name"><b>${esc(x.name)}</b>${tierTag(x.tier)}</div>
    <span class="muted small">${esc(POSITIONS[x.pos] ?? '')} · ${heightStr(x.ht)}${x.wt ? ` · ${x.wt} lb` : ''}</span></div>`).join('') || '<span class="muted">—</span>'}</div></div>`;
  layout({
    title: 'Prospect',
    body: `
      <div class="pros-head">
        <button class="mvbtn pros-add ${onBoard(p.id) ? 'on' : ''}" data-act="toggleBoard" data-id="${p.id}" aria-label="${onBoard(p.id) ? 'Remove from' : 'Add to'} your board">${onBoard(p.id) ? '✓' : '+'}</button>
        <h2 class="team-title">${esc(playerName(p))}</h2>
        <p class="note">${esc(collegeLine(p, state.data.seasonLeagues)?.team || 'Prospect')} · ${esc(posName(p))} · ${heightStr(p.ht)} · ${p.wt} lb</p>
        <p class="note small"><span class="age-chip">Age ${p.age} · ${classYear(p)}</span></p>
      </div>
      ${collegeBox(p)}
      <fieldset class="frame"><legend>Scouting Report</legend>${scoutList(p)}</fieldset>
      <fieldset class="frame"><legend>Player Comps</legend>${compRow('Ceiling', c.ceiling)}${compRow('Floor', c.floor)}</fieldset>
      ${playStyleBox(p)}
      ${traitsBox(p, true)}
      ${workoutBox(p)}${revealBox(p)}${combineBox(p)}
      <fieldset class="frame"><legend>Ratings</legend>
        <div class="rk-head rk2"><span></span><span>Now</span><span>Ceiling</span></div>
        ${[...SKILL_ATTRS, ...PHYSICAL].map(k => {
          const now = p.attributes[k][0];
          const ceil = Math.min(ATTR_MAX, Math.max(now, SKILL_ATTRS.includes(k) ? cv[SKILL_ATTRS.indexOf(k)] : p.attributes[k][1]));
          const known = ceilKnown(p, k);
          return `<div class="rk rk2">
          <span>${k} <span class="muted small">${ATTR_NAMES[k]}</span></span>
          <span>${now}</span>
          <span class="${known ? 'gold' : 'muted'}">${known ? ceil : '?'}</span>
          <div class="${barClass(k)}">${known ? `<div class="room" style="width:${ceil / ATTR_MAX * 100}%"></div>` : ''}<div class="fill" style="width:${now / ATTR_MAX * 100}%"></div>${known ? `<div class="ceil" style="left:calc(${ceil / ATTR_MAX * 100}% - 2px)"></div>` : ''}</div>
        </div>`;
        }).join('')}
        <p class="note muted small" style="margin-top:8px">The filled bar is today's rating; the outlined part runs to the projected ceiling (the notch). <b>?</b> = not scouted yet: some ceilings come out during scouting and the combine, and a private workout shows them all.</p>
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
      <p class="note muted small" style="margin-bottom:8px">The lottery has been drawn in this save.</p>
      <div class="list">${result.map((r, i) => {
        const move = r.seed - i;
        const rr = rec.get(r.team.id);
        return `<div class="lot-row ${isUserTeam(r.team) ? 'mine' : ''}"><span class="pk">${i + 1}</span>${logoImg(r.team)}<span class="grow">${esc(r.team.shortName)} <span class="muted small">${rr.W}-${rr.L}</span></span>
          ${move > 0 ? `<span class="up">▲${move}</span>` : move < 0 ? `<span class="down">▼${-move}</span>` : '<span class="muted">—</span>'}</div>`;
      }).join('')}</div>
</fieldset>`,
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
</fieldset>` : ''}
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
      <div class="lot-go"><button class="btn big focus" data-act="advLottery">🎱 Begin Lottery</button><button class="btn big" data-act="simLotteryNow">⏭ Sim</button></div>
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
  // While revealing: every lottery team in a little box with its odds at #1,
  // best odds first. As picks come in, placed teams dim (showing their pick)
  // and the odds of the teams still waiting update.
  const totalW = setup.odds.slice(0, setup.lotteryTeams.length).reduce((a, w) => a + (w || 0), 0) || 1;
  // Even rows: the column count that splits the teams evenly (16 → 8 × 2, 14 → 7 × 2).
  const nTeams = setup.lotteryTeams.length;
  const cols = [8, 7, 6, 5, 4].find(c => nTeams % c === 0) || Math.ceil(nTeams / 2);
  // Top 4 / Old School: only the top `draws` picks are drawn; the rest go by
  // record, which lets the reveal lock teams into the top picks early.
  const drawsOnly = !setup.floor && setup.draws < nTeams ? setup.draws : 0;
  const tray = state.lotteryReveal ? `<div class="lot-tray" data-draws="${drawsOnly}"><span class="lot-tray-label">Odds at #1</span><div class="lot-chips" style="--cols:${cols}">${setup.lotteryTeams
    .map((t, seed) => ({ t, seed, w: setup.odds[seed] ?? 0 })).sort((a, b) => b.w - a.w || a.seed - b.seed)
    .map(({ t, seed, w }) => `<span class="lot-chip ${isUserTeam(t) ? 'mine' : ''}" data-tid="${t.id}" data-w="${w}" data-seed="${seed}" data-pct="${(() => { const r = rec.get(t.id); return r && r.W + r.L ? r.W / (r.W + r.L) : 0; })()}"><b>${esc(t.shortName)}</b><span class="pct">${(w / totalW * 100).toFixed(1)}%</span></span>`).join('')}</div></div>` : '';
  layout({
    title: 'Draft Lottery',
    body: `${tray}<div class="list lot-result">${order.map((o, i) => {
        const move = pre.indexOf(o.orig) - i;
        const rr = rec.get(o.orig.id);
        return `<div class="lot-row ${isUserTeam(o.owner) ? 'mine' : ''}" data-tid="${o.orig.id}" data-pick="${i + 1}" data-name="${esc(`${o.orig.city} ${o.orig.name}`.trim())}" data-move="${move}"><span class="pk">${i + 1}</span>${logoImg(o.orig)}
          <span class="grow">${esc(o.orig.shortName)} <span class="muted small">${rr ? `${rr.W}-${rr.L}` : ''}</span> ${statusTag(teamStatus(L, o.orig))}${o.owner.id !== o.orig.id ? ` <span class="small gold">→ ${esc(o.owner.shortName)}</span>` : ''}</span>
          <span class="mv ${move > 0 ? 'up' : move < 0 ? 'down' : 'muted'}">${move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : '—'}</span></div>`;
      }).join('')}</div>`,
  });
  if (state.lotteryReveal) { state.lotteryReveal = false; revealLottery(); }
}

// A team's pick is in: dim its box (showing the pick) and recompute the
// #1 odds of the teams still waiting from their lottery weights.
function updateTray(tid, pick) {
  const tray = $app.querySelector('.lot-tray');
  const chip = $app.querySelector(`.lot-chip[data-tid="${tid}"]`);
  if (chip) { chip.classList.add('out'); chip.classList.remove('locked'); chip.querySelector('.pct').textContent = `#${pick}`; }
  const chips = [...$app.querySelectorAll('.lot-chip')];
  const left = chips.filter(c => !c.classList.contains('out'));
  const draws = +(tray?.dataset.draws || 0);
  let odds;
  if (draws) {
    // Picks after the drawn ones go by record (worst first), so revealing
    // them bottom-up places teams best record first. Any team still waiting
    // with a strictly better record than the last one placed by record must
    // have been drawn: it's locked into the top picks. A team tied with it
    // could still go by record (the game breaks ties), so it isn't locked.
    if (pick > draws) tray.dataset.lastPct = chip?.dataset.pct ?? tray.dataset.lastPct;
    // Drawn picks already revealed (bottom-up, so #3 before #2): they were
    // drawn in those slots, after whoever is still waiting.
    else if (chip) tray.dataset.tail = `${chip.dataset.tid},${tray.dataset.tail || ''}`;
    const lastPct = pick > draws && tray.dataset.lastPct != null ? +tray.dataset.lastPct : Infinity;
    for (const c of left) {
      // Once every by-record pick is placed, everyone left was drawn.
      const lock = pick <= draws + 1 || +c.dataset.pct > lastPct + 1e-9;
      if (lock && !c.classList.contains('locked')) {
        c.classList.add('locked');
        c.insertAdjacentHTML('beforeend', `<span class="lock">🔒 Top ${draws}</span>`);
      }
    }
    const tail = (tray.dataset.tail || '').split(',').filter(Boolean).map(id => $app.querySelector(`.lot-chip[data-tid="${id}"]`));
    odds = drawnOdds(left, draws, tail);
  } else {
    const total = left.reduce((a, c) => a + +c.dataset.w, 0) || 1;
    odds = new Map(left.map(c => [c, +c.dataset.w / total]));
  }
  for (const c of left) {
    const el = c.querySelector('.pct');
    const next = `${(odds.get(c) * 100).toFixed(1)}%`;
    if (el.textContent !== next) { el.textContent = next; c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }
  }
}

// Exact chance at #1 for the teams still waiting when only the top `draws`
// picks are drawn. Every possible set of teams for the unrevealed drawn
// slots (all locked teams plus enough undecided ones), every order of it,
// then the drawn picks already revealed (`tail`, in pick order), each
// weighted by the lottery balls left at that draw.
function drawnOdds(left, draws, tail = []) {
  const w = c => +c.dataset.w;
  const W = [...$app.querySelectorAll('.lot-chip')].reduce((a, c) => a + w(c), 0);
  const locked = left.filter(c => c.classList.contains('locked'));
  const open = left.filter(c => !c.classList.contains('locked'));
  const need = draws - tail.length - locked.length;
  const first = new Map(left.map(c => [c, 0]));
  let total = 0;
  const tailP = rem => tail.reduce((p, c) => { const q = p * w(c) / rem; rem -= w(c); return q; }, 1);
  const orders = (set, rem, p, lead) => {
    if (!set.length) { const m = p * tailP(rem); first.set(lead, first.get(lead) + m); total += m; return; }
    for (const c of set) orders(set.filter(x => x !== c), rem - w(c), p * w(c) / rem, lead ?? c);
  };
  const choose = (start, picked) => {
    if (picked.length === need) { const set = [...locked, ...picked]; if (set.length) orders(set, W, 1, null); return; }
    for (let i = start; i < open.length; i++) choose(i + 1, [...picked, open[i]]);
  };
  if (need >= 0) choose(0, []);
  return new Map(left.map(c => [c, total ? first.get(c) / total : 0]));
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
  const skipped = false; // no skipping: everyone watches the reveal
  const wait = ms => new Promise(r => { const t0 = Date.now(); const tick = () => (skipped || Date.now() - t0 >= ms ? r() : requestAnimationFrame(tick)); tick(); });
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  await wait(500);
  for (const row of [...rows].reverse()) {
    if (!row.isConnected) return; // left the screen
    const pick = +row.dataset.pick;
    const big = pick <= 5;
    row.scrollIntoView({ behavior: skipped ? 'auto' : 'smooth', block: 'center' });
    // Once #2 is in, everyone knows who's #1: no mystery card for the last one.
    const known = pick === 1;
    if (big && !skipped && !known) {
      row.classList.add('tease');
      await wait(pick === 1 ? 2600 : pick === 2 ? 2000 : 1400);
      row.classList.remove('tease');
    }
    row.classList.add('shown');
    updateTray(row.dataset.tid, pick);
    if (big) row.classList.add(pick === 1 ? 'top1' : 'big');
    await wait(big ? 1500 : 2300);
  }
  // Let #1 land, then fold the tray away and glide back to the top of the
  // full order.
  await wait(1200);
  list.classList.remove('revealing');
  const tray = $app.querySelector('.lot-tray');
  if (tray) {
    tray.style.maxHeight = `${tray.scrollHeight}px`;
    void tray.offsetHeight;
    tray.classList.add('gone');
    tray.addEventListener('transitionend', e => { if (e.propertyName === 'max-height') tray.remove(); });
    setTimeout(() => tray.remove(), 1500);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (done) { done.style.display = ''; done.classList.add('fade-in'); }
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
      <div class="stack recap" style="margin-top:8px">${mock.picks.map(pk => {
        const p = pk.pid != null ? byId.get(pk.pid) : null;
        const via = pk.owner.id !== pk.orig.id ? ` <span class="muted">via ${esc(pk.orig.shortName)}</span>` : '';
        const rd = pk.rd > 1 ? ` <span class="muted">R${pk.rd}</span>` : '';
        return pickCard({ overall: pk.overall, team: pk.owner, p, showLv: false, cls: `${isUserTeam(pk.owner) ? 'mine' : ''} ${pk === onClock ? 'clock' : ''}`, extra: { sub: via + rd }, empty: pk === onClock ? 'On the clock' : '—' });
      }).join('')}</div>`,
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
const liveOrder = () => actualDraftOrder(league()) || [];
const lastYear = () => Math.max(...league().teams.map(t => teamRecord(t).yr || 0));
// Roster change each team would see from a trade (for valuing picks).
function tradeAdjust(A, B, itemsA, itemsB) {
  const pl = items => items.filter(x => x.player).map(x => x.player);
  const m = new Map();
  m.set(A.id, { remove: pl(itemsA), add: pl(itemsB) });
  m.set(B.id, { remove: pl(itemsB), add: pl(itemsA) });
  return m;
}
// A trade-list item's value: future firsts re-priced with the deal's roster
// changes and any protection being added.
function pickItemValue(x, prot, adjust) {
  if (!x.pick || !x.key.startsWith('f:')) return x.value;
  return pickValue(league(), x.pick, { adjust, top: protOf(x.pick)?.top || prot[x.key] || 0 });
}
const futureValue = pk => pickValue(league(), pk, { top: protOf(pk)?.top || 0 });
const frozenFn = (t, pk) => FA.pickFrozen(league(), t, pk);
const boardRank = p => boardOrder().indexOf(p) + 1 || 60;
const prospectById = id => league().draftClass.find(p => p.id === id);
const liveAvailable = live => league().draftClass.filter(p => !takenIds(live).has(p.id));

// CPU picks, with the odd CPU trade: a trade-up in round 1, two seconds
// packaged to move up in round 2, or a team flipping a player it just took.
// A team makes one CPU trade a draft at most, and user teams aren't touched.
function liveCpuStep(live, order, idx) {
  const L = league();
  const o = order[idx];
  const chance = state.params.liveCpuTradeChance;
  const busy = new Set([...(live.cpuTeams ||= []), ...L.teams.filter(isUserTeam).map(t => t.id)]);
  const opts = { value: futureValue, slot: slotValue, rng: live.rng, exclude: busy, frozen: frozenFn };
  if (!busy.has(o.owner.id) && live.rng() * 100 < chance) {
    const offer = o.rd === 1 ? tradeUpOffers(L, order, idx, { ...opts, far: 4, count: 1, eager: 0.6 })[0] : consolidationOffer(L, order, idx, opts);
    if (offer && !TR.stepienErr(L, { team: offer.team, picks: offer.give }, { team: o.owner, picks: [offer.get] }, isProt)) {
      liveExecute({ team: offer.team, picks: offer.give, players: [], prospects: [] },
        { team: o.owner, picks: [offer.get], players: [], prospects: [] }, 'CPU');
      live.cpuTeams.push(offer.team.id, o.owner.id);
      order = liveOrder();
    }
  }
  const team = order[idx].owner;
  const p = teamDraftPick(team, liveAvailable(live), live.rng);
  if (!p) return false;
  makeSelection(live, order, idx, p.id);
  const ov = order[idx].overall;
  if (order[idx].rd === 1 && ov >= 4 && !busy.has(team.id) && !live.cpuTeams.includes(team.id) && live.rng() * 100 < chance * 0.6) {
    const deal = rightsTradeOffer(L, order, ov, { ...opts, exclude: new Set([...busy, ...live.cpuTeams]) });
    if (deal) {
      liveExecute({ team: deal.team, picks: deal.give, players: [], prospects: [] },
        { team, picks: [], players: [], prospects: [ov] }, 'CPU');
      live.cpuTeams.push(deal.team.id, team.id);
    }
  }
  return true;
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

// Pro leagues are labelled by the year a season starts in the user's
// setup (a 2027 file's first offseason is the 2027 offseason and its draft
// the 2027 draft), one less than the save's own year.
const dispYr = y => (isCollege() ? y : y - 1);
const pickLabel = (pk, L = league()) => {
  const t = L.teams.find(x => x.id === pk.otid);
  const pr = protOf(pk);
  return `${dispYr(pk.yr)} R${pk.rd}${pk.otid !== pk.tid ? ` (${t?.shortName || '?'})` : ''}${pr ? ` · top-${pr.top} prot.` : ''}`;
};

// ---- Trade rules (CBA)

// Pick protections, per save, until the pick's draft settles them:
// [{ otid, yr, top, from }] (from = the team it goes back to).
const protKey = () => `hlc:prot:${league().shortName}:${league().meta?.saveName || ''}`;
function protLedger() { try { return JSON.parse(localStorage.getItem(protKey())) || []; } catch { return []; } }
function saveProt(v) { try { localStorage.setItem(protKey(), JSON.stringify(v)); } catch { /* ignore */ } }
const protOf = pk => (pk.rd === 1 ? protLedger().find(x => !x.done && x.otid === pk.otid && x.yr === pk.yr) : null);
const isProt = pk => !!protOf(pk);
// This offseason's ledgers: signings that can't be traded yet
// ({ [pid]: { why, tid } }) and players each team traded away ({ [tid]: [pid] }).
const offKey = name => `hlc:${name}:${league().meta?.saveName || state.fileName}:${seasonKey()}`;
function offGet(name) { try { return JSON.parse(localStorage.getItem(offKey(name))) || {}; } catch { return {}; } }
function offSet(name, v) { try { localStorage.setItem(offKey(name), JSON.stringify(v)); } catch { /* ignore */ } }
function lockSigning(p, why) {
  if (!isComplete()) return; const m = offGet('signed'); m[p.id] = { why, tid: p.tid }; offSet('signed', m); }
// Why an FA signing can't be traded yet.
const signingLock = x => x.matched ? 'Matched offer sheet: 1 year'
  : x.kind === 'snt' ? 'Sign-and-trade: Dec 15'
  : x.from?.id === x.team.id && x.offer.sal > (x.rec?.contract?.sal || 0) * 1.2 && x.offer.sal > FA.minFor(x.p) ? 'Re-signed with a raise: Jan 15'
  : 'Signed this offseason: Dec 15';
const stepPast = key => { const cal = activeCal(), cur = cal.indexOf(currentStep()); return cur < 0 || cur >= cal.findIndex(st => st.key === key); };
function tradeLock(p) {
  if (!isComplete() || p.status !== FA.STATUS_SIGNED) return null;
  // A signed rookie waits 30 days (draft rights trade any time).
  if (p.history?.draft?.yr === league().season.currentYear && !stepPast('latefa')) return 'Rookie deal: 30 days';
  const x = offGet('signed')[p.id];
  return x && x.tid === p.tid ? x.why : null;
}
// Lottery picks are off the table from the day before the lottery.
const lotteryLocked = pk => league().season.phase === 2 && pk.rd === 1 && pk.yr === league().season.currentYear;
// Everything a trade has to clear besides value. Sides: { team, players, picks }.
function tradeRulesErr(L, A, B) {
  if (!isComplete()) return null;
  const away = offGet('away');
  for (const [me, them] of [[A, B], [B, A]]) {
    const back = (them.players || []).find(p => (away[me.team.id] || []).includes(p.id));
    if (back) return `${me.team.shortName} traded ${playerName(back)} away this offseason and can't get him back`;
    const lock = (me.players || []).find(p => tradeLock(p));
    if (lock) return `${playerName(lock)} can't be traded yet (${tradeLock(lock)})`;
    const pk = (me.picks || []).find(x => FA.pickFrozen(L, me.team, x) || lotteryLocked(x));
    if (pk) return lotteryLocked(pk) ? 'Lottery picks can\'t be traded until the lottery is drawn' : `${pickLabel(pk)} is frozen (2nd apron)`;
  }
  // CPU teams make room by waiving someone, so only yours needs the open spot.
  const roster = [A, B].filter(x => isUserTeam(x.team)).map(x => TR.rosterErrTeam(x.team, (x.players || []).length, ((x === A ? B : A).players || []).length)).find(Boolean);
  return FA.tradeCheck(L, A, B) || roster || TR.stepienErr(L, A, B, isProt);
}
// No-trade clauses: he waives it for a contender he's happy to join, or
// when he's miserable where he is.
function ntcRefusal(L, A, B) {
  if (!isComplete()) return null;
  for (const [me, them] of [[A, B], [B, A]]) for (const p of me.players || []) {
    if (!p.contract?.noTrd) continue;
    const morale = p.season?.morale ?? 60;
    if (morale < 35 || (teamStatus(L, them.team) === 'contending' && morale >= 45 && tr(p, 'loyalty') < 16)) continue;
    return `${playerName(p)} won't waive his no-trade clause for ${them.team.shortName}`;
  }
  return null;
}
// Physicals: a player with a bad injury history headed to a CPU team can
// fail it (deal off) or cost a 2nd-round sweetener; one coming to you
// comes with a warning. Adds the sweetener to the side's picks. → bool.
async function physicals(L, A, B) {
  if (!isComplete()) return true;
  const yr = lastSeasonYear();
  for (const [me, them] of [[A, B], [B, A]]) for (const p of me.players || []) {
    const r = injuryRisk(p, yr, state.params);
    if (!r || !(r.chance >= 10 || (r.cls === 'structural' && r.games >= 20))) continue;
    const what = `${injuryName(r.worst)}, ${r.games} games out${r.chance ? `, ${Math.round(r.chance)}% risk` : ''}`;
    if (isUserTeam(me.team) && !isUserTeam(them.team)) {
      const second = me.team.draftPicks.filter(pk => pk.rd === 2 && pk.yr > L.season.currentYear && !(me.picks || []).includes(pk)).sort((a, b) => b.yr - a.yr)[0];
      if (r.chance >= 25 || !second) { toast('Trade off', `${playerName(p)} failed his physical with ${them.team.shortName}`, 3600, true); return false; }
      if (!(await confirmBox(`${esc(playerName(p))}'s physical raised flags (${esc(what)}). ${esc(them.team.shortName)} want ${esc(pickLabel(second))} added.`, 'Add It'))) return false;
      (me.picks ||= []).push(second);
    } else if (isUserTeam(them.team) && !isUserTeam(me.team)) {
      if (!(await confirmBox(`${esc(playerName(p))}'s physical raised flags (${esc(what)}). Go through with it?`, 'Complete Trade'))) return false;
    }
  }
  return true;
}
// Lottery night: protected picks that land in their protection go back.
function settleProt(L) {
  const led = protLedger();
  if (!led.some(x => !x.done && x.yr === L.season.currentYear)) return;
  const res = TR.settleProtections(L, led);
  saveProt(led);
  for (const r of res) if (isUserTeam(r.holder) || (r.from && isUserTeam(r.from))) {
    toast(r.kept ? '🛡️ Protection kicked in' : '🎟️ Protected pick conveys', `${r.from?.shortName}'s pick landed #${r.slot}${r.kept ? `: it stays with ${r.from.shortName}${r.back ? `, ${r.holder.shortName} get their 2nd` : ''}` : `, outside the top ${r.entry.top}: it goes to ${r.holder.shortName}`}`, 4200);
  }
}

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
    live.offers[o.overall] ||= tradeUpOffers(L, order, idx, { value: futureValue, slot: slotValue, rng: live.rng, far: 3, exclude: new Set(live.cpuTeams || []), frozen: frozenFn })
      .map(x => ({ tid: x.team.id, give: x.give, get: x.get }));
    offers = live.offers[o.overall].filter(x => x.give.every(pk => teamById(x.tid).draftPicks.includes(pk)) && o.owner.draftPicks.includes(x.get)
      && !TR.stepienErr(L, { team: teamById(x.tid), picks: x.give }, { team: o.owner, picks: [x.get] }, isProt));
  }
  const done = idx < 0;
  return {
    html: `
      ${state.userTeams.size ? '' : '<p class="note muted small">Select your teams to draft for them.</p>'}
      ${done ? draftRecap(live, order) : `
      ${user ? '<div class="you-clock">🚨 You are on the clock</div>' : ''}
      <div class="clock-card ${user ? 'mine' : ''}" ${teamTint(o.owner) ? `style="${teamTint(o.owner)}"` : ''}>
        <span class="pk">#${o.overall}</span>
        <span class="grow"><b>${esc(teamFull(o.owner))}</b><br><span class="small muted">On the clock · R${o.rd}${o.owner.id !== o.orig.id ? ` · via ${esc(o.orig.shortName)}` : ''}</span>
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
      ${done ? '' : `<div class="list draft-board">
        ${order.map((q, j) => {
          const sel = live.sel[q.overall];
          const p = sel ? byId.get(sel.pid) : null;
          const moved = sel && sel.to !== sel.by;
          const tint = p ? teamTint(teamById(sel.to) || q.owner) : '';
          return `<div class="lot-row ${isUserTeam(q.owner) ? 'mine' : ''} ${j === idx ? 'clock' : ''} ${tint ? 'tc' : ''}" data-ov="${q.overall}" ${tint ? `style="${tint}"` : ''}>
            <span class="pk">${q.overall}</span>${logoImg(q.owner)}
            <span class="grow">${esc(q.owner.shortName)}${q.owner.id !== q.orig.id ? ` <span class="muted small">via ${esc(q.orig.shortName)}</span>` : ''}${q.rd > 1 ? ` <span class="muted small">R${q.rd}</span>` : ''}<br>
              ${p ? `<span class="pl"><span class="small">${esc(playerName(p))} <span class="muted">${esc(posName(p))} · ${p.age}y</span></span>${moved ? ` <span class="small gold">→ ${esc(teamById(sel.to).shortName)}</span>` : ''}</span>` : `<span class="small muted">${j === idx ? 'On the clock' : '—'}</span>`}</span>
            ${p ? `<span class="pl">${valueChip(p)}</span>` : ''}
          </div>`;
        }).join('')}
      </div>`}
      ${live.trades.length && !done ? tradesBox(live) : ''}`,
    action: state.params.commissioner ? { act: 'liveReset', label: 'Reset Draft' } : null,
  };
}

// Draft-day trades, newest first (undo only with Commissioner Mode on).
function tradesBox(live) {
  return `<fieldset class="frame"><legend>Draft-Day Trades</legend><div class="stack">
    ${live.trades.map((t, i) => [t, i]).reverse().map(([t, i]) => `<div class="row"><p class="note grow small">${esc(t.text)}</p>${!t.cpu && state.params.commissioner ? `<button class="btn small" data-act="liveUndoTrade" data-i="${i}">Undo</button>` : ''}</div>`).join('')}
  </div></fieldset>`;
}

// Pick card in team colors (Draft Recap look): pick no., logo, player,
// and the rookie's projected level after the draft drop.
const rookieLevel = p => { const line = rookieLine(p, state.params.recoveryBands); return levelOf({ pot: p.pot, attributes: Object.fromEntries(SKILL_ATTRS.map((k, i) => [k, [line[i]]])) }); };
function pickCard({ overall, team, p, extra = {}, cls = '', empty = '—', showLv = true, right = '' }) {
  const tint = teamTint(team);
  const now = p && showLv ? levelOf(p) : null, rk = p && showLv ? rookieLevel(p) : null;
  return `<div class="recap-row ${cls}" ${tint ? `style="${tint}"` : ''}>
    <span class="pk">${overall}</span>${logoImg(team)}
    <span class="grow">${p ? `<b>${extra.star || ''}${esc(playerName(p))}</b><br><span class="small">${esc(team.shortName)}${extra.sub || ''} · ${esc(posName(p))} · ${p.age}y</span>`
      : `<b>${esc(team.shortName)}</b>${extra.sub || ''}<br><span class="small muted">${empty}</span>`}</span>
    ${right}${p && showLv ? `<span class="lv"><b>${rk}</b><span class="small">Lv${now !== rk ? ` <s>${now}</s>` : ''}</span></span>` : ''}
  </div>`;
}
const sortToggle = (key, cur) => `<div class="opts recap-sort"><button class="btn small ${cur === 'pick' ? 'on focus' : 'off'}" data-act="cardSort" data-k="${key}" data-s="pick">By Pick</button><button class="btn small ${cur === 'level' ? 'on focus' : 'off'}" data-act="cardSort" data-k="${key}" data-s="level">By Level</button></div>`;
// Level sort: drafted players by projected level, open picks after in order.
const byReadiness = rows => rows.sort((a, b) => (b.lv ?? -1) - (a.lv ?? -1) || a.overall - b.overall);
actions.cardSort = d => { draftState()[d.k] = d.s; render(); };

// After the last pick: every pick with the rookie's projected level after
// the draft dip and summer league, in team colors; sort by pick or level.
function draftRecap(live, order) {
  const L = league();
  const byId = new Map(L.draftClass.map(p => [p.id, p]));
  const sortBy = draftState().recapSort || 'pick';
  const rows = order.filter(q => live.sel[q.overall]).map(q => {
    const sel = live.sel[q.overall];
    const p = byId.get(sel.pid);
    return { overall: q.overall, p, team: L.teams.find(t => t.id === sel.to), lv: rookieLevel(p) };
  });
  if (sortBy === 'level') byReadiness(rows);
  return `<button class="btn big focus" data-act="liveFinish">✅ Finish Draft</button>
    ${live.trades.length ? tradesBox(live) : ''}
    <fieldset class="frame"><legend>Draft Recap</legend>
      ${sortToggle('recapSort', sortBy)}
      <p class="note muted small" style="margin:6px 0 8px">Levels are as rookies: every pick's ratings dip moving up to the pros, and older rookies get some of it back.</p>
      <div class="stack recap recap-scroll">${rows.map(r => pickCard(r)).join('')}</div>
    </fieldset>`;
}

// Picks made since `before` get revealed one by one on the next render.
const newPicks = (live, before) => Object.keys(live.sel).map(Number).filter(ov => !before.has(ov)).sort((a, b) => a - b);
actions.liveSim = d => {
  if (state.revealing) return;
  const live = liveState();
  const before = new Set(Object.keys(live.sel).map(Number));
  liveSim(d.m);
  // Only single picks play out in the clock card; simming skips ahead.
  state.pickReveal = d.m === 'one' ? newPicks(live, before) : null;
  render();
};

actions.liveChoose = () => {
  if (state.revealing) return;
  const live = liveState();
  const order = liveOrder();
  const idx = clockIndex(live, order);
  const o = order[idx];
  const watch = new Set(boardStore().board);
  const avail = myBoardOrder().filter(p => !takenIds(live).has(p.id));
  const box = overlay(`
    <p class="note">${esc(o.owner.shortName)} · Pick #${o.overall}</p>
    <div class="pick-list">${avail.map((p, i) => pickRow(p, { star: watch.has(p.id), fills: fillsFor(o.owner, p), n: i + 1 })).join('')}</div>
    <button class="btn off" data-close>Cancel</button>`);
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-id],[data-close]');
    if (!b) return;
    if (b.dataset.id) {
      const p = prospectById(+b.dataset.id);
      if (!(await confirmBox(`Draft <b>${esc(playerName(p))}</b> at #${o.overall}?`, 'Draft'))) return;
      makeSelection(live, order, idx, p.id);
      state.pickReveal = [o.overall];
    }
    box.remove();
    render();
  });
};

actions.liveOffer = async d => {
  if (state.revealing) return;
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
  for (const m of rec.moved) tradeMorale(L, m.p, m.to, m.from);
  const awayAdded = markAway(rec.moved);
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
  const entry = { rec, moves, text, cpu, awayAdded, at: Object.keys(live.sel).length };
  live.trades.push(entry);
  live.offers = {};
  draftState().offers = null;
  state.dirty = true;
  toast('🚨 Trade Alert', text);
  return entry;
}
// Players a team traded away this offseason (it can't reacquire them).
function markAway(moved) {
  const away = offGet('away');
  const added = moved.map(m => [m.from.id, m.p.id]);
  for (const [tid, pid] of added) (away[tid] ||= []).push(pid);
  offSet('away', away);
  return added;
}

// A trade of three teams: items = [{ x (asset), from, to }]. One pair of
// moves per direction; undone together.
function liveExecuteMulti(teams, items) {
  const live = liveState();
  const L = league();
  const order = liveOrder();
  const recs = [], moves = [], lines = [];
  let awayAdded = [];
  for (const from of teams) for (const to of teams) {
    if (from === to) continue;
    const mine = items.filter(i => i.from === from && i.to === to);
    if (!mine.length) continue;
    const players = mine.filter(i => i.x.player).map(i => i.x.player), picks = mine.filter(i => i.x.pick).map(i => i.x.pick);
    const rec = executeTrade({ team: from, players, picks }, { team: to, players: [], picks: [] }, L.season.currentYear);
    recs.push(rec);
    for (const m of rec.moved) tradeMorale(L, m.p, m.to, m.from);
    awayAdded = awayAdded.concat(markAway(rec.moved));
    for (const i of mine.filter(i => i.x.prospect)) { moves.push({ ov: i.x.prospect, from: from.id, to: to.id }); live.sel[i.x.prospect].to = to.id; }
    lines.push(`${from.shortName} → ${to.shortName}: ${mine.map(i => itemText(i.x, order)).join(', ')}`);
  }
  const text = lines.join(' · ');
  const entry = { rec: { multi: recs }, moves, text, cpu: false, awayAdded, at: Object.keys(live.sel).length };
  live.trades.push(entry);
  live.offers = {};
  draftState().offers = null;
  state.dirty = true;
  toast('🚨 Three-Team Trade', text);
  return entry;
}
function itemText(x, order = liveOrder()) {
  const L = league();
  if (x.player) return playerName(x.player);
  if (x.prospect) return `${playerName(prospectById(liveState().sel[x.prospect].pid))} (#${x.prospect})`;
  return x.key.startsWith('c:') ? `#${x.key.slice(2)}` : pickLabel(x.pick, L);
}

function liveUndo(t) {
  const live = liveState();
  draftState().offers = null;
  for (const r of [...(t.rec.multi || [t.rec])].reverse()) undoTrade(r);
  for (const m of t.moves) if (live.sel[m.ov]) live.sel[m.ov].to = m.from;
  if (t.awayAdded?.length) {
    const away = offGet('away');
    for (const [tid, pid] of t.awayAdded) away[tid] = (away[tid] || []).filter(x => x !== pid);
    offSet('away', away);
  }
  if (t.protAdded?.length) saveProt(protLedger().filter(e => !t.protAdded.some(x => x.otid === e.otid && x.yr === e.yr)));
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
  if (!(await confirmBox('Finish the draft and move on?', 'Finish'))) return;
  checkpoint('Draft');
  rememberGrades(L);
  const res = applyDraft(L, livePicks(live, order), state.leagueIdx);
  for (const r of leagueRookies(L)) state.snaps.set(snapKey(r.p.id), snapshot(r.p));
  ageAdjust();
  state.compCache = {};
  state.compPools = {};
  draftState().live = null;
  draftState().mock = null;
  state.dirty = true;
  goHome();
  toast(`Draft complete: ${res.drafted} drafted, ${res.undrafted} to free agency.`);
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
// Archetype: a custom name from the save (built-in names wait on the game's list).
const archName = p => (p.arc && !/^custom( archetype)?$/i.test(p.arc.trim()) ? p.arc.trim() : '');

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
    const frozen = FA.pickFrozen(L, team, pk);
    out.push({ key: `f:${pk.yr}:${pk.rd}:${pk.otid}`, label: `${esc(pickLabel(pk))}${frozen ? ' <span class="badge lock" title="Over the 2nd apron: this pick can\'t be traded">🔒 Frozen</span>' : pickPenTag(pk)}`, html: true, locked: frozen, value: futureValue(pk), pick: pk });
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
    const lock = tradeLock(p);
    const locked = pending(p) || !!lock;
    out.push({ key: `p:${p.id}`, locked, label: `${esc(playerName(p))} ${lvTag(p)}${pending(p) ? ' <span class="badge lock" title="Contract is up: can\'t be traded">🔒 Pending FA</span>' : lock ? ` <span class="badge lock">🔒 ${esc(lock)}</span>` : contractBadge(p)}${p.contract?.noTrd ? ' <span class="badge new" title="No-trade clause: he has to agree">NTC</span>' : ''}<br><span class="muted small">${esc(posName(p))} · ${p.age}y${l ? ` · ${l.ppg.toFixed(1)}/${l.rpg.toFixed(1)}/${l.apg.toFixed(1)}` : ''}${ct && !locked ? ` · ${ct}` : ''}</span>`, value: playerValue(p, state.leagueIdx, ly), player: p, html: true });
  }
  return out;
}


// A team's cap in a trade: the bar shows payroll as it would be after the deal.
function tradeCap(t, outP, inP, label = false) {
  const sal = ps => ps.reduce((s, p) => s + (p.contract?.sal || 0), 0);
  const pay = FA.payroll(t), dead = deadFor(t.id);
  const after = pay - sal(outP) + sal(inP), d = after - pay;
  return `<div class="trade-cap">${label ? `<b class="small">${esc(t.shortName)}</b>` : ''}${capBarOf(after, dead, true)}
    <p class="small muted trade-cap-line">${d ? `$${pay}M → <b class="${d > 0 ? 'down' : 'up'}">$${after}M</b> (${d > 0 ? '+' : '−'}$${Math.abs(d)}M)` : `Payroll $${pay}M`}</p></div>`;
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
  if (args.c != null && args.c !== aId && args.c !== bId) { const C = L.teams.find(t => t.id === +args.c); if (C) return liveTrade3(args, A, B, C, left); }
  const selA = new Set(args.selA || []), selB = new Set(args.selB || []);
  const aa = liveAssets(A), bb = liveAssets(B);
  const prot = args.prot || {};
  // Picks are valued off each team's roster as it would be after this deal.
  const adjust = tradeAdjust(A, B, aa.filter(x => selA.has(x.key)), bb.filter(x => selB.has(x.key)));
  const pv = x => pickItemValue(x, prot, adjust);
  const sum = (list, sel) => list.filter(x => sel.has(x.key)).reduce((s, x) => s + pv(x), 0);
  const vA = sum(aa, selA), vB = sum(bb, selB);
  // Future firsts being sent can carry a protection.
  const firsts = [...aa.filter(x => selA.has(x.key)), ...bb.filter(x => selB.has(x.key))].filter(x => x.pick && x.pick.rd === 1 && x.pick.yr > L.season.currentYear);
  const protRows = !isComplete() ? [] : firsts.map(x => protOf(x.pick)
    ? `<div class="prot-row"><span class="grow small">${esc(pickLabel(x.pick))}</span><span class="small muted">already protected</span></div>`
    : `<div class="prot-row"><span class="grow small">${esc(pickLabel(x.pick))}</span><div class="seg">${TR.PROTECTIONS.map(v => `<button class="btn ${(prot[x.key] || 0) === v ? 'on focus' : 'off'}" data-act="liveProt" data-k="${x.key}" data-v="${v}">${v ? `Top ${v}` : 'None'}</button>`).join('')}</div></div>`).join('');
  const list = (items, sel, side) => items.map(x => `<button class="pick ${sel.has(x.key) ? 'sel' : ''} ${x.locked ? 'locked' : ''}" ${x.locked ? 'disabled' : `data-act="liveToggle" data-side="${side}" data-k="${x.key}"`}>
      <span class="check"></span><span class="grow">${x.html ? x.label : esc(x.label)}</span></button>`).join('') || '<p class="note muted">Nothing to trade.</p>';
  const select = (side, cur) => {
    const T = L.teams.find(t => t.id === cur);
    const many = side === 'b' || left.length > 1;
    const arrow = (dir, ch) => many ? `<button class="tsel-arrow" data-act="liveCycle" data-side="${side}" data-dir="${dir}" aria-label="${dir < 0 ? 'Previous' : 'Next'} team">${ch}</button>` : `<span class="tsel-arrow off" aria-hidden="true"></span>`;
    return `<div class="tsel">${arrow(-1, '◀')}<span class="tsel-team"><span class="tsel-name"><b>${esc(T.shortName)}</b></span></span>${arrow(1, '▶')}</div>`;
  };
  layout({
    title: order.length ? 'Draft-Day Trade' : 'Trade',
    body: `
      <div class="grid2 trade">
        <div class="stack">${select('a', aId)}${tradeCap(A, aa.filter(x => selA.has(x.key) && x.player).map(x => x.player), bb.filter(x => selB.has(x.key) && x.player).map(x => x.player))}</div>
        <div class="stack">${select('b', bId)}${tradeCap(B, bb.filter(x => selB.has(x.key) && x.player).map(x => x.player), aa.filter(x => selA.has(x.key) && x.player).map(x => x.player))}</div>
      </div>
      ${tradeBar(A, B, vA, vB)}
      <div class="grid2 trade">
        <div class="list">${list(aa, selA, 'a')}</div>
        <div class="list">${list(bb, selB, 'b')}</div>
      </div>
      ${protRows ? `<fieldset class="frame"><legend>Protections</legend><p class="note small muted">Lands in the protection: it goes back and they get that year's 2nd.</p>${protRows}</fieldset>` : ''}
      ${commish ? `<div class="grid2">
        <button class="btn focus" data-act="liveTradeGo" data-force="0">🤝 Propose</button>
        <button class="btn" data-act="liveTradeGo" data-force="1">⚡ Force</button>
      </div>` : '<button class="btn focus" data-act="liveTradeGo" data-force="0">🤝 Propose</button>'}
      ${isComplete() ? '<button class="btn" data-act="liveAdd3">➕ Add a Third Team</button>' : ''}`,
  });
  slideTradeBar();
};

// ---- Three-team trades

const threeTeams = a => (a.c != null ? [a.a, a.b, a.c].map(id => league().teams.find(t => t.id === +id)) : null);
function threeItems(teams, assets, sel) {
  const out = [];
  for (const t of teams) for (const x of assets.get(t.id)) {
    const to = sel[x.key];
    if (to != null && !x.locked && +to !== t.id && teams.some(u => u.id === +to)) out.push({ x, from: t, to: teams.find(u => u.id === +to) });
  }
  return out;
}
function tradeAdjustN(teams, items) {
  const m = new Map(teams.map(t => [t.id, { remove: [], add: [] }]));
  for (const i of items) if (i.x.player) { m.get(i.from.id).remove.push(i.x.player); m.get(i.to.id).add.push(i.x.player); }
  return m;
}
const flowOf = (t, items) => ({
  team: t,
  send: { players: items.filter(i => i.from === t && i.x.player).map(i => i.x.player), picks: items.filter(i => i.from === t && i.x.pick).map(i => i.x.pick) },
  recv: { players: items.filter(i => i.to === t && i.x.player).map(i => i.x.player), picks: items.filter(i => i.to === t && i.x.pick).map(i => i.x.pick) },
});
// Every rule a three-team deal has to clear (the touch rule included).
function rulesErr3(L, teams, items) {
  if (!isComplete()) return null;
  const away = offGet('away');
  const flows = teams.map(t => flowOf(t, items));
  for (const f of flows) {
    const back = f.recv.players.find(p => (away[f.team.id] || []).includes(p.id));
    if (back) return `${f.team.shortName} traded ${playerName(back)} away this offseason and can't get him back`;
    const lock = f.send.players.find(p => tradeLock(p));
    if (lock) return `${playerName(lock)} can't be traded yet (${tradeLock(lock)})`;
    const pk = f.send.picks.find(x => FA.pickFrozen(L, f.team, x) || lotteryLocked(x));
    if (pk) return lotteryLocked(pk) ? 'Lottery picks can\'t be traded until the lottery is drawn' : `${pickLabel(pk)} is frozen (2nd apron)`;
  }
  const touch = TR.touchErr(items.map(i => ({ from: i.from.id, to: i.to.id })), teams);
  if (touch) return touch;
  return FA.tradeCheckMulti(L, flows)
    || flows.filter(f => isUserTeam(f.team)).map(f => TR.rosterErrTeam(f.team, f.send.players.length, f.recv.players.length)).find(Boolean)
    || flows.map(f => TR.stepienTeam(L, f.team, f.send.picks, f.recv.picks, isProt)).find(Boolean)
    || null;
}
function ntc3(L, items) {
  if (!isComplete()) return null;
  for (const i of items) {
    const p = i.x.player;
    if (!p?.contract?.noTrd) continue;
    const morale = p.season?.morale ?? 60;
    if (morale < 35 || (teamStatus(L, i.to) === 'contending' && morale >= 45 && tr(p, 'loyalty') < 16)) continue;
    return `${playerName(p)} won't waive his no-trade clause for ${i.to.shortName}`;
  }
  return null;
}
async function physicals3(L, items) {
  if (!isComplete()) return true;
  const yr = lastSeasonYear();
  for (const i of [...items]) {
    const p = i.x.player;
    const r = p && injuryRisk(p, yr, state.params);
    if (!r || !(r.chance >= 10 || (r.cls === 'structural' && r.games >= 20))) continue;
    const what = `${injuryName(r.worst)}, ${r.games} games out${r.chance ? `, ${Math.round(r.chance)}% risk` : ''}`;
    if (isUserTeam(i.from) && !isUserTeam(i.to)) {
      const used = new Set(items.filter(j => j.x.pick).map(j => j.x.pick));
      const second = i.from.draftPicks.filter(pk => pk.rd === 2 && pk.yr > L.season.currentYear && !used.has(pk)).sort((a, b) => b.yr - a.yr)[0];
      if (r.chance >= 25 || !second) { toast('Trade off', `${playerName(p)} failed his physical with ${i.to.shortName}`, 3600, true); return false; }
      if (!(await confirmBox(`${esc(playerName(p))}'s physical raised flags (${esc(what)}). ${esc(i.to.shortName)} want ${esc(pickLabel(second))} added.`, 'Add It'))) return false;
      items.push({ x: { key: `f:${second.yr}:${second.rd}:${second.otid}`, pick: second, value: futureValue(second) }, from: i.from, to: i.to });
    } else if (isUserTeam(i.to) && !isUserTeam(i.from)) {
      if (!(await confirmBox(`${esc(playerName(p))}'s physical raised flags (${esc(what)}). Go through with it?`, 'Complete Trade'))) return false;
    }
  }
  return true;
}

function liveTrade3(args, A, B, C, left) {
  const L = league();
  const teams = [A, B, C];
  const tab = teams.find(t => t.id === +args.tab) || A;
  const sel = args.sel3 || {}, prot = args.prot || {};
  const assets = new Map(teams.map(t => [t.id, liveAssets(t)]));
  const items = threeItems(teams, assets, sel);
  const adjust = tradeAdjustN(teams, items);
  const val = i => pickItemValue(i.x, prot, adjust);
  const give = t => items.filter(i => i.from === t).reduce((s, i) => s + val(i), 0);
  const get = t => items.filter(i => i.to === t).reduce((s, i) => s + val(i), 0);
  const others = teams.filter(t => t !== tab);
  const many = t => (t === A ? left.length > 1 : true);
  const arrow = (dir, ch, side) => `<button class="tsel-arrow" data-act="liveCycle" data-side="${side}" data-dir="${dir}" aria-label="${dir < 0 ? 'Previous' : 'Next'} team">${ch}</button>`;
  const side = tab === A ? 'a' : tab === B ? 'b' : 'c';
  const list = assets.get(tab.id).map(x => {
    const dest = sel[x.key] != null && +sel[x.key] !== tab.id ? teams.find(t => t.id === +sel[x.key]) : null;
    return `<button class="pick ${dest ? 'sel' : ''} ${x.locked ? 'locked' : ''}" ${x.locked ? 'disabled' : `data-act="liveToggle3" data-k="${x.key}"`}>
      <span class="check"></span><span class="grow">${x.html ? x.label : esc(x.label)}</span>${dest ? `<span class="badge new">→ ${esc(dest.shortName)}</span>` : ''}</button>`;
  }).join('') || '<p class="note muted">Nothing to trade.</p>';
  const verdict = teams.map(t => {
    const g = give(t), r = get(t);
    const cpu = !isUserTeam(t);
    const ok = cpuAccepts(g, r);
    return `<p class="note small"><b>${esc(t.shortName)}</b> sends ${Math.round(g)} · gets ${Math.round(r)}${cpu && items.length ? ` · ${ok ? '<span class="up">would accept</span>' : '<span class="down">would decline</span>'}` : ''}</p>`;
  }).join('');
  const firsts = items.filter(i => i.x.pick && i.x.pick.rd === 1 && i.x.pick.yr > L.season.currentYear);
  const protRows = !isComplete() ? [] : firsts.map(i => protOf(i.x.pick)
    ? `<div class="prot-row"><span class="grow small">${esc(pickLabel(i.x.pick))}</span><span class="small muted">already protected</span></div>`
    : `<div class="prot-row"><span class="grow small">${esc(pickLabel(i.x.pick))}</span><div class="seg">${TR.PROTECTIONS.map(v => `<button class="btn ${(prot[i.x.key] || 0) === v ? 'on focus' : 'off'}" data-act="liveProt" data-k="${i.x.key}" data-v="${v}">${v ? `Top ${v}` : 'None'}</button>`).join('')}</div></div>`).join('');
  layout({
    title: '3-Team Trade',
    body: `
      <div class="tabs">${teams.map(t => `<button class="btn ${t === tab ? 'on focus' : 'off'}" data-act="liveTab3" data-id="${t.id}">${esc(t.shortName)}${items.filter(i => i.from === t).length ? ` · ${items.filter(i => i.from === t).length}` : ''}</button>`).join('')}</div>
      <fieldset class="frame"><legend>Cap</legend>${teams.map(t => tradeCap(t, items.filter(i => i.from === t && i.x.player).map(i => i.x.player), items.filter(i => i.to === t && i.x.player).map(i => i.x.player), true)).join('')}</fieldset>
      ${many(tab) ? `<div class="tsel">${arrow(-1, '◀', side)}<span class="tsel-team"><span class="tsel-name"><b>${esc(tab.shortName)}</b></span></span>${arrow(1, '▶', side)}</div>` : ''}
      <p class="note small muted">Tap to send to ${esc(others[0].shortName)}, again for ${esc(others[1].shortName)}.</p>
      <div class="list">${list}</div>
      <fieldset class="frame"><legend>The Deal</legend>
        ${items.length ? items.map(i => `<p class="note small">${esc(i.from.shortName)} → ${esc(i.to.shortName)}: ${esc(itemText(i.x))}</p>`).join('') : '<p class="note small muted">Nothing selected</p>'}
        <div class="stack" style="margin-top:6px">${verdict}</div>
      </fieldset>
      ${protRows ? `<fieldset class="frame"><legend>Protections</legend><p class="note small muted">Lands in the protection: it goes back and they get that year's 2nd.</p>${protRows}</fieldset>` : ''}
      <div class="${state.params.commissioner ? 'grid3' : 'grid2'}">
        <button class="btn off" data-act="liveDrop3">↩ Two Teams</button>
        <button class="btn focus" data-act="liveTradeGo3" data-force="0">🤝 Propose</button>
        ${state.params.commissioner ? '<button class="btn" data-act="liveTradeGo3" data-force="1">⚡ Force</button>' : ''}
      </div>`,
  });
}
actions.setDepth = d => { setDepth(d.v); render(); toast(d.v === 'simple' ? 'Simple rules' : 'Complete rules'); };
actions.liveAdd3 = () => {
  const a = tradeArgs(), L = league();
  const c = L.teams.find(t => t.id !== +a.a && t.id !== +a.b && !isUserTeam(t)) || L.teams.find(t => t.id !== +a.a && t.id !== +a.b);
  replace('liveTrade', { ...a, c: c.id, tab: a.a, sel3: {}, prot: {} });
};
actions.liveDrop3 = () => { const a = tradeArgs(); replace('liveTrade', { ...a, c: null, sel3: {}, selA: [], selB: [], tab: null }); };
actions.liveTab3 = d => replace('liveTrade', { ...tradeArgs(), tab: +d.id });
actions.liveToggle3 = d => {
  const a = tradeArgs();
  const teams = threeTeams(a);
  const tab = teams.find(t => t.id === +a.tab) || teams[0];
  const o = teams.filter(t => t !== tab);
  const cur = a.sel3?.[d.k];
  const seq = [null, o[0].id, o[1].id];
  const next = seq[(seq.findIndex(v => v === (cur ?? null)) + 1) % 3];
  const sel3 = { ...(a.sel3 || {}) };
  if (next == null) delete sel3[d.k]; else sel3[d.k] = next;
  replace('liveTrade', { ...a, sel3 });
};
actions.liveTradeGo3 = async d => {
  const a = tradeArgs(), L = league();
  const teams = threeTeams(a);
  const force = d.force === '1' && state.params.commissioner;
  const assets = new Map(teams.map(t => [t.id, liveAssets(t)]));
  const items = threeItems(teams, assets, a.sel3 || {});
  if (!items.length) { toast('Tap something to send first'); return; }
  const err = rulesErr3(L, teams, items) || ntc3(L, items);
  if (err && !force) { toast('Trade not allowed', err, 3600, true); return; }
  const prot = a.prot || {};
  const adjust = tradeAdjustN(teams, items);
  if (!force) {
    const no = teams.find(t => !isUserTeam(t) && !cpuAccepts(items.filter(i => i.from === t).reduce((s, i) => s + pickItemValue(i.x, prot, adjust), 0), items.filter(i => i.to === t).reduce((s, i) => s + pickItemValue(i.x, prot, adjust), 0)));
    if (no) { toast(`${no.shortName} decline: they want more back`); return; }
    if (!(await physicals3(L, items))) return;
  }
  const led = protLedger();
  const added = [];
  for (const i of items) if (i.x.pick && prot[i.x.key] && !protOf(i.x.pick)) { const e = { otid: i.x.pick.otid, yr: i.x.pick.yr, top: prot[i.x.key], from: i.from.id }; led.push(e); added.push(e); }
  saveProt(led);
  const entry = liveExecuteMulti(teams, items);
  entry.protAdded = added;
  back();
};

actions.liveTrade = () => { if (state.revealing) return; tradeBarPos = 50; go('liveTrade', {}); };

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

  const word = Math.abs(lean) < 0.06 ? 'Even' : lean > 0 ? `Favors ${B.shortName}${Math.abs(lean) > 0.35 ? ' a lot' : ''}` : `Favors ${A.shortName}${Math.abs(lean) > 0.35 ? ' a lot' : ''}`;
  const from = tradeBarPos;
  tradeBarPos = pos;
  return `<div class="tbar-wrap">
    <div class="tbar ${cpu ? (judge === B ? 'to-right' : 'to-left') : ''}"><span class="tbar-mid"></span><span class="tbar-mark ${empty ? 'idle' : ''}" style="left:${from}%" data-to="${pos}"></span></div>
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
  const three = a.c != null;
  const pool = d.side === 'a' ? (state.params.commissioner || !mine.length ? teams : mine)
    : teams.filter(t => !(d.side === 'b' ? [a.a, ...(three ? [a.c] : [])] : [a.a, a.b]).includes(t.id));
  const cur = pool.findIndex(t => t.id === a[d.side]);
  const next = pool[(cur + +d.dir + pool.length) % pool.length];
  const upd = { ...a, [d.side]: next.id };
  if (three) { upd.sel3 = {}; upd.tab = next.id; }
  else upd[d.side === 'a' ? 'selA' : 'selB'] = [];
  // Moving your team onto another slot's team sends that slot elsewhere.
  if (d.side === 'a') for (const k of three ? ['b', 'c'] : ['b']) if (upd[k] === next.id) {
    upd[k] = teams.find(t => ![upd.a, upd.b, upd.c].includes(t.id)).id;
    if (!three) upd.selB = [];
  }
  replace('liveTrade', upd);
};
actions.liveProt = d => { const a = tradeArgs(); replace('liveTrade', { ...a, prot: { ...(a.prot || {}), [d.k]: +d.v } }); };
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
  const adjust = tradeAdjust(A, B, sa.items, sb.items);
  const pv = x => pickItemValue(x, a.prot || {}, adjust);
  if (!sa.items.length && !sb.items.length) { toast('Tap something on either side first'); return; }
  const vA = sa.items.reduce((s, x) => s + pv(x), 0), vB = sb.items.reduce((s, x) => s + pv(x), 0);
  if (d.force !== '1' || !state.params.commissioner) {
    const no = [[A, vA, vB], [B, vB, vA]].find(([t, give, get]) => !isUserTeam(t) && !cpuAccepts(give, get));
    if (no) { toast(`${no[0].shortName} decline: they want more back`); return; }
  }
  const force = d.force === '1' && state.params.commissioner;
  const capErr = tradeRulesErr(L, sa, sb) || ntcRefusal(L, sa, sb);
  if (capErr && !force) { toast('Trade not allowed', capErr, 3200, true); return; }
  if (!force && !(await physicals(L, sa, sb))) return;
  // New protections ride with the picks.
  const prot = a.prot || {};
  const led = protLedger();
  for (const sd of [sa, sb]) for (const x of sd.items) if (x.pick && prot[x.key] && !protOf(x.pick)) led.push({ otid: x.pick.otid, yr: x.pick.yr, top: prot[x.key], from: sd.team.id });
  saveProt(led);
  const entry = liveExecute(sa, sb);
  entry.protAdded = led.filter(e => !e.done && (sa.items.concat(sb.items)).some(x => x.pick && x.pick.otid === e.otid && x.pick.yr === e.yr && prot[x.key]));
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
    .map(pk => { const fz = FA.pickFrozen(L, T, pk) || lotteryLocked(pk); return `<button class="pick ${sel.has(key(pk)) ? 'sel' : ''} ${fz ? 'locked' : ''}" ${fz ? 'disabled' : `data-act="togglePick" data-side="${side}" data-k="${key(pk)}"`}>
      <span class="check"></span><span class="grow">${dispYr(pk.yr)} R${pk.rd}${pk.otid !== T.id ? ` <span class="muted small">(${esc(tname(pk.otid))})</span>` : ''}${fz ? ' <span class="badge lock" title="Over the 2nd apron: this pick can\'t be traded">🔒 Frozen</span>' : pickPenTag(pk)}</span>
      <span class="muted small">${Math.round(pickValue(L, pk))}</span></button>`; }).join('') || '<p class="note muted">No picks.</p>';
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
  const pErr = tradeRulesErr(L, { team: A, picks: fromA }, { team: B, picks: fromB });
  if (pErr) { toast('Trade not allowed', pErr, 3200, true); return; }
  const tname = id => L.teams.find(t => t.id === id)?.shortName || '?';
  const desc = list => list.map(pk => `${dispYr(pk.yr)} R${pk.rd}${pk.otid !== pk.tid ? ` (${tname(pk.otid)})` : ''}`).join(', ') || 'nothing';
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
  1: 'No more collusion: the market is open. A player\'s old team can go over the cap to keep him, and restricted free agents can be matched.',
  2: 'The mid-level exceptions open: the room MLE under the cap, the non-taxpayer MLE over it (it hard-caps you at the 1st apron), the taxpayer MLE between the aprons.',
  3: 'Players\' expectations have shifted: they\'ll take less now.',
};
const mleKey = () => `hlc:mle:${league().meta?.saveName || state.fileName}:${seasonKey()}`;
function loadMle(k = '') { try { return new Set(JSON.parse(localStorage.getItem(mleKey() + k)) || []); } catch { return new Set(); } }
function saveMle(set, k = '') { try { localStorage.setItem(mleKey() + k, JSON.stringify([...set])); } catch { /* ignore */ } }
// Teams that used the non-taxpayer MLE are hard-capped at the 1st apron.
const saveUsed = used => { saveMle(used.mle); saveMle(used.hard || new Set(), ':hard'); };

function faState() {
  const L = league();
  const li = state.leagueIdx;
  const day = Math.max(1, Math.min(3, L.season.currentDay || 1));
  let s = state.fa[li];
  if (!s || s.day !== day) {
    s = state.fa[li] = { day, stage: 'open', bids: new Map(), used: { mle: loadMle(), hard: loadMle(':hard') }, rng: mulberry32(Math.floor(Math.random() * 1e9)), signings: [], cleared: null };
    s.market = FA.buildMarket(L, day);
  }
  return s;
}
const faValue = p => playerValue(p, state.leagueIdx, lastYear());
const offerText = o => `$${o.sal}M × ${o.yrs}${o.load && o.load !== 'flat' ? (o.load === 'front' ? ' · FL' : ' · BL') : ''}${o.opt === FA.OPT_PLAYER ? ' · PO' : o.opt === FA.OPT_TEAM ? ' · TO' : ''}`;
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

// The cap this year; the years ahead and the lines that matter fold away.
function capNote(L) {
  const C = FA.capLines(L), yr = FA.seasonStart(L);
  const row = k => { const c = FA.capLines(L, k); return `<div class="small" style="display:flex;justify-content:space-between;gap:8px"><b>${yr + k}-${String(yr + k + 1).slice(2)}</b><span class="muted">Cap $${c.cap}M · Tax $${c.tax}M · 1st apron $${c.apron1}M · 2nd apron $${c.apron2}M</span></div>`; };
  return `<details class="frame"><summary class="note small"><b>Salary cap $${C.cap}M</b> <span class="muted">· projections</span></summary>
    <div class="stack" style="margin-top:6px">${[0, 1, 2, 3, 4].map(row).join('')}</div>
    <p class="note small muted" style="margin-top:6px">Tax line, then the 1st apron (can't use the room exception or take back salary in trades) and the 2nd apron (no combining salaries, no trading frozen picks). Past 2030 the cap keeps growing about 5% a year.</p></details>`;
}
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
  // By the level he plays at now (a declining veteran sorts by his regressed level).
  let rows = [...s.market].sort((a, b) => shownLevel(b.p) - shownLevel(a.p) || faValue(b.p) - faValue(a.p));
  if (view === 'mine') rows = rows.filter(m => isUserTeam(m.from) || (s.bids.get(m.p.id) || []).some(b => isUserTeam({ id: b.tid })));
  else rows = rows.filter(m => !isUserTeam(m.from));
  if (['guards', 'wings', 'bigs'].includes(view)) rows = rows.filter(m => posGroup(m.p) === view);
  if (view === 'vets') rows = rows.filter(m => m.p.age >= 30);
  const total = rows.length;
  rows = rows.slice(0, args.all ? 400 : 25);
  const views = [['top', 'Best'], ['vets', 'Vets'], ['mine', 'Yours'], ['guards', 'Guards'], ['wings', 'Wings'], ['bigs', 'Bigs']];
  const O = FA.FA_DEFAULTS;
  const stageBtn = s.stage === 'open'
    ? '<button class="btn big focus" data-act="faOpen">🔨 Open Bidding</button>'
    : s.stage === 'bidding'
      ? '<button class="btn big focus" data-act="faDecide">✅ Players Decide</button>'
      : `${state.params.commissioner ? '<button class="btn small" data-act="faUndo">↺ Undo Today</button>' : ''}`;
  const row = m => {
    const list = s.bids.get(m.p.id) || [];
    const best = faBest(s, m);
    const mineBid = list.find(b => isUserTeam({ id: b.tid }));
    const l = seasonLine(m.p, state.leagueIdx, lastYear());
    const M = FA.MOTIVES[m.motive];
    const signed = s.signings.find(x => x.p === m.p);
    const rfa = FA.isRestricted(L, m.p);
    return `<button class="prow ${mineBid ? 'sel' : ''}" data-act="faOffer" data-id="${m.p.id}" ${signedIds.has(m.p.id) || s.stage === 'done' ? 'disabled' : ''}>
      <span class="name">${esc(playerName(m.p))} <span class="${declining(m.p) ? 'decl-lv' : 'gold'} small" ${declining(m.p) ? 'title="Past his regression age"' : ''}>Lv ${shownLevel(m.p)}</span>${rfa ? ' <span class="badge new">RFA</span>' : ''}${traitsSet(m.p) && tr(m.p, 'durability') <= 6 ? ' <span title="Injury-prone">🩺</span>' : ''}</span>
      <span class="right"><span class="small">Asks $${m.ask}M × ${askYears(m)}</span><br><span class="small" title="${esc(M.text)}">${M.icon} ${esc(M.name)}</span></span>
      <span class="meta">${esc(posName(m.p))} · ${m.p.age}y${l ? ` · ${l.ppg.toFixed(1)}/${l.rpg.toFixed(1)}/${l.apg.toFixed(1)}` : ''} · ${m.from ? esc(m.from.shortName) : 'FA'}</span>
      ${signed ? `<span class="chg up">Signed: ${esc(signed.team.shortName)} ${offerText(signed.offer)}</span>`
      : list.length ? `<span class="chg">${list.length} team${list.length > 1 ? 's' : ''} interested · best ${esc(teamName(best.tid))} ${offerText(best)}${mineBid ? (best === mineBid ? ' · <span class="up">you lead</span>' : ' · <span class="down">you trail</span>') : ''}</span>` : ''}
    </button>`;
  };
  layout({
    title: `Free Agency · Week ${s.day}`,
    body: `
      <p class="note small">${esc(FA_DAY_RULES[s.day])}</p>
      ${expiringSection(s)}
      ${FA.capSystemOn() ? capNote(L) : ''}
      ${mine.length ? `<fieldset class="frame"><legend>Your Books</legend><div class="stack">${mine.map(t => {
        const space = FA.capSpace(L, t);
        const tools = space > 0 ? `<span class="up">$${space}M cap space</span>` : `<span class="down">$${-space}M over the cap</span>`;
        const ml = FA.mleFor(L, t, s.day, s.used);
        const extra = [ml ? `<span class="gold">${ml.name} available · $${ml.sal}M</span>` : s.used.mle.has(t.id) ? '<span class="muted">MLE used</span>' : '', s.used.hard?.has(t.id) ? '<span class="down">Hard-capped at the 1st apron</span>' : ''].filter(Boolean).join(' · ');
        return `<div class="books-row"><span class="team-stack">${logoImg(t)}<b>${esc(t.shortName)}</b></span><span class="grow">${capBar(t)}${extra ? `<span class="small">${extra}</span>` : ''}</span><span class="small muted" title="Up to ${O.rosterMax} until final cuts">${FA.signedRoster(t).length}/${O.seasonMax}${FA.signedRoster(t).length > O.seasonMax ? ' <span class="gold">+</span>' : ''}</span></div>`;
      }).join('')}
      </div></fieldset>` : '<p class="note muted small">Select your teams to make offers.</p>'}
      ${mine.length ? faRosterBox(s, mine) : ''}
      ${s.stage === 'done' ? faResults(s) : ''}
      <div class="stack">${stageBtn}</div>
      ${s.stage === 'open' ? '<p class="note muted small">Make your offers (tap a player), then open bidding.</p>' : s.stage === 'bidding' ? '<p class="note muted small">Raise if you\'re behind. When players decide, other teams get one last chance to outbid you.</p>' : ''}
      <div class="tabs fa-tabs fa-tabs6">${views.map(([k, l]) => `<button class="btn ${k === view ? 'on focus' : 'off'}" data-act="faView" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="list">${rows.map(row).join('')}</div>
      ${total > rows.length ? `<button class="btn small" data-act="faAll">Show all ${total}</button>` : ''}`,
  });
};

// Your expiring deals, first thing on the screen, biggest asks first. Tap
// one to re-sign him (or let him walk) from the offer pop-up.
function expiringSection(s) {
  const L = league();
  const signed = new Set(s.signings.map(x => x.p.id));
  const rows = s.market.filter(m => m.from && isUserTeam(m.from) && m.p.status === FA.STATUS_EXPIRING && !signed.has(m.p.id))
    .sort((a, b) => b.ask - a.ask || shownLevel(b.p) - shownLevel(a.p));
  if (!rows.length) return '';
  const locked = s.stage === 'done';
  return `<fieldset class="frame exp-deals"><legend>Your Expiring Deals (${rows.length})</legend><div class="list">${rows.map(m => {
    const list = s.bids.get(m.p.id) || [];
    const mineBid = list.find(b => isUserTeam({ id: b.tid }));
    const others = list.filter(b => !isUserTeam({ id: b.tid })).length;
    return `<button class="prow ${mineBid ? 'sel' : ''}" data-act="faOffer" data-id="${m.p.id}" ${locked ? 'disabled' : ''}>
      <span class="name">${esc(playerName(m.p))} ${lvTag(m.p)}${FA.isRestricted(L, m.p) ? ' <span class="badge new">RFA</span>' : ''}</span>
      <span class="meta">${esc(posName(m.p))} · ${m.p.age}y${mineBid ? ` · <span class="up">your offer ${offerText(mineBid)}</span>` : ''}${others ? ` · <span class="gold">${others} other team${others > 1 ? 's' : ''}</span>` : ''}</span>
      <span class="meta">Asks $${m.ask}M × ${askYears(m)}</span>
    </button>`;
  }).join('')}</div></fieldset>`;
}

actions.faWalk = async d => {
  const L = league(), s = faState();
  const m = s.market.find(x => x.p.id === +d.id);
  if (!m || !m.from) return;
  if (!(await confirmBox(`Let <b>${esc(playerName(m.p))}</b> walk? He leaves ${esc(m.from.shortName)} for the open market.`, 'Let Walk'))) return;
  checkpoint(`Let ${playerName(m.p)} walk`);
  const rec = FA.releasePlayer(L, m.from, m.p);
  (s.walked ||= []).push(rec);
  s.bids.set(m.p.id, (s.bids.get(m.p.id) || []).filter(b => !isUserTeam({ id: b.tid })));
  optStore().qo[m.p.id] = false; saveOptStore(); FA.setQualifyingOffers(optStore().qo);
  m.from = null;
  state.dirty = true;
  render();
  toast(`${playerName(m.p)} is a free agent`);
};

function faResults(s) {
  if (!s.signings.length) return '<p class="note">No one signed today.</p>';
  const list = [...s.signings].sort((a, b) => b.offer.sal - a.offer.sal || b.offer.yrs - a.offer.yrs);
  return `<fieldset class="frame"><legend>Day ${s.day} Signings (${s.signings.length})</legend>
    <div class="stack">${list.map(x => `<div class="drill-row tap ${isUserTeam(x.team) ? 'r1' : ''}" data-act="openPlayer" data-id="${x.p.id}"><span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)}<br>
      <span class="small">${offerText(x.offer)} <span class="muted">($${x.offer.sal * x.offer.yrs}M)</span>${x.kind === 'mle' ? ' <span class="badge new">MLE</span>' : x.kind === 'vetMin' ? ' <span class="badge">Vet min</span>' : x.kind === 'min' ? ' <span class="badge">Min</span>' : x.kind === 'snt' ? ' <span class="badge new">S&amp;T</span>' : ''}</span><br>
      <span class="small muted">${esc(posName(x.p))} · ${x.p.age}y${x.bidders > 1 ? ` · ${x.bidders} offers` : ''} <span title="${esc(String(x.why))}">${esc(String(x.why).trim().split(' ')[0])}</span></span></span><span class="team-stack small">${logoImg(x.team)}${esc(x.team.shortName)}</span></div>`).join('')}
    </div>${s.released?.qo?.length ? `<p class="note small" style="margin-top:8px">Took the qualifying offer (1 year, unrestricted next summer): ${s.released.qo.map(q => `<b class="${isUserTeam(q.team) ? 'gold' : ''}">${esc(playerName(q.p))}</b> (${esc(q.team.shortName)}, $${q.sal}M)`).join(', ')}.</p>` : ''}${s.released?.length ? `<p class="note muted small" style="margin-top:8px">${s.released.length} players without a deal were released to free agency.</p>` : ''}</fieldset>`;
}

actions.faHome = () => goHome();
// Your roster by guard / wing / big, with a team switch, without leaving
// the market. Open state and team stick across tabs.
function faRosterBox(s, mine) {
  const t = mine.find(x => x.id === state.faTeam) || mine[0];
  const ro = FA.signedRoster(t).sort((a, b) => shownLevel(b) - shownLevel(a));
  const grp = k => ro.filter(p => posGroup(p) === k);
  const G = [['guards', 'Guards'], ['wings', 'Wings'], ['bigs', 'Bigs']];
  const sum = G.map(([k, l]) => `${l} ${grp(k).length}`).join(' · ');
  return `<details class="frame fa-roster" ${state.faRosterOpen ? 'open' : ''}><summary data-act="faRosterToggle"><b>${esc(t.shortName)} roster</b> <span class="small muted">${sum}</span></summary>
    ${mine.length > 1 ? `<div class="tabs fa-tabs">${mine.map(x => `<button class="btn ${x === t ? 'on focus' : 'off'}" data-act="faTeam" data-id="${x.id}">${esc(x.shortName)}</button>`).join('')}</div>` : ''}
    ${G.map(([k, l]) => `<p class="note small" style="margin-top:6px"><b>${l}</b> <span class="muted">(${grp(k).length})</span></p>
      ${grp(k).map(p => `<div class="small" style="display:flex;justify-content:space-between;gap:8px"><span>${esc(playerName(p))} <span class="gold">Lv ${shownLevel(p)}</span> <span class="muted">${esc(posName(p))} · ${p.age}y</span></span><span class="muted">$${p.contract.sal}M × ${p.contract.yrs}</span></div>`).join('') || '<span class="small muted">None</span>'}`).join('')}
  </details>`;
}
actions.faRosterToggle = () => { state.faRosterOpen = !state.faRosterOpen; replace('fa', state.stack[state.stack.length - 1].args); };
actions.faTeam = d => { state.faTeam = +d.id; state.faRosterOpen = true; replace('fa', state.stack[state.stack.length - 1].args); };
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
    const pick = await choiceBox(`<b>${esc(playerName(m.p))}</b> (RFA) signed an offer sheet with <b>${esc(by.shortName)}</b>: ${offerText(best)} ($${best.sal * best.yrs}M). Match it to keep him, or match and trade him?`,
      [['let', 'Let Go', 'off'], ['snt', '🔁 Sign-and-Trade', ''], ['match', 'Match', 'focus']]);
    if (pick === 'snt' && await sntBox(m, s)) continue;
    matches.set(m.p.id, pick === 'match');
  }
  s.signings = [...s.signings.filter(x => x.kind === 'snt'), ...FA.decide(L, s.market, s.bids, s.day, s.used, FA.FA_DEFAULTS, { matches, userTeams: state.userTeams })];
  for (const x of s.signings) { if (x.kind !== 'snt') lockSigning(x.p, signingLock(x)); contractMorale(x.p, x.team, x.from); }
  {
    const ld = s.signings.filter(x => x.offer?.load && x.offer.load !== 'flat' && x.offer.yrs >= 2 && isUserTeam(x.team));
    if (ld.length) saveLoadStore([...loadStore().filter(r => !ld.some(x => x.p.id === r.pid)), ...ld.map(x => ({ pid: x.p.id, base: lastSeasonYear(), sched: loadSchedule(x.offer.avg ?? x.offer.sal, x.offer.yrs, x.offer.load), at: 0 }))]);
    const inc = s.signings.filter(x => x.offer?.inc && isUserTeam(x.team));
    if (inc.length) saveIncStore([...incStore().filter(r => !inc.some(x => x.p.id === r.pid && !r.done)), ...inc.map(x => ({ pid: x.p.id, tid: x.team.id, base: lastSeasonYear(), ...x.offer.inc, done: false }))]);
  }
  // Last day: anyone still without a deal leaves their old team.
  if (s.day >= (L.season.signingDays || 3)) s.released = FA.releaseUnsigned(L, { qoFor: qoAmount, day: s.day });
  // The calendar shows the best player signed and the biggest contract.
  const top = [...s.signings].sort((x, y) => y.offer.sal * y.offer.yrs - x.offer.sal * x.offer.yrs)[0];
  const best = [...s.signings].sort((x, y) => shownLevel(y.p) - shownLevel(x.p))[0];
  const line = x => x && `${playerName(x.p)} to ${x.team.shortName} ($${x.offer.sal * x.offer.yrs}M)`;
  (calFlags().faLog ||= {})[s.day] = { n: s.signings.length, best: line(best), big: line(top) };
  state.undo = null;
  saveUsed(s.used);
  const swaps = cpuBlockDeals(s.day);
  if (state.params.faClearCpuOffers) {
    s.cleared = L.contractOffers.map((o, i) => [o, i]).filter(([o]) => !state.userTeams.has(o.tid));
    L.contractOffers = L.contractOffers.filter(o => state.userTeams.has(o.tid));
  }
  s.stage = 'done';
  state.dirty = true;
  render();
  const mineSigned = s.signings.filter(x => isUserTeam(x.team)).length;
  const qos = s.released?.qo || [];
  if (swaps.length) setTimeout(() => toast(`🔁 ${swaps.length} trade${swaps.length > 1 ? 's' : ''} around the league`, swaps.slice(0, 3).join(' · ')), 3200);
  toast(`${s.signings.length} signed${mineSigned ? `, ${mineSigned} with your teams` : ''}`, qos.length ? `${qos.length} restricted free agent${qos.length > 1 ? 's' : ''} accepted the qualifying offer.` : '');
};

// CPU players on the block get dealt during free agency: a CPU team that
// values him close to what he's worth sends a player or pick back. Each
// player is shopped once per day until someone bites.
// Front offices plan ahead. A contending team with young players who'll need
// new money soon (rookie deals ending, a rising core) and a payroll that would
// pass the tax line puts its older, overpaid players on the block to make
// room a year early. Done once per offseason; the deals then go through the
// usual block shopping. Returns the reasons, by player id.
function proactiveFrontOffice() {
  const L = league();
  const store = offGet('fo');
  if (store.done) return store.why || {};
  const why = {};
  if (FA.capSystemOn()) {
    const tax = FA.capLines(L, 1).tax;
    let n = 0;
    for (const t of L.teams.filter(x => !isUserTeam(x))) {
      if (n >= 6) break;
      const st = teamStatus(L, t);
      if (st !== 'contending' && st !== 'competing') continue;
      const players = FA.signedRoster(t);
      const core = players.filter(p => p.age <= 26 && p.pot >= 7 && shownLevel(p) >= 75 && (p.contract?.yrs ?? 9) <= 1);
      if (!core.length) continue;
      const committed = players.filter(p => (p.contract?.yrs ?? 0) >= 2).reduce((s, p) => s + (p.contract.sal || 0), 0);
      const raises = core.reduce((s, p) => s + Math.max(fairSalary(shownLevel(p)) * 1.05, p.contract?.sal || 0), 0);
      let over = committed + raises - (tax - 10);   // a front office stays clear of the line, not just under it
      if (over <= 0) continue;
      const cands = players.filter(p => p.age >= 31 && (p.contract?.yrs ?? 0) >= 2 && p.season?.onTradeBlock === 0 && !tradeLock(p)
        && (p.contract.sal - fairSalary(shownLevel(p))) >= tagGap(fairSalary(shownLevel(p))))
        .sort((x, y) => (y.contract.sal - fairSalary(shownLevel(y))) - (x.contract.sal - fairSalary(shownLevel(x))));
      for (const p of cands.slice(0, 2)) {
        if (over <= 0 || n >= 6) break;
        p.season.onTradeBlock = 1;
        why[p.id] = `clearing room for ${core.slice(0, 2).map(x => x.ln || playerName(x)).join(' and ')}`;
        over -= p.contract.sal;
        n++;
      }
    }
  }
  offSet('fo', { done: true, why });
  if (Object.keys(why).length) state.dirty = true;
  return why;
}
// A player with a 9 or 10 potential traded for a lot usually signs long term with the team that gets him.
function extendAfterTrade(p, team, ratio) {
  const L = league();
  if (!p || p.pot < 9 || ratio < 0.95 || (p.contract?.yrs ?? 0) > 2 || p.contract?.ext?.yrs > 0) return false;
  const a = extAsk(p, team);
  signExtension(L, team, p, { sal: a.sal, yrs: Math.max(3, a.pref), opt: 0 }, !isUserTeam(team));
  return a;
}

function cpuBlockDeals(day) {
  const L = league();
  if (!isComplete() || isCollege()) return [];
  const ly = lastYear(), yr = L.season.currentYear;
  const rng = mulberry32((saveSalt() ^ Math.imul(day + 3, 0x9e3779b1)) >>> 0);
  const cpu = L.teams.filter(t => !isUserTeam(t));
  const done = [];
  const why = proactiveFrontOffice();
  for (const t of cpu) {
    // Only players actually on the block (1), never untouchables (2), and only a few deals a day.
    for (const p of FA.signedRoster(t).filter(x => x.season?.onTradeBlock === 1 && !tradeLock(x) && x.contract?.yrs > 0)) {
      if (done.length >= 5) break;
      if (rng() > 0.4) continue;                                   // not every shopped player draws a call every day
      const want = playerValue(p, state.leagueIdx, ly);
      let best = null;
      for (const u of [...cpu].filter(x => x !== t).sort(() => rng() - 0.5).slice(0, 12)) {
        const stars = new Set([...u.roster].sort((a, b) => playerValue(b, state.leagueIdx, ly) - playerValue(a, state.leagueIdx, ly)).slice(0, 2));
        const assets = [
          ...FA.signedRoster(u).filter(x => !stars.has(x) && !tradeLock(x) && x.contract?.yrs > 0).map(x => ({ player: x, value: playerValue(x, state.leagueIdx, ly) })),
          ...u.draftPicks.filter(pk => pk.yr > yr && !FA.pickFrozen(L, u, pk)).map(pk => ({ pick: pk, value: futureValue(pk) })),
        ];
        const packs = [];
        for (let i = 0; i < assets.length; i++) {
          packs.push([assets[i]]);
          for (let j = i + 1; j < assets.length && packs.length < 300; j++) packs.push([assets[i], assets[j]]);
        }
        for (const pack of packs) {
          const v = pack.reduce((a, x) => a + x.value, 0);
          if (v < want * 0.8 || v > want * 1.1) continue;
          const A = { team: t, players: [p], picks: [] };
          const B = { team: u, players: pack.filter(x => x.player).map(x => x.player), picks: pack.filter(x => x.pick).map(x => x.pick) };
          if (tradeRulesErr(L, A, B) || ntcRefusal(L, A, B)) continue;
          const score = Math.abs(v - want * 0.95);
          if (!best || score < best.score) best = { A, B, score };
        }
        if (best && best.score < want * 0.1) break;
      }
      if (!best) continue;
      const rec = executeTrade(best.A, best.B, yr);
      for (const m of rec.moved) tradeMorale(L, m.p, m.to, m.from);
      markAway(rec.moved);
      if (p.season) p.season.onTradeBlock = 0;
      const back = [...best.B.players.map(playerName), ...best.B.picks.map(pk => pickLabel(pk))].join(', ');
      const ext = extendAfterTrade(p, best.B.team, (best.B.players.map(x => playerValue(x, state.leagueIdx, ly)).reduce((s, v) => s + v, 0) + best.B.picks.reduce((s, pk) => s + futureValue(pk), 0)) / Math.max(1, want));
      done.push(`${best.A.team.shortName} send ${playerName(p)} to ${best.B.team.shortName} for ${back}${why[p.id] ? ` (${why[p.id]})` : ''}${ext ? `; he signs a ${Math.max(3, ext.pref)}-year extension` : ''}`);
    }
  }
  if (done.length) { const log = offGet('cpuTrades'); offSet('cpuTrades', Array.isArray(log) ? [...log, ...done] : done); state.dirty = true; }
  return done;
}

actions.faUndo = async () => {
  const s = faState();
  const L = league();
  if (!(await confirmBox('Undo today\'s signings?', 'Undo'))) return;
  if (s.released) { FA.unreleaseUnsigned(L, s.released); s.released = null; }
  if (s.walked?.length) { FA.unreleaseUnsigned(L, s.walked); for (const r of s.walked) { const m = s.market.find(x => x.p === r.p); if (m) m.from = r.team; } s.walked = []; }
  if (s.cleared) for (const [o, i] of s.cleared) L.contractOffers.splice(i, 0, o);
  for (const x of [...s.signings].reverse()) { if (x.trade) undoTrade(x.trade); FA.unsignPlayer(L, x.rec); }
  for (const x of s.signings) if (x.kind === 'mle') s.used.mle.delete(x.team.id);
  saveUsed(s.used);
  s.signings = [];
  s.cleared = null;
  s.stage = 'bidding';
  if (calFlags().faLog) delete calFlags().faLog[s.day];
  render();
};

// Last season's production as small stat boxes.
function prodBoxes(p) {
  const l = seasonLine(p, state.leagueIdx, lastYear());
  if (!l) return '';
  const cells = [['PTS', l.ppg], ['REB', l.rpg], ['AST', l.apg], ['STL', l.spg], ['BLK', l.bpg]];
  return `<div class="prod-boxes">${cells.map(([k, v]) => `<span><b>${(v ?? 0).toFixed(1)}</b><small>${k}</small></span>`).join('')}</div>
    <p class="note small muted center">${l.gp} games${l.mpg != null ? ` · ${l.mpg.toFixed(1)} MPG` : ''}</p>`;
}
// ---------------------------------------------------------------------------
// Loaded contracts (Complete rules). The game keeps one salary per player, so
// the app keeps the schedule: the signing year's amount goes in the file, and
// each offseason it moves the salary to the next year's number. Front-loaded
// deals start high and step down 6% a year; back-loaded start low and step up.
const LOADS = { flat: 'Flat', front: 'Front-loaded', back: 'Back-loaded' };
function loadSchedule(avg, yrs, load) {
  if (yrs < 2 || !load || load === 'flat') return Array(yrs).fill(avg);
  const dir = load === 'front' ? -1 : 1;
  return Array.from({ length: yrs }, (_, i) => Math.max(1, Math.round(avg * (1 + 0.06 * dir * (i - (yrs - 1) / 2)))));
}

// "Qualifies for the Supermax": his own team can pay him a tier up (the Rose
// rule for 0-6 years of service, the supermax for 7-9), by award.
function maxLine(L, p, ahead = 0) {
  if (!FA.capSystemOn() || !FA.maxLabel(L, p)) return '';
  const rose = (p.yrs || 0) < 7;
  return `<p class="note small up">⭐ Qualifies for the ${rose ? 'Rose Rule' : 'Supermax'} (${FA.maxPct(L, p, true)}% of the cap) · ${esc(FA.maxReason(L, p))} · max $${FA.maxSalary(L, p, true, ahead)}M</p>`;
}
// The highest average a deal can carry: the first year can't pass the max, so
// a back-loaded deal's average can sit above it and a front-loaded one's below.
function maxAvgFor(L, p, own, yrs, load, ahead = 0) {
  const first = loadSchedule(1000, yrs, load)[0] / 1000;
  return Math.floor(FA.maxSalary(L, p, own, ahead) / first);
}
const loadKey = () => `hlc:load:${league().shortName}:${league().meta?.saveName || ''}`;
const loadStore = () => { try { return JSON.parse(localStorage.getItem(loadKey())) || []; } catch { return []; } };
const saveLoadStore = v => { try { localStorage.setItem(loadKey(), JSON.stringify(v)); } catch { /* ignore */ } };
// After each season, a loaded deal's salary moves to the next year's number.
function advanceLoads() {
  const L = league();
  if (!L || isCollege() || !isComplete() || ![2, 4, 5].includes(L.season.phase)) return;
  const ly = lastSeasonYear(), moved = [];
  const led = loadStore();
  for (const r of led) {
    const k = Math.min(ly - r.base, r.sched.length - 1);
    if (r.at >= k) continue;
    const p = L.teams.flatMap(t => t.roster).find(x => x.id === r.pid);
    r.at = k;
    if (!p || p.status !== FA.STATUS_SIGNED || !(p.contract?.yrs > 0)) continue;
    const bump = (p.contract.sal || 0) - r.sched[k - 1 < 0 ? 0 : k - 1];   // keep any incentive raise
    p.contract.sal = r.sched[k] + Math.max(0, bump);
    const stat = (p.stats || []).filter(s => s.yr === L.season.currentYear && s.league === 0).pop();
    if (stat && stat.sal) stat.sal = p.contract.sal;
    moved.push(`${playerName(p)} $${p.contract.sal}M`);
    state.dirty = true;
  }
  saveLoadStore(led.filter(r => r.at < r.sched.length - 1));
  if (moved.length) setTimeout(() => toast('📈 Contract steps', moved.slice(0, 4).join(' · '), 5200), 4200);
}

// ---------------------------------------------------------------------------
// Incentives (Complete rules). The game keeps one salary per player, so the
// app remembers the bonus: a player who hits it has his salary raised by the
// bonus the next offseason. He values it at the chance he hits it, shaded by
// what he cares about (money-minded players discount it hard).
const INCENTIVES = {
  playoffs: { label: 'Playoffs', text: 'team reaches the conference finals' },
  title: { label: 'Title', text: 'team wins the title' },
  allnba: { label: 'All-NBA', text: 'makes All-NBA' },
  prod: { label: 'Scoring', text: null },
  games: { label: 'Durability', text: 'plays 65+ games' },
};
const incStore = () => { try { return JSON.parse(localStorage.getItem(`hlc:inc:${league().shortName}:${league().meta?.saveName || ''}`)) || []; } catch { return []; } };
const saveIncStore = v => { try { localStorage.setItem(`hlc:inc:${league().shortName}:${league().meta?.saveName || ''}`, JSON.stringify(v)); } catch { /* ignore */ } };
// Last year's scoring sets the bar for a points incentive.
const incTarget = (p, kind) => {
  if (kind !== 'prod') return 0;
  const l = seasonLine(p, state.leagueIdx, lastSeasonYear());
  return Math.max(8, Math.round((l?.ppg ?? 10) + 1));
};
const incText = (p, inc) => inc.kind === 'prod' ? `averages ${inc.target ?? incTarget(p, 'prod')}+ points` : INCENTIVES[inc.kind].text;
function incOdds(p, team, kind) {
  const st = teamStatus(league(), team), lv = shownLevel(p);
  if (kind === 'playoffs') return st === 'contending' ? 0.5 : st === 'developing' ? 0.15 : 0.04;
  if (kind === 'title') return st === 'contending' ? 0.12 : 0.01;
  if (kind === 'allnba') return lv >= 92 ? 0.45 : lv >= 88 ? 0.25 : lv >= 84 ? 0.08 : 0.01;
  if (kind === 'prod') return 0.45;
  if (kind === 'games') return Math.max(0.15, 0.6 - (traitsSet(p) && tr(p, 'durability') <= 6 ? 0.3 : 0) - (p.age >= 33 ? 0.1 : 0));
  return 0;
}
// What the incentive is worth to him, in $M: chance x bonus x how much it
// speaks to him. Chasing money cheapens it; winning and work ethic help.
function incWorth(p, team, inc) {
  if (!inc?.bonus) return 0;
  const win = kind => kind === 'playoffs' || kind === 'title';
  let f = 0.55;
  if (traitsSet(p)) {
    f += win(inc.kind) ? (tr(p, 'winning') - 10) * 0.03 + (tr(p, 'playoffRiser') - 10) * 0.02 : (tr(p, 'motor') - 10) * 0.02;
    f -= (tr(p, 'money') - 10) * 0.025;
    if (tr(p, 'money') >= 17) f = Math.min(f, 0.25);
  }
  return Math.round(inc.bonus * incOdds(p, team, inc.kind) * Math.max(0.15, Math.min(1.1, f)) * 10) / 10;
}
// The first offseason after the season it covers: did he get there?
function settleIncentives() {
  const L = league();
  if (!L || isCollege() || !isComplete() || ![2, 4, 5].includes(L.season.phase)) return;
  const ly = lastSeasonYear(), hit = [];
  const led = incStore();
  for (const r of led.filter(x => !x.done && ly >= x.base + 1)) {
    const p = L.teams.flatMap(t => t.roster).find(x => x.id === r.pid);
    const team = p && L.teams.find(t => t.roster.includes(p));
    r.done = true;
    if (!p || !team) continue;
    const yr = r.base + 1;
    const l = seasonLine(p, state.leagueIdx, yr);
    const row = (L.teams.find(t => t.id === r.tid) || team).season?.find(x => x.yr === yr);
    const won = id => (p.awards || []).some(a => a.id === id && a.yearsWon?.includes(yr));
    const ok = r.kind === 'playoffs' ? (row?.round || 0) >= 3 : r.kind === 'title' ? won(0) || (row?.round === 4 && row?.seriesWins === 4)
      : r.kind === 'allnba' ? won(13) : r.kind === 'prod' ? !!l && l.ppg >= r.target : !!l && l.gp >= 65;
    r.hit = !!ok;
    if (ok && p.contract) {
      p.contract.sal += r.bonus;
      const stat = (p.stats || []).filter(s => s.yr === L.season.currentYear && s.league === 0).pop();
      if (stat && stat.sal) stat.sal += r.bonus;
      hit.push(`${playerName(p)} +$${r.bonus}M`);
      state.dirty = true;
    }
  }
  saveIncStore(led);
  if (hit.length) setTimeout(() => toast(`💰 Incentives earned`, hit.join(' · '), 5200), 3600);
}
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
  const ownExpiring = m.from && isUserTeam(m.from) && m.p.status === FA.STATUS_EXPIRING;
  // One-tap offers: the mid-level exception (Day 2+, teams over the cap) and
  // the veterans' minimum (Day 3, ages 30+).
  const minSal = FA.minFor(m.p), minLabel = FA.isVet(m.p) ? 'Vet Min' : 'Minimum';
  // No minimum offers to good players in the first week.
  const vetMinOk = team => FA.minOk(m.p) && !(s.day === 1 && shownLevel(m.p) >= 76) && !FA.checkOffer(L, team, m.p, { sal: minSal, yrs: 1, opt: 0 }, s.day, s.used);
  const mleOk = team => FA.offerRoom(L, team, m.p, s.day, s.used).mle;
  const quick = team => {
    const btns = [];
    const ml = mleOk(team);
    if (ml) btns.push(`<button class="btn ${draft.sal === ml.sal && draft.yrs === ml.yrs ? 'on focus' : ''}" data-k="mle">📝 Offer ${ml.name} · $${ml.sal}M × ${ml.yrs}</button>`);
    if (vetMinOk(team)) btns.push(`<button class="btn" data-k="vetmin">⚡ Offer ${minLabel} · $${minSal}M × 1</button>`);
    return btns.length ? `<div class="stack">${btns.join('')}</div>` : '';
  };
  const paint = () => {
    const team = L.teams.find(t => t.id === draft.tid);
    // The salary stepper sets the average year; the cap hit is year one.
    draft.avg ??= draft.sal;
    if (draft.yrs < 2) draft.load = 'flat';
    draft.avg = Math.min(draft.avg, Math.max(FA.FA_DEFAULTS.minSalary, maxAvgFor(L, m.p, draft.tid === m.from?.id, draft.yrs, draft.load)));
    draft.sal = loadSchedule(draft.avg, draft.yrs, draft.load)[0];
    const pitched = (s.cutPitch ||= {})[m.p.id];
    if (pitched?.ok) { draft.cut = pitched.pct; draft.cutEv = Math.round(draft.avg * pitched.pct * 10) / 10; }
    if (draft.inc) { draft.inc.bonus = Math.min(draft.inc.bonus, Math.max(2, Math.round(draft.sal * 0.3))); draft.incEv = incWorth(m.p, team, draft.inc); }
    const err = FA.checkOffer(L, team, m.p, draft, s.day, s.used);
    const kind = err ? null : FA.offerKind(L, team, m.p, draft, s.day, s.used);
    const others = list().filter(b => b.tid !== draft.tid);
    const score = b => FA.offerScore(L, m.p, b, m.ask, m.motive, m.from?.id, m.min < m.ask * 0.75);
    const rival = [...others].sort((a, b) => score(b) - score(a))[0];
    const standing = (draft.avg ?? draft.sal) + (draft.incEv || 0) < m.min ? `<span class="down">Below what they'll take ($${m.min}M)</span>`
      : !rival ? (s.stage === 'open' ? 'No other bids yet' : '<span class="up">Only offer</span>')
      : score(draft) >= score(rival) ? `<span class="up">Ahead of ${esc(L.teams.find(t => t.id === rival.tid).shortName)}</span>`
      : `<span class="down">Behind ${esc(L.teams.find(t => t.id === rival.tid).shortName)}</span>`;
    const hasExtras = isComplete() || (ownExpiring && cutPitchOk(m.p, team));
    const tab = hasExtras && draft.tab === 'extras' ? 'extras' : 'terms';
    const extrasOn = (draft.load && draft.load !== 'flat' && draft.yrs >= 2 ? 1 : 0) + (draft.inc ? 1 : 0) + (pitched?.ok ? 1 : 0);
    const termsHtml = `${quick(team)}
      <div class="pts-row"><span class="grow">Salary</span><button class="btn square" data-k="sal" data-d="-1">−</button><span class="pts-val">$${draft.avg}M</span><button class="btn square" data-k="sal" data-d="1">+</button></div>
      <div class="pts-row"><span class="grow">Years</span><button class="btn square" data-k="yrs" data-d="-1">−</button><span class="pts-val">${draft.yrs}</span><button class="btn square" data-k="yrs" data-d="1">+</button></div>
      <div class="tabs">${[[0, 'No Option'], [2, 'Player'], [1, 'Team']].map(([v, l]) => `<button class="btn ${draft.opt === v ? 'on focus' : 'off'}" data-k="opt" data-v="${v}">${l}</button>`).join('')}</div>
      ${draft.tid === m.from?.id && FA.ntcEligible(L, m.p, m.from) ? `<div class="tabs">${[[0, 'No NTC'], [1, 'No-trade clause']].map(([v, l]) => `<button class="btn ${!!draft.ntc === !!v ? 'on focus' : 'off'}" data-k="ntc" data-v="${v}">${l}</button>`).join('')}</div>${FA.wantsNtc(L, m.p, m.from) ? '<p class="note small">He wants a no-trade clause.</p>' : ''}` : ''}
${extrasOn && hasExtras ? `<p class="note small muted">Includes: ${[draft.load && draft.load !== 'flat' && draft.yrs >= 2 ? LOADS[draft.load] : '', draft.inc ? `$${draft.inc.bonus}M bonus (${INCENTIVES[draft.inc.kind].label})` : '', pitched?.ok ? 'pay cut' : ''].filter(Boolean).join(' · ')}</p>` : ''}`;
    const extrasHtml = `
      ${isComplete() && draft.yrs >= 2 ? `<div class="tabs">${['back', 'flat', 'front'].map(k => `<button class="btn small ${(draft.load || 'flat') === k ? 'on focus' : 'off'}" data-k="load" data-v="${k}">${LOADS[k].replace('-loaded', '')}</button>`).join('')}</div>
        ${draft.load && draft.load !== 'flat' ? `<p class="note small muted">${loadSchedule(draft.avg, draft.yrs, draft.load).map(v => `$${v}M`).join(' → ')} (cap hit this year $${draft.sal}M)</p>` : ''}` : ''}
      ${ownExpiring && cutPitchOk(m.p, team) ? ((s.cutPitch || {})[m.p.id] ? ((s.cutPitch[m.p.id].ok) ? `<p class="note small up">🏆 He'll count a ${Math.round(s.cutPitch[m.p.id].pct * 100)}% discount as worth it to keep this team a contender.</p>` : '<p class="note small muted">He heard the pay-cut pitch and passed.</p>') : '<button class="btn" data-k="cut">🏆 Pitch a Pay Cut to Win</button>') : ''}
      ${isComplete() ? `<div class="tabs fa-tabs fa-tabs6">${[['', 'No Incentive'], ...['playoffs', 'title', 'games', 'prod', 'allnba'].map(k => [k, INCENTIVES[k].label])].map(([k, l]) => `<button class="btn small ${(draft.inc?.kind || '') === k ? 'on focus' : 'off'}" data-k="inckind" data-v="${k}">${l}</button>`).join('')}</div>
        ${draft.inc ? `<div class="pts-row"><span class="grow small">Bonus if ${esc(incText(m.p, draft.inc))} · <span class="muted">worth ~$${draft.incEv}M to him (${Math.round(incOdds(m.p, team, draft.inc.kind) * 100)}%)</span></span><button class="btn square" data-k="incbonus" data-d="-1">−</button><span class="pts-val">$${draft.inc.bonus}M</span><button class="btn square" data-k="incbonus" data-d="1">+</button></div>` : ''}` : ''}
`;
    box.querySelector('.box').innerHTML = `
      <p class="note"><b>${esc(playerName(m.p))}</b> <span class="${declining(m.p) ? 'decl-lv' : 'gold'}">Lv ${shownLevel(m.p)}</span>${FA.isRestricted(L, m.p) ? ' <span class="badge new">RFA</span>' : ''}<br>
        <span class="small muted">${esc(posName(m.p))} · ${m.p.age}y · asking $${m.ask}M × ${askYears(m)}</span></p>
      ${m.from && isUserTeam(m.from) ? maxLine(L, m.p) : ''}
      ${prodBoxes(m.p)}
      ${m.p.age >= 33 && activeSkills(m.p).length ? `<p class="note small">${activeSkills(m.p).map(x => `<span class="sk-name sk-${SKILL_GROUP[skillCategory(x.id)] || ''}">${esc(skillName(x.id))}${isLeveled(x.id) ? ` ${x.level}` : ''}</span>`).join(' · ')}</p>` : ''}
      <p class="note small">${M.icon} ${esc(M.name)}: ${esc(M.text)}.</p>
      ${mine.length > 1 ? `<select class="sel-team" data-k="tid">${mine.map(t => `<option value="${t.id}" ${t.id === draft.tid ? 'selected' : ''}>${esc(t.shortName)}</option>`).join('')}</select>` : ''}
      ${hasExtras ? `<div class="tabs">${[['terms', 'Terms'], ['extras', `Structure${extrasOn ? ` · ${extrasOn}` : ''}`]].map(([k, l]) => `<button class="btn small ${tab === k ? 'on focus' : 'off'}" data-k="tab" data-v="${k}">${l}</button>`).join('')}</div>` : ''}
      ${tab === 'extras' ? extrasHtml : termsHtml}
      <p class="note small">Total $${loadSchedule(draft.avg, draft.yrs, draft.load).reduce((x, y) => x + y, 0)}M · ${err ? `<span class="down">${esc(err)}</span>` : `uses ${{ space: 'cap space', bird: 'Bird rights', mle: 'the MLE', min: 'the minimum', vetMin: 'the vet minimum' }[kind]}`}</p>
      <p class="note small">${standing}</p>
      ${sntOk(m, s) ? `<button class="btn" data-k="snt">🔁 Sign-and-Trade · ${sntSuitors(m, s).length} team${sntSuitors(m, s).length > 1 ? 's' : ''} interested</button>` : ''}
      <div class="${ownExpiring ? 'grid3' : 'grid2'}">
        <button class="btn off" data-k="close">${existing ? 'Withdraw' : 'Cancel'}</button>
        <button class="btn focus" data-k="submit" ${err ? 'disabled' : ''}>${existing ? 'Update Offer' : 'Make Offer'}</button>
        ${ownExpiring ? '<button class="btn off" data-k="walk">Let Walk</button>' : ''}
      </div>`;
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (!b || b.tagName === 'SELECT') return;
    const k = b.dataset.k;
    if (k === 'tab') draft.tab = b.dataset.v;
    else if (k === 'sal') draft.avg = Math.max(FA.FA_DEFAULTS.minSalary, Math.min(maxAvgFor(L, m.p, draft.tid === m.from?.id, draft.yrs, draft.load), (draft.avg ?? draft.sal) + +b.dataset.d));
    else if (k === 'load') draft.load = b.dataset.v;
    else if (k === 'yrs') draft.yrs = Math.max(1, Math.min(FA.FA_DEFAULTS.birdMaxYears, draft.yrs + +b.dataset.d));
    else if (k === 'opt') draft.opt = +b.dataset.v;
    else if (k === 'cut') {
      const r = cutPitch(m.p, L.teams.find(t => t.id === draft.tid));
      (s.cutPitch ||= {})[m.p.id] = r;
      if (!r.ok && m.p.season) m.p.season.morale = Math.max(0, (m.p.season.morale ?? 60) - 3);
      toast(r.ok ? `${playerName(m.p)} is in` : `${playerName(m.p)} passed`, r.ok ? `He'll weigh a ${Math.round(r.pct * 100)}% discount as worth it.` : 'He wants his money.', 2600, !r.ok);
    }
    else if (k === 'inckind' || k === 'incbonus') {
      const tm = L.teams.find(t => t.id === draft.tid);
      if (k === 'inckind') draft.inc = b.dataset.v ? { kind: b.dataset.v, bonus: draft.inc?.bonus || 2, target: incTarget(m.p, b.dataset.v) } : null;
      else draft.inc = { ...draft.inc, bonus: Math.max(1, Math.min(Math.max(2, Math.round(draft.sal * 0.3)), draft.inc.bonus + +b.dataset.d)) };
      draft.incEv = draft.inc ? incWorth(m.p, tm, draft.inc) : 0;
      if (!draft.inc) delete draft.inc;
    }
    else if (k === 'ntc') draft.ntc = !!+b.dataset.v;
    else if (k === 'mle') { const ml = mleOk(L.teams.find(t => t.id === draft.tid)); if (ml) { draft.sal = draft.avg = ml.sal; draft.yrs = ml.yrs; draft.load = 'flat'; } }
    else if (k === 'snt') { box.remove(); sntBox(m, s).then(done => { if (done) render(); }); return; }
    else if (k === 'walk') { box.remove(); actions.faWalk({ id: m.p.id }); return; }
    else if (k === 'vetmin') {
      const rest = list().filter(x => x !== existing && x.tid !== draft.tid);
      s.bids.set(m.p.id, [...rest, { tid: draft.tid, sal: minSal, yrs: 1, opt: 0, cpu: false }]);
      box.remove(); render();
      toast(`${minLabel} offered to ${playerName(m.p)}`);
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
// Sign-and-trade: one of your free agents (restricted, or yours to re-sign
// with Bird rights) that other teams want. Their offers show who's
// interested; pick a team, sign him to their terms (up to 5 years with Bird
// rights) and send him there for players and picks worth about what he is
// on that deal.

const sntSuitors = (m, s) => {
  const L = league();
  const score = b => FA.offerScore(L, m.p, b, m.ask, m.motive, m.from?.id, m.min < m.ask * 0.75);
  // A team at or over the 1st apron after the deal can't take a sign-and-trade.
  const fits = b => { const t = L.teams.find(x => x.id === b.tid); return !t || !FA.capSystemOn() || FA.teamCommitted(t) + b.sal < FA.capLines(L).apron1; };
  return (s.bids.get(m.p.id) || []).filter(b => !isUserTeam({ id: b.tid }) && b.tid !== m.from?.id && fits(b)).sort((a, b) => score(b) - score(a));
};
// Over the 2nd apron, you can't send your own free agent out in one.
const sntOk = (m, s) => s.stage === 'bidding' && m.from && isUserTeam(m.from) && m.p.status === FA.STATUS_EXPIRING && FA.capTier(league(), m.from) !== 'apron2' && sntSuitors(m, s).length > 0;

// His trade value on a contract (the contract set just for the count).
function valueOnDeal(p, deal) {
  const keep = { ...p.contract }, st = p.status;
  Object.assign(p.contract, { yrs: deal.yrs, sal: deal.sal, opt: deal.opt || 0 });
  p.status = FA.STATUS_SIGNED;
  const v = faValue(p);
  Object.assign(p.contract, keep);
  p.status = st;
  return v;
}
// What the other team sends back: players and future picks adding up to
// about his value (a CPU team wants a little more than it gives, so the
// target is value / 1.08). `lean` = 'players' | 'picks' goes first.
function sntPackage(L, m, partner, deal, lean, s) {
  const target = valueOnDeal(m.p, deal) / 1.08;
  const yr = L.season.currentYear;
  const fresh = new Set(s.signings.map(x => x.p.id));
  const players = FA.signedRoster(partner).filter(p => !fresh.has(p.id) && p.status === FA.STATUS_SIGNED)
    .map(p => ({ p, v: faValue(p), label: `${playerName(p)} (Lv ${shownLevel(p)}, $${p.contract.sal}M × ${p.contract.yrs})` }));
  const picks = partner.draftPicks.filter(pk => pk.yr > yr && !FA.pickFrozen(L, partner, pk)).map(pk => ({ pk, v: pickValue(L, pk), label: pickLabel(pk, L) }));
  const pool = (lean === 'picks' ? [...picks, ...players] : [...players, ...picks]);
  const mine = L.teams.find(t => t.id === m.from.id);
  const room = FA.FA_DEFAULTS.rosterMax - FA.signedRoster(mine).length;  // offseason limit
  const out = [];
  let sum = 0;
  // Biggest piece that still fits first, then fill (four pieces at most).
  const sorted = lean === 'picks' ? pool : [...pool].sort((a, b) => b.v - a.v);
  for (const a of sorted) {
    if (out.length >= 4 || sum >= target * 0.97) break;
    if (a.p && out.filter(x => x.p).length >= room) continue;
    if (sum + a.v <= target * 1.03) { out.push(a); sum += a.v; }
  }
  return { items: out, sum, target, fair: sum >= target * 0.8 };
}

// Returns true when a deal was made.
function sntBox(m, s) {
  const L = league();
  const suitors = sntSuitors(m, s);
  if (!suitors.length) return Promise.resolve(false);
  return new Promise(resolve => {
    const box = overlay('');
    let pick = 0, lean = 'players';
    let deal = { ...suitors[0] };
    const paint = () => {
      const offer = suitors[pick];
      const partner = L.teams.find(t => t.id === offer.tid);
      const pkg = sntPackage(L, m, partner, deal, lean, s);
      const v = valueOnDeal(m.p, deal);
      box.querySelector('.box').innerHTML = `
        <p class="note"><b>🔁 Sign-and-Trade: ${esc(playerName(m.p))}</b> <span class="gold">Lv ${shownLevel(m.p)}</span> · ${esc(posName(m.p))} · ${m.p.age}y</p>
        <p class="note small muted">Interest comes from their offers. Pick a team: you sign him to their terms with Bird rights (up to 5 years), then send him there.</p>
        <div class="stack">${suitors.map((b, i) => { const t = L.teams.find(x => x.id === b.tid); return `<button class="btn small ${i === pick ? 'on focus' : 'off'}" data-k="team" data-i="${i}">${esc(t.shortName)} · ${offerText(b)}</button>`; }).join('')}</div>
        <div class="pts-row"><span class="grow">Salary</span><span class="pts-val">$${deal.sal}M</span></div>
        <div class="pts-row"><span class="grow">Years</span><button class="btn square" data-k="yrs" data-d="-1">−</button><span class="pts-val">${deal.yrs}</span><button class="btn square" data-k="yrs" data-d="1">+</button></div>
        <p class="note small">His value on this deal: <b>${Math.round(v)}</b></p>
        <div class="tabs">${[['players', 'Players first'], ['picks', 'Picks first']].map(([k, l]) => `<button class="btn ${lean === k ? 'on focus' : 'off'}" data-k="lean" data-v="${k}">${l}</button>`).join('')}</div>
        <fieldset class="frame"><legend>${esc(partner.shortName)} send</legend><div class="stack">${pkg.items.map(a => `<p class="note small">${a.p ? '👤' : '🎟️'} ${esc(a.label)} <span class="muted">· ${Math.round(a.v)}</span></p>`).join('') || '<p class="note small muted">Nothing that fits.</p>'}</div>
          <p class="note small">${Math.round(pkg.sum)} back for ${Math.round(v)} · ${pkg.fair ? '<span class="up">Fair value</span>' : '<span class="down">The best they can do</span>'}</p></fieldset>
        <div class="grid2"><button class="btn off" data-k="close">Back</button><button class="btn focus" data-k="go" ${pkg.items.length ? '' : 'disabled'}>Make the Deal</button></div>`;
      box._pkg = pkg; box._partner = partner;
    };
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const k = b.dataset.k;
      if (k === 'team') { pick = +b.dataset.i; deal = { ...suitors[pick] }; }
      else if (k === 'yrs') deal.yrs = Math.max(1, Math.min(FA.FA_DEFAULTS.birdMaxYears, deal.yrs + +b.dataset.d));
      else if (k === 'lean') lean = b.dataset.v;
      else if (k === 'close') { box.remove(); resolve(false); return; }
      else if (k === 'go') {
        const partner = box._partner, pkg = box._pkg;
        const mine = L.teams.find(t => t.id === m.from.id);
        const rec = FA.signPlayer(L, m.p, mine, { yrs: deal.yrs, sal: deal.sal, opt: deal.yrs >= 5 && !deal.opt ? FA.OPT_PLAYER : deal.opt || 0 }, s.day);
        const trade = executeTrade({ team: mine, players: [m.p], picks: [] }, { team: partner, players: pkg.items.filter(a => a.p).map(a => a.p), picks: pkg.items.filter(a => a.pk).map(a => a.pk) }, L.season.currentYear);
        s.bids.delete(m.p.id);
        lockSigning(m.p, 'Sign-and-trade: Dec 15');
        const away = offGet('away');
        (away[mine.id] ||= []).push(m.p.id);
        for (const a of pkg.items) if (a.p) (away[partner.id] ||= []).push(a.p.id);
        offSet('away', away);
        const back = pkg.items.map(a => a.p ? playerName(a.p) : pickLabel(a.pk, L)).join(', ');
        s.signings.push({ p: m.p, from: m.from, team: partner, offer: { ...deal }, motive: m.motive, bidders: suitors.length, kind: 'snt', matched: false,
          why: `🔁 Sign-and-trade: ${mine.shortName} get ${back}`, rec, trade });
        state.dirty = true;
        box.remove();
        toast('🔁 Sign-and-Trade', `${playerName(m.p)} to ${partner.shortName} (${offerText(deal)}) for ${back}`);
        resolve(true);
        return;
      }
      paint();
    });
    paint();
  });
}

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
  // Your press conference headlines (and last year's promises) always run,
  // on top of the league's top 10.
  const pr = presserStore();
  const podium = [
    ...promiseStories(L, loadPromises()),
    ...L.teams.filter(isUserTeam).flatMap(t => presserStories(L, t, pr[t.id], li, pr.frozen?.[t.id])),
  ];
  return { stories: buildStorylines(L, { leagueIdx: li, leagues: state.data.seasonLeagues, params: state.params, dev, mentorships, faSignings }), players, podium };
}

function storylinesText(stories, podium = []) {
  const L = league();
  return `${L.shortName || L.leagueName} ${L.season.currentYear} · Top storylines\n\n` +
    (podium.length ? `From the podium\n\n${podium.map(s => `${s.icon} ${s.title}\n${s.text}`).join('\n\n')}\n\n` : '') +
    stories.map((s, i) => `${i + 1}. ${s.icon} ${s.title}\n${s.text}`).join('\n\n');
}

// ---------------------------------------------------------------------------
// GM Survey (before Media Day). Results are fixed per save + season, and each
// season's top answers are kept so next year can show "Last year".

function surveyNow() {
  const key = `${seasonKey()}:${state.leagueIdx}`;
  const c = (state.survey ||= {});
  if (!c[key]) c[key] = runSurvey(league(), state.leagueIdx, saveSalt());
  return c[key];
}
const surveyHistKey = () => `hlc:survey:${league().shortName}:${league().meta?.saveName || ''}`;
function surveyHist() { try { return JSON.parse(localStorage.getItem(surveyHistKey())) || {}; } catch { return {}; } }
function saveSurveyHist(S) {
  const h = surveyHist();
  h[S.year] = Object.fromEntries(S.questions.filter(q => q.results[0]).map(q => [q.id, { name: q.results[0].name, team: q.results[0].team, pct: q.results[0].pct }]));
  try { localStorage.setItem(surveyHistKey(), JSON.stringify(h)); } catch { /* ignore */ }
}
const SURVEY_TABS = ['Predictions', 'Players', 'Offseason', 'Defense', 'Coaches', 'Other'];
const SURVEY_LABEL = { Predictions: 'Predictions', Players: 'Players', Offseason: 'Offseason', Defense: 'Defense', Coaches: 'Coaches', Other: 'Other' };

function surveyRows(results, n = 5) {
  return `<div class="sv-rows">${results.slice(0, n).map((r, i) => {
    const t = league().teams.find(x => x.id === r.tid);
    const tint = t ? teamTint(t) : '';
    const name = r.kind === 'player' && r.tid >= 0 ? `<button class="linkish" data-act="openPlayer" data-id="${r.pid}">${esc(r.name)}</button>` : `<b>${esc(r.name)}</b>`;
    return `<div class="sv-row ${t && isUserTeam(t) ? 'mine' : ''}" ${tint ? `style="${tint}"` : ''}>
      <span class="sv-n">${i + 1}</span>${t ? logoImg(t) : ''}
      <span class="grow">${name}${r.coachTeam ? ` <span class="small muted">${esc(r.coachTeam)}</span>` : ''}${r.kind === 'player' ? ` <span class="small muted">${esc(r.team)}${r.country ? ` · ${esc(r.country)}` : ''}${r.pick ? ` · #${r.pick} pick` : ''}</span>` : ''}
        <span class="sv-bar"><span style="width:${Math.max(2, r.pct)}%"></span></span></span>
      <b class="sv-pct">${r.pct}%</b></div>`;
  }).join('') || '<p class="note muted small">No candidates this year.</p>'}</div>`;
}

screens.survey = (args) => {
  const S = surveyNow();
  const hist = surveyHist()[S.year - 1] || {};
  const tabs = SURVEY_TABS.filter(t => S.questions.some(q => q.section === t && q.results.length));
  const tab = tabs.includes(args.tab) ? args.tab : tabs[0];
  const qs = S.questions.filter(q => q.section === tab && q.results.length);
  const last = q => hist[q.id] ? `<p class="note small muted sv-last">Last year: <b>${esc(hist[q.id].name)}</b>${hist[q.id].team && !hist[q.id].name.includes(hist[q.id].team) ? ` (${esc(hist[q.id].team)})` : ''} · ${hist[q.id].pct}%</p>` : '';
  const card = q => `<fieldset class="frame sv-q"><legend>${esc(consensus(q.results))}</legend>
      <p class="note"><b>${esc(q.title)}</b></p>${surveyRows(q.results)}${last(q)}</fieldset>`;
  let body = qs.map(card).join('');
  if (tab === 'Predictions') {
    const seedCards = S.seeds.map(c => `<fieldset class="frame sv-q"><legend>Top 4 · ${esc(c.conf)}</legend>
      <p class="note"><b>How will the ${esc(c.conf)} seeds finish?</b></p>
      ${c.seeds.map((list, i) => `<p class="note small sv-seed">No. ${i + 1} seed</p>${surveyRows(list, 3)}`).join('')}</fieldset>`).join('');
    body = card(qs[0]) + seedCards + qs.slice(1).map(card).join('');
  }
  if (tab === 'Players') {
    body += `<fieldset class="frame sv-q"><legend>Most Votes Overall</legend>
      <p class="note small muted">Share of every vote cast in the player questions.</p>${surveyRows(S.topVoted)}</fieldset>`;
  }
  if (tab === 'Coaches' && S.coachesFound < S.gms) body = `<p class="note small muted">${S.gms - S.coachesFound} team${S.gms - S.coachesFound === 1 ? ' has' : 's have'} an open head coaching job and ${S.gms - S.coachesFound === 1 ? 'isn\'t' : 'aren\'t'} on the ballot.</p>` + body;
  if (tab === tabs[tabs.length - 1]) body += '<p class="note muted small center" style="margin:10px 0">That\'s all from this year\'s survey.</p>';
  layout({
    title: 'GM Survey',
    body: `<p class="note small">All ${S.gms} general managers answered. GMs can't vote for their own team or players.</p>
      <div class="sv-tabs">${tabs.map(t => `<button class="btn ${t === tab ? 'on focus' : 'off'}" data-act="surveyTab" data-t="${t}">${SURVEY_LABEL[t]}</button>`).join('')}</div>
      ${body}`,
    action: null,
  });
};
actions.surveyTab = d => replace('survey', { tab: d.t });
actions.surveyDone = () => { saveSurveyHist(surveyNow()); calFlags().survey = true; goHome(); toast('Next up: Media Day'); };

// ---------------------------------------------------------------------------
// Options deadline (Jun 29, Post-Draft). An option covers the last year of a
// deal (opt 1 = team option, opt 2 = player option), so it comes due with 1
// year left: picked up, that year is guaranteed (the option clears); declined
// or opted out, he's a free agent now (deal up, still listed on his team).
// The odd deal with 0 years left and an option gets one more year if picked
// up. Free agents with 3 or fewer years in the league get a qualifying offer
// or don't (restricted vs unrestricted in FA).

function optStore() {
  const key = `hlc:opts:${seasonKey()}`;
  const c = (state.opts ||= {});
  if (!c[key]) { let v = {}; try { v = JSON.parse(localStorage.getItem(key)) || {}; } catch { v = {}; } c[key] = { team: {}, qo: {}, ...v }; }
  return c[key];
}
function saveOptStore() { try { localStorage.setItem(`hlc:opts:${seasonKey()}`, JSON.stringify(optStore())); } catch { /* ignore */ } }

// CPU teams don't sign anyone before the options deadline: the game's
// pending CPU contract offers (to players whose deals are up) are taken out
// of the save on load and kept here; at the deadline the app makes the CPU's
// option calls, and the rest of the offers go back in.
function holdCpuOffers() {
  const L = league();
  if (!L || phaseRank(L.season) === 0 || phaseRank(L.season) >= 4 || optStore().done) return 0;
  const offers = L.contractOffers || [];
  const hold = offers.filter(o => !state.userTeams.has(o.tid));
  if (!hold.length) return 0;
  const st = optStore();
  const key = o => `${o.pid}:${o.tid}`;
  st.held = [...new Map([...(st.held || []), ...hold].map(o => [key(o), o])).values()];
  saveOptStore();
  L.contractOffers = offers.filter(o => state.userTeams.has(o.tid));
  state.dirty = true;
  return hold.length;
}

// The game decides every option before it exports (it leaves a news item
// for each: 18 player option exercised, 19 player option declined, 20 team
// option exercised, 21 team option declined). To run them here, the app
// puts those players back as they stood: exercised ones get their option
// flag back; declined ones come off the free-agent list with an estimated
// salary (the game wipes a declined deal). Returns how many it reopened.
const GAME_OPT = { 18: [2, false], 19: [2, true], 20: [1, false], 21: [1, true] };
function reopenOptions() {
  state.moraleDone = new Set();
  state.reopened = { n: 0, est: new Set() };
  const L = league();
  if (!L || isCollege() || state.params.redoOptions === false) return 0;
  const rk = phaseRank(L.season);
  if (rk < 1 || rk > 3 || optStore().done) return 0;
  const byId = new Map(L.teams.flatMap(t => t.roster.map(p => [p.id, [p, t]])));
  let n = 0;
  for (const nw of L.season.news || []) {
    const kind = nw.category === 2 && nw.phase === 2 ? GAME_OPT[nw.type] : null;
    const e = kind && byId.get(nw.pid);
    if (!e) continue;
    const [p, t] = e, [opt, declined] = kind;
    if (!declined && p.status === FA.STATUS_SIGNED && !p.contract.opt && (p.contract.yrs || 0) >= 1) {
      p.contract.opt = opt;
      n++;
    } else if (declined && p.status === FA.STATUS_EXPIRING && !(p.contract.yrs || 0) && t.id === nw.tid) {
      const d = p.history?.draft;
      const sal = salaryBook()[p.id] || (opt === 1 && FA.isRookieScale(p) && d?.pk > 0 ? rookieScale(L, d.pk) : Math.max(FA.FA_DEFAULTS.minSalary, Math.round(marketValue(p) * 0.85)));
      p.status = FA.STATUS_SIGNED;
      Object.assign(p.contract, { tid: t.id, pid: p.id, yrs: 1, sal, opt });
      state.reopened.est.add(p.id);
      n++;
    }
  }
  state.reopened.n = n;
  return n;
}

const optionPlayers = L => L.teams.flatMap(t => t.roster.filter(p => p.contract && (p.status === FA.STATUS_SIGNED || p.status === FA.STATUS_EXPIRING) && (p.contract.yrs || 0) <= 1 && (p.contract.opt === 1 || p.contract.opt === 2)).map(p => ({ p, team: t })));
const marketValue = p => fairSalary(shownLevel(p));
// Qualifying offer amount (NBA CBA): a first-rounder off his rookie deal
// gets a raise on his 4th-year salary that grows with draft slot (30% for
// the No. 1 pick up to 50% for No. 30); anyone else gets 135% of his last
// salary or the minimum, whichever is more. Last salaries come from the
// app's salary book (the game zeroes a deal once it's up); a first-rounder
// without one uses his slot's rookie scale.
function qoAmount(p) {
  const L = league(), last = salaryBook()[p.id] || 0, d = p.history?.draft;
  if (FA.isRookieScale(p) && d.pk > 0) {
    const base = last || rookieScale(L, d.pk);
    return Math.max(FA.FA_DEFAULTS.minSalary, Math.round(base * (1.3 + 0.2 * (Math.min(30, d.pk) - 1) / 29)));
  }
  return Math.max(FA.FA_DEFAULTS.minSalary, Math.round(last * 1.35));
}
// Every salary the app has seen, by player (kept across seasons).
const salaryKey = () => `hlc:sal:${league().shortName}:${league().meta?.saveName || ''}`;
function salaryBook() {
  const c = (state.salBook ||= {});
  const k = salaryKey();
  if (!c[k]) { try { c[k] = JSON.parse(localStorage.getItem(k)) || {}; } catch { c[k] = {}; } }
  return c[k];
}
function recordSalaries() {
  const L = league();
  if (!L) return;
  const book = salaryBook();
  let n = 0;
  for (const t of L.teams) for (const p of t.roster) if (p.contract?.sal > 0 && book[p.id] !== p.contract.sal) { book[p.id] = p.contract.sal; n++; }
  if (n) try { localStorage.setItem(salaryKey(), JSON.stringify(book)); } catch { /* ignore */ }
}

// Morale: from the save when it has a morale field, else from the season
// (a starter's minutes cut, or a losing team for a veteran).
function moraleLow(p, team) {
  for (const o of [p, p.season]) for (const [k, v] of Object.entries(o || {})) {
    if (!/morale|mood|happ/i.test(k) || typeof v?.valueOf() !== 'number') continue;
    const n = +v; const r = n <= 1 ? n : n <= 10 ? n / 10 : n / 100;
    return r < 0.35;
  }
  const l = seasonLine(p, state.leagueIdx, lastSeasonYear());
  const rank = 1 + team.roster.filter(x => shownLevel(x) > shownLevel(p)).length;
  const rec = teamRecord(team);
  return (!!l && rank <= 5 && l.mpg < 20) || (p.age >= 28 && rec.W + rec.L > 0 && rec.pct < 0.33);
}

// A CPU team trading its team option for a new deal: same market terms an
// extension would get, only for players who'd get a raise on it.
function cpuOptionDeal(L, p, team, optSal) {
  const lv = shownLevel(p);
  if (lv < 72 || p.age > 30) return null;
  const a = extAsk(p, team);
  const rookie = FA.isRookieScale(p);
  let odds = a.mood === 'market' ? 0.1 : a.mood === 'eager' ? 0.55 : 0.35;
  if (rookie) odds *= 1.5;
  if (FA.capSystemOn() && FA.taxStance(L, team) !== 'pay' && FA.teamCommitted(team) > FA.capLines(L).tax * 0.95 && lv < 84) odds *= 0.3;
  if (teamStatus(L, team) === 'contending' && lv >= 80) odds += 0.15;
  const rng = mulberry32((saveSalt() ^ Math.imul(p.id + 3, 7919) ^ 0x0b7) >>> 0);
  if (rng() >= Math.min(0.85, odds)) return null;
  const sal = Math.min(FA.maxSalary(L, p, true), Math.round(a.sal / 1.1));
  if (sal < optSal) return null;
  const yrs = a.yrs[0] + Math.floor(rng() * (a.yrs[1] - a.yrs[0] + 1));
  const rising = p.age <= 25 && a.proj > lv;
  const opt = yrs >= 5 ? (rng() < 0.6 ? FA.OPT_PLAYER : FA.OPT_TEAM) : yrs > 1 && rng() < (p.age >= 30 ? 0.55 : rising ? 0.6 : 0.2) ? FA.OPT_PLAYER : 0;
  return { sal, yrs, opt };
}
// What happens with each option. Teams pick up almost every option, unless
// the player clearly isn't worth it. Players opt in unless their option is
// well under market (they'll test free agency) or their morale is low.
function optionCall(L, p, team) {
  const sal = p.contract.sal || 0, worth = marketValue(p);
  if (p.contract.opt === 1) {
    if (isUserTeam(team)) return { kind: 'team', choice: optStore().team[p.id] || null, worth, sal };
    let keep = worth >= sal * 0.75;
    // Over the tax and not contending: only clear bargains get picked up.
    const ducking = keep && FA.capSystemOn() && FA.taxStance(L, team) !== 'pay' && FA.teamCommitted(team) > FA.capLines(L).tax && worth < sal * 1.2;
    if (ducking) keep = false;
    // Complete rules: instead of the option, the team may negotiate a longer
    // deal before the market opens (most often a rookie-scale player on the rise).
    const deal = keep && isComplete() ? cpuOptionDeal(L, p, team, sal) : null;
    if (deal) return { kind: 'team', choice: 'deal', deal, worth, sal, why: `New deal: $${deal.sal}M × ${deal.yrs}${deal.opt === FA.OPT_PLAYER ? ' · PO' : deal.opt === FA.OPT_TEAM ? ' · TO' : ''}` };
    return { kind: 'team', choice: keep ? 'ex' : 'dec', worth, sal, why: keep ? 'Picked up' : ducking ? 'Declined: ducking the tax' : `Declined: not worth $${sal}M` };
  }
  const under = worth >= sal * (1.4 - (tr(p, 'money') - 10) * 0.025 + Math.max(0, tr(p, 'loyalty') - 12) * 0.03) && worth - sal >= 5 && p.age < 33;
  const low = moraleLow(p, team) && tr(p, 'loyalty') < 16;
  const out = under || (low && worth >= sal * 0.9);
  const reason = under ? 'money' : out ? 'unhappy' : null;
  const pitch = isUserTeam(team) ? optStore().pitch?.[p.id] : null;
  if (out && pitch?.ok) return { kind: 'player', choice: 'in', worth, sal, reason, pitch, why: `Opting in: ${PITCHES[pitch.kind].kept}` };
  return { kind: 'player', choice: out ? 'out' : 'in', worth, sal, reason, pitch,
    why: under ? `Opting out: he can get about $${worth}M on the market` : out ? 'Opting out: unhappy where he is' : 'Opting in' };
}

// Pitches to keep your own player from opting out. Each one is a promise,
// remembered next season. Odds depend on why he wants out; one try each.
const PITCHES = {
  role: { label: 'Bigger role', promise: 'a bigger role', kept: 'promised a bigger role', prio: 'role' },
  ext: { label: 'Long-term deal', promise: 'a long-term deal next summer', kept: 'promised a long-term deal', prio: 'security' },
  pay: { label: 'Overpay', promise: 'a big contract next summer', kept: 'promised a big contract', prio: 'greed' },
  win: { label: 'Big additions', promise: 'help around him', kept: 'promised help around him', prio: 'contender' },
};
// Odds come from what he cares about: the pitch that matches his top
// priority is the best bet; a poor fit rarely works.
function pitchOdds(p, team, kind, reason) {
  const pr = PITCHES[kind].prio;
  const motive = FA.motiveOf(league(), p);
  let o = 0.2 + (motive === pr || (pr === 'greed' && motive === 'control') ? 0.35 : 0);
  if (pr === 'greed') o += (tr(p, 'money') - 10) * 0.015;
  if (pr === 'contender') o += (tr(p, 'winning') - 10) * 0.015 + (teamRecord(team).pct >= 0.6 ? 0.08 : 0);
  if (pr === 'security') o += (p.age >= 29 ? 0.08 : 0) + (tr(p, 'loyalty') - 10) * 0.01;
  if (pr === 'role') o += p.age <= 25 ? 0.08 : 0;
  if (reason === 'unhappy' && pr !== 'greed') o += 0.08;
  if (reason === 'money' && pr === 'greed') o += 0.1;
  if (isUserTeam(team)) o += fxNow().promiseBonus;
  return Math.max(0.05, Math.min(0.85, o));
}
function qoCall(L, p, team) {
  if (isUserTeam(team)) return optStore().qo[p.id];
  return marketValue(p) >= qoAmount(p);
}

screens.options = () => {
  const L = league();
  const st = optStore();
  const list = optionPlayers(L).map(x => ({ ...x, c: optionCall(L, x.p, x.team) }));
  const qoList = L.teams.flatMap(t => t.roster.filter(p => FA.qoEligible(L, p)).map(p => ({ p, team: t })));
  const mine = x => isUserTeam(x.team);
  const tag = c => c.worth - c.sal >= tagGap(c.worth) ? '<span class="badge new">Bargain</span>' : c.sal - c.worth >= tagGap(c.worth) ? '<span class="badge down-b">Overpaid</span>' : '<span class="badge">Fair</span>';
  const head = x => `<span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)}<br><span class="small muted">${esc(x.team.shortName)} · ${esc(posName(x.p))} · ${x.p.age}y · $${x.c.sal}M option${(state.reopened?.est || new Set()).has(x.p.id) ? ' (est.)' : ''}</span><br><span class="small muted">Market value $${x.c.worth}M</span> ${tag(x.c)}</span>`;
  const done = !!st.done;
  const myTeamOpts = list.filter(x => mine(x) && x.c.kind === 'team');
  const myPlayerOpts = list.filter(x => mine(x) && x.c.kind === 'player');
  const myQO = qoList.filter(mine);
  const btn = (act, pid, v, on, label) => `<button class="btn small ${on ? 'on focus' : 'off'}" data-act="${act}" data-id="${pid}" data-v="${v}" ${done ? 'disabled' : ''}>${label}</button>`;
  const around = list.filter(x => !mine(x) && x.c.choice !== 'ex' && x.c.choice !== 'in').sort((a, b) => shownLevel(b.p) - shownLevel(a.p));
  const pending = myTeamOpts.some(x => !x.c.choice) || myQO.some(x => st.qo[x.p.id] == null);
  layout({
    title: 'Options Deadline',
    body: `${state.reopened?.n ? `<p class="note small muted">The game had already decided ${state.reopened.n} option${state.reopened.n === 1 ? '' : 's'}; they're open again here.${state.reopened.est.size ? ' Salaries marked est. are estimates (the game clears a declined deal).' : ''}</p>` : ''}<p class="note small">Options and qualifying offers are due. Accept a team option to keep his last year at the same salary, decline it to let him go, or negotiate: decline it for a longer deal now, before anyone else can bid.</p>
      <fieldset class="frame"><legend>Your Team Options</legend><div class="stack">${myTeamOpts.map(x => { const deal = st.deals?.[x.p.id], neg = st.neg?.[x.p.id]; return `<div class="drill-row wrap">${head(x)}
        <span class="opt-btns full">${btn('optTeam', x.p.id, 'ex', x.c.choice === 'ex', 'Accept')}${btn('optTeam', x.p.id, 'dec', x.c.choice === 'dec', 'Decline')}${btn('optNeg', x.p.id, 'deal', x.c.choice === 'deal', deal ? '✍️ New Deal' : 'Negotiate')}</span>
        ${deal ? `<p class="note small up full">Option declined for a new deal: $${deal.sal}M × ${deal.yrs}${deal.opt === FA.OPT_PLAYER ? ' · PO' : deal.opt === FA.OPT_TEAM ? ' · TO' : ''} <span class="tot">$${deal.sal * deal.yrs}M</span></p>` : neg?.last && !neg.last.ok ? `<p class="note small down full">${esc(neg.last.text)}${neg.tries >= 3 ? ' Talks are over.' : ''}</p>` : ''}</div>`; }).join('') || '<p class="note muted small">No team options this year.</p>'}</div></fieldset>
      <fieldset class="frame"><legend>Your Player Options</legend><div class="stack">${myPlayerOpts.map(x => `<div class="drill-row wrap">${head(x)}
        <b class="small ${x.c.choice === 'out' ? 'down' : 'up'}">${esc(x.c.why)}</b>
        ${x.c.reason && !done ? (x.c.pitch ? (x.c.pitch.ok ? '' : `<p class="note small down full">He heard you out on ${esc(PITCHES[x.c.pitch.kind].promise)}. He's testing the market.</p>`)
          : `<div class="full"><p class="note small muted">Make him a promise to stay (one try):</p><span class="opt-btns">${Object.entries(PITCHES).map(([k, v]) => `<button class="btn small" data-act="optPitch" data-id="${x.p.id}" data-v="${k}">${esc(v.label)} · ${Math.round(pitchOdds(x.p, x.team, k, x.c.reason) * 100)}%</button>`).join('')}</span></div>`) : ''}</div>`).join('') || '<p class="note muted small">No player options this year.</p>'}</div>
        ${myPlayerOpts.length ? '<p class="note muted small" style="margin-top:6px">The player decides. Most opt in; they test free agency when their option is well under market or they\'re unhappy. Promises are remembered next season.</p>' : ''}</fieldset>
      <fieldset class="frame"><legend>Qualifying Offers</legend><div class="stack">${myQO.map(x => `<div class="drill-row"><span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)}<br><span class="small muted">${esc(posName(x.p))} · ${x.p.age}y · QO $${qoAmount(x.p)}M · worth ~$${marketValue(x.p)}M</span></span>
        <span class="opt-btns">${btn('optQO', x.p.id, '1', st.qo[x.p.id] === true, 'Extend')}${btn('optQO', x.p.id, '0', st.qo[x.p.id] === false, 'Skip')}</span></div>`).join('') || '<p class="note muted small">No restricted free agents this year.</p>'}</div>
        ${myQO.length ? '<p class="note muted small" style="margin-top:6px">Extend: he\'s restricted. Other teams\' offer sheets run at least 2 years and you can match any of them; if nobody signs him, he takes the one-year QO and is unrestricted next summer. Skip: he\'s unrestricted.</p>' : ''}</fieldset>
      <fieldset class="frame"><legend>Around the League</legend><p class="note muted small">Declined options, opt-outs and new deals. Tap a player to scout him.</p><div class="stack">${around.slice(0, 20).map(x => `<div class="drill-row tap" data-act="openPlayer" data-id="${x.p.id}"><span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)}<br><span class="small muted">${esc(x.team.shortName)} · ${x.p.age}y · $${x.c.sal}M ${x.c.kind} option</span></span><span class="small ${x.c.choice === 'out' ? 'gold' : x.c.choice === 'deal' ? 'up' : 'down'}" style="max-width:48%;text-align:right">${esc(x.c.why)}</span></div>`).join('') || '<p class="note muted small">Every option around the league was picked up.</p>'}</div></fieldset>
      ${done ? '<p class="note up">✓ Decisions are in. Free agents are set for July.</p>' : ''}`,
    action: done ? null : { act: 'optFinish', label: pending ? 'Decide every option and QO first' : 'Finalize Decisions' },
  });
};
actions.optTeam = d => { const st = optStore(); st.team[+d.id] = d.v; if (st.deals) delete st.deals[+d.id]; saveOptStore(); render(); };
// Negotiate: decline the option and work out a longer deal now, before
// anyone else can bid. Same give-and-take as an extension (three offers);
// a deal replaces the option at the deadline.
actions.optNeg = d => {
  const L = league(), st = optStore();
  const t = L.teams.find(x => x.roster.some(p => p.id === +d.id));
  const p = t?.roster.find(x => x.id === +d.id);
  if (!p || st.done) return;
  if (st.deals?.[p.id]) { st.team[p.id] = 'deal'; saveOptStore(); render(); return; }
  const a = extAsk(p, t);
  const neg = ((st.neg ||= {})[p.id] ||= { sal: a.sal, yrs: a.pref, opt: a.pref >= 5 ? FA.OPT_PLAYER : 0, tries: 0, last: null });
  if (neg.tries >= 3) { toast('Talks are over: accept or decline the option'); return; }
  const box = overlay('');
  const paint = () => {
    box.querySelector('.box').innerHTML = `
      <p class="note"><b>${esc(playerName(p))}</b> ${lvTag(p)}<br><span class="small muted">${esc(posName(p))} · ${p.age}y · option $${p.contract.sal}M · asks $${a.sal}M × ${a.pref}</span></p>
      ${maxLine(L, p)}
      <div class="pts-row"><span class="grow">Salary</span><button class="btn square" data-k="sal" data-d="-1">−</button><span class="pts-val">$${neg.sal}M</span><button class="btn square" data-k="sal" data-d="1">+</button></div>
      <div class="pts-row"><span class="grow">Years</span><button class="btn square" data-k="yrs" data-d="-1">−</button><span class="pts-val">${neg.yrs}</span><button class="btn square" data-k="yrs" data-d="1">+</button></div>
      <div class="tabs">${[[0, 'No Option'], [FA.OPT_PLAYER, 'Player'], [FA.OPT_TEAM, 'Team']].map(([v, l]) => `<button class="btn ${neg.opt === v ? 'on focus' : 'off'}" data-k="opt" data-v="${v}">${l}</button>`).join('')}</div>
      <p class="note small">Total <span class="tot">$${neg.sal * neg.yrs}M</span> · ${3 - neg.tries} offer${3 - neg.tries === 1 ? '' : 's'} left${neg.last ? `<br><span class="down">${esc(neg.last.text)}</span>` : ''}</p>
      <div class="grid2"><button class="btn off" data-k="close">Cancel</button><button class="btn focus" data-k="submit">Make Offer</button></div>`;
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'sal') neg.sal = Math.max(FA.FA_DEFAULTS.minSalary, Math.min(FA.maxSalary(L, p, true), neg.sal + +b.dataset.d));
    else if (k === 'yrs') neg.yrs = Math.max(1, Math.min(FA.FA_DEFAULTS.birdMaxYears, neg.yrs + +b.dataset.d));
    else if (k === 'opt') neg.opt = +b.dataset.v;
    else if (k === 'close') { saveOptStore(); box.remove(); render(); return; }
    else if (k === 'submit') {
      if (neg.yrs >= 5 && !neg.opt) { toast('A 5-year deal needs an option (4 + 1)', '', 2400, true); return; }
      if (FA.capSystemOn() && FA.teamCommitted(t) - (p.status === FA.STATUS_SIGNED ? p.contract.sal || 0 : 0) + neg.sal > FA.capLines(L).apron2) { toast('That would put you over the 2nd apron', `$${FA.capLines(L).apron2}M`, 2400, true); return; }
      const r = extAnswer(p, t, neg);
      neg.tries++;
      neg.last = r;
      if (r.ok) {
        (st.deals ||= {})[p.id] = { sal: neg.sal, yrs: neg.yrs, opt: neg.opt };
        st.team[p.id] = 'deal';
        toast(`✍️ ${playerName(p)} agrees`, `$${neg.sal}M × ${neg.yrs}: the option is declined for the new deal`);
      }
      saveOptStore();
      if (r.ok || neg.tries >= 3) { box.remove(); render(); return; }
    }
    paint();
  });
  paint();
};
actions.optPitch = d => {
  const L = league(), st = optStore(), pid = +d.id;
  if (st.done || st.pitch?.[pid]) return;
  const x = optionPlayers(L).find(y => y.p.id === pid);
  if (!x) return;
  const c = optionCall(L, x.p, x.team);
  if (!c.reason) return;
  const odds = pitchOdds(x.p, x.team, d.v, c.reason);
  const ok = mulberry32((saveSalt() ^ pid * 7919 ^ d.v.length * 104729) >>> 0)() < odds;
  (st.pitch ||= {})[pid] = { kind: d.v, ok };
  saveOptStore();
  if (ok) {
    const all = loadPromises().filter(pr => !(pr.pid === pid && pr.yr === L.season.currentYear && pr.src === 'option'));
    savePromises([...all, { yr: L.season.currentYear, tid: x.team.id, pid, v: 'commit', kind: d.v, src: 'option' }]);
  }
  render();
  toast(ok ? `${playerName(x.p)} is opting in` : `${playerName(x.p)} isn't convinced`, ok ? `You promised ${PITCHES[d.v].promise}.` : 'He\'s testing free agency.');
};
actions.optQO = d => { optStore().qo[+d.id] = d.v === '1'; saveOptStore(); render(); };
actions.optFinish = async () => {
  const L = league();
  const st = optStore();
  const list = optionPlayers(L).map(x => ({ ...x, c: optionCall(L, x.p, x.team) }));
  const qoList = L.teams.flatMap(t => t.roster.filter(p => FA.qoEligible(L, p)).map(p => ({ p, team: t })));
  if (list.some(x => isUserTeam(x.team) && x.c.kind === 'team' && !x.c.choice) || qoList.some(x => isUserTeam(x.team) && st.qo[x.p.id] == null)) {
    toast('Decide every team option and qualifying offer first'); return;
  }
  if (!(await confirmBox('Finalize every option and qualifying offer? Picked-up options are written to the save.', 'Finalize'))) return;
  checkpoint('Options deadline');
  const yr = L.season.currentYear;
  let exercised = 0, out = 0;
  for (const { p, c } of list) {
    const row = (p.stats || []).filter(s => s.yr === yr && s.league === 0).pop();
    const deal = c.choice === 'deal' && (c.deal || st.deals?.[p.id]);
    if (deal) {
      // Option declined for a new deal that starts this season.
      Object.assign(p.contract, { yrs: deal.yrs, sal: deal.sal, opt: deal.opt || 0, canExt: false });
      p.status = FA.STATUS_SIGNED;
      if (row) row.sal = deal.sal;
      exercised++;
    } else if (c.choice === 'ex' || c.choice === 'in') {
      // The option year is now guaranteed (a 0-year deal gets that year).
      Object.assign(p.contract, { yrs: Math.max(1, p.contract.yrs || 0), opt: 0 });
      p.status = FA.STATUS_SIGNED;
      if (row) row.sal = p.contract.sal;
      exercised++;
    } else {
      // Declined or opted out: a free agent now, unrestricted.
      Object.assign(p.contract, { yrs: 0, opt: 0, sal: 0, canExt: false });
      p.status = FA.STATUS_EXPIRING;
      if (row) row.sal = 0;
      st.qo[p.id] = false;
      out++;
    }
  }
  for (const { p, team } of qoList) if (!isUserTeam(team) && st.qo[p.id] == null) st.qo[p.id] = qoCall(L, p, team);
  FA.setQualifyingOffers(st.qo);
  // The held CPU offers go back in, except for players whose option was just
  // decided (picked up, or headed to the open market).
  const decided = new Set(list.map(x => x.p.id));
  const back = (st.held || []).filter(o => !decided.has(o.pid));
  if (back.length) L.contractOffers = [...(L.contractOffers || []), ...back];
  st.held = [];
  st.done = true;
  st.log = { exercised, out };
  saveOptStore();
  state.dirty = true;
  goHome();
  toast('Options deadline done', `${exercised} picked up · ${out} heading to free agency`);
};

// Press conference answers (per season) and promises (kept across seasons).
function presserStore() {
  try { return JSON.parse(localStorage.getItem(`hlc:presser:${seasonKey()}`)) || {}; } catch { return {}; }
}
function savePresser(v) { try { localStorage.setItem(`hlc:presser:${seasonKey()}`, JSON.stringify(v)); } catch { /* ignore */ } }
// ---- Morale
// Faces for 0-19, 20-39, 40-59, 60-79, 80-100.
const MORALE_FACES = ['😡', '😞', '😐', '🙂', '😄'];
const moraleFace = m => MORALE_FACES[Math.max(0, Math.min(4, Math.floor((m ?? 60) / 20)))];
const MORALE_WORDS = ['Furious', 'Upset', 'Indifferent', 'Content', 'Happy'];
const moraleWord = m => MORALE_WORDS[Math.max(0, Math.min(4, Math.floor((m ?? 60) / 20)))];
const moraleTag = p => `<span title="${moraleWord(p.season?.morale)}">${moraleFace(p.season?.morale)}</span> ${p.season?.morale ?? '?'}`;
// A change of situation (a trade, a new deal, a bigger role) lifts a player's
// mood, a lot more when he was unhappy; a smaller role costs some. Each kind
// counts once per player a session. Everyone in the league, not just yours.
function moraleEvent(p, kind, n, why) {
  if (!isComplete() || isCollege() || !p.season) return 0;
  const k = `${p.id}:${kind}`;
  if ((state.moraleDone ||= new Set()).has(k)) return 0;
  state.moraleDone.add(k);
  const m = p.season.morale ?? 60;
  const lift = n > 0 && m < 40 ? Math.round(n * 1.6) : n;
  p.season.morale = Math.max(0, Math.min(100, m + lift));
  (calFlags().moraleLog ||= []).push({ pid: p.id, tid: p.tid, from: m, to: p.season.morale, why });
  state.dirty = true;
  return lift;
}
const roleRank = (team, p) => 1 + FA.signedRoster(team).filter(x => x !== p && shownLevel(x) > shownLevel(p)).length;
// Fans follow stars: a team that lands one gains, the team that lets one go
// loses some. Crowds in the game track the fan number (0-100).
function fanEvent(team, delta) {
  const fo = team?.frontOffice;
  if (!fo || !isComplete() || isCollege() || !delta) return;
  const was = fo.fans ?? 50;
  fo.fans = Math.max(0, Math.min(100, Math.round(was + delta)));
  if (fo.fans !== was && isUserTeam(team)) toast(`📣 ${team.shortName} fans ${fo.fans > was ? '+' : ''}${fo.fans - was}`, 'The crowd noticed.', 2600);
}
const fanGain = p => { const lv = shownLevel(p); const g = lv >= 92 ? 6 : lv >= 88 ? 4 : lv >= 84 ? 3 : lv >= 80 ? 2 : lv >= 76 ? 1 : 0; return g && p.age <= 24 && p.pot >= 9 ? g + 1 : g; };
function tradeMorale(L, p, to, from) {
  fanEvent(to, fanGain(p));
  if (from) fanEvent(from, -Math.round(fanGain(p) * 0.6));
  let n = 7;
  const l = seasonLine(p, state.leagueIdx, lastSeasonYear());
  if (roleRank(to, p) <= 5 && (!l || l.mpg < 24)) n += 5;
  if (teamStatus(L, to) === 'contending') n += 3;
  moraleEvent(p, `trade:${to.id}`, n, `fresh start in ${to.shortName}`);
}
function contractMorale(p, team, old) {
  const moved = old && old.id !== team.id;
  if (moved) { fanEvent(team, fanGain(p)); fanEvent(old, -Math.round(fanGain(p) * 0.6)); }
  else if (!old) fanEvent(team, Math.ceil(fanGain(p) / 2));
  moraleEvent(p, `deal:${team.id}`, 8 + (moved ? 4 : 0), moved ? `signed with ${team.shortName}` : 'new contract');
}
// Final cuts: a player who's now a projected starter after sitting last year
// feels it; a former starter pushed down the roster does too.
function roleMorale(L) {
  const ly = lastSeasonYear();
  for (const t of L.teams) for (const p of FA.signedRoster(t)) {
    const l = seasonLine(p, state.leagueIdx, ly), rank = roleRank(t, p);
    if (rank <= 5 && l && l.gs < 20 && l.mpg < 24) moraleEvent(p, 'role', 6, 'projected starter');
    else if (rank > 8 && l && l.gs >= 41) moraleEvent(p, 'role', -6, 'pushed out of the rotation');
  }
}

// Broken promises: a player you promised something and didn't deliver loses
// a lot of morale and refuses to meet with your team (no extension, no
// offers) through the next offseason. { pid, tid, until } per save.
const grudgeKey = () => `hlc:grudge:${league().shortName}:${league().meta?.saveName || ''}`;
function loadGrudges() { try { return JSON.parse(localStorage.getItem(grudgeKey())) || []; } catch { return []; } }
function syncGrudges() {
  if (!state.data) return;
  const yr = league().season.currentYear;
  FA.setGrudges(isComplete() ? loadGrudges().filter(g => yr <= g.until) : []);
}
function breakPromise(L, p, team, pr, why, later = false) {
  const yr = L.season.currentYear;
  if (p.season) p.season.morale = Math.max(0, (p.season.morale ?? 60) - 30);
  const list = loadGrudges().filter(g => !(g.pid === p.id && g.tid === team.id));
  list.push({ pid: p.id, tid: team.id, until: yr + 1 });
  try { localStorage.setItem(grudgeKey(), JSON.stringify(list)); } catch { /* ignore */ }
  syncGrudges();
  state.dirty = true;
  const say = () => toast(`${playerName(p)} is furious`, `${why} He took a big morale hit and won't meet with ${team.shortName}.`, 5200, true);
  if (later) setTimeout(say, 3200); else say();
}
const PROMISE_TEXT = { role: 'a bigger role', ext: 'a long-term deal', pay: 'a big contract', win: 'help around him' };
// Role and "help" promises are judged on last season; extension promises
// when the extension window closes.
function settlePromises() {
  const L = league();
  if (!L || isCollege() || !isComplete() || phaseRank(L.season) < 1 || phaseRank(L.season) > 3) return;
  const yr = L.season.currentYear;
  const ly = lastSeasonYear();
  for (const pr of loadPromises().filter(x => x.yr === yr - 1 && x.v === 'commit' && x.src === 'option' && (x.kind === 'role' || x.kind === 'win'))) {
    const team = L.teams.find(t => t.id === pr.tid), p = team?.roster.find(x => x.id === pr.pid);
    if (!team || !p || !isUserTeam(team) || state.fromExport) continue;
    const l = seasonLine(p, state.leagueIdx, ly);
    const kept = pr.kind === 'role' ? !!l && (l.mpg >= 26 || l.gs >= 41)
      : teamRecord(team).pct >= 0.5 && team.roster.some(x => x !== p && shownLevel(x) >= shownLevel(p) - 3);
    if (!kept) breakPromise(L, p, team, pr, `You promised ${PROMISE_TEXT[pr.kind]} and didn't deliver.`, true);
  }
}
const promisesKey = () => `hlc:promises:${league().shortName}:${league().meta?.saveName || ''}`;
function loadPromises() { try { return JSON.parse(localStorage.getItem(promisesKey())) || []; } catch { return []; } }
function savePromises(v) { try { localStorage.setItem(promisesKey(), JSON.stringify(v)); } catch { /* ignore */ } }

// What your answers do (applied when Media Day wraps up): morale and
// loyalty for the players involved, and the starting job for the position
// battle. Returns [{ text, apply }].
function presserEffects(L, t, ans) {
  const out = [];
  // Each effect carries the question it came from and whether it's good news.
  let key = 'promise';
  const push = out.push.bind(out);
  out.push = (...xs) => push(...xs.map(x => ({ key, good: true, ...x })));
  const find = id => t.roster.find(p => p.id === +id);
  const mood = (p, n) => ({ good: n > 0, text: `${p.fn} morale ${n > 0 ? '+' : ''}${n}`, apply: () => { if (p.season) p.season.morale = Math.max(0, Math.min(100, (p.season.morale ?? 60) + n)); } });
  const loyal = (p, n) => ({ good: n > 0, text: `${p.fn} loyalty ${n > 0 ? '+' : ''}${n}`, apply: () => { if (p.traits) p.traits.loyalty = Math.max(1, Math.min(20, (p.traits.loyalty || 10) + n)); } });
  // Last year's promises: kept, he's happier; broken, the room noticed.
  for (const pr of loadPromises().filter(x => x.yr === L.season.currentYear - 1 && x.tid === t.id && x.v === 'commit')) {
    const P = find(pr.pid);
    if (P) out.push({ ...mood(P, 5), text: `Promise kept: ${P.fn} morale +5` });
    else out.push({ good: false, text: 'Promise broken: everyone\'s morale −3', apply: () => t.roster.forEach(p => { if (p.season) p.season.morale = Math.max(0, (p.season.morale ?? 60) - 3); }) });
  }
  for (const q of presserQs(L, t)) {
    const a = ans?.[q.key];
    if (!a) continue;
    key = q.key;
    const P = find(q.pid);
    if (q.key === 'contract' && P) {
      if (a === 'commit') out.push(mood(P, 8), loyal(P, 1));
      if (a === 'focus' && q.ctx.kind === 'final') out.push(mood(P, -2));
      if (a === 'market') out.push(mood(P, -10), loyal(P, -2));
    }
    if (q.key === 'goal') {
      if (a === 'title' && P) out.push(mood(P, 3));
      if (a === 'develop') out.push({ text: 'Young players\' morale +2', apply: () => t.roster.filter(p => p.age <= 24).forEach(p => { if (p.season) p.season.morale = Math.min(100, (p.season.morale ?? 60) + 2); }) });
    }
    if (q.key === 'expect' && P) {
      const arr = q.ctx.kind === 'arrival';
      if (a === 'star') { out.push(mood(P, 5)); const old = presserStar(L, t); if (arr && old && old !== P) out.push(mood(old, -2)); }
      if (a === 'fit') out.push(mood(P, 2));
      if (a === 'time') out.push(mood(P, arr ? -3 : 3));
    }
    if (q.key === 'battle') {
      const A = find(q.pid), B = find(q.pid2);
      if (!A || !B) continue;
      if (a === 'open') { out.push(mood(A, 2), mood(B, 2)); continue; }
      const [w, l] = a === 'b' ? [B, A] : [A, B];
      out.push(mood(w, 6), mood(l, -6));
      if ((w.linePos ?? 99) >= 5 && (l.linePos ?? 99) < 5) out.push({ text: `${w.fn} moves into the starting five`, apply: () => {
        const sl = t.startingLineup || [];
        const ew = sl.find(x => x.pid === w.id), el = sl.find(x => x.pid === l.id);
        if (ew && el) { ew.pid = l.id; el.pid = w.id; }
        [w.linePos, l.linePos] = [l.linePos, w.linePos];
      } });
    }
    if (q.key === 'moves') {
      const star = presserStar(L, t);
      if (a === 'believe') out.push({ text: 'Everyone\'s morale +3', apply: () => t.roster.forEach(p => { if (p.season) p.season.morale = Math.min(100, (p.season.morale ?? 60) + 3); }) });
      if (a === 'notdone' && star) out.push(mood(star, 4));
      if (a === 'longterm') {
        // The long game is good news for the young (a young star most of all)
        // and a letdown for veterans, a veteran star hardest.
        const youngStar = star && star.age <= 24;
        out.push({ text: youngStar ? `Young players\' morale +4 (${star.fn} +6)` : 'Young players\' morale +4', apply: () => t.roster.filter(p => p.age <= 24).forEach(p => { if (p.season) p.season.morale = Math.min(100, (p.season.morale ?? 60) + (youngStar && p === star ? 6 : 4)); }) });
        const vets = t.roster.filter(p => p.age >= 29 && p !== star);
        if (vets.length) out.push({ good: false, text: 'Veterans\' morale −2', apply: () => vets.forEach(p => { if (p.season) p.season.morale = Math.max(0, (p.season.morale ?? 60) - 2); }) });
        if (star && !youngStar && q.ctx.mood !== 'quiet') out.push(mood(star, -6));
      }
    }
  }
  return out;
}
const presserStar = (L, t) => { const q = presserQs(L, t).find(x => x.key === 'moves'); return q?.pid ? t.roster.find(p => p.id === q.pid) : null; };
function applyPresser() {
  const L = league(), pr = presserStore();
  if (pr.applied) return;
  pr.frozen = {}; pr.fx = {};
  for (const t of L.teams.filter(isUserTeam)) {
    pr.frozen[t.id] = presserQuestions(L, t, state.leagueIdx);
    const fx = presserEffects(L, t, pr[t.id]);
    pr.fx[t.id] = fx.map(({ key, good, text }) => ({ key, good, text }));
    for (const e of fx) e.apply();
  }
  pr.applied = true;
  savePresser(pr);
  state.dirty = true;
}

// The questions as asked: frozen when you finish, since answers can change
// the lineup the questions are built from.
const presserQs = (L, t) => presserStore().frozen?.[t.id] || presserQuestions(L, t, state.leagueIdx);
const fxLine = list => list.length ? `<p class="note small pq-fx">${list.map(e => `<span class="${e.good ? 'up' : 'down'}">${esc(e.text)}</span>`).join(' · ')}</p>` : '';
function presserCard() {
  const L = league();
  const mine = L.teams.filter(isUserTeam);
  if (!mine.length) return '';
  const pr = presserStore();
  return mine.map(t => {
    const qs = presserQs(L, t);
    const ans = pr[t.id] || {};
    const tint = teamTint(t);
    const fx = pr.applied ? (pr.fx?.[t.id] || []) : presserEffects(L, t, ans);
    const done = qs.every(q => ans[q.key]);
    const body = pr.applied
      // On the record: your answers as quotes, with what they did.
      ? qs.filter(q => ans[q.key]).map(q => `<div class="pq">
          <p class="note small muted">${esc(q.q)}</p>
          <p class="note pq-quote">"${esc(q.options.find(o => o.v === ans[q.key])?.label || '')}"</p>
          ${fxLine(fx.filter(e => e.key === q.key))}</div>`).join('')
      : qs.map(q => `<div class="pq">
          <p class="note small"><b>${esc(q.q)}</b></p>
          <div class="pq-opts">${q.options.map(o => `<button class="btn small ${ans[q.key] === o.v ? 'on focus' : 'off'}" data-act="presserAnswer" data-tid="${t.id}" data-k="${q.key}" data-v="${o.v}" data-pid="${q.pid ?? ''}">${esc(o.label)}</button>`).join('')}</div>
          ${fxLine(fx.filter(e => e.key === q.key))}</div>`).join('');
    return `<fieldset class="frame presser"><legend>🎙️ Press Conference</legend>
      <div class="outlook" ${tint ? `style="${tint}"` : ''}><div class="outlook-top ${tint ? 'tc' : ''}">${logoImg(t)}<b>${esc(t.city)} ${esc(t.name)}</b></div>
      ${fxLine(fx.filter(e => e.key === 'promise'))}
      <div class="stack">${body}</div></div>
      ${pr.applied ? '' : `<button class="btn focus" data-act="presserFinish" style="margin-top:8px" ${done ? '' : 'disabled'}>🎙️ Finish Press Conference</button>`}
    </fieldset>`;
  }).join('');
}
actions.presserFinish = () => { applyPresser(); render(); toast('🎙️ On the record'); };
actions.presserAnswer = d => {
  const pr = presserStore();
  if (pr.applied) return;
  (pr[d.tid] ||= {})[d.k] = d.v;
  savePresser(pr);
  if (d.k === 'contract' && d.pid) {
    const yr = league().season.currentYear;
    const list = loadPromises().filter(x => !(x.yr === yr && x.tid === +d.tid));
    list.push({ yr, tid: +d.tid, pid: +d.pid, v: d.v });
    savePromises(list);
  }
  render();
};

function leagueGramCard() {
  const posts = leagueGram(league(), isUserTeam, state.leagueIdx);
  if (!posts.length) return '';
  return `<h2 class="team-title">Trending on Hoop Gram</h2>
    <div class="stack">${posts.map(x => `<${x.pid ? `button data-act="openPlayer" data-id="${x.pid}"` : 'div'} class="hg-post ${x.pid ? 'tap' : ''}">
      <div class="hg-head"><span class="hg-avatar">HG</span><b>${esc(x.handle)}</b></div>
      <p class="hg-text">${esc(x.text)}</p>
      <div class="hg-foot"><span>❤️ ${x.likes.toLocaleString()}</span><span class="muted">${esc(x.team.shortName)}</span></div>
    </${x.pid ? 'button' : 'div'}>`).join('')}</div>`;
}

screens.storylines = () => {
  const { stories, players, podium } = currentStorylines();
  const L = league();
  layout({
    title: 'Media Day',
    body: `
      ${jerseyCard()}
      ${presserCard()}
      ${podium.length ? `<h2 class="team-title">From the Podium</h2><ol class="stories">${podium.map(s => `
        <li class="story${players.has(s.pid) ? ' tap' : ''}"${players.has(s.pid) ? ` data-act="openPlayer" data-id="${s.pid}"` : ''}>
          <span class="story-n">${s.icon}</span>
          <div><b>${esc(s.title)}</b><p class="note small">${esc(s.text)}</p></div>
        </li>`).join('')}</ol>` : ''}
      <h2 class="team-title">Season Preview</h2>
      ${stories.length ? `<ol class="stories">${stories.map((s, i) => `
        <li class="story${players.has(s.pid) ? ' tap' : ''}"${players.has(s.pid) ? ` data-act="openPlayer" data-id="${s.pid}"` : ''}>
          <span class="story-n">${i + 1}</span>
          <div><b>${s.icon} ${esc(s.title)}</b><p class="note small">${esc(s.text)}</p></div>
        </li>`).join('')}</ol>` : '<p class="note">Nothing to report yet.</p>'}
      ${leagueGramCard()}
      <div class="stack" style="margin-top:12px">
        ${isStep('media') ? '<button class="btn big focus" data-act="mediaDone">✅ Wrap Up Media Day</button>' : ''}
      </div>`,
  });
};

actions.mediaDone = () => { applyPresser(); calFlags().media = true; goHome(); toast('Next up: Opening Night'); };

actions.copyStories = async () => {
  const text = storylinesText(currentStorylines().stories, currentStorylines().podium);
  try {
    if (!inArtifact() && navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Storylines copied'); }
  } catch (err) {
    if (err.name !== 'AbortError') toast('Copy failed');
  }
};

// ---------------------------------------------------------------------------
// Export

// ---------------------------------------------------------------------------
// Offseason Overview (May 3): your team (standing, books, needs, style,
// draft position, focus) and the league rumor mill.

const worthOf = p => fairSalary(shownLevel(p));
const sevDot = n => `<span class="sev s${n}" aria-label="${['', 'Minor', 'Real', 'Big'][n]} need"></span>`;
const pctStr = v => v >= 9.95 ? `${Math.round(v)}%` : `${v.toFixed(1)}%`;
function pickLine(x) {
  const from = x.orig && !isUserTeam(x.orig) ? ` <span class="muted">(via ${esc(x.orig.shortName)})</span>` : '';
  if (x.lottery) return `<b>R1 · lottery seed ${x.seed}</b>${from}<br><span class="small">#1: <b>${pctStr(x.p1)}</b> · Top 4: <b>${pctStr(x.top4)}</b> · most likely <b>#${x.likely}</b> · no lower than #${x.worst}</span>`;
  return `<b>R${x.rd} · pick #${x.slot}</b>${from}`;
}
// Where to put your focus: a few plain calls from the needs, books, cap and rumors.
function focusCalls(L, t, st, books, needs, rumors) {
  const calls = [];
  const top = needs.filter(n => n.sev >= 2 && n.group !== 'style').slice(0, 2);
  const route = st.status === 'contending' ? 'Free agency or trade' : 'Draft';
  for (const n of top) calls.push(n.kind === 'Upside' ? `🎓 Draft: take swings at ${n.group} with upside.` : `${st.status === 'contending' ? '🤝' : '🎓'} ${route}: ${n.group} (${n.text.charAt(0).toLowerCase() + n.text.slice(1)}).`);
  const up = needs.find(n => n.kind === 'Upside' && !top.includes(n));
  if (up && st.status !== 'contending') calls.push(`🎓 Draft: no young ${up.group} with real upside. Take more than one swing.`);
  const sty = needs.find(n => n.group === 'style' && n.sev >= 2);
  if (sty) calls.push(`🧩 Style: ${sty.text.charAt(0).toLowerCase() + sty.text.slice(1)}. Prospects who fill it are marked 🧩.`);
  const keep = books.expiring.filter(x => x.level >= 76 && x.p.age < 33)[0];
  if (keep) calls.push(`✍️ Re-sign priority: ${playerName(keep.p)} (Lv ${keep.level}, worth ~$${keep.worth}M)${keep.rfa ? ', restricted if you extend the QO' : ''}.`);
  for (const o of books.options.filter(o => o.kind === 'team')) {
    if (o.worth >= o.sal * 1.3) calls.push(`✅ Team option: pick up ${playerName(o.p)} ($${o.sal}M, worth ~$${o.worth}M).`);
    else if (o.worth < o.sal * 0.75) calls.push(`❌ Team option: ${playerName(o.p)} costs $${o.sal}M for ~$${o.worth}M of play. Decline candidate.`);
  }
  const po = books.options.find(o => o.kind === 'player' && o.worth >= o.sal * 1.4);
  if (po) calls.push(`⚠️ ${playerName(po.p)} can beat his $${po.sal}M player option on the market. Expect an opt-out unless you make a promise.`);
  if (books.space >= 15) calls.push(`💰 About $${books.space}M of cap space projected for July.`);
  const ext = books.ext[0];
  if (ext && ext.level >= 78) calls.push(`🖊️ Extension: ${playerName(ext.p)} enters his final year. Lock him up in the extension window.`);
  const target = rumors.find(r => r.kind === 'star' && st.status === 'contending') || rumors.find(r => r.kind === 'vet' && st.status === 'contending');
  if (target) calls.push(`📰 Trade target: ${playerName(target.p)} (${target.team.shortName}), ${target.why[0]}.`);
  return calls.slice(0, 6);
}
function overviewTeam(L, t) {
  const st = teamStanding(L, t);
  const books = teamBooks(L, t, { level: shownLevel, worth: worthOf, qoEligible: FA.qoEligible });
  const needs = rosterNeeds(L, t, { level: shownLevel, li: state.leagueIdx });
  const [c1, c2] = (t.teamColors || []).map(c => /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : null);
  const row = (x, right, sub = '') => `<div class="drill-row tap" data-act="openPlayer" data-id="${x.p.id}"><span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)}<br><span class="small muted">${esc(posName(x.p))} · ${x.p.age}y${sub}</span></span>${right ? `<span class="small" style="text-align:right">${right}</span>` : ''}</div>`;
  const valTag = (sal, worth) => worth - sal >= tagGap(worth) ? '<span class="badge new">Bargain</span>' : sal - worth >= tagGap(worth) ? '<span class="badge down-b">Overpaid</span>' : '<span class="badge">Fair</span>';
  return `<div class="outlook" ${c1 ? `style="--tc1:${c1};--tc2:${c2 || c1}"` : ''}>
      <div class="outlook-top ${c1 ? 'tc' : ''}">${logoImg(t)}<b>${esc(t.city)} ${esc(t.name)}</b>${teamTag(st.tier)}</div>
      <p class="note small" style="padding:8px 10px 0">${st.W}-${st.L} · ${esc(st.finish)}${st.trend.length > 1 ? ` · <span class="muted">${st.trend.map(x => `${x.W}-${x.L}`).join(' → ')}</span>` : ''}</p>
    </div>
    <fieldset class="frame"><legend>The Books</legend>
      ${capBarOf(books.committed, deadFor(t.id))}${ownerLine(t)}
      <h4 class="ov-h">Expiring (${books.expiring.length})</h4><div class="stack">${books.expiring.map(x => row(x, x.rfa ? '<span class="badge new">RFA</span>' : '', ` · ${x.p.yrs ?? 0} yrs exp · market value $${x.worth}M`)).join('') || '<p class="note small muted">Nobody.</p>'}</div>
      <h4 class="ov-h">Options (${books.options.length})</h4><div class="stack">${books.options.map(x => row(x, valTag(x.sal, x.worth), `<br>${x.kind === 'team' ? 'Team' : 'Player'} option $${x.sal}M · market value $${x.worth}M`)).join('') || '<p class="note small muted">None.</p>'}</div>
      <h4 class="ov-h">Extension Eligible (${books.ext.length})</h4><div class="stack">${books.ext.map(x => row(x, '', `<br>Final year $${x.sal}M · market value $${x.worth}M`)).join('') || '<p class="note small muted">None.</p>'}</div>
    </fieldset>
    <fieldset class="frame"><legend>Roster Needs</legend><div class="stack">${needs.map(n => `<div class="need-row">${sevDot(n.sev)}<span class="badge need">${esc(n.group === 'style' ? 'Style' : `${n.group[0].toUpperCase()}${n.group.slice(1)} · ${n.kind}`)}</span><span class="small grow">${esc(n.text)}</span></div>`).join('') || '<p class="note small muted">No real holes.</p>'}</div>
</fieldset>
`;
}
const teamTag = k => `<span class="status s-${k}">${TIER_NAMES[k]}</span>`;
function overviewRumors(L) {
  const all = L.teams.map(t => ({ t, st: teamStanding(L, t) }));
  const col = k => all.filter(x => x.st.tier === k).sort((a, b) => b.st.pct - a.st.pct);
  const rumors = rumorMill(L, { level: shownLevel, li: state.leagueIdx, skip: isUserTeam });
  const heat = n => '🔥'.repeat(Math.max(1, n));
  const kind = { star: 'Disgruntled?', vet: 'Could be moved' };
  return `<fieldset class="frame"><legend>Team Directions</legend>
      ${Object.keys(TIER_NAMES).filter(k => col(k).length).map(k => `<h4 class="ov-h">${teamTag(k)}</h4><div class="dir-row">${col(k).map(x => `<button class="dir-team ${isUserTeam(x.t) ? 'mine' : ''}" data-act="nav" data-to="roster" data-arg="${x.t.id}">${logoImg(x.t)}<span class="small">${esc(x.t.shortName)} <span class="muted">${x.st.W}-${x.st.L}</span></span></button>`).join('')}</div>`).join('')}
    </fieldset>
    <fieldset class="frame"><legend>Rumor Mill</legend><div class="stack">${rumors.slice(0, 12).map(rumorPost).join('') || '<p class="note small muted">Quiet around the league.</p>'}</div></fieldset>`;
}
// A rumor as a Hoop Gram post: the wording varies by player so a list of
// them never reads the same twice.
function rumorPost(r) {
  const p = r.p, t = r.team, nm = playerName(p), first = p.fn || nm, city = t.city;
  const why = r.why.length ? r.why.join(', ') : '';
  const seed = (p.id * 7 + t.id * 13) >>> 0;
  const pick = a => a[seed % a.length];
  const star = [
    `Sources: ${nm} has grown frustrated in ${city}${why ? ` after ${why}` : ''}. Teams are monitoring.`,
    `${first}'s camp is quietly gauging the market. ${why ? `${why[0].toUpperCase()}${why.slice(1)} will do that.` : ''}`,
    `Don't be surprised if ${nm} wants out of ${city} this summer${why ? `: ${why}` : ''}.`,
    `League executives believe ${nm} could become available. ${city} has a decision to make.`,
  ];
  const vet = [
    `${nm} is ${p.age} on a team heading the other way. Contenders are already calling ${city}.`,
    `Is ${first} part of ${city}'s timeline? At ${p.age}, a move to a contender makes sense for both sides.`,
    `${city} would listen on ${nm}. A ${p.age}-year-old ${posName(p)} doesn't fit a rebuild.`,
    `Keep an eye on ${nm}. Rival teams see a ${p.age}-year-old who could swing a playoff series.`,
  ];
  const blowup = [
    `${city} is ${why} with a ${r.bill ? `$${r.bill}M` : 'big'} tax bill coming. ${nm}'s name keeps coming up.`,
    `Blow it up in ${city}? Ownership won't pay that tax for a losing team, and ${first} is the biggest contract.`,
    `${city} wants under the tax. Calls on ${nm} are being returned.`,
  ];
  const taxpay = [
    `${city} is ${why}. Will ownership pay a $${r.bill}M tax bill to keep ${first} and this group together?`,
    `Running it back costs ${city} $${r.bill}M in tax. Contenders pay it. Do they?`,
  ];
  if (r.kind === 'blowup' || r.kind === 'taxpay') star.splice(0, star.length, ...(r.kind === 'blowup' ? blowup : taxpay));
  const handle = pick(['@HoopInsider', '@LeagueWhispers', '@CapSpaceGuy', '@TradeMachine', '@CourtsideSources']);
  const likes = 800 + (seed % 9000) + r.heat * 4000;
  return `<button class="hg-post tap" data-act="openPlayer" data-id="${p.id}">
    <div class="hg-head"><span class="hg-avatar">HG</span><b>${handle}</b></div>
    <p class="hg-text">${esc((r.kind === 'vet' ? pick(vet) : pick(star)).trim())}</p>
    <div class="hg-foot"><span>❤️ ${likes.toLocaleString()}</span><span class="muted">${esc(t.shortName)} · ${esc(nm)} ${lvTag(p)}</span></div>
  </button>`;
}
screens.overview = (args = {}) => {
  const L = league();
  const tab = args.tab === 'rumors' ? 'rumors' : 'team';
  const mine = L.teams.filter(isUserTeam);
  layout({
    title: 'Offseason Overview',
    body: `<div class="tabs">${[['team', 'Your Team'], ['rumors', 'Rumor Mill']].map(([k, l]) => `<button class="btn ${k === tab ? 'on focus' : 'off'}" data-act="ovTab" data-t="${k}">${l}</button>`).join('')}</div>
      ${tab === 'team' ? (mine.map(t => overviewTeam(L, t)).join('') || '<p class="note">Select your team first.</p>') : overviewRumors(L)}`,
    action: isStep('overview') ? { act: 'overviewDone', label: 'On to the Draft Preview' } : null,
  });
};
actions.ovTab = d => replace('overview', { tab: d.t });
actions.overviewDone = () => { calFlags().overview = true; goHome(); toast('Next up: Draft Preview'); };
actions.previewDone = () => { calFlags().preview = true; goHome(); toast('Next up: the Draft Lottery'); };

// Draft Preview: who projects around your first pick (the consensus board),
// with fits for your needs and play-style holes.
function rangeCard() {
  const L = league();
  const t = L.teams.find(isUserTeam);
  if (!t || !L.draftClass?.length) return '';
  const picks = draftPosition(L, t, state.params.lotteryFormat).filter(x => x.rd === 1);
  const first = [...picks].sort((a, b) => (a.lottery ? a.exp : a.slot) - (b.lottery ? b.exp : b.slot))[0];
  const board = boardOrder();
  if (!first) return '<fieldset class="frame"><legend>In Your Range</legend><p class="note small muted">No pick this year. The board is still worth a look for trades.</p></fieldset>';
  const at = Math.round(first.lottery ? first.exp : first.slot);
  const lo = Math.max(0, at - 4), hi = Math.min(board.length, at + 4);
  const needs = rosterNeeds(L, t, { level: shownLevel }).filter(n => n.group === 'style');
  const styleFit = p => needs.filter(n => playStyles(p, 3).some(s => s.k === n.style));
  return `<fieldset class="frame"><legend>In Your Range · ${first.lottery ? `likely #${first.likely} (avg #${at})` : `#${at}`}</legend>
    <div class="stack">${board.slice(lo, hi).map((p, i) => {
      const fills = fillsFor(t, p), sf = styleFit(p);
      const st = playStyles(p, 2);
      return `<button class="prow" data-act="openProspect" data-id="${p.id}"><span class="name">${lo + i + 1}. ${esc(playerName(p))} ${valueChip(p)}</span>
        <span class="right small">${fills.length || sf.length ? '🧩 ' : ''}${esc([...fills.map(n => n.label), ...sf.map(n => n.style === 'shooter' ? 'Spacing' : n.style === 'rim' ? 'Rim pressure' : n.style === 'playmaker' ? 'Playmaking' : n.style === 'protector' ? 'Rim protection' : 'Rebounding')].slice(0, 2).join(', '))}</span>
        <span class="meta">${esc(posName(p))} · ${p.age}y · ${heightStr(p.ht)}${st.length ? ` · ${st.map(x => `${x.icon} ${esc(x.label)}`).join(' · ')}` : ''}</span></button>`;
    }).join('')}</div>
    <p class="note muted small" style="margin-top:6px">By today's consensus board. Scouting, the combine and workouts will move it.</p></fieldset>`;
}

// Personality traits (1–20, kept in the save's unused trait fields).
// Prospects show what scouts can see (durability, motor) until a private
// workout; the rest read "?". Tap − / + to adjust.
function traitsBox(p, prospect = false) {
  if (!p.traits || !traitsSet(p)) return '';
  const seen = k => !prospect || k === 'durability' || k === 'motor' || workoutDone(p.id);
  const known = TRAITS.filter(t => seen(t.k));
  const tags = known.map(t => traitTag(t, p.traits[t.k] || 0)).filter(Boolean);
  return `<fieldset class="frame"><legend>Personality${isReal(p) ? ' <span class="muted small">· real-life read</span>' : ''}</legend>
    ${tags.length ? `<div class="style-chips">${tags.map(x => `<span class="style-chip">${x.icon} ${esc(x.label)}</span>`).join('')}</div>` : ''}
    <p class="note small">${esc(personality(p, known.map(t => t.k)))}</p>
    <details class="tend-wrap"><summary class="small">All traits</summary><div class="stack" style="margin-top:6px">${TRAITS.map(t => {
    const v = p.traits[t.k] || 0;
    if (!seen(t.k)) return `<div class="trait-row"><span class="small">${t.icon} ${t.label}</span><span class="tbar3"></span><span class="small muted">?</span><span></span></div>`;
    return `<div class="trait-row"><span class="small">${t.icon} ${t.label}</span><span class="tbar3"><span style="width:${v * 5}%" class="${v >= 16 ? 'top' : v >= 10 ? 'hi' : v <= 4 ? 'lo' : ''}"></span></span>
      <span class="small"><b>${v}</b> <span class="${v >= 16 ? 'gold' : 'muted'}">${traitLabel(t, v)}</span></span>
      <span class="trait-ctl"><button class="btn tiny" data-act="traitAdj" data-id="${p.id}" data-k="${t.k}" data-d="-1" aria-label="Lower ${t.label}">−</button><button class="btn tiny" data-act="traitAdj" data-id="${p.id}" data-k="${t.k}" data-d="1" aria-label="Raise ${t.label}">+</button></span></div>`;
  }).join('')}</div></details>${prospect && !workoutDone(p.id) ? '<p class="note muted small" style="margin-top:6px">Bring him in for a private workout to learn the rest.</p>' : ''}</fieldset>`;
}
actions.traitAdj = d => {
  const L = league();
  const p = [...L.teams.flatMap(t => t.roster), ...(L.freeAgents || []), ...(L.draftClass || [])].find(x => x.id === +d.id);
  if (!p?.traits) return;
  p.traits[d.k] = Math.max(1, Math.min(20, (p.traits[d.k] || 10) + +d.d));
  state.dirty = true;
  render();
};

// Play style from the save's tendencies (players and prospects).
function playStyleBox(p) {
  if (!p.tendencies) return '';
  const st = playStyles(p, 3), w = wontDo(p);
  const bar = v => `<span class="tbar2"><span class="tb-mid"></span><span class="tb-fill ${v < 0 ? 'neg' : ''}" style="${v >= 0 ? `left:50%;width:${v * 10}%` : `right:50%;width:${-v * 10}%`}"></span></span>`;
  return `<fieldset class="frame"><legend>Play Style</legend>
    ${st.length ? `<div class="style-chips">${st.map(x => `<span class="style-chip">${x.icon} ${esc(x.label)}</span>`).join('')}</div>` : ''}
    <p class="note small">${esc(styleLine(p))}</p>
    ${earnedSkills(p).length ? `<p class="note small">🎖️ ${esc(earnedSkills(p).slice(0, 2).map(x => skillSays(x.id)).join('; and ').replace(/^./, c => c.toUpperCase()))}.</p>
      <details class="tend-wrap"><summary class="small">Skills</summary>${earnedSkills(p).map(x => `<div class="tend-row"><span class="small"><b>${esc(skillName(x.id))}</b>${isLeveled(x.id) ? ` ${x.level}` : ''}</span><span class="small muted">${esc(skillDoes(x.id))}</span></div>`).join('')}</details>` : ''}
    <details class="tend-wrap"><summary class="small">All tendencies</summary>
      ${TEND_GROUPS.map(([g, ks]) => `<h4 class="ov-h">${g}</h4>${ks.map(k => `<div class="tend-row"><span class="small">${TEND_LABELS[k]}</span>${bar(p.tendencies[k] || 0)}<span class="small ${p.tendencies[k] > 0 ? 'up' : p.tendencies[k] < 0 ? 'down' : 'muted'}">${p.tendencies[k] > 0 ? '+' : ''}${p.tendencies[k]}</span></div>`).join('')}`).join('')}
    </details></fieldset>`;
}

// ---------------------------------------------------------------------------
// Extension window (Jul 1): players heading into the last year of their deal
// can sign an extension that starts when it ends. The extension goes into
// the save's own contract.ext slot, and the app keeps a ledger: next
// offseason, an extended player whose deal is up is signed to it on load
// (in case the game doesn't apply it itself).

function extStore() {
  const key = `hlc:ext:${seasonKey()}`;
  const c = (state.extS ||= {});
  if (!c[key]) { let v = {}; try { v = JSON.parse(localStorage.getItem(key)) || {}; } catch { v = {}; } c[key] = { talks: {}, ...v }; }
  return c[key];
}
function saveExtStore() { try { localStorage.setItem(`hlc:ext:${seasonKey()}`, JSON.stringify(extStore())); } catch { /* ignore */ } }
// Dead money: a cut player with years left is still paid, and it counts
// against the cap for each of those seasons (in the app; the game itself
// doesn't track it). [{ pid, name, tid, sal, yrs, yr }] per save.
const deadKey = () => `hlc:dead:${league().shortName}:${league().meta?.saveName || ''}`;
function deadLedger() { try { return JSON.parse(localStorage.getItem(deadKey())) || []; } catch { return []; } }
function saveDead(v) { try { localStorage.setItem(deadKey(), JSON.stringify(v)); } catch { /* ignore */ } syncDead(); }
const deadFor = (tid, yr = league().season.currentYear) => deadLedger().filter(x => x.tid === tid && yr >= x.yr && yr < x.yr + x.yrs).reduce((a, x) => a + x.sal, 0);
function syncDead() {
  if (!state.data) return;
  FA.setDeadMoney(Object.fromEntries(league().teams.map(t => [t.id, deadFor(t.id)])));
}
// Cap bar: payroll, dead money (red) and room under the cap.
// The tax on an amount over the line (the same brackets as FA.taxBill).
function taxOn(over) {
  let left = over, rate = 1.5, bill = 0, step = 0;
  while (left > 0) { const c = Math.min(5, left); bill += c * rate; left -= c; step++; rate = step === 1 ? 1.75 : step === 2 ? 2.5 : step === 3 ? 3.25 : rate + 0.5; }
  return Math.round(bill);
}
const capBar = t => capBarOf(FA.payroll(t), deadFor(t.id)) + ownerLine(t);
// What ownership will put up with, from the team's status and record.
function ownerLine(t) {
  if (!FA.capSystemOn() || !isUserTeam(t)) return '';
  const C = FA.capLines(league()), st = FA.taxStance(league(), t);
  const fz = FA.frozenPick(league(), t), yrs = apronYears(t.id);
  return `<p class="note small owner-line">🏛️ ${st === 'pay' ? `Ownership will pay the tax to keep a winner together (up to the 2nd apron, $${C.apron2}M).` : st === 'blowup' ? 'Ownership won\'t pay the tax for a losing team. Shed salary.' : `Ownership wants to stay under the tax line ($${C.tax}M).`}</p>
    ${fz || yrs ? `<p class="note small owner-line">🔒 ${fz ? `${esc(pickLabel(fz))} frozen (over the 2nd apron). ` : ''}${yrs ? `Over the 2nd apron ${yrs} of the last 5 seasons${yrs >= 2 ? ': 3 sends a first to the end of the round' : ''}.` : ''}</p>` : ''}`;
}

// 2nd apron, 3 of 5 seasons: the team's furthest-out first moves to the
// end of the 1st round when that draft comes. History is by season start,
// recorded at final cuts: { hist: { [yr]: [tids] }, pen: [{ otid, yr }] }.
const apronKey = () => `hlc:apron2:${league().shortName}:${league().meta?.saveName || ''}`;
function apronStore() { try { return JSON.parse(localStorage.getItem(apronKey())) || { hist: {}, pen: [] }; } catch { return { hist: {}, pen: [] }; } }
function saveApron(v) { try { localStorage.setItem(apronKey(), JSON.stringify(v)); } catch { /* ignore */ } }
function apronYears(tid) {
  const h = apronStore().hist, yr = FA.seasonStart(league());
  return [0, 1, 2, 3, 4].filter(i => (h[yr - i] || []).includes(tid)).length;
}
const pickPenalized = pk => pk.rd === 1 && apronStore().pen.some(x => x.otid === pk.otid && x.yr === pk.yr);
const pickPenTag = pk => pickPenalized(pk) ? ' <span class="badge lock" title="Over the 2nd apron 3 of 5 seasons: moves to the end of the 1st round">⬇ End of R1</span>' : '';
// Returns the teams newly penalized.
function recordApron() {
  if (!FA.capSystemOn()) return [];
  const L = league(), st = apronStore(), yr = FA.seasonStart(L);
  st.hist[yr] = L.teams.filter(t => FA.capTier(L, t) === 'apron2').map(t => t.id);
  const hit = [];
  for (const tid of st.hist[yr]) {
    if ([0, 1, 2, 3, 4].filter(i => (st.hist[yr - i] || []).includes(tid)).length < 3) continue;
    const far = Math.max(...L.teams.flatMap(t => t.draftPicks.filter(pk => pk.rd === 1 && pk.otid === tid).map(pk => pk.yr)));
    if (!isFinite(far) || st.pen.some(x => x.otid === tid && x.yr === far)) continue;
    st.pen.push({ otid: tid, yr: far });
    hit.push(L.teams.find(t => t.id === tid));
  }
  saveApron(st);
  return hit;
}

// How the locker room takes the money moves (applied at final cuts):
// paying the tax to keep a winner together lifts the core; letting a good
// player go to duck the tax or a teardown sours stars and win-now vets;
// money-minded players in a contract year doubt they'll get paid.
// [{ p, n, why: [] }]
function taxMood(L, t) {
  if (!FA.capSystemOn()) return [];
  const C = FA.capLines(L), st = FA.taxStance(L, t), pay = FA.teamCommitted(t);
  const roster = FA.signedRoster(t);
  const core = [...roster].sort((a, b) => shownLevel(b) - shownLevel(a)).slice(0, 3);
  const out = [];
  const add = (p, n, why) => { const e = out.find(x => x.p === p); if (e) { e.n += n; e.why.push(why); } else out.push({ p, n, why: [why] }); };
  const winner = p => tr(p, 'winning') >= 15;
  if (st === 'pay' && pay > C.tax) {
    for (const p of core) add(p, 4, 'ownership paid the tax to keep the group together');
    for (const p of roster.filter(winner)) add(p, 2, 'loves a contender going all in');
  }
  if (st !== 'pay' && pay <= C.tax) {
    const onTeams = new Set(L.teams.flatMap(x => x.roster));
    const gone = teamSituation(L, t, state.leagueIdx).departures
      .filter(p => onTeams.has(p) && shownLevel(p) >= 78 && pay + (p.contract?.sal || 0) > C.tax)
      .sort((a, b) => shownLevel(b) - shownLevel(a))[0];
    if (gone) {
      const why = `${gone.ln || playerName(gone)} let go to stay under the tax`;
      for (const p of core) add(p, -6, why);
      for (const p of roster.filter(winner)) add(p, -3, why);
    }
  }
  if (st === 'blowup') for (const p of roster.filter(p => p.age >= 28 && tr(p, 'winning') >= 13)) add(p, -5, 'stuck in a teardown');
  if (st !== 'pay') for (const p of roster.filter(p => tr(p, 'money') >= 15 && p.contract?.yrs === 1 && shownLevel(p) >= 75)) add(p, -3, 'doubts the team will pay him next summer');
  return out.filter(x => x.n);
}
// Cap bar: payroll, dead money (red) and room, with ticks at the cap, the
// tax line and both aprons; the tier and any tax bill underneath.
function capBarOf(pay, dead, compact = false) {
  const C = FA.capLines(league());
  const lines = C.off ? [['Cap', C.cap]] : [['Cap', C.cap], ['Tax', C.tax], ['1st', C.apron1], ['2nd', C.apron2]];
  const top = Math.max(C.off ? C.cap : C.apron2 * 1.04, pay + dead);
  const pct = v => Math.max(0, Math.min(100, v / top * 100));
  const total = pay + dead, free = C.cap - total;
  const tier = C.off ? (free >= 0 ? 'under' : 'over') : total < C.cap ? 'under' : total < C.tax ? 'over' : total < C.apron1 ? 'tax' : total < C.apron2 ? 'apron1' : 'apron2';
  const next = lines.find(([, v]) => v > total);
  const zones = C.off ? '' : `background:linear-gradient(90deg, #2f6b4a 0 ${pct(C.cap)}%, #24507a ${pct(C.cap)}% ${pct(C.tax)}%, #6b5a1e ${pct(C.tax)}% ${pct(C.apron1)}%, #7a4a1e ${pct(C.apron1)}% ${pct(C.apron2)}%, #7a2430 ${pct(C.apron2)}%)`;
  return `<div class="cap-bar" style="${zones}"><span class="cb-pay" style="width:${pct(pay)}%"></span><span class="cb-dead" style="width:${pct(dead)}%"></span>${lines.map(([l, v]) => `<i class="cb-tick" style="left:${pct(v)}%" title="${l} $${v}M"></i>`).join('')}</div>
    <div class="cap-legend small">${compact ? '' : `<span>Payroll $${pay}M</span>`}${dead ? `<span class="down">Dead $${dead}M</span>` : ''}<span class="tier-tag t-${tier}">${FA.TIER_NAMES[tier]}</span>${!C.off && total > C.tax ? `<span class="down">Tax bill $${taxOn(total - C.tax)}M</span>` : ''}${free >= 0 ? `<span class="up">$${free}M space</span>` : next ? `<span class="muted">$${next[1] - total}M to the ${next[0] === 'Tax' ? 'tax' : next[0] === '1st' ? '1st apron' : next[0] === '2nd' ? '2nd apron' : 'cap'}</span>` : '<span class="down">Over the 2nd apron</span>'}</div>`;
}

const extLedgerKey = () => `hlc:extLedger:${league().shortName}:${league().meta?.saveName || ''}`;
function extLedger() { try { return JSON.parse(localStorage.getItem(extLedgerKey())) || []; } catch { return []; } }
function saveExtLedger(v) { try { localStorage.setItem(extLedgerKey(), JSON.stringify(v)); } catch { /* ignore */ } }

// The game stamps this year's draftees with the save's year; franchise years
// are the year the season ends, which is the year the draft happens, one
// less. The file goes out with the draft year a year back (the app keeps the
// save's year in memory so its own rookie logic still finds the class).
const stampKey = () => `hlc:dstamp:${league().shortName}:${league().meta?.saveName || ''}`;
function stampDraftYear() {
  const L = league();
  if (!L || isCollege()) return [];
  const yr = L.season.currentYear;
  const rookies = L.teams.flatMap(t => t.roster).concat(L.freeAgents || []).filter(p => p.history?.draft?.yr === yr && p.history.draft.rd > 0);
  if (!rookies.length) return [];
  try { localStorage.setItem(stampKey(), JSON.stringify({ yr, ids: rookies.map(p => p.id) })); } catch { /* ignore */ }
  for (const p of rookies) p.history.draft.yr = yr - 1;
  return rookies;
}
// On load: this year's class comes back to the save's year in memory.
function unstampDraftYear() {
  const L = league();
  if (!L || isCollege()) return;
  const yr = L.season.currentYear;
  let rec; try { rec = JSON.parse(localStorage.getItem(stampKey())); } catch { rec = null; }
  const ids = rec && rec.yr === yr ? new Set(rec.ids) : null;
  for (const p of L.teams.flatMap(t => t.roster).concat(L.freeAgents || [])) {
    const d = p.history?.draft;
    if (!d || d.yr !== yr - 1 || !(d.rd > 0)) continue;
    // Without a record: a rookie who hasn't played yet (years pro 0).
    if (ids ? ids.has(p.id) : (p.yrs ?? 1) === 0) d.yr = yr;
  }
}
// Heading into the new season, nobody carries over XP or unspent upgrade
// points (with Upgrade Points mode on, the ones this offseason's bump just
// awarded stay).
function clearSeasonPoints() {
  const L = league();
  if (!L || isCollege() || L.season.phase !== BUMP_PHASES[0]) return;
  const keepAp = state.params.bumpMode === 'points';
  for (const p of [...L.teams.flatMap(t => t.roster), ...(L.freeAgents || [])]) {
    if (!p.season) continue;
    if (p.season.xp) p.season.xp = p.season.xp.map(() => 0);
    if (p.season.ap && !keepAp) p.season.ap = p.season.ap.map(() => 0);
  }
  state.dirty = true;
}
// Extension eligibility switched off in the exported file, by save.
const extOffKey = () => `hlc:extoff:${league().shortName}:${league().meta?.saveName || ''}`;
function shutExtensions() {
  const L = league();
  if (!L || isCollege() || L.season.phase !== BUMP_PHASES[0]) return [];
  const shut = L.teams.flatMap(t => t.roster).filter(p => p.contract && p.contract.canExt === true);
  try { localStorage.setItem(extOffKey(), JSON.stringify({ yr: L.season.currentYear, ids: shut.map(p => p.id) })); } catch { /* ignore */ }
  for (const p of shut) p.contract.canExt = false;
  return shut;
}
// Next offseason (before free agency): anyone on a final year (no option,
// not already extended) is extension-eligible again. If the app remembers
// who it closed, only those players reopen; with no record (storage
// cleared, another browser) every final-year player does.
function reopenExtensions() {
  const L = league();
  if (!L || isCollege() || ![2, 4, 5].includes(L.season.phase)) return 0;
  let rec; try { rec = JSON.parse(localStorage.getItem(extOffKey())); } catch { rec = null; }
  if (rec && L.season.currentYear < rec.yr) return 0;
  const ids = rec ? new Set(rec.ids) : null;
  let n = 0;
  for (const p of L.teams.flatMap(t => t.roster)) {
    const c = p.contract;
    if (!c || p.status !== FA.STATUS_SIGNED || c.canExt !== false || c.yrs !== 1 || c.opt > 0 || c.ext?.yrs > 0) continue;
    if (ids && !ids.has(p.id)) continue;
    c.canExt = true; n++;
  }
  try { localStorage.removeItem(extOffKey()); } catch { /* ignore */ }
  if (n) state.dirty = true;
  return n;
}

const extEligible = (L, t) => t.roster.filter(p => p.status === FA.STATUS_SIGNED && (p.contract?.yrs || 0) === 1 && p.contract.canExt !== false && !(p.contract.ext?.yrs > 0) && !(p.contract.opt > 0));
// Where he'll be in a year: young players still climbing, veterans near
// their decline age slipping.
function projLevel(p) {
  const lv = shownLevel(p);
  const up = p.age <= 22 ? 4 : p.age <= 24 ? 2 : p.age <= 26 ? 1 : 0;
  const down = p.age >= (p.regressionAge || 32) - 1 ? 2 : 0;
  return lv + Math.round(up * Math.max(0.5, ((p.pot || 7) - 5) / 3)) - down;
}
// What he wants: { sal, yrs: [min, max], mood } — mood: 'eager' | 'open' | 'market'.
// The pay-cut pitch: only for a star, only on a contending (or favored)
// team. A winner who isn't chasing money may take less to keep the team
// strong. Extreme traits decide it: a money chaser (17+) won't hear it, a
// win-first player (17+) nearly always does. One try per player and window.
function cutPitchOk(p, team) {
  const lv = shownLevel(p);
  return isComplete() && team && isUserTeam(team) && teamStatus(league(), team) === 'contending' && (lv >= 86 || ((p.pot || 0) >= 9 && lv >= 79));
}
function cutPitch(p, team) {
  const win = tr(p, 'winning'), money = tr(p, 'money'), loy = tr(p, 'loyalty'), morale = p.season?.morale ?? 60;
  const pct = Math.round(Math.max(0.06, Math.min(0.18, 0.08 + (win - 10) * 0.01)) * 100) / 100;
  let odds = 0.25 + (win - 10) * 0.05 + (FA.motiveOf(league(), p) === 'contender' ? 0.2 : 0) - (money - 10) * 0.05 + (loy - 10) * 0.02 + (morale >= 70 ? 0.1 : morale < 45 ? -0.2 : 0);
  if (money >= 17) odds = 0;
  else if (win >= 17 && money <= 12) odds = Math.max(odds, 0.9);
  odds = Math.max(0, Math.min(0.9, odds));
  const ok = mulberry32((saveSalt() ^ Math.imul(p.id + 3, 2246822519) ^ 0xc07) >>> 0)() < odds;
  return { ok, pct, odds };
}
function extAsk(p, team) {
  const proj = projLevel(p);
  const base = fairSalary(proj);
  const morale = p.season?.morale ?? 70;
  const rookie = FA.isRookieScale(p);
  const greed = 1 + (tr(p, 'money') - 10) * 0.02 - Math.max(0, tr(p, 'loyalty') - 12) * 0.015;
  // He opens high (and always above the minimum) and can be talked down.
  let sal = Math.round(base * 1.1 * greed * (rookie ? 1.05 : 1) * (morale >= 80 ? 0.95 : morale < 50 ? 1.1 : 1));
  if (isUserTeam(team)) sal = Math.round(sal * fxNow().askMult * FX.facilityFx(team).askMult);
  // Holding out: an unhappy player whose traits say money or no loyalty asks
  // for a market-resetting deal, above the best-paid peers at his position.
  const holdout = isComplete() && morale < 35 && tr(p, 'loyalty') < 16 && (tr(p, 'money') >= 13 || tr(p, 'loyalty') <= 6);
  if (holdout) {
    const peers = league().teams.flatMap(x => x.roster).filter(x => x !== p && Math.abs(x.pos - p.pos) <= 1 && shownLevel(x) >= shownLevel(p) - 2 && x.contract?.sal);
    sal = Math.round(Math.max(sal * (1.3 + (tr(p, 'money') - 10) * 0.01), peers.reduce((m, x) => Math.max(m, x.contract.sal), 0) * 1.03));
  }
  sal = Math.max(FA.minFor(p) + 1, Math.min(FA.maxSalary(league(), p, true, p.contract?.yrs || 1), sal));
  const yrs = holdout ? [2, 3] : p.age <= 25 ? [4, 5] : p.age <= 28 ? [3, 5] : p.age <= 31 ? [2, 4] : [1, 2];
  const loyal = tr(p, 'loyalty') >= 16, mercenary = tr(p, 'loyalty') <= 5;
  const mood = (morale < 40 && !loyal) || (mercenary && tr(p, 'money') >= 15) ? 'market' : morale >= 75 || loyal || teamRecord(team).pct >= 0.55 ? 'eager' : 'open';
  // The one length he asks for (the range is how far he'll bend).
  const pref = Math.round((yrs[0] + yrs[1]) / 2 + 0.01);
  return { sal, yrs, pref, mood, holdout, proj, ntc: FA.wantsNtc(league(), p, team), ntcOk: FA.ntcEligible(league(), p, team) };
}
// His answer to an offer: { ok, counter, text }.
function extAnswer(p, team, offer) {
  const a = extAsk(p, team);
  const off = offer.yrs < a.yrs[0] ? a.yrs[0] - offer.yrs : offer.yrs > a.yrs[1] ? offer.yrs - a.yrs[1] : 0;
  // What he'll actually take: under his ask, more with a team option, less
  // with a player option.
  const mood = a.mood === 'market' ? 1.15 : a.mood === 'eager' ? 0.84 : 0.9;
  const opt = offer.opt === FA.OPT_TEAM ? 1.06 : offer.opt === FA.OPT_PLAYER ? 0.96 : 1;
  // A no-trade clause is worth a little to him; one he asked for and didn't get costs.
  const ntc = offer.ntc && a.ntcOk ? 0.95 : a.ntc ? 1.05 : 1;
  const need = Math.max(FA.minFor(p), Math.round(a.sal * (1 + 0.06 * off) * mood * opt * ntc * (1 - (offer.cut || 0))));
  if (a.holdout) {
    if (offer.sal >= Math.round(a.sal * 0.97) && off === 0) return { ok: true, text: 'Deal.' };
    return { ok: false, counter: { sal: a.sal, yrs: a.pref }, text: 'He\'s holding out to reset the market. Nothing under his number.' };
  }
  if (offer.sal >= need) return { ok: true, text: 'Deal.' };
  const yrs = Math.min(Math.max(offer.yrs, a.yrs[0]), a.yrs[1]);
  return { ok: false, counter: { sal: Math.max(need, Math.round(a.sal * (a.mood === 'market' ? 1.2 : 0.95))), yrs },
    text: a.mood === 'market' ? 'His camp wants to see what free agency brings. It would take an overpay.' : offer.sal < need * 0.8 ? 'Not close. His agent walked out of the room.' : 'Close, but not there yet.' };
}
function signExtension(L, t, p, deal, cpu = false) {
  moraleEvent(p, `ext:${L.season.currentYear}`, 8, 'extension');
  const ntc = deal.ntc && FA.ntcEligible(L, p, t) ? 1 : 0;
  // Over 4 seasons in all, or a raise over 120%: six months before a trade.
  if (deal.yrs + 1 > 4 || deal.sal > (p.contract.sal || 0) * 1.2) lockSigning(p, 'Extended: 6 months');
  p.contract.ext = { yrs: deal.yrs, sal: deal.sal, opt: deal.opt || 0, noTrd: ntc };
  p.contract.canExt = false;
  const led = extLedger().filter(x => x.pid !== p.id);
  led.push({ pid: p.id, tid: t.id, yrs: deal.yrs, sal: deal.sal, opt: deal.opt || 0, ntc, yr: L.season.currentYear, cpu });
  saveExtLedger(led);
}
// On load: last summer's extensions for players whose deal is now up.
function applyExtensions() {
  const L = league();
  if (!L) return 0;
  const led = extLedger();
  let n = 0;
  const keep = [];
  for (const x of led) {
    const t = L.teams.find(tt => tt.roster.some(p => p.id === x.pid));
    const p = t?.roster.find(pp => pp.id === x.pid);
    if (x.yr >= L.season.currentYear || !p) { if (x.yr >= L.season.currentYear) keep.push(x); continue; }
    if (p.status === FA.STATUS_EXPIRING) {
      p.status = FA.STATUS_SIGNED;
      Object.assign(p.contract, { tid: t.id, pid: p.id, yrs: x.yrs, sal: x.sal, opt: x.opt || 0, noTrd: x.ntc || 0, canExt: false, ext: { yrs: 0, sal: 0, opt: 0, noTrd: 0 } });
      const row = (p.stats || []).filter(s => s.yr === L.season.currentYear && s.league === 0).pop();
      if (row) row.sal = x.sal;
      n++;
      state.dirty = true;
    }
  }
  saveExtLedger(keep);
  return n;
}

screens.extensions = () => {
  const L = league(), st = extStore();
  const done = !!st.done;
  const mine = L.teams.filter(isUserTeam);
  const total = x => `<span class="tot">$${x.sal * x.yrs}M</span>`;
  const optTag = o => (o === FA.OPT_PLAYER ? ' · PO' : o === FA.OPT_TEAM ? ' · TO' : '');
  const row = (t, p) => {
    const a = extAsk(p, t);
    const talk = st.talks[p.id];
    const lv = shownLevel(p);
    const proj = a.proj !== lv ? ` <span class="small ${a.proj > lv ? 'up' : 'down'}">→ ${a.proj}</span>` : '';
    const over = talk?.tries >= 3;
    const status = talk?.signed ? `<span class="up">✍️ $${talk.signed.sal}M × ${talk.signed.yrs}${optTag(talk.signed.opt)}</span> ${total(talk.signed)}`
      : over ? '<span class="down">Talks broke off</span>'
      : talk?.last ? `<span class="down">${esc(talk.last.text)}</span>` : '';
    const grudge = FA.hasGrudge(p, t);
    return `<button class="prow" data-act="extOpen" data-id="${p.id}" ${talk?.signed || over || done || grudge ? 'disabled' : ''}>
      <span class="name">${esc(playerName(p))} ${lvTag(p)}${proj}</span>
      <span class="right small">$${p.contract.sal}M<br><span class="muted">final year</span></span>
      <span class="meta">${esc(posName(p))} · ${p.age}y · ${moraleTag(p)} · asks $${a.sal}M × ${a.pref}${a.holdout ? ' · <span class="down">🚫 holding out</span>' : a.mood === 'market' ? ' · <span class="down">eyeing free agency</span>' : ''}</span>
      ${grudge ? '<span class="chg"><span class="down">🚫 Refuses to meet with you: you broke your promise</span></span>' : status ? `<span class="chg">${status}</span>` : ''}
    </button>`;
  };
  const log = st.log;
  layout({
    title: 'Extension Window',
    body: `<p class="note small">Players heading into the last year of their deal.</p>
      ${mine.map(t => `<fieldset class="frame"><legend>${esc(t.shortName)}</legend><div class="list">${extEligible(L, t).sort((a, b) => shownLevel(b) - shownLevel(a)).map(p => row(t, p)).join('')
        || (Object.values(st.talks).some(x => x.signed) ? '' : '<p class="note small muted">Nobody heading into a final year.</p>')}
        ${t.roster.filter(p => st.talks[p.id]?.signed && !extEligible(L, t).includes(p)).map(p => `<div class="prow"><span class="name">${esc(playerName(p))} ${lvTag(p)}</span><span class="meta up">✍️ $${st.talks[p.id].signed.sal}M × ${st.talks[p.id].signed.yrs}${optTag(st.talks[p.id].signed.opt)} ${total(st.talks[p.id].signed)}</span></div>`).join('')}</div></fieldset>`).join('')}
      ${done && log ? `<fieldset class="frame"><legend>Around the League</legend><div class="stack">${(log.list || []).map(x => `<p class="note small"><b>${esc(x.name)}</b> (${esc(x.team)}) · $${x.sal}M × ${x.yrs}${optTag(x.opt)} ${total(x)}</p>`).join('') || '<p class="note small muted">Nobody else extended.</p>'}</div></fieldset>` : ''}`,
    action: done ? null : { act: 'extClose', label: 'Close the Window' },
  });
};
// The offer pop-up: salary, years, option (team | none | player).
actions.extOpen = d => {
  const L = league(), st = extStore();
  const t = L.teams.find(tt => tt.roster.some(x => x.id === +d.id));
  const p = t?.roster.find(x => x.id === +d.id);
  if (!p || st.done) return;
  const a = extAsk(p, t);
  const talk = (st.talks[p.id] ||= { sal: a.sal, yrs: a.pref, opt: a.pref >= 5 ? FA.OPT_PLAYER : 0, tries: 0, last: null, signed: null });
  talk.opt ||= 0;
  if (talk.signed || talk.tries >= 3) return;
  const box = overlay('');
  const paint = () => {
    box.querySelector('.box').innerHTML = `
      <p class="note"><b>${esc(playerName(p))}</b> ${lvTag(p)}<br><span class="small muted">${esc(posName(p))} · ${p.age}y · asks $${a.sal}M × ${a.pref}</span></p>
      ${maxLine(L, p, p.contract?.yrs || 1)}
      <div class="pts-row"><span class="grow">Salary</span><button class="btn square" data-k="sal" data-d="-1">−</button><span class="pts-val">$${talk.sal}M</span><button class="btn square" data-k="sal" data-d="1">+</button></div>
      <div class="pts-row"><span class="grow">Years</span><button class="btn square" data-k="yrs" data-d="-1">−</button><span class="pts-val">${talk.yrs}</span><button class="btn square" data-k="yrs" data-d="1">+</button></div>
      <div class="tabs">${[[0, 'No Option'], [FA.OPT_PLAYER, 'Player'], [FA.OPT_TEAM, 'Team']].map(([v, l]) => `<button class="btn ${talk.opt === v ? 'on focus' : 'off'}" data-k="opt" data-v="${v}">${l}</button>`).join('')}</div>
      ${a.ntcOk ? `<div class="tabs">${[[0, 'No NTC'], [1, 'No-trade clause']].map(([v, l]) => `<button class="btn ${!!talk.ntc === !!v ? 'on focus' : 'off'}" data-k="ntc" data-v="${v}">${l}</button>`).join('')}</div>${a.ntc ? '<p class="note small">He wants a no-trade clause.</p>' : ''}` : ''}
      <p class="note small">Total <span class="tot">$${talk.sal * talk.yrs}M</span> · ${3 - talk.tries} offer${3 - talk.tries === 1 ? '' : 's'} left${talk.last ? `<br><span class="down">${esc(talk.last.text)}</span>` : ''}</p>
      ${a.holdout ? '<p class="note small">He\'s unhappy and wants to reset the market at his position. Pay it, shop him, or sign him high and send him out.</p><div class="grid2"><button class="btn" data-k="shop">🔁 Shop Him</button><button class="btn" data-k="snt">🤝 Sign-and-Trade</button></div>' : ''}
      ${!a.holdout && cutPitchOk(p, t) ? (talk.cut ? `<p class="note small up">🏆 He'll take ${Math.round(talk.cut * 100)}% less to keep this team a contender.</p>` : talk.cutTried ? '<p class="note small muted">He heard the pay-cut pitch and passed.</p>' : '<button class="btn" data-k="cut">🏆 Pitch a Pay Cut to Win</button>') : ''}
      <div class="grid2"><button class="btn off" data-k="close">Cancel</button><button class="btn focus" data-k="submit">Make Offer</button></div>`;
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'sal') talk.sal = Math.max(FA.FA_DEFAULTS.minSalary, Math.min(FA.maxSalary(L, p, true, p.contract?.yrs || 1), talk.sal + +b.dataset.d));
    else if (k === 'yrs') talk.yrs = Math.max(1, Math.min(5, talk.yrs + +b.dataset.d));
    else if (k === 'opt') talk.opt = +b.dataset.v;
    else if (k === 'ntc') talk.ntc = !!+b.dataset.v;
    else if (k === 'close') { saveExtStore(); box.remove(); render(); return; }
    else if (k === 'cut') {
      if (talk.cutTried) return;
      talk.cutTried = true;
      const r = cutPitch(p, t);
      if (r.ok) { talk.cut = r.pct; talk.sal = Math.max(FA.FA_DEFAULTS.minSalary, Math.round(talk.sal * (1 - r.pct))); toast(`${playerName(p)} is in`, `He'll take ${Math.round(r.pct * 100)}% less to win.`); }
      else { if (p.season) p.season.morale = Math.max(0, (p.season.morale ?? 60) - 3); toast(`${playerName(p)} passed`, 'He wants his money.', 2600, true); }
      saveExtStore();
    }
    else if (k === 'snt') {
      saveExtStore(); box.remove();
      extSignAndTrade(p, t, { sal: a.sal, yrs: a.pref, opt: 0, ntc: false });
      return;
    }
    else if (k === 'shop') {
      saveExtStore(); box.remove();
      (draftState().block ||= new Set()).add(`p:${p.id}`);
      reqOffers({ pid: p.id, tid: t.id });
      return;
    }
    else if (k === 'submit') {
      actions.extOffer({ id: p.id });
      if (talk.signed || talk.tries >= 3) { box.remove(); return; }
    }
    paint();
  });
  paint();
};
// Sign-and-trade for a holdout: he signs the extension at his number, then
// goes to a team that values him on the new deal. If the trade falls through,
// the signing is undone.
function extSignAndTrade(p, team, deal) {
  const L = league(), ds = draftState();
  const keep = structuredClone(p.contract);
  Object.assign(p.contract, { yrs: deal.yrs, sal: deal.sal, opt: deal.opt || 0 });
  ds.offerSeed = Math.floor(Math.random() * 1e9);
  let offers = [];
  try { offers = frontOfficeOffers(team, { only: `p:${p.id}`, max: 6 }).filter(o => o.kind === 'block').slice(0, 6); } finally { p.contract = keep; }
  const box = overlay('');
  box.querySelector('.box').innerHTML = `<p class="note"><b>${esc(playerName(p))}</b> ${lvTag(p)}<br><span class="small muted">Signs $${deal.sal}M × ${deal.yrs} (starting next season), then goes to:</span></p>
    <div class="stack">${offers.map((o, i) => `<div class="offer"><p class="note small"><b>${esc(o.team.shortName)}</b> ${offerRating(o)}: ${esc(o.give.map(x => x.text).join(' + '))}</p><button class="btn small" data-i="${i}">Accept</button></div>`).join('') || '<p class="note small muted">Nobody will take that contract right now.</p>'}</div>
    <button class="btn off" data-close style="margin-top:8px">Close</button>`;
  box.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) { box.remove(); return; }
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const o = offers[+b.dataset.i];
    box.remove();
    const had = structuredClone(p.contract);
    const ledBefore = extLedger();
    signExtension(L, team, p, deal);
    const m = offGet('signed'); delete m[p.id]; offSet('signed', m);      // the 6-month lock doesn't apply to a sign-and-trade
    // The trade rules look at the deal as it will stand; let him move on his current contract.
    if (await doOffer(team, o)) {
      const st = extStore(); st.talks[p.id] = { ...(st.talks[p.id] || {}), signed: { ...deal, snt: true }, tries: 3 };
      saveExtStore();
      ds.block?.delete(`p:${p.id}`);
      ds.offers = null;
      state.dirty = true;
      render();
    } else {
      p.contract = had;
      saveExtLedger(ledBefore);
      toast('Sign-and-trade fell through', 'The extension was undone.', 3000, true);
      extSignAndTrade(p, team, deal);
    }
  });
}
actions.extOffer = d => {
  const L = league(), st = extStore();
  const t = L.teams.find(tt => tt.roster.some(x => x.id === +d.id));
  const p = t?.roster.find(x => x.id === +d.id);
  const talk = st.talks[+d.id];
  if (!p || !talk || talk.tries >= 3 || st.done) return;
  if (talk.yrs >= 5 && !talk.opt) { toast('A 5-year deal needs an option (4 + 1)', '', 2400, true); return; }
  const r = extAnswer(p, t, talk);
  talk.tries++;
  talk.last = r;
  if (r.ok) {
    checkpoint(`Extend ${playerName(p)}`);
    signExtension(L, t, p, talk);
    talk.signed = { sal: talk.sal, yrs: talk.yrs, opt: talk.opt || 0, ntc: !!talk.ntc };
    state.dirty = true;
    toast(`✍️ ${playerName(p)} extended`, `$${talk.sal}M × ${talk.yrs}, starting next season`);
  }
  saveExtStore();
  if (talk.signed || talk.tries >= 3) render();
};
actions.extClose = async () => {
  const L = league(), st = extStore();
  if (!(await confirmBox('Close the extension window?', 'Close'))) return;
  const rng = mulberry32((saveSalt() ^ 0xe7e1) >>> 0);
  // "An extension next summer" has to be delivered by now.
  for (const pr of loadPromises().filter(x => x.yr === L.season.currentYear - 1 && x.v === 'commit' && (x.kind === 'ext' || x.kind === 'pay') && x.src === 'option')) {
    const team = L.teams.find(t => t.id === pr.tid), p = team?.roster.find(x => x.id === pr.pid);
    if (!team || !p || !isUserTeam(team)) continue;
    const sg = st.talks[p.id]?.signed;
    const kept = sg && (pr.kind === 'pay' ? sg.sal >= extAsk(p, team).sal : sg.yrs >= 3);
    if (!kept) breakPromise(L, p, team, pr, `You promised ${PROMISE_TEXT[pr.kind]} and didn't deliver.`);
  }
  const list = [];
  for (const t of L.teams.filter(tt => !isUserTeam(tt))) {
    const status = teamStatus(L, t);
    for (const p of extEligible(L, t)) {
      const lv = shownLevel(p);
      if (lv < (p.age <= 25 ? 74 : 78)) continue;
      const a = extAsk(p, t);
      let odds = a.mood === 'market' ? 0.08 : a.mood === 'eager' ? 0.45 : 0.28;
      if (status === 'rebuilding' && p.age >= 28) odds *= 0.4;
      if (FA.capSystemOn() && FA.taxStance(L, t) !== 'pay' && FA.teamCommitted(t) > FA.capLines(L).tax * 0.95 && lv < 84) odds *= 0.3;
      if (status === 'contending' && lv >= 80) odds += 0.15;
      if (p.age >= 32) odds *= 0.5;
      if (rng() < odds) {
        // Around market value, and a young player on the rise doesn't take
        // a pay cut. Veterans and rising young players often get a player
        // option on the last year.
        const sal = Math.max(Math.round(a.sal / 1.1), p.age <= 29 ? Math.round(p.contract.sal * 0.95) : 0);
        const yrs = a.yrs[0] + Math.floor(rng() * (a.yrs[1] - a.yrs[0] + 1));
        const rising = p.age <= 25 && a.proj > lv;
        const opt = yrs >= 5 ? (rng() < 0.6 ? FA.OPT_PLAYER : FA.OPT_TEAM) : yrs > 1 && rng() < (p.age >= 30 ? 0.55 : rising ? 0.6 : 0.2) ? FA.OPT_PLAYER : 0;
        const deal = { sal: Math.min(FA.maxSalary(L, p, true), sal), yrs, opt, ntc: a.ntc };
        signExtension(L, t, p, deal, true);
        list.push({ name: playerName(p), team: t.shortName, sal: deal.sal, yrs: deal.yrs, opt, lv });
      }
    }
  }
  list.sort((a, b) => b.sal * b.yrs - a.sal * a.yrs);
  st.done = true;
  st.log = { mine: Object.values(st.talks).filter(x => x.signed).length, cpu: list.length, list };
  saveExtStore();
  state.dirty = true;
  render();
  toast('Extension window closed', `${list.length} extensions around the league`);
};

// ---------------------------------------------------------------------------
// College: Season in Review.
function reviewHeadline(r, t) {
  const st = r.row?.seasonStats || {};
  const W = st.W || 0, Lo = st.L || 0, p = W / Math.max(1, W + Lo);
  if (r.pro) {
    if (r.won) return `${t.city} are champions.`;
    if (r.round >= r.rounds && r.rounds) return `${t.city} made the Finals and came up short.`;
    if (r.round >= r.rounds - 1 && r.rounds) return `A run to the Conference Finals for ${t.city}.`;
    if (r.round) return p >= 0.6 ? `A strong season that ended too soon: ${r.finish.toLowerCase()}.` : `${t.city} made the playoffs and went out in ${r.finish.replace('Lost in ', '')}.`;
    return p >= 0.5 ? `A winning record, but no playoffs for ${t.city}.` : 'A losing season and no playoffs. Rebuilding starts now.';
  }
  if (r.won) return `${t.city} are national champions.`;
  if (r.round >= r.rounds - 1 && r.rounds) return `A Final Four run for ${t.city}.`;
  if (r.round >= 3) return `${t.city} made a real March run before it ended in ${r.finish.replace('Lost in ', '')}.`;
  if (r.round) return p >= 0.6 ? `A strong season that ended too soon: ${r.finish.toLowerCase()}.` : `${t.city} snuck into the tournament and went out in ${r.finish.replace('Lost in ', '')}.`;
  return p >= 0.5 ? `A winning record, but no tournament for ${t.city}.` : `A losing season and no tournament. Rebuilding starts now.`;
}
screens.review = () => {
  const L = league();
  const t = L.teams.find(isUserTeam);
  if (!t) { layout({ title: 'Season in Review', body: `<p class="note">Pick your ${isCollege() ? 'school' : 'team'} first.</p>` }); return; }
  const r = seasonReview(state.data, state.leagueIdx, t);
  const st = r.row?.seasonStats || {};
  const [c1, c2] = (t.teamColors || []).map(c => /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : null);
  const f1 = x => x.toFixed(1);
  const wl = a => (a ? `${a[0]}-${a[1]}` : '—');
  const s = r.stats;
  const tag = n => n.team != null ? ` <span class="muted">(${['1st', '2nd', '3rd'][n.team] || ''} team)</span>` : '';
  const pRow = (p, right) => `<div class="drill-row tap" data-act="openPlayer" data-id="${p.id}"><span class="grow"><b>${esc(playerName(p))}</b> ${lvTag(p)}</span><span class="small" style="text-align:right">${right}</span></div>`;
  // One award per row: the award on top, the winner under it, nothing cut off.
  const awRow = (name, p) => `<div class="drill-row tap" data-act="openPlayer" data-id="${p.id}"><span class="grow"><b>${esc(name)}</b><br><span class="small">${esc(playerName(p))} ${lvTag(p)}</span></span></div>`;
  const rk = k => r.ranks?.[k] ? `<span class="rk-of">${ordinal(r.ranks[k])}</span>` : '';
  layout({
    title: 'Season in Review',
    body: `<div class="outlook" ${c1 ? `style="--tc1:${c1};--tc2:${c2 || c1}"` : ''}>
        <div class="outlook-top ${c1 ? 'tc' : ''}">${logoImg(t)}<b>${esc(t.city)} ${esc(t.name)}</b><span class="status s-${r.won ? 'favorites' : r.round ? 'contending' : 'rebuilding'}">${r.yr}</span></div>
        <p class="note" style="padding:8px 10px 0"><b>${st.W || 0}-${st.L || 0}</b> · ${esc(r.finish)}${r.seed && !r.pro ? ` · No. ${r.seed} overall seed` : ''}</p>
        <p class="note small" style="padding:4px 10px 10px">${esc(reviewHeadline(r, t))}</p>
      </div>
      ${s ? `<fieldset class="frame"><legend>The Season</legend>
        <div class="stat-grid">
          <div><b>${f1(s.ppg)}</b><span>PPG</span>${rk('ppg')}</div><div><b>${f1(s.opp)}</b><span>Opp PPG</span>${rk('opp')}</div><div><b class="${s.ppg >= s.opp ? 'up' : 'down'}">${s.ppg >= s.opp ? '+' : ''}${f1(s.ppg - s.opp)}</b><span>Margin</span>${rk('margin')}</div>
          <div><b>${f1(s.fg)}%</b><span>FG</span>${rk('fg')}</div><div><b>${f1(s.tp)}%</b><span>3PT</span>${rk('tp')}</div><div><b>${f1(s.ft)}%</b><span>FT</span>${rk('ft')}</div>
        </div>
        <p class="note small" style="margin-top:8px">${r.pro ? `Division ${wl(s.div)}` : `Conference ${wl(s.conf)}`} · Home ${wl(s.home)} · Road ${wl(s.away)}${r.pro ? '' : ` · vs Top 25 ${wl(s.top25)}`}</p>
      </fieldset>` : ''}
      <fieldset class="frame"><legend>Team Leaders</legend><div class="stack">${r.leaders.map(x => pRow(x.p, `${esc(x.label)}<br><b>${f1(x.v)}</b>`)).join('') || '<p class="note small muted">No stats.</p>'}</div></fieldset>
      ${r.mine.length ? `<fieldset class="frame"><legend>Your Awards</legend><div class="stack">${r.mine.map(w => awRow(`🏅 ${w.name}${w.team != null ? ` (${['1st', '2nd', '3rd'][w.team] || ''} team)` : ''}`, w.p)).join('')}</div></fieldset>` : ''}
      <fieldset class="frame"><legend>${r.pro ? 'League' : 'National'} Picture</legend>
        ${r.champ ? `<div class="drill-row"><span class="grow">${logoImg(r.champ)} <b>${esc(r.champ.city)} ${esc(r.champ.name)}</b><br><span class="small muted">${r.pro ? 'Champions' : 'National champions'}${r.runnerUp ? `, over ${esc(r.runnerUp.city)}${r.finalsScore ? ` ${r.finalsScore}` : ''}` : ''}</span></span><span>🏆</span></div>` : ''}
        ${r.finalsMvp ? awRow(r.finalsMvp.name, r.finalsMvp.p) : ''}
        ${r.semis.length ? `<p class="note small" style="margin-top:6px">${r.pro ? 'Conference Finals' : 'Final Four'}: ${r.semis.map(([a, b]) => `<b class="${a === t ? 'gold' : ''}">${esc(a.shortName)}</b> v <b class="${b === t ? 'gold' : ''}">${esc(b.shortName)}</b>`).join(' · ')}</p>` : ''}
        <h4 class="ov-h">Awards</h4><div class="stack">${r.national.map(w => awRow(w.name, w.p)).join('') || '<p class="note small muted">None recorded.</p>'}</div>
        ${r.allTeams.length ? `<h4 class="ov-h">First Teams</h4><div class="stack">${[...new Set(r.allTeams.map(w => w.name))].map(n => `<p class="note small"><b>${esc(n)}:</b> ${r.allTeams.filter(w => w.name === n).map(w => esc(playerName(w.p))).join(', ')}</p>`).join('')}</div>` : ''}
      </fieldset>
      <fieldset class="frame"><legend>${esc(r.division || 'Division')} Standings</legend>
        <div class="stack">${r.standings.map((x, i) => `<div class="stand-row ${x.t === t ? 'mine' : ''}"><span class="small muted">${i + 1}</span>${logoImg(x.t)}<span class="grow small"><b>${esc(x.t.shortName)}</b></span><span class="small">${x.W}-${x.L}</span><span class="small muted">${x.cW}-${x.cL} conf</span></div>`).join('')}</div>
      </fieldset>`,
    action: isStep('review') ? { act: 'reviewDone', label: 'Wrap Up the Season' } : null,
  });
};
actions.reviewDone = () => { calFlags().review = true; goHome(); nextUp(); };

// College: Draft Departures.
screens.departures = () => {
  const L = league();
  const t = L.teams.find(isUserTeam);
  const all = draftDepartures(state.data, state.leagueIdx);
  const drafted = all.filter(x => x.pick), undrafted = all.filter(x => !x.pick);
  const r1 = drafted.filter(x => x.pick.rd === 1).length;
  const byCls = ['Freshman', 'Sophomore', 'Junior', 'Senior'].map(c => [c, all.filter(x => x.cls === c).length]).filter(x => x[1]);
  const mine = all.filter(x => x.school === t);
  const bySchool = [...all.reduce((m, x) => (x.school ? m.set(x.school, (m.get(x.school) || 0) + 1) : m), new Map())].sort((a, b) => b[1] - a[1]);
  const myRank = bySchool.findIndex(([sc]) => sc === t) + 1;
  const f1 = v => v.toFixed(1);
  const row = x => `<div class="drill-row ${x.school === t ? 'r1' : ''}"><span class="pk" style="min-width:34px">${x.pick ? `#${x.pick.pk}` : 'UDFA'}</span>
    <span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)} <span class="stars">${stars(x.p.pot)}</span><br>
    <span class="small muted">${esc(posName(x.p))} · ${x.p.age}y · ${x.cls} · ${esc(x.school?.shortName || '?')}${x.line ? ` · ${f1(x.line.ppg)}/${f1(x.line.rpg)}/${f1(x.line.apg)}` : ''}</span></span>
    <span class="small" style="text-align:right">${x.pro ? `${logoImg(x.pro)}<br>${esc(x.pro.shortName)}` : '<span class="muted">Unsigned</span>'}</span></div>`;
  layout({
    title: 'Draft Decisions',
    body: `<p class="note small"><b>${all.length}</b> players left the ${esc(L.shortName || 'college')} for the pros: <b>${drafted.length}</b> drafted (${r1} in the first round)${undrafted.length ? ` and ${undrafted.length} undrafted` : ''}: ${byCls.map(([c, n]) => `${n} ${c === 'Freshman' ? (n > 1 ? 'freshmen' : 'freshman') : c.toLowerCase() + (n > 1 ? 's' : '')}`).join(', ')}.</p>
      <fieldset class="frame"><legend>${esc(t ? t.shortName : 'Your School')}</legend>${mine.length ? `<div class="stack">${mine.map(row).join('')}</div>` : `<p class="note small muted">Nobody left ${esc(t?.city || 'your school')} for the pros this year.</p>`}
        ${myRank ? `<p class="note small" style="margin-top:6px">${myRank === 1 ? 'The most' : `No. ${myRank} in`} players sent to the pros this year.</p>` : ''}</fieldset>
      <fieldset class="frame"><legend>Pro Pipeline</legend><div class="stack">${bySchool.slice(0, 8).map(([sc, n], i) => `<div class="stand-row ${sc === t ? 'mine' : ''}"><span class="small muted">${i + 1}</span>${logoImg(sc)}<span class="grow small"><b>${esc(sc.shortName)}</b></span><span class="small">${n} player${n > 1 ? 's' : ''}</span></div>`).join('')}</div></fieldset>
      <fieldset class="frame"><legend>The Draft Class</legend><div class="stack">${drafted.map(row).join('')}${undrafted.map(row).join('')}</div>
        <p class="note muted small" style="margin-top:6px">Last line: his final college season (points/rebounds/assists).</p></fieldset>`,
    action: isStep('departures') ? { act: 'departuresDone', label: 'Wrap Up Departures' } : null,
  });
};
actions.departuresDone = () => { calFlags().departures = true; goHome(); nextUp(); };

// College: Senior Send-off.
screens.seniors = () => {
  const L = league();
  const t = L.teams.find(isUserTeam);
  if (!t) { layout({ title: 'Senior Send-off', body: '<p class="note">Pick your school first.</p>' }); return; }
  const r = seniorSendoff(state.data, state.leagueIdx, t);
  const f1 = v => v.toFixed(1);
  const cline = c => `${c.gp} games · ${f1(c.ppg)}/${f1(c.rpg)}/${f1(c.apg)} · ${c.pts} pts`;
  const gRow = g => `<div class="drill-row ${g.school === t ? 'r1' : ''}"><span class="grow"><b>${esc(playerName(g.p))}</b> <span class="small muted">${esc(posName(g.p))}</span><br>
      <span class="small muted">${esc(g.school?.shortName || '?')} · ${cline(g.career)}</span></span>
      <span class="small" style="text-align:right">${esc(g.outcome)}${g.pro ? `<br>${esc(g.pro.shortName)}` : ''}</span></div>`;
  layout({
    title: 'Senior Send-off',
    body: `<fieldset class="frame"><legend>Your Graduates</legend>${r.mineGrads.length ? `<div class="stack">${r.mineGrads.map(gRow).join('')}</div>` : `<p class="note small muted">No seniors graduated from ${esc(t.city)} last season.</p>`}</fieldset>
      <fieldset class="frame"><legend>The Last Dance</legend>
        ${r.rising.length ? `<p class="note small">Back for one more year:</p><div class="stack">${r.rising.map(x => `<div class="drill-row tap" data-act="openPlayer" data-id="${x.p.id}"><span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)}<br>
          <span class="small muted">${esc(posName(x.p))} · ${x.p.age}y · ${cline(x.career)}</span>
          ${x.awards.length || x.records ? `<br><span class="small gold">${esc([...r.awardNames(x.awards), x.records ? `${x.records} league record${x.records > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '))}</span>` : ''}</span></div>`).join('')}</div>` : '<p class="note small muted">No seniors on next year\'s roster.</p>'}
      </fieldset>
      ${r.records.length ? `<fieldset class="frame"><legend>Records Your Players Hold</legend><div class="stack">${r.records.map(x => `<p class="note small">🏅 <b>${esc(playerName(x.p))}</b>: ${x.value} ${esc(x.stat)} in a game (${x.yr}), No. ${x.rank} all-time</p>`).join('')}</div></fieldset>` : ''}
      <fieldset class="frame"><legend>Class of ${r.yr}</legend><p class="note small muted">The league's notable graduates, by career points.</p><div class="stack">${r.grads.slice(0, 15).map(gRow).join('') || '<p class="note small muted">None on record.</p>'}</div></fieldset>`,
    action: isStep('seniors') ? { act: 'seniorsDone', label: 'Wrap Up the Send-off' } : null,
  });
};
actions.seniorsDone = () => { calFlags().seniors = true; goHome(); nextUp(); };

// ---- College recruiting, run by the app (recruiting.js) in place of the
// game's. The market (offers, interest, commitments) is kept per save and
// season; the class is rebuilt from its seed on every load.
const rmKey = () => `hlc:rm:${league().shortName}:${league().meta?.saveName || ''}:${league().season.currentYear}`;
// The save the app recruits from: day 1 of the game's signing period
// (phase 6), after the game has played its showcase and before anyone signs.
const recruitableSave = () => { const s = league().season; return s.phase === 6 && (s.currentDay || 1) <= 1 && !(s.news || []).some(n => n.type === 14); };
function market() {
  if (!isCollege()) return null;
  const key = rmKey();
  if (state.rm?.key === key) return state.rm.M;
  let M = null;
  try { M = JSON.parse(localStorage.getItem(key)) || null; } catch { M = null; }
  if (!M && recruitableSave()) M = RC.newMarket(league());
  state.rm = { key, M, cls: null };
  saveMarket();
  return M;
}
function saveMarket() { if (state.rm?.M) try { localStorage.setItem(state.rm.key, JSON.stringify(state.rm.M)); } catch { /* ignore */ } }
function rclass() {
  const M = market();
  if (!M) return null;
  if (!state.rm.cls) {
    state.rm.cls = RC.buildClass(league(), state.leagueIdx, M);
    // CPU schools put out their first offers when the period opens.
    if (!M.opened && M.week === 1) { RC.openMarket(league(), M, state.rm.cls, new Set(league().teams.filter(isUserTeam).map(x => x.id))); saveMarket(); }
  }
  return state.rm.cls;
}
const userSchool = () => league().teams.find(isUserTeam);
// Recruit stars; with his level, gold fills to where he is now and white
// is the rest of his star rating still to reach (always 5 slots wide, so
// whatever follows lines up).
const rStars = (n, lv) => lv == null ? `<span class="gold">${'★'.repeat(n)}</span>` : `<span class="stars">${stars(n * 2, Math.min(n, levelStarsOf(lv) / 2))}</span>`;
const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const MOTIVE = { nil: 'NIL money', win: 'Winning', home: 'Staying close to home', pt: 'Playing time' };
const PITCH_ICON = Object.fromEntries(RC.PITCHES.map(p => [p.k, p.icon]));

// Signing Day results into the save (and again on a fresh load of the same
// offseason save). Returns how many were added.
function applyRecruiting() {
  const M = market();
  if (!M || M.week <= RC.WEEKS || !recruitableSave()) return 0;
  const added = RC.applySignings(state.data, state.leagueIdx, M, rclass());
  for (const p of added) state.snaps.set(snapKey(p.id, state.leagueIdx), snapshot(p));
  saveMarket();
  if (added.length) state.dirty = true;
  return added.length;
}
function recruitCtx() {
  const M = market(), cls = rclass(), t = userSchool();
  const S = M ? RC.schoolsOf(league(), M, cls) : null;
  return { M, cls, t, S, me: t && S ? S.byId.get(t.id) : null };
}
function recruitStatus(x, c) {
  const { M, t, S } = c;
  const tid = M.commit[x.id];
  if (tid !== undefined) { const s = S.byId.get(tid); return `<span class="${tid === t.id ? 'up' : 'muted'}">✍️ ${s ? `${logoImg(s.t)} ${esc(s.t.shortName)}` : '?'}</span>`; }
  const rc = RC.race(x, S, M);
  const i = rc.findIndex(e => e.s.id === t.id);
  if (i === 0) return `<span class="up">You lead · ${rc[0].pct}%</span>`;
  if (i > 0) return `<span class="gold">You're ${ordinal(i + 1)} · ${rc[i].pct}%</span><br><span class="muted">${esc(rc[0].s.t.shortName)} ${rc[0].pct}%</span>`;
  if (rc.length) return `<span class="muted">${rc.length} offer${rc.length > 1 ? 's' : ''}<br>${esc(rc[0].s.t.shortName)} leads</span>`;
  return '<span class="muted">No offers</span>';
}
const noMarket = title => layout({ title, body: '<p class="note">The app runs recruiting from your save on Day 1 of the game\'s signing period (after the game plays its showcase, before anyone signs). Load that save to recruit.</p>' });

// All-American Showcase: the top 20 of the class, East vs West.
const aaKey = () => `hlc:aa:${league().shortName}:${league().meta?.saveName || ''}:${league().season.currentYear}`;
function aaStore() { try { return JSON.parse(localStorage.getItem(aaKey())) || {}; } catch { return {}; } }
const isAllAmerican = p => isCollege() && (aaStore().ids || []).includes(p.id);
screens.showcase = () => {
  const M = market(), cls = rclass();
  if (!M) { noMarket('All-American Showcase'); return; }
  const sc = M.showcase;
  const top = cls.hs.slice(0, 20).sort((a, b) => b.p.loc.y - a.p.loc.y);
  const ids = sc ? [sc.east, sc.west] : [top.slice(0, 10).map(x => x.id), top.slice(10).map(x => x.id)];
  const side = (name, list, i) => `<fieldset class="frame"><legend>${name}${sc ? ` · ${sc.score[i]}` : ''}</legend>
    ${sc ? '<div class="box-head small muted"><span class="grow">Player</span><span>MIN</span><span>PTS</span><span>REB</span><span>AST</span><span>FG</span></div>' : ''}
    <div class="stack">${list.map(id => cls.byId.get(id)).filter(Boolean).sort((a, b) => (sc ? sc.box[b.id].pts - sc.box[a.id].pts : a.rank - b.rank)).map(x => {
      const b = sc?.box[x.id];
      return `<div class="${sc ? 'box-row' : 'drill-row'} tap ${sc?.mvp === x.id ? 'mvp' : ''}" data-act="openRecruit" data-id="${x.id}"><span class="grow"><b>${esc(playerName(x.p))}</b>${sc?.mvp === x.id ? ' 🏆' : ''}<br><span class="small muted">No. ${x.rank} · ${esc(posName(x.p))} · ${esc(x.city)}, ${x.st}</span> ${rStars(x.stars, x.lv)}</span>
        ${b ? `<span class="small">${b.min}</span><span><b>${b.pts}</b></span><span class="small">${b.reb}</span><span class="small">${b.ast}</span><span class="small muted">${b.fgm}-${b.fga}</span>` : ''}</div>`;
    }).join('')}</div></fieldset>`;
  const mvp = sc && cls.byId.get(sc.mvp);
  layout({
    title: 'All-American Showcase',
    body: `${sc ? `<div class="score-card"><div><b>East</b><span class="big-n ${sc.score[0] > sc.score[1] ? 'up' : ''}">${sc.score[0]}</span></div><span class="muted">vs</span><div><b>West</b><span class="big-n ${sc.score[1] > sc.score[0] ? 'up' : ''}">${sc.score[1]}</span></div></div>
      ${mvp ? `<p class="note center">🏆 MVP: <b>${esc(playerName(mvp.p))}</b> (${sc.east.includes(mvp.id) ? 'East' : 'West'}): ${sc.box[mvp.id].pts} pts, ${sc.box[mvp.id].reb} reb, ${sc.box[mvp.id].ast} ast</p>` : ''}`
      : `<p class="note small">The top 20 in the class of ${cls.hs.length}: the 10 from furthest east against the 10 from furthest west.</p>`}
      ${side('East', ids[0], 0)}${side('West', ids[1], 1)}
      <p class="note muted small">Every player here carries an All-American tag into recruiting.</p>`,
    action: !sc ? { act: 'playShowcase', label: 'Play the Showcase' } : isStep('showcase') ? { act: 'showcaseDone', label: 'Wrap Up the Showcase' } : null,
  });
};
actions.playShowcase = () => {
  const M = market();
  if (!M) return;
  const sc = M.showcase || RC.playShowcase(M, rclass());
  saveMarket();
  const mvp = rclass().byId.get(sc.mvp);
  try { localStorage.setItem(aaKey(), JSON.stringify({ ids: [...sc.east, ...sc.west], mvp: mvp ? playerName(mvp.p) : null, mvpId: sc.mvp, score: sc.score })); } catch { /* ignore */ }
  render();
};
actions.showcaseDone = () => { if (market() && !market().showcase) actions.playShowcase(); calFlags().showcase = true; goHome(); nextUp(); };
actions.openRecruit = d => go('recruitee', { id: +d.id });
actions.stepRecruit = d => replace('recruitee', { id: +d.id });

// Recruiting board.
screens.recruit = (args = {}) => {
  const t = userSchool();
  if (!t) { layout({ title: 'Recruiting', body: '<p class="note">Pick your school first.</p>' }); return; }
  const M = market();
  if (!M) { noMarket('Recruiting'); return; }
  const c = recruitCtx();
  const { cls, me, S } = c;
  const view = ['hs', 'tr', 'mine', 'news', 'classes'].includes(args.view) ? args.view : 'hs';
  const fs = +args.stars || 0, fg = args.g || '';
  const lim = +args.n || 50;
  const u = RC.usedThisWeek(M, t.id);
  const done = M.week > RC.WEEKS;
  const mineIds = new Set([...Object.entries(M.offers).filter(([, o]) => o[t.id] !== undefined).map(([id]) => +id), ...Object.entries(M.commit).filter(([, v]) => v === t.id).map(([id]) => +id), ...Object.keys(M.acts).map(Number)]);
  const row = x => `<div class="drill-row tap ${M.offers[x.id]?.[t.id] !== undefined || M.commit[x.id] === t.id ? 'r1' : ''}" data-act="openRecruit" data-id="${x.id}"><span class="grow"><span class="rank-no">${x.transfer ? 'T-' : ''}${x.rank}</span><b>${esc(playerName(x.p))}</b> ${rStars(x.stars, x.lv)}${isAllAmerican(x.p) ? ' <span class="small gold">⭐ AA</span>' : ''}<br>
      <span class="small muted">${esc(posName(x.p))} · ${heightStr(x.p.ht)} · Lv ${x.lv} · ${x.transfer ? `${classOf(x.p.yrs ?? 0)} transfer` : `${esc(x.city)}, ${x.st}`} · ${Math.round(RC.miles(x.p.loc, t.location))} mi</span></span>
    <span class="small" style="text-align:right;max-width:40%">${recruitStatus(x, c)}</span></div>`;
  let body = '';
  if (view === 'hs' || view === 'tr' || view === 'mine') {
    let list = view === 'hs' ? cls.hs : view === 'tr' ? cls.tr : cls.all.filter(x => mineIds.has(x.id));
    if (fs) list = list.filter(x => x.stars === fs);
    if (fg) list = list.filter(x => RC.GROUP(x.p) === fg);
    // The list a recruit page steps through with ◀ ▶.
    state.recruitNav = list.map(x => x.id);
    const chip = (k, v, label) => `<button class="btn small ${String(args[k] || '') === String(v) ? 'on focus' : 'off'}" data-act="recruitFilter" data-k="${k}" data-v="${v}">${label}</button>`;
    body = `${view !== 'mine' ? `<div class="tabs fa-tabs" style="grid-template-columns:repeat(5,1fr)">${chip('stars', '', 'All ★')}${[5, 4, 3, 2].map(n => chip('stars', n, `${n}★`)).join('')}</div>
      <div class="tabs fa-tabs" style="grid-template-columns:repeat(4,1fr);margin-top:4px">${chip('g', '', 'All')}${['Guards', 'Wings', 'Bigs'].map(g => chip('g', g, g)).join('')}</div>` : ''}
      <div class="stack">${list.slice(0, lim).map(row).join('') || `<p class="note small muted">${view === 'mine' ? 'Nobody yet. Open a recruit to offer, call or visit.' : 'Nobody here.'}</p>`}</div>
      ${list.length > lim ? `<button class="btn small" data-act="recruitMore" style="margin-top:6px">Show more (${list.length - lim} left)</button>` : ''}`;
  } else if (view === 'news') {
    const nm = id => { const x = cls.byId.get(id); return x ? `<b>${esc(playerName(x.p))}</b> ${rStars(x.stars, x.lv)} <span class="muted">${x.transfer ? 'transfer' : `No. ${x.rank}`}</span>` : '?'; };
    const sch = tid => S.byId.get(tid)?.t;
    body = [...M.log].reverse().map(e => {
      const items = [...e.commits, ...e.signed].sort((a, b) => cls.byId.get(a.id).rank - cls.byId.get(b.id).rank);
      return `<fieldset class="frame"><legend>${e.week === RC.WEEKS ? 'Signing Day' : `Week ${e.week}`}</legend><div class="stack">
        ${e.flips.map(f => `<p class="note small ${f.to === t.id ? 'up' : f.from === t.id ? 'down' : ''}">🔄 ${nm(f.id)} flips from ${esc(sch(f.from)?.shortName || '?')} to ${esc(sch(f.to)?.shortName || '?')}</p>`).join('')}
        ${items.slice(0, 40).map(i => `<p class="note small ${i.to === t.id ? 'up' : ''}">✍️ ${nm(i.id)} → ${logoImg(sch(i.to))} ${esc(sch(i.to)?.shortName || '?')}</p>`).join('') || '<p class="note small muted">No commitments.</p>'}
        ${items.length > 40 ? `<p class="note small muted">…and ${items.length - 40} more.</p>` : ''}
        ${e.late.length ? `<p class="note small muted">${e.late.length} late signings filled out rosters.</p>` : ''}</div></fieldset>`;
    }).join('') || '<p class="note small muted">No news yet. Commitments come in at the end of each week.</p>';
  } else {
    const rk = RC.classRankings(M, cls, S);
    body = `<div class="stack">${rk.slice(0, 30).map(r => `<div class="stand-row ${r.s.t === t ? 'mine' : ''}"><span class="small muted">${r.rank}</span>${logoImg(r.s.t)}<span class="grow small"><b>${esc(r.s.t.shortName)}</b> <span class="muted">${r.list.length} · ${r.list.filter(x => x.stars >= 4).length} 4★+</span></span><span class="small">${r.list.slice(0, 3).map(x => rStars(x.stars)).join(' ')}</span></div>`).join('') || '<p class="note small muted">No commitments yet.</p>'}</div>
      ${rk.find(r => r.s.t === t)?.rank > 30 ? `<p class="note small muted">${esc(t.shortName)}: No. ${rk.find(r => r.s.t === t).rank}.</p>` : ''}`;
  }
  const rk = RC.classRankings(M, cls, S).find(r => r.s.t === t);
  const views = [['hs', 'High School'], ['tr', 'Transfers'], ['mine', 'Your Board'], ['news', 'News'], ['classes', 'Classes']];
  const g = ['Guards', 'Wings', 'Bigs'].map(k => `${k} ${me.groups[k].length}/${{ Guards: 4, Wings: 3, Bigs: 3 }[k]}`).join(' · ');
  layout({
    title: done ? 'Recruiting · Signed' : M.week === RC.WEEKS ? 'Recruiting · Week 4' : `Recruiting · Week ${M.week}`,
    body: `<fieldset class="frame"><legend>${done ? 'Signing Day is done' : M.week === RC.WEEKS ? 'Week 4 of 4 · ends with Signing Day' : `Week ${M.week} of ${RC.WEEKS}`}</legend>
        <div class="stat-grid"><div><b>${me.seats}</b><span>Open spots</span></div><div><b>$${(me.budget - me.spent).toFixed(1).replace('.0', '')}M</b><span>NIL left of $${me.budget}M</span></div><div><b>${rk ? `No. ${rk.rank}` : '—'}</b><span>Class (${rk?.list.length || 0})</span></div>
          <div><b>${RC.LIMITS.calls - u.calls}</b><span>Calls left</span></div><div><b>${RC.LIMITS.homes - u.homes}</b><span>Home visits</span></div><div><b>${RC.LIMITS.officials - u.officials}</b><span>Officials left</span></div></div>
        <p class="note small" style="margin-top:6px">${g}</p></fieldset>
      <div class="tabs fa-tabs">${views.map(([k, l]) => `<button class="btn ${k === view ? 'on focus' : 'off'}" data-act="recruitView" data-v="${k}">${l}</button>`).join('')}</div>
      ${body}
      <p class="note muted small" style="margin-top:6px">Calls and visits count at the end of the week, then recruits decide. Each one weighs NIL, winning, staying close to home and playing time differently; a call tells you how. Calls ${RC.LIMITS.calls}/week, home visits ${RC.LIMITS.homes}/week, official visits ${RC.LIMITS.officials} for the whole period.</p>`,
    action: !done && isStep(`rw${M.week}`) ? { act: 'recruitEndWeek', label: M.week === RC.WEEKS ? 'Signing Day' : `End Week ${M.week}` } : null,
  });
};
actions.recruitView = d => replace('recruit', { view: d.v });
actions.recruitFilter = d => { const a = { ...state.stack[state.stack.length - 1].args }; a[d.k] = d.v; a.n = 0; replace('recruit', a); };
actions.recruitMore = () => { const a = { ...state.stack[state.stack.length - 1].args }; a.n = (+a.n || 50) + 50; replace('recruit', a); };

// One recruit: who he is, what he wants, the race, your offer and contact.
screens.recruitee = ({ id }) => {
  const c = recruitCtx();
  const { M, cls, t, S, me } = c;
  const x = cls?.byId.get(id);
  if (!x || !t) { layout({ title: 'Recruit', body: '<p class="note">Not found.</p>' }); return; }
  const p = x.p;
  const known = M.known?.[id] || M.scouted[id];
  const scouted = M.scouted[id];
  const myNil = M.offers[id]?.[t.id];
  const rc = RC.race(x, S, M);
  const com = M.commit[id];
  const comps = RC.components(x, me, M);
  const done = M.week > RC.WEEKS;
  const u = RC.usedThisWeek(M, t.id);
  const a = M.acts[id]?.[t.id] || {};
  const offi = (M.officials[id] || []).includes(t.id);
  const amounts = [...new Set([x.ask * 0.6, x.ask, x.ask * 1.3].map(v => Math.max(0.5, Math.round(v * 2) / 2)))];
  const left = me.budget - me.spent + (myNil || 0);
  const word = v => (v >= 0.75 ? '<span class="up">strong</span>' : v >= 0.45 ? '<span class="gold">fair</span>' : '<span class="down">weak</span>');
  const mot = Object.entries(x.w).sort((m, n) => n[1] - m[1]);
  const dots = v => '●'.repeat(v >= 0.32 ? 3 : v >= 0.22 ? 2 : 1);
  const pitchRow = (kind, label, used, can) => `<p class="note small" style="margin-top:8px"><b>${label}</b>${used ? ` · <span class="up">done ${PITCH_ICON[used] || ''}</span>` : ''}</p>
    <div class="fa-tabs" style="grid-template-columns:repeat(4,1fr)">${RC.PITCHES.map(pt => `<button class="btn small" data-act="recruitAct" data-id="${id}" data-kind="${kind}" data-pitch="${pt.k}" ${used || !can || done ? 'disabled' : ''} title="${pt.label}">${pt.icon}</button>`).join('')}</div>`;
  const sch = tid => S.byId.get(tid)?.t;
  const f1 = v => v.toFixed(1);
  const line = x.transfer ? (() => { const s = seasonLine(p, state.leagueIdx, league().season.currentYear - 1); return s ? `${f1(s.ppg)}/${f1(s.rpg)}/${f1(s.apg)} in ${s.gp} games last season` : 'No college stats'; })() : `Senior year: ${f1(x.hs.ppg)} pts, ${f1(x.hs.rpg)} reb, ${f1(x.hs.apg)} ast`;
  const navIds = state.recruitNav?.includes(id) ? state.recruitNav : null;
  const at = navIds ? navIds.indexOf(id) : -1;
  const prevId = at > 0 ? navIds[at - 1] : null, nextId = navIds && at < navIds.length - 1 ? navIds[at + 1] : null;
  const navBtn = (rid, dir) => rid == null ? '' : `<button class="nav-btn" data-act="stepRecruit" data-id="${rid}" aria-label="${dir < 0 ? 'Previous' : 'Next'} recruit">${dir < 0 ? '◀' : '▶'}</button>`;
  // Strengths and weaknesses against college players at his position;
  // before a visit scouts his potential, his star rating stands in for it.
  const rep = scoutingReport(p, league(), scouted ? p.pot : ({ 5: 9, 4: 8, 3: 7, 2: 5 }[x.stars] || 6), x.transfer ? state.data.seasonLeagues : null);
  const repHtml = `<fieldset class="frame"><legend>Scouting Report</legend><ul class="scout">
    ${rep.strengths.map(r => `<li class="plus"><b>${esc(r.text)}</b><span class="muted small"> · ${esc(r.detail)}</span></li>`).join('')}
    ${rep.weaknesses.map(r => `<li class="minus"><b>${esc(r.text)}</b><span class="muted small"> · ${esc(r.detail)}</span></li>`).join('')}
    ${rep.defense ? `<li class="${rep.defense.tone}"><b>${esc(rep.defense.text)}</b><span class="muted small"> · ${esc(rep.defense.detail)}</span></li>` : ''}
  </ul></fieldset>`;
  layout({
    title: playerName(p),
    left: navBtn(prevId, -1),
    right: navBtn(nextId, 1),
    body: `<fieldset class="frame"><legend>${x.transfer ? `Transfer · No. ${x.rank}` : `Class of ${league().season.currentYear + 0} · No. ${x.rank}`}</legend>
        <p class="note"><b>${esc(playerName(p))}</b> ${rStars(x.stars, x.lv)}${isAllAmerican(p) ? ' <span class="small gold">⭐ All-American</span>' : ''}</p>
        <p class="note small">${esc(posName(p))} · ${heightStr(p.ht)} · ${p.wt} lbs · ${p.age}y · ${x.transfer ? `${classOf(p.yrs ?? 0)}, ${Math.max(1, 4 - (p.yrs ?? 0))} yr${4 - (p.yrs ?? 0) > 1 ? 's' : ''} left` : `${esc(x.city)}, ${x.st}`} · ${Math.round(RC.miles(p.loc, t.location))} mi from campus</p>
        <p class="note small">Lv ${x.lv} now · Potential ${scouted ? `<span class="stars">${stars(p.pot)}</span>` : '<span class="muted">? (a visit scouts him)</span>'}</p>
        <p class="note small muted">${line}</p>
        <div class="stat-grid cat-grid" style="margin-top:6px;grid-template-columns:repeat(6,1fr)">${SKILL_ATTRS.map(k => `<div class="c-${RATING_GROUP[k]}"><b>${p.attributes[k][0]}</b><span>${k}</span></div>`).join('')}</div></fieldset>
      ${repHtml}
      ${com !== undefined ? `<p class="note ${com === t.id ? 'up' : ''}">✍️ ${com === t.id ? 'Committed to you.' : `Committed to ${esc(sch(com)?.city || '?')}.`}${!done && com !== t.id ? ' A big push can still flip him.' : ''}</p>` : ''}
      <fieldset class="frame"><legend>What He Wants</legend>
        ${known ? `<div class="stack">${mot.map(([k, v]) => `<div class="need-row"><span class="small grow"><b>${dots(v)}</b> ${MOTIVE[k]}</span><span class="small">${esc(t.shortName)}: ${word(comps[k])}</span></div>`).join('')}</div>
          <p class="note muted small" style="margin-top:6px">NIL ${myNil ? `is your $${myNil}M against` : 'compares your offer with'} what he's looking for (about $${x.ask}M).</p>`
          : '<p class="note small muted">Call him to find out what matters to him.</p>'}</fieldset>
      <fieldset class="frame"><legend>The Race</legend><p class="note small muted" style="margin-bottom:6px">Every school with an offer fills its own bar. The first to 100% gets his commitment${x.stars >= 4 ? '; the best recruits take the most winning over' : ''}.</p><div class="stack">${rc.slice(0, 5).map(e => `<div class="race-row ${e.s.t === t ? 'mine' : ''}">${logoImg(e.s.t)}<b class="small">${esc(e.s.t.shortName)}</b><span class="race-bar"><i style="width:${e.pct}%" class="${e.pct >= 100 ? 'full' : ''}"></i></span><span class="small">${e.pct}%</span></div>`).join('') || '<p class="note small muted">No offers yet.</p>'}</div>
        ${rc.length > 5 ? `<p class="note small muted">${rc.length - 5} more offer${rc.length > 6 ? 's' : ''}.</p>` : ''}</fieldset>
      ${done ? '' : `<fieldset class="frame"><legend>Your Offer</legend>
        <p class="note small">${myNil !== undefined ? `Offered: <b>$${myNil}M</b> NIL with a scholarship.` : 'No offer yet.'} $${left.toFixed(1).replace('.0', '')}M available.</p>
        <div class="grid2">${amounts.map(v => `<button class="btn ${v === myNil ? 'on focus' : ''}" data-act="recruitOffer" data-id="${id}" data-amt="${v}" ${v > left + 1e-9 ? 'disabled' : ''}>$${v}M</button>`).join('')}
          ${myNil !== undefined && com !== t.id ? `<button class="btn" data-act="recruitPull" data-id="${id}">Pull Offer</button>` : ''}</div></fieldset>
      <fieldset class="frame"><legend>This Week</legend><p class="note small muted">Pick a pitch: 💰 NIL · 🏆 Winning · 📍 Close to home · ⏱️ Playing time.</p>
        ${pitchRow('call', `📞 Call (${RC.LIMITS.calls - u.calls} left)`, a.call, u.calls < RC.LIMITS.calls)}
        ${pitchRow('home', `🏠 Home visit (${RC.LIMITS.homes - u.homes} left)`, a.home, myNil !== undefined && u.homes < RC.LIMITS.homes)}
        ${pitchRow('official', `🏟️ Official visit (${RC.LIMITS.officials - u.officials} left)`, offi && (a.official || 'done'), myNil !== undefined && u.officials < RC.LIMITS.officials)}
        <p class="note muted small">Visits need an offer. A pitch that matches what he wants, and that your school can back up, counts more.</p></fieldset>`}`,
  });
};
actions.recruitOffer = d => {
  const { M, t, me } = recruitCtx();
  const id = +d.id, amt = +d.amt;
  const cur = M.offers[id]?.[t.id] || 0;
  if (me.spent - cur + amt > me.budget + 1e-9) { toast('Not enough NIL left', '', 2400, true); return; }
  (M.offers[id] ||= {})[t.id] = amt;
  saveMarket(); render();
};
actions.recruitPull = d => {
  const { M, t } = recruitCtx();
  const id = +d.id;
  if (M.commit[id] === t.id) { toast('He\'s committed to you', '', 2400, true); return; }
  if (M.offers[id]) delete M.offers[id][t.id];
  saveMarket(); render();
};
actions.recruitAct = d => {
  const { M, t } = recruitCtx();
  const id = +d.id;
  if (d.kind !== 'call' && M.offers[id]?.[t.id] === undefined) { toast('Offer him first', '', 2400, true); return; }
  if (!RC.act(M, id, t.id, d.kind, d.pitch)) { toast('None of those left this week', '', 2400, true); return; }
  (M.known ||= {})[id] = 1;
  saveMarket(); render();
};
actions.recruitEndWeek = async () => {
  const M = market();
  if (!M || M.week > RC.WEEKS) return;
  const w = M.week;
  if (w === RC.WEEKS && !(await confirmBox('Signing Day: every recruit still out there picks a school today, and every class is written into your save.', 'Sign Them'))) return;
  const o = overlay('<div class="spinner"></div><p class="note">Recruits are deciding…</p>');
  await nextFrame();
  M.culture = Object.fromEntries(league().teams.filter(isUserTeam).map(x => [x.id, CO.recruitMult(tierNow('culture'))]));
  RC.advanceWeek(league(), state.leagueIdx, M, rclass(), new Set(league().teams.filter(isUserTeam).map(x => x.id)));
  const n = applyRecruiting();
  saveMarket();
  o.remove();
  if (n) toast(`${n} signings written into your save`);
  if (state.stack[state.stack.length - 1].name === 'main') go('recruitweek', { w }); else replace('recruitweek', { w });
};
screens.recruitweek = ({ w }) => {
  const { M, cls, t, S } = recruitCtx();
  const e = M?.log.find(l => l.week === w);
  if (!e) { layout({ title: 'Recruiting', body: '<p class="note">No results yet.</p>' }); return; }
  const sch = tid => S.byId.get(tid)?.t;
  // Rank (T- for transfers) in the gold box, level next to the name, stars
  // on their own line (every row the same height), then position, height
  // and weight.
  const rowOf = (i, extra = '') => { const x = cls.byId.get(i.id); return `<div class="drill-row tap ${i.to === t.id ? 'r1' : ''}" data-act="openRecruit" data-id="${i.id}"><span class="grow"><span class="rank-no">${x.transfer ? 'T-' : ''}${x.rank}</span><b>${esc(playerName(x.p))}</b><br>${rStars(x.stars, x.lv)} <span class="gold small nowrap">Lv ${x.lv}</span><br><span class="small muted">${esc(posName(x.p))} · ${heightStr(x.p.ht)} · ${x.p.wt} lbs${extra}</span></span><span class="small">${logoImg(sch(i.to))} ${esc(sch(i.to)?.shortName || '')}</span></div>`; };


  const all = [...e.commits, ...e.signed].sort((a, b) => cls.byId.get(a.id).rank - cls.byId.get(b.id).rank);
  const mine = [...all, ...e.late].filter(i => i.to === t.id);
  const gained = e.flips.filter(f => f.to === t.id), lost = e.flips.filter(f => f.from === t.id);
  const rk = RC.classRankings(M, cls, S);
  const myRk = rk.find(r => r.s.t === t);
  const last = w === RC.WEEKS;
  layout({
    title: last ? 'Signing Day' : `Week ${w} Results`,
    body: `<div class="score-card"><div><b>${last ? 'Signed' : 'New for you'}</b><span class="big-n ${mine.length + gained.length ? 'up' : ''}">${last ? (myRk?.list.length || 0) : mine.length + gained.length}</span></div><div><b>Class rank</b><span class="big-n">${myRk ? myRk.rank : '—'}</span></div></div>
      ${gained.length || lost.length ? `<fieldset class="frame"><legend>Flips</legend><div class="stack">${gained.map(f => rowOf(f, ` · flipped from ${esc(sch(f.from)?.shortName || '?')}`)).join('')}${lost.map(f => rowOf(f, ' · <span class="down">decommitted from you</span>')).join('')}</div></fieldset>` : ''}
      <fieldset class="frame"><legend>${last ? 'Your Class' : 'Your Commitments'}</legend><div class="stack">${(last ? (myRk?.list || []).map(x => ({ id: x.id, to: t.id })) : mine).map(i => rowOf(i)).join('') || '<p class="note small muted">None this week.</p>'}</div></fieldset>
      <fieldset class="frame"><legend>${last ? 'Signing Day Decisions' : 'Around the Country'}</legend><div class="stack">${all.slice(0, 15).map(i => rowOf(i)).join('') || '<p class="note small muted">Nobody committed this week.</p>'}</div>
        ${all.length > 15 ? `<p class="note small muted">${all.length - 15} more on the News tab.</p>` : ''}${e.late.length ? `<p class="note small muted">${e.late.length} late signings filled out rosters.</p>` : ''}</fieldset>
      <fieldset class="frame"><legend>Top Classes</legend><div class="stack">${rk.slice(0, 10).map(r => `<div class="stand-row ${r.s.t === t ? 'mine' : ''}"><span class="small muted">${r.rank}</span>${logoImg(r.s.t)}<span class="grow small"><b>${esc(r.s.t.shortName)}</b> <span class="muted">${r.list.length} · ${r.list.filter(x => x.stars >= 4).length} 4★+</span></span></div>`).join('')}</div></fieldset>
      ${last ? '<p class="note small">Every class is on its roster now. The game\'s own recruiting pool and offers were cleared, so its signing days pass with nobody left to sign.</p>' : ''}`,
    action: { act: 'recruitBack', label: M.week > RC.WEEKS ? 'Back to the Calendar' : 'Recruiting Board' },
  });
};
actions.recruitBack = () => { if (market()?.week > RC.WEEKS) { goHome(); nextUp(); } else replace('recruit', {}); };

// College: Signing Class Grades (the app's recruiting when it ran it).
function signingNow() {
  const M = market();
  const own = M?.applied ? { commits: Object.entries(M.commit).map(([pid, tid]) => ({ pid: +pid, tid })), transfers: new Set(M.transferIds || []) } : null;
  return signingClasses(state.data, state.leagueIdx, new Set(aaStore().ids || []), shownLevel, own);
}
screens.signing = () => {
  const L = league();
  const t = L.teams.find(isUserTeam);
  if (!t) { layout({ title: 'Signing Classes', body: '<p class="note">Pick your school first.</p>' }); return; }
  const r = signingNow();
  const mine = r.byTeam.get(t.id);
  const needs = rosterNeedsCollege(t, 15);
  const gradeCls = g => (g[0] === 'A' ? 'up' : g[0] === 'B' ? 'gold' : g[0] === 'C' ? '' : 'down');
  const pRow = x => `<div class="drill-row tap" data-act="openPlayer" data-id="${x.p.id}"><span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)} <span class="stars">${stars(x.p.pot)}</span>${x.aa ? ' <span class="small gold">⭐ AA</span>' : ''}<br>
    <span class="small muted">${esc(posName(x.p))} · ${x.p.age}y · ${x.transfer ? `Transfer · ${4 - (x.p.yrs ?? 0)} yrs left` : 'Freshman'} · $${x.p.contract?.sal || 0}M</span></span></div>`;
  const best = r.list[0];
  const steal = [...r.list].filter(c => c.team && c.players.length).sort((a, b) => (b.score / Math.max(1, b.team.prestigePoints + 20)) - (a.score / Math.max(1, a.team.prestigePoints + 20)))[0];
  layout({
    title: 'Signing Classes',
    body: `<fieldset class="frame"><legend>Your Class</legend>
        ${mine ? `<div class="grade-hero"><span class="grade-big ${gradeCls(mine.grade)}">${mine.grade}</span><span class="small">No. ${mine.rank} of ${r.list.length} · ${mine.players.length} signee${mine.players.length > 1 ? 's' : ''} · ${(mine.stars / 2).toFixed(1)}★ total</span></div>
          <div class="stack">${mine.players.map(pRow).join('')}</div>` : `<p class="note small muted">${esc(t.city)} didn't sign anyone this year.</p>`}
        <h4 class="ov-h">Still Open</h4>
        <p class="note small">${t.roster.length} on the roster · ${needs.open} open scholarship${needs.open === 1 ? '' : 's'}${needs.short.some(n => n.short) ? ` · short at ${needs.short.filter(n => n.short).map(n => `${n.g.toLowerCase()} (${n.short})`).join(', ')}` : ' · every position covered'}</p>
      </fieldset>
      ${best ? `<fieldset class="frame"><legend>Headlines</legend>
        <p class="note small">🏆 <b>Top class:</b> ${esc(best.team?.city || best.team?.shortName || '?')} (${best.grade}): ${best.players.slice(0, 3).map(x => esc(playerName(x.p))).join(', ')}${best.players.length > 3 ? ` and ${best.players.length - 3} more` : ''}.</p>
        ${steal && steal !== best ? `<p class="note small">💎 <b>Overachiever:</b> ${esc(steal.team.city || steal.team.shortName)} (prestige ${steal.team.prestigePoints}) signed ${/^[AF]/.test(steal.grade) ? 'an' : 'a'} ${steal.grade} class.</p>` : ''}
        ${r.noClass.length ? `<p class="note small muted">${r.noClass.length} school${r.noClass.length > 1 ? 's' : ''} signed nobody.</p>` : ''}
      </fieldset>` : ''}
      <fieldset class="frame"><legend>Class Rankings</legend><div class="stack">${r.list.map(c => `<div class="stand-row ${c.team === t ? 'mine' : ''}"><span class="small muted">${c.rank}</span>${c.team ? logoImg(c.team) : ''}<span class="grow small"><b>${esc(c.team?.shortName || '?')}</b> <span class="muted">${c.players.length} · ${(c.stars / 2).toFixed(1)}★</span></span><b class="${gradeCls(c.grade)}">${c.grade}</b></div>`).join('') || '<p class="note small muted">No classes yet. Load a save from after recruiting.</p>'}</div>
        <p class="note muted small" style="margin-top:6px">Graded on potential, All-American signees and how much transfers help now, against this year's classes.</p></fieldset>`,
    action: isStep('signing') ? { act: 'signingDone', label: 'Wrap Up Signing' } : null,
  });
};
actions.signingDone = () => { calFlags().signing = true; goHome(); nextUp(); };

// College: Preseason.
screens.preseason = () => {
  const L = league();
  const t = L.teams.find(isUserTeam);
  if (!t) { layout({ title: 'Preseason', body: '<p class="note">Pick your school first.</p>' }); return; }
  const r = preseason(state.data, state.leagueIdx, t, shownLevel);
  const f1 = v => v.toFixed(1);
  const tRow = x => `<div class="stand-row ${x.t === t ? 'mine' : ''}"><span class="small muted">${x.rank}</span>${logoImg(x.t)}<span class="grow small"><b>${esc(x.t.city || x.t.shortName)}</b> <span class="muted">${x.W}-${x.L} last year</span></span>${x.lastRank ? `<span class="small ${x.lastRank > x.rank ? 'up' : x.lastRank < x.rank ? 'down' : 'muted'}">${x.lastRank > x.rank ? '▲' : x.lastRank < x.rank ? '▼' : '—'}${x.lastRank !== x.rank ? Math.abs(x.lastRank - x.rank) : ''}</span>` : ''}</div>`;
  const pRow = (x, right) => `<div class="drill-row ${x.t === t ? 'r1' : ''}"><span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)} <span class="stars">${stars(x.p.pot)}</span>${isAllAmerican(x.p) ? ' <span class="small gold">⭐ AA</span>' : ''}<br><span class="small muted">${esc(posName(x.p))} · ${esc(x.t.shortName)}${right ? ` · ${right}` : ''}</span></span></div>`;
  const where = r.mine.rank <= 5 ? 'a title contender' : r.mine.rank <= 25 ? 'a Top 25 team' : r.mine.rank <= 40 ? 'on the tournament bubble' : 'a long shot for the tournament';
  layout({
    title: 'Preseason',
    body: `<div class="outlook"><div class="outlook-top">${logoImg(t)}<b>${esc(t.city)} ${esc(t.name)}</b><span class="status s-${r.mine.rank <= 25 ? 'contending' : 'developing'}">No. ${r.mine.rank}</span></div>
        <p class="note small" style="padding:8px 10px 10px">Projected No. ${r.mine.rank} of ${L.teams.length}: ${where}. Picked ${r.division.indexOf(r.mine) + 1}${['st', 'nd', 'rd'][r.division.indexOf(r.mine)] || 'th'} in the ${esc(r.divName)}.</p></div>
      <fieldset class="frame"><legend>Preseason Top 25</legend><div class="stack">${r.top25.map(tRow).join('')}</div>
        ${r.mine.rank > 25 ? `<p class="note small muted" style="margin-top:6px">${esc(t.city)}: No. ${r.mine.rank}.</p>` : ''}
        <p class="note muted small" style="margin-top:6px">Projected from roster strength (the top nine by level) and last season's record. Arrows compare with last season's final ranking.</p></fieldset>
      <fieldset class="frame"><legend>${esc(r.divName)} Picks</legend><div class="stack">${r.division.map((x, i) => tRow({ ...x, rank: i + 1, lastRank: 0 })).join('')}</div></fieldset>
      <fieldset class="frame"><legend>Player of the Year Watch</legend><div class="stack">${r.poy.map(x => pRow(x, x.line ? `${f1(x.line.ppg)}/${f1(x.line.rpg)}/${f1(x.line.apg)} last year` : '')).join('')}</div></fieldset>
      <fieldset class="frame"><legend>Freshman of the Year Watch</legend><div class="stack">${r.foy.map(x => pRow(x, `${x.p.age}y`)).join('') || '<p class="note small muted">No freshmen yet.</p>'}</div></fieldset>`,
    action: isStep('preseason') ? { act: 'preseasonDone', label: 'Tip Off the Season' } : null,
  });
};
actions.preseasonDone = () => { calFlags().preseason = true; goHome(); nextUp(); };

// College: Roster Lock.
screens.rosterlock = () => {
  const L = league();
  const t = L.teams.find(isUserTeam);
  if (!t) { layout({ title: 'Roster Lock', body: '<p class="note">Pick your school first.</p>' }); return; }
  const r = rosterLock(t, shownLevel, state.leagueIdx);
  const groups = ['Guards', 'Wings', 'Bigs'];
  const pRow = x => `<div class="drill-row tap ${x.last ? 'r1' : ''}" data-act="openPlayer" data-id="${x.p.id}"><span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)} <span class="stars">${stars(x.p.pot)}</span>${isAllAmerican(x.p) ? ' <span class="small gold">⭐ AA</span>' : ''}<br>
    <span class="small muted">${esc(posName(x.p))} · ${x.p.age}y · ${x.cls}${x.last ? ' · <span class="gold">final year</span>' : x.fresh ? ' · <span class="up">new</span>' : ''}</span></span></div>`;
  layout({
    title: 'Roster Lock',
    body: `<div class="score-card"><div><b>Scholarships</b><span class="big-n ${r.size > 15 ? 'down' : ''}">${r.size}/15</span></div><div><b>Open</b><span class="big-n">${Math.max(0, 15 - r.size)}</span></div></div>
      <fieldset class="frame"><legend>Class Mix</legend><div class="stat-grid">${r.mix.map(([c, n]) => `<div><b>${n}</b><span>${c}</span></div>`).join('')}</div></fieldset>
      ${r.warn.length ? `<fieldset class="frame"><legend>Watch</legend><div class="stack">${r.warn.map(w => `<p class="note small">⚠️ ${esc(w)}</p>`).join('')}</div></fieldset>` : ''}
      ${groups.map(g => { const list = r.players.filter(x => x.group === g); const n = r.needs.short.find(x => x.g === g); return `<fieldset class="frame"><legend>${g} · ${list.length} of ${n.want}</legend><div class="stack">${list.map(pRow).join('') || '<p class="note small down">Nobody.</p>'}</div></fieldset>`; }).join('')}
      <p class="note muted small">Gold border = in his final year of eligibility.</p>`,
    action: isStep('rosterlock') ? { act: 'rosterlockDone', label: 'Lock the Roster' } : null,
  });
};
actions.rosterlockDone = () => { calFlags().rosterlock = true; goHome(); nextUp(); };

// College: Practice Begins.
screens.practice = () => {
  const L = league();
  const t = L.teams.find(isUserTeam);
  if (!t) { layout({ title: 'Practice Begins', body: '<p class="note">Pick your school first.</p>' }); return; }
  const r = practicePlan(t, shownLevel, p => tr(p, 'lockerRoom'));
  const pRow = (x, right = '') => `<div class="drill-row tap" data-act="openPlayer" data-id="${x.p.id}"><span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)} <span class="stars">${stars(x.p.pot)}</span><br>
    <span class="small muted">${esc(posName(x.p))} · ${x.p.age}y · ${classOf(x.p.yrs ?? 0)}</span></span>${right ? `<span class="small" style="text-align:right">${right}</span>` : ''}</div>`;
  layout({
    title: 'Practice Begins',
    body: `<fieldset class="frame"><legend>Projected Starters</legend><div class="stack">${r.starters.map(x => pRow(x, (r.captains.includes(x) ? '🅲 Captain' : '') + ((x.p.yrs ?? 0) === 0 ? '<br><span class="up">Freshman starter</span>' : ''))).join('')}</div></fieldset>
      <fieldset class="frame"><legend>Rotation</legend><div class="stack">${r.rotation.map(x => pRow(x, r.captains.includes(x) ? '🅲 Captain' : '')).join('') || '<p class="note small muted">Short bench.</p>'}</div>
        ${r.rest.length ? `<p class="note small muted" style="margin-top:6px">End of the bench: ${r.rest.map(x => esc(playerName(x.p))).join(', ')}</p>` : ''}</fieldset>
      ${r.battles.length ? `<fieldset class="frame"><legend>Position Battles</legend><div class="stack">${r.battles.map(b => `<p class="note small">⚔️ <b>${esc(playerName(b.a.p))}</b> (Lv ${b.a.lv}) vs <b>${esc(playerName(b.b.p))}</b> (Lv ${b.b.lv}) at ${esc(posName(b.a.p))}</p>`).join('')}</div></fieldset>` : ''}
      <fieldset class="frame"><legend>Captains</legend>${r.captains.length ? `<div class="stack">${r.captains.map(x => pRow(x, `Locker room ${tr(x.p, 'lockerRoom')}`)).join('')}</div>` : '<p class="note small muted">No upperclassmen to name.</p>'}
        <p class="note muted small" style="margin-top:6px">Juniors and seniors with the best locker-room trait.</p></fieldset>
      ${r.pushing.length ? `<fieldset class="frame"><legend>Freshmen Pushing for Minutes</legend><div class="stack">${r.pushing.map(x => pRow(x)).join('')}</div></fieldset>` : ''}
      <p class="note muted small">Set your lineup in the game; this is how camp shakes out by the ratings.</p>`,
    action: isStep('practice') ? { act: 'practiceDone', label: 'Wrap Up Practice' } : null,
  });
};
actions.practiceDone = () => { calFlags().practice = true; goHome(); nextUp(); };

// College: Transfer Portal.
screens.portal = (args = {}) => {
  const L = league();
  const t = L.teams.find(isUserTeam);
  if (!t) { layout({ title: 'Transfer Portal', body: '<p class="note">Pick your school first.</p>' }); return; }
  const b = portalBoard(state.data, state.leagueIdx, t);
  const view = ['all', 'fits', 'Guards', 'Wings', 'Bigs'].includes(args.view) ? args.view : 'all';
  let list = [...b.all].sort((x, y) => shownLevel(y.p) - shownLevel(x.p) || (y.line?.ppg || 0) - (x.line?.ppg || 0));
  if (view === 'fits') list = list.filter(x => x.fit);
  else if (view !== 'all') list = list.filter(x => x.group === view);
  const f1 = v => v.toFixed(1);
  const row = x => {
    const offs = b.offers.get(x.p.id) || [];
    const mine = offs.find(o => o.tid === t.id);
    return `<div class="drill-row ${x.fit ? 'r1' : ''}"><span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)} <span class="stars">${stars(x.p.pot)}</span><br>
      <span class="small muted">${esc(posName(x.p))} · ${x.p.age}y · ${x.cls} · ${x.left} yr${x.left > 1 ? 's' : ''} left · from ${esc(x.from?.shortName || '?')}</span><br>
      <span class="small">${x.line ? `${f1(x.line.ppg)}/${f1(x.line.rpg)}/${f1(x.line.apg)} in ${x.line.gp} games` : 'No stats'}${x.near <= 8 ? ' · <span class="up">📍 near home</span>' : ''}${x.fit ? ' · <span class="gold">🧩 fits a need</span>' : ''}</span></span>
      <span class="small" style="text-align:right">${x.now ? `✍️ ${esc(x.now.shortName)}` : offs.length ? `${offs.length} offer${offs.length > 1 ? 's' : ''}${mine ? '<br><span class="up">incl. yours</span>' : ''}` : '<span class="muted">No offers</span>'}</span></div>`;
  };
  const views = [['all', 'All'], ['fits', 'Fits'], ['Guards', 'Guards'], ['Wings', 'Wings'], ['Bigs', 'Bigs']];
  layout({
    title: 'Transfer Portal',
    body: `<p class="note small"><b>${b.all.length}</b> players entered the portal${b.lost.length ? `, ${b.lost.length} of them from ${esc(t.city)}` : ''}. ${b.all.filter(x => !x.now).length} still available.</p>
      <fieldset class="frame"><legend>Your Roster Next Season</legend>
        <p class="note small">${t.roster.length} players · <b>${b.needs.open}</b> open scholarship${b.needs.open === 1 ? '' : 's'}</p>
        <div class="stack">${b.needs.short.map(n => `<div class="need-row"><span class="sev ${n.short >= 2 ? 's3' : n.short ? 's2' : ''}"></span><span class="small grow"><b>${n.g}</b>: ${n.have} of ${n.want}${n.short ? ` · need ${n.short}` : ''}</span></div>`).join('')}</div>
      </fieldset>
      ${b.lost.length ? `<fieldset class="frame"><legend>Left Your Program</legend><div class="stack">${b.lost.map(row).join('')}</div></fieldset>` : ''}
      <div class="tabs fa-tabs">${views.map(([k, l]) => `<button class="btn ${k === view ? 'on focus' : 'off'}" data-act="portalView" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="stack">${list.map(row).join('') || '<p class="note small muted">Nobody here.</p>'}</div>
      <p class="note muted small" style="margin-top:6px">📍 = your campus is one of the 8 closest schools to his hometown (recruits lean toward staying close). Recruit them during the signing period.</p>`,
    action: isStep('portal') ? { act: 'portalDone', label: 'Wrap Up the Portal' } : null,
  });
};
actions.portalView = d => replace('portal', { view: d.v });
actions.portalDone = () => { calFlags().portal = true; goHome(); nextUp(); };

// ---- Final cuts. Your teams: tap who goes (the likeliest cuts are marked).
// CPU teams cut their lowest by level, potential and salary.
const cutSel = () => (state.cutSel ||= {});
// CPU teams only cut players in the last year of their deal; you can cut
// anyone, and years left become dead money.
const cutRank = t => FA.signedRoster(t).filter(p => isUserTeam(t) || (p.contract?.yrs || 0) <= 1).map(p => ({ p, score: FA.cutScore(p, shownLevel(p), league().season.currentYear) })).sort((a, b) => a.score - b.score);
screens.cuts = () => {
  const L = league(), O = FA.FA_DEFAULTS, sel = cutSel();
  const done = !!calFlags().cuts;
  const mine = L.teams.filter(isUserTeam);
  // First visit: the likeliest cuts start picked; tap to change.
  if (!done && !state.cutSeeded) {
    for (const t of mine) { const r = cutRank(t).filter(x => (x.p.contract?.yrs || 0) <= 1); for (const x of r.slice(0, Math.max(0, FA.signedRoster(t).length - O.seasonMax))) sel[x.p.id] = true; }
    state.cutSeeded = true;
  }
  const over = L.teams.filter(t => !isUserTeam(t) && FA.signedRoster(t).length > O.seasonMax);
  const myCards = mine.map(t => {
    const ranked = cutRank(t);
    const n = FA.signedRoster(t).length, need = Math.min(ranked.length, Math.max(0, n - O.seasonMax));
    const picked = ranked.filter(x => sel[x.p.id]).length;
    const mood = (calFlags().taxMood || {})[t.id] || [];
    if (done) return `<fieldset class="frame"><legend>${esc(t.shortName)} · ${n}/${O.seasonMax}</legend>${capBar(t)}<p class="note small up">✓ Roster is set.</p>
      ${(() => { const mv = (calFlags().moraleLog || []).filter(x => x.tid === t.id && Math.abs(x.to - x.from) >= 3).sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from)).slice(0, 8); return mv.length ? `<p class="note small" style="margin-top:6px"><b>Morale moves</b></p>${mv.map(x => { const pl = playerById(x.pid); return pl ? `<p class="note small">${esc(playerName(pl))} ${moraleFace(x.from)} → ${moraleFace(x.to)} <span class="${x.to > x.from ? 'up' : 'down'}">${x.to > x.from ? '+' : ''}${x.to - x.from}</span> <span class="muted">· ${esc(x.why)}</span></p>` : ''; }).join('')}` : ''; })()}
      ${mood.length ? `<p class="note small" style="margin-top:6px"><b>Locker room</b></p>${mood.map(x => `<p class="note small"><span class="${x.n > 0 ? 'up' : 'down'}">${esc(x.name)} morale ${x.n > 0 ? '+' : ''}${x.n}</span> <span class="muted">· ${esc(x.why)}</span></p>`).join('')}` : ''}</fieldset>`;
    return `<fieldset class="frame"><legend>${esc(t.shortName)} · ${n}/${O.seasonMax}</legend>
      ${capBar(t)}
      <p class="note small">${need ? `Cut <b>${need}</b> (${picked} picked).` : `Roster fits${picked ? `; ${picked} picked to cut anyway` : ''}.`} Cutting a player with years left leaves his salary on your books as dead money.</p>
      <div class="stack">${ranked.map((x, i) => `<div class="drill-row tap ${sel[x.p.id] ? 'r1' : ''}" data-act="cutToggle" data-id="${x.p.id}"><span class="grow"><b>${esc(playerName(x.p))}</b> ${lvTag(x.p)} ${potStars(x.p)}<br>
        <span class="small muted">${esc(posName(x.p))} · ${x.p.age}y · $${x.p.contract?.sal || 0}M × ${x.p.contract?.yrs || 0}${(x.p.contract?.yrs || 0) > 1 ? ` · <span class="down">$${x.p.contract.sal * x.p.contract.yrs}M dead if cut</span>` : ''}</span></span>
        <b class="small ${sel[x.p.id] ? 'down' : 'muted'}">${sel[x.p.id] ? '✂️ Cut' : 'Keep'}</b></div>`).join('')}</div></fieldset>`;
  }).join('');
  const log = calFlags().cutLog;
  layout({
    title: 'Final Cuts',
    body: `<p class="note small">Teams could carry up to ${O.rosterMax} through the summer. Opening night rosters max out at ${O.seasonMax}; cut players go to free agency.</p>
      ${requestCard()}
      ${myCards}
      <fieldset class="frame"><legend>Around the League</legend>${done && log ? `<div class="stack">${log.list.map(x => `<p class="note small"><b>${esc(x.team)}</b> cut ${esc(x.names.join(', '))}</p>`).join('') || '<p class="note small muted">No cuts needed.</p>'}</div>`
        : `<p class="note small">${over.length ? `${over.length} team${over.length > 1 ? 's' : ''} over ${O.seasonMax}: ${over.map(t => `${esc(t.shortName)} (${FA.signedRoster(t).length})`).join(', ')}. They cut their lowest-rated players.` : 'Every CPU team is at ' + O.seasonMax + ' or below.'}</p>`}</fieldset>`,
    action: done ? null : { act: 'cutsFinish', label: mine.some(t => cutsShort(t, sel) > 0) ? 'Pick your cuts first' : 'Make the Cuts' },
  });
};
// Cuts still to pick (only as many as there are cuttable players).
const cutsShort = (t, sel) => { const r = cutRank(t); return Math.min(r.length, Math.max(0, FA.signedRoster(t).length - FA.FA_DEFAULTS.seasonMax)) - r.filter(x => sel[x.p.id]).length; };
actions.goHomeCuts = () => goHome();


// ---- Trade requests (Complete rules)
// When a team has been stripped (its rotation players gone, little coming
// back), its stars with a winning streak or low morale can ask out. CPU
// stars go on the game's trade block and show on the cuts screen; yours
// ask you for an answer.
function stripScore(L, t) {
  const sit = teamSituation(L, t, state.leagueIdx);
  // Only a star's departure (Lv 86+) strips a team; any decent arrival (Lv 70+) softens it.
  const star = p => { const lv = shownLevel(p); return lv >= 86 ? (lv - 78) / 4 : 0; };
  const arr = p => { const lv = shownLevel(p); return lv >= 70 ? (lv - 62) / 8 : 0; };
  const loss = sit.departures.reduce((a, p) => a + star(p), 0), gain = sit.arrivals.reduce((a, p) => a + arr(p), 0);
  const gone = sit.departures.filter(p => star(p) > 0).sort((a, b) => shownLevel(b) - shownLevel(a));
  return { strip: gone.length ? loss - 0.6 * gain + (FA.capSystemOn() && FA.taxStance(L, t) === 'blowup' ? 1 : 0) : 0, gone };
}
// Only real stars ask out: Lv 86+, or a 4.5-5 star potential at Lv 79+ who's
// at least three years in.
const demandsHelp = (p, t) => { const lv = shownLevel(p), min = t && isUserTeam(t) && fxNow().requestLv ? fxNow().requestLv : 86; return lv >= min || (p.pot >= 9 && lv >= 79 && lv >= (min > 86 ? min : 0) && (p.yrs ?? 0) >= 3); };
// Players on their first (rookie) contract have no leverage, and nobody with 3 or more years left asks out:
// it's the one or two years left that hope to hash out a new deal with whoever picks them up.
const canAskOut = p => !FA.isRookieScale(p) && (p.contract?.yrs ?? 0) >= 1 && (p.contract?.yrs ?? 0) <= 2;
function requestsState() {
  const L = league();
  const st = offGet('req');
  if (st.list || !isComplete() || isCollege()) return st;
  const list = [];
  let cpuAsks = 0;                                          // a few CPU stars ask out in a summer, not every one
  for (const t of L.teams) {
    const { strip, gone } = stripScore(L, t);
    if (strip < 2) continue;
    const roster = FA.signedRoster(t).sort((a, b) => shownLevel(b) - shownLevel(a)).slice(0, 3)
      .filter(p => demandsHelp(p, t) && tr(p, 'loyalty') < 17 && !tradeLock(p) && p.season?.onTradeBlock !== 2 && canAskOut(p) && (isUserTeam(t) || cpuAsks < 3));
    const max = strip >= 4 ? 2 : 1;
    let n = 0;
    for (const p of roster) {
      if (n >= max) break;
      const morale = p.season?.morale ?? 60, win = tr(p, 'winning'), loy = tr(p, 'loyalty');
      // Happy players don't ask out: it starts with morale, and a stripped roster only tips an unhappy star.
      if (morale >= 70) continue;
      const moraleOdds = morale < 35 ? 0.35 : morale < 50 ? 0.2 : 0.08;
      const yrsLeft = p.contract?.yrs ?? 1;
      let odds = (yrsLeft >= 2 ? 0.5 : 1) * (0.06 + moraleOdds + 0.04 * (strip - 2) + (win >= 15 ? 0.1 : win >= 12 ? 0.04 : 0) - (loy >= 14 ? 0.15 : 0) - (teamStatus(L, t) === 'rebuilding' && p.age <= 24 ? 0.1 : 0));
      if (isUserTeam(t)) odds *= fxNow().requestMult;
      odds *= 1 - FX.facilityFx(t).requestCut;
      if (mulberry32((saveSalt() ^ Math.imul(p.id + 5, 2654435761) ^ 0x7e9) >>> 0)() >= Math.min(0.75, odds)) continue;
      n++;
      if (!isUserTeam(t)) cpuAsks++;
      const names = gone.slice(0, 2).map(x => x.ln || playerName(x));
      list.push({ pid: p.id, tid: t.id, why: `${names.join(' and ')} gone and little coming back`, status: isUserTeam(t) ? 'open' : 'cpu' });
      if (!isUserTeam(t)) { if (p.season) { p.season.onTradeBlock = 1; p.season.morale = Math.max(0, (p.season.morale ?? 60) - 8); } }
    }
  }
  // A star in the last year of his deal who's unhappy can ask to be moved to a new opportunity
  // (and test free agency from there), stripped roster or not.
  for (const t of L.teams) {
    for (const p of FA.signedRoster(t).filter(x => demandsHelp(x, t) && canAskOut(x) && x.contract.yrs === 1 && x.season?.onTradeBlock !== 2 && !tradeLock(x) && !list.some(r => r.pid === x.id))) {
      const morale = p.season?.morale ?? 60;
      if (morale >= 50 || tr(p, 'loyalty') >= 15 || (!isUserTeam(t) && cpuAsks >= 3)) continue;
      const odds = (morale < 35 ? 0.3 : 0.15) * (isUserTeam(t) ? fxNow().requestMult : 1) * (1 - FX.facilityFx(t).requestCut);
      if (mulberry32((saveSalt() ^ Math.imul(p.id + 11, 2654435761) ^ 0x2b7) >>> 0)() >= odds) continue;
      if (!isUserTeam(t)) { cpuAsks++; if (p.season) { p.season.onTradeBlock = 1; p.season.morale = Math.max(0, morale - 8); } }
      list.push({ pid: p.id, tid: t.id, why: 'in the last year of his deal and wants a new opportunity', status: isUserTeam(t) ? 'open' : 'cpu' });
    }
  }
  st.list = list;
  offSet('req', st);
  state.dirty = true;
  return st;
}
const playerById = id => league().teams.flatMap(t => t.roster).find(p => p.id === id);
function requestCard() {
  const st = requestsState();
  const L = league();
  const mine = (st.list || []).filter(r => r.status !== 'cpu');
  const cpu = (st.list || []).filter(r => r.status === 'cpu');
  const row = r => {
    const p = playerById(r.pid), t = L.teams.find(x => x.id === r.tid);
    if (!p) return '';
    const done = r.status !== 'open';
    const res = { promised: 'You promised help; he\'s staying for now.', refused: 'He didn\'t buy it.', block: 'On the trade block.', ignored: 'You said no. He isn\'t happy.', traded: `Traded to ${r.to || 'another team'}.` }[r.status];
    return `<div class="drill-row wrap"><span class="grow"><b>${esc(playerName(p))}</b> ${lvTag(p)}<br><span class="small muted">${esc(t.shortName)} · wants out: ${esc(r.why)} · ${moraleTag(p)}</span></span>
      ${done ? `<p class="note small ${r.status === 'block' || r.status === 'promised' || r.status === 'traded' ? 'up' : 'down'} full">${esc(res)}</p>` : ''}
      ${!calFlags().cuts && r.status !== 'traded' ? `<span class="opt-btns full">
        <button class="btn small ${r.status === 'promised' ? 'on focus' : 'off'}" data-act="reqAnswer" data-id="${r.pid}" data-v="promise" ${r.tried || r.status === 'block' ? 'disabled' : ''}>Promise help</button>
        <button class="btn small ${r.status === 'block' ? 'on focus' : 'off'}" data-act="reqAnswer" data-id="${r.pid}" data-v="block">${r.status === 'block' ? 'See offers' : 'Shop him'}</button>
        <button class="btn small ${r.status === 'ignored' ? 'on focus' : 'off'}" data-act="reqAnswer" data-id="${r.pid}" data-v="no">Say no</button></span>` : ''}</div>`;
  };
  if (!mine.length && !cpu.length) return '';
  return `${mine.length ? `<fieldset class="frame"><legend>Trade Requests</legend><div class="stack">${mine.map(row).join('')}</div></fieldset>` : ''}
    ${cpu.length ? `<fieldset class="frame"><legend>Wants Out</legend><div class="stack">${cpu.map(r => { const p = playerById(r.pid), t = L.teams.find(x => x.id === r.tid); return p ? `<div class="drill-row tap" data-act="openPlayer" data-id="${p.id}"><span class="grow"><b>${esc(playerName(p))}</b> ${lvTag(p)}<br><span class="small muted">${esc(t.shortName)} · ${esc(r.why)}</span></span><b class="small gold">On the block</b></div>` : ''; }).join('')}</div></fieldset>` : ''}`;
}
// Teams call about a player who wants out: a handful of offers, each
// rated against what he's worth, so the light ones show.
function reqOffers(r) {
  const L = league(), ds = draftState();
  const p = playerById(r.pid), team = L.teams.find(t => t.id === r.tid);
  if (!p || !team) return;
  ds.offerSeed = Math.floor(Math.random() * 1e9);
  const offers = frontOfficeOffers(team, { only: `p:${p.id}`, max: 6 }).filter(o => o.kind === 'block').slice(0, 6);
  const box = overlay('');
  box.querySelector('.box').innerHTML = `<p class="note"><b>${esc(playerName(p))}</b> ${lvTag(p)}<br><span class="small muted">${p.age}y · ${p.contract?.sal ? `$${p.contract.sal}M × ${p.contract.yrs}` : ''}</span></p>
    <div class="stack">${offers.map((o, i) => `<div class="offer"><p class="note small"><b>${esc(o.team.shortName)}</b> ${offerRating(o)}: ${esc(o.give.map(x => x.text).join(' + '))}</p><button class="btn small" data-i="${i}">Accept</button></div>`).join('') || '<p class="note small muted">Nobody is biting right now.</p>'}</div>
    <button class="btn off" data-close style="margin-top:8px">Close</button>`;
  box.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) { box.remove(); return; }
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const o = offers[+b.dataset.i];
    box.remove();
    if (await doOffer(team, o)) {
      const st = offGet('req'), rr = (st.list || []).find(x => x.pid === r.pid);
      if (rr) { rr.status = 'traded'; rr.to = o.team.shortName; offSet('req', st); }
      const ext = extendAfterTrade(p, o.team, o.ratio ?? 0);
      if (ext) toast(`${playerName(p)} extends with ${o.team.shortName}`, `${Math.max(3, ext.pref)} years, $${ext.sal}M a year.`);
      ds.block?.delete(`p:${p.id}`);
      ds.offers = null;
      render();
    } else reqOffers(r);
  });
}
actions.reqAnswer = d => {
  const L = league(), st = offGet('req');
  const r = (st.list || []).find(x => x.pid === +d.id);
  const p = playerById(+d.id);
  if (!r || !p || calFlags().cuts) return;
  const bump = n => { if (p.season) p.season.morale = Math.max(0, Math.min(100, (p.season.morale ?? 60) + n)); };
  if (d.v === 'promise') {
    if (r.tried) return;
    r.tried = true;
    const ok = mulberry32((saveSalt() ^ Math.imul(p.id + 9, 40503) ^ 0x51) >>> 0)() < Math.max(0.2, Math.min(0.8, 0.5 + (tr(p, 'loyalty') - 10) * 0.03 - (tr(p, 'winning') - 10) * 0.02 + (teamStatus(L, L.teams.find(t => t.id === r.tid)) === 'contending' ? 0.1 : 0) + fxNow().promiseBonus));
    r.status = ok ? 'promised' : 'refused';
    if (ok) { bump(6); savePromises([...loadPromises().filter(x => !(x.pid === p.id && x.yr === L.season.currentYear && x.src === 'request')), { yr: L.season.currentYear, tid: r.tid, pid: p.id, v: 'commit', kind: 'win', src: 'request' }]); }
    else bump(-3);
    toast(ok ? `${playerName(p)} will give it a year` : `${playerName(p)} isn't convinced`, ok ? 'You promised help around him.' : 'He still wants out.');
  } else if (d.v === 'block') {
    if (r.status !== 'block') bump(3);
    r.status = 'block';
    if (p.season) p.season.onTradeBlock = 1;
    const b = (draftState().block ||= new Set()); b.add(`p:${p.id}`);
    offSet('req', st);
    state.dirty = true;
    render();
    reqOffers(r);
    return;
  } else {
    r.status = 'ignored';
    bump(fxNow().moodHalf ? -3 : -6);
  }
  offSet('req', st);
  state.dirty = true;
  render();
};

// ---------------------------------------------------------------------------
// Late free agency (before final cuts): the players still out there take
// minimum deals now. You sign who you want (up to the summer roster limit
// and under the 2nd apron); when you wrap up, CPU teams with open spots
// fill them with the best who are left.
const lateMin = p => FA.minFor(p);
const lateYears = p => (p.age <= 24 ? 2 : 1);
screens.latefa = (args = {}) => {
  const L = league(), O = FA.FA_DEFAULTS;
  const done = !!calFlags().latefa;
  const mine = L.teams.filter(isUserTeam);
  const pool = (L.freeAgents || []).filter(p => p.status === FA.STATUS_FREE).sort((a, b) => shownLevel(b) - shownLevel(a));
  const view = args.view || 'all';
  const rows = pool.filter(p => view === 'young' ? p.age <= 24 : view === 'vets' ? p.age >= 30 : true).slice(0, args.all ? 200 : 25);
  const log = calFlags().lateLog;
  layout({
    title: 'Late Free Agency',
    body: `<p class="note small">Last call before final cuts. Everyone left takes a minimum deal now: 1 year, or 2 for players 24 and under.</p>
      ${mine.map(t => `<fieldset class="frame"><legend>${esc(t.shortName)} · ${FA.signedRoster(t).length}/${O.rosterMax}</legend>${capBar(t)}</fieldset>`).join('')}
      ${done && log ? `<fieldset class="frame"><legend>Around the League</legend><div class="stack">${log.list.map(x => `<p class="note small"><b>${esc(x.name)}</b> ${esc(x.lv)} → ${esc(x.team)} · $${x.sal}M × ${x.yrs}</p>`).join('') || '<p class="note small muted">Nobody else signed.</p>'}</div></fieldset>` : ''}
      <div class="tabs fa-tabs">${[['all', 'Best'], ['young', 'Young'], ['vets', 'Vets']].map(([k, l]) => `<button class="btn ${k === view ? 'on focus' : 'off'}" data-act="lateView" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="list">${rows.map(p => {
        const l = seasonLine(p, state.leagueIdx, lastYear());
        return `<div class="prow"><span class="name">${esc(playerName(p))} ${lvTag(p)}</span>
          <span class="right">${done ? '' : `<button class="btn small focus" data-act="lateSign" data-id="${p.id}">✍️ $${lateMin(p)}M</button>`}</span>
          <span class="meta">${esc(posName(p))} · ${p.age}y${l ? ` · ${l.ppg.toFixed(1)}/${l.rpg.toFixed(1)}/${l.apg.toFixed(1)}` : ''}</span></div>`;
      }).join('') || '<p class="note muted">Nobody left.</p>'}</div>
      ${!args.all && pool.length > 25 ? `<button class="btn small" data-act="lateAll">Show all ${pool.length}</button>` : ''}`,
    action: done ? null : { act: 'lateFinish', label: 'Wrap Up Free Agency' },
  });
};
actions.lateView = d => replace('latefa', { view: d.v });
actions.lateAll = () => replace('latefa', { ...state.stack[state.stack.length - 1].args, all: true });
actions.lateSign = d => {
  const L = league(), O = FA.FA_DEFAULTS;
  const p = (L.freeAgents || []).find(x => x.id === +d.id);
  const t = L.teams.find(isUserTeam);
  if (!p || !t) return;
  if (FA.hasGrudge(p, t)) { toast(`${playerName(p)} refuses to meet with ${t.shortName}`, '', 2800, true); return; }
  if (FA.signedRoster(t).length >= O.rosterMax) { toast(`Roster is full (${O.rosterMax})`, '', 2400, true); return; }
  if (FA.capSystemOn() && FA.teamCommitted(t) + lateMin(p) > FA.capLines(L).apron2) { toast('That would put you over the 2nd apron', '', 2400, true); return; }
  FA.signPlayer(L, p, t, { tid: t.id, sal: lateMin(p), yrs: lateYears(p), opt: 0 }, L.season.currentDay || 3);
  lockSigning(p, 'Signed this offseason: Dec 15');
  ((calFlags().lateMine ||= [])).push(p.id);
  state.dirty = true;
  render();
  toast(`✍️ ${playerName(p)} signs`, `$${lateMin(p)}M × ${lateYears(p)}`);
};
actions.lateFinish = () => {
  const L = league(), O = FA.FA_DEFAULTS;
  const list = [];
  // CPU teams under 15 add the best players left, by need for a body.
  for (const t of L.teams.filter(x => !isUserTeam(x)).sort(() => Math.random() - 0.5)) {
    while (FA.signedRoster(t).length < O.seasonMax) {
      const p = (L.freeAgents || []).filter(x => x.status === FA.STATUS_FREE).sort((a, b) => shownLevel(b) - shownLevel(a))[0];
      if (!p || (FA.capSystemOn() && FA.teamCommitted(t) + lateMin(p) > FA.capLines(L).apron2)) break;
      FA.signPlayer(L, p, t, { tid: t.id, sal: lateMin(p), yrs: lateYears(p), opt: 0 }, L.season.currentDay || 3);
      lockSigning(p, 'Signed this offseason: Dec 15');
      list.push({ name: playerName(p), lv: `Lv ${shownLevel(p)}`, team: t.shortName, sal: lateMin(p), yrs: lateYears(p) });
    }
  }
  calFlags().latefa = true;
  calFlags().lateLog = { n: list.length + (calFlags().lateMine || []).length, mine: (calFlags().lateMine || []).length, list };
  state.dirty = true;
  render();
  toast('Late free agency is done', `${list.length} signings around the league`);
};
// Contenders fill their last bench spots for the playoffs: a late-round
// rookie with no upside gives way to a proven veteran who wins, a playoff
// riser first. Rookies on those teams don't make the 15 just for being drafted.
function depthSwaps(L) {
  const yr = L.season.currentYear;
  for (const t of L.teams.filter(x => !isUserTeam(x) && teamStatus(L, x) === 'contending')) {
    for (let i = 0; i < 2; i++) {
      const spare = FA.signedRoster(t).filter(p => { const d = p.history?.draft; return d && d.yr === yr && d.rd > 1 && (p.pot || 0) <= 5; })
        .sort((a, b) => shownLevel(a) - shownLevel(b))[0];
      if (!spare) break;
      const score = p => shownLevel(p) + (traitsSet(p) ? (tr(p, 'winning') >= 14 ? 3 : 0) + (tr(p, 'playoffRiser') >= 14 ? 4 : tr(p, 'playoffRiser') <= 5 ? -4 : 0) : 0);
      const vet = (L.freeAgents || []).filter(x => x.status === FA.STATUS_FREE && x.age >= 27 && shownLevel(x) >= shownLevel(spare) + 8
        && (!FA.capSystemOn() || FA.teamCommitted(t) - (spare.contract?.sal || 0) + lateMin(x) <= FA.capLines(L).apron2))
        .sort((a, b) => score(b) - score(a))[0];
      if (!vet) break;
      FA.cutPlayer(L, t, spare);
      FA.signPlayer(L, vet, t, { tid: t.id, sal: lateMin(vet), yrs: 1, opt: 0 }, L.season.currentDay || 3);
      lockSigning(vet, 'Signed this offseason: Dec 15');
    }
  }
}
actions.cutToggle = d => { if (calFlags().cuts) return; const sel = cutSel(); sel[+d.id] = !sel[+d.id]; render(); };
actions.cutsFinish = async () => {
  const L = league(), O = FA.FA_DEFAULTS, sel = cutSel();
  const mine = L.teams.filter(isUserTeam);
  const short = mine.find(t => cutsShort(t, sel) > 0);
  if (short) { toast(`${short.shortName}: pick ${cutsShort(short, sel)} more to cut`); return; }
  const deadNew = mine.flatMap(t => cutRank(t).filter(x => sel[x.p.id] && (x.p.contract?.yrs || 0) > 1)).reduce((a, x) => a + x.p.contract.sal * x.p.contract.yrs, 0);
  if (!(await confirmBox(`Make the cuts? Cut players are released to free agency.${deadNew ? ` <b class="down">$${deadNew}M</b> stays on your books as dead money.` : ''}`, 'Make the Cuts'))) return;
  checkpoint('Final cuts');
  const list = [];
  let n = 0, mineN = 0;
  depthSwaps(L);
  for (const t of L.teams) {
    const ranked = cutRank(t);
    const go = isUserTeam(t) ? ranked.filter(x => sel[x.p.id]) : ranked.slice(0, Math.max(0, FA.signedRoster(t).length - O.seasonMax));
    // A CPU team still over the 2nd apron (the game's cap) cuts down under it.
    if (!isUserTeam(t) && FA.capSystemOn()) {
      const extra = FA.signedRoster(t).filter(p => !go.some(x => x.p === p)).map(p => ({ p, score: FA.cutScore(p, shownLevel(p), L.season.currentYear) })).sort((a, b) => a.score - b.score);
      let pay = FA.teamCommitted(t) - go.reduce((a, x) => a + (x.p.contract?.sal || 0), 0);
      while (pay > FA.capLines(L).apron2 && extra.length) { const x = extra.shift(); go.push(x); pay -= x.p.contract?.sal || 0; }
    }
    if (!go.length) continue;
    for (const x of go) {
      const c = x.p.contract || {};
      if (isUserTeam(t) && (c.yrs || 0) > 1) saveDead([...deadLedger(), { pid: x.p.id, name: playerName(x.p), tid: t.id, sal: c.sal || 0, yrs: c.yrs, yr: L.season.currentYear }]);
      FA.cutPlayer(L, t, x.p);
    }
    n += go.length;
    if (isUserTeam(t)) mineN += go.length;
    list.push({ team: t.shortName, names: go.map(x => playerName(x.p)) });
  }
  roleMorale(L);
  calFlags().cutLog = { n, mine: mineN, list };
  {
    const rq = offGet('req');
    for (const r of (rq.list || []).filter(x => x.status === 'open')) { r.status = 'ignored'; const p = playerById(r.pid); if (p?.season) p.season.morale = Math.max(0, (p.season.morale ?? 60) - 6); }
    offSet('req', rq);
  }
  const moods = {};
  const fx = fxNow();
  for (const t of L.teams) {
    const m = taxMood(L, t);
    for (const x of m) { const n = x.n < 0 ? Math.round(x.n * (isUserTeam(t) && fx.moodHalf ? 0.5 : 1) * (1 - FX.facilityFx(t).taxCut)) : x.n; if (x.p.season) x.p.season.morale = Math.max(0, Math.min(100, (x.p.season.morale ?? 60) + n)); }
    if (isUserTeam(t) && m.length) moods[t.id] = m.map(x => ({ name: playerName(x.p), n: x.n, why: x.why.join('; ') }));
  }
  calFlags().taxMood = moods;
  // Open Door and the arena lift everyone; Franchise Identity keeps morale
  // from falling below its floor.
  for (const t of mine) {
    const lift = fx.moraleLift + FX.facilityFx(t).morale;
    if (lift) for (const p of t.roster) if (p.season) p.season.morale = Math.min(100, (p.season.morale ?? 60) + lift);
    if (fx.moraleFloor) for (const p of t.roster) if (p.season && (p.season.morale ?? 60) < fx.moraleFloor) p.season.morale = fx.moraleFloor;
  }
  const pen = recordApron();
  if (pen.some(isUserTeam)) toast('2nd apron penalty', 'Over it 3 of the last 5 seasons: your furthest-out first moves to the end of the 1st round', 4200, true);
  calFlags().cuts = true;
  state.cutSel = {};
  state.cutSeeded = false;
  state.dirty = true;
  render();
  toast(`✂️ ${n} player${n === 1 ? '' : 's'} cut`, mineN ? `${mineN} from your roster` : '');
};

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
      ${isCollege() ? '' : `<fieldset class="frame"><legend>League File (experimental)</legend>
        <p class="note small">Turns this save into a league file: rosters, contracts, ratings, tendencies, coaches, picks and history as they stand, with the season reset so you can start a brand new franchise from it.</p>
        <button class="btn" data-act="downloadLeague">🌐 Download League File</button></fieldset>`}
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
  const text = storylinesText(currentStorylines().stories, currentStorylines().podium);
  await dbxSend(new Blob([text], { type: 'text/plain' }), `${state.fileName} storylines ${league().season.currentYear}.txt`, 'storylines');
};

// ---------------------------------------------------------------------------
// League editor: open a league file (the league object on its own), change
// what the game's editor can't reach, and export it again to start new saves.
// Traits sit on a 0-100 scale in the file and 0-20 here; 0 means unset.

const ED_TAGS = ['Rebuilding', 'Developing', 'Competing', 'Contending'];
const ED_TRAITS = [...TRAITS.map(t => ({ k: t.k, label: t.label, lo: t.lo, hi: t.hi })), { k: 'roadWarrior', label: 'Road Warrior', lo: 'Homebody', hi: 'Road Warrior' }];
const edPlayers = L => L.teams.flatMap(t => t.roster).concat(L.freeAgents || []);
// The file's own values, so traits nobody touched go back out exactly as they came in.
const rawTraits = new WeakMap();
function leagueTraitsIn(L) {
  for (const p of edPlayers(L)) {
    if (!p.traits) continue;
    rawTraits.set(p, { ...p.traits });
    for (const k of ED_TRAITS.map(t => t.k)) if (p.traits[k] > 0) p.traits[k] = Math.max(1, Math.min(20, Math.round(p.traits[k] / 5)));
  }
}
function buildLeagueExport() {
  const L = state.data.seasonLeagues[0];
  const keep = new Map();
  for (const p of edPlayers(L)) {
    if (!p.traits) continue;
    keep.set(p, { ...p.traits });
    const raw = rawTraits.get(p) || {};
    for (const t of ED_TRAITS) {
      const v = p.traits[t.k];
      if (v === undefined) continue;
      const was = raw[t.k] ?? 0;
      const same = v === (was > 0 ? Math.max(1, Math.min(20, Math.round(was / 5))) : 0);
      p.traits[t.k] = same ? was : Math.max(0, Math.min(100, Math.round(v * 5)));
    }
  }
  const text = serializeSave(L);
  for (const [p, t] of keep) p.traits = t;
  return new File([text], state.fileName, { type: 'application/octet-stream' });
}
const edStep = (label, val, act, data, note = '') => `<div class="pts-row"><span class="grow">${label}${note ? ` <span class="small muted">${note}</span>` : ''}</span><button class="btn square" data-act="${act}" ${data} data-d="-1">−</button><span class="pts-val">${val}</span><button class="btn square" data-act="${act}" ${data} data-d="1">+</button></div>`;
const edSeg = (opts, cur, act, data) => `<div class="tabs fa-tabs">${opts.map(([v, l]) => `<button class="btn small ${cur === v ? 'on focus' : 'off'}" data-act="${act}" ${data} data-v="${v}">${l}</button>`).join('')}</div>`;
screens.editor = (args = {}) => {
  const L = league();
  const tab = args.tab || 'teams';
  const tabs = [['teams', 'Teams'], ['picks', 'Picks'], ['coaches', 'Coaches'], ['tools', 'Tools']];
  const head = `<p class="note small">${esc(L.leagueName || L.shortName)} · ${state.leagueFile ? 'league file' : 'your save'} · ${L.teams.length} teams. ${state.leagueFile ? 'Edits are written into the file when you export.' : 'Edits change your save; Export League snapshots it.'}</p>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="btn ${k === tab ? 'on focus' : 'off'}" data-act="edTab" data-t="${k}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (tab === 'teams') {
    const t = L.teams.find(x => x.id === args.tid);
    if (!t) {
      body = `<div class="list">${[...L.teams].sort((a, b) => a.city.localeCompare(b.city)).map(x => `<button class="prow" data-act="edTeam" data-id="${x.id}"><span class="name">${logoImg(x)} ${esc(x.city)} ${esc(x.name)}</span><span class="right small">${ED_TAGS[x.status ?? 0] || '—'}<br><span class="muted">fans ${x.frontOffice?.fans ?? 0}</span></span><span class="meta">${x.roster.length} players · ${x.draftPicks.length} picks</span></button>`).join('')}</div>`;
    } else {
      const ro = [...t.roster].sort((a, b) => levelOf(b) - levelOf(a));
      body = `<button class="btn small off" data-act="edTeam" data-id="">◀ All teams</button>
        <fieldset class="frame"><legend>${esc(t.city)} ${esc(t.name)}</legend>
          ${edStep('Fans', t.frontOffice?.fans ?? 0, 'edFans', `data-id="${t.id}"`, '0–100')}
          ${t.frontOffice ? edStep('Coins', t.frontOffice.coins ?? 0, 'edCoins', `data-id="${t.id}"`, '±50') : ''}
          ${FX.FACILITIES.map(f => edStep(`${f.icon} ${esc(f.label)}`, FX.tierIn(t, f.k), 'edFac', `data-id="${t.id}" data-k="${f.k}"`, 'tier 1–4')).join('')}
          <p class="note small" style="margin-top:6px">Team tag (the game's)</p>
          ${edSeg(ED_TAGS.map((n, i) => [i, n]), t.status ?? 0, 'edTag', `data-id="${t.id}"`)}
          <p class="note small muted">The app reads it as ${esc(appTier(t))}.</p>
        </fieldset>
        <fieldset class="frame"><legend>Roster · trade block</legend><div class="stack">${ro.map(p => `<div class="drill-row wrap">
          <span class="grow"><button class="linkish" data-act="edPlayer" data-id="${p.id}">${esc(playerName(p))}</button> ${lvTag(p)} <span class="small muted">${esc(posName(p))} · ${p.age}y</span></span>
          <span class="full">${edSeg([[0, 'No'], [1, 'On the block'], [2, 'Untouchable']], p.season?.onTradeBlock ?? 0, 'edBlock', `data-id="${p.id}"`)}</span></div>`).join('')}</div></fieldset>`;
    }
  } else if (tab === 'picks') {
    // A league file lists only some picks outright (traded ones); the game
    // fills in the rest. Show every pick of the team picked, who holds it, and
    // write an outright entry when one is moved.
    const A = L.teams.find(x => x.id === args.tid) || L.teams[0];
    const y0 = state.leagueFile ? (L.season.startingYear || 2027) : Math.min(...L.teams.flatMap(t => t.draftPicks.map(p => p.yr)), L.season.currentYear);
    const rows = [];
    for (let y = y0; y < y0 + 7; y++) for (const rd of [1, 2]) rows.push({ y, rd, holder: pickHolder(L, A.id, y, rd) });
    body = `<p class="note small">Pick a team to see its own picks and who holds them. Sending one writes it into the league file.</p>
      <select class="sel-team" data-act="edPickTeam">${L.teams.map(x => `<option value="${x.id}" ${x === A ? 'selected' : ''}>${esc(x.city)} ${esc(x.name)}</option>`).join('')}</select>
      <div class="stack" style="margin-top:8px">${rows.map(r => `<div class="drill-row wrap"><span class="grow">${r.y} R${r.rd} <span class="muted small">· ${r.holder.id === A.id ? 'kept' : `held by ${esc(r.holder.shortName)}`}</span></span>
        <select class="sel-team" data-act="edPickTo" data-tid="${A.id}" data-yr="${r.y}" data-rd="${r.rd}"><option value="">Send to…</option>${L.teams.filter(x => x !== r.holder).map(x => `<option value="${x.id}">${esc(x.shortName)}${x.id === A.id ? ' (back)' : ''}</option>`).join('')}</select></div>`).join('')}</div>`;
  } else if (tab === 'coaches') {
    const staffs = L.teams.flatMap(t => (t.frontOffice?.staff || []).filter(c => c.pri === 1 || (c.attributes?.development?.[1] || 0) > 0).map(c => ({ c, t })));
    const pool = (L.coaches || []).filter(c => c.attributes).map(c => ({ c, t: null }));
    const row = ({ c, t }) => `<fieldset class="frame"><legend>${esc(c.fn)} ${esc(c.ln)} · ${t ? esc(t.shortName) : 'Free agent'}</legend>
      ${['development', 'motivation', 'leadership'].map(k => `${edStep(k[0].toUpperCase() + k.slice(1) + ' now', c.attributes[k][0], 'edCoach', `data-id="${c.id}" data-k="${k}" data-w="0"`)}${edStep('&nbsp;&nbsp;max', c.attributes[k][1], 'edCoach', `data-id="${c.id}" data-k="${k}" data-w="1"`)}`).join('')}</fieldset>`;
    body = `<p class="note small">Each coach's three skill-tree levels (current and max): Development, Motivation (culture) and Leadership (scheme).</p>${[...staffs, ...pool].map(row).join('')}`;
  } else {
    const missing = edPlayers(L).filter(p => !p.traits || !Object.values(p.traits).some(v => v > 0)).length;
    body = `<fieldset class="frame"><legend>Traits</legend><p class="note small">${missing} players have no traits set. Open a player from a team's roster to edit his, or fill the empty ones with the app's judgments (real careers for known players, generated for the rest).</p>
      <button class="btn" data-act="edFillTraits">Fill empty traits</button></fieldset>
      <fieldset class="frame"><legend>Export</legend><p class="note small">Writes the league file with your edits. Start a new save from it in the game.</p><button class="btn focus" data-act="${state.leagueFile ? 'download' : 'downloadLeague'}">💾 Download League File</button></fieldset>
      ${state.leagueFile ? '' : '<fieldset class="frame"><legend>Stats</legend><button class="btn" data-act="openLeaders" data-m="ratings">🏀 League Leaders</button></fieldset>'}`;
  }
  layout({ title: 'League Editor', body: head + body });
};
// The app's own read of a team next to the game's tag (its extra steps are Favorites and Selling).
function appTier(t) {
  try { return TIER_NAMES[teamStanding(league(), t).tier] || '—'; } catch { return ED_TAGS[t.status ?? 0] || '—'; }
}
actions.edTab = d => replace('editor', { tab: d.t });
actions.edTeam = d => replace('editor', { tab: 'teams', tid: d.id === '' ? undefined : +d.id });
actions.edFans = d => { const t = league().teams.find(x => x.id === +d.id); t.frontOffice.fans = Math.max(0, Math.min(100, (t.frontOffice.fans ?? 0) + 5 * +d.d)); state.dirty = true; render(); };
actions.edTag = d => { const t = league().teams.find(x => x.id === +d.id); t.status = +d.v; state.dirty = true; render(); };
actions.edCoins = d => { const t = league().teams.find(x => x.id === +d.id); t.frontOffice.coins = Math.max(0, (t.frontOffice.coins ?? 0) + 50 * +d.d); state.dirty = true; render(); };
actions.edFac = d => {
  const t = league().teams.find(x => x.id === +d.id), fac = FX.facilityOf(t, d.k);
  if (!fac) { toast('No such building on this team', '', 2400, true); return; }
  fac.tier = Math.max(1, Math.min(FX.MAX_FAC_TIER, FX.tierIn(t, d.k) + +d.d));
  state.dirty = true; render();
};
actions.edBlock = d => { const p = edPlayers(league()).find(x => x.id === +d.id); if (p?.season) { p.season.onTradeBlock = +d.v; state.dirty = true; render(); } };
actions.edPlayer = d => {
  const L = league(), p = edPlayers(L).find(x => x.id === +d.id);
  if (!p) return;
  p.traits ||= {};
  for (const t of ED_TRAITS) p.traits[t.k] ??= 0;
  const box = overlay('');
  const paint = () => {
    box.querySelector('.box').innerHTML = `<p class="note"><b>${esc(playerName(p))}</b> ${lvTag(p)}<br><span class="small muted">Contract, morale and traits (0 = unset)</span></p>
      ${p.contract?.sal ? `<div class="pts-row"><span class="grow small">Salary $M</span><button class="btn square" data-c="sal" data-d="-0.5">−</button><span class="pts-val">${p.contract.sal}</span><button class="btn square" data-c="sal" data-d="0.5">+</button></div>
      <div class="pts-row"><span class="grow small">Years left</span><button class="btn square" data-c="yrs" data-d="-1">−</button><span class="pts-val">${p.contract.yrs}</span><button class="btn square" data-c="yrs" data-d="1">+</button></div>` : ''}
      ${p.season && p.season.morale !== undefined ? `<div class="pts-row"><span class="grow small">Morale</span><button class="btn square" data-m="1" data-d="-1">−</button><span class="pts-val">${p.season.morale}</span><button class="btn square" data-m="1" data-d="1">+</button></div>` : ''}
      ${state.leagueFile ? '' : '<button class="btn small" data-prof>Full profile</button>'}
      ${ED_TRAITS.map(t => `<div class="pts-row"><span class="grow small">${esc(t.lo)} ↔ ${esc(t.hi)}</span><button class="btn square" data-k="${t.k}" data-d="-1">−</button><span class="pts-val">${p.traits[t.k]}</span><button class="btn square" data-k="${t.k}" data-d="1">+</button></div>`).join('')}
      <button class="btn off" data-close>Done</button>`;
  };
  box.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { box.remove(); render(); return; }
    if (e.target.closest('[data-prof]')) { box.remove(); go('player', { id: p.id }); return; }
    const c = e.target.closest('[data-c]'), m = e.target.closest('[data-m]');
    if (c) { const k = c.dataset.c; p.contract[k] = Math.max(k === 'yrs' ? 1 : 0.5, Math.round((p.contract[k] + +c.dataset.d) * 2) / 2); state.dirty = true; paint(); return; }
    if (m) { p.season.morale = Math.max(0, Math.min(100, p.season.morale + 5 * +m.dataset.d)); state.dirty = true; paint(); return; }
    const b = e.target.closest('[data-k]');
    if (!b) return;
    p.traits[b.dataset.k] = Math.max(0, Math.min(20, p.traits[b.dataset.k] + +b.dataset.d));
    state.dirty = true;
    paint();
  });
  paint();
};
actions.edFillTraits = () => { const n = fillTraits(league()); state.dirty = true; toast(`Traits set for ${n} players`); render(); };
actions.edCoach = d => {
  const c = [...league().teams.flatMap(t => t.frontOffice?.staff || []), ...(league().coaches || [])].find(x => x.id === +d.id);
  if (!c) return;
  const a = c.attributes[d.k], w = +d.w;
  a[w] = Math.max(0, Math.min(20, a[w] + +d.d));
  if (a[0] > a[1]) { if (w === 0) a[1] = a[0]; else a[0] = a[1]; }
  state.dirty = true; render();
};
// Who holds team `orig`'s pick for a year and round: an outright entry in some
// roster's list, else the team itself.
function pickHolder(L, orig, yr, rd) {
  for (const t of L.teams) if (t.draftPicks.some(p => p.yr === yr && p.rd === rd && p.otid === orig)) return t;
  return L.teams.find(t => t.id === orig);
}
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset?.act === 'edPickTeam') replace('editor', { tab: 'picks', tid: +el.value });
  if (el.dataset?.act === 'edPickTo' && el.value) {
    const L = league(), orig = +el.dataset.tid, yr = +el.dataset.yr, rd = +el.dataset.rd;
    const from = pickHolder(L, orig, yr, rd), to = L.teams.find(x => x.id === +el.value);
    const pk = from.draftPicks.find(x => x.yr === yr && x.rd === rd && x.otid === orig);
    if (pk) from.draftPicks.splice(from.draftPicks.indexOf(pk), 1);
    const moved = pk || { pk: 0, rd, tid: to.id, otid: orig, yr };
    moved.tid = to.id;
    to.draftPicks.push(moved);
    state.dirty = true;
    toast(`${yr} R${rd} to ${to.shortName}`);
    replace('editor', { tab: 'picks', tid: orig });
  }
});

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
