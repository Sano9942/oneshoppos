import { useState, useEffect, useCallback } from "react";
import { CheckCircle, XCircle, Clock, RefreshCw } from "lucide-react";
import { fmtLocalDateTime as fmtDateTime } from "../utils/dates";
import { api } from '../api';

const STATUS_LABELS = {
  pending_approval: { label: "Pending", color: "bg-(--ui-warning-bg) text-(--ui-warning-fg)" },
  approved: { label: "Approved", color: "bg-(--ui-success-bg) text-(--ui-success-fg)" },
  rejected: { label: "Rejected", color: "bg-(--ui-danger-bg) text-(--ui-danger-fg)" },
};

const TYPE_LABELS = {
  po_approval: "Purchase Order",
  str_approval: "Stock Transfer",
  reconciliation_fix: "Inventory Reconciliation",
};

function getApprovalPath(approval) {
  if (approval.reference_type === "purchase_order") {
    return `/api/purchase-orders/${approval.reference_id}/approve`;
  }
  if (approval.reference_type === "reconciliation") {
    return `/api/reconciliation/inventory/${approval.reference_id}/approve-fix`;
  }
  return `/api/transfers/${approval.reference_id}/approve`;
}

function formatApprovalNotes(approval) {
  if (approval.request_type !== "reconciliation_fix") return approval.notes || "-";
  try {
    const parsed = JSON.parse(approval.notes || "{}");
    const mode = parsed.mode === "push_to_shopify" ? "Push local to Shopify" : "Pull Shopify to local";
    return `${mode}${parsed.diff !== undefined ? ` | diff=${parsed.diff}` : ""}`;
  } catch {
    return approval.notes || "-";
  }
}

export default function Approvals() {
  const [approvals, setApprovals] = useState([]);
  const [filterStatus, setFilterStatus] = useState("pending_approval");
  const [loading, setLoading] = useState(false);
  const [actionModal, setActionModal] = useState(null); // { approval, action: 'approved'|'rejected' }
  const [actionBy, setActionBy] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/approvals", { status: filterStatus });
      setApprovals(data.approvals || []);
    } catch {
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleAction = async () => {
    if (!actionModal) return;
    const { approval, action } = actionModal;

    const path = getApprovalPath(approval);

    setSubmitting(true);
    try {
      await api.post(path, { action, action_by: actionBy, reason: actionReason });
      setActionModal(null);
      setActionBy("");
      setActionReason("");
      fetchApprovals();
    } catch (e) {
      alert(e.body?.error || e.message || "Action failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-end">
        <button
          onClick={fetchApprovals}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-(--ui-muted-surface)"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 border-b">
        {Object.entries(STATUS_LABELS).map(([status, { label }]) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filterStatus === status
                ? "border-(--ui-focus) text-(--ui-link)"
                : "border-transparent text-(--ui-text-muted) hover:text-(--ui-text)"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-(--ui-text-muted)">Loading...</div>
      ) : approvals.length === 0 ? (
        <div className="text-center py-12 text-(--ui-text-muted)">
          <Clock size={40} className="mx-auto mb-3 opacity-40" />
          <p>No {STATUS_LABELS[filterStatus]?.label.toLowerCase()} approvals found</p>
        </div>
      ) : (
        <div className="bg-(--ui-surface) border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-(--ui-muted-surface) border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-(--ui-text-muted)">Type</th>
                <th className="px-4 py-3 text-left font-medium text-(--ui-text-muted)">Reference ID</th>
                <th className="px-4 py-3 text-left font-medium text-(--ui-text-muted)">Requested By</th>
                <th className="px-4 py-3 text-left font-medium text-(--ui-text-muted)">Notes</th>
                <th className="px-4 py-3 text-left font-medium text-(--ui-text-muted)">Submitted</th>
                <th className="px-4 py-3 text-left font-medium text-(--ui-text-muted)">Status</th>
                {filterStatus === "pending_approval" && (
                  <th className="px-4 py-3 text-left font-medium text-(--ui-text-muted)">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {approvals.map((ap) => {
                const statusInfo = STATUS_LABELS[ap.status] || STATUS_LABELS.pending_approval;
                return (
                  <tr key={ap.id} className="hover:bg-(--ui-muted-surface)">
                    <td className="px-4 py-3 font-medium">
                      {TYPE_LABELS[ap.request_type] || ap.request_type}
                    </td>
                    <td className="px-4 py-3 text-(--ui-text-muted)">#{ap.reference_id}</td>
                    <td className="px-4 py-3 text-(--ui-text-muted)">{ap.requested_by || "—"}</td>
                    <td className="px-4 py-3 text-(--ui-text-muted) max-w-xs truncate">
                      {formatApprovalNotes(ap)}
                    </td>
                    <td className="px-4 py-3 text-(--ui-text-muted)">
                      {fmtDateTime(ap.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    {filterStatus === "pending_approval" && (
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setActionModal({ approval: ap, action: "approved" })}
                            className="flex items-center gap-1 px-3 py-1 bg-(--ui-success-fg) text-(--ui-on-primary) rounded text-xs hover:bg-(--ui-success-fg)"
                          >
                            <CheckCircle size={12} /> Approve
                          </button>
                          <button
                            onClick={() => setActionModal({ approval: ap, action: "rejected" })}
                            className="flex items-center gap-1 px-3 py-1 bg-(--ui-danger-fg) text-(--ui-on-primary) rounded text-xs hover:bg-(--ui-danger-fg)"
                          >
                            <XCircle size={12} /> Reject
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Action confirmation modal */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-(--ui-surface) rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold">
              {actionModal.action === "approved" ? "Approve" : "Reject"}{" "}
              {TYPE_LABELS[actionModal.approval.request_type]} #{actionModal.approval.reference_id}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-(--ui-text) mb-1">
                  Manager / Approver Name
                </label>
                <input
                  type="text"
                  value={actionBy}
                  onChange={(e) => setActionBy(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-(--ui-text) mb-1">
                  Reason / Notes {actionModal.action === "rejected" && <span className="text-(--ui-danger-fg)">*</span>}
                </label>
                <textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  rows={3}
                  placeholder="Optional reason..."
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => { setActionModal(null); setActionBy(""); setActionReason(""); }}
                className="px-4 py-2 border rounded-lg text-sm hover:bg-(--ui-muted-surface)"
              >
                Cancel
              </button>
              <button
                onClick={handleAction}
                disabled={submitting || (actionModal.action === "rejected" && !actionReason.trim())}
                className={`px-4 py-2 rounded-lg text-sm text-(--ui-on-primary) font-medium disabled:opacity-50 ${
                  actionModal.action === "approved"
                    ? "bg-(--ui-success-fg) hover:bg-(--ui-success-fg)"
                    : "bg-(--ui-danger-fg) hover:bg-(--ui-danger-fg)"
                }`}
              >
                {submitting ? "Processing..." : actionModal.action === "approved" ? "Confirm Approve" : "Confirm Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
