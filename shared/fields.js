// ==============================================================================
// THE scouting field list. This is the only file you edit to change what
// scouts record. The iPad form, the QR record format, and the laptop decoder
// are all generated from it.
//
// Before adding or changing a field, check docs/data-requirements.md — every
// field must trace back to a decision the team makes at competition.
//
// When you change FIELDS in any way (add, remove, reorder, change options),
// bump SCHEMA_VERSION. The laptop rejects scans whose schema version doesn't
// match, so old iPads can't send data that gets decoded wrong.
//
// Field types:
//   bool     on/off toggle                      encoded "1" / "0"
//   counter  +/- steppers, whole number >= 0    encoded as the number
//   enum     pick exactly one option            encoded as option index, "" = not answered
//   multi    pick any number of options         encoded as a bit mask number
//   rating   1..max                             encoded as the number, "" = not answered
//   text     free text, capped at maxLength     encoded as-is (pipes/newlines removed)
//
// requiredUnless: an enum/rating must be answered before submit, UNLESS one
// of the listed bool fields is on (e.g. a no-show robot has no start position).
// ==============================================================================

// Game: 2026 REBUILT. Replace this list when the 2027 game is revealed.
// v2 (2026-10-15): added route_used (trench / bump).
export const SCHEMA_VERSION = 2;

export const PHASES = [
  { id: 'auto',    label: 'Auto' },
  { id: 'teleop',  label: 'Teleop' },
  { id: 'endgame', label: 'Endgame' },
  { id: 'wrapup',  label: 'Wrap-up' },
];

const SKIP_IF_ABSENT = ['no_show', 'dead_in_auto'];

export const FIELDS = [
  // --- Auto ---
  { key: 'no_show', phase: 'auto', type: 'bool',
    label: 'No show', help: 'Robot never came onto the field' },
  { key: 'auto_start_position', phase: 'auto', type: 'enum',
    label: 'Starting position', options: ['In front of Hub', 'Left of Hub', 'Right of Hub'],
    requiredUnless: ['no_show'] },
  { key: 'auto_fuel_scored', phase: 'auto', type: 'counter', tone: 'good',
    label: 'Auto fuel scored' },
  { key: 'auto_fuel_missed', phase: 'auto', type: 'counter', tone: 'bad',
    label: 'Auto fuel missed' },
  { key: 'auto_climb', phase: 'auto', type: 'bool',
    label: 'Climbed in auto' },
  { key: 'dead_in_auto', phase: 'auto', type: 'bool',
    label: 'Dead in auto', help: "On the field but didn't move" },

  // --- Teleop ---
  { key: 'teleop_fuel_scored', phase: 'teleop', type: 'counter', tone: 'good',
    label: 'Fuel scored' },
  { key: 'teleop_fuel_missed', phase: 'teleop', type: 'counter', tone: 'bad',
    label: 'Fuel missed' },
  { key: 'pickup_sources', phase: 'teleop', type: 'multi',
    label: 'Picked up fuel from', options: ['Floor', 'Depot', 'Outpost'] },
  { key: 'route_used', phase: 'teleop', type: 'multi',
    label: 'Drove through', options: ['Under the trench', 'Over the bump'],
    help: 'Everything you saw this match (auto or teleop)' },
  { key: 'broke_down', phase: 'teleop', type: 'bool',
    label: 'Broke down', help: 'Stopped working during the match' },

  // --- Endgame ---
  { key: 'endgame_attempt', phase: 'endgame', type: 'bool',
    label: 'Attempted climb' },
  { key: 'endgame_level', phase: 'endgame', type: 'enum',
    label: 'Climb level reached', options: ['None', 'Level 1', 'Level 2', 'Level 3'],
    requiredUnless: SKIP_IF_ABSENT,
    // Reaching a level means they attempted — keep the two fields consistent.
    implies: (value) => (value > 0 ? { endgame_attempt: true } : null) },

  // --- Wrap-up ---
  { key: 'primary_role', phase: 'wrapup', type: 'enum',
    label: 'Primary role', options: ['Scorer', 'Feeder', 'Defense'],
    requiredUnless: SKIP_IF_ABSENT },
  { key: 'cycle_speed', phase: 'wrapup', type: 'rating', max: 5,
    label: 'Cycle speed', lowLabel: 'Very slow', highLabel: 'Very fast',
    requiredUnless: SKIP_IF_ABSENT },
  { key: 'notes', phase: 'wrapup', type: 'text', maxLength: 200,
    label: 'Notes', help: 'What would a mentor want to know at alliance selection?' },
];

