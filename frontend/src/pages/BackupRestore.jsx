import { useState, useEffect, useRef, useCallback } from "react";
import { Download, Upload, History, AlertTriangle, CheckCircle, RefreshCw, Database } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";

const API = "http://localhost:5000";

function fmt(dt) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString();
}

function fmtBytes(b) {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BackupRestore() {
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

  const fetchLog = useCallback(async (silent = false) => {
    try {
      const r = await fetch(`${API}/api/backup/log`, { headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load backup log");
      setLog(d.log || []);
    } catch (e) {
      if (!silent) showMsg("error", e.message || "Failed to load backup log");
    }
  }, [showMsg, authHeaders]);

  useEffect(() => { fetchLog(true); }, [fetchLog]);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const performedBy = employee?.name || (employee?.id ? `Employee #${employee.id}` : "Unknown");
      const res = await fetch(`${API}/api/backup/download?performed_by=${encodeURIComponent(performedBy)}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Download failed");
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : "oneshop_backup.db";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showMsg("success", `Backup downloaded: ${filename}`);
      fetchLog();
    } catch (e) {
      showMsg("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    fileRef.current.value = "";

    const confirmed = window.confirm(
      `⚠️ RESTORE DATABASE\n\nThis will REPLACE the live database with:\n"${file.name}"\n\nAll data added after this backup was taken will be lost.\n\nAre you absolutely sure?`
    );
    if (!confirmed) return;

    setRestoring(true);
    try {
      const performedBy = employee?.name || (employee?.id ? `Employee #${employee.id}` : "Unknown");
      const form = new FormData();
      form.append("backup_file", file);
      form.append("performed_by", performedBy);
      const res = await fetch(`${API}/api/backup/restore`, {
        method: "POST",
        body: form,
        headers: authHeaders(),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Restore failed");
      showMsg("success", d.message);
      fetchLog();
    } catch (e) {
      showMsg("error", e.message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Alert banner */}
      {msg && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${
          msg.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {msg.type === "success" ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          {msg.text}
        </div>
      )}

      {/* Action cards */}
      <div className="grid grid-cols-2 gap-4">
        {/* Backup card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <Download size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-slate-800">Download Backup</p>
              <p className="text-xs text-slate-500">Save a copy of the database</p>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            Downloads the entire SQLite database as a <code className="bg-slate-100 px-1 rounded text-xs">.db</code> file.
            Store it in a safe location — this is your single recovery file.
          </p>
          <button
            onClick={handleDownload}
            disabled={loading}
            className="mt-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
          >
            {loading ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
            {loading ? "Preparing…" : "Download Now"}
          </button>
        </div>

        {/* Restore card */}
        <div className="bg-white rounded-2xl border border-amber-200 p-6 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Upload size={20} className="text-amber-600" />
            </div>
            <div>
              <p className="font-semibold text-slate-800">Restore Backup</p>
              <p className="text-xs text-amber-600 font-medium">Destructive — use with care</p>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            Upload a previously downloaded <code className="bg-slate-100 px-1 rounded text-xs">.db</code> file
            to replace the current database. All data created after the backup date will be lost.
          </p>
          <input ref={fileRef} type="file" accept=".db" className="hidden" onChange={handleRestore} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={restoring}
            className="mt-auto flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
          >
            {restoring ? <RefreshCw size={15} className="animate-spin" /> : <Upload size={15} />}
            {restoring ? "Restoring…" : "Choose File & Restore"}
          </button>
        </div>
      </div>

      {/* Info box */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start gap-3 text-sm text-slate-600">
        <Database size={16} className="shrink-0 mt-0.5 text-slate-400" />
        <div>
          <p className="font-medium text-slate-700 mb-1">Backup best practices</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs text-slate-500">
            <li>Download a backup before any major data entry or configuration change</li>
            <li>Store backups off-device (USB drive, cloud storage, network share)</li>
            <li>After restoring, restart the backend server for changes to take full effect</li>
            <li>Only restore files that were downloaded from this system</li>
          </ul>
        </div>
      </div>

      {/* History table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <History size={15} className="text-slate-400" />
            Backup / Restore History
          </div>
          <button onClick={fetchLog} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        {log.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">No backup or restore events yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 font-medium">
              <tr>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Filename</th>
                <th className="px-4 py-3 text-right">Size</th>
                <th className="px-4 py-3 text-left">By</th>
                <th className="px-4 py-3 text-left">Date / Time</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                      l.action === "backup" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {l.action === "backup" ? <Download size={10} /> : <Upload size={10} />}
                      {l.action === "backup" ? "Backup" : "Restore"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-xs max-w-xs truncate">{l.filename || "—"}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{fmtBytes(l.size_bytes)}</td>
                  <td className="px-4 py-3 text-slate-500">{l.performed_by || "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{fmt(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
