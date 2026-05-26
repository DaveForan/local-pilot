# local-pilot · [docs ↗](https://daveforan.github.io/local-pilot/)

```
                       ██████████████████████████
                       █  ◆────────────────────◆ █          ◀── you, the controller
                       ██████████████████████████             (anywhere on the tailnet)
                        ╲│  ╲ │  ╲│  │╱  │ ╱  │╱
                         │   ╲│   │   │   │   │
                         │    │   │   │   │   │            WebSocket "strings"
                         │    │   │   │   │   │            (HTTPS via tailscale serve)
                         │    │   │   │   │   │
                       ┌─┴────┴───┴───┴───┴───┴─┐
                       │   ◖        ●        ◗   │
                       │            ◡            │         ◀── claude code, the puppet
                       └─┬─────────────────────┬─┘            executes tools you ask for
                        ╱│                     │╲             in any directory you point
                       ◉ │                     │ ◉
                         │                     │
                       ┌─┴─────────────────────┴─┐
                       │░░░░░░░░░░░░░░░░░░░░░░░░░│
                       │░░░░░░░░░░░░░░░░░░░░░░░░░│
                       │░░░░░░░░░░░░░░░░░░░░░░░░░│
                       └─┬─────────────────────┬─┘
                         │                     │
                         │                     │
                         │                     │
                       ──╨                     ╨──


███╗   ███╗  █████╗  ██████╗  ██╗  ██████╗  ███╗   ██╗ ███╗   ██╗ ███████╗ ████████╗ ████████╗ ███████╗
████╗ ████║ ██╔══██╗ ██╔══██╗ ██║ ██╔═══██╗ ████╗  ██║ ████╗  ██║ ██╔════╝ ╚══██╔══╝ ╚══██╔══╝ ██╔════╝
██╔████╔██║ ███████║ ██████╔╝ ██║ ██║   ██║ ██╔██╗ ██║ ██╔██╗ ██║ █████╗      ██║       ██║    █████╗
██║╚██╔╝██║ ██╔══██║ ██╔══██╗ ██║ ██║   ██║ ██║╚██╗██║ ██║╚██╗██║ ██╔══╝      ██║       ██║    ██╔══╝
██║ ╚═╝ ██║ ██║  ██║ ██║  ██║ ██║ ╚██████╔╝ ██║ ╚████║ ██║ ╚████║ ███████╗    ██║       ██║    ███████╗
╚═╝     ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═════╝  ╚═╝  ╚═══╝ ╚═╝  ╚═══╝ ╚══════╝    ╚═╝       ╚═╝    ╚══════╝
```

Run and control **Claude Code** sessions from a web browser. Designed to be
hosted on a Tailscale node so you can drive Claude Code from any device —
phone, tablet, laptop — without holding an SSH connection open.

