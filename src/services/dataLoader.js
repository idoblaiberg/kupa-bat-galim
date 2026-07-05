// Loads the two CSV sources, builds the resolver, and caches raw CSV in localStorage so the
// app still opens offline at the counter. Sources are configurable (Google Drive / any public URL).
// Stock is the scheduled Finansit 31/34 export; prices are the website price report (optional).
import { parseCSV } from "../utils/csv.js";
import { xlsxToSheets, rowsToObjects } from "../utils/xlsx.js";
import { buildStock } from "./stockEngine.js";
import { buildFromStock } from "./catalog.js";
import { parsePrices } from "./prices.js";
import { createResolver } from "./productResolver.js";
import { DRIVE } from "../config.js";

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

// Convert a Google Sheets share/edit URL to its CSV export URL.
// Works for any sheet shared as "Anyone with the link".
function normalizeUrl(url) {
  const sheets = /docs\.google\.com\/spreadsheets\/d\/([^/?]+)/.exec(url);
  if (sheets) {
    const gid = /[?&]gid=(\d+)/.exec(url);
    return `https://docs.google.com/spreadsheets/d/${sheets[1]}/export?format=csv${gid ? `&gid=${gid[1]}` : ""}`;
  }
  return url;
}

async function fetchText(url) {
  const r = await fetch(normalizeUrl(url), { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

// Header row of the recognizable Finansit stock sheet (authoritative or personal-copy aliases).
const STOCK_SKU_HEADERS = ["NullFinansitItemNo", "ItemNo"];

// Pick the worksheet that holds the document line items (has a SKU column), then key it by header.
function stockRowsFromXlsx(sheets) {
  for (const s of sheets) {
    const header = (s.rows[0] || []).map((h) => String(h).trim());
    if (STOCK_SKU_HEADERS.some((k) => header.includes(k))) return rowsToObjects(s.rows);
  }
  const named = sheets.find((s) => s.name === "FinDocLines") || sheets[0];
  return named ? rowsToObjects(named.rows) : [];
}

// Accepts either a raw CSV string (dev/local path) or already-parsed row objects (xlsx path).
function build({ stock, stockRows, prices }) {
  const rows = stockRows || parseCSV(stock || "");
  const { items, issues } = buildStock(rows);
  const cat = buildFromStock(items);
  const { priceMap, sportMap } = parsePrices(parseCSV(prices || ""));
  const resolver = createResolver(items, cat, priceMap, sportMap);
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

// `cache: "no-store"` means every app open re-downloads the current Drive files (fresh reload).
async function driveFetch(fileId, accessToken) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (res.status === 401) throw new Error("TOKEN_EXPIRED");
  if (!res.ok) throw new Error(`Drive ${res.status}`);
  return res;
}
const fetchDriveText = (id, token) => driveFetch(id, token).then((r) => r.text());
const fetchDriveBinary = (id, token) => driveFetch(id, token).then((r) => r.arrayBuffer());

export async function loadDataAuthenticated(accessToken) {
  try {
    // Stock is an .xlsx binary (parsed in-browser); prices stay a plain CSV file.
    const [stockBuf, prices] = await Promise.all([
      fetchDriveBinary(DRIVE.stockFileId, accessToken),
      fetchDriveText(DRIVE.pricesFileId, accessToken),
    ]);
    const stockRows = stockRowsFromXlsx(await xlsxToSheets(stockBuf));
    const raw = { stockRows, prices };
    localStorage.setItem(LS_CACHE, JSON.stringify({ raw, cachedAt: new Date().toISOString() }));
    return { data: build(raw), fresh: true, cachedAt: new Date().toISOString() };
  } catch (err) {
    if (String(err).includes("TOKEN_EXPIRED")) throw err;
    const cached = localStorage.getItem(LS_CACHE);
    if (cached) {
      const { raw, cachedAt } = JSON.parse(cached);
      return { data: build(raw), fresh: false, cachedAt, error: String(err) };
    }
    throw err;
  }
}
