import { act } from "../../lib/http.js";
import { approve, Refused } from "../../lib/service.js";

export const POST = (ctx) => act(ctx, async ({ user, store, data }) => {
  if (!store) throw new Refused("No language given.");
  const r = await approve(store, user.login, String(data.file));
  return { message: r.unchanged ? "Already approved as it stands." : `${data.file} approved.` };
});
