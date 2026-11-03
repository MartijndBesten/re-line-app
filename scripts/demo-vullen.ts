// Afgeschermde demo (RELINE_DEMO=1): vult een LEGE database met de synthetische pilotset (12 fictieve projecten,
// renovatiekandidaten bepaald). Draait vóór de start van de server; doet niets als er al dossiers zijn.
// Nooit voor echte gegevens: weigert zonder RELINE_DEMO=1.
//
//   RELINE_DEMO=1 RELINE_AUTH=email RELINE_DATABASE_URL="postgres://…" npm run demo:vullen
import { asActor, Store } from "../lib/db";
import { parseHistoryWorkbook } from "../lib/history";
import { pilotFileName, pilotWorkbook } from "../pilot/pilot";

async function main() {
  if (process.env.RELINE_DEMO !== "1") throw Error("Alleen voor een demo-omgeving (RELINE_DEMO=1).");
  const db = await Store.open();
  try {
    const n = Number((await db.one("SELECT COUNT(*) AS n FROM projects"))?.n ?? 0);
    if (n > 0) {
      console.log(`Demo: database bevat al ${n} dossiers; niets gewijzigd.`);
      return;
    }
    const parsed = await parseHistoryWorkbook(await pilotWorkbook());
    if (!parsed || parsed.errors.length) throw Error("Synthetische pilotset niet herkend");
    await asActor({ id: null, name: "Demovulling (synthetisch)", role: "beheerder" }, async () => {
      const r = await db.ingestHistory(pilotFileName, parsed.rows);
      await db.selectCandidates(100);
      console.log(`Demo gevuld: ${r.added} synthetische regels, ${r.newProjects} fictieve dossiers.`);
    });
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error("FOUT: " + (e as Error).message);
  process.exit(1);
});
