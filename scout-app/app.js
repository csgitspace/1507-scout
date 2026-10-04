// ==============================================================================
// Warlocks 1507 Scout — iPad app.
//
// Screens: setup -> who's scouting -> home (next match) -> form -> QR.
// Plus history, and a PIN-locked lead menu.
//
// Works with no network at all: everything is cached by sw.js and stored in
// IndexedDB (db.js). Every tap in the form saves a draft, so a crash or
// reload loses nothing.
// ==============================================================================

import { h, toast, confirmDialog, numberPad, modal } from './dom.js';
import { qrElement } from './qr.js';
import { scanQR } from './scanner.js';
import { renderField } from './form.js';
import * as db from './db.js';
import { FIELDS, PHASES, emptyValues, missingRequired } from '../shared/fields.js';
import { encodeRecord, recordKey } from '../shared/codec.js';
import { decodeConfig, decodeSchedulePart, addSchedulePart, missingParts, completeSchedule } from '../shared/setup-codes.js';
import { teamFor, matchLabel, stationLabel, compareMatchKeys, parseMatchKey } from '../shared/schedule.js';

const APP_VERSION = globalThis.APP_VERSION || 'dev';
const root = document.getElementById('app');

// ---------- State (mirrors what's in IndexedDB) ----------
const S = {
  config: null,          // { event, station, pin, roster: [{id, name}] } from the config QR
  schedule: null,        // { event, rev, matches: { matchKey: [r1, r2, r3, b1, b2, b3] } }
  pendingSchedule: null, // schedule parts collected so far (see setup-codes.js)
  scoutId: null,         // who is holding the iPad right now
  cursor: null,          // match key shown on Home
  overrides: {},         // { matchKey: team } set by the lead
  draft: null,           // the match being scouted right now
  records: [],           // every submitted record on this iPad
  screen: null,
  swReg: null,
};

function save(key, value) {
  const p = value === null || value === undefined ? db.clearSetting(key) : db.setSetting(key, value);
  return p.catch(err => toast(`Could not save (${err.message})`, 'bad'));
}

// ---------- Derived values ----------
const isRed = (station) => station[0] === 'R';
const scheduleMatches = () =>
  (S.schedule && S.config && S.schedule.event === S.config.event ? S.schedule.matches : null);

/** Every match this iPad knows about: the schedule plus any matches the lead added by hand. */
function allKeys() {
  const keys = new Set([...Object.keys(scheduleMatches() || {}), ...Object.keys(S.overrides)]);
  return [...keys].sort(compareMatchKeys);
}

const teamAt = (key) => S.overrides[key] || teamFor(scheduleMatches(), key, S.config.station);
const scoutName = (id) => (S.config && S.config.roster.find(s => s.id === id) || {}).name || id;
const scoutedHere = (key, team) => S.records.some(r => r.match_key === key && r.team === team);
const draftFor = (key, team) => S.draft && !S.draft.correction && S.draft.match_key === key && S.draft.team === team;

function firstUnscouted() {
  const keys = allKeys();
  return keys.find(k => !S.records.some(r => r.match_key === k)) || keys[keys.length - 1] || null;
}

const isInstalled = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function displayValue(f, v) {
  switch (f.type) {
    case 'bool': return v ? 'Yes' : 'No';
    case 'enum': return v === null ? '—' : f.options[v];
    case 'multi': return f.options.filter((_, i) => v & (1 << i)).join(', ') || 'None';
    case 'rating': return v === null ? '—' : `${v} / ${f.max}`;
    case 'text': return v || '—';
    default: return String(v);
  }
}

// ---------- Shared pieces of UI ----------
function topbar(left = null, right = null) {
  return h('header', { class: 'topbar' },
    h('div', { class: 'topbar-side' }, left),
    h('div', { class: 'brand' }, h('span', { class: 'bolt' }, '⚡'), 'WARLOCKS 1507', h('span', { class: 'bolt' }, '⚡')),
    h('div', { class: 'topbar-side right' }, right));
}

const backButton = (label, fn) => h('button', { class: 'btn ghost small', onclick: fn }, label);

function stationChip(station) {
  return h('span', { class: `chip-station ${isRed(station) ? 'red' : 'blue'}` }, stationLabel(station));
}

