# -*- coding: utf-8 -*-
"""Parse the repair price cheat sheet into flat rows.

Each sheet has its own column layout, so each gets its own explicit map rather
than a clever generic reader — a wrong guess here becomes a wrong price quoted
on a live call.

Output: one row per (device, repair, tier) with set/part/floor price, turnaround
and flags. Nothing is invented; a blank stays blank.
"""
import io, json, re
import openpyxl

SRC = r"C:\Users\ericf\.claude\uploads\f19a3583-8694-4aca-9251-e972172463bf\6077f6ad-Repair_Price_Cheat_Sheet__Agent.xlsx"
OUT = r"C:\Users\ericf\AppData\Local\Temp\claude\C--Users-ericf-cpr-dialpad-dashboard\f19a3583-8694-4aca-9251-e972172463bf\scratchpad\prices.json"

wb = openpyxl.load_workbook(SRC, data_only=True)
rows = []
problems = []


def val(ws, r, c):
    v = ws.cell(row=r, column=c).value
    if v is None:
        return None
    s = str(v).strip()
    if s == "" or s.lower() in ("n/a", "na", "-"):
        return None
    return s


def money(ws, r, c):
    s = val(ws, r, c)
    if s is None:
        return None
    if "#VALUE" in s or "#REF" in s:
        problems.append("formula error at %s!%s%d" % (ws.title, openpyxl.utils.get_column_letter(c), r))
        return None
    # "$189.99*", "$129.99 + part cost", "1=99.99 2=129.99"
    m = re.search(r"(\d+(?:,\d{3})*(?:\.\d+)?)", s.replace("$", ""))
    if not m:
        return None
    try:
        return round(float(m.group(1).replace(",", "")), 2)
    except ValueError:
        return None


def rawnote(ws, r, c):
    """Keep the original string when it carries more than a number."""
    s = val(ws, r, c)
    if s is None:
        return None
    if re.fullmatch(r"\$?\d+(\.\d+)?\*?", s.replace(",", "")):
        return None
    return s


def add(family, group, device, repair, tier, set_c=None, part_c=None, floor_c=None,
        ws=None, r=None, turnaround=None, flags=None, note=None, floor_rule=None):
    sp = money(ws, r, set_c) if set_c else None
    pp = money(ws, r, part_c) if part_c else None
    fp = money(ws, r, floor_c) if floor_c else None
    if sp is None and fp is None and pp is None:
        return
    extra = rawnote(ws, r, set_c) if set_c else None
    star = bool(set_c and (val(ws, r, set_c) or "").endswith("*"))
    rows.append({
        "family": family, "model_group": group, "device": device,
        "repair": repair, "tier": tier,
        "set_price": sp, "part_price": pp, "floor_price": fp,
        "floor_rule": floor_rule,
        "turnaround": turnaround,
        "flags": sorted(set((flags or []) + (["solder_or_order"] if star else []))),
        "note": note or extra,
    })


# ── iPhones ──────────────────────────────────────────────────────────────────
ws = wb["iPhones"]
IPHONE = [
    ("Screen", "LCD", 2, 3, 4, None),
    ("Screen", "OLED", 5, 6, 7, None),
    ("Screen", "OEM", 8, 9, 10, None),
    ("Battery", None, 11, 12, 13, "1-2 hrs"),
    ("Back glass", None, 14, None, 15, "3-4 hrs"),
    ("Back glass", "OEM", 16, None, 17, "3-4 hrs"),
    ("Camera", None, 18, None, None, "1-2 hrs"),
    ("Charge port", None, 19, None, None, "2-3 hrs"),
    ("Misc small parts", None, 20, None, None, None),
]
for r in range(6, 38):
    device = val(ws, r, 1)
    if not device or device.startswith("*"):
        continue
    for repair, tier, sc, pc, fc, ta in IPHONE:
        rule = "part+80" if repair == "Screen" else ("part+50" if repair == "Battery" else None)
        add("phone", "iPhone", device, repair, tier, sc, pc, fc, ws, r, ta, floor_rule=rule)

# ── Samsung ──────────────────────────────────────────────────────────────────
ws = wb["Samsung Devices"]
SAMSUNG = [
    ("Screen", "OLED", 2, 3, 4, "part+80"),
    ("Battery", None, 5, None, None, None),
    ("Back glass", None, 6, None, 7, None),
    ("Camera", None, 8, None, None, None),
    ("Charge port", None, 9, None, None, None),
    ("Misc small parts", None, 10, None, None, None),
]
group = "Galaxy S Series"
for r in range(6, 52):
    device = val(ws, r, 1)
    if not device:
        continue
    if device.lower().startswith("galaxy") and "series" in device.lower():
        group = device
        continue
    comp = val(ws, r, 12)
    for repair, tier, sc, pc, fc, rule in SAMSUNG:
        add("phone", group, device, repair, tier, sc, pc, fc, ws, r,
            flags=["non_consigned_part"] if repair == "Screen" else None,
            note=comp if repair == "Screen" else None, floor_rule=rule)

