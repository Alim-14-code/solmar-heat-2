// The story of Solmar Heat: six missions that take Dario Cruz from a broke
// returnee to the man who pays off Big Sal. Each mission is a list of steps;
// the engine below advances them, spawns what they need (packages, gang
// members, a getaway car) and pays the reward. Nothing here draws anything.
import { CAR_MODELS, nearestRoadCoord } from './config.js';

export const EVENT_MISSION_DONE = 256;
export const EVENT_MISSION_FAILED = 512;
export const EVENT_MISSION_STEP = 1024;

/**
 * Step kinds:
 *  talk    — stand by the marker and press E
 *  goto    — reach the marker (on foot or in a car)
 *  pickup  — collect the package at the marker
 *  kill    — wipe out the gang members the step spawns
 *  deliver — reach the marker while driving the mission car
 *  survive — stay alive for `seconds` while the heat is on
 *  escape  — lose the wanted level entirely
 */
export const MISSIONS = [
  {
    id: 'welcome-back',
    title: '1. Welcome Back',
    briefing: 'Dario is back in Solmar, broke and owing Big Sal $50,000. Mama Luz at the diner has work. Go see her.',
    reward: 300,
    steps: [
      { kind: 'goto', at: 'diner', label: 'Go to Mama Luz’s Diner', radius: 70 },
      { kind: 'talk', at: 'diner', label: 'Talk to Mama Luz (press E)', radius: 70 },
    ],
  },
  {
    id: 'the-pickup',
    title: '2. The Pickup',
    briefing: 'Luz needs a package from the docks. The Delgados want it too — expect company.',
    reward: 800,
    steps: [
      { kind: 'goto', at: 'docks', label: 'Drive to the Solmar Docks', radius: 90 },
      { kind: 'pickup', at: 'docks', label: 'Grab the package', radius: 60 },
      { kind: 'kill', at: 'docks', count: 3, label: 'Deal with the Delgado crew (0/3)', radius: 420 },
      { kind: 'goto', at: 'diner', label: 'Bring the package back to Luz', radius: 70 },
    ],
  },
  {
    id: 'joyride',
    title: '3. Joyride',
    briefing: 'Rico needs a Coupe Diablo for a buyer. Steal one, any one — and mind the cops.',
    reward: 1200,
    steps: [
      { kind: 'steal', model: 6, label: 'Steal a Coupe Diablo (dark red sports car)', radius: 0 },
      { kind: 'deliver', at: 'garage', label: 'Deliver the Diablo to Rico’s Garage', radius: 80 },
    ],
  },
  {
    id: 'payback',
    title: '4. Payback',
    briefing: 'The Delgados hit Luz’s diner. Take the fight to their cannery warehouse and settle it.',
    reward: 2000,
    steps: [
      { kind: 'goto', at: 'warehouse', label: 'Go to the Old Cannery Warehouse', radius: 90 },
      { kind: 'kill', at: 'warehouse', count: 5, label: 'Clear the warehouse (0/5)', radius: 460 },
      { kind: 'pickup', at: 'warehouse', label: 'Take the Delgado cash stash', radius: 60 },
    ],
  },
  {
    id: 'the-getaway',
    title: '5. The Getaway',
    briefing: 'Sal’s collectors are coming for the diner’s till. Grab the getaway car and lose them.',
    reward: 3500,
    steps: [
      { kind: 'goto', at: 'motel', label: 'Pick up the getaway car at Palm Court Motel', radius: 70 },
      { kind: 'survive', seconds: 45, label: 'Survive the heat — stay alive 45s', radius: 0 },
      { kind: 'escape', label: 'Lose the cops', radius: 0 },
    ],
  },
  {
    id: 'big-sals-debt',
    title: '6. Big Sal’s Debt',
    briefing: 'One last job: the Solmar National Bank vault. Grab the cash, get to the hideout, and Dario is free.',
    reward: 50000,
    steps: [
      { kind: 'goto', at: 'bank', label: 'Get to Solmar National Bank', radius: 80 },
      { kind: 'kill', at: 'bank', count: 4, label: 'Get past the bank guards (0/4)', radius: 420 },
      { kind: 'pickup', at: 'bank', label: 'Grab the vault cash', radius: 60 },
      { kind: 'goto', at: 'hideout', label: 'Escape to the hideout — lose the cops on the way', radius: 80 },
    ],
  },
];

function stepTarget(world, step) {
  if (step.at) {
    const lm = world.city.landmarks[step.at];
    return { x: lm.x, y: lm.y, label: lm.name };
  }
  return null;
}

