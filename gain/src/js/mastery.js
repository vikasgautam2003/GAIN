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

  const statsEl = root.querySelector("#m-d-stats");
  statsEl.innerHTML = `
    <span>Score: <b>${pattern.score != null ? pattern.score.toFixed(2) : "—"}</b></span>
    <span>Problems: <b>${pattern.uniqueSolved}/${pattern.totalProblems}</b></span>
    <span>Solves: <b>${pattern.solveCount}</b></span>
    ${pattern.daysSinceLatest != null ? `<span>Last touched: <b>${formatDaysAgo(pattern.daysSinceLatest)}</b></span>` : ""}
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
      solveCount: solves.length,
      latestStars: latest?.stars ?? null,
      daysAgo: latest?.daysAgo ?? null,
    });
  }
  problemList.sort((a, b) => {
    // Unsolved last, then weakest first among solved
    if (a.solveCount === 0 && b.solveCount === 0) return 0;
    if (a.solveCount === 0) return 1;
    if (b.solveCount === 0) return -1;
    return a.latestStars - b.latestStars;
  });

  const body = root.querySelector("#m-d-body");
  body.innerHTML = `
    <div class="m-plist">
      ${problemList.map(p => `
        <a class="m-prow" href="#problem/${encodeURIComponent(p.key.split("#")[0])}/${p.key.split("#")[1]}">
          <div class="m-prow-main">
            <div class="m-prow-title">${esc(p.title)}</div>
            <div class="m-prow-meta">${esc(p.difficulty || "—")}${p.solveCount > 0 ? ` · ${p.solveCount} solve${p.solveCount === 1 ? "" : "s"}` : " · unsolved"}</div>
          </div>
          <div class="m-prow-right">
            ${p.latestStars != null ? `<span class="m-prow-stars">${"★".repeat(p.latestStars)}${"☆".repeat(5 - p.latestStars)}</span>` : `<span class="m-prow-untouched">—</span>`}
            ${p.daysAgo != null ? `<span class="m-prow-days">${formatDaysAgo(p.daysAgo)}</span>` : ""}
          </div>
        </a>
      `).join("")}
    </div>
  `;

  scrim.hidden = false;
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
    .m-prow-untouched { font: 600 12.5px/1 var(--font-sans); color: var(--mut); }
    .m-prow-days { font: 500 10.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .04em; }
  `;
  document.head.appendChild(s);
}
