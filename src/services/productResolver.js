// Joins the three data sources into the single unit the UI works with.
// stock (branch on-hand + 31 lots) ⋈sku catalog (name/search) ⋈sku price report.
import { resolvePrice } from "./prices.js";
import { normCode } from "../utils/normCode.js";

// Items with no sport in the price report are grouped under this catch-all category.
export const MISC_SPORT = "שונות";

/**
 * @param {Map} stock  - from buildStock().items
 * @param {object} catalog - from parseCatalog()
 * @param {Map} priceMap - from parsePrices()
 * @param {Map} [sportMap] - sku → ענף ספורט, from parsePrices()
 */
export function createResolver(stock, catalog, priceMap, sportMap = new Map()) {
  // Barcode index: STOCK barcodes first (authoritative branch barcodes), catalog alt as fallback.
  const barcodeIndex = new Map();
  const addCode = (code, sku) => { const c = normCode(code); if (c && !barcodeIndex.has(c)) barcodeIndex.set(c, sku); };
  for (const [sku, it] of stock) addCode(it.barcode, sku);
  for (const p of catalog.products) { addCode(p.alt, p.sku); addCode(p.sku, p.sku); }
  // Resolve one SKU to a full ResolvedProduct (or null if not a real branch item).
  function resolve(sku) {
    const stockItem = stock.get(sku);
    const cat = catalog.bySku.get(sku);
    const price = resolvePrice(sku, priceMap, stockItem);
    const name = (stockItem && stockItem.name) || (cat && cat.name) || sku;
    return {
      sku,
      name,
      barcode: (stockItem && stockItem.barcode) || (cat && cat.alt) || "",
      onHand: stockItem ? stockItem.onHand : 0,
      sport: sportMap.get(sku) || null,
      inStock: !!stockItem && stockItem.onHand > 1e-9,
      isAdjustment: !!stockItem && stockItem.isAdjustment,
      lots: stockItem ? stockItem.lots : [],
      cost: stockItem ? stockItem.cost : 0,
      ...price, // price, regular, sale, source
    };
  }

  // Search catalog, annotate with branch stock + price. inStockOnly hides items not at the branch.
  function search(query, { inStockOnly = false, limit = 50 } = {}) {
    const hits = catalog.search(query, inStockOnly ? 400 : limit);
    const out = [];
    for (const p of hits) {
      const r = resolve(p.sku);
      if (inStockOnly && !r.inStock) continue;
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  // Scan path: barcode -> sku (stock barcodes first, then catalog) -> resolved.
  function resolveByBarcode(code) {
    const sku = barcodeIndex.get(normCode(code));
    return sku ? resolve(sku) : null;
  }

  // Everything currently at the branch (for an "in stock" browse view).
  function inStockList() {
    const out = [];
    for (const [sku, it] of stock) if (it.onHand > 1e-9) out.push(resolve(sku));
    return out.sort((a, b) => a.name.localeCompare(b.name, "he"));
  }

  // In-stock items for one sport branch. MISC_SPORT gathers everything with no sport.
  function inStockBySport(sport) {
    return inStockList().filter((r) => (sport === MISC_SPORT ? !r.sport : r.sport === sport));
  }

  // { sport → in-stock count }, used to render the category tiles. Only sports with ≥1
  // in-stock item appear; uncategorized items roll up under MISC_SPORT.
  function sportCounts() {
    const counts = {};
    for (const r of inStockList()) {
      const key = r.sport || MISC_SPORT;
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  return { resolve, search, resolveByBarcode, inStockList, inStockBySport, sportCounts };
}
