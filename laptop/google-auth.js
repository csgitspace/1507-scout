// ==============================================================================
// Google sign-in for the scan station's dashboard sync.
//
// Why this exists: the team's Google Workspace (warlocks1507.com) doesn't allow
// anonymous web apps, so the sync endpoint only accepts warlocks1507.com
// users. The laptop proves who it is with a Google access token from a one-time
// sign-in (`npm run station:login`). That sign-in goes through the team's own
// "Internal" OAuth app, which Workspace trusts. Outside apps like clasp get
// blocked from Drive permissions.
//
// Files (both in data/, never committed):
//   google-oauth-client.json  the Desktop OAuth client downloaded from Cloud Console
//   google-auth.json          this laptop's saved sign-in (refresh token)
// ==============================================================================

import { existsSync, readFileSync } from 'node:fs';

// Google requires a Drive scope for any call to an Apps Script web app with a token.
// Read-only is enough; the sync endpoint itself runs as the Sheet's owner.
export const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.readonly'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Reads the downloaded OAuth client file ({ installed: {...} } for Desktop apps). */
export function readClientFile(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const c = raw.installed || raw.web || raw;
  if (!c.client_id || !c.client_secret) throw new Error(`${file} doesn't look like an OAuth client file`);
  return { client_id: c.client_id, client_secret: c.client_secret };
}

/**
 * Hands out access tokens from the saved sign-in, refreshing (and caching)
 * them as needed. configured() is false when the laptop was never signed in;
 * sync then sends no token (fine for a non-Workspace deployment).
 */
export function createTokenSource(authFile, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  let cached = null; // { token, expiresAt }

  const read = () => (existsSync(authFile) ? JSON.parse(readFileSync(authFile, 'utf8')) : null);

  return {
    configured: () => existsSync(authFile),
    account: () => { try { return read()?.email || null; } catch { return null; } },

    async token() {
      if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
      const auth = read();
      if (!auth) throw new Error('This laptop is not signed in to Google — run  npm run station:login');
      let res;
      try {
        res = await fetchImpl(TOKEN_URL, {
          method: 'POST',
          body: new URLSearchParams({ client_id: auth.client_id, client_secret: auth.client_secret,
            refresh_token: auth.refresh_token, grant_type: 'refresh_token' }),
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        throw new Error("Can't reach Google — is the phone tethered and on cellular data?");
      }
      const body = await res.json().catch(() => ({}));
      if (!body.access_token) {
        if (body.error === 'invalid_grant') throw new Error('Google sign-in expired or was revoked — run  npm run station:login');
        throw new Error(`Google sign-in failed (${body.error || res.status})`);
      }
      cached = { token: body.access_token, expiresAt: now() + (body.expires_in || 3600) * 1000 };
      return cached.token;
    },
  };
}
