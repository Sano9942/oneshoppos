// One Toy Store F9: receive a supplier bill without a purchase order.
// (b) pick the supplier, upload the bill's PDF(s) / photo(s), every line is
//     read and checked (qty × rate = amount, lines vs the printed total);
// (c1) each line matched to our toy(s) and checked on screen: pieces received,
//     split packs, cost per piece, our price, the total written on the bill.
// (c2) Save: stock in at the branch, cost = this bill's, the bill onto the
//     supplier's account (Not received / sent back / extra pieces handled),
//     the files kept, Paid now (cash from the till, cheque, bank transfer).
// (d) new toys (code from 31000, category, Brand / Non-brand, price rules) and
//     after saving the list of toys that need a new price tag.
// (f) drafts: "Save as draft" keeps the check screen and the files and changes
//     nothing (no stock, no supplier money); Drafts lists them with who started
//     them; Open carries on, Save bill finishes the same bill.
// (f) Bills saved today, each with Undo (the whole bill: stock, cost, price,
//     money back) while nothing from it has gone out; later = correct it.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
import { Badge, Button, ConfirmDialog, Input, Modal, ModalFooter, PageShell, SectionCard, Select } from "../../ui/primitives";
import CheckLines from "./supplierBill/CheckLines";
import { billSummary, lineFromRead, savePayload } from "./supplierBill/billMath";
import { brandChoices } from "./supplierBill/priceRules";

// The labels list on its own page, for the 5-digit price-tag machine.
function printLabels(saved) {
  const w = window.open("", "_blank");
  if (!w) return;
  const d = w.document;
  const el = (tag, text, style) => {
    const e = d.createElement(tag);
    if (text != null) e.textContent = String(text);
    if (style) e.setAttribute("style", style);
    return e;
  };
  d.title = "Price tags";
  d.body.setAttribute("style", "font:14px sans-serif");
  d.body.appendChild(el("h3", `Price tags: ${saved.supplier} bill ${saved.bill_number || saved.id}`));
  const table = el("table", null, "border-collapse:collapse");
  const cell = "border-bottom:1px solid #ccc;padding:4px 8px;text-align:left";
  const head = el("tr");
  for (const h of ["Code", "Toy", "Price", ""]) head.appendChild(el("th", h, cell));
  table.appendChild(head);
  for (const l of saved.labels) {
    const tr = el("tr");
    tr.appendChild(el("td", l.sku, `${cell};font-family:monospace;font-size:16px`));
    tr.appendChild(el("td", l.name, cell));
    tr.appendChild(el("td", Number(l.price).toLocaleString(), `${cell};text-align:right;font-weight:bold`));
    tr.appendChild(el("td", l.is_new ? "new toy" : `was ${Number(l.old_price).toLocaleString()}`, cell));
    table.appendChild(tr);
  }
  d.body.appendChild(table);
  w.print();
}

