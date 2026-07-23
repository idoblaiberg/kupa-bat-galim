// Kupa app — boot, render, and wire the whole flow. Vanilla ES modules, RTL Hebrew.
import { loadDataAuthenticated, setSources, clearSources, getSourceOverride } from "../services/dataLoader.js?v=6";
import { MISC_SPORT } from "../services/productResolver.js";
import { initAuth, signOut, getUserEmail } from "../auth.js";
import { ADMIN_EMAILS } from "../config.js";
import { saveSale, getSales, deleteSale, clearAllSales } from "../services/salesLog.js";
import { createCart } from "../store/cartStore.js";
import { buildPacket, packetToText } from "../services/packetBuilder.js";
import { formatILS } from "../utils/money.js";
import { el, create, clear, toast } from "./dom.js";

// Barcode capture is delegated to the sibling yamit-scanner app (same origin).
const SCANNER_URL = "../yamit-scanner/";

let resolver, cart, stats;

boot();

async function boot() {
  await initAuth(async (accessToken) => {
    try {
      const { data, fresh, cachedAt } = await loadDataAuthenticated(accessToken);
      resolver = data.resolver; stats = data.stats;
      cart = createCart();
      cart.onChange(renderCart);
      cart.hydrateFromStorage();
      wireUI();
      setFreshness(fresh, cachedAt);
      showCategoryGrid();
      // Loaded fine but nothing in stock → almost always a file/format mismatch, not a real
      // empty branch. Explain it instead of showing a blank grid that reads as "broken".
      if (fresh && stats.inStock === 0) {
        el("categoryGrid").classList.add("hidden");
        const box = el("results");
        box.classList.remove("hidden");
        clear(box);
        box.append(create("div", { class: "empty" },
          "הקובץ נטען אך לא נמצאו פריטים במלאי. ודאו שקובץ המלאי הוא ייצוא Finansit (תעודות 31/34) עם עמודות מק\"ט/כמות/סוג."));
      }
      renderCart(cart.getState());
      consumeScanHash();
    } catch (e) {
      if (String(e).includes("TOKEN_EXPIRED")) { sessionStorage.clear(); location.reload(); return; }
      console.error("loadDataAuthenticated failed:", e);
      const pill = el("freshPill");
      pill.textContent = "שגיאה בטעינה"; pill.classList.add("stale");
      el("categoryGrid").classList.add("hidden");
      const box = el("results");
      box.classList.remove("hidden"); // was hidden by default — otherwise the error is invisible
      clear(box);
      box.append(create("div", { class: "empty" }, `שגיאה בטעינת הנתונים: ${e.message || e}`));
    }
  });
}

function setFreshness(fresh, cachedAt) {
  const pill = el("freshPill");
  const status = fresh ? `${stats.inStock} פריטים במלאי` : "נתונים מהמטמון (לא עודכן)";
  pill.textContent = status;
  pill.classList.toggle("stale", !fresh);
  // Text may be ellipsis-truncated on narrow screens — the title keeps the full status reachable.
  pill.title = `${status} · מחיר מהדוח: ${stats.priced} · מחושב: ${stats.computed} · ללא מחיר: ${stats.noPrice}`;
}

