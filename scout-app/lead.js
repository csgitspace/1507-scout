// Lead tools: make config + schedule QR codes, and check scout record codes.
// A stand-in until the laptop app (Milestone 2) generates these itself.

import { h } from './dom.js';
import { qrElement } from './qr.js';
import { scanQR } from './scanner.js';
import { encodeConfig, encodeSchedule } from '../shared/setup-codes.js';
import { decodeRecord } from '../shared/codec.js';
import { FIELDS } from '../shared/fields.js';
import { STATIONS, stationLabel, matchLabel } from '../shared/schedule.js';
import { parseRoster, parseScheduleText, practiceSchedule, scheduleToText } from '../shared/lead-input.js';

const $ = (id) => document.getElementById(id);

// Remember what the lead typed (this browser only; just a convenience).
const REMEMBER = ['event', 'pin', 'roster', 'schedule', 'teams', 'count'];
for (const id of REMEMBER) {
  try { const v = localStorage.getItem(`lead.${id}`); if (v !== null) $(id).value = v; } catch { /* storage blocked */ }
  $(id).addEventListener('input', () => { try { localStorage.setItem(`lead.${id}`, $(id).value); } catch { /* ignore */ } });
}

function showResult(id, message, bad = false) {
  $(id).textContent = message;
  $(id).className = `result ${bad ? 'bad' : ''}`;
}

// ---------- 1. Config ----------
$('make-config').addEventListener('click', () => {
  const out = $('config-codes');
  out.replaceChildren();
  try {
    const event = $('event').value.trim().toLowerCase();
    const pin = $('pin').value.trim();
    const roster = parseRoster($('roster').value);
    if (!roster.length) throw new Error('Add at least one scout to the roster');
    for (const station of STATIONS) {
      const code = encodeConfig({ event, station, pin, roster });
      out.append(h('div', { class: 'code-card' },
        h('h3', null, `${stationLabel(station)}`),
        qrElement(code),
        h('div', { class: 'sub' }, `${event} · ${roster.length} scouts`)));
    }
    showResult('config-result', `Scout IDs: ${roster.map(s => `${s.name} = ${s.id}`).join(' · ')}`);
  } catch (err) {
    showResult('config-result', err.message, true);
  }
});

// ---------- 2. Schedule ----------
$('make-practice').addEventListener('click', () => {
  const count = Math.min(150, Math.max(1, Number($('count').value) || 20));
  try {
    $('schedule').value = scheduleToText(practiceSchedule($('teams').value.split(/[\s,]+/), count));
    $('schedule').dispatchEvent(new Event('input'));
    showResult('schedule-result', `Filled ${count} practice matches. Now press "Make schedule codes".`);
  } catch (err) {
    showResult('schedule-result', err.message, true);
  }
});

let slides = [], slideIndex = 0, slideTimer = null;

function renderSlide() {
  const out = $('schedule-codes');
  if (!slides.length) { out.replaceChildren(); return; }
  const auto = h('input', { type: 'checkbox', checked: !!slideTimer, onchange: (e) => setAuto(e.target.checked) });
  out.replaceChildren(
    h('div', { class: 'slide-label' }, `Part ${slideIndex + 1} of ${slides.length}`),
    qrElement(slides[slideIndex]),
    h('div', { class: 'actions', style: 'justify-content:center' },
      h('button', { class: 'btn', onclick: () => go(-1) }, '◀ Previous'),
      h('button', { class: 'btn primary', onclick: () => go(1) }, 'Next ▶'),
      h('label', { style: 'display:flex;align-items:center;gap:8px;text-transform:none' }, auto, 'Auto-advance every 3 s')));
}

function go(delta) {
  slideIndex = (slideIndex + delta + slides.length) % slides.length;
  renderSlide();
}

function setAuto(on) {
  clearInterval(slideTimer);
  slideTimer = on ? setInterval(() => go(1), 3000) : null;
}

$('make-schedule').addEventListener('click', () => {
  try {
    const event = $('event').value.trim().toLowerCase();
    const matches = parseScheduleText($('schedule').value);
    if (!matches.length) throw new Error('Enter at least one match (or fill a practice schedule)');
    const rev = Date.now().toString(36).slice(-6);
    slides = encodeSchedule({ event, rev, matches });
    slideIndex = 0;
    renderSlide();
    showResult('schedule-result', `${matches.length} matches for ${event} → ${slides.length} QR part(s), revision ${rev}. ` +
      'Uses the event code from section 1.');
  } catch (err) {
    slides = [];
    renderSlide();
    showResult('schedule-result', err.message, true);
  }
});

// ---------- 3. Check a record ----------
function showRecord(text) {
  const res = decodeRecord(text, { event: $('event').value.trim().toLowerCase() || undefined });
  const out = $('record-result');
  if (!res.ok) { showResult('record-result', `✗ Rejected: ${res.reason}`, true); return res; }
  const r = res.record;
  out.className = 'result';
  out.replaceChildren(
    h('p', { style: 'color:var(--good);font-weight:800' },
      `✓ Valid record — ${matchLabel(r.match_key)} · Team ${r.team} · ${stationLabel(r.station)} · scout ${r.scout_id} · ` +
      `${new Date(r.ts * 1000).toLocaleString()} · app v${r.app_version} · ${new TextEncoder().encode(text).length} bytes`),
    h('table', { class: 'values' }, h('tbody', null, FIELDS.map(f =>
      h('tr', null, h('th', null, f.label), h('td', null, JSON.stringify(r.values[f.key])))))));
  return res;
}

$('check-record').addEventListener('click', () => showRecord($('record-text').value.trim()));
$('scan-record').addEventListener('click', () => scanQR({
  title: "Scan a scout's QR",
  onCode: (text) => {
    const res = showRecord(text);
    return res.ok
      ? { ok: true, done: true, message: '✓ Valid record' }
      : { ok: false, message: res.reason };
  },
}));
