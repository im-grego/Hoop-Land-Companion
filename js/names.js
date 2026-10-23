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

// ---------------------------------------------------------------------------
// US names, and a namer that knows who's already in the league. Last names come from a big pool and skip any surname a
// player in the league already has, so classes don't keep turning up the same handful of families. Now and then a new
// player really is family: a brother (a different age, same hometown, the same skin and coloring) or, rarely, a twin
// (same age and hometown, the same skin, eye, brow and hair colors; only the hairstyle, facial hair and accessories
// can differ).
export const US_FIRST = ['Jalen', 'Marcus', 'Darius', 'Tyrese', 'Caleb', 'Isaiah', 'Jordan', 'Malik', 'Andre', 'Cameron', 'Elijah', 'Xavier', 'Trey', 'Devin',
  'Josiah', 'Micah', 'Amari', 'Jaylen', 'Kobe', 'Bryce', 'Kendrick', 'Dominic', 'Quentin', 'Rashad', 'Terrence', 'Corey', 'Desmond', 'Nolan', 'Mateo', 'Owen',
  'Grant', 'Tristan', 'Keegan', 'DeShawn', 'Jamal', 'Tariq', 'Khalil', 'Darnell', 'Jerome', 'Cedric', 'Brandon', 'Tyler', 'Austin', 'Cole', 'Connor', 'Ethan',
  'Mason', 'Logan', 'Aiden', 'Carter', 'Hunter', 'Chase', 'Blake', 'Reid', 'Jace', 'Kai', 'Zaire', 'Kyrie', "Ja'Kobe", 'Dametri', 'Trevon', 'Marquis', 'Javon',
  'Kameron', 'Isaac', 'Gavin', 'Landon', 'Julian', 'Adrian', 'Victor', 'Omari', 'Nasir', 'Jabari', 'Kwame', 'Emeka', 'Tobi', 'Ayo', 'Luca', 'Marco', 'Diego',
  'Rafael', 'Jamir', 'Kellen', 'Bennett', 'Wyatt', 'Sawyer', 'Asher', 'Silas', 'Rowan', 'Elias', 'Miles', 'Jett', 'Reggie', 'Lamar', 'Cortez', 'Montez',
  'Dorian', 'Ty', 'RJ', 'AJ', 'Cam', 'Dejuan', 'Keon', 'Shamar', 'Tavion', 'Jayden', 'Zion', 'Paolo', 'Cooper', 'Aaron', 'Alonzo', 'Anfernee', 'Armani',
  'Bilal', 'Brayden', 'Bronson', 'Cade', 'Calvin', 'Cedrick', 'Chance', 'Clarence', 'Collin', 'Curtis', "D'Angelo", 'Dante', 'Darian', 'Davion', 'Dawson',
  'Deandre', 'Demarcus', 'Derrick', 'Donovan', 'Dwight', 'Eli', 'Emmanuel', 'Eric', 'Ezra', 'Fred', 'Garrett', 'Gerald', 'Hakeem', 'Harrison', 'Hezekiah',
  'Ian', 'Immanuel', 'Jabril', 'Jacoby', 'Jahmir', 'Jaire', 'Jakobe', 'Jamison', 'Jarace', 'Jared', 'Jarrett', 'Jaxon', 'Jeremiah', 'Jermaine', 'Joel',
  'Jonah', 'Justice', 'Kaden', 'Kalen', 'Kasey', 'Keaton', 'Kendall', 'Kenyon', 'Kevin', 'Kiyan', 'Lance', 'Lawson', 'Leland', 'Lonnie', 'Lucas', 'Maceo',
  'Malachi', 'Marlon', 'Maurice', 'Maxwell', 'Myles', 'Nate', 'Nehemiah', 'Nico', 'Noah', 'Otis', 'Pierce', 'Quincy', 'Quinton', 'Rasheed', 'Raymond',
  'Rodney', 'Roman', 'Ronnie', 'Ryder', 'Sam', 'Semaj', 'Simeon', 'Solomon', 'Spencer', 'Sterling', 'Tahj', 'Taj', 'Talen', 'Terrell', 'Thaddeus', 'Theo',
  'Tobias', 'Torrey', 'Travis', 'Tucker', 'Tyrell', 'Vince', 'Walter', 'Wesley', 'Will', 'Xzavier', 'Yusuf', 'Zach', 'Zeke', 'Zavier'];
