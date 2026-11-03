import { createHash, randomUUID } from "node:crypto";
import { PostgresDriver, type Driver, type Row } from "./sql";
import { Store, schemaVersion } from "./db";
/**
 * Eenmalige overgang van de lokale SQLite-database naar de centrale PostgreSQL-database.
 *
 * - Doel moet leeg zijn (een nieuwe database, of alleen het lege Re-Line-schema). Anders: weigeren.
 * - Alles in één PostgreSQL-transactie: kopiëren in sleutelvolgorde, daarna per tabel aantal en
 *   controlegetal (sha256 over alle rijen, volgorde-onafhankelijk) vergelijken met de bron. Eén
 *   afwijking = alles teruggedraaid, de doeldatabase blijft leeg.
 * - De bron wordt alleen gelezen (wel eerst naar het actuele schema gebracht, met automatische
 *   back-up, net als bij het starten van de app).
 * - Sessies, inlogtellers en lopende Microsoft-aanmeldingen zijn tijdelijk en worden niet
 *   overgenomen: iedereen meldt zich na de overstap opnieuw aan.
 */

/** Kopieervolgorde: eerst tabellen waarnaar verwezen wordt. */
export const copyOrder = [
  "users",
  "imports",
  "projects",
  "project_keys",
  "order_lines",
  "history_lines",
  "history_line_changes",
  "relations",
  "project_relations",
  "activities",
  "catalog",
  "scenarios",
  "settings",
  "selections",
  "import_profiles",
  "source_records",
  "audit",
] as const;
export const transientTables = ["sessions", "rate_limits", "oidc_requests"] as const;
const migrationAction = "Migratie naar PostgreSQL";
const knownTables = new Set<string>([...copyOrder, ...transientTables]);

export type TableCheck = { table: string; source: number; target: number; sourceSum: string; targetSum: string; ok: boolean };
export type MigrationReport = {
  dryRun: boolean;
  schema: number;
  source: string;
  target: string;
  tables: TableCheck[];
  skipped: { table: string; rows: number }[];
  projects: number;
  historyLines: number;
  candidates: number;
  ok: boolean;
};

const normalize = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
  if (v instanceof Uint8Array) return "b64:" + Buffer.from(v).toString("base64");
  return v;
};