function installNotice() {
  if (isInstalled()) return null;
  return h('div', { class: 'notice warn' },
    h('strong', null, 'Not installed yet. '),
    'In Safari tap Share → Add to Home Screen, then open the app from the Home Screen. ',
    'Data saved in a Safari tab is kept separately, and iOS may clear it.');
}

// ---------- Navigation ----------
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not supported or not allowed — fine */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ['form', 'qr'].includes(S.screen)) keepAwake(true);
});

function show(name, build) {
  S.screen = name;
  root.replaceChildren(build());
  window.scrollTo(0, 0);
  keepAwake(name === 'form' || name === 'qr');
}

function route() {
  if (!S.config) return show('setup', setupScreen);
  if (!S.config.roster.some(s => s.id === S.scoutId)) return show('who', whoScreen);
  show('home', homeScreen);
}

// ---------- Setup ----------
function setupScreen() {
  return h('div', { class: 'screen' }, topbar(),
    h('main', { class: 'center' },
      h('div', { class: 'hero-bolt' }, '⚡'),
      h('h1', null, 'Set up this iPad'),
      h('p', { class: 'lead' }, "Ask your scouting lead for the config QR code for this iPad's station."),
      installNotice(),
      h('button', { class: 'btn primary big', onclick: scanConfig }, 'Scan config QR'),
      h('p', { class: 'fine' }, `App v${APP_VERSION}`)));
}

async function scanConfig() {
  const cfg = await scanQR({
    title: 'Scan config QR',
    onCode: (text) => {
      const r = decodeConfig(text);
      return r.ok
        ? { ok: true, done: true, value: r.config, message: `✓ ${stationLabel(r.config.station)} · ${r.config.event}` }
        : { ok: false, message: r.reason };
    },
  });
  if (!cfg) return;
  if (S.config && S.config.event !== cfg.event) {
    S.overrides = {}; save('overrides', null);
    S.cursor = null; save('cursor', null);
  }
  S.config = cfg;
  await save('config', cfg);
  if (!cfg.roster.some(s => s.id === S.scoutId)) { S.scoutId = null; save('scoutId', null); }
  db.requestPersistence();
  toast(`Set to ${stationLabel(cfg.station)} for ${cfg.event}`, 'good');
  route();
}

function whoScreen() {
  return h('div', { class: 'screen' }, topbar(),
    h('main', null,
      h('div', { class: 'station-banner' }, stationChip(S.config.station), h('span', { class: 'event-code' }, S.config.event)),
      h('h1', null, "Who's scouting?"),
      h('p', { class: 'lead' }, 'Tap your name. Change it when you hand the iPad to the next scout.'),
      h('div', { class: 'roster' }, S.config.roster.map(s =>
        h('button', {
          class: `roster-btn ${s.id === S.scoutId ? 'on' : ''}`,
          onclick: async () => {
            S.scoutId = s.id;
            await save('scoutId', s.id);
            toast(`Scouting as ${s.name}`, 'good');
            route();
          },
        }, s.name)))));
}

