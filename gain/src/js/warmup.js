// Warm-up quiz — Groq-generated recall drill based on yesterday's solved
// problems (or pattern-of-the-week fallback if yesterday was a rest day).
// 5 Qs: 3 short-answer + 2 MCQ. Hint + Reveal answer via Groq.
//
// Entry: a special gradient card is injected as the first row of Today's plan
// whenever today's dayLog has a `WARMUP-${dateKey}` task AND it isn't yet done.
// Completing all 5 Qs marks that task done + credits ₹20.

import { getDayLog, getSettings, getWallet, getSheets, callGrok, secure, updateDayLog, updateWallet } from "./store.js";
import { todayKey, calendarKey, tickTask, setReviewOverride } from "./engine.js";
import { renderMarkdown } from "./info.js";
import { callGroqJSON } from "./groqJson.js";

const CACHE_PREFIX = "gain:warmup:";
const WARMUP_BOUNTY = 30;    // bumped from 20 — 8 Qs + confidence capture earns more
const QUIZ_COUNT = 8;

// -------- public: ensure a warm-up task exists on today's plan --------
// Called from ensureDailyPlan / Today boot. Adds a `WARMUP-${dateKey}` task
// to today's assigned list IF yesterday had at least one solve (or there's a
// pattern-of-the-week to drill). Idempotent — safe to call repeatedly.
export async function ensureWarmupTask(dateKey = todayKey()) {
  const dayLog = getDayLog();
  const day = dayLog[dateKey];
  if (!day || !Array.isArray(day.assigned)) return;
  const ref = `WARMUP-${dateKey}`;
  if (day.assigned.some(t => t.ref === ref)) return;  // already present

  // Decide source: yesterday's solves OR pattern-of-the-week
  const source = pickWarmupSource(dateKey);
  if (!source) return;  // nothing to warm up on

  // Title is just "Warm-up quiz" — source goes in the meta line, cleaner hierarchy.
  const task = {
    ref,
    kind: "warmup",
    title: `Warm-up quiz`,
    minutes: 5,
    value: WARMUP_BOUNTY,
    sheet: null,
    rowIndex: null,
    sourceKind: source.kind,          // "yesterday" | "pattern"
    sourceLabel: source.label,
    sourceProblems: source.problems,  // array of {title, pattern, difficulty}
    sourcePattern: source.pattern,    // for "pattern" fallback
  };
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    if (d.assigned.some(x => x.ref === ref)) return;  // double-check inside mutator
    d.assigned.unshift(task);  // first row of the plan
    d.values[ref] = WARMUP_BOUNTY;
  });
}

function pickWarmupSource(dateKey) {
  // Legacy "default" source — kept for the task.sourceLabel on today's plan.
  // The actual question-fetch now walks collectModeContext for the mode the
  // user picked in the modal (this-week / tomorrow).
  const dayLog = getDayLog();
  const dK = (() => {
    try {
      const d = new Date(dateKey + "T12:00:00");
      d.setDate(d.getDate() - 1);
      return calendarKey(d);
    } catch { return null; }
  })();

  if (dK) {
    const yesterday = dayLog[dK];
    if (yesterday && Array.isArray(yesterday.done) && yesterday.done.length) {
      const solved = yesterday.done
        .map(ref => yesterday.assigned.find(t => t.ref === ref))
        .filter(t => t && t.sheet && t.title && t.kind !== "warmup" && t.kind !== "revision" && t.kind !== "log");
      if (solved.length) {
        return {
          kind: "yesterday",
          label: `Yesterday's ${solved.length === 1 ? "problem" : "problems"}`,
          problems: solved.map(t => ({ title: t.title, pattern: t.pattern || "", difficulty: t.difficulty || "" })),
          pattern: null,
        };
      }
    }
  }

  const todayEntry = dayLog[dateKey];
  const theme = todayEntry?.weeklyPlan?.theme || todayEntry?.weeklyPlan?.title || null;
  if (theme) {
    return { kind: "pattern", label: theme, problems: [], pattern: theme };
  }
  return null;
}

// Collect the question-generation context for a chosen mode.
// Returns { title, problems: [{title, pattern, sheet, rowIndex, difficulty}], topicPool: [string] }
// where topicPool is the deduped list of distinct patterns/topics for the
// confidence-rating step after Q8.
function collectModeContext(mode, dateKey = todayKey()) {
  const dayLog = getDayLog();

  if (mode === "this-week") {
    const problems = [];
    const topicPool = new Set();
    // Walk back 7 days (not including today) — anything done.
    for (let i = 1; i <= 7; i++) {
      const d = new Date(dateKey + "T12:00:00");
      d.setDate(d.getDate() - i);
      const k = calendarKey(d);
      const entry = dayLog[k];
      if (!entry || !Array.isArray(entry.done) || !entry.done.length) continue;
      for (const ref of entry.done) {
        const t = entry.assigned.find(x => x.ref === ref);
        if (!t || !t.title || t.kind === "warmup" || t.kind === "log") continue;
        problems.push({
          title: t.title, pattern: t.pattern || "", difficulty: t.difficulty || "",
          sheet: t.sheet || null, rowIndex: t.rowIndex ?? null,
        });
        if (t.pattern) topicPool.add(t.pattern);
      }
    }
    return {
      title: "This week's patterns",
      problems: problems.slice(0, 15),  // keep prompt small
      topicPool: Array.from(topicPool).slice(0, 6),
    };
  }

  if (mode === "tomorrow") {
    // Walk forward through today's dayLog + tomorrow's planned entry.
    const problems = [];
    const topicPool = new Set();
    const tK = (() => {
      try {
        const d = new Date(dateKey + "T12:00:00");
        d.setDate(d.getDate() + 1);
        return calendarKey(d);
      } catch { return null; }
    })();
    const tEntry = tK ? dayLog[tK] : null;
    const assigned = Array.isArray(tEntry?.assigned) ? tEntry.assigned : [];
    for (const t of assigned) {
      if (!t.title || t.kind === "warmup" || t.kind === "log") continue;
      problems.push({
        title: t.title, pattern: t.pattern || "", difficulty: t.difficulty || "",
        sheet: t.sheet || null, rowIndex: t.rowIndex ?? null,
      });
      if (t.pattern) topicPool.add(t.pattern);
    }
    return {
      title: "Tomorrow's topics",
      problems: problems.slice(0, 10),
      topicPool: Array.from(topicPool).slice(0, 6),
    };
  }

  return { title: "", problems: [], topicPool: [] };
}

