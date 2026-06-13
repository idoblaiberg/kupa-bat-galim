// Standalone test: packet structure + Hebrew text rendering, including source-31 + ID-over-5k.
//   node test/packet.test.mjs
import assert from "node:assert/strict";
import { createCart } from "../src/store/cartStore.js";
import { buildPacket, packetToText } from "../src/services/packetBuilder.js";

const cart = createCart();
cart.addProduct({ sku: "11D5550M", name: "חליפה 5/4 M", barcode: "", price: 2007, source: "report",
  regular: 2007, onHand: 1, lots: [{ docNo: "352628", line: "28", qty: 1 }] }, 1);
cart.addProduct({ sku: "950062", name: "קרדן STARPLATE", barcode: "", price: 374, source: "report",
  regular: 374, isAdjustment: true, onHand: 4,
  lots: [{ docNo: "352200", line: "1", qty: 3 }, { docNo: "352560", line: "2", qty: 1 }] }, 3);
cart.setCustomer({ fullName: "איתח אילן", phone: "052-429-1269", idNumber: "123456789" });

const p = buildPacket(cart);
let pass = 0; const check = (l, fn) => { fn(); pass++; console.log("  ✓", l); };

check("totals + requiresId computed", () => {
  assert.equal(p.subtotal, 2007 + 374 * 3);          // 3129
  assert.equal(p.total, 3129);
  assert.equal(p.requiresId, false);                  // < 5000
});
check("each line carries its FIFO source-31 allocation", () => {
  assert.deepEqual(p.lines[0].origin31, [{ docNo: "352628", qty: 1 }]);
  assert.deepEqual(p.lines[1].origin31, [{ docNo: "352200", qty: 3 }]); // all 3 from oldest lot
});
check("adjustment line flagged", () => assert.equal(p.lines[1].isAdjustment, true));
check("checklist includes the invoice-from-Bat-Galim reminder", () =>
  assert.ok(p.checklist.some((c) => c.includes("מבת גלים"))));
check("text render contains customer, totals, and תעודת משלוח refs", () => {
  const t = packetToText(p);
  assert.ok(t.includes("איתח אילן") && t.includes('סה"כ') && t.includes("31/352628") && t.includes("31/352200"));
});
check("ID shown only when required", () => {
  assert.ok(!packetToText(p).includes('ת"ז'));
  cart.setQty("11D5550M", 3);                          // push over 5000
  const p2 = buildPacket(cart);
  assert.ok(p2.requiresId && packetToText(p2).includes('ת"ז'));
});

console.log(`\n${pass} checks passed ✅`);
