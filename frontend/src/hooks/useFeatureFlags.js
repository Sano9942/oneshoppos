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
  ui_redesign_pos: true,
  reports_enhanced_filters: false,
  reports_profit_layer: false,
  reports_inventory_health_plus: false,
  reports_exceptions: false,
  reports_scheduled_exports: false,
  context_selection_required: false,
  context_header_enforced: false,
  kiosk_context_locked: false,
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
