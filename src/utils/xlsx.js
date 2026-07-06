// Minimal in-browser XLSX reader — no dependencies, no build step.
// The stock export is now an uploaded Excel file (not a native Google Sheet), so Drive can't
// export it to CSV for us; we download the raw .xlsx and parse it here.
//
// An .xlsx is a ZIP of XML parts. We read the ZIP central directory by hand, inflate each part
// with the platform DecompressionStream("deflate-raw"), and parse the SpreadsheetML with
// DOMParser — enough to turn a Finansit stock sheet into header-keyed row objects, exactly like
// parseCSV() produces. Browser-only (uses DecompressionStream/DOMParser); the Node tests feed CSV.

const RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ── ZIP container ───────────────────────────────────────────────────────────
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("הדפדפן ישן מדי לקריאת קובץ Excel — עדכנו את הדפדפן (iOS 16.4+)");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readZip(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const dec = new TextDecoder();
  // Locate the End Of Central Directory record (scan back from the end).
  let eocd = -1;
  for (let i = arrayBuffer.byteLength - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a valid xlsx (no ZIP end record)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true); // central directory offset
  const entries = new Map();
  for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { dv, bytes, entries };
}

async function extract(zip, name) {
  const e = zip.entries.get(name);
  if (!e) return null;
  const { dv, bytes } = zip;
  const lo = e.localOffset;
  if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
  // Local header extra-field length can differ from the central copy — read it here.
  const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
  const comp = bytes.subarray(start, start + e.compSize);
  if (e.method === 0) return comp;              // stored
  if (e.method === 8) return await inflateRaw(comp); // deflate
  throw new Error(`unsupported ZIP compression method ${e.method}`);
}

// ── SpreadsheetML ─────────────────────────────────────────────────────────────
function parseXml(str) { return new DOMParser().parseFromString(str, "application/xml"); }
const kids = (node, tag) => node.getElementsByTagName(tag);
const textOf = (node) => (node ? node.textContent : "");

// "AB12" → 27 (0-based column index).
function colIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const ch = ref.charCodeAt(i);
    if (ch >= 65 && ch <= 90) n = n * 26 + (ch - 64);
    else break;
  }
  return n - 1;
}

function readSharedStrings(doc) {
  const out = [];
  for (const si of kids(doc, "si")) out.push([...kids(si, "t")].map(textOf).join(""));
  return out;
}

function readSheet(doc, shared) {
  const rows = [];
  for (const row of kids(doc, "row")) {
    const cells = [];
    let max = -1;
    let auto = 0;
    for (const c of kids(row, "c")) {
      const ref = c.getAttribute("r");
      const idx = ref ? colIndex(ref) : auto;
      auto = idx + 1;
      max = Math.max(max, idx);
      const t = c.getAttribute("t");
      let val = "";
      if (t === "s") {
        const v = kids(c, "v")[0];
        if (v) val = shared[parseInt(textOf(v), 10)] ?? "";
      } else if (t === "inlineStr") {
        const is = kids(c, "is")[0];
        if (is) val = [...kids(is, "t")].map(textOf).join("");
      } else {
        val = textOf(kids(c, "v")[0]);
        // Finansit's xlsx stores every number as a float ("34.0", "352873.0") and some ids in
        // scientific form ("9.01E12"). Render integer-valued numbers plainly so doc-type / doc-no /
        // line / barcode survive the engine's exact string compares (the old CSV export had no ".0").
        if (val !== "") {
          const n = Number(val);
          if (Number.isInteger(n) && Math.abs(n) < 1e15) val = String(n);
        }
      }
      cells[idx] = val;
    }
    const arr = [];
    for (let i = 0; i <= max; i++) arr.push(cells[i] !== undefined ? cells[i] : "");
    rows.push(arr);
  }
  return rows;
}

/**
 * Parse an .xlsx ArrayBuffer into worksheets, in workbook order.
 * @returns {Promise<Array<{ name: string, rows: string[][] }>>}
 */
export async function xlsxToSheets(arrayBuffer) {
  const zip = readZip(arrayBuffer);
  const dec = new TextDecoder();
  const read = async (path) => { const b = await extract(zip, path); return b ? dec.decode(b) : null; };

  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = sharedXml ? readSharedStrings(parseXml(sharedXml)) : [];

  const wb = parseXml(await read("xl/workbook.xml"));
  const relsDoc = parseXml(await read("xl/_rels/workbook.xml.rels"));
  const rels = {};
  for (const r of kids(relsDoc, "Relationship")) rels[r.getAttribute("Id")] = r.getAttribute("Target");

  const sheets = [];
  for (const s of kids(wb, "sheet")) {
    const rid = s.getAttributeNS(RNS, "id") || s.getAttribute("r:id");
    let target = rels[rid] || "";
    target = target.replace(/^\//, "");
    if (!target.startsWith("xl/")) target = "xl/" + target;
    const xml = await read(target);
    if (!xml) continue;
    sheets.push({ name: s.getAttribute("name") || "", rows: readSheet(parseXml(xml), shared) });
  }
  return sheets;
}

/**
 * Turn a 2-D sheet (first row = headers) into header-keyed objects, matching parseCSV() output.
 */
export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i] : ""; });
    return o;
  });
}
