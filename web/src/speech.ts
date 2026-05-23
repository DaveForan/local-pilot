// Reading Claude's replies aloud. Prefers server-side Piper (neural, natural)
// when it's installed; falls back to the browser's built-in speechSynthesis.

import { api } from './api';

export function speechOutputSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'speechSynthesis' in window || typeof Audio !== 'undefined';
}

/** Strip markdown so a reply reads naturally aloud. */
function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\s-]+/gm, '')
    .replace(/[*_]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- speaking-state subscription -------------------------------------------
// UI components subscribe to know when to show a "Reading…" indicator + a
// Stop button, without polling.

type SpeakingListener = (speaking: boolean) => void;
const listeners = new Set<SpeakingListener>();
let speakingState = false;

export function subscribeSpeaking(fn: SpeakingListener): () => void {
  listeners.add(fn);
  fn(speakingState);
  return () => {
    listeners.delete(fn);
  };
}

function setSpeakingState(s: boolean): void {
  if (speakingState === s) return;
  speakingState = s;
  for (const l of listeners) l(s);
}

// --- Piper availability (cached after first check) -------------------------

let piperPromise: Promise<boolean> | null = null;
function piperAvailable(): Promise<boolean> {
  if (piperPromise === null) {
    piperPromise = api
      .ttsStatus()
      .then((s) => s.available)
      .catch(() => false);
  }
  return piperPromise;
}

// --- TTS state shared by Piper + browser fallback --------------------------

const TTS_FETCH_TIMEOUT_MS = 15000;

let currentAudio: HTMLAudioElement | null = null;
let currentAbort: AbortController | null = null;
let currentObjectUrl: string | null = null;
let currentTimeout: number | null = null;

/** Tear down whatever is currently speaking, silently — does NOT fire any
 *  pending onEnd callback. Callers that need the conversation loop to
 *  continue (e.g. the Stop button) trigger that themselves. */
export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (currentTimeout !== null) {
    window.clearTimeout(currentTimeout);
    currentTimeout = null;
  }
  if (currentAbort) {
    try {
      currentAbort.abort();
    } catch {
      /* ignore */
    }
    currentAbort = null;
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
  if (currentObjectUrl) {
    try {
      URL.revokeObjectURL(currentObjectUrl);
    } catch {
      /* ignore */
    }
    currentObjectUrl = null;
  }
  setSpeakingState(false);
}

function speakViaBrowser(text: string, onEnd?: () => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    setSpeakingState(false);
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = navigator.language || 'en-US';
  setSpeakingState(true);
  const finish = (): void => {
    setSpeakingState(false);
    onEnd?.();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);
}

async function speakViaPiper(text: string, onEnd?: () => void): Promise<void> {
  setSpeakingState(true);
  const abort = new AbortController();
  currentAbort = abort;
  // Hard ceiling so a stalled fetch can never freeze the conversation loop.
  currentTimeout = window.setTimeout(() => abort.abort(), TTS_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: abort.signal,
    });
    if (currentTimeout !== null) {
      window.clearTimeout(currentTimeout);
      currentTimeout = null;
    }
    if (abort.signal.aborted) return; // stopped on purpose — stay silent
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const blob = await res.blob();
    if (abort.signal.aborted) return;

    const url = URL.createObjectURL(blob);
    currentObjectUrl = url;
    const audio = new Audio(url);
    currentAudio = audio;

    const done = (): void => {
      if (currentObjectUrl === url) {
        URL.revokeObjectURL(url);
        currentObjectUrl = null;
      }
      if (currentAudio === audio) currentAudio = null;
      if (currentAbort === abort) currentAbort = null;
      setSpeakingState(false);
      onEnd?.();
    };
    audio.onended = done;
    audio.onerror = done;

    try {
      await audio.play();
    } catch {
      // Playback rejected (autoplay restriction, decoding error, …). Don't
      // leave the reply silent — clean this up and fall back to browser TTS.
      if (currentObjectUrl === url) {
        URL.revokeObjectURL(url);
        currentObjectUrl = null;
      }
      if (currentAudio === audio) currentAudio = null;
      if (currentAbort === abort) currentAbort = null;
      speakViaBrowser(text, onEnd);
    }
  } catch {
    if (currentAbort === abort) currentAbort = null;
    if (currentTimeout !== null) {
      window.clearTimeout(currentTimeout);
      currentTimeout = null;
    }
    if (abort.signal.aborted) {
      // Intentional stop (user, timeout, or replacement) — stay silent.
      setSpeakingState(false);
      return;
    }
    // Network / server error: fall back so the reply isn't silent.
    speakViaBrowser(text, onEnd);
  }
}

/** Read text aloud. `onEnd` fires once the audio finishes naturally; it does
 *  NOT fire if the speech was stopped via `stopSpeaking()`. */
export function speak(text: string, onEnd?: () => void): void {
  // Silence whatever is playing right away so two speak() calls in a row
  // can't double up. The replaced call's onEnd is intentionally dropped —
  // the new call's onEnd carries the loop forward.
  stopSpeaking();
  const cleaned = plainText(text);
  void (async () => {
    if (await piperAvailable()) await speakViaPiper(cleaned, onEnd);
    else speakViaBrowser(cleaned, onEnd);
  })();
}
