// Browser audio capture for server-side (Whisper) transcription. Records one
// spoken utterance, using a volume-based voice-activity detector to decide
// when the speaker has stopped — so the conversation loop stays hands-free.

export interface UtteranceHandlers {
  /** A spoken clip was captured. */
  onSpeechEnd: (audio: Blob) => void;
  /** The listening window elapsed with nothing said. */
  onNoSpeech: () => void;
  onError: (message: string) => void;
}

export function recordingSupported(): boolean {
  return Boolean(
    typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window !== 'undefined' &&
      'MediaRecorder' in window &&
      'AudioContext' in window,
  );
}

const START_RMS = 0.025; // loudness above this counts as speech
const SILENCE_MS = 1400; // sustained quiet after speech ends the utterance
const NO_SPEECH_MS = 9000; // give up listening if the speaker never starts
const MAX_MS = 30000; // hard cap on a single utterance

/** Record one utterance, ending it on silence. Returns a cancel function. */
export function recordUtterance(handlers: UtteranceHandlers): () => void {
  let cancelled = false;
  let teardown = (): void => {};

  void (async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      handlers.onError('Microphone access was blocked — check the site permission.');
      return;
    }
    if (cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const recorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const ctx = new AudioContext();
    void ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    let poll = 0;
    let finished = false;
    let heardSpeech = false;
    let lastLoud = Date.now();
    const startedAt = Date.now();

    const release = (): void => {
      if (poll) {
        window.clearInterval(poll);
        poll = 0;
      }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    };
    teardown = release;

    const finish = (spoke: boolean): void => {
      if (finished) return;
      finished = true;
      if (poll) {
        window.clearInterval(poll);
        poll = 0;
      }
      recorder.onstop = () => {
        release();
        if (cancelled) return;
        if (spoke) {
          handlers.onSpeechEnd(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        } else {
          handlers.onNoSpeech();
        }
      };
      try {
        if (recorder.state !== 'inactive') recorder.stop();
        else recorder.onstop?.(new Event('stop'));
      } catch {
        release();
      }
    };

    recorder.start();
    poll = window.setInterval(() => {
      if (cancelled) {
        finished = true;
        release();
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch {
          /* ignore */
        }
        return;
      }
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const v = (samples[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();
      if (rms > START_RMS) {
        heardSpeech = true;
        lastLoud = now;
      }
      if (now - startedAt > MAX_MS) finish(heardSpeech);
      else if (!heardSpeech) {
        if (now - startedAt > NO_SPEECH_MS) finish(false);
      } else if (now - lastLoud > SILENCE_MS) {
        finish(true);
      }
    }, 80);
  })();

  return () => {
    cancelled = true;
    teardown();
  };
}
