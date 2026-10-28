// "+ Add tasks" + ⚙ Mix popover on the Today page.
//
// Add tasks: pulls N problems from each sheet into today's plan where N is
// per-sheet, user-configurable (settings.schedule.dailyMix). Two modes:
//   - Priority: respects streamlined mode (filters to the sheet's active
//     topic) and ranks by HIGH-freq, pattern-of-the-week, mastery weakness.
//     Falls back to Seq order when streamlined is off.
//   - Random: ignores streamlined; shuffle-samples unsolved rows.
//
// Mix popover: compact row of steppers (one per sheet) so the user can
// adjust the allocation without opening Settings. Writes directly to
// settings.schedule.dailyMix. Changes apply next click of Add tasks.

import { getSettings, updateSettings, getSheets, getDayLog, updateDayLog } from "./store.js";
import { priceTask, todayKey } from "./engine.js";

const CSS_ID = "add-tasks-styles";

// ============ CORE PICK LOGIC ============

function pickFromSheet(sheetName, count, mode) {
  if (!count || count <= 0) return [];
  const sheet = getSheets()[sheetName];
  if (!sheet?.rows?.length || !sheet?.headers?.length) return [];

  const titleCol = sheet.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
  const patternCol = sheet.headers.find(h => /^(pattern|category)$/i.test(h));
  const diffCol = sheet.headers.find(h => /^difficulty$/i.test(h));
  const freqCol = sheet.headers.find(h => /^(freq|priority)$/i.test(h));
  const statusCol = sheet.headers.find(h => /^status$/i.test(h));
  const lcCol = sheet.headers.find(h => /^lc#?$/i.test(h));
  if (!titleCol) return [];

  // Filter: unsolved + has a title
  let pool = [];
  for (let i = 0; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    const title = String(r[titleCol] || "").trim();
    if (!title) continue;
    const status = String(r[statusCol] || "").trim().toUpperCase();
    if (/^(SOLVED|DONE)$/.test(status)) continue;
    pool.push({
      sheetName, rowIndex: i,
      title,
      pattern: patternCol ? String(r[patternCol] || "").trim() : "",
      difficulty: diffCol ? String(r[diffCol] || "").trim() : "",
      freq: freqCol ? String(r[freqCol] || "").trim() : "",
      lc: lcCol ? String(r[lcCol] || "").trim() : "",
    });
  }
  if (!pool.length) return [];

  // Streamlined / active-topic filter — only in Priority mode.
  if (mode === "priority") {
    try {
      const active = typeof window !== "undefined"
        ? window.__gainStudy?.getActiveTopic?.(sheetName)
        : null;
      if (active) {
        const filtered = pool.filter(p => p.pattern === active);
        if (filtered.length) pool = filtered;   // soft rail — don't starve the pool
      }
    } catch (_) {}
  }

  // Rank
  if (mode === "random") {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  } else {
    // Priority: HIGH-freq / P1 > MED / P2 > LOW / P3; then by original order.
    const rank = (f) => {
      const u = String(f || "").toUpperCase();
      if (u === "HIGH" || u === "P1") return 0;
      if (u === "MED" || u === "P2") return 1;
      return 2;
    };
    pool.sort((a, b) => rank(a.freq) - rank(b.freq));
  }

  return pool.slice(0, count);
}

function inferKindForSheet(sheetName) {
  const s = String(sheetName).toLowerCase();
  if (/dsa/.test(s)) return "dsa";
  if (/^sql/.test(s)) return "sql";
  if (/system.?design/.test(s)) return "sd";
  if (/integration/.test(s)) return "int";
  if (/extra|interview/.test(s)) return "ext";
  if (/\bos\b|network/.test(s)) return "os";
  return "dsa";
}

function estimateMinutes(difficulty, kind) {
  const d = String(difficulty || "").toLowerCase();
  if (kind === "sd" || kind === "int" || kind === "ext" || kind === "os") return 25;
  if (d === "easy") return 25;
  if (d === "medium") return 40;
  if (d === "hard") return 55;
  return 30;
}

// Add N tasks per sheet to today's dayLog. Returns a summary.
export async function runAddTasks(mode = "priority") {
  const settings = getSettings();
  const mix = settings?.schedule?.dailyMix || {};
  const sheets = getSheets();
  const dateKey = todayKey();

  // What we already have in today's plan, so we don't duplicate.
  const existingKeys = new Set(
    (getDayLog()[dateKey]?.assigned || []).map(t => `${t.sheet || ""}#${t.rowIndex ?? ""}`)
  );

  const picks = [];
  const addedBySheet = {};

  for (const [sheetName, count] of Object.entries(mix)) {
    if (!sheets[sheetName]) continue;
    if (!count || count <= 0) continue;
    const sheetPicks = pickFromSheet(sheetName, count, mode)
      .filter(p => !existingKeys.has(`${p.sheetName}#${p.rowIndex}`));
    for (const p of sheetPicks) {
      const kind = inferKindForSheet(sheetName);
      const task = {
        ref: `ADD-${sheetName}-${p.rowIndex}-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        kind,
        title: p.title,
        pattern: p.pattern,
        difficulty: p.difficulty,
        freq: p.freq,
        lc: p.lc,
        minutes: estimateMinutes(p.difficulty, kind),
        sheet: sheetName,
        rowIndex: p.rowIndex,
        addedBy: mode,
      };
      task.value = priceTask(task, settings);
      picks.push(task);
      addedBySheet[sheetName] = (addedBySheet[sheetName] || 0) + 1;
      existingKeys.add(`${sheetName}#${p.rowIndex}`);
    }
  }

  if (!picks.length) {
    return { added: 0, bySheet: {}, mode };
  }

  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    d.assigned.push(...picks);
    for (const t of picks) d.values[t.ref] = t.value;
  });

  return { added: picks.length, bySheet: addedBySheet, mode };
}

