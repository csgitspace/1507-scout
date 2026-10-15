// ==============================================================================
// Pick team dashboard — for mentors and student leads.
//
// Deployed as a web app that runs as THE PERSON VIEWING IT, signed in with
// Google. This script is bound to the scouting Sheet, so someone can only load
// data if the Sheet is shared with them. Sharing the Sheet IS the allow-list
// (docs/plans/m3). Give people Editor access so they can save their notes.
//
// Two roles (docs/plans/m5-pick-roles.md):
//   - Pick leads (emails on the Leads tab) change the OFFICIAL list: pick
//     order, Target/Backup/Avoid tags, shared notes, "Our robot needs".
//   - Everyone else sees the official list read-only, and gets "My list": their
//     own order and tags (MyPicks tab), so trying ideas never dirties the
//     official list. Everyone can keep private notes.
//   While the Leads tab is empty, everyone counts as a lead (the old behavior).
//
// Hard rule: this never writes scouting data (Raw/Summary). Pick-team
// annotations live in their own tabs (Mentor, MentorPrivate, MyPicks, Config gaps).
// ==============================================================================

var OUR_TEAM = 1507;   // left off the pick list — we can't pick ourselves
var TAGS = ['', 'Target', 'Backup', 'Avoid'];
var NOTE_MAX = 1000;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Warlocks 1507 Pick List')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Scouting Sheet not found.');
  return ss;
}

function me_() {
  return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'unknown';
}

function friendly_(fn) {
  try {
    return fn();
  } catch (err) {
    var msg = String(err && err.message || err);
    if (/permission|access|not have/i.test(msg) && !/pick lead/i.test(msg)) {
      throw new Error('You don\'t have access to the scouting Sheet. Ask the scouting lead to share it with ' + me_() +
        ' (Editor, to save notes).');
    }
    throw err;
  }
}

function mentorSheet_(ss) {
  var sh = getOrCreateSheet_(ss, TAB.MENTOR);
  ensureHeaderColumns_(sh, MENTOR_HEADERS);
  return sh;
}

function privateSheet_(ss) {
  var sh = getOrCreateSheet_(ss, TAB.PRIVATE);
  ensureHeaderColumns_(sh, PRIVATE_HEADERS);
  return sh;
}

function myPicksSheet_(ss) {
  var sh = getOrCreateSheet_(ss, TAB.MYPICKS);
  ensureHeaderColumns_(sh, MYPICKS_HEADERS);
  return sh;
}

// ---------- roles ----------
/** Lowercased emails on the Leads tab (created and protected by the sync endpoint). */
function leads_(ss) {
  var sh = ss.getSheetByName(TAB.LEADS);
  if (!sh) return [];
  return readObjects_(sh).map(function (r) { return String(r.email || '').trim().toLowerCase(); })
    .filter(function (e) { return e.indexOf('@') > 0; });
}

/** { lead, open, leadCount }. open = nobody listed yet, so everyone may edit (the pre-roles behavior). */
function role_(ss, me) {
  var list = leads_(ss);
  return { lead: !list.length || list.indexOf(String(me).toLowerCase()) >= 0, open: !list.length, leadCount: list.length };
}

function requireLead_(ss) {
  if (!role_(ss, me_()).lead) {
    throw new Error('Only pick leads can change the official list. Switch to "My list" to try your own order and tags.');
  }
}

var EXTERNAL_FIELDS_ = EXTERNAL_COLUMNS.filter(function (c) { return c !== 'team'; });

/**
 * Every team at the event: scouted ones from Summary, plus teams on the TBA
 * list or with outside data that nobody has scouted yet. Each gets its
 * External fields (EPA, OPR, rank) and the mentor tag / shared note.
 * Returns { team: object }.
 */
