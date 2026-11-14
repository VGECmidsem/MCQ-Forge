import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempts, tests } from "@/db/schema";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [test] = await db.select().from(tests).where(eq(tests.id, id));
  if (!test) return Response.json({ error: "Test not found." }, { status: 404 });
  const att = await db
    .select()
    .from(attempts)
    .where(eq(attempts.testId, id))
    .orderBy(desc(attempts.createdAt));
  return Response.json({
    test: {
      id: test.id,
      name: test.name,
      config: test.config,
      total: test.snapshot.length,
      gradable: test.gradableCount,
      maxMarks: test.maxMarks,
      createdAt: test.createdAt,
    },
    attempts: att.map((a) => ({
      id: a.id,
      status: a.status,
      createdAt: a.createdAt,
      submittedAt: a.submittedAt,
      percentage: a.result ? Number((a.result as any).percentage) : null,
      marksObtained: a.result ? Number((a.result as any).marksObtained) : null,
      maxMarks: a.result ? Number((a.result as any).maxMarks) : null,
    })),
  });
}

// Retake: start a fresh attempt on the same immutable snapshot.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [test] = await db.select().from(tests).where(eq(tests.id, id));
  if (!test) return Response.json({ error: "Test not found." }, { status: 404 });
  const cfg = test.config;
  const durationSeconds = cfg.durationMinutes > 0 ? cfg.durationMinutes * 60 : null;
  const [attempt] = await db
    .insert(attempts)
    .values({ testId: test.id, status: "in_progress", durationSeconds, remainingSeconds: durationSeconds })
    .returning();
  return Response.json({ attemptId: attempt.id });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [row] = await db.delete(tests).where(eq(tests.id, id)).returning({ id: tests.id });
  void sql`1`;
  if (!row) return Response.json({ error: "Test not found." }, { status: 404 });
  return Response.json({ deleted: true });
}
