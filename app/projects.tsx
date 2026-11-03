"use client";
import { useState } from "react";
import { statuses } from "@/lib/domain";
import { Empty, Input, ProjectTable, Select, type Mutate, type Open, type Snapshot } from "./ui";

const emptyFilter = {
  search: "",
  city: "",
  family: "",
  status: "",
  minYear: "",
  maxYear: "",
  minQty: "",
  minMeters: "",
  installer: "",
  location: "",
  priority: "",
  minQuality: "",
  selection: "",
  owner: "",
  minRevenue: "",
  candidates: "",
};
/** Volledige projectlijst: zoeken, filteren, selecties bewaren en dossiers samenvoegen. */
export function ProjectsDesk({
  snap,
  open,
  mutate,
  busy,
  go,
}: {
  snap: Snapshot;
  open: Open;
  mutate: Mutate;
  busy: boolean;
  go: (tab: string) => void;
}) {
  const [filter, setFilter] = useState(emptyFilter);
  const [sort, setSort] = useState("priority");
  const [checked, setChecked] = useState<string[]>([]);
  const [selectionName, setSelectionName] = useState("");
  const setF = (k: keyof typeof emptyFilter, v: string) => setFilter({ ...filter, [k]: v });
  const selectedSet = filter.selection
    ? (JSON.parse(snap.selections.find((s) => s.id === filter.selection)?.project_ids ?? "[]") as string[])
    : null;
  const projects = snap.projects
    .filter(
      (p) =>
        (!filter.search ||
          [p.name, p.city, p.debtors, p.end_user, p.project_number, p.series]
            .join(" ")
            .toLowerCase()
            .includes(filter.search.toLowerCase())) &&
        (!filter.city || String(p.city).toLowerCase().includes(filter.city.toLowerCase())) &&
        (!filter.family ||
          String(p.families ?? "").includes(filter.family) ||
          String(p.series ?? "").split(",").includes(filter.family)) &&
        (!filter.status || p.status === filter.status) &&
        (!filter.owner || (filter.owner === "__none__" ? !p.owner : p.owner === filter.owner)) &&
        (!filter.minYear || (p.oldestYear != null && p.oldestYear >= Number(filter.minYear))) &&
        (!filter.maxYear || (p.oldestYear != null && p.oldestYear <= Number(filter.maxYear))) &&
        (!filter.minRevenue || Number(p.historyNetRevenue ?? 0) >= Number(filter.minRevenue)) &&
        (!filter.candidates ||
          (filter.candidates === "Renovatiekandidaten" ? p.candidate_rank != null : p.candidate_rank == null)) &&
        (!filter.minQty || p.quantity >= Number(filter.minQty)) &&
        (!filter.minMeters || (p.meters !== null && p.meters >= Number(filter.minMeters))) &&
        (!filter.installer ||
          String(p.installerNames ?? "").toLowerCase().includes(filter.installer.toLowerCase())) &&
        (!filter.location || (filter.location === "Bekend" ? !!p.location_confirmed : !p.location_confirmed)) &&
        (!filter.priority ||
          (filter.priority === "Hoog"
            ? p.priority >= 60
            : filter.priority === "Middel"
              ? p.priority >= 30 && p.priority < 60
              : p.priority < 30)) &&
        (!filter.minQuality || p.quality >= Number(filter.minQuality)) &&
        (!selectedSet || selectedSet.includes(p.id)),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "oldestYear"
          ? (a.oldestYear ?? 9999) - (b.oldestYear ?? 9999)
          : sort === "candidate_rank"
            ? (a.candidate_rank ?? 9999) - (b.candidate_rank ?? 9999)
            : (b[sort] ?? -1) - (a[sort] ?? -1),
    );
  const active = Object.values(filter).filter(Boolean).length;
  return (
    <>
      <section className="filters">
        <Input label="Zoeken" placeholder="Project, plaats, debiteur…" value={filter.search} onChange={(e) => setF("search", e.target.value)} />
        <Input label="Plaats / regio" value={filter.city} onChange={(e) => setF("city", e.target.value)} />
        <Select label="Productfamilie / reeks" emptyLabel="Alle" options={["", "E-Line", "C-Line", "Overig", ...(snap.historySeries ?? [])]} value={filter.family} onChange={(e) => setF("family", e.target.value)} />
        <Select label="Werkvoorraad" emptyLabel="Alle dossiers" options={["", "Renovatiekandidaten", "Overige dossiers"]} value={filter.candidates} onChange={(e) => setF("candidates", e.target.value)} />
        <Select label="Salesstatus" emptyLabel="Alle" options={["", ...statuses]} value={filter.status} onChange={(e) => setF("status", e.target.value)} />
        <label>
          Verantwoordelijke
          <select aria-label="Verantwoordelijke" value={filter.owner} onChange={(e) => setF("owner", e.target.value)}>
            <option value="">Alle</option>
            <option value="__none__">Niet toegewezen</option>
            {snap.owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <Input type="number" label="Oudste jaar vanaf (order of boekjaar)" value={filter.minYear} onChange={(e) => setF("minYear", e.target.value)} />
        <Input type="number" label="Oudste jaar tot (order of boekjaar)" value={filter.maxYear} onChange={(e) => setF("maxYear", e.target.value)} />
        <Input type="number" label="Minimaal aantal" value={filter.minQty} onChange={(e) => setF("minQty", e.target.value)} />
        <Input type="number" label="Minimale omzet projecthistorie" value={filter.minRevenue} onChange={(e) => setF("minRevenue", e.target.value)} />
        <Input type="number" label="Minimaal bevestigde meters" value={filter.minMeters} onChange={(e) => setF("minMeters", e.target.value)} />
        <Input label="Installateur (bevestigde koppeling)" value={filter.installer} onChange={(e) => setF("installer", e.target.value)} />
        <Select label="Bevestigde locatie" emptyLabel="Alle" options={["", "Bekend", "Onbekend"]} value={filter.location} onChange={(e) => setF("location", e.target.value)} />
        <Select label="Prioriteit" emptyLabel="Alle" options={["", "Hoog", "Middel", "Laag"]} value={filter.priority} onChange={(e) => setF("priority", e.target.value)} />
        <Input type="number" label="Minimale datakwaliteit (%)" value={filter.minQuality} onChange={(e) => setF("minQuality", e.target.value)} />
        <label>
          Opgeslagen selectie
          <select aria-label="Opgeslagen selectie" value={filter.selection} onChange={(e) => setF("selection", e.target.value)}>
            <option value="">Alle projecten</option>
            {snap.selections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label>
          Sorteren op
          <select aria-label="Sorteren op" value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries({
              priority: "Prioriteit",
              candidate_rank: "Rang renovatiekandidaat",
              historyNetRevenue: "Omzet projecthistorie",
              quantity: "Historische aantallen",
              meters: "Bevestigde meters",
              oldestYear: "Oudste jaar",
              name: "Projectnaam",
            }).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        {active > 0 && (
          <button type="button" onClick={() => setFilter(emptyFilter)}>
            Filters wissen ({active})
          </button>
        )}
      </section>
      <div className="toolbar">
        <strong>
          {projects.length} projecten · {checked.length} geselecteerd
        </strong>
        <Input label="Selectienaam" value={selectionName} onChange={(e) => setSelectionName(e.target.value)} />
        <button
          disabled={busy || !checked.length || !selectionName}
          onClick={() => mutate("selection", "", { name: selectionName, ids: checked }, "Selectie opgeslagen")}
        >
          Selectie bewaren
        </button>
        {(!snap.me || snap.me.role === "beheerder") && <button
          disabled={busy || checked.length < 2}
          onClick={async () => {
            if (
              confirm(
                "Samenvoegen in het eerst geselecteerde project? Historische regels, notities en eerdere dossiergegevens blijven bewaard.",
              ) &&
              (await mutate("merge", checked[0], { ids: checked }, "Projecten samengevoegd"))
            )
              setChecked([]);
          }}
        >
          Samenvoegen ({checked.length})
        </button>}
      </div>
      <ProjectTable
        projects={projects}
        open={open}
        checked={checked}
        check={(id) => setChecked(checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id])}
      />
      {!snap.projects.length && <Empty onImport={() => go("Import")} />}
    </>
  );
}
