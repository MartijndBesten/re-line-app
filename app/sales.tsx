"use client";
import { useState } from "react";
import { pipelinePhases } from "@/lib/domain";
import { buckets, workItems } from "@/lib/worklist";
import { Table, fmt, type Mutate, type Open, type Snapshot } from "./ui";

/** Salesopvolging: persoonlijke werkvoorraad, pipeline per fase en recente gesprekken. */
export function SalesDesk({
  snap,
  open,
  mutate,
  busy,
}: {
  snap: Snapshot;
  open: Open;
  mutate: Mutate;
  busy: boolean;
}) {
  // Ingelogd: standaard de eigen werkvoorraad.
  const [owner, setOwner] = useState(snap.me && snap.owners.includes(snap.me.name) ? snap.me.name : "");
  const [phase, setPhase] = useState("");
  const items = workItems(snap.activities as never, { owner: owner || undefined });
  const count = (b: string) => items.filter((i) => i.bucket === b).length;
  const calls = snap.activities
    .filter((a) => a.kind === "Gespreksverslag" && (!owner || a.owner === owner))
    .sort((a, b) => String(b.created).localeCompare(String(a.created)))
    .slice(0, 15);
  const nextDue = new Map(snap.projects.map((p) => [p.id, p.nextDue]));
  return (
    <>
      <section className="filters compact-filters">
        <label>
          Werkvoorraad van
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Iedereen</option>
            <option value="__none__">Niet toegewezen</option>
            {snap.owners.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
      </section>
      <div className="stats compact">
        {buckets.map((b) => (
          <div key={b} className={b === "Achterstallig" && count(b) ? "alert-stat" : ""}>
            <span>{b}</span>
            <strong>{count(b)}</strong>
          </div>
        ))}
      </div>
      <section>
        <h2>Werkvoorraad</h2>
        <p>
          Open belacties, afspraken en vervolgacties. Achterstallige acties blijven bovenaan
          staan tot ze zijn afgerond. Een gezamenlijke afspraak met één relatie over meerdere
          locaties staat als één regel.
        </p>
        <Table
          label="Werkvoorraad"
          headers={["Wanneer", "Datum", "Project", "Actie", "Verantwoordelijke", "Contact", "Notitie", "Gesprek", "Afronden"]}
        >
          {items.map((a) => (
            <tr key={a.id} className={a.bucket === "Achterstallig" ? "overdue" : ""}>
              <td><span className="badge">{a.bucket}</span></td>
              <td>{fmt(a.due)}</td>
              <td>
                {a.projects.length === 1 ? (
                  <button className="link" onClick={() => open(a.projects[0].id)}>
                    {a.projects[0].name}
                  </button>
                ) : (
                  <details>
                    <summary>{a.projects.length} dossiers (gezamenlijk)</summary>
                    {a.projects.map((p) => (
                      <p key={p.id}>
                        <button className="link" onClick={() => open(p.id)}>{p.name}</button>
                      </p>
                    ))}
                  </details>
                )}
              </td>
              <td>{a.kind}</td>
              <td>{fmt(a.owner)}</td>
              <td>{fmt(a.contact)}</td>
              <td>{a.note}</td>
              <td>
                <button type="button" onClick={() => open(a.projects[0].id, "Gesprek")}>
                  Gesprek registreren
                </button>
              </td>
              <td>
                <button
                  disabled={busy}
                  onClick={() =>
                    mutate("complete", a.id, { done: true, group: a.group }, "Actie afgerond")
                  }
                >
                  Afronden
                </button>
              </td>
            </tr>
          ))}
        </Table>
        {!items.length && <p className="empty">Geen open acties{owner ? " voor deze selectie" : ""}.</p>}
      </section>
      <section>
        <h2>Pipeline</h2>
        <p className="subtitle">Klik op een fase om ook de lege statussen te zien.</p>
        <div className="pipeline">
          {pipelinePhases.map((ph) => {
            const list = snap.projects.filter((p) => ph.statuses.includes(p.status) && (!owner || (owner === "__none__" ? !p.owner : p.owner === owner)));
            return (
              <button
                type="button"
                key={ph.name}
                className={phase === ph.name ? "active" : ""}
                onClick={() => setPhase(phase === ph.name ? "" : ph.name)}
              >
                <span>{ph.name}</span>
                <strong>{list.length}</strong>
              </button>
            );
          })}
        </div>
        {pipelinePhases
          .filter((ph) => !phase || ph.name === phase)
          .map((ph) =>
            ph.statuses.map((s) => {
              const list = snap.projects.filter((p) => p.status === s && (!owner || (owner === "__none__" ? !p.owner : p.owner === owner)));
              if (!list.length && phase !== ph.name) return null;
              return (
                <details key={s} open={!!phase && list.length > 0 && list.length <= 25}>
                  <summary>
                    {ph.name} · {s} <span className="badge">{list.length}</span>
                  </summary>
                  {list.map((p) => (
                    <p key={p.id}>
                      <button className="link" onClick={() => open(p.id)}>{p.name}</button>{" "}
                      · {fmt(p.city)} · {fmt(p.owner)}
                      {nextDue.get(p.id) ? ` · volgende actie ${nextDue.get(p.id)}` : ""}
                    </p>
                  ))}
                </details>
              );
            }),
          )}
      </section>
      <section>
        <h2>Recente gesprekken</h2>
        <Table label="Recente gesprekken" headers={["Datum", "Project", "Contact", "Uitkomst", "Samenvatting"]}>
          {calls.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.created).toLocaleDateString("nl-NL")}</td>
              <td>
                <button className="link" onClick={() => open(a.project_id, "Gesprek")}>{a.projectName}</button>
              </td>
              <td>{fmt(a.contact)}{a.contact_role ? ` (${a.contact_role})` : ""}</td>
              <td>{fmt(a.outcome || a.result)}</td>
              <td>{a.note}</td>
            </tr>
          ))}
        </Table>
        {!calls.length && <p className="empty">Nog geen gespreksverslagen.</p>}
      </section>
    </>
  );
}
