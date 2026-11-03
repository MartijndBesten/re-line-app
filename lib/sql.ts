import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
/**
 * Databasedrivers achter één asynchrone interface: SQLite (lokaal, één bestand) en PostgreSQL
 * (centrale omgeving). Alle SQL in lib/db.ts gebruikt `?` als parameter en draagbare constructies;
 * dialectverschillen lopen via `Dialect`.
 *
 * Transacties: `transaction(fn)` bindt alle queries binnen `fn` (ook in aangeroepen methoden) aan
 * dezelfde verbinding via AsyncLocalStorage. SQLite heeft één verbinding; een slot voorkomt dat een
 * ander, gelijktijdig verzoek binnen een open transactie leest of schrijft.
 */
export type Param = string | number | null;
export type Row = Record<string, unknown>;
export type Dialect = "sqlite" | "postgres";

export interface Driver {
  readonly dialect: Dialect;
  /** Pad (SQLite) of een omschrijving zonder wachtwoord (PostgreSQL). */
  readonly location: string;
  all(sql: string, args?: Param[]): Promise<Row[]>;
  one(sql: string, args?: Param[]): Promise<Row | undefined>;
  run(sql: string, args?: Param[]): Promise<{ changes: number }>;
  /** Meerdere statements zonder parameters (migraties). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  version(): Promise<number>;
  setVersion(v: number): Promise<void>;
  close(): Promise<void>;
}

/** Eenvoudig slot: één houder tegelijk, de rest wacht in volgorde. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.tail;
    this.tail = prev.then(() => next);
    return prev.then(() => release);
  }
}

export class SqliteDriver implements Driver {
  readonly dialect = "sqlite" as const;
  readonly db: DatabaseSync;
  private mutex = new Mutex();
  private tx = new AsyncLocalStorage<true>();
  constructor(readonly location: string) {
    this.db = new DatabaseSync(location);
    try {
      this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    } catch (e) {
      this.db.close();
      throw e;
    }
  }
  /** Buiten een eigen transactie wachten tot een lopende transactie klaar is. */
  private async guarded<T>(fn: () => T): Promise<T> {
    if (this.tx.getStore()) return fn();
    const release = await this.mutex.lock();
    try {
      return fn();
    } finally {
      release();
    }
  }
  all(sql: string, args: Param[] = []) {
    return this.guarded(() => this.db.prepare(sql).all(...args) as Row[]);
  }
  one(sql: string, args: Param[] = []) {
    return this.guarded(() => this.db.prepare(sql).get(...args) as Row | undefined);
  }
  run(sql: string, args: Param[] = []) {
    return this.guarded(() => ({ changes: Number(this.db.prepare(sql).run(...args).changes) }));
  }
  exec(sql: string) {
    return this.guarded(() => void this.db.exec(sql));
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.tx.getStore()) return fn();
    const release = await this.mutex.lock();
    try {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await this.tx.run(true, fn);
        this.db.exec("COMMIT");
        return result;
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    } finally {
      release();
    }
  }
  async version() {
    return Number((await this.one("PRAGMA user_version"))?.user_version ?? 0);
  }
  async setVersion(v: number) {
    await this.exec(`PRAGMA user_version=${Number(v)}`);
  }
  /** Consistente kopie (alleen SQLite). */
  async backupTo(target: string) {
    await this.run("VACUUM INTO ?", [target]);
  }
  async close() {
    this.db.close();
  }
}

type PgClient = { query: (sql: string, args?: Param[]) => Promise<{ rows: Row[]; rowCount: number | null }>; release?: () => void };
type PgPool = PgClient & { connect: () => Promise<PgClient & { release: () => void }>; end: () => Promise<void> };

/** `?` → `$1, $2, …` (de SQL in Re-Line bevat geen vraagtekens binnen tekstwaarden). */
export function toPgPlaceholders(sql: string) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

export class PostgresDriver implements Driver {
  readonly dialect = "postgres" as const;
  private tx = new AsyncLocalStorage<PgClient>();
  constructor(
    private pool: PgPool,
    readonly location: string,
  ) {}
  /** Verbinding via `pg`; int8 en numeric als getal (aantallen en sommen), net als bij SQLite. */
  static async connect(url: string, options: { max?: number; ssl?: boolean } = {}) {
    const pg = (await import("pg")).default;
    pg.types.setTypeParser(20, (v: string) => Number(v)); // int8 (COUNT, SUM van integers)
    pg.types.setTypeParser(1700, (v: string) => Number(v)); // numeric
    const pool = new pg.Pool({
      connectionString: url,
      max: options.max ?? 10,
      ...(options.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    const safe = url.replace(/\/\/[^@/]*@/, "//***@");
    const driver = new PostgresDriver(pool as unknown as PgPool, safe);
    await driver.one("SELECT 1 ok");
    return driver;
  }
  private client(): PgClient {
    return this.tx.getStore() ?? this.pool;
  }
  async all(sql: string, args: Param[] = []) {
    return (await this.client().query(toPgPlaceholders(sql), args)).rows;
  }
  async one(sql: string, args: Param[] = []) {
    return (await this.all(sql, args))[0];
  }
  async run(sql: string, args: Param[] = []) {
    return { changes: (await this.client().query(toPgPlaceholders(sql), args)).rowCount ?? 0 };
  }
  async exec(sql: string) {
    await this.client().query(sql);
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.tx.getStore()) return fn();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const result = await this.tx.run(client, fn);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    } finally {
      client.release();
    }
  }
  async version() {
    await this.exec("CREATE TABLE IF NOT EXISTS re_line_schema(id INTEGER PRIMARY KEY CHECK (id=1), version INTEGER NOT NULL)");
    return Number((await this.one("SELECT version FROM re_line_schema WHERE id=1"))?.version ?? 0);
  }
  async setVersion(v: number) {
    await this.run(
      "INSERT INTO re_line_schema(id,version) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version",
      [Number(v)],
    );
  }
  async close() {
    await this.pool.end();
  }
}

/** Draagbare SQL-stukken per dialect. */
export function sqlFor(dialect: Dialect) {
  const pg = dialect === "postgres";
  return {
    /** Kommagescheiden samenvoeging (GROUP_CONCAT / STRING_AGG). */
    agg: (expr: string, distinct = false) =>
      pg
        ? `STRING_AGG(${distinct ? "DISTINCT " : ""}(${expr})::text, ','${distinct ? ` ORDER BY (${expr})::text` : ""})`
        : `GROUP_CONCAT(${distinct ? "DISTINCT " : ""}${expr})`,
    /** Kolomtype voor kommagetallen: REAL in SQLite, DOUBLE PRECISION in PostgreSQL (geen afronding van omzet). */
    real: pg ? "DOUBLE PRECISION" : "REAL",
  };
}
