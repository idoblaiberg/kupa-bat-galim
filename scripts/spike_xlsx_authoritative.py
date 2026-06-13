"""
Spike: parse the AUTHORITATIVE company stock xlsx (stdlib only, no openpyxl) and
re-run the stock-engine audit on real production data. Confirms the engine holds
on the file the app will actually consume.
"""
import base64, json, sys, zipfile, io, csv, collections
import xml.etree.ElementTree as ET

RAW = sys.argv[1]
XLSX = "data/stock_authoritative.xlsx"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

obj = json.load(open(RAW, encoding="utf-8"))
open(XLSX, "wb").write(base64.b64decode(obj["content"]))
print(f"=== {obj['title']} ({obj['mimeType']}) ===")

z = zipfile.ZipFile(XLSX)

# shared strings
shared = []
if "xl/sharedStrings.xml" in z.namelist():
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    for si in root.findall(f"{NS}si"):
        shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))

# sheet name -> file, in workbook order
wb = ET.fromstring(z.read("xl/workbook.xml"))
rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
rid2tgt = {r.get("Id"): r.get("Target") for r in rels}
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
sheets = []
for s in wb.find(f"{NS}sheets"):
    tgt = rid2tgt[s.get(f"{RNS}id")]
    if not tgt.startswith("xl/"): tgt = "xl/" + tgt
    sheets.append((s.get("name"), tgt))
print("sheets:", [s[0] for s in sheets])

def col_letter(ref):  # 'AB12' -> 'AB'
    return "".join(ch for ch in ref if ch.isalpha())
def col_num(letters):
    n = 0
    for ch in letters: n = n*26 + (ord(ch)-64)
    return n-1

def read_sheet(path):
    root = ET.fromstring(z.read(path))
    out = []
    for row in root.iter(f"{NS}row"):
        cells = {}
        maxc = -1
        for c in row.findall(f"{NS}c"):
            ci = col_num(col_letter(c.get("r")))
            maxc = max(maxc, ci)
            t = c.get("t")
            v = c.find(f"{NS}v")
            isnode = c.find(f"{NS}is")
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr" and isnode is not None:
                val = "".join(x.text or "" for x in isnode.iter(f"{NS}t"))
            elif v is not None:
                val = v.text
            else:
                val = ""
            cells[ci] = val
        out.append([cells.get(i, "") for i in range(maxc+1)])
    return out

# line-items tab = first sheet
li = read_sheet(sheets[0][1])
header = li[0]
data = [r for r in li[1:] if any((x or "").strip() for x in r)]
print(f"line-items: {len(header)} cols, {len(data)} data rows")

def ci(name): return header.index(name) if name in header else None
i_item, i_type, i_qty, i_docno, i_origin, i_retail, i_name = (
    ci("ItemNo"), ci("NullFinansitItemDocType"), ci("NullFinansitItemQuantity"),
    ci("DocNo"), ci("ItemOriginDoc"), ci("מחיר מלא"), ci("ItemName"))

def num(x):
    try: return float(str(x).strip().replace(",", ""))
    except: return 0.0

tc = collections.Counter(); blank = 0
onhand = collections.defaultdict(float); names={}
for r in data:
    if i_type >= len(r): continue
    t = (r[i_type] or "").strip(); tc[t]+=1
    item = (r[i_item] or "").strip()
    if not item: blank+=1; continue
    q = num(r[i_qty])
    if t=="31": onhand[item]+=q
    elif t=="34": onhand[item]-=q
    names.setdefault(item, r[i_name] if i_name and i_name<len(r) else "")

instock=[k for k,v in onhand.items() if abs(v)>1e-9]
neg=[(k,v) for k,v in onhand.items() if v<-1e-9]
print("doctype line counts:", dict(tc), "| blank-ItemNo rows:", blank)
print(f"distinct SKUs: {len(onhand)} | in stock: {len(instock)} | "
      f"net-zero: {sum(1 for v in onhand.values() if abs(v)<=1e-9)} | NEGATIVE: {len(neg)}")
if neg: print("  NEGATIVES:", neg[:10])

# headers tab (if present) for sanity
if len(sheets) > 1:
    hd = read_sheet(sheets[1][1])
    hh = hd[0]
    print(f"\nheaders tab: {len(hd)-1} docs, cols={hh}")
    ti = hh.index("NullFinansitDocType") if "NullFinansitDocType" in hh else None
    if ti is not None:
        print("  header doctypes:", dict(collections.Counter((r[ti] or '').strip() for r in hd[1:] if any(r))))

# write line items to CSV for downstream build use
with open("data/stock_authoritative_line_items.csv","w",encoding="utf-8",newline="") as f:
    w=csv.writer(f); w.writerow(header); w.writerows(data)
print("\nwrote data/stock_authoritative_line_items.csv")
