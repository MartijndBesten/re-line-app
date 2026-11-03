import { randomBytes } from "node:crypto";
import { Store } from "../../lib/db";
/**
 * Testdatabase: standaard SQLite in het geheugen. Met RELINE_TEST_PG (adres van een tijdelijke,
 * lokale PostgreSQL-cluster, zie scripts/test-pg.mjs) krijgt iedere test een eigen, nieuwe
 * PostgreSQL-database, zodat dezelfde suite op beide databases draait.
 */
export const testDialect = process.env.RELINE_TEST_PG ? "postgres" : "sqlite";
export async function testStore(): Promise<Store> {
  if (!process.env.RELINE_TEST_PG) return Store.open(":memory:");
  return Store.open(await newPgDatabase());
}
/** Nieuwe, lege database in de tijdelijke testcluster; geeft het adres terug. */
export async function newPgDatabase(): Promise<string> {
  const base = process.env.RELINE_TEST_PG;
  if (!base) throw Error("RELINE_TEST_PG ontbreekt (draai via npm run test:pg)");
  const pg = (await import("pg")).default;
  const name = "t_" + randomBytes(6).toString("hex");
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = "/" + name;
  return url.toString();
}
export async function using(fn: (db: Store) => Promise<void>) {
  const db = await testStore();
  try {
    await fn(db);
  } finally {
    await db.close();
  }
}
