// Builds the handoff packet main-store staff receive. Pure: takes the cart, returns a structured
// packet + a Hebrew text rendering for WhatsApp/clipboard. Mirrors the Notion sales-DB shape.
import { formatILS } from "../utils/money.js";

export function buildPacket(cart) {
  const s = cart.getState();
  const allocBySku = new Map(cart.lineAllocations().map((a) => [a.sku, a]));

  const lines = s.lines.map((l) => ({
    sku: l.sku,
    name: l.name,
    barcode: l.barcode,
    qty: l.qty,
    unitPrice: l.unitPrice,
    lineDiscountPct: l.lineDiscountPct,
    lineNet: l.net,
    priceSource: l.priceSource,
    isAdjustment: l.isAdjustment,
    origin31: (allocBySku.get(l.sku)?.allocation || []).map((a) => ({ docNo: a.docNo, qty: a.qty })),
  }));

  return {
    createdAt: new Date().toISOString(),
    customer: { ...s.customer, idNumber: s.totals.requiresId ? s.customer.idNumber : (s.customer.idNumber || null) },
    lines,
    subtotal: s.totals.subtotal,
    wholeListDiscountPct: s.wholeListDiscountPct,
    wholeDiscountAmount: s.totals.wholeDiscountAmount,
    total: s.totals.total,
    requiresId: s.totals.requiresId,
    checklist: [
      "התקשרו ללקוח וגבו את התשלום",
      "הפיקו חשבונית — מבת גלים (לא לשכוח!)",
      "הפיקו תעודת החזרה (34) — כל שורה מקושרת לתעודת המשלוח (31) שלה",
    ],
  };
}

// Source-31 refs for a line, formatted "31/352172 ×2".
function origins(line) {
  if (!line.origin31.length) return "—";
  return line.origin31.map((o) => `31/${o.docNo}${o.qty > 1 ? " ×" + o.qty : ""}`).join(", ");
}

// Hebrew text for WhatsApp / clipboard copy.
export function packetToText(p) {
  const L = [];
  L.push("🏄 *בקשת מכירה — בת גלים*");
  L.push("");
  L.push(`*לקוח:* ${p.customer.fullName}`);
  L.push(`*טלפון:* ${p.customer.phone}`);
  if (p.requiresId) L.push(`*ת"ז:* ${p.customer.idNumber}  _(מעל ₪5,000)_`);
  L.push("");
  L.push("*פריטים:*");
  p.lines.forEach((l, i) => {
    const disc = l.lineDiscountPct ? ` (−${l.lineDiscountPct}%)` : "";
    const flag = l.isAdjustment ? " ⚠️" : "";
    L.push(`${i + 1}. ${l.name}${flag}`);
    L.push(`   מק"ט ${l.sku}${l.barcode ? " · ברקוד " + l.barcode : ""}`);
    L.push(`   ${l.qty} × ${formatILS(l.unitPrice)}${disc} = ${formatILS(l.lineNet)}`);
    L.push(`   תעודת משלוח: ${origins(l)}`);
  });
  L.push("");
  L.push(`*סכום ביניים:* ${formatILS(p.subtotal)}`);
  if (p.wholeListDiscountPct) L.push(`*הנחה כללית:* −${p.wholeListDiscountPct}% (${formatILS(p.wholeDiscountAmount)})`);
  L.push(`*סה"כ לתשלום:* ${formatILS(p.total)}`);
  L.push("");
  L.push("*לביצוע ע״י המשרד:*");
  p.checklist.forEach((c, i) => L.push(`${i + 1}. ${c}`));
  return L.join("\n");
}
