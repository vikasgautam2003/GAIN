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
        <div class="t-eyebrow">🎯 TESTS</div>
        <h1 class="t-title">Timed papers.</h1>
        <p class="t-sub">Groq composes real interview-shaped papers — MCQs, written, coding. Timer. Scored. Bounty scales with your performance.</p>
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

  return `
    <div class="t-picker">
      <div class="t-field">
        <label>SHEET</label>
        <select id="t-sheet">
          ${names.map(n => `<option value="${esc(n)}" ${n === curSheet ? "selected" : ""}>${esc(n)}</option>`).join("")}
        </select>
      </div>

      <div class="t-field">
        <label>DIFFICULTY</label>
        <div class="t-pill-row">
          ${["Easy", "Medium", "Hard", "Mixed"].map(d => `
            <button class="t-pill ${pickerState.difficulty === d ? "active" : ""}" data-diff="${d}">${d}</button>
          `).join("")}
        </div>
      </div>

      <div class="t-field">
        <label>LENGTH</label>
        <div class="t-pill-row">
          ${[
            { k: "quick", lbl: "Quick", m: paperShapeFor(curSheet, "quick").minutes },
            { k: "standard", lbl: "Standard", m: paperShapeFor(curSheet, "standard").minutes },
            { k: "deep", lbl: "Deep", m: paperShapeFor(curSheet, "deep").minutes },
          ].map(x => `
            <button class="t-pill ${pickerState.lengthMode === x.k ? "active" : ""}" data-len="${x.k}">${x.lbl} · ${x.m}m</button>
          `).join("")}
        </div>
      </div>

      ${availableTopics.length ? `
        <div class="t-field">
          <label>TOPICS <span class="t-field-hint">tap to toggle · empty = any pattern in this sheet</span></label>
          <div class="t-topic-grid">
            ${availableTopics.map(t => `
              <button class="t-topic ${curTopics.includes(t) ? "selected" : ""}" data-topic="${esc(t)}">${esc(t)}</button>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <div class="t-summary">
        <div class="t-summary-stat"><label>Questions</label><b>${totalQ}</b></div>
        <div class="t-summary-stat"><label>MCQ</label><b>${shape.mcq}</b></div>
        <div class="t-summary-stat"><label>Written</label><b>${shape.written}</b></div>
        <div class="t-summary-stat"><label>Coding</label><b>${shape.coding}</b></div>
        <div class="t-summary-stat"><label>Timer</label><b>${shape.minutes} min</b></div>
      </div>

      <div class="t-actions">
        <button class="t-btn-primary" id="t-start">
          <span>▶</span> Generate & Start test
        </button>
        <p class="t-start-note">Groq generates the paper (~30s). You can't pause the timer once it starts.</p>
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
  panel.querySelector("#t-sheet")?.addEventListener("change", (e) => {
    pickerState.sheetName = e.target.value;
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
    .tests { padding: 20px 16px 60px; max-width: 1120px; }
    .t-head { max-width: 920px; margin: 28px auto 26px; }
    .t-eyebrow { font: 700 11.5px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase; color: var(--gold); margin-bottom: 12px; display: inline-block; }
    .t-title { margin: 0 0 10px; font: 600 46px/1.02 var(--font-sans); letter-spacing: -.03em; color: var(--ink); }
    .t-sub { font: 400 15px/1.55 var(--font-sans); color: var(--mut); margin: 0; max-width: 60ch; }

    .t-tabs {
      display: inline-flex; gap: 2px; max-width: 1120px; margin: 10px auto 24px;
      padding: 5px; border-radius: 14px;
      background: color-mix(in oklab, var(--mut) 8%, var(--paper));
      border: 1px solid var(--line);
    }
    .t-tab {
      display: inline-flex; align-items: center; gap: 9px;
      padding: 9px 16px; border-radius: 10px; border: none; background: transparent;
      font: 600 13px/1 var(--font-sans); color: var(--mut); cursor: pointer;
      transition: all .2s ease;
    }
    .t-tab:hover { color: var(--ink); }
    .t-tab.active { background: var(--paper); color: var(--ink); box-shadow: 0 2px 4px rgba(0,0,0,.06), 0 0 0 1px var(--line); }
    .t-tab-count {
      font: 700 10.5px/1 var(--font-sans); color: var(--mut);
      background: color-mix(in oklab, var(--mut) 14%, transparent);
      padding: 3px 7px; border-radius: 999px; min-width: 20px; text-align: center;
    }
    .t-tab.active .t-tab-count { background: var(--gold); color: var(--paper); }

    .t-panel { max-width: 1120px; margin: 0 auto; }

    /* --- New test picker --- */
    .t-picker { display: flex; flex-direction: column; gap: 18px; }
    .t-field { display: flex; flex-direction: column; gap: 8px; }
    .t-field label { font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }
    .t-field-hint { color: var(--mut); font-weight: 500; letter-spacing: .02em; text-transform: none; margin-left: 8px; }
    .t-field select {
      padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line);
      background: var(--paper); color: var(--ink); font: 500 13.5px/1 var(--font-sans);
      max-width: 320px;
    }
    .t-field select:focus { outline: 2px solid var(--gold); outline-offset: -2px; }

    .t-pill-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .t-pill {
      padding: 8px 14px; border-radius: 999px;
      background: var(--paper); border: 1px solid var(--line); color: var(--mut);
      font: 600 12.5px/1 var(--font-sans); cursor: pointer;
      transition: all .14s ease;
    }
    .t-pill:hover { color: var(--ink); border-color: var(--line2); }
    .t-pill.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

    .t-topic-grid { display: flex; flex-wrap: wrap; gap: 6px; max-width: 920px; }
    .t-topic {
      padding: 6px 12px; border-radius: 8px;
      background: var(--paper); border: 1px solid var(--line); color: var(--mut);
      font: 500 12px/1 var(--font-sans); cursor: pointer;
      transition: all .14s ease;
    }
    .t-topic:hover { color: var(--ink); border-color: var(--line2); }
    .t-topic.selected { background: color-mix(in oklab, var(--gold) 14%, var(--paper)); border-color: color-mix(in oklab, var(--gold) 40%, var(--line)); color: var(--ink); font-weight: 600; }

    .t-summary {
      display: flex; flex-wrap: wrap; gap: 24px;
      padding: 14px 18px; border-radius: 12px;
      background: color-mix(in oklab, var(--mut) 6%, var(--paper));
      border: 1px solid var(--line);
    }
    .t-summary-stat { display: flex; flex-direction: column; gap: 2px; }
    .t-summary-stat label { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }
    .t-summary-stat b { font: 800 20px/1 var(--font-sans); color: var(--ink); letter-spacing: -.02em; }

    .t-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .t-btn-primary {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 14px 20px; border-radius: 12px; width: 100%; max-width: 320px;
      background: var(--ink); color: var(--paper); border: none;
      font: 700 14px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: all .14s ease;
    }
    .t-btn-primary:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
    .t-btn-primary:disabled { opacity: .7; cursor: progress; }
    .t-btn-primary span:first-child { font-size: 14px; }
    .t-spin {
      display: inline-block; width: 12px; height: 12px; border-radius: 50%;
      border: 2px solid color-mix(in oklab, var(--paper) 50%, transparent);
      border-top-color: var(--paper);
      animation: tSpin .7s linear infinite;
    }
    @keyframes tSpin { to { transform: rotate(360deg); } }
    .t-start-note { font: 500 11.5px/1.4 var(--font-sans); color: var(--mut); margin: 0; }

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
