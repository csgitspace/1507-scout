import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { openDb } from '../laptop/db.js';
import { ingest } from '../laptop/intake.js';
import { coverage } from '../laptop/coverage.js';
import { parseTbaMatches, parseTbaTeams, importEvent } from '../laptop/tba.js';
import { createHandler } from '../laptop/api.js';
import { encodeRecord, encodePitRecord, crc32 } from '../shared/codec.js';
import { emptyValues, PIT_FIELDS } from '../shared/fields.js';
import { decodeConfig, decodeSchedulePart } from '../shared/setup-codes.js';

const EVENT = '2026test';
const SCHEDULE = [
  { key: 'qm1', teams: [1507, 254, 1114, 118, 2056, 33] },
  { key: 'qm2', teams: [67, 148, 195, 971, 3476, 4414] },
  { key: 'qm3', teams: [1507, 67, 254, 148, 1114, 195] },
];

function freshStore() {
  const store = openDb(':memory:');
  store.setSetting('event', EVENT);
  store.replaceSchedule(EVENT, SCHEDULE);
  return store;
}

function qr({ match = 'qm1', team = 1507, scout = 'ada', station = 'R1', ts = 1790000000, event = EVENT, values = {} } = {}) {
  return encodeRecord({
    app_version: '1.0.1', event, match_key: match, team, scout_id: scout, station, ts,
    values: { ...emptyValues(), auto_start_position: 0, endgame_level: 1, primary_role: 0, cycle_speed: 3, ...values },
  });
}

test('a new record is accepted and stored', () => {
  const store = freshStore();
  const r = ingest(store, qr());
  assert.equal(r.accepted, true);
  assert.equal(r.outcome, 'new');
  assert.deepEqual(r.warnings, []);
  assert.equal(store.currentRecords(EVENT).length, 1);
});

test('scanning the same code twice stores it once', () => {
  const store = freshStore();
  ingest(store, qr());
  const again = ingest(store, qr());
  assert.equal(again.outcome, 'rescan');
  assert.equal(store.counts(EVENT).records, 1);
  assert.equal(store.counts(EVENT).scans, 2);
});

test('a correction (same match+team+scout, newer) replaces; an older copy is kept but not current', () => {
  const store = freshStore();
  ingest(store, qr({ ts: 1790000000, values: { teleop_fuel_scored: 10 } }));
  const fix = ingest(store, qr({ ts: 1790000500, values: { teleop_fuel_scored: 25 } }));
  assert.equal(fix.outcome, 'replaces');
  const stale = ingest(store, qr({ ts: 1790000100, values: { teleop_fuel_scored: 12 } }));
  assert.equal(stale.outcome, 'older');
  const current = store.currentRecords(EVENT);
  assert.equal(current.length, 1);
  assert.equal(current[0].values.teleop_fuel_scored, 25);
  assert.equal(store.counts(EVENT).records, 3, 'every version is kept');
});

test('two scouts on the same robot are both kept, with a warning', () => {
  const store = freshStore();
  ingest(store, qr({ scout: 'ada' }));
  const second = ingest(store, qr({ scout: 'sam' }));
  assert.equal(second.outcome, 'new');
  assert.match(second.warnings.join(), /Also scouted by ada/);
  assert.equal(store.currentRecords(EVENT).length, 2);
});

test('rejections are logged with a reason a scout can act on', () => {
  const store = freshStore();
  const text = qr();
  const garbled = text.slice(0, 20) + (text[20] === '1' ? '2' : '1') + text.slice(21);
  assert.match(ingest(store, garbled).reason, /Checksum/);
  assert.match(ingest(store, qr({ event: '2026othr' })).reason, /Wrong event/);
  assert.match(ingest(store, 'hello world').reason, /Not a match record/);
  assert.match(ingest(store, 'WCFG|1|2026test|R1|1507|ada:Ada|' + crc32('WCFG|1|2026test|R1|1507|ada:Ada')).reason, /config code/);
  const parts = text.split('|'); parts[2] = '99';
  const body = parts.slice(0, -1).join('|');
  assert.match(ingest(store, `${body}|${crc32(body)}`).reason, /version mismatch/i);
  assert.equal(store.counts(EVENT).records, 0);
  assert.equal(store.counts(EVENT).rejected, 5);
});

