// The game's 102 quick plays by play number (0-101), read off its Playbook
// screen: [number, name, ball handler's position 1-5]. A name alone is not
// unique (Iso 1 exists once per ball handler); the number is.
export const PLAYS = [
  [0, 'Flex 1-5 PNR', 1],
  [1, 'Flex 1-5 PNP', 1],
  [2, 'Flex 1-4 PNR', 1],
  [3, 'Flex 1-4 PNP', 1],
  [4, 'Flex 2-5 PNR', 2],
  [5, 'Flex 2-5 PNP', 2],
  [6, 'Flex 2-4 PNR', 2],
  [7, 'Flex 2-4 PNP', 2],
  [8, 'Horns 3', 1],
  [9, 'Horns 2', 1],
  [10, 'Motion 5', 1],
  [11, 'Motion 4', 1],
  [12, 'Flex 3-5 PNR', 3],
  [13, 'Flex 3-5 PNP', 3],
  [14, 'Flex 3-4 PNR', 3],
  [15, 'Flex 3-4 PNP', 3],
  [16, 'Iso 2', 1],
  [17, 'Iso 3', 1],
  [18, 'Motion 5', 2],
  [19, 'Motion 4', 2],
  [20, 'Motion 3', 2],
  [21, 'Motion 3', 1],
  [22, 'Motion 2', 1],
  [23, 'Motion 5', 3],
  [24, 'Motion 4', 3],
  [25, 'Motion 2', 3],
  [26, 'Motion 5', 4],
  [27, 'Motion 3', 4],
  [28, 'Motion 2', 4],
  [29, 'Motion 4', 5],
  [30, 'Motion 3', 5],
  [31, 'Motion 2', 5],
  [32, 'Iso 4', 1],
  [33, 'Iso 5', 1],
  [34, 'Iso 1', 2],
  [35, 'Iso 3', 2],
  [36, 'Iso 4', 2],
  [37, 'Iso 5', 2],
  [38, 'Iso 1', 3],
  [39, 'Iso 2', 3],
  [40, 'Iso 4', 3],
  [41, 'Iso 5', 3],
  [42, 'Iso 1', 4],
  [43, 'Iso 2', 4],
  [44, 'Iso 3', 4],
  [45, 'Iso 5', 4],
  [46, 'Iso 1', 5],
  [47, 'Iso 2', 5],
  [48, 'Iso 3', 5],
  [49, 'Iso 4', 5],
  [50, 'Flex 4-1 PNR', 4],
  [51, 'Flex 4-1 PNP', 4],
  [52, 'Flex 4-2 PNR', 4],
  [53, 'Flex 4-2 PNP', 4],
  [54, 'Flex 4-3 PNR', 4],
  [55, 'Flex 4-3 PNP', 4],
  [56, 'Flex 5-1 PNR', 5],
  [57, 'Flex 5-1 PNP', 5],
  [58, 'Flex 5-2 PNR', 5],
  [59, 'Flex 5-2 PNP', 5],
  [60, 'Flex 5-3 PNR', 5],
  [61, 'Flex 5-3 PNP', 5],
  [62, 'Horns 4', 1],
  [63, 'Horns 5', 1],
  [64, 'Horns 1', 2],
  [65, 'Horns 3', 2],
  [66, 'Horns 4', 2],
  [67, 'Horns 5', 2],
  [68, 'Horns 1', 3],
  [69, 'Horns 2', 3],
  [70, 'Horns 4', 3],
  [71, 'Horns 5', 3],
  [72, 'Horns 1', 4],
  [73, 'Horns 2', 4],
  [74, 'Horns 3', 4],
  [75, 'Horns 5', 4],
  [76, 'Horns 1', 5],
  [77, 'Horns 2', 5],
  [78, 'Horns 3', 5],
  [79, 'Horns 4', 5],
  [80, 'High Post 2', 1],
  [81, 'High Post 3', 1],
  [82, 'High Post 4', 1],
  [83, 'High Post 5', 1],
  [84, 'High Post 3', 2],
  [85, 'High Post 4', 2],
  [86, 'High Post 5', 2],
  [87, 'High Post 2', 3],
  [88, 'High Post 4', 3],
  [89, 'High Post 5', 3],
  [90, 'High Post 2', 4],
  [91, 'High Post 3', 4],
  [92, 'High Post 5', 4],
  [93, 'High Post 2', 5],
  [94, 'High Post 3', 5],
  [95, 'High Post 4', 5],
  [96, '5-Out 2', 1],
  [97, '5-Out 3', 1],
  [98, '5-Out 4', 2],
  [99, '5-Out 5', 2],
  [100, '5-Out 4', 3],
  [101, '5-Out 5', 3],
];
const BY_ID = new Map(PLAYS.map(p => [p[0], { id: p[0], name: p[1], ball: p[2] }]));
export const MAX_PLAY = PLAYS.length - 1;
export const getPlay = id => BY_ID.get(id) || null;
export const playName = id => BY_ID.get(id)?.name || `#${id}`;
export const playType = id => {
  const n = BY_ID.get(id)?.name || '';
  return n.startsWith('Flex') ? (n.endsWith('PNP') ? 'Pick-and-pop' : 'Pick-and-roll') : n.replace(/ \d.*$/, '');
};

