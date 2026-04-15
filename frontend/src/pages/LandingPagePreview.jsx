import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BedDouble,
  BriefcaseBusiness,
  CalendarDays,
  Car,
  Check,
  ChefHat,
  ClipboardList,
  CreditCard,
  HeartPulse,
  Landmark,
  Laptop,
  Package,
  Printer,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Store,
  Tablet,
  Users,
  WifiOff,
  Wrench,
  Zap,
} from "lucide-react";

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1800&q=80";

const BUSINESS_IMAGES = {
  restaurant:
    "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=900&q=80",
  clinic:
    "https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=900&q=80",
  hospitality:
    "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80",
};

const CORE_SYSTEMS = [
  {
    icon: ShoppingBag,
    title: "Sell",
    copy: "Fast checkout, split payments, returns, receipts, shifts, and an offline sale queue for busy counters.",
  },
  {
    icon: Package,
    title: "Stock",
    copy: "Products, services, variants, branch stock, transfers, adjustments, purchasing, and supplier receiving.",
  },
  {
    icon: Users,
    title: "Staff",
    copy: "Employees, roles, permissions, attendance kiosk, cash shifts, payroll exports, and approval controls.",
  },
  {
    icon: HeartPulse,
    title: "Customers",
    copy: "Profiles, loyalty, wallet, receipts, order history, booking records, and customer portal access.",
  },
  {
    icon: Store,
    title: "Branches",
    copy: "Start with one outlet. Add extra outlets as paid add-ons and keep sales, stock, and staff connected.",
  },
  {
    icon: ReceiptText,
    title: "Reports",
    copy: "Sales, inventory, finance, tax, staff, operations, and owner dashboards in one reporting layer.",
  },
];

const DEVICES = [
  {
    icon: Tablet,
    title: "Tablet",
    copy: "Install as a PWA for a touch-friendly counter layout.",
  },
  {
    icon: Laptop,
    title: "Laptop / Desktop",
    copy: "Run the full dashboard with keyboard shortcuts and reports.",
  },
  {
    icon: Smartphone,
    title: "Phone",
    copy: "Check reports, stock, and branch activity on the go.",
  },
];

const POS_DEPTH = [
  {
    icon: ShieldCheck,
    title: "FBR Digital Invoicing",
    copy: "Real-time posting with retry handling, tax-ready records, and category-level setup.",
  },
  {
    icon: BarChart3,
    title: "Reports That Owners Use",
    copy: "Sales, stock, purchasing, finance, staff, tax, and operations views from the same data.",
  },
  {
    icon: HeartPulse,
    title: "Loyalty & Wallet",
    copy: "Points, wallet credit, tiers, customer history, receipts, and portal access.",
  },
  {
    icon: Store,
    title: "Multi-Outlet Control",
    copy: "Stock transfers, branch sales, outlet-level staff access, and branch reporting as you grow.",
  },
  {
    icon: WifiOff,
    title: "Offline Sale Queue",
    copy: "Keep ringing up sales during outages. Sync queued sales when the connection returns.",
  },
  {
    icon: Printer,
    title: "Thermal + Cloud Printing",
    copy: "ESC/POS thermal printing, network printer support, barcode scanners, and browser access.",
  },
  {
    icon: Users,
    title: "HR, Attendance & Kiosk",
    copy: "PIN clock-in, breaks, cash shifts, permissions, payroll export, and approval controls.",
  },
  {
    icon: RefreshCw,
    title: "Shopify + WooCommerce",
    copy: "Connect products, inventory, customers, and orders without running a separate back office.",
  },
];

