// Seed / refresh public.repair_prices from the parsed cheat-sheet rows.
//
//   node tools/import-repair-prices.mjs <prices.json>            dry run
//   node tools/import-repair-prices.mjs <prices.json> --apply    writes
//
// Canonical keys come from lib/device-model.js and lib/repair-type.js, the same
// resolvers Price & Demand uses, so a price row lines up with its demand and
// conversion figures. Anything that will not resolve is reported, never guessed.
import fs from "fs";
import path from "path";
import { resolveModel } from "../lib/device-model.js";

const APPLY = process.argv.includes("--apply");
const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) {
  console.error("usage: node tools/import-repair-prices.mjs <prices.json> [--apply]");
  process.exit(1);
}

const env = {};
fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
});
const U = env.SUPABASE_URL;
const K = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
if (!U || !K) { console.error("SUPABASE_URL / service key missing from .env.local"); process.exit(1); }

// The sheet's repair names already line up with lib/repair-type.js except for a
// few it does not know about; map explicitly rather than fuzzily.
const REPAIR_MAP = {
  "Screen": "Screen",
  "Battery": "Battery",
  "Charge port": "Charge port",
  "Back glass": "Back glass",
  "Camera": "Camera",
  "HDMI port": "HDMI port",
  "Cleaning": "Cleaning",
  "SSD / HDD": "Drive",
  "Optical drive": "Drive",
  "Data Transfers": "Data transfer",
  "Software Fixes": "Software",
  "Power IC": "Board / solder",
  "Joy-Con drift": null,
  "USB port": "Charge port",
  "Power supply": null,
  "Upper case assembly": null,
  "Misc small parts": null,
  "Addons": null,
  "Service": null,
};

const rows = JSON.parse(fs.readFileSync(SRC, "utf8"));
let resolvedModels = 0;
const unresolved = {};

const records = rows.map((r, i) => {
  const rm = resolveModel(r.device);
  if (rm.specified) resolvedModels++;
  else unresolved[r.device] = (unresolved[r.device] || 0) + 1;
  return {
    family: r.family,
    model_group: r.model_group || null,
    device: r.device,
    repair: r.repair,
    tier: r.tier || null,
    canonical_model: rm.specified ? rm.canonical : null,
    canonical_repair: REPAIR_MAP[r.repair] ?? null,
    set_price: r.set_price,
    part_price: r.part_price,
    floor_price: r.floor_price,
    floor_rule: r.floor_rule || null,
    max_discount: typeof r.max_discount === "number" ? r.max_discount : null,
    turnaround: r.turnaround || null,
    flags: r.flags || [],
    note: r.note || null,
    sort_order: i,
    active: true,
    updated_by: "import:cheat-sheet-2026-09-11",
  };
});

const pct = (n, d) => ((n / d) * 100).toFixed(1) + "%";
console.log(`rows to import      : ${records.length}`);
console.log(`distinct devices    : ${new Set(records.map((r) => r.device)).size}`);
console.log(`canonical model set : ${resolvedModels}  ${pct(resolvedModels, records.length)}`);
console.log(`canonical repair set: ${records.filter((r) => r.canonical_repair).length}  ` +
  pct(records.filter((r) => r.canonical_repair).length, records.length));
console.log(`with a set price    : ${records.filter((r) => r.set_price != null).length}`);
console.log(`with a floor        : ${records.filter((r) => r.floor_price != null).length}`);

const un = Object.entries(unresolved).sort((a, b) => b[1] - a[1]);
console.log(`\ndevices with NO canonical model (${un.length}) — these will not join to Price & Demand:`);
un.slice(0, 20).forEach(([d, n]) => console.log(`   ×${String(n).padStart(2)}  ${d}`));
if (un.length > 20) console.log(`   ... ${un.length - 20} more`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to import.");
  process.exit(0);
}

// upsert in chunks on the natural key
let written = 0;
for (let i = 0; i < records.length; i += 200) {
  const chunk = records.slice(i, i + 200);
  const res = await fetch(`${U}/rest/v1/repair_prices?on_conflict=device,repair,tier`, {
    method: "POST",
    headers: {
      apikey: K, Authorization: `Bearer ${K}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(chunk),
  });
  if (!res.ok) {
    console.error(`FAILED at chunk ${i}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  written += (await res.json()).length;
  process.stdout.write(`  wrote ${written}/${records.length}\r`);
}
console.log(`\nimported ${written} rows`);
