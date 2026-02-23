import { useState, useEffect } from "react";
import {
  Plus,
  Search,
  ArrowLeftRight,
  Building2,
  X,
  Package,
} from "lucide-react";

export default function Transfers() {
  const [transfers, setTransfers] = useState([]);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    product_id: "",
    from_outlet_id: "",
    to_outlet_id: "",
    quantity: "",
    note: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [trRes, prodRes, outRes] = await Promise.all([
        fetch("http://localhost:5000/api/transfers"),
        fetch("http://localhost:5000/api/products"),
        fetch("http://localhost:5000/api/outlets"),
      ]);
      const [trData, prodData, outData] = await Promise.all([
        trRes.json(),
        prodRes.json(),
        outRes.json(),
      ]);
      setTransfers(trData.transfers || []);
      setProducts(prodData.products || []);
      setOutlets(outData.outlets || []);
    } catch (err) {
      console.error("Failed to load data", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenModal = () => {
    setError("");
    setFormData({
      product_id: "",
      from_outlet_id: "",
      to_outlet_id: "",
      quantity: "",
      note: "",
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (formData.from_outlet_id === formData.to_outlet_id) {
      setError("Source and destination outlets must be different.");
      return;
    }
    if (parseInt(formData.quantity) <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("http://localhost:5000/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: parseInt(formData.product_id),
          from_outlet_id: parseInt(formData.from_outlet_id),
          to_outlet_id: parseInt(formData.to_outlet_id),
          quantity: parseInt(formData.quantity),
          note: formData.note || null,
          employee_id: 1, // Default admin for now
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Transfer failed");
        return;
      }

      setIsModalOpen(false);
      fetchData();
    } catch {
      setError("Connection to server failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredTransfers = transfers.filter(
    (t) =>
      t.product_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.barcode?.includes(searchTerm) ||
      t.from_outlet_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.to_outlet_name?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="max-w-7xl mx-auto flex flex-col h-full space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            Inventory Transfers
          </h1>
          <p className="text-slate-500">
            Move stock between outlets with a full audit trail.
          </p>
        </div>
        <button
          onClick={handleOpenModal}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-medium transition-colors flex items-center gap-2 shadow-sm"
        >
          <Plus size={20} />
          New Transfer
        </button>
      </div>

      {/* Table Card */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={18}
            />
            <input
              type="text"
              placeholder="Search by product, barcode, or outlet..."
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white text-sm"
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
                <th className="p-4">From</th>
                <th className="p-4">To</th>
                <th className="p-4 text-right">Qty</th>
                <th className="p-4">Note</th>
                <th className="p-4">Employee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan="7" className="p-8 text-center text-slate-400">
                    Loading transfers...
                  </td>
                </tr>
              ) : filteredTransfers.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-8 text-center">
                    <ArrowLeftRight
                      size={48}
                      className="mx-auto text-slate-300 mb-4"
                    />
                    <p className="font-medium text-slate-600">
                      No transfers found
                    </p>
                    <p className="text-sm text-slate-400 mt-1">
                      Create a transfer to move stock between outlets.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredTransfers.map((t) => (
                  <tr
                    key={t.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="p-4 text-sm text-slate-600 whitespace-nowrap">
                      {new Date(t.timestamp).toLocaleString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-4">
                      <div className="font-medium text-slate-900">
                        {t.product_name}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        {t.barcode}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Building2 size={14} className="text-rose-400" />
                        {t.from_outlet_name}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Building2 size={14} className="text-green-500" />
                        {t.to_outlet_name}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                        <ArrowLeftRight size={10} />
                        {t.quantity}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-500 italic">
                      {t.note || "—"}
                    </td>
                    <td className="p-4 text-sm text-slate-500">
                      {t.employee_name || "Admin"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Transfer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
            onClick={() => setIsModalOpen(false)}
          />

          {/* Slide-in Panel */}
          <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-slide-in-right">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <div>
                <h2 className="text-xl font-bold text-slate-800">
                  New Transfer
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Move stock between outlets
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="p-6 flex-1 overflow-y-auto flex flex-col gap-5"
            >
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 font-medium">
                  {error}
                </div>
              )}

              {/* Product */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  <Package size={14} className="inline mr-1 text-slate-400" />
                  Product
                </label>
                <select
                  required
                  value={formData.product_id}
                  onChange={(e) =>
                    setFormData({ ...formData, product_id: e.target.value })
                  }
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white text-sm"
                >
                  <option value="">Select a product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.barcode})
                    </option>
                  ))}
                </select>
              </div>

              {/* From / To Outlets */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    <Building2
                      size={14}
                      className="inline mr-1 text-rose-400"
                    />
                    From Outlet
                  </label>
                  <select
                    required
                    value={formData.from_outlet_id}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        from_outlet_id: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white text-sm"
                  >
                    <option value="">Select source...</option>
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    <Building2
                      size={14}
                      className="inline mr-1 text-green-500"
                    />
                    To Outlet
                  </label>
                  <select
                    required
                    value={formData.to_outlet_id}
                    onChange={(e) =>
                      setFormData({ ...formData, to_outlet_id: e.target.value })
                    }
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white text-sm"
                  >
                    <option value="">Select destination...</option>
                    {outlets
                      .filter(
                        (o) => String(o.id) !== String(formData.from_outlet_id),
                      )
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Quantity to Transfer
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  placeholder="e.g. 50"
                  value={formData.quantity}
                  onChange={(e) =>
                    setFormData({ ...formData, quantity: e.target.value })
                  }
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm"
                />
              </div>

              {/* Note */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Note{" "}
                  <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  rows="3"
                  placeholder="Reason for transfer, reference number, etc."
                  value={formData.note}
                  onChange={(e) =>
                    setFormData({ ...formData, note: e.target.value })
                  }
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm resize-none"
                />
              </div>

              {/* Actions */}
              <div className="mt-auto pt-6 border-t border-slate-200 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors shadow-sm text-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <ArrowLeftRight size={16} />
                  {isSubmitting ? "Transferring..." : "Confirm Transfer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
