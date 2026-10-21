import { useEffect, useState } from "react";
import { api } from "../api";

// Is the shop actually selling through any channel (a marketplace / Shopify /
// WooCommerce connection, or a product published anywhere)? One Toy Store
// pilot 2026-10-21: the Sales Channels box, Compare-at Price and the "View
// Storefront" link follow this instead of the default-on
// marketplace_integrations switch. Fail-closed: hidden until known, and on
// error (e.g. 403 for staff without catalogue rights).
const NOT_IN_USE = { marketplace_connected: false, published_products: 0, in_use: false };

export default function useSalesChannelUsage(enabled = true) {
  const [usage, setUsage] = useState(NOT_IN_USE);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    api.get("/api/sales-channels/usage")
      .then((u) => { if (alive && u) setUsage({ ...NOT_IN_USE, ...u }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return usage;
}
