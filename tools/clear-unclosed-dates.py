# -*- coding: utf-8 -*-
"""
Clear date_closed on tickets that are not actually closed.

The Chrome extension assigns whatever single date it finds in the Summary
sidebar to date_closed, even when the ticket has not closed. Those tickets then
look identical to completed sales and get counted as booked revenue by
daily-profit, which buckets on date_closed and documents it as "the revenue
event - customer paid / picked up".

Measured 2026-08-31: 101 unclosed tickets were sitting in August carrying
$24,936.12 of gross sales and $9,192.01 of gross profit - exactly the gap
between our August total and RepairQ's. 46 of them were waiting_for_payment,
i.e. money not yet collected.

Status comes from the Status column of RepairQ's Profitability by Ticket export.

DRY RUN by default. Pass --apply to write.
  python tools/clear-unclosed-dates.py <export.xlsx>
  python tools/clear-unclosed-dates.py <export.xlsx> --apply
"""
import io, os, sys, json, urllib.request, openpyxl

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = {}
for line in io.open(os.path.join(REPO, ".env.local"), encoding="utf-8"):
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1); E[k.strip()] = v.strip().strip('"')
URL, KEY = E["SUPABASE_URL"], E["SUPABASE_SERVICE_ROLE_KEY"]

def api(path, method="GET", body=None, extra=None):
    req = urllib.request.Request(URL + "/rest/v1/" + path, method=method)
    req.add_header("apikey", KEY); req.add_header("Authorization", "Bearer " + KEY)
    req.add_header("Content-Type", "application/json")
    for k, v in (extra or {}).items(): req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw.strip() else []

path = sys.argv[1]
APPLY = "--apply" in sys.argv

ws = openpyxl.load_workbook(path, data_only=True)["Sheet1"]
rows = list(ws.iter_rows(values_only=True))
hdr = [str(c).strip() if c is not None else "" for c in rows[0]]
idx = {h: i for i, h in enumerate(hdr) if h}
status = {str(r[idx["Ticket #"]]): str(r[idx["Status"]]).strip().lower()
          for r in rows[1:] if r[0] is not None}

unclosed = [t for t, s in status.items() if s != "closed"]
print("export rows: %d   not closed: %d" % (len(status), len(unclosed)))
by = {}
for t in unclosed: by[status[t]] = by.get(status[t], 0) + 1
for s, c in sorted(by.items(), key=lambda x: -x[1]): print("   %-24s %d" % (s, c))

have = {}
for i in range(0, len(unclosed), 150):
    for row in api("ticket_grades?select=id,ticket_number,date_closed,gross_sales,gross_profit&ticket_number=in.(%s)"
                   % ",".join(unclosed[i:i+150])):
        have[str(row["ticket_number"])] = row

targets = [r for r in have.values() if r.get("date_closed")]
gs = sum(float(r["gross_sales"] or 0) for r in targets)
gp = sum(float(r["gross_profit"] or 0) for r in targets)
print("\nunclosed tickets present in ticket_grades : %d" % len(have))
print("  ...carrying a date_closed (will clear)  : %d" % len(targets))
print("  gross_sales $%.2f   gross_profit $%.2f  <- currently counted as booked revenue" % (gs, gp))

bym = {}
for r in targets:
    m = str(r["date_closed"])[:7]; bym[m] = bym.get(m, 0) + 1
print("  by the (wrong) month they currently sit in:")
for m in sorted(bym): print("    %s  %d" % (m, bym[m]))

if not APPLY:
    print("\nDRY RUN - nothing written. Re-run with --apply.")
    sys.exit(0)

bak = os.path.join(REPO, "rollback-unclosed-dates.json")
io.open(bak, "w", encoding="utf-8").write(json.dumps(
    [{"id": r["id"], "ticket_number": r["ticket_number"], "date_closed": r["date_closed"]} for r in targets], indent=1))
print("\nrollback snapshot: %s (%d rows)" % (bak, len(targets)))

n = 0
for r in targets:
    api("ticket_grades?id=eq.%d" % r["id"], method="PATCH",
        body={"date_closed": None}, extra={"Prefer": "return=minimal"})
    n += 1
print("APPLIED - cleared date_closed on %d rows." % n)
