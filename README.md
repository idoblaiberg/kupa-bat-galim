# קופה — בת גלים (Kupa)

Cart-builder + branch-stock viewer for the Yamit **Bat Galim** branch. It **never charges money** —
it builds a sale, captures the customer, and produces a complete **purchase-request packet** for
main-store (ת"א) staff, who call, charge, and issue the invoice + return note (doc 34).

Responsive (mobile counter + desktop), RTL Hebrew, vanilla JS — no build step. Reuses the
[yamit-scanner](https://github.com/idoblaiberg/yamit-scanner) scan/search approach (ZXing + CSV).

## How it works
- **Stock is calculated**, never stored: `on-hand(sku) = Σ qty(31) − Σ qty(34)` from the Finansit
  delivery (31) / return (34) document lines.
- Each cart line carries its **source delivery note (31)**, FIFO-allocated, so the return note (34)
  in the packet can be pre-filled.
- **Price** comes from the website price report (`מחיר רגיל/מבצע`); items not in the report fall back
  to `round(cost × 1.18)`, flagged *מחושב*.
- **Search** is scoped to branch stock (matched via the full catalog's names/SKUs/barcodes).
- Customer **ID** is required only when the total exceeds **₪5,000**.
- The packet can be **copied** or shared to **WhatsApp**; automated Notion + WhatsApp submission is a
  follow-up (needs a small serverless endpoint to hold the Notion token).

## Data sources (configured at runtime — never committed)
Set three published-CSV URLs in the app's ⚙️ Settings (persisted per device):
1. **Stock** — scheduled CSV copy of `תעודות משלוח` (FinDocLines, `NullFinansit*` headers).
2. **Catalog** — full product list (`מספר פריט / שם פריט / מספר חליפי`).
3. **Prices** — website price report (`מק"ט / מחיר רגיל (₪) / מחיר מבצע (₪)`).

> ⚠️ The stock export contains **cost** figures — it is gitignored and must never be committed.

## Run locally
```bash
node scripts/static-server.mjs    # serves on http://localhost:8770
```
(Needs the CSV files under `data/` — not in the repo.)

## Tests (logic, run against real data)
```bash
for t in stockEngine dataLayer cartStore packet; do node test/$t.test.mjs; done
```

## Structure
- `src/services/` — stockEngine, catalog, prices, productResolver, packetBuilder, scanner, dataLoader
- `src/store/cartStore.js` — cart + discounts + totals + FIFO origin-31
- `src/ui/` — app.js, styles.css, dom.js · `index.html` — shell
- `PLAN.md` / `ARCHITECTURE.md` — design & verified data facts
