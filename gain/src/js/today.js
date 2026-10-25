// Today screen — hero + motivation + Today's plan card (tick → bank ₹).
// Daily engine lives in engine.js; full celebration + add-task in Part 3.

import { getSettings, getSheets, getDayLog, updateWallet, getWallet, on, getMotivations, updateSheetRow } from "./store.js";
import { ensureDailyPlan, tickTask, untickTask, todayKey, calendarKey, activeKey, nextDayKey, hoursToRollover, isGreenWeek, isGreenMonth, wasWeekFired, wasMonthFired, markWeekFired, markMonthFired, setConfidence, getConfidence, setReviewOverride, getReviewOverride, capTaskValue, maybeFirePerfectWeek, carryOverUnfinished, priceTask } from "./engine.js";
import { tryOpenRecap } from "./recap.js";
import { ensureWarmupTask, openWarmupQuiz } from "./warmup.js";
import { openLessonModal } from "./lesson.js";
import { openSuggestModal } from "./suggest.js";
import { infoIcon } from "./info.js";
import { fireDaySecured, fireWeekGodly, fireMonthLegend, fireTaskBagged } from "./celebrate.js";

function pickRandom() {
  const pool = getMotivations();
  if (!pool.length) return "Open the sheet. Then open the problem.";
  return pool[Math.floor(Math.random() * pool.length)];
}

let unsub = null;
let quoteTimer = null;

export default {
  async mount(root) {
    const s = getSettings();
    const sheets = getSheets();
    const dsa = sheets["DSA"] || { rows: [] };
    const sd  = sheets["System Design"] || { rows: [] };
    const int = sheets["Integrations"] || { rows: [] };
    const total = dsa.rows.length + sd.rows.length + int.rows.length;

    // Ensure both the real-today and (if today is complete) tomorrow's plan exist
    // so the Today view flips to tomorrow instantly after the last tick.
    await ensureDailyPlan(todayKey());
    if (activeKey() !== todayKey()) await ensureDailyPlan(activeKey());
    // Phase 8 — carry over any undone tasks from yesterday (debounced per-day)
    await carryOverUnfinished(todayKey());
    // Warm-up quiz slot — first row of today's plan, Groq-generated from yesterday
    await ensureWarmupTask(todayKey());
    await ensureWarmupTask(activeKey());

    const dateStr = new Date().toLocaleDateString(undefined, {
      weekday: "short", day: "2-digit", month: "short"
    }).toUpperCase();
    const honest = honestLine();

    root.innerHTML = render({ dateStr, honest, total, dsa, sd, int, s });
    paintPlan(root);
    attachHandlers(root);
    startQuoteRotation(root);

    // live-refresh when wallet/dayLog/settings change
    if (unsub) unsub();
    unsub = on((ev) => {
      if (ev === "dayLog" || ev === "wallet" || ev === "sheet") paintPlan(root);
      if (ev === "motivations") startQuoteRotation(root);
      if (ev === "settings") {
        const sNow = getSettings();
        const titleEl = root.querySelector(".focus-sub");
        if (titleEl) titleEl.textContent = `Target: ${sNow.profile.targetRole} · by ${sNow.profile.targetDate}`;
      }
    });
  },
  unmount() {
    if (unsub) { unsub(); unsub = null; }
    if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; }
  }
};

function startQuoteRotation(root) {
  if (quoteTimer) clearInterval(quoteTimer);
  const paintQuote = () => {
    const el = root.querySelector("#today-quote");
    if (!el) return;
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => {
      el.textContent = `${pickRandom()}`;
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    }, 300);
  };
  paintQuote();
  quoteTimer = setInterval(paintQuote, 20000);
}

function render({ dateStr, honest, q1, q2, total, dsa, sd, int, s }) {
  return `
    <div class="view-inner today">
      <div class="hero-eyebrow">${dateStr}</div>
      <h1 class="hero-title">Make today count.</h1>
      <p class="hero-sub">Small, focused sessions. Real progress over time.</p>
      <!-- honest-pill removed per user request -->


      <!-- Today motivation — a cinematic scroll (different design from the Shop banner) -->
      <div class="today-mote alive">
        <div class="tm-rail">
          <span class="tm-notch"></span>
          <span class="tm-glyph">道</span>
          <span class="tm-tag">THE WAY · ONE LINE A DAY</span>
        </div>
        <blockquote class="tm-body">
          <span class="tm-mark-open">“</span>
          <span class="tm-quote" id="today-quote">—</span>
          <span class="tm-mark-close">”</span>
        </blockquote>
        <div class="tm-seal" title="Rotates every 20s">⟡</div>
      </div>

      <div class="main-grid">
        <section class="plan-wrap">
          <div class="plan-card alive" id="plan-card">
            <div class="plan-dots"><span></span><span></span><span></span></div>
            <div class="plan-head">
              <div>
                <h2 class="plan-title">
                  <span id="plan-title-text">Today's plan</span>
                  <button class="hist-btn" id="hist-btn" title="View a past day">📅</button>
                </h2>
                <p class="plan-sub" id="plan-sub">Loading…</p>
              </div>
              <div class="plan-meta">
                <div class="rollover-tag" id="rollover-tag" title="GAIN days end at 7 PM IST — finish before then or the day isn't banked.">
                  <span class="rt-icon">⏱</span>
                  <span class="rt-time" id="rt-time">—</span>
                  <small>to 7 PM IST</small>
                </div>
                <b id="plan-count">0 of 0 complete</b>
                <div class="plan-bar"><span id="plan-progress"></span></div>
              </div>
            </div>
            <div class="plan-rows" id="plan-rows"></div>
            <div class="suggest-row" id="suggest-row">
              <button class="suggest-btn" id="suggest-btn" title="Groq picks a question from your sheet based on today's progress">
                <span class="sb-ic">✦</span>
                <span class="sb-text">Suggest another task</span>
                <small class="sb-hint">Groq picks from your sheet</small>
              </button>
              <button class="recap-btn" id="recap-btn" title="Reopen today's end-of-day recap — stats, honest reflection, tomorrow focus">
                <span class="rb-ic">◷</span>
                <span class="rb-text">Review today's recap</span>
                <small class="rb-hint">Butler reflection anytime</small>
              </button>
              <div class="more-wrap">
                <button class="more-btn" id="more-btn" title="More actions" aria-haspopup="true" aria-expanded="false">⋯</button>
                <div class="more-pop" id="more-pop" hidden role="menu">
                  <button class="more-item" data-more="redo" role="menuitem">
                    <span class="mi-ic">↻</span>
                    <span class="mi-main">
                      <b>Add a REDO question</b>
                      <small>Weakest-confidence past solve, auto-picked</small>
                    </span>
                  </button>
                  <button class="more-item" data-more="lcpaste" role="menuitem">
                    <span class="mi-ic mi-ic-lc">LC</span>
                    <span class="mi-main">
                      <b>Paste a LeetCode URL</b>
                      <small>Groq extracts title + pattern + difficulty</small>
                    </span>
                  </button>
                  <button class="more-item" data-more="yrecap" role="menuitem">
                    <span class="mi-ic">◷</span>
                    <span class="mi-main">
                      <b>View yesterday's recap</b>
                      <small>Butler reflection + tomorrow focus from the day before</small>
                    </span>
                  </button>
                  <button class="more-item" data-more="todayrecap" role="menuitem">
                    <span class="mi-ic">✦</span>
                    <span class="mi-main">
                      <b>Review today's recap</b>
                      <small>Even if the end-of-day modal already fired, reopen it</small>
                    </span>
                  </button>
                </div>
              </div>
            </div>
            <div class="add-row">
              <button class="plus" id="add-task-toggle" aria-label="Task options" aria-expanded="false" title="Options · minutes, bounty, kind, status">+</button>
              <div class="add-input-wrap">
                <div class="add-pickchip" id="add-pickchip" hidden></div>
                <input id="add-task-input" placeholder="Add a one-off task for today…" autocomplete="off" />
                <div class="add-suggest" id="add-suggest" hidden></div>
              </div>
              <button class="icon-btn" id="add-task-btn" aria-label="Add">→</button>
            </div>
            <div class="add-row-ex" id="add-row-ex" hidden>
              <div class="add-field">
                <label>Kind</label>
                <select id="at-kind">
                  <option value="dsa" selected>DSA problem</option>
                  <option value="sql">SQL problem</option>
                  <option value="sd">System design</option>
                  <option value="int">Integration</option>
                  <option value="ext">Interview extra</option>
                  <option value="revision">Revision / quick</option>
                  <option value="log">Log / housekeeping</option>
                </select>
              </div>
              <div class="add-field">
                <label>Minutes</label>
                <input id="at-min" type="number" min="1" max="240" value="25" />
              </div>
              <div class="add-field">
                <label>Bounty ₹</label>
                <input id="at-value" type="number" min="1" max="500" value="30" />
              </div>
              <div class="add-field">
                <label>Status</label>
                <select id="at-status">
                  <option value="todo" selected>Not started</option>
                  <option value="done">Pre-marked done</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        <aside class="side-col">
          <div class="side-card">
            <h3>Session activity <span class="arrow">⋯</span></h3>
            <div class="activity-row">
              <div class="dot-blue"></div>
              <div style="flex:1;">
                <div class="act-t">Focused minutes today</div>
                <div class="act-s"><span id="min-focused">0 min</span><span id="min-range">—</span></div>
                <div class="mini-bar"><span id="min-bar" style="width:0%"></span></div>
              </div>
            </div>
            <div class="activity-row divider-top">
              <div class="doc-icon">📄</div>
              <div style="flex:1;">
                <div class="act-t">Reviewed <span id="rev-count">0</span> patterns</div>
                <div class="act-s"><span id="rev-names">Nothing yet — go earn it.</span></div>
              </div>
            </div>
          </div>

          <div class="side-card">
            <h3>Weekly consistency <span class="arrow">→</span></h3>
            <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:16px;">
              <div>
                <div class="bars" id="week-bars">${weekBars()}</div>
                <div class="bar-labels"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span></div>
              </div>
              <div style="text-align:right;">
                <b id="week-count" style="font-size:28px; font-weight:700;">0 / 5</b>
                <div style="color:var(--mut); font-size:12px;">days</div>
                <div style="color:var(--mut); font-size:11px; margin-top:6px;">Keep it up!</div>
              </div>
            </div>
          </div>

          <div class="side-card inventory">
            <h3>Inventory</h3>
            <div class="inv-row"><span>DSA</span><b>${dsa.rows.length}</b></div>
            <div class="inv-row"><span>System Design</span><b>${sd.rows.length}</b></div>
            <div class="inv-row"><span>Integrations</span><b>${int.rows.length}</b></div>
            <div class="inv-row total"><span>Total to master</span><b>${total}</b></div>
            <div class="focus-sub" style="margin-top:12px; color:var(--mut); font-size:12px;">
              Target: ${esc(s.profile.targetRole)} · by ${esc(s.profile.targetDate)}
            </div>
            <button class="btn-ghost" id="to-settings" style="margin-top:12px; width:100%;">Edit targets →</button>
          </div>
        </aside>
      </div>
    </div>
    ${styles()}
  `;
}

// Module state: if non-null, paintPlan shows this specific day (user navigated
// to a past day via the History dropdown). Null = use activeKey() normally.
let viewedOverride = null;
function currentKey() { return viewedOverride || activeKey(); }