const BUSINESS_TYPES = [
  {
    icon: Store,
    title: "Retail & Grocery",
    copy: "Barcode checkout, product variants, stock transfers, supplier purchasing, and FBR-ready receipts.",
  },
  {
    icon: ChefHat,
    title: "Restaurants & Cafes",
    copy: "Menus, tables, checks, kitchen flow, public menu links, staff shifts, and branch reporting.",
  },
  {
    icon: CalendarDays,
    title: "Salons, Clinics & Appointments",
    copy: "Services, bookings, staff calendars, deposits, customer records, and appointment history.",
  },
  {
    icon: Wrench,
    title: "Repair & Service Jobs",
    copy: "Job tickets, estimates, deposits, customer updates, status tracking, and final invoicing.",
  },
  {
    icon: Car,
    title: "Rentals & Assets",
    copy: "Assets, contracts, checkout, returns, deposits, condition notes, and overdue follow-up.",
  },
  {
    icon: BedDouble,
    title: "Hotels & Guesthouses",
    copy: "Rooms, bookings, folios, housekeeping, deposits, stay records, and POS charges to rooms.",
  },
];

const CUSTOMER_TOOLS = [
  "Customer portal for invoices, orders, appointments, loyalty, wallet, and profile",
  "Public booking links for service businesses",
  "Restaurant menu links for QR ordering and browsing",
  "Storefront pages connected to the same products and customers",
  "Online receipts that can be printed, emailed, or shared",
];

const COMPARISON = [
  ["Separate POS app", "POS, shifts, receipts, returns, and offline sales"],
  ["Spreadsheet stock", "Inventory, transfers, alerts, purchasing, and branch stock"],
  ["WhatsApp bookings", "Booking links, staff calendars, deposits, and history"],
  ["Manual attendance", "Kiosk clock-in, breaks, sessions, and reports"],
  ["Disconnected loyalty", "Wallet, points, tiers, receipts, and customer portal"],
  ["Branch guesswork", "Outlet context, stock by branch, and branch-level reports"],
];

const POS_COMPARISON = [
  ["FBR digital invoicing", "Real-time + retry queue", "Extra cost or unavailable"],
  ["Offline sales", "Queued locally, synced later", "Often not available"],
  ["Reports", "Sales, stock, finance, staff, tax, operations", "Usually limited"],
  ["Accounting", "P&L, ledgers, cash flow, AP/AR", "Separate software"],
  ["Loyalty + wallet", "Built into customer records", "Paid add-on"],
  ["Multi-outlet stock", "Transfers, outlet stock, branch reporting", "Higher tier or manual"],
  ["Returns + exchanges", "Handled inside POS flow", "Returns only"],
  ["Attendance + kiosk", "Staff clock-in and operations reports", "Separate system"],
  ["Public customer tools", "Receipts, portal, bookings, menu, storefront", "Multiple tools"],
  ["Hardware", "Browser, PWA, barcode scanners, ESC/POS printers", "Device lock-in or browser print"],
];

const STATS = [
  ["67+", "Reports"],
  ["90+", "Features"],
  ["F1-F10", "Shortcuts"],
  ["11", "RFM Segments"],
  ["100%", "Works Offline"],
  ["5 min", "Setup Time"],
  ["0", "Feature Locks"],
];

const FEATURE_GROUPS = [
  {
    title: "POS",
    items: ["Barcode scanning", "Split payments", "Keyboard shortcuts", "Park and recall sales", "Offline sale queue", "Returns and exchanges", "Customer display"],
  },
  {
    title: "Inventory",
    items: ["Stock by outlet", "Transfers", "Adjustments", "Reorder alerts", "Bundles / kits", "Stock counts", "Bulk import"],
  },
  {
    title: "Customers",
    items: ["Loyalty points", "Wallet", "Customer groups", "RFM segments", "Receipts", "WhatsApp sharing", "Portal access"],
  },
  {
    title: "Operations",
    items: ["Attendance kiosk", "Cash shifts", "Approvals", "Audit log", "Payroll export", "Permissions", "Dark mode"],
  },
  {
    title: "Accounting",
    items: ["Chart of accounts", "P&L", "Balance sheet", "Cash flow", "AP / AR", "Ledgers", "Cheque tracking"],
  },
  {
    title: "Integrations",
    items: ["FBR invoicing", "Shopify sync", "WooCommerce sync", "Courier integrations", "API docs", "Thermal printing", "PWA"],
  },
];

