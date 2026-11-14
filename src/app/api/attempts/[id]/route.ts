import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attempts, tests } from "@/db/schema";
import { sanitizeSnapshot } from "@/lib/grading";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [attempt] = await db.select().from(attempts).where(eq(attempts.id, id));
  if (!attempt) return Response.json({ error: "Attempt not found." }, { status: 404 });
  const [test] = await db.select().from(tests).where(eq(tests.id, attempt.testId));
  if (!test) return Response.json({ error: "Test not found." }, { status: 404 });

  const cfg = test.config;
  return Response.json({
    attempt: {
      id: attempt.id,
      status: attempt.status,
      currentIndex: attempt.currentIndex,
      remainingSeconds: attempt.remainingSeconds,
      durationSeconds: attempt.durationSeconds,
      answers: attempt.answers,
      marked: attempt.marked,
      createdAt: attempt.createdAt,
    },
    test: {
      id: test.id,
      name: test.name,
      marksPerQuestion: cfg.marksPerQuestion,
      negativeMarks: cfg.negativeMarks,
      durationMinutes: cfg.durationMinutes,
    },
    questions: sanitizeSnapshot(test.snapshot),
    result: attempt.status === "submitted" ? attempt.result : null,
  });
}

// Autosave progress (answers, marks, position, remaining time).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid payload." }, { status: 400 });
  const [attempt] = await db.select().from(attempts).where(eq(attempts.id, id));
  if (!attempt) return Response.json({ error: "Attempt not found." }, { status: 404 });
  if (attempt.status !== "in_progress") {
    return Response.json({ error: "Attempt already submitted." }, { status: 409 });
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.answers && typeof body.answers === "object") patch.answers = body.answers;
  if (Array.isArray(body.marked)) patch.marked = body.marked.map(String).slice(0, 2000);
  if (typeof body.currentIndex === "number")
    patch.currentIndex = Math.max(0, Math.min(5000, Math.floor(body.currentIndex)));
  if (typeof body.remainingSeconds === "number")
    patch.remainingSeconds = Math.max(0, Math.floor(body.remainingSeconds));
  await db.update(attempts).set(patch).where(eq(attempts.id, id));
  return Response.json({ saved: true, at: new Date().toISOString() });
}
