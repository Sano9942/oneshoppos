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
          : "bg-(--ui-surface) text-(--ui-text) border border-(--ui-border) hover:bg-(--ui-muted-surface)";
  const sizeClass = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
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
