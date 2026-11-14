"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Play, ShieldAlert, Shuffle, Timer } from "lucide-react";
import { PageHeader, Toggle } from "@/components/ui";

function NewTestInner() {
  const router = useRouter();
  const params = useSearchParams();
  const pickSelected = params.get("pick") === "selected";

  const [sources, setSources] = useState<{ id: string; filename: string }[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [scopeType, setScopeType] = useState<string>(pickSelected ? "ids" : "all");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [topicSel, setTopicSel] = useState<string[]>([]);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [count, setCount] = useState<string>("");
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [duration, setDuration] = useState<string>("0");
  const [marks, setMarks] = useState<string>("1");
  const [negative, setNegative] = useState<string>("0");
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [available, setAvailable] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/questions?pageSize=1")
      .then((r) => r.json())
      .then((d) => {
        setSources(d.sources ?? []);
        setTopics((d.topics ?? []).filter(Boolean));
      })
      .catch(() => {});
    if (pickSelected) {
      try {
        const ids = JSON.parse(localStorage.getItem("mcqforge.testIds") || "[]");
        setPickedIds(Array.isArray(ids) ? ids : []);
      } catch {
        setPickedIds([]);
      }
    }
  }, [pickSelected]);

  const refreshCount = useCallback(async () => {
    const status = includeUnverified ? undefined : "verified";
    const one = async (extra: Record<string, string>) => {
      const p = new URLSearchParams({ countOnly: "1", ...(status ? { status } : {}), ...extra });
      const r = await fetch(`/api/questions?${p.toString()}`);
      const d = await r.json();
      return Number(d.total ?? 0);
    };
    try {
      if (scopeType === "all") setAvailable(await one({}));
      else if (scopeType === "sources" && sourceIds.length) {
        const parts = await Promise.all(sourceIds.map((id) => one({ sourceId: id })));
        setAvailable(parts.reduce((a, b) => a + b, 0));
      } else if (scopeType === "topics" && topicSel.length) {
        const parts = await Promise.all(topicSel.map((t) => one({ topic: t })));
        setAvailable(parts.reduce((a, b) => a + b, 0));
      } else if (scopeType === "ids") {
        setAvailable(pickedIds.length);
      } else {
        setAvailable(0);
      }
    } catch {
      setAvailable(null);
    }
  }, [scopeType, sourceIds, topicSel, pickedIds, includeUnverified]);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  const effectiveCount = useMemo(() => {
    const n = parseInt(count, 10);
    if (!count || Number.isNaN(n) || n <= 0) return available ?? 0;
    return Math.min(n, available ?? n);
  }, [count, available]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const scope: any =
        scopeType === "sources"
          ? { type: "sources", sourceIds }
          : scopeType === "topics"
            ? { type: "topics", topics: topicSel }
            : scopeType === "ids"
              ? { type: "ids", ids: pickedIds }
              : { type: "all" };
      const res = await fetch("/api/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          scope,
          count: parseInt(count, 10) > 0 ? parseInt(count, 10) : "all",
          shuffleQuestions,
          shuffleOptions,
          durationMinutes: parseInt(duration, 10) || 0,
          marksPerQuestion: parseFloat(marks) || 1,
          negativeMarks: parseFloat(negative) || 0,
          includeUnverified,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not create the test");
      localStorage.removeItem("mcqforge.testIds");
      router.push(`/attempt/${d.attemptId}`);
    } catch (e: any) {
      setError(e?.message || "Could not create the test");
      setBusy(false);
    }
  };

  const scopeOptions = [
    { v: "all", label: "Entire bank" },
    { v: "sources", label: "By PDF source" },
    { v: "topics", label: "By topic" },
    ...(pickedIds.length ? [{ v: "ids", label: `Selected questions (${pickedIds.length})` }] : []),
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Configure mock test"
        subtitle="Build a timed, exam-style test from your verified questions. Snapshots freeze the paper so scoring is always consistent."
      />
      <div className="card space-y-6 p-5 sm:p-7">
        <div>
          <label className="label">Test name</label>
          <input
            className="input mt-1.5"
            placeholder={`e.g. Physics practice set — ${new Date().toLocaleDateString()}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Question pool</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {scopeOptions.map((o) => (
              <button
                key={o.v}
                className={`btn btn-sm ${scopeType === o.v ? "btn-primary" : "btn-outline"}`}
                onClick={() => setScopeType(o.v)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {scopeType === "sources" && (
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {sources.length === 0 && <p className="text-xs text-[var(--muted)]">No processed PDFs yet.</p>}
              {sources.map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-indigo-500"
                    checked={sourceIds.includes(s.id)}
                    onChange={(e) =>
                      setSourceIds((ids) => (e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id)))
                    }
                  />
                  <span className="truncate">{s.filename}</span>
                </label>
              ))}
            </div>
          )}
          {scopeType === "topics" && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {topics.length === 0 && <p className="text-xs text-[var(--muted)]">No topics assigned yet.</p>}
              {topics.map((t) => (
                <button
                  key={t}
                  className={`btn btn-sm ${topicSel.includes(t) ? "btn-primary" : "btn-outline"}`}
                  onClick={() =>
                    setTopicSel((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2.5 text-xs text-[var(--muted)]">
            {available === null ? (
              "Counting matching questions…"
            ) : (
              <>
                <strong className="text-[var(--ink)]">{available}</strong> question(s) available in this
                pool {includeUnverified ? "(including unverified)" : "(verified only)"}.
              </>
            )}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Number of questions</label>
            <input
              className="input mt-1.5"
              type="number"
              min={1}
              max={available ?? undefined}
              placeholder={`All (${available ?? 0})`}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
            <p className="mt-1 text-[0.7rem] text-[var(--muted)]">
              This test will include <strong>{effectiveCount}</strong> question(s).
            </p>
          </div>
          <div>
            <label className="label flex items-center gap-1">
              <Timer size={12} /> Duration (minutes, 0 = no limit)
            </label>
            <input className="input mt-1.5" type="number" min={0} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          <div>
            <label className="label">Marks per question</label>
            <input className="input mt-1.5" type="number" min={0.25} step={0.25} value={marks} onChange={(e) => setMarks(e.target.value)} />
          </div>
          <div>
            <label className="label">Negative marks per wrong answer</label>
            <input className="input mt-1.5" type="number" min={0} step={0.25} value={negative} onChange={(e) => setNegative(e.target.value)} />
          </div>
        </div>

        <div className="space-y-3.5 border-t border-[var(--border)] pt-5">
          <Toggle checked={shuffleQuestions} onChange={setShuffleQuestions} label="Shuffle question order" hint="Each attempt can present questions in random order." />
          <Toggle
            checked={shuffleOptions}
            onChange={setShuffleOptions}
            label="Shuffle options within each question"
            hint="A/B/C/D positions are randomised per question; scoring always maps back to the true answer."
          />
          <Toggle
            checked={includeUnverified}
            onChange={setIncludeUnverified}
            label="Include unverified questions"
            hint="Questions without a confirmed answer are excluded from grading (shown as practice) unless verified."
          />
        </div>

        {parseFloat(negative) > 0 && (
          <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <ShieldAlert size={14} /> Negative marking enabled: −{negative} for each wrong answer.
          </p>
        )}
        {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-500">{error}</p>}

        <button className="btn-primary btn w-full !py-3 text-base" onClick={start} disabled={busy || !available}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} />}
          Start test
          {shuffleQuestions || shuffleOptions ? <Shuffle size={15} className="opacity-70" /> : null}
        </button>
      </div>
    </div>
  );
}

export default function NewTestPage() {
  return (
    <Suspense>
      <NewTestInner />
    </Suspense>
  );
}
