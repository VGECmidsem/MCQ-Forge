import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "@/db";
import { questions, sources } from "@/db/schema";
import { classifyTopic, fingerprintOf, LETTERS } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildConds(searchParams: URLSearchParams) {
  const conds: any[] = [];
  const q = searchParams.get("q")?.trim();
  const status = searchParams.get("status");
  const topic = searchParams.get("topic");
  const sourceId = searchParams.get("sourceId");
  const ids = searchParams.get("ids")?.split(",").filter(Boolean);
  const sourceLabel = searchParams.get("source")?.trim();

  if (q) {
    conds.push(or(ilike(questions.text, `%${q}%`), ilike(questions.explanation, `%${q}%`)));
  }
  if (status === "verified" || status === "needs_verification") {
    conds.push(eq(questions.verificationStatus, status));
  }
  if (topic && topic !== "all") conds.push(eq(questions.topic, topic));
  if (sourceId) conds.push(eq(questions.sourceId, sourceId));
  if (sourceLabel) conds.push(eq(questions.sourceLabel, sourceLabel));
  if (ids?.length) conds.push(inArray(questions.id, ids.slice(0, 500)));
  if (searchParams.get("dup") === "1") {
    conds.push(
      sql`${questions.contentHash} in (select content_hash from questions group by content_hash having count(*) > 1)`,
    );
  }
  if (searchParams.get("warn") === "1") {
    conds.push(sql`jsonb_array_length(${questions.warnings}) > 0`);
  }
  return conds;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const conds = buildConds(searchParams);
  const where = conds.length ? and(...conds) : undefined;
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") || 50)));

  if (searchParams.get("countOnly") === "1") {
    const [t] = await db.select({ c: count() }).from(questions).where(where);
    return Response.json({ total: t.c });
  }

  const [items, [totalRow], topicRows, sourceRows] = await Promise.all([
    db
      .select()
      .from(questions)
      .where(where)
      .orderBy(asc(questions.createdAt), sql`${questions.questionNumber} asc nulls last`)
      .offset((page - 1) * pageSize)
      .limit(pageSize),
    db.select({ c: count() }).from(questions).where(where),
    db
      .selectDistinct({ topic: questions.topic })
      .from(questions)
      .orderBy(questions.topic),
    db
      .select({ id: sources.id, filename: sources.filename })
      .from(sources)
      .orderBy(desc(sources.createdAt))
      .limit(60),
  ]);

  return Response.json({
    items,
    total: totalRow.c,
    page,
    pageSize,
    topics: topicRows.map((t) => t.topic).filter(Boolean),
    sources: sourceRows,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.text !== "string") {
    return Response.json({ error: "Invalid question payload." }, { status: 400 });
  }
  const options: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.options ?? {})) {
    if (typeof v === "string" && v.trim() && LETTERS.includes(k.toUpperCase())) {
      options[k.toUpperCase()] = v.trim();
    }
  }
  if (!body.text.trim() || Object.keys(options).length < 2) {
    return Response.json(
      { error: "A question needs text and at least two options." },
      { status: 400 },
    );
  }
  const correct =
    typeof body.correctAnswer === "string" && options[body.correctAnswer.toUpperCase()]
      ? body.correctAnswer.toUpperCase()
      : null;
  const text = body.text.trim();
  const [row] = await db
    .insert(questions)
    .values({
      sourceId: null,
      sourceLabel: "manual",
      questionNumber: null,
      pageNumber: null,
      text,
      options,
      correctAnswer: correct,
      answerSource: correct ? "manual" : "none",
      verificationStatus: correct ? "verified" : "needs_verification",
      topic: typeof body.topic === "string" && body.topic.trim()
        ? body.topic.trim().slice(0, 80)
        : classifyTopic(text + " " + Object.values(options).join(" ")),
      explanation: typeof body.explanation === "string" && body.explanation.trim() ? body.explanation.trim() : null,
      warnings: [],
      contentHash: crypto
        .createHash("sha256")
        .update(fingerprintOf(text, options))
        .digest("hex")
        .slice(0, 32),
    })
    .returning();
  return Response.json({ question: row }, { status: 201 });
}

// Bulk operations on selected questions
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.slice(0, 1000) : [];
  const action = String(body?.action || "");
  if (!ids.length) return Response.json({ error: "No question ids supplied." }, { status: 400 });

  if (action === "delete") {
    await db.delete(questions).where(inArray(questions.id, ids));
    return Response.json({ deleted: ids.length });
  }
  if (action === "verify" || action === "unverify") {
    await db
      .update(questions)
      .set({
        verificationStatus: action === "verify" ? "verified" : "needs_verification",
        updatedAt: new Date(),
      })
      .where(inArray(questions.id, ids));
    return Response.json({ updated: ids.length });
  }
  if (action === "setTopic") {
    const value = typeof body.value === "string" ? body.value.trim().slice(0, 80) : "";
    await db
      .update(questions)
      .set({ topic: value || null, updatedAt: new Date() })
      .where(inArray(questions.id, ids));
    return Response.json({ updated: ids.length });
  }
  if (action === "setAnswer") {
    const letter = String(body.value || "").toUpperCase();
    if (!LETTERS.includes(letter)) {
      return Response.json({ error: "Answer must be an option letter." }, { status: 400 });
    }
    const rows = await db.select().from(questions).where(inArray(questions.id, ids));
    let updated = 0;
    for (const r of rows) {
      if (letter in (r.options as Record<string, string>)) {
        await db
          .update(questions)
          .set({
            correctAnswer: letter,
            answerSource: "manual",
            verificationStatus: "verified",
            updatedAt: new Date(),
          })
          .where(eq(questions.id, r.id));
        updated++;
      }
    }
    return Response.json({ updated, skipped: ids.length - updated });
  }
  return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
