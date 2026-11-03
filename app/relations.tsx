"use client";
import { useState } from "react";
import { relationRoles } from "@/lib/domain";
import { Input, Select, Table, Text, fmt, type Mutate, type Snapshot } from "./ui";

const blank = { id: "", name: "", number: "", role: "Installateur", contact: "", notes: "", projectId: "" };
/** Relatiebeheer: rollen controleren, contactgegevens en koppelingen aan dossiers. */
export function RelationsDesk({ snap, mutate, busy }: { snap: Snapshot; mutate: Mutate; busy: boolean }) {
  const [relation, setRelation] = useState<Record<string, string>>(blank);
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const list = snap.relations.filter(
    (r) => (!role || r.role === role) && (!search || r.name.toLowerCase().includes(search.toLowerCase())),
  );
  return (
    <>
      <section>
        <h2>Relatienetwerk</h2>
        <p>
          Een SAP-debiteur is niet automatisch een installateur of eindgebruiker. Pas de rol
          alleen aan met gecontroleerde informatie. Dezelfde partij kan met verschillende rollen
          voorkomen; de historische rol blijft dan apart zichtbaar.
        </p>
        <div className="filters compact-filters">
          <Select label="Filter op rol" emptyLabel="Alle" options={["", ...relationRoles]} value={role} onChange={(e) => setRole(e.target.value)} />
          <Input label="Relatie zoeken" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Table label="Relaties" headers={["Naam", "Rol", "Nummer", "Dossiers", "Contact", "Bewerken"]}>
          {list.slice(0, 300).map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.role}</td>
              <td>{fmt(r.number)}</td>
              <td>{r.projectCount}</td>
              <td>{fmt(r.contact)}</td>
              <td>
                <button onClick={() => setRelation({ ...blank, id: r.id, name: r.name, number: String(r.number ?? ""), role: r.role, contact: String(r.contact ?? ""), notes: String(r.notes ?? "") })}>Bewerken</button>
              </td>
            </tr>
          ))}
        </Table>
        {list.length > 300 && <p className="subtitle">Eerste 300 relaties zichtbaar; verfijn de zoekopdracht.</p>}
      </section>
      <section>
        <h2>{relation.id ? "Relatie bewerken" : "Relatie toevoegen"}</h2>
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await mutate("relation", relation.id, relation)) setRelation(blank);
          }}
        >
          <Input label="Relatienaam" required value={relation.name} onChange={(e) => setRelation({ ...relation, name: e.target.value })} />
          <Select label="Rol" options={relationRoles} value={relation.role} onChange={(e) => setRelation({ ...relation, role: e.target.value })} />
          <Input
            label="Relatienummer"
            value={relation.number}
            disabled={!!relation.id}
            onChange={(e) => setRelation({ ...relation, number: e.target.value })}
          />
          <Input label="Contactpersoon" value={relation.contact} onChange={(e) => setRelation({ ...relation, contact: e.target.value })} />
          <label>
            Project koppelen
            <select aria-label="Project koppelen" value={relation.projectId} onChange={(e) => setRelation({ ...relation, projectId: e.target.value })}>
              <option value="">Geen extra koppeling</option>
              {snap.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <Text label="Relatienotities" value={relation.notes} onChange={(e) => setRelation({ ...relation, notes: e.target.value })} />
          <button className="primary" disabled={busy}>Relatie opslaan</button>
          <button type="button" onClick={() => setRelation(blank)}>Nieuw formulier</button>
        </form>
      </section>
    </>
  );
}
