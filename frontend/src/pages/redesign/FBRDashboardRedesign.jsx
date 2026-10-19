import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Eye, RotateCcw, AlertCircle } from "lucide-react";
import { api } from "../../api";
import { PageShell, SectionCard, Button, Input, Select, Modal, ModalFooter } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { fmtUtcDateTime } from "../../utils/dates";

const STATUS_DOTS = {
  posted: "bg-(--ui-success-fg)",
  pending: "bg-(--ui-warning-fg)",
  processing: "bg-(--ui-warning-fg)",
  failed: "bg-(--ui-danger-fg)",
  not_applicable: "bg-(--ui-text-muted)",
};

const STATUS_LABELS = {
  posted: "Posted",
  pending: "Pending",
  processing: "Processing",
  failed: "Failed",
  not_applicable: "N/A",
};

const LIMIT = 50;
const REFRESH_INTERVAL = 30000;

export default function FBRDashboardRedesign() {
  const { success, error: showError } = useToast();
  const { fmt } = useCurrency();

  // Summary
  const [summary, setSummary] = useState(null);

  // Filters
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  // Table
  const [invoices, setInvoices] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState({});
  const [retryingAll, setRetryingAll] = useState(false);

  // Modal
  const [payloadInvoice, setPayloadInvoice] = useState(null);

  // Auto-refresh
  const intervalRef = useRef(null);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await api.get("/api/fbr/dashboard");
      setSummary(data);
    } catch {
      // silent — summary is non-critical
    }
  }, []);

  const fetchInvoices = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (status !== "all") params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (search.trim()) params.set("search", search.trim());
      const data = await api.get(`/api/fbr/invoices?${params}`);
      setInvoices(data.invoices || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, status, from, to, search]);

  const refresh = useCallback(() => {
    fetchSummary();
    fetchInvoices();
  }, [fetchSummary, fetchInvoices]);

  // Initial load + filter/page changes
  useEffect(() => {
    setLoading(true);
    fetchSummary();
    fetchInvoices();
  }, [fetchSummary, fetchInvoices]);

  // Auto-refresh every 30s
  useEffect(() => {
    intervalRef.current = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [refresh]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [status, from, to, search]);

  const handleRetry = async (id) => {
    setRetrying((prev) => ({ ...prev, [id]: true }));
    try {
      await api.post(`/api/fbr/invoices/${id}/retry`);
      success("Invoice queued for retry");
      refresh();
    } catch (err) {
      showError(err.body?.error || err.message);
    } finally {
      setRetrying((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleRetryAll = async () => {
    setRetryingAll(true);
    try {
      const data = await api.post("/api/fbr/invoices/retry-all");
      success(`Retrying ${data.count ?? "all"} failed invoices`);
      refresh();
    } catch (err) {
      showError(err.body?.error || err.message);
    } finally {
      setRetryingAll(false);
    }
  };

  // --- Render ---

  const summaryCards = [
    { label: "Posted Today", value: summary?.posted_today ?? "-", color: "text-(--ui-success-fg)" },
    { label: "Pending", value: summary?.pending ?? "-", color: "text-(--ui-warning-fg)" },
    { label: "Failed", value: summary?.failed ?? "-", color: "text-(--ui-danger-fg)" },
    { label: "Total", value: summary?.total ?? "-", color: "text-(--ui-text)" },
  ];

  return (
    <PageShell
      title="FBR Invoices"
      right={
        <Button size="sm" onClick={refresh} className="gap-1.5 inline-flex items-center">
          <RefreshCw size={14} /> Refresh
        </Button>
      }
    >
      {/* Summary Cards */}
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {summaryCards.map((c) => (
          <SectionCard key={c.label} className="p-4">
            <p className="text-xs font-medium text-(--ui-text-muted)">{c.label}</p>
            <p className={`mt-1 text-2xl font-bold ${c.color}`}>{c.value}</p>
          </SectionCard>
        ))}
      </div>

      {/* Filters */}
      <SectionCard className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[140px]">
            <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">Status</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="posted">Posted</option>
              <option value="failed">Failed</option>
            </Select>
          </div>
          <div className="min-w-[140px]">
            <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="min-w-[140px]">
            <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="min-w-[200px] grow">
            <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">Search Invoice #</label>
            <Input
              type="text"
              placeholder="e.g. INV-261019-001"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {(summary?.failed ?? 0) > 0 && (
            <Button
              tone="danger"
              size="sm"
              disabled={retryingAll}
              onClick={handleRetryAll}
              className="gap-1.5 inline-flex items-center shrink-0"
            >
              <RotateCcw size={14} className={retryingAll ? "animate-spin" : ""} />
              {retryingAll ? "Retrying..." : "Retry All Failed"}
            </Button>
          )}
        </div>
      </SectionCard>

      {/* Invoice Table */}
      <SectionCard className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
              <th className="whitespace-nowrap px-4 py-3 font-medium">Invoice #</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">Date</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium text-right">Amount</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">Type</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">FBR Status</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">FBR IRN</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium text-right">Retries</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-(--ui-text-muted)">
                  Loading...
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-(--ui-text-muted)">
                  No invoices found.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className="border-b border-(--ui-border) last:border-0 hover:bg-(--ui-muted-surface) transition-colors"
                >
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-(--ui-text)">
                    {inv.invoice_number}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-(--ui-text-muted)">
                    {fmtUtcDateTime(inv.created_at)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-(--ui-text)">
                    {fmt(inv.amount)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="inline-block rounded-full bg-(--ui-muted-surface) px-2 py-0.5 text-xs font-medium text-(--ui-text) capitalize">
                      {inv.type || "sale"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOTS[inv.fbr_status] || STATUS_DOTS.not_applicable}`}
                      />
                      <span className="text-(--ui-text)">
                        {STATUS_LABELS[inv.fbr_status] || inv.fbr_status || "N/A"}
                      </span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-(--ui-text-muted)">
                    {inv.fbr_irn || "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-(--ui-text-muted)">
                    {inv.retry_count ?? 0}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        title="View Payload"
                        onClick={() => setPayloadInvoice(inv)}
                        className="rounded p-1 text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text) transition-colors"
                      >
                        <Eye size={15} />
                      </button>
                      {inv.fbr_status === "failed" && (
                        <button
                          title="Retry"
                          disabled={retrying[inv.id]}
                          onClick={() => handleRetry(inv.id)}
                          className="rounded p-1 text-(--ui-danger-fg) hover:bg-(--ui-danger-bg) transition-colors disabled:opacity-50"
                        >
                          <RotateCcw size={15} className={retrying[inv.id] ? "animate-spin" : ""} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-(--ui-border) px-4 py-3">
            <p className="text-xs text-(--ui-text-muted)">
              Page {page} of {pages} ({total} total)
            </p>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </SectionCard>

      <Modal
        open={!!payloadInvoice}
        onClose={() => setPayloadInvoice(null)}
        title={payloadInvoice ? `Payload — ${payloadInvoice.invoice_number}` : "Payload"}
        size="lg"
      >
        {payloadInvoice ? (
          <>
            <div className="max-h-[60vh] overflow-auto">
              {payloadInvoice.payload ? (
                <pre className="whitespace-pre-wrap break-words rounded-(--ui-radius-sm) bg-(--ui-muted-surface) p-4 font-mono text-xs text-(--ui-text)">
                  {JSON.stringify(payloadInvoice.payload, null, 2)}
                </pre>
              ) : (
                <div className="flex items-center gap-2 text-sm text-(--ui-text-muted)">
                  <AlertCircle size={16} /> No payload data available.
                </div>
              )}
            </div>
            <ModalFooter>
              <Button size="sm" onClick={() => setPayloadInvoice(null)}>Close</Button>
            </ModalFooter>
          </>
        ) : null}
      </Modal>
    </PageShell>
  );
}
