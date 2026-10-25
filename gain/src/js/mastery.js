// Pattern mastery map — a visual grid of every pattern across every sheet,
// each tile colored by a recency-weighted ★ average. Click a pattern to see
// the problems inside it with their latest ★ and days-since-solved.
// A "Shaky spots" row at the top surfaces the 10 weakest individual problems.
//
// Mastery score formula:
//   weight(d) = exp(-daysAgo / 60)   -- ~42-day half-life
//   mastery  = Σ(stars_i × weight_i) / Σ(weight_i)
//
// Bands: ≥4.0 Mastered · 3.0-3.99 Solid · 2.0-2.99 Shaky · <2.0 Weak · null Untouched

import { getSheets, getDayLog, on } from "./store.js";
import { calendarKey, todayKey } from "./engine.js";

let unsub = null;

export default {
  async mount(root) {
    injectStyles();
    root.innerHTML = render();
    paint(root);
    wire(root);
    if (unsub) unsub();
    unsub = on((ev) => { if (ev === "sheet" || ev === "dayLog") paint(root); });
  },
  unmount() { if (unsub) { unsub(); unsub = null; } },
};

// ============ COMPUTE ============
export function computePatternMastery() {
  const sheets = getSheets();
  const dayLog = getDayLog();
  const todayMs = Date.now();

  // Build an index: sheetName#rowIndex → { pattern, title, difficulty, kind }
  // using the Pattern/Category column + title column.
  const rowIndex = new Map();   // key → row meta
  const patternToKeys = new Map();  // pattern → Set<key>
  for (const [sheetName, sh] of Object.entries(sheets)) {
    if (!sh?.rows?.length) continue;
    const patternCol = sh.headers.find(h => /^(pattern|category)$/i.test(h));
    const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
    if (!patternCol) continue;
    for (let i = 0; i < sh.rows.length; i++) {
      const r = sh.rows[i];
      const pattern = String(r[patternCol] || "").trim();
      if (!pattern) continue;
      const key = `${sheetName}#${i}`;
      rowIndex.set(key, {
        pattern,
        title: String((titleCol && r[titleCol]) || "Problem").trim(),
        sheetName,
        rowIndex: i,
        difficulty: String(r.Difficulty || r.difficulty || "").trim(),
      });
      if (!patternToKeys.has(pattern)) patternToKeys.set(pattern, new Set());
      patternToKeys.get(pattern).add(key);
    }
  }

  // Walk every day entry; collect solves per sheet-row with ★ + timestamp.
  // Multiple solves of the same row keep each occurrence (recency weighting
  // handles it naturally).
  const solvesByKey = new Map(); // key → [{stars, daysAgo}]
  for (const [d, entry] of Object.entries(dayLog)) {
    if (!entry || !Array.isArray(entry.done)) continue;
    const dateMs = parseDateKey(d);
    if (!dateMs) continue;
    const daysAgo = Math.max(0, (todayMs - dateMs) / 86400000);
    for (const ref of entry.done) {
      const t = (entry.assigned || []).find(x => x.ref === ref);
      if (!t?.sheet || t.rowIndex == null) continue;
      const key = `${t.sheet}#${t.rowIndex}`;
      const stars = Number(entry.confidence?.[ref]);
      if (!Number.isFinite(stars) || stars < 1 || stars > 5) continue;
      if (!solvesByKey.has(key)) solvesByKey.set(key, []);
      solvesByKey.get(key).push({ stars, daysAgo });
    }
  }

  // Compute pattern mastery
  const patterns = [];
  for (const [pattern, keys] of patternToKeys.entries()) {
    let sumW = 0, sumSW = 0, solveCount = 0, uniqueSolved = 0, latest = Infinity, latestKey = null;
    for (const key of keys) {
      const solves = solvesByKey.get(key);
      if (!solves?.length) continue;
      uniqueSolved++;
      for (const s of solves) {
        const w = Math.exp(-s.daysAgo / 60);
        sumW += w;
        sumSW += s.stars * w;
        solveCount++;
        if (s.daysAgo < latest) { latest = s.daysAgo; latestKey = key; }
      }
    }
    const score = sumW > 0 ? sumSW / sumW : null;
    patterns.push({
      name: pattern,
      score,
      band: bandOf(score),
      solveCount,
      uniqueSolved,
      totalProblems: keys.size,
      daysSinceLatest: latest === Infinity ? null : latest,
    });
  }

  patterns.sort((a, b) => {
    // Prioritize scored patterns first; among those, lowest-first (weakest surface)
    if (a.score == null && b.score == null) return b.totalProblems - a.totalProblems;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return a.score - b.score;
  });

  return { patterns, rowIndex, solvesByKey };
}

