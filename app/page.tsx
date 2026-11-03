"use client";
import { useCallback, useEffect, useState } from "react";
import { Dashboard } from "./dashboard";
import { OpportunityDesk } from "./opportunities";
import { PortfolioDesk } from "./commercial";
import { SalesDesk } from "./sales";
import { ProjectsDesk } from "./projects";
import { RelationsDesk } from "./relations";
import { ImportDesk } from "./importer";
import { SettingsDesk } from "./settings";
import { DossierView } from "./dossier";
import { Login, type AuthInfo } from "./login";
import type { Dossier, DossierView as View, Row, Snapshot } from "./ui";

const allTabs = [
  "Dashboard",
  "Kansen",
  "Salesopvolging",
  "Portefeuilles",
  "Projecten",
  "Relaties",
  "Import",
  "Instellingen",
];
const subtitles: Record<string, string> = {
  Dashboard: "Van historische order naar een onderbouwde renovatiekans.",
  Kansen: "Schiften, toewijzen en de eerste belactie plannen.",
  Salesopvolging: "Werkvoorraad, pipeline en recente gesprekken.",
  Portefeuilles: "Historische relaties en hun dossiers; één gesprek voor meerdere locaties.",
  Projecten: "Alle voorlopige dossiers: zoeken, filteren, selecteren en samenvoegen.",
  Relaties: "Rollen en contactgegevens van historische en bevestigde relaties.",
  Import: "Historische SAP-/Product Finder-exports veilig inlezen.",
  Instellingen: "Gebruikers, artikelclassificatie, prioritering, back-ups en auditlog.",
};
class AuthError extends Error {}
class ConflictError extends Error {}
type Change = { version: number; updatedBy: string; updatedAt: string | null };

