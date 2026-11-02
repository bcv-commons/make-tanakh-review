import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalGitStore } from "../src/lib/store/local-git.js";
import { applyBox } from "../src/lib/units.js";
import { readChapter } from "../src/lib/chapter.js";
import * as S from "../src/lib/service.js";
import { chapterFiles, files } from "./fixture.js";

const F = "JOS/JOS_001.md";

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-svc-"));
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", path.join(dir, "x.git")]);
  const s = new LocalGitStore(path.join(dir, "x.git"), path.join(dir, "state.json"));
  s.writeFiles("main", { ...files("JOS/JOS_001", chapterFiles()), "README.md": "readme\n" }, { message: "seed" });
  s.setBranch("approved", s.branchHead("main"));
  s.saveState({ prs: [], roles: { reviewers: [], team: ["lead"] } });
  return s;
}

function edit(store, login, i, box) {
  const d = S.load(store, login, F);
  const r = applyBox(d.units, i, box);
  return S.save(store, login, F, r.units, d.version);
}

const onMain = (s, ext) => s.readFile("main", F.replace(/md$/, ext)).text;

test("the chapter list and what load gives the editor", () => {
  const s = fresh();
  assert.deepEqual(S.chapters(s), [{ book: "JOS", chapter: 1, path: F }]);
  const d = S.load(s, null, F);
  assert.equal(d.units.length, 3);
  assert.deepEqual(d.verses["1:1"], { profile: "b", stale: false });
  assert.equal(d.headings["1:1"][0], "Josva bliver leder");
  assert.equal(Object.keys(d.version).length, 4);
});

test("edit, review, merge, approve", () => {
  const s = fresh();
  const a = edit(s, "ann", 0, "Efter at Moses# var død,");          // split
  assert.equal(a.pr.number, 1);
  assert.equal(S.load(s, null, F).units.length, 3);                // readers still see main
  assert.equal(S.load(s, "ann", F).units.length, 4);               // ann sees her proposal
  edit(s, "ann", 3, "Min tjener Moses er død.");                    // second save: same PR
  assert.equal(s.listPRs().length, 1);
  assert.deepEqual(S.proposal(s, s.listPRs()[0])[0].verses, ["1:1", "1:2"]);
  S.requestReviewer(s, "rev");
  assert.ok(S.roles(s, "rev").reviewer && !S.roles(s, "rev").team);
  S.mergePR(s, "rev", 1);
  assert.equal(S.load(s, null, F).units.length, 4);
  const merged = readChapter({ md: onMain(s, "md"), units: onMain(s, "units"), notes: onMain(s, "notes"), align: onMain(s, "align") });
  assert.deepEqual(merged.stale, { units: false, notes: false, align: false });   // every sidecar hashes the merged text
  assert.equal(merged.align.rows.get(2).profile, "s");
  assert.throws(() => S.approve(s, "rev", F), /team/);
  assert.equal(S.awaitingApproval(s).length, 1);
  S.approve(s, "lead", F);
  assert.equal(S.awaitingApproval(s).length, 0);
  for (const ext of ["md", "units", "notes", "align"]) assert.equal(s.readFile("approved", F.replace(/md$/, ext)).text, onMain(s, ext));
  edit(s, "ann", 0, "Efter at Moses,");                             // next save after the merge: a new PR from main
  assert.equal(S.openPR(s, "ann").number, 2);
  assert.deepEqual(S.proposal(s, S.openPR(s, "ann"))[0].verses, ["1:1"]);
});

test("a save writes only the files that changed, in one commit", () => {
  const s = fresh();
  edit(s, "ann", 0, "Efter at Moses# var død,");                     // a re-cut: only the .units changes
  assert.deepEqual(s.changedFiles(s.branchHead("main"), s.branchHead("edit/ann")), ["JOS/JOS_001.units"]);
  edit(s, "ann", 3, "Min tjener er nu død.");                         // a text edit: all four
  assert.equal(s.changedFiles(s.branchHead("main"), s.branchHead("edit/ann")).length, 4);
  const r = S.save(s, "ann", F, S.load(s, "ann", F).units, S.load(s, "ann", F).version);
  assert.equal(r.unchanged, true);
});

test("a conflict blocks the merge until the author chooses", () => {
  const s = fresh();
  edit(s, "ann", 2, "Min tjener er nu død.");
  edit(s, "bo", 2, "Min tjener Moses er død.");
  edit(s, "bo", 0, "Efter at Moses var gået bort,");
  S.requestReviewer(s, "rev");
  S.mergePR(s, "rev", 1);
  assert.throws(() => S.mergePR(s, "rev", 2), /1:2/);
  assert.equal(S.openPR(s, "bo").status, "conflict");
  const u = S.updateBranch(s, "bo");
  assert.equal(u.conflicts.length, 1);
  S.updateBranch(s, "bo", { [F]: { "1:2": "theirs" } });           // keep main's 1:2, keep bo's 1:1
  S.mergePR(s, "rev", 2);
  const m = S.load(s, null, F).units;
  assert.equal(m[0].text, "Efter at Moses var gået bort,");
  assert.equal(m[2].text, "Min tjener er nu død.");
});

test("a pull request that touches other files is merged on github.com only", () => {
  const s = fresh();
  edit(s, "ann", 2, "Min tjener er nu død.");
  s.writeFiles("edit/ann", { "README.md": "changed\n" }, { message: "readme" });
  S.requestReviewer(s, "rev");
  assert.throws(() => S.mergePR(s, "rev", 1), /github\.com/);
});

test("a stale save is refused", () => {
  const s = fresh();
  const d = S.load(s, "ann", F);
  edit(s, "ann", 0, "Efter at Moses døde,");
  assert.throws(() => S.save(s, "ann", F, applyBox(d.units, 1, "sagde Herren:").units, d.version), /saved elsewhere/);
});

test("a clause without words is refused", () => {
  const s = fresh();
  assert.throws(() => edit(s, "ann", 2, "1."), /no words/);
});
