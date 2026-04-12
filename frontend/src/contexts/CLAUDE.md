# Contexts — Claude Guide

- **2 files** — React contexts, both wrap the app globally
- **`CurrencyContext.jsx`** — `CurrencyProvider` + `useCurrency()`. Defaults: `$`, `USD`, denominations `[100,50,20,10,5,1]`. Fetches from `GET /api/company-profile/currency`. In MT mode appends `?tenant=slug`. Provides `denominations` array (default `[100,50,20,10,5,1]`), `fmt(n)` formatter (`"$ 1,234.00"`), and `refresh()`. Silently skips fetch if no tenant slug (pre-login)
- **`ToastContext.jsx`** — `ToastProvider` + `useToast()`. Max 3 visible, 4s auto-dismiss. API: `{ toast(msg, type), success(msg), error(msg), warning(msg) }`. Types: success/error/warning/info. Renders in `fixed bottom-4 right-4 z-200`
