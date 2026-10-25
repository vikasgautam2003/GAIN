// "Explain this back" drill — once a week, pick a problem the user solved
// ★4 or ★5 four-to-five weeks ago and ask them to explain the approach in
// their own words. Groq grades on clarity + accuracy + completeness.
//
// State: localStorage key "gain:explainback:lastShown" (ISO date) + per-key
// completion markers "gain:explainback:done:<key>" so we don't ask the same
// problem twice.

import { getDayLog, getSheets, secure } from "./store.js";
import { callGroqJSON } from "./groqJson.js";
import { renderMarkdown } from "./info.js";

const LAST_SHOWN_KEY = "gain:explainback:lastShown";
const COOLDOWN_DAYS = 7;      // only one drill per week
const WINDOW_MIN_DAYS = 21;   // problem must be at least 3 weeks old
const WINDOW_MAX_DAYS = 42;   // up to 6 weeks

// Pick a candidate problem for today's drill.
export function pickExplainBackCandidate() {
  const dayLog = getDayLog();
  const sheets = getSheets();
  const now = Date.now();
  const candidates = [];
  for (const [d, entry] of Object.entries(dayLog)) {
    if (!entry?.done?.length) continue;
    const dateMs = (() => {
      try { return Date.UTC(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10)) + 12 * 3600 * 1000; }
      catch { return null; }
    })();
    if (!dateMs) continue;
    const daysAgo = (now - dateMs) / 86400000;
    if (daysAgo < WINDOW_MIN_DAYS || daysAgo > WINDOW_MAX_DAYS) continue;
    for (const ref of entry.done) {
      const stars = Number(entry.confidence?.[ref]);
      if (!(stars >= 4)) continue;
      const task = (entry.assigned || []).find(x => x.ref === ref);
      if (!task?.sheet || task.rowIndex == null) continue;
      const key = `${task.sheet}#${task.rowIndex}`;
      try { if (localStorage.getItem(`gain:explainback:done:${key}`)) continue; } catch (_) {}
      candidates.push({ key, task, stars, daysAgo });
    }
  }
  if (!candidates.length) return null;
  // Prefer older (longer gap) and ★4 before ★5 (★4 more fragile)
  candidates.sort((a, b) => (a.stars - b.stars) || (b.daysAgo - a.daysAgo));
  return candidates[0];
}

export function isDrillDueNow() {
  try {
    const last = localStorage.getItem(LAST_SHOWN_KEY);
    if (last) {
      const diff = (Date.now() - new Date(last).getTime()) / 86400000;
      if (diff < COOLDOWN_DAYS) return false;
    }
  } catch (_) {}
  return !!pickExplainBackCandidate();
}

export function markShown() {
  try { localStorage.setItem(LAST_SHOWN_KEY, new Date().toISOString()); } catch (_) {}
}

export function markDone(key) {
  try { localStorage.setItem(`gain:explainback:done:${key}`, String(Date.now())); } catch (_) {}
}

// Grade the user's explanation via Groq.
export async function gradeExplanation({ problem, explanation }) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key.");

  const system = `You are a staff FDE interviewer grading a student's RECALL of a problem they solved 3-6 weeks ago.
They were ★4 or ★5 at the time. Grade their explanation on CLARITY · ACCURACY · COMPLETENESS, each 1-5. Then write a short feedback paragraph (3-4 sentences, direct, warm, specific).

Reply with VALID JSON only (no fences):
{
  "clarity": 1-5,
  "accuracy": 1-5,
  "completeness": 1-5,
  "feedback": "3-4 sentences — specific. Name what they got right AND what they missed. Reference the actual algorithm/invariant/complexity. Not generic praise."
}

Rules:
- Grade honestly. If the explanation is vague, score low on clarity. If invariants are wrong, low on accuracy. If big-O or edge cases are missing, low on completeness.
- Feedback must reference the ACTUAL problem's expected approach.
- Max 20 words per sentence.`;

  const user = `Problem: ${problem.title}
Pattern: ${problem.pattern || "unknown"}${problem.difficulty ? ` · Difficulty: ${problem.difficulty}` : ""}
Student solved this ${Math.round(problem.daysAgo)} days ago at ★${problem.stars}/5.

Student's recall explanation:
---
${explanation}
---

Grade this explanation.`;

  const res = await callGroqJSON({
    apiKey, system, user, maxTokens: 768, label: "explainback",
    schemaCheck: (obj) => {
      if (!obj) return "no object";
      const nums = [obj.clarity, obj.accuracy, obj.completeness];
      if (nums.some(n => !Number.isInteger(n) || n < 1 || n > 5)) return "scores must be integers 1-5";
      if (typeof obj.feedback !== "string" || !obj.feedback.trim()) return "feedback required";
      return true;
    },
  });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// Open the drill modal.
