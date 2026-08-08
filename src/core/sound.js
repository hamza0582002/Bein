/**
 * Synthesised UI sounds — no audio assets to ship.
 * A page turn is short filtered noise with a fast attack and a swept
 * band-pass, which is a surprisingly good imitation of paper.
 */

import { settings } from './state.js';

let ctx = null;
let noiseBuffer = null;

function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function getNoise(context) {
  if (noiseBuffer) return noiseBuffer;
  const length = Math.floor(context.sampleRate * 0.6);
  noiseBuffer = context.createBuffer(1, length, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  let previous = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    previous = (previous + 0.02 * white) / 1.02; // brown-ish noise, softer than white
    data[i] = previous * 3.2;
  }
  return noiseBuffer;
}

/** @param {'forward'|'back'} direction */
export function playPageTurn(direction = 'forward') {
  if (!settings.sound) return;
  const context = audio();
  if (!context) return;

  const now = context.currentTime;
  const source = context.createBufferSource();
  source.buffer = getNoise(context);
  source.playbackRate.value = direction === 'forward' ? 1 : 0.86;

  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.8;
  const from = direction === 'forward' ? 900 : 700;
  const to = direction === 'forward' ? 2600 : 1500;
  filter.frequency.setValueAtTime(from, now);
  filter.frequency.exponentialRampToValueAtTime(to, now + 0.16);
  filter.frequency.exponentialRampToValueAtTime(from * 0.7, now + 0.3);

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

  source.connect(filter).connect(gain).connect(context.destination);
  source.start(now, Math.random() * 0.2);
  source.stop(now + 0.4);
}

/** Soft wooden knock used when a book is pulled off the shelf. */
export function playShelfPull() {
  if (!settings.sound) return;
  const context = audio();
  if (!context) return;
  const now = context.currentTime;

  const osc = context.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(90, now + 0.14);

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.09, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

  osc.connect(gain).connect(context.destination);
  osc.start(now);
  osc.stop(now + 0.25);

  // A little paper rustle layered on top.
  const source = context.createBufferSource();
  source.buffer = getNoise(context);
  const filter = context.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 1800;
  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.05, now + 0.03);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  source.connect(filter).connect(noiseGain).connect(context.destination);
  source.start(now, Math.random() * 0.2);
  source.stop(now + 0.35);
}

/** Cover opening / closing — a low, slow whoosh. */
export function playBookOpen() {
  if (!settings.sound) return;
  const context = audio();
  if (!context) return;
  const now = context.currentTime;
  const source = context.createBufferSource();
  source.buffer = getNoise(context);
  source.playbackRate.value = 0.7;

  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(400, now);
  filter.frequency.linearRampToValueAtTime(1800, now + 0.35);

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

  source.connect(filter).connect(gain).connect(context.destination);
  source.start(now);
  source.stop(now + 0.6);
}