// How many non-empty problems in a given mode? Used to grey out the pick
// button when the source is empty (e.g. no tomorrow plan).
function modeHasContent(mode) {
  const ctx = collectModeContext(mode);
  return ctx.problems.length > 0;
}

// -------- quiz modal --------
export async function openWarmupQuiz({ root, taskRef }) {
  const dateKey = todayKey();
  const day = getDayLog()[dateKey];
  if (!day) return;
  const task = day.assigned.find(t => t.ref === taskRef);
  if (!task) return;

  document.querySelectorAll(".wu-scrim").forEach(m => m.remove());

  // Try to use a cached question set — Groq cost control + instant resume
  const cacheKey = CACHE_PREFIX + dateKey;
  let questions = null;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) questions = JSON.parse(cached);
  } catch (_) {}

  const scrim = document.createElement("div");
  scrim.className = "wu-scrim";
  scrim.innerHTML = scaffoldHtml();
  document.body.appendChild(scrim);
  document.body.style.overflow = "hidden";

  const close = () => {
    document.body.style.overflow = "";
    scrim.remove();
  };
  scrim.querySelector(".wu-close").addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });

  // ---- state ----
  const state = {
    idx: 0,
    mode: null,                              // "this-week" | "tomorrow", picked at intro
    topicPool: [],                           // populated after Groq returns
    answers: new Array(QUIZ_COUNT).fill(""),
    hints: new Array(QUIZ_COUNT).fill(null),
    reveals: new Array(QUIZ_COUNT).fill(null),
    completed: new Array(QUIZ_COUNT).fill(false),
  };

  const paintEverything = () => {
    paintQuestion(scrim, state, questions, close, async () => {
      // All questions done — show confidence capture BEFORE crediting bounty.
      // Confidence stars become the auto-boost REDO signal.
      paintConfidenceCapture(scrim, state, async () => {
        await finalizeQuiz(dateKey, taskRef);
        scrim.querySelector(".wu-done-overlay").classList.add("show");
        setTimeout(() => { close(); if (root && typeof root.querySelector === "function") refreshToday(root); }, 1800);
      });
    });
  };

  const loadQuestionsForMode = async (mode) => {
    state.mode = mode;
    const ctx = collectModeContext(mode);
    scrim.querySelector("#wu-skel").hidden = false;
    scrim.querySelector("#wu-stage").hidden = true;
    try {
      const payload = await fetchQuestions({ mode, ctx });
      if (payload?.questions?.length === QUIZ_COUNT) {
        questions = payload.questions;
        state.topicPool = payload.topicPool || ctx.topicPool || [];
        try { localStorage.setItem(cacheKey + ":" + mode, JSON.stringify({ questions, topicPool: state.topicPool })); } catch (_) {}
        paintEverything();
      } else {
        showQuizError(scrim, "Couldn't generate questions. Try again or switch mode.");
      }
    } catch (e) {
      showQuizError(scrim, String(e.message || e));
    }
  };

  // Load any mode-specific cache we have from today
  const tryLoadCached = (mode) => {
    try {
      const raw = localStorage.getItem(cacheKey + ":" + mode);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.questions?.length === QUIZ_COUNT) return parsed;
      }
    } catch (_) {}
    return null;
  };

  showModePicker(scrim, task, async (mode) => {
    const cached = tryLoadCached(mode);
    if (cached) {
      questions = cached.questions;
      state.mode = mode;
      state.topicPool = cached.topicPool || [];
      paintEverything();
    } else {
      await loadQuestionsForMode(mode);
    }
  });
}

