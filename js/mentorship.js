// Mentorship: in the offseason a veteran teaches a young teammate at a
// similar position one of their skills, unlocking it (level 1).

import { isLeveled, isFreeSkill, isEliteSkill, meetsEliteRequirement, playerName, skillName } from './savefile.js';
import { rankSkillsFor, unlockSkill, mulberry32 } from './progression.js';

const owns = (p, id) => p.skills.some(s => s.id === id && s.level >= 1);

// Skills a mentor can pass on to a mentee, best fit for the mentee first.
// Free skills (Highlight Reel, Spark Plug, Dimer, Clamps) aren't taught, and
// elite skills only when allowed and the mentee meets the 16/20 requirement.
export function teachableSkills(mentor, mentee, params, profiles) {
  const eliteOk = id => params.mentorTeachElite && meetsEliteRequirement(mentee, id) === true;
  const can = new Set(mentor.skills
    .filter(s => !isFreeSkill(s.id) && (!isEliteSkill(s.id) || eliteOk(s.id)))
    .filter(s => s.level >= 1 && (!isLeveled(s.id) || s.level >= params.mentorSkillMinLevel))
    .map(s => s.id)
    .filter(id => !owns(mentee, id)));
  const ranked = rankSkillsFor(mentee, profiles).filter(r => can.has(r.id)).map(r => r.id);
  // Skills with no league profile still count, after the ranked ones.
  return [...ranked, ...[...can].filter(id => !ranked.includes(id))];
}

export const canMentor = (p, params) => p.age >= params.mentorMinAge;
export const canBeMentored = (p, params) => p.age <= params.menteeMaxAge;

// Every possible pairing on a roster.
export function mentorPairs(roster, params, profiles) {
  const out = [];
  for (const mentor of roster.filter(p => canMentor(p, params))) {
    for (const mentee of roster.filter(p => canBeMentored(p, params))) {
      if (Math.abs(mentor.pos - mentee.pos) > params.mentorPosRange) continue;
      const skills = teachableSkills(mentor, mentee, params, profiles);
      if (skills.length) out.push({ mentor, mentee, skills });
    }
  }
  return out;
}

// CPU mentorship across teams: each mentor (oldest first) picks one skill
// and teaches it to up to `mentorMaxMentees` young teammates who haven't
// learned anything yet this offseason. Mutates players.
// Returns [{ team, mentor, mentee, skill }].
export function runMentorship(teams, params, profiles, seed) {
  const rng = mulberry32(seed ^ 0x6d3e7);
  const done = [];
  for (const team of [...teams].sort((a, b) => a.id - b.id)) {
    const taught = new Set();
    const mentors = team.roster.filter(p => canMentor(p, params)).sort((a, b) => b.age - a.age || a.id - b.id);
    for (const mentor of mentors) {
      if (rng() * 100 >= params.mentorshipChance) continue;
      const options = mentorPairs(team.roster, params, profiles)
        .filter(x => x.mentor === mentor && !taught.has(x.mentee.id));
      if (!options.length) continue;
      // Youngest mentee at the closest position sets the skill; others who
      // can also learn that skill join, up to the limit.
      options.sort((a, b) => a.mentee.age - b.mentee.age ||
        Math.abs(a.mentor.pos - a.mentee.pos) - Math.abs(b.mentor.pos - b.mentee.pos));
      const skill = options[0].skills[0];
      for (const o of options.filter(x => x.skills.includes(skill)).slice(0, params.mentorMaxMentees)) {
        unlockSkill(o.mentee, skill);
        taught.add(o.mentee.id);
        done.push({ team, mentor, mentee: o.mentee, skill });
      }
    }
  }
  return done;
}

export function describe(m) {
  return `${playerName(m.mentor)} → ${playerName(m.mentee)}: ${skillName(m.skill)}`;
}
