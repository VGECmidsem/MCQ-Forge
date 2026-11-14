import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attempts, tests } from "@/db/schema";
import { gradeAttempt } from "@/lib/grading";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const [attempt] = await db.select().from(attempts).where(eq(attempts.id, id));
  if (!attempt) return Response.json({ error: "Attempt not found." }, { status: 404 });
  const [test] = await db.select().from(tests).where(eq(tests.id, attempt.testId));
  if (!test) return Response.json({ error: "Test not found." }, { status: 404 });

  if (attempt.status === "submitted" && attempt.result) {
    return Response.json({ alreadySubmitted: true, result: attempt.result });
  }

  const answers =
    body?.answers && typeof body.answers === "object" ? (body.answers as Record<string, string>) : attempt.answers;
  const marked: string[] = Array.isArray(body?.marked) ? body.marked.map(String) : attempt.marked;
  const remaining =
    typeof body?.remainingSeconds === "number"
      ? Math.max(0, Math.floor(body.remainingSeconds))
      : attempt.remainingSeconds;

  let timeTaken: number;
  if (attempt.durationSeconds) {
    timeTaken = Math.max(0, attempt.durationSeconds - (remaining ?? attempt.durationSeconds));
  } else {
    timeTaken = Math.max(0, Math.round((Date.now() - attempt.createdAt.getTime()) / 1000));
  }

  const result = gradeAttempt(test.snapshot, answers, marked, test.config, timeTaken);

  await db
    .update(attempts)
    .set({
      status: "submitted",
      answers,
      marked,
      remainingSeconds: remaining,
      timeTakenSeconds: timeTaken,
      result: result as unknown as Record<string, unknown>,
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(attempts.id, id));

  return Response.json({ result });
}
