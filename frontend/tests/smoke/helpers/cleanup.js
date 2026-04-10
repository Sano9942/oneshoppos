import { del } from "../../helpers/api.js";

const bag = [];

/**
 * Registers an API-deletable resource for teardown. Call from inside a test
 * whenever you create something that can be deleted later.
 *
 * @param {string} type — resource type (must match a key in DELETERS below)
 * @param {number|string} id — resource id or composite key
 */
export function trackForCleanup(type, id) {
  if (id == null) return;
  bag.push({ type, id });
}

const DELETERS = {
  // Omnichannel / core
  product: (id) => del(`/api/products/${id}`),
  customer: (id) => del(`/api/customers/${id}`),
  category: (id) => del(`/api/categories/${id}`),
  "return-policy": (id) => del(`/api/return-policies/${id}`),
  "return-reason": (id) => del(`/api/return-reasons/${id}`),

  // Phase 2
  schedule: (id) => del(`/api/schedules/${id}`),
  "price-list": (id) => del(`/api/price-lists/${id}`),
  "price-list-assignment": (id) => del(`/api/price-list-assignments/${id}`),
  "draft-order": (id) => del(`/api/draft-orders/${id}`),

  // Phase 2b
  "smart-collection": (id) => del(`/api/smart-collections/${id}`),
  "outlet-tax-profile": (id) => del(`/api/outlet-tax-profiles/${id}`),
  "scheduled-change": (id) => del(`/api/catalog/scheduled-changes/${id}`),
  "commission-plan": (id) => del(`/api/commission-plans/${id}`),
  "product-affinity": (id) => del(`/api/product-affinities/${id}`),
  "pos-layout": (id) => del(`/api/pos-layouts/${id}`),
  "report-definition": (id) => del(`/api/reports/builder/definitions/${id}`),

  // Phase 3
  "marketing-campaign": (id) => del(`/api/marketing/campaigns/${id}`),
  "marketing-template": (id) => del(`/api/marketing/templates/${id}`),
  "customer-invoice": (id) => del(`/api/customer-invoices/${id}`),
  "subscription-plan": (id) => del(`/api/subscription-plans/${id}`),
  "customer-subscription": (id) => del(`/api/customer-subscriptions/${id}`),

  // Phase 4 — restaurant
  "restaurant-floor": (id) => del(`/api/restaurant/floor-plans/${id}`),
  "restaurant-table": (id) => del(`/api/restaurant/tables/${id}`),
  "restaurant-check": (id) => del(`/api/restaurant/checks/${id}`),
  "restaurant-session": (id) => del(`/api/restaurant/sessions/${id}`),
  "kds-station": (id) => del(`/api/kds/stations/${id}`),

  // Phase 4 — bookings
  "booking-service": (id) => del(`/api/booking-services/${id}`),
  appointment: (id) => del(`/api/appointments/${id}`),

  // Phase 4 — service workspace
  project: (id) => del(`/api/projects/${id}`),
  contract: (id) => del(`/api/contracts/${id}`),
  "contract-template": (id) => del(`/api/contract-templates/${id}`),

  // Phase 5
  "cod-settlement": (id) => del(`/api/fulfillment/cod/settlements/${id}`),
  "integration-credential": (id) => del(`/api/integrations/credentials/${id}`),
};

/**
 * Best-effort cleanup: iterates the bag in reverse (children before parents),
 * swallows per-resource failures so one broken delete doesn't block the rest,
 * and clears the bag when done. Call from `test.afterAll` or `test.afterEach`.
 */
export async function cleanupAll() {
  const failures = [];
  while (bag.length) {
    const { type, id } = bag.pop();
    const deleter = DELETERS[type];
    if (!deleter) {
      failures.push({ type, id, reason: "no deleter registered" });
      continue;
    }
    try {
      const res = await deleter(id);
      if (!res.ok && res.status !== 404) {
        failures.push({ type, id, reason: `HTTP ${res.status}` });
      }
    } catch (err) {
      failures.push({ type, id, reason: err.message });
    }
  }
  if (failures.length) {
    console.warn(
      `[smoke] cleanup: ${failures.length} resource(s) could not be deleted — search the packagesmall tenant for the SMOKE- prefix to find them.`,
      failures,
    );
  }
}

export function __clearBag() {
  bag.length = 0;
}
