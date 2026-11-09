// Alternative drafts (template/FORMAT.md section 9): their words per clause, the agreement shading computed from the current
// text, the format check, and load reading them from main for both stores.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { altUnits, agreement, forUnit, clauseOf, readmeLines, shade } from "../src/lib/alternatives.js";
import { parseUnits } from "../src/lib/format.js";
import { validate } from "../template/.github/check/validate.mjs";
import { LocalGitStore } from "../src/lib/store/local-git.js";
import { GitHubStore, newCache } from "../src/lib/store/github.js";
import * as S from "../src/lib/service.js";
import { chapterFiles, files, A, B, C, D } from "./fixture.js";
import { mockGitHub } from "./github-mock.js";

const K1 = "010010010011-010010010031", K2 = "010010010041-010010010091";
const alt = (kind, text, units) => ({ kind, about: kind, verses: altUnits([{ ref: "1:1", text }], parseUnits(`# units: authored\n1:1\t${units}\n`).verses) });

test("FORMAT.md section 9's example: support 1 1 0 0 0 of 2", () => {
  const nllb = alt("nllb", "zeta alfa x y", `${K1}:0 ${K2}:1-3`);
  const shape = alt("shape", "epsilon beta", `${K1}:0 ${K2}:1`);
  const ag = agreement([nllb, shape], { ref: "1:1", bases: [K2], text: "Alfa beta, gamma delta epsilon." });
  assert.equal(ag.available, 2);
  assert.deepEqual(ag.tokens.map((t) => t.support), [1, 1, 0, 0, 0]);   // Alfa = alfa (lower-cased); epsilon is in shape's clause 1 only
  assert.deepEqual(ag.tokens[0].kinds, ["nllb"]);
  assert.deepEqual(ag.tokens.map((t) => shade(ag.available, t.support)), ["some", "some", "nil", "nil", "nil"]);
  assert.equal(ag.tokens[1].start, 5);                                  // offsets in the text, for the shading
});

test("clauses: /n and .n reduce to the clause, = has no words, a main unit counts its = keys, nothing crosses a verse", () => {
  assert.equal(clauseOf(`${K2}/2`), K2);
  assert.equal(clauseOf(`${K2}.2`), K2);
  const a = alt("a", "alfa beta gamma", `${K1}:0 ${K2}:1 ${K2}/2.2:2`);
  assert.deepEqual(forUnit([a], { ref: "1:1", bases: [K2], text: "" })[0].units.map((x) => x.text), ["beta", "gamma"]);
  const eq = alt("eq", "alfa beta", `${K1}:0-1 ${K2}:=`);
  const u = { ref: "1:1", bases: [K2], text: "alfa beta" };
  assert.equal(agreement([eq], u).available, 0);                        // only `=` for the clause: nothing to compare
  assert.equal(agreement([eq], { ...u, bases: [K1, K2] }).available, 1); // a main unit with the clause joined in
  assert.deepEqual(agreement([eq], { ...u, ref: "1:2" }).available, 0);  // another verse
  assert.deepEqual(readmeLines("# x\n- `nllb` (GEN 1-50): NLLB-200 fine-tuned; built 2026-11-08\n"), { nllb: "`nllb` (GEN 1-50): NLLB-200 fine-tuned; built 2026-11-08" });
});

// an alternative of the fixture's chapter: same clause cuts (9 and 4 tokens), other words
const ALT_VERSES = [["1:1", "Da Moses var død, talte HERREN til Josva og:"], ["1:2", "Min tjener Moses døde."]];
function altFiles(kind = "nllb", { front = `alternative: "${kind}"\nbuilt: "2026-11-08"\n` } = {}) {
  const t = chapterFiles(ALT_VERSES);
  return { ...t, md: t.md.replace("chapter: 1\n", `chapter: 1\n${front}`), units: t.units.replace("# units: aligned", "# units: authored") };
}
const README = "# Alternative drafts\n\n- `nllb` (JOS 1): NLLB-200 fine-tuned on the team's text; built 2026-11-08\n";
const KEYS = { JOS: { "1:1": [A, B, C], "1:2": [D] } };
const repo = (extra = {}) => new Map(Object.entries({ "README.md": "# x\n", ".tanakh/layout.json": "{}", ...files("JOS/JOS_001", chapterFiles()),
  ".tanakh/alternatives/README.md": README, ...files(".tanakh/alternatives/nllb/JOS/JOS_001", altFiles()), ...extra }));
