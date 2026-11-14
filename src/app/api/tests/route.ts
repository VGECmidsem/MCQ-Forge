import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempts, questions, tests, type TestConfig } from "@/db/schema";
import { buildSnapshot } from "@/lib/grading";
import { shuffle } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid test configuration." }, { status: 400 });

  const scope = body.scope ?? { type: "all" };
  const conds: any[] = [];
  if (scope.type === "sources" && Array.isArray(scope.sourceIds) && scope.sourceIds.length) {
    conds.push(inArray(questions.sourceId, scope.sourceIds.slice(0, 200)));
  } else if (scope.type === "topics" && Array.isArray(scope.topics) && scope.topics.length) {
    conds.push(inArray(questions.topic, scope.topics.slice(0, 50)));
  } else if (scope.type === "ids" && Array.isArray(scope.ids) && scope.ids.length) {
    conds.push(inArray(questions.id, scope.ids.slice(0, 500)));
  }

  const includeUnverified = body.includeUnverified === true;
  if (!includeUnverified) {
    conds.push(eq(questions.verificationStatus, "verified"));
  }

  const rows = await db
    .select({
      id: questions.id,
      questionNumber: questions.questionNumber,
      text: questions.text,
      options: questions.options,
      correctAnswer: questions.correctAnswer,
      answerSource: questions.answerSource,
      verificationStatus: questions.verificationStatus,
      explanation: questions.explanation,
      topic: questions.topic,
      sourceLabel: questions.sourceLabel,
      pageNumber: questions.pageNumber,
    })
    .from(questions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${questions.questionNumber} asc nulls last`, questions.createdAt)
    .limit(5000);

  // Only questions with at least 2 options are gradable at all
  let list = rows.filter((r) => Object.keys((r.options as object) ?? {}).length >= 2);

  const shuffleQuestions = body.shuffleQuestions === true;
  const countSel = body.count;
  if (shuffleQuestions) list = shuffle(list);
  if (typeof countSel === "number" && countSel > 0 && countSel < list.length) {
    list = list.slice(0, countSel);
  }
  if (!list.length) {
    return Response.json(
      {
        error: includeUnverified
          ? "No usable questions match this selection."
          : "No verified questions match this selection. Verify answers first, or enable 'include unverified questions'.",
      },
      { status: 400 },
    );
  }

  const config: TestConfig = {
    name: String(body.name || "").slice(0, 120) || `Mock Test — ${new Date().toLocaleString()}`,
    scope,
    shuffleQuestions,
    shuffleOptions: body.shuffleOptions !== false,
    durationMinutes: Math.max(0, Math.min(600, Number(body.durationMinutes) || 0)),
    marksPerQuestion: Math.max(0.25, Number(body.marksPerQuestion) || 1),
    negativeMarks: Math.max(0, Number(body.negativeMarks) || 0),
    includeUnverified,
  };

  const snapshot = buildSnapshot(
    list.map((r) => ({ ...r, options: r.options as Record<string, string> })),
    config,
  );
  const gradable = snapshot.filter((q) => q.correctAnswer).length;
  if (gradable === 0) {
    return Response.json(
      { error: "None of the selected questions have a verified answer to grade against." },
      { status: 400 },
    );
  }

  const [test] = await db
    .insert(tests)
    .values({
      name: config.name,
      config,
      snapshot,
      gradableCount: gradable,
      maxMarks: gradable * config.marksPerQuestion,
    })
    .returning();

  const durationSeconds = config.durationMinutes > 0 ? config.durationMinutes * 60 : null;
  const [attempt] = await db
    .insert(attempts)
    .values({
      testId: test.id,
      status: "in_progress",
      durationSeconds,
      remainingSeconds: durationSeconds,
    })
    .returning();

  return Response.json({ testId: test.id, attemptId: attempt.id, total: snapshot.length });
}

export async function GET() {
  const rows = await db
    .select({
      attempt: attempts,
      testName: tests.name,
      total: sql<number>`jsonb_array_length(${tests.snapshot})`,
    })
    .from(attempts)
    .innerJoin(tests, eq(attempts.testId, tests.id))
    .orderBy(desc(attempts.createdAt))
    .limit(100);
  return Response.json({
    attempts: rows.map((r) => ({
      id: r.attempt.id,
      testId: r.attempt.testId,
      name: r.testName,
      status: r.attempt.status,
      total: Number(r.total),
      createdAt: r.attempt.createdAt,
      submittedAt: r.attempt.submittedAt,
      percentage: r.attempt.result ? Number((r.attempt.result as any).percentage) : null,
      marksObtained: r.attempt.result ? Number((r.attempt.result as any).marksObtained) : null,
      maxMarks: r.attempt.result ? Number((r.attempt.result as any).maxMarks) : null,
    })),
  });
}
