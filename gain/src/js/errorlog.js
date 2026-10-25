// Error log — captures "what tripped you?" on ★1 / ★2 ratings.
// Groq generates a tailored prompt based on the problem; the user answers one
// line. Entries live in dayLog[date].errorLog = { ref: { stars, note, groqQ, at } }
// and feed the Mentor Report's weekly mistake review.

import { getDayLog, updateDayLog, getSheets, callGrok, secure } from "./store.js";
import { callGroqJSON } from "./groqJson.js";

export async function logError(dateKey, ref, { stars, note, groqQ }) {
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    d.errorLog = d.errorLog || {};
    d.errorLog[ref] = {
      stars,
      note: String(note || "").trim().slice(0, 240),
      groqQ: String(groqQ || "").trim().slice(0, 240),
      at: Date.now(),
    };
  });
}

export function getErrorLog(dateKey) {
  const d = getDayLog()[dateKey];
  return d?.errorLog || {};
}

// Collect every error-log entry in the past N days, enriched with the task
// metadata (title, pattern) from that day's assigned list.
export function getRecentErrors(nDays = 14) {
  const dayLog = getDayLog();
  const dates = Object.keys(dayLog).sort().reverse();
  const now = Date.now();
  const cutoff = now - nDays * 86400000;
  const entries = [];
  for (const d of dates) {
    const entry = dayLog[d];
    if (!entry?.errorLog) continue;
    for (const [ref, log] of Object.entries(entry.errorLog)) {
      if (!log || log.at < cutoff) continue;
      const task = (entry.assigned || []).find(t => t.ref === ref);
      entries.push({
        date: d, ref,
        title: task?.title || "Unknown",
        pattern: task?.pattern || "",
        sheet: task?.sheet || "",
        rowIndex: task?.rowIndex ?? null,
        stars: log.stars,
        note: log.note,
        groqQ: log.groqQ,
        at: log.at,
      });
    }
  }
  return entries;
}

// Ask Groq to produce a tailored "what tripped you?" question for this specific
// problem. Falls back to a generic question if Groq fails.
export async function askTailoredQuestion({ title, pattern, difficulty, stars }) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) return { question: `What tripped you on "${title}"?` };

  const system = `You are a staff FDE interviewer helping a student journal their mistakes.
Given a problem they rated LOW confidence on, write ONE specific, tactful question that probes the MOST LIKELY failure mode for that problem's pattern.
Reply with VALID JSON only (no fences): {"question": "..."}

Rules:
- The question should be concrete and specific to the pattern + problem (not generic).
- Max 20 words. Tactful, not accusatory.
- Encourage ONE short honest answer (invariant missed? wrong recursion base? off-by-one?).`;

  const user = `Problem: ${title}
Pattern: ${pattern || "unknown"}${difficulty ? ` · Difficulty: ${difficulty}` : ""}
Student's confidence rating: ${stars}/5

Write a tailored 'what tripped you?' question.`;

  try {
    const res = await callGroqJSON({
      apiKey, system, user, maxTokens: 256, label: "errorlog",
      schemaCheck: (obj) => (typeof obj?.question === "string" && obj.question.trim()) || "question required",
    });
    if (res.ok && res.data?.question) return { question: res.data.question.trim() };
  } catch (_) {}
  return { question: `What tripped you on "${title}"? Was it the invariant, an edge case, or the complexity?` };
}

// Open an in-page overlay prompt tied to a task row.
export async function openErrorLogPrompt(root, dateKey, ref, stars) {
  // Close any existing prompt
  document.querySelectorAll(".elog-scrim").forEach(x => x.remove());

  // Resolve problem metadata from today's assigned
  const day = getDayLog()[dateKey];
  const task = day?.assigned?.find(t => t.ref === ref);
  if (!task) return;

  const scrim = document.createElement("div");
  scrim.className = "elog-scrim";
  scrim.innerHTML = `
    <div class="elog-modal" role="dialog">
      <div class="elog-eyebrow">★ ${stars} · Mistake log</div>
      <div class="elog-q" id="elog-q">Thinking of a good question…</div>
      <input class="elog-input" id="elog-input" type="text" maxlength="240" placeholder="One honest line…" autocomplete="off" />
      <div class="elog-foot">
        <button class="elog-btn ghost" id="elog-skip">Skip</button>
        <button class="elog-btn primary" id="elog-save">Log it</button>
      </div>
    </div>
  `;
  document.body.appendChild(scrim);
  injectStyles();

  const qEl = scrim.querySelector("#elog-q");
  const input = scrim.querySelector("#elog-input");
  const close = () => scrim.remove();

  // Fetch tailored question in parallel (don't block interaction)
  let groqQ = `What tripped you on "${task.title}"?`;
  qEl.textContent = groqQ;
  askTailoredQuestion({
    title: task.title, pattern: task.pattern, difficulty: task.difficulty, stars,
  }).then(({ question }) => {
    groqQ = question;
    qEl.textContent = question;
  }).catch(() => {});

  setTimeout(() => input.focus(), 50);

  scrim.querySelector("#elog-skip").addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  const commit = async () => {
    const note = input.value.trim();
    await logError(dateKey, ref, { stars, note, groqQ });
    close();
  };
  scrim.querySelector("#elog-save").addEventListener("click", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { e.preventDefault(); close(); }
  });
}

function injectStyles() {
  if (document.getElementById("elog-styles")) return;
  const s = document.createElement("style");
  s.id = "elog-styles";
  s.textContent = `
    .elog-scrim { position: fixed; inset: 0; z-index: 1400; background: transparent; display: flex; align-items: center; justify-content: center; padding: 24px; animation: elogFade .2s ease both; }
    @keyframes elogFade { from { opacity: 0; } to { opacity: 1; } }
    .elog-modal { background: var(--paper); border: 1px solid var(--line2); border-radius: 14px; padding: 22px 24px; width: 100%; max-width: 480px; box-shadow: 0 24px 60px rgba(0,0,0,.3); animation: elogPop .22s cubic-bezier(.2,1.2,.3,1) both; }
    @keyframes elogPop { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .elog-eyebrow { font: 700 10.5px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase; color: var(--red); margin-bottom: 14px; }
    .elog-q { font: 600 15px/1.5 var(--font-sans); color: var(--ink); margin-bottom: 14px; min-height: 44px; }
    .elog-input { width: 100%; padding: 12px 14px; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; color: var(--ink); font: 500 14px/1.3 var(--font-sans); outline: none; margin-bottom: 14px; box-sizing: border-box; }
    .elog-input:focus { border-color: var(--ink); }
    .elog-foot { display: flex; justify-content: flex-end; gap: 10px; }
    .elog-btn { padding: 10px 20px; border-radius: 8px; cursor: pointer; font: 600 13px/1 var(--font-sans); border: 1px solid var(--line2); transition: all .18s; background: transparent; color: var(--mut); }
    .elog-btn:hover { color: var(--ink); }
    .elog-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .elog-btn.primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
  `;
  document.head.appendChild(s);
}