const STEPS = [
  "Create your account",
  "Choose your business type",
  "Configure your first outlet",
  "Add products, services, rooms, assets, or menu items",
  "Start selling, booking, or managing operations",
];

function PreviewNav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
        <a href="/" className="flex items-center gap-2 text-lg font-bold text-neutral-950">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Zap size={17} />
          </span>
          SanoPOS
        </a>
        <div className="hidden items-center gap-6 text-sm font-semibold text-neutral-700 md:flex">
          <a href="#platform" className="hover:text-emerald-700">Platform</a>
          <a href="#business-types" className="hover:text-emerald-700">Business Types</a>
          <a href="#customers" className="hover:text-emerald-700">Customer Tools</a>
          <a href="#pricing" className="hover:text-emerald-700">Pricing</a>
        </div>
        <div className="flex items-center gap-2">
          <a href="/signup?plan=free" className="hidden rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 sm:inline-flex">
            Start Free
          </a>
          <a href="/login" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            Sign In
          </a>
        </div>
      </div>
    </nav>
  );
}

function SectionHeading({ eyebrow, title, copy, inverse = false }) {
  return (
    <div className="mx-auto mb-10 max-w-3xl text-center">
      <p className={`mb-3 text-sm font-bold ${inverse ? "text-emerald-300" : "text-emerald-700"}`}>{eyebrow}</p>
      <h2 className={`text-3xl font-extrabold leading-tight md:text-4xl ${inverse ? "text-white" : "text-neutral-950"}`}>{title}</h2>
      {copy && <p className={`mt-4 text-base leading-7 ${inverse ? "text-white/74" : "text-neutral-600"}`}>{copy}</p>}
    </div>
  );
}

function IconCard({ icon: Icon, title, copy }) {
  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        <Icon size={21} />
      </div>
      <h3 className="mb-2 text-base font-bold text-neutral-950">{title}</h3>
      <p className="text-sm leading-6 text-neutral-600">{copy}</p>
    </article>
  );
}

