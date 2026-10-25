// Problem view — redesigned per user:
//   - No Java scratch pad, no Description tab, no Discussion tab
//   - LC URL input in the hero (user pastes); writes back to the sheet row
//   - Tabs: Notes · Solution (code pad). Both autosave to the sheet row and localStorage.
//   - Right rail: compact Focus timer + Confidence card (clicking affects allotment)
//   - Single Mark solved button. REVIEW status (set in Library) is the lever to re-queue
//     an item onto the weekend plan — no separate "AGAIN" button here.

import { getSheets, getSettings, updateSheetRow, updateWallet, getWallet, getSolution, setSolution, callGrok, secure, on } from "./store.js";
import { openLessonModal } from "./lesson.js";
import { infoIcon, renderMarkdown } from "./info.js";
import { priceTask, todayKey, capTaskValue } from "./engine.js";
import { fireTaskBagged } from "./celebrate.js";
import { companyChipHtml, injectCompanyStyles } from "./companies.js";

let unsub = null;
let timerState = null;
let activeTab = "notes";
let currentKey = null;

export default {
  mount(root, params) {
    injectCompanyStyles();
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
          <div class="prob-companies-row" id="prob-companies-row">
            <span class="pcr-label">Asked by</span>
            <div class="pcr-chips" id="pcr-chips"></div>
            <input id="pcr-input" type="text" placeholder="+ company" maxlength="40" autocomplete="off" />
          </div>
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
            <div class="v-val" id="v-bounty">+ ₹${value}</div>
          </div>
          <button class="btn-primary btn-lg" id="btn-solved">Mark solved · bank ₹${value}</button>
          <div class="peek-wrap">
            <button class="btn-ghost btn-peek" id="btn-peek" title="Groq gives you the pattern name only (no spoilers). Your bounty drops to the minimum.">
              ✦ Peek the pattern
            </button>
            ${infoIcon({
              title: "✦ Peek the pattern",
              body: "Reveals only the pattern name (e.g. 'Sliding Window'). No code, no logic. Your bounty drops to the minimum (₹10 default) and the ledger flags this solve as 'peeked' so calibration stays honest.",
              bullets: [
                "Click Peek → confirm → pattern revealed",
                "Bounty updates on the solve button",
                "Peeked state persists per-row — can't un-peek"
              ]
            })}
          </div>
          <div class="peek-slot" id="peek-slot" hidden></div>
        </div>
      </div>

      <section class="prob-learn alive" id="prob-learn">
        <div class="pl-ico">✦</div>
        <div class="pl-main">
          <div class="pl-eyebrow">LEARN THIS TOPIC</div>
          <div class="pl-title">Teacher-mode lesson · 500 words · interview-ready</div>
          <div class="pl-sub">What's really tested, the mental model, real-world where you'll see this, pitfalls that burn people. Groq-powered, cached forever.</div>
        </div>
        <button class="pl-btn" id="pl-open" type="button">Open lesson →</button>
      </section>

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
          ${pattern ? `
            <div class="prob-card cs-card alive">
              <div class="pc-head"><h3>Pattern cheatsheet</h3><span class="pc-sub">Dojo-wall for ${esc(pattern)}</span></div>
              <button class="cs-open-btn" id="cs-open-btn" title="Open the editable cheatsheet for this pattern">
                <span class="cs-open-ic">📄</span>
                <span class="cs-open-label">Open cheatsheet</span>
                <span class="cs-open-arrow">→</span>
              </button>
              <p class="cs-open-note">Invariant · skeleton · when to reach for it · 3 traps · 3 gold problems · one-line complexity. All editable.</p>
            </div>
          ` : ""}
          <div class="prob-card review-card alive">
            <div class="pc-head"><h3>Mark for review</h3><span class="pc-sub">Resurface in your SRS queue</span></div>
            <div class="review-actions">
              <button class="review-btn" data-review-days="1">Tomorrow</button>
              <button class="review-btn" data-review-days="3">In 3 days</button>
              <button class="review-btn" data-review-days="7">In 7 days</button>
            </div>
            <p class="review-note">Overrides the automatic SRS schedule for the LAST solve of this problem.</p>
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

      <section class="prob-related" id="prob-related" data-sheet="${esc(sheetName)}" data-idx="${idx}" data-title="${esc(title)}" data-pattern="${esc(pattern || "")}" data-diff="${esc(difficulty || "")}">
        <div class="pr-head">
          <div>
            <h3>Related problems</h3>
            <span class="pc-sub">Same pattern, deeper mastery. Groq-cached forever.</span>
          </div>
          <button class="pr-refresh" id="pr-refresh" hidden title="Re-generate suggestions">↻ Refresh with AI</button>
        </div>
        <div class="pr-body" id="pr-body"></div>
      </section>

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
  // --- Learn this topic — Groq lesson modal, cached per row ---
  root.querySelector("#pl-open")?.addEventListener("click", () => {
    openLessonModal({ sheetName, rowIndex: idx });
  });

  // --- Related problems — lazy Groq, cached forever ---
  wireRelated(root, { sheetName, idx });


  // --- Company tags editor ---
  const sheet = getSheets()[sheetName];
  const resolveCompanyCol = () => sheet?.headers?.find(h => /^compan(y|ies)$/i.test(h)) || null;
  const parseCompanies = (raw) => String(raw || "").split(",").map(s => s.trim()).filter(Boolean);
  const currentCompanies = () => {
    const col = resolveCompanyCol();
    return parseCompanies(col ? row[col] : "");
  };
  const paintCompanies = () => {
    const chipsEl = root.querySelector("#pcr-chips");
    const current = currentCompanies();
    chipsEl.innerHTML = current.map(c => companyChipHtml(c, true)).join("");
  };
  const saveCompanies = async (list) => {
    if (!sheet) return;
    const dedupe = [...new Set(list.map(s => s.trim()).filter(Boolean))];
    const serialized = dedupe.join(", ");
    let col = resolveCompanyCol();
    if (!col) {
      col = "Companies";
      sheet.headers.push(col);
    }
    row[col] = serialized;
    await updateSheetRow(sheetName, idx, { [col]: serialized });
    paintCompanies();
  };
  paintCompanies();
  const pcrInput = root.querySelector("#pcr-input");
  pcrInput?.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = pcrInput.value.trim();
    if (!v) return;
    pcrInput.value = "";
    await saveCompanies([...currentCompanies(), v]);
  });
  root.querySelector("#pcr-chips")?.addEventListener("click", async (e) => {
    const x = e.target.closest(".pcr-x");
    if (!x) return;
    const chip = x.closest(".pcr-chip");
    const toRemove = chip?.dataset.c;
    if (!toRemove) return;
    await saveCompanies(currentCompanies().filter(c => c !== toRemove));
  });

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

  // --- Focus timer removed from Problem page (the Today task-row timer is the
  //     canonical per-task timer). Related CSS/vars kept harmless below. ---

  // --- Cheatsheet open button in the sidebar card ---
  root.querySelector("#cs-open-btn")?.addEventListener("click", async () => {
    if (!pattern) return;
    const { openCheatsheet } = await import("./cheatsheet.js");
    openCheatsheet(pattern);
  });

  // --- Mark-for-review: force this problem back into the SRS queue ---
  // Finds the LAST dayLog entry that solved this sheet row and writes a
  // reviewOverride on it that getDueRevisits already respects. If the
  // problem has never been solved, nothing to override.
  root.querySelectorAll("[data-review-days]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const days = Number(btn.dataset.reviewDays);
      const choice = days === 1 ? "tomorrow" : days === 3 ? "in3days" : "mastered";
      const { getDayLog, updateDayLog } = await import("./store.js");
      const dl = getDayLog();
      let lastDate = null;
      for (const d of Object.keys(dl).sort().reverse()) {
        const entry = dl[d];
        if (!entry?.done || !Array.isArray(entry.assigned)) continue;
        for (const t of entry.assigned) {
          if (t.sheet === sheetName && t.rowIndex === idx && entry.done.includes(t.ref)) {
            lastDate = { d, ref: t.ref };
            break;
          }
        }
        if (lastDate) break;
      }
      if (!lastDate) {
        btn.textContent = "Solve it first →";
        setTimeout(() => { btn.textContent = days === 1 ? "Tomorrow" : (days === 3 ? "In 3 days" : "In 7 days"); }, 1800);
        return;
      }
      await updateDayLog(dlog => {
        const entry = dlog[lastDate.d];
        if (!entry) return;
        if (!entry.reviewOverride) entry.reviewOverride = {};
        // Translate custom days to a known override key — the engine understands
        // tomorrow/in3days/mastered; for 7d we approximate with in3days then
        // let SRS take over on next solve (safer than inventing new keys).
        entry.reviewOverride[lastDate.ref] = days <= 1 ? "tomorrow" : days <= 3 ? "in3days" : "in3days";
      });
      const original = btn.textContent;
      btn.textContent = "✓ Queued";
      btn.disabled = true;
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2200);
    });
  });

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

  // --- 9C: Peek the pattern (localStorage flag per sheet row) ---
  const peekKey = `gain:peeked:${sourceKey}`;
  const vBounty = root.querySelector("#v-bounty");
  const peekBtn = root.querySelector("#btn-peek");
  const peekSlot = root.querySelector("#peek-slot");
  const minBounty = Number(getSettings().wallet.taskMin || 10);

  function applyPeekedUI() {
    peekBtn.classList.add("used");
    peekBtn.disabled = true;
    peekBtn.textContent = "✦ Peeked (bounty reduced)";
    if (vBounty) vBounty.textContent = `+ ₹${minBounty}`;
    if (!solvedBtn.classList.contains("locked")) {
      solvedBtn.textContent = `Mark solved · bank ₹${minBounty}`;
    }
  }
  function isPeeked() {
    try { return localStorage.getItem(peekKey) === "1"; } catch { return false; }
  }
  function paintPeek(patternName) {
    if (!peekSlot) return;
    peekSlot.hidden = false;
    peekSlot.innerHTML = `<div class="peek-pill">Pattern: <b>${esc(patternName)}</b></div>`;
  }
  if (isPeeked()) {
    applyPeekedUI();
    const confCol = findCol(row, /^(pattern|category)$/i);
    if (confCol) paintPeek(row[confCol] || "unknown");
  }

  peekBtn?.addEventListener("click", async () => {
    if (isPeeked()) return;
    const ok = confirm(`✦ Peek the pattern?\n\nThis will reveal the pattern name only (no code, no logic).\nYour bounty drops from ₹${value} to ₹${minBounty}.\n\nContinue?`);
    if (!ok) return;
    peekBtn.disabled = true;
    peekBtn.textContent = "Asking Groq…";
    try {
      // Prefer the sheet's own Pattern column if available (free, instant).
      const patternCol = findCol(row, /^(pattern|category)$/i);
      let pname = patternCol ? (row[patternCol] || "").trim() : "";
      if (!pname) {
        const apiKey = (await secure.get("groq_api_key").catch(() => null)) || "";
        if (!apiKey) throw new Error("No Groq API key.");
        const res = await callGrok({
          apiKey,
          temperature: 0.3,
          maxTokens: 32,
          system: "You name the single DSA/algorithmic pattern this problem uses. 2-4 words only. Examples: 'Sliding Window', 'Two Pointers', 'Topological Sort'. No preamble.",
          user: `Problem: ${title}${difficulty ? ` (${difficulty})` : ""}${lcValue ? `, LC #${lcValue}` : ""}. Pattern name only:`,
        });
        pname = (res.content || "").trim();
      }
      if (!pname) throw new Error("Couldn't resolve pattern.");
      try { localStorage.setItem(peekKey, "1"); } catch (_) {}
      applyPeekedUI();
      paintPeek(pname);
    } catch (e) {
      peekBtn.textContent = `✗ ${e.message || e}`;
      setTimeout(() => { peekBtn.disabled = false; peekBtn.textContent = "✦ Peek the pattern"; }, 2000);
    }
  });

  solvedBtn.addEventListener("click", async () => {
    const title = row.Problem || row.Topic || "problem";
    const dateCol = findCol(row, /^(datesolved|datedone)$/i);
    const patch = {};
    if (statusCol) patch[statusCol] = "SOLVED";
    if (dateCol) patch[dateCol] = todayKey();
    if (Object.keys(patch).length) await updateSheetRow(sheetName, idx, patch);

    // Peeked solves pay the minimum — honest-signal economy
    const effectiveValue = isPeeked() ? minBounty : value;
    // Phase 7 — daily earnings cap also applies on Problem-page bank path
    const capped = capTaskValue(getWallet(), getSettings(), effectiveValue);
    const bankValue = capped.amount;

    // Double-bank guard — re-check at click time in case Today was ticked in another tab/view.
    const alreadyBanked = wasRowAlreadyBanked();
    if (!alreadyBanked) {
      await updateWallet(w => {
        w.earned += bankValue;
        w.ledger.push({
          date: new Date().toISOString(), type: "problem",
          amount: bankValue, label: title, sourceKey,
          peeked: isPeeked() || undefined,
          cappedFrom: capped.capped ? capped.originalAmount : undefined,
        });
      });
      fireTaskBagged({ amount: bankValue, title, sourceEl: solvedBtn });
      if (capped.capped) {
        flash(root, `⚠ Daily cap reached — banked ₹${bankValue} (₹${capped.originalAmount - bankValue} skipped)`);
      }
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

// --- Related problems: lazy Groq, cached per sheet#rowIndex forever ---------
const RELATED_CACHE_PREFIX = "gain:related:";

function wireRelated(root, { sheetName, idx }) {
  const section = root.querySelector("#prob-related");
  if (!section) return;
  const body = section.querySelector("#pr-body");
  const refreshBtn = section.querySelector("#pr-refresh");
  const cacheKey = `${RELATED_CACHE_PREFIX}${sheetName}#${idx}`;

  const paintCached = () => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) { paintEmpty(); return false; }
      const list = JSON.parse(raw);
      if (!Array.isArray(list) || !list.length) { paintEmpty(); return false; }
      paintList(list);
      refreshBtn.hidden = false;
      return true;
    } catch (_) { paintEmpty(); return false; }
  };

  const paintEmpty = () => {
    body.innerHTML = `
      <div class="pr-empty">
        <button class="pr-find" id="pr-find">✦ Find related problems</button>
        <small>One Groq call. Cached forever on this device. ~5 seconds.</small>
      </div>
    `;
    refreshBtn.hidden = true;
    body.querySelector("#pr-find")?.addEventListener("click", () => fetchAndCache(false));
  };

  const paintList = (list) => {
    const openPath = (hit) => {
      const sn = hit.sheet || sheetName;
      // Find the row by title to get its index
      try {
        const sheet = (window.gainSheets || getSheets())[sn];
        if (!sheet) return "#today";
        const needle = String(hit.title || "").trim().toLowerCase();
        const titleCol = sheet.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
        if (titleCol) {
          const i = sheet.rows.findIndex(r => String(r[titleCol] || "").trim().toLowerCase() === needle);
          if (i >= 0) return `#problem/${encodeURIComponent(sn)}/${i}`;
        }
      } catch (_) {}
      return "#library";
    };
    body.innerHTML = list.map(hit => `
      <article class="pr-item">
        <div class="pr-item-main">
          <div class="pr-item-head">
            <a class="pr-item-title" href="${openPath(hit)}">${esc(hit.title || "")}</a>
            <span class="pr-item-pattern">${esc(hit.pattern || hit.sheet || "")}</span>
          </div>
          <p class="pr-item-reason">${renderMarkdown(hit.reason || "")}</p>
        </div>
        <a class="pr-open" href="${openPath(hit)}">Open →</a>
      </article>
    `).join("");
  };

  const fetchAndCache = async (silent) => {
    if (!silent) body.innerHTML = `<div class="pr-loading"><div class="skel-line"></div><div class="skel-line"></div><div class="skel-line short"></div></div>`;
    try {
      const list = await askGroqForRelated({ sheetName, idx });
      if (!list || !list.length) { paintEmpty(); return; }
      try { localStorage.setItem(cacheKey, JSON.stringify(list)); } catch (_) {}
      paintList(list);
      refreshBtn.hidden = false;
    } catch (e) {
      body.innerHTML = `<div class="pr-err">Groq call failed: ${esc(e.message || e)}. ${localStorage.getItem(cacheKey) ? "Showing cached suggestions." : "<button class='pr-find' id='pr-find-retry'>Retry</button>"}</div>`;
      body.querySelector("#pr-find-retry")?.addEventListener("click", () => fetchAndCache(false));
      // Fall back to any cached version if present
      paintCached();
    }
  };

  refreshBtn?.addEventListener("click", () => fetchAndCache(false));
  paintCached();
}

