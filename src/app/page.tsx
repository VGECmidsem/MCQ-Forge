"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  CircleAlert,
  Database,
  FileText,
  FileUp,
  History,
  Loader2,
  Sparkles,
  Target,
  Timer,
} from "lucide-react";

interface Stats {
  totalQuestions: number;
  verified: number;
  needsVerification: number;
  sources: number;
  tests: number;
  submittedAttempts: number;
  avgPercentage: number | null;
  topicDist: { topic: string; count: number }[];
  recentSources: {
    id: string;
    filename: string;
    status: string;
    questionsFound: number;
    kind: string;
    createdAt: string;
  }[];
  recentAttempts: {
    id: string;
    testId: string;
    status: string;
    createdAt: string;
    name: string;
    percentage: number | null;
  }[];
  ai: { configured: boolean; provider: string | null; model: string | null };
}

export default function HomePage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMsg, setDemoMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setStats(await res.json());
    } catch {
      setErr("Could not load dashboard data. Is the database running?");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const seedDemo = async () => {
    setDemoBusy(true);
    setDemoMsg(null);
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      const data = await res.json();
      setDemoMsg(
        data.already
          ? "The demo bank is already loaded."
          : `Loaded ${data.inserted} demo questions — try generating a test!`,
      );
      load();
    } catch {
      setDemoMsg("Failed to load the demo bank.");
    } finally {
      setDemoBusy(false);
    }
  };

  const cards = [
    { label: "Questions in bank", value: stats?.totalQuestions, icon: Database, tint: "text-indigo-500 bg-indigo-500/10" },
    { label: "Verified answers", value: stats?.verified, icon: BadgeCheck, tint: "text-emerald-500 bg-emerald-500/10" },
    { label: "Needs verification", value: stats?.needsVerification, icon: CircleAlert, tint: "text-amber-500 bg-amber-500/10" },
    { label: "PDFs processed", value: stats?.sources, icon: FileText, tint: "text-violet-500 bg-violet-500/10" },
    { label: "Attempts submitted", value: stats?.submittedAttempts, icon: History, tint: "text-sky-500 bg-sky-500/10" },
    { label: "Average score", value: stats?.avgPercentage != null ? `${stats.avgPercentage}%` : "—", icon: Target, tint: "text-rose-500 bg-rose-500/10" },
  ];

  const maxTopic = Math.max(1, ...(stats?.topicDist.map((t) => t.count) ?? [1]));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="card relative overflow-hidden p-6 sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 right-40 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative max-w-2xl">
          <span className="badge badge-indigo mb-4">
            <Sparkles size={12} /> PDF → Question Bank → Mock Tests
          </span>
          <h1 className="font-display text-3xl leading-tight tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">
            Turn any MCQ PDF into an{" "}
            <span className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">
              interactive mock test
            </span>
          </h1>
          <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-[var(--muted)]">
            Upload question papers or study PDFs. MCQForge extracts every question and its four
            options, reads the answer key (or solves questions with AI), lets you verify the
            results, and generates timed, exam-style mock tests with full score analysis.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href="/upload" className="btn-primary btn">
              <FileUp size={16} /> Upload PDFs
            </Link>
            <Link href="/test/new" className="btn-outline btn">
              <Timer size={16} /> Create a mock test
            </Link>
            <button className="btn-ghost btn" onClick={seedDemo} disabled={demoBusy}>
              {demoBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              Load demo question bank
            </button>
          </div>
          {demoMsg && <p className="mt-3 text-sm text-emerald-500">{demoMsg}</p>}
          {stats && !stats.ai.configured && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <Bot size={13} /> AI answer generation is optional: set{" "}
              <code className="mono text-[0.72rem]">GEMINI_API_KEY</code> or{" "}
              <code className="mono text-[0.72rem]">OPENAI_API_KEY</code> to enable it. Answer keys
              and marked answers always work without AI.
            </p>
          )}
        </div>
      </section>

      {err && <div className="card border-rose-500/40 p-4 text-sm text-rose-500">{err}</div>}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <span className={`mb-2.5 grid h-8 w-8 place-items-center rounded-lg ${c.tint}`}>
              <c.icon size={16} />
            </span>
            <div className="font-display text-xl">
              {c.value === undefined ? "…" : c.value}
            </div>
            <div className="mt-0.5 text-xs font-medium text-[var(--muted)]">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent sources */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-base">Recent imports</h2>
            <Link href="/upload" className="text-xs font-semibold text-[var(--accent)] hover:underline">
              Upload more
            </Link>
          </div>
          {!stats?.recentSources.length ? (
            <p className="py-6 text-center text-sm text-[var(--muted)]">
              No PDFs processed yet — upload your first question paper.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {stats.recentSources.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <FileText size={16} className="flex-none text-[var(--muted)]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.filename}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {new Date(s.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`badge ${
                      s.kind === "answer_key"
                        ? "badge-indigo"
                        : s.status === "failed"
                          ? "badge-rose"
                          : s.questionsFound > 0
                            ? "badge-green"
                            : "badge-amber"
                    }`}
                  >
                    {s.kind === "answer_key" ? "Answer key" : `${s.questionsFound} questions`}
                  </span>
                  {s.kind !== "answer_key" && (
                    <Link
                      href={`/review?source=${s.id}`}
                      className="btn-ghost btn btn-sm !px-2 text-xs"
                    >
                      Review <ArrowRight size={13} />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Topics + recent attempts */}
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="mb-3 font-display text-base">Topics in your bank</h2>
            {!stats?.topicDist.length ? (
              <p className="py-4 text-center text-sm text-[var(--muted)]">No topics yet.</p>
            ) : (
              <div className="space-y-2.5">
                {stats.topicDist.map((t) => (
                  <div key={t.topic}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-semibold">{t.topic}</span>
                      <span className="text-[var(--muted)]">{t.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                        style={{ width: `${Math.round((t.count / maxTopic) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-base">Recent tests</h2>
              <Link href="/tests" className="text-xs font-semibold text-[var(--accent)] hover:underline">
                View all
              </Link>
            </div>
            {!stats?.recentAttempts.length ? (
              <p className="py-4 text-center text-sm text-[var(--muted)]">
                No attempts yet — generate a mock test when your bank is ready.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {stats.recentAttempts.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{a.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {new Date(a.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {a.status === "submitted" ? (
                      <Link href={`/results/${a.id}`} className="badge badge-green">
                        {a.percentage}% · Results
                      </Link>
                    ) : (
                      <Link href={`/attempt/${a.id}`} className="badge badge-amber">
                        In progress · Resume
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
