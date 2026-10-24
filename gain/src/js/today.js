// Today screen — hero + motivation + Today's plan card (tick → bank ₹).
// Daily engine lives in engine.js; full celebration + add-task in Part 3.

import { getSettings, getSheets, getDayLog, updateWallet, getWallet, on, getMotivations, updateSheetRow } from "./store.js";
import { ensureDailyPlan, tickTask, untickTask, todayKey, calendarKey, activeKey, nextDayKey, hoursToRollover, isGreenWeek, isGreenMonth, wasWeekFired, wasMonthFired, markWeekFired, markMonthFired, setConfidence, getConfidence } from "./engine.js";
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
      if (ev === "dayLog" || ev === "wallet") paintPlan(root);
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
                <h2 class="plan-title">Today's plan</h2>
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
            <div class="add-row">
              <button class="plus" id="add-task-toggle" aria-label="Task options" aria-expanded="false" title="Options · minutes, bounty, kind, status">+</button>
              <input id="add-task-input" placeholder="Add a one-off task for today…" />
              <button class="icon-btn" id="add-task-btn" aria-label="Add">→</button>
            </div>
            <div class="add-row-ex" id="add-row-ex" hidden>
              <div class="add-field">
                <label>Kind</label>
                <select id="at-kind">
                  <option value="dsa">DSA problem</option>
                  <option value="sql">SQL problem</option>
                  <option value="sd">System design</option>
                  <option value="int">Integration</option>
                  <option value="ext">Interview extra</option>
                  <option value="revision" selected>Revision / quick</option>
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