function CheckListGroup({ title, items }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-extrabold uppercase text-emerald-700">{title}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-6 text-neutral-700">
            <Check size={15} className="mt-1 shrink-0 text-emerald-600" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LandingPagePreview() {
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <PreviewNav />

      <header className="relative min-h-[540px] overflow-hidden md:min-h-[650px]">
        <img
          src={HERO_IMAGE}
          alt="Business owner accepting a payment at the counter"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-neutral-950/68" />
        <div className="relative mx-auto flex min-h-[540px] max-w-7xl items-center px-5 py-8 md:min-h-[650px] md:py-16">
          <div className="max-w-4xl text-white">
            <div className="mb-4 inline-flex rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold backdrop-blur md:mb-6 md:py-2 md:text-sm">
              Built for one outlet today and more branches tomorrow
            </div>
            <h1 className="max-w-4xl text-3xl font-extrabold leading-tight sm:text-4xl md:text-5xl lg:text-6xl">
              The business operating system that starts at the counter.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/86 md:mt-6 md:text-xl md:leading-8">
              Run sales, stock, staff, bookings, branches, customers, payments, and reports from one connected platform.
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/76 sm:text-base sm:leading-7">
              SanoPOS starts as a fast POS, then adapts to retail, restaurants, salons, clinics, rentals, hotels, gyms, repair shops, and more.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row md:mt-8">
              <a href="/signup?plan=free" className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700">
                Start Free <ArrowRight className="ml-2" size={17} />
              </a>
              <a href="/login" className="inline-flex items-center justify-center rounded-lg border border-white/45 bg-white/10 px-5 py-3 text-sm font-bold text-white hover:bg-white/18">
                Sign In
              </a>
            </div>
            <div className="mt-7 hidden max-w-3xl gap-3 text-sm text-white/86 sm:grid sm:grid-cols-3">
              {["Free plan available", "45-day Pro trial", "Pro from PKR 8,000/month per outlet"].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <BadgeCheck size={17} className="text-emerald-300" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-neutral-200 bg-white py-14 md:py-16">
          <div className="mx-auto max-w-7xl px-5">
            <SectionHeading
              eyebrow="Runs On What You Already Own"
              title="No special hardware. No app store."
              copy="Open your browser and start working. Add a barcode scanner or ESC/POS printer when you want the full counter setup."
            />
            <div className="grid gap-5 md:grid-cols-3">
              {DEVICES.map(({ icon: Icon, title, copy }) => (
                <article key={title} className="text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <Icon size={28} />
                  </div>
                  <h3 className="mb-2 font-bold text-neutral-950">{title}</h3>
                  <p className="mx-auto max-w-xs text-sm leading-6 text-neutral-600">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#f7faf9] py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-5">
            <SectionHeading
              eyebrow="POS Depth"
              title="The counter is still the heart of the system."
              copy="The broader platform starts with a serious POS foundation: offline selling, receipts, branch stock, staff controls, loyalty, reporting, and local compliance."
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {POS_DEPTH.map((item) => <IconCard key={item.title} {...item} />)}
            </div>
          </div>
        </section>

        <section id="platform" className="border-b border-neutral-200 bg-white py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-5">
            <SectionHeading
              eyebrow="One System Instead Of Seven"
              title="Daily work stays connected."
              copy="Stop stitching together POS, inventory, bookings, attendance, accounting, loyalty, and reports. SanoPOS brings the operating work into one place."
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {CORE_SYSTEMS.map((item) => <IconCard key={item.title} {...item} />)}
            </div>
          </div>
        </section>

        <section className="bg-white py-16 md:py-20">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHeading
              eyebrow="Feature Proof"
              title="More than a checkout screen."
              copy="The old page was right to show depth up front. This keeps that detail, but connects it to the bigger platform story."
            />
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
              <div className="hidden bg-neutral-100 text-sm font-bold text-neutral-800 md:grid md:grid-cols-[1.1fr_1fr_1fr]">
                <div className="p-4">Capability</div>
                <div className="border-l border-neutral-200 p-4 text-emerald-700">SanoPOS</div>
                <div className="border-l border-neutral-200 p-4">Typical Alternative</div>
              </div>
              {POS_COMPARISON.map(([feature, sano, other]) => (
                <div key={feature} className="grid border-t border-neutral-200 text-sm md:grid-cols-[1.1fr_1fr_1fr]">
                  <div className="bg-neutral-50 p-4 font-bold text-neutral-900 md:bg-white">{feature}</div>
                  <div className="p-4 font-semibold text-emerald-700 md:border-l md:border-neutral-200">{sano}</div>
                  <div className="p-4 text-neutral-500 md:border-l md:border-neutral-200">{other}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-emerald-600 py-8 text-white">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-5 px-5 text-center sm:grid-cols-4 lg:grid-cols-7">
            {STATS.map(([value, label]) => (
              <div key={label}>
                <div className="text-2xl font-extrabold">{value}</div>
                <div className="mt-1 text-xs font-semibold text-emerald-50">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="business-types" className="bg-[#f2f7f5] py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-5">
            <SectionHeading
              eyebrow="Built Around How Your Business Works"
              title="Choose your starting point."
              copy="Pick a business type during setup. SanoPOS changes the language, workflows, reports, and customer tools around the way you operate."
            />
            <div className="mb-8 grid gap-5 lg:grid-cols-3">
              <img className="h-64 w-full rounded-lg object-cover" src={BUSINESS_IMAGES.restaurant} alt="Restaurant tables ready for service" />
              <img className="h-64 w-full rounded-lg object-cover" src={BUSINESS_IMAGES.clinic} alt="Clinic workspace for appointments and patient records" />
              <img className="h-64 w-full rounded-lg object-cover" src={BUSINESS_IMAGES.hospitality} alt="Hotel lobby for room and guest operations" />
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {BUSINESS_TYPES.map((item) => <IconCard key={item.title} {...item} />)}
            </div>
          </div>
        </section>

        <section className="bg-white py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-5">
            <SectionHeading
              eyebrow="Included"
              title="Enough depth to run the day, not just record the sale."
              copy="This is the detailed proof from the old page, shortened so buyers can scan it without losing the new positioning."
            />
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURE_GROUPS.map((group) => <CheckListGroup key={group.title} {...group} />)}
            </div>
          </div>
        </section>

        <section id="customers" className="bg-white py-16 md:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div>
              <p className="mb-3 text-sm font-bold text-emerald-700">Customer-Facing Tools</p>
              <h2 className="text-3xl font-extrabold leading-tight text-neutral-950 md:text-4xl">
                Give customers more than a receipt.
              </h2>
              <p className="mt-4 text-base leading-7 text-neutral-600">
                Booking links, online receipts, loyalty balances, order history, restaurant menus, storefront pages, and customer portals can grow from the same operating system.
              </p>
              <ul className="mt-8 space-y-3">
                {CUSTOMER_TOOLS.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-6 text-neutral-700">
                    <Check size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-[#f3f8fb] p-6 shadow-sm">
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  [Smartphone, "Portal", "Invoices, appointments, orders, loyalty, wallet, and profile."],
                  [CalendarDays, "Booking", "Public service booking links for customers."],
                  [ChefHat, "Menu", "Restaurant menu links for QR and online browsing."],
                  [CreditCard, "Receipts", "Print, email, share, or open receipts online."],
                ].map(([Icon, title, copy]) => (
                  <div key={title} className="rounded-lg bg-white p-4 shadow-sm">
                    <Icon size={22} className="mb-3 text-emerald-700" />
                    <h3 className="mb-1 font-bold text-neutral-950">{title}</h3>
                    <p className="text-sm leading-6 text-neutral-600">{copy}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-neutral-950 py-16 text-white md:py-20">
          <div className="mx-auto max-w-7xl px-5">
            <SectionHeading
              eyebrow="Ready For Pakistan's Daily Reality"
              title="Keep selling. Stay compliant. Know what happened."
              copy="Internet outages, branch stock, tax reporting, cash shifts, and staff activity should not live in separate notebooks."
              inverse
            />
            <div className="grid gap-5 md:grid-cols-4">
              {[
                [WifiOff, "Offline Sale Queue", "Ring up sales when the internet drops. Sync when back online."],
                [ShieldCheck, "FBR Digital Invoicing", "Real-time posting with retry handling and tax-ready records."],
                [ClipboardList, "Audit Trail", "Know who created, changed, approved, sold, refunded, or adjusted stock."],
                [Landmark, "Finance View", "P&L, cash flow, ledgers, payables, receivables, and owner reporting."],
              ].map(([Icon, title, copy]) => (
                <article key={title} className="rounded-lg border border-white/15 bg-white/8 p-5">
                  <Icon size={24} className="mb-4 text-emerald-300" />
                  <h3 className="mb-2 font-bold text-white">{title}</h3>
                  <p className="text-sm leading-6 text-white/72">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#f2f7f5] py-16 md:py-20">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHeading
              eyebrow="A Better Alternative"
              title="Replace fragile workarounds with connected operations."
              copy="The value is not a longer feature list. The value is seeing the business clearly because the work happens in one system."
            />
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
              <div className="hidden bg-neutral-100 text-sm font-bold text-neutral-800 md:grid md:grid-cols-2">
                <div className="p-4">What businesses often use</div>
                <div className="border-l border-neutral-200 p-4">SanoPOS</div>
              </div>
              {COMPARISON.map(([oldWay, sanoWay]) => (
                <div key={oldWay} className="grid border-t border-neutral-200 text-sm md:grid-cols-2">
                  <div className="bg-neutral-50 p-4 text-xs font-bold uppercase text-neutral-500 md:bg-white md:text-sm md:font-normal md:normal-case">
                    {oldWay}
                  </div>
                  <div className="p-4 font-semibold text-neutral-900 md:border-l md:border-neutral-200">{sanoWay}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="bg-white py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-5">
            <SectionHeading
              eyebrow="Grow Outlet By Outlet"
              title="Start free. Upgrade when the business is ready."
              copy="Run one outlet first, then add more branches as paid add-ons whenever the business grows."
            />
            <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
              <article className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
                <h3 className="text-xl font-extrabold text-neutral-950">Free</h3>
                <p className="mt-2 text-sm text-neutral-600">For trying SanoPOS or running a very small business.</p>
                <p className="mt-6 text-3xl font-extrabold text-neutral-950">Free forever</p>
                <ul className="mt-6 space-y-3 text-sm text-neutral-700">
                  {["1 outlet", "3 employees", "100 products", "All features included", "Setup in minutes"].map((item) => (
                    <li key={item} className="flex gap-2"><Check size={17} className="text-emerald-600" /> {item}</li>
                  ))}
                </ul>
                <a href="/signup?plan=free" className="mt-8 inline-flex w-full justify-center rounded-lg bg-neutral-100 px-4 py-3 text-sm font-bold text-neutral-900 hover:bg-neutral-200">
                  Start Free
                </a>
              </article>
              <article className="rounded-lg border-2 border-emerald-600 bg-white p-6 shadow-sm">
                <h3 className="text-xl font-extrabold text-neutral-950">Pro</h3>
                <p className="mt-2 text-sm text-neutral-600">For growing businesses that need more capacity.</p>
                <p className="mt-6 text-3xl font-extrabold text-neutral-950">PKR 8,000 <span className="text-sm font-semibold text-neutral-500">/month per outlet</span></p>
                <ul className="mt-6 space-y-3 text-sm text-neutral-700">
                  {["Extra outlets available as paid add-ons", "Unlimited employees", "Unlimited products", "All integrations", "Priority support", "45-day free trial"].map((item) => (
                    <li key={item} className="flex gap-2"><Check size={17} className="text-emerald-600" /> {item}</li>
                  ))}
                </ul>
                <a href="/signup?plan=pro" className="mt-8 inline-flex w-full justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">
                  Start Free Trial
                </a>
              </article>
            </div>
          </div>
        </section>

        <section className="border-t border-neutral-200 bg-[#f3f8fb] py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-5">
            <SectionHeading
              eyebrow="From Signup To First Sale"
              title="A guided start for every business type."
            />
            <div className="grid gap-4 md:grid-cols-5">
              {STEPS.map((step, index) => (
                <article key={step} className="rounded-lg bg-white p-5 shadow-sm">
                  <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
                    {index + 1}
                  </div>
                  <p className="text-sm font-bold leading-6 text-neutral-900">{step}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-neutral-950 px-5 py-16 text-center text-white">
          <div className="mx-auto max-w-3xl">
            <BriefcaseBusiness size={36} className="mx-auto mb-5 text-emerald-300" />
            <h2 className="text-3xl font-extrabold leading-tight md:text-4xl">
              Your business should not feel bigger than your system.
            </h2>
            <p className="mt-4 text-base leading-7 text-white/76">
              SanoPOS keeps sales, stock, staff, customers, and branches connected as you grow.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <a href="/signup?plan=free" className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700">
                Start Free
              </a>
              <a href="/login" className="rounded-lg border border-white/35 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">
                Sign In
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
