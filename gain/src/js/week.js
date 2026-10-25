// Weekly plan — user types a short prompt → Grok generates a 7-day plan.
// Clean, segregated by day. "Breath-taking" via simple elegance (not clutter).

import { getSettings, getSheets, getWallet, getDayLog, getWeeklyPlan, secure, callGrok, applyWeeklyPlan, on } from "./store.js";
import { todayKey } from "./engine.js";
import { openFormModal, confirmDanger } from "./modals.js";

let unsub = null;
let currentPlan = null;   // last plan from Grok, held in memory

export default {
  mount(root) {
    root.innerHTML = render();
    attach(root);
    // Rehydrate: prefer the saved weekly_plan.json; fall back to reconstructing from dayLog.
    const existing = getWeeklyPlan() || reconstructPlanFromDayLog();
    if (existing && Array.isArray(existing.days) && existing.days.length) {
      currentPlan = existing;
      renderPlan(root, existing);
      const savedWhen = existing.savedAt ? ` · saved ${new Date(existing.savedAt).toLocaleString()}` : "";
      setStatus(root, `✓ Current week plan loaded · ${existing.days.length} days${savedWhen}`, "ok");
    }
    if (unsub) unsub();
    unsub = on((ev) => {
      // Rebuild the plan view when dayLog or weeklyPlan changes elsewhere
      if ((ev === "dayLog" || ev === "weeklyPlan") && currentPlan) {
        const refreshed = getWeeklyPlan() || reconstructPlanFromDayLog();
        if (refreshed) { currentPlan = refreshed; renderPlan(root, refreshed); }
      }
    });
  },
  unmount() { if (unsub) { unsub(); unsub = null; } }
};

// Rebuild a plan object from the dayLog for this week's dates. Returns null if nothing's there.
function reconstructPlanFromDayLog() {
  const dayLog = getDayLog();
  const dates = computeWeekDates();
  const DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  let anyTasks = false;
  let title = "", rationale = "";
  const days = dates.map((date, i) => {
    const entry = dayLog[date];
    const assigned = entry?.assigned || [];
    if (assigned.length) anyTasks = true;
    if (entry?.weeklyPlan?.title && !title) title = entry.weeklyPlan.title;
    return {
      day: DAY_NAMES[i],
      date,
      theme: entry?.weeklyPlan?.theme || "",
      tasks: assigned.map(t => ({
        ref: t.ref, title: t.title, kind: t.kind, minutes: t.minutes,
        value: t.value, sheet: t.sheet, seq: t.seq ?? null,
        pattern: t.pattern || "", difficulty: t.difficulty || "", freq: t.freq || ""
      }))
    };
  });
  if (!anyTasks) return null;
  return { title: title || "This week", rationale, days };
}

function render() {
  return `
    <div class="view-inner week">
      <div class="eyebrow">WEEKLY PLAN</div>
      <h1 class="w-title">Shape your <span class="italic">week</span>.</h1>
      <p class="w-sub">Tell the butler what you want this week to look like. It drafts a 7-day plan for you to accept or redirect.</p>

      <!-- Prompt area -->
      <div class="w-prompt-card">
        <div class="w-presets">
          <button class="chip" data-pre="Interview-ready sprint. 1 hard DSA each weekday. System design on Mon + Thu. Weekend = retries of weak patterns.">⚡ Interview sprint</button>
          <button class="chip" data-pre="Pattern mastery week. Focus on graphs — 3 problems a day. SD only Sunday.">🔁 Pattern mastery</button>
          <button class="chip" data-pre="Light recovery week. 1 easy DSA per weekday. SD + INT revisions on Sat.">☕ Light recovery</button>
          <button class="chip" data-pre="Mock interview week. 2 mocks (Wed + Sun). Rest of the week = targeted drills on your weakest 3 patterns.">🎯 Mock interview</button>
        </div>
        <label class="w-label">What do you want this week to look like?</label>
        <textarea id="w-prompt" rows="4" placeholder="e.g. Focus on DP + graphs. Mon = system design (consistency models). Weekend = retries of all REVIEW items."></textarea>
        <div class="w-controls">
          <button class="btn-primary" id="w-build">✦ Build weekly plan</button>
          <span id="w-status" class="w-status"></span>
        </div>
      </div>

      <!-- Plan output -->
      <div class="w-plan" id="w-plan">
        <div class="w-empty">
          <div class="w-empty-ic">🗓</div>
          <h3>Your week will appear here.</h3>
          <p>Pick a preset or type what you want, then hit <b>Build weekly plan</b>.</p>
        </div>
      </div>

      ${styles()}
    </div>
  `;
}

