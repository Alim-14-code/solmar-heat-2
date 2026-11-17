// The screenshot scenes behind ?shot=chase|start|mission|street. Each one
// plays the real rules forward from a fresh world for a fixed number of steps,
// steered by a simple autopilot (a road-graph path for driving, chase-and-
// shoot on foot), so the frame is what a short game really looks like and the
// same seed always gives the same frame.
import { STEP, nearestRoadCoord, onRoad } from './config.js';
import { startMission } from './missions.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const SAMPLE = STEP;
const TAU = Math.PI * 2;

function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** BFS over the road intersections, from the nearest one to (fx, fy) to the nearest one to (tx, ty). */
function roadPath(city, fx, fy, tx, ty) {
  const n = city.centers.length;
  const start = nearestNode(city, fx, fy);
  const goal = nearestNode(city, tx, ty);
  const prev = new Map();
  const queue = [start];
  prev.set(start, -1);
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === goal) break;
    const ci = cur % n;
    const cj = Math.floor(cur / n);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || ni >= n || nj < 0 || nj >= n) continue;
      const next = nj * n + ni;
      if (!prev.has(next)) {
        prev.set(next, cur);
        queue.push(next);
      }
    }
  }
  if (!prev.has(goal)) return [];
  const path = [];
  let cur = goal;
  while (cur !== -1) {
    const ci = cur % n;
    const cj = Math.floor(cur / n);
    path.unshift({ x: city.centers[ci], y: city.centers[cj] });
    cur = prev.get(cur);
  }
  return path;
}

function nearestNode(city, x, y) {
  const n = city.centers.length;
  let bi = 0;
  let bj = 0;
  for (let i = 0; i < n; i += 1) {
    if (Math.abs(city.centers[i] - x) < Math.abs(city.centers[bi] - x)) bi = i;
    if (Math.abs(city.centers[i] - y) < Math.abs(city.centers[bj] - y)) bj = i;
  }
  return bj * n + bi;
}

/** A fake input object the autopilot drives: move() steers a car along a path. */
function makeDriver(world, path) {
  let waypoint = 0;
  let stuckTimer = 0;
  let reverseTimer = 0;
  const keys = { up: false, down: false, left: false, right: false, run: false, handbrake: false };
  return {
    keys,
    move() {
      const p = world.state.player;
      const car = p.inCar;
      if (!car) return { x: 0, y: 0 };
      while (waypoint < path.length && Math.hypot(path[waypoint].x - car.x, path[waypoint].y - car.y) < 90) waypoint += 1;
      if (waypoint >= path.length) return { x: 0, y: 0 };
      // Shoved off the road: steer straight back to the nearest road, along
      // the shorter axis, so the car never cuts a corner through a building.
      const cur = path[waypoint];
      const nxt = path[Math.min(waypoint + 1, path.length - 1)];
      let tx;
      let ty;
      if (!onRoad(car.x, car.y)) {
        const dx = Math.abs(car.x - nearestRoadCoord(car.x));
        const dy = Math.abs(car.y - nearestRoadCoord(car.y));
        if (dx < dy) { tx = nearestRoadCoord(car.x); ty = car.y; }
        else { tx = car.x; ty = nearestRoadCoord(car.y); }
      } else {
        // Look ahead: steer toward a blend of this waypoint and the next, so
        // turns start early and the car does not swing into block corners.
        tx = cur.x * 0.65 + nxt.x * 0.35;
        ty = cur.y * 0.65 + nxt.y * 0.35;
      }
      const desired = Math.atan2(ty - car.y, tx - car.x);
      const diff = angleDiff(car.angle, desired);
      const distTo = Math.hypot(cur.x - car.x, cur.y - car.y);
      // Slow down for the turn at the next intersection.
      const turnAhead = waypoint + 1 < path.length
        ? Math.abs(angleDiff(Math.atan2(nxt.y - cur.y, nxt.x - cur.x), Math.atan2(cur.y - path[Math.max(0, waypoint - 1)].y, cur.x - path[Math.max(0, waypoint - 1)].x))) : 0;
      const slow = distTo < 260 && turnAhead > 0.5;
      if (Math.abs(car.speed) < 25) stuckTimer += SAMPLE;
      else stuckTimer = 0;
      if (stuckTimer > 1.2) { reverseTimer = 0.8; stuckTimer = 0; }
      if (reverseTimer > 0) {
        reverseTimer -= SAMPLE;
        keys.up = false;
        keys.down = true;
        keys.left = diff > 0.08;
        keys.right = diff < -0.08;
      } else {
        // Keep the throttle on through turns; only brake when the turn is
        // sharp and the speed is high, or the car faces the wrong way.
        keys.up = Math.abs(diff) < 1.4;
        keys.down = Math.abs(diff) > 2.4 || (slow && Math.abs(car.speed) > 320);
        keys.left = diff < -0.08;
        keys.right = diff > 0.08;
      }
      keys.handbrake = false;
      return { x: (keys.right ? 1 : 0) - (keys.left ? 1 : 0), y: (keys.down ? 1 : 0) - (keys.up ? 1 : 0) };
    },
    mouse() { return { x: 640, y: 360, down: false }; },
    takeActions() { return 0; },
  };
}

/** A fake input for on-foot combat: walk at the nearest gang member, strafe
 *  while shooting, and reload when the magazine runs dry. */
