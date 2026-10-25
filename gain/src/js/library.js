// Library — tabs per sheet, inline edit (Status/Confidence/DateSolved), filter+search,
// flexible CSV import with column mapping. Writes back to the original CSV on disk,
// preserving column order + untouched rows/columns (store debounces + backs up).

import { getSheets, getSettings, updateSheetRow, addSheetRow, deleteSheetRow, addSheet, removeSheet, persistSheet, emit, on } from "./store.js";
import { parseCSV } from "./csv.js";
import { confirmDanger, openFormModal } from "./modals.js";
import { companyIconHtml, injectCompanyStyles, parseCompanies } from "./companies.js";

// Canonical column roles the engine understands. Any CSV can be mapped to these.
const ROLES = [
  { key: "problem",    label: "Problem / Topic", desc: "The item name shown in Today's plan" },
  { key: "pattern",    label: "Pattern / Category", desc: "Groups the item for filtering" },
  { key: "difficulty", label: "Difficulty", desc: "Easy / Medium / Hard — drives pricing" },
  { key: "freq",       label: "Freq / Priority", desc: "HIGH / MED / LOW or P1 / P2 / P3" },
  { key: "role",       label: "Role", desc: "CONF / CORE / STRETCH (optional)" },
  { key: "status",     label: "Status", desc: "TODO / SOLVED / REVIEW / AGAIN — drives green days" },
  { key: "confidence", label: "Confidence (1-5)", desc: "Honesty rating" },
  { key: "dateDone",   label: "Date done", desc: "ISO date, auto-filled on tick" },
  { key: "lc",         label: "LC# / link", desc: "External reference (LeetCode #, URL, etc)" },
  { key: "notes",      label: "Notes", desc: "Freeform" }
];

let active = null;        // sheet name currently viewed
let filters = { q: "", status: "", pattern: "", freq: "", quick: "", company: "" };
let hiddenCols = {};      // { sheetName: Set<header> }
let colsOpen = false;
let unsub = null;

function getHidden(sheetName, headers) {
  if (!hiddenCols[sheetName]) {
    // Default: hide less-useful columns to keep rows readable without horizontal scroll.
    const keepRE = /^(seq|problem|topic|skill or platform|skill|name|pattern|category|freq|priority|difficulty|status|confidence|datesolved|datedone|companies|company)$/i;
    hiddenCols[sheetName] = new Set(headers.filter(h => !keepRE.test(h)));
  }
  return hiddenCols[sheetName];
}
function toggleHidden(sheetName, header) {
  const set = hiddenCols[sheetName];
  if (set.has(header)) set.delete(header); else set.add(header);
}

export default {
  async mount(root, params) {
    injectCompanyStyles();
    const sheets = getSheets();
    const names = Object.keys(sheets);
    // Jump to the sheet named in the hash (e.g. #library/System%20Design)
    if (params && params[0]) {
      const want = decodeURIComponent(params[0]);
      if (sheets[want]) active = want;
    }
    if (!active || !sheets[active]) active = names[0] || null;

    root.innerHTML = render();
    paint(root);
    attach(root);

    if (unsub) unsub();
    unsub = on((ev, payload) => {
      if (ev === "sheet" || ev === "sheet:add" || ev === "sheet:remove" || ev === "settings") {
        // tabs or data changed — rerender
        root.innerHTML = render();
        paint(root);
        attach(root);
      }
    });
  },
  unmount() { if (unsub) { unsub(); unsub = null; } }
};

