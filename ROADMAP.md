# Roadmap

Stand 3 november 2026 (Claude Code); eerdere stand 8 oktober 2026 na P0 en P1. Leidende fasering en criteria:
`../../output/ROADMAP_FASE2.md`; open vragen in root-`VRAGEN.md`.

## Gereed

- **Fase 1A–1D**: import, herkenning, dossiers, relaties, pipeline, Kansen, Portefeuilles,
  belvoorbereiding, scenariovergelijking — getest en hersteld (P0).
- **P1**: dossier met tabbladen en dossierkaart; gespreksregistratie met bewijs; bewijsplicht;
  toewijzen en belacties plannen vanuit Kansen; werkvoorraad per persoon; pipeline per fase;
  portefeuille-acties en gezamenlijke afspraken; mogelijk verwante dossiers; Duitse SAP-kolomnamen,
  regel-ID, annuleringen/eenheden, importprofielen, herkenningspreview; schema v2 met automatische
  back-up; back-up vanuit Instellingen; Windows-starter.
- **Projecthistorie (november 2026)**: SAP-export E-Line Projects, 237 dossiers, top 100 met uitleg.
- **Samenwerkingsbasis (november 2026, lokaal getest, niet live)**: PostgreSQL naast SQLite, accounts en rollen,
  Entra ID (gesimuleerd getest), audit met gebruiker, geen stil overschrijven, SAP-import met vergelijking,
  overstap laptop → PostgreSQL met controle per tabel.

## Volgende stappen (afhankelijk van bronnen of besluiten)

1. **Duitse SAP-export (V-003)** — eerste echte bestand importeren via de preview, koppeling als
   profiel bewaren, statuswaarden (geannuleerd/retour/geleverd) tegen de werkelijke SAP-codes
   controleren en zo nodig de trefwoorden in `lib/import.ts` (`lineState`) aanvullen.
2. **Artikelcatalogus (V-004, V-009)** — familie, generatie en nominale lengte per artikel met bron
   bevestigen; daarna werken relevante aantallen, prioriteit en (bij bevestigde lengte) meters.
3. **Herkenning** — na echte afleveradressen/goederenontvangers: verwante-dossiervoorstellen ook op
   adres/postcode; expliciete regels voor nieuwe regels na een handmatige splitsing.
4. **Scenario's (V-006)** — met goedgekeurde tarieven en compatibiliteitsregels: prijsregels per
   eenheid met bron/peildatum; pas daarna klant-PDF met menselijke goedkeuring.
5. **Centrale omgeving (V-014–V-017, V-010)** — technisch gebouwd; open: hostingkeuze en inrichting door
   TRILUX-IT, Entra-app-registratie (echte aanmelding testen), privacy/OR, bewaartermijnen, startdata. Pas daarna
   deployscript en rooktest met lege database en testaccounts. Zie `../../output/VOORSTEL_CENTRALE_OMGEVING.md`.
6. **CRM (V-007)** — eerst read-only Salesforce; schrijven alleen na expliciet besluit.
7. **Energie/CO₂** — alleen met nulmeting, branduren, vermogens en gevalideerde rekenregels.
8. ~~Logo~~ — vastgesteld op 9 oktober 2026 (V-011).

## SAP-velden met de hoogste waarde

Stabiele regel-ID; documenttype én order-/leverstatus; geleverde hoeveelheid en leverdatum;
SAP-projectnummer en fase; goederenontvanger(nummer), afleveradres, postcode, plaats, land;
artikelnummer, TOC, omschrijving, eenheid; debiteur(nummer); retour-/annuleringsverwijzingen;
valuta en prijsgrondslag. Ontbrekende velden blijven onbekend. Zie `../../source/SAP_DATA_CONTRACT.md`.
