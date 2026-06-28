// Price resolution. Customer-facing price comes from the website price report
// (yamit_products.csv): מק"ט · מחיר רגיל (₪) · מחיר מבצע (₪). The report only covers ~56/183
// in-stock SKUs, so for the rest we fall back to round(cost × 1.18) — flagged "computed"
// (verified: retail == cost×1.18 on 177/181 sampled SKUs). cost = NullFinansitItemPrice.
import { num } from "../utils/csv.js";

const COL = { sku: 'מק"ט', regular: "מחיר רגיל (₪)", sale: "מחיר מבצע (₪)", sport: "ענף ספורט" };
export const VAT_MARKUP = 1.18; // retail ≈ cost incl. 18% VAT

/**
 * Parse the website price report. Besides the customer price, it carries the product
 * taxonomy (ענף ספורט = sport branch) used for category browsing — note this only covers
 * the ~30% of branch SKUs that exist on the website; the rest stay uncategorized (→ "שונות").
 * @returns {{ priceMap: Map, sportMap: Map }}
 */
export function parsePrices(rows) {
  const priceMap = new Map();
  const sportMap = new Map();
  for (const r of rows) {
    const sku = String(r[COL.sku] ?? "").trim();
    if (!sku) continue;
    priceMap.set(sku, { regular: num(r[COL.regular]), sale: num(r[COL.sale]) });
    const sport = String(r[COL.sport] ?? "").trim();
    if (sport) sportMap.set(sku, sport);
  }
  return { priceMap, sportMap };
}

/**
 * Resolve the customer-facing price for a SKU.
 * @returns { price, regular, sale|null, source: 'report-sale'|'report'|'computed'|'unknown' }
 */
export function resolvePrice(sku, priceMap, stockItem) {
  const rep = priceMap.get(sku);
  if (rep && rep.regular > 0) {
    const onSale = rep.sale > 0 && rep.sale !== rep.regular;
    return {
      price: onSale ? rep.sale : rep.regular,
      regular: rep.regular,
      sale: onSale ? rep.sale : null,
      source: onSale ? "report-sale" : "report",
    };
  }
  const cost = stockItem ? stockItem.cost : 0;
  if (cost > 0) {
    return { price: Math.round(cost * VAT_MARKUP), regular: Math.round(cost * VAT_MARKUP), sale: null, source: "computed" };
  }
  return { price: 0, regular: 0, sale: null, source: "unknown" };
}
