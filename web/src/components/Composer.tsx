import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { SessionMeta } from '../protocol';
import { store } from '../store';
import { api } from '../api';
import { prepareImage, type PreparedImage } from '../image';
import { recordUtterance, recordingSupported } from '../audio';
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

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { session, voiceMode, onToggleVoiceMode },
  ref,
) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [pendingSend, setPendingSend] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const recordCancel = useRef<(() => void) | null>(null);
  const graceTimer = useRef<number | null>(null);
  const submitRef = useRef<() => void>(() => {});
  // Indirection so the recorder's callbacks always run the latest logic.
  const ctlRef = useRef<{
    onClip: (audio: Blob) => void;
    onNoSpeech: () => void;
    onError: (message: string) => void;
  }>({ onClip: () => {}, onNoSpeech: () => {}, onError: () => {} });

  const busy = session.status === 'running' || session.status === 'awaiting_permission';
  const ended = session.status === 'ended';
  const canSend = !busy && !ended && (text.trim() !== '' || images.length > 0);

  const stopVoice = (): void => {
    recordCancel.current?.();
    recordCancel.current = null;
    if (graceTimer.current !== null) {
      window.clearTimeout(graceTimer.current);
      graceTimer.current = null;
    }
    setListening(false);
    setTranscribing(false);
    setPendingSend(false);
  };

  const submit = (): void => {
    if (!canSend) return;
    stopVoice();
    store.sendInput(
      session.id,
      text.trim(),
      images.length > 0
        ? images.map((im) => ({ mediaType: im.mediaType, data: im.data }))
        : undefined,
    );
    setText('');
    setImages([]);
  };
  submitRef.current = submit;

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
    api
      .transcribe(audio)
      .then((raw) => {
        setTranscribing(false);
        const spoken = raw.trim();
        if (!spoken) {
          beginUtterance(); // nothing recognised — keep listening
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
        setTranscribing(false);
        if (/not installed/i.test((e as Error).message ?? '')) {
          window.alert('Voice transcription is not installed on the server.');
          return;
        }
        beginUtterance(); // transient failure — keep listening
      });
  };
  ctlRef.current.onNoSpeech = () => {
    recordCancel.current = null;
    setListening(false);
    beginUtterance(); // nothing said — keep the mic ready
  };
  ctlRef.current.onError = () => {
    recordCancel.current = null;
    setListening(false);
  };

  // Conversation mode reopens the mic once Claude has finished speaking.
  useImperativeHandle(ref, () => ({
    beginVoiceReply: () => {
      if (!busy && !ended) beginUtterance();
    },
  }));

  // Entering conversation mode starts listening; leaving it stops everything.
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

  // Tidy up the recorder and timers if the component goes away.
  useEffect(() => {
    return () => {
      recordCancel.current?.();
      if (graceTimer.current !== null) window.clearTimeout(graceTimer.current);
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
        <div className="composer-listening">
          <span className="spinner" />
          <span>Transcribing…</span>
        </div>
      ) : (
        listening && (
          <div className="composer-listening">
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