// Positions (1 PG - 5 C) a play involves: the ball handler plus the named
// partner (Flex 4-1 is the 4 and the 1; Iso 3 is the ball handler and the 3).
export function involves(id, pos) {
  const p = BY_ID.get(id);
  if (!p) return false;
  const nums = p.name.match(/\d/g).map(Number);
  return p.ball === pos || nums.includes(pos);
}
export const playsFor = pos => PLAYS.map(p => p[0]).filter(id => involves(id, pos));

// Play families a style is built from.
const FAMILY = {
  PNR: p => p.name.endsWith('PNR'),
  PNP: p => p.name.endsWith('PNP'),
  Motion: p => p.name.startsWith('Motion'),
  Iso: p => p.name.startsWith('Iso'),
  Horns: p => p.name.startsWith('Horns'),
  Post: p => p.name.startsWith('High Post'),
  Out5: p => p.name.startsWith('5-Out'),
};
// Four plays per position from a recipe like ['PNR', 'PNP', 'Iso']: each
// step takes the next unused play of that family involving the position,
// ones built around him first (he has the ball in a Flex, or is the one the
// set is called for: Iso 3, Horns 3); padded from his other plays.
function pick(pos, recipe) {
  const mine = playsFor(pos);
  const rank = id => { const p = BY_ID.get(id); return (p.name.startsWith('Flex') ? p.ball : +p.name.match(/\d$/)[0]) === pos ? 0 : p.ball === pos ? 1 : 2; };
  const order = [...mine].sort((a, b) => rank(a) - rank(b) || a - b);
  const out = [];
  for (const key of recipe) {
    const id = order.find(x => !out.includes(x) && FAMILY[key](BY_ID.get(x)));
    if (id !== undefined) out.push(id);
  }
  for (const id of order) if (out.length < 4 && !out.includes(id)) out.push(id);
  return out.slice(0, 4);
}
// Offensive styles: a few families blended into one way of playing.
export const PRESETS = [
  { name: 'Pace and Space', blurb: 'Pick-and-rolls and pops that open the floor, with an iso when the screen is blown up. Guard-led.', recipe: ['PNR', 'PNR', 'PNP', 'Iso'] },
  { name: 'Flow Offense', blurb: 'Motion and Horns keep the ball moving; a pick-and-pop gives a shooter the final look. Ball movement teams.', recipe: ['Motion', 'Motion', 'Horns', 'PNP'] },
  { name: 'Iso and Spread', blurb: 'Hand the ball to your best scorers and clear the floor, with 5-out looks to space it. Star-driven teams.', recipe: ['Iso', 'Iso', 'Motion', 'Out5'] },
  { name: 'Inside-Out', blurb: 'Run it through the high post, add a pick-and-roll for the guards and a Horns set to free the shooters. Big-man hub.', recipe: ['Post', 'Post', 'PNR', 'Horns'] },
  { name: 'Shooters\' Horns', blurb: 'Horns sets that screen for shooters, a pop for the big man, and 5-out spacing. Floor-spacing teams.', recipe: ['Horns', 'Horns', 'PNP', 'Out5'] },
  { name: 'Half-Court Grind', blurb: 'Slow it down: post entries, Horns and a pick-and-roll, with one iso for a bailout. Physical, defensive teams.', recipe: ['Post', 'Horns', 'PNR', 'Iso'] },
  { name: 'Balanced Attack', blurb: 'One of everything: pick-and-roll, motion, Horns and an iso. A safe default.', recipe: ['PNR', 'Motion', 'Horns', 'Iso'] },
];
export const presetPlays = preset => ({ positions: [1, 2, 3, 4, 5].map(pos => ({ plays: pick(pos, preset.recipe) })) });
