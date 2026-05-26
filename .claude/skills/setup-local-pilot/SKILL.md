---
name: setup-local-pilot
description: |
  Use when the user wants help installing local-pilot, running it for the
  first time, or connecting to it from their phone over Tailscale.
  Triggers on phrases like "set up local-pilot", "install local-pilot",
  "get local-pilot running on my phone", "connect from my phone", or
  general "how do I start" questions in the local-pilot repo.
---

# Setup walkthrough for local-pilot

You are guiding a (possibly first-time) user through installing this
app and reaching it from their phone over Tailscale. Be **interactive**,
not a wall of text: check one thing at a time, wait for confirmation,
and only run commands the user has authorized.

## Tone

- Treat the user as a developer who may be new to systemd, Tailscale, or
  the Claude Code CLI. Explain in plain language *why* each step matters,
  not just what to type.
- One step per turn unless the user explicitly says "give me everything
  at once".
- Verify success after each step with a small probe (e.g. `command -v node`,
  `systemctl --user is-active local-pilot`) before moving on.
- If a step fails, diagnose the actual error before retrying — never just
  loop the same command.

## Phase 1 — prerequisites

Check each one. For each that's missing, give the user the appropriate
install command for **their** distro / OS (ask if you don't know it) and
wait for them to install it.

| Check | Command | If missing |
| --- | --- | --- |
| Node 20+ | `node --version` | `nvm install 20` or distro pkg manager |
| `claude` CLI | `command -v claude && claude --version` | Point them at [Anthropic's install docs](https://docs.claude.com/en/docs/claude-code/setup), and remind them to run `claude` once and log in before continuing |
| Tailscale | `command -v tailscale && tailscale status` | `curl -fsSL https://tailscale.com/install.sh \| sh`, then `sudo tailscale up` |
| Optional: ffmpeg | `command -v ffmpeg` | Only needed for voice — skip unless the user wants STT |

When checking the `claude` CLI, confirm the user has already logged in
(`claude` reuses that login — they won't sign into Anthropic a second
time inside local-pilot).

## Phase 2 — install

```sh
cd ~/Projects                  # or wherever they keep code
git clone https://github.com/DaveForan/local-pilot
cd local-pilot
npm install
npm run service:install
```

Watch the output of `service:install` for these specific lines and read
them back to the user:

- `[auth] generated a new access token` followed by the actual token —
  **tell the user to copy this to a password manager NOW**; it's their
  credential and they'll need it on every device. (If they miss it, it's
  also in `~/.local-pilot/token`.)
- `[server] local-pilot listening on http://127.0.0.1:8787`

Then confirm it's actually running:

```sh
systemctl --user is-active local-pilot   # expect: active
```

Optionally enable linger (so it survives the user logging out and
reboots), only if they confirm they want that:

```sh
sudo loginctl enable-linger "$USER"
```

## Phase 3 — expose on Tailscale

```sh
sudo tailscale serve --bg 8787
```

This publishes an HTTPS URL like `https://<host>.<tailnet>.ts.net`. Print
the actual hostname for the user — get it from `tailscale status --self`
or `hostname`.

Explain *why* HTTPS matters here even though the server itself is plain
HTTP: browsers refuse to grant microphone access or push-notification
permission over plain HTTP (except on localhost), so Tailscale's HTTPS
front is what makes voice + push work from a phone.

## Phase 4 — first sign-in from the phone

Walk the user through this from their phone, not the host machine:

1. **Open the URL** (`https://<host>.<tailnet>.ts.net`) in Safari (iOS)
   or Chrome (Android) on a device that's already on the same tailnet.
   If they get a "site can't be reached" error, the most common cause is
   the device isn't on the tailnet yet — check `tailscale status` on the
   phone.
2. **Paste the access token** from Phase 2.
3. The token is exchanged for an `HttpOnly` session cookie — they won't
   have to enter the token again on this device unless they sign out.

## Phase 5 — add to home screen (do this, it matters)

This is the bit that makes local-pilot feel native on a phone:

- **iOS Safari**: tap the share button → "Add to Home Screen". Open
  from that icon, not Safari, going forward.
- **Android Chrome**: three-dot menu → "Add to Home screen" or "Install
  app".

Beyond the icon, this also makes push notifications work properly — when
a session needs a decision (permission prompt, AskUserQuestion), it
shows up in the OS notification tray rather than only inside an open tab.

After adding, ask them to:

1. Open local-pilot from the home-screen icon.
2. Go to **Settings → Notifications** in the drawer and enable push.
3. Confirm they see the test notification.

## Phase 6 (optional) — voice

Only offer this if the user is curious about hands-free conversation
mode:

```sh
npm run whisper:install   # speech-to-text, downloads ~150MB
npm run piper:install     # text-to-speech, downloads ~60MB
systemctl --user restart local-pilot
```

Both run entirely on-device — no paid services. Without them, the
browser's built-in Web Speech API is the fallback (works, but less
accurate).

After install, have the user toggle conversation mode in the composer
(the circular toggle near the mic button) and try saying something.

## Done — quick verification

Have the user:

1. Open the app from the home-screen icon.
2. Tap **＋ New session**, point it at any local directory (their
   `~/Projects/foo` is fine), pick a model.
3. Send a tiny message: "Hi! What's in this directory?"
4. Confirm Claude responds and the activity block shows the `LS` tool
   call.

That's the loop. Close the browser, walk away, come back from another
device — it picks up where it left off.

## Troubleshooting reference

If anything goes wrong at any step, use these:

```sh
systemctl --user status local-pilot       # is the service alive?
journalctl --user -u local-pilot -n 50    # recent logs
journalctl --user -u local-pilot -f       # tail live
```

Common failure modes and the actual fix:

- **"Cannot find module" on `npm start`** — they forgot `npm install`,
  or installed at the workspace root but a sub-workspace got skipped.
  Re-run `npm install`.
- **Service won't start, ENOTFOUND or similar** — usually a typo in
  `~/.config/systemd/user/local-pilot.service`. Reload + restart:
  `systemctl --user daemon-reload && systemctl --user restart local-pilot`.
- **`tailscale serve` says "must be run as root"** — they forgot
  `sudo`.
- **Phone can ping the URL but sign-in 401s** — they're using the
  wrong token. `cat ~/.local-pilot/token` on the host to get the
  current one, or rotate it from **Settings → Security**.
- **Push notifications don't arrive on iOS** — the user has to open
  from the home-screen icon (not Safari directly) AND have enabled
  notifications in iOS Settings → Notifications for that PWA.

## What NOT to do

- Don't run `service:install` more than once without first running
  `systemctl --user stop local-pilot`. The installer is idempotent but
  restarts can race with the build step.
- Don't store the access token in the user's shell history. If they
  pasted it into a command and want it scrubbed, point them at
  `~/.bash_history` or `~/.zsh_history`.
- Don't recommend `HOST=0.0.0.0` to "just make it work" — it bypasses
  the tailnet gate and exposes the app on their LAN, which is exactly
  what the loopback bind is preventing.
