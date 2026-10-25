// App bootstrap: boot the store, register routes, mount initial screen, wire chrome.
import { boot, getWallet, getDayLog, getSettings, getSheets, updateSheetRow, updateWallet, updateDayLog, callGrok, secure, on } from "./store.js";
import { computeStreak, todayKey, priceTask, ensureDailyPlan } from "./engine.js";
import * as router from "./router.js";
import { enhanceAll } from "./dropdown.js";
import { initTheme } from "./theme.js";
import { openWalletAdjustModal } from "./walletAdjust.js";
import dashboard from "./dashboard.js";
import today from "./today.js";
import week from "./week.js";
import calendar from "./calendar.js";
import progress from "./progress.js";
import library from "./library.js";
import shop from "./shop.js";
import settings from "./settings.js";
import mastery from "./mastery.js";
import problem from "./problem.js";

router.register("dashboard", dashboard);
router.register("today", today);
router.register("week", week);
router.register("calendar", calendar);
router.register("progress", progress);
router.register("library", library);
router.register("shop", shop);
router.register("settings", settings);
router.register("mastery", mastery);
router.register("problem", problem);

async function main() {
  await boot();
  initTheme();                      // apply light/dark/system theme + listen for OS changes
  updateChrome();
  on(() => updateChrome());

  // One-shot: fill the Companies column across every sheet with curated
  // FAANG/HFT/startup tags for well-known problems. Idempotent + never
  // overwrites a row that already has companies.
  if (!localStorage.getItem("gain:companies:seeded:v1")) {
    try {
      const [{ seedAllCompanies }, { persistSheet, emit }] = await Promise.all([
        import("./companyData.js"),
        import("./store.js"),
      ]);
      const res = await seedAllCompanies({ getSheets, persistSheet, emit });
      localStorage.setItem("gain:companies:seeded:v1", String(Date.now()));
      console.log(`[companies seed] touched ${res.sheetsTouched} sheets, wrote ${res.rowsWritten} rows`);
    } catch (err) {
      console.warn("Company seed failed:", err);
    }
  }

  if (!location.hash) location.hash = "#dashboard";
  router.go();

  document.getElementById("start-session").addEventListener("click", () => openStartSessionModal());

  // Topbar coin → open the Adjust wallet modal (same modal used in Settings → Wallet)
  const coinEl = document.getElementById("coin");
  if (coinEl) {
    coinEl.style.cursor = "pointer";
    coinEl.title = "Click to adjust your wallet";
    coinEl.addEventListener("click", () => openWalletAdjustModal());
  }

  // Topbar streak → open streak-freeze popover
  const streakEl = document.getElementById("streak");
  if (streakEl) {
    streakEl.style.cursor = "pointer";
    streakEl.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleStreakPop();
    });
    document.addEventListener("click", (e) => {
      const pop = document.getElementById("streak-pop");
      if (pop && !pop.hidden && !pop.contains(e.target) && e.target !== streakEl) pop.hidden = true;
    });
  }

  wireGlobalSearch();
  wireAliveSheen();
  wireSidebarToggle();
  startRolloverReminders();

  // Info popovers (?) icon anywhere + Esc to close — global delegate
  const { wireInfoPopovers } = await import("./info.js");
  wireInfoPopovers();

  // Daily recap scheduler — fires at 18:50 IST or when today's plan hits 100%.
  const { startRecapScheduler } = await import("./recap.js");
  startRecapScheduler();

  // Phase 8 — Monday weekly-plan nudge
  nudgeWeeklyPlanIfMonday();
  enhanceAll(document);  // sets up a mutation observer, so dynamically rendered selects also get the custom look

  // bot toggle — class-based so CSS display:flex doesn't fight the [hidden] attr
  const bot = document.getElementById("bot");
  const panel = document.getElementById("bot-panel");
  const closeBtn = document.getElementById("bot-close");
  panel.hidden = false;              // we drive it via the .open class, not the attr
  bot.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      setTimeout(() => document.getElementById("bot-input")?.focus(), 50);
    }
  });
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.remove("open");
  });
  // click outside closes
  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("open")) return;
    if (e.target.closest(".bot-panel") || e.target.closest(".bot")) return;
    panel.classList.remove("open");
  });
  // Esc closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) {
      panel.classList.remove("open");
    }
  });
  document.getElementById("bot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("bot-input");
    const log = document.getElementById("bot-log");
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    log.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(msg)}</div>`);
    log.scrollTop = log.scrollHeight;
    await askBot(msg, log);
  });
}

async function askBot(msg, log) {
  const thinkEl = document.createElement("div");
  thinkEl.className = "msg assistant thinking";
  thinkEl.innerHTML = `<span class="dot"></span><span class="dot"></span><span class="dot"></span>`;
  log.appendChild(thinkEl);
  log.scrollTop = log.scrollHeight;

  try {
    const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                   (await secure.get("grok_api_key").catch(() => null));
    if (!apiKey) {
      thinkEl.classList.remove("thinking");
      thinkEl.innerHTML = `No Groq API key yet. Open <a href="#settings">Settings → AI butler</a>, paste a <code>gsk_...</code> key, click <b>Test connection</b>.`;
      return;
    }
    const s = getSettings();
    const sysPrompt = s.grok.masterPrompt + `

