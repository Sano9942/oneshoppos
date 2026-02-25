const fs = require("fs");
const path = require("path");

const API = process.env.API_BASE || "http://localhost:5000";

let pass = 0;
let fail = 0;

function logOk(name, detail = "") {
  pass += 1;
  console.log(`PASS: ${name}${detail ? ` - ${detail}` : ""}`);
}

function logFail(name, detail = "") {
  fail += 1;
  console.log(`FAIL: ${name}${detail ? ` - ${detail}` : ""}`);
}

async function request(pathname, opts = {}) {
  const url = `${API}${pathname}`;
  const init = {
    method: opts.method || "GET",
    headers: { ...(opts.headers || {}) },
  };

  if (opts.formData) {
    init.body = opts.formData;
  } else if (opts.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, status: 0, error: err.message, data: null };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log("=== Tier 4 Focused Smoke Test ===");
  console.log(`API: ${API}`);

  const health = await request("/api/health");
  if (!health.ok) {
    logFail("Server health", `status=${health.status} error=${health.error || health.data?.error || "unknown"}`);
    console.log("Tip: start backend first (cd backend && npm start)");
    process.exit(1);
  }
  logOk("Server health", `status=${health.status}`);

  let employeeId = 1;
  let authHeaders = { "x-employee-id": String(employeeId) };

  const authMe = await request("/api/auth/me", { headers: authHeaders });
  if (authMe.ok && authMe.data?.employee?.id) {
    employeeId = authMe.data.employee.id;
    authHeaders = { "x-employee-id": String(employeeId) };
    logOk("Auth context", `employee_id=${employeeId}`);
  } else {
    let loginOk = false;
    const loginCandidates = ["Admin", "Administrator", "admin", "Manager", "Cashier"];
    for (const username of loginCandidates) {
      const login = await request("/api/auth/login", {
        method: "POST",
        body: { username, pin: process.env.SMOKE_PIN || "1234" },
      });
      if (login.ok && login.data?.employee?.id) {
        employeeId = login.data.employee.id;
        authHeaders = { "x-employee-id": String(employeeId) };
        loginOk = true;
        break;
      }
    }
    if (loginOk) logOk("Auth fallback login", `employee_id=${employeeId}`);
    else logFail("Auth fallback login", "could not verify session, continuing with x-employee-id=1");
  }

  const employeesRes = await request("/api/employees", { headers: authHeaders });
  const outletsRes = await request("/api/outlets", { headers: authHeaders });
  const productsRes = await request("/api/products", { headers: authHeaders });
  const customersRes = await request("/api/customers", { headers: authHeaders });

  const employees = employeesRes.data?.employees || [];
  const outlets = outletsRes.data?.outlets || [];
  const products = productsRes.data?.products || [];
  const customers = customersRes.data?.customers || [];

  const employee = employees[0] || { id: employeeId };
  const outlet = outlets[0];
  const product = products[0];
  const customer = customers[0];

  if (employeesRes.ok) logOk("Seed fetch employees", `count=${employees.length}`); else logFail("Seed fetch employees", `status=${employeesRes.status}`);
  if (outletsRes.ok) logOk("Seed fetch outlets", `count=${outlets.length}`); else logFail("Seed fetch outlets", `status=${outletsRes.status}`);
  if (productsRes.ok) logOk("Seed fetch products", `count=${products.length}`); else logFail("Seed fetch products", `status=${productsRes.status}`);
  if (customersRes.ok) logOk("Seed fetch customers", `count=${customers.length}`); else logFail("Seed fetch customers", `status=${customersRes.status}`);

  // Notifications
  const notifCount = await request("/api/notifications/count", { headers: authHeaders });
  notifCount.ok ? logOk("GET /api/notifications/count") : logFail("GET /api/notifications/count", `status=${notifCount.status}`);

  const notifList = await request("/api/notifications", { headers: authHeaders });
  notifList.ok ? logOk("GET /api/notifications") : logFail("GET /api/notifications", `status=${notifList.status}`);

  const markAll = await request("/api/notifications/read-all", {
    method: "PUT",
    headers: authHeaders,
    body: {},
  });
  markAll.ok ? logOk("PUT /api/notifications/read-all") : logFail("PUT /api/notifications/read-all", `status=${markAll.status}`);

  const firstNotifId = notifList.data?.notifications?.[0]?.id;
  if (firstNotifId) {
    const markOne = await request(`/api/notifications/${firstNotifId}/read`, {
      method: "PUT",
      headers: authHeaders,
      body: {},
    });
    markOne.ok ? logOk("PUT /api/notifications/:id/read") : logFail("PUT /api/notifications/:id/read", `status=${markOne.status}`);
  } else {
    logOk("PUT /api/notifications/:id/read", "skipped (no existing notifications)");
  }

  // Company profile
  const cpGet = await request("/api/company-profile", { headers: authHeaders });
  cpGet.ok ? logOk("GET /api/company-profile") : logFail("GET /api/company-profile", `status=${cpGet.status}`);

  const cpBody = {
    ...(cpGet.data?.profile || {}),
    company_name: (cpGet.data?.profile?.company_name || "My Store").toString(),
  };
  const cpPut = await request("/api/company-profile", {
    method: "PUT",
    headers: authHeaders,
    body: cpBody,
  });
  cpPut.ok ? logOk("PUT /api/company-profile") : logFail("PUT /api/company-profile", `status=${cpPut.status}`);

  const fd = new FormData();
  fd.append("logo", new Blob(["tier4 smoke logo"], { type: "text/plain" }), "tier4-logo.txt");
  const cpLogo = await request("/api/company-profile/logo", {
    method: "POST",
    headers: authHeaders,
    formData: fd,
  });
  cpLogo.ok ? logOk("POST /api/company-profile/logo") : logFail("POST /api/company-profile/logo", `status=${cpLogo.status}`);

  // Accounting
  const from = "2000-01-01";
  const to = "2100-12-31";
  const pnl = await request(`/api/accounting/pnl?from=${from}&to=${to}${outlet ? `&outlet_id=${outlet.id}` : ""}`, { headers: authHeaders });
  pnl.ok ? logOk("GET /api/accounting/pnl") : logFail("GET /api/accounting/pnl", `status=${pnl.status}`);

  const cashflow = await request(`/api/accounting/cashflow?from=${from}&to=${to}`, { headers: authHeaders });
  cashflow.ok ? logOk("GET /api/accounting/cashflow") : logFail("GET /api/accounting/cashflow", `status=${cashflow.status}`);

  const ap = await request("/api/accounting/ap", { headers: authHeaders });
  ap.ok ? logOk("GET /api/accounting/ap") : logFail("GET /api/accounting/ap", `status=${ap.status}`);

  const periodsGet = await request("/api/accounting/periods", { headers: authHeaders });
  periodsGet.ok ? logOk("GET /api/accounting/periods") : logFail("GET /api/accounting/periods", `status=${periodsGet.status}`);

  const periodName = `SMOKE-PERIOD-${Date.now()}`;
  const periodPost = await request("/api/accounting/periods", {
    method: "POST",
    headers: authHeaders,
    body: { period_name: periodName, start_date: "2026-01-01", end_date: "2026-01-31" },
  });
  periodPost.ok ? logOk("POST /api/accounting/periods") : logFail("POST /api/accounting/periods", `status=${periodPost.status}`);

  if (periodPost.data?.id) {
    const periodPut = await request(`/api/accounting/periods/${periodPost.data.id}`, {
      method: "PUT",
      headers: authHeaders,
      body: { status: "closed", notes: "smoke" },
    });
    periodPut.ok ? logOk("PUT /api/accounting/periods/:id") : logFail("PUT /api/accounting/periods/:id", `status=${periodPut.status}`);
  } else {
    logFail("PUT /api/accounting/periods/:id", "skipped (period create failed)");
  }

  // HR
  const leaveGet = await request("/api/hr/leave", { headers: authHeaders });
  leaveGet.ok ? logOk("GET /api/hr/leave") : logFail("GET /api/hr/leave", `status=${leaveGet.status}`);

  let leaveId = null;
  if (employee?.id) {
    const leavePost = await request("/api/hr/leave", {
      method: "POST",
      headers: authHeaders,
      body: {
        employee_id: employee.id,
        type: "annual",
        start_date: "2026-03-01",
        end_date: "2026-03-01",
        days: 1,
        reason: "Tier 4 smoke",
      },
    });
    leavePost.ok ? logOk("POST /api/hr/leave") : logFail("POST /api/hr/leave", `status=${leavePost.status}`);
    leaveId = leavePost.data?.id || null;
  } else {
    logFail("POST /api/hr/leave", "skipped (no employee)\n");
  }

  if (leaveId) {
    const leaveStatus = await request(`/api/hr/leave/${leaveId}/status`, {
      method: "PUT",
      headers: authHeaders,
      body: { status: "approved" },
    });
    leaveStatus.ok ? logOk("PUT /api/hr/leave/:id/status") : logFail("PUT /api/hr/leave/:id/status", `status=${leaveStatus.status}`);
  } else {
    logFail("PUT /api/hr/leave/:id/status", "skipped (leave create failed)");
  }

  const prGet = await request("/api/hr/payroll/periods", { headers: authHeaders });
  prGet.ok ? logOk("GET /api/hr/payroll/periods") : logFail("GET /api/hr/payroll/periods", `status=${prGet.status}`);

  const payrollName = `SMOKE-PAYROLL-${Date.now()}`;
  const prPost = await request("/api/hr/payroll/periods", {
    method: "POST",
    headers: authHeaders,
    body: { period_name: payrollName, start_date: "2026-02-01", end_date: "2026-02-28" },
  });
  prPost.ok ? logOk("POST /api/hr/payroll/periods") : logFail("POST /api/hr/payroll/periods", `status=${prPost.status}`);

  if (prPost.data?.id) {
    const prGen = await request(`/api/hr/payroll/periods/${prPost.data.id}/generate`, {
      method: "POST",
      headers: authHeaders,
      body: {},
    });
    prGen.ok ? logOk("POST /api/hr/payroll/periods/:id/generate") : logFail("POST /api/hr/payroll/periods/:id/generate", `status=${prGen.status}`);

    const prLines = await request(`/api/hr/payroll/periods/${prPost.data.id}/lines`, { headers: authHeaders });
    prLines.ok ? logOk("GET /api/hr/payroll/periods/:id/lines") : logFail("GET /api/hr/payroll/periods/:id/lines", `status=${prLines.status}`);
  } else {
    logFail("POST /api/hr/payroll/periods/:id/generate", "skipped (period create failed)");
    logFail("GET /api/hr/payroll/periods/:id/lines", "skipped (period create failed)");
  }

  // CRM
  const leadsGet = await request("/api/crm/leads", { headers: authHeaders });
  leadsGet.ok ? logOk("GET /api/crm/leads") : logFail("GET /api/crm/leads", `status=${leadsGet.status}`);

  const leadName = `SMOKE-LEAD-${Date.now()}`;
  const leadPost = await request("/api/crm/leads", {
    method: "POST",
    headers: authHeaders,
    body: {
      name: leadName,
      company: "Smoke Inc",
      phone: "0000000000",
      email: "smoke@example.com",
      source: "smoke-test",
      priority: "medium",
      stage: "new",
      expected_value: 0,
      assigned_to: employee?.id || null,
      notes: "smoke",
    },
  });
  leadPost.ok ? logOk("POST /api/crm/leads") : logFail("POST /api/crm/leads", `status=${leadPost.status}`);

  const leadId = leadPost.data?.id;
  if (leadId) {
    const leadPut = await request(`/api/crm/leads/${leadId}`, {
      method: "PUT",
      headers: authHeaders,
      body: { stage: "qualified", notes: "updated by smoke" },
    });
    leadPut.ok ? logOk("PUT /api/crm/leads/:id") : logFail("PUT /api/crm/leads/:id", `status=${leadPut.status}`);

    const actPost = await request(`/api/crm/leads/${leadId}/activities`, {
      method: "POST",
      headers: authHeaders,
      body: { type: "note", description: "smoke activity", employee_id: employee?.id || null },
    });
    actPost.ok ? logOk("POST /api/crm/leads/:id/activities") : logFail("POST /api/crm/leads/:id/activities", `status=${actPost.status}`);

    const actGet = await request(`/api/crm/leads/${leadId}/activities`, { headers: authHeaders });
    actGet.ok ? logOk("GET /api/crm/leads/:id/activities") : logFail("GET /api/crm/leads/:id/activities", `status=${actGet.status}`);

    const leadConvert = await request(`/api/crm/leads/${leadId}/convert`, {
      method: "POST",
      headers: authHeaders,
      body: {},
    });
    leadConvert.ok ? logOk("POST /api/crm/leads/:id/convert") : logFail("POST /api/crm/leads/:id/convert", `status=${leadConvert.status}`);

    const convertedCustomerId = leadConvert.data?.customer_id || customer?.id || null;

    // Quotations
    const qGet = await request("/api/quotations", { headers: authHeaders });
    qGet.ok ? logOk("GET /api/quotations") : logFail("GET /api/quotations", `status=${qGet.status}`);

    if (outlet?.id && product?.id) {
      const qPost = await request("/api/quotations", {
        method: "POST",
        headers: authHeaders,
        body: {
          lead_id: leadId,
          customer_id: convertedCustomerId,
          outlet_id: outlet.id,
          employee_id: employee?.id || null,
          items: [{ product_id: product.id, quantity: 0, unit_price: 0, tax_rate: 0 }],
          discount_type: "fixed",
          discount_amount: 0,
          valid_until: "2026-12-31",
          notes: "smoke quote A",
        },
      });
      qPost.ok ? logOk("POST /api/quotations") : logFail("POST /api/quotations", `status=${qPost.status}`);

      const qId = qPost.data?.id;
      if (qId) {
        const qDetail = await request(`/api/quotations/${qId}`, { headers: authHeaders });
        qDetail.ok ? logOk("GET /api/quotations/:id") : logFail("GET /api/quotations/:id", `status=${qDetail.status}`);

        const qPut = await request(`/api/quotations/${qId}`, {
          method: "PUT",
          headers: authHeaders,
          body: {
            lead_id: leadId,
            customer_id: convertedCustomerId,
            outlet_id: outlet.id,
            employee_id: employee?.id || null,
            items: [{ product_id: product.id, quantity: 0, unit_price: 0, tax_rate: 0 }],
            discount_type: "fixed",
            discount_amount: 0,
            valid_until: "2026-12-31",
            notes: "smoke quote A updated",
          },
        });
        qPut.ok ? logOk("PUT /api/quotations/:id") : logFail("PUT /api/quotations/:id", `status=${qPut.status}`);

        const qStatus = await request(`/api/quotations/${qId}/status`, {
          method: "PUT",
          headers: authHeaders,
          body: { status: "accepted" },
        });
        qStatus.ok ? logOk("PUT /api/quotations/:id/status") : logFail("PUT /api/quotations/:id/status", `status=${qStatus.status}`);

        const qConvert = await request(`/api/quotations/${qId}/convert`, {
          method: "POST",
          headers: authHeaders,
          body: { payment_method: "Cash", employee_id: employee?.id || null },
        });
        qConvert.ok ? logOk("POST /api/quotations/:id/convert") : logFail("POST /api/quotations/:id/convert", `status=${qConvert.status}`);
      } else {
        logFail("GET /api/quotations/:id", "skipped (create failed)");
        logFail("PUT /api/quotations/:id", "skipped (create failed)");
        logFail("PUT /api/quotations/:id/status", "skipped (create failed)");
        logFail("POST /api/quotations/:id/convert", "skipped (create failed)");
      }

      const qDraft = await request("/api/quotations", {
        method: "POST",
        headers: authHeaders,
        body: {
          lead_id: leadId,
          customer_id: convertedCustomerId,
          outlet_id: outlet.id,
          employee_id: employee?.id || null,
          items: [{ product_id: product.id, quantity: 0, unit_price: 0, tax_rate: 0 }],
          notes: "smoke quote delete",
        },
      });
      qDraft.ok ? logOk("POST /api/quotations (draft for delete)") : logFail("POST /api/quotations (draft for delete)", `status=${qDraft.status}`);

      if (qDraft.data?.id) {
        const qDel = await request(`/api/quotations/${qDraft.data.id}`, {
          method: "DELETE",
          headers: authHeaders,
        });
        qDel.ok ? logOk("DELETE /api/quotations/:id") : logFail("DELETE /api/quotations/:id", `status=${qDel.status}`);
      } else {
        logFail("DELETE /api/quotations/:id", "skipped (draft create failed)");
      }
    } else {
      logFail("Quotations endpoints", "skipped (need at least one outlet and product)");
    }

    const cleanupLead = await request("/api/crm/leads", {
      method: "POST",
      headers: authHeaders,
      body: {
        name: `SMOKE-DELETE-${Date.now()}`,
        company: "Cleanup Co",
        phone: "0000000000",
        email: "cleanup@example.com",
      },
    });
    if (cleanupLead.ok && cleanupLead.data?.id) {
      const leadDelete = await request(`/api/crm/leads/${cleanupLead.data.id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      leadDelete.ok
        ? logOk("DELETE /api/crm/leads/:id")
        : logFail("DELETE /api/crm/leads/:id", `status=${leadDelete.status}`);
    } else {
      logFail("DELETE /api/crm/leads/:id", "skipped (could not create isolated lead)");
    }
  } else {
    logFail("CRM/Quotation flow", "skipped due to lead create failure");
  }

  // Frontend route smoke (declaration presence)
  const appPath = path.resolve(__dirname, "../frontend/src/App.jsx");
  const layoutPath = path.resolve(__dirname, "../frontend/src/components/AppLayout.jsx");
  const appText = fs.readFileSync(appPath, "utf8");
  const layoutText = fs.readFileSync(layoutPath, "utf8");

  const requiredRoutes = [
    "/accounting",
    "/crm",
    "/quotations",
    "/hr/leave",
    "/hr/payroll",
    "/company-settings",
  ];

  for (const route of requiredRoutes) {
    if (appText.includes(`path=\"${route}\"`) || appText.includes(`path="${route}"`)) {
      logOk(`Frontend route declared ${route}`);
    } else {
      logFail(`Frontend route declared ${route}`);
    }
  }

  const requiredNav = [
    "/accounting",
    "/crm",
    "/quotations",
    "/hr/leave",
    "/hr/payroll",
    "/company-settings",
  ];
  for (const navPath of requiredNav) {
    if (layoutText.includes(navPath)) logOk(`Frontend nav includes ${navPath}`);
    else logFail(`Frontend nav includes ${navPath}`);
  }

  console.log("=== Summary ===");
  console.log(`Passed: ${pass}`);
  console.log(`Failed: ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
