// Standalone test for cart logic: totals, discounts, ID threshold, FIFO origin-31, validation.
//   node test/cartStore.test.mjs
import assert from "node:assert/strict";
import { createCart, ID_THRESHOLD } from "../src/store/cartStore.js";

let pass = 0;
const check = (label, fn) => { fn(); pass++; console.log("  ✓", label); };

const prod = (over = {}) => ({ sku: "A1", name: "פריט", barcode: "111", price: 100, source: "report",
  regular: 100, sale: null, onHand: 5, isAdjustment: false,
  lots: [{ docNo: "352172", line: "1", qty: 2 }, { docNo: "352628", line: "5", qty: 3 }], ...over });

check("add + running total", () => {
  const c = createCart();
  c.addProduct(prod(), 2);
  assert.equal(c.totals().subtotal, 200);
  assert.equal(c.totals().total, 200);
  assert.equal(c.totals().itemCount, 2);
});

check("adding same SKU increments the existing line", () => {
  const c = createCart();
  c.addProduct(prod(), 1); c.addProduct(prod(), 2);
  assert.equal(c.getState().lines.length, 1);
  assert.equal(c.getState().lines[0].qty, 3);
});

check("per-item discount then whole-list discount stack correctly", () => {
  const c = createCart();
  c.addProduct(prod(), 2);            // gross 200
  c.setLineDiscount("A1", 10);        // -10% -> 180
  assert.equal(c.totals().subtotal, 180);
  c.setWholeDiscount(50);             // -50% -> 90
  assert.equal(c.totals().wholeDiscountAmount, 90);
  assert.equal(c.totals().total, 90);
});

check("ID required only above ₪5,000", () => {
  const c = createCart();
  c.addProduct(prod({ price: ID_THRESHOLD }), 1); // exactly 5000 -> not required
  assert.equal(c.totals().requiresId, false);
  c.setQty("A1", 2);                              // 10000 -> required
  assert.equal(c.totals().requiresId, true);
});

check("FIFO origin-31: 4 units split 2 (oldest 31) + 2 (next 31)", () => {
  const c = createCart();
  c.addProduct(prod(), 4);
  const [a] = c.lineAllocations();
  assert.deepEqual(a.allocation, [
    { docNo: "352172", line: "1", qty: 2 },
    { docNo: "352628", line: "5", qty: 2 },
  ]);
  assert.equal(a.shortfall, 0);
});

check("validation: blocks on empty cart, no-price (hard) and over-stock (warning)", () => {
  const c = createCart();
  assert.equal(c.validation().ok, false);                     // empty cart blocks
  c.addProduct(prod({ onHand: 1, price: 0 }), 3);             // over-stock + no-price
  c.setCustomer({ fullName: "דני", phone: "050" });
  const v = c.validation();
  assert.ok(v.overStock.includes("A1"));                      // soft warning surfaced
  assert.ok(v.noPrice.includes("A1"));
  assert.equal(v.ok, false);                                  // no-price is a hard block
  c.setUnitPrice("A1", 80); c.setQty("A1", 1);               // price set, qty within stock
  assert.equal(c.validation().ok, true);
});

check("ID-required validation error appears for big sales without ID", () => {
  const c = createCart();
  c.addProduct(prod({ price: 6000 }), 1);
  c.setCustomer({ fullName: "דני", phone: "050" });
  assert.ok(c.validation().errors.includes("id-required"));
  c.setCustomer({ idNumber: "123456789" });
  assert.equal(c.validation().ok, true);
});

check("onChange fires on mutation", () => {
  const c = createCart();
  let n = 0; const off = c.onChange(() => n++);
  c.addProduct(prod(), 1); c.setQty("A1", 2);
  off(); c.setQty("A1", 3);
  assert.equal(n, 2);
});

console.log(`\n${pass} checks passed ✅`);
