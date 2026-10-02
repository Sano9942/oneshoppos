import { useEffect, useRef, useCallback } from "react";
import { Zap } from "lucide-react";
import { usePOS } from "./POSContext";
import { classifyOmniInput } from "./omniInputRouter";
import { decodeEmbeddedBarcode } from "../../../utils/embeddedBarcode";
import { useAuth } from "../../../auth/AuthProvider";
import { api } from "../../../api";
import { variantCartLine } from "./variantCartLine";
import { scanProduct, listVariants } from "./offlineLookup";
import { getCatalogueIndex, lookupCode } from "../../../utils/offlineCatalogue";

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

// Somewhere the cashier is typing: leave the cursor there.
function isTypingTarget(el) {
  const tag = el?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(el?.isContentEditable);
}

// A pop-up is showing: the till's own modals are `fixed inset-0` overlays, the
// ui/primitives Modal / Drawer are role="dialog".
function overlayOpen() {
  return Boolean(document.querySelector('[role="dialog"], [aria-modal="true"], .fixed.inset-0'));
}

function shouldReclaimFocus() {
  return !isTypingTarget(document.activeElement) && !overlayOpen();
}

// D62: an item from the till's catalogue copy that can go straight into the
// cart — anything needing a choice or a check first waits for the server.
function instantFromCopy(code) {
  const hit = lookupCode(getCatalogueIndex(), code);
  const p = hit?.product;
  if (!p || hit.variant) return null;
  if (p.has_variants || p.serial_required || p.age_restricted || p.is_gift_card_sku || p.is_bundle) return null;
  return p;
}

export default function POSOmniInput() {
  const {
    handleSearchChange,
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
    confirmCopyLine,
    undoCopyLine,
  } = usePOS();
  const { company } = useAuth();
  const barcodeScheme = company?.barcode_scheme || null;

  const inputRef = useRef(null);

  // D63 (One Toy Store pilot): keep the cursor in this box so the cashier can
  // scan or type without the mouse. Taken back after any click that leaves it
  // on something you can't type in, on the first key typed while it's lost,
  // and by a 1 s backup check; never from another box being typed in, and
  // never while a pop-up (payment, return, discount…) is open.
  useEffect(() => {
    const reclaim = () => {
      if (shouldReclaimFocus()) inputRef.current?.focus();
    };
    inputRef.current?.focus();
    const id = setInterval(reclaim, 1000);
    const onClick = () => setTimeout(reclaim, 0);
    const onKey = (e) => {
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "/") return; // the "/" shortcut below handles its own key
      reclaim();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearInterval(id);
      document.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey, true);
    };
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

  // Put a server-found item in the cart (age check, scale line, variant,
  // serial number, or a plain add).
  const addScanned = useCallback(async (data) => {
    const product = data.product;
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
    const variants = await listVariants(product.id);
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
  }, [addToCart, addDecodedLine, setPendingVariantProductId, setPendingSerialProductId, setPendingSerialContext]);

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
        // D62 (One Toy Store pilot): a plain item found in the till's catalogue
        // copy goes in at once; the server's answer then confirms it (price,
        // stock note) or replaces it. Scale labels and anything needing a
        // choice wait for the server, as before.
        const copyItem = preview.ok ? null : instantFromCopy(parsed.value);
        if (copyItem) {
          addToCart(copyItem);
          scanProduct(parsed.value).then((data) => {
            if (data.offline) return; // no server: the copy line stands, as offline
            if (data.found && data.product?.id === copyItem.id && !data.variant && !data.product.embedded) {
              confirmCopyLine?.(copyItem, data.product);
              return;
            }
            undoCopyLine?.(copyItem);
            if (!data.found) {
              showNotice?.(`${data.error || `No product for ${parsed.value}`}: taken out of the cart`);
              return;
            }
            addScanned(data);
          }).catch(() => { /* keep the copy line */ });
          return;
        }
        // Server first; the counter's offline catalogue copy when the server
        // can't be reached (One Toy Store blocker 3a).
        const data = await scanProduct(parsed.value);
        if (!data.found) {
          // Surface the backend's message (e.g. "Unmapped scale item — no
          // product for sku 12345") instead of a generic miss, so a mis-mapped
          // scale PLU is fixable rather than a silent zero-price line.
          showNotice?.(data.error || `No product for ${parsed.value}`);
          return;
        }
        await addScanned(data);
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
        // D63: run the same search as the F2 box (fills it and opens the
        // list); setting the text alone showed no results.
        handleSearchChange({ target: { value: parsed.value } });
      }
    } catch (err) {
      showNotice?.(err?.message || "Search failed");
    }
  }, [
    addToCart,
    addScanned,
    barcodeScheme,
    handleSearchChange,
    confirmCopyLine,
    undoCopyLine,
    setSelectedCustomerId,
    setCustomerSearch,
    setShowCustomerDD,
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
        data-pos-omni-input
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
