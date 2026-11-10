// The CI checks of a language repository (template/.github/check, FORMAT.md section 6): the copies of the shared code stay
// identical to the editor's, a well-formed chapter passes, and each rule catches what it is for.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validate, joinPieces } from "../template/.github/check/validate.mjs";
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

test(".parts: derived, a verse hash per row (stale = a notice), one cell per token, the pieces give the token", async () => {
  const { createHash } = await import("node:crypto");
  const h = (ref, t) => createHash("sha256").update(`${ref}\t${t}`, "utf8").digest("hex").slice(0, 8);
  const V1 = "Efter at Moses var død, sagde HERREN til Josva:", V2 = "Min tjener er død.";
  const cells = (ws) => ws.map((w, i) => `${i}=${w}`).join("\t");
  const good = ["Ef:p1|ter:stem", "at:whole", "Moses:whole", "var:whole", "død:whole", "sag:stem|de:s1:m:de-pst:verb", "HERREN:whole", "til:whole", "Josva:whole"];
  const parts = (rows) => `# parts: make-tanakh-parts/1; splitter morphs.py@0123456789ab; unicode 15.1\n${rows.join("\n")}\n`;
  const P = (rows) => problems(repo(undefined, { "JOS/JOS_001.parts": parts(rows) }));
  assert.deepEqual(P([`1:1\t${h("1:1", V1)}\t${cells(good)}`, `1:2\t${h("1:2", V2)}\t${cells(["Min:whole", "tjen:stem|er:s1", "er:whole", "død:whole"])}`]), []);
  assert.match(P([`1:1\t${h("1:1", V1)}\t${cells(good.slice(0, 8))}`])[0], /8 cells for 9 tokens/);
  assert.match(P([`1:1\t${h("1:1", V1)}\t${cells(["Ef:p1|tr:stem", ...good.slice(1)])}`])[0], /token 0: the pieces give "Eftr"/);
  assert.match(P([`1:1\t${h("1:1", V1)}\t${cells(["Efter:root", ...good.slice(1)])}`])[0], /cannot read the piece/);
  const stale = validate(repo(undefined, { "JOS/JOS_001.parts": parts([`1:1\t00000000\t${cells(good)}`]) }), { keys: KEYS });
  assert.deepEqual(stale.errors, []);
  assert.match(stale.notices.find((n) => /stale/.test(n.msg)).msg, /1 verse row/);
  assert.match(problems(repo(undefined, { "JOS/JOS_001.parts": "# parts: other\n" }))[0], /make-tanakh-parts\/1/);
  assert.match(problems(repo(undefined, { "JOS/JOS_002.parts": parts([]) }))[0], /without its text file/);
  // a tone piece puts its marks back: Kuni Joshua 1:7 token 37 (make-tanakh-grammar's row)
  assert.deepEqual(joinPieces("nø:stem|:tone:tone-proh@4:\u0300;2:\u1DC4|qav:s0:m:-qav:verb"), { word: "nø\u0300qa\u1DC4v".normalize("NFC") });
  assert.match(joinPieces("nø:stem|:tone:x@9:\u0300|qav:s0").error, /outside the word/);
  assert.match(P([`1:1\t${h("1:1", V1)}\t${cells(["Efter:stem|:tone:H@1:\u0301", ...good.slice(1)])}`])[0], /the pieces give "Efteŕ"/);
});