test('no event configured -> rejected, not stored', () => {
  const store = openDb(':memory:');
  assert.match(ingest(store, qr()).reason, /event code/);
});

test('team that disagrees with the schedule is accepted but flagged', () => {
  const store = freshStore();
  const r = ingest(store, qr({ team: 9999, station: 'R1' }));
  assert.equal(r.accepted, true);
  assert.match(r.warnings.join(), /Schedule has team 1507/);
  const off = ingest(store, qr({ match: 'qm40', scout: 'sam' }));
  assert.match(off.warnings.join(), /isn't in the schedule/);
});

test('the database itself refuses to edit or delete scouting data', () => {
  // Use a real file so a second, raw connection can try to tamper with it.
  const dir = mkdtempSync(join(tmpdir(), 'scout-test-'));
  const file = join(dir, 'scout.sqlite');
  const store = openDb(file);
  store.setSetting('event', EVENT);
  ingest(store, qr());
  store.close();
  const raw = new DatabaseSync(file);
  try {
    assert.throws(() => raw.exec('UPDATE records SET team = 1'), /append-only/);
    assert.throws(() => raw.exec('DELETE FROM records'), /append-only/);
    assert.throws(() => raw.exec('DELETE FROM scans'), /append-only/);
  } finally {
    raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('coverage: missing, ok, multi and mismatch cells up to the latest scanned match', () => {
  const store = freshStore();
  ingest(store, qr({ match: 'qm1', team: 1507, station: 'R1', scout: 'ada' }));
  ingest(store, qr({ match: 'qm1', team: 1507, station: 'R1', scout: 'sam' }));
  ingest(store, qr({ match: 'qm1', team: 254, station: 'R2', scout: 'ben' }));
  ingest(store, qr({ match: 'qm2', team: 1234, station: 'B3', scout: 'cy' }));
  const cov = coverage(store.schedule(EVENT), store.currentRecords(EVENT));
  assert.equal(cov.playedThrough, 'qm2');
  assert.equal(cov.rows.length, 2, 'qm3 not played yet, so not shown');
  const q1 = Object.fromEntries(cov.rows[0].cells.map(c => [c.station, c.status]));
  assert.deepEqual(q1, { R1: 'multi', R2: 'ok', R3: 'missing', B1: 'missing', B2: 'missing', B3: 'missing' });
  assert.equal(cov.rows[1].cells[5].status, 'mismatch');
  assert.equal(cov.totals.missing, 9);
  assert.deepEqual(cov.missing[0], { key: 'qm1', label: 'Qual 1', station: 'R3', team: 1114 });
});

test('coverage: an explicit "played through" marker shows unscanned later matches as missing', () => {
  const store = freshStore();
  ingest(store, qr());
  const cov = coverage(store.schedule(EVENT), store.currentRecords(EVENT), { playedThrough: 'qm3' });
  assert.equal(cov.rows.length, 3);
  assert.equal(cov.totals.missing, 17);
});

const TBA_MATCHES = [
  { key: '2026test_qm2', alliances: { red: { team_keys: ['frc67', 'frc148', 'frc195'] }, blue: { team_keys: ['frc971', 'frc3476', 'frc4414'] } } },
  { key: '2026test_sf3m1', alliances: { red: { team_keys: ['frc1507', 'frc254', 'frc1114B'] }, blue: { team_keys: ['frc118', 'frc2056', 'frc33'] } } },
  { key: '2026test_f1m1', alliances: { red: { team_keys: [] }, blue: { team_keys: [] } } },
];

test('TBA schedule parsing keeps playoff set numbers and skips unfilled matches', () => {
  assert.deepEqual(parseTbaMatches(TBA_MATCHES), [
    { key: 'qm2', teams: [67, 148, 195, 971, 3476, 4414] },
    { key: 'sf3m1', teams: [1507, 254, 1114, 118, 2056, 33] },
  ]);
  assert.deepEqual(parseTbaTeams([{ team_number: 1507, nickname: 'Warlocks' }]), [{ team: 1507, name: 'Warlocks' }]);
});

test('TBA import sends the key and reports a bad key clearly', async () => {
  const seen = [];
  const fakeFetch = async (url, opts) => {
    seen.push(opts.headers['X-TBA-Auth-Key']);
    const body = url.endsWith('/simple') && !url.includes('matches') && !url.includes('teams') ? { name: 'Test Regional' }
      : url.includes('matches') ? TBA_MATCHES : [{ team_number: 1507, nickname: 'Warlocks' }];
    return { ok: true, status: 200, json: async () => body };
  };
  const data = await importEvent(EVENT, 'k123', fakeFetch);
  assert.equal(data.name, 'Test Regional');
  assert.equal(data.matches.length, 2);
  assert.deepEqual([...new Set(seen)], ['k123']);
  await assert.rejects(importEvent(EVENT, 'bad', async () => ({ ok: false, status: 401 })), /rejected the API key/);
});

test('HTTP API: settings -> schedule -> scan -> coverage -> codes -> CSV', async () => {
  const store = openDb(':memory:');
  const server = createServer(createHandler({ store }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', body: JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json() }));
  try {
    assert.equal((await post('/api/settings', { event: 'BAD CODE', pin: '1507', roster: 'Ada' })).status, 400);
    const s = await post('/api/settings', { event: EVENT, pin: '1507', roster: "ada, Ada L.\nSam O'Brien" });
    assert.equal(s.status, 200);
    assert.deepEqual(s.json.roster.map(x => x.id), ['ada', 'samobrien']);

    assert.equal((await post('/api/schedule', { text: 'qm1, 1, 2, 3' })).status, 400);
    assert.equal((await post('/api/schedule', { text: SCHEDULE.map(m => `${m.key}, ${m.teams.join(', ')}`).join('\n') })).json.matches, 3);

    const scan = await post('/api/scan', { text: qr(), source: 'webcam' });
    assert.equal(scan.json.outcome, 'new');

    const cov = await (await fetch(base + '/api/coverage')).json();
    assert.equal(cov.totals.scanned, 1);

    const codes = await (await fetch(base + '/api/codes')).json();
    assert.equal(codes.config.length, 7, 'six stations + Pit scout');
    assert.equal(decodeConfig(codes.config[4].code).config.station, 'B2');
    const pitCfg = decodeConfig(codes.config[6].code).config;
    assert.equal(pitCfg.station, 'PIT');
    assert.deepEqual(pitCfg.teams, [...new Set(SCHEDULE.flatMap(m => m.teams))].sort((a, b) => a - b),
      'no TBA team list: the pit iPad gets everyone in the schedule');
    assert.equal(decodeSchedulePart(codes.schedule[0]).ok, true);

    const csv = await (await fetch(base + '/api/export.csv')).text();
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^2026test,qm1,Qual 1,1507,R1,ada,Ada L\./);

    assert.equal((await fetch(base + '/data/scout.sqlite')).status, 404, 'data folder is never served');
    assert.equal((await fetch(base + '/laptop/public/../../package.json')).status, 404);
  } finally {
    server.close();
  }
});

function pitQr({ team = 254, scout = 'ada', ts = 1790000600, event = EVENT, values = {} } = {}) {
  return encodePitRecord({ app_version: '1.1.0', event, team, scout_id: scout, ts,
    values: { ...emptyValues(PIT_FIELDS), drivetrain: 0, fits_trench: 0, shooter_type: 2, climb_claim: 3, ...values } });
}

test('pit records: new, rescan, correction, a second scout, an unknown team, and append-only', () => {
  const store = freshStore();
  store.replaceTeams(EVENT, [{ team: 254, name: 'Cheesy Poofs' }, { team: 1507, name: 'Warlocks' }]);
  const first = ingest(store, pitQr());
  assert.equal(first.kind, 'pit');
  assert.equal(first.outcome, 'new');
  assert.deepEqual(first.warnings, []);
  assert.equal(ingest(store, pitQr()).outcome, 'rescan');
  assert.equal(ingest(store, pitQr({ ts: 1790000700, values: { fits_trench: 1 } })).outcome, 'replaces');
  const other = ingest(store, pitQr({ scout: 'sam' }));
  assert.match(other.warnings.join(), /also pit scouted by ada/);
  assert.match(ingest(store, pitQr({ team: 9999 })).warnings.join(), /isn't on this event's team list/);
  const noList = freshStore();   // no TBA team list: the schedule's teams count
  assert.deepEqual(ingest(noList, pitQr({ team: 254 })).warnings, []);
  assert.match(ingest(noList, pitQr({ team: 9999 })).warnings.join(), /isn't on this event's team list/);
  assert.match(ingest(store, pitQr({ event: '2026other' })).reason, /Wrong event/);

  const current = store.currentPit(EVENT);
  assert.equal(current.filter(p => p.team === 254 && p.scout_id === 'ada').length, 1);
  assert.equal(current.find(p => p.team === 254 && p.scout_id === 'ada').values.fits_trench, 1, 'the correction is current');
  assert.equal(store.recentScans(10).filter(s => s.is_pit).length, 5);
  assert.equal(store.currentRecords(EVENT).length, 0, 'pit records never mix into match records');
});

test('the database refuses to edit or delete pit records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pit-'));
  try {
    const file = join(dir, 'scout.sqlite');
    const store = openDb(file);
    store.setSetting('event', EVENT);
    ingest(store, pitQr());
    store.close();
    const raw = new DatabaseSync(file);
    assert.throws(() => raw.exec('UPDATE pit_records SET team = 1'), /append-only/);
    assert.throws(() => raw.exec('DELETE FROM pit_records'), /append-only/);
    raw.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an older station database (scans without pit_id) is upgraded on open, data kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  try {
    const file = join(dir, 'scout.sqlite');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE scans (id INTEGER PRIMARY KEY, scanned_at INTEGER NOT NULL, raw TEXT NOT NULL, source TEXT,
      accepted INTEGER NOT NULL, outcome TEXT NOT NULL, reason TEXT, record_id INTEGER);
      INSERT INTO scans (scanned_at, raw, accepted, outcome) VALUES (1, 'x', 0, 'rejected');`);
    old.close();
    const store = openDb(file);
    store.setSetting('event', EVENT);
    assert.equal(ingest(store, pitQr()).outcome, 'new');
    assert.equal(store.recentScans(10).length, 2, 'the old scan is still there');
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HTTP API: pit coverage and pit CSV', async () => {
  const store = freshStore();
  store.setSetting('roster', [{ id: 'ada', name: 'Ada L.' }]);
  ingest(store, pitQr({ values: { auto_starts: 3, pit_notes: 'Great, "fast"' } }));
  ingest(store, pitQr({ team: 7777 }));
  const server = createServer(createHandler({ store }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const pit = await (await fetch(base + '/api/pit')).json();
    assert.equal(pit.total, 12, 'everyone in the schedule');
    assert.equal(pit.done, 1);
    assert.deepEqual(pit.teams.find(t => t.team === 254).scouts.map(s => s.scout), ['Ada L.']);
    assert.deepEqual(pit.extras, [7777]);
    const csv = (await (await fetch(base + '/api/pit.csv')).text()).replace(/^﻿/, '').split('\r\n');
    assert.match(csv[0], /^event,team,scout_id,scout_name,scouted_at,app_version,drivetrain,fits_trench/);
    assert.match(csv[1], /^2026test,254,ada,Ada L\.,.*,Swerve,Yes,/);
    assert.match(csv[1], /"In front of Hub, Left of Hub"/);
    assert.match(csv[1], /"Great, ""fast"""/);
  } finally {
    server.close();
  }
});