// ---------- Home ----------
function homeScreen() {
  const keys = allKeys();
  if (!keys.includes(S.cursor)) { S.cursor = firstUnscouted(); save('cursor', S.cursor); }
  const key = S.cursor;
  const team = key ? teamAt(key) : null;
  const idx = keys.indexOf(key);
  const done = key && team && scoutedHere(key, team);
  const sched = scheduleMatches();
  const station = S.config.station;

  const card = key
    ? h('section', { class: `match-card ${isRed(station) ? 'red' : 'blue'}` },
      h('div', { class: 'match-nav' },
        h('button', { class: 'nav-arrow', disabled: idx <= 0, 'aria-label': 'Previous match', onclick: () => moveCursor(-1) }, '◀'),
        h('div', { class: 'match-title' }, h('div', { class: 'match-label' }, matchLabel(key)), stationChip(station)),
        h('button', { class: 'nav-arrow', disabled: idx >= keys.length - 1, 'aria-label': 'Next match', onclick: () => moveCursor(1) }, '▶')),
      h('div', { class: 'team-big' }, team ? String(team) : '—'),
      h('div', { class: 'team-caption' },
        !team ? 'No team for this station — ask your lead' : S.overrides[key] ? 'Team to scout (set by lead)' : 'Team to scout'),
      done ? h('div', { class: 'done-tag' }, '✓ Already scouted on this iPad') : null,
      h('button', { class: 'btn primary big', disabled: !team, onclick: () => startMatch(key, team) },
        draftFor(key, team) ? 'Resume scouting' : done ? 'Scout again (replaces earlier)' : 'Start scouting'))
    : h('section', { class: 'match-card empty' },
      h('h2', null, 'No schedule loaded'),
      h('p', null, 'Scan the schedule QR from the scan station.'));

  const otherDraft = S.draft && !draftFor(key, team)
    ? h('div', { class: 'notice' },
      h('div', null, h('strong', null, 'Unfinished: '),
        `${matchLabel(S.draft.match_key)} · Team ${S.draft.team}${S.draft.correction ? ' (correction)' : ''}`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', onclick: discardDraft }, 'Discard'),
        h('button', { class: 'btn primary', onclick: () => show('form', formScreen) }, 'Resume')))
    : null;

  let schedLine = sched ? `Schedule: ${Object.keys(sched).length} matches (rev ${S.schedule.rev})` : 'No schedule loaded';
  if (S.pendingSchedule) {
    const have = S.pendingSchedule.total - missingParts(S.pendingSchedule).length;
    schedLine += ` · update ${have}/${S.pendingSchedule.total} parts scanned`;
  }

  const update = S.swReg && S.swReg.waiting
    ? h('div', { class: 'notice good' }, h('strong', null, 'App update ready. '), 'Install it between matches.',
      h('button', { class: 'btn primary', onclick: applyUpdate }, 'Update now'))
    : null;

  return h('div', { class: 'screen' },
    topbar(null, h('button', { class: 'btn ghost small', onclick: openLead }, '🔒 Lead')),
    h('main', null,
      installNotice(),
      update,
      otherDraft,
      card,
      h('div', { class: 'home-row' },
        h('span', { class: 'fine' }, schedLine),
        h('button', { class: 'btn small', onclick: scanSchedule }, 'Scan schedule')),
      h('div', { class: 'home-grid' },
        h('button', { class: 'btn', onclick: () => show('history', historyScreen) }, `History (${S.records.length})`),
        h('button', { class: 'btn', onclick: () => show('who', whoScreen) }, `Scout: ${scoutName(S.scoutId)} — change`)),
      h('p', { class: 'fine center-text' }, `${S.config.event} · v${APP_VERSION}`)));
}

function moveCursor(delta) {
  const keys = allKeys();
  const next = keys[keys.indexOf(S.cursor) + delta];
  if (!next) return;
  S.cursor = next;
  save('cursor', next);
  show('home', homeScreen);
}

async function discardDraft() {
  const d = S.draft;
  if (!await confirmDialog(`Discard the unfinished ${matchLabel(d.match_key)} · Team ${d.team}? This can't be undone.`,
    { ok: 'Discard', danger: true })) return;
  S.draft = null;
  await save('draft', null);
  route();
}

async function scanSchedule() {
  const result = await scanQR({
    title: 'Scan schedule QR',
    hint: 'Scan every part, in any order',
    onCode: async (text) => {
      const r = decodeSchedulePart(text);
      if (!r.ok) return { ok: false, message: r.reason };
      const p = r.part;
      if (p.event !== S.config.event) {
        return { ok: false, message: `This schedule is for ${p.event}, but this iPad is set to ${S.config.event}` };
      }
      if (S.schedule && S.schedule.event === p.event && S.schedule.rev === p.rev) {
        return { ok: true, done: true, value: 'same', message: '✓ Already have this schedule' };
      }
      S.pendingSchedule = addSchedulePart(S.pendingSchedule, p);
      const missing = missingParts(S.pendingSchedule);
      if (missing.length) {
        await save('pendingSchedule', S.pendingSchedule);
        return { ok: true, message: `Got part ${p.part} of ${p.total}. Still need: ${missing.join(', ')}` };
      }
      S.schedule = { event: p.event, rev: p.rev, matches: completeSchedule(S.pendingSchedule) };
      S.pendingSchedule = null;
      await save('schedule', S.schedule);
      await save('pendingSchedule', null);
      return { ok: true, done: true, value: 'new', message: `✓ Schedule loaded: ${Object.keys(S.schedule.matches).length} matches` };
    },
  });
  if (result === 'new') toast('Schedule updated', 'good');
  route();
}