function attach(root) {
  // Preset chips
  root.querySelectorAll(".chip[data-pre]").forEach(b => {
    b.addEventListener("click", () => {
      root.querySelector("#w-prompt").value = b.dataset.pre;
    });
  });

  root.querySelector("#w-build").addEventListener("click", async () => {
    const prompt = root.querySelector("#w-prompt").value.trim();
    if (!prompt) { setStatus(root, "Describe your week first.", "err"); return; }

    const btn = root.querySelector("#w-build");
    btn.disabled = true;
    btn.textContent = "✦ Building…";
    setStatus(root, "Butler drafting your week…", "wait");

    try {
      const apiKey = (await secure.get("groq_api_key").catch(() => null))
                 || (await secure.get("grok_api_key").catch(() => null));
      if (!apiKey) {
        setStatus(root, "No Groq API key — add one in Settings → AI butler.", "err");
        btn.disabled = false; btn.textContent = "✦ Build weekly plan"; return;
      }

      const s = getSettings();
      const ctx = buildContext();
      const weekDates = computeWeekDates();   // Monday→Sunday of the current (or upcoming if Sun) week

      const system = `You are GAIN's AI butler. Produce a FOCUSED 7-DAY WEEKLY PLAN for Vikas.

OUTPUT CONTRACT — THIS IS NON-NEGOTIABLE:
- Return ONLY a single valid JSON object.
- NO markdown, NO code fences, NO prose, NO comments.
- The response MUST parse with JSON.parse() on the first try.
- All keys and strings must be double-quoted. No trailing commas.

CONTEXT:
- User: Vikas, Rocketlane engineer, targeting FDE roles (10 LPA+), coding in Java.
- Schedule caps: maxTasksPerDay=${s.schedule.maxTasksPerDay}, newDsaPerWeekday=${s.schedule.newDsaPerWeekday}, weekdayMinutes=${s.profile.weekdayMinutes}.
- Pricing: each task value is an integer between ${s.wallet.taskMin} and ${s.wallet.taskMax}.
- Mon-Fri = core work. Sat = retries of REVIEW items. Sun = synthesis + 1 system design case.
- Prioritize HIGH-freq items and weak patterns.
- Use real LeetCode / topic names (NEVER placeholder titles like "Task 1" or "Problem"). If the user pastes a plan, use their exact problem names.

HARD RULES:
1. "days" MUST be an array of EXACTLY 7 objects, in order Monday → Sunday.
2. Each day's "date" MUST use these exact ISO dates (YYYY-MM-DD):
   Monday=${weekDates[0]}, Tuesday=${weekDates[1]}, Wednesday=${weekDates[2]}, Thursday=${weekDates[3]}, Friday=${weekDates[4]}, Saturday=${weekDates[5]}, Sunday=${weekDates[6]}.
3. Every task MUST have ALL fields: ref, title, minutes (int), value (int), kind, sheet (or null), seq (int or null).
4. "title" MUST be a real problem/topic name, never a generic placeholder.
5. Each day should have 1–${s.schedule.maxTasksPerDay} tasks. Sunday can be lighter.
6. "kind" is one of: "dsa" | "sd" | "int" | "ext" | "sql" | "os" | "revision" | "log".
7. "sheet" is one of: "DSA" | "System Design" | "Integrations" | "Interview Extras" | null.

JSON SHAPE (reply must match this schema exactly):
{
  "title": "Pattern Mastery Week",
  "rationale": "Grind graph patterns Mon-Wed, DP Thu-Fri, retries weekend.",
  "days": [
    {
      "day": "Monday",
      "date": "${weekDates[0]}",
      "theme": "Arrays & Hashing",
      "tasks": [
        { "ref": "DSA#49", "title": "Group Anagrams", "minutes": 30, "value": 60, "kind": "dsa", "sheet": "DSA", "seq": 49 },
        { "ref": "DSA#70", "title": "Climbing Stairs", "minutes": 20, "value": 20, "kind": "dsa", "sheet": "DSA", "seq": 70 }
      ]
    }
    // ... six more day objects (Tue, Wed, Thu, Fri, Sat, Sun)
  ]
}

STATE:
${ctx}`;

      // Try JSON mode first (Groq supports response_format: json_object)
      const res = await callGrok({
        apiKey, model: s.grok.model, temperature: 0.2,
        system, user: prompt, jsonMode: true
      });

      if (!res.ok) {
        setStatus(root, `Groq failed: ${res.error}`, "err");
        btn.disabled = false; btn.textContent = "✦ Build weekly plan"; return;
      }

      let parsed = extractJson(res.content);

      // Validate: reject placeholder slop ("Task 1", "Problem", "TBD") — Groq slipped into stub mode last time.
      if (parsed && Array.isArray(parsed.days)) {
        const stubFound = parsed.days.some(d =>
          (d.tasks || []).some(t => /^(task\s*\d+|problem|tbd|placeholder|lorem|example)$/i.test((t.title || "").trim()))
        );
        if (stubFound) {
          console.warn("[week] Groq returned placeholder titles — rejecting + retrying");
          parsed = null;
        }
      }

      // Auto-repair: if first reply isn't valid or had stubs, ask Groq to rebuild from the raw user prompt.
      if (!parsed || !Array.isArray(parsed.days)) {
        setStatus(root, "Groq slipped — asking it to rebuild with real problem names…", "wait");
        const repairSys = `${system}

PREVIOUS ATTEMPT FAILED. Build the plan again from the user's prompt. Use REAL problem names (never "Task 1"). Return ONLY the JSON object.`;
        const repair = await callGrok({
          apiKey, model: s.grok.model, temperature: 0,
          system: repairSys, user: prompt, jsonMode: true
        });
        if (repair.ok) parsed = extractJson(repair.content);
      }

      if (!parsed || !Array.isArray(parsed.days) || parsed.days.length === 0) {
        const snippet = (res.content || "").slice(0, 240).replace(/\s+/g, " ");
        setStatus(root, `Reply wasn't valid even after repair. Snippet: ${snippet}…`, "err");
        btn.disabled = false; btn.textContent = "✦ Build weekly plan"; return;
      }

      // Pad to 7 days if Groq slipped (use canonical dates)
      parsed.days = ensureSevenDays(parsed.days, weekDates);

      currentPlan = parsed;
      setStatus(root, `✓ Draft ready — review and save`, "ok");
      btn.disabled = false; btn.textContent = "✦ Rebuild";

      // Open the preview-and-edit modal before anything hits dayLog
      openPreviewModal(root, parsed);

    } catch (err) {
      setStatus(root, `Error: ${err.message || err}`, "err");
      btn.disabled = false; btn.textContent = "✦ Build weekly plan";
    }
  });
}

