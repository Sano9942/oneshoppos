import { useState, useEffect, useCallback } from "react";
import { Tag, Plus, Edit2, Trash2, X, RefreshCw, Printer, Check } from "lucide-react";

import { api } from '../api';
import { useCurrency } from '../contexts/CurrencyContext';
import { fmtUtcDateTime } from '../utils/dates';
import { queueKey, reprintRowToQueueItem, addToQueue, buildLabelPickList, searchLabelPickList } from './labelReprints';

// ── Minimal Code128B encoder ─────────────────────────────────────────────────
const CODE128_TABLE = (() => {
  const raw = [
    "212222","222122","222221","121223","121322","131222","122213","122312",
    "132212","221213","221312","231212","112232","122132","122231","113222",
    "123122","123221","223211","221132","221231","213212","223112","312131",
    "311222","321122","321221","312212","322112","322211","212123","212321",
    "232121","111323","131123","131321","112313","132113","132311","211313",
    "231113","231311","112133","112331","132131","113123","113321","133121",
    "313121","211331","231131","213113","213311","213131","311123","311321",
    "331121","312113","312311","332111","314111","221411","431111","111224",
    "111422","121124","121421","141122","141221","112214","112412","122114",
    "122411","142112","142211","241211","221114","413111","241112","134111",
    "111242","121142","121241","114212","124112","124211","411212","421112",
    "421211","212141","214121","412121","111143","111341","131141","114113",
    "114311","411113","411311","113141","114131","311141","411131","211412",
    "211214","211232","233111","200000",
  ];
  return raw.map((s) => s.split("").map(Number));
})();

function encodeCode128(text) {
  const START_B = 104, STOP = 106;
  const chars = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 32;
    if (code < 0 || code > 94) return null;
    chars.push(code);
  }
  let checksum = START_B;
  chars.forEach((c, i) => { checksum += c * (i + 1); });
  const sequence = [START_B, ...chars, checksum % 103, STOP];
  const bars = [];
  sequence.forEach((sym, si) => {
    const pattern = CODE128_TABLE[sym];
    if (!pattern) return;
    pattern.forEach((w, wi) => bars.push({ width: w, isBar: wi % 2 === 0 }));
    if (si === sequence.length - 1) bars.push({ width: 2, isBar: true });
  });
  return bars;
}

