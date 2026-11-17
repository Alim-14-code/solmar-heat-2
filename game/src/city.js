// The city of Solmar, generated once from a seed: road grid, buildings,
// parks, a beach and a marina along the south edge, and named landmarks the
// missions and the minimap point at. Everything here is pure data — drawing
// lives in render.js, collision in world.js.
import { CITY, PALETTE, roadCenters } from './config.js';
import { chance, pick, range, rangeInt } from './random.js';

export const LANDMARKS = [
  { id: 'diner', name: "Mama Luz's Diner", kind: 'diner' },
  { id: 'docks', name: 'Solmar Docks', kind: 'docks' },
  { id: 'garage', name: "Rico's Garage", kind: 'garage' },
  { id: 'warehouse', name: 'Old Cannery Warehouse', kind: 'warehouse' },
  { id: 'bank', name: 'Solmar National Bank', kind: 'bank' },
  { id: 'hideout', name: 'Dario’s Hideout', kind: 'hideout' },
  { id: 'hospital', name: 'St. Marina Hospital', kind: 'hospital' },
  { id: 'station', name: 'Solmar PD Central', kind: 'station' },
  { id: 'beach', name: 'Playa Verde', kind: 'beach' },
  { id: 'mall', name: 'Solmar Mall', kind: 'mall' },
  { id: 'motel', name: 'Palm Court Motel', kind: 'motel' },
  { id: 'casino', name: 'Casino del Sol', kind: 'casino' },
];

/** A building: a solid rectangle the player and cars collide with. Retried
 *  until it does not overlap a building already placed in the same block. */
function makeBuilding(random, bx, by, blockSize, placed) {
  const margin = 22;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const w = range(random, 70, blockSize - margin * 2);
    const h = range(random, 60, blockSize - margin * 2);
    const x = bx + margin + range(random, 0, blockSize - margin * 2 - w);
    const y = by + margin + range(random, 0, blockSize - margin * 2 - h);
    const overlaps = placed.some((b) => x < b.x + b.w + 14 && x + w + 14 > b.x && y < b.y + b.h + 14 && y + h + 14 > b.y);
    if (overlaps) continue;
    return {
      x, y, w, h,
      color: pick(random, PALETTE.buildingRoof),
      floors: rangeInt(random, 1, 4),
      roof: chance(random, 0.35) ? 'pool' : chance(random, 0.3) ? 'garden' : 'plain',
    };
  }
  return null;
}