function renderPlan(root, plan) {
  const el = root.querySelector("#w-plan");
  const totalM = plan.days.reduce((a, d) => a + (d.tasks || []).reduce((aa, t) => aa + (Number(t.minutes) || 0), 0), 0);
  const totalR = plan.days.reduce((a, d) => a + (d.tasks || []).reduce((aa, t) => aa + (Number(t.value) || 0), 0), 0);

  el.innerHTML = `
    <div class="plan-head">
      <div>
        <div class="plan-eyebrow">PROPOSED WEEK</div>
        <h2 class="plan-title">${esc(plan.title || "Week plan")}</h2>
        <p class="plan-rationale">${esc(plan.rationale || "")}</p>
      </div>
      <div class="plan-stats">
        <div class="ps"><b>${plan.days.length}</b><span>days</span></div>
        <div class="ps"><b>${totalM}</b><span>minutes</span></div>
        <div class="ps gold"><b>₹${totalR}</b><span>bounty</span></div>
      </div>
    </div>

    <div class="days-grid">
      ${plan.days.map((d, i) => renderDay(d, i)).join("")}
    </div>
  `;
}

function renderDay(d, i) {
  const tasks = d.tasks || [];
  const mins = tasks.reduce((a, t) => a + (Number(t.minutes) || 0), 0);
  const rs = tasks.reduce((a, t) => a + (Number(t.value) || 0), 0);
  const isWeekend = /sat|sun/i.test(d.day || "");
  return `
    <div class="day ${isWeekend ? "weekend" : ""}">
      <div class="day-head">
        <div class="day-left">
          <div class="day-name">${esc(d.day || `Day ${i+1}`)}</div>
          <div class="day-date">${esc(d.date || "")}</div>
        </div>
        <div class="day-theme">${esc(d.theme || "")}</div>
      </div>
      <div class="day-tasks">
        ${tasks.length ? tasks.map(t => `
          <div class="day-task">
            <div class="dt-dot"></div>
            <div class="dt-main">
              <div class="dt-t">${esc(t.title)}</div>
              <div class="dt-m">${esc(t.kind || "task")} · ${Number(t.minutes) || 0} min${t.ref ? ` · ${esc(t.ref)}` : ""}</div>
            </div>
            <div class="dt-v">+ ₹${Number(t.value) || 0}</div>
          </div>
        `).join("") : `<div class="day-rest">Rest day</div>`}
      </div>
      <div class="day-foot">
        <span>${mins} min</span><span>₹${rs}</span>
      </div>
    </div>
  `;
}

