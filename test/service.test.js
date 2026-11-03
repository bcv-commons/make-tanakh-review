// The flows of service.js, run against both stores: LocalGitStore (a bare repo) and GitHubStore (a mock GitHub, test/github-mock.js).
// On GitHub each request has its own store for its user, so the tests make a new one per step: `st(login)` (null: a reader).
// There, ann and bo have no push access (their branches live in forks), lead is on the team with push access.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalGitStore } from "../src/lib/store/local-git.js";
import { GitHubStore, newCache } from "../src/lib/store/github.js";
import { applyBox } from "../src/lib/units.js";
import { readChapter } from "../src/lib/chapter.js";
import * as S from "../src/lib/service.js";
import { chapterFiles, files } from "./fixture.js";
import { mockGitHub } from "./github-mock.js";

const F = "JOS/JOS_001.md";
const SEED = () => ({ ...files("JOS/JOS_001", chapterFiles()), "README.md": "readme\n" });

const STORES = {
  async local() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-svc-"));
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", path.join(dir, "x.git")]);
    const s = new LocalGitStore(path.join(dir, "x.git"), path.join(dir, "state.json"));
    s.writeFiles("main", SEED(), { message: "seed" });
    s.setBranch("approved", s.branchHead("main"));
    s.saveState({ prs: [], roles: { reviewers: [], team: ["lead"] } });
    return { st: () => s };
  },
  async github() {
    const gh = mockGitHub(), app = gh.appToken(), cache = newCache();
    const st = (login = null) => new GitHubStore({ owner: "global-tanakh", repo: "dan", app, fetch: gh.fetch, cache, wait: 0,
      user: login ? gh.user(login, { push: login === "lead" }) : null });
    const s = st();
    await s.writeFiles("main", { ...SEED(), "roles.json": JSON.stringify({ reviewers: [], team: ["lead"] }) + "\n" }, { message: "seed" });
    await s.setBranch("approved", await s.branchHead("main"));
    return { st, gh };
  },
};

