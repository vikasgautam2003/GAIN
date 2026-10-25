// Daily recap modal — fires on last tick OR 18:50 IST (10 min before rollover),
// whichever comes first. Debounced to once per calendar day.
// Shows: 4 stat tiles · Groq reflection · 3-bullet tomorrow focus · Lock day in.

import { getDayLog, getSheets, getWallet, getSettings, callGrok, secure } from "./store.js";
import { todayKey, calendarKey } from "./engine.js";
import { renderMarkdown } from "./info.js";
import { callGroqJSON } from "./groqJson.js";

const FIRED_KEY_PREFIX = "gain:recapFiredOn:";

// -------- public: fire + schedule --------
export function hasRecapFiredToday(dateKey = todayKey()) {
  return !!localStorage.getItem(FIRED_KEY_PREFIX + dateKey);
}

export function markRecapFired(dateKey = todayKey()) {
  localStorage.setItem(FIRED_KEY_PREFIX + dateKey, String(Date.now()));
}

// Try to open the recap for a given date. Returns true if actually opened,
// false if debounced (already fired, no plan, or plan incomplete).
export async function tryOpenRecap({ force = false, reason = "manual" } = {}) {
  const dateKey = todayKey();
  const day = getDayLog()[dateKey];
  if (!day || !day.assigned?.length) return false;
  const allDone = day.done?.length >= day.assigned.length;
  if (!allDone && !force) return false;
  if (hasRecapFiredToday(dateKey) && !force) return false;
  markRecapFired(dateKey);
  openRecapModal({ dateKey, day, reason });
  return true;
}

// Boot-time: check now + every 2 min for the 18:50 IST window.
// If plan isn't complete by then but it's within window, still fire a
// shorter "midday checkpoint" variant (no, let's keep it simple: only fire
// when plan is complete OR within 10 min of boundary).
export function startRecapScheduler() {
  const check = async () => {
    const dateKey = todayKey();
    const day = getDayLog()[dateKey];
    if (!day || !day.assigned?.length) return;
    if (hasRecapFiredToday(dateKey)) return;

    const allDone = day.done?.length >= day.assigned.length;
    // Fire path 1: all tasks done (handled by handleTick usually, but boot
    //              check handles the "already-done-at-boot" case).
    if (allDone) {
      await tryOpenRecap({ reason: "all-done" });
      return;
    }

    // Fire path 2: within 10 min of 19:00 IST — fire a wrap-up recap even
    //              if plan incomplete. Encourages the "one last push" moment.
    const now = new Date();
    const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
    const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const boundaryMin = 19 * 60;
    const minsToBoundary = nowMin < boundaryMin ? boundaryMin - nowMin : -1;
    if (minsToBoundary >= 0 && minsToBoundary <= 10) {
      await tryOpenRecap({ force: true, reason: "boundary" });
    }
  };
  check();
  setInterval(check, 2 * 60 * 1000);  // every 2 min
}

// -------- stat computation --------
function computeStats(dateKey, day) {
  const sheets = getSheets();
  const wallet = getWallet();

  // Coins earned today — sum ledger `task` entries for today's calendar date.
  const todayCal = calendarKey();
  const coinsEarned = (wallet.ledger || [])
    .filter(e => e.type === "task" && new Date(e.date).toISOString().slice(0, 10) === todayCal)
    .reduce((a, e) => a + (Number(e.amount) || 0), 0);

  // Confidence average over today's solved tasks
  const doneRefs = day.done || [];
  const conf = day.confidence || {};
  const ratings = doneRefs.map(r => conf[r]).filter(n => n >= 1 && n <= 5);
  const confAvg = ratings.length ? Math.round(10 * (ratings.reduce((a, b) => a + b, 0) / ratings.length)) / 10 : 0;

  // Patterns touched — unique t.pattern across done tasks
  const doneTasks = (day.assigned || []).filter(t => doneRefs.includes(t.ref));
  const patterns = [...new Set(doneTasks.map(t => t.pattern).filter(Boolean))];

  // Minutes focused — sum of done task.minutes
  const minutesDone = doneTasks.reduce((a, t) => a + (Number(t.minutes) || 0), 0);

  return {
    coinsEarned,
    confAvg,
    patterns,
    patternCount: patterns.length,
    minutesDone,
    doneTasks,
    totalAssigned: day.assigned?.length || 0,
    totalDone: doneRefs.length,
    completedFully: doneRefs.length >= (day.assigned?.length || 0),
  };
}

