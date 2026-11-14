import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempts, questions, sources, tests } from "@/db/schema";
import { aiConfigStatus } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [qCount] = await db.select({ c: count() }).from(questions);
  const [vCount] = await db
    .select({ c: count() })
    .from(questions)
    .where(eq(questions.verificationStatus, "verified"));
  const [sCount] = await db.select({ c: count() }).from(sources);
  const [tCount] = await db.select({ c: count() }).from(tests);
  const [submittedCount] = await db
    .select({ c: count() })
    .from(attempts)
    .where(eq(attempts.status, "submitted"));
  const [avgRow] = await db
    .select({
      avg: sql<number>`avg((${attempts.result} ->> 'percentage')::numeric)`,
    })
    .from(attempts)
    .where(sql`${attempts.result} is not null`);

  const topicRows = await db
    .select({ topic: questions.topic, c: count() })
    .from(questions)
    .groupBy(questions.topic)
    .orderBy(desc(count()))
    .limit(8);

  const sourceRows = await db
    .select({
      id: sources.id,
      filename: sources.filename,
      status: sources.status,
      questionsFound: sources.questionsFound,
      kind: sources.kind,
      createdAt: sources.createdAt,
    })
    .from(sources)
    .orderBy(desc(sources.createdAt))
    .limit(6);

  const recentAttempts = await db
    .select({
      id: attempts.id,
      testId: attempts.testId,
      status: attempts.status,
      createdAt: attempts.createdAt,
      name: tests.name,
      percentage: sql<number | null>`(${attempts.result} ->> 'percentage')::numeric`,
    })
    .from(attempts)
    .innerJoin(tests, eq(attempts.testId, tests.id))
    .orderBy(desc(attempts.createdAt))
    .limit(5);

  return Response.json({
    totalQuestions: qCount.c,
    verified: vCount.c,
    needsVerification: qCount.c - vCount.c,
    sources: sCount.c,
    tests: tCount.c,
    submittedAttempts: submittedCount.c,
    avgPercentage: avgRow.avg !== null && avgRow.avg !== undefined ? Math.round(Number(avgRow.avg) * 10) / 10 : null,
    topicDist: topicRows.map((t) => ({ topic: t.topic ?? "General", count: t.c })),
    recentSources: sourceRows,
    recentAttempts: recentAttempts.map((a) => ({
      ...a,
      percentage: a.percentage !== null ? Math.round(Number(a.percentage) * 10) / 10 : null,
    })),
    ai: aiConfigStatus(),
  });
}
