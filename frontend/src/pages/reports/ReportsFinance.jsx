import React, { useCallback, useEffect, useState } from "react";
import { Wallet, Receipt, Truck, Calculator, BadgePercent, FileSpreadsheet } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmt,
  fmtDate,
  fmtDateTime,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";

function buildFinanceParams(filters) {
  return new URLSearchParams({
    date_from: filters.dateFrom || "",
    date_to: filters.dateTo || "",
    time_from: filters.timeFrom || "",
    time_to: filters.timeTo || "",
    outlet_id: filters.outletId || "",
    employee_id: filters.employeeId || "",
    category_id: filters.categoryId || "",
    brand_id: filters.brandId || "",
    supplier_id: filters.supplierId || "",
    search: filters.search || "",
  });
}

function SummaryGrid({ items }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {item.label}
          </p>
          <p className={`mt-2 text-2xl font-bold ${item.tone || "text-slate-900"}`}>
            {item.value}
          </p>
          {item.note ? (
            <p className="mt-1 text-xs text-slate-400">{item.note}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function EmptyFinanceState({ title, body }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <h3 className="text-sm font-bold text-slate-700">{title}</h3>
      <p className="mt-2 text-sm text-slate-500">{body}</p>
    </div>
  );
}

export function SettlementOverviewTab({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/api/reports/settlement-overview?${buildFinanceParams(filters)}`,
      );
      const json = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || {};
  const paymentMix = data?.payment_mix || [];
  const aging = data?.supplier_aging || [];
  const outstandingInvoices = data?.outstanding_invoices || [];
  const recentPayments = data?.recent_supplier_payments || [];

  return (
    <div className="space-y-4">
      <SummaryGrid
        items={[
          { label: "Inflows", value: fmt(summary.total_inflows) },
          { label: "Outflows", value: fmt(summary.total_outflows), tone: "text-rose-700" },
          { label: "Net Cashflow", value: fmt(summary.net_cashflow), tone: "text-emerald-700" },
          {
            label: "Supplier Outstanding",
            value: fmt(summary.supplier_outstanding),
            note: `${summary.suppliers_with_due || 0} suppliers with due`,
          },
          {
            label: "Customer Receivable",
            value: fmt(summary.customer_receivable),
          },
          {
            label: "Open Supplier Invoices",
            value: Number(summary.open_supplier_invoices || 0),
          },
          { label: "Expenses", value: fmt(summary.expenses) },
          { label: "Supplier Payments", value: fmt(summary.supplier_payments) },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell
          title="Finance Payment Mix"
          subtitle="Tender mix from sales in the selected reporting scope"
          action={
            <ExportButton
              onClick={() =>
                exportCSV(
                  "finance_payment_mix.csv",
                  [
                    { header: "Method", key: "payment_method" },
                    { header: "Sales", key: "sale_count" },
                    { header: "Total", key: "total" },
                  ],
                  paymentMix,
                )
              }
            />
          }
        >
          <TableShell
            cols={["Method", "Sales", "Total"]}
            loading={loading}
            empty={!paymentMix.length}
          >
            {paymentMix.map((row) => (
              <tr key={row.payment_method} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                  {row.payment_method}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {Number(row.sale_count || 0)}
                </td>
                <td className="px-4 py-3 text-sm font-bold text-slate-900">
                  {fmt(row.total)}
                </td>
              </tr>
            ))}
          </TableShell>
        </CardShell>

        <CardShell
          title="Supplier Aging"
          subtitle="Top suppliers by outstanding balance"
          action={
            <ExportButton
              onClick={() =>
                exportCSV(
                  "supplier_aging_summary.csv",
                  [
                    { header: "Supplier", key: "supplier_name" },
                    { header: "Invoices", key: "invoice_count" },
                    { header: "Invoiced", key: "total_invoiced" },
                    { header: "Paid", key: "total_paid" },
                    { header: "Due", key: "total_due" },
                  ],
                  aging,
                )
              }
            />
          }
        >
          <TableShell
            cols={["Supplier", "Invoices", "Invoiced", "Paid", "Due"]}
            loading={loading}
            empty={!aging.length}
          >
            {aging.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                  {row.supplier_name}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {Number(row.invoice_count || 0)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {fmt(row.total_invoiced)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.total_paid)}</td>
                <td className="px-4 py-3 text-sm font-bold text-rose-700">
                  {fmt(row.total_due)}
                </td>
              </tr>
            ))}
          </TableShell>
        </CardShell>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell
          title="Outstanding Supplier Invoices"
          subtitle="Most exposed invoices by due amount"
        >
          <TableShell
            cols={["Invoice", "Supplier", "Outlet", "Due Date", "Outstanding"]}
            loading={loading}
            empty={!outstandingInvoices.length}
          >
            {outstandingInvoices.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="text-sm font-bold text-slate-800">{row.invoice_number}</div>
                  <div className="text-[11px] text-slate-400">{row.status}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{row.supplier_name}</td>
                <td className="px-4 py-3 text-sm text-slate-500">{row.outlet_name}</td>
                <td className="px-4 py-3 text-sm text-slate-500">{fmtDate(row.due_date)}</td>
                <td className="px-4 py-3 text-sm font-bold text-rose-700">
                  {fmt(row.outstanding)}
                </td>
              </tr>
            ))}
          </TableShell>
        </CardShell>

        <CardShell
          title="Recent Supplier Payments"
          subtitle="Latest supplier settlements in the reporting range"
        >
          <TableShell
            cols={["Paid At", "Supplier", "Invoice", "Method", "Amount"]}
            loading={loading}
            empty={!recentPayments.length}
          >
            {recentPayments.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-500">
                  {fmtDateTime(row.paid_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-800">{row.supplier_name}</div>
                  <div className="text-[11px] text-slate-400">{row.outlet_name}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{row.invoice_number}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{row.payment_method}</td>
                <td className="px-4 py-3 text-sm font-bold text-emerald-700">
                  {fmt(row.amount)}
                </td>
              </tr>
            ))}
          </TableShell>
        </CardShell>
      </div>
    </div>
  );
}

export function PayablesReceivablesTab({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/api/reports/payables-receivables?${buildFinanceParams(filters)}`,
      );
      const json = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || {};
  const supplierAp = data?.supplier_ap || [];
  const customerAr = data?.customer_ar || [];

  return (
    <div className="space-y-4">
      <SummaryGrid
        items={[
          {
            label: "Supplier Outstanding",
            value: fmt(summary.supplier_outstanding),
            note: `${summary.supplier_invoice_count || 0} invoices`,
          },
          {
            label: "Customer Receivable",
            value: fmt(summary.customer_receivable),
            note: `${summary.customer_count || 0} customers`,
          },
        ]}
      />

      <CardShell
        title="Supplier Payables"
        subtitle="Invoice-by-invoice payable exposure with outlet context where available"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "supplier_payables.csv",
                [
                  { header: "Supplier", key: "supplier_name" },
                  { header: "Invoice", key: "invoice_number" },
                  { header: "Invoice Date", key: "invoice_date" },
                  { header: "Due Date", key: "due_date" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Amount", key: "amount" },
                  { header: "Paid", key: "paid_amount" },
                  { header: "Outstanding", key: "outstanding" },
                  { header: "Status", key: "status" },
                ],
                supplierAp,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Supplier", "Invoice", "Outlet", "Amount", "Paid", "Outstanding", "Status"]}
          loading={loading}
          empty={!supplierAp.length}
        >
          {supplierAp.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                {row.supplier_name}
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-mono text-slate-800">{row.invoice_number}</div>
                <div className="text-[11px] text-slate-400">
                  {fmtDate(row.invoice_date)} | {Number(row.days_open || 0)} days
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-slate-500">{row.outlet_name}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.amount)}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.paid_amount)}</td>
              <td className="px-4 py-3 text-sm font-bold text-rose-700">
                {fmt(row.outstanding)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">{row.status}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>

      <CardShell
        title="Customer Receivables"
        subtitle="Customers carrying open credit balances"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "customer_receivables.csv",
                [
                  { header: "Customer", key: "name" },
                  { header: "Phone", key: "mobile" },
                  { header: "Credit Balance", key: "credit_balance" },
                  { header: "Total Purchases", key: "total_purchases" },
                  { header: "Last Purchase", key: "last_purchase" },
                ],
                customerAr,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Customer", "Phone", "Credit Balance", "Total Purchases", "Last Purchase"]}
          loading={loading}
          empty={!customerAr.length}
        >
          {customerAr.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.name}</td>
              <td className="px-4 py-3 text-sm text-slate-500">{row.mobile || "-"}</td>
              <td className="px-4 py-3 text-sm font-bold text-amber-700">
                {fmt(row.credit_balance)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {fmt(row.total_purchases)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-500">
                {fmtDateTime(row.last_purchase)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function SupplierPaymentsInvoicesTab({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/api/reports/supplier-payments-invoices?${buildFinanceParams(filters)}`,
      );
      const json = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || {};
  const aging = data?.aging || [];
  const invoices = data?.invoices || [];
  const payments = data?.payments || [];

  return (
    <div className="space-y-4">
      <SummaryGrid
        items={[
          {
            label: "Suppliers With Due",
            value: Number(summary.suppliers_with_due || 0),
          },
          {
            label: "Total Due",
            value: fmt(summary.total_due),
            tone: "text-rose-700",
          },
          {
            label: "Open Invoices",
            value: Number(summary.open_invoice_count || 0),
          },
          {
            label: "Payments In Scope",
            value: fmt(summary.payments_total),
            tone: "text-emerald-700",
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell
          title="Supplier Aging"
          subtitle="Outstanding payable concentration by supplier"
        >
          <TableShell
            cols={["Supplier", "Phone", "Invoices", "Invoiced", "Paid", "Due"]}
            loading={loading}
            empty={!aging.length}
          >
            {aging.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                  {row.supplier_name}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">{row.phone || "-"}</td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {Number(row.invoice_count || 0)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {fmt(row.total_invoiced)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.total_paid)}</td>
                <td className="px-4 py-3 text-sm font-bold text-rose-700">
                  {fmt(row.total_due)}
                </td>
              </tr>
            ))}
          </TableShell>
        </CardShell>

        <CardShell
          title="Recent Supplier Payments"
          subtitle="Latest supplier payment journal in the selected scope"
        >
          <TableShell
            cols={["Paid At", "Supplier", "Invoice", "Method", "Amount"]}
            loading={loading}
            empty={!payments.length}
          >
            {payments.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-500">
                  {fmtDateTime(row.paid_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-800">{row.supplier_name}</div>
                  <div className="text-[11px] text-slate-400">{row.outlet_name}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{row.invoice_number}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{row.payment_method}</td>
                <td className="px-4 py-3 text-sm font-bold text-emerald-700">
                  {fmt(row.amount)}
                </td>
              </tr>
            ))}
          </TableShell>
        </CardShell>
      </div>

      <CardShell
        title="Supplier Invoice Register"
        subtitle="Invoice-level visibility over payment progress and due dates"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "supplier_invoices_register.csv",
                [
                  { header: "Supplier", key: "supplier_name" },
                  { header: "Invoice", key: "invoice_number" },
                  { header: "Created", key: "created_at" },
                  { header: "Due Date", key: "due_date" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Amount", key: "amount" },
                  { header: "Paid", key: "amount_paid" },
                  { header: "Due", key: "amount_due" },
                  { header: "Payment Count", key: "payment_count" },
                  { header: "Status", key: "status" },
                ],
                invoices,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Supplier", "Invoice", "Outlet", "Amount", "Paid", "Due", "Status"]}
          loading={loading}
          empty={!invoices.length}
        >
          {invoices.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                {row.supplier_name}
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-mono text-slate-800">{row.invoice_number}</div>
                <div className="text-[11px] text-slate-400">
                  {fmtDate(row.created_at)} | due {fmtDate(row.due_date)}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-slate-500">{row.outlet_name}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.amount)}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.amount_paid)}</td>
              <td className="px-4 py-3 text-sm font-bold text-rose-700">
                {fmt(row.amount_due)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">{row.status}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function FinancePaymentMixTab({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/api/reports/finance-payment-mix?${buildFinanceParams(filters)}`,
      );
      const json = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || {};
  const saleMix = data?.sale_mix || [];
  const supplierMix = data?.supplier_payment_mix || [];
  const dailyInflows = data?.daily_inflows || [];

  if (!loading && !saleMix.length && !supplierMix.length && !dailyInflows.length) {
    return (
      <EmptyFinanceState
        title="No payment mix found"
        body="Adjust the current date, outlet, or supplier filters to review finance-side payment distribution."
      />
    );
  }

  return (
    <div className="space-y-4">
      <SummaryGrid
        items={[
          { label: "Sales Inflows", value: fmt(summary.total_inflows) },
          {
            label: "Supplier Payment Outflows",
            value: fmt(summary.total_supplier_outflows),
            tone: "text-rose-700",
          },
          {
            label: "Primary Tender",
            value: summary.primary_method || "-",
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell
          title="Sales Payment Mix"
          subtitle="Tender contribution from customer payments"
          action={
            <ExportButton
              onClick={() =>
                exportCSV(
                  "sales_payment_mix_finance.csv",
                  [
                    { header: "Method", key: "payment_method" },
                    { header: "Sales", key: "sale_count" },
                    { header: "Total", key: "total" },
                    { header: "Share %", key: "share_pct" },
                  ],
                  saleMix,
                )
              }
            />
          }
        >
          <TableShell
            cols={["Method", "Sales", "Total", "Share %"]}
            loading={loading}
            empty={!saleMix.length}
          >
            {saleMix.map((row) => (
              <tr key={row.payment_method} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                  {row.payment_method}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {Number(row.sale_count || 0)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.total)}</td>
                <td className="px-4 py-3 text-sm font-bold text-slate-900">
                  {Number(row.share_pct || 0).toFixed(2)}%
                </td>
              </tr>
            ))}
          </TableShell>
        </CardShell>

        <CardShell
          title="Supplier Payment Methods"
          subtitle="How supplier settlements are being paid"
        >
          <TableShell
            cols={["Method", "Payments", "Total"]}
            loading={loading}
            empty={!supplierMix.length}
          >
            {supplierMix.map((row) => (
              <tr key={row.payment_method} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                  {row.payment_method}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {Number(row.payment_count || 0)}
                </td>
                <td className="px-4 py-3 text-sm font-bold text-rose-700">
                  {fmt(row.total)}
                </td>
              </tr>
            ))}
          </TableShell>
        </CardShell>
      </div>

      <CardShell
        title="Daily Inflows"
        subtitle="Date-wise inflow totals for reconciliation and finance review"
      >
        <TableShell
          cols={["Business Date", "Sales", "Total"]}
          loading={loading}
          empty={!dailyInflows.length}
        >
          {dailyInflows.map((row) => (
            <tr key={row.business_date} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                {fmtDate(row.business_date)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {Number(row.sale_count || 0)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">
                {fmt(row.total)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function GSTOutputTab({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [taxMode, setTaxMode] = useState("gst");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildFinanceParams(filters);
      params.set("tax_mode", taxMode);
      const res = await fetch(`${API}/api/reports/gst-output?${params}`);
      const json = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters, taxMode]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || {};
  const summaryByTax = data?.summary_by_tax || [];
  const rows = data?.rows || [];

  return (
    <div className="space-y-4">
      <div className="flex w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 lg:w-fit">
        {[
          ["gst", "GST Only"],
          ["all", "All Tax Types"],
          ["no_tax", "No Tax"],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTaxMode(value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${taxMode === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <SummaryGrid
        items={[
          { label: "Line Count", value: Number(summary.line_count || 0) },
          { label: "Sales Incl. GST", value: fmt(summary.taxable_inclusive) },
          { label: "Sales Excl. GST", value: fmt(summary.taxable_exclusive) },
          { label: "Output GST", value: fmt(summary.gst_amount), tone: "text-emerald-700" },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell
          title="GST Output Summary"
          subtitle="Tax-type summary of sales-side output GST in the selected scope"
          action={
            <ExportButton
              onClick={() =>
                exportCSV(
                  "gst_output_summary.csv",
                  [
                    { header: "Tax Name", key: "tax_name" },
                    { header: "Tax Rate", key: "tax_rate" },
                    { header: "Lines", key: "line_count" },
                    { header: "Quantity", key: "quantity" },
                    { header: "Sales Incl. GST", key: "taxable_inclusive" },
                    { header: "Sales Excl. GST", key: "taxable_exclusive" },
                    { header: "Output GST", key: "gst_amount" },
                  ],
                  summaryByTax,
                )
              }
            />
          }
        >
          <TableShell
            cols={["Tax Type", "Rate", "Lines", "Sales Incl.", "Sales Excl.", "Output GST"]}
            loading={loading}
            empty={!summaryByTax.length}
          >
            {summaryByTax.map((row) => (
              <tr key={`${row.tax_name}-${row.tax_rate}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.tax_name}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{Number(row.tax_rate || 0).toFixed(2)}%</td>
                <td className="px-4 py-3 text-sm text-slate-600">{Number(row.line_count || 0)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.taxable_inclusive)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.taxable_exclusive)}</td>
                <td className="px-4 py-3 text-sm font-bold text-emerald-700">{fmt(row.gst_amount)}</td>
              </tr>
            ))}
          </TableShell>
        </CardShell>

        <CardShell
          title="GST Output Register"
          subtitle="Sale-line tax register with inclusive, exclusive, and GST amounts"
          action={
            <ExportButton
              onClick={() =>
                exportCSV(
                  "gst_output_register.csv",
                  [
                    { header: "Sale ID", key: "sale_id" },
                    { header: "Timestamp", key: "timestamp" },
                    { header: "Outlet", key: "outlet_name" },
                    { header: "Employee", key: "employee_name" },
                    { header: "Product", key: "product_name" },
                    { header: "Barcode", key: "barcode" },
                    { header: "Category", key: "category" },
                    { header: "Brand", key: "brand" },
                    { header: "Supplier", key: "supplier" },
                    { header: "Tax Name", key: "tax_name" },
                    { header: "Tax Rate", key: "tax_rate" },
                    { header: "Quantity", key: "quantity" },
                    { header: "Line Incl. GST", key: "line_total_inclusive" },
                    { header: "Line Excl. GST", key: "line_total_exclusive" },
                    { header: "GST Amount", key: "gst_amount" },
                  ],
                  rows,
                )
              }
            />
          }
        >
          <TableShell
            cols={["Timestamp", "Product", "Outlet / Staff", "Tax Type", "Line Incl.", "GST Amount"]}
            loading={loading}
            empty={!rows.length}
            emptyIcon={BadgePercent}
          >
            {rows.map((row, index) => (
              <tr key={`${row.sale_id}-${row.product_id}-${index}`} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-800">#{row.sale_id}</div>
                  <div className="text-[11px] text-slate-400">{fmtDateTime(row.timestamp)}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-800">{row.product_name}</div>
                  <div className="font-mono text-[11px] text-slate-400">{row.barcode || "No barcode"}</div>
                  <div className="text-[11px] text-slate-400">{row.category} | {row.brand}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm text-slate-700">{row.outlet_name}</div>
                  <div className="text-[11px] text-slate-400">{row.employee_name}</div>
                  <div className="text-[11px] text-slate-400">{row.supplier}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-800">{row.tax_name}</div>
                  <div className="text-[11px] text-slate-400">{Number(row.tax_rate || 0).toFixed(2)}% | Qty {row.quantity}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-800">{fmt(row.line_total_inclusive)}</div>
                  <div className="text-[11px] text-slate-400">Excl: {fmt(row.line_total_exclusive)}</div>
                </td>
                <td className="px-4 py-3 text-sm font-bold text-emerald-700">{fmt(row.gst_amount)}</td>
              </tr>
            ))}
          </TableShell>
        </CardShell>
      </div>
    </div>
  );
}

export function GSTTypeSummaryTab({ filters }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/reports/gst-type-summary?${buildFinanceParams(filters)}`);
      const json = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || {};
  const rows = data?.rows || [];

  return (
    <div className="space-y-4">
      <SummaryGrid
        items={[
          { label: "Sales Incl. GST", value: fmt(summary.sales_inclusive) },
          { label: "Output GST", value: fmt(summary.output_tax), tone: "text-emerald-700" },
          { label: "Input GST Received", value: fmt(summary.received_input_tax), tone: "text-amber-700" },
          { label: "Net GST Position", value: fmt(summary.net_tax_payable), tone: "text-slate-900" },
        ]}
      />

      <CardShell
        title="GST Type Summary"
        subtitle="Sales output GST against ordered and received purchase-side input GST by tax type"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "gst_type_summary.csv",
                [
                  { header: "Tax Name", key: "tax_name" },
                  { header: "Tax Rate", key: "tax_rate" },
                  { header: "Sales Incl. GST", key: "sales_inclusive" },
                  { header: "Sales Excl. GST", key: "sales_exclusive" },
                  { header: "Output GST", key: "output_tax" },
                  { header: "Ordered Purchase Value", key: "ordered_purchase_value" },
                  { header: "Ordered Input GST", key: "ordered_input_tax" },
                  { header: "Received Purchase Value", key: "received_purchase_value" },
                  { header: "Received Input GST", key: "received_input_tax" },
                  { header: "Net GST Payable", key: "net_tax_payable" },
                ],
                rows,
              )
            }
          />
        }
        >
          <TableShell
            cols={["Tax Type", "Rate", "Sales Incl.", "Output GST", "Input GST Rec.", "Net Position"]}
            loading={loading}
            empty={!rows.length}
            emptyIcon={FileSpreadsheet}
        >
          {rows.map((row) => (
            <tr key={`${row.tax_name}-${row.tax_rate}`} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">{row.tax_name}</div>
                <div className="text-[11px] text-slate-400">Ordered input {fmt(row.ordered_input_tax)}</div>
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">{Number(row.tax_rate || 0).toFixed(2)}%</td>
              <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.sales_inclusive)}</td>
              <td className="px-4 py-3 text-sm font-bold text-emerald-700">{fmt(row.output_tax)}</td>
              <td className="px-4 py-3 text-sm font-semibold text-amber-700">{fmt(row.received_input_tax)}</td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.net_tax_payable)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export const FINANCE_REPORT_ICONS = {
  settlement: Wallet,
  payables: Receipt,
  supplier: Truck,
  mix: Calculator,
};
