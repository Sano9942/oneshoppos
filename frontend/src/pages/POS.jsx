import { useState, useEffect, useRef } from 'react';
import { Search, Plus, Trash2, Printer, ShoppingCart } from 'lucide-react';

export default function POS() {
  const [cart, setCart] = useState([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [error, setError] = useState('');
  
  // The magic ref that keeps our scanner input focused
  const inputRef = useRef(null);

  // Keep focus on the input field automatically
  useEffect(() => {
    const focusInput = () => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    };
    
    // Check every few ms. Perfect for busy cashiers who click away.
    const interval = setInterval(focusInput, 500);
    return () => clearInterval(interval);
  }, []);

  const handleScan = async (e) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    setError('');
    
    try {
      // 1. Fetch from Backend
      const res = await fetch(`http://localhost:5000/api/products/scan/${barcodeInput}`);
      const data = await res.json();
      
      if (!res.ok) {
        // If 404, we'll show an error
        setError(data.error || 'Product not found');
        setBarcodeInput('');
        return;
      }

      const product = data.product;

      // 2. Add to Cart or Increment Quantity
      setCart((prevCart) => {
        const existingItem = prevCart.find(item => item.id === product.id);
        if (existingItem) {
          // Check stock limit!
          if (existingItem.quantity >= product.stock) {
            setError(`Cannot add more. Only ${product.stock} in stock.`);
            return prevCart;
          }
          return prevCart.map(item => 
            item.id === product.id 
              ? { ...item, quantity: item.quantity + 1 } 
              : item
          );
        } else {
           if (product.stock <= 0) {
              setError(`Out of stock!`);
              return prevCart;
           }
          return [{ ...product, quantity: 1 }, ...prevCart];
        }
      });
      
      setBarcodeInput(''); // Clear input for next scan

    } catch (err) {
      console.error(err);
      setError('Connection to server failed.');
    }
  };

  const removeFromCart = (id) => {
    setCart(cart.filter(item => item.id !== id));
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;

    try {
      const res = await fetch('http://localhost:5000/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethod: 'Cash', // Default for now
          cartItems: cart
        })
      });

      if (res.ok) {
        const data = await res.json();
        
        // --- RECEIPT PRINTING LOGIC ---
        // Create an invisible iframe to print thermal-receipt formatted text
        const printWindow = window.open('', '_blank', 'width=400,height=600');
        
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

        cart.forEach(item => {
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
                <tr class="bold text-lg">
                  <td>TOTAL</td>
                  <td class="right">$${total.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Payment Method</td>
                  <td class="right">Cash</td>
                </tr>
              </table>
              <div class="divider"></div>
              <p class="center" style="font-size:12px">Powered by OneShopPOS System<br/>(Custom Build)</p>
            </body>
          </html>
        `;

        printWindow.document.write(receiptHTML);
        printWindow.document.close();
        
        // Automatically open the print dialog the moment the window loads
        printWindow.onload = () => {
           printWindow.print();
           // Optional: printWindow.close(); // Close the tab after printing
        };

        // Clear cart after successful checkout
        setCart([]); 
      } else {
        const data = await res.json();
        setError(data.error || 'Checkout failed');
      }
    } catch (err) {
      setError('Checkout failed. Is the server running?');
    }
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

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
               autoFocus
             />
           </form>
           {error && <p className="text-red-500 text-sm mt-2 font-medium">{error}</p>}
        </div>
      </div>

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
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Item</th>
                    <th className="px-6 py-4 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Qty</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Price</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {cart.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-slate-900">{item.name}</div>
                        <div className="text-xs text-slate-500">{item.barcode}</div>
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
                        <button onClick={() => removeFromCart(item.id)} className="text-red-500 hover:text-red-700 p-2 rounded-lg hover:bg-red-50 transition-colors">
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
             <h2 className="text-xl font-bold text-slate-800 mb-6">Order Summary</h2>
             
             <div className="space-y-4 text-slate-600">
               <div className="flex justify-between text-lg">
                 <span>Subtotal</span>
                 <span className="font-medium">${total.toFixed(2)}</span>
               </div>
               <div className="flex justify-between text-lg">
                 <span>Tax (0%)</span>
                 <span className="font-medium">$0.00</span>
               </div>
               <div className="h-px bg-slate-200 my-4"></div>
               <div className="flex justify-between text-2xl font-bold text-slate-900">
                 <span>Total</span>
                 <span className="text-green-600">${total.toFixed(2)}</span>
               </div>
             </div>
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-200">
            <button 
              onClick={handleCheckout}
              disabled={cart.length === 0}
              className={`w-full py-4 px-6 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-2 transition-all ${
                cart.length === 0 
                  ? 'bg-slate-300 cursor-not-allowed' 
                  : 'bg-green-600 hover:bg-green-700 shadow-lg hover:shadow-green-600/30 hover:-translate-y-0.5'
              }`}
            >
              <Printer size={24} />
              Pay & Print Receipt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
