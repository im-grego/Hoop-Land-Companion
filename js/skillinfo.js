// What each skill does in Hoop Land (from the in-game skill screens), and how
// a scout would put it. `does` is the game's own text; `says` finishes
// "...his game" style sentences in scouting reads.
export const SKILL_INFO = {
  HIG: { does: 'Decreased stamina used for dunks', says: 'dunking barely tires him' },
  CRA: { does: 'Increased accuracy on reverse and contact layups and ability to lay it up mid-dunk', says: 'is a crafty finisher on reverses and through contact' },
  SOF: { does: 'Increased hookshot accuracy', says: 'has a soft touch on his hook' },
  TEA: { does: 'Increased floater accuracy', says: 'has a tear-drop floater' },
  BUL: { does: 'Increased chance of opponent falling when backing down', says: 'bullies defenders on the block' },
  DUN: { does: 'Increased dunk success and ability to perform acrobatic dunks', says: 'is an acrobatic dunker' },
  SPA: { does: 'Catch fire when entering the game for the first time and from the bench', says: 'sparks a team off the bench' },
  CLU: { does: 'Increased accuracy in clutch situations', says: 'has a clutch gene' },
  SPO: { does: 'Increased jumpshot accuracy after receiving a pass', says: 'is a deadly spot-up shooter' },
  VOL: { does: 'Decreased stamina used for jumpshots', says: 'can fire all night without tiring' },
  LIM: { does: 'Increased accuracy from shots deeper than 25 feet', says: 'has limitless range' },
  UNF: { does: 'Increased accuracy on contested mid range shots', says: 'is unfazed by a hand in his face' },
  DIM: { does: 'Increased teammate shot accuracy after a pass', says: 'makes his teammates\' shots easier' },
  CHE: { does: 'Catch on fire if teammate catches fire after an assist', says: 'feeds off his teammates\' hot streaks' },
  CLE: { does: 'Increased shot accuracy after an offensive rebound', says: 'finishes putbacks' },
  STE: { does: 'Increased shot accuracy after a step back, side step, or jump stop', says: 'is dangerous off a step-back' },
  FOO: { does: 'Increased time opponent stays on the floor after an ankle breaker', says: 'leaves defenders on the floor' },
  HOT: { does: 'If on fire, the ball stays hot after a pass', says: 'keeps the heat going when he passes' },
  CLA: { does: 'Increased shot contest strength', says: 'clamps down on shooters' },
  LOC: { does: 'Increased defensive ability in clutch situations', says: 'locks in late in games' },
  MAG: { does: 'Increased ability to secure contested rebounds', says: 'wins contested rebounds' },
  TWO: { does: 'Can catch and steal an opponent\'s fire from defensive plays', says: 'plays both ends and steals momentum' },
  BAL: { does: 'Increased chance of intercepting the ball on a pass deflection', says: 'is a ball hawk in the passing lanes' },
  SNA: { does: 'Increased chance of catching the ball on block attempt', says: 'snatches the ball out of the air on blocks' },
};
export const skillDoes = id => SKILL_INFO[id]?.does || '';
export const skillSays = id => SKILL_INFO[id]?.says || '';