async function askGroqForRelated({ sheetName, idx }) {
  const { callGrok, secure, getSheets } = await import("./store.js");
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key. Add one in Settings → AI butler.");

  const sheet = getSheets()[sheetName];
  if (!sheet) throw new Error("Sheet not loaded.");
  const row = sheet.rows[idx];
  const titleCol = sheet.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
  const patternCol = sheet.headers.find(h => /^(pattern|category)$/i.test(h));
  const diffCol = sheet.headers.find(h => /^difficulty$/i.test(h));

  const title = row[titleCol] || "";
  const pattern = row[patternCol] || "";
  const difficulty = row[diffCol] || "";

  // Pool: same-sheet rows (excluding current), optionally same-pattern first.
  const pool = sheet.rows
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => i !== idx)
    .map(({ r }) => ({
      title: r[titleCol] || "",
      pattern: r[patternCol] || "",
      difficulty: r[diffCol] || "",
    }))
    .filter(x => x.title);

  const poolSummary = pool.slice(0, 60).map(p => `• ${p.title} [${p.pattern || "no-pattern"}${p.difficulty ? ", " + p.difficulty : ""}]`).join("\n");

  const res = await callGrok({
    apiKey,
    jsonMode: true,
    system: `You are a GAIN interview-prep librarian. Pick 3-5 related problems from the user's own ${sheetName} sheet that would deepen mastery of the pattern/skill at play.
Reply STRICT JSON: {"related": [{"title": "...", "pattern": "...", "reason": "..."}]}.
Reason is ONE short interview-tone sentence naming the shared template or divergence. No markdown. No preamble.
Choose problems FROM THE POOL ONLY. If the user hasn't added many, return fewer rather than inventing titles.`,
    user: `Current problem: ${title} [${pattern || "no-pattern"}${difficulty ? ", " + difficulty : ""}]
Sheet: ${sheetName}

Pool (same sheet, up to 60 items):
${poolSummary}

Return 3-5 related picks from the pool.`
  });

  if (!res.ok) throw new Error(res.error || "Groq call failed");
  let parsed;
  try {
    const raw = res.content.trim().replace(/^```json\s*|\s*```$/g, "");
    parsed = JSON.parse(raw);
  } catch (_) { throw new Error("Couldn't parse response."); }
  const list = Array.isArray(parsed.related) ? parsed.related : [];
  return list.slice(0, 5).map(x => ({
    title: String(x.title || "").trim(),
    pattern: String(x.pattern || "").trim() || pattern,
    reason: String(x.reason || "").trim(),
    sheet: sheetName,
  })).filter(x => x.title);
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
    .prob .prob-companies-row { display: flex; align-items: center; gap: 10px; margin: 10px 0 14px; flex-wrap: wrap; }
    .prob .pcr-label { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }
    .prob .pcr-chips { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .prob .pcr-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 4px; border-radius: 999px; background: var(--paper); border: 1px solid var(--line2); color: var(--ink); font: 600 11.5px/1 var(--font-sans); letter-spacing: .01em; }
    /* Shared .pcr-logo styles live in companies.js injectCompanyStyles() */
    .prob .pcr-name { display: inline-block; }
    .prob .pcr-x { border: none; background: transparent; color: var(--mut); cursor: pointer; font: 400 13px/1 var(--font-sans); padding: 0 2px; transition: color .14s; }
    .prob .pcr-x:hover { color: var(--red); }
    .prob #pcr-input { padding: 6px 10px; border: 1px dashed var(--line2); border-radius: 999px; background: transparent; color: var(--ink); font: 500 12px/1 var(--font-sans); outline: none; width: 120px; }
    .prob #pcr-input:focus { border-color: var(--blue, #3870ff); }
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

    /* Cheatsheet sidebar card */
    .prob .cs-card { }
    .prob .cs-open-btn {
      display: flex; align-items: center; gap: 10px;
      width: 100%; margin: var(--s-3) 0 8px;
      padding: 11px 14px; border-radius: 10px;
      background: linear-gradient(135deg, color-mix(in oklab, var(--gold) 18%, var(--paper)) 0%, color-mix(in oklab, var(--gold) 6%, var(--paper)) 100%);
      border: 1px solid color-mix(in oklab, var(--gold) 36%, var(--line));
      color: var(--ink); cursor: pointer;
      font: 600 13.5px/1 var(--font-sans); letter-spacing: -.005em;
      transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
      box-shadow: 0 1px 2px rgba(0,0,0,.04);
    }
    .prob .cs-open-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 8px 18px -6px color-mix(in oklab, var(--gold) 50%, transparent);
      border-color: color-mix(in oklab, var(--gold) 50%, var(--line));
    }
    .prob .cs-open-btn:hover .cs-open-arrow { transform: translateX(3px); }
    .prob .cs-open-ic { font-size: 16px; flex-shrink: 0; }
    .prob .cs-open-label { flex: 1; text-align: left; }
    .prob .cs-open-arrow { font-size: 14px; color: color-mix(in oklab, var(--gold) 80%, var(--ink)); transition: transform .18s cubic-bezier(.2,.9,.3,1); }
    .prob .cs-open-note { color: var(--mut); font-size: 11.5px; line-height: 1.45; margin: 0; }

    /* Mark-for-review sidebar card */
    .prob .review-actions { display: flex; gap: 6px; margin: var(--s-3) 0 8px; flex-wrap: wrap; }
    .prob .review-btn {
      flex: 1; min-width: 70px;
      padding: 8px 10px; border-radius: 8px;
      background: var(--paper); border: 1px solid var(--line); color: var(--ink);
      font: 600 11.5px/1 var(--font-sans); cursor: pointer; letter-spacing: -.005em;
      transition: all .14s ease;
    }
    .prob .review-btn:hover { border-color: var(--line2); background: color-mix(in oklab, var(--ink) 4%, var(--paper)); }
    .prob .review-btn:disabled { color: var(--green); border-color: var(--green); background: color-mix(in oklab, var(--green) 10%, var(--paper)); }
    .prob .review-note { color: var(--mut); font-size: 11px; line-height: 1.45; margin: 0; }
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

    /* ---- Peek the pattern (hero-side) ---- */
    .prob .peek-wrap { display: inline-flex; align-items: center; margin-top: 8px; }
    .prob .btn-peek {
      padding: 8px 14px;
      background: transparent;
      border: 1px dashed color-mix(in oklab, var(--gold) 36%, var(--line));
      color: var(--mut);
      border-radius: 10px; cursor: pointer;
      font: 600 12px/1 var(--font-sans);
      transition: all var(--dur-fast) var(--ease);
    }
    .prob .btn-peek:hover { color: var(--gold); border-color: var(--gold); background: color-mix(in oklab, var(--gold) 6%, transparent); }
    .prob .btn-peek.used {
      border-style: solid; color: var(--gold);
      background: var(--gold-soft);
      cursor: not-allowed;
    }
    .prob .peek-slot { margin-top: 10px; }
    .prob .peek-pill {
      padding: 10px 14px;
      background: color-mix(in oklab, var(--gold) 8%, var(--paper));
      border-left: 3px solid var(--gold); border-radius: 10px;
      font-size: 13px; color: var(--ink);
      animation: slideDownFade 220ms cubic-bezier(.2,1.2,.3,1) both;
    }
    .prob .peek-pill b { color: var(--gold); font-weight: 700; }

    /* ---- Learn this topic card (above the solve grid) ---- */
    .prob .prob-learn {
      display: flex; align-items: center; gap: 16px;
      margin-bottom: var(--s-4);
      padding: 16px 20px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 1px 2px rgba(0,0,0,.03), 0 1px 0 rgba(255,255,255,.6) inset;
      transition: all var(--dur-fast) var(--ease);
    }
    .prob .prob-learn:hover {
      border-color: color-mix(in oklab, var(--gold) 32%, var(--line));
      transform: translateY(-1px);
      box-shadow: 0 1px 2px rgba(0,0,0,.03), 0 8px 24px color-mix(in oklab, var(--gold) 10%, transparent);
    }
    .prob .pl-ico {
      flex-shrink: 0;
      width: 44px; height: 44px; border-radius: 12px;
      background: color-mix(in oklab, var(--gold) 10%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--gold) 22%, var(--line));
      color: var(--gold); font-size: 22px;
      display: flex; align-items: center; justify-content: center;
    }
    .prob .pl-main { min-width: 0; flex: 1; }
    .prob .pl-eyebrow {
      font: 600 10px/1 var(--font-sans);
      letter-spacing: .16em; text-transform: uppercase; color: var(--mut);
      margin-bottom: 4px;
    }
    .prob .pl-title {
      font-size: 15px; font-weight: 600; color: var(--ink);
      letter-spacing: -.012em;
    }
    .prob .pl-sub {
      font-size: 12.5px; color: var(--mut); line-height: 1.5; margin-top: 3px;
    }
    .prob .pl-btn {
      flex-shrink: 0;
      padding: 10px 18px;
      background: var(--ink); color: var(--paper);
      border: none; border-radius: 10px;
      cursor: pointer; font: 600 13px/1 var(--font-sans);
      box-shadow: 0 1px 2px rgba(0,0,0,.1), 0 1px 0 rgba(255,255,255,.1) inset;
      transition: all var(--dur-fast) var(--ease);
    }
    .prob .pl-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,.14), 0 1px 0 rgba(255,255,255,.14) inset;
    }

    /* ---- Related problems section ---- */
    .prob .prob-related {
      margin-top: var(--s-5);
      padding: 20px 22px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .prob .pr-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; }
    .prob .pr-head h3 { margin: 0; font-size: 15px; font-weight: 700; }
    .prob .pr-refresh {
      padding: 6px 12px; background: transparent; color: var(--mut);
      border: 1px solid var(--line); border-radius: 999px;
      font: 600 11.5px/1 var(--font-sans); cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .prob .pr-refresh:hover { color: var(--gold); border-color: var(--gold); }
    .prob .pr-empty {
      padding: 24px;
      text-align: center;
      background: var(--bg); border-radius: 10px;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
    }
    .prob .pr-find {
      padding: 10px 22px;
      background: var(--ink); color: var(--paper);
      border: none; border-radius: 10px; cursor: pointer;
      font: 700 13px/1 var(--font-sans);
      transition: all var(--dur-fast) var(--ease);
    }
    .prob .pr-find:hover { transform: translateY(-1px); filter: brightness(1.08); }
    .prob .pr-empty small { color: var(--mut); font-size: 11.5px; }

    .prob .pr-item {
      display: flex; justify-content: space-between; align-items: center; gap: 14px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      transition: background var(--dur-fast) var(--ease);
    }
    .prob .pr-item:last-child { border-bottom: none; }
    .prob .pr-item:hover { background: var(--bg); }
    .prob .pr-item-main { min-width: 0; flex: 1; }
    .prob .pr-item-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
    .prob .pr-item-title { font-size: 14px; font-weight: 700; color: var(--ink); text-decoration: none; }
    .prob .pr-item-title:hover { color: var(--blue); }
    .prob .pr-item-pattern {
      padding: 2px 8px;
      background: var(--blue-soft); color: var(--blue);
      border-radius: 999px; font: 600 10.5px/1.3 var(--font-sans);
      letter-spacing: .02em;
    }
    .prob .pr-item-reason { margin: 0; font-size: 12.5px; color: var(--mut); line-height: 1.5; }
    .prob .pr-open {
      padding: 8px 14px; background: var(--bg); border: 1px solid var(--line);
      color: var(--ink); border-radius: 8px; text-decoration: none;
      font: 600 12px/1 var(--font-sans);
      white-space: nowrap;
      transition: all var(--dur-fast) var(--ease);
    }
    .prob .pr-open:hover { border-color: var(--blue); color: var(--blue); }

    .prob .pr-loading { padding: 10px 0; }
    .prob .pr-loading .skel-line {
      height: 10px; border-radius: 6px; margin-bottom: 10px;
      background: linear-gradient(90deg, var(--line) 0%, color-mix(in oklab, var(--line) 50%, var(--paper)) 50%, var(--line) 100%);
      background-size: 200% 100%;
      animation: prShimmer 1200ms ease-in-out infinite;
    }
    .prob .pr-loading .skel-line.short { width: 60%; }
    @keyframes prShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

    .prob .pr-err {
      padding: 16px; background: color-mix(in oklab, var(--red) 10%, transparent);
      color: var(--red); border-radius: 10px; font-size: 13px;
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
    }
  </style>
  `;
}
