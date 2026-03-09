import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCircle, AlertTriangle, Info, RefreshCw } from "lucide-react";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import { Badge, Button, EmptyState, PageShell, SectionCard } from "../../ui/primitives";
import { fmtUtcDateTime } from "../../utils/dates";

const TYPE_CONFIG = {
  info:    { tone: "default", Icon: Info,          label: "Info" },
  warning: { tone: "warning", Icon: AlertTriangle, label: "Warning" },
  success: { tone: "success", Icon: CheckCircle,   label: "Success" },
};

export default function NotificationsRedesign() {
  const { authHeaders } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/notifications`, { headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load notifications");
      setNotifications(d.notifications || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const markRead = async (id) => {
    try {
      const r = await fetch(`${API}/api/notifications/${id}/read`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!r.ok) return;
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: 1 } : n)),
      );
    } catch (e) {
      console.error(e);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <PageShell
      title="Notifications"
      subtitle="System alerts, stock warnings, and activity updates."
      right={
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Badge tone="warning">{unreadCount} unread</Badge>
          )}
          <Button onClick={fetchNotifications} disabled={loading}>
            <RefreshCw size={14} className={`mr-1 inline ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      }
    >
      <SectionCard>
        {notifications.length === 0 && !loading ? (
          <EmptyState
            icon={<Bell size={32} className="text-(--ui-text-muted)" />}
            title="No notifications"
            body="System alerts and activity updates will appear here."
          />
        ) : (
          <ul className="divide-y divide-(--ui-border)">
            {notifications.map((n) => {
              const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.info;
              const { Icon } = cfg;
              return (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                    n.read ? "opacity-60" : "bg-(--ui-muted-surface)"
                  }`}
                >
                  <div className={`mt-0.5 shrink-0 rounded-full p-1.5 ${
                    n.type === "warning"
                      ? "bg-amber-100 text-amber-600"
                      : n.type === "success"
                      ? "bg-emerald-100 text-emerald-600"
                      : "bg-blue-100 text-blue-600"
                  }`}>
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-sm text-(--ui-text)">{n.title}</p>
                      <Badge tone={cfg.tone}>{cfg.label}</Badge>
                      {!n.read && <Badge tone="warning">New</Badge>}
                    </div>
                    {n.message && (
                      <p className="mt-0.5 text-sm text-(--ui-text-muted)">{n.message}</p>
                    )}
                    <p className="mt-1 text-xs text-(--ui-text-muted)">
                      {fmtUtcDateTime(n.created_at)}
                    </p>
                  </div>
                  {!n.read && (
                    <Button
                      size="sm"
                      onClick={() => markRead(n.id)}
                      className="shrink-0 self-center"
                    >
                      Mark as Read
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </PageShell>
  );
}
