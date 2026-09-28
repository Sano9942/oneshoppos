"""iPOS "Present Stock Position by Supplier" -> SanoPOS product rows (OTS pilot Phase D).

The owner's decisions this follows (docs/onetoystore-pilot/PROGRESS.md, Decisions
log, 2026-09-28): one stock count, all into Packages Mall; below-zero items import
at 0 and are listed; all items come across; Hot Wheels stay one item; the supplier
merges below; a "kind of toy" category tree named after the website where it fits.

Usage (repo root):
  python tools/onetoystore-pilot/ipos/ipos_convert.py <pspsupplier.xls> <out dir>
"""
import csv
import os
import re
import sys

# --- reading the report -----------------------------------------------------------
# Column positions in the iPOS print layout.
C_CODE, C_NAME, C_QTY, C_COST, C_SALE = 1, 4, 7, 9, 12
C_SUB_QTY, C_SUB_SALE = 5, 15


def _num(v):
    return float(str(v).strip() or 0)


def parse_report(rows):
    """rows: lists of cell strings. Returns (items, grand_totals).

    A supplier heading is a code + name with no quantity; it repeats at the top of
    each page. Items above the first heading have no supplier. The grand totals are
    the last subtotal pair (cost/sale row, then quantity row)."""
    items, seen = [], {}
    sup_code, sup_name = "", ""
    last_money, last_qty = None, None
    for r in rows:
        r = [str(c).strip() for c in r] + [""] * (17 - len(r))
        code, name = r[C_CODE], r[C_NAME]
        if code == "Item Code":
            continue
        if code and name:
            if r[C_QTY] == "":
                sup_code, sup_name = code, name
                continue
            if code in seen:
                raise ValueError(f"item code {code} appears twice ({seen[code]} / {name})")
            seen[code] = name
            items.append({
                "code": code, "name": name, "qty": _num(r[C_QTY]),
                "cost": _num(r[C_COST]), "sale": _num(r[C_SALE]),
                "supplier_code": sup_code, "supplier_name": sup_name,
            })
            continue
        if not code and r[C_SALE] and r[C_SUB_SALE]:
            last_money = (_num(r[C_SALE]), _num(r[C_SUB_SALE]))
        elif not code and r[C_SUB_QTY] and not any(r[i] for i in range(17) if i != C_SUB_QTY):
            last_qty = _num(r[C_SUB_QTY])
    if last_money is None or last_qty is None:
        raise ValueError("no grand total found at the end of the report")
    return items, {"qty": last_qty, "cost": last_money[0], "sale": last_money[1]}


def check_totals(items, totals):
    """Plain-English problems when the items don't add up to the report's own totals."""
    qty = sum(i["qty"] for i in items)
    cost = sum(i["qty"] * i["cost"] for i in items)
    sale = sum(i["qty"] * i["sale"] for i in items)
    out = []
    if abs(qty - totals["qty"]) > 0.001:
        out.append(f"units {qty:,.0f} vs report {totals['qty']:,.0f}")
    if abs(cost - totals["cost"]) > 1:
        out.append(f"cost value {cost:,.2f} vs report {totals['cost']:,.2f}")
    if abs(sale - totals["sale"]) > 1:
        out.append(f"sale value {sale:,.2f} vs report {totals['sale']:,.2f}")
    return out


# --- suppliers (owner, 2026-09-28) ------------------------------------------------------
SUPPLIER_MERGE = {"555": "99", "146": "04"}          # AUDIT REPORT -> TOYS AND TOYS; A TO Z
NOT_A_SUPPLIER = {"102", "173", "017", "998", ""}   # OPEN ITMES, STOCK ADJ, SHOPIFY ORDERS, ADJUSTMENT
SUPPLIER_NAMES = {"99": "TOYS AND TOYS LAHORE", "04": "A TO Z CONSUMERS"}


def supplier_for(code, name):
    code = str(code).strip()
    if code in NOT_A_SUPPLIER:
        return None
    code = SUPPLIER_MERGE.get(code, code)
    return SUPPLIER_NAMES.get(code) or re.sub(r"\s+", " ", name).strip()


