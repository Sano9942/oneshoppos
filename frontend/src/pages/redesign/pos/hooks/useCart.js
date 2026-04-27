import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api } from "../../../../api";
import { calcGrossTotal, calcDiscountValue, calcTaxTotal, calcTotal } from "../cartMath.js";

export function useCart({ selectedOutletId, selectedCustomerId, customers, posFlags, showNotice, posDeviceId }) {
  // ── Product search ────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [barcodeSearch, setBarcodeSearch] = useState("");
  const [skuSearch, setSkuSearch] = useState("");
  const [priceSearch, setPriceSearch] = useState("");
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef(null);
  const searchTimer = useRef(null);

  // ── Cart ──────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState([]);
  const [taxInclusive, setTaxInclusive] = useState(false);

  // ── Order-level discount / note ───────────────────────────────────────────
  const [discountType, setDiscountType] = useState("percent");
  const [discountInput, setDiscountInput] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);

  // ── Price list (customer-specific pricing + outlet assignments) ────────────
  const [priceListItems, setPriceListItems] = useState([]);
  const [outletPriceListItems, setOutletPriceListItems] = useState([]);

  // ── POS Layout + Item Suggestions (Phase 2B) ─────────────────────────
  const [posLayout, setPosLayout] = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  // ── Auto-apply promotions (Phase 2) ─────────────────────────────────
  const [appliedPromotions, setAppliedPromotions] = useState([]);
  const [promoDiscount, setPromoDiscount] = useState(0);

  // ── Price list fetch on customer change ──────────────────────────────────
  useEffect(() => {
    const cust = customers.find((c) => String(c.id) === String(selectedCustomerId));
    if (!cust?.price_list_id) { setPriceListItems([]); return; }
    api.get(`/api/price-lists/${cust.price_list_id}/items`)
      .then((d) => setPriceListItems(d.items || []))
      .catch(() => setPriceListItems([]));
  }, [selectedCustomerId, customers]);

  // ── Outlet price list fetch (phase2_outlet_pricing) ───────────────────────
  // Skip the backend round-trip when the flag is off — requireFeature() returns
  // 503 in that case, and we don't want to pollute Network tab / Sentry with
  // phantom errors. Effect re-fires once posFlags loads (initial value is {}).
  useEffect(() => {
    if (!selectedOutletId || !posFlags.phase2_outlet_pricing) {
      setOutletPriceListItems([]);
      return;
    }
    api.get(`/api/price-list-assignments?scope_type=outlet&scope_id=${selectedOutletId}`)
      .then(async (d) => {
        const assignments = d.assignments || [];
        if (!assignments.length) { setOutletPriceListItems([]); return; }
        const topPl = assignments.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
        const items = await api.get(`/api/price-lists/${topPl.price_list_id}/items`);
        setOutletPriceListItems(items.items || []);
      })
      .catch(() => setOutletPriceListItems([]));
  }, [selectedOutletId, posFlags.phase2_outlet_pricing]);

  // ── POS Layout fetch (phase2_pos_layouts) — 2-G.13 includes device_id so
  // the backend cascade prefers device > employee > role > outlet > global.
  // Skipped when phase2_pos_layouts is off (default for new tenants).
  useEffect(() => {
    if (!posFlags.phase2_pos_layouts) {
      setPosLayout(null);
      return;
    }
    const params = new URLSearchParams();
    if (selectedOutletId) params.set("outlet_id", selectedOutletId);
    if (posDeviceId) params.set("device_id", posDeviceId);
    api.get(`/api/pos-layouts?${params}`).then(d => setPosLayout(d.layout)).catch(() => {});
  }, [selectedOutletId, posDeviceId, posFlags.phase2_pos_layouts]);

  // ── Item suggestions fetch (phase2_item_suggestions, debounced) ───────
  // Skipped when the flag is off — same rationale as above.
  useEffect(() => {
    if (!cart.length || !posFlags.phase2_item_suggestions) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      const ids = cart.map(c => c.id).filter(Boolean).join(",");
      if (!ids) return;
      api.get(`/api/pos/suggestions?product_ids=${ids}`).then(d => setSuggestions(d.suggestions || [])).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [cart.map(c => c.id).join(","), posFlags.phase2_item_suggestions]);

  // ── Auto-apply promotions (debounced on cart change) ──────────────────
  useEffect(() => {
    if (!cart.length) { setAppliedPromotions([]); setPromoDiscount(0); return; }
    const timer = setTimeout(() => {
      const items = cart.map(c => ({
        product_id: c.id,
        category_id: c.category_id || null,
        quantity: c.quantity,
        price: Number(c.price || 0),
      }));
      const order_total = items.reduce((s, i) => s + i.price * i.quantity, 0);
      api.post("/api/promotions/quote", { items, order_total })
        .then(d => {
          setAppliedPromotions(d.applied_promotions || []);
          setPromoDiscount(Number(d.total_promotion_discount || 0));
        })
        .catch(() => { setAppliedPromotions([]); setPromoDiscount(0); });
    }, 400);
    return () => clearTimeout(timer);
  }, [cart.map(c => `${c.id}:${c.quantity}:${c.price}`).join(",")]);

  const resolvePriceListPrice = useCallback((productId, variantId, qty) => {
    const sources = priceListItems.length ? priceListItems : outletPriceListItems;
    if (!sources.length) return null;
    const matches = sources
      .filter((i) => i.product_id === productId &&
        (String(i.variant_id || "") === String(variantId || "")) &&
        i.min_qty <= qty)
      .sort((a, b) => b.min_qty - a.min_qty);
    return matches[0] || null;
  }, [priceListItems, outletPriceListItems]);

  // Re-resolve all cart prices when price list changes (customer selected/deselected)
  useEffect(() => {
    setCart((prev) => {
      if (!prev.length) return prev;
      return prev.map((item) => {
        const base = item.originalPrice ?? item.price;
        const plMatch = priceListItems
          .filter((i) => i.product_id === item.id &&
            (String(i.variant_id || "") === String(item.variant_id || "")) &&
            i.min_qty <= item.quantity)
          .sort((a, b) => b.min_qty - a.min_qty)[0];
        const resolvedPrice = plMatch ? Number(plMatch.price) : base;
        return { ...item, originalPrice: base, price: resolvedPrice };
      });
    });
  }, [priceListItems]);

  const triggerSearch = useCallback((query, field = "all") => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const params = { query };
        if (selectedOutletId) params.outlet_id = selectedOutletId;
        if (field !== "all") params.field = field;
        const data = await api.get("/api/products/search", params);
        setResults(data.products || []);
        setShowResults(true);
      } catch {
        setResults([]);
      }
    }, 250);
  }, [selectedOutletId]);

  const handleSearchChange = useCallback((e, field = "all") => {
    const v = e.target.value;
    if (field === "all") {
      setSearch(v);
      setBarcodeSearch("");
      setSkuSearch("");
      setPriceSearch("");
    }
    if (field === "barcode") {
      setBarcodeSearch(v);
      setSearch("");
      setSkuSearch("");
      setPriceSearch("");
    }
    if (field === "sku") {
      setSkuSearch(v);
      setSearch("");
      setBarcodeSearch("");
      setPriceSearch("");
    }
    if (field === "price") {
      setPriceSearch(v);
      setSearch("");
      setBarcodeSearch("");
      setSkuSearch("");
    }
    triggerSearch(v, field);
  }, [triggerSearch]);

  const addToCart = useCallback((product, overlay = {}) => {
    const stock = Number(product.local_stock ?? product.stock ?? 0);
    const isBundle = Boolean(product.is_bundle);
    // Phase 2-R.0: optional restaurant overlay stamps each line with the
    // active seat + course. When no overlay is passed (retail flow) we
    // default to seat_number=null / course_name="main" — the same defaults
    // the schema applies on draft_order_items / sale_items.
    const seatStamp = overlay.seat_number ?? null;
    const courseStamp = overlay.course_name ?? "main";
    // 2-G.12: bulk-scan toggle — when set to "new_line", each add creates a
    // fresh line even if the same product already exists in the cart.
    let bulkScanMode = "increment";
    try {
      const deviceId = localStorage.getItem("pos_device_id") || "default";
      bulkScanMode = localStorage.getItem(`pos_bulk_scan_mode_${deviceId}`) || "increment";
    } catch { /* localStorage unavailable — keep default */ }
    const forceNewLine = bulkScanMode === "new_line";
    setCart((prev) => {
      const found = forceNewLine ? null : prev.find((x) => x.id === product.id);
      if (found) {
        if (!isBundle && stock > 0 && found.quantity >= stock)
          showNotice?.(`Note: Selling past available stock (${stock} in stock).`);
        const nextQty = found.quantity + 1;
        return prev.map((x) => {
          if (x.id !== product.id) return x;
          const plMatch = resolvePriceListPrice(x.id, x.variant_id, nextQty);
          const resolvedPrice = plMatch ? Number(plMatch.price) : x.originalPrice;
          return { ...x, quantity: nextQty, price: resolvedPrice };
        });
      }
      if (!isBundle && stock <= 0)
        showNotice?.("Note: Item is out of stock — selling on override.");
      const basePrice = Number(product.price);
      const plMatch = resolvePriceListPrice(product.id, product.variant_id, 1);
      const resolvedPrice = plMatch ? Number(plMatch.price) : basePrice;
      return [{ ...product, quantity: 1, availableStock: isBundle ? 99999 : stock, originalPrice: basePrice, price: resolvedPrice, seat_number: seatStamp, course_name: courseStamp }, ...prev];
    });
    setSearch("");
    setBarcodeSearch("");
    setSkuSearch("");
    setPriceSearch("");
    setResults([]);
    setShowResults(false);
    searchRef.current?.focus();
  }, [resolvePriceListPrice, showNotice]);

  const updateQty = useCallback((id, delta) => {
    setCart((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        const next = x.quantity + delta;
        if (next < 1) return x;
        if (delta > 0 && x.availableStock > 0 && next > x.availableStock)
          showNotice?.(
            `Note: Selling past available stock (${x.availableStock} in stock).`,
          );
        const plMatch = resolvePriceListPrice(x.id, x.variant_id, next);
        const resolvedPrice = plMatch ? Number(plMatch.price) : (x.originalPrice ?? x.price);
        return { ...x, quantity: next, price: resolvedPrice };
      }),
    );
  }, [resolvePriceListPrice, showNotice]);

  const setQty = useCallback((id, value, opts = {}) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return;
    setCart((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        if (x.availableStock > 0 && num > x.availableStock) {
          showNotice?.(`Note: Selling past available stock (${x.availableStock} in stock).`);
        }
        const plMatch = resolvePriceListPrice(x.id, x.variant_id, num);
        const resolvedPrice = plMatch ? Number(plMatch.price) : (x.originalPrice ?? x.price);
        const next = { ...x, quantity: num, price: resolvedPrice };
        if (opts.gross_weight != null) next.gross_weight = Number(opts.gross_weight);
        if (opts.tare_weight != null) next.tare_weight = Number(opts.tare_weight);
        return next;
      }),
    );
  }, [resolvePriceListPrice, showNotice]);

  const removeFromCart = useCallback((id) =>
    setCart((prev) => prev.filter((x) => x.id !== id)), []);

  const grossTotal = useMemo(() => calcGrossTotal(cart), [cart]);
  const discountValue = useMemo(
    () => calcDiscountValue(grossTotal, discountType, discountInput),
    [discountInput, discountType, grossTotal],
  );
  const taxTotal = useMemo(() => calcTaxTotal(cart, taxInclusive), [cart, taxInclusive]);
  const total = calcTotal(grossTotal, discountValue + promoDiscount, taxTotal, taxInclusive);

  return {
    // Search
    search, setSearch,
    barcodeSearch, setBarcodeSearch,
    skuSearch, setSkuSearch,
    priceSearch, setPriceSearch,
    results, setResults,
    showResults, setShowResults,
    searchRef,
    triggerSearch,
    handleSearchChange,
    // Cart
    cart, setCart,
    taxInclusive, setTaxInclusive,
    // Discount
    discountType, setDiscountType,
    discountInput, setDiscountInput,
    orderNote, setOrderNote,
    showDiscountModal, setShowDiscountModal,
    showNoteModal, setShowNoteModal,
    // Cart operations
    addToCart, updateQty, setQty, removeFromCart,
    // Computed
    grossTotal, discountValue, taxTotal, total,
    // Price lists
    priceListItems,
    // POS layout + suggestions (Phase 2B)
    posLayout,
    suggestions,
    // Auto-apply promotions (Phase 2)
    appliedPromotions,
    promoDiscount,
  };
}
