"use client";
import { useState } from "react";
import {
  answerValues,
  callOutcomes,
  channels,
  contactRoles,
  relationRoles,
  statuses,
} from "@/lib/domain";
import { latestAnswers, questions, scenarioDirections, type QuestionId } from "@/lib/commercial";
import { missingData, priorityReasons, relatedProjects } from "@/lib/dossier";
import { evaluateScenarios } from "@/lib/proposal";
import { dueBucket } from "@/lib/worklist";
import { CommercialPrep } from "./commercial";
import { ProposalComparison, ScenarioEditor } from "./proposal";
import { amount, HistorySection, HistorySummary, years } from "./history";
import {
  dossierViews,
  download,
  fmt,
  Input,
  OwnerInput,
  Select,
  Table,
  Text,
  Values,
  type Dossier,
  type DossierView as View,
  type Mutate,
  type Open,
  type Row,
  type Snapshot,
} from "./ui";

type Props = {
  dossier: Dossier;
  setDossier: (d: Dossier) => void;
  snap: Snapshot;
  view: View;
  setView: (v: View) => void;
  open: Open;
  mutate: Mutate;
  busy: boolean;
};

export function DossierView(props: Props) {
  const { dossier, view, setView } = props;
  return (
    <>
      <div className="stats compact">
        <div><span>Historische aantallen</span><strong>{fmt(dossier.quantity)}</strong></div>
        <div><span>Bevestigde profielmeters</span><strong>{fmt(dossier.meters)}</strong></div>
        <div><span>Datakwaliteit</span><strong>{dossier.quality}%</strong></div>
        <div><span>Prioriteit</span><strong>{dossier.priority}</strong></div>
        <div><span>Salesstatus</span><strong className="small">{dossier.status}</strong></div>
        <div><span>Verantwoordelijke</span><strong className="small">{fmt(dossier.owner)}</strong></div>
        {Number(dossier.historyLines) > 0 && (
          <>
            <div><span>Boekjaren (projecthistorie)</span><strong className="small">{years(dossier.historyFirstYear, dossier.historyLastYear)}</strong></div>
            <div><span>Net-net-omzet (export)</span><strong className="small">{amount(dossier.historyNetRevenue)}</strong></div>
          </>
        )}
        {dossier.candidate_rank ? (
          <div><span>Renovatiekandidaat</span><strong className="small">#{dossier.candidate_rank}</strong></div>
        ) : null}
      </div>
      <p className="notice">
        Orders bewijzen geen levering. Afleveradressen bewijzen geen
        installatielocatie. Ouderdom betreft de order, niet de installatie. De
        huidige situatie moet worden gecontroleerd.
      </p>
      <div className="dossier-tabs" role="tablist" aria-label="Dossieronderdelen">
        {dossierViews.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={view === v ? "active" : ""}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={view}>
        {view === "Overzicht" && <Overview {...props} />}
        {view === "Gesprek" && <Conversation {...props} />}
        {view === "Bron & orders" && <Source {...props} />}
        {view === "Relaties" && <Relations {...props} />}
        {view === "Scenario's" && (
          <>
            <ProposalComparison name={dossier.name} scenarios={dossier.scenarios} />
            <ScenarioEditor key={dossier.id} dossier={dossier} mutate={props.mutate} busy={props.busy} />
          </>
        )}
      </div>
    </>
  );
}

function Overview({ dossier, snap, setView, open, mutate, busy }: Props) {
  const missing = missingData(dossier);
  const answers = latestAnswers(dossier.activities as never);
  const unasked = questions.filter((q) => !answers[q.id]);
  const openActs = dossier.activities
    .filter((a) => !a.done && ["Bellen", "Afspraak", "Vervolgactie"].includes(a.kind))
    .sort((a, b) => String(a.due ?? "9999").localeCompare(String(b.due ?? "9999")));
  const related = relatedProjects(dossier, snap.projects);
  const scen = evaluateScenarios(dossier.scenarios);
  const installers = dossier.relations.filter((r) => r.role === "Installateur");
  const articles = [...new Set(dossier.lines.map((l) => `${l.article}${l.description ? " (" + l.description + ")" : ""}`))];
  const known: [string, string][] = [
    ...(dossier.present !== "Onbekend" ? [[`Installatie nog aanwezig: ${dossier.present}`, dossier.present_evidence]] : []),
    ...(dossier.replaced !== "Onbekend" ? [[`Installatie vervangen: ${dossier.replaced}`, dossier.replaced_evidence]] : []),
    ...(dossier.need !== "Onbekend" ? [[`Renovatiebehoefte: ${dossier.need}`, dossier.need_evidence]] : []),
    ...(dossier.location_confirmed ? [[`Installatielocatie: ${dossier.address}`, dossier.location_evidence]] : []),
    ...(dossier.end_user ? [[`Eindgebruiker/beheerder: ${dossier.end_user}`, ""]] : []),
    ...installers.map((r) => [`Installateur: ${r.name}`, "gekoppelde relatie"]),
    ...(dossier.contact ? [[`Contactpersoon: ${dossier.contact}`, ""]] : []),
    ...Object.entries(answers)
      .filter(([id]) => !["aanwezig", "vervangen"].includes(id))
      .map(([id, a]) => [
        `${questions.find((q) => q.id === id)?.text.replace(/\?$/, "")}: ${a!.answer}${a!.note ? " — " + a!.note : ""}`,
        `gesprek ${a!.date}${a!.contact ? ", " + a!.contact : ""}`,
      ]),
  ] as [string, string][];
  return (
    <>
      <section className="dossier-card" aria-label="Dossierkaart">
        <div>
          <h3>Historisch mogelijk geleverd</h3>
          {dossier.lines.length > 0 && (
            <>
              <p>
                {dossier.lineCount} orderregel(s) in {dossier.orderCount} order(s),{" "}
                <strong>{fmt(dossier.quantity)} historische stuks</strong>
                {dossier.firstYear ? `, orderjaren ${dossier.firstYear}${dossier.lastYear !== dossier.firstYear ? "–" + dossier.lastYear : ""}` : ""}.
              </p>
              <p>Artikel(en): {articles.slice(0, 3).join("; ")}{articles.length > 3 ? ` en ${articles.length - 3} meer` : ""}.</p>
              <p>Debiteur: {fmt(dossier.debtors)}. Plaats in bron: {fmt(dossier.city)}.</p>
              <small>Order ≠ levering ≠ installatie. Geleverde hoeveelheid: {fmt(dossier.deliveredQuantity)}.</small>
            </>
          )}
          <HistorySummary dossier={dossier} />
        </div>
        <div>
          <h3>Wat we weten</h3>
          {known.length ? (
            <ul>
              {known.map(([k, ev]) => (
                <li key={k}>{k}{ev ? <small> · bron: {ev}</small> : null}</li>
              ))}
            </ul>
          ) : (
            <p>Nog niets bevestigd buiten de historische orderregels.</p>
          )}
        </div>
        <div>
          <h3>Wat we (nog) niet weten</h3>
          <ul>
            {missing.map((m) => (
              <li key={m.label}>
                <strong>{m.label}</strong> <small>({m.group}) — {m.action}</small>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Te vragen aan installateur of gebruiker</h3>
          {unasked.length ? (
            <ol>
              {unasked.map((q) => (
                <li key={q.id} value={questions.indexOf(q) + 1}>{q.text}</li>
              ))}
            </ol>
          ) : (
            <p>Alle vaste vragen hebben een antwoord. Zie het tabblad Gesprek.</p>
          )}
        </div>
        <div>
          <h3>Volgende actie</h3>
          {openActs.length ? (
            <ul>
              {openActs.slice(0, 4).map((a) => (
                <li key={a.id} className={dueBucket(a.due) === "Achterstallig" ? "overdue" : ""}>
                  {a.kind} · {a.due ? `${a.due} (${dueBucket(a.due).toLowerCase()})` : "zonder datum"} · {fmt(a.owner)} — {a.note}
                </li>
              ))}
            </ul>
          ) : (
            <p>Geen geplande actie.</p>
          )}
          {dossier.next_action && <p>Dossiernotitie volgende actie: {dossier.next_action}</p>}
          <div className="toolbar">
            <button type="button" className="primary" onClick={() => setView("Gesprek")}>
              Gesprek registreren / actie plannen
            </button>
          </div>
        </div>
        <div>
          <h3>Drie technische richtingen</h3>
          <ul>
            {scenarioDirections.map((s, i) => (
              <li key={s.name}>
                <strong>{s.name}</strong> — {s.value}.{" "}
                <small>{scen[i]?.complete ? "Concept berekend." : "Nog niet berekend."} Voorwaarde: {s.gate}.</small>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setView("Scenario's")}>Naar scenario&apos;s</button>
        </div>
      </section>
      {!!related.length && (
        <section>
          <h2>Mogelijk verwante dossiers</h2>
          <p>
            Voorstel op basis van plaats en naam; mogelijk hetzelfde gebouw of een andere
            fase. Controleer vóór samenvoegen (bijv. adres, goederenontvanger, orderdetails).
          </p>
          <Table headers={["Dossier", "Reden", "Stuks", "Status", "Acties"]}>
            {related.map(({ project: q, reason }) => (
              <tr key={q.id}>
                <td><button className="link" onClick={() => open(q.id)}>{q.name}</button></td>
                <td>{reason}</td>
                <td>{fmt(q.quantity)}</td>
                <td>{q.status}</td>
                <td>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        confirm(
                          `"${q.name}" samenvoegen in "${dossier.name}"? Alleen doen als gecontroleerd is dat het om hetzelfde gebouw gaat. Bronregels, notities en eerdere dossiergegevens blijven bewaard.`,
                        ) &&
                        (await mutate("merge", dossier.id, { ids: [dossier.id, q.id] }, "Dossiers samengevoegd"))
                      )
                        open(dossier.id);
                    }}
                  >
                    Samenvoegen na controle
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </section>
      )}
      <section>
        <details>
          <summary>Waarom deze prioriteit? ({dossier.priority} punten)</summary>
          <Table headers={["Criterium", "Toelichting", "Bijdrage", "Maximaal"]}>
            {priorityReasons(dossier).map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td>{r.detail}</td>
                <td>{r.points}</td>
                <td>{r.max}</td>
              </tr>
            ))}
          </Table>
          <p>
            Datakwaliteit ({dossier.quality}%) is bronvolledigheid: plaats, SAP-projectnummer,
            afleveradres, orderjaar en hoge herkenningszekerheid tellen elk 20%. Het is geen
            bewijs van een bestaande installatie. Gewichten staan onder Instellingen.
          </p>
        </details>
      </section>
      <Assessment dossier={dossier} snap={snap} mutate={mutate} busy={busy} />
    </>
  );
}

const claimEvidence: [keyof Dossier, keyof Dossier, string][] = [
  ["present", "present_evidence", "Installatie nog aanwezig?"],
  ["replaced", "replaced_evidence", "Installatie al vervangen?"],
  ["need", "need_evidence", "Renovatiebehoefte bevestigd?"],
];
function Assessment({
  dossier: saved,
  snap,
  mutate,
  busy,
}: Pick<Props, "dossier" | "snap" | "mutate" | "busy">) {
  // Bewerken gebeurt in een concept. Dossierkaart en kerncijfers tonen alleen opgeslagen gegevens,
  // zodat een geweigerde of nog niet opgeslagen bevestiging nooit als "wat we weten" verschijnt.
  const [dossier, setDraft] = useState<Dossier>(saved);
  const [base, setBase] = useState<Dossier>(saved);
  if (base !== saved) {
    setBase(saved);
    setDraft(saved);
  }
  const dirty = dossier !== saved;
  const set = (k: string, v: unknown) => setDraft({ ...dossier, [k]: v } as Dossier);
  return (
    <section>
      <h2>Commerciële beoordeling</h2>
      <p>
        Bevestigingen (aanwezig, vervangen, renovatiebehoefte, locatie) vragen altijd een bron:
        wie, hoe en wanneer. Sneller: registreer een gesprek en vink daar aan wat is bevestigd.
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          mutate("project", dossier.id, dossier);
        }}
      >
        {[
          ["name", "Projectnaam"],
          ["city", "Plaats"],
          ["address", "Adres (historisch of gecontroleerd)"],
          ["end_user", "Bekende eindgebruiker"],
          ["contact", "Huidige contactpersoon"],
          ["next_action", "Volgende actie"],
        ].map(([k, l]) => (
          <Input
            key={k}
            label={l}
            required={k === "name"}
            value={String(dossier[k] ?? "")}
            onChange={(e) => set(k, e.target.value)}
          />
        ))}
        <OwnerInput
          id="dossier-owner"
          label="Verantwoordelijke"
          owners={snap.owners}
          value={String(dossier.owner ?? "")}
          onChange={(v) => set("owner", v)}
        />
        <Input label="Actiedatum" type="date" value={dossier.due ?? ""} onChange={(e) => set("due", e.target.value || null)} />
        <Select label="Salesstatus" options={statuses} value={dossier.status} onChange={(e) => set("status", e.target.value)} />
        <Select
          label="Commerciële route"
          options={["Eindgebruiker", "Installateur"]}
          value={dossier.route}
          onChange={(e) => set("route", e.target.value)}
        />
        {claimEvidence.map(([k, ev, l]) => (
          <div className="claim" key={String(k)}>
            <Select label={l} options={["Onbekend", "Ja", "Nee"]} value={String(dossier[k])} onChange={(e) => set(String(k), e.target.value)} />
            <Input
              label={"Bron: " + l.replace(/\?$/, "").toLowerCase()}
              placeholder="Wie, hoe, wanneer"
              value={String(dossier[ev] ?? "")}
              onChange={(e) => set(String(ev), e.target.value)}
            />
          </div>
        ))}
        <div className="claim">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!dossier.location_confirmed}
              onChange={(e) => set("location_confirmed", e.target.checked ? 1 : 0)}
            />{" "}
            Installatielocatie gecontroleerd
          </label>
          <Input
            label="Bron: installatielocatie"
            placeholder="Wie, hoe, wanneer"
            value={String(dossier.location_evidence ?? "")}
            onChange={(e) => set("location_evidence", e.target.value)}
          />
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!dossier.relationship_confirmed}
            onChange={(e) => set("relationship_confirmed", e.target.checked ? 1 : 0)}
          />{" "}
          Commerciële relatie bevestigd
        </label>
        <Text label="Commerciële notities" value={dossier.notes} onChange={(e) => set("notes", e.target.value)} />
        <button className="primary" disabled={busy}>
          Dossier opslaan
        </button>
        {dirty && (
          <small className="reasons" role="note">
            Nog niet opgeslagen. De dossierkaart toont een wijziging pas na opslaan.
          </small>
        )}
      </form>
    </section>
  );
}

