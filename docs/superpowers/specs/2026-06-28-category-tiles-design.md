# Category tiles — design spec

**Date:** 2026-06-28  
**Status:** Approved

## Context

The Kupa Bat Galim app shows all ~199 in-stock items on load, which is overwhelming when a customer or staff member wants to browse by product type. The app already has a working text search (by name/SKU/barcode) but provides no way to discover or filter by sport category. The goal is to add category-based browsing without adding visual weight to the already dense UI.

## Approach: empty-state category tile grid

When the search box is empty, replace the wall of 199 items with a grid of category tiles — one per sport branch (`ענף ספורט`) that has at least one in-stock item at Bat Galim. Tapping a tile filters the list to that category. Clearing the search returns to the tiles.

## Category data source

Source: `data/prices.csv`, columns `ענף ספורט` (level 1) and `קטגוריה` (level 2).  
Only level-1 (`ענף ספורט`) is used for tiles. Level-2 is not surfaced in this version.  
Only categories with ≥ 1 in-stock item at Bat Galim appear as tiles.  
SKUs with no match in `prices.csv` are grouped into a `שונות` catch-all tile (shown last, full-width).

## Interaction flow

1. App loads, search box empty → category tile grid is shown; results div is hidden.
2. User taps a tile → search box fills with the exact `ענף ספורט` string (e.g. `"ווינג פויל"`) → tile grid hides → results show all in-stock items for that sport → section label updates to `"ווינג פויל (N)"`.
3. User clears the search box (X button or backspace to empty) → tile grid reappears.
4. User types freely → standard product text search (name / SKU / barcode); tile grid never appears while input is non-empty.
5. Exception: if the typed string exactly matches an `ענף ספורט` name, it behaves identically to tapping that tile.

## Data layer changes

All changes are additive — no existing behavior changes.

**`src/services/prices.js`**  
Extend `parsePrices()` to also build and return a `sportMap: { sku → ענף_ספורט }` alongside the existing price map.

**`src/services/productResolver.js`**  
`resolve(sku)` already joins stock + catalog + price. Add a `sport` field sourced from `sportMap`. SKUs without a match get `sport: null`.  
Add two new methods:
- `inStockBySport(sportName)` — filters `inStockList()` to items where `item.sport === sportName`. Items with `sport: null` are returned by `inStockBySport('שונות')`.
- `sportCounts()` — returns `{ sportName → count }` computed once at load, only for sports with ≥ 1 in-stock item. Always includes `שונות` if any uncategorized items exist.

## UI changes

**`index.html`**  
Add `<div id="category-grid" class="category-grid"></div>` between the search bar and the section label. Hidden by default via CSS.

**`src/ui/app.js`**  
- On load: call `showCategoryGrid()` instead of `showInStock()`.
- `showCategoryGrid()`: reads `resolver.sportCounts()`, renders `.cat-tile` buttons, hides `#results`, shows `#category-grid`.
- Search `input` event: if empty → `showCategoryGrid()`; if value exactly matches a sport name → `showBySport(sport)`; otherwise → existing `resolver.search()` path.
- Tile click handler: sets `searchInput.value = sportName`, dispatches an `input` event (reuses existing flow).
- Section label: shows `"מה מחפשים?"` when tile grid is active; shows `"{sport} (N)"` when a category is selected; shows `"במלאי בבת גלים (N)"` when doing a free-text search.

**`index.html`** — search bar  
Add a clear button (`<button id="search-clear">`) inside the search bar, shown only when the input is non-empty (toggled via a `.hidden` class). Tapping it clears the input and fires the `input` event, which triggers `showCategoryGrid()`.

**`src/ui/styles.css`**  
New classes only:
- `.category-grid`: `display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 4px 12px 14px;`
- `.cat-tile`: card-like button, brand-teal border on hover/active, sport name + count, min tap target 48px.
- `.cat-tile.misc`: full-width (`grid-column: span 2`), muted background.
- `#search-clear.hidden`: `display: none;`

## Verification

1. Load the app — category tile grid appears; results are hidden.
2. Confirm only categories with in-stock items are shown (no empty tiles).
3. Tap a tile — search box fills, grid hides, results show only items in that category, section label updates.
4. Tap X (or backspace to empty) — grid reappears.
5. Type a product name — grid stays hidden, standard search results appear.
6. Type an exact `ענף ספורט` string manually — same result as tapping the tile.
7. Confirm `שונות` tile appears and shows uncategorized items correctly.
8. Add an item to cart from a category-filtered list — cart behavior unaffected.
