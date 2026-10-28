// Tests page — new sidebar entry (#tests). Three tabs: New test, Past attempts,
// Scheduled. All the heavy lifting (paper generation, grading, bounty) lives
// in testGrading.js. The actual test experience is in testRunner.js.

import { getSheets, getSettings } from "./store.js";
import { loadCatalog, PAPER_DEFAULTS, paperShapeFor } from "./testGrading.js";

const SHEET_KINDS = ["DSA", "SQL", "System Design", "Integrations", "Interview Extras", "OS & Networking"];

let activeTab = "new";
let pickerState = {
  sheetName: "",
  topics: [],
  difficulty: "Mixed",
  lengthMode: "standard",
};
let unsub = null;

export default {
  async mount(root) {
    injectStyles();
    const sheets = getSheets();
    const names = Object.keys(sheets);
    if (!pickerState.sheetName && names.length) {
      pickerState.sheetName = SHEET_KINDS.find(k => names.includes(k)) || names[0];
    }
    root.innerHTML = render();
    paint(root);
    wire(root);
    if (unsub) unsub();
  },
  unmount() { if (unsub) { unsub(); unsub = null; } },
};

function render() {
  return `
    <div class="view-inner tests">
      <header class="t-head">
        <div class="t-eyebrow">ASSESSMENTS</div>
        <h1 class="t-title">Tests</h1>
        <p class="t-sub">Timed interview-shaped papers — multiple choice, written, and coding. Each paper is graded and scores feed back into your Mastery map.</p>
      </header>

      <nav class="t-tabs" role="tablist">
        <button class="t-tab" role="tab" data-tab="new">
          <span>New test</span>
        </button>
        <button class="t-tab" role="tab" data-tab="past">
          <span>Past attempts</span>
          <span class="t-tab-count" id="t-count-past">—</span>
        </button>
        <button class="t-tab" role="tab" data-tab="scheduled">
          <span>Weekly</span>
        </button>
      </nav>

      <section class="t-panel" id="t-panel"></section>
    </div>
  `;
}

