import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { fingerprintOf, LETTERS } from "@/lib/utils";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid payload." }, { status: 400 });

  const [existing] = await db.select().from(questions).where(eq(questions.id, id));
  if (!existing) return Response.json({ error: "Question not found." }, { status: 404 });

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof body.text === "string") patch.text = body.text.trim() || existing.text;
  if (typeof body.explanation === "string")
    patch.explanation = body.explanation.trim() ? body.explanation.trim() : null;
  if (typeof body.topic === "string")
    patch.topic = body.topic.trim() ? body.topic.trim().slice(0, 80) : null;
  if (typeof body.questionNumber === "number" || body.questionNumber === null)
    patch.questionNumber = body.questionNumber;
  if (typeof body.pageNumber === "number" || body.pageNumber === null)
    patch.pageNumber = body.pageNumber;

  let options = existing.options as Record<string, string>;
  if (body.options && typeof body.options === "object") {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.options)) {
      if (typeof v === "string" && v.trim() && LETTERS.includes(k.toUpperCase())) {
        next[k.toUpperCase()] = v.trim();
      }
    }
    if (Object.keys(next).length >= 2) {
      options = next;
      patch.options = next;
    }
  }

  if (typeof body.correctAnswer === "string" || body.correctAnswer === null) {
    const letter = body.correctAnswer ? String(body.correctAnswer).toUpperCase() : null;
    if (letter && !(letter in options)) {
      return Response.json(
        { error: `Option ${letter} does not exist for this question.` },
        { status: 400 },
      );
    }
    patch.correctAnswer = letter;
    if (letter) {
      patch.answerSource = "manual";
      patch.verificationStatus = "verified";
    } else {
      patch.answerSource = "none";
      patch.verificationStatus = "needs_verification";
    }
  }

  if (typeof body.verificationStatus === "string" && patch.correctAnswer === undefined) {
    patch.verificationStatus =
      body.verificationStatus === "verified" && existing.correctAnswer
        ? "verified"
        : "needs_verification";
  }

  const newText = (patch.text as string) ?? existing.text;
  patch.contentHash = crypto
    .createHash("sha256")
    .update(fingerprintOf(newText, options))
    .digest("hex")
    .slice(0, 32);

  const [row] = await db.update(questions).set(patch).where(eq(questions.id, id)).returning();
  return Response.json({ question: row });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [row] = await db.delete(questions).where(eq(questions.id, id)).returning();
  if (!row) return Response.json({ error: "Question not found." }, { status: 404 });
  return Response.json({ deleted: true, id });
}
