import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

export default function PortalLoyalty() {
  const { tenantSlug } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    portalApi.get(tenantSlug, "/api/portal/me/loyalty").then(setData).catch(() => setData(null));
  }, [tenantSlug]);

  if (!data) return <div className="text-(--ui-text-muted)">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Loyalty</h1>
      <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6 space-y-3">
        <div>
          <div className="text-sm text-(--ui-text-muted)">Points</div>
          <div className="text-4xl font-semibold">{(data.loyalty_points || 0).toLocaleString()}</div>
        </div>
        <div>
          <div className="text-sm text-(--ui-text-muted)">Total spend</div>
          <div className="text-2xl font-medium">{Number(data.total_spend || 0).toLocaleString()}</div>
        </div>
        <div>
          <div className="text-sm text-(--ui-text-muted)">Tier</div>
          <div className="text-lg">{data.tier?.name || "No tier yet"}</div>
        </div>
      </div>
      <p className="text-sm text-(--ui-text-muted)">
        To redeem points, mention your account at checkout in store.
      </p>
    </div>
  );
}
