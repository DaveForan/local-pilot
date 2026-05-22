import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
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

/** Append `b` to `a` with a single separating space. */
function joinText(a: string, b: string): string {
  return a.trim() ? `${a.replace(/\s+$/, '')} ${b}` : b;
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
  const fileRef = useRef<HTMLInputElement>(null);
  const stopDictationRef = useRef<(() => void) | null>(null);

  const busy = session.status === 'running' || session.status === 'awaiting_permission';
  const ended = session.status === 'ended';
  const canSend = !busy && !ended && (text.trim() !== '' || images.length > 0);

  const stopDictation = (): void => {
    stopDictationRef.current?.();
    stopDictationRef.current = null;
    setListening(false);
    setInterim('');
  };

  /** Start dictation. `quiet` suppresses error alerts (used by the auto loop). */
  const startDict = (quiet: boolean): void => {
    setListening(true);
    stopDictationRef.current = startDictation({
      onText: (t, isFinal) => {
        if (isFinal) {
          setText((cur) => joinText(cur, t));
          setInterim('');
        } else {
          setInterim(t);
        }
      },
      onEnd: () => {
        stopDictationRef.current = null;
        setListening(false);
        setInterim('');
      },
      onError: (msg) => {
        setListening(false);
        if (!quiet) window.alert(msg);
      },
    });
  };

  // Conversation mode reopens the mic once Claude has finished speaking.
  useImperativeHandle(ref, () => ({
    beginVoiceReply: () => {
      if (!listening && !busy && !ended && dictationSupported()) startDict(true);
    },
  }));

  const submit = (): void => {
    if (!canSend) return;
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

  const toggleDictation = (): void => {
    if (listening) {
      if (interim) setText((t) => joinText(t, interim));
      stopDictation();
    } else {
      startDict(false);
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

      {voiceMode && (
        <button className="composer-voicemode" onClick={onToggleVoiceMode}>
          <span className="vm-dot" />
          <span>Conversation mode on — replies read aloud. Tap to turn off.</span>
        </button>
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

      {listening && (
        <div className="composer-listening">
          <span className="mic-dot" />
          <span>{interim || 'Listening…'}</span>
        </div>
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

        {dictationSupported() && (
          <button
            className={`composer-icon ${listening ? 'on' : ''}`}
            onClick={toggleDictation}
            disabled={ended}
            aria-label={listening ? 'Stop voice input' : 'Voice input'}
          >
            🎙
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
          voiceMode={voiceMode}
          onToggleVoiceMode={onToggleVoiceMode}
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
