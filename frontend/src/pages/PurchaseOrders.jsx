import { useState, useEffect } from "react";
import {
  ShoppingBag,
  Plus,
  X,
  Search,
  CheckCircle2,
  ChevronRight,
  PackageCheck,
  ListPlus,
  Download,
  Send,
} from "lucide-react";

const exportCSV = (data, filename) => {
  if (!data.length) return;
  const headers = Object.keys(data[0]).join(",");
  const rows = data.map((r) =>
    Object.values(r)
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[headers, ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

export default function PurchaseOrders() {
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [employees, setEmployees] = useState([]);

  // Views: 'list', 'create', 'view'
  const [currentView, setCurrentView] = useState("list");
  const [selectedPO, setSelectedPO] = useState(null);

  // GRN Modal State
  const [isGrnModalOpen, setIsGrnModalOpen] = useState(false);
  const [grnOutletId, setGrnOutletId] = useState("");
  const [grnReceivedBy, setGrnReceivedBy] = useState("");
  const [grnNotes, setGrnNotes] = useState("");
  const [grnQtys, setGrnQtys] = useState({}); // { product_id: qty_received }

  // Create PO State
  const [poForm, setPoForm] = useState({ supplier_id: "", due_date: "" });
  const [poCart, setPoCart] = useState([]);
  const [productSearch, setProductSearch] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState(null); // Error state tracked but shown via alert
  const [submittingApproval, setSubmittingApproval] = useState(false);

  useEffect(() => {
    fetchPurchaseOrders();
    fetchSuppliers();
    fetchProducts();
    fetch("http://localhost:5000/api/outlets")
      .then((r) => r.json())
      .then((d) => setOutlets(d.outlets || []))
      .catch(() => {});
    fetch("http://localhost:5000/api/employees")
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
  }, []);

  const fetchPurchaseOrders = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("http://localhost:5000/api/purchase-orders");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPurchaseOrders(data.purchaseOrders);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/suppliers");
      const data = await res.json();
      setSuppliers(data.suppliers);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/products");
      const data = await res.json();
      setProducts(data.products);
    } catch (err) {
      console.error(err);
    }
  };

  // --- CREATE PO LOGIC ---
  const handleAddToCart = (product) => {
    setPoCart((current) => {
      const existing = current.find((item) => item.product_id === product.id);
      if (existing) {
        return current.map((item) =>
          item.product_id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [
        ...current,
        {
          product_id: product.id,
          name: product.name,
          quantity: 1,
          cost_price: product.cost_price || 0,
        },
      ];
    });
    setProductSearch("");
  };

  const updateCartItem = (productId, field, value) => {
    setPoCart((current) =>
      current.map((item) =>
        item.product_id === productId
          ? { ...item, [field]: Number(value) }
          : item,
      ),
    );
  };

  const removeFromCart = (productId) => {
    setPoCart((current) =>
      current.filter((item) => item.product_id !== productId),
    );
  };

  const handleCreatePO = async () => {
    if (!poForm.supplier_id) return alert("Select a supplier first.");
    if (poCart.length === 0)
      return alert("Add at least one item to the order.");

    const total_cost = poCart.reduce(
      (acc, item) => acc + item.quantity * item.cost_price,
      0,
    );

    setIsLoading(true);
    try {
      const res = await fetch("http://localhost:5000/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: poForm.supplier_id,
          total_cost,
          items: poCart,
          due_date: poForm.due_date || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);

      // Reset form and go back to list
      setPoForm({ supplier_id: "", due_date: "" });
      setPoCart([]);
      setCurrentView("list");
      fetchPurchaseOrders();
    } catch (err) {
      alert(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // --- VIEW & RECEIVE PO LOGIC ---
  const handleViewPO = async (id) => {
    try {
      const res = await fetch(
        `http://localhost:5000/api/purchase-orders/${id}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSelectedPO(data);
      setCurrentView("view");
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSubmitForApproval = async (poId) => {
    setSubmittingApproval(true);
    try {
      const res = await fetch(`http://localhost:5000/api/purchase-orders/${poId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requested_by: "Manager" }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      alert("PO submitted for approval successfully.");
      handleViewPO(poId);
      fetchPurchaseOrders();
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmittingApproval(false);
    }
  };

  const openGrnModal = (po, items) => {
    const initialQtys = {};
    items.forEach((item) => {
      initialQtys[item.product_id] = item.quantity;
    });
    setGrnQtys(initialQtys);
    setGrnOutletId(outlets[0]?.id?.toString() || "");
    setGrnReceivedBy("");
    setGrnNotes("");
    setIsGrnModalOpen(true);
  };

  const handleSubmitGrn = async () => {
    if (!grnOutletId) {
      alert("Please select an outlet.");
      return;
    }
    const { purchaseOrder: po, items } = selectedPO;
    const itemsPayload = items.map((item) => ({
      product_id: item.product_id,
      qty_received: parseFloat(grnQtys[item.product_id] ?? item.quantity),
    }));
    try {
      const res = await fetch(
        `http://localhost:5000/api/purchase-orders/${po.id}/receive`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outlet_id: parseInt(grnOutletId),
            received_by: grnReceivedBy ? parseInt(grnReceivedBy) : null,
            items: itemsPayload,
            notes: grnNotes,
          }),
        },
      );
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      alert(`GRN Created: ${data.grn_number}`);
      setIsGrnModalOpen(false);
      setCurrentView("list");
      fetchPurchaseOrders();
    } catch (err) {
      alert(err.message);
    }
  };

  // --- RENDERING ---

  if (currentView === "list") {
    return (
      <div className="h-full w-full bg-slate-50 flex flex-col p-8 pb-0">
        <div className="flex justify-between items-center mb-8 shrink-0">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3 text-slate-800">
              <ShoppingBag
                className="text-emerald-600 drop-shadow-sm"
                size={32}
              />
              Purchase Orders
            </h1>
            <p className="text-slate-500 mt-1">
              Track incoming stock from suppliers.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                exportCSV(
                  purchaseOrders.map((po) => ({
                    id: po.id,
                    supplier: po.supplier_name,
                    total_cost: po.total_cost,
                    status: po.status,
                    due_date: po.due_date,
                    created_at: po.created_at,
                  })),
                  "purchase-orders.csv",
                )
              }
              className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-all"
            >
              <Download size={18} /> Export CSV
            </button>
            <button
              onClick={() => setCurrentView("create")}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-medium shadow-md shadow-emerald-200 transition-all flex items-center gap-2 transform hover:-translate-y-0.5"
            >
              <Plus size={20} />
              Create Purchase Order
            </button>
          </div>
        </div>

        <div className="bg-white shadow-sm flex-1 overflow-auto rounded-2xl mb-8 border border-slate-100">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr>
                <th className="py-4 px-6 font-semibold text-slate-600 text-sm">
                  PO Number
                </th>
                <th className="py-4 px-6 font-semibold text-slate-600 text-sm">
                  Supplier
                </th>
                <th className="py-4 px-6 font-semibold text-slate-600 text-sm">
                  Date
                </th>
                <th className="py-4 px-6 font-semibold text-slate-600 text-sm">
                  Status
                </th>
                <th className="py-4 px-6 font-semibold text-slate-600 text-sm text-right">
                  Total Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrders.map((po) => (
                <tr
                  key={po.id}
                  onClick={() => handleViewPO(po.id)}
                  className="border-b border-slate-100 hover:bg-emerald-50/30 transition-colors cursor-pointer"
                >
                  <td className="py-4 px-6 font-medium text-slate-800">
                    PO-{po.id.toString().padStart(4, "0")}
                  </td>
                  <td className="py-4 px-6 text-slate-700">
                    {po.supplier_name}
                  </td>
                  <td className="py-4 px-6 text-slate-500">
                    {new Date(po.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-4 px-6">
                    <span
                      className={`px-3 py-1 text-xs font-bold rounded-full ${po.status === "Received" ? "bg-green-100 text-green-700" : po.status === "Approved" ? "bg-blue-100 text-blue-700" : po.status === "pending_approval" ? "bg-yellow-100 text-yellow-700" : "bg-amber-100 text-amber-700"}`}
                    >
                      {po.status}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right font-medium text-slate-800">
                    ${po.total_cost.toFixed(2)}
                  </td>
                </tr>
              ))}

              {purchaseOrders.length === 0 && !isLoading && (
                <tr>
                  <td colSpan="5" className="py-20 text-center text-slate-400">
                    <ShoppingBag
                      size={48}
                      className="mx-auto mb-4 opacity-20"
                    />
                    <p className="text-lg">No purchase orders found.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (currentView === "create") {
    const searchResults =
      productSearch.length > 1
        ? products.filter(
            (p) =>
              p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
              p.barcode.includes(productSearch),
          )
        : [];

    return (
      <div className="h-full w-full bg-slate-50 p-8 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 mb-6 text-slate-500">
          <button
            onClick={() => setCurrentView("list")}
            className="hover:text-slate-800"
          >
            Purchase Orders
          </button>
          <ChevronRight size={16} />
          <span className="text-slate-800 font-medium">Create PO</span>
        </div>

        <div className="flex gap-6 h-full min-h-0">
          {/* LEFT SIDE: Items Browser */}
          <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <div className="relative">
                <Search
                  className="absolute left-3 top-3 text-slate-400"
                  size={20}
                />
                <input
                  type="text"
                  placeholder="Search products by name or barcode to add to the order..."
                  className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto p-2">
              {searchResults.length > 0 ? (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                  {searchResults.map((product) => (
                    <div
                      key={product.id}
                      onClick={() => handleAddToCart(product)}
                      className="p-3 border border-slate-100 rounded-xl hover:border-emerald-300 hover:bg-emerald-50/50 cursor-pointer transition-all"
                    >
                      <div className="font-medium text-slate-800 truncate">
                        {product.name}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Barcode: {product.barcode}
                      </div>
                      <div className="text-sm font-semibold text-emerald-600 mt-2">
                        Cost: ${product.cost_price?.toFixed(2) || "0.00"}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 flex-col gap-3">
                  <ListPlus size={48} className="opacity-20" />
                  <p>Search for products to build your order.</p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT SIDE: PO Cart / Checkout */}
          <div className="w-96 bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-emerald-50/30">
              <h2 className="text-lg font-bold text-slate-800">
                Purchase Order Draft
              </h2>
            </div>

            <div className="p-4 border-b border-slate-100">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Select Supplier *
              </label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500/50 outline-none"
                value={poForm.supplier_id}
                onChange={(e) =>
                  setPoForm({ ...poForm, supplier_id: e.target.value })
                }
              >
                <option value="">-- Choose Supplier --</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="p-4 border-b border-slate-100">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Due Date (Optional)
              </label>
              <input
                type="date"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500/50 outline-none text-slate-700"
                value={poForm.due_date}
                onChange={(e) =>
                  setPoForm({ ...poForm, due_date: e.target.value })
                }
              />
            </div>

            <div className="flex-1 overflow-auto p-4 flex flex-col gap-3 bg-slate-50/50">
              {poCart.map((item) => (
                <div
                  key={item.product_id}
                  className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-medium text-slate-800 truncate pr-2">
                      {item.name}
                    </div>
                    <button
                      onClick={() => removeFromCart(item.product_id)}
                      className="text-red-400 hover:text-red-600"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-slate-500 block mb-1">
                        Qty Ordered
                      </label>
                      <input
                        type="number"
                        min="1"
                        className="w-full border border-slate-200 rounded p-1 text-sm bg-slate-50 text-center"
                        value={item.quantity}
                        onChange={(e) =>
                          updateCartItem(
                            item.product_id,
                            "quantity",
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-slate-500 block mb-1">
                        Unit Cost ($)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-full border border-emerald-200 rounded p-1 text-sm bg-emerald-50 text-center text-emerald-700 font-medium"
                        value={item.cost_price}
                        onChange={(e) =>
                          updateCartItem(
                            item.product_id,
                            "cost_price",
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
              {poCart.length === 0 && (
                <div className="text-center text-slate-400 py-10 text-sm">
                  Cart is empty.
                </div>
              )}
            </div>

            <div className="p-4 bg-white border-t border-slate-100 rounded-b-2xl">
              <div className="flex justify-between items-center mb-4">
                <span className="text-slate-500 font-medium">Draft Total:</span>
                <span className="text-2xl font-bold text-slate-800">
                  $
                  {poCart
                    .reduce(
                      (sum, item) => sum + item.quantity * item.cost_price,
                      0,
                    )
                    .toFixed(2)}
                </span>
              </div>
              <button
                onClick={handleCreatePO}
                disabled={poCart.length === 0 || isLoading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold text-lg shadow-md shadow-emerald-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit Purchase Order
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (currentView === "view" && selectedPO) {
    const { purchaseOrder: po, items } = selectedPO;

    return (
      <div className="h-full w-full bg-slate-50 p-8 flex flex-col overflow-hidden">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2 text-slate-500">
            <button
              onClick={() => setCurrentView("list")}
              className="hover:text-slate-800"
            >
              Purchase Orders
            </button>
            <ChevronRight size={16} />
            <span className="text-slate-800 font-medium">
              PO-{po.id.toString().padStart(4, "0")}
            </span>
          </div>

          {po.status === "Draft" && (
            <button
              onClick={() => handleSubmitForApproval(po.id)}
              disabled={submittingApproval}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-md shadow-blue-200 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Send size={20} />
              {submittingApproval ? "Submitting..." : "Submit for Approval"}
            </button>
          )}
          {po.status === "Approved" && (
            <button
              onClick={() => openGrnModal(po, items)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-md shadow-emerald-200 transition-all flex items-center gap-2"
            >
              <PackageCheck size={20} />
              Receive Items (Create GRN)
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-slate-100 p-8 flex justify-between bg-slate-50/50">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 mb-2">
                Purchase Order <span className="text-slate-400">#{po.id}</span>
              </h1>
              <p className="text-lg text-slate-600 font-medium">
                {po.supplier_name}
              </p>
              <p className="text-slate-500 text-sm mt-1">
                {new Date(po.created_at).toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-slate-500 mb-1">
                Status
              </div>
              <span
                className={`px-4 py-1.5 text-sm font-bold rounded-full inline-block mb-3 ${po.status === "Received" ? "bg-green-100 text-green-700" : po.status === "Approved" ? "bg-blue-100 text-blue-700" : po.status === "pending_approval" ? "bg-yellow-100 text-yellow-700" : "bg-amber-100 text-amber-700"}`}
              >
                {po.status}
              </span>
              <div className="text-sm font-medium text-slate-500 mb-1">
                Total Cost
              </div>
              <div className="text-3xl font-bold text-slate-800">
                ${po.total_cost.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-8">
            <h3 className="text-lg font-bold text-slate-800 mb-4 border-b border-slate-100 pb-2">
              Line Items
            </h3>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 text-sm">
                  <th className="py-2">Item</th>
                  <th className="py-2">Barcode</th>
                  <th className="py-2 text-center">Unit Cost</th>
                  <th className="py-2 text-center">Qty Ordered</th>
                  <th className="py-2 text-right font-medium">Row Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-50">
                    <td className="py-3 font-medium text-slate-800">
                      {item.name}
                    </td>
                    <td className="py-3 text-slate-500 font-mono text-sm">
                      {item.barcode}
                    </td>
                    <td className="py-3 text-center text-slate-600">
                      ${item.cost_price.toFixed(2)}
                    </td>
                    <td className="py-3 text-center font-medium text-slate-800">
                      {item.quantity}
                    </td>
                    <td className="py-3 text-right font-bold text-slate-800">
                      ${(item.quantity * item.cost_price).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* GRN Modal */}
        {isGrnModalOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <PackageCheck size={20} className="text-emerald-600" />
                  Goods Received Note
                </h2>
                <button
                  onClick={() => setIsGrnModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
                      Receiving Outlet *
                    </label>
                    <select
                      value={grnOutletId}
                      onChange={(e) => setGrnOutletId(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">Select outlet...</option>
                      {outlets.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
                      Received By
                    </label>
                    <select
                      value={grnReceivedBy}
                      onChange={(e) => setGrnReceivedBy(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">Select employee...</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
                    Notes
                  </label>
                  <textarea
                    value={grnNotes}
                    onChange={(e) => setGrnNotes(e.target.value)}
                    rows={2}
                    placeholder="Optional receiving notes..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  />
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">
                    Qty Received per Item
                  </h3>
                  <div className="space-y-2">
                    {selectedPO.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 bg-slate-50 rounded-lg px-4 py-2.5 border border-slate-100"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {item.name}
                          </p>
                          <p className="text-xs text-slate-400 font-mono">
                            {item.barcode} · Ordered: {item.quantity}
                          </p>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max={item.quantity}
                          value={grnQtys[item.product_id] ?? item.quantity}
                          onChange={(e) =>
                            setGrnQtys((prev) => ({
                              ...prev,
                              [item.product_id]: e.target.value,
                            }))
                          }
                          className="w-20 text-center border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button
                  onClick={() => setIsGrnModalOpen(false)}
                  className="px-5 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitGrn}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-colors"
                >
                  <CheckCircle2 size={16} />
                  Confirm & Create GRN
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