export async function openExplainBackDrill() {
  const cand = pickExplainBackCandidate();
  if (!cand) return;
  markShown();

  document.querySelectorAll(".eb-scrim").forEach(x => x.remove());
  injectStyles();

  const scrim = document.createElement("div");
  scrim.className = "eb-scrim";
  scrim.innerHTML = `
    <div class="eb-modal" role="dialog">
      <header class="eb-head">
        <div>
          <div class="eb-eyebrow">EXPLAIN-BACK DRILL</div>
          <h2 class="eb-title">${esc(cand.task.title)}</h2>
          <div class="eb-meta">
            ${cand.task.pattern ? `<span>Pattern: <b>${esc(cand.task.pattern)}</b></span>` : ""}
            ${cand.task.difficulty ? `<span>${esc(cand.task.difficulty)}</span>` : ""}
            <span>You solved this <b>${Math.round(cand.daysAgo)} days ago</b> at ★${cand.stars}</span>
          </div>
        </div>
        <button class="eb-close" id="eb-close" aria-label="Close">×</button>
      </header>
      <div class="eb-body" id="eb-body">
        <p class="eb-prompt">Explain the approach in your own words — invariant, data structure, complexity, edge cases. Just type what you remember, no googling.</p>
        <textarea id="eb-input" placeholder="e.g. 'we keep a hashmap of value→index as we scan; for each new num, check if target − num is in the map; …'" rows="8"></textarea>
      </div>
      <footer class="eb-foot">
        <button class="eb-btn ghost" id="eb-skip">Skip for now</button>
        <button class="eb-btn primary" id="eb-grade" disabled>Grade me</button>
      </footer>
    </div>
  `;
  document.body.appendChild(scrim);

  const input = scrim.querySelector("#eb-input");
  const gradeBtn = scrim.querySelector("#eb-grade");
  const close = () => scrim.remove();
  input.addEventListener("input", () => { gradeBtn.disabled = input.value.trim().length < 20; });
  setTimeout(() => input.focus(), 60);
  scrim.querySelector("#eb-close").addEventListener("click", close);
  scrim.querySelector("#eb-skip").addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });

  gradeBtn.addEventListener("click", async () => {
    const explanation = input.value.trim();
    if (explanation.length < 20) return;
    gradeBtn.disabled = true;
    gradeBtn.textContent = "Grading…";
    try {
      const result = await gradeExplanation({
        problem: { title: cand.task.title, pattern: cand.task.pattern, difficulty: cand.task.difficulty, daysAgo: cand.daysAgo, stars: cand.stars },
        explanation,
      });
      markDone(cand.key);
      // Replace body with the result
      const body = scrim.querySelector("#eb-body");
      const total = result.clarity + result.accuracy + result.completeness;
      body.innerHTML = `
        <div class="eb-result">
          <div class="eb-scores">
            ${scoreTile("Clarity", result.clarity)}
            ${scoreTile("Accuracy", result.accuracy)}
            ${scoreTile("Completeness", result.completeness)}
          </div>
          <div class="eb-total">${total}/15</div>
          <div class="eb-feedback">${renderMarkdown(result.feedback)}</div>
        </div>
      `;
      scrim.querySelector(".eb-foot").innerHTML = `<button class="eb-btn primary" id="eb-done">Done</button>`;
      scrim.querySelector("#eb-done").addEventListener("click", close);
    } catch (e) {
      gradeBtn.disabled = false;
      gradeBtn.textContent = "Grade me";
      alert(`Couldn't grade: ${e.message || e}`);
    }
  });
}

