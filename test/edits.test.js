// The edit records of a save (edits.js, FORMAT.md section 10): each kind of change classified, the rows written in the save's
// commit beside the chapter, conflict choices as rows, and the status with the date of the version.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { editRows, choiceRows, vocabulary, editsPath, EDITS_FILE } from "../src/lib/edits.js";
import { readChapter, readStatus, setStatus } from "../src/lib/chapter.js";
import { applyBox } from "../src/lib/units.js";
import { LocalGitStore } from "../src/lib/store/local-git.js";
import * as S from "../src/lib/service.js";
import { chapterFiles, files, B } from "./fixture.js";

const WHEN = new Date("2026-11-10T08:15:30.123Z");
// 1:1 Efter(0) at(1) Moses(2) var(3) død(4) sagde(5) HERREN(6) til(7) Josva(8); fn links 1:0-1 2:7 (Efter at, til)
const before = readChapter(chapterFiles());
const rowsFor = (v1, v2 = "Min tjener er død.", opts = {}) => {
  const after = readChapter(chapterFiles([["1:1", v1], ["1:2", v2]]));
  return editRows({ before, after, who: "ann", when: WHEN, vocab: vocabulary(null, before), ...opts });
};
const brief = (rows) => rows.map((r) => `${r.op} ${r.cat} ${JSON.stringify(r.old)}>${JSON.stringify(r.new)}`);

test("each kind of change", () => {
  assert.deepEqual(brief(rowsFor("Efter at Moses var død, sagde HERREN til Josva:")), []);
  assert.deepEqual(brief(rowsFor("Efter at Moses var død, sagde Herren til Josva:")), ['R SPELL "HERREN">"Herren"']);
  assert.deepEqual(brief(rowsFor("Efter at Moses var død, sagde HERREN til Jósva:")), ['R TONE "Josva">"Jósva"']);
  assert.deepEqual(brief(rowsFor("Da Moses var død, sagde HERREN til Josva:")), ['R FUNC "Efter at">"Da"']);
  assert.deepEqual(brief(rowsFor("Efter at Moses var død, talte HERREN til Josva:")), ['R NEW "sagde">"talte"']);
  assert.deepEqual(brief(rowsFor("Efter at Moses var død, sagde HERREN til Moses:")), ['R WORD "Josva">"Moses"']);   // a word of the chapter
  assert.deepEqual(brief(rowsFor("Efter at Moses var død, sagde HERREN Josva:")), ['U FUNC "til">""']);
  assert.deepEqual(brief(rowsFor("Efter at Moses var død, sagde HERREN til Josva nu:")), ['M NEW "">"nu"']);
  assert.deepEqual(brief(rowsFor("Efter at Moses var død, sagde til Josva HERREN:")), ['WO ORDER "HERREN">"HERREN"']);
  assert.deepEqual(brief(rowsFor("Efter at Moses var død; sagde HERREN til Josva:")), ['R OTHER ",">";"']);
  // a word moved to the front: one word-order row, the capital that moved with the sentence's start is no spelling change
  assert.deepEqual(brief(rowsFor("Efter at Moses var død, sagde HERREN til Josva:", "Død er min tjener.")), ['WO ORDER "er død">"Død er"']);
});

test("a row's place, quote, unit and the use button", () => {
  const [r] = rowsFor("Efter at Moses var død, talte HERREN til Josva:", undefined, { uses: [{ ref: "1:1", bases: [B], kind: "nllb" }], commit: "abc" });
  assert.deepEqual(r.span, { old: [5, 6], new: [5, 6] });
  assert.deepEqual(r.quote, { prefix: "Moses var død", suffix: "HERREN til Josva" });
  assert.equal(r.unit, B);
  assert.equal(r.from_alt, "nllb");
  assert.equal(r.who, "ann"); assert.equal(r.when, "2026-11-10T08:15:30.123Z"); assert.equal(r.scope, "this"); assert.equal(r.commit, "abc");
  assert.equal(r.why, null);
  assert.equal(editsPath("JOS/JOS_001.md", WHEN, "ann"), ".tanakh/edits/JOS/JOS_001/20261110T081530Z-ann.jsonl");
  assert.ok(EDITS_FILE.test(editsPath("JOS/JOS_001.md", WHEN, "ann")));
});