function allTeams_(ss) {
  var byTeam = {};
  var summary = ss.getSheetByName(TAB.SUMMARY);
  (summary ? readRows_(summary).map(rowToSummary_) : []).forEach(function (t) { t.team = Number(t.team); byTeam[t.team] = t; });
  var add = function (team, name) {
    team = Number(team);
    if (!(team >= 1)) return;
    if (!byTeam[team]) byTeam[team] = blankSummary_(team, name);
    else if (!byTeam[team].name && name) byTeam[team].name = name;
  };
  var teamsTab = ss.getSheetByName(TAB.TEAMS);
  if (teamsTab) readObjects_(teamsTab).forEach(function (t) { add(t.team_number, t.team_name); });
  var ext = {};
  var extTab = ss.getSheetByName(TAB.EXTERNAL);
  if (extTab) readObjects_(extTab).forEach(function (e) { ext[Number(e.team)] = e; add(e.team, ''); });
  var mentor = {};
  readObjects_(mentorSheet_(ss)).forEach(function (m) { mentor[Number(m.team)] = m; });

  Object.keys(byTeam).forEach(function (k) {
    var t = byTeam[k], e = ext[t.team] || {}, m = mentor[t.team] || {};
    // External 'rank' is TBA's event rank: renamed so it can't be confused with the mentors' pick rank.
    EXTERNAL_FIELDS_.forEach(function (c) { t[c === 'rank' ? 'rank_tba' : c] = e[c] === undefined ? '' : e[c]; });
    t.rank = m.rank === '' || m.rank === undefined ? null : Number(m.rank);
    t.tag = m.tag || '';
    t.shared_note = m.shared_note || '';
    t.shared_note_by = m.shared_note_by || '';
    t.shared_note_at = m.shared_note_at ? String(m.shared_note_at) : '';
  });
  return byTeam;
}

/** Everything the pick list screen needs, in one call. */
function getPickList() {
  return friendly_(function () {
    var ss = ss_();
    var me = me_();
    var cfg = kvGetAll_(ss);
    var gaps = cfg.gaps || [];
    var byTeam = allTeams_(ss);
    var teams = Object.keys(byTeam).map(function (k) { return byTeam[k]; })
      .filter(function (t) { return t.team !== OUR_TEAM; });

    var priv = {};
    readObjects_(privateSheet_(ss)).forEach(function (p) { if (p.email === me) priv[p.team] = p.note; });
    var mine = {};
    readObjects_(myPicksSheet_(ss)).forEach(function (p) { if (p.email === me) mine[Number(p.team)] = p; });

    teams.forEach(function (t) {
      var fit = fitFor(t, gaps);
      t.fit = fit.fit; t.fit_score = fit.fit_score; t.fit_reason = fit.fit_reason;
      t.private_note = priv[t.team] || '';
      var p = mine[t.team] || {};
      t.my_rank = p.rank === '' || p.rank === undefined ? null : Number(p.rank);
      t.my_tag = p.tag || '';
    });
    teams.sort(function (a, b) {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return (Number(b.strength_score) || 0) - (Number(a.strength_score) || 0) || (Number(b.epa) || 0) - (Number(a.epa) || 0) ||
        a.team - b.team;
    });

    return {
      me: me,
      now: Date.now(),
      lastSyncMs: cfg.last_sync_ms || null,
      event: cfg.event || '',
      eventName: cfg.event_name || '',
      intelFetched: cfg.intel_fetched || {},
      role: role_(ss, me),
      gaps: gaps,
      gapDefs: DRAFT.gaps.map(function (g) { return { id: g.id, label: g.label }; }),
      teams: teams,
    };
  });
}

/**
 * The six-team brief for one match. matchKey omitted -> our next match:
 * the first match with team 1507 after the latest match that's been played
 * (TBA result) or scanned. Without us in the schedule, the next match overall.
 */
