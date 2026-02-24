import { useState, useEffect, useCallback } from "react";
import { CheckCircle, XCircle, Clock, RefreshCw } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";

const API = "http://localhost:5000/api";

const STATUS_LABELS = {
  pending_approval: { label: "Pending", color: "bg-yellow-100 text-yellow-800" },
  approved: { label: "Approved", color: "bg-green-100 text-green-800" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800" },
};

const TYPE_LABELS = {
  po_approval: "Purchase Order",
  str_approval: "Stock Transfer",
  reconciliation_fix: "Inventory Reconciliation",
};

function getApprovalEndpoint(approval) {
  if (approval.reference_type === "purchase_order") {
    return `${API}/purchase-orders/${approval.reference_id}/approve`;
  }
  if (approval.reference_type === "reconciliation") {
    return `${API}/reconciliation/inventory/${approval.reference_id}/approve-fix`;
  }
  return `${API}/transfers/${approval.reference_id}/approve`;
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
  const { authHeaders } = useAuth();
  const [approvals, setApprovals] = useState([]);
  const [filterStatus, setFilterStatus] = useState("pending_approval");
  const [loading, setLoading] = useState(false);
  const [actionModal, setActionModal] = useState(null); // { approval, action: 'approved'|'rejected' }
  const [actionBy, setActionBy] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const apiFetch = useCallback(
    (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      const merged = authHeaders();
      Object.entries(merged).forEach(([key, value]) => headers.set(key, value));
      return fetch(url, { ...options, headers });
    },
    [authHeaders],
  );

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API}/approvals?status=${filterStatus}`);
      const data = await res.json();
      setApprovals(data.approvals || []);
    } catch {
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, apiFetch]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleAction = async () => {
    if (!actionModal) return;
    const { approval, action } = actionModal;

    const endpoint = getApprovalEndpoint(approval);

    setSubmitting(true);
    try {
      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, action_by: actionBy, reason: actionReason }),
      });
      if (res.ok) {
        setActionModal(null);
        setActionBy("");
        setActionReason("");
        fetchApprovals();
      } else {
        const err = await res.json();
        alert(err.error || "Action failed");
      }
    } catch {
      alert("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approval Workflow</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review and approve purchase orders, stock transfers, and reconciliation fixes
          </p>
        </div>
        <button
          onClick={fetchApprovals}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
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
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : approvals.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Clock size={40} className="mx-auto mb-3 opacity-40" />
          <p>No {STATUS_LABELS[filterStatus]?.label.toLowerCase()} approvals found</p>
        </div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Reference ID</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Requested By</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Notes</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Submitted</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                {filterStatus === "pending_approval" && (
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {approvals.map((ap) => {
                const statusInfo = STATUS_LABELS[ap.status] || STATUS_LABELS.pending_approval;
                return (
                  <tr key={ap.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      {TYPE_LABELS[ap.request_type] || ap.request_type}
                    </td>
                    <td className="px-4 py-3 text-gray-600">#{ap.reference_id}</td>
                    <td className="px-4 py-3 text-gray-600">{ap.requested_by || "—"}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">
                      {formatApprovalNotes(ap)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(ap.created_at).toLocaleString()}
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
                            className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                          >
                            <CheckCircle size={12} /> Approve
                          </button>
                          <button
                            onClick={() => setActionModal({ approval: ap, action: "rejected" })}
                            className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold">
              {actionModal.action === "approved" ? "Approve" : "Reject"}{" "}
              {TYPE_LABELS[actionModal.approval.request_type]} #{actionModal.approval.reference_id}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason / Notes {actionModal.action === "rejected" && <span className="text-red-500">*</span>}
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
                className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAction}
                disabled={submitting || (actionModal.action === "rejected" && !actionReason.trim())}
                className={`px-4 py-2 rounded-lg text-sm text-white font-medium disabled:opacity-50 ${
                  actionModal.action === "approved"
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-red-600 hover:bg-red-700"
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
