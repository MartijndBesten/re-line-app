import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { activate, authMode, clientAddress, createSession, rateLimit, sessionCookie } from "@/lib/auth";
import { checkHost, checkOrigin, errorResponse, HttpError } from "@/lib/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Account activeren met de eenmalige link van de beheerder: eigen wachtwoord kiezen, daarna ingelogd. */
export async function POST(req: NextRequest) {
  try {
    checkHost(req);
    checkOrigin(req);
    if (authMode() !== "lokaal") throw new HttpError(404, "Activeren is niet ingeschakeld");
    const db = await store();
    const client = clientAddress(req.headers.get("x-forwarded-for"));
    if (!(await rateLimit(db, "activate", client))) throw new HttpError(429, "Te veel pogingen; probeer het over 15 minuten opnieuw");
    const body = await req.json().catch(() => ({}));
    const userId = await activate(db, String(body.token ?? ""), String(body.password ?? ""));
    const res = NextResponse.json({ ok: true });
    res.headers.set("Set-Cookie", sessionCookie(await createSession(db, userId)));
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
