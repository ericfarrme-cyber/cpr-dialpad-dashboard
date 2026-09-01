# -*- coding: utf-8 -*-
"""
Import RepairQ's "Profitability by Ticket" export into ticket_grades.

The report is RepairQ's own profitability calculation, net of returns, restock
fees and discounts. It is authoritative in a way the scraped ticket page is not:
the page shows the transaction as originally rung, the report shows the money.

DRY RUN by default. Pass --apply to write.

Usage:
  python import_profitability.py <xlsx>            # show the diff
  python import_profitability.py <xlsx> --apply    # write it
"""
import io, sys, json, urllib.request, openpyxl

import os
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root

def env():
    e = {}
    for line in io.open(REPO + r"\.env.local", encoding="utf-8"):
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            e[k.strip()] = v.strip().strip('"')
    return e

E = env()
URL = E["SUPABASE_URL"]
KEY = E["SUPABASE_SERVICE_ROLE_KEY"]

def api(path, method="GET", body=None, extra=None):
    req = urllib.request.Request(URL + "/rest/v1/" + path, method=method)
    req.add_header("apikey", KEY)
    req.add_header("Authorization", "Bearer " + KEY)
    req.add_header("Content-Type", "application/json")
    for k, v in (extra or {}).items():
        req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw.strip() else []

def money(v):
    if v is None: return 0.0
    if isinstance(v, (int, float)): return round(float(v), 2)
    s = str(v).strip().replace("$", "").replace(",", "")
    neg = s.startswith("(") or s.startswith("-")
    s = s.strip("()-")
    try: n = float(s)
    except ValueError: return 0.0
    return round(-n if neg else n, 2)

path = sys.argv[1]
APPLY = "--apply" in sys.argv

ws = openpyxl.load_workbook(path, data_only=True)["Sheet1"]
rows = list(ws.iter_rows(values_only=True))
hdr = [str(c).strip() if c is not None else "" for c in rows[0]]
idx = {h: i for i, h in enumerate(hdr) if h}

recs = {}
for r in rows[1:]:
    if r[idx["Ticket #"]] is None: continue
    tn = str(r[idx["Ticket #"]]).strip()
    recs[tn] = {
        "gross_sales":  money(r[idx["Gross Sales"]]),
        "returns":      money(r[idx["Gross Returns"]]),
        "restock":      money(r[idx["Restock Fees"]]),
        "discount":     money(r[idx["Net Discounts"]]),
        "net_sales":    money(r[idx["Net Sales"]]),
        "cogs":         money(r[idx["COGS"]]),
        "gp":           money(r[idx["GP"]]),
        "gpm":          (lambda v: round(float(str(v).replace("%","").strip() or 0), 2))(r[idx["GPM %"]]),
    }
print("export rows: %d" % len(recs))

# Verify RepairQ's own identity before trusting any of it.
bad = [t for t, v in recs.items()
       if abs((v["gross_sales"] - v["returns"] + v["restock"] - v["discount"]) - v["net_sales"]) > 0.02
       or abs((v["net_sales"] - v["cogs"]) - v["gp"]) > 0.02]
print("rows where RepairQ's own arithmetic does not tie: %d %s" % (len(bad), bad[:5] if bad else ""))

ids = list(recs.keys())
have = {}
for i in range(0, len(ids), 150):
    chunk = ids[i:i+150]
    for row in api("ticket_grades?select=id,ticket_number,store,gross_sales,gross_profit,total_cost,discount_amount&ticket_number=in.(%s)" % ",".join(chunk)):
        have[str(row["ticket_number"])] = row

print("matched in ticket_grades: %d   not graded (skipped): %d" % (len(have), len(recs) - len(have)))

changes, unchanged = [], 0
for tn, v in recs.items():
    cur = have.get(tn)
    if not cur: continue
    def f(x): return round(float(x or 0), 2)
    delta = {}
    if f(cur["gross_sales"])   != v["gross_sales"]: delta["gross_sales"]     = (f(cur["gross_sales"]), v["gross_sales"])
    if f(cur["total_cost"])    != v["cogs"]:        delta["total_cost"]      = (f(cur["total_cost"]), v["cogs"])
    if f(cur["discount_amount"])!= v["discount"]:   delta["discount_amount"] = (f(cur["discount_amount"]), v["discount"])
    if f(cur["gross_profit"])  != v["gp"]:          delta["gross_profit"]    = (f(cur["gross_profit"]), v["gp"])
    if delta: changes.append((tn, cur, v, delta))
    else: unchanged += 1

print("\nrows already correct: %d" % unchanged)
print("rows that would change: %d\n" % len(changes))

gp_before = sum(round(float(c[1]["gross_profit"] or 0), 2) for c in changes)
gp_after  = sum(c[2]["gp"] for c in changes)
print("  gross_profit across changing rows:  before $%.2f   after $%.2f   swing $%.2f\n" % (gp_before, gp_after, gp_after - gp_before))

print("  ticket      field              before ->      after")
for tn, cur, v, delta in changes[:25]:
    for k, (b, a) in delta.items():
        print("  %-11s %-16s %10.2f -> %10.2f" % (tn, k, b, a))
if len(changes) > 25:
    print("  ... and %d more rows" % (len(changes) - 25))

if not APPLY:
    print("\nDRY RUN — nothing written. Re-run with --apply to commit.")
    sys.exit(0)

# Rollback snapshot BEFORE any write. These columns feed Daily Profit and
# Duncan's bonus; there must be a way back.
import os
bak = os.path.join(REPO, "rollback-ticket-financials.json")  # gitignored
snap = [{"id": c[1]["id"], "ticket_number": c[0],
         "gross_sales": c[1]["gross_sales"], "total_cost": c[1]["total_cost"],
         "discount_amount": c[1]["discount_amount"], "gross_profit": c[1]["gross_profit"]}
        for c in changes]
io.open(bak, "w", encoding="utf-8").write(json.dumps(snap, indent=1))
print("rollback snapshot: %s (%d rows)" % (bak, len(snap)))

n = 0
for tn, cur, v, delta in changes:
    api("ticket_grades?id=eq.%d" % cur["id"], method="PATCH",
        body={"gross_sales": v["gross_sales"], "total_cost": v["cogs"],
              "discount_amount": v["discount"], "gross_profit": v["gp"],
              "gpm_pct": v["gpm"]},
        extra={"Prefer": "return=minimal"})
    n += 1
    if n % 250 == 0: print("  ...%d / %d" % (n, len(changes)))
print("\nAPPLIED — updated %d rows." % n)
