"""iPOS stock catch-up: set SanoPOS stock to iPOS's after days sold on iPOS only.

Dual-run restart 2026-10-16 (docs/onetoystore-pilot/PROGRESS.md): the shop sold on
iPOS only from 3 to 16 Oct. The missed bills are NOT back-entered; instead each toy's
stock is set to iPOS's "Present Stock Position by Supplier" through ONE stock count in
SanoPOS (only changed toys are counted; the full-count box stays off, so toys not
counted are left alone). Below zero in iPOS counts as 0 and is listed (as at the
Phase D import). Toys only in iPOS, toys only in SanoPOS and price differences are
listed for the owner, never changed here.

Usage (repo root):
  python tools/onetoystore-pilot/ipos/ipos_catchup.py <pspsupplier.xls> <sanopos-stock.json> <out dir>
sanopos-stock.json = [{"sku", "name", "qty", "price"}] for the shop's live toys at
Packages Mall (read-only SQL, see catchup-stock.sql). Writes catchup-review.xlsx
(for the owner) and catchup-counts.json (for catchup-apply.js).
"""
import json
import os
import sys

import ipos_convert as ic


def _key(code):
    return str(code).strip().upper()


def _unzero(code):
    return _key(code).lstrip("0") or "0"


def compare(ipos_items, sano_rows):
    by_key, by_unzero = {}, {}
    for s in sano_rows:
        k = _key(s["sku"])
        if k in by_key:
            raise ValueError(f"two SanoPOS toys have the code {k!r}: {by_key[k]['name']} / {s['name']}")
        by_key[k] = s
        by_unzero.setdefault(_unzero(s["sku"]), []).append(s)

    matched = {}  # id(sano row) -> ipos item
    unmatched = []
    for i in ipos_items:
        s = by_key.get(_key(i["code"]))
        if s is None:
            cands = [c for c in by_unzero.get(_unzero(i["code"]), []) if id(c) not in matched]
            s = cands[0] if len(cands) == 1 else None
        if s is None or id(s) in matched:
            unmatched.append(i)
        else:
            matched[id(s)] = i

    out = {k: [] for k in ("stock_changes", "counts", "below_zero", "new_in_ipos",
                           "not_in_ipos", "price_diffs", "part_qty")}
    unchanged = 0
    for s in sano_rows:
        i = matched.get(id(s))
        if i is None:
            out["not_in_ipos"].append({"sku": s["sku"], "name": s["name"], "sano_qty": s["qty"], "sano_price": s["price"]})
            continue
        raw = i["qty"]
        qty = int(round(raw))
        if abs(raw - qty) > 1e-9:
            out["part_qty"].append({"sku": s["sku"], "name": s["name"], "ipos_qty": raw, "used": max(qty, 0)})
        if qty < 0:
            out["below_zero"].append({"sku": s["sku"], "name": s["name"], "ipos_qty": qty, "sano_qty": s["qty"]})
        counted = max(qty, 0)
        sano_qty = int(round(s["qty"]))
        if counted != sano_qty:
            out["stock_changes"].append({"sku": s["sku"], "name": s["name"], "sano_qty": sano_qty,
                                         "ipos_qty": counted, "change": counted - sano_qty})
            out["counts"].append({"sku": s["sku"], "counted_qty": counted})
        else:
            unchanged += 1
        if abs(float(i["sale"]) - float(s["price"])) >= 1:
            out["price_diffs"].append({"sku": s["sku"], "name": s["name"],
                                       "sano_price": s["price"], "ipos_price": i["sale"]})
    for i in unmatched:
        out["new_in_ipos"].append({"sku": i["code"], "name": i["name"], "ipos_qty": int(round(i["qty"])),
                                   "cost": i["cost"], "sale": i["sale"], "supplier": i["supplier_name"]})

    ch = out["stock_changes"]
    out["summary"] = {
        "ipos_toys": len(ipos_items),
        "sanopos_toys": len(sano_rows),
        "toys_changing": len(ch),
        "toys_unchanged": unchanged,
        "units_down": -sum(c["change"] for c in ch if c["change"] < 0),
        "units_up": sum(c["change"] for c in ch if c["change"] > 0),
        "below_zero": len(out["below_zero"]),
        "new_in_ipos": len(out["new_in_ipos"]),
        "not_in_ipos": len(out["not_in_ipos"]),
        "price_diffs": len(out["price_diffs"]),
        "part_qty": len(out["part_qty"]),
    }
    return out


