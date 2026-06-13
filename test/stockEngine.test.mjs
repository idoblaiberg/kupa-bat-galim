// Standalone test: run the JS stock engine on the AUTHORITATIVE production data
// (data/stock_authoritative_line_items.csv) and assert the numbers the Python spikes proved.
//   node test/stockEngine.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { parseCSV } from "../src/utils/csv.js";
import { buildStock, allocateOrigin31 } from "../src/services/stockEngine.js";

const rows = parseCSV(readFileSync("data/stock_authoritative_line_items.csv", "utf8"));
const { items, issues } = buildStock(rows);

let pass = 0;
const check = (label, fn) => { fn(); pass++; console.log("  ✓", label); };

console.log("authoritative line rows:", rows.length);
const inStock = [...items.values()].filter((i) => Math.abs(i.onHand) > 1e-9);
const netZero = [...items.values()].filter((i) => Math.abs(i.onHand) <= 1e-9);
console.log(`distinct SKUs: ${items.size} | in-stock: ${inStock.length} | net-zero: ${netZero.length}`);
console.log("issues:", { blankSku: issues.blankSku, negative: issues.negative.length,
  unmatchedReturns: issues.unmatchedReturns.length, typeMismatch: issues.typeMismatch.length });

check("no negative on-hand", () => assert.equal(issues.negative.length, 0));

check("lot-netted on-hand == naive (sum31 - sum34) for every SKU", () => {
  for (const it of items.values())
    assert.ok(Math.abs(it.onHand - it.naiveOnHand) < 1e-6,
      `${it.sku}: lots=${it.onHand} naive=${it.naiveOnHand}`);
});

check("095A044 fully returned -> on-hand 0, no open lots", () => {
  const it = items.get("095A044");
  assert.ok(it && Math.abs(it.onHand) < 1e-9 && it.lots.length === 0);
});

check("08H25472448 fully returned -> on-hand 0", () => {
  const it = items.get("08H25472448");
  assert.ok(it && Math.abs(it.onHand) < 1e-9);
});

check("adjustment SKUs present, flagged, and counted in stock", () => {
  for (const sku of ["950062", "119999", "49999"]) {
    const it = items.get(sku);
    assert.ok(it, `missing ${sku}`);
    assert.equal(it.isAdjustment, true, `${sku} not flagged`);
  }
  assert.ok(items.get("119999").onHand > 0 && items.get("49999").onHand > 0);
});

check("every in-stock item carries at least one open 31 lot with a docNo", () => {
  for (const it of inStock) {
    assert.ok(it.lots.length >= 1, `${it.sku} has no lots`);
    assert.ok(it.lots.every((l) => l.docNo && l.qty > 0));
  }
});

check("FIFO origin-31 allocation: oldest docNo first, splits across lots, reports shortfall", () => {
  // synthetic two-lot item
  const lots = [{ docNo: "352172", line: "1", qty: 1 }, { docNo: "352628", line: "5", qty: 2 }];
  const a = allocateOrigin31(lots, 2);
  assert.deepEqual(a.allocation, [
    { docNo: "352172", line: "1", qty: 1 },
    { docNo: "352628", line: "5", qty: 1 },
  ]);
  assert.equal(a.shortfall, 0);
  assert.equal(allocateOrigin31(lots, 5).shortfall, 2);
});

console.log(`\n${pass} checks passed ✅`);
