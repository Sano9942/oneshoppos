import { API_BASE as API } from "../config";
import { useState, useEffect } from "react";
import {
  Package,
  Plus,
  Save,
  X,
  Search,
  Download,
  Upload,
  ImagePlus,
  Trash2,
  Tag,
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

// Parse a CSV string into an array of objects using the first row as headers
const parseCSV = (text) => {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        vals.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    vals.push(cur);
    return Object.fromEntries(
      headers.map((h, i) => [h, (vals[i] ?? "").trim()]),
    );
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
    sku: "",
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
      const res = await fetch(`${API}/api/products`);
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
          fetch(`${API}/api/categories`),
          fetch(`${API}/api/taxes`),
          fetch(`${API}/api/brands`),
          fetch(`${API}/api/outlets`),
          fetch(`${API}/api/attribute-sets`),
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
        sku: product.sku || "",
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
      fetch(`${API}/api/products/${product.id}/media`)
        .then((r) => r.json())
        .then((d) => {
          setFormData((prev) => ({ ...prev, media: d.media || [] }));
        })
        .catch((err) => {
          console.error("Failed to load product media", err);
        });

      if (product.has_variants === 1) {
        fetch(`${API}/api/products/${product.id}/variants`)
          .then((r) => r.json())
          .then((d) => {
            setFormData((prev) => ({ ...prev, variants: d.variants || [] }));
          })
          .catch((err) => {
            console.error("Failed to load product variants", err);
          });
      }
    } else {
      setEditingProduct(null);
      const defaultTax = taxes.find((t) => t.is_default);
      const defaultOutlet = outlets.length > 0 ? outlets[0].id : "";
      setFormData({
        barcode: "",
        sku: "",
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
      sku: `${formData.sku || formData.barcode || "SKU"}-${comb
        .map((c) => c.value)
        .join("-")
        .toUpperCase()}`,
      barcode: "",
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
      media: [
        ...(prev.media || []),
        { url, alt_text: "", position: (prev.media || []).length },
      ],
    }));
    setManualImageUrl("");
  };

  const removeMediaItem = (index) => {
    setFormData((prev) => ({
      ...prev,
      media: (prev.media || [])
        .filter((_, i) => i !== index)
        .map((m, i) => ({ ...m, position: i })),
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
      const res = await fetch(`${API}/api/uploads/product-image`, {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Image upload failed");
      }
      setFormData((prev) => ({
        ...prev,
        media: [
          ...(prev.media || []),
          { url: data.url, alt_text: "", position: (prev.media || []).length },
        ],
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
      ? `${API}/api/products/${editingProduct.id}`
      : `${API}/api/products`;

    const method = editingProduct ? "PUT" : "POST";

    try {
      const payload = {
        barcode: formData.barcode,
        sku: formData.sku || null,
        name: formData.name,
        price: parseFloat(formData.price),
        cost_price: formData.cost_price ? parseFloat(formData.cost_price) : 0,
        compare_at_price: formData.compare_at_price
          ? parseFloat(formData.compare_at_price)
          : 0,
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
        const res = await fetch(`${API}/api/products/bulk-import`, {
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
              Import Results —{" "}
              {importResults.filter((r) => r.status !== "error").length}{" "}
              succeeded,{" "}
              {importResults.filter((r) => r.status === "error").length} failed
            </span>
            <button
              onClick={() => setImportResults(null)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X size={16} />
            </button>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
            {importResults.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-5 py-2 text-sm"
              >
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
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] uppercase ${String(product.status || "active") === "active" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                      >
                        {product.status || "active"}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {product.vendor || "-"}{" "}
                      {product.product_type ? `| ${product.product_type}` : ""}
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

            <div className="inline-block align-bottom bg-slate-50 rounded-2xl text-left shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl w-full relative z-101 overflow-hidden">
              <form onSubmit={handleSave}>
                <div className="bg-slate-50 px-4 pt-5 pb-4 sm:p-8 sm:pb-6">
                  <div className="flex justify-between items-center mb-6">
                    <div>
                      <h3
                        className="text-2xl leading-6 font-bold text-slate-900"
                        id="modal-title"
                      >
                        {editingProduct ? "Edit Product" : "Add New Product"}
                      </h3>
                      <p className="text-sm text-slate-500 mt-2">
                        {editingProduct
                          ? `Managing ${formData.name}`
                          : "Create a new product for your catalog"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <select
                        value={formData.status}
                        onChange={(e) =>
                          setFormData({ ...formData, status: e.target.value })
                        }
                        className={`border rounded-lg px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white pr-8 relative ${formData.status === "active" ? "text-emerald-700 border-emerald-200" : "text-amber-700 border-amber-200"}`}
                      >
                        <option value="active">Active</option>
                        <option value="draft">Draft</option>
                        <option value="archived">Archived</option>
                      </select>
                      <button
                        type="button"
                        onClick={closeModal}
                        className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200 transition-all"
                      >
                        <X size={24} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column: Main Content */}
                    <div className="lg:col-span-2 space-y-6">
                      {/* Name & Description Section */}
                      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                              Title
                            </label>
                            <input
                              required
                              type="text"
                              value={formData.name}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  name: e.target.value,
                                })
                              }
                              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                              placeholder="e.g. Cotton T-Shirt"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                              Description
                            </label>
                            <textarea
                              rows={6}
                              value={formData.description_html}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  description_html: e.target.value,
                                })
                              }
                              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                              placeholder="Describe your product for the online store..."
                            />
                          </div>
                        </div>
                      </div>

                      {/* Media Section */}
                      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <h4 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                          <ImagePlus size={18} /> Media
                        </h4>
                        <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 bg-slate-50/50">
                          <div className="flex flex-wrap gap-4 items-center justify-center mb-6">
                            <label className="flex flex-col items-center gap-2 px-6 py-4 bg-white border border-slate-300 rounded-xl text-sm font-medium cursor-pointer hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm">
                              <Plus className="text-blue-600" size={24} />
                              <span>
                                {uploadingImage ? "Uploading..." : "Upload New"}
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleImageUpload}
                                disabled={uploadingImage}
                              />
                            </label>
                            <div className="flex-1 flex gap-2">
                              <input
                                type="url"
                                value={manualImageUrl}
                                onChange={(e) =>
                                  setManualImageUrl(e.target.value)
                                }
                                className="flex-1 border border-slate-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                placeholder="Paste image URL here"
                              />
                              <button
                                type="button"
                                onClick={addManualImageUrl}
                                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/10"
                              >
                                Add URL
                              </button>
                            </div>
                          </div>

                          {(formData.media || []).length > 0 ? (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                              {(formData.media || []).map((m, idx) => (
                                <div
                                  key={`${m.url}-${idx}`}
                                  className="relative group border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm aspect-square"
                                >
                                  <img
                                    src={
                                      m.url.startsWith("http")
                                        ? m.url
                                        : `${API}${m.url}`
                                    }
                                    alt={
                                      m.alt_text || `Product image ${idx + 1}`
                                    }
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeMediaItem(idx)}
                                    className="absolute top-2 right-2 bg-white/90 text-red-600 rounded-lg p-1.5 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-50 shadow-sm border border-red-100"
                                    title="Remove image"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-8">
                              <ImagePlus
                                size={48}
                                className="mx-auto text-slate-200 mb-2"
                              />
                              <p className="text-sm text-slate-400">
                                No products images attached yet.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Pricing Section */}
                      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <h4 className="text-sm font-bold text-slate-800 mb-4 ">
                          Pricing
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                              Price
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-2.5 text-slate-400">
                                $
                              </span>
                              <input
                                required
                                type="number"
                                step="0.01"
                                min="0"
                                value={formData.price}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    price: e.target.value,
                                  })
                                }
                                className="w-full border border-slate-300 rounded-lg pl-8 pr-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="0.00"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                              Compare-at price
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-2.5 text-slate-400">
                                $
                              </span>
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
                                className="w-full border border-slate-300 rounded-lg pl-8 pr-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="0.00"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                              Cost per item
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-2.5 text-slate-400">
                                $
                              </span>
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
                                className="w-full border border-slate-300 rounded-lg pl-8 pr-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="0.00"
                              />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">
                              Customers won't see this.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Inventory Section */}
                      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <h4 className="text-sm font-bold text-slate-800 mb-4 ">
                          Inventory
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-4">
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                SKU (Stock Keeping Unit)
                              </label>
                              <input
                                type="text"
                                value={formData.sku}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    sku: e.target.value,
                                  })
                                }
                                className="w-full border border-slate-300 rounded-lg px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                                placeholder="e.g. TSHIRT-RED-L"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                Barcode (ISBN, UPC, GTIN, etc.)
                              </label>
                              <input
                                type="text"
                                value={formData.barcode}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    barcode: e.target.value,
                                  })
                                }
                                className="w-full border border-slate-300 rounded-lg px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                                placeholder="Scan or enter barcode"
                              />
                            </div>
                          </div>

                          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-4">
                            {!formData.has_variants && (
                              <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                  {editingProduct
                                    ? "Available Stock (Locked)"
                                    : "Current Stock Level"}
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
                                  className={`w-full border border-slate-300 rounded-lg px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${editingProduct ? "bg-slate-100 cursor-not-allowed font-bold" : ""}`}
                                  placeholder="0"
                                  readOnly={!!editingProduct}
                                />
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">
                                  Min Qty
                                </label>
                                <input
                                  type="number"
                                  value={formData.min_qty}
                                  onChange={(e) =>
                                    setFormData({
                                      ...formData,
                                      min_qty: e.target.value,
                                    })
                                  }
                                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">
                                  Max Qty
                                </label>
                                <input
                                  type="number"
                                  value={formData.max_qty}
                                  onChange={(e) =>
                                    setFormData({
                                      ...formData,
                                      max_qty: e.target.value,
                                    })
                                  }
                                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Variants Section */}
                      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex justify-between items-center mb-4">
                          <h4 className="text-sm font-bold text-slate-800">
                            Variants
                          </h4>
                          {!editingProduct && (
                            <div className="flex gap-2 items-center">
                              <select
                                value={formData.attribute_set_id}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    attribute_set_id: e.target.value,
                                  })
                                }
                                className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
                              >
                                <option value="">Simple Product</option>
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
                                  className="text-xs bg-blue-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-blue-700"
                                >
                                  Generate
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {formData.has_variants &&
                        formData.variants.length > 0 ? (
                          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-slate-200 text-sm">
                                <thead className="bg-slate-50">
                                  <tr>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">
                                      Combination
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">
                                      SKU
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">
                                      Barcode
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase w-28">
                                      Price
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase w-20">
                                      Stock
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-200">
                                  {formData.variants.map((v, idx) => (
                                    <tr key={v.id || idx}>
                                      <td className="px-4 py-3 font-semibold text-slate-900 bg-slate-50/30">
                                        {v.options
                                          .map((o) => o.value)
                                          .join(" / ")}
                                      </td>
                                      <td className="px-2 py-2">
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
                                          className="w-full border border-slate-200 rounded px-2 py-1.5 focus:ring-blue-500 font-mono text-[10px]"
                                          placeholder="SKU"
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <input
                                          type="text"
                                          value={v.barcode}
                                          onChange={(e) =>
                                            updateVariantField(
                                              idx,
                                              "barcode",
                                              e.target.value,
                                            )
                                          }
                                          className="w-full border border-slate-200 rounded px-2 py-1.5 focus:ring-blue-500 font-mono text-[10px]"
                                          placeholder="Barcode"
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <div className="relative">
                                          <span className="absolute left-1.5 top-1.5 text-[10px] text-slate-400">
                                            $
                                          </span>
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
                                            className="w-full border border-slate-200 rounded pl-5 pr-1 py-1.5 focus:ring-blue-500 text-xs"
                                          />
                                        </div>
                                      </td>
                                      <td className="px-2 py-2">
                                        <input
                                          type="number"
                                          value={v.initial_stock || v.stock}
                                          onChange={(e) =>
                                            updateVariantField(
                                              idx,
                                              "initial_stock",
                                              e.target.value,
                                            )
                                          }
                                          className="w-full border border-slate-200 rounded px-2 py-1.5 focus:ring-blue-500 text-xs text-center"
                                        />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl">
                            <Tag
                              size={32}
                              className="mx-auto text-slate-200 mb-2"
                            />
                            <p className="text-sm text-slate-400">
                              This product has no variants like size or color.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Column: Organization */}
                    <div className="space-y-6">
                      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
                        <h4 className="text-sm font-bold text-slate-800 mb-2">
                          Organization
                        </h4>

                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                            Product Category
                          </label>
                          <select
                            value={formData.category_id}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                category_id: e.target.value,
                              })
                            }
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
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
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                            Brand / Vendor
                          </label>
                          <select
                            value={formData.brand_id}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                brand_id: e.target.value,
                              })
                            }
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
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
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                            Tags
                          </label>
                          <input
                            type="text"
                            value={formData.tags}
                            onChange={(e) =>
                              setFormData({ ...formData, tags: e.target.value })
                            }
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="summer, seasonal, sale"
                          />
                        </div>

                        <div className="pt-2 border-t border-slate-100">
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                            Tax Profile
                          </label>
                          <select
                            value={formData.tax_id}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                tax_id: e.target.value,
                              })
                            }
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                          >
                            <option value="">Legacy GST</option>
                            {taxes.map((tax) => (
                              <option key={tax.id} value={tax.id}>
                                {tax.name} ({tax.rate}%)
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
                        <h4 className="text-sm font-bold text-slate-800 mb-2">
                          Attributes
                        </h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                              Unit
                            </label>
                            <select
                              value={formData.unit}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  unit: e.target.value,
                                })
                              }
                              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                            >
                              <option value="pcs">pcs</option>
                              <option value="kg">kg</option>
                              <option value="litre">litre</option>
                              <option value="box">box</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                              Type
                            </label>
                            <input
                              type="text"
                              value={formData.product_type}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  product_type: e.target.value,
                                })
                              }
                              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                              placeholder="Clothing"
                            />
                          </div>
                        </div>

                        {!editingProduct && (
                          <div className="pt-2 border-t border-slate-100">
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5 italic text-blue-600">
                              Initial Stock Location
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
                              className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-blue-50/30"
                            >
                              <option value="" disabled>
                                Select Outlet
                              </option>
                              {outlets.map((outlet) => (
                                <option key={outlet.id} value={outlet.id}>
                                  {outlet.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white px-6 py-4 flex flex-row-reverse gap-3 border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                  <button
                    type="submit"
                    className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-xl px-8 py-2.5 bg-blue-600 text-white font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 active:scale-95"
                  >
                    <Save size={18} className="mr-2" />
                    {editingProduct ? "Save Changes" : "Create Product"}
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 sm:flex-none inline-flex justify-center rounded-xl border border-slate-300 px-6 py-2.5 bg-white text-slate-700 font-bold hover:bg-slate-50 transition-all active:scale-95"
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