function render() {
  const sheets = getSheets();
  const names = Object.keys(sheets);
  return `
    <div class="view-inner lib">
      <div class="hero-eyebrow">LIBRARY</div>
      <h1 class="hero-title">Your sheets.</h1>
      <p class="hero-sub">Any CSV, any shape. Edit inline, every keystroke syncs to disk.</p>

      <div class="lib-tabs">
        ${names.map(n => `
          <button class="lib-tab ${n === active ? "active" : ""}" data-tab="${esc(n)}">
            <span class="tab-name">${esc(n)}</span>
            <span class="tab-count">${sheets[n].rows.length}</span>
          </button>
        `).join("")}
        <div class="lib-tab-spacer"></div>
        <button class="btn-ghost" id="lib-remove" title="Remove current sheet">Remove</button>
        <button class="btn-primary" id="lib-add" title="Add anything — row, bulk append, replace, or a new sheet">+ Add</button>
      </div>

      <div class="lib-chips" id="lib-chips"></div>
      <div class="lib-toolbar" id="lib-toolbar"></div>

      <div class="lib-table-wrap">
        <div id="lib-table"></div>
      </div>

      <div id="lib-modal-root"></div>
    </div>

    <style>
      .lib { max-width: 1240px; }
      .lib .lib-tabs {
        display: flex; align-items: center; gap: var(--s-2);
        margin: var(--s-4) 0 var(--s-3); flex-wrap: wrap;
      }
      .lib .lib-tab {
        display: inline-flex; align-items: center; gap: 8px;
        background: var(--paper); border: 1px solid var(--line); border-radius: 12px;
        padding: 8px 14px; cursor: pointer; font: 600 13px/1 var(--font-sans); color: var(--mut);
        transition: all var(--dur-fast) var(--ease);
      }
      .lib .lib-tab:hover { color: var(--ink); border-color: var(--line2); }
      .lib .lib-tab.active { color: var(--blue); background: var(--blue-soft); border-color: transparent; }
      .lib .lib-tab .tab-count { font-size: 11px; opacity: .7; }
      .lib .lib-tab-spacer { flex: 1; }

      .lib .lib-chips { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
      .lib .lib-chip-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .lib .lib-company-row {
        display: flex; align-items: center; gap: 6px;
        overflow-x: auto; scrollbar-width: thin;
        padding: 4px 2px;
        border-top: 1px dashed var(--line);
      }
      .lib .lib-company-row::-webkit-scrollbar { height: 6px; }
      .lib .lib-company-row::-webkit-scrollbar-thumb { background: var(--line2); border-radius: 999px; }
      .lib .lib-cfilter {
        display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
        padding: 5px 10px 5px 6px; background: var(--paper); border: 1px solid var(--line);
        border-radius: 999px; cursor: pointer; font: 500 12px/1 var(--font-sans); color: var(--mut);
        transition: all .14s ease;
      }
      .lib .lib-cfilter:hover { color: var(--ink); border-color: var(--line2); transform: translateY(-1px); }
      .lib .lib-cfilter.active {
        color: var(--ink); border-color: var(--ink);
        background: color-mix(in oklab, var(--ink) 6%, var(--paper));
        font-weight: 600;
      }
      .lib .lib-cfilter .cf-all { padding: 0 4px; }
      .lib .lib-cfilter .cf-name { white-space: nowrap; }
      .lib .co-cell { padding: 6px 8px !important; position: relative; min-width: 220px; white-space: nowrap; vertical-align: middle; }
      .lib .co-cell-chips { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; pointer-events: none; }
      .lib .co-cell-more { font: 600 10.5px/1 var(--font-sans); color: var(--mut); margin-left: 4px; }
      /* Input layered on top of the chips but fully invisible until the cell is focused */
      .lib .co-cell-input {
        position: absolute !important; inset: 0; width: 100% !important; height: 100%;
        padding: 6px 8px !important; background: transparent !important; border: none !important;
        color: transparent !important; opacity: 0;
        font: 400 12px/1.4 var(--font-sans); z-index: 2; cursor: text;
      }
      .lib .co-cell:focus-within .co-cell-chips { opacity: 0; }
      .lib .co-cell:focus-within .co-cell-input {
        opacity: 1;
        color: var(--ink) !important;
        background: var(--paper) !important;
        outline: 2px solid var(--blue); outline-offset: -2px;
      }
      .lib .co-cell-empty .co-cell-input {
        position: static !important; opacity: 1 !important; height: auto;
        color: var(--mut) !important;
      }
      .lib .co-cell .co-ico { border: 1px solid var(--line); }
      .lib .lib-chip {
        padding: 6px 12px; border-radius: 999px;
        background: var(--paper); border: 1px solid var(--line);
        color: var(--mut); font: 600 12px/1 var(--font-sans);
        cursor: pointer; transition: all var(--dur-fast) var(--ease);
        display: inline-flex; align-items: center; gap: 5px;
      }
      .lib .lib-chip:hover { color: var(--ink); border-color: var(--line2); }
      .lib .lib-chip.active {
        background: var(--blue-soft); color: var(--blue); border-color: transparent;
      }
      .lib .lib-chip .lc-dot { color: var(--red); font-size: 9px; }
      .lib .lib-toolbar {
        display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap;
        margin-bottom: var(--s-3);
      }
      .lib .lib-toolbar input,
      .lib .lib-toolbar select {
        border: 1px solid var(--line); background: var(--paper); border-radius: 10px;
        padding: 8px 12px; font: 13px/1.3 var(--font-sans); color: var(--ink); outline: none;
      }
      .lib .lib-toolbar input:focus,
      .lib .lib-toolbar select:focus { border-color: var(--blue); }
      .lib .lib-toolbar .search { flex: 1; min-width: 240px; }
      .lib .filter-stat { color: var(--mut); font-size: 12px; margin-left: auto; }

      .lib .lib-table-wrap {
        background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
        box-shadow: var(--shadow); overflow: hidden;
      }
      .lib .scroll-body { max-height: calc(100vh - 340px); overflow: auto; }
      .lib .scroll-body::-webkit-scrollbar { height: 10px; width: 10px; }
      .lib .scroll-body::-webkit-scrollbar-thumb { background: var(--line2); border-radius: 999px; }
      .lib .scroll-body::-webkit-scrollbar-thumb:hover { background: var(--mut); }
      .lib table { min-width: max-content; border-collapse: collapse; font-size: 13.5px; }
      .lib thead th {
        text-align: left; padding: 12px 14px; font-weight: 700;
        background: var(--bg); border-bottom: 1px solid var(--line);
        color: var(--mut); font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
        position: sticky; top: 0; z-index: 1; white-space: nowrap;
        position: relative;
      }
      .lib thead th .th-label { display: inline-block; padding-right: 10px; }
      .lib thead th .col-resize {
        position: absolute; top: 0; right: -4px; width: 8px; height: 100%;
        cursor: col-resize; user-select: none; z-index: 2;
      }
      .lib thead th .col-resize::after {
        content: ""; position: absolute; right: 3px; top: 25%; width: 2px; height: 50%;
        background: transparent; transition: background var(--dur-fast) var(--ease);
      }
      .lib thead th .col-resize:hover::after { background: var(--blue); }
      .lib tbody tr { border-bottom: 1px solid var(--line); transition: background var(--dur-fast) var(--ease); position: relative; }
      .lib tbody tr:hover { background: var(--bg); }

      /* Per-row delete button — only visible on row hover */
      .lib col.c-del { width: 36px; }
      .lib .del-cell { text-align: center; padding: 0 6px; }
      .lib .del-btn {
        width: 24px; height: 24px; border-radius: 50%; border: none; cursor: pointer;
        background: transparent; color: var(--mut);
        font: 500 14px/1 var(--font-sans);
        display: inline-flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity .18s, color .18s, background .18s;
      }
      .lib tbody tr:hover .del-btn { opacity: 0.6; }
      .lib .del-btn:hover { opacity: 1; color: #fff; background: var(--red); }
      /* Status-driven row tints */
      .lib tbody tr.r-solved { background: linear-gradient(to right, rgba(22,163,74,.08), rgba(22,163,74,.03) 60%, transparent); }
      .lib tbody tr.r-solved:hover { background: linear-gradient(to right, rgba(22,163,74,.14), rgba(22,163,74,.06) 60%, #fafbfc); }
      .lib tbody tr.r-solved td:first-child { box-shadow: inset 3px 0 0 var(--green); }
      .lib tbody tr.r-again  { background: linear-gradient(to right, rgba(226,69,79,.07), transparent 50%); }
      .lib tbody tr.r-again td:first-child { box-shadow: inset 3px 0 0 var(--red); }
      .lib tbody tr.r-review { background: linear-gradient(to right, rgba(59,100,246,.06), transparent 50%); }
      .lib tbody tr.r-review td:first-child { box-shadow: inset 3px 0 0 var(--blue); }
      .lib tbody td { padding: 10px 14px; color: var(--ink); vertical-align: middle; }
      .lib tbody td .cell-input,
      .lib tbody td select.cell-input {
        border: 1px solid transparent; background: transparent; border-radius: 6px;
        padding: 6px 8px; font: inherit; color: inherit; width: 100%;
        transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
      }
      .lib tbody td .cell-input:hover { background: var(--paper); border-color: var(--line2); }
      .lib tbody td .cell-input:focus { background: var(--paper); border-color: var(--blue); outline: none; box-shadow: 0 0 0 3px var(--blue-soft); }
      .lib tbody td select.cell-input { min-width: 110px; }
      .lib tbody td input[type="date"].cell-input { min-width: 140px; }

      .lib tbody td.open-cell { padding: 6px 10px; }
      .lib .open-btn {
        width: 28px; height: 28px; border-radius: 50%;
        background: transparent; border: 1px solid var(--line2); color: var(--mut);
        cursor: pointer; font: 700 14px/1 var(--font-sans);
        transition: all var(--dur-fast) var(--ease);
      }
      .lib tbody tr:hover .open-btn { color: var(--blue); border-color: var(--blue); }
      .lib .open-btn:hover { background: var(--blue); color: #fff !important; }
      .lib tbody td.open-cell { display: flex; align-items: center; gap: 6px; }
      .lib .info-btn {
        width: 28px; height: 28px; border-radius: 6px;
        border: 1px solid transparent; background: transparent;
        color: var(--mut); cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        font: 500 15px/1 var(--font-sans);
        opacity: 0; transition: opacity .18s, color .18s, border-color .18s, background .18s;
      }
      .lib tbody tr:hover .info-btn { opacity: 1; }
      .lib .info-btn:hover {
        color: var(--gold); border-color: color-mix(in oklab, var(--gold) 32%, transparent);
        background: color-mix(in oklab, var(--gold) 10%, transparent);
      }

      /* give each column a sane min-width so cells never truncate names mid-word */
      .lib col.c-open       { width: 48px; }
      .lib col.c-seq        { width: 60px; }
      .lib col.c-status     { width: 130px; }
      .lib col.c-confidence { width: 110px; }
      .lib col.c-date       { width: 160px; }
      .lib col.c-freq       { width: 110px; }
      .lib col.c-pattern    { min-width: 180px; }
      .lib col.c-problem    { min-width: 240px; }
      .lib col.c-notes      { min-width: 220px; }
      .lib col.c-companies  { min-width: 220px; }
      .lib col.c-default    { min-width: 160px; }

      .lib tbody td .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: .04em; }
      .lib tbody td .badge.todo    { background: var(--line); color: var(--mut); }
      .lib tbody td .badge.solved  { background: var(--green-soft); color: var(--green); }
      .lib tbody td .badge.review  { background: var(--blue-soft); color: var(--blue); }
      .lib tbody td .badge.again   { background: #fde8ea; color: var(--red); }
      .lib tbody td .badge.high    { background: var(--gold-soft); color: var(--gold); }

      /* --- columns popover --- */
      .lib .cols-wrap { position: relative; }
      .lib .cols-pop {
        position: absolute; top: calc(100% + 6px); right: 0;
        background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
        box-shadow: var(--shadow-pop); padding: 12px; width: 280px; z-index: 20;
        animation: rise var(--dur) var(--ease) both;
      }
      .lib .cols-pop .cols-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 13px; }
      .lib .cols-pop .cols-head > div { display: flex; gap: 6px; }
      .lib .cols-pop .cols-list { display: grid; gap: 2px; max-height: 320px; overflow: auto; padding-right: 4px; }
      .lib .cols-pop .col-chk {
        display: flex; align-items: center; gap: 10px; padding: 6px 8px;
        border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--ink);
        transition: background var(--dur-fast) var(--ease);
      }
      .lib .cols-pop .col-chk:hover { background: var(--bg); }
      .lib .cols-pop .col-chk input { margin: 0; }

      /* --- modal (no scrim; page stays as it is) --- */
      .lib-modal-scrim {
        position: fixed; inset: 0; background: transparent;
        z-index: 70;
        display: flex; align-items: center; justify-content: center;
        animation: fadeIn var(--dur) var(--ease) both;
      }
      html:has(.lib-modal-scrim), body:has(.lib-modal-scrim) { overflow: hidden; }
      .lib-modal {
        background: var(--paper); border-radius: 18px; width: min(720px, 92vw);
        max-height: 86vh; display: flex; flex-direction: column; overflow: hidden;
        box-shadow:
          0 28px 80px rgba(0,0,0,.22),
          0 8px 20px rgba(0,0,0,.08),
          0 0 0 1px var(--line);
        animation: rise var(--dur-slow) var(--ease) both;
      }
      .lib-modal header {
        flex-shrink: 0;
        display: flex; justify-content: space-between; align-items: center;
        padding: var(--s-4) var(--s-5); border-bottom: 1px solid var(--line);
      }
      .lib-modal header h2 { margin: 0; font-size: 18px; font-weight: 700; }
      .lib-modal .modal-body {
        flex: 1 1 auto; min-height: 0;
        padding: var(--s-5); overflow-y: auto; overflow-x: hidden;
      }
      .lib-modal .modal-body p { color: var(--mut); margin: 0 0 var(--s-4); font-size: 13px; }
      .lib-modal footer {
        flex-shrink: 0;
        display: flex; justify-content: flex-end; gap: var(--s-2);
        padding: var(--s-3) var(--s-5); border-top: 1px solid var(--line); background: var(--bg);
      }
      .lib-modal .map-row {
        display: grid; grid-template-columns: 180px 1fr 1fr; gap: var(--s-3); align-items: center;
        padding: 10px 0; border-top: 1px solid var(--line);
      }
      .lib-modal .map-row:first-of-type { border-top: none; }
      .lib-modal .map-row .mcol { font-size: 13px; font-weight: 600; }
      .lib-modal .map-row .mdesc { font-size: 12px; color: var(--mut); margin-top: 2px; }
      .lib-modal .map-row select {
        border: 1px solid var(--line); background: var(--paper); border-radius: 10px;
        padding: 8px 10px; font: 13px/1.3 var(--font-sans); color: var(--ink);
      }
      .lib-modal .form-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--s-3); margin-bottom: var(--s-4); }
      .lib-modal .form-row.form-row-2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .lib-modal .form-row label { font-size: 11px; letter-spacing: .08em; color: var(--mut); font-weight: 700; text-transform: uppercase; }
      .lib-modal .form-row input, .lib-modal .form-row select {
        margin-top: 4px; width: 100%; border: 1px solid var(--line); border-radius: 10px;
        padding: 9px 10px; font: 13px/1.3 var(--font-sans); outline: none;
      }
      .lib-modal .preview {
        margin-top: var(--s-3); background: var(--bg); border: 1px solid var(--line);
        border-radius: 10px; padding: var(--s-3); font-size: 12px; color: var(--mut);
        max-height: 160px; overflow: auto; font-family: var(--font-mono);
      }
      .lib-modal textarea {
        width: 100%; box-sizing: border-box;
        border: 1px solid var(--line); background: var(--paper); border-radius: 10px;
        padding: 10px 12px; font: 12px/1.5 var(--font-mono); color: var(--ink);
        resize: vertical; outline: none;
      }
      .lib-modal textarea:focus { border-color: var(--blue); }
      .lib-modal .ap-preview {
        margin-top: var(--s-3); padding: 10px 14px;
        background: var(--gold-soft); color: var(--ink);
        border-left: 3px solid var(--gold); border-radius: 6px; font-size: 13px;
      }
      /* Column pills — tidy wrap with uniform gap */
      .lib-modal .cols-row {
        display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
        padding: 10px 0 2px;
      }
      .lib-modal .cols-row .cols-label {
        font-size: 11px; font-weight: 700; letter-spacing: .08em;
        text-transform: uppercase; color: var(--mut); margin-right: 4px;
      }
      .lib-modal .ap-col-pill {
        display: inline-block; padding: 4px 10px;
        background: var(--paper); border: 1px solid var(--line); border-radius: 999px;
        font-size: 11.5px; color: var(--ink); white-space: nowrap;
      }
      /* Styled native file input — unified look across the modal */
      .lib-modal input[type="file"] {
        width: 100%; box-sizing: border-box;
        padding: 10px 12px; background: var(--bg);
        border: 1px dashed var(--line); border-radius: 10px;
        color: var(--mut); font: 13px/1.3 var(--font-sans);
        cursor: pointer; margin-top: 4px;
      }
      .lib-modal input[type="file"]:hover { border-color: var(--blue); }
      .lib-modal input[type="file"]::file-selector-button {
        background: var(--paper); border: 1px solid var(--line); border-radius: 8px;
        padding: 7px 12px; color: var(--ink); cursor: pointer; margin-right: 10px;
        font: 600 12px/1 var(--font-sans);
        transition: all var(--dur-fast) var(--ease);
      }
      .lib-modal input[type="file"]::file-selector-button:hover {
        border-color: var(--blue); color: var(--blue);
      }
      /* Section labels (matches the uppercase chip label style) */
      .lib-modal .section-label {
        display: block; font-size: 11px; font-weight: 700; letter-spacing: .08em;
        text-transform: uppercase; color: var(--mut); margin: var(--s-4) 0 8px;
      }

      /* ---- Polished modal shell (no backdrop) ---- */
      .lib-modal-scrim { background: transparent; }
      .lib-modal {
        box-shadow:
          0 28px 80px rgba(0,0,0,.22),
          0 8px 20px rgba(0,0,0,.08),
          0 0 0 1px var(--line);
        border-radius: 18px;
        animation: lmPop 180ms cubic-bezier(.2,1.2,.3,1);
      }
      @keyframes lmPop {
        from { opacity: 0; transform: translateY(12px) scale(.98); }
        to   { opacity: 1; transform: translateY(0)    scale(1);   }
      }
      .lib-modal header {
        padding: 20px var(--s-5) 16px;
        border-bottom: 1px solid var(--line);
      }
      .lib-modal header h2 { font-size: 20px; letter-spacing: -.01em; }
      .lib-modal .modal-body { padding: var(--s-5); }
      .lib-modal .modal-body p { line-height: 1.5; }
      .lib-modal footer {
        padding: var(--s-3) var(--s-5);
        border-top: 1px solid var(--line);
        background: var(--bg);
        border-bottom-left-radius: 18px;
        border-bottom-right-radius: 18px;
      }
      .lib-modal footer .btn-primary {
        padding: 10px 20px; border-radius: 10px;
        font: 600 13px/1 var(--font-sans);
      }
      .lib-modal footer .btn-ghost {
        padding: 10px 18px; border-radius: 10px;
      }
      .lib-modal .form-row label {
        display: flex; flex-direction: column; gap: 6px;
      }
      .lib-modal textarea { min-height: 180px; }

      /* ---- Hub picker cards ---- */
      .lib-modal-hub { max-width: 640px; }
      .lib-modal-hub .modal-body p { color: var(--mut); margin: 0 0 var(--s-4); font-size: 13.5px; }
      .lib-modal-hub .hub-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3);
      }
      .lib-modal-hub .hub-card {
        display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
        padding: 18px; background: var(--paper); border: 1px solid var(--line);
        border-radius: 14px; cursor: pointer; text-align: left;
        transition: all var(--dur-fast) var(--ease);
        font: inherit; color: var(--ink);
      }
      .lib-modal-hub .hub-card:hover {
        border-color: var(--blue); background: var(--blue-soft);
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(59,100,246,.12);
      }
      .lib-modal-hub .hub-card.hub-danger:hover {
        border-color: var(--red); background: color-mix(in oklab, var(--red) 10%, transparent);
        box-shadow: 0 8px 20px rgba(226,69,79,.14);
      }
      .lib-modal-hub .hub-card .hub-ico {
        width: 40px; height: 40px; border-radius: 10px;
        background: var(--blue-soft); color: var(--blue);
        display: flex; align-items: center; justify-content: center;
        font-size: 20px; font-weight: 700;
      }
      .lib-modal-hub .hub-card.hub-danger .hub-ico {
        background: color-mix(in oklab, var(--red) 12%, transparent);
        color: var(--red);
      }
      .lib-modal-hub .hub-card h4 {
        margin: 0; font-size: 15px; font-weight: 700; color: var(--ink);
      }
      .lib-modal-hub .hub-card p {
        margin: 0; color: var(--mut); font-size: 12.5px; line-height: 1.45;
      }
      @media (max-width: 560px) {
        .lib-modal-hub .hub-grid { grid-template-columns: 1fr; }
      }

      /* ---- Danger warning banner (Replace) ---- */
      .lib-modal .rp-warn {
        padding: 12px 14px;
        background: color-mix(in oklab, var(--red) 10%, transparent);
        color: var(--red); border-left: 3px solid var(--red);
        border-radius: 8px; font-size: 13px; margin-bottom: var(--s-4);
        line-height: 1.5;
      }
      .lib-modal .rp-save { background: var(--red); border-color: var(--red); color: #fff; }
      .lib-modal .rp-save:hover { background: var(--red); filter: brightness(1.08); }

      /* ---- Live preview strip (Append / Replace) ---- */
      .lib-modal .ap-preview {
        margin-top: var(--s-3); padding: 11px 14px;
        background: var(--gold-soft);
        border-left: 3px solid var(--gold);
        border-radius: 8px; font-size: 13px;
        color: var(--ink);
      }
    </style>
  `;
}

