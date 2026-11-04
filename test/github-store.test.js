// GitHubStore against the mock GitHub (test/github-mock.js): what the shared service tests do not show - which token writes
// what, where a user's branch lives, a race on a branch, the object cache, and the App's installation token.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { GitHubStore, appTokens, blobSha, newCache } from "../src/lib/store/github.js";
import { StaleError } from "../src/lib/store/errors.js";
import { mockGitHub } from "./github-mock.js";

async function fresh() {
  const gh = mockGitHub(), app = gh.appToken(), cache = newCache();
  const st = (login = null, push = false) => new GitHubStore({ owner: "global-tanakh", repo: "dan", app, fetch: gh.fetch, cache,
    user: login ? gh.user(login, { push }) : null });
  await st().writeFiles("main", { "A/a.md": "one\n", "README.md": "readme\n" }, { message: "seed" });
  return { gh, st };
}

test("the App writes main as the bot with the person as co-author; a collaborator writes their own branch as themselves", async () => {
  const { gh, st } = await fresh();
  await st().writeFiles("main", { "A/a.md": "two\n" }, { message: "Approve A", coAuthor: "lead" });
  const head = gh.refs().get("main");
  assert.equal(gh.author(head), "make-tanakh-review[bot]");
  assert.match(gh.message(head), /^Approve A\n\nCo-authored-by: lead </);
  const lead = st("lead", true);
  await lead.setBranch("edit/lead", head);
  const r = await lead.writeFiles("edit/lead", { "A/a.md": "three\n" }, { message: "Edit A", coAuthor: "lead" });
  assert.equal(gh.author(r.commit), "lead");
  assert.equal(gh.message(r.commit), "Edit A\n");
  assert.equal(r.versions["A/a.md"], blobSha("three\n"));
  assert.equal((await st().readFile("main", "A/a.md")).text, "two\n");
  await assert.rejects(st("ann").writeFiles("edit/bo", { "A/a.md": "x\n" }, { message: "x" }), /only bo writes/);
});

test("a user without push access: the App writes their branch in the language repo, they open the pull request", async () => {
  const { gh, st } = await fresh();
  const main = gh.refs().get("main");
  await st("ann").setBranch("edit/ann", main);
  assert.ok(gh.refs().has("edit/ann"));
  assert.ok(!gh.repos.has("ann/dan"));                                // no fork
  const r = await st("ann").writeFiles("edit/ann", { "A/a.md": "ann\n" }, { message: "Edit", coAuthor: "ann" });
  assert.equal(gh.author(r.commit), "make-tanakh-review[bot]");
  assert.match(gh.message(r.commit), /Co-authored-by: ann </);
  const pr = await st("ann").createPR({ author: "ann", branch: "edit/ann", title: "Edits by ann" });
  assert.equal(pr.author, "ann");
  assert.match(gh.pulls[0].body, /given under CC0 1\.0/);
  assert.equal((await st("rev").readFile("edit/ann", "A/a.md")).text, "ann\n");
  assert.equal(await st("rev").mergeBase("main", "edit/ann"), main);
  assert.deepEqual(await st().changedFiles("main", "edit/ann"), ["A/a.md"]);
  // the App's user token could not have written there itself (GitHub's rule, kept by the mock)
  const raw = await gh.fetch("https://api.github.com/repos/global-tanakh/dan/git/refs", { method: "POST",
    headers: { Authorization: `Bearer ${gh.user("ann").token}` }, body: JSON.stringify({ ref: "refs/heads/x", sha: main }) });
  assert.equal(raw.status, 403);
});

test("a pull request from a fork made on github.com: read through its record, merged with the fork's head as parent", async () => {
  const { gh, st } = await fresh();
  const n = gh.webFork("eve", "patch-1", { "A/a.md": "eve\n" });
  assert.equal((await st("rev").readFile("patch-1", "A/a.md")).text, "eve\n");
  assert.deepEqual(await st().changedFiles("main", "patch-1"), ["A/a.md"]);
  const { commit } = await st("rev").commitMerge("main", "patch-1", { "A/a.md": "eve\n" }, { message: `Merge #${n}`, coAuthor: "rev" });
  assert.deepEqual(gh.parents(commit)[1], gh.refs("eve/dan").get("patch-1"));
  const p = await st().updatePR(n, { status: "merged", merged_by: "rev" });
  assert.equal(p.status, "merged");
  assert.equal((await st().listPRs())[0].status, "merged");
  assert.match(gh.comments[0].body, /Merged verse by verse by rev/);
});

test("a branch that moved since it was read is refused", async () => {
  const { st } = await fresh();
  const a = st(), b = st();
  await a.branchHead("main"); await b.branchHead("main");
  await a.commitMerge("main", "main", { "A/a.md": "a\n" }, { message: "a" });
  // b's head is the old one: its merge commit would not be a fast-forward
  await assert.rejects(b.commitTo({ repo: "global-tanakh/dan", token: await b.appToken(), byUser: false }, "main",
    await b.branchHead("main"), { "A/a.md": "b\n" }, [await b.branchHead("main")], "b"), StaleError);
  // an expectation on the file is checked against the fresh head
  const v = (await st().readFile("main", "A/a.md")).version;
  await st().writeFiles("main", { "A/a.md": "c\n" }, { message: "c", expect: { "A/a.md": v } });
  await assert.rejects(st().writeFiles("main", { "A/a.md": "d\n" }, { message: "d", expect: { "A/a.md": v } }), StaleError);
});

test("trees and blobs are read once; a later request asks only for the branch head", async () => {
  const { gh, st } = await fresh();
  await st().readFile("main", "A/a.md");
  const before = gh.calls.length;
  assert.equal((await st().readFile("main", "A/a.md")).text, "one\n");
  assert.deepEqual(gh.calls.slice(before), ["GET /repos/global-tanakh/dan/git/ref/heads/main"]);
  assert.deepEqual(await st().listFiles("main", "A/"), ["A/a.md"]);
});

test("conflict label, close and roles", async () => {
  const { gh, st } = await fresh();
  await st("ann").setBranch("edit/ann", gh.refs().get("main"));
  await st("ann").writeFiles("edit/ann", { "A/a.md": "ann\n" }, { message: "Edit" });
  await st("ann").createPR({ author: "ann", branch: "edit/ann", title: "Edits by ann" });
  await st().updatePR(1, { status: "conflict" });
  assert.equal((await st().listPRs())[0].status, "conflict");
  await st().updatePR(1, { status: "open" });
  assert.equal((await st().listPRs())[0].status, "open");
  await st().updatePR(1, { status: "closed", closed_by: "ann" });
  assert.equal((await st().listPRs())[0].status, "closed");
  assert.deepEqual(await st().roles(), { reviewers: [], team: [] });
  await st().setRoles({ reviewers: ["rev"], team: [] });
  assert.deepEqual(await st().roles(), { reviewers: ["rev"], team: [] });
});

test("the App's installation token is minted from its key and kept until it nears expiry", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const gh = mockGitHub({ publicKey });
  const tokens = appTokens({ appId: 123, privateKey: privateKey.export({ type: "pkcs1", format: "pem" }), org: "global-tanakh", fetch: gh.fetch });
  const t = await tokens();
  assert.match(t, /^ghs_/);
  assert.equal(await tokens(), t);
  assert.equal(gh.calls.filter((c) => c.includes("access_tokens")).length, 1);
  const wrong = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  await assert.rejects(appTokens({ appId: 123, privateKey: wrong, org: "global-tanakh", fetch: gh.fetch })(), /401/);
});
