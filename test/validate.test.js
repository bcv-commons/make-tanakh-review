// The CI checks of a language repository (template/.github/check, FORMAT.md section 6): the copies of the shared code stay
// identical to the editor's, a well-formed chapter passes, and each rule catches what it is for.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validate } from "../template/.github/check/validate.mjs";
import { buildChapter, readChapter } from "../src/lib/chapter.js";
import { applyBox } from "../src/lib/units.js";
import { chapterFiles, files, A, B, C, D } from "./fixture.js";

test("the template's copies of format.js and the tokeniser are the editor's", () => {
  for (const [copy, src] of [["template/.github/check/format.js", "src/lib/format.js"], ["template/.github/check/vendor/tokenize.js", "src/lib/vendor/tokenize.js"]])
    assert.equal(fs.readFileSync(copy, "utf8"), fs.readFileSync(src, "utf8"), `${copy} differs from ${src}: copy it over`);
});

const KEYS = { JOS: { "1:1": [A, B, C], "1:2": [D] } };
const repo = (texts = chapterFiles(), extra = {}) => new Map(Object.entries({ "README.md": "# x\n", ".tanakh/layout.json": "{}", ...files("JOS/JOS_001", texts), ...extra }));
const problems = (r, opts = { keys: KEYS }) => validate(r, opts).errors.map((e) => `${e.file}${e.line ? `:${e.line}` : ""} ${e.msg}`);
const edit = (ext, from, to) => { const t = chapterFiles(); assert.ok(t[ext].includes(from), from); return { ...t, [ext]: t[ext].replace(from, to) }; };

test("a well-formed chapter passes, also after an edit in the editor", () => {
  assert.deepEqual(problems(repo()), []);
  const c = readChapter(chapterFiles());
  assert.deepEqual(problems(repo(buildChapter(c, applyBox(c.list, 0, "Efter at Moses døde,").units).files)), []);
  assert.match(validate(repo(), {}).notices[0].msg, /not checked/);
});

test("a text change without its sidecars is stale", () => {
  const p = problems(repo(edit("md", "Min tjener er død.", "Min tjener er døde.")));
  assert.equal(p.length, 3);
  for (const ext of ["units", "notes", "align"]) assert.ok(p.some((x) => x.startsWith(`JOS/JOS_001.${ext}:2 stale`)), ext);
});

test("the .md: order, front matter, white space", () => {
  assert.match(problems(repo(edit("md", "\n1:2\t", "\n1:2\t \t")))[0], /white space/);   // (also stale)
  assert.ok(problems(repo(edit("md", "book: JOS", "book: GEN"))).some((x) => /no line "book: JOS"/.test(x)));
  const swapped = chapterFiles();
  swapped.md = swapped.md.replace(/(1:1\t.*\n)(1:2\t.*\n)/, "$2$1");
  assert.ok(problems(repo(swapped)).some((x) => /out of order/.test(x)));
});

test(".units: keys in the layout, Hebrew order, no key twice, ranges in the verse, one unit per token", () => {
  const p = (from, to) => problems(repo(edit("units", from, to)));
  assert.match(p(`${D}:0-3`, `060010020011-060010020099:0-3`)[0], /JOS_001\.units:4 1:2: .* is not a clause of JOS 1:2/);
  assert.match(p(`${A}:0-4 ${B}:5-8`, `${B}:0-4 ${A}:5-8`)[0], /out of Hebrew order/);
  assert.match(p(`${C}:=`, `${B}:=`)[0], /twice/);
  assert.match(p(`${D}:0-3`, `${D}:0-4`)[0], /outside the verse \(4 tokens\)/);
  assert.match(p(`${B}:5-8`, `${B}:4-8`)[0], /token 4 is in two units/);
  assert.deepEqual(p(`${A}:0-4 ${B}:5-8`, `${A}:0-2 ${A}.2:3-4 ${B}:5-8`), []);           // a translator's split
  assert.deepEqual(problems(repo(edit("units", `${D}:0-3`, `060010020011-060010020099:0-3`)), {}), []);   // no keys: not checked
});

test(".notes and .align: anchors, kinds, profiles, positions, item forms", () => {
  assert.match(problems(repo(edit("notes", "1:2\tT\t4", "1:2\tT\t5")))[0], /anchor 5 is outside/);
  assert.match(problems(repo(edit("notes", "1:1\tE", "1:1\tQ")))[0], /kind "Q"/);
  assert.match(problems(repo(edit("align", "1:2\tb\n", "1:2\tx\n")))[0], /profile "x"/);
  assert.match(problems(repo(edit("align", "0:1 1:3", "0:1 1:4")))[0], /1:4 names a token outside/);
  assert.match(problems(repo(edit("align", "+4,7>2", "+4,9>2")))[0], /\+4,9>2 names a token outside/);
  assert.match(problems(repo(edit("align", "u3@5", "u3@x")))[0], /cannot read u3@x/);
});

test("files: only chapter files in a book folder, no stray files, no secrets, no sidecar without its text", () => {
  assert.match(problems(repo(undefined, { "JOS/notes.txt": "x" }))[0], /not a chapter file/);
  assert.match(problems(repo(undefined, { "build.sh": "x" }))[0], /not a file of a language repository/);
  assert.match(problems(repo(undefined, { ".github/x.yml": `token: ghp_${"a".repeat(36)}` }))[0], /GitHub token/);
  assert.match(problems(repo(undefined, { "JOS/JOS_002.align": "x" }))[0], /without its text file/);
  const n = validate(repo(), { keys: KEYS, changed: ["JOS/JOS_001.md", "README.md"] }).notices;
  assert.match(n.at(-1).msg, /README\.md.*github\.com/);
});

test("edit records and language.json: their form", () => {
  const ok = { ref: "1:1", who: "ann", when: "2026-11-10T08:15:30.123Z", op: "R", cat: "WORD", scope: "this" };
  const P = ".tanakh/edits/JOS/JOS_001/20261110T081530Z-ann.jsonl";
  assert.deepEqual(problems(repo(undefined, { [P]: JSON.stringify(ok) + "\n", ".tanakh/language.json": '{"code":"dan","name":"Danish","native":"dansk","bcp47":"da"}' })), []);
  const bad = (row) => problems(repo(undefined, { [P]: JSON.stringify({ ...ok, ...row }) + "\n" }));
  assert.match(bad({ who: "bo" })[0], /not the file's login ann/);
  assert.match(bad({ op: "X" })[0], /op "X"/);
  assert.match(bad({ cat: "MAYBE" })[0], /cat "MAYBE"/);
  assert.match(bad({ ref: "2:1" })[0], /not a verse of chapter 1/);
  assert.match(problems(repo(undefined, { [P]: "{x\n" }))[0], /not a JSON line/);
  assert.match(problems(repo(undefined, { ".tanakh/edits/JOS/x.jsonl": "" }))[0], /not an edit record/);
  assert.match(problems(repo(undefined, { ".tanakh/language.json": '{"code":"da","name":"Danish","bcp47":"da"}' }))[0], /ISO 639-3/);
  const n = validate(repo(), { keys: KEYS, changed: ["JOS/JOS_001.md", P] }).notices;
  assert.ok(!n.some((x) => /github\.com/.test(x.msg)));                               // the editor's own records: no notice
});
