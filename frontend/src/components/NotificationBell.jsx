/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Calendar,
  FileCheck,
  PackageCheck,
} from "lucide-react";
import { API_BASE as API } from "../config";
import { useAuth } from "../auth/AuthProvider";

function relativeTime(ts) {
  if (!ts) return "";
  const then = new Date(ts.replace(" ", "T"));
  const diffSec = Math.max(1, Math.floor((Date.now() - then.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

const TYPE_META = {
  low_stock: { Icon: AlertTriangle, color: "text-amber-500" },
  po_received: { Icon: PackageCheck, color: "text-emerald-500" },
  shift_open: { Icon: Bell, color: "text-blue-500" },
  shift_close: { Icon: Bell, color: "text-slate-500" },
  leave_request: { Icon: Calendar, color: "text-purple-500" },
  quotation_accepted: { Icon: FileCheck, color: "text-indigo-500" },
};

// direction="up" anchors the panel above the trigger — used when the bell
// lives at the bottom of the sidebar (Square layout) instead of a top bar.
export default function NotificationBell({ direction = "down" }) {
  const { authHeaders } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState([]);

  const loadCount = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/notifications/count`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setUnread(Number(data.unread || 0));
    } catch {
      // ignore
    }
  }, [authHeaders]);

  const loadRows = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/notifications`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setRows(data.notifications || []);
    } catch {
      // ignore
    }
  }, [authHeaders]);

  useEffect(() => {
    loadCount();
    const id = setInterval(loadCount, 60000);
    return () => clearInterval(id);
  }, [loadCount]);

  useEffect(() => {
    if (open) loadRows();
  }, [open, loadRows]);

  const markAllRead = async () => {
    try {
      await fetch(`${API}/api/notifications/read-all`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
      setUnread(0);
      setRows((prev) => prev.map((r) => ({ ...r, is_read: 1 })));
    } catch {
      // ignore
    }
  };

  const onRowClick = async (row) => {
    if (!row) return;
    try {
      if (!row.is_read) {
        await fetch(`${API}/api/notifications/${row.id}/read`, {
          method: "PUT",
          headers: authHeaders({ "Content-Type": "application/json" }),
        });
      }
    } catch {
      // ignore
    }
    setOpen(false);
    if (row.link) navigate(row.link);
    loadCount();
  };

  const badgeText = useMemo(() => (unread > 99 ? "99+" : String(unread)), [unread]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="ui-focus-ring relative cursor-pointer rounded-full p-2 text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text)"
        title="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4.5 h-4.5 rounded-full bg-(--ui-danger) text-white text-[10px] px-1 flex items-center justify-center font-bold">
            {badgeText}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-50 max-h-96 w-80 overflow-y-auto rounded-(--ui-radius-md) border border-(--ui-border-strong) bg-white shadow-(--ui-shadow-lg) ${
            direction === "up" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2"
          }`}
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-(--ui-border) bg-white px-3 py-2">
            <p className="text-sm font-bold text-(--ui-text)">Notifications</p>
            <button
              onClick={markAllRead}
              className="cursor-pointer text-xs font-medium text-(--ui-link) hover:underline"
            >
              Mark all read
            </button>
          </div>
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-(--ui-text-muted)">No notifications</div>
          ) : (
            rows.map((row) => {
              const meta = TYPE_META[row.type] || { Icon: Bell, color: "text-slate-500" };
              const Icon = meta.Icon;
              return (
                <button
                  key={row.id}
                  onClick={() => onRowClick(row)}
                  className={`w-full cursor-pointer border-b border-(--ui-border) px-3 py-2 text-left hover:bg-(--ui-muted-surface) ${
                    Number(row.is_read || 0) === 0 ? "bg-(--ui-muted-surface)" : ""
                  }`}
                >
                  <div className="flex gap-2">
                    <Icon size={16} className={`${meta.color} mt-0.5`} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-(--ui-text)">{row.title}</p>
                      <p className="truncate text-xs text-(--ui-text-muted)">
                        {String(row.message || "").slice(0, 80)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-(--ui-text-muted)">
                        {relativeTime(row.created_at)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
