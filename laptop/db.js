// ==============================================================================
// Scan station database (SQLite, built into Node 24 — nothing to install).
//
// The rule from CLAUDE.md, enforced by the database itself: scouting data is
// never edited or deleted, only superseded. `scans` and `records` have
// triggers that refuse UPDATE and DELETE. A correction from an iPad is a newer
// row with the same match + team + scout; `current_records` shows the newest.
// ==============================================================================

import { DatabaseSync } from 'node:sqlite';
import { recordKey } from '../shared/codec.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Every scan attempt, accepted or not: the audit trail.
CREATE TABLE IF NOT EXISTS scans (
  id          INTEGER PRIMARY KEY,
  scanned_at  INTEGER NOT NULL,          -- unix ms
  raw         TEXT    NOT NULL,          -- exactly what the scanner read
  source      TEXT,                      -- 'imager' | 'webcam' | 'manual'
  accepted    INTEGER NOT NULL,          -- 1 / 0
  outcome     TEXT    NOT NULL,          -- new | replaces | rescan | older | rejected
  reason      TEXT,                      -- why it was rejected, or a warning
  record_id   INTEGER REFERENCES records(id)
);

-- Every distinct accepted record. The same QR text twice is stored once.
CREATE TABLE IF NOT EXISTS records (
  id             INTEGER PRIMARY KEY,
  qr             TEXT    NOT NULL UNIQUE,
  event          TEXT    NOT NULL,
  rkey           TEXT    NOT NULL,       -- match|team|scout (shared/codec.js recordKey)
  match_key      TEXT    NOT NULL,
  team           INTEGER NOT NULL,
  scout_id       TEXT    NOT NULL,
  station        TEXT    NOT NULL,
  ts             INTEGER NOT NULL,       -- unix seconds, from the iPad
  app_version    TEXT,
  schema_version INTEGER NOT NULL,
  values_json    TEXT    NOT NULL,
  received_at    INTEGER NOT NULL        -- unix ms, laptop clock
);
CREATE INDEX IF NOT EXISTS records_key   ON records (event, rkey);
CREATE INDEX IF NOT EXISTS records_match ON records (event, match_key);

CREATE TRIGGER IF NOT EXISTS scans_no_update   BEFORE UPDATE ON scans   BEGIN SELECT RAISE(ABORT, 'scans are append-only'); END;
CREATE TRIGGER IF NOT EXISTS scans_no_delete   BEFORE DELETE ON scans   BEGIN SELECT RAISE(ABORT, 'scans are append-only'); END;
CREATE TRIGGER IF NOT EXISTS records_no_update BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT, 'records are append-only'); END;
CREATE TRIGGER IF NOT EXISTS records_no_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT, 'records are append-only'); END;

-- Newest version of each match+team+scout (ties broken by arrival order).
CREATE VIEW IF NOT EXISTS current_records AS
  SELECT r.* FROM records r
  WHERE NOT EXISTS (
    SELECT 1 FROM records n
    WHERE n.event = r.event AND n.rkey = r.rkey
      AND (n.ts > r.ts OR (n.ts = r.ts AND n.id > r.id)));

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS schedule (
  event TEXT NOT NULL, match_key TEXT NOT NULL,
  r1 INTEGER, r2 INTEGER, r3 INTEGER, b1 INTEGER, b2 INTEGER, b3 INTEGER,
  PRIMARY KEY (event, match_key)
);

