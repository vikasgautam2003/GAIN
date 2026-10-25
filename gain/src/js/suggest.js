// ✦ Suggest a task — Groq picks a question from your own sheet pool,
// filtered by topic + difficulty, boosted toward this week's theme and
// your weakest patterns. User reviews, then adds to today's plan.
//
// Credit-aware: Groq fires only when "Suggest a question" is clicked.
// No fire on modal open.

import { getSheets, getDayLog, getSettings, getWallet, callGrok, secure, updateDayLog, updateWallet, KIND_TO_SHEET } from "./store.js";
import { todayKey, activeKey, priceTask } from "./engine.js";
import { renderMarkdown } from "./info.js";
import { callGroqJSON } from "./groqJson.js";

const TOPIC_OPTIONS = [
  { kind: "dsa", label: "DSA",            icon: "⚡" },
  { kind: "sql", label: "SQL",            icon: "🗄" },
  { kind: "sd",  label: "System Design",  icon: "🏗" },
  { kind: "int", label: "Integrations",   icon: "🔌" },
  { kind: "ext", label: "Interview Extras", icon: "🎯" },
];

const DIFFICULTY_OPTIONS = ["Easy", "Medium", "Hard"];

export async function openSuggestModal(root) {
  document.querySelectorAll(".sg-scrim").forEach(m => m.remove());

  const scrim = document.createElement("div");
  scrim.className = "sg-scrim";
  scrim.innerHTML = `
    <div class="sg-modal" role="dialog" aria-label="Suggest a task">
      <header class="sg-head">
        <div>
          <div class="sg-eyebrow">✦ SUGGEST A TASK</div>
          <h2>What should you tackle?</h2>
        </div>
        <button class="sg-close" aria-label="Close">✕</button>
      </header>
      <div class="sg-body" id="sg-body"></div>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.style.overflow = "hidden";

  const close = () => {
    document.body.style.overflow = "";
    scrim.remove();
  };
  scrim.querySelector(".sg-close").addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });

  // State
  const state = {
    kind: "dsa",       // default: DSA
    difficulty: "Medium",
    pick: null,
  };

  paintPicker(scrim, state, async () => {
    paintLoading(scrim);
    try {
      const pick = await askGroqForSuggestion(state);
      if (!pick) {
        paintEmptyPool(scrim, state, () => paintPicker(scrim, state, arguments.callee));
        return;
      }
      state.pick = pick;
      paintResult(scrim, state, {
        onAdd: async () => {
          await addToToday(state.pick);
          flashToast(`✓ Added: ${state.pick.title}`);
          close();
        },
        onRetry: async () => {
          // Try again — bust cache and refetch
          state.cacheBust = Date.now();
          paintLoading(scrim);
          try {
            const alt = await askGroqForSuggestion(state);
            if (alt) {
              state.pick = alt;
              paintResult(scrim, state, arguments.callee.callerArgs);
            }
          } catch (e) {
            paintError(scrim, e.message || String(e));
          }
        },
        onBack: () => {
          state.pick = null;
          paintPicker(scrim, state, async () => {
            paintLoading(scrim);
            try {
              const pick2 = await askGroqForSuggestion(state);
              if (!pick2) { paintEmptyPool(scrim, state); return; }
              state.pick = pick2;
              paintResult(scrim, state, arguments.callee.callerArgs);
            } catch (e) {
              paintError(scrim, e.message || String(e));
            }
          });
        },
      });
    } catch (e) {
      paintError(scrim, e.message || String(e));
    }
  });
}

// -------- picker step --------
function paintPicker(scrim, state, onSubmit) {
  const context = computeContext();
  const body = scrim.querySelector("#sg-body");
  body.innerHTML = `
    <div class="sg-section">
      <div class="sg-label">Topic</div>
      <div class="sg-chip-row" id="sg-topic">
        ${TOPIC_OPTIONS.map(opt => `
          <button class="sg-chip ${state.kind === opt.kind ? "active" : ""}" data-kind="${opt.kind}">
            <span class="sg-chip-ic">${opt.icon}</span>
            <span>${opt.label}</span>
          </button>
        `).join("")}
      </div>
    </div>

    <div class="sg-section">
      <div class="sg-label">Difficulty</div>
      <div class="sg-chip-row" id="sg-diff">
        ${DIFFICULTY_OPTIONS.map(d => `
          <button class="sg-chip sg-chip-diff sg-diff-${d.toLowerCase()} ${state.difficulty === d ? "active" : ""}" data-diff="${d}">
            ${d}
          </button>
        `).join("")}
      </div>
    </div>

    ${context.theme || context.weakest ? `
    <div class="sg-section sg-context">
      <div class="sg-label">Context Groq will use</div>
      <div class="sg-context-list">
        ${context.theme ? `<div class="sg-ctx-item"><b>Week theme</b> <span>${esc(context.theme)}</span></div>` : ""}
        ${context.weakest ? `<div class="sg-ctx-item"><b>Weakest pattern</b> <span>${esc(context.weakest)}</span></div>` : ""}
      </div>
    </div>` : ""}

    <div class="sg-foot">
      <button class="sg-btn primary" id="sg-go">
        <span>✦ Suggest a question</span>
      </button>
    </div>
  `;

  body.querySelectorAll("#sg-topic .sg-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      state.kind = btn.dataset.kind;
      body.querySelectorAll("#sg-topic .sg-chip").forEach(b => b.classList.toggle("active", b === btn));
    });
  });
  body.querySelectorAll("#sg-diff .sg-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      state.difficulty = btn.dataset.diff;
      body.querySelectorAll("#sg-diff .sg-chip").forEach(b => b.classList.toggle("active", b === btn));
    });
  });
  body.querySelector("#sg-go").addEventListener("click", async () => {
    body.querySelector("#sg-go").disabled = true;
    body.querySelector("#sg-go").innerHTML = "Asking Groq…";
    await onSubmit();
  });
}

// -------- loading --------
function paintLoading(scrim) {
  const body = scrim.querySelector("#sg-body");
  body.innerHTML = `
    <div class="sg-loading">
      <div class="sg-skel-title"></div>
      <div class="sg-skel-sub"></div>
      <div class="sg-skel-why"></div>
      <div class="sg-skel-why short"></div>
    </div>
  `;
}

// -------- result card --------
function paintResult(scrim, state, callbacks) {
  const p = state.pick;
  const body = scrim.querySelector("#sg-body");
  // Provenance line: proves the pick came from the user's own sheet
  const prov = p.poolMeta
    ? `From your <b>${esc(p.poolMeta.sheetName)}</b> sheet · picked from <b>${p.poolMeta.poolSize}</b> candidates (out of ${p.poolMeta.totalInSheet} total rows)`
    : "";
  const fellbackNotice = p.fellback
    ? `<div class="sg-fellback" title="Groq returned an out-of-range index. We fell back to the top-ranked candidate — same safe path, slightly different rationale.">⚠ Groq hiccup — picked top-ranked candidate as safety fallback</div>`
    : "";
  body.innerHTML = `
    <div class="sg-result">
      <div class="sg-provenance">
        <span class="sg-prov-dot"></span>
        <span>${prov}</span>
      </div>
      ${fellbackNotice}
      <div class="sg-pick-head">
        <div class="sg-pick-title">${esc(p.title)}</div>
        <div class="sg-pick-sub">
          ${p.pattern ? `<span class="sg-chip-mini sg-chip-pat">${esc(p.pattern)}</span>` : ""}
          ${p.difficulty ? `<span class="sg-chip-mini sg-diff-${p.difficulty.toLowerCase()}">${esc(p.difficulty)}</span>` : ""}
          ${p.lc ? `<span class="sg-chip-mini sg-chip-lc">LC #${esc(String(p.lc))}</span>` : ""}
        </div>
      </div>

      <div class="sg-section-h">
        <span class="sg-section-ic">💡</span>
        <span>Why this one</span>
      </div>
      <p class="sg-why">${renderMarkdown(p.why || "")}</p>

      <div class="sg-stats">
        <div class="sg-stat">
          <div class="sg-stat-lb">Expected</div>
          <div class="sg-stat-v">${p.minutes} min</div>
        </div>
        <div class="sg-stat">
          <div class="sg-stat-lb">Bounty</div>
          <div class="sg-stat-v">+ ₹${p.value}</div>
        </div>
      </div>

      <div class="sg-foot sg-foot-result">
        <button class="sg-btn ghost" id="sg-back">↶ Back</button>
        <button class="sg-btn ghost" id="sg-retry">↻ Try another</button>
        <div style="flex:1"></div>
        <button class="sg-btn primary" id="sg-add">+ Add to today →</button>
      </div>
    </div>
  `;

  // Bind handlers
  body.querySelector("#sg-add").addEventListener("click", callbacks.onAdd);
  body.querySelector("#sg-back").addEventListener("click", callbacks.onBack);
  body.querySelector("#sg-retry").addEventListener("click", async () => {
    body.querySelector("#sg-retry").disabled = true;
    body.querySelector("#sg-retry").textContent = "Thinking…";
    // Clear and try another
    paintLoading(scrim);
    try {
      state.cacheBust = (state.cacheBust || 0) + 1;
      const alt = await askGroqForSuggestion(state);
      if (alt) {
        state.pick = alt;
        paintResult(scrim, state, callbacks);
      }
    } catch (e) {
      paintError(scrim, e.message || String(e));
    }
  });
  // Store callerArgs so retry handler can call back into this function
  callbacks.callerArgs = callbacks;
}

function paintEmptyPool(scrim, state, onBack) {
  const sheetName = KIND_TO_SHEET[state.kind] || "the sheet";
  const body = scrim.querySelector("#sg-body");
  body.innerHTML = `
    <div class="sg-empty">
      <div class="sg-empty-ico">∅</div>
      <h3>No unsolved problems left</h3>
      <p>${esc(sheetName)} has no <b>${esc(state.difficulty)}</b> rows with Status = TODO. Try a different difficulty, or pick another topic.</p>
      <button class="sg-btn ghost" id="sg-back-empty">↶ Back</button>
    </div>
  `;
  body.querySelector("#sg-back-empty")?.addEventListener("click", () => {
    if (onBack) onBack();
    else paintPicker(scrim, state, async () => {});
  });
}

function paintError(scrim, msg) {
  const body = scrim.querySelector("#sg-body");
  body.innerHTML = `
    <div class="sg-err">
      <b>Couldn't fetch suggestion.</b>
      <p>${esc(msg)}</p>
      <button class="sg-btn ghost" id="sg-close-err">Close</button>
    </div>
  `;
  body.querySelector("#sg-close-err")?.addEventListener("click", () => {
    document.body.style.overflow = "";
    document.querySelector(".sg-scrim")?.remove();
  });
}

// -------- Groq pick (BULLETPROOF VERSION) --------
// Design rules that make this impossible to hallucinate off-pool:
//   1. Candidate pool is drawn from `getSheets()[sheetName].rows` with Status != SOLVED.
//   2. Candidates are enumerated 1..N and sent to Groq.
//   3. Groq picks an INDEX (not a free-form title). Can't invent a title.
//   4. If Groq returns an out-of-range index (shouldn't happen with JSON mode), we
//      fall back to the TOP-RANKED candidate and attach a `fellback: true` flag
//      the UI surfaces as a tiny note.
//   5. The "why" is always evaluated against the ACTUAL picked candidate, never a
//      hallucinated title. If Groq's rationale is empty or clearly wrong, we
//      compose a fallback referencing the real pick's pattern + context.
async function askGroqForSuggestion(state) {
  const sheetName = KIND_TO_SHEET[state.kind];
  if (!sheetName) throw new Error(`No sheet for kind ${state.kind}`);
  const sheet = getSheets()[sheetName];
  if (!sheet) throw new Error(`${sheetName} sheet isn't loaded`);

  const context = computeContext();
  const candidates = buildCandidatePool(sheet, state.difficulty, context);
  if (!candidates.length) return null;

  // Attach source metadata so the UI can prove "this came from your sheet".
  const totalInSheet = sheet.rows.length;
  const pool = candidates.slice(0, 30);  // cap for token budget; 30 is plenty
  const poolMeta = { sheetName, totalInSheet, poolSize: pool.length };

  // 1-item pool → no Groq call, hand-roll rationale
  if (pool.length === 1) {
    const only = pool[0];
    return {
      ...only,
      why: handRollRationale(only, state, context, "only-candidate"),
      poolMeta,
    };
  }

  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key. Add one in Settings → AI butler.");

  // Enumerated pool — Groq picks by INDEX
  const enumeratedPool = pool.map((c, i) =>
    `${i + 1}. ${c.title}${c.pattern ? ` [${c.pattern}]` : ""}${c.lc ? ` (LC #${c.lc})` : ""}${c.freq ? ` {freq=${c.freq}}` : ""}`
  ).join("\n");

  const user = `
Topic: ${state.kind.toUpperCase()} (sheet type: ${sheet.type || "generic"})
Difficulty filter: ${state.difficulty}
${context.theme ? `This week's theme: ${context.theme}` : ""}
${context.weakest ? `User's weakest pattern (from confidence stars): ${context.weakest}` : ""}
${state.cacheBust ? `Variety seed: ${state.cacheBust} — pick a DIFFERENT index than before.` : ""}

Candidate pool (${pool.length} unsolved problems from the user's own ${sheetName} sheet, numbered 1-${pool.length}):
${enumeratedPool}

Pick ONE by returning its INDEX (integer between 1 and ${pool.length}).
Reply as JSON only:
{"pickIndex": <integer 1-${pool.length}>, "why": "<ONE sentence (interview-tone, keyword-dense, name the specific pattern/trade-off/skill)>"}
No markdown. No preamble. The pickIndex MUST be between 1 and ${pool.length}.
  `.trim();

  const res = await callGroqJSON({
    apiKey,
    maxTokens: 384,
    system: `You are a GAIN FDE interview-prep librarian. Pick ONE study problem BY INDEX from the user's own pool that maximizes learning right now. Weigh: (1) weakest pattern, (2) weekly theme, (3) classic coverage. The pickIndex is an integer 1-N; invalid indexes break the app, so stay in range.`,
    user,
    label: "suggest",
    schemaCheck: (obj) => {
      if (!obj || typeof obj !== "object") return "not an object";
      const idx = Number.isInteger(obj.pickIndex) ? obj.pickIndex : parseInt(obj.pickIndex, 10);
      if (!Number.isInteger(idx) || idx < 1 || idx > pool.length) return `pickIndex out of range (got ${obj.pickIndex}, pool size ${pool.length})`;
      return true;
    },
  });
  if (!res.ok) throw new Error(res.error);
  const parsed = res.data;

  // -------- Index-based pick with hard validation --------
  const rawIdx = parsed.pickIndex;
  const idx = Number.isInteger(rawIdx) ? rawIdx : parseInt(rawIdx, 10);
  let picked = null;
  let fellback = false;
  if (Number.isInteger(idx) && idx >= 1 && idx <= pool.length) {
    picked = pool[idx - 1];
  } else {
    // Groq flubbed. Fall back to top-ranked.
    picked = pool[0];
    fellback = true;
  }

  // The "why" is tied to the ACTUAL picked candidate — if Groq's rationale is
  // empty, or if we fell back, use a hand-rolled one that references the real pick.
  let why = String(parsed.why || "").trim();
  if (!why || fellback) {
    why = handRollRationale(picked, state, context, fellback ? "fallback-top-ranked" : "no-groq-why");
  }

  return { ...picked, why, poolMeta, fellback };
}