// --- Mode picker — "this week's patterns" vs "tomorrow's topics" ---
function showModePicker(scrim, task, onPick) {
  scrim.querySelector("#wu-skel").hidden = true;
  const stage = scrim.querySelector("#wu-stage");
  stage.hidden = false;
  const thisWeek = collectModeContext("this-week");
  const tomorrow = collectModeContext("tomorrow");
  const twCount = thisWeek.problems.length;
  const tmCount = tomorrow.problems.length;

  stage.innerHTML = `
    <div class="wu-intro">
      <div class="wu-intro-ico">⚡</div>
      <div class="wu-intro-title">Pick a warm-up mode</div>
      <div class="wu-intro-sub">${QUIZ_COUNT} questions · reality check at the end · ₹${WARMUP_BOUNTY} on completion</div>
      <div class="wu-mode-grid">
        <button class="wu-mode-card" data-mode="this-week" ${twCount === 0 ? "disabled" : ""}>
          <div class="wu-mode-ico">↻</div>
          <div class="wu-mode-title">This week's patterns</div>
          <div class="wu-mode-sub">Reinforce what you've seen</div>
          <div class="wu-mode-meta">${twCount ? `${twCount} problem${twCount === 1 ? "" : "s"} · ${thisWeek.topicPool.length} topic${thisWeek.topicPool.length === 1 ? "" : "s"}` : "No activity this week"}</div>
        </button>
        <button class="wu-mode-card" data-mode="tomorrow" ${tmCount === 0 ? "disabled" : ""}>
          <div class="wu-mode-ico">→</div>
          <div class="wu-mode-title">Tomorrow's topics</div>
          <div class="wu-mode-sub">Prime what's coming next</div>
          <div class="wu-mode-meta">${tmCount ? `${tmCount} task${tmCount === 1 ? "" : "s"} planned · ${tomorrow.topicPool.length} topic${tomorrow.topicPool.length === 1 ? "" : "s"}` : "Nothing planned for tomorrow"}</div>
        </button>
      </div>
      <div class="wu-intro-note">1 Groq call per mode. Questions cached per mode for today — switching is free the second time.</div>
    </div>
  `;
  const foot = scrim.querySelector("#wu-foot");
  if (foot) foot.hidden = true;
  stage.querySelectorAll(".wu-mode-card").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      stage.querySelectorAll(".wu-mode-card").forEach(b => b.disabled = true);
      btn.classList.add("picking");
      await onPick(btn.dataset.mode);
    });
  });
}

// Pre-fetch gate — modal shows the source + a single "Generate" button.
// Groq fires only when the user clicks it. Esc to close.
function showIntroGate(scrim, task, onGenerate) {
  scrim.querySelector("#wu-skel").hidden = true;
  const stage = scrim.querySelector("#wu-stage");
  stage.hidden = false;
  stage.innerHTML = `
    <div class="wu-intro">
      <div class="wu-intro-ico">⚡</div>
      <div class="wu-intro-title">Warm-up on ${esc(task.sourceLabel || "yesterday's work")}</div>
      <div class="wu-intro-sub">5 questions · 3 short-answer + 2 MCQ · ~5 min · ₹${esc(String(task.value || 20))} on completion</div>
      ${task.sourceProblems?.length ? `
        <div class="wu-intro-list">
          ${task.sourceProblems.slice(0, 6).map(p => `
            <div class="wu-intro-item">
              <span class="wu-intro-dot">•</span>
              <span>${esc(p.title)}${p.pattern ? ` <small>[${esc(p.pattern)}]</small>` : ""}</span>
            </div>
          `).join("")}
        </div>` : task.sourcePattern ? `
        <div class="wu-intro-list">
          <div class="wu-intro-item">
            <span class="wu-intro-dot">•</span>
            <span>This week's theme: <b>${esc(task.sourcePattern)}</b></span>
          </div>
        </div>` : ""}
      <button class="wu-btn primary wu-intro-cta" id="wu-generate">✦ Generate quiz</button>
      <div class="wu-intro-note">1 Groq call. Questions cached for today — reopening is free.</div>
    </div>
  `;
  // Hide footer during intro (no Qs yet)
  const foot = scrim.querySelector("#wu-foot");
  if (foot) foot.hidden = true;
  stage.querySelector("#wu-generate")?.addEventListener("click", async () => {
    const btn = stage.querySelector("#wu-generate");
    btn.disabled = true; btn.textContent = "Asking Groq…";
    try { await onGenerate(); }
    catch (e) { btn.disabled = false; btn.textContent = "✦ Generate quiz"; }
  });
}

async function finalizeQuiz(dateKey, taskRef) {
  const day = getDayLog()[dateKey];
  if (!day) return;
  const task = day.assigned.find(t => t.ref === taskRef);
  if (!task) return;
  if (day.done.includes(taskRef)) return;
  await tickTask(dateKey, taskRef);
  await updateWallet(w => {
    w.earned += task.value;
    w.ledger.push({ date: new Date().toISOString(), type: "task", amount: task.value, label: task.title });
  });
}

