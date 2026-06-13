// Loads the three CSV sources, builds the resolver, and caches raw CSV in localStorage so the
// app still opens offline at the counter. Sources are configurable (published-CSV URLs); in dev
// they default to the local files in ./data. Stock is the scheduled CSV copy of the Finansit xlsx.
import { parseCSV } from "../utils/csv.js";
import { buildStock } from "./stockEngine.js";
import { parseCatalog } from "./catalog.js";
import { parsePrices } from "./prices.js";
import { createResolver } from "./productResolver.js";

const LS_SOURCES = "kupa_sources";
const LS_CACHE = "kupa_cache";

export const DEFAULT_SOURCES = {
  stock: "./data/stock_authoritative_line_items.csv",
  catalog: "./data/catalog.csv",
  prices: "./data/prices.csv",
};

export function getSources() {
  try { return { ...DEFAULT_SOURCES, ...JSON.parse(localStorage.getItem(LS_SOURCES) || "{}") }; }
  catch { return { ...DEFAULT_SOURCES }; }
}
export function setSources(s) { localStorage.setItem(LS_SOURCES, JSON.stringify(s)); }

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function build({ stock, catalog, prices }) {
  const { items, issues } = buildStock(parseCSV(stock));
  const cat = parseCatalog(parseCSV(catalog));
  const priceMap = parsePrices(parseCSV(prices));
  const resolver = createResolver(items, cat, priceMap);
  const inStock = resolver.inStockList();
  return {
    resolver,
    stats: {
      inStock: inStock.length,
      catalog: cat.products.length,
      priced: inStock.filter((r) => r.source.startsWith("report")).length,
      computed: inStock.filter((r) => r.source === "computed").length,
      noPrice: inStock.filter((r) => r.source === "unknown").length,
      issues,
    },
  };
}

/**
 * Load all sources. Tries network; on failure falls back to the cached copy.
 * @returns {{ data, fresh: boolean, cachedAt: string|null }}
 */
export async function loadData() {
  const src = getSources();
  try {
    const [stock, catalog, prices] = await Promise.all([fetchText(src.stock), fetchText(src.catalog), fetchText(src.prices)]);
    const raw = { stock, catalog, prices };
    localStorage.setItem(LS_CACHE, JSON.stringify({ raw, cachedAt: new Date().toISOString() }));
    return { data: build(raw), fresh: true, cachedAt: new Date().toISOString() };
  } catch (err) {
    const cached = localStorage.getItem(LS_CACHE);
    if (cached) {
      const { raw, cachedAt } = JSON.parse(cached);
      return { data: build(raw), fresh: false, cachedAt, error: String(err) };
    }
    throw err;
  }
}

// Manual file-upload path (Settings): pass the three CSV texts directly.
export function buildFromTexts(stock, catalog, prices) {
  const raw = { stock, catalog, prices };
  localStorage.setItem(LS_CACHE, JSON.stringify({ raw, cachedAt: new Date().toISOString() }));
  return build(raw);
}