export function computeWeakestProblems(ctx, n = 10) {
  // Walk every solved key; for each, take the LATEST solve's ★ and recency-weight it.
  const results = [];
  for (const [key, solves] of ctx.solvesByKey.entries()) {
    if (!solves.length) continue;
    const meta = ctx.rowIndex.get(key);
    if (!meta) continue;
    // Latest solve = min daysAgo
    const sorted = [...solves].sort((a, b) => a.daysAgo - b.daysAgo);
    const latest = sorted[0];
    const weight = Math.exp(-latest.daysAgo / 60);
    // Weakness score: lower stars + older recency = weaker
    // Compose: latest_stars × weight → smallest first
    const weakness = latest.stars * weight;
    results.push({
      key,
      title: meta.title,
      pattern: meta.pattern,
      sheetName: meta.sheetName,
      rowIndex: meta.rowIndex,
      difficulty: meta.difficulty,
      latestStars: latest.stars,
      daysAgo: latest.daysAgo,
      solveCount: solves.length,
      weakness,
    });
  }
  results.sort((a, b) => a.weakness - b.weakness);
  return results.slice(0, n);
}

function bandOf(score) {
  if (score == null) return "untouched";
  if (score >= 4.0) return "mastered";
  if (score >= 3.0) return "solid";
  if (score >= 2.0) return "shaky";
  return "weak";
}

function parseDateKey(d) {
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]) + 12 * 3600 * 1000;
  } catch { return null; }
}

// ============ RENDER ============
function render() {
  return `
    <div class="view-inner mastery">
      <header class="m-head">
        <div class="m-eyebrow">PATTERN MASTERY</div>
        <h1 class="m-title">Where you stand.</h1>
        <p class="m-sub" id="m-sub">—</p>
      </header>

      <section class="m-shaky-sec" id="m-shaky-sec" hidden>
        <div class="m-sec-h">
          <h2>Shaky spots</h2>
          <span class="m-sec-sub">The 10 solves most likely to slip — lowest ★ or oldest</span>
        </div>
        <div class="m-shaky-row" id="m-shaky-row"></div>
      </section>

      <section class="m-grid-sec">
        <div class="m-sec-h">
          <h2>Every pattern</h2>
          <span class="m-sec-sub">Color = recency-weighted ★ · darker = weaker · click to inspect</span>
          <div class="m-legend">
            <span class="lg lg-mastered">≥ 4.0</span>
            <span class="lg lg-solid">3.0–4.0</span>
            <span class="lg lg-shaky">2.0–3.0</span>
            <span class="lg lg-weak">&lt; 2.0</span>
            <span class="lg lg-untouched">untouched</span>
          </div>
        </div>
        <div class="m-grid" id="m-grid"></div>
      </section>

      <!-- Pattern detail panel -->
      <div class="m-scrim" id="m-scrim" hidden>
        <div class="m-detail" role="dialog">
          <header class="m-d-head">
            <div>
              <div class="m-d-eyebrow" id="m-d-band">—</div>
              <h2 class="m-d-title" id="m-d-title">—</h2>
              <div class="m-d-stats" id="m-d-stats">—</div>
            </div>
            <button class="m-d-close" id="m-d-close" aria-label="Close">×</button>
          </header>
          <div class="m-d-body" id="m-d-body"></div>
        </div>
      </div>
    </div>
  `;
}