function paintPlan(root) {
  const dateKey = activeKey();
  const day = getDayLog()[dateKey];
  if (!day) return;

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
    const needsRating = done && rating == null;  // "capture state"
    const isRevisit = t.kind === "revisit";
    const isNewStudy = ["dsa", "sd", "int", "ext", "sql"].includes(t.kind) && !isRevisit;
    const kindPill = isRevisit
      ? `<span class="k-pill k-redo" title="Spaced-repetition revisit — lock memory in">↻ REDO</span>`
      : isNewStudy
        ? `<span class="k-pill k-new" title="New problem">✦ NEW</span>`
        : "";
    return `
      <div class="task-row ${done ? "done" : ""} ${needsRating ? "capture" : ""} ${isRevisit ? "revisit" : ""}" data-ref="${esc(t.ref)}">
        <button class="checkbox ${done ? "done" : ""}" data-ref="${esc(t.ref)}" aria-label="Toggle ${esc(t.title)}"></button>
        <div class="task-main">
          <div class="task-title">${kindPill}${kindPill ? " " : ""}${esc(t.title)}</div>
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
        </div>
        <div class="coin-val">+ ₹${t.value}</div>
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

  // "Working ahead" banner — the current calendar GAIN day is done, we've
  // auto-rolled to tomorrow's plan. Shown above the task list.
  const realToday = todayKey();
  let bannerEl = root.querySelector("#next-day-banner");
  if (dateKey !== realToday) {
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
  } else {
    if (bannerEl) bannerEl.remove();
    subEl.textContent = totalTasks ? `${totalTasks} focused task${totalTasks === 1 ? "" : "s"}. Real progress.` : "No plan generated.";
  }
  cntEl.textContent = `${doneTasks} of ${totalTasks} complete`;
  prEl.style.width = `${pct}%`;

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
  // Click anywhere on the task row (except interactive bits) also toggles.
  rowsEl.querySelectorAll(".task-row").forEach(row => {
    row.addEventListener("click", async (e) => {
      if (e.target.closest("button.checkbox")) return;
      if (e.target.closest("button.task-del")) return;
      if (e.target.closest(".badge, .chev, .coin-val")) return;
      if (e.target.closest(".confidence-prompt, .star")) return;  // let stars handle their own clicks
      const btn = row.querySelector("button.checkbox");
      if (btn) await handleTick(btn, root);
    });
  });
}

async function handleDelete(ref, root) {
  const { updateDayLog } = await import("./store.js");
  const dateKey = activeKey();
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
  const dateKey = activeKey();
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
  const dateKey = activeKey();
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
  const dateKey = activeKey();
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
    await tickTask(dateKey, ref);
    const sourceKey = task.sheet && task.rowIndex != null ? `${task.sheet}#${task.rowIndex}` : null;
    await updateWallet(w => {
      w.earned += task.value;
      w.ledger.push({
        date: new Date().toISOString(), type: "task",
        amount: task.value, label: task.title,
        sourceKey   // claim this sheet row — problem page won't re-bank it
      });
    });
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
    // make sure tomorrow's plan exists so the next re-paint flips to it.
    const after = getDayLog()[dateKey];
    if (after && after.assigned.length > 0 && after.done.length >= after.assigned.length) {
      await ensureDailyPlan(nextDayKey());
      paintPlan(root);
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

  addToggle?.addEventListener("click", () => {
    const expanded = !addEx.hidden;
    addEx.hidden = expanded;
    addToggle.setAttribute("aria-expanded", String(!expanded));
    addToggle.classList.toggle("expanded", !expanded);
    if (!expanded) setTimeout(() => addInput.focus(), 20);
  });

  const commit = async () => {
    const val = (addInput?.value || "").trim();
    if (!val) return;
    const { updateDayLog, KIND_TO_SHEET, addSheetRow, updateSheetRow, getSheets } = await import("./store.js");
    const dateKey = activeKey();
    const ref = `ADHOC-${Date.now()}`;

    // Pull expanded config if the panel is open; else sensible defaults
    const kind = addEx.hidden ? "revision" : (root.querySelector("#at-kind")?.value || "revision");
    const minutes = Number(addEx.hidden ? 15 : (root.querySelector("#at-min")?.value || 15));
    const value = Number(addEx.hidden ? getSettings().wallet.taskMin : (root.querySelector("#at-value")?.value || getSettings().wallet.taskMin));
    const preDone = !addEx.hidden && root.querySelector("#at-status")?.value === "done";

    // Link to a sheet row when the kind maps to one (dsa/sd/int/ext).
    // Matches an existing row by title; otherwise appends a new row.
    let sheetName = null;
    let rowIndex = null;
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

    await updateDayLog(dl => {
      const d = dl[dateKey];
      if (!d) return;
      const t = { ref, kind, title: val, minutes, value, sheet: sheetName, rowIndex };
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
    paintPlan(root);
  };
  addBtn?.addEventListener("click", commit);
  addInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });

  // jump to Settings for target edits
  root.querySelector("#to-settings")?.addEventListener("click", () => { location.hash = "#settings"; });
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

function subFor(t) {
  if (t.kind === "dsa")      return `${t.pattern || "DSA"} · ${t.minutes} min${t.lc ? " · LC #" + t.lc : ""}`;
  if (t.kind === "revision") return `DSA · ${t.minutes} min quiz`;
  if (t.kind === "log")      return `Progress · Update the sheet`;
  if (t.kind === "sd")       return `System Design · ${t.minutes} min`;
  if (t.kind === "int")      return `Integrations · ${t.minutes} min`;
  if (t.kind === "ext")      return `${t.pattern || "Interview Extras"} · ${t.minutes} min`;
  return `${t.minutes || 15} min`;
}
function badgeFor(t) {
  if (t.kind === "dsa") return t.difficulty || "Not started";
  return "Not started";
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
      display: grid; grid-template-columns: 32px 1fr auto auto;
      gap: var(--s-3); align-items: center;
      padding: var(--s-3) var(--s-1); border-top: 1px solid var(--line);
      transition: background var(--dur-fast) var(--ease);
    }
    .today .task-row:first-child { border-top: none; }
    .today .task-row:hover { background: var(--bg); border-radius: 10px; }
    .today .task-main { min-width: 0; }
    .today .task-title { font-size: 15px; font-weight: 600; color: var(--ink); }
    .today .task-meta  { font-size: 12px; color: var(--mut); margin-top: 2px; }
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

    /* ---- Spaced-repetition revisit row (REDO) ---- */
    .today .task-row.revisit {
      position: relative;
      background: linear-gradient(90deg, color-mix(in oklab, var(--red) 7%, transparent), transparent 60%);
    }
    .today .task-row.revisit::before {
      content: ""; position: absolute; left: 0; top: 10px; bottom: 10px;
      width: 3px; background: var(--red); border-radius: 2px;
    }

    .today .checkbox {
      width: 26px; height: 26px; border-radius: 50%;
      border: 2px solid var(--line2); background: var(--paper); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all var(--dur-fast) var(--ease);
      padding: 0;
    }
    .today .checkbox:hover { border-color: var(--blue); }
    .today .checkbox.done { background: var(--green); border-color: var(--green); color: #fff; }
    .today .checkbox.done::after { content: "✓"; font-size: 13px; font-weight: 800; }

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
      background: var(--blue); color: #fff; border-color: var(--blue); border-style: solid;
      transform: rotate(45deg);
    }
    .today .add-row input {
      flex: 1; border: none; outline: none; background: transparent;
      font: inherit; color: var(--ink);
    }
    .today .add-row input::placeholder { color: var(--mut); }

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

    /* ---- Micro-confetti (★5 burst) ---- */
    .micro-confetti {
      position: fixed; z-index: 9999;
      font-size: 16px; color: var(--gold);
      pointer-events: none; user-select: none;
      text-shadow: 0 0 8px color-mix(in oklab, var(--gold) 60%, transparent);
      will-change: transform, opacity;
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
    .today .task-row.done .k-pill { opacity: .55; }
  </style>
  `;
}
