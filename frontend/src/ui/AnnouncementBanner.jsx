import { useEffect, useState } from "react";
import { X, Info, AlertTriangle, Wrench } from "lucide-react";
import { API_BASE, IS_MULTI_TENANT } from "../config";

const TYPE_STYLES = {
  info: { bg: "bg-blue-50 border-blue-200", text: "text-blue-800", icon: Info },
  warning: { bg: "bg-amber-50 border-amber-200", text: "text-amber-800", icon: AlertTriangle },
  maintenance: { bg: "bg-red-50 border-red-200", text: "text-red-800", icon: Wrench },
};

export default function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState([]);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("dismissed_announcements") || "[]");
    } catch { return []; }
  });

  useEffect(() => {
    // Pass ?tenant=<slug> so the backend can narrow plan/industry-targeted
    // announcements to this tenant. Pre-login (no slug) omits it — the backend
    // then returns only untargeted announcements.
    let url = `${API_BASE}/api/announcements/active`;
    if (IS_MULTI_TENANT) {
      try {
        const raw = localStorage.getItem("authSession");
        const slug = raw ? JSON.parse(raw)?.tenant_slug : null;
        if (slug) url += `?tenant=${encodeURIComponent(slug)}`;
      } catch { /* ignore malformed session */ }
    }
    fetch(url)
      .then(r => r.ok ? r.json() : [])
      .then(data => setAnnouncements(data))
      .catch(() => {});
  }, []);

  const dismiss = (id) => {
    const next = [...dismissed, id];
    setDismissed(next);
    sessionStorage.setItem("dismissed_announcements", JSON.stringify(next));
  };

  const visible = announcements.filter(a => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 mb-3">
      {visible.map(a => {
        const style = TYPE_STYLES[a.type] || TYPE_STYLES.info;
        const Icon = style.icon;
        return (
          <div key={a.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${style.bg}`}>
            <Icon size={16} className={style.text + " shrink-0"} />
            <span className={`text-sm font-medium ${style.text} flex-1`}>{a.message}</span>
            <button onClick={() => dismiss(a.id)} className={`${style.text} opacity-60 hover:opacity-100`}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
