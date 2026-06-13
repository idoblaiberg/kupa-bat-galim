// Product catalog (search source) — parses 0-Z ALL PRODUCTS.csv (10.5k SKUs).
// Columns: מספר פריט (=SKU=ItemNo) · שם פריט (name) · מספר חליפי (alt/barcode) · כמות במלאי (company-wide stock).
// NOTE: כמות במלאי is COMPANY stock, NOT Bat Galim — branch on-hand comes from the stock engine.
// Search mirrors the scanner's doSearch (substring on sku/name/alt + normalized-code match).
import { norm, normCode } from "../utils/normCode.js";

const COL = { sku: "מספר פריט", name: "שם פריט", alt: "מספר חליפי", companyStock: "כמות במלאי" };

export function parseCatalog(rows) {
  const products = [];
  const bySku = new Map();
  for (const r of rows) {
    const sku = String(r[COL.sku] ?? "").trim();
    const name = String(r[COL.name] ?? "").trim();
    if (!sku && !name) continue;            // drop empty rows
    if (/^\*+.*\*+$/.test(name)) continue;  // drop "***divider***" rows (scanner does this too)
    const p = {
      sku,
      name,
      alt: String(r[COL.alt] ?? "").trim(),
      companyStock: String(r[COL.companyStock] ?? "").trim(),
    };
    products.push(p);
    if (sku) bySku.set(sku, p);
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

  // Barcode lookup (scan): match the alt/barcode field by normalized code.
  function findByBarcode(code) {
    const nc = normCode(code);
    if (!nc) return null;
    return products.find((p) => normCode(p.alt) === nc || normCode(p.sku) === nc) || null;
  }

  return { products, bySku, search, findByBarcode };
}
