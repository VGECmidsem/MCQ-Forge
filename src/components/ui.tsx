"use client";

import { AlertTriangle, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "green" | "amber" | "rose" | "indigo" | "neutral";
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[var(--muted)]">
      <Loader2 size={size} className="animate-spin" />
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className={`card fade-up max-h-[92vh] w-full overflow-y-auto rounded-b-none sm:rounded-2xl ${
          wide ? "sm:max-w-3xl" : "sm:max-w-lg"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3.5">
          <h3 className="font-display text-[1rem]">{title}</h3>
          <button className="btn-ghost btn btn-sm !px-2" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} title={title}>
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full ${
            danger ? "bg-rose-500/10 text-rose-500" : "bg-indigo-500/10 text-indigo-500"
          }`}
        >
          <AlertTriangle size={17} />
        </span>
        <div className="text-sm leading-relaxed text-[var(--muted)]">{message}</div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-outline btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2.5 px-6 py-14 text-center">
      {icon && (
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--muted)]">
          {icon}
        </span>
      )}
      <p className="font-display text-[1rem]">{title}</p>
      {hint && <p className="max-w-md text-sm text-[var(--muted)]">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span
        className={`relative mt-0.5 inline-flex h-5.5 w-10 flex-none items-center rounded-full transition-colors ${
          checked ? "bg-indigo-500" : "bg-[var(--border)]"
        }`}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        role="switch"
        aria-checked={checked}
        style={{ height: 22 }}
      >
        <span
          className="absolute h-4 w-4 rounded-full bg-white shadow transition-all"
          style={{ left: checked ? 22 : 3 }}
        />
      </span>
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-[var(--muted)]">{hint}</span>}
      </span>
    </label>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl tracking-tight sm:text-[1.7rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
