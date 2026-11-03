import { act, back } from "../../lib/http.js";
import { signIn, agree, users, seal, LOGIN_RE } from "../../lib/session.js";
import { authorize, OAUTH_COOKIE } from "../../lib/oauth.js";
import { githubSettings } from "../../lib/config.js";
import { Refused } from "../../lib/service.js";

// With GitHub: off to GitHub's sign-in (the CC0 tick and the page to come back to travel in a sealed cookie). Locally (mock
// sign-in): a GitHub-style login name; the CC0 agreement is asked once.
export const POST = (ctx) => act(ctx, ({ data, cookies, request }) => {
  const gh = githubSettings();
  if (gh) {
    const { url, stash } = authorize(gh, { redirectUri: new URL("/auth/callback", request.url).toString(), agree: !!data.agree,
      next: String(data.next || back(request)) });
    cookies.set(OAUTH_COOKIE, seal(stash), { httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 600 });
    return { redirect: url };
  }
  const login = String(data.login || "").trim();
  if (!LOGIN_RE.test(login)) throw new Refused("Use a GitHub-style login: letters, digits and dashes.");
  if (!users()[login]?.agreed) {
    if (!data.agree) throw new Refused("To edit, agree that your edits are given under CC0.");
    agree(login);
  }
  signIn(cookies, { login });
  return { message: `Signed in as ${login}.` };
}, { open: true });