function paint(root) {
  const sheet = getSheets()[active];
  if (!sheet) return paintEmpty(root);

  // toolbar: search + filter dropdowns derived from headers
  const toolbar = root.querySelector("#lib-toolbar");
  const statusCol = pickCol(sheet.headers, "status", /^status$/i);
  const patternCol = pickCol(sheet.headers, "pattern", /^(pattern|category)$/i);
  const freqCol = pickCol(sheet.headers, "freq", /^(freq|priority)$/i);
  const companyCol = sheet.headers.find(h => /^compan(y|ies)$/i.test(h));

  const statuses = statusCol ? uniq(sheet.rows.map(r => r[statusCol]).filter(Boolean)) : [];
  const patterns = patternCol ? uniq(sheet.rows.map(r => r[patternCol]).filter(Boolean)) : [];
  const freqs    = freqCol    ? uniq(sheet.rows.map(r => r[freqCol]).filter(Boolean)) : [];
  const companies = companyCol
    ? uniq(sheet.rows.flatMap(r => parseCompanies(r[companyCol]))).sort((a, b) => a.localeCompare(b))
    : [];

  const hidden = getHidden(active, sheet.headers);

  // Quick filter chips — common one-click states
  const chipsEl = root.querySelector("#lib-chips");
  if (chipsEl) {
    const q = filters.quick;
    const cf = filters.company;
    chipsEl.innerHTML = `
      <div class="lib-chip-row">
        <button class="lib-chip ${q === ""?"active":""}" data-quick="">All</button>
        <button class="lib-chip ${q === "unsolved"?"active":""}" data-quick="unsolved">Unsolved</button>
        <button class="lib-chip ${q === "solved"?"active":""}" data-quick="solved">Solved</button>
        <button class="lib-chip ${q === "lowconf"?"active":""}" data-quick="lowconf">Low confidence <span class="lc-dot">◉</span></button>
        <button class="lib-chip ${q === "solved-today"?"active":""}" data-quick="solved-today">Solved today</button>
        <button class="lib-chip ${q === "review"?"active":""}" data-quick="review">Needs review</button>
      </div>
      ${companies.length ? `
        <div class="lib-company-row" role="toolbar" aria-label="Filter by company">
          <button class="lib-cfilter ${cf === "" ? "active" : ""}" data-cfilter="">
            <span class="cf-all">All companies</span>
          </button>
          ${companies.map(c => `
            <button class="lib-cfilter ${cf === c ? "active" : ""}" data-cfilter="${esc(c)}" title="${esc(c)}">
              ${companyIconHtml(c, 18)}
              <span class="cf-name">${esc(c)}</span>
            </button>
          `).join("")}
        </div>
      ` : ""}
    `;
    chipsEl.querySelectorAll("[data-quick]").forEach(btn => {
      btn.addEventListener("click", () => {
        filters.quick = btn.dataset.quick;
        paint(root);
      });
    });
    chipsEl.querySelectorAll("[data-cfilter]").forEach(btn => {
      btn.addEventListener("click", () => {
        filters.company = btn.dataset.cfilter;
        paint(root);
      });
    });
  }

  toolbar.innerHTML = `
    <input class="search" id="f-q" placeholder="Search this sheet…" value="${esc(filters.q)}" />
    ${statusCol ? `<select id="f-status"><option value="">All ${esc(statusCol)}</option>${statuses.map(s => `<option ${s===filters.status?"selected":""}>${esc(s)}</option>`).join("")}</select>` : ""}
    ${patternCol ? `<select id="f-pattern"><option value="">All ${esc(patternCol)}</option>${patterns.map(p => `<option ${p===filters.pattern?"selected":""}>${esc(p)}</option>`).join("")}</select>` : ""}
    ${freqCol ? `<select id="f-freq"><option value="">All ${esc(freqCol)}</option>${freqs.map(f => `<option ${f===filters.freq?"selected":""}>${esc(f)}</option>`).join("")}</select>` : ""}
    <div class="cols-wrap">
      <button class="btn-ghost btn-sm" id="f-cols">Columns · ${sheet.headers.length - hidden.size}/${sheet.headers.length}</button>
      ${colsOpen ? `
        <div class="cols-pop">
          <div class="cols-head">
            <strong>Show columns</strong>
            <div>
              <button class="btn-ghost btn-sm" id="cols-all">All</button>
              <button class="btn-ghost btn-sm" id="cols-min">Essentials</button>
            </div>
          </div>
          <div class="cols-list">
            ${sheet.headers.map(h => `
              <label class="col-chk">
                <input type="checkbox" data-col="${esc(h)}" ${hidden.has(h) ? "" : "checked"} />
                <span>${esc(h)}</span>
              </label>
            `).join("")}
          </div>
        </div>
      ` : ""}
    </div>
    <span class="filter-stat" id="f-stat"></span>
  `;

  toolbar.querySelector("#f-q")?.addEventListener("input", (e) => { filters.q = e.target.value; paintTable(root); });
  toolbar.querySelector("#f-status")?.addEventListener("change", (e) => { filters.status = e.target.value; paintTable(root); });
  toolbar.querySelector("#f-pattern")?.addEventListener("change", (e) => { filters.pattern = e.target.value; paintTable(root); });
  toolbar.querySelector("#f-freq")?.addEventListener("change", (e) => { filters.freq = e.target.value; paintTable(root); });

  // columns popover
  toolbar.querySelector("#f-cols")?.addEventListener("click", (e) => {
    e.stopPropagation();
    colsOpen = !colsOpen;
    paint(root);
  });
  toolbar.querySelectorAll(".col-chk input").forEach(chk => {
    chk.addEventListener("change", () => {
      toggleHidden(active, chk.dataset.col);
      paint(root);
    });
  });
  toolbar.querySelector("#cols-all")?.addEventListener("click", () => {
    hiddenCols[active] = new Set();
    paint(root);
  });
  toolbar.querySelector("#cols-min")?.addEventListener("click", () => {
    delete hiddenCols[active];
    getHidden(active, sheet.headers);
    paint(root);
  });
  // close popover on outside click
  if (colsOpen) {
    const onDoc = (ev) => {
      if (!ev.target.closest(".cols-wrap")) {
        colsOpen = false;
        document.removeEventListener("click", onDoc);
        paint(root);
      }
    };
    setTimeout(() => document.addEventListener("click", onDoc), 0);
  }

  paintTable(root);
}