function getNextMatch(matchKey) {
  return friendly_(function () {
    var ss = ss_();
    var cfg = kvGetAll_(ss);
    var matchesTab = ss.getSheetByName(TAB.MATCHES);
    var schedule = (matchesTab ? readObjects_(matchesTab) : []).map(function (m) {
      return { key: String(m.match_key), teams: [m.red1, m.red2, m.red3, m.blue1, m.blue2, m.blue3].map(Number) };
    }).filter(function (m) { return m.key; });
    schedule.sort(function (a, b) { return matchSortKey_(a.key) - matchSortKey_(b.key); });

    var results = {};
    var resultsTab = ss.getSheetByName(TAB.RESULTS);
    if (resultsTab) readObjects_(resultsTab).forEach(function (r) { results[String(r.match_key)] = r; });
    // Played through: the later of the latest TBA result and the laptop's latest scanned match.
    var played = 0;
    Object.keys(results).forEach(function (k) { played = Math.max(played, matchSortKey_(k)); });
    if (cfg.health && cfg.health.playedThrough) played = Math.max(played, matchSortKey_(cfg.health.playedThrough));

    var list = schedule.map(function (m) {
      var r = results[m.key];
      return { key: m.key, label: matchLabel_(m.key), ours: m.teams.indexOf(OUR_TEAM) >= 0,
        played: !!r || matchSortKey_(m.key) <= played,
        score: r ? [Number(r.red_score), Number(r.blue_score)] : null };
    });
    var chosen = null;
    if (matchKey) chosen = schedule.filter(function (m) { return m.key === matchKey; })[0] || null;
    if (!chosen) {
      var upcoming = schedule.filter(function (m) { return !results[m.key] && matchSortKey_(m.key) > played; });
      chosen = upcoming.filter(function (m) { return m.teams.indexOf(OUR_TEAM) >= 0; })[0] || upcoming[0] ||
        schedule[schedule.length - 1] || null;
    }

    var out = { now: Date.now(), lastSyncMs: cfg.last_sync_ms || null, event: cfg.event || '', eventName: cfg.event_name || '',
      ourTeam: OUR_TEAM, matches: list, key: null };
    if (!chosen) return out;

    var byTeam = allTeams_(ss);
    var brief = function (team) {
      var t = byTeam[team] || blankSummary_(team, '');
      t.team = team;
      t.notes = (t.notes || []).slice(-4);
      return t;
    };
    var side = function (teams) {
      var ts = teams.map(brief);
      var having = function (k) { return ts.filter(function (t) { return t[k] !== '' && t[k] !== null && t[k] !== undefined; }); };
      var sum = function (k) {
        var have = having(k);
        return have.length ? Math.round(have.reduce(function (a, t) { return a + Number(t[k]); }, 0) * 10) / 10 : null;
      };
      return { teams: ts, epa: sum('epa'), scouted: sum('avg_total'), epaCount: having('epa').length };
    };
    var r = results[chosen.key];
    out.key = chosen.key;
    out.label = matchLabel_(chosen.key);
    out.red = side(chosen.teams.slice(0, 3));
    out.blue = side(chosen.teams.slice(3, 6));
    out.result = r ? { red: Number(r.red_score), blue: Number(r.blue_score), winner: r.winner } : null;
    out.ourColor = chosen.teams.slice(0, 3).indexOf(OUR_TEAM) >= 0 ? 'red' : chosen.teams.slice(3).indexOf(OUR_TEAM) >= 0 ? 'blue' : null;
    return out;
  });
}

/** Data health: the laptop's coverage report (sent with each sync) plus freshness. */
function getDataHealth() {
  return friendly_(function () {
    var ss = ss_();
    var cfg = kvGetAll_(ss);
    return {
      now: Date.now(),
      lastSyncMs: cfg.last_sync_ms || null,
      event: cfg.event || '',
      eventName: cfg.event_name || '',
      recordsTotal: cfg.records_total || 0,
      intelFetched: cfg.intel_fetched || {},
      health: cfg.health || null,
    };
  });
}

function checkTeam_(team) {
  var n = Number(team);
  if (!(n >= 1 && n <= 99999 && Math.floor(n) === n)) throw new Error('Bad team number');
  return n;
}

function saveTag(team, tag) {
  return friendly_(function () {
    team = checkTeam_(team);
    if (TAGS.indexOf(tag) < 0) throw new Error('Bad tag');
    var ss = ss_(), me = me_(), at = new Date().toISOString();
    requireLead_(ss);
    withLock_(function () {
      upsertRow_(mentorSheet_(ss), MENTOR_HEADERS, { team: team }, { tag: tag, updated_by: me, updated_at: at });
    });
    return { ok: true };
  });
}

function saveSharedNote(team, note) {
  return friendly_(function () {
    team = checkTeam_(team);
    note = String(note || '').slice(0, NOTE_MAX);
    var ss = ss_(), me = me_(), at = new Date().toISOString();
    requireLead_(ss);
    withLock_(function () {
      upsertRow_(mentorSheet_(ss), MENTOR_HEADERS, { team: team }, {
        shared_note: cellText_(note), shared_note_by: me, shared_note_at: at, updated_by: me, updated_at: at,
      });
    });
    return { ok: true, by: me, at: at };
  });
}

function savePrivateNote(team, note) {
  return friendly_(function () {
    team = checkTeam_(team);
    note = String(note || '').slice(0, NOTE_MAX);
    var ss = ss_(), me = me_();
    withLock_(function () {
      upsertRow_(privateSheet_(ss), PRIVATE_HEADERS, { email: me, team: team },
        { note: cellText_(note), updated_at: new Date().toISOString() });
    });
    return { ok: true };
  });
}