// ============ UI — POPOVER ============

export function openAddTasksPopover(anchorBtn, onDone) {
  injectStyles();
  document.querySelectorAll(".at-pop").forEach(p => p.remove());

  const settings = getSettings();
  const mix = { ...(settings?.schedule?.dailyMix || {}) };
  const sheets = Object.keys(getSheets());
  // Keep order consistent with dailyMix insertion order; add any sheets missing from mix
  const allSheets = Array.from(new Set([...Object.keys(mix), ...sheets]));

  const pop = document.createElement("div");
  pop.className = "at-pop";
  pop.innerHTML = `
    <div class="at-head">
      <div class="at-title">Add tasks</div>
      <div class="at-sub">N problems per sheet · ignores sheets with count 0</div>
    </div>
    <div class="at-mode" role="radiogroup" aria-label="Pick mode">
      <button class="at-mode-btn active" data-at-mode="priority" title="Streamlined active-topic + HIGH-freq ranking">
        <span>★</span> Priority
      </button>
      <button class="at-mode-btn" data-at-mode="random" title="Shuffle-sample from each sheet's unsolved pool">
        <span>🎲</span> Random
      </button>
    </div>
    <div class="at-mix-list">
      ${allSheets.map(name => {
        const cnt = Number.isFinite(mix[name]) ? mix[name] : 0;
        return `
          <div class="at-mix-row">
            <span class="at-mix-name">${esc(name)}</span>
            <div class="at-mix-stepper">
              <button class="at-mix-btn" data-at-dec="${esc(name)}" ${cnt <= 0 ? "disabled" : ""}>−</button>
              <input class="at-mix-input" data-at-input="${esc(name)}" type="text" inputmode="numeric" value="${cnt}" />
              <button class="at-mix-btn" data-at-inc="${esc(name)}">+</button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
    <footer class="at-foot">
      <button class="at-btn-ghost" id="at-cancel">Cancel</button>
      <button class="at-btn-primary" id="at-add">+ Add <span id="at-total-count"></span></button>
    </footer>
  `;
  document.body.appendChild(pop);

  // Position: below the anchor, flipped if close to bottom
  const r = anchorBtn.getBoundingClientRect();
  const popW = 340;
  const popH = Math.min(window.innerHeight - 40, 420);
  let left = Math.min(window.innerWidth - popW - 16, Math.max(16, r.right - popW));
  let top = r.bottom + 8;
  if (top + popH > window.innerHeight - 16) top = Math.max(16, r.top - popH - 8);
  pop.style.left = left + "px";
  pop.style.top = top + "px";

  const refreshTotal = () => {
    let total = 0;
    pop.querySelectorAll("[data-at-input]").forEach(input => {
      const n = Math.max(0, parseInt(input.value, 10) || 0);
      total += n;
    });
    const totalEl = pop.querySelector("#at-total-count");
    if (totalEl) totalEl.textContent = total > 0 ? `· ${total} task${total === 1 ? "" : "s"}` : "";
  };
  refreshTotal();

  const persistMix = async () => {
    const next = {};
    pop.querySelectorAll("[data-at-input]").forEach(input => {
      const name = input.dataset.atInput;
      const n = Math.max(0, parseInt(input.value, 10) || 0);
      next[name] = n;
    });
    await updateSettings(st => {
      if (!st.schedule) st.schedule = {};
      st.schedule.dailyMix = next;
    });
  };

  // Stepper interactions
  pop.querySelectorAll("[data-at-inc]").forEach(btn => btn.addEventListener("click", async () => {
    const name = btn.dataset.atInc;
    const input = pop.querySelector(`[data-at-input="${CSS.escape(name)}"]`);
    if (!input) return;
    const n = Math.max(0, parseInt(input.value, 10) || 0);
    input.value = String(n + 1);
    refreshTotal();
    await persistMix();
    const dec = pop.querySelector(`[data-at-dec="${CSS.escape(name)}"]`);
    if (dec) dec.disabled = false;
  }));
  pop.querySelectorAll("[data-at-dec]").forEach(btn => btn.addEventListener("click", async () => {
    const name = btn.dataset.atDec;
    const input = pop.querySelector(`[data-at-input="${CSS.escape(name)}"]`);
    if (!input) return;
    const n = Math.max(0, parseInt(input.value, 10) || 0);
    const next = Math.max(0, n - 1);
    input.value = String(next);
    if (next <= 0) btn.disabled = true;
    refreshTotal();
    await persistMix();
  }));
  pop.querySelectorAll("[data-at-input]").forEach(input => {
    input.addEventListener("input", async () => {
      // Allow blank while typing; coerce to 0 below
      const n = Math.max(0, parseInt(input.value, 10) || 0);
      input.value = String(n);
      refreshTotal();
      const name = input.dataset.atInput;
      const dec = pop.querySelector(`[data-at-dec="${CSS.escape(name)}"]`);
      if (dec) dec.disabled = n <= 0;
      await persistMix();
    });
  });

  // Mode toggle
  pop.querySelectorAll("[data-at-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      pop.querySelectorAll("[data-at-mode]").forEach(b => b.classList.toggle("active", b === btn));
    });
  });

  const close = () => {
    pop.remove();
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey);
  };
  const onDocClick = (e) => { if (!pop.contains(e.target) && e.target !== anchorBtn) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  setTimeout(() => {
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
  }, 0);

  pop.querySelector("#at-cancel")?.addEventListener("click", close);

  pop.querySelector("#at-add")?.addEventListener("click", async () => {
    const activeMode = pop.querySelector("[data-at-mode].active")?.dataset.atMode || "priority";
    const btn = pop.querySelector("#at-add");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = "Adding…";
    try {
      const summary = await runAddTasks(activeMode);
      close();
      if (typeof onDone === "function") onDone(summary);
    } catch (err) {
      btn.innerHTML = original;
      btn.disabled = false;
      const { showAlert } = await import("./modals.js");
      await showAlert({ title: "Couldn't add tasks", message: String(err.message || err), tone: "error" });
    }
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

function injectStyles() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = `
    .at-pop {
      position: fixed; z-index: 1850;
      width: 340px; padding: 14px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 14px;
      box-shadow:
        0 24px 60px -12px rgba(0,0,0,.22),
        0 6px 14px rgba(0,0,0,.08);
      animation: atPop .18s cubic-bezier(.2,1.2,.3,1) both;
      display: flex; flex-direction: column; gap: 10px;
    }
    @keyframes atPop { from { opacity: 0; transform: translateY(-6px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .at-head { }
    .at-title { font: 700 13.5px/1.2 var(--font-sans); color: var(--ink); letter-spacing: -.012em; }
    .at-sub { font: 500 11.5px/1.3 var(--font-sans); color: var(--mut); margin-top: 2px; }

    .at-mode { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: color-mix(in oklab, var(--mut) 8%, var(--paper)); border: 1px solid var(--line); }
    .at-mode-btn {
      flex: 1; padding: 7px 10px; border-radius: 7px; border: none; background: transparent;
      font: 600 11.5px/1 var(--font-sans); color: var(--mut); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      transition: all .14s ease;
    }
    .at-mode-btn:hover { color: var(--ink); }
    .at-mode-btn.active { background: var(--paper); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 0 0 1px var(--line); }

    .at-mix-list { display: flex; flex-direction: column; gap: 5px; max-height: 280px; overflow-y: auto; }
    .at-mix-row {
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 6px 8px; border-radius: 8px;
      background: color-mix(in oklab, var(--mut) 4%, var(--paper));
      border: 1px solid var(--line);
    }
    .at-mix-name {
      flex: 1; min-width: 0; font: 500 12.5px/1.3 var(--font-sans); color: var(--ink);
      letter-spacing: -.005em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .at-mix-stepper { display: inline-flex; align-items: stretch; gap: 2px; }
    .at-mix-btn {
      width: 24px; height: 24px; border-radius: 6px;
      background: var(--paper); border: 1px solid var(--line); color: var(--ink);
      font: 700 13px/1 var(--font-sans); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all .12s ease;
    }
    .at-mix-btn:hover:not(:disabled) { border-color: var(--line2); background: color-mix(in oklab, var(--ink) 4%, var(--paper)); }
    .at-mix-btn:disabled { opacity: .3; cursor: not-allowed; }
    .at-mix-input {
      width: 36px; text-align: center;
      padding: 3px 0; border-radius: 6px;
      background: var(--paper); border: 1px solid var(--line); color: var(--ink);
      font: 700 12.5px/1 var(--font-sans);
    }
    .at-mix-input:focus { outline: 2px solid var(--gold); outline-offset: -2px; }

    .at-foot { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; border-top: 1px dashed var(--line); margin-top: 4px; padding-top: 10px; }
    .at-btn-primary {
      padding: 7px 12px; border-radius: 8px;
      background: var(--ink); color: var(--paper); border: none;
      font: 600 12px/1 var(--font-sans); cursor: pointer;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .at-btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
    .at-btn-primary:disabled { opacity: .6; cursor: progress; }
    .at-btn-ghost {
      padding: 7px 12px; border-radius: 8px;
      background: var(--paper); color: var(--mut); border: 1px solid var(--line);
      font: 600 12px/1 var(--font-sans); cursor: pointer;
    }
    .at-btn-ghost:hover { color: var(--ink); border-color: var(--line2); }
  `;
  document.head.appendChild(s);
}