// ---------- Scouting form ----------
async function startMatch(key, team) {
  if (!draftFor(key, team)) {
    if (S.draft && !await confirmDialog(
      `Discard the unfinished ${matchLabel(S.draft.match_key)} · Team ${S.draft.team}?`, { ok: 'Discard', danger: true })) return;
    S.draft = {
      match_key: key, team, station: S.config.station, scout_id: S.scoutId,
      values: emptyValues(), phase: 0, correction: false,
    };
    await save('draft', S.draft);
  }
  show('form', formScreen);
}

async function correctRecord(rec) {
  if (S.draft && !await confirmDialog(
    `Discard the unfinished ${matchLabel(S.draft.match_key)} · Team ${S.draft.team} to start this correction?`,
    { ok: 'Discard', danger: true })) return;
  // Same match + team + scout as the original, so the laptop treats it as a replacement.
  S.draft = {
    match_key: rec.match_key, team: rec.team, station: rec.station, scout_id: rec.scout_id,
    values: { ...rec.values }, phase: 0, correction: true,
  };
  await save('draft', S.draft);
  show('form', formScreen);
}

function formScreen() {
  const d = S.draft;
  let controls = {};
  let showMissing = false;

  const body = h('div', { class: 'phase-body' });
  const tabs = PHASES.map((p, i) => h('button', { class: 'tab', onclick: () => goPhase(i) }, p.label));
  const backBtn = h('button', { class: 'btn ghost', onclick: () => (d.phase > 0 ? goPhase(d.phase - 1) : route()) });
  const nextBtn = h('button', { class: 'btn primary', onclick: () => (d.phase < PHASES.length - 1 ? goPhase(d.phase + 1) : submit()) });

  function setValue(f, v) {
    d.values[f.key] = v;
    const implied = f.implies ? f.implies(v) : null;
    if (implied) {
      for (const [k, val] of Object.entries(implied)) {
        d.values[k] = val;
        if (controls[k]) controls[k].update();
      }
    }
    controls[f.key].update();
    refresh();
    save('draft', d);
  }

  function refresh() {
    const missing = new Set(missingRequired(d.values).map(f => f.key));
    tabs.forEach((t, i) => {
      t.classList.toggle('on', i === d.phase);
      t.classList.toggle('needs', showMissing && FIELDS.some(f => f.phase === PHASES[i].id && missing.has(f.key)));
    });
    for (const [k, c] of Object.entries(controls)) c.el.classList.toggle('missing', showMissing && missing.has(k));
    backBtn.textContent = d.phase > 0 ? `◀ ${PHASES[d.phase - 1].label}` : '◀ Home';
    const last = d.phase === PHASES.length - 1;
    nextBtn.textContent = last ? 'Submit ⚡' : `${PHASES[d.phase + 1].label} ▶`;
    nextBtn.classList.toggle('submit', last);
  }

  function goPhase(i) {
    d.phase = i;
    save('draft', d);
    controls = {};
    body.replaceChildren();
    for (const f of FIELDS.filter(x => x.phase === PHASES[i].id)) {
      const c = renderField(f, () => d.values[f.key], v => setValue(f, v));
      controls[f.key] = c;
      body.append(c.el);
    }
    refresh();
    window.scrollTo(0, 0);
  }

  async function submit() {
    const missing = missingRequired(d.values);
    if (missing.length) {
      showMissing = true;
      goPhase(PHASES.findIndex(p => p.id === missing[0].phase));
      toast(`Still needed: ${missing.map(f => f.label).join(', ')}`, 'bad');
      const first = controls[missing[0].key];
      if (first) first.el.scrollIntoView({ block: 'center' });
      return;
    }
    nextBtn.disabled = true;
    try {
      const rec = await saveRecord(d);
      show('qr', () => qrScreen(rec, true));
    } catch (err) {
      nextBtn.disabled = false;
      toast(`Could not save — try again (${err.message})`, 'bad');
    }
  }

  const screen = h('div', { class: `screen form-screen ${isRed(d.station) ? 'red' : 'blue'}` },
    h('div', { class: 'form-head' },
      h('div', { class: 'form-title' },
        h('span', null, matchLabel(d.match_key)),
        h('strong', { class: 'form-team' }, `Team ${d.team}`),
        stationChip(d.station),
        d.correction ? h('span', { class: 'tag warn' }, 'Correction') : null),
      h('nav', { class: 'tabs' }, tabs)),
    h('main', null, body),
    h('footer', { class: 'form-foot' }, backBtn, nextBtn));
  goPhase(d.phase || 0);
  return screen;
}

