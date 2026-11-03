"use client";
import { pipelinePhases } from "@/lib/domain";
import { workItems } from "@/lib/worklist";
import { Empty, ProjectTable, Table, fmt, type Open, type Snapshot } from "./ui";

/** Startscherm: wat is er gedaan, wat moet vandaag gebeuren en waar zitten de kansen. */
export function Dashboard({
  snap,
  open,
  go,
}: {
  snap: Snapshot;
  open: Open;
  go: (tab: string) => void;
}) {
  const unclassified = snap.catalog.filter((c) => !c.confirmed).length;
  const assigned = snap.projects.filter((p) => p.owner).length;
  const calls = snap.activities.filter((a) => a.kind === "Gespreksverslag").length;
  const steps = [
    {
      done: snap.imports.length > 0,
      title: "Historische data importeren",
      text: snap.imports.length
        ? `${snap.imports.length} import(s), ${snap.projects.length} voorlopige dossiers.`
        : "Importeer de Product Finder- of SAP-export.",
      tab: "Import",
      admin: true,
    },
    {
      done: (snap.catalog.length > 0 && unclassified === 0) || (!snap.catalog.length && snap.dashboard.historyProjects > 0),
      title: "Artikelen classificeren",
      text: unclassified
        ? `${unclassified} artikel(en) nog niet bevestigd. Tot die tijd tellen ze niet mee als E-/C-Line in de prioriteit.`
        : snap.catalog.length
          ? "Alle artikelen hebben een bevestigde classificatie met bron."
          : snap.dashboard.historyProjects
            ? "Projecthistorie gebruikt de productreeks volgens SAP; classificeren is alleen nodig voor orderregels."
            : "Nog geen artikelen geïmporteerd.",
      tab: "Instellingen",
      admin: true,
    },
    {
      done: assigned > 0,
      title: "Werkvoorraad verdelen",
      text: assigned
        ? `${assigned} dossier(s) hebben een verantwoordelijke.`
        : "Selecteer kansen en wijs ze toe aan een collega.",
      tab: "Kansen",
    },
    {
      done: calls > 0,
      title: "Gesprekken registreren",
      text: calls
        ? `${calls} gespreksverslag(en) vastgelegd.`
        : "Bel de eerste kansen en leg uitkomst en antwoorden vast in het dossier.",
      tab: "Salesopvolging",
    },
  ];
  // Importeren en classificeren doet de beheerder; een collega ziet alleen de stappen die hij zelf kan zetten.
  const admin = !snap.me || snap.me.role === "beheerder";
  const visible = steps.filter((s) => admin || !("admin" in s && s.admin));
  const items = workItems(snap.activities as never);
  const urgent = items.filter((i) => i.bucket === "Achterstallig" || i.bucket === "Vandaag");
  return (
    <>
      <section className="onboarding" aria-label="Aan de slag">
        <h2>Aan de slag</h2>
        <ol className="steps">
          {visible.map((s, i) => (
            <li key={s.title} className={s.done ? "done" : ""}>
              <span className="step-no" aria-hidden>
                {s.done ? "✓" : i + 1}
              </span>
              <div>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
              </div>
              <button type="button" onClick={() => go(s.tab)}>
                Naar {s.tab}
              </button>
            </li>
          ))}
        </ol>
      </section>
      <div className="stats">
        {Object.entries({
          projects: "Projecten",
          historyProjects: "Met projecthistorie",
          candidates: "Renovatiekandidaten",
          potential: "Potentiële kansen",
          research: "Te onderzoeken",
          selected: "Geselecteerd",
          calls: "Open belacties",
          appointments: "Afspraken",
          ongoing: "Renovatietrajecten",
        }).map(([k, label]) => (
          <div key={k}>
            <span>{label}</span>
            <strong>{snap.dashboard[k]}</strong>
          </div>
        ))}
      </div>
      <p className="notice">
        Potentiële kansen = historische orders of verkoop (boekjaar) van ten minste tien jaar oud,
        zonder bevestigde vervanging of afgesloten traject. Dit bewijst geen
        installatie of renovatiebehoefte.
      </p>
      <div className="columns">
        <section>
          <h2>Vandaag en achterstallig</h2>
          {!urgent.length && <p>Geen achterstallige of vandaag geplande acties.</p>}
          {urgent.slice(0, 8).map((i) => (
            <p key={i.id} className={i.bucket === "Achterstallig" ? "overdue" : ""}>
              <span className="badge">{i.bucket}</span>{" "}
              <button className="link" onClick={() => open(i.projects[0].id, "Gesprek")}>
                {i.projects.length > 1 ? `${i.projects.length} dossiers` : i.projects[0].name}
              </button>{" "}
              · {i.kind} · {fmt(i.owner)}
            </p>
          ))}
          {urgent.length > 8 && (
            <button type="button" onClick={() => go("Salesopvolging")}>
              Alle {urgent.length} acties
            </button>
          )}
        </section>
        <section>
          <h2>Pipeline</h2>
          <Table headers={["Fase", "Dossiers"]}>
            {pipelinePhases.map((ph) => (
              <tr key={ph.name}>
                <td>{ph.name}</td>
                <td>{snap.projects.filter((p) => ph.statuses.includes(p.status)).length}</td>
              </tr>
            ))}
          </Table>
        </section>
      </div>
      {snap.dashboard.candidates > 0 && (
        <section aria-label="Renovatiekandidaten">
          <h2>Renovatiekandidaten (top {snap.dashboard.candidates})</h2>
          <p>
            Vaste werkvoorraad uit de projecthistorie, gekozen op ouderdom, oudere E-Line-reeks, omvang van de
            historische verkoop, herkenbaarheid, relatiegegevens en meerdere projecten per klant. In ieder dossier
            staat per criterium waarom het hoog of laag scoort.
            {snap.candidateSelection ? ` Bepaald op ${new Date(snap.candidateSelection.created).toLocaleDateString("nl-NL")} uit ${snap.candidateSelection.considered} dossiers.` : ""}
          </p>
          <ProjectTable
            projects={snap.projects.filter((p) => p.candidate_rank != null).sort((a, b) => Number(a.candidate_rank) - Number(b.candidate_rank)).slice(0, 8)}
            open={open}
          />
          <button type="button" onClick={() => go("Kansen")}>
            Alle {snap.dashboard.candidates} renovatiekandidaten in Kansen
          </button>
        </section>
      )}
      <section>
        <h2>Grootste gevonden aantallen</h2>
        <ProjectTable
          projects={[...snap.projects].sort((a, b) => b.quantity - a.quantity).slice(0, 8)}
          open={open}
        />
        {!snap.projects.length && <Empty onImport={() => go("Import")} />}
      </section>
      <div className="columns">
        <section>
          <h2>Oudste bekende jaar (order of boekjaar)</h2>
          <Table headers={["Jaar", "Projecten"]}>
            {grouped(snap, "oldestYear").map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </Table>
        </section>
        <section>
          <h2>Productfamilies</h2>
          <p>Alleen bevestigde classificaties. Een project kan meerdere families bevatten.</p>
          <Table headers={["Familie", "Projecten"]}>
            {grouped(snap, "families").map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </Table>
          {snap.dashboard.historyProjects > 0 && (
            <>
              <h3>Productreeksen projecthistorie (volgens SAP)</h3>
              <Table headers={["Reeks", "Projecten"]}>
                {grouped({ ...snap, projects: snap.projects.filter((p) => Number(p.historyLines) > 0) }, "series").map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </Table>
            </>
          )}
        </section>
      </div>
    </>
  );
}
function grouped(snap: Snapshot, key: "oldestYear" | "families" | "series") {
  return Object.entries(
    snap.projects.reduce((acc: Record<string, number>, p) => {
      const vals =
        key === "families" || key === "series"
          ? p[key]
            ? String(p[key]).split(",")
            : ["Onbekend"]
          : [p.oldestYear != null ? String(p.oldestYear) : "Onbekend"];
      for (const v of vals) acc[v] = (acc[v] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => a[0].localeCompare(b[0]));
}