export const US_LAST = ['Johnson', 'Williams', 'Brown', 'Jackson', 'Harris', 'Thompson', 'Robinson', 'Walker', 'Mitchell', 'Carter', 'Bryant', 'Coleman',
  'Hayes', 'Reed', 'Brooks', 'Wallace', 'Foster', 'Simmons', 'Hughes', 'Griffin', 'Barnes', 'Fisher', 'Hunter', 'Porter', 'Dawson', 'Sutton', 'Holloway',
  'Pierce', 'Maddox', 'Vaughn', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas', 'White', 'Martin', 'Lewis', 'Lee', 'Young', 'Allen',
  'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Campbell', 'Roberts', 'Turner', 'Phillips', 'Parker', 'Evans', 'Edwards',
  'Collins', 'Stewart', 'Morris', 'Rogers', 'Cook', 'Morgan', 'Bell', 'Murphy', 'Bailey', 'Rivera', 'Cooper', 'Richardson', 'Cox', 'Howard', 'Ward',
  'Torres', 'Peterson', 'Gray', 'Ramirez', 'James', 'Watson', 'Kelly', 'Sanders', 'Price', 'Bennett', 'Wood', 'Ross', 'Henderson', 'Jenkins', 'Perry',
  'Powell', 'Long', 'Patterson', 'Washington', 'Butler', 'Alexander', 'Russell', 'Ford', 'Graham', 'Sullivan', 'Wells', 'Hamilton', 'Fletcher', 'Gordon',
  'Mack', 'Battle', 'Council', 'Holmes', 'Boykin', 'Ivey', 'Sharpe', 'McCray', 'Lockett', 'Whitfield', 'Pruitt', 'Dupree', 'Tate', 'Merriweather',
  'Strickland', 'Bledsoe', 'Abernathy', 'Akins', 'Alford', 'Ashby', 'Atkins', 'Avery', 'Banks', 'Barber', 'Barkley', 'Bates', 'Baxter', 'Beasley', 'Benson',
  'Biggs', 'Bishop', 'Blackmon', 'Blair', 'Bolden', 'Booker', 'Bowden', 'Boyd', 'Bradford', 'Bradley', 'Branch', 'Brewer', 'Bridges', 'Brock', 'Bullock',
  'Burgess', 'Burke', 'Burrell', 'Byrd', 'Caldwell', 'Calhoun', 'Cannon', 'Carmichael', 'Carr', 'Cash', 'Chambers', 'Chandler', 'Clay', 'Clemons', 'Cobb',
  'Colbert', 'Conley', 'Crawford', 'Crockett', 'Cunningham', 'Curry', 'Dalton', 'Daniels', 'Dennis', 'Dixon', 'Dorsey', 'Douglas', 'Drake', 'Dunn',
  'Easley', 'Elliott', 'Ellis', 'Emerson', 'Epps', 'Farmer', 'Felton', 'Fields', 'Finch', 'Flowers', 'Floyd', 'Franklin', 'Frazier', 'Freeman', 'Fuller',
  'Gaines', 'Gamble', 'Garner', 'Gentry', 'Gibbs', 'Gilliam', 'Glover', 'Goode', 'Grady', 'Graves', 'Greer', 'Hairston', 'Hale', 'Hammond', 'Hampton',
  'Hardaway', 'Hardin', 'Harmon', 'Harper', 'Hawkins', 'Haywood', 'Hendrix', 'Hicks', 'Hines', 'Hinton', 'Holland', 'Hooper', 'Hopkins', 'Horton', 'House',
  'Houston', 'Hubbard', 'Hudson', 'Ingram', 'Irving', 'Jefferson', 'Jennings', 'Jordan', 'Joyner', 'Keller', 'Kendrick', 'Kennedy', 'Kirkland', 'Knight',
  'Lamb', 'Lane', 'Lawson', 'Leonard', 'Little', 'Love', 'Lowe', 'Lyons', 'Mabry', 'Malone', 'Manning', 'Marsh', 'Mathis', 'Maxwell', 'McCall', 'McClain',
  'McDaniel', 'McGee', 'McKnight', 'McNeil', 'Meadows', 'Merritt', 'Middleton', 'Miles', 'Monroe', 'Montgomery', 'Moody', 'Moss', 'Murray', 'Nash', 'Neal',
  'Newsome', 'Norman', 'Norris', 'Odom', 'Oliver', 'Owens', 'Page', 'Palmer', 'Parks', 'Parrish', 'Payne', 'Pearson', 'Penn', 'Pettiford', 'Pickett',
  'Pittman', 'Pope', 'Primus', 'Quarles', 'Ragland', 'Randle', 'Randolph', 'Ray', 'Redd', 'Reese', 'Rhodes', 'Riley', 'Rivers', 'Roach', 'Robbins', 'Rowe',
  'Rucker', 'Sampson', 'Sawyer', 'Shaw', 'Shelton', 'Shields', 'Singleton', 'Slater', 'Sloan', 'Spears', 'Spencer', 'Stallworth', 'Starks', 'Steele',
  'Stokes', 'Stone', 'Summers', 'Swain', 'Talley', 'Tatum', 'Terry', 'Tillman', 'Townsend', 'Tucker', 'Tyson', 'Underwood', 'Vance', 'Wade', 'Walton',
  'Ware', 'Warren', 'Watkins', 'Weaver', 'Webb', 'Wheeler', 'Whitaker', 'Wiggins', 'Wilder', 'Wilkins', 'Willis', 'Winslow', 'Womack', 'Woodard', 'Woods',
  'Wyatt', 'Yates', 'Okafor', 'Diallo', 'Novak', 'Okoro', 'Nwosu', 'Mensah', 'Traore', 'Sy', 'Kovac', 'Jovic', 'Bianchi', 'Ferreira', 'Lindqvist', 'Ogundipe',
  'Acker', 'Aldridge', 'Ambrose', 'Arrington', 'Ayers', 'Bagley', 'Ballard', 'Barlow', 'Barrow', 'Beckett', 'Belton', 'Blanton', 'Bonner', 'Bost', 'Bowers', 'Boyce', 'Bratton', 'Breland', 'Bridgeman', 'Brinson', 'Britt', 'Bundy', 'Burch', 'Burleson', 'Burton', 'Cabell', 'Calloway', 'Carlisle', 'Carson', 'Cheek', 'Chisholm', 'Clark', 'Coates', 'Coker', 'Conway', 'Corbin', 'Covington', 'Crenshaw', 'Crisp', 'Cromartie', 'Crowder', 'Culver', 'Dancy', 'Darden', 'Deal', 'Dowdell', 'Drayton', 'Duke', 'Durant', 'Eaton', 'Echols', 'Edmonds', 'Exum', 'Faison', 'Fenner', 'Fitzgerald', 'Fogle', 'Forte', 'Fowler', 'Gadsden', 'Garland', 'Gatling', 'Gillespie', 'Goins', 'Golden', 'Grantham', 'Gregg', 'Grier', 'Gwynn', 'Haggins', 'Halsey', 'Hargrove', 'Harrell', 'Hatcher', 'Hearn', 'Hightower', 'Hobbs', 'Holcomb', 'Hollins', 'Holt', 'Hood', 'Hurd', 'Hyman', 'Inman', 'Jameson', 'Jeter', 'Kearney', 'Kemp', 'Kinard', 'Lacy', 'Langston', 'Lassiter', 'Ledbetter', 'Lyles', 'Manigault', 'Marable', 'McBride', 'McCants', 'McCoy', 'McGhee', 'McKinney', 'McMillan', 'Mercer', 'Mims', 'Mobley', 'Moseley', 'Nesbitt', 'Nixon', 'Oakley', 'Ogletree', 'Overton', 'Pace', 'Peebles', 'Petty', 'Pinkney', 'Poole', 'Pratt', 'Puckett', 'Ransom', 'Redmond', 'Rice', 'Rollins', 'Royster', 'Sales', 'Satterfield', 'Seals', 'Sherrod', 'Simms', 'Skinner', 'Spruill', 'Staton', 'Stroud', 'Swann', 'Teague', 'Thorne', 'Toliver', 'Truitt', 'Upshaw', 'Vinson', 'Waddell', 'Wakefield', 'Whitlock', 'Wimbley', 'Witherspoon', 'Wooten', 'Worthy', 'Yancey',
  'Achebe', 'Boateng', 'Kamara', 'Cissoko', 'Dabney', 'Fontenot', 'Guidry', 'Thibodeaux', 'Broussard', 'Landry', 'Delgado', 'Navarro', 'Castillo', 'Vega'];

