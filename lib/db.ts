import { AsyncLocalStorage } from "node:async_hooks";
import { PostgresDriver, SqliteDriver, sqlFor, type Dialect, type Driver, type Param } from "./sql";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  activityKinds,
  relationRoles,
  answerValues,
  callOutcomes,
  canonical,
  channels,
  contactRoles,
  defaultWeights,
  plannedKinds,
  score,
  statuses,
  type Weights,
  type Normalized,
} from "./domain";
import { questions } from "./commercial";
import { cleanMapping, type Mapping } from "./profiles";
import { detect } from "./import";
import { historyKey, historySource, rankCandidates, renovationScore, type HistoryRow, type ScorePart } from "./history";
export type RecordRow = Record<string, unknown>;

// Schema v1 = fase 1 (Codex). Nooit wijzigen: bestaande databases zijn hiermee aangemaakt.
export const schemaV1 = `
 CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,city TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',project_number TEXT NOT NULL DEFAULT '',match_key TEXT UNIQUE,confidence TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Nieuw gevonden',present TEXT NOT NULL DEFAULT 'Onbekend',replaced TEXT NOT NULL DEFAULT 'Onbekend',need TEXT NOT NULL DEFAULT 'Onbekend',contact TEXT NOT NULL DEFAULT '',owner TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',next_action TEXT NOT NULL DEFAULT '',due TEXT,route TEXT NOT NULL DEFAULT 'Eindgebruiker',location_confirmed INTEGER NOT NULL DEFAULT 0,relationship_confirmed INTEGER NOT NULL DEFAULT 0,end_user TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS project_keys(key TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id));
 CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,filename TEXT NOT NULL,created TEXT NOT NULL,added INTEGER NOT NULL,duplicates INTEGER NOT NULL,warnings TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS order_lines(id TEXT PRIMARY KEY,source_key TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),import_id TEXT NOT NULL REFERENCES imports(id),source_row INTEGER NOT NULL,source TEXT NOT NULL,document TEXT NOT NULL,position TEXT NOT NULL,article TEXT NOT NULL,description TEXT NOT NULL,quantity REAL NOT NULL,order_date TEXT,document_type TEXT NOT NULL,price REAL,debtor TEXT NOT NULL,debtor_number TEXT NOT NULL,recipient TEXT NOT NULL,address TEXT NOT NULL,raw TEXT NOT NULL,warnings TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS relations(id TEXT PRIMARY KEY,name TEXT NOT NULL,number TEXT NOT NULL DEFAULT '',role TEXT NOT NULL,contact TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',UNIQUE(name,number,role));
 CREATE TABLE IF NOT EXISTS project_relations(project_id TEXT NOT NULL REFERENCES projects(id),relation_id TEXT NOT NULL REFERENCES relations(id),PRIMARY KEY(project_id,relation_id));
 CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),created TEXT NOT NULL,kind TEXT NOT NULL,note TEXT NOT NULL,contact TEXT NOT NULL,owner TEXT NOT NULL,due TEXT,done INTEGER NOT NULL DEFAULT 0,result TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS catalog(article TEXT PRIMARY KEY,family TEXT NOT NULL DEFAULT '',generation TEXT NOT NULL DEFAULT '',profile_type TEXT NOT NULL DEFAULT '',length REAL,confirmed INTEGER NOT NULL DEFAULT 0,evidence TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS scenarios(project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(project_id,kind));
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS selections(id TEXT PRIMARY KEY,name TEXT NOT NULL,project_ids TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,created TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,detail TEXT NOT NULL);`;

// Versioned, uitsluitend toevoegende migraties. Iedere migratie draait in een transactie;
// een bestaande database krijgt vooraf automatisch een back-up (zie backup()).
export const migrations: { version: number; description: string; sql: string }[] = [
  {
    version: 2,
    description:
      "Bronvelden voor SAP-exports, bewijs bij bevestigingen, gespreksregistratie, gezamenlijke acties en importprofielen",
    sql: `
 ALTER TABLE order_lines ADD COLUMN line_id TEXT NOT NULL DEFAULT '';
 ALTER TABLE order_lines ADD COLUMN toc TEXT NOT NULL DEFAULT '';
 ALTER TABLE order_lines ADD COLUMN unit TEXT NOT NULL DEFAULT '';
 ALTER TABLE order_lines ADD COLUMN delivered_quantity REAL;
 ALTER TABLE order_lines ADD COLUMN delivery_date TEXT;
 ALTER TABLE order_lines ADD COLUMN order_status TEXT NOT NULL DEFAULT '';
 ALTER TABLE order_lines ADD COLUMN line_state TEXT NOT NULL DEFAULT 'Normaal';
 ALTER TABLE order_lines ADD COLUMN counted INTEGER NOT NULL DEFAULT 1;
 ALTER TABLE order_lines ADD COLUMN postcode TEXT NOT NULL DEFAULT '';
 ALTER TABLE order_lines ADD COLUMN country TEXT NOT NULL DEFAULT '';
 ALTER TABLE order_lines ADD COLUMN region TEXT NOT NULL DEFAULT '';
 ALTER TABLE order_lines ADD COLUMN recipient_number TEXT NOT NULL DEFAULT '';
 ALTER TABLE order_lines ADD COLUMN family_source TEXT NOT NULL DEFAULT '';
 ALTER TABLE order_lines ADD COLUMN currency TEXT NOT NULL DEFAULT '';
 UPDATE order_lines SET line_state='Retour/correctie' WHERE quantity<0;
 ALTER TABLE imports ADD COLUMN profile TEXT NOT NULL DEFAULT '';
 ALTER TABLE imports ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
 ALTER TABLE imports ADD COLUMN total_rows INTEGER;
 ALTER TABLE projects ADD COLUMN present_evidence TEXT NOT NULL DEFAULT '';
 ALTER TABLE projects ADD COLUMN replaced_evidence TEXT NOT NULL DEFAULT '';
 ALTER TABLE projects ADD COLUMN need_evidence TEXT NOT NULL DEFAULT '';
 ALTER TABLE projects ADD COLUMN location_evidence TEXT NOT NULL DEFAULT '';
 ALTER TABLE activities ADD COLUMN outcome TEXT NOT NULL DEFAULT '';
 ALTER TABLE activities ADD COLUMN contact_role TEXT NOT NULL DEFAULT '';
 ALTER TABLE activities ADD COLUMN channel TEXT NOT NULL DEFAULT '';
 ALTER TABLE activities ADD COLUMN answers TEXT NOT NULL DEFAULT '';
 ALTER TABLE activities ADD COLUMN group_id TEXT;
 ALTER TABLE activities ADD COLUMN relation_id TEXT;
 CREATE TABLE IF NOT EXISTS import_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,mapping TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',created TEXT NOT NULL);`,
  },
  {
    version: 3,
    description:
      "Projecthistorie (SAP-verkoop per projectnummer en boekjaar, zonder ordernummers of leverstatus) en vaste werkvoorraad van renovatiekandidaten",
    sql: `
 CREATE TABLE IF NOT EXISTS history_lines(id TEXT PRIMARY KEY,source_key TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),import_id TEXT NOT NULL REFERENCES imports(id),source_row INTEGER NOT NULL,project_number TEXT NOT NULL,project_name TEXT NOT NULL,fiscal_year INTEGER,customer_number TEXT NOT NULL,customer_name TEXT NOT NULL,material TEXT NOT NULL,series TEXT NOT NULL,material_desc TEXT NOT NULL,recipient_number TEXT NOT NULL,recipient_name TEXT NOT NULL,recipient_city TEXT NOT NULL,project_city TEXT NOT NULL,project_street TEXT NOT NULL,org_unit TEXT NOT NULL,quantity REAL,revenue REAL,net_revenue REAL,raw TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS history_lines_project ON history_lines(project_id);
 ALTER TABLE projects ADD COLUMN candidate_rank INTEGER;
 ALTER TABLE imports ADD COLUMN kind TEXT NOT NULL DEFAULT 'Orderregels';`,
  },
  {
    version: 4,
    description:
      "Samenwerking: gebruikers, sessies, rollen, wie-wat-wanneer, versies tegen gelijktijdig overschrijven, stabiele SAP-bronsleutels en bronrecords",
    sql: `
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,auth_provider TEXT NOT NULL DEFAULT 'lokaal',external_id TEXT UNIQUE,password_hash TEXT,activation_hash TEXT,activation_expires TEXT,created TEXT NOT NULL,created_by TEXT NOT NULL DEFAULT '',last_login TEXT);
 CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL,expires TEXT NOT NULL,last_seen TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
 CREATE TABLE IF NOT EXISTS rate_limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS oidc_requests(state_hash TEXT PRIMARY KEY,code_verifier TEXT NOT NULL,nonce TEXT NOT NULL,expires TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS source_records(source TEXT NOT NULL,external_id TEXT NOT NULL,entity_id TEXT NOT NULL,values_json TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(source,external_id));
 CREATE TABLE IF NOT EXISTS history_line_changes(id TEXT PRIMARY KEY,line_id TEXT NOT NULL REFERENCES history_lines(id),import_id TEXT NOT NULL REFERENCES imports(id),created TEXT NOT NULL,changed TEXT NOT NULL);
 ALTER TABLE audit ADD COLUMN user_id TEXT;
 ALTER TABLE audit ADD COLUMN user_name TEXT NOT NULL DEFAULT '';
 ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
 ALTER TABLE projects ADD COLUMN updated_at TEXT;
 ALTER TABLE projects ADD COLUMN updated_by TEXT NOT NULL DEFAULT '';
 ALTER TABLE projects ADD COLUMN created_at TEXT;
 ALTER TABLE activities ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
 ALTER TABLE imports ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
 CREATE INDEX IF NOT EXISTS order_lines_project ON order_lines(project_id);
 CREATE INDEX IF NOT EXISTS activities_project ON activities(project_id);
 CREATE INDEX IF NOT EXISTS project_relations_relation ON project_relations(relation_id);
 CREATE INDEX IF NOT EXISTS audit_created ON audit(created);`,
  },
];
export const schemaVersion = migrations[migrations.length - 1].version;

