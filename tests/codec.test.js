import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { FIELDS, SCHEMA_VERSION, emptyValues, missingRequired } from '../shared/fields.js';
import { encodeRecord, decodeRecord, crc32, recordKey } from '../shared/codec.js';

const require = createRequire(import.meta.url);
const qrcode = require('../scout-app/vendor/qrcode.js');
const jsQR = require('../scout-app/vendor/jsQR.js');
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

function sampleRecord(overrides = {}) {
  const values = emptyValues();
  Object.assign(values, {
    auto_start_position: 1, auto_fuel_scored: 7, auto_fuel_missed: 2, auto_climb: true,
    teleop_fuel_scored: 143, teleop_fuel_missed: 31, pickup_sources: 0b101, broke_down: false,
    endgame_attempt: true, endgame_level: 2, primary_role: 0, cycle_speed: 4,
    notes: 'Fast cycles, weak defense',
  });
  return {
    app_version: '1.0.0', event: '2026nyro', match_key: 'qm12', team: 1507,
    scout_id: 's07', station: 'R2', ts: 1790000000, values, ...overrides,
  };
}

/** Render a QR string to RGBA pixels and decode it with jsQR — the same path a camera scan takes. */
function scanRoundTrip(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const scale = 4, quiet = 4, n = qr.getModuleCount(), size = (n + quiet * 2) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c)) continue;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }
  return { text: jsQR(px, size, size)?.data, version: (n - 17) / 4 };
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32('123456789'), 'cbf43926');
});

test('record round-trips through encode/decode', () => {
  const rec = sampleRecord();
  const res = decodeRecord(encodeRecord(rec));
  assert.equal(res.ok, true, res.reason);
  assert.deepEqual(res.record.values, rec.values);
  assert.equal(res.record.team, 1507);
  assert.equal(res.record.station, 'R2');
  assert.equal(res.record.schema_version, SCHEMA_VERSION);
});

test('unanswered enums and ratings survive as null', () => {
  const rec = sampleRecord({ values: { ...emptyValues(), no_show: true } });
  const res = decodeRecord(encodeRecord(rec));
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.record.values.primary_role, null);
  assert.equal(res.record.values.cycle_speed, null);
  assert.equal(res.record.values.no_show, true);
});

test('a single flipped character fails the checksum', () => {
  const text = encodeRecord(sampleRecord());
  const garbled = text.replace('|143|', '|148|');
  assert.notEqual(garbled, text);
  const res = decodeRecord(garbled);
  assert.equal(res.ok, false);
  assert.match(res.reason, /Checksum/);
});

test('a different schema version is rejected with a clear reason', () => {
  const text = encodeRecord(sampleRecord());
  const parts = text.split('|');
  parts[2] = String(SCHEMA_VERSION + 1);
  const body = parts.slice(0, -1).join('|');
  const res = decodeRecord(`${body}|${crc32(body)}`);
  assert.equal(res.ok, false);
  assert.match(res.reason, /version mismatch/i);
});

test('wrong event is rejected when the laptop specifies one', () => {
  const res = decodeRecord(encodeRecord(sampleRecord()), { event: '2026paca' });
  assert.equal(res.ok, false);
  assert.match(res.reason, /Wrong event/);
});

test('pipes and newlines in notes cannot break the frame', () => {
  const rec = sampleRecord();
  rec.values.notes = 'tipped | over\nin auto';
  const res = decodeRecord(encodeRecord(rec));
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.record.values.notes, 'tipped / over in auto');
});

test('notes are capped at maxLength', () => {
  const rec = sampleRecord();
  rec.values.notes = 'x'.repeat(500);
  const res = decodeRecord(encodeRecord(rec));
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.record.values.notes.length, FIELDS.find(f => f.key === 'notes').maxLength);
});

test('playoff records keep their set number (legacy Issue 1)', () => {
  const a = decodeRecord(encodeRecord(sampleRecord({ match_key: 'sf3m1' }))).record;
  const b = decodeRecord(encodeRecord(sampleRecord({ match_key: 'sf3m2' }))).record;
  const c = decodeRecord(encodeRecord(sampleRecord({ match_key: 'sf4m1' }))).record;
  assert.equal(new Set([a, b, c].map(recordKey)).size, 3);
});

test('record key includes the scout, so two scouts on one robot are both kept', () => {
  assert.notEqual(recordKey(sampleRecord({ scout_id: 's01' })), recordKey(sampleRecord({ scout_id: 's02' })));
  assert.equal(recordKey(sampleRecord({ ts: 1 })), recordKey(sampleRecord({ ts: 2 })));
});

test('size budget: worst-case record stays small enough to scan easily', () => {
  const rec = sampleRecord({ match_key: 'sf13m2', team: 99999, scout_id: 'abcdefghijkl', event: '2026abcdefghijkl' });
  rec.values.notes = 'x'.repeat(200);
  const bytes = new TextEncoder().encode(encodeRecord(rec)).length;
  const typical = new TextEncoder().encode(encodeRecord(sampleRecord())).length;
  console.log(`  record size: typical ${typical} bytes, worst case ${bytes} bytes`);
  assert.ok(bytes <= 350, `worst-case record is ${bytes} bytes`);
});

test('a real QR image of a record decodes back to the identical record', () => {
  const rec = sampleRecord();
  rec.values.notes = 'Great driver 👍 — fast intake, café';
  const text = encodeRecord(rec);
  const scanned = scanRoundTrip(text);
  console.log(`  typical record QR: version ${scanned.version}`);
  assert.equal(scanned.text, text);
  assert.deepEqual(decodeRecord(scanned.text).record.values, rec.values);
});

test('missingRequired: blocks submit until answered, waived for no-shows', () => {
  const v = emptyValues();
  assert.deepEqual(missingRequired(v).map(f => f.key),
    ['auto_start_position', 'endgame_level', 'primary_role', 'cycle_speed']);
  assert.deepEqual(missingRequired({ ...v, no_show: true }), []);
  assert.deepEqual(missingRequired({ ...v, dead_in_auto: true }).map(f => f.key), ['auto_start_position']);
});
