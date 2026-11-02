// The chapter format against the files the grammar side seeded (.local/repos/dan-v2.git, 299 Danish chapters; skipped when the
// test repo is not there): the text hash of every sidecar, byte-exact round trips, the tokeniser against the token ranges, and
// the unit cut built back to the same .units rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as F from "../src/lib/format.js";
import { TOKENIZER_VERSION as VENDORED } from "../src/lib/vendor/tokenize.js";
import { readChapter, buildChapter, unitsRow } from "../src/lib/chapter.js";
import { byVerse } from "../src/lib/units.js";

const REPO = path.resolve(".local/repos/dan-v2.git");
const have = fs.existsSync(REPO);
const git = (...a) => execFileSync("git", ["--git-dir", REPO, ...a], { encoding: "utf8", maxBuffer: 1 << 30 });

function chapters() {
  // every chapter file of main in one call: `git cat-file --batch` over the tree
  const names = git("ls-tree", "-r", "--name-only", "main").split("\n").filter((f) => /^[A-Z0-9]{3}\/[A-Z0-9]{3}_\d{3}\.(md|units|notes|align)$/.test(f));
  const out = execFileSync("git", ["--git-dir", REPO, "cat-file", "--batch"], { input: names.map((n) => `main:${n}`).join("\n") + "\n", maxBuffer: 1 << 30 });
  const by = new Map();
  let at = 0;
  for (const n of names) {
    const nl = out.indexOf(10, at);
    const size = Number(out.subarray(at, nl).toString().split(" ")[2]);
    const text = out.subarray(nl + 1, nl + 1 + size).toString("utf8");
    at = nl + 1 + size + 1;
    const [base, ext] = [n.replace(/\.\w+$/, ""), n.split(".").pop()];
    if (!by.has(base)) by.set(base, {});
    by.get(base)[ext] = text;
  }
  return by;
}

test("the vendored tokeniser is the version the dataset publishes", () => {
  assert.equal(VENDORED, F.TOKENIZER_VERSION);
  assert.deepEqual(F.tokenize("Jeg så 40 mænd – og «Guds» ånd!"), ["Jeg", "så", "mænd", "og", "Guds", "ånd"]);   // digits separate
  const s = "Šálom 12 vé, 漢字";
  assert.deepEqual(F.tokenSpans(s).map((t) => s.normalize("NFC").slice(t.start, t.end)), ["Šálom", "vé", "漢", "字"]);
});

test("the text hash: integers, numeric order, no trailing newline", () => {
  const v = [{ ref: "1:10", text: "b" }, { ref: "1:2", text: "a" }];
  assert.equal(F.hashInput(v), "1:2:a\n1:10:b");
});

test("dan-v2: every sidecar hash, every round trip, every range, every cut", { skip: !have && "no .local/repos/dan-v2.git" }, () => {
  const all = chapters();
  assert.equal(all.size, 299);
  const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
  let verses = 0;
  for (const [base, t] of all) {
    const md = F.parseMd(t.md), U = F.parseUnits(t.units), N = F.parseNotes(t.notes), A = F.parseAlign(t.align);
    assert.deepEqual([md.errors, U.errors, N.errors], [[], [], []], base);
    const h = sha(F.hashInput(F.mdVerses(md)));
    for (const [ext, x] of [["units", U], ["notes", N], ["align", A]]) assert.equal(F.headerHash(x.header), h, `${base}.${ext}`);
    assert.equal(F.serializeMd(md), t.md, `${base}.md`);
    assert.equal(F.serializeUnits(U), t.units, `${base}.units`);
    assert.equal(F.serializeNotes(N), t.notes, `${base}.notes`);
    assert.equal(F.serializeAlign(A), t.align, `${base}.align`);
    const ch = readChapter(t);
    assert.deepEqual(buildChapter(ch, ch.list).files, t, base);
    const cut = byVerse(ch.list);
    for (const v of ch.verses) {
      verses++;
      const n = F.tokenize(v.text).length;
      const owner = new Array(n).fill(0);
      for (const u of U.verses.get(v.ref)) for (const [a, b] of u.ranges || []) for (let i = a; i <= b; i++) { assert.ok(i < n, `${base} ${v.ref}`); owner[i]++; }
      assert.ok(owner.every((x) => x === 1), `${base} ${v.ref}: every token in one unit`);
      for (const nt of N.notes.filter((x) => x.ref === v.ref)) assert.ok(nt.anchor <= n, `${base} ${v.ref} note`);
      const row = A.rows.get(Number(v.ref.split(":")[1]));
      if (row) assert.ok(F.alignPositions(row).every((p) => p < n), `${base} ${v.ref} align`);
      // the units the editor shows give back the same .units row, and their text is the verse
      const units = cut.get(v.ref);
      assert.equal(F.cleanText(units.map((u) => u.text).join(" ")), v.text, `${base} ${v.ref} text`);
      assert.equal(F.serializeUnits({ header: [], verses: new Map([[v.ref, unitsRow(v.ref, units).row]]) }),
        F.serializeUnits({ header: [], verses: new Map([[v.ref, U.verses.get(v.ref)]]) }), `${base} ${v.ref} cut`);
    }
  }
  assert.equal(verses, 8237);
});
