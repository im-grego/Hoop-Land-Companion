// Usage: node tests/mentorship.test.mjs <season file with rosters>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSave, isLeveled, isFreeSkill, isEliteSkill, POSITIONS } from '../js/savefile.js';
import { DEFAULT_PARAMS as P, buildSkillProfiles } from '../js/progression.js';
import { mentorPairs, runMentorship, describe } from '../js/mentorship.js';

const L = parseSave(readFileSync(process.argv[2], 'utf8')).seasonLeagues[0];
const profiles = buildSkillProfiles(L.teams.flatMap(t => t.roster));
const pairs = L.teams.flatMap(t => mentorPairs(t.roster, P, profiles));
for (const { mentor, mentee, skills } of pairs) {
  assert.ok(mentor.age >= P.mentorMinAge && mentee.age <= P.menteeMaxAge);
  assert.ok(Math.abs(mentor.pos - mentee.pos) <= P.mentorPosRange);
  for (const id of skills) {
    const s = mentor.skills.find(x => x.id === id);
    assert.ok(s.level >= (isLeveled(id) ? P.mentorSkillMinLevel : 1), 'mentor knows it well enough');
    assert.ok(!mentee.skills.some(x => x.id === id && x.level >= 1), 'mentee lacks it');
    assert.ok(!isFreeSkill(id), 'free skills are not taught');
    assert.ok(!isEliteSkill(id), 'elite skills are not taught by default');
  }
}
const before = new Map(L.teams.flatMap(t => t.roster).map(p => [p.id, p.skills.filter(s => s.level >= 1).length]));
const done = runMentorship(L.teams, P, profiles, 2027);
const mentees = new Set(), mentors = new Set();
for (const m of done) {
  assert.ok(!mentees.has(m.mentee.id), 'one skill per mentee');
  assert.ok(!mentors.has(m.mentor.id), 'one mentee per mentor');
  mentees.add(m.mentee.id); mentors.add(m.mentor.id);
  const s = m.mentee.skills.find(x => x.id === m.skill);
  assert.ok(s && s.level === 1 && s.equipped, 'skill unlocked');
  assert.equal(m.mentee.skills.filter(x => x.level >= 1).length, before.get(m.mentee.id) + 1);
}
console.log(`mentorship OK: ${pairs.length} possible pairs, ${done.length} CPU mentorships`);
for (const m of done.slice(0, 6)) console.log(`  ${m.team.shortName}: ${describe(m)} (${m.mentor.age} ${POSITIONS[m.mentor.pos]} → ${m.mentee.age} ${POSITIONS[m.mentee.pos]})`);
