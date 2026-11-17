// Word parts for the editor (src/lib/parts.js; FORMAT.md section 12): fresh rows only, offsets on the verse text, pieces read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wordParts, pieces, verseHash } from "../src/lib/parts.js";

const verses = [{ ref: "1:7", text: "Nø̀qa᷄v ba." }, { ref: "1:8", text: "Omu ali." }];
const H = "# parts: make-tanakh-parts/1; splitter morphs.py@000000000000 bcv_segment.py@000000000000 seg_facts.json@000000000000; unicode 15.1";

test("pieces: text, slot, morph id; tone pieces kept as such; unreadable -> null", () => {
  assert.deepEqual(pieces("nø:stem|:tone:tone-proh@4:̀;2:᷄|qav:s0:m:-qav:verb"),
    [{ text: "nø", slot: "stem", morph: null }, { tone: "tone-proh" }, { text: "qav", slot: "s0", morph: "m:-qav:verb" }]);
  assert.equal(pieces("x:nope"), null);
  assert.equal(pieces(":tone"), null);
});

test("wordParts: a row per verse whose hash matches; token offsets; stale and malformed rows left out", () => {
  const v7 = verses[0].text.normalize("NFC");
  const text = [H,
    ["1:7", verseHash("1:7", v7), "0=nø:stem|:tone@4:̀;2:᷄|qav:s0:m:-qav:verb", "1=ba:whole"].join("\t"),
    ["1:8", "00000000", "0=Omu:whole", "1=ali:whole"].join("\t")].join("\n");
  const out = wordParts(text, [{ ref: "1:7", text: v7 }, verses[1]]);
  assert.deepEqual(Object.keys(out), ["1:7"]);                              // 1:8 stale
  assert.equal(out["1:7"].text, v7);
  assert.deepEqual(out["1:7"].words.map((w) => v7.slice(w.start, w.end)), [v7.split(" ")[0], "ba"]);
  assert.equal(out["1:7"].words[0].pieces[2].morph, "m:-qav:verb");
  // (the tokeniser drops punctuation) a cell count that does not match the tokens, a bad header, no file
  assert.deepEqual(wordParts([H, ["1:7", verseHash("1:7", v7), "0=x:whole"].join("\t")].join("\n"), [{ ref: "1:7", text: v7 }]), {});
  assert.deepEqual(wordParts("# parts: other/1;\n", verses), {});
  assert.deepEqual(wordParts(null, verses), {});
});
