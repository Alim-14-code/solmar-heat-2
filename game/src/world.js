// The game's rules and state, with no drawing and no browser in it: the player
// on foot and in cars, traffic, pedestrians, police, wanted level, combat,
// pickups, the clock and the camera. step() advances one fixed step and
// returns what happened as bit flags, so the caller can react without the
// world knowing about screens or sound. Pools are allocated once at boot.
import {
  CAR, CAR_MODELS, CITY, CLOCK, PEDS, PLAYER, POLICE, TRAFFIC, WANTED, WEAPON,
  nearestRoadCoord, onRoad,
} from './config.js';
import { collideBuildings, clampToCity, hitBuilding } from './city.js';
import { updateMission } from './missions.js';
import { chance, pick, range, rangeInt } from './random.js';

export const EVENT_NONE = 0;
export const EVENT_SHOT = 1;
export const EVENT_CRASH = 2;
export const EVENT_BUSTED = 4;
export const EVENT_WASTED = 8;
export const EVENT_PICKUP = 16;
export const EVENT_WANTED_UP = 32;
export const EVENT_CAR_STOLEN = 64;
export const EVENT_EXPLOSION = 128;

const TAU = Math.PI * 2;

function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}
function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function makeCar(id, x, y, angle, model, kind) {
  const def = CAR_MODELS[model];
  return {
    id, x, y, angle, speed: 0, model, kind, // 'player' | 'traffic' | 'police' | 'parked' | 'mission'
    color: def.color, top: def.top, accel: def.accel, grip: def.grip,
    health: CAR.health, driver: kind === 'traffic' || kind === 'police',
    dead: false, smoke: 0, siren: 0, honk: 0,
    // traffic AI
    lane: 'h', dir: 1, targetSpeed: 160,
    turnAt: 0, stuck: 0,
  };
}

function makePed(random, city) {
  const centers = city.centers;
  const horizontal = chance(random, 0.5);
  const c = pick(random, centers);
  const side = chance(random, 0.5) ? -1 : 1;
  const along = range(random, 100, city.size - 100);
  return {
    x: horizontal ? along : c + side * (CITY.road / 2 - 8),
    y: horizontal ? c + side * (CITY.road / 2 - 8) : along,
    angle: horizontal ? (chance(random, 0.5) ? 0 : Math.PI) : (chance(random, 0.5) ? Math.PI / 2 : -Math.PI / 2),
    speed: range(random, 45, 75), r: 12,
    state: 'walk', // walk | flee | down | dead
    timer: range(random, 0, 4),
    color: pick(random, ['#7fb069', '#e07a5f', '#81b29a', '#f2cc8f', '#a78bfa', '#ef8354']),
    fleeX: 0, fleeY: 0, downTimer: 0,
  };
}

