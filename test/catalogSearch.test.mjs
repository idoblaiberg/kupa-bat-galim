// Standalone test: catalog search reaches the מספר חליפי (NullFinansitAltNum), so staff can
// find an item by the alt code printed on shelf labels, not just SKU/name/barcode.
//   node test/catalogSearch.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { parseCSV } from "../src/utils/csv.js";
import { buildStock } from "../src/services/stockEngine.js";
import { buildFromStock } from "../src/services/catalog.js";

const rows = parseCSV(readFileSync("data/stock_authoritative_line_items.csv", "utf8"));
const { items } = buildStock(rows);
const cat = buildFromStock(items);

// 08C426024G50 = "חולצת גלישה ION 50/M אפור", מספר חליפי (NullFinansitAltNum) = 48242-4260/019.
const SKU = "08C426024G50";
let pass = 0;
const check = (label, fn) => { fn(); pass++; console.log("  ✓", label); };
const finds = (q) => cat.search(q, 50).some((p) => p.sku === SKU);

check("engine captures the מספר חליפי on the stock item", () => {
  assert.equal(items.get(SKU).altNum, "48242-4260/019");
});

check("search finds item by full מספר חליפי with the dash", () => assert.ok(finds("48242-4260")));
check("search finds item by מספר חליפי without the dash", () => assert.ok(finds("482424260")));
check("search finds item by a מספר חליפי prefix", () => assert.ok(finds("48242")));
check("existing search paths still work (name + barcode)", () => {
  assert.ok(finds("חולצת גלישה"));
  assert.ok(finds("9010583233758"));
});

console.log(`\n${pass} checks passed ✅`);
