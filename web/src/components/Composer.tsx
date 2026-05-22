import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { SessionMeta } from '../protocol';
import { store } from '../store';
import { prepareImage, type PreparedImage } from '../image';
import { startDictation, dictationSupported } from '../speech';
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

// Conversation-mode auto-send timing.
const SILENCE_MS = 1800; // a gap this long means "you've stopped talking"
const GRACE_MS = 2200; // cancelable window before the reply is actually sent

/** Append `b` to `a` with a single separating space. */
function joinText(a: string, b: string): string {
  return a.trim() ? `${a.replace(/\s+$/, '')} ${b}` : b;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
      />
    </svg>
  );
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { session, voiceMode, onToggleVoiceMode },
  ref,
) {
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [pendingSend, setPendingSend] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const stopDictationRef = useRef<(() => void) | null>(null);
  const silenceTimer = useRef<number | null>(null);
  const graceTimer = useRef<number | null>(null);
  // Indirections so dictation callbacks and timers always see fresh state.
  const handlersRef = useRef<{ onText: (chunk: string, isFinal: boolean) => void }>({
    onText: () => {},
  });
  const submitRef = useRef<() => void>(() => {});
  const draftRef = useRef<{ text: string; hasImages: boolean }>({ text: '', hasImages: false });
  draftRef.current = { text, hasImages: images.length > 0 };

  const busy = session.status === 'running' || session.status === 'awaiting_permission';
  const ended = session.status === 'ended';
  const canSend = !busy && !ended && (text.trim() !== '' || images.length > 0);

  const clearAutoSend = (): void => {
    if (silenceTimer.current !== null) {
      window.clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
    if (graceTimer.current !== null) {
      window.clearTimeout(graceTimer.current);
      graceTimer.current = null;
    }
    setPendingSend(false);
  };

  const stopDictation = (): void => {
    stopDictationRef.current?.();
    stopDictationRef.current = null;
    setListening(false);
    setInterim('');
    clearAutoSend();
  };

  const submit = (): void => {
    if (!canSend) return;
    clearAutoSend();
    stopDictation();
    store.sendInput(
      session.id,
      text.trim(),
      images.length > 0
        ? images.map((im) => ({ mediaType: im.mediaType, data: im.data }))
        : undefined,
    );
    setText('');
    setInterim('');
    setImages([]);
  };
  submitRef.current = submit;

  // Conversation mode: after a pause, hand the spoken reply off on its own.
  const armAutoSend = (): void => {
    clearAutoSend();
    if (!voiceMode) return;
    silenceTimer.current = window.setTimeout(() => {
      silenceTimer.current = null;
      if (draftRef.current.text.trim() === '' && !draftRef.current.hasImages) return;
      setPendingSend(true);
      graceTimer.current = window.setTimeout(() => {
        graceTimer.current = null;
        setPendingSend(false);
        submitRef.current();
      }, GRACE_MS);
    }, SILENCE_MS);
  };

  // Re-point the dictation callback at fresh logic every render.
  handlersRef.current.onText = (chunk, isFinal) => {
    if (isFinal) setText((cur) => joinText(cur, chunk));
    else setInterim(chunk);
    armAutoSend(); // user is speaking — (re)start the silence countdown
  };

  const startDict = (quiet: boolean): void => {
    if (stopDictationRef.current) return; // already listening
    setListening(true);
    stopDictationRef.current = startDictation({
      onText: (chunk, isFinal) => handlersRef.current.onText(chunk, isFinal),
      onEnd: () => {
        stopDictationRef.current = null;
        setListening(false);
        setInterim('');
        clearAutoSend();
      },
      onError: (msg) => {
        if (!quiet) window.alert(msg);
      },
    });
  };

  // Conversation mode reopens the mic once Claude has finished speaking.
  useImperativeHandle(ref, () => ({
    beginVoiceReply: () => {
      if (!busy && !ended && dictationSupported()) startDict(true);
    },
  }));

  // Conversation mode is hands-free: entering it opens the mic right away
  // (so there's no need for a mic button); leaving it stops listening.
  useEffect(() => {
    if (voiceMode) {
      if (!busy && !ended) startDict(true);
    } else {
      stopDictation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode]);

  // Tidy up timers and the mic if the component goes away.
  useEffect(() => {
    return () => {
      stopDictationRef.current?.();
      if (silenceTimer.current !== null) window.clearTimeout(silenceTimer.current);
      if (graceTimer.current !== null) window.clearTimeout(graceTimer.current);
    };
  }, []);

  const toggleDictation = (): void => {
    if (listening) {
      if (interim) setText((t) => joinText(t, interim));
      stopDictation();
    } else {
      startDict(false);
    }
  };

  const insertSnippet = (body: string): void => {
    setText((cur) => (cur.trim() ? `${cur.replace(/\s+$/, '')}\n${body}` : body));
  };

  const saveDraft = (): void => {
    const draft = text.trim();
    if (!draft) return;
    const title = window.prompt('Name this saved prompt:', draft.slice(0, 48));
    if (title && title.trim()) void store.createSnippet(title.trim(), draft);
  };

  const onFiles = async (files: FileList | null): Promise<void> => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const prepared = await prepareImage(file);
        setImages((cur) => [...cur, prepared]);
      } catch {
        window.alert(`Could not load image “${file.name}”.`);
      }
    }
  };

  return (
    <div className="composer">
      {busy && (
        <div className="composer-busy">
          <span className="spinner" />
          <span>
            {session.status === 'awaiting_permission'
              ? 'Waiting for your permission decision above'
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
        <div className="composer-pending">
          <span className="mic-dot" />
          <span>Sending your reply…</span>
          <button className="pending-cancel" onClick={clearAutoSend}>
            Keep talking
          </button>
        </div>
      ) : (
        listening && (
          <div className="composer-listening">
            <span className="mic-dot" />
            <span>{interim || 'Listening… speak now'}</span>
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
          className="composer-input"
          placeholder={
            ended
              ? 'Session ended'
              : 'Message Claude Code…  (Enter to send, Shift+Enter for newline)'
          }
          value={text}
          disabled={ended}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />

        {dictationSupported() && !voiceMode && (
          <button
            type="button"
            className={`composer-mic ${listening ? 'on' : ''}`}
            onClick={toggleDictation}
            disabled={ended}
            aria-label={listening ? 'Stop voice input' : 'Start voice input'}
          >
            <MicIcon />
          </button>
        )}

        <button className="btn btn-accent send-btn" onClick={submit} disabled={!canSend}>
          Send
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void onFiles(e.target.files);
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
