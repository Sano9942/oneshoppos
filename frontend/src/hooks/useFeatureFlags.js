import { useEffect, useMemo, useState } from "react";
import { API_BASE as API } from "../config";

const DEFAULT_FLAGS = {
  backup_restore: true,
  e_invoicing_export: true,
  supplier_payables: true,
  approvals: true,
  notifications: true,
  accounting_core: true,
  crm_quotations: true,
  advanced_hr: true,
  multi_company: true,
  // Phase 5: All redesign flags enabled (global cutover)
  ui_redesign_enabled: true,
  ui_redesign_inventory: true,
  ui_redesign_orders: true,
  ui_redesign_pos: true,
  ui_redesign_reports: true,
  ui_redesign_admin: true,
  ui_redesign_customers: true,
  ui_redesign_sales_history: true,
  ui_redesign_cash_management: true,
  ui_redesign_returns: true,
  ui_redesign_categories: true,
  ui_redesign_brands: true,
  ui_redesign_taxes: true,
  ui_redesign_attribute_sets: true,
  ui_redesign_stock_adjustments: true,
  ui_redesign_transfers: true,
  ui_redesign_returned_stock: true,
  ui_redesign_suppliers: true,
  ui_redesign_purchase_orders: true,
  ui_redesign_supplier_payables: true,
  ui_redesign_promotions: true,
  ui_redesign_expenses: true,
  // Wave C: Analytics and Admin
  ui_redesign_dashboard: true,
  ui_redesign_employees: true,
  ui_redesign_outlets: true,
  ui_redesign_administrator: true,
  ui_redesign_action_history: true,
  ui_redesign_backup_restore: true,
  ui_redesign_shopify: true,
  // Wave D: Tier 4 Modules
  ui_redesign_accounting: true,
  ui_redesign_crm: true,
  ui_redesign_quotations: true,
  ui_redesign_hr: true,
  ui_redesign_company_settings: true,
};

export default function useFeatureFlags(authHeaders) {
  const [flags, setFlags] = useState(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const headers =
      typeof authHeaders === "function"
        ? authHeaders()
        : authHeaders && typeof authHeaders === "object"
          ? authHeaders
          : {};

    fetch(`${API}/api/feature-flags`, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        const next = { ...DEFAULT_FLAGS };
        (data?.flags || []).forEach((f) => {
          next[f.key] = Number(f.enabled || 0) === 1;
        });
        setFlags(next);
      })
      .catch(() => {
        if (!mounted) return;
        setFlags(DEFAULT_FLAGS);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [authHeaders]);

  return useMemo(() => ({ flags, loading }), [flags, loading]);
}
