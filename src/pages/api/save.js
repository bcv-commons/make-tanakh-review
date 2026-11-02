import { act } from "../../lib/http.js";
import { save, Refused, CHAPTER_MD } from "../../lib/service.js";

// JSON: { lang, file (the chapter's .md), units: [{ref, bases, text}], version ({path: version} as loaded), message? }
export const POST = (ctx) => act(ctx, ({ user, store, data }) => {
  if (!store) throw new Refused("No language given.");
  if (!user.agreed) throw new Refused("Agree to CC0 first (sign in again).", 403);
  const list = Array.isArray(data.units) ? data.units : null;
  if (!list || !list.every((u) => typeof u.ref === "string" && Array.isArray(u.bases) && u.bases.every((b) => typeof b === "string")
    && typeof u.text === "string" && u.text.trim()))
    throw new Refused("Every clause needs some text (join an empty one with its neighbour).");
  if (!CHAPTER_MD.test(String(data.file))) throw new Refused("No such chapter.");
  const version = data.version && typeof data.version === "object" ? data.version : null;
  const r = save(store, user.login, data.file, list, version, data.message);
  return { version: r.version, pr: r.pr && { number: r.pr.number, status: r.pr.status }, unchanged: !!r.unchanged };
});
