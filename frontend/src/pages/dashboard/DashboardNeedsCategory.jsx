// One Toy Store: dashboard reminder for the "Needs a Category" fix-it page
// (owner, 2026-10-19) — "N toys need a category", shown while any toy that
// sold or is in stock is still in "Needs a Category" (or has none). The
// caller renders it only for manage_inventory, the page's permission.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { SectionCard } from "../../ui/primitives";

export function DashboardNeedsCategory() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let live = true;
    api.get("/api/products/needs-category/count")
      .then((d) => { if (live) setCount(Number(d?.count || 0)); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!count) return null;
  return (
    <SectionCard className="p-3">
      <div data-testid="nc-dashboard" className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-(--ui-text)">
          {count === 1 ? "1 toy needs a category" : `${count} toys need a category`} (sold or in stock)
        </span>
        <Link to="/needs-category" className="font-semibold text-(--ui-text) underline">Fix them</Link>
      </div>
    </SectionCard>
  );
}
