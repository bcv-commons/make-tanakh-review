// The flows of PLAN.md section 7 on top of a store (every store method may be async: LocalGitStore answers at once, GitHubStore
// over the API): load for a user, save (commit + pull request), update a branch from main,
// merge a pull request, close, request reviewer access, approve a chapter. Routes call these; they hold no state of their own.
// A chapter is four files (template/FORMAT.md): `file` names its .md; the .units, .notes and .align beside it travel with it.
import { renderings, wordLexemes, chapterGlosses } from "./renderings.js";
import { ALT_FILE, ALT_DIR, altPath, altUnits, readmeLines } from "./alternatives.js";
import { changedVerses } from "./units.js";
import { readChapter, buildChapter, mergeChapter, verseInfo, display, EXTS, sibling, chapterOf, readStatus, setStatus } from "./chapter.js";
import { editRows, choiceRows, editsPath, jsonl, vocabulary, draftRun, EDITS_DIR } from "./edits.js";
import { parseMd, serializeMd } from "./format.js";
import { StaleError } from "./store/errors.js";
import { BOOK_ORDER } from "./config.js";
import { chapterBreaks } from "./poetry.js";

export const MAIN = "main", APPROVED = "approved";
export const userBranch = (login) => `edit/${login}`;
export const chapterPath = (book, ch) => `${book}/${book}_${String(ch).padStart(3, "0")}.md`;
export const CHAPTER_MD = /^[A-Z0-9]{3}\/[A-Z0-9]{3}_\d{3}\.md$/;

export class Refused extends Error {
  constructor(msg, status = 400, extra = {}) { super(msg); this.status = status; Object.assign(this, extra); }
}

export async function chapters(store) {
  return (await store.listFiles(MAIN)).filter((f) => CHAPTER_MD.test(f) && chapterOf(f)).map((f) => {
    const [book, rest] = f.split("/");
    return { book, chapter: Number(rest.slice(4, 7)), path: f };
  }).sort((a, b) => order(a.book) - order(b.book) || a.chapter - b.chapter);
}

const order = (book) => { const i = BOOK_ORDER.indexOf(book); return i < 0 ? 999 : i; };

export async function roles(store, login) {
  const r = await store.roles();
  return { reviewer: !!login && (r.reviewers.includes(login) || r.team.includes(login)), team: !!login && r.team.includes(login) };
}

export async function openPR(store, login) {
  return (await store.listPRs()).find((p) => p.author === login && (p.status === "open" || p.status === "conflict")) || null;
}

// The four files of a chapter on a branch (or at a commit): { texts, versions }, and the model read from them.
async function readFiles(store, branch, file, at = null) {
  const texts = {}, versions = {};
  const got = await Promise.all(EXTS.map((ext) => store.readFile(branch, sibling(file, ext), at)));   // side by side
  EXTS.forEach((ext, i) => { texts[ext] = got[i] ? got[i].text : null; versions[sibling(file, ext)] = got[i] ? got[i].version : null; });
  return { texts, versions };
}

async function model(store, branch, file, at = null) {
  const { texts, versions } = await readFiles(store, branch, file, at);
  const ch = readChapter(texts);
  return ch && { ...ch, versions };
}

const unitsOf = (ch) => (ch ? ch.list : []);

