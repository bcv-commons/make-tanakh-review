// Sign-in state (PLAN.md sections 7 and 15.2 point 4). The session cookie is sealed (AES-256-GCM under MTR_SESSION_SECRET): the
// browser can neither read nor change it. It holds the login, and with GitHub the user's token (and the refresh token, when the
// App's user tokens expire), so the server needs no store of its own.
// The CC0 agreement: locally per user in $MTR_DATA/state/users.json; with GitHub in a year-long sealed cookie (`mtr_cc0`) on
// that browser, and in the body of the user's pull requests, which is where it lives for good.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA, githubSettings } from "./config.js";
import { refreshToken } from "./oauth.js";

const COOKIE = "mtr_session", CC0 = "mtr_cc0";
const YEAR = 60 * 60 * 24 * 365;
export const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function secret() {
  if (process.env.MTR_SESSION_SECRET) return process.env.MTR_SESSION_SECRET;
  if (githubSettings()) throw new Error("MTR_SESSION_SECRET is required with GitHub (the server keeps no files)");
  const f = path.join(DATA, "state", "secret");
  try { return fs.readFileSync(f, "utf8"); } catch {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const s = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(f, s, { mode: 0o600 });
    return s;
  }
}

const key = () => crypto.createHash("sha256").update(`mtr-cookie|${secret()}`).digest();

export function seal(value) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

export function unseal(text) {
  try {
    const b = Buffer.from(text, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
  } catch { return null; }
}

const opts = (maxAge) => ({ httpOnly: true, sameSite: "lax", path: "/", secure: !!githubSettings(), maxAge });

// The signed-in user: { login, agreed, token } (token only with GitHub), or null. A GitHub token about to expire is refreshed here
// and the cookie rewritten; one that cannot be refreshed signs the user out.
export async function currentUser(cookies, { fetch = globalThis.fetch } = {}) {
  const c = cookies.get(COOKIE)?.value;
  const s = c && unseal(c);
  if (!s || !LOGIN_RE.test(s.login || "")) return null;
  if (s.expires && s.expires < Date.now() + 60 * 1000) {
    const t = s.refresh && await refreshToken(githubSettings(), s.refresh, { fetch }).catch(() => null);
    if (!t) { signOut(cookies); return null; }
    Object.assign(s, t);
    cookies.set(COOKIE, seal(s), opts(60 * 60 * 24 * 30));
  }
  const agreed = githubSettings() ? s.agreed || null : users()[s.login]?.agreed || null;
  return { login: s.login, agreed, token: s.token || null };
}

// session: { login, token?, refresh?, expires? }; with GitHub `agreed` comes from the sign-in (ticked now, or remembered on this
// browser for this login)
export function signIn(cookies, session, { agreedNow = false } = {}) {
  let agreed = null;
  if (githubSettings()) {
    const known = unseal(cookies.get(CC0)?.value || "");
    agreed = known && known.login === session.login ? known.agreed : null;
    if (agreedNow && !agreed) agreed = new Date().toISOString();
    if (agreed) cookies.set(CC0, seal({ login: session.login, agreed }), opts(YEAR));
  }
  cookies.set(COOKIE, seal({ ...session, ...(agreed ? { agreed } : {}) }), opts(60 * 60 * 24 * 30));
}

export function signOut(cookies) {
  cookies.delete(COOKIE, { path: "/" });
}

function usersFile() { return path.join(DATA, "state", "users.json"); }
export function users() {
  try { return JSON.parse(fs.readFileSync(usersFile(), "utf8")); } catch { return {}; }
}
export function agree(login) {
  const u = users();
  u[login] = { ...(u[login] || {}), agreed: u[login]?.agreed || new Date().toISOString() };
  fs.mkdirSync(path.dirname(usersFile()), { recursive: true });
  fs.writeFileSync(usersFile(), JSON.stringify(u, null, 1));
}