export default function ReceiveSupplierBillRedesign() {
  const { fmt } = useCurrency();
  const { success } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [outletId, setOutletId] = useState("");
  const [paidNow, setPaidNow] = useState({ method: "", amount: "", reference: "" });
  const [saved, setSaved] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [supplierId, setSupplierId] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // Step (f): earlier saved bills of this supplier with the same bill number.
  const [sameNumber, setSameNumber] = useState([]);
  const [askSameNumber, setAskSameNumber] = useState(false);
  // Step (f): drafts.
  const [draftId, setDraftId] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [throwAway, setThrowAway] = useState(null);
  // Step (f): today's bills and Undo.
  const [todays, setTodays] = useState([]);
  const [undoing, setUndoing] = useState(null);
  const [undoReason, setUndoReason] = useState("");
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState("");
  const [result, setResult] = useState(null);
  const [lines, setLines] = useState([]);
  const [header, setHeader] = useState({ bill_number: "", bill_date: "", written_total: "", differs: false, differs_note: "", account_amount: "" });

  useEffect(() => {
    api.get("/api/suppliers")
      .then((d) => setSuppliers((d.suppliers || d || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))))
      .catch(() => {});
    api.get("/api/outlets")
      .then((d) => {
        const list = (d.outlets || []).filter((o) => !o.is_van);
        setOutlets(list);
        if (list.length) setOutletId((cur) => cur || String(list[0].id));
      })
      .catch(() => {});
    // A new toy goes in a bottom-level category (same rule as Add Product).
    api.get("/api/categories")
      .then((d) => setCategories((d.categories || []).filter((c) => c.is_leaf)
        .sort((a, b) => String(a.path_label || a.name).localeCompare(String(b.path_label || b.name)))))
      .catch(() => {});
    api.get("/api/brands").then((d) => setBrands(brandChoices(d.brands || []))).catch(() => setBrands(brandChoices([])));
    loadDrafts();
    loadTodays();
  }, []);

  function loadDrafts() {
    api.get("/api/supplier-bills/drafts").then((d) => setDrafts(d.drafts || [])).catch(() => {});
  }
  function loadTodays() {
    api.get("/api/supplier-bills/today").then((d) => setTodays(d.bills || [])).catch(() => {});
  }

  const askUndo = (b) => {
    setUndoing(b);
    setUndoReason("");
    setUndoError("");
  };
  const doUndo = async () => {
    setUndoBusy(true);
    setUndoError("");
    try {
      const d = await api.post(`/api/supplier-bills/${undoing.id}/undo`, { reason: undoReason });
      success(`Bill ${undoing.bill_number || ""} undone${d.paid_kept ? `: ${fmt(d.paid_kept)} paid stays on the supplier's account` : ""}`);
      if (saved && saved.id === undoing.id) setSaved(null);
      setUndoing(null);
      loadTodays();
    } catch (e) {
      setUndoError(e.body?.error || e.message || "Could not undo the bill");
    } finally {
      setUndoBusy(false);
    }
  };

  const match = async (sid, readResult) => {
    if (!sid || !readResult?.lines?.length) {
      setLines([]);
      return;
    }
    setBusy("Matching toys…");
    try {
      const d = await api.post("/api/supplier-bills/match", {
        supplier_id: Number(sid),
        lines: readResult.lines.map((l, i) => ({ key: String(i), supplier_code: l.supplier_code, barcode: l.barcode, description: l.description })),
      });
      setLines(readResult.lines.map((l, i) => lineFromRead(l, d.lines[i])));
    } catch (e) {
      setError(e.body?.error || e.message || "Could not match the toys");
    } finally {
      setBusy("");
    }
  };

  // F9 (e): useAi = read photos / scans with the AI (costs money, so only on request).
  const read = async (useAi = false) => {
    if (!files.length) return;
    setBusy(useAi ? "Reading with AI…" : "Reading…");
    setError("");
    setSaved(null);
    setResult(null);
    setLines([]);
    setDraftId(null); // new files = a new bill
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      if (supplierId) fd.append("supplier_id", supplierId);
      if (useAi) fd.append("use_ai", "1");
      const res = await api.upload("/api/supplier-bills/read", fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read the bill");
      setResult(data);
      const printed = data.printed?.total ?? data.printed?.subtotal;
      setHeader({
        bill_number: data.bill_number || "",
        bill_date: data.bill_date || "",
        written_total: printed != null ? String(printed) : "",
        differs: false,
        differs_note: "",
        account_amount: printed != null ? String(printed) : "",
      });
      setPaidNow({ method: "", amount: "", reference: "" });
      setBusy("");
      await match(supplierId, data);
    } catch (e) {
      setError(e.body?.error || e.message || "Could not read the bill");
      setBusy("");
    }
  };

  const chooseSupplier = (sid) => {
    setSupplierId(sid);
    if (result) match(sid, result);
  };

  const billDiscount = Number(result?.printed?.discount) || 0;
  const discountRatio = result?.lines_total ? billDiscount / result.lines_total : 0;
  // Before the lines are matched (no supplier yet), total the lines as read.
  const summary = useMemo(
    () => billSummary(lines.length ? lines : (result?.lines || []).map((l) => lineFromRead(l)), header.written_total, billDiscount),
    [lines, result, header.written_total, billDiscount],
  );
  const totalOk = summary.total_matches || (header.differs && header.differs_note.trim());
  const allReady = lines.length > 0 && summary.ready === lines.length;
  const canSave = allReady && totalOk && outletId && supplierId && !busy;
  const supplierName = suppliers.find((x) => String(x.id) === String(supplierId))?.name || "";

  // Same supplier + same bill number already saved → warn (owner B: allowed,
  // a supplier reuses "Bill No 01" on different dates).
  const billNo = header.bill_number.trim();
  useEffect(() => {
    if (!supplierId || !billNo) {
      setSameNumber([]);
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      api.get(`/api/supplier-bills/same-number?supplier_id=${encodeURIComponent(supplierId)}&bill_number=${encodeURIComponent(billNo)}`)
        .then((d) => { if (live) setSameNumber(d.bills || []); })
        .catch(() => { if (live) setSameNumber([]); });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [supplierId, billNo]);

  const save = async (sameNumberOk = false) => {
    if (sameNumber.length && !sameNumberOk) {
      setAskSameNumber(true);
      return;
    }
    setAskSameNumber(false);
    setBusy("Saving…");
    setError("");
    try {
      const fd = new FormData();
      fd.append("payload", JSON.stringify({
        ...savePayload({ supplierId, outletId, header, result, lines, paidNow, supplierName, billDiscountRatio: discountRatio }),
        same_number_ok: !!sameNumberOk,
        draft_id: draftId || undefined,
      }));
      // A draft's files are already kept with it.
      if (!draftId) for (const f of files) fd.append("files", f);
      const res = await api.upload("/api/supplier-bills", fd);
      const data = await res.json();
      if (res.status === 409 && data.code === "SAME_BILL_NUMBER") {
        setSameNumber(data.bills || []);
        setAskSameNumber(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Could not save the bill");
      const pieces = lines.reduce((a, l) => a + (l.is_new
        ? (Number(l.received) || 0) * Math.max(1, Number(l.split_into) || 1)
        : l.toys.reduce((b, t) => b + (Number(t.qty) || 0), 0)), 0);
      setSaved({ ...data.bill, pieces, supplier: supplierName, labels: data.labels || [] });
      success(`Bill ${data.bill.bill_number || ""} saved`);
      setResult(null);
      setSameNumber([]);
      setLines([]);
      setFiles([]);
      setFileKey((k) => k + 1);
      if (draftId) loadDrafts();
      setDraftId(null);
      loadTodays();
    } catch (e) {
      setError(e.body?.error || e.message || "Could not save the bill");
    } finally {
      setBusy("");
    }
  };

  // Step (f): keep the check screen as a draft. Changes nothing until Save bill.
  const saveDraft = async () => {
    setBusy("Saving draft…");
    setError("");
    try {
      const fd = new FormData();
      fd.append("payload", JSON.stringify({
        draft_id: draftId || undefined,
        supplier_id: Number(supplierId),
        outlet_id: Number(outletId) || null,
        bill_number: header.bill_number,
        bill_date: header.bill_date,
        state: { header, result, lines, paidNow },
      }));
      if (!draftId) for (const f of files) fd.append("files", f);
      const res = await api.upload("/api/supplier-bills/drafts", fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the draft");
      setDraftId(data.draft.id);
      success("Draft saved: nothing changes until you press Save bill");
      loadDrafts();
    } catch (e) {
      setError(e.body?.error || e.message || "Could not save the draft");
    } finally {
      setBusy("");
    }
  };

  const openDraft = async (id) => {
    setBusy("Opening draft…");
    setError("");
    try {
      const { draft } = await api.get(`/api/supplier-bills/drafts/${id}`);
      const st = draft.state || {};
      setSaved(null);
      setFiles([]);
      setFileKey((k) => k + 1);
      setSupplierId(String(draft.supplier_id));
      if (draft.outlet_id) setOutletId(String(draft.outlet_id));
      setResult(st.result
        ? { ...st.result, files: draft.files.map((f) => ({ ...f, kind: f.content_type === "application/pdf" ? "pdf" : "image", already: null })) }
        : null);
      setLines(st.lines || []);
      setHeader({ bill_number: "", bill_date: "", written_total: "", differs: false, differs_note: "", account_amount: "", ...(st.header || {}) });
      setPaidNow(st.paidNow || { method: "", amount: "", reference: "" });
      setDraftId(draft.id);
    } catch (e) {
      setError(e.body?.error || e.message || "Could not open the draft");
    } finally {
      setBusy("");
    }
  };

  const discardDraft = async () => {
    const d = throwAway;
    setThrowAway(null);
    try {
      await api.del(`/api/supplier-bills/drafts/${d.id}`);
      if (d.id === draftId) {
        setDraftId(null);
        setResult(null);
        setLines([]);
      }
      loadDrafts();
    } catch (e) {
      setError(e.body?.error || e.message || "Could not throw the draft away");
    }
  };

  return (
    <PageShell
      title="Receive supplier bill"
      subtitle="Upload the supplier's bill, check every line, then save."
    >
      <SectionCard className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
            Supplier
            <Select className="mt-1 w-full" value={supplierId} onChange={(e) => chooseSupplier(e.target.value)} aria-label="Supplier">
              <option value="">Choose the supplier…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
          <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
            Bill file(s)
            <Input
              key={fileKey}
              className="mt-1"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              aria-label="Bill files"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          <Button tone="primary" onClick={() => read()} disabled={!files.length || !!busy}>
            {busy || "Read bill"}
          </Button>
        </div>
        {error ? <p className="mt-3 text-sm text-(--ui-danger-fg)">{error}</p> : null}
      </SectionCard>

      {todays.length ? (
        <SectionCard className="mb-4 p-4">
          <h2 className="mb-2 text-sm font-semibold">Bills saved today ({todays.filter((b) => b.status === "saved").length})</h2>
          <table className="w-full text-sm" data-testid="f9-today">
            <thead className="text-left text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="py-1 pr-3">Supplier</th><th className="py-1 pr-3">Bill</th><th className="py-1 pr-3 text-right">Amount</th>
                <th className="py-1 pr-3">Lines</th><th className="py-1 pr-3">Saved</th><th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {todays.map((b) => (
                <tr key={b.id} className="border-t border-(--ui-border)">
                  <td className="py-1 pr-3">{b.supplier_name}</td>
                  <td className="py-1 pr-3">{b.bill_number || "(no number)"}{b.bill_date ? ` · ${b.bill_date}` : ""}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmt(Number(b.amount) || 0)}</td>
                  <td className="py-1 pr-3 tabular-nums">{b.lines}</td>
                  <td className="py-1 pr-3">
                    {new Date(b.saved_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    {b.saved_by_name ? ` · ${b.saved_by_name}` : ""}
                  </td>
                  <td className="py-1 text-right">
                    {b.status === "undone" ? (
                      <span className="text-(--ui-text-muted)">
                        <Badge tone="warning">Undone</Badge> {b.undone_by_name ? `by ${b.undone_by_name}: ` : ""}{b.undo_reason}
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => askUndo(b)} disabled={!!busy}>Undo</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      ) : null}

      {drafts.length ? (
        <SectionCard className="mb-4 p-4">
          <h2 className="mb-2 text-sm font-semibold">Drafts ({drafts.length}): not saved yet, nothing changed</h2>
          <table className="w-full text-sm" data-testid="f9-drafts">
            <thead className="text-left text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="py-1 pr-3">Supplier</th><th className="py-1 pr-3">Bill</th><th className="py-1 pr-3">Lines</th>
                <th className="py-1 pr-3">Started by</th><th className="py-1 pr-3">Last changed</th><th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id} className="border-t border-(--ui-border)">
                  <td className="py-1 pr-3">{d.supplier_name}</td>
                  <td className="py-1 pr-3">
                    {d.bill_number || "(no number)"}{d.bill_date ? ` · ${d.bill_date}` : ""}
                    {d.id === draftId ? <> <Badge>Open now</Badge></> : null}
                  </td>
                  <td className="py-1 pr-3 tabular-nums">{d.lines} · {d.files} file{d.files === 1 ? "" : "s"}</td>
                  <td className="py-1 pr-3">{d.started_by_name || "—"}</td>
                  <td className="py-1 pr-3">
                    {new Date(d.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right">
                    <Button size="sm" onClick={() => openDraft(d.id)} disabled={!!busy}>Open</Button>{" "}
                    <Button size="sm" tone="danger" onClick={() => setThrowAway(d)} disabled={!!busy}>Throw away</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      ) : null}

      {saved ? (
        <SectionCard className="mb-4 p-4 text-sm">
          <b>Saved:</b> {saved.supplier} bill {saved.bill_number || `#${saved.id}`} · {saved.pieces} pieces into stock ·
          {" "}bill {fmt(Number(saved.lines_total) || 0)} on the supplier&apos;s account
          {saved.paid_now_method ? ` · paid now ${fmt(Number(saved.paid_now_amount) || 0)}` : ""}.
          {saved.labels.length ? (
            <div className="mt-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <b>Price tags needed ({saved.labels.length}):</b>
                <span className="text-(--ui-text-muted)">
                  {[[saved.labels.filter((l) => l.is_new).length, "new toy"], [saved.labels.filter((l) => !l.is_new).length, "new price"]]
                    .filter(([n]) => n).map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`).join(" · ")}
                </span>
                <div className="flex-1" />
                <Button size="sm" onClick={() => printLabels(saved)}>Print this list</Button>
                <Link className="text-sm underline" to="/barcode-templates">Labels to reprint</Link>
              </div>
              <table className="w-full text-sm" data-testid="f9-labels">
                <thead className="text-left text-xs uppercase text-(--ui-text-muted)">
                  <tr><th className="py-1 pr-3">Code</th><th className="py-1 pr-3">Toy</th><th className="py-1 pr-3 text-right">Price</th><th className="py-1" /></tr>
                </thead>
                <tbody>
                  {saved.labels.map((l) => (
                    <tr key={l.product_id} className="border-t border-(--ui-border)">
                      <td className="py-1 pr-3 font-mono">{l.sku}</td>
                      <td className="py-1 pr-3">{l.name}</td>
                      <td className="py-1 pr-3 text-right font-bold tabular-nums">{Number(l.price).toLocaleString()}</td>
                      <td className="py-1 text-(--ui-text-muted)">{l.is_new ? "new toy" : `was ${Number(l.old_price).toLocaleString()}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      {result ? (
        <SectionCard className="mb-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {draftId ? <Badge tone="warning">Draft</Badge> : null}
            {result.layout_label ? <Badge>{result.layout_label}</Badge> : <Badge tone="warning">Layout not recognised</Badge>}
            <span className="text-sm text-(--ui-text-muted)">
              {result.files.length} file{result.files.length === 1 ? "" : "s"} · {result.lines.length} lines read ·{" "}
              {result.lines.filter((l) => l.check === "ok").length} with qty × rate = amount
            </span>
          </div>
          {result.supplier_suggestion ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span>This looks like a bill from <b>{result.supplier_suggestion.name}</b>.</span>
              <Button size="sm" onClick={() => chooseSupplier(String(result.supplier_suggestion.id))}>Use this supplier</Button>
            </div>
          ) : null}
          {result.layout_warning && !result.supplier_suggestion ? <p className="mt-2 text-sm text-(--ui-warning-fg)">{result.layout_warning}</p> : null}
          {result.layout_warning && result.supplier_suggestion && String(result.supplier_suggestion.id) !== supplierId ? (
            <p className="mt-2 text-sm text-(--ui-warning-fg)">{result.layout_warning}</p>
          ) : null}
          {result.files.filter((f) => f.already).map((f) => (
            <p key={f.sha256} className="mt-2 text-sm text-(--ui-danger-fg)">
              {f.file_name} is already on bill {f.already.bill_number || `#${f.already.bill_id}`} of {f.already.supplier_name} ({f.already.status}): the same file can't be saved twice.
            </p>
          ))}
          {result.needs_photo_reader && result.ai_ready ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span>{result.ai_files === 1 ? "This file is" : `${result.ai_files} files are`} a photo or a scanned PDF: the AI can read {result.ai_files === 1 ? "it" : "them"}.</span>
              <Button tone="primary" onClick={() => read(true)} disabled={!!busy}>
                Read with AI · about Rs {Number(result.ai_estimate_rs || 0).toLocaleString()}
              </Button>
            </div>
          ) : null}
          {result.needs_photo_reader && !result.ai_ready ? (
            <p className="mt-2 text-sm text-(--ui-warning-fg)">The photo reader isn't set up on this server: type the bill in.</p>
          ) : null}
          {result.ai ? (
            <p className="mt-2 text-sm text-(--ui-text-muted)">
              Read by AI · Rs {Number(result.ai.cost_rs || 0).toLocaleString()} · check every line against the paper
              {result.supplier_name_read ? <> · Bill says: <b>{result.supplier_name_read}</b></> : null}
            </p>
          ) : null}
          {result.warnings.length ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-(--ui-warning-fg)">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          ) : null}
          {result.printed?.prev_balance != null ? (
            <p className="mt-2 text-sm text-(--ui-text-muted)">
              Printed on the bill: previous balance {fmt(result.printed.prev_balance)}
              {result.printed.total_balance != null ? ` · new balance ${fmt(result.printed.total_balance)}` : ""}
              {result.printed.due_date ? ` · due ${result.printed.due_date}` : ""}
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
              Bill number
              <Input className="mt-1" value={header.bill_number} onChange={(e) => setHeader((h) => ({ ...h, bill_number: e.target.value }))} />
            </label>
            <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
              Bill date
              <Input className="mt-1" type="date" value={header.bill_date} onChange={(e) => setHeader((h) => ({ ...h, bill_date: e.target.value }))} />
            </label>
            <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
              Total written on the bill
              <Input className="mt-1" type="number" value={header.written_total} onChange={(e) => setHeader((h) => ({ ...h, written_total: e.target.value }))} />
            </label>
            <div className="rounded-(--ui-radius-sm) border border-(--ui-border) px-3 py-2">
              <div className="text-xs uppercase text-(--ui-text-muted)">Lines add up to{billDiscount ? " (less discount)" : ""}</div>
              <div className={`text-lg font-bold tabular-nums ${summary.total_matches ? "text-(--ui-success-fg)" : summary.total_matches === false ? "text-(--ui-danger-fg)" : ""}`}>
                {fmt(summary.bill_total)}
              </div>
              {summary.difference ? <div className="text-xs text-(--ui-danger-fg)">Difference {fmt(summary.difference)}</div> : null}
            </div>
          </div>
          {sameNumber.length ? (
            <div className="mt-3 rounded-(--ui-radius-sm) border border-(--ui-border) px-3 py-2 text-sm text-(--ui-warning-fg)" role="alert">
              <b>{supplierName} bill {billNo} is already saved</b>
              <ul className="mt-1 list-disc pl-5">
                {sameNumber.map((b) => <li key={b.id}>{earlierBillText(b, fmt)}</li>)}
              </ul>
              <p className="mt-1">If this is a different bill with the same number, you can still save it. If it is the same bill, don&apos;t save it again.</p>
            </div>
          ) : null}
          {billDiscount ? (
            <p className="mt-2 text-sm text-(--ui-text-muted)">
              Bill discount {fmt(billDiscount)} spread over the lines by value (cost per piece already less it).
            </p>
          ) : null}
          {summary.total_matches === false ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={header.differs} onChange={(e) => setHeader((h) => ({ ...h, differs: e.target.checked }))} />
                Supplier&apos;s total is different
              </label>
              {header.differs ? (
                <>
                  <Input className="max-w-md" placeholder="Why? (e.g. they added it up wrong)" aria-label="Why the total is different"
                    value={header.differs_note} onChange={(e) => setHeader((h) => ({ ...h, differs_note: e.target.value }))} />
                  <span>On the supplier&apos;s account:</span>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="account_amount" checked={String(header.account_amount) === String(header.written_total)}
                      onChange={() => setHeader((h) => ({ ...h, account_amount: h.written_total }))} />
                    the bill&apos;s {fmt(Number(header.written_total) || 0)}
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="account_amount" checked={String(header.account_amount) === String(summary.bill_total)}
                      onChange={() => setHeader((h) => ({ ...h, account_amount: String(summary.bill_total) }))} />
                    the lines&apos; {fmt(summary.bill_total)}
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      {result && !supplierId && result.lines.length ? (
        <SectionCard className="mb-4 p-4 text-sm">Choose the supplier to match the lines to your toys.</SectionCard>
      ) : null}

      {lines.length ? (
        <>
          <CheckLines
            lines={lines}
            onChange={setLines}
            billDiscountRatio={discountRatio}
            multiFile={result?.files.length > 1}
            supplierName={supplierName}
            categories={categories}
            brands={brands}
          />
          <SectionCard className="mt-4 p-4">
            <div className="mb-3 grid gap-3 md:grid-cols-4">
              <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
                Goods went to
                <Select className="mt-1 w-full" value={outletId} onChange={(e) => setOutletId(e.target.value)} aria-label="Branch">
                  {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </label>
              <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
                Paid now
                <Select className="mt-1 w-full" value={paidNow.method} aria-label="Paid now"
                  onChange={(e) => setPaidNow((p) => ({ ...p, method: e.target.value, amount: p.amount || String(summary.bill_total) }))}>
                  <option value="">Not paid (on credit)</option>
                  <option value="till_cash">Cash from the till</option>
                  <option value="cheque">Cheque</option>
                  <option value="bank_transfer">Bank transfer</option>
                </Select>
              </label>
              {paidNow.method ? (
                <>
                  <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
                    Amount paid
                    <Input className="mt-1" type="number" value={paidNow.amount} onChange={(e) => setPaidNow((p) => ({ ...p, amount: e.target.value }))} />
                  </label>
                  {paidNow.method !== "till_cash" ? (
                    <label className="block text-xs font-semibold uppercase text-(--ui-text-muted)">
                      {paidNow.method === "cheque" ? "Cheque no. and bank" : "Reference"}
                      <Input className="mt-1" value={paidNow.reference} onChange={(e) => setPaidNow((p) => ({ ...p, reference: e.target.value }))} />
                    </label>
                  ) : (
                    <p className="self-end pb-2 text-xs text-(--ui-text-muted)">Goes on the open shift as Paid out → Pay supplier.</p>
                  )}
                </>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">
              {summary.ready} of {lines.length} lines ready
              {summary.new_toys ? ` · ${summary.new_toys} new toys` : ""}
              {summary.returns ? ` · ${summary.returns} sent back` : ""}
              {!totalOk ? " · the total doesn't match yet" : ""}
              {summary.newtoy ? ` · ${summary.newtoy} new toys to fill in (category, Brand / Non-brand)` : ""}
              {summary.new_toys ? " · new toys get the next shop codes from 31000 on Save" : ""}
            </span>
            <div className="flex-1" />
            <Button disabled={!supplierId || !!busy} onClick={saveDraft}>
              {busy === "Saving draft…" ? "Saving draft…" : "Save as draft"}
            </Button>
            <Button tone="primary" disabled={!canSave} onClick={() => save(false)}>
              {busy === "Saving…" ? "Saving…" : "Save bill"}
            </Button>
            </div>
          </SectionCard>
        </>
      ) : null}
      <ConfirmDialog
        open={askSameNumber}
        title={`Bill ${billNo} is already saved`}
        body={`${supplierName} bill ${billNo} was saved before: ${sameNumber.map((b) => earlierBillText(b, fmt)).join("; ")}. Save this one too only if it is a different bill.`}
        confirmLabel="It's a different bill, save it"
        cancelLabel="Don't save"
        onConfirm={() => save(true)}
        onCancel={() => setAskSameNumber(false)}
      />
      <Modal open={!!undoing} onClose={undoBusy ? undefined : () => setUndoing(null)} title={undoing ? `Undo ${undoing.supplier_name} bill ${undoing.bill_number || ""}?` : ""} size="sm">
        <p className="text-sm text-(--ui-text-muted)">
          Everything from this bill goes back: its pieces come out of stock (pieces sent back come in again), cost and selling
          prices go back, and the bill comes off the supplier&apos;s account. New toys made by it are removed. Money already paid
          on the spot stays on the supplier&apos;s account as a payment. Only today, and only while none of its pieces has been sold.
          Then you can upload it again.
        </p>
        <label className="mt-3 block text-xs font-semibold uppercase text-(--ui-text-muted)">
          Why?
          <Input className="mt-1" value={undoReason} onChange={(e) => setUndoReason(e.target.value)} placeholder="e.g. wrong supplier, pieces typed wrong" aria-label="Why undo" />
        </label>
        {undoError ? <p className="mt-2 text-sm text-(--ui-danger-fg)">{undoError}</p> : null}
        <ModalFooter>
          <Button onClick={() => setUndoing(null)} disabled={undoBusy}>Keep the bill</Button>
          <Button tone="danger" onClick={doUndo} disabled={undoBusy || !undoReason.trim()}>{undoBusy ? "Undoing…" : "Undo the whole bill"}</Button>
        </ModalFooter>
      </Modal>
      <ConfirmDialog
        open={!!throwAway}
        title="Throw this draft away?"
        body={throwAway
          ? `${throwAway.supplier_name} bill ${throwAway.bill_number || "(no number)"}: the checked lines and its files are removed. Nothing else changes.`
          : ""}
        confirmLabel="Throw away"
        cancelLabel="Keep it"
        destructive
        onConfirm={discardDraft}
        onCancel={() => setThrowAway(null)}
      />
    </PageShell>
  );
}

/** "dated 1 Oct 2026 · Rs 300 · 1 line · saved by Hassan" */
function earlierBillText(b, fmt) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(b.bill_date || "")
    ? new Date(`${b.bill_date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "no date";
  return [`dated ${d}`, fmt(Number(b.amount) || 0), `${b.lines} line${b.lines === 1 ? "" : "s"}`, b.saved_by_name ? `saved by ${b.saved_by_name}` : null]
    .filter(Boolean).join(" · ");
}
