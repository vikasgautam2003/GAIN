// Dashboard — the new landing screen.
// High-level view: streak + wallet + sheets progress + upcoming + insights.
// Clean, informative, project-management-app style. Not cluttered.

import { getSettings, getSheets, getDayLog, getWallet, on } from "./store.js";
import { computeStreak, longestStreak, todayKey, calendarKey, ensureDailyPlan } from "./engine.js";

let unsub = null;

export default {
  async mount(root) {
    await ensureDailyPlan();
    root.innerHTML = render();
    paint(root);
    attach(root);
    if (unsub) unsub();
    unsub = on((ev) => { if (ev === "dayLog" || ev === "wallet" || ev === "sheet" || ev === "settings") paint(root); });
  },
  unmount() { if (unsub) { unsub(); unsub = null; } }
};

function render() {
  return `
    <div class="view-inner dash">
      <!-- Streak-at-risk slot (populated only when applicable) -->
      <div id="streak-risk-slot"></div>

      <!-- Hero row: greeting + date + today's grind quick-start -->
      <section class="dash-hero">
        <div class="dash-hero-left">
          <div class="dash-eyebrow" id="date-eyebrow"></div>
          <h1 class="dash-greeting" id="greeting">Hello.</h1>
          <p class="dash-sub" id="dash-sub">—</p>
        </div>
        <div class="dash-hero-right">
          <a href="#today" class="dash-cta">
            <span class="dash-cta-lb">TODAY'S GRIND</span>
            <span class="dash-cta-title" id="plan-headline">—</span>
            <span class="dash-cta-arrow">→</span>
          </a>
        </div>
      </section>

      <!-- Primary KPI tiles -->
      <section class="dash-kpis">
        <div class="kpi kpi-streak alive" id="k-streak">
          <div class="kpi-lb">STREAK</div>
          <div class="kpi-val"><span id="streak-val">0</span><span class="kpi-flame">🔥</span></div>
          <div class="kpi-sub"><span id="longest-val">0</span> best</div>
        </div>
        <div class="kpi kpi-wallet alive">
          <div class="kpi-lb">AVAILABLE ₹</div>
          <div class="kpi-val" id="wallet-val">0</div>
          <div class="kpi-sub">Earned <b id="wallet-earned">0</b> · Spent <b id="wallet-spent">0</b></div>
        </div>
        <div class="kpi kpi-today alive">
          <div class="kpi-lb">TODAY</div>
          <div class="kpi-val"><span id="today-done">0</span><span class="kpi-of">/</span><span id="today-total">0</span></div>
          <div class="kpi-sub"><span id="today-min">0</span> min focused</div>
        </div>
        <div class="kpi kpi-week alive">
          <div class="kpi-lb">THIS WEEK</div>
          <div class="kpi-val"><span id="week-green">0</span><span class="kpi-of">/</span><span>5</span></div>
          <div class="kpi-sub">green weekdays</div>
        </div>
      </section>

      <!-- Progress grid -->
      <section class="dash-grid">
        <div class="dash-card dash-card-progress">
          <div class="dash-card-head">
            <h3>Sheet progress</h3>
            <small>Problems solved vs. total</small>
          </div>
          <div id="sheet-progress"></div>
        </div>

        <div class="dash-card dash-card-week">
          <div class="dash-card-head">
            <h3>This week</h3>
            <small>Mon → Fri</small>
          </div>
          <div class="week-bars" id="week-bars"></div>
          <div class="week-labels"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span></div>
        </div>

        <div class="dash-card dash-card-target">
          <div class="dash-card-head">
            <h3>Target</h3>
            <small id="target-sub">—</small>
          </div>
          <div class="target-body">
            <div class="target-role" id="target-role">—</div>
            <div class="target-date" id="target-date">—</div>
            <div class="target-countdown" id="target-countdown">—</div>
          </div>
        </div>

        <div class="dash-card dash-card-upcoming">
          <div class="dash-card-head">
            <h3>Next up</h3>
            <small>What's on today</small>
          </div>
          <div id="upcoming-list"></div>
        </div>

        <div class="dash-card dash-card-recent">
          <div class="dash-card-head">
            <h3>Recent earnings</h3>
            <small>Last 5 entries</small>
          </div>
          <div id="recent-ledger"></div>
        </div>

        <a class="dash-card dash-card-mastery" href="#mastery" id="mastery-tile" title="Visual grid of every pattern across your sheets, colored by mastery">
          <div class="dash-card-head">
            <h3>Pattern mastery</h3>
            <small id="mastery-tile-sub">—</small>
          </div>
          <div class="mastery-tile-body" id="mastery-tile-body"></div>
        </a>

        <div class="dash-card dash-card-focus" id="focus-tile" title="Pattern of the week — Suggest + Warmup bias toward this pattern for 7 days">
          <div class="dash-card-head">
            <h3>Pattern of the week</h3>
            <small id="focus-tile-sub">—</small>
          </div>
          <div class="focus-tile-body">
            <div class="focus-tile-name" id="focus-tile-name">—</div>
            <div class="focus-tile-actions">
              <button class="focus-tile-btn" id="focus-tile-change" title="Pick a different pattern for this week">Change</button>
            </div>
          </div>
        </div>

        <div class="dash-card dash-card-explainback" id="explainback-tile" role="button" tabindex="0" hidden title="Weekly recall drill — explain a problem you solved 3-6 weeks ago, Groq grades you">
          <div class="dash-card-head">
            <h3>Explain-back · due</h3>
            <small>One problem · ~3 min · Groq grades</small>
          </div>
          <div class="explainback-tile-body">
            <div class="eb-tile-ico">✎</div>
            <div class="eb-tile-text">
              <b>A problem from weeks ago is waiting.</b>
              <span>Type what you remember. Groq grades clarity, accuracy, completeness.</span>
            </div>
            <div class="eb-tile-arrow">→</div>
          </div>
        </div>

        <div class="dash-card dash-card-mentor" id="mentor-tile" role="button" tabindex="0" title="Open the full-screen honest-coach weekly report">
          <div class="dash-card-head">
            <h3>Mentor report · this week</h3>
            <small>Honest coach · ~1 Groq call</small>
          </div>
          <div class="mentor-tile-body">
            <div class="mentor-tile-ico">✦</div>
            <div class="mentor-tile-text">
              <b>Read your week like a staff engineer would.</b>
              <span>Wins, concerns, pattern mastery, next-week focus, and the one big ask — all in one letter.</span>
            </div>
            <div class="mentor-tile-arrow">→</div>
          </div>
        </div>

        <div class="dash-card dash-card-honor">
          <div class="dash-card-head">
            <h3>Honor code</h3>
            <small>The deal</small>
          </div>
          <div class="honor-text">
            Earned is earned. Rate yourself honestly. Set <b>Status = REVIEW</b> on anything that needs another pass — the engine serves those on weekends.
          </div>
        </div>
      </section>

      ${styles()}
    </div>
  `;
}

