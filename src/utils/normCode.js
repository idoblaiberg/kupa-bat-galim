// Text/code normalization shared with the scanner's search.
export const norm = (s) => String(s ?? "").toLowerCase().trim();
// For barcodes / SKUs: keep alphanumerics only, upper-case (so "5051678-122995" == "5051678122995").
export const normCode = (s) => String(s ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
