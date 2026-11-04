// Danish under the Hebrew words: the draft's own rendering from the chapter's .align (renderings.js), and the commonest
// renderings per lexeme from the language repo's `.tanakh/glosses.json` (FORMAT.md section 8), through each word's lexeme in
// compact-alignments' source index.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderings, wordLexemes, chapterGlosses, trimForms } from "../src/lib/renderings.js";
import { readChapter } from "../src/lib/chapter.js";
import { LocalGitStore } from "../src/lib/store/local-git.js";
import { GitHubStore, newCache } from "../src/lib/store/github.js";
import * as S from "../src/lib/service.js";
import { chapterFiles, files } from "./fixture.js";
import { mockGitHub } from "./github-mock.js";

// the source index of the fixture's verses: content and function morphemes in MACULA order (a fused a+b is one ordinal), and
// their lexemes (published without the prefix)
const index = {
  keys: { "JOS 1:1": ["060010010011", "060010010031", "060010010041"], "JOS 1:2": ["060010020011"] },
  fn: { "JOS 1:1": ["060010010012", "060010010021+060010010022"], "JOS 1:2": ["060010020021"] },
  lexemes: { "JOS 1:1": ["1961", "4194", "4872"], "JOS 1:2": ["5650"] },
  fnLexemes: { "JOS 1:1": ["2050b", "0310"], "JOS 1:2": ["2050b"] },
};
const TABLE = { format: "make-tanakh-glosses/1", language: "dan", lexemes: {
  "hbo:4194": [["død", 24], ["døden", 20], ["dødens", 8], ["døde", 5], ["dødsdag", 4]], "hbo:0310": [["efter", 194]],
  "hbo:5650": [["tjenere", 158], ["tjener", 153]] } };

test("the draft's rendering of each Hebrew word, from its links", () => {
  const ch = readChapter(chapterFiles());
  const r = renderings(index, { book: "JOS", verses: ch.verses, align: ch.align.rows });
  // 1:1 main "0:3 1:2-3 2:4 ...", fn "1:0-1 2:7 ..."; tokens Efter(0) at(1) Moses(2) var(3) død(4) ...
  assert.equal(r["06001001001"], "var");              // content ordinal 0; its function morpheme (fn 0) has no link
  assert.equal(r["06001001003"], "Moses var");        // a range
  assert.equal(r["06001001004"], "død");
  assert.equal(r["06001001002"], "Efter at");          // a fused function token
  assert.equal(r["06001002001"], "tjener");            // 1:2 main "0:1 ..."
  assert.equal(renderings(null, { book: "JOS", verses: ch.verses, align: ch.align.rows })["06001001001"], undefined);
});

test("each word's lexeme (content before function), and its commonest renderings", () => {
  const lex = wordLexemes(index, "JOS", ["1:1", "1:2"]);
  assert.equal(lex["06001001001"], "hbo:1961");        // content wins over the word's function morpheme (2050b)
  assert.equal(lex["06001001002"], "hbo:0310");        // a function word only, fused key
  assert.equal(lex["06001002002"], "hbo:2050b");
  assert.deepEqual(wordLexemes({ ...index, lexemes: null }, "JOS", ["1:1"]), {});
  const g = chapterGlosses(TABLE, lex);
  assert.deepEqual(g["06001001003"], [["død", 24], ["døden", 20], ["dødens", 8], ["døde", 5]]);   // four at most
  assert.equal(g["06001001004"], undefined);                                                     // no forms for Moses
  assert.deepEqual(chapterGlosses(null, lex), {});
  assert.deepEqual(trimForms([["josva", 174], ["josvas", 3], ["han", 2], ["føre krig", 1]]), [["josva", 174]]);   // noise out
  assert.deepEqual(trimForms([["nun", 1], ["nuns", 1]]), [["nun", 1]]);                                        // all rare: one
});

const STORES = {
  local() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-gl-"));
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", path.join(dir, "x.git")]);
    const s = new LocalGitStore(path.join(dir, "x.git"), path.join(dir, "state.json"));
    s.saveState({ prs: [], roles: { reviewers: [], team: [] } });
    return () => s;
  },
  github() {
    const gh = mockGitHub(), app = gh.appToken(), cache = newCache();
    return () => new GitHubStore({ owner: "global-tanakh", repo: "dan", app, fetch: gh.fetch, cache });
  },
};
for (const [kind, make] of Object.entries(STORES)) {
  test(`${kind}: load gives the chapter's glosses from the repo's .tanakh/glosses.json, none without it`, async () => {
    const st = make();
    await st().writeFiles("main", files("JOS/JOS_001", chapterFiles()), { message: "seed" });
    assert.deepEqual((await S.load(st(), null, "JOS/JOS_001.md", { index })).glosses, {});
    await st().writeFiles("main", { ".tanakh/glosses.json": JSON.stringify(TABLE) }, { message: "glosses" });
    const d = await S.load(st(), null, "JOS/JOS_001.md", { index });
    assert.deepEqual(d.glosses["06001001001"], undefined);
    assert.deepEqual(d.glosses["06001001002"], [["efter", 194]]);
    assert.deepEqual(d.glosses["06001002001"], [["tjenere", 158], ["tjener", 153]]);
    assert.equal(d.renderings["06001002001"], "tjener");
  });
}
