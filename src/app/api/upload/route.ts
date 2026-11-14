import { createJob, updateJob } from "@/lib/job-store";
import { processPdfUpload, validateUpload, type ProgressEvent } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const check = validateUpload(form.get("file"));
  if (check.error || !check.file) {
    return Response.json({ error: check.error ?? "No PDF file was uploaded." }, { status: 400 });
  }
  const file = check.file;
  const kind =
    String(form.get("kind") || "questions") === "answer_key" ? "answer_key" : "questions";
  const targetSourceId = form.get("targetSourceId")
    ? String(form.get("targetSourceId"))
    : null;
  const filename = (file.name || "document.pdf").slice(0, 200);

  // Read the file into a buffer *before* starting the background task so the
  // request body stream is fully consumed (required by Next.js / Node.js http).
  const buffer = Buffer.from(await file.arrayBuffer());

  // Create the job record immediately — the client can start polling right away.
  const jobId = crypto.randomUUID();
  createJob(jobId);

  // Fire-and-forget background processing. We use setImmediate so the HTTP
  // response is sent before the heavy work starts.
  setImmediate(async () => {
    updateJob(jobId, {
      status: "processing",
      phase: "upload",
      percent: 4,
      message: "File received — opening PDF…",
    });

    const emit = (e: ProgressEvent) => {
      updateJob(jobId, {
        phase: e.phase,
        percent: e.percent,
        message: e.message,
        page: e.page,
        pageCount: e.pageCount,
      });
    };

    try {
      const result = await processPdfUpload(
        {
          buffer,
          filename,
          size: buffer.length,
          kind: kind as "questions" | "answer_key",
          targetSourceId,
        },
        emit,
      );
      updateJob(jobId, {
        status: "done",
        phase: "done",
        percent: 100,
        message: "Extraction complete.",
        result,
      });
    } catch (e: any) {
      updateJob(jobId, {
        status: "error",
        phase: "done",
        percent: 100,
        message: e?.message || "Processing failed.",
        error: e?.message || "Processing failed.",
      });
    }
  });

  // Return the job ID immediately — client polls /api/jobs/:id for progress.
  return Response.json({ jobId }, { status: 202 });
}
