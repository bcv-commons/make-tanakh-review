// LocalGitStore (PLAN.md section 8): a language repo as a bare git repository, written with git plumbing only (no working tree), so
// it behaves like GitHub's API: a write names the version it expects, refs move by compare-and-swap, every write is one commit.
// Pull requests are records in a JSON file next to the repo. The GitHub version of this class keeps the same methods.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { StaleError } from "./errors.js";
export { StaleError };

const BOT = { name: "make-tanakh-review[bot]", email: "make-tanakh-review@users.noreply.local" };

export class LocalGitStore {
  constructor(repoDir, stateFile) {
    this.repo = repoDir;
    this.stateFile = stateFile;
  }

  git(args, { input, env } = {}) {
    return execFileSync("git", ["--git-dir", this.repo, ...args], {
      input, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
    }).replace(/\n$/, "");
  }

  tryGit(args) {
    try { return this.git(args); } catch { return null; }
  }

  branchHead(branch) {
    return this.tryGit(["rev-parse", "--verify", "-q", `refs/heads/${branch}^{commit}`]);
  }

  readFile(branch, file, at = null) {
    const id = this.tryGit(["rev-parse", "--verify", "-q", `${at || `refs/heads/${branch}`}:${file}`]);
    if (!id) return null;
    return { text: this.git(["cat-file", "blob", id]) + "\n", version: id };
  }

  listFiles(branch, prefix = "") {
    const out = this.tryGit(["ls-tree", "-r", "--name-only", `refs/heads/${branch}`]);
    return out ? out.split("\n").filter((f) => f.startsWith(prefix)) : [];
  }

  changedFiles(from, to) {
    const out = this.git(["diff", "--name-only", from, to]);
    return out ? out.split("\n") : [];
  }

  mergeBase(a, b) {
    return this.tryGit(["merge-base", a, b]);
  }

  // a tree = the tree of `commit` with `files` ({path: text}) written into it
  treeWith(commit, files) {
    const index = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mtr-")), "index");
    const env = { GIT_INDEX_FILE: index };
    try {
      if (commit) this.git(["read-tree", commit], { env });
      for (const [file, text] of Object.entries(files)) {
        const blob = this.git(["hash-object", "-w", "--stdin"], { input: text });
        this.git(["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`], { env });
      }
      return this.git(["write-tree"], { env });
    } finally {
      fs.rmSync(path.dirname(index), { recursive: true, force: true });
    }
  }

  commit(tree, parents, message, coAuthor) {
    const msg = coAuthor ? `${message}\n\nCo-authored-by: ${coAuthor} <${coAuthor}@users.noreply.github.com>\n` : `${message}\n`;
    const env = { GIT_AUTHOR_NAME: BOT.name, GIT_AUTHOR_EMAIL: BOT.email, GIT_COMMITTER_NAME: BOT.name, GIT_COMMITTER_EMAIL: BOT.email };
    return this.git(["commit-tree", tree, ...parents.flatMap((p) => ["-p", p])], { input: msg, env });
  }

  moveRef(branch, to, from) {
    // compare-and-swap: refuses if the branch moved since `from` was read (from = "" creates it)
    try {
      this.git(["update-ref", `refs/heads/${branch}`, to, from || "0000000000000000000000000000000000000000"]);
    } catch {
      throw new StaleError(`${branch} changed meanwhile`);
    }
  }

  // Write files to a branch as one commit. expect: {path: version | null} - the versions the writer read; a mismatch is refused.
  writeFiles(branch, files, { message, coAuthor, expect = {} }) {
    const head = this.branchHead(branch);
    for (const [file, version] of Object.entries(expect)) {
      const cur = this.readFile(branch, file);
      if ((cur ? cur.version : null) !== version) throw new StaleError(`${file} on ${branch} changed since it was loaded`);
    }
    const tree = this.treeWith(head, files);
    const commit = this.commit(tree, head ? [head] : [], message, coAuthor);
    this.moveRef(branch, commit, head);
    return { commit, versions: Object.fromEntries(Object.keys(files).map((f) => [f, this.readFile(branch, f).version])) };
  }

  // A merge commit on `into` with the merged content `files` and both heads as parents.
  commitMerge(into, from, files, { message, coAuthor }) {
    const head = this.branchHead(into), other = this.branchHead(from);
    const tree = this.treeWith(head, files);
    const commit = this.commit(tree, [head, other], message, coAuthor);
    this.moveRef(into, commit, head);
    return { commit };
  }

  setBranch(branch, to) {
    this.git(["update-ref", `refs/heads/${branch}`, to]);
  }

  // ---- pull requests and other state (on GitHub: the Pulls API, collaborators, CODEOWNERS)

  state() {
    try { return JSON.parse(fs.readFileSync(this.stateFile, "utf8")); } catch { return { prs: [], roles: { reviewers: [], team: [] } }; }
  }

  saveState(s) {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const tmp = this.stateFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
    fs.renameSync(tmp, this.stateFile);
  }

  listPRs() { return this.state().prs; }

  createPR(fields) {
    const s = this.state();
    const pr = { number: (s.prs.reduce((m, p) => Math.max(m, p.number), 0) || 0) + 1, status: "open", created: new Date().toISOString(),
      ...fields };
    s.prs.push(pr);
    this.saveState(s);
    return pr;
  }

  updatePR(number, fields) {
    const s = this.state();
    const pr = s.prs.find((p) => p.number === number);
    Object.assign(pr, fields, { updated: new Date().toISOString() });
    this.saveState(s);
    return pr;
  }

  roles() { return this.state().roles; }

  setRoles(roles) {
    const s = this.state();
    s.roles = roles;
    this.saveState(s);
  }
}
