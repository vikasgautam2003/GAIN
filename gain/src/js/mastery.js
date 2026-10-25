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
let activeTab = "overview";    // "overview" | "shaky" | "all"
let shakyFilter = { pattern: "", difficulty: "", sheet: "" };
let allFilter = { band: "" };  // "" | "mastered" | "solid" | "shaky" | "weak" | "untouched"

export default {
  async mount(root) {
    injectStyles();
    root.innerHTML = render();
    // Portal the modal scrim to document.body so position:fixed is relative
    // to the viewport, not to .view-inner (which carries an animation transform).
    const scrim = root.querySelector("#m-scrim");
    if (scrim) document.body.appendChild(scrim);
    paint(root);
    wire(root);
    if (unsub) unsub();
    unsub = on((ev) => { if (ev === "sheet" || ev === "dayLog") paint(root); });
  },
  unmount() {
    if (unsub) { unsub(); unsub = null; }
    document.getElementById("m-scrim")?.remove();
  },
};

// ============ COMPUTE ============
export function computePatternMastery() {
  const sheets = getSheets();
  const dayLog = getDayLog();
  const todayMs = Date.now();

  const rowIndex = new Map();
  const patternToKeys = new Map();
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

  const solvesByKey = new Map();
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
    if (a.score == null && b.score == null) return b.totalProblems - a.totalProblems;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return a.score - b.score;
  });

  return { patterns, rowIndex, solvesByKey };
}

