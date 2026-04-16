import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function PageShell({ title, subtitle, right, children }) {
  return (
    <div className="ui-shell-bg min-h-full w-full rounded-xl border border-(--ui-border) p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-(--ui-text)">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-(--ui-text-muted)">{subtitle}</p>
          ) : null}
        </div>
        {right || null}
      </div>
      {children}
    </div>
  );
}

export function SectionCard({ children, className = "" }) {
  return (
    <section
      className={`rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) shadow-(--ui-shadow) ${className}`}
    >
      {children}
    </section>
  );
}

export function Button({
  children,
  tone = "default",
  size = "md",
  iconOnly = false,
  className = "",
  ...props
}) {
  const toneClass =
    tone === "primary"
      ? "bg-(--ui-primary) text-white hover:bg-(--ui-primary-strong)"
      : tone === "danger"
        ? "bg-(--ui-danger) text-white hover:opacity-90"
        : tone === "plain"
          ? "bg-transparent text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
          : tone === "link"
            ? "bg-transparent text-(--ui-primary) hover:underline"
            : "bg-(--ui-surface) text-(--ui-text) border border-(--ui-border) hover:bg-(--ui-muted-surface)";
  // iconOnly buttons get square padding for table-row actions, toolbar icons,
  // modal-close X. tone="link" drops padding so it sits inline with text.
  const sizeClass = iconOnly
    ? size === "sm"
      ? "p-1.5"
      : "p-2"
    : tone === "link"
      ? "p-0"
      : size === "sm"
        ? "px-3 py-1.5 text-xs"
        : "px-4 py-2 text-sm";
  return (
    <button
      className={`ui-focus-ring rounded-(--ui-radius-sm) font-medium transition ${toneClass} ${sizeClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ className = "", ...props }) {
  return (
    <input
      className={`ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border) bg-white px-3 py-2 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted) ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }) {
  return (
    <select
      className={`ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border) bg-white px-3 py-2 text-sm text-(--ui-text) ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Badge({ tone = "default", children }) {
  const toneClass =
    tone === "success"
      ? "bg-emerald-100 text-emerald-700"
      : tone === "warning"
        ? "bg-amber-100 text-amber-700"
        : tone === "danger"
          ? "bg-rose-100 text-rose-700"
          : "bg-slate-100 text-slate-700";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${toneClass}`}>
      {children}
    </span>
  );
}

export function TableToolbar({ left, right }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-border) p-3">
      <div className="flex flex-wrap items-center gap-2">{left}</div>
      <div className="flex flex-wrap items-center gap-2">{right}</div>
    </div>
  );
}

export function BulkActionBar({ children }) {
  return (
    <div className="rounded-(--ui-radius-sm) border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function EmptyState({ title, body }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-base font-semibold text-(--ui-text)">{title}</p>
      {body ? <p className="mt-1 text-sm text-(--ui-text-muted)">{body}</p> : null}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return (
    <div
      className={`animate-pulse rounded bg-(--ui-muted-surface) ${className}`}
    />
  );
}

// Sizes match common existing modal widths in the codebase: sm (max-w-sm)
// for confirms, md (max-w-md) for compact forms, lg (max-w-lg) for the
// add/edit customer style, xl for big tables. Defaults to md.
const MODAL_WIDTH_CLASS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

export function Modal({
  open,
  onClose,
  title,
  size = "md",
  hideClose = false,
  closeOnBackdrop = true,
  children,
}) {
  const cardRef = useRef(null);
  const lastActiveRef = useRef(null);

  // Escape key + initial focus + restore focus on close. Drop-in replacement
  // for the ~106 inline `fixed inset-0` modal markup sites — those almost
  // never handle escape or restore focus, so this is a real UX upgrade as
  // well as a consistency one.
  useEffect(() => {
    if (!open) return;
    lastActiveRef.current = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Defer focus to next frame so the card is mounted first.
    const t = window.setTimeout(() => {
      const card = cardRef.current;
      if (!card) return;
      const focusable = card.querySelector(
        "input, select, textarea, button, [tabindex]:not([tabindex='-1'])"
      );
      (focusable || card).focus({ preventScroll: true });
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      const last = lastActiveRef.current;
      if (last && typeof last.focus === "function") {
        last.focus({ preventScroll: true });
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const widthClass = MODAL_WIDTH_CLASS[size] || MODAL_WIDTH_CLASS.md;

  const handleBackdrop = (e) => {
    if (!closeOnBackdrop || !onClose) return;
    // Only fire when the click is on the backdrop itself, not bubbling up
    // from a child click inside the card.
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3"
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <SectionCard
        className={`w-full ${widthClass} max-h-[90vh] overflow-auto p-4`}
      >
        <div ref={cardRef} tabIndex={-1} className="outline-none">
          {(title || !hideClose) && (
            <div className="mb-3 flex items-start justify-between gap-3">
              {title ? (
                <h3 className="text-lg font-semibold text-(--ui-text)">{title}</h3>
              ) : (
                <span />
              )}
              {!hideClose && onClose ? (
                <Button tone="plain" size="sm" iconOnly aria-label="Close" onClick={onClose}>
                  <X size={16} />
                </Button>
              ) : null}
            </div>
          )}
          {children}
        </div>
      </SectionCard>
    </div>
  );
}

export function ModalBody({ children, className = "" }) {
  return <div className={`space-y-3 ${className}`}>{children}</div>;
}

export function ModalFooter({ children, className = "" }) {
  return (
    <div className={`mt-4 flex flex-wrap items-center justify-end gap-2 ${className}`}>
      {children}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title = "Are you sure?",
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal open={open} onClose={busy ? undefined : onCancel} title={title} size="sm">
      {body ? (
        <p className="text-sm text-(--ui-text-muted)">{body}</p>
      ) : null}
      <ModalFooter>
        <Button onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          tone={destructive ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Working..." : confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// Segmented tab control. Each tab: { value, label, count? }. count renders
// as a small grey pill next to the label — handy for inbox-style counters.
export function TabBar({ value, onChange, tabs = [], className = "" }) {
  return (
    <div
      role="tablist"
      className={`inline-flex flex-wrap items-center gap-1 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) p-1 ${className}`}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange && onChange(t.value)}
            className={`ui-focus-ring rounded-(--ui-radius-sm) px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-(--ui-surface) text-(--ui-text) shadow-(--ui-shadow)"
                : "text-(--ui-text-muted) hover:text-(--ui-text)"
            }`}
          >
            {t.label}
            {typeof t.count === "number" ? (
              <span
                className={`ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  active
                    ? "bg-(--ui-muted-surface) text-(--ui-text-muted)"
                    : "bg-(--ui-surface) text-(--ui-text-muted)"
                }`}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
