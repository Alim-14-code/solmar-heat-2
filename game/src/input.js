// Keyboard and mouse input. Held keys give a movement vector; one-shot presses
// (enter car, punch, pause, confirm) are queued as bit flags and taken once by
// the loop, so a press between two frames is never lost or counted twice.
// The mouse aims the pistol: its world position is computed from the camera.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;
export const ACTION_PUNCH = 8;
export const ACTION_RELOAD = 16;
export const ACTION_SAVE = 32;
export const ACTION_MUTE = 64;
export const ACTION_NEWGAME = 128;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER = new Set(['KeyE']);
const PUNCH = new Set(['KeyF', 'Space']);
const RELOAD = new Set(['KeyR']);
const SAVE = new Set(['KeyQ']);
const MUTE = new Set(['KeyM']);
const NEWGAME = new Set(['KeyN']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);
const HANDBRAKE = new Set(['Space']);

export function createInput(canvas) {
  const keys = { up: false, down: false, left: false, right: false, run: false, handbrake: false };
  let actions = 0;
  let mouseX = 0;
  let mouseY = 0;
  let mouseDown = false;
  let mouseClicked = false;

  function press(code, down) {
    if (UP.has(code)) keys.up = down;
    else if (DOWN.has(code)) keys.down = down;
    else if (LEFT.has(code)) keys.left = down;
    else if (RIGHT.has(code)) keys.right = down;
    else if (RUN.has(code)) keys.run = down;
    else if (HANDBRAKE.has(code)) keys.handbrake = down;
  }

  window.addEventListener('keydown', (event) => {
    if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (ENTER.has(event.code)) {
      if (!event.repeat) actions |= ACTION_ENTER;
    } else if (PUNCH.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PUNCH;
    } else if (RELOAD.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RELOAD;
    } else if (SAVE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_SAVE;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else if (NEWGAME.has(event.code)) {
      if (!event.repeat) actions |= ACTION_NEWGAME;
    } else if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code) || RUN.has(event.code) || HANDBRAKE.has(event.code)) {
      press(event.code, true);
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => press(event.code, false));
  window.addEventListener('blur', () => {
    keys.up = keys.down = keys.left = keys.right = keys.run = keys.handbrake = false;
    mouseDown = false;
  });

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
  });
  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
    mouseDown = true;
    mouseClicked = true;
    if (event.button === 0) actions |= ACTION_CONFIRM;
  });
  window.addEventListener('pointerup', () => {
    mouseDown = false;
  });

  return {
    keys,
    /** -1/0/1 steering and throttle, from held keys. */
    move() {
      return {
        x: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
        y: (keys.down ? 1 : 0) - (keys.up ? 1 : 0),
      };
    },
    mouse() {
      return { x: mouseX, y: mouseY, down: mouseDown };
    },
    takeClick() {
      const clicked = mouseClicked;
      mouseClicked = false;
      return clicked;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. With a
     *  mask, only those bits are taken; the rest stay queued for the world. */
    takeActions(mask) {
      const want = mask === undefined ? 0xffff : mask;
      const taken = actions & want;
      actions &= ~want;
      return taken;
    },
    /** Drive a virtual key state (used by the screenshot autopilot). */
    setVirtual(next) {
      keys.up = !!next.up;
      keys.down = !!next.down;
      keys.left = !!next.left;
      keys.right = !!next.right;
      keys.run = !!next.run;
      keys.handbrake = !!next.handbrake;
    },
  };
}