function paintPlan(root) {
  const dateKey = currentKey();
  const day = getDayLog()[dateKey];
  if (!day) {
    if (viewedOverride) {
      // Nothing to show for the picked day — fall back to today
      viewedOverride = null;
      return paintPlan(root);
    }
    return;
  }

  const rowsEl = root.querySelector("#plan-rows");
  const subEl = root.querySelector("#plan-sub");
  const cntEl = root.querySelector("#plan-count");
  const prEl = root.querySelector("#plan-progress");
  const revCount = root.querySelector("#rev-count");
  const revNames = root.querySelector("#rev-names");

  if (!rowsEl) return;

  const totalTasks = day.assigned.length;
  const doneTasks = day.done.length;
  const pct = totalTasks ? Math.round(100 * doneTasks / totalTasks) : 0;

  rowsEl.innerHTML = day.assigned.map(t => {
    const done = day.done.includes(t.ref);
    const rating = done ? (day.confidence?.[t.ref] ?? null) : null;
    const needsRating = done && rating == null && t.kind !== "warmup";  // quiz doesn't rate
    const isRevisit = t.kind === "revisit";
    const isWarmup = t.kind === "warmup";
    const isNewStudy = ["dsa", "sd", "int", "ext", "sql"].includes(t.kind) && !isRevisit;
    const isSuggested = !!t.suggested;
    const isCarried = !!t.carried;
    const isWildcard = !!t.wildcard;
    const reviewOverride = day.reviewOverride?.[t.ref];
    // Show review-strip right after rating is captured, until user picks an override.
    const showReviewStrip = done && rating != null && !reviewOverride && t.sheet && t.rowIndex != null && !isWarmup;
    const kindPill = isWildcard
      ? `<span class="k-pill k-wildcard" title="Weakness-driven Wildcard — your weakest pattern's lowest-★ problem">🎲 WILDCARD</span>`
      : isCarried
        ? `<span class="k-pill k-carried" title="Rolled over from yesterday because it was undone at 7 PM IST">⤼ CARRIED</span>`
        : isRevisit
          ? `<span class="k-pill k-redo" title="Spaced-repetition revisit — lock memory in">↻ REDO</span>`
          : isSuggested
            ? `<span class="k-pill k-suggested" title="Groq-suggested task">✦ SUGGESTED</span>`
            : isNewStudy
              ? `<span class="k-pill k-new" title="New problem">✦ NEW</span>`
              : isWarmup
                ? `<span class="k-pill k-warmup" title="5-question Groq recall drill">⚡ WARM-UP</span>`
                : "";
    // Special warm-up card — gradient background, "Start →" instead of checkbox
    if (isWarmup) {
      const sourceText = done
        ? "Completed · brain primed"
        : `5 recall Qs · ${esc(t.sourceLabel || "yesterday's work")} · ~5 min`;
      return `
        <div class="task-row warmup alive ${done ? "done" : ""}" data-ref="${esc(t.ref)}">
          <div class="wu-card-ico"><span class="wu-bolt">⚡</span></div>
          <div class="task-main">
            <div class="wu-pill-row">${kindPill}<span class="wu-provider">Groq</span></div>
            <div class="task-title wu-title">${esc(t.title)}</div>
            <div class="task-meta wu-meta">${sourceText}</div>
          </div>
          <div class="wu-coin-val">+ ₹${t.value}</div>
          <div class="task-right wu-right">
            ${done
              ? `<span class="badge solved">Completed</span>`
              : `<button class="wu-start-btn" data-wu-start="${esc(t.ref)}">
                   <span>Start</span>
                   <span class="wu-start-arrow">→</span>
                 </button>`}
            <button class="task-del" data-del="${esc(t.ref)}" aria-label="Remove ${esc(t.title)}" title="Remove task">×</button>
          </div>
        </div>
      `;
    }
    const chips = chipsFor(t);
    const companyChips = companyChipsFor(t);
    return `
      <div class="task-row ${done ? "done" : ""} ${needsRating ? "capture" : ""} ${isRevisit ? "revisit" : ""}" data-ref="${esc(t.ref)}">
        <button class="checkbox ${done ? "done" : ""}" data-ref="${esc(t.ref)}" aria-label="Toggle ${esc(t.title)}"></button>
        <div class="task-main">
          <div class="task-title-row">
            <div class="task-title">${kindPill}${kindPill ? " " : ""}${esc(t.title)}</div>
            ${companyChips}
            ${chips ? `<div class="hover-chips">${chips}</div>` : ""}
          </div>
          <div class="task-meta">${esc(subFor(t))}</div>
          ${needsRating ? `
            <div class="confidence-prompt" data-rate-ref="${esc(t.ref)}">
              <span class="cp-label">How'd it go?</span>
              <div class="stars" role="radiogroup" aria-label="Confidence rating">
                ${[1,2,3,4,5].map(n => `<button class="star" data-rate="${n}" aria-label="${n} star${n===1?"":"s"}" title="${n}">★</button>`).join("")}
              </div>
              <small class="cp-hint">press <kbd>1</kbd>–<kbd>5</kbd> or click a star</small>
            </div>
          ` : ""}
          ${showReviewStrip ? `
            <div class="review-strip" data-review-ref="${esc(t.ref)}">
              <span class="rs-label">Bring it back? ${infoIcon({
                title: "Review-override chips",
                body: "Pick when this problem should return as a REDO. Overrides spaced-rep — even a ★ 5 will revisit tomorrow if you pick it.",
                bullets: [
                  "Default — use the ★ rating (★1 → 1d, ★2 → 3d, ★3 → 7d, ★4/5 skip)",
                  "Tomorrow — force queue tomorrow",
                  "In 3 days — force queue in 3 days",
                  "Mastered — never auto-revisit"
                ]
              })}</span>
              <button class="rs-chip" data-review="default" title="Default — use ★ rating">Default</button>
              <button class="rs-chip" data-review="tomorrow" title="Force-queue tomorrow">Tomorrow</button>
              <button class="rs-chip" data-review="in3days" title="Force-queue in 3 days">In 3 days</button>
              <button class="rs-chip rs-chip-done" data-review="mastered" title="Never — mastered">Mastered</button>
            </div>
          ` : ""}
          ${reviewOverride ? `
            <div class="review-set">
              <span class="rs-set-dot"></span>
              ${reviewOverride === "mastered"
                ? `Mastered · no revisit`
                : reviewOverride === "tomorrow"
                  ? `Review set for <b>tomorrow</b>`
                  : reviewOverride === "in3days"
                    ? `Review set for <b>in 3 days</b>`
                    : `Normal queue · spaced-rep by ★ rating`}
              <button class="rs-undo" data-review-undo="${esc(t.ref)}" title="Clear choice">change</button>
            </div>
          ` : ""}
        </div>
        <div class="coin-val">+ ₹${t.value}</div>
        ${renderTimerButton(day, t)}
        <div class="task-right">
          <span class="badge ${done ? "solved" : "todo"}">
            ${done
              ? (rating != null
                  ? `Solved · <span class="badge-stars">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</span>`
                  : "Rate it")
              : badgeFor(t)}
          </span>
          <button class="task-del" data-del="${esc(t.ref)}" aria-label="Remove ${esc(t.title)}" title="Remove task">×</button>
        </div>
      </div>
    `;
  }).join("") || `<div class="empty-state" style="padding:24px 0;"><p>No tasks today. Rest day — or hit the add row to drop one in.</p></div>`;

  // Day context banner. Three states:
  //   1. dateKey == realToday — regular Today view, no banner
  //   2. dateKey > realToday  — auto-advanced to tomorrow (working ahead)
  //   3. dateKey < realToday  — user navigated to a past day (fix mistakes)
  const realToday = todayKey();
  let bannerEl = root.querySelector("#next-day-banner");
  if (dateKey > realToday) {
    const hhmm = hoursToRollover();
    if (!bannerEl) {
      bannerEl = document.createElement("div");
      bannerEl.id = "next-day-banner";
      bannerEl.className = "next-day-banner";
      rowsEl.parentElement.insertBefore(bannerEl, rowsEl);
    }
    bannerEl.innerHTML = `
      <div class="nd-text">
        ✓ Today's queue is clear — you're <b>working ahead</b>. New day officially starts in <b>${esc(hhmm)}</b> (7:00 PM IST).
      </div>
      <button class="nd-undo" id="nd-undo" title="Un-tick the last task on today's plan to go back">↶ Undo last tick</button>
    `;
    bannerEl.querySelector("#nd-undo")?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await undoLastTick(root);
    });
    subEl.textContent = totalTasks
      ? `${totalTasks} early task${totalTasks === 1 ? "" : "s"} for tomorrow. Keep stacking.`
      : "No plan generated.";
  } else if (dateKey < realToday) {
    if (!bannerEl) {
      bannerEl = document.createElement("div");
      bannerEl.id = "next-day-banner";
      bannerEl.className = "next-day-banner past-banner";
      rowsEl.parentElement.insertBefore(bannerEl, rowsEl);
    } else {
      bannerEl.className = "next-day-banner past-banner";
    }
    const prettyDate = (() => {
      try { return new Date(dateKey + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); }
      catch (_) { return dateKey; }
    })();
    bannerEl.innerHTML = `
      <div class="nd-text">
        📅 Viewing <b>${esc(prettyDate)}</b> — any ticks here edit that past day. Untick a mistake and ratings update too.
      </div>
      <button class="nd-undo" id="nd-back">← Back to today</button>
    `;
    bannerEl.querySelector("#nd-back")?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      viewedOverride = null;
      paintPlan(root);
    });
    subEl.textContent = totalTasks
      ? `${totalTasks} task${totalTasks === 1 ? "" : "s"} on this day. Edit freely.`
      : "No plan on this day.";
  } else {
    if (bannerEl) bannerEl.remove();
    subEl.textContent = totalTasks ? `${totalTasks} focused task${totalTasks === 1 ? "" : "s"}. Real progress.` : "No plan generated.";
  }
  cntEl.textContent = `${doneTasks} of ${totalTasks} complete`;
  prEl.style.width = `${pct}%`;

  // Glow the "Suggest another task" button when today's plan is 100% done — the user's cue to "do one more"
  const suggestRow = root.querySelector("#suggest-row");
  if (suggestRow) {
    const allDone = totalTasks > 0 && doneTasks >= totalTasks;
    suggestRow.classList.toggle("glow", allDone);
  }

  // Live countdown + at-risk state.
  updateRollover(root);
  if (!root._rolloverTimer) {
    root._rolloverTimer = setInterval(() => updateRollover(root), 30 * 1000);
  }

  // activity rollup — number of DSA done today
  const dsaDone = day.assigned.filter(t => t.kind === "dsa" && day.done.includes(t.ref));
  if (revCount) revCount.textContent = String(dsaDone.length);
  if (revNames) revNames.textContent = dsaDone.length ? dsaDone.map(t => t.title).join(", ") : "Nothing yet — go earn it.";

  // REAL focused-minutes metric: sum of minutes from today's completed tasks.
  const minFocusedEl = root.querySelector("#min-focused");
  const minRangeEl   = root.querySelector("#min-range");
  const minBarEl     = root.querySelector("#min-bar");
  if (minFocusedEl && minBarEl) {
    const doneTasks = day.assigned.filter(t => day.done.includes(t.ref));
    const minutesDone = doneTasks.reduce((a, t) => a + (Number(t.minutes) || 0), 0);
    const totalMinutes = day.assigned.reduce((a, t) => a + (Number(t.minutes) || 0), 0);
    minFocusedEl.textContent = `${minutesDone} min`;
    minBarEl.style.width = totalMinutes ? `${Math.round(100 * minutesDone / totalMinutes)}%` : "0%";

    // Time range: first tick → last tick timestamps from the wallet ledger (same day only)
    const todayStr = todayKey();
    const todayLedger = (getWallet().ledger || [])
      .filter(e => e.type === "task" && new Date(e.date).toISOString().slice(0,10) === todayStr);
    if (todayLedger.length) {
      const first = new Date(todayLedger[0].date);
      const last = new Date(todayLedger[todayLedger.length - 1].date);
      const fmt = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
      minRangeEl.textContent = todayLedger.length === 1 ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;
    } else {
      minRangeEl.textContent = "—";
    }
  }

  // REAL weekly consistency bars — pull from dayLog, show Mon-Fri progress %
  paintWeekBars(root);

  // --- Attach checkbox handlers directly (every re-render) ---
  rowsEl.querySelectorAll("button.checkbox").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handleTick(btn, root);
    });
  });

  // --- Confidence stars: click + keyboard (1-5 / Esc) + hover preview ---
  rowsEl.querySelectorAll(".confidence-prompt").forEach(prompt => {
    const ref = prompt.dataset.rateRef;
    const stars = prompt.querySelectorAll(".star");
    stars.forEach(star => {
      star.addEventListener("mouseenter", () => {
        const n = Number(star.dataset.rate);
        stars.forEach(s => s.classList.toggle("hover", Number(s.dataset.rate) <= n));
      });
      star.addEventListener("mouseleave", () => {
        stars.forEach(s => s.classList.remove("hover"));
      });
      star.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        await rateAndRepaint(root, ref, Number(star.dataset.rate));
      });
    });
  });

  // Vim-ish keyboard nav for the plan (j/k/space). Attached once per mount.
  if (!root._kbNav) {
    let focusedIdx = -1;
    const focusRow = (idx) => {
      const rows = root.querySelectorAll(".task-row");
      if (!rows.length) return;
      idx = Math.max(0, Math.min(rows.length - 1, idx));
      focusedIdx = idx;
      rows.forEach((r, i) => r.classList.toggle("kb-focus", i === idx));
      const target = rows[idx];
      if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    root._kbNav = (e) => {
      // Don't hijack keystrokes while user is typing in an input or textarea
      if (e.target.matches("input, textarea, select") || e.target.isContentEditable) return;
      // Don't hijack if a modal is open
      if (document.querySelector(".lsn-scrim, .glossary-scrim, .lc-scrim, .wu-scrim, .recap-scrim, .sg-scrim, .shop-hub-scrim, .lib-modal-scrim, .claim-modal-scrim")) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        focusRow(focusedIdx + 1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        focusRow(focusedIdx - 1);
      } else if (e.key === " " || e.key === "Enter") {
        const rows = root.querySelectorAll(".task-row");
        if (focusedIdx >= 0 && focusedIdx < rows.length) {
          e.preventDefault();
          const row = rows[focusedIdx];
          const checkbox = row.querySelector("button.checkbox");
          if (checkbox) checkbox.click();
        }
      } else if (e.key === "?") {
        // Open the glossary
        e.preventDefault();
        import("./info.js").then(({ openGlossaryModal }) => openGlossaryModal());
      }
    };
    window.addEventListener("keydown", root._kbNav);
  }

  // One keyboard handler per paint — captures 1-5 and Esc while a capture-state row exists
  if (!root._kbRater) {
    root._kbRater = async (e) => {
      const capturing = root.querySelector(".task-row.capture .confidence-prompt");
      if (!capturing) return;
      const ref = capturing.dataset.rateRef;
      if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        await rateAndRepaint(root, ref, Number(e.key));
      }
      // No auto-skip — rating is required (user explicitly chose this).
    };
    window.addEventListener("keydown", root._kbRater);
  }
  // Delete button
  rowsEl.querySelectorAll("button.task-del").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handleDelete(btn.dataset.del, root);
    });
  });
  // Warm-up Start button → open quiz modal
  rowsEl.querySelectorAll("[data-wu-start]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await openWarmupQuiz({ root, taskRef: btn.dataset.wuStart });
    });
  });

  // Review-override chips ("Bring it back?" after rating)
  rowsEl.querySelectorAll(".review-strip .rs-chip").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const strip = btn.closest(".review-strip");
      const ref = strip.dataset.reviewRef;
      const choice = btn.dataset.review;
      const dateKey = currentKey();
      await setReviewOverride(dateKey, ref, choice);
      paintPlan(root);
    });
  });
  // Review-undo (reset to default)
  rowsEl.querySelectorAll(".rs-undo").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dateKey = currentKey();
      await setReviewOverride(dateKey, btn.dataset.reviewUndo, "reset");
      paintPlan(root);
    });
  });

  // Session timer buttons
  rowsEl.querySelectorAll("[data-timer]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await toggleTimer(root, btn.dataset.timer);
    });
  });

  // Live-update any running timers every 1s. Debounced in-place DOM updates
  // (no re-render) so the row's handlers stay bound.
  if (!root._timerTick) {
    root._timerTick = setInterval(() => tickRunningTimers(root), 1000);
  }

  // ✦ Learn chip → open lesson modal in-place
  rowsEl.querySelectorAll(".hc-learn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openLessonModal({
        sheetName: btn.dataset.learnSheet,
        rowIndex: Number(btn.dataset.learnRow),
      });
    });
  });

  // Click anywhere on the task row (except interactive bits) also toggles.
  // EXCEPTION: done rows require an explicit checkbox or ✕ click — their row-wide
  // area is "sealed" (per user request: once done, only checkbox or × are active).
  rowsEl.querySelectorAll(".task-row").forEach(row => {
    row.addEventListener("click", async (e) => {
      if (e.target.closest("button.checkbox")) return;
      if (e.target.closest("button.task-del")) return;
      if (e.target.closest(".badge, .chev, .coin-val")) return;
      if (e.target.closest(".confidence-prompt, .star")) return;  // let stars handle their own clicks
      if (e.target.closest(".wu-start-btn, .wu-card-ico")) return;
      if (e.target.closest(".hc-learn, .hover-chip")) return;      // chips are their own interactions
      if (e.target.closest(".task-timer")) return;                  // timer button has its own handler
      if (e.target.closest(".review-strip, .review-set")) return;   // review chips have their own
      // Done rows: no row-wide untick. Must click the actual checkbox or ×.
      if (row.classList.contains("done")) return;
      // Warm-up rows don't tick on row click — only Start opens the quiz.
      if (row.classList.contains("warmup")) {
        const startBtn = row.querySelector("[data-wu-start]");
        if (startBtn) startBtn.click();
        return;
      }
      const btn = row.querySelector("button.checkbox");
      if (btn) await handleTick(btn, root);
    });
  });
}

async function handleDelete(ref, root) {
  const { updateDayLog } = await import("./store.js");
  const dateKey = currentKey();
  const day = getDayLog()[dateKey];
  if (!day) return;
  const task = day.assigned.find(t => t.ref === ref);
  if (!task) return;
  const wasDone = day.done.includes(ref);
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    d.assigned = d.assigned.filter(t => t.ref !== ref);
    d.done = d.done.filter(x => x !== ref);
    delete d.values[ref];
    if (wasDone) d.dayEarned = Math.max(0, d.dayEarned - task.value);
    // Wildcard tombstone: don't re-inject the same wildcard after user removes it.
    if (task.wildcard) d.wildcardSkipped = true;
    d.green = d.assigned.length > 0 && d.assigned.every(t => d.done.includes(t.ref));
  });
  // If the task was ticked, refund the coins
  if (wasDone) {
    await updateWallet(w => {
      w.earned = Math.max(0, w.earned - task.value);
      w.ledger.push({ date: new Date().toISOString(), type: "refund", amount: -task.value, label: `Removed · ${task.title}` });
    });
  }
  paintPlan(root);
}

// Live-updating countdown to 7 PM IST + at-risk banner.
// Called on every paintPlan and every 30s.
function updateRollover(root) {
  const tag = root.querySelector("#rollover-tag");
  const timeEl = root.querySelector("#rt-time");
  if (!tag || !timeEl) return;

  // Minutes left until the next 19:00 IST boundary.
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 3600 * 1000;
  const ist = new Date(istMs);
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  const nowMin = h * 60 + m;
  const boundaryMin = 19 * 60;
  const minsLeft = nowMin < boundaryMin ? boundaryMin - nowMin : (24 * 60) - nowMin + boundaryMin;

  const hh = Math.floor(minsLeft / 60);
  const mm = minsLeft % 60;
  timeEl.textContent = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;

  // Threshold states.
  tag.classList.remove("rt-urgent", "rt-warn", "rt-calm");
  if (minsLeft < 30) tag.classList.add("rt-urgent");
  else if (minsLeft < 120) tag.classList.add("rt-warn");
  else tag.classList.add("rt-calm");

  // "Streak at risk" banner — appears above the plan when < 2h left AND tasks undone.
  // Hidden otherwise. Fires inside today's calendar day only (not when viewing tomorrow).
  const realToday = todayKey();
  const dateKey = currentKey();
  const day = getDayLog()[dateKey];
  const undone = day ? day.assigned.filter(t => !day.done.includes(t.ref)).length : 0;
  const viewingToday = dateKey === realToday;
  const rowsEl = root.querySelector("#plan-rows");
  let risk = root.querySelector("#risk-banner");
  const shouldShow = viewingToday && undone > 0 && minsLeft < 120;
  if (shouldShow) {
    if (!risk) {
      risk = document.createElement("div");
      risk.id = "risk-banner";
      risk.className = "risk-banner";
      rowsEl.parentElement.insertBefore(risk, rowsEl);
    }
    const sev = minsLeft < 30 ? "critical" : "warn";
    risk.classList.toggle("critical", sev === "critical");
    risk.innerHTML = `
      <div class="rb-left">
        <span class="rb-ico">${sev === "critical" ? "🔥" : "⚠"}</span>
        <div>
          <div class="rb-title">${sev === "critical" ? "Streak on the line" : "Streak at risk"}</div>
          <div class="rb-sub">${undone} task${undone === 1 ? "" : "s"} undone · ${hh > 0 ? `${hh}h ${mm}m` : `${mm}m`} to 7 PM IST rollover</div>
        </div>
      </div>
      <button class="rb-focus" id="rb-focus">Focus next task →</button>
    `;
    risk.querySelector("#rb-focus")?.addEventListener("click", () => {
      const firstUndone = rowsEl.querySelector(".task-row:not(.done) .checkbox");
      firstUndone?.scrollIntoView({ behavior: "smooth", block: "center" });
      firstUndone?.focus();
    });
  } else if (risk) {
    risk.remove();
  }
}