const problems = (r, opts = { keys: KEYS }) => validate(r, opts).errors.map((e) => `${e.file}${e.line ? `:${e.line}` : ""} ${e.msg}`);

test("the check: an alternative gets every chapter check and its own keys", () => {
  assert.deepEqual(problems(repo()), []);
  assert.equal(validate(repo(), { keys: KEYS }).chapters, 2);
  const base = ".tanakh/alternatives/nllb/JOS/JOS_001";
  const t = altFiles();
  assert.match(problems(repo(files(base, { ...t, md: t.md.replace("Min tjener", "Min tjenerinde") })))[0], /nllb\/JOS\/JOS_001\.units:2 stale/);
  assert.match(problems(repo(files(base, { ...t, units: t.units.replace(`${D}:0-3`, "060010020011-060010020099:0-3") })))[0], /not a clause of JOS 1:2/);
  assert.match(problems(repo(files(base, altFiles("nllb", { front: 'alternative: "shape"\nbuilt: "2026-11-08"\n' }))))[0], /alternative: "nllb"/);
  assert.match(problems(repo(files(base, altFiles("nllb", { front: 'alternative: "nllb"\n' }))))[0], /built: "YYYY-MM-DD"/);
  assert.match(problems(repo(files(base, { ...t, units: t.units.replace("# units: authored", "# units: edited") })))[0], /authored/);
  const r = repo(); r.delete(`${base}.align`);
  assert.match(problems(r)[0], /all four files: .*JOS_001\.align missing/);
  assert.match(problems(repo({ ".tanakh/alternatives/nllb/notes.txt": "x" }))[0], /not a file of the alternative drafts/);
  assert.match(problems(repo({ ".tanakh/alternatives/README.md": "# none\n" }))[0], /no line "- `nllb`/);
  const n = validate(repo(), { keys: KEYS, changed: [`${base}.md`] }).notices;
  assert.ok(n.some((x) => /changes the alternative drafts .*only the publisher/.test(x.msg)));
  assert.ok(!n.some((x) => /github\.com/.test(x.msg)));
});

const STORES = {
  local() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-alt-"));
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
  test(`${kind}: load gives the chapter's alternatives from main, none without them`, async () => {
    const st = make();
    await st().writeFiles("main", files("JOS/JOS_001", chapterFiles()), { message: "seed" });
    assert.deepEqual((await S.load(st(), null, "JOS/JOS_001.md")).alternatives, []);
    await st().writeFiles("main", { ".tanakh/alternatives/README.md": README, ...files(".tanakh/alternatives/nllb/JOS/JOS_001", altFiles()),
      ...files(".tanakh/alternatives/shape/JOS/JOS_002", altFiles("shape")) }, { message: "alternatives" });
    const [a, ...rest] = (await S.load(st(), null, "JOS/JOS_001.md")).alternatives;
    assert.equal(rest.length, 0);                                       // shape has no JOS 1
    assert.equal(a.kind, "nllb");
    assert.equal(a.built, "2026-11-08");
    assert.match(a.about, /NLLB-200/);
    assert.deepEqual(a.verses["1:1"].map((x) => [x.clause, x.text]), [[A, "Da Moses var død, talte"], [B, "HERREN til Josva og"]]);
    assert.deepEqual(a.verses["1:2"][0].words, ["min", "tjener", "moses", "døde"]);
  });
}
