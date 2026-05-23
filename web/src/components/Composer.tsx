import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from 'react';
import type { SessionMeta, ChatImage } from '../protocol';
import { store } from '../store';
import { api } from '../api';
import { prepareImage, type PreparedImage } from '../image';
import { recordUtterance, recordingSupported } from '../audio';
import { stopSpeaking, subscribeSpeaking } from '../speech';
import { AddSheet } from './AddSheet';
import { SnippetManager } from './SnippetManager';

/** Imperative handle so conversation mode can reopen the mic after a reply. */
export interface ComposerHandle {
  beginVoiceReply: () => void;
}

interface Props {
  session: SessionMeta;
  voiceMode: boolean;
  onToggleVoiceMode: () => void;
}

/** Cancelable window after a transcript lands, before it is auto-sent. */
const GRACE_MS = 2200;
/** Hard ceiling on a transcribe request. */
const TRANSCRIBE_TIMEOUT_MS = 30000;
/** Consecutive transcribe failures before we stop auto-retrying. */
const TRANSCRIBE_MAX_FAILS = 3;
/** Idle time in conversation mode before the watchdog re-opens the mic. */
const WATCHDOG_MS = 3000;
/** Composer textarea auto-grows up to this pixel cap. */
const TEXTAREA_MAX_PX = 240;

interface QueuedMessage {
  text: string;
  images: PreparedImage[];
}

