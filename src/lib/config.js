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
const LANG_TAGS = { dan: "da" };

// A language's name and tag: the repo's `.tanakh/language.json` (FORMAT.md section 11) as last read, else the table above, else
// the code. Pages that read the file tell it here (rememberLanguage), so the menus of other pages use it too.
const langInfo = new Map();
export function rememberLanguage(lang, info) { if (info && typeof info === "object") langInfo.set(lang, info); }
export const languageName = (lang) => langInfo.get(lang)?.name || LANG_NAMES[lang] || lang;
export const languageTag = (lang) => langInfo.get(lang)?.bcp47 || LANG_TAGS[lang] || lang;

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

// The Hebrew side of a chapter (PLAN.md 4.2), the same for every language: bcv-commons/tanakh-hebrew-clauses (published by
// bcv-query, schema 1: per verse the layout's clause segments, each word's MACULA id, surface and content flag; CC BY 4.0) at a
// pinned revision, with each word's English gloss joined from MACULA Hebrew itself (the `gloss` of its morphemes, at a pinned
// commit of Clear-Bible/macula-hebrew; CC BY 4.0). Both are kept in memory and under DATA/ where that can be written; a failure
// is retried after ten minutes. Without the network: DATA/hebrew/<BOOK>/<CCC>.json (tools/build_hebrew.py, glosses included).
export const HEBREW = { dataset: "bcv-commons/tanakh-hebrew-clauses", revision: "67da6e0661e67b4e00dd7665a66a021bab856240" };
export const MACULA_HEBREW = { repo: "Clear-Bible/macula-hebrew", commit: "47db250bd55d0d8577f2a94fba114ef16c35b23c" };
const ccc = (chapter) => String(chapter).padStart(3, "0");
// MACULA's file of a chapter: WLC/lowfat/<nn>-<Book>-<ccc>-lowfat.xml (Hosea's book part is written HOS there)
export const maculaFile = (book, chapter) => {
  const i = BOOK_ORDER.indexOf(book);
  return i < 0 ? null : `WLC/lowfat/${String(i + 1).padStart(2, "0")}-${book === "HOS" ? "HOS" : book.toLowerCase().replace(/[a-z]/, (x) => x.toUpperCase())}-${ccc(chapter)}-lowfat.xml`;
};
// { morpheme id: gloss } from a MACULA lowfat file: every <w xml:id="o<id>" ... gloss="..."> (attributes in any order)
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export function maculaGlosses(xml) {
  const out = {};
  for (const m of xml.matchAll(/<w\s[^>]*>/g)) {
    const id = /xml:id="o(\d{12})"/.exec(m[0]), g = /\sgloss="([^"]*)"/.exec(m[0]);
    if (id && g) out[id[1]] = unescape(g[1]);
  }
  return out;
}

const cached = new Map();
// a file fetched once and kept: memory, then DATA/<dir>/<name>, then the URL; `parse` turns the text into the value
async function keep(dir, name, url, parse) {
  const id = `${dir}/${name}`, hit = cached.get(id);
  if (hit && (hit.value || Date.now() - hit.at < 600e3)) return hit.value;
  const file = path.join(DATA, dir, name);
  let value = null;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* not kept yet */ }
  if (!value) {
    try {
      const r = await http(url);
      if (r.ok) {
        value = parse(await r.text());
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); } catch { /* read-only: memory only */ }
      }
    } catch { /* offline */ }
  }
  cached.set(id, { value, at: Date.now() });
  return value;
}

