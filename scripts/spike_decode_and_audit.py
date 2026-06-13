"""
Spike: decode the Drive CSV export of the Finansit line-items tab and audit it.
Critical questions:
  1. Is the line-items tab COMPLETE? (How many type-31 vs type-34 lines really exist?)
  2. Does the 31-34 stock math behave sanely on real data?
  3. Any blank ItemNo rows / adjustment SKUs (119999, 49999, ...)?
"""
import base64, json, csv, io, sys, collections

RAW = sys.argv[1]  # path to the JSON tool-result file
OUT = "data/line_items.csv"

obj = json.load(open(RAW, encoding="utf-8"))
csv_text = base64.b64decode(obj["content"]).decode("utf-8")
open(OUT, "w", encoding="utf-8").write(csv_text)

rows = list(csv.reader(io.StringIO(csv_text)))
header = rows[0]
data = rows[1:]
print(f"=== FILE: {obj['title']}  ({obj['mimeType']}) ===")
print(f"columns: {len(header)}  data rows: {len(data)}")

def col(name):
    return header.index(name) if name in header else None

i_item   = col("ItemNo")
i_type   = col("NullFinansitItemDocType")
i_qty    = col("NullFinansitItemQuantity")
i_docno  = col("DocNo")
i_origin = col("ItemOriginDoc")
i_retail = col("מחיר מלא")
i_name   = col("ItemName")
i_bc     = col("Barcode")
print("indices:", dict(item=i_item,type=i_type,qty=i_qty,docno=i_docno,origin=i_origin,retail=i_retail,bc=i_bc))

# --- audit 1: doctype distribution at LINE level ---
type_counts = collections.Counter()
blank_item = 0
for r in data:
    if not r or i_type >= len(r):
        continue
    t = (r[i_type] or "").strip()
    type_counts[t] += 1
    if not (r[i_item] or "").strip():
        blank_item += 1
print("\n--- doctype line counts ---")
for t, c in sorted(type_counts.items()):
    print(f"  type {t!r}: {c} lines")
print(f"  blank ItemNo rows: {blank_item}")

# --- audit 2: stock math (sum qty by ItemNo, signed by type) ---
def num(x):
    x = (x or "").strip().replace(",", "")
    try: return float(x)
    except: return 0.0

onhand = collections.defaultdict(float)
names, retail, barcodes = {}, {}, {}
origin34 = collections.defaultdict(list)  # itemno -> list of 31 refs from 34 lines
for r in data:
    if not r or not (r[i_item] or "").strip():
        continue
    item = r[i_item].strip()
    t = (r[i_type] or "").strip()
    q = num(r[i_qty])
    if t == "31":
        onhand[item] += q
    elif t == "34":
        onhand[item] -= q
        origin34[item].append(r[i_origin].strip())
    names.setdefault(item, r[i_name])
    retail.setdefault(item, r[i_retail])
    barcodes.setdefault(item, r[i_bc])

in_stock = {k: v for k, v in onhand.items() if abs(v) > 1e-9}
zeroed   = {k: v for k, v in onhand.items() if abs(v) <= 1e-9}
negative = {k: v for k, v in onhand.items() if v < -1e-9}

print("\n--- stock summary ---")
print(f"  distinct ItemNo: {len(onhand)}")
print(f"  in stock (onhand != 0): {len(in_stock)}")
print(f"  net zero (fully returned): {len(zeroed)}")
print(f"  NEGATIVE onhand (returned more than delivered?!): {len(negative)}")
for k, v in negative.items():
    print(f"     {k} = {v}  origin34={origin34.get(k)}  name={names[k]}")

print("\n--- sample of items net-zeroed by a 34 ---")
shown = 0
for k, v in zeroed.items():
    if origin34.get(k):
        print(f"  {k}: onhand=0  via 34 ref {origin34[k]}  name={names[k]}")
        shown += 1
    if shown >= 10: break

# --- audit 3: adjustment / utility SKUs ---
print("\n--- adjustment/utility SKU check ---")
ADJ = {"119999", "49999"}
found_adj = [k for k in onhand if k in ADJ or "starplate" in names.get(k,"").lower()]
print("  flagged adjustment SKUs present:", found_adj or "NONE in this export")

# --- audit 4: barcode coverage ---
have_bc = sum(1 for k in in_stock if (barcodes.get(k) or "").strip())
print(f"\n--- barcode coverage (in-stock items) ---")
print(f"  {have_bc}/{len(in_stock)} in-stock items have a barcode "
      f"({len(in_stock)-have_bc} would be search-only)")
