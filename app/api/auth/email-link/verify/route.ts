import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { authMode, clientAddress, createSession, rateLimit, sessionCookie, verifyEmailLink } from "@/lib/auth";
import { checkHost, checkOrigin, errorResponse, HttpError } from "@/lib/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Inloglink gebruiken: het token komt uit het #-fragment en wordt in de body gepost (niet in URL of log). */
export async function POST(req: NextRequest) {
  try {
    checkHost(req);
    checkOrigin(req);
    if (authMode() !== "email") throw new HttpError(404, "Aanmelden met een inloglink is niet ingeschakeld");
    const db = await store();
    if (!(await rateLimit(db, "emaillink.verify", clientAddress(req.headers.get("x-forwarded-for")))))
      throw new HttpError(429, "Te veel pogingen; probeer het over 15 minuten opnieuw");
    const body = await req.json().catch(() => ({}));
    const userId = await verifyEmailLink(db, String(body.token ?? ""));
    const res = NextResponse.json({ ok: true });
    res.headers.set("Set-Cookie", sessionCookie(await createSession(db, userId)));
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
