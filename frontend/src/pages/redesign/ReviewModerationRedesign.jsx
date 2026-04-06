import { useEffect, useState } from "react";
import { api } from "../../api";
import { Button, PageShell, SectionCard, Input } from "../../ui/primitives";
import { StarDisplay } from "../../ui/StarRating";
import { ShieldCheck, Check, X, Filter } from "lucide-react";

const STATUS_TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "", label: "All" },
];

export default function ReviewModerationRedesign() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [moderating, setModerating] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const url = statusFilter
        ? `/api/reviews?status=${statusFilter}`
        : "/api/reviews";
      const data = await api.get(url);
      setReviews(Array.isArray(data) ? data : []);
    } catch {
      setReviews([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [statusFilter]);

  const moderate = async (id, status) => {
    setModerating(id);
    try {
      await api.put(`/api/reviews/${id}/moderate`, { status });
      setReviews((prev) => prev.filter((r) => r.id !== id));
    } catch { /* ignore */ }
    setModerating(null);
  };

  const deleteReview = async (id) => {
    setModerating(id);
    try {
      await api.del(`/api/reviews/${id}`);
      setReviews((prev) => prev.filter((r) => r.id !== id));
    } catch { /* ignore */ }
    setModerating(null);
  };

  return (
    <PageShell title="Review Moderation" loading={loading}>
      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-(--ui-border)">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              statusFilter === tab.key
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-(--ui-text-muted) hover:text-(--ui-text)"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {reviews.length === 0 && !loading && (
        <p className="text-sm text-(--ui-text-muted) py-8 text-center">
          No {statusFilter || ""} reviews found.
        </p>
      )}

      <div className="space-y-3">
        {reviews.map((r) => (
          <SectionCard key={r.id}>
            <div className="p-4 space-y-2">
              {/* Header row */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StarDisplay rating={r.rating} size={14} />
                    {r.title && (
                      <span className="font-medium text-sm truncate">{r.title}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-(--ui-text-muted) mt-1">
                    <span className="font-medium">{r.product_name}</span>
                    <span>·</span>
                    <span>{r.customer_name}</span>
                    {r.sale_id && (
                      <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400">
                        <ShieldCheck size={12} /> Verified
                      </span>
                    )}
                    <span>·</span>
                    <span>{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Status badge for non-pending tabs */}
                {r.status !== "pending" && (
                  <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                    r.status === "approved"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                      : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                  }`}>
                    {r.status}
                  </span>
                )}
              </div>

              {/* Review body */}
              {r.body && (
                <p className="text-sm text-(--ui-text-muted) whitespace-pre-line">{r.body}</p>
              )}

              {/* Action buttons */}
              {r.status === "pending" && (
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={moderating === r.id}
                    onClick={() => moderate(r.id, "approved")}
                  >
                    <Check size={14} className="mr-1" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={moderating === r.id}
                    onClick={() => moderate(r.id, "rejected")}
                  >
                    <X size={14} className="mr-1" /> Reject
                  </Button>
                </div>
              )}

              {/* Delete for any status */}
              {r.status !== "pending" && (
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700"
                    disabled={moderating === r.id}
                    onClick={() => deleteReview(r.id)}
                  >
                    <X size={14} className="mr-1" /> Delete
                  </Button>
                </div>
              )}
            </div>
          </SectionCard>
        ))}
      </div>
    </PageShell>
  );
}
