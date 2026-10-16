import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FakeSpreadsheet, loadProject, plain, FORMULA } from './helpers/fake-apps-script.js';
import { emptyValues } from '../shared/fields.js';
import { encodeRecord, recordKey } from '../shared/codec.js';

const EVENT = '2026test';
let nextId = 1;

/** A record as the laptop sends it. */
function rec({ match = 'qm1', team = 1507, scout = 'ada', station = 'R1', ts = 1790000000, values = {} } = {}) {
  const v = { ...emptyValues(), auto_start_position: 0, endgame_level: 0, primary_role: 0, cycle_speed: 3, ...values };
  const r = { app_version: '1.0.1', schema_version: 1, event: EVENT, match_key: match, team, scout_id: scout, station, ts, values: v };
  return { ...r, id: nextId++, rkey: recordKey(r), qr: encodeRecord(r), scout_name: scout.toUpperCase() };
}

function setup() {
  const ss = new FakeSpreadsheet();
  const sync = loadProject('sync-endpoint', ss);
  const post = (body) => JSON.parse(sync.doPost({ postData: { contents: JSON.stringify({ token: 'secret-token', event: EVENT, ...body }) } }).getContent());
  return { ss, sync, post };
}

test('sync endpoint refuses a wrong token and bad JSON', () => {
  const { sync } = setup();
  const bad = JSON.parse(sync.doPost({ postData: { contents: JSON.stringify({ token: 'nope', event: EVENT, records: [] }) } }).getContent());
  assert.equal(bad.ok, false);
  assert.match(bad.error, /token/);
  assert.equal(JSON.parse(sync.doPost({ postData: { contents: '{oops' } }).getContent()).ok, false);
  assert.equal(JSON.parse(sync.doGet().getContent()).service, 'warlocks-1507-sync');
});

test('first sync creates the tabs, appends records, builds the summary and stamps freshness', () => {
  const { ss, post } = setup();
  const records = [rec({ values: { teleop_fuel_scored: 30 } }), rec({ team: 254, station: 'R2', values: { teleop_fuel_scored: 50 } })];
  const res = post({ records, eventName: 'Test Regional', teams: [{ team: 1507, name: 'Warlocks' }, { team: 254, name: 'Cheesy Poofs' }],
    schedule: [{ key: 'qm1', teams: [1507, 254, 3, 4, 5, 6] }] });
  assert.equal(res.ok, true);
  assert.equal(res.added, 2);
  assert.deepEqual(plain(res.accepted), records.map(r => r.id));
  for (const tab of ['Raw', 'Summary', 'Teams', 'Matches', 'Mentor', 'MentorPrivate', 'Config']) assert.ok(ss.getSheetByName(tab), tab);
  const raw = ss.getSheetByName('Raw').objects();
  assert.equal(raw.length, 2);
  assert.equal(raw[0].auto_start_position, 'In front of Hub', 'Raw shows readable labels');
  assert.equal(raw[0].match, 'Qual 1');
  const summary = ss.getSheetByName('Summary').objects();
  assert.equal(summary.find(s => s.team === 254).name, 'Cheesy Poofs');
  assert.equal(summary[0].team, 254, 'sorted by strength');
  assert.ok(ss.getSheetByName('Raw').protections.length, 'Raw is protected');
  const config = Object.fromEntries(ss.getSheetByName('Config').objects().map(r => [r.key, JSON.parse(r.value)]));
  assert.equal(config.event, EVENT);
  assert.equal(config.event_name, 'Test Regional');
  assert.ok(config.last_sync_ms > 0);
});

test('re-sending the same records adds nothing (safe retry)', () => {
  const { ss, post } = setup();
  const records = [rec(), rec({ team: 254 })];
  post({ records });
  const again = post({ records });
  assert.equal(again.added, 0);
  assert.deepEqual(plain(again.accepted), records.map(r => r.id), 'still confirmed, so the laptop stops resending');
  assert.equal(ss.getSheetByName('Raw').objects().length, 2);
});

