# Screenshots for the docs

`docs/index.md` references six mobile screenshots from this directory.
Until you drop them in, the gallery shows broken-image placeholders.

## What to capture

Capture from a real phone (or device-emulation mode in DevTools at iPhone
14 Pro width — 393 × 852). PNG, ideally portrait, ~400px wide is plenty
since the grid scales them down.

| Filename | What's on screen |
| --- | --- |
| `mobile-chat.png` | Normal chat: a couple of user / assistant turns, the activity block, the composer with mic and image buttons visible. |
| `mobile-drawer.png` | Drawer open — show the sessions list, current-session panel (model, context bar, permission mode dropdown), and the account / sign-out footer. |
| `mobile-elicitation.png` | An `AskUserQuestion` modal popped over the chat with 2-3 multi-choice options visible. |
| `mobile-voice.png` | Conversation mode on — the strip across the composer says "Listening…" or "Reading…" and the read-aloud waveform is visible. |
| `mobile-activity-log.png` | Activity log modal open, showing a couple of tool calls + a file-diff expanded. |
| `mobile-settings.png` | Settings modal open on either the MCP, Hooks, or Security tab — pick whichever looks best. |

## Tips for clean shots

- **Use a fresh session** with one or two clean turns so there's no
  in-progress chrome to crop out.
- **Light theme + dark theme are both fine** — pick whichever you like
  for the docs; they're consistent within the gallery.
- **Strip any PII** (paths under `/home/<your-username>/`, real project
  names you don't want public, etc.) before publishing. Use a demo
  project directory if needed.
- **iOS Safari has the cleanest chrome** for the "add to home screen"
  story — consider taking the chat and drawer shots from the
  home-screen-installed PWA so they don't show the URL bar.
