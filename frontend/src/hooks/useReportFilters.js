import { useMemo, useState } from "react";

export const DEFAULT_REPORT_FILTERS = {
  date_from: "",
  date_to: "",
  outlet_id: "",
  employee_id: "",
  category_id: "",
};

export default function useReportFilters(initial = {}) {
  const [filters, setFilters] = useState({ ...DEFAULT_REPORT_FILTERS, ...initial });
  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (String(v || "").trim()) p.set(k, String(v).trim());
    });
    return p.toString();
  }, [filters]);
  return { filters, setFilters, query };
}

