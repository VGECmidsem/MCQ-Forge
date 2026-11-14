import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { aiConfigStatus, solveQuestionsWithAi } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET() {
  return Response.json(aiConfigStatus());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.slice(0, 20) : [];
  if (!ids.length) {
    return Response.json({ error: "Select up to 20 questions to solve with AI." }, { status: 400 });
  }
  const status = aiConfigStatus();
  if (!status.configured) {
    return Response.json(
      {
        error:
          "No AI provider configured. Set GEMINI_API_KEY (recommended) or OPENAI_API_KEY in your environment, then retry.",
        configured: false,
      },
      { status: 503 },
    );
  }

  const rows = await db.select().from(questions).where(inArray(questions.id, ids));
  if (!rows.length) return Response.json({ error: "Questions not found." }, { status: 404 });

  const payload = rows.map((r) => ({
    id: r.id,
    text: r.text,
    options: r.options as Record<string, string>,
  }));

  let answers;
  try {
    answers = await solveQuestionsWithAi(payload);
  } catch (e: any) {
    return Response.json(
      { error: e?.message || "AI request failed.", configured: true },
      { status: 502 },
    );
  }

  const results: Array<{
    id: string;
    applied: boolean;
    answer: string | null;
    explanation: string | null;
  }> = [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const a of answers) {
    const row = byId.get(a.id);
    if (!row) continue;
    const letter = a.answer.toUpperCase();
    if (letter === "UNKNOWN" || !(letter in (row.options as Record<string, string>))) {
      results.push({ id: a.id, applied: false, answer: null, explanation: a.explanation });
      continue;
    }
    await db
      .update(questions)
      .set({
        correctAnswer: letter,
        answerSource: "ai_generated",
        verificationStatus: "verified",
        explanation: row.explanation ?? a.explanation,
        updatedAt: new Date(),
      })
      .where(eq(questions.id, a.id));
    results.push({ id: a.id, applied: true, answer: letter, explanation: a.explanation });
  }

  return Response.json({
    provider: status.provider,
    model: status.model,
    results,
    appliedCount: results.filter((r) => r.applied).length,
    unknownCount: results.filter((r) => !r.applied).length,
    missing: ids.length - results.length,
  });
}
