import { act } from "../../lib/http.js";
import { publishRevision, Refused } from "../../lib/service.js";

// The team tags the working text (main) for the drafting side to take in: register-<n>
export const POST = (ctx) => act(ctx, async ({ user, store }) => {
  if (!store) throw new Refused("No language given.");
  const r = await publishRevision(store, user.login);
  return { message: r.unchanged ? `The working text is already published as ${r.tag}.` : `Published as ${r.tag}.` };
});