--- CURRENT APP STATE ---
${buildContext()}

--- RESPONSE CONTRACT ---
Reply in JSON only, no prose outside it:
{ "reply": "<your 1-3 sentence response>",
  "actions": [
    { "type": "open", "payload": { "hash": "#today" } },
    { "type": "mark_solved",   "payload": { "sheet": "DSA", "seq": 86 } },
    { "type": "mark_review",   "payload": { "sheet": "DSA", "seq": 42 } },
    { "type": "set_dynamic_condition", "payload": { "line": "exam week Nov 10-14: revision only" } }
  ]
}
Only include actions when the user clearly asked for them. 0 actions is normal.`;

    const res = await callGrok({
      system: sysPrompt,
      user: msg,
      apiKey,
      model: s.grok.model,
      temperature: s.grok.temperature
    });

    thinkEl.classList.remove("thinking");
    if (!res.ok) {
      thinkEl.innerHTML = `<span class="err">${esc(res.error || "Grok returned no content.")}</span>`;
      log.scrollTop = log.scrollHeight;
      return;
    }

    // Try to parse structured JSON; fall back to raw text.
    const parsed = tryParseBotJson(res.content);
    if (parsed) {
      const replyHtml = esc(parsed.reply || "(no reply)").replace(/\n/g, "<br>");
      const actionsHtml = (parsed.actions || []).map((a, i) => `
        <button class="bot-action" data-aid="${i}">${esc(describeAction(a))}</button>
      `).join("");
      thinkEl.innerHTML = `
        <div class="bot-text">${replyHtml}</div>
        ${actionsHtml ? `<div class="bot-actions">${actionsHtml}</div>` : ""}
      `;
      thinkEl.querySelectorAll(".bot-action").forEach(btn => {
        btn.addEventListener("click", async () => {
          const action = parsed.actions[Number(btn.dataset.aid)];
          const result = await executeAction(action);
          btn.disabled = true;
          btn.textContent = result;
          btn.classList.add("done");
        });
      });
    } else {
      thinkEl.innerHTML = esc(res.content).replace(/\n/g, "<br>");
    }
  } catch (err) {
    thinkEl.classList.remove("thinking");
    thinkEl.innerHTML = `<span class="err">${esc(err.message || String(err))}</span>`;
  }
  log.scrollTop = log.scrollHeight;
}

function tryParseBotJson(text) {
  if (!text) return null;
  // find the first { ... } blob
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (typeof obj.reply === "string") return obj;
  } catch (_) {}
  return null;
}

function describeAction(a) {
  switch (a.type) {
    case "open": return `Open ${a.payload?.hash || "?"}`;
    case "mark_solved": return `Mark solved · ${a.payload?.sheet}#${a.payload?.seq}`;
    case "mark_review": return `Flag for REVIEW · ${a.payload?.sheet}#${a.payload?.seq}`;
    case "set_dynamic_condition": return `Add dynamic condition`;
    default: return `Run · ${a.type}`;
  }
}

async function executeAction(a) {
  try {
    switch (a.type) {
      case "open": {
        const hash = a.payload?.hash;
        if (hash) location.hash = hash;
        return "✓ Opened";
      }
      case "mark_solved":
      case "mark_review": {
        const { sheet, seq } = a.payload || {};
        const sh = getSheets()[sheet];
        if (!sh) return "✗ No sheet";
        const idx = sh.rows.findIndex(r => String(r.Seq) === String(seq));
        if (idx < 0) return "✗ Row not found";
        const statusCol = sh.headers.find(h => /^status$/i.test(h));
        const dateCol = sh.headers.find(h => /^(datesolved|datedone)$/i.test(h));
        const patch = {};
        if (statusCol) patch[statusCol] = a.type === "mark_solved" ? "SOLVED" : "REVIEW";
        if (dateCol && a.type === "mark_solved") patch[dateCol] = todayKey();
        if (Object.keys(patch).length) await updateSheetRow(sheet, idx, patch);
        if (a.type === "mark_solved") {
          const s = getSettings();
          const val = priceTask({
            kind: sh.type || "dsa",
            difficulty: (sh.rows[idx].Difficulty || "").toLowerCase(),
            freq: sh.rows[idx].Freq || sh.rows[idx].Priority,
            minutes: 30
          }, s);
          await updateWallet(w => {
            w.earned += val;
            w.ledger.push({ date: new Date().toISOString(), type: "bot", amount: val, label: sh.rows[idx].Problem || sh.rows[idx].Topic });
          });
          return `✓ Solved · banked ₹${val}`;
        }
        return "✓ Queued for weekend REVIEW";
      }
      case "set_dynamic_condition": {
        const line = a.payload?.line;
        if (!line) return "✗ No line";
        const s = getSettings();
        s.grok.dynamicConditions = [...(s.grok.dynamicConditions || []), line];
        const { updateSettings } = await import("./store.js");
        await updateSettings(st => { st.grok.dynamicConditions = s.grok.dynamicConditions; });
        return "✓ Condition added";
      }
      default:
        return "✗ Unknown action";
    }
  } catch (err) {
    console.error(err);
    return "✗ Failed";
  }
}

