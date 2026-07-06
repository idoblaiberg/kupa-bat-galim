// Loads the two CSV sources, builds the resolver, and caches raw CSV in localStorage so the
// app still opens offline at the counter. Sources are configurable (Google Drive / any public URL).
// Stock is the scheduled Finansit 31/34 export; prices are the website price report (optional).
import { parseCSV } from "../utils/csv.js";
import { xlsxToSheets, rowsToObjects } from "../utils/xlsx.js";
import { buildStock } from "./stockEngine.js";
import { buildFromStock } from "./catalog.js";
import { parsePrices } from "./prices.js";
import { createResolver } from "./productResolver.js";
import { DRIVE, ADMIN_EMAILS } from "../config.js";
import { getUserEmail } from "../auth.js";

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
export function clearSources() { localStorage.removeItem(LS_SOURCES); }
// Raw admin override only (no ./data defaults) — for the Settings screen: empty = shared default.
export function getSourceOverride() {
  try { return JSON.parse(localStorage.getItem(LS_SOURCES) || "{}"); } catch { return {}; }
}

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

// Extract a Drive/Sheets file id from any share/edit/view URL (…/d/<id>/… or …?id=<id>).
// Lets the Settings link actually control the signed-in source; non-URLs (dev ./data paths) → null.
export function driveIdFromUrl(url) {
  const m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(url || "") || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(url || "");
  return m ? m[1] : null;
}

// Header row of the recognizable Finansit stock sheet (authoritative or personal-copy aliases).
const STOCK_SKU_HEADERS = ["NullFinansitItemNo", "ItemNo"];

// Pick the worksheet that holds the document line items (has a SKU column), then key it by header.
// If nothing matches, fail loudly with what we DID find — a silent empty catalog looks like a
// broken app, so surface the sheet names + headers to make a wrong file/format obvious.
function stockRowsFromXlsx(sheets) {
  for (const s of sheets) {
    const header = (s.rows[0] || []).map((h) => String(h).trim());
    if (STOCK_SKU_HEADERS.some((k) => header.includes(k))) return rowsToObjects(s.rows);
  }
  const found = sheets.map((s) => `"${s.name}" [${(s.rows[0] || []).slice(0, 8).join(", ")}]`).join(" · ");
  throw new Error(
    `לא נמצאה עמודת מק"ט (${STOCK_SKU_HEADERS.join(" / ")}) בקובץ המלאי. ` +
    `גיליונות שנמצאו: ${found || "אין"}`
  );
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
const authHeaders = (accessToken) => ({ headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });

async function driveGet(fileId, accessToken, { export: exportMime } = {}) {
  const base = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const url = exportMime ? `${base}/export?mimeType=${encodeURIComponent(exportMime)}` : `${base}?alt=media`;
  const res = await fetch(url, authHeaders(accessToken));
  if (res.status === 401) throw new Error("TOKEN_EXPIRED");
  return res;
}

// Stock may be an uploaded .xlsx (downloadable as binary) OR a native Google Sheet (which Drive
// refuses to alt=media with 403 — it must be exported). Handle both so the file "just works".
async function fetchStockRows(fileId, accessToken) {
  const media = await driveGet(fileId, accessToken);
  if (media.ok) return stockRowsFromXlsx(await xlsxToSheets(await media.arrayBuffer()));
  if (media.status === 403) {
    const csv = await driveGet(fileId, accessToken, { export: "text/csv" });
    if (!csv.ok) throw new Error(`Drive export ${csv.status}`);
    return parseCSV(await csv.text());
  }
  throw new Error(`Drive ${media.status}`);
}

async function fetchDriveText(fileId, accessToken) {
  const res = await driveGet(fileId, accessToken);
  if (!res.ok) throw new Error(`Drive ${res.status}`);
  return res.text();
}

export async function loadDataAuthenticated(accessToken) {
  try {
    // Everyone loads the file ids baked into config (DRIVE). Only an admin's Settings override
    // (a Drive/Sheets link on their own device) can repoint it — regular staff always get the
    // shared default, so opening the app "just works" with no settings to touch.
    const src = ADMIN_EMAILS.includes(getUserEmail()) ? getSources() : {};
    const stockId = driveIdFromUrl(src.stock) || DRIVE.stockFileId;
    const pricesId = driveIdFromUrl(src.prices) || DRIVE.pricesFileId;
    // Stock is parsed to rows (xlsx or Sheet); prices stay a plain CSV file.
    const [stockRows, prices] = await Promise.all([
      fetchStockRows(stockId, accessToken),
      fetchDriveText(pricesId, accessToken),
    ]);
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
