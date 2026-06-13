// Minimal RFC-4180 CSV parser. Works in Node (ESM) and the browser.
// Handles quoted fields, embedded commas/newlines, escaped quotes, and a UTF-8 BOM.
// Returns an array of plain objects keyed by the header row.

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field); field = "";
      if (record.length > 1 || record[0] !== "") rows.push(record);
      record = [];
    } else field += c;
  }
  if (field !== "" || record.length) { record.push(field); rows.push(record); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i] : ""; });
    return o;
  });
}

// Tolerant number parse for Hebrew-export cells ("1,196.5", " 141 ", "₪71", "").
export function num(x) {
  if (x === null || x === undefined) return 0;
  const s = String(x).replace(/[₪,\s]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