test('a correction supersedes in the summary but every version stays in Raw', () => {
  const { ss, post } = setup();
  post({ records: [rec({ ts: 100, values: { teleop_fuel_scored: 10 } })] });
  post({ records: [rec({ ts: 200, values: { teleop_fuel_scored: 40 } })] });
  assert.equal(ss.getSheetByName('Raw').objects().length, 2);
  assert.equal(ss.getSheetByName('Summary').objects()[0].avg_teleop, 40);
});

test('the sync never touches mentor annotations', () => {
  const { ss, post } = setup();
  post({ records: [rec()] });
  const web = loadProject('web', ss);
  web.saveTag(1507, 'Target');
  web.saveSharedNote(1507, 'Great partner');
  post({ records: [rec({ match: 'qm2', values: { teleop_fuel_scored: 99 } })], teams: [{ team: 1507, name: 'Warlocks' }] });
  const m = ss.getSheetByName('Mentor').objects()[0];
  assert.equal(m.tag, 'Target');
  assert.equal(m.shared_note, 'Great partner');
});

test('scout and mentor text can never become a Sheets formula', () => {
  const { ss, post } = setup();
  post({ records: [rec({ values: { notes: '=IMPORTXML("http://evil","//a")' } })], teams: [{ team: 1507, name: '+cmd' }] });
  const raw = ss.getSheetByName('Raw').objects()[0];
  assert.equal(raw.notes, '=IMPORTXML("http://evil","//a")');
  assert.notEqual(raw.notes, FORMULA);
  assert.equal(ss.getSheetByName('Teams').objects()[0].team_name, '+cmd');
  const web = loadProject('web', ss);
  web.saveSharedNote(1507, '=HYPERLINK("x")');
  assert.equal(ss.getSheetByName('Mentor').objects()[0].shared_note, '=HYPERLINK("x")');
});

test('summary math: two scouts averaged, auto misses in accuracy, climb success by level, no-shows separate', () => {
  const { ss, post } = setup();
  post({ records: [
    // qm1: two scouts on 1507 disagree -> averaged into one observation
    rec({ match: 'qm1', scout: 'ada', values: { auto_fuel_scored: 4, teleop_fuel_scored: 20, teleop_fuel_missed: 10, endgame_attempt: true, endgame_level: 3 } }),
    rec({ match: 'qm1', scout: 'ben', values: { auto_fuel_scored: 6, teleop_fuel_scored: 30, auto_fuel_missed: 10, endgame_attempt: true, endgame_level: 1 } }),
    // qm2: normal match
    rec({ match: 'qm2', values: { auto_fuel_scored: 5, teleop_fuel_scored: 25, endgame_attempt: true, endgame_level: 2 } }),
    // qm3: no-show — counts toward the rate, not the scoring averages
    rec({ match: 'qm3', values: { no_show: true } }),
  ] });
  const t = ss.getSheetByName('Summary').objects()[0];
  assert.equal(t.matches, 3);
  assert.equal(t.records, 4);
  assert.equal(t.avg_auto, 5);         // (5 + 5) / 2 played matches
  assert.equal(t.avg_teleop, 25);      // (25 + 25) / 2
  // per played match: misses avg auto (5+0)/2=2.5, teleop (5+0)/2=2.5 -> 30 / (30 + 2.5 + 2.5)
  assert.equal(t.accuracy, 0.857);     // auto misses count (legacy Issue 6)
  assert.equal(t.climb_l1, 1);
  assert.equal(t.climb_l2, 0.75);      // qm1 half the scouts saw L2+, qm2 yes
  assert.equal(t.climb_l3, 0.25);
  assert.equal(t.no_show_rate, 0.333);
  assert.equal(t.bot_type, 'Scorer');
});

test('scoring levels split the event into thirds', () => {
  const { ss, post } = setup();
  const teams = [11, 22, 33, 44, 55, 66];
  post({ records: teams.map((team, i) => rec({ team, values: { teleop_fuel_scored: (i + 1) * 10 } })) });
  const levels = Object.fromEntries(ss.getSheetByName('Summary').objects().map(s => [s.team, s.scoring_level]));
  assert.deepEqual(levels, { 11: 'Low', 22: 'Low', 33: 'Mid', 44: 'Mid', 55: 'High', 66: 'High' });
});