# --- categories -----------------------------------------------------------------------
# (group, leaf, pattern). First match wins, so the specific come before the general.
# Leaf names are unique across the tree: the importer finds a category by name alone.
RULES = [
    ("Baby & Toddler", "Baby Walkers & Gear", r"WALKER|STROLLER|SROLLER|PRAM\b|BATHER|BATH TUB|HIGH CHAIR|CRADLE|BOUNCER|FEEDER|PLAY ?MAT|PLAY ?GYM|BABY ROPE SWING|BABY SWING|CAR SEAT|BABY SEAT"),
    ("Baby & Toddler", "Rattles & Teethers", r"RATTLE|TEETH|TEETHER"),
    ("Vehicles", "Die-cast & Hot Wheels", r"DINKEY|DINKY|DIKEY|DIE ?CAST|MAISTO|BURAGO|HOT ?WHEEL|\bH\.?W\b|MATCHBOX|MODEL CAR|METAL CAR|ALLOY|MAJORETTE|WELLY"),
    ("Vehicles", "Remote Control Toys", r"REMOTE|\bR/?C\b|RECHARGE|DRONE|\bRC\d"),
    ("Outdoor Play & Sports", "Swimming Pools & Water Play", r"INTEX|POOL|SWIM|FLOAT|WATER GUN|WATER BALLOON|WATER CANNON|POP TUBE|\bTUBE\b|WATER PLAY|BESTWAY"),
    ("Stationery & School", "Stationery", r"BALL ?PEN|GEL PEN"),  # before "BALL"
    ("Stationery & School", "Books & Diaries", r"DIARY|NOTE ?BOOK"),  # before "BEAR"
    ("Action Figures & Hero Play", "Toy Guns & Swords", r"\bGUNS?\b|\bGUN\W|BULLET|BLASTER|NERF|ARCHERY|SWORD|ARROW|\bBOW\b|PISTOL|RIFLE|SHOOTING|SHIELD"),
    ("Vehicles", "Track Sets & Trains", r"TRACK|TRAIN\b|TRAINS\b|RAILWAY|\bRAIL\b"),
    ("Building Blocks", "Blocks & LEGO", r"BLOCK|BOLCK|LEPIN|LEGO|\bLPN\b|BRICK|BUILDING|CONSTRUCTION|MEGA BLOKS"),
    ("Action Figures & Hero Play", "Action Figures & Robots", r"FIGURE|\bFIG\b|AVENGERS|SPIDER ?MAN|SPIDERNAN|BEY ?BLADE|ROBLOX|JOKER|BATMAN|SUPERMAN|IRON ?MAN|HULK|TRANSFORMER|ROBOT|DINOSAUR|\bDINO\b|WRESTLING|POKEMON|MINECRAFT|NINJA|CAPTAIN|DRAGON BALL|MARVEL|JURASSIC|GODZILLA|HERO"),
    ("Action Figures & Hero Play", "Animals & Play Sets", r"ANIMAL|\bZOO\b|\bFARM\b|PLAY ?SET|CITY RESCUE|SPACE (TRAVEL|EXPLORATION)|FERRIS WHEEL|SUBMARINE"),
    ("Dolls & Pretend Play", "Kitchen Sets & Food Play", r"KITCHEN|KITCHE\b|STOVE|TABLEWARE|COOK|ICE ?CREAM|FAST FOOD|\bFOOD\b|TEA SET|DINNER SET|FRUIT CUT|\bBBQ\b|COFFEE|CUTTING"),
    ("Dolls & Pretend Play", "Make Up Sets & Jewellery", r"BEAUTY|MAKE ?UP|NAIL|JEWEL|\bHAIR|ORNAMENT|BANGLE|BRACELET|NECKLACE|DRESSING|COSMETIC|LIPSTICK|LIP GLOSS"),
    ("Dolls & Pretend Play", "Doctor, Tools & Role Play", r"DOCTOR|\bTOOLS?\b|POLICE SET|SHOPPING|CASH REGISTER|CASHIER|SUPER ?MARKET|FIREMAN|ENGINEER|CLEANING|IRON SET|WASHING|WALKIE|WALKI TALKI"),
    ("Dolls & Pretend Play", "Dolls & Doll Houses", r"DOLL|BARBIE|\bLOL\b|PRINCESS|FROZEN|ELSA|VILLA|CASTLE|PONY"),
    ("Outdoor Play & Sports", "Ride-ons & Scooters", r"SCOOTY|SCOOTER|SKATE|CYCLE|RIDE ON|RIDE-ON|TRICYCLE|\bBIKE\b"),
    ("Outdoor Play & Sports", "Sports Items", r"FOOTBALL|BASKET ?BALL|VOLLEY|CRICKET|RACKET|BADMINTON|TENNIS|\bBAT\b|BOWLING|\bDART|SHUTTLE|\bGOAL|BOXING|KITE|FRISBEE|JUMPING ROPE|SKIPPING|HELMET|HALMAT|KNEE PAD|GOLF|HULA|\bBALLS?\b"),
    ("Soft Toys", "Stuffed & Plush Toys", r"STUFF|SOFT TOY|TEDDY|PLUSH|\bBEAR\b|\bSOFT\b"),
    ("Board Games & Puzzles", "Puzzles & Cubes", r"PUZZLE|CUBE|JIGSAW|MAZE|TANGRAM"),
    ("Board Games & Puzzles", "Board & Card Games", r"LUDO|LUDU|CHESS|MONOPOLY|CARROM|CARRUM|\bUNO\b|SCRABBLE|JENGA|SNAKE|\bGAME|\bCARDS?\b|DOMINO|BINGO|TIC TAC|CONNECT 4|TWISTER|ONO FLIP"),
    ("Educational & Musical Toys", "Musical Toys", r"MUSICAL|MUSIC|PIANO|GUITAR|DRUM|\bMIC\b|MICROPHONE|KEYBOARD|XYLOPHONE|VIOLIN|SAXOPHONE|FLUTE|TRUMPET"),
    ("Educational & Musical Toys", "Educational Toys", r"LEARNING|EDUCATION|\bABC|ALPHABE|LAPTOP|STEM|SCIENCE|PROJECTOR|TELESCOPE|MICROSCOPE|GLOBE|NUMBER|COUNTING|CLOCK|MAGNETIC|MAGNET|MEGNETIC|\bLCD\b|WRITING BOARD|BINOC|BINACULAR|CAMERA|LASER|CALENDAR|STUDY TABLE|TABLET|ISLAMIC|ISLIMIC|QURAN|PRAYER|EVA\b"),
    ("Arts & Crafts", "Dough, Sand & Slime", r"CLAY|SLIME|DOUGH|SQUISHY|KINETIC|\bSAND\b|FLUFFY|CRYSTAL MUD"),
    ("Arts & Crafts", "Colouring, Painting & DIY", r"COLOU?RING|COLOU?R|PAINT|CRAYOLA|CRAYON|DRAWING|\bDIY\b|BEAD|STICKER|STAMP|SAMP\b|\bART\b|SKETCH|CANVAS|GLITTER|CRAFT|BRUSH|LOOM BAND|QUILLING"),
    ("Stationery & School", "School Bags, Lunch Boxes & Bottles", r"LUNCH|BOTTLE|FLASK|SCHOOL BAG|BACKPACK|BAG ?PACK|\bPOUCH|PENCIL BOX|GEOMETRY|TIFFIN|WATER DISPENCER|\bBAGS?\b|WALLET|PURSE|PRUSE|UMBRELLA"),
    ("Stationery & School", "Books & Diaries", r"BOOK|DIARY|CALI?GR?APHY|RHYMES|\bNOTE\b|STORY|REGISTER|\bCOPY|JOURNAL"),
    ("Stationery & School", "Stationery", r"PENCIL|\bPENS?\b|ERASER|EARSER|SHARPENER|MARKER|HIGHLIGHT|\bSCALE\b|RULER|GLUE|\bTAPE\b|STAPLER|STATIONERY|SCISSOR|STICKY|SCRA?TCH PAD|CALCULATOR|STENCIL|CHALK|\bHB\b|REFILL|GUM STICK"),
    ("Party & Novelty", "Masks, Wigs & Party", r"MASK|\bWIG|WITCH|PIRATE|FAIRY WINGS|MUSTACHE|BALLOON|PARTY|\bCAP\b|GLASSES|HEADBAND|HEAD BAND|CROWN|COSTUME|CANDLE|GIFT|WRAPPING|FLASHING|GLOW|TORCH|LIGHT|LAMP"),
    ("Small Toys & Pocket Money", "Pocket Money Toys", r"DICE|WHISTLE|PAPER SOAP|SQUEEZ|SQUISH|WIND ?UP|KEY OPERATED|RUBBER TOY|EGG TOY|SURPRISE|NEEDOH|SCREAMING|WRIST BAND|ARM BAND|\bPLATE\b|\bBOWL\b|MARBLE|GOTI|YO ?-?YO|SPINNER|FIDGET|POP ?IT|KEY ?CHAIN|\bSINGLE\b|BUBBLE|MAGIC|\bFAN\b|WATCH|MONEY FOLDER|CACTUS|\bTOP\b|SLINKY|RAINBOW RING|FINGER|FLIP MONKEY|VINYL TOY|ATM|LOCK CODED"),
    ("Baby & Toddler", "Baby Toys", r"\bBABY|INFANT|TODDLER|STACK|SORTER|PULL ALONG|\bPUSH\b|DUCK|BATH"),
    ("Vehicles", "Cars, Trucks & Planes", r"\bCAR\b|CARS\b|TRUCK|PLANE|\bBUS\b|HELICOPTER|TRACTOR|EXCAVATOR|JEEP|MOTOR|VEHICLE|\bTANK\b|BOAT|SHIP|AEROPLANE|\bJCB\b|CRANE|FIRE ENGINE|AMBULANCE|RACING|RICKSHAW|RISKSHAW|FRICTION"),
]
FALLBACK = ("Other", "Needs a Category")
_COMPILED = [(g, l, re.compile(p)) for g, l, p in RULES]
_NOISE = re.compile(r"\bIN (A )?(PVC )?(BAG|BOX|NET|CARD)\b")