function paint(root) {
  const sheets = getSheets();
  const dayLog = getDayLog();
  const wallet = getWallet();
  const settings = getSettings();
  const today = new Date();
  const dateKey = todayKey();
  const todayPlan = dayLog[dateKey];

  // ---- Pattern mastery mini-grid tile ----
  paintMasteryTile(root);
  paintFocusTile(root);
  // ---- Explain-back drill tile (only when due) ----
  paintExplainBackTile(root);

  // Streak-at-risk banner: only renders when streak is live, today has open tasks, and it's late enough.
  const streakNow = computeStreak(dayLog);
  const hasOpenTasks = todayPlan && todayPlan.assigned?.length > 0 && !todayPlan.green;
  const hour = today.getHours();
  const riskSlot = root.querySelector("#streak-risk-slot");
  if (riskSlot) {
    if (streakNow >= 1 && hasOpenTasks && hour >= 15) {
      const remaining = todayPlan.assigned.length - todayPlan.done.length;
      riskSlot.innerHTML = `
        <section class="streak-risk">
          <div class="risk-flame">🔥</div>
          <div class="risk-text">
            <div class="risk-head">${streakNow}-day streak at risk</div>
            <div class="risk-sub">Tick ${remaining} more task${remaining === 1 ? "" : "s"} today to keep the chain alive.</div>
          </div>
          <a href="#today" class="risk-cta">Open Today ▶</a>
        </section>
      `;
    } else {
      riskSlot.innerHTML = "";
    }
  }

  // Date eyebrow + greeting
  const dateStr = today.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  root.querySelector("#date-eyebrow").textContent = dateStr;
  root.querySelector("#greeting").textContent = `${timeGreeting()}, ${settings.profile.name || "Vikas"}.`;
  const streak = computeStreak(dayLog);
  const longest = longestStreak(dayLog);
  root.querySelector("#dash-sub").textContent = subLine(streak, todayPlan);

  // Hero CTA
  const planHeadline = todayPlan && todayPlan.assigned?.length
    ? `${todayPlan.done.length} of ${todayPlan.assigned.length} tasks · ${todayPlan.assigned.length - todayPlan.done.length} to go`
    : "No plan yet — open to generate";
  root.querySelector("#plan-headline").textContent = planHeadline;

  // KPIs
  animateNum(root.querySelector("#streak-val"), streak);
  animateNum(root.querySelector("#longest-val"), longest);
  animateNum(root.querySelector("#wallet-val"), wallet.available);
  root.querySelector("#wallet-earned").textContent = `₹${wallet.earned.toLocaleString()}`;
  root.querySelector("#wallet-spent").textContent = `₹${wallet.spent.toLocaleString()}`;
  if (todayPlan) {
    animateNum(root.querySelector("#today-done"), todayPlan.done.length);
    animateNum(root.querySelector("#today-total"), todayPlan.assigned.length);
    const minutesDone = todayPlan.assigned
      .filter(t => todayPlan.done.includes(t.ref))
      .reduce((a, t) => a + (Number(t.minutes) || 0), 0);
    animateNum(root.querySelector("#today-min"), minutesDone);
  }
  const weekGreen = computeWeekGreenCount(dayLog, today);
  animateNum(root.querySelector("#week-green"), weekGreen);

  // Sheet progress
  const sheetEl = root.querySelector("#sheet-progress");
  sheetEl.innerHTML = Object.entries(sheets).map(([name, s]) => {
    const col = s.headers.find(h => /^status$/i.test(h));
    const done = col ? s.rows.filter(r => /solved|done/i.test(r[col] || "")).length : 0;
    const total = s.rows.length;
    const pct = total ? Math.round(100 * done / total) : 0;
    return `
      <div class="sp-row">
        <div class="sp-head">
          <span class="sp-name">${esc(name)}</span>
          <span class="sp-count"><b>${done}</b> / ${total} <span class="sp-pct">· ${pct}%</span></span>
        </div>
        <div class="sp-bar"><span style="width:${pct}%"></span></div>
      </div>
    `;
  }).join("");

  // Week bars
  paintWeekBars(root, dayLog, today);

  // Target
  const targetRole = settings.profile.targetRole;
  const targetDate = settings.profile.targetDate;
  root.querySelector("#target-role").textContent = targetRole;
  root.querySelector("#target-date").textContent = targetDate ? new Date(targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
  if (targetDate) {
    const days = Math.max(0, Math.ceil((new Date(targetDate) - today) / 86400000));
    root.querySelector("#target-countdown").innerHTML = `<b>${days}</b> days to go`;
    root.querySelector("#target-sub").textContent = `${days} days away`;
  }

  // Upcoming
  const upcoming = root.querySelector("#upcoming-list");
  if (todayPlan && todayPlan.assigned?.length) {
    const pending = todayPlan.assigned.filter(t => !todayPlan.done.includes(t.ref));
    if (!pending.length) {
      upcoming.innerHTML = `<div class="u-done">🎉 All tasks done for today.</div>`;
    } else {
      upcoming.innerHTML = pending.slice(0, 4).map(t => `
        <div class="u-row">
          <div class="u-dot"></div>
          <div class="u-main">
            <div class="u-t">${esc(t.title)}</div>
            <div class="u-m">${esc(subFor(t))}</div>
          </div>
          <div class="u-v">+ ₹${t.value}</div>
        </div>
      `).join("");
    }
  } else {
    upcoming.innerHTML = `<div class="u-empty">No plan generated.</div>`;
  }

  // Recent ledger
  const ledger = root.querySelector("#recent-ledger");
  const rows = (wallet.ledger || []).slice(-5).reverse();
  ledger.innerHTML = rows.length ? rows.map(e => `
    <div class="l-row">
      <div class="l-main">
        <div class="l-t">${esc(e.label)}</div>
        <div class="l-m">${new Date(e.date).toLocaleDateString()}</div>
      </div>
      <div class="l-v ${e.amount >= 0 ? "pos" : "neg"}">${e.amount >= 0 ? "+" : ""}₹${Math.abs(e.amount).toLocaleString()}</div>
    </div>
  `).join("") : `<div class="l-empty">Nothing yet — go earn it.</div>`;
}

function paintWeekBars(root, dayLog, today) {
  const el = root.querySelector("#week-bars");
  if (!el) return;
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  let html = "";
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const key = calendarKey(d);
    const log = dayLog[key];
    const assigned = log?.assigned?.length || 0;
    const done = log?.done?.length || 0;
    const pct = assigned ? Math.round(100 * done / assigned) : 0;
    const isGreen = assigned && log.green;
    const isFuture = d > today;
    const h = Math.max(pct, isFuture ? 0 : (assigned ? 10 : 0));
    const color = isGreen ? "var(--green)" : isFuture ? "var(--line2)" : (pct > 0 ? "var(--blue)" : "var(--line2)");
    html += `<div class="wb"><span style="height:${h}%; background:${color};"></span></div>`;
  }
  el.innerHTML = html;
}