export function createCity(seed) {
  const random = seed;
  const centers = roadCenters();
  const blocks = [];
  const buildings = [];
  const trees = [];
  const parks = [];
  const landmarks = {};
  const size = CITY.size;

  // Blocks: the squares between roads. Each holds buildings, or a park, or a lot.
  for (let bx = 0; bx < CITY.blocks; bx += 1) {
    for (let by = 0; by < CITY.blocks; by += 1) {
      const x0 = centers[bx] + CITY.road / 2;
      const y0 = centers[by] + CITY.road / 2;
      const block = { x: x0, y: y0, w: CITY.block, h: CITY.block, kind: 'city' };
      const isSouthRow = by === CITY.blocks - 1;
      if (isSouthRow) {
        block.kind = 'beach';
      } else if (chance(random, 0.14)) {
        block.kind = 'park';
        parks.push(block);
        for (let i = 0; i < 9; i += 1) {
          trees.push({
            x: x0 + range(random, 30, CITY.block - 30),
            y: y0 + range(random, 30, CITY.block - 30),
            r: range(random, 10, 18),
          });
        }
      } else if (chance(random, 0.12)) {
        block.kind = 'lot';
      } else {
        const count = chance(random, 0.45) ? 2 : chance(random, 0.6) ? 3 : 1;
        const placed = [];
        for (let i = 0; i < count; i += 1) {
          const b = makeBuilding(random, x0, y0, CITY.block, placed);
          if (b) { placed.push(b); buildings.push(b); }
        }
      }
      blocks.push(block);
    }
  }

  // Landmarks: pick real buildings / blocks and name them, so missions point at
  // places that exist in the world rather than at bare coordinates.
  function landmarkAt(id, bx, by) {
    const x0 = centers[bx] + CITY.road / 2;
    const y0 = centers[by] + CITY.road / 2;
    const near = buildings.filter((b) => b.x >= x0 && b.x < x0 + CITY.block && b.y >= y0 && b.y < y0 + CITY.block);
    const base = near.length > 0 ? near[0] : { x: x0 + 60, y: y0 + 60, w: 120, h: 90 };
    landmarks[id] = { ...LANDMARKS.find((l) => l.id === id), x: base.x + base.w / 2, y: base.y + base.h / 2, w: base.w, h: base.h };
  }
  landmarkAt('diner', 1, 1);
  landmarkAt('garage', 5, 1);
  landmarkAt('warehouse', 5, 4);
  landmarkAt('bank', 3, 2);
  landmarkAt('hideout', 1, 5);
  landmarkAt('hospital', 2, 4);
  landmarkAt('station', 4, 2);
  landmarkAt('mall', 3, 4);
  landmarkAt('motel', 6, 3);
  landmarkAt('casino', 5, 5);
  landmarks.docks = { ...LANDMARKS.find((l) => l.id === 'docks'), x: size * 0.82, y: size - 60, w: 200, h: 80 };
  landmarks.beach = { ...LANDMARKS.find((l) => l.id === 'beach'), x: size * 0.3, y: size - 50, w: 300, h: 90 };

  // Street trees along a few avenues.
  for (let i = 0; i < 40; i += 1) {
    const c = pick(random, centers);
    trees.push({
      x: c + (chance(random, 0.5) ? -1 : 1) * (CITY.road / 2 - 8),
      y: range(random, 60, size - 60),
      r: range(random, 8, 13),
    });
  }

  // Parked cars: decoration that can also be stolen.
  const parked = [];
  for (let i = 0; i < 26; i += 1) {
    const horizontal = chance(random, 0.5);
    const c = pick(random, centers);
    const along = range(random, 120, size - 120);
    parked.push({
      x: horizontal ? along : c + (chance(random, 0.5) ? -1 : 1) * (CITY.road / 2 - 22),
      y: horizontal ? c + (chance(random, 0.5) ? -1 : 1) * (CITY.road / 2 - 22) : along,
      angle: horizontal ? (chance(random, 0.5) ? 0 : Math.PI) : (chance(random, 0.5) ? Math.PI / 2 : -Math.PI / 2),
      model: rangeInt(random, 0, 7),
    });
  }

  return { size, centers, blocks, buildings, trees, parks, landmarks, parked };
}

/** True when the circle (x, y, r) overlaps any building. Returns the building. */
export function hitBuilding(city, x, y, r) {
  for (const b of city.buildings) {
    if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return b;
  }
  return null;
}

/** Push a circle out of buildings; returns true when a collision happened. */
export function collideBuildings(city, body) {
  const b = hitBuilding(city, body.x, body.y, body.r);
  if (!b) return false;
  const overlapLeft = body.x + body.r - b.x;
  const overlapRight = b.x + b.w - (body.x - body.r);
  const overlapTop = body.y + body.r - b.y;
  const overlapBottom = b.y + b.h - (body.y - body.r);
  const min = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
  if (min === overlapLeft) body.x = b.x - body.r;
  else if (min === overlapRight) body.x = b.x + b.w + body.r;
  else if (min === overlapTop) body.y = b.y - body.r;
  else body.y = b.y + b.h + body.r;
  return true;
}

/** Clamp a point inside the city (the beach is the south edge; the sea is out). */
export function clampToCity(city, body, margin) {
  const m = margin ?? 20;
  body.x = Math.max(m, Math.min(city.size - m, body.x));
  body.y = Math.max(m, Math.min(city.size - m, body.y));
}
