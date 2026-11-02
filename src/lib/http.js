// Small helpers for the API routes: read a form or JSON body; answer JSON to fetch calls and redirect form posts back.
import { currentUser } from "./session.js";
import { storeFor } from "./config.js";
import { Refused } from "./service.js";

export async function body(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return { json: true, data: await request.json() };
  return { json: false, data: Object.fromEntries(await request.formData()) };
}

export function back(request, fallback = "/") {
  const ref = request.headers.get("referer");
  try {
    const u = new URL(ref);
    return u.origin === new URL(request.url).origin ? u.pathname : fallback;
  } catch { return fallback; }
}

// Run an action: the signed-in user (unless open), the language's store; errors become 4xx answers or a message in the URL.
export async function act(ctx, fn, { open = false } = {}) {
  const { request, cookies } = ctx;
  let b;
  try { b = await body(request); } catch { return Response.json({ error: "Bad request." }, { status: 400 }); }
  const reply = (status, payload, msg) => {
    if (b.json) return Response.json(payload, { status });
    const to = b.data.next && String(b.data.next).startsWith("/") ? String(b.data.next) : back(request);
    return ctx.redirect(msg ? `${to}?msg=${encodeURIComponent(msg)}` : to, 303);
  };
  const user = currentUser(cookies);
  if (!open && !user) return reply(401, { error: "Sign in first." }, "Sign in first.");
  const store = b.data.lang ? storeFor(String(b.data.lang)) : null;
  if (b.data.lang && !store) return reply(404, { error: "No such language." }, "No such language.");
  try {
    const r = (await fn({ user, store, data: b.data, cookies })) || {};
    return reply(200, r, r.message);
  } catch (e) {
    if (e instanceof Refused) return reply(e.status, { error: e.message }, e.message);
    console.error(e);
    return reply(500, { error: "Something went wrong on the server." }, "Something went wrong on the server.");
  }
}