CATEGORY_TREE_LEAVES = []
for _g, _l, _ in RULES + [FALLBACK + ("",)]:
    if (_g, _l) not in CATEGORY_TREE_LEAVES:
        CATEGORY_TREE_LEAVES.append((_g, _l))


def categorise(name):
    """(group, leaf) for an item name, by keyword. Packaging words ("IN PVC BAG")
    are ignored so they don't file a toy under bags."""
    text = _NOISE.sub(" ", str(name).upper())
    for g, l, rx in _COMPILED:
        if rx.search(text):
            return g, l
    return FALLBACK


# --- brands: makers only (owner, 2026-09-28) -------------------------------------------
# Characters (Avengers, Frozen...) stay in the name. Short codes the owner named:
# W.F = Winfun, HSB = Hasbro, L.T = Little Tikes; TB is the supplier Tooba Stuff,
# the rest (TORY, MBK, GT, H.B...) are left alone. First match wins, so a famous
# line (Hot Wheels, Barbie, Nerf) beats its maker.
BRANDS = [
    ("Hot Wheels", r"HOT ?WHEEL|\bH\.?W\b"),
    ("Barbie", r"BARBIE"),
    ("Nerf", r"\bNERF\b"),
    ("Play-Doh", r"PLAY ?-?DOH"),
    ("Mattel", r"MATTEL|MATTLE"),
    ("Hasbro", r"HASBRO|\bHSB\b"),
    ("Winfun", r"WIN ?FUN|\bW\.?F\b"),
    ("Little Tikes", r"LITTLE TIKES|\bL\.T\b"),
    ("LEGO", r"\bLEGO\b"),
    ("Lepin", r"LEPIN|\bLPN\b"),
    ("Intex", r"INTEX"),
    ("Bestway", r"BESTWAY"),
    ("Maisto", r"MAISTO"),
    ("Burago", r"B?BURAGO"),
    ("Crayola", r"CRAYOLA"),
    ("Yalong", r"YALONG"),
    ("Chicco", r"CHICCO"),
    ("Graco", r"GRACO"),
    ("Mastela", r"MASTELA"),
    ("Fisher-Price", r"FISHER ?-?PRICE|\bFISHER\b"),
    ("Pelikan", r"PELIKAN"),
    ("Deli", r"\bDELI\b"),
]
_BRANDS = [(b, re.compile(p)) for b, p in BRANDS]


