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
  }, [isAdmin, authHeaders]);

  if (!isAdmin || !loaded) return null;

  const hours = hoursAgo(backup?.created_at);
  const isFailed = backup?.status === "failed";
  const isStale72 = !backup || hours > 72;
  const isStale24 = hours > 24;

  // Determine color scheme
  let borderColor = "border-emerald-200";
  let bgColor = "bg-emerald-50";
  let dotColor = "bg-emerald-500";
  let labelColor = "text-emerald-700";
  let label = "Backup OK";

  if (isFailed || isStale72) {
    borderColor = "border-rose-200";
    bgColor = "bg-rose-50";
    dotColor = "bg-rose-500";
    labelColor = "text-rose-700";
    label = isFailed ? "Backup Failed" : "No Recent Backup";
  } else if (isStale24) {
    borderColor = "border-amber-200";
    bgColor = "bg-amber-50";
    dotColor = "bg-amber-400";
    labelColor = "text-amber-700";
    label = "Backup Aging";
  }

  return (
    <SectionCard className={`p-4 ${borderColor} ${bgColor}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`h-3 w-3 shrink-0 rounded-full ${dotColor}`} />
          <div>
            <p className={`text-sm font-bold ${labelColor}`}>{label}</p>
            <p className="text-xs text-(--ui-text-muted)">
              {backup
                ? `Last backup: ${relativeTime(backup.created_at)}${backup.size_bytes ? ` (${(backup.size_bytes / 1024).toFixed(0)} KB)` : ""}`
                : "No backups recorded yet"}
            </p>
            {isFailed && backup?.error_message && (
              <p className="mt-0.5 text-xs text-rose-600 truncate max-w-xs" title={backup.error_message}>
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
