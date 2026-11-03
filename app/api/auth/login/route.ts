import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { authMode, clientAddress, createSession, login, normEmail, rateLimit, sessionCookie } from "@/lib/auth";
import { checkHost, checkOrigin, errorResponse, HttpError } from "@/lib/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Inloggen met e-mail en wachtwoord (RELINE_AUTH=lokaal). Grens per e-mailadres en per client. */
export async function POST(req: NextRequest) {
  try {
    checkHost(req);
    checkOrigin(req);
    if (authMode() !== "lokaal") throw new HttpError(404, "Inloggen met wachtwoord is niet ingeschakeld");
    const db = await store();
    const body = await req.json().catch(() => ({}));
    const client = clientAddress(req.headers.get("x-forwarded-for"));
    const okEmail = await rateLimit(db, "login.email", normEmail(body.email));
    const okClient = await rateLimit(db, "login.client", client);
    if (!okEmail || !okClient) throw new HttpError(429, "Te veel inlogpogingen; probeer het over 15 minuten opnieuw");
    const userId = await login(db, body.email, body.password);
    if (!userId) throw new HttpError(401, "E-mailadres of wachtwoord onjuist");
    const token = await createSession(db, userId);
    const res = NextResponse.json({ ok: true });
    res.headers.set("Set-Cookie", sessionCookie(token));
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
