"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { QuestionManager } from "@/components/question-manager";
import { ConfirmDialog, PageHeader } from "@/components/ui";

function ReviewInner() {
  const params = useSearchParams();
  const router = useRouter();
  const sourceId = params.get("source") || undefined;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) => {
        const s = (d.sources ?? []).find((x: any) => x.id === sourceId);
        if (s) setName(s.filename);
      })
      .catch(() => {});
  }, [sourceId]);

  const discard = async () => {
    if (!sourceId) return;
    setBusy(true);
    try {
      await fetch(`/api/sources?id=${sourceId}`, { method: "DELETE" });
      router.push("/bank");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={sourceId ? "Review extracted questions" : "Review questions"}
        subtitle={
          sourceId
            ? `Import: ${name ?? "…"} — verify answers, fix extraction errors, then save to your bank.`
            : "Verify answers and correct any extraction errors."
        }
        actions={
          sourceId ? (
            <button className="btn-danger btn btn-sm" onClick={() => setConfirmDiscard(true)}>
              <Trash2 size={14} /> Discard this import
            </button>
          ) : undefined
        }
      />
      <QuestionManager mode="review" fixedSourceId={sourceId} sourceName={name ?? undefined} />
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this entire import?"
        message="All questions extracted from this PDF will be permanently removed. Questions you keep are already saved to the bank automatically — discarding is only for failed imports."
        confirmLabel="Discard import"
        danger
        busy={busy}
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense>
      <ReviewInner />
    </Suspense>
  );
}
