// ==============================================================================
// Per-team summary + pick-list levels. Pure JavaScript (no Google calls), so
// it runs in Apps Script AND in the Node tests (tests/dashboard.test.js).
//
// Ports legacy getBotSummary() with the audit's fixes:
//   - accuracy counts auto misses too (Issue 6)
//   - climb is success by level, plus attempt rate (Issue 10)
//   - no-show / dead in auto / broke down are separate rates (Issue 5)
// Two scouts on the same robot in the same match are averaged into one
// observation, so a double-scouted match doesn't count twice.
//
// FIELD-DEPENDENT: this reads 2026 field keys (auto_fuel_scored, ...). When
// shared/fields.js changes for a new game, update observe_() below.
// ==============================================================================

// ---------------------------------------------------------------------------
// DRAFT DEFINITIONS — scouting leads: change these, not the code below.
// (Open questions in CLAUDE.md: "strength", "fit", bot type "Support".)
// ---------------------------------------------------------------------------
var DRAFT = {
  // Scoring level: rank teams by average total fuel; top third High, etc.
  scoringCuts: [2 / 3, 1 / 3],          // percentile at/above -> High, Mid; below -> Low
  // Bot type: the role a team plays most; "Hybrid" if no role reaches this share.
  roleThreshold: 0.55,
  // Strength (DRAFT): scoring percentile x reliability, split into thirds.
  strength: function (t) { return t.total_pct * t.reliability; },
  strengthCuts: [2 / 3, 1 / 3],
  // Fit (DRAFT): the gaps mentors can tick for OUR robot, and how well a team fills each (0..1).
  gaps: [
    { id: 'scoring',  label: 'More scoring',     score: function (t) { return t.total_pct; },
      reason: function (t) { return 'avg ' + t.avg_total + ' fuel'; } },
    { id: 'auto',     label: 'Auto scoring',     score: function (t) { return t.auto_pct; },
      reason: function (t) { return 'auto ' + t.avg_auto + ' fuel'; } },
    { id: 'climb',    label: 'Reliable climber', score: function (t) { return t.climb_l1; },
      reason: function (t) { return 'climbs ' + pct_(t.climb_l1); } },
    { id: 'climb_l3', label: 'Level 3 climber',  score: function (t) { return t.climb_l3; },
      reason: function (t) { return 'L3 ' + pct_(t.climb_l3); } },
    { id: 'defense',  label: 'Defender',         score: function (t) { return t.defense_share; },
      reason: function (t) { return 'defends ' + pct_(t.defense_share); } },
    { id: 'feeder',   label: 'Feeder',           score: function (t) { return t.feeder_share; },
      reason: function (t) { return 'feeds ' + pct_(t.feeder_share); } },
  ],
  fitCuts: [0.6, 0.3],                  // fit score at/above -> High, Mid; below -> Low
};

// Columns of the Summary sheet, in order. *_json columns hold JSON text.
var SUMMARY_COLUMNS = [
  'team', 'name', 'matches', 'records', 'avg_auto', 'avg_teleop', 'avg_total', 'accuracy',
  'climb_attempt', 'climb_l1', 'climb_l2', 'climb_l3', 'no_show_rate', 'dead_auto_rate', 'broke_rate',
  'reliability', 'role_trend', 'bot_type', 'scorer_share', 'feeder_share', 'defense_share',
  'cycle_avg', 'total_pct', 'auto_pct', 'scoring_level', 'strength_score', 'strength',
  'last_match', 'notes_json',
];

function pct_(x) { return Math.round((x || 0) * 100) + '%'; }
function mean_(xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : 0; }
function round1_(x) { return Math.round(x * 10) / 10; }
function round3_(x) { return Math.round(x * 1000) / 1000; }