function toChatImages(images: PreparedImage[]): ChatImage[] | undefined {
  return images.length > 0 ? images.map((im) => ({ mediaType: im.mediaType, data: im.data })) : undefined;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { session, voiceMode, onToggleVoiceMode },
  ref,
) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [pendingSend, setPendingSend] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recordCancel = useRef<(() => void) | null>(null);
  const transcribeAbort = useRef<AbortController | null>(null);
  const transcribeFails = useRef(0);
  const graceTimer = useRef<number | null>(null);
  const submitRef = useRef<() => void>(() => {});
  const drainGuard = useRef(false);
  const ctlRef = useRef<{
    onClip: (audio: Blob) => void;
    onNoSpeech: () => void;
    onError: (message: string) => void;
  }>({ onClip: () => {}, onNoSpeech: () => {}, onError: () => {} });

  const busy = session.status === 'running' || session.status === 'awaiting_permission';
  const ended = session.status === 'ended';
  const hasDraft = text.trim() !== '' || images.length > 0;
  const canSend = !ended && hasDraft;

  const stopVoice = (): void => {
    recordCancel.current?.();
    recordCancel.current = null;
    if (transcribeAbort.current) {
      try {
        transcribeAbort.current.abort();
      } catch {
        /* ignore */
      }
      transcribeAbort.current = null;
    }
    if (graceTimer.current !== null) {
      window.clearTimeout(graceTimer.current);
      graceTimer.current = null;
    }
    setListening(false);
    setTranscribing(false);
    setPendingSend(false);
  };

  const sendNow = (payload: QueuedMessage): void => {
    store.sendInput(session.id, payload.text, toChatImages(payload.images));
  };

  /** Send the draft straight to Claude, or queue it if Claude is busy. */
  const submit = (): void => {
    if (!canSend) return;
    const payload: QueuedMessage = { text: text.trim(), images: [...images] };
    setText('');
    setImages([]);
    if (busy) {
      // Claude is mid-turn — line this up; the drain effect sends it next.
      setQueue((q) => [...q, payload]);
      return;
    }
    stopVoice();
    sendNow(payload);
  };
  submitRef.current = submit;

  // Drain queued messages once Claude finishes the previous turn. Guarded so
  // a state-update race can't double-send the same message.
  useEffect(() => {
    if (busy) {
      drainGuard.current = false;
      return;
    }
    if (ended || queue.length === 0 || drainGuard.current) return;
    drainGuard.current = true;
    const [next, ...rest] = queue;
    setQueue(rest);
    sendNow(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, ended, queue]);

  // Auto-grow the textarea to fit content, up to a cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_PX)}px`;
  }, [text]);

  // Record one spoken utterance, then transcribe it server-side.
  const beginUtterance = (): void => {
    if (!voiceMode || busy || ended || !recordingSupported()) return;
    if (recordCancel.current) return; // already recording
    setPendingSend(false);
    setTranscribing(false);
    setListening(true);
    recordCancel.current = recordUtterance({
      onSpeechEnd: (audio) => ctlRef.current.onClip(audio),
      onNoSpeech: () => ctlRef.current.onNoSpeech(),
      onError: (m) => ctlRef.current.onError(m),
    });
  };

  // Re-point the recorder callbacks at fresh logic every render.
  ctlRef.current.onClip = (audio) => {
    recordCancel.current = null;
    setListening(false);
    setTranscribing(true);
    const abort = new AbortController();
    transcribeAbort.current = abort;
    const timer = window.setTimeout(() => abort.abort(), TRANSCRIBE_TIMEOUT_MS);
    api
      .transcribe(audio, abort.signal)
      .then((raw) => {
        if (transcribeAbort.current === abort) transcribeAbort.current = null;
        window.clearTimeout(timer);
        setTranscribing(false);
        transcribeFails.current = 0;
        const spoken = raw.trim();
        if (!spoken) {
          beginUtterance();
          return;
        }
        setText((cur) => (cur.trim() ? `${cur.trim()} ${spoken}` : spoken));
        setPendingSend(true);
        graceTimer.current = window.setTimeout(() => {
          graceTimer.current = null;
          setPendingSend(false);
          submitRef.current();
        }, GRACE_MS);
      })
      .catch((e) => {
        if (transcribeAbort.current === abort) transcribeAbort.current = null;
        window.clearTimeout(timer);
        setTranscribing(false);
        if (abort.signal.aborted) return;
        const msg = (e as Error).message ?? '';
        if (/not installed/i.test(msg)) {
          window.alert('Voice transcription is not installed on the server.');
          return;
        }
        transcribeFails.current += 1;
        if (transcribeFails.current >= TRANSCRIBE_MAX_FAILS) {
          window.alert(
            `Voice transcription failed ${TRANSCRIBE_MAX_FAILS} times in a row — ` +
              'check the server and toggle Conversation mode to retry.',
          );
          transcribeFails.current = 0;
          return;
        }
        beginUtterance();
      });
  };
  ctlRef.current.onNoSpeech = () => {
    recordCancel.current = null;
    setListening(false);
    beginUtterance();
  };
  ctlRef.current.onError = () => {
    recordCancel.current = null;
    setListening(false);
  };

  useImperativeHandle(ref, () => ({
    beginVoiceReply: () => {
      if (!busy && !ended) beginUtterance();
    },
  }));

  useEffect(() => {
    if (session.status === 'awaiting_permission') {
      stopVoice();
      stopSpeaking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status]);

  useEffect(() => {
    if (!voiceMode) {
      stopVoice();
      return;
    }
    if (busy || ended) return;
    api
      .transcribeStatus()
      .then((s) => {
        if (s.available) beginUtterance();
        else
          window.alert(
            'Voice transcription is not installed on the server — run `npm run whisper:install`.',
          );
      })
      .catch(() => beginUtterance());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode]);

  useEffect(() => subscribeSpeaking(setSpeaking), []);

  useEffect(() => {
    if (!voiceMode || ended || !recordingSupported()) return;
    const idle =
      !busy && !listening && !transcribing && !pendingSend && !speaking && !recordCancel.current;
    if (!idle) return;
    const t = window.setTimeout(() => beginUtterance(), WATCHDOG_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode, busy, ended, listening, transcribing, pendingSend, speaking]);

  useEffect(() => {
    return () => {
      recordCancel.current?.();
      if (graceTimer.current !== null) window.clearTimeout(graceTimer.current);
      if (transcribeAbort.current) {
        try {
          transcribeAbort.current.abort();
        } catch {
          /* ignore */
        }
      }
      stopSpeaking();
    };
  }, []);

  const insertSnippet = (body: string): void => {
    setText((cur) => (cur.trim() ? `${cur.replace(/\s+$/, '')}\n${body}` : body));
  };

  const saveDraft = (): void => {
    const draft = text.trim();
    if (!draft) return;
    const title = window.prompt('Name this saved prompt:', draft.slice(0, 48));
    if (title && title.trim()) void store.createSnippet(title.trim(), draft);
  };

  const ingestFiles = async (files: Iterable<File> | null | undefined): Promise<void> => {
    if (!files) return;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const prepared = await prepareImage(file);
        setImages((cur) => [...cur, prepared]);
      } catch {
        window.alert(`Could not load image “${file.name}”.`);
      }
    }
  };

  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>): void => {
    if (ended) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f && f.type.startsWith('image/')) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void ingestFiles(files);
    }
  };

  const onDragOver = (e: ReactDragEvent<HTMLDivElement>): void => {
    if (ended) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      setDropActive(true);
    }
  };
  const onDragLeave = (e: ReactDragEvent<HTMLDivElement>): void => {
    // Leaving the composer entirely (not just a child) clears the highlight.
    if (e.currentTarget === e.target) setDropActive(false);
  };
  const onDrop = (e: ReactDragEvent<HTMLDivElement>): void => {
    setDropActive(false);
    if (ended) return;
    const fileList = e.dataTransfer?.files;
    if (!fileList?.length) return;
    e.preventDefault();
    const images = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (images.length) void ingestFiles(images);
  };

  return (
    <div
      className={`composer ${dropActive ? 'drop-active' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {busy && (
        <div
          className={`composer-busy ${session.status === 'awaiting_permission' ? 'needs-decision' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="spinner" />
          <span>
            {session.status === 'awaiting_permission'
              ? '⚠ Tap Allow or Deny on the request above'
              : 'Claude is working'}
          </span>
          <button className="btn btn-danger btn-sm" onClick={() => store.interrupt(session.id)}>
            Stop
          </button>
        </div>
      )}

      <button
        type="button"
        className={`convo-toggle ${voiceMode ? 'on' : ''}`}
        onClick={onToggleVoiceMode}
        disabled={ended}
      >
        <span className="convo-main">
          <span className="convo-title">Conversation mode</span>
          <span className="convo-sub">
            {voiceMode
              ? 'Replies read aloud — just speak to answer'
              : 'Hands-free: speak, listen, repeat'}
          </span>
        </span>
        <span className={`toggle ${voiceMode ? 'on' : ''}`}>
          <span className="toggle-knob" />
        </span>
      </button>

      {queue.length > 0 && (
        <div className="composer-queue" role="status" aria-live="polite">
          <span className="mic-dot" />
          <span>
            {queue.length} message{queue.length === 1 ? '' : 's'} queued — will send when Claude is free
          </span>
          <button className="pending-cancel" onClick={() => setQueue([])}>
            Cancel
          </button>
        </div>
      )}

      {images.length > 0 && (
        <div className="composer-attachments">
          {images.map((im, i) => (
            <div key={i} className="attachment">
              <img src={im.previewUrl} alt="attachment" />
              <button
                className="attachment-x"
                aria-label="Remove image"
                onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingSend ? (
        <div className="composer-pending" role="status" aria-live="polite">
          <span className="mic-dot" />
          <span>Sending your reply…</span>
          <button
            className="pending-cancel"
            onClick={() => {
              if (graceTimer.current !== null) {
                window.clearTimeout(graceTimer.current);
                graceTimer.current = null;
              }
              setPendingSend(false);
              beginUtterance();
            }}
          >
            Keep talking
          </button>
        </div>
      ) : transcribing ? (
        <div className="composer-listening" role="status" aria-live="polite">
          <span className="spinner" />
          <span>Transcribing…</span>
        </div>
      ) : speaking ? (
        <div className="composer-reading" role="status" aria-live="polite">
          <span className="reading-dot" />
          <span>Reading reply…</span>
          <button
            className="pending-cancel"
            onClick={() => {
              stopSpeaking();
              if (voiceMode) beginUtterance();
            }}
          >
            Stop
          </button>
        </div>
      ) : (
        listening && (
          <div className="composer-listening" role="status" aria-live="polite">
            <span className="mic-dot" />
            <span>Listening… speak now</span>
          </div>
        )
      )}

      <div className="composer-row">
        <button
          className="composer-icon"
          onClick={() => setAddOpen(true)}
          disabled={ended}
          aria-label="Add to chat"
        >
          ＋
        </button>

        <textarea
          ref={textareaRef}
          className="composer-input"
          placeholder={
            ended
              ? 'Session ended'
              : busy
                ? 'Type to queue — sends when Claude is free'
                : 'Message Claude Code…  (Enter to send, Shift+Enter for newline)'
          }
          value={text}
          disabled={ended}
          rows={1}
          onPaste={onPaste}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <button
          className="btn btn-accent send-btn"
          onClick={submit}
          disabled={!canSend}
          aria-label={busy ? 'Queue message' : 'Send message'}
        >
          {busy ? 'Queue' : 'Send'}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void ingestFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {addOpen && (
        <AddSheet
          hasDraft={text.trim() !== ''}
          onPickImage={() => fileRef.current?.click()}
          onInsertSnippet={insertSnippet}
          onSaveDraft={saveDraft}
          onManage={() => setManagerOpen(true)}
          onClose={() => setAddOpen(false)}
        />
      )}
      {managerOpen && <SnippetManager onClose={() => setManagerOpen(false)} />}
    </div>
  );
});