const fullOf = p => `${p.fn} ${p.ln}`.toLowerCase();
const COLORS = ['skinC', 'eyeC', 'browC', 'hairC', 'fHairC', 'unibrow'];
const BROTHER = 0.02, TWIN = 0.004;
// Everyday American surnames: unrelated players share these all the time.
const COMMON = new Set(US_LAST.slice(0, 104));
// `players`: everyone active (pro, college, prospects): their surnames are skipped and a brother comes from them.
// `others` (retirees): surnames skipped only, so no new player echoes a legend by accident.
export function makeNamer(players, rng, others = []) {
  const lastUsed = new Map(), full = new Set();
  const add = p => { if (!p?.ln) return; const k = p.ln.toLowerCase(); (lastUsed.get(k) || lastUsed.set(k, []).get(k)).push(p); full.add(fullOf(p)); };
  for (const p of [...players, ...others]) add(p);
  // The least-used surname of a few draws. Never one already used by someone his age (that reads as a twin) or by
  // anyone in this batch; an unusual surname someone already has reads as family, so common ones (Johnson, Brown)
  // are the ones that repeat.
  const used = ln => lastUsed.get(ln.toLowerCase()) || [];
  const freshLast = (pool, p, batch) => {
    let best = null;
    for (let i = 0; i < 14; i++) {
      const ln = pool[Math.floor(rng() * pool.length)], u = used(ln);
      if (u.some(x => x.age === p.age) || batch.some(x => x.ln === ln)) continue;
      const score = u.length * (COMMON.has(ln) ? 0.25 : 1) + rng() * 0.5;
      if (!best || score < best.score) best = { ln, score };
    }
    return best?.ln || null;
  };
  const freshFirst = (pool, ln, avoid = '') => {
    for (let i = 0; i < 60; i++) { const fn = pool[Math.floor(rng() * pool.length)]; if (fn !== avoid && !full.has(`${fn} ${ln}`.toLowerCase())) return fn; }
    return pool[Math.floor(rng() * pool.length)];
  };
  // Copy the family coloring onto p (and the skin color on his sleeves).
  const family = (p, rel) => {
    const was = p.appearance?.skinC;
    p.appearance = { ...(p.appearance || {}), ...Object.fromEntries(COLORS.filter(k => rel.appearance?.[k] !== undefined).map(k => [k, rel.appearance[k]])) };
    const now = p.appearance.skinC;
    if (Array.isArray(p.accessories) && was && now && was !== now) p.accessories = p.accessories.map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === was ? now : v])));
    Object.assign(p, { home: rel.home, ctry: rel.ctry, loc: rel.loc ? { ...rel.loc } : p.loc });
  };
  return {
    // Names p (and settles his family ties). `pools` = { f, l } for his country, US by default. `batch`: players named
    // alongside him this time (a twin comes from there). Returns 'twin' | 'brother' | null.
    name(p, pools = { f: US_FIRST, l: US_LAST }, batch = []) {
      const r = rng();
      const sameCtry = x => (x.ctry || 'US') === (p.ctry || 'US');
      if (r < TWIN) {
        const t = batch.filter(x => x !== p && x.age === p.age && sameCtry(x) && !(lastUsed.get(x.ln.toLowerCase()) || []).some(y => y !== x && y.age === x.age));
        const twin = t[Math.floor(rng() * t.length)];
        if (twin) { p.ln = twin.ln; p.fn = freshFirst(pools.f, twin.ln, twin.fn); family(p, twin); add(p); return 'twin'; }
      }
      if (r < TWIN + BROTHER) {
        const b = players.concat(batch).filter(x => x !== p && x.ln && x.appearance && sameCtry(x) && x.age !== p.age && Math.abs((x.age || 0) - (p.age || 0)) <= 8 && !x.yearRetired);
        const bro = b[Math.floor(rng() * b.length)];
        if (bro && !(lastUsed.get(bro.ln.toLowerCase()) || []).some(y => y !== bro && y.age === p.age)) { p.ln = bro.ln; p.fn = freshFirst(pools.f, bro.ln, bro.fn); family(p, bro); add(p); return 'brother'; }
      }
      // Small country pools (Kim, Nguyen, Diop) can repeat a surname, as real ones do; the US pool never needs to.
      const ln = freshLast(pools.l, p, batch) || freshLast(US_LAST, p, batch) || US_LAST[Math.floor(rng() * US_LAST.length)];
      p.ln = ln; p.fn = freshFirst(pools.f, ln); add(p);
      return null;
    },
  };
}
