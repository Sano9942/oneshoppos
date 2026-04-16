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

  const printSlip = useCallback(async (s) => {
    const result = await printToHardware(s, receiptTemplate, presetLabels);
    if (result.fallback) {
      buildReceiptHtml(s, receiptTemplate, currencySymbol, presetLabels);
    }
  }, [receiptTemplate, presetLabels, currencySymbol]);

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
  };
}