function buildContext() {
  const sheets = getSheets();
  const s = getSettings();
  const w = getWallet();
  const dayLog = getDayLog();

  const sheetSummary = Object.entries(sheets).map(([name, sh]) => {
    const statusCol = sh.headers.find(h => /^status$/i.test(h));
    const freqCol = sh.headers.find(h => /^(freq|priority)$/i.test(h));
    let solved = 0, high = 0, highDone = 0;
    for (const r of sh.rows) {
      const st = String(r[statusCol] || "").toUpperCase();
      if (st === "SOLVED") solved++;
      if (freqCol && /^(HIGH|P1)$/i.test(r[freqCol] || "")) {
        high++; if (st === "SOLVED") highDone++;
      }
    }
    return `${name}: ${solved}/${sh.rows.length} solved · ${highDone}/${high} HIGH done`;
  }).join("\n");

  return `
Profile: ${s.profile.name} · target ${s.profile.targetRole} by ${s.profile.targetDate}
Schedule: maxTasksPerDay=${s.schedule.maxTasksPerDay}, SD/INT days=${s.schedule.sdIntDays.join(",")}
Wallet: earned=₹${w.earned}, available=₹${w.available}
Dynamic conditions: ${s.grok.dynamicConditions.join(" | ") || "(none)"}
Sheet state:
${sheetSummary}
Today: ${todayKey()}
  `.trim();
}

function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();

  // 1. Strip ```json ... ``` or ``` ... ``` code fences
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) t = fence[1].trim();

  // 2. Try the whole text as JSON first
  try { return JSON.parse(t); } catch (_) {}

  // 3. Walk balanced braces to find the LARGEST { ... } that parses cleanly.
  //    Handles prose before/after the object + nested braces + escaped quotes.
  for (let start = 0; start < t.length; start++) {
    if (t[start] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            const chunk = t.slice(start, i + 1);
            try { return JSON.parse(chunk); } catch (_) { break; }
          }
        }
      }
    }
  }
  return null;
}

function setStatus(root, msg, kind) {
  const el = root.querySelector("#w-status");
  if (!el) return;
  el.textContent = msg;
  el.className = `w-status ${kind || ""}`;
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }

