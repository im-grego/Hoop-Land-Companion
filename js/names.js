// Names and skin tones for players from outside the US, by country. Each
// country maps to a naming group (a pool of first and last names) and a rough
// skin-tone band (perceived brightness, 0 dark to 1 light) the look is drawn from.

const G = {
  canada: { f: ['Liam', 'Owen', 'Ethan', 'Nathan', 'Gabriel', 'Mathieu', 'Olivier', 'Xavier', 'Dylan', 'Tristan', 'Nolan', 'Quinn', 'Elijah', 'Dillon', 'Tyson', 'Jaden'], l: ['Gagnon', 'Tremblay', 'Roy', 'Bouchard', 'Campbell', 'MacDonald', 'Murphy', 'Singh', 'Sandhu', 'Bennett', 'Fraser', 'Wilson', 'Lavoie', 'Pelletier', 'Morin', 'Clarke'], skin: [0.3, 0.85] },
  oceania: { f: ['Jack', 'Thomas', 'Mitch', 'Josh', 'Callum', 'Lachlan', 'Harrison', 'Angus', 'Tane', 'Jaylen', 'Riley', 'Hayden', 'Cooper', 'Mason', 'Kieran'], l: ['Walker', 'Smith', 'Brown', 'Cooper', 'Hughes', 'Kelly', 'Murray', 'Taylor', 'Wilson', 'Ross', 'Parata', 'Tuhoro', 'Mills', 'Hall', 'Young', 'Foster'], skin: [0.45, 0.88] },
  france: { f: ['Theo', 'Hugo', 'Mathis', 'Lucas', 'Nolan', 'Ousmane', 'Bilal', 'Yanis', 'Axel', 'Enzo', 'Maxime', 'Victor', 'Adam', 'Rayan', 'Tidjane', 'Malo'], l: ['Martin', 'Bernard', 'Dubois', 'Moreau', 'Laurent', 'Lefebvre', 'Girard', 'Diallo', 'Traore', 'Konate', 'Camara', 'Fofana', 'Sylla', 'Coulibaly', 'Bamba', 'Petit'], skin: [0.3, 0.85] },
  german: { f: ['Lukas', 'Jonas', 'Leon', 'Felix', 'Maximilian', 'Moritz', 'Tim', 'Niklas', 'Paul', 'Finn', 'Kilian', 'Jannik', 'Ben', 'Elias', 'Noah'], l: ['Muller', 'Schmidt', 'Fischer', 'Weber', 'Wagner', 'Becker', 'Hoffmann', 'Schulz', 'Koch', 'Richter', 'Bauer', 'Keller', 'Lehmann', 'Kruger', 'Vogel'], skin: [0.6, 0.88] },
  latin: { f: ['Mateo', 'Santiago', 'Diego', 'Alejandro', 'Javier', 'Sergio', 'Pablo', 'Carlos', 'Rafael', 'Joaquin', 'Luis', 'Emilio', 'Andres', 'Marcos', 'Nicolas', 'Adrian'], l: ['Garcia', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Ramirez', 'Torres', 'Flores', 'Rivera', 'Sanchez', 'Navarro', 'Castillo', 'Morales', 'Ortega', 'Vega'], skin: [0.4, 0.72] },
  brazil: { f: ['Joao', 'Pedro', 'Gabriel', 'Lucas', 'Rafael', 'Thiago', 'Matheus', 'Vitor', 'Bruno', 'Caio', 'Felipe', 'Gustavo'], l: ['Souza', 'Oliveira', 'Costa', 'Lima', 'Silva', 'Santos', 'Pereira', 'Almeida', 'Ribeiro', 'Carvalho', 'Barbosa', 'Rocha'], skin: [0.25, 0.75] },
  italy: { f: ['Matteo', 'Luca', 'Marco', 'Federico', 'Alessandro', 'Davide', 'Riccardo', 'Simone', 'Nicolo', 'Andrea', 'Lorenzo', 'Tommaso'], l: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Conti', 'Gallo'], skin: [0.55, 0.85] },
  balkan: { f: ['Nikola', 'Marko', 'Luka', 'Stefan', 'Filip', 'Dusan', 'Vasilije', 'Aleksa', 'Ivan', 'Mateo', 'Jakov', 'Bogdan', 'Milos', 'Dario', 'Petar'], l: ['Jovanovic', 'Petrovic', 'Markovic', 'Nikolic', 'Djordjevic', 'Ilic', 'Kovacevic', 'Horvat', 'Babic', 'Novak', 'Kovac', 'Vidmar', 'Pavlovic', 'Stojanovic', 'Radovic'], skin: [0.55, 0.85] },
  greek: { f: ['Giorgos', 'Nikos', 'Dimitris', 'Kostas', 'Panagiotis', 'Thanasis', 'Vasilis', 'Yannis', 'Alexandros', 'Christos'], l: ['Papadopoulos', 'Georgiou', 'Nikolaidis', 'Dimitriou', 'Katsaros', 'Antonopoulos', 'Karras', 'Vasiliou', 'Makris', 'Pappas'], skin: [0.5, 0.78] },
  turkish: { f: ['Emre', 'Mert', 'Can', 'Burak', 'Kerem', 'Arda', 'Ege', 'Baris', 'Furkan', 'Yigit'], l: ['Yilmaz', 'Demir', 'Kaya', 'Celik', 'Sahin', 'Ozturk', 'Aydin', 'Yildiz', 'Arslan', 'Dogan'], skin: [0.5, 0.78] },
  baltic: { f: ['Mantas', 'Tomas', 'Arnas', 'Domantas', 'Janis', 'Kristaps', 'Rihards', 'Davis', 'Rokas', 'Matas'], l: ['Kazlauskas', 'Jankauskas', 'Petrauskas', 'Stankevicius', 'Berzins', 'Ozols', 'Kalnins', 'Liepins', 'Butkus', 'Vaitkus'], skin: [0.6, 0.88] },
  slavic: { f: ['Jakub', 'Mateusz', 'Michal', 'Kacper', 'Filip', 'Oleksandr', 'Maksym', 'Danylo', 'Artem', 'Bohdan', 'Tomas', 'Pavel'], l: ['Kowalski', 'Nowak', 'Wisniewski', 'Wojcik', 'Kaminski', 'Kovalenko', 'Shevchenko', 'Bondarenko', 'Tkachenko', 'Novotny', 'Dvorak', 'Svoboda'], skin: [0.6, 0.88] },
  nordic: { f: ['Lauri', 'Mikko', 'Eero', 'Aleksi', 'Elias', 'Oskar', 'Erik', 'Anders', 'Emil', 'Magnus'], l: ['Korhonen', 'Virtanen', 'Makinen', 'Nieminen', 'Laine', 'Andersson', 'Johansson', 'Nilsson', 'Hansen', 'Larsen'], skin: [0.62, 0.9] },
  british: { f: ['Oliver', 'Harry', 'George', 'Jack', 'Charlie', 'Callum', 'Reece', 'Jordan', 'Marcus', 'Leon'], l: ['Smith', 'Jones', 'Taylor', 'Williams', 'Davies', 'Evans', 'Thomas', 'Roberts', 'Walker', 'Wright', 'Hughes', 'Murphy'], skin: [0.3, 0.85] },
  nigerian: { f: ['Chukwuemeka', 'Obi', 'Emeka', 'Tobi', 'Chidi', 'Kelechi', 'Uche', 'Femi', 'Seun', 'Ade', 'Ikenna', 'Tunde'], l: ['Okafor', 'Adebayo', 'Okonkwo', 'Nwosu', 'Eze', 'Balogun', 'Ogunleye', 'Olawale', 'Chukwu', 'Adeyemi', 'Obi', 'Mensah'], skin: [0.1, 0.32] },
  francoafrican: { f: ['Mamadou', 'Ibrahima', 'Cheikh', 'Moussa', 'Babacar', 'Amadou', 'Souleymane', 'Ousmane', 'Serge', 'Christian', 'Junior', 'Abdoulaye'], l: ['Diop', 'Ndiaye', 'Sow', 'Fall', 'Diallo', 'Ba', 'Gueye', 'Sarr', 'Traore', 'Kante', 'Mbarga', 'Ngoma'], skin: [0.1, 0.32] },
  southsudan: { f: ['Majok', 'Deng', 'Wenyen', 'Bol', 'Kuol', 'Thon', 'Duop', 'Chol', 'Maker', 'Akol'], l: ['Deng', 'Bol', 'Majok', 'Kuol', 'Thon', 'Garang', 'Ajak', 'Chol', 'Mayen', 'Reath'], skin: [0.08, 0.24] },
  arab: { f: ['Omar', 'Youssef', 'Karim', 'Ahmed', 'Mohamed', 'Hassan', 'Ali', 'Amir', 'Tarek', 'Ibrahim'], l: ['Mansour', 'Haddad', 'Khalil', 'Nasser', 'Said', 'Farouk', 'Aziz', 'Hamdan', 'Saleh', 'Barakat'], skin: [0.35, 0.65] },
  israeli: { f: ['Ido', 'Yam', 'Itay', 'Omer', 'Noam', 'Tal', 'Lior', 'Guy', 'Roy', 'Ben'], l: ['Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Avraham', 'Friedman', 'Katz', 'Shapira', 'Dahan'], skin: [0.5, 0.8] },
  japanese: { f: ['Yuta', 'Kenta', 'Haruto', 'Ren', 'Sota', 'Daiki', 'Takumi', 'Shun', 'Riku', 'Hayato'], l: ['Tanaka', 'Sato', 'Suzuki', 'Takahashi', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato'], skin: [0.55, 0.76] },
  chinese: { f: ['Wei', 'Jun', 'Hao', 'Yang', 'Ming', 'Lei', 'Tao', 'Bo', 'Jian', 'Kai'], l: ['Zhang', 'Wang', 'Li', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou', 'Xu', 'Sun'], skin: [0.55, 0.76] },
  korean: { f: ['Minjun', 'Seojun', 'Jiho', 'Hyunwoo', 'Jaewon', 'Donghyun', 'Sungmin', 'Taeyang', 'Junho', 'Yoonho'], l: ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim'], skin: [0.55, 0.76] },
  filipino: { f: ['Jericho', 'Kai', 'Justin', 'Carlo', 'Miguel', 'Gabriel', 'Paolo', 'Jaymar', 'Rey', 'Mark'], l: ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Villanueva', 'Ramos', 'Aquino'], skin: [0.4, 0.68] },
  vietnamese: { f: ['Minh', 'Anh', 'Hieu', 'Quang', 'Duc', 'Tuan', 'Khoa', 'Long', 'Nam', 'Bao'], l: ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vu', 'Dang', 'Bui', 'Do', 'Ngo'], skin: [0.5, 0.74] },
  caribbean: { f: ['Kemar', 'Jamal', 'Rashad', 'Dwayne', 'Tevin', 'Andre', 'Jabari', 'Dexter', 'Kirk', 'Marlon'], l: ['Brown', 'Campbell', 'Grant', 'Henry', 'Thompson', 'Clarke', 'Ferguson', 'Pinder', 'Rolle', 'Johnson', 'Bain', 'Knowles'], skin: [0.15, 0.45] },
  hispaniccaribbean: { f: ['Juan', 'Luis', 'Angel', 'Jose', 'Rafael', 'Carlos', 'Yoel', 'Elvis', 'Wilfredo', 'Dairon'], l: ['Perez', 'Santana', 'Mejia', 'Pena', 'Cabrera', 'Rosario', 'Batista', 'Guzman', 'Ramos', 'Diaz'], skin: [0.2, 0.55] },
};
const OF = (g, codes) => codes.split(' ').forEach(c => { MAP[c] = g; });
const MAP = {};
OF('canada', 'CA'); OF('oceania', 'AU NZ FJ WS TO'); OF('france', 'FR BE CH LU MC'); OF('german', 'DE AT LI');
OF('latin', 'ES MX AR VE CO CL PE UY EC PA CR GT HN SV PY BO'); OF('brazil', 'BR PT'); OF('italy', 'IT SM MT');
OF('balkan', 'RS HR SI BA ME MK BG RO AL XK HU'); OF('greek', 'GR CY'); OF('turkish', 'TR AZ'); OF('baltic', 'LT LV EE');
OF('slavic', 'PL UA CZ SK RU BY GE AM'); OF('nordic', 'FI SE NO DK IS'); OF('british', 'UK GB IE'); OF('nigerian', 'NG GH LR SL GM');
OF('francoafrican', 'SN ML CI GN CM GA CD CG BF BJ TG MR CV'); OF('southsudan', 'SS SD ET KE UG TZ RW'); OF('arab', 'EG LB JO TN MA DZ IR IQ SY SA AE LY');
OF('israeli', 'IL'); OF('japanese', 'JP'); OF('chinese', 'CN TW HK MN'); OF('korean', 'KR'); OF('filipino', 'PH ID TH MY');
OF('vietnamese', 'VN'); OF('caribbean', 'BS JM TT BB HT BM AG LC VC GD'); OF('hispaniccaribbean', 'DO PR CU');

export const isForeign = p => !!p.ctry && !['US', ''].includes(p.ctry);
export const groupFor = ctry => G[MAP[ctry]] || null;

// A first and last name for a player from `ctry`, one not in `used`, or null when the country has no pool.
export function nameFor(rng, ctry, used = new Set()) {
  const g = groupFor(ctry);
  if (!g) return null;
  for (let i = 0; i < 60; i++) {
    const fn = g.f[Math.floor(rng() * g.f.length)], ln = g.l[Math.floor(rng() * g.l.length)];
    if (!used.has(`${fn} ${ln}`.toLowerCase())) return { fn, ln };
  }
  return { fn: g.f[Math.floor(rng() * g.f.length)], ln: g.l[Math.floor(rng() * g.l.length)] };
}

const lum = hex => { const n = parseInt(String(hex).replace('#', ''), 16) || 0; return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
// A look for that country: a skin tone in its band, with the eye, brow and hair
// colors of a player who has that tone. `rows` are [skin, eye, brow, hairC, fHairC, unibrow, ...].
export function lookFor(rng, ctry, rows) {
  const g = groupFor(ctry);
  if (!g || !rows?.length) return null;
  const [lo, hi] = g.skin;
  let fit = rows.filter(r => { const v = lum(r[0]); return v >= lo && v <= hi; });
  if (!fit.length) { const mid = (lo + hi) / 2; fit = [...rows].sort((a, b) => Math.abs(lum(a[0]) - mid) - Math.abs(lum(b[0]) - mid)).slice(0, 8); }
  const r = fit[Math.floor(rng() * fit.length)];
  return { skinC: r[0], eyeC: r[1], browC: r[2], hairC: r[3], fHairC: r[4], unibrow: !!r[5] };
}
