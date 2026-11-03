"use client";
import { useEffect, useState } from "react";

export type AuthInfo = {
  mode: "uit" | "lokaal" | "entra" | "email";
  user: { id: string; name: string; role: "beheerder" | "gebruiker"; provider: string } | null;
  firstAdminNeeded?: boolean;
  mailReady?: boolean;
  demo?: boolean;
};
const reasons: Record<string, string> = {
  "geen-rol": "Je Microsoft-account heeft nog geen toegang tot Re-Line. Vraag de beheerder of IT om je de rol Re-Line.Gebruiker toe te wijzen.",
  gedeactiveerd: "Je account is gedeactiveerd. Neem contact op met de beheerder van Re-Line.",
  mislukt: "Aanmelden is niet gelukt. Probeer het opnieuw.",
};
async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(json.error || "Verzoek mislukt");
  return json;
}
/** Aanmelden (wachtwoord, Microsoft Entra ID of inloglink per e-mail) en een account activeren via de link van de beheerder. */
export function Login({ info, expired, onLoggedIn }: { info: AuthInfo; expired: boolean; onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkToken, setLinkToken] = useState("");
  const [sent, setSent] = useState("");
  useEffect(() => {
    // Ook bij een activatielink die in een al geopend tabblad wordt geplakt (alleen de #-hash verandert dan).
    const read = () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (hash.get("activeren")) setToken(hash.get("activeren")!);
      if (hash.get("inloggen")) setLinkToken(hash.get("inloggen")!);
      if (hash.get("aanmelden")) setError(reasons[hash.get("aanmelden")!] ?? reasons.mislukt);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSent("");
    try {
      setSent((await post("/api/auth/email-link/request", { email })).message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function consumeLink() {
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/email-link/verify", { token: linkToken });
      history.replaceState(null, "", window.location.pathname);
      onLoggedIn();
    } catch (err) {
      history.replaceState(null, "", window.location.pathname);
      setLinkToken("");
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (token) {
        if (password !== repeat) throw Error("De wachtwoorden zijn niet gelijk");
        await post("/api/auth/activate", { token, password });
        history.replaceState(null, "", window.location.pathname);
      } else await post("/api/auth/login", { email, password });
      onLoggedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-card" aria-label="Aanmelden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand" src="/re-line-logo.svg" alt="Re-Line Utiliteit" width={220} height={65} />
        <h1>{token ? "Account activeren" : "Aanmelden"}</h1>
        {info.demo && <p className="alert warn">Demo met uitsluitend fictieve gegevens. Voer geen echte klant- of projectgegevens in.</p>}
        {expired && !error && <p className="alert warn">Je sessie is verlopen. Meld je opnieuw aan.</p>}
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        {info.mode === "email" ? (
          linkToken ? (
            <div className="login-form">
              <p>Je opent een inloglink. Klik hieronder om je aan te melden; de link werkt één keer.</p>
              <button type="button" className="primary" disabled={busy} onClick={() => void consumeLink()}>
                {busy ? "Bezig…" : "Nu aanmelden"}
              </button>
            </div>
          ) : (
            <form onSubmit={requestLink} className="login-form">
              <p>Toegang alleen op uitnodiging. Vul je zakelijke e-mailadres in; je krijgt een persoonlijke inloglink (15 minuten geldig, eenmalig).</p>
              {info.mailReady === false && (
                <p className="alert warn">E-mailverzending is nog niet ingesteld; aanmelden is tijdelijk niet mogelijk.</p>
              )}
              <label>
                E-mailadres
                <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <button className="primary" disabled={busy || info.mailReady === false}>
                {busy ? "Bezig…" : "Stuur inloglink"}
              </button>
              {sent && (
                <p role="status" className="alert success">
                  {sent}
                </p>
              )}
            </form>
          )
        ) : info.mode === "entra" && !token ? (
          <>
            <p>Re-Line gebruikt je TRILUX-account (Microsoft Entra ID). Je hoeft geen apart wachtwoord te onthouden.</p>
            <a className="button primary" href="/api/auth/entra/start">
              Aanmelden met Microsoft
            </a>
          </>
        ) : (
          <form onSubmit={submit} className="login-form">
            {token ? (
              <p>Kies een eigen wachtwoord van minimaal 12 tekens. Daarna ben je direct aangemeld.</p>
            ) : (
              <label>
                E-mailadres
                <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
            )}
            <label>
              {token ? "Nieuw wachtwoord" : "Wachtwoord"}
              <input
                type="password"
                autoComplete={token ? "new-password" : "current-password"}
                required
                minLength={token ? 12 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {token && (
              <label>
                Herhaal wachtwoord
                <input type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
              </label>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Bezig…" : token ? "Activeren en aanmelden" : "Aanmelden"}
            </button>
          </form>
        )}
        {info.firstAdminNeeded && !token && (
          <p className="notice">
            {info.mode === "email" ? (
              <>Er is nog geen account. De serverbeheerder stelt het eerste beheerdersadres in met <code>RELINE_BOOTSTRAP_ADMIN_EMAIL</code>.</>
            ) : (
              <>
                Er is nog geen account. De beheerder van de server maakt het eerste beheerdersaccount aan met{" "}
                <code>npm run gebruiker -- --maak --beheerder --email … --naam …</code> en opent de getoonde activatielink.
              </>
            )}
          </p>
        )}
        <p className="subtitle">
          {info.mode === "email"
            ? "Interne TRILUX-toepassing. Re-Line mailt alleen je inloglink; klant- en projectgegevens worden niet gedeeld of verzonden."
            : "Interne TRILUX-toepassing. Gegevens worden niet automatisch gedeeld of verzonden."}
        </p>
      </section>
    </main>
  );
}
