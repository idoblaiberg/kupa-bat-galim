// ₪ formatting (Hebrew locale). Whole shekels by default; agorot only when present.
export function formatILS(n) {
  const v = Number(n) || 0;
  const hasAgorot = Math.abs(v - Math.round(v)) > 1e-9;
  return "₪" + v.toLocaleString("he-IL", {
    minimumFractionDigits: hasAgorot ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