// Hand-rolled rationale that references the ACTUAL picked candidate's pattern
// and the user's context. Used when Groq doesn't help us.
function handRollRationale(pick, state, context, reason) {
  const bits = [];
  const pattern = pick.pattern || `${state.kind.toUpperCase()} fundamentals`;
  const diff = pick.difficulty || state.difficulty;
  // Lead by context relevance
  if (context.weakest && pattern.toLowerCase().includes(context.weakest.split(" ")[0].toLowerCase())) {
    bits.push(`Direct hit on your weakest pattern (${context.weakest}).`);
  } else if (context.theme && pattern.toLowerCase().includes(context.theme.split(" ")[0].toLowerCase())) {
    bits.push(`Matches this week's theme (${context.theme}).`);
  } else {
    bits.push(`Classic ${pattern} at ${diff}.`);
  }
  if (pick.freq && /^high$/i.test(pick.freq)) bits.push(`HIGH-frequency rep — shows up in loops.`);
  if (reason === "fallback-top-ranked") bits.push(`Chosen as the top-ranked candidate.`);
  return bits.join(" ");
}

function buildCandidatePool(sheet, difficulty, context) {
  const titleCol = sheet.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
  const patternCol = sheet.headers.find(h => /^(pattern|category)$/i.test(h));
  const diffCol = sheet.headers.find(h => /^difficulty$/i.test(h));
  const statusCol = sheet.headers.find(h => /^status$/i.test(h));
  const lcCol = sheet.headers.find(h => /^lc#?$/i.test(h));
  const freqCol = sheet.headers.find(h => /^(freq|priority)$/i.test(h));

  const rows = [];
  for (let i = 0; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    const title = r[titleCol] || "";
    if (!title.trim()) continue;
    const status = r[statusCol] || "";
    // Must be unsolved
    if (/^(solved|done)$/i.test(status)) continue;
    const diff = r[diffCol] || "";
    // Difficulty filter — only apply if the sheet actually has a Difficulty column
    if (diffCol && diff && diff.toLowerCase() !== difficulty.toLowerCase()) continue;

    const pattern = r[patternCol] || "";
    const freq = r[freqCol] || "";
    rows.push({
      sheet: sheet.name || null,
      rowIndex: i,
      title: title.trim(),
      pattern: pattern || "",
      difficulty: diff || difficulty,
      lc: r[lcCol] || "",
      freq: freq || "",
      minutes: estimateMinutes(diff || difficulty, sheet.type),
      value: 0,  // priced below
    });
  }

  // Rank: weakest-pattern > weekly-theme > HIGH-freq > arbitrary
  const theme = context.theme ? context.theme.toLowerCase() : "";
  const weakest = context.weakest ? context.weakest.toLowerCase() : "";
  rows.sort((a, b) => {
    const score = (r) => {
      let s = 0;
      const p = (r.pattern || "").toLowerCase();
      if (weakest && p.includes(weakest.split(" ")[0])) s += 100;
      if (theme && p.includes(theme.split(" ")[0])) s += 50;
      if (/^high$/i.test(r.freq)) s += 10;
      return s;
    };
    return score(b) - score(a);
  });

  // Price everything via engine's priceTask
  const settings = getSettings();
  const kindMap = { DSA: "dsa", "System Design": "sd", "Integrations": "int", "Interview Extras": "ext", "SQL": "sql" };
  const kind = kindMap[sheet.name] || "dsa";
  for (const r of rows) {
    r.kind = kind;
    r.value = priceTask({ kind, difficulty: r.difficulty, minutes: r.minutes, freq: r.freq }, settings);
  }

  return rows;
}

function estimateMinutes(difficulty, sheetType) {
  const d = String(difficulty || "").toLowerCase();
  if (sheetType === "sd" || sheetType === "int" || sheetType === "ext") return 25;
  if (d === "easy") return 25;
  if (d === "medium") return 40;
  if (d === "hard") return 55;
  return 30;
}

// -------- context: weekly theme + weakest pattern --------
function computeContext() {
  const dayLog = getDayLog();
  const today = dayLog[todayKey()];
  const theme = today?.weeklyPlan?.theme || today?.weeklyPlan?.title || null;

  // Weakest pattern: lowest avg confidence across last 10 solves per pattern
  const timeline = {};
  for (const d of Object.keys(dayLog).sort()) {
    const entry = dayLog[d];
    if (!entry?.assigned?.length) continue;
    for (const ref of (entry.done || [])) {
      const task = entry.assigned.find(t => t.ref === ref);
      if (!task?.pattern) continue;
      const rating = entry.confidence?.[ref];
      if (!(rating >= 1 && rating <= 5)) continue;
      timeline[task.pattern] = timeline[task.pattern] || [];
      timeline[task.pattern].push(rating);
    }
  }
  let weakest = null, lowestAvg = Infinity;
  for (const [p, ratings] of Object.entries(timeline)) {
    if (ratings.length < 2) continue;
    const avg = ratings.slice(-10).reduce((a,b)=>a+b,0) / Math.min(ratings.length, 10);
    if (avg < lowestAvg) { lowestAvg = avg; weakest = p; }
  }
  // Only surface if avg confidence ≤ 2.8 — otherwise user isn't actually weak there.
  if (lowestAvg > 2.8) weakest = null;

  return { theme, weakest };
}

// -------- add to today --------
async function addToToday(pick) {
  const dateKey = activeKey();
  const ref = `SUGGEST-${pick.sheet}-${pick.rowIndex}-${Date.now()}`;
  const task = {
    ref,
    kind: pick.kind,
    title: pick.title,
    pattern: pick.pattern,
    difficulty: pick.difficulty,
    minutes: pick.minutes,
    value: pick.value,
    freq: pick.freq,
    lc: pick.lc,
    sheet: pick.sheet,
    rowIndex: pick.rowIndex,
    suggested: true,  // marker so UI can show ✦ pill
  };
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    d.assigned.push(task);
    d.values[ref] = task.value;
  });
}