function openHistoryPopup(root, anchor) {
  document.querySelectorAll(".hist-pop").forEach(p => p.remove());
  const dayLog = getDayLog();
  const realToday = todayKey();
  // Last 14 days with a plan, newest first (excluding today — "Back to today" button handles that).
  const dates = Object.keys(dayLog)
    .filter(k => dayLog[k]?.assigned?.length)
    .sort().reverse()
    .filter(k => k !== realToday)
    .slice(0, 14);

  if (!dates.length) {
    const toast = document.createElement("div");
    toast.className = "hist-toast";
    toast.textContent = "No past days with a plan yet.";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1800);
    return;
  }

  const pop = document.createElement("div");
  pop.className = "hist-pop";
  const rect = anchor.getBoundingClientRect();
  pop.style.top  = `${rect.bottom + 8}px`;
  pop.style.left = `${rect.left}px`;
  pop.innerHTML = `
    <div class="hist-head">Jump to a past day</div>
    ${dates.map(k => {
      const d = dayLog[k];
      const done = d.done?.length || 0;
      const total = d.assigned?.length || 0;
      const prettyLabel = (() => {
        try { return new Date(k + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); }
        catch (_) { return k; }
      })();
      const sev = d.green ? "green" : done === 0 ? "red" : "amber";
      return `<button class="hist-item hi-${sev}" data-k="${esc(k)}">
        <span class="hi-date">${esc(prettyLabel)}</span>
        <span class="hi-stat">${done}/${total}${d.green ? " ✓" : ""}</span>
      </button>`;
    }).join("")}
  `;
  document.body.appendChild(pop);
  pop.querySelectorAll(".hist-item").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      viewedOverride = btn.dataset.k;
      pop.remove();
      paintPlan(root);
    });
  });
  const closer = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor) {
      pop.remove();
      document.removeEventListener("click", closer);
    }
  };
  setTimeout(() => document.addEventListener("click", closer), 50);
}

async function toggleTimer(root, ref) {
  const dateKey = currentKey();
  const { updateDayLog } = await import("./store.js");
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    d.timeOnTask = d.timeOnTask || {};
    const slot = d.timeOnTask[ref] || { sec: 0 };
    if (slot.startedAt) {
      // pause: fold elapsed into sec, clear startedAt
      slot.sec = slot.sec + Math.floor((Date.now() - slot.startedAt) / 1000);
      slot.startedAt = null;
    } else {
      // start: record startedAt
      slot.startedAt = Date.now();
    }
    d.timeOnTask[ref] = slot;
  });
  paintPlan(root);  // re-render so icon flips and badge updates
}

function tickRunningTimers(root) {
  const dateKey = currentKey();
  const day = getDayLog()[dateKey];
  if (!day?.timeOnTask) return;
  for (const [ref, slot] of Object.entries(day.timeOnTask)) {
    if (!slot.startedAt) continue;
    const btn = root.querySelector(`.task-timer[data-timer="${CSS.escape(ref)}"]`);
    if (!btn) continue;
    const live = slot.sec + Math.floor((Date.now() - slot.startedAt) / 1000);
    const timeEl = btn.querySelector(".tt-time");
    if (timeEl) timeEl.textContent = formatSec(live);
  }
}

// Open a tiny modal, user pastes a LeetCode URL (or just a problem title). Groq
// extracts metadata (title + pattern + difficulty + LC#). We add it to the DSA
// sheet (if not already there) + today's plan.
async function openLeetCodePaste(root) {
  const { secure, callGrok, getSheets, addSheetRow, updateSheetRow } = await import("./store.js");
  document.querySelectorAll(".lc-scrim").forEach(m => m.remove());

  const scrim = document.createElement("div");
  scrim.className = "lc-scrim";
  scrim.innerHTML = `
    <div class="lc-modal">
      <header>
        <h3>Paste a LeetCode URL</h3>
        <button class="lc-close" aria-label="Close">✕</button>
      </header>
      <p>Paste <code>leetcode.com/problems/foo-bar/</code> (or any Google result that mentions a LeetCode problem). Groq extracts the title, pattern, difficulty + LC #, then adds it to your DSA sheet and today's plan.</p>
      <input type="text" id="lc-url" placeholder="https://leetcode.com/problems/..." autofocus />
      <div class="lc-row">
        <button class="lc-btn ghost" id="lc-cancel">Cancel</button>
        <button class="lc-btn primary" id="lc-fetch">✦ Extract &amp; add</button>
      </div>
      <div class="lc-status" id="lc-status"></div>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.style.overflow = "hidden";
  injectLcStyles();

  const close = () => { document.body.style.overflow = ""; scrim.remove(); };
  scrim.querySelector(".lc-close").addEventListener("click", close);
  scrim.querySelector("#lc-cancel").addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });

  scrim.querySelector("#lc-fetch").addEventListener("click", async () => {
    const url = scrim.querySelector("#lc-url").value.trim();
    const status = scrim.querySelector("#lc-status");
    const btn = scrim.querySelector("#lc-fetch");
    if (!url) { status.textContent = "Paste a URL first."; return; }
    btn.disabled = true;
    status.textContent = "Asking Groq…";

    try {
      const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                     (await secure.get("grok_api_key").catch(() => null));
      if (!apiKey) throw new Error("No Groq API key. Add one in Settings → AI butler.");

      // Try to extract LC# directly from URL first (free, instant)
      const slug = (url.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i) || [])[1];
      const res = await callGrok({
        apiKey,
        jsonMode: true,
        maxTokens: 256,
        temperature: 0.2,
        system: `You identify LeetCode problems from a URL or slug. Reply as strict JSON only (no markdown, no code fences).
Schema: {"title": "<official problem title, e.g. 'Group Anagrams'>", "lcNumber": <integer LC #>, "pattern": "<2-4 word pattern name, e.g. 'Sliding Window'>", "difficulty": "<Easy|Medium|Hard>"}
If you don't know the exact LC number, output your best guess but mark the title precisely.`,
        user: `URL: ${url}${slug ? `\nSlug: ${slug}` : ""}`,
      });
      if (!res.ok) throw new Error(res.error || "Groq call failed");
      let parsed;
      try {
        const raw = res.content.trim().replace(/^```json\s*|\s*```$/g, "");
        parsed = JSON.parse(raw);
      } catch (_) { throw new Error("Couldn't parse Groq response."); }

      const title = String(parsed.title || "").trim();
      const lcNumber = Number(parsed.lcNumber) || null;
      const pattern = String(parsed.pattern || "").trim();
      const difficulty = String(parsed.difficulty || "").trim();
      if (!title) throw new Error("Groq couldn't identify the problem.");

      // Check if row already exists in DSA sheet by title or LC#
      const sheet = getSheets()["DSA"];
      if (!sheet) throw new Error("DSA sheet isn't loaded.");
      const titleCol = sheet.headers.find(h => /^(problem)$/i.test(h)) || sheet.headers.find(h => /^(title|name)$/i.test(h));
      const lcCol = sheet.headers.find(h => /^lc#?$/i.test(h));
      const patCol = sheet.headers.find(h => /^(pattern|category)$/i.test(h));
      const diffCol = sheet.headers.find(h => /^difficulty$/i.test(h));
      const statusCol = sheet.headers.find(h => /^status$/i.test(h));

      let rowIndex = -1;
      if (titleCol) {
        const needle = title.toLowerCase();
        rowIndex = sheet.rows.findIndex(r => String(r[titleCol] || "").trim().toLowerCase() === needle);
      }
      if (rowIndex < 0 && lcCol && lcNumber) {
        rowIndex = sheet.rows.findIndex(r => String(r[lcCol] || "").trim() === String(lcNumber));
      }

      if (rowIndex < 0) {
        // Append new row
        const patch = {};
        if (titleCol) patch[titleCol] = title;
        if (lcCol && lcNumber) patch[lcCol] = String(lcNumber);
        if (patCol && pattern) patch[patCol] = pattern;
        if (diffCol && difficulty) patch[diffCol] = difficulty;
        if (statusCol) patch[statusCol] = "TODO";
        rowIndex = await addSheetRow("DSA", patch);
      }

      // Add to today's plan
      const dateKey = activeKey();
      const { updateDayLog, getSettings } = await import("./store.js");
      const settings = getSettings();
      const { priceTask } = await import("./engine.js");
      const minutes = difficulty.toLowerCase() === "easy" ? 25 : difficulty.toLowerCase() === "hard" ? 55 : 40;
      const value = priceTask({ kind: "dsa", difficulty, minutes }, settings);
      const ref = `LC-${lcNumber || Date.now()}-${Date.now()}`;
      await updateDayLog(dl => {
        const d = dl[dateKey];
        if (!d) return;
        const t = {
          ref,
          kind: "dsa",
          title,
          pattern,
          difficulty,
          lc: lcNumber ? String(lcNumber) : "",
          minutes,
          value,
          sheet: "DSA",
          rowIndex,
          suggested: true,  // show ✦ SUGGESTED pill
        };
        d.assigned.push(t);
        d.values[ref] = value;
      });
      paintPlan(root);
      close();
      flashRowToast(root, `✓ Added: ${title}${lcNumber ? ` · LC #${lcNumber}` : ""}`);
    } catch (e) {
      status.textContent = `✗ ${e.message || e}`;
      btn.disabled = false;
    }
  });
}

function injectLcStyles() {
  if (document.getElementById("lc-styles")) return;
  const style = document.createElement("style");
  style.id = "lc-styles";
  style.textContent = `
    .lc-scrim {
      position: fixed; inset: 0; z-index: 1300;
      background: rgba(8,10,14,.66);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    .lc-modal {
      background: var(--paper); border-radius: 16px;
      width: 100%; max-width: 480px; padding: 22px 24px;
      box-shadow: 0 32px 80px rgba(0,0,0,.4), 0 0 0 1px var(--line);
      animation: slideDownFade 240ms cubic-bezier(.2,1.2,.3,1);
    }
    .lc-modal header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .lc-modal h3 { margin: 0; font-size: 17px; font-weight: 700; color: var(--ink); }
    .lc-modal .lc-close {
      border: none; background: transparent; cursor: pointer; color: var(--mut);
      width: 28px; height: 28px; border-radius: 6px;
      font: 400 16px/1 var(--font-sans);
    }
    .lc-modal .lc-close:hover { background: var(--bg); color: var(--ink); }
    .lc-modal p { font-size: 12.5px; color: var(--mut); line-height: 1.55; margin: 0 0 16px; }
    .lc-modal code { background: var(--bg); padding: 1px 6px; border-radius: 4px; font-size: 11px; color: var(--ink); }
    .lc-modal input {
      width: 100%; box-sizing: border-box;
      padding: 11px 13px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--bg); color: var(--ink);
      font: 500 13px/1.3 var(--font-sans); outline: none;
      transition: all .18s;
    }
    .lc-modal input:focus { border-color: var(--gold); background: var(--paper); box-shadow: 0 0 0 3px color-mix(in oklab, var(--gold) 20%, transparent); }
    .lc-row { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
    .lc-btn {
      padding: 10px 18px; border-radius: 10px; cursor: pointer;
      font: 600 13px/1 var(--font-sans);
      border: 1px solid var(--line); transition: all .18s;
    }
    .lc-btn.ghost { background: var(--paper); color: var(--mut); }
    .lc-btn.ghost:hover { color: var(--ink); border-color: var(--line2); }
    .lc-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .lc-btn.primary:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.08); }
    .lc-btn:disabled { opacity: .5; cursor: wait; }
    .lc-status { margin-top: 10px; font-size: 11.5px; color: var(--mut); min-height: 14px; }
  `;
  document.head.appendChild(style);
}

// Scan dayLog for the weakest-confidence past solve that's NOT already in today's
// plan, and inject it as an extra REDO task. One-click for the user; cross-sheet.
async function addExtraRedo(root) {
  const dateKey = activeKey();
  const day = getDayLog()[dateKey];
  if (!day) return;

  // Collect ALL past solves with sheet/rowIndex + confidence
  const dayLog = getDayLog();
  const existingKeys = new Set(day.assigned
    .filter(t => t.sheet && t.rowIndex != null)
    .map(t => `${t.sheet}#${t.rowIndex}`));
  const seen = new Set();
  const pool = [];
  const dates = Object.keys(dayLog).sort().reverse();
  for (const d of dates) {
    if (d === dateKey) continue;
    const entry = dayLog[d];
    if (!entry?.assigned?.length) continue;
    for (const ref of (entry.done || [])) {
      const task = entry.assigned.find(t => t.ref === ref);
      if (!task?.sheet || task.rowIndex == null) continue;
      const key = `${task.sheet}#${task.rowIndex}`;
      if (seen.has(key) || existingKeys.has(key)) continue;
      seen.add(key);
      const conf = entry.confidence?.[ref] ?? 3;
      pool.push({ task, conf, date: d });
    }
  }
  if (!pool.length) {
    flashRowToast(root, "No past solves available to redo. Keep rating today's problems.");
    return;
  }
  // Pick weakest-confidence; break ties by oldest
  pool.sort((a, b) => a.conf - b.conf || a.date.localeCompare(b.date));
  const pick = pool[0].task;
  const { updateDayLog } = await import("./store.js");
  const ref = `REV-${pick.sheet}-${pick.rowIndex}-${dateKey}-extra`;
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    const settings = /* already imported */ getSettings();
    const value = Math.max(10, Math.round((settings.wallet.taskMin || 10) * 2));
    const task = {
      ref,
      kind: "revisit",
      title: pick.title,
      pattern: pick.pattern || "",
      sheet: pick.sheet,
      rowIndex: pick.rowIndex,
      minutes: 15,
      value,
      extraRedo: true,
    };
    d.assigned.push(task);
    d.values[ref] = value;
  });
  paintPlan(root);
  flashRowToast(root, `↻ Added REDO: ${pick.title}`);
}

function flashRowToast(root, message) {
  document.querySelectorAll(".row-toast").forEach(t => t.remove());
  const toast = document.createElement("div");
  toast.className = "row-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 240);
  }, 2600);
}

async function undoLastTick(root) {
  // Pulls today (the real, calendar day — not the auto-advanced active day) and
  // unticks the most recently banked task so activeKey() flips back to today.
  const realToday = todayKey();
  const day = getDayLog()[realToday];
  if (!day || !day.done.length) return;
  // Find the most-recent "task"-type ledger entry for a ref that's still in day.done
  const ledger = getWallet().ledger || [];
  let targetRef = null;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i];
    if (e.type !== "task") continue;
    const todayDone = day.done;
    // match ledger entry back to a task by sourceKey or by title/day combo
    const match = day.assigned.find(t =>
      todayDone.includes(t.ref) &&
      (
        (e.sourceKey && t.sheet && t.rowIndex != null && e.sourceKey === `${t.sheet}#${t.rowIndex}`) ||
        (!e.sourceKey && e.label === t.title)
      )
    );
    if (match) { targetRef = match.ref; break; }
  }
  // Fallback — just untick the last ref in day.done array.
  if (!targetRef) targetRef = day.done[day.done.length - 1];
  const task = day.assigned.find(t => t.ref === targetRef);
  if (!task) return;

  await untickTask(realToday, targetRef);
  await updateWallet(w => {
    w.earned = Math.max(0, w.earned - (task.value || 0));
    w.ledger.push({ date: new Date().toISOString(), type: "untick", amount: -(task.value || 0), label: task.title });
  });
  await syncSheetOnUntick(task);
  // Clear the confidence rating we captured for this ref (so re-ticking goes back to capture state)
  const { updateDayLog } = await import("./store.js");
  await updateDayLog(dl => {
    const d = dl[realToday];
    if (d?.confidence) delete d.confidence[targetRef];
  });
  paintPlan(root);
}

async function rateAndRepaint(root, ref, rating) {
  const dateKey = currentKey();
  await setConfidence(dateKey, ref, rating);
  const row = root.querySelector(`.task-row[data-ref="${CSS.escape(ref)}"]`);
  const badge = row?.querySelector(".badge");
  if (badge) {
    badge.animate([
      { transform: "scale(1)", filter: "brightness(1)" },
      { transform: "scale(1.08)", filter: "brightness(1.3)" },
      { transform: "scale(1)", filter: "brightness(1)" }
    ], { duration: 320, easing: "cubic-bezier(.2,1.4,.3,1)" });
  }
  // ★5 confetti burst — only perfect mastery earns it. Small, gold, celebratory.
  if (rating === 5 && row) fireMicroConfetti(row);
  // Error log: ★1 / ★2 trigger a tailored "what tripped you?" prompt via Groq
  if (rating <= 2) {
    try {
      const { openErrorLogPrompt } = await import("./errorlog.js");
      await openErrorLogPrompt(root, dateKey, ref, rating);
    } catch (e) { console.warn("[errorlog] prompt failed", e); }
  }
  paintPlan(root);
}