const emptyAnswers = () =>
  Object.fromEntries(questions.map((q) => [q.id, { answer: "Onbekend", note: "" }])) as Record<
    QuestionId,
    { answer: string; note: string }
  >;
function Conversation({ dossier, snap, mutate, busy }: Props) {
  const blank = {
    contact: dossier.contact ?? "",
    contactRole: "Installateur",
    channel: "Telefoon",
    outcome: "",
    note: "",
    owner: dossier.owner ?? "",
    completeActivityId: "",
    status: "",
    present: "",
    replaced: "",
    need: "",
    location: false,
    address: dossier.address ?? "",
    endUser: "",
    installer: "",
    follow: false,
    followKind: "Bellen",
    followDue: "",
    followNote: "",
  };
  const [call, setCall] = useState(blank);
  const [answers, setAnswers] = useState(emptyAnswers);
  const [activity, setActivity] = useState({ kind: "Bellen", note: "", contact: "", owner: dossier.owner ?? "", due: "", result: "" });
  const [draft, setDraft] = useState("");
  const set = (k: keyof typeof blank, v: unknown) => setCall({ ...call, [k]: v });
  const openActs = dossier.activities.filter(
    (a) => !a.done && ["Bellen", "Afspraak", "Vervolgactie"].includes(a.kind),
  );
  async function saveCall() {
    const data: Row = {
      contact: call.contact,
      contactRole: call.contactRole,
      channel: call.channel,
      outcome: call.outcome,
      note: call.note,
      owner: call.owner,
      answers,
      completeActivityId: call.completeActivityId || undefined,
      status: call.status || undefined,
      confirm: {
        present: call.present || undefined,
        replaced: call.replaced || undefined,
        need: call.need || undefined,
        location: call.location,
        address: call.address,
        endUser: call.endUser,
        installer: call.installer,
      },
      followUp: call.follow
        ? { kind: call.followKind, due: call.followDue || null, note: call.followNote, owner: call.owner }
        : undefined,
    };
    if (await mutate("call", dossier.id, data, "Gesprek geregistreerd")) {
      setCall({ ...blank, contact: call.contact, owner: call.owner });
      setAnswers(emptyAnswers());
    }
  }
  const hint = (id: QuestionId) =>
    answers[id].answer !== "Onbekend" ? `Antwoord in dit gesprek: ${answers[id].answer}` : undefined;
  return (
    <>
      <CommercialPrep dossier={dossier} />
      <section>
        <h2>Gesprek registreren</h2>
        <p>
          Leg vast met wie je sprak, de uitkomst en de antwoorden. Alleen wat je onder
          &quot;In dossier vastleggen&quot; kiest, wordt als bevestigd opgeslagen, met dit
          gesprek als bron. Er wordt niets verzonden.
        </p>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            saveCall();
          }}
        >
          <Input label="Gesproken met" required value={call.contact} onChange={(e) => set("contact", e.target.value)} />
          <Select label="Rol contactpersoon" options={contactRoles} value={call.contactRole} onChange={(e) => set("contactRole", e.target.value)} />
          <Select label="Kanaal" options={channels} value={call.channel} onChange={(e) => set("channel", e.target.value)} />
          <Select label="Uitkomst" options={["", ...callOutcomes]} emptyLabel="Kies de uitkomst" required value={call.outcome} onChange={(e) => set("outcome", e.target.value)} />
          <OwnerInput id="call-owner" label="Verantwoordelijke voor opvolging" owners={snap.owners} value={call.owner} onChange={(v) => set("owner", v)} />
          {!!openActs.length && (
            <label>
              Geplande actie hiermee afronden
              <select aria-label="Geplande actie hiermee afronden" value={call.completeActivityId} onChange={(e) => set("completeActivityId", e.target.value)}>
                <option value="">Geen</option>
                {openActs.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.kind} · {a.due ?? "zonder datum"} · {String(a.note).slice(0, 40)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset className="wide questions">
            <legend>Antwoorden op de vaste vragen</legend>
            {questions.map((q, i) => (
              <div className="question" key={q.id}>
                <span>{i + 1}. {q.text}</span>
                <select
                  aria-label={`Antwoord vraag ${i + 1}`}
                  value={answers[q.id].answer}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: { ...answers[q.id], answer: e.target.value } })}
                >
                  {answerValues.map((v) => <option key={v}>{v}</option>)}
                </select>
                <input
                  aria-label={`Toelichting vraag ${i + 1}`}
                  placeholder="Toelichting"
                  value={answers[q.id].note}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: { ...answers[q.id], note: e.target.value } })}
                />
              </div>
            ))}
          </fieldset>
          <Text label="Samenvatting gesprek" required value={call.note} onChange={(e) => set("note", e.target.value)} />
          <fieldset className="wide confirmations">
            <legend>In dossier vastleggen (alleen wat in dit gesprek is bevestigd)</legend>
            <Select label="Vastleggen: installatie nog aanwezig" options={["", "Ja", "Nee"]} emptyLabel="Niet vastleggen" value={call.present} onChange={(e) => set("present", e.target.value)} />
            {hint("aanwezig") && <small className="hint">{hint("aanwezig")}</small>}
            <Select label="Vastleggen: installatie (deels) vervangen" options={["", "Ja", "Nee"]} emptyLabel="Niet vastleggen" value={call.replaced} onChange={(e) => set("replaced", e.target.value)} />
            <Select label="Vastleggen: renovatiebehoefte" options={["", "Ja", "Nee"]} emptyLabel="Niet vastleggen" value={call.need} onChange={(e) => set("need", e.target.value)} />
            <label className="checkbox">
              <input type="checkbox" checked={call.location} onChange={(e) => set("location", e.target.checked)} /> Installatielocatie bevestigd
            </label>
            {call.location && <Input label="Gecontroleerd adres" value={call.address} onChange={(e) => set("address", e.target.value)} />}
            <Input label="Eindgebruiker / gebouwbeheerder" value={call.endUser} onChange={(e) => set("endUser", e.target.value)} />
            <Input label="Huidige installateur (wordt gekoppeld als relatie)" value={call.installer} onChange={(e) => set("installer", e.target.value)} />
            <Select label="Salesstatus bijwerken naar" options={["", ...statuses]} emptyLabel="Ongewijzigd" value={call.status} onChange={(e) => set("status", e.target.value)} />
          </fieldset>
          <fieldset className="wide">
            <legend>Vervolg</legend>
            <label className="checkbox">
              <input type="checkbox" checked={call.follow} onChange={(e) => set("follow", e.target.checked)} /> Vervolgactie plannen
            </label>
            {call.follow && (
              <div className="form-grid inner">
                <Select label="Soort vervolgactie" options={["Bellen", "Afspraak", "Vervolgactie"]} value={call.followKind} onChange={(e) => set("followKind", e.target.value)} />
                <Input label="Datum vervolgactie" type="date" value={call.followDue} onChange={(e) => set("followDue", e.target.value)} />
                <Input label="Omschrijving vervolgactie" required value={call.followNote} onChange={(e) => set("followNote", e.target.value)} />
              </div>
            )}
          </fieldset>
          <button className="primary" disabled={busy}>
            Gesprek opslaan
          </button>
        </form>
      </section>
      <section>
        <h2>Actie plannen of notitie toevoegen</h2>
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await mutate("activity", dossier.id, activity, "Activiteit toegevoegd"))
              setActivity({ ...activity, note: "", result: "" });
          }}
        >
          <Select
            label="Activiteit"
            options={["Bellen", "Afspraak", "Notitie", "Vervolgactie", "Gespreksverslag"]}
            value={activity.kind}
            onChange={(e) => setActivity({ ...activity, kind: e.target.value })}
          />
          <Input label="Actiedatum" type="date" value={activity.due} onChange={(e) => setActivity({ ...activity, due: e.target.value })} />
          <Input label="Contactpersoon" value={activity.contact} onChange={(e) => setActivity({ ...activity, contact: e.target.value })} />
          <OwnerInput id="act-owner" label="Verantwoordelijke medewerker" owners={snap.owners} value={activity.owner} onChange={(v) => setActivity({ ...activity, owner: v })} />
          <Input label="Gespreksresultaat" value={activity.result} onChange={(e) => setActivity({ ...activity, result: e.target.value })} />
          <Text label="Notitie / afspraakinhoud" required value={activity.note} onChange={(e) => setActivity({ ...activity, note: e.target.value })} />
          <button disabled={busy} className="primary">
            Activiteit bewaren
          </button>
        </form>
      </section>
      <section>
        <h2>Concept klantopvolging</h2>
        <p>
          Vaste tekst zonder AI-dienst. Er wordt uitsluitend een concept gemaakt; controleer
          het voor gebruik. Interne prijzen en SAP-referenties komen niet in de klanttekst.
        </p>
        <button type="button" onClick={() => setDraft(customerDraft(dossier))}>
          Concept voorbereiden
        </button>
        {draft && (
          <>
            <Text label="Bewerkbaar concept" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="toolbar">
              <button type="button" onClick={() => download("re-line-concept.txt", draft)}>
                Tekst downloaden
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  mutate(
                    "activity",
                    dossier.id,
                    { kind: "Notitie", note: draft, contact: dossier.contact, owner: dossier.owner },
                    "Concept in tijdlijn bewaard",
                  )
                }
              >
                In tijdlijn bewaren
              </button>
            </div>
          </>
        )}
      </section>
      <section>
        <h2>Tijdlijn</h2>
        {!dossier.activities.length && <p>Nog geen activiteiten.</p>}
        {dossier.activities.map((a) => (
          <article className="timeline" key={a.id}>
            <div>
              <strong>{a.kind}</strong>{" "}
              <span className="badge">{a.done ? "Afgerond" : "Open"}</span>
              {a.group_id && <span className="badge">Gezamenlijk</span>}
              <small>
                {new Date(a.created).toLocaleString("nl-NL")}{a.created_by ? ` · vastgelegd door ${a.created_by}` : ""} · {fmt(a.due)} · {fmt(a.owner)} · {fmt(a.contact)}
                {a.contact_role ? ` (${a.contact_role}, ${a.channel})` : ""}
              </small>
            </div>
            {a.outcome && <p><strong>Uitkomst:</strong> {a.outcome}</p>}
            {a.kind === "Samenvoeging" ? <MergeNote note={String(a.note)} /> : <p>{a.note}</p>}
            {a.result && a.result !== a.outcome && <p>Resultaat: {a.result}</p>}
            {a.answers && <AnswerList json={a.answers} />}
            {a.kind !== "Gespreksverslag" && a.kind !== "Samenvoeging" && (
              <button disabled={busy} onClick={() => mutate("complete", a.id, { done: !a.done })}>
                {a.done ? "Heropenen" : "Afronden"}
              </button>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
/** Samenvoegingen bewaren het oude dossier als JSON; toon dat leesbaar en ingeklapt. */
function MergeNote({ note }: { note: string }) {
  const m = note.match(/^(Bewaarde dossiergegevens|Bewaard scenario [^:]+): (.*)$/s);
  if (!m) return <p>{note}</p>;
  let body = m[2],
    title = m[1];
  try {
    const parsed = JSON.parse(m[2]);
    body = JSON.stringify(parsed, null, 2);
    if (parsed?.name) title += ` van "${parsed.name}"`;
  } catch {
    // Geen JSON: toon de oorspronkelijke tekst.
  }
  return (
    <details>
      <summary>{title}</summary>
      <pre>{body}</pre>
    </details>
  );
}
function AnswerList({ json }: { json: string }) {
  let parsed: Record<string, { answer: string; note: string }> = {};
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return (
    <details>
      <summary>Antwoorden ({Object.keys(parsed).length})</summary>
      <ul>
        {questions
          .filter((q) => parsed[q.id])
          .map((q) => (
            <li key={q.id}>
              {q.text} <strong>{parsed[q.id].answer}</strong>
              {parsed[q.id].note ? ` — ${parsed[q.id].note}` : ""}
            </li>
          ))}
      </ul>
    </details>
  );
}
function customerDraft(dossier: Dossier) {
  const lines = [
    "CONCEPT — voor handmatige controle",
    "",
    `Betreft: mogelijke technische inventarisatie ${dossier.name}`,
    "",
  ];
  if (dossier.present === "Ja")
    lines.push("Tijdens onze inventarisatie is bevestigd dat de bestaande verlichtingsinstallatie nog aanwezig is.");
  if (dossier.replaced === "Ja")
    lines.push("Er is aangegeven dat de eerdere installatie inmiddels is vervangen.");
  if (dossier.need === "Ja")
    lines.push(
      "Er is een renovatiebehoefte bevestigd. Een technische inventarisatie kan de geschikte renovatierichting bepalen.",
    );
  if (dossier.location_confirmed) lines.push(`Gecontroleerde locatie: ${dossier.address || dossier.city}.`);
  if (dossier.present === "Ja" && dossier.replaced !== "Ja")
    lines.push(
      "Afhankelijk van technische geschiktheid kunnen behoud van profielen, complete vervanging of toevoeging van lichtregeling worden onderzocht.",
    );
  lines.push(
    "",
    "Wij stellen voor om de actuele situatie en technische mogelijkheden gezamenlijk te inventariseren.",
    "Dit is een concept, geen technisch advies of offerte.",
  );
  return lines.join("\n");
}

function Source({ dossier, open, mutate, busy, snap }: Props) {
  const admin = !snap.me || snap.me.role === "beheerder";
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [splitName, setSplitName] = useState("");
  return (
    <>
      <section>
        <h2>Bron en herkenning</h2>
        <Values
          items={{
            "SAP-projectnummer": dossier.project_number,
            Herkenningszekerheid: dossier.confidence,
            "Oudste orderjaar": dossier.firstYear,
            "Laatste orderjaar": dossier.lastYear,
            "Debiteur(en)": dossier.debtors,
            "Bevestigde productfamilies": dossier.families,
            "Familie volgens bron (onbevestigd)": dossier.sourceFamilies,
            "Geleverde hoeveelheid": dossier.deliveredQuantity,
            "Regels niet meegeteld (annulering/eenheid)": dossier.excludedLines,
          }}
        />
      </section>
      <HistorySection dossier={dossier} />
      <section>
        <h2>Historische installatie en orders</h2>
        {!dossier.lines.length && (
          <p className="notice">Geen orderregels: dit dossier komt uit de projecthistorie (zie hierboven). Ordernummers en leverstatus zijn niet bekend.</p>
        )}
        <Table
          label="Orderregels"
          headers={["Splitsen", "Order / positie", "Documenttype", "Status", "Orderdatum", "Artikel", "Omschrijving", "Aantal", "Geleverd", "Familie", "Afleveradres", "Bron"]}
        >
          {dossier.lines.map((l) => (
            <tr key={l.id} className={l.counted === 0 ? "muted" : ""}>
              <td>
                <input
                  type="checkbox"
                  aria-label={"Selecteer regel " + l.document + "/" + l.position}
                  checked={selectedLines.includes(l.id)}
                  onChange={() =>
                    setSelectedLines(
                      selectedLines.includes(l.id) ? selectedLines.filter((id) => id !== l.id) : [...selectedLines, l.id],
                    )
                  }
                />
              </td>
              <td>{l.document} / {fmt(l.position)}</td>
              <td>{l.document_type}</td>
              <td>{l.line_state}{l.order_status ? ` (${l.order_status})` : ""}</td>
              <td>{fmt(l.order_date)}</td>
              <td>{l.article}</td>
              <td>{l.description}</td>
              <td>{l.quantity}{l.unit ? " " + l.unit : ""}</td>
              <td>{fmt(l.delivered_quantity)}</td>
              <td>{fmt(l.family)}</td>
              <td>{fmt([l.address, l.postcode].filter(Boolean).join(", "))}</td>
              <td>
                <details>
                  <summary>{l.filename} · regel {l.source_row}</summary>
                  <Values
                    items={{
                      Bronsysteem: l.source,
                      Importmoment: l.importDate,
                      Debiteur: l.debtor,
                      Debiteurnummer: l.debtor_number,
                      Goederenontvanger: l.recipient,
                      TOC: l.toc,
                      "Familie volgens bron": l.family_source,
                      "Historische prijs (geen actuele prijs)": l.price,
                    }}
                  />
                  <pre>{JSON.stringify(JSON.parse(l.raw), null, 2)}</pre>
                  {JSON.parse(l.warnings).map((w: string, i: number) => (
                    <p key={i}>{w}</p>
                  ))}
                </details>
              </td>
            </tr>
          ))}
        </Table>
        {admin && <div className="toolbar">
          <Input label="Naam afgesplitst project" value={splitName} onChange={(e) => setSplitName(e.target.value)} />
          <button
            disabled={busy || !selectedLines.length || selectedLines.length === dossier.lines.length || !splitName}
            onClick={async () => {
              if (await mutate("split", dossier.id, { lineIds: selectedLines, name: splitName }, "Project gesplitst")) {
                setSelectedLines([]);
                setSplitName("");
                open(dossier.id, "Bron & orders");
              }
            }}
          >
            Geselecteerde regels splitsen
          </button>
        </div>}
        <p>
          Splitsen behoudt de bronregels. Commerciële dossierinformatie blijft bij het
          oorspronkelijke project; beoordeel het nieuwe dossier apart. Grijze regels tellen niet
          mee in de historische stuks (geannuleerd of andere eenheid dan stuks).
        </p>
      </section>
    </>
  );
}

function Relations({ dossier, snap, mutate, busy }: Props) {
  const [linkId, setLinkId] = useState("");
  const [rel, setRel] = useState({ name: "", role: "Installateur", contact: "" });
  return (
    <section>
      <h2>Gekoppelde relaties</h2>
      <p>
        Een historische debiteur of goederenontvanger is niet automatisch de installateur of
        eindgebruiker. Koppel een rol pas na controle.
      </p>
      <Table headers={["Naam", "Rol", "Contact", "Nummer"]}>
        {dossier.relations.map((r) => (
          <tr key={r.id}>
            <td><strong>{r.name}</strong></td>
            <td>{r.role}</td>
            <td>{fmt(r.contact)}</td>
            <td>{fmt(r.number)}</td>
          </tr>
        ))}
      </Table>
      <div className="form-grid">
        <label>
          Bestaande relatie koppelen
          <select aria-label="Bestaande relatie koppelen" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
            <option value="">Kies een relatie</option>
            {snap.relations.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.role}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!linkId || busy}
          onClick={() => mutate("linkRelation", dossier.id, { relationId: linkId }, "Relatie gekoppeld")}
        >
          Relatie koppelen
        </button>
      </div>
      <h3>Nieuwe relatie aan dit dossier koppelen</h3>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await mutate("relation", "", { ...rel, projectId: dossier.id }, "Relatie gekoppeld"))
            setRel({ name: "", role: "Installateur", contact: "" });
        }}
      >
        <Input label="Naam relatie" required value={rel.name} onChange={(e) => setRel({ ...rel, name: e.target.value })} />
        <Select label="Rol relatie" options={relationRoles} value={rel.role} onChange={(e) => setRel({ ...rel, role: e.target.value })} />
        <Input label="Contactpersoon relatie" value={rel.contact} onChange={(e) => setRel({ ...rel, contact: e.target.value })} />
        <button className="primary" disabled={busy}>Relatie toevoegen</button>
      </form>
    </section>
  );
}
