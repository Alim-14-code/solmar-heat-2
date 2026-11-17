// Sound, synthesized live with WebAudio: no audio files, no network. Engine
// hum follows the car's speed, the siren wails when the heat is on, and a
// small bass loop plays the city's radio. M toggles mute.
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let musicTimer = null;
  let muted = false;
  let musicStep = 0;

  // A lazy bassline in A minor, one note per beat, with a hat tick.
  const BASS = [55, 0, 55, 65.41, 0, 55, 49, 55, 55, 0, 55, 65.41, 82.41, 73.42, 65.41, 49];
  const BEAT = 0.24;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 50;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      return true;
    } catch {
      return false;
    }
  }

  function blip(freq, dur, type, vol, slideTo) {
    if (!ensure() || muted) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
      gain.gain.setValueAtTime(vol || 0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
    } catch { /* audio is best-effort */ }
  }

  function noise(dur, vol, lowpass) {
    if (!ensure() || muted) return;
    try {
      const len = Math.floor(ctx.sampleRate * dur);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass || 1200;
      const gain = ctx.createGain();
      gain.gain.value = vol || 0.3;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start();
    } catch { /* audio is best-effort */ }
  }

  function musicTick() {
    if (!ctx || muted) return;
    const note = BASS[musicStep % BASS.length];
    musicStep += 1;
    if (note) blip(note, BEAT * 0.9, 'triangle', 0.12);
    if (musicStep % 2 === 0) blip(6000, 0.03, 'square', 0.02);
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (ctx && !musicTimer) musicTimer = window.setInterval(musicTick, BEAT * 1000);
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    isMuted() { return muted; },
    shot() { noise(0.14, 0.35, 2500); blip(180, 0.08, 'square', 0.2, 60); },
    enemyShot() { noise(0.1, 0.15, 1800); },
    crash() { noise(0.25, 0.4, 700); },
    explosion() { noise(0.7, 0.5, 400); blip(60, 0.6, 'sine', 0.4, 30); },
    pickup() { blip(660, 0.09, 'sine', 0.18); blip(990, 0.12, 'sine', 0.18); },
    missionDone() {
      [523, 659, 784, 1047].forEach((f, i) => window.setTimeout(() => blip(f, 0.22, 'triangle', 0.2), i * 110));
    },
    busted() { [392, 330, 262].forEach((f, i) => window.setTimeout(() => blip(f, 0.3, 'sawtooth', 0.15), i * 180)); },
    click() { blip(880, 0.05, 'square', 0.1); },
    /** Called every frame: engine pitch from speed, siren from wanted level. */
    update(speed, wanted, inCar) {
      if (!ctx || muted) return;
      try {
        const target = inCar ? 0.05 + Math.min(0.16, Math.abs(speed) / 4000) : 0;
        engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
        engineOsc.frequency.setTargetAtTime(45 + Math.abs(speed) * 0.22, ctx.currentTime, 0.1);
        if (wanted > 0) {
          sirenGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.3);
          const t = ctx.currentTime % 1.2;
          sirenOsc.frequency.setTargetAtTime(t < 0.6 ? 720 : 540, ctx.currentTime, 0.05);
        } else {
          sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        }
      } catch { /* audio is best-effort */ }
    },
  };
}
