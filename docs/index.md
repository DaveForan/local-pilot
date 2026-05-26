---
title: local-pilot
layout: default
---

# local-pilot

**Run and control [Claude Code](https://docs.claude.com/en/docs/claude-code) from any browser on your tailnet.**

A small web app that runs on a single box, drives Claude Code through the
Claude Agent SDK, and gives you a mobile-friendly chat UI you can reach from
your phone, tablet, or laptop over [Tailscale](https://tailscale.com/) — no
SSH session held open, no terminal emulator.

---

## What you get

- **Persistent sessions.** Each Claude run lives on the server. Start a task,
  close the tab, reattach from a different device — picks up exactly where
  you left off.
- **Native chat UI** instead of a terminal. Tool calls collapse into a
  per-turn activity log; permission prompts and elicitations render as
  modals with proper allow / deny / answer controls.
- **Multi-session dashboard** with an archive view, in-session search,
  context-window indicator, per-turn token/cost chips, and file-rewind
  ("undo a botched turn").
- **Images and voice.** Drag-drop or paste pictures into chat. Speak to
  Claude with self-hosted Whisper, hear replies in a natural voice with
  self-hosted Piper. A conversation mode loops it hands-free.
- **Push notifications** when a session needs a decision or finishes a
  turn — so you can walk away and come back when there's something to do.
- **Configurable.** MCP servers, plugins, slash-command discovery,
  hooks (Pre/PostToolUse, Stop, UserPromptSubmit, etc.), output style.
- **Backup + restore** in one click. **Token rotation** in one click.

## Quick install

You need: Node 20+, the `claude` CLI installed and logged in, Linux with
`systemd` (for the service install), and Tailscale on the host.

```sh
git clone https://github.com/<your-fork>/local-pilot
cd local-pilot
npm install
npm run service:install
```

That builds the UI, installs a systemd `--user` service, and prints your
access token. The service binds **`127.0.0.1` only** — never exposed on
your LAN.

Front it with Tailscale to reach it from your other devices:

```sh
sudo tailscale serve --bg 8787
```

Then open `https://<your-host>.<tailnet>.ts.net` from any tailnet device
and sign in with the token.

## Voice (optional)

Both halves of the conversation loop run on-device — no paid services:

```sh
npm run whisper:install   # speech-to-text (whisper.cpp)
npm run piper:install     # text-to-speech (Piper neural voices)
systemctl --user restart local-pilot
```

## Security model

- **Loopback bind.** The HTTP server listens on `127.0.0.1` only. The only
  way in is `tailscale serve`, so the attack surface is "anyone on your
  tailnet who has your access token".
- **Token-then-cookie.** A 24-byte random access token is generated on
  first start (`~/.local-pilot/token`, mode `0600`). Sign-in exchanges
  the token for an `HttpOnly`, `SameSite=Strict`, `Secure` session
  cookie — the token itself is never stored in the browser. Sessions
  are server-side and revocable.
- **Rate-limited sign-in.** 10 failures per IP per 15 minutes.
- **Rotation built in.** Settings → Security → "Rotate access token"
  issues a new one and invalidates every other device's cookie.

> **What an access token gets you.** Anyone holding it can create a
> session in any directory and have Claude execute tools there — that's
> the whole point of the app. Treat the token like an SSH key. The
> `tailscale serve` gate limits *who can even reach* the login page; the
> token gates the rest.

## Screenshots

_(Add your own to `docs/screenshots/` — referenced here.)_

## Configuration

The defaults are sensible. Override via environment variables when
launching the service:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP / WebSocket port |
| `HOST` | `127.0.0.1` | Bind address — loopback only |
| `LOCAL_PILOT_DATA` | `~/.local-pilot` | Where state is stored |
| `LOCAL_PILOT_DEFAULT_CWD` | `~/Projects` | Default working dir for new sessions |
| `LOCAL_PILOT_TOKEN` | _(auto-generated)_ | Override the access token |
| `LOCAL_PILOT_WHISPER_MODEL` | `base.en` | Whisper model |
| `LOCAL_PILOT_PIPER_VOICE` | `en_US-amy-medium` | Piper voice |

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│           Browser (tailnet device, anywhere)             │
│   React + Vite UI · session cookie · WebSocket           │
└────────────────┬─────────────────────────────────────────┘
                 │ HTTPS via `tailscale serve`
┌────────────────▼─────────────────────────────────────────┐
│                local-pilot server (loopback)             │
│  Node + Express · WebSocket hub · auth · push            │
│  SessionManager → one ClaudeRunner per session           │
│  Whisper (STT) · Piper (TTS) spawned on demand           │
└────────────────┬─────────────────────────────────────────┘
                 │ Claude Agent SDK (in-process)
┌────────────────▼─────────────────────────────────────────┐
│   The same Claude Code your `claude` CLI runs.           │
│   Uses your existing login, MCP servers, skills,         │
│   project settings, CLAUDE.md.                           │
└──────────────────────────────────────────────────────────┘
```

## Project status

v1 is feature-complete. See the [README](https://github.com/<your-fork>/local-pilot)
on GitHub for the changelog.

## License

[MIT](https://github.com/<your-fork>/local-pilot/blob/main/LICENSE).

---

_local-pilot is not affiliated with Anthropic. "Claude" and "Claude Code"
are trademarks of Anthropic._