// -------- modal --------
async function openRecapModal({ dateKey, day, reason }) {
  // Nuke any stale instance
  document.querySelectorAll(".recap-scrim").forEach(m => m.remove());

  const stats = computeStats(dateKey, day);
  const dateLabel = fmtDate(dateKey);

  const scrim = document.createElement("div");
  scrim.className = "recap-scrim";
  scrim.innerHTML = `
    <div class="recap-modal" role="dialog" aria-label="Daily recap">
      <header class="rcp-head">
        <div>
          <div class="rcp-eyebrow">${reason === "boundary" ? "⏱ 10 min to rollover" : "✓ Day complete"}</div>
          <h2>Today's recap · ${dateLabel}</h2>
        </div>
        <button class="rcp-close" aria-label="Close">✕</button>
      </header>

      <div class="rcp-body">
        <div class="rcp-stats">
          <div class="rcp-tile">
            <div class="rt-ico">🪙</div>
            <div class="rt-val">₹${stats.coinsEarned}</div>
            <div class="rt-lb">earned</div>
          </div>
          <div class="rcp-tile">
            <div class="rt-ico">⭐</div>
            <div class="rt-val">${stats.confAvg || "—"}${stats.confAvg ? '<small>★</small>' : ""}</div>
            <div class="rt-lb">avg confidence</div>
          </div>
          <div class="rcp-tile">
            <div class="rt-ico">🧩</div>
            <div class="rt-val">${stats.patternCount}</div>
            <div class="rt-lb">pattern${stats.patternCount === 1 ? "" : "s"} touched</div>
          </div>
          <div class="rcp-tile">
            <div class="rt-ico">⏱</div>
            <div class="rt-val">${stats.minutesDone}<small>m</small></div>
            <div class="rt-lb">focused</div>
          </div>
        </div>

        <div class="rcp-section">
          <div class="rcp-sec-head">
            <span class="rcp-sec-ico">🧘</span>
            <div>
              <div class="rcp-sec-title">The butler's honest take</div>
              <div class="rcp-sec-sub">Grounded in today's stats and your weak patterns.</div>
            </div>
          </div>
          <div class="rcp-reflection" id="rcp-reflection">
            <div class="rcp-gate">Click <b>✦ Ask the butler</b> below to generate a reflection + 3 focus points for tomorrow. One Groq call.</div>
          </div>
        </div>

        <div class="rcp-section">
          <div class="rcp-sec-head">
            <span class="rcp-sec-ico">🎯</span>
            <div>
              <div class="rcp-sec-title">Tomorrow's focus</div>
              <div class="rcp-sec-sub">Three concrete moves — do these first.</div>
            </div>
          </div>
          <ul class="rcp-focus" id="rcp-focus">
            <li class="rcp-gate-li">Three bullets will appear here after you ask the butler.</li>
          </ul>
        </div>
      </div>

      <footer class="rcp-foot">
        <button class="rcp-btn ghost" id="rcp-ask">✦ Ask the butler</button>
        <button class="rcp-btn primary" id="rcp-lock">Lock day in →</button>
      </footer>
    </div>
  `;
  document.body.appendChild(scrim);

  // Lock scroll
  document.body.style.overflow = "hidden";

  const close = () => {
    document.body.style.overflow = "";
    scrim.remove();
  };
  scrim.querySelector(".rcp-close").addEventListener("click", close);
  scrim.querySelector("#rcp-lock").addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });

  // Groq fetch — reflection + 3 bullets in one call
  const fillGroq = async () => {
    const reflectionEl = scrim.querySelector("#rcp-reflection");
    const focusEl = scrim.querySelector("#rcp-focus");
    try {
      const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                     (await secure.get("grok_api_key").catch(() => null));
      if (!apiKey) {
        reflectionEl.innerHTML = `<p class="rcp-err">Add a Groq API key in <a href="#settings">Settings → AI butler</a> to unlock the reflection.</p>`;
        focusEl.innerHTML = `<li>Keep today's pattern momentum — one more problem of the same shape.</li>
                             <li>Attempt one Medium you've been dodging.</li>
                             <li>Review ★1 or ★2 solves from the last 7 days.</li>`;
        return;
      }
      const ctx = buildGroqContext(stats, day);
      const res = await callGroqJSON({
        apiKey,
        maxTokens: 1024,
        system: `You are GAIN's honest FDE interview-prep butler. The user has finished today's grind.
Reply in STRICT JSON with keys "reflection" (string, 3 short sentences, interview-tone, keyword-dense, name specific patterns, no fluff) and "focus" (array of exactly 3 short strings, each a concrete action for tomorrow — reference specific patterns/problems/behaviors, each under 100 chars).
No markdown. No preamble. JSON only.`,
        user: ctx,
        label: "recap",
        schemaCheck: (obj) => {
          if (!obj || typeof obj !== "object") return "not an object";
          if (typeof obj.reflection !== "string" || !obj.reflection.trim()) return "reflection missing";
          if (!Array.isArray(obj.focus) || obj.focus.length < 1) return "focus array missing";
          return true;
        },
      });
      if (!res.ok) throw new Error(res.error);
      const parsed = res.data;

      reflectionEl.innerHTML = `<p>${renderMarkdown(parsed.reflection || "No reflection today — try the regenerate button.")}</p>`;
      const bullets = Array.isArray(parsed.focus) ? parsed.focus.slice(0, 3) : [];
      focusEl.innerHTML = bullets.length
        ? bullets.map(b => `<li>${renderMarkdown(String(b))}</li>`).join("")
        : `<li>No clear focus signal — regenerate.</li>`;
    } catch (e) {
      reflectionEl.innerHTML = `<p class="rcp-err">Butler couldn't reach Groq: ${esc(e.message || e)}. Click regenerate to retry.</p>`;
      focusEl.innerHTML = `<li>Keep the pattern streak going — one more of today's shape.</li>
                           <li>Tackle one Medium you've been avoiding.</li>
                           <li>Review ★1 / ★2 solves from the last 7 days.</li>`;
    }
  };

  const askBtn = scrim.querySelector("#rcp-ask");
  let hasAsked = false;
  askBtn.addEventListener("click", async (e) => {
    e.target.disabled = true;
    const original = hasAsked ? "↻ Regenerate" : "✦ Ask the butler";
    e.target.textContent = "Asking Groq…";
    scrim.querySelector("#rcp-reflection").innerHTML = `<div class="rcp-skeleton"><div class="skel-line"></div><div class="skel-line"></div><div class="skel-line short"></div></div>`;
    scrim.querySelector("#rcp-focus").innerHTML = `<li class="rcp-skeleton"><div class="skel-line"></div></li><li class="rcp-skeleton"><div class="skel-line"></div></li><li class="rcp-skeleton"><div class="skel-line"></div></li>`;
    await fillGroq();
    hasAsked = true;
    e.target.disabled = false;
    e.target.textContent = "↻ Regenerate";
  });

  // Groq is NOT fired on open. User must explicitly click "Ask the butler".
}

