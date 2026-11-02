import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBox, split, join, changedVerses, toBox, fromBox, atoms, clauseKey } from "../src/lib/units.js";
import { readChapter } from "../src/lib/chapter.js";
import { chapterFiles, A, B, C, D } from "./fixture.js";

const units = () => readChapter(chapterFiles()).list;

test("the chapter cut into units: a = unit is one more clause of the unit before it", () => {
  assert.deepEqual(units(), [
    { ref: "1:1", bases: [A], text: "Efter at Moses var død," },
    { ref: "1:1", bases: [B, C], text: "sagde HERREN til Josva:" },
    { ref: "1:2", bases: [D], text: "Min tjener er død." },
  ]);
  assert.equal(clauseKey(`${A}/2`), "060010010011");
});

test("# splits a one-clause unit; the label numbers the second part .2; % joins them back", () => {
  const r = applyBox(units(), 0, "Efter at Moses# var død,");
  assert.equal(r.units.length, 4);
  assert.equal(r.focus, 1);
  assert.deepEqual(atoms(r.units).slice(0, 2), ["060010010011", "060010010011.2"]);
  const back = applyBox(r.units, 1, "%var død,");
  assert.deepEqual(back.units, units());
});

test("a split of a joined unit gives each part its clauses; % at the end joins the unit after", () => {
  const r = split(units(), 1, "sagde HERREN".length);
  assert.deepEqual(r.units.slice(1, 3).map((u) => u.bases), [[B], [C]]);
  const j = applyBox(r.units, 1, "sagde HERREN%");
  assert.deepEqual(j.units, units());
});

test("joins stay within a verse; nothing lost on a refused join", () => {
  const r = applyBox(units(), 2, "%Min tjener er død.");
  assert.ok(r.error);
  assert.equal(r.units.length, 3);
  assert.equal(r.units[2].text, "Min tjener er død.");
  assert.ok(join(units(), 2).error);
});

test("escaped characters stay text", () => {
  assert.equal(fromBox(toBox("50 % af #1")), "50 % af #1");
  const r = applyBox(units(), 2, "Min tjener \\# er død \\%");
  assert.equal(r.units.length, 3);
  assert.equal(r.units[2].text, "Min tjener # er død %");
});

test("a split at the edge is refused", () => {
  assert.ok(split(units(), 0, 0).error);
});

test("changed verses", () => {
  const base = units();
  const ours = applyBox(base, 2, "Min tjener Moses er død.").units;
  assert.deepEqual(changedVerses(base, ours), ["1:2"]);
  assert.deepEqual(changedVerses(base, split(base, 0, 5).units), ["1:1"]);
});