function buildContext() {
  const s = getSettings();
  const sheets = getSheets();
  const dayLog = getDayLog();
  const w = getWallet();
  const todayPlan = dayLog[todayKey()];

  const sheetSummary = Object.entries(sheets).map(([name, sh]) => {
    const statusCol = sh.headers.find(h => /^status$/i.test(h));
    const freqCol   = sh.headers.find(h => /^(freq|priority)$/i.test(h));
    let solved = 0, todo = 0, high = 0, highDone = 0;
    for (const r of sh.rows) {
      const st = String(r[statusCol] || "").toUpperCase();
      if (st === "SOLVED") solved++; else todo++;
      if (freqCol && /^(HIGH|P1)$/i.test(r[freqCol] || "")) {
        high++; if (st === "SOLVED") highDone++;
      }
    }
    return `${name}: ${solved}/${sh.rows.length} solved · ${highDone}/${high} HIGH done`;
  }).join("\n");

  return `
Profile: ${s.profile.name} · target ${s.profile.targetRole} by ${s.profile.targetDate} · ${s.profile.weekdayMinutes} min/weekday
Schedule: maxTasksPerDay=${s.schedule.maxTasksPerDay}, newDsaPerWeekday=${s.schedule.newDsaPerWeekday}, SD/INT days=${s.schedule.sdIntDays.join(",")}
Wallet: earned=₹${w.earned}, available=₹${w.available}, taskRange=₹${s.wallet.taskMin}-${s.wallet.taskMax}
Dynamic conditions: ${s.grok.dynamicConditions.join(" | ") || "(none)"}
Sheet state:
${sheetSummary}
Today's plan: ${todayPlan ? todayPlan.assigned.map(t => `${t.ref} ${t.title} (₹${t.value}, ${todayPlan.done.includes(t.ref)?"DONE":"open"})`).join("; ") : "(none)"}
  `.trim();
}

// Rollover reminders — OS notification (if permitted) + in-app toast when
// < 2h to 7 PM IST and tasks still undone. Debounced to once per 60 min.
function startRolloverReminders() {
  // Try to request notification permission on first boot (modern browsers may require
  // a user gesture — if blocked, we fall back silently to in-app banner only).
  if ("Notification" in window && Notification.permission === "default") {
    try { Notification.requestPermission(); } catch (_) {}
  }
  const check = () => {
    const dateKey = todayKey();
    const day = getDayLog()[dateKey];
    if (!day || !day.assigned?.length) return;
    const undone = day.assigned.length - (day.done?.length || 0);
    if (undone === 0) return;

    const now = new Date();
    const istMs = now.getTime() + 5.5 * 3600 * 1000;
    const ist = new Date(istMs);
    const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const boundaryMin = 19 * 60;
    const minsLeft = nowMin < boundaryMin ? boundaryMin - nowMin : (24 * 60) - nowMin + boundaryMin;
    if (minsLeft > 120) return;  // too far away

    // Debounce — once every 60 min at most
    const lastKey = `gain:lastNotif:${dateKey}`;
    const last = Number(localStorage.getItem(lastKey) || 0);
    if (Date.now() - last < 60 * 60 * 1000) return;
    localStorage.setItem(lastKey, String(Date.now()));

    const hh = Math.floor(minsLeft / 60), mm = minsLeft % 60;
    const timeStr = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
    const title = minsLeft < 30 ? "🔥 Streak on the line" : "⚠ Streak at risk";
    const body = `${undone} task${undone === 1 ? "" : "s"} undone · ${timeStr} to 7 PM IST rollover`;

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        const n = new Notification(title, { body, tag: `rollover-${dateKey}`, requireInteraction: minsLeft < 30 });
        n.onclick = () => { window.focus(); location.hash = "#today"; };
      } catch (_) {}
    }
  };
  check();  // one shot now
  setInterval(check, 10 * 60 * 1000);  // every 10 min
}

// --- Monday weekly-plan nudge (Phase 8) ---------------------------------
// On the first Monday boot after 19:00 IST, if no weekly plan was generated
// for this week, show a one-time toast nudging the user to generate one.
// Doesn't fire Groq — just points to the Weekly plan page.
async function nudgeWeeklyPlanIfMonday() {
  const { getWeeklyPlan } = await import("./store.js");
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const istDay = ist.getUTCDay();  // 0 Sun .. 6 Sat
  const istHour = ist.getUTCHours();
  if (istDay !== 1 || istHour < 19) return;  // only Mondays after 7 PM IST

  // Determine this week's Monday calendar key
  const monday = new Date(ist); monday.setUTCHours(0, 0, 0, 0);
  const mondayKey = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth()+1).padStart(2,"0")}-${String(monday.getUTCDate()).padStart(2,"0")}`;
  const nudgeKey = `gain:weeklyPlanNudged:${mondayKey}`;
  try { if (localStorage.getItem(nudgeKey) === "1") return; } catch (_) {}

  const plan = getWeeklyPlan?.();
  // Treat the plan as "for this week" if it has days starting on or after today
  const hasThisWeek = plan?.days?.some(d => d.date >= mondayKey);
  if (hasThisWeek) {
    try { localStorage.setItem(nudgeKey, "1"); } catch (_) {}
    return;
  }

  // Show a soft toast with a click-through
  const toast = document.createElement("div");
  toast.className = "weekly-nudge-toast";
  toast.innerHTML = `
    <span class="wnt-ico">✦</span>
    <span class="wnt-text">New week — generate your weekly plan?</span>
    <button class="wnt-go">Open →</button>
    <button class="wnt-dismiss" aria-label="Dismiss">✕</button>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 20);
  const close = () => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 240);
    try { localStorage.setItem(nudgeKey, "1"); } catch (_) {}
  };
  toast.querySelector(".wnt-go").addEventListener("click", () => {
    location.hash = "#week";
    close();
  });
  toast.querySelector(".wnt-dismiss").addEventListener("click", close);
  setTimeout(close, 12_000);  // auto-dismiss after 12s
}

