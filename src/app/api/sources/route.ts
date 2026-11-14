import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { questions, sources } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select({ source: sources, questionCount: count(questions.id) })
    .from(sources)
    .leftJoin(questions, eq(questions.sourceId, sources.id))
    .groupBy(sources.id)
    .orderBy(desc(sources.createdAt))
    .limit(100);
  return Response.json({
    sources: rows.map((r) => ({ ...r.source, questionCount: r.questionCount })),
  });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "Missing source id." }, { status: 400 });
  const [row] = await db.delete(sources).where(eq(sources.id, id)).returning();
  if (!row) return Response.json({ error: "Source not found." }, { status: 404 });
  return Response.json({ deleted: true, id });
}
