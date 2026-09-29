import { useState, useEffect, useRef } from "react";
import { FileText, Plus, Edit2, Trash2, X, CheckCircle2, Star, Upload } from "lucide-react";

import { api } from '../api';
import { useCurrency } from '../contexts/CurrencyContext';
import { PAPER_SIZES, pxForChars } from '../utils/paperSizes';


const EMPTY = {
  name: "",
  header_text: "SanoPOS",
  footer_text: "Thank you for your purchase!",
  show_barcode: false,
  show_logo: false,
  is_active: false,
  // Bucket F designer v2 fields
  logo_url: "",
  paper_width: 48,
  show_tax_breakdown: true,
  show_fbr: true,
  show_qr: true,
};

// Live receipt preview using template values. Width tracks paper_width so
// merchants can see 58mm vs 80mm render differences inline.
function ReceiptPreview({ template, symbol }) {
  const s = symbol || "$";
  const width = pxForChars(template.paper_width || 48);
  const showTax = template.show_tax_breakdown !== false;
  const showFbr = template.show_fbr !== false;
  const showQr = template.show_qr !== false;
  return (
    <div
      className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-4 font-mono text-xs text-(--ui-text)"
      style={{ width: `${width}px` }}
    >
      <div className="text-center border-b border-dashed border-(--ui-border-strong) pb-3 mb-3">
        {template.logo_url && (
          <img
            src={template.logo_url}
            alt=""
            className="mx-auto mb-2 max-h-10 object-contain"
          />
        )}
        {(() => {
          const [name, ...rest] = String(template.header_text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          return (
            <>
              <div className="font-bold text-base">{name || "Store Name"}</div>
              {rest.map((line, i) => <div key={i} className="text-[11px]">{line}</div>)}
            </>
          );
        })()}
        <div className="text-(--ui-text-muted) text-[11px] mt-1">Receipt #1042</div>
      </div>
      <div className="space-y-1 mb-3">
        <div className="flex justify-between"><span>2x Sample Item</span><span>{s} 40.00</span></div>
        <div className="flex justify-between"><span>1x Another Item</span><span>{s} 15.00</span></div>
      </div>
      <div className="border-t border-dashed border-(--ui-border-strong) pt-2 mb-3 space-y-1">
        <div className="flex justify-between text-(--ui-text-muted)"><span>Subtotal</span><span>{s} 55.00</span></div>
        {showTax && (
          <div className="flex justify-between text-(--ui-text-muted)"><span>Tax</span><span>{s} 2.75</span></div>
        )}
        <div className="flex justify-between font-bold"><span>TOTAL</span><span>{s} 57.75</span></div>
        <div className="flex justify-between text-(--ui-text-muted)"><span>Cash</span><span>{s} 60.00</span></div>
        <div className="flex justify-between font-bold"><span>CHANGE</span><span>{s} 2.25</span></div>
      </div>
      {template.show_barcode && (
        <div className="border-t border-dashed border-(--ui-border-strong) pt-2 mb-2 text-center">
          <div className="text-[10px] tracking-widest text-(--ui-text-muted)">▌▌▌▌▌▌▌▌▌▌▌▌</div>
          <div className="text-[10px] text-(--ui-text-muted)">1042</div>
        </div>
      )}
      {(showFbr || showQr) && (
        <div className="border-t border-dashed border-(--ui-border-strong) pt-2 mb-2 text-center">
          {showFbr && <div className="text-[10px] text-(--ui-text-muted)">FBR Ref: (sample)</div>}
          {showQr && (
            <div className="mx-auto mt-1 h-10 w-10 bg-(--ui-muted-surface) text-[8px] text-(--ui-text-muted) flex items-center justify-center border border-(--ui-border-strong)">
              QR
            </div>
          )}
        </div>
      )}
      <div className="border-t border-dashed border-(--ui-border-strong) pt-2 text-center text-[11px] font-bold">
        {String(template.footer_text || "").split(/\r?\n/).filter((l) => l.trim()).map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </div>
  );
}

export default function ReceiptTemplates() {
  const { symbol } = useCurrency();
  const [templates, setTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const logoInputRef = useRef(null);

  const handleLogoUpload = async (file) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const data = await api.upload("/api/uploads/receipt-logo", fd);
      setForm((f) => ({ ...f, logo_url: data.url }));
    } catch (err) {
      alert("Logo upload failed: " + err.message);
    } finally {
      setIsUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async () => {
    setIsLoading(true);
    try {
      const data = await api.get("/api/receipt-templates");
      setTemplates(data.templates || []);
    } catch {
      setError("Failed to load templates.");
    } finally {
      setIsLoading(false);
    }
  };

  const openCreate = () => {
    setEditingTemplate(null);
    setForm(EMPTY);
    setIsModalOpen(true);
  };

  const openEdit = (t) => {
    setEditingTemplate(t);
    setForm({
      name: t.name,
      header_text: t.header_text || "",
      footer_text: t.footer_text || "",
      show_barcode: !!t.show_barcode,
      show_logo: !!t.show_logo,
      is_active: !!t.is_active,
      // Bucket F designer v2. Null/undefined → sensible defaults so older
      // rows (before v76) hydrate cleanly.
      logo_url: t.logo_url || "",
      paper_width: Number.isFinite(Number(t.paper_width)) ? Number(t.paper_width) : 48,
      show_tax_breakdown: t.show_tax_breakdown !== false,
      show_fbr: t.show_fbr !== false,
      show_qr: t.show_qr !== false,
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setIsSaving(true);
    try {
      if (editingTemplate) {
        await api.put(`/api/receipt-templates/${editingTemplate.id}`, form);
      } else {
        await api.post("/api/receipt-templates", form);
      }
      await fetchTemplates();
      setIsModalOpen(false);
    } catch (err) {
      alert("Error saving: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await api.del(`/api/receipt-templates/${id}`);
      fetchTemplates();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSetActive = async (t) => {
    try {
      await api.put(`/api/receipt-templates/${t.id}`, { ...t, show_barcode: !!t.show_barcode, show_logo: !!t.show_logo, is_active: true });
      fetchTemplates();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="w-full h-full flex flex-col space-y-6">
      <div className="flex justify-end">
        <button
          onClick={openCreate}
          className="bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) px-5 py-2.5 rounded-lg font-bold transition-all flex items-center gap-2"
        >
          <Plus size={18} /> New Template
        </button>
      </div>

      {/* Template Cards */}
      <div className="flex-1">
        {isLoading ? (
          <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-8 text-center text-(--ui-text-muted)">
            Loading templates…
          </div>
        ) : error ? (
          <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-8 text-center text-(--ui-danger-fg)">{error}</div>
        ) : templates.length === 0 ? (
          <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-16 text-center text-(--ui-text-muted) flex flex-col items-center">
            <FileText size={48} className="mb-4 opacity-20" />
            <h3 className="text-lg font-bold text-(--ui-text) mb-1">No Templates</h3>
            <p className="text-sm">Create a receipt template to customize your printed receipts.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {templates.map((t) => (
              <div
                key={t.id}
                className={`bg-(--ui-surface) rounded-xl border flex flex-col overflow-hidden ${
                  t.is_active ? "border-(--ui-primary) ring-2 ring-(--ui-primary)/20" : "border-(--ui-border)"
                }`}
              >
                {/* Card header */}
                <div className="flex justify-between items-start p-4 border-b border-(--ui-border)">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-(--ui-text)">{t.name}</span>
                      {t.is_active && (
                        <span className="bg-(--ui-primary) text-(--ui-on-primary) text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 size={10} /> ACTIVE
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-(--ui-text-muted) mt-1 space-x-2">
                      {t.show_barcode ? <span>Barcode ✓</span> : null}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {!t.is_active && (
                      <button
                        onClick={() => handleSetActive(t)}
                        className="p-1.5 text-(--ui-text-muted) hover:text-(--ui-primary) hover:bg-(--ui-muted-surface) rounded transition-colors"
                        title="Set as active"
                      >
                        <Star size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(t)}
                      className="p-1.5 text-(--ui-text-muted) hover:text-(--ui-primary) hover:bg-(--ui-muted-surface) rounded transition-colors"
                      title="Edit"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id, t.name)}
                      className="p-1.5 text-(--ui-text-muted) hover:text-(--ui-danger-fg) hover:bg-(--ui-danger-bg) rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Mini receipt preview */}
                <div className="p-4 flex justify-center bg-(--ui-muted-surface) flex-1">
                  <ReceiptPreview template={t} symbol={symbol} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Slide-in Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-(--ui-primary)/20 backdrop-blur-sm"
            onClick={() => setIsModalOpen(false)}
          />
          <div className="relative w-full max-w-2xl bg-(--ui-surface) h-full shadow-2xl flex flex-col border-l border-(--ui-border) animate-slide-in-right">
            {/* Modal header */}
            <div className="p-6 border-b border-(--ui-border) flex justify-between items-center bg-(--ui-muted-surface) shrink-0">
              <h2 className="text-xl font-bold text-(--ui-text) flex items-center gap-2">
                {editingTemplate
                  ? <><Edit2 size={20} className="text-(--ui-primary)" /> Edit Template</>
                  : <><Plus size={20} className="text-(--ui-primary)" /> New Template</>
                }
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-(--ui-text-muted) hover:text-(--ui-text-muted) p-1 bg-(--ui-muted-surface)/50 rounded-full"
              >
                <X size={18} />
              </button>
            </div>

            {/* Two-column: form + preview */}
            <div className="flex flex-1 overflow-hidden min-h-0">
              {/* Form */}
              <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-y-auto min-h-0">
                <div className="p-6 space-y-5 flex-1">
                  <div>
                    <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-1.5">
                      Template Name *
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full px-4 py-2 border-2 border-(--ui-border) rounded-xl focus:outline-none focus:border-(--ui-primary) text-sm font-medium"
                      placeholder="e.g. Standard Receipt"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-1.5">
                      Header Text
                    </label>
                    <textarea
                      value={form.header_text}
                      onChange={(e) => setForm({ ...form, header_text: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-2 border-2 border-(--ui-border) rounded-xl focus:outline-none focus:border-(--ui-primary) text-sm resize-none"
                      placeholder={"Shop name\nAddress\nPhone"}
                    />
                    <p className="text-xs text-(--ui-text-muted) mt-1">Top of the receipt. The first line prints large as the shop name; each line after it (address, phone) prints on its own line.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-1.5">
                      Footer Text
                    </label>
                    <textarea
                      value={form.footer_text}
                      onChange={(e) => setForm({ ...form, footer_text: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-2 border-2 border-(--ui-border) rounded-xl focus:outline-none focus:border-(--ui-primary) text-sm resize-none"
                      placeholder="Thank you message, return policy, website…"
                    />
                    <p className="text-xs text-(--ui-text-muted) mt-1">Bottom of the receipt, in bold. Each line prints on its own line.</p>
                  </div>

                  {/* Bucket F: logo upload */}
                  <div>
                    <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-1.5">
                      Logo
                    </label>
                    <div className="flex items-center gap-3">
                      {form.logo_url ? (
                        <img
                          src={form.logo_url}
                          alt=""
                          className="h-14 w-14 rounded-lg border border-(--ui-border) bg-(--ui-surface) object-contain p-1"
                        />
                      ) : (
                        <div className="h-14 w-14 rounded-lg border-2 border-dashed border-(--ui-border) bg-(--ui-muted-surface) flex items-center justify-center text-(--ui-text-muted)">
                          <FileText size={18} />
                        </div>
                      )}
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => handleLogoUpload(e.target.files?.[0])}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        disabled={isUploading}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-(--ui-text) bg-(--ui-surface) border-2 border-(--ui-border) rounded-xl hover:border-(--ui-primary) disabled:opacity-60"
                      >
                        <Upload size={14} />
                        {isUploading ? "Uploading…" : form.logo_url ? "Replace" : "Upload"}
                      </button>
                      {form.logo_url && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, logo_url: "" })}
                          className="text-xs text-(--ui-text-muted) hover:text-(--ui-danger-fg)"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-(--ui-text-muted) mt-1">PNG/JPG/WebP up to 10MB. Resized to 300×100.</p>
                  </div>

                  {/* Bucket F: paper width */}
                  <div>
                    <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-1.5">
                      Paper Width
                    </label>
                    <select
                      value={form.paper_width}
                      onChange={(e) => setForm({ ...form, paper_width: Number(e.target.value) })}
                      className="w-full px-4 py-2 border-2 border-(--ui-border) rounded-xl focus:outline-none focus:border-(--ui-primary) text-sm"
                    >
                      {PAPER_SIZES.map((sz) => (
                        <option key={sz.value} value={sz.value}>{sz.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-(--ui-text-muted) mt-1">Controls layout width on browser popup and thermal printer.</p>
                  </div>

                  <div className="border-t border-(--ui-border) pt-5 space-y-3">
                    <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-2">
                      Options
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.show_barcode}
                        onChange={(e) => setForm({ ...form, show_barcode: e.target.checked })}
                        className="w-4 h-4 accent-(--ui-primary)"
                      />
                      <span className="text-sm text-(--ui-text) font-medium">Show barcode on receipt</span>
                    </label>
                    {/* Bucket F: three new toggles. Defaults ON — merchants
                        opt out for space on 58mm rolls or privacy reasons. */}
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.show_tax_breakdown}
                        onChange={(e) => setForm({ ...form, show_tax_breakdown: e.target.checked })}
                        className="w-4 h-4 accent-(--ui-primary)"
                      />
                      <span className="text-sm text-(--ui-text) font-medium">Show tax breakdown</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.show_fbr}
                        onChange={(e) => setForm({ ...form, show_fbr: e.target.checked })}
                        className="w-4 h-4 accent-(--ui-primary)"
                      />
                      <span className="text-sm text-(--ui-text) font-medium">Show FBR reference (IRN)</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.show_qr}
                        onChange={(e) => setForm({ ...form, show_qr: e.target.checked })}
                        className="w-4 h-4 accent-(--ui-primary)"
                      />
                      <span className="text-sm text-(--ui-text) font-medium">Show FBR QR code</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                        className="w-4 h-4 accent-(--ui-primary)"
                      />
                      <span className="text-sm text-(--ui-text) font-medium">Set as active template</span>
                      <span className="text-xs text-(--ui-text-muted)">(used by POS when printing)</span>
                    </label>
                  </div>
                </div>

                <div className="p-6 border-t border-(--ui-border) bg-(--ui-muted-surface) shrink-0 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-2.5 text-(--ui-text-muted) bg-(--ui-surface) border border-(--ui-border) font-bold rounded-xl hover:bg-(--ui-muted-surface) text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 py-2.5 bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-(--ui-on-primary) font-bold rounded-xl transition-colors shadow-md text-sm disabled:opacity-60"
                  >
                    {isSaving ? "Saving…" : editingTemplate ? "Update Template" : "Save Template"}
                  </button>
                </div>
              </form>

              {/* Live preview panel */}
              <div className="w-56 border-l border-(--ui-border) bg-(--ui-muted-surface) flex flex-col items-center p-5 gap-4 shrink-0">
                <span className="text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide">Live Preview</span>
                <ReceiptPreview template={form} symbol={symbol} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
