"use client";
import { useState } from "react";
import {
  evaluateLead,
  exportLeadCsv,
  renovationClass,
  worklist,
  worklistModes,
  type LeadStage,
  type WorklistMode,
} from "@/lib/opportunities";
import { priorityReasons } from "@/lib/dossier";
import { dueBucket } from "@/lib/worklist";
import { download, OwnerInput, today, type Mutate, type Open, type ProjectRow } from "./ui";

const modes: ("Alle" | LeadStage)[] = [
  "Alle", "Locatie controleren", "Brononderzoek", "Contact voorbereiden",
  "Al in opvolging", "Afgesloten",
];
const f = (value: number) => value.toLocaleString("nl-NL");
const modeLabel: Record<WorklistMode, string> = {
  Renovatiekandidaten: "Top 100 renovatiekandidaten",
  Projecthistorie: "Alle projecthistorie",
  Orderregels: "Orderregels (SAP/Product Finder)",
};

/** Kansen-werkvoorraad: schiften, uitleggen, toewijzen en een eerste actie plannen. */
export function OpportunityDesk({
  projects, open, mutate, owners, busy, series = [],
}: {
  projects: ProjectRow[];
  open: Open;
  mutate: Mutate;
  owners: string[];
  busy: boolean;
  series?: string[];
}) {
  const hasCandidates = projects.some((p) => p.candidate_rank !== null && p.candidate_rank !== undefined);
  const hasHistory = projects.some((p) => Number(p.historyLines) > 0);
  const [source, setSource] = useState<WorklistMode>(
    hasCandidates ? "Renovatiekandidaten" : hasHistory ? "Projecthistorie" : "Orderregels",
  );
  const [histYear, setHistYear] = useState("");
  const [seriesFilter, setSeriesFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [minRevenue, setMinRevenue] = useState("");
  const [minPriority, setMinPriority] = useState("");
  const [mode, setMode] = useState<(typeof modes)[number]>("Alle");
  const [min, setMin] = useState("100");
  const [maxYear, setMaxYear] = useState(String(new Date().getFullYear() - 5));
  const [ownerFilter, setOwnerFilter] = useState("");
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [planDue, setPlanDue] = useState("");
  const [planNote, setPlanNote] = useState("Eerste contact: installatie en huidige installateur verifiëren");
  const minimum = Math.max(0, Number(min) || 0);
  const year = Number(maxYear);
  const matchesOwner = (p: ProjectRow) =>
    !ownerFilter || (ownerFilter === "__none__" ? !p.owner : p.owner === ownerFilter);
  const matchesSearch = (p: ProjectRow) =>
    !search || [p.name, p.city, p.debtors, p.project_number].join(" ").toLowerCase().includes(search.toLowerCase());
  const orders = source === "Orderregels";
  const base = worklist(projects, {
    mode: source,
    minQuantity: minimum,
    newestYear: orders ? year : histYear ? Number(histYear) : null,
    minRevenue: Number(minRevenue) || 0,
    series: seriesFilter,
    city: cityFilter,
    minPriority: Number(minPriority) || 0,
  }).filter((p) => matchesOwner(p) && matchesSearch(p));
  const cities = [...new Set(projects.filter((p) => Number(p.historyLines) > 0 && p.city).map((p) => String(p.city)))].sort((a, b) => a.localeCompare(b, "nl"));
  const shown = base.filter((p) => mode === "Alle" || evaluateLead(p).stage === mode);
  const counts = new Map<string, number>();
  for (const p of base) {
    const s = evaluateLead(p).stage;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const visibleIds = shown.slice(0, 150).map((p) => p.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checked.includes(id));
  async function bulk(data: Record<string, unknown>, success: string) {
    if (await mutate("bulk", "", { ids: checked, ...data }, success)) setChecked([]);
  }
  return (
    <>
      <p className="notice">
        Dit is een <strong>onderzoeks- en belvoorbereidingslijst</strong>, geen lijst
        met bewezen bestaande installaties.{" "}
        {orders
          ? "Aantallen betreffen historische orderregels van bekende artikelreeksen, geen meters of geleverde hoeveelheden. Het oudste orderjaar is niet het installatiejaar."
          : "Projecthistorie is SAP-verkoop per boekjaar: geen ordernummers, leveringen of installatieomvang. Het eerste boekjaar is niet het installatiejaar."}
      </p>
      <section className="opportunity-head">
        <div>
          <p className="eyebrow">COMMERCIËLE WERKVOORRAAD</p>
          <h2>Van SAP-regel naar eerste gesprek</h2>
          <p className="subtitle">
            Filter de historische dossiers, verdeel ze over collega&apos;s, plan de eerste
            belactie en exporteer zo nodig een interne bellijst.
          </p>
        </div>
        <div className="opportunity-summary">
          <div><strong>{f(base.length)}</strong><span>Dossiers in selectie</span></div>
          <div><strong>{f(counts.get("Locatie controleren") ?? 0)}</strong><span>Locatie uitzoeken</span></div>
          <div><strong>{f(counts.get("Brononderzoek") ?? 0)}</strong><span>Brononderzoek</span></div>
          <div><strong>{f(counts.get("Contact voorbereiden") ?? 0)}</strong><span>Contact voorbereiden</span></div>
        </div>
      </section>
      <section>
        <div className="opportunity-controls">
          <label>Werkvoorraad
            <select value={source} onChange={(e) => { setSource(e.target.value as WorklistMode); setChecked([]); }}>
              {worklistModes.map((m) => (
                <option key={m} value={m} disabled={(m === "Renovatiekandidaten" && !hasCandidates) || (m === "Projecthistorie" && !hasHistory)}>
                  {modeLabel[m]}
                </option>
              ))}
            </select>
          </label>
          {orders ? (
            <>
              <label>Minimaal aantal historische stuks
                <input type="number" min="0" step="1" value={min} onChange={(e) => setMin(e.target.value)} />
              </label>
              <label>Oudste orderjaar uiterlijk
                <input type="number" min="1900" max="2100" value={maxYear} onChange={(e) => setMaxYear(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label>Eerste boekjaar uiterlijk
                <input type="number" min="1900" max="2100" value={histYear} placeholder="alle" onChange={(e) => setHistYear(e.target.value)} />
              </label>
              <label>Productreeks
                <select value={seriesFilter} onChange={(e) => setSeriesFilter(e.target.value)}>
                  <option value="">Alle reeksen</option>
                  {series.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>Projectplaats
                <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
                  <option value="">Alle plaatsen</option>
                  {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>Minimale net-net-omzet (export)
                <input type="number" min="0" step="1000" value={minRevenue} placeholder="0" onChange={(e) => setMinRevenue(e.target.value)} />
              </label>
              <label>Minimale prioriteit
                <input type="number" min="0" max="100" value={minPriority} placeholder="0" onChange={(e) => setMinPriority(e.target.value)} />
              </label>
            </>
          )}
          <label>Onderzoeksfase
            <select value={mode} onChange={(e) => setMode(e.target.value as (typeof modes)[number])}>
              {modes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Verantwoordelijke
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
              <option value="">Iedereen</option>
              <option value="__none__">Niet toegewezen</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label>Zoeken
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Project, plaats, debiteur…" />
          </label>
          <button
            className="primary"
            type="button"
            disabled={!shown.length}
            onClick={() => download("re-line-bellijst-intern.csv", exportLeadCsv(shown), "text/csv;charset=utf-8")}
          >
            Exporteer bellijst ({f(shown.length)})
          </button>
        </div>
        <div className="bulkbar" aria-label="Acties voor selectie">
          <strong>{checked.length} geselecteerd</strong>
          <OwnerInput id="kansen-owner" label="Toewijzen aan" owners={owners} value={owner} onChange={setOwner} />
          <button type="button" disabled={busy || !checked.length || !owner.trim()}
            onClick={() => bulk({ owner: owner.trim() }, `${checked.length} dossier(s) toegewezen aan ${owner.trim()}`)}>
            Toewijzen
          </button>
          <label>Belactie op
            <input type="date" value={planDue} onChange={(e) => setPlanDue(e.target.value)} min={today()} />
          </label>
          <label className="grow">Omschrijving belactie
            <input value={planNote} onChange={(e) => setPlanNote(e.target.value)} />
          </label>
          <button type="button" disabled={busy || !checked.length || !planNote.trim()}
            onClick={() => bulk({
              status: "Geselecteerd voor contact",
              statusFrom: ["Nieuw gevonden", "Nader onderzoeken"],
              ...(owner.trim() ? { owner: owner.trim() } : {}),
              plan: { kind: "Bellen", due: planDue || null, note: planNote.trim(), owner: owner.trim() },
            }, `Belactie gepland voor ${checked.length} dossier(s)`)}>
            Selecteren voor contact + belactie plannen
          </button>
        </div>
        <p className="subtitle">Aantallen en jaren zijn alleen een eerste schifting. De prioriteit is per criterium uitgelegd; bronvolledigheid staat er los van.</p>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead><tr>
              <th><input type="checkbox" aria-label="Selecteer alle zichtbare dossiers" checked={allChecked}
                onChange={() => setChecked(allChecked ? checked.filter((id) => !visibleIds.includes(id)) : [...new Set([...checked, ...visibleIds])])} /></th>
              <th>Project / bron</th><th>Plaats</th><th>{orders ? "Oudste order" : "Boekjaren"}</th>
              <th>{orders ? "Stuks (bron)" : "Omvang historische verkoop"}</th><th>Onderzoeksfase</th><th>Volgende stap</th>
              <th>Prioriteit — waarom</th><th>Bronvolledigheid</th><th>Verantwoordelijke / actie</th>
            </tr></thead>
            <tbody>
              {shown.slice(0, 150).map((p) => {
                const lead = evaluateLead(p);
                const all = priorityReasons(p);
                const reasons = all.filter((r) => r.points > 0).sort((a, b) => b.points - a.points);
                const gap = [...all].sort((a, b) => b.max - b.points - (a.max - a.points))[0];
                const bucket = dueBucket(p.nextDue);
                return <tr key={p.id}>
                  <td><input type="checkbox" aria-label={"Selecteer " + p.name} checked={checked.includes(p.id)}
                    onChange={() => setChecked(checked.includes(p.id) ? checked.filter((x) => x !== p.id) : [...checked, p.id])} /></td>
                  <td>
                    {p.candidate_rank ? <span className="badge">#{p.candidate_rank}</span> : null}{" "}
                    {!orders && renovationClass(p) ? <span className="badge" title={renovationClass(p)!.reden}>{renovationClass(p)!.klasse}</span> : null}{" "}
                    <button type="button" className="link" onClick={() => open(p.id)}>{p.name}</button>
                    {p.project_number ? <small className="reasons">SAP {p.project_number}</small> : null}
                  </td>
                  <td>{p.city || "Onbekend"}</td>
                  {orders ? (
                    <>
                      <td>{p.firstYear ?? "Onbekend"}</td>
                      <td>{f(p.quantity)}<small className="reasons">{p.orderCount ?? "?"} order{p.orderCount === 1 ? "" : "s"}</small></td>
                    </>
                  ) : (
                    <>
                      <td>{p.historyFirstYear ?? "Onbekend"}{p.historyLastYear && p.historyLastYear !== p.historyFirstYear ? `–${p.historyLastYear}` : ""}</td>
                      <td>{f(Math.round(Number(p.historyNetRevenue ?? 0)))}
                        <small className="reasons">net-net-omzet · afzet {f(Math.round(Number(p.historyQuantity ?? 0)))} · {p.series}</small></td>
                    </>
                  )}
                  <td><span className="badge">{lead.stage}</span></td>
                  <td>{lead.next}</td>
                  <td><strong>{p.priority}</strong>
                    <small className="reasons">{reasons.length ? reasons.slice(0, 2).map((r) => `${r.label} +${r.points}`).join(" · ") : "nog geen bevestigde factoren"}</small>
                    {gap && gap.max - gap.points > 0 ? <small className="reasons">lager door: {gap.label} {gap.points}/{gap.max} ({gap.detail})</small> : null}</td>
                  <td><span className="badge">{p.quality}% · {p.confidence ?? "Onbekend"}</span></td>
                  <td>{p.owner || "—"}
                    {p.openActions ? <small className={"reasons" + (bucket === "Achterstallig" ? " overdue" : "")}>
                      {p.openActions} open · {p.nextDue ? `${bucket.toLowerCase()} (${p.nextDue})` : "zonder datum"}</small> : null}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {!shown.length && <p className="empty">Geen projecten bij deze selectie. Pas de filters aan.</p>}
        {shown.length > 150 && <p className="notice">
          Voor de leesbaarheid staan hier de eerste 150 dossiers op historische aantallen.
          De download bevat alle {f(shown.length)} dossiers uit deze selectie.
        </p>}
      </section>
    </>
  );
}
