# Re-Line | Utiliteit — handleiding

Lokaal commercieel werkplatform om historische E-Line/C-Line-orders terug te vinden, te
kwalificeren en renovatiekansen op te volgen. Alles draait op je eigen laptop: geen
cloudaccount, geen AI-dienst, geen SAP-/Salesforce-koppeling en geen e-mailverzending.

> **Belangrijk:** een historische order bewijst geen levering, een afleveradres geen
> installatielocatie, een debiteur geen eindgebruiker en een aantal stuks geen lijnmeters.
> Re-Line laat precies zien wat bekend is, wat niet, en wat je nog moet vragen.

## Re-Line openen op je Windows-laptop

**Eenmalig voorbereiden (± 10 minuten)**

1. Installeer **Node.js 24 LTS (64-bit)** via <https://nodejs.org> (knop "LTS"). Standaardopties zijn goed.
2. Haal de projectbranch `project/re-line-utiliteit` op (GitHub Desktop of als ZIP van de private
   repository) en zet die in een vaste map, bijvoorbeeld `C:\Re-Line\martijn-ai-workbench`.

**Starten (iedere keer)**

1. Open in Verkenner de map `projects\re-line-utiliteit\engineering\app`.
2. Dubbelklik op **`Re-Line-starten.cmd`**.
   - De eerste keer installeert en bouwt hij de app (enkele minuten). Daarna start hij binnen een paar seconden.
   - De browser opent vanzelf op `http://127.0.0.1:3000`. Gebeurt dat niet: typ dat adres zelf.
3. Laat het zwarte venster open zolang je werkt. **Stoppen:** sluit het venster (of Ctrl+C).

Na een update van de broncode (nieuwe versie opgehaald) bouwt de starter automatisch opnieuw.
Krijg je de melding dat Node.js ontbreekt of een verkeerde versie heeft: installeer Node.js 24 LTS.

Alternatief via PowerShell in dezelfde map: `npm.cmd run app`.

> Deze starter is op 9 oktober 2026 op Windows 11 getest (Node.js 24.19.0): eerste start met
> installeren en bouwen, tweede start binnen een seconde zonder herinstallatie, server alleen op
> 127.0.0.1. Gaat er toch iets mis: meld het met de tekst uit het zwarte venster.

## Projecthistorie: alle E-Line-projecten uit SAP (sinds november 2026)

Het SAP-rapport **"E-Line Projects 2009_2026 50k TX NL.xlsx"** (blad *Details*: 7.252 verkoopregels,
237 SAP-projectnummers) wordt als **projecthistorie** ingelezen: één dossier per SAP-projectnummer, met
klant, goederenontvanger, projectplaats en -straat, boekjaren, materialen, productreeks, afzet en omzet.

> **Wat het wel en niet is.** Projecthistorie is SAP-verkoop per boekjaar. Er zijn **geen ordernummers,
> leverstatus of leverdata**; die worden ook niet verzonnen. Afzet is de SAP-hoeveelheid (eenheid staat
> niet in de export), omzet is historische verkoop (valuta niet vermeld) en zegt niets over de huidige
> installatie. Kostprijs-, korting- en margekolommen (*Bonus+Skonto, KdUmsatzes, SOF Leistung, varHK DBW,
> HK DBW, DBW II, DBW II %*) worden niet ingelezen en niet bewaard.

**Vullen op de Windows-laptop** (eenmalig; Re-Line mag daarbij openstaan, maar herstart daarna):

```powershell
cd C:\…\projects\re-line-utiliteit\engineering\app
npm.cmd run import:projecthistorie -- --bestand "C:\Users\<naam>\Downloads\E-Line Projects 2009_2026 50k TX NL.xlsx" --proef
npm.cmd run import:projecthistorie -- --bestand "C:\Users\<naam>\Downloads\E-Line Projects 2009_2026 50k TX NL.xlsx"
```

