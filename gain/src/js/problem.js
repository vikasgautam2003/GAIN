// Problem view — redesigned per user:
//   - No Java scratch pad, no Description tab, no Discussion tab
//   - LC URL input in the hero (user pastes); writes back to the sheet row
//   - Tabs: Notes · Solution (code pad). Both autosave to the sheet row and localStorage.
//   - Right rail: compact Focus timer + Confidence card (clicking affects allotment)
//   - Single Mark solved button. REVIEW status (set in Library) is the lever to re-queue
//     an item onto the weekend plan — no separate "AGAIN" button here.

import { getSheets, getSettings, updateSheetRow, updateWallet, getWallet, getSolution, setSolution, on } from "./store.js";
import { priceTask, todayKey } from "./engine.js";
import { fireTaskBagged } from "./celebrate.js";

let unsub = null;
let timerState = null;
let activeTab = "notes";
let currentKey = null;

export default {
  mount(root, params) {
    const sheetName = decodeURIComponent(params[0] || "DSA");
    const idx = Number(params[1] || 0);
    const sheet = getSheets()[sheetName];
    if (!sheet || !sheet.rows[idx]) {
      root.innerHTML = `
        <div class="view-inner"><div class="card empty-state">
          <h2>Problem not found</h2><p>That row doesn't exist. <a href="#library">Back to Library</a>.</p>
        </div></div>`;
      return;
    }
    const row = sheet.rows[idx];
    const s = getSettings();
    const title = row.Problem || row.Topic || row["Skill or Platform"] || row.Item || "Untitled";
    const difficulty = (row.Difficulty || "—").toLowerCase();
    const lcCol  = findCol(row, /^lc#?$/i);
    const linkCol = findCol(row, /^(link|url|reference|ref)$/i);
    const notesCol = findCol(row, /^(notes|note)$/i) || "Notes";
    const solCol = findCol(row, /^(solution|java|code)$/i);   // may be undefined if CSV lacks the column
    const confCol = findCol(row, /^confidence$/i);
    const statusCol = findCol(row, /^status$/i);

    const lcValue = row[lcCol] || row[linkCol] || "";
    const pattern = row.Pattern || row.Category || "";
    const freq    = row.Freq || row.Priority || "";
    const status  = (row[statusCol] || "TODO").toUpperCase();
    const confidence = row[confCol] || "";
    const value = priceTask({
      kind: sheet.type || "dsa", difficulty, freq,
      minutes: estimateMinutes(difficulty)
    }, s);

    currentKey = `${sheetName}#${row.Seq || idx}`;
    const notes = row[notesCol] || "";
    // Prefer the dedicated solutions store; fall back to the CSV column (if present) + legacy localStorage
    const solution = getSolution(sheetName, idx)
                  || (solCol ? row[solCol] : "")
                  || "";

    root.innerHTML = render({
      sheetName, idx, title, difficulty, lcValue, pattern, freq, status, confidence,
      value, notes, solution
    });
    attach(root, { sheetName, idx, row, value, lcCol: lcCol || "LC#", linkCol, notesCol, solCol, confCol, statusCol });
    startTimer(root, 25 * 60);

    if (unsub) unsub();
    unsub = on(() => {});
  },
  unmount() {
    if (unsub) { unsub(); unsub = null; }
    stopTimer();
    currentKey = null;
  }
};

function findCol(row, re) {
  return Object.keys(row).find(k => re.test(k));
}

function estimateMinutes(d) {
  if (d === "easy") return 25;
  if (d === "medium") return 40;
  if (d === "hard") return 55;
  return 30;
}

function render(ctx) {
  const { sheetName, idx, title, difficulty, lcValue, pattern, freq, status, confidence, value, notes, solution } = ctx;
  const diffClass = difficulty === "easy" ? "easy" : difficulty === "medium" ? "med" : difficulty === "hard" ? "hard" : "muted";
  const statusClass = status === "SOLVED" ? "solved" : status === "AGAIN" ? "again" : status === "REVIEW" ? "review" : "todo";

  return `
    <div class="view-inner prob">
      <div class="prob-top">
        <a class="back-link" href="#library">← Back to Library</a>
        <div class="prob-crumbs">${esc(sheetName)} · row ${idx + 1}${pattern ? " · " + esc(pattern) : ""}</div>
      </div>

      <div class="prob-hero alive">
        <div class="prob-hero-main">
          <div class="prob-chips">
            ${difficulty && difficulty !== "—" ? `<span class="chip diff ${diffClass}">${esc(difficulty.toUpperCase())}</span>` : ""}
            ${freq ? `<span class="chip freq">${esc(freq)}</span>` : ""}
            ${pattern ? `<span class="chip pattern">${esc(pattern)}</span>` : ""}
            <span class="chip status ${statusClass}">${esc(status)}</span>
          </div>
          <h1 class="prob-title">${esc(title)}</h1>
          <div class="prob-link-row">
            <div class="prob-link-wrap">
              <span class="prob-link-icon">🔗</span>
              <input id="lc-url" type="url" placeholder="Paste the LeetCode link (or any URL) here…" value="${esc(lcValue)}" />
              <a id="lc-open" class="prob-link-open" href="${esc(resolveLink(lcValue, title))}" target="_blank" rel="noopener">Open ↗</a>
            </div>
          </div>
        </div>
        <div class="prob-hero-side">
          <div class="value-pill">
            <div class="v-lb">BOUNTY</div>
            <div class="v-val">+ ₹${value}</div>
          </div>
          <button class="btn-primary btn-lg" id="btn-solved">Mark solved · bank ₹${value}</button>
        </div>
      </div>

      <div class="prob-grid">
        <section class="prob-left">
          <div class="prob-tabs" role="tablist">
            <button class="pt ${activeTab==='notes'?'active':''}" data-tab="notes">📝 Notes</button>
            <button class="pt ${activeTab==='sol'?'active':''}" data-tab="sol">💻 Solution</button>
          </div>
          <div class="prob-tab-body" id="tab-body">
            <div class="tab-pane ${activeTab==='notes'?'show':''}" id="pane-notes">
              <textarea id="notes-ta" placeholder="Your notes — approach, intuition, pitfalls, pattern recognition, invariants, what tripped you up…">${esc(notes)}</textarea>
              <p class="pane-foot">Autosaves to this device <b>and</b> writes to the Notes column of the sheet.</p>
            </div>
            <div class="tab-pane ${activeTab==='sol'?'show':''}" id="pane-sol">
              <textarea id="sol-ta" class="code-pad" spellcheck="false" placeholder="Paste your final solution here (any language). Autosaved to the sheet's Solution column.">${esc(solution)}</textarea>
              <p class="pane-foot">Code pad. Monospace, tab = 4 spaces. Written to the Solution column.</p>
            </div>
          </div>
        </section>

        <aside class="prob-right">
          <div class="prob-card timer-card alive">
            <div class="pc-head"><h3>Focus timer</h3><span class="pc-sub">No peeking</span></div>
            <div class="timer-wrap">
              <svg class="ring" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="46" fill="none" stroke="var(--line)" stroke-width="5"/>
                <circle id="ring-arc" cx="50" cy="50" r="46" fill="none" stroke="var(--blue)" stroke-width="5"
                        stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="0" transform="rotate(-90 50 50)"/>
              </svg>
              <div class="timer-text" id="timer-display">25:00</div>
            </div>
            <div class="timer-ctrls">
              <button class="btn-ghost btn-sm" data-t="15">15m</button>
              <button class="btn-ghost btn-sm" data-t="25">25m</button>
              <button class="btn-ghost btn-sm" data-t="45">45m</button>
            </div>
            <div class="timer-ctrls">
              <button class="btn-primary btn-sm" id="btn-pause">Pause</button>
              <button class="btn-ghost btn-sm" id="btn-reset">Reset</button>
            </div>
            <p class="timer-pledge">"No peeking for 25 minutes. That's the deal."</p>
          </div>

          <div class="prob-card conf-card alive">
            <div class="pc-head"><h3>Confidence</h3><span class="pc-sub">Be honest</span></div>
            <div class="conf-row" id="conf-row">
              ${[1,2,3,4,5].map(n => `<button class="conf-dot ${String(confidence)===String(n)?'active':''}" data-conf="${n}">${n}</button>`).join("")}
            </div>
            <p class="conf-note">Low confidence here → spaced repetition brings it back in a few days. Lying = failing the real interview later.</p>
            <div class="conf-growth" id="conf-growth"></div>
          </div>
        </aside>
      </div>

      ${styles()}
    </div>
  `;
}

function resolveLink(lcValue, title) {
  if (!lcValue) return `https://leetcode.com/problems/${slugify(title)}/`;
  if (/^https?:\/\//i.test(lcValue)) return lcValue;
  if (/^\d+$/.test(lcValue)) return `https://leetcode.com/problems/${slugify(title)}/`;
  return `https://leetcode.com/problems/${slugify(lcValue)}/`;
}

function attach(root, { sheetName, idx, row, value, lcCol, linkCol, notesCol, solCol, confCol, statusCol }) {
  // --- LC URL input: write back to the sheet ---
  const urlInput = root.querySelector("#lc-url");
  const openBtn = root.querySelector("#lc-open");
  let urlT;
  urlInput.addEventListener("input", () => {
    const val = urlInput.value.trim();
    openBtn.href = resolveLink(val, row.Problem || row.Topic);
    clearTimeout(urlT);
    urlT = setTimeout(async () => {
      // write to the right column (LC# if value looks numeric, else link/url)
      const useLinkCol = linkCol && !/^\d+$/.test(val);
      const col = useLinkCol ? linkCol : lcCol;
      if (col) await updateSheetRow(sheetName, idx, { [col]: val });
    }, 400);
  });

  // --- tab switching ---
  root.querySelectorAll(".prob-tabs .pt").forEach(btn => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      root.querySelectorAll(".prob-tabs .pt").forEach(b => b.classList.toggle("active", b === btn));
      root.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("show"));
      root.querySelector("#pane-" + activeTab).classList.add("show");
    });
  });

  // --- notes autosave (to sheet column + localStorage) ---
  const notesTa = root.querySelector("#notes-ta");
  let notesT;
  notesTa.addEventListener("input", () => {
    clearTimeout(notesT);
    notesT = setTimeout(async () => {
      localStorage.setItem(`notes:${currentKey}`, notesTa.value);
      if (notesCol) await updateSheetRow(sheetName, idx, { [notesCol]: notesTa.value });
    }, 400);
  });

  // --- solution code pad autosave + tab-key = 4 spaces ---
  const solTa = root.querySelector("#sol-ta");
  let solT;
  solTa.addEventListener("input", () => {
    clearTimeout(solT);
    solT = setTimeout(async () => {
      localStorage.setItem(`sol:${currentKey}`, solTa.value);
      // Primary store: dedicated solutions.json (persists reliably + flows into backup).
      await setSolution(sheetName, idx, solTa.value);
      // Also mirror into the sheet column IF the CSV has one (keeps CSV compatibility).
      if (solCol) await updateSheetRow(sheetName, idx, { [solCol]: solTa.value });
    }, 500);
  });
  solTa.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = solTa.selectionStart, en = solTa.selectionEnd;
      solTa.value = solTa.value.slice(0, s) + "    " + solTa.value.slice(en);
      solTa.selectionStart = solTa.selectionEnd = s + 4;
    }
  });

  // --- timer controls ---
  root.querySelectorAll(".timer-ctrls [data-t]").forEach(btn => {
    btn.addEventListener("click", () => startTimer(root, Number(btn.dataset.t) * 60));
  });
  root.querySelector("#btn-pause").addEventListener("click", () => togglePause(root));
  root.querySelector("#btn-reset").addEventListener("click", () => startTimer(root, timerState?.durationSec || 25*60));

  // --- confidence: write back + show growth-system effect ---
  const growth = root.querySelector("#conf-growth");
  const paintGrowth = (n) => {
    if (!n) { growth.innerHTML = ""; return; }
    const v = Number(n);
    let msg;
    if (v === 1) msg = `Shaky — spaced repetition will serve this again <b>tomorrow</b>.`;
    else if (v === 2) msg = `Weak grasp — I'll bring this back in <b>3 days</b>.`;
    else if (v === 3) msg = `OK — I'll re-queue in <b>1 week</b> to lock it in.`;
    else msg = `Solid. No automatic revisit. Set Status=REVIEW in Library if you want one.`;
    growth.innerHTML = `<div class="growth-pill">${msg}</div>`;
  };
  paintGrowth(row[confCol]);
  root.querySelectorAll(".conf-dot").forEach(btn => {
    btn.addEventListener("click", async () => {
      const n = Number(btn.dataset.conf);
      if (confCol) await updateSheetRow(sheetName, idx, { [confCol]: String(n) });
      root.querySelectorAll(".conf-dot").forEach(b => b.classList.toggle("active", b === btn));
      paintGrowth(n);
    });
  });

  // --- Mark solved ---
  // Stable row identity used to prevent double-banking across Today ↔ Problem page.
  const sourceKey = `${sheetName}#${idx}`;

  // If this row was already banked (via Today's tick or an earlier Problem-page claim),
  // disable the bank CTA and show it as locked. Visual + guard both.
  function wasRowAlreadyBanked() {
    const ledger = getWallet().ledger || [];
    return ledger.some(e => e.sourceKey === sourceKey && e.amount > 0);
  }
  const solvedBtn = root.querySelector("#btn-solved");
  if (wasRowAlreadyBanked()) {
    solvedBtn.textContent = "✓ Already banked";
    solvedBtn.classList.add("locked");
    solvedBtn.title = "Already credited. Click to re-sync Status + DateSolved on the sheet.";
    // NOT disabled — clicking still writes Status/DateSolved so Progress stays accurate.
  }

  solvedBtn.addEventListener("click", async () => {
    const title = row.Problem || row.Topic || "problem";
    const dateCol = findCol(row, /^(datesolved|datedone)$/i);
    const patch = {};
    if (statusCol) patch[statusCol] = "SOLVED";
    if (dateCol) patch[dateCol] = todayKey();
    if (Object.keys(patch).length) await updateSheetRow(sheetName, idx, patch);

    // Double-bank guard — re-check at click time in case Today was ticked in another tab/view.
    const alreadyBanked = wasRowAlreadyBanked();
    if (!alreadyBanked) {
      await updateWallet(w => {
        w.earned += value;
        w.ledger.push({
          date: new Date().toISOString(), type: "problem",
          amount: value, label: title, sourceKey
        });
      });
      // Per-problem solve = small localized animation (not the full DAY SECURED overlay —
      // that one is reserved for completing a whole multi-task Today plan).
      fireTaskBagged({ amount: value, title, sourceEl: solvedBtn });
    } else {
      flash(root, "Already banked earlier — status updated only.");
    }
    setTimeout(() => { location.hash = "#library"; }, 1600);
  });

  // Setting Status to REVIEW in the Library (dropdown) is the single lever for
  // "re-queue me on the weekend". No separate flag button needed.
}

