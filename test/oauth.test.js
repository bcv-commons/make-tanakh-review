// GitHub mode: sign-in through the App's user authorisation, the sealed session cookie, token refresh, the CC0 agreement, the
// language list from the organisation and the per-user store - all against the mock GitHub. (node --test runs each file in its
// own process, so the GitHub settings set here reach no other test.)
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mockGitHub } from "./github-mock.js";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
Object.assign(process.env, {
  MTR_GITHUB_APP_ID: "123", MTR_GITHUB_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).replace(/\n/g, "\\n"),
  MTR_GITHUB_CLIENT_ID: "Iv1.test", MTR_GITHUB_CLIENT_SECRET: "s3cret", MTR_GITHUB_ORG: "global-tanakh", MTR_SESSION_SECRET: "test-secret",
});
const gh = mockGitHub({ publicKey });
const config = await import("../src/lib/config.js");
config.useFetch(gh.fetch);
const { authorize, callback } = await import("../src/lib/oauth.js");
const session = await import("../src/lib/session.js");
const { GitHubStore } = await import("../src/lib/store/github.js");

// Astro's cookies, as far as the code uses them
function jar() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? { value: m.get(k).value } : undefined), set: (k, value, opts) => m.set(k, { value, opts }),
    delete: (k) => m.delete(k), raw: m };
}
const REDIRECT = "https://review.example/auth/callback";

async function signInAs(login, { agree = false, cookies = jar() } = {}) {
  const { url, stash } = authorize(config.githubSettings(), { redirectUri: REDIRECT, agree, next: "/edit/dan/JOS/1" });
  const state = new URL(url).searchParams.get("state");
  const r = await callback(config.githubSettings(), { code: gh.code(login), state, stash, redirectUri: REDIRECT }, { fetch: gh.fetch });
  session.signIn(cookies, r.session, { agreedNow: r.agree });
  return { cookies, r };
}

test("settings: all five or none; the key with escaped newlines is read as PEM", () => {
  const s = config.githubSettings();
  assert.match(s.privateKey, /^-----BEGIN RSA PRIVATE KEY-----\n/);
  assert.equal(config.githubSettings({}), null);
  assert.throws(() => config.githubSettings({ MTR_GITHUB_ORG: "x" }), /MTR_GITHUB_APP_ID/);
});

test("the sign-in URL and the state that must come back", async () => {
  const { url, stash } = authorize(config.githubSettings(), { redirectUri: REDIRECT, next: "//evil.example" });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(u.searchParams.get("client_id"), "Iv1.test");
  assert.equal(u.searchParams.get("redirect_uri"), REDIRECT);
  assert.equal(stash.next, "/");                                      // only a path on this site
  await assert.rejects(callback(config.githubSettings(), { code: gh.code("ann"), state: "forged", stash, redirectUri: REDIRECT }, { fetch: gh.fetch }), /try again/);
  await assert.rejects(callback(config.githubSettings(), { code: "nope", state: stash.state, stash, redirectUri: REDIRECT }, { fetch: gh.fetch }), /bad_verification_code/);
});

test("the session cookie is sealed and carries the user's token", async () => {
  const { cookies, r } = await signInAs("ann", { agree: true });
  assert.equal(r.next, "/edit/dan/JOS/1");
  const raw = cookies.raw.get("mtr_session");
  assert.ok(!raw.value.includes("ghu_") && raw.opts.httpOnly && raw.opts.secure);
  const u = await session.currentUser(cookies, { fetch: gh.fetch });
  assert.equal(u.login, "ann");
  assert.match(u.token, /^ghu_ann_/);
  assert.ok(u.agreed);
  // changed by the browser: not a session
  cookies.set("mtr_session", raw.value.slice(0, -2) + (raw.value.endsWith("A") ? "BB" : "AA"));
  assert.equal(await session.currentUser(cookies, { fetch: gh.fetch }), null);
});

test("the CC0 agreement is remembered on the browser, for that login", async () => {
  const cookies = jar();
  await signInAs("bo", { cookies });
  assert.equal((await session.currentUser(cookies)).agreed, null);    // not ticked: may read, not save
  await signInAs("bo", { cookies, agree: true });
  const first = (await session.currentUser(cookies)).agreed;
  assert.ok(first);
  session.signOut(cookies);
  await signInAs("bo", { cookies });                                  // later, without the tick
  assert.equal((await session.currentUser(cookies)).agreed, first);
  await signInAs("cy", { cookies });                                  // someone else on the same browser
  assert.equal((await session.currentUser(cookies)).agreed, null);
});

test("an expired token is refreshed; one that cannot be is a sign-out", async () => {
  const { cookies } = await signInAs("ann");
  const s = session.unseal(cookies.raw.get("mtr_session").value);
  cookies.set("mtr_session", session.seal({ ...s, expires: Date.now() - 1 }));
  const u = await session.currentUser(cookies, { fetch: gh.fetch });
  assert.notEqual(u.token, s.token);
  assert.ok(session.unseal(cookies.raw.get("mtr_session").value).expires > Date.now());
  cookies.set("mtr_session", session.seal({ ...s, expires: Date.now() - 1 }));   // the old refresh token is spent
  assert.equal(await session.currentUser(cookies, { fetch: gh.fetch }), null);
  assert.ok(!cookies.raw.has("mtr_session"));
});

test("languages are the organisation's repos with the topic; a store per user with their token", async () => {
  assert.deepEqual(await config.languages(), ["dan"]);
  assert.equal(await config.storeFor("eng"), null);
  const reader = await config.storeFor("dan");
  assert.ok(reader instanceof GitHubStore);
  assert.equal(reader.user, null);
  const { cookies } = await signInAs("ann");
  const user = await session.currentUser(cookies, { fetch: gh.fetch });
  const mine = await config.storeFor("dan", user);
  assert.deepEqual(mine.user, { login: "ann", token: user.token });
  // the App's token (from the key above) writes main, and ann's branch (she has no push access)
  await reader.writeFiles("main", { "README.md": "readme\n" }, { message: "seed" });
  await mine.setBranch("edit/ann", await reader.branchHead("main"));
  assert.ok(gh.refs().has("edit/ann"));
});
