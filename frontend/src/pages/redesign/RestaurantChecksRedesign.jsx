import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge } from "../../ui/primitives";
import { Receipt, Split, Flame, X } from "lucide-react";
import { api } from "../../api";

const STATUS_TONES = { open: "warning", split: "warning", closed: "success", voided: "danger" };

export default function RestaurantChecksRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSplit, setShowSplit] = useState(null);
  const [splitMode, setSplitMode] = useState("equal"); // equal | by_seat | by_item
  const [splitCount, setSplitCount] = useState(2);

  if (!flagsLoading && !flags.phase4_restaurant) return <Navigate to="/dashboard" replace />;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/restaurant/checks?status=open");
      setChecks(data.checks || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fireCourse = async (checkId, course) => {
    try {
      await api.post(`/restaurant/checks/${checkId}/fire-course`, { course_number: course });
      toast.success(`Course ${course} fired`);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const splitCheck = async (checkId) => {
    try {
      await api.post(`/restaurant/checks/${checkId}/split`, { mode: splitMode, split_count: splitCount });
      toast.success("Check split");
      setShowSplit(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const closeCheck = async (checkId) => {
    try {
      await api.put(`/restaurant/checks/${checkId}`, { status: "closed" });
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
                        <button onClick={() => { setShowSplit(c); setSplitMode("equal"); setSplitCount(2); }} title="Split check" className="p-1 rounded hover:bg-(--ui-bg-hover)">
                          <Split className="w-4 h-4" />
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

      {showSplit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSplit(null)}>
          <div className="bg-(--ui-bg) rounded-lg shadow-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Split Check #{showSplit.check_number || showSplit.id}</h2>
              <button onClick={() => setShowSplit(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Split Mode</label>
                <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={splitMode} onChange={e => setSplitMode(e.target.value)}>
                  <option value="equal">Equal Split</option>
                  <option value="by_seat">By Seat</option>
                  <option value="by_item">By Item</option>
                </select>
              </div>
              {splitMode === "equal" && (
                <div>
                  <label className="block text-sm font-medium mb-1">Number of Splits</label>
                  <input type="number" min="2" max="20" className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={splitCount} onChange={e => setSplitCount(Number(e.target.value))} />
                  <p className="text-xs text-(--ui-text-muted) mt-1">{fmt((showSplit.total || 0) / splitCount)} per split</p>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button tone="plain" onClick={() => setShowSplit(null)}>Cancel</Button>
                <Button onClick={() => splitCheck(showSplit.id)}>Split</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