function startStep(world, mission, stepIndex) {
  const step = mission.steps[stepIndex];
  const s = world.state;
  const m = s.mission;
  m.stepIndex = stepIndex;
  m.step = { ...step };
  m.stepState = { kills: 0, timer: 0, spawned: false };
  const target = stepTarget(world, step);
  if (target) {
    m.step.x = target.x;
    m.step.y = target.y;
    m.step.place = target.label;
    // A big landmark's edge can be far from its centre: the radius must
    // cover the building, or the player can never arrive.
    const lm = world.city.landmarks[step.at];
    m.step.radius = Math.max(step.radius || 70, Math.hypot(lm.w, lm.h) / 2 + 40);
  }
  if (step.kind === 'pickup') {
    // The landmark can be a building: a package at its centre sits inside
    // the walls, and the player can never reach it (buildings push the
    // player out, collect radius is 30). Put it on the street outside.
    const lm = world.city.landmarks[step.at];
    m.step.x = lm.x;
    m.step.y = nearestRoadCoord(lm.y);
    world.spawnPickup(m.step.x, m.step.y, 'package', 0);
  }
  if (step.kind === 'survive' || step.kind === 'escape' || step.kind === 'kill') {
    world.setWanted(Math.max(s.wanted, 2));
    if (step.kind === 'survive') world.addMessage('THE HEAT IS ON — SURVIVE!', '#ff6b6b');
  }
  if (step.kind === 'kill') {
    const lm = world.city.landmarks[step.at];
    // Gang members hold the roads around the landmark, never inside a
    // building, so the player can actually reach and shoot them.
    const roadY = nearestRoadCoord(lm.y);
    const roadX = nearestRoadCoord(lm.x);
    for (let i = 0; i < step.count; i += 1) {
      let gx;
      let gy;
      if (i % 2 === 0) {
        gx = lm.x + (i - step.count / 2) * 90;
        gy = roadY + (i % 4 < 2 ? -24 : 24);
      } else {
        gx = roadX + (i % 4 < 2 ? -24 : 24);
        gy = lm.y + (i - step.count / 2) * 90;
      }
      world.spawnGang(gx, gy, 100);
    }
    m.stepState.spawned = true;
  }
  if (step.kind === 'steal') {
    // Make sure a Diablo exists nearby: park one a few blocks from the
    // player, on a road. The raw offset can land inside a building, where
    // the car can never be reached.
    const p = s.player;
    const cx = Math.max(80, Math.min(world.city.size - 80, p.x + 260));
    const cy = nearestRoadCoord(p.y - 180);
    world.makeCar(cx, cy, 0, step.model, 'parked');
    world.addMessage(`A ${CAR_MODELS[step.model].name} is parked nearby — take it`, '#ffd23f');
  }
  world.addMessage(step.label, '#ffd23f');
}

export function startMission(world, index) {
  const mission = MISSIONS[index];
  if (!mission) return false;
  world.state.mission = { index, title: mission.title, briefing: mission.briefing, stepIndex: 0, step: null, stepState: null, done: false };
  world.addMessage(`MISSION: ${mission.title}`, '#ffd23f');
  world.addMessage(mission.briefing, '#f5f1e6');
  startStep(world, mission, 0);
  return true;
}

/** The current objective, for the HUD arrow and the minimap. */
export function currentObjective(world) {
  const m = world.state.mission;
  if (!m || m.done || !m.step) return null;
  const step = m.step;
  if (step.kind === 'steal') {
    const car = world.state.cars.find((c) => c.model === step.model && (c.kind === 'parked' || c.kind === 'player'));
    if (car) return { x: car.x, y: car.y, label: step.label };
    return { x: world.state.player.x + 260, y: world.state.player.y - 180, label: step.label };
  }
  if (step.kind === 'survive' || step.kind === 'escape') {
    return { x: world.state.player.x, y: world.state.player.y, label: step.label };
  }
  if (step.x !== undefined) return { x: step.x, y: step.y, label: step.label };
  return null;
}

function advance(world, mission) {
  const m = world.state.mission;
  const next = m.stepIndex + 1;
  if (next >= mission.steps.length) {
    m.done = true;
    world.state.player.money += mission.reward;
    world.state.missionsDone += 1;
    world.addMessage(`MISSION COMPLETE — +$${mission.reward.toLocaleString('en-US')}`, '#7ddc7d');
    world.spawnParticle(world.state.player.x, world.state.player.y, '#ffd23f', 24, 220, 1, 6);
    return EVENT_MISSION_DONE;
  }
  startStep(world, mission, next);
  return EVENT_MISSION_STEP;
}

/** Advance the active mission one step; returns EVENT_* flags. */
export function updateMission(world, dt, pressedEnter) {
  const m = world.state.mission;
  if (!m || m.done) return 0;
  const mission = MISSIONS[m.index];
  const step = m.step;
  const s = world.state;
  const p = s.player;
  const d = step.x !== undefined ? Math.hypot(p.x - step.x, p.y - step.y) : 99999;

  if (step.kind === 'goto' || step.kind === 'deliver') {
    if (step.kind === 'deliver' && !p.inCar) return 0;
    if (d < (step.radius || 70)) return advance(world, mission);
  } else if (step.kind === 'talk') {
    if (d < (step.radius || 70) && pressedEnter) {
      world.addMessage('Mama Luz: “Good boy. Now earn it.”', '#f5f1e6');
      return advance(world, mission);
    }
  } else if (step.kind === 'pickup') {
    // The package pickup disappearing means it was collected.
    const stillThere = s.pickups.some((pk) => pk.kind === 'package');
    if (!stillThere) return advance(world, mission);
  } else if (step.kind === 'kill') {
    const gangLeft = s.peds.filter((pd) => pd.gang && pd.state !== 'dead').length;
    const killed = step.count - gangLeft;
    if (killed !== m.stepState.kills) {
      m.stepState.kills = killed;
      step.label = step.label.replace(/\(\d+\/\d+\)/, `(${killed}/${step.count})`);
    }
    if (gangLeft === 0) return advance(world, mission);
  } else if (step.kind === 'steal') {
    if (p.inCar && p.inCar.model === step.model) return advance(world, mission);
  } else if (step.kind === 'survive') {
    m.stepState.timer += dt;
    const left = Math.ceil(step.seconds - m.stepState.timer);
    step.label = `Survive the heat — stay alive ${Math.max(0, left)}s`;
    if (m.stepState.timer >= step.seconds) return advance(world, mission);
  } else if (step.kind === 'escape') {
    if (s.wanted === 0) return advance(world, mission);
  }
  return 0;
}

/** Start the next mission, or false when the story is over. */
export function startNextMission(world) {
  const next = world.state.missionsDone;
  if (next >= MISSIONS.length) return false;
  return startMission(world, next);
}
