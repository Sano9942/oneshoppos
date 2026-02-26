function toGid(type, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/${type}/${raw}`;
}

async function shopifyGraphqlRequest(connection, query, variables = {}, _retries = 3) {
  const shopDomain = String(connection?.shop_domain || "").trim();
  const accessToken = String(connection?.access_token || "").trim();
  const apiVersion = String(connection?.api_version || "2025-10").trim();
  if (!shopDomain || !accessToken) {
    throw new Error("Shopify connection is incomplete");
  }

  const endpoint = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      json?.errors?.[0]?.message || `Shopify request failed (${res.status})`,
    );
  }

  // Handle throttled responses (HTTP 200 but rate-limited)
  const throttleStatus = json?.extensions?.cost?.throttleStatus;
  if (throttleStatus === "THROTTLED") {
    if (_retries <= 0) throw new Error("Shopify API throttled: too many retries");
    const retryAfterMs = (json?.extensions?.cost?.requestedQueryCost || 500) > 500 ? 2000 : 1000;
    await new Promise((r) => setTimeout(r, retryAfterMs));
    return shopifyGraphqlRequest(connection, query, variables, _retries - 1);
  }

  if (json?.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

async function verifyConnection(connection) {
  const query = `
    query {
      shop {
        id
        name
        myshopifyDomain
      }
    }
  `;
  const data = await shopifyGraphqlRequest(connection, query, {});
  return data?.shop || null;
}

async function fetchShopifyLocations(connection) {
  const query = `
    query FetchLocations($first: Int!) {
      locations(first: $first) {
        edges {
          node {
            id
            name
            isActive
          }
        }
      }
    }
  `;
  const data = await shopifyGraphqlRequest(connection, query, { first: 100 });
  const edges = data?.locations?.edges || [];
  return edges.map((e) => ({
    id: e?.node?.id || "",
    name: e?.node?.name || "",
    is_active: Boolean(e?.node?.isActive),
  }));
}

async function adjustShopifyInventory(
  connection,
  adjustments,
  reason = "correction",
) {
  const changes = (adjustments || [])
    .map((item) => ({
      delta: Number(item.delta || 0),
      inventoryItemId: toGid("InventoryItem", item.inventory_item_id),
      locationId: toGid("Location", item.location_id),
    }))
    .filter((c) => c.delta !== 0 && c.inventoryItemId && c.locationId);

  if (changes.length === 0) {
    return { applied: 0, userErrors: [] };
  }

  const mutation = `
    mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors {
          field
          message
        }
        inventoryAdjustmentGroup {
          reason
          changes {
            name
            delta
          }
        }
      }
    }
  `;

  const variables = {
    input: {
      name: "available",
      reason,
      changes,
    },
  };

  const data = await shopifyGraphqlRequest(connection, mutation, variables);
  const result = data?.inventoryAdjustQuantities || {};
  const userErrors = result?.userErrors || [];
  return {
    applied: changes.length,
    userErrors,
    raw: result,
  };
}

async function fetchShopifyVariantCatalog(connection, maxItems = 500) {
  const query = `
    query FetchVariants($first: Int!, $after: String) {
      productVariants(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            sku
            barcode
            displayName
            product {
              id
              title
            }
            inventoryItem {
              id
              sku
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const out = [];
  let after = null;
  const pageSize = 100;

  while (out.length < maxItems) {
    const data = await shopifyGraphqlRequest(connection, query, {
      first: pageSize,
      after,
    });
    const root = data?.productVariants;
    const edges = root?.edges || [];
    for (const edge of edges) {
      const node = edge?.node || {};
      out.push({
        variant_id: node.id || "",
        sku: node.sku || node.inventoryItem?.sku || "",
        barcode: node.barcode || "",
        display_name: node.displayName || "",
        product_id: node.product?.id || "",
        product_title: node.product?.title || "",
        inventory_item_id: node.inventoryItem?.id || "",
      });
      if (out.length >= maxItems) break;
    }
    const hasNext = Boolean(root?.pageInfo?.hasNextPage);
    after = root?.pageInfo?.endCursor || null;
    if (!hasNext || !after) break;
  }

  return out;
}

async function fetchInventoryLevel(connection, inventoryItemId, locationId) {
  const query = `
    query InventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
      inventoryItem(id: $inventoryItemId) {
        id
        inventoryLevel(locationId: $locationId) {
          id
          quantities(names: ["available"]) {
            name
            quantity
          }
        }
      }
    }
  `;
  const variables = {
    inventoryItemId: toGid("InventoryItem", inventoryItemId),
    locationId: toGid("Location", locationId),
  };
  const data = await shopifyGraphqlRequest(connection, query, variables);
  const qtyRow = data?.inventoryItem?.inventoryLevel?.quantities?.find(
    (q) => q.name === "available",
  );
  const qty = Number(qtyRow?.quantity || 0);
  return {
    inventory_item_id: variables.inventoryItemId,
    location_id: variables.locationId,
    available: Number.isFinite(qty) ? qty : 0,
  };
}

async function fetchRecentOrders(connection, first = 10) {
  const query = `
    query FetchOrders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            currencyCode
            subtotalPriceSet { shopMoney { amount } }
            totalDiscountsSet { shopMoney { amount } }
            totalTaxSet { shopMoney { amount } }
            totalShippingPriceSet { shopMoney { amount } }
            totalPriceSet { shopMoney { amount } }
            financialStatus
            displayFulfillmentStatus
            createdAt
            lineItems(first: 50) {
              edges {
                node {
                  id
                  sku
                  title
                  quantity
                  variant { barcode }
                  discountedUnitPriceSet { shopMoney { amount } }
                  totalDiscountSet { shopMoney { amount } }
                  taxLines { priceSet { shopMoney { amount } } }
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphqlRequest(connection, query, { first });
  const edges = data?.orders?.edges || [];

  return edges.map((edge) => {
    const node = edge.node;
    const lineItems = (node.lineItems?.edges || []).map((le) => {
      const lnode = le.node;
      const totalTax = (lnode.taxLines || []).reduce(
        (acc, t) => acc + parseFloat(t.priceSet?.shopMoney?.amount || 0),
        0,
      );
      return {
        id: lnode.id,
        sku: lnode.sku,
        barcode: lnode.variant?.barcode || null,
        title: lnode.title,
        quantity: lnode.quantity,
        price: lnode.discountedUnitPriceSet?.shopMoney?.amount,
        total_discount: lnode.totalDiscountSet?.shopMoney?.amount,
        total_tax: totalTax,
      };
    });

    return {
      id: node.id,
      name: node.name,
      currency: node.currencyCode,
      subtotal_price: node.subtotalPriceSet?.shopMoney?.amount,
      total_discounts: node.totalDiscountsSet?.shopMoney?.amount,
      total_tax: node.totalTaxSet?.shopMoney?.amount,
      total_shipping_price_set: node.totalShippingPriceSet,
      total_price: node.totalPriceSet?.shopMoney?.amount,
      financial_status: node.financialStatus?.toLowerCase(),
      fulfillment_status: node.displayFulfillmentStatus?.toLowerCase(),
      created_at: node.createdAt,
      line_items: lineItems,
    };
  });
}

// Fetch full product catalog from Shopify with inventory levels per location.
// Returns an array of product objects ready for import into POS.
async function fetchShopifyProductsFull(connection, maxItems = 10000) {
  const query = `
    query FetchProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            title
            descriptionHtml
            productType
            vendor
            tags
            status
            variants(first: 15) {
              edges {
                node {
                  id
                  sku
                  barcode
                  price
                  compareAtPrice
                  inventoryItem {
                    id
                    inventoryLevels(first: 3) {
                      edges {
                        node {
                          location { id }
                          quantities(names: ["available"]) {
                            name
                            quantity
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const out = [];
  let after = null;
  const pageSize = 10;
  // Small delay between pages to avoid hitting Shopify's leaky-bucket rate limit
  const pageDelayMs = 500;

  while (out.length < maxItems) {
    const data = await shopifyGraphqlRequest(connection, query, { first: pageSize, after });
    if (!data) break; // Throttled after retries or unexpected null — stop safely
    const root = data?.products;
    const edges = root?.edges || [];

    for (const edge of edges) {
      const p = edge?.node || {};
      const variants = (p.variants?.edges || []).map((ve) => {
        const v = ve?.node || {};
        const invLevels = (v.inventoryItem?.inventoryLevels?.edges || []).map((le) => {
          const l = le?.node || {};
          const qty = (l.quantities || []).find((q) => q.name === "available");
          return {
            shopify_location_id: l.location?.id || "",
            available: Number(qty?.quantity || 0),
          };
        });
        return {
          shopify_variant_id: v.id || "",
          shopify_inventory_item_id: v.inventoryItem?.id || "",
          sku: v.sku || "",
          barcode: v.barcode || "",
          price: parseFloat(v.price || 0),
          compare_at_price: parseFloat(v.compareAtPrice || 0),
          inventory_levels: invLevels,
        };
      });

      out.push({
        shopify_product_id: p.id || "",
        title: p.title || "",
        description_html: p.descriptionHtml || "",
        product_type: p.productType || "",
        vendor: p.vendor || "",
        tags: Array.isArray(p.tags) ? p.tags.join(",") : (p.tags || ""),
        status: (p.status || "ACTIVE").toLowerCase(),
        variants,
      });

      if (out.length >= maxItems) break;
    }

    const hasNext = Boolean(root?.pageInfo?.hasNextPage);
    after = root?.pageInfo?.endCursor || null;
    if (!hasNext || !after) break;

    // Pace requests to stay within Shopify's rate limit bucket
    await new Promise((r) => setTimeout(r, pageDelayMs));
  }

  return out;
}

module.exports = {
  verifyConnection,
  fetchShopifyLocations,
  adjustShopifyInventory,
  fetchShopifyVariantCatalog,
  fetchShopifyProductsFull,
  fetchRecentOrders,
};
