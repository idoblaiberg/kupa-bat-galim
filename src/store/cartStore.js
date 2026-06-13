// Cart state — the only mutable app state. Holds lines + discounts + customer, computes all
// totals as derived values, and resolves each line's source-31 (FIFO) for the handoff packet.
// Pure logic, no DOM: UI subscribes via onChange(). Tested in test/cartStore.test.mjs.
import { allocateOrigin31 } from "../services/stockEngine.js";

export const ID_THRESHOLD = 5000; // ₪ — above this, customer ID number is required.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const clampPct = (p) => Math.min(100, Math.max(0, Number(p) || 0));

export function createCart() {
  const state = {
    lines: [],                 // see addProduct()
    wholeListDiscountPct: 0,
    customer: { fullName: "", phone: "", idNumber: "" },
  };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(getState()));
  const find = (sku) => state.lines.find((l) => l.sku === sku);

  // --- mutations ---
  function addProduct(resolved, qty = 1) {
    const existing = find(resolved.sku);
    if (existing) { existing.qty += qty; }
    else {
      state.lines.push({
        sku: resolved.sku,
        name: resolved.name,
        barcode: resolved.barcode || "",
        unitPrice: resolved.price || 0,
        priceSource: resolved.source || "unknown",
        regular: resolved.regular ?? resolved.price ?? 0,
        sale: resolved.sale ?? null,
        onHand: resolved.onHand ?? 0,
        isAdjustment: !!resolved.isAdjustment,
        lots: (resolved.lots || []).map((l) => ({ ...l })),
        qty,
        lineDiscountPct: 0,
      });
    }
    emit();
  }
  function setQty(sku, qty) {
    const l = find(sku); if (!l) return;
    l.qty = Math.max(0, Math.floor(Number(qty) || 0));
    if (l.qty === 0) removeLine(sku); else emit();
  }
  function removeLine(sku) { state.lines = state.lines.filter((l) => l.sku !== sku); emit(); }
  function setLineDiscount(sku, pct) { const l = find(sku); if (l) { l.lineDiscountPct = clampPct(pct); emit(); } }
  function setUnitPrice(sku, price) { const l = find(sku); if (l) { l.unitPrice = Math.max(0, round2(Number(price) || 0)); l.priceSource = "manual"; emit(); } }
  function setWholeDiscount(pct) { state.wholeListDiscountPct = clampPct(pct); emit(); }
  function setCustomer(partial) { Object.assign(state.customer, partial); emit(); }
  function clear() { state.lines = []; state.wholeListDiscountPct = 0; state.customer = { fullName: "", phone: "", idNumber: "" }; emit(); }

  // --- derived (computed, never stored) ---
  function lineTotals(l) {
    const gross = round2(l.unitPrice * l.qty);
    const discountAmount = round2(gross * l.lineDiscountPct / 100);
    return { gross, discountAmount, net: round2(gross - discountAmount) };
  }
  function totals() {
    const subtotal = round2(state.lines.reduce((s, l) => s + lineTotals(l).net, 0));
    const wholeDiscountAmount = round2(subtotal * state.wholeListDiscountPct / 100);
    const total = round2(subtotal - wholeDiscountAmount);
    return { subtotal, wholeDiscountAmount, total, requiresId: total > ID_THRESHOLD, itemCount: state.lines.reduce((s, l) => s + l.qty, 0) };
  }

  // FIFO source-31 allocation per line (for the return-note pre-fill in the packet).
  function lineAllocations() {
    return state.lines.map((l) => ({ sku: l.sku, ...allocateOrigin31(l.lots, l.qty) }));
  }

  // --- validation ---
  function validation() {
    const t = totals();
    const c = state.customer;
    const errors = [];
    if (!state.lines.length) errors.push("empty-cart");
    if (!c.fullName.trim()) errors.push("name-required");
    if (!c.phone.trim()) errors.push("phone-required");
    if (t.requiresId && !c.idNumber.trim()) errors.push("id-required");
    const noPrice = state.lines.filter((l) => l.unitPrice <= 0).map((l) => l.sku);
    if (noPrice.length) errors.push("price-required"); // can't request a sale with no price
    // over-stock is a soft warning (staff verify), not a hard block:
    const overStock = state.lines.filter((l) => l.qty > l.onHand).map((l) => l.sku);
    const shortfalls = lineAllocations().filter((a) => a.shortfall > 0).map((a) => a.sku);
    return { ok: errors.length === 0, errors, overStock, shortfalls, noPrice };
  }

  function getState() {
    return { lines: state.lines.map((l) => ({ ...l, ...lineTotals(l) })), customer: { ...state.customer },
      wholeListDiscountPct: state.wholeListDiscountPct, totals: totals() };
  }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  return { addProduct, setQty, removeLine, setLineDiscount, setUnitPrice, setWholeDiscount,
    setCustomer, clear, totals, lineAllocations, validation, getState, onChange, _raw: state };
}