// ============ PAINT ============
function paint(root) {
  const ctx = computePatternMastery();
  const weakest = computeWeakestProblems(ctx, 10);
  const subEl = root.querySelector("#m-sub");
  const totalSolved = Array.from(ctx.solvesByKey.values()).reduce((a, b) => a + b.length, 0);
  const patternsTouched = ctx.patterns.filter(p => p.score != null).length;
  if (subEl) {
    subEl.textContent = `${ctx.patterns.length} patterns across your sheets · ${patternsTouched} touched · ${totalSolved} total solves recorded`;
  }

  // Shaky
  const shakySec = root.querySelector("#m-shaky-sec");
  const shakyRow = root.querySelector("#m-shaky-row");
  if (weakest.length) {
    shakySec.hidden = false;
    shakyRow.innerHTML = weakest.map(w => `
      <article class="shaky-card" data-key="${esc(w.key)}">
        <div class="sh-stars">${"★".repeat(w.latestStars)}${"☆".repeat(5 - w.latestStars)}</div>
        <div class="sh-title">${esc(w.title)}</div>
        <div class="sh-meta">${esc(w.pattern)}${w.difficulty ? " · " + esc(w.difficulty) : ""}</div>
        <div class="sh-foot">${formatDaysAgo(w.daysAgo)} · ${w.solveCount} solve${w.solveCount === 1 ? "" : "s"}</div>
      </article>
    `).join("");
  } else {
    shakySec.hidden = true;
  }

  // Grid
  const grid = root.querySelector("#m-grid");
  grid.innerHTML = ctx.patterns.map(p => `
    <article class="p-tile p-${p.band}" data-pattern="${esc(p.name)}">
      <div class="p-tile-name">${esc(p.name)}</div>
      <div class="p-tile-score">${p.score != null ? p.score.toFixed(1) : "—"}</div>
      <div class="p-tile-meta">${p.uniqueSolved}/${p.totalProblems} solved${p.daysSinceLatest != null ? " · " + formatDaysAgo(p.daysSinceLatest) : ""}</div>
    </article>
  `).join("");
}

function wire(root) {
  const scrim = root.querySelector("#m-scrim");
  const closeDetail = () => { scrim.hidden = true; scrim.dataset.pattern = ""; };
  root.querySelector("#m-d-close")?.addEventListener("click", closeDetail);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeDetail(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !scrim.hidden) closeDetail(); });

  root.querySelector("#m-grid").addEventListener("click", (e) => {
    const tile = e.target.closest?.(".p-tile");
    if (!tile) return;
    openPatternDetail(root, tile.dataset.pattern);
  });

  // Shaky-card click → open the Problem page for that row
  root.querySelector("#m-shaky-row")?.addEventListener("click", (e) => {
    const card = e.target.closest?.(".shaky-card");
    if (!card) return;
    const [sheet, idxStr] = card.dataset.key.split("#");
    const idx = Number(idxStr);
    if (sheet && Number.isFinite(idx)) {
      location.hash = `#problem/${encodeURIComponent(sheet)}/${idx}`;
    }
  });
}

