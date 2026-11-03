// Gesimuleerde identity provider (OpenID Connect) voor de geautomatiseerde test van "Aanmelden met Microsoft".
// Alleen voor tests op 127.0.0.1: discovery, JWKS, een aanmeldpagina met fictieve persona's, en een
// tokeneindpunt dat client secret en PKCE controleert en een RS256-ondertekend ID-token met app-rollen geeft.
//   node scripts/mock-oidc.mjs 3111
import { createHash, generateKeyPairSync, randomBytes, createSign } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 3111);
const issuer = `http://127.0.0.1:${port}`;
const clientId = process.env.MOCK_OIDC_CLIENT_ID ?? "reline-test";
const clientSecret = process.env.MOCK_OIDC_CLIENT_SECRET ?? "test-geheim-niet-echt";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = randomBytes(8).toString("hex");
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
const personas = {
  beheerder: { oid: "00000000-0000-0000-0000-00000000000a", name: "Eva Beheer (fictief)", email: "eva.beheer@example.test", roles: ["Re-Line.Beheerder"] },
  gebruiker: { oid: "00000000-0000-0000-0000-00000000000b", name: "Daan Verkoop (fictief)", email: "daan.verkoop@example.test", roles: ["Re-Line.Gebruiker"] },
  geenrol: { oid: "00000000-0000-0000-0000-00000000000c", name: "Zonder Rol (fictief)", email: "zonder.rol@example.test", roles: [] },
};
const codes = new Map();
const b64u = (b) => Buffer.from(b).toString("base64url");
function idToken(p, nonce) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const payload = b64u(
    JSON.stringify({ iss: issuer, aud: clientId, sub: p.oid, oid: p.oid, tid: "fictieve-tenant", name: p.name, email: p.email, preferred_username: p.email, roles: p.roles, nonce, iat: now, nbf: now, exp: now + 600 }),
  );
  const sig = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${b64u(sig)}`;
}
const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};
createServer(async (req, res) => {
  const url = new URL(req.url, issuer);
  if (url.pathname === "/.well-known/openid-configuration")
    return json(res, 200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      scopes_supported: ["openid", "profile", "email"],
    });
  if (url.pathname === "/jwks") return json(res, 200, { keys: [jwk] });
  if (url.pathname === "/authorize") {
    const q = url.searchParams;
    if (q.get("client_id") !== clientId || q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256")
      return json(res, 400, { error: "invalid_request" });
    const who = q.get("persona");
    if (!who) {
      // Aanmeldpagina met fictieve persona's (de echte Microsoft-pagina vraagt e-mail, wachtwoord en MFA).
      const links = Object.entries(personas)
        .map(([k, p]) => `<p><a href="?${new URLSearchParams({ ...Object.fromEntries(q), persona: k })}">Aanmelden als ${p.name}</a></p>`)
        .join("");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><title>Gesimuleerde aanmelding</title><h1>Gesimuleerde Microsoft-aanmelding (test)</h1>${links}`);
    }
    const code = randomBytes(24).toString("base64url");
    codes.set(code, { persona: personas[who], nonce: q.get("nonce"), challenge: q.get("code_challenge"), redirect: q.get("redirect_uri") });
    const back = new URL(q.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state") ?? "");
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }
  if (url.pathname === "/token" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const f = new URLSearchParams(body);
    const c = codes.get(f.get("code"));
    codes.delete(f.get("code"));
    if (f.get("client_id") !== clientId || f.get("client_secret") !== clientSecret) return json(res, 401, { error: "invalid_client" });
    if (!c || f.get("redirect_uri") !== c.redirect) return json(res, 400, { error: "invalid_grant" });
    const challenge = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
    if (challenge !== c.challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE" });
    return json(res, 200, { access_token: randomBytes(16).toString("hex"), token_type: "Bearer", expires_in: 600, id_token: idToken(c.persona, c.nonce) });
  }
  json(res, 404, { error: "not_found" });
}).listen(port, "127.0.0.1", () => console.log(`Gesimuleerde OIDC-provider op ${issuer}`));