function paintEmpty(root) {
  root.querySelector("#lib-toolbar").innerHTML = "";
  root.querySelector("#lib-table").innerHTML = `
    <div class="empty-state" style="padding:48px 24px;">
      <h2>No sheets yet.</h2>
      <p>Hit <b>+ Import CSV</b> to add one. Any shape, any location, column-mapping handled.</p>
    </div>
  `;
}

function paintTable(root) {
  const sheet = getSheets()[active];
  const allHeaders = sheet.headers;
  const hidden = getHidden(active, allHeaders);
  const headers = allHeaders.filter(h => !hidden.has(h));
  const statusCol = pickCol(headers, "status", /^status$/i);
  const patternCol = pickCol(headers, "pattern", /^(pattern|category)$/i);
  const freqCol = pickCol(headers, "freq", /^(freq|priority)$/i);
  const confCol = pickCol(headers, "confidence", /^confidence$/i);
  const dateCol = pickCol(headers, "dateDone", /^(datesolved|datedone)$/i);
  const companyCol = headers.find(h => /^compan(y|ies)$/i.test(h));

  // apply filters
  const q = filters.q.trim().toLowerCase();
  const todayStr = (() => {
    const d = new Date();
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  })();
  const rows = sheet.rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => {
      // Quick-filter chips (overrides nothing — stacks on top of dropdowns)
      if (filters.quick === "unsolved" && statusCol && /^(solved|done)$/i.test(String(r[statusCol]||""))) return false;
      if (filters.quick === "solved" && statusCol && !/^(solved|done)$/i.test(String(r[statusCol]||""))) return false;
      if (filters.quick === "lowconf" && confCol) {
        const c = Number(r[confCol] || 0);
        if (!(c >= 1 && c <= 2)) return false;
      }
      if (filters.quick === "solved-today" && dateCol) {
        if (String(r[dateCol] || "") !== todayStr) return false;
      }
      if (filters.quick === "review" && statusCol) {
        if (!/^review$/i.test(String(r[statusCol]||""))) return false;
      }
      // Classic dropdown filters
      if (filters.status && statusCol && String(r[statusCol]||"") !== filters.status) return false;
      if (filters.pattern && patternCol && String(r[patternCol]||"") !== filters.pattern) return false;
      if (filters.freq && freqCol && String(r[freqCol]||"") !== filters.freq) return false;
      // Company filter — row must include the selected company (case-insensitive)
      if (filters.company) {
        if (!companyCol) return false;
        const rowCos = parseCompanies(r[companyCol]).map(s => s.toLowerCase());
        if (!rowCos.includes(filters.company.toLowerCase())) return false;
      }
      if (q) {
        const joined = headers.map(h => String(r[h]||"")).join(" ").toLowerCase();
        if (!joined.includes(q)) return false;
      }
      return true;
    });

  root.querySelector("#f-stat").textContent = `${rows.length} of ${sheet.rows.length} rows`;

  const el = root.querySelector("#lib-table");
  el.innerHTML = `
    <div class="scroll-body">
      <table>
        <colgroup>
          <col class="c-open" />
          ${headers.map(h => `<col class="${colClass(h, { statusCol, patternCol, freqCol, confCol, dateCol, companyCol })}" />`).join("")}
        </colgroup>
        <thead>
          <tr>
            <th aria-label="Open"></th>
            ${headers.map(h => `<th title="${esc(h)}"><span class="th-label">${esc(h)}</span><span class="col-resize" data-col="${esc(h)}" aria-label="Resize column"></span></th>`).join("")}
            <th class="c-del" aria-label="Delete"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(({ r, i }) => {
            const stat = statusCol ? String(r[statusCol] || "").toUpperCase() : "";
            const rowCls = stat === "SOLVED" ? "r-solved" : stat === "AGAIN" ? "r-again" : stat === "REVIEW" ? "r-review" : "";
            return `<tr data-row-index="${i}" class="${rowCls}">
              <td class="open-cell">
                <button class="open-btn" data-open="${i}" aria-label="Open problem" title="Open problem">→</button>
                <button class="info-btn" data-learn="${i}" aria-label="Learn this topic" title="Teacher-mode lesson (Groq)">ℹ</button>
              </td>
              ${headers.map(h => renderCell(h, r[h], { statusCol, patternCol, freqCol, confCol, dateCol, companyCol })).join("")}
              <td class="del-cell"><button class="del-btn" data-del="${i}" aria-label="Delete row">×</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  // open-problem click
  el.querySelectorAll(".open-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      location.hash = `#problem/${encodeURIComponent(active)}/${btn.dataset.open}`;
    });
  });

  // learn-this-topic click (opens Groq lesson modal in-place, no navigation)
  el.querySelectorAll(".info-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const { openLessonModal } = await import("./lesson.js");
      openLessonModal({ sheetName: active, rowIndex: Number(btn.dataset.learn) });
    });
  });

  // delete-row click
  el.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.del);
      const sheet = getSheets()[active];
      if (!sheet) return;
      const row = sheet.rows[idx];
      const titleCol = sheet.headers.find(h => /^(problem|topic|item|skill)/i.test(h)) || sheet.headers[0];
      const label = row?.[titleCol] || `row ${idx + 1}`;
      const ok = await confirmDanger({
        title: `Delete this row?`,
        message: `“${label}” will be removed from ${active}.`,
        confirmLabel: "Delete row",
        consequences: [
          "The row is removed from the CSV on disk",
          "Any dayLog references to this row stay (historical), but the engine stops picking it"
        ]
      });
      if (!ok) return;
      await deleteSheetRow(active, idx);
    });
  });

  // column resize — drag the handle on a <th>
  wireColumnResize(el, headers);

  // delegate input/change for inline edit
  el.addEventListener("change", onEdit);
  el.addEventListener("input", (e) => { if (e.target.matches(".cell-input[data-free]")) scheduleFreeEdit(e); });

  function onEdit(e) {
    if (!e.target.matches(".cell-input")) return;
    commitEdit(e);
  }
}