// What the editor shows: the user's branch while they have a proposal open, else main; main and approved for comparison.
// `index`: the book's source index (config.sourceIndex; or its promise) for the poetry lines, or null (then only clause-keyed lines show).
// `glossFallback`: () => the language's lexeme-glosses table (config.lexemeGlosses), used where the repo has no glosses file.
export async function load(store, login, file, { index = null, glossFallback = null } = {}) {
  // the reads that do not depend on the user's branch start at once, beside it (on GitHub each read is a request)
  const later = Promise.all([model(store, MAIN, file), model(store, APPROVED, file), alternatives(store, file), language(store), publisher(store)]);
  later.catch(() => {});                                            // awaited below; not an unhandled rejection meanwhile
  const pr = login ? await openPR(store, login) : null;
  const branch = pr ? pr.branch : MAIN;
  const cur = await model(store, branch, file);
  if (!cur) return null;
  index = await index;                                              // may come as a promise: fetched beside the reads above
  const [[main, approved, alts, lang, pub], poem, gl] = await Promise.all([later, poetry(store, branch, file, cur, index),
    glosses(store, index, file, cur, glossFallback)]);
  return { branch, pr, units: cur.list, version: cur.versions, main: unitsOf(main),
    approved: unitsOf(approved), verses: verseInfo(cur), ...display(cur), poetry: poem,
    renderings: cur.align && !cur.stale.align ? renderings(index, { book: file.slice(0, 3), verses: cur.verses, align: cur.align.rows }) : {},
    ...gl, alternatives: alts, status: readStatus(cur.md.front), language: lang, publisher: pub };
}

// The run that made the chapter's main draft (`.tanakh/runs/<BOOK>_<CCC>.json`, from the drafting side; FORMAT.md section 10)
async function chapterRun(store, branch, file) {
  const f = await store.readFile(branch, `.tanakh/runs/${file.split("/")[1].replace(/\.md$/, "")}.json`);
  let j = null;
  try { j = f && JSON.parse(f.text); } catch { return null; }
  const alts = [...new Set((await store.listFiles(MAIN, ALT_DIR)).map((p) => ALT_FILE.exec(p)?.[1]).filter(Boolean))];
  return draftRun(j, alts);
}

// The repo's own description of its language (`.tanakh/language.json`, FORMAT.md section 11): { code, name, native, bcp47 }, or null
export async function language(store) {
  const f = await store.readFile(MAIN, ".tanakh/language.json");
  try { const j = f && JSON.parse(f.text); return j && typeof j === "object" ? j : null; } catch { return null; }
}