for (const [kind, fresh] of Object.entries(STORES)) {
  const edit = async (st, login, i, box) => {
    const d = await S.load(st(login), login, F);
    const r = applyBox(d.units, i, box);
    return S.save(st(login), login, F, r.units, d.version);
  };
  const onMain = async (st, ext) => (await st().readFile("main", F.replace(/md$/, ext))).text;

  test(`${kind}: the chapter list and what load gives the editor`, async () => {
    const { st } = await fresh();
    assert.deepEqual(await S.chapters(st()), [{ book: "JOS", chapter: 1, path: F }]);
    const d = await S.load(st(), null, F);
    assert.equal(d.units.length, 3);
    assert.deepEqual(d.verses["1:1"], { profile: "b", stale: false });
    assert.equal(d.headings["1:1"][0], "Josva bliver leder");
    assert.equal(Object.keys(d.version).length, 4);
  });

  test(`${kind}: edit, review, merge, approve`, async () => {
    const { st } = await fresh();
    const a = await edit(st, "ann", 0, "Efter at Moses# var død,");          // split
    assert.equal(a.pr.number, 1);
    assert.equal((await S.load(st(), null, F)).units.length, 3);            // readers still see main
    assert.equal((await S.load(st("ann"), "ann", F)).units.length, 4);      // ann sees her proposal
    assert.equal((await S.load(st("rev"), "ann", F)).units.length, 4);      // and so does anyone looking at it
    await edit(st, "ann", 3, "Min tjener Moses er død.");                    // second save: same PR
    assert.equal((await st().listPRs()).length, 1);
    assert.deepEqual((await S.proposal(st(), (await st().listPRs())[0]))[0].verses, ["1:1", "1:2"]);
    await S.requestReviewer(st("rev"), "rev");
    const r = await S.roles(st(), "rev");
    assert.ok(r.reviewer && !r.team);
    await S.mergePR(st("rev"), "rev", 1);
    assert.equal((await S.load(st(), null, F)).units.length, 4);
    assert.equal((await st().listPRs()).find((p) => p.number === 1).status, "merged");
    const merged = readChapter({ md: await onMain(st, "md"), units: await onMain(st, "units"), notes: await onMain(st, "notes"), align: await onMain(st, "align") });
    assert.deepEqual(merged.stale, { units: false, notes: false, align: false });   // every sidecar hashes the merged text
    assert.equal(merged.align.rows.get(2).profile, "s");
    await assert.rejects(S.approve(st("rev"), "rev", F), /team/);
    assert.equal((await S.awaitingApproval(st())).length, 1);
    await S.approve(st("lead"), "lead", F);
    assert.equal((await S.awaitingApproval(st())).length, 0);
    for (const ext of ["md", "units", "notes", "align"])
      assert.equal((await st().readFile("approved", F.replace(/md$/, ext))).text, await onMain(st, ext));
    await edit(st, "ann", 0, "Efter at Moses,");                             // next save after the merge: a new PR from main
    assert.equal((await S.openPR(st(), "ann")).number, 2);
    assert.deepEqual((await S.proposal(st(), await S.openPR(st(), "ann")))[0].verses, ["1:1"]);
  });

  test(`${kind}: a save writes only the files that changed, in one commit`, async () => {
    const { st } = await fresh();
    const changed = async () => st().changedFiles(await st().branchHead("main"), await st("ann").branchHead("edit/ann"));
    await edit(st, "ann", 0, "Efter at Moses# var død,");                     // a re-cut: only the .units changes
    assert.deepEqual(await changed(), ["JOS/JOS_001.units"]);
    await edit(st, "ann", 3, "Min tjener er nu død.");                         // a text edit: all four
    assert.equal((await changed()).length, 4);
    const d = await S.load(st("ann"), "ann", F);
    const r = await S.save(st("ann"), "ann", F, d.units, d.version);
    assert.equal(r.unchanged, true);
  });

  test(`${kind}: a conflict blocks the merge until the author chooses`, async () => {
    const { st } = await fresh();
    await edit(st, "ann", 2, "Min tjener er nu død.");
    await edit(st, "bo", 2, "Min tjener Moses er død.");
    await edit(st, "bo", 0, "Efter at Moses var gået bort,");
    await S.requestReviewer(st("rev"), "rev");
    await S.mergePR(st("rev"), "rev", 1);
    await assert.rejects(S.mergePR(st("rev"), "rev", 2), /1:2/);
    assert.equal((await S.openPR(st(), "bo")).status, "conflict");
    const u = await S.updateBranch(st("bo"), "bo");
    assert.equal(u.conflicts.length, 1);
    await S.updateBranch(st("bo"), "bo", { [F]: { "1:2": "theirs" } });      // keep main's 1:2, keep bo's 1:1
    assert.equal((await S.openPR(st(), "bo")).status, "open");
    await S.mergePR(st("rev"), "rev", 2);
    const m = (await S.load(st(), null, F)).units;
    assert.equal(m[0].text, "Efter at Moses var gået bort,");
    assert.equal(m[2].text, "Min tjener er nu død.");
  });

  test(`${kind}: a pull request that touches other files is merged on github.com only`, async () => {
    const { st } = await fresh();
    await edit(st, "ann", 2, "Min tjener er nu død.");
    await st("ann").writeFiles("edit/ann", { "README.md": "changed\n" }, { message: "readme" });
    await S.requestReviewer(st("rev"), "rev");
    await assert.rejects(S.mergePR(st("rev"), "rev", 1), /github\.com/);
  });

  test(`${kind}: a stale save is refused`, async () => {
    const { st } = await fresh();
    const d = await S.load(st("ann"), "ann", F);
    await edit(st, "ann", 0, "Efter at Moses døde,");
    await assert.rejects(S.save(st("ann"), "ann", F, applyBox(d.units, 1, "sagde Herren:").units, d.version), /saved elsewhere/);
  });

  test(`${kind}: a clause without words is refused`, async () => {
    const { st } = await fresh();
    await assert.rejects(edit(st, "ann", 2, "1."), /no words/);
  });

  test(`${kind}: closing a proposal`, async () => {
    const { st } = await fresh();
    await edit(st, "ann", 2, "Min tjener er nu død.");
    await assert.rejects(S.closePR(st("bo"), "bo", 1), /author or a reviewer/);
    await S.closePR(st("ann"), "ann", 1);
    assert.equal((await st().listPRs()).find((p) => p.number === 1).status, "closed");
    assert.equal(await S.openPR(st(), "ann"), null);
  });
}
