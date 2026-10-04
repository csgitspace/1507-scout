import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeConfig, decodeConfig, encodeSchedule, decodeSchedulePart,
  addSchedulePart, missingParts, completeSchedule,
} from '../shared/setup-codes.js';
import {
  parseMatchKey, shortMatchKey, compareMatchKeys, matchLabel, teamFor, orderedKeys,
} from '../shared/schedule.js';
import { parseScheduleText } from '../shared/lead-input.js';

const roster = [{ id: 's01', name: 'Ada L.' }, { id: 's02', name: "Sam O'Brien" }];

test('config round-trips, including names with apostrophes', () => {
  const res = decodeConfig(encodeConfig({ event: '2026nyro', station: 'B3', pin: '1507', roster }));
  assert.equal(res.ok, true, res.reason);
  assert.deepEqual(res.config, { event: '2026nyro', station: 'B3', pin: '1507', roster });
});

test('config rejects bad input before it ever reaches an iPad', () => {
  assert.throws(() => encodeConfig({ event: '2026nyro', station: 'R4', pin: '1507', roster }));
  assert.throws(() => encodeConfig({ event: '2026nyro', station: 'R1', pin: '12', roster }));
  assert.throws(() => encodeConfig({ event: 'NY RO', station: 'R1', pin: '1507', roster }));
});

test('roster names with separators are sanitized, not corrupted', () => {
  const res = decodeConfig(encodeConfig({ event: '2026nyro', station: 'R1', pin: '1507',
    roster: [{ id: 's01', name: 'A;B:C|D' }] }));
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.config.roster[0].name, 'A B C/D');
});

function makeMatches(n) {
  const matches = [];
  for (let i = 1; i <= n; i++) matches.push({ key: `qm${i}`, teams: [1, 2, 3, 4, 5, 6].map(x => i * 10 + x) });
  matches.push({ key: 'sf1m1', teams: [1507, 254, 1114, 118, 2056, 33] });
  matches.push({ key: 'sf1m2', teams: [1507, 254, 1114, 118, 2056, 34] });
  matches.push({ key: 'f1m1', teams: [1507, 254, 1114, 118, 2056, 35] });
  return matches;
}

test('schedule splits into parts and reassembles in any scan order', () => {
  const codes = encodeSchedule({ event: '2026nyro', rev: 'a1', matches: makeMatches(80) });
  assert.ok(codes.length > 1);
  let c = null;
  for (const code of [...codes].reverse()) {
    const res = decodeSchedulePart(code);
    assert.equal(res.ok, true, res.reason);
    c = addSchedulePart(c, res.part);
  }
  assert.deepEqual(missingParts(c), []);
  const sched = completeSchedule(c);
  assert.equal(Object.keys(sched).length, 83);
  assert.equal(teamFor(sched, 'qm12', 'R1'), 121);
  assert.equal(teamFor(sched, 'qm12', 'B3'), 126);
  assert.equal(teamFor(sched, 'sf1m2', 'B3'), 34);
  const longest = Math.max(...codes.map(s => s.length));
  console.log(`  80-match schedule: ${codes.length} QR parts, largest ${longest} bytes`);
  assert.ok(longest < 700);
});

test('schedule is incomplete until every part is scanned', () => {
  const codes = encodeSchedule({ event: '2026nyro', rev: 'a1', matches: makeMatches(30) });
  const c = addSchedulePart(null, decodeSchedulePart(codes[0]).part);
  assert.equal(completeSchedule(c), null);
  assert.deepEqual(missingParts(c), codes.slice(1).map((_, i) => i + 2));
});

test('a part from a newer schedule revision starts a fresh collection', () => {
  const old = encodeSchedule({ event: '2026nyro', rev: 'a1', matches: makeMatches(30) });
  const fresh = encodeSchedule({ event: '2026nyro', rev: 'b2', matches: makeMatches(30) });
  let c = addSchedulePart(null, decodeSchedulePart(old[0]).part);
  c = addSchedulePart(c, decodeSchedulePart(fresh[1]).part);
  assert.equal(c.rev, 'b2');
  assert.deepEqual(Object.keys(c.parts), ['2']);
});

test('schedule text errors name the actual problem', () => {
  assert.throws(() => parseScheduleText('qm1, 1507, 204, 340, 3672, 102221, 1498'), /"102221" isn't a valid team number/);
  assert.throws(() => parseScheduleText('qm1, 1507, 204, 340'), /needs 6 team numbers, found 3/);
  assert.equal(parseScheduleText('qm1, 1507, 204, 340, 3672, 10222, 1498')[0].teams[4], 10222);
});

test('match keys: playoffs need a set, quals must not have one', () => {
  assert.deepEqual(parseMatchKey('qm12'), { level: 'qm', set: null, number: 12 });
  assert.deepEqual(parseMatchKey('sf3m1'), { level: 'sf', set: 3, number: 1 });
  assert.equal(parseMatchKey('sf3'), null);
  assert.equal(parseMatchKey('qm3m1'), null);
  assert.equal(shortMatchKey('2026nyro_sf3m1'), 'sf3m1');
});

test('matches sort in play order and get readable labels', () => {
  const keys = ['f1m1', 'sf2m1', 'qm10', 'sf1m2', 'qm2', 'sf1m1'];
  assert.deepEqual([...keys].sort(compareMatchKeys), ['qm2', 'qm10', 'sf1m1', 'sf1m2', 'sf2m1', 'f1m1']);
  assert.deepEqual(orderedKeys({ qm10: [], qm9: [] }), ['qm9', 'qm10']);
  assert.equal(matchLabel('qm12'), 'Qual 12');
  assert.equal(matchLabel('sf3m1'), 'Playoff 3');
  assert.equal(matchLabel('f1m2'), 'Final 2');
});
