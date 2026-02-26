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
  ui_redesign_enabled: true,
  ui_redesign_inventory: true,
  ui_redesign_orders: false,
  ui_redesign_pos: false,
  ui_redesign_reports: false,
  ui_redesign_admin: false,
  ui_redesign_customers: false,
  ui_redesign_sales_history: false,
  ui_redesign_cash_management: false,
  ui_redesign_returns: false,
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
