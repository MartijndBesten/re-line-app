# Architectuur en besluiten

## Opbouw

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Node.js 24 LTS. Database: ingebouwde `node:sqlite`
(laptop) of PostgreSQL 16 via `pg` (centraal). Laptop: één server op 127.0.0.1 zonder inloggen. Centraal: zelfde
app met inloggen (wachtwoord of Entra ID) en rollen. Eén werk-API-route plus aanmeldroutes; logica in modules met tests.

| Laag | Bestand(en) | Verantwoordelijkheid |
|---|---|---|
| Projecthistorie | `lib/history.ts`, `scripts/import-projecthistorie.ts`, `app/history.tsx` | SAP-rapport "E-Line Projects" herkennen (allowlist van kolommen; kostprijs/marge nooit ingelezen), stabiele bronsleutel per regel, renovatiescore met uitleg, top-n-selectie; CLI met proef op kopie, back-up en controles; weergave in dossier |
| Import | `lib/import.ts` | CSV/XLSX/Markdown lezen, kolomherkenning (NL + verwachte Duitse SAP-namen; een kolom nooit aan twee velden), Europese getallen/datums, regelstatus (normaal/retour/geannuleerd), eenheid, bronidentiteit, bestands-SHA-256 |
| Profielen | `lib/profiles.ts` | Opgeslagen kolomkoppelingen, herkenning op kolomnamen, verwachte Duitse SAP-velden, validatie van koppelingen |
| Domein | `lib/domain.ts` | Velden, statussen, pipelinefasen, activiteitsoorten, gespreksuitkomsten, rollen, scoring |
| Databaselaag | `lib/sql.ts` | Eén asynchrone interface met SQLite- en PostgreSQL-driver; transacties per verzoek (AsyncLocalStorage), `?`→`$n`, dialecthulp (aggregatie, REAL) |
| Opslag | `lib/db.ts` | Repository (SQLite én PostgreSQL): schema + versioned migraties + back-up, import/deduplicatie/clustering, dossiers, bewijsplicht, gespreksregistratie, bulkacties, gezamenlijke acties, profielen, samenvoegen/splitsen |
| Commercieel | `lib/opportunities.ts`, `lib/commercial.ts`, `lib/dossier.ts`, `lib/worklist.ts` | Onderzoeksfase, bellijst-CSV, vaste gespreksvragen + laatste antwoorden, intern gespreksdossier, portefeuilles, ontbrekende gegevens, verwante dossiers, prioriteitsuitleg, werkvoorraad per datum |
| Scenario's | `lib/calculator.ts`, `lib/proposal.ts` | Conceptcalculatie zonder standaardprijzen; vergelijking en intern overzicht |
| Toegang | `lib/auth.ts`, `lib/guard.ts`, `lib/mail.ts`, `app/api/auth/*`, `app/login.tsx` | Accounts, scrypt-wachtwoorden, activatielinks, inloglink per e-mail (uitnodiging, eenmalig token in #-fragment, SMTP), server-side sessies, inlogrem, Entra ID (OIDC + PKCE, app-rollen); poort per verzoek: host, origin, sessie, rol; handelen namens de gebruiker (`asActor`) |
| Uitrol/demo | `scripts/schone-deploybron.mjs`, `scripts/demo-vullen.ts`, `pilot/pilot.ts` | Code-only deploybron met lekcontrole en `render.yaml`; synthetische demovulling |
| Overstap | `lib/migrate-pg.ts`, `scripts/migreer-naar-postgres.ts` | SQLite → lege PostgreSQL in één transactie, controle per tabel (aantal + controlegetal) |
| HTTP | `app/api/workbench/route.ts` | GET snapshot/dossier (+ versiecontrole), POST-acties met server-side validatie; beheeracties alleen voor beheerders |
| UI | `app/page.tsx` (shell) + `dashboard`, `opportunities`, `sales`, `commercial` (portefeuille, belvoorbereiding), `projects`, `relations`, `importer`, `settings`, `dossier`, `proposal`, `ui` | Nederlandstalige werkplekken; dossier met tabbladen |
| Start | `scripts/start.mjs`, `Re-Line-starten.cmd` | Node-versiecontrole, installeren/bouwen alleen bij wijziging, starten, browser openen |

PostgreSQL: zelfde repository en SQL op beide databases (unit-tests draaien op allebei); import-, domein- en
commerciële regels zijn ongewijzigd gebleven.

## Schema en migraties

- **v1** (fase 1, Codex): ongewijzigd vastgelegd als `schemaV1` in `lib/db.ts`.
- **v2** (P1): uitsluitend toevoegende kolommen/tabel: orderregel (regel-ID, TOC, eenheid, geleverde
  hoeveelheid, leverdatum, order-/leverstatus, regelstatus, `counted`, postcode, land, regio,
  goederenontvangernummer, familie volgens bron, valuta), import (profiel, SHA-256, aantal regels),
  dossier (bron per bevestiging), activiteit (uitkomst, rol, kanaal, antwoorden, groep, relatie),
  tabel `import_profiles`.
- **v3** (november 2026): tabel `history_lines` (projecthistorie: SAP-projectnummer, boekjaar, klant,
  materiaal, reeks, goederenontvanger, projectplaats/-straat, afzet, omzet, net-net-omzet, ruwe bronvelden
  zonder kostprijs/marge), kolom `projects.candidate_rank` (vaste werkvoorraad), kolom `imports.kind`.
  Projecthistorie staat bewust **niet** in `order_lines`: er zijn geen ordernummers of leverstatus.
- **v4** (november 2026, samenwerken): tabellen `users`, `sessions`, `rate_limits`, `oidc_requests`,
  `source_records` (laatst verwerkte SAP-projectgegevens per projectnummer), `history_line_changes`
  (wijzigingslog per historieregel); `audit.user_id/user_name`; `projects.version/updated_at/updated_by/created_at`;
  `activities.created_by`; `imports.created_by`. Eenmalig: historiesleutels herberekend op de stabiele identiteit
  (project, boekjaar, klantnummer, materiaal, ontvanger) en bronrecords gevuld; niets dubbel (getest).
- Bij openen: schemaversie lezen (`PRAGMA user_version` op SQLite, tabel `re_line_schema` op PostgreSQL); een nieuwere database dan de app wordt geweigerd. Openstaande
  migraties draaien per versie in één transactie. **Een bestaande database krijgt vooraf automatisch
  een back-up** (`VACUUM INTO` naar `data/backups/<naam>-voor-schema-vN-<tijd>.sqlite`).
- v2 vult eenmalig beschrijvende bronvelden (TOC, familie volgens bron, postcode, land, regio,
  goederenontvangernummer, valuta) aan uit de bewaarde ruwe bronregel. Aantallen, status, eenheid en
  identiteit van bestaande regels worden niet herberekend, zodat tellingen niet verschuiven.
- Getest: migratie v1→v2 op een synthetische v1-database (unit-test) én op een kopie van de
  validatiedatabase met de echte CSV (181 dossiers, notitie behouden, back-up aangemaakt). v2→v3:
  unit-test (back-up, gegevens en activiteit behouden) en kopieën van de validatiedatabases.
- Projecthistorie-koppeling: sleutel `sapproject:<nummer>`, anders een bestaand dossier met hetzelfde
  `project_number`; anders een nieuw dossier. Bij een bestaand dossier worden alleen lege plaats/adres/
  projectnummer aangevuld (adres alleen als de locatie niet bevestigd is). Dezelfde bronregel met andere
  bedragen wordt gemeld en niet overschreven.

## Bronidentiteit en herkenning

Identiteit = SHA-256 van bronsysteem + stabiele regel-ID, anders bronsysteem + order + positie +
artikel; zonder positie aangevuld met datum, aantal, project, plaats en omschrijving (met waarschuwing).
Herkenning: exact SAP-projectnummer → naam + plaats (genormaliseerd) → alleen dezelfde order. Geen
fuzzy matching en nooit clusteren op debiteur. *Mogelijk verwante dossiers* (zelfde plaats en
naam-prefix of gedeeld naamdeel, of zelfde projectnummer) zijn alleen een voorstel; samenvoegen
blijft een handmatige, bevestigde actie. Gewijzigde bestaande bronregels worden als conflict gemeld,
nooit overschreven. Samenvoegen bewaart oude dossiergegevens en scenario's in de tijdlijn.

## Technische waarheidsgrenzen

- Geen lengte uit productnaam, geen levering uit orderaanwezigheid, geen eindgebruiker uit debiteur,
  geen installatiejaar uit orderjaar.
- Relevante aantallen vereisen een **bevestigde** E-/C-Line-classificatie met bron. Projectmeters
  alleen als iedere meegetelde regel een bevestigde lengte heeft.
- Geannuleerde regels en andere eenheden dan stuks tellen niet als stuks (`counted = 0`), blijven zichtbaar.
- **Bewijsplicht** (server-side, `checkEvidence`): aanwezig/vervangen/behoefte ≠ "Onbekend" en
  "locatie gecontroleerd" vereisen een bron; locatie ook een adres. Ongewijzigde oude waarden blokkeren niet.
- Gespreksregistratie wijzigt het dossier alleen voor expliciet aangevinkte bevestigingen, met het
  gesprek als bron. Een geplande actie wordt alleen afgerond als de gebruiker die kiest.
- Bulkstatus "geselecteerd voor contact" geldt alleen voor dossiers in onderzoek (`statusFrom`), zodat
  een lopend traject niet terugvalt.
- Scenario-totaal alleen met alle posten, prijsbron, peildatum en technische controle met naam.
  Historische prijzen blijven bronwaarde, nooit renovatieprijs. Geen energie-/CO₂-berekening.
- Klantconcept: vaste lokale tekst; geen LLM, geen verzending, geen interne prijzen of SAP-referenties.

## Veiligheid

**Laptop (`RELINE_AUTH=uit`, SQLite):** server op 127.0.0.1; muterende verzoeken vereisen gelijke Origin/Host op
localhost (CSRF/DNS-rebinding). Eén lokale gebruiker, geen inloggen.

**Inloglink (`email`):** alleen uitgenodigde adressen; token 256 bit, hash in de database, 15 minuten, eenmalig
(atomair), in het #-fragment (niet in logs/referrers) en pas na een klik verbruikt; geen accountenumeratie (zelfde antwoord,
mail na het antwoord); limieten per adres en per client; mail alleen met TLS.

