// Accounts beheren op de server (wachtwoordaccounts, RELINE_AUTH=lokaal; uitnodigingen bij RELINE_AUTH=email). Vooral voor het EERSTE beheerdersaccount:
// daarvoor bestaat bewust geen open webpagina.
//
//   npm run gebruiker -- --maak --beheerder --email naam@bedrijf.nl --naam "Voornaam Achternaam"
//   npm run gebruiker -- --maak --email collega@bedrijf.nl --naam "Collega"        (rol gebruiker)
//   npm run gebruiker -- --activatielink --email naam@bedrijf.nl                   (nieuwe link, sessies vervallen)
//   npm run gebruiker -- --lijst
//
// Database: RELINE_DATABASE_URL (PostgreSQL) of RELINE_DB / data/re-line.sqlite, of --db <pad of postgres://…>.
// De activatielink is eenmalig en 72 uur geldig; geef hem persoonlijk door. Basisadres: RELINE_PUBLIC_URL.
import { asActor, Store } from "../lib/db";
import { createUser, listUsers, normEmail, resetActivation } from "../lib/auth";

function arg(name: string) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
async function main() {
  const db = await Store.open(typeof arg("db") === "string" ? String(arg("db")) : undefined);
  const base = (process.env.RELINE_PUBLIC_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  try {
    await asActor({ id: null, name: "Beheerder (opdrachtregel)", role: "beheerder" }, async () => {
      if (arg("lijst")) {
        for (const u of await listUsers(db))
          console.log(`${String(u.name).padEnd(28)} ${String(u.email).padEnd(36)} ${String(u.role).padEnd(10)} ${Number(u.active) ? (Number(u.pending) ? "uitgenodigd" : "actief") : "gedeactiveerd"}`);
        return;
      }
      if (arg("maak")) {
        const r = await createUser(db, { email: arg("email"), name: arg("naam"), role: arg("beheerder") ? "beheerder" : "gebruiker" }, "opdrachtregel");
        if (r.activationToken) console.log(`Account aangemaakt. Eenmalige activatielink (72 uur geldig):\n${base}/#activeren=${r.activationToken}`);
        else console.log(`Uitgenodigd (RELINE_AUTH=email). De collega vraagt op ${base} zelf een inloglink aan voor dit adres.`);
        return;
      }
      if (arg("activatielink")) {
        const u = await db.one("SELECT id FROM users WHERE email=?", normEmail(arg("email")));
        if (!u) throw Error("Geen account met dit e-mailadres");
        console.log(`Nieuwe activatielink (72 uur geldig; bestaande sessies vervallen):\n${base}/#activeren=${await resetActivation(db, String(u.id))}`);
        return;
      }
      console.log("Gebruik: --maak [--beheerder] --email … --naam … | --activatielink --email … | --lijst");
    });
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error("FOUT: " + (e as Error).message);
  process.exit(1);
});
