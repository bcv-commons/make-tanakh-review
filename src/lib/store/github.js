// GitHubStore (PLAN.md sections 8 and 15.2): a language repo on GitHub, with the methods of LocalGitStore, async. One instance per
// request, for the signed-in user (or for a reader: user = null).
//
// - Reads go through the Git Data API: a branch's head (refs), the commit's tree read whole (recursive), blobs by sha. Trees and
//   blobs are content-addressed and kept in a cache shared by all instances; a file's version is its blob sha, as locally.
// - Two tokens (15.2 point 2): the user's own token opens their pull request and, when they have push access to the language
//   repo, writes their branch `edit/<login>`; the App's installation token writes `main` and `approved` (merges, approvals,
//   roles.json), labels / closes / comments on pull requests, and writes the branch of a user without push access.
// - Every user's branch is in the language repo (decided 2026-11-04, PLAN.md log): an App's user token reaches only repos the
//   App is installed on, so not a contributor's own fork. The App writes such a branch only through this app, only as
//   `edit/<login>` of the signed-in user, with the person as co-author. A pull request made on github.com from a fork is found
//   through its record and merged like any other.
// - A write is one commit: a tree on top of the head's tree, a commit, then the ref moved without force. GitHub refuses a move
//   that is not a fast-forward, so a branch that moved since it was read is refused (StaleError), as `update-ref` with the old
//   value does locally.
// - Pull requests are GitHub's. Our merge is a merge commit on main with the PR's head as second parent, so GitHub marks the PR
//   merged by itself; `conflict` is a label; who merged or closed it is a comment.
import crypto from "node:crypto";
import { StaleError } from "./errors.js";

export class GitHubError extends Error {
  constructor(status, msg) { super(`GitHub ${status}: ${msg}`); this.name = "GitHubError"; this.status = status; }
}

const SHA = /^[0-9a-f]{40}$/;
const MAIN = "main", APPROVED = "approved";
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

// the git blob id of a text: the version a file gets, known before GitHub answers
export const blobSha = (text) => {
  const b = Buffer.from(text, "utf8");
  return crypto.createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
};

// Kept across requests: objects (commit -> its tree sha, tree -> {path: blob sha}, blob -> text; immutable, oldest dropped
// first) and who may push to which repo ("owner/repo|login" -> true / false; looked up once).
export const newCache = () => ({ objects: new Map(), push: new Map() });
const shared = newCache();
const MAX_OBJECTS = 20000;

export class GitHubStore {
  // owner/repo: the language repo; app: async () => installation token; user: { login, token } | null;
  // fetch: the HTTP client (a mock in the tests)
  constructor({ owner, repo, app, user = null, api = "https://api.github.com", fetch = globalThis.fetch, cache = shared }) {
    Object.assign(this, { owner, repo, app, user, api, fetch });
    this.objects = cache.objects;
    this.push = cache.push;
    this.base = `${owner}/${repo}`;
    this.refs = new Map();       // "repo|branch" -> sha | null, for this request
    this.prs = null;             // the pull requests, for this request
  }

  // ---- HTTP

