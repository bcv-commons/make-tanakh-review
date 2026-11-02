// Poetry lines placed in a translation (FORMAT.md section 5): clause-keyed lines at the unit's start, word-keyed lines through
// the alignment (the source index gives the ordinals), lines that begin with words rendering nothing of their own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterBreaks, poemLines, ordinals, wordRef } from "../src/lib/poetry.js";
import { readChapter } from "../src/lib/chapter.js";
import { chapterFiles } from "./fixture.js";

// JOS 1:1 in the fixture: Efter(0) at(1) Moses(2) var(3) død(4) sagde(5) HERREN(6) til(7) Josva(8); units A 0-4, B 5-8, C =;
// .align row 1: main "0:3 1:2-3 2:4 3:5 4:6 5:8", fn "1:0-1 2:7 ..."
const INDEX = {
  keys: { "JOS 1:1": ["060010010012", "060010010031", "060010010041", "060010010072", "060010010081", "060010010101"] },
  fn: { "JOS 1:1": ["060010010011", "060010010021", "060010010091"] },
};
const ch = () => { const c = readChapter(chapterFiles()); return { book: "JOS", chapter: 1, units: c.units.verses, align: c.align.rows }; };

test("ids and ordinals", () => {
  assert.equal(wordRef("060010010081"), "1:1");
  assert.deepEqual(ordinals(INDEX, "JOS", "1:1")["060010010081"], ["c", 4]);
  assert.deepEqual(ordinals({ keys: { "JOS 1:1": ["a+b"] }, fn: {} }, "JOS", "1:1"), { a: ["c", 0], b: ["c", 0] });
});

test("a clause-keyed line begins with its unit; a word-keyed one with the first word its Hebrew words are linked to", () => {
  const r = chapterBreaks([["060010010071", 1, "clause"], ["060010010081", 2, "word"], ["060020010011", 1, "clause"]], ch(), INDEX);
  assert.deepEqual(r.breaks, { "1:1": [{ at: 5, level: 1 }, { at: 6, level: 2 }] });   // chapter 2's line is not this chapter's
  assert.equal(r.placed, 2);
  // keyed inside its clause by a later word (another word order): the line takes the clause's words before it too
  assert.deepEqual(chapterBreaks([["060010010041", 1, "word"]], ch(), INDEX).breaks, { "1:1": [{ at: 0, level: 1 }] });
  // without the index only clause-keyed lines are placed
  assert.deepEqual(chapterBreaks([["060010010081", 2, "word"], ["060010010071", 1, "clause"]], ch(), null), { breaks: { "1:1": [{ at: 5, level: 1 }] }, placed: 1, missed: 1 });
});

test("a line begins with the unlinked words before it, not with an added word of an earlier Hebrew word", () => {
  // Og(0) hele(1) folket(2): c0 = כָּל -> hele, c1 -> folket; "Og" added for nothing / for fn word 0, the clause before
  const units = new Map([["1:1", [{ key: "060010010011-060010010011", seg: "", part: "", ranges: [[0, 0]] },
    { key: "060010010021-060010010031", seg: "", part: "", ranges: [[1, 2]] }]]]);
  const index = { keys: { "JOS 1:1": ["060010010021", "060010010031"] }, fn: { "JOS 1:1": ["060010010011"] } };
  const at = (fn) => chapterBreaks([["060010010021", 1, "word"]], { book: "JOS", chapter: 1, units, align: new Map([[1, { main: "0:1 1:2", fn, profile: "b" }]]) }, index).breaks["1:1"][0].at;
  assert.equal(at("+0"), 0);
  assert.equal(at("+0>f0"), 1);
});

test("a verse in lines: the text before the first break continues the line before", () => {
  const t = "Efter at Moses var død, sagde HERREN til Josva:";
  assert.deepEqual(poemLines(t, [{ at: 5, level: 1 }, { at: 7, level: 2 }]),
    [{ level: 0, text: "Efter at Moses var død," }, { level: 1, text: "sagde HERREN" }, { level: 2, text: "til Josva:" }]);
  assert.deepEqual(poemLines(">>Hør! Og nu", [{ at: 0, level: 1 }, { at: 1, level: 2 }]), [{ level: 1, text: ">>Hør!" }, { level: 2, text: "Og nu" }]);
});
