"use client";
import { useState } from "react";
import { Input, Select, Table, fmt, type Mutate, type Row, type Snapshot } from "./ui";

const scoreLabels: Record<string, string> = {
  age: "Leeftijd order",
  size: "Geclassificeerde aantallen",
  orders: "Orders",
  location: "Bevestigde locatie",
  quality: "Datakwaliteit",
  relationship: "Bevestigde relatie",
  need: "Bevestigde behoefte",
};
const blankCatalog = { article: "", family: "", generation: "", profile_type: "", length: "", confirmed: false, evidence: "" };
/** Gebruikers en rollen (gedeelde omgeving). Accounts aanmaken alleen bij wachtwoordaccounts; bij Entra ID beheert IT de toegang. */
function UsersSection({ snap, mutate, busy }: { snap: Snapshot; mutate: Mutate; busy: boolean }) {
  const [form, setForm] = useState({ name: "", email: "", role: "gebruiker" });
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  if (snap.authMode === "uit") return null;
  const admin = snap.me?.role === "beheerder";
  const local = snap.authMode === "lokaal";
  const emailMode = snap.authMode === "email";
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const r = await mutate("user.create", "", form, emailMode ? `${form.name} uitgenodigd: aanmelden via ${window.location.origin} met een inloglink` : `Account voor ${form.name} aangemaakt`);
    if (r?.activationPath) setLink({ name: form.name, url: window.location.origin + r.activationPath });
    if (r?.activationPath || r?.invited) setForm({ name: "", email: "", role: "gebruiker" });
  }
  async function reset(u: Row) {
    if (!confirm(`Nieuwe activatielink voor ${u.name}? Bestaande sessies van dit account vervallen.`)) return;
    const r = await mutate("user.reset", u.id, {}, "Nieuwe activatielink gemaakt");
    if (r?.activationPath) setLink({ name: String(u.name), url: window.location.origin + r.activationPath });
  }
  return (
    <section aria-label="Gebruikers en rollen">
      <h2>Gebruikers en rollen</h2>
      <p>
        {local
          ? "Persoonlijke accounts met een eigen wachtwoord. Een nieuwe collega krijgt een eenmalige activatielink (72 uur geldig) die je zelf, persoonlijk, doorgeeft."
          : emailMode
            ? "Toegang alleen op uitnodiging. Een uitgenodigde collega vraagt op het aanmeldscherm een persoonlijke inloglink aan die naar het eigen e-mailadres gaat (15 minuten geldig, eenmalig). Een e-maildomein geeft op zichzelf geen toegang."
            : "Aanmelden via Microsoft Entra ID. Toegang en rol (Re-Line.Beheerder of Re-Line.Gebruiker) worden in Entra ID toegewezen; hier kun je een account alleen deactiveren."}{" "}
        Iedereen ziet alle dossiers en vervolgacties; beheerders importeren SAP-bestanden en beheren instellingen en accounts.
      </p>
      {admin && (local || emailMode) && (
        <form className="form-grid" onSubmit={create} aria-label={emailMode ? "Collega uitnodigen" : "Account aanmaken"}>
          <Input label="Naam collega" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="E-mailadres collega" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Select label="Rol" options={["gebruiker", "beheerder"]} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          <button className="primary" disabled={busy}>{emailMode ? "Collega uitnodigen" : "Account aanmaken"}</button>
        </form>
      )}
      {link && (
        <div className="alert success" role="status">
          Activatielink voor {link.name} (eenmalig, 72 uur geldig):
          <input aria-label="Activatielink" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={() => void navigator.clipboard?.writeText(link.url)}>Kopiëren</button>
        </div>
      )}
      <Table label="Gebruikers" headers={["Naam", ...(admin ? ["E-mail"] : []), "Rol", "Status", ...(admin ? ["Laatst aangemeld", "Beheer"] : [])]}>
        {snap.users.map((u) => (
          <tr key={u.id}>
            <td>{u.name}{u.id === snap.me?.id ? " (jij)" : ""}</td>
            {admin && <td>{u.email}</td>}
            <td>
              {admin && u.id !== snap.me?.id ? (
                <select aria-label={"Rol van " + u.name} value={u.role} disabled={busy}
                  onChange={(e) => void mutate("user.update", u.id, { role: e.target.value }, `Rol van ${u.name} gewijzigd`)}>
                  <option value="gebruiker">gebruiker</option>
                  <option value="beheerder">beheerder</option>
                </select>
              ) : u.role}
            </td>
            <td>{!Number(u.active) ? "Gedeactiveerd" : Number(u.pending) ? "Uitgenodigd" : "Actief"}</td>
            {admin && <td>{u.last_login ? new Date(u.last_login).toLocaleString("nl-NL") : "—"}</td>}
            {admin && (
              <td>
                {u.id !== snap.me?.id && (
                  <button type="button" disabled={busy}
                    onClick={() => void mutate("user.update", u.id, { active: !Number(u.active) }, Number(u.active) ? `${u.name} gedeactiveerd` : `${u.name} geactiveerd`)}>
                    {Number(u.active) ? "Deactiveren" : "Activeren"}
                  </button>
                )}
                {local && Number(u.active) && u.id !== snap.me?.id ? (
                  <button type="button" disabled={busy} onClick={() => void reset(u)}>Nieuwe activatielink</button>
                ) : null}
              </td>
            )}
          </tr>
        ))}
      </Table>
    </section>
  );
}
/** Gebruikers, artikelcatalogus, prioriteringsgewichten, back-ups en auditlog. */
export function SettingsDesk({ snap, mutate, busy }: { snap: Snapshot; mutate: Mutate; busy: boolean }) {
  const [catalog, setCatalog] = useState<Row>(blankCatalog);
  const [weights, setWeights] = useState(snap.weights);
  const admin = !snap.me || snap.me.role === "beheerder";
  return (
    <>
      <UsersSection snap={snap} mutate={mutate} busy={busy} />
      {!admin && <p className="notice">Classificatie, prioritering en back-ups kan alleen een beheerder wijzigen.</p>}
      <section>
        <h2>Controleerbare artikelcatalogus</h2>
        <p>
          Een artikel telt pas als E-Line/C-Line in de prioriteit mee na een bevestigde
          classificatie met controleerbare bron (bijv. historische catalogus of productmanagement).
          Een familie in het bronbestand is een aanwijzing, geen bevestiging. Omschrijvingsteksten
          zoals “-2,5” worden nooit als profiellengte geïnterpreteerd; vul lengte alleen in met bron.
        </p>
        <Table
          label="Artikelcatalogus"
          headers={["Artikel", "Omschrijving (bron)", "Regels", "Familie volgens bron", "Bevestigde familie", "Generatie", "Profieltype", "Lengte", "Bevestigd", "Bron", "Bewerken"]}
        >
          {snap.catalog.map((c) => (
            <tr key={c.article}>
              <td>{c.article}</td>
              <td>{fmt(c.descriptions)}</td>
              <td>{c.lineCount}</td>
              <td>{fmt(c.sourceFamily)}</td>
              <td>{fmt(c.family)}</td>
              <td>{fmt(c.generation)}</td>
              <td>{fmt(c.profile_type)}</td>
              <td>{fmt(c.length)}</td>
              <td>{c.confirmed ? "Ja" : "Nee"}</td>
              <td>{fmt(c.evidence)}</td>
              <td>
                <button
                  disabled={!admin}
                  onClick={() =>
                    setCatalog({
                      ...c,
                      family: c.family || (["E-Line", "C-Line"].includes(c.sourceFamily) ? c.sourceFamily : ""),
                      length: c.length ?? "",
                      confirmed: !!c.confirmed,
                    })
                  }
                >
                  Classificeren
                </button>
              </td>
            </tr>
          ))}
        </Table>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            mutate("catalog", "", { ...catalog, length: catalog.length === "" ? null : Number(catalog.length) });
          }}
        >
          <Input label="Artikelcode" required value={catalog.article} onChange={(e) => setCatalog({ ...catalog, article: e.target.value })} />
          <Select label="Productfamilie" options={["", "E-Line", "C-Line", "Overig"]} value={catalog.family} onChange={(e) => setCatalog({ ...catalog, family: e.target.value })} />
          <Input label="Generatie" value={catalog.generation} onChange={(e) => setCatalog({ ...catalog, generation: e.target.value })} />
          <Input label="Profieltype" value={catalog.profile_type} onChange={(e) => setCatalog({ ...catalog, profile_type: e.target.value })} />
          <Input
            type="number"
            step="any"
            min="0.01"
            label="Bevestigde profiellengte (m)"
            value={catalog.length}
            onChange={(e) => setCatalog({ ...catalog, length: e.target.value })}
          />
          <Input label="Controleerbare bron" value={catalog.evidence} onChange={(e) => setCatalog({ ...catalog, evidence: e.target.value })} />
          <label className="checkbox">
            <input type="checkbox" checked={catalog.confirmed} onChange={(e) => setCatalog({ ...catalog, confirmed: e.target.checked })} />{" "}
            Classificatie bevestigd
          </label>
          <button className="primary" disabled={busy || !admin}>Classificatie opslaan</button>
        </form>
      </section>
      <section>
        <h2>Prioriteringsmodel</h2>
        <p>
          Instelbare gewichten van 0–100. Leeftijd: maximum na 20 orderjaren; omvang: maximum bij
          500 geclassificeerde artikelen; orders: maximum bij 5. Geen installatiedatum of meters
          afgeleid uit artikelnaam. Prioriteit hoog vanaf 60, middel vanaf 30. Datakwaliteit blijft
          apart zichtbaar.
        </p>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            mutate("weights", "", weights);
          }}
        >
          {Object.entries(weights).map(([k, v]) => (
            <Input
              key={k}
              label={scoreLabels[k]}
              type="number"
              min="0"
              max="100"
              value={v}
              onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })}
            />
          ))}
          <button className="primary" disabled={busy || !admin}>Gewichten opslaan</button>
        </form>
      </section>
      {snap.database === "postgres" ? (
        <section>
          <h2>Back-ups</h2>
          <p>
            De centrale PostgreSQL-database wordt door de database-omgeving bewaard: automatische back-ups met
            herstel tot een tijdstip (point-in-time restore). Re-Line maakt zelf geen bestandskopieën. Databaseschema:
            versie {snap.schemaVersion}.
          </p>
        </section>
      ) : (
      <section>
        <h2>Back-ups</h2>
        <p>
          Een back-up is een volledige kopie van de lokale database (projecten, notities,
          gesprekken, scenario&apos;s) in de map <code>data/backups</code> naast de database.
          Vóór iedere schemawijziging maakt Re-Line automatisch een back-up. Kopieer back-ups
          naar goedgekeurde bedrijfsopslag; de database is niet versleuteld.
          Databaseschema: versie {snap.schemaVersion}.
        </p>
        <button className="primary" disabled={busy || !admin} onClick={() => mutate("backup", "", {}, "Back-up gemaakt")}>
          Back-up maken
        </button>
        <Table label="Back-ups" headers={["Bestand", "Moment", "Grootte"]}>
          {snap.backups.map((b) => (
            <tr key={b.name}>
              <td>{b.name}</td>
              <td>{new Date(b.created).toLocaleString("nl-NL")}</td>
              <td>{Math.round(b.size / 1024).toLocaleString("nl-NL")} kB</td>
            </tr>
          ))}
        </Table>
        {!snap.backups.length && <p>Nog geen back-ups.</p>}
      </section>
      )}
      <section>
        <h2>Auditlog (laatste 100 gebeurtenissen)</h2>
        <p>
          {snap.me
            ? admin
              ? "Wie wat wanneer heeft gewijzigd. Alleen zichtbaar voor beheerders."
              : "Het auditlog is alleen zichtbaar voor beheerders."
            : "Lokale wijzigingshistorie."}
        </p>
        <Table label="Auditlog" headers={["Moment", "Door", "Actie", "Referentie", "Details"]}>
          {snap.audit.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.created).toLocaleString("nl-NL")}</td>
              <td>{a.user_name || "—"}</td>
              <td>{a.action}</td>
              <td>{a.entity}</td>
              <td>
                <details>
                  <summary>Details</summary>
                  <pre>{a.detail}</pre>
                </details>
              </td>
            </tr>
          ))}
        </Table>
      </section>
    </>
  );
}