1. `--proef` draait alles op een kopie van je database (twee keer, om dubbelen uit te sluiten) en toont
   de controles. Je echte database blijft onaangeroerd.
2. Zonder `--proef`: eerst een back-up (`data\backups\…-voor-projecthistorie-….sqlite`), dan de import,
   de controles en het bepalen van de **top 100 renovatiekandidaten**. Bestaande dossiers, notities,
   statussen, bevestigingen en activiteiten blijven ongewijzigd; alleen lege plaats/adres worden aangevuld.
3. Nogmaals uitvoeren is veilig: dezelfde regels worden overgeslagen (0 nieuw).

Hetzelfde kan via **Import**: Re-Line herkent het rapport, toont een voorbeeld en maakt bij bevestigen
eerst een back-up. De uitvoer bevat alleen tellingen, geen klantgegevens.

**Werken met de projecthistorie**

- **Kansen → Werkvoorraad**: *Top 100 renovatiekandidaten* (vast, op rangnummer), *Alle projecthistorie*
  (op renovatiescore) of *Orderregels* (het oorspronkelijke filter op stuks en orderjaar). Filters op
  eerste boekjaar, productreeks, projectplaats, minimale net-net-omzet en prioriteit. Per dossier staan de
  twee sterkste redenen en wat de score het meest drukt ("lager door …").
- **Projecten**: alle dossiers; filters *Werkvoorraad* (kandidaten/overige), *Productfamilie / reeks*,
  *Oudste jaar* (order of boekjaar), *Minimale omzet projecthistorie*, prioriteit, plaats, status.
- **Dossier**: kerncijfers (boekjaren, net-net-omzet, kandidaatnummer), dossierkaart met samenvatting,
  tabblad *Bron & orders* met de volledige projecthistorie per boekjaar, per reeks en per regel (met de
  originele bronvelden). Relaties (klant als *Debiteur*, goederenontvanger) zijn gekoppeld; een klant is
  niet automatisch installateur of eindgebruiker.
- Regio: de export bevat geen regio of postcode (organisatie-eenheid is voor alle regels *TX NL*). Filter
  daarom op **projectplaats**.

**Renovatiescore (0–100) voor dossiers met projecthistorie**

| Criterium | Max. | Hoe |
|---|---|---|
| Ouderdom (eerste boekjaar) | 30 | ≥15 jaar 30 · 12–14: 26 · 10–11: 22 · 8–9: 16 · 6–7: 10 · 4–5: 4 · jonger: 0 |
| Oudere E-Line-reeks | 20 | reeks "E-Line Old" volgens SAP-materiaalstam aanwezig: 8 + 12 × aandeel in net-net-omzet |
| Omvang historische verkoop | 20 | net-net-omzet ≥1 mln 20 · ≥500k 17 · ≥250k 14 · ≥100k 10 · ≥50k 6 · >0 3 |
| Herkenbaarheid | 10 | projectnaam 4 · projectplaats 3 · straat 3 |
| Klant- en relatiegegevens | 5 | klant 3 · goederenontvanger 2 |
| Meerdere projecten via dezelfde klant | 5 | ≥5 projecten 5 · 3–4: 4 · 2: 2 |
| Bevestigd in gesprekken | 10 | renovatiebehoefte 5 · locatie 3 · relatie 2 (bij import 0) |

De **top 100** wordt eenmalig vastgelegd (rangnummer + opgeslagen selectie). Opnieuw bepalen:
`npm.cmd run import:projecthistorie -- --bestand "…" --herselecteer`; status, eigenaar en notities veranderen
daarbij niet. Omzet en afzet sorteren alleen; ze zijn geen installatieomvang.

## Eerste keer: van export naar werkvoorraad

Het **Dashboard** toont deze stappen met een vinkje zodra ze gedaan zijn.