function computeWeekGreenCount(dayLog, today) {
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  let n = 0;
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const key = calendarKey(d);
    if (dayLog[key]?.green) n++;
  }
  return n;
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 6) return "Early";
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  if (h < 20) return "Evening";
  return "Late";
}

function subLine(streak, todayPlan) {
  if (!todayPlan || !todayPlan.assigned?.length) return "No plan yet. Open Today to generate.";
  const done = todayPlan.done.length, total = todayPlan.assigned.length;
  if (done === 0) return `${total} tasks waiting. ${streak > 0 ? `Keep your ${streak}-day streak.` : "Start the chain today."}`;
  if (done === total) return `All done today. ${streak}-day streak secured.`;
  return `${done} of ${total} done. ${total - done} to go.`;
}

function subFor(t) {
  if (t.kind === "dsa")      return `${t.pattern || "DSA"} · ${t.minutes} min`;
  if (t.kind === "revision") return `DSA · ${t.minutes} min quiz`;
  if (t.kind === "log")      return `Progress · ${t.minutes} min`;
  if (t.kind === "sd")       return `System Design · ${t.minutes} min`;
  if (t.kind === "int")      return `Integrations · ${t.minutes} min`;
  if (t.kind === "ext")      return `${t.pattern || "Interview Extras"} · ${t.minutes} min`;
  if (t.kind === "sql")      return `SQL · ${t.minutes} min`;
  if (t.kind === "os")       return `${t.pattern || "OS & Networking"} · ${t.minutes} min`;
  return `${t.minutes || 15} min`;
}