async function saveRecord(d) {
  const rec = {
    app_version: APP_VERSION, event: S.config.event, match_key: d.match_key, team: d.team,
    scout_id: d.scout_id, station: d.station, ts: Math.floor(Date.now() / 1000), values: { ...d.values },
  };
  rec.qr = encodeRecord(rec);
  rec.correction = !!d.correction;
  rec.id = await db.addRecord(rec);
  S.records.push(rec);
  S.draft = null;
  await save('draft', null);
  if (!d.correction && d.match_key === S.cursor) {
    const keys = allKeys();
    const next = keys[keys.indexOf(d.match_key) + 1];
    if (next) { S.cursor = next; save('cursor', next); }
  }
  return rec;
}

// ---------- QR + history ----------
function qrScreen(rec, fresh) {
  const superseded = S.records.some(r => r !== rec && recordKey(r) === recordKey(rec) && r.ts > rec.ts);
  return h('div', { class: 'screen' },
    topbar(fresh ? backButton('Home', route) : backButton('◀ History', () => show('history', historyScreen))),
    h('main', { class: 'qr-main' },
      fresh ? h('div', { class: 'saved-banner' }, '✓ Saved on this iPad') : null,
      h('h2', { class: 'qr-title' }, 'Show this to the scan station'),
      qrElement(rec.qr, 'qr big'),
      h('div', { class: 'qr-meta' },
        h('div', { class: 'qr-meta-main' }, `${matchLabel(rec.match_key)} · Team ${rec.team}`, stationChip(rec.station)),
        h('div', null, `${scoutName(rec.scout_id)} · ${fmtTime(rec.ts)}`),
        rec.correction ? h('span', { class: 'tag warn' }, 'Correction') : null,
        superseded ? h('span', { class: 'tag' }, 'Replaced by a newer record') : null),
      h('p', { class: 'fine' }, "Won't scan? Turn the screen brightness up."),
      fresh
        ? h('button', { class: 'btn primary big', onclick: route }, 'Next match ▶')
        : h('button', { class: 'btn', onclick: () => correctRecord(rec) }, 'Correct this record'),
      fresh ? null : valuesTable(rec)));
}

function valuesTable(rec) {
  return h('table', { class: 'values' },
    h('tbody', null, FIELDS.map(f =>
      h('tr', null, h('th', null, f.label), h('td', null, displayValue(f, rec.values[f.key]))))));
}

function historyScreen() {
  const list = [...S.records].sort((a, b) => b.ts - a.ts || b.id - a.id);
  return h('div', { class: 'screen' },
    topbar(backButton('◀ Home', route)),
    h('main', null,
      h('h1', null, 'Records on this iPad'),
      h('p', { class: 'lead' }, `${list.length} saved. Records stay on the iPad as the backup if the laptop fails.`),
      list.length
        ? h('div', { class: 'history' }, list.map(r =>
          h('button', { class: 'history-row', onclick: () => show('qr', () => qrScreen(r, false)) },
            h('span', { class: 'h-match' }, matchLabel(r.match_key)),
            h('span', { class: 'h-team' }, `Team ${r.team}`),
            h('span', { class: 'h-meta' }, `${scoutName(r.scout_id)} · ${fmtTime(r.ts)}`),
            r.correction ? h('span', { class: 'tag warn' }, 'Correction') : null)))
        : h('p', { class: 'empty' }, 'Nothing yet.')));
}

