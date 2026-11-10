import { act } from "../../lib/http.js";
import { save, Refused, CHAPTER_MD } from "../../lib/service.js";

// JSON: { lang, file (the chapter's .md), units: [{ref, bases, text}], version ({path: version} as loaded), message?,
//   status? ({ maturity: "...", ... }), uses? ([{ ref, bases, kind }]: the "use" buttons pressed since the last save) }
export const POST = (ctx) => act(ctx, async ({ user, store, data }) => {
  if (!store) throw new Refused("No language given.");
  if (!user.agreed) throw new Refused("Agree to CC0 first (sign in again).", 403);
  const list = Array.isArray(data.units) ? data.units : null;
  if (!list || !list.every((u) => typeof u.ref === "string" && Array.isArray(u.bases) && u.bases.every((b) => typeof b === "string")
    && typeof u.text === "string" && u.text.trim()))
    throw new Refused("Every clause needs some text (join an empty one with its neighbour).");
  if (!CHAPTER_MD.test(String(data.file))) throw new Refused("No such chapter.");
  const version = data.version && typeof data.version === "object" ? data.version : null;
  const status = data.status && typeof data.status === "object" ? Object.fromEntries(Object.entries(data.status)
    .filter(([k, v]) => typeof v === "string" && v.length < 300 && /^[a-z]+$/.test(k))) : null;
  const uses = Array.isArray(data.uses) ? data.uses.filter((u) => u && typeof u.ref === "string" && Array.isArray(u.bases)
    && typeof u.kind === "string" && /^[a-z0-9-]+$/.test(u.kind)).slice(0, 500) : [];
  const r = await save(store, user.login, data.file, list, version, typeof data.message === "string" ? data.message.slice(0, 500) : null, { status, uses });
  return { version: r.version, pr: r.pr && { number: r.pr.number, status: r.pr.status }, unchanged: !!r.unchanged };
});
