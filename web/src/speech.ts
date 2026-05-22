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
  /** The complete transcript so far — replaces, never appends. */
  onTranscript: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

/** Start dictation; returns a function that stops it. Recognition is kept
 *  alive across the browser's silence/timeout cutoffs by auto-restarting, so
 *  long dictation does not quietly drop. The transcript is rebuilt from the
 *  full results list on every event — idempotent, so a browser re-firing
 *  results can never duplicate a phrase. */
export function startDictation(handlers: DictationHandlers): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    handlers.onError('Voice input is not supported in this browser.');
    handlers.onEnd();
    return () => {};
  }
  let stopped = false;
  let committed = ''; // finalised text banked from earlier (restarted) segments
  let segmentFinal = ''; // finalised text of the current recognition segment
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-US';

  const join = (...parts: string[]): string =>
    parts
      .map((p) => p.trim())
      .filter(Boolean)
      .join(' ');

  rec.onresult = (e: any) => {
    let finalText = '';
    let interimText = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      const t = r[0]?.transcript ?? '';
      if (r.isFinal) finalText += t;
      else interimText += t;
    }
    segmentFinal = finalText;
    handlers.onTranscript(join(committed, finalText, interimText));
  };

  rec.onerror = (e: any) => {
    const err = String(e?.error ?? '');
    // no-speech / aborted are routine — onend will restart recognition.
    if (err === 'no-speech' || err === 'aborted') return;
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      stopped = true;
      handlers.onError('Microphone access was blocked — check the site permission.');
      return;
    }
    handlers.onError(`Voice input error: ${err || 'unknown'}`);
  };

  rec.onend = () => {
    if (stopped) {
      handlers.onEnd();
      return;
    }
    // Browser ended the segment (pause/timeout). Bank its finalised text and
    // restart, so the user keeps talking without old audio being re-read.
    committed = join(committed, segmentFinal);
    segmentFinal = '';
    window.setTimeout(() => {
      if (stopped) return;
      try {
        rec.start();
      } catch {
        /* already running */
      }
    }, 150);
  };

  try {
    rec.start();
  } catch {
    /* already running */
  }
  return () => {
    stopped = true;
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
