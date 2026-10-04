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
| `laptop/` | Scan station: QR intake, database, sync | Milestone 2 |
| `dashboard/` | Apps Script mentor dashboard | Milestone 3 |
| [docs/](docs/) | Specs, plans, legacy audit | |
| [legacy/](legacy/) | v3 app, reference only | |

## Commands

Needs [Node.js](https://nodejs.org) 22 or newer. Nothing to install: there are no dependencies.

```
npm test        # record/QR format tests (includes a real QR encode -> decode)
npm run serve   # http://localhost:8080 — scout app + lead tools on this computer
npm run icons   # regenerate the Home Screen icons
```

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
