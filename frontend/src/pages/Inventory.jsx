import { useState, useEffect } from "react";
import { Package, Plus, Save, X, Search, Download, Upload, ImagePlus, Trash2 } from "lucide-react";

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

// Parse a CSV string into an array of objects using the first row as headers
const parseCSV = (text) => {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { vals.push(cur); cur = ""; }
      else { cur += ch; }
    }
    vals.push(cur);
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? "").trim()]));
  });
};

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  // Bulk Import State
  const [importResults, setImportResults] = useState(null); // null | { results: [] }
  const [isImporting, setIsImporting] = useState(false);

  // Pagination State for Performance (5,000 items)
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formData, setFormData] = useState({
    barcode: "",
    name: "",
    price: "",
    cost_price: "",
    compare_at_price: "",
    gst: "",
    description_html: "",
    product_type: "",
    vendor: "",
    tags: "",
    status: "active",
    stock: "",
    category_id: "",
    tax_id: "",
    brand_id: "",
    outlet_id: "",
    attribute_set_id: "",
    has_variants: false,
    variants: [],
    min_qty: "",
    max_qty: "",
    unit: "pcs",
    media: [],
  });
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);

  // Dropdown Data
  const [categories, setCategories] = useState([]);
  const [taxes, setTaxes] = useState([]);
  const [brands, setBrands] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [attributeSets, setAttributeSets] = useState([]);

  // Fetch Products
  const fetchProducts = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/products");
      const data = await res.json();
      setProducts(data.products || []);
    } catch (err) {
      console.error("Failed to fetch products", err);
    }
  };

  const fetchDropdowns = async () => {
    try {
      const [catRes, taxRes, brandRes, outletRes, attrSetsRes] =
        await Promise.all([
          fetch("http://localhost:5000/api/categories"),
          fetch("http://localhost:5000/api/taxes"),
          fetch("http://localhost:5000/api/brands"),
          fetch("http://localhost:5000/api/outlets"),
          fetch("http://localhost:5000/api/attribute-sets"),
        ]);
      const catData = await catRes.json();
      const taxData = await taxRes.json();
      const brandData = await brandRes.json();
      const outletData = await outletRes.json();
      const attrSetsData = await attrSetsRes.json();
      setCategories(catData.categories || []);
      setTaxes(taxData.taxes || []);
      setBrands(brandData.brands || []);
      setOutlets(outletData.outlets || []);
      setAttributeSets(attrSetsData.attributeSets || []);
    } catch (err) {
      console.error("Failed to fetch dropdowns", err);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchDropdowns();
  }, []); // Initial data load - external API calls, not cascading renders

  // Filter Products locally based on search
  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.barcode.includes(searchTerm),
  );

  // Calculate Pagination Data
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredProducts.slice(
    indexOfFirstItem,
    indexOfLastItem,
  );

  // Reset to page 1 when searching
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]); // Derived state reset - intentional pattern

  const openModal = (product = null) => {
    if (product) {
      setEditingProduct(product);
      setFormData({
        barcode: product.barcode,
        name: product.name,
        price: product.price,
        cost_price: product.cost_price ?? "",
        compare_at_price: product.compare_at_price ?? "",
        gst: product.gst ?? "",
        description_html: product.description_html || "",
        product_type: product.product_type || "",
        vendor: product.vendor || "",
        tags: product.tags || "",
        status: product.status || "active",
        stock: product.total_stock,
        category_id: product.category_id || "",
        tax_id: product.tax_id || "",
        brand_id: product.brand_id || "",
        outlet_id: "",
        attribute_set_id: product.attribute_set_id || "",
        has_variants: product.has_variants === 1,
        variants: [],
        min_qty: product.min_qty ?? "",
        max_qty: product.max_qty ?? "",
        unit: product.unit || "pcs",
        media: [],
      });
      fetch(`http://localhost:5000/api/products/${product.id}/media`)
        .then((r) => r.json())
        .then((d) => {
          setFormData((prev) => ({ ...prev, media: d.media || [] }));
        })
        .catch((err) => {
          console.error("Failed to load product media", err);
        });
    } else {
      setEditingProduct(null);
      const defaultTax = taxes.find((t) => t.is_default);
      const defaultOutlet = outlets.length > 0 ? outlets[0].id : "";
      setFormData({
        barcode: "",
        name: "",
        price: "",
        cost_price: "",
        compare_at_price: "",
        gst: "",
        description_html: "",
        product_type: "",
        vendor: "",
        tags: "",
        status: "active",
        stock: "",
        category_id: "",
        tax_id: defaultTax ? defaultTax.id : "",
        brand_id: "",
        outlet_id: defaultOutlet,
        attribute_set_id: "",
        has_variants: false,
        variants: [],
        min_qty: "",
        max_qty: "",
        unit: "pcs",
        media: [],
      });
    }
    setManualImageUrl("");
    setIsModalOpen(true);
  };

  const handleGenerateVariants = () => {
    const selectedSet = attributeSets.find(
      (s) => s.id === parseInt(formData.attribute_set_id),
    );
    if (
      !selectedSet ||
      !selectedSet.attributes ||
      selectedSet.attributes.length === 0
    ) {
      alert(
        "Please select a valid Attribute Set first, or ensure it has attributes configured.",
      );
      return;
    }

    const generateCombinations = (attributes) => {
      if (attributes.length === 0) return [[]];
      const result = [];
      const rest = generateCombinations(attributes.slice(1));
      for (const option of attributes[0].options) {
        for (const r of rest) {
          result.push([
            {
              attribute_id: attributes[0].id,
              attribute_option_id: option.id,
              value: option.value,
            },
            ...r,
          ]);
        }
      }
      return result;
    };

    const combs = generateCombinations(selectedSet.attributes);
    const generatedVariants = combs.map((comb, idx) => ({
      id: `temp-${idx}`,
      sku: `${formData.barcode || "SKU"}-${comb
        .map((c) => c.value)
        .join("-")
        .toUpperCase()}`,
      price: formData.price,
      compare_at_price: formData.compare_at_price || formData.price,
      cost_price: formData.cost_price,
      weight: 0,
      weight_unit: "kg",
      initial_stock: 0,
      options: comb,
    }));

    setFormData((prev) => ({
      ...prev,
      has_variants: true,
      variants: generatedVariants,
    }));
  };

  const updateVariantField = (idx, field, value) => {
    const newVariants = [...formData.variants];
    newVariants[idx][field] = value;
    setFormData({ ...formData, variants: newVariants });
  };

  const addManualImageUrl = () => {
    const url = manualImageUrl.trim();
    if (!url) return;
    setFormData((prev) => ({
      ...prev,
      media: [...(prev.media || []), { url, alt_text: "", position: (prev.media || []).length }],
    }));
    setManualImageUrl("");
  };

  const removeMediaItem = (index) => {
    setFormData((prev) => ({
      ...prev,
      media: (prev.media || []).filter((_, i) => i !== index).map((m, i) => ({ ...m, position: i })),
    }));
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const body = new FormData();
    body.append("image", file);
    setUploadingImage(true);
    try {
      const res = await fetch("http://localhost:5000/api/uploads/product-image", {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Image upload failed");
      }
      setFormData((prev) => ({
        ...prev,
        media: [...(prev.media || []), { url: data.url, alt_text: "", position: (prev.media || []).length }],
      }));
    } catch (err) {
      alert(`Image upload failed: ${err.message}`);
    } finally {
      setUploadingImage(false);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const url = editingProduct
      ? `http://localhost:5000/api/products/${editingProduct.id}`
      : "http://localhost:5000/api/products";

    const method = editingProduct ? "PUT" : "POST";

    try {
      const payload = {
        barcode: formData.barcode,
        name: formData.name,
        price: parseFloat(formData.price),
        cost_price: formData.cost_price ? parseFloat(formData.cost_price) : 0,
        compare_at_price: formData.compare_at_price ? parseFloat(formData.compare_at_price) : 0,
        gst: formData.gst ? parseFloat(formData.gst) : "",
        description_html: formData.description_html || null,
        product_type: formData.product_type || null,
        vendor: formData.vendor || null,
        tags: formData.tags || null,
        status: formData.status || "active",
        category_id: formData.category_id
          ? parseInt(formData.category_id)
          : null,
        tax_id: formData.tax_id ? parseInt(formData.tax_id) : null,
        brand_id: formData.brand_id ? parseInt(formData.brand_id) : null,
        attribute_set_id: formData.attribute_set_id
          ? parseInt(formData.attribute_set_id)
          : null,
        has_variants: formData.has_variants,
        variants: formData.variants,
        media: (formData.media || []).map((m, i) => ({
          url: m.url,
          alt_text: m.alt_text || null,
          position: i,
        })),
        min_qty: formData.min_qty !== "" ? parseInt(formData.min_qty) : 0,
        max_qty: formData.max_qty !== "" ? parseInt(formData.max_qty) : 0,
        unit: formData.unit || "pcs",
      };

      // Only send initial_stock and outlet_id on creation
      if (!editingProduct) {
        payload.initial_stock = formData.stock ? parseInt(formData.stock) : 0;
        payload.outlet_id = formData.outlet_id
          ? parseInt(formData.outlet_id)
          : null;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        fetchProducts(); // Refresh list
        closeModal();
      } else {
        const errorData = await res.json();
        alert(`Error: ${errorData.error}`);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to save product.");
    }
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // reset so same file can be re-selected
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const rows = parseCSV(ev.target.result);
      if (!rows.length) return alert("CSV appears empty or has no data rows.");
      setIsImporting(true);
      setImportResults(null);
      try {
        const res = await fetch("http://localhost:5000/api/products/bulk-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setImportResults(data.results);
        fetchProducts();
      } catch (err) {
        alert("Import failed: " + err.message);
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex-1 overflow-auto bg-slate-50 p-8 w-full h-full">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Inventory</h1>
          <p className="text-slate-500 mt-1">
            Manage your 5,000+ products here.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              exportCSV(
                products.map((p) => ({
                  barcode: p.barcode,
                  name: p.name,
                  price: p.price,
                  cost_price: p.cost_price,
                  compare_at_price: p.compare_at_price,
                  description_html: p.description_html,
                  product_type: p.product_type,
                  vendor: p.vendor,
                  tags: p.tags,
                  status: p.status,
                  gst: p.gst,
                  stock: p.total_stock ?? p.stock,
                  min_qty: p.min_qty,
                  max_qty: p.max_qty,
                  unit: p.unit,
                })),
                "inventory.csv",
              )
            }
            className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-all"
          >
            <Download size={18} /> Export CSV
          </button>
          <label className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-all cursor-pointer">
            <Upload size={18} />
            {isImporting ? "Importing…" : "Bulk Upload"}
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleImport}
              disabled={isImporting}
            />
          </label>
          <button
            onClick={() => openModal()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 shadow-lg shadow-blue-600/20 transition-all hover:-translate-y-0.5"
          >
            <Plus size={20} /> Add New Item
          </button>
        </div>
      </div>

      {/* Bulk Import Results */}
      {importResults && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6 overflow-hidden">
          <div className="flex justify-between items-center px-5 py-3 bg-slate-50 border-b border-slate-200">
            <span className="font-bold text-slate-700 text-sm">
              Import Results — {importResults.filter((r) => r.status !== "error").length} succeeded,{" "}
              {importResults.filter((r) => r.status === "error").length} failed
            </span>
            <button onClick={() => setImportResults(null)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
            {importResults.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-2 text-sm">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    r.status === "error"
                      ? "bg-red-100 text-red-600"
                      : r.status === "inserted"
                        ? "bg-green-100 text-green-700"
                        : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {r.status}
                </span>
                <span className="font-mono text-slate-500">{r.barcode}</span>
                <span className="text-slate-700">{r.name || r.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar / Search */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex gap-4 items-center">
        <div className="relative flex-1 max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-slate-400" />
          </div>
          <input
            type="text"
            placeholder="Search by name or barcode..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg leading-5 bg-slate-50 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 sm:text-sm transition-colors"
          />
        </div>
        <div className="text-sm font-medium text-slate-500">
          Showing {filteredProducts.length} items
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden w-full">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50/80">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Barcode
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Product Name
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Price
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Unit
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Min QTY
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Stock Level
                </th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {currentItems.map((product) => (
                <tr
                  key={product.id}
                  className="hover:bg-slate-50 transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 font-mono">
                    {product.barcode}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    <div className="flex items-center gap-2">
                      <span>{product.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase ${String(product.status || "active") === "active" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {product.status || "active"}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {product.vendor || "-"} {product.product_type ? `| ${product.product_type}` : ""}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right">
                    ${product.price ? product.price.toFixed(2) : "0.00"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 text-right">
                    {product.unit || "pcs"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 text-right">
                    {product.min_qty || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span
                      className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        product.total_stock <= 5
                          ? "bg-red-100 text-red-800"
                          : "bg-green-100 text-green-800"
                      }`}
                    >
                      {product.total_stock} in stock
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => openModal(product)}
                      className="text-blue-600 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                  <td
                    colSpan="7"
                    className="px-6 py-12 text-center text-slate-500"
                  >
                    <Package className="mx-auto h-12 w-12 text-slate-300 mb-3" />
                    No products found. Add some to get started!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-slate-200 sm:px-6">
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-slate-700">
                  Showing{" "}
                  <span className="font-medium">{indexOfFirstItem + 1}</span> to{" "}
                  <span className="font-medium">
                    {Math.min(indexOfLastItem, filteredProducts.length)}
                  </span>{" "}
                  of{" "}
                  <span className="font-medium">{filteredProducts.length}</span>{" "}
                  results
                </p>
              </div>
              <div>
                <nav
                  className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px"
                  aria-label="Pagination"
                >
                  <button
                    onClick={() =>
                      setCurrentPage((prev) => Math.max(prev - 1, 1))
                    }
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Previous
                  </button>
                  <span className="relative inline-flex items-center px-4 py-2 border border-slate-300 bg-white text-sm font-medium text-slate-700">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() =>
                      setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                    }
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Next
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-100 overflow-y-auto w-full"
          aria-labelledby="modal-title"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-slate-900/50 transition-opacity backdrop-blur-sm shadow-2xl"
              aria-hidden="true"
              onClick={closeModal}
            ></div>

            <span
              className="hidden sm:inline-block sm:align-middle sm:h-screen"
              aria-hidden="true"
            >
              &#8203;
            </span>

            <div className="inline-block align-bottom bg-white rounded-2xl text-left shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg w-full relative z-101">
              <form onSubmit={handleSave}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4 rounded-t-2xl">
                  <div className="flex justify-between items-center mb-5">
                    <h3
                      className="text-lg leading-6 font-bold text-slate-900"
                      id="modal-title"
                    >
                      {editingProduct ? "Edit Product" : "Add New Product"}
                    </h3>
                    <button
                      type="button"
                      onClick={closeModal}
                      className="text-slate-400 hover:text-slate-500 transition-colors"
                    >
                      <X size={24} />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Barcode
                      </label>
                      <input
                        required
                        type="text"
                        value={formData.barcode}
                        onChange={(e) =>
                          setFormData({ ...formData, barcode: e.target.value })
                        }
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="e.g. 123456789"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Product Name
                      </label>
                      <input
                        required
                        type="text"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="e.g. Coca Cola 500ml"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Selling Price ($)
                        </label>
                        <input
                          required
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.price}
                          onChange={(e) =>
                            setFormData({ ...formData, price: e.target.value })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Cost Price ($)
                        </label>
                        <input
                          required
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.cost_price}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              cost_price: e.target.value,
                            })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Compare-at Price ($)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.compare_at_price}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              compare_at_price: e.target.value,
                            })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Status
                        </label>
                        <select
                          value={formData.status}
                          onChange={(e) =>
                            setFormData({ ...formData, status: e.target.value })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="active">active</option>
                          <option value="draft">draft</option>
                          <option value="archived">archived</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Product Type
                        </label>
                        <input
                          type="text"
                          value={formData.product_type}
                          onChange={(e) =>
                            setFormData({ ...formData, product_type: e.target.value })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="e.g. Beverage"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Vendor
                        </label>
                        <input
                          type="text"
                          value={formData.vendor}
                          onChange={(e) =>
                            setFormData({ ...formData, vendor: e.target.value })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="e.g. Coca-Cola"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Tags (comma-separated)
                        </label>
                        <input
                          type="text"
                          value={formData.tags}
                          onChange={(e) =>
                            setFormData({ ...formData, tags: e.target.value })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="summer, featured, online"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Description (HTML/plain)
                        </label>
                        <textarea
                          rows={3}
                          value={formData.description_html}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              description_html: e.target.value,
                            })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Product description for online channels"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Product Images
                        </label>
                        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <label className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm cursor-pointer hover:bg-slate-100">
                              <ImagePlus size={16} />
                              {uploadingImage ? "Uploading..." : "Upload Image"}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleImageUpload}
                                disabled={uploadingImage}
                              />
                            </label>
                            <div className="flex-1 min-w-[220px] flex gap-2">
                              <input
                                type="url"
                                value={manualImageUrl}
                                onChange={(e) => setManualImageUrl(e.target.value)}
                                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                placeholder="Or paste external image URL"
                              />
                              <button
                                type="button"
                                onClick={addManualImageUrl}
                                className="px-3 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700"
                              >
                                Add URL
                              </button>
                            </div>
                          </div>

                          {(formData.media || []).length > 0 ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              {(formData.media || []).map((m, idx) => (
                                <div key={`${m.url}-${idx}`} className="relative group border border-slate-200 rounded-lg overflow-hidden bg-white">
                                  <img
                                    src={m.url.startsWith("http") ? m.url : `http://localhost:5000${m.url}`}
                                    alt={m.alt_text || `Product image ${idx + 1}`}
                                    className="w-full h-28 object-cover"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeMediaItem(idx)}
                                    className="absolute top-1 right-1 bg-red-600/90 hover:bg-red-700 text-white rounded p-1"
                                    title="Remove image"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500">
                              No images selected.
                            </p>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Category
                        </label>
                        <select
                          value={formData.category_id}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              category_id: e.target.value,
                            })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="">No Category</option>
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Brand
                        </label>
                        <select
                          value={formData.brand_id}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              brand_id: e.target.value,
                            })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="">No Brand</option>
                          {brands.map((brand) => (
                            <option key={brand.id} value={brand.id}>
                              {brand.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Tax Profile
                        </label>
                        <select
                          value={formData.tax_id}
                          onChange={(e) =>
                            setFormData({ ...formData, tax_id: e.target.value })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="">Legacy GST</option>
                          {taxes.map((tax) => (
                            <option key={tax.id} value={tax.id}>
                              {tax.name} ({tax.rate}%)
                            </option>
                          ))}
                        </select>
                      </div>
                      {!editingProduct && (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">
                            Stock Location (Outlet)
                          </label>
                          <select
                            required
                            value={formData.outlet_id}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                outlet_id: e.target.value,
                              })
                            }
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                          >
                            <option value="" disabled>
                              Select Initial Outlet
                            </option>
                            {outlets.map((outlet) => (
                              <option key={outlet.id} value={outlet.id}>
                                {outlet.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {!editingProduct && (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">
                            Variants (Attribute Set)
                          </label>
                          <div className="flex gap-2">
                            <select
                              value={formData.attribute_set_id}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  attribute_set_id: e.target.value,
                                })
                              }
                              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                            >
                              <option value="">
                                Simple Product (No Variants)
                              </option>
                              {attributeSets.map((set) => (
                                <option key={set.id} value={set.id}>
                                  {set.name}
                                </option>
                              ))}
                            </select>
                            {formData.attribute_set_id && (
                              <button
                                type="button"
                                onClick={handleGenerateVariants}
                                className="px-3 py-2 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-700 text-sm whitespace-nowrap"
                              >
                                Generate
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {!formData.has_variants && (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">
                            {editingProduct
                              ? "Total Stock (Read Only)"
                              : "Initial Stock Level"}
                          </label>
                          <input
                            required={!editingProduct}
                            type={editingProduct ? "text" : "number"}
                            min="0"
                            value={formData.stock}
                            onChange={(e) =>
                              !editingProduct &&
                              setFormData({
                                ...formData,
                                stock: e.target.value,
                              })
                            }
                            className={`w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${editingProduct ? "bg-slate-100 cursor-not-allowed" : ""}`}
                            placeholder="100"
                            readOnly={!!editingProduct}
                          />
                          {editingProduct && (
                            <p className="text-xs text-slate-500 mt-1">
                              Use Stock Adjustments/Transfers to manipulate
                              stock quantites.
                            </p>
                          )}
                        </div>
                      )}
                      {/* Unit of Measure + Reorder Levels */}
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Unit of Measure
                        </label>
                        <select
                          value={formData.unit}
                          onChange={(e) =>
                            setFormData({ ...formData, unit: e.target.value })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="pcs">pcs (Pieces)</option>
                          <option value="kg">kg (Kilogram)</option>
                          <option value="g">g (Gram)</option>
                          <option value="litre">litre</option>
                          <option value="ml">ml (Millilitre)</option>
                          <option value="box">box</option>
                          <option value="dozen">dozen</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Min QTY (Reorder Point)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={formData.min_qty}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              min_qty: e.target.value,
                            })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Max QTY (Max Stock Level)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={formData.max_qty}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              max_qty: e.target.value,
                            })
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="0"
                        />
                      </div>
                    </div>

                    {formData.has_variants && formData.variants.length > 0 && (
                      <div className="mt-4 border-t border-slate-200 pt-4">
                        <h4 className="font-bold text-slate-800 mb-3 flex items-center justify-between">
                          Generated Variants ({formData.variants.length})
                          <button
                            type="button"
                            onClick={() =>
                              setFormData({
                                ...formData,
                                has_variants: false,
                                variants: [],
                              })
                            }
                            className="text-xs text-red-500 hover:underline"
                          >
                            Clear
                          </button>
                        </h4>
                        <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg">
                          <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50 sticky top-0 shadow-sm z-10">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">
                                  Variant combination
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">
                                  SKU
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 w-24">
                                  Price
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 w-24">
                                  Cost
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 w-24">
                                  Compare-at
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 w-24">
                                  Weight
                                </th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 w-20">
                                  Stock
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-200">
                              {formData.variants.map((v, idx) => (
                                <tr key={v.id}>
                                  <td className="px-3 py-2 font-medium text-slate-700">
                                    {v.options.map((o) => o.value).join(" / ")}
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="text"
                                      value={v.sku}
                                      onChange={(e) =>
                                        updateVariantField(
                                          idx,
                                          "sku",
                                          e.target.value,
                                        )
                                      }
                                      className="w-full border border-slate-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500 font-mono text-xs"
                                      required
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={v.price}
                                      onChange={(e) =>
                                        updateVariantField(
                                          idx,
                                          "price",
                                          e.target.value,
                                        )
                                      }
                                      className="w-full border border-slate-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500"
                                      required
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={v.cost_price}
                                      onChange={(e) =>
                                        updateVariantField(
                                          idx,
                                          "cost_price",
                                          e.target.value,
                                        )
                                      }
                                      className="w-full border border-slate-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500"
                                      required
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={v.compare_at_price}
                                      onChange={(e) =>
                                        updateVariantField(
                                          idx,
                                          "compare_at_price",
                                          e.target.value,
                                        )
                                      }
                                      className="w-full border border-slate-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex gap-1">
                                      <input
                                        type="number"
                                        step="0.001"
                                        value={v.weight}
                                        onChange={(e) =>
                                          updateVariantField(
                                            idx,
                                            "weight",
                                            e.target.value,
                                          )
                                        }
                                        className="w-full border border-slate-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500"
                                      />
                                      <select
                                        value={v.weight_unit || "kg"}
                                        onChange={(e) =>
                                          updateVariantField(
                                            idx,
                                            "weight_unit",
                                            e.target.value,
                                          )
                                        }
                                        className="border border-slate-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500"
                                      >
                                        <option value="kg">kg</option>
                                        <option value="g">g</option>
                                        <option value="lb">lb</option>
                                        <option value="oz">oz</option>
                                      </select>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      value={v.initial_stock}
                                      onChange={(e) =>
                                        updateVariantField(
                                          idx,
                                          "initial_stock",
                                          e.target.value,
                                        )
                                      }
                                      className="w-full border border-slate-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500"
                                      required
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse border-t border-slate-200 rounded-b-2xl">
                  <button
                    type="submit"
                    className="w-full inline-flex justify-center rounded-lg border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm transition-colors"
                  >
                    <Save size={18} className="mr-2" />
                    {editingProduct ? "Update Product" : "Save Product"}
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="mt-3 w-full inline-flex justify-center rounded-lg border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 focus:outline-none sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