const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const text = (v: unknown, max = 10000) => String(v ?? "").trim().slice(0, max);
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** Wie een wijziging doet (ingelogde gebruiker, of de lokale/opdrachtregel-gebruiker). */
export type Actor = { id: string | null; name: string; role: "beheerder" | "gebruiker" };
const actorContext = new AsyncLocalStorage<Actor>();
export const localActor: Actor = { id: null, name: "Lokale gebruiker", role: "beheerder" };
/** Voer `fn` uit namens `actor`: audit, wijzigingsregistratie en eigenaarschap gebruiken deze naam. */
export function asActor<T>(actor: Actor, fn: () => Promise<T>) {
  return actorContext.run(actor, fn);
}
export const currentActor = (): Actor => actorContext.getStore() ?? localActor;
/** Conflict bij gelijktijdig bewerken (HTTP 409). */
export class ConflictError extends Error {
  name = "ConflictError";
  constructor(message: string, readonly current: RecordRow) {
    super(message);
  }
}
/** Schema-SQL per dialect: kommagetallen als DOUBLE PRECISION in PostgreSQL. */
const ddl = (sql: string, dialect: Dialect) => (dialect === "postgres" ? sql.replace(/\bREAL\b/g, "DOUBLE PRECISION") : sql);
const isPostgresUrl = (v: string) => /^postgres(ql)?:\/\//i.test(v);

export type ProjectRecord = RecordRow & {
  quality: number;
  priority: number;
  scoreParts: (ReturnType<typeof score>["parts"][number] | ScorePart)[];
};