function buildGroqContext(stats, day) {
  const settings = getSettings();
  const tasks = stats.doneTasks.map(t => {
    const c = day.confidence?.[t.ref];
    return `• ${t.title} [${t.pattern || "no-pattern"}, ${t.kind}${c ? `, ★${c}` : ""}]`;
  }).join("\n");

  // Weak patterns — any pattern touched today with avg confidence <= 2.5
  const patternScores = {};
  for (const t of stats.doneTasks) {
    const c = day.confidence?.[t.ref];
    if (!c || !t.pattern) continue;
    if (!patternScores[t.pattern]) patternScores[t.pattern] = [];
    patternScores[t.pattern].push(c);
  }
  const weakPatterns = Object.entries(patternScores)
    .map(([p, cs]) => ({ pattern: p, avg: cs.reduce((a, b) => a + b, 0) / cs.length }))
    .filter(x => x.avg <= 2.5)
    .map(x => x.pattern);

  const target = settings.profile.targetRole || "FDE";
  const targetDate = settings.profile.targetDate || "";

  return `
Target role: ${target}, by ${targetDate}
Today's totals: ${stats.totalDone}/${stats.totalAssigned} tasks, ₹${stats.coinsEarned} earned, ${stats.minutesDone} minutes focused, avg confidence ${stats.confAvg || "n/a"}★.
Patterns touched: ${stats.patterns.join(", ") || "none"}
Weak patterns today (★ ≤ 2.5 avg): ${weakPatterns.join(", ") || "none"}
Tasks solved today:
${tasks || "(none)"}
Give a 3-sentence reflection + 3 concrete tomorrow actions.
`.trim();
}

