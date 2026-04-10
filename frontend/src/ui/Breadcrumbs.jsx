import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

const LABELS = {
  dashboard: "Dashboard",
  "sales-history": "Sales History",
  "cash-management": "Cash Management",
  customers: "Customers",
  crm: "CRM",
  quotations: "Quotations",
  orders: "Orders",
  "parked-sales": "Parked Sales",
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
  "returned-stock": "Returned Stock",
  "supplier-payables": "Supplier Payables",
  "reorder-alerts": "Reorder Alerts",
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
  commissions: "Commissions",
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
  restaurant: "Restaurant",
  floor: "Floor Plan",
  checks: "Checks",
  kds: "KDS",
  kiosk: "Kiosk",
  appointments: "Appointments",
  services: "Services",
  calendar: "Calendar",
  bookings: "Bookings",
  projects: "Projects",
  contracts: "Contracts",
};

const SKIP = ["/dashboard", "/pos", "/kiosk", "/customer-display"];

export default function Breadcrumbs() {
  const { pathname } = useLocation();

  if (SKIP.some((p) => pathname === p || pathname === "/")) return null;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav className="mb-3 flex items-center gap-1 text-xs text-(--ui-text-muted)">
      <Link to="/dashboard" className="hover:text-(--ui-text) transition">
        <Home size={12} />
      </Link>
      {segments.map((seg, i) => {
        const path = "/" + segments.slice(0, i + 1).join("/");
        const label = LABELS[seg] || seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
