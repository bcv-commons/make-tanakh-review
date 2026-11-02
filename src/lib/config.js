// Settings (PLAN.md section 3). Locally everything lives under MTR_DATA (default .local in the project folder, git-ignored).
import fs from "node:fs";
import path from "node:path";
import { LocalGitStore } from "./store/local-git.js";

export const DATA = process.env.MTR_DATA || path.resolve(".local");
export const LANG_NAMES = { dan: "Danish" };

// Tanakh books in the order of the English Bible (the drafts' order); used to sort books in menus
export const BOOK_ORDER = ["GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH",
  "EST", "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB",
  "ZEP", "HAG", "ZEC", "MAL"];

export function languages() {
  try {
    return fs.readdirSync(path.join(DATA, "repos")).filter((d) => d.endsWith(".git")).map((d) => d.slice(0, -4)).sort();
  } catch { return []; }
}

const stores = new Map();
export function storeFor(lang) {
  if (!languages().includes(lang)) return null;
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
      indexes.set(book, { keys: read("keys"), fn: read("fn_keys") });
    } catch { indexes.set(book, null); }
  }
  return indexes.get(book);
}
