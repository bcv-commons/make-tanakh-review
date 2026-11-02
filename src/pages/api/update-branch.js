import { act } from "../../lib/http.js";
import { updateBranch, Refused } from "../../lib/service.js";

// JSON: { lang, choices? } - without choices the conflicting verses come back; with them the merge is committed.
export const POST = (ctx) => act(ctx, ({ user, store, data }) => {
  if (!store) throw new Refused("No language given.");
  return updateBranch(store, user.login, data.choices || null);
});
