// Pattern-of-the-week — curated list of indispensable patterns the app
// rotates through. On Monday morning (first boot of the week) the engine
// advances to the next entry unless the user has set an explicit override.
// Suggest + Warmup bias their picks toward this pattern.
//
// All state lives inside settings.schedule.weeklyFocus so it participates
// in the normal backup/restore pipeline.

import { getSettings, updateSettings } from "./store.js";

// Monday of the ISO week containing `d`, as a yyyy-mm-dd string.
function mondayOf(d) {
  const dt = new Date(d);
  const day = dt.getUTCDay();          // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diff);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Get the current week's focus pattern. Advances the rotation if the stored
// week-start is older than this Monday. Returns null if no patterns are set.
export async function getCurrentFocus() {
  const s = getSettings();
  const wf = s?.schedule?.weeklyFocus;
  if (!wf || !Array.isArray(wf.patterns) || !wf.patterns.length) return null;

  // Explicit override wins
  if (wf.current && wf.patterns.includes(wf.current)) return wf.current;

  const thisMon = mondayOf(new Date());
  if (wf.startedAt === thisMon) {
    return wf.patterns[wf.rotationIdx % wf.patterns.length];
  }

  // Advance rotation and persist
  const nextIdx = (wf.rotationIdx + 1) % wf.patterns.length;
  await updateSettings(st => {
    st.schedule.weeklyFocus.rotationIdx = nextIdx;
    st.schedule.weeklyFocus.startedAt = thisMon;
    st.schedule.weeklyFocus.current = "";    // clear override on week change
  });
  return wf.patterns[nextIdx];
}

// User explicitly picks a pattern for this week (overrides rotation).
export async function setFocusOverride(patternName) {
  await updateSettings(st => {
    if (!st.schedule.weeklyFocus) return;
    st.schedule.weeklyFocus.current = patternName || "";
    if (patternName) st.schedule.weeklyFocus.startedAt = mondayOf(new Date());
  });
}

export function listFocusPatterns() {
  const s = getSettings();
  return s?.schedule?.weeklyFocus?.patterns || [];
}

export async function updateFocusPatterns(list) {
  await updateSettings(st => {
    if (!st.schedule.weeklyFocus) return;
    st.schedule.weeklyFocus.patterns = Array.isArray(list) ? list.filter(x => x && String(x).trim()) : [];
  });
}

// ============ EDITOR MODAL ============
// Proper inline editor — no browser prompt(). Lists all patterns with
// drag/reorder, add, delete, and "set as this week" actions.
export async function openFocusEditor(onDone) {
  injectStyles();
  document.querySelectorAll(".wf-scrim").forEach(s => s.remove());
  const current = await getCurrentFocus();
  const list = listFocusPatterns();

  const scrim = document.createElement("div");
  scrim.className = "wf-scrim";
  scrim.innerHTML = `
    <div class="wf-modal" role="dialog" aria-label="Pattern of the week">
      <header class="wf-head">
        <div class="wf-eyebrow">PATTERN OF THE WEEK</div>
        <h2 class="wf-title">Your indispensable patterns</h2>
        <p class="wf-sub">Each Monday the app advances to the next pattern. Suggest + Warmup bias toward it for 7 days. Click the ★ on any pattern to make it this week's focus.</p>
      </header>
      <div class="wf-body">
        <div class="wf-list" id="wf-list">
          ${renderList(list, current)}
        </div>
        <div class="wf-add-row">
          <input type="text" id="wf-new" placeholder="Add a pattern (e.g. Monotonic Stack)" />
          <button class="wf-btn-primary" id="wf-add">+ Add</button>
        </div>
      </div>
      <footer class="wf-foot">
        <button class="wf-btn-ghost" id="wf-close">Done</button>
      </footer>
    </div>
  `;
  document.body.appendChild(scrim);

  const close = () => { scrim.remove(); if (typeof onDone === "function") onDone(); };
  scrim.querySelector("#wf-close")?.addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  const escH = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", escH); } };
  document.addEventListener("keydown", escH);

  const refresh = async () => {
    const now = await getCurrentFocus();
    const items = listFocusPatterns();
    scrim.querySelector("#wf-list").innerHTML = renderList(items, now);
    wireList();
  };

  const wireList = () => {
    scrim.querySelectorAll("[data-wf-pick]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await setFocusOverride(btn.dataset.wfPick);
        await refresh();
      });
    });
    scrim.querySelectorAll("[data-wf-up]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const items = listFocusPatterns();
        const i = Number(btn.dataset.wfUp);
        if (i <= 0) return;
        [items[i - 1], items[i]] = [items[i], items[i - 1]];
        await updateFocusPatterns(items);
        await refresh();
      });
    });
    scrim.querySelectorAll("[data-wf-down]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const items = listFocusPatterns();
        const i = Number(btn.dataset.wfDown);
        if (i >= items.length - 1) return;
        [items[i], items[i + 1]] = [items[i + 1], items[i]];
        await updateFocusPatterns(items);
        await refresh();
      });
    });
    scrim.querySelectorAll("[data-wf-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const items = listFocusPatterns();
        const name = btn.dataset.wfDel;
        await updateFocusPatterns(items.filter(x => x !== name));
        await refresh();
      });
    });
  };

  scrim.querySelector("#wf-add")?.addEventListener("click", async () => {
    const input = scrim.querySelector("#wf-new");
    const name = String(input.value || "").trim();
    if (!name) { input.focus(); return; }
    const items = listFocusPatterns();
    if (items.includes(name)) { input.value = ""; input.focus(); return; }
    await updateFocusPatterns([...items, name]);
    input.value = "";
    await refresh();
    input.focus();
  });
  scrim.querySelector("#wf-new")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") scrim.querySelector("#wf-add")?.click();
  });

  wireList();
}

