# POS External Resources & Blueprints

Curated resource map for OneShopPOS — organized by gap area.

---

## Open-Source POS Blueprints (Study These)

| Project | Stack | Best For |
|---|---|---|
| [POSView](https://github.com/OviSarkar62/POSView) | MERN | Full-stack React + Node pattern reference |
| [react-pos-management-system](https://github.com/gokhan94/react-pos-management-system) | React + Redux + MongoDB | Cart/category/invoice flow |
| [heshanera/POS](https://github.com/heshanera/POS) | React/Redux + Node + MongoDB | Redux state management in POS |
| [keivanmojmali/point-of-sale-system](https://github.com/keivanmojmali/point-of-sale-system) | React + Express | Checkout + sales workflow |

**Recommendation:** Study `heshanera/POS` — closest to your architecture (React + Node).

---

## POS Architecture References

| Resource | What It Gives You |
|---|---|
| [Oracle Retail POS Architecture](https://docs.oracle.com/cd/E12480_01/returns_managementV2/pdf/141/html/pos_impg1/architecture.htm) | Enterprise 3-tier design: client/middle/data tiers, transaction masters |
| [Microsoft Dynamics 365 MPOS](https://learn.microsoft.com/en-us/dynamics365/commerce/dev-itpro/retail-modern-pos-architecture) | Modern POS scalability patterns |
| [AWS Traditional POS Checkout](https://aws.amazon.com/solutions/guidance/traditional-pos-checkout-on-aws/) | Cloud-native POS high-availability design |
| [Omnichannel POS Guide](https://www.szzcs.com/blog/an-omnichannel-pos-architecture-guide-for-retail-and-food-service.html) | Multi-channel (kiosk + cashier), unified inventory sync |

---

## Payment Gateways (Your Biggest Gap)

**India (Razorpay):**
- [Razorpay POS Docs](https://razorpay.com/docs/pos/?preferred-country=IN) — Android Smart POS, UPI + cards + wallets + EMI
- [UPI Tap & Pay](https://razorpay.com/blog/upi-tap-and-pay) — 1.5-second contactless payments

**Global (Stripe Terminal):**
- [Stripe Terminal Docs](https://docs.stripe.com/terminal) — Card readers (S700/S710), tap-to-pay, JS SDK
- [Design a Custom POS Integration](https://docs.stripe.com/terminal/designing-integration) — Patterns for custom POS checkout with Stripe

**North America (Square):**
- [Square Terminal API](https://developer.squareup.com/docs/pos-api/what-it-does) — Node.js SDK, omnichannel inventory sync

---

## Thermal Printer (ESC/POS)

| Resource | Notes |
|---|---|
| [node-escpos/driver](https://github.com/node-escpos/driver) | Production Node.js driver — USB, TCP, Serial |
| [node-thermal-printer](https://www.npmjs.com/package/node-thermal-printer) | NPM package designed for POS Node.js |
| [Esc-pos Printer Manager](https://escpos-printermanager.netlify.app/) | Web tool for testing ESC/POS commands |

**Key fact:** Browsers can't open TCP sockets — route print jobs through your Node backend (`/api/print`), then to the printer via TCP.

---

## SaaS Multi-Tenancy (Your Roadmap)

| Resource | What It Covers |
|---|---|
| [Multi-tenant in Node.js + PostgreSQL](https://dev.to/limaleandro1999/building-a-multi-tenant-saas-application-with-nodejs-and-postgresql-4ihe) | Schema-per-tenant vs row-level isolation |
| [AgusRdz/multitenant_demo](https://github.com/AgusRdz/multitenant_demo) | Runnable Node.js + Postgres demo |
| [Designing Multi-Tenant SaaS with Node.js](https://medium.com/@aliaftabk/designing-multi-tenant-saas-systems-with-node-js-4a12688dba27) | AsyncLocalStorage pattern (matches your existing plan) |

**Your advantage:** Your `SAAS_CONVERSION_PLAN.md` already describes the AsyncLocalStorage DB proxy pattern — this is exactly the right approach. The resources above validate it.

---

## Cash Handling Workflow Standards

- [Cash Handling Best Practices — Fit Small Business](https://fitsmallbusiness.com/cash-handling-best-practices/) — Blind counts, employee drawers, discrepancy management
- [Mastering Cash Handling — Xenia](https://www.xenia.team/articles/cash-handling-procedures-retail) — End-of-day closing, void/refund procedures

---

## Practical Next Steps

| Priority | Feature | Effort | Resources |
|---|---|---|---|
| 1 | Payment gateway | 3-4 days | Stripe Terminal JS SDK |
| 2 | Thermal printer | 1-2 days | node-thermal-printer + `/api/print` endpoint |
| 3 | SaaS Phase 1 | High | SAAS_CONVERSION_PLAN.md Phase 1 (master DB + tenant provisioner) |
