"""
Spike: decode the price report (yamit_products.csv), verify it joins to stock on SKU,
and confirm its 'מחיר רגיל (₪)' equals the retail 'מחיר מלא' from the personal sheet
(thus the correct customer-facing price source for the cart).
"""
import base64, json, csv, io, sys

RAW = sys.argv[1]
obj = json.load(open(RAW, encoding="utf-8"))
txt = base64.b64decode(obj["content"]).decode("utf-8", errors="replace")
open("data/prices.csv", "w", encoding="utf-8").write(txt)

rows = list(csv.reader(io.StringIO(txt)))
h = rows[0]; data = rows[1:]
print(f"=== {obj['title']} ===")
print(f"columns ({len(h)}): {h}")
print(f"rows: {len(data)}")
print("first row:", dict(zip(h, data[0])))

def ci(*names):
    for n in names:
        if n in h: return h.index(n)
    return None
i_sku  = ci('מק"ט', "מק״ט", "מספר פריט")
i_reg  = ci("מחיר רגיל (₪)", "מחיר רגיל")
i_sale = ci("מחיר מבצע (₪)", "מחיר מבצע")
print(f"sku col={i_sku}({h[i_sku]}) reg={i_reg}({h[i_reg]}) sale={i_sale}({h[i_sale] if i_sale is not None else None})")

prices = {}
for r in data:
    if i_sku < len(r) and r[i_sku].strip():
        prices[r[i_sku].strip()] = r
print(f"distinct priced SKUs: {len(prices)}")

# stock SKUs + personal-sheet retail (מחיר מלא)
sr = list(csv.reader(open("data/line_items.csv", encoding="utf-8")))
sh = sr[0]; s_item = sh.index("ItemNo"); s_retail = sh.index("מחיר מלא")
stock_retail = {}
for r in sr[1:]:
    if r and r[s_item].strip():
        stock_retail.setdefault(r[s_item].strip(), r[s_retail])

stock_skus = set(stock_retail)
hit = stock_skus & set(prices)
print(f"\n*** price-report join: {len(hit)}/{len(stock_skus)} stock SKUs priced; "
      f"missing={len(stock_skus-set(prices))} ***")
print("  missing sample:", list(stock_skus - set(prices))[:10])

def num(x):
    try: return float(str(x).strip().replace(",", "").replace("₪",""))
    except: return None

print("\n--- does price-report 'מחיר רגיל' == personal-sheet 'מחיר מלא' (retail)? ---")
same = diff = 0
samples = []
for sku in hit:
    pr = num(prices[sku][i_reg])
    mm = num(stock_retail[sku])
    if pr is None or mm is None: continue
    if abs(pr - mm) < 0.5: same += 1
    else:
        diff += 1
        if len(samples) < 12:
            samples.append((sku, f"price_report={pr}", f"sheet_מחיר_מלא={mm}"))
print(f"  match: {same}   differ: {diff}")
for s in samples: print("   DIFF", s)