function fmtDate(iso) {
  try {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });
  } catch (_) { return iso; }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }
  )[c]);
}

// -------- styles (injected once) --------
function injectStyles() {
  if (document.getElementById("recap-styles")) return;
  const style = document.createElement("style");
  style.id = "recap-styles";
  style.textContent = `
    .recap-scrim {
      position: fixed; inset: 0; z-index: 1200;
      background: rgba(8,10,14,.66);
      backdrop-filter: blur(10px) saturate(140%);
      -webkit-backdrop-filter: blur(10px) saturate(140%);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: rcpFade 220ms ease both;
    }
    @keyframes rcpFade { from { opacity: 0; } to { opacity: 1; } }
    .recap-modal {
      background: var(--paper); border-radius: 20px;
      width: 100%; max-width: 620px; max-height: 90vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 32px 80px rgba(0,0,0,.4), 0 0 0 1px var(--line);
      animation: rcpPop 240ms cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes rcpPop {
      from { opacity: 0; transform: translateY(16px) scale(.96); }
      to   { opacity: 1; transform: translateY(0)    scale(1);   }
    }
    .recap-modal .rcp-head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--line);
    }
    .recap-modal .rcp-eyebrow {
      font-size: 11px; letter-spacing: .14em; font-weight: 700;
      color: var(--gold); text-transform: uppercase; margin-bottom: 4px;
    }
    .recap-modal .rcp-head h2 { margin: 0; font-size: 20px; font-weight: 700; color: var(--ink); letter-spacing: -.01em; }
    .recap-modal .rcp-close {
      border: none; background: transparent; cursor: pointer; color: var(--mut);
      width: 32px; height: 32px; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center;
      font: 400 18px/1 var(--font-sans);
      transition: all .18s;
    }
    .recap-modal .rcp-close:hover { background: var(--bg); color: var(--ink); }

    .recap-modal .rcp-body { padding: 20px 24px; overflow-y: auto; flex: 1; }

    .recap-modal .rcp-stats {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px;
    }
    .recap-modal .rcp-tile {
      background: var(--bg); border: 1px solid var(--line);
      border-radius: 12px; padding: 14px 10px;
      text-align: center;
    }
    .recap-modal .rcp-tile .rt-ico { font-size: 18px; opacity: .85; margin-bottom: 2px; }
    .recap-modal .rcp-tile .rt-val {
      font-size: 22px; font-weight: 800; color: var(--ink); letter-spacing: -.02em;
    }
    .recap-modal .rcp-tile .rt-val small { font-size: 11px; font-weight: 600; color: var(--mut); margin-left: 1px; }
    .recap-modal .rcp-tile .rt-lb { font-size: 10.5px; color: var(--mut); margin-top: 2px; letter-spacing: .02em; }

    .recap-modal .rcp-section {
      margin-top: 18px; padding: 14px 16px;
      background: var(--bg); border: 1px solid var(--line);
      border-radius: 12px;
    }
    .recap-modal .rcp-sec-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
    .recap-modal .rcp-sec-ico { font-size: 18px; margin-top: 2px; }
    .recap-modal .rcp-sec-title { font-size: 13.5px; font-weight: 700; color: var(--ink); }
    .recap-modal .rcp-sec-sub { font-size: 11.5px; color: var(--mut); margin-top: 1px; }

    .recap-modal .rcp-reflection p { margin: 0; font-size: 14px; line-height: 1.6; color: var(--ink); }
    .recap-modal .rcp-reflection .rcp-err { color: var(--red); font-size: 13px; }
    .recap-modal .rcp-reflection .rcp-err a { color: var(--blue); font-weight: 600; }

    .recap-modal .rcp-focus { margin: 0; padding: 0; list-style: none; }
    .recap-modal .rcp-focus li {
      padding: 10px 12px; margin-top: 6px;
      background: var(--paper); border: 1px solid var(--line);
      border-left: 3px solid var(--gold);
      border-radius: 8px;
      font-size: 13.5px; color: var(--ink); line-height: 1.5;
    }
    .recap-modal .rcp-focus li:first-child { margin-top: 0; }

    .recap-modal .rcp-skeleton {
      display: flex; flex-direction: column; gap: 8px;
    }
    .recap-modal .skel-line {
      height: 10px; border-radius: 6px;
      background: linear-gradient(90deg,
        var(--line) 0%, color-mix(in oklab, var(--line) 50%, var(--paper)) 50%, var(--line) 100%);
      background-size: 200% 100%;
      animation: skelShimmer 1200ms ease-in-out infinite;
    }
    .recap-modal .skel-line.short { width: 60%; }

    /* Groq-gate placeholders — show the "ask explicitly" affordance */
    .recap-modal .rcp-gate {
      padding: 14px 16px;
      background: color-mix(in oklab, var(--gold) 8%, transparent);
      border: 1px dashed color-mix(in oklab, var(--gold) 40%, transparent);
      border-radius: 10px;
      color: var(--mut); font-size: 13px; line-height: 1.5;
    }
    .recap-modal .rcp-gate b { color: var(--gold); font-weight: 700; }
    .recap-modal .rcp-gate-li {
      list-style: none; padding: 10px 14px;
      background: color-mix(in oklab, var(--gold) 6%, transparent);
      border: 1px dashed color-mix(in oklab, var(--gold) 35%, transparent);
      border-radius: 8px;
      color: var(--mut); font-size: 12.5px; line-height: 1.5;
      font-style: italic;
    }
    @keyframes skelShimmer {
      from { background-position: 200% 0; }
      to   { background-position: -200% 0; }
    }

    .recap-modal .rcp-foot {
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 14px 24px;
      background: var(--bg); border-top: 1px solid var(--line);
    }
    .recap-modal .rcp-btn {
      padding: 10px 20px; border-radius: 10px; cursor: pointer;
      font: 600 13px/1 var(--font-sans);
      border: 1px solid var(--line);
      transition: all .18s;
    }
    .recap-modal .rcp-btn.ghost { background: var(--paper); color: var(--mut); }
    .recap-modal .rcp-btn.ghost:hover { color: var(--ink); border-color: var(--line2); }
    .recap-modal .rcp-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .recap-modal .rcp-btn.primary:hover { transform: translateY(-1px); filter: brightness(1.08); }

    @media (max-width: 520px) {
      .recap-modal .rcp-stats { grid-template-columns: repeat(2, 1fr); }
    }
  `;
  document.head.appendChild(style);
}

injectStyles();
