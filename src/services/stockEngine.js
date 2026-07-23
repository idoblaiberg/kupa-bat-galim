// Stock engine — derives Bat Galim branch on-hand from Finansit delivery (31) / return (34)
// document lines. Stock is CALCULATED, never stored:  on-hand(sku) = sum qty(31) - sum qty(34).
//
// Works on the authoritative export (raw `NullFinansit*` headers) and the friendlier
// personal-sheet headers (ItemNo/DocNo/...) via field aliasing. Verified against real data in
// test/stockEngine.test.mjs (scripts/spike_*.py proved the same numbers in Python first).

import { num } from "../utils/csv.js";

// First matching header wins. Authoritative names first, personal-sheet aliases second.
const FIELD = {
  sku:     ["NullFinansitItemNo", "ItemNo"],
  name:    ["NullFinansitItemName", "ItemName"],
  cost:    ["NullFinansitItemPrice"],
  qty:     ["NullFinansitItemQuantity"],
  type:    ["NullFinansitItemDocType"],
  docNo:   ["NullFinansitItemDocNo", "DocNo"],
  origin:  ["NullFinansitItemOriginDoc", "ItemOriginDoc"],
  barcode: ["NullFinansitItmBarcode", "Barcode"],
  altNum:  ["NullFinansitAltNum", "AltNum"], // מספר חליפי — printed on shelf labels
  line:    ["NullFinansitIvlLine"],
};

// Placeholder/round-number SKUs that are real sellable products but reuse a generic mak"t
// (and carry no barcode). Counted in stock, but flagged so staff can eyeball them.
export const DEFAULT_ADJUSTMENT_SKUS = new Set(["950062", "119999", "49999"]);

function pick(row, keys) {
  for (const k of keys) if (k in row) return row[k];
  return "";
}
const get = (row, field) => String(pick(row, FIELD[field]) ?? "").trim();

// 34 lines back-reference their originating 31 as "31/{docNo}-{line}".
function parseOriginRef(origin) {
  const m = /^31\/(\d+)-(\d+)$/.exec(origin.trim());
  return m ? { docNo: m[1], line: m[2] } : null;
}
const lotKey = (docNo, line) => `${docNo}-${line}`;

/**
 * Build the branch stock map from raw document-line rows.
 * @returns {{ items: Map<string, StockItem>, issues: object }}
 *   StockItem = { sku, name, barcode, cost, onHand, naiveOnHand, isAdjustment,
 *                 lots: [{ docNo, line, qty }] }  // open 31 lots, FIFO (oldest docNo first)
 */
export function buildStock(rows, { adjustmentSkus = DEFAULT_ADJUSTMENT_SKUS } = {}) {
  const items = new Map();
  const issues = { blankSku: 0, unmatchedReturns: [], negative: [], typeMismatch: [] };

  const ensure = (sku, row) => {
    let it = items.get(sku);
    if (!it) {
      it = {
        sku,
        name: get(row, "name"),
        barcode: get(row, "barcode"),
        altNum: get(row, "altNum"),
        cost: num(get(row, "cost")),
        onHand: 0,
        naiveOnHand: 0,
        isAdjustment: adjustmentSkus.has(sku),
        lots: [],
        _lotIndex: new Map(), // key -> lot, internal
        _returns: [],         // {docNo,line,qty} pending application
      };
      items.set(sku, it);
    } else if (!it.name && get(row, "name")) {
      it.name = get(row, "name");
    }
    if (!it.barcode && get(row, "barcode")) it.barcode = get(row, "barcode");
    if (!it.altNum && get(row, "altNum")) it.altNum = get(row, "altNum");
    return it;
  };

  for (const row of rows) {
    const sku = get(row, "sku");
    // Drop blank and junk/divider SKUs (blank in the personal copy, "*" in the authoritative export).
    if (!sku || !/[0-9A-Za-z]/.test(sku)) { issues.blankSku++; continue; }
    const type = get(row, "type");
    const qty = num(get(row, "qty"));
    const it = ensure(sku, row);

    if (type === "31") {
      it.naiveOnHand += qty;
      const line = get(row, "line") || "0";
      const docNo = get(row, "docNo");
      const key = lotKey(docNo, line);
      let lot = it._lotIndex.get(key);
      if (!lot) { lot = { docNo, line, qty: 0 }; it._lotIndex.set(key, lot); it.lots.push(lot); }
      lot.qty += qty;
    } else if (type === "34") {
      it.naiveOnHand -= qty;
      const ref = parseOriginRef(get(row, "origin"));
      if (ref) it._returns.push({ ...ref, qty });
      else issues.unmatchedReturns.push({ sku, origin: get(row, "origin") });
    } else if (type !== "") {
      issues.typeMismatch.push({ sku, type });
    }
  }

  // Apply returns to their originating lots (FIFO precision for origin-31 allocation).
  for (const it of items.values()) {
    for (const r of it._returns) {
      const lot = it._lotIndex.get(lotKey(r.docNo, r.line));
      if (lot) lot.qty -= r.qty;
      else issues.unmatchedReturns.push({ sku: it.sku, origin: `31/${r.docNo}-${r.line}` });
    }
    it.lots = it.lots.filter((l) => l.qty > 1e-9).sort((a, b) => Number(a.docNo) - Number(b.docNo));
    it.onHand = it.lots.reduce((s, l) => s + l.qty, 0);
    if (it.onHand < -1e-9 || it.naiveOnHand < -1e-9) issues.negative.push({ sku: it.sku, onHand: it.onHand });
    delete it._lotIndex;
    delete it._returns;
  }
  return { items, issues };
}

/**
 * FIFO-allocate `qty` units of a sale to source 31 delivery notes.
 * Pure: does not mutate lots. Returns the per-31 split + any shortfall.
 * @returns {{ allocation: [{docNo, line, qty}], shortfall: number }}
 */
export function allocateOrigin31(lots, qty) {
  const allocation = [];
  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 1e-9) break;
    const take = Math.min(lot.qty, remaining);
    if (take > 1e-9) { allocation.push({ docNo: lot.docNo, line: lot.line, qty: take }); remaining -= take; }
  }
  return { allocation, shortfall: remaining > 1e-9 ? remaining : 0 };
}
