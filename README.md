# ⚡ Warlocks 1507 Scout

Offline scouting system for FRC Team 1507. Scouts record matches on iPads with
no network. Each record becomes a QR code that the scan-station laptop reads,
and the laptop syncs to a mentor dashboard.

**Start with [CLAUDE.md](CLAUDE.md)**. It covers how the system fits together,
the rules it must not break, and the decisions made so far.

| Folder | What | Status |
|---|---|---|
| [scout-app/](scout-app/) | iPad web app (offline, QR output) + lead tools | Milestone 1 ✅ |
| [shared/](shared/) | Field list + record/QR format, used by every app | ✅ |
| [laptop/](laptop/) | Scan station: QR intake, SQLite database, coverage, iPad codes | Milestone 2 ✅ (sync: M3) |
| [dashboard/](dashboard/) | Apps Script sync endpoint + mentor pick list | Milestone 3 ✅ (deployed) |
| [docs/](docs/) | Specs, plans, legacy audit | |
| [legacy/](legacy/) | v3 app, reference only | |

## Commands

Needs [Node.js](https://nodejs.org) 24 or newer. Nothing to install: there are
no dependencies, and the scan station uses Node's built-in SQLite.

```
npm run station # the scan station: opens http://localhost:1507 (data in data/, gitignored)
npm test        # all tests (record format, real QR encode -> decode, scan station)
npm run serve   # http://localhost:8080 — scout app + lead tools on this computer
npm run icons   # regenerate the Home Screen icons
```

**Windows: "running scripts is disabled on this system"?** PowerShell is blocking
npm's helper script. Type `npm.cmd` instead of `npm` (e.g. `npm.cmd run station`), or run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once (school-managed laptops may not allow it).

## At an event (scan station)

1. `npm run station`. On first run it opens **Event setup**: enter the event
   code, lead PIN, roster and your TBA read key, then **Import from The Blue
   Alliance** (needs the tethered phone) or paste a schedule.
2. **Show config codes** / **Show schedule codes** for the iPads to scan.
3. On the **Scan** tab, scan each iPad's QR code with the imager (the box must
   show a green dot) or **Use webcam**. Every scan gives a green or red answer
   and a beep.
4. Check **Coverage** between matches. It lists every station and match that
   hasn't been scanned.

The database backs itself up to `data/backups/` every 10 minutes. If the
laptop dies, the iPads still have every record: Lead menu → Show all QR codes.

## Mentor dashboard (one-time setup, with the team Google account)

1. Turn on the Apps Script API: <https://script.google.com/home/usersettings>.
2. `npm.cmd install -g @google/clasp`, then `clasp.cmd login` (sign in as the team account).
3. `npm.cmd run dashboard:create` creates the scouting Sheet and both Apps Script projects.
4. `npm.cmd run dashboard:push` uploads and deploys them. It prints the **mentor dashboard URL**.
   Run it again after any change in `dashboard/` or `shared/fields.js`; the URLs stay the same.
5. Share the Sheet with each mentor's **@warlocks1507.com** account as **Editor**. Sharing the
   Sheet is the allow-list: only people it's shared with can open the dashboard. Send them the dashboard URL.
   The first time, Google asks each mentor to authorize it (and may say "unverified app").
   Click Advanced → Go to Warlocks 1507 Pick List.

**Sign the scan station in to Google (needed because warlocks1507.com blocks anonymous web apps).**
The laptop signs in through the team's own *Internal* OAuth app, which Workspace trusts.
Outside apps like clasp are blocked from Drive permissions.
1. In <https://console.cloud.google.com>, as the team account, open the project
   (any warlocks1507.com project) and enable the **Google Drive API**.
2. **Google Auth Platform**: app name `Warlocks 1507 Scan Station`, Audience **Internal**.
3. **Clients → Create client → Desktop app**, then **Download JSON** and save it as
   `data\google-oauth-client.json`.
4. `npm.cmd run station:login` opens Google sign-in. Sign in with a warlocks1507.com account.
   The sign-in is saved in `data\google-auth.json` (never committed).

Mentors open the dashboard with their **@warlocks1507.com** accounts. Google's own
sign-in page is the login.

The scan station picks up the sync URL and token from `data/dashboard.json`
automatically and syncs every 3 minutes over the tethered phone. Its Scan tab
shows "Synced N min ago" or why it's failing. On a different laptop, paste the
URL and token on Event setup → Dashboard sync.

## Changing what scouts record

Edit [shared/fields.js](shared/fields.js), the only place fields are defined,
then bump `SCHEMA_VERSION` there and `APP_VERSION` in
[scout-app/version.js](scout-app/version.js), and run `npm test`. Check
[docs/data-requirements.md](docs/data-requirements.md) first: every field
should trace back to a decision the team makes at competition.

## Setting up iPads

1. Push to `main`. GitHub Actions tests and publishes the app to
   `https://<owner>.github.io/<repo>/scout-app/` (one-time: Settings → Pages →
   Source: GitHub Actions).
2. On each iPad, while online, open that link in **Safari**, then Share →
   **Add to Home Screen**. Always open the app from the Home Screen icon.
3. On a laptop, open `…/scout-app/lead.html` to make the config codes (one per
   station) and a schedule. Each iPad scans its config code, then the schedule.
4. Turn on airplane mode. The iPad no longer needs the network.

After you push an update, each iPad shows "App update ready" on its Home screen
the next time it's online.
