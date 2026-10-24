// Reusable info popover — a small "?" icon that pops a titled card with 2-3
// lines of explanation. Click to open, click outside to close. Used wherever a
// feature's behavior isn't self-evident ("sharp vs shaky calibration", "↘ shaky
// pattern trend", "why peeking drops bounty", etc.)
//
// Public API:
//   infoIcon({ title, body, bullets? }) → HTML string that can be inlined
//   openGlossaryModal()                  → full glossary modal, lists everything

const INFO_POPOVER_ID = "info-pop";

export function infoIcon({ title, body, bullets }) {
  const payload = encodeURIComponent(JSON.stringify({ title, body, bullets: bullets || [] }));
  return `<button class="info-ic" data-info="${payload}" aria-label="What's this?" title="What's this?">?</button>`;
}

// Attach global delegated click handler once per boot.
let bound = false;
export function wireInfoPopovers() {
  if (bound) return;
  bound = true;
  injectStyles();
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-info]");
    const existing = document.getElementById(INFO_POPOVER_ID);
    if (btn) {
      e.preventDefault(); e.stopPropagation();
      // Toggle: if same button already opened the popover, close it.
      if (existing && existing.dataset.anchor === btn.dataset.info) {
        existing.remove(); return;
      }
      if (existing) existing.remove();
      let payload;
      try { payload = JSON.parse(decodeURIComponent(btn.dataset.info)); } catch { return; }
      const pop = buildPopover(payload, btn);
      document.body.appendChild(pop);
      // Position after insert so we can measure.
      positionPopover(pop, btn);
      return;
    }
    // Click outside — close if popover is open and click wasn't inside it.
    if (existing && !e.target.closest(`#${INFO_POPOVER_ID}`)) existing.remove();
  });
  // Esc closes.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.getElementById(INFO_POPOVER_ID)?.remove();
  });
}

function buildPopover({ title, body, bullets }, anchor) {
  const pop = document.createElement("div");
  pop.id = INFO_POPOVER_ID;
  pop.className = "info-pop";
  pop.dataset.anchor = anchor.dataset.info;
  pop.innerHTML = `
    <div class="ip-head">
      <span class="ip-ic">ⓘ</span>
      <h4>${esc(title)}</h4>
    </div>
    <p class="ip-body">${esc(body)}</p>
    ${Array.isArray(bullets) && bullets.length ? `
      <ul class="ip-bullets">
        ${bullets.map(b => `<li>${esc(b)}</li>`).join("")}
      </ul>
    ` : ""}
  `;
  return pop;
}

