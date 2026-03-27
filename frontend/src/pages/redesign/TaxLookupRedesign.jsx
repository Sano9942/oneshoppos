import { useState, useCallback } from "react";
import { Search, Download, MessageSquarePlus, X, Loader2 } from "lucide-react";
import { PageShell, SectionCard, Button, Input, Select } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";
import { API } from "../../config";

const PROVINCES = [
  { key: "punjab", label: "Punjab", field: "punjab_pra" },
  { key: "sindh", label: "Sindh", field: "sindh_srb" },
  { key: "kpk", label: "KPK", field: "kpk_kpra" },
  { key: "balochistan", label: "Balochistan", field: "balochistan_bra" },
  { key: "ict", label: "ICT (Islamabad)", field: null },
];

const CORRECTION_FIELDS = [
  { key: "federal_gst", label: "Federal GST" },
  { key: "punjab_pra", label: "Punjab PRA" },
  { key: "sindh_srb", label: "Sindh SRB" },
  { key: "kpk_kpra", label: "KPK KPRA" },
  { key: "balochistan_bra", label: "Balochistan BRA" },
];

export default function TaxLookupRedesign() {
  const [province, setProvince] = useState("punjab");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Suggest correction modal
  const [suggestModal, setSuggestModal] = useState(null);
  const [suggestForm, setSuggestForm] = useState({
    field_name: "federal_gst",
    suggested_value: "",
    source_reference: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const { success, error: showError } = useToast();

  const provinceField = PROVINCES.find((p) => p.key === province)?.field;

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/tax-lookup?q=${encodeURIComponent(query.trim())}&province=${province}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.rates || []);
      setLastUpdated(data.last_updated || null);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, province, showError]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") handleSearch();
    },
    [handleSearch],
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch(`${API}/tax-lookup/export`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Export failed");

      const rates = data.rates || [];
      if (!rates.length) {
        showError("No data to export");
        return;
      }

      const headers = Object.keys(rates[0]);
      const csvRows = [
        headers.join(","),
        ...rates.map((row) =>
          headers
            .map((h) => {
              const val = row[h] ?? "";
              const str = String(val);
              return str.includes(",") || str.includes('"') || str.includes("\n")
                ? `"${str.replace(/"/g, '""')}"`
                : str;
            })
            .join(","),
        ),
      ];
      const csvContent = csvRows.join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "tax-rate-schedule.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      success("Schedule downloaded");
    } catch (err) {
      showError(err.message);
    } finally {
      setExporting(false);
    }
  }, [success, showError]);

  const openSuggestModal = useCallback((row) => {
    setSuggestModal(row);
    setSuggestForm({
      field_name: "federal_gst",
      suggested_value: "",
      source_reference: "",
      notes: "",
    });
  }, []);

  const closeSuggestModal = useCallback(() => {
    setSuggestModal(null);
  }, []);

  const handleSuggestSubmit = useCallback(async () => {
    if (!suggestModal) return;
    if (!suggestForm.suggested_value.trim()) {
      showError("Suggested value is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/tax-lookup/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference_id: suggestModal.id || suggestModal.hs_code,
          field_name: suggestForm.field_name,
          suggested_value: suggestForm.suggested_value,
          source_reference: suggestForm.source_reference || undefined,
          notes: suggestForm.notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      success("Correction suggestion submitted. Thank you!");
      closeSuggestModal();
    } catch (err) {
      showError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [suggestModal, suggestForm, success, showError, closeSuggestModal]);

  return (
    <PageShell
      title="Tax Rate Lookup"
      subtitle="Search Pakistan federal and provincial tax rates by product, HS code, or category"
      right={
        <Button onClick={handleExport} disabled={exporting}>
          {exporting ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Exporting...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Download Full Schedule
            </span>
          )}
        </Button>
      }
    >
      {/* Last Updated Banner */}
      {lastUpdated && (
        <div className="mb-4 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) px-4 py-2 text-sm text-(--ui-text-muted)">
          Last updated: {lastUpdated}
        </div>
      )}

      {/* Province Selector + Search Bar */}
      <SectionCard className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="shrink-0">
            <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
              Province
            </label>
            <Select value={province} onChange={(e) => setProvince(e.target.value)}>
              {PROVINCES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="grow">
            <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
              Search by product name, HS code, or category (EN/UR)
            </label>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. 0402, milk, dairy, دودھ"
              />
              <Button tone="primary" onClick={handleSearch} disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Results Table */}
      <SectionCard>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) text-left">
                <th className="px-4 py-3 font-medium text-(--ui-text-muted)">HS Code</th>
                <th className="px-4 py-3 font-medium text-(--ui-text-muted)">Description (EN)</th>
                <th className="px-4 py-3 font-medium text-(--ui-text-muted)">Description (UR)</th>
                <th className="px-4 py-3 font-medium text-(--ui-text-muted)">Federal GST</th>
                <th className="px-4 py-3 font-medium text-(--ui-text-muted)">
                  {PROVINCES.find((p) => p.key === province)?.label || "Provincial"} Rate
                </th>
                <th className="px-4 py-3 font-medium text-(--ui-text-muted)">Exemption Notes</th>
                <th className="px-4 py-3 font-medium text-(--ui-text-muted)">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-(--ui-text-muted)">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                  </td>
                </tr>
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-(--ui-text-muted)">
                    {query.trim()
                      ? "No results found. Try a different search term."
                      : "Enter a search term above to look up tax rates."}
                  </td>
                </tr>
              ) : (
                results.map((row, idx) => (
                  <tr
                    key={row.id || row.hs_code || idx}
                    className="border-b border-(--ui-border) last:border-b-0 hover:bg-(--ui-muted-surface)"
                  >
                    <td className="px-4 py-3 font-mono text-(--ui-text)">{row.hs_code}</td>
                    <td className="px-4 py-3 text-(--ui-text)">{row.description_en}</td>
                    <td className="px-4 py-3 text-(--ui-text)" dir="rtl">
                      {row.description_ur}
                    </td>
                    <td className="px-4 py-3 text-(--ui-text)">{row.federal_gst ?? "—"}</td>
                    <td className="px-4 py-3 font-semibold text-(--ui-primary)">
                      {provinceField ? (row[provinceField] ?? "—") : "—"}
                    </td>
                    <td className="max-w-[200px] px-4 py-3 text-xs text-(--ui-text-muted)">
                      {row.exemption_notes || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Button size="sm" tone="plain" onClick={() => openSuggestModal(row)}>
                        <span className="flex items-center gap-1">
                          <MessageSquarePlus className="h-3.5 w-3.5" />
                          Suggest
                        </span>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Suggest Correction Modal */}
      {suggestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-(--ui-border) px-5 py-4">
              <h2 className="text-lg font-semibold text-(--ui-text)">Suggest Correction</h2>
              <button
                onClick={closeSuggestModal}
                className="rounded p-1 text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 px-5 py-4">
              <p className="text-sm text-(--ui-text-muted)">
                HS Code: <span className="font-mono font-medium text-(--ui-text)">{suggestModal.hs_code}</span>
                {" — "}
                {suggestModal.description_en}
              </p>

              <div>
                <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                  Field to correct
                </label>
                <Select
                  value={suggestForm.field_name}
                  onChange={(e) =>
                    setSuggestForm((f) => ({ ...f, field_name: e.target.value }))
                  }
                >
                  {CORRECTION_FIELDS.map((cf) => (
                    <option key={cf.key} value={cf.key}>
                      {cf.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                  Suggested value
                </label>
                <Input
                  type="number"
                  step="any"
                  value={suggestForm.suggested_value}
                  onChange={(e) =>
                    setSuggestForm((f) => ({ ...f, suggested_value: e.target.value }))
                  }
                  placeholder="e.g. 17"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                  SRO reference (optional)
                </label>
                <Input
                  value={suggestForm.source_reference}
                  onChange={(e) =>
                    setSuggestForm((f) => ({ ...f, source_reference: e.target.value }))
                  }
                  placeholder="e.g. SRO 1125(I)/2011"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                  Notes (optional)
                </label>
                <textarea
                  className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border) bg-white px-3 py-2 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted)"
                  rows={3}
                  value={suggestForm.notes}
                  onChange={(e) =>
                    setSuggestForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Any additional context or explanation"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-(--ui-border) px-5 py-4">
              <Button onClick={closeSuggestModal}>Cancel</Button>
              <Button tone="primary" onClick={handleSuggestSubmit} disabled={submitting}>
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting...
                  </span>
                ) : (
                  "Submit Suggestion"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
