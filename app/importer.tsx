"use client";
import { useState } from "react";
import { fields, type Field, type Preview } from "@/lib/domain";
import { sapGermanExpected } from "@/lib/profiles";
import { Table, Values, fmt, type Row, type Snapshot } from "./ui";

type ImportPreview = Preview & {
  totalRows: number;
  newRows: number;
  duplicates: number;
  conflicts: string[];
  sha256: string;
  previousImports: Row[];
  profile: string | null;
  clusters: { newProjects: number; existingProjects: number; byConfidence: Record<string, number> };
  lineStates: Record<string, number>;
  notCounted: number;
  missingExpected: { field: Field; label: string; need: string }[];
};
async function post(body: FormData | string) {
  const res = await fetch("/api/workbench", {
    method: "POST",
    ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}),
    body,
  });
  const json = await res.json();
  if (!res.ok) throw Error(json.error || "Verzoek mislukt");
  return json;
}
/** Import in drie stappen: bestand kiezen, koppeling en gevolgen controleren, bevestigen. */
export function ImportDesk({
  snap,
  refresh,
  setMessage,
  setError,
  busy,
  setBusy,
}: {
  snap: Snapshot;
  refresh: () => Promise<void>;
  setMessage: (m: string) => void;
  setError: (m: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [historyPreview, setHistoryPreview] = useState<Row | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<Field, string>>>({});
  const [dirty, setDirty] = useState(false);
  const [profileName, setProfileName] = useState("");
  async function inspect(commit = false, remap = false) {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      if (remap || commit) form.set("mapping", JSON.stringify(mapping));
      if (commit) {
        form.set("commit", "true");
        form.set("profile", preview?.profile ?? "");
      }
      const result = await post(form);
      if (result.kind === "projecthistorie") {
        if (commit) {
          setMessage(
            `${result.added} historieregels opgeslagen; ${result.updated ?? 0} bijgewerkt; ${result.duplicates} dubbelen overgeslagen; ${result.newProjects} nieuwe dossiers.` +
              (result.selection ? ` Werkvoorraad: ${result.selection.selected} renovatiekandidaten bepaald (zie Kansen).` : "") +
              (result.backup ? ` Back-up vooraf: ${result.backup}.` : ""),
          );
          setHistoryPreview(null);
          await refresh();
        } else {
          setHistoryPreview(result);
          setPreview(null);
        }
        return;
      }
      setHistoryPreview(null);
      if (commit) {
        setMessage(`${result.added} nieuwe regels opgeslagen; ${result.duplicates} dubbelen overgeslagen.`);
        setPreview(null);
        await refresh();
      } else {
        setPreview(result);
        setMapping(result.mapping);
        setDirty(false);
        if (result.profile) setProfileName(result.profile);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveProfile() {
    setBusy(true);
    setError("");
    try {
      await post(JSON.stringify({ action: "profile", data: { name: profileName, mapping } }));
      setMessage(`Importprofiel "${profileName}" opgeslagen; het wordt automatisch gebruikt bij bestanden met dezelfde kolommen.`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section>
        <h2>Historische data importeren</h2>
        <ol className="howto">
          <li>Kies een CSV, XLSX (eerste werkblad) of Markdown-tabel en bekijk het voorbeeld. Er wordt dan nog niets opgeslagen. Een SAP-projectrapport (blad met Projektnummer, Geschäftsjahr, Absatz en Umsatz) wordt herkend als projecthistorie.</li>
          <li>Controleer de veldkoppeling, de fouten en wat de import met de dossiers doet.</li>
          <li>Bevestig de import. Dubbele bronregels worden overgeslagen; bestaande notities blijven onaangetast.</li>
        </ol>
        <p>
          Verplicht: ordernummer, artikelcode en aantal. Maximaal 15 MB / 20.000 regels. De
          originele velden blijven bij iedere bronregel bewaard; het bestand zelf wordt niet
          gekopieerd. Bewaar het origineel op goedgekeurde opslag.
        </p>
        <label>
          Bronbestand
          <input
            type="file"
            accept=".csv,.xlsx,.md,.markdown"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setHistoryPreview(null);
              setMapping({});
            }}
          />
        </label>
        <button className="primary" disabled={!file || busy} onClick={() => inspect()}>
          Voorbeeld bekijken
        </button>
        {historyPreview && (
          <section aria-label="Voorbeeld projecthistorie">
            <h3>Projecthistorie herkend (blad &quot;{historyPreview.sheet}&quot;)</h3>
            <p className="notice">
              SAP-verkoop per projectnummer en boekjaar. Er komt één dossier per SAP-projectnummer; regels worden
              apart van orderregels bewaard. <strong>Geen ordernummers, leverstatus of installatielocaties</strong>:
              die worden niet afgeleid. Bestaande regels met nieuwe bedragen worden bijgewerkt (oude waarden blijven in de wijzigingshistorie); regels die in dit bestand ontbreken blijven staan. Projectnaam, plaats en straat volgen SAP zolang niemand ze in Re-Line aanpaste; notities, status en bevestigingen blijven altijd onaangeroerd.
            </p>
            {!!historyPreview.previousImports?.length && (
              <div className="alert warn">Dit bestand (zelfde inhoud) is eerder geïmporteerd; dubbele regels worden overgeslagen.</div>
            )}
            <div className="stats compact">
              <div><span>Dataregels</span><strong>{fmt(historyPreview.totalDataRows)}</strong></div>
              <div><span>SAP-projectnummers</span><strong>{fmt(historyPreview.projectsInFile)}</strong></div>
              <div><span>Nieuwe dossiers</span><strong>{fmt(historyPreview.newProjects)}</strong></div>
              <div><span>Bij bestaande dossiers</span><strong>{fmt(historyPreview.existingProjects)}</strong></div>
              <div><span>Nieuwe regels</span><strong>{fmt(historyPreview.newRows)}</strong></div>
              <div><span>Bijgewerkt (zelfde regel, nieuwe waarden)</span><strong>{fmt(historyPreview.updatedRows)}</strong></div>
              <div><span>Ongewijzigd (overgeslagen)</span><strong>{fmt(historyPreview.duplicates)}</strong></div>
              <div><span>Niet meer in dit bestand (blijft staan)</span><strong>{fmt(historyPreview.missingLines)}</strong></div>
              <div><span>Mogelijk dubbel</span><strong>{fmt(historyPreview.possibleDuplicates)}</strong></div>
              <div><span>Projectgegevens bijgewerkt uit SAP</span><strong>{fmt(historyPreview.projectUpdates)}</strong></div>
              <div><span>Lokaal aangepast, SAP gewijzigd (lokaal blijft)</span><strong>{fmt(historyPreview.projectConflicts)}</strong></div>
              <div><span>Boekjaren</span><strong>{historyPreview.firstYear}–{historyPreview.lastYear}</strong></div>
              <div><span>Fouten</span><strong>{fmt(historyPreview.errorCount)}</strong></div>
            </div>
            <Values
              items={{
                "Totaalregels overgeslagen": historyPreview.summaryRows,
                "Productreeksen (regels)": Object.entries(historyPreview.series ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · "),
                "Niet ingelezen kolommen (kostprijs, korting, marge)": (historyPreview.ignoredColumns ?? []).join(", ") || "geen",
              }}
            />
            {historyPreview.errors?.map((e: string) => <p key={e} className="alert error">{e}</p>)}
            {historyPreview.conflicts?.map((c: string) => <p key={c} className="alert warn">{c}</p>)}
            <button
              className="primary"
              disabled={busy || historyPreview.errorCount > 0}
              onClick={() => inspect(true)}
            >
              Projecthistorie importeren
            </button>
          </section>
        )}
        {preview && (
          <>
            {preview.profile && (
              <p className="notice">
                Importprofiel <strong>{preview.profile}</strong> herkend op de kolomnamen en toegepast.
              </p>
            )}
            {!!preview.previousImports.length && (
              <div className="alert warn">
                Dit bestand (zelfde inhoud) is eerder geïmporteerd:{" "}
                {preview.previousImports
                  .map((i) => `${i.filename} op ${new Date(i.created).toLocaleString("nl-NL")}`)
                  .join("; ")}
                . Een nieuwe import voegt alleen nog ontbrekende regels toe.
              </div>
            )}
            <h3>Veldkoppeling</h3>
            <div className="form-grid">
              {Object.entries(fields).map(([key, label]) => (
                <label key={key} className={preview.missingExpected.some((m) => m.field === key) ? "expected" : ""}>
                  {label}
                  <select
                    aria-label={label}
                    value={mapping[key as Field] ?? ""}
                    onChange={(e) => {
                      setMapping({ ...mapping, [key]: e.target.value });
                      setDirty(true);
                    }}
                  >
                    <option value="">Niet beschikbaar</option>
                    {preview.headers.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {!!preview.missingExpected.length && (
              <p className="subtitle">
                Gemarkeerd: velden die voor dossiers en dubbelcontrole gewenst zijn, maar in dit
                bestand niet gevonden. Ze blijven onbekend; er wordt niets aangevuld.
              </p>
            )}
            <div className="toolbar">
              <button disabled={busy} onClick={() => inspect(false, true)}>
                Veldkoppeling controleren
              </button>
              <label>
                Profielnaam
                <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Bijv. Duitse SAP-export 2026" />
              </label>
              <button disabled={busy || !profileName.trim() || dirty} onClick={saveProfile} title={dirty ? "Controleer eerst de gewijzigde koppeling" : ""}>
                Koppeling bewaren als profiel
              </button>
            </div>
            {dirty && <div className="alert error">Veldkoppeling gewijzigd: controleer het voorbeeld opnieuw.</div>}
            <div className="stats compact">
              <div><span>Bronregels</span><strong>{preview.totalRows}</strong></div>
              <div><span>Nieuw</span><strong>{preview.newRows}</strong></div>
              <div><span>Dubbelen</span><strong>{preview.duplicates}</strong></div>
              <div><span>Fouten</span><strong>{preview.errors.length}</strong></div>
            </div>
            <div className="stats compact">
              <div><span>Nieuwe dossiers</span><strong>{preview.clusters.newProjects}</strong></div>
              <div><span>Bij bestaande dossiers</span><strong>{preview.clusters.existingProjects}</strong></div>
              <div><span>Niet meegeteld als stuks</span><strong>{preview.notCounted}</strong></div>
              <div><span>Retour / geannuleerd</span><strong>{(preview.lineStates["Retour/correctie"] ?? 0) + " / " + (preview.lineStates["Geannuleerd"] ?? 0)}</strong></div>
            </div>
            <p className="subtitle">
              Nieuwe dossiers naar herkenningszekerheid: hoog (SAP-projectnummer){" "}
              {preview.clusters.byConfidence.Hoog}, middel (naam + plaats) {preview.clusters.byConfidence.Middel},
              laag (alleen order) {preview.clusters.byConfidence.Laag}. Lage zekerheid wordt nooit
              automatisch samengevoegd.
            </p>
            {preview.errors.length > 0 && (
              <div className="alert error">
                {preview.errors.slice(0, 20).map((e, i) => (
                  <p key={i}>Regel {e.row}: {e.message}</p>
                ))}
              </div>
            )}
            <details>
              <summary>Waarschuwingen ({preview.warnings.length + preview.conflicts.length})</summary>
              {preview.warnings.slice(0, 100).map((w, i) => (
                <p key={i}>Regel {w.row}: {w.message}</p>
              ))}
              {preview.conflicts.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </details>
            <h3>Genormaliseerd voorbeeld (eerste 50 regels)</h3>
            <Table
              label="Importvoorbeeld"
              headers={["Order / positie", "Artikel", "Omschrijving", "Project", "Plaats", "Aantal", "Status", "Orderdatum", "Debiteur"]}
            >
              {preview.normalized.map((r, i) => (
                <tr key={i} className={r.counted ? "" : "muted"}>
                  <td>{r.order} / {r.position || r.lineId}</td>
                  <td>{r.article}</td>
                  <td>{r.description}</td>
                  <td>{fmt(r.project)}</td>
                  <td>{fmt(r.city)}</td>
                  <td>{r.quantity}{r.unit ? " " + r.unit : ""}</td>
                  <td>{r.lineState}</td>
                  <td>{fmt(r.date)}</td>
                  <td>{fmt(r.debtor)}</td>
                </tr>
              ))}
            </Table>
            <button className="primary" disabled={busy || !!preview.errors.length || dirty} onClick={() => inspect(true)}>
              Import bevestigen
            </button>
          </>
        )}
      </section>
      <section>
        <details>
          <summary>Voorbereid op de Duitse SAP-/Qlik-export</summary>
          <p>
            Verwachte kolomnamen op basis van gangbare SAP-velden. Dit is géén bevestigde
            exportspecificatie: ontbrekende kolommen blijven &quot;Niet beschikbaar&quot;. Na de
            eerste geslaagde controle kun je de koppeling als profiel bewaren. Zie ook
            source/SAP_DATA_CONTRACT.md.
          </p>
          <Table headers={["Re-Line-veld", "Verwachte kolomnaam", "Belang"]}>
            {sapGermanExpected.map((e) => (
              <tr key={e.field}>
                <td>{fields[e.field]}</td>
                <td>{e.columns.join(" / ")}</td>
                <td>{e.need}</td>
              </tr>
            ))}
          </Table>
        </details>
      </section>
      <section>
        <h2>Importgeschiedenis</h2>
        <Table label="Importgeschiedenis" headers={["Bestand", "Importmoment", "Profiel", "Bronregels", "Nieuw", "Dubbelen", "Controlecode", "Meldingen"]}>
          {snap.imports.map((i) => (
            <tr key={i.id}>
              <td>{i.filename}</td>
              <td>{new Date(i.created).toLocaleString("nl-NL")}</td>
              <td>{fmt(i.profile)}</td>
              <td>{fmt(i.total_rows)}</td>
              <td>{i.added}</td>
              <td>{i.duplicates}</td>
              <td title={i.sha256}>{i.sha256 ? String(i.sha256).slice(0, 12) : "—"}</td>
              <td>{JSON.parse(i.warnings).join("; ") || "Geen conflicten"}</td>
            </tr>
          ))}
        </Table>
        {!!snap.profiles.length && (
          <>
            <h3>Opgeslagen importprofielen</h3>
            <Table headers={["Naam", "Gekoppelde velden", "Aangemaakt"]}>
              {snap.profiles.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{Object.entries(p.mapping).map(([k, v]) => `${fields[k as Field]} ← ${v}`).join("; ")}</td>
                  <td>{new Date(p.created).toLocaleDateString("nl-NL")}</td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </section>
    </>
  );
}
