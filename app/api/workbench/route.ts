import { NextRequest, NextResponse } from "next/server";
import { fileHash, preview, readFile } from "@/lib/import";
import { excludedColumns, parseHistoryWorkbook } from "@/lib/history";
import { calculate, scenarioKinds, type Calculation } from "@/lib/calculator";
import { matchProfile, missingExpected } from "@/lib/profiles";
import { authMode, createUser, listUsers, rateLimit, resetActivation, updateUser } from "@/lib/auth";
import { asUser, checkOrigin, context, errorResponse, HttpError } from "@/lib/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Acties die alleen een beheerder mag uitvoeren (server-side afgedwongen). */
const adminActions = new Set(["profile", "backup", "candidates", "catalog", "weights", "merge", "split", "user.create", "user.update", "user.reset"]);

export async function GET(req: NextRequest) {
  try {
    const ctx = await context(req);
    const id = req.nextUrl.searchParams.get("project");
    if (id && req.nextUrl.searchParams.get("versie")) return NextResponse.json(await ctx.db.projectVersion(id));
    if (id) return NextResponse.json(await ctx.db.dossier(id));
    const snap = await ctx.db.snapshot();
    const users = authMode() === "uit" ? [] : await listUsers(ctx.db);
    return NextResponse.json({
      ...snap,
      me: ctx.user ? { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role, provider: ctx.user.provider } : null,
      authMode: authMode(),
      database: ctx.db.dialect,
      // Collega's (voor toewijzen); e-mail en status alleen voor de beheerder.
      users: users.map((u) =>
        ctx.role === "beheerder" ? u : { id: u.id, name: u.name, role: u.role, active: u.active },
      ),
      // Niet-beheerders zien geen auditdetails van andere gebruikers en geen back-uplijst.
      audit: ctx.role === "beheerder" ? snap.audit : [],
      backups: ctx.role === "beheerder" ? snap.backups : [],
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    const multipart = req.headers.get("content-type")?.includes("multipart/form-data");
    const body = multipart ? null : await req.json();
    const action = multipart ? "import" : String(body.action ?? "");
    const ctx = await context(req, multipart || adminActions.has(action) ? "beheerder" : "ingelogd");
    if (ctx.user && !(await rateLimit(ctx.db, "write", ctx.user.id))) throw new HttpError(429, "Te veel wijzigingen achter elkaar; wacht een minuut");
    const { db } = ctx;
    return await asUser(ctx, async () => {
      if (multipart) return importFile(req, ctx);
      const id = String(body.id ?? ""),
        data = body.data ?? {};
      switch (action) {
        case "project":
          return NextResponse.json(await db.updateProject(id, data));
        case "activity":
          await db.addActivity(id, data);
          break;
        case "complete":
          await db.completeActivity(id, !!data.done, !!data.group);
          break;
        case "call":
          return NextResponse.json(await db.logCall(id, data));
        case "bulk":
          return NextResponse.json(await db.bulk(data.ids, data));
        case "groupActivity":
          return NextResponse.json(await db.groupActivity(id, data.ids, data));
        case "profile":
          await db.saveProfile(String(data.name ?? ""), data.mapping, String(data.notes ?? ""));
          break;
        case "backup":
          return NextResponse.json(await db.backup("handmatig"));
        case "candidates":
          return NextResponse.json(await db.selectCandidates(Number(data.n ?? 100)));
        case "relation":
          await db.saveRelation(id, data);
          break;
        case "linkRelation":
          await db.linkRelations(String(data.relationId), Array.isArray(data.projectIds) ? data.projectIds.map(String) : [id]);
          break;
        case "catalog":
          await db.saveCatalog(data);
          break;
        case "weights":
          await db.saveWeights(data);
          break;
        case "scenario":
          if (!scenarioKinds.includes(data.kind)) throw Error("Onbekend scenario");
          calculate(data.calculation as Calculation);
          await db.saveScenario(id, data.kind, data.calculation);
          break;
        case "selection":
          await db.saveSelection(String(data.name ?? ""), data.ids);
          break;
        case "merge":
          await db.merge(id, data.ids);
          break;
        case "split":
          return NextResponse.json(await db.split(id, data.lineIds, String(data.name ?? "")));
        case "user.create": {
          if (authMode() === "entra") throw Error("Accounts worden beheerd in Entra ID");
          const r = await createUser(db, data, ctx.user?.name ?? "Lokale beheerder");
          // E-maillinkmodus: uitnodiging op de toegangslijst; de collega vraagt zelf een inloglink aan.
          return NextResponse.json(r.activationToken ? { id: r.id, activationPath: `/#activeren=${r.activationToken}` } : { id: r.id, invited: true });
        }
        case "user.reset": {
          if (authMode() !== "lokaal") throw Error("Accounts worden beheerd in Entra ID");
          const token = await resetActivation(db, id);
          return NextResponse.json({ activationPath: `/#activeren=${token}` });
        }
        case "user.update":
          await updateUser(db, id, data, ctx.user ?? { id: "", name: "Lokale beheerder", role: "beheerder" });
          break;
        default:
          throw Error("Onbekende actie");
      }
      return NextResponse.json({ ok: true });
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Import (alleen beheerder): voorbeeld of doorvoeren; SAP-projectrapport of orderexport. */
async function importFile(req: NextRequest, ctx: Awaited<ReturnType<typeof context>>) {
  const { db } = ctx;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size > 15 * 1024 * 1024) throw Error("Kies een bestand van maximaal 15 MB");
  const map = form.get("mapping");
  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = fileHash(buffer);
  // SAP-rapport met projecthistorie (blad met Projektnummer/Geschäftsjahr/Absatz/Umsatz): eigen import.
  const hist = /\.xlsx$/i.test(file.name) ? await parseHistoryWorkbook(buffer) : null;
  if (hist) {
    if (form.get("commit") === "true") {
      if (hist.errors.length) throw Error("Los alle importfouten op voordat je importeert");
      // SQLite: altijd eerst een bestandsback-up. PostgreSQL: de import is één transactie en de
      // database-omgeving bewaart point-in-time back-ups.
      const backup = db.dialect === "sqlite" && db.file !== ":memory:" ? await db.backup("voor-projecthistorie") : null;
      const result = await db.ingestHistory(file.name, hist.rows, { sha256, totalRows: hist.totalDataRows });
      const selection = (await db.one("SELECT value FROM settings WHERE key='candidates'")) ? null : await db.selectCandidates(100);
      return NextResponse.json({ kind: "projecthistorie", ...result, conflicts: result.conflicts.slice(0, 50), selection, backup: backup?.name ?? null });
    }
    const info = await db.historyPreview(hist.rows);
    return NextResponse.json({
      kind: "projecthistorie",
      sheet: hist.sheet,
      errors: hist.errors.slice(0, 50),
      errorCount: hist.errors.length,
      summaryRows: hist.summaryRows,
      totalDataRows: hist.totalDataRows,
      ignoredColumns: hist.ignoredColumns,
      excludedColumns,
      ...info,
      conflicts: info.conflicts.slice(0, 50),
      conflictCount: info.conflicts.length,
      sha256,
      previousImports: await db.previousImports(sha256),
    });
  }
  const rows = await readFile(file.name, buffer);
  const headers = Object.keys(rows[0] ?? {});
  const profile = map ? null : matchProfile(headers, await db.profiles());
  const p = preview(rows, map ? JSON.parse(String(map)) : (profile?.mapping ?? undefined));
  const info = await db.duplicateInfo(p.normalized);
  if (form.get("commit") === "true") {
    if (p.errors.length) throw Error("Los alle importfouten op voordat je importeert");
    return NextResponse.json(await db.ingest(file.name, p.normalized, { profile: String(form.get("profile") ?? ""), sha256, totalRows: rows.length }));
  }
  const states: Record<string, number> = {};
  for (const r of p.normalized) states[r.lineState] = (states[r.lineState] ?? 0) + 1;
  return NextResponse.json({
    ...p,
    ...info,
    rows: p.rows.slice(0, 50),
    normalized: p.normalized.slice(0, 50),
    totalRows: rows.length,
    sha256,
    previousImports: await db.previousImports(sha256),
    profile: profile?.name ?? null,
    clusters: await db.clusterPreview(p.normalized),
    lineStates: states,
    notCounted: p.normalized.filter((r) => !r.counted).length,
    missingExpected: missingExpected(p.mapping),
  });
}