function openPatternDetail(root, patternName) {
  const ctx = computePatternMastery();
  const pattern = ctx.patterns.find(p => p.name === patternName);
  if (!pattern) return;
  const scrim = root.querySelector("#m-scrim");
  scrim.dataset.pattern = patternName;
  root.querySelector("#m-d-title").textContent = patternName;
  const band = root.querySelector("#m-d-band");
  band.className = `m-d-eyebrow band-${pattern.band}`;
  band.textContent = BAND_LABELS[pattern.band] || pattern.band;

  // Collect last 10 solves across every problem in this pattern (for sparkline)
  const allSolves = [];
  for (const [key, meta] of ctx.rowIndex.entries()) {
    if (meta.pattern !== patternName) continue;
    const solves = ctx.solvesByKey.get(key) || [];
    for (const s of solves) allSolves.push({ ...s });
  }
  allSolves.sort((a, b) => a.daysAgo - b.daysAgo);
  const spark = allSolves.slice(0, 12).reverse();
  const sparkHtml = spark.length ? renderSparkline(spark) : "";

  const statsEl = root.querySelector("#m-d-stats");
  statsEl.innerHTML = `
    <div class="m-d-stat-row">
      <span class="m-d-stat"><label>Score</label><b>${pattern.score != null ? pattern.score.toFixed(2) : "—"}</b></span>
      <span class="m-d-stat"><label>Problems</label><b>${pattern.uniqueSolved}/${pattern.totalProblems}</b></span>
      <span class="m-d-stat"><label>Solves</label><b>${pattern.solveCount}</b></span>
      ${pattern.daysSinceLatest != null ? `<span class="m-d-stat"><label>Last</label><b>${formatDaysAgo(pattern.daysSinceLatest)}</b></span>` : ""}
    </div>
    ${sparkHtml ? `<div class="m-d-spark"><label>Last ${spark.length} solves →</label>${sparkHtml}</div>` : ""}
  `;

  // List problems in this pattern
  const problemList = [];
  for (const [key, meta] of ctx.rowIndex.entries()) {
    if (meta.pattern !== patternName) continue;
    const solves = ctx.solvesByKey.get(key) || [];
    const sorted = [...solves].sort((a, b) => a.daysAgo - b.daysAgo);
    const latest = sorted[0];
    problemList.push({
      key, title: meta.title, difficulty: meta.difficulty,
      sheetName: meta.sheetName, rowIndex: meta.rowIndex,
      solveCount: solves.length,
      latestStars: latest?.stars ?? null,
      daysAgo: latest?.daysAgo ?? null,
    });
  }
  problemList.sort((a, b) => {
    if (a.solveCount === 0 && b.solveCount === 0) return 0;
    if (a.solveCount === 0) return 1;
    if (b.solveCount === 0) return -1;
    return a.latestStars - b.latestStars;
  });

  const body = root.querySelector("#m-d-body");
  body.innerHTML = `
    <div class="m-plist">
      ${problemList.map(p => {
        const diffBadge = p.difficulty ? `<span class="m-diff m-diff-${p.difficulty.toLowerCase().replace(/[^a-z]/g, "")}">${esc(p.difficulty)}</span>` : "";
        const starLine = p.latestStars != null
          ? `<span class="m-prow-stars">${"★".repeat(p.latestStars)}<span class="s-faint">${"★".repeat(5 - p.latestStars)}</span></span>`
          : `<span class="m-prow-untouched">unsolved</span>`;
        return `
          <div class="m-prow" data-sheet="${esc(p.sheetName)}" data-idx="${p.rowIndex}">
            <div class="m-prow-left">
              <div class="m-prow-title">${esc(p.title)}</div>
              <div class="m-prow-meta">
                ${diffBadge}
                ${p.solveCount > 0 ? `<span>${p.solveCount} solve${p.solveCount === 1 ? "" : "s"}</span>` : ""}
                ${p.daysAgo != null ? `<span>${formatDaysAgo(p.daysAgo)}</span>` : ""}
              </div>
            </div>
            <div class="m-prow-right">
              ${starLine}
              <div class="m-prow-actions">
                <button class="m-prow-btn" data-act="add" title="Add to today's plan">+ Today</button>
                <a class="m-prow-btn primary" href="#problem/${encodeURIComponent(p.sheetName)}/${p.rowIndex}">Open</a>
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  // Wire add-to-today
  body.querySelectorAll("[data-act=\"add\"]").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const row = btn.closest(".m-prow");
      await addToToday(row.dataset.sheet, +row.dataset.idx, btn);
    });
  });

  scrim.hidden = false;
}