function renderList(items, current) {
  if (!items.length) return `<div class="wf-empty">No patterns yet — add some below.</div>`;
  return items.map((name, i) => `
    <div class="wf-row ${name === current ? "current" : ""}">
      <button class="wf-star" data-wf-pick="${escLocal(name)}" title="Make this week's focus">${name === current ? "★" : "☆"}</button>
      <div class="wf-name">${escLocal(name)}</div>
      <div class="wf-row-actions">
        <button class="wf-icon" data-wf-up="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="wf-icon" data-wf-down="${i}" title="Move down" ${i === items.length - 1 ? "disabled" : ""}>↓</button>
        <button class="wf-icon wf-icon-danger" data-wf-del="${escLocal(name)}" title="Delete">×</button>
      </div>
    </div>
  `).join("");
}

function escLocal(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

function injectStyles() {
  if (document.getElementById("weekly-focus-styles")) return;
  const s = document.createElement("style");
  s.id = "weekly-focus-styles";
  s.textContent = `
    .wf-scrim {
      position: fixed; inset: 0; z-index: 1680;
      display: flex; align-items: center; justify-content: center; padding: 24px;
      background: transparent;
    }
    .wf-modal {
      background: var(--paper); border-radius: 18px; width: 100%; max-width: 560px;
      max-height: 86vh; display: flex; flex-direction: column; overflow: hidden;
      box-shadow:
        0 28px 80px rgba(0,0,0,.22),
        0 8px 20px rgba(0,0,0,.08),
        0 0 0 1px var(--line);
      animation: wfPop .22s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes wfPop { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .wf-head {
      padding: 20px 24px 14px; border-bottom: 1px solid var(--line);
      background: radial-gradient(100% 100% at 0% 0%, color-mix(in oklab, var(--gold) 10%, var(--paper)) 0%, var(--paper) 60%);
    }
    .wf-eyebrow { font: 700 10.5px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase; color: var(--gold); margin-bottom: 8px; }
    .wf-title { margin: 0 0 6px; font: 600 20px/1.25 var(--font-sans); color: var(--ink); letter-spacing: -.015em; }
    .wf-sub { margin: 0; font: 500 12.5px/1.55 var(--font-sans); color: var(--mut); }
    .wf-body { padding: 16px 20px; overflow-y: auto; }
    .wf-list { display: flex; flex-direction: column; gap: 6px; }
    .wf-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 10px;
      background: var(--paper); border: 1px solid var(--line);
      transition: all .14s ease;
    }
    .wf-row:hover { border-color: var(--line2); }
    .wf-row.current {
      background: linear-gradient(135deg, color-mix(in oklab, var(--gold) 14%, var(--paper)) 0%, color-mix(in oklab, var(--gold) 4%, var(--paper)) 100%);
      border-color: color-mix(in oklab, var(--gold) 36%, var(--line));
    }
    .wf-star {
      width: 32px; height: 32px; border-radius: 8px;
      background: transparent; border: 1px solid var(--line); color: var(--mut);
      cursor: pointer; font: 700 16px/1 var(--font-sans);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .wf-star:hover { color: var(--gold); border-color: var(--gold); }
    .wf-row.current .wf-star { color: var(--gold); border-color: var(--gold); background: color-mix(in oklab, var(--gold) 10%, transparent); }
    .wf-name { flex: 1; font: 600 13.5px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -.008em; min-width: 0; }
    .wf-row-actions { display: flex; gap: 4px; }
    .wf-icon {
      width: 28px; height: 28px; border-radius: 7px;
      background: transparent; border: 1px solid var(--line); color: var(--mut);
      cursor: pointer; font: 500 13px/1 var(--font-sans);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .wf-icon:hover:not(:disabled) { color: var(--ink); border-color: var(--line2); }
    .wf-icon:disabled { opacity: .3; cursor: not-allowed; }
    .wf-icon-danger:hover { color: var(--red); border-color: var(--red); }

    .wf-add-row { display: flex; gap: 8px; margin-top: 14px; }
    .wf-add-row input {
      flex: 1; padding: 10px 12px; border-radius: 10px;
      border: 1px solid var(--line); background: var(--paper); color: var(--ink);
      font: 500 13px/1.4 var(--font-sans);
    }
    .wf-add-row input:focus { outline: 2px solid var(--gold); outline-offset: -2px; }
    .wf-btn-primary {
      padding: 10px 16px; border-radius: 10px;
      background: var(--ink); color: var(--paper); border: none;
      font: 600 12.5px/1 var(--font-sans); cursor: pointer;
    }
    .wf-btn-primary:hover { filter: brightness(1.1); }
    .wf-btn-ghost {
      padding: 10px 18px; border-radius: 10px;
      background: var(--paper); border: 1px solid var(--line); color: var(--ink);
      font: 600 12.5px/1 var(--font-sans); cursor: pointer;
    }
    .wf-foot { padding: 14px 20px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; }
    .wf-empty { padding: 20px; text-align: center; color: var(--mut); font: 500 13px/1.5 var(--font-sans); }
  `;
  document.head.appendChild(s);
}