// ── Catalog / search ──────────────────────────────────────────────────────
let searchTimer;
function wireUI() {
  el("signOutBtn").addEventListener("click", () => {
    const email = getUserEmail() || "";
    if (confirm(`מחובר: ${email}\n\nלהתנתק?`)) signOut();
  });
  el("signOutBtn").title = getUserEmail() || "התנתק";
  // Settings is admin-only — regular staff never see the gear and always get the shared file.
  if (!ADMIN_EMAILS.includes(getUserEmail())) el("settingsBtn").style.display = "none";
  el("searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    const trimmed = q.trim();
    el("searchClear").classList.toggle("hidden", trimmed.length === 0);
    // Empty → category tiles. Exact category name (incl. "שונות") → that category's items.
    // Otherwise scope a text search to branch stock (every sellable line needs a source-31);
    // the catalog powers matching (rich names + barcodes) but results stay limited to Bat Galim.
    searchTimer = setTimeout(() => {
      if (!trimmed) return showCategoryGrid();
      if (resolver.sportCounts()[trimmed] != null) return showBySport(trimmed);
      const list = resolver.search(q, { inStockOnly: true, limit: 60 });
      el("catalogLbl").textContent = `במלאי בבת גלים (${list.length})`;
      showResults(list);
    }, 160);
  });
  el("searchClear").addEventListener("click", () => {
    el("searchInput").value = "";
    el("searchClear").classList.add("hidden");
    showCategoryGrid();
    el("searchInput").focus();
  });
  el("scanBtn").addEventListener("click", openScanner);
  el("historyBtn").addEventListener("click", openHistory);
  el("settingsBtn").addEventListener("click", openSettings);
  el("openCartBtn").addEventListener("click", () => openSheet("cartSheet"));
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeSheet(b.dataset.close)));
}

// Empty-search landing: a grid of sport-branch tiles instead of the full 199-item wall.
function showCategoryGrid() {
  el("catalogLbl").textContent = "מה מחפשים?";
  el("results").classList.add("hidden");
  const grid = el("categoryGrid");
  clear(grid);
  grid.classList.remove("hidden");
  const counts = resolver.sportCounts();
  // Count desc, but the "שונות" catch-all always sits last.
  Object.entries(counts)
    .sort((a, b) => (a[0] === MISC_SPORT ? 1 : b[0] === MISC_SPORT ? -1 : b[1] - a[1]))
    .forEach(([sport, n]) => grid.append(categoryTile(sport, n)));
}
function categoryTile(sport, n) {
  return create("button", { class: "cat-tile" + (sport === MISC_SPORT ? " misc" : ""),
    onclick: () => { el("searchInput").value = sport; el("searchClear").classList.remove("hidden"); showBySport(sport); } },
    create("span", { class: "cat-name" }, sport),
    create("span", { class: "cat-count" }, `${n} פריטים במלאי`));
}
// All in-stock items for one sport branch.
function showBySport(sport) {
  const list = resolver.inStockBySport(sport);
  el("catalogLbl").textContent = `${sport} (${list.length})`;
  showResults(list);
}
function showResults(list) {
  el("categoryGrid").classList.add("hidden");
  const box = el("results");
  box.classList.remove("hidden");
  clear(box);
  if (!list.length) { box.append(create("div", { class: "empty" }, "לא נמצאו פריטים")); return; }
  list.forEach((r) => box.append(productRow(r)));
}

function stockBadge(r) {
  const cls = r.isAdjustment ? "adj" : r.onHand > 0 ? "pos" : "zero";
  return create("span", { class: `badge ${cls}` }, create("span", { class: "dot" }),
    r.isAdjustment ? `מק"ט כללי · ${r.onHand}` : String(r.onHand));
}
function priceBlock(r) {
  const kids = [formatILS(r.price)];
  if (r.sale) kids.push(create("span", { class: "was" }, formatILS(r.regular)));
  if (r.source === "computed") kids.push(create("span", { class: "src" }, "מחושב"));
  if (r.source === "unknown") kids.push(create("span", { class: "src" }, "ללא מחיר"));
  return create("div", { class: "price" }, ...kids);
}
function productRow(r) {
  return create("div", { class: "prow" },
    create("div", { class: "info" },
      create("div", { class: "name" }, r.name),
      create("div", { class: "sub" }, `מק"ט ${r.sku}`, r.barcode ? ` · ${r.barcode}` : ""),
      create("div", { class: "sub" }, stockBadge(r))),
    priceBlock(r),
    create("button", { class: "add-btn", title: "הוסף לעגלה",
      onclick: () => { cart.addProduct(r, 1); toast(`נוסף: ${r.name}`); } }, "+"));
}

