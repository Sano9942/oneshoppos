import { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  Lock,
  Store,
  User,
  ShoppingCart,
  Package,
  Users,
  BarChart3,
  Clock,
  Building2,
  Heart,
  RefreshCw,
  ChevronDown,
  ArrowRight,
  Zap,
  Shield,
  Wifi,
  WifiOff,
  ArrowUp,
  Check,
  Star,
  Tablet,
  Laptop,
  Smartphone,
  Printer,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { API_BASE, IS_MULTI_TENANT } from "../config";
import { useCurrency } from "../contexts/CurrencyContext";

/* ─── Forgot Password Modal ───────────────────────────────── */

function ForgotPasswordModal({ storeCode, onClose }) {
  const [username, setUsername] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    try {
      await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          store_code: IS_MULTI_TENANT ? storeCode : undefined,
        }),
      });
    } catch { /* always show success */ }
    setSubmitted(true);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Reset Password</h3>
        {submitted ? (
          <>
            <p className="text-sm text-slate-600 mb-4">
              If an account with that username exists and has an email address, a reset link has been sent.
            </p>
            <button
              onClick={onClose}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 font-semibold transition-colors cursor-pointer"
            >
              Back to Login
            </button>
          </>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <p className="text-sm text-slate-600">
              Enter your username and we'll send a reset link to your email.
            </p>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
              placeholder="Username"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-slate-200 rounded-lg py-2.5 font-medium text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !username.trim()}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 font-semibold disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loading ? "Sending..." : "Send Reset Link"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ─── Login Form (extracted from Login.jsx logic) ─────────── */

function LoginForm() {
  const { login } = useAuth();
  const { refresh: refreshCurrency } = useCurrency();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [storeCode, setStoreCode] = useState(searchParams.get("store") || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const canSubmit =
    username.trim() && password.trim() && (!IS_MULTI_TENANT || storeCode.trim());

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      await login(
        username.trim(),
        password.trim(),
        IS_MULTI_TENANT ? storeCode.trim() : undefined,
      );
      refreshCurrency();
      navigate("/context-select", { replace: true });
    } catch (err) {
      setError(err.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <form className="space-y-4" onSubmit={onSubmit} id="login-form">
      {IS_MULTI_TENANT && (
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Store Code
          </span>
          <div className="mt-1.5 relative">
            <Store
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={storeCode}
              onChange={(e) => setStoreCode(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
              placeholder="e.g. aceshardware"
              autoFocus
            />
          </div>
        </label>
      )}

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Username
        </span>
        <div className="mt-1.5 relative">
          <User
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
            placeholder="Employee name"
            autoFocus={!IS_MULTI_TENANT}
          />
        </div>
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Password
        </span>
        <div className="mt-1.5 relative">
          <Lock
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
            placeholder="Enter your password"
          />
        </div>
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowForgot(true)}
          className="text-xs text-emerald-600 hover:text-emerald-700 font-medium cursor-pointer"
        >
          Forgot password?
        </button>
      </div>

      {error && <p className="text-sm text-red-600 font-medium">{error}</p>}

      <button
        type="submit"
        disabled={loading || !canSubmit}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 font-semibold disabled:opacity-50 transition-colors cursor-pointer"
      >
        {loading ? "Signing in..." : "Sign In"}
      </button>
    </form>
    {showForgot && (
      <ForgotPasswordModal
        storeCode={storeCode}
        onClose={() => setShowForgot(false)}
      />
    )}
    </>
  );
}

/* ─── Features Data ───────────────────────────────────────── */

const FEATURES = [
  {
    icon: Shield,
    title: "FBR Digital Invoicing",
    desc: "Real-time posting to FBR with auto-retry queue. HS code inheritance per category. No manual exports.",
  },
  {
    icon: BarChart3,
    title: "67+ Report Tabs",
    desc: "Sales, inventory, purchasing, accounting, HR reports — 3x more analytics than competitors.",
  },
  {
    icon: Heart,
    title: "Customer Loyalty & Wallet",
    desc: "Built-in points earning and redemption, customer wallet deposits. No paid add-on needed.",
  },
  {
    icon: Building2,
    title: "Multi-Outlet Management",
    desc: "Stock transfers between branches. Per-outlet reporting. Add outlets as your business grows.",
  },
  {
    icon: WifiOff,
    title: "Offline Sale Queuing",
    desc: "Sales queue locally during power or internet outages. Auto-sync on reconnect. Never lose a transaction.",
  },
  {
    icon: Printer,
    title: "Thermal + Cloud Printing",
    desc: "ESC/POS thermal printers and TCP/IP network printing. Works with standard retail hardware.",
  },
  {
    icon: Users,
    title: "HR, Attendance & Kiosk",
    desc: "PIN clock-in/out with breaks, leave management, payroll export. Built into the POS — not separate software.",
  },
  {
    icon: RefreshCw,
    title: "Shopify + WooCommerce Sync",
    desc: "Import products, sync inventory, manage orders from one dashboard. Multi-channel from day one.",
  },
];

/* ─── Pain Points ────────────────────────────────────────── */

const PAIN_POINTS = [
  {
    icon: WifiOff,
    title: "Power Goes Out? Keep Selling.",
    problem: "Load shedding and internet outages kill most POS systems.",
    solution: "Offline sale queuing — ring up sales without internet, auto-sync when connection returns. Never lose a sale, even during load shedding.",
  },
  {
    icon: Shield,
    title: "FBR Compliant, Out of the Box",
    problem: "Manual CSV exports, risk of penalties, no real-time posting.",
    solution: "Real-time FBR digital invoicing with auto-retry queue. Category-level HS codes. Built in — not a paid add-on.",
  },
  {
    icon: Zap,
    title: "All Features. Every Plan.",
    problem: "Competitors charge PKR 5,000-15,000/month and lock features behind paid tiers.",
    solution: "Every feature is included on every plan — Free and Pro. No feature locks. No surprises. Pro adds unlimited capacity at PKR 8,000/mo per outlet.",
  },
];

/* ─── Device Compatibility ───────────────────────────────── */

const DEVICES = [
  { icon: Tablet, title: "Tablet", desc: "Install as app (PWA) — touch-friendly POS layout" },
  { icon: Laptop, title: "Laptop / Desktop", desc: "Full dashboard with F1-F10 keyboard shortcuts" },
  { icon: Smartphone, title: "Phone", desc: "Check reports and manage inventory on the go" },
];

/* ─── How It Works Steps ──────────────────────────────────── */

const STEPS = [
  {
    num: "01",
    title: "Sign Up Free",
    desc: "Create your store in under a minute. No sales call, no credit card required.",
  },
  {
    num: "02",
    title: "Setup Wizard",
    desc: "Configure your store name, currency, timezone, and create your first outlet and admin account.",
  },
  {
    num: "03",
    title: "Start Selling",
    desc: "Add products, open a cash shift, and ring up your first sale. You're live.",
  },
];

/* ─── Plans Data ─────────────────────────────────────────── */

const PLANS = [
  {
    name: "Free",
    price: "Free forever",
    desc: "Perfect for trying out SanoPOS",
    features: ["1 outlet", "3 employees", "100 products", "POS + inventory", "Basic reports"],
    cta: "Start Free",
    plan: "free",
    highlight: false,
  },
  {
    name: "Pro",
    price: "PKR 8,000",
    period: "/month per outlet",
    desc: "Everything you need to run your business",
    features: ["Unlimited outlets", "Unlimited employees", "Unlimited products", "All integrations", "Priority support", "45-day free trial"],
    cta: "Start Free Trial",
    plan: "pro",
    highlight: true,
  },
];

/* ─── Setup Guide Data ────────────────────────────────────── */

const SETUP_GUIDE = [
  {
    q: "What happens after your store is provisioned?",
    a: "You'll receive a setup link with a one-time token. Open the link, and it takes you straight to the Setup Wizard. The token can only be used once — once setup is complete, the link expires and you log in normally with your admin credentials.",
  },
  {
    q: "Completing the Setup Wizard",
    a: "The wizard walks you through four steps: (1) Store identity — your store name and contact info. (2) Time & currency — select your timezone and currency with cash denominations. (3) First outlet — name and address of your first store location. (4) Admin account — create your admin username and PIN. After this, you're dropped into the dashboard ready to go.",
  },
  {
    q: "Adding your first products",
    a: "Go to Inventory from the sidebar. Click 'Add Product' and fill in the name, SKU, price, and opening stock. You can also import from Shopify if you already have an online store. Products support variants (size, color), barcode scanning, and category assignment.",
  },
  {
    q: "Inviting employees and setting permissions",
    a: "Navigate to Employees in the sidebar. Add each employee with a username and PIN. Assign them a role — roles control what they can access (POS only, inventory management, reports, full admin). Employees log in with their own PIN at the POS.",
  },
  {
    q: "Opening your first cash shift",
    a: "Go to the POS screen. You'll be prompted to open a shift before making any sales. Count your starting cash by denomination, confirm, and the shift is open. At end of day, close the shift by counting again — the system calculates any variance automatically.",
  },
];

/* ─── User Guide Data ─────────────────────────────────────── */

const USER_GUIDE = [
  {
    q: "Making a sale (POS screen)",
    a: `Open the POS from the sidebar. Search for products by name or scan a barcode. Tap a product to add it to the cart. Adjust quantity if needed. When ready, tap "Pay" — choose the payment method (cash, card, split), enter the amount tendered, and confirm. A receipt prints automatically if you have a thermal printer connected, or you can email it.`,
  },
  {
    q: "Processing returns and exchanges",
    a: "Go to Sales History, find the original sale, and tap 'Return'. Select which items are being returned and the refund method. For exchanges, process the return first, then ring up the new items as a fresh sale. The system tracks all returns linked to the original invoice.",
  },
  {
    q: "Managing inventory and stock transfers",
    a: "The Inventory page shows all products with current stock levels per outlet. Use Stock Adjustments to correct counts (damaged goods, miscounts). Use Transfers to move stock between outlets — the sending outlet's stock decreases and the receiving outlet's stock increases once confirmed.",
  },
  {
    q: "Running reports",
    a: "The Reports section has 67+ tabs organized by category: Sales (summary, detail, item-wise), Inventory (on-hand, movement, dead stock), Financial (P&L, cashflow, AP/AR), and Operations (shift summary, shrinkage). Every report supports date range filtering. Use the Dashboard for a quick overview of today's KPIs.",
  },
  {
    q: "Cash shifts and end-of-day closing",
    a: "At the end of the day, go to Cash Management and close your active shift. Count each denomination in the drawer. The system compares your count against expected totals (opening cash + sales - refunds) and flags any variance. You can add notes explaining discrepancies. The shift report is saved for auditing.",
  },
  {
    q: "Using the kiosk for attendance",
    a: "The Kiosk is a dedicated screen (accessible at /kiosk) where employees clock in and out using their PIN. It supports breaks — clock in at shift start, break out for lunch, break in when back, clock out at shift end. Managers can view attendance records in the Attendance section with hours calculated automatically.",
  },
];

/* ─── Accordion Item ──────────────────────────────────────── */

function AccordionItem({ question, answer }) {
  return (
    <details className="group border-b border-slate-200 last:border-0">
      <summary className="flex items-center justify-between cursor-pointer py-4 px-1 text-left text-[15px] font-medium text-slate-800 hover:text-emerald-700 transition-colors list-none [&::-webkit-details-marker]:hidden" style={{ color: "inherit" }}>
        <span>{question}</span>
        <ChevronDown
          size={18}
          className="shrink-0 ml-3 text-slate-400 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="pb-4 px-1 text-sm leading-relaxed text-slate-600">
        {answer}
      </div>
    </details>
  );
}

/* ─── Main Landing Page ───────────────────────────────────── */

export default function LandingPage() {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const heroRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (isBootstrapping) return null;
  if (isAuthenticated) return <Navigate to="/context-select" replace />;

  return (
    <div className="min-h-screen bg-white" style={{ scrollBehavior: "smooth" }}>
      {/* ── Sticky Nav ──────────────────────────────────── */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-white/95 backdrop-blur-sm shadow-sm border-b border-slate-100"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between px-5 py-3.5">
          <a
            href="#top"
            className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900"
          >
            <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Zap size={15} className="text-white" />
            </div>
            SanoPOS
          </a>

          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#why" className="hover:text-emerald-700 transition-colors">
              Why SanoPOS
            </a>
            <a href="#features" className="hover:text-emerald-700 transition-colors">
              Features
            </a>
            <a href="#pricing" className="hover:text-emerald-700 transition-colors">
              Pricing
            </a>
            <a href="#setup-guide" className="hover:text-emerald-700 transition-colors">
              Setup Guide
            </a>
            <a href="#user-guide" className="hover:text-emerald-700 transition-colors">
              User Guide
            </a>
            <a
              href="#top"
              className="ml-2 inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-semibold"
            >
              Sign In
              <ArrowRight size={14} />
            </a>
          </div>

          {/* Mobile: just the sign-in button */}
          <a
            href="#top"
            className="md:hidden inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-lg transition-colors text-sm font-semibold"
          >
            Sign In
          </a>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────── */}
      <section
        id="top"
        ref={heroRef}
        className="relative overflow-hidden pt-24 pb-16 md:pt-28 md:pb-24"
      >
        {/* Subtle background pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #008060 1px, transparent 0)`,
          backgroundSize: "32px 32px",
        }} />
        <div className="absolute top-0 right-0 w-150 h-150 bg-emerald-50 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl opacity-60" />

        <div className="relative max-w-6xl mx-auto px-5 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left — copy */}
          <div>
            <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6 border border-emerald-100">
              <Shield size={13} />
              FBR-compliant POS for Pakistan
            </div>

            <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 leading-tight tracking-tight">
              Pakistan's Most Complete
              <br />
              <span className="text-emerald-600">POS System</span>
            </h1>

            <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-lg">
              FBR-compliant. Works offline. All features free to start.
              Set up in 5 minutes — no sales call needed.
            </p>

            <div className="mt-8 flex flex-col gap-3">
              {[
                { icon: WifiOff, text: "Works offline — never lose a sale during load shedding" },
                { icon: Shield, text: "Real-time FBR digital invoicing — built in, not an add-on" },
                { icon: Building2, text: "Multi-outlet with stock transfers — grow at your pace" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-3 text-sm text-slate-700">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <Icon size={16} className="text-emerald-600" />
                  </div>
                  {text}
                </div>
              ))}
            </div>
          </div>

          {/* Right — login card */}
          <div className="w-full max-w-md mx-auto lg:mx-0 lg:ml-auto">
            <div className="bg-white border border-slate-200 rounded-2xl shadow-lg shadow-slate-200/50 p-7">
              <div className="mb-5 text-center">
                <h2 className="text-xl font-bold text-slate-800">
                  Sign in to your store
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {IS_MULTI_TENANT
                    ? "Enter your store code, username, and password"
                    : "Enter your username and password"}
                </p>
              </div>
              <LoginForm />
            </div>
            <p className="mt-4 text-center text-sm text-slate-500">
              Don't have an account?{" "}
              <a href="/signup" className="font-semibold text-emerald-600 hover:underline">
                Create Free Account
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* ── Pain Points ─────────────────────────────────────── */}
      <section id="why" className="py-12 md:py-16 bg-white">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Built for Pakistan's retail reality
            </h2>
            <p className="mt-3 text-slate-600 max-w-xl mx-auto">
              We solve the problems other POS systems ignore.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {PAIN_POINTS.map(({ icon: Icon, title, problem, solution }) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mb-4">
                  <Icon size={24} className="text-emerald-600" />
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-2">{title}</h3>
                <p className="text-sm text-red-600/80 font-medium mb-2">{problem}</p>
                <p className="text-sm text-slate-600 leading-relaxed">{solution}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Works on Any Device ─────────────────────────────── */}
      <section className="py-12 md:py-16 bg-slate-50">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              No special hardware. No app store.
            </h2>
            <p className="mt-3 text-slate-600 max-w-xl mx-auto">
              Just open your browser. SanoPOS works on any device you already own.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            {DEVICES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                  <Icon size={28} className="text-emerald-600" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 mb-1">{title}</h3>
                <p className="text-sm text-slate-500">{desc}</p>
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-slate-500">
            <span className="font-medium text-slate-700">Optional add-ons:</span> USB/Bluetooth barcode scanner and ESC/POS thermal printer for the full retail experience.
          </p>
        </div>
      </section>

      {/* ── Features Grid ───────────────────────────────── */}
      <section id="features" className="py-12 md:py-16 bg-slate-50">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Everything you need — nothing you don't
            </h2>
            <p className="mt-3 text-slate-600 max-w-xl mx-auto">
              From POS checkout to HR payroll, SanoPOS covers your entire retail operation in one system.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:border-slate-300 transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mb-4 group-hover:bg-emerald-100 transition-colors">
                  <Icon size={20} className="text-emerald-600" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 mb-1.5">
                  {title}
                </h3>
                <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ────────────────────────────────── */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Up and running in three steps
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 md:gap-6 relative">
            {/* Connecting line (desktop only) */}
            <div className="hidden md:block absolute top-8 left-[calc(16.67%+20px)] right-[calc(16.67%+20px)] h-px bg-slate-200" />

            {STEPS.map(({ num, title, desc }) => (
              <div key={num} className="relative text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-600 text-white text-xl font-bold mb-5 relative z-10 shadow-lg shadow-emerald-200">
                  {num}
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">
                  {title}
                </h3>
                <p className="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────── */}
      <section id="pricing" className="py-12 md:py-16 bg-slate-50">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Simple, transparent plans
            </h2>
            <p className="mt-3 text-slate-600 max-w-xl mx-auto">
              Start free and upgrade as your business grows. No hidden fees.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`relative rounded-2xl border p-6 flex flex-col ${
                  p.highlight
                    ? "border-emerald-500 bg-white shadow-lg shadow-emerald-100 ring-1 ring-emerald-500"
                    : "border-slate-200 bg-white"
                }`}
              >
                {p.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 bg-emerald-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                    <Star size={11} fill="currentColor" />
                    Recommended
                  </div>
                )}

                <div className="mb-5">
                  <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
                  <p className="text-sm text-slate-500 mt-0.5">{p.desc}</p>
                </div>

                <div className="mb-6">
                  <span className="text-3xl font-extrabold text-slate-900">{p.price}</span>
                  {p.period && <span className="text-sm text-slate-500 ml-1">{p.period}</span>}
                </div>

                {/* Features */}
                <ul className="space-y-2.5 mb-6 grow">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                      <Check size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                <a
                  href={`/signup?plan=${p.plan}`}
                  className={`block text-center py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                    p.highlight
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-800"
                  }`}
                >
                  {p.cta}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Setup Guide ─────────────────────────────────── */}
      <section id="setup-guide" className="py-12 md:py-16 bg-white">
        <div className="max-w-3xl mx-auto px-5">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-4 border border-emerald-100">
              <Zap size={13} />
              New to SanoPOS?
            </div>
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Setup Guide
            </h2>
            <p className="mt-3 text-slate-600">
              Everything you need to know after your store is provisioned.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden px-5">
            {SETUP_GUIDE.map(({ q, a }) => (
              <AccordionItem key={q} question={q} answer={a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── User Guide ──────────────────────────────────── */}
      <section id="user-guide" className="py-12 md:py-16 bg-slate-50">
        <div className="max-w-3xl mx-auto px-5">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 bg-slate-100 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-4 border border-slate-200">
              <BarChart3 size={13} />
              Day-to-day operations
            </div>
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              User Guide
            </h2>
            <p className="mt-3 text-slate-600">
              How to use each part of SanoPOS in your daily workflow.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden px-5">
            {USER_GUIDE.map(({ q, a }) => (
              <AccordionItem key={q} question={q} answer={a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="bg-slate-900 text-slate-400 py-10">
        <div className="max-w-6xl mx-auto px-5 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-white font-bold tracking-tight">
            <div className="w-6 h-6 rounded-md bg-emerald-600 flex items-center justify-center">
              <Zap size={13} className="text-white" />
            </div>
            SanoPOS
          </div>

          <div className="flex items-center gap-5 text-sm">
            <a href="#why" className="hover:text-white transition-colors">
              Why SanoPOS
            </a>
            <a href="#features" className="hover:text-white transition-colors">
              Features
            </a>
            <a href="#pricing" className="hover:text-white transition-colors">
              Pricing
            </a>
            <a href="#setup-guide" className="hover:text-white transition-colors">
              Setup Guide
            </a>
            <a href="#user-guide" className="hover:text-white transition-colors">
              User Guide
            </a>
            <a
              href="#top"
              className="hover:text-white transition-colors inline-flex items-center gap-1"
            >
              Top <ArrowUp size={13} />
            </a>
          </div>

          <p className="text-xs text-slate-500">
            &copy; {new Date().getFullYear()} SanoPOS. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