  async call(method, path, { token, body, ok404 = false } = {}) {
    const res = await this.fetch(`${this.api}${path}`, {
      method,
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${token}`,
        "User-Agent": "make-tanakh-review", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (ok404 && res.status === 404) return null;
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new GitHubError(res.status, `${method} ${path}: ${data.message || res.statusText}`);
    return data;
  }

  async readToken() { return this.user ? this.user.token : this.app(); }
  appToken() { return this.app(); }
  get(path, opts = {}) { return this.readToken().then((token) => this.call("GET", path, { token, ...opts })); }

  // ---- where a branch is

  mine(branch) { return !!this.user && branch === `edit/${this.user.login}`; }

  // The repository that holds `branch` ("owner/repo"): the language repo, or a fork when a pull request from github.com says so.
  async where(branch) {
    if (branch === MAIN || branch === APPROVED || SHA.test(branch) || this.mine(branch)) return this.base;
    const pr = (await this.listPRs()).find((p) => p.branch === branch && p.status !== "merged" && p.status !== "closed");
    return pr && pr.repo ? pr.repo : this.base;
  }

  // whether the signed-in user can push to the language repo (then their own token writes their branch)
  async pushes() {
    const key = `${this.base}|${this.user.login}`;
    if (!this.push.has(key)) {
      const repo = await this.call("GET", `/repos/${this.base}`, { token: this.user.token });
      this.push.set(key, !!(repo.permissions && repo.permissions.push));
    }
    return this.push.get(key);
  }

  async headIn(repo, branch) {
    const key = `${repo}|${branch}`;
    if (!this.refs.has(key)) {
      const r = await this.get(`/repos/${repo}/git/ref/heads/${enc(branch)}`, { ok404: true });
      this.refs.set(key, r && r.object ? r.object.sha : null);
    }
    return this.refs.get(key);
  }

  async branchHead(branch) {
    return (await this.locate(branch)).sha;
  }

  // { repo, sha } of a branch (or of a commit, read from the language repo)
  async locate(branch) {
    if (SHA.test(branch)) return { repo: this.base, sha: branch };
    const repo = await this.where(branch);
    return { repo, sha: await this.headIn(repo, branch) };
  }

  // ---- reading

  keep(sha, value) {
    this.objects.set(sha, value);
    if (this.objects.size > MAX_OBJECTS) this.objects.delete(this.objects.keys().next().value);
    return value;
  }

  async treeOf(commit, repo = this.base) {
    if (!this.objects.has(commit)) {
      const c = await this.get(`/repos/${repo}/git/commits/${commit}`);
      this.keep(commit, { tree: c.tree.sha });
    }
    const tree = this.objects.get(commit).tree;
    if (!this.objects.has(tree)) {
      const t = await this.get(`/repos/${repo}/git/trees/${tree}?recursive=1`);
      if (t.truncated) throw new GitHubError(500, `the tree of ${commit} is too large to read in one call`);
      this.keep(tree, Object.fromEntries(t.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha])));
    }
    return this.objects.get(tree);
  }

  async blob(sha, repo = this.base) {
    if (!this.objects.has(sha)) {
      const b = await this.get(`/repos/${repo}/git/blobs/${sha}`);
      this.keep(sha, Buffer.from(b.content, b.encoding === "base64" ? "base64" : "utf8").toString("utf8"));
    }
    return this.objects.get(sha);
  }

  async readFile(branch, file, at = null) {
    const { repo, sha } = at ? { repo: this.base, sha: at } : await this.locate(branch);
    if (!sha) return null;
    const id = (await this.treeOf(sha, repo))[file];
    if (!id) return null;
    return { text: (await this.blob(id, repo)).replace(/\n$/, "") + "\n", version: id };   // as LocalGitStore: one final newline
  }

  async listFiles(branch, prefix = "") {
    const { repo, sha } = await this.locate(branch);
    return sha ? Object.keys(await this.treeOf(sha, repo)).filter((f) => f.startsWith(prefix)).sort() : [];
  }

  // the files that differ between two commits (or branches), as `git diff --name-only`: by the two trees, not compare's file list
  async changedFiles(from, to) {
    const tree = async (x) => { const { repo, sha } = await this.locate(x); return sha ? this.treeOf(sha, repo) : {}; };
    const [a, b] = [await tree(from), await tree(to)];
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => a[f] !== b[f]).sort();
  }

  async mergeBase(a, b) {
    const side = async (x) => {
      if (SHA.test(x)) return x;
      const repo = await this.where(x);
      return repo === this.base ? x : `${repo.split("/")[0]}:${x}`;
    };
    const r = await this.get(`/repos/${this.base}/compare/${enc(await side(a))}...${enc(await side(b))}`, { ok404: true });
    return r && r.merge_base_commit ? r.merge_base_commit.sha : null;
  }

  // ---- writing

  async writer(branch) {
    if (this.mine(branch) && await this.pushes()) return { repo: this.base, token: this.user.token, byUser: true };
    if (this.mine(branch)) return { repo: this.base, token: await this.appToken(), byUser: false };
    if (branch.startsWith("edit/")) throw new GitHubError(403, `only ${branch.slice(5)} writes ${branch}`);
    return { repo: this.base, token: await this.appToken(), byUser: false };
  }

  async commitTo(w, branch, head, files, parents, message, coAuthor) {
    const token = w.token;
    const baseTree = head ? (await this.get(`/repos/${w.repo}/git/commits/${head}`)).tree.sha : null;
    // no file changes (a merge that only joins the histories): the head's tree as it is; GitHub refuses an empty tree list
    const tree = !Object.keys(files).length && baseTree ? { sha: baseTree } : await this.call("POST", `/repos/${w.repo}/git/trees`, { token, body: {
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: Object.entries(files).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })),
    } });
    // the App writes as the bot with the person as co-author; a user's own commit is authored by them
    const msg = coAuthor && !w.byUser ? `${message}\n\nCo-authored-by: ${coAuthor} <${coAuthor}@users.noreply.github.com>\n` : `${message}\n`;
    const commit = await this.call("POST", `/repos/${w.repo}/git/commits`, { token, body: { message: msg, tree: tree.sha, parents } });
    await this.moveRef(w, branch, commit.sha, head);
    return commit.sha;
  }

  // a fast-forward from `from` (null: create the branch); GitHub refuses anything else
  async moveRef(w, branch, to, from) {
    try {
      if (from) await this.call("PATCH", `/repos/${w.repo}/git/refs/heads/${enc(branch)}`, { token: w.token, body: { sha: to, force: false } });
      else await this.call("POST", `/repos/${w.repo}/git/refs`, { token: w.token, body: { ref: `refs/heads/${branch}`, sha: to } });
    } catch (e) {
      if (e instanceof GitHubError && e.status === 422) throw new StaleError(`${branch} changed meanwhile`);
      throw e;
    }
    this.refs.set(`${w.repo}|${branch}`, to);
  }

  // Write files to a branch as one commit. expect: {path: version | null} - the versions the writer read; a mismatch is refused.
  async writeFiles(branch, files, { message, coAuthor, expect = {} }) {
    const w = await this.writer(branch);
    this.refs.delete(`${w.repo}|${branch}`);                   // read the head fresh: the expectation is checked against it
    const head = await this.headIn(w.repo, branch);
    const tree = head ? await this.treeOf(head, w.repo) : {};
    for (const [file, version] of Object.entries(expect))
      if ((tree[file] || null) !== version) throw new StaleError(`${file} on ${branch} changed since it was loaded`);
    const commit = await this.commitTo(w, branch, head, files, head ? [head] : [], message, coAuthor);
    return { commit, versions: Object.fromEntries(Object.entries(files).map(([f, text]) => [f, blobSha(text)])) };
  }

  // A merge commit on `into` with the merged content `files` and both heads as parents. A fork's head is reachable from the
  // language repo (refs/pull/N/head), so the App's merge commit can name it.
  async commitMerge(into, from, files, { message, coAuthor }) {
    const w = await this.writer(into);
    this.refs.delete(`${w.repo}|${into}`);
    const head = await this.headIn(w.repo, into), other = await this.branchHead(from);
    return { commit: await this.commitTo(w, into, head, files, [head, other], message, coAuthor) };
  }

  // point a branch at a commit (made if missing; moved with force otherwise): a new proposal starts from main
  async setBranch(branch, to) {
    const w = await this.writer(branch);
    const head = await this.headIn(w.repo, branch);
    if (head) await this.call("PATCH", `/repos/${w.repo}/git/refs/heads/${enc(branch)}`, { token: w.token, body: { sha: to, force: true } });
    else await this.moveRef(w, branch, to, null);
    this.refs.set(`${w.repo}|${branch}`, to);
  }

  // ---- pull requests (GitHub's; records shaped as LocalGitStore's)

  record(p) {
    const labels = (p.labels || []).map((l) => l.name);
    return { number: p.number, status: p.merged_at ? "merged" : p.state === "closed" ? "closed" : labels.includes("conflict") ? "conflict" : "open",
      author: p.user.login, branch: p.head.ref, repo: p.head.repo ? p.head.repo.full_name : null, head: p.head.sha, title: p.title,
      base: p.base.ref, created: p.created_at, updated: p.updated_at };
  }

  // the open pull requests into main, and the last ten closed ones (the review page shows those)
  async listPRs() {
    if (!this.prs) {
      const open = [];
      for (let page = 1; ; page++) {
        const list = await this.get(`/repos/${this.base}/pulls?state=open&base=${MAIN}&per_page=100&page=${page}`);
        open.push(...list);
        if (list.length < 100) break;
      }
      const closed = await this.get(`/repos/${this.base}/pulls?state=closed&base=${MAIN}&sort=updated&direction=desc&per_page=10`);
      this.prs = [...closed.reverse(), ...open.sort((a, b) => a.number - b.number)].map((p) => this.record(p));
    }
    return this.prs;
  }

  // The user's own pull request from their branch, under their token; the CC0 agreement is in its body (PLAN.md 15.2 point 4).
  async createPR({ author, branch, title, base = MAIN }) {
    if (!this.user || author !== this.user.login) throw new GitHubError(403, "a pull request is opened by its author");
    const head = branch;
    const body = `Edits by ${author} in make-tanakh-review, given under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/).`;
    const p = await this.call("POST", `/repos/${this.base}/pulls`, { token: this.user.token, body: { title, head, base, body } });
    this.prs = null;
    return this.record(p);
  }

  // status: "conflict" / "open" set or drop the label; "closed" closes it; "merged" only records who merged (GitHub marks the
  // PR merged when our merge commit reaches main). merged_by / closed_by become a comment.
  async updatePR(number, fields) {
    const token = await this.appToken(), path = `/repos/${this.base}/issues/${number}`;
    if (fields.status === "conflict") await this.call("POST", `${path}/labels`, { token, body: { labels: ["conflict"] } });
    if (fields.status === "open") await this.call("DELETE", `${path}/labels/conflict`, { token, ok404: true });
    if (fields.status === "closed") await this.call("PATCH", `/repos/${this.base}/pulls/${number}`, { token, body: { state: "closed" } });
    const by = fields.merged_by ? `Merged verse by verse by ${fields.merged_by} in make-tanakh-review.`
      : fields.closed_by ? `Closed by ${fields.closed_by} in make-tanakh-review.` : null;
    if (by) await this.call("POST", `${path}/comments`, { token, body: { body: by } });
    this.prs = null;
    const p = this.record(await this.get(`/repos/${this.base}/pulls/${number}`));
    return { ...p, ...fields, ...(fields.status ? { status: fields.status } : {}) };   // GitHub may mark the merge a moment later
  }

  // ---- roles: roles.json on main (reviewers self-serve, the team set by hand), written by the App

  async roles() {
    const f = await this.readFile(MAIN, "roles.json");
    try {
      const r = JSON.parse(f.text);
      return { reviewers: r.reviewers || [], team: r.team || [] };
    } catch { return { reviewers: [], team: [] }; }
  }

  async setRoles(roles) {
    const f = await this.readFile(MAIN, "roles.json");
    await this.writeFiles(MAIN, { "roles.json": JSON.stringify(roles) + "\n" }, { message: "Roles: reviewer access",
      expect: { "roles.json": f ? f.version : null } });
  }
}

// The App's installation token, minted from its private key when needed and kept until five minutes before it expires.
export function appTokens({ appId, privateKey, org, api = "https://api.github.com", fetch = globalThis.fetch, now = () => Date.now() }) {
  let cur = null, installation = null;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = () => {
    const t = Math.floor(now() / 1000);
    const head = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: t - 60, exp: t + 540, iss: String(appId) })}`;
    return `${head}.${crypto.createSign("RSA-SHA256").update(head).sign(privateKey, "base64url")}`;
  };
  const call = async (method, path, token) => {
    const res = await fetch(`${api}${path}`, { method, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "make-tanakh-review" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new GitHubError(res.status, `${method} ${path}: ${data.message || res.statusText}`);
    return data;
  };
  return async () => {
    if (cur && cur.until > now()) return cur.token;
    const j = jwt();
    // installed on the organisation (or, for a test, on a user account of that name)
    if (!installation) installation = (await call("GET", `/orgs/${org}/installation`, j).catch((e) =>
      e.status === 404 ? call("GET", `/users/${org}/installation`, j) : Promise.reject(e))).id;
    const t = await call("POST", `/app/installations/${installation}/access_tokens`, j);
    cur = { token: t.token, until: Date.parse(t.expires_at) - 5 * 60 * 1000 };
    return cur.token;
  };
}