// ---------- Lead menu (PIN) ----------
async function openLead() {
  const pin = await numberPad('Lead PIN', { mask: true });
  if (pin === null) return;
  if (pin !== S.config.pin) { toast('Wrong PIN', 'bad'); return; }
  show('lead', leadScreen);
}

function leadScreen() {
  const item = (title, desc, fn, disabled = false) =>
    h('button', { class: 'menu-item', onclick: fn, disabled }, h('strong', null, title), h('span', null, desc));
  const info = h('dl', { class: 'info' });
  const addInfo = (k, v) => info.append(h('dt', null, k), h('dd', null, v));
  addInfo('App version', APP_VERSION);
  addInfo('Event · station', `${S.config.event} · ${stationLabel(S.config.station)}`);
  addInfo('Records on iPad', String(S.records.length));
  addInfo('Schedule', S.schedule ? `${S.schedule.event} rev ${S.schedule.rev}` : 'none');
  addInfo('Installed to Home Screen', isInstalled() ? 'Yes' : 'NO — install it');
  db.isPersisted().then(p => addInfo('Storage protected from eviction', p ? 'Yes' : 'Not granted'));

  return h('div', { class: 'screen' },
    topbar(backButton('◀ Home', route)),
    h('main', null,
      h('h1', null, 'Lead menu'),
      h('div', { class: 'menu' },
        item('Set team for this match', S.cursor ? `Override the team for ${matchLabel(S.cursor)}` : 'No match selected',
          overrideTeam, !S.cursor),
        item('Add a match by hand', 'When the schedule is missing a match', addManualMatch),
        item('Jump to a match', 'Choose which match is up next', () => show('jump', jumpScreen)),
        item('Show all QR codes', `Replay all ${S.records.length} records so the laptop can re-scan them`,
          () => show('replay', () => replayScreen(0)), !S.records.length),
        item('Re-scan config QR', 'Change event, station, PIN or roster', scanConfig)),
      info));
}

async function overrideTeam() {
  const key = S.cursor;
  if (S.overrides[key] && teamFor(scheduleMatches(), key, S.config.station)) {
    if (await confirmDialog(`Team ${S.overrides[key]} was set by hand for ${matchLabel(key)}. Go back to the schedule's team?`,
      { ok: "Use schedule's team", cancel: 'Enter a different team' })) {
      delete S.overrides[key];
      await save('overrides', S.overrides);
      return route();
    }
  }
  const team = await numberPad(`Team for ${matchLabel(key)}`, { maxLength: 5 });
  if (!team || Number(team) < 1) return;
  S.overrides[key] = Number(team);
  await save('overrides', S.overrides);
  toast(`${matchLabel(key)}: scouting team ${team}`, 'good');
  route();
}

async function addManualMatch() {
  const level = await modal(close => [
    h('h2', { class: 'modal-title' }, 'What kind of match?'),
    h('div', { class: 'stack' },
      h('button', { class: 'btn big', onclick: () => close('qm') }, 'Qualification'),
      h('button', { class: 'btn big', onclick: () => close('sf') }, 'Playoff'),
      h('button', { class: 'btn big', onclick: () => close('f') }, 'Final')),
    h('button', { class: 'btn ghost wide', onclick: () => close(null) }, 'Cancel'),
  ]);
  if (!level) return;
  let key;
  if (level === 'qm') {
    const n = await numberPad('Qualification match #', { maxLength: 3 });
    if (!n) return;
    key = `qm${Number(n)}`;
  } else if (level === 'sf') {
    const set = await numberPad('Playoff match # (the bracket number)', { maxLength: 2 });
    if (!set) return;
    const m = await numberPad('Replay # (1 unless this is a replay)', { maxLength: 1 });
    if (!m) return;
    key = `sf${Number(set)}m${Number(m)}`;
  } else {
    const m = await numberPad('Final match #', { maxLength: 1 });
    if (!m) return;
    key = `f1m${Number(m)}`;
  }
  if (!parseMatchKey(key)) { toast('That match number is not valid', 'bad'); return; }
  const team = await numberPad(`Team for ${matchLabel(key)}`, { maxLength: 5 });
  if (!team || Number(team) < 1) return;
  S.overrides[key] = Number(team);
  S.cursor = key;
  await save('overrides', S.overrides);
  await save('cursor', key);
  toast(`Added ${matchLabel(key)} · Team ${team}`, 'good');
  route();
}

