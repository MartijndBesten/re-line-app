import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Actor, Store } from "./db";
/**
 * Accounts, sessies en rollen voor de gedeelde Re-Line-omgeving.
 *
 * Modi (RELINE_AUTH): "uit" = lokale laptopversie zonder inloggen (alleen 127.0.0.1);
 * "lokaal" = persoonlijke accounts met wachtwoord (activatielink door de beheerder);
 * "entra" = Microsoft Entra ID (OpenID Connect, app-rollen);
 * "email" = alleen op uitnodiging, aanmelden met een eenmalige inloglink per e-mail (15 minuten geldig).
 * Patronen uit bouwsteen B29/B23:
 * opake tokens van 256 bit, alleen de SHA-256-hash in de database, server-side sessies in een
 * HttpOnly-cookie, deny-by-default.
 */
export type AuthMode = "uit" | "lokaal" | "entra" | "email";
export type Role = "beheerder" | "gebruiker";
export const roles: Role[] = ["beheerder", "gebruiker"];
export type SessionUser = { id: string; name: string; email: string; role: Role; provider: string };

export function authMode(): AuthMode {
  const m = (process.env.RELINE_AUTH ?? "uit").toLowerCase();
  if (m === "uit" || m === "lokaal" || m === "entra" || m === "email") return m;
  throw Error(`Onbekende RELINE_AUTH "${m}" (gebruik uit, lokaal, entra of email)`);
}
/** Centrale database zonder inloggen is nooit toegestaan (fail closed). */
export function assertAuthConfig(store: Store) {
  if (store.dialect === "postgres" && authMode() === "uit")
    throw Error("Een centrale database vereist inloggen: zet RELINE_AUTH op lokaal, entra of email.");
}

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

// ---------- wachtwoorden (scrypt) ----------
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(password: string, stored: string | null | undefined) {
  const parts = String(stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    // Zelfde rekentijd als bij een bestaand account, zodat de responstijd niets verraadt.
    await scrypt(password, randomBytes(16), 64, SCRYPT);
    return false;
  }
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
export function checkPasswordStrength(password: string) {
  if (password.length < 12) throw Error("Kies een wachtwoord van minimaal 12 tekens");
  if (password.length > 200) throw Error("Wachtwoord is te lang");
  if (new Set(password).size < 6) throw Error("Kies een minder voorspelbaar wachtwoord");
}

// ---------- sessies ----------
export const SESSION_HOURS = Number(process.env.RELINE_SESSION_HOURS ?? 12);
export const IDLE_HOURS = Number(process.env.RELINE_SESSION_IDLE_HOURS ?? 4);
/**
 * `__Host-`-cookie (alleen Secure, Path=/, geen Domain) bij https. Bij een lokale http-test
 * (RELINE_PUBLIC_URL = http://127.0.0.1…) zonder Secure, anders weigert de browser hem.
 */
export function sessionCookieName() {
  return insecureLocal() ? "reline-sessie" : "__Host-reline-sessie";
}
export function insecureLocal() {
  const url = process.env.RELINE_PUBLIC_URL ?? "http://127.0.0.1";
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url);
}
export function sessionCookie(token: string) {
  return `${sessionCookieName()}=${token}; Path=/; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; SameSite=Lax${insecureLocal() ? "" : "; Secure"}`;
}
export const clearSessionCookie = () =>
  `${sessionCookieName()}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${insecureLocal() ? "" : "; Secure"}`;
