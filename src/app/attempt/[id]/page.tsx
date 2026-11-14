"use client";

import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkCheck,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CloudCheck,
  Flag,
  ListChecks,
  Loader2,
  PanelRightOpen,
  RotateCcw,
  Timer,
} from "lucide-react";
import { ConfirmDialog, Spinner } from "@/components/ui";
import { formatClock } from "@/lib/utils";

interface RunQuestion {
  qid: string;
  number: number | null;
  text: string;
  topic: string | null;
  sourceLabel: string;
  pageNumber: number | null;
  options: Record<string, string>;
  letters: string[];
  flagged: boolean;
}

export default function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("Mock Test");
  const [questions, setQuestions] = useState<RunQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [idx, setIdx] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "idle">("idle");
  const startedRef = useRef(Date.now());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittingRef = useRef(false);

  const answersRef = useRef(answers);
  const markedRef = useRef(marked);
  const idxRef = useRef(idx);
  const secondsRef = useRef(secondsLeft);
  answersRef.current = answers;
  markedRef.current = marked;
  idxRef.current = idx;
  secondsRef.current = secondsLeft;

  const submit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/attempts/${id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: answersRef.current,
          marked: [...markedRef.current],
          remainingSeconds: secondsRef.current,
          timeTakenSeconds: Math.round((Date.now() - startedRef.current) / 1000),
        }),
      });
      if (!res.ok) throw new Error();
      router.push(`/results/${id}`);
    } catch {
      setSubmitting(false);
      submittingRef.current = false;
      alert("Submission failed. Check your connection and try again.");
    }
  }, [id, router]);

  // Load attempt
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/attempts/${id}`, { cache: "no-store" });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Could not load the attempt");
        if (d.attempt.status === "submitted") {
          router.replace(`/results/${id}`);
          return;
        }
        setName(d.test.name);
        setQuestions(d.questions);
        setAnswers(d.attempt.answers ?? {});
        setMarked(new Set(d.attempt.marked ?? []));
        setIdx(Math.min(d.attempt.currentIndex ?? 0, d.questions.length - 1));
        if (d.attempt.durationSeconds) {
          setDurationSeconds(d.attempt.durationSeconds);
          setSecondsLeft(d.attempt.remainingSeconds ?? d.attempt.durationSeconds);
        }
        startedRef.current = Date.now();
      } catch (e: any) {
        setError(e?.message || "Could not load the attempt");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, router]);

  // Persist (debounced)
  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      try {
        await fetch(`/api/attempts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: answersRef.current,
            marked: [...markedRef.current],
            currentIndex: idxRef.current,
            remainingSeconds: secondsRef.current ?? undefined,
          }),
        });
        setSaveState("saved");
      } catch {
        setSaveState("idle");
      }
    }, 700);
  }, [id]);

  // Countdown
  useEffect(() => {
    if (durationSeconds === null) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s === null) return s;
        if (s <= 1) {
          clearInterval(t);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [durationSeconds]);

  useEffect(() => {
    if (secondsLeft === 0) submit();
  }, [secondsLeft, submit]);

  // Periodic hard-save of remaining time
  useEffect(() => {
    const t = setInterval(() => persist(), 15000);
    return () => clearInterval(t);
  }, [persist]);

  // Warn before unload
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const q = questions[idxRef.current];
      if (!q) return;
      if (e.key === "ArrowRight") setIdx((i) => Math.min(questions.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      else {
        const num = ["1", "2", "3", "4", "5", "6"].indexOf(e.key);
        const letter = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5 }[e.key.toLowerCase()];
        const pick = num >= 0 ? num : letter !== undefined ? letter : -1;
        if (pick >= 0 && pick < q.letters.length) {
          setAnswers((a) => ({ ...a, [q.qid]: q.letters[pick] }));
          persist();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [questions, persist]);

  const q = questions[idx];
  const answeredCount = useMemo(
    () => questions.filter((x) => answers[x.qid]).length,
    [questions, answers],
  );
  const markedCount = marked.size;

  if (loading) {
    return (
      <div className="card mt-10 flex justify-center py-24">
        <Spinner size={20} label="Preparing your test…" />
      </div>
    );
  }
  if (error || !q) {
    return (
      <div className="card mt-10 p-10 text-center">
        <p className="text-rose-500">{error || "This test has no questions."}</p>
      </div>
    );
  }

  const goTo = (i: number) => {
    setIdx(Math.max(0, Math.min(questions.length - 1, i)));
    persist();
  };

  const palette = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-center">
          <div className="font-display text-lg text-emerald-500">{answeredCount}</div>
          <div className="text-[var(--muted)]">Answered</div>
        </div>
        <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-center">
          <div className="font-display text-lg text-[var(--muted)]">{questions.length - answeredCount}</div>
          <div className="text-[var(--muted)]">Remaining</div>
        </div>
      </div>
      <div className="grid max-h-[46vh] grid-cols-[repeat(auto-fill,2.4rem)] gap-1.5 overflow-y-auto pr-1">
        {questions.map((x, i) => (
          <button
            key={x.qid}
            className={`pal ${answers[x.qid] ? "answered" : ""} ${marked.has(x.qid) ? "marked" : ""} ${i === idx ? "current" : ""}`}
            onClick={() => {
              goTo(i);
              setPaletteOpen(false);
            }}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-[var(--muted)]">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/70" /> Answered</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-[var(--border)] bg-[var(--surface)]" /> Unanswered</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500/70" /> Marked</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-500/70" /> Both</span>
      </div>
      <button className="btn-primary btn w-full !py-2.5" onClick={() => setConfirmSubmit(true)}>
        <Flag size={15} /> Submit test
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[1rem]">{name}</h1>
          <p className="text-xs text-[var(--muted)]">
            Question {idx + 1} of {questions.length}
            {markedCount > 0 && ` · ${markedCount} marked for review`}
          </p>
        </div>
        <span className="badge badge-neutral">
          <CloudCheck size={12} className={saveState === "saving" ? "animate-pulse" : ""} />
          {saveState === "saving" ? "Saving…" : "Autosaved"}
        </span>
        {secondsLeft !== null && (
          <span
            className={`badge mono !px-3 !py-1.5 !text-sm ${
              secondsLeft < 300 ? "badge-rose pulse-soft" : "badge-indigo"
            }`}
          >
            <Timer size={14} /> {formatClock(secondsLeft)}
          </span>
        )}
        <button className="btn-outline btn btn-sm lg:hidden" onClick={() => setPaletteOpen((o) => !o)}>
          <PanelRightOpen size={15} /> Palette
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Question */}
        <div className="card fade-up p-5 sm:p-7" key={q.qid}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-indigo mono">Q{idx + 1}{q.number ? ` · #${q.number}` : ""}</span>
            {q.topic && <span className="badge badge-neutral">{q.topic}</span>}
            {q.flagged && (
              <span className="badge badge-amber" title="Answer not verified — excluded from grading if unresolved">
                Unverified — practice only
              </span>
            )}
            <span className="ml-auto text-[0.7rem] text-[var(--muted)]">
              {q.sourceLabel}{q.pageNumber ? ` · p.${q.pageNumber}` : ""}
            </span>
          </div>
          <p className="mt-4 whitespace-pre-wrap text-[1.05rem] font-medium leading-relaxed">{q.text}</p>

          <div className="mt-5 space-y-2.5">
            {q.letters.map((l, i) => (
              <button
                key={l}
                className={`opt ${answers[q.qid] === l ? "selected" : ""}`}
                onClick={() => {
                  setAnswers((a) => ({ ...a, [q.qid]: l }));
                  persist();
                }}
              >
                <span className="opt-letter">{l}</span>
                <span className="text-[0.93rem] leading-snug">{q.options[l]}</span>
                <kbd className="ml-auto hidden rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[0.65rem] text-[var(--muted)] sm:block">
                  {i + 1}
                </kbd>
              </button>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button className="btn-outline btn btn-sm" disabled={idx === 0} onClick={() => goTo(idx - 1)}>
              <ChevronLeft size={15} /> Previous
            </button>
            <button
              className="btn-outline btn btn-sm"
              onClick={() => {
                if (answers[q.qid]) {
                  setAnswers((a) => {
                    const n = { ...a };
                    delete n[q.qid];
                    return n;
                  });
                  persist();
                }
              }}
            >
              <RotateCcw size={14} /> Clear
            </button>
            <button
              className={`btn btn-sm ${marked.has(q.qid) ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30" : "btn-outline"}`}
              onClick={() => {
                setMarked((m) => {
                  const n = new Set(m);
                  if (n.has(q.qid)) n.delete(q.qid);
                  else n.add(q.qid);
                  return n;
                });
                persist();
              }}
            >
              {marked.has(q.qid) ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
              {marked.has(q.qid) ? "Marked" : "Mark for review"}
            </button>
            <button
              className="btn-primary btn btn-sm ml-auto"
              onClick={() => (idx === questions.length - 1 ? setConfirmSubmit(true) : goTo(idx + 1))}
            >
              {idx === questions.length - 1 ? (
                <>
                  Finish <Flag size={14} />
                </>
              ) : (
                <>
                  Next <ChevronRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Palette */}
        <aside className="card hidden h-fit p-4 lg:sticky lg:top-20 lg:block">{palette}</aside>
      </div>

      {/* Mobile palette drawer */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm lg:hidden" onClick={() => setPaletteOpen(false)}>
          <div
            className="card fade-up absolute bottom-0 left-0 right-0 max-h-[75vh] overflow-y-auto rounded-b-none p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <ListChecks size={16} className="text-[var(--accent)]" />
              <h3 className="font-display text-sm">Question palette</h3>
            </div>
            {palette}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmSubmit}
        title="Submit the test?"
        message={
          <>
            You have answered <strong>{answeredCount}</strong> of <strong>{questions.length}</strong> questions
            {questions.length - answeredCount > 0 && (
              <> — <strong>{questions.length - answeredCount}</strong> unanswered</>
            )}
            {markedCount > 0 && (
              <>
                {" "}and marked <strong>{markedCount}</strong> for review
              </>
            )}
            . Once submitted, answers cannot be changed and scoring begins immediately.
          </>
        }
        confirmLabel={submitting ? "Submitting…" : "Submit now"}
        busy={submitting}
        onConfirm={submit}
        onCancel={() => setConfirmSubmit(false)}
      />
      {submitting && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 backdrop-blur-sm">
          <div className="card flex items-center gap-3 px-6 py-4">
            <Loader2 size={18} className="animate-spin text-indigo-500" />
            <span className="text-sm font-semibold">Scoring your test…</span>
          </div>
        </div>
      )}
    </div>
  );
}
