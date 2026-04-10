import { useState, useEffect } from "react";
import { usePOS } from "./POSContext";
import { api } from "../../../api";
import { useToast } from "../../../contexts/ToastContext";

export default function EndlessAisleModal() {
  const {
    endlessAisleProduct: product,
    closeEndlessAisle,
    selectedCustomer,
    selectedOutletId,
  } = usePOS();
  const { success, error: toastError } = useToast();

  const [deliveryMethod, setDeliveryMethod] = useState("ship_to_customer");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill from selected customer
  useEffect(() => {
    if (!product) return;
    if (selectedCustomer) {
      setName(selectedCustomer.name || "");
      setPhone(selectedCustomer.mobile || selectedCustomer.phone || "");
      setEmail(selectedCustomer.email || "");
      setAddress(selectedCustomer.address || "");
      setCity(selectedCustomer.city || "");
    } else {
      setName("");
      setPhone("");
      setEmail("");
      setAddress("");
      setCity("");
    }
    setNote("");
    setDeliveryMethod("ship_to_customer");
  }, [product, selectedCustomer]);

  if (!product) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toastError("Customer name and phone are required");
      return;
    }
    if (deliveryMethod === "ship_to_customer" && !address.trim()) {
      toastError("Shipping address is required for delivery orders");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/orders/endless-aisle", {
        product_id: product.id,
        variant_id: product.variant_id || null,
        source_outlet_id: Number(selectedOutletId),
        delivery_method: deliveryMethod,
        customer_id: selectedCustomer?.id || null,
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        customer_email: email.trim() || null,
        shipping_address: deliveryMethod === "ship_to_customer" ? address.trim() : null,
        shipping_city: deliveryMethod === "ship_to_customer" ? city.trim() : null,
        note: note.trim() || null,
      });
      success("Endless aisle order created successfully");
      closeEndlessAisle();
    } catch (err) {
      toastError(err?.message || "Failed to create order");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Endless Aisle Order
          </h2>
          <button
            onClick={closeEndlessAisle}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Product info */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="w-12 h-12 rounded-lg object-cover shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-gray-200 dark:bg-gray-600 flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
            )}
            <div className="min-w-0">
              <p className="font-medium text-gray-900 dark:text-white truncate">{product.name}</p>
              {product.sku && (
                <p className="text-sm text-gray-500 dark:text-gray-400">SKU: {product.sku}</p>
              )}
              {product.variant_label && (
                <p className="text-sm text-gray-500 dark:text-gray-400">{product.variant_label}</p>
              )}
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                Out of stock at this location
              </p>
            </div>
          </div>

          {/* Delivery method */}
          <fieldset>
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Delivery Method
            </legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="delivery"
                  value="ship_to_customer"
                  checked={deliveryMethod === "ship_to_customer"}
                  onChange={() => setDeliveryMethod("ship_to_customer")}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Ship to Customer</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="delivery"
                  value="pickup_at_store"
                  checked={deliveryMethod === "pickup_at_store"}
                  onChange={() => setDeliveryMethod("pickup_at_store")}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Pick Up at Store</span>
              </label>
            </div>
          </fieldset>

          {/* Customer info */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Customer Info</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Phone *</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Shipping address (only for ship_to_customer) */}
          {deliveryMethod === "ship_to_customer" && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Shipping Address</p>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Address *</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          )}

          {/* Note */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Order Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {submitting ? "Creating Order..." : "Create Order"}
          </button>
        </form>
      </div>
    </div>
  );
}