/** OFFICIAL pick order. teams: team numbers in pick order. Teams not listed lose their rank. */
function saveRanking(teams) {
  return friendly_(function () {
    if (!Array.isArray(teams) || teams.length > 300) throw new Error('Bad ranking');
    teams = teams.map(checkTeam_);
    var ss = ss_(), me = me_(), at = new Date().toISOString();
    requireLead_(ss);
    withLock_(function () {
      var sh = mentorSheet_(ss);
      var headers = readHeaders_(sh);
      var idx = headerIndex_(headers);
      var rows = readRows_(sh);
      var byTeam = {};
      rows.forEach(function (r) { byTeam[r[idx.team]] = r; });
      teams.forEach(function (t) {
        if (!byTeam[t]) { var r = headers.map(function () { return ''; }); r[idx.team] = t; rows.push(r); byTeam[t] = r; }
      });
      rows.forEach(function (r) {
        var pos = teams.indexOf(Number(r[idx.team]));
        var rank = pos >= 0 ? pos + 1 : '';
        if (r[idx.rank] !== rank) { r[idx.rank] = rank; r[idx.updated_by] = me; r[idx.updated_at] = at; }
      });
      writeTable_(sh, headers, rows.map(function (r) { return r.slice(0, headers.length); }));
    });
    return { ok: true };
  });
}

function saveGaps(ids) {
  return friendly_(function () {
    var valid = DRAFT.gaps.map(function (g) { return g.id; });
    ids = (Array.isArray(ids) ? ids : []).filter(function (id) { return valid.indexOf(id) >= 0; });
    var ss = ss_();
    requireLead_(ss);   // "Our robot needs" drives everyone's Fit column
    kvSet_(ss, 'gaps', ids);
    return { ok: true, gaps: ids };
  });
}

// ---------- My list: anyone's own practice pick list (never touches the official one) ----------

function saveMyTag(team, tag) {
  return friendly_(function () {
    team = checkTeam_(team);
    if (TAGS.indexOf(tag) < 0) throw new Error('Bad tag');
    var ss = ss_(), me = me_();
    withLock_(function () {
      upsertRow_(myPicksSheet_(ss), MYPICKS_HEADERS, { email: me, team: team }, { tag: tag, updated_at: new Date().toISOString() });
    });
    return { ok: true };
  });
}

/**
 * Rewrites only the signed-in person's rows. teams: their pick order.
 * withTags (optional, { team: tag }) replaces their tags too, for "Start from the official list".
 */
function writeMyList_(ss, me, teams, withTags) {
  withLock_(function () {
    var sh = myPicksSheet_(ss);
    var headers = readHeaders_(sh);
    var idx = headerIndex_(headers);
    var at = new Date().toISOString();
    var rows = readRows_(sh);
    var others = rows.filter(function (r) { return r[idx.email] !== me; });
    var mineByTeam = {};
    rows.forEach(function (r) { if (r[idx.email] === me) mineByTeam[Number(r[idx.team])] = r; });
    var blank = function (team) { var r = headers.map(function () { return ''; }); r[idx.email] = me; r[idx.team] = team; return r; };
    if (withTags) Object.keys(withTags).forEach(function (t) { if (!mineByTeam[t]) mineByTeam[t] = blank(Number(t)); });
    teams.forEach(function (t) { if (!mineByTeam[t]) mineByTeam[t] = blank(t); });
    var mine = Object.keys(mineByTeam).map(function (t) {
      var r = mineByTeam[t];
      var pos = teams.indexOf(Number(t));
      r[idx.rank] = pos >= 0 ? pos + 1 : '';
      if (withTags) r[idx.tag] = withTags[t] || '';
      r[idx.updated_at] = at;
      return r;
    }).filter(function (r) { return r[idx.rank] !== '' || r[idx.tag]; });   // drop empty rows
    writeTable_(sh, headers, others.concat(mine).map(function (r) { return r.slice(0, headers.length); }));
  });
}

function saveMyRanking(teams) {
  return friendly_(function () {
    if (!Array.isArray(teams) || teams.length > 300) throw new Error('Bad ranking');
    teams = teams.map(checkTeam_);
    var ss = ss_(), me = me_();
    // Keep my tags: rewrite only ranks.
    var tags = {};
    readObjects_(myPicksSheet_(ss)).forEach(function (p) { if (p.email === me && p.tag) tags[Number(p.team)] = p.tag; });
    writeMyList_(ss, me, teams, tags);
    return { ok: true };
  });
}

/** My list := a copy of the official order and tags, as a starting point. */
function copyOfficialToMine() {
  return friendly_(function () {
    var ss = ss_(), me = me_();
    var official = readObjects_(mentorSheet_(ss));
    var ranked = official.filter(function (m) { return m.rank !== '' && m.rank !== undefined; })
      .sort(function (a, b) { return Number(a.rank) - Number(b.rank); }).map(function (m) { return Number(m.team); });
    var tags = {};
    official.forEach(function (m) { if (m.tag) tags[Number(m.team)] = m.tag; });
    writeMyList_(ss, me, ranked, tags);
    return { ok: true };
  });
}

function clearMyList() {
  return friendly_(function () {
    var ss = ss_(), me = me_();
    writeMyList_(ss, me, [], {});
    return { ok: true };
  });
}
