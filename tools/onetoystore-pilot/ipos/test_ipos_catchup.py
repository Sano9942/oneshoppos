"""Tests for the iPOS stock catch-up (OTS pilot, dual-run restart 2026-10-16).

The shop sold on iPOS only from 3 to 16 Oct. Owner decision: don't back-enter
those bills; set SanoPOS stock to iPOS's "Present Stock Position by Supplier"
through one stock count (only the changed toys are counted, no full-count box).

Run from the repo root:  python -m pytest tools/onetoystore-pilot/ipos -q
"""
import ipos_catchup as cu


def ipos(code, qty, sale=100.0, name=None, cost=50.0):
    return {"code": code, "name": name or f"TOY {code}", "qty": qty, "cost": cost, "sale": sale,
            "supplier_code": "04", "supplier_name": "A TO Z CONSUMERS"}


def sano(sku, qty, price=100.0, name=None):
    return {"sku": sku, "name": name or f"TOY {sku}", "qty": qty, "price": price}


def test_only_changed_toys_are_counted():
    r = cu.compare([ipos("100", 5), ipos("101", 3)], [sano("100", 7), sano("101", 3)])
    assert [(c["sku"], c["sano_qty"], c["ipos_qty"], c["change"]) for c in r["stock_changes"]] == [("100", 7, 5, -2)]
    assert r["counts"] == [{"sku": "100", "counted_qty": 5}]


def test_below_zero_in_ipos_counts_as_zero_and_is_listed():
    r = cu.compare([ipos("100", -2)], [sano("100", 1)])
    assert r["counts"] == [{"sku": "100", "counted_qty": 0}]
    assert [(b["sku"], b["ipos_qty"]) for b in r["below_zero"]] == [("100", -2)]


def test_below_zero_in_ipos_and_zero_in_sanopos_is_no_change():
    r = cu.compare([ipos("100", -2)], [sano("100", 0)])
    assert r["counts"] == []
    assert len(r["below_zero"]) == 1


def test_negative_sanopos_stock_is_brought_up_to_ipos():
    r = cu.compare([ipos("100", 0)], [sano("100", -1)])
    assert r["counts"] == [{"sku": "100", "counted_qty": 0}]
    assert r["stock_changes"][0]["change"] == 1


def test_toy_only_in_ipos_is_new_and_not_counted():
    r = cu.compare([ipos("100", 1), ipos("31500", 4, sale=1200, name="NEW CAR")], [sano("100", 1)])
    assert [(n["sku"], n["name"], n["ipos_qty"], n["sale"]) for n in r["new_in_ipos"]] == [("31500", "NEW CAR", 4, 1200)]
    assert r["counts"] == []


def test_toy_only_in_sanopos_is_listed_and_left_alone():
    r = cu.compare([ipos("100", 1)], [sano("100", 1), sano("200", 6)])
    assert [(m["sku"], m["sano_qty"]) for m in r["not_in_ipos"]] == [("200", 6)]
    assert r["counts"] == []


def test_codes_match_ignoring_leading_zeros():
    r = cu.compare([ipos("0042", 2)], [sano("42", 5)])
    assert r["counts"] == [{"sku": "42", "counted_qty": 2}]
    assert r["new_in_ipos"] == [] and r["not_in_ipos"] == []


def test_exact_code_wins_over_leading_zero_match():
    r = cu.compare([ipos("042", 2), ipos("42", 9)], [sano("42", 9), sano("042", 5)])
    assert r["counts"] == [{"sku": "042", "counted_qty": 2}]


def test_sanopos_code_case_and_spaces_dont_matter():
    r = cu.compare([ipos("AB12", 2)], [sano(" ab12 ", 5)])
    assert r["counts"] == [{"sku": " ab12 ", "counted_qty": 2}]


def test_price_difference_is_listed_with_both_prices():
    r = cu.compare([ipos("100", 1, sale=1350)], [sano("100", 1, price=1200)])
    assert [(p["sku"], p["sano_price"], p["ipos_price"]) for p in r["price_diffs"]] == [("100", 1200, 1350)]


def test_price_within_a_rupee_is_the_same():
    r = cu.compare([ipos("100", 1, sale=1200.4)], [sano("100", 1, price=1200)])
    assert r["price_diffs"] == []


def test_part_quantity_is_rounded_and_flagged():
    r = cu.compare([ipos("100", 2.6)], [sano("100", 1)])
    assert r["counts"] == [{"sku": "100", "counted_qty": 3}]
    assert [p["sku"] for p in r["part_qty"]] == ["100"]


def test_summary_adds_up():
    r = cu.compare([ipos("100", 5), ipos("101", 10), ipos("102", 1)],
                   [sano("100", 7), sano("101", 8), sano("102", 1)])
    s = r["summary"]
    assert (s["toys_changing"], s["units_down"], s["units_up"]) == (2, 2, 2)
    assert s["toys_unchanged"] == 1


def test_two_sanopos_toys_with_the_same_code_is_refused():
    try:
        cu.compare([ipos("100", 1)], [sano("100", 1), sano("100 ", 2)])
    except ValueError as e:
        assert "100" in str(e)
    else:
        raise AssertionError("expected a ValueError")
