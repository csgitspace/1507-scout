// ==============================================================================
// The Blue Alliance (TBA) API v3: one-shot import of an event's schedule and
// teams. Needs internet (the USB-tethered phone at an event). The periodic
// fetch of results comes in Milestone 4.
// ==============================================================================

import { shortMatchKey } from '../shared/schedule.js';

const BASE = 'https://www.thebluealliance.com/api/v3';

export async function tbaGet(path, apiKey, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(BASE + path, { headers: { 'X-TBA-Auth-Key': apiKey } });
  } catch (err) {
    throw new Error(`Can't reach The Blue Alliance — is the phone tethered? (${err.message})`);
  }
  if (res.status === 401) throw new Error('TBA rejected the API key — check it on the Event setup screen');
  if (res.status === 404) throw new Error('TBA has no event with that code');
  if (!res.ok) throw new Error(`TBA error ${res.status}`);
  return res.json();
}

/** "frc1507" -> 1507 (also handles B-teams like "frc1507B" -> 1507). */
const teamNumber = (k) => parseInt(String(k).replace(/^frc/, ''), 10);

/** TBA /matches/simple -> [{ key, teams: [r1, r2, r3, b1, b2, b3] }], skipping matches without 3 v 3 teams. */
export function parseTbaMatches(matches) {
  const out = [];
  for (const m of matches || []) {
    const key = shortMatchKey(m.key);
    const red = m.alliances?.red?.team_keys || [];
    const blue = m.alliances?.blue?.team_keys || [];
    if (!key || red.length < 3 || blue.length < 3) continue;
    const teams = [...red.slice(0, 3), ...blue.slice(0, 3)].map(teamNumber);
    if (teams.every(t => t >= 1)) out.push({ key, teams });
  }
  return out;
}

/** TBA /teams/simple -> [{ team, name }] */
export function parseTbaTeams(teams) {
  return (teams || []).map(t => ({ team: t.team_number, name: t.nickname || '' }));
}

/** Fetches the event name, schedule and teams. */
export async function importEvent(event, apiKey, fetchImpl = fetch) {
  const [info, matches, teams] = await Promise.all([
    tbaGet(`/event/${event}/simple`, apiKey, fetchImpl),
    tbaGet(`/event/${event}/matches/simple`, apiKey, fetchImpl),
    tbaGet(`/event/${event}/teams/simple`, apiKey, fetchImpl),
  ]);
  return { name: info.name || event, matches: parseTbaMatches(matches), teams: parseTbaTeams(teams) };
}
