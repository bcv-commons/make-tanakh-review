// The flows of PLAN.md section 7 on top of a store (every store method may be async: LocalGitStore answers at once, GitHubStore
// over the API): load for a user, save (commit + pull request), update a branch from main,
// merge a pull request, close, request reviewer access, approve a chapter. Routes call these; they hold no state of their own.
// A chapter is four files (template/FORMAT.md): `file` names its .md; the .units, .notes and .align beside it travel with it.
import { changedVerses } from "./units.js";
import { readChapter, buildChapter, mergeChapter, verseInfo, display, EXTS, sibling, chapterOf } from "./chapter.js";
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
  for (const ext of EXTS) {
    const f = await store.readFile(branch, sibling(file, ext), at);
    texts[ext] = f ? f.text : null;
    versions[sibling(file, ext)] = f ? f.version : null;
  }
  return { texts, versions };
}

async function model(store, branch, file, at = null) {
  const { texts, versions } = await readFiles(store, branch, file, at);
  const ch = readChapter(texts);
  return ch && { ...ch, versions };
}

const unitsOf = (ch) => (ch ? ch.list : []);

// What the editor shows: the user's branch while they have a proposal open, else main; main and approved for comparison.
// `index`: the book's source index (config.sourceIndex) for the poetry lines, or null (then only clause-keyed lines show).
export async function load(store, login, file, { index = null } = {}) {
  const pr = login ? await openPR(store, login) : null;
  const branch = pr ? pr.branch : MAIN;
  const cur = await model(store, branch, file);
  if (!cur) return null;
  return { branch, pr, units: cur.list, version: cur.versions, main: unitsOf(await model(store, MAIN, file)),
    approved: unitsOf(await model(store, APPROVED, file)), verses: verseInfo(cur), ...display(cur), poetry: await poetry(store, branch, file, cur, index) };
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

// Save a chapter as one commit on the user's branch (all four files, the text hashes recomputed); open the pull request at the
// first save. `version` = the files' versions as loaded ({path: version}).
export async function save(store, login, file, list, version, message) {
  let pr = await openPR(store, login);
  const branch = userBranch(login);
  if (!pr) await store.setBranch(branch, await store.branchHead(MAIN));          // a new proposal starts from main
  const cur = await model(store, branch, file);
  if (!cur) throw new Refused("No such chapter.", 404);
  const b = buildChapter(cur, list);
  if (b.error) throw new Refused(b.error);
  const files = {};
  for (const [ext, text] of Object.entries(b.files)) if (text !== cur.texts[ext]) files[sibling(file, ext)] = text;
  if (!Object.keys(files).length) return { pr, version: cur.versions, unchanged: true };
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
  const out = [];
  for (const f of (await changes(store, base, await store.branchHead(pr.branch))).chapters) {
    const b = unitsOf(await model(store, null, f, base));
    const ours = unitsOf(await model(store, pr.branch, f));
    out.push({ file: f, base: b, proposed: ours, main: unitsOf(await model(store, MAIN, f)), verses: changedVerses(b, ours) });
  }
  return out;
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
  const { out, conflicts, others } = await mergeFiles(store, MAIN, pr.branch);
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
  const a = await store.branchHead(APPROVED), m = await store.branchHead(MAIN);
  const differ = new Set(a && m ? (await changes(store, a, m)).chapters : []);
  const out = [];
  for (const c of (await chapters(store)).filter((c) => differ.has(c.path))) {
    const m = unitsOf(await model(store, MAIN, c.path)), a = unitsOf(await model(store, APPROVED, c.path));
    if (changedVerses(a, m).length) out.push({ ...c, verses: changedVerses(a, m), main: m, approved: a });
  }
  return out;
}
