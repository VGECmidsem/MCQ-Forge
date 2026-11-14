import { asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { jaccardSimilarity } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

interface DupGroup {
  keepId: string;
  keepPreview: string;
  kind: "exact" | "near";
  duplicateIds: string[];
  duplicatePreviews: string[];
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === "delete" ? "delete" : "scan";
  const includeNear = body?.includeNear !== false;

  const rows = await db
    .select({
      id: questions.id,
      text: questions.text,
      contentHash: questions.contentHash,
      sourceLabel: questions.sourceLabel,
      questionNumber: questions.questionNumber,
    })
    .from(questions)
    .orderBy(asc(questions.createdAt));

  const groups: DupGroup[] = [];
  const claimed = new Set<string>();

  // Exact duplicates (same normalized fingerprint)
  const byHash = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byHash.has(r.contentHash)) byHash.set(r.contentHash, []);
    byHash.get(r.contentHash)!.push(r);
  }
  for (const arr of byHash.values()) {
    if (arr.length > 1) {
      const [keep, ...rest] = arr;
      groups.push({
        keepId: keep.id,
        keepPreview: keep.text.slice(0, 120),
        kind: "exact",
        duplicateIds: rest.map((r) => r.id),
        duplicatePreviews: rest.map((r) =>
          `${r.sourceLabel}${r.questionNumber ? ` #${r.questionNumber}` : ""}`,
        ),
      });
      rest.forEach((r) => claimed.add(r.id));
    }
  }

  // Near duplicates via token-jaccard inside prefix buckets (legitimate
  // variations are listed for review, never auto-deleted).
  if (includeNear) {
    const buckets = new Map<string, typeof rows>();
    for (const r of rows) {
      if (claimed.has(r.id)) continue;
      const key = r.text.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(r);
    }
    for (const arr of buckets.values()) {
      const used = new Set<string>();
      for (let i = 0; i < arr.length; i++) {
        if (used.has(arr[i].id)) continue;
        const dups: typeof rows = [];
        for (let j = i + 1; j < arr.length; j++) {
          if (used.has(arr[j].id)) continue;
          if (jaccardSimilarity(arr[i].text, arr[j].text) >= 0.92) {
            dups.push(arr[j]);
            used.add(arr[j].id);
          }
        }
        if (dups.length) {
          groups.push({
            keepId: arr[i].id,
            keepPreview: arr[i].text.slice(0, 120),
            kind: "near",
            duplicateIds: dups.map((r) => r.id),
            duplicatePreviews: dups.map((r) =>
              `${r.sourceLabel}${r.questionNumber ? ` #${r.questionNumber}` : ""}`,
            ),
          });
        }
      }
    }
  }

  if (mode === "scan") {
    return Response.json({
      groups,
      duplicateCount: groups.reduce((s, g) => s + g.duplicateIds.length, 0),
    });
  }

  // delete exact duplicates only — near duplicates require explicit includeNear=true on delete
  const toDelete = groups
    .filter((g) => g.kind === "exact" || (includeNear && body?.includeNearConfirmed === true))
    .flatMap((g) => g.duplicateIds);
  if (toDelete.length) {
    await db.delete(questions).where(inArray(questions.id, toDelete));
  }
  return Response.json({ deleted: toDelete.length });
}
