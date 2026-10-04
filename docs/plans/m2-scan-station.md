# Milestone 2 — Scan Station (laptop core app)

## Status (2026-10-04): built, desktop-tested; hardware testing pending

**Done and passing:**
- `npm test`: 34 tests, 13 of them new for the station:
  - every intake outcome (new, rescan, correction, older copy, two scouts,
    schedule mismatch, rejections with reasons)
  - the database refusing UPDATE/DELETE
  - coverage grid logic
  - TBA parsing and a bad-key error
  - the full HTTP API path, including that `data/` is never served
- Headless-Chrome run of the station page, using a simulated
  keyboard-style imager (typed text + Enter):
  - setup, a practice schedule, and the six config codes + schedule slideshow
  - green, blue, amber and red results for each scan case
  - a coverage grid showing exactly "Q2 Blue 3" missing
  - the records table and CSV export (UTF-8 notes intact)
  - no console errors
- The iPad app end-to-end test still passes after the shared-code refactor
  (scout app v1.0.1).

**Still to do, on real hardware:**
- two iPads → webcam scanning of a practice list
- a deliberately skipped scan shows as missing
- rebuilding a deleted database from an iPad's "Show all QR codes"
- the real TBA import with your key

**Found while building — think about this before buying an imager:** a
keyboard-style imager "types" each code. Emoji and accented letters in
notes often can't be typed that way, so those records would fail the
checksum and be rejected. The webcam path handles them fine. Options when
choosing an imager:
- pick one with a Unicode/"Alt-code" keyboard mode, or a serial (COM) mode
  (needs a small addition here), or
- limit iPad notes to plain characters.

## What

A Node.js app on the scouting laptop:
- reads each iPad's QR code (USB 2D imager or webcam)
- checks each record and stores it in a local SQLite database
- shows a clear **accepted** or **rejected (with reason)** for every scan
- lists which station + match combinations haven't been scanned yet

It also takes over from the lead tools page: it holds the event setup
(event code, PIN, roster, schedule) and shows the config and schedule QR
codes for the iPads.

## Why

It covers day-one definition-of-done items 2 and 3 (`CLAUDE.md`):
- "The scan station can read a code, store the record, and show a clear
  confirmation (or a clear rejection, with a reason)."
- "The scan station can list which station+match combinations have NOT
  been scanned yet."

The laptop database is the source of truth for raw scouting data, and M3
(the sync to the dashboard) reads from it.

## How

### Shape

```
laptop/
  server.js        starts the app: http://localhost:1507, opens the browser
  db.js            SQLite (built into Node, no native install): schema + queries
  intake.js        scan text -> decode -> store -> result (pure logic, tested)
  coverage.js      schedule x stations -> scanned / missing / duplicate / mismatch
  tba.js           one-shot schedule + team import from The Blue Alliance
  public/          the station's web page (plain HTML/JS, like scout-app)
    index.html     Scan screen (default), Coverage, Records, Event setup
data/              the .sqlite file + automatic backups (gitignored)
```

The page reuses `shared/` (decoding), `scout-app/qr.js` (QR codes) and
`scout-app/scanner.js` (webcam), so the iPad and the laptop can't
disagree about the record format.

### Scanning

- **USB 2D imager:** most imagers act as a keyboard. They "type" the code
  and press Enter. The Scan screen keeps an always-focused input that
  catches this, so no driver is needed. (The imager still needs testing
  against an iPad screen before buying; see open questions.)
- **Webcam:** a toggle uses the same scanner as the iPad app. The laptop is
  on `localhost`, so camera access is allowed.
- **Result for every scan:**
  - a large green panel: Qual 12 · Team 1507 · Red 2 · Ada, marked "new",
    "already have this (rescan)", or "replaces earlier record"
  - or a large red panel with the reason, e.g. "Checksum failed — garbled
    scan, try again", "Wrong event", "Form version mismatch — update the
    iPad"
  - a short high or low beep, so the person scanning doesn't have to look
    at the screen

### Database (append-only, per `CLAUDE.md` constraints)

| Table | What | Rule |
|---|---|---|
| `scans` | every scan attempt: raw text, time, accepted?, reason | insert only |
| `records` | every accepted record (decoded fields + raw QR text) | insert only; the same QR text twice is ignored |
| `current_records` (view) | newest record per match + team + scout | what reports read |
| `settings` | event code, PIN, roster | |
| `schedule` | match key → 6 teams, plus a revision | replaced on import |

Nothing is ever updated or deleted in `scans` or `records`. A correction
from an iPad is just a newer row with the same key. The database file is
copied to `data/backups/` every 10 minutes.

### Coverage screen ("what are we missing?")

A grid of matches (rows) × Red 1–Blue 3 (columns). Each cell is one of:
- ✓ scanned
- **missing**
- **2 scouts** (both kept; reports average them)
- **team mismatch**: the scanned team isn't the schedule's team for that
  station, e.g. the lead overrode it or the schedule changed

It only shows matches up to a "played through match N" marker, which the
lead sets with one tap. M4 sets this automatically from TBA results. A
summary line reads like "Missing: Q14 Blue 2, Q15 Red 1", which the lead
can read out to scouts.

### Event setup screen

- Event code, lead PIN, scout roster (same format as lead tools).
- Schedule:
  - **Import from TBA** (needs the tethered phone and a TBA read key), or
  - paste a schedule (same format as lead tools), or
  - generate a practice schedule.
- **Show iPad codes:** six config codes and the schedule slideshow, so
  `lead.html` is no longer needed (it stays online as a backup).
- **Export CSV** of current records, as a backup or for a spreadsheet.

### Running it

`npm run station`, then a browser opens at `http://localhost:1507`.
SQLite comes from Node's built-in `node:sqlite`, so the laptop needs
**Node 24** and nothing else, with no `npm install` or compiling. CI moves
to Node 24 as well.

## How it'll be tested

1. **Automated** (`npm test`), against an in-memory database:
   - accept, reject (bad checksum, wrong event, wrong version), an exact
     rescan, and a correction that supersedes
   - two scouts on one robot are both kept
   - coverage grid logic, including playoffs and team mismatches
   - parsing of a captured TBA schedule
2. **Browser check** (the same headless-Chrome approach as M1):
   - typed-in scans produce the right green or red panels
   - the coverage grid updates live
3. **Real hardware:**
   - two iPads scout a practice list; every record is scanned with the
     imager and with the webcam
   - mid-event, a deliberately skipped scan shows up as missing
   - "Show all QR codes" from an iPad rebuilds a deleted database with
     nothing lost

## Decisions (2026-10-04)

- **Webcam for now.** The keyboard-style imager input is built too, but
  test any imager against an iPad screen before buying one.
- **The team has a TBA read key.** It's entered on the Event setup screen
  and stored only in the laptop's local database (`data/`, gitignored).
- **Laptop: Windows + Node 24.**
