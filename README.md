# ⚡ Warlocks 1507 Scout

Offline scouting system for FRC Team 1507. Scouts record matches on iPads with
no network. Each record becomes a QR code that the scan-station laptop reads,
and the laptop syncs to a pick-team dashboard for mentors and student leads.

**Start with [CLAUDE.md](CLAUDE.md)**. It covers how the system fits together,
the rules it must not break, and the decisions made so far.

| Folder | What | Status |
|---|---|---|
| [scout-app/](scout-app/) | iPad web app (offline, QR output) + lead tools | Milestone 1 ✅ |
| [shared/](shared/) | Field list + record/QR format, used by every app | ✅ |
| [laptop/](laptop/) | Scan station: QR intake, SQLite database, coverage, iPad codes | Milestone 2 ✅ (sync: M3) |
| [dashboard/](dashboard/) | Apps Script sync endpoint + pick list (official + My list), Next match, Data health | Milestone 3 ✅ (deployed) · Milestone 4 + pick roles built, not yet deployed |
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
   hasn't been scanned. Once TBA posts results, a played match that nobody
   scanned counts as missing too.
5. **Event setup → 5 · Event data** shows whether TBA results (every 3 min)
   and Statbotics EPA (every 30 min) are coming in. Both are optional: if
   either site is down, scanning and sync carry on. The pick team sees EPA,
   OPR and TBA rank on the pick list and the **Next match** screen.

The database backs itself up to `data/backups/` every 10 minutes. If the
laptop dies, the iPads still have every record: Lead menu → Show all QR codes.

## Pick-team dashboard (one-time setup, with the team Google account)

The dashboard is for the **pick team**: mentors and student leaders. Everyone signs in
with their own Google account, and there are two roles:

- **Pick leads** change the **official list**: pick order, Target/Backup/Avoid tags,
  shared notes, and "Our robot needs".
- **Everyone else** sees the official list read-only, and gets **My list**: their own
  practice order and tags, which only they see. Nobody's experiments can mess up the
  official list.

1. Turn on the Apps Script API: <https://script.google.com/home/usersettings>.
2. `npm.cmd install -g @google/clasp`, then `clasp.cmd login` (sign in as the team account).
3. `npm.cmd run dashboard:create` creates the scouting Sheet and both Apps Script projects.
4. `npm.cmd run dashboard:push` uploads and deploys them. It prints the **dashboard URL**.
   Run it again after any change in `dashboard/` or `shared/fields.js`; the URLs stay the same.
5. Share the Sheet with each mentor's and student leader's **@warlocks1507.com** account
   as **Editor**. Sharing the Sheet is the allow-list: only people it's shared with can open
   the dashboard. Send them the dashboard URL. The first time, Google asks each person to
   authorize it (and may say "unverified app"). Click Advanced → Go to Warlocks 1507 Pick List.
6. **Choose the pick leads.** Signed in as the team account, open the Sheet's **Leads** tab
   (the first sync creates it) and put one pick lead's email per row in the `email`
   column. `name` and `role` are just for you. Only the team account can edit this tab.
   **Until at least one email is listed, everyone can change the official list**, and the
   dashboard shows a warning saying so.

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

Mentors and student leads open the dashboard with their **@warlocks1507.com** accounts.
Google's own sign-in page is the login. The dashboard knows who is signed in, so it
knows who is a pick lead.

**Limits of the roles:** the dashboard enforces them, but Editor access also lets
people open the Sheet itself. Someone determined could change the `Mentor` tab, which
holds the official list, directly in Google Sheets. The roles prevent accidental
changes made while playing with the list in the dashboard; they don't stop someone
deliberately editing the Sheet.

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