// ── Cart ──────────────────────────────────────────────────────────────────
function renderCart(state) {
  // The cart re-renders wholesale on every change (clear + rebuild), which destroys the
  // discount input mid-edit and drops the keyboard. Capture the focused field, then re-focus
  // the freshly-built node afterwards so typing stays uninterrupted.
  const focus = captureDiscFocus();
  const allocs = new Map(cart.lineAllocations().map((a) => [a.sku, a]));
  [el("cartPanel"), el("cartSheetBody")].forEach((host) => { if (host) renderCartInto(host, state, allocs); });
  const t = state.totals;
  el("mobileTotal").textContent = formatILS(t.total);
  el("mobileSub").textContent = `${t.itemCount} פריטים`;
  restoreDiscFocus(focus);
}
// Discount fields are the only inputs inside the re-rendered cart region. Each carries a stable
// data-disc id ("line:<sku>" or "whole") and lives in one of two hosts (desktop panel / mobile sheet).
function captureDiscFocus() {
  const a = document.activeElement;
  if (!a || !a.classList || !a.classList.contains("disc")) return null;
  const host = a.closest("#cartPanel, #cartSheetBody");
  let start = null, end = null;
  try { start = a.selectionStart; end = a.selectionEnd; } catch {} // number inputs may not expose selection
  return { hostId: host && host.id, key: a.getAttribute("data-disc"), start, end };
}
function restoreDiscFocus(saved) {
  if (!saved || !saved.hostId || !saved.key) return;
  const host = el(saved.hostId);
  const input = host && host.querySelector(`.disc[data-disc="${saved.key}"]`);
  if (!input) return;
  input.focus();
  if (saved.start != null) { try { input.setSelectionRange(saved.start, saved.end); } catch {} }
}
function renderCartInto(host, state, allocs) {
  clear(host);
  if (!state.lines.length) { host.append(create("div", { class: "empty" }, "העגלה ריקה")); return; }
  const lines = create("div", { class: "cart-lines" });
  state.lines.forEach((l) => lines.append(cartLine(l, allocs.get(l.sku))));
  host.append(lines, totalsBlock(state));
}
function cartLine(l, alloc) {
  const over = l.qty > l.onHand;
  const o31 = (alloc?.allocation || []).map((a) => `31/${a.docNo}${a.qty > 1 ? "×" + a.qty : ""}`).join(", ") || "—";
  return create("div", { class: "cline" },
    create("div", { class: "top" },
      create("div", { class: "name" }, l.name, l.isAdjustment ? " ⚠️" : ""),
      create("button", { class: "rm", title: "הסר", onclick: () => cart.removeLine(l.sku) }, "✕")),
    create("div", { class: "o31" }, "תעודת משלוח: ", o31),
    create("div", { class: "ctrl" },
      create("div", { class: "stepper" },
        create("button", { onclick: () => cart.setQty(l.sku, l.qty - 1) }, "−"),
        create("span", {}, l.qty),
        create("button", { onclick: () => cart.setQty(l.sku, l.qty + 1) }, "+")),
      create("input", { class: "disc", type: "number", min: 0, max: 100, value: l.lineDiscountPct || "",
        "data-disc": "line:" + l.sku,
        placeholder: "% הנחה", oninput: (e) => cart.setLineDiscount(l.sku, e.target.value) }),
      create("span", { class: "lt" }, formatILS(l.net))),
    over ? create("div", { class: "warn" }, `במלאי רק ${l.onHand}`) : null,
    l.unitPrice <= 0 ? create("div", { class: "warn" }, "אין מחיר — הזינו ידנית בהמשך") : null);
}
function totalsBlock(state) {
  const t = state.totals;
  return create("div", { class: "totals" },
    create("div", { class: "r" }, create("span", {}, "סכום ביניים"), create("span", {}, formatILS(t.subtotal))),
    create("div", { class: "r" },
      create("span", { class: "wd" }, "הנחה כללית ",
        create("input", { class: "disc", type: "number", min: 0, max: 100, value: state.wholeListDiscountPct || "",
          "data-disc": "whole",
          placeholder: "%", oninput: (e) => cart.setWholeDiscount(e.target.value) })),
      create("span", {}, "−" + formatILS(t.wholeDiscountAmount))),
    create("div", { class: "r grand" }, create("span", {}, 'סה"כ'), create("span", {}, formatILS(t.total))),
    t.requiresId ? create("div", { class: "warn" }, "סכום מעל ₪5,000 — נדרשת תעודת זהות") : null,
    create("button", { class: "checkout", onclick: openCustomer }, "בצע מכירה ←"));
}