// --- Confidence capture — after Q8, user rates each topic 1-5. Topics ≤ 2
// auto-boost a REDO for tomorrow (pushes matching sheet rows into the
// spaced-rep queue regardless of their last ★ rating).
function paintConfidenceCapture(scrim, state, onDone) {
  const stage = scrim.querySelector("#wu-stage");
  const foot = scrim.querySelector("#wu-foot");
  if (foot) foot.hidden = true;
  const topics = Array.isArray(state.topicPool) && state.topicPool.length
    ? state.topicPool
    : Array.from(new Set((state.answers || []).map((_, i) => "general"))).slice(0, 3);

  // Groq-free best guess: topics tied to questions the user left blank/wrong
  // start at 2 stars; topics with filled answers start at 3. User overrides.
  const guessed = new Map();
  topics.forEach(t => guessed.set(t, 3));

  stage.hidden = false;
  stage.innerHTML = `
    <div class="wu-confidence">
      <div class="wu-conf-ico">🎯</div>
      <div class="wu-conf-title">Reality check</div>
      <div class="wu-conf-sub">Rate how confident you feel on each topic right now. Topics you rate <b>★ ≤ 2</b> get auto-queued as REDOs for tomorrow.</div>
      <div class="wu-conf-list">
        ${topics.map(t => `
          <div class="wu-conf-row" data-topic="${esc(t)}">
            <div class="wu-conf-topic">${esc(t)}</div>
            <div class="wu-conf-stars" role="radiogroup" aria-label="Confidence for ${esc(t)}">
              ${[1,2,3,4,5].map(n => `<button class="wu-conf-star" data-score="${n}" aria-label="${n} star${n===1?"":"s"}">★</button>`).join("")}
            </div>
          </div>
        `).join("")}
      </div>
      <div class="wu-conf-footer">
        <button class="wu-btn primary" id="wu-conf-submit" disabled>Finish — earn ₹${WARMUP_BOUNTY}</button>
      </div>
    </div>
  `;

  const scores = new Map();  // topic → N
  const refreshBtn = () => {
    const btn = stage.querySelector("#wu-conf-submit");
    btn.disabled = scores.size < topics.length;
    btn.textContent = scores.size < topics.length
      ? `Rate all ${topics.length} topics (${scores.size}/${topics.length})`
      : `Finish — earn ₹${WARMUP_BOUNTY}`;
  };

  stage.querySelectorAll(".wu-conf-row").forEach(row => {
    const topic = row.dataset.topic;
    row.querySelectorAll(".wu-conf-star").forEach(btn => {
      btn.addEventListener("click", () => {
        const n = +btn.dataset.score;
        scores.set(topic, n);
        row.querySelectorAll(".wu-conf-star").forEach(b => {
          b.classList.toggle("filled", +b.dataset.score <= n);
        });
        refreshBtn();
      });
    });
  });
  refreshBtn();

  stage.querySelector("#wu-conf-submit").addEventListener("click", async () => {
    const topicConfidence = {};
    scores.forEach((n, t) => { topicConfidence[t] = n; });
    const dateKey = todayKey();
    await updateDayLog(dl => {
      const d = dl[dateKey];
      if (!d) return;
      d.topicConfidence = { ...(d.topicConfidence || {}), ...topicConfidence };
    });
    // Auto-boost ≤2★ topics as tomorrow's REDO
    const weak = [...scores.entries()].filter(([_, n]) => n <= 2).map(([t]) => t);
    if (weak.length) {
      await boostWeakTopicsAsRedo(weak);
    }
    await onDone();
  });
}

