"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Bot,
  CircleAlert,
  Copy,
  Download,
  FileUp,
  Layers,
  Loader2,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Badge, ConfirmDialog, Empty, Modal, Spinner } from "@/components/ui";
import { ANSWER_SOURCE_LABEL, LETTERS } from "@/lib/utils";

export interface QuestionDTO {
  id: string;
  sourceId: string | null;
  sourceLabel: string;
  pageNumber: number | null;
  questionNumber: number | null;
  text: string;
  options: Record<string, string>;
  correctAnswer: string | null;
  answerSource: string;
  verificationStatus: string;
  topic: string | null;
  explanation: string | null;
  warnings: string[];
  createdAt: string;
}

interface DedupeGroup {
  keepId: string;
  keepPreview: string;
  kind: "exact" | "near";
  duplicateIds: string[];
  duplicatePreviews: string[];
}

const EMPTY_FORM = {
  text: "",
  options: { A: "", B: "", C: "", D: "" } as Record<string, string>,
  correctAnswer: "",
  explanation: "",
  topic: "",
};

export function QuestionManager({
  mode,
  fixedSourceId,
  sourceName,
}: {
  mode: "review" | "bank";
  fixedSourceId?: string;
  sourceName?: string;
}) {
  const [filters, setFilters] = useState({ q: "", status: "", topic: "all", sourceId: fixedSourceId ?? "", dup: false, warn: false });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<QuestionDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [topics, setTopics] = useState<string[]>([]);
  const [sources, setSources] = useState<{ id: string; filename: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = useState<QuestionDTO | "new" | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: string; ids?: string[] }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dedupe, setDedupe] = useState<null | { groups: DedupeGroup[]; duplicateCount: number }>(null);
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; provider: string | null } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const pageSize = 40;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.status) params.set("status", filters.status);
      if (filters.topic !== "all") params.set("topic", filters.topic);
      if (filters.sourceId) params.set("sourceId", filters.sourceId);
      if (filters.dup) params.set("dup", "1");
      if (filters.warn) params.set("warn", "1");
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/questions?${params.toString()}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to load questions");
      setData(d.items);
      setTotal(d.total);
      setTopics(d.topics ?? []);
      setSources(d.sources ?? []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetch("/api/questions/ai")
      .then((r) => r.json())
      .then(setAiStatus)
      .catch(() => setAiStatus({ configured: false, provider: null }));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allChecked = data.length > 0 && data.every((q) => selected.has(q.id));

  const toggleAll = () => {
    setSelected((s) => {
      const next = new Set(s);
      if (allChecked) data.forEach((q) => next.delete(q.id));
      else data.forEach((q) => next.add(q.id));
      return next;
    });
  };

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 5000);
  };

  const openEdit = (q: QuestionDTO) => {
    setEditTarget(q);
    setForm({
      text: q.text,
      options: { A: "", B: "", C: "", D: "", ...q.options },
      correctAnswer: q.correctAnswer ?? "",
      explanation: q.explanation ?? "",
      topic: q.topic ?? "",
    });
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const options: Record<string, string> = {};
      for (const [k, v] of Object.entries(form.options)) if (v.trim()) options[k] = v.trim();
      const payload = {
        text: form.text.trim(),
        options,
        correctAnswer: form.correctAnswer || null,
        explanation: form.explanation,
        topic: form.topic,
      };
      const res =
        editTarget === "new"
          ? await fetch("/api/questions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/questions/${(editTarget as QuestionDTO).id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed");
      setEditTarget(null);
      flash(editTarget === "new" ? "Question added." : "Question updated.");
      fetchData();
    } catch (e: any) {
      alert(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const bulk = async (action: string, value?: string) => {
    const ids = [...selected];
    setBusy(action);
    try {
      const res = await fetch("/api/questions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action, value }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Operation failed");
      setSelected(new Set());
      flash(`${d.deleted ?? d.updated ?? 0} question(s) ${action === "delete" ? "deleted" : "updated"}.`);
      fetchData();
    } catch (e: any) {
      alert(e?.message || "Operation failed");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const deleteOne = async (id: string) => {
    setBusy("delete-one");
    try {
      await fetch(`/api/questions/${id}`, { method: "DELETE" });
      setConfirm(null);
      flash("Question deleted.");
      fetchData();
    } finally {
      setBusy(null);
    }
  };

  const runDedupe = async (doDelete: boolean) => {
    setBusy("dedupe");
    try {
      const res = await fetch("/api/questions/dedupe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: doDelete ? "delete" : "scan", includeNear: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Dedupe failed");
      if (doDelete) {
        setDedupe(null);
        flash(`Removed ${d.deleted} exact duplicate(s). Near duplicates were kept for your review.`);
        fetchData();
      } else {
        setDedupe(d);
      }
    } catch (e: any) {
      alert(e?.message || "Dedupe failed");
    } finally {
      setBusy(null);
    }
  };

  const solveWithAi = async () => {
    const ids = [...selected].slice(0, 20);
    setBusy("ai");
    try {
      const res = await fetch("/api/questions/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "AI solving failed");
      flash(
        `AI solved ${d.appliedCount} of ${ids.length} question(s)${
          d.unknownCount ? ` — ${d.unknownCount} left as "needs verification"` : ""
        }.`,
      );
      setSelected(new Set());
      fetchData();
    } catch (e: any) {
      alert(e?.message || "AI solving failed — check your API key configuration.");
    } finally {
      setBusy(null);
    }
  };

  const exportBank = (format: string) => {
    const params = new URLSearchParams();
    params.set("format", format);
    if (selected.size) params.set("ids", [...selected].join(","));
    else {
      if (filters.q) params.set("q", filters.q);
      if (filters.status) params.set("status", filters.status);
      if (filters.topic !== "all") params.set("topic", filters.topic);
      if (filters.sourceId) params.set("sourceId", filters.sourceId);
    }
    window.open(`/api/bank?${params.toString()}`, "_blank");
  };

  const importBackup = async (file: File) => {
    setBusy("import");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch("/api/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Import failed");
      flash(`Imported ${d.imported} question(s), skipped ${d.skipped} duplicates/invalid.`);
      fetchData();
    } catch (e: any) {
      alert(e?.message || "Import failed — make sure it is a backup JSON produced by MCQForge.");
    } finally {
      setBusy(null);
    }
  };

  const startTestFromSelection = () => {
    localStorage.setItem("mcqforge.testIds", JSON.stringify([...selected]));
    window.location.href = "/test/new?pick=selected";
  };

  const selectedNeedsVerification = useMemo(
    () => data.filter((q) => selected.has(q.id) && q.verificationStatus !== "verified").length,
    [data, selected],
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="card p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input !pl-8"
              placeholder="Search question text or explanation…"
              value={filters.q}
              onChange={(e) => {
                setPage(1);
                setFilters((f) => ({ ...f, q: e.target.value }));
              }}
            />
          </div>
          <select
            className="select !w-auto"
            value={filters.status}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, status: e.target.value }));
            }}
          >
            <option value="">All statuses</option>
            <option value="verified">Verified</option>
            <option value="needs_verification">Needs verification</option>
          </select>
          <select
            className="select !w-auto"
            value={filters.topic}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, topic: e.target.value }));
            }}
          >
            <option value="all">All topics</option>
            {topics.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {mode === "bank" && !fixedSourceId && (
            <select
              className="select !w-auto"
              value={filters.sourceId}
              onChange={(e) => {
                setPage(1);
                setFilters((f) => ({ ...f, sourceId: e.target.value }));
              }}
            >
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.filename}
                </option>
              ))}
            </select>
          )}
          <button
            className={`btn btn-sm ${filters.dup ? "btn-primary" : "btn-outline"}`}
            onClick={() => {
              setPage(1);
              setFilters((f) => ({ ...f, dup: !f.dup }));
            }}
            title="Show only questions having duplicates"
          >
            <Copy size={14} /> Duplicates
          </button>
          <button
            className={`btn btn-sm ${filters.warn ? "btn-primary" : "btn-outline"}`}
            onClick={() => {
              setPage(1);
              setFilters((f) => ({ ...f, warn: !f.warn }));
            }}
            title="Show only questions with extraction warnings"
          >
            <CircleAlert size={14} /> Warnings
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          <button
            className="btn-outline btn btn-sm"
            onClick={() => {
              setEditTarget("new");
              setForm(EMPTY_FORM);
            }}
          >
            <Plus size={14} /> Add question
          </button>
          <button className="btn-outline btn btn-sm" onClick={() => runDedupe(false)} disabled={busy === "dedupe"}>
            {busy === "dedupe" ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
            Find duplicates
          </button>
          <span className="mx-1 hidden h-5 w-px bg-[var(--border)] sm:block" />
          <div className="flex items-center gap-1.5">
            <Download size={14} className="text-[var(--muted)]" />
            {["json", "csv", "xlsx"].map((fmt) => (
              <button key={fmt} className="btn-ghost btn btn-sm uppercase" onClick={() => exportBank(fmt)}>
                {fmt}
              </button>
            ))}
          </div>
          <button className="btn-outline btn btn-sm" onClick={() => importRef.current?.click()} disabled={busy === "import"}>
            {busy === "import" ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
            Restore backup
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importBackup(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {notice && (
        <div className="card fade-up border-emerald-500/40 bg-emerald-500/5 px-4 py-2.5 text-sm text-emerald-600 dark:text-emerald-400">
          {notice}
        </div>
      )}

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="card fade-up flex flex-wrap items-center gap-2 border-indigo-500/40 px-4 py-2.5">
          <span className="text-sm font-bold text-[var(--accent)]">{selected.size} selected</span>
          {selectedNeedsVerification > 0 && (
            <button
              className="btn-primary btn btn-sm"
              onClick={solveWithAi}
              disabled={busy === "ai"}
              title={aiStatus?.configured ? `Solve with ${aiStatus.provider}` : "No AI key configured"}
            >
              {busy === "ai" ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
              Solve {Math.min(selectedNeedsVerification, 20)} with AI
            </button>
          )}
          <button className="btn-outline btn btn-sm" onClick={() => bulk("verify")} disabled={!!busy}>
            <BadgeCheck size={14} /> Mark verified
          </button>
          <button className="btn-outline btn btn-sm" onClick={() => bulk("unverify")} disabled={!!busy}>
            <CircleAlert size={14} /> Needs verification
          </button>
          <button
            className="btn-outline btn btn-sm"
            disabled={!!busy}
            onClick={() => {
              const t = prompt("Set topic for selected questions:");
              if (t !== null) bulk("setTopic", t);
            }}
          >
            Set topic
          </button>
          <button className="btn-primary btn btn-sm" onClick={startTestFromSelection}>
            <Play size={14} /> Test from selection
          </button>
          <button className="btn-danger btn btn-sm" onClick={() => setConfirm({ kind: "bulk-delete" })} disabled={!!busy}>
            <Trash2 size={14} /> Delete
          </button>
          <button className="btn-ghost btn btn-sm ml-auto" onClick={() => setSelected(new Set())}>
            <X size={14} /> Clear
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="card flex justify-center py-16">
          <Spinner label="Loading questions…" />
        </div>
      ) : error ? (
        <Empty title="Something went wrong" hint={error} />
      ) : data.length === 0 ? (
        <Empty
          title="No questions found"
          hint={
            mode === "review"
              ? "This import produced no questions matching your filters."
              : "Upload a PDF or add questions manually to build your bank."
          }
          action={
            <Link href="/upload" className="btn-primary btn btn-sm">
              Upload PDFs
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex items-center gap-2 px-1 text-xs text-[var(--muted)]">
            <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={allChecked} onChange={toggleAll} />
            <span>Select all on page</span>
            <span className="ml-auto">
              {total} question{total === 1 ? "" : "s"} · page {page} of {totalPages}
            </span>
          </div>
          <div className="space-y-3">
            {data.map((q, idx) => (
              <QuestionCard
                key={q.id}
                q={q}
                index={(page - 1) * pageSize + idx + 1}
                selected={selected.has(q.id)}
                onToggle={() =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (n.has(q.id)) n.delete(q.id);
                    else n.add(q.id);
                    return n;
                  })
                }
                onEdit={() => openEdit(q)}
                onDelete={() => setConfirm({ kind: "delete-one", ids: [q.id] })}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button className="btn-outline btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span className="text-xs text-[var(--muted)]">
                {page} / {totalPages}
              </span>
              <button className="btn-outline btn btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Edit / add modal */}
      <Modal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title={editTarget === "new" ? "Add a question manually" : "Edit question"}
        wide
      >
        <div className="space-y-4">
          <div>
            <label className="label">Question text</label>
            <textarea
              className="input mt-1.5 min-h-24"
              value={form.text}
              onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {LETTERS.slice(0, Math.max(4, Object.keys(form.options).filter((k) => form.options[k]).length)).map((l) => (
              <div key={l}>
                <label className="label">Option {l}</label>
                <input
                  className="input mt-1.5"
                  value={form.options[l] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, options: { ...f.options, [l]: e.target.value } }))}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Correct answer</label>
              <select
                className="select mt-1.5"
                value={form.correctAnswer}
                onChange={(e) => setForm((f) => ({ ...f, correctAnswer: e.target.value }))}
              >
                <option value="">— Not determined —</option>
                {Object.keys(form.options)
                  .filter((k) => form.options[k]?.trim())
                  .map((k) => (
                    <option key={k} value={k}>
                      {k} — {form.options[k].slice(0, 40)}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="label">Topic / category</label>
              <input
                className="input mt-1.5"
                value={form.topic}
                onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                placeholder="e.g. Physics"
              />
            </div>
          </div>
          <div>
            <label className="label">Explanation (optional)</label>
            <textarea
              className="input mt-1.5 min-h-16"
              value={form.explanation}
              onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-outline btn" onClick={() => setEditTarget(null)}>
              Cancel
            </button>
            <button className="btn-primary btn" onClick={saveEdit} disabled={saving || !form.text.trim()}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save question
            </button>
          </div>
        </div>
      </Modal>

      {/* Dedupe modal */}
      <Modal open={dedupe !== null} onClose={() => setDedupe(null)} title="Duplicate scan results" wide>
        {dedupe && dedupe.groups.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No duplicate or near-duplicate questions found. Your bank is clean.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted)]">
              Found {dedupe?.duplicateCount} duplicate(s) in {dedupe?.groups.length} group(s). Exact duplicates keep the
              earliest copy when removed. Near duplicates are listed for review and are never auto-deleted.
            </p>
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {dedupe?.groups.map((g, i) => (
                <li key={i} className="rounded-xl border border-[var(--border)] p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge tone={g.kind === "exact" ? "rose" : "amber"}>{g.kind === "exact" ? "Exact" : "Near"}</Badge>
                    <span className="font-semibold">
                      {g.duplicateIds.length} duplicate(s) of:
                    </span>
                  </div>
                  <p className="mt-1.5 text-[var(--ink)]">{g.keepPreview}…</p>
                  <p className="mt-1 text-[var(--muted)]">Duplicates from: {g.duplicatePreviews.join(", ")}</p>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button className="btn-outline btn" onClick={() => setDedupe(null)}>
                Close
              </button>
              <button className="btn-danger btn" onClick={() => runDedupe(true)} disabled={busy === "dedupe"}>
                {busy === "dedupe" && <Loader2 size={14} className="animate-spin" />}
                Remove exact duplicates
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={confirm?.kind === "bulk-delete"}
        title={`Delete ${selected.size} question(s)?`}
        message="This permanently removes the selected questions from your bank. This action cannot be undone."
        confirmLabel="Delete permanently"
        danger
        busy={busy === "delete"}
        onConfirm={() => bulk("delete")}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "delete-one"}
        title="Delete this question?"
        message="The question will be permanently removed from the bank."
        confirmLabel="Delete"
        danger
        busy={busy === "delete-one"}
        onConfirm={() => confirm?.ids?.[0] && deleteOne(confirm.ids[0])}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function QuestionCard({
  q,
  index,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: {
  q: QuestionDTO;
  index: number;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const verified = q.verificationStatus === "verified" && q.correctAnswer;
  const letters = Object.keys(q.options);
  return (
    <div className={`card fade-up p-4 ${selected ? "ring-2 ring-indigo-500/50" : ""}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" className="mt-1.5 h-4 w-4 flex-none accent-indigo-500" checked={selected} onChange={onToggle} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="badge badge-neutral mono">#{q.questionNumber ?? index}</span>
            <Badge tone={verified ? "green" : "amber"}>
              {verified ? <BadgeCheck size={11} /> : <CircleAlert size={11} />}
              {verified ? "Verified" : "Needs verification"}
            </Badge>
            <Badge tone="indigo">{ANSWER_SOURCE_LABEL[q.answerSource] ?? q.answerSource}</Badge>
            {q.topic && <Badge tone="neutral">{q.topic}</Badge>}
            {q.warnings?.includes("spans_multiple_pages") && <Badge tone="neutral">Multi-page</Badge>}
            {q.warnings?.some((w) => w.startsWith("duplicate")) && <Badge tone="amber">Duplicate</Badge>}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[0.9rem] font-medium leading-relaxed">{q.text}</p>
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {letters.map((l) => (
              <div
                key={l}
                className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                  verified && q.correctAnswer === l
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-[var(--border)]"
                }`}
              >
                <span
                  className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-md text-[0.68rem] font-bold ${
                    verified && q.correctAnswer === l
                      ? "bg-emerald-500 text-white"
                      : "bg-[var(--surface-2)] text-[var(--muted)]"
                  }`}
                >
                  {l}
                </span>
                <span className="leading-snug">{q.options[l]}</span>
              </div>
            ))}
          </div>
          {(q.explanation || q.warnings?.length > 0) && (
            <button className="mt-2 text-xs font-semibold text-[var(--accent)] hover:underline" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Hide details" : "Details & warnings"}
            </button>
          )}
          {expanded && (
            <div className="mt-2 space-y-2">
              {q.explanation && (
                <p className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs leading-relaxed text-[var(--muted)]">
                  <strong className="text-[var(--ink)]">Explanation:</strong> {q.explanation}
                </p>
              )}
              {q.warnings?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {q.warnings.map((w, i) => (
                    <span key={i} className="badge badge-amber">
                      <CircleAlert size={10} /> {w.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="mt-2 text-[0.7rem] text-[var(--muted)]">
            {q.sourceLabel}
            {q.pageNumber ? ` · page ${q.pageNumber}` : ""}
          </p>
        </div>
        <div className="flex flex-none flex-col gap-1">
          <button className="btn-ghost btn btn-sm !px-2" onClick={onEdit} title="Edit question">
            <Pencil size={15} />
          </button>
          <button className="btn-ghost btn btn-sm !px-2 text-rose-500" onClick={onDelete} title="Delete question">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
