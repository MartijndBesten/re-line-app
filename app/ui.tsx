"use client";
import type { ReactNode } from "react";
import type { defaultWeights } from "@/lib/domain";
import type { LeadInput } from "@/lib/opportunities";
import type {
  BriefProject,
  HistoricLine,
  PortfolioLink,
  PortfolioProject,
  PortfolioRelation,
} from "@/lib/commercial";
import type { ScenarioRecord } from "@/lib/proposal";
import type { Mapping } from "@/lib/profiles";

export type Row = Record<string, any>;
// Velden die de API (lib/db.ts projects()/dossier()/snapshot()) altijd meelevert.
export type ProjectRow = Row & LeadInput & PortfolioProject;
export type RelationRow = Row & PortfolioRelation;
export type Dossier = ProjectRow &
  Omit<BriefProject, "lines" | "activities"> & {
    lines: (Row & HistoricLine)[];
    /** Projecthistorie (SAP-verkoop per boekjaar); leeg als het dossier alleen orderregels heeft. */
    history: Row[];
    activities: Row[];
    relations: RelationRow[];
    scenarios: ScenarioRecord[];
  };
export type Snapshot = {
  projects: ProjectRow[];
  activities: Row[];
  relations: RelationRow[];
  relationProjects: PortfolioLink[];
  catalog: Row[];
  imports: Row[];
  selections: Row[];
  profiles: { id: string; name: string; notes: string; created: string; mapping: Mapping }[];
  owners: string[];
  backups: { name: string; size: number; created: string }[];
  schemaVersion: number;
  historySeries: string[];
  /** Ingelogde gebruiker (null in de lokale versie zonder inloggen). */
  me: { id: string; name: string; role: "beheerder" | "gebruiker"; provider: string } | null;
  authMode: "uit" | "lokaal" | "entra" | "email";
  database: "sqlite" | "postgres";
  users: Row[];
  candidateSelection: { n: number; selected: number; considered: number; created: string; selection: string } | null;
  weights: typeof defaultWeights;
  audit: Row[];
  dashboard: Record<string, number>;
};
export type Mutate = (
  action: string,
  id?: string,
  data?: Row,
  success?: string,
) => Promise<Row | null>;
export type Open = (id: string, view?: DossierView) => void;
export const dossierViews = ["Overzicht", "Gesprek", "Bron & orders", "Relaties", "Scenario's"] as const;
export type DossierView = (typeof dossierViews)[number];

export const fmt = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "Onbekend"
    : typeof v === "number"
      ? v.toLocaleString("nl-NL")
      : String(v);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function download(name: string, text: string, type = "text/plain;charset=utf-8") {
  // Alleen na een bewuste klik; er wordt niets naar een externe dienst gestuurd.
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
export function Values({ items }: { items: Record<string, unknown> }) {
  return (
    <dl>
      {Object.entries(items).map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>
            {k.toLowerCase().includes("jaar") && typeof v === "number"
              ? String(v)
              : fmt(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function Table({
  headers,
  children,
  label,
}: {
  headers: string[];
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={label ? 0 : undefined}>
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Input({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label>
      {label}
      <input aria-label={label} {...props} />
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}
export function Select({
  label,
  options,
  emptyLabel = "Onbekend",
  ...props
}: {
  label: string;
  options: string[];
  emptyLabel?: string;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label>
      {label}
      <select aria-label={label} {...props}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o || emptyLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Text({
  label,
  ...props
}: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="wide">
      {label}
      <textarea aria-label={label} {...props} />
    </label>
  );
}
/** Keuzelijst met bestaande namen plus vrije invoer (verantwoordelijke medewerker). */
export function OwnerInput({
  label,
  owners,
  value,
  onChange,
  id,
}: {
  label: string;
  owners: string[];
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  return (
    <label>
      {label}
      <input aria-label={label} list={id} value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>
        {owners.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </label>
  );
}
export function Empty({ onImport }: { onImport: () => void }) {
  return (
    <div className="empty">
      <h3>Begin met je historische bronlijst</h3>
      <p>
        Er staan nog geen projectgegevens in de database. Importeer een export;
        er wordt geen demo-klantdata toegevoegd.
      </p>
      <button className="primary" onClick={onImport}>
        Naar import
      </button>
    </div>
  );
}
export function ProjectTable({
  projects,
  open,
  checked,
  check,
}: {
  projects: ProjectRow[];
  open: Open;
  checked?: string[];
  check?: (id: string) => void;
}) {
  return (
    <Table
      label="Projecten"
      headers={[
        ...(check ? ["Selectie"] : []),
        "Project",
        "Plaats",
        "Familie / reeks",
        "Oudste jaar",
        "Laatste jaar",
        "Regels",
        "Artikelen",
        "Relevant",
        "Meters",
        "Omzet projecthistorie",
        "Debiteur / installateur",
        "Eindgebruiker",
        "Datakwaliteit",
        "Prioriteit",
        "Salesstatus",
        "Verantwoordelijke",
      ]}
    >
      {projects.map((p) => (
        <tr key={p.id}>
          {check && (
            <td>
              <input
                type="checkbox"
                aria-label={"Selecteer " + p.name}
                checked={checked?.includes(p.id) ?? false}
                onChange={() => check(p.id)}
              />
            </td>
          )}
          <td>
            <button className="link" onClick={() => open(p.id)}>
              {p.name}
            </button>
          </td>
          <td>{fmt(p.city)}</td>
          <td>{fmt(p.families || p.series)}</td>
          <td>{p.oldestYear === null || p.oldestYear === undefined ? "Onbekend" : String(p.oldestYear)}</td>
          <td>{p.latestYear === null || p.latestYear === undefined ? "Onbekend" : String(p.latestYear)}</td>
          <td>{p.lineCount}{Number(p.historyLines) ? ` + ${p.historyLines} hist.` : ""}</td>
          <td>{fmt(p.quantity)}</td>
          <td>{fmt(p.relevantQuantity)}</td>
          <td>{fmt(p.meters)}</td>
          <td>{Number(p.historyLines) ? Math.round(Number(p.historyNetRevenue)).toLocaleString("nl-NL") : "—"}</td>
          <td>{fmt(p.installerNames || p.debtors)}</td>
          <td>{fmt(p.end_user)}</td>
          <td>
            <span className="badge">
              {p.quality}% · {p.confidence}
            </span>
          </td>
          <td>
            {p.priority}
            {p.candidate_rank ? <small className="reasons">kandidaat #{p.candidate_rank}</small> : null}
          </td>
          <td>
            <span className="badge">{p.status}</span>
          </td>
          <td>{fmt(p.owner)}</td>
        </tr>
      ))}
    </Table>
  );
}