// Walk all past dayLog solves; for any whose task.pattern matches a weak topic,
// mark reviewOverride="tomorrow" so getDueRevisits forces it into tomorrow's queue.
async function boostWeakTopicsAsRedo(weakTopics) {
  const dayLog = getDayLog();
  const lower = new Set(weakTopics.map(t => String(t).toLowerCase()));
  const dates = Object.keys(dayLog).sort().reverse();
  const seen = new Set();  // sheet#rowIndex — only the most-recent solve per row
  for (const d of dates) {
    const entry = dayLog[d];
    if (!entry || !Array.isArray(entry.done)) continue;
    for (const ref of entry.done) {
      const t = entry.assigned?.find(x => x.ref === ref);
      if (!t || !t.sheet || t.rowIndex == null) continue;
      const key = `${t.sheet}#${t.rowIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!t.pattern) continue;
      if (!lower.has(String(t.pattern).toLowerCase())) continue;
      // Force into tomorrow's queue via explicit review override.
      await setReviewOverride(d, ref, "tomorrow");
    }
  }
}

function refreshToday(root) {
  // Soft hint — if the Today page is mounted, trigger a re-paint by dispatching
  // a store event. The today module listens on dayLog/wallet changes already.
}

// -------- Groq fetch — bulletproof pipeline, 8 Qs, mode-aware --------
async function fetchQuestions({ mode, ctx }) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key. Add one in Settings → AI butler.");

  const modeNote = mode === "tomorrow"
    ? "The user has NOT yet solved these — this warm-up PRIMES them before tomorrow's session."
    : "The user solved these over the last 7 days — this warm-up REINFORCES recall.";

  const problemsText = ctx.problems.length
    ? ctx.problems.map((p, i) => `${i + 1}. ${p.title}${p.pattern ? ` [${p.pattern}]` : ""}${p.difficulty ? ` (${p.difficulty})` : ""}`).join("\n")
    : "(no specific problems in context — generate generic FDE warm-ups)";
  const topicsText = ctx.topicPool.length ? ctx.topicPool.join(", ") : "mixed";

  const system = `You are a GAIN FDE interview-prep warm-up coach.
Generate EXACTLY ${QUIZ_COUNT} questions as strict JSON.

Schema:
{
  "questions": [
    { "type": "short" | "mcq", "prompt": "...", "options": ["A","B","C","D"] (ONLY if mcq), "answer_key": "letter A/B/C/D for mcq, OR 1-2 sentence model answer for short", "topic": "the specific pattern/topic this probes" }
  ],
  "topicPool": ["3-6 distinct patterns/topics covered across the questions"]
}

Rules:
- EXACTLY ${QUIZ_COUNT} questions. 3 "short" and ${QUIZ_COUNT - 3} "mcq".
- Each question references a SPECIFIC problem/pattern from the context.
- "topic" on each question is the exact pattern name — used for confidence rating later.
- "topicPool" is the deduped set of patterns across all 8 questions, 3-6 items.
- Short answers must be answerable in 1-2 sentences.
- MCQ options exactly 4; "answer_key" is JUST the letter ("A"/"B"/"C"/"D").
- Mix: complexity analysis, pattern recognition, edge cases, trade-offs, one classic LeetCode probe.
- Interview tone, keyword-dense, no fluff.
- NEVER give the full solution — probe recall, not require it.
- ${modeNote}`;

  const user = `Mode: ${mode} — ${ctx.title}
Topic pool: ${topicsText}

Problems in scope:
${problemsText}

Generate the ${QUIZ_COUNT}-question warm-up as JSON.`;

  const res = await callGroqJSON({
    apiKey, system, user, maxTokens: 3072, label: "warmup",
    schemaCheck: (obj) => {
      if (!obj || !Array.isArray(obj.questions)) return "no questions array";
      if (obj.questions.length !== QUIZ_COUNT) return `expected ${QUIZ_COUNT} questions, got ${obj.questions.length}`;
      for (let i = 0; i < QUIZ_COUNT; i++) {
        const q = obj.questions[i];
        if (!q?.prompt) return `q${i+1} missing prompt`;
        if (q.type !== "short" && q.type !== "mcq") return `q${i+1} bad type`;
        if (q.type === "mcq") {
          if (!Array.isArray(q.options) || q.options.length !== 4) return `q${i+1} needs 4 options`;
          if (!/^[A-D]$/i.test(String(q.answer_key || ""))) return `q${i+1} bad answer letter`;
        } else {
          if (!q.answer_key) return `q${i+1} missing answer_key`;
        }
      }
      return true;
    },
  });
  if (!res.ok) throw new Error(res.error);

  // Fill in default topics if Groq skipped them
  const questions = res.data.questions.map((q, i) => ({
    ...q,
    topic: String(q.topic || ctx.topicPool[i % Math.max(1, ctx.topicPool.length)] || "general").trim(),
  }));
  const topicPool = Array.isArray(res.data.topicPool) && res.data.topicPool.length
    ? res.data.topicPool.map(String).map(s => s.trim()).filter(Boolean).slice(0, 6)
    : Array.from(new Set(questions.map(q => q.topic))).slice(0, 6);
  return { questions, topicPool };
}

// -------- rendering --------
function scaffoldHtml() {
  return `
    <div class="wu-modal" role="dialog" aria-label="Warm-up quiz">
      <header class="wu-head">
        <div>
          <div class="wu-eyebrow">⚡ WARM-UP QUIZ · ${QUIZ_COUNT} QUESTIONS</div>
          <h2 id="wu-prog-dots" class="wu-prog">
            ${Array(QUIZ_COUNT).fill('<span class="d"></span>').join("")}
          </h2>
        </div>
        <button class="wu-close" aria-label="Close">✕</button>
      </header>

      <div class="wu-body">
        <div class="wu-skel" id="wu-skel">
          <div class="skel-line"></div>
          <div class="skel-line"></div>
          <div class="skel-line short"></div>
          <div style="height:14px"></div>
          <div class="skel-line"></div>
          <div class="skel-line short"></div>
        </div>
        <div class="wu-stage" id="wu-stage" hidden></div>
      </div>

      <footer class="wu-foot" hidden id="wu-foot">
        <button class="wu-btn ghost" id="wu-hint">✦ Hint</button>
        <button class="wu-btn ghost" id="wu-reveal">Reveal answer</button>
        <div style="flex:1"></div>
        <button class="wu-btn ghost" id="wu-skip">Skip</button>
        <button class="wu-btn primary" id="wu-next">Next →</button>
      </footer>

      <div class="wu-done-overlay">
        <div class="wu-done-card">
          <div class="wu-done-ico">✦</div>
          <h3>Warm-up complete</h3>
          <p>+ ₹${WARMUP_BOUNTY} banked · brain primed. Go hit the real problems.</p>
        </div>
      </div>
    </div>
  `;
}

function paintQuestion(scrim, state, questions, close, onFinish) {
  const q = questions[state.idx];
  if (!q) { onFinish(); return; }

  // Hide skel, show stage + foot
  scrim.querySelector("#wu-skel").hidden = true;
  scrim.querySelector("#wu-stage").hidden = false;
  scrim.querySelector("#wu-foot").hidden = false;

  // Progress dots
  const dots = scrim.querySelectorAll("#wu-prog-dots .d");
  dots.forEach((d, i) => {
    d.classList.toggle("current", i === state.idx);
    d.classList.toggle("done", i < state.idx || state.completed[i]);
  });

  const stage = scrim.querySelector("#wu-stage");
  stage.innerHTML = renderQuestion(q, state.idx, state.answers[state.idx]);

  // Wire input
  const input = stage.querySelector(".wu-input");
  if (input) {
    input.addEventListener("input", () => { state.answers[state.idx] = input.value; });
    setTimeout(() => input.focus(), 60);
  }
  // MCQ click
  stage.querySelectorAll(".wu-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      stage.querySelectorAll(".wu-opt").forEach(b => b.classList.remove("picked"));
      btn.classList.add("picked");
      state.answers[state.idx] = btn.dataset.letter;
    });
  });

  // Attach handlers
  const hintBtn = scrim.querySelector("#wu-hint");
  const revealBtn = scrim.querySelector("#wu-reveal");
  const skipBtn = scrim.querySelector("#wu-skip");
  const nextBtn = scrim.querySelector("#wu-next");

  // Reset button handlers each paint
  hintBtn.replaceWith(hintBtn.cloneNode(true));
  revealBtn.replaceWith(revealBtn.cloneNode(true));
  skipBtn.replaceWith(skipBtn.cloneNode(true));
  nextBtn.replaceWith(nextBtn.cloneNode(true));

  const h2 = scrim.querySelector("#wu-hint");
  const r2 = scrim.querySelector("#wu-reveal");
  const s2 = scrim.querySelector("#wu-skip");
  const n2 = scrim.querySelector("#wu-next");

  // Show cached hint/reveal if we have it
  if (state.hints[state.idx]) renderHint(stage, state.hints[state.idx]);
  if (state.reveals[state.idx]) renderReveal(stage, state.reveals[state.idx], q);

  h2.addEventListener("click", async () => {
    if (state.hints[state.idx]) return;
    h2.disabled = true; h2.textContent = "Thinking…";
    const text = await askGroqForHint(q);
    state.hints[state.idx] = text;
    renderHint(stage, text);
    h2.textContent = "✦ Hint"; h2.disabled = false; h2.classList.add("used");
  });
  r2.addEventListener("click", async () => {
    if (state.reveals[state.idx]) return;
    r2.disabled = true; r2.textContent = "Thinking…";
    const text = await askGroqForAnswer(q);
    state.reveals[state.idx] = text;
    renderReveal(stage, text, q);
    r2.textContent = "Reveal answer"; r2.disabled = false; r2.classList.add("used");
    state.completed[state.idx] = true;
  });
  s2.addEventListener("click", () => advance());
  n2.addEventListener("click", () => advance());

  function advance() {
    if (state.answers[state.idx] || state.reveals[state.idx]) state.completed[state.idx] = true;
    state.idx++;
    if (state.idx >= questions.length) { onFinish(); return; }
    paintQuestion(scrim, state, questions, close, onFinish);
  }
}

function renderQuestion(q, idx, savedAnswer) {
  const isMCQ = q.type === "mcq" && Array.isArray(q.options);
  return `
    <div class="wu-qlabel">Q${idx + 1} of 5 · <span class="wu-qtype">${isMCQ ? "Multiple choice" : "Short answer"}</span></div>
    <div class="wu-prompt">${esc(q.prompt || "")}</div>
    ${isMCQ ? `
      <div class="wu-opts">
        ${q.options.slice(0, 4).map((opt, i) => {
          const letter = String.fromCharCode(65 + i);
          const picked = savedAnswer === letter;
          return `<button class="wu-opt ${picked ? "picked" : ""}" data-letter="${letter}">
            <span class="wu-letter">${letter}</span>
            <span class="wu-opt-text">${esc(opt)}</span>
          </button>`;
        }).join("")}
      </div>
    ` : `
      <textarea class="wu-input" rows="3" placeholder="Type your 1-2 sentence answer…">${esc(savedAnswer || "")}</textarea>
    `}
    <div class="wu-hint-slot"></div>
    <div class="wu-reveal-slot"></div>
  `;
}

function renderHint(stage, text) {
  const slot = stage.querySelector(".wu-hint-slot");
  if (slot) slot.innerHTML = `<div class="wu-hint-box"><b>✦ Hint</b> ${mdInline(text)}</div>`;
}
function renderReveal(stage, text, q) {
  const slot = stage.querySelector(".wu-reveal-slot");
  if (slot) {
    const key = q.answer_key ? `<div class="wu-key"><b>Key:</b> ${mdInline(q.answer_key)}</div>` : "";
    slot.innerHTML = `<div class="wu-reveal-box"><b>Interview answer</b> ${mdInline(text)} ${key}</div>`;
  }
}

const mdInline = (text) => renderMarkdown(text || "");

async function askGroqForHint(q) {
  try {
    const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                   (await secure.get("grok_api_key").catch(() => null));
    if (!apiKey) return "Add a Groq API key in Settings → AI butler to get hints.";
    const res = await callGrok({
      apiKey,
      system: `You are a GAIN interview-prep tutor. Give ONE short observation that nudges the user toward the answer — NEVER the answer itself. Max 1 sentence. Keyword-dense, interview-tone.`,
      user: `Question: ${q.prompt}\nOne-sentence hint, no spoilers:`
    });
    return res.ok ? res.content.trim() : "Couldn't fetch hint.";
  } catch (_) { return "Couldn't fetch hint."; }
}

async function askGroqForAnswer(q) {
  try {
    const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                   (await secure.get("grok_api_key").catch(() => null));
    if (!apiKey) return "Add a Groq API key in Settings → AI butler.";
    const res = await callGrok({
      apiKey,
      system: `You are a GAIN interview-prep tutor. Give the correct answer in 2-3 sentences, keyword-dense, interview-tone (name specific data structures, complexity, trade-offs). NO textbook lectures. NO markdown.`,
      user: `Question: ${q.prompt}\nAnswer:`
    });
    return res.ok ? res.content.trim() : "Couldn't fetch answer.";
  } catch (_) { return "Couldn't fetch answer."; }
}

function showQuizError(scrim, msg) {
  const skel = scrim.querySelector("#wu-skel");
  const stage = scrim.querySelector("#wu-stage");
  if (skel) skel.hidden = true;
  if (stage) {
    stage.hidden = false;
    stage.innerHTML = `<div class="wu-err">${esc(msg)}</div>`;
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }
  )[c]);
}

// -------- styles (injected once) --------
function injectStyles() {
  if (document.getElementById("warmup-styles")) return;
  const style = document.createElement("style");
  style.id = "warmup-styles";
  style.textContent = `
    .wu-scrim {
      position: fixed; inset: 0; z-index: 1300;
      background: rgba(8,10,14,.72);
      backdrop-filter: blur(12px) saturate(150%);
      -webkit-backdrop-filter: blur(12px) saturate(150%);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: wuFade 220ms ease both;
    }
    @keyframes wuFade { from { opacity: 0; } to { opacity: 1; } }
    .wu-modal {
      position: relative;
      width: 100%; max-width: 640px; max-height: 92vh;
      background: var(--paper); border-radius: 20px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 32px 80px rgba(0,0,0,.45), 0 0 0 1px var(--line);
      animation: wuPop 240ms cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes wuPop {
      from { opacity: 0; transform: translateY(16px) scale(.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .wu-head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 18px 22px 14px; border-bottom: 1px solid var(--line);
    }
    .wu-eyebrow {
      font-size: 10.5px; letter-spacing: .14em; font-weight: 700;
      color: var(--gold); text-transform: uppercase; margin-bottom: 6px;
    }
    .wu-prog { display: flex; align-items: center; gap: 6px; margin: 0; }
    .wu-prog .d {
      width: 24px; height: 6px; border-radius: 999px;
      background: var(--line);
      transition: all .18s;
    }
    .wu-prog .d.done { background: var(--green); }
    .wu-prog .d.current { background: var(--gold); width: 36px; }
    .wu-close {
      border: none; background: transparent; cursor: pointer;
      color: var(--mut); width: 32px; height: 32px; border-radius: 8px;
      font: 400 18px/1 var(--font-sans);
      display: inline-flex; align-items: center; justify-content: center;
      transition: all .18s;
    }
    .wu-close:hover { background: var(--bg); color: var(--ink); }

    .wu-body { padding: 20px 22px; overflow-y: auto; flex: 1; min-height: 300px; }

    .wu-qlabel {
      font-size: 11px; font-weight: 700; letter-spacing: .08em;
      text-transform: uppercase; color: var(--mut); margin-bottom: 8px;
    }
    .wu-qtype { color: var(--ink); font-weight: 600; }
    .wu-prompt {
      font-size: 17px; line-height: 1.5; color: var(--ink);
      margin-bottom: 18px; font-weight: 600; letter-spacing: -.01em;
    }
    .wu-input {
      width: 100%; box-sizing: border-box;
      padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--bg); color: var(--ink);
      font: 14px/1.5 var(--font-sans); resize: vertical; outline: none;
      transition: all .18s;
    }
    .wu-input:focus { border-color: var(--gold); background: var(--paper); box-shadow: 0 0 0 3px color-mix(in oklab, var(--gold) 20%, transparent); }

    .wu-opts { display: flex; flex-direction: column; gap: 8px; }
    .wu-opt {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px; width: 100%;
      background: var(--bg); border: 1px solid var(--line);
      border-radius: 10px; cursor: pointer; text-align: left;
      font: inherit; color: var(--ink);
      transition: all .18s;
    }
    .wu-opt:hover { border-color: var(--gold); background: var(--gold-soft); }
    .wu-opt.picked { border-color: var(--gold); background: var(--gold-soft); box-shadow: inset 0 0 0 1px var(--gold); }
    .wu-opt .wu-letter {
      width: 24px; height: 24px; flex-shrink: 0;
      border-radius: 50%; background: var(--line); color: var(--ink);
      display: inline-flex; align-items: center; justify-content: center;
      font: 700 11px/1 var(--font-sans);
    }
    .wu-opt.picked .wu-letter { background: var(--gold); color: #111; }

    .wu-hint-box, .wu-reveal-box {
      margin-top: 14px; padding: 12px 14px;
      border-radius: 8px; font-size: 13.5px; line-height: 1.55; color: var(--ink);
      animation: wuSlide 180ms ease both;
    }
    @keyframes wuSlide { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .wu-hint-box { background: color-mix(in oklab, var(--blue) 10%, transparent); border-left: 3px solid var(--blue); }
    .wu-reveal-box { background: var(--gold-soft); border-left: 3px solid var(--gold); }
    .wu-hint-box b, .wu-reveal-box b { font-weight: 700; margin-right: 6px; }
    .wu-key { margin-top: 8px; padding-top: 8px; border-top: 1px dashed color-mix(in oklab, var(--gold) 30%, transparent); font-size: 12.5px; color: var(--ink); }

    .wu-foot {
      display: flex; align-items: center; gap: 8px;
      padding: 14px 22px;
      background: var(--bg); border-top: 1px solid var(--line);
    }
    .wu-btn {
      padding: 9px 16px; border-radius: 10px; cursor: pointer;
      font: 600 12.5px/1 var(--font-sans);
      border: 1px solid var(--line);
      transition: all .18s;
    }
    .wu-btn.ghost { background: var(--paper); color: var(--mut); }
    .wu-btn.ghost:hover { color: var(--ink); border-color: var(--line2); }
    .wu-btn.ghost.used { color: color-mix(in oklab, var(--mut) 60%, transparent); }
    .wu-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .wu-btn.primary:hover { transform: translateY(-1px); filter: brightness(1.08); }

    .wu-skel { padding: 20px 0; }
    .wu-skel .skel-line {
      height: 10px; border-radius: 6px; margin-bottom: 10px;
      background: linear-gradient(90deg, var(--line) 0%, color-mix(in oklab, var(--line) 50%, var(--paper)) 50%, var(--line) 100%);
      background-size: 200% 100%;
      animation: wuShimmer 1200ms ease-in-out infinite;
    }
    .wu-skel .skel-line.short { width: 70%; }
    @keyframes wuShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

    .wu-err {
      padding: 20px; background: color-mix(in oklab, var(--red) 10%, transparent);
      color: var(--red); border-radius: 10px; font-size: 13.5px;
    }

    /* Pre-fetch gate — asks the user before firing Groq */
    .wu-intro {
      padding: 20px 4px;
      text-align: center;
      animation: wuSlide 220ms cubic-bezier(.2,1.2,.3,1) both;
    }
    .wu-intro-ico {
      font-size: 48px; line-height: 1;
      background: linear-gradient(135deg, var(--gold-soft), color-mix(in oklab, var(--blue) 25%, transparent));
      color: var(--gold);
      width: 72px; height: 72px; border-radius: 20px;
      display: inline-flex; align-items: center; justify-content: center;
      margin-bottom: 16px;
    }
    .wu-intro-title {
      font-size: 20px; font-weight: 700; color: var(--ink);
      letter-spacing: -.01em; margin-bottom: 6px;
    }
    .wu-intro-sub { font-size: 13px; color: var(--mut); margin-bottom: 18px; }
    .wu-intro-list {
      text-align: left; max-width: 420px; margin: 0 auto 20px;
      padding: 14px 16px;
      background: var(--bg); border: 1px solid var(--line);
      border-radius: 10px;
    }
    .wu-intro-item {
      display: flex; align-items: baseline; gap: 10px;
      font-size: 13px; color: var(--ink); line-height: 1.5;
      padding: 4px 0;
    }
    .wu-intro-item small { color: var(--mut); font-size: 11.5px; }
    .wu-intro-dot { color: var(--gold); font-size: 16px; line-height: 1; }
    .wu-intro-cta {
      padding: 12px 28px; font-size: 14px;
    }
    .wu-intro-cta:disabled {
      opacity: .7; cursor: wait; transform: none; filter: none;
    }
    .wu-intro-note { margin-top: 12px; font-size: 11px; color: var(--mut); }

    .wu-done-overlay {
      position: absolute; inset: 0;
      background: var(--paper);
      display: flex; align-items: center; justify-content: center;
      opacity: 0; pointer-events: none;
      transition: opacity .35s ease;
    }
    .wu-done-overlay.show { opacity: 1; pointer-events: auto; }
    .wu-done-card { text-align: center; animation: wuDonePop 500ms cubic-bezier(.2,1.4,.3,1) both; }
    @keyframes wuDonePop {
      from { opacity: 0; transform: scale(.9); }
      to   { opacity: 1; transform: scale(1); }
    }
    .wu-done-ico { font-size: 56px; color: var(--gold); line-height: 1; margin-bottom: 10px; }
    .wu-done-card h3 { margin: 0 0 6px; font-size: 20px; color: var(--ink); }
    .wu-done-card p { margin: 0; color: var(--mut); font-size: 13.5px; }

    /* --- Mode picker --- */
    .wu-mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 18px 0; }
    .wu-mode-card {
      display: flex; flex-direction: column; gap: 6px; align-items: flex-start;
      padding: 18px 20px; text-align: left;
      background: var(--paper); border: 1.5px solid var(--line); border-radius: 12px;
      cursor: pointer; transition: all .18s;
      font-family: inherit; color: var(--ink);
    }
    .wu-mode-card:not(:disabled):hover { border-color: var(--gold); transform: translateY(-2px); box-shadow: 0 10px 22px rgba(0,0,0,.08); }
    .wu-mode-card.picking { border-color: var(--gold); opacity: .7; }
    .wu-mode-card:disabled { opacity: .45; cursor: not-allowed; }
    .wu-mode-ico { font-size: 26px; line-height: 1; color: var(--gold); margin-bottom: 2px; }
    .wu-mode-title { font: 700 15px/1.2 var(--font-sans); color: var(--ink); }
    .wu-mode-sub { font: 500 12.5px/1.4 var(--font-sans); color: var(--mut); }
    .wu-mode-meta { font: 500 11px/1 var(--font-sans); color: var(--mut); margin-top: 6px; letter-spacing: .02em; }
    @media (max-width: 560px) { .wu-mode-grid { grid-template-columns: 1fr; } }

    /* --- Confidence capture --- */
    .wu-confidence { text-align: center; padding: 10px 6px; }
    .wu-conf-ico { font-size: 38px; margin-bottom: 10px; }
    .wu-conf-title { font: 700 20px/1.2 var(--font-sans); color: var(--ink); margin-bottom: 6px; letter-spacing: -.01em; }
    .wu-conf-sub { font: 400 13px/1.5 var(--font-sans); color: var(--mut); max-width: 460px; margin: 0 auto 20px; }
    .wu-conf-sub b { color: var(--ink); font-weight: 700; }
    .wu-conf-list { display: flex; flex-direction: column; gap: 8px; max-width: 520px; margin: 0 auto 18px; text-align: left; }
    .wu-conf-row {
      display: flex; justify-content: space-between; align-items: center; gap: 16px;
      padding: 12px 16px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 10px;
    }
    .wu-conf-topic { font: 600 14px/1.3 var(--font-sans); color: var(--ink); }
    .wu-conf-stars { display: inline-flex; gap: 4px; }
    .wu-conf-star {
      width: 28px; height: 28px; border-radius: 6px;
      background: transparent; border: none; cursor: pointer;
      font: 400 18px/1 var(--font-sans); color: color-mix(in oklab, var(--mut) 50%, var(--paper));
      transition: all .12s;
    }
    .wu-conf-star:hover { color: var(--gold); }
    .wu-conf-star.filled { color: var(--gold); }
    .wu-conf-footer { margin-top: 10px; }
    .wu-conf-footer .wu-btn.primary { padding: 11px 24px; font-size: 14px; }
    .wu-conf-footer .wu-btn.primary:disabled { opacity: .55; cursor: not-allowed; }
  `;
  document.head.appendChild(style);
}
injectStyles();
