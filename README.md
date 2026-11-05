# Quarc Calendar

A self-hosted calendar for the Quarc suite: day / week / month / year / agenda views, multiple
colour-coded calendars, repeating events, reminders, and **full offline use**. It uses the
**same login as every other Quarc app** and runs on the web, Android, Windows/macOS/Linux and
iOS (as a PWA), just like Quarc Music and Quarc Notes.

**Features**
- Day, Week, Month, Year and Agenda views (phones get a 3-day view and swipe navigation)
- Drag on the grid to create an event, drag to move it, pull the bottom edge to resize
- Multiple calendars with colours that you can show/hide per device
- All-day and multi-day events, location, description, per-event colour
- Repeating events: daily / weekly (pick weekdays) / monthly / yearly, every N, ends never / on a date / after N times — edit or delete **this event**, **this and following**, or **all**
- Reminders (several per event) as in-app toasts and system notifications, which also fire offline
- Search across everything on the device, mini-month navigator, keyboard shortcuts (`t` today · `j`/`k` or arrows · `d w m y a` views · `c` new · `/` search)
- Import / export `.ics` (Google, Apple, Outlook)
- English and Türkçe, light / dark / system theme, Monday/Sunday/Saturday week start, 12/24 h
- One shared account across every Quarc app

---

## How offline works

The app never waits for the network.

1. Every change is written to a local database on the device (IndexedDB) **and** to an outbox queue in one transaction.
2. A sync engine uploads the outbox and downloads other devices' changes whenever it can: at start-up, ~0.6 s after each edit, when the browser fires `online`, when the app regains focus, and every 30 s.
3. If a request fails (no signal, server down) nothing is lost — the changes simply stay queued and the next trigger retries. A badge in the top bar shows *Synced*, *Syncing…*, or *Offline · N changes saved on this device*.
4. Conflicts are resolved **last write wins** by the time of the edit on the device. If another device edited the same event later, its version is adopted and your queued edit is dropped, so nothing gets stuck.
5. Deletions are kept as tombstones until every device has seen them.
6. A service worker caches the app itself, so it opens with no connection at all. Logging in the first time needs the server; after that the last known user is cached and the app opens offline.

Local data belongs to one account: it's wiped if a *different* user logs in on the same device, and logging out refuses to discard un-uploaded changes without confirmation.

---

## Part 1 — Server setup

For the person who owns and runs the server. Same pattern as Quarc Notes.

### Requirements
- Docker and Docker Compose
- A machine that stays on, running [Tailscale](https://tailscale.com) with HTTPS certificates enabled
- The shared `quarc-auth` login service running (see `Quarc_Notes/auth/README.md`)

### Install
```bash
docker network create quarcnet-shared      # once per server, if not already done
git clone https://github.com/zekicandemiralay/Quarc_Calendar.git
cd Quarc_Calendar
cp .env.example .env                        # set JWT_SECRET = the SAME value as auth/.env
bash deploy.sh
```

Open `https://quarcnet0.tail84500c.ts.net:4005` (Music is 4000, Notes 4001, Weather 4002, Translate 4003, Cleaning 4004, **Calendar 4005**) and log in with your existing Quarc account.

### Updating, backup, health
```bash
bash deploy.sh                 # git pull + rebuild (or: deploy.sh frontend|backend)
bash backup.sh                 # → ./backup_YYYYMMDD_HHMMSS/  (calendar.db + .env)
bash restore.sh <backup-dir>
bash check.sh                  # containers, HTTPS, auth, sync endpoint
```

| Variable | Description |
|---|---|
| `JWT_SECRET` | Must equal `auth/.env`'s value exactly |
| `SECURE_COOKIE` | Must match quarc-auth (default `true`) |

Ports: backend `3006` (internal), public `4005`.

---

## Part 2 — User setup

Users need Tailscale connected, then:
- **Android**: install the APK from [Releases](https://github.com/zekicandemiralay/Quarc_Calendar/releases/latest)
- **Windows / macOS / Linux**: install the desktop app from Releases (see `desktop/BUILD.md` for the certificate note)
- **iOS**: open the URL in Safari → Share → **Add to Home Screen**
- **Anyone else**: open the URL in a browser

Log in with the same username/password as Quarc Music.

---

## Development

```
backend/    Express + SQLite sync API (JWT cookie verified locally, same as the other apps)
frontend/   React 18 + Vite + Tailwind + Dexie (IndexedDB) + zustand + i18next + date-fns
desktop/    Tauri 2 wrapper (loads the server URL)
mobile/     Capacitor 6 Android wrapper (bundles the web build)
.github/    Release workflow: Windows/macOS/Linux installers + signed Android APK on `v*` tags
```

```bash
# backend (needs JWT_SECRET to match whatever issues your cookie)
cd backend && npm install && PORT=3906 JWT_SECRET=dev npm start
# frontend — proxies /api/auth → :3902 (quarc-auth) and /api → :3906
cd frontend && npm install && npm run dev
```

### Tests
```bash
cd backend  && npm test     # sync API: push/pull, last-write-wins, ownership, paging
cd frontend && npm test     # recurrence, layout, .ics, translations, and the offline sync
                            # engine run against the real backend
```

### Releasing
Tag `vX.Y.Z` and push. The workflow needs these repository secrets for the Android build:
`KEYSTORE_BASE64` (base64 of the keystore, key alias `quarc-calendar`) and `KEYSTORE_PASSWORD`.

### Logo
`frontend/public/logo.png`, `desktop/logo.png` and `mobile/resources/icon.png` are **placeholders**.
When the real logo is ready, replace them and regenerate the platform icons:
```bash
cd desktop && npx tauri icon logo.png
cd ../mobile && npx capacitor-assets generate --android --iconBackgroundColor '#121212' --splashBackgroundColor '#121212'
```
