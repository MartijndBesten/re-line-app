import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/db";
import { clearSessionCookie, revokeSession } from "@/lib/auth";
import { checkHost, checkOrigin, errorResponse } from "@/lib/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Uitloggen: sessie server-side intrekken en cookie wissen. */
export async function POST(req: NextRequest) {
  try {
    checkHost(req);
    checkOrigin(req);
    await revokeSession(await store(), req.headers.get("cookie"));
    const res = NextResponse.json({ ok: true });
    res.headers.set("Set-Cookie", clearSessionCookie());
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
