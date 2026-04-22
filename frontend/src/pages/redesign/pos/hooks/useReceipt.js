import { useState, useEffect, useCallback } from "react";
import { api } from "../../../../api";
import { useCurrency } from "../../../../contexts/CurrencyContext";
import { usePreset } from "../../../../contexts/PresetContext";
import { buildReceiptHtml, printToHardware } from "../../../../utils/receipt";

export function useReceipt({ selectedOutletId }) {
  const { symbol: currencySymbol } = useCurrency();
  const { labels: presetLabels } = usePreset();

  const [slip, setSlip] = useState(null);
  const [slipOpen, setSlipOpen] = useState(false);
  const [receiptTemplate, setReceiptTemplate] = useState(null);

  // Recent Sales Panel
  const [recentSalesOpen, setRecentSalesOpen] = useState(false);
  const [recentSales, setRecentSales] = useState([]);
  const [recentSalesLoading, setRecentSalesLoading] = useState(false);
  const [recentSalesSearch, setRecentSalesSearch] = useState("");

  useEffect(() => {
    api.get("/api/receipt-templates/active")
      .then((d) => { if (d.template) setReceiptTemplate(d.template); })
      .catch(() => {});
  }, []);

  const loadRecentSales = useCallback(async () => {
    if (!selectedOutletId) return;
    setRecentSalesLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const data = await api.get("/api/sales", { date_from: today, outlet_id: selectedOutletId, limit: 50 });
      setRecentSales(data.sales || []);
    } catch {
      setRecentSales([]);
    } finally {
      setRecentSalesLoading(false);
    }
  }, [selectedOutletId]);

  // 2-G.15 Day 2: retry prompt state. printSlip resolves the printToHardware
  // result back to callers AND arms the retry modal when hardware fails.
  const [retryPrompt, setRetryPrompt] = useState(null); // { slip, error }

  const printSlip = useCallback(async (s) => {
    const result = await printToHardware(s, receiptTemplate, presetLabels);
    if (result && result.ok) return { ok: true };
    // Hardware failed — arm the retry modal instead of silently popping the
    // browser window. Caller decides whether to keep going.
    setRetryPrompt({ slip: s, error: result?.error || "Printer offline" });
    return { ok: false, error: result?.error || "Printer offline", fallback: true };
  }, [receiptTemplate, presetLabels]);

  const dismissRetryPrompt = useCallback(() => setRetryPrompt(null), []);

  // Keep a browser-fallback export for places that want the old behavior
  // (e.g. if the user opts out of the retry modal and wants a best-effort
  // browser popup anyway).
  const printBrowserFallback = useCallback((s) => {
    buildReceiptHtml(s, receiptTemplate, currencySymbol, presetLabels);
  }, [receiptTemplate, currencySymbol, presetLabels]);

  return {
    slip, setSlip,
    slipOpen, setSlipOpen,
    receiptTemplate,
    recentSalesOpen, setRecentSalesOpen,
    recentSales,
    recentSalesLoading,
    recentSalesSearch, setRecentSalesSearch,
    loadRecentSales,
    printSlip,
    printBrowserFallback,
    retryPrompt,
    dismissRetryPrompt,
  };
}