const pendingFree = {};
function scheduleFreeEdit(e) {
  const key = e.target.getAttribute("data-key");
  const rowIndex = Number(e.target.closest("tr").dataset.rowIndex);
  clearTimeout(pendingFree[`${rowIndex}:${key}`]);
  pendingFree[`${rowIndex}:${key}`] = setTimeout(() => commitEdit(e), 350);
}

async function commitEdit(e) {
  const key = e.target.getAttribute("data-key");
  const rowIndex = Number(e.target.closest("tr").dataset.rowIndex);
  const value = e.target.value;
  await updateSheetRow(active, rowIndex, { [key]: value });
}

function wireColumnResize(container, headers) {
  const colgroup = container.querySelector("colgroup");
  if (!colgroup) return;
  const cols = Array.from(colgroup.querySelectorAll("col"));
  container.querySelectorAll(".col-resize").forEach((handle, i) => {
    // header "open" is the first col; data columns start at index 1
    const colEl = cols[i + 1];
    if (!colEl) return;
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX;
      const startWidth = colEl.getBoundingClientRect().width || 160;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      function onMove(ev) {
        const w = Math.max(60, startWidth + (ev.clientX - startX));
        colEl.style.width = `${w}px`;
        colEl.style.minWidth = `${w}px`;
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

function colClass(h, cols) {
  const nh = h.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (nh === "seq") return "c-seq";
  if (h === cols.statusCol) return "c-status";
  if (h === cols.confCol) return "c-confidence";
  if (h === cols.dateCol) return "c-date";
  if (h === cols.freqCol) return "c-freq";
  if (h === cols.patternCol) return "c-pattern";
  if (h === cols.companyCol) return "c-companies";
  if (/^(problem|topic|skill|skillorplatform|name)$/.test(nh)) return "c-problem";
  if (/^notes?$/.test(nh)) return "c-notes";
  return "c-default";
}

function renderCell(h, v, cols) {
  // Companies — array field, chip row with logos; click → edit
  if (h === cols.companyCol) {
    const list = String(v || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!list.length) {
      return `<td class="co-cell co-cell-empty"><input class="cell-input co-cell-input" data-key="${esc(h)}" data-free="1" placeholder="add companies…" value="" /></td>`;
    }
    const chips = list.slice(0, 6).map(c => companyIconHtml(c, 20)).join("");
    const more = list.length > 6 ? `<span class="co-cell-more">+${list.length - 6}</span>` : "";
    return `<td class="co-cell"><span class="co-cell-chips">${chips}${more}</span><input class="cell-input co-cell-input" data-key="${esc(h)}" data-free="1" value="${esc(v)}" title="Comma-separated companies" /></td>`;
  }
  // status select
  if (h === cols.statusCol) {
    const opts = ["TODO", "SOLVED", "REVIEW", "AGAIN"];
    const cur = (v || "TODO").toUpperCase();
    return `<td><select class="cell-input" data-key="${esc(h)}">${opts.map(o => `<option ${o===cur?"selected":""}>${o}</option>`).join("")}</select></td>`;
  }
  // confidence 1-5
  if (h === cols.confCol) {
    const cur = v || "";
    return `<td><select class="cell-input" data-key="${esc(h)}">
      <option value="">—</option>
      ${[1,2,3,4,5].map(n => `<option ${String(cur)===String(n)?"selected":""}>${n}</option>`).join("")}
    </select></td>`;
  }
  // date
  if (h === cols.dateCol) {
    return `<td><input class="cell-input" type="date" data-key="${esc(h)}" value="${esc(v||"")}" /></td>`;
  }
  // freq / pattern pill display + inline free edit
  if (h === cols.freqCol) {
    const u = (v||"").toUpperCase();
    const cls = /HIGH|P1/.test(u) ? "high" : (u === "SOLVED" ? "solved" : "todo");
    return `<td><span class="badge ${cls}">${esc(v||"-")}</span></td>`;
  }
  // default: free text input
  return `<td><input class="cell-input" data-key="${esc(h)}" data-free="1" value="${esc(v)}" /></td>`;
}

function attach(root) {
  // tab switch
  root.querySelectorAll(".lib-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      active = btn.dataset.tab;
      root.innerHTML = render();
      paint(root);
      attach(root);
    });
  });

  // Unified "+ Add" hub — one button, modal routes to the specific flow
  root.querySelector("#lib-add")?.addEventListener("click", () => openAddHubModal(root));

  // remove sheet
  root.querySelector("#lib-remove")?.addEventListener("click", async () => {
    if (!active) return;
    const file = getSheets()[active]?.file;
    const ok = await confirmDanger({
      title: `Remove sheet "${active}"?`,
      message: `This unlinks the sheet from the app. The CSV file on disk is kept — you can re-import it later.`,
      confirmLabel: "Remove sheet",
      consequences: [
        `The "${active}" tab disappears from Library`,
        `Any Today-plan logic that picks from this sheet stops using it`,
        file ? `File on disk kept: data/${file}` : ""
      ].filter(Boolean)
    });
    if (!ok) return;
    await removeSheet(active);
    active = Object.keys(getSheets())[0] || null;
    root.innerHTML = render();
    paint(root);
    attach(root);
  });

}

// --------- Import modal with column mapping ---------
// Add-row modal — one field per column in the current sheet, dropdowns for Status / Difficulty / Freq / Priority
function openAddRowModal(sheetName, root) {
  const sheet = getSheets()[sheetName];
  if (!sheet) return;
  const headers = sheet.headers;

  // Suggest the next Seq
  const seqCol = headers.find(h => /^seq$/i.test(h));
  const nextSeq = seqCol
    ? sheet.rows.reduce((m, r) => Math.max(m, Number(r[seqCol]) || 0), 0) + 1
    : null;

  const ENUMS = {
    status:     ["TODO", "SOLVED", "REVIEW", "AGAIN"],
    difficulty: ["EASY", "MEDIUM", "HARD"],
    freq:       ["HIGH", "MED", "LOW"],
    priority:   ["P1", "P2", "P3"],
    role:       ["CONF", "CORE", "STRETCH"]
  };

  const enumFor = (h) => {
    const k = h.toLowerCase().replace(/[^a-z]/g, "");
    return ENUMS[k] || null;
  };

  const fields = headers.map(h => {
    const en = enumFor(h);
    const isSeq = /^seq$/i.test(h);
    const isDate = /date/i.test(h);
    const isLong = /^(notes?|solution|whyitmatters|howtopractice|keyidea)$/i.test(h);
    const defaultVal = isSeq && nextSeq != null ? String(nextSeq)
                    : /^status$/i.test(h) ? "TODO"
                    : "";
    const idSafe = h.replace(/[^A-Za-z0-9_-]/g, "_");

    if (en) {
      return `
        <div class="arf-field">
          <label>${esc(h)}</label>
          <select data-col="${esc(h)}">
            <option value="">—</option>
            ${en.map(opt => `<option value="${opt}" ${opt === defaultVal ? "selected" : ""}>${opt}</option>`).join("")}
          </select>
        </div>`;
    }
    if (isLong) {
      return `
        <div class="arf-field arf-full">
          <label>${esc(h)}</label>
          <textarea data-col="${esc(h)}" rows="3" placeholder="Optional"></textarea>
        </div>`;
    }
    if (isDate) {
      return `
        <div class="arf-field">
          <label>${esc(h)}</label>
          <input type="date" data-col="${esc(h)}" />
        </div>`;
    }
    return `
      <div class="arf-field">
        <label>${esc(h)}</label>
        <input type="text" data-col="${esc(h)}" value="${esc(defaultVal)}" placeholder="${isSeq ? String(nextSeq ?? "") : ""}" />
      </div>`;
  }).join("");

  const bodyHtml = `
    <style>
      .arf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; }
      .arf-field label { display: block; font: 500 10.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 8px; }
      .arf-field input, .arf-field select, .arf-field textarea {
        width: 100%; border: 1px solid var(--line); background: var(--bg); border-radius: 10px;
        padding: 10px 12px; font: 13.5px/1.4 var(--font-sans); color: var(--ink); outline: none;
        transition: border-color .18s, box-shadow .18s, background .18s;
      }
      .arf-field input:focus, .arf-field select:focus, .arf-field textarea:focus {
        border-color: var(--gold); background: var(--paper); box-shadow: 0 0 0 3px var(--gold-soft);
      }
      .arf-full { grid-column: 1 / -1; }
      .arf-hint { grid-column: 1 / -1; font-size: 12px; color: var(--mut); margin-top: 2px; }
    </style>
    <div class="arf-grid">
      ${fields}
      <div class="arf-hint">New row appends to the end of <code style="background:var(--line);padding:1px 5px;border-radius:4px">${esc(sheet.file)}</code>. Status defaults to <b>TODO</b> so the engine can pick it up tomorrow.</div>
    </div>
  `;

  openFormModal({
    title: `Add row to ${sheetName}`,
    subtitle: `${headers.length} column${headers.length === 1 ? "" : "s"} · next Seq ${nextSeq ?? "—"}`,
    bodyHtml,
    saveLabel: "Add row",
    width: 640,
    onSave: async (modalRoot, close) => {
      const patch = {};
      modalRoot.querySelectorAll("[data-col]").forEach(inp => {
        const col = inp.dataset.col;
        const v = inp.value.trim();
        if (v) patch[col] = v;
      });
      try {
        await addSheetRow(sheetName, patch);
        close();
      } catch (err) {
        alert(`Could not add row: ${err.message || err}`);
      }
    }
  });
}

function openImportModal(root) {
  const modalRoot = root.querySelector("#lib-modal-root");
  modalRoot.innerHTML = `
    <div class="lib-modal-scrim" id="scrim">
      <div class="lib-modal" role="dialog" aria-label="Import CSV">
        <header>
          <h2>Import a CSV</h2>
          <button class="icon-btn" id="modal-close" aria-label="Close">✕</button>
        </header>
        <div class="modal-body" id="modal-body">
          <p>Pick a CSV from anywhere. We detect the columns and let you map them to the roles the engine understands. Unmapped columns are kept and shown — never dropped.</p>
          <div class="form-row">
            <label>CSV file<input type="file" id="imp-file" accept=".csv,text/csv,text/plain" /></label>
            <label>Sheet name<input id="imp-name" placeholder="e.g. ML Patterns" /></label>
            <label>Type<select id="imp-type">
              <option value="dsa">DSA-like</option>
              <option value="sd">System Design-like</option>
              <option value="int">Integrations-like</option>
              <option value="ext">Interview Extras-like</option>
              <option value="custom">Custom</option>
            </select></label>
          </div>
          <div id="imp-detect"></div>
        </div>
        <footer>
          <button class="btn-ghost" id="modal-cancel">Cancel</button>
          <button class="btn-primary" id="modal-save" disabled>Import</button>
        </footer>
      </div>
    </div>
  `;

  let detectedHeaders = [];
  let csvText = "";
  let rowsPreview = [];

  const close = () => { modalRoot.innerHTML = ""; };
  modalRoot.querySelector("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") close(); });
  modalRoot.querySelector("#modal-close").addEventListener("click", close);
  modalRoot.querySelector("#modal-cancel").addEventListener("click", close);

  const fileInput = modalRoot.querySelector("#imp-file");
  const nameInput = modalRoot.querySelector("#imp-name");
  const typeSel   = modalRoot.querySelector("#imp-type");
  const detectEl  = modalRoot.querySelector("#imp-detect");
  const saveBtn   = modalRoot.querySelector("#modal-save");

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      csvText = await file.text();
      const parsed = parseCSV(csvText);
      detectedHeaders = parsed.headers;
      rowsPreview = parsed.rows.slice(0, 5);
      if (!nameInput.value) nameInput.value = file.name.replace(/\.csv$/i, "");
      // sheet name must not already exist
      const existing = Object.keys(getSheets());
      if (existing.includes(nameInput.value)) nameInput.value = nameInput.value + " (new)";
      renderMapper();
    } catch (err) {
      detectEl.innerHTML = `<p style="color:var(--red)">Failed to parse: ${esc(err.message || err)}</p>`;
    }
  });

  function renderMapper() {
    // auto-guess mapping from header names
    const guess = Object.fromEntries(ROLES.map(role => {
      const r = role.key;
      const match = detectedHeaders.find(h => {
        const nh = h.toLowerCase().replace(/[^a-z0-9]/g,"");
        if (r === "problem")    return /^(problem|topic|skillorplatform|skill|name|title)$/.test(nh);
        if (r === "pattern")    return /^(pattern|category|group|bucket)$/.test(nh);
        if (r === "difficulty") return /^(difficulty|level|hardness)$/.test(nh);
        if (r === "freq")       return /^(freq|frequency|priority|importance|prio)$/.test(nh);
        if (r === "role")       return /^role$/.test(nh);
        if (r === "status")     return /^(status|state)$/.test(nh);
        if (r === "confidence") return /^(confidence|conf)$/.test(nh);
        if (r === "dateDone")   return /^(datesolved|datedone|dateresolved|solvedon|completedon|date)$/.test(nh);
        if (r === "lc")         return /^(lc|lcnum|leetcode|link|url|reference|ref)$/.test(nh);
        if (r === "notes")      return /^(notes|comment|comments|remark|remarks)$/.test(nh);
        return false;
      });
      return [r, match || ""];
    }));
    detectEl.innerHTML = `
      <div class="form-row" style="grid-template-columns: 1fr;">
        <div>
          <div style="font-weight:600; margin-bottom:8px;">Detected columns</div>
          <div class="preview">${esc(detectedHeaders.join(" · "))}</div>
        </div>
      </div>
      <div>
        <div style="font-weight:600; margin-bottom:8px;">Map roles → columns</div>
        ${ROLES.map(role => `
          <div class="map-row">
            <div>
              <div class="mcol">${esc(role.label)}</div>
              <div class="mdesc">${esc(role.desc)}</div>
            </div>
            <select data-role="${role.key}">
              <option value="">(unmapped)</option>
              ${detectedHeaders.map(h => `<option ${h===guess[role.key]?"selected":""}>${esc(h)}</option>`).join("")}
            </select>
            <div class="mdesc">${esc(guess[role.key] || "")}</div>
          </div>
        `).join("")}
      </div>
      <div class="form-row" style="grid-template-columns: 1fr; margin-top:16px;">
        <div>
          <div style="font-weight:600; margin-bottom:8px;">Preview (first 5 rows)</div>
          <div class="preview">${rowsPreview.map(r => esc(detectedHeaders.map(h => r[h] || "").join(" | "))).join("<br>")}</div>
        </div>
      </div>
    `;
    saveBtn.disabled = !nameInput.value.trim();
  }

  nameInput.addEventListener("input", () => { saveBtn.disabled = !nameInput.value.trim() || !csvText; });

  saveBtn.addEventListener("click", async () => {
    const sheetName = nameInput.value.trim();
    if (!sheetName || !csvText) return;
    const existing = Object.keys(getSheets());
    if (existing.includes(sheetName)) {
      const ok = await confirmDanger({
        title: `Replace "${sheetName}"?`,
        message: `A sheet with this name already exists. Importing will overwrite its data.`,
        confirmLabel: "Replace sheet",
        consequences: [
          "Every row and column currently in that sheet is removed",
          "The new CSV becomes the source of truth",
          "Your Status/Confidence edits on the old rows are lost"
        ]
      });
      if (!ok) return;
      await removeSheet(sheetName);
    }
    const columnMap = Object.fromEntries(
      Array.from(modalRoot.querySelectorAll("select[data-role]"))
        .map(s => [s.dataset.role, s.value])
        .filter(([, v]) => v)
    );
    const basename = sheetName.replace(/\W+/g, "_").toLowerCase() + ".csv";
    await addSheet({
      name: sheetName,
      file: basename,
      type: typeSel.value,
      columnMap
    }, csvText);
    active = sheetName;
    close();
  });
}

