const LS = "kupa_sales";

export function getSales() {
  try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch { return []; }
}

export function saveSale({ packetText, customer, totals, lines }) {
  const sales = getSales();
  sales.unshift({ id: String(Date.now()), at: new Date().toISOString(), packetText, customer, totals, lines });
  try { localStorage.setItem(LS, JSON.stringify(sales)); } catch {}
}

export function deleteSale(id) {
  const sales = getSales().filter((s) => s.id !== id);
  try { localStorage.setItem(LS, JSON.stringify(sales)); } catch {}
}

export function clearAllSales() {
  try { localStorage.removeItem(LS); } catch {}
}
