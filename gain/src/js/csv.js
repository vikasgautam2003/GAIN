// Robust CSV parse/serialize. Handles quoted fields, embedded commas, newlines,
// escaped double-quotes, UTF-8, BOM, CRLF. Preserves column order on write.

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);  // strip BOM
  const rows = [];
  let field = "";
  let row = [];
  let i = 0;
  let inQuotes = false;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < n && text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ""; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    if (c === '\r') {
      row.push(field); rows.push(row); row = []; field = "";
      if (i + 1 < n && text[i + 1] === '\n') i += 2; else i++;
      continue;
    }
    field += c; i++;
  }
  // last field
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  // discard a trailing empty row created by a terminating newline
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(h => h.trim());
  const dataRows = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => obj[h] = r[idx] !== undefined ? r[idx] : "");
    return obj;
  });
  return { headers, rows: dataRows };
}

export function serializeCSV(headers, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const out = [headers.map(esc).join(",")];
  for (const r of rows) out.push(headers.map(h => esc(r[h])).join(","));
  return out.join("\n") + "\n";
}

// Detect headers from an unknown CSV (file upload). Returns array of raw strings.
export function sniffHeaders(text) {
  const { headers } = parseCSV(text);
  return headers;
}