// --- Sidebar collapse ---------------------------------------------------
// State persisted in localStorage. ⌘⇧B / Ctrl+Shift+B also toggles.
function wireSidebarToggle() {
  const sidebar = document.getElementById("sidebar");
  const btn = document.getElementById("sidebar-toggle");
  if (!sidebar || !btn) return;
  const KEY = "gain:sidebar-collapsed";
  const apply = (collapsed) => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    btn.querySelector(".st-ic").textContent = collapsed ? "▶" : "◀";
    btn.title = collapsed ? "Expand sidebar (⌘ ⇧ B)" : "Collapse sidebar (⌘ ⇧ B)";
  };
  try { apply(localStorage.getItem(KEY) === "1"); } catch (_) {}
  btn.addEventListener("click", () => {
    const nowCollapsed = !document.body.classList.contains("sidebar-collapsed");
    try { localStorage.setItem(KEY, nowCollapsed ? "1" : "0"); } catch (_) {}
    apply(nowCollapsed);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      btn.click();
    }
  });
}

// --- Streak-freeze popover ----------------------------------------------
// Click the 🔥 streak chip in the topbar → shows current streak, longest,
// freeze tokens owned, and quick-action buttons:
//   • "Protect yesterday's break" — only shown if yesterday has tasks but wasn't green/frozen
//   • "Buy 1 freeze token (₹500)" — always visible; disabled if insufficient available
function toggleStreakPop() {
  const pop = document.getElementById("streak-pop");
  if (!pop) return;
  const willShow = !!pop.hidden;
  pop.hidden = !willShow;
  if (!willShow) return;
  renderStreakPop(pop);
}

async function renderStreakPop(pop) {
  const { getSettings } = await import("./store.js");
  const { calendarKey, longestStreak } = await import("./engine.js");
  const w = getWallet();
  const s = getSettings();
  const dayLog = getDayLog();
  const streak = computeStreak(dayLog);
  const longest = longestStreak(dayLog);
  const tokens = Number(w.freezeTokens || 0);
  const price = Number(s.wallet.streakFreezePrice || 500);
  const available = Number(w.available || 0);
  const canAfford = available >= price;

  // Find the most recent non-green day in the last 7 that could use protection.
  // Yesterday first; if yesterday was 0-task (rest day), look further back for the one break.
  const today = new Date();
  let protectCandidate = null;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = calendarKey(d);
    const day = dayLog[key];
    if (!day?.assigned?.length) continue;  // 0-task day — not a break
    if (day.green || day.frozen) continue;  // already OK
    protectCandidate = { key, label: new Date(key + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) };
    break;
  }

  pop.innerHTML = `
    <div class="sp-head">
      <div>
        <div class="sp-eyebrow">🔥 STREAK</div>
        <div class="sp-stat"><b>${streak}</b> <small>day${streak === 1 ? "" : "s"} current</small></div>
        <div class="sp-stat-sub">Longest: <b>${longest}</b> days</div>
      </div>
      <div class="sp-tokens">
        <img class="sp-tok-ic sp-tok-shard" src="https://static.vecteezy.com/system/resources/previews/081/464/122/non_2x/cartoon-ice-explosion-effect-with-frozen-shards-isolated-on-transparent-background-free-png.png" alt="Streak freeze shard" />
        <div class="sp-tok-count">${tokens}</div>
        <div class="sp-tok-lb">freeze token${tokens === 1 ? "" : "s"}</div>
      </div>
    </div>
    <div class="sp-actions">
      ${protectCandidate ? `
        <button class="sp-btn primary" id="sp-protect" ${tokens === 0 ? "disabled" : ""} title="${tokens === 0 ? "Buy a token first" : "Spend 1 token to mark " + protectCandidate.label + " as frozen (counts as green)"}">
          ${tokens === 0 ? "No tokens" : `❄ Protect ${esc(protectCandidate.label)}`}
        </button>
      ` : `
        <div class="sp-ok">✓ Streak unbroken — no day to protect</div>
      `}
      <button class="sp-btn ghost" id="sp-buy" ${!canAfford ? "disabled" : ""} title="${canAfford ? "Spend ₹" + price + " from your wallet" : "Need ₹" + (price - available) + " more"}">
        + Buy 1 token · ₹${price.toLocaleString()}
      </button>
    </div>
    <div class="sp-foot">
      Available: ₹${available.toLocaleString()} · frozen days count as green toward streak + perfect-week bonus.
    </div>
  `;
  pop.querySelector("#sp-buy")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await buyFreezeToken(price);
    renderStreakPop(pop);  // refresh
  });
  pop.querySelector("#sp-protect")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!protectCandidate) return;
    const ok = confirm(`❄ Protect ${protectCandidate.label} with 1 freeze token?\n\nThis marks it as a green day for the streak chain. The token is consumed. Not reversible.`);
    if (!ok) return;
    await applyFreezeToken(protectCandidate.key);
    renderStreakPop(pop);
    updateChrome();  // streak number updates
  });
}

