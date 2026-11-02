import { act } from "../../lib/http.js";
import { requestReviewer, Refused } from "../../lib/service.js";

export const POST = (ctx) => act(ctx, ({ user, store }) => {
  if (!store) throw new Refused("No language given.");
  requestReviewer(store, user.login);
  return { message: "You are a reviewer now: you can merge proposals into the working text." };
});
