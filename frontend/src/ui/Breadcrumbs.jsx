import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { usePreset } from "../contexts/PresetContext";

const LABELS = {
  dashboard: "Dashboard",
  "sales-history": "Sales History",
  "cash-management": "Cash Management",
  customers: "Customers",
  crm: "CRM",
  quotations: "Quotations",
  orders: "Orders",
  "parked-sales": "Parked Sales",
  holds: "Holds & Layaway",
  "cod-settlements": "COD Settlements",
  products: "Products",
  categories: "Categories",
  brands: "Brands",
  taxes: "Taxes",
  "attribute-sets": "Attribute Sets",
  promotions: "Promotions",
  "purchase-orders": "Purchase Orders",
  "stock-adjustments": "Stock Adjustments",
  transfers: "Transfers",
  "returned-stock": "Supplier Returns",
  "supplier-payables": "Supplier Payables",
  "supplier-bills": "Supplier bills",
  "reorder-alerts": "Reorder Alerts",
  "inventory-intelligence": "Inventory Intelligence",
  suppliers: "Suppliers",
  expenses: "Expenses",
  approvals: "Approvals",
  reports: "Reports",
  accounting: "Accounting",
  kiosk: "Kiosk",
  attendance: "Attendance",
  hr: "HR",
  notifications: "Notifications",
  employees: "Employees",
  outlets: "Outlets",
  "company-settings": "Company Profile",
  "shopify-integration": "Shopify",
  "barcode-templates": "Barcode Templates",
  "receipt-templates": "Receipt Templates",
  "printer-settings": "Printer Settings",
  "backup-restore": "Backup",
  administrator: "Administrator",
  "action-history": "Action History",
  "smart-collections": "Smart Collections",
  "scheduled-changes": "Scheduled Changes",
  "outlet-tax-profiles": "Outlet Tax Profiles",
  "business-modules": "Business Modules",
  commissions: "Commissions",
  tips: "Tip Pools",
  "report-builder": "Report Builder",
  "pos-layouts": "POS Layouts",
  inventory: "Inventory",
  returns: "Returns",
  profile: "My Profile",
  marketing: "Marketing",
  campaigns: "Campaigns",
  messaging: "Messaging",
  inbox: "Inbox",
  "customer-invoices": "Customer Invoices",
  subscriptions: "Subscriptions",
  pos: "POS",
  "pos/restaurant": "Restaurant POS",
  restaurant: "Restaurant",
  floor: "Floor Plan",
  checks: "Checks",
  availability: "86'd Items",
  modifiers: "Modifiers",
  kds: "KDS",
  appointments: "Appointments",
  services: "Services",
  calendar: "Calendar",
  bookings: "Bookings",
  classes: "Classes",
  timetable: "Timetable",
  members: "Member Check-In",
  projects: "Projects",
  contracts: "Contracts",
  "service-tickets": "Service Tickets",
  rentals: "Rentals",
  items: "Items",
  timeline: "Timeline",
  rooms: "Rooms",
  rates: "Rates",
  "arrivals-departures": "Arrivals / Departures",
  "treatment-plans": "Treatment Plans",
  recalls: "Recalls",
  handouts: "Handouts",
  "vaccination-card": "Vaccination Card",
  labs: "Lab Orders",
  chart: "Chart",
  "customer-groups": "Customer Groups",
  "price-book": "Price Book",
  "gift-cards": "Gift Cards",
  settings: "Settings",
  "import-from-competitor": "Import from Shopify/Square",
  "retail-risk": "Retail Risk",
};

const SKIP = ["/dashboard", "/pos", "/kiosk", "/customer-display", "/kds", "/retail/home"];

export default function Breadcrumbs() {
  const { pathname } = useLocation();
  const { labels } = usePreset();

  if (SKIP.some((p) => pathname === p || pathname === "/")) return null;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // Mirror AppLayout's nav-label translation so breadcrumbs match the page
  // headings under the restaurant preset (Customer → Guest, Product → Menu Item).
  const translate = (label) => {
    if (!label || !labels) return label;
    const customer = labels.customer || "Customer";
    const customers = labels.customers || "Customers";
    const product = labels.product || "Product";
    const products = labels.products || "Products";
    return label
      .replace(/Customers/g, customers)
      .replace(/Customer/g, customer)
      .replace(/Products/g, products)
      .replace(/Product/g, product);
  };

  return (
    <nav className="mb-3 flex items-center gap-1 text-xs text-(--ui-text-muted)">
      <Link to="/dashboard" className="hover:text-(--ui-text) transition">
        <Home size={12} />
      </Link>
      {segments.map((seg, i) => {
        const path = "/" + segments.slice(0, i + 1).join("/");
        const rawLabel = LABELS[seg] || seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const label = translate(rawLabel);
        const isLast = i === segments.length - 1;
        return (
          <span key={path} className="flex items-center gap-1">
            <ChevronRight size={10} />
            {isLast ? (
              <span className="text-(--ui-text) font-medium">{label}</span>
            ) : (
              <Link to={path} className="hover:text-(--ui-text) transition">{label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
