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

// Check Piper availability once; subsequent speak() calls use the cached
// answer instantly.
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

let currentAudio: HTMLAudioElement | null = null;
let currentAbort: AbortController | null = null;
let currentObjectUrl: string | null = null;

function speakViaBrowser(text: string, onEnd?: () => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = navigator.language || 'en-US';
  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }
  window.speechSynthesis.speak(utterance);
}

async function speakViaPiper(text: string, onEnd?: () => void): Promise<void> {
  stopSpeaking(); // cancel anything currently speaking
  const abort = new AbortController();
  currentAbort = abort;
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: abort.signal,
    });
    if (abort.signal.aborted) return;
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
      onEnd?.();
    };
    audio.onended = done;
    audio.onerror = done;
    await audio.play().catch(done);
  } catch {
    if (currentAbort === abort) currentAbort = null;
    // If the user explicitly stopped, stay silent. Otherwise fall back so the
    // reply is still spoken — better robotic than mute.
    if (!abort.signal.aborted) speakViaBrowser(text, onEnd);
    else onEnd?.();
  }
}

export function speak(text: string, onEnd?: () => void): void {
  const cleaned = plainText(text);
  void (async () => {
    if (await piperAvailable()) await speakViaPiper(cleaned, onEnd);
    else speakViaBrowser(cleaned, onEnd);
  })();
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
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
}
