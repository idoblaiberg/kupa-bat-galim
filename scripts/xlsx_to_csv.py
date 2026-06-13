"""Convert the authoritative stock xlsx (stdlib only) to CSV fixtures for the JS engine tests."""
import zipfile, csv, sys
import xml.etree.ElementTree as ET
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
XLSX = "data/stock_authoritative.xlsx"
z = zipfile.ZipFile(XLSX)
shared = []
if "xl/sharedStrings.xml" in z.namelist():
    for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{NS}si"):
        shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
wb = ET.fromstring(z.read("xl/workbook.xml"))
rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
sheets = []
for s in wb.find(f"{NS}sheets"):
    tgt = rels[s.get(f"{RNS}id")]
    sheets.append((s.get("name"), tgt if tgt.startswith("xl/") else "xl/" + tgt))
def cl(ref): return "".join(c for c in ref if c.isalpha())
def cn(L):
    n = 0
    for ch in L: n = n*26 + (ord(ch)-64)
    return n-1
def read_sheet(path):
    out = []
    for row in ET.fromstring(z.read(path)).iter(f"{NS}row"):
        cells = {}; mx = -1
        for c in row.findall(f"{NS}c"):
            i = cn(cl(c.get("r"))); mx = max(mx, i)
            t = c.get("t"); v = c.find(f"{NS}v"); isn = c.find(f"{NS}is")
            if t == "s" and v is not None: val = shared[int(v.text)]
            elif t == "inlineStr" and isn is not None: val = "".join(x.text or "" for x in isn.iter(f"{NS}t"))
            elif v is not None: val = v.text
            else: val = ""
            cells[i] = val
        out.append([cells.get(i, "") for i in range(mx+1)])
    return out
out = {"FinDocLines": "data/stock_authoritative_line_items.csv",
       "FinDoc": "data/stock_authoritative_headers.csv"}
for name, path in sheets:
    rows = read_sheet(path)
    target = out.get(name)
    if not target: continue
    with open(target, "w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(rows)
    print(f"wrote {target}: {len(rows)-1} data rows, {len(rows[0])} cols")
