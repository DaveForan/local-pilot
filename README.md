# local-pilot

Run and control **Claude Code** sessions from a web browser. Designed to be
hosted on a Tailscale node so you can drive Claude Code from any device —
phone, tablet, laptop — without holding an SSH connection open.

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

## Access token

local-pilot is **token-protected** — without the token the server would hand
full Claude Code control to anyone who can reach the port.

- On first start a random token is generated and saved to
  `~/.local-pilot/token` (also printed by `npm run service:install`).
- Set your own with the `LOCAL_PILOT_TOKEN` environment variable instead.
- The browser prompts for it once and remembers it; "Sign out" in the drawer
  clears it.

`cat ~/.local-pilot/token` to retrieve it.

## Connecting

Open `http://<tailscale-host>:8787` and sign in with the token. For **HTTPS**
— required for push notifications and voice input — front it with
`tailscale serve`:

```sh
sudo tailscale serve --bg 8787
```

Then open `https://<tailscale-host>.<tailnet>.ts.net`.

## Requirements

- Node 20+
- The `claude` CLI installed and logged in (the Agent SDK reuses its auth).
- Linux with `systemd` (for the service install; otherwise run it directly).

## Configuration (environment variables)

| Variable                  | Default              | Purpose                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `PORT`                     | `8787`               | HTTP/WebSocket port                      |
| `HOST`                     | `0.0.0.0`            | Bind address (0.0.0.0 = reachable on tailnet) |
| `LOCAL_PILOT_DATA`         | `~/.local-pilot`     | Where sessions, snippets, MCP + push config are stored |
| `LOCAL_PILOT_DEFAULT_CWD`  | `~/Projects`         | Default working directory for new sessions |
| `LOCAL_PILOT_TOKEN`        | _(auto-generated)_   | Access token; overrides the generated one |
| `PUSH_SUBJECT`             | `mailto:local-pilot@localhost` | VAPID contact subject for web-push |

## Status

v1 is feature-complete:

- **Token-protected** — a single access token gates the whole API.
- **Multi-session dashboard** with a mobile-first drawer UI and light/dark
  paper themes.
- **Custom chat UI** — tool calls collapse into a per-turn activity log;
  permission prompts render as native, mobile-friendly cards.
- **Images & voice** — attach pictures, dictate messages, and a conversation
  mode that reads replies aloud and reopens the mic.
- **Saved prompts**, an **MCP server editor**, and a skills list.
- **Push notifications** when a session needs a decision or finishes a turn.
- Runs as a **systemd service**.

Push notifications and voice input need the UI served over HTTPS (or
localhost) — on a Tailscale node, front it with `tailscale serve`.