export function createWorld(random, city) {
  const player = {
    x: city.landmarks.diner.x, y: city.landmarks.diner.y + 90, angle: -Math.PI / 2, r: PLAYER.radius,
    health: PLAYER.health, money: 250, inCar: null, speed: 0,
    mag: WEAPON.mag, reserve: WEAPON.reserve, reloading: 0,
    fireCooldown: 0, punchCooldown: 0, hurt: 0, invulnerable: 0,
  };
  const cars = [];
  const peds = [];
  const officers = [];
  const bullets = [];
  const particles = [];
  const pickups = [];
  const messages = [];
  const state = {
    player, cars, peds, officers, bullets, particles, pickups, messages,
    wanted: 0, wantedTimer: 0, unseenTimer: 0, clock: CLOCK.startHour,
    elapsed: 0, kills: 0, carsStolen: 0, missionsDone: 0,
    camera: { x: player.x, y: player.y },
    shake: 0, slowmo: 0,
    mission: null, // set by missions.js: { id, title, step, target, ... }
    stats: { shotsFired: 0, shotsHit: 0 },
  };

  let carId = 0;
  let policeTimer = 5;
  let trafficTimer = 0;
  let pedTimer = 0;

  function addMessage(text, color) {
    messages.push({ text, color: color || '#f5f1e6', life: 5 });
    if (messages.length > 5) messages.shift();
  }

  function addWanted(n, reason) {
    const before = state.wanted;
    state.wanted = Math.min(WANTED.max, state.wanted + n);
    state.unseenTimer = 0;
    if (state.wanted > before) {
      addMessage(`WANTED LEVEL ${state.wanted} — ${reason}`, '#ff6b6b');
      return EVENT_WANTED_UP;
    }
    return EVENT_NONE;
  }

  function spawnParticle(x, y, color, count, speed, life, size) {
    for (let i = 0; i < count; i += 1) {
      if (particles.length > 400) return;
      const a = random() * TAU;
      const s = range(random, speed * 0.3, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: range(random, life * 0.5, life), maxLife: life, size: range(random, size * 0.6, size * 1.4) });
    }
  }

  function explode(x, y) {
    spawnParticle(x, y, '#ff9f1c', 26, 260, 0.7, 7);
    spawnParticle(x, y, '#ff5d3b', 18, 180, 0.9, 9);
    spawnParticle(x, y, '#3a3d44', 14, 90, 1.4, 12);
    state.shake = Math.max(state.shake, 14);
    for (const ped of peds) {
      if (ped.state !== 'dead' && dist(x, y, ped.x, ped.y) < 110) killPed(ped, 'explosion');
    }
    for (const car of cars) {
      if (!car.dead && car !== state.player.inCar && dist(x, y, car.x, car.y) < 120 && dist(x, y, car.x, car.y) > 1) {
        damageCar(car, 60);
      }
    }
    if (dist(x, y, player.x, player.y) < 110 && !player.inCar) hurtPlayer(25);
    return EVENT_EXPLOSION;
  }

  function killPed(ped, cause) {
    ped.state = 'dead';
    ped.downTimer = 0;
    spawnParticle(ped.x, ped.y, '#c22', 10, 120, 0.6, 4);
    if (cause !== 'silent') {
      state.kills += 1;
      addWanted(cause === 'cop' ? WANTED.killCop : WANTED.killPed, cause === 'cop' ? 'OFFICER DOWN' : 'PEDESTRIAN KILLED');
    }
    if (chance(random, 0.5)) {
      pickups.push({ x: ped.x, y: ped.y, kind: 'cash', amount: rangeInt(random, 5, 40), life: 30 });
    }
  }

  function hurtPlayer(amount) {
    if (player.invulnerable > 0) return;
    player.health -= amount;
    player.hurt = 0.6;
    player.invulnerable = 0.25;
    spawnParticle(player.x, player.y, '#ff4d4d', 6, 120, 0.5, 4);
  }

  function damageCar(car, amount) {
    car.health -= amount;
    if (car.health <= 30 && car.health > 0) car.smoke = 1;
    if (car.health <= 0 && !car.dead) {
      car.dead = true;
      car.driver = false;
      explode(car.x, car.y);
      if (car === player.inCar) {
        player.inCar = null;
        hurtPlayer(30);
        addMessage('Your car exploded!', '#ff6b6b');
      }
    }
  }

  function spawnTrafficCar(nearX, nearY) {
    const horizontal = chance(random, 0.5);
    const c = pick(random, city.centers);
    const dir = chance(random, 0.5) ? 1 : -1;
    const laneOff = (CITY.road / 2 - 26) * (horizontal ? (dir > 0 ? 1 : -1) : (dir > 0 ? 1 : -1));
    let x; let y;
    if (horizontal) { x = range(random, 100, city.size - 100); y = c + laneOff; }
    else { x = c + laneOff; y = range(random, 100, city.size - 100); }
    if (nearX !== undefined && dist(x, y, nearX, nearY) > 900) return null;
    const car = makeCar(carId, x, y, horizontal ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2), rangeInt(random, 0, CAR_MODELS.length - 1), 'traffic');
    car.id = carId; carId += 1;
    car.lane = horizontal ? 'h' : 'v';
    car.dir = dir;
    car.speed = car.targetSpeed * 0.7;
    cars.push(car);
    return car;
  }

  function spawnPoliceCar(atX, atY) {
    let x;
    let y;
    if (atX !== undefined) {
      // A placed patrol car keeps its spot: it is already on a road.
      x = Math.max(60, Math.min(city.size - 60, atX));
      y = Math.max(60, Math.min(city.size - 60, atY));
      const car = makeCar(carId, x, y, angleTo(x, y, player.x, player.y), 3, 'police');
      car.id = carId; carId += 1;
      car.color = '#1c2f6e';
      car.top = POLICE.carTop;
      car.accel = POLICE.carAccel;
      cars.push(car);
      return car;
    }
    const a = random() * TAU;
    x = player.x + Math.cos(a) * POLICE.spawnDistance;
    y = player.y + Math.sin(a) * POLICE.spawnDistance;
    const cx = Math.max(60, Math.min(city.size - 60, x));
    const cy = Math.max(60, Math.min(city.size - 60, y));
    const car = makeCar(carId, nearestRoadCoord(cx), nearestRoadCoord(cy), angleTo(cx, cy, player.x, player.y), 3, 'police');
    car.id = carId; carId += 1;
    car.color = '#1c2f6e';
    car.top = POLICE.carTop;
    car.accel = POLICE.carAccel;
    cars.push(car);
    return car;
  }

  function spawnOfficer(x, y) {
    officers.push({ x, y, angle: 0, speed: POLICE.officerSpeed, r: 12, state: 'chase', timer: 0 });
  }

  function nearestCar(x, y, maxDist, kinds) {
    let best = null;
    let bestD = maxDist;
    for (const car of cars) {
      if (car.dead) continue;
      if (kinds && !kinds.includes(car.kind)) continue;
      const d = dist(x, y, car.x, car.y);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  function reset(run) {
    player.x = city.landmarks.diner.x;
    player.y = city.landmarks.diner.y + 90;
    player.angle = -Math.PI / 2;
    player.health = PLAYER.health;
    player.money = run && run.money !== undefined ? run.money : 250;
    player.inCar = null;
    player.mag = WEAPON.mag;
    player.reserve = WEAPON.reserve;
    player.reloading = 0;
    cars.length = 0;
    peds.length = 0;
    officers.length = 0;
    bullets.length = 0;
    particles.length = 0;
    pickups.length = 0;
    messages.length = 0;
    state.wanted = 0;
    state.wantedTimer = 0;
    state.unseenTimer = 0;
    state.clock = CLOCK.startHour;
    state.elapsed = 0;
    state.kills = 0;
    state.carsStolen = 0;
    state.missionsDone = run && run.missionsDone !== undefined ? run.missionsDone : 0;
    state.mission = null;
    state.shake = 0;
    carId = 0;
    for (const p of city.parked) {
      const car = makeCar(carId, p.x, p.y, p.angle, p.model, 'parked');
      car.id = carId; carId += 1;
      car.driver = false;
      cars.push(car);
    }
    for (let i = 0; i < TRAFFIC.count; i += 1) spawnTrafficCar();
    for (let i = 0; i < PEDS.count; i += 1) peds.push(makePed(random, city));
    // A health pack and ammo near the diner, so the first minutes teach pickups.
    pickups.push({ x: city.landmarks.diner.x + 60, y: city.landmarks.diner.y + 40, kind: 'health', amount: 50, life: 9999 });
    pickups.push({ x: city.landmarks.hospital.x, y: city.landmarks.hospital.y + 60, kind: 'health', amount: 50, life: 9999 });
    pickups.push({ x: city.landmarks.station.x - 60, y: city.landmarks.station.y + 40, kind: 'ammo', amount: 48, life: 9999 });
  }

  function stepPlayerOnFoot(dt, move, aimAngle, firing, punch) {
    const run = move.run;
    const speed = run ? PLAYER.run : PLAYER.walk;
    let mx = move.x;
    let my = move.y;
    const len = Math.hypot(mx, my);
    if (len > 0) { mx /= len; my /= len; }
    const nx = player.x + mx * speed * dt;
    const ny = player.y + my * speed * dt;
    player.x = nx;
    player.y = ny;
    if (len > 0) player.angle = Math.atan2(my, mx);
    else if (firing) player.angle = aimAngle;
    collideBuildings(city, player);
    // Keep the player out of the sea: the beach ends at the city's south edge.
    clampToCity(city, player, 16);
    player.speed = len > 0 ? speed : 0;

    if (player.punchCooldown > 0) player.punchCooldown -= dt;
    if (punch && player.punchCooldown <= 0) {
      player.punchCooldown = PLAYER.punchCooldown;
      let hit = false;
      for (const ped of peds) {
        if (ped.state === 'dead') continue;
        if (dist(player.x, player.y, ped.x, ped.y) < PLAYER.punchRange + 12) {
          ped.state = 'down';
          ped.downTimer = 3;
          spawnParticle(ped.x, ped.y, '#ffd23f', 6, 140, 0.4, 4);
          hit = true;
        }
      }
      for (const o of officers) {
        if (dist(player.x, player.y, o.x, o.y) < PLAYER.punchRange + 12) {
          o.state = 'down';
          o.timer = 3;
          hit = true;
        }
      }
      if (hit) addWanted(WANTED.hitPed, 'ASSAULT');
    }

    if (player.fireCooldown > 0) player.fireCooldown -= dt;
    if (player.reloading > 0) {
      player.reloading -= dt;
      if (player.reloading <= 0) {
        const need = WEAPON.mag - player.mag;
        const take = Math.min(need, player.reserve);
        player.mag += take;
        player.reserve -= take;
      }
    }
    if (firing && player.fireCooldown <= 0 && player.reloading <= 0) {
      if (player.mag > 0) {
        player.mag -= 1;
        player.fireCooldown = WEAPON.fireRate;
        state.stats.shotsFired += 1;
        const a = aimAngle;
        bullets.push({
          x: player.x + Math.cos(a) * 20, y: player.y + Math.sin(a) * 20,
          vx: Math.cos(a) * WEAPON.bulletSpeed, vy: Math.sin(a) * WEAPON.bulletSpeed,
          life: WEAPON.range / WEAPON.bulletSpeed, friendly: true, damage: WEAPON.damage,
        });
        spawnParticle(player.x + Math.cos(a) * 26, player.y + Math.sin(a) * 26, '#ffd23f', 3, 90, 0.15, 3);
        for (const ped of peds) {
          if (ped.state === 'walk' && dist(player.x, player.y, ped.x, ped.y) < 260) {
            ped.state = 'flee';
            ped.timer = 2.5;
            ped.fleeX = ped.x + (ped.x - player.x);
            ped.fleeY = ped.y + (ped.y - player.y);
          }
        }
        return EVENT_SHOT;
      }
      player.fireCooldown = 0.25; // dry click
    }
    return EVENT_NONE;
  }

  function stepPlayerCar(dt, move) {
    const car = player.inCar;
    if (!car || car.dead) { player.inCar = null; return EVENT_NONE; }
    const throttle = -move.y; // up = accelerate
    const steer = move.x;
    const handbrake = move.handbrake;
    const grip = handbrake ? car.grip * 0.45 : car.grip;
    const target = throttle > 0 ? car.top : throttle < 0 ? -car.top * 0.45 : 0;
    if (throttle !== 0) {
      car.speed += Math.sign(target - car.speed) * car.accel * dt * (handbrake ? 0.4 : 1);
      if (throttle > 0 && car.speed > car.top) car.speed = car.top;
      if (throttle < 0 && car.speed < -car.top * 0.45) car.speed = -car.top * 0.45;
    } else {
      car.speed -= car.speed * 1.4 * dt;
      if (Math.abs(car.speed) < 4) car.speed = 0;
    }
    if (handbrake) car.speed -= car.speed * 1.8 * dt;
    const steerAmount = steer * grip * dt * Math.min(1, Math.abs(car.speed) / 120) * (car.speed >= 0 ? 1 : -1);
    car.angle += steerAmount * (Math.abs(car.speed) > 1 ? 1 : 0);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    player.speed = Math.abs(car.speed);
    // Collide with buildings using two probe circles along the car body.
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    for (const s of [16, -16]) {
      const probe = { x: car.x + fx * s, y: car.y + fy * s, r: 15 };
      if (collideBuildings(city, probe)) {
        car.x = probe.x - fx * s;
        car.y = probe.y - fy * s;
        if (Math.abs(car.speed) > 300) {
          damageCar(car, 12);
          state.shake = Math.max(state.shake, 6);
          spawnParticle(car.x, car.y, '#ffb347', 8, 160, 0.5, 5);
        }
        car.speed *= 0.65;
      }
    }
    clampToCity(city, car, 24);
    if (car.smoke) {
      car.smoke = Math.max(0, car.smoke - dt * 0.1);
      if (random() < 0.5) spawnParticle(car.x - fx * 20, car.y - fy * 20, '#555', 1, 30, 1.2, 8);
    }
    if (Math.abs(car.speed) > 60 && random() < 0.25) {
      particles.push({ x: car.x - fx * 24, y: car.y - fy * 24, vx: 0, vy: 0, color: '#00000033', life: 0.5, maxLife: 0.5, size: 3 });
    }
    return EVENT_NONE;
  }

  function stepTraffic(dt) {
    for (const car of cars) {
      if (car.kind !== 'traffic' || car.dead) continue;
      // Keep moving along the road; at an intersection, sometimes turn.
      const atX = nearestRoadCoord(car.x);
      const atY = nearestRoadCoord(car.y);
      const onCrossX = Math.abs(car.x - atX) < 14;
      const onCrossY = Math.abs(car.y - atY) < 14;
      if (car.lane === 'h' && onCrossY && car.turnAt <= 0) {
        if (chance(random, 0.3)) {
          car.lane = 'v';
          car.dir = chance(random, 0.5) ? 1 : -1;
          car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          car.turnAt = 1.2;
        }
      } else if (car.lane === 'v' && onCrossX && car.turnAt <= 0) {
        if (chance(random, 0.3)) {
          car.lane = 'h';
          car.dir = chance(random, 0.5) ? 1 : -1;
          car.angle = car.dir > 0 ? 0 : Math.PI;
          car.turnAt = 1.2;
        }
      }
      car.turnAt -= dt;
      // Slow for the car ahead.
      let desired = car.targetSpeed;
      for (const other of cars) {
        if (other === car || other.dead) continue;
        const dx = other.x - car.x;
        const dy = other.y - car.y;
        const ahead = car.lane === 'h' ? dx * car.dir : dy * car.dir;
        const side = car.lane === 'h' ? Math.abs(dy) : Math.abs(dx);
        if (ahead > 0 && ahead < 90 && side < 30) { desired = Math.min(desired, other.speed * 0.8); break; }
      }
      // Slow for the player crossing in front.
      if (!player.inCar) {
        const dx = player.x - car.x;
        const dy = player.y - car.y;
        const ahead = car.lane === 'h' ? dx * car.dir : dy * car.dir;
        const side = car.lane === 'h' ? Math.abs(dy) : Math.abs(dx);
        if (ahead > -10 && ahead < 90 && side < 40) desired = 0;
      }
      const brake = desired < car.speed ? 520 : 260;
      car.speed += Math.sign(desired - car.speed) * brake * dt;
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      clampToCity(city, car, 30);
      // A traffic car that ran the player over.
      if (!player.inCar && player.invulnerable <= 0 && dist(car.x, car.y, player.x, player.y) < 30 && Math.abs(car.speed) > 40) {
        hurtPlayer(22);
        player.x += Math.cos(car.angle) * 30;
        player.y += Math.sin(car.angle) * 30;
        addMessage('RUN OVER BY TRAFFIC!', '#ff6b6b');
      }
      // A traffic car that ran a pedestrian over.
      for (const ped of peds) {
        if (ped.state === 'dead' || ped.state === 'down') continue;
        if (dist(car.x, car.y, ped.x, ped.y) < 28 && Math.abs(car.speed) > 60) {
          ped.state = 'down';
          ped.downTimer = 4;
          spawnParticle(ped.x, ped.y, '#c22', 8, 120, 0.6, 4);
        }
      }
    }
  }

  function stepPolice(dt) {
    const policeCars = cars.filter((c) => c.kind === 'police' && !c.dead);
    if (state.wanted > 0) {
      policeTimer -= dt;
      const want = Math.min(state.wanted, POLICE.maxCars);
      if (policeCars.length < want && policeTimer <= 0) {
        spawnPoliceCar();
        policeTimer = 3;
      }
    } else if (policeCars.length > 0) {
      // Wanted cleared: the heat drives off.
      for (const car of policeCars) {
        car.angle = angleTo(car.x, car.y, city.size / 2, city.size / 2);
        car.speed = car.top * 0.6;
        car.x += Math.cos(car.angle) * car.speed * dt;
        car.y += Math.sin(car.angle) * car.speed * dt;
        if (dist(car.x, car.y, city.size / 2, city.size / 2) < 200) car.dead = true;
      }
      for (let i = cars.length - 1; i >= 0; i -= 1) if (cars[i].kind === 'police' && cars[i].dead) cars.splice(i, 1);
    }
    for (const car of cars) {
      if (car.kind !== 'police' || car.dead) continue;
      // Chase the player's tail when he is driving, so the ram pushes him
      // forward down the road instead of shoving him sideways off it.
      let tx = player.x;
      let ty = player.y;
      if (player.inCar) {
        tx = player.x - Math.cos(player.angle) * 80;
        ty = player.y - Math.sin(player.angle) * 80;
      }
      const targetAngle = angleTo(car.x, car.y, tx, ty);
      const diff = angleDiff(car.angle, targetAngle);
      car.angle += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
      const d = dist(car.x, car.y, player.x, player.y);
      const desired = d > 60 ? car.top : car.top * 0.4;
      car.speed += Math.sign(desired - car.speed) * car.accel * dt;
      // Close behind the player's car, match its speed: a ram, not a grind.
      if (player.inCar && d < 70) car.speed = Math.min(car.speed, Math.abs(player.inCar.speed) + 150);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      car.siren += dt;
      const fx = Math.cos(car.angle);
      const fy = Math.sin(car.angle);
      for (const s of [16, -16]) {
        const probe = { x: car.x + fx * s, y: car.y + fy * s, r: 15 };
        if (collideBuildings(city, probe)) {
          car.x = probe.x - fx * s;
          car.y = probe.y - fy * s;
          car.speed *= 0.3;
        }
      }
      clampToCity(city, car, 24);
      // Ram the player's car.
      if (player.inCar && !player.inCar.dead && d < 46) {
        damageCar(player.inCar, POLICE.ramDamage * dt);
        state.shake = Math.max(state.shake, 3);
      }
      // Ram the player on foot.
      if (!player.inCar && d < 30 && Math.abs(car.speed) > 60 && player.invulnerable <= 0) {
        hurtPlayer(18);
      }
      // Close enough on foot: an officer gets out to arrest.
      if (!player.inCar && d < 90 && officers.length < 2 && state.wanted >= 1) {
        spawnOfficer(car.x, car.y);
        car.speed = 0;
      }
    }
    // Officers on foot.
    for (const o of officers) {
      if (o.state === 'down') {
        o.timer -= dt;
        if (o.timer <= 0) o.state = 'chase';
        continue;
      }
      const d = dist(o.x, o.y, player.x, player.y);
      if (player.inCar) {
        // Player drove off: the officer jogs back to the car.
        o.state = 'return';
      }
      if (o.state === 'return') {
        const car = nearestCar(o.x, o.y, 400, ['police']);
        if (car) {
          o.angle = angleTo(o.x, o.y, car.x, car.y);
          o.x += Math.cos(o.angle) * o.speed * dt;
          o.y += Math.sin(o.angle) * o.speed * dt;
          if (dist(o.x, o.y, car.x, car.y) < 24) o.state = 'gone';
        } else o.state = 'gone';
        continue;
      }
      o.angle = angleTo(o.x, o.y, player.x, player.y);
      o.x += Math.cos(o.angle) * o.speed * dt;
      o.y += Math.sin(o.angle) * o.speed * dt;
      collideBuildings(city, o);
      if (d < POLICE.arrestRange && !player.inCar) {
        o.arrestTimer = (o.arrestTimer || 0) + dt;
        if (o.arrestTimer > 1.0) o.state = 'arrest';
      } else {
        o.arrestTimer = 0;
      }
    }
    for (let i = officers.length - 1; i >= 0; i -= 1) if (officers[i].state === 'gone') officers.splice(i, 1);
    // Arrested?
    if (officers.some((o) => o.state === 'arrest')) return EVENT_BUSTED;
    return EVENT_NONE;
  }

  function stepPeds(dt) {
    for (const ped of peds) {
      if (ped.state === 'dead') continue;
      if (ped.state === 'down') {
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) ped.state = 'walk';
        continue;
      }
      if (ped.state === 'flee') {
        ped.timer -= dt;
        const a = angleTo(ped.x, ped.y, ped.fleeX, ped.fleeY);
        ped.angle = a;
        ped.x += Math.cos(a) * 170 * dt;
        ped.y += Math.sin(a) * 170 * dt;
        if (ped.timer <= 0) ped.state = 'walk';
      } else {
        ped.timer -= dt;
        if (ped.timer <= 0) {
          ped.timer = range(random, 3, 8);
          ped.angle += pick(random, [-Math.PI / 2, Math.PI / 2, Math.PI]);
        }
        // Keep pedestrians on sidewalks: nudge them back onto a road line.
        const rx = nearestRoadCoord(ped.x);
        const ry = nearestRoadCoord(ped.y);
        const dx = Math.abs(ped.x - rx);
        const dy = Math.abs(ped.y - ry);
        if (dx < dy) ped.x = rx + Math.sign(ped.x - rx || 1) * (CITY.road / 2 - 8);
        else ped.y = ry + Math.sign(ped.y - ry || 1) * (CITY.road / 2 - 8);
        ped.x += Math.cos(ped.angle) * ped.speed * dt;
        ped.y += Math.sin(ped.angle) * ped.speed * dt;
      }
      collideBuildings(city, ped);
      clampToCity(city, ped, 16);
      // A car the player drives into a pedestrian.
      if (player.inCar && !player.inCar.dead && dist(ped.x, ped.y, player.x, player.y) < 30 && Math.abs(player.inCar.speed) > 80) {
        ped.state = 'down';
        ped.downTimer = 5;
        spawnParticle(ped.x, ped.y, '#c22', 8, 120, 0.6, 4);
        addWanted(WANTED.hitPed, 'PEDESTRIAN HIT');
      }
      // The player's car scares nearby pedestrians.
      if (player.inCar && Math.abs(player.inCar.speed) > 200 && dist(ped.x, ped.y, player.x, player.y) < 120 && ped.state === 'walk') {
        ped.state = 'flee';
        ped.timer = 2;
        ped.fleeX = ped.x + (ped.x - player.x);
        ped.fleeY = ped.y + (ped.y - player.y);
      }
    }
    // Top the crowd back up.
    pedTimer -= dt;
    if (pedTimer <= 0 && peds.filter((p) => p.state !== 'dead').length < PEDS.count) {
      peds.push(makePed(random, city));
      pedTimer = 1.5;
    }
  }

  function stepBullets(dt) {
    let events = EVENT_NONE;
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      const wall = hitBuilding(city, b.x, b.y, 2);
      if (wall) {
        b.dead = true;
        spawnParticle(b.x, b.y, '#c9c9c9', 3, 80, 0.3, 2);
        continue;
      }
      if (b.friendly) {
        for (const ped of peds) {
          if (ped.state === 'dead') continue;
          if (dist(b.x, b.y, ped.x, ped.y) < 16) {
            b.dead = true;
            state.stats.shotsHit += 1;
            if (ped.gang) {
              ped.hp -= b.damage;
              spawnParticle(b.x, b.y, '#c22', 5, 100, 0.4, 3);
              if (ped.hp <= 0) killPed(ped, 'silent');
            } else {
              killPed(ped, 'shot');
            }
            break;
          }
        }
        if (b.dead) continue;
        for (const o of officers) {
          if (o.state === 'down') continue;
          if (dist(b.x, b.y, o.x, o.y) < 16) {
            b.dead = true;
            state.stats.shotsHit += 1;
            o.state = 'down';
            o.timer = 6;
            state.kills += 1;
            addWanted(WANTED.killCop, 'OFFICER DOWN');
            spawnParticle(b.x, b.y, '#c22', 5, 100, 0.4, 3);
            break;
          }
        }
        if (b.dead) continue;
        for (const car of cars) {
          if (car.dead || car === player.inCar) continue;
          const dx = b.x - car.x;
          const dy = b.y - car.y;
          const along = Math.abs(dx * Math.cos(car.angle) + dy * Math.sin(car.angle));
          const across = Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle));
          if (along < 28 && across < 16) {
            b.dead = true;
            state.stats.shotsHit += 1;
            damageCar(car, b.damage);
            spawnParticle(b.x, b.y, '#ffb347', 4, 120, 0.3, 3);
            if (car.kind === 'police') events |= addWanted(1, 'SHOOTING AT POLICE');
            break;
          }
        }
      } else {
        // Enemy bullet: only the player can be hit.
        if (!player.inCar && dist(b.x, b.y, player.x, player.y) < 14) {
          b.dead = true;
          hurtPlayer(b.damage * 0.6);
        } else if (player.inCar && dist(b.x, b.y, player.x, player.y) < 26) {
          b.dead = true;
          damageCar(player.inCar, b.damage * 0.5);
        }
      }
    }
    for (let i = bullets.length - 1; i >= 0; i -= 1) if (bullets[i].dead) bullets.splice(i, 1);
    return events;
  }

  function stepCarCollisions() {
    for (let i = 0; i < cars.length; i += 1) {
      const a = cars[i];
      if (a.dead) continue;
      for (let j = i + 1; j < cars.length; j += 1) {
        const b = cars[j];
        if (b.dead) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= 44 || d <= 0.01) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (44 - d) / 2;
        // The player's car is the heavy one: it barely moves in a shunt,
        // the other car takes almost all of the push.
        const aWeight = a === player.inCar ? 0.05 : b === player.inCar ? 0.95 : 0.5;
        const bWeight = 1 - aWeight;
        a.x -= nx * push * 2 * aWeight;
        a.y -= ny * push * 2 * aWeight;
        b.x += nx * push * 2 * bWeight;
        b.y += ny * push * 2 * bWeight;
        // Impulse along the line of centres, so a rear-end shoves the car
        // ahead instead of stopping it dead.
        const avx = Math.cos(a.angle) * a.speed;
        const avy = Math.sin(a.angle) * a.speed;
        const bvx = Math.cos(b.angle) * b.speed;
        const bvy = Math.sin(b.angle) * b.speed;
        const rel = (bvx - avx) * nx + (bvy - avy) * ny;
        if (rel >= 0) continue; // separating already
        // Masses: the player's car is heavy, a patrol car is light, so a ram
        // shoves the patrol car off instead of the player.
        const ma = a === player.inCar ? 3 : a.kind === 'police' ? 1 : 1.5;
        const mb = b === player.inCar ? 3 : b.kind === 'police' ? 1 : 1.5;
        const impulse = (-rel * 0.7) / (1 / ma + 1 / mb);
        const avx2 = avx - (impulse * nx) / ma;
        const avy2 = avy - (impulse * ny) / ma;
        const bvx2 = bvx + (impulse * nx) / mb;
        const bvy2 = bvy + (impulse * ny) / mb;
        const aDot = avx2 * Math.cos(a.angle) + avy2 * Math.sin(a.angle);
        const bDot = bvx2 * Math.cos(b.angle) + bvy2 * Math.sin(b.angle);
        a.speed = Math.hypot(avx2, avy2) * (aDot >= 0 ? 1 : -1);
        b.speed = Math.hypot(bvx2, bvy2) * (bDot >= 0 ? 1 : -1);
        if (Math.abs(rel) > 200 && (a === player.inCar || b === player.inCar)) {
          state.shake = Math.max(state.shake, 4);
        }
      }
    }
  }

  function stepPickups(dt) {
    let events = EVENT_NONE;
    for (const p of pickups) {
      p.life -= dt;
      if (p.life <= 0) { p.dead = true; continue; }
      if (p.dead) continue;
      if (dist(p.x, p.y, player.x, player.y) < 30) {
        p.dead = true;
        if (p.kind === 'health') {
          player.health = Math.min(PLAYER.health, player.health + p.amount);
          addMessage(`+${p.amount} HEALTH`, '#7ddc7d');
        } else if (p.kind === 'ammo') {
          player.reserve += p.amount;
          addMessage(`+${p.amount} AMMO`, '#7ddc7d');
        } else if (p.kind === 'cash') {
          player.money += p.amount;
          addMessage(`+$${p.amount}`, '#7ddc7d');
        } else if (p.kind === 'package') {
          addMessage('PACKAGE COLLECTED', '#ffd23f');
        }
        events |= EVENT_PICKUP;
      }
    }
    for (let i = pickups.length - 1; i >= 0; i -= 1) if (pickups[i].dead) pickups.splice(i, 1);
    return events;
  }

  function stepWanted(dt) {
    if (state.wanted === 0) return;
    const nearestCop = Math.min(
      ...cars.filter((c) => c.kind === 'police' && !c.dead).map((c) => dist(c.x, c.y, player.x, player.y)),
      ...officers.map((o) => dist(o.x, o.y, player.x, player.y)),
      99999,
    );
    if (nearestCop > 520) {
      state.unseenTimer += dt;
      if (state.unseenTimer > WANTED.decayDelay) {
        state.wantedTimer += dt;
        if (state.wantedTimer >= WANTED.decayPerStar) {
          state.wantedTimer = 0;
          state.wanted -= 1;
          if (state.wanted === 0) {
            addMessage('YOU LOST THE COPS', '#7ddc7d');
            state.unseenTimer = 0;
          }
        }
      }
    } else {
      state.unseenTimer = 0;
      state.wantedTimer = 0;
    }
  }

  /** Enter the nearest car, or step out of the one the player is driving. */
  function toggleCar() {
    if (player.inCar) {
      const car = player.inCar;
      player.inCar = null;
      const a = car.angle + Math.PI / 2;
      player.x = car.x + Math.cos(a) * 34;
      player.y = car.y + Math.sin(a) * 34;
      player.angle = car.angle;
      car.speed = 0;
      return EVENT_NONE;
    }
    const car = nearestCar(player.x, player.y, CAR.enterRange, ['parked', 'traffic', 'mission']);
    if (!car) return EVENT_NONE;
    let events = EVENT_NONE;
    if (car.kind === 'traffic') {
      // Jack it: the driver bails out and becomes a pedestrian.
      car.driver = false;
      car.kind = 'parked';
      peds.push({
        x: car.x + 30, y: car.y + 30, angle: 0, speed: 60, r: 12, state: 'flee',
        timer: 3, color: '#e07a5f', fleeX: car.x + 300, fleeY: car.y + 300, downTimer: 0,
      });
      state.carsStolen += 1;
      events |= EVENT_CAR_STOLEN;
      events |= addWanted(WANTED.stealCar, 'CAR STOLEN');
      addMessage(`Stole a ${CAR_MODELS[car.model].name}`, '#ffd23f');
    } else if (car.kind === 'mission') {
      addMessage(`Got the ${CAR_MODELS[car.model].name}`, '#ffd23f');
    }
    car.kind = 'player';
    player.inCar = car;
    player.x = car.x;
    player.y = car.y;
    return events;
  }

  /** A gang member, spawned by missions: shoots at the player. */
  function spawnGang(x, y, hp) {
    const ped = {
      x, y, angle: 0, speed: 90, r: 12, state: 'walk', timer: 0,
      color: '#8c2f2f', gang: true, hp: hp || 100, shootTimer: range(random, 0.5, 1.5),
      fleeX: 0, fleeY: 0, downTimer: 0,
    };
    peds.push(ped);
    return ped;
  }

  function stepGang(dt) {
    for (const ped of peds) {
      if (!ped.gang || ped.state === 'dead') continue;
      const d = dist(ped.x, ped.y, player.x, player.y);
      ped.angle = angleTo(ped.x, ped.y, player.x, player.y);
      if (d > 260) {
        ped.x += Math.cos(ped.angle) * ped.speed * dt;
        ped.y += Math.sin(ped.angle) * ped.speed * dt;
      } else if (d > 60) {
        ped.x += Math.cos(ped.angle) * ped.speed * 0.4 * dt;
        ped.y += Math.sin(ped.angle) * ped.speed * 0.4 * dt;
      }
      collideBuildings(city, ped);
      ped.shootTimer -= dt;
      if (ped.shootTimer <= 0 && d < 480) {
        ped.shootTimer = range(random, 1.3, 2.2);
        const a = angleTo(ped.x, ped.y, player.x, player.y) + range(random, -0.18, 0.18);
        bullets.push({
          x: ped.x + Math.cos(a) * 20, y: ped.y + Math.sin(a) * 20,
          vx: Math.cos(a) * 620, vy: Math.sin(a) * 620,
          life: 480 / 620, friendly: false, damage: 9,
        });
        spawnParticle(ped.x + Math.cos(a) * 26, ped.y + Math.sin(a) * 26, '#ffd23f', 3, 90, 0.15, 3);
      }
    }
  }

  function step(dt, input, aimAngle) {
    let events = EVENT_NONE;
    state.elapsed += dt;
    state.clock = (CLOCK.startHour + state.elapsed / CLOCK.secondsPerHour) % 24;

    const move = input.move();
    const mouse = input.mouse();
    const firing = mouse.down;
    const actions = input.takeActions();
    const enterPressed = !!(actions & 4); // ACTION_ENTER
    // Talking to a mission contact wins over entering a car.
    let missionEvent = 0;
    const m = state.mission;
    if (m && !m.done && m.step && m.step.kind === 'talk' && enterPressed) {
      const d = Math.hypot(player.x - m.step.x, player.y - m.step.y);
      if (d < (m.step.radius || 70)) missionEvent = updateMission(api, dt, true);
    }
    if (!missionEvent && enterPressed) events |= toggleCar();
    if (actions & 8) { /* punch handled in on-foot step via flag */ }
    if (actions & 16 && player.reloading <= 0 && player.mag < WEAPON.mag && player.reserve > 0) {
      player.reloading = WEAPON.reloadTime;
    }

    if (player.inCar) events |= stepPlayerCar(dt, { ...move, handbrake: input.keys.handbrake });
    else events |= stepPlayerOnFoot(dt, { ...move, run: input.keys.run }, aimAngle, firing, !!(actions & 8));

    events |= stepTraffic(dt);
    events |= stepPolice(dt);
    events |= stepPeds(dt);
    events |= stepGang(dt);
    events |= stepBullets(dt);
    stepCarCollisions();
    events |= stepPickups(dt);
    stepWanted(dt);
    if (!missionEvent) events |= updateMission(api, dt, false);
    else events |= missionEvent;

    // Traffic and crowd top-ups near the player.
    trafficTimer -= dt;
    if (trafficTimer <= 0) {
      const trafficCars = cars.filter((c) => c.kind === 'traffic');
      if (trafficCars.length < TRAFFIC.count) spawnTrafficCar(player.x, player.y);
      trafficTimer = 1.2;
    }

    // Particles.
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.life -= dt;
    }
    for (let i = particles.length - 1; i >= 0; i -= 1) if (particles[i].life <= 0) particles.splice(i, 1);

    // Messages.
    for (const m of messages) m.life -= dt;
    for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].life <= 0) messages.splice(i, 1);

    if (player.hurt > 0) player.hurt -= dt;
    if (player.invulnerable > 0) player.invulnerable -= dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 30);

    // Camera follows the player (or the car), with a little look-ahead.
    const tx = player.x + (player.inCar ? Math.cos(player.angle) * 60 : 0);
    const ty = player.y + (player.inCar ? Math.sin(player.angle) * 60 : 0);
    state.camera.x += (tx - state.camera.x) * Math.min(1, dt * 5);
    state.camera.y += (ty - state.camera.y) * Math.min(1, dt * 5);

    // Car-car shunts move the player's car after the drive step ran: keep
    // the player glued to the car they are driving.
    if (player.inCar) {
      player.x = player.inCar.x;
      player.y = player.inCar.y;
    }

    if (player.health <= 0) events |= EVENT_WASTED;
    return events;
  }

  const api = {
    state, city, reset, step, addMessage, addWanted, spawnParticle, explode, damageCar,
    hurtPlayer, spawnGang, spawnPoliceCar, nearestCar, toggleCar, killPed,
    makeCar: (x, y, angle, model, kind) => {
      const car = makeCar(carId, x, y, angle, model, kind);
      car.id = carId; carId += 1;
      cars.push(car);
      return car;
    },
    spawnPickup: (x, y, kind, amount) => pickups.push({ x, y, kind, amount, life: 9999 }),
    setWanted: (n) => { state.wanted = n; state.unseenTimer = 0; },
  };
  reset();
  return api;
}
