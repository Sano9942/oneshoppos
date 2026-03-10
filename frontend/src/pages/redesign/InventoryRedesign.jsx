import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useNavigate } from "react-router-dom";
import { BarChart2, CreditCard, Download, Hash, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { API_BASE as API } from "../../config";
import { fmtUtcDateTime } from "../../utils/dates";
import {
  Badge,
  BulkActionBar,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";
import { useAuth } from "../../auth/AuthProvider";
import { indentLabel, leafCategories, sortCategories } from "../../utils/categoryTree";

const PAGE_SIZE = 50;

const BLANK_FORM = {
  name: "", barcode: "", sku: "", price: "", cost_price: "",
  stock: "", category_id: "", brand_id: "", status: "active", unit: "pcs",
  product_type: "", vendor: "", tags: "", image_url: "",
};


// Columns that must be treated as text in Excel to preserve leading zeros.
// We emit them as ="value" (Excel text-formula) so Excel never auto-casts to number.
const TEXT_COLS = new Set(["barcode", "sku"]);

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const headers = keys.join(",");
  const body = rows.map((r) =>
    keys
      .map((k) => {
        const v = String(r[k] ?? "");
        if (TEXT_COLS.has(k)) {
          // ="002990" forces Excel to treat as text — inner quotes escaped as ""
          return `="${v.replace(/"/g, '""')}"`;
        }
        return `"${v.replace(/"/g, '""')}"`;
      })
      .join(","),
  );
  const blob = new Blob([[headers, ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const CSV_IMPORT_HEADERS = [
  "name", "barcode", "sku", "price", "cost_price", "compare_at_price",
  "stock", "outlet_id", "supplier_name", "unit", "status", "product_type", "vendor", "tags",
  "description_html", "gst", "min_qty", "max_qty",
];

// Indices (0-based) of TEXT_COLS within CSV_IMPORT_HEADERS — used to pre-format xlsx template
const TEXT_COL_INDICES = CSV_IMPORT_HEADERS.reduce((acc, h, i) => {
  if (TEXT_COLS.has(h)) acc.push(i);
  return acc;
}, []);

function downloadImportTemplate(outlets = []) {
  const wb = XLSX.utils.book_new();
  const sampleRow = {
    name: "Sample Product",
    barcode: "001234",
    sku: "SKU-001",
    price: 99.99,
    cost_price: 50,
    compare_at_price: "",
    stock: 10,
    outlet_id: outlets[0]?.id ?? "",
    supplier_name: "",
    unit: "pcs",
    status: "active",
    product_type: "",
    vendor: "",
    tags: "",
    description_html: "",
    gst: "",
    min_qty: "",
    max_qty: "",
  };
  // Build 500 rows: row 1 = sample, rows 2-500 = blank but with Text-formatted barcode/sku cells
  const TEMPLATE_ROWS = 500;
  const allRows = [sampleRow];
  for (let i = 1; i < TEMPLATE_ROWS; i++) {
    const blank = {};
    CSV_IMPORT_HEADERS.forEach((h) => { blank[h] = ""; });
    allRows.push(blank);
  }
  const ws = XLSX.utils.json_to_sheet(allRows, { header: CSV_IMPORT_HEADERS });

  // Force Text format on every barcode/sku cell (rows 1-500) so leading zeros are
  // preserved whether the user types, pastes, or drags values into any row
  TEXT_COL_INDICES.forEach((colIdx) => {
    for (let rowIdx = 0; rowIdx <= TEMPLATE_ROWS; rowIdx++) {
      const addr = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
      if (!ws[addr]) ws[addr] = { t: "s", v: rowIdx === 0 ? "barcode" : "", z: "@" };
      ws[addr].t = "s";
      ws[addr].z = "@";
    }
    if (!ws["!cols"]) ws["!cols"] = [];
    ws["!cols"][colIdx] = { wch: 20, z: "@" };
  });

  XLSX.utils.book_append_sheet(wb, ws, "Products");

  // Second sheet: branch reference so users know which outlet_id to use
  if (outlets.length > 0) {
    const outletRows = outlets.map((o) => ({ outlet_id: o.id, branch_name: o.name }));
    const wsOutlets = XLSX.utils.json_to_sheet(outletRows, { header: ["outlet_id", "branch_name"] });
    wsOutlets["!cols"] = [{ wch: 12 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsOutlets, "Branches (reference)");
  }

  XLSX.writeFile(wb, "products-import-template.xlsx");
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    // Handle quoted fields with commas inside
    const values = [];
    let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === "," && !inQuote) { values.push(cur); cur = ""; continue; }
      cur += ch;
    }
    values.push(cur);
    const row = {};
    headers.forEach((h, i) => {
      let val = (values[i] || "").trim();
      // Strip Excel text-formula wrapper ="..." that may appear after a round-trip
      if (val.startsWith('="') && val.endsWith('"')) val = val.slice(2, -1);
      row[h] = val;
    });
    return row;
  });
}

export default function InventoryRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const navigate = useNavigate();
  const canViewAllLocations = hasPerm("all_access");
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [status, setStatus] = useState("");
  const [outletFilter, setOutletFilter] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState("");
  const [importResults, setImportResults] = useState(null); // null=closed, array=results
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef(null);
  const [page, setPage] = useState(1);

  // Stock popup
  const [stockPopup, setStockPopup] = useState(null); // { productId, productName, loading, stock: [] }

  // Serials modal
  const [serialsModal, setSerialsModal] = useState(null); // { productId, productName, loading, serials: [], newSerials: "" }
  const [serialsSaving, setSerialsSaving] = useState(false);

  // Gift cards
  const [activeTab, setActiveTab] = useState("products"); // "products" | "giftcards"
  const [giftCards, setGiftCards] = useState([]);
  const [giftCardsLoading, setGiftCardsLoading] = useState(false);
  const [gcInitialValue, setGcInitialValue] = useState("");
  const [gcGenerating, setGcGenerating] = useState(false);
  const [gcLookupCode, setGcLookupCode] = useState("");
  const [gcLookupResult, setGcLookupResult] = useState(null);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (status) qs.set("status", status);
      if (categoryId) qs.set("category_id", categoryId);
      if (outletFilter) qs.set("outlet_id", outletFilter);
      qs.set("sort", sortField);
      qs.set("order", sortOrder);
      const res = await fetch(`${API}/api/products?${qs}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setProducts(data.products || []);
      setSelectedIds(new Set());
      setPage(1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const [catRes, brandRes, outletRes] = await Promise.all([
        fetch(`${API}/api/categories`, { headers: authHeaders() }),
        fetch(`${API}/api/brands`, { headers: authHeaders() }),
        fetch(`${API}/api/outlets`, { headers: authHeaders() }),
      ]);
      const catData = await catRes.json();
      const brandData = await brandRes.json();
      const outletData = await outletRes.json();
      setCategories(sortCategories(catData.categories || []));
      setBrands(brandData.brands || []);
      setOutlets(outletData.outlets || []);
    } catch (err) {
      console.error(err);
    }
  };

  const openStockPopup = async (productId, productName, e) => {
    e.stopPropagation();
    setStockPopup({ productId, productName, loading: true, stock: [] });
    try {
      const res = await fetch(`${API}/api/products/${productId}/stock`, { headers: authHeaders() });
      const data = await res.json();
      setStockPopup({ productId, productName, loading: false, stock: data.stock || [] });
    } catch {
      setStockPopup((prev) => prev && ({ ...prev, loading: false }));
    }
  };

  const openSerialsModal = async (productId, productName, e) => {
    e.stopPropagation();
    setSerialsModal({ productId, productName, loading: true, serials: [], newSerials: "" });
    try {
      const res = await fetch(`${API}/api/products/${productId}/serials`, { headers: authHeaders() });
      const data = await res.json();
      setSerialsModal({ productId, productName, loading: false, serials: data.serials || [], newSerials: "" });
    } catch {
      setSerialsModal((prev) => prev && ({ ...prev, loading: false }));
    }
  };

  const addSerials = async () => {
    if (!serialsModal || !serialsModal.newSerials.trim()) return;
    const serial_numbers = serialsModal.newSerials.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!serial_numbers.length) return;
    setSerialsSaving(true);
    try {
      const res = await fetch(`${API}/api/products/${serialsModal.productId}/serials`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ serial_numbers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add serials");
      // Refresh serials list
      const refetch = await fetch(`${API}/api/products/${serialsModal.productId}/serials`, { headers: authHeaders() });
      const refetchData = await refetch.json();
      setSerialsModal((prev) => prev && ({ ...prev, serials: refetchData.serials || [], newSerials: "" }));
    } catch (err) {
      alert(err.message);
    } finally {
      setSerialsSaving(false);
    }
  };

  const fetchGiftCards = async () => {
    setGiftCardsLoading(true);
    try {
      const res = await fetch(`${API}/api/gift-cards`, { headers: authHeaders() });
      const data = await res.json();
      setGiftCards(data.giftCards || data.gift_cards || []);
    } catch {
      // non-fatal
    } finally {
      setGiftCardsLoading(false);
    }
  };

  const generateGiftCard = async () => {
    const val = Number(gcInitialValue);
    if (!val || val <= 0) { alert("Enter a valid initial value."); return; }
    setGcGenerating(true);
    try {
      const res = await fetch(`${API}/api/gift-cards`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ initial_value: val }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate gift card");
      setGcInitialValue("");
      alert(`Gift card generated!\nCode: ${data.code || data.gift_card?.code || "—"}`);
      await fetchGiftCards();
    } catch (err) {
      alert(err.message);
    } finally {
      setGcGenerating(false);
    }
  };

  const lookupGiftCard = async () => {
    if (!gcLookupCode.trim()) return;
    try {
      const res = await fetch(`${API}/api/gift-cards/${encodeURIComponent(gcLookupCode.trim())}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Not found");
      setGcLookupResult(data.giftCard || data.gift_card || data);
    } catch (err) {
      setGcLookupResult({ error: err.message });
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (canViewAllLocations) return;
    if (outletFilter) return;
    if (!outlets.length) return;
    setOutletFilter(String(outlets[0].id));
  }, [canViewAllLocations, outletFilter, outlets]);

  useEffect(() => {
    if (activeTab === "giftcards") fetchGiftCards();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(fetchProducts, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, sortField, sortOrder, status, categoryId, outletFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const paged = useMemo(
    () => products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, products],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const toggleSort = (field) => {
    if (sortField === field) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPage = () => {
    const allSelected = paged.length > 0 && paged.every((p) => selectedIds.has(p.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paged.forEach((p) => {
        if (allSelected) next.delete(p.id);
        else next.add(p.id);
      });
      return next;
    });
  };

  const runBulk = async (path, payload, successMessage = null) => {
    setBulkWorking(true);
    try {
      const res = await fetch(`${API}/api/products/${path}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk action failed");
      if (successMessage) alert(successMessage(data));
      setSelectedIds(new Set());
      await fetchProducts();
    } catch (err) {
      alert(err.message);
    } finally {
      setBulkWorking(false);
    }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    let rows;
    const isXlsx = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    if (isXlsx) {
      // Parse xlsx using SheetJS — values are already typed correctly (no leading-zero loss)
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellText: true, cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // raw:false keeps everything as strings (preserves leading zeros stored as text)
      rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
    } else {
      const text = await file.text();
      rows = parseCSV(text);
    }
    // Strip blank rows (template has 500 pre-formatted rows; only send ones with a name)
    rows = rows.filter((r) => String(r.name || "").trim() !== "");
    if (!rows.length) return alert("File is empty or unreadable.");
    setImporting(true);
    try {
      const res = await fetch(`${API}/api/products/bulk-import`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportResults(data.results || []);
      await fetchProducts();
    } catch (err) {
      alert(err.message);
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = selectedIds.size;

  return (
    <>
    <PageShell
      title="Products"
      subtitle="Manage products, pricing, stock levels, and variants."
      right={
        <div className="flex items-center gap-2">
          <button
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${activeTab === "products" ? "bg-(--ui-primary) text-white" : "text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"}`}
            onClick={() => setActiveTab("products")}
          >
            Products
          </button>
          <button
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${activeTab === "giftcards" ? "bg-(--ui-primary) text-white" : "text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"}`}
            onClick={() => setActiveTab("giftcards")}
          >
            <CreditCard size={13} className="mr-1 inline" />
            Gift Cards
          </button>
          <Button onClick={() => downloadImportTemplate(outlets)}>
            <Download size={14} className="mr-1 inline" />
            Template
          </Button>
          <Button onClick={() => importFileRef.current?.click()} disabled={importing}>
            <Upload size={14} className="mr-1 inline" />
            {importing ? "Importing…" : "Import"}
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept=".csv,text/csv,.xlsx,.xls"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button
            onClick={() =>
              exportCSV(
                products.map((p) => ({
                  id: p.id,
                  barcode: p.barcode,
                  sku: p.sku || "",
                  name: p.name,
                  status: p.status || "active",
                  category: p.category_name || "",
                  category_path: p.category_path_label || p.category_name || "",
                  product_type: p.product_type || "",
                  vendor: p.vendor || "",
                  tags: p.tags || "",
                  price: p.price,
                  cost_price: p.cost_price || 0,
                  stock: p.total_stock,
                })),
                "inventory-export.csv",
              )
            }
          >
            <Download size={14} className="mr-1 inline" />
            Export all
          </Button>
          <Button tone="primary" onClick={() => navigate("/products/new")}>
            <Plus size={14} className="mr-1 inline" />
            Add Product
          </Button>
        </div>
      }
    >
      {activeTab === "giftcards" ? (
        <SectionCard className="p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-semibold text-(--ui-text)">Gift Cards</p>
            <Button size="sm" onClick={fetchGiftCards} disabled={giftCardsLoading}>Refresh</Button>
          </div>

          {/* Generate new gift card */}
          <div className="mb-4 flex items-end gap-2 rounded border border-(--ui-border) bg-(--ui-muted-surface) p-3">
            <div>
              <label className="mb-1 block text-xs text-(--ui-text-muted)">Initial Value (PKRs)</label>
              <Input
                type="number"
                min="1"
                step="0.01"
                value={gcInitialValue}
                onChange={(e) => setGcInitialValue(e.target.value)}
                placeholder="e.g. 500"
                className="w-40"
              />
            </div>
            <Button tone="primary" onClick={generateGiftCard} disabled={gcGenerating}>
              <CreditCard size={13} className="mr-1 inline" />
              {gcGenerating ? "Generating..." : "Generate Gift Card"}
            </Button>
          </div>

          {/* Lookup */}
          <div className="mb-4 flex items-end gap-2 rounded border border-(--ui-border) p-3">
            <div>
              <label className="mb-1 block text-xs text-(--ui-text-muted)">Look up Gift Card</label>
              <Input
                value={gcLookupCode}
                onChange={(e) => { setGcLookupCode(e.target.value); setGcLookupResult(null); }}
                placeholder="Enter code"
                className="w-52"
              />
            </div>
            <Button onClick={lookupGiftCard}>Lookup</Button>
            {gcLookupResult ? (
              gcLookupResult.error ? (
                <p className="text-sm text-rose-600">{gcLookupResult.error}</p>
              ) : (
                <div className="text-sm">
                  <span className="font-mono font-medium text-(--ui-text)">{gcLookupResult.code}</span>
                  {" · "}
                  <span className="text-(--ui-text-muted)">
                    Balance: PKRs {Number(gcLookupResult.remaining_value ?? gcLookupResult.balance ?? 0).toFixed(2)}
                  </span>
                  {" · "}
                  <Badge tone={gcLookupResult.status === "active" ? "success" : "default"}>
                    {gcLookupResult.status || "active"}
                  </Badge>
                </div>
              )
            ) : null}
          </div>

          {/* Gift cards list */}
          <div className="overflow-auto">
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-right">Initial Value</th>
                  <th className="px-3 py-2 text-right">Remaining</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {giftCards.map((gc) => (
                  <tr key={gc.id} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2 font-mono text-xs text-(--ui-text)">{gc.code}</td>
                    <td className="px-3 py-2 text-right text-(--ui-text)">
                      PKRs {Number(gc.initial_value || 0).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-(--ui-text)">
                      PKRs {Number(gc.remaining_value ?? gc.balance ?? gc.initial_value ?? 0).toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={gc.status === "active" ? "success" : "default"}>{gc.status || "active"}</Badge>
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">{fmtUtcDateTime(gc.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {giftCardsLoading ? (
              <p className="p-6 text-center text-sm text-(--ui-text-muted)">Loading gift cards...</p>
            ) : null}
            {!giftCardsLoading && giftCards.length === 0 ? (
              <p className="p-6 text-center text-sm text-(--ui-text-muted)">No gift cards yet. Generate one above.</p>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {activeTab === "products" ? <SectionCard>
        <TableToolbar
          left={
            <>
              <div className="relative min-w-65">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
                />
                <Input
                  className="pl-8"
                  placeholder="Search name, barcode, SKU"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="inactive">Inactive</option>
              </Select>
              <Select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {indentLabel(c)}
                  </option>
                ))}
              </Select>
              <Select value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)}>
                {canViewAllLocations ? <option value="">All locations</option> : null}
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
              <Select
                value={`${sortField}:${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split(":");
                  setSortField(field);
                  setSortOrder(order);
                }}
              >
                <option value="name:asc">Name (A-Z)</option>
                <option value="name:desc">Name (Z-A)</option>
                <option value="price:asc">Price (Low-High)</option>
                <option value="price:desc">Price (High-Low)</option>
                <option value="stock:desc">Stock (High-Low)</option>
                <option value="stock:asc">Stock (Low-High)</option>
                <option value="cost_price:asc">Cost (Low-High)</option>
                <option value="cost_price:desc">Cost (High-Low)</option>
                <option value="created_at:desc">Newest</option>
              </Select>
            </>
          }
          right={<p className="text-sm text-(--ui-text-muted)">{products.length} items</p>}
        />

        <div className="p-3">
          {selectedCount > 0 ? (
            <BulkActionBar>
              <span className="text-sm font-semibold text-emerald-800">
                {selectedCount} selected
              </span>
              <Button
                tone="danger"
                size="sm"
                disabled={bulkWorking}
                onClick={() => {
                  if (
                    window.confirm(
                      `Archive ${selectedCount} products? They will be hidden from listings but preserved in history.`,
                    )
                  ) {
                    runBulk(
                      "bulk-delete",
                      { ids: [...selectedIds] },
                      (d) => `Archived ${d.deleted} products`,
                    );
                  }
                }}
              >
                <Trash2 size={13} className="mr-1 inline" />
                Archive
              </Button>
              <Button
                size="sm"
                disabled={bulkWorking}
                onClick={() =>
                  runBulk("bulk-status", {
                    ids: [...selectedIds],
                    status: "active",
                  })
                }
              >
                Set Active
              </Button>
              <Button
                size="sm"
                disabled={bulkWorking}
                onClick={() =>
                  runBulk("bulk-status", {
                    ids: [...selectedIds],
                    status: "inactive",
                  })
                }
              >
                Set Inactive
              </Button>
              <Select
                value={bulkCategoryTarget}
                onChange={(e) => setBulkCategoryTarget(e.target.value)}
              >
                <option value="">Assign category...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.is_leaf}>
                    {indentLabel(c)}{c.is_leaf ? "" : " (parent)"}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={!bulkCategoryTarget || bulkWorking}
                onClick={() =>
                  runBulk("bulk-category", {
                    ids: [...selectedIds],
                    category_id: Number(bulkCategoryTarget),
                  })
                }
              >
                Apply category
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  exportCSV(
                    products
                      .filter((p) => selectedIds.has(p.id))
                      .map((p) => ({
                        id: p.id,
                        barcode: p.barcode,
                        name: p.name,
                        status: p.status || "active",
                        category_path: p.category_path_label || p.category_name || "",
                        product_type: p.product_type || "",
                        vendor: p.vendor || "",
                        tags: p.tags || "",
                        price: p.price,
                        stock: p.total_stock,
                      })),
                    "inventory-selected.csv",
                  )
                }
              >
                <Download size={13} className="mr-1 inline" />
                Export selected
              </Button>
              <Button size="sm" tone="plain" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </BulkActionBar>
          ) : null}
        </div>

        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface)">
              <tr className="text-left text-xs uppercase tracking-wide text-(--ui-text-muted)">
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={
                      paged.length > 0 && paged.every((p) => selectedIds.has(p.id))
                    }
                    onChange={toggleSelectPage}
                  />
                </th>
                <th className="px-3 py-2 w-10"></th>
                <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort("name")}>
                  Product
                </th>
                <th className="px-3 py-2">Barcode</th>
                <th className="px-3 py-2">SKU</th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("price")}>
                  Price
                </th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("cost_price")}>
                  Cost
                </th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("stock")}>
                  Stock
                </th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Tools</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t border-(--ui-border) cursor-pointer ${
                    selectedIds.has(p.id) ? "bg-emerald-50" : "hover:bg-slate-50 bg-white"
                  }`}
                  onClick={() => navigate(`/products/${p.id}`)}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                    />
                  </td>
                  <td className="px-3 py-2 w-10">
                    {p.image_url ? (
                      <img
                        src={p.image_url.startsWith("/uploads") ? `${API}${p.image_url}` : p.image_url}
                        alt=""
                        className="w-8 h-8 rounded object-cover border border-(--ui-border)"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-(--ui-muted-surface) border border-(--ui-border)" />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-(--ui-text)">{p.name}</div>
                    <div className="text-xs text-(--ui-text-muted)">
                      {p.vendor || "-"} {p.product_type ? `| ${p.product_type}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-(--ui-text-muted)">
                    {p.barcode || "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-(--ui-text-muted)">
                    {p.sku || "-"}
                  </td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">
                    PKRs {(Number(p.price || 0)).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right text-(--ui-text-muted)">
                    PKRs {(Number(p.cost_price || 0)).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">
                    {p.total_stock ?? 0}
                  </td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">
                    {p.category_path_label || p.category_name || "-"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      tone={
                        String(p.status || "active") === "active"
                          ? "success"
                          : String(p.status) === "draft"
                            ? "warning"
                            : "danger"
                      }
                    >
                      {p.status || "active"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="Stock by outlet"
                        className="rounded p-1 text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text)"
                        onClick={(e) => openStockPopup(p.id, p.name, e)}
                      >
                        <BarChart2 size={14} />
                      </button>
                      <button
                        title="Serial numbers"
                        className="rounded p-1 text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text)"
                        onClick={(e) => openSerialsModal(p.id, p.name, e)}
                      >
                        <Hash size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && products.length === 0 ? (
            <EmptyState
              title="No products found"
              body="Try changing filters, or import products from Shopify."
            />
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-(--ui-border) p-3">
          <span className="text-xs text-(--ui-text-muted)">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </SectionCard> : null}
    </PageShell>
    {importResults !== null && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-(--ui-border)">
            <div>
              <p className="font-semibold text-(--ui-text)">Import Results</p>
              <p className="text-xs text-(--ui-text-muted)">
                {importResults.filter((r) => r.status === "inserted").length} inserted &nbsp;·&nbsp;
                {importResults.filter((r) => r.status === "error").length} errors
              </p>
            </div>
            <button onClick={() => setImportResults(null)} className="text-(--ui-text-muted) hover:text-(--ui-text)">
              <X size={18} />
            </button>
          </div>
          <div className="overflow-y-auto flex-1 px-5 py-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-(--ui-text-muted) border-b border-(--ui-border)">
                  <th className="py-2 pr-3">Row</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Barcode</th>
                  <th className="py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {importResults.map((r, i) => (
                  <tr key={i} className="border-t border-(--ui-border)">
                    <td className="py-1.5 pr-3 text-(--ui-text-muted)">{i + 1}</td>
                    <td className="py-1.5 pr-3 text-(--ui-text)">{r.name || "-"}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-(--ui-text-muted)">{r.barcode || "-"}</td>
                    <td className="py-1.5">
                      {r.status === "inserted" ? (
                        <span className="text-emerald-600 font-medium">Inserted</span>
                      ) : (
                        <span className="text-red-600 text-xs">{r.message || "Error"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-(--ui-border) flex justify-end">
            <Button onClick={() => setImportResults(null)}>Close</Button>
          </div>
        </div>
      </div>
    )}

    {/* Stock by outlet popup */}
    {stockPopup ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
        <div className="w-full max-w-sm rounded-xl border border-(--ui-border) bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-(--ui-border) px-4 py-3">
            <div>
              <p className="font-semibold text-(--ui-text)">Stock by Outlet</p>
              <p className="text-xs text-(--ui-text-muted)">{stockPopup.productName}</p>
            </div>
            <button className="text-(--ui-text-muted) hover:text-(--ui-text)" onClick={() => setStockPopup(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="overflow-auto p-4">
            {stockPopup.loading ? (
              <p className="py-4 text-center text-sm text-(--ui-text-muted)">Loading...</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--ui-border) text-left text-xs uppercase text-(--ui-text-muted)">
                    <th className="pb-2 pr-4">Outlet</th>
                    <th className="pb-2 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {(stockPopup.stock || []).map((s) => (
                    <tr key={s.outlet_id} className="border-t border-(--ui-border)">
                      <td className="py-1.5 pr-4 text-(--ui-text)">{s.outlet_name || `Outlet #${s.outlet_id}`}</td>
                      <td className="py-1.5 text-right font-medium text-(--ui-text)">{s.quantity ?? 0}</td>
                    </tr>
                  ))}
                  {(stockPopup.stock || []).length > 1 ? (
                    <tr className="border-t-2 border-(--ui-border) font-semibold">
                      <td className="py-1.5 pr-4 text-(--ui-text)">Total</td>
                      <td className="py-1.5 text-right text-(--ui-text)">
                        {(stockPopup.stock || []).reduce((sum, s) => sum + (s.quantity ?? 0), 0)}
                      </td>
                    </tr>
                  ) : null}
                  {(stockPopup.stock || []).length === 0 ? (
                    <tr>
                      <td colSpan="2" className="py-4 text-center text-xs text-(--ui-text-muted)">No stock data</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex justify-end border-t border-(--ui-border) px-4 py-3">
            <Button size="sm" onClick={() => setStockPopup(null)}>Close</Button>
          </div>
        </div>
      </div>
    ) : null}

    {/* Serial numbers modal */}
    {serialsModal ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
        <div className="w-full max-w-md rounded-xl border border-(--ui-border) bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-(--ui-border) px-4 py-3">
            <div>
              <p className="font-semibold text-(--ui-text)">Serial Numbers</p>
              <p className="text-xs text-(--ui-text-muted)">{serialsModal.productName}</p>
            </div>
            <button className="text-(--ui-text-muted) hover:text-(--ui-text)" onClick={() => setSerialsModal(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="max-h-[40vh] overflow-auto p-4">
            {serialsModal.loading ? (
              <p className="py-4 text-center text-sm text-(--ui-text-muted)">Loading...</p>
            ) : (
              <>
                {(serialsModal.serials || []).length === 0 ? (
                  <p className="text-center text-sm text-(--ui-text-muted)">No serial numbers yet.</p>
                ) : (
                  <div className="space-y-1">
                    {serialsModal.serials.map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded border border-(--ui-border) px-2 py-1">
                        <span className="font-mono text-xs text-(--ui-text)">{s.serial_number}</span>
                        <Badge tone={s.status === "available" ? "success" : "default"}>
                          {s.status || "available"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="border-t border-(--ui-border) p-4">
            <p className="mb-2 text-xs font-medium text-(--ui-text-muted)">Add Serial Numbers (one per line)</p>
            <textarea
              className="w-full rounded border border-(--ui-border) p-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-(--ui-primary)"
              rows={4}
              placeholder={"SN-001\nSN-002\nSN-003"}
              value={serialsModal.newSerials}
              onChange={(e) => setSerialsModal((prev) => prev && ({ ...prev, newSerials: e.target.value }))}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" onClick={() => setSerialsModal(null)}>Close</Button>
              <Button size="sm" tone="primary" onClick={addSerials} disabled={serialsSaving}>
                <Hash size={12} className="mr-1 inline" />
                {serialsSaving ? "Adding..." : "Add Serials"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
