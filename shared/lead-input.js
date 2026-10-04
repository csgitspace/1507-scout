// ==============================================================================
// Parsing what the scouting lead types: the scout roster and a schedule.
// Used by the laptop app and by lead tools, so both follow the same rules.
// ==============================================================================

import { SCOUT_ID_RE } from './codec.js';
import { shortMatchKey } from './schedule.js';

/**
 * One scout per line: "ada, Ada L." -> {id:'ada', name:'Ada L.'}
 * or just a name: "Priya K." -> {id:'priyak', name:'Priya K.'}.
 * IDs come from the name (not the line order), so reordering the list
 * doesn't change anyone's ID. Duplicate IDs get a number added.
 */
export function parseRoster(text) {
  const used = new Set();
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    let id, name;
    const comma = line.indexOf(',');
    if (comma > 0 && SCOUT_ID_RE.test(line.slice(0, comma).trim())) {
      id = line.slice(0, comma).trim();
      name = line.slice(comma + 1).trim();
    } else {
      name = line;
      id = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'scout';
    }
    let unique = id, n = 2;
    while (used.has(unique)) unique = `${id.slice(0, 10)}${n++}`;
    used.add(unique);
    return { id: unique, name };
  });
}

/** Roster back to editable text. */
export function rosterToText(roster) {
  return (roster || []).map(s => `${s.id}, ${s.name}`).join('\n');
}

/**
 * One match per line: "qm12, 1507, 254, 1114, 118, 2056, 33" (red 1-3 then blue 1-3).
 * Accepts TBA's full keys too ("2026nyro_qm12"). Throws with the line number on bad input.
 */
export function parseScheduleText(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map((line, i) => {
    const [rawKey, ...teams] = line.split(/[\s,]+/).filter(Boolean);
    const key = shortMatchKey(rawKey);
    if (!key) throw new Error(`Line ${i + 1}: "${rawKey}" isn't a match key (qm12, sf3m1, f1m2)`);
    if (teams.length !== 6 || teams.some(t => !/^\d{1,5}$/.test(t))) {
      throw new Error(`Line ${i + 1}: needs 6 team numbers, found "${teams.join(' ')}"`);
    }
    return { key, teams: teams.map(Number) };
  });
}

export function scheduleToText(matches) {
  return matches.map(m => `${m.key}, ${m.teams.join(', ')}`).join('\n');
}

/** A random practice schedule from a list of team numbers (like v3's practice mode). */
export function practiceSchedule(teams, count) {
  const unique = [...new Set(teams.map(Number).filter(n => n >= 1))];
  if (unique.length < 6) throw new Error('Need at least 6 practice team numbers');
  const matches = [];
  for (let i = 1; i <= count; i++) {
    const shuffled = [...unique].sort(() => Math.random() - 0.5);
    matches.push({ key: `qm${i}`, teams: shuffled.slice(0, 6) });
  }
  return matches;
}
