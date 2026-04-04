import { Suspense, lazy } from "react";
import { Route } from "react-router-dom";
import RouteLoading from "./RouteLoading";

const AdminLogin = lazy(() => import("../pages/admin/AdminLogin"));
const AdminLayout = lazy(() => import("../pages/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("../pages/admin/AdminDashboard"));
const AdminTenantList = lazy(() => import("../pages/admin/AdminTenantList"));
const AdminTenantDetail = lazy(() => import("../pages/admin/AdminTenantDetail"));
const AdminSupportTickets = lazy(() => import("../pages/admin/AdminSupportTickets"));
const AdminDeadLetters = lazy(() => import("../pages/admin/AdminDeadLetters"));
const AdminTaxRates = lazy(() => import("../pages/admin/AdminTaxRates"));
const AdminEmails = lazy(() => import("../pages/admin/AdminEmails"));
const AdminActivity = lazy(() => import("../pages/admin/AdminActivity"));

const wrap = (Component) => <Suspense fallback={<RouteLoading />}><Component /></Suspense>;

export const adminRoutes = [
  <Route key="admin-login" path="/admin/login" element={wrap(AdminLogin)} />,
  <Route key="admin" path="/admin" element={wrap(AdminLayout)}>
    <Route index element={wrap(AdminDashboard)} />
    <Route path="tenants" element={wrap(AdminTenantList)} />
    <Route path="tenants/:id" element={wrap(AdminTenantDetail)} />
    <Route path="support" element={wrap(AdminSupportTickets)} />
    <Route path="emails" element={wrap(AdminEmails)} />
    <Route path="dead-letters" element={wrap(AdminDeadLetters)} />
    <Route path="tax-rates" element={wrap(AdminTaxRates)} />
    <Route path="activity" element={wrap(AdminActivity)} />
  </Route>,
];
