import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { authMode, entraCallback, sessionCookie } from "@/lib/auth";
import { checkHost } from "@/lib/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Terugkeer van Entra ID: token controleren, account bijwerken, sessie maken. Fouten → inlogscherm met melding. */
export async function GET(req: NextRequest) {
  const home = (process.env.RELINE_PUBLIC_URL ?? "").replace(/\/$/, "") || "/";
  try {
    checkHost(req);
    if (authMode() !== "entra") throw Error("Entra ID is niet ingeschakeld");
    const token = await entraCallback(await store(), req.nextUrl);
    const res = NextResponse.redirect(home + "/", 302);
    res.headers.set("Set-Cookie", sessionCookie(token));
    return res;
  } catch (e) {
    const code = (e as Error).message === "GEEN_ROL" ? "geen-rol" : (e as Error).message === "GEDEACTIVEERD" ? "gedeactiveerd" : "mislukt";
    return NextResponse.redirect(`${home}/#aanmelden=${code}`, 302);
  }
}
