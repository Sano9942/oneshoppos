import { useState, useRef, useCallback } from "react";
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { PageShell, SectionCard, Button } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";
import { api } from "../../api";
import { API_BASE } from "../../config";

const TABS = [
  { key: "products", label: "Products" },
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "expenses", label: "Expenses" },
  { key: "payments", label: "Payments" },
];

// Entities that support the WS4 supplier-catalog column-mapping step.
const MAPPABLE = new Set(["products", "customers", "suppliers"]);

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
      const res = await api.upload(`/api/import/${activeTab}`, fd);
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
  }, [file, activeTab, mapMode, columnMap, success, showError, resetState]);

  const validRows = preview?.rows?.filter((r) => !r._errors?.length) ?? [];
  const errorRows = preview?.rows?.filter((r) => r._errors?.length) ?? [];
  const columns = preview?.rows?.length
    ? Object.keys(preview.rows[0]).filter(
        (k) => k !== "_errors" && k !== "_row" && k !== "_suggestion",
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

      <SectionCard className="p-5">
        {/* Template download */}
        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm text-(--ui-text-muted)">
            Download the template to see the expected format, then upload your filled file.
          </p>
          <a
            href={`${API_BASE}/api/import/template/${activeTab}`}
            download
            className="inline-flex items-center gap-2 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-surface) px-4 py-2 text-sm font-medium text-(--ui-text) hover:bg-(--ui-muted-surface) transition shrink-0"
          >
            <Download className="h-4 w-4" />
            Download Template
          </a>
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
            accept=".csv,.xlsx,.xls"
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
            <p className="mt-1 text-xs text-(--ui-text-muted)">CSV, XLSX, or XLS files</p>
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
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            {hasError ? (
                              <span className="text-xs text-(--ui-danger-fg)">{row._errors.join("; ")}</span>
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
              <div className="mt-4 flex justify-end">
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
    </PageShell>
  );
}
