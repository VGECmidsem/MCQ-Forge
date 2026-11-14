"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  MinusCircle,
  RotateCcw,
  Shuffle,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Badge, Spinner } from "@/components/ui";
import { formatDuration } from "@/lib/utils";

interface ReviewItem {
  qid: string;
  number: number | null;
  text: string;
  topic: string | null;
  sourceLabel: string;
  pageNumber: number | null;
  options: Record<string, string>;
  userLetter: string | null;
  correctLetter: string | null;
  isCorrect: boolean | null;
  explanation: string | null;
  marked: boolean;
  flagged: boolean;
}

interface Result {
  total: number;
  gradable: number;
  attempted: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  ungraded: number;
  marksObtained: number;
  maxMarks: number;
  percentage: number;
  accuracy: number;
  positiveMarks: number;
  negativeMarks: number;
  marksPerQuestion: number;
  negativePerWrong: number;
  timeTakenSeconds: number;
  perTopic: { topic: string; total: number; attempted: number; correct: number }[];
  review: ReviewItem[];
}

function pctTone(p: number) {
  if (p >= 75) return "#059669";
  if (p >= 50) return "#4f46e5";
  if (p >= 33) return "#d97706";
  return "#e11d48";
}

export default function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<{ testId: string; testName: string; submittedAt: string; result: Result } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "wrong" | "marked" | "correct">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/results/${id}`, { cache: "no-store" });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Result unavailable");
        setData(d);
      } catch (e: any) {
        setError(e?.message || "Result unavailable");
      }
    })();
  }, [id]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const r = data.result.review;
    if (filter === "wrong") return r.filter((x) => x.isCorrect === false && x.userLetter);
    if (filter === "marked") return r.filter((x) => x.marked);
    if (filter === "correct") return r.filter((x) => x.isCorrect === true);
    return r;
  }, [data, filter]);

  if (error) {
    return (
      <div className="card mx-auto mt-12 max-w-lg p-10 text-center text-sm text-rose-500">{error}</div>
    );
  }
  if (!data) {
    return (
      <div className="card mt-12 flex justify-center py-24">
        <Spinner size={20} label="Loading your report…" />
      </div>
    );
  }
  const r = data.result;
  const tone = pctTone(r.percentage);
  const donutDeg = Math.max(0, Math.min(100, r.percentage)) * 3.6;

  const retake = async () => {
    const res = await fetch(`/api/tests/${data.testId}`, { method: "POST" });
    const d = await res.json();
    if (res.ok) router.push(`/attempt/${d.attemptId}`);
  };

  const stats = [
    { label: "Attempted", value: r.attempted, icon: CheckCircle2, tint: "text-indigo-500" },
    { label: "Correct", value: r.correct, icon: CheckCircle2, tint: "text-emerald-500" },
    { label: "Incorrect", value: r.incorrect, icon: XCircle, tint: "text-rose-500" },
    { label: "Unanswered", value: r.unanswered, icon: MinusCircle, tint: "text-[var(--muted)]" },
    { label: "Accuracy", value: `${r.accuracy}%`, icon: Target, tint: "text-violet-500" },
    { label: "Time taken", value: formatDuration(r.timeTakenSeconds), icon: Clock3, tint: "text-sky-500" },
  ];

  return (
    <div className="space-y-5">
      {/* Score hero */}
      <div className="card relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="flex flex-wrap items-center gap-8">
          <div
            className="grid h-36 w-36 flex-none place-items-center rounded-full"
            style={{ background: `conic-gradient(${tone} ${donutDeg}deg, var(--surface-2) 0deg)` }}
          >
            <div className="grid h-[7.2rem] w-[7.2rem] place-items-center rounded-full bg-[var(--surface)]">
              <div className="text-center">
                <div className="font-display text-3xl" style={{ color: tone }}>
                  {r.percentage}%
                </div>
                <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  score
                </div>
              </div>
            </div>
          </div>
          <div className="min-w-60 flex-1">
            <h1 className="font-display text-2xl tracking-tight">{data.testName}</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Submitted {data.submittedAt ? new Date(data.submittedAt).toLocaleString() : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Badge tone="green">Marks: {r.marksObtained} / {r.maxMarks}</Badge>
              {r.negativeMarks > 0 && <Badge tone="rose">Negative: −{r.negativeMarks}</Badge>}
              {r.ungraded > 0 && (
                <Badge tone="amber">
                  <CircleAlert size={11} /> {r.ungraded} ungraded (unverified)
                </Badge>
              )}
              <Badge tone="neutral">
                {r.marksPerQuestion} mark/question{r.negativePerWrong > 0 ? ` · −${r.negativePerWrong} wrong` : ""}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary btn btn-sm" onClick={retake}>
                <RotateCcw size={14} /> Retake this test
              </button>
              <Link href="/test/new" className="btn-outline btn btn-sm">
                <Shuffle size={14} /> New random test
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <s.icon size={17} className={s.tint} />
            <div className="mt-2 font-display text-lg">{s.value}</div>
            <div className="text-xs text-[var(--muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Topic analytics */}
      {r.perTopic.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-4 flex items-center gap-2 font-display text-base">
            <TrendingUp size={16} className="text-[var(--accent)]" /> Topic-wise performance
          </h2>
          <div className="space-y-3">
            {r.perTopic.map((t) => {
              const acc = t.attempted ? Math.round((t.correct / t.attempted) * 100) : 0;
              return (
                <div key={t.topic}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-semibold">{t.topic}</span>
                    <span className="text-[var(--muted)]">
                      {t.correct}/{t.total} correct · {t.attempted} attempted · {acc}%
                    </span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div className="bg-emerald-500" style={{ width: `${(t.correct / Math.max(1, t.total)) * 100}%` }} />
                    <div
                      className="bg-rose-400"
                      style={{ width: `${((t.attempted - t.correct) / Math.max(1, t.total)) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Review */}
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base">Question-by-question review</h2>
          <div className="flex gap-1.5">
            {(
              [
                ["all", `All (${r.review.length})`],
                ["wrong", `Incorrect (${r.incorrect})`],
                ["correct", `Correct (${r.correct})`],
                ["marked", `Marked`],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                className={`btn btn-sm ${filter === v ? "btn-primary" : "btn-outline"}`}
                onClick={() => setFilter(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {filtered.map((item) => {
            const open = expanded.has(item.qid);
            const state =
              item.isCorrect === null ? "neutral" : item.isCorrect ? "correct" : item.userLetter ? "wrong" : "skipped";
            return (
              <div key={item.qid} className="rounded-xl border border-[var(--border)] p-4">
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-lg ${
                      state === "correct"
                        ? "bg-emerald-500/15 text-emerald-500"
                        : state === "wrong"
                          ? "bg-rose-500/15 text-rose-500"
                          : "bg-[var(--surface-2)] text-[var(--muted)]"
                    }`}
                  >
                    {state === "correct" ? <CheckCircle2 size={14} /> : state === "wrong" ? <XCircle size={14} /> : <MinusCircle size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[0.7rem]">
                      <span className="mono badge badge-neutral">Q{item.number ?? "—"}</span>
                      {item.topic && <span className="badge badge-neutral">{item.topic}</span>}
                      {item.marked && (
                        <span className="badge badge-amber">
                          <Bookmark size={10} /> Marked
                        </span>
                      )}
                      {item.flagged && <span className="badge badge-amber">Unverified answer</span>}
                      <span className="ml-auto text-[var(--muted)]">
                        {item.sourceLabel}{item.pageNumber ? ` · p.${item.pageNumber}` : ""}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-[0.92rem] font-medium leading-relaxed">{item.text}</p>
                    <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
                      {Object.entries(item.options).map(([l, text]) => {
                        const isCorrectL = item.correctLetter === l;
                        const isUserL = item.userLetter === l;
                        return (
                          <div
                            key={l}
                            className={`opt !cursor-default !p-2.5 ${
                              isCorrectL ? "correct" : isUserL && item.isCorrect === false ? "wrong" : ""
                            }`}
                          >
                            <span className="opt-letter !h-6 !w-6 !text-[0.68rem]">{l}</span>
                            <span className="text-[0.83rem] leading-snug">{text}</span>
                            {isCorrectL && <CheckCircle2 size={14} className="ml-auto flex-none text-emerald-500" />}
                            {isUserL && !isCorrectL && <XCircle size={14} className="ml-auto flex-none text-rose-500" />}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                      <span className="text-[var(--muted)]">
                        Your answer:{" "}
                        <strong className={state === "correct" ? "text-emerald-500" : state === "wrong" ? "text-rose-500" : ""}>
                          {item.userLetter ?? "—"}
                        </strong>
                      </span>
                      <span className="text-[var(--muted)]">
                        Correct answer: <strong className="text-emerald-500">{item.correctLetter ?? "not verified"}</strong>
                      </span>
                      {item.explanation && (
                        <button
                          className="ml-auto flex items-center gap-1 font-semibold text-[var(--accent)]"
                          onClick={() =>
                            setExpanded((s) => {
                              const n = new Set(s);
                              if (n.has(item.qid)) n.delete(item.qid);
                              else n.add(item.qid);
                              return n;
                            })
                          }
                        >
                          Explanation <ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
                        </button>
                      )}
                    </div>
                    {open && item.explanation && (
                      <p className="fade-up mt-2 rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-xs leading-relaxed text-[var(--muted)]">
                        {item.explanation}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--muted)]">Nothing to show for this filter.</p>
          )}
        </div>
      </div>
    </div>
  );
}
