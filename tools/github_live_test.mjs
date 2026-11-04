#!/usr/bin/env node
// The live test of GitHubStore (PLAN.md 15.6 step 2): the flows of service.js against a real, private, throw-away repository,
// with a real GitHub App. Credentials stay in $MTR_DATA/github-test/ (git-ignored, mode 600).
//
//   node tools/github_live_test.mjs setup <owner>/<repo>   a page on http://127.0.0.1:4398 that creates the App from a manifest
//                                                         (one click on github.com), then installs it on the repo and signs
//                                                         you in (two more clicks); the credentials are saved
//   node tools/github_live_test.mjs run                    the flows, step by step, against the repo (it must have a first
//                                                         commit on main; the test writes a test chapter and roles.json)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { GitHubStore, appTokens, newCache } from "../src/lib/store/github.js";
import { refreshToken } from "../src/lib/oauth.js";
import * as S from "../src/lib/service.js";
import { applyBox } from "../src/lib/units.js";
import { chapterFiles, files } from "../test/fixture.js";

const DATA = process.env.MTR_DATA || path.resolve(".local");
const DIR = path.join(DATA, "github-test"), PORT = 4398, HOST = `http://127.0.0.1:${PORT}`;
const save = (name, value) => { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(DIR, name), JSON.stringify(value, null, 1), { mode: 0o600 }); };
const load = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
const page = (body) => `<!doctype html><meta charset="utf-8"><title>make-tanakh-review live test</title><body style="font:16px system-ui;max-width:40em;margin:2em auto">${body}</body>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function setup(target) {
  const [owner, repo] = (target || "").split("/");
  if (!owner || !repo) throw new Error("usage: setup <owner>/<repo>");
  const state = crypto.randomBytes(12).toString("hex");
  const manifest = {
    name: `mtr-test-${owner}-${crypto.randomBytes(3).toString("hex")}`.slice(0, 34),
    url: "https://github.com/bcv-commons/make-tanakh-review",
    hook_attributes: { url: "https://example.invalid/hook", active: false },
    redirect_url: `${HOST}/created`,
    callback_urls: [`${HOST}/auth/callback`],
    request_oauth_on_install: true,
    public: false,
    default_permissions: { contents: "write", pull_requests: "write", metadata: "read" },
  };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, HOST), send = (html) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(page(html)); };
    try {
      if (u.pathname === "/") return send(`<h1>Live test: 1. create the App</h1><p>This makes a private GitHub App <b>${esc(manifest.name)}</b>
        on your account (permissions: contents and pull requests read/write; no webhook). You can delete it afterwards in
        GitHub's settings.</p><form method="post" action="https://github.com/settings/apps/new?state=${state}">
        <input type="hidden" name="manifest" value="${esc(JSON.stringify(manifest))}"><button>Create the App on github.com</button></form>`);
      if (u.pathname === "/created") {
        if (u.searchParams.get("state") !== state) return send("Wrong state: start again from the first page.");
        const r = await fetch(`https://api.github.com/app-manifests/${u.searchParams.get("code")}/conversions`, { method: "POST",
          headers: { Accept: "application/vnd.github+json", "User-Agent": "make-tanakh-review" } });
        const app = await r.json();
        if (!r.ok) return send(`GitHub said: ${esc(app.message)}`);
        save("app.json", { id: app.id, slug: app.slug, clientId: app.client_id, clientSecret: app.client_secret, privateKey: app.pem, owner, repo });
        return send(`<h1>2. install it</h1><p>The App is made. Install it on <b>${esc(owner)}/${esc(repo)}</b> only ("Only select
          repositories"); GitHub then asks you to authorise it, and sends you back here.</p>
          <p><a href="https://github.com/apps/${esc(app.slug)}/installations/new">Install ${esc(app.slug)}</a></p>`);
      }
      if (u.pathname === "/auth/callback") {
        const app = load("app.json");
        const r = await fetch("https://github.com/login/oauth/access_token", { method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "make-tanakh-review" },
          body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, code: u.searchParams.get("code") }) });
        const t = await r.json();
        if (!t.access_token) return send(`GitHub said: ${esc(t.error_description || t.error)}`);
        const me = await (await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${t.access_token}`, "User-Agent": "make-tanakh-review" } })).json();
        save("user.json", { login: me.login, token: t.access_token, refresh: t.refresh_token || null, expires: t.expires_in ? Date.now() + t.expires_in * 1000 : null });
        send(`<h1>Done</h1><p>Signed in as <b>${esc(me.login)}</b>. Close this tab; the test can run now.</p>`);
        console.log(`setup done: App ${app.slug}, user ${me.login}`);
        setTimeout(() => process.exit(0), 500);
        return;
      }
      res.writeHead(404); res.end();
    } catch (e) { send(`Error: ${esc(e.message)}`); }
  });
  server.listen(PORT, "127.0.0.1", () => console.log(`open ${HOST}/ in your browser`));
}

async function run() {
  const app = load("app.json");
  let user = load("user.json");
  const log = (ok, what) => console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  let failed = 0;
  const check = (cond, what) => { log(!!cond, what); if (!cond) failed++; };
  if (user.expires && user.expires < Date.now() + 60e3) {
    const t = await refreshToken(app, user.refresh);
    user = { ...user, ...t };
    save("user.json", user);
    log(true, "the user token was refreshed");
  }
  const tokens = appTokens({ appId: app.id, privateKey: app.privateKey, org: app.owner });
  const cache = newCache();
  const st = (who = null, { noPush = false } = {}) => {
    const s = new GitHubStore({ owner: app.owner, repo: app.repo, app: tokens, cache, user: who ? { login: user.login, token: user.token } : null });
    if (noPush) s.pushes = async () => false;          // as a user without push access: the App writes their branch
    return s;
  };
  const me = user.login, F = "JOS/JOS_001.md";
  check(await tokens(), "the App's installation token, minted from its key");

  // a clean start: the test chapter and roles on main and approved, no open proposals, no edit branch
  const r0 = st();
  for (const p of (await r0.listPRs()).filter((p) => p.status === "open" || p.status === "conflict")) await r0.updatePR(p.number, { status: "closed" });
  await r0.writeFiles("main", { ...files("JOS/JOS_001", chapterFiles()), "roles.json": JSON.stringify({ reviewers: [], team: [me] }) + "\n" },
    { message: "Live test: seed" });
  await st().setBranch("approved", await st().branchHead("main"));
  check((await S.chapters(st())).length === 1, "seeded: one chapter on main, approved at main");

  const edit = async (i, box, opts) => {
    const d = await S.load(st(me, opts), me, F);
    return S.save(st(me, opts), me, F, applyBox(d.units, i, box).units, d.version);
  };
  // 1. a proposal by someone with push access: their own token writes their branch
  const a = await edit(0, "Efter at Moses# var død,");
  check(a.pr && a.pr.author === me, `save -> pull request #${a.pr && a.pr.number} opened by ${me}`);
  await edit(3, "Min tjener Moses er død.");
  check((await st().listPRs()).filter((p) => p.status === "open").length === 1, "second save: the same pull request");
  check((await S.proposal(st(), await S.openPR(st(), me)))[0].verses.join() === "1:1,1:2", "the proposal's changed verses");
  const stale = await S.load(st(), null, F);
  check(await S.save(st(me), me, F, stale.units, stale.version).then(() => false, (e) => e.status === 409), "a save from a stale load is refused");
  await S.requestReviewer(st(me), me);
  check((await S.roles(st(), me)).reviewer, "reviewer access (roles.json written by the App)");
  await st().updatePR(a.pr.number, { status: "conflict" });
  check((await S.openPR(st(), me)).status === "conflict", "the conflict label");
  await st().updatePR(a.pr.number, { status: "open" });
  await S.mergePR(st(me), me, a.pr.number);
  let merged = false;
  for (let i = 0; i < 10 && !merged; i++) { merged = (await st().listPRs()).find((p) => p.number === a.pr.number).status === "merged"; if (!merged) await sleep(1000); }
  check(merged, "the merge commit on main: GitHub marks the pull request merged");
  check((await S.load(st(), null, F)).units.length === 4, "main has the merged units");
  check((await S.awaitingApproval(st())).length === 1, "one chapter awaits approval");
  await S.approve(st(me), me, F);
  check((await S.awaitingApproval(st())).length === 0, "approved by the team (the App writes approved)");

  // 2. as a user without push access: the App writes the branch, the user's token opens the pull request
  const b = await edit(2, "Min tjener er nu død.", { noPush: true });
  check(b.pr && b.pr.author === me && b.pr.number !== a.pr.number, `App-written branch -> pull request #${b.pr && b.pr.number} by ${me}`);
  const u = await S.updateBranch(st(me, { noPush: true }), me);
  check(u.merged, "bring in main (nothing to choose)");
  await S.closePR(st(me), me, b.pr.number);
  check((await st().listPRs()).find((p) => p.number === b.pr.number).status === "closed", "closed, with a comment naming who closed it");
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [cmd, arg] = process.argv.slice(2);
(cmd === "setup" ? setup(arg) : cmd === "run" ? run() : Promise.reject(new Error("usage: setup <owner>/<repo> | run"))).catch((e) => { console.error(e.message); process.exit(1); });