# --- file I/O (not unit-tested; run against the real report) ---------------------------------
SHEETS = [
    ("Stock changes", "stock_changes", ["sku", "name", "sano_qty", "ipos_qty", "change"],
     ["Code", "Toy", "SanoPOS now", "iPOS", "Change"]),
    ("New in iPOS", "new_in_ipos", ["sku", "name", "ipos_qty", "cost", "sale", "supplier"],
     ["Code", "Toy", "iPOS qty", "Cost", "Price", "iPOS supplier"]),
    ("Not in iPOS", "not_in_ipos", ["sku", "name", "sano_qty", "sano_price"],
     ["Code", "Toy", "SanoPOS qty", "SanoPOS price"]),
    ("Below zero in iPOS", "below_zero", ["sku", "name", "ipos_qty", "sano_qty"],
     ["Code", "Toy", "iPOS qty", "SanoPOS now (set to 0)"]),
    ("Price differences", "price_diffs", ["sku", "name", "sano_price", "ipos_price"],
     ["Code", "Toy", "SanoPOS price", "iPOS price"]),
    ("Part quantities", "part_qty", ["sku", "name", "ipos_qty", "used"],
     ["Code", "Toy", "iPOS qty", "Used"]),
]

SUMMARY_LABELS = [
    ("ipos_toys", "Toys in the iPOS file"),
    ("sanopos_toys", "Toys in SanoPOS"),
    ("toys_changing", "Toys whose stock changes"),
    ("toys_unchanged", "Toys already right"),
    ("units_down", "Pieces taken off (sold on iPOS)"),
    ("units_up", "Pieces added (arrived / iPOS higher)"),
    ("below_zero", "Below zero in iPOS (set to 0)"),
    ("new_in_ipos", "New toys in iPOS (not added here)"),
    ("not_in_ipos", "SanoPOS toys not in the iPOS file (left alone)"),
    ("price_diffs", "Price differences (not changed here)"),
    ("part_qty", "Part quantities (rounded)"),
]


def write_review_xlsx(result, path):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    for k, label in SUMMARY_LABELS:
        ws.append([label, result["summary"][k]])
    ws.column_dimensions["A"].width = 48
    for title, key, cols, heads in SHEETS:
        s = wb.create_sheet(title)
        s.append(heads)
        for c in s[1]:
            c.font = Font(bold=True)
        for r in result[key]:
            s.append([r[c] for c in cols])
        for row in s.iter_rows(min_row=2, max_col=1):
            row[0].number_format = "@"
        s.column_dimensions["A"].width = 12
        s.column_dimensions["B"].width = 50
        s.freeze_panes = "A2"
        s.auto_filter.ref = s.dimensions
    wb.save(path)


def main(src, sano_json, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    items, totals = ic.parse_report(ic.read_xls(src))
    problems = ic.check_totals(items, totals)
    if problems:
        sys.exit("Report doesn't add up: " + "; ".join(problems))
    with open(sano_json, encoding="utf-8") as f:
        sano = json.load(f)
    result = compare(items, sano)
    write_review_xlsx(result, os.path.join(out_dir, "catchup-review.xlsx"))
    with open(os.path.join(out_dir, "catchup-counts.json"), "w", encoding="utf-8") as f:
        json.dump({"note": "Catch-up from iPOS (sold on iPOS only, 3-16 Oct)",
                   "summary": result["summary"], "counts": result["counts"]}, f, indent=1)
    for k, label in SUMMARY_LABELS:
        print(f"{label}: {result['summary'][k]:,}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
