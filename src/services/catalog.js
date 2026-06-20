// Product catalog (search source).
// Built directly from the stock engine's item map — no separate catalog CSV needed.
// Search: substring on sku/name/barcode + normalized-code match (mirrors yamit-scanner's doSearch).
import { norm, normCode } from "../utils/normCode.js";

/**
 * Build the in-memory catalog from the stock engine's item map.
 * @param {Map<string, StockItem>} stockItems - from buildStock().items
 */
export function buildFromStock(stockItems) {
  const products = [];
  const bySku = new Map();
  for (const [sku, it] of stockItems) {
    const p = { sku, name: it.name || sku, alt: it.barcode || "" };
    products.push(p);
    bySku.set(sku, p);
  }

  function search(query, limit = 50) {
    const lq = norm(query);
    if (lq.length < 2) return [];
    const nq = normCode(query);
    const out = [];
    for (const p of products) {
      const hit =
        norm(p.sku).includes(lq) || norm(p.name).includes(lq) || norm(p.alt).includes(lq) ||
        (nq.length >= 4 && (normCode(p.sku).includes(nq) || normCode(p.alt).includes(nq)));
      if (hit) { out.push(p); if (out.length >= limit) break; }
    }
    return out;
  }

  function findByBarcode(code) {
    const nc = normCode(code);
    if (!nc) return null;
    return products.find((p) => normCode(p.alt) === nc || normCode(p.sku) === nc) || null;
  }

  return { products, bySku, search, findByBarcode };
}