export class Store {
  readonly sql: ReturnType<typeof sqlFor>;
  private constructor(
    readonly driver: Driver,
    readonly file: string,
  ) {
    this.sql = sqlFor(driver.dialect);
  }
  get dialect() {
    return this.driver.dialect;
  }
  /**
   * Opent de database en voert openstaande migraties uit. Standaard SQLite (`RELINE_DB` of
   * data/re-line.sqlite); met een postgres://-adres (`RELINE_DATABASE_URL`) PostgreSQL.
   */
  static async open(target?: string): Promise<Store> {
    const where =
      target ??
      process.env.RELINE_DATABASE_URL ??
      process.env.RELINE_DB ??
      path.join(process.cwd(), "data", "re-line.sqlite");
    if (isPostgresUrl(where)) {
      const driver = await PostgresDriver.connect(where, {
        ssl: process.env.RELINE_DB_SSL === "1",
        max: Number(process.env.RELINE_DB_POOL ?? 10),
      });
      const store = new Store(driver, ":postgres:");
      try {
        await store.migrate(false);
      } catch (e) {
        await driver.close();
        throw e;
      }
      return store;
    }
    const existed =
      where !== ":memory:" &&
      existsSync(/*turbopackIgnore: true*/ where) &&
      statSync(/*turbopackIgnore: true*/ where).size > 0;
    if (where !== ":memory:") mkdirSync(/*turbopackIgnore: true*/ path.dirname(where), { recursive: true });
    const driver = new SqliteDriver(where);
    const store = new Store(driver, where);
    try {
      await store.migrate(existed);
    } catch (error) {
      // Bij een mislukte opening (bijv. te nieuw schema) de verbinding altijd sluiten,
      // anders blijft het bestand op Windows vergrendeld.
      await driver.close();
      throw error;
    }
    return store;
  }
  private async migrate(existed: boolean) {
    const d = this.driver;
    let version = await d.version();
    if (version > schemaVersion)
      throw Error(
        `Database heeft schema v${version}; deze Re-Line-versie kent t/m v${schemaVersion}. Gebruik de nieuwste versie van de applicatie.`,
      );
    const hasTables =
      d.dialect === "sqlite"
        ? !!(await d.one("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'"))
        : !!(await d.one("SELECT to_regclass('public.projects') AS t"))?.t;
    if (version < 1) {
      await d.transaction(async () => {
        await d.exec(ddl(schemaV1, d.dialect));
        await d.setVersion(1);
      });
      version = 1;
    }
    const pending = migrations.filter((m) => m.version > version);
    // SQLite: bestandsback-up vooraf. PostgreSQL: herstel via de back-ups van de database-omgeving.
    if (pending.length && existed && hasTables && d.dialect === "sqlite")
      await this.backup(`voor-schema-v${pending[pending.length - 1].version}`);
    for (const m of pending)
      await d.transaction(async () => {
        await d.exec(ddl(m.sql, d.dialect));
        if (m.version === 2) await this.backfillV2();
        if (m.version === 4) await this.backfillV4();
        await d.setVersion(m.version);
        await d.run("INSERT INTO audit(id,created,action,entity,detail) VALUES(?,?,?,?,?)", [
          randomUUID(),
          new Date().toISOString(),
          "Schemamigratie",
          "v" + m.version,
          m.description,
        ]);
      });
  }
  /**
   * Eenmalig bij v2: beschrijvende bronvelden (TOC, familie volgens bron, postcode, land, regio,
   * goederenontvangernummer, valuta) aanvullen uit de al bewaarde ruwe bronregel. Aantallen,
   * status, eenheid en identiteit blijven ongewijzigd, zodat bestaande tellingen niet verschuiven.
   */
  private async backfillV2() {
    for (const r of await this.all("SELECT id,raw FROM order_lines")) {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(String(r.raw));
      } catch {
        continue;
      }
      const m = detect(Object.keys(raw));
      const get = (f: keyof typeof m) => (m[f] ? String(raw[m[f]!] ?? "").trim() : "");
      const values = [get("toc"), get("familySource"), get("postcode"), get("country"), get("region"), get("recipientNumber"), get("currency").toUpperCase()];
      if (values.some(Boolean))
        await this.run(
          "UPDATE order_lines SET toc=?,family_source=?,postcode=?,country=?,region=?,recipient_number=?,currency=? WHERE id=?",
          ...values,
          String(r.id),
        );
    }
  }
  /**
   * Eenmalig bij v4: bronsleutels van de projecthistorie herberekenen op de stabiele identiteit
   * (project, boekjaar, klantnummer, materiaal, ontvanger), zodat een gewijzigde naam of straat in een
   * nieuwe SAP-export geen dubbele regel geeft; en de laatst verwerkte SAP-projectgegevens vastleggen
   * als bronrecord (vergelijking bij een volgende import).
   */
  private async backfillV4() {
    const seen = new Set<string>();
    for (const r of await this.all("SELECT * FROM history_lines ORDER BY source_row,id")) {
      const key = historyKey({
        projectNumber: String(r.project_number), fiscalYear: Number(r.fiscal_year), customerNumber: String(r.customer_number),
        material: String(r.material), recipientNumber: String(r.recipient_number), recipientName: String(r.recipient_name),
        recipientCity: String(r.recipient_city),
      });
      if (seen.has(key)) {
        await this.run(
          "INSERT INTO audit(id,created,action,entity,detail) VALUES(?,?,?,?,?)",
          randomUUID(), new Date().toISOString(), "Mogelijk dubbele historieregel", String(r.id),
          "Zelfde stabiele bronidentiteit als een andere regel; sleutel niet herberekend, controleer de import.",
        );
        continue;
      }
      seen.add(key);
      if (key !== r.source_key) await this.run("UPDATE history_lines SET source_key=? WHERE id=?", key, String(r.id));
    }
    for (const r of await this.all(
      `SELECT h.project_number,h.project_id,h.project_name,h.project_city,h.project_street FROM history_lines h
       JOIN (SELECT project_number,MAX(fiscal_year) y FROM history_lines GROUP BY project_number) m ON m.project_number=h.project_number AND m.y=h.fiscal_year`,
    ))
      await this.run(
        "INSERT INTO source_records(source,external_id,entity_id,values_json,updated) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",
        historySource, String(r.project_number), String(r.project_id),
        JSON.stringify({ name: r.project_name, city: r.project_city, address: r.project_street }), new Date().toISOString(),
      );
  }
  /** Consistente kopie via VACUUM INTO, naast de database in backups/ (alleen SQLite). */
  async backup(label = "handmatig") {
    if (this.driver.dialect !== "sqlite")
      throw Error("Back-ups van de centrale database lopen via de PostgreSQL-omgeving (point-in-time restore); Re-Line maakt geen bestandskopie.");
    if (this.file === ":memory:") throw Error("Geen back-up mogelijk van een tijdelijke database");
    const dir = path.join(path.dirname(this.file), "backups");
    mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
    const name = `${path.basename(this.file, path.extname(this.file))}-${label}-${stamp()}.sqlite`;
    const target = path.join(dir, name);
    await (this.driver as SqliteDriver).backupTo(target);
    return { file: target, name };
  }
  async backups() {
    if (this.driver.dialect !== "sqlite" || this.file === ":memory:") return [];
    const dir = path.join(path.dirname(this.file), "backups");
    if (!existsSync(/*turbopackIgnore: true*/ dir)) return [];
    const base = path.basename(this.file, path.extname(this.file)) + "-";
    return readdirSync(/*turbopackIgnore: true*/ dir)
      .filter((f) => f.startsWith(base) && f.endsWith(".sqlite"))
      .map((f) => {
        const s = statSync(/*turbopackIgnore: true*/ path.join(dir, f));
        return { name: f, size: s.size, created: s.mtime.toISOString() };
      })
      .sort((a, b) => b.created.localeCompare(a.created));
  }
  all(sql: string, ...args: Param[]): Promise<RecordRow[]> {
    return this.driver.all(sql, args);
  }
  one(sql: string, ...args: Param[]): Promise<RecordRow | undefined> {
    return this.driver.one(sql, args);
  }
  run(sql: string, ...args: Param[]) {
    return this.driver.run(sql, args);
  }
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.driver.transaction(fn);
  }
  /** Auditregel met de huidige gebruiker (zie asActor). */
  async audit(action: string, entity: string, detail: string) {
    const actor = currentActor();
    await this.run(
      "INSERT INTO audit(id,created,action,entity,detail,user_id,user_name) VALUES(?,?,?,?,?,?,?)",
      randomUUID(),
      new Date().toISOString(),
      action,
      entity,
      detail,
      actor.id,
      actor.name,
    );
  }
  async weights(): Promise<Weights> {
    return JSON.parse(
      String(
        (await this.one("SELECT value FROM settings WHERE key='weights'"))?.value ??
          JSON.stringify(defaultWeights),
      ),
    );
  }
  matchKey(r: Normalized) {
    return r.projectNumber
      ? "sap:" + r.source + ":" + r.projectNumber
      : r.project && r.city
        ? "name:" + canonical(r.project) + ":" + canonical(r.city)
        : "order:" + r.source + ":" + r.order;
  }
  private async projectForKey(key: string) {
    return (
      await this.one("SELECT project_id id FROM project_keys WHERE key=?", key) ??
      await this.one("SELECT id FROM projects WHERE match_key=?", key)
    );
  }
  async duplicateInfo(rows: Normalized[]) {
    const seen = new Map<string, string>();
    let duplicates = 0;
    const conflicts: string[] = [];
    for (const r of rows) {
      const existing = await this.one(
        "SELECT raw FROM order_lines WHERE source_key=?",
        r.key,
      );
      if (existing || seen.has(r.key)) {
        duplicates++;
        if (String(existing?.raw ?? seen.get(r.key)) !== JSON.stringify(r.raw))
          conflicts.push(
            `Order ${r.order}/${r.position || r.lineId}: dezelfde bronidentiteit met andere gegevens; bestaande regel blijft behouden`,
          );
      }
      if (!seen.has(r.key)) seen.set(r.key, JSON.stringify(r.raw));
    }
    return { newRows: rows.length - duplicates, duplicates, conflicts };
  }
  /** Wat een import met de herkenningsregels zou doen, zonder iets op te slaan. */
  async clusterPreview(rows: Normalized[]) {
    const seen = new Set<string>(),
      newKeys = new Map<string, string>(),
      existing = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.key) || await this.one("SELECT 1 x FROM order_lines WHERE source_key=?", r.key))
        continue;
      seen.add(r.key);
      const key = this.matchKey(r),
        p = await this.projectForKey(key);
      if (p) existing.add(String(p.id));
      else
        newKeys.set(
          key,
          r.projectNumber ? "Hoog" : r.project && r.city ? "Middel" : "Laag",
        );
    }
    const byConfidence = { Hoog: 0, Middel: 0, Laag: 0 } as Record<string, number>;
    for (const c of newKeys.values()) byConfidence[c]++;
    return {
      newProjects: newKeys.size,
      existingProjects: existing.size,
      byConfidence,
    };
  }
  async previousImports(sha256: string) {
    return await this.all(
      "SELECT filename,created,added FROM imports WHERE sha256=? AND sha256<>'' ORDER BY created",
      sha256,
    );
  }
  async ingest(
    filename: string,
    rows: Normalized[],
    meta: { profile?: string; sha256?: string; totalRows?: number } = {},
  ) {
    return this.transaction(async () => {
      const id = randomUUID(),
        info = await this.duplicateInfo(rows);
      await this.run(
        "INSERT INTO imports(id,filename,created,added,duplicates,warnings,profile,sha256,total_rows) VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        filename,
        new Date().toISOString(),
        info.newRows,
        info.duplicates,
        JSON.stringify(info.conflicts),
        meta.profile ?? "",
        meta.sha256 ?? "",
        meta.totalRows ?? rows.length,
      );
      let added = 0;
      for (const [rowIndex, r] of rows.entries()) {
        if (await this.one("SELECT id FROM order_lines WHERE source_key=?", r.key))
          continue;
        const matchKey = this.matchKey(r);
        let p = await this.projectForKey(matchKey);
        if (!p) {
          p = { id: randomUUID() };
          await this.run(
            "INSERT INTO projects(id,name,city,address,project_number,match_key,confidence,created_at) VALUES(?,?,?,?,?,?,?,?)",
            String(p.id),
            r.project || "Onbekend project · " + r.order,
            r.city,
            r.address,
            r.projectNumber,
            matchKey,
            r.projectNumber ? "Hoog" : r.project && r.city ? "Middel" : "Laag",
            new Date().toISOString(),
          );
        }
        await this.run(
          "INSERT INTO project_keys(key,project_id) VALUES(?,?) ON CONFLICT DO NOTHING",
          matchKey,
          String(p.id),
        );
        await this.run(
          `INSERT INTO order_lines(id,source_key,project_id,import_id,source_row,source,document,position,article,description,quantity,order_date,document_type,price,debtor,debtor_number,recipient,address,raw,warnings,
            line_id,toc,unit,delivered_quantity,delivery_date,order_status,line_state,counted,postcode,country,region,recipient_number,family_source,currency)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          randomUUID(),
          r.key,
          String(p.id),
          id,
          rowIndex + 2,
          r.source,
          r.order,
          r.position,
          r.article,
          r.description,
          r.quantity,
          r.date,
          r.documentType,
          r.price,
          r.debtor,
          r.debtorNumber,
          r.recipient,
          r.address,
          JSON.stringify(r.raw),
          JSON.stringify(r.warnings),
          r.lineId ?? "",
          r.toc ?? "",
          r.unit ?? "",
          r.deliveredQuantity ?? null,
          r.deliveryDate ?? null,
          r.orderStatus ?? "",
          r.lineState ?? "Normaal",
          r.counted ?? 1,
          r.postcode ?? "",
          r.country ?? "",
          r.region ?? "",
          r.recipientNumber ?? "",
          r.familySource ?? "",
          r.currency ?? "",
        );
        await this.run("INSERT INTO catalog(article) VALUES(?) ON CONFLICT DO NOTHING", r.article);
        if (r.debtor)
          await this.linkRelation(String(p.id), r.debtor, r.debtorNumber, "Debiteur");
        if (r.recipient)
          await this.linkRelation(
            String(p.id),
            r.recipient,
            r.recipientNumber ?? "",
            "Goederenontvanger",
          );
        added++;
      }
      await this.audit(
        "Import",
        id,
        `${filename}: ${added} nieuwe regels, ${info.duplicates} dubbelen${meta.profile ? ", profiel " + meta.profile : ""}`,
      );
      return {
        id,
        added,
        duplicates: info.duplicates,
        conflicts: info.conflicts,
      };
    });
  }
  /** Bestaand dossier voor een SAP-projectnummer: eerst via de historie-sleutel, dan via het projectnummer. */
  private async historyProject(projectNumber: string) {
    const key = "sapproject:" + projectNumber;
    const viaKey = await this.projectForKey(key);
    if (viaKey) return { id: String(viaKey.id), matches: 1 };
    // Oudste dossier eerst: SQLite op invoegvolgorde, PostgreSQL op aanmaakmoment.
    const same = await this.all(
      `SELECT id FROM projects WHERE project_number=? ORDER BY ${this.dialect === "sqlite" ? "rowid" : "created_at NULLS FIRST,id"}`,
      projectNumber,
    );
    return same.length ? { id: String(same[0].id), matches: same.length } : null;
  }
  /** Wat een projecthistorie-import zou doen, zonder iets op te slaan. */
  /**
   * Vergelijking van een SAP-projectrapport met de database, zonder iets op te slaan (recept B100):
   * nieuw · ongewijzigd · bijgewerkt (zelfde bronidentiteit, andere bedragen of omschrijving) ·
   * mogelijk dubbel (zelfde nummers, andere ontvangernaam/-plaats terwijl de oude regel ontbreekt) ·
   * ontbrekend in dit bestand (alleen gemeld, nooit verwijderd) · projectgegevens uit SAP gewijzigd
   * (bijwerken als niemand ze in Re-Line aanpaste, anders melding en lokale waarde houden).
   */
  async historyPreview(rows: HistoryRow[]) {
    const plan = await this.historyPlan(rows);
    const { sums, byKey, newRows, updatedRows, unchanged, newProjects, existingProjects, ambiguous, possibleDuplicates, missing, projectUpdates, projectConflicts } = plan;
    const conflicts: string[] = [];
    for (const n of ambiguous)
      conflicts.push(`SAP-projectnummer ${n} staat in meerdere bestaande dossiers; de historie wordt aan het eerste gekoppeld. Controleer en voeg zo nodig samen.`);
    for (const c of projectConflicts)
      conflicts.push(`Project ${c.projectNumber}: ${c.field} gewijzigd in SAP, maar in Re-Line aangepast; Re-Line-waarde blijft staan.`);
    for (const d of possibleDuplicates.slice(0, 50))
      conflicts.push(`Project ${d.projectNumber}, boekjaar ${d.fiscalYear}: mogelijk dubbele regel (zelfde klant/materiaal/ontvangernummer, andere ontvangernaam of -plaats). Controleer na de import.`);
    for (const r of byKey.values()) if (r.dupInFile) conflicts.push(`Rij ${r.row.sourceRow}: dezelfde bronregel staat twee keer in het bestand; de eerste telt.`);
    const years = rows.map((r) => r.fiscalYear);
    const series: Record<string, number> = {};
    for (const r of rows) series[r.series || "Onbekend"] = (series[r.series || "Onbekend"] ?? 0) + 1;
    return {
      totalRows: rows.length,
      newRows: newRows.length,
      updatedRows: updatedRows.length,
      duplicates: unchanged,
      conflicts,
      projectsInFile: new Set(rows.map((r) => r.projectNumber)).size,
      newProjects: newProjects.size,
      existingProjects: existingProjects.size,
      possibleDuplicates: possibleDuplicates.length,
      missingLines: missing.lines,
      missingProjects: missing.projects,
      projectUpdates: projectUpdates.length,
      projectConflicts: projectConflicts.length,
      firstYear: years.length ? Math.min(...years) : null,
      lastYear: years.length ? Math.max(...years) : null,
      series,
      sums,
    };
  }
  /** Gedeeld rekenwerk voor voorbeeld en import. */
  private async historyPlan(rows: HistoryRow[]) {
    const byKey = new Map<string, { row: HistoryRow; dupInFile: boolean }>();
    for (const r of rows) {
      const seen = byKey.get(r.key);
      if (seen) seen.dupInFile = true;
      else byKey.set(r.key, { row: r, dupInFile: false });
    }
    const existing = new Map<string, RecordRow>();
    for (const h of await this.all(
      "SELECT id,source_key,project_id,project_number,fiscal_year,customer_number,material,recipient_number,raw FROM history_lines",
    ))
      existing.set(String(h.source_key), h);
    const sums = { quantity: 0, revenue: 0, netRevenue: 0, newQuantity: 0, newRevenue: 0, newNetRevenue: 0 };
    const newRows: HistoryRow[] = [],
      updatedRows: { row: HistoryRow; current: RecordRow }[] = [];
    let unchanged = 0;
    for (const r of rows) {
      sums.quantity += r.quantity;
      sums.revenue += r.revenue;
      sums.netRevenue += r.netRevenue;
    }
    for (const { row: r } of byKey.values()) {
      const cur = existing.get(r.key);
      if (!cur) {
        newRows.push(r);
        sums.newQuantity += r.quantity;
        sums.newRevenue += r.revenue;
        sums.newNetRevenue += r.netRevenue;
      } else if (String(cur.raw) === JSON.stringify(r.raw)) unchanged++;
      else updatedRows.push({ row: r, current: cur });
    }
    unchanged += rows.length - byKey.size;
    // Mogelijk dubbel: nieuwe regel met dezelfde nummers als een bestaande regel die in dit bestand ontbreekt.
    const numeric = (x: { projectNumber?: unknown; project_number?: unknown; fiscalYear?: unknown; fiscal_year?: unknown; customerNumber?: unknown; customer_number?: unknown; material?: unknown; recipientNumber?: unknown; recipient_number?: unknown }) =>
      [x.projectNumber ?? x.project_number, x.fiscalYear ?? x.fiscal_year, x.customerNumber ?? x.customer_number, x.material, x.recipientNumber ?? x.recipient_number].join("|");
    const fileKeys = new Set(byKey.keys());
    const missingRows = [...existing.values()].filter((h) => !fileKeys.has(String(h.source_key)));
    const fileProjects = new Set(rows.map((r) => r.projectNumber));
    const missingInFileProjects = missingRows.filter((h) => fileProjects.has(String(h.project_number)));
    const missingByNumeric = new Set(missingRows.map((h) => numeric(h)));
    const possibleDuplicates = newRows.filter((r) => missingByNumeric.has(numeric(r)));
    const newProjects = new Set<string>(),
      existingProjects = new Set<string>(),
      ambiguous = new Set<string>();
    const projectOf = new Map<string, string | null>();
    for (const n of fileProjects) {
      const found = await this.historyProject(n);
      projectOf.set(n, found?.id ?? null);
      if (found) {
        if (newRows.some((r) => r.projectNumber === n) || updatedRows.some((u) => u.row.projectNumber === n)) existingProjects.add(n);
        if (found.matches > 1) ambiguous.add(n);
      } else newProjects.add(n);
    }
    // Projectgegevens uit SAP (meest recente boekjaar in dit bestand) tegen bronrecord en lokale waarde.
    const latest = new Map<string, HistoryRow>();
    for (const r of rows) {
      const l = latest.get(r.projectNumber);
      if (!l || r.fiscalYear > l.fiscalYear || (r.fiscalYear === l.fiscalYear && r.sourceRow < l.sourceRow)) latest.set(r.projectNumber, r);
    }
    const projectUpdates: { projectId: string; projectNumber: string; field: string; value: string }[] = [];
    const projectConflicts: { projectId: string; projectNumber: string; field: string }[] = [];
    const sourceUpdates: { projectNumber: string; projectId: string; values: Record<string, string> }[] = [];
    for (const [n, r] of latest) {
      const pid = projectOf.get(n);
      const values = { name: r.projectName, city: r.projectCity, address: r.projectStreet };
      if (!pid) continue; // nieuw dossier krijgt de bronwaarden bij aanmaken
      const rec = await this.one("SELECT values_json FROM source_records WHERE source=? AND external_id=?", historySource, n);
      const old = rec ? (JSON.parse(String(rec.values_json)) as Record<string, string>) : null;
      const project = (await this.one("SELECT name,city,address,location_confirmed FROM projects WHERE id=?", pid))!;
      if (!old) {
        sourceUpdates.push({ projectNumber: n, projectId: pid, values });
        continue;
      }
      let changed = false;
      for (const field of ["name", "city", "address"] as const) {
        const now = values[field] ?? "";
        if (now === (old[field] ?? "") || !now) continue;
        changed = true;
        const local = String(project[field] ?? "");
        const lockedAddress = field === "address" && Number(project.location_confirmed);
        if (!lockedAddress && (local === (old[field] ?? "") || !local)) projectUpdates.push({ projectId: pid, projectNumber: n, field, value: now });
        else projectConflicts.push({ projectId: pid, projectNumber: n, field });
      }
      if (changed) sourceUpdates.push({ projectNumber: n, projectId: pid, values });
    }
    return {
      sums, byKey, newRows, updatedRows, unchanged, newProjects, existingProjects, ambiguous, possibleDuplicates,
      missing: { lines: missingRows.length, projects: new Set(missingRows.map((h) => String(h.project_number))).size, inFileProjects: missingInFileProjects.length },
      projectUpdates, projectConflicts, sourceUpdates, projectOf, latest,
    };
  }
  /**
   * Projecthistorie opslaan: één dossier per SAP-projectnummer, bronregels apart van orderregels.
   * Nieuwe regels erbij; gewijzigde regels bijgewerkt met de oude waarden in history_line_changes;
   * ontbrekende regels blijven staan. Status, notities, eigenaar, bevestigingen en activiteiten blijven
   * onaangeroerd; projectnaam/plaats/straat alleen volgens de bronrecordregels (zie historyPreview).
   */
  async ingestHistory(filename: string, rows: HistoryRow[], meta: { sha256?: string; totalRows?: number } = {}) {
    return this.transaction(async () => {
      const id = randomUUID(),
        info = await this.historyPreview(rows),
        plan = await this.historyPlan(rows);
      const now = new Date().toISOString();
      await this.run(
        "INSERT INTO imports(id,filename,created,added,duplicates,warnings,profile,sha256,total_rows,kind,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        id,
        filename,
        now,
        info.newRows,
        info.duplicates,
        JSON.stringify(info.conflicts),
        "SAP-rapport E-Line Projects (projecthistorie)",
        meta.sha256 ?? "",
        meta.totalRows ?? rows.length,
        "Projecthistorie",
        currentActor().name,
      );
      let added = 0,
        created = 0,
        updated = 0;
      const touched = new Set<string>();
      const insertSql = `INSERT INTO history_lines(id,source_key,project_id,import_id,source_row,project_number,project_name,fiscal_year,customer_number,customer_name,material,series,material_desc,recipient_number,recipient_name,recipient_city,project_city,project_street,org_unit,quantity,revenue,net_revenue,raw)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      for (const r of plan.newRows) {
        const key = "sapproject:" + r.projectNumber;
        let projectId = plan.projectOf.get(r.projectNumber) ?? (await this.historyProject(r.projectNumber))?.id;
        if (!projectId) {
          projectId = randomUUID();
          const src = plan.latest.get(r.projectNumber) ?? r;
          await this.run(
            "INSERT INTO projects(id,name,city,address,project_number,match_key,confidence,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
            projectId,
            src.projectName || "Onbekend project · SAP " + r.projectNumber,
            src.projectCity,
            src.projectStreet,
            r.projectNumber,
            key,
            "Hoog",
            now,
            now,
            currentActor().name,
          );
          await this.run(
            "INSERT INTO source_records(source,external_id,entity_id,values_json,updated) VALUES(?,?,?,?,?) ON CONFLICT(source,external_id) DO UPDATE SET entity_id=excluded.entity_id,values_json=excluded.values_json,updated=excluded.updated",
            historySource, r.projectNumber, projectId,
            JSON.stringify({ name: src.projectName, city: src.projectCity, address: src.projectStreet }), now,
          );
          plan.projectOf.set(r.projectNumber, projectId);
          created++;
          touched.add(projectId);
        } else if (!touched.has(projectId)) {
          // Bestaand dossier zonder bronrecord: alleen lege velden aanvullen.
          await this.run(
            `UPDATE projects SET city=CASE WHEN city='' THEN ? ELSE city END,
               address=CASE WHEN address='' AND location_confirmed=0 THEN ? ELSE address END,
               project_number=CASE WHEN project_number='' THEN ? ELSE project_number END WHERE id=?`,
            r.projectCity,
            r.projectStreet,
            r.projectNumber,
            projectId,
          );
          touched.add(projectId);
        }
        await this.run("INSERT INTO project_keys(key,project_id) VALUES(?,?) ON CONFLICT DO NOTHING", key, projectId);
        await this.run(
          insertSql,
          randomUUID(), r.key, projectId, id, r.sourceRow, r.projectNumber, r.projectName, r.fiscalYear,
          r.customerNumber, r.customerName, r.material, r.series, r.materialDesc, r.recipientNumber, r.recipientName,
          r.recipientCity, r.projectCity, r.projectStreet, r.orgUnit, r.quantity, r.revenue, r.netRevenue, JSON.stringify(r.raw),
        );
        if (r.customerName) await this.linkRelation(projectId, r.customerName, r.customerNumber, "Debiteur");
        if (r.recipientName) await this.linkRelation(projectId, r.recipientName, r.recipientNumber, "Goederenontvanger");
        added++;
      }
      // Gewijzigde bronregels bijwerken; oude waarden bewaren.
      for (const { row: r, current } of plan.updatedRows) {
        const before = await this.one("SELECT * FROM history_lines WHERE id=?", String(current.id));
        const after: Record<string, Param> = {
          project_name: r.projectName, customer_name: r.customerName, series: r.series, material_desc: r.materialDesc,
          project_city: r.projectCity, project_street: r.projectStreet, org_unit: r.orgUnit,
          quantity: r.quantity, revenue: r.revenue, net_revenue: r.netRevenue, raw: JSON.stringify(r.raw), source_row: r.sourceRow,
        };
        const diff: Record<string, { voor: unknown; na: unknown }> = {};
        for (const [k, v] of Object.entries(after)) if (k !== "raw" && k !== "source_row" && before && before[k] !== v) diff[k] = { voor: before[k], na: v };
        await this.run(
          `UPDATE history_lines SET ${Object.keys(after).map((k) => `${k}=?`).join(",")} WHERE id=?`,
          ...Object.values(after),
          String(current.id),
        );
        await this.run(
          "INSERT INTO history_line_changes(id,line_id,import_id,created,changed) VALUES(?,?,?,?,?)",
          randomUUID(), String(current.id), id, now, JSON.stringify(diff),
        );
        if (r.customerName) await this.linkRelation(String(current.project_id), r.customerName, r.customerNumber, "Debiteur");
        updated++;
      }
      // Projectgegevens uit SAP volgens het bronrecord; conflicten houden de lokale waarde.
      for (const u of plan.projectUpdates) {
        await this.run(`UPDATE projects SET ${u.field}=?,version=version+1,updated_at=?,updated_by=? WHERE id=?`, u.value, now, currentActor().name, u.projectId);
        await this.audit("Projectgegevens bijgewerkt uit SAP", u.projectId, JSON.stringify({ veld: u.field, waarde: u.value }));
      }
      for (const s of plan.sourceUpdates)
        await this.run(
          "INSERT INTO source_records(source,external_id,entity_id,values_json,updated) VALUES(?,?,?,?,?) ON CONFLICT(source,external_id) DO UPDATE SET entity_id=excluded.entity_id,values_json=excluded.values_json,updated=excluded.updated",
          historySource, s.projectNumber, s.projectId, JSON.stringify(s.values), now,
        );
      await this.run("UPDATE imports SET added=?,duplicates=? WHERE id=?", added, info.duplicates, id);
      await this.audit(
        "Import projecthistorie",
        id,
        `${filename}: ${added} nieuw, ${updated} bijgewerkt, ${info.duplicates} ongewijzigd, ${created} nieuwe dossiers, ${info.missingLines} niet in dit bestand (niets verwijderd)`,
      );
      return {
        id, added, updated, duplicates: info.duplicates, conflicts: info.conflicts, newProjects: created,
        projectsTouched: touched.size, projectUpdates: plan.projectUpdates.length, missingLines: info.missingLines,
        possibleDuplicates: info.possibleDuplicates,
      };
    });
  }
  /**
   * Vaste werkvoorraad: de n dossiers met projecthistorie en de hoogste renovatiescore krijgen een
   * rangnummer en een opgeslagen selectie. Status, eigenaar en notities veranderen niet.
   */
  async selectCandidates(n = 100) {
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw Error("Kies een aantal tussen 1 en 1000");
    return this.transaction(async () => {
      const { considered, selected } = rankCandidates(
        await this.projects() as unknown as Parameters<typeof rankCandidates>[0],
        n,
      );
      await this.run("UPDATE projects SET candidate_rank=NULL WHERE candidate_rank IS NOT NULL");
      for (const [i, p] of selected.entries()) await this.run("UPDATE projects SET candidate_rank=? WHERE id=?", i + 1, p.id);
      const created = new Date().toISOString();
      const name = `Renovatiekandidaten top ${n} (projecthistorie)`;
      await this.run("DELETE FROM selections WHERE name=?", name);
      await this.run(
        "INSERT INTO selections(id,name,project_ids,created) VALUES(?,?,?,?)",
        randomUUID(),
        name,
        JSON.stringify(selected.map((p) => p.id)),
        created,
      );
      const info = { n, selected: selected.length, considered, created, selection: name };
      await this.run(
        "INSERT INTO settings(key,value) VALUES('candidates',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        JSON.stringify(info),
      );
      await this.audit("Renovatiekandidaten bepaald", name, `${selected.length} van ${considered} dossiers met projecthistorie`);
      return info;
    });
  }
  /** Bestaat het dossier? (goedkope controle, zonder alle dossiers te berekenen) */
  async assertProject(id: string) {
    if (!(await this.one("SELECT id FROM projects WHERE id=?", id))) throw Error("Project niet gevonden");
  }
  /** Versie en laatste wijziging van één dossier (voor de melding "intussen gewijzigd"). */
  async projectVersion(id: string) {
    const r = await this.one("SELECT id,version,updated_at,updated_by FROM projects WHERE id=?", id);
    if (!r) throw Error("Project niet gevonden");
    return { id: String(r.id), version: Number(r.version), updatedAt: r.updated_at ?? null, updatedBy: String(r.updated_by ?? "") };
  }
  /** Relatie aanmaken of bijwerken en eventueel aan dossiers koppelen. */
  async saveRelation(id: string, data: RecordRow) {
    const role = String(data.role ?? "");
    if (!relationRoles.includes(role) || !String(data.name ?? "").trim()) throw Error("Relatienaam en rol verplicht");
    const projectIds: string[] = Array.isArray(data.projectIds)
      ? data.projectIds.map(String)
      : data.projectId
        ? [String(data.projectId)]
        : [];
    return this.transaction(async () => {
      let rid = id;
      if (id) {
        if (!(await this.one("SELECT id FROM relations WHERE id=?", id))) throw Error("Relatie ontbreekt");
        await this.run(
          "UPDATE relations SET name=?,role=?,contact=?,notes=? WHERE id=?",
          String(data.name), role, String(data.contact ?? ""), String(data.notes ?? ""), id,
        );
      } else {
        rid = randomUUID();
        await this.run(
          "INSERT INTO relations(id,name,number,role,contact,notes) VALUES(?,?,?,?,?,?)",
          rid, String(data.name), String(data.number ?? ""), role, String(data.contact ?? ""), String(data.notes ?? ""),
        );
      }
      for (const pid of projectIds) {
        await this.assertProject(pid);
        await this.run("INSERT INTO project_relations(project_id,relation_id) VALUES(?,?) ON CONFLICT DO NOTHING", pid, rid);
        await this.touch(pid, false);
      }
      await this.audit("Relatie opgeslagen", rid, `${role}${projectIds.length ? `, ${projectIds.length} dossier(s) gekoppeld` : ""}`);
      return rid;
    });
  }
  async linkRelations(relationId: string, ids: string[]) {
    if (!(await this.one("SELECT id FROM relations WHERE id=?", relationId))) throw Error("Relatie ontbreekt");
    await this.transaction(async () => {
      for (const pid of ids) {
        await this.assertProject(pid);
        await this.run("INSERT INTO project_relations(project_id,relation_id) VALUES(?,?) ON CONFLICT DO NOTHING", pid, relationId);
        await this.touch(pid, false);
      }
      await this.audit("Relatie gekoppeld", relationId, `${ids.length} dossier(s)`);
    });
  }
  async saveCatalog(data: RecordRow) {
    if (!String(data.article ?? "").trim()) throw Error("Artikelcode verplicht");
    if (data.family && !["E-Line", "C-Line", "Overig"].includes(String(data.family))) throw Error("Ongeldige productfamilie");
    const length = data.length === null || data.length === "" || data.length === undefined ? null : Number(data.length);
    if (length !== null && (!Number.isFinite(length) || length <= 0)) throw Error("Lengte moet positief zijn");
    if (data.confirmed && !String(data.evidence ?? "").trim()) throw Error("Een bevestigde classificatie vereist een bron");
    await this.transaction(async () => {
      await this.run(
        "INSERT INTO catalog(article,family,generation,profile_type,length,confirmed,evidence) VALUES(?,?,?,?,?,?,?) ON CONFLICT(article) DO UPDATE SET family=excluded.family,generation=excluded.generation,profile_type=excluded.profile_type,length=excluded.length,confirmed=excluded.confirmed,evidence=excluded.evidence",
        String(data.article), String(data.family ?? ""), String(data.generation ?? ""), String(data.profile_type ?? ""),
        length, data.confirmed ? 1 : 0, String(data.evidence ?? ""),
      );
      await this.audit(
        "Artikelclassificatie",
        String(data.article),
        JSON.stringify({ family: data.family, generation: data.generation, profile_type: data.profile_type, length, confirmed: !!data.confirmed, evidence: data.evidence }),
      );
    });
  }
  async saveWeights(data: RecordRow) {
    for (const k of Object.keys(defaultWeights)) {
      const v = data[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) throw Error("Scoregewichten moeten tussen 0 en 100 liggen");
    }
    const weights = Object.fromEntries(Object.keys(defaultWeights).map((k) => [k, data[k]])) as Weights;
    await this.transaction(async () => {
      await this.run(
        "INSERT INTO settings(key,value) VALUES('weights',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        JSON.stringify(weights),
      );
      await this.audit("Prioritering gewijzigd", "weights", JSON.stringify(weights));
    });
  }
  async saveScenario(projectId: string, kind: string, calculation: unknown) {
    await this.assertProject(projectId);
    await this.transaction(async () => {
      await this.run(
        "INSERT INTO scenarios(project_id,kind,data) VALUES(?,?,?) ON CONFLICT(project_id,kind) DO UPDATE SET data=excluded.data",
        projectId, kind, JSON.stringify(calculation),
      );
      await this.touch(projectId, false);
      await this.audit("Conceptscenario opgeslagen", projectId, kind);
    });
  }
  async saveSelection(name: string, ids: string[]) {
    if (!name.trim() || !Array.isArray(ids) || !ids.length) throw Error("Naam en minimaal één project verplicht");
    for (const pid of ids) await this.assertProject(String(pid));
    await this.transaction(async () => {
      await this.run(
        "INSERT INTO selections(id,name,project_ids,created) VALUES(?,?,?,?)",
        randomUUID(), name, JSON.stringify([...new Set(ids.map(String))]), new Date().toISOString(),
      );
      await this.audit("Selectie opgeslagen", name, `${ids.length} dossiers`);
    });
  }
  /**
   * Registreer wie het dossier het laatst wijzigde. `fields` = dossiervelden (status, beoordeling,
   * eigenaar …) gewijzigd: dan gaat de versie omhoog, zodat een verouderd formulier niet stil
   * overschrijft. Relaties, scenario's en activiteiten tellen niet als veldwijziging.
   */
  async touch(projectId: string, fields = false) {
    await this.run(
      `UPDATE projects SET ${fields ? "version=version+1," : ""}updated_at=?,updated_by=? WHERE id=?`,
      new Date().toISOString(),
      currentActor().name,
      projectId,
    );
  }
  async linkRelation(projectId: string, name: string, number: string, role: string) {
    await this.run(
      "INSERT INTO relations(id,name,number,role) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
      randomUUID(),
      name,
      number,
      role,
    );
    const r = (await this.one(
      "SELECT id FROM relations WHERE name=? AND number=? AND role=?",
      name,
      number,
      role,
    ))!;
    await this.run(
      "INSERT INTO project_relations(project_id,relation_id) VALUES(?,?) ON CONFLICT DO NOTHING",
      projectId,
      String(r.id),
    );
    return r;
  }
  /** Aggregaten van de projecthistorie per dossier, plus het grootste aantal projecten per klant. */
  private async historyAggregates() {
    const agg = new Map<string, RecordRow>();
    for (const r of await this.all(
      `SELECT project_id,COUNT(*) "historyLines",MIN(fiscal_year) "historyFirstYear",MAX(fiscal_year) "historyLastYear",
        SUM(quantity) "historyQuantity",SUM(revenue) "historyRevenue",SUM(net_revenue) "historyNetRevenue",
        SUM(CASE WHEN lower(series) LIKE '% old%' THEN 1 ELSE 0 END) "oldLines",
        SUM(CASE WHEN lower(series) LIKE '% old%' THEN net_revenue ELSE 0 END) "oldNetRevenue",
        ${this.sql.agg(`NULLIF(series,'')`, true)} series,
        ${this.sql.agg(`NULLIF(customer_name,'')`, true)} "historyCustomerNames",
        COUNT(DISTINCT customer_number||'|'||customer_name) "historyCustomers",
        COUNT(DISTINCT CASE WHEN recipient_name<>'' THEN recipient_number||'|'||recipient_name END) "historyRecipients",
        MAX(CASE WHEN project_street<>'' THEN 1 ELSE 0 END) "hasStreet"
       FROM history_lines GROUP BY project_id`,
    ))
      agg.set(String(r.project_id), r);
    const perCustomer = new Map<string, Set<string>>();
    const pairs = await this.all(
      "SELECT DISTINCT project_id,customer_number||'|'||customer_name customer FROM history_lines WHERE customer_name<>''",
    );
    for (const r of pairs) {
      const set = perCustomer.get(String(r.customer)) ?? new Set<string>();
      set.add(String(r.project_id));
      perCustomer.set(String(r.customer), set);
    }
    for (const r of pairs) {
      const a = agg.get(String(r.project_id));
      if (a) a.maxCustomerProjects = Math.max(Number(a.maxCustomerProjects ?? 0), perCustomer.get(String(r.customer))!.size);
    }
    return agg;
  }
  async projects(): Promise<ProjectRecord[]> {
    const weights = await this.weights();
    const history = await this.historyAggregates();
    return (await this.all(
      `SELECT p.*,COUNT(l.id) "lineCount",COUNT(DISTINCT l.document) "orderCount",
        MIN(CAST(substr(l.order_date,1,4) AS INTEGER)) "firstYear",MAX(CAST(substr(l.order_date,1,4) AS INTEGER)) "lastYear",
        COALESCE(SUM(CASE WHEN l.counted=1 THEN l.quantity ELSE 0 END),0) quantity,
        COALESCE(SUM(CASE WHEN l.counted=1 AND c.confirmed=1 AND c.family IN ('E-Line','C-Line') THEN l.quantity ELSE 0 END),0) "relevantQuantity",
        CASE WHEN COUNT(l.delivered_quantity)>0 THEN SUM(l.delivered_quantity) ELSE NULL END "deliveredQuantity",
        SUM(CASE WHEN l.counted=0 THEN 1 ELSE 0 END) "excludedLines",
        ${this.sql.agg(`CASE WHEN c.confirmed=1 THEN NULLIF(c.family,'') ELSE NULL END`, true)} families,
        ${this.sql.agg(`NULLIF(l.family_source,'')`, true)} "sourceFamilies",
        ${this.sql.agg(`NULLIF(l.debtor,'')`, true)} debtors,
        (SELECT ${this.sql.agg(`r.name`)} FROM relations r JOIN project_relations pr ON pr.relation_id=r.id WHERE pr.project_id=p.id AND r.role='Installateur') "installerNames",
        CASE WHEN SUM(l.counted)>0 AND SUM(CASE WHEN l.counted=1 AND (c.confirmed IS DISTINCT FROM 1 OR c.length IS NULL) THEN 1 ELSE 0 END)=0
          THEN SUM(CASE WHEN l.counted=1 THEN l.quantity*c.length ELSE 0 END) ELSE NULL END meters,
        (SELECT MIN(a.due) FROM activities a WHERE a.project_id=p.id AND a.done=0 AND a.due IS NOT NULL AND a.kind IN ('Bellen','Afspraak','Vervolgactie')) "nextDue",
        (SELECT COUNT(*) FROM activities a WHERE a.project_id=p.id AND a.done=0 AND a.kind IN ('Bellen','Afspraak','Vervolgactie')) "openActions",
        (SELECT MAX(a.created) FROM activities a WHERE a.project_id=p.id AND a.kind='Gespreksverslag') "lastContact"
       FROM projects p LEFT JOIN order_lines l ON l.project_id=p.id LEFT JOIN catalog c ON c.article=l.article GROUP BY p.id`,
    )).map((row) => {
      const h = history.get(String(row.id));
      const years = [row.firstYear, h?.historyFirstYear].filter((y) => y !== null && y !== undefined).map(Number);
      const lastYears = [row.lastYear, h?.historyLastYear].filter((y) => y !== null && y !== undefined).map(Number);
      const p: RecordRow = {
        ...row,
        historyLines: Number(h?.historyLines ?? 0),
        historyFirstYear: h?.historyFirstYear ?? null,
        historyLastYear: h?.historyLastYear ?? null,
        historyQuantity: Number(h?.historyQuantity ?? 0),
        historyRevenue: Number(h?.historyRevenue ?? 0),
        historyNetRevenue: Number(h?.historyNetRevenue ?? 0),
        series: h?.series ?? null,
        oldSeriesLines: Number(h?.oldLines ?? 0),
        historyCustomers: Number(h?.historyCustomers ?? 0),
        // Debiteur uit orderregels; anders de klant(en) volgens de projecthistorie.
        debtors: row.debtors ?? h?.historyCustomerNames ?? null,
        maxCustomerProjects: Number(h?.maxCustomerProjects ?? 0),
        oldestYear: years.length ? Math.min(...years) : null,
        latestYear: lastYears.length ? Math.max(...lastYears) : null,
      };
      const quality = Math.round(
        ((Number(!!p.city) +
          Number(!!p.project_number) +
          Number(!!p.address) +
          Number(p.oldestYear !== null) +
          Number(p.confidence === "Hoog")) /
          5) *
          100,
      );
      if (h) {
        // Dossier met projecthistorie: verklaarbare renovatiescore (lib/history.ts).
        const r = renovationScore({
          firstYear: h.historyFirstYear === null ? null : Number(h.historyFirstYear),
          lastYear: h.historyLastYear === null ? null : Number(h.historyLastYear),
          netRevenue: Number(h.historyNetRevenue ?? 0),
          lines: Number(h.historyLines),
          oldLines: Number(h.oldLines ?? 0),
          oldNetRevenue: Number(h.oldNetRevenue ?? 0),
          name: String(p.name ?? ""),
          city: String(p.city ?? ""),
          hasStreet: !!Number(h.hasStreet) || !!String(p.address ?? "").trim(),
          customers: Number(h.historyCustomers ?? 0),
          recipients: Number(h.historyRecipients ?? 0),
          maxCustomerProjects: Number(h.maxCustomerProjects ?? 0),
          need: String(p.need),
          locationConfirmed: Number(p.location_confirmed),
          relationshipConfirmed: Number(p.relationship_confirmed),
        });
        return { ...p, quality, priority: r.total, scoreParts: r.parts, scoreModel: "projecthistorie" };
      }
      const priority = score(
        {
          firstYear: p.firstYear as number | null,
          quantity: Number(p.relevantQuantity),
          orderCount: Number(p.orderCount),
          quality,
          locationConfirmed: Number(p.location_confirmed),
          relationshipConfirmed: Number(p.relationship_confirmed),
          need: String(p.need),
        },
        weights,
      );
      return {
        ...p,
        quality,
        priority: priority.total,
        scoreParts: priority.parts,
        scoreModel: "orderregels",
      };
    });
  }
  async owners() {
    return (await this.all(
      "SELECT owner FROM projects WHERE owner<>'' UNION SELECT owner FROM activities WHERE owner<>'' ORDER BY 1",
    )).map((r) => String(r.owner));
  }
  async snapshot() {
    const projects = await this.projects(),
      activities = await this.all(
        `SELECT a.*,p.name "projectName" FROM activities a JOIN projects p ON p.id=a.project_id ORDER BY a.due,a.created DESC`,
      );
    return {
      projects,
      activities,
      relations: await this.all(
        `SELECT r.*,COUNT(pr.project_id) "projectCount" FROM relations r LEFT JOIN project_relations pr ON pr.relation_id=r.id GROUP BY r.id ORDER BY r.name`,
      ),
      relationProjects: await this.all(
        `SELECT relation_id "relationId",project_id "projectId" FROM project_relations ORDER BY relation_id,project_id`,
      ),
      catalog: await this.all(
        `SELECT c.*,(SELECT ${this.sql.agg(`NULLIF(l.family_source,'')`, true)} FROM order_lines l WHERE l.article=c.article) "sourceFamily",
          (SELECT ${this.sql.agg(`NULLIF(l.description,'')`, true)} FROM order_lines l WHERE l.article=c.article) descriptions,
          (SELECT COUNT(*) FROM order_lines l WHERE l.article=c.article) "lineCount"
         FROM catalog c ORDER BY c.article`,
      ),
      imports: await this.all("SELECT * FROM imports ORDER BY created DESC"),
      selections: await this.all("SELECT * FROM selections ORDER BY created DESC"),
      profiles: await this.profiles(),
      owners: await this.owners(),
      backups: await this.backups(),
      schemaVersion: await this.driver.version(),
      historySeries: (await this.all("SELECT series,COUNT(*) lines FROM history_lines WHERE series<>'' GROUP BY series ORDER BY lines DESC")).map((r) => String(r.series)),
      candidateSelection: JSON.parse(String((await this.one("SELECT value FROM settings WHERE key='candidates'"))?.value ?? "null")),
      weights: await this.weights(),
      audit: await this.all("SELECT * FROM audit ORDER BY created DESC LIMIT 100"),
      dashboard: {
        projects: projects.length,
        potential: projects.filter(
          (p) =>
            p.status !== "Gewonnen" &&
            p.status !== "Verloren" &&
            p.status !== "Geen actuele kans" &&
            p.replaced !== "Ja" &&
            p.oldestYear !== null &&
            new Date().getFullYear() - Number(p.oldestYear) >= 10,
        ).length,
        historyProjects: projects.filter((p) => Number(p.historyLines) > 0).length,
        historyLines: Number((await this.one("SELECT COUNT(*) n FROM history_lines"))?.n ?? 0),
        candidates: projects.filter((p) => p.candidate_rank !== null && p.candidate_rank !== undefined).length,
        research: projects.filter(
          (p) =>
            p.status === "Nieuw gevonden" || p.status === "Nader onderzoeken",
        ).length,
        selected: projects.filter(
          (p) => p.status === "Geselecteerd voor contact",
        ).length,
        calls: activities.filter((a) => a.kind === "Bellen" && !a.done).length,
        appointments: activities.filter((a) => a.kind === "Afspraak" && !a.done)
          .length,
        ongoing: projects.filter((p) =>
          [
            "Technische inventarisatie",
            "Voorstel in voorbereiding",
            "Offerte uitgebracht",
          ].includes(String(p.status)),
        ).length,
      },
    };
  }
  async dossier(id: string): Promise<
    ProjectRecord & {
      lines: RecordRow[];
      history: RecordRow[];
      activities: RecordRow[];
      relations: RecordRow[];
      scenarios: RecordRow[];
    }
  > {
    const p = (await this.projects()).find((p) => p.id === id);
    if (!p) throw Error("Project niet gevonden");
    return {
      ...p,
      lines: await this.all(
        `SELECT l.*,i.filename,i.created "importDate",c.family,c.length,c.confirmed FROM order_lines l JOIN imports i ON i.id=l.import_id LEFT JOIN catalog c ON c.article=l.article WHERE l.project_id=? ORDER BY l.order_date,l.document,l.position`,
        id,
      ),
      history: await this.all(
        `SELECT h.*,i.filename,i.created "importDate" FROM history_lines h JOIN imports i ON i.id=h.import_id WHERE h.project_id=? ORDER BY h.fiscal_year,h.series,h.material,h.recipient_name`,
        id,
      ),
      activities: await this.all(
        "SELECT * FROM activities WHERE project_id=? ORDER BY created DESC",
        id,
      ),
      relations: await this.all(
        "SELECT r.* FROM relations r JOIN project_relations pr ON pr.relation_id=r.id WHERE pr.project_id=?",
        id,
      ),
      scenarios: await this.all("SELECT * FROM scenarios WHERE project_id=?", id),
    };
  }
  private async requireProject(id: string) {
    const p = await this.one("SELECT * FROM projects WHERE id=?", id);
    if (!p) throw Error("Project niet gevonden");
    return p;
  }
  /**
   * Bevestigingen (installatie aanwezig/vervangen, renovatiebehoefte, gecontroleerde locatie) vereisen
   * een vastgelegde bron: wie, hoe en wanneer. Ongewijzigde bestaande waarden blokkeren niet.
   */
  private checkEvidence(current: RecordRow, next: RecordRow) {
    const claims: [string, string, string][] = [
      ["present", "present_evidence", "aanwezigheid van de installatie"],
      ["replaced", "replaced_evidence", "vervanging van de installatie"],
      ["need", "need_evidence", "renovatiebehoefte"],
    ];
    for (const [field, ev, label] of claims) {
      const changed = next[field] !== current[field] || next[ev] !== current[ev];
      if (changed && next[field] !== "Onbekend" && !text(next[ev]))
        throw Error(
          `Leg vast hoe de ${label} is vastgesteld (bron, datum, contactpersoon) voordat je "${next[field]}" opslaat`,
        );
    }
    const locChanged =
      Number(next.location_confirmed) !== Number(current.location_confirmed) ||
      next.location_evidence !== current.location_evidence ||
      next.address !== current.address;
    if (locChanged && Number(next.location_confirmed)) {
      if (!text(next.address))
        throw Error("Een gecontroleerde installatielocatie vereist een adres");
      if (!text(next.location_evidence))
        throw Error(
          "Leg vast hoe de installatielocatie is gecontroleerd (bron, datum, contactpersoon)",
        );
    }
  }
  async updateProject(id: string, data: RecordRow) {
    const current = await this.requireProject(id);
    const allowed = [
      "name",
      "city",
      "address",
      "end_user",
      "status",
      "present",
      "replaced",
      "need",
      "present_evidence",
      "replaced_evidence",
      "need_evidence",
      "location_evidence",
      "contact",
      "owner",
      "notes",
      "next_action",
      "due",
      "route",
      "location_confirmed",
      "relationship_confirmed",
    ];
    if (data.status && !statuses.includes(String(data.status)))
      throw Error("Ongeldige salesstatus");
    for (const k of ["present", "replaced", "need"])
      if (
        data[k] !== undefined &&
        !["Ja", "Nee", "Onbekend"].includes(String(data[k]))
      )
        throw Error("Ongeldige beoordeling");
    if (
      data.route !== undefined &&
      !["Eindgebruiker", "Installateur"].includes(String(data.route))
    )
      throw Error("Ongeldige commerciële route");
    if (data.name !== undefined && !String(data.name).trim())
      throw Error("Projectnaam verplicht");
    if (data.due && !isDate(data.due)) throw Error("Ongeldige actiedatum");
    const changes: RecordRow = {};
    for (const key of allowed)
      if (data[key] !== undefined) {
        let value = data[key] as string | number | null;
        if (["location_confirmed", "relationship_confirmed"].includes(key))
          value = value ? 1 : 0;
        else if (key === "due") value = value ? String(value) : null;
        else if (value !== null) value = String(value).slice(0, 10000);
        if (value !== current[key]) changes[key] = value;
      }
    // Gelijktijdig bewerken: wie een verouderde versie opslaat, krijgt een conflict in plaats van stil te overschrijven.
    const expected = data.version === undefined || data.version === null ? null : Number(data.version);
    const conflict = () =>
      new ConflictError(
        `Dit dossier is intussen gewijzigd door ${current.updated_by || "een collega"}${current.updated_at ? " (" + new Date(String(current.updated_at)).toLocaleString("nl-NL") + ")" : ""}. Jouw wijzigingen zijn niet opgeslagen; laad de actuele versie en voer ze opnieuw in.`,
        { version: current.version, updatedBy: current.updated_by, updatedAt: current.updated_at },
      );
    if (expected !== null && expected !== Number(current.version)) throw conflict();
    this.checkEvidence(current, { ...current, ...changes });
    if (!Object.keys(changes).length) return { version: Number(current.version) };
    return this.transaction(async () => {
      const keys = Object.keys(changes);
      const r = await this.run(
        `UPDATE projects SET ${keys.map((k) => `${k}=?`).join(",")},version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?`,
        ...(keys.map((k) => changes[k]) as Param[]),
        new Date().toISOString(),
        currentActor().name,
        id,
        Number(current.version),
      );
      if (!r.changes) {
        const latest = (await this.one("SELECT version,updated_by,updated_at FROM projects WHERE id=?", id)) ?? current;
        Object.assign(current, latest);
        throw conflict();
      }
      await this.audit("Project bijgewerkt", id, JSON.stringify(changes));
      return { version: Number(current.version) + 1 };
    });
  }
  private async insertActivity(a: {
    projectId: string;
    kind: string;
    note: string;
    contact?: string;
    owner?: string;
    due?: string | null;
    done?: number;
    result?: string;
    outcome?: string;
    contactRole?: string;
    channel?: string;
    answers?: string;
    groupId?: string | null;
    relationId?: string | null;
  }) {
    const id = randomUUID();
    await this.run(
      `INSERT INTO activities(id,project_id,created,kind,note,contact,owner,due,done,result,outcome,contact_role,channel,answers,group_id,relation_id,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      a.projectId,
      new Date().toISOString(),
      a.kind,
      a.note.slice(0, 10000),
      text(a.contact, 500),
      text(a.owner, 200),
      a.due || null,
      a.done ?? 0,
      text(a.result, 2000),
      a.outcome ?? "",
      a.contactRole ?? "",
      a.channel ?? "",
      a.answers ?? "",
      a.groupId ?? null,
      a.relationId ?? null,
      currentActor().name,
    );
    return id;
  }
  async addActivity(projectId: string, data: RecordRow) {
    await this.requireProject(projectId);
    const kind = String(data.kind ?? "");
    if (!activityKinds.includes(kind) || !text(data.note))
      throw Error("Kies een activiteit en vul een notitie in");
    if (data.due && !isDate(data.due)) throw Error("Ongeldige actiedatum");
    return this.transaction(async () => {
      const id = await this.insertActivity({
        projectId,
        kind,
        note: text(data.note),
        contact: String(data.contact ?? ""),
        owner: String(data.owner ?? ""),
        due: data.due ? String(data.due) : null,
        done: ["Notitie", "Gespreksverslag"].includes(kind) ? 1 : 0,
        result: String(data.result ?? ""),
      });
      await this.touch(projectId, false);
      await this.audit("Activiteit toegevoegd", projectId, kind);
      return id;
    });
  }
  /** Rondt één activiteit af, of bij group=true alle activiteiten van dezelfde gezamenlijke afspraak. */
  async completeActivity(id: string, done: boolean, group = false) {
    const a = await this.one("SELECT id,group_id FROM activities WHERE id=?", id);
    if (!a) throw Error("Activiteit ontbreekt");
    await this.transaction(async () => {
      if (group && a.group_id)
        await this.run("UPDATE activities SET done=? WHERE group_id=?", done ? 1 : 0, String(a.group_id));
      else await this.run("UPDATE activities SET done=? WHERE id=?", done ? 1 : 0, id);
      await this.audit("Activiteit afgerond", id, `${done}${group && a.group_id ? " (gezamenlijk)" : ""}`);
    });
  }
  /**
   * Gespreksregistratie: één gespreksverslag met uitkomst en antwoorden. Alleen wat de gebruiker
   * expliciet aanvinkt wordt in het dossier bevestigd, met het gesprek als vastgelegde bron.
   */
  async logCall(projectId: string, d: RecordRow) {
    const project = await this.requireProject(projectId);
    const contact = text(d.contact, 300),
      role = String(d.contactRole ?? ""),
      channel = String(d.channel ?? ""),
      outcome = String(d.outcome ?? ""),
      note = text(d.note);
    if (!contact) throw Error("Vul in met wie je gesproken hebt");
    if (!contactRoles.includes(role)) throw Error("Kies de rol van de contactpersoon");
    if (!channels.includes(channel)) throw Error("Kies hoe het contact verliep");
    if (!callOutcomes.includes(outcome)) throw Error("Kies de uitkomst van het gesprek");
    if (!note) throw Error("Vul een korte samenvatting van het gesprek in");
    const answers: Record<string, { answer: string; note: string }> = {};
    const inputAnswers = (d.answers ?? {}) as Record<string, { answer?: string; note?: string }>;
    for (const [qid, v] of Object.entries(inputAnswers)) {
      if (!questions.some((q) => q.id === qid)) throw Error("Onbekende gespreksvraag");
      const answer = String(v?.answer ?? "Onbekend");
      if (!answerValues.includes(answer)) throw Error("Ongeldig antwoord");
      const n = text(v?.note, 2000);
      if (answer !== "Onbekend" || n) answers[qid] = { answer, note: n };
    }
    const follow = d.followUp as RecordRow | undefined;
    if (follow) {
      if (!plannedKinds.includes(String(follow.kind))) throw Error("Ongeldige vervolgactie");
      if (!text(follow.note)) throw Error("Beschrijf de vervolgactie");
      if (follow.due && !isDate(follow.due)) throw Error("Ongeldige datum vervolgactie");
    }
    if (d.status && !statuses.includes(String(d.status))) throw Error("Ongeldige salesstatus");
    const completeId = d.completeActivityId ? String(d.completeActivityId) : "";
    if (completeId) {
      const open = await this.one(
        "SELECT id FROM activities WHERE id=? AND project_id=? AND done=0",
        completeId,
        projectId,
      );
      if (!open) throw Error("De gekozen geplande actie hoort niet bij dit dossier of is al afgerond");
    }
    const date = new Date().toISOString().slice(0, 10);
    const evidence = `Gesprek ${date} met ${contact} (${role}, ${channel})`;
    const c = (d.confirm ?? {}) as RecordRow;
    const changes: RecordRow = {};
    for (const k of ["present", "replaced", "need"]) {
      if (c[k] === undefined || c[k] === "") continue;
      if (!["Ja", "Nee"].includes(String(c[k]))) throw Error("Ongeldige bevestiging");
      changes[k] = String(c[k]);
      changes[k + "_evidence"] = evidence;
    }
    if (c.location) {
      const address = text(c.address, 500);
      if (!address) throw Error("Vul het gecontroleerde adres in om de locatie te bevestigen");
      changes.address = address;
      changes.location_confirmed = 1;
      changes.location_evidence = evidence;
    }
    if (text(c.endUser)) changes.end_user = text(c.endUser, 300);
    if (d.status) changes.status = String(d.status);
    if (!text(project.contact)) changes.contact = contact;
    if (d.owner !== undefined && text(d.owner) && !text(project.owner)) changes.owner = text(d.owner, 200);
    return this.transaction(async () => {
      const id = await this.insertActivity({
        projectId,
        kind: "Gespreksverslag",
        note,
        contact,
        owner: String(d.owner ?? ""),
        done: 1,
        result: outcome,
        outcome,
        contactRole: role,
        channel,
        answers: Object.keys(answers).length ? JSON.stringify(answers) : "",
      });
      if (completeId)
        await this.run(
          "UPDATE activities SET done=1,result=? WHERE id=?",
          `${outcome} (gespreksverslag ${date})`,
          completeId,
        );
      if (follow)
        await this.insertActivity({
          projectId,
          kind: String(follow.kind),
          note: text(follow.note),
          contact,
          owner: String(follow.owner ?? d.owner ?? ""),
          due: follow.due ? String(follow.due) : null,
        });
      if (text(c.installer)) await this.linkRelation(projectId, text(c.installer, 300), "", "Installateur");
      for (const [key, value] of Object.entries(changes))
        await this.run(`UPDATE projects SET ${key}=? WHERE id=?`, value as string | number, projectId);
      await this.touch(projectId, Object.keys(changes).length > 0);
      await this.audit(
        "Gesprek geregistreerd",
        projectId,
        JSON.stringify({ outcome, role, channel, bevestigd: Object.keys(changes), installateur: text(c.installer) || undefined }),
      );
      return { id };
    });
  }
  /** Bulkactie vanuit werkvoorraad of portefeuille. Alleen expliciet gekozen velden wijzigen. */
  async bulk(ids: unknown, d: RecordRow) {
    if (!Array.isArray(ids) || !ids.length) throw Error("Selecteer minimaal één dossier");
    const list = [...new Set(ids.map(String))];
    for (const id of list) await this.requireProject(id);
    const owner = d.owner !== undefined ? text(d.owner, 200) : undefined;
    if (d.status && !statuses.includes(String(d.status))) throw Error("Ongeldige salesstatus");
    const plan = d.plan as RecordRow | undefined;
    if (plan) {
      if (!plannedKinds.includes(String(plan.kind))) throw Error("Ongeldige actie");
      if (!text(plan.note)) throw Error("Beschrijf de geplande actie");
      if (plan.due && !isDate(plan.due)) throw Error("Ongeldige actiedatum");
    }
    if (owner === undefined && !d.status && !plan) throw Error("Kies wat je met de selectie wilt doen");
    await this.transaction(async () => {
      for (const id of list) {
        if (owner !== undefined) await this.run("UPDATE projects SET owner=? WHERE id=?", owner, id);
        // statusFrom: alleen dossiers in een van deze statussen gaan naar de nieuwe status
        // (voorkomt dat een lopend traject terugvalt naar een eerdere fase).
        if (
          d.status &&
          (!Array.isArray(d.statusFrom) ||
            d.statusFrom.includes(String((await this.one("SELECT status FROM projects WHERE id=?", id))?.status)))
        )
          await this.run("UPDATE projects SET status=? WHERE id=?", String(d.status), id);
        if (plan)
          await this.insertActivity({
            projectId: id,
            kind: String(plan.kind),
            note: text(plan.note),
            owner: String(plan.owner ?? owner ?? ""),
            due: plan.due ? String(plan.due) : null,
          });
        await this.touch(id, owner !== undefined || !!d.status);
      }
      await this.audit(
        "Bulkactie",
        `${list.length} dossiers`,
        JSON.stringify({ owner, status: d.status, plan: plan ? plan.kind : undefined }),
      );
    });
    return { count: list.length };
  }
  /** Eén gezamenlijke afspraak (bijv. met een installateur) voor meerdere oude locaties. */
  async groupActivity(relationId: string, ids: unknown, d: RecordRow) {
    const relation = await this.one("SELECT * FROM relations WHERE id=?", relationId);
    if (!relation) throw Error("Relatie ontbreekt");
    if (!Array.isArray(ids) || !ids.length) throw Error("Selecteer minimaal één dossier");
    const list = [...new Set(ids.map(String))];
    for (const id of list) await this.requireProject(id);
    if (!plannedKinds.includes(String(d.kind))) throw Error("Ongeldige actie");
    if (d.due && !isDate(d.due)) throw Error("Ongeldige actiedatum");
    const note = text(d.note) || `Gezamenlijk gesprek met ${relation.name} over ${list.length} historische locaties`;
    const groupId = randomUUID();
    await this.transaction(async () => {
      for (const id of list)
        await this.insertActivity({
          projectId: id,
          kind: String(d.kind),
          note,
          contact: String(d.contact ?? relation.contact ?? ""),
          owner: String(d.owner ?? ""),
          due: d.due ? String(d.due) : null,
          groupId,
          relationId,
        });
      for (const id of list) await this.touch(id, false);
      await this.audit("Gezamenlijke actie gepland", relationId, `${list.length} dossiers`);
    });
    return { groupId, count: list.length };
  }
  async profiles() {
    return (await this.all("SELECT * FROM import_profiles ORDER BY name")).map((p) => ({
      id: String(p.id),
      name: String(p.name),
      notes: String(p.notes),
      created: String(p.created),
      mapping: JSON.parse(String(p.mapping)) as Mapping,
    }));
  }
  async saveProfile(name: string, mapping: unknown, notes = "") {
    const n = text(name, 120);
    if (!n) throw Error("Geef het importprofiel een naam");
    const clean = cleanMapping(mapping);
    await this.run(
      "INSERT INTO import_profiles(id,name,mapping,notes,created) VALUES(?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET mapping=excluded.mapping,notes=excluded.notes",
      randomUUID(),
      n,
      JSON.stringify(clean),
      text(notes, 2000),
      new Date().toISOString(),
    );
    await this.audit("Importprofiel opgeslagen", n, JSON.stringify(clean));
  }
  async merge(target: string, ids: string[]) {
    return this.transaction(async () => {
      if (!await this.one("SELECT id FROM projects WHERE id=?", target))
        throw Error("Doelproject ontbreekt");
      for (const id of [...new Set(ids)].filter((id) => id !== target)) {
        const p = await this.one("SELECT * FROM projects WHERE id=?", id);
        if (!p) throw Error("Project ontbreekt");
        await this.run(
          "UPDATE order_lines SET project_id=? WHERE project_id=?",
          target,
          id,
        );
        await this.run("UPDATE history_lines SET project_id=? WHERE project_id=?", target, id);
        if (p.candidate_rank !== null && p.candidate_rank !== undefined)
          await this.run(
            "UPDATE projects SET candidate_rank=CASE WHEN candidate_rank IS NULL OR candidate_rank>? THEN ? ELSE candidate_rank END WHERE id=?",
            Number(p.candidate_rank),
            Number(p.candidate_rank),
            target,
          );
        await this.run(
          "UPDATE activities SET project_id=? WHERE project_id=?",
          target,
          id,
        );
        await this.run(
          "INSERT INTO project_relations(project_id,relation_id) SELECT ?,relation_id FROM project_relations WHERE project_id=? ON CONFLICT DO NOTHING",
          target,
          id,
        );
        await this.run("DELETE FROM project_relations WHERE project_id=?", id);
        for (const s of await this.all(
          "SELECT * FROM scenarios WHERE project_id=?",
          id,
        ))
          await this.insertActivity({
            projectId: target,
            kind: "Samenvoeging",
            note: `Bewaard scenario ${s.kind} uit ${p.name}: ${s.data}`,
            done: 1,
          });
        await this.run("DELETE FROM scenarios WHERE project_id=?", id);
        await this.insertActivity({
          projectId: target,
          kind: "Samenvoeging",
          note: "Bewaarde dossiergegevens: " + JSON.stringify(p),
          done: 1,
        });
        await this.run(
          "UPDATE project_keys SET project_id=? WHERE project_id=?",
          target,
          id,
        );
        await this.run("DELETE FROM projects WHERE id=?", id);
        for (const sel of await this.all("SELECT * FROM selections")) {
          const list = JSON.parse(String(sel.project_ids)) as string[];
          if (list.includes(id))
            await this.run(
              "UPDATE selections SET project_ids=? WHERE id=?",
              JSON.stringify([
                ...new Set(list.map((x) => (x === id ? target : x))),
              ]),
              String(sel.id),
            );
        }
      }
      await this.run("UPDATE projects SET confidence='Handmatig' WHERE id=?", target);
      await this.audit("Projecten samengevoegd", target, JSON.stringify(ids));
    });
  }
  async split(projectId: string, lineIds: string[], name: string) {
    return this.transaction(async () => {
      if (!name.trim() || !lineIds.length)
        throw Error("Selecteer regels en geef een naam");
      const source = await this.one("SELECT * FROM projects WHERE id=?", projectId);
      if (!source) throw Error("Project ontbreekt");
      const own = (await this.all(
        "SELECT id FROM order_lines WHERE project_id=?",
        projectId,
      )).map((r) => r.id);
      if (
        lineIds.some((id) => !own.includes(id)) ||
        new Set(lineIds).size >= own.length
      )
        throw Error("Selecteer een deel van de regels van dit project");
      const id = randomUUID();
      await this.run(
        "INSERT INTO projects(id,name,city,confidence,created_at) VALUES(?,?,?,?,?)",
        id,
        name,
        String(source.city),
        "Handmatig",
        new Date().toISOString(),
      );
      for (const lineId of new Set(lineIds))
        await this.run("UPDATE order_lines SET project_id=? WHERE id=?", id, lineId);
      await this.run(
        "INSERT INTO project_relations(project_id,relation_id) SELECT ?,relation_id FROM project_relations WHERE project_id=?",
        id,
        projectId,
      );
      await this.run(
        "UPDATE projects SET confidence='Handmatig' WHERE id=?",
        projectId,
      );
      await this.audit("Project gesplitst", projectId, id);
      return { id };
    });
  }
  close() {
    return this.driver.close();
  }
}
let singleton: Promise<Store> | undefined;
/** Eén gedeelde Store per serverproces (SQLite-bestand of PostgreSQL-pool). */
export function store(): Promise<Store> {
  singleton ??= Store.open().catch((e) => {
    singleton = undefined;
    throw e;
  });
  return singleton;
}
