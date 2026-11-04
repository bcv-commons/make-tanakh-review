// Settings (PLAN.md sections 3 and 12). Locally everything lives under MTR_DATA (default .local in the project folder,
// git-ignored). With the five MTR_GITHUB_* settings the language repos are the organisation's on GitHub (GitHubStore) and sign-in
// is GitHub's; without them the app is the local test.
import fs from "node:fs";
import path from "node:path";
import { LocalGitStore } from "./store/local-git.js";
import { GitHubStore, appTokens } from "./store/github.js";

const GH = { appId: "MTR_GITHUB_APP_ID", privateKey: "MTR_GITHUB_PRIVATE_KEY", clientId: "MTR_GITHUB_CLIENT_ID",
  clientSecret: "MTR_GITHUB_CLIENT_SECRET", org: "MTR_GITHUB_ORG" };
export const TOPIC = "global-tanakh";

// { appId, privateKey, clientId, clientSecret, org } or null (the local test); a partial set is an error, not a quiet fallback
export function githubSettings(env = process.env) {
  const s = Object.fromEntries(Object.entries(GH).map(([k, v]) => [k, env[v] || ""]));
  const missing = Object.entries(GH).filter(([k]) => !s[k]).map(([, v]) => v);
  if (missing.length === Object.keys(GH).length) return null;
  if (missing.length) throw new Error(`GitHub settings incomplete: ${missing.join(", ")} not set`);
  // the key as PEM (newlines or \n escapes, as environment editors keep it) or as base64 of the PEM
  const k = s.privateKey.includes("BEGIN") ? s.privateKey.replace(/\\n/g, "\n") : Buffer.from(s.privateKey, "base64").toString("utf8");
  return { ...s, privateKey: k };
}

// the HTTP client for GitHub (tests put the mock here), the App's token source, the language list (five minutes)
let http = (...a) => globalThis.fetch(...a);
let app = null, langs = null;
export function useFetch(f) { http = f; app = null; langs = null; }
export function forgetLanguages() { langs = null; }
function appToken() {
  const s = githubSettings();
  if (!app || app.key !== s.appId + s.org) app = { key: s.appId + s.org, tokens: appTokens({ ...s, fetch: http }) };
  return app.tokens;
}
export const githubFetch = () => http;

export const DATA = process.env.MTR_DATA || path.resolve(".local");
export const LANG_NAMES = { dan: "Danish" };

// Tanakh books in the order of the English Bible (the drafts' order); used to sort books in menus
export const BOOK_ORDER = ["GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH",
  "EST", "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB",
  "ZEP", "HAG", "ZEC", "MAL"];

// The language codes: locally the bare repos under MTR_DATA/repos; on GitHub the repositories the App is installed on with the
// topic `global-tanakh` (PLAN.md 15.2 point 5), public ones only: a reader who is not signed in reads them through the App.
// MTR_GITHUB_PRIVATE=1 lists private ones too (a test against a private repo; never on a public site).
export async function languages() {
  const s = githubSettings();
  if (!s) {
    try {
      return fs.readdirSync(path.join(DATA, "repos")).filter((d) => d.endsWith(".git")).map((d) => d.slice(0, -4)).sort();
    } catch { return []; }
  }
  if (langs && langs.until > Date.now()) return langs.list;
  const token = await appToken()(), list = [], priv = process.env.MTR_GITHUB_PRIVATE === "1";
  for (let page = 1; ; page++) {
    const res = await http(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "make-tanakh-review" } });
    if (!res.ok) throw new Error(`GitHub ${res.status}: the App's repositories`);
    const repos = (await res.json()).repositories;
    list.push(...repos.filter((r) => (r.topics || []).includes(TOPIC) && !r.archived && (priv || !r.private)).map((r) => r.name));
    if (repos.length < 100) break;
  }
  langs = { list: list.sort(), until: Date.now() + 5 * 60 * 1000 };
  return langs.list;
}

// The store of a language for this request's user ({ login, token } from session.currentUser, or null for a reader); null when
// there is no such language. Locally one store per language serves everyone.
const stores = new Map();
export async function storeFor(lang, user = null) {
  if (!(await languages()).includes(lang)) return null;
  const s = githubSettings();
  if (s) return new GitHubStore({ owner: s.org, repo: lang, app: appToken(), fetch: http,
    user: user && user.token ? { login: user.login, token: user.token } : null });
  if (!stores.has(lang)) stores.set(lang, new LocalGitStore(path.join(DATA, "repos", `${lang}.git`), path.join(DATA, "state", `${lang}.json`)));
  return stores.get(lang);
}

export function hebrew(book, chapter) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, "hebrew", book, `${String(chapter).padStart(3, "0")}.json`), "utf8"));
  } catch { return { book, chapter, verses: {} }; }
}

// compact-alignments' source index of a book ({ keys, fn }: "BOOK c:v" -> [MACULA key, ...]; the .align ordinals count these
// lists), fetched by tools/fetch_index.mjs into DATA/index; null when it is not there (the poetry view then shows only the
// lines that begin a clause).
const indexes = new Map();
export function sourceIndex(book) {
  if (!indexes.has(book)) {
    try {
      const read = (kind) => JSON.parse(fs.readFileSync(path.join(DATA, "index", `${book}_${kind}.json`), "utf8"));
      const opt = (kind) => { try { return read(kind); } catch { return null; } };   // the lexeme lists (glosses): optional
      indexes.set(book, { keys: read("keys"), fn: read("fn_keys"), lexemes: opt("lexemes"), fnLexemes: opt("fn") });
    } catch { indexes.set(book, null); }
  }
  return indexes.get(book);
}
