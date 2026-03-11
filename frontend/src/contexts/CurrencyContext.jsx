import { createContext, useContext, useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "";

const CurrencyContext = createContext({
  symbol: "$",
  code: "USD",
  denominations: [100, 50, 20, 10, 5, 1],
  fmt: (n) => `$ ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  refresh: () => {},
});

export function CurrencyProvider({ children }) {
  const [currency, setCurrency] = useState({
    symbol: "$",
    code: "USD",
    denominations: [100, 50, 20, 10, 5, 1],
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/company-profile/currency`);
      if (res.ok) {
        const data = await res.json();
        setCurrency({
          symbol: data.symbol || "$",
          code: data.code || "USD",
          denominations: Array.isArray(data.denominations) ? data.denominations : [100, 50, 20, 10, 5, 1],
        });
      }
    } catch {
      // Silently use defaults on failure
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = useCallback(
    (n) => `${currency.symbol} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [currency.symbol]
  );

  return (
    <CurrencyContext.Provider value={{ ...currency, fmt, refresh: load }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