function paint(root) {
  const catalog = loadCatalog();
  root.querySelector("#t-count-past").textContent = String(catalog.length);
  root.querySelectorAll(".t-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === activeTab));

  const panel = root.querySelector("#t-panel");
  if (activeTab === "new") panel.innerHTML = renderNewTab();
  else if (activeTab === "past") panel.innerHTML = renderPastTab(catalog);
  else panel.innerHTML = renderScheduledTab();
  wirePanel(root, panel);
}

function renderNewTab() {
  const sheets = getSheets();
  const names = Object.keys(sheets).filter(n => SHEET_KINDS.includes(n));
  const curSheet = pickerState.sheetName;
  const curTopics = pickerState.topics;
  const availableTopics = extractTopics(curSheet);

  const shape = paperShapeFor(curSheet, pickerState.lengthMode);
  const totalQ = shape.mcq + shape.written + shape.coding;
  const bountyEstimate = 100 + 10 * shape.mcq + 50 * shape.written + 100 * shape.coding;

  const SHEET_DESCRIPTIONS = {
    "DSA": "Data structures & algorithms — coding problems + concept MCQs",
    "SQL": "Query writing — SELECT/JOIN/GROUP + rules MCQs",
    "System Design": "High-level design prompts + tradeoff MCQs",
    "Integrations": "Real-world scenarios + protocols MCQs",
    "Interview Extras": "Behavioral + leadership judgment MCQs",
    "OS & Networking": "Core concepts — written explanations + MCQs",
  };

  return `
    <div class="t-picker-card">
      <!-- Sheet picker -->
      <div class="t-section">
        <div class="t-section-head">
          <h3>Subject</h3>
          <span class="t-section-sub">pick which sheet the paper draws from</span>
        </div>
        <div class="t-sheet-grid">
          ${names.map(n => {
            const desc = SHEET_DESCRIPTIONS[n] || "";
            const selected = n === curSheet;
            return `
              <button class="t-sheet-tile ${selected ? "selected" : ""}" data-sheet="${esc(n)}">
                <div class="t-sheet-name">${esc(n)}</div>
                <div class="t-sheet-desc">${esc(desc)}</div>
              </button>
            `;
          }).join("")}
        </div>
      </div>

      <!-- Difficulty + Length -->
      <div class="t-section">
        <div class="t-section-head">
          <h3>Difficulty &amp; length</h3>
          <span class="t-section-sub">interview-shaped — Quick is a warmup, Deep is a round</span>
        </div>
        <div class="t-shape-grid">
          <div class="t-shape-col">
            <label class="t-section-label">Difficulty</label>
            <div class="t-seg">
              ${["Easy", "Medium", "Hard", "Mixed"].map(d => `
                <button class="t-seg-btn ${pickerState.difficulty === d ? "active" : ""}" data-diff="${d}">${d}</button>
              `).join("")}
            </div>
          </div>
          <div class="t-shape-col">
            <label class="t-section-label">Length</label>
            <div class="t-seg">
              ${[
                { k: "quick", lbl: "Quick", m: paperShapeFor(curSheet, "quick").minutes },
                { k: "standard", lbl: "Standard", m: paperShapeFor(curSheet, "standard").minutes },
                { k: "deep", lbl: "Deep", m: paperShapeFor(curSheet, "deep").minutes },
              ].map(x => `
                <button class="t-seg-btn t-seg-btn-wide ${pickerState.lengthMode === x.k ? "active" : ""}" data-len="${x.k}">
                  <span>${x.lbl}</span>
                  <span class="t-seg-btn-sub">${x.m}m</span>
                </button>
              `).join("")}
            </div>
          </div>
        </div>
      </div>

      <!-- Topics -->
      ${availableTopics.length ? `
        <div class="t-section">
          <div class="t-section-head">
            <h3>Topics</h3>
            <span class="t-section-sub">
              ${curTopics.length > 0 ? `${curTopics.length} selected` : "leave empty for any pattern in this sheet"}
            </span>
            ${curTopics.length > 0 ? `<button class="t-clear-topics" id="t-clear-topics">Clear selection</button>` : ""}
          </div>
          <div class="t-topic-bank">
            ${availableTopics.map(t => `
              <button class="t-topic ${curTopics.includes(t) ? "selected" : ""}" data-topic="${esc(t)}">${esc(t)}</button>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <!-- Launch panel -->
      <div class="t-launch">
        <div class="t-launch-grid">
          <div class="t-stat">
            <div class="t-stat-label">Total questions</div>
            <div class="t-stat-val">${totalQ}</div>
            <div class="t-stat-sub">
              ${shape.mcq ? `${shape.mcq} MCQ` : ""}${shape.mcq && shape.written ? " · " : ""}${shape.written ? `${shape.written} written` : ""}${(shape.mcq || shape.written) && shape.coding ? " · " : ""}${shape.coding ? `${shape.coding} coding` : ""}
            </div>
          </div>
          <div class="t-stat">
            <div class="t-stat-label">Duration</div>
            <div class="t-stat-val">${shape.minutes}<span class="t-stat-unit">min</span></div>
            <div class="t-stat-sub">timer starts on click</div>
          </div>
          <div class="t-stat">
            <div class="t-stat-label">Max reward</div>
            <div class="t-stat-val">₹${bountyEstimate}</div>
            <div class="t-stat-sub">scales with score</div>
          </div>
        </div>
        <div class="t-launch-actions">
          <button class="t-btn-primary" id="t-start">Begin test</button>
          <p class="t-launch-note">Paper generates in ~30s. No pausing. Submit any time via <kbd>Submit</kbd> at the top-right.</p>
        </div>
      </div>
    </div>
  `;
}

function renderPastTab(catalog) {
  if (!catalog.length) {
    return `
      <div class="t-empty">
        <h3>No tests yet.</h3>
        <p>Head to the New test tab and build your first paper. Scorecards + bounty earned show up here.</p>
      </div>
    `;
  }
  return `
    <div class="t-past-list">
      ${catalog.map(a => {
        const dt = a.submittedAt ? new Date(a.submittedAt) : null;
        const timeTaken = (a.submittedAt && a.createdAt) ? Math.round((a.submittedAt - a.createdAt) / 60000) : 0;
        const grade = a.score?.grade || "—";
        const pct = a.score?.pct ?? 0;
        return `
          <article class="t-past-card" data-attempt-id="${esc(a.id)}">
            <header>
              <span class="t-past-grade grade-${grade.toLowerCase()}">${esc(grade)}</span>
              <div class="t-past-main">
                <h3>${esc(a.title || a.sheetName)}</h3>
                <div class="t-past-meta">
                  <span>${esc(a.sheetName)}</span>
                  <span>${esc(a.lengthMode || "standard")} · ${esc(a.difficulty || "mixed")}</span>
                  ${dt ? `<span>${dt.toLocaleDateString()}</span>` : "<span>in progress</span>"}
                </div>
              </div>
              <div class="t-past-right">
                <div class="t-past-pct">${pct}%</div>
                <div class="t-past-bounty">+ ₹${a.bountyEarned ?? 0}</div>
              </div>
            </header>
            <div class="t-past-foot">
              <span>${a.score?.raw ?? 0}/${a.score?.max ?? 0} points</span>
              <span>${timeTaken > 0 ? `${timeTaken}m taken` : ""}</span>
              <span class="t-past-actions">
                <button class="t-past-btn" data-review="${esc(a.id)}">Review →</button>
              </span>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderScheduledTab() {
  const s = getSettings();
  const enabled = s?.schedule?.tests?.weeklyEnabled !== false;
  return `
    <div class="t-sched">
      <article class="t-sched-card">
        <header>
          <span class="t-sched-pill">⚡ WEEKLY TEST</span>
          <h3>Random weekend, auto-added to Today</h3>
        </header>
        <p>Each Monday the scheduler flips a coin to pick Saturday or Sunday. On that day a test appears in your Today plan, picked from the sheet where your Mastery is weakest. Big bounty if you nail it — up to ₹500 for a full-length Deep DSA paper at 100%.</p>
        <label class="t-sched-toggle">
          <input type="checkbox" id="t-weekly-enabled" ${enabled ? "checked" : ""} />
          <span>Weekly test enabled</span>
        </label>
        <div class="t-sched-note">
          Disabling pauses the auto-inject. You can still generate a test any time from the New test tab.
        </div>
      </article>
    </div>
  `;
}

function extractTopics(sheetName) {
  const sh = getSheets()[sheetName];
  if (!sh?.rows?.length || !sh.headers?.length) return [];
  const col = sh.headers.find(h => /^(pattern|category)$/i.test(h));
  if (!col) return [];
  const set = new Set();
  for (const r of sh.rows) {
    const v = String(r[col] || "").trim();
    if (v) set.add(v);
  }
  return Array.from(set).sort();
}

function wire(root) {
  root.querySelectorAll(".t-tab").forEach(t => {
    t.addEventListener("click", () => { activeTab = t.dataset.tab; paint(root); });
  });
}

function wirePanel(root, panel) {
  panel.querySelectorAll("[data-sheet]").forEach(btn => {
    btn.addEventListener("click", () => {
      pickerState.sheetName = btn.dataset.sheet;
      pickerState.topics = [];
      paint(root);
    });
  });
  panel.querySelector("#t-clear-topics")?.addEventListener("click", () => {
    pickerState.topics = [];
    paint(root);
  });

  panel.querySelectorAll("[data-diff]").forEach(btn => {
    btn.addEventListener("click", () => {
      pickerState.difficulty = btn.dataset.diff;
      paint(root);
    });
  });
  panel.querySelectorAll("[data-len]").forEach(btn => {
    btn.addEventListener("click", () => {
      pickerState.lengthMode = btn.dataset.len;
      paint(root);
    });
  });
  panel.querySelectorAll("[data-topic]").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.topic;
      const idx = pickerState.topics.indexOf(t);
      if (idx >= 0) pickerState.topics.splice(idx, 1);
      else pickerState.topics.push(t);
      paint(root);
    });
  });

  panel.querySelector("#t-start")?.addEventListener("click", async () => {
    const btn = panel.querySelector("#t-start");
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="t-spin"></span> Generating paper…`;
    try {
      const { generatePaper } = await import("./testGrading.js");
      const paper = await generatePaper({
        sheetName: pickerState.sheetName,
        topics: pickerState.topics,
        difficulty: pickerState.difficulty,
        lengthMode: pickerState.lengthMode,
      });
      const { openTestRunner } = await import("./testRunner.js");
      openTestRunner(paper, () => {
        activeTab = "past";
        paint(root);
      });
    } catch (err) {
      const { showAlert } = await import("./modals.js");
      await showAlert({ title: "Couldn't build the paper", message: String(err.message || err), tone: "error" });
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  });

  panel.querySelectorAll("[data-review]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { openScorecard } = await import("./testRunner.js");
      openScorecard(btn.dataset.review);
    });
  });

  panel.querySelector("#t-weekly-enabled")?.addEventListener("change", async (e) => {
    const { setWeeklyPreference } = await import("./testGrading.js");
    await setWeeklyPreference(e.target.checked);
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

function injectStyles() {
  if (document.getElementById("tests-page-styles")) return;
  const s = document.createElement("style");
  s.id = "tests-page-styles";
  s.textContent = `
    .tests { padding: 24px 24px 60px; max-width: 1080px; margin: 0 auto; }
    .t-head { margin: 4px 0 24px; max-width: 760px; }
    .t-eyebrow {
      font: 600 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase;
      color: var(--mut); margin-bottom: 10px; display: block;
    }
    .t-title { margin: 0 0 8px; font: 600 26px/1.2 var(--font-sans); letter-spacing: -.018em; color: var(--ink); }
    .t-sub { font: 400 13.5px/1.55 var(--font-sans); color: var(--mut); margin: 0; max-width: 62ch; }

    .t-tabs {
      display: flex; gap: 0; margin: 4px 0 22px;
      border-bottom: 1px solid var(--line);
    }
    .t-tab {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 18px; border: none; background: transparent;
      font: 500 13px/1 var(--font-sans); color: var(--mut); cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: color .14s ease, border-color .14s ease;
    }
    .t-tab:hover { color: var(--ink); }
    .t-tab.active { color: var(--ink); border-bottom-color: var(--ink); font-weight: 600; }
    .t-tab-count {
      font: 500 11px/1 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); color: var(--mut);
      padding: 2px 6px; border-radius: 3px;
      background: color-mix(in oklab, var(--ink) 6%, var(--paper));
    }
    .t-tab.active .t-tab-count { color: var(--ink); background: color-mix(in oklab, var(--ink) 10%, var(--paper)); font-weight: 600; }

    .t-panel { max-width: 1120px; margin: 0 auto; }

    /* === PICKER — flows with the page, no enclosing box === */
    .t-picker-card { }
    .t-section { padding: 20px 0 28px; border-bottom: 1px solid var(--line); }
    .t-section:last-of-type { border-bottom: none; padding-bottom: 10px; }
    .t-section:first-of-type { padding-top: 4px; }
    .t-section-head {
      display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .t-section-head h3 {
      margin: 0; font: 600 15px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -.012em;
    }
    .t-section-sub {
      font: 500 12.5px/1.35 var(--font-sans); color: var(--mut); letter-spacing: .005em;
    }
    .t-section-label {
      font: 600 11px/1 var(--font-sans); letter-spacing: .08em; text-transform: uppercase;
      color: var(--mut); margin-bottom: 8px; display: block;
    }
    .t-clear-topics {
      margin-left: auto;
      padding: 6px 11px; border-radius: 6px;
      background: transparent; border: 1px solid var(--line); color: var(--mut);
      font: 500 11.5px/1 var(--font-sans); cursor: pointer;
      transition: all .14s ease;
    }
    .t-clear-topics:hover { color: var(--ink); border-color: var(--line2); }

    /* --- Sheet grid: no emoji, no gold gradient, muted selection --- */
    .t-sheet-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 8px;
    }
    .t-sheet-tile {
      display: flex; flex-direction: column; gap: 6px;
      padding: 14px 16px; text-align: left;
      background: var(--paper); border: 1px solid var(--line); border-radius: 8px;
      cursor: pointer; transition: border-color .14s ease, background .14s ease;
    }
    .t-sheet-tile:hover { border-color: var(--line2); }
    .t-sheet-tile.selected {
      border-color: var(--ink);
      background: color-mix(in oklab, var(--ink) 3%, var(--paper));
      box-shadow: inset 3px 0 0 var(--ink);
    }
    .t-sheet-name {
      font: 600 14px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -.012em;
    }
    .t-sheet-desc {
      font: 400 12.5px/1.45 var(--font-sans); color: var(--mut);
    }

    /* --- Difficulty + Length: segmented controls (no colored pills) --- */
    .t-shape-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
    @media (max-width: 640px) { .t-shape-grid { grid-template-columns: 1fr; } }
    .t-shape-col { display: flex; flex-direction: column; }
    .t-seg {
      display: inline-flex; padding: 3px; border-radius: 7px;
      background: color-mix(in oklab, var(--ink) 5%, var(--paper));
      border: 1px solid var(--line);
      width: fit-content; max-width: 100%; flex-wrap: wrap;
    }
    .t-seg-btn {
      padding: 7px 14px; border-radius: 5px; border: none; background: transparent;
      font: 500 12.5px/1 var(--font-sans); color: var(--mut); cursor: pointer;
      transition: color .14s ease, background .14s ease;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .t-seg-btn:hover { color: var(--ink); }
    .t-seg-btn.active { background: var(--paper); color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
    .t-seg-btn-wide { padding: 8px 16px; }
    .t-seg-btn-sub { font-size: 11px; color: var(--mut); font-weight: 500; letter-spacing: .02em; }
    .t-seg-btn.active .t-seg-btn-sub { color: var(--mut); }

    /* --- Topics: flat chip bank --- */
    .t-topic-bank {
      display: flex; flex-wrap: wrap; gap: 5px;
      max-height: 260px; overflow-y: auto;
      padding: 2px;
    }
    .t-topic {
      padding: 6px 11px; border-radius: 5px;
      background: var(--paper); border: 1px solid var(--line); color: var(--ink);
      font: 500 12px/1 var(--font-sans); cursor: pointer;
      transition: all .12s ease;
    }
    .t-topic:hover { background: color-mix(in oklab, var(--ink) 4%, var(--paper)); border-color: var(--line2); }
    .t-topic.selected {
      background: var(--ink); color: var(--paper); border-color: var(--ink); font-weight: 600;
    }

    /* --- Launch panel: stats row + CTA — borderless, flows with the page --- */
    .t-launch { padding: 24px 0 10px; }
    .t-launch-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px;
      padding: 16px 0 20px; margin-bottom: 18px;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    @media (max-width: 640px) { .t-launch-grid { grid-template-columns: 1fr; } }
    .t-stat {
      display: flex; flex-direction: column; gap: 4px;
      padding-right: 18px; border-right: 1px solid var(--line);
    }
    .t-stat:last-child { padding-right: 0; border-right: none; }
    @media (max-width: 640px) { .t-stat { padding-right: 0; border-right: none; padding-bottom: 14px; border-bottom: 1px solid var(--line); } .t-stat:last-child { padding-bottom: 0; border-bottom: none; } }
    .t-stat-label {
      font: 600 10.5px/1 var(--font-sans); letter-spacing: .08em; text-transform: uppercase; color: var(--mut);
    }
    .t-stat-val {
      font: 500 24px/1 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      color: var(--ink); letter-spacing: -.015em;
      display: flex; align-items: baseline; gap: 4px;
    }
    .t-stat-unit {
      font: 500 11.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .02em;
      text-transform: lowercase;
    }
    .t-stat-sub {
      font: 400 11.5px/1.4 var(--font-sans); color: var(--mut);
    }

    .t-launch-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .t-btn-primary {
      padding: 11px 24px; border-radius: 6px;
      background: var(--ink); color: var(--paper); border: none;
      font: 600 13.5px/1 var(--font-sans); letter-spacing: .01em; cursor: pointer;
      transition: background .14s ease, transform .14s ease;
    }
    .t-btn-primary:hover:not(:disabled) { background: color-mix(in oklab, var(--ink) 90%, black); transform: translateY(-1px); }
    .t-btn-primary:disabled { opacity: .7; cursor: progress; }
    .t-launch-note { font: 400 12px/1.45 var(--font-sans); color: var(--mut); margin: 0; flex: 1; min-width: 220px; }
    .t-launch-note kbd {
      font: 500 11px/1 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      padding: 1px 5px; border-radius: 3px;
      background: var(--paper); border: 1px solid var(--line); color: var(--ink);
    }
    .t-spin {
      display: inline-block; width: 12px; height: 12px; border-radius: 50%;
      border: 2px solid color-mix(in oklab, var(--paper) 50%, transparent);
      border-top-color: var(--paper);
      animation: tSpin .7s linear infinite;
    }
    @keyframes tSpin { to { transform: rotate(360deg); } }

    /* --- Past attempts --- */
    .t-empty { padding: 48px 24px; text-align: center;
      background: color-mix(in oklab, var(--mut) 6%, var(--paper)); border: 1px dashed var(--line2); border-radius: 14px; }
    .t-empty h3 { margin: 0 0 8px; font: 600 18px/1.3 var(--font-sans); color: var(--ink); }
    .t-empty p { margin: 0; color: var(--mut); font: 500 13.5px/1.55 var(--font-sans); }

    .t-past-list { display: flex; flex-direction: column; gap: 10px; }
    .t-past-card { padding: 14px 16px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; transition: all .18s ease; }
    .t-past-card:hover { border-color: var(--line2); transform: translateY(-1px); box-shadow: 0 10px 24px -8px rgba(0,0,0,.08); }
    .t-past-card header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .t-past-grade {
      min-width: 48px; min-height: 48px; display: inline-flex; align-items: center; justify-content: center;
      font: 800 20px/1 var(--font-sans); border-radius: 10px;
      letter-spacing: -.02em; flex-shrink: 0;
    }
    .t-past-grade.grade-a { background: color-mix(in oklab, var(--green) 20%, var(--paper)); color: var(--green); }
    .t-past-grade.grade-b { background: color-mix(in oklab, var(--blue, #3870ff) 18%, var(--paper)); color: var(--blue, #3870ff); }
    .t-past-grade.grade-c { background: color-mix(in oklab, var(--gold) 22%, var(--paper)); color: var(--gold); }
    .t-past-grade.grade-d { background: color-mix(in oklab, #e65c3b 20%, var(--paper)); color: #e65c3b; }
    .t-past-grade.grade-f { background: color-mix(in oklab, var(--red) 20%, var(--paper)); color: var(--red); }
    .t-past-main { flex: 1; min-width: 0; }
    .t-past-main h3 { margin: 0 0 4px; font: 600 15.5px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -.012em; }
    .t-past-meta { display: flex; gap: 10px; font: 500 11.5px/1.3 var(--font-sans); color: var(--mut); letter-spacing: .02em; flex-wrap: wrap; }
    .t-past-right { text-align: right; flex-shrink: 0; }
    .t-past-pct { font: 800 18px/1 var(--font-sans); letter-spacing: -.02em; color: var(--ink); }
    .t-past-bounty { font: 600 12px/1 var(--font-sans); color: var(--gold); margin-top: 4px; }
    .t-past-foot { display: flex; align-items: center; gap: 14px; padding-top: 10px; border-top: 1px dashed var(--line); font: 500 11.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .02em; }
    .t-past-actions { margin-left: auto; }
    .t-past-btn {
      padding: 6px 12px; border-radius: 8px;
      background: var(--paper); border: 1px solid var(--line); color: var(--ink);
      font: 600 11.5px/1 var(--font-sans); cursor: pointer;
    }
    .t-past-btn:hover { background: color-mix(in oklab, var(--ink) 4%, var(--paper)); border-color: var(--line2); }

    /* --- Scheduled tab --- */
    .t-sched { max-width: 760px; }
    .t-sched-card { padding: 24px; background: var(--paper); border: 1px solid var(--line); border-radius: 16px; }
    .t-sched-card header { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
    .t-sched-pill {
      display: inline-block; width: fit-content;
      padding: 4px 10px; border-radius: 999px;
      background: color-mix(in oklab, var(--gold) 16%, var(--paper));
      color: var(--gold); border: 1px solid color-mix(in oklab, var(--gold) 32%, var(--line));
      font: 800 10.5px/1 var(--font-sans); letter-spacing: .18em;
    }
    .t-sched-card h3 { margin: 0; font: 600 18px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -.015em; }
    .t-sched-card p { margin: 0 0 14px; color: var(--mut); font: 500 13.5px/1.6 var(--font-sans); }
    .t-sched-toggle { display: flex; align-items: center; gap: 10px; cursor: pointer; }
    .t-sched-toggle input { width: 18px; height: 18px; cursor: pointer; }
    .t-sched-toggle span { font: 600 13.5px/1 var(--font-sans); color: var(--ink); }
    .t-sched-note { margin-top: 10px; font: 500 12px/1.4 var(--font-sans); color: var(--mut); }
  `;
  document.head.appendChild(s);
}
