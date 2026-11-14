"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, History, PlayCircle, Timer, Trash2 } from "lucide-react";
import { ConfirmDialog, Empty, PageHeader, Spinner } from "@/components/ui";

interface AttemptRow {
  id: string;
  testId: string;
  name: string;
  status: string;
  total: number;
  createdAt: string;
  submittedAt: string | null;
  percentage: number | null;
  marksObtained: number | null;
  maxMarks: number | null;
}

export default function TestsPage() {
  const [rows, setRows] = useState<AttemptRow[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetch("/api/tests", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRows(d.attempts ?? []))
      .catch(() => setRows([]));
  };
  useEffect(load, []);

  const removeTest = async (testId: string) => {
    setBusy(true);
    try {
      await fetch(`/api/tests/${testId}`, { method: "DELETE" });
      setConfirmId(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="My tests"
        subtitle="Resume in-progress attempts or review submitted results."
        actions={
          <Link href="/test/new" className="btn-primary btn btn-sm">
            <PlayCircle size={15} /> New test
          </Link>
        }
      />
      {rows === null ? (
        <div className="card flex justify-center py-20">
          <Spinner label="Loading…" />
        </div>
      ) : rows.length === 0 ? (
        <Empty
          icon={<History size={22} />}
          title="No tests yet"
          hint="Generate a mock test from your question bank to see attempts here."
          action={
            <Link href="/test/new" className="btn-primary btn btn-sm">
              Create a test
            </Link>
          }
        />
      ) : (
        <div className="card divide-y divide-[var(--border)]">
          {rows.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <span
                className={`grid h-10 w-10 flex-none place-items-center rounded-xl ${
                  a.status === "submitted" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
                }`}
              >
                <Timer size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{a.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {a.total} questions · {new Date(a.createdAt).toLocaleString()}
                </p>
              </div>
              {a.status === "submitted" ? (
                <>
                  <span className="badge badge-green">
                    {a.percentage}% · {a.marksObtained}/{a.maxMarks} marks
                  </span>
                  <Link href={`/results/${a.id}`} className="btn-outline btn btn-sm">
                    Results <ArrowRight size={13} />
                  </Link>
                </>
              ) : (
                <>
                  <span className="badge badge-amber">In progress</span>
                  <Link href={`/attempt/${a.id}`} className="btn-primary btn btn-sm">
                    Resume <ArrowRight size={13} />
                  </Link>
                </>
              )}
              <button
                className="btn-ghost btn btn-sm !px-2 text-rose-500"
                title="Delete this test and its attempts"
                onClick={() => setConfirmId(a.testId)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirmId !== null}
        title="Delete this test?"
        message="The test snapshot and all of its attempts (including results) will be permanently deleted."
        confirmLabel="Delete test"
        danger
        busy={busy}
        onConfirm={() => confirmId && removeTest(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
