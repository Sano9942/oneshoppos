import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function PageShell({ title, subtitle, right, children }) {
  return (
    <div className="min-h-full w-full">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 pt-2">
        <div>
          <h1 className="text-[25px] font-bold leading-tight tracking-[-0.01em] text-(--ui-text)">
            {title}
          </h1>
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
      className={`rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) ${className}`}
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
      ? "bg-(--ui-primary) text-(--ui-on-primary) hover:bg-(--ui-primary-strong)"
      : tone === "danger"
        ? "bg-(--ui-danger) text-white hover:opacity-90"
        : tone === "plain"
          ? "bg-transparent text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text)"
          : tone === "link"
            ? "bg-transparent text-(--ui-link) hover:underline"
            : "bg-(--ui-muted-surface) text-(--ui-text) hover:bg-(--ui-border-strong)";
  // iconOnly buttons are fixed squares for table-row actions, toolbar icons,
  // modal-close X. tone="link" drops padding so it sits inline with text.
  const sizeClass = iconOnly
    ? size === "sm"
      ? "h-8 w-8 p-0"
      : "h-10 w-10 p-0"
    : tone === "link"
      ? "p-0"
      : size === "sm"
        ? "h-8 px-3 text-[13px]"
        : "h-10 px-4 text-sm";
  return (
    <button
      className={`ui-focus-ring inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full font-semibold transition disabled:cursor-default disabled:opacity-50 ${toneClass} ${sizeClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ className = "", ...props }) {
  return (
    <input
      className={`ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted) ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }) {
  return (
    <select
      className={`ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text) ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Badge({ tone = "default", children }) {
  const toneClass =
    tone === "success"
      ? "bg-(--ui-success-bg) text-(--ui-success-fg)"
      : tone === "warning"
        ? "bg-(--ui-warning-bg) text-(--ui-warning-fg)"
        : tone === "danger"
          ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
          : "bg-(--ui-muted-surface) text-(--ui-text-muted)";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${toneClass}`}
    >
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

// Clearable filter chip for table toolbars. Non-default (active) filters show
// an inline ✕ so they can be cleared without opening the picker.
export function FilterPill({ label, value, active = false, onClick, onClear, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ui-focus-ring inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition ${
        active
          ? "border-(--ui-text) bg-(--ui-muted-surface) text-(--ui-text)"
          : "border-(--ui-border-strong) bg-white text-(--ui-text) hover:bg-(--ui-muted-surface)"
      } ${className}`}
    >
      <span className="truncate">
        {label}
        {value ? <span className="font-semibold">: {value}</span> : null}
      </span>
      {active && onClear ? (
        <span
          role="button"
          aria-label={`Clear ${label} filter`}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="-mr-1 rounded-full p-0.5 hover:bg-(--ui-border-strong)"
        >
          <X size={12} />
        </span>
      ) : null}
    </button>
  );
}

export function BulkActionBar({ children }) {
  return (
    <div className="rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-(--ui-muted-surface) p-3">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

// Empty states scale with page importance (Square's 3-tier pattern):
//  - minimal:  icon + heading + one line + primary action
//  - standard: adds a secondary action + optional bordered "Learn more" row
//  - hero:     full-bleed dark section for flagship first-run pages
// `action`/`secondaryAction` are ReactNodes (usually <Button>s).
export function EmptyState({
  title,
  body,
  icon = null,
  action = null,
  secondaryAction = null,
  learnMoreHref = null,
  variant = "minimal",
}) {
  if (variant === "hero") {
    return (
      <div className="rounded-(--ui-radius-lg) bg-(--ui-primary) px-6 py-14 text-center text-white">
        {icon ? <div className="mb-4 flex justify-center opacity-90">{icon}</div> : null}
        <h2 className="mx-auto max-w-xl text-2xl font-bold leading-snug">{title}</h2>
        {body ? <p className="mx-auto mt-2 max-w-lg text-sm text-white/70">{body}</p> : null}
        {action ? <div className="mt-6 flex justify-center gap-2">{action}{secondaryAction}</div> : null}
      </div>
    );
  }
  return (
    <div className="px-4 py-12 text-center">
      {icon ? (
        <div className="mb-3 flex justify-center text-(--ui-text-muted)">{icon}</div>
      ) : null}
      <p className="text-base font-bold text-(--ui-text)">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-md text-sm text-(--ui-text-muted)">{body}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {variant === "standard" ? secondaryAction : null}
        </div>
      ) : null}
      {variant === "standard" && learnMoreHref ? (
        <a
          href={learnMoreHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center rounded-(--ui-radius-sm) border border-(--ui-border-strong) px-4 py-2 text-xs font-semibold uppercase tracking-wide text-(--ui-text) hover:bg-(--ui-muted-surface)"
        >
          Learn more
        </a>
      ) : null}
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

// Gray track, monochrome knob — no colored "on" track, consistent with the
// near-monochrome palette. Checked state reads from knob color + position.
export function Toggle({ checked = false, onChange, disabled = false, className = "", ...props }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange && onChange(!checked)}
      className={`ui-focus-ring relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-(--ui-border-strong) transition disabled:cursor-default disabled:opacity-50 ${className}`}
      {...props}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full transition ${
          checked
            ? "translate-x-[22px] bg-(--ui-primary)"
            : "translate-x-0.5 border border-(--ui-border-strong) bg-white"
        }`}
      />
    </button>
  );
}

// Black pill tooltip on hover. Pure CSS — no positioning library.
export function Tooltip({ label, children, className = "" }) {
  return (
    <span className={`group relative inline-flex ${className}`}>
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-(--ui-primary) px-2.5 py-1 text-xs font-medium text-white group-hover:block">
        {label}
      </span>
    </span>
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
      <div
        className={`w-full ${widthClass} max-h-[90vh] overflow-auto rounded-(--ui-radius-lg) bg-white p-5 shadow-(--ui-shadow-lg)`}
      >
        <div ref={cardRef} tabIndex={-1} className="outline-none">
          {(title || !hideClose) && (
            <div className="mb-3 flex items-start justify-between gap-3">
              {title ? (
                <h3 className="text-lg font-bold text-(--ui-text)">{title}</h3>
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
      </div>
    </div>
  );
}

// Right-anchored full-height slide-over with scrim — Square's account-menu /
// notifications / record-detail pattern. Header: X (left), title, optional
// `actions` node (right). Body scrolls. Same focus/escape handling as Modal.
const DRAWER_WIDTH_CLASS = {
  sm: "max-w-[360px]",
  md: "max-w-[420px]",
  lg: "max-w-[560px]",
};

export function Drawer({ open, onClose, title, actions = null, size = "md", children }) {
  const panelRef = useRef(null);
  const lastActiveRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    lastActiveRef.current = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector(
        "input, select, textarea, button, [tabindex]:not([tabindex='-1'])"
      );
      (focusable || panel).focus({ preventScroll: true });
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

  const widthClass = DRAWER_WIDTH_CLASS[size] || DRAWER_WIDTH_CLASS.md;

  return (
    <div
      className="ui-anim-fade fixed inset-0 z-50 bg-black/45"
      onClick={(e) => {
        if (onClose && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`ui-anim-drawer absolute inset-y-0 right-0 flex w-full ${widthClass} flex-col bg-white shadow-(--ui-shadow-lg) outline-none`}
      >
        <div className="flex items-center gap-3 border-b border-(--ui-border) px-4 py-3">
          {onClose ? (
            <Button tone="plain" size="sm" iconOnly aria-label="Close" onClick={onClose}>
              <X size={18} />
            </Button>
          ) : null}
          {title ? (
            <h3 className="min-w-0 flex-1 truncate text-base font-bold text-(--ui-text)">
              {title}
            </h3>
          ) : (
            <span className="flex-1" />
          )}
          {actions}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
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
      className={`inline-flex flex-wrap items-center gap-1 rounded-full bg-(--ui-muted-surface) p-1 ${className}`}
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
            className={`ui-focus-ring cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-white font-semibold text-(--ui-text) shadow-[inset_0_0_0_1px_var(--ui-border-strong)]"
                : "text-(--ui-text-muted) hover:text-(--ui-text)"
            }`}
          >
            {t.label}
            {typeof t.count === "number" ? (
              <span
                className={`ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  active
                    ? "bg-(--ui-muted-surface) text-(--ui-text-muted)"
                    : "bg-white text-(--ui-text-muted)"
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
