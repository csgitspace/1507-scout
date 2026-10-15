import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FakeSpreadsheet, loadProject, plain } from './helpers/fake-apps-script.js';

const EVENT = '2026test';

/** A synced Sheet with three teams; leads: emails to put on the Leads tab (as the team account would). */
function setup(leads = []) {
  const ss = new FakeSpreadsheet();
  const sync = loadProject('sync-endpoint', ss);
  sync.doPost({ postData: { contents: JSON.stringify({ token: 'secret-token', event: EVENT, records: [],
    teams: [{ team: 254, name: 'Cheesy Poofs' }, { team: 118, name: 'Robonauts' }, { team: 33, name: 'Killer Bees' }] }) } });
  const tab = ss.getSheetByName('Leads');
  leads.forEach((email, i) => tab.getRange(i + 2, 1, 1, 3).setValues([[email, '', '']]));
  const as = (email) => loadProject('web', ss, { user: { email } });
  return { ss, as };
}

test('the sync creates a Leads tab only the team account can edit', () => {
  const { ss } = setup();
  const tab = ss.getSheetByName('Leads');
  assert.ok(tab, 'Leads tab exists');
  assert.deepEqual(tab.data[0], ['email', 'name', 'role']);
  assert.ok(tab.protections.length, 'protected');
});

test('no leads listed yet: everyone can edit the official list (the old behavior), and the page says so', () => {
  const { as } = setup();
  const anyone = as('student@warlocks1507.com');
  assert.deepEqual(plain(anyone.getPickList().role), { lead: true, open: true, leadCount: 0 });
  anyone.saveTag(254, 'Target');
  assert.equal(plain(anyone.getPickList()).teams.find(t => t.team === 254).tag, 'Target');
});

test('with leads listed: only they change the official list; email case does not matter', () => {
  const { as } = setup(['Coach@Warlocks1507.com', 'captain@warlocks1507.com']);
  const coach = as('coach@warlocks1507.com');
  const viewer = as('freshman@warlocks1507.com');
  assert.deepEqual(plain(coach.getPickList().role), { lead: true, open: false, leadCount: 2 });
  assert.equal(plain(viewer.getPickList().role).lead, false);

  coach.saveRanking([118, 254]);
  coach.saveTag(118, 'Target');
  coach.saveSharedNote(118, 'Great climber');
  coach.saveGaps(['climb_l3']);

  for (const [fn, args] of [['saveRanking', [[254, 118]]], ['saveTag', [118, 'Avoid']], ['saveSharedNote', [118, 'nah']], ['saveGaps', [[]]]]) {
    assert.throws(() => viewer[fn](...args), /Only pick leads/, fn);
  }
  const view = plain(viewer.getPickList());
  assert.deepEqual(view.teams.slice(0, 2).map(t => t.team), [118, 254], 'official order unchanged');
  assert.equal(view.teams[0].tag, 'Target');
  assert.equal(view.teams[0].shared_note, 'Great climber');
  assert.deepEqual(view.gaps, ['climb_l3']);
});

test('My list: anyone can rank and tag for themselves without touching the official list or anyone else', () => {
  const { as } = setup(['coach@warlocks1507.com']);
  const coach = as('coach@warlocks1507.com');
  const ada = as('ada@warlocks1507.com');
  const ben = as('ben@warlocks1507.com');
  coach.saveRanking([254, 118, 33]);
  coach.saveTag(254, 'Target');

  ada.saveMyRanking([33, 118]);
  ada.saveMyTag(33, 'Target');
  ada.saveMyTag(254, 'Avoid');
  ben.saveMyRanking([118]);

  const a = Object.fromEntries(plain(ada.getPickList()).teams.map(t => [t.team, t]));
  assert.deepEqual([a[33].my_rank, a[118].my_rank, a[254].my_rank], [1, 2, null]);
  assert.deepEqual([a[33].my_tag, a[254].my_tag], ['Target', 'Avoid']);
  assert.deepEqual([a[254].rank, a[254].tag], [1, 'Target'], 'official list untouched');

  const b = Object.fromEntries(plain(ben.getPickList()).teams.map(t => [t.team, t]));
  assert.deepEqual([b[118].my_rank, b[33].my_rank, b[254].my_tag], [1, null, ''], "ben doesn't see ada's list");

  ada.saveMyRanking([118, 33]);   // reordering keeps my tags
  const a2 = Object.fromEntries(plain(ada.getPickList()).teams.map(t => [t.team, t]));
  assert.deepEqual([a2[118].my_rank, a2[33].my_rank, a2[33].my_tag, a2[254].my_tag], [1, 2, 'Target', 'Avoid']);
});

test('My list: start from the official list, then clear it', () => {
  const { as } = setup(['coach@warlocks1507.com']);
  const coach = as('coach@warlocks1507.com');
  const ada = as('ada@warlocks1507.com');
  coach.saveRanking([118, 254]);
  coach.saveTag(33, 'Avoid');
  ada.saveMyTag(254, 'Target');

  ada.copyOfficialToMine();
  let a = Object.fromEntries(plain(ada.getPickList()).teams.map(t => [t.team, t]));
  assert.deepEqual([a[118].my_rank, a[254].my_rank, a[33].my_rank], [1, 2, null]);
  assert.deepEqual([a[33].my_tag, a[254].my_tag], ['Avoid', ''], 'tags replaced by the official ones');

  ada.clearMyList();
  a = Object.fromEntries(plain(ada.getPickList()).teams.map(t => [t.team, t]));
  assert.ok(Object.values(a).every(t => t.my_rank === null && t.my_tag === ''));
  assert.equal(a[118].rank, 1, 'official list untouched');
});

test('the sync never touches My list or the Leads tab', () => {
  const { ss, as } = setup(['coach@warlocks1507.com']);
  as('ada@warlocks1507.com').saveMyRanking([33]);
  const sync = loadProject('sync-endpoint', ss);
  sync.doPost({ postData: { contents: JSON.stringify({ token: 'secret-token', event: EVENT, records: [], teams: [{ team: 33, name: 'Bees' }] }) } });
  assert.equal(ss.getSheetByName('MyPicks').objects()[0].team, 33);
  assert.equal(ss.getSheetByName('Leads').objects()[0].email, 'coach@warlocks1507.com');
});