// --------- Append-rows modal: file picker or paste, batch-append into existing sheet ---------
function openAppendRowsModal(root) {
  const modalRoot = root.querySelector("#lib-modal-root");
  const sheets = getSheets();
  const sheetNames = Object.keys(sheets);
  modalRoot.innerHTML = `
    <div class="lib-modal-scrim" id="scrim">
      <div class="lib-modal" role="dialog" aria-label="Append rows">
        <header>
          <h2>Append rows to a sheet</h2>
          <button class="icon-btn" id="modal-close" aria-label="Close">✕</button>
        </header>
        <div class="modal-body" id="modal-body">
          <p>Pick a CSV file or paste rows. Nothing is overwritten — rows are appended with auto-filled Seq and Status=TODO. Case-insensitive header matching; unmatched columns are ignored.</p>
          <div class="form-row form-row-2">
            <label>Target sheet
              <select id="ap-target">
                ${sheetNames.map(n => `<option value="${esc(n)}" ${n === active ? "selected" : ""}>${esc(n)}</option>`).join("")}
              </select>
            </label>
            <label>CSV file <span style="text-transform:none;font-weight:400;color:var(--mut);">(optional)</span>
              <input type="file" id="ap-file" accept=".csv,text/csv,text/plain" />
            </label>
          </div>
          <div class="cols-row" id="ap-cols"></div>
          <label class="section-label">Or paste rows below</label>
          <textarea id="ap-text" rows="10" placeholder="Problem,Difficulty&#10;Reverse Linked List,Easy&#10;Two Sum,Easy&#10;&#10;… or just one title per line"></textarea>
          <div id="ap-preview" class="ap-preview" hidden></div>
        </div>
        <footer>
          <button class="btn-ghost" id="modal-cancel">Cancel</button>
          <button class="btn-primary" id="modal-save" disabled>Append rows</button>
        </footer>
      </div>
    </div>
  `;

  const close = () => { modalRoot.innerHTML = ""; };
  modalRoot.querySelector("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") close(); });
  modalRoot.querySelector("#modal-close").addEventListener("click", close);
  modalRoot.querySelector("#modal-cancel").addEventListener("click", close);

  const targetSel = modalRoot.querySelector("#ap-target");
  const fileInput = modalRoot.querySelector("#ap-file");
  const ta        = modalRoot.querySelector("#ap-text");
  const colsEl    = modalRoot.querySelector("#ap-cols");
  const preview   = modalRoot.querySelector("#ap-preview");
  const saveBtn   = modalRoot.querySelector("#modal-save");

  function refreshCols() {
    const sh = getSheets()[targetSel.value];
    if (!sh) { colsEl.innerHTML = ""; return; }
    colsEl.innerHTML = `<span class="cols-label">Target columns</span>` +
      sh.headers.map(h => `<span class="ap-col-pill">${esc(h)}</span>`).join("");
  }
  targetSel.addEventListener("change", () => { refreshCols(); updatePreview(); });
  refreshCols();

  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try { ta.value = await f.text(); updatePreview(); }
    catch (e) { preview.hidden = false; preview.innerHTML = `<span style="color:var(--red)">Couldn't read file: ${esc(e.message || e)}</span>`; }
  });

  function parsePaste() {
    const sh = getSheets()[targetSel.value];
    if (!sh) return { rows: [], note: "" };
    const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
    const raw = ta.value.trim();
    if (!raw) return { rows: [], note: "" };

    const firstNL = raw.indexOf("\n");
    const firstLine = firstNL < 0 ? raw : raw.slice(0, firstNL);
    const sheetHeadersLC = sh.headers.map(h => h.toLowerCase());
    let hasHeader = false;
    if (firstLine.includes(",")) {
      const parsedFirst = parseCSV(firstLine + "\n").headers;
      hasHeader = parsedFirst.some(c => sheetHeadersLC.includes(String(c).trim().toLowerCase()));
    }

    const rows = [];
    let note = "";
    if (hasHeader) {
      const parsed = parseCSV(raw + "\n");
      const headerMap = {};
      for (const h of parsed.headers) {
        const match = sh.headers.find(x => x.toLowerCase() === String(h).trim().toLowerCase());
        if (match) headerMap[h] = match;
      }
      const mapped = Object.keys(headerMap).length;
      if (!mapped) note = "⚠ No header matched — paste titles only, or match sheet column names.";
      else if (mapped < parsed.headers.length) note = `${mapped} of ${parsed.headers.length} header(s) matched · unmatched ignored`;
      else note = `${parsed.rows.length} row(s) · all ${mapped} header(s) matched`;
      for (const r of parsed.rows) {
        const patch = {};
        for (const [src, dst] of Object.entries(headerMap)) {
          if (r[src] != null && r[src] !== "") patch[dst] = r[src];
        }
        if (Object.keys(patch).length) rows.push(patch);
      }
    } else {
      if (!titleCol) note = "⚠ This sheet has no obvious title column — paste a CSV with real headers.";
      else {
        for (const line of raw.split("\n").map(l => l.trim()).filter(Boolean)) rows.push({ [titleCol]: line });
        note = `${rows.length} title(s) → ${titleCol}`;
      }
    }
    return { rows, note };
  }

  function updatePreview() {
    const { rows, note } = parsePaste();
    if (!ta.value.trim()) { preview.hidden = true; saveBtn.disabled = true; return; }
    preview.hidden = false;
    preview.innerHTML = `<b>${rows.length}</b> row${rows.length === 1 ? "" : "s"} to append ${note ? `· <span style="color:var(--mut)">${esc(note)}</span>` : ""}`;
    saveBtn.disabled = rows.length === 0;
  }
  ta.addEventListener("input", updatePreview);

  saveBtn.addEventListener("click", async () => {
    const target = targetSel.value;
    const sh = getSheets()[target];
    if (!sh) return;
    const { rows } = parsePaste();
    if (!rows.length) return;
    try {
      // Batch-append in memory, persist once.
      const seqCol = sh.headers.find(h => /^seq$/i.test(h));
      const statusCol = sh.headers.find(h => /^status$/i.test(h));
      let maxSeq = sh.rows.reduce((m, r) => Math.max(m, Number(r[seqCol]) || 0), 0);
      for (const patch of rows) {
        const row = {};
        for (const h of sh.headers) row[h] = "";
        if (seqCol) row[seqCol] = String(++maxSeq);
        if (statusCol) row[statusCol] = "TODO";
        for (const [k, v] of Object.entries(patch)) {
          const col = sh.headers.find(h => h.toLowerCase() === String(k).toLowerCase()) || k;
          row[col] = v == null ? "" : String(v);
        }
        sh.rows.push(row);
      }
      emit("sheet", target);
      await persistSheet(target);
      active = target;
      close();
      // Re-render so the new rows show up and the tab count updates.
      root.innerHTML = render();
      paint(root);
      attach(root);
    } catch (e) {
      preview.hidden = false;
      preview.innerHTML = `<span style="color:var(--red)">${esc(e.message || e)}</span>`;
    }
  });
}