export function computeWeakestProblems(ctx, n = 10) {
  const results = [];
  for (const [key, solves] of ctx.solvesByKey.entries()) {
    if (!solves.length) continue;
    const meta = ctx.rowIndex.get(key);
    if (!meta) continue;
    const sorted = [...solves].sort((a, b) => a.daysAgo - b.daysAgo);
    const latest = sorted[0];
    const weight = Math.exp(-latest.daysAgo / 60);
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
        <div class="m-head-left">
          <div class="m-eyebrow">PATTERN MASTERY</div>
          <h1 class="m-title">Where you stand.</h1>
          <p class="m-motiv" id="m-motiv">—</p>
        </div>
        <aside class="m-head-right" id="m-head-right"></aside>
      </header>

      <section class="m-distrib-sec" id="m-distrib-sec" hidden>
        <div class="m-distrib-bar" id="m-distrib-bar"></div>
        <div class="m-distrib-legend" id="m-distrib-legend"></div>
      </section>

      <nav class="m-tabs" role="tablist" aria-label="Mastery view">
        <button class="m-tab" role="tab" data-tab="overview">
          <span class="m-tab-label">Overview</span>
          <span class="m-tab-dot"></span>
        </button>
        <button class="m-tab" role="tab" data-tab="shaky">
          <span class="m-tab-label">Shaky spots</span>
          <span class="m-tab-count" id="m-tab-count-shaky">—</span>
        </button>
        <button class="m-tab" role="tab" data-tab="all">
          <span class="m-tab-label">All patterns</span>
          <span class="m-tab-count" id="m-tab-count-all">—</span>
        </button>
      </nav>

      <section class="m-panel" id="m-panel" aria-live="polite"></section>

      <!-- Pattern detail — content built fresh in openPatternDetail -->
      <div class="m-scrim" id="m-scrim" hidden></div>
    </div>
  `;
}

// ============ PAINT ============
function paint(root) {
  const ctx = computePatternMastery();
  const weakest = computeWeakestProblems(ctx, 10);

  // Band counts
  const counts = { mastered: 0, solid: 0, shaky: 0, weak: 0, untouched: 0 };
  for (const p of ctx.patterns) counts[p.band]++;
  const total = ctx.patterns.length;
  const touched = total - counts.untouched;

  // Overall weighted ★ (across all solves, recency-weighted)
  let sumW = 0, sumSW = 0, totalSolves = 0;
  for (const solves of ctx.solvesByKey.values()) {
    for (const s of solves) {
      const w = Math.exp(-s.daysAgo / 60);
      sumW += w;
      sumSW += s.stars * w;
      totalSolves++;
    }
  }
  const overall = sumW > 0 ? sumSW / sumW : null;

  // Hero stat chip
  const headRight = root.querySelector("#m-head-right");
  if (overall != null) {
    headRight.innerHTML = `
      <div class="m-overall">
        <div class="m-overall-score">${overall.toFixed(1)}</div>
        <div class="m-overall-stars">${renderStarRow(overall)}</div>
        <div class="m-overall-label">overall ★ · ${totalSolves} solve${totalSolves === 1 ? "" : "s"}</div>
      </div>
    `;
  } else {
    headRight.innerHTML = `
      <div class="m-overall m-overall-empty">
        <div class="m-overall-score">·</div>
        <div class="m-overall-label">no solves yet</div>
      </div>
    `;
  }

  // Motivation line
  const motivEl = root.querySelector("#m-motiv");
  if (total === 0) {
    motivEl.textContent = "No sheets have a Pattern column yet — add one to start the map.";
  } else if (touched === 0) {
    motivEl.textContent = `${total} patterns waiting. Solve one and the map starts to glow.`;
  } else if (counts.untouched > 0) {
    motivEl.innerHTML = `<b>${touched}</b> of ${total} patterns touched · <b>${counts.untouched}</b> still untouched.`;
  } else {
    motivEl.innerHTML = `All <b>${total}</b> patterns touched. ${counts.mastered} mastered · ${counts.weak + counts.shaky} needing reinforcement.`;
  }

  // Distribution bar
  const distribSec = root.querySelector("#m-distrib-sec");
  if (total > 0) {
    distribSec.hidden = false;
    const bar = root.querySelector("#m-distrib-bar");
    const legend = root.querySelector("#m-distrib-legend");
    const bands = [
      { k: "mastered", label: "Mastered", c: counts.mastered },
      { k: "solid",    label: "Solid",    c: counts.solid },
      { k: "shaky",    label: "Shaky",    c: counts.shaky },
      { k: "weak",     label: "Weak",     c: counts.weak },
      { k: "untouched",label: "Untouched",c: counts.untouched },
    ];
    bar.innerHTML = bands.filter(b => b.c > 0).map(b => {
      const pct = (b.c / total * 100).toFixed(2);
      return `<span class="m-db-seg m-db-${b.k}" style="width:${pct}%" title="${b.c} ${b.label}"></span>`;
    }).join("");
    legend.innerHTML = bands.map(b => `
      <span class="m-db-leg">
        <span class="m-db-dot m-db-${b.k}"></span>
        <b>${b.c}</b> ${b.label}
      </span>
    `).join("");
  } else {
    distribSec.hidden = true;
  }

  // Full weakest list for the Shaky tab (not just top 10)
  const allWeakest = computeWeakestProblems(ctx, 500);

  // Tab counts
  root.querySelector("#m-tab-count-shaky").textContent = String(allWeakest.length);
  root.querySelector("#m-tab-count-all").textContent = String(ctx.patterns.length);

  // Mark active tab
  root.querySelectorAll(".m-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === activeTab));

  // Panel content
  const panel = root.querySelector("#m-panel");
  if (activeTab === "overview") panel.innerHTML = renderOverviewPanel(ctx, weakest);
  else if (activeTab === "shaky") panel.innerHTML = renderShakyPanel(allWeakest);
  else panel.innerHTML = renderAllPanel(ctx);

  // Delegate clicks on dynamically-rendered content
  wirePanelClicks(panel, root);
}

function renderOverviewPanel(ctx, weakest) {
  // Top 4 most mastered patterns (score ≥ 3) sorted desc, for a positive signal
  const strongest = ctx.patterns.filter(p => p.score != null).slice().sort((a, b) => b.score - a.score).slice(0, 4);
  return `
    <div class="m-ov-grid">
      <div class="m-ov-col">
        <div class="m-sec-h m-sec-h-inner">
          <h2>Shaky spots</h2>
          <span class="m-sec-sub">Top ${weakest.length} most likely to slip</span>
        </div>
        <div class="m-shaky-row">
          ${weakest.length === 0
            ? `<div class="m-empty">Nothing shaky yet — keep rating as ★1-3 to populate this list.</div>`
            : weakest.map(renderShakyCard).join("")}
        </div>
      </div>
      ${strongest.length > 0 ? `
      <div class="m-ov-col">
        <div class="m-sec-h m-sec-h-inner">
          <h2>Your strongest</h2>
          <span class="m-sec-sub">Highest recency-weighted ★</span>
        </div>
        <div class="m-strongest">
          ${strongest.map(p => `
            <article class="p-tile p-${p.band} p-tile-mini" data-pattern="${esc(p.name)}">
              <div class="p-tile-stripe"></div>
              <div class="p-tile-top">
                <div class="p-tile-name">${esc(p.name)}</div>
                <div class="p-tile-score">${p.score.toFixed(1)}</div>
              </div>
              <div class="p-tile-foot">
                <span>${p.uniqueSolved}/${p.totalProblems}</span>
                <span>${p.daysSinceLatest != null ? formatDaysAgo(p.daysSinceLatest) : ""}</span>
              </div>
            </article>
          `).join("")}
        </div>
      </div>` : ""}
    </div>
  `;
}

function renderShakyPanel(allWeakest) {
  // Build filter options
  const patterns = Array.from(new Set(allWeakest.map(w => w.pattern))).filter(Boolean).sort();
  const diffs = Array.from(new Set(allWeakest.map(w => w.difficulty))).filter(Boolean).sort();
  const sheets = Array.from(new Set(allWeakest.map(w => w.sheetName))).filter(Boolean).sort();

  const filtered = allWeakest.filter(w =>
    (!shakyFilter.pattern || w.pattern === shakyFilter.pattern) &&
    (!shakyFilter.difficulty || w.difficulty === shakyFilter.difficulty) &&
    (!shakyFilter.sheet || w.sheetName === shakyFilter.sheet)
  );

  const chip = (name, active, label) => `
    <button class="m-filter-chip ${active ? "active" : ""}" data-sf-${name}="${esc(label || "")}">${label || "All"}</button>
  `;

  return `
    <div class="m-filter-bar">
      <div class="m-filter-group">
        <label class="m-filter-label">Pattern</label>
        <div class="m-filter-chips" data-filter="pattern">
          ${chip("pattern", shakyFilter.pattern === "", "")}
          ${patterns.map(p => chip("pattern", shakyFilter.pattern === p, p)).join("")}
        </div>
      </div>
      ${diffs.length ? `
      <div class="m-filter-group">
        <label class="m-filter-label">Difficulty</label>
        <div class="m-filter-chips" data-filter="difficulty">
          ${chip("difficulty", shakyFilter.difficulty === "", "")}
          ${diffs.map(d => chip("difficulty", shakyFilter.difficulty === d, d)).join("")}
        </div>
      </div>` : ""}
      ${sheets.length > 1 ? `
      <div class="m-filter-group">
        <label class="m-filter-label">Sheet</label>
        <div class="m-filter-chips" data-filter="sheet">
          ${chip("sheet", shakyFilter.sheet === "", "")}
          ${sheets.map(s => chip("sheet", shakyFilter.sheet === s, s)).join("")}
        </div>
      </div>` : ""}
      <div class="m-filter-stat">${filtered.length} of ${allWeakest.length}</div>
    </div>
    <div class="m-shaky-grid">
      ${filtered.length === 0
        ? `<div class="m-empty">No shaky problems match your filters.</div>`
        : filtered.map(renderShakyCard).join("")}
    </div>
  `;
}

function renderAllPanel(ctx) {
  const bands = [
    { k: "", label: "All", c: ctx.patterns.length },
    { k: "mastered", label: "Mastered", c: ctx.patterns.filter(p => p.band === "mastered").length },
    { k: "solid",    label: "Solid",    c: ctx.patterns.filter(p => p.band === "solid").length },
    { k: "shaky",    label: "Shaky",    c: ctx.patterns.filter(p => p.band === "shaky").length },
    { k: "weak",     label: "Weak",     c: ctx.patterns.filter(p => p.band === "weak").length },
    { k: "untouched",label: "Untouched",c: ctx.patterns.filter(p => p.band === "untouched").length },
  ];
  const filtered = ctx.patterns.filter(p => !allFilter.band || p.band === allFilter.band);
  return `
    <div class="m-filter-bar m-filter-bar-tight">
      <div class="m-filter-group">
        <label class="m-filter-label">Band</label>
        <div class="m-filter-chips" data-filter="band">
          ${bands.map(b => `<button class="m-filter-chip ${allFilter.band === b.k ? "active" : ""}" data-af-band="${b.k}">${b.label} <span class="m-fc-count">${b.c}</span></button>`).join("")}
        </div>
      </div>
    </div>
    <div class="m-grid">
      ${filtered.map(p => {
        const pct = p.totalProblems > 0 ? (p.uniqueSolved / p.totalProblems * 100) : 0;
        const scoreTxt = p.score != null ? p.score.toFixed(1) : "·";
        const scoreCls = p.score == null ? "p-tile-score-empty" : "";
        const metaRight = p.daysSinceLatest != null ? formatDaysAgo(p.daysSinceLatest) : "untouched";
        return `
          <article class="p-tile p-${p.band}" data-pattern="${esc(p.name)}">
            <div class="p-tile-stripe"></div>
            <div class="p-tile-top">
              <div class="p-tile-name">${esc(p.name)}</div>
              <div class="p-tile-score ${scoreCls}">${scoreTxt}</div>
            </div>
            <div class="p-tile-bar">
              <span class="p-tile-fill" style="width:${pct.toFixed(1)}%"></span>
            </div>
            <div class="p-tile-foot">
              <span>${p.uniqueSolved}/${p.totalProblems}</span>
              <span>${metaRight}</span>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderShakyCard(w) {
  const severity = w.latestStars <= 2 ? "sev-high" : w.latestStars <= 3 ? "sev-mid" : "sev-low";
  return `
    <article class="shaky-card ${severity}" data-key="${esc(w.key)}">
      <div class="sh-top">
        <span class="sh-stars">${renderStarRow(w.latestStars)}</span>
        <span class="sh-days">${formatDaysAgo(w.daysAgo)}</span>
      </div>
      <div class="sh-title">${esc(w.title)}</div>
      <div class="sh-foot">
        <span class="sh-pattern">${esc(w.pattern)}</span>
        ${w.difficulty ? `<span class="m-diff m-diff-${w.difficulty.toLowerCase().replace(/[^a-z]/g, "")}">${esc(w.difficulty)}</span>` : ""}
      </div>
      <span class="sh-arrow" aria-hidden="true">→</span>
    </article>
  `;
}

function wirePanelClicks(panel, root) {
  // Pattern tile → open detail
  panel.querySelectorAll(".p-tile").forEach(tile => {
    tile.addEventListener("click", () => openPatternDetail(root, tile.dataset.pattern));
  });
  // Shaky card → open problem page
  panel.querySelectorAll(".shaky-card").forEach(card => {
    card.addEventListener("click", () => {
      const [sheet, idxStr] = card.dataset.key.split("#");
      const idx = Number(idxStr);
      if (sheet && Number.isFinite(idx)) location.hash = `#problem/${encodeURIComponent(sheet)}/${idx}`;
    });
  });
  // Filter chip clicks (Shaky)
  panel.querySelectorAll("[data-sf-pattern]").forEach(b => b.addEventListener("click", () => { shakyFilter.pattern = b.dataset.sfPattern; paint(root); }));
  panel.querySelectorAll("[data-sf-difficulty]").forEach(b => b.addEventListener("click", () => { shakyFilter.difficulty = b.dataset.sfDifficulty; paint(root); }));
  panel.querySelectorAll("[data-sf-sheet]").forEach(b => b.addEventListener("click", () => { shakyFilter.sheet = b.dataset.sfSheet; paint(root); }));
  // Filter chip clicks (All patterns)
  panel.querySelectorAll("[data-af-band]").forEach(b => b.addEventListener("click", () => { allFilter.band = b.dataset.afBand; paint(root); }));
}

