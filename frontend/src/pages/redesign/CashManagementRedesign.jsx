import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";
import { API_BASE as API } from "../../config";
import { Calculator, Download, RefreshCw } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { fmtUtcDateTime } from "../../utils/dates";

const DENOMS = [5000, 1000, 500, 100, 50, 20, 10];

function money(v) {
  return `PKRs ${Number(v || 0).toFixed(2)}`;
}

const fmtDate = fmtUtcDateTime;

function exportCsv(rows) {
  if (!rows.length) return;
  const headers = [
    "opened_at",
    "closed_at",
    "outlet",
    "cashier",
    "opening_float",
    "expected_cash",
    "closing_cash",
    "variance",
    "status",
  ];
  const body = rows.map((s) =>
    [
      s.opened_at || "",
      s.closed_at || "",
      s.outlet_name || "",
      s.employee_name || "",
      s.opening_float || 0,
      s.expected_cash || 0,
      s.closing_cash || 0,
      s.variance || 0,
      s.status || "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[headers.join(","), ...body].join("\n")], {
    type: "text/csv",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cash_shifts_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function CashManagementRedesign() {
  const { hasPerm } = useAuth();
  const canViewAllOutlets = hasPerm("all_access");
  const [rows, setRows] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [varianceReasons, setVarianceReasons] = useState([]);
  const [selectedOutlet, setSelectedOutlet] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [openModal, setOpenModal] = useState(false);
  const [openForm, setOpenForm] = useState({ employee_id: "" });
  const [openingDenoms, setOpeningDenoms] = useState(
    DENOMS.map((d) => ({ denomination: d, count: 0 })),
  );

  const [closeModal, setCloseModal] = useState(false);
  const [closeNotes, setCloseNotes] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [varianceApprovedBy, setVarianceApprovedBy] = useState("");
  const [denoms, setDenoms] = useState(DENOMS.map((d) => ({ denomination: d, count: 0 })));
  const [closeResult, setCloseResult] = useState(null);
  const [denomDetail, setDenomDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [shiftRes, outRes, empRes, reasonRes] = await Promise.all([
        fetch(`${API}/api/shifts${selectedOutlet ? `?outlet_id=${selectedOutlet}` : ""}`),
        fetch(`${API}/api/outlets`),
        fetch(`${API}/api/employees`),
        fetch(`${API}/api/variance-reasons`),
      ]);
      const [shiftData, outData, empData, reasonData] = await Promise.all([
        shiftRes.json(),
        outRes.json(),
        empRes.json(),
        reasonRes.json(),
      ]);
      if (!shiftRes.ok) throw new Error(shiftData.error || "Failed to load shifts");
      setRows(shiftData.shifts || []);
      const outletList = outData.outlets || [];
      setOutlets(outletList);
      setEmployees(empData.employees || []);
      setVarianceReasons(reasonData.reasons || []);
      if (!selectedOutlet && outletList.length > 0 && !canViewAllOutlets) {
        setSelectedOutlet(String(outletList[0].id));
      }
    } catch (e) {
      setError(e.message || "Failed to load cash management data");
    } finally {
      setLoading(false);
    }
  }, [selectedOutlet, canViewAllOutlets]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeShift = useMemo(
    () => (selectedOutlet ? rows.find((r) => r.status === "open") || null : null),
    [rows, selectedOutlet],
  );

  const closingCash = useMemo(
    () => denoms.reduce((sum, d) => sum + d.denomination * Number(d.count || 0), 0),
    [denoms],
  );

  const openingCash = useMemo(
    () =>
      openingDenoms.reduce(
        (sum, d) => sum + d.denomination * Number(d.count || 0),
        0,
      ),
    [openingDenoms],
  );

  const kpis = useMemo(() => {
    return {
      totalSaleCash: rows.reduce((s, r) => s + Number(r.total_cash_sales || 0), 0),
      cashIn: rows.reduce((s, r) => s + Number(r.opening_float || 0), 0),
      cashInHand: rows.reduce((s, r) => s + Number(r.closing_cash || 0), 0),
      closedShifts: rows.filter((r) => r.status === "closed").length,
    };
  }, [rows]);

  const openShift = async (e) => {
    e.preventDefault();
    if (!selectedOutlet) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/shifts/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlet_id: Number(selectedOutlet),
          employee_id: openForm.employee_id ? Number(openForm.employee_id) : null,
          opening_float: Number(openingCash.toFixed(2)),
          denominations: openingDenoms.filter((d) => Number(d.count || 0) > 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to open shift");
      setOpenModal(false);
      setOpenForm({ employee_id: "" });
      setOpeningDenoms(DENOMS.map((d) => ({ denomination: d, count: 0 })));
      await loadData();
    } catch (e2) {
      setError(e2.message || "Failed to open shift");
    } finally {
      setBusy(false);
    }
  };

  const closeShift = async (e) => {
    e.preventDefault();
    if (!activeShift) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/shifts/${activeShift.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closing_cash: closingCash,
          notes: closeNotes || null,
          variance_reason: varianceReason || null,
          variance_approved_by: varianceApprovedBy || null,
          denominations: denoms.filter((d) => Number(d.count || 0) > 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to close shift");
      setCloseResult(data);
      await loadData();
    } catch (e2) {
      setError(e2.message || "Failed to close shift");
    } finally {
      setBusy(false);
    }
  };

  const loadDenominations = async (shift) => {
    if (shift.status !== "closed") return;
    try {
      const res = await fetch(`${API}/api/shifts/${shift.id}/denominations?stage=closing`);
      const data = await res.json();
      if (res.ok) setDenomDetail({ shift, rows: data.denominations || [] });
    } catch {
      setDenomDetail(null);
    }
  };

  return (
    <PageShell
      title="Cash Management"
      subtitle="Manage shift opening, close reconciliation, and cash variance."
      right={
        <div className="flex gap-2">
          <Button onClick={() => exportCsv(rows)}>
            <Download size={14} className="mr-1 inline" />
            Export CSV
          </Button>
          <Button onClick={loadData}>
            <RefreshCw size={14} className="mr-1 inline" />
            Refresh
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-4">
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Total Sale Cash</p><p className="text-xl font-semibold text-(--ui-text)">{money(kpis.totalSaleCash)}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Cash In</p><p className="text-xl font-semibold text-(--ui-text)">{money(kpis.cashIn)}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Cash In Hand</p><p className="text-xl font-semibold text-(--ui-text)">{money(kpis.cashInHand)}</p></SectionCard>
        <SectionCard className="p-3"><p className="text-xs text-(--ui-text-muted)">Closed Shifts</p><p className="text-xl font-semibold text-(--ui-text)">{kpis.closedShifts}</p></SectionCard>
      </div>

      <SectionCard className="mb-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-(--ui-text-muted)">Active Shift</p>
            {activeShift ? (
              <p className="text-sm font-semibold text-(--ui-text)">
                #{activeShift.id} | {activeShift.outlet_name} | Opened {fmtDate(activeShift.opened_at)}
              </p>
            ) : (
              <p className="text-sm text-(--ui-text-muted)">
                {canViewAllOutlets && !selectedOutlet
                  ? "Viewing all outlets. Select one outlet to open or close shifts."
                  : "No open shift in selected outlet."}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Select value={selectedOutlet} onChange={(e) => setSelectedOutlet(e.target.value)}>
              {canViewAllOutlets ? <option value="">All outlets</option> : null}
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
            {!activeShift ? (
              <Button
                tone="primary"
                disabled={!selectedOutlet}
                onClick={() => setOpenModal(true)}
              >
                Open Shift
              </Button>
            ) : (
              <Button tone="danger" onClick={() => setCloseModal(true)}>Close Shift</Button>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <TableToolbar
          left={<span className="text-sm text-(--ui-text-muted)">Shift History</span>}
          right={<span className="text-xs text-(--ui-text-muted)">{rows.length} rows</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">Opened</th>
                <th className="px-3 py-2 text-left">Closed</th>
                <th className="px-3 py-2 text-left">Outlet</th>
                <th className="px-3 py-2 text-left">Cashier</th>
                <th className="px-3 py-2 text-right">Opening</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Actual</th>
                <th className="px-3 py-2 text-right">Variance</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.map((r) => (
                <tr key={r.id} className="border-t border-(--ui-border)">
                  <td className="px-3 py-2 text-(--ui-text-muted)">{fmtDate(r.opened_at)}</td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">{fmtDate(r.closed_at)}</td>
                  <td className="px-3 py-2 text-(--ui-text)">{r.outlet_name}</td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">{r.employee_name || "Admin"}</td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">{money(r.opening_float)}</td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">{r.expected_cash == null ? "-" : money(r.expected_cash)}</td>
                  <td className="px-3 py-2 text-right">
                    {r.closing_cash == null ? (
                      <span className="text-(--ui-text-muted)">-</span>
                    ) : (
                      <button className="text-blue-700 hover:underline" onClick={() => loadDenominations(r)}>{money(r.closing_cash)}</button>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${Number(r.variance || 0) < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    {r.variance == null ? "-" : money(r.variance)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={r.status === "open" ? "success" : "default"}>{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading shifts...</div> : null}
          {!loading && rows.length === 0 ? <EmptyState title="No shifts" body="Open your first shift to start reconciliation." /> : null}
        </div>
      </SectionCard>

      {openModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">Open Shift</h3>
            <form className="mt-3 space-y-2" onSubmit={openShift}>
              <SectionCard className="p-3">
                <div className="mb-2 flex items-center gap-2 text-sm text-(--ui-text)">
                  <Calculator size={14} />
                  Opening Denominations
                </div>
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[80px_1fr_1fr] gap-2 pb-1 text-xs font-medium text-(--ui-text-muted)">
                    <span>Denom</span><span>Count</span><span className="text-right">Subtotal</span>
                  </div>
                  {openingDenoms.map((d, idx) => (
                    <div key={d.denomination} className="grid grid-cols-[80px_1fr_1fr] items-center gap-2">
                      <p className="text-sm text-(--ui-text)">{d.denomination}</p>
                      <Input
                        type="number"
                        min="0"
                        value={d.count}
                        onChange={(e) =>
                          setOpeningDenoms((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, count: Math.max(0, Number(e.target.value || 0)) } : row,
                            ),
                          )
                        }
                      />
                      <p className="text-right text-sm text-(--ui-text-muted)">
                        {d.denomination * Number(d.count || 0) > 0
                          ? `PKRs ${(d.denomination * Number(d.count || 0)).toLocaleString()}`
                          : "—"}
                      </p>
                    </div>
                  ))}
                  <div className="mt-1 border-t border-(--ui-border) pt-2 grid grid-cols-[80px_1fr_1fr] items-center gap-2">
                    <span className="text-sm font-semibold text-(--ui-text)">Total</span>
                    <span />
                    <p className="text-right text-sm font-semibold text-(--ui-text)">{money(openingCash)}</p>
                  </div>
                </div>
              </SectionCard>
              <Select
                value={openForm.employee_id}
                onChange={(e) => setOpenForm((p) => ({ ...p, employee_id: e.target.value }))}
              >
                <option value="">Select cashier (optional)</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </Select>
              <div className="flex gap-2 pt-2">
                <Button type="button" onClick={() => setOpenModal(false)}>Cancel</Button>
                <Button tone="primary" type="submit" disabled={busy || openingCash <= 0}>Open</Button>
              </div>
            </form>
          </SectionCard>
        </div>
      ) : null}

      {closeModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-lg p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">Close Shift {activeShift ? `#${activeShift.id}` : ""}</h3>
            {closeResult ? (
              <div className="mt-3 space-y-2 text-sm">
                <p className="text-(--ui-text)">Expected: {money(closeResult.expected_cash)}</p>
                <p className="text-(--ui-text)">Counted: {money(closeResult.closing_cash)}</p>
                <p className="font-semibold text-(--ui-text)">Variance: {money(closeResult.variance)}</p>
                <Button
                  onClick={() => {
                    setCloseModal(false);
                    setCloseResult(null);
                    setDenoms(DENOMS.map((d) => ({ denomination: d, count: 0 })));
                    setVarianceReason("");
                    setVarianceApprovedBy("");
                    setCloseNotes("");
                  }}
                >
                  Done
                </Button>
              </div>
            ) : (
              <form className="mt-3 space-y-3" onSubmit={closeShift}>
                <SectionCard className="p-2">
                  <div className="mb-2 flex items-center gap-2 text-sm text-(--ui-text)">
                    <Calculator size={14} />
                    Denomination Count
                  </div>
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-[80px_1fr_1fr] gap-2 pb-1 text-xs font-medium text-(--ui-text-muted)">
                      <span>Denom</span><span>Count</span><span className="text-right">Subtotal</span>
                    </div>
                    {denoms.map((d, idx) => (
                      <div key={d.denomination} className="grid grid-cols-[80px_1fr_1fr] items-center gap-2">
                        <p className="text-sm text-(--ui-text)">{d.denomination}</p>
                        <Input
                          type="number"
                          min="0"
                          value={d.count}
                          onChange={(e) =>
                            setDenoms((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, count: Math.max(0, Number(e.target.value || 0)) } : row,
                              ),
                            )
                          }
                        />
                        <p className="text-right text-sm text-(--ui-text-muted)">
                          {d.denomination * Number(d.count || 0) > 0
                            ? `PKRs ${(d.denomination * Number(d.count || 0)).toLocaleString()}`
                            : "—"}
                        </p>
                      </div>
                    ))}
                    <div className="mt-1 border-t border-(--ui-border) pt-2 grid grid-cols-[80px_1fr_1fr] items-center gap-2">
                      <span className="text-sm font-semibold text-(--ui-text)">Total</span>
                      <span />
                      <p className="text-right text-sm font-semibold text-(--ui-text)">{money(closingCash)}</p>
                    </div>
                  </div>
                </SectionCard>

                <Select value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)}>
                  <option value="">Variance reason (optional)</option>
                  {varianceReasons.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </Select>
                {varianceReason ? (
                  <Input
                    placeholder="Approved by"
                    value={varianceApprovedBy}
                    onChange={(e) => setVarianceApprovedBy(e.target.value)}
                  />
                ) : null}
                <Input placeholder="Notes" value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
                <div className="flex gap-2">
                  <Button type="button" onClick={() => setCloseModal(false)}>Cancel</Button>
                  <Button tone="danger" type="submit" disabled={busy}>Close Shift</Button>
                </div>
              </form>
            )}
          </SectionCard>
        </div>
      ) : null}

      {denomDetail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">Shift #{denomDetail.shift.id} Denominations</h3>
            <div className="mt-3 max-h-72 overflow-auto">
              {(denomDetail.rows || []).map((r, idx) => (
                <div key={`${r.denomination}-${idx}`} className="flex items-center justify-between border-b border-(--ui-border) py-2 text-sm">
                  <span>{r.denomination} x {r.count}</span>
                  <span className="font-semibold">{money(r.subtotal)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button onClick={() => setDenomDetail(null)}>Close</Button>
            </div>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
