// Kupa app — boot, render, and wire the whole flow. Vanilla ES modules, RTL Hebrew.
import { loadData, getSources, setSources } from "../services/dataLoader.js";
import { createCart } from "../store/cartStore.js";
import { buildPacket, packetToText } from "../services/packetBuilder.js";
import { formatILS } from "../utils/money.js";
import { el, create, clear, toast } from "./dom.js";

// Barcode capture is delegated to the sibling yamit-scanner app (same origin).
const SCANNER_URL = "../yamit-scanner/";

let resolver, cart, stats;

boot();

async function boot() {
  try {
    const { data, fresh, cachedAt } = await loadData();
    resolver = data.resolver; stats = data.stats;
    cart = createCart();
    cart.onChange(renderCart);
    cart.hydrateFromStorage();            // restore cart across the scanner round-trip / refreshes
    wireUI();
    setFreshness(fresh, cachedAt);
    showInStock();
    renderCart(cart.getState());
    consumeScanHash();                    // a barcode handed back from the scanner app
  } catch (e) {
    const hasConfig = !!localStorage.getItem("kupa_sources");
    const msg = hasConfig
      ? `שגיאה בטעינת הנתונים: ${e.message}`
      : "לא נטענו נתונים. הגדירו את קישורי ה-CSV (מלאי, קטלוג, מחירים) בהגדרות.";
    clear(el("results"));
    el("results").append(create("div", { class: "empty" },
      msg,
      create("br"), create("br"), create("button", { class: "btn btn-primary", onclick: openSettings }, "פתח הגדרות")));
    if (!hasConfig) openSettings(); // first run only: jump straight to source setup
  }
}

function setFreshness(fresh, cachedAt) {
  const pill = el("freshPill");
  if (fresh) { pill.textContent = `${stats.inStock} פריטים במלאי`; pill.classList.remove("stale"); }
  else { pill.textContent = "נתונים מהמטמון (לא עודכן)"; pill.classList.add("stale"); }
  pill.title = `מחיר מהדוח: ${stats.priced} · מחושב: ${stats.computed} · ללא מחיר: ${stats.noPrice}`;
}

// ── Catalog / search ──────────────────────────────────────────────────────
let searchTimer;
function wireUI() {
  el("searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    // Scope search to branch stock (every sellable line needs a source-31). Catalog still powers
    // the matching (rich names + barcodes), but results are limited to what's actually at Bat Galim.
    searchTimer = setTimeout(() => (q.trim().length < 2 ? showInStock() : showResults(resolver.search(q, { inStockOnly: true, limit: 60 }))), 160);
  });
  el("scanBtn").addEventListener("click", openScanner);
  el("settingsBtn").addEventListener("click", openSettings);
  el("openCartBtn").addEventListener("click", () => openSheet("cartSheet"));
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeSheet(b.dataset.close)));
}

function showInStock() {
  el("catalogLbl").textContent = `במלאי בבת גלים (${stats.inStock})`;
  showResults(resolver.inStockList());
}
function showResults(list) {
  const box = el("results"); clear(box);
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
  const allocs = new Map(cart.lineAllocations().map((a) => [a.sku, a]));
  [el("cartPanel"), el("cartSheetBody")].forEach((host) => { if (host) renderCartInto(host, state, allocs); });
  const t = state.totals;
  el("mobileTotal").textContent = formatILS(t.total);
  el("mobileSub").textContent = `${t.itemCount} פריטים`;
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
  closeSheet("cartSheet");
  openSheet("customerSheet");
}
function bindCustomer() {
  el("custName").addEventListener("input", (e) => cart.setCustomer({ fullName: e.target.value }));
  el("custPhone").addEventListener("input", (e) => cart.setCustomer({ phone: e.target.value }));
  el("custId").addEventListener("input", (e) => cart.setCustomer({ idNumber: e.target.value }));
  el("toPacketBtn").addEventListener("click", () => {
    // Read inputs directly so autofill/paste always sync (not just keystroke events).
    cart.setCustomer({ fullName: el("custName").value, phone: el("custPhone").value, idNumber: el("custId").value });
    const v = cart.validation();
    if (!v.ok) {
      const msg = { "name-required": "חסר שם", "phone-required": "חסר טלפון",
        "id-required": 'חסרה ת"ז (מעל ₪5,000)', "price-required": "יש פריט ללא מחיר" };
      toast(v.errors.map((e) => msg[e] || e).filter(Boolean)[0] || "חסרים פרטים");
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
function bindPacket() {
  el("copyBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(packetToText(lastPacket)); toast("הועתק ✓"); }
    catch { toast("העתקה נכשלה"); }
  });
  el("waBtn").addEventListener("click", () => {
    const url = "https://wa.me/?text=" + encodeURIComponent(packetToText(lastPacket));
    window.open(url, "_blank", "noopener");
  });
  el("newSaleBtn").addEventListener("click", () => {
    cart.clear();
    closeSheet("packetSheet");
    el("searchInput").value = "";
    showInStock();
    toast("מוכן למכירה הבאה");
  });
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
    showResults(resolver.search(code, { inStockOnly: true, limit: 60 }));
    toast(`ברקוד ${code} לא נמצא במלאי`);
  }
}

// ── Sheets ────────────────────────────────────────────────────────────────
function openSheet(id) { el(id).classList.add("show"); el(id + "Bd").classList.add("show"); }
function closeSheet(id) {
  el(id).classList.remove("show"); el(id + "Bd").classList.remove("show");
}

// ── Settings ──────────────────────────────────────────────────────────────
function openSettings() {
  const s = getSources();
  el("srcStock").value = s.stock; el("srcPrices").value = s.prices;
  openSheet("settingsSheet");
}
function bindSettings() {
  el("saveSourcesBtn").addEventListener("click", () => {
    setSources({ stock: el("srcStock").value.trim(), prices: el("srcPrices").value.trim() });
    toast("נשמר — טוען מחדש"); location.reload();
  });
}

bindCustomer(); bindPacket(); bindSettings();