function wire(root) {
  // Esc closes the detail scrim if open
  document.addEventListener("keydown", (e) => {
    const scrim = document.getElementById("m-scrim");
    if (e.key === "Escape" && scrim && !scrim.hidden) {
      scrim.hidden = true;
      scrim.innerHTML = "";
    }
  });

  // Tab switching
  root.querySelectorAll(".m-tab").forEach(t => {
    t.addEventListener("click", () => {
      activeTab = t.dataset.tab;
      paint(root);
    });
  });
}

function openPatternDetail(root, patternName) {
  const ctx = computePatternMastery();
  const pattern = ctx.patterns.find(p => p.name === patternName);
  if (!pattern) return;
  const scrim = document.getElementById("m-scrim");
  if (!scrim) return;

  // Compute solves for sparkline
  const allSolves = [];
  for (const [key, meta] of ctx.rowIndex.entries()) {
    if (meta.pattern !== patternName) continue;
    const solves = ctx.solvesByKey.get(key) || [];
    for (const s of solves) allSolves.push({ ...s });
  }
  allSolves.sort((a, b) => a.daysAgo - b.daysAgo);
  const spark = allSolves.slice(0, 12).reverse();
  const sparkHtml = spark.length ? renderSparkline(spark) : "";

  // Build problem list sorted weakest-first
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

  // Build the entire modal HTML in one shot — no stale placeholders can leak
  const bandLabel = BAND_LABELS[pattern.band] || pattern.band;
  scrim.innerHTML = `
    <div class="m-detail" role="dialog" aria-labelledby="m-d-title">
      <header class="m-d-head">
        <div class="m-d-head-left">
          <div class="m-d-eyebrow band-${pattern.band}">${bandLabel}</div>
          <h2 class="m-d-title" id="m-d-title">${esc(patternName)}</h2>
          <div class="m-d-stats">
            <div class="m-d-stat-row">
              <span class="m-d-stat"><label>Score</label><b>${pattern.score != null ? pattern.score.toFixed(2) : "—"}</b></span>
              <span class="m-d-stat"><label>Problems</label><b>${pattern.uniqueSolved}/${pattern.totalProblems}</b></span>
              <span class="m-d-stat"><label>Solves</label><b>${pattern.solveCount}</b></span>
              ${pattern.daysSinceLatest != null ? `<span class="m-d-stat"><label>Last</label><b>${formatDaysAgo(pattern.daysSinceLatest)}</b></span>` : ""}
            </div>
            ${sparkHtml ? `<div class="m-d-spark"><label>Last ${spark.length} solves →</label>${sparkHtml}</div>` : ""}
          </div>
        </div>
        <button class="m-d-close" id="m-d-close" aria-label="Close">×</button>
      </header>
      <div class="m-d-body">
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
      </div>
    </div>
  `;

  // Re-wire close + "+ Today" (innerHTML wiped the previous handlers)
  const closeDetail = () => { scrim.hidden = true; scrim.innerHTML = ""; };
  scrim.querySelector("#m-d-close")?.addEventListener("click", closeDetail);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeDetail(); });
  scrim.querySelectorAll("[data-act=\"add\"]").forEach(btn => {
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

// Render 5 star glyphs with filled stars for the given score (rounded).
function renderStarRow(score) {
  const n = Math.max(0, Math.min(5, Math.round(score)));
  return `<span class="s-filled">${"★".repeat(n)}</span><span class="s-empty">${"★".repeat(5 - n)}</span>`;
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
    .mastery .m-distrib-sec[hidden] { display: none !important; }

    .mastery { padding: 18px 16px 60px; --m-max: 1120px; }

    /* ---- HERO ---- */
    .m-head {
      position: relative;
      max-width: var(--m-max); margin: 28px auto 26px;
      display: grid; grid-template-columns: 1fr auto; gap: 36px; align-items: end;
    }
    .m-head::after {
      content: ""; position: absolute; left: 0; right: 0; bottom: -18px; height: 1px;
      background: linear-gradient(90deg, transparent, var(--line), transparent);
    }
    .m-head-left { min-width: 0; }
    .m-eyebrow {
      display: inline-flex; align-items: center; gap: 8px;
      font: 700 11.5px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase;
      color: var(--gold); margin-bottom: 14px;
    }
    .m-eyebrow::before {
      content: ""; display: inline-block; width: 24px; height: 1.5px; background: var(--gold); opacity: .6;
    }
    .m-title { margin: 0 0 12px; font: 600 46px/1.02 var(--font-sans); letter-spacing: -.03em; color: var(--ink); }
    .m-motiv { font: 400 15px/1.55 var(--font-sans); color: var(--mut); margin: 0; max-width: 58ch; }
    .m-motiv b { color: var(--ink); font-weight: 600; }

    .m-head-right { flex-shrink: 0; }
    .m-overall {
      position: relative; text-align: right;
      display: flex; flex-direction: column; gap: 6px; align-items: flex-end;
      padding: 16px 20px 14px;
      background:
        radial-gradient(120% 100% at 100% 0%, color-mix(in oklab, var(--gold) 16%, var(--paper)) 0%, var(--paper) 70%);
      border: 1px solid color-mix(in oklab, var(--gold) 32%, var(--line));
      border-radius: 16px;
      min-width: 180px;
      box-shadow:
        0 1px 0 var(--paper) inset,
        0 20px 36px -24px color-mix(in oklab, var(--gold) 60%, transparent);
    }
    .m-overall::after {
      content: ""; position: absolute; left: 10%; right: 10%; top: 0; height: 1px;
      background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--gold) 50%, white), transparent);
      opacity: .6;
    }
    .m-overall-empty {
      background: var(--paper);
      border: 1px dashed var(--line2);
      color: var(--mut); box-shadow: none;
    }
    .m-overall-empty::after { display: none; }
    .m-overall-score { font: 800 40px/1 var(--font-sans); letter-spacing: -.035em; color: var(--ink); }
    .m-overall-empty .m-overall-score { color: var(--mut); font-weight: 500; }
    .m-overall-stars { font: 400 16px/1 var(--font-sans); letter-spacing: .06em; }
    .m-overall-stars .s-filled { color: var(--gold); text-shadow: 0 0 10px color-mix(in oklab, var(--gold) 40%, transparent); }
    .m-overall-stars .s-empty  { color: color-mix(in oklab, var(--mut) 35%, var(--paper)); }
    .m-overall-label { font: 500 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }

    /* ---- DISTRIBUTION ---- */
    .m-distrib-sec { max-width: var(--m-max); margin: 24px auto 42px; }
    .m-distrib-bar {
      display: flex; gap: 2px; height: 12px; border-radius: 999px; overflow: hidden;
      background: var(--bg); border: 1px solid var(--line);
      box-shadow: 0 1px 2px rgba(0,0,0,.04) inset;
    }
    .m-db-seg { display: block; height: 100%; min-width: 2px; transition: filter .14s; }
    .m-db-seg:hover { filter: brightness(1.08); }
    .m-db-mastered  { background: var(--green); }
    .m-db-solid     { background: var(--blue, #3870ff); }
    .m-db-shaky     { background: var(--gold); }
    .m-db-weak      { background: var(--red); }
    .m-db-untouched { background: color-mix(in oklab, var(--mut) 25%, var(--paper)); }
    .m-distrib-legend {
      display: flex; flex-wrap: wrap; gap: 20px; margin-top: 12px;
      font: 500 12px/1.3 var(--font-sans); color: var(--mut);
    }
    .m-db-leg { display: inline-flex; align-items: center; gap: 7px; }
    .m-db-leg b { color: var(--ink); font-weight: 700; }
    .m-db-dot { width: 9px; height: 9px; border-radius: 999px; display: inline-block; }

    /* ---- SECTION HEADERS ---- */
    .m-sec-h { display: flex; align-items: baseline; gap: 14px; max-width: var(--m-max); margin: 0 auto 14px; flex-wrap: wrap; }
    .m-sec-h h2 { margin: 0; font: 600 20px/1.2 var(--font-sans); letter-spacing: -.012em; color: var(--ink); }
    .m-sec-sub { color: var(--mut); font-size: 12.5px; }
    .m-sec-h-inner { margin: 0 0 12px; }

    /* ---- TABS ---- */
    .m-tabs {
      display: inline-flex; gap: 2px; max-width: var(--m-max); margin: 10px auto 24px;
      padding: 4px; border-radius: 12px;
      background: color-mix(in oklab, var(--mut) 10%, var(--paper));
      border: 1px solid var(--line);
    }
    .m-tab {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 16px; border-radius: 9px; border: none; background: transparent;
      font: 600 13px/1 var(--font-sans); color: var(--mut); cursor: pointer;
      transition: all .18s ease; letter-spacing: -.005em;
    }
    .m-tab:hover { color: var(--ink); }
    .m-tab.active {
      background: var(--paper); color: var(--ink);
      box-shadow:
        0 1px 2px rgba(0,0,0,.06),
        0 0 0 1px var(--line);
    }
    .m-tab-count {
      font: 600 10.5px/1 var(--font-sans); color: var(--mut);
      background: color-mix(in oklab, var(--mut) 14%, transparent);
      padding: 3px 7px; border-radius: 999px; min-width: 20px; text-align: center;
    }
    .m-tab.active .m-tab-count {
      background: color-mix(in oklab, var(--ink) 10%, transparent);
      color: var(--ink);
    }
    .m-tab-dot { display: none; }

    /* ---- PANEL ---- */
    .m-panel { max-width: var(--m-max); margin: 0 auto; }
    .m-empty {
      padding: 32px 16px; text-align: center; color: var(--mut); font: 500 13px/1.6 var(--font-sans);
      border: 1px dashed var(--line2); border-radius: 12px;
    }

    /* ---- OVERVIEW GRID ---- */
    .m-ov-grid {
      display: grid; grid-template-columns: 1fr; gap: 32px;
    }
    @media (min-width: 1024px) {
      .m-ov-grid { grid-template-columns: 1.6fr 1fr; gap: 36px; }
    }
    .m-strongest { display: grid; grid-template-columns: 1fr; gap: 10px; }
    .p-tile-mini .p-tile-bar, .p-tile-mini .p-tile-foot { display: flex; }

    /* ---- FILTER BAR ---- */
    .m-filter-bar {
      display: flex; flex-wrap: wrap; align-items: flex-end; gap: 18px 24px;
      padding: 14px 16px; margin-bottom: 20px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,.03);
    }
    .m-filter-bar-tight { padding: 10px 14px; gap: 10px; }
    .m-filter-group { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
    .m-filter-label {
      font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase;
      color: var(--mut);
    }
    .m-filter-chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .m-filter-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 11px; border-radius: 999px;
      background: var(--paper); border: 1px solid var(--line);
      font: 500 12px/1 var(--font-sans); color: var(--mut);
      cursor: pointer; transition: all .14s ease;
    }
    .m-filter-chip:hover { color: var(--ink); border-color: var(--line2); transform: translateY(-1px); }
    .m-filter-chip.active {
      color: var(--paper); border-color: var(--ink); background: var(--ink);
      font-weight: 600;
    }
    .m-fc-count {
      font: 700 10px/1 var(--font-sans);
      padding: 2px 5px; border-radius: 999px;
      background: color-mix(in oklab, var(--mut) 18%, transparent);
    }
    .m-filter-chip.active .m-fc-count {
      background: color-mix(in oklab, var(--paper) 22%, transparent);
      color: var(--paper);
    }
    .m-filter-stat {
      margin-left: auto; align-self: center;
      font: 500 11.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .04em;
    }

    .m-shaky-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }

    /* ---- SHAKY SPOTS ---- */
    .m-shaky-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
    .shaky-card {
      position: relative;
      padding: 13px 32px 12px 16px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 11px;
      cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
      overflow: hidden;
      display: flex; flex-direction: column; gap: 6px;
    }
    .shaky-card::before {
      content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
    }
    .shaky-card.sev-high::before { background: var(--red); }
    .shaky-card.sev-mid::before  { background: var(--gold); }
    .shaky-card.sev-low::before  { background: var(--blue, #3870ff); }
    .shaky-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,.08); border-color: var(--line2); }
    .shaky-card:hover .sh-arrow { transform: translateX(4px); opacity: 1; }

    .sh-top { display: flex; justify-content: space-between; align-items: center; }
    .sh-stars { font: 600 13px/1 var(--font-sans); letter-spacing: .06em; }
    .sh-stars .s-filled { color: var(--red); }
    .sev-mid  .sh-stars .s-filled { color: var(--gold); }
    .sev-low  .sh-stars .s-filled { color: var(--blue, #3870ff); }
    .sh-stars .s-empty  { color: color-mix(in oklab, var(--mut) 35%, var(--paper)); }
    .sh-days { font: 600 10.5px/1 var(--font-sans); letter-spacing: .08em; text-transform: uppercase; color: var(--mut); }
    .sh-title { font: 600 14px/1.3 var(--font-sans); color: var(--ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .sh-foot { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 2px; }
    .sh-pattern { font: 500 11px/1.3 var(--font-sans); color: var(--mut); letter-spacing: .02em; }
    .sh-arrow {
      position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
      font: 600 15px/1 var(--font-sans); color: var(--mut);
      opacity: .5; transition: transform .18s ease, opacity .18s ease;
    }

    /* ---- PATTERN GRID ---- */
    .m-grid-sec, .m-grid { max-width: var(--m-max); margin: 0 auto; }
    .m-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      gap: 10px;
    }
    .p-tile {
      position: relative;
      padding: 14px 14px 12px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 12px;
      cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
      overflow: hidden;
      display: flex; flex-direction: column; gap: 10px;
      box-shadow: 0 1px 2px rgba(0,0,0,.03);
    }
    .p-tile:hover {
      transform: translateY(-3px);
      box-shadow:
        0 14px 28px -8px rgba(0,0,0,.12),
        0 4px 8px rgba(0,0,0,.04);
    }
    .p-tile-stripe {
      position: absolute; left: 0; top: 0; right: 0; height: 3px;
    }
    .p-mastered  .p-tile-stripe { background: var(--green); }
    .p-solid     .p-tile-stripe { background: var(--blue, #3870ff); }
    .p-shaky     .p-tile-stripe { background: var(--gold); }
    .p-weak      .p-tile-stripe { background: var(--red); }
    .p-untouched .p-tile-stripe { background: color-mix(in oklab, var(--mut) 20%, var(--paper)); }

    .p-mastered  {
      background: linear-gradient(135deg, color-mix(in oklab, var(--green) 14%, var(--paper)) 0%, color-mix(in oklab, var(--green) 5%, var(--paper)) 100%);
      border-color: color-mix(in oklab, var(--green) 30%, var(--line));
    }
    .p-solid     {
      background: linear-gradient(135deg, color-mix(in oklab, var(--blue, #3870ff) 12%, var(--paper)) 0%, color-mix(in oklab, var(--blue, #3870ff) 4%, var(--paper)) 100%);
      border-color: color-mix(in oklab, var(--blue, #3870ff) 28%, var(--line));
    }
    .p-shaky     {
      background: linear-gradient(135deg, color-mix(in oklab, var(--gold) 16%, var(--paper)) 0%, color-mix(in oklab, var(--gold) 6%, var(--paper)) 100%);
      border-color: color-mix(in oklab, var(--gold) 34%, var(--line));
    }
    .p-weak      {
      background: linear-gradient(135deg, color-mix(in oklab, var(--red) 14%, var(--paper)) 0%, color-mix(in oklab, var(--red) 5%, var(--paper)) 100%);
      border-color: color-mix(in oklab, var(--red) 30%, var(--line));
    }
    .p-untouched {
      background: var(--paper); border-color: var(--line);
      opacity: .72;
    }
    .p-untouched:hover { opacity: 1; }

    .p-tile-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-top: 2px; }
    .p-tile-name {
      font: 600 13px/1.3 var(--font-sans); color: var(--ink);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      min-width: 0; flex: 1;
    }
    .p-untouched .p-tile-name { color: color-mix(in oklab, var(--ink) 70%, var(--mut)); }
    .p-tile-score {
      font: 800 20px/1 var(--font-sans); letter-spacing: -.025em; color: var(--ink);
      flex-shrink: 0; margin-top: 1px;
    }
    .p-mastered  .p-tile-score { color: var(--green); }
    .p-solid     .p-tile-score { color: var(--blue, #3870ff); }
    .p-shaky     .p-tile-score { color: color-mix(in oklab, var(--gold) 85%, var(--ink)); }
    .p-weak      .p-tile-score { color: var(--red); }
    .p-tile-score-empty { color: color-mix(in oklab, var(--mut) 60%, var(--paper)) !important; font-weight: 500 !important; }

    .p-tile-bar {
      height: 4px; border-radius: 999px;
      background: color-mix(in oklab, var(--line) 60%, transparent);
      overflow: hidden;
    }
    .p-tile-fill { display: block; height: 100%; border-radius: 999px; }
    .p-mastered  .p-tile-fill { background: var(--green); }
    .p-solid     .p-tile-fill { background: var(--blue, #3870ff); }
    .p-shaky     .p-tile-fill { background: var(--gold); }
    .p-weak      .p-tile-fill { background: var(--red); }
    .p-untouched .p-tile-fill { background: color-mix(in oklab, var(--mut) 30%, var(--paper)); }

    .p-tile-foot {
      display: flex; justify-content: space-between; align-items: center;
      font: 500 10.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .04em;
    }

    /* ---- DETAIL MODAL (no backdrop; the page stays as it is) ---- */
    .m-scrim {
      position: fixed; inset: 0; z-index: 1500;
      background: transparent;
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .m-detail {
      background: var(--paper); border-radius: 18px;
      width: 100%; max-width: 560px; max-height: 82vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow:
        0 24px 60px rgba(0,0,0,.18),
        0 6px 16px rgba(0,0,0,.08),
        0 0 0 1px var(--line);
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
    .m-prow-meta { font: 500 11px/1.3 var(--font-sans); color: var(--mut); letter-spacing: .02em; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
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

    @media (max-width: 760px) {
      .m-head { grid-template-columns: 1fr; align-items: start; gap: 20px; }
      .m-overall { align-self: start; }
      .m-title { font-size: 36px; }
    }
  `;
  document.head.appendChild(s);
}
