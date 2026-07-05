import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookTemplate,
  CheckCircle2,
  ChevronRight,
  Download,
  PackageCheck,
  Pencil,
  Plus,
  Save,
  ScanBarcode,
  Search,
  Send,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useCurrency } from "../../contexts/CurrencyContext";
import { fmtDate, fmtDateTime, todayLocalStr } from "../../utils/dates";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";

function statusTone(status) {
  if (status === "Received") return "success";
  if (status === "Approved") return "info";
  if (status === "pending_approval") return "warning";
  return "default";
}

function poNumber(id) {
  return `PO-${String(id || "").padStart(4, "0")}`;
}

function exportCSV(rows) {
  if (!rows.length) return;
  const headers = ["id", "supplier_name", "total_cost", "status", "due_date", "created_at"];
  const body = rows.map((r) =>
    [r.id, r.supplier_name, Number(r.total_cost || 0), r.status, r.due_date || "", r.created_at]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[headers.join(","), ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `purchase_orders_${todayLocalStr()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function PurchaseOrdersRedesign() {
  const { employee, hasPerm, authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  const { fmt: money } = useCurrency();
  const [view, setView] = useState("list");
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warn, setWarn] = useState("");
  const [search, setSearch] = useState("");

  const [selectedPo, setSelectedPo] = useState(null); // { purchaseOrder, items }
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [approvingId, setApprovingId] = useState(null);
  const [editingPo, setEditingPo] = useState(null); // PO row being edited
  const [editForm, setEditForm] = useState({ supplier_id: "", due_date: "" });
  const [editCart, setEditCart] = useState([]);
  const [editProductSearch, setEditProductSearch] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  const [form, setForm] = useState({ supplier_id: "", due_date: "" });
  const [productSearch, setProductSearch] = useState("");
  const [cart, setCart] = useState([]);

  const [grnOpen, setGrnOpen] = useState(false);
  const [grnOutletId, setGrnOutletId] = useState("");
  const [grnReceivedBy, setGrnReceivedBy] = useState("");
  const [grnNotes, setGrnNotes] = useState("");
  const [grnQtys, setGrnQtys] = useState({});
  // F07: per-line batch number + expiry at receive (only sent for tracked products;
  // the backend ignores them for untracked SKUs and auto-suggests expiry from
  // shelf_life_days when the field is left blank).
  const [grnBatches, setGrnBatches] = useState({});

  // Scan & Receive state
  const [scanMode, setScanMode] = useState(false);
  const [scanGrnId, setScanGrnId] = useState(null); // GRN ID for scan-receive
  const [scanItems, setScanItems] = useState([]); // current GRN items with live qty
  const [scanFlash, setScanFlash] = useState(null); // product_id that was just scanned
  const [scanError, setScanError] = useState("");
  const [scanLog, setScanLog] = useState([]); // recent scan results
  const scanInputRef = useRef(null);
  // 2-G.6: when the scanned barcode resolves to a serialized product, we
  // pause the scan flow and prompt for the serial number before firing the
  // receive POST. serialPrompt shape: { barcode, productName } | null
  const [serialPrompt, setSerialPrompt] = useState(null);
  const [serialInput, setSerialInput] = useState("");
  const serialInputRef = useRef(null);

  // Template state
  const [templates, setTemplates] = useState([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [loadTemplateOpen, setLoadTemplateOpen] = useState(false);

  const loadRows = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get("/api/purchase-orders");
      setRows(data.purchaseOrders || []);
    } catch (e) {
      setError(e.message || "Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  };

  const loadDropdowns = async () => {
    try {
      const [supRes, prRes, outRes, empRes] = await Promise.all([
        api.get("/api/suppliers"),
        api.get("/api/products"),
        api.get("/api/outlets"),
        api.get("/api/employees"),
      ]);
      setSuppliers(supRes.suppliers || []);
      setProducts(prRes.products || []);
      setOutlets(outRes.outlets || []);
      setEmployees(empRes.employees || []);
    } catch {
      // Keep existing behavior: dropdown fetch failures are non-fatal for list.
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await api.get("/api/po-templates");
      setTemplates(data.templates || []);
    } catch {
      // non-fatal
    }
  };

  const saveAsTemplate = async () => {
    if (!templateName.trim()) { setError("Enter a template name."); return; }
    if (!form.supplier_id) { setError("Select a supplier before saving as template."); return; }
    if (!cart.length) { setError("Add items before saving as template."); return; }
    try {
      await api.post("/api/po-templates", {
        name: templateName.trim(),
        supplier_id: Number(form.supplier_id),
        items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_cost: i.cost_price })),
      });
      setSaveTemplateOpen(false);
      setTemplateName("");
      setNotice(`Template "${templateName.trim()}" saved.`);
      await loadTemplates();
    } catch (e) {
      setError(e.message || "Failed to save template");
    }
  };

  const loadFromTemplate = async (tmpl) => {
    setLoadTemplateOpen(false);
    // Set supplier
    setForm((prev) => ({ ...prev, supplier_id: String(tmpl.supplier_id || "") }));
    try {
      await api.get("/api/po-templates");
      setNotice(`Template "${tmpl.name}" loaded — supplier pre-filled. Items will be loaded when you use "Create PO from template".`);
    } catch {
      // non-fatal
    }
  };

  const createFromTemplate = async (tmplId, tmplName) => {
    try {
      const data = await api.post(`/api/po-templates/${tmplId}/use`, {});
      setTemplatesOpen(false);
      setNotice(`Draft PO ${poNumber(data.id)} created from template "${tmplName}".`);
      await loadRows();
    } catch (e) {
      setError(e.message || "Failed to create PO from template");
    }
  };

  const deleteTemplate = async (tmplId) => {
    if (!window.confirm("Delete this template?")) return;
    try {
      await api.del(`/api/po-templates/${tmplId}`);
      await loadTemplates();
    } catch (e) {
      setError(e.message || "Failed to delete template");
    }
  };

  const loadDetail = async (id) => {
    setLoading(true);
    setError("");
    setWarn("");
    try {
      const data = await api.get(`/api/purchase-orders/${id}`);
      setSelectedPo(data);
      setView("view");
    } catch (e) {
      setError(e.message || "Failed to load purchase order details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
    loadDropdowns();
    loadTemplates();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        String(r.id || "").includes(q) ||
        String(r.supplier_name || "").toLowerCase().includes(q) ||
        String(r.status || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.cost_price || 0), 0),
    [cart],
  );

  const searchResults = useMemo(() => {
    if (productSearch.trim().length < 2) return [];
    const q = productSearch.toLowerCase();
    return products
      .filter(
        (p) =>
          String(p.name || "").toLowerCase().includes(q) ||
          String(p.barcode || "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [productSearch, products]);

  const approvePO = async (poId) => {
    setApprovingId(poId);
    setError("");
    setNotice("");
    setWarn("");
    try {
      await api.post(`/api/purchase-orders/${poId}/approve`, {});
      setNotice(`${poNumber(poId)} approved successfully.`);
      await loadRows();
    } catch (e) {
      setError(e.message || "Failed to approve purchase order");
    } finally {
      setApprovingId(null);
    }
  };

  const openEditModal = async (po) => {
    setError("");
    setWarn("");
    setNotice("");
    setEditingPo(po);
    setEditForm({ supplier_id: String(po.supplier_id || ""), due_date: po.due_date || "" });
    setEditProductSearch("");
    // Load full PO items to pre-fill cart
    try {
      const data = await api.get(`/api/purchase-orders/${po.id}`);
      setEditCart(
        (data.items || []).map((item) => ({
          product_id: item.product_id,
          name: item.name,
          barcode: item.barcode,
          quantity: Number(item.quantity || 0),
          cost_price: Number(item.cost_price || 0),
        })),
      );
    } catch (e) {
      setError(e.message || "Failed to load PO details");
      return;
    }
    setEditOpen(true);
  };

  const editCartTotal = editCart.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.cost_price || 0),
    0,
  );

  const editSearchResults = useMemo(() => {
    if (editProductSearch.trim().length < 2) return [];
    const q = editProductSearch.toLowerCase();
    return products
      .filter(
        (p) =>
          String(p.name || "").toLowerCase().includes(q) ||
          String(p.barcode || "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [editProductSearch, products]);

  const addToEditCart = (product) => {
    setEditCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id ? { ...i, quantity: Number(i.quantity || 0) + 1 } : i,
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          barcode: product.barcode,
          quantity: 1,
          cost_price: Number(product.cost_price || 0),
        },
      ];
    });
  };

  const updateEditCart = (productId, field, value) => {
    setEditCart((prev) =>
      prev.map((i) =>
        i.product_id === productId
          ? { ...i, [field]: field === "cost_price" ? Number(value || 0) : Math.max(1, Number(value || 1)) }
          : i,
      ),
    );
  };

  const removeEditCartItem = (productId) => {
    setEditCart((prev) => prev.filter((i) => i.product_id !== productId));
  };

  const saveEdit = async () => {
    if (!editingPo) return;
    if (!editCart.length) {
      setError("Purchase order must have at least one item.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        supplier_id: Number(editForm.supplier_id) || editingPo.supplier_id,
        expected_date: editForm.due_date || null,
        items: editCart.map((i) => ({
          product_id: i.product_id,
          quantity: Number(i.quantity || 0),
          unit_cost: Number(i.cost_price || 0),
        })),
      };
      await api.put(`/api/purchase-orders/${editingPo.id}`, payload);
      setEditOpen(false);
      setEditingPo(null);
      setNotice(`${poNumber(editingPo.id)} updated successfully.`);
      await loadRows();
    } catch (e) {
      setError(e.message || "Failed to update purchase order");
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setNotice("");
    setWarn("");
    setError("");
    setForm({ supplier_id: "", due_date: "" });
    setProductSearch("");
    setCart([]);
    setView("create");
  };

  const addToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id ? { ...i, quantity: Number(i.quantity || 0) + 1 } : i,
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          barcode: product.barcode,
          quantity: 1,
          cost_price: Number(product.cost_price || 0),
        },
      ];
    });
  };

  const updateCart = (productId, field, value) => {
    setCart((prev) =>
      prev.map((i) =>
        i.product_id === productId
          ? {
              ...i,
              [field]: field === "cost_price" ? Number(value || 0) : Math.max(1, Number(value || 1)),
            }
          : i,
      ),
    );
  };

  const removeCartItem = (productId) => {
    setCart((prev) => prev.filter((i) => i.product_id !== productId));
  };

  const createPO = async () => {
    setError("");
    setNotice("");
    setWarn("");
    if (!form.supplier_id) {
      setError("Select a supplier first.");
      return;
    }
    if (!cart.length) {
      setError("Add at least one item to the purchase order.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        supplier_id: Number(form.supplier_id),
        total_cost: cartTotal,
        due_date: form.due_date || null,
        items: cart.map((i) => ({
          product_id: i.product_id,
          quantity: Number(i.quantity || 0),
          cost_price: Number(i.cost_price || 0),
        })),
      };
      const data = await api.post("/api/purchase-orders", payload);
      await loadRows();
      if (data.warning) {
        setWarn(`PO ${poNumber(data.id)} created. Warning: ${data.warning}`);
      } else {
        setNotice(`Purchase order ${poNumber(data.id)} created.`);
      }
      setView("list");
    } catch (e) {
      setError(e.message || "Failed to create purchase order");
    } finally {
      setSaving(false);
    }
  };

  const submitForApproval = async (poId) => {
    setSubmittingApproval(true);
    setError("");
    setNotice("");
    try {
      const data = await api.post(`/api/purchase-orders/${poId}/submit`, {
        requested_by: employee?.name || employee?.username || `Employee #${employee?.id || ""}`,
        notes: "",
      });
      setNotice(data.message || "PO submitted for approval.");
      await loadRows();
      await loadDetail(poId);
    } catch (e) {
      setError(e.message || "Failed to submit purchase order");
    } finally {
      setSubmittingApproval(false);
    }
  };

  const openGrnModal = () => {
    if (!selectedPo?.purchaseOrder || !selectedPo?.items?.length) return;
    const initial = {};
    selectedPo.items.forEach((item) => {
      initial[item.product_id] = Number(item.quantity || 0);
    });
    setGrnQtys(initial);
    setGrnBatches({});
    setGrnOutletId(String(outlets[0]?.id || ""));
    setGrnReceivedBy("");
    setGrnNotes("");
    setGrnOpen(true);
  };

  const receivePO = async () => {
    if (!selectedPo?.purchaseOrder) return;
    if (!grnOutletId) {
      setError("Select an outlet before receiving.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        outlet_id: Number(grnOutletId),
        received_by: grnReceivedBy ? Number(grnReceivedBy) : null,
        notes: grnNotes || null,
        items: (selectedPo.items || []).map((item) => ({
          product_id: item.product_id,
          qty_received: Number(grnQtys[item.product_id] ?? item.quantity ?? 0),
          batch_number: grnBatches[item.product_id]?.batch_number || null,
          expiry_date: grnBatches[item.product_id]?.expiry_date || null,
        })),
      };
      const data = await api.post(`/api/purchase-orders/${selectedPo.purchaseOrder.id}/receive`, payload);
      setGrnOpen(false);
      setNotice(`${data.message} (${data.grn_number})`);
      await loadRows();
      await loadDetail(selectedPo.purchaseOrder.id);
    } catch (e) {
      setError(e.message || "Failed to receive purchase order");
    } finally {
      setSaving(false);
    }
  };

  // --- Scan & Receive helpers ---
  const openScanMode = useCallback(async (grnId) => {
    try {
      const data = await api.get(`/api/grn/${grnId}`);
      setScanGrnId(grnId);
      setScanItems(data.items || []);
      setScanMode(true);
      setScanError("");
      setScanLog([]);
      setScanFlash(null);
      setTimeout(() => scanInputRef.current?.focus(), 100);
    } catch (e) {
      setError(e.message || "Failed to load GRN for scanning");
    }
  }, []);

  // 2-G.6: shared success/failure hooks so the serial-prompt path reuses
  // the same flash + scan-log + audio feedback as a plain scan.
  const applyScanResult = useCallback((updated) => {
    setScanItems((prev) =>
      prev.map((it) =>
        it.product_id === updated.product_id
          ? { ...it, qty_received: updated.qty_received }
          : it
      )
    );
    setScanFlash(updated.product_id);
    setTimeout(() => setScanFlash(null), 800);
    setScanLog((prev) => [
      {
        product_name: updated.product_name,
        qty_received: updated.qty_received,
        qty_ordered: updated.qty_ordered,
        over_received: updated.over_received,
        serialized: updated.serialized,
        time: new Date(),
      },
      ...prev.slice(0, 19),
    ]);
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = updated.over_received ? 300 : 880;
      gain.gain.value = 0.12;
      osc.start();
      osc.stop(ctx.currentTime + (updated.over_received ? 0.3 : 0.1));
    } catch {} // eslint-disable-line no-empty
  }, []);

  const errorBeep = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 200;
      gain.gain.value = 0.15;
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {} // eslint-disable-line no-empty
  }, []);

  const handleScanSubmit = useCallback(async (barcode) => {
    const trimmed = barcode.trim();
    if (!trimmed || !scanGrnId) return;
    setScanError("");

    // 2-G.6: does this barcode resolve to a serialized item on this GRN?
    // Match against scanItems which carries serial_required from the GET
    // /api/grn/:id response. Match against product.barcode or product.sku
    // (name check is too loose).
    const matchedItem = scanItems.find(
      (it) => it.barcode === trimmed || it.sku === trimmed,
    );
    if (matchedItem && matchedItem.serial_required) {
      setSerialPrompt({
        barcode: trimmed,
        productName: matchedItem.product_name,
      });
      setSerialInput("");
      setTimeout(() => serialInputRef.current?.focus(), 50);
      return;
    }

    try {
      const data = await api.post(`/api/grn/${scanGrnId}/scan-receive`, {
        barcode: trimmed,
      });
      applyScanResult(data.item);
    } catch (e) {
      setScanError(e.message || "Scan failed");
      errorBeep();
    }
  }, [scanGrnId, scanItems, applyScanResult, errorBeep]);

  // 2-G.6: commit a single serial for the currently-open serial prompt.
  // We receive ONE unit per submission (same model as the rest of the scan
  // UI — each barcode scan is one unit). For multi-unit bulk receive, the
  // user scans again.
  const submitSerialReceive = useCallback(async () => {
    if (!serialPrompt || !scanGrnId) return;
    const sn = serialInput.trim();
    if (!sn) {
      setScanError("Serial number is required");
      return;
    }
    setScanError("");
    try {
      const data = await api.post(`/api/grn/${scanGrnId}/scan-receive`, {
        barcode: serialPrompt.barcode,
        quantity: 1,
        serial_numbers: [sn],
      });
      applyScanResult(data.item);
      setSerialPrompt(null);
      setSerialInput("");
      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (e) {
      setScanError(e.message || "Serial receive failed");
      errorBeep();
    }
  }, [serialPrompt, serialInput, scanGrnId, applyScanResult, errorBeep]);

  const cancelSerialPrompt = useCallback(() => {
    setSerialPrompt(null);
    setSerialInput("");
    setScanError("");
    setTimeout(() => scanInputRef.current?.focus(), 50);
  }, []);

  if (view === "create") {
    return (
      <PageShell
        title="Create Purchase Order"
        subtitle="Build a draft PO by selecting a supplier and adding line items."
        right={
          <Button onClick={() => { setView("list"); setWarn(""); }}>
            <ArrowLeft size={14} className="mr-1 inline" />
            Back to List
          </Button>
        }
      >
        {error ? (
          <SectionCard className="mb-3 bg-(--ui-danger-bg) p-3 text-sm text-(--ui-danger-fg)">
            {error}
          </SectionCard>
        ) : null}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
          <SectionCard>
            <TableToolbar
              left={
                <div className="relative min-w-70">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
                  />
                  <Input
                    className="pl-8"
                    placeholder="Search products by name or barcode"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                </div>
              }
              right={
                <span className="text-xs text-(--ui-text-muted)">
                  {searchResults.length} results
                </span>
              }
            />
            <div className="max-h-[58vh] overflow-auto p-3">
              {searchResults.length ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      className="rounded border border-(--ui-border) p-3 text-left hover:bg-(--ui-muted-surface)"
                      onClick={() => addToCart(p)}
                    >
                      <p className="font-medium text-(--ui-text)">{p.name}</p>
                      <p className="mt-0.5 text-xs text-(--ui-text-muted)">{p.barcode || "-"}</p>
                      <p className="mt-1 text-xs font-semibold text-(--ui-text)">
                        Cost: {money(p.cost_price)}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Search products"
                  body="Type at least 2 characters to find products for this purchase order."
                />
              )}
            </div>
          </SectionCard>

          <SectionCard className="p-3">
            <h3 className="text-base font-semibold text-(--ui-text)">PO Draft</h3>
            <div className="mt-3 space-y-2">
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Supplier</label>
                <Select
                  value={form.supplier_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, supplier_id: e.target.value }))}
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Due Date</label>
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, due_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-3 max-h-[38vh] space-y-2 overflow-auto">
              {cart.map((item) => (
                <div key={item.product_id} className="rounded border border-(--ui-border) p-2">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-(--ui-text)">{item.name}</p>
                      <p className="text-xs text-(--ui-text-muted)">{item.barcode || "-"}</p>
                    </div>
                    <Button
                      tone="plain"
                      size="sm"
                      iconOnly
                      aria-label="Remove item"
                      className="hover:text-(--ui-danger-fg)"
                      onClick={() => removeCartItem(item.product_id)}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateCart(item.product_id, "quantity", e.target.value)}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.cost_price}
                      onChange={(e) => updateCart(item.product_id, "cost_price", e.target.value)}
                    />
                  </div>
                </div>
              ))}
              {!cart.length ? (
                <p className="py-6 text-center text-sm text-(--ui-text-muted)">Cart is empty.</p>
              ) : null}
            </div>

            <div className="mt-3 border-t border-(--ui-border) pt-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-(--ui-text-muted)">Draft Total</span>
                <span className="font-semibold text-(--ui-text)">{money(cartTotal)}</span>
              </div>
              <Button tone="primary" className="w-full" onClick={createPO} disabled={saving}>
                {saving ? "Submitting..." : "Submit Purchase Order"}
              </Button>
              <div className="mt-2 flex gap-2">
                <Button
                  className="flex-1 text-xs"
                  onClick={() => { setSaveTemplateOpen(true); setTemplateName(""); }}
                >
                  <Save size={12} className="mr-1 inline" />
                  Save as Template
                </Button>
                <Button
                  className="flex-1 text-xs"
                  onClick={() => { loadTemplates(); setLoadTemplateOpen(true); }}
                >
                  <BookTemplate size={12} className="mr-1 inline" />
                  Load Template
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>

        <Modal
          open={saveTemplateOpen}
          onClose={() => setSaveTemplateOpen(false)}
          title="Save as Template"
          size="sm"
        >
          <label className="mb-1 block text-xs text-(--ui-text-muted)">Template Name</label>
          <Input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="e.g. Weekly Beverage Order"
            autoFocus
          />
          <ModalFooter>
            <Button onClick={() => setSaveTemplateOpen(false)}>Cancel</Button>
            <Button tone="primary" onClick={saveAsTemplate}>
              <Save size={13} className="mr-1 inline" />
              Save Template
            </Button>
          </ModalFooter>
        </Modal>

        <Modal
          open={loadTemplateOpen}
          onClose={() => setLoadTemplateOpen(false)}
          title="Load Template"
          size="md"
        >
          {templates.length === 0 ? (
            <p className="py-4 text-center text-sm text-(--ui-text-muted)">No templates saved yet.</p>
          ) : (
            <div className="max-h-[50vh] space-y-2 overflow-auto">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded border border-(--ui-border) p-2">
                  <div>
                    <p className="text-sm font-medium text-(--ui-text)">{t.name}</p>
                    <p className="text-xs text-(--ui-text-muted)">
                      {t.supplier_name || "No supplier"} · {t.item_count} items
                    </p>
                  </div>
                  <Button
                    size="sm"
                    tone="primary"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, supplier_id: String(t.supplier_id || "") }));
                      setLoadTemplateOpen(false);
                      setNotice(`Template "${t.name}" loaded — supplier pre-filled. Submit the PO or modify items.`);
                    }}
                  >
                    Load
                  </Button>
                </div>
              ))}
            </div>
          )}
          <ModalFooter>
            <Button onClick={() => setLoadTemplateOpen(false)}>Close</Button>
          </ModalFooter>
        </Modal>
      </PageShell>
    );
  }

  if (view === "view" && selectedPo?.purchaseOrder) {
    const po = selectedPo.purchaseOrder;
    const items = selectedPo.items || [];
    return (
      <PageShell
        title={poNumber(po.id)}
        subtitle={`Supplier: ${po.supplier_name} | Created: ${fmtDateTime(po.created_at)}`}
        right={
          <Button onClick={() => { setView("list"); setWarn(""); }}>
            <ArrowLeft size={14} className="mr-1 inline" />
            Back to List
          </Button>
        }
      >
        {error ? (
          <SectionCard className="mb-3 bg-(--ui-danger-bg) p-3 text-sm text-(--ui-danger-fg)">
            {error}
          </SectionCard>
        ) : null}
        {notice ? (
          <SectionCard className="mb-3 bg-(--ui-success-bg) p-3 text-sm text-(--ui-success-fg)">
            {notice}
          </SectionCard>
        ) : null}

        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          <SectionCard className="p-3">
            <p className="text-xs text-(--ui-text-muted)">Status</p>
            <div className="mt-1">
              <Badge tone={statusTone(po.status)}>{po.status}</Badge>
            </div>
          </SectionCard>
          <SectionCard className="p-3">
            <p className="text-xs text-(--ui-text-muted)">Supplier</p>
            <p className="mt-1 text-sm font-medium text-(--ui-text)">{po.supplier_name}</p>
          </SectionCard>
          <SectionCard className="p-3">
            <p className="text-xs text-(--ui-text-muted)">Due Date</p>
            <p className="mt-1 text-sm font-medium text-(--ui-text)">{po.due_date || "-"}</p>
          </SectionCard>
          <SectionCard className="p-3">
            <p className="text-xs text-(--ui-text-muted)">Total Cost</p>
            <p className="mt-1 text-sm font-semibold text-(--ui-text)">{money(po.total_cost)}</p>
          </SectionCard>
        </div>

        <SectionCard>
          <TableToolbar
            left={<span className="text-sm font-medium text-(--ui-text)">Line Items</span>}
            right={
              <div className="flex items-center gap-2">
                {po.status === "Draft" ? (
                  <Button
                    tone="primary"
                    onClick={() => submitForApproval(po.id)}
                    disabled={submittingApproval}
                  >
                    <Send size={13} className="mr-1 inline" />
                    {submittingApproval ? "Submitting..." : "Submit for Approval"}
                  </Button>
                ) : null}
                {po.status === "Approved" ? (
                  <Button tone="primary" onClick={openGrnModal}>
                    <PackageCheck size={13} className="mr-1 inline" />
                    Receive Items
                  </Button>
                ) : null}
                {po.status === "Received" ? (
                  <Button tone="primary" onClick={async () => {
                    try {
                      const data = await api.get(`/api/grn/by-po/${po.id}`);
                      openScanMode(data.grn.id);
                    } catch (e) {
                      setError(e.message || "No GRN found for this PO");
                    }
                  }}>
                    <ScanBarcode size={13} className="mr-1 inline" />
                    Scan to Receive
                  </Button>
                ) : null}
              </div>
            }
          />
          <div className="overflow-auto">
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">Barcode</th>
                  <th className="px-3 py-2 text-right">Unit Cost</th>
                  <th className="px-3 py-2 text-right">Qty Ordered</th>
                  <th className="px-3 py-2 text-right">Row Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2 text-(--ui-text)">{item.name}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">{item.barcode || "-"}</td>
                    <td className="px-3 py-2 text-right text-(--ui-text)">{money(item.cost_price)}</td>
                    <td className="px-3 py-2 text-right text-(--ui-text)">{item.quantity}</td>
                    <td className="px-3 py-2 text-right font-medium text-(--ui-text)">
                      {money(Number(item.quantity || 0) * Number(item.cost_price || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <Modal
          open={grnOpen}
          onClose={saving ? undefined : () => setGrnOpen(false)}
          title="Receive PO (Create GRN)"
          size="xl"
        >
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-(--ui-text-muted)">Receiving Outlet</label>
              <Select value={grnOutletId} onChange={(e) => setGrnOutletId(e.target.value)}>
                <option value="">Select outlet</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-(--ui-text-muted)">Received By</label>
              <Select value={grnReceivedBy} onChange={(e) => setGrnReceivedBy(e.target.value)}>
                <option value="">Select employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="mt-2">
            <label className="mb-1 block text-xs text-(--ui-text-muted)">Notes</label>
            <Input value={grnNotes} onChange={(e) => setGrnNotes(e.target.value)} placeholder="Optional receiving notes" />
          </div>
          <div className="mt-3 max-h-[35vh] space-y-2 overflow-auto border-t border-(--ui-border) pt-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded border border-(--ui-border) p-2"
              >
                <div className="grid grid-cols-[1fr_140px] items-center gap-2">
                  <div>
                    <p className="text-sm font-medium text-(--ui-text)">{item.name}</p>
                    <p className="text-xs text-(--ui-text-muted)">
                      Ordered: {item.quantity} | {item.barcode || "-"}
                    </p>
                  </div>
                  <Input
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
                  />
                </div>
                {flags?.batch_expiry_tracking && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Batch / lot no. (optional)"
                      value={grnBatches[item.product_id]?.batch_number || ""}
                      onChange={(e) =>
                        setGrnBatches((prev) => ({
                          ...prev,
                          [item.product_id]: { ...prev[item.product_id], batch_number: e.target.value },
                        }))
                      }
                    />
                    <Input
                      type="date"
                      value={grnBatches[item.product_id]?.expiry_date || ""}
                      onChange={(e) =>
                        setGrnBatches((prev) => ({
                          ...prev,
                          [item.product_id]: { ...prev[item.product_id], expiry_date: e.target.value },
                        }))
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <ModalFooter>
            <Button onClick={() => setGrnOpen(false)} disabled={saving}>Cancel</Button>
            <Button tone="primary" onClick={receivePO} disabled={saving}>
              <CheckCircle2 size={13} className="mr-1 inline" />
              {saving ? "Processing..." : "Confirm & Create GRN"}
            </Button>
          </ModalFooter>
        </Modal>

        <Modal
          open={!!scanMode}
          onClose={() => {
            setScanMode(false);
            setSerialPrompt(null);
            setSerialInput("");
          }}
          title={<><ScanBarcode size={18} className="mr-2 inline" />Scan &amp; Receive</>}
          size="xl"
        >
          {/* Progress bar */}
              {(() => {
                const totalOrdered = scanItems.reduce((s, i) => s + Number(i.qty_ordered || 0), 0);
                const totalReceived = scanItems.reduce((s, i) => s + Number(i.qty_received || 0), 0);
                const pct = totalOrdered > 0 ? Math.min(100, Math.round((totalReceived / totalOrdered) * 100)) : 0;
                return (
                  <div className="mb-3">
                    <div className="mb-1 flex justify-between text-xs text-(--ui-text-muted)">
                      <span>{totalReceived} / {totalOrdered} items received</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-(--ui-muted-surface)">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${pct >= 100 ? "bg-(--ui-success-fg)" : "bg-(--ui-primary)"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* 2-G.6: serial prompt — shown when a scanned barcode
                  resolves to a serial_required product. Captures one
                  serial per scan. */}
              {serialPrompt ? (
                <div className="mb-3 rounded-(--ui-radius-sm) bg-(--ui-warning-bg) p-3">
                  <div className="mb-1 text-xs font-semibold text-(--ui-warning-fg)">
                    Serial required — {serialPrompt.productName}
                  </div>
                  <div className="flex gap-2">
                    <input
                      ref={serialInputRef}
                      className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border) bg-white px-3 py-2 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted)"
                      placeholder="Scan or type the serial / IMEI"
                      value={serialInput}
                      onChange={(e) => setSerialInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submitSerialReceive();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelSerialPrompt();
                        }
                      }}
                      autoFocus
                    />
                    <Button tone="primary" onClick={submitSerialReceive}>
                      Receive
                    </Button>
                    <Button onClick={cancelSerialPrompt}>Cancel</Button>
                  </div>
                  <p className="mt-1 text-[11px] text-(--ui-text-muted)">
                    One serial per scan. Scan again for additional units.
                  </p>
                </div>
              ) : null}

              {/* Barcode input — plain <input> for ref forwarding */}
              <div className="mb-3">
                <input
                  ref={scanInputRef}
                  className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border) bg-white px-3 py-2 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted) disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={
                    serialPrompt
                      ? "Finish serial entry above first…"
                      : "Scan barcode or type and press Enter..."
                  }
                  disabled={!!serialPrompt}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleScanSubmit(e.target.value);
                      e.target.value = "";
                    }
                  }}
                />
              </div>

              {scanError ? (
                <div className="mb-2 rounded-(--ui-radius-sm) bg-(--ui-danger-bg) p-2 text-sm text-(--ui-danger-fg)">
                  {scanError}
                </div>
              ) : null}

              {/* Scan log */}
              {scanLog.length > 0 ? (
                <div className="mb-3 max-h-20 overflow-auto rounded border border-(--ui-border) bg-(--ui-muted-surface) p-2">
                  {scanLog.map((entry, i) => (
                    <div key={i} className={`text-xs ${entry.over_received ? "text-(--ui-warning-fg)" : "text-(--ui-success-fg)"}`}>
                      {entry.product_name} — {entry.qty_received}/{entry.qty_ordered}
                      {entry.over_received ? " ⚠ over-received" : ""}
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Items table */}
              <div className="max-h-[40vh] overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                    <tr>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-left">Barcode</th>
                      <th className="px-3 py-2 text-center">Ordered</th>
                      <th className="px-3 py-2 text-center">Received</th>
                      <th className="px-3 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanItems.map((item) => {
                      const ordered = Number(item.qty_ordered || 0);
                      const received = Number(item.qty_received || 0);
                      const isOver = received > ordered;
                      const isDone = received >= ordered && !isOver;
                      const isFlashing = scanFlash === item.product_id;
                      return (
                        <tr
                          key={item.id}
                          className={`border-t border-(--ui-border) transition-colors duration-300 ${
                            isFlashing ? "bg-(--ui-success-bg)" : ""
                          }`}
                        >
                          <td className="px-3 py-2 text-(--ui-text)">
                            {item.product_name}
                            {item.serial_required ? (
                              <span className="ml-2 inline-flex items-center rounded-full bg-(--ui-muted-surface) px-1.5 py-0.5 text-[10px] font-bold text-(--ui-text-muted)">
                                SN
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-(--ui-text-muted)">{item.barcode || "-"}</td>
                          <td className="px-3 py-2 text-center text-(--ui-text)">{ordered}</td>
                          <td className={`px-3 py-2 text-center font-semibold ${isOver ? "text-(--ui-warning-fg)" : received > 0 ? "text-(--ui-success-fg)" : "text-(--ui-text)"}`}>
                            {received}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {isOver ? (
                              <Badge tone="warning">Over</Badge>
                            ) : isDone ? (
                              <Badge tone="success">Done</Badge>
                            ) : received > 0 ? (
                              <Badge tone="default">Partial</Badge>
                            ) : (
                              <Badge tone="default">Pending</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

          <ModalFooter>
            <Button
              onClick={() => {
                setScanMode(false);
                setSerialPrompt(null);
                setSerialInput("");
              }}
            >
              <CheckCircle2 size={13} className="mr-1 inline" />
              Done
            </Button>
          </ModalFooter>
        </Modal>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Purchase Orders"
      subtitle="manage supplier ordering lifecycle from draft to GRN."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => exportCSV(visibleRows)}>
            <Download size={13} className="mr-1 inline" />
            Export
          </Button>
          <Button onClick={() => { loadTemplates(); setTemplatesOpen(true); }}>
            <BookTemplate size={13} className="mr-1 inline" />
            Templates
          </Button>
          <Button tone="primary" onClick={openCreate}>
            <Plus size={13} className="mr-1 inline" />
            Create PO
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 bg-(--ui-danger-bg) p-3 text-sm text-(--ui-danger-fg)">
          {error}
        </SectionCard>
      ) : null}
      {notice ? (
        <SectionCard className="mb-3 bg-(--ui-success-bg) p-3 text-sm text-(--ui-success-fg)">
          {notice}
        </SectionCard>
      ) : null}
      {warn && <SectionCard className="mb-3 bg-(--ui-warning-bg) p-3 text-sm text-(--ui-warning-fg)">{warn}</SectionCard>}

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Total POs</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{rows.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Pending Approval</p>
          <p className="text-2xl font-semibold text-(--ui-text)">
            {rows.filter((r) => r.status === "pending_approval").length}
          </p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Received</p>
          <p className="text-2xl font-semibold text-(--ui-text)">
            {rows.filter((r) => r.status === "Received").length}
          </p>
        </SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-65">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
              />
              <Input
                className="pl-8"
                placeholder="Search by PO, supplier, or status"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{visibleRows.length} rows</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">PO</th>
                <th className="px-3 py-2 text-left">Supplier</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visibleRows.map((po) => (
                  <tr key={po.id} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2 font-medium text-(--ui-text)">{poNumber(po.id)}</td>
                    <td className="px-3 py-2 text-(--ui-text)">{po.supplier_name}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {fmtDate(po.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={statusTone(po.status)}>{po.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-(--ui-text)">{money(po.total_cost)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {po.status === "Draft" && hasPerm("manage_orders") ? (
                          <>
                            <Button size="sm" onClick={() => openEditModal(po)}>
                              <Pencil size={11} className="mr-1 inline" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              tone="primary"
                              onClick={() => approvePO(po.id)}
                              disabled={approvingId === po.id}
                            >
                              <ThumbsUp size={11} className="mr-1 inline" />
                              {approvingId === po.id ? "..." : "Approve"}
                            </Button>
                          </>
                        ) : null}
                        <Button size="sm" onClick={() => loadDetail(po.id)}>
                          View
                          <ChevronRight size={12} className="ml-1 inline" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading ? (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">
              Loading purchase orders...
            </div>
          ) : null}
          {!loading && visibleRows.length === 0 ? (
            <EmptyState title="No purchase orders" body="Create a PO to start procurement workflow." />
          ) : null}
        </div>
      </SectionCard>

      <Modal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        title="PO Templates"
        size="lg"
      >
        {templates.length === 0 ? (
          <p className="py-6 text-center text-sm text-(--ui-text-muted)">
            No templates yet. Create a PO and use "Save as Template".
          </p>
        ) : (
          <div className="max-h-[55vh] space-y-2 overflow-auto">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded border border-(--ui-border) p-3">
                <div>
                  <p className="font-medium text-(--ui-text)">{t.name}</p>
                  <p className="text-xs text-(--ui-text-muted)">
                    {t.supplier_name || "No supplier"} · {t.item_count} items · {fmtDate(t.created_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    tone="primary"
                    onClick={() => createFromTemplate(t.id, t.name)}
                  >
                    Use
                  </Button>
                  <Button
                    size="sm"
                    tone="danger"
                    onClick={() => deleteTemplate(t.id)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <ModalFooter>
          <Button onClick={() => setTemplatesOpen(false)}>Close</Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={editOpen && !!editingPo}
        onClose={saving ? undefined : () => { setEditOpen(false); setEditingPo(null); }}
        title={editingPo ? `Edit ${poNumber(editingPo.id)}` : "Edit PO"}
        size="xl"
      >
        {editingPo ? (
          <>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_300px]">
              {/* Product search panel */}
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
                  />
                  <Input
                    className="pl-8"
                    placeholder="Search products to add"
                    value={editProductSearch}
                    onChange={(e) => setEditProductSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-56 overflow-auto">
                  {editSearchResults.length ? (
                    <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                      {editSearchResults.map((p) => (
                        <button
                          key={p.id}
                          className="rounded border border-(--ui-border) p-2 text-left hover:bg-(--ui-muted-surface)"
                          onClick={() => addToEditCart(p)}
                        >
                          <p className="text-sm font-medium text-(--ui-text)">{p.name}</p>
                          <p className="text-xs text-(--ui-text-muted)">{p.barcode || "-"}</p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-xs text-(--ui-text-muted)">
                      Type 2+ characters to search products
                    </p>
                  )}
                </div>
              </div>

              {/* PO detail panel */}
              <div className="flex flex-col gap-2">
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Supplier</label>
                  <Select
                    value={editForm.supplier_id}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, supplier_id: e.target.value }))}
                  >
                    <option value="">Select supplier</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Due Date</label>
                  <Input
                    type="date"
                    value={editForm.due_date}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, due_date: e.target.value }))}
                  />
                </div>

                <div className="max-h-48 space-y-1.5 overflow-auto">
                  {editCart.map((item) => (
                    <div key={item.product_id} className="rounded border border-(--ui-border) p-2">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-(--ui-text)">{item.name}</p>
                        <Button
                          tone="plain"
                          size="sm"
                          iconOnly
                          aria-label="Remove item"
                          className="hover:text-(--ui-danger-fg)"
                          onClick={() => removeEditCartItem(item.product_id)}
                        >
                          <X size={13} />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateEditCart(item.product_id, "quantity", e.target.value)}
                        />
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.cost_price}
                          onChange={(e) => updateEditCart(item.product_id, "cost_price", e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                  {!editCart.length ? (
                    <p className="py-4 text-center text-xs text-(--ui-text-muted)">Cart is empty</p>
                  ) : null}
                </div>

                <div className="border-t border-(--ui-border) pt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-(--ui-text-muted)">Total</span>
                    <span className="font-semibold text-(--ui-text)">{money(editCartTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            {error ? (
              <div className="mt-3 rounded-(--ui-radius-sm) bg-(--ui-danger-bg) p-2 text-sm text-(--ui-danger-fg)">
                {error}
              </div>
            ) : null}

            <ModalFooter>
              <Button onClick={() => { setEditOpen(false); setEditingPo(null); }} disabled={saving}>Cancel</Button>
              <Button tone="primary" onClick={saveEdit} disabled={saving}>
                <Save size={13} className="mr-1 inline" />
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </Modal>
    </PageShell>
  );
}
