// Acceptatiepilot klaarzetten in een LEGE centrale Re-Line-omgeving: drie fictieve accounts (bij wachtwoordaccounts)
// en een synthetische SAP-export om via Import in te lezen. Nooit echte klant- of SAP-gegevens.
//
//   RELINE_AUTH=lokaal RELINE_DATABASE_URL="postgres://…" RELINE_PUBLIC_URL="https://…" npm run pilot:voorbereiden
//   npm run pilot:voorbereiden -- --db data/pilot.sqlite --uitvoer data/pilot/synthetische-sap-export-pilot.xlsx
//
// Weigert een database met gegevens of accounts. Bij RELINE_AUTH=entra worden geen accounts gemaakt: wijs dan in
// Entra ID drie testgebruikers de app-rollen toe (zie output/PILOT_ACCEPTATIE_EN_IMPLEMENTATIEPLAN.md).
// --state <pad.json>  schrijft de activatielinks ook naar een bestand (voor de geautomatiseerde generale repetitie).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { asActor, Store } from "../lib/db";
import { authMode } from "../lib/auth";
import { pilotFileName, pilotLineCount, pilotProjects, pilotWorkbook, preparePilot } from "../pilot/pilot";

const arg = (n: string) => {
  const i = process.argv.indexOf("--" + n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined;
};
async function main() {
  const mode = authMode();
  if (mode === "uit") throw Error("De pilot is voor de centrale omgeving: zet RELINE_AUTH op lokaal (wachtwoordaccounts) of entra.");
  const out = arg("uitvoer") ?? path.join("data", "pilot", pilotFileName);
  const db = await Store.open(arg("db"));
  try {
    const base = (process.env.RELINE_PUBLIC_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
    const { users } = await asActor({ id: null, name: "Pilotvoorbereiding (opdrachtregel)", role: "beheerder" }, () =>
      preparePilot(db, { accounts: mode === "lokaal" }),
    );
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, await pilotWorkbook());
    console.log(`Synthetische SAP-export: ${out} (${pilotProjects.length} fictieve projecten, ${pilotLineCount} regels)\n`);
    const links: Record<string, string> = {};
    for (const u of users) {
      if (u.activationToken) links[u.key] = `${base}/#activeren=${u.activationToken}`;
      console.log(`${u.role.padEnd(10)} ${u.name.padEnd(28)} ${u.email}`);
      console.log(u.activationToken ? `           activatielink (eenmalig, 72 uur): ${links[u.key]}` : "           Entra ID: wijs deze testgebruiker de passende app-rol toe");
    }
    const state = arg("state");
    if (state) {
      mkdirSync(path.dirname(state), { recursive: true });
      writeFileSync(state, JSON.stringify({ links, export: path.resolve(out) }));
    }
    console.log("\nVolgende stap: Petra (beheerder) activeert haar account en importeert het bestand via Import.");
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error("FOUT: " + (e as Error).message);
  process.exit(1);
});
