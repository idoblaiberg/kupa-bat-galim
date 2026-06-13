"""
Spike: decode the catalog CSV and test whether it JOINS to the stock sheet on SKU.
The stock engine keys on ItemNo (e.g. 42AQ354, 11FC3671MB, 950062, 119999).
Search must resolve a catalog hit -> stock line to get price/on-hand/31-ref.
"""
import base64, json, csv, io, sys, collections

RAW = sys.argv[1]
OUT = "data/catalog.csv"

obj = json.load(open(RAW, encoding="utf-8"))
txt = base64.b64decode(obj["content"]).decode("utf-8", errors="replace")
open(OUT, "w", encoding="utf-8").write(txt)
print(f"=== {obj['title']} ({obj['mimeType']}) ===")

rows = list(csv.reader(io.StringIO(txt)))
header = rows[0]
data = rows[1:]
print(f"columns ({len(header)}): {header}")
print(f"data rows: {len(data)}")
print("\nfirst 2 rows:")
for r in data[:2]:
    print("  ", dict(zip(header, r)))

# Find the SKU-like column
cand = [c for c in header if c.strip() in ('מק"ט', "מק'ט", "מק״ט", "מספר פריט", "SKU", "sku", "ItemNo", "ברקוד", "Barcode")]
print(f"\ncandidate key columns present: {cand}")

# Build a set of catalog SKUs from the most likely SKU column
def colidx(names):
    for n in names:
        if n in header: return header.index(n)
    return None
i_sku = colidx(['מק"ט', "מק״ט", "מספר פריט", "SKU"])
i_bc  = colidx(["ברקוד", "Barcode", "מספר חליפי"])
print(f"chosen SKU col idx={i_sku} ({header[i_sku] if i_sku is not None else None}); "
      f"barcode col idx={i_bc} ({header[i_bc] if i_bc is not None else None})")

cat_skus = set()
if i_sku is not None:
    for r in data:
        if i_sku < len(r) and r[i_sku].strip():
            cat_skus.add(r[i_sku].strip())
print(f"distinct catalog SKUs: {len(cat_skus)}")

# Load stock SKUs we already extracted
stock_skus = set()
sr = list(csv.reader(open("data/line_items.csv", encoding="utf-8")))
sh = sr[0]; si = sh.index("ItemNo")
for r in sr[1:]:
    if r and si < len(r) and r[si].strip():
        stock_skus.add(r[si].strip())
print(f"distinct stock SKUs: {len(stock_skus)}")

# THE JOIN TEST
hit = stock_skus & cat_skus
miss = stock_skus - cat_skus
print(f"\n*** JOIN: {len(hit)}/{len(stock_skus)} stock SKUs found in catalog ***")
print(f"    {len(miss)} stock SKUs NOT in catalog")
print("    sample matched:", list(hit)[:8])
print("    sample MISSED :", list(miss)[:15])