async function buyFreezeToken(price) {
  const w = getWallet();
  if ((w.available || 0) < price) return;
  await updateWallet(w => {
    w.spent = (w.spent || 0) + price;
    w.freezeTokens = (w.freezeTokens || 0) + 1;
    w.ledger.push({ date: new Date().toISOString(), type: "freeze-buy", amount: -price, label: "Bought 1 Streak Freeze token" });
  });
}

async function applyFreezeToken(dateKey) {
  const w = getWallet();
  if ((w.freezeTokens || 0) < 1) return;
  await updateWallet(w => {
    w.freezeTokens = Math.max(0, (w.freezeTokens || 0) - 1);
    w.ledger.push({ date: new Date().toISOString(), type: "freeze-apply", amount: 0, label: `Applied freeze to ${dateKey}` });
  });
  await updateDayLog(dl => {
    if (!dl[dateKey]) return;
    dl[dateKey].frozen = true;
  });
}

function updateChrome() {
  const w = getWallet();
  const streak = computeStreak(getDayLog());
  const sN = document.getElementById("streak-n");
  const cN = document.getElementById("coin-n");
  if (sN) animateNumber(sN, Number(sN.textContent || 0), streak);
  if (cN) animateNumber(cN, parseInt(cN.textContent.replace(/[^0-9]/g, "") || "0", 10), w.available, true);
  updateNavBadges();
  updateTopbarCountdown();
}

// Topbar rollover countdown — same math as Today's chip but minimal styling.
// Live-updates every 30s via setInterval kicked off on first call.
let _tbcTimer = null;
function updateTopbarCountdown() {
  const el = document.getElementById("tb-countdown");
  const timeEl = document.getElementById("tbc-time");
  if (!el || !timeEl) return;
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 3600 * 1000;
  const ist = new Date(istMs);
  const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const boundaryMin = 19 * 60;
  const minsLeft = nowMin < boundaryMin ? boundaryMin - nowMin : (24 * 60) - nowMin + boundaryMin;
  const hh = Math.floor(minsLeft / 60), mm = minsLeft % 60;
  timeEl.textContent = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
  el.classList.remove("tbc-calm", "tbc-warn", "tbc-urgent");
  if (minsLeft < 30) el.classList.add("tbc-urgent");
  else if (minsLeft < 120) el.classList.add("tbc-warn");
  else el.classList.add("tbc-calm");
  if (!_tbcTimer) _tbcTimer = setInterval(updateTopbarCountdown, 30 * 1000);
}

// Sidebar nav badges — Today pending count · Library (total · solved) · Shop wishlist count.
// Reads live state so edits anywhere repaint the counts.
function updateNavBadges() {
  // Today: open tasks on today's dayLog
  const dateKey = todayKey();
  const day = getDayLog()[dateKey];
  const todayBadge = document.getElementById("nb-today");
  const todayNavIc = document.querySelector('.nav a[data-route="today"] .nav-ic');
  if (todayBadge) {
    const open = day ? (day.assigned?.length || 0) - (day.done?.length || 0) : 0;
    const fullyDone = day?.assigned?.length && open === 0;
    if (open > 0) {
      todayBadge.textContent = String(open);
      todayBadge.hidden = false;
      todayBadge.classList.toggle("nb-done", false);
    } else if (fullyDone) {
      todayBadge.textContent = "✓";
      todayBadge.hidden = false;
      todayBadge.classList.add("nb-done");
    } else {
      todayBadge.hidden = true;
    }
    // Nav icon switch — 📅 → ✓ when day is sealed. Subtle "day complete" cue.
    if (todayNavIc) {
      todayNavIc.textContent = fullyDone ? "✓" : "📅";
      todayNavIc.classList.toggle("nav-ic-done", !!fullyDone);
    }
  }

  // Library: total rows · solved rows
  const libBadge = document.getElementById("nb-library");
  if (libBadge) {
    const sheets = getSheets();
    let total = 0, solved = 0;
    for (const sh of Object.values(sheets)) {
      if (!sh.rows?.length) continue;
      total += sh.rows.length;
      const statusCol = sh.headers.find(h => /^status$/i.test(h));
      if (statusCol) {
        for (const r of sh.rows) if (/^(solved|done)$/i.test(r[statusCol] || "")) solved++;
      }
    }
    if (total > 0) {
      libBadge.innerHTML = `<span class="nb-num">${total}</span><span class="nb-sep">·</span><span class="nb-solved">${solved}</span>`;
      libBadge.hidden = false;
    } else {
      libBadge.hidden = true;
    }
  }

  // Shop: wishlist count
  const shopBadge = document.getElementById("nb-shop");
  if (shopBadge) {
    const wishCount = (getWallet().wishlist || []).length;
    if (wishCount > 0) {
      shopBadge.innerHTML = `<span class="nb-heart">♡</span>${wishCount}`;
      shopBadge.hidden = false;
    } else {
      shopBadge.hidden = true;
    }
  }
}