// ── Customer ──────────────────────────────────────────────────────────────
function openCustomer() {
  const v = cart.validation();
  if (v.errors.includes("empty-cart")) { toast("העגלה ריקה"); return; }
  if (v.noPrice.length) { toast("יש פריט ללא מחיר — הזינו מחיר"); /* still allow opening to fix */ }
  const s = cart.getState();
  el("custName").value = s.customer.fullName;
  el("custPhone").value = s.customer.phone;
  el("custId").value = s.customer.idNumber;
  el("idField").classList.toggle("show", s.totals.requiresId);
  el("custIdReq").style.display = s.totals.requiresId ? "" : "none";
  clearCustErrors();
  closeSheet("cartSheet");
  openSheet("customerSheet");
}
// Each required-field error maps to the wrapper that gets the .invalid (ink-on-blush) treatment.
const CUST_FIELD = { "name-required": "custNameField", "phone-required": "custPhoneField", "id-required": "idField" };
function clearCustErrors() { Object.values(CUST_FIELD).forEach((id) => el(id).classList.remove("invalid")); }
function bindCustomer() {
  // Typing in a field clears its own error; keep cart state in sync as before.
  const sync = (input, fieldId, patch) => input.addEventListener("input", (e) => {
    cart.setCustomer(patch(e.target.value));
    el(fieldId).classList.remove("invalid");
  });
  sync(el("custName"), "custNameField", (v) => ({ fullName: v }));
  sync(el("custPhone"), "custPhoneField", (v) => ({ phone: v }));
  sync(el("custId"), "idField", (v) => ({ idNumber: v }));
  el("toPacketBtn").addEventListener("click", () => {
    // Read inputs directly so autofill/paste always sync (not just keystroke events).
    cart.setCustomer({ fullName: el("custName").value, phone: el("custPhone").value, idNumber: el("custId").value });
    const v = cart.validation();
    clearCustErrors();
    if (!v.ok) {
      v.errors.forEach((e) => { if (CUST_FIELD[e]) el(CUST_FIELD[e]).classList.add("invalid"); });
      const msg = { "name-required": "חסר שם", "phone-required": "חסר טלפון",
        "id-required": 'חסרה ת"ז (מעל ₪5,000)', "price-required": "יש פריט ללא מחיר" };
      toast(v.errors.map((e) => msg[e] || e).filter(Boolean)[0] || "חסרים פרטים");
      const firstField = v.errors.map((e) => CUST_FIELD[e]).find(Boolean);
      if (firstField) el(firstField).querySelector("input").focus();
      return;
    }
    closeSheet("customerSheet");
    openPacket();
  });
}

// ── Packet ────────────────────────────────────────────────────────────────
let lastPacket;
function openPacket() {
  lastPacket = buildPacket(cart);
  const text = packetToText(lastPacket);
  el("packetText").textContent = text;
  openSheet("packetSheet");
}
function completeSale(msg) {
  const state = cart.getState();
  saveSale({
    packetText: lastPacket ? packetToText(lastPacket) : "",
    customer: { ...state.customer },
    totals: state.totals,
    lines: state.lines.map((l) => ({ name: l.name, qty: l.qty, net: l.net })),
  });
  cart.clear();
  closeSheet("packetSheet");
  el("searchInput").value = "";
  el("searchClear").classList.add("hidden");
  showCategoryGrid();
  toast(msg);
}
function bindPacket() {
  el("copyBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(packetToText(lastPacket)); completeSale("הועתק ✓"); }
    catch { toast("העתקה נכשלה"); }
  });
  el("waBtn").addEventListener("click", () => {
    const url = "https://wa.me/?text=" + encodeURIComponent(packetToText(lastPacket));
    window.open(url, "_blank", "noopener");
    completeSale("נשלח ב-WhatsApp ✓");
  });
  el("newSaleBtn").addEventListener("click", () => completeSale("מוכן למכירה הבאה"));
}