export function readCookie(header: string | null, name: string) {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

export async function createSession(store: Store, userId: string) {
  const token = newToken();
  const now = new Date();
  await store.run(
    "INSERT INTO sessions(id_hash,user_id,created,expires,last_seen,revoked) VALUES(?,?,?,?,?,0)",
    hashToken(token),
    userId,
    now.toISOString(),
    new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString(),
    now.toISOString(),
  );
  await store.run("UPDATE users SET last_login=? WHERE id=?", now.toISOString(), userId);
  return token;
}
/** Geldige sessie → gebruiker; anders null (verlopen, inactief, ingetrokken, gedeactiveerd account). */
export async function sessionUser(store: Store, cookieHeader: string | null): Promise<SessionUser | null> {
  const token = readCookie(cookieHeader, sessionCookieName());
  if (!token || !TOKEN.test(token)) return null;
  const row = await store.one(
    `SELECT s.id_hash,s.expires,s.last_seen,s.revoked,u.id,u.name,u.email,u.role,u.active,u.auth_provider
     FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=?`,
    hashToken(token),
  );
  if (!row || Number(row.revoked) || !Number(row.active)) return null;
  const now = Date.now();
  if (Date.parse(String(row.expires)) <= now) return null;
  if (now - Date.parse(String(row.last_seen)) > IDLE_HOURS * 3600_000) return null;
  // last_seen hooguit eens per minuut bijwerken.
  if (now - Date.parse(String(row.last_seen)) > 60_000)
    await store.run("UPDATE sessions SET last_seen=? WHERE id_hash=?", new Date(now).toISOString(), String(row.id_hash));
  if (!roles.includes(row.role as Role)) return null;
  return { id: String(row.id), name: String(row.name), email: String(row.email), role: row.role as Role, provider: String(row.auth_provider) };
}
export async function revokeSession(store: Store, cookieHeader: string | null) {
  const token = readCookie(cookieHeader, sessionCookieName());
  if (token && TOKEN.test(token)) await store.run("UPDATE sessions SET revoked=1 WHERE id_hash=?", hashToken(token));
}
export const actorOf = (u: SessionUser): Actor => ({ id: u.id, name: u.name, role: u.role });

/**
 * Client-adres voor de inlogrem. Achter een proxy voegt die het echte adres rechts toe aan X-Forwarded-For;
 * alles links daarvan kan de client zelf meesturen. Daarom tellen we vanaf rechts het aantal vertrouwde
 * proxy's (RELINE_PROXY_HOPS, standaard 1, bijv. Azure App Service) en laten het poortnummer weg.
 * Zonder header (lokaal, direct op 127.0.0.1): "lokaal".
 */
export function clientAddress(forwardedFor: string | null | undefined, hops = Number(process.env.RELINE_PROXY_HOPS ?? 1)) {
  const list = String(forwardedFor ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const entry = list[list.length - Math.max(1, Math.floor(hops) || 1)] ?? list[0] ?? "";
  const v4 = entry.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  const v6 = entry.match(/^\[([0-9a-fA-F:.]+)\](?::\d+)?$/);
  return (v4?.[1] ?? v6?.[1] ?? entry) || "lokaal";
}

// ---------- gedeelde rate limiting (meerdere serverinstanties) ----------
export const limits = {
  "login.email": { limit: 5, windowSeconds: 15 * 60 },
  "login.client": { limit: 30, windowSeconds: 15 * 60 },
  activate: { limit: 10, windowSeconds: 15 * 60 },
  "emaillink.email": { limit: 3, windowSeconds: 15 * 60 },
  "emaillink.client": { limit: 20, windowSeconds: 15 * 60 },
  "emaillink.verify": { limit: 20, windowSeconds: 15 * 60 },
  write: { limit: 300, windowSeconds: 60 },
} as const;
export async function rateLimit(store: Store, policy: keyof typeof limits, key: string) {
  const { limit, windowSeconds } = limits[policy];
  const bucket = createHash("sha256").update(`${policy}|${key}`).digest("hex");
  const now = new Date();
  return store.transaction(async () => {
    const row = await store.one("SELECT count,reset_at FROM rate_limits WHERE bucket=?", bucket);
    if (!row || Date.parse(String(row.reset_at)) <= now.getTime()) {
      await store.run(
        "INSERT INTO rate_limits(bucket,count,reset_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=1,reset_at=excluded.reset_at",
        bucket,
        new Date(now.getTime() + windowSeconds * 1000).toISOString(),
      );
      return true;
    }
    await store.run("UPDATE rate_limits SET count=count+1 WHERE bucket=?", bucket);
    return Number(row.count) + 1 <= limit;
  });
}

// ---------- accounts (beheerder) ----------
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
export const ACTIVATION_HOURS = 72;
/** Toegestane e-maildomeinen voor uitnodigingen (RELINE_EMAIL_DOMAINS, kommagescheiden). Leeg = geen domeinbeperking.
 *  Een domein geeft nooit zelf toegang: alleen uitgenodigde, actieve accounts kunnen een inloglink krijgen. */
export function allowedEmailDomains() {
  return (process.env.RELINE_EMAIL_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}
/**
 * Nieuw account. Wachtwoordaccounts (standaard) krijgen een eenmalige activatielink (72 uur; het token staat alleen
 * in de link). In e-maillinkmodus is het een uitnodiging: het adres staat op de toegangslijst en de collega vraagt
 * zelf een inloglink aan; er is geen wachtwoord en geen activatietoken.
 */
export async function createUser(
  store: Store,
  data: { email: unknown; name: unknown; role: unknown },
  createdBy: string,
  provider: "lokaal" | "email" = authMode() === "email" ? "email" : "lokaal",
) {
  const email = normEmail(data.email);
  const name = String(data.name ?? "").trim().slice(0, 120);
  const role = String(data.role ?? "gebruiker") as Role;
  if (!EMAIL.test(email)) throw Error("Vul een geldig e-mailadres in");
  if (!name) throw Error("Vul een naam in");
  if (!roles.includes(role)) throw Error("Kies de rol beheerder of gebruiker");
  const domains = allowedEmailDomains();
  if (provider === "email" && domains.length && !domains.includes(email.split("@")[1]))
    throw Error(`Alleen adressen op ${domains.map((d) => "@" + d).join(", ")} kunnen worden uitgenodigd`);
  if (await store.one("SELECT id FROM users WHERE email=?", email)) throw Error("Er bestaat al een account met dit e-mailadres");
  const id = randomUUID();
  const token = provider === "lokaal" ? newToken() : null;
  await store.transaction(async () => {
    await store.run(
      "INSERT INTO users(id,email,name,role,active,auth_provider,activation_hash,activation_expires,created,created_by) VALUES(?,?,?,?,1,?,?,?,?,?)",
      id, email, name, role, provider, token ? hashToken(token) : null,
      token ? new Date(Date.now() + ACTIVATION_HOURS * 3600_000).toISOString() : null, new Date().toISOString(), createdBy,
    );
    await store.audit(provider === "email" ? "Collega uitgenodigd" : "Account aangemaakt", id, `${name} (${role})`);
  });
  return { id, activationToken: token };
}

// ---------- inloglink per e-mail (RELINE_AUTH=email) ----------
export const EMAIL_LINK_MINUTES = 15;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * Inloglink aanvragen. Altijd hetzelfde antwoord voor de aanvrager (geen accountenumeratie); alleen een actief,
 * uitgenodigd account krijgt een mail. Het token (256 bit) staat alleen in de mail, in de database alleen de hash;
 * een nieuwe aanvraag vervangt de vorige link. De link gebruikt een #-fragment: dat komt niet in serverlogs of referrers.
 */
export async function requestEmailLink(store: Store, emailInput: unknown, send: (m: { to: string; name: string; link: string; minutes: number }) => Promise<void>) {
  const email = normEmail(emailInput);
  if (!EMAIL.test(email)) return { sent: false };
  const user = await store.one("SELECT * FROM users WHERE email=? AND auth_provider='email' AND active=1", email);
  if (!user) return { sent: false };
  const token = newToken();
  await store.run(
    "UPDATE users SET activation_hash=?,activation_expires=? WHERE id=?",
    hashToken(token), new Date(Date.now() + EMAIL_LINK_MINUTES * 60_000).toISOString(), String(user.id),
  );
  const base = (process.env.RELINE_PUBLIC_URL ?? "").replace(/\/$/, "");
  await send({ to: email, name: String(user.name), link: `${base}/#inloggen=${token}`, minutes: EMAIL_LINK_MINUTES });
  await store.audit("Inloglink verstuurd", String(user.id), "per e-mail");
  return { sent: true };
}
/** Inloglink gebruiken: eenmalig, alleen binnen de geldigheid, alleen voor een actief uitgenodigd account. */
export async function verifyEmailLink(store: Store, token: string) {
  const fail = async () => {
    await sleep(200);
    throw Error("Deze inloglink is ongeldig, al gebruikt of verlopen. Vraag een nieuwe inloglink aan.");
  };
  if (!TOKEN.test(token)) return fail();
  // Atomair verbruiken: alleen de eerste aanvraag met dit token wint (ook bij twee gelijktijdige klikken).
  const id = await store.transaction(async () => {
    const user = await store.one("SELECT * FROM users WHERE activation_hash=? AND auth_provider='email' AND active=1", hashToken(token));
    if (!user || Date.parse(String(user.activation_expires)) <= Date.now()) return null;
    const r = await store.run("UPDATE users SET activation_hash=NULL,activation_expires=NULL WHERE id=? AND activation_hash=?", String(user.id), hashToken(token));
    return r.changes ? String(user.id) : null;
  });
  return id ?? fail();
}
/**
 * Eerste beheerder in e-maillinkmodus zonder serverconsole (bijv. gratis hosting): RELINE_BOOTSTRAP_ADMIN_EMAIL
 * (+ _NAME) maakt die uitnodiging éénmalig aan, alleen zolang er nog geen enkel account bestaat.
 */
export async function ensureBootstrapAdmin(store: Store) {
  const email = normEmail(process.env.RELINE_BOOTSTRAP_ADMIN_EMAIL);
  if (authMode() !== "email" || !email) return;
  if (await store.one("SELECT id FROM users LIMIT 1")) return;
  const name = String(process.env.RELINE_BOOTSTRAP_ADMIN_NAME ?? "").trim() || email;
  try {
    await createUser(store, { email, name, role: "beheerder" }, "Opstartinstelling", "email");
  } catch (e) {
    if (!/bestaat al/.test((e as Error).message)) throw e;
  }
}
/** Nieuwe activatielink (bijv. wachtwoord vergeten); bestaande sessies van dit account vervallen. */
export async function resetActivation(store: Store, userId: string) {
  const token = newToken();
  await store.transaction(async () => {
    const r = await store.run(
      "UPDATE users SET activation_hash=?,activation_expires=? WHERE id=? AND auth_provider='lokaal'",
      hashToken(token), new Date(Date.now() + ACTIVATION_HOURS * 3600_000).toISOString(), userId,
    );
    if (!r.changes) throw Error("Account niet gevonden (of beheerd via Entra ID)");
    await store.run("UPDATE sessions SET revoked=1 WHERE user_id=?", userId);
    await store.audit("Activatielink opnieuw gemaakt", userId, "bestaande sessies ingetrokken");
  });
  return token;
}
export async function updateUser(store: Store, userId: string, data: { role?: unknown; active?: unknown; name?: unknown }, actor: SessionUser | Actor) {
  const user = await store.one("SELECT * FROM users WHERE id=?", userId);
  if (!user) throw Error("Account niet gevonden");
  const role = data.role === undefined ? String(user.role) : String(data.role);
  const active = data.active === undefined ? Number(user.active) : data.active ? 1 : 0;
  const name = data.name === undefined ? String(user.name) : String(data.name).trim().slice(0, 120);
  if (!roles.includes(role as Role)) throw Error("Kies de rol beheerder of gebruiker");
  if (!name) throw Error("Vul een naam in");
  if (userId === actor.id && (role !== "beheerder" || !active)) throw Error("Je kunt je eigen beheerdersrechten niet intrekken");
  if (user.role === "beheerder" && (role !== "beheerder" || !active)) {
    const admins = Number((await store.one("SELECT COUNT(*) n FROM users WHERE role='beheerder' AND active=1"))?.n ?? 0);
    if (admins <= 1) throw Error("Er moet minstens één actieve beheerder blijven");
  }
  await store.transaction(async () => {
    await store.run("UPDATE users SET role=?,active=?,name=? WHERE id=?", role, active, name, userId);
    if (!active || role !== user.role) await store.run("UPDATE sessions SET revoked=1 WHERE user_id=?", userId);
    await store.audit("Account gewijzigd", userId, JSON.stringify({ role, active: !!active, name }));
  });
}
export async function activate(store: Store, token: string, password: string) {
  if (!TOKEN.test(token)) throw Error("Deze activatielink is ongeldig of verlopen");
  checkPasswordStrength(password);
  const user = await store.one("SELECT * FROM users WHERE activation_hash=? AND active=1", hashToken(token));
  if (!user || Date.parse(String(user.activation_expires)) <= Date.now()) throw Error("Deze activatielink is ongeldig of verlopen");
  const hash = await hashPassword(password);
  await store.transaction(async () => {
    await store.run("UPDATE users SET password_hash=?,activation_hash=NULL,activation_expires=NULL WHERE id=?", hash, String(user.id));
    await store.run("UPDATE sessions SET revoked=1 WHERE user_id=?", String(user.id));
  });
  return String(user.id);
}
export async function login(store: Store, emailInput: unknown, password: unknown) {
  const email = normEmail(emailInput);
  const user = await store.one("SELECT * FROM users WHERE email=? AND auth_provider='lokaal'", email);
  const ok = await verifyPassword(String(password ?? ""), user?.password_hash as string | null);
  if (!user || !ok || !Number(user.active)) return null;
  return String(user.id);
}
export async function listUsers(store: Store) {
  return store.all(
    "SELECT id,email,name,role,active,auth_provider,created,last_login,CASE WHEN (password_hash IS NULL AND auth_provider='lokaal') OR (last_login IS NULL AND auth_provider='email') THEN 1 ELSE 0 END pending FROM users ORDER BY name",
  );
}

// ---------- Microsoft Entra ID (OpenID Connect) ----------
export type EntraConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  adminRole: string;
  userRole: string;
  insecureTest: boolean;
};
export function entraConfig(): EntraConfig {
  const tenant = process.env.RELINE_ENTRA_TENANT_ID ?? "";
  const issuer = process.env.RELINE_ENTRA_ISSUER ?? (tenant ? `https://login.microsoftonline.com/${tenant}/v2.0` : "");
  const publicUrl = (process.env.RELINE_PUBLIC_URL ?? "").replace(/\/$/, "");
  const cfg = {
    issuer,
    clientId: process.env.RELINE_ENTRA_CLIENT_ID ?? "",
    clientSecret: process.env.RELINE_ENTRA_CLIENT_SECRET ?? "",
    redirectUri: `${publicUrl}/api/auth/entra/callback`,
    adminRole: process.env.RELINE_ENTRA_ADMIN_ROLE ?? "Re-Line.Beheerder",
    userRole: process.env.RELINE_ENTRA_USER_ROLE ?? "Re-Line.Gebruiker",
    // Alleen voor de geautomatiseerde test met een gesimuleerde identity provider op http://127.0.0.1.
    insecureTest: process.env.RELINE_ENTRA_INSECURE_TEST === "1" && /^http:\/\/127\.0\.0\.1/.test(issuer),
  };
  if (!cfg.issuer || !cfg.clientId || !cfg.clientSecret || !publicUrl)
    throw Error("Entra ID is niet volledig ingesteld (RELINE_ENTRA_TENANT_ID, _CLIENT_ID, _CLIENT_SECRET en RELINE_PUBLIC_URL)");
  return cfg;
}
async function oidc(cfg: EntraConfig) {
  const client = await import("openid-client");
  const config = await client.discovery(
    new URL(cfg.issuer),
    cfg.clientId,
    undefined,
    client.ClientSecretPost(cfg.clientSecret),
    cfg.insecureTest ? { execute: [client.allowInsecureRequests] } : undefined,
  );
  return { client, config };
}
/** Start van de aanmelding: PKCE, state en nonce worden server-side (gehasht) bewaard, 10 minuten geldig. */
export async function entraStart(store: Store) {
  const cfg = entraConfig();
  const { client, config } = await oidc(cfg);
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  await store.run("DELETE FROM oidc_requests WHERE expires<?", new Date().toISOString());
  await store.run(
    "INSERT INTO oidc_requests(state_hash,code_verifier,nonce,expires) VALUES(?,?,?,?)",
    hashToken(state), verifier, nonce, new Date(Date.now() + 10 * 60_000).toISOString(),
  );
  return client.buildAuthorizationUrl(config, {
    redirect_uri: cfg.redirectUri,
    scope: "openid profile email",
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
  }).href;
}
/** Rol uit de app-rollen van Entra ID; zonder toegewezen rol geen toegang. */
export function roleFromClaims(claims: Record<string, unknown>, cfg: Pick<EntraConfig, "adminRole" | "userRole">): Role | null {
  const r = Array.isArray(claims.roles) ? claims.roles.map(String) : [];
  if (r.includes(cfg.adminRole)) return "beheerder";
  if (r.includes(cfg.userRole)) return "gebruiker";
  return null;
}
/** Callback: code + PKCE inwisselen, ID-token controleren, account bijwerken en sessie maken. */
export async function entraCallback(store: Store, callbackUrl: URL) {
  const cfg = entraConfig();
  const state = callbackUrl.searchParams.get("state") ?? "";
  const pending = await store.one("SELECT * FROM oidc_requests WHERE state_hash=?", hashToken(state));
  await store.run("DELETE FROM oidc_requests WHERE state_hash=?", hashToken(state));
  if (!pending || Date.parse(String(pending.expires)) <= Date.now()) throw Error("Aanmelding verlopen of ongeldig; probeer opnieuw");
  const { client, config } = await oidc(cfg);
  // De callback-URL zoals de identity provider hem aanriep (achter een proxy: publieke URL).
  const current = new URL(cfg.redirectUri + callbackUrl.search);
  const tokens = await client.authorizationCodeGrant(config, current, {
    pkceCodeVerifier: String(pending.code_verifier),
    expectedState: state,
    expectedNonce: String(pending.nonce),
    idTokenExpected: true,
  });
  const claims = (tokens.claims() ?? {}) as Record<string, unknown>;
  const oid = String(claims.oid ?? claims.sub ?? "");
  const email = normEmail(claims.email ?? claims.preferred_username);
  const name = String(claims.name ?? email).slice(0, 120);
  const role = roleFromClaims(claims, cfg);
  if (!oid) throw Error("Aanmelding zonder gebruikers-ID");
  if (!role) throw new Error("GEEN_ROL");
  let user = await store.one("SELECT * FROM users WHERE external_id=?", oid);
  if (user && !Number(user.active)) throw new Error("GEDEACTIVEERD");
  await store.transaction(async () => {
    if (!user) {
      const id = randomUUID();
      await store.run(
        "INSERT INTO users(id,email,name,role,active,auth_provider,external_id,created,created_by) VALUES(?,?,?,?,1,'entra',?,?,?)",
        id, email || `${oid}@entra`, name, role, oid, new Date().toISOString(), "Entra ID",
      );
      user = { id };
    } else await store.run("UPDATE users SET name=?,email=?,role=? WHERE id=?", name, email || String(user.email), role, String(user.id));
  });
  return createSession(store, String(user!.id));
}
