// Eén startcommando (Windows, macOS, Linux): controleert Node.js 24, installeert en bouwt alleen
// wanneer nodig, start Re-Line op 127.0.0.1 en opent de browser. Er wordt niets extern verstuurd.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
process.env.NEXT_TELEMETRY_DISABLED = "1";
const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";
const port = Number(process.env.PORT || 3000);
const url = `http://127.0.0.1:${port}`;

if (Number(process.versions.node.split(".")[0]) !== 24) {
  console.error(
    `Re-Line vraagt Node.js 24 LTS; deze computer heeft Node.js ${process.versions.node}.\n` +
      "Installeer Node.js 24 LTS (64-bit) via https://nodejs.org en start daarna opnieuw.",
  );
  process.exit(1);
}
function run(args) {
  const r = spawnSync(npm, args, { stdio: "inherit", shell: windows });
  if (r.status !== 0) {
    console.error(`\nStap mislukt: npm ${args.join(" ")}. Zie de melding hierboven.`);
    process.exit(r.status ?? 1);
  }
}
function fingerprint(paths) {
  const h = createHash("sha256");
  const walk = (p) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) walk(path.join(p, f));
    else h.update(p.replaceAll("\\", "/")).update(readFileSync(p));
  };
  paths.forEach(walk);
  return h.digest("hex");
}
const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");

// 1. Onderdelen: alleen opnieuw installeren als package-lock.json is gewijzigd.
const lock = fingerprint(["package-lock.json"]);
const depStamp = path.join("node_modules", ".re-line-lock");
if (read(depStamp) !== lock) {
  console.log("Onderdelen installeren (eenmalig; kan enkele minuten duren)…");
  run(["ci"]);
  writeFileSync(depStamp, lock);
}
// 2. Bouwen: alleen als de broncode sinds de vorige build is gewijzigd.
const source = fingerprint(["app", "lib", "package-lock.json", "next.config.ts", "tsconfig.json"]);
const buildStamp = path.join(".next", "re-line-build");
if (!existsSync(path.join(".next", "BUILD_ID")) || read(buildStamp) !== source) {
  console.log("Applicatie voorbereiden (bouwen)…");
  run(["run", "build"]);
  writeFileSync(buildStamp, source);
}
// 3. Starten en de browser openen zodra de server antwoordt.
console.log(`\nRe-Line start op ${url} (alleen bereikbaar op deze computer).`);
console.log("Laat dit venster open zolang je werkt. Stoppen: sluit het venster of druk Ctrl+C.\n");
const server = spawn(npm, ["start", "--", "--port", String(port)], { stdio: "inherit", shell: windows });
server.on("exit", (code) => process.exit(code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => server.kill(s));
if (process.env.RELINE_NO_BROWSER !== "1") {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      // server nog niet klaar
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const opener = windows
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  const child = spawn(opener[0], opener[1], { stdio: "ignore", detached: true });
  child.on("error", () => console.log(`Open zelf je browser op ${url}`));
  child.unref();
}