function jumpScreen() {
  return h('div', { class: 'screen' },
    topbar(backButton('◀ Lead', () => show('lead', leadScreen))),
    h('main', null,
      h('h1', null, 'Jump to a match'),
      h('div', { class: 'history' }, allKeys().map(k => {
        const team = teamAt(k);
        return h('button', {
          class: `history-row ${k === S.cursor ? 'current' : ''}`,
          onclick: () => { S.cursor = k; save('cursor', k); route(); },
        },
        h('span', { class: 'h-match' }, matchLabel(k)),
        h('span', { class: 'h-team' }, team ? `Team ${team}` : '—'),
        team && scoutedHere(k, team) ? h('span', { class: 'h-meta' }, '✓ scouted') : null);
      }))));
}

function replayScreen(i) {
  const list = [...S.records].sort((a, b) => a.ts - b.ts || a.id - b.id);
  const rec = list[i];
  return h('div', { class: 'screen' },
    topbar(backButton('◀ Lead', () => show('lead', leadScreen))),
    h('main', { class: 'qr-main' },
      h('h2', { class: 'qr-title' }, `Record ${i + 1} of ${list.length}`),
      qrElement(rec.qr, 'qr big'),
      h('div', { class: 'qr-meta' }, `${matchLabel(rec.match_key)} · Team ${rec.team} · ${scoutName(rec.scout_id)}`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', disabled: i === 0, onclick: () => show('replay', () => replayScreen(i - 1)) }, '◀ Previous'),
        h('button', { class: 'btn primary', disabled: i === list.length - 1, onclick: () => show('replay', () => replayScreen(i + 1)) }, 'Next ▶'))));
}

// ---------- Service worker (offline cache + updates) ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    S.swReg = reg;
    const onChange = () => { if (reg.waiting && navigator.serviceWorker.controller && S.screen === 'home') route(); };
    reg.addEventListener('updatefound', () => {
      if (reg.installing) reg.installing.addEventListener('statechange', onChange);
    });
    onChange();
  }).catch(err => console.warn('Service worker registration failed', err));

  // Only reload when the scout tapped "Update now" — never because the very
  // first install took control, which would yank the screen out from under them.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) location.reload();
  });
}

let updateRequested = false;
function applyUpdate() {
  if (S.draft) { toast('Finish or discard the unfinished match first', 'bad'); return; }
  if (S.swReg && S.swReg.waiting) {
    updateRequested = true;
    S.swReg.waiting.postMessage('SKIP_WAITING');
  }
}

// ---------- Start ----------
window.addEventListener('error', e => toast(`Something went wrong: ${e.message}`, 'bad'));
window.addEventListener('unhandledrejection', e => toast(`Something went wrong: ${e.reason && e.reason.message || e.reason}`, 'bad'));

async function init() {
  try {
    const [config, schedule, pendingSchedule, scoutId, cursor, overrides, draft, records] = await Promise.all([
      db.getSetting('config'), db.getSetting('schedule'), db.getSetting('pendingSchedule'),
      db.getSetting('scoutId'), db.getSetting('cursor'), db.getSetting('overrides'),
      db.getSetting('draft'), db.allRecords(),
    ]);
    Object.assign(S, {
      config: config || null, schedule: schedule || null, pendingSchedule: pendingSchedule || null,
      scoutId: scoutId || null, cursor: cursor || null, overrides: overrides || {},
      draft: draft || null, records: records || [],
    });
  } catch (err) {
    root.replaceChildren(h('main', { class: 'center' },
      h('h1', null, 'Storage unavailable'),
      h('p', null, `This iPad blocked local storage (${err.message}). Turn off Private Browsing and reopen the app.`)));
    return;
  }
  // Reopened mid-match (crash, reload, force-quit)? Go straight back into the form.
  if (S.draft && S.config) {
    show('form', formScreen);
    toast('Restored your unfinished match', 'good');
  } else {
    route();
  }
  registerServiceWorker();
}

init();
