import { plannedKinds } from "./domain";
/** Werkvoorraad: indeling van open acties op datum en samenvoegen van gezamenlijke afspraken. */
export type Bucket = "Achterstallig" | "Vandaag" | "Deze week" | "Later" | "Zonder datum";
export const buckets: Bucket[] = ["Achterstallig", "Vandaag", "Deze week", "Later", "Zonder datum"];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Week loopt t/m zondag. Datums als JJJJ-MM-DD in lokale tijd. */
export function dueBucket(due: string | null | undefined, today = new Date()): Bucket {
  if (!due) return "Zonder datum";
  const t = iso(today);
  if (due < t) return "Achterstallig";
  if (due === t) return "Vandaag";
  const end = new Date(today);
  end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
  return due <= iso(end) ? "Deze week" : "Later";
}

export type ActivityRow = {
  id: string;
  project_id: string;
  projectName?: string;
  kind: string;
  due?: string | null;
  done?: number | boolean;
  owner?: string;
  contact?: string;
  note?: string;
  group_id?: string | null;
};
export type WorkItem = {
  id: string;
  group: boolean;
  kind: string;
  due: string | null;
  bucket: Bucket;
  owner: string;
  contact: string;
  note: string;
  projects: { id: string; name: string }[];
};
/** Open geplande acties; activiteiten met dezelfde group_id worden één regel. */
export function workItems(
  activities: ActivityRow[],
  options: { owner?: string; today?: Date } = {},
): WorkItem[] {
  const items = new Map<string, WorkItem>();
  for (const a of activities) {
    if (a.done || !plannedKinds.includes(a.kind)) continue;
    if (options.owner === "__none__" ? !!a.owner : options.owner && a.owner !== options.owner) continue;
    const key = a.group_id || a.id;
    const existing = items.get(key);
    if (existing) {
      existing.projects.push({ id: a.project_id, name: String(a.projectName ?? "") });
      continue;
    }
    items.set(key, {
      id: a.id,
      group: !!a.group_id,
      kind: a.kind,
      due: a.due ?? null,
      bucket: dueBucket(a.due, options.today),
      owner: a.owner ?? "",
      contact: a.contact ?? "",
      note: a.note ?? "",
      projects: [{ id: a.project_id, name: String(a.projectName ?? "") }],
    });
  }
  return [...items.values()].sort(
    (a, b) =>
      buckets.indexOf(a.bucket) - buckets.indexOf(b.bucket) ||
      String(a.due ?? "9999").localeCompare(String(b.due ?? "9999")),
  );
}
