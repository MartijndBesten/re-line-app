import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { authMode, entraStart } from "@/lib/auth";
import { checkHost, errorResponse, HttpError } from "@/lib/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Doorsturen naar Microsoft Entra ID (OpenID Connect, PKCE). */
export async function GET(req: NextRequest) {
  try {
    checkHost(req);
    if (authMode() !== "entra") throw new HttpError(404, "Entra ID is niet ingeschakeld");
    return NextResponse.redirect(await entraStart(await store()), 302);
  } catch (e) {
    return errorResponse(e);
  }
}
