"""Tests for the iPOS "Present Stock Position by Supplier" converter (OTS pilot Phase D).

Run from the repo root:  python -m pytest tools/onetoystore-pilot/ipos -q
The rows below mimic the report's 17-column layout (col 1 code, col 4 name,
col 7 on hand, col 9 unit cost, col 12 unit sale / subtotal cost, col 15 subtotal
sale, col 5 subtotal qty). The real file is business data and stays out of git.
"""
import pytest

import ipos_convert as ic


def row(**cols):
    r = [""] * 17
    for k, v in cols.items():
        r[int(k[1:])] = v
    return r


def item(code, name, qty, cost, sale):
    return row(c1=code, c4=name, c7=str(qty), c9=str(cost), c12=str(sale))


def heading(code, name):
    return row(c1=code, c4=name)


def subtotal(cost_total, sale_total, qty_total):
    return [row(c12=str(cost_total), c15=str(sale_total)), row(c5=str(qty_total))]


PAGE_HEADER = [
    row(c2="ONE SHOP", c16="46290.0"),
    row(c2="PRESENT STOCK POSITION BY SUPPLIER"),
    row(c14="Page 1 of 2"),
    row(c1="Item Code", c4="Description", c7="On Hand", c9="Cost", c12="Sale"),
]


def sample_report():
    rows = list(PAGE_HEADER)
    rows += [item("19119", "GUN AR BLUTOOTH-G-128", 1.0, 1195.0, 3050.0)]
    rows += subtotal(1195.0, 3050.0, 1.0)
    rows += [heading("99", "TOYS AND TOYS LAHORE"), PAGE_HEADER[3]]
    rows += [item("0107", "MASK AVENGERS-7790", 12.0, 395.0, 1150.0)]
    # the heading repeats at the top of the next page
    rows += PAGE_HEADER + [heading("99", "TOYS AND TOYS LAHORE")]
    rows += [item("0108", "MAGIC CUBE-9119", -1.0, 400.0, 1190.0)]
    rows += subtotal(4340.0, 12610.0, 11.0)
    rows += [heading("555", "AUDIT REPORT MARCH 2025")]
    rows += [item("027084120134", "MATTLE HW DINKEY-C4982-TT", 251.0, 310.0, 710.0)]
    rows += subtotal(77810.0, 178210.0, 251.0)
    rows += [heading("102", "OPEN ITMES")]
    rows += [item("0951", "MUSTACHE SINGLE", 185.0, 19.3514, 50.0)]
    rows += subtotal(3580.009, 9250.0, 185.0)
    # grand total
    rows += subtotal(86925.009, 203120.0, 448.0)
    return rows


# --- reading the report -----------------------------------------------------

def test_reads_every_item_with_its_supplier_heading():
    items, _ = ic.parse_report(sample_report())
    assert [i["code"] for i in items] == ["19119", "0107", "0108", "027084120134", "0951"]
    assert items[0]["supplier_code"] == ""  # above the first heading
    assert items[1]["supplier_code"] == "99"
    assert items[2]["supplier_code"] == "99"  # heading repeated on the new page
    assert items[3]["supplier_name"] == "AUDIT REPORT MARCH 2025"


def test_keeps_codes_as_text_with_leading_zeros():
    items, _ = ic.parse_report(sample_report())
    assert items[1]["code"] == "0107"


def test_reads_numbers():
    items, _ = ic.parse_report(sample_report())
    assert items[2]["qty"] == -1
    assert items[4]["cost"] == pytest.approx(19.3514)
    assert items[4]["sale"] == 50


def test_grand_totals_come_from_the_last_subtotal():
    _, totals = ic.parse_report(sample_report())
    assert totals == {"qty": 448.0, "cost": pytest.approx(86925.009), "sale": 203120.0}


def test_check_totals_passes_when_items_add_up():
    items, totals = ic.parse_report(sample_report())
    assert ic.check_totals(items, totals) == []


def test_check_totals_names_a_lost_item():
    items, totals = ic.parse_report(sample_report())
    problems = ic.check_totals(items[:-1], totals)
    assert any("units" in p for p in problems)


def test_duplicate_code_is_an_error():
    rows = sample_report()
    rows.insert(-2, item("0107", "MASK AVENGERS COPY", 0.0, 1.0, 2.0))
    with pytest.raises(ValueError, match="0107"):
        ic.parse_report(rows)