1. **Import** — kies de export (CSV, XLSX of Markdown) → *Voorbeeld bekijken*. Controleer de
   veldkoppeling, de fouten en wat de import doet (nieuwe dossiers / bij bestaande dossiers /
   regels die niet als stuks meetellen). Pas dan *Import bevestigen*. Dezelfde export nogmaals
   importeren voegt niets dubbel toe en laat je notities ongemoeid.
2. **Instellingen → artikelcatalogus** — bevestig per artikel de productfamilie **met bron**
   (bijv. historische catalogus of productmanagement). Pas daarna tellen de aantallen als
   E-/C-Line mee in de prioriteit. "Familie volgens bron" is alleen een aanwijzing. Vul een
   profiellengte alleen in met een bron; "-2,5" in de omschrijving is géén lengte.
3. **Kansen** — schift op minimaal aantal stuks en oudste orderjaar, selecteer dossiers,
   **wijs ze toe** aan een collega en **plan de eerste belactie**.
4. **Salesopvolging** — je werkvoorraad (achterstallig, vandaag, deze week, later). Klik
   *Gesprek registreren* om direct in het dossier te noteren wat het gesprek opleverde.

## Werkplekken

| Tab | Waarvoor |
|---|---|
| **Dashboard** | Stappen "Aan de slag", kerncijfers, acties voor vandaag/achterstallig, pipeline per fase. |
| **Kansen** | Onderzoeks- en bellijst. Onderzoeksfase per dossier (brononderzoek, locatie controleren, contact voorbereiden, in opvolging, afgesloten), prioriteit mét uitleg, bronvolledigheid apart. Selecteren → toewijzen, "selecteren voor contact + belactie plannen", interne CSV-bellijst (beveiligd tegen spreadsheetformules). |
| **Salesopvolging** | Werkvoorraad per verantwoordelijke, pipeline per fase/status, recente gesprekken. Een gezamenlijke afspraak over meerdere locaties staat als één regel. |
| **Portefeuilles** | Per historische relatie (debiteur, installateur, goederenontvanger …) de unieke dossiers met kerncijfers. Selecteer dossiers om toe te wijzen, één **gezamenlijke afspraak** te plannen of — na bevestiging — de relatie als **installateur** van die dossiers vast te leggen. |
| **Projecten** | Alle voorlopige dossiers: zoeken, filteren (o.a. op verantwoordelijke), selecties bewaren, samenvoegen. |
| **Relaties** | Rollen en contactgegevens beheren. Een debiteur is niet automatisch installateur of eindgebruiker. |
| **Import** | Importeren met preview, opgeslagen importprofielen, voorbereiding op de Duitse SAP-export, importgeschiedenis met controlecode. |
| **Instellingen** | Artikelcatalogus, prioriteringsgewichten, **back-up maken**, auditlog. |

## Het projectdossier

Een dossier heeft vijf tabbladen:

- **Overzicht** — de *dossierkaart*: wat historisch mogelijk geleverd is, wat we weten (met de bron
  van iedere bevestiging), wat we nog niet weten (met de actie om het uit te zoeken), welke vragen
  nog open staan, de volgende actie en de drie technische richtingen. Daaronder *mogelijk verwante
  dossiers* (zelfde plaats en bijna dezelfde naam, bijv. een andere fase — alleen samenvoegen na
  controle), de uitleg van de prioriteit en de commerciële beoordeling.
- **Gesprek** — belvoorbereiding (bekende feiten, open punten, 9 vaste vragen met het laatste
  antwoord, intern gespreksdossier downloaden), **gesprek registreren**, actie of notitie plannen,
  concept klantopvolging (vaste tekst, niets wordt verzonden) en de tijdlijn.
- **Bron & orders** — herkenning, alle orderregels met status, eenheid en de oorspronkelijke
  bronvelden; regels afsplitsen naar een nieuw dossier.
- **Relaties** — gekoppelde relaties met hun rol; bestaande koppelen of nieuwe toevoegen.
- **Scenario's** — drie richtingen naast elkaar en de conceptcalculatie per scenario.

### Bevestigen = bron vastleggen