function animateNumber(el, from, to, formatThousands = false) {
  const start = performance.now();
  const dur = 420;
  function step(t) {
    const p = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = Math.round(from + (to - from) * eased);
    el.textContent = formatThousands ? val.toLocaleString() : String(val);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }

// -------- Start session (Grok-generated) --------
function openStartSessionModal() {
  document.querySelectorAll(".ss-modal-scrim").forEach(m => m.remove());
  const modal = document.createElement("div");
  modal.className = "ss-modal-scrim";
  modal.innerHTML = `
    <div class="ss-modal" role="dialog" aria-label="Start a session">
      <header>
        <div>
          <div class="ss-eyebrow">START SESSION · BUILT BY GROQ</div>
          <h2>What do you want to work on right now?</h2>
        </div>
        <button class="icon-btn" id="ss-close" aria-label="Close">✕</button>
      </header>
      <div class="ss-body">
        <div class="ss-presets">
          <button class="chip-preset" data-pre="30-min deep dive on the next HIGH-freq DSA I haven't solved. One problem. Lock it in.">⚡ 30-min deep dive</button>
          <button class="chip-preset" data-pre="60-min mock interview session. One medium DSA + one short system-design concept. Explain tradeoffs out loud as if an interviewer is listening.">🎯 60-min mock interview</button>
          <button class="chip-preset" data-pre="45-min pattern drill. Pick my weakest DSA pattern and give me 3 small problems from easy → hard.">🔁 45-min pattern drill</button>
          <button class="chip-preset" data-pre="20-min warmup. Review 2 previously solved problems from memory. No peeking.">☕ 20-min warmup</button>
        </div>
        <label class="ss-label">Describe the session you want</label>
        <textarea id="ss-prompt" rows="4" placeholder="e.g. 45 minutes. One graph problem. One revision of trees. Tell me honestly where I'm weak."></textarea>
        <label class="ss-label">Session length</label>
        <div class="ss-len">
          <button data-len="20">20 min</button>
          <button data-len="30" class="active">30 min</button>
          <button data-len="45">45 min</button>
          <button data-len="60">60 min</button>
          <button data-len="90">90 min</button>
        </div>
        <div id="ss-result" class="ss-result"></div>
      </div>
      <footer>
        <button class="btn-ghost" id="ss-cancel">Cancel</button>
        <button class="btn-primary" id="ss-build">Build session</button>
      </footer>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add("show"));

  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    modal.classList.remove("show");
    setTimeout(() => modal.parentNode && modal.remove(), 220);
  };
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  modal.querySelector("#ss-close").addEventListener("click", close);
  modal.querySelector("#ss-cancel").addEventListener("click", close);
  document.addEventListener("keydown", function esc(ev) {
    if (ev.key === "Escape") { document.removeEventListener("keydown", esc); close(); }
  });

  // preset chips -> fill textarea
  modal.querySelectorAll(".chip-preset").forEach(b => {
    b.addEventListener("click", () => { modal.querySelector("#ss-prompt").value = b.dataset.pre; });
  });
  // length chips
  let length = 30;
  modal.querySelectorAll(".ss-len button").forEach(b => {
    b.addEventListener("click", () => {
      length = Number(b.dataset.len);
      modal.querySelectorAll(".ss-len button").forEach(x => x.classList.toggle("active", x === b));
    });
  });

  modal.querySelector("#ss-build").addEventListener("click", async () => {
    const prompt = modal.querySelector("#ss-prompt").value.trim();
    if (!prompt) return alert("Describe the session first.");
    const resultEl = modal.querySelector("#ss-result");
    const btn = modal.querySelector("#ss-build");
    btn.disabled = true;
    btn.textContent = "Building…";
    resultEl.innerHTML = `<div class="think-dots-ss"><span></span><span></span><span></span></div>`;

    try {
      const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                     (await secure.get("grok_api_key").catch(() => null));
      if (!apiKey) {
        resultEl.innerHTML = `<p class="err">No Groq API key. Add one in Settings → AI butler.</p>`;
        btn.disabled = false; btn.textContent = "Build session";
        return;
      }

      const s = getSettings();
      const ctx = buildContext();
      const system = `You are GAIN's butler. Build a FOCUSED STUDY SESSION for Vikas based on his request.

RULES:
- Output ONLY JSON. No prose outside it.
- The session MUST fit within ${length} minutes total.
- Price each task between ₹${s.wallet.taskMin} and ₹${s.wallet.taskMax} by difficulty/importance/minutes.
- Use the user's actual sheet state (do NOT invent problems he doesn't have unless he explicitly asked for one off-sheet).
- When referencing a sheet item use the exact Seq number so the app can match it.

SHAPE:
{
  "title": "<2-6 word session title>",
  "rationale": "<1 sentence, honest>",
  "tasks": [
    { "ref": "DSA#86", "title": "Number of Islands", "minutes": 25, "value": 70, "kind": "dsa", "sheet": "DSA", "seq": 86 },
    { "ref": "REV-session", "title": "Explain tradeoffs out loud for 5 min", "minutes": 5, "value": 20, "kind": "revision" }
  ]
}

APP STATE:
${ctx}`;

      const res = await callGrok({
        apiKey, model: s.grok.model, temperature: 0.3,
        system, user: prompt
      });

      if (!res.ok) {
        resultEl.innerHTML = `<p class="err">${esc(res.error || "Grok failed")}</p>`;
        btn.disabled = false; btn.textContent = "Build session";
        return;
      }

      const parsed = extractJson(res.content);
      if (!parsed || !Array.isArray(parsed.tasks)) {
        resultEl.innerHTML = `
          <p class="err">Grok's reply wasn't parseable JSON. Raw reply:</p>
          <pre class="raw">${esc(res.content.slice(0, 400))}</pre>
        `;
        btn.disabled = false; btn.textContent = "Build session";
        return;
      }

      const totalMin = parsed.tasks.reduce((a, t) => a + (Number(t.minutes) || 0), 0);
      const totalRs  = parsed.tasks.reduce((a, t) => a + (Number(t.value) || 0), 0);
      resultEl.innerHTML = `
        <div class="ss-plan">
          <div class="ss-plan-head">
            <div>
              <div class="ss-plan-eyebrow">PROPOSED SESSION</div>
              <h3>${esc(parsed.title || "Session")}</h3>
              <p>${esc(parsed.rationale || "")}</p>
            </div>
            <div class="ss-plan-stats">
              <div><b>${totalMin}m</b><span>duration</span></div>
              <div><b>₹${totalRs}</b><span>bounty</span></div>
            </div>
          </div>
          <ul class="ss-plan-list">
            ${parsed.tasks.map(t => `
              <li>
                <div class="ssp-main">
                  <div class="ssp-title">${esc(t.title)}</div>
                  <div class="ssp-meta">${esc(t.kind || "task")} · ${Number(t.minutes)||0} min${t.ref?` · ${esc(t.ref)}`:""}</div>
                </div>
                <div class="ssp-val">+ ₹${Number(t.value)||0}</div>
              </li>
            `).join("")}
          </ul>
          <div class="ss-plan-cta">
            <button class="btn-ghost" id="ss-regen">Regenerate</button>
            <button class="btn-primary" id="ss-accept">Add to Today's plan</button>
          </div>
        </div>
      `;
      btn.disabled = false; btn.textContent = "Build session";

      resultEl.querySelector("#ss-regen").addEventListener("click", () => {
        resultEl.innerHTML = "";
        btn.click();
      });
      resultEl.querySelector("#ss-accept").addEventListener("click", async () => {
        await ensureDailyPlan();
        await updateDayLog(dl => {
          const key = todayKey();
          const day = dl[key];
          if (!day) return;
          for (const t of parsed.tasks) {
            if (day.assigned.some(x => x.ref === t.ref)) continue;
            const row = { ref: t.ref || `SESSION-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
                          kind: t.kind || "revision",
                          title: t.title || "Session task",
                          minutes: Number(t.minutes) || 15,
                          value: Number(t.value) || getSettings().wallet.taskMin,
                          sheet: t.sheet || null,
                          rowIndex: null };
            // Try to resolve sheet row by seq if provided
            if (t.sheet && t.seq != null) {
              const sh = getSheets()[t.sheet];
              if (sh) {
                const idx = sh.rows.findIndex(r => String(r.Seq) === String(t.seq));
                if (idx >= 0) row.rowIndex = idx;
              }
            }
            day.assigned.push(row);
            day.values[row.ref] = row.value;
          }
        });
        close();
        location.hash = "#today";
      });

    } catch (err) {
      resultEl.innerHTML = `<p class="err">${esc(err.message || err)}</p>`;
      btn.disabled = false; btn.textContent = "Build session";
    }
  });

  setTimeout(() => modal.querySelector("#ss-prompt")?.focus(), 60);
}

function extractJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

// -------- cursor-reactive glow for any .alive element --------
function wireAliveSheen() {
  document.addEventListener("mousemove", (e) => {
    const target = e.target.closest(".alive");
    if (!target) return;
    const r = target.getBoundingClientRect();
    target.style.setProperty("--mx", `${e.clientX - r.left}px`);
    target.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
}

// -------- global search --------
function wireGlobalSearch() {
  const input = document.getElementById("search");
  if (!input) return;

  // dropdown container (lives under topbar)
  let pop = document.getElementById("search-pop");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "search-pop";
    pop.className = "search-pop";
    pop.hidden = true;
    input.parentNode.appendChild(pop);
  }

  const ROUTES = [
    { label: "Dashboard", hash: "#dashboard", hint: "Everything at a glance" },
    { label: "Today",     hash: "#today",    hint: "Daily plan + motivation" },
    { label: "Weekly plan", hash: "#week",   hint: "Grok-built 7-day plan" },
    { label: "Calendar", hash: "#calendar", hint: "Heatmap · streak · green days" },
    { label: "Progress", hash: "#progress", hint: "Readiness · burn-up · weak patterns" },
    { label: "Library",  hash: "#library",  hint: "All sheets · inline edit · import" },
    { label: "Shop",     hash: "#shop",     hint: "Rewards · claim with honor" },
    { label: "Settings", hash: "#settings", hint: "Everything the engine respects" }
  ];

  let active = -1;
  let results = [];

  input.addEventListener("input", () => doSearch());
  input.addEventListener("focus", () => doSearch());
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(results.length - 1, active + 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(-1, active - 1); render(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); openResult(results[active]); }
    else if (e.key === "Escape") { pop.hidden = true; input.blur(); }
  });
  document.addEventListener("click", (e) => {
    if (e.target === input) return;
    if (!pop.contains(e.target)) pop.hidden = true;
  });
  // ⌘K focuses search
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.focus(); }
  });

  function doSearch() {
    const q = input.value.trim().toLowerCase();
    results = [];
    const sheets = getSheets();
    const sheetNames = Object.keys(sheets);

    if (!q) {
      // Default suggestions: sheets first, then routes
      for (const name of sheetNames) {
        results.push({
          kind: "sheet", label: `${name} library`,
          hint: `${sheets[name].rows.length} items · open the sheet`,
          hash: `#library/${encodeURIComponent(name)}`
        });
      }
      for (const r of ROUTES) results.push({ ...r, kind: "route" });
    } else {
      // Sheet-name shortcuts (dsa, system, integration, library, lib)
      for (const name of sheetNames) {
        const nq = name.toLowerCase();
        if (nq.includes(q) || q.includes(nq) ||
            (q === "dsa" && /dsa/i.test(name)) ||
            (q === "sd"  && /system|design/i.test(name)) ||
            (q === "int" && /integration|platform/i.test(name))) {
          results.push({
            kind: "sheet", label: `${name} library`,
            hint: `${sheets[name].rows.length} items · jump to sheet`,
            hash: `#library/${encodeURIComponent(name)}`
          });
        }
      }
      // routes
      for (const r of ROUTES) {
        if (r.label.toLowerCase().includes(q) || r.hint.toLowerCase().includes(q)) {
          results.push({ ...r, kind: "route" });
        }
      }
      // sheet rows (title/problem/topic matches)
      for (const [name, sh] of Object.entries(sheets)) {
        const titleCol = sh.headers.find(h => /^(problem|topic|skill|skillorplatform|name)$/i.test(h.replace(/[^a-z]/gi,""))) || sh.headers[1];
        for (let i = 0; i < sh.rows.length; i++) {
          const r = sh.rows[i];
          const title = String(r[titleCol] || "");
          if (title.toLowerCase().includes(q)) {
            results.push({
              kind: "row", sheet: name, idx: i, label: title,
              hint: `${name} · row ${i + 1}${r.Pattern ? " · " + r.Pattern : ""}`,
              hash: `#problem/${encodeURIComponent(name)}/${i}`
            });
            if (results.length > 30) break;
          }
        }
        if (results.length > 30) break;
      }
      // today's plan tasks
      const plan = getDayLog()[todayKey()];
      if (plan) {
        for (const t of plan.assigned) {
          if (t.title.toLowerCase().includes(q)) {
            results.push({ kind: "task", label: t.title, hint: `Today · ${t.ref}`, hash: "#today" });
          }
        }
      }
    }
    active = -1;
    render();
  }

  function render() {
    if (!results.length) {
      pop.hidden = true;
      return;
    }
    pop.hidden = false;
    pop.innerHTML = results.slice(0, 20).map((r, i) => `
      <button class="sr ${i === active ? "active" : ""}" data-i="${i}" type="button">
        <span class="sr-kind sr-${r.kind}">${esc(r.kind)}</span>
        <span class="sr-label">${esc(r.label)}</span>
        <span class="sr-hint">${esc(r.hint)}</span>
      </button>
    `).join("");
    // Keep the active row scrolled into view (keyboard nav)
    if (active >= 0) {
      const el = pop.querySelector(`.sr[data-i="${active}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }
  }

  // Highlight on hover without re-rendering — just toggle the .active class
  pop.addEventListener("mouseover", (e) => {
    const btn = e.target.closest(".sr");
    if (!btn) return;
    const idx = Number(btn.dataset.i);
    if (idx !== active) {
      active = idx;
      pop.querySelectorAll(".sr").forEach(b => b.classList.toggle("active", Number(b.dataset.i) === active));
    }
  });

  // mousedown wins over the document click-outside listener, which fires before click
  // can propagate from a replaced button. Using pointerdown ensures the navigation
  // happens even if render() swaps the DOM between mousedown and mouseup.
  pop.addEventListener("mousedown", (e) => {
    const btn = e.target.closest(".sr");
    if (!btn) return;
    e.preventDefault();   // keep focus from leaving the input mid-navigation
    e.stopPropagation();
    const idx = Number(btn.dataset.i);
    openResult(results[idx]);
  });

  function openResult(r) {
    if (!r) return;
    pop.hidden = true;
    input.value = "";
    results = [];
    active = -1;
    // Use setTimeout so hash change + any re-render happens cleanly after the current event
    setTimeout(() => { location.hash = r.hash; input.blur(); }, 0);
  }
}

main().catch(err => {
  console.error(err);
  document.getElementById("view").innerHTML =
    `<div class="view-inner"><div class="card"><h2>Boot failed</h2><pre>${esc(err.stack || err.message || err)}</pre></div></div>`;
});