// ── Scanner handoff (sibling yamit-scanner app, same origin) ────────────────
// Navigate to the scanner in "kupa mode"; it returns to us with #scan=<barcode> after one scan.
function openScanner() {
  const ret = location.origin + location.pathname;
  location.href = SCANNER_URL + "?kupa=1&return=" + encodeURIComponent(ret);
}

// Consume a barcode the scanner handed back via the URL hash, then clear it.
function consumeScanHash() {
  const m = /[#&]scan=([^&]+)/.exec(location.hash);
  if (!m) return;
  const code = decodeURIComponent(m[1]);
  history.replaceState(null, "", location.pathname + location.search);
  const r = resolver.resolveByBarcode(code);
  if (r) { cart.addProduct(r, 1); toast(`נוסף: ${r.name}`); }
  else {
    el("searchInput").value = code;
    el("searchClear").classList.remove("hidden");
    const list = resolver.search(code, { inStockOnly: true, limit: 60 });
    el("catalogLbl").textContent = `במלאי בבת גלים (${list.length})`;
    showResults(list);
    toast(`ברקוד ${code} לא נמצא במלאי`);
  }
}

// ── Sheets ────────────────────────────────────────────────────────────────
function openSheet(id) {
  el(id).classList.add("show"); el(id + "Bd").classList.add("show");
  document.body.style.overflow = "hidden";
}
function closeSheet(id) {
  el(id).classList.remove("show"); el(id + "Bd").classList.remove("show");
  if (!document.querySelector(".sheet.show")) document.body.style.overflow = "";
}

// ── History ───────────────────────────────────────────────────────────────
function openHistory() { renderHistory(); openSheet("historySheet"); }
function renderHistory() {
  const body = el("historySheetBody"); clear(body);
  const sales = getSales();
  if (!sales.length) { body.append(create("div", { class: "empty" }, "אין מכירות שמורות")); return; }
  body.append(create("div", { style: "padding:12px 14px 0" },
    create("button", { class: "btn btn-ghost", style: "width:100%",
      onclick: () => { clearAllSales(); renderHistory(); toast("נמחקו כל המכירות"); } }, "מחק הכל")));
  sales.forEach((s) => {
    const d = new Date(s.at);
    const dateStr = d.toLocaleDateString("he-IL") + " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    const itemsSummary = (s.lines || []).map((l) => `${l.name} ×${l.qty}`).join(", ");
    body.append(create("div", { class: "sale-row" },
      create("div", { class: "sale-info" },
        create("div", { class: "sale-name" }, s.customer?.fullName || "(ללא שם)"),
        create("div", { class: "sale-sub" }, s.customer?.phone || "", " · ", dateStr),
        create("div", { class: "sale-sub sale-items" }, itemsSummary)),
      create("div", { class: "sale-total" }, formatILS(s.totals?.total ?? 0)),
      create("button", { class: "rm", title: "מחק",
        onclick: () => { deleteSale(s.id); renderHistory(); } }, "✕")));
  });
}

// ── Settings (admin only) ──────────────────────────────────────────────────
function openSettings() {
  const s = getSourceOverride(); // empty fields = using the shared default file from config
  el("srcStock").value = s.stock || ""; el("srcPrices").value = s.prices || "";
  openSheet("settingsSheet");
}
function bindSettings() {
  el("saveSourcesBtn").addEventListener("click", () => {
    const stock = el("srcStock").value.trim(), prices = el("srcPrices").value.trim();
    // Empty → drop the override and fall back to the shared default; otherwise save this device's override.
    if (!stock && !prices) clearSources(); else setSources({ stock, prices });
    toast("נשמר — טוען מחדש"); location.reload();
  });
  el("resetSourcesBtn").addEventListener("click", () => {
    clearSources(); toast("חזרה לקובץ ברירת המחדל"); location.reload();
  });
}

bindCustomer(); bindPacket(); bindSettings();
