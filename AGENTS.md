<!-- BEGIN AUTONOMIE 2026-11-09 -->
## Werkafspraak: zelfstandig afronden (besluit Martijn, 9 november 2026)

Deze actuele afspraak geldt voor ChatGPT, Codex, Claude Code en andere ontwikkelagents. Zij vervangt oudere algemene goedkeurings-, publicatie- en testverplichtingen in deze repository voor software- en websitewerk. Bewaar inhoudelijke productbesluiten, gegevensbeleid en technische feiten.

- **Rolverdeling:** Martijn bepaalt doel, gewenste functies, vormgeving en belangrijke productkeuzes. De AI draagt de technische uitvoering, kiest de eenvoudigste passende oplossing en rondt de afgesproken route zelfstandig af. Vraag geen akkoord voor gewone technische keuzes.
- **Mandaat:** onderzoek, code en documentatie wijzigen, dependencies onderhouden, fouten oplossen, gericht testen, committen, pushen, PR's maken en technisch beoordelen, mergen, bouwen, uitrollen en herstellen zijn vooraf toegestaan binnen de afgesproken productrichting. Een aparte toestemming per stap of publicatie is niet nodig. Gebruik bestaande accounts en uitrolroutes. Een expliciet aangehouden ontwerp of release blijft aangehouden; kies geen nieuwe vormgeving namens Martijn.
- **Kosten:** geen aankopen, abonnementen, betaalde API-aanroepen, betaalde runners, extra resources of verhoging van verbruikslimieten zonder voorafgaand kostenakkoord. Gebruik beschikbare gratis of reeds inbegrepen voorzieningen binnen de bestaande limieten; een bestaande sleutel is geen kostentoestemming.
- **Eerst GitHub lezen:** haal bij de start en vóór integratie/publicatie de actuele branch, relevante issues/PR's, besluiten en HANDOFF/status op. Werk vanuit de werkelijk laatste afspraken. Los technische vragen zelf uit bronnen op; leg de volgende concrete stap vast en ga door zolang de opdracht werk bevat. Oude wacht-op-akkoordregels zijn geen nieuwe blokkade.
- **Proportioneel controleren:** kies controles op basis van wat wijzigt. Tekst/documentatie: inhoud en verwijzingen; opmaak: betrokken scherm op relevante formaten; functionaliteit: gewijzigde gebruikersroute plus relevante regressies; rechten, betalingen of data: passende integratie- en beveiligingscontroles. Geen volledige testmatrix, nieuwe testtool, aparte proefperiode of extra reviewronde voor iedere kleine wijziging. Herhaal geslaagde controles alleen bij nieuwe wijzigingen, fouten of concrete twijfel. Behoud zinvolle bestaande CI en verplichte platformcontroles.
- **AI test zelf:** schuif reguliere klikroutes en acceptatietests niet naar Martijn. Herstel gevonden fouten en controleer gericht opnieuw. Voeg alleen duurzame tests toe die een belangrijk risico afdekken. Na uitrol kort veilig controleren en bij een defect herstellen of terugrollen. Meld beperkingen eerlijk; maak een optionele onuitvoerbare controle geen blokkade voor onafhankelijk werk.
- **Alleen echt escaleren:** kosten, een ontbrekende doorslaggevende product-/ontwerpkeuze, onvermijdelijke persoonlijke login/MFA of een handeling met onomkeerbaar dataverlies. Vraag uitsluitend het ontbrekende en werk aan de rest door. Beschikbare toegang eerst zelf onderzoeken.
- **Blijvende grenzen:** geen secrets publiceren, vertrouwelijke gegevens openbaar maken, echte berichten/bestellingen/reserveringen als test versturen, beveiligingscontroles omzeilen of ongerelateerd werk overschrijven. Softwaremandaat is geen toestemming om fysieke gebouwinstallaties, noodverlichting of klantapparatuur zonder passende projectopdracht te bedienen. Behoud echte data en bronbestanden; gebruik fictieve testdata.
- **Terugkoppeling:** kort: wat is afgerond/live, wat is relevant gecontroleerd en alleen de echte blokkade of keuze. Technische details en bewijs in GitHub. Geen standaardvraag “zal ik verdergaan?” en geen testhuiswerk voor Martijn.

Dit document geeft uitvoeringsmandaat; het schakelt geen platformpermissies uit en start op zichzelf geen permanent draaiende agent.
<!-- END AUTONOMIE 2026-11-09 -->

**Centrale kennis bij nieuw werk:** lees eerst [START_HIER.md](https://github.com/MartijndBesten/martijn-ai-workbench/blob/main/bibliotheek/START_HIER.md) op actuele `main`. Daar staan de bouwstenen, lessen, nummervertalingen en bronbranches. Raadpleeg alleen relevante kaarten/lessen; integreer bruikbare nieuwe kennis zelfstandig terug. Een ontbrekende private verbinding eerst onderzoeken, alleen de ontbrekende toegang melden als die echt nodig is.



<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
