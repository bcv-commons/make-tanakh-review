// The chapter model: build the four files back from edited units (hashes, cuts, projected notes and links), and the merge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readChapter, buildChapter, mergeChapter, verseInfo, display } from "../src/lib/chapter.js";
import { applyBox, split } from "../src/lib/units.js";
import { headerHash, parseAlign, parseNotes, parseUnits } from "../src/lib/format.js";
import { chapterFiles, hashOf, A, B, C, D } from "./fixture.js";

const ch = () => readChapter(chapterFiles());

test("an unchanged chapter builds back to the same bytes", () => {
  const c = ch();
  assert.equal(c.stale.align, false);
  assert.deepEqual(buildChapter(c, c.list).files, chapterFiles());
});

test("a text edit: the .md, the hash in every sidecar, notes and links projected, profile s", () => {
  const c = ch();
  const list = applyBox(c.list, 0, "Efter at Moses,  Herrens tjener, var død,").units;   // + Herrens tjener (2 tokens after Moses)
  const { files, error } = buildChapter(c, list);
  assert.equal(error, undefined);
  const want = hashOf([["1:1", "Efter at Moses, Herrens tjener, var død, sagde HERREN til Josva:"], ["1:2", "Min tjener er død."]]);
  assert.match(files.md, /\n1:1\tEfter at Moses, Herrens tjener, var død, sagde HERREN til Josva:\n/);   // white space collapsed
  for (const ext of ["units", "notes", "align"]) assert.equal(headerHash(files[ext].split("\n")), want, ext);
  assert.match(files.units, /^# units: aligned;/);                                 // the cuts did not change
  assert.match(files.units, new RegExp(`1:1\\t${A}:0-6 ${B}:7-10 ${C}:=\\n1:2\\t${D}:0-3\\n`));
  const notes = parseNotes(files.notes).notes;
  assert.deepEqual(notes.map((n) => n.anchor), [7, 4]);                           // before "sagde" (5 -> 7); 1:2 untouched
  const a = parseAlign(files.align).rows;
  assert.deepEqual(a.get(1), { main: "0:5 1:2,5 2:6 3:7 4:8 5:10", fn: "1:0-1 2:9 u3@7 +6,9>2", profile: "s" });
  assert.deepEqual(a.get(2), { main: "0:1 1:3", fn: "0:0 1:2", profile: "b" });  // verse 2 as it was
  assert.deepEqual(verseInfo(readChapter(files))["1:1"], { profile: "s", stale: false });
});

test("a removed word: its links go, the anchor moves to the next word", () => {
  const c = ch();
  const list = applyBox(c.list, 2, "Min er død.").units;                          // "tjener" (token 1) removed
  const { files } = buildChapter(c, list);
  assert.deepEqual(parseAlign(files.align).rows.get(2), { main: "1:2", fn: "0:0 1:1", profile: "s" });
  assert.deepEqual(parseNotes(files.notes).notes.map((n) => n.anchor), [5, 3]);   // the end stays the end
});

test("a split writes key.2 and marks the units edited; a join writes =", () => {
  const c = ch();
  const s = buildChapter(c, split(c.list, 0, "Efter at Moses".length).units).files;
  assert.match(s.units, /^# units: edited;/);
  assert.match(s.units, new RegExp(`1:1\\t${A}:0-2 ${A}.2:3-4 ${B}:5-8 ${C}:=\\n`));
  assert.equal(s.md, chapterFiles().md);                                          // a re-cut leaves the text alone
  assert.equal(s.align, chapterFiles().align);
  const j = buildChapter(c, applyBox(c.list, 1, "%sagde HERREN til Josva:").units).files;
  assert.match(j.units, new RegExp(`1:1\\t${A}:0-8 ${B}:= ${C}:=\\n`));
  assert.deepEqual(readChapter({ ...chapterFiles(), units: j.units }).list[0].bases, [A, B, C]);
});

test("a clause without words is refused", () => {
  const c = ch();
  const r = buildChapter(c, applyBox(c.list, 1, "40.").units);
  assert.match(r.error, /no words/);
});

test("headings and notes for display", () => {
  const d = display(ch());
  assert.equal(d.title, "Josvabogen, kapitel 1");
  assert.deepEqual(d.headings, { "1:1": ["Josva bliver leder"] });
  assert.equal(d.notes["1:2"][0].text, "Sidste.");
});

test("merge by verse over all four files; both sides on one verse is a conflict", () => {
  const base = ch();
  const ours = readChapter(buildChapter(base, applyBox(base.list, 2, "Min tjener Moses er død.").units).files);
  const theirs = readChapter(buildChapter(base, applyBox(base.list, 0, "Efter at Moses var gået bort,").units).files);
  const m = mergeChapter(base, ours, theirs);
  assert.equal(m.conflicts.length, 0);
  const r = readChapter(m.files);
  assert.equal(r.stale.align || r.stale.units || r.stale.notes, false);
  assert.deepEqual(r.verses.map((v) => v.text), ["Efter at Moses var gået bort, sagde HERREN til Josva:", "Min tjener Moses er død."]);
  assert.equal(r.align.rows.get(1).profile, "s");
  assert.deepEqual(r.notes.notes.map((n) => n.anchor), [6, 5]);                  // each verse's anchors from its own side
  const theirs2 = readChapter(buildChapter(base, applyBox(base.list, 2, "Min tjener er nu død.").units).files);
  const c = mergeChapter(base, ours, theirs2);
  assert.deepEqual(c.conflicts.map((x) => x.ref), ["1:2"]);
  assert.equal(c.files, undefined);
  const done = readChapter(mergeChapter(base, ours, theirs2, { "1:2": "theirs" }).files);
  assert.equal(done.verses[1].text, "Min tjener er nu død.");
  assert.equal(parseUnits(chapterFiles().units).verses.size, 2);
});