"Installatie nog aanwezig", "al vervangen", "renovatiebehoefte" en "installatielocatie
gecontroleerd" kun je alleen opslaan **met een bron** (wie, hoe, wanneer). Een gecontroleerde
locatie vraagt ook een adres. Het snelst gaat dat via **Gesprek registreren**:

1. Vul in met wie je sprak (rol, kanaal), de uitkomst en een korte samenvatting.
2. Noteer per vaste vraag het antwoord (Ja/Nee/Onbekend/n.v.t.) met toelichting.
3. Kies onder *In dossier vastleggen* alleen wat in dit gesprek echt is bevestigd. Re-Line legt
   het gesprek (datum, naam, rol, kanaal) automatisch als bron vast. Een antwoord "Ja" op een vraag
   wijzigt het dossier **niet** vanzelf.
4. Optioneel: een geplande belactie hiermee afronden, een vervolgactie plannen, de huidige
   installateur als relatie koppelen en de salesstatus bijwerken.

### Scenario's

Drie richtingen: retrofit in bestaande profielen (alleen na aantoonbare compatibiliteit), complete
lichtlijnvervanging, slimme verlichting. Alle bedragen vul je zelf in als totaalbedragen exclusief
btw. Een totaal verschijnt pas als meters, modules, materiaal, montage, inbedrijfstelling, overige
kosten, **prijsbron met peildatum** en de **technische controle met naam** compleet zijn. "Per meter"
is daarvan afgeleid. Er worden geen standaardprijzen, energie-, CO₂- of terugverdienclaims berekend.
Het interne overzicht is geen offerte.

## Prioriteit en datakwaliteit

De prioriteit is per criterium uitgelegd (Kansen-tabel en dossier → *Waarom deze prioriteit?*).
Leeftijd van de oudste order (max. na 20 jaar), **bevestigd geclassificeerde** E-/C-Line-aantallen
(max. bij 500), aantal orders (max. bij 5), en pas na bevestiging: locatie, commerciële relatie,
renovatiebehoefte. Gewichten instelbaar onder Instellingen. Hoog vanaf 60, middel vanaf 30.
**Datakwaliteit/bronvolledigheid** staat er los van: 20% per beschikbaar bronveld (plaats,
SAP-projectnummer, afleveradres, orderjaar, hoge herkenningszekerheid).

## Import en herkenning

- Verplicht: ordernummer, artikelcode en aantal. Max. 15 MB / 20.000 regels.
- Herkenning: exact SAP-projectnummer (hoog), anders gelijke naam + plaats (middel), anders alleen
  dezelfde order (laag). Nooit clusteren op debiteur; naamloze orders blijven losse dossiers.
- Dubbelen: zelfde bron + order + positie + artikel (of een stabiele regel-ID) wordt overgeslagen;
  dezelfde bronregel met andere inhoud wordt als conflict gemeld en nooit overschreven.
- Geannuleerde regels (status zoals *storniert*, *annulé*, *geannuleerd*) en regels met een andere
  eenheid dan stuks blijven zichtbaar maar tellen niet mee als historische stuks. Negatieve aantallen
  zijn retour/correctie.
- **Importprofiel**: na een geslaagde controle kun je de veldkoppeling bewaren. Bij een volgend
  bestand met dezelfde kolommen wordt het profiel automatisch toegepast.
- **Duitse SAP-/Qlik-export**: Re-Line herkent gangbare Duitse kolomnamen (Verkaufsbeleg, Position,
  Material, Auftragsmenge, Liefermenge, Gesamtstatus, Warenempfänger, PLZ …). Dit is een
  verwachting, geen bevestigde specificatie: controleer de koppeling (zie *Import → Voorbereid op de
  Duitse SAP-/Qlik-export* en `source/SAP_DATA_CONTRACT.md`).
- Een eerder geïmporteerd bestand (zelfde inhoud) wordt herkend en gemeld.

## Opslag, back-up en privacy

