/*
 * Everything the game makes noise with, synthesised on the fly through Web
 * Audio. No audio files: the whole palette here is short filtered noise bursts
 * and a wind bed, which is a few hundred bytes of code instead of a few hundred
 * kilobytes of assets on the critical path — and the pieces are stone, so a
 * noise burst through a resonant filter is closer to right than a sample.
 *
 * Lives in components/ rather than lib/ for the same reason proceduralTextures
 * does: lib/ is pure game logic that has to run under plain Node, and this
 * needs a browser.
 *
 * Sound is OFF until the player asks for it. Autoplay policy would block it
 * anyway, and a scene that starts making noise on its own is worse than one
 * that stays quiet.
 */

let ctx = null;
let master = null;
let wind = null;
let enabled = false;

function context() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  return ctx;
}

/** A couple of seconds of white noise, reused as the source for everything. */
let noiseBuffer = null;
function getNoiseBuffer(ac) {
  if (noiseBuffer) return noiseBuffer;
  const length = ac.sampleRate * 2;
  noiseBuffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/**
 * Wind: noise through a lowpass, with a second slow LFO on the gain so it
 * breathes instead of hissing. Started once and left running — it is silent
 * whenever the master gain is 0.
 */
function startWind(ac) {
  if (wind) return;

  const source = ac.createBufferSource();
  source.buffer = getNoiseBuffer(ac);
  source.loop = true;

  const band = ac.createBiquadFilter();
  band.type = 'lowpass';
  band.frequency.value = 480;
  band.Q.value = 0.6;

  const body = ac.createBiquadFilter();
  body.type = 'highpass';
  body.frequency.value = 120;

  const gain = ac.createGain();
  gain.gain.value = 0.05;

  // Gusts: a very slow sine on top of the steady bed.
  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 0.028;
  lfo.connect(lfoGain).connect(gain.gain);

  source.connect(body).connect(band).connect(gain).connect(master);
  source.start();
  lfo.start();
  wind = { source, lfo };
}

/**
 * One short percussive hit. `frequency` sets the resonance the noise is rung
 * through, which is what separates a dry tap from a heavy thud.
 */
function hit({ frequency, decay, gain: peak, type = 'bandpass', Q = 6 }) {
  const ac = context();
  if (!ac || !enabled) return;

  const source = ac.createBufferSource();
  source.buffer = getNoiseBuffer(ac);
  const offset = Math.random() * 1.5;

  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = Q;

  const env = ac.createGain();
  const now = ac.currentTime;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, now + decay);

  source.connect(filter).connect(env).connect(master);
  source.start(now, offset, decay + 0.05);
  source.stop(now + decay + 0.05);
}

export const sfx = {
  /** Picking a piece up: dry, high, very short. */
  select: () => hit({ frequency: 1750, decay: 0.07, gain: 0.16, Q: 3 }),
  /** Setting a piece down on a square: dull knock. */
  move: () => hit({ frequency: 320, decay: 0.19, gain: 0.34, Q: 4 }),
  /** Taking a piece: lower and harder than a move, with a click on top. */
  capture: () => {
    hit({ frequency: 140, decay: 0.34, gain: 0.5, Q: 3 });
    hit({ frequency: 900, decay: 0.09, gain: 0.2, Q: 2 });
  },
};

/**
 * Sound for a played move. Takes the Move chess.js returned, so it covers both
 * sides — the AI's moves are voiced from the history, not from the click.
 */
export function playMoveSound(move) {
  if (!move) return;
  if (move.captured) sfx.capture();
  else sfx.move();
}

export function isAudioEnabled() {
  return enabled;
}

/**
 * @returns the state actually reached — false if Web Audio is unavailable.
 */
export function setAudioEnabled(next) {
  const ac = context();
  if (!ac) return false;

  enabled = next;
  // Browsers start the context suspended until a user gesture. The toggle is a
  // click, so this is the right moment to resume it.
  if (enabled && ac.state === 'suspended') ac.resume();
  if (enabled) startWind(ac);

  const now = ac.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(enabled ? 1 : 0, now + 0.35);

  return enabled;
}