function fireMicroConfetti(anchor) {
  const rect = anchor.getBoundingClientRect();
  const originX = rect.right - 60;
  const originY = rect.top + rect.height / 2;
  const PARTICLES = 7;
  for (let i = 0; i < PARTICLES; i++) {
    const p = document.createElement("div");
    p.className = "micro-confetti";
    p.textContent = ["★","✦","●","✧"][i % 4];
    p.style.left = `${originX}px`;
    p.style.top  = `${originY}px`;
    const angle = (Math.PI * (0.6 + Math.random() * 0.8));
    const dist = 40 + Math.random() * 40;
    const dx = Math.cos(angle) * dist;
    const dy = -Math.sin(angle) * dist - (Math.random() * 20);
    document.body.appendChild(p);
    p.animate([
      { transform: "translate(0,0) scale(.4)", opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(${Math.random() * 240 - 120}deg)`, opacity: 1, offset: .6 },
      { transform: `translate(${dx * 1.2}px, ${dy + 60}px) scale(.8) rotate(${Math.random() * 360}deg)`, opacity: 0 }
    ], { duration: 900 + Math.random() * 300, easing: "cubic-bezier(.2,.9,.3,1)" }).onfinish = () => p.remove();
  }
}

async function handleTick(btn, root) {
  const ref = btn.dataset.ref;
  const dateKey = currentKey();
  const day = getDayLog()[dateKey];
  if (!day) { console.warn("[today] no day log"); return; }
  const task = day.assigned.find(t => t.ref === ref);
  if (!task) { console.warn("[today] no task for ref", ref); return; }
  const wasDone = day.done.includes(ref);
  if (wasDone) {
    await untickTask(dateKey, ref);
    await updateWallet(w => {
      w.earned = Math.max(0, w.earned - task.value);
      w.ledger.push({ date: new Date().toISOString(), type: "untick", amount: -task.value, label: task.title });
    });
    await syncSheetOnUntick(task);
  } else {
    // Auto-pause the session timer if it was running — fold elapsed into sec
    const { updateDayLog } = await import("./store.js");
    await updateDayLog(dl => {
      const d = dl[dateKey];
      if (!d?.timeOnTask?.[ref]?.startedAt) return;
      const slot = d.timeOnTask[ref];
      slot.sec = slot.sec + Math.floor((Date.now() - slot.startedAt) / 1000);
      slot.startedAt = null;
    });
    await tickTask(dateKey, ref);
    const sourceKey = task.sheet && task.rowIndex != null ? `${task.sheet}#${task.rowIndex}` : null;
    // Phase 7 — daily earnings cap
    const settings = getSettings();
    const capped = capTaskValue(getWallet(), settings, task.value);
    const bankValue = capped.amount;
    await updateWallet(w => {
      w.earned += bankValue;
      w.ledger.push({
        date: new Date().toISOString(), type: "task",
        amount: bankValue, label: task.title,
        sourceKey,   // claim this sheet row — problem page won't re-bank it
        cappedFrom: capped.capped ? capped.originalAmount : undefined,
      });
    });
    if (capped.capped) {
      flashRowToast(root, `⚠ Daily cap of ₹${settings.wallet.dailyEarningCap} reached — banked ₹${bankValue} (₹${capped.originalAmount - bankValue} skipped)`);
    }
    await syncSheetOnTick(task);
    btn.animate([{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }],
                { duration: 320, easing: "cubic-bezier(.2,1.4,.3,1)" });

    // Per-task micro animation (always fires)
    fireTaskBagged({ amount: task.value, title: task.title, sourceEl: btn });

    const latest = getDayLog()[dateKey];
    if (latest && latest.green) {
      const bonus = getSettings().wallet.perfectDayBonus || 0;
      if (bonus) {
        await updateWallet(w => {
          w.earned += bonus;
          w.ledger.push({ date: new Date().toISOString(), type: "day-bonus", amount: bonus, label: "Perfect day bonus" });
        });
      }
      // DAY SECURED is reserved for multi-task plans; single-task days get only the micro task-bag.
      if (latest.assigned.length >= 2) {
        setTimeout(() => fireDaySecured({ amount: latest.dayEarned + (bonus || 0) }), 1200);
      }

      // Phase 7 — Perfect-week bonus (9D): fires at every N-th consecutive green day.
      // Separate from the week/month celebrations above; pure consistency reward.
      setTimeout(async () => {
        const pw = maybeFirePerfectWeek(getDayLog(), dateKey, getSettings());
        if (pw) {
          await updateWallet(w => {
            w.earned += pw.bonus;
            w.ledger.push({
              date: new Date().toISOString(),
              type: "perfect-week-bonus",
              amount: pw.bonus,
              label: `Perfect ${pw.count}-day streak bonus`,
            });
          });
          await (async () => {
            const { updateDayLog } = await import("./store.js");
            await updateDayLog(dl => { if (dl[dateKey]) dl[dateKey].perfectWeekAwarded = true; });
          })();
          flashRowToast(root, `✨ ${pw.count}-day perfect streak · + ₹${pw.bonus}`);
        }
      }, 3000);

      // Week/Month celebrations always run on their own schedules regardless of task count.
      setTimeout(async () => {
        if (!wasWeekFired() && isGreenWeek()) {
          const weekBonus = getSettings().wallet.weekBonus || 0;
          if (weekBonus) {
            await updateWallet(w => {
              w.earned += weekBonus;
              w.ledger.push({ date: new Date().toISOString(), type: "week-bonus", amount: weekBonus, label: "Green week bonus" });
            });
          }
          await markWeekFired();
          await fireWeekGodly({ amount: weekBonus });
        }
      }, 4200);

      setTimeout(async () => {
        if (!wasMonthFired() && isGreenMonth()) {
          const monthBonus = getSettings().wallet.monthBonus || 0;
          if (monthBonus) {
            await updateWallet(w => {
              w.earned += monthBonus;
              w.ledger.push({ date: new Date().toISOString(), type: "month-bonus", amount: monthBonus, label: "Green month bonus" });
            });
          }
          await markMonthFired();
          await fireMonthLegend({ amount: monthBonus });
        }
      }, 11500);
    }
    // Early-finish: if that tick completed every task for the current day,
    // make sure tomorrow's plan exists so the next re-paint flips to it,
    // and fire the daily recap (debounced to once per day).
    const after = getDayLog()[dateKey];
    if (after && after.assigned.length > 0 && after.done.length >= after.assigned.length) {
      await ensureDailyPlan(nextDayKey());
      paintPlan(root);
      // Delay slightly so capture-state star rating finishes animating first.
      setTimeout(() => { tryOpenRecap({ reason: "all-done" }); }, 2200);
    }
  }
}

function attachHandlers(root) {
  // Checkbox tick is wired per-row inside paintPlan (direct listener, no delegation).
  // add task (one-off, with optional expanded config)
  const addBtn = root.querySelector("#add-task-btn");
  const addInput = root.querySelector("#add-task-input");
  const addToggle = root.querySelector("#add-task-toggle");
  const addEx = root.querySelector("#add-row-ex");

  // History dropdown — pick a past day with a plan to view/edit
  const histBtn = root.querySelector("#hist-btn");
  histBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    openHistoryPopup(root, histBtn);
  });

  // ✦ Suggest a task → opens Groq-picker modal
  root.querySelector("#suggest-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    openSuggestModal(root);
  });

  // ◷ Review today's recap — reopens the end-of-day butler reflection anytime
  root.querySelector("#recap-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const { openRecapForDate } = await import("./recap.js");
    const opened = openRecapForDate(todayKey());
    if (!opened) flashRowToast(root, "Today has no plan yet.");
  });

  // ⋯ More dropdown — toggle open/close
  const moreBtn = root.querySelector("#more-btn");
  const morePop = root.querySelector("#more-pop");
  if (moreBtn && morePop) {
    const closeMore = () => {
      morePop.hidden = true;
      moreBtn.setAttribute("aria-expanded", "false");
    };
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = morePop.hidden;
      morePop.hidden = !open;
      moreBtn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (e) => {
      if (morePop.hidden) return;
      if (!morePop.contains(e.target) && e.target !== moreBtn) closeMore();
    });
    // Each menu item
    morePop.querySelectorAll(".more-item").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        closeMore();
        const kind = btn.dataset.more;
        if (kind === "redo") await addExtraRedo(root);
        else if (kind === "lcpaste") await openLeetCodePaste(root);
        else if (kind === "yrecap") {
          const { openYesterdayRecap } = await import("./recap.js");
          const opened = openYesterdayRecap();
          if (!opened) flashRowToast(root, "Nothing to recap — yesterday had no plan.");
        }
        else if (kind === "todayrecap") {
          const { openRecapForDate } = await import("./recap.js");
          const opened = openRecapForDate(todayKey());
          if (!opened) flashRowToast(root, "Today has no plan yet.");
        }
      });
    });
  }

  addToggle?.addEventListener("click", () => {
    const expanded = !addEx.hidden;
    addEx.hidden = expanded;
    addToggle.setAttribute("aria-expanded", String(!expanded));
    addToggle.classList.toggle("expanded", !expanded);
    if (!expanded) setTimeout(() => addInput.focus(), 20);
  });

  // ── Autocomplete: search user's own sheets as they type ─────────────
  // Picked suggestion carried over to commit(). ✕ on the chip unlinks.
  let pickedMatch = null;
  const suggestEl = root.querySelector("#add-suggest");
  const pickchipEl = root.querySelector("#add-pickchip");
  let suggestIdx = -1;
  let suggestions = [];

  const clearPick = () => {
    pickedMatch = null;
    if (pickchipEl) { pickchipEl.hidden = true; pickchipEl.innerHTML = ""; }
  };
  const setPick = (match) => {
    pickedMatch = match;
    if (!pickchipEl) return;
    const metaBits = [match.sheetLabel, match.pattern, match.difficulty, match.lcNum ? "LC#" + match.lcNum : null].filter(Boolean);
    pickchipEl.hidden = false;
    pickchipEl.innerHTML = `
      <span class="apk-core">${esc(metaBits.join(" · "))}${match.alreadySolved ? ' <span class="apk-redo">REDO</span>' : ""}</span>
      <button class="apk-x" type="button" aria-label="Unlink">✕</button>
    `;
    pickchipEl.querySelector(".apk-x").addEventListener("click", () => { clearPick(); addInput.focus(); });
    // Auto-fill expanded panel + kind
    if (addEx) {
      const kSel = root.querySelector("#at-kind");
      if (kSel && match.kind) kSel.value = match.kind;
      const vInput = root.querySelector("#at-value");
      if (vInput && match.bounty) vInput.value = String(match.bounty);
    }
  };

  const closeSuggest = () => {
    if (!suggestEl) return;
    suggestEl.hidden = true;
    suggestEl.innerHTML = "";
    suggestIdx = -1;
    suggestions = [];
  };

  const renderSuggest = (list, needle) => {
    if (!suggestEl) return;
    suggestions = list;
    if (!list.length && !needle) { closeSuggest(); return; }
    const items = list.map((m, i) => {
      const solvedTag = m.alreadySolved ? ` <span class="asg-solved-tag">✓ solved ${esc(m.solvedAgo || "")}</span>` : "";
      const highTag = (m.freq && /^high$/i.test(m.freq)) ? ' <span class="asg-high">HIGH</span>' : "";
      const metaParts = [esc(m.sheetLabel)];
      if (m.difficulty) metaParts.push(esc(m.difficulty));
      if (m.pattern) metaParts.push(esc(m.pattern));
      if (m.lcNum) metaParts.push("LC#" + esc(m.lcNum));
      return `
        <div class="asg-item ${m.alreadySolved ? "solved" : ""} ${i === suggestIdx ? "active" : ""}" data-idx="${i}" role="option">
          <div class="asg-title">${esc(m.title)}${solvedTag}</div>
          <div class="asg-meta">${metaParts.join(" · ")}${highTag}</div>
        </div>`;
    }).join("");
    const addNewRow = needle ? `<div class="asg-item asg-new ${suggestIdx === list.length ? "active" : ""}" data-idx="${list.length}" role="option">
      <div class="asg-title">+ Add "<b>${esc(needle)}</b>" as a new problem</div>
      <div class="asg-meta">Creates a fresh row in the matching sheet</div>
    </div>` : "";
    suggestEl.innerHTML = items + addNewRow;
    suggestEl.hidden = false;
    suggestEl.querySelectorAll(".asg-item").forEach(el => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const i = +el.dataset.idx;
        if (i < list.length) {
          addInput.value = list[i].title;
          setPick(list[i]);
          closeSuggest();
        } else {
          clearPick();
          closeSuggest();
        }
      });
    });
  };

  const refreshSuggestions = async () => {
    const needle = (addInput?.value || "").trim();
    if (needle.length < 2) { closeSuggest(); return; }
    // Invalidate any prior pick as soon as the user edits past that match.
    if (pickedMatch && pickedMatch.title !== needle) clearPick();
    const { getSheets, SHEET_KINDS } = await import("./store.js");
    const sheets = getSheets();
    const list = searchAcrossSheets(sheets, needle);
    suggestIdx = list.length ? 0 : -1;
    renderSuggest(list, needle);
  };

  let suggestDebounce;
  addInput?.addEventListener("input", () => {
    clearTimeout(suggestDebounce);
    suggestDebounce = setTimeout(refreshSuggestions, 120);
  });
  addInput?.addEventListener("focus", refreshSuggestions);
  addInput?.addEventListener("blur", () => { setTimeout(closeSuggest, 180); });
  addInput?.addEventListener("keydown", (e) => {
    if (suggestEl?.hidden) return;
    const total = suggestions.length + (addInput.value.trim() ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      suggestIdx = Math.min(total - 1, suggestIdx + 1);
      renderSuggest(suggestions, addInput.value.trim());
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      suggestIdx = Math.max(0, suggestIdx - 1);
      renderSuggest(suggestions, addInput.value.trim());
    } else if (e.key === "Escape") {
      closeSuggest();
    } else if (e.key === "Enter") {
      if (suggestIdx >= 0 && suggestIdx < suggestions.length) {
        e.preventDefault();
        const m = suggestions[suggestIdx];
        addInput.value = m.title;
        setPick(m);
        closeSuggest();
      }
      // Otherwise let Enter fall through to the commit handler below.
    }
  });

  const commit = async () => {
    const val = (addInput?.value || "").trim();
    if (!val) return;
    const { updateDayLog, KIND_TO_SHEET, addSheetRow, updateSheetRow, getSheets } = await import("./store.js");
    const dateKey = currentKey();
    const ref = `ADHOC-${Date.now()}`;

    // If the user picked a suggestion, use its sheet/row + kind + bounty directly.
    let sheetName = null;
    let rowIndex = null;
    let kind, minutes, value, preDone;

    if (pickedMatch) {
      sheetName = pickedMatch.sheet;
      rowIndex = pickedMatch.rowIndex;
      kind = addEx.hidden ? pickedMatch.kind : (root.querySelector("#at-kind")?.value || pickedMatch.kind);
      minutes = Number(addEx.hidden ? 25 : (root.querySelector("#at-min")?.value || 25));
      value = Number(addEx.hidden ? pickedMatch.bounty : (root.querySelector("#at-value")?.value || pickedMatch.bounty));
      preDone = !addEx.hidden && root.querySelector("#at-status")?.value === "done";
    } else {
      kind = addEx.hidden ? "dsa" : (root.querySelector("#at-kind")?.value || "dsa");
      minutes = Number(addEx.hidden ? 25 : (root.querySelector("#at-min")?.value || 25));
      value = Number(addEx.hidden ? getSettings().wallet.taskMin : (root.querySelector("#at-value")?.value || getSettings().wallet.taskMin));
      preDone = !addEx.hidden && root.querySelector("#at-status")?.value === "done";
      const mapped = KIND_TO_SHEET[kind];
      if (mapped && getSheets()[mapped]?.headers?.length) {
        const sh = getSheets()[mapped];
        const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
        if (titleCol) {
          const needle = val.toLowerCase();
          const idx = sh.rows.findIndex(r => String(r[titleCol] || "").trim().toLowerCase() === needle);
          if (idx >= 0) rowIndex = idx;
        }
        if (rowIndex == null) {
          const patch = {};
          if (titleCol) patch[titleCol] = val;
          rowIndex = await addSheetRow(mapped, patch);
        }
        sheetName = mapped;
      }
    }

    await updateDayLog(dl => {
      const d = dl[dateKey];
      if (!d) return;
      const t = {
        ref, kind, title: val, minutes, value,
        sheet: sheetName, rowIndex,
        pattern: pickedMatch?.pattern || undefined,
        difficulty: pickedMatch?.difficulty || undefined,
        freq: pickedMatch?.freq || undefined,
        redo: !!pickedMatch?.alreadySolved,
      };
      d.assigned.push(t);
      d.values[ref] = value;
      if (preDone) {
        d.done.push(ref);
        d.dayEarned += value;
      }
    });
    if (preDone) {
      await updateWallet(w => {
        w.earned += value;
        w.ledger.push({
          date: new Date().toISOString(),
          type: "task",
          amount: value,
          label: val,
          sourceKey: sheetName && rowIndex != null ? `${sheetName}#${rowIndex}` : undefined,
        });
      });
      // Write Status/Date into the linked sheet row so Pace counts it immediately.
      if (sheetName && rowIndex != null) {
        const sh = getSheets()[sheetName];
        const statusCol = sh.headers.find(h => /^status$/i.test(h));
        const dateCol   = sh.headers.find(h => /^(datesolved|datedone)$/i.test(h));
        const patch = {};
        if (statusCol) patch[statusCol] = "SOLVED";
        if (dateCol)   patch[dateCol]   = dateKey;
        if (Object.keys(patch).length) await updateSheetRow(sheetName, rowIndex, patch);
      }
    }
    addInput.value = "";
    clearPick();
    closeSuggest();
    paintPlan(root);
  };
  addBtn?.addEventListener("click", commit);
  // Enter commits only when no suggestion is highlighted (otherwise the keydown
  // handler above picks the suggestion and swallows the event).
  addInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (!suggestEl?.hidden && suggestIdx >= 0 && suggestIdx < suggestions.length) return;
    commit();
  });

  // jump to Settings for target edits
  root.querySelector("#to-settings")?.addEventListener("click", () => { location.hash = "#settings"; });
}

