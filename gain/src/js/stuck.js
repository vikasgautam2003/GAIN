// "I'm Stuck" — one rich Groq-generated hint, in a beautiful modal.
// Costs 10% of task bounty (deducted exactly once per task per day).
// Does NOT reveal the solution. Nudges direction only. The student stays
// the one who solves it.

import { getDayLog, updateDayLog, updateWallet, getWallet, secure } from "./store.js";
import { callGroqJSON } from "./groqJson.js";

const HINT_PENALTY_PCT = 0.10;   // 10% off the task's bounty
const DAY_HINT_FLAG = "hintTaken"; // dayLog[date].hintTaken[ref] = true

export async function openStuckHint({ task, dateKey, onConfirm }) {
  injectStyles();
  document.querySelectorAll(".sk-scrim").forEach(s => s.remove());

  const alreadyTaken = Boolean(getDayLog()?.[dateKey]?.[DAY_HINT_FLAG]?.[task.ref]);
  const penalty = Math.max(1, Math.round(task.value * HINT_PENALTY_PCT));
  const newBounty = Math.max(0, task.value - penalty);

  const scrim = document.createElement("div");
  scrim.className = "sk-scrim";
  scrim.innerHTML = `
    <div class="sk-modal" role="dialog" aria-label="I'm Stuck">
      <header class="sk-head">
        <div class="sk-eyebrow">🆘 I'M STUCK</div>
        <h2 class="sk-title">${esc(task.title)}</h2>
        <div class="sk-sub">${esc(task.pattern || "")} ${task.difficulty ? "· " + esc(task.difficulty) : ""}</div>
      </header>
      <div class="sk-body" id="sk-body">
        ${alreadyTaken ? "" : `
          <div class="sk-cost">
            <div class="sk-cost-row">
              <span class="sk-cost-label">The deal</span>
              <span class="sk-cost-value">−₹${penalty} <span class="sk-cost-faint">(10% of ₹${task.value})</span></span>
            </div>
            <p class="sk-cost-note">The hint will nudge direction without revealing the full approach. Think of it as a teammate at your shoulder saying "look here." You still write the code.</p>
            <div class="sk-cost-actions">
              <button class="sk-btn-primary" id="sk-reveal">Reveal the hint · bounty becomes ₹${newBounty}</button>
              <button class="sk-btn-ghost" id="sk-cancel">Keep solving on my own</button>
            </div>
          </div>
        `}
      </div>
      <footer class="sk-foot">
        <span class="sk-foot-tag">Hints never reveal the full solution.</span>
      </footer>
    </div>
  `;
  document.body.appendChild(scrim);

  const close = () => scrim.remove();
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  const escH = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", escH); } };
  document.addEventListener("keydown", escH);
  scrim.querySelector("#sk-cancel")?.addEventListener("click", close);

  if (alreadyTaken) {
    // The hint was already paid for today — just show it again (cached).
    await loadAndShowHint(scrim, task, dateKey, /*deduct*/ false);
    return;
  }

  scrim.querySelector("#sk-reveal")?.addEventListener("click", async () => {
    await loadAndShowHint(scrim, task, dateKey, /*deduct*/ true);
    if (typeof onConfirm === "function") onConfirm(penalty);
  });
}