// ---------- Week-date helpers ----------
function computeWeekDates(ref = new Date()) {
  // Monday of this week (if today is Sunday, use next-day Monday to start a new week)
  const d = new Date(ref);
  const dow = d.getDay(); // 0=Sun..6=Sat
  if (dow === 0) d.setDate(d.getDate() + 1);                  // Sunday → start Monday tomorrow
  else d.setDate(d.getDate() - (dow - 1));                    // Mon..Sat → back to this Monday
  const out = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(d); dt.setDate(d.getDate() + i);
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

function ensureSevenDays(days, weekDates) {
  const DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const byDate = new Map(days.map(d => [d.date, d]));
  const out = [];
  for (let i = 0; i < 7; i++) {
    const date = weekDates[i];
    const name = DAY_NAMES[i];
    const existing = byDate.get(date) || days.find(d => (d.day || "").toLowerCase() === name.toLowerCase());
    if (existing) {
      out.push({ ...existing, day: name, date, tasks: existing.tasks || [] });
    } else {
      out.push({ day: name, date, theme: "", tasks: [] });
    }
  }
  return out;
}

// ---------- Preview-and-edit modal ----------
function openPreviewModal(viewRoot, plan) {
  const s = getSettings();
  // Local editable copy — mutations happen here, Save commits
  const draft = JSON.parse(JSON.stringify(plan));

  const bodyHtml = `
    <style>
      .wp-head { margin-bottom: 20px; }
      .wp-title-in {
        font: 600 20px/1.2 var(--font-sans); letter-spacing: -.018em; color: var(--ink);
        width: 100%; border: none; outline: none; background: transparent; padding: 4px 0;
      }
      .wp-rationale {
        margin-top: 6px; width: 100%; border: none; outline: none; background: transparent;
        color: var(--mut); font: 400 13.5px/1.5 var(--font-sans); resize: none;
      }
      .wp-days { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      @media (max-width: 760px) { .wp-days { grid-template-columns: 1fr; } }
      .wp-day {
        border: 1px solid var(--line); border-radius: 14px;
        padding: 14px 16px; background: var(--paper);
        display: flex; flex-direction: column; gap: 10px;
      }
      .wp-day.weekend { background: var(--gold-soft); border-color: #f0e3b7; }
      .wp-day-head { display: flex; align-items: baseline; justify-content: space-between; }
      .wp-day-name { font: 600 14px/1 var(--font-sans); color: var(--ink); letter-spacing: -.012em; }
      .wp-day-date { font: 400 11.5px/1 var(--font-sans); color: var(--mut); margin-top: 3px; }
      .wp-day-theme {
        font: 500 11px/1 var(--font-sans); color: var(--mut);
        letter-spacing: .02em; text-align: right; max-width: 140px;
        background: transparent; border: none; outline: none;
      }
      .wp-tasks { display: flex; flex-direction: column; gap: 6px; }
      .wp-task {
        display: grid; grid-template-columns: 1fr 56px auto; gap: 6px; align-items: center;
        padding: 8px 10px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
      }
      .wp-task input {
        border: none; background: transparent; outline: none;
        font: 400 13px/1.3 var(--font-sans); color: var(--ink); min-width: 0;
      }
      .wp-task input[type="number"] { text-align: right; color: var(--mut); font-size: 12px; }
      .wp-task-del {
        background: transparent; border: none; cursor: pointer; color: var(--mut);
        font-size: 14px; width: 22px; height: 22px; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        transition: color .18s, background .18s;
      }
      .wp-task-del:hover { color: #fff; background: var(--red); }
      .wp-add-task {
        align-self: flex-start; background: transparent; border: 1px dashed var(--line2);
        color: var(--mut); cursor: pointer; border-radius: 999px;
        padding: 6px 12px; font: 500 12px/1 var(--font-sans);
        transition: border-color .18s, color .18s;
      }
      .wp-add-task:hover { color: var(--ink); border-color: var(--ink); }
      .wp-day-foot { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--mut); margin-top: auto; padding-top: 4px; border-top: 1px dashed var(--line); }
      .wp-day-foot b { color: var(--ink); font-weight: 600; font-feature-settings: "tnum"; }
    </style>
    <div class="wp-head">
      <input class="wp-title-in" id="wp-title" value="${esc(draft.title || "Weekly plan")}" placeholder="Week title" />
      <textarea class="wp-rationale" id="wp-rationale" rows="2" placeholder="One-line rationale (optional)">${esc(draft.rationale || "")}</textarea>
    </div>
    <div class="wp-days" id="wp-days">
      ${draft.days.map((d, i) => dayCardHtml(d, i)).join("")}
    </div>
  `;

  openFormModal({
    title: "Preview & edit your week",
    subtitle: `${draft.days.length} days · tweak freely, Save when ready`,
    bodyHtml,
    saveLabel: "Save plan",
    width: 820,
    onSave: async (modalRoot, close) => {
      // Read everything back out of inputs → draft
      draft.title = modalRoot.querySelector("#wp-title").value.trim() || "Weekly plan";
      draft.rationale = modalRoot.querySelector("#wp-rationale").value.trim();
      modalRoot.querySelectorAll("[data-day-idx]").forEach(dayEl => {
        const di = Number(dayEl.dataset.dayIdx);
        draft.days[di].theme = dayEl.querySelector(".wp-day-theme").value.trim();
        const tasks = [];
        dayEl.querySelectorAll(".wp-task").forEach((t, ti) => {
          const title = t.querySelector("[data-f=title]").value.trim();
          if (!title) return;
          tasks.push({
            ref: draft.days[di].tasks[ti]?.ref || `WK-${draft.days[di].date}#${ti + 1}`,
            title,
            minutes: Math.max(5, Number(t.querySelector("[data-f=minutes]").value) || 25),
            value: draft.days[di].tasks[ti]?.value ?? s.wallet.taskMin,
            kind: draft.days[di].tasks[ti]?.kind || "dsa",
            sheet: draft.days[di].tasks[ti]?.sheet || null,
            seq: draft.days[di].tasks[ti]?.seq ?? null
          });
        });
        draft.days[di].tasks = tasks;
      });

      // Check if any date already has user-ticked work — ask before overwriting
      const existing = getDayLog();
      const willOverwrite = draft.days.filter(d => existing[d.date]?.done?.length > 0).map(d => d.date);
      let overwrite = false;
      if (willOverwrite.length) {
        overwrite = await confirmDanger({
          title: `Overwrite ${willOverwrite.length} day${willOverwrite.length === 1 ? "" : "s"} with ticked work?`,
          message: `Dates ${willOverwrite.join(", ")} already have tasks you've ticked off. Saving the plan replaces them.`,
          confirmLabel: "Overwrite anyway",
          consequences: [`Your ticks on those dates are lost`, `Earnings already banked stay in the wallet`]
        });
        if (!overwrite) return;   // keep modal open
      }

      const result = await applyWeeklyPlan(draft, { overwrite });
      close();
      setStatus(viewRoot, `✓ Plan saved · ${result.applied} day${result.applied === 1 ? "" : "s"} applied${result.skipped ? ` · ${result.skipped} skipped (ticked)` : ""}`, "ok");
      renderPlan(viewRoot, draft);
    }
  });

  // Wire delete + add handlers (delegated on the days container)
  setTimeout(() => wireDayCardHandlers(draft), 60);
}

function dayCardHtml(d, i) {
  const isWeekend = /sat|sun/i.test(d.day || "");
  const tasks = d.tasks || [];
  const mins = tasks.reduce((a, t) => a + (Number(t.minutes) || 0), 0);
  const rs = tasks.reduce((a, t) => a + (Number(t.value) || 0), 0);
  return `
    <div class="wp-day ${isWeekend ? "weekend" : ""}" data-day-idx="${i}">
      <div class="wp-day-head">
        <div>
          <div class="wp-day-name">${esc(d.day)}</div>
          <div class="wp-day-date">${esc(d.date)}</div>
        </div>
        <input class="wp-day-theme" value="${esc(d.theme || "")}" placeholder="theme…" />
      </div>
      <div class="wp-tasks">
        ${tasks.map((t, ti) => taskRowHtml(t, ti)).join("")}
      </div>
      <button class="wp-add-task" data-add-task="${i}">+ Add task</button>
      <div class="wp-day-foot">
        <span><b class="wp-mins">${mins}</b> min</span>
        <span><b>₹${rs}</b></span>
      </div>
    </div>
  `;
}

function taskRowHtml(t, ti) {
  return `
    <div class="wp-task" data-task-idx="${ti}">
      <input type="text" data-f="title" value="${esc(t.title || "")}" placeholder="Problem name…" />
      <input type="number" data-f="minutes" value="${Number(t.minutes) || 25}" min="5" max="240" />
      <button class="wp-task-del" data-del-task aria-label="Delete">×</button>
    </div>
  `;
}

function wireDayCardHandlers(draft) {
  const container = document.querySelector("#wp-days");
  if (!container) return;
  container.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add-task]");
    const delBtn = e.target.closest("[data-del-task]");
    if (addBtn) {
      const di = Number(addBtn.dataset.addTask);
      const dayEl = container.querySelector(`[data-day-idx="${di}"]`);
      const tasksEl = dayEl.querySelector(".wp-tasks");
      const newIdx = tasksEl.querySelectorAll(".wp-task").length;
      tasksEl.insertAdjacentHTML("beforeend", taskRowHtml({ title: "", minutes: 25 }, newIdx));
      const inputs = tasksEl.querySelectorAll(".wp-task");
      inputs[inputs.length - 1].querySelector("[data-f=title]").focus();
      return;
    }
    if (delBtn) {
      delBtn.closest(".wp-task").remove();
    }
  });
}