// Autocomplete search across every sheet. Match on title column, rank by:
//   1. prefix match > substring match > word-split fuzzy
//   2. HIGH-freq boost
//   3. unsolved before solved (but solved still shown with a muted tag)
// Returns max 6 ranked matches, each enriched with sheet/row/kind/bounty so
// the add-row commit can skip the create-or-link dance.
function searchAcrossSheets(sheets, rawNeedle) {
  const needle = rawNeedle.trim().toLowerCase();
  if (needle.length < 2) return [];
  const words = needle.split(/\s+/).filter(w => w.length >= 2);

  // Infer kind + display label from the sheet's `type` field or filename.
  const inferMeta = (sheetName, sh) => {
    const type = String(sh?.type || "").toLowerCase();
    const name = sheetName.toLowerCase();
    if (type === "dsa" || /dsa/.test(name)) return { kind: "dsa", label: "DSA" };
    if (type === "sql" || /sql/.test(name)) return { kind: "sql", label: "SQL" };
    if (type === "sd"  || /system.?design/.test(name)) return { kind: "sd", label: "System Design" };
    if (type === "int" || /integration|platform/.test(name)) return { kind: "int", label: "Integrations" };
    if (type === "ext" || /extra|interview/.test(name)) return { kind: "ext", label: "Extras" };
    return { kind: "dsa", label: sheetName.replace(/\.csv$/i, "").replace(/^\d+_/, "").replace(/_/g, " ") };
  };

  const results = [];
  for (const [sheetName, sh] of Object.entries(sheets)) {
    if (!sh || !Array.isArray(sh.rows) || !sh.headers?.length) continue;
    const meta = inferMeta(sheetName, sh);
    const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
    if (!titleCol) continue;
    const patternCol = sh.headers.find(h => /^(pattern|category)$/i.test(h));
    const diffCol = sh.headers.find(h => /^difficulty$/i.test(h));
    const freqCol = sh.headers.find(h => /^(freq|priority)$/i.test(h));
    const statusCol = sh.headers.find(h => /^status$/i.test(h));
    const dateCol = sh.headers.find(h => /^(datesolved|datedone)$/i.test(h));
    const lcCol = sh.headers.find(h => /^lc#?$/i.test(h));
    const minsCol = sh.headers.find(h => /^(minutes|time|est)$/i.test(h));

    for (let i = 0; i < sh.rows.length; i++) {
      const r = sh.rows[i];
      const title = String(r[titleCol] || "").trim();
      if (!title) continue;
      const t = title.toLowerCase();

      // Rank scoring
      let score = 0;
      if (t === needle) score = 1000;
      else if (t.startsWith(needle)) score = 800;
      else if (t.includes(needle)) score = 600;
      else {
        // Word-split fuzzy: every word in needle must appear as a substring somewhere in title.
        const allHit = words.length > 0 && words.every(w => t.includes(w));
        if (allHit) score = 400;
      }
      if (score === 0) continue;

      const freq = freqCol ? String(r[freqCol] || "").trim() : "";
      if (/^high$/i.test(freq)) score += 40;

      const alreadySolved = statusCol ? /^solved$/i.test(String(r[statusCol] || "")) : false;
      if (alreadySolved) score -= 100;

      // Bounty computed via engine's priceTask using the row's shape
      const difficulty = diffCol ? String(r[diffCol] || "").trim() : "";
      const minutes = minsCol ? Number(r[minsCol] || 25) : 25;
      const bounty = priceTask({ kind: meta.kind, difficulty, freq, minutes }, getSettings());

      results.push({
        score,
        title,
        sheet: sheetName,
        sheetLabel: meta.label,
        kind: meta.kind,
        rowIndex: i,
        pattern: patternCol ? String(r[patternCol] || "").trim() : "",
        difficulty,
        freq,
        lcNum: lcCol ? String(r[lcCol] || "").trim() : "",
        alreadySolved,
        solvedAgo: alreadySolved && dateCol ? relAgo(String(r[dateCol] || "")) : "",
        bounty,
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 6);
}

function relAgo(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + (dateStr.length === 10 ? "T12:00:00" : ""));
  if (isNaN(d)) return "";
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days/7)}w ago`;
  return `${Math.round(days/30)}mo ago`;
}

// If rowIndex is missing (e.g. task came from a weekly plan generated before this build),
// try to resolve it on the fly from seq/ref/title so the sheet still updates on tick.
function resolveRowIndex(task) {
  if (task.rowIndex != null) return task.rowIndex;
  if (!task.sheet) return null;
  const sh = getSheets()[task.sheet];
  if (!sh) return null;
  const seqCol = sh.headers.find(h => /^seq$/i.test(h));
  const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
  let seq = task.seq;
  if (seq == null && typeof task.ref === "string") {
    const m = task.ref.match(/#(\d+)$/);
    if (m) seq = Number(m[1]);
  }
  if (seqCol && seq != null) {
    const idx = sh.rows.findIndex(r => String(r[seqCol]) === String(seq));
    if (idx >= 0) return idx;
  }
  if (titleCol && task.title) {
    const needle = String(task.title).trim().toLowerCase();
    const idx = sh.rows.findIndex(r => String(r[titleCol] || "").trim().toLowerCase() === needle);
    if (idx >= 0) return idx;
  }
  return null;
}

async function syncSheetOnTick(task) {
  if (!task.sheet) return;
  const rowIndex = resolveRowIndex(task);
  if (rowIndex == null) return;
  const sheet = getSheets()[task.sheet];
  if (!sheet) return;
  const statusCol = sheet.headers.find(h => /^status$/i.test(h));
  const dateCol   = sheet.headers.find(h => /^(datesolved|datedone)$/i.test(h));
  const patch = {};
  if (statusCol) patch[statusCol] = "SOLVED";
  if (dateCol)   patch[dateCol]   = todayKey();
  if (Object.keys(patch).length) await updateSheetRow(task.sheet, rowIndex, patch);
}
async function syncSheetOnUntick(task) {
  if (!task.sheet) return;
  const rowIndex = resolveRowIndex(task);
  if (rowIndex == null) return;
  const sheet = getSheets()[task.sheet];
  if (!sheet) return;
  const statusCol = sheet.headers.find(h => /^status$/i.test(h));
  const dateCol   = sheet.headers.find(h => /^(datesolved|datedone)$/i.test(h));
  const patch = {};
  if (statusCol) patch[statusCol] = "TODO";
  if (dateCol)   patch[dateCol]   = "";
  if (Object.keys(patch).length) await updateSheetRow(task.sheet, rowIndex, patch);
}

// Default (always-visible) meta line — kept short + uncluttered.
// LC# and difficulty surface only on hover via chipsFor().
function subFor(t) {
  if (t.kind === "dsa")      return `${t.pattern || "DSA"} · ${t.minutes} min`;
  if (t.kind === "revision") return `DSA · ${t.minutes} min quiz`;
  if (t.kind === "log")      return `Progress · Update the sheet`;
  if (t.kind === "sd")       return `System Design · ${t.minutes} min`;
  if (t.kind === "int")      return `Integrations · ${t.minutes} min`;
  if (t.kind === "ext")      return `${t.pattern || "Interview Extras"} · ${t.minutes} min`;
  return `${t.minutes || 15} min`;
}

// Session timer button on each study row — "▶ 2:35" when paused, "⏸ 2:35" when
// running. Click toggles. State lives in dayLog[date].timeOnTask[ref] = {sec, startedAt}.
// Only shown for study-kind rows (not warmup/revision/log — those aren't the
// problems you spend "deep focus" minutes on).
function renderTimerButton(day, t) {
  const studyKinds = ["dsa", "sd", "int", "ext", "sql"];
  // Keep the grid cell for layout consistency even on non-study rows (revision/log/warmup).
  if (!studyKinds.includes(t.kind)) return `<span class="task-timer-slot"></span>`;
  const data = day.timeOnTask?.[t.ref] || { sec: 0 };
  // If started, show elapsed = sec + (now - startedAt). On re-paint we recompute live.
  const running = !!data.startedAt;
  const live = running ? data.sec + Math.floor((Date.now() - data.startedAt) / 1000) : data.sec;
  const isDone = (day.done || []).includes(t.ref);
  const titleText = isDone
    ? `Final focus time: ${formatSec(live)}`
    : `Session timer — click to ${running ? "pause" : "start"}`;
  return `
    <button class="task-timer ${running ? "running" : ""}" data-timer="${esc(t.ref)}" title="${esc(titleText)}" ${isDone ? "disabled" : ""}>
      <span class="tt-ico">${running ? "⏸" : "▶"}</span>
      <span class="tt-time">${formatSec(live)}</span>
    </button>
  `;
}

function formatSec(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${m}:${String(sec).padStart(2,"0")}`;
}

// Hover-only chips (classy, hidden by default, fade in on row hover).
// Returns an HTML string of 0-N `.hover-chip` spans.
function chipsFor(t) {
  const bits = [];
  if (t.difficulty) {
    const sev = String(t.difficulty).toLowerCase();
    bits.push(`<span class="hover-chip hc-diff hc-${sev}">${esc(t.difficulty)}</span>`);
  }
  if (t.lc) bits.push(`<span class="hover-chip hc-lc">LC&nbsp;#${esc(String(t.lc))}</span>`);
  if (t.freq && t.freq.toUpperCase() === "HIGH") bits.push(`<span class="hover-chip hc-freq">HIGH</span>`);
  // "Learn this topic" chip — only for sheet-linked rows (DSA/SD/Int/Ext/SQL)
  if (t.sheet && t.rowIndex != null && t.kind !== "warmup") {
    bits.push(`<button class="hover-chip hc-learn" data-learn-sheet="${esc(t.sheet)}" data-learn-row="${esc(String(t.rowIndex))}" title="Teacher-mode lesson (Groq)">✦ Learn</button>`);
  }
  return bits.join("");
}

// Always-visible company logo row for a task. Returns "" if no companies.
function companyChipsFor(t) {
  if (!t.sheet || t.rowIndex == null) return "";
  const sh = getSheets()[t.sheet];
  const row = sh?.rows?.[t.rowIndex];
  if (!row || !sh.headers?.length) return "";
  const col = sh.headers.find(h => /^compan(y|ies)$/i.test(h));
  if (!col || !row[col]) return "";
  const companies = String(row[col]).split(",").map(s => s.trim()).filter(Boolean).slice(0, 5);
  if (!companies.length) return "";
  return `<span class="task-companies">${companies.map(c =>
    `<span class="task-company" title="${esc(c)}"><img src="${esc(logoUrlFor(c, 32))}" alt="${esc(c)}" onerror="this.onerror=null;this.src='${esc(faviconFor(c, 32))}';" /></span>`
  ).join("")}</span>`;
}

// Lightweight local versions of logoUrl / favicon so today.js stays import-light.
function logoUrlFor(name, size) {
  const d = _domainFor(name);
  return d ? `https://logo.clearbit.com/${d}?size=${size}` : "";
}
function faviconFor(name, size) {
  const d = _domainFor(name);
  return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=${size * 2}` : "";
}
const _COMPANY_DOMAINS = {
  google:"google.com",meta:"meta.com",facebook:"meta.com",amazon:"amazon.com",apple:"apple.com",microsoft:"microsoft.com",
  palantir:"palantir.com",netflix:"netflix.com",uber:"uber.com",stripe:"stripe.com",linear:"linear.app",openai:"openai.com",
  anthropic:"anthropic.com",tesla:"tesla.com",nvidia:"nvidia.com",airbnb:"airbnb.com",linkedin:"linkedin.com",atlassian:"atlassian.com",
  oracle:"oracle.com",ibm:"ibm.com",intel:"intel.com",cisco:"cisco.com",cloudflare:"cloudflare.com",notion:"notion.so",figma:"figma.com",
  slack:"slack.com",github:"github.com",dropbox:"dropbox.com",snap:"snap.com",x:"x.com",twitter:"twitter.com",tiktok:"tiktok.com",
  bytedance:"bytedance.com",pinterest:"pinterest.com",doordash:"doordash.com",instacart:"instacart.com",zoom:"zoom.us",
  rocketlane:"rocketlane.com",
};
function _domainFor(name) {
  if (!name) return "";
  const n = String(name).toLowerCase().trim();
  if (_COMPANY_DOMAINS[n]) return _COMPANY_DOMAINS[n];
  const slug = n.replace(/\s+/g, "").replace(/[^a-z0-9-]/g, "");
  return slug ? `${slug}.com` : "";
}
function badgeFor(t) {
  // Note: difficulty for DSA now lives in a hover-chip, not the badge.
  // The badge is just a status cue — "Pending" with a tiny bolt glyph.
  return `<span class="pending-glyph">⌁</span> Pending`;
}

function honestLine() {
  const lines = [
    "Day one of the chain. Place the first link.",
    "Yesterday is gone. Today is on the clock.",
    "You showed up. That's the baseline, not the win.",
    "Three days in a row. Now make it four.",
    "You know what you came here to do. Stop reading, start solving."
  ];
  return lines[new Date().getDate() % lines.length];
}

// Empty placeholder — real data is painted by paintWeekBars() after mount.
function weekBars() {
  return [0,0,0,0,0].map(() => `<div class="bar" style="height:0%;"><span style="height:0%;"></span></div>`).join("");
}

function paintWeekBars(root) {
  const barsEl = root.querySelector("#week-bars");
  const countEl = root.querySelector("#week-count");
  if (!barsEl) return;

  const dayLog = getDayLog();
  // Find this week's Monday
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  const days = [];
  let doneDays = 0;
  for (let i = 0; i < 5; i++) {           // Mon–Fri
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const key = calendarKey(d);
    const log = dayLog[key];
    const assigned = log?.assigned?.length || 0;
    const done = log?.done?.length || 0;
    const pct = assigned ? Math.round(100 * done / assigned) : 0;
    const isGreen = assigned && log.green;
    if (isGreen) doneDays++;
    const isFuture = d > today;
    days.push({ pct, isGreen, isFuture, assigned });
  }

  barsEl.innerHTML = days.map(({ pct, isGreen, isFuture, assigned }) => {
    const h = Math.max(pct, isFuture ? 0 : (assigned ? 8 : 0));  // tiny floor so "started" days have a visible bar
    const color = isGreen ? "var(--green)" : isFuture ? "var(--line2)" : (pct > 0 ? "var(--blue)" : "var(--line2)");
    return `<div class="bar" style="height:100%;"><span style="height:${h}%; background:${color};"></span></div>`;
  }).join("");

  if (countEl) countEl.textContent = `${doneDays} / 5`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }
  )[c]);
}

function styles() {
  return `
  <style>
    .today .honest-pill {
      display:inline-block; background: var(--blue-soft); color: var(--blue);
      font-size: 12px; font-weight: 600; letter-spacing: .02em;
      padding: 8px 14px; border-radius: 999px;
      margin-top: var(--s-2); margin-bottom: var(--s-5);
    }

    /* ---- Today motivation banner: paper-scroll aesthetic (distinct from Shop's dark bar) ---- */
    .today .today-mote {
      position: relative;
      display: grid; grid-template-columns: 180px 1fr;
      gap: var(--s-6);
      background:
        radial-gradient(circle at 10% 0%, rgba(227,168,26,.08), transparent 55%),
        radial-gradient(circle at 90% 100%, rgba(59,100,246,.07), transparent 55%),
        linear-gradient(180deg, #fffdf7, #faf8f1);
      border: 1px solid #e8e2cf;
      border-radius: var(--radius-lg);
      padding: var(--s-7) var(--s-7) var(--s-6);
      margin-bottom: var(--s-6);
      box-shadow: 0 1px 0 #fff inset, 0 10px 30px rgba(60, 40, 10, .06);
      overflow: hidden;
      animation: rise var(--dur-slow) var(--ease) both;
      max-width: 980px;
    }
    /* subtle grain texture lines */
    .today .today-mote::before {
      content: ""; position: absolute; inset: 0;
      background-image:
        repeating-linear-gradient(0deg, rgba(60,40,10,.015) 0 1px, transparent 1px 7px);
      pointer-events: none;
    }
    .today .tm-rail {
      display: flex; flex-direction: column; align-items: flex-start;
      padding-right: var(--s-4);
      border-right: 1px solid #ead9b2;
      position: relative;
    }
    .today .tm-notch {
      width: 8px; height: 8px; border-radius: 50%; background: var(--gold);
      box-shadow: 0 0 12px rgba(227,168,26,.4);
      margin-bottom: var(--s-3);
    }
    .today .tm-glyph {
      font-family: "Georgia", "Songti SC", "SimSun", serif;
      font-size: 72px; font-weight: 400; line-height: 1;
      color: var(--ink);
      text-shadow: 0 2px 0 rgba(227,168,26,.1);
      margin-bottom: var(--s-3);
      user-select: none;
    }
    .today .tm-tag {
      font-size: 10px; letter-spacing: .22em; font-weight: 700;
      color: #8b7a3d; text-transform: uppercase;
    }
    .today .tm-body {
      margin: 0; padding: 0 72px 0 0;  /* reserve right-side room for the seal */
      position: relative;
      font-family: "Georgia", "Charter", "Iowan Old Style", serif;
      font-size: 22px; line-height: 1.55; color: #1b1d22;
      font-style: italic;
    }
    .today .tm-mark-open, .today .tm-mark-close {
      font-family: Georgia, serif;
      font-size: 56px; line-height: 0; vertical-align: -22px;
      color: var(--gold); opacity: .55; font-style: normal;
      margin: 0 2px;
    }
    .today .tm-mark-close { vertical-align: -32px; }
    .today .tm-quote {
      display: inline;
      transition: opacity .3s var(--ease), transform .3s var(--ease);
    }
    .today .tm-seal {
      position: absolute; right: 24px; top: 24px;
      width: 42px; height: 42px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: #c0392b; color: #fff;
      font-size: 15px; font-weight: 700;
      box-shadow: 0 4px 14px rgba(192, 57, 43, .32);
      transform: rotate(-10deg);
      border: 2px dashed rgba(255,255,255,.5);
      pointer-events: none;  /* never blocks text */
    }

    /* ---- Dark-mode scroll: dark parchment, keep the Jianghu wuxia feel ---- */
    :root[data-theme="dark"] .today .today-mote {
      background:
        radial-gradient(circle at 10% 0%, rgba(240,184,51,.08), transparent 55%),
        radial-gradient(circle at 90% 100%, rgba(106,133,255,.05), transparent 55%),
        linear-gradient(180deg, #141720, #0e1116);
      border: 1px solid rgba(240,184,51,.18);
      box-shadow: 0 1px 0 rgba(240,184,51,.08) inset, 0 10px 30px rgba(0,0,0,.4);
    }
    :root[data-theme="dark"] .today .today-mote::before {
      background-image:
        repeating-linear-gradient(0deg, rgba(240,184,51,.03) 0 1px, transparent 1px 7px);
    }
    :root[data-theme="dark"] .today .tm-rail { border-right-color: rgba(240,184,51,.22); }
    :root[data-theme="dark"] .today .tm-glyph {
      color: var(--gold);
      text-shadow: 0 2px 0 rgba(0,0,0,.4);
    }
    :root[data-theme="dark"] .today .tm-tag { color: var(--gold); opacity: .85; }
    :root[data-theme="dark"] .today .tm-body { color: var(--ink); }
    :root[data-theme="dark"] .today .tm-mark-open,
    :root[data-theme="dark"] .today .tm-mark-close { color: var(--gold); opacity: .7; }

    @media (max-width: 760px) {
      .today .today-mote { grid-template-columns: 1fr; padding: var(--s-5); }
      .today .tm-rail { border-right: none; border-bottom: 1px solid #ead9b2; padding-right: 0; padding-bottom: var(--s-3); flex-direction: row; gap: var(--s-3); align-items: center; }
      .today .tm-glyph { font-size: 36px; margin: 0; }
      .today .tm-notch { margin: 0; }
      .today .tm-body { font-size: 18px; }
      .today .tm-seal { width: 36px; height: 36px; font-size: 14px; top: 10px; right: 10px; }
    }

    .today .main-grid {
      display: grid; grid-template-columns: minmax(0, 1fr) 360px;
      gap: var(--s-5); align-items: flex-start;
    }

    /* --- Today's plan card --- */
    .today .plan-card {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-lg);
      padding: var(--s-5) var(--s-5) var(--s-3);
      box-shadow: var(--shadow); animation: rise var(--dur-slow) var(--ease) both;
    }
    .today .plan-dots { display:flex; gap:6px; margin-bottom: var(--s-4); }
    .today .plan-dots span { width:12px; height:12px; border-radius:50%; display:block; }
    .today .plan-dots span:nth-child(1) { background:#ff5f57; }
    .today .plan-dots span:nth-child(2) { background:#febc2e; }
    .today .plan-dots span:nth-child(3) { background:var(--green); }

    .today .plan-head {
      display:flex; align-items:flex-start; justify-content: space-between;
      gap: var(--s-4); margin-bottom: var(--s-3);
    }
    .today .plan-title { font-size: 24px; font-weight: 700; margin: 0 0 4px; letter-spacing:-.01em; }
    .today .plan-sub { color: var(--mut); font-size: 13px; margin: 0; }
    .today .plan-meta { text-align:right; color: var(--mut); font-size: 12px; min-width: 140px; }
    .today .plan-meta b { color: var(--ink); display:block; font-size: 14px; margin-bottom: 6px; }
    .today .plan-bar { height: 6px; background: var(--line); border-radius: 999px; overflow:hidden; width: 140px; margin-left:auto; }
    .today .plan-bar > span { display:block; height:100%; width:0%; background: var(--blue); border-radius: 999px; transition: width .6s var(--ease); }

    .today .plan-rows { display:flex; flex-direction: column; }

    .today .task-row {
      display: grid; grid-template-columns: 32px minmax(0, 1fr) auto auto auto;
      gap: var(--s-4); align-items: center;
      padding: 18px var(--s-2); border-top: 1px solid var(--line);
      transition: background var(--dur-fast) var(--ease);
    }
    .today .task-row:first-child { border-top: none; }
    .today .task-row:hover { background: var(--bg); border-radius: 10px; }
    .today .task-main { min-width: 0; }
    .today .task-title { font-size: 15px; font-weight: 600; color: var(--ink); line-height: 1.4; }
    .today .task-meta  { font-size: 12.5px; color: var(--mut); margin-top: 4px; }
    .today .task-row.done .task-title { color: var(--mut); text-decoration: line-through; }
    .today .task-right { display: flex; align-items: center; gap: var(--s-3); }
    .today .chev { color: var(--mut); font-size: 14px; }
    .today .task-del {
      width: 24px; height: 24px; border-radius: 50%;
      border: 1px solid transparent; background: transparent; color: var(--mut);
      cursor: pointer; font: 600 15px/1 var(--font-sans);
      display: inline-flex; align-items: center; justify-content: center;
      opacity: 0; transition: all var(--dur-fast) var(--ease);
    }
    .today .task-row:hover .task-del { opacity: 1; }
    .today .task-del:hover { background: var(--red); color: #fff; border-color: var(--red); }
    .today .coin-val {
      font-size: 12px; font-weight: 700; color: var(--gold);
      background: var(--gold-soft); padding: 4px 10px; border-radius: 999px;
    }
    .today .badge {
      font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
      background: var(--line); color: var(--mut);
    }
    .today .badge.solved { background: var(--green-soft); color: var(--green); }
    .today .badge.progress { background: var(--blue-soft); color: var(--blue); }
    .today .badge-stars { letter-spacing: 1px; color: var(--gold); font-size: 10px; margin-left: 2px; }
    .today .pending-glyph {
      display: inline-block; margin-right: 2px;
      color: color-mix(in oklab, var(--mut) 70%, var(--gold));
      font-size: 11px; line-height: 1;
      transform: translateY(0.5px);
    }

    /* ---- Capture-state row (just ticked, awaiting confidence rating) ---- */
    .today .task-row.capture {
      background: linear-gradient(90deg, color-mix(in oklab, var(--gold) 10%, transparent), transparent 60%);
      border-radius: 10px;
      animation: captureGlow 1200ms ease-in-out infinite alternate;
    }
    @keyframes captureGlow {
      from { box-shadow: inset 3px 0 0 var(--gold); }
      to   { box-shadow: inset 3px 0 0 color-mix(in oklab, var(--gold) 70%, white); }
    }
    .today .task-row.capture .task-title { text-decoration: none; color: var(--ink); }
    .today .task-row.capture .badge { background: var(--gold-soft); color: var(--gold); }

    .today .confidence-prompt {
      display: flex; align-items: center; gap: 12px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed var(--line);
      animation: slideDownFade 220ms cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes slideDownFade {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .today .confidence-prompt .cp-label {
      font-size: 12.5px; font-weight: 600; color: var(--ink);
    }
    .today .confidence-prompt .stars {
      display: inline-flex; gap: 2px;
    }
    .today .confidence-prompt .star {
      border: none; background: none; cursor: pointer; padding: 2px 4px;
      font-size: 20px; line-height: 1; color: var(--line2);
      transition: transform var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .today .confidence-prompt .star:hover,
    .today .confidence-prompt .star.hover {
      color: var(--gold); transform: scale(1.15);
    }
    .today .confidence-prompt .cp-hint {
      font-size: 11px; color: var(--mut); margin-left: auto;
    }
    .today .confidence-prompt .cp-hint kbd {
      display: inline-block; padding: 1px 5px; margin: 0 1px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 4px;
      font: 500 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--ink);
    }

    /* ---- Warm-up quiz row (first row of plan) — Apple-sophisticated palette ---- */
    .today .task-row.warmup {
      position: relative;
      padding: 18px 20px;
      border-radius: 14px;
      margin-bottom: 10px;
      display: flex; align-items: center; gap: 16px;
      background: var(--paper);
      border: 1px solid var(--line);
      box-shadow:
        0 1px 2px rgba(0,0,0,.03),
        0 1px 0 rgba(255,255,255,.6) inset;
      overflow: hidden;
      transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
    }
    .today .task-row.warmup:hover {
      transform: translateY(-1px);
      border-color: color-mix(in oklab, var(--ink) 12%, var(--line));
      box-shadow:
        0 1px 2px rgba(0,0,0,.04),
        0 8px 24px rgba(0,0,0,.06),
        0 1px 0 rgba(255,255,255,.6) inset;
    }
    .today .task-row.warmup.done {
      background: color-mix(in oklab, var(--green) 4%, var(--paper));
      border-color: color-mix(in oklab, var(--green) 28%, var(--line));
    }

    .today .task-row.warmup .wu-card-ico {
      width: 48px; height: 48px; flex-shrink: 0;
      border-radius: 12px;
      background: color-mix(in oklab, var(--gold) 10%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--gold) 22%, var(--line));
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; color: var(--gold);
    }
    /* Subtle bolt breathing — Apple-y gentle, not neon */
    .today .task-row.warmup .wu-bolt {
      display: inline-block;
      animation: wuBoltBreath 3200ms ease-in-out infinite;
    }
    @keyframes wuBoltBreath {
      0%, 100% { opacity: .85; transform: scale(1); }
      50%      { opacity: 1;   transform: scale(1.06); }
    }
    .today .task-row.warmup.done .wu-bolt { animation: none; opacity: .5; }

    .today .task-row.warmup .task-main { min-width: 0; flex: 1; }
    .today .task-row.warmup .wu-pill-row {
      display: inline-flex; align-items: center; gap: 8px;
      margin-bottom: 7px;
    }
    .today .task-row.warmup .wu-provider {
      font: 600 9.5px/1 var(--font-sans);
      letter-spacing: .18em; text-transform: uppercase;
      padding: 3px 7px; border-radius: 4px;
      background: color-mix(in oklab, var(--ink) 5%, transparent);
      color: var(--mut);
    }
    .today .task-row.warmup .wu-title {
      font-size: 16px; font-weight: 600; color: var(--ink);
      letter-spacing: -.014em; line-height: 1.25;
    }
    .today .task-row.warmup .wu-meta {
      font-size: 12.5px; color: var(--mut); margin-top: 4px;
    }
    .today .task-row.warmup.done .wu-title {
      text-decoration: none; color: var(--mut);
    }

    .today .task-row.warmup .wu-coin-val {
      display: inline-flex; align-items: center;
      padding: 5px 11px; border-radius: 999px;
      background: color-mix(in oklab, var(--gold) 10%, transparent);
      color: var(--gold);
      font: 700 12.5px/1 var(--font-sans);
      white-space: nowrap;
      letter-spacing: -.005em;
    }
    .today .task-row.warmup .wu-right { display: flex; align-items: center; gap: 10px; }

    /* Button — SF-style: solid ink, subtle depth */
    .today .task-row.warmup .wu-start-btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 9px 18px;
      background: var(--ink); color: var(--paper);
      border: none; border-radius: 10px;
      cursor: pointer; font: 600 13px/1 var(--font-sans);
      letter-spacing: -.005em;
      box-shadow:
        0 1px 2px rgba(0,0,0,.1),
        0 1px 0 rgba(255,255,255,.1) inset;
      transition: all var(--dur-fast) var(--ease);
    }
    .today .task-row.warmup .wu-start-btn:hover {
      transform: translateY(-1px);
      box-shadow:
        0 4px 12px rgba(0,0,0,.14),
        0 1px 0 rgba(255,255,255,.14) inset;
    }
    .today .task-row.warmup .wu-start-btn:active { transform: translateY(0); }
    .today .task-row.warmup .wu-start-arrow {
      display: inline-block;
      transition: transform 240ms cubic-bezier(.2,1.2,.3,1);
    }
    .today .task-row.warmup .wu-start-btn:hover .wu-start-arrow { transform: translateX(3px); }

    /* WARM-UP pill — soft gold base + Apple-like shimmer sweep */
    .today .k-pill.k-warmup {
      position: relative;
      background: color-mix(in oklab, var(--gold) 12%, var(--paper));
      color: var(--gold);
      border: 1px solid color-mix(in oklab, var(--gold) 28%, transparent);
      padding: 3px 10px 3px 7px;
      overflow: hidden;
    }
    .today .k-pill.k-warmup::before {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(100deg,
        transparent 0%,
        transparent 40%,
        color-mix(in oklab, var(--gold) 32%, transparent) 50%,
        transparent 60%,
        transparent 100%);
      transform: translateX(-100%);
      animation: wuPillShimmer 4800ms ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes wuPillShimmer {
      0%, 70% { transform: translateX(-100%); }
      85%     { transform: translateX(100%); }
      100%    { transform: translateX(100%); }
    }

    /* Dark mode — single soft gold wash, nothing else */
    :root[data-theme="dark"] .today .task-row.warmup {
      background: color-mix(in oklab, var(--gold) 5%, var(--paper));
      border-color: color-mix(in oklab, var(--gold) 20%, var(--line));
    }
    :root[data-theme="dark"] .today .task-row.warmup .wu-card-ico {
      background: color-mix(in oklab, var(--gold) 14%, var(--paper));
    }

    /* ---- Spaced-repetition revisit row (REDO) ---- */
    .today .task-row.revisit {
      position: relative;
      padding-left: 12px;    /* breathing room between red bar and checkbox */
      background: linear-gradient(90deg, color-mix(in oklab, var(--red) 7%, transparent), transparent 60%);
    }
    .today .task-row.revisit::before {
      content: ""; position: absolute; left: 2px; top: 10px; bottom: 10px;
      width: 3px; background: var(--red); border-radius: 2px;
    }

    .today .checkbox {
      width: 26px; height: 26px; border-radius: 50%;
      border: 2px solid var(--line2); background: var(--paper); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all var(--dur-fast) var(--ease);
      padding: 0;
      position: relative; z-index: 2;
      pointer-events: auto !important;    /* beat any parent disable rule — must be clickable */
    }
    .today .checkbox:hover { border-color: var(--blue); }
    .today .checkbox.done { background: var(--green); border-color: var(--green); color: #fff; }
    .today .checkbox.done::after { content: "✓"; font-size: 13px; font-weight: 800; }
    /* Done rows: hovering the green ✓ shows an "undo" affordance so it's obvious it's clickable */
    .today .task-row.done .checkbox.done {
      cursor: pointer;
    }
    .today .task-row.done .checkbox.done:hover {
      background: var(--red); border-color: var(--red);
      transform: scale(1.08);
    }
    .today .task-row.done .checkbox.done:hover::after { content: "↶"; }

    .today .add-row {
      display:flex; align-items:center; gap: var(--s-3);
      padding: var(--s-3) var(--s-1); margin-top: var(--s-2);
      border-top: 1px solid var(--line);
    }
    .today .add-row .plus {
      width: 32px; height: 32px; border-radius: 50%;
      border: 1px dashed var(--line2); background: var(--paper);
      display:inline-flex; align-items:center; justify-content:center;
      color: var(--mut); cursor: pointer;
      font: 700 18px/1 var(--font-sans);
      transition: all var(--dur-fast) var(--ease);
    }
    .today .add-row .plus:hover { color: var(--blue); border-color: var(--blue); border-style: solid; }
    .today .add-row .plus.expanded {
      background: color-mix(in oklab, var(--blue) 10%, transparent);
      color: var(--blue); border-color: var(--blue); border-style: solid;
    }
    .today .add-row input {
      flex: 1; border: none; outline: none; background: transparent;
      font: inherit; color: var(--ink);
      width: 100%;
    }
    .today .add-row input::placeholder { color: var(--mut); }
    .today .add-input-wrap { position: relative; flex: 1; display: flex; flex-direction: column; }
    .today .add-pickchip[hidden] { display: none !important; }
    .today .add-pickchip {
      display: inline-flex; align-items: center; gap: 8px; align-self: flex-start;
      padding: 4px 8px 4px 10px; margin-bottom: 4px;
      background: color-mix(in oklab, var(--blue) 10%, transparent);
      border: 1px solid color-mix(in oklab, var(--blue) 32%, var(--line));
      border-radius: 6px;
      font: 600 11.5px/1.1 var(--font-sans); color: var(--blue);
      letter-spacing: .01em;
    }
    .today .add-suggest[hidden] { display: none !important; }
    .today .add-pickchip .apk-core { white-space: nowrap; }
    .today .add-pickchip .apk-redo {
      display: inline-block; margin-left: 6px;
      padding: 2px 5px; border-radius: 4px;
      background: var(--red); color: #fff; font: 700 9.5px/1 var(--font-sans); letter-spacing: .08em;
    }
    .today .add-pickchip .apk-x {
      border: none; background: transparent; cursor: pointer;
      color: var(--mut); font: 400 14px/1 var(--font-sans); padding: 0 2px;
      transition: color .14s;
    }
    .today .add-pickchip .apk-x:hover { color: var(--red); }
    .today .add-suggest {
      position: absolute; top: 100%; left: -4px; right: -4px; z-index: 50;
      margin-top: 6px;
      background: var(--paper); border: 1px solid var(--line2);
      border-radius: 10px;
      box-shadow: 0 14px 40px rgba(0,0,0,.14);
      max-height: 320px; overflow-y: auto;
      animation: addSuggFade .18s ease-out both;
    }
    @keyframes addSuggFade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .today .asg-item {
      padding: 9px 12px; cursor: pointer;
      border-bottom: 1px solid var(--line);
      display: flex; flex-direction: column; gap: 2px;
      transition: background .12s;
    }
    .today .asg-item:last-child { border-bottom: none; }
    .today .asg-item:hover, .today .asg-item.active { background: color-mix(in oklab, var(--blue) 7%, transparent); }
    .today .asg-item.solved { opacity: .62; }
    .today .asg-item.solved .asg-title { color: var(--mut); }
    .today .asg-title { font: 600 13px/1.3 var(--font-sans); color: var(--ink); }
    .today .asg-meta { font: 500 11px/1.3 var(--font-sans); color: var(--mut); letter-spacing: .01em; }
    .today .asg-high {
      display: inline-block; margin-left: 4px;
      padding: 1px 5px; border-radius: 3px;
      background: var(--gold); color: var(--paper);
      font: 700 9px/1 var(--font-sans); letter-spacing: .1em;
    }
    .today .asg-solved-tag {
      margin-left: 8px; font: 500 10.5px/1 var(--font-sans); color: var(--green); letter-spacing: .02em;
    }
    .today .asg-new {
      background: color-mix(in oklab, var(--gold) 6%, var(--paper));
      border-top: 1px dashed var(--line);
    }
    .today .asg-new .asg-title { color: var(--gold); font-weight: 700; }
    .today .asg-new.active { background: color-mix(in oklab, var(--gold) 14%, var(--paper)); }
    .today .asg-new b { color: var(--ink); }

    .today .add-row-ex {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-3);
      padding: var(--s-3) var(--s-1) var(--s-4);
      border-top: 1px dashed var(--line);
      background: var(--bg); border-radius: 0 0 var(--radius) var(--radius);
      margin: 0 calc(-1 * var(--s-5)) calc(-1 * var(--s-3));
      padding-left: var(--s-5); padding-right: var(--s-5);
      animation: rise var(--dur) var(--ease) both;
    }
    .today .add-row-ex .add-field { min-width: 0; }
    .today .add-row-ex .add-field label {
      display: block; font-size: 10px; letter-spacing: .14em; font-weight: 700;
      color: var(--mut); text-transform: uppercase; margin-bottom: 4px;
    }
    .today .add-row-ex .add-field input {
      width: 100%; padding: 8px 10px; border: 1px solid var(--line);
      border-radius: 10px; font: 500 13px/1.3 var(--font-sans);
      background: var(--paper); outline: none;
      transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
    }
    .today .add-row-ex .add-field input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px var(--blue-soft); }
    @media (max-width: 700px) {
      .today .add-row-ex { grid-template-columns: 1fr 1fr; }
    }

    /* --- right column --- */
    .today .side-col { display:flex; flex-direction: column; gap: var(--s-4); }
    .today .side-card {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
      padding: var(--s-4) var(--s-5); box-shadow: var(--shadow);
    }
    .today .side-card h3 { margin: 0 0 var(--s-3); font-size: 15px; font-weight: 700;
      display:flex; justify-content: space-between; align-items: center; }
    .today .side-card .arrow { color: var(--mut); font-size: 14px; }
    .today .activity-row { display:flex; align-items:flex-start; gap: var(--s-3); padding: var(--s-2) 0; }
    .today .activity-row.divider-top { border-top: 1px solid var(--line); margin-top: var(--s-2); padding-top: var(--s-3); }
    .today .dot-blue { width:10px; height:10px; border-radius:50%; background: var(--blue); margin-top:6px; }
    .today .doc-icon { width: 30px; height: 30px; border-radius: 8px; background: var(--line); display:inline-flex; align-items:center; justify-content:center; font-size:14px; }
    .today .act-t { font-size: 14px; font-weight: 600; }
    .today .act-s { font-size: 12px; color: var(--mut); margin-top: 2px; display:flex; justify-content: space-between; gap: var(--s-3); }
    .today .mini-bar { height: 4px; background: var(--line); border-radius: 999px; margin-top: var(--s-2); overflow: hidden; }
    .today .mini-bar > span { display:block; height:100%; background: var(--blue); border-radius: 999px; }

    .today .bars { display:flex; align-items:flex-end; gap: 10px; height: 72px; padding-top: 12px; }
    .today .bar { width: 22px; border-radius: 6px 6px 2px 2px; background: var(--line); position: relative; }
    .today .bar > span { display: block; width: 100%; background: var(--blue); border-radius: 6px 6px 2px 2px; position: absolute; bottom: 0; }
    .today .bar-labels { display: flex; gap: 10px; margin-top: 8px; color: var(--mut); font-size: 11px; }
    .today .bar-labels span { width: 22px; text-align: center; }

    .today .inventory .inv-row { display:flex; justify-content: space-between; padding: 8px 0;
      font-size: 13px; color: var(--ink); border-top: 1px solid var(--line); }
    .today .inventory .inv-row:first-of-type { border-top: none; }
    .today .inventory .inv-row b { font-weight: 700; }
    .today .inventory .inv-row.total { margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--line2); font-weight: 600; }

    @media (max-width: 1024px) {
      .today .main-grid { grid-template-columns: 1fr; }
      .today .side-col { flex-direction: row; flex-wrap: wrap; }
      .today .side-card { flex: 1 1 280px; }
    }
    @media (max-width: 700px) {
      .today .motivation-row { grid-template-columns: 1fr; }
    }

    /* ---- Add menu dropdown ---- */
    .today .add-menu-wrap { position: relative; }
    .today .add-menu {
      position: absolute; top: calc(100% + 6px); left: 0;
      background: var(--paper); border: 1px solid var(--line);
      border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.14);
      padding: 6px; z-index: 50; min-width: 300px;
    }
    .today .am-item {
      display: flex; align-items: flex-start; gap: 10px;
      width: 100%; padding: 10px 12px; background: transparent;
      border: none; border-radius: 8px; cursor: pointer; text-align: left;
      color: var(--ink); font: inherit;
    }
    .today .am-item:hover { background: var(--bg); }
    .today .am-item .am-icon {
      width: 28px; height: 28px; flex: 0 0 28px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--gold-soft); color: var(--gold);
      border-radius: 8px; font-size: 15px; font-weight: 700;
    }
    .today .am-item span:not(.am-icon) { display: flex; flex-direction: column; min-width: 0; }
    .today .am-item b { font-size: 13px; font-weight: 700; color: var(--ink); }
    .today .am-item small { font-size: 11px; color: var(--mut); margin-top: 2px; }

    /* ---- Sheet modal (new sheet / append CSV) ---- */
    .sheet-modal-back {
      position: fixed; inset: 0; background: rgba(0,0,0,.55);
      display: flex; align-items: center; justify-content: center; z-index: 1000;
      padding: 24px;
    }
    .sheet-modal {
      background: var(--paper); border: 1px solid var(--line);
      border-radius: 16px; padding: 24px; width: 100%; max-width: 520px;
      max-height: 86vh; overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,.3);
    }
    .sheet-modal h3 { margin: 0 0 4px; font-size: 18px; color: var(--ink); }
    .sheet-modal .sm-sub { color: var(--mut); font-size: 13px; margin: 0 0 20px; }
    .sheet-modal .sm-field { display: block; margin-bottom: 16px; }
    .sheet-modal .sm-field > span { display: block; font-size: 12px; font-weight: 600; color: var(--mut); margin-bottom: 6px; }
    .sheet-modal .sm-field input, .sheet-modal .sm-field select, .sheet-modal .sm-field textarea {
      width: 100%; box-sizing: border-box;
      padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--bg); color: var(--ink); font: inherit; resize: vertical;
    }
    .sheet-modal .sm-field small { display: block; color: var(--mut); font-size: 11px; margin-top: 6px; }
    .sheet-modal .sm-row { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
    .sheet-modal .sm-cancel {
      padding: 10px 18px; background: transparent; border: 1px solid var(--line);
      border-radius: 10px; color: var(--mut); cursor: pointer; font: inherit;
    }
    .sheet-modal .sm-create {
      padding: 10px 18px; background: var(--gold); color: #111;
      border: none; border-radius: 10px; cursor: pointer; font: 600 14px/1 var(--font-sans);
    }
    .sheet-modal .sm-err {
      margin-top: 12px; padding: 10px; background: var(--red-soft, rgba(239,68,68,.1));
      color: var(--red); border-radius: 8px; font-size: 13px;
    }
    .sheet-modal .sm-col-pill {
      display: inline-block; padding: 3px 8px; margin: 2px 4px 2px 0;
      background: var(--bg); border: 1px solid var(--line); border-radius: 999px;
      font-size: 11px; color: var(--mut);
    }
    .sheet-modal .sm-file-row {
      display: flex; align-items: center; gap: 10px;
    }
    .sheet-modal .sm-file-btn {
      padding: 8px 14px; background: var(--paper); border: 1px solid var(--line);
      border-radius: 8px; color: var(--ink); cursor: pointer; font: 600 13px/1 var(--font-sans);
    }
    .sheet-modal .sm-file-btn:hover { border-color: var(--gold); color: var(--gold); }
    .sheet-modal .sm-file-name { color: var(--mut); font-size: 12px; flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sheet-modal .sm-preview {
      margin-top: 4px; margin-bottom: 12px;
      padding: 10px 14px; background: var(--gold-soft); color: var(--ink);
      border-left: 3px solid var(--gold); border-radius: 6px; font-size: 13px;
    }
    .sheet-modal .sm-preview .mut { color: var(--mut); }

    /* ---- Next-day advance banner ---- */
    .today .next-day-banner {
      margin: 16px 0 0;
      padding: 14px 18px;
      background: linear-gradient(135deg, var(--gold-soft), var(--blue-soft));
      border: 1px solid var(--gold);
      border-radius: 12px;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
    }
    .today .next-day-banner .nd-text { color: var(--ink); font-size: 14px; }
    .today .next-day-banner .nd-text b { color: var(--gold); }
    .today .next-day-banner .nd-undo {
      padding: 8px 14px; background: var(--paper); color: var(--ink);
      border: 1px solid var(--line); border-radius: 8px; cursor: pointer;
      font: 600 12.5px/1 var(--font-sans);
      white-space: nowrap; transition: all var(--dur-fast) var(--ease);
    }

    /* ---- Rollover countdown chip (in plan-meta) ---- */
    .today .rollover-tag {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; margin-bottom: 10px;
      border-radius: 999px;
      font: 600 12px/1.1 var(--font-sans);
      background: var(--bg); color: var(--mut);
      border: 1px solid var(--line);
      transition: all var(--dur-fast) var(--ease);
      cursor: default;
    }
    .today .rollover-tag .rt-icon { font-size: 14px; }
    .today .rollover-tag .rt-time { font-weight: 700; letter-spacing: -.01em; }
    .today .rollover-tag small { font-size: 10.5px; opacity: .8; font-weight: 500; }
    .today .rollover-tag.rt-calm   { color: var(--mut); }
    .today .rollover-tag.rt-warn   { color: var(--gold); background: var(--gold-soft); border-color: var(--gold); }
    .today .rollover-tag.rt-urgent {
      color: #fff; background: var(--red); border-color: var(--red);
      animation: rtPulse 1200ms ease-in-out infinite;
    }
    @keyframes rtPulse {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--red) 55%, transparent); }
      50%      { box-shadow: 0 0 0 6px color-mix(in oklab, var(--red) 0%, transparent); }
    }

    /* ---- Streak-at-risk banner (above plan rows when < 2h left) ---- */
    .today .risk-banner {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; margin: 12px 0 8px;
      padding: 14px 18px;
      background: linear-gradient(135deg, var(--gold-soft), color-mix(in oklab, var(--gold) 15%, transparent));
      border: 1px solid var(--gold); border-radius: 12px;
      animation: slideDownFade 220ms cubic-bezier(.2,1.2,.3,1) both;
    }
    .today .risk-banner.critical {
      background: linear-gradient(135deg, color-mix(in oklab, var(--red) 15%, transparent), color-mix(in oklab, var(--red) 25%, transparent));
      border-color: var(--red);
      animation: slideDownFade 220ms cubic-bezier(.2,1.2,.3,1) both,
                 riskPulse 1800ms ease-in-out 400ms infinite;
    }
    @keyframes riskPulse {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--red) 25%, transparent); }
      50%      { box-shadow: 0 0 0 10px color-mix(in oklab, var(--red) 0%, transparent); }
    }
    .today .risk-banner .rb-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .today .risk-banner .rb-ico { font-size: 22px; }
    .today .risk-banner .rb-title { font-size: 14px; font-weight: 700; color: var(--ink); }
    .today .risk-banner.critical .rb-title { color: var(--red); }
    .today .risk-banner .rb-sub { font-size: 12px; color: var(--mut); margin-top: 2px; }
    .today .risk-banner .rb-focus {
      padding: 8px 16px;
      background: var(--ink); color: var(--paper);
      border: none; border-radius: 8px; cursor: pointer;
      font: 600 12.5px/1 var(--font-sans); white-space: nowrap;
      transition: all var(--dur-fast) var(--ease);
    }
    .today .risk-banner.critical .rb-focus { background: var(--red); color: #fff; }
    .today .risk-banner .rb-focus:hover { transform: translateY(-1px); filter: brightness(1.08); }
    .today .next-day-banner .nd-undo:hover {
      border-color: var(--gold); color: var(--gold); background: var(--gold-soft);
    }

    /* ---- History button + popup ---- */
    .today .plan-title { display: inline-flex; align-items: center; gap: 10px; }
    .today .hist-btn {
      padding: 4px 8px; background: var(--bg); border: 1px solid var(--line);
      border-radius: 8px; cursor: pointer; font-size: 14px;
      transition: all var(--dur-fast) var(--ease);
    }
    .today .hist-btn:hover { background: var(--gold-soft); border-color: var(--gold); }
    .hist-pop {
      position: fixed; z-index: 500;
      background: var(--paper); border: 1px solid var(--line);
      border-radius: 12px; padding: 6px; min-width: 240px;
      box-shadow: 0 20px 44px rgba(0,0,0,.14);
      animation: histPop 180ms cubic-bezier(.2,1.2,.3,1);
    }
    @keyframes histPop {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .hist-pop .hist-head {
      padding: 10px 12px 6px; font: 700 10.5px/1 var(--font-sans);
      letter-spacing: .1em; text-transform: uppercase; color: var(--mut);
    }
    .hist-pop .hist-item {
      display: flex; justify-content: space-between; align-items: center;
      width: 100%; padding: 10px 12px; background: transparent;
      border: none; border-radius: 8px; cursor: pointer;
      font: 500 13px/1 var(--font-sans); color: var(--ink);
      transition: background var(--dur-fast) var(--ease);
    }
    .hist-pop .hist-item:hover { background: var(--bg); }
    .hist-pop .hist-item .hi-date { font-weight: 600; }
    .hist-pop .hist-item .hi-stat { font-size: 11.5px; color: var(--mut); font-variant-numeric: tabular-nums; }
    .hist-pop .hist-item.hi-green .hi-stat { color: var(--green); }
    .hist-pop .hist-item.hi-amber .hi-stat { color: var(--gold); }
    .hist-pop .hist-item.hi-red   .hi-stat { color: var(--red); }
    .hist-toast {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      padding: 10px 18px; background: var(--ink); color: var(--paper);
      border-radius: 999px; font: 600 12.5px/1 var(--font-sans);
      z-index: 500;
    }

    .today .next-day-banner.past-banner {
      background: linear-gradient(135deg, color-mix(in oklab, var(--blue) 10%, transparent), color-mix(in oklab, var(--blue) 4%, transparent));
      border-color: var(--blue);
    }
    .today .next-day-banner.past-banner .nd-text b { color: var(--blue); }

    /* ---- Micro-confetti (★5 burst) ---- */
    .micro-confetti {
      position: fixed; z-index: 9999;
      font-size: 16px; color: var(--gold);
      pointer-events: none; user-select: none;
      text-shadow: 0 0 8px color-mix(in oklab, var(--gold) 60%, transparent);
      will-change: transform, opacity;
    }

    /* ---- Suggest a task button (below plan rows, above add row) ---- */
    .today .suggest-row {
      display: flex; justify-content: center; align-items: center; gap: 10px;
      margin: 14px 0 10px;
      position: relative;
      flex-wrap: wrap;
    }

    /* Review today's recap button — same shape as suggest-btn, gold accent instead of blue */
    .today .recap-btn {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 12px 20px; border-radius: 12px;
      background: var(--paper); border: 1px dashed color-mix(in oklab, var(--gold) 42%, var(--line));
      color: var(--mut); cursor: pointer;
      font: 600 13.5px/1 var(--font-sans); letter-spacing: -.005em;
      transition: all .18s;
    }
    .today .recap-btn:hover { color: var(--ink); border-color: var(--gold); border-style: solid; background: color-mix(in oklab, var(--gold) 7%, var(--paper)); transform: translateY(-1px); }
    .today .recap-btn .rb-ic { color: var(--gold); font-size: 16px; line-height: 1; }
    .today .recap-btn .rb-text { font-weight: 700; color: var(--ink); }
    .today .recap-btn .rb-hint { color: var(--mut); font-size: 11px; font-weight: 500; letter-spacing: .01em; }
    @media (max-width: 720px) {
      .today .recap-btn .rb-hint { display: none; }
    }
    .today .more-wrap { position: relative; display: inline-block; }
    .today .more-btn {
      width: 36px; height: 36px;
      border-radius: 50%;
      background: var(--paper); border: 1px solid var(--line);
      color: var(--mut); cursor: pointer;
      font: 700 16px/1 var(--font-sans); letter-spacing: 2px;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all var(--dur-fast) var(--ease);
    }
    .today .more-btn:hover {
      color: var(--ink); border-color: var(--line2);
      transform: translateY(-1px);
    }
    .today .more-pop {
      position: absolute; bottom: calc(100% + 10px); right: -2px;
      z-index: 60;
      min-width: 280px; max-width: 320px;
      background: var(--paper); border: 1px solid var(--line);
      border-radius: 14px; padding: 6px;
      box-shadow: 0 24px 48px rgba(0,0,0,.16), 0 0 0 1px color-mix(in oklab, var(--line) 60%, transparent);
      animation: morePopIn 200ms cubic-bezier(.2,1.2,.3,1);
    }
    /* Little triangle pointer at the bottom-right, points at the ⋯ button */
    .today .more-pop::after {
      content: ""; position: absolute;
      bottom: -7px; right: 14px;
      width: 12px; height: 12px;
      background: var(--paper);
      border-right: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      transform: rotate(45deg);
      border-radius: 0 0 3px 0;
    }
    @keyframes morePopIn {
      from { opacity: 0; transform: translateY(4px) scale(.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .today .more-item {
      display: flex; align-items: flex-start; gap: 10px;
      width: 100%; padding: 10px 12px; background: transparent;
      border: none; border-radius: 8px; cursor: pointer;
      font: inherit; color: var(--ink); text-align: left;
      transition: background .18s;
    }
    .today .more-item:hover { background: var(--bg); }
    .today .more-item .mi-ic {
      width: 28px; height: 28px; flex-shrink: 0;
      border-radius: 8px;
      background: color-mix(in oklab, var(--red) 10%, transparent);
      color: var(--red);
      display: inline-flex; align-items: center; justify-content: center;
      font: 700 14px/1 var(--font-sans);
    }
    .today .more-item .mi-ic.mi-ic-lc {
      background: color-mix(in oklab, var(--gold) 14%, transparent);
      color: var(--gold);
      font: 700 10px/1 var(--font-sans); letter-spacing: .04em;
    }
    .today .more-item .mi-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .today .more-item .mi-main b { font-size: 13px; font-weight: 700; color: var(--ink); }
    .today .more-item .mi-main small { font-size: 11.5px; color: var(--mut); }

    .row-toast {
      position: fixed; bottom: 32px; left: 50%; transform: translate(-50%, 16px);
      padding: 12px 20px; background: var(--ink); color: var(--paper);
      border-radius: 999px; font: 600 13px/1 var(--font-sans);
      z-index: 1400; opacity: 0;
      box-shadow: 0 12px 32px rgba(0,0,0,.3);
      transition: all .24s cubic-bezier(.2,1.2,.3,1);
    }
    .row-toast.show { opacity: 1; transform: translate(-50%, 0); }
    .today .suggest-btn {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 10px 20px;
      background: var(--paper);
      border: 1px dashed color-mix(in oklab, var(--gold) 36%, var(--line));
      border-radius: 999px;
      color: var(--mut);
      font: 600 12.5px/1 var(--font-sans); letter-spacing: -.005em;
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .today .suggest-btn:hover {
      border-color: var(--gold); color: var(--gold);
      background: color-mix(in oklab, var(--gold) 6%, var(--paper));
      transform: translateY(-1px);
    }
    .today .suggest-btn .sb-ic {
      font-size: 14px; color: var(--gold);
      animation: sbPulse 3200ms ease-in-out infinite;
    }
    @keyframes sbPulse {
      0%, 100% { opacity: .7; transform: scale(1); }
      50%      { opacity: 1;  transform: scale(1.14); }
    }
    .today .suggest-btn .sb-text { color: var(--ink); font-weight: 600; }
    .today .suggest-btn .sb-hint {
      color: var(--mut); font-size: 10.5px; font-weight: 500;
      padding-left: 10px; border-left: 1px solid var(--line);
    }
    .today .suggest-row.glow .suggest-btn {
      border-style: solid; border-color: var(--gold);
      background: color-mix(in oklab, var(--gold) 10%, var(--paper));
      box-shadow: 0 0 0 0 color-mix(in oklab, var(--gold) 55%, transparent);
      animation: sbGlow 1800ms ease-in-out infinite;
    }
    .today .suggest-row.glow .sb-ic { animation-duration: 1600ms; }
    @keyframes sbGlow {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--gold) 45%, transparent); }
      50%      { box-shadow: 0 0 0 10px color-mix(in oklab, var(--gold) 0%, transparent); }
    }

    /* SUGGESTED pill — purple-gold, differentiates from NEW/REDO */
    .today .k-pill.k-suggested {
      background: linear-gradient(135deg,
        color-mix(in oklab, var(--gold) 14%, var(--paper)),
        color-mix(in oklab, var(--blue) 10%, var(--paper)));
      color: var(--gold);
      border: 1px solid color-mix(in oklab, var(--gold) 32%, transparent);
    }

    /* ---- Review-override strip ("Bring it back?") ---- */
    .today .review-strip {
      display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
      margin-top: 8px; padding: 8px 10px;
      background: color-mix(in oklab, var(--blue) 5%, var(--paper));
      border: 1px dashed color-mix(in oklab, var(--blue) 28%, transparent);
      border-radius: 10px;
      animation: slideDownFade 220ms cubic-bezier(.2,1.2,.3,1) both;
    }
    .today .review-strip .rs-label {
      font-size: 11px; font-weight: 700; letter-spacing: .06em;
      text-transform: uppercase; color: var(--mut); margin-right: 6px;
    }
    .today .review-strip .rs-chip {
      padding: 5px 11px; background: var(--paper); border: 1px solid var(--line);
      color: var(--mut); font: 600 11.5px/1 var(--font-sans);
      border-radius: 999px; cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .today .review-strip .rs-chip:hover {
      color: var(--blue); border-color: var(--blue); background: var(--blue-soft);
      transform: translateY(-1px);
    }
    .today .review-strip .rs-chip-done:hover {
      color: var(--green); border-color: var(--green);
      background: var(--green-soft);
    }

    .today .review-set {
      display: inline-flex; align-items: center; gap: 7px;
      margin-top: 7px;
      font-size: 11.5px; color: var(--mut);
    }
    .today .review-set b { color: var(--blue); font-weight: 700; }
    .today .review-set .rs-set-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--blue);
    }
    .today .review-set .rs-undo {
      background: transparent; border: none; cursor: pointer;
      color: var(--mut); font: 500 11px/1 var(--font-sans);
      text-decoration: underline; text-decoration-color: color-mix(in oklab, var(--mut) 40%, transparent);
      padding: 0 2px;
    }
    .today .review-set .rs-undo:hover { color: var(--ink); text-decoration-color: var(--ink); }

    /* Keyboard-focus visual on a row (j/k nav) */
    .today .task-row.kb-focus {
      box-shadow: inset 3px 0 0 var(--blue), 0 0 0 2px color-mix(in oklab, var(--blue) 30%, transparent);
      background: color-mix(in oklab, var(--blue) 4%, transparent);
      border-radius: 10px;
    }

    /* ---- Session timer button ---- */
    /* Zero-width placeholder for non-study rows so the grid stays consistent. */
    .today .task-timer-slot { display: inline-block; width: 0; }
    .today .task-timer {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 9px; margin: 0 2px;
      background: var(--bg); border: 1px solid var(--line);
      color: var(--mut); cursor: pointer;
      font: 600 11px/1 var(--font-sans); font-variant-numeric: tabular-nums;
      border-radius: 7px;
      transition: all var(--dur-fast) var(--ease);
      opacity: 1;    /* always visible — consistent across all study rows */
    }
    .today .task-timer:hover {
      color: var(--ink); border-color: var(--line2);
      background: var(--paper);
    }
    .today .task-timer.running {
      color: var(--gold); border-color: color-mix(in oklab, var(--gold) 32%, transparent);
      background: var(--gold-soft);
    }
    .today .task-timer.running:hover {
      border-color: var(--gold);
    }
    .today .task-timer .tt-ico { font-size: 10px; line-height: 1; }
    .today .task-timer .tt-time { letter-spacing: -.01em; }
    /* Done rows — timer is locked (dim + non-interactive), still shows elapsed */
    .today .task-row.done .task-timer {
      opacity: .45; cursor: not-allowed; pointer-events: none;
      border-style: dashed;
      background: transparent;
    }

    /* ---- Done rows — everything locked except the checkbox + delete button ---- */
    /* Learn chip, timer, Difficulty/LC chips become visibly inert. */
    .today .task-row.done .hover-chip,
    .today .task-row.done .task-timer {
      opacity: .4; pointer-events: none; cursor: default;
    }
    /* Row cursor hints: on done rows the title area doesn't act like a button. */
    .today .task-row.done { cursor: default; }
    .today .task-row.done .task-main { cursor: default; }

    /* ---- Hover-only chips (difficulty, LC#, freq) ---- */
    .today .task-title-row {
      display: flex; align-items: center; gap: 10px; flex-wrap: nowrap;
    }
    .today .task-title-row .task-title { flex: 0 1 auto; min-width: 0; }
    .today .hover-chips {
      display: inline-flex; align-items: center; gap: 5px;
      opacity: 0; transform: translateX(-4px);
      transition: opacity 220ms cubic-bezier(.2,1.2,.3,1), transform 220ms cubic-bezier(.2,1.2,.3,1);
      pointer-events: none;
    }
    .today .task-row:hover .hover-chips,
    .today .task-row:focus-within .hover-chips {
      opacity: 1; transform: translateX(0);
    }
    /* Company logo mini-chips — always visible on task rows */
    .today .task-companies {
      display: inline-flex; align-items: center; gap: 3px;
      margin-left: 6px; flex-shrink: 0;
    }
    .today .task-company {
      display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; border-radius: 50%;
      overflow: hidden;
      background: #fff; border: 1px solid var(--line);
      flex-shrink: 0; box-shadow: 0 1px 2px rgba(0,0,0,.04);
    }
    .today .task-company img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .today .hover-chip {
      padding: 2px 8px; border-radius: 6px;
      font: 600 10.5px/1.3 var(--font-sans);
      letter-spacing: .01em; white-space: nowrap;
      background: color-mix(in oklab, var(--ink) 5%, transparent);
      color: var(--mut);
      border: 1px solid color-mix(in oklab, var(--ink) 6%, transparent);
    }
    .today .hover-chip.hc-diff.hc-easy   { color: var(--green); background: color-mix(in oklab, var(--green) 10%, transparent); border-color: color-mix(in oklab, var(--green) 20%, transparent); }
    .today .hover-chip.hc-diff.hc-medium { color: var(--gold); background: color-mix(in oklab, var(--gold) 10%, transparent); border-color: color-mix(in oklab, var(--gold) 22%, transparent); }
    .today .hover-chip.hc-diff.hc-hard   { color: var(--red); background: color-mix(in oklab, var(--red) 10%, transparent); border-color: color-mix(in oklab, var(--red) 22%, transparent); }
    .today .hover-chip.hc-lc    { color: var(--blue); background: var(--blue-soft); border-color: color-mix(in oklab, var(--blue) 20%, transparent); font-variant-numeric: tabular-nums; }
    .today .hover-chip.hc-freq  { color: var(--red); background: color-mix(in oklab, var(--red) 12%, transparent); border-color: color-mix(in oklab, var(--red) 24%, transparent); letter-spacing: .06em; }
    /* ✦ Learn chip — becomes clickable button; pointer-events override for the chip itself */
    .today .task-row:hover .hover-chip.hc-learn,
    .today .task-row:focus-within .hover-chip.hc-learn {
      pointer-events: auto;
    }
    .today .hover-chip.hc-learn {
      cursor: pointer; font: 600 10.5px/1.3 var(--font-sans);
      color: var(--gold); background: color-mix(in oklab, var(--gold) 10%, transparent);
      border-color: color-mix(in oklab, var(--gold) 22%, transparent);
    }
    .today .hover-chip.hc-learn:hover {
      background: color-mix(in oklab, var(--gold) 18%, transparent);
      border-color: var(--gold);
      transform: translateY(-1px);
    }

    /* ---- NEW / REDO pills (kind indicators on task rows) ---- */
    .today .k-pill {
      display: inline-block;
      padding: 2px 8px; margin-right: 8px;
      border-radius: 999px;
      font-size: 10px; font-weight: 800;
      letter-spacing: .08em;
      vertical-align: middle;
      line-height: 1.5;
    }
    .today .k-pill.k-new {
      background: var(--green-soft); color: var(--green);
    }
    .today .k-pill.k-redo {
      background: color-mix(in oklab, var(--red) 14%, transparent);
      color: var(--red);
    }
    .today .k-pill.k-carried {
      background: color-mix(in oklab, var(--blue) 10%, transparent);
      color: var(--blue);
      border: 1px solid color-mix(in oklab, var(--blue) 22%, transparent);
    }
    .today .k-pill.k-wildcard {
      background: color-mix(in oklab, #8b4bff 14%, transparent);
      color: #8b4bff;
      border: 1px solid color-mix(in oklab, #8b4bff 32%, transparent);
    }
    .today .task-row.done .k-pill { opacity: .55; }
  </style>
  `;
}