async function loadAndShowHint(scrim, task, dateKey, deduct) {
  const body = scrim.querySelector("#sk-body");
  body.innerHTML = `
    <div class="sk-loading">
      <div class="sk-loading-dot"></div>
      <div class="sk-loading-dot"></div>
      <div class="sk-loading-dot"></div>
      <div class="sk-loading-label">Finding the right nudge…</div>
    </div>
  `;

  // Deduct the bounty FIRST (so the user doesn't game by killing the modal
  // mid-fetch). Flag it in the day log so re-opens today don't double-charge.
  if (deduct) {
    try {
      const penalty = Math.max(1, Math.round(task.value * HINT_PENALTY_PCT));
      await updateWallet(w => {
        w.earned = Math.max(0, w.earned - penalty);
        w.ledger.push({ date: new Date().toISOString(), type: "stuck-hint", amount: -penalty, label: `Hint: ${task.title}` });
      });
      await updateDayLog(dl => {
        const d = dl[dateKey];
        if (!d) return;
        if (!d[DAY_HINT_FLAG]) d[DAY_HINT_FLAG] = {};
        d[DAY_HINT_FLAG][task.ref] = true;
        // Also lower the task.value on this day so a later complete doesn't re-earn the full amount
        const t = d.assigned.find(x => x.ref === task.ref);
        if (t) t.value = Math.max(0, t.value - penalty);
        if (d.values && d.values[task.ref] != null) d.values[task.ref] = Math.max(0, d.values[task.ref] - penalty);
      });
    } catch (e) {
      console.warn("[stuck] deduct failed", e);
    }
  }

  // Fetch Groq hint
  let hint;
  try {
    hint = await fetchHint(task);
  } catch (err) {
    body.innerHTML = `
      <div class="sk-error">
        <div class="sk-error-tag">⚠ Groq failed</div>
        <p>${esc(err.message || String(err))}</p>
        <p class="sk-error-note">The bounty deduction was still applied — try again or close the modal.</p>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <article class="sk-hint">
      <div class="sk-hint-tag">THE NUDGE</div>
      <h3 class="sk-hint-headline">${esc(hint.headline)}</h3>
      <p class="sk-hint-body">${esc(hint.body)}</p>
      ${hint.lookFor?.length ? `
        <div class="sk-hint-lookfor">
          <div class="sk-hint-lookfor-label">Look specifically for</div>
          <ul>
            ${hint.lookFor.map(x => `<li>${esc(x)}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
      ${hint.doNotLookup ? `
        <div class="sk-hint-dnl">
          <span class="sk-hint-dnl-tag">⚠ DO NOT look up</span>
          <span>${esc(hint.doNotLookup)}</span>
        </div>
      ` : ""}
    </article>
    <div class="sk-cost-note sk-after-note">You still own the solve. Close this and type it from here.</div>
  `;
}

async function fetchHint(task) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key. Add one in Settings → AI butler.");

  const system = `You are a kind, specific interview coach writing a HINT (not a solution) for a student who is stuck on an algorithm or system-design problem. The student has already read the problem. Give them exactly enough to unstick direction — nothing more. Reply with VALID JSON matching this exact shape:

{
  "headline": "ONE short sentence that names the direction without naming the full pattern. Example: 'Think about what stays the same as the window moves.'",
  "body": "2-3 sentences that give MORE substance. Can mention a data structure, an invariant, or a trade-off. Do NOT give a code sketch. Do NOT walk through steps. Address the student directly.",
  "lookFor": ["2-3 bullet points — SPECIFIC things in the problem statement that are the clue (e.g. 'the words contiguous subarray', 'the request for the SMALLEST window', 'the constraint n ≤ 10^5 suggesting O(n log n)')"],
  "doNotLookup": "ONE short piece of guidance about what the student should NOT read right now (e.g. 'The full solution for monotonic stacks — build it from scratch with the hint above')"
}

RULES:
- Return EXACTLY the keys above. No markdown fences.
- NEVER paste code.
- NEVER name a specific algorithm by its canonical name (sliding window, Dijkstra, DP). Give the mechanism instead ("a window that grows and shrinks", "shortest-path tree built greedily by distance").
- Direct second-person voice ("you").`;

  const user = `Problem: ${task.title}
Pattern tag: ${task.pattern || "(none)"}
Difficulty: ${task.difficulty || "(unknown)"}
Kind: ${task.kind}

Give the student a hint. JSON only.`;

  const res = await callGroqJSON({
    apiKey, system, user, maxTokens: 512, label: `stuck:${task.ref}`,
    schemaCheck: (obj) => {
      if (!obj || typeof obj !== "object") return "not an object";
      if (!obj.headline) return "missing headline";
      if (!obj.body) return "missing body";
      return true;
    },
  });
  if (!res.ok) throw new Error(res.error);
  const d = res.data;
  return {
    headline: String(d.headline || "").trim(),
    body: String(d.body || "").trim(),
    lookFor: Array.isArray(d.lookFor) ? d.lookFor.map(x => String(x).trim()).filter(Boolean).slice(0, 4) : [],
    doNotLookup: String(d.doNotLookup || "").trim(),
  };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

function injectStyles() {
  if (document.getElementById("stuck-styles")) return;
  const s = document.createElement("style");
  s.id = "stuck-styles";
  s.textContent = `
    .sk-scrim {
      position: fixed; inset: 0; z-index: 1700;
      background: transparent;
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .sk-modal {
      background: var(--paper); border-radius: 20px;
      width: 100%; max-width: 580px; max-height: 86vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow:
        0 32px 80px rgba(0,0,0,.22),
        0 8px 20px rgba(0,0,0,.08),
        0 0 0 1px var(--line);
      animation: skPop .26s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes skPop { from { opacity: 0; transform: translateY(14px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }

    .sk-head {
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--line);
      background:
        radial-gradient(100% 100% at 0% 0%, color-mix(in oklab, var(--red) 10%, var(--paper)) 0%, var(--paper) 60%);
    }
    .sk-eyebrow {
      font: 700 10.5px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase;
      color: var(--red); margin-bottom: 10px;
    }
    .sk-title { margin: 0 0 4px; font: 600 20px/1.25 var(--font-sans); letter-spacing: -.015em; color: var(--ink); }
    .sk-sub { font: 500 12.5px/1.3 var(--font-sans); color: var(--mut); letter-spacing: .01em; }

    .sk-body { padding: 22px 24px; overflow-y: auto; }

    .sk-cost {
      padding: 16px 18px;
      border: 1px dashed var(--line2); border-radius: 12px;
    }
    .sk-cost-row {
      display: flex; justify-content: space-between; align-items: baseline;
      margin-bottom: 10px;
    }
    .sk-cost-label {
      font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase;
      color: var(--mut);
    }
    .sk-cost-value {
      font: 700 16px/1 var(--font-sans); color: var(--red); letter-spacing: -.015em;
    }
    .sk-cost-faint { color: var(--mut); font-weight: 500; font-size: 12px; }
    .sk-cost-note { font: 500 13px/1.6 var(--font-sans); color: var(--mut); margin: 0 0 14px; }
    .sk-cost-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .sk-btn-primary {
      flex: 1; min-width: 220px;
      padding: 11px 18px; border-radius: 10px;
      background: var(--ink); color: var(--paper); border: none;
      font: 600 13.5px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: filter .14s ease;
    }
    .sk-btn-primary:hover { filter: brightness(1.1); }
    .sk-btn-ghost {
      padding: 11px 18px; border-radius: 10px;
      background: var(--paper); color: var(--mut); border: 1px solid var(--line);
      font: 600 13.5px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: all .14s ease;
    }
    .sk-btn-ghost:hover { color: var(--ink); border-color: var(--line2); }

    .sk-hint { padding: 0; }
    .sk-hint-tag {
      display: inline-block;
      font: 800 10.5px/1 var(--font-sans); letter-spacing: .18em; text-transform: uppercase;
      color: var(--gold); margin-bottom: 10px;
      padding: 4px 9px; border-radius: 5px;
      background: color-mix(in oklab, var(--gold) 14%, var(--paper));
    }
    .sk-hint-headline { margin: 0 0 10px; font: 600 18px/1.4 var(--font-sans); color: var(--ink); letter-spacing: -.012em; }
    .sk-hint-body { font: 500 14.5px/1.65 var(--font-sans); color: var(--ink); margin: 0 0 14px; }
    .sk-hint-lookfor {
      padding: 14px 16px; margin-bottom: 14px;
      background: color-mix(in oklab, var(--blue, #3870ff) 5%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--blue, #3870ff) 20%, var(--line));
      border-left: 3px solid var(--blue, #3870ff);
      border-radius: 10px;
    }
    .sk-hint-lookfor-label {
      font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase;
      color: var(--mut); margin-bottom: 8px;
    }
    .sk-hint-lookfor ul { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
    .sk-hint-lookfor li { font: 500 13px/1.55 var(--font-sans); color: var(--ink); }
    .sk-hint-dnl {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 12px; border-radius: 999px;
      background: color-mix(in oklab, var(--red) 7%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--red) 22%, var(--line));
      font: 500 12.5px/1.3 var(--font-sans); color: var(--ink);
    }
    .sk-hint-dnl-tag { font-weight: 700; color: var(--red); letter-spacing: .04em; }

    .sk-after-note { margin-top: 14px; }

    .sk-loading { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px; }
    .sk-loading-dot {
      width: 10px; height: 10px; border-radius: 50%; background: var(--red);
      animation: skBlink 1s ease-in-out infinite;
    }
    .sk-loading-dot:nth-child(2) { animation-delay: .15s; }
    .sk-loading-dot:nth-child(3) { animation-delay: .3s; }
    @keyframes skBlink { 0%, 100% { opacity: .3; transform: scale(.9); } 50% { opacity: 1; transform: scale(1); } }
    .sk-loading-label { font: 500 13px/1 var(--font-sans); color: var(--mut); margin-top: 4px; }

    .sk-error { padding: 20px; text-align: center; }
    .sk-error-tag {
      display: inline-block; margin-bottom: 10px;
      font: 700 11px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase;
      color: var(--red); padding: 4px 9px; border-radius: 5px;
      background: color-mix(in oklab, var(--red) 10%, var(--paper));
    }
    .sk-error p { color: var(--mut); font: 500 13px/1.6 var(--font-sans); margin: 10px 0; }
    .sk-error-note { font-size: 12px; font-style: italic; }

    .sk-foot {
      padding: 12px 24px 16px; border-top: 1px dashed var(--line);
      font: 500 11.5px/1 var(--font-sans); color: var(--mut); text-align: center;
      letter-spacing: .02em;
    }
  `;
  document.head.appendChild(s);
}
