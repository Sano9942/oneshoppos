import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
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
import { useAuth } from "../../auth/AuthProvider";
import { ArrowLeftRight, Plus, Search } from "lucide-react";
import { fmtUtcDateTime } from "../../utils/dates";
import { useCurrency } from "../../contexts/CurrencyContext";

const fmtDate = fmtUtcDateTime;

export default function ReturnsRedesign() {
  const { fmt: money } = useCurrency();
  const location = useLocation();
  const { authHeaders } = useAuth();
  const [rows, setRows] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeError, setBarcodeError] = useState("");
  const barcodeRef = useRef(null);

  const [form, setForm] = useState({
    original_sale_id: "",
    outlet_id: "",
    employee_id: "",
    customer_id: "",
    reason: "",
    refund_method: "Cash",
  });
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadReturns = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      const res = await fetch(`${API}/api/returns?${qs.toString()}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load returns");
      setRows(data.returns || []);
    } catch (e) {
      setError(e.message || "Failed to load returns");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  const loadBootstrap = async () => {
    try {
      const [outRes, empRes] = await Promise.all([
        fetch(`${API}/api/outlets`, { headers: authHeaders() }),
        fetch(`${API}/api/employees`, { headers: authHeaders() }),
      ]);
      const outData = await outRes.json();
      const empData = await empRes.json();
      setOutlets(outData.outlets || []);
      setEmployees(empData.employees || []);
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    loadReturns();
    loadBootstrap();
  }, [loadReturns]);

  useEffect(() => {
    const state = location.state;
    if (!state || !state.sale_id) return;
    setForm((prev) => ({
      ...prev,
      original_sale_id: String(state.sale_id || ""),
      outlet_id: String(state.outlet_id || ""),
      employee_id: String(state.employee_id || ""),
      customer_id: String(state.customer_id || ""),
    }));
    setItems(
      (state.items || []).map((i) => ({
        product_id: i.product_id,
        name: i.product_name,
        barcode: i.barcode,
        quantity: Number(i.quantity || 1),
        refund_price: Number(i.price_at_sale || 0),
      })),
    );
    setModalOpen(true);
    window.history.replaceState({}, document.title);
  }, [location.state]);

  useEffect(() => {
    if (modalOpen) {
      setTimeout(() => barcodeRef.current?.focus(), 60);
    }
  }, [modalOpen]);

  const loadDetail = async (row) => {
    setSelected(row);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API}/api/returns/${row.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load detail");
      setDetail(data);
    } catch (e) {
      setError(e.message || "Failed to load detail");
    } finally {
      setDetailLoading(false);
    }
  };

  const addProductToItems = (product) => {
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.product_id === product.id);
      if (idx >= 0) {
        return prev.map((x, i) =>
          i === idx ? { ...x, quantity: x.quantity + 1 } : x,
        );
      }
      return [
        {
          product_id: product.id,
          name: product.name,
          barcode: product.barcode,
          quantity: 1,
          refund_price: Number(product.price || 0),
        },
        ...prev,
      ];
    });
    setBarcodeInput("");
    setSearchResults([]);
  };

  const [searchResults, setSearchResults] = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);

  const scanToDraft = async (e) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;
    setBarcodeError("");
    try {
      const outletParam = form.outlet_id ? `?outlet_id=${form.outlet_id}` : "";
      const res = await fetch(
        `${API}/api/products/scan/${encodeURIComponent(barcodeInput)}${outletParam}`,
        { headers: authHeaders() },
      );
      const data = await res.json();
      if (!res.ok) {
        setBarcodeError(data.error || "Product not found");
        return;
      }
      addProductToItems(data.product);
    } catch {
      setBarcodeError("Failed to scan item");
    }
  };

  const searchProducts = async (query) => {
    setBarcodeInput(query);
    if (!query.trim()) { setSearchResults([]); setShowSearchResults(false); return; }
    try {
      const outletParam = form.outlet_id ? `&outlet_id=${form.outlet_id}` : "";
      const res = await fetch(
        `${API}/api/products/search?query=${encodeURIComponent(query)}${outletParam}`,
        { headers: authHeaders() },
      );
      const data = await res.json();
      setSearchResults(data.products || []);
      setShowSearchResults(true);
    } catch {
      setSearchResults([]);
    }
  };

  const draftTotal = useMemo(
    () => items.reduce((sum, i) => sum + Number(i.refund_price || 0) * Number(i.quantity || 0), 0),
    [items],
  );

  const submitReturn = async (e) => {
    e.preventDefault();
    if (!form.outlet_id || items.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original_sale_id: form.original_sale_id ? Number(form.original_sale_id) : null,
          outlet_id: Number(form.outlet_id),
          employee_id: form.employee_id ? Number(form.employee_id) : null,
          customer_id: form.customer_id ? Number(form.customer_id) : null,
          total_refund: draftTotal,
          refund_method: form.refund_method,
          reason: form.reason || null,
          items,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to process return");
      setModalOpen(false);
      setItems([]);
      setForm({
        original_sale_id: "",
        outlet_id: "",
        employee_id: "",
        customer_id: "",
        reason: "",
        refund_method: "Cash",
      });
      setBarcodeInput("");
      await loadReturns();
    } catch (e2) {
      setError(e2.message || "Failed to process return");
    } finally {
      setBusy(false);
    }
  };

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        String(r.id).includes(q) ||
        String(r.outlet_name || "").toLowerCase().includes(q) ||
        String(r.employee_name || "").toLowerCase().includes(q) ||
        String(r.reason || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <PageShell
      title="Returns"
      subtitle="Process customer returns and restock inventory."
      right={
        <Button tone="primary" onClick={() => setModalOpen(true)}>
          <Plus size={14} className="mr-1 inline" />
          Process Return
        </Button>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <SectionCard className="xl:col-span-8">
          <TableToolbar
            left={
              <>
                <div className="relative min-w-60">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
                  <Input className="pl-8" placeholder="Search return, outlet, employee" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </>
            }
            right={<span className="text-xs text-(--ui-text-muted)">{visibleRows.length} returns</span>}
          />

          <div className="overflow-auto">
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left">Return</th>
                  <th className="px-3 py-2 text-left">Timestamp</th>
                  <th className="px-3 py-2 text-left">Outlet</th>
                  <th className="px-3 py-2 text-left">Employee</th>
                  <th className="px-3 py-2 text-center">Items</th>
                  <th className="px-3 py-2 text-right">Refund</th>
                </tr>
              </thead>
              <tbody>
                {!loading &&
                  visibleRows.map((r) => (
                    <tr
                      key={r.id}
                      className={`cursor-pointer border-t border-(--ui-border) hover:bg-(--ui-muted-surface) ${selected?.id === r.id ? "bg-emerald-50" : ""}`}
                      onClick={() => loadDetail(r)}
                    >
                      <td className="px-3 py-2 font-medium text-(--ui-text)">RTN-{r.id}</td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">{fmtDate(r.timestamp)}</td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">{r.outlet_name || "-"}</td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">{r.employee_name || "-"}</td>
                      <td className="px-3 py-2 text-center text-(--ui-text)">{r.item_count || 0}</td>
                      <td className="px-3 py-2 text-right font-semibold text-rose-700">{money(r.total_refund)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {loading ? <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading returns...</div> : null}
            {!loading && visibleRows.length === 0 ? (
              <EmptyState title="No returns" body="Process a return to populate this list." />
            ) : null}
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-4 p-3">
          {!selected ? (
            <EmptyState title="Select a return" body="Click a return row to inspect restocked items and metadata." />
          ) : detailLoading ? (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading details...</div>
          ) : !detail ? (
            <EmptyState title="Detail unavailable" body="Try selecting the return again." />
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-(--ui-text)">Return RTN-{selected.id}</h3>
                <p className="text-xs text-(--ui-text-muted)">{fmtDate(selected.timestamp)}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SectionCard className="p-2 text-center">
                  <p className="text-xs text-(--ui-text-muted)">Method</p>
                  <p className="font-semibold text-(--ui-text)">{detail.returnData.refund_method}</p>
                </SectionCard>
                <SectionCard className="p-2 text-center">
                  <p className="text-xs text-(--ui-text-muted)">Total</p>
                  <p className="font-semibold text-rose-700">{money(detail.returnData.total_refund)}</p>
                </SectionCard>
              </div>
              {detail.returnData.reason ? (
                <div className="rounded border border-(--ui-border) p-2 text-sm text-(--ui-text)">
                  <span className="font-semibold">Reason:</span> {detail.returnData.reason}
                </div>
              ) : null}

              <div>
                <h4 className="mb-2 text-sm font-semibold text-(--ui-text)">Restocked Items</h4>
                <div className="max-h-52 space-y-2 overflow-auto">
                  {(detail.items || []).map((i) => (
                    <div key={i.id} className="rounded border border-(--ui-border) p-2 text-xs">
                      <p className="font-medium text-(--ui-text)">{i.product_name}</p>
                      <p className="text-(--ui-text-muted)">{i.quantity} x {money(i.refund_price)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="h-[85vh] w-full max-w-6xl overflow-hidden p-0">
            <div className="border-b border-(--ui-border) p-3">
              <h3 className="text-lg font-semibold text-(--ui-text)">Process Return</h3>
            </div>
            <div className="grid h-[calc(85vh-58px)] grid-cols-1 xl:grid-cols-12">
              <div className="xl:col-span-7 border-r border-(--ui-border) p-3">
                <form onSubmit={scanToDraft} className="mb-3">
                  <div className="relative">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
                    <Input
                      ref={barcodeRef}
                      className="pl-8"
                      value={barcodeInput}
                      onChange={(e) => searchProducts(e.target.value)}
                      onBlur={() => setTimeout(() => setShowSearchResults(false), 150)}
                      placeholder="Search by name, barcode or SKU"
                    />
                    {showSearchResults && searchResults.length > 0 ? (
                      <div className="absolute left-0 right-0 top-9 z-20 max-h-52 overflow-auto rounded border border-(--ui-border) bg-white shadow-lg">
                        {searchResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="block w-full border-b border-(--ui-border) px-3 py-2 text-left text-sm hover:bg-(--ui-muted-surface)"
                            onMouseDown={() => addProductToItems(p)}
                          >
                            <p className="font-medium text-(--ui-text)">{p.name}</p>
                            <p className="text-xs text-(--ui-text-muted)">{p.barcode || p.sku || "-"} | {money(p.price)}</p>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {barcodeError ? <p className="mt-1 text-xs text-rose-700">{barcodeError}</p> : null}
                </form>

                <div className="h-[calc(100%-44px)] overflow-auto rounded border border-(--ui-border)">
                  <table className="min-w-full text-sm">
                    <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                      <tr>
                        <th className="px-3 py-2 text-left">Item</th>
                        <th className="px-3 py-2 text-center">Qty</th>
                        <th className="px-3 py-2 text-right">Refund/ea</th>
                        <th className="px-3 py-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => (
                        <tr key={`${item.product_id}-${idx}`} className="border-t border-(--ui-border)">
                          <td className="px-3 py-2">
                            <p className="font-medium text-(--ui-text)">{item.name}</p>
                            <p className="text-xs text-(--ui-text-muted)">{item.barcode || "-"}</p>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, quantity: Math.max(1, Number(e.target.value || 1)) } : row,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.refund_price}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, refund_price: Math.max(0, Number(e.target.value || 0)) } : row,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Button size="sm" tone="danger" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}>Remove</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {items.length === 0 ? <EmptyState title="No items in draft" body="Scan returned products to build this return." /> : null}
                </div>
              </div>

              <form className="xl:col-span-5 p-3" onSubmit={submitReturn}>
                <div className="space-y-2">
                  <Input
                    placeholder="Original sale id (optional)"
                    value={form.original_sale_id}
                    onChange={(e) => setForm((p) => ({ ...p, original_sale_id: e.target.value }))}
                  />
                  <Select required value={form.outlet_id} onChange={(e) => setForm((p) => ({ ...p, outlet_id: e.target.value }))}>
                    <option value="">Select outlet</option>
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </Select>
                  <Select value={form.employee_id} onChange={(e) => setForm((p) => ({ ...p, employee_id: e.target.value }))}>
                    <option value="">Processed by (optional)</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </Select>
                  <Input
                    placeholder="Customer id (optional)"
                    value={form.customer_id}
                    onChange={(e) => setForm((p) => ({ ...p, customer_id: e.target.value }))}
                  />
                  <Select value={form.refund_method} onChange={(e) => setForm((p) => ({ ...p, refund_method: e.target.value }))}>
                    <option value="Cash">Cash</option>
                    <option value="Card">Card</option>
                    <option value="Store Credit">Store Credit</option>
                  </Select>
                  <Input
                    placeholder="Reason"
                    value={form.reason}
                    onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                  />
                </div>

                <SectionCard className="mt-3 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-(--ui-text-muted)">Total Refund</span>
                    <span className="text-lg font-semibold text-rose-700">{money(draftTotal)}</span>
                  </div>
                  <div className="mt-2">
                    <Badge tone="warning">{items.length} items in draft</Badge>
                  </div>
                </SectionCard>

                <div className="mt-3 flex gap-2">
                  <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
                  <Button
                    tone="primary"
                    type="submit"
                    disabled={busy || items.length === 0 || !form.outlet_id}
                  >
                    <ArrowLeftRight size={14} className="mr-1 inline" />
                    {busy ? "Processing..." : "Complete Return"}
                  </Button>
                </div>
              </form>
            </div>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
