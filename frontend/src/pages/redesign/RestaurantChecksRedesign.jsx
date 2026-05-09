import { useState, useEffect, useCallback } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { readContext } from "../../auth/authStore";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Modal, ModalFooter } from "../../ui/primitives";
import { Receipt, Split, Flame, Clock, Zap, X, CreditCard } from "lucide-react";
import { api } from "../../api";

const STATUS_TONES = { open: "warning", split: "warning", closed: "success", voided: "danger" };

export default function RestaurantChecksRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();
  const navigate = useNavigate();

  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSplit, setShowSplit] = useState(null);
  const [splitMode, setSplitMode] = useState("equal"); // equal | by_seat | by_item
  const [splitCount, setSplitCount] = useState(2);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/restaurant/checks");
      setChecks(data.checks || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!flagsLoading && !flags.phase4_restaurant) return <Navigate to="/dashboard" replace />;
  if (!readContext()?.active_outlet_id) return <Navigate to="/" replace />;

  const fireCourse = async (checkId, course) => {
    try {
      await api.post(`/api/restaurant/checks/${checkId}/fire-course`, { course_number: course });
      toast.success(`Course ${course} fired`);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const holdCourse = async (checkId) => {
    const courseName = window.prompt("Course name to hold? (e.g. dessert)");
    if (!courseName) return;
    const holdUntil = window.prompt("Hold until (ISO datetime, e.g. 2026-04-18T20:00:00Z):");
    if (!holdUntil) return;
    try {
      await api.post(`/api/restaurant/checks/${checkId}/courses/hold`, {
        course_name: courseName,
        hold_until: holdUntil,
      });
      toast.success(`Course "${courseName}" held until ${holdUntil}`);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const expediteCourse = async (checkId) => {
    const courseName = window.prompt("Course name to expedite? (e.g. appetizer)");
    if (!courseName) return;
    try {
      await api.post(`/api/restaurant/checks/${checkId}/courses/expedite`, {
        course_name: courseName,
      });
      toast.success(`Course "${courseName}" expedited`);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const splitCheck = async (checkId) => {
    try {
      // Map UI mode → backend split_type. "equal" → "evenly" so we get the
      // Phase 2.1 by-amount path (parts-based distribution); "by_amount" is
      // an alias that also requires parts.
      const body = { split_type: splitMode };
      if (splitMode === "equal" || splitMode === "evenly" || splitMode === "by_amount") {
        body.split_type = splitMode === "equal" ? "evenly" : splitMode;
        body.parts = splitCount;
      }
      await api.post(`/api/restaurant/checks/${checkId}/split`, body);
      toast.success("Check split");
      setShowSplit(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  // W23 — open this check in the POS check view to take payment + tip.
  // After SplitCheckModal completes, the parent draft is empty (items
  // moved to children); the children inherit table_session_id but POS
  // resolves the floor view to a single draft per session. This action
  // hands the cashier a per-row entry point so each child / open check
  // can be settled independently. POSRestaurantRedesign reads the state
  // and calls openCheck() on mount.
  const payCheck = (check) => {
    navigate("/pos/restaurant", {
      state: {
        resumeCheck: {
          draftOrderId: check.id,
          tableSessionId: check.table_session_id || null,
          tableLabel: check.table_label || null,
          orderContext: check.order_context || "dine_in",
          seatCount: check.seat_count || 0,
        },
      },
    });
  };

  // W22: send 'cancelled' to match the draft_orders.status CHECK constraint
  // (open|claimed|completed|cancelled|merged). The button is intended for
  // operational close-out (abandoned/zombie checks) — sale settlement uses
  // a different path that flips status='completed' transactionally.
  const closeCheck = async (checkId) => {
    try {
      await api.put(`/api/restaurant/checks/${checkId}`, { status: "cancelled" });
      toast.success("Check closed");
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <PageShell title="Open Checks" subtitle="Manage restaurant checks and split bills">
      <SectionCard>
        {loading ? <p className="text-(--ui-text-muted) text-center py-8">Loading...</p> :
          checks.length === 0 ? <p className="text-(--ui-text-muted) text-center py-8">No open checks</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-(--ui-border)">
                <th className="text-left py-2 px-3 font-medium">Check #</th>
                <th className="text-left py-2 px-3 font-medium">Table</th>
                <th className="text-left py-2 px-3 font-medium">Server</th>
                <th className="text-right py-2 px-3 font-medium">Items</th>
                <th className="text-right py-2 px-3 font-medium">Total</th>
                <th className="text-left py-2 px-3 font-medium">Status</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr></thead>
              <tbody>
                {checks.map(c => (
                  <tr key={c.id} className="border-b border-(--ui-border) hover:bg-(--ui-bg-hover)">
                    <td className="py-2 px-3 font-mono">{c.check_number || c.id}</td>
                    <td className="py-2 px-3">{c.table_label || "—"}</td>
                    <td className="py-2 px-3">{c.server_name || "—"}</td>
                    <td className="py-2 px-3 text-right">{c.item_count || 0}</td>
                    <td className="py-2 px-3 text-right font-medium">{fmt(c.total || 0)}</td>
                    <td className="py-2 px-3"><Badge tone={STATUS_TONES[c.status] || "default"}>{c.status}</Badge></td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex gap-1 justify-end">
                        {c.next_course && (
                          <button onClick={() => fireCourse(c.id, c.next_course)} title={`Fire course ${c.next_course}`} className="p-1 rounded hover:bg-(--ui-bg-hover)">
                            <Flame className="w-4 h-4 text-orange-500" />
                          </button>
                        )}
                        <button onClick={() => holdCourse(c.id)} title="Hold a course" className="p-1 rounded hover:bg-(--ui-bg-hover)">
                          <Clock className="w-4 h-4 text-blue-500" />
                        </button>
                        <button onClick={() => expediteCourse(c.id)} title="Expedite a course" className="p-1 rounded hover:bg-(--ui-bg-hover)">
                          <Zap className="w-4 h-4 text-red-500" />
                        </button>
                        <button onClick={() => { setShowSplit(c); setSplitMode("equal"); setSplitCount(2); }} title="Split check" className="p-1 rounded hover:bg-(--ui-bg-hover)">
                          <Split className="w-4 h-4" />
                        </button>
                        {/* W23 — pay this check via POS check view */}
                        <button onClick={() => payCheck(c)} title="Pay this check" className="p-1 rounded hover:bg-(--ui-bg-hover) text-emerald-600">
                          <CreditCard className="w-4 h-4" />
                        </button>
                        <button onClick={() => closeCheck(c.id)} title="Close check" className="p-1 rounded hover:bg-(--ui-bg-hover) text-red-500">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Modal
        open={!!showSplit}
        onClose={() => setShowSplit(null)}
        title={showSplit ? `Split Check #${showSplit.check_number || showSplit.id}` : "Split Check"}
        size="sm"
      >
        {showSplit ? (
          <>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Split Mode</label>
                <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={splitMode} onChange={e => setSplitMode(e.target.value)}>
                  <option value="equal">Even (N shares)</option>
                  <option value="by_amount">By Amount</option>
                  <option value="by_seat">By Seat</option>
                  <option value="by_item">By Item</option>
                </select>
              </div>
              {(splitMode === "equal" || splitMode === "by_amount" || splitMode === "evenly") && (
                <div>
                  <label className="mb-1 block text-sm font-medium">Number of Splits</label>
                  <input type="number" min="2" max="20" className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={splitCount} onChange={e => setSplitCount(Number(e.target.value))} />
                  <p className="mt-1 text-xs text-(--ui-text-muted)">{fmt((showSplit.total || 0) / splitCount)} per split</p>
                </div>
              )}
            </div>
            <ModalFooter>
              <Button tone="plain" onClick={() => setShowSplit(null)}>Cancel</Button>
              <Button onClick={() => splitCheck(showSplit.id)}>Split</Button>
            </ModalFooter>
          </>
        ) : null}
      </Modal>
    </PageShell>
  );
}
