import { useState, useEffect, useMemo } from "react";
import {
  PackageX,
  Plus,
  Search,
  CheckCircle2,
  ChevronRight,
  Store,
  User,
  X,
  Box,
  Tag,
  FileText,
  ArrowLeft,
  RefreshCcw,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";

import { API_BASE as API } from '../config';


const fmt = (n) => "$" + (n || 0).toFixed(2);
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export default function ReturnedStock() {
  const { employee } = useAuth();
  const [returns, setReturns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewState, setViewState] = useState("list"); // 'list', 'new', 'detail'

  // Data for 'new'
  const [suppliers, setSuppliers] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [products, setProducts] = useState([]);

  // Form State for 'new'
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [returnItems, setReturnItems] = useState([]);

  // Detail State
  // (Reserved for future detail view implementation)

  const fetchReturns = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/api/supplier-returns`);
      const data = await res.json();
      setReturns(data.returns || []);
    } catch {
      console.error("Failed to fetch supplier returns");
    } finally {
      setIsLoading(false);
    }
  };

  const loadDependencies = async () => {
    try {
      const [supRes, outRes, prodRes] = await Promise.all([
        fetch(`${API}/api/suppliers`),
        fetch(`${API}/api/outlets`),
        fetch(`${API}/api/products`), // For a real app, this should be paginated/searchable due to variants
      ]);
      const [supData, outData, prodData] = await Promise.all([
        supRes.json(),
        outRes.json(),
        prodRes.json(),
      ]);
      setSuppliers(supData.suppliers || []);
      setOutlets(outData.outlets || []);
      setProducts(prodData.products || []);
      if (outData.outlets?.length > 0)
        setSelectedOutletId(outData.outlets[0].id);
    } catch (err) {
      console.error("Error loading dependencies for RMA", err);
    }
  };

  useEffect(() => {
    fetchReturns();
    loadDependencies();
  }, []);

  const handleOpenNew = () => {
    setViewState("new");
    setReturnItems([]);
    setReturnReason("");
    setReferenceNumber("");
  };

  const handleAddItem = (e) => {
    const productId = e.target.value;
    if (!productId) return;

    // Check if variant
    const isVariant = productId.startsWith("v");
    const actualId = parseInt(productId.replace("v", ""));

    let productDetails;
    if (isVariant) {
      // We would ideally fetch the variant details or have them in loaded state
      // For mock simplicity assuming the core products data includes variants or we let user edit price
      productDetails = {
        id: actualId,
        name: `Variant ${actualId}`,
        price: 0,
        cost_price: 0,
        is_variant: true,
        variant_id: actualId,
        product_id: null,
      };
      // In a full implementation, you'd map the proper product/variant objects here
    } else {
      productDetails = products.find((p) => p.id === parseInt(productId));
      if (productDetails && productDetails.has_variants) {
        // Prevent adding root configurable product
        alert("Please select a specific variant for this product.");
        e.target.value = "";
        return;
      }
    }

    if (productDetails) {
      // Check if already in list
      const exists = returnItems.find(
        (i) =>
          i.product_id === productDetails.id &&
          (!i.variant_id || i.variant_id === productDetails.variant_id),
      );
      if (exists) {
        setReturnItems(
          returnItems.map((i) =>
            i === exists ? { ...i, quantity: i.quantity + 1 } : i,
          ),
        );
      } else {
        setReturnItems([
          ...returnItems,
          {
            ...productDetails,
            product_id: isVariant ? null : productDetails.id,
            variant_id: isVariant ? productDetails.variant_id : null,
            quantity: 1,
            unit_price: productDetails.cost_price || 0,
            return_reason: "",
          },
        ]);
      }
    }
    e.target.value = "";
  };

  const handleSubmitRMA = async () => {
    if (!selectedSupplierId || !selectedOutletId || returnItems.length === 0) {
      alert("Please fill all required fields and add at least one item.");
      return;
    }

    try {
      const payload = {
        supplier_id: parseInt(selectedSupplierId),
        outlet_id: parseInt(selectedOutletId),
        employee_id: employee?.id || null,
        reason: returnReason,
        reference_number: referenceNumber,
        items: returnItems.map((i) => ({
          product_id: i.product_id,
          variant_id: i.variant_id,
          quantity: parseInt(i.quantity),
          unit_price: parseFloat(i.unit_price),
          reason: i.return_reason,
        })),
      };

      const res = await fetch(`${API}/api/supplier-returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setViewState("list");
        fetchReturns();
      } else {
        const err = await res.json();
        alert("Error saving: " + err.error);
      }
    } catch (err) {
      console.error("Submission failed", err);
    }
  };

  const filteredReturns = useMemo(() => {
    if (!search) return returns;
    const q = search.toLowerCase();
    return returns.filter(
      (r) =>
        (r.supplier_name || "").toLowerCase().includes(q) ||
        (r.reference_number || "").toLowerCase().includes(q),
    );
  }, [search, returns]);

  if (viewState === "new") {
    return (
      <div className="flex flex-col h-full gap-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setViewState("list")}
            className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors text-slate-600"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
              New Supplier Return (RMA)
            </h1>
            <p className="text-slate-500">
              Record items being sent back to the supplier and adjust inventory.
            </p>
          </div>
        </div>

        <div className="flex gap-6 overflow-hidden min-h-0 flex-1">
          <div className="w-1/3 flex flex-col gap-6 overflow-y-auto pr-2">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2">
                Return Details
              </h3>
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-2">
                  <Store size={14} className="text-slate-400" /> Outlet *
                </label>
                <select
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:border-blue-500 outline-none"
                  value={selectedOutletId}
                  onChange={(e) => setSelectedOutletId(e.target.value)}
                >
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-2">
                  <PackageX size={14} className="text-slate-400" /> Supplier *
                </label>
                <select
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:border-blue-500 outline-none"
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                >
                  <option value="">-- Select Supplier --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-2">
                  <FileText size={14} className="text-slate-400" /> Reference
                  Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. RMA-2026-991"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:border-blue-500 outline-none"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-2">
                  General Reason
                </label>
                <textarea
                  placeholder="Why are these items being returned?"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:border-blue-500 outline-none resize-none h-24"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-4">
              <div className="relative flex-1">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={16}
                />
                <select
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:border-blue-500 outline-none appearance-none"
                  onChange={handleAddItem}
                  value=""
                >
                  <option value="" disabled>
                    Search & Add Product to Return...
                  </option>
                  {products
                    .filter((p) => p.has_variants === 0)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {returnItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                  <Box size={48} className="text-slate-200 mb-4" />
                  <p className="font-medium text-slate-600">No Items Added</p>
                  <p className="text-sm">
                    Select products above to add to this RMA.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                      <th className="pb-3">Product</th>
                      <th className="pb-3 w-24 text-center">Return Qty</th>
                      <th className="pb-3 w-32 text-right">Unit Value</th>
                      <th className="pb-3 w-32 text-center">Reason Note</th>
                      <th className="pb-3 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnItems.map((item, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-50 last:border-0"
                      >
                        <td className="py-3 font-semibold text-sm text-slate-800">
                          {item.name}
                        </td>
                        <td className="py-3 px-2">
                          <input
                            type="number"
                            min="1"
                            className="w-full text-center border border-slate-200 rounded-md py-1 text-sm bg-slate-50"
                            value={item.quantity}
                            onChange={(e) => {
                              const newItems = [...returnItems];
                              newItems[idx].quantity = e.target.value;
                              setReturnItems(newItems);
                            }}
                          />
                        </td>
                        <td className="py-3 px-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="w-full text-right border border-slate-200 rounded-md py-1 text-sm bg-slate-50"
                            value={item.unit_price}
                            onChange={(e) => {
                              const newItems = [...returnItems];
                              newItems[idx].unit_price = e.target.value;
                              setReturnItems(newItems);
                            }}
                          />
                        </td>
                        <td className="py-3 px-2">
                          <input
                            type="text"
                            placeholder="Optional"
                            className="w-full border border-slate-200 rounded-md py-1 px-2 text-sm bg-slate-50"
                            value={item.return_reason}
                            onChange={(e) => {
                              const newItems = [...returnItems];
                              newItems[idx].return_reason = e.target.value;
                              setReturnItems(newItems);
                            }}
                          />
                        </td>
                        <td className="py-3 text-right">
                          <button
                            onClick={() =>
                              setReturnItems(
                                returnItems.filter((_, i) => i !== idx),
                              )
                            }
                            className="text-red-400 hover:text-red-600 p-1"
                          >
                            <X size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="border-t border-slate-100 bg-slate-50 p-4 shrink-0 flex justify-between items-center">
              <div className="text-sm">
                <span className="text-slate-500">Total Value:</span>
                <span className="font-bold text-slate-800 ml-2 text-lg">
                  {fmt(
                    returnItems.reduce(
                      (sum, item) => sum + item.quantity * item.unit_price,
                      0,
                    ),
                  )}
                </span>
              </div>
              <button
                onClick={handleSubmitRMA}
                disabled={returnItems.length === 0}
                className="bg-[#8066FF] hover:bg-[#7055E6] text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-sm disabled:opacity-50"
              >
                <CheckCircle2 size={18} /> Complete Return
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            Supplier Returns
          </h1>
          <p className="text-slate-500">
            Manage items returned to suppliers (RMA).
          </p>
        </div>
        <button
          onClick={handleOpenNew}
          className="bg-[#8066FF] hover:bg-[#7055E6] text-white px-5 py-2.5 rounded-xl font-bold transition-colors flex items-center gap-2 shadow-sm"
        >
          <Plus size={20} /> New Return
        </button>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden min-h-0">
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/50">
            <div className="relative max-w-sm">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={16}
              />
              <input
                type="text"
                placeholder="Search supplier or reference..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-linear-to-br from-[#8066FF]/5 to-[#8066FF]/10 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8066FF]/20"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold sticky top-0 z-10">
                  <th className="p-4">RMA #</th>
                  <th className="p-4">Supplier</th>
                  <th className="p-4">Outlet</th>
                  <th className="p-4 text-center">Items</th>
                  <th className="p-4 text-right">Value</th>
                  <th className="p-4">Date</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan="7" className="p-8 text-center text-slate-400">
                      Loading returns...
                    </td>
                  </tr>
                ) : filteredReturns.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="p-10 text-center">
                      <RefreshCcw
                        size={48}
                        className="mx-auto text-slate-300 mb-3"
                      />
                      <p className="font-medium text-slate-600">
                        No RMAs found
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredReturns.map((r) => (
                    <tr
                      key={r.id}
                      className="hover:bg-[#8066FF]/5 cursor-pointer transition-colors"
                    >
                      <td className="p-4 font-bold text-slate-800">
                        #{r.id}{" "}
                        {r.reference_number ? `(${r.reference_number})` : ""}
                      </td>
                      <td className="p-4 font-semibold text-[#8066FF]">
                        {r.supplier_name || "Unknown"}
                      </td>
                      <td className="p-4 text-slate-600 text-sm">
                        {r.outlet_name || "All"}
                      </td>
                      <td className="p-4 text-center">
                        <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full text-xs font-bold">
                          {r.item_count}
                        </span>
                      </td>
                      <td className="p-4 text-right font-bold text-slate-900">
                        {fmt(r.total_value)}
                      </td>
                      <td className="p-4 text-slate-500 text-sm">
                        {fmtDate(r.return_date)}
                      </td>
                      <td className="p-4">
                        <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider">
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
