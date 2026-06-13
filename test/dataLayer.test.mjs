// Standalone test: catalog search, price resolution, and the joined resolver — all on real CSVs.
//   node test/dataLayer.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { parseCSV } from "../src/utils/csv.js";
import { buildStock } from "../src/services/stockEngine.js";
import { parseCatalog } from "../src/services/catalog.js";
import { parsePrices, resolvePrice } from "../src/services/prices.js";
import { createResolver } from "../src/services/productResolver.js";

const stock = buildStock(parseCSV(readFileSync("data/stock_authoritative_line_items.csv", "utf8"))).items;
const catalog = parseCatalog(parseCSV(readFileSync("data/catalog.csv", "utf8")));
const priceMap = parsePrices(parseCSV(readFileSync("data/prices.csv", "utf8")));
const resolver = createResolver(stock, catalog, priceMap);

let pass = 0;
const check = (label, fn) => { fn(); pass++; console.log("  ✓", label); };
console.log(`catalog: ${catalog.products.length} products | priced SKUs: ${priceMap.size} | stock SKUs: ${stock.size}`);

check("every branch stock SKU resolves a name from catalog (full join)", () => {
  let missing = 0;
  for (const sku of stock.keys()) if (!catalog.bySku.has(sku)) missing++;
  assert.equal(missing, 0);
});

check("price from report when present, computed fallback otherwise", () => {
  // find a stock SKU that IS in the report and one that is NOT
  let inRep = null, notInRep = null;
  for (const sku of stock.keys()) {
    if (priceMap.has(sku)) inRep ??= sku; else notInRep ??= sku;
    if (inRep && notInRep) break;
  }
  const a = resolvePrice(inRep, priceMap, stock.get(inRep));
  assert.ok(a.source.startsWith("report") && a.price > 0);
  const b = resolvePrice(notInRep, priceMap, stock.get(notInRep));
  assert.equal(b.source, "computed");
  assert.equal(b.price, Math.round(stock.get(notInRep).cost * 1.18));
});

check("resolver join carries onHand, price, source, and 31 lots together", () => {
  const inStock = resolver.inStockList();
  assert.ok(inStock.length === 175, `expected 175 in-stock, got ${inStock.length}`);
  for (const r of inStock) {
    assert.ok(r.onHand > 0 && r.lots.length >= 1 && r.name);
    assert.ok(["report", "report-sale", "computed", "unknown"].includes(r.source));
  }
  const priced = inStock.filter((r) => r.source !== "unknown").length;
  console.log(`    in-stock priced: ${priced}/${inStock.length} ` +
    `(report: ${inStock.filter(r => r.source.startsWith("report")).length}, ` +
    `computed: ${inStock.filter(r => r.source === "computed").length})`);
});

check("search finds a known item by Hebrew name and annotates stock", () => {
  const hits = resolver.search("חליפה", { inStockOnly: true });
  assert.ok(hits.length > 0 && hits.every((h) => h.inStock));
});

check("scan by a known barcode resolves the right product", () => {
  // 11FC3671MB has barcode 5051678122995 in the stock data
  const r = resolver.resolveByBarcode("5051678122995");
  assert.ok(r && r.sku, "barcode 5051678122995 should resolve");
});

console.log(`\n${pass} checks passed ✅`);
