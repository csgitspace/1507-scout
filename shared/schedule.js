// ==============================================================================
// Match keys, match ordering, and station -> team lookup.
//
// Match keys follow The Blue Alliance's format WITHOUT the event prefix:
//   qm12    qualification match 12
//   sf3m1   playoff (semifinal bracket) set 3, match 1
//   f1m2    finals, match 2
// Playoff keys MUST include the set number. Legacy v3 dropped it, so
// different playoff matches collided (docs/legacy-audit.md, Issue 1).
// ==============================================================================

export const STATIONS = ['R1', 'R2', 'R3', 'B1', 'B2', 'B3'];

const LEVEL_ORDER = ['qm', 'ef', 'qf', 'sf', 'f'];
const KEY_RE = /^(qm|ef|qf|sf|f)(\d{1,3})(?:m(\d{1,2}))?$/;

/** "qm12" -> {level:'qm', set:null, number:12}; "sf3m1" -> {level:'sf', set:3, number:1}; invalid -> null */
export function parseMatchKey(key) {
  const m = KEY_RE.exec(String(key || ''));
  if (!m) return null;
  const level = m[1];
  if (level === 'qm') {
    if (m[3] !== undefined) return null; // quals have no set
    return { level, set: null, number: Number(m[2]) };
  }
  if (m[3] === undefined) return null; // playoffs must have a set AND a match number
  return { level, set: Number(m[2]), number: Number(m[3]) };
}

/** Accepts TBA's full key ("2026nyro_sf3m1") or a short one ("sf3m1"); returns the short key or null. */
export function shortMatchKey(key) {
  const s = String(key || '');
  const short = s.includes('_') ? s.slice(s.indexOf('_') + 1) : s;
  return parseMatchKey(short) ? short : null;
}

/** Sort comparator: quals before playoffs, then by set, then by match number. */
export function compareMatchKeys(a, b) {
  const pa = parseMatchKey(a), pb = parseMatchKey(b);
  return (LEVEL_ORDER.indexOf(pa.level) - LEVEL_ORDER.indexOf(pb.level)) ||
    ((pa.set || 0) - (pb.set || 0)) ||
    (pa.number - pb.number);
}

/** Human label: "Qual 12", "Playoff 3", "Playoff 3 (replay 2)", "Final 2". */
export function matchLabel(key) {
  const p = parseMatchKey(key);
  if (!p) return String(key);
  if (p.level === 'qm') return `Qual ${p.number}`;
  if (p.level === 'f') return `Final ${p.number}`;
  if (p.level === 'sf') return p.number === 1 ? `Playoff ${p.set}` : `Playoff ${p.set} (replay ${p.number})`;
  return `${p.level.toUpperCase()} ${p.set}-${p.number}`;
}

/** "R2" -> "Red 2" */
export function stationLabel(station) {
  return `${station[0] === 'R' ? 'Red' : 'Blue'} ${station[1]}`;
}

/** schedule: { [matchKey]: [r1, r2, r3, b1, b2, b3] } */
export function teamFor(schedule, matchKey, station) {
  const teams = schedule && schedule[matchKey];
  const i = STATIONS.indexOf(station);
  return teams && i >= 0 ? teams[i] : null;
}

/** All match keys in the schedule, in play order. */
export function orderedKeys(schedule) {
  return Object.keys(schedule || {}).sort(compareMatchKeys);
}
