import { useEffect, useRef, useCallback } from "react";
import { Zap } from "lucide-react";
import { usePOS } from "./POSContext";
import { classifyOmniInput } from "./omniInputRouter";
import { decodeEmbeddedBarcode } from "../../../utils/embeddedBarcode";
import { useAuth } from "../../../auth/AuthProvider";
import { api } from "../../../api";
import { variantCartLine } from "./variantCartLine";

// V01 P2 — age-restricted attest prompt. Cashier confirms the customer meets
// the minimum age before an age_restricted product is rung up. Lightweight
// (native confirm); returns true when the cashier attests / when confirm is
// unavailable (never blocks a sale in a non-interactive environment).
function confirmAgeRestricted(product) {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return window.confirm(
    `"${product.name || "This item"}" is age-restricted.\nConfirm the customer meets the minimum age requirement?`,
  );
}

export default function POSOmniInput() {
  const {
    setSearch,
    setResults,
    setShowResults,
    addToCart,
    addDecodedLine,
    setSelectedCustomerId,
    setCustomerSearch,
    setShowCustomerDD,
    setPendingVariantProductId,
    setPendingSerialProductId,
    setPendingSerialContext,
    showNotice,
  } = usePOS();
  const { company } = useAuth();
  const barcodeScheme = company?.barcode_scheme || null;

  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const id = setInterval(() => {
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      if (tag !== "input" && tag !== "textarea" && tag !== "select") {
        inputRef.current?.focus();
      }
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/") return;
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dispatch = useCallback(async (rawValue) => {
    const parsed = classifyOmniInput(rawValue);
    if (parsed.kind === "noop") return;

    try {
      if (parsed.kind === "barcode" || parsed.kind === "plu") {
        // V01 grocery — instant on-screen feedback the moment a scale label is
        // scanned (the backend scan endpoint remains the authoritative decoder).
        const preview = decodeEmbeddedBarcode(parsed.value, barcodeScheme);
        if (preview.ok) {
          showNotice?.(
            preview.embed === "price"
              ? `Scale item — Rs ${Number(preview.price).toFixed(2)}`
              : `Scale item — ${preview.weight} kg`,
          );
        }
        const res = await api.raw(
          `/api/products/scan/${encodeURIComponent(parsed.value)}`,
        );
        if (!res.ok) {
          // Surface the backend's message (e.g. "Unmapped scale item — no
          // product for sku 12345") instead of a generic miss, so a mis-mapped
          // scale PLU is fixable rather than a silent zero-price line.
          let msg = `No product for ${parsed.value}`;
          try {
            const body = await res.json();
            if (body?.error) msg = body.error;
          } catch {
            /* non-JSON body */
          }
          showNotice?.(msg);
          return;
        }
        const data = await res.json();
        const product = data?.product;
        if (!product) {
          showNotice?.(`No product for ${parsed.value}`);
          return;
        }
        // V01 P2 — age-restricted attest gate (tobacco/alcohol). Cashier must
        // confirm before the item is added.
        if (product.age_restricted && !confirmAgeRestricted(product)) {
          return;
        }
        // V01 — a decoded scale line (price/weight-embedded) goes to the
        // dedicated builder: FINAL price + price_locked, or decoded weight at
        // shelf unit-price; both lock tare.
        if (product.embedded) {
          addDecodedLine(product, product.embedded);
          return;
        }
        // The code was one variant's own barcode — add exactly that variant.
        if (data.variant) {
          addToCart(variantCartLine(product, data.variant, data.variant.sku));
          return;
        }
        let variants = [];
        try {
          const v = await api.get(`/api/products/${product.id}/variants`);
          variants = Array.isArray(v?.variants) ? v.variants : [];
        } catch {
          variants = [];
        }
        if (variants.length > 0) {
          setPendingVariantProductId(product.id);
          return;
        }
        if (product.serial_required) {
          // 2-G.6: seed the pending-serial context so the modal knows the
          // product, variant (none when scanned directly), and quantity (1
          // per scan — duplicate scans re-open the modal).
          setPendingSerialContext({
            product_id: product.id,
            variant_id: null,
            quantity: 1,
          });
          setPendingSerialProductId(product.id);
          return;
        }
        addToCart(product);
      } else if (parsed.kind === "customer") {
        let customers = [];
        try {
          const data = await api.get(
            `/api/customers?search=${encodeURIComponent(parsed.value)}`,
          );
          customers = Array.isArray(data?.customers) ? data.customers : [];
        } catch {
          customers = [];
        }
        if (customers.length === 1) {
          setSelectedCustomerId(String(customers[0].id));
          showNotice?.(`Customer: ${customers[0].name}`);
        } else {
          setCustomerSearch(parsed.value);
          setShowCustomerDD(true);
          const el = document.querySelector("[data-pos-customer-search]");
          if (el) el.focus();
        }
      } else if (parsed.kind === "text") {
        setSearch(parsed.value);
        setShowResults(true);
      }
    } catch (err) {
      showNotice?.(err?.message || "Search failed");
    }
  }, [
    addToCart,
    addDecodedLine,
    barcodeScheme,
    setSearch,
    setShowResults,
    setSelectedCustomerId,
    setCustomerSearch,
    setShowCustomerDD,
    setPendingVariantProductId,
    setPendingSerialProductId,
    setPendingSerialContext,
    showNotice,
  ]);

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const value = e.currentTarget.value;
      dispatch(value);
      e.currentTarget.value = "";
    } else if (e.key === "Escape") {
      e.currentTarget.value = "";
      setSearch("");
      setResults([]);
      setShowResults(false);
    }
  };

  return (
    <div className="relative mb-2">
      <Zap
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text) pointer-events-none"
      />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        spellCheck={false}
        onKeyDown={onKeyDown}
        placeholder="Scan, search, or # to attach customer — press / to focus"
        className="block w-full pl-9 pr-3 py-2.5 border border-(--ui-border-strong) rounded-xl bg-(--ui-surface) font-medium text-sm placeholder-(--ui-text-muted) focus:outline-none focus:border-(--ui-focus) focus:ring-2 focus:ring-(--ui-focus) transition"
      />
    </div>
  );
}