📚 **[Documentation & screenshots →](https://daveforan.github.io/local-pilot/)**

## What it is

- **Custom chat UI** for Claude Code (not a terminal emulator). Tool calls
  and permission/elicitation prompts render as native, mobile-friendly UI.
- **Persistent sessions** — each session's Claude Code run lives on the server
  and survives browser disconnects. Start a run, close the tab, reattach later
  from another device.
- The backend drives Claude Code through the **Claude Agent SDK**, so it reuses
  your existing `claude` login, skills and MCP servers.

## Layout

```
local-pilot/
├── server/   Node + TypeScript. HTTP + WebSocket. Owns session state.
└── web/      React + Vite frontend.
```

State is persisted to `~/.local-pilot/` — sessions, saved prompts, MCP
servers, and push (VAPID keys + browser subscriptions).

## Develop

```sh
npm install
npm run dev
```

- Backend: <http://localhost:8787>
- Frontend (Vite dev server, proxies `/api` + `/ws` to the backend): <http://localhost:5173>

## Run it as a service (recommended)

```sh
npm run service:install
```

This builds the UI and installs a **systemd `--user` service** that runs
local-pilot in the background and restarts it on failure. Manage it with:

```sh
systemctl --user status local-pilot
systemctl --user restart local-pilot
journalctl --user -u local-pilot -f      # logs
```

To keep it running after you log out and across reboots, enable linger once:

```sh
sudo loginctl enable-linger "$USER"
```

### Or run it directly

```sh
npm install
npm run build      # builds web/dist
npm start          # serves API, WebSocket and the built UI on :8787
```

## Security model

- **Binds `127.0.0.1` only.** The server is never exposed on your LAN. The
  one way in is `tailscale serve` (below), so reach is limited to your tailnet.
- **Access token.** A random token is generated on first start into
  `~/.local-pilot/token` (also printed by `npm run service:install`); set your
  own with `LOCAL_PILOT_TOKEN`. `cat ~/.local-pilot/token` to retrieve it.
- **Session cookies.** Signing in exchanges the token for an `HttpOnly`,
  `SameSite=Strict`, `Secure` session cookie — the token is never stored in
  the browser. "Sign out" in the drawer ends the session. Login attempts are
  rate-limited.

## Connecting

The app listens on loopback, so expose it on your tailnet over HTTPS:

```sh
sudo tailscale serve --bg 8787
```

Then open `https://<tailscale-host>.<tailnet>.ts.net` and sign in with the
token. HTTPS via `tailscale serve` is also what makes push notifications and
voice input work.

## Voice (optional)

Conversation mode runs **fully offline** on the box, with no paid services:

```sh
npm run whisper:install      # speech-to-text: whisper.cpp + base.en model
npm run piper:install        # text-to-speech: Piper + en_US-amy-medium voice
systemctl --user restart local-pilot
```

Whisper needs `ffmpeg` (and `git` + a C compiler to build); `cmake` is fetched
automatically if missing — no sudo. Piper ships as a prebuilt binary, also no
sudo. Both land in `~/.local-pilot/`. Pick a different Piper voice with
`LOCAL_PILOT_PIPER_VOICE=en_US-ryan-high` (and re-run `piper:install`); pick a
larger Whisper model with `LOCAL_PILOT_WHISPER_MODEL=small.en`.

Without these the browser's built-in speech recognition and synthesis are used
as fallbacks — voice still works, just less accurate / more robotic.

## Requirements

- Node 20+
- The `claude` CLI installed and logged in (the Agent SDK reuses its auth).
- Linux with `systemd` (for the service install; otherwise run it directly).
- `ffmpeg` — only for voice input.

## Configuration (environment variables)

| Variable                  | Default              | Purpose                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `PORT`                     | `8787`               | HTTP/WebSocket port                      |
| `HOST`                     | `127.0.0.1`          | Bind address — loopback only; front with `tailscale serve` |
| `LOCAL_PILOT_DATA`         | `~/.local-pilot`     | Where sessions, snippets, MCP + push config are stored |
| `LOCAL_PILOT_DEFAULT_CWD`  | `~/Projects`         | Default working directory for new sessions |
| `LOCAL_PILOT_TOKEN`        | _(auto-generated)_   | Access token; overrides the generated one |
| `LOCAL_PILOT_WHISPER_MODEL`| `base.en`            | Whisper model used for voice transcription |
| `LOCAL_PILOT_PIPER_VOICE`  | `en_US-amy-medium`   | Piper voice used for read-aloud |
| `LOCAL_PILOT_PIPER_SPEAKER`| _(first speaker)_    | For multi-speaker voices: speaker name or numeric id |
| `PUSH_SUBJECT`             | `mailto:local-pilot@localhost` | VAPID contact subject for web-push |

## Status

v1 is feature-complete:

- **Token-protected** — a single access token gates the whole API.
- **Multi-session dashboard** with a mobile-first drawer UI and light/dark
  paper themes.
- **Custom chat UI** — tool calls collapse into a per-turn activity log;
  permission prompts render as native, mobile-friendly cards.
- **Images & voice** — attach pictures, speak to Claude (server-side Whisper
  STT) and have replies read back in a natural neural voice (server-side
  Piper TTS); a conversation mode loops it all hands-free.
- **Saved prompts**, an **MCP server editor**, and a skills list.
- **Push notifications** when a session needs a decision or finishes a turn.
- Runs as a **systemd service**.

Push notifications and voice input need the UI served over HTTPS (or
localhost) — on a Tailscale node, front it with `tailscale serve`.