function scoreTile(label, score) {
  const band = score >= 4 ? "high" : score >= 3 ? "mid" : "low";
  return `<div class="eb-stile eb-${band}"><div class="eb-sval">${score}/5</div><div class="eb-slabel">${esc(label)}</div></div>`;
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }

function injectStyles() {
  if (document.getElementById("eb-styles")) return;
  const s = document.createElement("style");
  s.id = "eb-styles";
  s.textContent = `
    .eb-scrim { position: fixed; inset: 0; z-index: 1500; background: rgba(0,0,0,.6); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; padding: 24px; animation: ebFade .22s ease both; }
    @keyframes ebFade { from { opacity: 0; } to { opacity: 1; } }
    .eb-modal { background: var(--paper); border: 1px solid var(--line2); border-radius: 16px; width: 100%; max-width: 640px; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 32px 80px rgba(0,0,0,.3); animation: ebPop .25s cubic-bezier(.2,1.2,.3,1) both; }
    @keyframes ebPop { from { opacity: 0; transform: translateY(16px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .eb-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 22px 26px 18px; border-bottom: 1px solid var(--line); gap: 12px; }
    .eb-eyebrow { font: 700 11px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase; color: var(--gold); margin-bottom: 10px; }
    .eb-title { margin: 0 0 10px; font: 600 22px/1.25 var(--font-sans); letter-spacing: -.015em; color: var(--ink); }
    .eb-meta { display: flex; flex-wrap: wrap; gap: 14px; font: 500 12.5px/1.4 var(--font-sans); color: var(--mut); }
    .eb-meta b { color: var(--ink); font-weight: 700; }
    .eb-close { flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px; background: transparent; border: 1px solid var(--line); color: var(--mut); cursor: pointer; font: 400 18px/1 var(--font-sans); }
    .eb-close:hover { color: var(--ink); border-color: var(--line2); }
    .eb-body { padding: 20px 26px; overflow-y: auto; }
    .eb-prompt { margin: 0 0 14px; font: 400 14px/1.6 var(--font-sans); color: var(--dim, var(--mut)); }
    .eb-body textarea { width: 100%; padding: 14px 16px; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; color: var(--ink); font: 500 14px/1.65 var(--font-sans); outline: none; resize: vertical; min-height: 160px; box-sizing: border-box; }
    .eb-body textarea:focus { border-color: var(--ink); }
    .eb-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 26px; border-top: 1px solid var(--line); }
    .eb-btn { padding: 11px 22px; border-radius: 10px; cursor: pointer; font: 600 13px/1 var(--font-sans); border: 1px solid var(--line2); transition: all .18s; background: transparent; color: var(--mut); }
    .eb-btn:hover { color: var(--ink); border-color: var(--ink); }
    .eb-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .eb-btn.primary:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
    .eb-btn.primary:disabled { opacity: .4; cursor: not-allowed; }

    .eb-result { padding: 10px 0; }
    .eb-scores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
    .eb-stile { padding: 14px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; text-align: center; }
    .eb-sval { font: 800 24px/1 var(--font-sans); color: var(--ink); margin-bottom: 6px; letter-spacing: -.01em; }
    .eb-slabel { font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }
    .eb-high { background: color-mix(in oklab, var(--green) 15%, var(--paper)); border-color: color-mix(in oklab, var(--green) 30%, var(--line)); }
    .eb-high .eb-sval { color: var(--green); }
    .eb-mid { background: color-mix(in oklab, var(--gold) 15%, var(--paper)); border-color: color-mix(in oklab, var(--gold) 32%, var(--line)); }
    .eb-mid .eb-sval { color: var(--gold); }
    .eb-low { background: color-mix(in oklab, var(--red) 12%, var(--paper)); border-color: color-mix(in oklab, var(--red) 28%, var(--line)); }
    .eb-low .eb-sval { color: var(--red); }
    .eb-total { text-align: center; font: 800 36px/1 var(--font-sans); color: var(--ink); margin-bottom: 18px; letter-spacing: -.02em; }
    .eb-feedback { padding: 14px 16px; background: var(--bg); border-radius: 10px; font: 500 14px/1.7 var(--font-sans); color: var(--ink); }
  `;
  document.head.appendChild(s);
}