export default function Home() {
  const [auth, setAuth] = useState<AuthInfo | null>(null),
    [expired, setExpired] = useState(false),
    [tab, setTab] = useState("Dashboard"),
    [snap, setSnap] = useState<Snapshot | null>(null),
    [dossier, setDossier] = useState<Dossier | null>(null),
    [view, setView] = useState<View>("Overzicht"),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [changed, setChanged] = useState<Change | null>(null),
    [busy, setBusy] = useState(false);
  const request = useCallback(async (url: string, options?: RequestInit) => {
    const res = await fetch(url, options);
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw new AuthError(body.error || "Log in om verder te gaan");
    if (res.status === 409) throw new ConflictError(body.error || "Dossier is intussen gewijzigd");
    if (!res.ok) throw Error(body.error || "Verzoek mislukt");
    return body;
  }, []);
  const sessionLost = useCallback(() => {
    setExpired(true);
    setSnap(null);
    setDossier(null);
    setAuth((a) => (a ? { ...a, user: null } : a));
  }, []);
  const refresh = useCallback(async () => {
    const s = (await request("/api/workbench")) as Snapshot;
    // Toewijzen: bestaande verantwoordelijken plus alle actieve collega's.
    s.owners = [...new Set([...s.owners, ...(s.users ?? []).filter((u) => Number(u.active)).map((u) => String(u.name))])].sort((a, b) =>
      a.localeCompare(b, "nl"),
    );
    setSnap(s);
  }, [request]);
  const start = useCallback(async () => {
    try {
      const info = (await request("/api/auth/me")) as AuthInfo;
      setAuth(info);
      if (info.mode === "uit" || info.user) {
        setExpired(false);
        await refresh();
      }
    } catch (e) {
      if (e instanceof AuthError) sessionLost();
      else setError((e as Error).message);
    }
  }, [refresh, request, sessionLost]);
  useEffect(() => {
    // Eerste keer laden; de setState-aanroepen gebeuren pas na het antwoord van de server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
  }, [start]);
  // Gezamenlijk werken: laat zien als een collega het open dossier intussen wijzigt.
  useEffect(() => {
    if (!dossier) return;
    const id = dossier.id;
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const v = (await request(`/api/workbench?project=${id}&versie=1`)) as Change;
        if (v.version !== Number(dossier.version) || (v.updatedAt ?? null) !== (dossier.updated_at ?? null)) setChanged(v);
      } catch (e) {
        if (e instanceof AuthError) sessionLost();
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [dossier, request, sessionLost]);
  async function open(id: string, v: View = "Overzicht") {
    try {
      setDossier(await request("/api/workbench?project=" + id));
      setView(v);
      setError("");
      setConflict(false);
      setChanged(null);
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (e instanceof AuthError) sessionLost();
      else setError((e as Error).message);
    }
  }
  async function mutate(action: string, id = "", data: Row = {}, success = "Opgeslagen") {
    setBusy(true);
    setError("");
    setMessage("");
    setConflict(false);
    try {
      const result = await request("/api/workbench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, data }),
      });
      await refresh();
      if (dossier && action !== "merge" && action !== "split") {
        setDossier(await request("/api/workbench?project=" + dossier.id));
        setChanged(null);
      }
      setMessage(success);
      return result;
    } catch (e) {
      if (e instanceof AuthError) sessionLost();
      else {
        setError((e as Error).message);
        if (e instanceof ConflictError) setConflict(true);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setExpired(false);
    setSnap(null);
    setDossier(null);
    setAuth((a) => (a ? { ...a, user: null } : a));
  }
  function go(t: string) {
    setTab(t);
    setDossier(null);
    setError("");
    setMessage("");
    setConflict(false);
    // Gedeeld werken: bij ieder tabblad de actuele stand ophalen, inclusief het werk van collega's.
    void refresh().catch((e) => {
      if (e instanceof AuthError) sessionLost();
    });
  }
  if (auth && auth.mode !== "uit" && !auth.user)
    return <Login info={auth} expired={expired} onLoggedIn={() => void start()} />;
  if (!snap)
    return (
      <main className="loading">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand" src="/re-line-logo.svg" alt="Re-Line Utiliteit" width={220} height={65} />
        <p>{error || "Database laden…"}</p>
      </main>
    );
  const isAdmin = !snap.me || snap.me.role === "beheerder";
  const tabs = allTabs.filter((t) => t !== "Import" || isAdmin);
  const overdue = snap.activities.filter(
    (a) => !a.done && a.due && ["Bellen", "Afspraak", "Vervolgactie"].includes(a.kind) && a.due < new Date().toISOString().slice(0, 10),
  ).length;
  return (
    <div className="shell">
      <aside>
        {/* Logo: engineering/branding (gegenereerd met make_logo.py), kopie in public/. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand" src="/re-line-logo-klein.svg" alt="Re-Line Utiliteit" width={168} height={49} />
        <nav aria-label="Hoofdmenu">
          {tabs.map((t) => (
            <button
              key={t}
              className={tab === t && !dossier ? "active" : ""}
              aria-current={tab === t && !dossier ? "page" : undefined}
              onClick={() => go(t)}
            >
              {t}
              {t === "Salesopvolging" && overdue > 0 && (
                <span className="nav-count" aria-hidden title={`${overdue} achterstallig`}>{overdue}</span>
              )}
            </button>
          ))}
        </nav>
        {snap.me ? (
          <div className="userbox" aria-label="Ingelogd">
            <strong>{snap.me.name}</strong>
            <small>{snap.me.role === "beheerder" ? "Beheerder" : "Gebruiker"}</small>
            <button type="button" onClick={() => void logout()}>Afmelden</button>
          </div>
        ) : (
          <p className="local">
            <span /> Lokaal opgeslagen
            <br />
            <small>Geen externe verzending</small>
          </p>
        )}
      </aside>
      <main>
        {auth?.demo && (
          <p className="alert warn" role="note">
            Demo met uitsluitend fictieve gegevens. Voer geen echte klant- of projectgegevens in.
          </p>
        )}
        <header>
          <div>
            <p className="eyebrow">{dossier ? "PROJECTDOSSIER" : "COMMERCIEEL WERKPLATFORM"}</p>
            <h1>{dossier ? dossier.name : tab}</h1>
            <p className="subtitle">
              {dossier
                ? `${dossier.city || "Plaats onbekend"} · ${dossier.status} · historische brondata en gecontroleerde opvolging`
                : subtitles[tab]}
            </p>
            {dossier?.updated_by ? (
              <p className="subtitle">
                Laatst gewijzigd door {dossier.updated_by}
                {dossier.updated_at ? ` op ${new Date(dossier.updated_at).toLocaleString("nl-NL")}` : ""}
              </p>
            ) : null}
          </div>
          {dossier && (
            <button onClick={() => setDossier(null)}>Terug naar overzicht</button>
          )}
        </header>
        {error && (
          <div role="alert" className="alert error">
            {error}
            {conflict && dossier && (
              <>
                {" "}
                <button type="button" onClick={() => void open(dossier.id, view)}>Actuele versie laden</button>
              </>
            )}
          </div>
        )}
        {changed && dossier && !conflict && (
          <div role="status" className="alert warn">
            Dit dossier is intussen gewijzigd door {changed.updatedBy || "een collega"}
            {changed.updatedAt ? ` (${new Date(changed.updatedAt).toLocaleString("nl-NL")})` : ""}.{" "}
            <button type="button" onClick={() => void open(dossier.id, view)}>Vernieuwen</button>
          </div>
        )}
        {message && (
          <div role="status" className="alert success">
            {message}
          </div>
        )}
        {busy && <p aria-live="polite">Bezig met opslaan…</p>}
        {dossier ? (
          <DossierView
            dossier={dossier}
            setDossier={setDossier}
            snap={snap}
            view={view}
            setView={setView}
            open={open}
            mutate={mutate}
            busy={busy}
          />
        ) : (
          <>
            {tab === "Dashboard" && <Dashboard snap={snap} open={open} go={go} />}
            {tab === "Kansen" && (
              <OpportunityDesk projects={snap.projects} open={open} mutate={mutate} owners={snap.owners} busy={busy} series={snap.historySeries ?? []} />
            )}
            {tab === "Salesopvolging" && <SalesDesk snap={snap} open={open} mutate={mutate} busy={busy} />}
            {tab === "Portefeuilles" && <PortfolioDesk snap={snap} open={open} mutate={mutate} busy={busy} />}
            {tab === "Projecten" && <ProjectsDesk snap={snap} open={open} mutate={mutate} busy={busy} go={go} />}
            {tab === "Relaties" && <RelationsDesk snap={snap} mutate={mutate} busy={busy} />}
            {tab === "Import" && isAdmin && (
              <ImportDesk snap={snap} refresh={refresh} setMessage={setMessage} setError={setError} busy={busy} setBusy={setBusy} />
            )}
            {tab === "Instellingen" && <SettingsDesk snap={snap} mutate={mutate} busy={busy} />}
          </>
        )}
        <footer>
          Re-Line | Utiliteit · {snap.me ? "Gedeelde omgeving" : "Lokale versie"} · Historische gegevens vragen om controle · Niets wordt automatisch verzonden
        </footer>
      </main>
    </div>
  );
}