test('dashboard: pick list merges mentor data; private notes stay private; ranking and gaps save', () => {
  const { ss, post } = setup();
  post({ records: [
    rec({ team: 1507, values: { teleop_fuel_scored: 40, endgame_level: 3, endgame_attempt: true } }),
    rec({ team: 254, station: 'R2', values: { teleop_fuel_scored: 10, primary_role: 2 } }),
    rec({ team: 118, station: 'R3', values: { teleop_fuel_scored: 25 } }),
  ] });
  const alice = loadProject('web', ss, { user: { email: 'alice@example.com' } });
  const bob = loadProject('web', ss, { user: { email: 'bob@example.com' } });

  alice.saveTag(254, 'Target');
  alice.saveSharedNote(254, 'Strong defender');
  alice.savePrivateNote(254, 'alice only');
  alice.saveRanking([118, 254]);
  alice.saveRanking([254, 118]);
  alice.saveGaps(['defense', 'not-a-gap']);

  const view = plain(bob.getPickList());
  assert.equal(view.me, 'bob@example.com');
  assert.deepEqual(view.teams.map(t => t.team), [254, 118], 'ranked order; 1507 (us) is not on our own pick list');
  const t254 = view.teams[0];
  assert.equal(t254.tag, 'Target');
  assert.equal(t254.shared_note, 'Strong defender');
  assert.equal(t254.shared_note_by, 'alice@example.com');
  assert.equal(t254.private_note, '', "bob can't see alice's private note");
  assert.deepEqual(view.gaps, ['defense']);
  assert.equal(t254.fit, 'High');
  assert.match(t254.fit_reason, /defends 100%/);
  assert.equal(plain(alice.getPickList()).teams[0].private_note, 'alice only');
  assert.throws(() => alice.saveTag(254, 'Bogus'), /Bad tag/);
});

test('analyze data: per-match series in the summary, our own stats returned, old Summary without the column still loads', () => {
  const { ss, post } = setup();
  post({ records: [
    rec({ match: 'qm1', team: 254, values: { auto_fuel_scored: 4, teleop_fuel_scored: 20, endgame_level: 2 } }),
    rec({ match: 'qm2', team: 254, values: { no_show: true } }),
    rec({ match: 'qm3', team: 254, values: { auto_fuel_scored: 6, teleop_fuel_scored: 30, broke_down: true } }),
    rec({ match: 'qm1', team: 1507, station: 'R2', values: { teleop_fuel_scored: 12 } }),
  ] });
  const view = plain(loadProject('web', ss).getPickList());
  const t254 = view.teams.find(t => t.team === 254);
  assert.deepEqual(t254.series, [
    { m: 'qm1', auto: 4, tele: 20, climb: 2, ns: 0, broke: 0 },
    { m: 'qm2', auto: 0, tele: 0, climb: 0, ns: 1, broke: 0 },
    { m: 'qm3', auto: 6, tele: 30, climb: 0, ns: 0, broke: 1 },
  ], 'oldest first; no-show and broke flagged');
  assert.equal(view.ourTeam, 1507);
  assert.equal(view.us.team, 1507, 'our stats come back for the alliance builder');
  assert.equal(view.us.avg_total, 12);
  assert.ok(!view.teams.some(t => t.team === 1507), 'but we stay off the list');

  // A Summary written before series_json existed (series_json and everything after it missing) still loads.
  const sum = ss.getSheetByName('Summary');
  const cut = sum.data[0].indexOf('series_json');
  sum.data = sum.data.map(r => r.slice(0, cut));
  const old = plain(loadProject('web', ss).getPickList()).teams.find(t => t.team === 254);
  assert.deepEqual(old.series, []);
  assert.deepEqual(old.auto_starts, []);
});

test('loading the pick list only reads: it never creates or reformats a tab', () => {
  const ss = new FakeSpreadsheet();
  const web = loadProject('web', ss);
  const view = plain(web.getPickList());
  assert.deepEqual(view.teams, []);
  assert.equal(ss.sheets.size, 0, 'no tabs created on an empty Sheet');
  web.getDataHealth();
  web.getNextMatch();
  assert.equal(ss.sheets.size, 0, 'nor by the other screens');
});