function flash(root, msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--paper);padding:10px 18px;border-radius:999px;font-size:13px;z-index:70;animation:rise .3s ease both;";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// -------- timer --------
function startTimer(root, durationSec) {
  stopTimer();
  timerState = { durationSec, startedAt: Date.now(), remaining: durationSec, paused: false };
  tick(root);
  timerState.intervalId = setInterval(() => tick(root), 1000);
  const pledge = root.querySelector(".timer-pledge");
  if (pledge) pledge.textContent = `"No peeking for ${Math.round(durationSec/60)} minutes. That's the deal."`;
  const pauseBtn = root.querySelector("#btn-pause");
  if (pauseBtn) pauseBtn.textContent = "Pause";
}

function tick(root) {
  if (!timerState || timerState.paused) return;
  const elapsed = (Date.now() - timerState.startedAt) / 1000;
  const remaining = Math.max(0, timerState.durationSec - elapsed);
  timerState.remaining = remaining;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(Math.floor(remaining % 60)).padStart(2, "0");
  const disp = root.querySelector("#timer-display");
  if (disp) disp.textContent = `${mm}:${ss}`;
  const ring = root.querySelector("#ring-arc");
  if (ring) {
    const circ = 289;
    const dash = circ * (1 - remaining / timerState.durationSec);
    ring.setAttribute("stroke-dashoffset", String(dash));
  }
  if (remaining <= 0) {
    stopTimer();
    try { new Audio("assets/sound/day.mp3").play().catch(() => {}); } catch (_) {}
    flash(root, "Time's up. Lock in your answer.");
  }
}

