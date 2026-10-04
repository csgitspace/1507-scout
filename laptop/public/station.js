// ==============================================================================
// Scan station page. Talks to the local server (laptop/api.js) over JSON.
// Reuses the iPad app's DOM helpers, QR renderer and webcam scanner.
// ==============================================================================

import { h, toast } from '/scout-app/dom.js';
import { qrElement } from '/scout-app/qr.js';
import { scanQR } from '/scout-app/scanner.js';
import { FIELDS, displayValue } from '/shared/fields.js';
import { matchLabel, stationLabel, STATIONS } from '/shared/schedule.js';

const $ = (id) => document.getElementById(id);
let state = null;
let tab = 'scan';
let webcamOpen = false;

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${res.status} ${res.statusText}`);
  return json;
}

const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const scoutName = (id) => (state?.roster.find(s => s.id === id) || {}).name || id;

// ---------- Sound: high beep = accepted, low buzz = rejected ----------
let audio;
function beep(kind) {
  try {
    audio ||= new AudioContext();
    const tones = { good: [[880, 0.12]], warn: [[880, 0.1], [660, 0.16]], bad: [[220, 0.35]], info: [[660, 0.1]] }[kind];
    let t = audio.currentTime;
    for (const [freq, dur] of tones) {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = kind === 'bad' ? 'square' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t); osc.stop(t + dur);
      t += dur + 0.04;
    }
  } catch { /* no audio available */ }
}

// ---------- Tabs ----------
function showTab(name) {
  tab = name;
  document.querySelectorAll('.station-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.id !== `tab-${name}`; });
  refresh();
}
document.querySelectorAll('.station-tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- State / header ----------
async function loadState() {
  state = await api('/api/state');
  $('event-chip').textContent = state.event ? `${state.event}${state.eventName ? ` · ${state.eventName}` : ''}` : 'No event — see Event setup';
  const c = state.counts;
  $('counts').textContent = `${c.current} current records · ${c.scans} scans (${c.rejected} rejected)`;
}

// ---------- Scan ----------
function describe(r) {
  if (!r.accepted) return { kind: 'bad', big: '✗ Rejected', sub: r.reason };
  const rec = r.record;
  const who = `${matchLabel(rec.match_key)} · Team ${rec.team}`;
  const detail = `${stationLabel(rec.station)} · ${scoutName(rec.scout_id)}`;
  const warn = r.warnings && r.warnings.length ? r.warnings.join(' · ') : null;
  switch (r.outcome) {
    case 'new': return { kind: warn ? 'warn' : 'good', big: `✓ ${who}`, sub: `${detail} · saved`, warn };
    case 'replaces': return { kind: warn ? 'warn' : 'good', big: `✓ ${who}`, sub: `${detail} · correction — replaces the earlier record`, warn };
    case 'older': return { kind: 'warn', big: `${who}`, sub: `${detail} · saved, but a newer version is already here`, warn };
    case 'rescan': return { kind: 'info', big: `Already have it: ${who}`, sub: `${detail} · nothing new`, warn: null };
  }
  return { kind: 'info', big: r.outcome, sub: '' };
}

function showResult(r) {
  const d = describe(r);
  const el = $('result');
  el.className = `result ${d.kind}`;
  el.replaceChildren(...[
    h('div', { class: 'result-big' }, d.big),
    h('div', { class: 'result-sub' }, d.sub),
    d.warn && h('div', { class: 'result-warn' }, `⚠ ${d.warn}`),
  ].filter(Boolean));
  void el.offsetWidth; // restart the flash animation
  el.classList.add('flash');
  beep(d.kind);
  return d;
}

async function doScan(text, source) {
  if (!text.trim()) return null;
  try {
    const r = await api('/api/scan', { text, source });
    const d = showResult(r);
    refreshScanSide();
    refreshSync();
    return { r, d };
  } catch (err) {
    showResult({ accepted: false, reason: `Scan station error: ${err.message}` });
    return null;
  }
}

$('scan-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const text = e.target.value;
  e.target.value = '';
  doScan(text, 'imager');
});

// Keep the scanner box focused on the Scan tab, so an imager "typing" always lands in it.
setInterval(() => {
  if (tab !== 'scan' || webcamOpen || !document.hasFocus()) return;
  const a = document.activeElement;
  if (a && a !== $('scan-input') && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) return;
  $('scan-input').focus();
}, 500);

$('webcam-btn').addEventListener('click', async () => {
  webcamOpen = true;
  await scanQR({
    title: 'Webcam scanning',
    hint: "Hold each iPad's QR code up to the camera. Close when done.",
    onCode: async (text) => {
      const out = await doScan(text, 'webcam');
      if (!out) return { ok: false, message: 'Scan station error' };
      return { ok: out.r.accepted, message: `${out.d.big} — ${out.d.sub}` };
    },
  });
  webcamOpen = false;
  $('scan-input').focus();
});

async function refreshScanSide() {
  const [{ scans }, cov] = await Promise.all([api('/api/records'), api('/api/coverage'), loadState()]);
  $('recent').replaceChildren(...scans.slice(0, 12).map(s => h('div', {
    class: `recent-row ${!s.accepted ? 'rejected' : s.reason ? 'warned' : 'accepted'}`,
  },
  h('span', { class: 'fine' }, fmtTime(s.scanned_at)),
  h('strong', null, s.accepted ? `${matchLabel(s.match_key)} · ${s.team} · ${stationLabel(s.station)}` : 'Rejected'),
  h('span', { class: 'tag' }, s.outcome),
  s.reason ? h('span', { class: 'why' }, s.reason) : null)));
  if (!scans.length) $('recent').replaceChildren(h('p', { class: 'fine' }, 'No scans yet.'));
  renderMissingMini(cov);
}

function renderMissingMini(cov) {
  const badge = $('missing-badge');
  badge.hidden = !cov.totals.missing;
  badge.textContent = cov.totals.missing;
  $('missing-mini').replaceChildren(cov.missing.length
    ? h('div', { class: 'mini-missing' }, cov.missing.slice(-30).map(m => h('span', null, `${m.label.replace('Qual ', 'Q')} ${m.station}`)))
    : h('p', { class: 'fine' }, cov.playedThrough ? `Nothing missing through ${matchLabel(cov.playedThrough)} ✓` : 'No matches scanned yet.'));
}

// ---------- Coverage ----------
async function refreshCoverage() {
  const cov = await api('/api/coverage');
  renderMissingMini(cov);
  const sel = $('played');
  const current = state.playedThrough || '';
  sel.replaceChildren(
    h('option', { value: '' }, `Auto (latest scanned${cov.auto && cov.playedThrough ? `: ${matchLabel(cov.playedThrough)}` : ''})`),
    ...state.matchKeys.map(k => h('option', { value: k }, matchLabel(k))));
  sel.value = current;

  const t = cov.totals;
  $('cov-summary').textContent = !state.matchKeys.length ? 'No schedule yet — import one on the Event setup screen.'
    : !cov.playedThrough ? 'No matches scanned yet.'
      : t.missing ? `Missing ${t.missing} of ${t.slots} through ${matchLabel(cov.playedThrough)}: ` +
        cov.missing.map(m => `${m.label.replace('Qual ', 'Q')} ${stationLabel(m.station)}`).join(', ')
        : `All ${t.slots} scans in through ${matchLabel(cov.playedThrough)} ✓`;

  const cellEl = (c) => {
    const team = c.status === 'mismatch' ? c.records.map(r => r.team).join('/') : String(c.expected);
    const note = c.status === 'missing' ? 'missing'
      : c.status === 'mismatch' ? `schedule: ${c.expected}`
        : c.records.map(r => scoutName(r.scout_id)).join(', ');
    const title = c.records.map(r => `${r.team} by ${scoutName(r.scout_id)}`).join('\n') || 'not scanned';
    return h('td', { class: `cell ${c.status}`, title }, team, h('small', null, note));
  };
  const head = h('thead', null, h('tr', null, h('th', null, 'Match'),
    ...STATIONS.map(s => h('th', { class: s[0] === 'R' ? 'red' : 'blue' }, stationLabel(s)))));
  const body = h('tbody', null, [...cov.rows].reverse().map(row =>
    h('tr', null, h('td', { class: 'match' }, row.label), ...row.cells.map(cellEl))));
  $('cov-grid').replaceChildren(head, body);

  $('cov-extras').replaceChildren(cov.extras.length ? h('div', null,
    h('h3', null, 'Records for matches not in the schedule'),
    h('p', { class: 'fine' }, cov.extras.map(e => `${e.label} ${stationLabel(e.station)} team ${e.team} (${scoutName(e.scout_id)})`).join(' · ')))
    : '');
}

$('played').addEventListener('change', async (e) => {
  await api('/api/played', { key: e.target.value || null });
  await loadState();
  refreshCoverage();
});

// ---------- Records ----------
const SUMMARY_FIELDS = ['auto_fuel_scored', 'teleop_fuel_scored', 'teleop_fuel_missed', 'endgame_level', 'primary_role', 'cycle_speed']
  .map(k => FIELDS.find(f => f.key === k)).filter(Boolean);

async function refreshRecords() {
  const { records, scans } = await api('/api/records');
  const filter = $('records-filter').value.trim();
  const shown = filter ? records.filter(r => String(r.team).startsWith(filter)) : records;
  $('records-count').textContent = `(${shown.length}${filter ? ` of ${records.length}` : ''})`;
  $('records-table').replaceChildren(
    h('thead', null, h('tr', null, ['Match', 'Team', 'Station', 'Scout', ...SUMMARY_FIELDS.map(f => f.label), 'Notes', 'Received']
      .map(x => h('th', null, x)))),
    h('tbody', null, shown.map(r => h('tr', null,
      h('td', null, matchLabel(r.match_key)), h('td', null, h('strong', null, String(r.team))),
      h('td', null, r.station), h('td', null, r.scout_name),
      ...SUMMARY_FIELDS.map(f => h('td', null, displayValue(f, r.values[f.key]))),
      h('td', { class: 'reason' }, r.values.notes || ''),
      h('td', { class: 'fine' }, fmtTime(r.received_at))))));
  $('scan-log').replaceChildren(
    h('thead', null, h('tr', null, ['Time', 'Source', 'Outcome', 'Record', 'Reason / warning'].map(x => h('th', null, x)))),
    h('tbody', null, scans.map(s => h('tr', { class: s.accepted ? '' : 'rejected' },
      h('td', null, fmtTime(s.scanned_at)), h('td', null, s.source || ''), h('td', null, s.outcome),
      h('td', null, s.accepted ? `${matchLabel(s.match_key)} · ${s.team} · ${s.station} · ${s.scout_id}` : ''),
      h('td', { class: 'reason' }, s.reason || '')))));
}
$('records-filter').addEventListener('input', refreshRecords);

// ---------- Setup ----------
function fillSetup() {
  $('s-event').value ||= state.event || '';
  $('s-pin').value ||= state.pin || '';
  $('s-roster').value ||= state.rosterText || '';
  $('tba-status').textContent = state.hasTbaKey ? '(saved ✓)' : '(not set)';
  $('sched-status').textContent = state.matchKeys.length
    ? `— ${state.matchKeys.length} matches loaded (rev ${state.scheduleRev})${state.teams ? `, ${state.teams} teams` : ''}`
    : '— none loaded';
}

function message(id, text, good = true) {
  $(id).textContent = text;
  $(id).className = good ? 'msg-good' : 'msg-bad';
}

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    state = await api('/api/settings', {
      event: $('s-event').value, pin: $('s-pin').value, roster: $('s-roster').value, tbaKey: $('s-tba').value,
    });
    $('s-tba').value = '';
    $('s-roster').value = state.rosterText;
    message('settings-msg', `Saved. Scout IDs: ${state.roster.map(s => s.id).join(', ')}`);
    await loadState();
    fillSetup();
  } catch (err) {
    message('settings-msg', err.message, false);
  }
});

async function scheduleAction(fn, msgId) {
  try {
    const r = await fn();
    message(msgId, r.note || `Loaded ${r.matches} matches${r.teams ? ` and ${r.teams} teams` : ''}${r.name ? ` for ${r.name}` : ''}. ` +
      'Show the schedule codes to the iPads.', !r.note);
    await loadState();
    fillSetup();
  } catch (err) {
    message(msgId, err.message, false);
  }
}
$('tba-import').addEventListener('click', () => scheduleAction(() => api('/api/schedule/tba', {}), 'tba-msg'));
$('sched-save').addEventListener('click', () => scheduleAction(() => api('/api/schedule', { text: $('sched-text').value }), 'sched-msg'));
$('sched-practice').addEventListener('click', () => scheduleAction(() =>
  api('/api/schedule', { practice: { teams: $('p-teams').value, count: $('p-count').value } }), 'sched-msg'));

let slideTimer = null;
$('show-config').addEventListener('click', async () => {
  clearInterval(slideTimer);
  try {
    const codes = await api('/api/codes');
    $('codes').replaceChildren(h('div', { class: 'codes' }, codes.config.map(c => h('div', { class: 'code-card' },
      h('h3', null, stationLabel(c.station)), qrElement(c.code), h('div', { class: 'sub' }, `${codes.event} · ${state.roster.length} scouts`)))));
  } catch (err) { toast(err.message, 'bad'); }
});
$('show-schedule').addEventListener('click', async () => {
  clearInterval(slideTimer);
  try {
    const codes = await api('/api/codes');
    if (!codes.schedule.length) { toast('Load a schedule first', 'bad'); return; }
    let i = 0;
    const render = () => $('codes').replaceChildren(h('div', { class: 'slideshow' },
      h('div', { class: 'slide-label' }, `Schedule part ${i + 1} of ${codes.schedule.length} · ${codes.matches} matches`),
      qrElement(codes.schedule[i]),
      h('div', { class: 'actions', style: 'justify-content:center' },
        h('button', { class: 'btn', onclick: () => { i = (i - 1 + codes.schedule.length) % codes.schedule.length; render(); } }, '◀ Previous'),
        h('button', { class: 'btn primary', onclick: () => { i = (i + 1) % codes.schedule.length; render(); } }, 'Next ▶'))));
    render();
    if (codes.schedule.length > 1) slideTimer = setInterval(() => { i = (i + 1) % codes.schedule.length; render(); }, 3000);
  } catch (err) { toast(err.message, 'bad'); }
});

// ---------- Dashboard sync ----------
const ago = (ms) => {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : `${m} min ago`;
};

function renderSync(s) {
  const line = $('sync-line');
  let main, cls;
  if (!s.configured) { main = 'Not set up'; cls = 'bad'; }
  else if (s.running) { main = 'Syncing…'; cls = ''; }
  else if (s.lastError) { main = `⚠ ${s.lastError}`; cls = 'bad'; }
  else if (s.lastSuccess) { main = `✓ Synced ${ago(s.lastSuccess)}`; cls = Date.now() - s.lastSuccess > 10 * 60000 ? 'bad' : 'ok'; }
  else { main = 'Waiting for first sync'; cls = ''; }
  const detail = [
    `${s.pending} record${s.pending === 1 ? '' : 's'} waiting`,
    s.lastSuccess && s.lastError ? `last good sync ${ago(s.lastSuccess)}` : null,
    !s.configured ? 'Run  npm run dashboard:push  on this laptop, or enter the sync URL + token on Event setup' : null,
  ].filter(Boolean).join(' · ');
  line.className = `sync-line ${cls}`;
  line.replaceChildren(main, h('span', { class: 'fine' }, detail));
  const link = $('dash-link');
  link.hidden = !s.dashboardUrl;
  if (s.dashboardUrl) link.href = s.dashboardUrl;
  $('sync-source').textContent = s.configured ? `— using ${s.source}` : '— not set up';
}

async function refreshSync() { renderSync(await api('/api/sync')); }

async function syncNow(msgId) {
  renderSync({ ...(await api('/api/sync')), running: true });
  const s = await api('/api/sync/now', {});
  renderSync(s);
  if (msgId) message(msgId, s.lastError ? s.lastError : `Synced ✓ (${s.lastAdded} new rows)`, !s.lastError);
}
$('sync-now').addEventListener('click', () => syncNow().catch(err => toast(err.message, 'bad')));
$('sync-test').addEventListener('click', () => syncNow('sync-msg').catch(err => message('sync-msg', err.message, false)));
$('sync-save').addEventListener('click', async () => {
  try {
    const body = { url: $('sync-url').value, dashboardUrl: $('dash-url').value };
    if ($('sync-token').value.trim()) body.token = $('sync-token').value;
    renderSync(await api('/api/sync/config', body));
    $('sync-token').value = '';
    message('sync-msg', 'Saved');
  } catch (err) { message('sync-msg', err.message, false); }
});

// ---------- Refresh loop ----------
async function refresh() {
  try {
    await loadState();
    refreshSync();
    if (tab === 'scan') await refreshScanSide();
    else if (tab === 'coverage') await refreshCoverage();
    else if (tab === 'records') await refreshRecords();
    else if (tab === 'setup') fillSetup();
  } catch (err) {
    toast(`Can't reach the scan station server — is it still running? (${err.message})`, 'bad');
  }
}
setInterval(() => { if (tab !== 'setup' && !webcamOpen) refresh(); }, 5000);
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }, 1000);

refresh().then(() => { if (!state.event) showTab('setup'); });
