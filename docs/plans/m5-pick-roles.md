# Pick roles: official list vs My list

## Status: built and tested locally (2026-10-15), not yet deployed

## What
- The dashboard is for the **pick team**: mentors **and student leads**. The
  wording no longer says "mentors" only.
- **Pick leads** are the emails on the Sheet's `Leads` tab. They change the
  **official list**: pick order, Target/Backup/Avoid tags, shared notes, and
  "Our robot needs" (which drives everyone's Fit).
- **Everyone else** sees the official list read-only, and gets **My list**:
  their own order and tags in the `MyPicks` tab, which only they see.
  - "Start from the official list" copies the official list into theirs.
  - "Clear my list" empties theirs.
  - Private notes work in both lists.
- While `Leads` is empty, everyone counts as a lead, so the pre-roles
  behavior still works. The page warns about this.

## Why
Chris: students and mentors who want to experiment with their own pick list
shouldn't "dirty" the official one.

## How
- **Login** is the Google sign-in the dashboard already uses. The web app
  runs as the viewer, so `Session.getActiveUser()` is who they are.
- `Leads` is created and protected (owner only) by the sync endpoint, which
  runs as the team account. Only that account can change who is a lead.
- `saveTag`, `saveSharedNote`, `saveRanking` and `saveGaps` call
  `requireLead_()`. My list uses `saveMyTag`, `saveMyRanking`,
  `copyOfficialToMine` and `clearMyList`. Each of these rewrites only the
  signed-in person's rows.
- The sync never touches `MyPicks` or `Leads`.

## Known limit
Pick-team members have Editor access to the Sheet (they need it to save
notes), so someone could still edit the `Mentor` tab directly in Google
Sheets. The roles stop accidental changes made in the dashboard, not
deliberate edits to the Sheet.

Possible later fix: have the sync endpoint protect `Mentor` so only the team
account and the leads can edit it. Not done yet. If it went wrong it could
lock the leads out on event day, so it needs a careful test first.

## Tests
`tests/roles.test.js`:
- the `Leads` tab is created and protected
- open mode while no leads are listed
- leads-only edits, with email case ignored
- one person's My list never touches anyone else's list or the official list
- copy and clear
- the sync leaves `MyPicks` and `Leads` alone