# --- owner's supplier decisions (2026-09-28) ------------------------------------

def test_audit_report_merges_into_toys_and_toys():
    assert ic.supplier_for("555", "AUDIT REPORT MARCH 2025") == "TOYS AND TOYS LAHORE"


def test_two_a_to_z_suppliers_merge():
    assert ic.supplier_for("146", "A TO Z CONSUMER") == "A TO Z CONSUMERS"
    assert ic.supplier_for("04", "A TO Z CONSUMERS") == "A TO Z CONSUMERS"


@pytest.mark.parametrize("code,name", [
    ("102", "OPEN ITMES"), ("173", "STOCK ADJUDSTMENT"), ("017", "SHOPIFY ORDERS"),
    ("998", "ADJUSTMENT"), ("", ""),
])
def test_non_suppliers_get_no_supplier(code, name):
    assert ic.supplier_for(code, name) is None


def test_other_suppliers_keep_their_name_tidied():
    assert ic.supplier_for("05", "JAHANGIR BOOKS  LAHORE") == "JAHANGIR BOOKS LAHORE"


# --- building the SanoPOS rows --------------------------------------------------

def test_below_zero_imports_at_zero_and_is_flagged():
    items, _ = ic.parse_report(sample_report())
    out = {p["sku"]: p for p in ic.build_products(items)}
    assert out["0108"]["stock_quantity"] == 0
    assert out["0108"]["_ipos_qty"] == -1
    assert out["0108"]["_below_zero"] is True
    assert out["0107"]["stock_quantity"] == 12
    assert out["0107"]["_below_zero"] is False


def test_code_goes_in_sku_exactly_and_prices_carry_over():
    items, _ = ic.parse_report(sample_report())
    out = {p["sku"]: p for p in ic.build_products(items)}
    p = out["0107"]
    assert p["name"] == "MASK AVENGERS-7790"
    assert p["selling_price"] == 1150
    assert p["cost_price"] == 395
    assert p["supplier"] == "TOYS AND TOYS LAHORE"
    assert out["0951"]["supplier"] is None
    assert out["0951"]["cost_price"] == pytest.approx(19.35)  # products.cost_price is NUMERIC(12,2)


def test_every_item_gets_a_leaf_category():
    items, _ = ic.parse_report(sample_report())
    leaves = {leaf for _, leaf in ic.CATEGORY_TREE_LEAVES}
    for p in ic.build_products(items):
        assert p["category"] in leaves


def test_hot_wheels_stays_one_item():
    items, _ = ic.parse_report(sample_report())
    hw = [p for p in ic.build_products(items) if p["sku"] == "027084120134"]
    assert len(hw) == 1 and hw[0]["stock_quantity"] == 251


# --- categories -------------------------------------------------------------------

@pytest.mark.parametrize("name,leaf", [
    ("MATTLE HW DINKEY-C4982-TT", "Die-cast & Hot Wheels"),
    ("RC CAR POLICE-589-1E", "Remote Control Toys"),
    ("DRAGON BALL Z ACTION FIG-88604", "Action Figures & Robots"),
    ("DUCK YELLOW IN PVC BAG-133B-12", "Baby Toys"),
    ("ACTIVITY WALKER TRAINER-AW-668-70", "Baby Walkers & Gear"),
    ("MAGIC CUBE-9119", "Puzzles & Cubes"),
    ("GUN AR BLUTOOTH-G-128", "Toy Guns & Swords"),
    ("WATER GUN IN PVC BAG-5062B", "Swimming Pools & Water Play"),
    ("KITCHEN SET-GT-0100", "Kitchen Sets & Food Play"),
    ("DICE", "Pocket Money Toys"),
    ("PAPER SOAP-75101", "Pocket Money Toys"),
    ("STUFF BEAR B.L-0502-CF", "Stuffed & Plush Toys"),
    ("LUNCH BOX-123", "School Bags, Lunch Boxes & Bottles"),
    ("ZZQX UNKNOWN THING", "Needs a Category"),
])
def test_categorise(name, leaf):
    assert ic.categorise(name)[1] == leaf


def test_leaf_names_are_unique_and_never_reuse_a_group_name():
    # the importer finds a category by name alone, across the whole tree
    leaves = [leaf for _, leaf in ic.CATEGORY_TREE_LEAVES]
    groups = {g for g, _ in ic.CATEGORY_TREE_LEAVES}
    assert len(leaves) == len(set(l.lower() for l in leaves))
    assert not ({l.lower() for l in leaves} & {g.lower() for g in groups})