async function addToToday(sheetName, rowIndex, btn) {
  const { updateDayLog, getSheets, getSettings } = await import("./store.js");
  const { todayKey, priceTask } = await import("./engine.js");
  const dateKey = todayKey();
  const sheets = getSheets();
  const sh = sheets[sheetName];
  if (!sh || !sh.rows[rowIndex]) return;
  const r = sh.rows[rowIndex];
  const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
  const patternCol = sh.headers.find(h => /^(pattern|category)$/i.test(h));
  const diffCol = sh.headers.find(h => /^difficulty$/i.test(h));
  const kind = /dsa/i.test(sheetName) ? "dsa" : /sql/i.test(sheetName) ? "sql" : /system.?design/i.test(sheetName) ? "sd" : /int/i.test(sheetName) ? "int" : "ext";
  const task = {
    ref: `MASTERY-${Date.now()}`,
    kind,
    title: String((titleCol && r[titleCol]) || "Problem").trim(),
    pattern: patternCol ? String(r[patternCol] || "").trim() : "",
    difficulty: diffCol ? String(r[diffCol] || "").trim() : "",
    minutes: 40,
    sheet: sheetName,
    rowIndex,
  };
  task.value = priceTask(task, getSettings());
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    if (d.assigned.some(t => t.sheet === sheetName && t.rowIndex === rowIndex)) return;
    d.assigned.push(task);
    d.values[task.ref] = task.value;
  });
  if (btn) { btn.textContent = "✓ added"; btn.disabled = true; setTimeout(() => { btn.textContent = "+ Today"; btn.disabled = false; }, 1800); }
}