# ── Google Pixel ─────────────────────────────────────────────────────────────
ws = wb["Google Pixel"]
PIXEL = [
    ("Screen", "LCD", 2, 3, 4, "part+80"),
    ("Screen", "OLED", 5, 6, 7, "part+80"),
    ("Screen", "OEM", 8, 9, 10, "part+80"),
    ("Battery", None, 11, 12, 13, "part+50"),
]
for r in range(7, 25):
    device = val(ws, r, 1)
    if not device:
        continue
    for repair, tier, sc, pc, fc, rule in PIXEL:
        add("phone", "Pixel", device, repair, tier, sc, pc, fc, ws, r, floor_rule=rule)
    # supplier comparison block (MS vs iFixit) lives to the right
    ms, ifx = money(ws, r, 17), money(ws, r, 20)
    if ms and ifx:
        rows.append({
            "family": "phone", "model_group": "Pixel", "device": device,
            "repair": "Screen", "tier": "OEM — supplier note", "set_price": None,
            "part_price": None, "floor_price": None, "floor_rule": None, "turnaround": None,
            "flags": ["supplier_choice"],
            "note": "Part cost MS $%.2f vs iFixit $%.2f (iFixit saves $%.2f)" % (ms, ifx, ms - ifx)
            if ms > ifx else "Part cost MS $%.2f vs iFixit $%.2f (MS cheaper)" % (ms, ifx),
        })

# ── iPads ────────────────────────────────────────────────────────────────────
ws = wb["iPads"]
IPAD = [("Screen", "Digitizer", 2, None, 3), ("Screen", "LCD", 4, None, 5),
        ("Battery", None, 6, None, 7), ("Charge port", None, 8, None, 9)]
for r in range(3, 35):
    device = val(ws, r, 1)
    if not device:
        continue
    # the sheet omits "iPad" from the row label (the tab implies it); put it back
    # so the name is self-describing and resolves to a canonical model
    label = device if device.lower().startswith("ipad") else "iPad " + device
    for repair, tier, sc, pc, fc in IPAD:
        add("tablet", "iPad", label, repair, tier, sc, pc, fc, ws, r)

# ── MacBooks ─────────────────────────────────────────────────────────────────
ws = wb["Macbooks"]
MAC = [("Screen", None, 2, 3, 4), ("Battery", None, 5, 6, 7),
       ("Charge port", None, 8, 9, 10), ("Upper case assembly", None, 11, 12, 13)]
group = "MacBook Pro"
for r in range(4, 37):
    device = val(ws, r, 1)
    if not device:
        continue
    if device.lower() in ("macbook air", "macbook pro"):
        group = device
        continue
    for repair, tier, sc, pc, fc in MAC:
        add("computer", group, device, repair, tier, sc, pc, fc, ws, r)

# ── Consoles ─────────────────────────────────────────────────────────────────
ws = wb["Consoles"]
SWITCH = [("Screen", None, 2, "same day"), ("Screen", "Digitizer", 3, None),
          ("Battery", None, 4, None), ("Charge port", "Same day", 5, "same day"),
          ("Charge port", "2-3 business days", 6, "2-3 BD"),
          ("Joy-Con drift", None, 7, None), ("Power IC", None, 8, None)]
for r in range(3, 6):
    device = val(ws, r, 1)
    if not device:
        continue
    for repair, tier, sc, ta in SWITCH:
        add("console", "Nintendo Switch", device, repair, tier, sc, None, None, ws, r, ta)

# HDMI ladder + parts, with the max-discount rule per turnaround tier
HDMI = [("Same day", 2, "same day", 20), ("2-3 business days", 3, "2-3 BD", 10),
        ("3-5 business days", 4, "3-5 BD", 0), ("5-10 business days", 5, "5-10 BD", 0)]
OTHER = [("SSD / HDD", 6), ("USB port", 7), ("Power supply", 8),
         ("Optical drive", 9), ("Cleaning", 10)]
for r in range(13, 25):
    device = val(ws, r, 1)
    if not device:
        continue
    grp = "Xbox" if "xbox" in device.lower() else "PlayStation"
    for tier, c, ta, maxdisc in HDMI:
        before = len(rows)
        add("console", grp, device, "HDMI port", tier, c, None, None, ws, r, ta)
        if len(rows) > before:
            rows[-1]["max_discount"] = maxdisc
    for repair, c in OTHER:
        add("console", grp, device, repair, None, c, None, None, ws, r)

# ── Windows / services ───────────────────────────────────────────────────────
ws = wb["Windows Computer "]
section = None
for r in range(3, 27):
    label = val(ws, r, 1)
    if not label:
        continue
    price = money(ws, r, 2)
    raw = val(ws, r, 2)
    note = val(ws, r, 3)
    maxd = val(ws, r, 8)
    if price is None and note is None:
        section = label
        continue
    rows.append({
        "family": "service", "model_group": section or "Services", "device": label,
        "repair": section or "Service", "tier": None,
        "set_price": price, "part_price": None, "floor_price": None, "floor_rule": None,
        "turnaround": note, "flags": [],
        "note": raw if raw and not re.fullmatch(r"\$?[\d.,]+", raw) else None,
        "max_discount": maxd,
    })

io.open(OUT, "w", encoding="utf-8").write(json.dumps(rows, indent=1))

# ── summary ──────────────────────────────────────────────────────────────────
from collections import Counter
print("parsed rows: %d" % len(rows))
print("devices: %d" % len({r["device"] for r in rows}))
print("\nby family:")
for k, v in Counter(r["family"] for r in rows).most_common():
    print("   %-10s %4d" % (k, v))
print("\nby repair:")
for k, v in Counter(r["repair"] for r in rows).most_common():
    print("   %-22s %4d" % (k, v))
print("\nrows missing a set price: %d" % sum(1 for r in rows if r["set_price"] is None))
print("rows with a floor: %d" % sum(1 for r in rows if r["floor_price"] is not None))
if problems:
    print("\nPROBLEMS FOUND IN SOURCE:")
    for p in problems:
        print("   " + p)

print("\nsample:")
for r in rows[:6]:
    print("   " + json.dumps(r))
