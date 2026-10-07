# Warlocks 1507 Scouting System: Briefing for Writing Manuals and Presentations

> **For Claude:** This document plus the screenshots in `screenshots/` is
> everything you know about this system. Use it to write user manuals, quick
> reference cards, and explanation presentations. Don't invent features,
> buttons or messages that aren't described here. If a reader would need
> something this brief doesn't cover, say it's missing rather than guessing.
> Screen text in **bold** or `code` below is exactly what users see.

---

## 1. What this is, in one paragraph

FRC (FIRST Robotics Competition) Team 1507, the **Warlocks**, built a
scouting system to make better **alliance-selection** and **match-strategy**
decisions at competitions. Student **scouts** watch one robot each per
match and record what it does on an **iPad that works with no internet at
all**. Each finished match record appears as a **QR code**. The **scan
station** (a laptop) reads the codes with a webcam or barcode scanner,
checks them and stores them. Every 3 minutes the laptop pushes the data
over a phone's cellular connection (USB-tethered, no Wi-Fi hotspot) to a
**mentor dashboard** (a Google web app). Mentors use it on their phones to
rank, tag and annotate teams, especially for the "4pm Saturday" pick list
at alliance selection.

**Theme and branding:** Warlocks colors are **navy blue (#00004d) and gold
(#FFD700)** on a near-black background, with a **lightning-bolt ⚡**
motif. The apps use a gold zigzag "lightning" edge under the header.

---

## 2. Why it's built this way (the "why" slides)

| Decision | Reason |
|---|---|
| iPads work completely offline | Venue Wi-Fi is unreliable. FRC rule **E301** is understood to forbid teams from running their own Wi-Fi hotspots at events (being confirmed for this season). The old version needed internet for every tap and lost data when it dropped. |
| Records travel as QR codes | No network needed between the iPad and the laptop. A checksum in every code catches a garbled scan, which is then rejected rather than stored wrong. |
| The laptop is the source of truth | All raw scouting data lives in a database on the scan station, which backs itself up every 10 minutes. |
| iPads never delete records | Each iPad keeps every record it ever made, as the backup if the laptop fails. **Show all QR codes** replays them. |
| Scouting data is never edited, only superseded | A correction is a new record that replaces the old one. History is kept, nothing is silently changed, and the database refuses edits. |
| Scouts never pick their own match or team | The scouting lead assigns each iPad a fixed **station** (Red 1–3, Blue 1–3). The iPad works out which team to watch from the schedule. This prevents scouting the wrong robot. |
| No silent defaults | Every multiple-choice question starts **unanswered**, and the match can't be submitted until each one is answered. The old app pre-filled answers, so skipped questions looked like real data. |
| Mentor notes are separate from scouting data | Mentors tag, rank and comment, but can never change what scouts recorded. Syncing never overwrites a mentor's note. |
| Every field must support a decision | The design principle is "begin with the end": decide what choices the team makes at competition, then collect only the data those choices need. |

The previous version (v3) was a single Google Apps Script web app that
needed internet everywhere. This version (v4, the "refresh") was built so
**students can own and maintain it** after the mentor who wrote v3 stepped
back.

---

## 3. The four parts and who uses them

| Part | Runs on | Used by | Purpose |
|---|---|---|---|
| **Scout app** | iPads (installed from Safari to the Home Screen) | Scouts; the scouting lead uses its PIN-locked Lead menu | Record a match offline, show it as a QR code |
| **Scan station** | Scouting laptop (Windows), in a browser at `http://localhost:1507` | Scouting lead / scan-station operator | Scan QR codes, catch missing scans, set up iPads, import the schedule, sync to the dashboard |
| **Mentor dashboard (pick list)** | Any phone or computer; a Google web app | Mentors (signed in with **@warlocks1507.com** accounts) | Filter, rank, tag and annotate teams for alliance selection |
| **Lead tools page** | Any browser (backup) | Scouting lead | A backup way to make iPad setup codes if the laptop isn't available |

Data flows one way: **iPad → (QR code) → scan station → (cellular, every 3 min) → Google Sheet → mentor dashboard.**

### People (roles) to write for
1. **Scout:** a student, possibly on their first-ever match. Needs a
   one-page quick card. One-handed, about 2 minutes per match.
2. **Scouting lead:** sets up iPads, runs the scan station, chases missing
   scans, fixes problems. Needs an event-day runbook and troubleshooting.
3. **Mentor:** uses the pick list on a phone. Needs a short guide.
4. **Student maintainer:** changes fields for the next game, deploys
   updates. Needs a technical guide (section 9).
5. **Audiences for presentations:** the team (students learning the
   system), mentors (what the pick list means), and possibly sponsors or
   judges (Engineering Inspiration / Innovation-style storytelling about
   designing a decision tool).

---

## 4. Scout app (iPad)

Screenshots: `ipad-01` … `ipad-09`. They were taken in a desktop browser
test. On a real installed iPad, the yellow **"Not installed yet"** notice
doesn't appear. Small pop-up messages at the bottom (for example "Schedule
updated" or "Wrong PIN") are brief notifications left over from the test,
not permanent screen parts.

### 4.1 One-time setup (done by the scouting lead)
1. While online, open the app's web address in **Safari**, tap **Share →
   Add to Home Screen**, and from then on **open it only from the Home
   Screen icon** (a gold lightning bolt on navy). Data saved in a Safari tab
   is kept separately and iOS may clear it.
2. First launch shows **"Set up this iPad"** with a **Scan config QR**
   button (`ipad-01-setup.png`). Scan the config code for this iPad's
   station from the scan station's Event setup screen. It sets the
   **event**, the **station** (e.g. Red 2), the **lead PIN** and the
   **scout roster**.
3. On Home, tap **Scan schedule** and scan every schedule code part (in any
   order). The iPad shows "Got part 2 of 7. Still need: 1, 3…" until it has
   all of them.
4. Turn on **airplane mode**. The iPad never needs the network again
   during the event.

### 4.2 Scout workflow, every match
1. **Who's scouting?** (`ipad-02`): tap your name. Change it when you
   hand the iPad to the next scout (Home → **Scout: <name> — change**).
2. **Home** (`ipad-03`): shows the match (e.g. **Qual 12**), your station
   chip (red or blue), and a giant **team number to scout**. ◀ ▶ step
   between matches (to catch up to the match on the field). Tap **Start
   scouting**. The team always comes from the schedule; scouts can't type
   one in.
3. **The form** has four tabs: **Auto, Teleop, Endgame, Wrap-up**. The
   bottom bar has **◀ Back** and **Next ▶**, and the last tab has
   **Submit ⚡**.
   - Big **+1 / +5 / +10 / −1** buttons count game pieces ("fuel"). Green
     totals are scored, red are missed.
   - Toggles (checkbox-style buttons) for yes/no questions.
   - Answer buttons for multiple choice, where tapping the chosen answer
     again un-selects it. A 1–5 rating for cycle speed.
   - Questions marked **required** must be answered unless the robot was a
     **No show** (or **Dead in auto**, for most of them). Submitting with
     unanswered questions jumps to the first one, outlines it in red, puts
     a red dot on the tab, and shows "Still needed: …" (`ipad-05`).
   - Every tap saves automatically. If the app is closed, crashes or the
     iPad restarts mid-match, reopening it goes straight back into the form
     with "Restored your unfinished match".
4. **Submit** → **"✓ Saved on this iPad"** and a large **QR code**
   (`ipad-07`) under **"Show this to the scan station"**. If it won't
   scan, turn the screen brightness up. **Next match ▶** moves on.

### 4.3 Fields recorded (2026 game "REBUILT"; they change each season)

| Tab | Field (as shown) | Type | Notes |
|---|---|---|---|
| Auto | **No show** | toggle | "Robot never came onto the field" |
| Auto | **Starting position** | choice, required | In front of Hub / Left of Hub / Right of Hub |
| Auto | **Auto fuel scored** / **Auto fuel missed** | counters | |
| Auto | **Climbed in auto** | toggle | |
| Auto | **Dead in auto** | toggle | "On the field but didn't move" |
| Teleop | **Fuel scored** / **Fuel missed** | counters | |
| Teleop | **Picked up fuel from** | pick all that apply | Floor / Depot / Outpost |
| Teleop | **Broke down** | toggle | "Stopped working during the match" |
| Endgame | **Attempted climb** | toggle | turns on automatically if a climb level is chosen |
| Endgame | **Climb level reached** | choice, required | None / Level 1 / Level 2 / Level 3 |
| Wrap-up | **Primary role** | choice, required | Scorer / Feeder / Defense |
| Wrap-up | **Cycle speed** | 1–5, required | 1 = Very slow, 5 = Very fast |
| Wrap-up | **Notes** | text, max 200 characters | "What would a mentor want to know at alliance selection?" |

### 4.4 History and corrections
- **History (N)** on Home lists every record on this iPad (`ipad-08`).
  Tap one to see its QR code and all its values.
- **Correct this record** opens the form with the old answers. Submitting
  makes a new record that **replaces** the old one at the scan station. The
  original is still kept.

### 4.5 Lead menu (🔒 Lead on Home, PIN required; `ipad-09`)
- **Set team for this match:** override the team when the schedule is wrong.
- **Add a match by hand:** for matches missing from the schedule
  (qualification, playoff or final).
- **Jump to a match:** pick which match is up next.
- **Show all QR codes:** replays every record on the iPad, one by one, so
  the scan station can rebuild its data.
- **Re-scan config QR:** change event, station, PIN or roster.
- An info panel shows app version, event and station, record count,
  schedule, whether the app is installed, and whether storage is protected.

### 4.6 App updates
When a new version has been published and the iPad is online, Home shows
**"App update ready" → Update now**. It refuses while a match is
unfinished. Only update between matches.

---

## 5. Scan station (laptop)

Start: in the project folder, run `npm.cmd run station`. A browser opens
**http://localhost:1507**. Keep that terminal window open; closing it stops
the station. **After updating the code, restart the station.**

### 5.1 Tabs
- **Scan** (`station-02`, `station-03`):
  - A big result panel for every scan, with a beep:
    - **Green ✓:** saved (or "correction — replaces the earlier record")
    - **Blue:** "Already have it" (rescan, nothing new)
    - **Amber ⚠:** saved with a warning, e.g. **"Also scouted by ada —
      both kept"** or **"Schedule has team 195 at Blue 2, but this record
      is team 4242"**
    - **Red ✗ Rejected** with the reason
  - **Scanner box:** a USB barcode imager "types" into it. A **green dot**
    means it's ready; the box re-selects itself automatically.
  - **📷 Use webcam** scans continuously until closed.
  - Side panels: **Recent scans**, **Missing so far** (e.g. "Q2 B3"),
    record and scan counts, and **Dashboard sync** status (e.g. "✓ Synced
    2 min ago", "N records waiting", the Google account) with **⟳ Sync
    now** and **Open mentor dashboard ↗**.
- **Coverage** (`station-04`): **"Which scans are missing?"**
  - A grid of matches × Red 1–Blue 3, with a red count on the tab.
  - Cells: **✓ scanned** (green), **missing** (red dashed), **2+ scouts**
    (blue), **team mismatch** (amber).
  - A summary line to read out, e.g. "Missing 1 of 12 through Qual 2: Q2
    Blue 3".
  - **Played through** chooses how far to check; the default is the latest
    match scanned.
- **Records** (`station-05`): every current record, filterable by team; a
  **Scan log** including rejected scans and their reasons; **⬇ Export
  CSV** for spreadsheets or backup.
- **Event setup** (`station-01`):
  1. **Event:** event code (The Blue Alliance key, e.g. `2026nyro`), lead
     PIN for iPads (4–8 digits), scout roster (one per line: `id, Name` or
     just a name), and the TBA read key.
  2. **Schedule:** **Import from The Blue Alliance** (needs the tethered
     phone), or paste one, or **Make practice schedule**.
  3. **iPad codes:** **Show config codes** (six cards, one per station,
     printable) and **Show schedule codes** (an auto-advancing slideshow,
     Part 1 of N). Show the schedule again whenever it changes, e.g. when
     playoffs are set.
  4. **Dashboard sync:** set up automatically on the main laptop.

### 5.2 Rejection reasons a scan can show (and what to do)

| Message | Meaning / fix |
|---|---|
| **Checksum failed — garbled scan, try again** | Bad read. Rescan; turn the iPad's brightness up. |
| **Wrong event: record is for X, laptop is set to Y** | The iPad was set up for a different event. Re-scan its config code. |
| **Form version mismatch: iPad has vN, laptop expects vM. Update the iPad app.** | The iPad needs the app update (online → Update now). |
| **That's an iPad config/schedule code, not a match record** | Someone scanned a setup code. |
| **Not a match record QR code** | Not one of our codes. |
| **Set the event code on the Event setup screen first** | The station isn't set up yet. |

### 5.3 Backups and recovery
- The database backs itself up every 10 minutes to `data\backups\`
  (keeps 8 hours).
- If the laptop is lost: set up a new station, then on each iPad go to
  **Lead menu → Show all QR codes** and scan them all. Nothing is lost.

---

## 6. Mentor dashboard (pick list)

Screenshot: `dashboard-pick-list-phone.png` (phone width, sample data).

- **Access:** open the link and sign in with your **@warlocks1507.com**
  Google account. The scouting Sheet must be shared with you as **Editor**
  (that sharing *is* the access list). The first visit asks you to
  **authorize** the app once; it may say "unverified". That's normal for
  the team's own script.
- **Header:** event name, team count and **"Synced N min ago"**. It turns
  **red with "STALE"** after 10 minutes without a sync.
- **Our robot needs** (DRAFT): tap the gaps in our own robot (More
  scoring, Auto scoring, Reliable climber, Level 3 climber, Defender,
  Feeder). The **Fit** of each team is computed from these.
- **Filters:** Scoring (High/Mid/Low), Bot type (Scorer/Feeder/Defense/
  Hybrid), Strength (draft), Fit, Tag (Target/Backup/Avoid/Untagged).
- **Each team card:**
  - **Pick rank:** drag ⠿ or use ▲▼. It saves for everyone, and
    reordering is disabled while filters are on.
  - Team number and name.
  - Badges: **Scoring High/Mid/Low**, bot type, **Strength … (draft)**,
    **Fit … : reason** (e.g. "Fit High: L3 80%, defends 40%").
  - A stats line: fuel per match (auto), accuracy, best climb rate,
    matches scouted, and ⚠ reliability problems (no-show, broke, dead auto).
  - **Target / Backup / Avoid** tag buttons (the card edge turns
    green/blue/red).
  - A **Shared note** (all mentors see it, stamped "by name").
  - A **My private note** (only you see it in the dashboard).
  - **Scout notes (N)** expands the scouts' match notes.
- Team 1507 (us) is not shown, since we can't pick ourselves.
- The dashboard never changes scouting data.

**How the levels are computed (explain plainly):**
- **Scoring level:** teams are ranked by average fuel scored per match and
  split into thirds (High / Mid / Low).
- **Bot type:** the role scouts recorded most often; **Hybrid** if no
  role is more than 55%.
- **Strength (DRAFT):** scoring rank × reliability, split into thirds.
- **Fit (DRAFT):** how well the team covers the gaps ticked under "Our
  robot needs", scaled by reliability.
- Averages skip no-show matches. Two scouts on the same robot in the same
  match are averaged into one observation. Accuracy includes auto misses.

**Caveats to state in any mentor guide:**
- "Strength" and "Fit" are **drafts** pending a team decision on what they
  should mean.
- Private notes are hidden from other mentors in the dashboard, but anyone
  with access to the Google Sheet could see that tab.

---

## 7. Event-day runbook (for the scouting lead)

**Before the event (online, e.g. the night before):**
1. Laptop: `npm.cmd run station` → Event setup → enter the event code,
   PIN and roster → Save → **Import from The Blue Alliance**.
2. Each iPad: confirm it opens from the Home Screen. Scan its **config
   code** (by station), then the **schedule codes**.
3. Check the scan station's **Dashboard sync** panel shows "✓ Synced".

**At the event:**
1. Tether the phone to the laptop by USB (cellular data on, **no Wi-Fi
   hotspot**).
2. iPads in airplane mode. Scouts choose their name at the start of each
   shift.
3. After each match, scouts bring iPads to the station and scan their QR
   codes. Watch for green, and act on any red message.
4. Between matches, check **Coverage** and chase anything **missing** ("Q14
   Blue 2").
5. When playoffs are announced: re-import from TBA, then show the
   **schedule codes** to every iPad again.
6. Mentors watch the pick list. If it says **STALE**, check the phone
   tether and the station's sync panel.

**If something goes wrong:**

| Symptom | Fix |
|---|---|
| Station page says "Unknown API route" or looks broken after an update | Restart the station (Ctrl+C, then `npm.cmd run station`), then Ctrl+F5 |
| Sync: "Can't reach Google — is the phone tethered…" | Check the USB tether and cellular signal. Records wait and sync later. |
| Sync: "Google wants a sign-in — run npm run station:login" | Run `npm.cmd run station:login`, sign in with a warlocks1507.com account |
| iPad shows the wrong team | Lead menu → **Set team for this match** |
| A match is missing from the iPad's schedule | Lead menu → **Add a match by hand**, or re-show the schedule codes |
| iPad can't find its data / starts at setup | It was probably opened in a Safari tab, not from the Home Screen icon |
| "running scripts is disabled" in PowerShell | Use `npm.cmd` instead of `npm` |

---

## 8. Glossary

- **FRC:** FIRST Robotics Competition. **Alliance:** 3 robots (red or
  blue) per side.
- **Station:** one of the 6 robot positions: Red 1–3, Blue 1–3. Each iPad
  covers one station all event.
- **Qual / Playoff / Final:** match types. Keys: `qm12` = Qual 12,
  `sf3m1` = Playoff 3, `f1m2` = Final 2.
- **TBA:** The Blue Alliance, the public FRC data site; provides schedules
  and teams.
- **Alliance selection / pick list:** top teams choose partners for the
  playoffs; the pick list is our ranked list of who we'd choose.
- **Fuel / Hub / Depot / Outpost / climb levels:** 2026 game ("REBUILT")
  terms. Next season's game replaces them.
- **QR code:** the square barcode the iPad shows. **Imager:** a USB
  barcode scanner.
- **Superseded:** replaced by a newer correction; the old one is kept,
  not used.
- **Tether:** connecting the phone to the laptop by USB cable to share its
  cellular internet (not a Wi-Fi hotspot).

---

## 9. For student maintainers (technical guide material)

- **Code:** GitHub repo `csgitspace/1507-scout`. Plain HTML/JavaScript,
  no frameworks or build step. Node.js 24, no npm dependencies.
- **Folders:** `scout-app/` (iPad app), `laptop/` (scan station),
  `dashboard/` (Google Apps Script), `shared/` (the field list and record
  format used by every part), `docs/` (plans, legacy audit), `legacy/`
  (old v3 code, reference only), `tests/`.
- **Changing what scouts record (each new game):**
  1. Edit **`shared/fields.js`**, the only place fields are defined. The
     iPad form, the QR format, the laptop and the dashboard all come from
     it.
  2. Bump `SCHEMA_VERSION` there and `APP_VERSION` in
     `scout-app/version.js`.
  3. Update the summary math in `dashboard/common/Summary.js` (marked
     FIELD-DEPENDENT).
  4. Run `npm test`.
  5. Push to publish the iPad app; run `npm.cmd run dashboard:push` for
     the dashboard.

  First check that each field traces to a real decision (the team's
  "begin with the end" table).
- **Commands:**
  - `npm test`: about 50 automated tests, including encoding a real QR
    image and decoding it again
  - `npm.cmd run station`: start the scan station
  - `npm.cmd run station:login`: sign the laptop in to Google
  - `npm.cmd run dashboard:push`: publish the dashboard
  - `npm.cmd run serve`: local test server
- **Publishing the iPad app:** pushing to GitHub runs the tests and
  publishes to GitHub Pages automatically.
- **Testing approach worth showcasing:**
  - automated tests for every scan outcome
  - a fake Google Sheets used to test the dashboard code offline
  - end-to-end browser tests that scout 20 matches through the real app
- **Security and safety:**
  - The secret sync token, Google sign-in and database live only in the
    laptop's `data\` folder (never in GitHub).
  - Scout or mentor text can't become a spreadsheet formula.
  - The database itself refuses edits and deletions of scouting data.

---

## 10. Status and open questions (be honest about these in presentations)

**Working and tested on real hardware (October 2026):**
- offline iPads and QR codes
- the scan station with webcam
- TBA import
- coverage
- sync to the live dashboard

**Not yet decided or tested:**
- Which USB imager to buy. Imagers that "type" codes can garble emoji or
  accented letters in notes, so pick one with a Unicode/serial mode, or
  limit notes to plain characters.
- Definitions of **Strength**, **Fit** and a **Support** bot type (the
  scouting leads' call).
- Pit scouting and robot photos (not in this version).
- Confirming FRC rule E301 for this season (ask the event FTA about USB
  tethering).
- Still to come (Milestone 4): automatic periodic TBA results, and the
  dashboard screens **Next match** (six-team brief) and **Data health**.

---

## 11. Suggested deliverables

1. **Scout quick card** (1 page, printable, big text): set your name →
   Start scouting → four tabs → Submit → show the QR code. Include the
   "required" and "restored" behaviors.
2. **Scouting lead runbook:** setup, event day, Coverage, troubleshooting
   (sections 4.1, 5, 7).
3. **Mentor pick-list guide** (1–2 pages, phone screenshots): signing in,
   filters, tags, ranking, notes, what the levels mean, the draft caveats.
4. **Student maintainer guide:** section 9 expanded.
5. **Presentation: "How Warlocks scouting works"** for team and mentors,
   about 10–12 slides:
   - the problem with v3
   - "begin with the end"
   - the system diagram (iPad → QR → laptop → cellular → dashboard)
   - offline-first and E301
   - a day at the event
   - the pick list
   - data you can trust (no silent defaults, checksums, corrections)
   - what's next
6. Optional **judges/awards version:** the engineering-design story
   (requirements from decisions, offline constraint, testing, student
   ownership).
