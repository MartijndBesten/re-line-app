"use client";
import { useState } from "react";
import { renovationClass } from "@/lib/opportunities";
import { fmt, Table, Values, type Dossier, type Row } from "./ui";

/** Bedragen uit de SAP-export, zonder valutateken: de export vermeldt geen valuta. */
export const amount = (v: unknown) =>
  v === null || v === undefined || v === "" ? "Onbekend" : Math.round(Number(v)).toLocaleString("nl-NL");
export const years = (a: unknown, b: unknown) =>
  a === null || a === undefined ? "Onbekend" : a === b || b === null || b === undefined ? String(a) : `${a}–${b}`;

function totals(lines: Row[], key: (l: Row) => string) {
  const map = new Map<string, { lines: number; quantity: number; revenue: number; net: number }>();
  for (const l of lines) {
    const k = key(l);
    const t = map.get(k) ?? { lines: 0, quantity: 0, revenue: 0, net: 0 };
    t.lines++;
    t.quantity += Number(l.quantity ?? 0);
    t.revenue += Number(l.revenue ?? 0);
    t.net += Number(l.net_revenue ?? 0);
    map.set(k, t);
  }
  return [...map.entries()];
}
const distinct = (lines: Row[], f: (l: Row) => string) => [...new Set(lines.map(f).filter(Boolean))];

/** Korte samenvatting voor de dossierkaart. */
export function HistorySummary({ dossier }: { dossier: Dossier }) {
  const h = (dossier.history ?? []) as Row[];
  if (!h.length) return null;
  const customers = distinct(h, (l) => l.customer_name);
  return (
    <>
      <p>
        Projecthistorie SAP {dossier.project_number}: {h.length} verkoopregel(s) in boekjaren{" "}
        {years(dossier.historyFirstYear, dossier.historyLastYear)}; reeks(en) {fmt(dossier.series)}.
      </p>
      <p>
        Afzet {amount(dossier.historyQuantity)} · net-net-omzet {amount(dossier.historyNetRevenue)} volgens export.
        Klant(en) volgens SAP: {customers.slice(0, 3).join("; ") || "onbekend"}
        {customers.length > 3 ? ` en ${customers.length - 3} meer` : ""}.
      </p>
      <small>Historische verkoop ≠ levering ≠ huidige installatie. Geen ordernummers of leverstatus in deze bron.</small>
    </>
  );
}

/** Volledige projecthistorie in het dossier (tabblad Bron). */
export function HistorySection({ dossier }: { dossier: Dossier }) {
  const h = (dossier.history ?? []) as Row[];
  const [all, setAll] = useState(false);
  if (!h.length) return null;
  const shown = all ? h : h.slice(0, 60);
  const klasse = renovationClass(dossier as never);
  return (
    <section aria-label="Projecthistorie">
      <h2>Projecthistorie (SAP-verkoop per boekjaar)</h2>
      <p className="notice">
        Geaggregeerde verkoopregels uit het SAP-rapport per projectnummer, boekjaar, klant, materiaal en
        goederenontvanger. <strong>Geen ordernummers, leverstatus of leverdata.</strong> Afzet is de
        SAP-hoeveelheid (eenheid niet in de export); omzet is historische verkoop (valuta niet vermeld) en
        zegt niets over de huidige installatie. Kostprijs en marge zijn bewust niet ingelezen.
        <strong> Actuele installatiestatus en retrofitgeschiktheid zijn niet bevestigd</strong> — dat volgt pas uit
        contact en technische opname.
      </p>
      <Values
        items={{
          Kansklasse: klasse ? `${klasse.klasse} — ${klasse.reden}` : "Onbekend",
          "SAP-projectnummer": dossier.project_number,
          Boekjaren: years(dossier.historyFirstYear, dossier.historyLastYear),
          Verkoopregels: h.length,
          "Productreeksen (volgens SAP)": dossier.series,
          "Afzet (SAP-hoeveelheid)": amount(dossier.historyQuantity),
          "Omzet volgens export": amount(dossier.historyRevenue),
          "Net-net-omzet volgens export": amount(dossier.historyNetRevenue),
          "Klanten volgens SAP": distinct(h, (l) => [l.customer_number, l.customer_name].filter(Boolean).join(" ")).join("; "),
          "Plaatsen goederenontvangers (geen installatielocatie)": distinct(h, (l) => l.recipient_city).join(", "),
          "Projectadres volgens SAP": [distinct(h, (l) => l.project_street).join(" / "), dossier.city].filter(Boolean).join(", ") || "Onbekend",
        }}
      />
      <div className="history-totals">
        <Table label="Per boekjaar" headers={["Boekjaar", "Regels", "Afzet", "Omzet", "Net-net-omzet"]}>
          {totals(h, (l) => String(l.fiscal_year)).map(([k, t]) => (
            <tr key={k}>
              <td>{k}</td><td>{t.lines}</td><td>{amount(t.quantity)}</td><td>{amount(t.revenue)}</td><td>{amount(t.net)}</td>
            </tr>
          ))}
        </Table>
        <Table label="Per productreeks" headers={["Reeks (SAP)", "Regels", "Afzet", "Net-net-omzet"]}>
          {totals(h, (l) => String(l.series || "Onbekend")).map(([k, t]) => (
            <tr key={k}>
              <td>{k}</td><td>{t.lines}</td><td>{amount(t.quantity)}</td><td>{amount(t.net)}</td>
            </tr>
          ))}
        </Table>
      </div>
      <Table
        label="Verkoopregels projecthistorie"
        headers={["Boekjaar", "Materiaal", "Omschrijving", "Reeks", "Afzet", "Omzet", "Net-net-omzet", "Klant", "Goederenontvanger", "Bron"]}
      >
        {shown.map((l) => (
          <tr key={l.id} className={Number(l.quantity) < 0 || Number(l.net_revenue) < 0 ? "muted" : ""}>
            <td>{l.fiscal_year}</td>
            <td>{l.material}</td>
            <td>{l.material_desc}</td>
            <td>{l.series}</td>
            <td>{amount(l.quantity)}</td>
            <td>{amount(l.revenue)}</td>
            <td>{amount(l.net_revenue)}</td>
            <td>{fmt(l.customer_name)}</td>
            <td>{fmt([l.recipient_name, l.recipient_city].filter(Boolean).join(", "))}</td>
            <td>
              <details>
                <summary>{l.filename} · rij {l.source_row}</summary>
                <pre>{JSON.stringify(JSON.parse(String(l.raw)), null, 2)}</pre>
              </details>
            </td>
          </tr>
        ))}
      </Table>
      {h.length > shown.length && (
        <button type="button" onClick={() => setAll(true)}>
          Toon alle {h.length} verkoopregels
        </button>
      )}
    </section>
  );
}
