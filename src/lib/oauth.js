// GitHub sign-in (PLAN.md 15.2 point 4): the GitHub App's user authorisation, identity only. The App's own permissions bound what
// the user token can do (contents and pull requests, on repos the user may write: their fork and, for collaborators, the language
// repo). A sealed, ten-minute cookie carries the state (against forged callbacks), the CC0 tick and the page to return to.
import crypto from "node:crypto";

const WEB = "https://github.com", API = "https://api.github.com";
export const OAUTH_COOKIE = "mtr_oauth";

// Where to send the browser; `stash` is what the callback needs back (to be sealed into OAUTH_COOKIE).
export function authorize(settings, { redirectUri, agree = false, next = "/" }) {
  const state = crypto.randomBytes(16).toString("base64url");
  const url = new URL(`${WEB}/login/oauth/authorize`);
  url.searchParams.set("client_id", settings.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");
  return { url: url.toString(), stash: { state, agree: !!agree, next: next.startsWith("/") && !next.startsWith("//") ? next : "/", until: Date.now() + 10 * 60 * 1000 } };
}

async function tokenCall(settings, params, fetch) {
  const res = await fetch(`${WEB}/login/oauth/access_token`, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "make-tanakh-review" },
    body: JSON.stringify({ client_id: settings.clientId, client_secret: settings.clientSecret, ...params }),
  });
  const t = await res.json().catch(() => ({}));
  if (!res.ok || !t.access_token) throw new Error(`GitHub sign-in: ${t.error_description || t.error || res.status}`);
  // tokens of a GitHub App expire after eight hours unless the App turned that off; then there is no refresh token
  return { token: t.access_token, ...(t.refresh_token ? { refresh: t.refresh_token } : {}),
    ...(t.expires_in ? { expires: Date.now() + t.expires_in * 1000 } : {}) };
}

// The callback: the code for a token, the token for the login. Returns { session: { login, token, refresh?, expires? }, agree, next }.
export async function callback(settings, { code, state, stash, redirectUri }, { fetch = globalThis.fetch } = {}) {
  if (!stash || !state || stash.state !== state || stash.until < Date.now()) throw new Error("The sign-in took too long or came from elsewhere: try again.");
  if (!code) throw new Error("GitHub did not sign you in.");
  const t = await tokenCall(settings, { code, redirect_uri: redirectUri }, fetch);
  const res = await fetch(`${API}/user`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${t.token}`, "User-Agent": "make-tanakh-review" } });
  const u = await res.json().catch(() => ({}));
  if (!res.ok || !u.login) throw new Error("GitHub sign-in: could not read who you are.");
  return { session: { login: u.login, ...t }, agree: stash.agree, next: stash.next };
}

export const refreshToken = (settings, refresh, { fetch = globalThis.fetch } = {}) =>
  tokenCall(settings, { grant_type: "refresh_token", refresh_token: refresh }, fetch);
