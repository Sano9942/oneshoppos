import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import {
  PageShell,
  SectionCard,
  Button,
  Badge,
  Modal,
  ModalFooter,
  TabBar,
} from "../../ui/primitives";
import { Plus, Lock, Banknote, RotateCcw } from "lucide-react";
import { fmtUtcDateTime, todayLocalStr } from "../../utils/dates";
import { downloadCsv } from "../../utils/csvExport";
import { api } from "../../api";

const STATUS_TONES = {
  open: "warning",
  closed: "default",
  distributed: "success",
  voided: "danger",
};

const STRATEGY_LABELS = {
  equal_share: "Equal share",
  hours_weighted: "Hours weighted",
  role_weighted: "Role weighted",
  points: "Points-based",
};

export default function TipPoolsRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [tab, setTab] = useState("pools");
  const [pools, setPools] = useState([]);
  const [rules, setRules] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [payoutSummary, setPayoutSummary] = useState({});
  const [loading, setLoading] = useState(true);

  // Open pool form
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openForm, setOpenForm] = useState({
    outlet_id: 1,
    business_date: todayLocalStr(),
  });

  // Distribute modal
  const [distributePool, setDistributePool] = useState(null);
  const [distributeRuleId, setDistributeRuleId] = useState("");

  // Rule form
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({
    outlet_id: 1,
    name: "",
    strategy: "hours_weighted",
    is_default: false,
    config_jsonb: {},
  });

  const loadAll = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get("/api/tips/pools").catch(() => ({ pools: [] })),
      api.get("/api/tips/distribution-rules").catch(() => ({ rules: [] })),
      api.get("/api/tips/payouts").catch(() => ({ payouts: [], summary: {} })),
    ]).then(([p, r, py]) => {
      setPools(p.pools || []);
      setRules(r.rules || []);
      setPayouts(py.payouts || []);
      setPayoutSummary(py.summary || {});
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (flagsLoading) return null;
  if (!flags.phase4_restaurant) return <Navigate to="/" replace />;
  if (!hasPerm("manage_tips")) return <Navigate to="/" replace />;

  // ── Pool actions ──────────────────────────────────────────────────────────

  const handleOpen = async () => {
    try {
      await api.post("/api/tips/pools", openForm);
      toast.success("Pool opened");
      setShowOpenModal(false);
      loadAll();
    } catch (err) {
      toast.error(err.message || "Could not open pool");
    }
  };

  const handleClose = async (pool) => {
    if (!window.confirm(`Close pool for ${pool.business_date}? This will lock all tips into the pool.`)) return;
    try {
      await api.post(`/api/tips/pools/${pool.id}/close`, {});
      toast.success("Pool closed");
      loadAll();
    } catch (err) {
      toast.error(err.message || "Could not close pool");
    }
  };

  const openDistribute = (pool) => {
    setDistributePool(pool);
    const def = rules.find((r) => r.is_default && r.outlet_id === pool.outlet_id);
    setDistributeRuleId(def?.id ? String(def.id) : "");
  };

  const handleDistribute = async () => {
    try {
      const body = distributeRuleId ? { rule_id: Number(distributeRuleId) } : {};
      const res = await api.post(`/api/tips/pools/${distributePool.id}/distribute`, body);
      toast.success(`Distributed across ${res.payouts?.length || 0} employees`);
      setDistributePool(null);
      loadAll();
    } catch (err) {
      toast.error(err.message || "Distribution failed");
    }
  };

  const handleVoid = async (pool) => {
    const reason = window.prompt("Reason for voiding this pool?");
    if (!reason) return;
    try {
      await api.post(`/api/tips/pools/${pool.id}/void`, { reason });
      toast.success("Pool voided");
      loadAll();
    } catch (err) {
      toast.error(err.message || "Void failed");
    }
  };

  // ── Rule actions ──────────────────────────────────────────────────────────

  const openRuleCreate = () => {
    setEditingRule(null);
    setRuleForm({ outlet_id: 1, name: "", strategy: "hours_weighted", is_default: false, config_jsonb: {} });
    setShowRuleModal(true);
  };

  const openRuleEdit = (rule) => {
    setEditingRule(rule);
    setRuleForm({
      outlet_id: rule.outlet_id,
      name: rule.name,
      strategy: rule.strategy,
      is_default: !!rule.is_default,
      config_jsonb: rule.config_jsonb || {},
    });
    setShowRuleModal(true);
  };

  const handleRuleSave = async () => {
    try {
      if (editingRule) {
        await api.put(`/api/tips/distribution-rules/${editingRule.id}`, ruleForm);
        toast.success("Rule updated");
      } else {
        await api.post("/api/tips/distribution-rules", ruleForm);
        toast.success("Rule created");
      }
      setShowRuleModal(false);
      loadAll();
    } catch (err) {
      toast.error(err.message || "Save failed");
    }
  };

  // ── Payout export ─────────────────────────────────────────────────────────

  const handlePayoutExport = () => {
    const headers = ["Date", "Employee", "Hours", "Weight", "Payout", "Paid", "Pool"];
    const rows = payouts.map((p) => [
      p.business_date,
      p.employee_name,
      Number(p.hours_worked).toFixed(2),
      Number(p.weight).toFixed(2),
      Number(p.payout_amount).toFixed(2),
      p.paid_at ? "Yes" : "No",
      p.pool_id,
    ]);
    downloadCsv(headers, rows, "tip-payouts.csv");
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageShell
      title="Tip Pools"
      subtitle="Daily tip pools, distribution rules, and payout reports"
      right={
        tab === "pools" ? (
          <Button onClick={() => setShowOpenModal(true)} tone="primary">
            <Plus size={14} /> Open Pool
          </Button>
        ) : tab === "rules" ? (
          <Button onClick={openRuleCreate} tone="primary">
            <Plus size={14} /> New Rule
          </Button>
        ) : null
      }
    >
      <TabBar
        tabs={[
          { value: "pools", label: "Pools" },
          { value: "rules", label: "Distribution Rules" },
          { value: "payouts", label: "Payouts" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {loading && <p className="text-(--ui-muted) text-sm py-4">Loading…</p>}

      {!loading && tab === "pools" && (
        <SectionCard>
          {pools.length === 0 ? (
            <p className="text-(--ui-muted) text-sm py-6 text-center">No tip pools yet. Open one to start.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-muted)">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Outlet</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Tips</th>
                  <th className="py-2 font-medium">Captures</th>
                  <th className="py-2 font-medium">Payouts</th>
                  <th className="py-2 font-medium">Closed by</th>
                  <th className="py-2 font-medium">Closed at</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((p) => (
                  <tr key={p.id} className="border-b border-(--ui-border)">
                    <td className="py-2 text-(--ui-text)">{p.business_date}</td>
                    <td className="py-2">#{p.outlet_id}</td>
                    <td className="py-2"><Badge tone={STATUS_TONES[p.status]}>{p.status}</Badge></td>
                    <td className="py-2 font-medium">{fmt(Number(p.total_tips))}</td>
                    <td className="py-2">{p.capture_count}</td>
                    <td className="py-2">{p.payout_count}</td>
                    <td className="py-2 text-(--ui-muted)">{p.closed_by_name || "-"}</td>
                    <td className="py-2 text-(--ui-muted)">{p.closed_at ? fmtUtcDateTime(p.closed_at) : "-"}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {p.status === "open" && (
                        <Button onClick={() => handleClose(p)} tone="default" className="py-1! px-2! text-xs">
                          <Lock size={12} /> Close
                        </Button>
                      )}
                      {p.status === "closed" && (
                        <>
                          <Button onClick={() => openDistribute(p)} tone="primary" className="py-1! px-2! text-xs mr-1">
                            <Banknote size={12} /> Distribute
                          </Button>
                          <Button onClick={() => handleVoid(p)} tone="plain" className="py-1! px-2! text-xs">
                            <RotateCcw size={12} /> Void
                          </Button>
                        </>
                      )}
                      {p.status === "distributed" && (
                        <Button onClick={() => handleVoid(p)} tone="plain" className="py-1! px-2! text-xs">
                          <RotateCcw size={12} /> Void
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {!loading && tab === "rules" && (
        <SectionCard>
          {rules.length === 0 ? (
            <p className="text-(--ui-muted) text-sm py-6 text-center">No distribution rules. Create one to enable pool distribution.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-muted)">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Outlet</th>
                  <th className="py-2 font-medium">Strategy</th>
                  <th className="py-2 font-medium">Default</th>
                  <th className="py-2 font-medium">Active</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b border-(--ui-border)">
                    <td className="py-2 text-(--ui-text)">{r.name}</td>
                    <td className="py-2">#{r.outlet_id || "—"}</td>
                    <td className="py-2">{STRATEGY_LABELS[r.strategy] || r.strategy}</td>
                    <td className="py-2">{r.is_default ? <Badge tone="success">default</Badge> : "-"}</td>
                    <td className="py-2">{r.is_active ? "Yes" : "No"}</td>
                    <td className="py-2 text-right">
                      <Button onClick={() => openRuleEdit(r)} tone="plain" className="py-1! px-2! text-xs">
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {!loading && tab === "payouts" && (
        <SectionCard>
          <div className="flex gap-4 flex-wrap mb-4">
            <div className="bg-(--ui-bg) border border-(--ui-border) rounded px-4 py-2 text-center">
              <p className="text-xs text-(--ui-muted)">Total payouts</p>
              <p className="font-semibold">{payoutSummary.total_payouts || 0}</p>
            </div>
            <div className="bg-(--ui-bg) border border-(--ui-border) rounded px-4 py-2 text-center">
              <p className="text-xs text-(--ui-muted)">Total amount</p>
              <p className="font-semibold">{fmt(Number(payoutSummary.total_amount || 0))}</p>
            </div>
            <div className="bg-(--ui-bg) border border-(--ui-border) rounded px-4 py-2 text-center">
              <p className="text-xs text-(--ui-muted)">Unpaid</p>
              <p className="font-semibold text-yellow-600">{fmt(Number(payoutSummary.unpaid_amount || 0))}</p>
            </div>
            <div className="ml-auto">
              <Button onClick={handlePayoutExport} tone="default">Export CSV</Button>
            </div>
          </div>

          {payouts.length === 0 ? (
            <p className="text-(--ui-muted) text-sm py-6 text-center">No payouts yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-muted)">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Employee</th>
                  <th className="py-2 font-medium">Hours</th>
                  <th className="py-2 font-medium">Weight</th>
                  <th className="py-2 font-medium">Payout</th>
                  <th className="py-2 font-medium">Paid</th>
                  <th className="py-2 font-medium">Pool</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-(--ui-border)">
                    <td className="py-2">{p.business_date}</td>
                    <td className="py-2 text-(--ui-text)">{p.employee_name}</td>
                    <td className="py-2">{Number(p.hours_worked).toFixed(2)}</td>
                    <td className="py-2">{Number(p.weight).toFixed(2)}</td>
                    <td className="py-2 font-medium">{fmt(Number(p.payout_amount))}</td>
                    <td className="py-2">{p.paid_at ? <Badge tone="success">paid</Badge> : <Badge tone="warning">unpaid</Badge>}</td>
                    <td className="py-2 text-(--ui-muted)">#{p.pool_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {/* Open pool modal */}
      {showOpenModal && (
        <Modal open={showOpenModal} title="Open Tip Pool" onClose={() => setShowOpenModal(false)}>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm text-(--ui-muted)">Outlet ID</span>
              <input
                type="number"
                value={openForm.outlet_id}
                onChange={(e) => setOpenForm({ ...openForm, outlet_id: Number(e.target.value) })}
                className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) text-(--ui-text)"
              />
            </label>
            <label className="block">
              <span className="text-sm text-(--ui-muted)">Business date</span>
              <input
                type="date"
                value={openForm.business_date}
                onChange={(e) => setOpenForm({ ...openForm, business_date: e.target.value })}
                className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) text-(--ui-text)"
              />
            </label>
          </div>
          <ModalFooter>
            <Button tone="plain" onClick={() => setShowOpenModal(false)}>Cancel</Button>
            <Button tone="primary" onClick={handleOpen}>Open Pool</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Distribute modal */}
      {distributePool && (
        <Modal open={!!distributePool} title={`Distribute pool — ${distributePool.business_date}`} onClose={() => setDistributePool(null)}>
          <div className="space-y-3">
            <p className="text-sm text-(--ui-muted)">
              Total tips: <span className="font-semibold text-(--ui-text)">{fmt(Number(distributePool.total_tips))}</span>
            </p>
            <label className="block">
              <span className="text-sm text-(--ui-muted)">Distribution rule</span>
              <select
                value={distributeRuleId}
                onChange={(e) => setDistributeRuleId(e.target.value)}
                className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) text-(--ui-text)"
              >
                <option value="">(use outlet default)</option>
                {rules
                  .filter((r) => r.outlet_id === distributePool.outlet_id || r.outlet_id == null)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} — {STRATEGY_LABELS[r.strategy] || r.strategy}
                    </option>
                  ))}
              </select>
            </label>
            <p className="text-xs text-(--ui-muted)">
              Once distributed, payouts are recorded as commission earnings (type: tip) for payroll.
            </p>
          </div>
          <ModalFooter>
            <Button tone="plain" onClick={() => setDistributePool(null)}>Cancel</Button>
            <Button tone="primary" onClick={handleDistribute}>Distribute</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Rule modal */}
      {showRuleModal && (
        <Modal open={showRuleModal} title={editingRule ? "Edit Distribution Rule" : "New Distribution Rule"} onClose={() => setShowRuleModal(false)}>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm text-(--ui-muted)">Name</span>
              <input
                type="text"
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) text-(--ui-text)"
              />
            </label>
            <label className="block">
              <span className="text-sm text-(--ui-muted)">Outlet ID</span>
              <input
                type="number"
                value={ruleForm.outlet_id || ""}
                onChange={(e) => setRuleForm({ ...ruleForm, outlet_id: Number(e.target.value) })}
                className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) text-(--ui-text)"
              />
            </label>
            <label className="block">
              <span className="text-sm text-(--ui-muted)">Strategy</span>
              <select
                value={ruleForm.strategy}
                onChange={(e) => setRuleForm({ ...ruleForm, strategy: e.target.value })}
                className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) text-(--ui-text)"
              >
                {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ruleForm.is_default}
                onChange={(e) => setRuleForm({ ...ruleForm, is_default: e.target.checked })}
              />
              Default rule for this outlet
            </label>
            {(ruleForm.strategy === "role_weighted" || ruleForm.strategy === "points") && (
              <label className="block">
                <span className="text-sm text-(--ui-muted)">
                  Config JSON ({ruleForm.strategy === "role_weighted" ? "{ role_weights: { server: 1.0, busser: 0.5 } }" : "{ points: { 4: 10, 5: 5 } }"})
                </span>
                <textarea
                  rows={4}
                  value={JSON.stringify(ruleForm.config_jsonb || {}, null, 2)}
                  onChange={(e) => {
                    try { setRuleForm({ ...ruleForm, config_jsonb: JSON.parse(e.target.value) }); }
                    catch { /* ignore parse errors until valid */ }
                  }}
                  className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) text-(--ui-text) font-mono text-xs"
                />
              </label>
            )}
          </div>
          <ModalFooter>
            <Button tone="plain" onClick={() => setShowRuleModal(false)}>Cancel</Button>
            <Button tone="primary" onClick={handleRuleSave}>Save</Button>
          </ModalFooter>
        </Modal>
      )}
    </PageShell>
  );
}
