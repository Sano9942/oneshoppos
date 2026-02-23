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
  Calendar,
  Grid,
  MoreHorizontal,
  Tag,
  FileText,
} from "lucide-react";

export default function POS() {
  const [cart, setCart] = useState([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState("");

  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [payments, setPayments] = useState([]);
  const [paymentAmountInput, setPaymentAmountInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  const [discountInput, setDiscountInput] = useState("");
  const [discountType, setDiscountType] = useState("fixed");

  const [currentEmployee, setCurrentEmployee] = useState(null);
  const [attendanceId, setAttendanceId] = useState(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");

  const [outlets, setOutlets] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState(null);

  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  const inputRef = useRef(null);
  const amountInputRef = useRef(null);
  const searchTimeoutRef = useRef(null);

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

  useEffect(() => {
    fetch("http://localhost:5000/api/customers")
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers || []))
      .catch((err) => console.error("Failed to load customers", err)); // Fixed empty catch block
  }, []);

  useEffect(() => {
    if (!selectedOutletId) return;
    fetch(
      `http://localhost:5000/api/shifts/active?outlet_id=${selectedOutletId}`,
    )
      .then((r) => r.json())
      .then(() => {})
      .catch((err) => {
        console.error("Failed to load active shift", err);
      });
  }, [selectedOutletId]);

  const grossTotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  const taxTotal = cart.reduce((sum, item) => {
    const itemTotal = item.price * item.quantity;
    const taxObj = item.effectiveTaxRate || 0;
    const taxAmount = itemTotal - itemTotal / (1 + taxObj / 100);
    return sum + taxAmount;
  }, 0);
  const subtotal = grossTotal - taxTotal;

  const discountValue =
    discountType === "percent"
      ? (grossTotal * parseFloat(discountInput || 0)) / 100
      : parseFloat(discountInput || 0);
  const total = grossTotal - discountValue;

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = total > 0 ? Math.max(0, total - totalPaid) : 0;
  const changeDue =
    total >= 0 ? Math.max(0, totalPaid - total) : Math.abs(total);

  useEffect(() => {
    let focusTimeout;
    if (
      isCheckoutModalOpen &&
      remainingBalance > 0 &&
      paymentAmountInput === ""
    ) {
      focusTimeout = setTimeout(() => amountInputRef.current?.focus(), 100);
    }
    return () => clearTimeout(focusTimeout);
  }, [isCheckoutModalOpen, remainingBalance, paymentAmountInput]);

  const handleCheckoutModalOpen = () => {
    setPayments([]);
    if (remainingBalance > 0) {
      setPaymentAmountInput(remainingBalance.toFixed(2));
    }
    setIsCheckoutModalOpen(true);
  };

  const handleSearchInput = (e) => {
    const query = e.target.value;
    setBarcodeInput(query);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!query.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const outletParam = selectedOutletId
          ? `&outlet_id=${selectedOutletId}`
          : "";
        const res = await fetch(
          `http://localhost:5000/api/products/search?query=${query}${outletParam}`,
        );
        const data = await res.json();
        setSearchResults(data.products || []);
        setShowDropdown(true);
      } catch (err) {
        console.error("Search failed", err);
      }
    }, 300);
  };

  const addItemToCart = (product) => {
    setError("");
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
    setSearchResults([]);
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  const handleScanSubmit = async (e) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    if (searchResults.length === 1 && showDropdown) {
      addItemToCart(searchResults[0]);
      return;
    }

    try {
      const outletParam = selectedOutletId
        ? `?outlet_id=${selectedOutletId}`
        : "";
      const res = await fetch(
        `http://localhost:5000/api/products/scan/${barcodeInput}${outletParam}`,
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Product not found");
        return;
      }
      addItemToCart(data.product);
    } catch (err) {
      setError("Connection failed.");
      console.error("Scan failed", err);
    }
  };

  const removeFromCart = (id) => setCart(cart.filter((item) => item.id !== id));

  const updateQuantity = (id, delta) => {
    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.id === id) {
          const newQty = item.quantity + delta;
          if (delta > 0 && newQty > item.availableStock) {
            setError(`Only ${item.availableStock} in stock.`);
            return item;
          }
          return { ...item, quantity: newQty };
        }
        return item;
      }),
    );
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
        printWindow.onload = () => printWindow.print();

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
    } catch (err) {
      setError("Checkout failed. Is the server running?");
      setIsCheckoutModalOpen(false);
      console.error("Checkout failed", err);
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
          headers: { "Content-Type": "application/json" },
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

      if (selectedOutletId) {
        fetch("http://localhost:5000/api/attendance/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_id: data.employee.id,
            outlet_id: selectedOutletId,
          }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.attendance) setAttendanceId(d.attendance.id);
          })
          .catch((err) => console.error("Failed to check in attendance", err)); // Fixed empty catch block
      }
    } catch (err) {
      setPinError("Failed to connect to server");
      console.error("PIN login failed", err);
    }
  };

  const handleLockRegister = async () => {
    if (attendanceId) {
      try {
        await fetch(
          `http://localhost:5000/api/attendance/${attendanceId}/checkout`,
          { method: "POST" },
        );
      } catch (e) {
        console.error("Failed to checkout", e);
      }
    }
    setCurrentEmployee(null);
    setAttendanceId(null);
  };

  if (!currentEmployee) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900">
        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col items-center">
          <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-4">
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
                className="w-full text-center tracking-[0.5em] text-2xl py-3 px-4 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
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
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm mt-2"
            >
              Unlock Register
            </button>
          </form>
        </div>
      </div>
    );
  }

  const currentDate = new Date().toLocaleDateString("en-GB");

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-slate-100 relative font-sans">
      <div className="bg-white px-6 py-3 shadow-sm flex items-center justify-between border-b border-slate-200 z-20">
        <div className="flex items-center gap-2">
          <Grid className="text-[#8066FF]" size={20} />
          <h1 className="text-lg font-bold text-slate-800">Point Of Sale</h1>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-slate-600 hidden sm:block">
            One Shop-The Toy Store
          </span>
          {outlets.length > 0 && (
            <select
              value={selectedOutletId || ""}
              onChange={(e) => setSelectedOutletId(parseInt(e.target.value))}
              className="text-sm font-bold text-slate-700 bg-transparent focus:outline-none cursor-pointer border-none"
            >
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600">
              <User size={18} />
            </div>
          </div>
          <button
            onClick={handleLockRegister}
            className="text-slate-400 hover:text-red-500 transition-colors ml-2"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col p-6 bg-slate-50 overflow-y-auto w-2/3">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-3xl font-bold text-slate-800 tracking-tight">
              Sell
            </h2>
            <div className="flex gap-2">
              <button className="flex items-center gap-2 text-[#8066FF] border border-indigo-100 bg-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-indigo-50 transition-colors shadow-sm">
                <Tag size={14} /> Park Sale
              </button>
              <button className="flex items-center gap-2 text-[#8066FF] border border-indigo-100 bg-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-indigo-50 transition-colors shadow-sm">
                <Clock size={14} /> Previously Parked Sales
              </button>
              <button className="flex items-center gap-2 bg-[#8066FF] text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-[#7055E6] transition-colors shadow-sm">
                More Actions <MoreHorizontal size={14} />
              </button>
            </div>
          </div>

          <div className="flex gap-3 mb-6">
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex items-center justify-between shadow-sm text-slate-600 w-48">
              <span className="text-sm font-semibold text-slate-400">
                {currentDate}
              </span>
              <Calendar size={16} className="text-slate-400" />
            </div>
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex items-center gap-3 shadow-sm">
              <div className="w-10 h-5 bg-slate-200 rounded-full relative">
                <div className="w-4 h-4 bg-white rounded-full absolute left-0.5 top-0.5 shadow-sm"></div>
              </div>
              <span className="text-sm font-bold text-slate-600">
                Tax Exclusive
              </span>
            </div>
          </div>

          <div className="mb-4 relative">
            <h3 className="text-sm font-bold text-slate-800 mb-2">
              Search Product
            </h3>
            <form
              onSubmit={handleScanSubmit}
              className="relative shadow-sm rounded-xl"
            >
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={barcodeInput}
                onChange={handleSearchInput}
                onFocus={() => {
                  if (searchResults.length > 0) setShowDropdown(true);
                }}
                className="block w-full pl-10 pr-3 py-3 border border-slate-200 shadow-sm rounded-xl leading-5 bg-white placeholder-slate-300 focus:outline-none focus:border-[#8066FF] focus:ring-1 focus:ring-[#8066FF] font-medium text-sm transition-all"
                placeholder="Search for Product"
                autoComplete="off"
                disabled={isCheckoutModalOpen}
                autoFocus
              />
            </form>
            {error && (
              <p className="text-red-500 text-sm mt-1 font-medium">{error}</p>
            )}

            {showDropdown && searchResults.length > 0 && (
              <div className="absolute z-50 mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-100 max-h-60 overflow-y-auto">
                {searchResults.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => addItemToCart(p)}
                    className="px-4 py-3 hover:bg-[#8066FF]/5 cursor-pointer border-b border-slate-50 last:border-0 flex justify-between items-center transition-colors"
                  >
                    <div>
                      <div className="font-bold text-slate-800">{p.name}</div>
                      <div className="text-xs text-slate-400">{p.barcode}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-[#8066FF]">
                        PKRs {p.price.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                        Stock: {p.local_stock}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <h3 className="text-sm font-bold text-slate-800 mb-2">
            Products List
          </h3>

          <div className="bg-white flex-1 rounded-xl shadow-sm border border-slate-100 overflow-hidden flex flex-col relative">
            {cart.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
                <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mb-4">
                  <FileText size={24} className="text-[#8066FF] opacity-50" />
                </div>
                <h3 className="text-[15px] font-bold text-slate-800 mb-1">
                  No Item Selected
                </h3>
                <p className="text-xs text-center max-w-sm leading-relaxed text-slate-500">
                  No products selected. Easily add items by using the search
                  from the bar above. Explore and personalize your list now.
                </p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 px-4 py-2">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] text-slate-400 uppercase tracking-wider">
                      <th className="py-3 font-bold">Product</th>
                      <th className="py-3 font-bold text-center">Qty</th>
                      <th className="py-3 font-bold text-right">Price</th>
                      <th className="py-3 font-bold text-right">Total</th>
                      <th className="py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors"
                      >
                        <td className="py-3">
                          <div className="font-bold text-slate-800 text-sm">
                            {item.name}
                          </div>
                        </td>
                        <td className="py-3 text-center">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => updateQuantity(item.id, -1)}
                              className="w-7 h-7 flex items-center justify-center text-[#8066FF] hover:bg-[#8066FF]/10 rounded-full font-bold transition-colors"
                            >
                              -
                            </button>
                            <span className="w-8 text-center text-sm font-bold text-slate-800">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => updateQuantity(item.id, 1)}
                              className="w-7 h-7 flex items-center justify-center text-[#8066FF] hover:bg-[#8066FF]/10 rounded-full font-bold transition-colors"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="py-3 text-right text-sm text-slate-500 font-bold">
                          PKRs {item.price.toFixed(2)}
                        </td>
                        <td className="py-3 text-right text-sm text-slate-900 font-black">
                          PKRs {(item.price * item.quantity).toFixed(2)}
                        </td>
                        <td className="py-3 text-right">
                          <button
                            onClick={() => removeFromCart(item.id)}
                            className="text-red-400 hover:text-red-500 bg-red-50 hover:bg-red-100 p-1.5 rounded-lg transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="w-95 min-w-95 bg-[#0A0A0A] text-white p-5 flex flex-col h-full rounded-tl-2xl shadow-2xl z-10">
          <div className="relative mb-6">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
              size={16}
            />
            <input
              type="text"
              placeholder="Search & Select Customer"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              className="w-full bg-white text-slate-900 rounded-xl pl-10 pr-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#8066FF] placeholder-slate-400 shadow-inner"
            />
          </div>

          <div className="flex-1 border border-[#1A1A1A] rounded-xl flex items-center justify-center p-4 bg-[#111] mb-6 shadow-inner">
            {/* Customer selected space or empty placeholder */}
            {selectedCustomerId ? (
              <div className="text-center w-full">
                <div className="w-12 h-12 bg-[#8066FF]/20 text-[#8066FF] rounded-full mx-auto mb-2 flex items-center justify-center">
                  <User size={20} />
                </div>
                <p className="font-bold text-sm">
                  {customers.find((c) => c.id == selectedCustomerId)?.name}
                </p>
                <button
                  onClick={() => setSelectedCustomerId("")}
                  className="text-xs text-red-400 mt-2 hover:underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="space-y-3 w-full">
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full bg-white/5 text-white rounded-lg px-3 py-2 text-sm focus:outline-none border border-[#333] mb-2 appearance-none font-medium"
                >
                  <option value="" className="text-slate-800">
                    Walk-in Customer
                  </option>
                  {customers
                    .filter((c) => {
                      if (!customerSearch) return true;
                      const q = customerSearch.toLowerCase();
                      return (
                        c.name.toLowerCase().includes(q) ||
                        (c.mobile || "").includes(q)
                      );
                    })
                    .map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                        className="text-slate-800"
                      >
                        {c.name} {c.mobile ? `· ${c.mobile}` : ""}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex gap-3 mb-6">
            <button className="flex-1 flex items-center justify-center gap-2 border border-[#333] hover:bg-[#222] hover:border-[#444] rounded-xl py-3 text-[13px] font-bold transition-all shadow-sm">
              <Tag size={14} className="text-[#8066FF]" /> Add Discount
            </button>
            <button className="flex-1 flex items-center justify-center gap-2 border border-[#333] hover:bg-[#222] hover:border-[#444] rounded-xl py-3 text-[13px] font-bold transition-all shadow-sm">
              <FileText size={14} className="text-[#8066FF]" /> Add Note
            </button>
          </div>

          <div className="space-y-4 text-[13px] font-semibold text-slate-400 mb-6 border-t border-[#222] py-6 px-1">
            <div className="flex justify-between items-center">
              <span>SubTotal</span>
              <span className="text-white">PKRs {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span>Discount %</span>
              <span className="flex items-center gap-1.5 text-white">
                0.0 <FileText size={12} className="opacity-40" />
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>GST</span>
              <span className="text-white">PKRs {taxTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm pt-2">
              <span className="font-bold text-slate-300">Discount Amount</span>
              <span className="text-white font-bold">
                PKRs {discountValue.toFixed(2)}
              </span>
            </div>
          </div>

          <button
            onClick={handleCheckoutModalOpen}
            disabled={cart.length === 0}
            className={`w-full py-4 rounded-xl text-white font-black text-lg flex items-center justify-between px-6 transition-all ${
              cart.length === 0
                ? "bg-[#8066FF]/30 cursor-not-allowed text-white/40"
                : "bg-[#8066FF] hover:bg-[#7055E6] hover:scale-[1.02] shadow-[0_10px_20px_-10px_rgba(128,102,255,0.6)]"
            }`}
          >
            <span className="tracking-wide text-base border-r border-white/20 pr-4">
              Pay
            </span>
            <span className="pl-2 tracking-tight flex-1 text-right">
              PKRs {total.toFixed(2)}
            </span>
          </button>

          <button
            onClick={() => setCart([])}
            className="w-full text-center text-slate-500 mt-5 text-[13px] font-semibold hover:text-white transition-colors"
          >
            Clear Order
          </button>
        </div>
      </div>

      {isCheckoutModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col border border-slate-100/20">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Banknote className="text-[#8066FF]" /> Complete Payment
              </h2>
              <button
                onClick={() => setIsCheckoutModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              <div className="text-center mb-6 bg-slate-50 border border-slate-100 rounded-2xl py-6">
                <p className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-2">
                  Total Due
                </p>
                <p className="text-5xl font-black text-slate-900 tracking-tight">
                  PKRs {remainingBalance.toFixed(2)}
                </p>
              </div>

              <form onSubmit={handleAddPayment} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">
                    Payment Method
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod("Cash")}
                      className={`py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-bold transition-all border-2 ${paymentMethod === "Cash" ? "border-[#8066FF] bg-[#8066FF]/5 text-[#8066FF]" : "border-slate-100 bg-white hover:border-slate-300 text-slate-600"}`}
                    >
                      <Banknote size={18} /> Cash
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod("Card")}
                      className={`py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-bold transition-all border-2 ${paymentMethod === "Card" ? "border-[#8066FF] bg-[#8066FF]/5 text-[#8066FF]" : "border-slate-100 bg-white hover:border-slate-300 text-slate-600"}`}
                    >
                      <CreditCard size={18} /> Card
                    </button>
                  </div>
                </div>
                <div className="pt-2">
                  <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">
                    Amount
                  </label>
                  <div className="flex gap-3">
                    <input
                      ref={amountInputRef}
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={paymentAmountInput}
                      onChange={(e) => setPaymentAmountInput(e.target.value)}
                      className="flex-1 px-5 py-4 bg-white border-2 border-slate-200 rounded-xl focus:border-[#8066FF] focus:ring-0 outline-none text-xl font-bold shadow-sm"
                      placeholder="0.00"
                    />
                    <button
                      type="submit"
                      disabled={
                        !paymentAmountInput ||
                        isNaN(parseFloat(paymentAmountInput)) ||
                        parseFloat(paymentAmountInput) <= 0
                      }
                      className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-md"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </form>

              {payments.length > 0 && (
                <div className="mt-8 border-t border-slate-100 pt-6">
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-4">
                    Tenders
                  </h3>
                  <ul className="space-y-3">
                    {payments.map((p, idx) => (
                      <li
                        key={idx}
                        className="flex justify-between items-center py-3 px-4 bg-slate-50 border border-slate-100 rounded-xl"
                      >
                        <div className="text-slate-800 font-bold text-sm flex items-center gap-2">
                          {p.method === "Cash" ? (
                            <Banknote className="text-[#8066FF]" size={16} />
                          ) : (
                            <CreditCard className="text-[#8066FF]" size={16} />
                          )}{" "}
                          {p.method}
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-black text-slate-900">
                            PKRs {p.amount.toFixed(2)}
                          </span>
                          <button
                            onClick={() => handleRemovePayment(idx)}
                            className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={handleCompleteSale}
                disabled={remainingBalance > 0}
                className={`w-full py-4 mt-8 rounded-xl text-white font-black tracking-wide text-lg flex items-center justify-center gap-2 transition-all ${remainingBalance > 0 ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-emerald-500 hover:bg-emerald-600 shadow-[0_10px_20px_-10px_rgba(16,185,129,0.5)] hover:scale-[1.02]"}`}
              >
                <CheckCircle2
                  size={24}
                  className={remainingBalance > 0 ? "opacity-50" : ""}
                />{" "}
                {remainingBalance > 0
                  ? "Add Remaining Tender"
                  : "Complete Checkout"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
