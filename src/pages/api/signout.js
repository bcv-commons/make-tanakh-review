import { act } from "../../lib/http.js";
import { signOut } from "../../lib/session.js";

export const POST = (ctx) => act(ctx, ({ cookies }) => { signOut(cookies); return { message: "Signed out." }; }, { open: true });