// ------------------------------------------------------------------------------
// PIT scouting: asked once per team, in their pit (an iPad set to "Pit scout").
// Same field types and rules as above; bump PIT_SCHEMA_VERSION on any change.
// requiredUnless: [] = always required.
// ------------------------------------------------------------------------------
export const PIT_SCHEMA_VERSION = 1;

export const PIT_PHASES = [
  { id: 'robot', label: 'Robot' },
  { id: 'shoot', label: 'Shooting & auto' },
  { id: 'climb', label: 'Climb & notes' },
];

const YES_NO = ['Yes', 'No'];

export const PIT_FIELDS = [
  // --- Robot ---
  { key: 'drivetrain', phase: 'robot', type: 'enum',
    label: 'Drivetrain', options: ['Swerve', 'Tank / West Coast', 'Mecanum', 'Other'], requiredUnless: [] },
  { key: 'fits_trench', phase: 'robot', type: 'enum',
    label: 'Fits under the trench?', options: YES_NO, requiredUnless: [] },
  { key: 'crosses_bump', phase: 'robot', type: 'enum',
    label: 'Drives over the bump?', options: YES_NO },
  { key: 'hopper_capacity', phase: 'robot', type: 'counter',
    label: 'Hopper capacity (fuel)' },

  // --- Shooting & auto ---
  { key: 'shooter_type', phase: 'shoot', type: 'enum',
    label: 'Shooter type', options: ['Fixed', 'Adjustable hood', 'Turret', 'No shooter'], requiredUnless: [] },
  { key: 'shooter_count', phase: 'shoot', type: 'counter', steps: [1],
    label: 'Number of shooters' },
  { key: 'shoots_moving', phase: 'shoot', type: 'enum',
    label: 'Shoots while moving?', options: YES_NO },
  { key: 'auto_starts', phase: 'shoot', type: 'multi',
    label: 'Auto start positions they can run', options: ['In front of Hub', 'Left of Hub', 'Right of Hub'] },
  { key: 'auto_best_fuel', phase: 'shoot', type: 'counter',
    label: 'Fuel in their best auto (claimed)' },
  { key: 'auto_climb_claim', phase: 'shoot', type: 'enum',
    label: 'Climbs in auto?', options: YES_NO },
  { key: 'auto_notes', phase: 'shoot', type: 'text', maxLength: 150,
    label: 'Their autos', help: 'e.g. "Left: 8 fuel + climb. Center: 5 fuel."' },

  // --- Climb & notes ---
  { key: 'climb_claim', phase: 'climb', type: 'enum',
    label: 'Highest climb (claimed)', options: ['None', 'Level 1', 'Level 2', 'Level 3'], requiredUnless: [] },
  { key: 'pit_notes', phase: 'climb', type: 'text', maxLength: 200,
    label: 'Notes', help: 'Anything a mentor should know: strengths, worries, what they want in a partner' },
];

/** A blank set of values for a new form (match by default). Unanswered enums/ratings are null. */
export function emptyValues(fields = FIELDS) {
  const v = {};
  for (const f of fields) {
    if (f.type === 'bool') v[f.key] = false;
    else if (f.type === 'counter' || f.type === 'multi') v[f.key] = 0;
    else if (f.type === 'text') v[f.key] = '';
    else v[f.key] = null; // enum, rating
  }
  return v;
}

/** Human-readable value, e.g. enum index 1 -> "Left of Hub". Used on the iPad, the laptop and in exports. */
export function displayValue(f, v) {
  switch (f.type) {
    case 'bool': return v ? 'Yes' : 'No';
    case 'enum': return v === null || v === undefined ? '—' : f.options[v];
    case 'multi': return f.options.filter((_, i) => v & (1 << i)).join(', ') || 'None';
    case 'rating': return v === null || v === undefined ? '—' : `${v} / ${f.max}`;
    case 'text': return v || '—';
    default: return String(v);
  }
}

/** Fields that still need an answer before this form can be submitted. */
export function missingRequired(values, fields = FIELDS) {
  return fields.filter(f =>
    f.requiredUnless &&
    (values[f.key] === null || values[f.key] === undefined) &&
    !f.requiredUnless.some(k => values[k] === true));
}
