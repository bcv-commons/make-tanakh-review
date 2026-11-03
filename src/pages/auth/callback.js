// GitHub sends the browser back here after sign-in (the GitHub App's callback URL: https://<site>/auth/callback).
import { callback, OAUTH_COOKIE } from "../../lib/oauth.js";
import { signIn, unseal } from "../../lib/session.js";
import { githubSettings, githubFetch } from "../../lib/config.js";

export async function GET({ url, cookies, redirect }) {
  const gh = githubSettings();
  if (!gh) return new Response("GitHub sign-in is not set up here.", { status: 404 });
  const stash = unseal(cookies.get(OAUTH_COOKIE)?.value || "");
  cookies.delete(OAUTH_COOKIE, { path: "/" });
  const p = url.searchParams;
  try {
    const r = await callback(gh, { code: p.get("code"), state: p.get("state"), stash, redirectUri: new URL("/auth/callback", url).toString() },
      { fetch: githubFetch() });
    signIn(cookies, r.session, { agreedNow: r.agree });
    return redirect(`${r.next}?msg=${encodeURIComponent(`Signed in as ${r.session.login}.`)}`, 303);
  } catch (e) {
    const to = stash && stash.next ? stash.next : "/";
    return redirect(`${to}?msg=${encodeURIComponent(p.get("error_description") || e.message)}`, 303);
  }
}