CREATE TABLE IF NOT EXISTS teams (
  event TEXT NOT NULL, team INTEGER NOT NULL, name TEXT,
  PRIMARY KEY (event, team)
);
`;

function rowToRecord(row) {
  if (!row) return null;
  const { values_json, ...rest } = row;
  return { ...rest, values: JSON.parse(values_json) };
}

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);

  const q = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    insertScan: db.prepare(`INSERT INTO scans (scanned_at, raw, source, accepted, outcome, reason, record_id)
                            VALUES (?, ?, ?, ?, ?, ?, ?)`),
    recordByQr: db.prepare('SELECT * FROM records WHERE qr = ?'),
    insertRecord: db.prepare(`INSERT INTO records (qr, event, rkey, match_key, team, scout_id, station, ts,
                              app_version, schema_version, values_json, received_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    currentFor: db.prepare('SELECT * FROM current_records WHERE event = ? AND rkey = ?'),
    currentAll: db.prepare('SELECT * FROM current_records WHERE event = ? ORDER BY received_at DESC, id DESC'),
    otherScouts: db.prepare(`SELECT * FROM current_records
                             WHERE event = ? AND match_key = ? AND team = ? AND scout_id <> ?`),
    recentScans: db.prepare(`SELECT s.*, r.match_key, r.team, r.station, r.scout_id
                             FROM scans s LEFT JOIN records r ON r.id = s.record_id
                             ORDER BY s.id DESC LIMIT ?`),
    counts: db.prepare(`SELECT
                          (SELECT COUNT(*) FROM scans) AS scans,
                          (SELECT COUNT(*) FROM scans WHERE accepted = 0) AS rejected,
                          (SELECT COUNT(*) FROM records WHERE event = ?) AS records,
                          (SELECT COUNT(*) FROM current_records WHERE event = ?) AS current`),
    deleteSchedule: db.prepare('DELETE FROM schedule WHERE event = ?'),
    insertMatch: db.prepare('INSERT INTO schedule (event, match_key, r1, r2, r3, b1, b2, b3) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    schedule: db.prepare('SELECT * FROM schedule WHERE event = ?'),
    deleteTeams: db.prepare('DELETE FROM teams WHERE event = ?'),
    insertTeam: db.prepare('INSERT INTO teams (event, team, name) VALUES (?, ?, ?)'),
    teams: db.prepare('SELECT team, name FROM teams WHERE event = ? ORDER BY team'),
  };

  const transaction = (fn) => {
    db.exec('BEGIN');
    try { const out = fn(); db.exec('COMMIT'); return out; } catch (err) { db.exec('ROLLBACK'); throw err; }
  };

  return {
    /** Settings are stored as JSON so arrays/objects round-trip. */
    getSetting(key, fallback = null) {
      const row = q.getSetting.get(key);
      return row ? JSON.parse(row.value) : fallback;
    },
    setSetting(key, value) { q.setSetting.run(key, JSON.stringify(value)); },

    insertScan({ scannedAt, raw, source, accepted, outcome, reason = null, recordId = null }) {
      return Number(q.insertScan.run(scannedAt, raw, source, accepted ? 1 : 0, outcome, reason, recordId).lastInsertRowid);
    },

    recordByQr(qr) { return rowToRecord(q.recordByQr.get(qr)); },

    /** rec: a decoded record from shared/codec.js decodeRecord. Returns the new row id. */
    insertRecord(rec, qr, receivedAt) {
      return Number(q.insertRecord.run(qr, rec.event, recordKey(rec), rec.match_key, rec.team, rec.scout_id,
        rec.station, rec.ts, rec.app_version, rec.schema_version, JSON.stringify(rec.values), receivedAt).lastInsertRowid);
    },

    currentFor(event, rkey) { return rowToRecord(q.currentFor.get(event, rkey)); },
    currentRecords(event) { return q.currentAll.all(event).map(rowToRecord); },
    otherScouts(event, matchKey, team, scoutId) { return q.otherScouts.all(event, matchKey, team, scoutId).map(rowToRecord); },
    recentScans(limit = 20) { return q.recentScans.all(limit); },
    counts(event) { return q.counts.get(event, event); },

    /** matches: [{ key, teams: [6] }] — replaces the whole schedule for that event. */
    replaceSchedule(event, matches) {
      transaction(() => {
        q.deleteSchedule.run(event);
        for (const m of matches) q.insertMatch.run(event, m.key, ...m.teams);
      });
    },
    /** { matchKey: [r1, r2, r3, b1, b2, b3] } */
    schedule(event) {
      const out = {};
      for (const r of q.schedule.all(event)) out[r.match_key] = [r.r1, r.r2, r.r3, r.b1, r.b2, r.b3];
      return out;
    },

    replaceTeams(event, teams) {
      transaction(() => {
        q.deleteTeams.run(event);
        for (const t of teams) q.insertTeam.run(event, t.team, t.name || null);
      });
    },
    teams(event) { return q.teams.all(event); },

    transaction,
    /** Consistent copy of the whole database to another file (safe while running). */
    backupTo(path) { db.prepare('VACUUM INTO ?').run(path); },
    close() { db.close(); },
  };
}
