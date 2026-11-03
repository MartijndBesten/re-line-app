import { NextRequest, NextResponse } from "next/server";
import { asActor, ConflictError, localActor, store, type Store } from "./db";
import { actorOf, assertAuthConfig, authMode, sessionUser, type Role, type SessionUser } from "./auth";
/**
 * Toegangspoort voor alle API-routes: host en herkomst, inloggen, rol en gebruikerscontext.
 * Deny by default: zonder geldige sessie (bij RELINE_AUTH=lokaal/entra) geen gegevens.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const localHosts = ["127.0.0.1", "localhost"];
/** Toegestane hostnamen: lokaal, plus de host van RELINE_PUBLIC_URL in een gedeelde omgeving. */
export function allowedHosts() {
  const hosts = [...localHosts];
  const pub = process.env.RELINE_PUBLIC_URL;
  if (pub && authMode() !== "uit") hosts.push(new URL(pub).hostname);
  return hosts;
}
function hostOf(req: NextRequest) {
  try {
    return new URL("http://" + (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))).hostname;
  } catch {
    return "";
  }
}
export function checkHost(req: NextRequest) {
  if (!allowedHosts().includes(hostOf(req))) throw new HttpError(403, "Alleen bereikbaar via het ingestelde adres");
}
/** Schrijfverzoeken alleen vanuit de eigen pagina (Origin = eigen host); samen met SameSite-cookies tegen CSRF. */
export function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) throw new HttpError(403, "Alleen verzoeken vanuit de applicatie zijn toegestaan");
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    throw new HttpError(403, "Alleen verzoeken vanuit de applicatie zijn toegestaan");
  }
  if (o.hostname !== hostOf(req) || !allowedHosts().includes(o.hostname))
    throw new HttpError(403, "Alleen lokale verzoeken vanuit de applicatie zijn toegestaan");
}
export type Ctx = { db: Store; user: SessionUser | null; role: Role };
/** Database + ingelogde gebruiker; gooit 401/403 als dat nodig is. */
export async function context(req: NextRequest, need: Role | "ingelogd" = "ingelogd"): Promise<Ctx> {
  checkHost(req);
  const db = await store();
  assertAuthConfig(db);
  if (authMode() === "uit") return { db, user: null, role: "beheerder" };
  const user = await sessionUser(db, req.headers.get("cookie"));
  if (!user) throw new HttpError(401, "Log in om verder te gaan");
  if (need === "beheerder" && user.role !== "beheerder") throw new HttpError(403, "Alleen een beheerder mag dit doen");
  return { db, user, role: user.role };
}
/** Voer de actie uit namens de gebruiker (audit, "laatst gewijzigd door"). */
export function asUser<T>(ctx: Ctx, fn: () => Promise<T>) {
  return asActor(ctx.user ? actorOf(ctx.user) : localActor, fn);
}
export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ConflictError) return NextResponse.json({ error: e.message, conflict: e.current }, { status: 409 });
  return NextResponse.json({ error: (e as Error).message }, { status: 400 });
}
