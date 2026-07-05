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

export default function ImportRedesign() {
  const [activeTab, setActiveTab] = useState("products");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);
  const { success, error: showError } = useToast();

  const resetState = useCallback(() => {
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleTabChange = useCallback(
    (key) => {
      setActiveTab(key);
      resetState();
    },
    [resetState],
  );

  const handleFileSelect = useCallback(
    async (e) => {
      const selected = e.target.files?.[0];
      if (!selected) return;
      setFile(selected);
      setPreview(null);
      setLoading(true);

      try {
        const fd = new FormData();
        fd.append("file", selected);
        const res = await api.upload(`/api/import/${activeTab}?preview=1`, fd);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Preview failed");
        setPreview(data);
      } catch (err) {
        showError(err.message);
        resetState();
      } finally {
        setLoading(false);
      }
    },
    [activeTab, showError, resetState],
  );

  const handleImport = useCallback(async () => {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.upload(`/api/import/${activeTab}`, fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      success(`Imported ${data.imported ?? data.count ?? 0} ${activeTab} successfully`);
      resetState();
    } catch (err) {
      showError(err.message);
    } finally {
      setImporting(false);
    }
  }, [file, activeTab, success, showError, resetState]);

  const validRows = preview?.rows?.filter((r) => !r._errors?.length) ?? [];
  const errorRows = preview?.rows?.filter((r) => r._errors?.length) ?? [];
  const columns = preview?.rows?.length
    ? Object.keys(preview.rows[0]).filter((k) => k !== "_errors" && k !== "_row")
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
