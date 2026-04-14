import { useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";
import { usePortalAuth } from "./PortalAuthProvider";

function Card({ title, value, subtitle, href, cta }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="text-3xl font-semibold mt-2">{value}</div>
      {subtitle && <div className="text-sm text-slate-500 mt-1">{subtitle}</div>}
      {href && cta && (
        <Link to={href} className="inline-block mt-4 text-sm text-emerald-700 hover:underline">
          {cta} →
        </Link>
      )}
    </div>
  );
}

export default function PortalDashboard() {
  const { tenantSlug } = useParams();
  const auth = usePortalAuth();
  const { labels = {}, storeName, enabledTabs = [] } = useOutletContext() || {};
  const [invoices, setInvoices] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loyalty, setLoyalty] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const tasks = [portalApi.get(tenantSlug, "/api/portal/me/invoices")];
        if (enabledTabs.includes("appointments"))
          tasks.push(portalApi.get(tenantSlug, "/api/portal/me/appointments?scope=upcoming"));
        else tasks.push(Promise.resolve([]));
        if (enabledTabs.includes("loyalty"))
          tasks.push(portalApi.get(tenantSlug, "/api/portal/me/loyalty"));
        else tasks.push(Promise.resolve(null));

        const [inv, appt, loy] = await Promise.all(tasks);
        if (cancelled) return;
        setInvoices(Array.isArray(inv) ? inv : []);
        setAppointments(Array.isArray(appt) ? appt : []);
        setLoyalty(loy);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, enabledTabs]);

  const outstanding = invoices
    .filter((i) => i.status !== "paid" && i.status !== "void")
    .reduce((sum, i) => sum + Number(i.balance_due || 0), 0);

  const nextAppt = appointments[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {labels.dashboard_heading || "Welcome back"}, {auth.customer?.name || "there"}
        </h1>
        <p className="text-slate-600">Your account at {storeName}</p>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {enabledTabs.includes("invoices") && (
            <Card
              title="Outstanding balance"
              value={outstanding.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              subtitle={
                invoices.filter((i) => i.status !== "paid" && i.status !== "void").length +
                " open invoice(s)"
              }
              href={`/portal/${tenantSlug}/invoices`}
              cta="View invoices"
            />
          )}
          {enabledTabs.includes("appointments") && (
            <Card
              title="Next appointment"
              value={nextAppt ? new Date(nextAppt.start_at).toLocaleString() : "None"}
              subtitle={nextAppt?.service_name || ""}
              href={`/portal/${tenantSlug}/appointments`}
              cta={labels.book_cta || "Manage bookings"}
            />
          )}
          {enabledTabs.includes("loyalty") && loyalty && (
            <Card
              title="Loyalty points"
              value={(loyalty.loyalty_points || 0).toLocaleString()}
              subtitle={loyalty.tier ? `Tier: ${loyalty.tier.name}` : "No tier yet"}
              href={`/portal/${tenantSlug}/loyalty`}
              cta="View details"
            />
          )}
        </div>
      )}
    </div>
  );
}
