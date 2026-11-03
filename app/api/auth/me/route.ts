import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { assertAuthConfig, authMode, ensureBootstrapAdmin, sessionUser } from "@/lib/auth";
import { mailConfigured } from "@/lib/mail";
import { checkHost, errorResponse } from "@/lib/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Welke aanmeldmethode geldt en wie er is ingelogd (null = inlogscherm tonen). */
export async function GET(req: NextRequest) {
  try {
    checkHost(req);
    const db = await store();
    assertAuthConfig(db);
    const mode = authMode();
    await ensureBootstrapAdmin(db);
    const user = mode === "uit" ? null : await sessionUser(db, req.headers.get("cookie"));
    return NextResponse.json({
      mode,
      user: user ? { id: user.id, name: user.name, role: user.role, provider: user.provider } : null,
      firstAdminNeeded: (mode === "lokaal" || mode === "email") && !(await db.one("SELECT id FROM users LIMIT 1")),
      mailReady: mode === "email" ? mailConfigured() : undefined,
      demo: process.env.RELINE_DEMO === "1",
    });
  } catch (e) {
    return errorResponse(e);
  }
}