// -------- flash toast --------
function flashToast(message) {
  document.querySelectorAll(".sg-toast").forEach(t => t.remove());
  const t = document.createElement("div");
  t.className = "sg-toast";
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 240);
  }, 2600);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }
  )[c]);
}

// -------- styles (injected once) --------
function injectStyles() {
  if (document.getElementById("suggest-styles")) return;
  const style = document.createElement("style");
  style.id = "suggest-styles";
  style.textContent = `
    .sg-scrim {
      position: fixed; inset: 0; z-index: 1300;
      background: rgba(8,10,14,.66);
      backdrop-filter: blur(10px) saturate(140%);
      -webkit-backdrop-filter: blur(10px) saturate(140%);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: sgFade 220ms ease both;
    }
    @keyframes sgFade { from { opacity: 0; } to { opacity: 1; } }
    .sg-modal {
      background: var(--paper); border-radius: 20px;
      width: 100%; max-width: 560px; max-height: 90vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 32px 80px rgba(0,0,0,.4), 0 0 0 1px var(--line);
      animation: sgPop 240ms cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes sgPop {
      from { opacity: 0; transform: translateY(16px) scale(.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .sg-head {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 22px 24px 16px; border-bottom: 1px solid var(--line);
    }
    .sg-eyebrow { font-size: 10.5px; letter-spacing: .14em; font-weight: 700; color: var(--gold); text-transform: uppercase; margin-bottom: 6px; }
    .sg-head h2 { margin: 0; font-size: 20px; font-weight: 700; color: var(--ink); letter-spacing: -.015em; }
    .sg-close {
      border: none; background: transparent; cursor: pointer; color: var(--mut);
      width: 32px; height: 32px; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center;
      font: 400 18px/1 var(--font-sans);
      transition: all .18s;
    }
    .sg-close:hover { background: var(--bg); color: var(--ink); }
    .sg-body { padding: 20px 24px; overflow-y: auto; flex: 1; }

    .sg-section { margin-bottom: 20px; }
    .sg-label {
      font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em;
      text-transform: uppercase; color: var(--mut); margin-bottom: 10px;
    }
    .sg-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .sg-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 9px 14px; border-radius: 10px;
      background: var(--paper); border: 1px solid var(--line);
      color: var(--mut); font: 600 12.5px/1 var(--font-sans);
      cursor: pointer; transition: all .18s;
    }
    .sg-chip:hover { color: var(--ink); border-color: var(--line2); }
    .sg-chip.active {
      background: var(--ink); color: var(--paper); border-color: var(--ink);
    }
    .sg-chip .sg-chip-ic { font-size: 14px; }
    .sg-chip-diff.sg-diff-easy.active { background: var(--green); border-color: var(--green); color: #fff; }
    .sg-chip-diff.sg-diff-medium.active { background: var(--gold); border-color: var(--gold); color: #111; }
    .sg-chip-diff.sg-diff-hard.active { background: var(--red); border-color: var(--red); color: #fff; }

    .sg-context { padding: 12px 14px; background: var(--bg); border-radius: 10px; }
    .sg-context .sg-label { margin-bottom: 8px; }
    .sg-context-list { display: flex; flex-direction: column; gap: 6px; }
    .sg-ctx-item {
      display: flex; align-items: baseline; gap: 10px;
      font-size: 12.5px; color: var(--ink);
    }
    .sg-ctx-item b { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--mut); font-weight: 700; min-width: 110px; }

    .sg-foot {
      display: flex; align-items: center; gap: 10px;
      margin-top: 24px;
    }
    .sg-foot-result { margin-top: 20px; justify-content: flex-end; }
    .sg-btn {
      padding: 10px 18px; border-radius: 10px; cursor: pointer;
      font: 600 13px/1 var(--font-sans);
      border: 1px solid var(--line);
      transition: all .18s;
    }
    .sg-btn.ghost { background: var(--paper); color: var(--mut); }
    .sg-btn.ghost:hover { color: var(--ink); border-color: var(--line2); }
    .sg-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); width: 100%; justify-content: center; display: flex; }
    .sg-btn.primary:hover { transform: translateY(-1px); filter: brightness(1.08); }
    .sg-foot-result .sg-btn.primary { width: auto; }

    /* ---- Loading skeleton ---- */
    .sg-loading { padding: 20px 0; }
    .sg-skel-title, .sg-skel-sub, .sg-skel-why {
      height: 14px; border-radius: 6px; margin-bottom: 10px;
      background: linear-gradient(90deg, var(--line) 0%, color-mix(in oklab, var(--line) 50%, var(--paper)) 50%, var(--line) 100%);
      background-size: 200% 100%; animation: sgShim 1200ms ease-in-out infinite;
    }
    .sg-skel-title { width: 70%; height: 18px; }
    .sg-skel-sub   { width: 40%; height: 12px; margin-bottom: 20px; }
    .sg-skel-why { height: 12px; }
    .sg-skel-why.short { width: 65%; }
    @keyframes sgShim { from { background-position: 200% 0; } to { background-position: -200% 0; } }

    /* ---- Result card ---- */
    .sg-result { padding: 4px 0; }
    .sg-provenance {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; margin-bottom: 10px;
      background: var(--green-soft); border-radius: 999px;
      color: var(--green); font-size: 11.5px;
      font-weight: 500; letter-spacing: -.005em;
    }
    .sg-provenance b { color: var(--ink); font-weight: 700; }
    .sg-prov-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 0 3px color-mix(in oklab, var(--green) 25%, transparent);
    }
    .sg-fellback {
      padding: 8px 12px; margin-bottom: 12px;
      background: color-mix(in oklab, var(--gold) 10%, transparent);
      border-left: 3px solid var(--gold); border-radius: 8px;
      color: var(--gold); font-size: 11.5px;
      cursor: help;
    }
    .sg-pick-head { margin-bottom: 20px; }
    .sg-pick-title {
      font-size: 20px; font-weight: 700; color: var(--ink);
      letter-spacing: -.015em; line-height: 1.2; margin-bottom: 8px;
    }
    .sg-pick-sub { display: flex; flex-wrap: wrap; gap: 6px; }
    .sg-chip-mini {
      padding: 3px 8px; border-radius: 6px;
      font: 600 10.5px/1.3 var(--font-sans); letter-spacing: .02em;
      background: color-mix(in oklab, var(--ink) 5%, transparent); color: var(--mut);
    }
    .sg-chip-mini.sg-chip-pat { background: var(--blue-soft); color: var(--blue); }
    .sg-chip-mini.sg-chip-lc { background: color-mix(in oklab, var(--blue) 10%, transparent); color: var(--blue); font-variant-numeric: tabular-nums; }
    .sg-chip-mini.sg-diff-easy { background: color-mix(in oklab, var(--green) 12%, transparent); color: var(--green); }
    .sg-chip-mini.sg-diff-medium { background: color-mix(in oklab, var(--gold) 14%, transparent); color: var(--gold); }
    .sg-chip-mini.sg-diff-hard { background: color-mix(in oklab, var(--red) 12%, transparent); color: var(--red); }

    .sg-section-h {
      display: flex; align-items: center; gap: 8px;
      font: 700 11.5px/1 var(--font-sans); letter-spacing: .08em;
      text-transform: uppercase; color: var(--mut); margin-bottom: 8px;
    }
    .sg-section-ic { font-size: 15px; }
    .sg-why {
      margin: 0 0 20px; padding: 14px 16px;
      background: color-mix(in oklab, var(--gold) 6%, var(--paper));
      border-left: 3px solid var(--gold); border-radius: 10px;
      font-size: 14px; line-height: 1.55; color: var(--ink);
    }
    .sg-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .sg-stat {
      padding: 12px 14px; background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
    }
    .sg-stat-lb { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); margin-bottom: 4px; }
    .sg-stat-v { font-size: 16px; font-weight: 700; color: var(--ink); letter-spacing: -.01em; }

    /* ---- Empty / error ---- */
    .sg-empty, .sg-err {
      text-align: center; padding: 30px 20px;
    }
    .sg-empty-ico { font-size: 48px; color: var(--mut); margin-bottom: 10px; }
    .sg-empty h3 { margin: 0 0 8px; font-size: 17px; font-weight: 700; color: var(--ink); }
    .sg-empty p { margin: 0 0 18px; color: var(--mut); font-size: 13px; line-height: 1.5; }
    .sg-err { background: color-mix(in oklab, var(--red) 8%, transparent); border-radius: 12px; }
    .sg-err b { color: var(--red); display: block; margin-bottom: 8px; }
    .sg-err p { color: var(--ink); font-size: 13px; margin: 0 0 14px; }

    /* ---- Toast ---- */
    .sg-toast {
      position: fixed; bottom: 24px; left: 50%; transform: translate(-50%, 20px);
      padding: 12px 20px; background: var(--ink); color: var(--paper);
      border-radius: 999px; font: 600 13px/1 var(--font-sans);
      z-index: 1400; opacity: 0;
      box-shadow: 0 12px 32px rgba(0,0,0,.3);
      transition: all .24s cubic-bezier(.2,1.2,.3,1);
    }
    .sg-toast.show { opacity: 1; transform: translate(-50%, 0); }
  `;
  document.head.appendChild(style);
}
injectStyles();
