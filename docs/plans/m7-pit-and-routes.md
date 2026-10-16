# Milestone 7 — Pit scouting mode, trench/bump routes, best auto

## Status: built and tested (2026-10-15), for Rah Cha Cha Ruckus (Sat 2026-10-17)

- `npm test`: 89 pass (11 new).
- Browser checks:
  - **iPad app at iPad size:** pit setup → team list → form (required
    questions flagged) → QR → ✓ on the list. The pit QR and a v2 match
    QR both decode with the laptop's decoder.
  - **Scan station:** run on a copy of the real station database (the
    `pit_id` upgrade ran; old data kept). A pit scan typed in the way an
    imager does it, the Pit scouting panel, and 7 config cards.
  - **Pick list cards and compare at phone width:** trench and shooter
    badges, best auto, pit details.

## What

1. **Match form: "Drove through"** (Teleop tab, pick all that apply):
   *Under the trench* / *Over the bump*. `SCHEMA_VERSION` 1 → 2, so
   **every iPad must take the app update** before the event. The laptop
   rejects v1 records with "Update the iPad app".
2. **Pit scouting mode**
   - The scan station shows a 7th config card, **Pit scout**. An iPad
     that scans it becomes a pit iPad.
   - The pit iPad shows the event's team list (carried in the config QR)
     with ✓ for teams it has done, plus *Other team…* for anyone missing.
   - Scout taps a team → three-tab pit form → Submit → QR code, exactly
     like a match record. Records stay on the iPad. A correction replaces
     the earlier record from the same team + scout.
   - Pit questions:
     - drivetrain
     - fits under the trench / drives over the bump
     - hopper capacity
     - shooter type (Fixed / Adjustable hood / Turret / No shooter),
       number of shooters, shoots while moving
     - auto start positions they can run, fuel in their best auto, climbs
       in auto, their autos (short text)
     - highest climb (claimed)
     - notes
3. **Scan station**
   - accepts pit codes
   - **Pit scouting** panel on Coverage: which teams are done, which
     aren't
   - pit CSV export
   - sends pit records with each sync
4. **Dashboard (pick list, Next match, Analyze compare)**
   - **Trench** badge, scouting backed by pit:
     - `Trench ✓ (seen 3/5)` when scouts saw it go under
     - `Trench (pit says)` when only the pit claims it
     - `Bump only` when the pit says no, or scouts only ever saw the bump
   - **Shooter** badge, e.g. `Turret ×2 · shoots moving`
   - **Best auto**, worked out from match data: the start position with
     the most auto fuel, e.g. "Best auto: Left of Hub, 7.5 fuel, climbs
     50% (4 runs)". Shown next to the pit's claimed autos.
   - Pit details on each card (tap to open).
   - **Trench** filter (Trench bot / Bump only), and **Trench bot** under
     "Our robot needs" (drives Fit).
   - Compare table: trench, shooter, drivetrain, best auto, hopper,
     claimed climb.

## Why (decisions these support; see docs/data-requirements.md)

| Data | Decision |
|---|---|
| Trench vs bump | Field routes for our alliance's strategy; whether a partner can follow our path or blocks it; which defenders can reach us |
| Shooter type / shoots moving | Who keeps scoring under defense (turret, on the move) vs. who needs a protected spot |
| Auto start + best auto | Partners can't all start in the same place: pick partners whose best auto doesn't collide with ours, and plan the match's autos |
| Hopper, drivetrain, claimed climb | Cycle capacity, pushing and agility, and a climb claim to check against what scouts see |

## How

- `shared/fields.js`:
  - `route_used` (multi) is added to `FIELDS`.
  - New `PIT_PHASES` / `PIT_FIELDS` / `PIT_SCHEMA_VERSION` use the same
    field types, so the same form code renders both.
  - `emptyValues` / `missingRequired` take a field list.
- `shared/codec.js`: pit frame
  `WP|app|pit_schema|event|team|scout|ts|values…|crc32`, tag `pit`, key
  `pit|team|scout`.
- `shared/setup-codes.js`: config station `PIT`, with the event's team
  numbers as an extra part.
- Laptop:
  - `pit_records` table (append-only, with the same refuse-edit triggers)
    and `current_pit` view
  - `scans.pit_id` (added to existing databases on start)
  - `pit_sync_log`, `/api/pit`, `/api/pit.csv`
- Sync endpoint: `Pit` tab, which keeps every version and is protected.
  The dashboard reads the newest pit record per team.
- `Summary`: `route_n`, `trench_rate`, `bump_rate`, `auto_starts_json`,
  appended at the end of the columns.

## Tested by

- `npm test`:
  - pit codec round-trip and rejections
  - PIT config
  - station intake (new / correction / rescan / unknown team), the
    edit-refusing triggers
  - pit coverage and CSV
  - sync of pit records end to end into the Sheet
  - summary route rates and best auto
  - dashboard trench status and pit display
- Browser check:
  - the iPad app in pit mode (setup → team list → form → QR) and a match
    form with the new field, at iPad size
  - the station's Pit panel
  - pick-list cards and compare with pit data

## Event-day impact

- Friday night: every iPad opens online and taps **Update now**
  (v1.1.0), then rescans its config code. The pit iPad scans **Pit
  scout**.
- Restart the scan station after pulling the update.
