import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { authMode, clientAddress, ensureBootstrapAdmin, normEmail, rateLimit, requestEmailLink } from "@/lib/auth";
import { mailConfigured, sendLoginMail } from "@/lib/mail";
import { checkHost, checkOrigin, errorResponse, HttpError } from "@/lib/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const answer = "Als dit adres toegang heeft tot Re-Line, ontvang je binnen enkele minuten een inloglink. De link is 15 minuten geldig.";
/**
 * Inloglink aanvragen (RELINE_AUTH=email). Zelfde antwoord voor bekende en onbekende adressen; de mail wordt na het
 * antwoord verstuurd, zodat ook de responstijd niets verraadt. Geen adres, token of link in de serverlog.
 */
export async function POST(req: NextRequest) {
  try {
    checkHost(req);
    checkOrigin(req);
    if (authMode() !== "email") throw new HttpError(404, "Aanmelden met een inloglink is niet ingeschakeld");
    if (!mailConfigured()) throw new HttpError(503, "E-mailverzending is nog niet ingesteld; aanmelden is tijdelijk niet mogelijk.");
    const db = await store();
    await ensureBootstrapAdmin(db);
    const body = await req.json().catch(() => ({}));
    const email = normEmail(body.email);
    const okEmail = await rateLimit(db, "emaillink.email", email);
    const okClient = await rateLimit(db, "emaillink.client", clientAddress(req.headers.get("x-forwarded-for")));
    if (!okEmail || !okClient) throw new HttpError(429, "Te veel aanvragen; probeer het over 15 minuten opnieuw");
    void requestEmailLink(db, email, sendLoginMail).catch((e) => console.error("Inlogmail niet verzonden:", (e as Error).name));
    return NextResponse.json({ ok: true, message: answer });
  } catch (e) {
    return errorResponse(e);
  }
}
