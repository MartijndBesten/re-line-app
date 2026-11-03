"use client";
import { useState } from "react";
import { evaluateScenarios, internalScenarioPack, type ScenarioRecord } from "@/lib/proposal";
import { calculate, scenarioKinds, type Calculation } from "@/lib/calculator";
import { scenarioDirections } from "@/lib/commercial";
import { download, fmt, Input, Text, type Dossier, type Mutate } from "./ui";

const euro = (n: number) =>
  "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ProposalComparison({ name, scenarios }: { name: string; scenarios: ScenarioRecord[] }) {
  const list = evaluateScenarios(scenarios);
  return <section>
    <div className="commercial-head">
      <div><p className="eyebrow">TECHNISCHE VERKENNING</p><h2>Drie renovatiescenario’s</h2>
        <p className="subtitle">Alleen bedragen die volledig ingevoerd en technisch gecontroleerd zijn worden getoond. Geen automatische besparingsclaims.</p>
      </div>
      <button type="button" onClick={() => download("re-line-interne-scenariovergelijking.txt", internalScenarioPack(name, list))}>
        Intern overzicht downloaden
      </button>
    </div>
    <div className="scenario-compare">{list.map((s, i) => <div key={s.kind}>
      <strong>{s.kind}</strong>
      <small>{scenarioDirections[i]?.value}</small>
      {s.complete
        ? <p className="scenario-amount">{euro(Number(s.total))}<small>excl. btw · concept{s.perMeter !== null ? ` · afgeleid ${euro(s.perMeter)} per ingevoerde meter` : ""}</small></p>
        : <p className="scenario-unready">Nog niet berekenbaar</p>}
      <p className="subtitle">{s.saved ? "Opgeslagen concept" : "Nog geen gegevens"}</p>
      <ul>{s.missing.length ? s.missing.map(m => <li key={m}>{m}</li>)
        : <li>Technisch gecontroleerd door {s.technicalBy}; voorstel blijft indicatief</li>}</ul>
      {s.priceSource && <small>Prijsbron: {s.priceSource}{s.priceDate ? ` (peildatum ${s.priceDate})` : ""}</small>}
    </div>)}</div>
    <p className="notice">Dit overzicht is uitsluitend voor intern gebruik. Definitieve offertes vereisen inmeting, actuele producten en tarieven, lichtberekening, afstemming met installateur en goedkeuring.</p>
  </section>;
}

const emptyCalc: Calculation = {
  meters: null, modules: null, material: null, installation: null, commissioning: null, other: null,
  technicalConfirmed: false, technicalBy: "", priceSource: "", priceDate: "", notes: "",
};
const gates: Record<string, string> = {
  Retrofit: "Bestaande profielen behouden uitsluitend na bevestigde compatibiliteitscontrole (toestand, maatvoering, draagstructuur, bevestiging).",
  "Complete vervanging": "Nieuwe lichtlijn: actuele productkeuze, lichtberekening, montagesysteem en werkelijke lijnlengten nog technisch onderbouwen.",
  "Slimme verlichting": "Renovatie combineren met sensoren en regeling na inventarisatie van gebruikstijden, zones, netwerk en koppelingen.",
};
/** Per scenario een eigen conceptcalculatie; leeg = onbekend, 0 = expliciet nul. */
export function ScenarioEditor({ dossier, mutate, busy }: { dossier: Dossier; mutate: Mutate; busy: boolean }) {
  const load = (kind: string): Calculation => {
    const saved = dossier.scenarios.find((s) => s.kind === kind);
    if (!saved) return { ...emptyCalc };
    try {
      return { ...emptyCalc, ...JSON.parse(saved.data) };
    } catch {
      return { ...emptyCalc };
    }
  };
  const [scenario, setScenario] = useState("Retrofit");
  const [calc, setCalc] = useState<Calculation>(() => load("Retrofit"));
  const result = (() => {
    try {
      return calculate(calc);
    } catch {
      return { complete: false, missing: ["ongeldige negatieve invoer"], total: null, perMeter: null };
    }
  })();
  return (
    <section>
      <h2>Concept renovatiescenario</h2>
      <p>
        Geen technisch advies of offerte. Alle kosten worden handmatig als totaalbedragen
        ingevuld op basis van een opgegeven prijsbron met peildatum. Lege velden blijven
        onbekend; een expliciete 0 is toegestaan. Er worden geen energie-, CO₂- of
        terugverdienclaims berekend.
      </p>
      <div className="segments" aria-label="Scenario">
        {scenarioKinds.map((k) => (
          <button
            type="button"
            aria-pressed={scenario === k}
            className={scenario === k ? "active" : ""}
            key={k}
            onClick={() => {
              setScenario(k);
              setCalc(load(k));
            }}
          >
            {k}
          </button>
        ))}
      </div>
      <p>{gates[scenario]}</p>
      {dossier.meters != null && calc.meters != null && calc.meters !== dossier.meters && (
        <p className="notice">
          Ingevoerde meters ({fmt(calc.meters)}) wijken af van de bevestigde profielmeters in het dossier
          ({fmt(dossier.meters)}). Leg de reden vast in de uitgangspunten.
        </p>
      )}
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          mutate("scenario", dossier.id, { kind: scenario, calculation: calc }, "Conceptscenario opgeslagen");
        }}
      >
        {Object.entries({
          meters: "Meters (gecontroleerde invoer)",
          modules: "Aantal lichtmodules",
          material: "Materiaalkosten (€ totaal)",
          installation: "Montagekosten (€ totaal)",
          commissioning: "Inbedrijfstelling (€ totaal)",
          other: "Overige kosten (€ totaal)",
        }).map(([k, l]) => (
          <Input
            key={k}
            label={l}
            type="number"
            step="any"
            min="0"
            value={(calc[k as keyof Calculation] as number) ?? ""}
            onChange={(e) =>
              setCalc({ ...calc, [k]: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        ))}
        <Input label="Prijsbron" value={calc.priceSource} onChange={(e) => setCalc({ ...calc, priceSource: e.target.value })} />
        <Input label="Peildatum prijzen" type="date" value={calc.priceDate ?? ""} onChange={(e) => setCalc({ ...calc, priceDate: e.target.value })} />
        <Input label="Technisch gecontroleerd door" value={calc.technicalBy ?? ""} onChange={(e) => setCalc({ ...calc, technicalBy: e.target.value })} />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={calc.technicalConfirmed}
            onChange={(e) => setCalc({ ...calc, technicalConfirmed: e.target.checked })}
          />{" "}
          Technische invoer en compatibiliteit gecontroleerd
        </label>
        <Text label="Scenario-uitgangspunten" value={calc.notes} onChange={(e) => setCalc({ ...calc, notes: e.target.value })} />
        <div className="wide notice">
          {result.complete
            ? `Concept totaalindicatie: ${euro(Number(result.total))} (exclusief btw)` +
              (result.perMeter !== null ? ` · afgeleid ${euro(result.perMeter)} per ingevoerde meter` : "")
            : `Berekening onvolledig. Ontbreekt: ${result.missing.join(", ")}.`}
        </div>
        <button disabled={busy} className="primary">
          Conceptscenario bewaren
        </button>
      </form>
    </section>
  );
}
