import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { api } from "../../api";
import { PageShell } from "../../ui/primitives";

const STATUS_COLORS = {
  open: "bg-amber-100 text-amber-700",
  acknowledged: "bg-blue-100 text-blue-700",
  resolved: "bg-emerald-100 text-emerald-700",
  closed: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
};

export default function MyTicketsRedesign() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/support/tickets")
      .then((data) => setTickets(data))
      .catch((err) => setError(err.body?.error || err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell title="My Tickets" subtitle="Support tickets you have submitted">
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-(--ui-text-muted)">Loading tickets...</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-(--ui-text-muted)">
          <MessageSquare size={40} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">No tickets submitted yet</p>
          <p className="mt-1 text-xs">Use the support widget to submit a ticket</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-(--ui-border) bg-(--ui-surface) shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) text-left text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Admin Reply</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-b border-(--ui-border) last:border-0">
                  <td className="px-4 py-3 font-medium text-(--ui-text)">{t.type || "general"}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-(--ui-text-muted)">{t.message}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[t.status] || STATUS_COLORS.open}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-(--ui-text-muted)">
                    {t.admin_reply ? (
                      <div>
                        <p className="truncate text-sm">{t.admin_reply}</p>
                        {t.replied_at && (
                          <p className="mt-0.5 text-[10px] text-(--ui-text-muted)">
                            {new Date(t.replied_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-(--ui-text-muted)">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-(--ui-text-muted)">
                    {new Date(t.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
