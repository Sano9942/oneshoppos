import { useState, useRef, useCallback } from "react";
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { PageShell, SectionCard, Button } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";
import { api } from "../../api";
import PriceSheetImport from "./PriceSheetImport";

const TABS = [
  { key: "products", label: "Products" },
  // OTS step 6c: a price sheet updates existing items (own screen).
  { key: "prices", label: "Update prices" },
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "expenses", label: "Expenses" },
  { key: "payments", label: "Payments" },
];

// Entities that support the WS4 supplier-catalog column-mapping step.
const MAPPABLE = new Set(["products", "customers", "suppliers"]);

// Convert AI-extracted invoice line items into a CSV File that flows straight
// through the normal products import pipeline (validation, auto-SKU, duplicate
// detection). Extracted rows carry cost but no retail price, so we derive
// selling_price from a shopkeeper-set default markup — they review it in the
// preview before importing.
const INVOICE_COLS = ["name", "selling_price", "cost_price", "stock_quantity", "unit", "barcode"];
function invoiceRowsToCsvFile(rows, markupPct) {
  const m = Number(markupPct) || 0;
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [INVOICE_COLS.join(",")];
  for (const r of rows) {
    const cost = Number(r.cost_price) || 0;
    const price = Math.round(cost * (1 + m / 100) * 100) / 100;
    const out = { ...r, selling_price: price || cost };
    lines.push(INVOICE_COLS.map((c) => esc(out[c])).join(","));
  }
  return new File([lines.join("\n")], "invoice.csv", { type: "text/csv" });
}

