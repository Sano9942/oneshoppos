import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle, Database, Download, History, RefreshCw, Upload } from "lucide-react";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import {
  Badge,
  Button,
  EmptyState,
  PageShell,
  SectionCard,
} from "../../ui/primitives";

const fmt = (dt) => (dt ? new Date(dt).toLocaleString() : "—");
const fmtBytes = (b) => {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

export default function BackupRestoreRedesign() {
  const { employee, authHeaders } = useAuth();
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'success'|'error', text }
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef();

  const showMsg = useCallback((type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
  }, []);

  const fetchLog = useCallback(
    async (silent = false) => {
      try {
        const r = await fetch(`${API}/api/backup/log`, { headers: authHeaders() });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed to load backup log");
        setLog(d.log || []);
      } catch (e) {
        if (!silent) showMsg("error", e.message || "Failed to load backup log");
      }
    },
    [showMsg, authHeaders],
  );

  useEffect(() => { fetchLog(true); }, [fetchLog]);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const performedBy = employee?.name || (employee?.id ? `Employee #${employee.id}` : "Unknown");
      const res = await fetch(
        `${API}/api/backup/download?performed_by=${encodeURIComponent(performedBy)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Backup failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
      a.click();
      URL.revokeObjectURL(url);
      showMsg("success", "Backup downloaded successfully.");
      fetchLog(true);
    } catch (e) {
      showMsg("error", e.message || "Backup failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (file) => {
    if (!file) return;
    if (
      !window.confirm(
        "Restoring will REPLACE all current data with the backup file. This cannot be undone. Continue?",
      )
    )
      return;
    setRestoring(true);
    try {
      const formData = new FormData();
      formData.append("backup", file);
      const performedBy = employee?.name || "Unknown";
      const res = await fetch(
        `${API}/api/backup/restore?performed_by=${encodeURIComponent(performedBy)}`,
        { method: "POST", body: formData, headers: authHeaders() },
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Restore failed");
      showMsg("success", "Database restored successfully. Please refresh the app.");
      fetchLog(true);
    } catch (e) {
      showMsg("error", e.message || "Restore failed");
    } finally {
      setRestoring(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <PageShell
      title="Backup & Restore"
      subtitle="Download a database backup or restore from a previous backup file."
      right={
        <Button onClick={() => fetchLog(false)}>
          <RefreshCw size={14} className="mr-1 inline" /> Refresh Log
        </Button>
      }
    >
      {msg && (
        <SectionCard
          className={`mb-4 flex items-center gap-2 p-3 text-sm ${
            msg.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {msg.type === "success" ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
          {msg.text}
        </SectionCard>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Download */}
        <SectionCard className="p-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
              <Download size={18} />
            </div>
            <div>
              <p className="font-semibold text-[var(--ui-text)]">Download Backup</p>
              <p className="text-xs text-[var(--ui-text-muted)]">Export current database as SQLite file</p>
            </div>
          </div>
          <Button tone="primary" onClick={handleDownload} disabled={loading} className="w-full">
            {loading ? (
              <><RefreshCw size={14} className="mr-1 inline animate-spin" />Creating backup...</>
            ) : (
              <><Download size={14} className="mr-1 inline" />Download Backup</>
            )}
          </Button>
        </SectionCard>

        {/* Restore */}
        <SectionCard className="p-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
              <Upload size={18} />
            </div>
            <div>
              <p className="font-semibold text-[var(--ui-text)]">Restore from Backup</p>
              <p className="text-xs text-[var(--ui-text-muted)]">Replace current data with a backup file</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".sqlite,.db"
              className="block w-full text-sm text-[var(--ui-text-muted)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--ui-muted-surface)] file:px-3 file:py-1.5 file:text-xs file:font-medium"
              onChange={(e) => handleRestore(e.target.files?.[0])}
              disabled={restoring}
            />
            {restoring && (
              <RefreshCw size={15} className="animate-spin text-[var(--ui-text-muted)]" />
            )}
          </div>
          <p className="mt-2 text-xs text-rose-500">
            <AlertTriangle size={11} className="mr-1 inline" />
            This will permanently overwrite all current data.
          </p>
        </SectionCard>
      </div>

      {/* Backup Log */}
      <SectionCard>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--ui-border)]">
          <History size={15} className="text-[var(--ui-accent)]" />
          <p className="font-medium text-[var(--ui-text)]">Backup Log</p>
          <Badge tone="default" className="ml-auto">{log.length} entries</Badge>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Timestamp</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Performed By</th>
                <th className="px-3 py-2 text-right">Size</th>
              </tr>
            </thead>
            <tbody>
              {log.map((entry, i) => (
                <tr key={i} className="border-t border-[var(--ui-border)] hover:bg-[var(--ui-muted-surface)]">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--ui-text-muted)]">
                    {fmt(entry.created_at || entry.timestamp)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={entry.type === "restore" ? "warning" : "success"}>
                      {entry.type === "restore" ? <Upload size={10} className="mr-0.5 inline" /> : <Download size={10} className="mr-0.5 inline" />}
                      {entry.type || "backup"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-[var(--ui-text)]">{entry.performed_by || "—"}</td>
                  <td className="px-3 py-2 text-right text-[var(--ui-text-muted)]">
                    {fmtBytes(entry.file_size)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {log.length === 0 && (
            <EmptyState
              icon={<Database size={32} className="text-[var(--ui-text-muted)]" />}
              title="No backup history"
              body="Your backup activity will appear here."
            />
          )}
        </div>
      </SectionCard>
    </PageShell>
  );
}