export async function hebrew(book, chapter) {
  const none = { book, chapter, verses: {} };
  if (!BOOK_ORDER.includes(book) || !Number.isInteger(chapter) || chapter < 1 || chapter > 150) return none;
  const H = HEBREW, M = MACULA_HEBREW;
  const [ch, glosses] = await Promise.all([
    keep(`tanakh-hebrew/${H.revision}`, `${book}/${ccc(chapter)}.json`,
      `https://huggingface.co/datasets/${H.dataset}/resolve/${H.revision}/data/${book}/${ccc(chapter)}.json`, JSON.parse),
    keep(`macula-glosses/${M.commit}`, `${book}_${ccc(chapter)}.json`,
      `https://raw.githubusercontent.com/${M.repo}/${M.commit}/${maculaFile(book, chapter)}`, maculaGlosses),
  ]);
  if (!ch || typeof ch.verses !== "object") {
    try { return JSON.parse(fs.readFileSync(path.join(DATA, "hebrew", book, `${ccc(chapter)}.json`), "utf8")); } catch { return none; }
  }
  // a word's gloss: its morphemes' glosses (the word id and one part digit, 1, 2, ...), the empty ones skipped
  const out = structuredClone(ch);
  for (const clauses of Object.values(out.verses)) for (const c of clauses) for (const w of c.words || []) {
    const parts = [];
    for (let p = 1; p <= 9 && glosses && glosses[`${w.id}${p}`] !== undefined; p++) if (glosses[`${w.id}${p}`]) parts.push(glosses[`${w.id}${p}`]);
    w.gloss = parts.join(" ");
  }
  return out;
}

// compact-alignments' source index of a book ({ keys, fn }: "BOOK c:v" -> [MACULA key, ...]; the .align ordinals count these
// lists; lexemes and fnLexemes: the same lists' lexemes, for the glosses), at a pinned revision of the dataset (CC BY 4.0,
// MACULA). Kept in memory and under DATA/compact-index/<revision>/ like the Hebrew; without the network the files fetched by
// tools/fetch_index.mjs into DATA/index; null when the keys are not to be had (the poetry view then shows only the lines that
// begin a clause). A book not in the index stays null.
export const COMPACT_INDEX = { dataset: "bcv-commons/compact-alignments", revision: "115830822e155b5cce71f902481aa9092fa9670e" };
export async function sourceIndex(book) {
  if (!BOOK_ORDER.includes(book)) return null;
  const R = COMPACT_INDEX;
  const get = async (kind) => {
    const name = `${book}_${kind}.json`;
    const v = await keep(`compact-index/${R.revision}`, name, `https://huggingface.co/datasets/${R.dataset}/resolve/${R.revision}/_index/${name}`, JSON.parse);
    if (v) return v;
    try { return JSON.parse(fs.readFileSync(path.join(DATA, "index", name), "utf8")); } catch { return null; }
  };
  const [keys, fn, lexemes, fnLexemes] = await Promise.all(["keys", "fn_keys", "lexemes", "fn"].map(get));
  return keys && fn ? { keys, fn, lexemes, fnLexemes } : null;   // the lexeme lists (glosses): optional
}

// The fallback glosses where a language repo has no `.tanakh/glosses.json` (FORMAT.md section 8): lexeme-aligner's commonest
// renderings per lexeme over all the language's Bible editions (bcv-commons/lexeme-alignments `iso=<iso>/top.json`, format
// lexeme-glosses/1, counts only, CC0), read at a pinned revision of the dataset (the files are rebuilt with each chain run).
// Kept in memory, and under DATA/lexeme-glosses/<revision>/ where that can be written; a missing language is remembered,
// a network failure is retried after ten minutes.
export const LEXEME_GLOSSES = { dataset: "bcv-commons/lexeme-alignments", revision: "6f169dba153fa6c1a67083bcfe24a81bba1c2857" };
const tops = new Map();
export async function lexemeGlosses(iso) {
  if (!/^[a-z]{3}$/.test(iso || "")) return null;
  const hit = tops.get(iso);
  if (hit && (hit.table || hit.missing || Date.now() - hit.at < 600e3)) return hit.table;
  const file = path.join(DATA, "lexeme-glosses", LEXEME_GLOSSES.revision, `${iso}.json`);
  let table = null, missing = false;
  try { table = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* not kept yet */ }
  if (!table) {
    try {
      const r = await http(`https://huggingface.co/datasets/${LEXEME_GLOSSES.dataset}/resolve/${LEXEME_GLOSSES.revision}/iso=${iso}/top.json`);
      if (r.status === 404) missing = true;
      else if (r.ok) {
        const text = await r.text();
        table = JSON.parse(text);
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); } catch { /* read-only: memory only */ }
      }
    } catch { /* offline: no fallback for now */ }
  }
  if (table && table.format !== "lexeme-glosses/1") table = null;
  tops.set(iso, { table, missing, at: Date.now() });
  return table;
}