function makeShooter(world) {
  const keys = { up: false, down: false, left: false, right: false, run: false, handbrake: false };
  let aim = 0;
  let strafeDir = 1;
  let strafeTimer = 0;
  return {
    keys,
    move() {
      const p = world.state.player;
      const gang = world.state.peds.filter((pd) => pd.gang && pd.state !== 'dead');
      if (gang.length === 0) return { x: 0, y: 0 };
      let best = gang[0];
      let bestD = Infinity;
      for (const g of gang) {
        const d = Math.hypot(g.x - p.x, g.y - p.y);
        if (d < bestD) { bestD = d; best = g; }
      }
      aim = Math.atan2(best.y - p.y, best.x - p.x);
      strafeTimer -= SAMPLE;
      if (strafeTimer <= 0) { strafeDir = -strafeDir; strafeTimer = 1.6; }
      if (bestD > 220) {
        const mx = Math.cos(aim);
        const my = Math.sin(aim);
        keys.up = my < -0.3;
        keys.down = my > 0.3;
        keys.left = mx < -0.3;
        keys.right = mx > 0.3;
        return { x: (keys.right ? 1 : 0) - (keys.left ? 1 : 0), y: (keys.down ? 1 : 0) - (keys.up ? 1 : 0) };
      }
      // In range: strafe sideways so the gang's return fire mostly misses.
      const sx = Math.cos(aim + Math.PI / 2) * strafeDir;
      const sy = Math.sin(aim + Math.PI / 2) * strafeDir;
      keys.up = sy < -0.3;
      keys.down = sy > 0.3;
      keys.left = sx < -0.3;
      keys.right = sx > 0.3;
      return { x: (keys.right ? 1 : 0) - (keys.left ? 1 : 0), y: (keys.down ? 1 : 0) - (keys.up ? 1 : 0) };
    },
    mouse() { return { x: 640, y: 360, down: true }; },
    takeActions() {
      const p = world.state.player;
      if (p.mag === 0 && p.reserve > 0 && p.reloading <= 0) return 16; // ACTION_RELOAD
      return 0;
    },
    aimAngle() { return aim; },
  };
}

function makeIdle() {
  return {
    keys: { up: false, down: false, left: false, right: false, run: false, handbrake: false },
    move() { return { x: 0, y: 0 }; },
    mouse() { return { x: 640, y: 360, down: false }; },
    takeActions() { return 0; },
  };
}

function aimFor(world, input) {
  if (input.aimAngle) return input.aimAngle();
  const p = world.state.player;
  return p.angle;
}

function runSim(world, input, seconds) {
  for (let i = 0; i < seconds / SAMPLE; i += 1) {
    world.step(SAMPLE, input, aimFor(world, input));
  }
}

/**
 * Set `world` to the named scene and return the screen to draw over it.
 * Scenes: chase (cover: police chase in the getaway car), start (title over
 * the living city), mission (warehouse shootout on foot), street (dusk drive
 * through downtown traffic).
 */
export function stageShot(name, world, city) {
  const s = world.state;
  world.reset();
  if (name === 'start') {
    runSim(world, makeIdle(), 6);
    return { screen: SCREEN_TITLE, ui: { saveExists: true, best: 12450, missionsDone: 2 } };
  }
  if (name === 'mission') {
    s.elapsed = (19.0 - 17.33) * 40; // dusk
    startMission(world, 3); // Payback
    // Stand at the warehouse's west edge, facing the gang, and let the
    // goto step complete so the kill step spawns.
    const lm = city.landmarks.warehouse;
    s.player.x = lm.x - lm.w / 2 - 30;
    s.player.y = lm.y;
    s.player.angle = 0;
    runSim(world, makeIdle(), 1);
    // The kill step brings 2 stars of heat; clear it for the shot, so the
    // frame is the warehouse shootout itself, not a police pile-in.
    world.setWanted(0);
    for (let i = world.state.cars.length - 1; i >= 0; i -= 1) {
      if (world.state.cars[i].kind === 'police') world.state.cars.splice(i, 1);
    }
    world.state.officers.length = 0;
    runSim(world, makeShooter(world), 7);
    return { screen: SCREEN_PLAY, ui: {} };
  }
  if (name === 'street') {
    s.elapsed = (18.5 - 17.33) * 40; // golden hour
    startMission(world, 1); // The Pickup
    const p = s.player;
    // Park a sedan on the nearest road and put the player in it.
    const car = world.makeCar(nearestRoadCoord(p.x), nearestRoadCoord(p.y), 0, 1, 'parked');
    p.inCar = car;
    car.kind = 'player';
    p.x = car.x;
    p.y = car.y;
    const docks = city.landmarks.docks;
    const path = roadPath(city, p.x, p.y, docks.x, docks.y);
    // 8 s in: still en route at speed through downtown, package ahead.
    runSim(world, makeDriver(world, path), 8);
    return { screen: SCREEN_PLAY, ui: {} };
  }
  // Default: chase — the cover shot. Mission 2 sends Dario to the docks, so
  // the objective, the arrow and the minimap all agree with the drive; the
  // heat is forced to 3 stars and two patrol cars start right behind him.
  s.elapsed = (17.8 - 17.33) * 40; // sunset
  startMission(world, 1); // The Pickup
  const p = s.player;
  const roadY = city.centers[3];
  const car = world.makeCar(320, roadY, 0, 6, 'parked');
  car.speed = 380;
  p.inCar = car;
  car.kind = 'player';
  p.x = car.x;
  p.y = car.y;
  world.setWanted(2);
  const cop1 = world.spawnPoliceCar(60, roadY + 30);
  cop1.speed = 480;
  const cop2 = world.spawnPoliceCar(140, roadY - 30);
  cop2.speed = 480;
  const docks = city.landmarks.docks;
  const path = roadPath(city, p.x, p.y, docks.x, docks.y);
  // 4 s on the straight east road: the Diablo is still flat out with both
  // patrol cars on its tail when the frame is taken, before any turn.
  runSim(world, makeDriver(world, path), 4);
  return { screen: SCREEN_PLAY, ui: {} };
}