**Centraal (`lokaal`/`entra`/`email`, PostgreSQL):** inloggen verplicht (een centrale database zonder inloggen wordt
geweigerd). Toegestane host = localhost + host van `RELINE_PUBLIC_URL`; Origin-controle op iedere schrijfactie.
Sessies server-side (token 256 bit, alleen SHA-256 opgeslagen; 12 u absoluut, 4 u inactief; `__Host-`-cookie,
HttpOnly, SameSite=Lax, Secure bij https). Wachtwoorden scrypt; activatielinks eenmalig (72 u, alleen hash).
Inlogrem gedeeld via de database; client-adres van de vertrouwde proxy. Entra ID: autorisatiecode + PKCE, state en
nonce (eenmalig, 10 min), ondertekend ID-token, rol uit app-rollen; zonder rol of na deactivering geen toegang.
Rollen server-side afgedwongen (403). Audit met gebruiker; alleen beheerders zien auditlog en e-mailadressen.
Optimistische vergrendeling per dossier (409 met naam, niets overschreven).

**Altijd:** SQL geparametriseerd; dossiervelden via allowlist; React escapet brondata. Bestandslimiet 15 MB /
20.000 regels; XLSX alleen uit vertrouwde interne exports (8 matige meldingen in de `exceljs`-keten). Kostprijs,
korting en marge uit SAP worden nooit ingelezen. Beveiligingsheaders (`next.config.ts`): CSP met alleen eigen bronnen,
frame-ancestors none, nosniff, no-referrer, HSTS achter een https-proxy, `no-store` op API's. Geen e-mail en geen
externe verzoeken vanuit de app, behalve (Entra-modus) de aanmelding bij Microsoft. Geen deploymentconfiguratie in
de repository. Dynamische bestandsaanroepen voor database en back-ups zijn voor Turbopack gemarkeerd. Alle pakketten
staan vast in `package-lock.json`.
