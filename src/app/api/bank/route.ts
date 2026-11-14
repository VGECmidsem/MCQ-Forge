import crypto from "node:crypto";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { classifyTopic, fingerprintOf, LETTERS, toCSV } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

function exportRow(q: typeof questions.$inferSelect) {
  const opts = (q.options ?? {}) as Record<string, string>;
  return {
    id: q.id,
    question_number: q.questionNumber,
    question_text: q.text,
    option_a: opts.A ?? "",
    option_b: opts.B ?? "",
    option_c: opts.C ?? "",
    option_d: opts.D ?? "",
    option_e: opts.E ?? "",
    correct_answer: q.correctAnswer ?? "",
    answer_source: q.answerSource,
    verification_status: q.verificationStatus,
    explanation: q.explanation ?? "",
    topic: q.topic ?? "",
    source_pdf: q.sourceLabel,
    page_number: q.pageNumber ?? "",
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") || "json").toLowerCase();
  const conds: any[] = [];
  const q = searchParams.get("q")?.trim();
  const status = searchParams.get("status");
  const topic = searchParams.get("topic");
  const sourceId = searchParams.get("sourceId");
  const ids = searchParams.get("ids")?.split(",").filter(Boolean);
  if (q) conds.push(or(ilike(questions.text, `%${q}%`), ilike(questions.explanation, `%${q}%`)));
  if (status === "verified" || status === "needs_verification")
    conds.push(eq(questions.verificationStatus, status));
  if (topic && topic !== "all") conds.push(eq(questions.topic, topic));
  if (sourceId) conds.push(eq(questions.sourceId, sourceId));
  if (ids?.length) conds.push(inArray(questions.id, ids.slice(0, 2000)));

  const rows = await db
    .select()
    .from(questions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(questions.createdAt)
    .limit(5000);

  const data = rows.map(exportRow);
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const headers = Object.keys(data[0] ?? exportRow({} as never));
    const csv = toCSV(headers, data as unknown as Record<string, unknown>[]);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="question-bank-${stamp}.csv"`,
      },
    });
  }
  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Question Bank");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="question-bank-${stamp}.xlsx"`,
      },
    });
  }
  return new Response(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), questions: data }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="question-bank-${stamp}.json"`,
    },
  });
}

// Import / restore a backup produced by the JSON export (or a compatible array).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const list: any[] = Array.isArray(body?.questions)
    ? body.questions
    : Array.isArray(body)
      ? body
      : [];
  if (!list.length) {
    return Response.json({ error: "No questions found in the import payload." }, { status: 400 });
  }

  const existing = await db.select({ h: questions.contentHash }).from(questions);
  const existingHashes = new Set(existing.map((e) => e.h));

  const rows: (typeof questions.$inferInsert)[] = [];
  let skipped = 0;
  for (const item of list.slice(0, 5000)) {
    const text = String(item?.question_text ?? item?.text ?? "").trim();
    const rawOpts = item?.options ?? {
      A: item?.option_a,
      B: item?.option_b,
      C: item?.option_c,
      D: item?.option_d,
      E: item?.option_e,
    };
    const options: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawOpts ?? {})) {
      if (typeof v === "string" && v.trim() && LETTERS.includes(k.toUpperCase())) {
        options[k.toUpperCase()] = v.trim();
      }
    }
    if (!text || Object.keys(options).length < 2) {
      skipped++;
      continue;
    }
    const hash = crypto
      .createHash("sha256")
      .update(fingerprintOf(text, options))
      .digest("hex")
      .slice(0, 32);
    if (existingHashes.has(hash) && body?.keepDuplicates !== true) {
      skipped++;
      continue;
    }
    existingHashes.add(hash);
    const letter = String(item?.correct_answer ?? item?.correctAnswer ?? "").toUpperCase();
    const correct = letter && letter in options ? letter : null;
    rows.push({
      sourceId: null,
      sourceLabel: String(item?.source_pdf ?? item?.sourceLabel ?? "imported").slice(0, 200),
      questionNumber:
        typeof (item?.question_number ?? item?.questionNumber) === "number"
          ? (item?.question_number ?? item?.questionNumber)
          : null,
      pageNumber: typeof (item?.page_number ?? item?.pageNumber) === "number" ? (item?.page_number ?? item?.pageNumber) : null,
      text,
      options,
      correctAnswer: correct,
      answerSource: correct ? String(item?.answer_source ?? "manual") : "none",
      verificationStatus: correct ? "verified" : "needs_verification",
      topic:
        typeof item?.topic === "string" && item.topic.trim()
          ? item.topic.trim().slice(0, 80)
          : classifyTopic(text + " " + Object.values(options).join(" ")),
      explanation:
        typeof item?.explanation === "string" && item.explanation.trim()
          ? item.explanation.trim()
          : null,
      warnings: [],
      contentHash: hash,
    });
  }

  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(questions).values(rows.slice(i, i + 200));
  }
  return Response.json({ imported: rows.length, skipped });
}

// Danger zone: wipe the entire bank (client asks for explicit confirmation).
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return Response.json({ error: "Pass { confirm: true } to wipe the bank." }, { status: 400 });
  }
  const deleted = await db.delete(questions).returning({ id: questions.id });
  void sql`1`;
  return Response.json({ deleted: deleted.length });
}
