import { act } from "../../lib/http.js";
import { mergePR, roles, Refused } from "../../lib/service.js";

export const POST = (ctx) => act(ctx, ({ user, store, data }) => {
  if (!store) throw new Refused("No language given.");
  if (!roles(store, user.login).reviewer) throw new Refused("Only reviewers merge (ask for reviewer access first).", 403);
  const pr = mergePR(store, user.login, Number(data.number));
  return { message: `Proposal #${pr.number} merged into the working text.` };
});
