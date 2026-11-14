"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  FileText,
  FileUp,
  Info,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/ui";

interface QueuedFile {
  id: string;
  file: File;
  kind: "questions" | "answer_key";
  targetSourceId?: string;
  status: "queued" | "processing" | "done" | "error";
  phase?: string;
  percent?: number;
  page?: number;
  pageCount?: number;
  message?: string;
  result?: any;
  error?: string;
}

const PHASE_LABEL: Record<string, string> = {
  upload: "Uploading",
  extract: "Extracting text",
  parse: "Parsing questions",
  dedupe: "Checking duplicates",
  save: "Saving to bank",
  done: "Finished",
};

const PHASE_ORDER = ["upload", "extract", "parse", "dedupe", "save"] as const;

const MAX_SIZE = 20 * 1024 * 1024;

/**
 * Upload strategy: POST file → server returns {jobId} immediately →
 * client polls /api/jobs/:id every second until done/error.
 *
 * Works through ANY proxy or mobile browser because:
 *  - Initial POST = plain JSON response (no streaming needed).
 *  - Each poll = small independent GET.
 *  - No dependency on chunked transfer, SSE, or streaming APIs.
 */
async function uploadWithPolling(
  f: QueuedFile,
  onEvent: (e: Partial<QueuedFile>) => void,
): Promise<any> {
  onEvent({ phase: "upload", percent: 1, message: "Preparing connection…" });

  const fd = new FormData();
  fd.append("file", f.file);
  fd.append("kind", f.kind);
  if (f.kind === "answer_key" && f.targetSourceId) {
    fd.append("targetSourceId", f.targetSourceId);
  }

  // Step 1: Upload via XHR. We use XHR here instead of fetch() for the initial
  // file transmission because some mobile webviews (like the iOS app wrapper)
  // handle XHR + FormData much more reliably than fetch() for file uploads,
  // and it additionally gives us native byte-level upload progress.
  const jobId = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    // Some proxies strip JSON response types if set explicitly before headers,
    // so we'll parse the text manually in onload.
    
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onEvent({
          phase: "upload",
          percent: Math.max(1, (e.loaded / e.total) * 4),
          message: `Sending to server… ${Math.round((e.loaded / e.total) * 100)}%`,
        });
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          if (data?.jobId) resolve(data.jobId);
          else reject(new Error(data?.error || "Server did not return a job ID."));
        } else {
          reject(new Error(data?.error || `Upload failed with status ${xhr.status}`));
        }
      } catch {
        reject(new Error("Invalid response from server."));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload (browser blocked the request)."));
    xhr.ontimeout = () => reject(new Error("Upload connection timed out."));
    xhr.send(fd);
  });

  onEvent({ phase: "upload", percent: 4, message: "File received — server is extracting…" });

  // Step 2 — poll until terminal state
  const MAX_POLLS = 10 * 60; // 10 min at 1 s each
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise<void>((r) => setTimeout(r, 1000));

    let job: any;
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      job = await res.json();
    } catch {
      // transient network issue — keep polling silently
      continue;
    }

    // Never let the bar move backwards
    onEvent({
      phase: job.phase ?? "extract",
      percent: job.percent ?? 4,
      message: job.message ?? "Processing…",
      page: job.page,
      pageCount: job.pageCount,
    });

    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error || "Processing failed.");
  }

  throw new Error("Timed out waiting for the server to finish processing.");
}