test('alliance selection: picked is shared, never changes the pick order, survives a sync, and clears', () => {
  const { ss, post } = setup();
  post({ records: [rec({ team: 254 }), rec({ team: 118, station: 'R2' }), rec({ team: 33, station: 'R3' })] });
  const lead = loadProject('web', ss, { user: { email: 'lead@example.com' } });
  lead.saveRanking([254, 118, 33]);
  lead.savePicked(254, true);
  post({ records: [rec({ team: 254, match: 'qm2' })] });
  const view = plain(loadProject('web', ss, { user: { email: 'other@example.com' } }).getPickList());
  assert.deepEqual(view.teams.map(t => [t.team, t.rank, t.picked]), [[254, 1, true], [118, 2, false], [33, 3, false]]);
  lead.savePicked(254, false);
  lead.savePicked(118, true);
  lead.clearPicked();
  assert.ok(plain(lead.getPickList()).teams.every(t => !t.picked));
});

test('routes and best auto: summary rates, pit claims vs what scouts saw, shooter label, Trench bot fit', () => {
  const { ss, post } = setup();
  const pit = (team, values) => ({ id: nextId++, event: EVENT, team, scout_id: 'pat', scout_name: 'Pat', ts: 1790000900,
    rkey: `pit|${team}|pat`, qr: `WP|pit-${team}-${nextId}`, app_version: '1.1.0', schema_version: 1,
    values: { drivetrain: 0, fits_trench: 0, crosses_bump: 0, hopper_capacity: 40, shooter_type: 2, shooter_count: 2, shoots_moving: 0,
      auto_starts: 6, auto_best_fuel: 8, auto_climb_claim: 0, auto_notes: 'Left: 8 + climb', climb_claim: 3, pit_notes: '', ...values } });
  post({
    records: [
      // 254: seen under the trench in 1 of 2 matches; best auto from Left of Hub
      rec({ match: 'qm1', team: 254, values: { route_used: 1, auto_start_position: 1, auto_fuel_scored: 8, auto_climb: true } }),
      rec({ match: 'qm2', team: 254, values: { route_used: 2, auto_start_position: 0, auto_fuel_scored: 3 } }),
      // 118: pit says trench, scouts never saw it (3 matches, bump only)
      rec({ match: 'qm1', team: 118, station: 'R2', values: { route_used: 2 } }),
      rec({ match: 'qm2', team: 118, station: 'R2', values: { route_used: 2 } }),
      rec({ match: 'qm3', team: 118, station: 'R2', values: { route_used: 2 } }),
      // 33: pit says it doesn't fit; 2056: only pit scouted
      rec({ match: 'qm1', team: 33, station: 'R3', values: {} }),
    ],
    pit: [pit(254, {}), pit(118, {}), pit(33, { fits_trench: 1, shooter_type: 0, shooter_count: 1, shoots_moving: 1 }), pit(2056, {})],
  });
  const web = loadProject('web', ss);
  web.saveGaps(['trench']);
  const teams = Object.fromEntries(plain(web.getPickList()).teams.map(t => [t.team, t]));

  assert.equal(teams[254].route_n, 2);
  assert.equal(teams[254].trench_rate, 0.5);
  assert.equal(teams[254].trench_label, 'Trench ✓ (seen 1/2)');
  assert.deepEqual(teams[254].auto_starts[0], { pos: 'Left of Hub', n: 1, fuel: 8, climb: 1 }, 'best auto first');
  assert.equal(teams[254].fit, 'High');
  assert.equal(teams[118].trench, 'claimed');
  assert.equal(teams[118].trench_label, 'Trench (pit says; not seen in 3)');
  assert.equal(teams[33].trench, 'bump');
  assert.equal(teams[33].shooter_label, 'Fixed');
  assert.equal(teams[254].shooter_label, 'Turret ×2 · shoots moving');
  assert.equal(teams[254].pit.auto_starts, 'Left of Hub, Right of Hub');
  assert.equal(teams[254].pit.hopper_capacity, 40);
  assert.equal(teams[254].pit.by, 'Pat');
  assert.ok(teams[2056], 'a team only pit scouted still appears');
  assert.equal(teams[2056].matches, 0);
  assert.equal(teams[2056].trench, 'claimed');
});
