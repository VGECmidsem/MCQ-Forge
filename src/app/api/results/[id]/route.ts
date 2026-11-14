import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attempts, tests } from "@/db/schema";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [attempt] = await db.select().from(attempts).where(eq(attempts.id, id));
  if (!attempt) return Response.json({ error: "Attempt not found." }, { status: 404 });
  if (attempt.status !== "submitted" || !attempt.result) {
    return Response.json({ error: "This attempt has not been submitted yet.", status: attempt.status }, { status: 409 });
  }
  const [test] = await db.select().from(tests).where(eq(tests.id, attempt.testId));
  return Response.json({
    attemptId: attempt.id,
    testId: attempt.testId,
    testName: test?.name ?? "Mock Test",
    submittedAt: attempt.submittedAt,
    result: attempt.result,
  });
}
