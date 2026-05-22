# local-pilot

Run and control **Claude Code** sessions from a web browser. Designed to be
hosted on a Tailscale node so you can drive Claude Code from any device —
phone, tablet, laptop — without holding an SSH connection open.

## What it is

- **Custom chat UI** for Claude Code (not a terminal emulator). Tool calls,
  diffs and permission/elicitation prompts render as native, mobile-friendly UI.
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

## Production (on the Tailscale node)

```sh
npm install
npm run build      # builds web/dist
npm start          # backend serves API, WebSocket and the built UI on :8787
```

Open `http://<tailscale-host>:8787`. For HTTPS — required for push
notifications — front it with `tailscale serve`.

## Requirements

- Node 20+
- The `claude` CLI installed and logged in (the Agent SDK reuses its auth).

## Configuration (environment variables)

| Variable                  | Default              | Purpose                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `PORT`                     | `8787`               | HTTP/WebSocket port                      |
| `HOST`                     | `0.0.0.0`            | Bind address (0.0.0.0 = reachable on tailnet) |
| `LOCAL_PILOT_DATA`         | `~/.local-pilot`     | Where sessions, snippets, MCP + push config are stored |
| `LOCAL_PILOT_DEFAULT_CWD`  | `~/Projects`         | Default working directory for new sessions |
| `PUSH_SUBJECT`             | `mailto:local-pilot@localhost` | VAPID contact subject for web-push |

## Status

v1 is feature-complete:

- **Multi-session dashboard** with mobile-optimized controls.
- **Custom chat UI** — tool calls, results and permission prompts as native UI.
- **Saved prompts** — a snippet picker in the composer, plus a manager.
- **Settings panel** — a visual editor for MCP servers and a skills list.
- **Elicitation handling** — permission cards support allow / deny and
  allow-with-edits, and surface SDK-supplied suggestions.
- **Push notifications** — get pinged when a session needs a decision or
  finishes a turn. Requires the UI served over HTTPS (or localhost); on a
  Tailscale node, front it with `tailscale serve`.
