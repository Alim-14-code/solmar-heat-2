// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps (several in a slow frame, none in a fast one), and the
// renderer paints what is there. The game moves between six screens: title,
// play, paused, busted, wasted and story-complete.
// ?seed=N fixes the city. ?shot=chase|start|mission|street (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { BEST_KEY, SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createCity } from './city.js';
import { createWorld, EVENT_BUSTED, EVENT_SHOT, EVENT_WASTED } from './world.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_NEWGAME, ACTION_PAUSE, ACTION_SAVE, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_COMPLETE, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED } from './render.js';
import { EVENT_MISSION_DONE, MISSIONS, startMission, startNextMission } from './missions.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261117;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const city = createCity(createRandom(seed));
const world = createWorld(createRandom(seed + 7), city);
const renderer = createRenderer(canvas);
const audio = createAudio();
const input = createInput(canvas);

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    const s = world.state;
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: s.player.money,
      missionsDone: s.missionsDone,
      kills: s.kills,
      carsStolen: s.carsStolen,
      x: s.player.x,
      y: s.player.y,
      health: s.player.health,
      savedAt: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best then lasts this visit only.
  }
}

function runShot(name) {
  const staged = stageShot(name, world, city);
  const ui = { saveExists: true, best: 12450, missionsDone: 2, briefing: null, savedFlash: false, ...staged.ui };
  let painted = 0;
  function paint() {
    const mouse = { x: 640, y: 360 };
    renderer.draw(world.state, city, staged.screen, ui, mouse);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  let screen = SCREEN_TITLE;
  let best = readBest();
  let save = readSave();
  let accumulator = 0;
  let last = performance.now();
  let briefing = null; // { title, text, reward, life }
  let savedFlashUntil = 0;

  function announce(message) {
    status.textContent = message;
  }

  function showBriefing(mission) {
    briefing = { title: mission.title, text: mission.briefing, reward: mission.reward, life: 6 };
  }

  function startGame(fresh) {
    const s = world.state;
    if (fresh || !save) {
      world.reset();
      save = null;
    } else {
      world.reset({ money: save.money, missionsDone: save.missionsDone });
      s.player.x = save.x;
      s.player.y = save.y;
      s.player.health = save.health;
      s.kills = save.kills;
      s.carsStolen = save.carsStolen;
    }
    if (s.missionsDone < MISSIONS.length) {
      const mission = MISSIONS[s.missionsDone];
      startMission(world, s.missionsDone);
      showBriefing(mission);
    }
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce(`Playing. Mission: ${s.mission ? s.mission.title : 'free roam'}.`);
  }

  function toTitle() {
    screen = SCREEN_TITLE;
    save = readSave();
    announce('Solmar Heat. Press Enter to start.');
  }

  function respawn(kind) {
    const s = world.state;
    // Busted or wasted: lose $200, wake up at the hospital, heat cleared.
    s.player.money = Math.max(0, s.player.money - 200);
    s.player.health = 100;
    s.player.inCar = null;
    world.setWanted(0);
    const hospital = city.landmarks.hospital;
    s.player.x = hospital.x;
    s.player.y = hospital.y + 80;
    s.camera.x = s.player.x;
    s.camera.y = s.player.y;
    // A failed mission restarts from its first step.
    if (s.mission && !s.mission.done) {
      startMission(world, s.mission.index);
      showBriefing(MISSIONS[s.mission.index]);
    }
    screen = SCREEN_PLAY;
    announce(kind === 'busted' ? 'Busted. Back on the street.' : 'Wasted. Back on the street.');
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      // The city lives behind the title.
      world.step(STEP, { move: () => ({ x: 0, y: 0 }), mouse: () => ({ x: 640, y: 360, down: false }), takeActions: () => 0, keys: {} }, 0);
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    const mouse = input.mouse();
    const logical = renderer.toLogical(mouse.x, mouse.y);
    const p = world.state.player;
    // Aim from the player to the mouse in world space: the mouse's logical
    // position is screen space; convert through the camera.
    const worldMouseX = world.state.camera.x + (logical.x - 640);
    const worldMouseY = world.state.camera.y + (logical.y - 360);
    const aim = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
    const events = world.step(STEP, input, aim);
    if (events & EVENT_SHOT) audio.shot();
    if (events & EVENT_MISSION_DONE) {
      audio.missionDone();
      const done = world.state.mission;
      if (world.state.missionsDone >= MISSIONS.length) {
        screen = SCREEN_COMPLETE;
        if (world.state.player.money > best) {
          best = world.state.player.money;
          saveBest(best);
        }
        writeSave();
        announce('Story complete! Debt paid.');
      } else if (done) {
        const next = MISSIONS[world.state.missionsDone];
        startNextMission(world);
        if (next) showBriefing(next);
        writeSave();
      }
    }
    if (events & EVENT_BUSTED) {
      audio.busted();
      screen = SCREEN_BUSTED;
    }
    if (events & EVENT_WASTED) {
      audio.busted();
      screen = SCREEN_WASTED;
    }
    if (briefing) {
      briefing.life -= STEP;
      if (briefing.life <= 0) briefing = null;
    }
    // Engine and siren follow the world.
    const speed = p.inCar ? p.inCar.speed : 0;
    audio.update(speed, world.state.wanted, !!p.inCar);
  }

  function handleActions() {
    const actions = input.takeActions(ACTION_CONFIRM | ACTION_PAUSE | ACTION_SAVE | ACTION_MUTE | ACTION_NEWGAME);
    if (actions & ACTION_SAVE && screen === SCREEN_PLAY) {
      if (writeSave()) {
        savedFlashUntil = performance.now() + 1500;
        world.addMessage('GAME SAVED', '#7ddc7d');
      }
    }
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      if (screen === SCREEN_PLAY) world.addMessage(muted ? 'SOUND OFF' : 'SOUND ON', '#f5f1e6');
    }
    if (actions & ACTION_CONFIRM) {
      audio.unlock();
      if (screen === SCREEN_TITLE) startGame(false);
      else if (screen === SCREEN_BUSTED) respawn('busted');
      else if (screen === SCREEN_WASTED) respawn('wasted');
      else if (screen === SCREEN_COMPLETE) toTitle();
    }
    if (actions & ACTION_NEWGAME && screen === SCREEN_TITLE) {
      audio.unlock();
      startGame(true);
    }
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    }
    // Mute is a plain keydown, handled here through a key check.
    if (input.takeMute && input.takeMute()) audio.toggleMute();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    const mouse = input.mouse();
    const logical = renderer.toLogical(mouse.x, mouse.y);
    const ui = {
      saveExists: !!save,
      best,
      missionsDone: world.state.missionsDone,
      briefing,
      savedFlash: performance.now() < savedFlashUntil,
    };
    renderer.draw(world.state, city, screen, ui, logical);
  }

  // Leaving the tab pauses a running game rather than letting the cops catch
  // the player unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Solmar Heat. Press Enter to start.');
  // Debug handle for automated play-testing; harmless in normal play.
  window.__solmar = { world, city };
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