// Who makes the drafts (`.tanakh/publisher.json`, written by the drafting side): { name, login, url } as far as the file has them
async function publisher(store) {
  const f = await store.readFile(MAIN, ".tanakh/publisher.json");
  let j = null;
  try { j = f && JSON.parse(f.text); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const str = (x) => (typeof x === "string" && x.trim() ? x.trim() : null);
  return { name: str(j.name), login: str(j.login), url: str(j.url) && /^https:\/\//.test(j.url) ? j.url.trim() : null };
}

// The chapter's alternative drafts on main (FORMAT.md section 9), read only: [{ kind, about, built, verses }] by kind, each with
// its words per verse (alternatives.js altUnits). One whose units do not match its own text is left out.
async function alternatives(store, file) {
  const kinds = (await store.listFiles(MAIN, ALT_DIR)).map((f) => ALT_FILE.exec(f))
    .filter((m) => m && m[4] === "md" && `${m[2]}/${m[2]}_${m[3]}.md` === file).map((m) => m[1]).sort();
  if (!kinds.length) return [];
  const [readme, ...files] = await Promise.all([store.readFile(MAIN, `${ALT_DIR}README.md`),
    ...kinds.flatMap((kind) => EXTS.map((ext) => store.readFile(MAIN, altPath(kind, file, ext))))]);   // side by side
  const about = readmeLines(readme?.text);
  const out = [];
  for (const [k, kind] of kinds.entries()) {
    const texts = Object.fromEntries(EXTS.map((ext, i) => [ext, files[k * EXTS.length + i]?.text ?? null]));
    const ch = readChapter(texts);
    if (!ch || ch.stale.units) continue;
    const built = /^built:\s*"?([\d-]+)"?\s*$/.exec((ch.md.front || []).find((l) => l.startsWith("built:")) || "");
    out.push({ kind, about: about[kind] || kind, built: built ? built[1] : null, verses: altUnits(ch.verses, ch.units.verses) });
  }
  return out;
}

// The chapter's glosses (FORMAT.md section 8): the repo's own `.tanakh/glosses.json` (counted from its drafts), else the
// fallback (lexeme-aligner's top.json over the language's Bible editions). { glosses, glossSource }
async function glosses(store, index, file, cur, fallback) {
  let table = await glossTable(store), source = table ? "drafts" : null;
  if (!table && fallback) { try { table = await fallback(); } catch { table = null; } if (table) source = "editions"; }
  if (!table) return { glosses: {}, glossSource: null };
  const sources = source === "editions" && Array.isArray(table.sources) ? table.sources : null;
  return { glosses: chapterGlosses(table, wordLexemes(index, file.slice(0, 3), cur.verses.map((v) => v.ref))),
    glossSource: source === "drafts" ? "this language's drafts" : `lexeme-alignments${sources ? ` (${sources.join(", ")})` : ""}` };
}

// The language's commonest renderings per Hebrew lexeme: `.tanakh/glosses.json` on main (FORMAT.md section 8), published with the
// chapters by the drafting side; null when the repo has none. Parsed once per version of the file.
const glossTables = new Map();
async function glossTable(store) {
  const f = await store.readFile(MAIN, ".tanakh/glosses.json");
  if (!f) return null;
  if (!glossTables.has(f.version)) {
    let t = null;
    try { t = JSON.parse(f.text); } catch { /* a broken file: no glosses */ }
    if (glossTables.size > 20) glossTables.clear();
    glossTables.set(f.version, t);
  }
  return glossTables.get(f.version);
}

// The chapter's poetry lines by verse ({ "c:v": [{ at, level }] }; FORMAT.md section 5), from the repository's
// `.tanakh/poetry/<BOOK>.json` placed through the chapter's units and alignment. A stale alignment places nothing.
async function poetry(store, branch, file, cur, index) {
  const f = await store.readFile(branch, `.tanakh/poetry/${file.slice(0, 3)}.json`);
  if (!f || cur.stale.align || cur.stale.units) return {};
  let entries;
  try { entries = JSON.parse(f.text).lines; } catch { return {}; }
  const ch = { book: file.slice(0, 3), chapter: Number(file.slice(8, 11)), units: cur.units.verses, align: cur.align ? cur.align.rows : null };
  return chapterBreaks(entries, ch, index).breaks;
}

// Save a chapter as one commit on the user's branch (all four files, the text hashes recomputed, the edit records of the save
// beside them: edits.js); open the pull request at the first save. `version` = the files' versions as loaded ({path: version});
// `status`: new status values ({ maturity: "..." }); `uses`: the "use" buttons pressed since the last save ([{ ref, bases, kind }]).
// A save that changes anything sets the status date to today.
export async function save(store, login, file, list, version, message, { status = null, uses = [], now = new Date() } = {}) {
  let pr = await openPR(store, login);
  const branch = userBranch(login);
  if (!pr) await store.setBranch(branch, await store.branchHead(MAIN));          // a new proposal starts from main
  const cur = await model(store, branch, file);
  if (!cur) throw new Refused("No such chapter.", 404);
  const b = buildChapter(cur, list);
  if (b.error) throw new Refused(b.error);
  const withFront = (md, f) => serializeMd({ ...parseMd(md), front: f(parseMd(md).front) });
  if (status && Object.keys(status).length) b.files.md = withFront(b.files.md, (fr) => setStatus(fr, status));
  if (Object.entries(b.files).every(([ext, text]) => text === cur.texts[ext])) return { pr, version: cur.versions, unchanged: true };
  b.files.md = withFront(b.files.md, (fr) => setStatus(fr, {}, now));
  const files = {};
  for (const [ext, text] of Object.entries(b.files)) if (text !== cur.texts[ext]) files[sibling(file, ext)] = text;
  const after = readChapter({ ...cur.texts, ...b.files });
  const rows = editRows({ before: cur, after, who: login, when: now, uses: Array.isArray(uses) ? uses : [],
    vocab: vocabulary(await glossTable(store), cur), commit: await store.branchHead(branch), draft: await chapterRun(store, branch, file) });
  if (rows.length) {
    const p = editsPath(file, now, login), had = await store.readFile(branch, p);
    files[p] = (had ? had.text : "") + jsonl(rows);
  }
  const expect = Object.fromEntries(EXTS.map((ext) => [sibling(file, ext), (version || {})[sibling(file, ext)] ?? null]));
  let r;
  try {
    r = await store.writeFiles(branch, files, { message: message || `Edit ${file.replace(/\.md$/, "")}`, coAuthor: login, expect });
  } catch (e) {
    if (e instanceof StaleError) throw new Refused("This chapter was saved elsewhere since you loaded it: reload to see it (copy your text first).", 409);
    throw e;
  }
  if (!pr) pr = await store.createPR({ author: login, branch, title: `Edits by ${login}`, base: MAIN });
  else await store.updatePR(pr.number, {});
  return { pr, version: { ...cur.versions, ...r.versions } };
}

// The files changed between two commits, split into chapters (their .md paths) and anything else.
async function changes(store, from, to) {
  const all = await store.changedFiles(from, to);
  return { chapters: [...new Set(all.map(chapterOf).filter(Boolean))].sort(), other: all.filter((f) => !chapterOf(f)) };
}

// The proposal of a pull request, chapter by chapter: verses changed against the point it started from.
export async function proposal(store, pr) {
  const base = await store.mergeBase(MAIN, pr.branch) || await store.branchHead(MAIN);
  const list = (await changes(store, base, await store.branchHead(pr.branch))).chapters;
  return Promise.all(list.map(async (f) => {                       // the chapters side by side
    const [b, ours, main] = (await Promise.all([model(store, null, f, base), model(store, pr.branch, f), model(store, MAIN, f)])).map(unitsOf);
    return { file: f, base: b, proposed: ours, main, verses: changedVerses(b, ours) };
  }));
}

// Merge `from` into `into`, chapter by chapter. Files outside the chapters: taken from `from` when `into` left them alone
// (`others`), refused otherwise. choices: {file: {ref: "ours" | "theirs"}} (ours = into).
async function mergeFiles(store, into, from, choices = null) {
  const base = await store.mergeBase(into, from);
  const { chapters: list, other } = await changes(store, base, await store.branchHead(from));
  const out = {}, conflicts = [];
  for (const f of list) {
    const B = await model(store, null, f, base), I = await model(store, into, f), F = await model(store, from, f);
    if (!F) throw new Refused(`${f}: the chapter is incomplete on ${from}.`, 409);
    if (!I) { for (const ext of EXTS) if (F.texts[ext] != null) out[sibling(f, ext)] = F.texts[ext]; continue; }
    const m = mergeChapter(B, I, F, choices ? choices[f] || {} : null);
    for (const c of m.conflicts) conflicts.push({ file: f, ...c });
    if (m.files) for (const [ext, text] of Object.entries(m.files)) if (text !== I.texts[ext]) out[sibling(f, ext)] = text;
  }
  const changedHere = new Set(base ? await store.changedFiles(base, await store.branchHead(into)) : []);
  const others = [];
  for (const f of other) {
    if (changedHere.has(f)) throw new Refused(`${f} changed on both sides: merge it on github.com.`, 409);
    const t = await store.readFile(from, f);
    if (t) out[f] = t.text;
    others.push(f);
  }
  return { out, conflicts, others };
}

// A reviewer merges a pull request into main. Verses changed on both sides block it: the PR is marked and its author settles it.
// A pull request that touches anything but chapter files is merged on github.com only (PLAN.md 15.2 point 3).
export async function mergePR(store, reviewer, number) {
  const pr = (await store.listPRs()).find((p) => p.number === number);
  if (!pr || !["open", "conflict"].includes(pr.status)) throw new Refused("No such open proposal.", 404);
  const { out, conflicts, others: all } = await mergeFiles(store, MAIN, pr.branch);
  const others = all.filter((f) => !f.startsWith(EDITS_DIR));       // the edit records are the editor's own (edits.js)
  if (others.length) throw new Refused(`This proposal changes files other than chapters (${others.join(", ")}): merge it on github.com.`, 409);
  if (conflicts.length) {
    await store.updatePR(number, { status: "conflict" });
    throw new Refused(`Main changed the same verses meanwhile (${conflicts.map((c) => c.ref).join(", ")}): ${pr.author} has to choose first.`, 409);
  }
  await store.commitMerge(MAIN, pr.branch, out, { message: `Merge proposal #${number} by ${pr.author}`, coAuthor: reviewer });
  return await store.updatePR(number, { status: "merged", merged_by: reviewer });
}

// The author brings main into their branch. Without choices, conflicts are returned (each verse: base, ours = the user's, theirs =
// main); with choices ({file: {ref: "ours" | "theirs"}}) the merge is committed.
export async function updateBranch(store, login, choices = null) {
  const pr = await openPR(store, login);
  if (!pr) throw new Refused("You have no open proposal.", 404);
  const first = await mergeFiles(store, pr.branch, MAIN);
  if (first.conflicts.length && !choices) return { conflicts: first.conflicts };
  const { out } = first.conflicts.length ? await mergeFiles(store, pr.branch, MAIN, choices) : first;
  if (first.conflicts.length) {                                     // the author's choices are edit records too
    const now = new Date(), commit = await store.branchHead(pr.branch);
    for (const [f, rows] of Object.entries(choiceRows(first.conflicts, choices, { who: login, when: now, commit })))
      out[editsPath(f, now, login)] = jsonl(rows);
  }
  await store.commitMerge(pr.branch, MAIN, out, { message: `Bring in main`, coAuthor: login });
  await store.updatePR(pr.number, { status: "open" });
  return { conflicts: [], merged: true };
}

export async function closePR(store, login, number) {
  const pr = (await store.listPRs()).find((p) => p.number === number);
  if (!pr || !["open", "conflict"].includes(pr.status)) throw new Refused("No such open proposal.", 404);
  if (pr.author !== login && !(await roles(store, login)).reviewer) throw new Refused("Only the author or a reviewer closes a proposal.", 403);
  return await store.updatePR(number, { status: "closed", closed_by: login });
}

// Self-serve reviewer access (as the reviewer-request issue form + workflow): granted at once; merging into main does not make a
// text official, approval does.
export async function requestReviewer(store, login) {
  const r = await store.roles();
  if (!r.reviewers.includes(login)) r.reviewers.push(login);
  await store.setRoles(r);
}

// A team member approves a chapter: main's version of its four files becomes the approved one (one commit on approved).
export async function approve(store, login, file) {
  if (!(await roles(store, login)).team) throw new Refused("Only the language team approves.", 403);
  if (!CHAPTER_MD.test(file)) throw new Refused("No such chapter.", 404);
  const m = await readFiles(store, MAIN, file), a = await readFiles(store, APPROVED, file);
  if (m.texts.md == null) throw new Refused("No such chapter.", 404);
  const files = {};
  for (const ext of EXTS) if (m.texts[ext] != null && m.texts[ext] !== a.texts[ext]) files[sibling(file, ext)] = m.texts[ext];
  if (!Object.keys(files).length) return { unchanged: true };
  await store.writeFiles(APPROVED, files, { message: `Approve ${file.replace(/\.md$/, "")}`, coAuthor: login, expect: a.versions });
  return { approved: true };
}

// Chapters whose working text differs from the approved one.
export async function awaitingApproval(store) {
  const [a, m] = await Promise.all([store.branchHead(APPROVED), store.branchHead(MAIN)]);
  const differ = new Set(a && m ? (await changes(store, a, m)).chapters : []);
  const list = await Promise.all((await chapters(store)).filter((c) => differ.has(c.path)).map(async (c) => {   // side by side
    const [m, a] = (await Promise.all([model(store, MAIN, c.path), model(store, APPROVED, c.path)])).map(unitsOf);
    return changedVerses(a, m).length ? { ...c, verses: changedVerses(a, m), main: m, approved: a } : null;
  }));
  return list.filter(Boolean);
}
