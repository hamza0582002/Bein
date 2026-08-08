/**
 * Read-aloud built on the Web Speech API.
 *
 * Long texts are split into sentence-sized utterances (some engines silently
 * truncate anything long) while a running offset keeps word boundaries mapped
 * back to the original chapter text.
 */

const CHUNK_TARGET = 240;

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function listVoices() {
  if (!speechSupported()) return [];
  return window.speechSynthesis.getVoices();
}

/** Voices load asynchronously in most browsers. */
export function whenVoicesReady() {
  return new Promise((resolve) => {
    if (!speechSupported()) return resolve([]);
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) return resolve(voices);
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1200);
  });
}

/** Split text into chunks at sentence boundaries, keeping start offsets. */
function chunk(text, startOffset = 0) {
  const pieces = [];
  const parts = text.split(/(?<=[.!?؟。\n]|[،؛;]\s)\s+/);
  let buffer = '';
  let bufferStart = 0;
  let cursor = 0;

  for (const part of parts) {
    const index = text.indexOf(part, cursor);
    if (index === -1) continue;
    if (!buffer) bufferStart = index;
    buffer = buffer ? `${buffer} ${part}` : part;
    cursor = index + part.length;
    if (buffer.length >= CHUNK_TARGET) {
      pieces.push({ text: buffer, offset: startOffset + bufferStart });
      buffer = '';
    }
  }
  if (buffer.trim()) pieces.push({ text: buffer, offset: startOffset + bufferStart });
  return pieces.filter((piece) => piece.text.trim());
}

export function createSpeaker() {
  let queue = [];
  let index = 0;
  let active = null;
  let handlers = {};
  let stopped = true;
  let paused = false;

  function speakNext() {
    if (stopped || index >= queue.length) {
      if (!stopped) {
        stopped = true;
        handlers.onEnd?.();
      }
      return;
    }
    const piece = queue[index];
    const utterance = new SpeechSynthesisUtterance(piece.text);
    utterance.rate = handlers.rate || 1;
    utterance.pitch = 1;
    if (handlers.voice) utterance.voice = handlers.voice;
    else if (handlers.lang) utterance.lang = handlers.lang;

    utterance.onboundary = (event) => {
      if (event.name && event.name !== 'word') return;
      const charIndex = piece.offset + (event.charIndex || 0);
      handlers.onWord?.(charIndex, event.charLength || 0);
    };
    utterance.onend = () => {
      index += 1;
      speakNext();
    };
    utterance.onerror = () => {
      index += 1;
      speakNext();
    };

    active = utterance;
    window.speechSynthesis.speak(utterance);
  }

  return {
    /**
     * @param {string} text
     * @param {{offset?:number, rate?:number, voice?:SpeechSynthesisVoice, lang?:string,
     *          onWord?:Function, onEnd?:Function}} options
     */
    start(text, options = {}) {
      if (!speechSupported()) return false;
      this.stop();
      handlers = options;
      queue = chunk(text, options.offset || 0);
      index = 0;
      stopped = false;
      paused = false;
      speakNext();
      return true;
    },
    pause() {
      if (!speechSupported() || stopped) return;
      window.speechSynthesis.pause();
      paused = true;
    },
    resume() {
      if (!speechSupported() || stopped) return;
      window.speechSynthesis.resume();
      paused = false;
    },
    stop() {
      if (!speechSupported()) return;
      stopped = true;
      paused = false;
      queue = [];
      index = 0;
      active = null;
      window.speechSynthesis.cancel();
    },
    get speaking() {
      return !stopped;
    },
    get paused() {
      return paused;
    },
    get current() {
      return active;
    },
  };
}