function attach(root) {
  // Mentor report tile → full-screen honest-coach letter.
  const openReport = async () => {
    const { openWeeklyReportCard } = await import("./weeklyReview.js");
    openWeeklyReportCard();
  };
  const tile = root.querySelector("#mentor-tile");
  if (tile) {
    tile.addEventListener("click", openReport);
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openReport(); }
    });
  }
  // Explain-back tile → open the drill
  const ebTile = root.querySelector("#explainback-tile");
  if (ebTile) {
    const open = async () => {
      const mod = await import("./explainBack.js");
      await mod.openExplainBackDrill();
    };
    ebTile.addEventListener("click", open);
    ebTile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  }
}

function animateNum(el, to) {
  if (!el) return;
  const from = parseInt(String(el.textContent).replace(/[^0-9-]/g, "") || "0", 10);
  if (from === to) { el.textContent = to.toLocaleString(); return; }
  const start = performance.now(); const dur = 480;
  function step(t) {
    const p = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }

function paintExplainBackTile(root) {
  const tile = root.querySelector("#explainback-tile");
  if (!tile) return;
  import("./explainBack.js").then(mod => {
    tile.hidden = !mod.isDrillDueNow();
  }).catch(() => { tile.hidden = true; });
}

async function paintFocusTile(root) {
  try {
    const { getCurrentFocus, listFocusPatterns, setFocusOverride } = await import("./weeklyFocus.js");
    const current = await getCurrentFocus();
    const sub = root.querySelector("#focus-tile-sub");
    const nameEl = root.querySelector("#focus-tile-name");
    const changeBtn = root.querySelector("#focus-tile-change");
    if (!current) {
      if (nameEl) nameEl.textContent = "No pattern set";
      if (sub) sub.textContent = "Add patterns in Settings";
      return;
    }
    if (nameEl) nameEl.textContent = current;
    if (sub) sub.textContent = "Suggest + Warmup bias toward this for 7 days";
    changeBtn?.addEventListener("click", () => {
      const list = listFocusPatterns();
      if (!list.length) { alert("Add patterns in Settings → Schedule → Pattern of the week."); return; }
      const choice = prompt("Pick this week's focus pattern:\n\n" + list.map((p, i) => `${i+1}. ${p}`).join("\n") + "\n\nType a number or the exact pattern name:", current);
      if (!choice) return;
      const idx = parseInt(choice, 10);
      const pick = Number.isInteger(idx) && idx >= 1 && idx <= list.length ? list[idx - 1] : choice.trim();
      if (!pick) return;
      setFocusOverride(pick).then(() => paintFocusTile(root));
    });
  } catch (e) {
    console.warn("[focus tile] failed", e);
  }
}

function paintMasteryTile(root) {
  const tile = root.querySelector("#mastery-tile");
  if (!tile) return;
  const body = root.querySelector("#mastery-tile-body");
  const sub = root.querySelector("#mastery-tile-sub");
  // Lazy-load the mastery module's computer to avoid a cycle
  import("./mastery.js").then(mod => {
    const ctx = mod.computePatternMastery();
    const patterns = ctx.patterns;
    const scored = patterns.filter(p => p.score != null);
    const avg = scored.length ? scored.reduce((a, p) => a + p.score, 0) / scored.length : null;
    if (sub) sub.textContent = scored.length
      ? `${scored.length}/${patterns.length} touched · avg ${avg.toFixed(1)}★`
      : `${patterns.length} patterns · untouched`;
    if (body) {
      // 18-cell mini-grid; show weakest first so the eye lands on gaps
      const cells = patterns.slice(0, 18);
      while (cells.length < 18) cells.push({ band: "untouched" });
      body.innerHTML = cells.map(p => `<div class="mt-cell mt-${p.band}" title="${p.name ? esc(p.name) : ""}${p.score != null ? ` · ${p.score.toFixed(1)}★` : ""}"></div>`).join("");
    }
  }).catch(() => {});
}

function styles() {
  return `
  <style>
    .dash { max-width: 1240px; }

    /* Streak-at-risk banner — subtle amber, blends with paper */
    .streak-risk {
      display: grid; grid-template-columns: auto 1fr auto; gap: var(--s-4);
      align-items: center;
      background: var(--paper);
      border: 1px solid var(--line);
      border-left: 3px solid var(--gold);
      color: var(--ink);
      border-radius: var(--radius); padding: var(--s-4) var(--s-5);
      box-shadow: var(--shadow);
      margin-bottom: var(--s-5);
      animation: rise var(--dur-slow) var(--ease) both;
    }
    .streak-risk .risk-flame { font-size: 28px; color: var(--gold); }
    .streak-risk .risk-head { font-size: 16px; font-weight: 700; letter-spacing: -.005em; }
    .streak-risk .risk-sub  { font-size: 12.5px; color: var(--mut); margin-top: 2px; }
    .streak-risk .risk-cta {
      background: var(--ink); color: #fff; text-decoration: none;
      padding: 10px 18px; border-radius: 10px;
      font: 700 12.5px/1 var(--font-sans); letter-spacing: .01em;
      transition: transform .18s, background .18s;
    }
    .streak-risk .risk-cta:hover { transform: translateY(-1px); background: #22272f; }

    .dash-hero {
      display: grid; grid-template-columns: 1fr auto; gap: var(--s-5);
      align-items: center; margin-bottom: var(--s-6);
    }
    .dash-eyebrow {
      font-size: 11px; letter-spacing: .22em; font-weight: 700; color: var(--mut);
      margin-bottom: var(--s-2);
    }
    .dash-greeting { font-size: 44px; font-weight: 800; letter-spacing: -.02em; margin: 0 0 8px; }
    .dash-sub { color: var(--mut); font-size: 15px; margin: 0; }

    .dash-cta {
      background: var(--paper);
      border: 1px solid var(--line);
      border-left: 3px solid var(--gold);
      color: var(--ink); text-decoration: none;
      border-radius: var(--radius); padding: 22px 28px;
      display: grid; grid-template-columns: 1fr auto; gap: var(--s-3);
      align-items: center;
      box-shadow: var(--shadow);
      transition: transform .18s, box-shadow .18s, border-color .18s;
      min-width: 320px;
    }
    .dash-cta:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
    .dash-cta-lb {
      display: block; font: 700 10px/1 var(--font-sans); letter-spacing: .22em; color: var(--mut);
      grid-column: 1 / 2;
    }
    .dash-cta-title {
      display: block; font: 700 15px/1.3 var(--font-sans); color: var(--ink);
      margin-top: 6px; grid-column: 1 / 2;
    }
    .dash-cta-arrow {
      grid-column: 2; grid-row: 1 / 3; font-size: 22px; color: var(--gold);
    }

    /* === KPIs === */
    .dash-kpis {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-3);
      margin-bottom: var(--s-6);
    }
    .kpi {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
      padding: var(--s-5); box-shadow: var(--shadow);
      transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
      position: relative;
    }
    .kpi:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
    .kpi-lb {
      font: 800 10px/1 var(--font-sans); letter-spacing: .2em; color: var(--mut);
      margin-bottom: 10px;
    }
    .kpi-val {
      font-size: 40px; font-weight: 800; letter-spacing: -.02em; line-height: 1;
      display: flex; align-items: baseline; gap: 8px;
    }
    .kpi-of { color: var(--mut); font-weight: 500; font-size: 24px; margin: 0 2px; }
    .kpi-flame { font-size: 24px; }
    .kpi-sub { font-size: 12px; color: var(--mut); margin-top: 10px; }
    .kpi-sub b { color: var(--ink); font-weight: 700; }
    .kpi-streak .kpi-val { color: #ff6a40; }
    .kpi-wallet .kpi-val { color: var(--gold); font-family: Georgia, serif; font-style: italic; }
    .kpi-wallet .kpi-val::before { content: "₹"; font-size: 28px; margin-right: 4px; }
    .kpi-today .kpi-val { color: var(--blue); }
    .kpi-week .kpi-val { color: var(--green); }

    /* === Dashboard grid === */
    .dash-grid {
      display: grid;
      grid-template-columns: 1.4fr 1fr 1fr;
      grid-template-rows: auto auto;
      gap: var(--s-4);
    }
    .dash-card {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
      padding: var(--s-5); box-shadow: var(--shadow);
    }
    .dash-card-progress  { grid-column: 1; grid-row: 1 / 3; }
    .dash-card-week      { grid-column: 2; grid-row: 1; }
    .dash-card-target    { grid-column: 3; grid-row: 1; }
    .dash-card-upcoming  { grid-column: 2 / 4; grid-row: 2; }
    .dash-card-recent    { grid-column: 1; grid-row: 3; }
    .dash-card-mentor    { grid-column: 2 / 4; grid-row: 3; cursor: pointer; transition: all .18s; }
    .dash-card-mentor:hover { border-color: var(--gold); transform: translateY(-2px); box-shadow: 0 10px 22px rgba(0,0,0,.08); }
    .dash-card-mentor:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
    .mentor-tile-body { display: flex; align-items: center; gap: 16px; }
    .mentor-tile-ico { font-size: 32px; color: var(--gold); line-height: 1; }
    .mentor-tile-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .mentor-tile-text b { font-size: 14px; font-weight: 700; color: var(--ink); letter-spacing: -.01em; }
    .mentor-tile-text span { font-size: 12.5px; color: var(--mut); line-height: 1.5; }
    .mentor-tile-arrow { font-size: 22px; color: var(--mut); transition: all .18s; }
    .dash-card-mentor:hover .mentor-tile-arrow { color: var(--gold); transform: translateX(4px); }
    .dash-card-mastery   { grid-column: 1; grid-row: 4; text-decoration: none; cursor: pointer; transition: all .18s; }
    .dash-card-mastery:hover { border-color: var(--gold); transform: translateY(-2px); box-shadow: 0 10px 22px rgba(0,0,0,.08); }

    /* Pattern-of-the-week tile */
    .dash-card-focus { grid-column: 2; grid-row: 4; transition: all .18s; }
    .dash-card-focus:hover { border-color: var(--gold); transform: translateY(-2px); box-shadow: 0 10px 22px rgba(0,0,0,.08); }
    .focus-tile-body { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
    .focus-tile-name {
      font: 700 20px/1.2 var(--font-sans); color: var(--ink); letter-spacing: -.018em;
      padding: 10px 12px;
      background: linear-gradient(135deg, color-mix(in oklab, var(--gold) 14%, var(--paper)) 0%, color-mix(in oklab, var(--gold) 4%, var(--paper)) 100%);
      border: 1px solid color-mix(in oklab, var(--gold) 32%, var(--line));
      border-radius: 10px;
    }
    .focus-tile-actions { display: flex; gap: 6px; }
    .focus-tile-btn {
      padding: 6px 12px; border-radius: 8px;
      background: var(--paper); border: 1px solid var(--line); color: var(--mut);
      font: 600 11px/1 var(--font-sans); cursor: pointer;
    }
    .focus-tile-btn:hover { color: var(--ink); border-color: var(--line2); }
    .dash-card-explainback { grid-column: 2 / 4; grid-row: 4; cursor: pointer; transition: all .18s; }
    .dash-card-explainback[hidden] { display: none; }
    .dash-card-explainback:hover { border-color: var(--blue, #3870ff); transform: translateY(-2px); box-shadow: 0 10px 22px rgba(0,0,0,.08); }
    .explainback-tile-body { display: flex; align-items: center; gap: 16px; }
    .eb-tile-ico { font-size: 32px; color: var(--blue, #3870ff); line-height: 1; }
    .eb-tile-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .eb-tile-text b { font-size: 14px; font-weight: 700; color: var(--ink); }
    .eb-tile-text span { font-size: 12.5px; color: var(--mut); line-height: 1.5; }
    .eb-tile-arrow { font-size: 22px; color: var(--mut); transition: all .18s; }
    .dash-card-explainback:hover .eb-tile-arrow { color: var(--blue, #3870ff); transform: translateX(4px); }
    .mastery-tile-body { display: grid; grid-template-columns: repeat(6, 1fr); grid-template-rows: repeat(3, 1fr); gap: 3px; min-height: 100px; }
    .mastery-tile-body .mt-cell { border-radius: 3px; aspect-ratio: 1; }
    .mt-mastered  { background: color-mix(in oklab, var(--green) 55%, var(--paper)); }
    .mt-solid     { background: color-mix(in oklab, var(--blue, #3870ff) 50%, var(--paper)); }
    .mt-shaky     { background: color-mix(in oklab, var(--gold) 55%, var(--paper)); }
    .mt-weak      { background: color-mix(in oklab, var(--red) 50%, var(--paper)); }
    .mt-untouched { background: var(--line); }
    .dash-card-honor     { grid-column: 2 / 4; grid-row: 4; }

    .dash-card-head {
      display: flex; justify-content: space-between; align-items: baseline;
      margin-bottom: var(--s-4);
    }
    .dash-card-head h3 { margin: 0; font-size: 15px; font-weight: 700; }
    .dash-card-head small { font-size: 11px; color: var(--mut); letter-spacing: .04em; }

    /* Sheet progress rows */
    .sp-row { padding: 10px 0; border-top: 1px solid var(--line); }
    .sp-row:first-child { border-top: none; padding-top: 0; }
    .sp-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
    .sp-name { font-weight: 700; }
    .sp-count b { font-weight: 800; }
    .sp-pct { color: var(--mut); }
    .sp-bar { height: 8px; background: var(--line); border-radius: 999px; overflow: hidden; }
    .sp-bar > span { display: block; height: 100%; background: linear-gradient(90deg, var(--blue), var(--green)); border-radius: 999px; transition: width .8s var(--ease); }

    /* Week bars */
    .week-bars { display: flex; align-items: flex-end; gap: 10px; height: 90px; padding-top: 12px; }
    .wb { flex: 1; height: 100%; background: var(--line); border-radius: 6px 6px 2px 2px; position: relative; overflow: hidden; }
    .wb > span { display: block; width: 100%; position: absolute; bottom: 0; border-radius: 6px 6px 2px 2px; transition: height .8s var(--ease); }
    .week-labels { display: flex; gap: 10px; margin-top: 8px; color: var(--mut); font-size: 11px; }
    .week-labels span { flex: 1; text-align: center; font-weight: 600; }

    /* Target card */
    .target-body { text-align: center; padding: var(--s-3) 0 var(--s-2); }
    .target-role { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 6px; line-height: 1.3; }
    .target-date { font-size: 11px; color: var(--mut); margin-bottom: var(--s-3); }
    .target-countdown { font-size: 28px; font-weight: 800; letter-spacing: -.02em; color: var(--blue); }
    .target-countdown b { font-size: 36px; }

    /* Upcoming */
    .u-row {
      display: grid; grid-template-columns: 10px 1fr auto; gap: var(--s-3);
      align-items: center; padding: 10px 0; border-top: 1px solid var(--line);
    }
    .u-row:first-child { border-top: none; padding-top: 0; }
    .u-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--blue); }
    .u-t { font-size: 13.5px; font-weight: 600; }
    .u-m { font-size: 11px; color: var(--mut); margin-top: 2px; }
    .u-v { font: 800 12px/1 var(--font-sans); color: var(--gold); background: var(--gold-soft); padding: 5px 10px; border-radius: 999px; }
    .u-done, .u-empty { padding: 20px 0; text-align: center; color: var(--mut); font-size: 13px; }

    /* Ledger */
    .l-row { display: flex; justify-content: space-between; padding: 10px 0; border-top: 1px solid var(--line); align-items: center; }
    .l-row:first-child { border-top: none; padding-top: 0; }
    .l-t { font-size: 13px; font-weight: 600; }
    .l-m { font-size: 11px; color: var(--mut); margin-top: 2px; }
    .l-v { font-weight: 800; font-size: 14px; }
    .l-v.pos { color: var(--green); }
    .l-v.neg { color: var(--red); }
    .l-empty { padding: 20px 0; text-align: center; color: var(--mut); font-size: 13px; }

    /* Honor code */
    .honor-text { color: var(--ink); font-size: 13.5px; line-height: 1.6; }
    .honor-text b { color: var(--gold); font-weight: 800; }

    @media (max-width: 980px) {
      .dash-hero { grid-template-columns: 1fr; }
      .dash-kpis { grid-template-columns: 1fr 1fr; }
      .dash-grid { grid-template-columns: 1fr; }
      .dash-card-progress, .dash-card-week, .dash-card-target,
      .dash-card-upcoming, .dash-card-recent, .dash-card-mentor, .dash-card-honor { grid-column: 1; grid-row: auto; }
    }
    @media (max-width: 560px) {
      .dash-kpis { grid-template-columns: 1fr 1fr; gap: var(--s-2); }
      .kpi { padding: var(--s-3); }
      .kpi-val { font-size: 22px; }
      .mentor-tile-body { gap: 10px; }
      .mentor-tile-ico { font-size: 24px; }
      .mentor-tile-text b { font-size: 13px; }
      .mentor-tile-text span { font-size: 11.5px; }
    }
  </style>
  `;
}
