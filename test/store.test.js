import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalGitStore, StaleError } from "../src/lib/store/local-git.js";

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-test-"));
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", path.join(dir, "x.git")]);
  return new LocalGitStore(path.join(dir, "x.git"), path.join(dir, "state.json"));
}

test("write, read, stale refusal", () => {
  const s = fresh();
  const r = s.writeFiles("main", { "A/a.md": "one\n" }, { message: "seed" });
  assert.equal(s.readFile("main", "A/a.md").text, "one\n");
  s.setBranch("edit/ann", s.branchHead("main"));
  const v = s.readFile("edit/ann", "A/a.md").version;
  assert.equal(v, r.versions["A/a.md"]);
  s.writeFiles("edit/ann", { "A/a.md": "two\n" }, { message: "edit", coAuthor: "ann", expect: { "A/a.md": v } });
  assert.throws(() => s.writeFiles("edit/ann", { "A/a.md": "three\n" }, { message: "x", expect: { "A/a.md": v } }), StaleError);
  assert.equal(s.readFile("main", "A/a.md").text, "one\n");
  assert.deepEqual(s.changedFiles("main", "edit/ann"), ["A/a.md"]);
  const msg = s.git(["log", "-1", "--format=%an|%B", "edit/ann"]);
  assert.match(msg, /^make-tanakh-review\[bot\]\|edit\n\nCo-authored-by: ann/);
});

test("merge commit has two parents and the merged content", () => {
  const s = fresh();
  s.writeFiles("main", { "f.md": "one\n" }, { message: "seed" });
  s.setBranch("edit/bo", s.branchHead("main"));
  s.writeFiles("edit/bo", { "f.md": "two\n" }, { message: "edit" });
  s.commitMerge("main", "edit/bo", { "f.md": "two\n" }, { message: "Merge #1", coAuthor: "rev" });
  assert.equal(s.git(["rev-list", "--parents", "-n", "1", "main"]).split(" ").length, 3);
  assert.equal(s.readFile("main", "f.md").text, "two\n");
  assert.equal(s.mergeBase("main", "edit/bo"), s.branchHead("edit/bo"));
});

test("pull request records", () => {
  const s = fresh();
  const a = s.createPR({ author: "ann", branch: "edit/ann" });
  const b = s.createPR({ author: "bo", branch: "edit/bo" });
  assert.equal(b.number, a.number + 1);
  s.updatePR(a.number, { status: "merged" });
  assert.equal(s.listPRs().find((p) => p.number === a.number).status, "merged");
});