// --------- Unified Add Hub: one button, picker modal → specific flow ---------
function openAddHubModal(root) {
  const modalRoot = root.querySelector("#lib-modal-root");
  modalRoot.innerHTML = `
    <div class="lib-modal-scrim" id="scrim">
      <div class="lib-modal lib-modal-hub">
        <header>
          <h2>What would you like to add?</h2>
          <button class="icon-btn" id="modal-close" aria-label="Close">✕</button>
        </header>
        <div class="modal-body">
          <p>Pick one — each option opens the exact flow for that task.</p>
          <div class="hub-grid">
            <button class="hub-card" data-mode="row">
              <div class="hub-ico">＋</div>
              <h4>Add a row</h4>
              <p>Single new question into the current sheet, with every column editable.</p>
            </button>
            <button class="hub-card" data-mode="append">
              <div class="hub-ico">⇪</div>
              <h4>Append rows</h4>
              <p>Pick a CSV file or paste rows — appended to an existing sheet.</p>
            </button>
            <button class="hub-card hub-danger" data-mode="replace">
              <div class="hub-ico">⟳</div>
              <h4>Replace sheet rows</h4>
              <p>Wipe the current sheet's rows and swap in a new CSV. Headers kept.</p>
            </button>
            <button class="hub-card" data-mode="new">
              <div class="hub-ico">⊞</div>
              <h4>Create new sheet</h4>
              <p>Brand-new module from a CSV, with column-role mapping.</p>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  const close = () => { modalRoot.innerHTML = ""; };
  modalRoot.querySelector("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") close(); });
  modalRoot.querySelector("#modal-close").addEventListener("click", close);
  modalRoot.querySelectorAll(".hub-card").forEach(card => {
    card.addEventListener("click", () => {
      const mode = card.dataset.mode;
      close();
      if (mode === "row") {
        if (!active) return;
        openAddRowModal(active, root);
      } else if (mode === "append") {
        openAppendRowsModal(root);
      } else if (mode === "replace") {
        openReplaceRowsModal(root);
      } else if (mode === "new") {
        openImportModal(root);
      }
    });
  });
}

// --------- Replace-rows modal: wipes current sheet's rows, keeps headers ---------
function openReplaceRowsModal(root) {
  const modalRoot = root.querySelector("#lib-modal-root");
  const sheets = getSheets();
  const sheetNames = Object.keys(sheets);
  modalRoot.innerHTML = `
    <div class="lib-modal-scrim" id="scrim">
      <div class="lib-modal" role="dialog" aria-label="Replace rows">
        <header>
          <h2>Replace sheet rows</h2>
          <button class="icon-btn" id="modal-close" aria-label="Close">✕</button>
        </header>
        <div class="modal-body">
          <div class="rp-warn">⚠ This wipes every row in the target sheet before adding the new ones. Headers are kept, so the sheet's shape is preserved. Progress on wiped rows is lost unless you've exported a backup.</div>
          <div class="form-row form-row-2">
            <label>Target sheet
              <select id="rp-target">
                ${sheetNames.map(n => `<option value="${esc(n)}" ${n === active ? "selected" : ""}>${esc(n)} (${sheets[n].rows.length} rows)</option>`).join("")}
              </select>
            </label>
            <label>CSV file <span style="text-transform:none;font-weight:400;color:var(--mut);">(optional)</span>
              <input type="file" id="rp-file" accept=".csv,text/csv,text/plain" />
            </label>
          </div>
          <div class="cols-row" id="rp-cols"></div>
          <label class="section-label">Or paste rows below</label>
          <textarea id="rp-text" rows="10" placeholder="Problem,Difficulty&#10;Reverse Linked List,Easy&#10;Two Sum,Easy"></textarea>
          <div id="rp-preview" class="ap-preview" hidden></div>
        </div>
        <footer>
          <button class="btn-ghost" id="modal-cancel">Cancel</button>
          <button class="btn-primary rp-save" id="modal-save" disabled>Replace rows</button>
        </footer>
      </div>
    </div>
  `;
  const close = () => { modalRoot.innerHTML = ""; };
  modalRoot.querySelector("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") close(); });
  modalRoot.querySelector("#modal-close").addEventListener("click", close);
  modalRoot.querySelector("#modal-cancel").addEventListener("click", close);

  const targetSel = modalRoot.querySelector("#rp-target");
  const fileInput = modalRoot.querySelector("#rp-file");
  const ta        = modalRoot.querySelector("#rp-text");
  const colsEl    = modalRoot.querySelector("#rp-cols");
  const preview   = modalRoot.querySelector("#rp-preview");
  const saveBtn   = modalRoot.querySelector("#modal-save");

  function refreshCols() {
    const sh = getSheets()[targetSel.value];
    if (!sh) { colsEl.innerHTML = ""; return; }
    colsEl.innerHTML = `<span class="cols-label">Target columns</span>` +
      sh.headers.map(h => `<span class="ap-col-pill">${esc(h)}</span>`).join("");
  }
  targetSel.addEventListener("change", () => { refreshCols(); updatePreview(); });
  refreshCols();

  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try { ta.value = await f.text(); updatePreview(); }
    catch (e) { preview.hidden = false; preview.innerHTML = `<span style="color:var(--red)">Couldn't read file: ${esc(e.message || e)}</span>`; }
  });

  function parsePaste() {
    const sh = getSheets()[targetSel.value];
    if (!sh) return { rows: [], note: "" };
    const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
    const raw = ta.value.trim();
    if (!raw) return { rows: [], note: "" };

    const firstNL = raw.indexOf("\n");
    const firstLine = firstNL < 0 ? raw : raw.slice(0, firstNL);
    const sheetHeadersLC = sh.headers.map(h => h.toLowerCase());
    let hasHeader = false;
    if (firstLine.includes(",")) {
      const parsedFirst = parseCSV(firstLine + "\n").headers;
      hasHeader = parsedFirst.some(c => sheetHeadersLC.includes(String(c).trim().toLowerCase()));
    }

    const rows = [];
    let note = "";
    if (hasHeader) {
      const parsed = parseCSV(raw + "\n");
      const headerMap = {};
      for (const h of parsed.headers) {
        const match = sh.headers.find(x => x.toLowerCase() === String(h).trim().toLowerCase());
        if (match) headerMap[h] = match;
      }
      const mapped = Object.keys(headerMap).length;
      if (!mapped) note = "⚠ No header matched — paste titles only, or match sheet column names.";
      else if (mapped < parsed.headers.length) note = `${mapped} of ${parsed.headers.length} header(s) matched · unmatched ignored`;
      else note = `${parsed.rows.length} row(s) · all ${mapped} header(s) matched`;
      for (const r of parsed.rows) {
        const patch = {};
        for (const [src, dst] of Object.entries(headerMap)) {
          if (r[src] != null && r[src] !== "") patch[dst] = r[src];
        }
        if (Object.keys(patch).length) rows.push(patch);
      }
    } else {
      if (!titleCol) note = "⚠ This sheet has no obvious title column — paste a CSV with real headers.";
      else {
        for (const line of raw.split("\n").map(l => l.trim()).filter(Boolean)) rows.push({ [titleCol]: line });
        note = `${rows.length} title(s) → ${titleCol}`;
      }
    }
    return { rows, note };
  }

  function updatePreview() {
    const { rows, note } = parsePaste();
    const sh = getSheets()[targetSel.value];
    const wipe = sh?.rows.length || 0;
    if (!ta.value.trim()) { preview.hidden = true; saveBtn.disabled = true; return; }
    preview.hidden = false;
    preview.innerHTML = `<b>Will wipe ${wipe} row${wipe === 1 ? "" : "s"}</b> and insert <b>${rows.length}</b> new row${rows.length === 1 ? "" : "s"}. ${note ? `· <span style="color:var(--mut)">${esc(note)}</span>` : ""}`;
    saveBtn.disabled = rows.length === 0;
  }
  ta.addEventListener("input", updatePreview);

  saveBtn.addEventListener("click", async () => {
    const target = targetSel.value;
    const sh = getSheets()[target];
    if (!sh) return;
    const { rows } = parsePaste();
    if (!rows.length) return;
    const ok = await confirmDanger({
      title: `Replace ${sh.rows.length} rows in "${target}"?`,
      message: `This wipes the existing rows and swaps in ${rows.length} new row(s). Headers are kept.`,
      confirmLabel: "Replace rows",
      consequences: [
        `${sh.rows.length} existing rows will be deleted`,
        `${rows.length} new rows inserted with auto-filled Seq and Status=TODO`,
        `This cannot be undone unless you have a backup`
      ]
    });
    if (!ok) return;
    try {
      const seqCol = sh.headers.find(h => /^seq$/i.test(h));
      const statusCol = sh.headers.find(h => /^status$/i.test(h));
      const newRows = [];
      let seq = 0;
      for (const patch of rows) {
        const row = {};
        for (const h of sh.headers) row[h] = "";
        if (seqCol) row[seqCol] = String(++seq);
        if (statusCol) row[statusCol] = "TODO";
        for (const [k, v] of Object.entries(patch)) {
          const col = sh.headers.find(h => h.toLowerCase() === String(k).toLowerCase()) || k;
          row[col] = v == null ? "" : String(v);
        }
        newRows.push(row);
      }
      sh.rows = newRows;
      emit("sheet", target);
      await persistSheet(target);
      active = target;
      close();
      root.innerHTML = render();
      paint(root);
      attach(root);
    } catch (e) {
      preview.hidden = false;
      preview.innerHTML = `<span style="color:var(--red)">${esc(e.message || e)}</span>`;
    }
  });
}

// --- helpers ---
function pickCol(headers, roleKey, fallbackRe) {
  const sheet = getSheets()[active];
  if (sheet && sheet.columnMap && sheet.columnMap[roleKey] && headers.includes(sheet.columnMap[roleKey])) {
    return sheet.columnMap[roleKey];
  }
  return headers.find(h => fallbackRe.test(h)) || "";
}
function uniq(arr) { return [...new Set(arr.map(s => String(s)))]; }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }
  )[c]);
}