async function columnsOf(d: Driver, table: string): Promise<string[]> {
  const rows =
    d.dialect === "sqlite"
      ? await d.all(`PRAGMA table_info(${table})`)
      : await d.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=?", [table]);
  return rows.map((r) => String(r.name)).sort();
}
async function tablesOf(d: Driver): Promise<string[]> {
  const rows =
    d.dialect === "sqlite"
      ? await d.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      : await d.all("SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  return rows.map((r) => String(r.name)).filter((t) => t !== "re_line_schema");
}
/** Aantal rijen en een volgorde-onafhankelijk controlegetal over alle kolommen (op kolomnaam gesorteerd). */
export function checksum(rows: Row[], columns: string[]) {
  const hashes = rows
    .map((r) => createHash("sha256").update(JSON.stringify(columns.map((c) => normalize(r[c])))).digest("hex"))
    .sort();
  return { count: rows.length, sum: createHash("sha256").update(hashes.join("\n")).digest("hex") };
}
async function readTable(d: Driver, table: string, columns: string[]) {
  const rows = await d.all(`SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM ${table}`);
  // De eigen migratieregel in het doel hoort niet bij de vergelijking met de bron.
  return table === "audit" ? rows.filter((r) => r.action !== migrationAction) : rows;
}

/** Weigert een doeldatabase met gegevens. Een leeg Re-Line-schema (alleen schemamigratieregels) is toegestaan. */
async function assertEmptyTarget(d: Driver) {
  const tables = await tablesOf(d);
  const filled: string[] = [];
  for (const t of tables) {
    const n = Number(
      (await d.one(t === "audit" ? `SELECT COUNT(*) AS n FROM audit WHERE action<>'Schemamigratie'` : `SELECT COUNT(*) AS n FROM "${t}"`))?.n ?? 0,
    );
    if (n > 0) filled.push(`${t} (${n})`);
  }
  if (filled.length)
    throw Error(
      `De doeldatabase is niet leeg: ${filled.join(", ")}. Migreren mag alleen naar een nieuwe, lege database; er wordt niets overschreven.`,
    );
}

/** Vergelijkt bron en doel per tabel (aantal en controlegetal). Ook los te gebruiken als nacontrole. */
export async function compare(source: Driver, target: Driver): Promise<TableCheck[]> {
  const out: TableCheck[] = [];
  for (const table of copyOrder) {
    const cols = await columnsOf(source, table);
    const a = checksum(await readTable(source, table, cols), cols);
    const b = checksum(await readTable(target, table, cols), cols);
    out.push({ table, source: a.count, target: b.count, sourceSum: a.sum, targetSum: b.sum, ok: a.count === b.count && a.sum === b.sum });
  }
  return out;
}

class DryRun extends Error {
  constructor(readonly report: MigrationReport) {
    super("proefrun");
  }
}

export async function migrateSqliteToPostgres(
  sqlitePath: string,
  postgresUrl: string,
  opts: { dryRun?: boolean } = {},
): Promise<MigrationReport> {
  if (!/^postgres(ql)?:\/\//i.test(postgresUrl)) throw Error("Doel moet een postgres://-adres zijn");
  if (/^postgres(ql)?:\/\//i.test(sqlitePath) || sqlitePath === ":memory:") throw Error("Bron moet een SQLite-bestand zijn");
  // 1. Doel controleren vóórdat er iets wordt aangemaakt.
  const probe = await PostgresDriver.connect(postgresUrl, { max: 1, ssl: process.env.RELINE_DB_SSL === "1" });
  try {
    await assertEmptyTarget(probe);
  } finally {
    await probe.close();
  }
  // 2. Bron en doel openen op hetzelfde (actuele) schema.
  const source = await Store.open(sqlitePath);
  let target: Store | null = null;
  try {
    if (source.dialect !== "sqlite") throw Error("Bron moet een SQLite-bestand zijn");
    target = await Store.open(postgresUrl);
    const s = source.driver;
    const t = target.driver;
    const unknown = (await tablesOf(s)).filter((x) => !knownTables.has(x));
    if (unknown.length) throw Error(`Onbekende tabel(len) in de bron: ${unknown.join(", ")}. Migratiescript eerst bijwerken.`);
    for (const table of copyOrder) {
      const a = await columnsOf(s, table);
      const b = await columnsOf(t, table);
      if (a.join() !== b.join()) throw Error(`Kolommen van ${table} verschillen tussen bron en doel; zelfde Re-Line-versie gebruiken.`);
    }
    const skipped: MigrationReport["skipped"] = [];
    for (const table of transientTables)
      skipped.push({ table, rows: Number((await s.one(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0) });

    const run = async (): Promise<MigrationReport> =>
      t.transaction(async () => {
        // Een vers schema bevat eigen schemamigratieregels; de auditgeschiedenis komt uit de bron.
        await t.run("DELETE FROM audit WHERE action='Schemamigratie'");
        await assertEmptyTarget(t);
        // Bron lezen binnen één leestransactie: consistente momentopname, ook als de app nog draait.
        const data = await s.transaction(async () => {
          const m = new Map<string, { cols: string[]; rows: Row[] }>();
          for (const table of copyOrder) {
            const cols = await columnsOf(s, table);
            m.set(table, { cols, rows: await s.all(`SELECT ${cols.map((c) => `"${c}"`).join(",")} FROM ${table}`) });
          }
          return m;
        });
        for (const table of copyOrder) {
          const { cols, rows } = data.get(table)!;
          const per = Math.max(1, Math.floor(30000 / cols.length));
          for (let i = 0; i < rows.length; i += per) {
            const chunk = rows.slice(i, i + per);
            const values = chunk.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
            const args = chunk.flatMap((r) => cols.map((c) => normalize(r[c]) as string | number | null));
            await t.run(`INSERT INTO ${table}(${cols.map((c) => `"${c}"`).join(",")}) VALUES ${values}`, args);
          }
        }
        // Controle in dezelfde transactie, tegen dezelfde momentopname van de bron.
        const tables: TableCheck[] = [];
        for (const table of copyOrder) {
          const { cols, rows } = data.get(table)!;
          const a = checksum(rows, cols);
          const b = checksum(await readTable(t, table, cols), cols);
          tables.push({ table, source: a.count, target: b.count, sourceSum: a.sum, targetSum: b.sum, ok: a.count === b.count && a.sum === b.sum });
        }
        const count = async (sql: string) => Number((await t.one(sql))?.n ?? 0);
        const report: MigrationReport = {
          dryRun: !!opts.dryRun,
          schema: schemaVersion,
          source: s.location,
          target: t.location,
          tables,
          skipped,
          projects: await count("SELECT COUNT(*) AS n FROM projects"),
          historyLines: await count("SELECT COUNT(*) AS n FROM history_lines"),
          candidates: await count("SELECT COUNT(*) AS n FROM projects WHERE candidate_rank IS NOT NULL"),
          ok: tables.every((x) => x.ok),
        };
        if (!report.ok) {
          const bad = tables.filter((x) => !x.ok).map((x) => `${x.table} (bron ${x.source}, doel ${x.target})`);
          throw Error(`Controle na kopiëren mislukt voor: ${bad.join(", ")}. Alles is teruggedraaid.`);
        }
        if (opts.dryRun) throw new DryRun(report);
        await t.run("INSERT INTO audit(id,created,action,entity,detail,user_id,user_name) VALUES(?,?,?,?,?,?,?)", [
          randomUUID(),
          new Date().toISOString(),
          migrationAction,
          "database",
          `Overgenomen uit SQLite (schema v${schemaVersion}): ` +
            tables.map((x) => `${x.table} ${x.target}`).join(", ") +
            `. Niet overgenomen (tijdelijk): ${skipped.map((x) => x.table).join(", ")}.`,
          null,
          "Beheerder (opdrachtregel)",
        ]);
        return report;
      });
    try {
      return await run();
    } catch (e) {
      if (e instanceof DryRun) return e.report;
      throw e;
    }
  } finally {
    await target?.close();
    await source.close();
  }
}