def brand_for(name):
    text = str(name).upper()
    for b, rx in _BRANDS:
        if rx.search(text):
            return b
    return ""


# --- SanoPOS rows ---------------------------------------------------------------------------
def build_products(items):
    out = []
    for i in items:
        group, leaf = categorise(i["name"])
        qty = int(round(i["qty"]))
        out.append({
            "name": re.sub(r"\s+", " ", i["name"]).strip(),
            "sku": i["code"],
            "barcode": "",
            "selling_price": round(i["sale"], 2),
            "cost_price": round(i["cost"], 2),
            "category": leaf,
            "brand": brand_for(i["name"]),
            "supplier": supplier_for(i["supplier_code"], i["supplier_name"]),
            "stock_quantity": max(qty, 0),
            "_group": group,
            "_ipos_qty": qty,
            "_below_zero": qty < 0,
            "_ipos_supplier": i["supplier_name"],
        })
    return out


# --- file I/O (not unit-tested; run against the real report) ---------------------------------
def read_xls(path):
    import xlrd
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    return [[str(v) for v in sheet.row_values(i)] for i in range(sheet.nrows)]


def write_review_xlsx(products, path):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    wb = Workbook()
    ws = wb.active
    ws.title = "Items"
    head = ["Code", "Name", "Group", "Category", "Change category to", "Supplier", "iPOS qty", "Cost", "Sale"]
    ws.append(head)
    for c in ws[1]:
        c.font = Font(bold=True)
    for p in sorted(products, key=lambda p: (p["_group"], p["category"], p["name"])):
        ws.append([p["sku"], p["name"], p["_group"], p["category"], "", p["supplier"] or "",
                   p["_ipos_qty"], p["cost_price"], p["selling_price"]])
    for row in ws.iter_rows(min_row=2, max_col=1):
        row[0].number_format = "@"  # codes stay text: leading zeros survive Excel
    for col, w in zip("ABCDEFGHI", [16, 46, 26, 32, 26, 26, 9, 10, 10]):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    tree = wb.create_sheet("Category tree")
    tree.append(["Group", "Category", "Items"])
    counts = {}
    for p in products:
        counts[(p["_group"], p["category"])] = counts.get((p["_group"], p["category"]), 0) + 1
    for g, l in CATEGORY_TREE_LEAVES:
        tree.append([g, l, counts.get((g, l), 0)])
    tree.column_dimensions["A"].width = 30
    tree.column_dimensions["B"].width = 36
    wb.save(path)


def main(src, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    items, totals = parse_report(read_xls(src))
    problems = check_totals(items, totals)
    if problems:
        sys.exit("Report doesn't add up: " + "; ".join(problems))
    products = build_products(items)
    write_review_xlsx(products, os.path.join(out_dir, "ipos-categories-to-check.xlsx"))
    with open(os.path.join(out_dir, "ipos-products.csv"), "w", newline="", encoding="utf-8-sig") as f:
        cols = ["name", "sku", "barcode", "selling_price", "cost_price", "category", "brand", "supplier", "stock_quantity"]
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for p in products:
            w.writerow({**p, "supplier": p["supplier"] or ""})
    below = [p for p in products if p["_below_zero"]]
    uncategorised = [p for p in products if p["category"] == FALLBACK[1]]
    print(f"{len(products)} items; totals match iPOS ({totals['qty']:,.0f} units, "
          f"cost {totals['cost']:,.0f}, sale {totals['sale']:,.0f})")
    print(f"below zero -> 0: {len(below)} items, {-sum(p['_ipos_qty'] for p in below):,} units")
    print(f"needs a category: {len(uncategorised)}")
    print(f"suppliers: {len({p['supplier'] for p in products if p['supplier']})}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
