// Warm-up quiz — Groq-generated recall drill based on yesterday's solved
// problems (or pattern-of-the-week fallback if yesterday was a rest day).
// 5 Qs: 3 short-answer + 2 MCQ. Hint + Reveal answer via Groq.
//
// Entry: a special gradient card is injected as the first row of Today's plan
// whenever today's dayLog has a `WARMUP-${dateKey}` task AND it isn't yet done.
// Completing all 5 Qs marks that task done + credits ₹20.

import { getDayLog, getSettings, getWallet, callGrok, secure, updateDayLog, updateWallet } from "./store.js";
import { todayKey, calendarKey, tickTask } from "./engine.js";

const CACHE_PREFIX = "gain:warmup:";
const WARMUP_BOUNTY = 20;

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
  const dayLog = getDayLog();
  // yesterday = dateKey - 1 day (calendar math, since dateKey is a calendar key)
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

  // Fallback: pattern-of-the-week from the saved weeklyPlan
  const todayEntry = dayLog[dateKey];
  const theme = todayEntry?.weeklyPlan?.theme || todayEntry?.weeklyPlan?.title || null;
  if (theme) {
    return {
      kind: "pattern",
      label: theme,                       // just the pattern name, no "pattern · " prefix
      problems: [],
      pattern: theme,
    };
  }
  return null;
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
    answers: new Array(5).fill(""),
    hints: new Array(5).fill(null),       // hint text per Q
    reveals: new Array(5).fill(null),     // revealed answer per Q
    completed: new Array(5).fill(false),  // user hit next after seeing hint/answer or typed something
  };

  const paintEverything = () => {
    paintQuestion(scrim, state, questions, close, async () => {
      // All 5 done — credit bounty + mark task done
      await finalizeQuiz(dateKey, taskRef);
      // Micro celebration before closing
      scrim.querySelector(".wu-done-overlay").classList.add("show");
      setTimeout(() => { close(); if (root && typeof root.querySelector === "function") refreshToday(root); }, 1800);
    });
  };

  if (!questions) {
    // No cached quiz for today — show an explicit "Generate" screen.
    // Groq only fires when the user clicks the button, saving credits.
    showIntroGate(scrim, task, async () => {
      // Show skeleton while fetching
      scrim.querySelector("#wu-skel").hidden = false;
      scrim.querySelector("#wu-stage").hidden = true;
      try {
        const qs = await fetchQuestions(task, scrim);
        if (qs && qs.length === 5) {
          questions = qs;
          try { localStorage.setItem(cacheKey, JSON.stringify(qs)); } catch (_) {}
          paintEverything();
        } else {
          showQuizError(scrim, "Couldn't generate questions. Check your Groq key in Settings.");
        }
      } catch (e) {
        showQuizError(scrim, String(e.message || e));
      }
    });
  } else {
    paintEverything();
  }
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
  if (day.done.includes(taskRef)) return;  // already credited
  await tickTask(dateKey, taskRef);
  await updateWallet(w => {
    w.earned += task.value;
    w.ledger.push({
      date: new Date().toISOString(),
      type: "task",
      amount: task.value,
      label: task.title,
    });
  });
}

function refreshToday(root) {
  // Soft hint — if the Today page is mounted, trigger a re-paint by dispatching
  // a store event. The today module listens on dayLog/wallet changes already.
}

// -------- Groq fetch --------
async function fetchQuestions(task, scrim) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) {
    showQuizError(scrim, "No Groq API key. Add one in Settings → AI butler.");
    return null;
  }

  const ctx = buildQuestionsContext(task);
  const res = await callGrok({
    apiKey,
    jsonMode: true,
    system: `You are a GAIN FDE interview-prep warm-up coach. Generate EXACTLY 5 recall questions as STRICT JSON — no markdown, no preamble.
Format: {"questions": [ { "type": "short" | "mcq", "prompt": "...", "options": ["A","B","C","D"] (ONLY if type=mcq), "answer_key": "1-letter MCQ answer OR the single-sentence short-answer key points" } × 5 ] }

Rules:
- Exactly 3 "short" and 2 "mcq".
- Mix complexity-analysis, pattern-recognition, edge cases, trade-offs.
- Each question references a SPECIFIC problem or SPECIFIC pattern from the context.
- Short answers must be answerable in 1-2 sentences.
- MCQ options are 4 total; "answer_key" is JUST the letter ("A"/"B"/"C"/"D").
- Keyword-dense, interview-tone. No fluff, no theory lectures.
- NEVER give the full solution — questions should probe recall, not require it.`,
    user: ctx
  });

  if (!res.ok) throw new Error(res.error || "Groq call failed");

  let parsed;
  try {
    const raw = res.content.trim().replace(/^```json\s*|\s*```$/g, "");
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error("Couldn't parse quiz response.");
  }
  const qs = parsed.questions;
  if (!Array.isArray(qs) || qs.length !== 5) throw new Error("Quiz didn't return 5 questions.");
  return qs;
}

function buildQuestionsContext(task) {
  if (task.sourceKind === "yesterday" && task.sourceProblems?.length) {
    return `Yesterday's solved problems:
${task.sourceProblems.map((p, i) => `${i + 1}. ${p.title} [${p.pattern || "no-pattern"}${p.difficulty ? ", " + p.difficulty : ""}]`).join("\n")}

Generate 5 quiz questions probing understanding of these specific problems. Vary question type (3 short-answer + 2 MCQ).`;
  }
  if (task.sourceKind === "pattern" && task.sourcePattern) {
    return `This week's theme: ${task.sourcePattern}

The user had no solves yesterday. Generate 5 quiz questions on the fundamental ideas of this pattern — pattern recognition, time/space complexity, when it applies vs when it fails, and 1 MCQ on a classic LeetCode problem that uses this pattern. (3 short-answer + 2 MCQ).`;
  }
  return `Generate 5 generic FDE interview warm-up questions on hashmaps and arrays (3 short-answer + 2 MCQ).`;
}

// -------- rendering --------
function scaffoldHtml() {
  return `
    <div class="wu-modal" role="dialog" aria-label="Warm-up quiz">
      <header class="wu-head">
        <div>
          <div class="wu-eyebrow">⚡ WARM-UP QUIZ · 5 QUESTIONS</div>
          <h2 id="wu-prog-dots" class="wu-prog">
            <span class="d"></span><span class="d"></span><span class="d"></span><span class="d"></span><span class="d"></span>
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
  if (slot) slot.innerHTML = `<div class="wu-hint-box"><b>✦ Hint</b> ${esc(text)}</div>`;
}
function renderReveal(stage, text, q) {
  const slot = stage.querySelector(".wu-reveal-slot");
  if (slot) {
    const key = q.answer_key ? `<div class="wu-key"><b>Key:</b> ${esc(q.answer_key)}</div>` : "";
    slot.innerHTML = `<div class="wu-reveal-box"><b>Interview answer</b> ${esc(text)} ${key}</div>`;
  }
}

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
  `;
  document.head.appendChild(style);
}
injectStyles();
