import { act } from "../../lib/http.js";
import { signIn, agree, users, LOGIN_RE } from "../../lib/session.js";
import { Refused } from "../../lib/service.js";

// Mock sign-in: a GitHub login name; the CC0 agreement is asked once.
export const POST = (ctx) => act(ctx, ({ data, cookies }) => {
  const login = String(data.login || "").trim();
  if (!LOGIN_RE.test(login)) throw new Refused("Use a GitHub-style login: letters, digits and dashes.");
  if (!users()[login]?.agreed) {
    if (!data.agree) throw new Refused("To edit, agree that your edits are given under CC0.");
    agree(login);
  }
  signIn(cookies, login);
  return { message: `Signed in as ${login}.` };
}, { open: true });
