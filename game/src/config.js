// SOLMAR HEAT — every tuning number, colour and constant in one place.
// A top-down open-world crime game: the city of Solmar, explored on foot and
// by car. The playfield is a 1280x720 logical area; the renderer scales it to
// the window, so no rule below depends on the screen size.

export const VIEW = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second. */
export const STEP = 1 / 60;

/** City layout: a grid of blocks split by roads, with a beach on the south edge. */
export const CITY = {
  blocks: 7, // blocks across and down
  block: 330, // side of one city block, in world units
  road: 110, // width of a road
  get size() {
    return this.blocks * this.block + (this.blocks + 1) * this.road;
  },
};

/** Road centre lines, derived from the grid: road i runs at this coordinate. */
export function roadCenters() {
  const list = [];
  for (let i = 0; i <= CITY.blocks; i += 1) list.push(CITY.road / 2 + i * (CITY.block + CITY.road));
  return list;
}
/** True when the point is on a road (within the asphalt, not a sidewalk). */
export function onRoad(x, y) {
  const centers = roadCenters();
  const half = CITY.road / 2 - 14; // sidewalks eat the outer 14 units
  for (const c of centers) {
    if (Math.abs(x - c) < half || Math.abs(y - c) < half) return true;
  }
  return false;
}
/** Nearest road centre to a coordinate. */
export function nearestRoadCoord(v) {
  const centers = roadCenters();
  let best = centers[0];
  for (const c of centers) if (Math.abs(c - v) < Math.abs(best - v)) best = c;
  return best;
}

export const PLAYER = {
  radius: 13,
  walk: 175,
  run: 265,
  health: 100,
  punchDamage: 34,
  punchRange: 34,
  punchCooldown: 0.45,
};

export const WEAPON = {
  name: 'Pistol',
  damage: 34,
  mag: 12,
  reserve: 96,
  fireRate: 0.16,
  reloadTime: 1.1,
  bulletSpeed: 900,
  range: 520,
};

export const CAR_MODELS = [
  { name: 'Civic Runabout', top: 430, accel: 300, grip: 3.4, color: '#c94f43', price: 0 },
  { name: 'Sedan Royale', top: 470, accel: 320, grip: 3.6, color: '#3f6fb5', price: 0 },
  { name: 'Taxi Solmar', top: 450, accel: 310, grip: 3.5, color: '#e8b93c', price: 0 },
  { name: 'Interceptor GT', top: 640, accel: 460, grip: 4.6, color: '#d8d8e0', price: 0 },
  { name: 'Pickup Bravo', top: 480, accel: 340, grip: 3.2, color: '#4d8a4a', price: 0 },
  { name: 'Van Cargo', top: 390, accel: 260, grip: 3.0, color: '#8a8f96', price: 0 },
  { name: 'Coupe Diablo', top: 690, accel: 500, grip: 4.9, color: '#b03060', price: 0 },
  { name: 'Cruiser Classic', top: 420, accel: 280, grip: 3.1, color: '#2f6f6a', price: 0 },
];
export const CAR = { length: 52, width: 26, health: 100, enterRange: 70 };

export const TRAFFIC = { count: 22, minSpeed: 120, maxSpeed: 210 };
export const PEDS = { count: 46 };

export const POLICE = {
  carTop: 560,
  carAccel: 420,
  maxCars: 4,
  officerSpeed: 205,
  arrestRange: 26,
  ramDamage: 9,
  spawnDistance: 700,
};

export const WANTED = {
  max: 5,
  decayDelay: 9, // seconds unseen before a star starts to fade
  decayPerStar: 6, // seconds per star once fading
  stealCar: 1,
  hitPed: 1,
  killPed: 2,
  shoot: 1,
  killCop: 2,
  missionHeat: 2,
};

/** Day cycle: the clock runs 1 game-hour per 40 real seconds, starting at 17:20. */
export const CLOCK = { startHour: 17.33, secondsPerHour: 40 };

export const PALETTE = {
  grass: '#5d8a4a',
  grassDark: '#527c42',
  sand: '#d9c08a',
  water: '#2f7fa8',
  waterDeep: '#256b90',
  asphalt: '#3a3d44',
  asphaltDark: '#33363d',
  sidewalk: '#9a9a92',
  curb: '#7d7d76',
  lane: '#d8c95a',
  buildingRoof: ['#b5673f', '#7a6a9a', '#4f7d8c', '#96684a', '#6a7a5a', '#8c4f5a'],
  buildingEdge: '#00000055',
  tree: '#2f6b33',
  treeLight: '#3f8a3f',
  player: '#f2c94c',
  playerShirt: '#e8452c',
  pedShirt: ['#7fb069', '#e07a5f', '#81b29a', '#f2cc8f', '#a78bfa', '#ef8354'],
  police: '#2244aa',
  policeLight: '#ff2e2e',
  policeLight2: '#2e7dff',
  hud: '#f5f1e6',
  hudDim: '#cfc9b8',
  star: '#ffd23f',
  mission: '#ffd23f',
  money: '#7ddc7d',
  danger: '#ff4d4d',
  panel: 'rgba(12, 14, 20, 0.82)',
  panelEdge: '#f2c94c',
};

export const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
export const FONT_DISPLAY = '"Arial Black", "Trebuchet MS", sans-serif';

/** Where the save lives between visits (this browser only). */
export const SAVE_KEY = 'solmar-heat.save.v1';
export const BEST_KEY = 'solmar-heat.best.v1';

export const START_MONEY = 250;
export const DEBT_TOTAL = 50000;