function styles() {
  return `
  <style>
    .week { max-width: 1240px; }
    .week .eyebrow { font-size:11px; letter-spacing:.22em; font-weight:700; color:var(--mut); margin-bottom: 12px; }
    .week .w-title { font-size: 44px; font-weight: 800; letter-spacing: -.02em; margin: 0 0 8px; }
    .week .w-title .italic { font-family: Georgia, serif; font-style: italic; color: var(--gold); font-weight: 500; }
    .week .w-sub { color: var(--mut); font-size: 15px; margin: 0 0 var(--s-5); max-width: 600px; }

    .week .w-prompt-card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-left: 3px solid var(--gold);
      color: var(--ink);
      border-radius: var(--radius-lg); padding: var(--s-6);
      box-shadow: var(--shadow); margin-bottom: var(--s-6);
    }
    .week .w-presets { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: var(--s-4); }
    .week .chip {
      background: var(--bg); border: 1px solid var(--line2);
      color: var(--ink); border-radius: 999px;
      padding: 9px 14px; cursor: pointer;
      font: 600 12.5px/1 var(--font-sans); letter-spacing: .02em;
      transition: all var(--dur-fast) var(--ease);
    }
    .week .chip:hover { background: var(--gold-soft); border-color: var(--gold); color: var(--ink); transform: translateY(-1px); }
    .week .w-label { display: block; font: 700 10px/1 var(--font-sans); letter-spacing: .22em; color: var(--mut); margin-bottom: 8px; }
    .week textarea {
      width: 100%; background: var(--bg); color: var(--ink);
      border: 1px solid var(--line2); border-radius: 12px;
      padding: 14px 16px; font: 14px/1.5 var(--font-sans);
      outline: none; resize: vertical;
    }
    .week textarea:focus { border-color: var(--gold); background: var(--paper); box-shadow: 0 0 0 3px var(--gold-soft); }
    .week .w-controls { display: flex; align-items: center; gap: var(--s-3); margin-top: var(--s-3); }
    .week .btn-primary {
      background: var(--ink); color: #fff;
      border: none; border-radius: 12px; padding: 12px 22px;
      font: 700 13.5px/1 var(--font-sans); cursor: pointer;
      transition: transform .18s, background .18s;
    }
    .week .btn-primary:hover { transform: translateY(-1px); background: #22272f; }
    .week .w-status { color: var(--mut); font-size: 12px; }
    .week .w-status.ok  { color: var(--green); }
    .week .w-status.err { color: var(--red); }
    .week .w-status.wait { color: var(--gold); }

    .week .w-plan { margin-top: var(--s-5); }
    .week .w-empty {
      background: var(--paper); border: 1px dashed var(--line2); border-radius: var(--radius-lg);
      padding: var(--s-7) var(--s-5); text-align: center; color: var(--mut);
    }
    .week .w-empty-ic { font-size: 46px; margin-bottom: var(--s-3); }
    .week .w-empty h3 { color: var(--ink); font-size: 18px; margin: 0 0 6px; }
    .week .w-empty p { font-size: 13px; margin: 0; }

    .week .plan-head {
      display: flex; justify-content: space-between; gap: var(--s-5); align-items: flex-start;
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-lg);
      padding: var(--s-5) var(--s-6); margin-bottom: var(--s-4); box-shadow: var(--shadow);
    }
    .week .plan-eyebrow { font: 800 10px/1 var(--font-sans); letter-spacing: .22em; color: var(--gold); margin-bottom: 6px; }
    .week .plan-title { font-size: 24px; font-weight: 800; margin: 0 0 4px; letter-spacing: -.01em; }
    .week .plan-rationale { color: var(--mut); font-size: 13px; margin: 0; max-width: 560px; }
    .week .plan-stats { display: flex; gap: var(--s-3); }
    .week .ps { text-align: center; }
    .week .ps b { display: block; font-size: 22px; font-weight: 800; color: var(--ink); line-height: 1; }
    .week .ps span { font: 500 10px/1 var(--font-sans); letter-spacing: .14em; color: var(--mut); margin-top: 4px; display: block; }
    .week .ps.gold b { color: var(--gold); }

    .week .days-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--s-3); }
    .week .day {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
      padding: var(--s-4); display: flex; flex-direction: column; min-height: 220px;
      box-shadow: var(--shadow);
      transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
    }
    .week .day:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
    .week .day.weekend {
      background: linear-gradient(135deg, color-mix(in oklab, var(--gold) 12%, var(--paper)), var(--paper));
      border-color: color-mix(in oklab, var(--gold) 32%, var(--line));
    }
    .week .day.weekend .day-name,
    .week .day.weekend .day-date,
    .week .day.weekend .dot,
    .week .day.weekend .day-task .t,
    .week .day.weekend .day-task .m,
    .week .day.weekend .day-task-val,
    .week .day.weekend .day-foot,
    .week .day.weekend .day-task-meta { color: var(--ink); }
    .week .day.weekend .day-task { border-color: color-mix(in oklab, var(--gold) 24%, var(--line)); }
    .week .day-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--s-3); }
    .week .day-name { font: 800 13px/1 var(--font-sans); letter-spacing: .08em; color: var(--ink); }
    .week .day-date { font-size: 10px; color: var(--mut); margin-top: 4px; letter-spacing: .05em; }
    .week .day-theme { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; color: var(--gold); background: var(--gold-soft); padding: 4px 8px; border-radius: 6px; }

    .week .day-tasks { flex: 1; display: flex; flex-direction: column; gap: 8px; margin-bottom: var(--s-3); }
    .week .day-task {
      display: grid; grid-template-columns: 8px 1fr auto; gap: 8px;
      align-items: center; padding: 8px 0; border-top: 1px solid var(--line);
    }
    .week .day-task:first-child { border-top: none; padding-top: 0; }
    .week .dt-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--blue); }
    .week .dt-t { font-size: 13px; font-weight: 600; }
    .week .dt-m { font-size: 10.5px; color: var(--mut); margin-top: 2px; }
    .week .dt-v { font: 800 10px/1 var(--font-sans); color: var(--gold); background: var(--gold-soft); padding: 4px 8px; border-radius: 999px; }
    .week .day-rest { color: var(--mut); font-size: 12px; font-style: italic; padding: var(--s-3) 0; text-align: center; }
    .week .day-foot {
      display: flex; justify-content: space-between; padding-top: var(--s-2);
      border-top: 1px dashed var(--line); font-size: 11px; color: var(--mut); font-weight: 600;
    }
  </style>
  `;
}