export default function UploadPage() {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sources, setSources] = useState<{ id: string; filename: string }[]>([]);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);

  const refreshSources = useCallback(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSources();
    fetch("/api/questions/ai")
      .then((r) => r.json())
      .then((d) => setAiConfigured(d.configured))
      .catch(() => setAiConfigured(false));
  }, [refreshSources]);

  const addFiles = (files: FileList | File[]) => {
    const next: QueuedFile[] = [];
    for (const f of [...files].slice(0, 10)) {
      if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") continue;
      if (f.size === 0 || f.size > MAX_SIZE) {
        next.push({
          id: crypto.randomUUID(),
          file: f,
          kind: "questions",
          status: "error",
          error: f.size === 0 ? "File is empty." : "Exceeds the 20 MB limit.",
        });
        continue;
      }
      next.push({ id: crypto.randomUUID(), file: f, kind: "questions", status: "queued" });
    }
    setQueue((q) => [...q, ...next]);
  };

  const process = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      for (;;) {
        // Pick next queued file
        let target: QueuedFile | undefined;
        setQueue((q) => {
          const idx = q.findIndex((f) => f.status === "queued");
          if (idx === -1) return q;
          target = q[idx];
          const copy = [...q];
          copy[idx] = {
            ...copy[idx],
            status: "processing",
            phase: "upload",
            percent: 0,
            message: "Waiting to send…",
          };
          return copy;
        });
        if (!target) break;

        const id = target.id;
        try {
          const result = await uploadWithPolling(target, (patch) => {
            setQueue((q) =>
              q.map((f) =>
                f.id === id
                  ? {
                      ...f,
                      phase: patch.phase ?? f.phase,
                      percent: Math.max(f.percent ?? 0, patch.percent ?? 0),
                      message: patch.message ?? f.message,
                      page: patch.page ?? f.page,
                      pageCount: patch.pageCount ?? f.pageCount,
                    }
                  : f,
              ),
            );
          });
          setQueue((q) =>
            q.map((f) =>
              f.id === id
                ? { ...f, status: "done", result, percent: 100, phase: "done", message: undefined }
                : f,
            ),
          );
          refreshSources();
        } catch (e: any) {
          setQueue((q) =>
            q.map((f) =>
              f.id === id
                ? { ...f, status: "error", error: e?.message || "Processing failed.", message: undefined }
                : f,
            ),
          );
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [refreshSources]);

  useEffect(() => {
    if (queue.some((f) => f.status === "queued")) process();
  }, [queue, process]);

  const overallPercent =
    queue.length === 0
      ? 0
      : Math.round(
          queue.reduce(
            (s, f) => s + (f.status === "done" || f.status === "error" ? 100 : f.percent ?? 0),
            0,
          ) / queue.length,
        );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Upload PDFs"
        subtitle="Files are parsed in memory on the server. Only extracted questions — never the original PDF — are stored in PostgreSQL."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Drop zone */}
          <div
            className={`card flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed px-6 py-12 text-center transition-all ${
              dragging ? "border-indigo-500 bg-indigo-500/5" : ""
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
          >
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
              <FileUp size={24} />
            </span>
            <div>
              <p className="font-display text-lg">Drop MCQ PDFs here, or click to browse</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Up to 10 files · 20 MB each · text-based and scanned PDFs (OCR runs automatically)
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {/* Queue */}
          {queue.length > 0 && (
            <div className="card divide-y divide-[var(--border)]">
              {/* Queue header + overall bar */}
              <div className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-sm">
                    Processing queue
                    <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                      {queue.filter((f) => f.status === "done").length}/{queue.length} complete
                    </span>
                  </h3>
                  <button
                    className="btn-ghost btn btn-sm"
                    onClick={() =>
                      setQueue((q) => q.filter((f) => f.status === "processing" || f.status === "queued"))
                    }
                  >
                    <Trash2 size={14} /> Clear finished
                  </button>
                </div>
                {queue.some((f) => f.status === "processing" || f.status === "queued") && (
                  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-[width] duration-500"
                      style={{ width: `${overallPercent}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Per-file rows */}
              {queue.map((f) => (
                <div key={f.id} className="px-5 py-4">
                  {/* File header row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText size={18} className="flex-none text-[var(--muted)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{f.file.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {(f.file.size / 1024).toFixed(0)} KB
                      </p>
                    </div>

                    {/* Kind selector */}
                    <select
                      className="select !w-auto !py-1.5 text-xs"
                      value={f.kind}
                      disabled={f.status !== "queued"}
                      onChange={(e) =>
                        setQueue((q) =>
                          q.map((x) =>
                            x.id === f.id ? { ...x, kind: e.target.value as QueuedFile["kind"] } : x,
                          ),
                        )
                      }
                    >
                      <option value="questions">Questions PDF</option>
                      <option value="answer_key">Answer key PDF</option>
                    </select>

                    {/* Target source (answer key only) */}
                    {f.kind === "answer_key" && (
                      <select
                        className="select !w-44 !py-1.5 text-xs"
                        value={f.targetSourceId ?? ""}
                        disabled={f.status !== "queued"}
                        onChange={(e) =>
                          setQueue((q) =>
                            q.map((x) =>
                              x.id === f.id
                                ? { ...x, targetSourceId: e.target.value || undefined }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="">Fill unresolved only</option>
                        {sources.map((s: any) => (
                          <option key={s.id} value={s.id}>
                            Apply to: {s.filename.slice(0, 28)}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Status badge */}
                    {f.status === "queued" && <span className="badge badge-neutral">Queued</span>}
                    {f.status === "processing" && (
                      <span className="badge badge-indigo">
                        <Loader2 size={11} className="animate-spin" /> Processing
                      </span>
                    )}
                    {f.status === "done" && (
                      <span className="badge badge-green">
                        <CheckCircle2 size={11} /> Done
                      </span>
                    )}
                    {f.status === "error" && (
                      <span className="badge badge-rose">
                        <XCircle size={11} /> Failed
                      </span>
                    )}
                  </div>

                  {/* Progress block */}
                  {f.status === "processing" && (
                    <div className="mt-3 space-y-2">
                      {/* Percent + current phase label */}
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 font-semibold text-[var(--accent)]">
                          {PHASE_LABEL[f.phase ?? "upload"] ?? "Working…"}
                          {f.pageCount ? (
                            <span className="font-normal text-[var(--muted)]">
                              · page {f.page ?? 0}/{f.pageCount}
                            </span>
                          ) : null}
                        </span>
                        <span className="mono font-semibold tabular-nums">
                          {Math.round(f.percent ?? 0)}%
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div
                        className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
                        role="progressbar"
                        aria-valuenow={Math.round(f.percent ?? 0)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-[width] duration-700 ease-out"
                          style={{ width: `${Math.max(3, f.percent ?? 0)}%` }}
                        />
                      </div>

                      {/* Human-readable status */}
                      <p className="text-xs leading-relaxed text-[var(--muted)]">
                        {f.message ?? "Working…"}
                      </p>

                      {/* Phase chips */}
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {PHASE_ORDER.map((ph) => {
                          const curIdx = PHASE_ORDER.indexOf(
                            (f.phase ?? "upload") as typeof PHASE_ORDER[number],
                          );
                          const myIdx = PHASE_ORDER.indexOf(ph);
                          const state =
                            myIdx < curIdx ? "done" : myIdx === curIdx ? "active" : "todo";
                          return (
                            <span
                              key={ph}
                              className={`badge !px-2 !py-0.5 !text-[0.62rem] transition-all ${
                                state === "done"
                                  ? "badge-green"
                                  : state === "active"
                                    ? "badge-indigo"
                                    : "badge-neutral opacity-40"
                              }`}
                            >
                              {state === "done" ? <CheckCircle2 size={9} /> : null}
                              {PHASE_LABEL[ph]}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {f.status === "error" && (
                    <p className="mt-2 text-xs text-rose-500">{f.error}</p>
                  )}

                  {/* Done summary */}
                  {f.status === "done" && f.result && (
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap gap-2 text-xs">
                        {f.result.timings && (
                          <span
                            className="badge badge-neutral mono"
                            title={[
                              `open ${f.result.timings.openMs}ms`,
                              `scan ${f.result.timings.pageScanMs}ms`,
                              `font ${f.result.timings.deepFontMs}ms`,
                              `OCR ${f.result.timings.ocrMs}ms`,
                              `parse ${f.result.timings.parseMs ?? "—"}ms`,
                              `save ${f.result.timings.saveMs ?? "—"}ms`,
                            ].join(" · ")}
                          >
                            {(f.result.timings.totalMs / 1000).toFixed(1)}s
                          </span>
                        )}
                        {"questionsFound" in f.result && (
                          <>
                            <span className="badge badge-neutral">
                              {f.result.questionsFound} questions
                            </span>
                            <span className="badge badge-green">
                              {f.result.answersResolved} answers resolved
                            </span>
                            {f.result.needsVerification > 0 && (
                              <span className="badge badge-amber">
                                {f.result.needsVerification} need verification
                              </span>
                            )}
                            <span
                              className={`badge ${
                                f.result.keyLocated ? "badge-indigo" : "badge-neutral"
                              }`}
                            >
                              <KeyRound size={11} />{" "}
                              {f.result.keyLocated
                                ? `Answer key (${f.result.keyMatched} matched)`
                                : "No answer key"}
                            </span>
                          </>
                        )}
                        {"keyAnswersApplied" in f.result && (
                          <span className="badge badge-green">
                            <KeyRound size={11} /> Key applied to{" "}
                            {f.result.keyAnswersApplied} questions
                          </span>
                        )}
                        <span className="badge badge-neutral">
                          {f.result.pageCount} pages
                        </span>
                      </div>

                      {!!f.result.warnings?.length && (
                        <ul className="space-y-1">
                          {f.result.warnings.slice(0, 4).map((w: string, i: number) => (
                            <li
                              key={i}
                              className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400"
                            >
                              <Info size={12} className="mt-0.5 flex-none" /> {w}
                            </li>
                          ))}
                        </ul>
                      )}

                      {"questionsFound" in f.result && (
                        <Link
                          href={`/review?source=${f.result.sourceId}`}
                          className="btn-primary btn btn-sm mt-1"
                        >
                          Review extracted questions <ArrowRight size={14} />
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="font-display flex items-center gap-2 text-sm">
              <ShieldCheck size={15} className="text-emerald-500" /> How answers are resolved
            </h3>
            <ol className="mt-3 space-y-2.5 text-xs leading-relaxed text-[var(--muted)]">
              <li>
                <strong className="text-[var(--ink)]">1 · Answer key in the PDF.</strong>{" "}
                End-of-document keys, tables and numbered lists are matched to questions by number
                or order.
              </li>
              <li>
                <strong className="text-[var(--ink)]">2 · Marked answers.</strong> Ticked (✓),
                bolded or inline-declared options are detected during parsing.
              </li>
              <li>
                <strong className="text-[var(--ink)]">3 · AI solving.</strong> Unresolved
                questions can be sent to an AI model from the review screen — never automatic
                guesses.
              </li>
              <li>
                <strong className="text-[var(--ink)]">4 · Needs verification.</strong>{" "}
                Anything uncertain is flagged instead of invented. Unverified questions are kept
                out of graded tests unless you allow them.
              </li>
            </ol>
          </div>

          <div className="card p-5">
            <h3 className="font-display flex items-center gap-2 text-sm">
              <Bot size={15} className="text-indigo-500" /> AI configuration
            </h3>
            {aiConfigured === null ? (
              <p className="mt-2 text-xs text-[var(--muted)]">Checking…</p>
            ) : aiConfigured ? (
              <p className="mt-2 text-xs text-emerald-500">
                An AI provider is configured and ready to solve unresolved questions.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-[var(--muted)]">
                <p>
                  No AI key detected. To enable AI answers, add one of these to your{" "}
                  <code className="mono">.env</code> and restart:
                </p>
                <p className="mono rounded-lg bg-[var(--surface-2)] p-2 text-[0.7rem]">
                  GEMINI_API_KEY=…{"\n"}# or{"\n"}OPENAI_API_KEY=…
                </p>
                <p>Keys stay on the server and are never sent to the browser.</p>
              </div>
            )}
          </div>

          <div className="card p-5">
            <h3 className="font-display text-sm">Answer key as a separate file</h3>
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              Upload the question paper first, then upload the key file with type{" "}
              <strong className="text-[var(--ink)]">&ldquo;Answer key PDF&rdquo;</strong>. In{" "}
              <strong className="text-[var(--ink)]">&ldquo;Fill unresolved only&rdquo;</strong> mode it never
              overwrites answers already found; pick a specific source to deliberately re-apply a
              key across that document.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
