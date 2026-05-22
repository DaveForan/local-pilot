// Browser voice features: speech-to-text for the composer (dictation) and
// text-to-speech for reading Claude's replies aloud. Both are pure browser
// APIs — no server involvement. Dictation needs a secure context (HTTPS or
// localhost); reading aloud works anywhere.

// --- dictation (speech to text) --------------------------------------------

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function dictationSupported(): boolean {
  return recognitionCtor() != null;
}

export interface DictationHandlers {
  /** Fires with finalised text (and interim text as it is recognised). */
  onText: (text: string, isFinal: boolean) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

/** Start dictation; returns a function that stops it. */
export function startDictation(handlers: DictationHandlers): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    handlers.onError('Voice input is not supported in this browser.');
    handlers.onEnd();
    return () => {};
  }
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-US';
  rec.onresult = (e: any) => {
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (final) handlers.onText(final, true);
    else if (interim) handlers.onText(interim, false);
  };
  rec.onerror = (e: any) =>
    handlers.onError(e?.error ? `Voice input error: ${e.error}` : 'Voice input error');
  rec.onend = () => handlers.onEnd();
  try {
    rec.start();
  } catch {
    /* already running */
  }
  return () => {
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  };
}

// --- reading aloud (text to speech) ----------------------------------------

export function speechOutputSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
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

/** Speak the given text, cancelling anything already in progress. */
export function speak(text: string, onEnd?: () => void): void {
  if (!speechOutputSupported()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(plainText(text));
  utterance.lang = navigator.language || 'en-US';
  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}
