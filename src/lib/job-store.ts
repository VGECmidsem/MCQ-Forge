// In-process job store for background PDF processing.
// Jobs live in memory (Map) for the lifetime of the Node.js process — that is
// sufficient because a job only needs to survive until the client polls the
// final result (seconds to a few minutes at most).  The result is also
// persisted to PostgreSQL via processPdfUpload, so nothing is truly lost on
// restart; the client just needs to reload.

export type JobStatus = "queued" | "processing" | "done" | "error";

export interface JobState {
  id: string;
  status: JobStatus;
  phase: string;
  percent: number;
  message: string;
  page?: number;
  pageCount?: number;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: number;
}

const store = new Map<string, JobState>();

// Automatically evict jobs older than 30 minutes to avoid unbounded growth.
const TTL_MS = 30 * 60 * 1000;
function evict() {
  const now = Date.now();
  for (const [id, job] of store) {
    if (now - job.createdAt > TTL_MS) store.delete(id);
  }
}

export function createJob(id: string): JobState {
  evict();
  const job: JobState = {
    id,
    status: "queued",
    phase: "upload",
    percent: 0,
    message: "Upload received — queued for processing…",
    createdAt: Date.now(),
  };
  store.set(id, job);
  return job;
}

export function updateJob(id: string, patch: Partial<JobState>) {
  const job = store.get(id);
  if (!job) return;
  Object.assign(job, patch);
}

export function getJob(id: string): JobState | undefined {
  return store.get(id);
}