var LEVEL_ORDER_ = ['qm', 'ef', 'qf', 'sf', 'f'];
function matchSortKey_(key) {
  var m = /^(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/.exec(key) || [];
  var set = m[3] === undefined ? 0 : Number(m[2]);
  var num = m[3] === undefined ? Number(m[2] || 0) : Number(m[3]);
  return LEVEL_ORDER_.indexOf(m[1]) * 1e6 + set * 1e3 + num;
}
function matchLabel_(key) {
  var m = /^(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/.exec(key);
  if (!m) return key;
  if (m[1] === 'qm') return 'Qual ' + m[2];
  if (m[1] === 'f') return 'Final ' + m[3];
  if (m[1] === 'sf') return m[3] === '1' ? 'Playoff ' + m[2] : 'Playoff ' + m[2] + ' (replay ' + m[3] + ')';
  return m[1].toUpperCase() + ' ' + m[2] + '-' + m[3];
}

/** Newest version of each event + match + team + scout (a correction supersedes). */
function currentRecords_(records) {
  var best = {};
  records.forEach(function (r) {
    var k = r.event + '|' + r.rkey;
    var b = best[k];
    if (!b || r.ts > b.ts || (r.ts === b.ts && (r.laptop_id || 0) > (b.laptop_id || 0))) best[k] = r;
  });
  return Object.keys(best).map(function (k) { return best[k]; });
}

/** One scout's record -> the numbers the summary needs. FIELD-DEPENDENT (2026). */
function observe_(v) {
  var level = v.endgame_level === null || v.endgame_level === undefined ? 0 : v.endgame_level; // 0 None .. 3 Level 3
  return {
    noShow: v.no_show ? 1 : 0,
    deadAuto: v.dead_in_auto ? 1 : 0,
    broke: v.broke_down ? 1 : 0,
    auto: v.auto_fuel_scored || 0,
    autoMiss: v.auto_fuel_missed || 0,
    teleop: v.teleop_fuel_scored || 0,
    teleopMiss: v.teleop_fuel_missed || 0,
    attempt: v.endgame_attempt ? 1 : 0,
    l1: level >= 1 ? 1 : 0, l2: level >= 2 ? 1 : 0, l3: level >= 3 ? 1 : 0,
    role: v.primary_role === null || v.primary_role === undefined ? null : v.primary_role, // 0 Scorer, 1 Feeder, 2 Defense
    cycle: v.cycle_speed === null || v.cycle_speed === undefined ? null : v.cycle_speed,
    notes: v.notes || '',
  };
}

/**
 * records: current records [{ team, match_key, scout_id, values }]
 * teamNames: { team: name }
 * Returns one summary object per team (keys = SUMMARY_COLUMNS; notes_json parsed as `notes`).
 */
function summarizeTeams(records, teamNames) {
  teamNames = teamNames || {};
  var byTeam = {};
  records.forEach(function (r) {
    var t = byTeam[r.team] = byTeam[r.team] || {};
    (t[r.match_key] = t[r.match_key] || []).push(r);
  });

  var out = Object.keys(byTeam).map(function (team) {
    var matchKeys = Object.keys(byTeam[team]).sort(function (a, b) { return matchSortKey_(a) - matchSortKey_(b); });
    var played = [], all = [], roles = [0, 0, 0], roleTotal = 0, cycles = [], notes = [], nRecords = 0;
    matchKeys.forEach(function (mk) {
      var recs = byTeam[team][mk];
      nRecords += recs.length;
      var obs = recs.map(function (r) { return observe_(r.values || {}); });
      var avg = {};
      ['noShow', 'deadAuto', 'broke', 'auto', 'autoMiss', 'teleop', 'teleopMiss', 'attempt', 'l1', 'l2', 'l3'].forEach(function (k) {
        avg[k] = mean_(obs.map(function (o) { return o[k]; }));
      });
      all.push(avg);
      if (avg.noShow < 0.5) played.push(avg);   // capability averages skip no-shows
      obs.forEach(function (o) {
        if (o.role !== null) { roles[o.role] += 1 / obs.length; roleTotal += 1 / obs.length; }
        if (o.cycle !== null) cycles.push(o.cycle);
      });
      recs.forEach(function (r) {
        if (r.values && r.values.notes) notes.push({ match: matchLabel_(mk), scout: r.scout_id, text: r.values.notes });
      });
    });

    var col = function (rows, k) { return rows.map(function (o) { return o[k]; }); };
    var scored = mean_(col(played, 'auto')) + mean_(col(played, 'teleop'));
    var shots = scored + mean_(col(played, 'autoMiss')) + mean_(col(played, 'teleopMiss'));
    var noShow = mean_(col(all, 'noShow')), dead = mean_(col(all, 'deadAuto')), broke = mean_(col(all, 'broke'));
    var shares = roles.map(function (n) { return roleTotal ? n / roleTotal : 0; });
    var top = shares.indexOf(Math.max.apply(null, shares));
    var roleNames = ['Scorer', 'Feeder', 'Defense'];

    return {
      team: Number(team),
      name: teamNames[team] || '',
      matches: matchKeys.length,
      records: nRecords,
      avg_auto: round1_(mean_(col(played, 'auto'))),
      avg_teleop: round1_(mean_(col(played, 'teleop'))),
      avg_total: round1_(scored),
      accuracy: shots ? round3_(scored / shots) : 0,
      climb_attempt: round3_(mean_(col(played, 'attempt'))),
      climb_l1: round3_(mean_(col(played, 'l1'))),
      climb_l2: round3_(mean_(col(played, 'l2'))),
      climb_l3: round3_(mean_(col(played, 'l3'))),
      no_show_rate: round3_(noShow),
      dead_auto_rate: round3_(dead),
      broke_rate: round3_(broke),
      reliability: round3_(Math.max(0, 1 - noShow - broke - dead * 0.5)),
      role_trend: roleTotal ? roleNames[top] : '',
      bot_type: !roleTotal ? '' : shares[top] >= DRAFT.roleThreshold ? roleNames[top] : 'Hybrid',
      scorer_share: round3_(shares[0]), feeder_share: round3_(shares[1]), defense_share: round3_(shares[2]),
      cycle_avg: cycles.length ? round1_(mean_(cycles)) : '',
      last_match: matchKeys.length ? matchLabel_(matchKeys[matchKeys.length - 1]) : '',
      notes: notes.slice(-12),
    };
  });

  // Percentiles across the event, then the levels built on them.
  var withData = out.filter(function (t) { return t.matches > 0; });
  percentile_(withData, 'avg_total', 'total_pct');
  percentile_(withData, 'avg_auto', 'auto_pct');
  out.forEach(function (t) {
    t.total_pct = t.total_pct || 0;
    t.auto_pct = t.auto_pct || 0;
    t.scoring_level = level_(t.total_pct, DRAFT.scoringCuts);
    t.strength_score = round3_(DRAFT.strength(t));
  });
  percentile_(withData, 'strength_score', 'strength_pct');
  out.forEach(function (t) {
    t.strength = level_(t.strength_pct || 0, DRAFT.strengthCuts);
    delete t.strength_pct;
  });
  return out.sort(function (a, b) { return b.strength_score - a.strength_score || a.team - b.team; });
}

/** Sets t[outKey] = fraction of other teams this team beats (ties share), 0..1. */
function percentile_(teams, key, outKey) {
  var n = teams.length;
  teams.forEach(function (t) {
    if (n <= 1) { t[outKey] = 1; return; }
    var below = 0, equal = 0;
    teams.forEach(function (o) { if (o[key] < t[key]) below++; else if (o[key] === t[key]) equal++; });
    t[outKey] = round3_((below + (equal - 1) / 2) / (n - 1));
  });
}

function level_(x, cuts) { return x >= cuts[0] ? 'High' : x >= cuts[1] ? 'Mid' : 'Low'; }

/** Fit of one team against the gaps mentors ticked. Returns { fit, fit_score, fit_reason }. */
function fitFor(t, gapIds) {
  var gaps = DRAFT.gaps.filter(function (g) { return (gapIds || []).indexOf(g.id) >= 0; });
  if (!gaps.length || !t.matches) return { fit: '', fit_score: 0, fit_reason: gaps.length ? 'no data yet' : 'set our gaps' };
  var parts = gaps.map(function (g) { return { s: Math.max(0, Math.min(1, g.score(t) || 0)), why: g.reason(t) }; });
  var score = mean_(parts.map(function (p) { return p.s; })) * (0.5 + 0.5 * t.reliability);
  parts.sort(function (a, b) { return b.s - a.s; });
  return {
    fit: level_(score, DRAFT.fitCuts),
    fit_score: round3_(score),
    fit_reason: parts.slice(0, 2).map(function (p) { return p.why; }).join(', '),
  };
}

/** Summary object -> sheet row, and back. */
function summaryToRow_(t) {
  return SUMMARY_COLUMNS.map(function (c) { return c === 'notes_json' ? JSON.stringify(t.notes || []) : t[c]; });
}
function rowToSummary_(row) {
  var t = {};
  SUMMARY_COLUMNS.forEach(function (c, i) {
    if (c === 'notes_json') { try { t.notes = JSON.parse(row[i] || '[]'); } catch (e) { t.notes = []; } } else t[c] = row[i];
  });
  return t;
}

if (typeof module !== 'undefined') {
  module.exports = { DRAFT: DRAFT, SUMMARY_COLUMNS: SUMMARY_COLUMNS, currentRecords_: currentRecords_,
    summarizeTeams: summarizeTeams, fitFor: fitFor, summaryToRow_: summaryToRow_, rowToSummary_: rowToSummary_, matchLabel_: matchLabel_ };
}
