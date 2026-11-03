"use client";
import { useState } from "react";
import {
  questions, scenarioDirections, verifiedFacts, makeInternalBrief, latestAnswers,
  portfolioProjects, rankedRelations,
} from "@/lib/commercial";
import { relationRoles } from "@/lib/domain";
import { download, OwnerInput, today, type Dossier, type Mutate, type Open, type ProjectRow, type Snapshot } from "./ui";

/** Belvoorbereiding: bekende feiten, open punten, vragen (met laatste antwoord) en 3 richtingen. */
export function CommercialPrep({ dossier }: { dossier: Dossier }) {
  const [expanded, setExpanded] = useState(false);
  const facts = verifiedFacts(dossier);
  const answers = latestAnswers(dossier.activities as never);
  const unconfirmed = [
    !dossier.location_confirmed && "Installatielocatie",
    dossier.present !== "Ja" && "Installatie nog aanwezig",
    dossier.replaced !== "Nee" && "Vervanging uitgesloten",
    dossier.need !== "Ja" && "Renovatiebehoefte",
    dossier.meters == null && "Werkelijke profielmeters",
  ].filter(Boolean);
  return (
    <section className="commercial-prep">
      <div className="commercial-head">
        <div><p className="eyebrow">VOOR EERSTE KLANTCONTACT</p>
          <h2>Belvoorbereiding & technische kans</h2>
          <p className="subtitle">Alleen wat de bron en het gecontroleerde dossier ondersteunen. Geen aannames over levering of prijs.</p>
        </div>
        <button type="button" className="primary" onClick={() => download("re-line-intern-gespreksdossier.txt", makeInternalBrief(dossier))}>
          Intern gespreksdossier downloaden
        </button>
      </div>
      <div className="commercial-status">
        <div><strong>Bekend uit bron / dossier</strong>
          <dl>{facts.slice(0, 6).map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
        </div>
        <div><strong>Nog te verifiëren</strong>
          {unconfirmed.length
            ? <ul>{unconfirmed.map(x => <li key={String(x)}>{x}</li>)}</ul>
            : <p>De basisvelden zijn ingevuld. Technische inspectie en actuele productspecificaties blijven vereist.</p>}
          <p className="notice">SAP-order ≠ geleverde installatie. Historische aantallen ≠ lengte in meters. Een debiteur is niet automatisch de gebruiker.</p>
        </div>
      </div>
      <button type="button" onClick={() => setExpanded(!expanded)}>
        {expanded ? "Verberg belvragen en renovatierichtingen" : "Toon belvragen en 3 renovatierichtingen"}
      </button>
      {expanded && <div className="commercial-extra">
        <h3>Vragen tijdens eerste contact</h3>
        <ol>{questions.map(q => <li key={q.id}>{q.text}
          {answers[q.id] && <small className="answer"> Laatste antwoord: {answers[q.id]!.answer}{answers[q.id]!.note ? ` — ${answers[q.id]!.note}` : ""} ({answers[q.id]!.date})</small>}
        </li>)}</ol>
        <h3>Drie scenario&apos;s voor latere technische toetsing</h3>
        <div className="commercial-scenarios">{scenarioDirections.map(s =>
          <div key={s.name}><strong>{s.name}</strong><p>{s.value}</p><small>{s.gate}</small></div>
        )}</div>
        <p className="subtitle">Bij een bevestigde kans: registreer het gesprek hieronder, wijs een verantwoordelijke toe en plan de technische inventarisatie.</p>
      </div>}
    </section>
  );
}

/** Portefeuilles: historische relaties met hun unieke dossiers, plus bulkacties per relatie. */
export function PortfolioDesk({
  snap, open, mutate, busy,
}: {
  snap: Snapshot;
  open: Open;
  mutate: Mutate;
  busy: boolean;
}) {
  const [role, setRole] = useState("Alle");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [kind, setKind] = useState("Afspraak");
  const roles = ["Alle", ...relationRoles];
  const sorted = rankedRelations(snap.relations, role)
    .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()));
  const active = sorted.find(r => r.id === selected) ?? sorted[0];
  const found = (active ? portfolioProjects(active.id, snap.relationProjects, snap.projects) : []) as ProjectRow[];
  const stuks = found.reduce((s, p) => s + Number(p.quantity || 0), 0);
  const years = found.map(p => p.firstYear).filter((y): y is number => typeof y === "number");
  const inPipeline = found.filter(p => !["Nieuw gevonden", "Nader onderzoeken"].includes(p.status)).length;
  const confirmedLoc = found.filter(p => p.location_confirmed).length;
  const ids = checked.filter(id => found.some(p => p.id === id));
  function choose(id: string) {
    setSelected(id);
    setChecked([]);
  }
  async function done(r: unknown) {
    if (r) setChecked([]);
  }
  return <>
    <p className="notice">Portefeuilles worden opgebouwd uit <strong>historisch gekoppelde relaties</strong>.
      De rol &apos;Debiteur&apos; zegt niet dat dit de installateur of eindgebruiker is. Projectaantallen zijn voorlopige dossiers, geen bewezen gebouwen.
      Eenzelfde project kan aan meerdere relaties verbonden zijn: totalen over verschillende portefeuilles mag je niet optellen.</p>
    <section className="portfolio-layout">
      <div>
        <h2>Historische relaties</h2>
        <div className="portfolio-filters">
          <label>Relatierol
            <select value={role} onChange={e => { setRole(e.target.value); choose(""); }}>
              {roles.map(x => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>Relatie zoeken
            <input value={search} onChange={e => { setSearch(e.target.value); choose(""); }} placeholder="Installateur, groothandel..." />
          </label>
        </div>
        <div className="portfolio-list">
          {sorted.slice(0, 150).map(r => <button type="button" key={r.id}
            className={active?.id === r.id ? "active" : ""}
            onClick={() => choose(r.id)}>
            <strong>{r.name}</strong><span>{r.role} · {r.projectCount || 0} dossiers</span>
          </button>)}
          {!sorted.length && <p className="empty">Geen historische relaties gevonden.</p>}
        </div>
        {sorted.length > 150 && <p className="subtitle">Eerste 150 relaties zichtbaar. Verfijn de zoekopdracht.</p>}
      </div>
      <div>
        <h2>{active?.name || "Selecteer een relatie"}</h2>
        <p className="subtitle">{active
          ? `${active.role} · ${found.length} gekoppelde dossiers · geen bewezen installatieportefeuille`
          : "Importeer gegevens en leg relaties vast."}</p>
        {!!found.length && <div className="stats compact">
          <div><span>Unieke dossiers</span><strong>{found.length}</strong></div>
          <div><span>Historische stuks (bron)</span><strong>{stuks.toLocaleString("nl-NL")}</strong></div>
          <div><span>Oudste orderjaar</span><strong>{years.length ? Math.min(...years) : "?"}</strong></div>
          <div><span>In opvolging</span><strong>{inPipeline}</strong></div>
          <div><span>Locatie bevestigd</span><strong>{confirmedLoc}</strong></div>
        </div>}
        {!!found.length && <div className="bulkbar" aria-label="Acties voor portefeuille">
          <strong>{ids.length} van {found.length} geselecteerd</strong>
          <OwnerInput id="pf-owner" label="Verantwoordelijke" owners={snap.owners} value={owner} onChange={setOwner} />
          <button type="button" disabled={busy || !ids.length || !owner.trim()}
            onClick={async () => done(await mutate("bulk", "", { ids, owner: owner.trim() }, `${ids.length} dossier(s) toegewezen`))}>
            Toewijzen
          </button>
          <label>Gezamenlijke actie
            <select value={kind} onChange={e => setKind(e.target.value)}>
              <option>Afspraak</option><option>Bellen</option><option>Vervolgactie</option>
            </select>
          </label>
          <label>Datum<input type="date" value={due} min={today()} onChange={e => setDue(e.target.value)} /></label>
          <button type="button" disabled={busy || !ids.length || !active}
            onClick={async () => done(await mutate("groupActivity", active!.id, { ids, kind, due: due || null, owner: owner.trim() },
              `Gezamenlijke ${kind.toLowerCase()} met ${active!.name} gepland voor ${ids.length} dossier(s)`))}>
            Eén gezamenlijke {kind.toLowerCase()} plannen
          </button>
          {active && active.role !== "Installateur" && <button type="button" disabled={busy || !ids.length}
            onClick={async () => {
              if (confirm(`Bevestig je (bijvoorbeeld na een gesprek) dat ${active.name} de installateur is van de ${ids.length} geselecteerde dossier(s)? De historische rol '${active.role}' blijft apart bestaan.`))
                done(await mutate("relation", "", { name: active.name, number: active.number ?? "", role: "Installateur", contact: active.contact ?? "", projectIds: ids },
                  `${active.name} als installateur gekoppeld aan ${ids.length} dossier(s)`));
            }}>
            Bevestigen als installateur van selectie
          </button>}
        </div>}
        {!!found.length && <div className="table-wrap"><table>
          <thead><tr>
            <th><input type="checkbox" aria-label="Selecteer alle dossiers van deze relatie"
              checked={ids.length === found.length} onChange={() => setChecked(ids.length === found.length ? [] : found.map(p => p.id))} /></th>
            <th>Project</th><th>Plaats</th><th>Oudste orderjaar</th><th>Historische stuks</th><th>Salesstatus</th><th>Verantwoordelijke</th>
          </tr></thead>
          <tbody>{found.map(p => <tr key={p.id}>
            <td><input type="checkbox" aria-label={"Selecteer " + p.name} checked={checked.includes(p.id)}
              onChange={() => setChecked(checked.includes(p.id) ? checked.filter(x => x !== p.id) : [...checked, p.id])} /></td>
            <td><button type="button" className="link" onClick={() => open(p.id)}>{p.name}</button></td>
            <td>{p.city || "Onbekend"}</td><td>{p.firstYear ?? "Onbekend"}</td>
            <td>{p.quantity.toLocaleString("nl-NL")}</td><td>{p.status || "Onbekend"}</td><td>{p.owner || "—"}</td>
          </tr>)}</tbody>
        </table></div>}
        {!!active && !found.length && <p className="empty">Geen gekoppelde dossiers.</p>}
        <p className="notice">Commerciële route: verifieer eerst wie de oorspronkelijke montage of het onderhoud uitvoerde; benader daarna de juiste partner voor een gezamenlijke renovatieverkenning. Een gezamenlijke afspraak verschijnt als één regel in Salesopvolging.</p>
      </div>
    </section>
  </>;
}
