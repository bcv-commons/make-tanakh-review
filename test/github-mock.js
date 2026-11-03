// A small GitHub in memory for GitHubStore's tests: the REST calls the store makes, answered as GitHub answers them (as far as
// the store can tell). Objects are shared by a repository and its forks (one network, as on GitHub); refs, permissions and pull
// requests are per repository. Writes need push access (the App, a collaborator, a fork's owner); reads are public.
// What it does not model: rate limits, the delay before GitHub marks a pull request merged, and fork creation in the background.
import crypto from "node:crypto";
import { blobSha } from "../src/lib/store/github.js";

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

export function mockGitHub({ org = "global-tanakh", repo = "dan", publicKey = null } = {}) {
  const objects = new Map();             // sha -> { type: "blob", text } | { type: "tree", files } | { type: "commit", tree, parents, message, author }
  const repos = new Map();               // "o/r" -> { refs: Map, fork, parent, push: Set }
  const tokens = new Map();              // token -> actor ("app" or a login)
  const pulls = [];                      // pull requests of the base repo
  const comments = [];
  const calls = [];
  let n = 0, clock = Date.parse("2026-11-02T10:00:00Z");
  const base = `${org}/${repo}`;
  repos.set(base, { refs: new Map(), fork: false, parent: null, push: new Set() });

  const now = () => new Date(clock += 1000).toISOString();
  const tree = (files) => { const sha = sha1(`tree ${JSON.stringify(Object.entries(files).sort())}`); objects.set(sha, { type: "tree", files }); return sha; };
  const commit = (c) => { const sha = sha1(`commit ${JSON.stringify(c)} ${n++}`); objects.set(sha, { type: "commit", ...c }); return sha; };
  const ancestors = (sha) => {
    const seen = [], todo = [sha];
    while (todo.length) {
      const s = todo.shift();
      if (!s || seen.includes(s)) continue;
      seen.push(s);
      todo.push(...(objects.get(s)?.parents || []));
    }
    return seen;
  };
  const canPush = (actor, name) => {
    const r = repos.get(name);
    return actor === "app" ? name === base : !!r && (r.push.has(actor) || name.split("/")[0] === actor);
  };
  // a side of a compare / a PR head: "owner:branch", a branch, or a sha
  const resolve = (x, inRepo = base) => {
    if (/^[0-9a-f]{40}$/.test(x)) return objects.has(x) ? x : null;
    const [owner, branch] = x.includes(":") ? x.split(":") : [null, x];
    const name = owner ? [...repos.keys()].find((k) => k.startsWith(`${owner}/`)) : inRepo;
    return repos.get(name)?.refs.get(branch) || null;
  };
  const markMerged = () => {
    const main = repos.get(base).refs.get("main"), reach = new Set(ancestors(main));
    for (const p of pulls) if (p.state === "open" && reach.has(headSha(p))) Object.assign(p, { state: "closed", merged_at: now() });
  };
  const headSha = (p) => repos.get(p.headRepo)?.refs.get(p.headRef) ?? p.lastHead;
  const pull = (p) => ({ number: p.number, state: p.state, title: p.title, body: p.body, user: { login: p.author },
    head: { ref: p.headRef, sha: headSha(p), repo: { full_name: p.headRepo } }, base: { ref: p.base }, labels: p.labels.map((name) => ({ name })),
    merged_at: p.merged_at || null, created_at: p.created_at, updated_at: p.updated_at });

  function verifyJwt(t) {
    if (!publicKey) return false;
    const [h, b, s] = t.split(".");
    if (!s || !crypto.createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, s, "base64url")) return false;
    return JSON.parse(Buffer.from(b, "base64url").toString()).exp > Date.now() / 1000;
  }

  async function handle(method, path, query, body, auth) {
    const actor = tokens.get(auth);
    let m;
    // ---- the App
    if (method === "GET" && (m = /^\/orgs\/([^/]+)\/installation$/.exec(path)))
      return verifyJwt(auth) && m[1] === org ? [200, { id: 7 }] : [401, { message: "Bad credentials" }];
    if (method === "POST" && path === "/app/installations/7/access_tokens") {
      if (!verifyJwt(auth)) return [401, { message: "Bad credentials" }];
      const t = `ghs_${n++}`; tokens.set(t, "app");
      return [201, { token: t, expires_at: new Date(Date.now() + 3600e3).toISOString() }];
    }
    if (!actor) return [401, { message: "Bad credentials" }];
    if (!(m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(path))) return [404, { message: "Not Found" }];
    const name = m[1], rest = m[2] || "", r = repos.get(name);
    if (!r) return [404, { message: "Not Found" }];
    const write = method !== "GET";
    // ---- the repo, forks
    if (rest === "" && method === "GET")
      return [200, { full_name: name, fork: r.fork, parent: r.parent && { full_name: r.parent }, permissions: { push: canPush(actor, name) } }];
    if (rest === "/forks" && method === "POST") {
      if (actor === "app") return [403, { message: "forks are made by users" }];
      const f = `${actor}/${name.split("/")[1]}`;
      if (!repos.has(f)) repos.set(f, { refs: new Map([["main", r.refs.get("main")]]), fork: true, parent: name, push: new Set() });
      return [202, { full_name: f }];
    }
    // ---- refs
    if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(rest)) && method === "GET") {
      const sha = r.refs.get(decodeURIComponent(m[1]));
      return sha ? [200, { ref: `refs/heads/${m[1]}`, object: { sha, type: "commit" } }] : [404, { message: "Not Found" }];
    }
    if (write && rest.startsWith("/git/") && !canPush(actor, name)) return [403, { message: "Resource not accessible by integration" }];
    if (rest === "/git/refs" && method === "POST") {
      const branch = body.ref.replace(/^refs\/heads\//, "");
      if (r.refs.has(branch)) return [422, { message: "Reference already exists" }];
      if (objects.get(body.sha)?.type !== "commit") return [422, { message: "Object does not exist" }];
      r.refs.set(branch, body.sha);
      if (name === base && branch === "main") markMerged();
      return [201, { ref: body.ref, object: { sha: body.sha } }];
    }
    if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(rest)) && method === "PATCH") {
      const branch = decodeURIComponent(m[1]), cur = r.refs.get(branch);
      if (!cur) return [422, { message: "Reference does not exist" }];
      if (objects.get(body.sha)?.type !== "commit") return [422, { message: "Object does not exist" }];
      if (!body.force && !ancestors(body.sha).includes(cur)) return [422, { message: "Update is not a fast forward" }];
      r.refs.set(branch, body.sha);
      if (name === base && branch === "main") markMerged();
      return [200, { object: { sha: body.sha } }];
    }
    // ---- objects (one store for the network)
    if ((m = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest)) && method === "GET") {
      const c = objects.get(m[1]);
      return c?.type === "commit" ? [200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message,
        author: { name: c.author } }] : [404, { message: "Not Found" }];
    }
    if ((m = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest)) && method === "GET") {
      const t = objects.get(m[1]);
      if (t?.type !== "tree") return [404, { message: "Not Found" }];
      const dirs = new Set(Object.keys(t.files).flatMap((f) => f.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
      const entries = [...[...dirs].map((path) => ({ path, type: "tree", mode: "040000", sha: sha1(path) })),
        ...Object.entries(t.files).map(([path, sha]) => ({ path, type: "blob", mode: "100644", sha }))];
      return [200, { sha: m[1], tree: query.get("recursive") ? entries : entries.filter((e) => !e.path.includes("/")), truncated: false }];
    }
    if ((m = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest)) && method === "GET") {
      const b = objects.get(m[1]);
      return b?.type === "blob" ? [200, { sha: m[1], content: Buffer.from(b.text).toString("base64"), encoding: "base64" }] : [404, { message: "Not Found" }];
    }
    if (rest === "/git/trees" && method === "POST") {
      const files = body.base_tree ? { ...(objects.get(body.base_tree)?.files || {}) } : {};
      if (body.base_tree && !objects.has(body.base_tree)) return [422, { message: "Invalid tree info" }];
      for (const e of body.tree) {
        if (e.content != null) { const s = blobSha(e.content); objects.set(s, { type: "blob", text: e.content }); files[e.path] = s; }
        else if (e.sha === null) delete files[e.path];
        else files[e.path] = e.sha;
      }
      return [201, { sha: tree(files) }];
    }
    if (rest === "/git/commits" && method === "POST") {
      if (objects.get(body.tree)?.type !== "tree" || body.parents.some((p) => objects.get(p)?.type !== "commit")) return [422, { message: "Invalid object" }];
      const sha = commit({ tree: body.tree, parents: body.parents, message: body.message, author: actor === "app" ? "make-tanakh-review[bot]" : actor });
      return [201, { sha }];
    }
    // ---- compare
    if ((m = /^\/compare\/(.+)\.\.\.(.+)$/.exec(rest)) && method === "GET") {
      const a = resolve(decodeURIComponent(m[1]), name), b = resolve(decodeURIComponent(m[2]), name);
      if (!a || !b) return [404, { message: "Not Found" }];
      const A = new Set(ancestors(a)), mb = ancestors(b).find((s) => A.has(s));
      return [200, { merge_base_commit: mb ? { sha: mb } : null, status: "diverged" }];
    }
    // ---- pull requests, labels, comments (base repo only)
    if (rest === "/pulls" && method === "GET") {
      let list = pulls.filter((p) => (query.get("state") === "all" || p.state === query.get("state")) && (!query.get("base") || p.base === query.get("base")));
      if (query.get("sort") === "updated") list = [...list].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
      else list = [...list].sort((a, b) => a.number - b.number);
      if ((query.get("direction") || (query.get("sort") ? "desc" : "desc")) === "desc") list.reverse();
      const per = Number(query.get("per_page") || 30), page = Number(query.get("page") || 1);
      return [200, list.slice((page - 1) * per, page * per).map(pull)];
    }
    if (rest === "/pulls" && method === "POST") {
      const [owner, ref] = body.head.includes(":") ? body.head.split(":") : [name.split("/")[0], body.head];
      const headRepo = [...repos.keys()].find((k) => k.startsWith(`${owner}/`) && (k === base || repos.get(k).parent === base));
      if (!headRepo || !repos.get(headRepo).refs.has(ref)) return [422, { message: "Validation Failed: head" }];
      if (pulls.some((p) => p.state === "open" && p.headRepo === headRepo && p.headRef === ref)) return [422, { message: "A pull request already exists" }];
      const t = now();
      const p = { number: pulls.length + 1, state: "open", title: body.title, body: body.body, author: actor, headRepo, headRef: ref,
        base: body.base, labels: [], created_at: t, updated_at: t };
      pulls.push(p);
      return [201, pull(p)];
    }
    const pr = (m = /^\/(?:pulls|issues)\/(\d+)/.exec(rest)) && pulls.find((p) => p.number === Number(m[1]));
    if (m && !pr) return [404, { message: "Not Found" }];
    if (pr && rest === `/pulls/${pr.number}` && method === "GET") return [200, pull(pr)];
    if (write && actor !== "app") return [403, { message: "the store labels, closes and comments as the App" }];
    if (pr && rest === `/pulls/${pr.number}` && method === "PATCH") {
      if (body.state === "closed" && pr.state === "open") { pr.lastHead = headSha(pr); pr.state = "closed"; }
      pr.updated_at = now();
      return [200, pull(pr)];
    }
    if (pr && rest === `/issues/${pr.number}/labels` && method === "POST") {
      for (const l of body.labels) if (!pr.labels.includes(l)) pr.labels.push(l);
      return [200, pr.labels.map((name) => ({ name }))];
    }
    if (pr && (m = /^\/issues\/\d+\/labels\/(.+)$/.exec(rest)) && method === "DELETE") {
      const i = pr.labels.indexOf(decodeURIComponent(m[1]));
      if (i < 0) return [404, { message: "Label does not exist" }];
      pr.labels.splice(i, 1);
      return [200, []];
    }
    if (pr && rest === `/issues/${pr.number}/comments` && method === "POST") {
      comments.push({ issue: pr.number, body: body.body, by: actor });
      return [201, { id: comments.length }];
    }
    return [404, { message: `mock: no ${method} ${rest}` }];
  }

  async function fetch(url, { method = "GET", headers = {}, body } = {}) {
    const u = new URL(url);
    const auth = (headers.Authorization || "").replace(/^Bearer /, "");
    calls.push(`${method} ${u.pathname}${u.search}`);
    const [status, data] = await handle(method, u.pathname, u.searchParams, body ? JSON.parse(body) : null, auth);
    return new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  }

  return {
    fetch, calls, comments, base,
    user(login, { push = false } = {}) {                    // a GitHub user with a token; push: a collaborator of the base repo
      tokens.set(`gho_${login}`, login);
      if (push) repos.get(base).push.add(login);
      return { login, token: `gho_${login}` };
    },
    appToken() { const t = "ghs_static"; tokens.set(t, "app"); return async () => t; },
    refs: (name = base) => repos.get(name)?.refs,
    pulls, objects, repos,
    author: (sha) => objects.get(sha)?.author,
    message: (sha) => objects.get(sha)?.message,
    parents: (sha) => objects.get(sha)?.parents,
  };
}