// Build an SVG element for a barcode
function buildBarcodeSVG(doc, text, height) {
  const bars = encodeCode128(String(text));
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  if (!bars) {
    svg.setAttribute("width", "60");
    svg.setAttribute("height", String(height));
    const t = doc.createElementNS(ns, "text");
    t.setAttribute("y", "12");
    t.setAttribute("font-size", "10");
    t.setAttribute("fill", "red");
    t.textContent = "Invalid";
    svg.appendChild(t);
    return svg;
  }
  const unitPx = 1.2;
  let x = 0;
  bars.forEach((b) => {
    const w = b.width * unitPx;
    if (b.isBar) {
      const rect = doc.createElementNS(ns, "rect");
      rect.setAttribute("x", x.toFixed(2));
      rect.setAttribute("y", "0");
      rect.setAttribute("width", w.toFixed(2));
      rect.setAttribute("height", String(height));
      rect.setAttribute("fill", "black");
      svg.appendChild(rect);
    }
    x += w;
  });
  svg.setAttribute("width", x.toFixed(2));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${x.toFixed(2)} ${height}`);
  return svg;
}

// Build a label DOM element using safe DOM APIs (no innerHTML)
function buildLabelEl(doc, template, item, fmt) {
  const fs = template.font_size || 10;
  const label = doc.createElement("div");
  label.className = "label";

  const addText = (cls, text, fontSize) => {
    const el = doc.createElement("div");
    el.className = cls;
    el.style.fontSize = fontSize + "px";
    el.textContent = text;
    label.appendChild(el);
  };

  if (template.show_name && item.name) addText("item-name", item.name, fs + 1);
  if (template.show_brand && item.brand) addText("brand", item.brand, fs - 1);

  if (template.show_barcode && item.barcode) {
    const barcodeHeight = Math.round(template.height_mm * 1.1);
    const barcodeWrap = doc.createElement("div");
    barcodeWrap.className = "barcode";
    barcodeWrap.appendChild(buildBarcodeSVG(doc, item.barcode, barcodeHeight));
    label.appendChild(barcodeWrap);

    const barcodeText = doc.createElement("div");
    barcodeText.className = "barcode-text";
    barcodeText.style.fontSize = (fs - 1) + "px";
    barcodeText.textContent = item.barcode;
    label.appendChild(barcodeText);
  }

  if (template.show_sku && item.sku) addText("sku", `SKU: ${item.sku}`, fs - 1);
  if (template.show_price) addText("price", fmt(item.price), fs + 3);

  return label;
}

function printLabels(template, items, fmt) {
  const win = window.open("", "_blank");
  if (!win) { alert("Popup blocked. Allow popups for this page."); return; }

  const doc = win.document;

  // Add charset meta
  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  doc.head.appendChild(meta);

  const title = doc.createElement("title");
  title.textContent = "Barcode Labels";
  doc.head.appendChild(title);

  // Stylesheet via textContent (safe — no user input)
  const style = doc.createElement("style");
  style.textContent = `
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Arial,sans-serif; background:white; }
    .labels { display:flex; flex-wrap:wrap; gap:2mm; padding:4mm; }
    .label {
      width:${template.width_mm}mm; height:${template.height_mm}mm;
      border:0.3mm solid #ccc;
      display:flex; flex-direction:column; align-items:center;
      justify-content:center; padding:1.5mm; overflow:hidden;
      text-align:center; page-break-inside:avoid;
    }
    .item-name { font-weight:bold; line-height:1.2; word-break:break-word; }
    .brand { color:#666; }
    .barcode { margin:0.5mm 0; line-height:0; }
    .barcode svg { max-width:100%; }
    .barcode-text { font-family:monospace; letter-spacing:1px; }
    .price { font-weight:bold; color:#000; }
    .sku { color:#555; }
    @media print {
      body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  `;
  doc.head.appendChild(style);

  const container = doc.createElement("div");
  container.className = "labels";

  items.forEach((item) => {
    const copies = item.copies || 1;
    for (let i = 0; i < copies; i++) {
      container.appendChild(buildLabelEl(doc, template, item, fmt));
    }
  });

  doc.body.appendChild(container);

  // Print after a short delay to let the DOM settle
  setTimeout(() => { win.focus(); win.print(); }, 500);
}

// ── Form defaults ─────────────────────────────────────────────────────────────
const EMPTY = {
  name: "", width_mm: 50, height_mm: 30,
  show_name: true, show_price: true, show_barcode: true,
  show_sku: false, show_brand: false, font_size: 10, is_default: false,
};

export default function BarcodeTemplates() {
  const { fmt } = useCurrency();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [printModal, setPrintModal] = useState(false);
  const [products, setProducts] = useState([]);
  const [variants, setVariants] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [printTemplate, setPrintTemplate] = useState("");
  const [printItems, setPrintItems] = useState([]);
  const [printing, setPrinting] = useState(false);

  // Labels to reprint (OTS pilot step 6)
  const [reprints, setReprints] = useState([]);
  const [reprintSel, setReprintSel] = useState(() => new Set());
  const [reprintBusy, setReprintBusy] = useState(false);

  const fetchReprints = useCallback(async () => {
    try {
      const data = await api.get("/api/label-reprints");
      setReprints(data.items || []);
    } catch { setReprints([]); }
    setReprintSel(new Set());
  }, []);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/barcode-templates");
      setTemplates(data.templates || []);
    } catch { setTemplates([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchReprints();
    api.get("/api/products").then((d) => setProducts(d.products || [])).catch(() => {});
    // Variants for the search (step 6b): each one is its own label.
    api.get("/api/products/catalogue").then((d) => setVariants(d?.variants || [])).catch(() => {});
  }, [fetchTemplates, fetchReprints]);

  const openAdd = () => { setForm(EMPTY); setFormError(""); setModal("add"); };
  const openEdit = (t) => {
    setForm({
      name: t.name, width_mm: t.width_mm, height_mm: t.height_mm,
      show_name: !!t.show_name, show_price: !!t.show_price, show_barcode: !!t.show_barcode,
      show_sku: !!t.show_sku, show_brand: !!t.show_brand, font_size: t.font_size,
      is_default: !!t.is_default,
    });
    setFormError(""); setModal(t);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!form.name) { setFormError("Template name is required"); return; }
    setSaving(true);
    try {
      const isEdit = modal && modal !== "add";
      const url = isEdit ? `/api/barcode-templates/${modal.id}` : `/api/barcode-templates`;
      const payload = {
        ...form,
        width_mm: parseFloat(form.width_mm),
        height_mm: parseFloat(form.height_mm),
        font_size: parseInt(form.font_size),
      };
      if (isEdit) {
        await api.put(url, payload);
      } else {
        await api.post(url, payload);
      }
      setModal(null); fetchTemplates();
    } catch (err) { setFormError(err.body?.error || err.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this template?")) return;
    await api.del(`/api/barcode-templates/${id}`);
    fetchTemplates();
  };

  const openPrint = (initialItems = []) => {
    const def = templates.find((t) => t.is_default) || templates[0] || null;
    setPrintTemplate(def ? String(def.id) : "");
    setPrintItems(initialItems); setProductSearch(""); setPrintModal(true);
  };

  const addToPrintQueue = (item) => {
    setPrintItems((prev) => addToQueue(prev, { ...item, copies: 1 }));
  };

  const updateCopies = (key, val) => {
    const n = parseInt(val);
    if (!n || n <= 0) { setPrintItems((prev) => prev.filter((i) => queueKey(i) !== key)); return; }
    setPrintItems((prev) => prev.map((i) => queueKey(i) === key ? { ...i, copies: n } : i));
  };

  const handlePrint = async () => {
    if (!printItems.length) { alert("Add at least one product."); return; }
    const tpl = templates.find((t) => t.id === parseInt(printTemplate));
    if (!tpl) { alert("Select a template."); return; }
    setPrinting(true);
    printLabels(tpl, printItems, fmt);
    try {
      // Logging the job also takes items printed at their current price off
      // "Labels to reprint".
      await api.post("/api/barcode-print-jobs", { template_id: tpl.id, items: printItems });
      await fetchReprints();
    } catch { /* non-critical */ }
    setPrinting(false);
  };

  const selectedReprints = reprints.filter((r) => reprintSel.has(r.id));
  const allReprintsSelected = reprints.length > 0 && reprints.every((r) => reprintSel.has(r.id));
  const toggleReprint = (id) => setReprintSel((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllReprints = () =>
    setReprintSel(allReprintsSelected ? new Set() : new Set(reprints.map((r) => r.id)));

  const printSelectedReprints = () =>
    openPrint(selectedReprints.reduce((q, r) => addToQueue(q, reprintRowToQueueItem(r)), []));

  const dismissSelectedReprints = async () => {
    if (!selectedReprints.length) return;
    setReprintBusy(true);
    try {
      await api.post("/api/label-reprints/dismiss", { ids: selectedReprints.map((r) => r.id) });
      await fetchReprints();
    } catch (err) { alert(err.body?.error || err.message || "Could not update the list"); }
    finally { setReprintBusy(false); }
  };

  const f = form;
  const filteredProducts = searchLabelPickList(buildLabelPickList(products, variants), productSearch).slice(0, 40);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-end gap-3">
        <button onClick={fetchTemplates} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-(--ui-muted-surface) text-(--ui-text) rounded-full hover:bg-(--ui-border-strong)">
          <RefreshCw size={14} /> Refresh
        </button>
        <button onClick={() => openPrint()} className="flex items-center gap-2 px-4 py-2 bg-(--ui-muted-surface) text-(--ui-text) rounded-full text-sm font-semibold hover:bg-(--ui-border-strong)">
          <Printer size={16} /> Print Labels
        </button>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-(--ui-primary) text-(--ui-on-primary) rounded-full text-sm font-semibold hover:bg-(--ui-primary-strong)">
          <Plus size={16} /> New Template
        </button>
      </div>

      {/* Labels to reprint (OTS pilot step 6): every item whose selling price
          changed, or that is new, since its last label. */}
      <div data-testid="label-reprints" className="bg-(--ui-surface) border rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-(--ui-border)">
          <div>
            <h2 className="font-semibold text-(--ui-text)">Labels to reprint ({reprints.length})</h2>
            <p className="text-xs text-(--ui-text-muted)">Items whose price changed, or that are new, since their last label. Printing the label takes them off.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={dismissSelectedReprints} disabled={!selectedReprints.length || reprintBusy}
              className="px-3 py-2 text-sm font-semibold bg-(--ui-muted-surface) text-(--ui-text) rounded-full hover:bg-(--ui-border-strong) disabled:opacity-50">
              <Check size={14} className="inline mr-1" />Label is fine
            </button>
            <button onClick={printSelectedReprints} disabled={!selectedReprints.length}
              className="px-4 py-2 text-sm font-semibold bg-(--ui-primary) text-(--ui-on-primary) rounded-full hover:bg-(--ui-primary-strong) disabled:opacity-50">
              <Printer size={14} className="inline mr-1" />Print selected ({selectedReprints.length})
            </button>
          </div>
        </div>
        {reprints.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-(--ui-text-muted)">All shelf labels are up to date.</div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-(--ui-muted-surface) border-b border-(--ui-border)">
                <tr>
                  <th className="px-4 py-2 w-8">
                    <input type="checkbox" aria-label="Select all labels to reprint" checked={allReprintsSelected} onChange={toggleAllReprints} />
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-(--ui-text-muted)">Item</th>
                  <th className="px-4 py-2 text-left font-medium text-(--ui-text-muted)">Barcode</th>
                  <th className="px-4 py-2 text-left font-medium text-(--ui-text-muted)">Label price → New price</th>
                  <th className="px-4 py-2 text-left font-medium text-(--ui-text-muted)">Changed</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {reprints.map((r) => (
                  <tr key={r.id} data-testid={`reprint-row-${r.id}`} className="hover:bg-(--ui-muted-surface)">
                    <td className="px-4 py-2">
                      <input type="checkbox" aria-label={`Select ${r.name}${r.variant_sku ? ` ${r.variant_sku}` : ""}`}
                        checked={reprintSel.has(r.id)} onChange={() => toggleReprint(r.id)} />
                    </td>
                    <td className="px-4 py-2">
                      <span className="font-medium text-(--ui-text)">{r.name}</span>
                      {r.variant_sku && <span className="ml-2 text-xs text-(--ui-text-muted)">{r.variant_sku}</span>}
                    </td>
                    <td className="px-4 py-2 text-(--ui-text-muted) font-mono text-xs">{r.barcode || "—"}</td>
                    <td className="px-4 py-2">
                      {r.is_new
                        ? <span><span className="text-xs bg-(--ui-muted-surface) text-(--ui-text-muted) px-2 py-0.5 rounded-full mr-2">New</span><strong>{fmt(r.new_price)}</strong></span>
                        : <span><span className="text-(--ui-text-muted) line-through">{fmt(r.old_price)}</span> → <strong>{fmt(r.new_price)}</strong></span>}
                    </td>
                    <td className="px-4 py-2 text-(--ui-text-muted)">{fmtUtcDateTime(r.changed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-(--ui-text-muted)">Loading...</div>
      ) : (
        <div className="bg-(--ui-surface) border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-(--ui-muted-surface) border-b border-(--ui-border)">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-(--ui-text-muted)">Template Name</th>
                <th className="px-4 py-3 text-left font-medium text-(--ui-text-muted)">Size (mm)</th>
                <th className="px-4 py-3 text-left font-medium text-(--ui-text-muted)">Shows</th>
                <th className="px-4 py-3 text-center font-medium text-(--ui-text-muted)">Default</th>
                <th className="px-4 py-3 text-center font-medium text-(--ui-text-muted)">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {templates.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-(--ui-text-muted)">
                  <Tag size={36} className="mx-auto mb-2 opacity-30" />
                  No templates yet. Create one to get started.
                </td></tr>
              ) : templates.map((t) => (
                <tr key={t.id} className="hover:bg-(--ui-muted-surface)">
                  <td className="px-4 py-3 font-semibold text-(--ui-text)">{t.name}</td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">{t.width_mm} × {t.height_mm} mm</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {t.show_name ? <span className="text-xs bg-(--ui-muted-surface) text-(--ui-text-muted) px-2 py-0.5 rounded-full">Name</span> : null}
                      {t.show_price ? <span className="text-xs bg-(--ui-muted-surface) text-(--ui-text-muted) px-2 py-0.5 rounded-full">Price</span> : null}
                      {t.show_barcode ? <span className="text-xs bg-(--ui-muted-surface) text-(--ui-text-muted) px-2 py-0.5 rounded-full">Barcode</span> : null}
                      {t.show_sku ? <span className="text-xs bg-(--ui-muted-surface) text-(--ui-text-muted) px-2 py-0.5 rounded-full">SKU</span> : null}
                      {t.show_brand ? <span className="text-xs bg-(--ui-muted-surface) text-(--ui-text-muted) px-2 py-0.5 rounded-full">Brand</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {t.is_default ? <Check size={18} className="mx-auto text-(--ui-success-fg)" /> : <span className="text-(--ui-text-muted)">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg text-(--ui-text-muted) hover:text-(--ui-text) hover:bg-(--ui-muted-surface)"><Edit2 size={15} /></button>
                      <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-lg text-(--ui-text-muted) hover:text-(--ui-danger-fg) hover:bg-(--ui-danger-bg)"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Template Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-(--ui-surface) rounded-xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">{modal === "add" ? "New Template" : "Edit Template"}</h2>
              <button onClick={() => setModal(null)} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X size={18} /></button>
            </div>
            {formError && <p className="text-sm text-(--ui-danger-fg) bg-(--ui-danger-bg) px-3 py-2 rounded-(--ui-radius-sm)">{formError}</p>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-(--ui-text) mb-1">Template Name *</label>
                <input value={f.name} onChange={(e) => setForm({ ...f, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-(--ui-focus)"
                  placeholder="e.g. Small Shelf Label" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-(--ui-text) mb-1">Width (mm)</label>
                  <input type="number" min="20" max="200" step="0.5" value={f.width_mm}
                    onChange={(e) => setForm({ ...f, width_mm: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-(--ui-text) mb-1">Height (mm)</label>
                  <input type="number" min="15" max="200" step="0.5" value={f.height_mm}
                    onChange={(e) => setForm({ ...f, height_mm: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-(--ui-text) mb-1">Font Size (px)</label>
                  <input type="number" min="7" max="18" value={f.font_size}
                    onChange={(e) => setForm({ ...f, font_size: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-(--ui-text) mb-2">Show Fields</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "show_name", label: "Product Name" },
                    { key: "show_price", label: "Price" },
                    { key: "show_barcode", label: "Barcode (SVG)" },
                    { key: "show_sku", label: "SKU" },
                    { key: "show_brand", label: "Brand" },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-(--ui-text) cursor-pointer">
                      <input type="checkbox" checked={!!f[key]}
                        onChange={(e) => setForm({ ...f, [key]: e.target.checked })}
                        className="rounded" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-(--ui-text) cursor-pointer">
                <input type="checkbox" checked={!!f.is_default}
                  onChange={(e) => setForm({ ...f, is_default: e.target.checked })} className="rounded" />
                Set as default template
              </label>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setModal(null)} className="px-4 py-2 border rounded-lg text-sm hover:bg-(--ui-muted-surface)">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-(--ui-primary) text-(--ui-on-primary) rounded-full text-sm font-semibold hover:bg-(--ui-primary-strong) disabled:opacity-50">
                  {saving ? "Saving..." : modal === "add" ? "Create Template" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Labels Modal */}
      {printModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-(--ui-surface) rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Printer size={18} /> Print Barcode Labels</h2>
              <button onClick={() => setPrintModal(false)} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X size={18} /></button>
            </div>

            <div>
              <label className="block text-sm font-medium text-(--ui-text) mb-1">Label Template</label>
              <select value={printTemplate} onChange={(e) => setPrintTemplate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-(--ui-focus)">
                <option value="">— Select template —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.width_mm}×{t.height_mm}mm)</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-(--ui-text) mb-1">Search Products</label>
                <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-(--ui-focus)"
                  placeholder="Name, SKU or barcode…" />
                <div className="border rounded-lg divide-y max-h-56 overflow-y-auto">
                  {filteredProducts.length === 0 ? (
                    <div className="px-3 py-4 text-center text-(--ui-text-muted) text-sm">No products found</div>
                  ) : filteredProducts.map((p) => (
                    <button key={queueKey(p)} type="button" onClick={() => addToPrintQueue(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-(--ui-muted-surface) flex justify-between items-center gap-2">
                      <span className="min-w-0 break-words font-medium">{p.name}</span>
                      <span className="text-xs text-(--ui-text-muted) shrink-0">{p.barcode}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-(--ui-text) mb-1">
                  Print Queue ({printItems.length} items)
                </label>
                <div data-testid="print-queue" className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                  {printItems.length === 0 ? (
                    <div className="px-3 py-8 text-center text-(--ui-text-muted) text-sm">Click products to add</div>
                  ) : printItems.map((item) => (
                    <div key={queueKey(item)} className="flex items-center gap-2 px-3 py-2">
                      <span className="flex-1 min-w-0 text-sm break-words">{item.name}</span>
                      <input type="number" min="1" max="999" value={item.copies}
                        onChange={(e) => updateCopies(queueKey(item), e.target.value)}
                        className="w-14 border rounded px-2 py-1 text-xs text-center" />
                      <span className="text-xs text-(--ui-text-muted)">×</span>
                      <button onClick={() => setPrintItems((prev) => prev.filter((i) => queueKey(i) !== queueKey(item)))}
                        className="text-(--ui-text-muted) hover:text-(--ui-danger-fg)"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {printItems.length > 0 && (
              <p className="text-sm text-(--ui-text-muted)">
                Total labels: <strong>{printItems.reduce((s, i) => s + i.copies, 0)}</strong>
              </p>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button type="button" onClick={() => setPrintModal(false)} className="px-4 py-2 border rounded-lg text-sm hover:bg-(--ui-muted-surface)">Cancel</button>
              <button onClick={handlePrint} disabled={printing || !printItems.length || !printTemplate}
                className="flex items-center gap-2 px-4 py-2 bg-(--ui-primary) text-(--ui-on-primary) rounded-full text-sm font-semibold hover:bg-(--ui-primary-strong) disabled:opacity-50">
                <Printer size={15} /> {printing ? "Opening..." : "Print Labels"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