function positionPopover(pop, anchor) {
  const ar = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Default: below + right of anchor
  let top = ar.bottom + 6;
  let left = ar.left - 10;
  // Flip up if not enough space below
  if (top + pr.height > vh - 16) top = ar.top - pr.height - 6;
  // Keep inside viewport horizontally
  left = Math.max(16, Math.min(left, vw - pr.width - 16));
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

// ----- Glossary modal -----
// Lists every feature with its explanation. Lives in Settings → "What's this?" button.

const GLOSSARY = [
  {
    section: "Study loop",
    items: [
      { title: "Confidence stars (★ 1-5)", body: "You must rate every solved problem 1-5 stars after ticking. ★ 1 = shaky, ★ 5 = mastered. This drives spaced-repetition, the pattern mastery dashboard, and the calibration tile. Required, not optional." },
      { title: "Blocked / Review-override chips", body: "Right after rating, a strip lets you override spaced-rep: Default (use ★), Tomorrow, In 3 days, Mastered. Even a ★ 5 will revisit tomorrow if you pick 'Tomorrow'. Use when you got stuck but still want to lock the memory in." },
      { title: "✦ Peek the pattern", body: "On a Problem page, reveals the pattern name only — no code, no hints beyond that. Your bounty drops to the minimum (₹10 default) and the ledger flags the solve as 'peeked' so your calibration data stays honest." },
      { title: "↻ REDO rows (spaced-repetition)", body: "Low-confidence solves auto-return at ★1 → 1 day, ★2 → 3 days, ★3 → 7 days. ★4/5 skip unless you set a review override. Always at least one REDO per day — if nothing's technically due, the weakest-confidence row is promoted." },
      { title: "Warm-up quiz", body: "First row of every day. 5 Groq-generated questions based on yesterday's solves (or this week's pattern theme if yesterday was a rest day). Hint/Reveal are lazy per Q so you only pay Groq when you ask." },
      { title: "⏱ Session timer", body: "Click the ▶ chip on any study row to start, click again to pause. Writes real focused minutes to dayLog.timeOnTask. Auto-pauses when the task is ticked done. 'Fully manual' means it won't pause when you switch tabs — reflects reality." },
    ],
  },
  {
    section: "Measurement",
    items: [
      { title: "Self-rating calibration %", body: "How well your ★ ratings predict re-solve performance. Compares the first ★ rating of a row to its latest ★ rating. Drift of 0 = perfect; drift of 4 = badly over/under-rating.", bullets: [
        "85% or above = sharp (trust your gut)",
        "70-84% = solid (within interview-day confidence)",
        "55-69% = noisy (you miscalibrate under pressure)",
        "below 55% = shaky (over-rate hard, under-prepare)",
      ]},
      { title: "Pattern mastery", body: "Per-pattern confidence average + solve coverage, with a trend arrow comparing your last 5 ratings on that pattern vs the prior 5. Weakest first.", bullets: [
        "↗ rising = last 5 avg >0.4 ★ higher than prior 5",
        "→ steady = within 0.4 ★ of prior 5",
        "↘ shaky = last 5 avg >0.4 ★ lower than prior 5 (red-tinted row)",
      ]},
      { title: "Pace (per week · last 4w)", body: "Problems solved per week across all sheets. If you have <7 days of data, pace is divided by a 1-week floor so a burst doesn't extrapolate to a wild number. Shows 'early signal' tag when <7 days." },
      { title: "The chain (365-day heatmap)", body: "Red = you had tasks assigned but didn't finish any (missed day). Light-to-deep green = partial-to-full solve. Gray = no plan assigned (pre-user era or weekend). Lives on Progress now, below the Readiness tiles." },
    ],
  },
  {
    section: "Day rhythm",
    items: [
      { title: "7 PM IST rollover", body: "GAIN 'today' ends at 19:00 IST, not local midnight. Finish before then or the day isn't banked for the streak. Chip in the topbar and the plan heading live-updates every 30s." },
      { title: "Streak-at-risk banner", body: "Fires above the plan when < 2h to rollover AND you have undone tasks. Gold at > 30 min, red pulse at < 30 min. The 'Focus next task →' button scrolls + focuses the first undone row." },
      { title: "Working-ahead banner + Undo last tick", body: "When you tick the last task, your view auto-advances to tomorrow's plan. The banner has 'Undo last tick' — click to un-tick the most recent task on today's calendar day. Refunds coins, clears confidence, returns to today." },
      { title: "📅 History popup", body: "Click the calendar icon next to 'Today's plan' to jump to any past day with a plan. Lets you un-tick a past mistake, rate retroactively, or review what you did." },
    ],
  },
  {
    section: "Library + Shop",
    items: [
      { title: "+ Add hub (Library)", body: "One button opens a picker modal with 4 options: Add row / Append rows / Replace sheet / New sheet. Each routes to the correct flow. Replace is danger-confirmed." },
      { title: "+ Add hub (Shop)", body: "Add reward / Append CSV / Replace catalog. Append and Replace route through the Rust SerpAPI proxy to avoid CORS." },
      { title: "✦ Learn this topic", body: "Groq-generated structured lesson per problem: gist, 6 sections, toolkit (structures + algorithms), 2 inline SerpAPI diagrams, 1 YouTube explainer with error-153 fallback. Cached forever per sheet row." },
      { title: "✦ Suggest another task", body: "Below the plan rows. Groq picks ONE unsolved problem from the matching sheet, boosted toward this week's theme and your weakest pattern. Shows a 'Why this one' rationale. Glows gold when today's plan is 100% done." },
    ],
  },
];

export function openGlossaryModal() {
  document.querySelectorAll(".glossary-scrim").forEach(m => m.remove());
  const scrim = document.createElement("div");
  scrim.className = "glossary-scrim";
  scrim.innerHTML = `
    <div class="glossary-modal" role="dialog" aria-label="Glossary">
      <header>
        <div>
          <div class="gl-eyebrow">GLOSSARY</div>
          <h2>What everything means</h2>
        </div>
        <button class="gl-close" aria-label="Close">✕</button>
      </header>
      <div class="gl-body">
        ${GLOSSARY.map(group => `
          <section class="gl-group">
            <h3>${esc(group.section)}</h3>
            ${group.items.map(it => `
              <article class="gl-item">
                <div class="gl-item-h">${esc(it.title)}</div>
                <p>${esc(it.body)}</p>
                ${it.bullets?.length ? `<ul>${it.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
              </article>
            `).join("")}
          </section>
        `).join("")}
      </div>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.style.overflow = "hidden";
  const close = () => { document.body.style.overflow = ""; scrim.remove(); };
  scrim.querySelector(".gl-close").addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }
  )[c]);
}