@pytest.mark.parametrize("name,leaf", [
    ("BLOCKS 28 PCS DINOSAUR PARK-BL-6688-114A", "Blocks & LEGO"),
    ("TRACK HIGH SPEED DINO-696-00", "Track Sets & Trains"),
    ("ARCHERY SET DINOSAUR-HM220", "Toy Guns & Swords"),
    ("INVISIBLE BALL PEN", "Stationery"),
    ("DIARY BUTTER BEAR-10152", "Books & Diaries"),
])
def test_categorise_specific_before_general(name, leaf):
    assert ic.categorise(name)[1] == leaf


# --- brands: makers only (owner, 2026-09-28) ----------------------------------------

@pytest.mark.parametrize("name,brand", [
    ("MATTLE HW DINKEY-C4982-TT", "Hot Wheels"),
    ("H.W ACTION TRACK-GBF89", "Hot Wheels"),
    ("MATTEL BARBIE DOLL-GTW30", "Barbie"),
    ("MATTEL UNO CARDS", "Mattel"),
    ("W.F PENGUIN MUSIC PLAYER-02514A", "Winfun"),
    ("WF PULL ALONG PAL ELEPHANT-230202", "Winfun"),
    ("HSB IRONMAN FIGURE-B6156", "Hasbro"),
    ("NERF GUN-E3312", "Nerf"),
    ("L.T SQUISHY PIANO-647352", "Little Tikes"),
    ("LPN MINE CRAFT 304PCS-8004", "Lepin"),
    ("LEPIN BLOCKS MIX-3411 TO 3428", "Lepin"),
    ("INTEX SWIMING POOL-57135", "Intex"),
    ("MAISTO BMW M4GTS-31246", "Maisto"),
    ("BURAGO MODEL CAR-12016", "Burago"),
    ("YALONG ERASER-231532", "Yalong"),
    ("CRAYOLA COLOR KIT", "Crayola"),
    ("CHICCO BABY CARRIER-1405-4", "Chicco"),
])
def test_brand_from_name(name, brand):
    assert ic.brand_for(name) == brand


@pytest.mark.parametrize("name", [
    "STUFF BEAR BROWN&WHITE TB",       # TB = Tooba Stuff, a supplier
    "FIGURE AVENGERS MIX-8818-92557",  # a character, not a maker
    "TORI PUSH CAR-606", "MBK BEAD SET", "KITCHEN SET-GT-0100", "H.B BABY ALIVE-E8716",
    "LT BLUE BALL",                    # "LT" without the dot is not Little Tikes
])
def test_no_brand(name):
    assert ic.brand_for(name) == ""


def test_products_carry_the_brand():
    items, _ = ic.parse_report(sample_report())
    out = {p["sku"]: p for p in ic.build_products(items)}
    assert out["027084120134"]["brand"] == "Hot Wheels"
    assert out["0107"]["brand"] == ""


@pytest.mark.parametrize("name,leaf", [
    ("KITCHE SET-GT-88-2C", "Kitchen Sets & Food Play"),
    ("FARM HORSE 2PACK -1258", "Animals & Play Sets"),
    ("MAGIC WATER PAINTING FARM-WX-HS", "Colouring, Painting & DIY"),
])
def test_word_boundaries_hold(name, leaf):
    assert ic.categorise(name)[1] == leaf


def test_no_control_characters_in_patterns():
    # a "\b" typed into a non-raw string once became a backspace and silently
    # switched word-boundary checks off
    src = open(ic.__file__, "rb").read()
    assert b"\x08" not in src

def test_reads_the_newer_excel_format_even_named_xls(tmp_path):
    # iPOS's 29 Sep 2026 export is an .xlsx file saved as ".xls"; the 25 Sep one was a real .xls.
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append([None, "Item Code", None, None, "Description", None, None, "On Hand"])
    ws.append([None, "0107", None, None, "BALL", None, None, 3, None, 12.5])
    path = tmp_path / "pspsupplier.xls"
    wb.save(path)
    rows = ic.read_xls(str(path))
    assert rows[1][:10] == ["", "0107", "", "", "BALL", "", "", "3", "", "12.5"]
    assert ic._num(rows[1][7]) == 3
