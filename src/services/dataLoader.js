// Loads the two CSV sources, builds the resolver, and caches raw CSV in localStorage so the
// app still opens offline at the counter. Sources are configurable (Google Drive / any public URL).
// Stock is the scheduled Finansit 31/34 export; prices are the website price report (optional).
import { parseCSV } from "../utils/csv.js";
import { buildStock } from "./stockEngine.js";
import { buildFromStock } from "./catalog.js";
import { parsePrices } from "./prices.js";
import { createResolver } from "./productResolver.js";

const LS_SOURCES = "kupa_sources";
const LS_CACHE = "kupa_cache";

export const DEFAULT_SOURCES = {
  stock: "./data/stock_authoritative_line_items.csv",
  prices: "./data/prices.csv",
};

export function getSources() {
  try { return { ...DEFAULT_SOURCES, ...JSON.parse(localStorage.getItem(LS_SOURCES) || "{}") }; }
  catch { return { ...DEFAULT_SOURCES }; }
}
export function setSources(s) { localStorage.setItem(LS_SOURCES, JSON.stringify(s)); }

// Normalise Google Drive share links to direct-download URLs.
function normalizeUrl(url) {
  const fileMatch = /drive\.google\.com\/file\/d\/([^/?]+)/.exec(url);
  if (fileMatch) return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
  const openMatch = /drive\.google\.com\/open\?.*[?&]id=([^&]+)/.exec(url);
  if (openMatch) return `https://drive.google.com/uc?export=download&id=${openMatch[1]}`;
  const sheetsMatch = /docs\.google\.com\/spreadsheets\/d\/([^/?]+)/.exec(url);
  if (sheetsMatch) return `https://docs.google.com/spreadsheets/d/${sheetsMatch[1]}/export?format=csv`;
  return url;
}

async function fetchText(url) {
  const r = await fetch(normalizeUrl(url), { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function build({ stock, prices }) {
  const { items, issues } = buildStock(parseCSV(stock));
  const cat = buildFromStock(items);
  const priceMap = parsePrices(parseCSV(prices || ""));
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
    const [stock, prices] = await Promise.all([
      fetchText(src.stock),
      src.prices ? fetchText(src.prices) : Promise.resolve(""),
    ]);
    const raw = { stock, prices };
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
