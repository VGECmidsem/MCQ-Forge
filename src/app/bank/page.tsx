"use client";

import { useState } from "react";
import { Eraser } from "lucide-react";
import { QuestionManager } from "@/components/question-manager";
import { ConfirmDialog, PageHeader } from "@/components/ui";

export default function BankPage() {
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [busy, setBusy] = useState(false);

  const wipe = async () => {
    setBusy(true);
    try {
      await fetch("/api/bank", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Question Bank"
        subtitle="Your persistent, reusable pool of extracted and manual questions. Everything here is stored locally in PostgreSQL."
        actions={
          <button className="btn-danger btn btn-sm" onClick={() => setConfirmWipe(true)}>
            <Eraser size={14} /> Wipe bank
          </button>
        }
      />
      <QuestionManager mode="bank" />
      <ConfirmDialog
        open={confirmWipe}
        title="Wipe the entire question bank?"
        message="Every question in the bank will be permanently deleted. Consider exporting a JSON backup first — you can restore it later from the toolbar."
        confirmLabel="Wipe everything"
        danger
        busy={busy}
        onConfirm={wipe}
        onCancel={() => setConfirmWipe(false)}
      />
    </div>
  );
}