function togglePause(root) {
  if (!timerState) return;
  if (timerState.paused) {
    timerState.paused = false;
    timerState.startedAt = Date.now() - (timerState.durationSec - timerState.remaining) * 1000;
    root.querySelector("#btn-pause").textContent = "Pause";
  } else {
    timerState.paused = true;
    root.querySelector("#btn-pause").textContent = "Resume";
  }
}

function stopTimer() {
  if (timerState?.intervalId) clearInterval(timerState.intervalId);
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }

function styles() {
  return `
  <style>
    .prob { max-width: 1240px; }
    .prob .prob-top { display: flex; align-items: center; gap: var(--s-4); margin-bottom: var(--s-3); }
    .prob .back-link { color: var(--blue); text-decoration: none; font: 600 13px/1 var(--font-sans); }
    .prob .back-link:hover { text-decoration: underline; }
    .prob .prob-crumbs { color: var(--mut); font-size: 12px; }

    /* --- hero --- */
    .prob .prob-hero {
      display: grid; grid-template-columns: 1fr auto; gap: var(--s-5);
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-lg);
      padding: var(--s-5) var(--s-6);
      box-shadow: var(--shadow);
      margin-bottom: var(--s-4);
      animation: rise var(--dur-slow) var(--ease) both;
    }
    .prob .prob-chips { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .prob .chip {
      font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 999px;
      letter-spacing: .06em; text-decoration: none;
    }
    .prob .chip.diff.easy { background: var(--green-soft); color: var(--green); }
    .prob .chip.diff.med  { background: #fff6e3; color: var(--gold); }
    .prob .chip.diff.hard { background: #fde8ea; color: var(--red); }
    .prob .chip.diff.muted { background: #f1f2f5; color: var(--mut); }
    .prob .chip.freq { background: var(--ink); color: var(--paper); }
    .prob .chip.pattern { background: var(--blue-soft); color: var(--blue); }
    .prob .chip.status.todo    { background: #f1f2f5; color: var(--mut); }
    .prob .chip.status.solved  { background: var(--green-soft); color: var(--green); }
    .prob .chip.status.review  { background: var(--blue-soft); color: var(--blue); }
    .prob .chip.status.again   { background: #fde8ea; color: var(--red); }

    .prob .prob-title { font-size: 36px; font-weight: 800; letter-spacing: -.02em; margin: 0 0 var(--s-3); line-height: 1.1; }

    .prob .prob-link-row { margin-top: var(--s-3); }
    .prob .prob-link-wrap {
      display: flex; align-items: center; gap: 10px;
      background: var(--bg); border: 1px solid var(--line); border-radius: 12px;
      padding: 8px 14px;
      transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
    }
    .prob .prob-link-wrap:focus-within { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-soft); background: var(--paper); }
    .prob .prob-link-icon { font-size: 16px; }
    .prob .prob-link-wrap input {
      flex: 1; border: none; outline: none; background: transparent;
      font: 13.5px/1.3 var(--font-sans); color: var(--ink);
    }
    .prob .prob-link-wrap input::placeholder { color: var(--mut); }
    .prob .prob-link-open {
      font: 600 12px/1 var(--font-sans); color: var(--blue);
      padding: 6px 12px; background: var(--blue-soft); border-radius: 999px;
      text-decoration: none; white-space: nowrap;
      transition: all var(--dur-fast) var(--ease);
    }
    .prob .prob-link-open:hover { background: var(--blue); color: #fff; }

    .prob .prob-hero-side { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
    .prob .value-pill {
      background: linear-gradient(135deg, #fffaf0, #fff6e3); border: 1px solid #f3dfa6;
      border-radius: 14px; padding: 10px 18px; text-align: right;
    }
    .prob .value-pill .v-lb { font-size: 10px; letter-spacing: .18em; color: var(--mut); font-weight: 700; }
    .prob .value-pill .v-val { font-size: 22px; font-weight: 800; color: var(--gold); margin-top: 2px; }

    /* --- main grid --- */
    .prob .prob-grid { display: grid; grid-template-columns: 1fr 320px; gap: var(--s-4); align-items: flex-start; }
    .prob .prob-left {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
      box-shadow: var(--shadow); padding: 0; overflow: hidden;
    }
    .prob .prob-card {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
      box-shadow: var(--shadow); padding: var(--s-4) var(--s-5); margin-bottom: var(--s-4);
    }

    .prob .prob-tabs {
      display: flex; gap: 4px; padding: 6px; background: var(--bg);
      border-bottom: 1px solid var(--line);
    }
    .prob .pt {
      padding: 10px 16px; border: none; background: transparent; cursor: pointer;
      font: 600 13px/1 var(--font-sans); color: var(--mut); border-radius: 8px;
      transition: all var(--dur-fast) var(--ease);
    }
    .prob .pt:hover { color: var(--ink); background: var(--paper); }
    .prob .pt.active { background: var(--paper); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.08); }

    .prob .prob-tab-body { padding: var(--s-4) var(--s-5) var(--s-5); min-height: 360px; }
    .prob .tab-pane { display: none; }
    .prob .tab-pane.show { display: block; animation: fadeInUp .25s var(--ease) both; }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .prob .pane-foot { color: var(--mut); font-size: 11px; margin: 8px 0 0; font-style: italic; }

    .prob textarea {
      width: 100%; min-height: 320px; border: 1px solid var(--line); border-radius: 12px;
      padding: 14px 16px; font: 14px/1.6 var(--font-sans); color: var(--ink);
      outline: none; resize: vertical; background: var(--bg);
      transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
    }
    .prob textarea:focus { border-color: var(--blue); background: var(--paper); box-shadow: 0 0 0 3px var(--blue-soft); }
    .prob textarea.code-pad {
      background: var(--ink); color: var(--paper); border-color: var(--ink);
      font: 13.5px/1.65 var(--font-mono); tab-size: 4;
    }
    .prob textarea.code-pad:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(59,100,246,.4); }

    /* --- right rail --- */
    .prob .pc-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: var(--s-3); }
    .prob .pc-head h3 { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: .02em; }
    .prob .pc-sub { color: var(--mut); font-size: 11px; }

    .prob .timer-card { text-align: center; }
    .prob .timer-wrap {
      position: relative; width: 180px; height: 180px; margin: 0 auto var(--s-3);
    }
    .prob .timer-wrap .ring { width: 100%; height: 100%; }
    .prob .timer-text {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font: 800 32px/1 var(--font-mono); color: var(--ink); letter-spacing: -.02em;
    }
    .prob .timer-ctrls { display: flex; gap: 6px; justify-content: center; margin-bottom: 6px; }
    .prob .timer-ctrls .btn-ghost.btn-sm, .prob .timer-ctrls .btn-primary.btn-sm { padding: 7px 14px; min-width: 50px; }
    .prob .timer-pledge { color: var(--mut); font-style: italic; font-size: 12px; margin: var(--s-3) 0 0; line-height: 1.4; }

    .prob .conf-row { display: flex; gap: 8px; justify-content: space-between; margin: var(--s-3) 0; }
    .prob .conf-dot {
      flex: 1; height: 42px; border-radius: 10px;
      border: 2px solid var(--line2); background: var(--paper); cursor: pointer;
      font: 700 14px/1 var(--font-sans); color: var(--mut);
      transition: all var(--dur-fast) var(--ease);
    }
    .prob .conf-dot:hover { border-color: var(--blue); color: var(--blue); transform: translateY(-2px); }
    .prob .conf-dot.active { background: var(--blue); border-color: var(--blue); color: #fff; transform: translateY(-2px); box-shadow: 0 4px 14px rgba(59,100,246,.3); }
    .prob .conf-note { color: var(--mut); font-size: 11px; margin: 0; font-style: italic; line-height: 1.4; }
    .prob .conf-growth { margin-top: var(--s-3); }
    .prob .growth-pill {
      background: var(--blue-soft); color: var(--blue); font-size: 11px; font-weight: 600;
      padding: 8px 12px; border-radius: 8px; text-align: center;
    }

    /* Mark-solved locked state (prevents double-bank). */
    .prob #btn-solved.locked {
      background: transparent; color: var(--mut); border: 1px solid var(--line2);
      cursor: not-allowed; opacity: 1;
    }
    .prob #btn-solved.locked:hover { background: transparent; transform: none; box-shadow: none; }

    @media (max-width: 960px) {
      .prob .prob-grid { grid-template-columns: 1fr; }
      .prob .prob-hero { grid-template-columns: 1fr; }
      .prob .prob-hero-side { align-items: flex-start; width: 100%; }
    }

    /* ===== Dark-mode polish — swap neon blue → brand gold throughout the Problem page ===== */
    :root[data-theme="dark"] .prob .back-link { color: var(--gold); }
    :root[data-theme="dark"] .prob .chip.pattern,
    :root[data-theme="dark"] .prob .chip.status.review {
      background: var(--gold-soft); color: var(--gold);
    }
    :root[data-theme="dark"] .prob .prob-link-wrap:focus-within {
      border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold-soft);
    }
    :root[data-theme="dark"] .prob .prob-link-open {
      color: var(--gold);
    }
    :root[data-theme="dark"] .prob .prob-link-open:hover {
      background: var(--gold); color: var(--ink);
    }
    :root[data-theme="dark"] .prob textarea:focus,
    :root[data-theme="dark"] .prob textarea.code-pad:focus {
      border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold-soft);
    }
    /* Confidence dots in gold */
    :root[data-theme="dark"] .prob .conf-dot:hover {
      border-color: var(--gold); color: var(--gold);
    }
    :root[data-theme="dark"] .prob .conf-dot.active {
      background: var(--gold); border-color: var(--gold); color: var(--ink);
      box-shadow: 0 4px 14px rgba(240,184,51,.3);
    }
    :root[data-theme="dark"] .prob .growth-pill {
      background: var(--gold-soft); color: var(--gold);
    }
    /* Focus timer ring — subtle gold instead of neon blue */
    :root[data-theme="dark"] .prob #ring-arc { stroke: var(--gold); }
  </style>
  `;
}
