import { useState, useEffect, useRef } from "react";
import {
  Search,
  Plus,
  Trash2,
  Printer,
  ShoppingCart,
  X,
  CreditCard,
  Banknote,
  CheckCircle2,
  Lock,
  User,
  LogOut,
  Store,
  Wallet,
  Clock,
} from "lucide-react";

export default function POS() {
  const [cart, setCart] = useState([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [error, setError] = useState("");

  // Advanced Payments State
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [payments, setPayments] = useState([]);
  const [paymentAmountInput, setPaymentAmountInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  // Discount State
  const [discountInput, setDiscountInput] = useState("");
  const [discountType, setDiscountType] = useState("fixed"); // "fixed" | "percent"

  // Employee Login State
  const [currentEmployee, setCurrentEmployee] = useState(null);
  const [attendanceId, setAttendanceId] = useState(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  // Outlet State (Multi-Outlet Support)
  const [outlets, setOutlets] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState(null);
  const [activeShift, setActiveShift] = useState(null);

  // Customer state
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  const inputRef = useRef(null);
  const amountInputRef = useRef(null);

  // Fetch outlets on mount and default to the first one
  useEffect(() => {
    fetch("http://localhost:5000/api/outlets")
      .then((r) => r.json())
      .then((data) => {
        const list = data.outlets || [];
        setOutlets(list);
        if (list.length > 0) setSelectedOutletId(list[0].id);
      })
      .catch((err) => console.error("Failed to load outlets", err));
  }, []);

  // Fetch customers for checkout
  useEffect(() => {
    fetch("http://localhost:5000/api/customers")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers || []))
      .catch(() => {});
  }, []);

  // Check for active cash shift whenever outlet changes
  useEffect(() => {
    if (!selectedOutletId) return;
    fetch(
      `http://localhost:5000/api/shifts/active?outlet_id=${selectedOutletId}`,
    )
      .then((r) => r.json())
      .then((d) => setActiveShift(d.shift || null))
      .catch(() => setActiveShift(null));
  }, [selectedOutletId]);

  // Keep focus on the input field automatically (unless modal is open)
  useEffect(() => {
    const focusInput = () => {
      if (
        currentEmployee &&
        !isCheckoutModalOpen &&
        inputRef.current &&
        document.activeElement !== inputRef.current
      ) {
        inputRef.current.focus();
      }
    };
    const interval = setInterval(focusInput, 500);
    return () => clearInterval(interval);
  }, [isCheckoutModalOpen, currentEmployee]);

  const grossTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Calculate specific totals including Tax
  const taxTotal = cart.reduce((sum, item) => {
    const itemTotal = item.price * item.quantity;
    const taxObj = item.effectiveTaxRate || 0; // The API returns this now
    // Reverse calculate the tax portion from the tax-inclusive price
    const taxAmount = itemTotal - itemTotal / (1 + taxObj / 100);
    return sum + taxAmount;
  }, 0);
  const subtotal = grossTotal - taxTotal;

  const discountValue =
    discountType === "percent"
      ? (grossTotal * parseFloat(discountInput || 0)) / 100
      : parseFloat(discountInput || 0);
  const total = Math.max(0, grossTotal - discountValue);

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = Math.max(0, total - totalPaid);
  const changeDue = Math.max(0, totalPaid - total);

  // Automatically set the payment input to the remaining balance when modal opens or balance changes
  useEffect(() => {
    if (isCheckoutModalOpen && remainingBalance > 0) {
      setPaymentAmountInput(remainingBalance.toFixed(2));
      setTimeout(() => amountInputRef.current?.focus(), 100);
    }
  }, [isCheckoutModalOpen, remainingBalance]);

  const handleScan = async (e) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    setError("");

    try {
      // Pass outlet_id so backend returns local_stock for this specific outlet
      const outletParam = selectedOutletId
        ? `?outlet_id=${selectedOutletId}`
        : "";
      const res = await fetch(
        `http://localhost:5000/api/products/scan/${barcodeInput}${outletParam}`,
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Product not found");
        setBarcodeInput("");
        return;
      }

      const product = data.product;
      // Use local_stock (outlet-specific) falling back to legacy stock
      const availableStock = product.local_stock ?? product.stock ?? 0;

      setCart((prevCart) => {
        const existingItem = prevCart.find((item) => item.id === product.id);
        if (existingItem) {
          if (existingItem.quantity >= availableStock) {
            setError(
              `Cannot add more. Only ${availableStock} in stock at this outlet.`,
            );
            return prevCart;
          }
          return prevCart.map((item) =>
            item.id === product.id
              ? { ...item, quantity: item.quantity + 1 }
              : item,
          );
        } else {
          if (availableStock <= 0) {
            setError(`Out of stock at this outlet!`);
            return prevCart;
          }
          return [{ ...product, quantity: 1, availableStock }, ...prevCart];
        }
      });

      setBarcodeInput("");
    } catch (err) {
      console.error(err);
      setError("Connection to server failed.");
    }
  };

  const removeFromCart = (id) => {
    setCart(cart.filter((item) => item.id !== id));
  };

  const handleAddPayment = (e) => {
    e.preventDefault();
    const amount = parseFloat(paymentAmountInput);
    if (isNaN(amount) || amount <= 0) return;

    setPayments([...payments, { method: paymentMethod, amount }]);
    setPaymentAmountInput("");
  };

  const handleRemovePayment = (index) => {
    setPayments(payments.filter((_, i) => i !== index));
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0 || remainingBalance > 0) return;
    if (!selectedOutletId) {
      setError("No outlet selected. Cannot complete sale.");
      setIsCheckoutModalOpen(false);
      return;
    }

    try {
      const res = await fetch("http://localhost:5000/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payments: payments,
          cartItems: cart,
          outlet_id: selectedOutletId,
          employee_id: currentEmployee?.id || null,
          customer_id: selectedCustomerId ? parseInt(selectedCustomerId) : null,
          discount_amount: parseFloat(discountInput || 0),
          discount_type: discountType,
        }),
      });

      if (res.ok) {
        const data = await res.json();

        const printWindow = window.open("", "_blank", "width=400,height=600");

        let receiptHTML = `
          <html>
            <head>
              <title>Receipt #${data.saleId}</title>
              <style>
                body { font-family: monospace; font-size: 14px; width: 300px; margin: 0 auto; color: black; }
                .center { text-align: center; }
                .right { text-align: right; }
                .bold { font-weight: bold; }
                .divider { border-bottom: 1px dashed black; margin: 10px 0; }
                table { width: 100%; border-collapse: collapse; }
                td { padding: 4px 0; }
                @media print { body { width: 100%; } }
              </style>
            </head>
            <body>
              <div class="center">
                <h2 style="margin:0;">OneShopPOS</h2>
                <p style="margin: 5px 0;">Thank you for your purchase!</p>
                <p style="margin: 5px 0;">Receipt #${data.saleId}</p>
              </div>
              <div class="divider"></div>
              <table>
        `;

        cart.forEach((item) => {
          receiptHTML += `
            <tr>
              <td>${item.quantity}x ${item.name}</td>
              <td class="right">$${(item.price * item.quantity).toFixed(2)}</td>
            </tr>
          `;
        });

        receiptHTML += `
              </table>
              <div class="divider"></div>
              <table>
                <tr>
                   <td>Subtotal</td>
                   <td class="right">$${subtotal.toFixed(2)}</td>
                </tr>
                <tr>
                   <td>Tax</td>
                   <td class="right">$${taxTotal.toFixed(2)}</td>
                </tr>
                <tr class="bold text-lg">
                  <td>TOTAL</td>
                  <td class="right">$${total.toFixed(2)}</td>
                </tr>
        `;

        // Print all payment tenders
        payments.forEach((p) => {
          receiptHTML += `
                <tr>
                  <td>Tendered ${p.method}</td>
                  <td class="right">$${p.amount.toFixed(2)}</td>
                </tr>
            `;
        });

        receiptHTML += `
                <tr class="bold">
                  <td>CHANGE DUE</td>
                  <td class="right">$${changeDue.toFixed(2)}</td>
                </tr>
              </table>
              <div class="divider"></div>
              <p class="center" style="font-size:12px">Powered by OneShopPOS System<br/>(Custom Build)</p>
            </body>
          </html>
        `;

        printWindow.document.write(receiptHTML);
        printWindow.document.close();

        printWindow.onload = () => {
          printWindow.print();
        };

        // Reset
        setCart([]);
        setPayments([]);
        setSelectedCustomerId("");
        setCustomerSearch("");
        setDiscountInput("");
        setDiscountType("fixed");
        setIsCheckoutModalOpen(false);
      } else {
        const data = await res.json();
        setError(data.error || "Checkout failed");
        setIsCheckoutModalOpen(false);
      }
    } catch {
      setError("Checkout failed. Is the server running?");
      setIsCheckoutModalOpen(false);
    }
  };

  const handlePinLogin = async (e) => {
    e.preventDefault();
    if (!pinInput) return;

    try {
      const res = await fetch(
        "http://localhost:5000/api/employees/validate-pin",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ pin_code: pinInput }),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        setPinError(data.error || "Invalid PIN");
        setPinInput("");
        return;
      }

      setCurrentEmployee(data.employee);
      setPinError("");
      setPinInput("");

      // Auto clock-in
      if (selectedOutletId) {
        fetch("http://localhost:5000/api/attendance/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employee_id: data.employee.id, outlet_id: selectedOutletId }),
        })
          .then((r) => r.json())
          .then((d) => { if (d.attendance) setAttendanceId(d.attendance.id); })
          .catch(() => {});
      }
    } catch {
      setPinError("Failed to connect to server");
    }
  };

  const handleLockRegister = async () => {
    if (attendanceId) {
      try {
        await fetch(`http://localhost:5000/api/attendance/${attendanceId}/checkout`, {
          method: "POST",
        });
      } catch {}
    }
    setCurrentEmployee(null);
    setAttendanceId(null);
  };

  if (!currentEmployee) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900">
        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col items-center">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4">
            <Lock size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">
            POS Terminal
          </h1>
          <p className="text-slate-500 text-sm mb-6 text-center">
            Enter your PIN to unlock the register
          </p>

          <form
            onSubmit={handlePinLogin}
            className="w-full flex flex-col gap-4"
          >
            <div>
              <input
                type="password"
                autoFocus
                maxLength="10"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  setPinError("");
                }}
                className="w-full text-center tracking-[0.5em] text-2xl py-3 px-4 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                placeholder="****"
              />
            </div>
            {pinError && (
              <p className="text-red-500 text-sm text-center font-medium">
                {pinError}
              </p>
            )}

            <button
              type="submit"
              disabled={!pinInput}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm mt-2"
            >
              Unlock Register
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-slate-50 relative">
      {/* Top Bar - Barcode Scanner Input */}
      <div className="bg-white px-6 py-4 shadow-sm border-b border-slate-200 z-10 flex items-center justify-between w-full">
        <div className="w-1/2">
          <form onSubmit={handleScan} className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-slate-400" />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              className="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-xl leading-5 bg-slate-50 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-lg transition-all"
              placeholder="Scan barcode or type here..."
              autoComplete="off"
              disabled={isCheckoutModalOpen}
              autoFocus
            />
          </form>
          {error && (
            <p className="text-red-500 text-sm mt-2 font-medium">{error}</p>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Outlet Selector */}
          {outlets.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <Store size={16} className="text-slate-500" />
              <select
                value={selectedOutletId || ""}
                onChange={(e) => setSelectedOutletId(parseInt(e.target.value))}
                className="text-sm font-bold text-slate-700 bg-transparent focus:outline-none cursor-pointer"
              >
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
            <User size={16} className="text-slate-500" />
            <span className="text-sm font-bold text-slate-700">
              {currentEmployee.name}
            </span>
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md ml-1 font-semibold border border-indigo-200">
              {currentEmployee.role}
            </span>
          </div>
          {attendanceId && (
            <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-semibold">
              <Clock size={13} />
              Clocked In
            </div>
          )}
          <button
            onClick={handleLockRegister}
            className="flex items-center gap-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors text-sm font-semibold border border-transparent hover:border-rose-100"
          >
            <LogOut size={16} />
            Lock Register
          </button>
        </div>
      </div>

      {/* No Active Shift Warning */}
      {!activeShift && selectedOutletId && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-between w-full">
          <div className="flex items-center gap-2 text-amber-800 text-sm font-medium">
            <Wallet size={16} className="text-amber-600 shrink-0" />
            No cash shift is open for this outlet. Sales will still process, but
            cash drawer tracking requires an open shift.
          </div>
          <a
            href="/cash-management"
            className="text-xs text-amber-700 underline font-semibold whitespace-nowrap ml-4 hover:text-amber-900"
          >
            Open Shift →
          </a>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden w-full">
        {/* Left Side: Cart Items */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <ShoppingCart size={64} className="mb-4 opacity-20" />
              <p className="text-xl">Cart is empty</p>
              <p className="text-sm mt-2">Scan an item to begin</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Item
                    </th>
                    <th className="px-6 py-4 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Qty
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Price
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {cart.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-slate-900">
                          {item.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {item.barcode}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className="px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                          {item.quantity}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 text-right">
                        ${item.price.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-900 text-right">
                        ${(item.price * item.quantity).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="text-red-500 hover:text-red-700 p-2 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Side: Checkout Panel */}
        <div className="w-96 min-w-[384px] bg-white border-l border-slate-200 shadow-xl z-20 flex flex-col h-full">
          <div className="p-6 flex-1">
            <h2 className="text-xl font-bold text-slate-800 mb-6">
              Order Summary
            </h2>

            <div className="space-y-4 text-slate-600">
              <div className="flex justify-between text-lg">
                <span>Subtotal</span>
                <span className="font-medium">${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg">
                <span>Tax</span>
                <span className="font-medium">${taxTotal.toFixed(2)}</span>
              </div>
              {discountValue > 0 && (
                <div className="flex justify-between text-lg text-rose-600">
                  <span>Discount</span>
                  <span className="font-medium">-${discountValue.toFixed(2)}</span>
                </div>
              )}
              <div className="h-px bg-slate-200 my-4"></div>
              <div className="flex justify-between text-2xl font-bold text-slate-900">
                <span>Total</span>
                <span className="text-green-600">${total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-200">
            <button
              onClick={() => {
                setPayments([]);
                setIsCheckoutModalOpen(true);
              }}
              disabled={cart.length === 0}
              className={`w-full py-4 px-6 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-2 transition-all ${
                cart.length === 0
                  ? "bg-slate-300 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700 shadow-lg hover:shadow-blue-600/30 hover:-translate-y-0.5"
              }`}
            >
              Checkout
            </button>
          </div>
        </div>
      </div>

      {/* Checkout Modal Overlay */}
      {isCheckoutModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex justify-center items-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <Banknote className="text-blue-600" /> Payment Processing
              </h2>
              <button
                onClick={() => setIsCheckoutModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-200 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto flex gap-6">
              {/* Left: Tenders Input */}
              <div className="flex-1 space-y-6">
                {/* Customer Selector */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Customer <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <div className="space-y-2">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search name or mobile..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                    >
                      <option value="">Walk-in Customer</option>
                      {customers
                        .filter((c) => {
                          if (!customerSearch) return true;
                          const q = customerSearch.toLowerCase();
                          return c.name.toLowerCase().includes(q) || (c.mobile || "").includes(q);
                        })
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.mobile ? ` · ${c.mobile}` : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* Discount Row */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Discount <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <div className="flex gap-2">
                    <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-semibold">
                      <button
                        type="button"
                        onClick={() => setDiscountType("fixed")}
                        className={`px-3 py-2 transition-colors ${discountType === "fixed" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                      >
                        $
                      </button>
                      <button
                        type="button"
                        onClick={() => setDiscountType("percent")}
                        className={`px-3 py-2 transition-colors ${discountType === "percent" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                      >
                        %
                      </button>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={discountInput}
                      onChange={(e) => setDiscountInput(e.target.value)}
                      placeholder={discountType === "percent" ? "e.g. 10" : "e.g. 5.00"}
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                  {discountValue > 0 && (
                    <p className="text-xs text-rose-600 font-medium mt-1">
                      −${discountValue.toFixed(2)} off · New total: ${total.toFixed(2)}
                    </p>
                  )}
                </div>

                <form onSubmit={handleAddPayment} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Payment Method
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("Cash")}
                        className={`py-3 px-4 border rounded-xl flex items-center justify-center gap-2 font-medium transition-colors ${paymentMethod === "Cash" ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20" : "border-slate-200 hover:bg-slate-50 text-slate-600"}`}
                      >
                        <Banknote size={20} /> Cash
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("Card")}
                        className={`py-3 px-4 border rounded-xl flex items-center justify-center gap-2 font-medium transition-colors ${paymentMethod === "Card" ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20" : "border-slate-200 hover:bg-slate-50 text-slate-600"}`}
                      >
                        <CreditCard size={20} /> Card
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Amount
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">
                        $
                      </span>
                      <input
                        ref={amountInputRef}
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={paymentAmountInput}
                        onChange={(e) => setPaymentAmountInput(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-xl font-medium"
                        placeholder="0.00"
                      />
                      <button
                        type="submit"
                        disabled={
                          !paymentAmountInput ||
                          isNaN(parseFloat(paymentAmountInput)) ||
                          parseFloat(paymentAmountInput) <= 0
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-slate-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </form>

                {/* List of Payments */}
                <div className="mt-6">
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">
                    Applied Tenders
                  </h3>
                  {payments.length === 0 ? (
                    <p className="text-slate-400 text-sm italic py-4 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
                      No payments added yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {payments.map((p, idx) => (
                        <li
                          key={idx}
                          className="flex justify-between items-center py-2 px-4 bg-blue-50/50 border border-blue-100 rounded-lg"
                        >
                          <div className="flex items-center gap-2 text-blue-800 font-medium text-sm">
                            {p.method === "Cash" ? (
                              <Banknote size={16} />
                            ) : (
                              <CreditCard size={16} />
                            )}
                            {p.method}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-slate-800">
                              ${p.amount.toFixed(2)}
                            </span>
                            <button
                              onClick={() => handleRemovePayment(idx)}
                              className="text-red-400 hover:text-red-600 p-1 rounded-full hover:bg-red-50"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Right: Totals Summary */}
              <div className="w-64 bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col">
                <div className="space-y-4 flex-1">
                  <div>
                    <p className="text-slate-500 text-sm font-semibold mb-1">
                      Total Due
                    </p>
                    <p className="text-2xl font-bold text-slate-800">
                      ${total.toFixed(2)}
                    </p>
                  </div>
                  <div className="h-px w-full bg-slate-200"></div>
                  <div>
                    <p className="text-slate-500 text-sm font-semibold mb-1">
                      Total Tendered
                    </p>
                    <p className="text-2xl font-bold text-blue-600">
                      ${totalPaid.toFixed(2)}
                    </p>
                  </div>
                  <div className="h-px w-full bg-slate-200"></div>
                  {remainingBalance > 0 ? (
                    <div>
                      <p className="text-rose-500 text-sm font-bold mb-1 uppercase tracking-wide">
                        Remaining Balance
                      </p>
                      <p className="text-3xl font-black text-rose-600">
                        ${remainingBalance.toFixed(2)}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl">
                      <p className="text-emerald-600 text-sm font-bold mb-1 uppercase tracking-wide">
                        Change Due
                      </p>
                      <p className="text-4xl font-black text-emerald-600">
                        ${changeDue.toFixed(2)}
                      </p>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleCompleteSale}
                  disabled={remainingBalance > 0}
                  className={`w-full py-4 mt-6 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-2 transition-all ${
                    remainingBalance > 0
                      ? "bg-slate-300 cursor-not-allowed"
                      : "bg-green-600 hover:bg-green-700 shadow-lg hover:shadow-green-600/30 hover:-translate-y-0.5"
                  }`}
                >
                  <CheckCircle2 size={24} />
                  Complete Sale
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
