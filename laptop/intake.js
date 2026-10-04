// ==============================================================================
// One scan in, one clear answer out.
//
// ingest(store, text) decodes the QR text with the same code the iPad used to
// make it, stores it, and says what happened:
//   new        first record for this match + team + scout
//   replaces   a correction: newer than the record we had
//   older      a valid record, but we already have a newer version (kept anyway)
//   rescan     exact same code scanned again: nothing new
//   rejected   not stored as a record; `reason` says why (in words a scout understands)
// Every attempt, rejected or not, is logged in `scans`.
// ==============================================================================

import { decodeRecord, identifyCode, recordKey } from '../shared/codec.js';
import { teamFor, matchLabel, stationLabel } from '../shared/schedule.js';

export function ingest(store, text, { source = 'manual', now = Date.now() } = {}) {
  const raw = String(text ?? '').trim();
  const event = store.getSetting('event');

  const reject = (reason) => {
    store.insertScan({ scannedAt: now, raw, source, accepted: false, outcome: 'rejected', reason });
    return { accepted: false, outcome: 'rejected', reason };
  };

  if (!raw) return reject('Empty scan');
  if (!event) return reject('Set the event code on the Event setup screen first');
  const kind = identifyCode(raw);
  if (kind === 'config' || kind === 'schedule') return reject(`That's an iPad ${kind} code, not a match record`);

  const res = decodeRecord(raw, { event });
  if (!res.ok) return reject(res.reason);
  const rec = res.record;

  return store.transaction(() => {
    const existing = store.recordByQr(raw);
    if (existing) {
      store.insertScan({ scannedAt: now, raw, source, accepted: true, outcome: 'rescan', recordId: existing.id });
      return { accepted: true, outcome: 'rescan', record: existing, warnings: [] };
    }

    const current = store.currentFor(event, recordKey(rec));
    const id = store.insertRecord(rec, raw, now);
    const outcome = !current ? 'new' : current.ts > rec.ts ? 'older' : 'replaces';

    const warnings = [];
    const schedule = store.schedule(event);
    if (Object.keys(schedule).length) {
      const expected = teamFor(schedule, rec.match_key, rec.station);
      if (!schedule[rec.match_key]) warnings.push(`${matchLabel(rec.match_key)} isn't in the schedule`);
      else if (expected !== rec.team) {
        warnings.push(`Schedule has team ${expected} at ${stationLabel(rec.station)}, but this record is team ${rec.team}`);
      }
    }
    const others = store.otherScouts(event, rec.match_key, rec.team, rec.scout_id);
    if (others.length) warnings.push(`Also scouted by ${others.map(o => o.scout_id).join(', ')} — both kept`);

    store.insertScan({
      scannedAt: now, raw, source, accepted: true, outcome,
      reason: warnings.join('; ') || null, recordId: id,
    });
    return { accepted: true, outcome, record: { ...rec, id }, warnings };
  });
}
