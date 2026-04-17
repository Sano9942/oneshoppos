import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { readContext } from "../../auth/authStore";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Input } from "../../ui/primitives";
import { useCurrency } from "../../contexts/CurrencyContext";
import { fmtUtcDateTime } from "../../utils/dates";
import { Inbox, Check, X } from "lucide-react";
import { api } from "../../api";

const SOURCES = ["all", "shopify", "daraz", "whatsapp", "facebook", "qr"];

/**
 * Phase 2.1 B2 — Online ordering inbox.
 *
 * Unified queue of unaccepted web_orders from external channels. Managers
 * accept → order enters restaurant kitchen flow via sendToKitchen, or reject
 * with a reason. 10s polling keeps the list current.
 */
export default function RestaurantInboxRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("all");
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  // Hooks must stay above the Navigate early-return.
  const load = useCallback(async () => {
    const ctx = readContext();
    const outletId = ctx?.active_outlet_id;
    try {
      const qs = new URLSearchParams();
      if (outletId) qs.set("outlet_id", outletId);
      if (source !== "all") qs.set("source", source);
      const data = await api.get(`/api/restaurant/inbox?${qs.toString()}`);
      setOrders(data.orders || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [source, toast]);

  useEffect(() => { load(); }, [load]);

  // 10-second polling — external channels can push new orders any time.
  useEffect(() => {
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (!flagsLoading && !flags.phase4_restaurant) return <Navigate to="/dashboard" replace />;

  const accept = async (id) => {
    try {
      const res = await api.post(`/api/restaurant/inbox/${id}/accept`, { order_context: "online" });
      toast.success(`Accepted → draft #${res.draft_order_id} (${res.tickets?.length || 0} ticket(s))`);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const openReject = (id) => {
    setRejectingId(id);
    setRejectReason("");
  };

  const submitReject = async () => {
    if (!rejectReason.trim()) { toast.error("Reason is required"); return; }
    try {
      await api.post(`/api/restaurant/inbox/${rejectingId}/reject`, { reason: rejectReason.trim() });
      toast.success("Order rejected");
      setRejectingId(null);
      setRejectReason("");
      load();
    } catch (err) { toast.error(err.message); }
  };

  function sourceTone(src) {
    if (src === "whatsapp") return "success";
    if (src === "daraz") return "warning";
    if (src === "shopify") return "default";
    if (src === "facebook") return "default";
    return "default";
  }

  return (
    <PageShell title="Online Orders Inbox" subtitle="External orders waiting for kitchen acceptance">
      <div className="flex gap-2 mb-4 flex-wrap">
        {SOURCES.map((s) => (
          <Button
            key={s}
            size="sm"
            tone={source === s ? "primary" : "plain"}
            onClick={() => setSource(s)}
          >
            {s === "all" ? "All sources" : s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-(--ui-text-muted) text-center py-8">Loading...</p>
      ) : orders.length === 0 ? (
        <SectionCard>
          <div className="text-center py-12">
            <Inbox className="w-10 h-10 mx-auto text-(--ui-text-muted) mb-3" />
            <p className="text-(--ui-text-muted)">No pending orders</p>
            <p className="text-xs text-(--ui-text-muted) mt-1">Polling every 10 seconds…</p>
          </div>
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {orders.map((o) => (
            <SectionCard key={o.id}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <Badge tone={sourceTone(o.source)}>{o.source}</Badge>
                  <span className="ml-2 font-semibold text-sm">{o.external_order_number || `#${o.id}`}</span>
                </div>
                <span className="text-xs text-(--ui-text-muted)">
                  {o.ordered_at ? fmtUtcDateTime(o.ordered_at) : "—"}
                </span>
              </div>

              <div className="text-sm text-(--ui-text-muted) mb-2">
                {o.customer_name_snapshot || "Guest"} · {o.customer_phone_snapshot || "no phone"}
              </div>

              <div className="border-t border-(--ui-border) py-2 space-y-1">
                {(o.items || []).map((it) => (
                  <div key={it.id} className="text-sm flex justify-between">
                    <span>{it.qty}× {it.title || it.sku || `Product #${it.product_id || "?"}`}</span>
                    <span className="text-(--ui-text-muted)">{fmt(Number(it.line_total || 0))}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center mt-2 pt-2 border-t border-(--ui-border)">
                <span className="font-semibold">{fmt(Number(o.grand_total || 0))}</span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => accept(o.id)}>
                    <Check className="w-4 h-4 mr-1" /> Accept
                  </Button>
                  <Button size="sm" tone="danger" onClick={() => openReject(o.id)}>
                    <X className="w-4 h-4 mr-1" /> Reject
                  </Button>
                </div>
              </div>

              {rejectingId === o.id && (
                <div className="mt-3 pt-3 border-t border-(--ui-border) space-y-2">
                  <Input
                    placeholder="Reason for rejection"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" tone="plain" onClick={() => setRejectingId(null)}>Cancel</Button>
                    <Button size="sm" tone="danger" onClick={submitReject}>Confirm Reject</Button>
                  </div>
                </div>
              )}
            </SectionCard>
          ))}
        </div>
      )}
    </PageShell>
  );
}
