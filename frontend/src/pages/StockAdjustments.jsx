import { API_BASE as API } from '../config';
import { useState, useEffect } from "react";
import { Plus, Search, Building2, History, X } from "lucide-react";

export default function StockAdjustments() {
  const [adjustments, setAdjustments] = useState([]);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const [formData, setFormData] = useState({
    product_id: "",
    outlet_id: "",
    quantity_change: "",
    reason: "Damaged",
  });

  const REASONS = [
    "Damaged",
    "Expired",
    "Lost/Stolen",
    "Found",
    "Counting Error",
    "Other",
  ];

  const fetchData = async () => {
    try {
      const [adjRes, prodRes, outRes] = await Promise.all([
        fetch(`${API}/api/adjustments`),
        fetch(`${API}/api/products`),
        fetch(`${API}/api/outlets`),
      ]);
      const [adjData, prodData, outData] = await Promise.all([
        adjRes.json(),
        prodRes.json(),
        outRes.json(),
      ]);
      setAdjustments(adjData || []);
      setProducts(prodData.products || []);

      const outletList = outData.outlets || [];
      // Auto-select first outlet if we have one
      if (outletList.length > 0 && !formData.outlet_id) {
        setFormData((prev) => ({ ...prev, outlet_id: outletList[0].id }));
      }
      setOutlets(outletList);
    } catch (err) {
      console.error("Failed to load data", err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API}/api/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          quantity_change: parseInt(formData.quantity_change),
          employee_id: 1, // Default Admin for now
        }),
      });

      if (!res.ok) throw new Error("Failed to save adjustment");

      setIsModalOpen(false);
      setFormData({
        product_id: "",
        outlet_id: outlets[0]?.id || "",
        quantity_change: "",
        reason: "Damaged",
      });
      fetchData(); // Refresh list to get new entry
    } catch (err) {
      alert(err.message);
    }
  };

  const filteredAdjustments = adjustments.filter(
    (adj) =>
      adj.product_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      adj.barcode?.includes(searchTerm),
  );

  return (
    <div className="w-full flex flex-col h-full space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            Stock Adjustments
          </h1>
          <p className="text-slate-500">
            Log shrinkages, damages, or manual inventory corrections.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-medium transition-colors flex items-center gap-2 shadow-sm"
        >
          <Plus size={20} />
          New Adjustment
        </button>
      </div>

      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={20}
            />
            <input
              type="text"
              placeholder="Search by product name or barcode..."
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold sticky top-0 z-10">
                <th className="p-4">Date</th>
                <th className="p-4">Product</th>
                <th className="p-4">Outlet</th>
                <th className="p-4">Reason</th>
                <th className="p-4 text-right">Adjustment</th>
                <th className="p-4">Employee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAdjustments.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-500">
                    <History
                      size={48}
                      className="mx-auto text-slate-300 mb-4"
                    />
                    <p className="font-medium text-slate-600">
                      No adjustments found
                    </p>
                    <p className="text-sm mt-1">
                      Adjustments will appear here once recorded.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredAdjustments.map((adj) => (
                  <tr
                    key={adj.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="p-4 text-sm text-slate-600">
                      {new Date(adj.timestamp).toLocaleString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-4">
                      <div className="font-medium text-slate-900">
                        {adj.product_name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {adj.barcode}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-slate-600 flex items-center gap-2">
                      <Building2 size={14} className="text-slate-400" />
                      {adj.outlet_name}
                    </td>
                    <td className="p-4 text-sm">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                        {adj.reason}
                      </span>
                    </td>
                    <td className="p-4 text-right font-medium">
                      <span
                        className={
                          adj.quantity_change > 0
                            ? "text-green-600"
                            : "text-red-600"
                        }
                      >
                        {adj.quantity_change > 0 ? "+" : ""}
                        {adj.quantity_change}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-500">
                      {adj.employee_name || "Admin"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-xl font-bold text-slate-800">
                New Stock Adjustment
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Product
                </label>
                <select
                  required
                  value={formData.product_id}
                  onChange={(e) =>
                    setFormData({ ...formData, product_id: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white"
                >
                  <option value="">Select a product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.barcode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Location (Outlet)
                </label>
                <select
                  required
                  value={formData.outlet_id}
                  onChange={(e) =>
                    setFormData({ ...formData, outlet_id: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white"
                >
                  <option value="">Select outlet...</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Adjustment
                  </label>
                  <input
                    type="number"
                    required
                    placeholder="e.g. -5 or 2"
                    value={formData.quantity_change}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        quantity_change: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Use +/- to denote change.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Reason
                  </label>
                  <select
                    required
                    value={formData.reason}
                    onChange={(e) =>
                      setFormData({ ...formData, reason: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white"
                  >
                    {REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-all"
                >
                  Confirm Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