function renderSparkline(solves) {
  // solves: [{stars, daysAgo}] ordered oldest → newest
  const W = 180, H = 32, pad = 4;
  if (!solves.length) return "";
  const xs = solves.map((_, i) => pad + (i * (W - pad * 2) / Math.max(1, solves.length - 1)));
  const ys = solves.map(s => H - pad - ((s.stars - 1) / 4) * (H - pad * 2));
  const path = xs.map((x, i) => (i === 0 ? "M" : "L") + x.toFixed(1) + "," + ys[i].toFixed(1)).join(" ");
  const dots = xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="2.5" fill="var(--gold)" />`).join("");
  return `
    <svg class="m-spark-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMinYMid meet">
      <path d="${path}" fill="none" stroke="var(--gold)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".55" />
      ${dots}
    </svg>
  `;
}

const BAND_LABELS = {
  mastered: "MASTERED",
  solid: "SOLID",
  shaky: "SHAKY",
  weak: "WEAK",
  untouched: "UNTOUCHED",
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}
function formatDaysAgo(d) {
  if (d == null) return "—";
  if (d < 1) return "today";
  if (d < 2) return "1d ago";
  if (d < 30) return `${Math.round(d)}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

function injectStyles() {
  if (document.getElementById("mastery-styles")) return;
  const s = document.createElement("style");
  s.id = "mastery-styles";
  s.textContent = `
    .mastery .m-scrim[hidden] { display: none !important; }
    .mastery .m-shaky-sec[hidden] { display: none !important; }

    .mastery { padding: 20px 16px 60px; }
    .m-head { max-width: 920px; margin: 36px auto 32px; }
    .m-eyebrow { font: 700 11.5px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase; color: var(--gold); margin-bottom: 14px; }
    .m-title { margin: 0 0 10px; font: 600 44px/1.06 var(--font-sans); letter-spacing: -.025em; color: var(--ink); }
    .m-sub { font: 400 15px/1.55 var(--font-sans); color: var(--mut); margin: 0; }

    .m-sec-h { display: flex; align-items: baseline; gap: 14px; max-width: 1100px; margin: 0 auto 16px; flex-wrap: wrap; }
    .m-sec-h h2 { margin: 0; font: 600 22px/1.2 var(--font-sans); letter-spacing: -.01em; color: var(--ink); }
    .m-sec-sub { color: var(--mut); font-size: 13px; }
    .m-legend { display: inline-flex; gap: 8px; margin-left: auto; flex-wrap: wrap; }
    .m-legend .lg { font: 600 10.5px/1 var(--font-sans); letter-spacing: .06em; padding: 5px 9px; border-radius: 6px; }
    .m-legend .lg-mastered { background: color-mix(in oklab, var(--green) 20%, var(--paper)); color: var(--green); }
    .m-legend .lg-solid    { background: color-mix(in oklab, var(--blue, #3870ff) 18%, var(--paper)); color: var(--blue, #3870ff); }
    .m-legend .lg-shaky    { background: color-mix(in oklab, var(--gold) 24%, var(--paper)); color: var(--gold); }
    .m-legend .lg-weak     { background: color-mix(in oklab, var(--red) 20%, var(--paper)); color: var(--red); }
    .m-legend .lg-untouched{ background: var(--bg); color: var(--mut); border: 1px solid var(--line); }

    /* Shaky spots row */
    .m-shaky-sec { max-width: 1100px; margin: 0 auto 44px; }
    .m-shaky-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .shaky-card {
      padding: 14px 16px;
      background: var(--paper); border: 1px solid var(--line); border-left: 3px solid var(--red);
      border-radius: 10px; cursor: pointer;
      transition: all .18s ease;
    }
    .shaky-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,.08); border-color: var(--red); }
    .sh-stars { font: 600 13px/1 var(--font-sans); color: var(--red); letter-spacing: .04em; margin-bottom: 8px; }
    .sh-title { font: 600 14px/1.3 var(--font-sans); color: var(--ink); margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .sh-meta { font: 500 11px/1.3 var(--font-sans); color: var(--mut); margin-bottom: 10px; letter-spacing: .02em; }
    .sh-foot { font: 500 10.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .04em; }

    /* Pattern grid */
    .m-grid-sec { max-width: 1100px; margin: 0 auto; }
    .m-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
    .p-tile {
      padding: 14px 14px 12px;
      border-radius: 10px; cursor: pointer;
      border: 1px solid var(--line);
      transition: all .18s ease;
      position: relative; overflow: hidden;
    }
    .p-tile:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(0,0,0,.08); }
    .p-mastered { background: color-mix(in oklab, var(--green) 14%, var(--paper)); border-color: color-mix(in oklab, var(--green) 30%, var(--line)); }
    .p-solid    { background: color-mix(in oklab, var(--blue, #3870ff) 11%, var(--paper)); border-color: color-mix(in oklab, var(--blue, #3870ff) 26%, var(--line)); }
    .p-shaky    { background: color-mix(in oklab, var(--gold) 15%, var(--paper)); border-color: color-mix(in oklab, var(--gold) 32%, var(--line)); }
    .p-weak     { background: color-mix(in oklab, var(--red) 12%, var(--paper)); border-color: color-mix(in oklab, var(--red) 28%, var(--line)); }
    .p-untouched{ background: var(--bg); border-color: var(--line); color: var(--mut); }

    .p-tile-name { font: 700 13.5px/1.3 var(--font-sans); color: var(--ink); margin-bottom: 10px; }
    .p-untouched .p-tile-name { color: var(--mut); }
    .p-tile-score { font: 800 24px/1 var(--font-sans); letter-spacing: -.02em; color: var(--ink); margin-bottom: 6px; }
    .p-untouched .p-tile-score { color: color-mix(in oklab, var(--mut) 60%, var(--paper)); }
    .p-tile-meta { font: 500 11px/1.3 var(--font-sans); color: var(--mut); letter-spacing: .02em; }

    /* Detail */
    .m-scrim {
      position: fixed; inset: 0; z-index: 1500;
      background: rgba(0,0,0,.6); backdrop-filter: blur(10px);
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .m-detail {
      background: var(--paper); border-radius: 16px;
      width: 100%; max-width: 640px; max-height: 92vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 32px 80px rgba(0,0,0,.3), 0 0 0 1px var(--line);
      animation: mdPop .25s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes mdPop { from { opacity: 0; transform: translateY(16px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .m-d-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 22px 26px 18px; border-bottom: 1px solid var(--line); gap: 10px; }
    .m-d-eyebrow {
      display: inline-block; margin-bottom: 10px;
      font: 700 10.5px/1 var(--font-sans); letter-spacing: .22em;
      padding: 5px 10px; border-radius: 5px;
    }
    .m-d-eyebrow.band-mastered { background: color-mix(in oklab, var(--green) 24%, var(--paper)); color: var(--green); }
    .m-d-eyebrow.band-solid    { background: color-mix(in oklab, var(--blue, #3870ff) 20%, var(--paper)); color: var(--blue, #3870ff); }
    .m-d-eyebrow.band-shaky    { background: color-mix(in oklab, var(--gold) 28%, var(--paper)); color: var(--gold); }
    .m-d-eyebrow.band-weak     { background: color-mix(in oklab, var(--red) 22%, var(--paper)); color: var(--red); }
    .m-d-eyebrow.band-untouched{ background: var(--bg); color: var(--mut); border: 1px solid var(--line); }
    .m-d-title { margin: 0 0 8px; font: 600 24px/1.2 var(--font-sans); letter-spacing: -.015em; color: var(--ink); }
    .m-d-stats { display: flex; flex-wrap: wrap; gap: 14px; font: 500 12.5px/1 var(--font-sans); color: var(--mut); }
    .m-d-stats b { color: var(--ink); font-weight: 700; }
    .m-d-close {
      flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px;
      background: transparent; border: 1px solid var(--line); color: var(--mut); cursor: pointer;
      font: 400 18px/1 var(--font-sans);
    }
    .m-d-close:hover { color: var(--ink); border-color: var(--line2); }
    .m-d-body { padding: 20px 26px 26px; overflow-y: auto; }

    .m-plist { display: flex; flex-direction: column; gap: 6px; }
    .m-prow {
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 11px 14px; background: var(--paper); border: 1px solid var(--line); border-radius: 8px;
      text-decoration: none; color: inherit;
      transition: all .14s ease;
    }
    .m-prow:hover { background: var(--bg); border-color: var(--line2); transform: translateX(2px); }
    .m-prow-main { min-width: 0; flex: 1; }
    .m-prow-title { font: 600 13.5px/1.3 var(--font-sans); color: var(--ink); margin-bottom: 2px; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
    .m-prow-meta { font: 500 11px/1.3 var(--font-sans); color: var(--mut); letter-spacing: .02em; }
    .m-prow-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
    .m-prow-stars { font: 600 12.5px/1 var(--font-sans); color: var(--gold); letter-spacing: .04em; }
    .m-prow-stars .s-faint { color: color-mix(in oklab, var(--mut) 50%, var(--paper)); }
    .m-prow-untouched { font: 600 11.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .04em; text-transform: uppercase; }
    .m-prow-days { font: 500 10.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .04em; }
    .m-prow-left { min-width: 0; flex: 1; }
    .m-prow-actions { display: flex; gap: 6px; margin-top: 6px; }
    .m-prow-btn { padding: 5px 10px; border-radius: 6px; font: 600 11px/1 var(--font-sans); border: 1px solid var(--line2); background: var(--paper); color: var(--mut); cursor: pointer; text-decoration: none; transition: all .14s; }
    .m-prow-btn:hover { color: var(--ink); border-color: var(--ink); }
    .m-prow-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .m-prow-btn.primary:hover { filter: brightness(1.1); }
    .m-diff { padding: 3px 7px; border-radius: 5px; font: 700 10px/1 var(--font-sans); letter-spacing: .08em; text-transform: uppercase; }
    .m-diff-easy   { background: color-mix(in oklab, var(--green) 16%, var(--paper)); color: var(--green); }
    .m-diff-medium { background: color-mix(in oklab, var(--gold) 20%, var(--paper)); color: var(--gold); }
    .m-diff-hard   { background: color-mix(in oklab, var(--red) 16%, var(--paper)); color: var(--red); }
    .m-d-stat-row { display: flex; flex-wrap: wrap; gap: 20px; }
    .m-d-stat { display: inline-flex; flex-direction: column; gap: 3px; }
    .m-d-stat label { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }
    .m-d-stat b { font: 800 18px/1 var(--font-sans); color: var(--ink); letter-spacing: -.02em; }
    .m-d-spark { display: flex; align-items: center; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--line); }
    .m-d-spark label { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }
    .m-spark-svg { flex: 1; }
  `;
  document.head.appendChild(s);
}
