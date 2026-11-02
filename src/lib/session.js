// Mock sign-in (PLAN.md section 7): the session cookie carries the login only, signed with HMAC; the CC0 agreement is recorded per
// user. With GitHub this becomes the App's user authorisation (identity only, no scopes); the cookie stays the same.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./config.js";

const COOKIE = "mtr_session";
export const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function secret() {
  if (process.env.MTR_SESSION_SECRET) return process.env.MTR_SESSION_SECRET;
  const f = path.join(DATA, "state", "secret");
  try { return fs.readFileSync(f, "utf8"); } catch {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const s = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(f, s, { mode: 0o600 });
    return s;
  }
}

const sign = (v) => crypto.createHmac("sha256", secret()).update(v).digest("base64url");

export function currentUser(cookies) {
  const c = cookies.get(COOKIE)?.value;
  if (!c) return null;
  const i = c.lastIndexOf(".");
  const login = c.slice(0, i), mac = c.slice(i + 1);
  const want = sign(login);
  if (i < 1 || mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  if (!LOGIN_RE.test(login)) return null;
  return { login, agreed: users()[login]?.agreed || null };
}

export function signIn(cookies, login) {
  cookies.set(COOKIE, `${login}.${sign(login)}`, { httpOnly: true, sameSite: "lax", path: "/", secure: false, maxAge: 60 * 60 * 24 * 30 });
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