function injectStyles() {
  if (document.getElementById("info-styles")) return;
  const style = document.createElement("style");
  style.id = "info-styles";
  style.textContent = `
    .info-ic {
      display: inline-flex; align-items: center; justify-content: center;
      width: 15px; height: 15px; padding: 0;
      margin-left: 6px; vertical-align: middle;
      background: color-mix(in oklab, var(--mut) 14%, transparent);
      border: 1px solid transparent; color: var(--mut);
      border-radius: 50%; cursor: pointer;
      font: 700 10px/1 var(--font-sans);
      transition: all .18s;
    }
    .info-ic:hover { color: var(--ink); background: color-mix(in oklab, var(--ink) 10%, transparent); transform: scale(1.08); }

    .info-pop {
      position: fixed; z-index: 1600;
      max-width: 320px; min-width: 220px;
      background: var(--paper); border: 1px solid var(--line);
      border-radius: 12px; padding: 14px 16px;
      box-shadow: 0 16px 44px rgba(0,0,0,.16);
      animation: ipFade 180ms cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes ipFade {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .info-pop .ip-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
    .info-pop .ip-ic { color: var(--gold); font-size: 13px; }
    .info-pop h4 { margin: 0; font-size: 13px; font-weight: 700; color: var(--ink); letter-spacing: -.005em; }
    .info-pop .ip-body { margin: 0 0 6px; font-size: 12.5px; line-height: 1.55; color: var(--ink); }
    .info-pop .ip-bullets { margin: 0; padding-left: 14px; }
    .info-pop .ip-bullets li { font-size: 12px; line-height: 1.55; color: var(--mut); padding: 2px 0; }
    .info-pop .ip-bullets li::marker { color: var(--gold); }

    /* --- Glossary modal --- */
    .glossary-scrim {
      position: fixed; inset: 0; z-index: 1300;
      background: rgba(8,10,14,.66);
      backdrop-filter: blur(10px) saturate(140%);
      -webkit-backdrop-filter: blur(10px) saturate(140%);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: ipFade 220ms ease both;
    }
    .glossary-modal {
      background: var(--paper); border-radius: 20px;
      width: 100%; max-width: 720px; max-height: 90vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 32px 80px rgba(0,0,0,.4), 0 0 0 1px var(--line);
      animation: ipFade 240ms cubic-bezier(.2,1.2,.3,1) both;
    }
    .glossary-modal header {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 22px 26px 16px; border-bottom: 1px solid var(--line);
    }
    .glossary-modal .gl-eyebrow { font-size: 10.5px; letter-spacing: .14em; font-weight: 700; color: var(--gold); text-transform: uppercase; margin-bottom: 4px; }
    .glossary-modal h2 { margin: 0; font-size: 20px; font-weight: 700; color: var(--ink); letter-spacing: -.015em; }
    .glossary-modal .gl-close {
      border: none; background: transparent; cursor: pointer; color: var(--mut);
      width: 32px; height: 32px; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center;
      font: 400 18px/1 var(--font-sans);
      transition: all .18s;
    }
    .glossary-modal .gl-close:hover { background: var(--bg); color: var(--ink); }
    .glossary-modal .gl-body { padding: 20px 26px; overflow-y: auto; }
    .glossary-modal .gl-group { margin-bottom: 24px; }
    .glossary-modal .gl-group h3 {
      margin: 0 0 12px; font-size: 11px; font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase; color: var(--mut);
      padding-bottom: 8px; border-bottom: 1px solid var(--line);
    }
    .glossary-modal .gl-item {
      padding: 12px 14px; margin-bottom: 8px;
      background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
    }
    .glossary-modal .gl-item-h {
      font-size: 13.5px; font-weight: 700; color: var(--ink); margin-bottom: 6px;
    }
    .glossary-modal .gl-item p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--ink); }
    .glossary-modal .gl-item ul { margin: 8px 0 0; padding-left: 18px; }
    .glossary-modal .gl-item ul li { font-size: 12.5px; line-height: 1.55; color: var(--mut); padding: 2px 0; }
  `;
  document.head.appendChild(style);
}