export default function ImportRedesign() {
  const [activeTab, setActiveTab] = useState("products");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  // WS4 supplier-catalog column mapping
  const [mapMode, setMapMode] = useState(false);
  const [inspect, setInspect] = useState(null); // { headers, target_fields, suggested, ... }
  const [columnMap, setColumnMap] = useState({}); // { theirHeader: ourField }
  const fileRef = useRef(null);
  const invoiceRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [invoiceMarkup, setInvoiceMarkup] = useState(25);
  const [dlTemplate, setDlTemplate] = useState(false);
  // OTS pilot step 6: imported items whose shelf labels are already right
  // (the iPOS switchover) stay off "Labels to reprint".
  const [alreadyLabelled, setAlreadyLabelled] = useState(false);
  const { success, error: showError } = useToast();

  const resetState = useCallback(() => {
    setFile(null);
    setPreview(null);
    setInspect(null);
    setColumnMap({});
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleTabChange = useCallback(
    (key) => {
      setActiveTab(key);
      setMapMode(false);
      resetState();
    },
    [resetState],
  );

  // The template endpoint sits behind tenant auth, and the tenant JWT lives in a
  // header attached only to fetch() (via AuthProvider's window.fetch patch) — a
  // plain <a href> browser navigation to the API carries no token and 401s with
  // AUTH_REQUIRED. Fetch through the authenticated api client instead, then
  // trigger the download client-side from the blob.
  const downloadTemplate = useCallback(async () => {
    setDlTemplate(true);
    try {
      const res = await api.raw(`/api/import/template/${activeTab}`);
      if (!res.ok) {
        let msg = `Download failed (HTTP ${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Templates are CSV now — the backend stopped emitting .xlsx when the
      // `xlsx` dependency (unfixable advisories) was removed from the import path.
      a.download = `${activeTab}_template.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showError(err.message || "Could not download the template");
    } finally {
      setDlTemplate(false);
    }
  }, [activeTab, showError]);

  const runPreview = useCallback(
    async (selected, map) => {
      setLoading(true);
      try {
        const fd = new FormData();
        fd.append("file", selected);
        if (map && Object.keys(map).length) {
          fd.append("column_map", JSON.stringify(map));
        }
        const res = await api.upload(`/api/import/${activeTab}?preview=1`, fd);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Preview failed");
        setPreview(data);
      } catch (err) {
        showError(err.message);
        setPreview(null);
      } finally {
        setLoading(false);
      }
    },
    [activeTab, showError],
  );

  const handleFileSelect = useCallback(
    async (e) => {
      const selected = e.target.files?.[0];
      if (!selected) return;
      setFile(selected);
      setPreview(null);
      setInspect(null);
      setColumnMap({});

      // Supplier-catalog flow: inspect headers first, let the user map columns,
      // then preview. Otherwise preview straight away using our template shape.
      if (mapMode && MAPPABLE.has(activeTab)) {
        setLoading(true);
        try {
          const fd = new FormData();
          fd.append("file", selected);
          const res = await api.upload(`/api/import/${activeTab}/inspect`, fd);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Could not read file");
          setInspect(data);
          setColumnMap(data.suggested || {});
        } catch (err) {
          showError(err.message);
          resetState();
        } finally {
          setLoading(false);
        }
        return;
      }

      await runPreview(selected, null);
    },
    [activeTab, mapMode, runPreview, showError, resetState],
  );

  const handleImport = useCallback(async () => {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (mapMode && Object.keys(columnMap).length) {
        fd.append("column_map", JSON.stringify(columnMap));
      }
      const labelled = activeTab === "products" && alreadyLabelled ? "?already_labelled=1" : "";
      const res = await api.upload(`/api/import/${activeTab}${labelled}`, fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      success(`Imported ${data.imported ?? data.count ?? 0} ${activeTab} successfully`);
      setMapMode(false);
      resetState();
    } catch (err) {
      showError(err.message);
    } finally {
      setImporting(false);
    }
  }, [file, activeTab, mapMode, columnMap, alreadyLabelled, success, showError, resetState]);

  // AI invoice-photo scan: image -> extracted rows -> CSV -> existing preview.
  const handleInvoiceScan = useCallback(
    async (e) => {
      const img = e.target.files?.[0];
      if (invoiceRef.current) invoiceRef.current.value = "";
      if (!img) return;
      setScanning(true);
      setMapMode(false);
      setPreview(null);
      setInspect(null);
      setColumnMap({});
      try {
        const fd = new FormData();
        fd.append("file", img);
        const res = await api.upload("/api/ai/invoice-extract", fd);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not read invoice");
        if (!data.rows?.length) {
          showError("No product lines found in that image — try a clearer photo");
          return;
        }
        const csv = invoiceRowsToCsvFile(data.rows, invoiceMarkup);
        setFile(csv);
        await runPreview(csv, null);
        success(
          `Extracted ${data.rows.length} item${data.rows.length !== 1 ? "s" : ""} — review, then import`,
        );
      } catch (err) {
        showError(err.message);
      } finally {
        setScanning(false);
      }
    },
    [invoiceMarkup, runPreview, showError, success],
  );

  const validRows = preview?.rows?.filter((r) => !r._errors?.length) ?? [];
  const errorRows = preview?.rows?.filter((r) => r._errors?.length) ?? [];
  const columns = preview?.rows?.length
    ? Object.keys(preview.rows[0]).filter(
        (k) =>
          k !== "_errors" &&
          k !== "_row" &&
          k !== "_suggestion" &&
          k !== "_sku_generated" &&
          k !== "_price_source",
      )
    : [];

  return (
    <PageShell
      title="Import Data"
      subtitle="Upload CSV or Excel files to bulk import products, customers, suppliers, expenses, and payments."
    >
      {/* Tab bar */}
      <div className="mb-5 flex gap-1 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`rounded-(--ui-radius-sm) px-4 py-2 text-sm font-medium transition ${
              activeTab === t.key
                ? "bg-(--ui-surface) text-(--ui-text) shadow-sm"
                : "text-(--ui-text-muted) hover:text-(--ui-text)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "prices" ? <PriceSheetImport /> : (
      <SectionCard className="p-5">
        {/* Template download */}
        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm text-(--ui-text-muted)">
            Download the template to see the expected format, then upload your filled file.
          </p>
          <button
            type="button"
            onClick={downloadTemplate}
            disabled={dlTemplate}
            className="inline-flex items-center gap-2 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-surface) px-4 py-2 text-sm font-medium text-(--ui-text) hover:bg-(--ui-muted-surface) transition shrink-0 disabled:opacity-60"
          >
            {dlTemplate ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download Template
          </button>
        </div>

        {/* Supplier-catalog column mapping toggle */}
        {MAPPABLE.has(activeTab) && (
          <label className="mb-4 flex items-center gap-2 text-sm text-(--ui-text) cursor-pointer select-none">
            <input
              type="checkbox"
              checked={mapMode}
              disabled={loading || importing}
              onChange={(e) => {
                setMapMode(e.target.checked);
                resetState();
              }}
              className="h-4 w-4 accent-(--ui-primary)"
            />
            <span>
              Supplier catalog — my file has custom column names (map them to our fields)
            </span>
          </label>
        )}

        {/* Invoice photo scan (AI) — products only */}
        {activeTab === "products" && (
          <div className="mb-4 flex flex-col gap-3 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-muted-surface) p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-(--ui-text)">Scan a supplier invoice photo</p>
                <p className="mt-0.5 text-xs text-(--ui-text-muted)">
                  Snap or upload a challan/invoice — AI reads the line items into the preview below to review and import.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <label className="flex items-center gap-1.5 text-xs text-(--ui-text-muted)">
                  Markup %
                  <input
                    type="number"
                    min="0"
                    value={invoiceMarkup}
                    onChange={(e) => setInvoiceMarkup(e.target.value)}
                    disabled={scanning || loading || importing}
                    className="w-16 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-surface) px-2 py-1.5 text-sm text-(--ui-text)"
                  />
                </label>
                <input
                  ref={invoiceRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleInvoiceScan}
                  disabled={scanning || loading || importing}
                />
                <Button
                  tone="primary"
                  disabled={scanning || loading || importing}
                  onClick={() => invoiceRef.current?.click()}
                >
                  {scanning ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Reading invoice…
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      Scan invoice photo
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Drop zone */}
        <label
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-(--ui-radius-md) border-2 border-dashed p-10 transition ${
            loading
              ? "border-(--ui-primary) bg-(--ui-primary)/5"
              : "border-(--ui-border) hover:border-(--ui-primary) hover:bg-(--ui-primary)/5"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileSelect}
            disabled={loading || importing}
          />
          {loading ? (
            <Loader2 className="h-10 w-10 text-(--ui-primary) animate-spin" />
          ) : (
            <FileSpreadsheet className="h-10 w-10 text-(--ui-text-muted)" />
          )}
          <div className="text-center">
            <p className="text-sm font-medium text-(--ui-text)">
              {loading ? "Parsing file..." : "Click to upload or drag and drop"}
            </p>
            <p className="mt-1 text-xs text-(--ui-text-muted)">CSV files only. In Excel: File → Save As → CSV.</p>
          </div>
          {file && !loading && (
            <p className="text-xs text-(--ui-text-muted)">
              Selected: {file.name}
            </p>
          )}
        </label>

        {/* Column mapping step (supplier catalog) */}
        {mapMode && inspect && !preview && (
          <div className="mt-5">
            <p className="mb-3 text-sm text-(--ui-text-muted)">
              Map your file's columns to our fields. Detected {inspect.headers.length} column
              {inspect.headers.length !== 1 ? "s" : ""} across {inspect.row_count} row
              {inspect.row_count !== 1 ? "s" : ""}. Leave a column as "— ignore —" to skip it.
            </p>
            <div className="overflow-x-auto rounded-(--ui-radius-sm) border border-(--ui-border)">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface)">
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Their column</th>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Sample value</th>
                    <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Maps to our field</th>
                  </tr>
                </thead>
                <tbody>
                  {inspect.headers.map((h) => (
                    <tr key={h} className="border-b border-(--ui-border)">
                      <td className="px-3 py-2 font-medium text-(--ui-text) max-w-48 truncate">{h}</td>
                      <td className="px-3 py-2 text-(--ui-text-muted) max-w-48 truncate">
                        {String(inspect.sample?.[h] ?? "")}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={columnMap[h] || ""}
                          onChange={(e) =>
                            setColumnMap((prev) => {
                              const next = { ...prev };
                              if (e.target.value) next[h] = e.target.value;
                              else delete next[h];
                              return next;
                            })
                          }
                          className="rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-surface) px-2 py-1.5 text-sm text-(--ui-text)"
                        >
                          <option value="">— ignore —</option>
                          {inspect.target_fields.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                tone="primary"
                disabled={loading || !Object.keys(columnMap).length}
                onClick={() => runPreview(file, columnMap)}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Building preview…
                  </span>
                ) : (
                  "Preview with mapping"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div className="mt-5">
            {/* Summary */}
            <div className="mb-4 flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-(--ui-success-fg)">
                <CheckCircle2 className="h-4 w-4" />
                {validRows.length} valid row{validRows.length !== 1 ? "s" : ""}
              </span>
              {errorRows.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-(--ui-danger-fg)">
                  <AlertCircle className="h-4 w-4" />
                  {errorRows.length} error{errorRows.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Table */}
            {columns.length > 0 && (
              <div className="overflow-x-auto rounded-(--ui-radius-sm) border border-(--ui-border)">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface)">
                      <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">#</th>
                      {columns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left font-medium text-(--ui-text-muted)"
                        >
                          {col}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-left font-medium text-(--ui-text-muted)">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => {
                      const hasError = row._errors?.length > 0;
                      return (
                        <tr
                          key={i}
                          className={`border-b border-(--ui-border) ${hasError ? "bg-(--ui-danger-bg)" : ""}`}
                        >
                          <td className="px-3 py-2 text-(--ui-text-muted)">{row._row ?? i + 1}</td>
                          {columns.map((col) => (
                            <td key={col} className="px-3 py-2 text-(--ui-text) max-w-48 truncate">
                              {row[col] ?? ""}
                              {col === "sku" && row._sku_generated && (
                                <span
                                  className="ml-1 text-xs uppercase text-(--ui-text-muted)"
                                  title="Auto-generated because this item had no barcode or SKU — edit the file first if you want your own code"
                                >
                                  auto
                                </span>
                              )}
                              {col === "price" && row._price_source === "margin" && (
                                <span
                                  className="ml-1 text-xs uppercase text-(--ui-text-muted)"
                                  title="Derived from the category's default margin — review before importing"
                                >
                                  margin
                                </span>
                              )}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            {hasError ? (
                              <span className="text-xs text-(--ui-danger-fg)">{row._errors.join("; ")}</span>
                            ) : row._suggestion ? (
                              <span className="text-xs text-(--ui-warning-fg)" title="A similar product already exists — review before importing to avoid a duplicate">
                                Looks like existing “{row._suggestion.name}”
                                {row._suggestion.sku ? ` (${row._suggestion.sku})` : ""} — merge?
                              </span>
                            ) : (
                              <span className="text-xs text-(--ui-success-fg)">OK</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Import button */}
            {validRows.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-end gap-4">
                {activeTab === "products" && (
                  <label className="flex items-center gap-2 text-sm text-(--ui-text) cursor-pointer">
                    <input type="checkbox" checked={alreadyLabelled} onChange={(e) => setAlreadyLabelled(e.target.checked)} />
                    These items already have shelf labels (keep them off Labels to reprint)
                  </label>
                )}
                <Button
                  tone="primary"
                  disabled={importing}
                  onClick={handleImport}
                >
                  {importing ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Importing...
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      Import {validRows.length} row{validRows.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </SectionCard>
      )}
    </PageShell>
  );
}
