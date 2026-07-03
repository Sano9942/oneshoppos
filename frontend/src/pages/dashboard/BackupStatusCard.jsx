import { useEffect, useState } from "react";
import { SectionCard } from "../../ui/primitives";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";

function relativeTime(isoString) {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  return `${Math.floor(diffMin / 1440)}d ago`;
}

function hoursAgo(isoString) {
  if (!isoString) return Infinity;
  return (Date.now() - new Date(isoString).getTime()) / 3600000;
}

export function BackupStatusCard() {
  const { hasPerm } = useAuth();
  const [backup, setBackup] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const isAdmin = hasPerm("all_access");

  useEffect(() => {
    if (!isAdmin) return;
    api.get("/api/backup-status")
      .then((d) => { setBackup(d.backup); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [isAdmin]);

  if (!isAdmin || !loaded) return null;

  const hours = hoursAgo(backup?.created_at);
  const isFailed = backup?.status === "failed";
  const isStale72 = !backup || hours > 72;
  const isStale24 = hours > 24;

  // Determine status badge scheme (white card + pale status pill)
  let badgeColor = "bg-(--ui-success-bg) text-(--ui-success-fg)";
  let dotColor = "bg-(--ui-success-fg)";
  let label = "Backup OK";

  if (isFailed || isStale72) {
    badgeColor = "bg-(--ui-danger-bg) text-(--ui-danger-fg)";
    dotColor = "bg-(--ui-danger-fg)";
    label = isFailed ? "Backup Failed" : "No Recent Backup";
  } else if (isStale24) {
    badgeColor = "bg-(--ui-warning-bg) text-(--ui-warning-fg)";
    dotColor = "bg-(--ui-warning-fg)";
    label = "Backup Aging";
  }

  return (
    <SectionCard className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${badgeColor}`}>
            <span className={`h-2 w-2 rounded-full ${dotColor}`} />
          </span>
          <div>
            <p className="text-sm font-bold text-(--ui-text)">{label}</p>
            <p className="text-xs text-(--ui-text-muted)">
              {backup
                ? `Last backup: ${relativeTime(backup.created_at)}${backup.size_bytes ? ` (${(backup.size_bytes / 1024).toFixed(0)} KB)` : ""}`
                : "No backups recorded yet"}
            </p>
            {isFailed && backup?.error_message && (
              <p className="mt-0.5 max-w-xs truncate text-xs text-(--ui-danger-fg)" title={backup.error_message}>
                Error: {backup.error_message}
              </p>
            )}
          </div>
        </div>
        {backup?.duration_ms != null && (
          <span className="text-xs text-(--ui-text-muted)">
            {backup.duration_ms < 1000
              ? `${backup.duration_ms}ms`
              : `${(backup.duration_ms / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>
    </SectionCard>
  );
}
