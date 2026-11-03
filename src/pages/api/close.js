import { act } from "../../lib/http.js";
import { closePR, Refused } from "../../lib/service.js";

export const POST = (ctx) => act(ctx, async ({ user, store, data }) => {
  if (!store) throw new Refused("No language given.");
  const pr = await closePR(store, user.login, Number(data.number));
  return { message: `Proposal #${pr.number} closed.` };
});
