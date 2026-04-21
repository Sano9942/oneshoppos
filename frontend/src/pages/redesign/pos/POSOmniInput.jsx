import { useEffect, useRef, useCallback } from "react";
import { Zap } from "lucide-react";
import { usePOS } from "./POSContext";
import { classifyOmniInput } from "./omniInputRouter";
import { api } from "../../../api";

export default function POSOmniInput() {
  const {
    setSearch,
    setResults,
    setShowResults,
    addToCart,
    setSelectedCustomerId,
    setCustomerSearch,
    setShowCustomerDD,
    setPendingVariantProductId,
    setPendingSerialProductId,
    setPendingSerialContext,
    showNotice,
  } = usePOS();

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
        const res = await api.raw(
          `/api/products/scan/${encodeURIComponent(parsed.value)}`,
        );
        if (!res.ok) {
          showNotice?.(`No product for ${parsed.value}`);
          return;
        }
        const data = await res.json();
        const product = data?.product;
        if (!product) {
          showNotice?.(`No product for ${parsed.value}`);
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
    setSearch,
    setShowResults,
    setSelectedCustomerId,
    setCustomerSearch,
    setShowCustomerDD,
    setPendingVariantProductId,
    setPendingSerialProductId,
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
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8066FF] pointer-events-none"
      />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        spellCheck={false}
        onKeyDown={onKeyDown}
        placeholder="Scan, search, or # to attach customer — press / to focus"
        className="block w-full pl-9 pr-3 py-2.5 border border-[#8066FF]/30 rounded-xl bg-white font-medium text-sm placeholder-slate-400 focus:outline-none focus:border-[#8066FF] focus:ring-2 focus:ring-[#8066FF]/20 transition shadow-sm"
      />
    </div>
  );
}
