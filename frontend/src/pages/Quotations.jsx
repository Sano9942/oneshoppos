/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE as API } from "../config";
import { useAuth } from "../auth/AuthProvider";

const STATUS = ["draft", "sent", "accepted", "rejected", "expired", "converted"];

function money(v) {
  return `PKRs ${Number(v || 0).toFixed(2)}`;
}

export default function Quotations() {
  const { authHeaders } = useAuth();
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [items, setItems] = useState([{ product_id: "", quantity: 1, unit_price: 0, tax_rate: 0 }]);
  const [form, setForm] = useState({ customer_id: "", outlet_id: "", employee_id: "", valid_until: "", discount_type: "fixed", discount_amount: 0, notes: "" });

  const loadBasics = useCallback(async () => {
    try {
      const [qRes, cRes, pRes, oRes, eRes] = await Promise.all([
        fetch(`${API}/api/quotations${statusFilter ? `?status=${statusFilter}` : ""}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/customers`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/products`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/outlets`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/employees`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setRows(qRes.quotations || []);
      setCustomers(cRes.customers || []);
      setProducts(pRes.products || []);
      setOutlets(oRes.outlets || []);
      setEmployees(eRes.employees || []);
    } catch {
      // ignore
    }
  }, [authHeaders, statusFilter]);

  useEffect(() => {
    loadBasics();
  }, [loadBasics]);

  const subtotal = useMemo(
    () => items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0),
    [items]
  );
  const taxTotal = useMemo(
    () => items.reduce((s, it) => s + ((Number(it.quantity || 0) * Number(it.unit_price || 0) * Number(it.tax_rate || 0)) / 100), 0),
    [items]
  );
  const discountValue = useMemo(
    () => form.discount_type === "percent" ? (subtotal * Number(form.discount_amount || 0)) / 100 : Number(form.discount_amount || 0),
    [form.discount_type, form.discount_amount, subtotal]
  );
  const total = subtotal + taxTotal - discountValue;

  const resetEditor = () => {
    setSelected(null);
    setForm({ customer_id: "", outlet_id: "", employee_id: "", valid_until: "", discount_type: "fixed", discount_amount: 0, notes: "" });
    setItems([{ product_id: "", quantity: 1, unit_price: 0, tax_rate: 0 }]);
  };

  const newQuotation = () => resetEditor();

  const editQuotation = async (id) => {
    try {
      const res = await fetch(`${API}/api/quotations/${id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) return;
      setSelected(data.quotation);
      setForm({
        customer_id: data.quotation.customer_id || "",
        outlet_id: data.quotation.outlet_id || "",
        employee_id: data.quotation.employee_id || "",
        valid_until: data.quotation.valid_until || "",
        discount_type: data.quotation.discount_type || "fixed",
        discount_amount: data.quotation.discount_amount || 0,
        notes: data.quotation.notes || "",
      });
      setItems((data.items || []).map((it) => ({ product_id: it.product_id, quantity: it.quantity, unit_price: it.unit_price, tax_rate: it.tax_rate || 0, variant_id: it.variant_id || null })));
    } catch {
      // ignore
    }
  };

  const save = async () => {
    const payload = { ...form, items };
    const method = selected ? "PUT" : "POST";
    const url = selected ? `${API}/api/quotations/${selected.id}` : `${API}/api/quotations`;
    await fetch(url, { method, headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(payload) });
    resetEditor();
    loadBasics();
  };

  const setStatus = async (id, status) => {
    await fetch(`${API}/api/quotations/${id}/status`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status }),
    });
    loadBasics();
  };

  const convert = async (id) => {
    await fetch(`${API}/api/quotations/${id}/convert`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ payment_method: "Cash" }),
    });
    loadBasics();
  };

  const remove = async (id) => {
    await fetch(`${API}/api/quotations/${id}`, { method: "DELETE", headers: authHeaders({ "Content-Type": "application/json" }) });
    loadBasics();
  };

  const updateItem = (idx, key, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  };

  if (selected || form.customer_id || form.outlet_id || form.notes || items.length > 1 || items[0].product_id) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Quotation Editor</h1>
            <p className="text-sm text-slate-500 mt-1">Create or update quotation</p>
          </div>
          <button onClick={resetEditor} className="px-3 py-2 border rounded-lg text-sm">Back</button>
        </div>

        <div className="bg-white border rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <select value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm">
              <option value="">Customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={form.outlet_id} onChange={(e) => setForm((f) => ({ ...f, outlet_id: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm">
              <option value="">Outlet</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm">
              <option value="">Employee</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input type="date" value={form.valid_until} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                <select value={it.product_id} onChange={(e) => {
                  const product = products.find((p) => String(p.id) === String(e.target.value));
                  updateItem(idx, "product_id", e.target.value);
                  updateItem(idx, "unit_price", Number(product?.price || 0));
                }} className="border rounded-lg px-3 py-2 text-sm">
                  <option value="">Product</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="number" min="1" value={it.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm" placeholder="Qty" />
                <input type="number" min="0" step="0.01" value={it.unit_price} onChange={(e) => updateItem(idx, "unit_price", Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm" placeholder="Unit Price" />
                <input type="number" min="0" step="0.01" value={it.tax_rate} onChange={(e) => updateItem(idx, "tax_rate", Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm" placeholder="Tax %" />
                <div className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
                  <span>{money(Number(it.quantity || 0) * Number(it.unit_price || 0))}</span>
                  <button onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))} className="text-rose-600 text-xs">Remove</button>
                </div>
              </div>
            ))}
            <button onClick={() => setItems((prev) => [...prev, { product_id: "", quantity: 1, unit_price: 0, tax_rate: 0 }])} className="text-sm text-blue-600">+ Add Item</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select value={form.discount_type} onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm">
              <option value="fixed">Fixed Discount</option><option value="percent">Percent Discount</option>
            </select>
            <input type="number" min="0" step="0.01" value={form.discount_amount} onChange={(e) => setForm((f) => ({ ...f, discount_amount: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" placeholder="Discount" />
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" placeholder="Notes" />
          </div>

          <div className="bg-slate-50 border rounded-lg p-3 text-sm">
            <p>Subtotal: {money(subtotal)}</p>
            <p>Tax: {money(taxTotal)}</p>
            <p>Discount: {money(discountValue)}</p>
            <p className="font-semibold">Total: {money(total)}</p>
          </div>

          <div className="flex gap-2">
            <button onClick={save} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Save</button>
            {selected?.status === "accepted" && (
              <button onClick={() => convert(selected.id)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">Convert To Sale</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Quotations</h1>
          <p className="text-sm text-slate-500 mt-1">Draft, send, accept and convert quotations</p>
        </div>
        <button onClick={newQuotation} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">New Quotation</button>
      </div>

      <div className="bg-white border rounded-xl p-3 flex gap-2 flex-wrap">
        <button onClick={() => setStatusFilter("")} className={`px-3 py-1.5 rounded text-xs ${statusFilter === "" ? "bg-blue-600 text-white" : "bg-slate-100"}`}>All</button>
        {STATUS.map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded text-xs capitalize ${statusFilter === s ? "bg-blue-600 text-white" : "bg-slate-100"}`}>{s}</button>
        ))}
      </div>

      <div className="bg-white border rounded-xl p-4 overflow-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead>
            <tr className="text-slate-500 text-left">
              <th className="py-2">Quote #</th><th>Customer/Lead</th><th>Outlet</th><th>Valid Until</th><th>Total</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-2">{r.quote_number}</td>
                <td>{r.customer_name || r.lead_name || "-"}</td>
                <td>{r.outlet_name || "-"}</td>
                <td>{r.valid_until || "-"}</td>
                <td>{money(r.total_amount)}</td>
                <td className="capitalize">{r.status}</td>
                <td className="space-x-2">
                  <button className="text-blue-600 text-xs" onClick={() => editQuotation(r.id)}>View/Edit</button>
                  {r.status === "draft" && <button className="text-rose-600 text-xs" onClick={() => remove(r.id)}>Delete</button>}
                  {r.status === "accepted" && <button className="text-emerald-600 text-xs" onClick={() => convert(r.id)}>Convert</button>}
                  {r.status !== "converted" && r.status !== "accepted" && (
                    <button className="text-indigo-600 text-xs" onClick={() => setStatus(r.id, "accepted")}>Mark Accepted</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
