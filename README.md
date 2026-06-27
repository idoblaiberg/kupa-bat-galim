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

## Access & authentication

The app is restricted to three Yamit staff emails via Google Sign-In. Data is fetched directly
from Google Drive using the OAuth access token — no credentials or data are stored in the repo.

### One-time Google Cloud setup (already done — for reference)

1. **Project**: `Kupa Bat Galim` (`kupa-bat-galim`) in Google Cloud Console
2. **APIs enabled**: Google Drive API (`APIs & Services → Library → Google Drive API → Enable`)
3. **OAuth Client**: Web application, authorized JS origin: `https://idoblaiberg.github.io`
   (`APIs & Services → Credentials → OAuth 2.0 Client ID`)
4. **OAuth consent screen**: Testing mode, test users added:
   - `blaiberg.ido@gmail.com`
   - `windpointbg@gmail.com`
   - `ysbyamit@gmail.com`
5. **Client ID** is in `src/config.js` (safe to commit — useless without the Drive files)

### Data files on Google Drive

Both files must be shared with the three emails above (not public):

| Purpose | Type | Drive ID (in `src/config.js`) |
|---------|------|-------------------------------|
| Stock — Finansit 31/34 export | Google Sheet | `DRIVE.stockSheetId` |
| Prices — website price report | CSV file | `DRIVE.pricesFileId` |

> ⚠️ The stock export contains **cost** figures — files must stay private on Drive and must never be committed to the repo.

### Updating data

1. Export the new CSV from Finansit / the website
2. In Google Drive, right-click the file → **"Upload new version"** (keeps the same file ID)
3. Done — next sign-in fetches fresh data automatically

### Adding a new authorized user

1. Google Cloud Console → `APIs & Services → OAuth consent screen → Test users → Add users`
2. Add the new Gmail address
3. Share both Drive files with the new address

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