test("split and join; conflict choices", () => {
  const split = applyBox(before.list, 0, "Efter at Moses# var død,").units;
  const after = readChapter({ ...chapterFiles(), units: chapterFiles().units.replace(/1:1\t\S+/, (m) => m) });
  const cut = { ...after, list: split };
  assert.deepEqual(brief(editRows({ before, after: cut, who: "ann", when: WHEN })).map((x) => x.split(" ").slice(0, 2).join(" ")), ["R SPLIT"]);
  assert.deepEqual(brief(editRows({ before: cut, after: before, who: "ann", when: WHEN })).map((x) => x.split(" ").slice(0, 2).join(" ")), ["R JOIN"]);
  const rows = choiceRows([{ file: "JOS/JOS_001.md", ref: "1:2", ours: [{ text: "Min tjener er nu død." }], theirs: [{ text: "Min tjener Moses er død." }] }],
    { "JOS/JOS_001.md": { "1:2": "theirs" } }, { who: "bo", when: WHEN });
  assert.deepEqual(rows["JOS/JOS_001.md"].map((r) => [r.cat, r.choice, r.old, r.new]), [["CHOICE", "theirs", "Min tjener er nu død.", "Min tjener Moses er død."]]);
});

test("status: read, set, and the date in the file's own form", () => {
  const front = ["book: JOS", "chapter: 1", "status:", '  maturity: "Udkast"', '  date: "17.08.2026"', 'status_labels: ["Modenhed", "Dato"]'];
  assert.deepEqual(readStatus(front), { keys: ["maturity", "date"], values: { maturity: "Udkast", date: "17.08.2026" }, labels: ["Modenhed", "Dato"] });
  const f = setStatus(front, { maturity: "Gennemset", literary: "Tjekket", bogus: "x" }, WHEN);
  assert.deepEqual(readStatus(f).values, { maturity: "Gennemset", date: "10.11.2026", literary: "Tjekket" });
  assert.equal(readStatus(setStatus(['status:', '  date: "2026-01-02"'], {}, WHEN)).values.date, "2026-11-10");
});

test("a save writes the rows beside the chapter, the status and its date; a merge takes the rows along", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-ed-"));
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", path.join(dir, "x.git")]);
  const s = new LocalGitStore(path.join(dir, "x.git"), path.join(dir, "state.json"));
  s.writeFiles("main", files("JOS/JOS_001", chapterFiles()), { message: "seed" });
  s.saveState({ prs: [], roles: { reviewers: ["rev"], team: [] } });
  const F = "JOS/JOS_001.md";
  const d = await S.load(s, "ann", F);
  const units = applyBox(d.units, 1, "talte HERREN til Josva:").units;
  await S.save(s, "ann", F, units, d.version, null, { status: { maturity: "Gennemset" }, uses: [{ ref: "1:1", bases: [B], kind: "shape" }], now: WHEN });
  const rows = s.readFile("edit/ann", ".tanakh/edits/JOS/JOS_001/20261110T081530Z-ann.jsonl").text.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.op, r.cat, r.old, r.new, r.from_alt]), [["R", "NEW", "sagde", "talte", "shape"]]);
  const st = (await S.load(s, "ann", F)).status.values;
  assert.equal(st.maturity, "Gennemset");
  assert.equal(st.date, "10.11.2026");
  await S.mergePR(s, "rev", 1);                                     // the edit records do not send it to github.com
  assert.ok(s.readFile("main", ".tanakh/edits/JOS/JOS_001/20261110T081530Z-ann.jsonl"));
});