- Database: `data\re-line.sqlite` in deze appmap (projecten, orderregels, projecthistorie, notities,
  gesprekken, scenario's, auditlog). De map `data` gaat nooit naar GitHub; Excel-exports (`*.xlsx`) worden
  in de app- en bronmap door Git genegeerd.
- **Back-up:** Instellingen → *Back-up maken* zet een volledige kopie in `data\backups`. Vóór iedere
  schemawijziging (nieuwe versie van Re-Line) maakt Re-Line automatisch een back-up. Kopieer
  back-ups naar goedgekeurde bedrijfsopslag.
- **Terugzetten:** stop Re-Line, zet de huidige `re-line.sqlite` (en `-wal`/`-shm`) apart, kopieer
  de back-up naar `data\re-line.sqlite` en start opnieuw.
- De database is niet versleuteld; gebruik een beveiligde Windows-account. Op de laptop: één lokale
  gebruiker zonder inloggen. Server alleen op `127.0.0.1` (niet bereikbaar vanaf het netwerk).
- De aangeleverde proefbronnen staan in de private projectbranch onder `../../source/` (op verzoek
  toegevoegd, zie `decisions/DECISIONS.md`). Nieuwe exports en databases blijven buiten Git.

## Samenwerken: centrale omgeving (gebouwd en lokaal getest, nog niet in gebruik)

Re-Line kan ook centraal draaien voor meerdere collega's, met inloggen, rollen en een PostgreSQL-database.
**Er staat nog niets online**: eerst moeten TRILUX-IT, privacy en zo nodig de OR akkoord geven (VRAGEN V-014 t/m
V-017; voorstel: `../../output/VOORSTEL_CENTRALE_OMGEVING.md`). Zonder die instellingen werkt Re-Line precies zoals
hierboven (laptop, geen inloggen).

| Instelling | Betekenis |
|---|---|
| `RELINE_AUTH` | `uit` (standaard, laptop), `lokaal` (wachtwoordaccounts), `entra` (Aanmelden met Microsoft) of `email` (alleen op uitnodiging, inloglink per e-mail) |
| `RELINE_MAIL_SMTP_URL`, `RELINE_MAIL_FROM` | bij `email`: SMTP van een geverifieerde mailprovider (`smtp://…:2525` of `:587` met STARTTLS, `smtps://…:465`) en afzender; geheim, nooit in Git |
| `RELINE_BOOTSTRAP_ADMIN_EMAIL`, `_NAME` | bij `email`: eerste beheerder, alleen zolang er nog geen account is (hosting zonder serverconsole) |
| `RELINE_EMAIL_DOMAINS` | optioneel: alleen adressen op deze domeinen kunnen worden uitgenodigd (een domein geeft nooit zelf toegang) |
| `RELINE_DEMO=1` | afgeschermde demo: melding "uitsluitend fictieve gegevens"; `npm run demo:vullen` vult een lege database met de synthetische pilotset |
| `RELINE_DATABASE_URL` | `postgres://…` van de centrale database (dan is inloggen verplicht); anders SQLite (`RELINE_DB`) |
| `RELINE_DB_SSL=1` | TLS naar de database |
| `RELINE_PUBLIC_URL` | het adres van Re-Line (bijv. `https://re-line.example`); bepaalt toegestane host en Entra-terugkeeradres |
| `RELINE_ENTRA_TENANT_ID`, `RELINE_ENTRA_CLIENT_ID`, `RELINE_ENTRA_CLIENT_SECRET` | app-registratie (van TRILUX-IT; geheim alleen in de sleutelkluis) |
| `RELINE_ENTRA_ADMIN_ROLE`, `RELINE_ENTRA_USER_ROLE` | app-rollen, standaard `Re-Line.Beheerder` en `Re-Line.Gebruiker` |
| `RELINE_SESSION_HOURS`, `RELINE_SESSION_IDLE_HOURS` | sessieduur (standaard 12) en inactiviteit (standaard 4) |
| `RELINE_PROXY_HOPS` | aantal vertrouwde proxy's vóór de app (standaard 1) |

- **Rollen:** beheerder (SAP-import, top 100, catalogus, gewichten, accounts, auditlog, samenvoegen/splitsen) en
  gebruiker (alle dossiers zien en bijwerken, gesprekken en acties vastleggen, toewijzen).
- **Eerste beheerder (wachtwoordaccounts):** `npm run gebruiker -- --maak --beheerder --email … --naam "…"` geeft een
  eenmalige activatielink. Daarna maakt de beheerder collega's aan via Instellingen → Gebruikers en rollen.
  `npm run gebruiker -- --lijst` toont de accounts. Met Entra ID bepaalt de app-rol in de TRILUX-tenant wie
  beheerder is.
- **Gelijktijdig werken:** slaat een collega hetzelfde dossier eerder op, dan zie je "intussen gewijzigd door …" met
  *Actuele versie laden*; er wordt niets overschreven.
- **Overstap van de laptop:** `npm run migreer:postgres -- --van data/re-line.sqlite --proef`, daarna zonder `--proef`
  en tot slot `--controleer` (doeladres in `RELINE_DATABASE_URL`; alleen naar een lege database; controle per tabel).
- **Online demo (issue #123):** `node scripts/schone-deploybron.mjs --uit <map> --bron-xlsx <echte export>` maakt een
  code-only deploybron (zonder bronbestanden, data of historie; controleert alle bestanden op namen/nummers uit de echte
  bronnen) met `render.yaml`. Status, blokkades en werkinstructie: `../../output/ONLINE_RELINE_STATUS.md`.
- **Back-up centraal:** via de database-omgeving (point-in-time restore); de back-upknop in Re-Line geldt alleen voor SQLite.
- **Acceptatiepilot (alleen fictief/synthetisch):** in een lege centrale database `npm run pilot:voorbereiden` (met
  `RELINE_AUTH`, `RELINE_DATABASE_URL`, `RELINE_PUBLIC_URL`): drie fictieve accounts met activatielinks en een synthetische
  SAP-export (`data/pilot/…xlsx`) om via Import in te lezen. Weigert een database met gegevens. Draaiboek en
  acceptatietests: `../../output/PILOT_ACCEPTATIE_EN_IMPLEMENTATIEPLAN.md`; IT-voorstel: `../../output/VOORSTEL_TRILUX_IT.md`.

## Voor ontwikkelaars: controles

Vanuit deze map, met Node.js 24:

```powershell
npm.cmd ci
npm.cmd test                 # 62 unit-tests (2 alleen op PostgreSQL), synthetische in-memory SQLite
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:browser     # 13 Playwright-tests, eigen testdatabase per run (dev-server)
$env:RELINE_BROWSER_PRODUCTION = "1"; npm.cmd run test:browser   # zelfde tests op de productiebuild
npm.cmd run validate:source  # na build: echte Product Finder-CSV in een aparte database
```

Linux (met PostgreSQL 16 geïnstalleerd; tijdelijke cluster alleen via een unix-socket, wordt na afloop verwijderd):

```bash
npm run test:pg                       # dezelfde unit-tests op PostgreSQL (+ overstaptests)
npm run build && npm run test:team    # 24 scenario's: samenwerken (7), Entra gesimuleerd (4), pilot AT-01–AT-09 (9), inloglink per e-mail met test-mailserver (4)
RELINE_TEAM_PG=1 npm run test:team    # idem op PostgreSQL
```

Op Windows eenmalig `npx.cmd playwright install chromium` voor de browsertests. Op Linux kan
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` naar een geïnstalleerde Chromium wijzen. Testdatabases, back-ups en
testresultaten staan in genegeerde mappen.

Zie [ARCHITECTUUR.md](ARCHITECTUUR.md) (opbouw en besluiten) en [ROADMAP.md](ROADMAP.md) (wat nog volgt).
