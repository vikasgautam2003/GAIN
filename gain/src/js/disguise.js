// Disguise drill — real interviews mask the pattern under a product story.
// Groq spins 3 story-mode disguises of a problem; the student reads each,
// names the underlying pattern, then flips to see the answer. The point is
// pattern recognition under narrative — the thing interviews actually test.
//
// Called from:
//   - Lesson modal, after a successful quiz pass (post-mastery drill)
//   - Today, as a scheduled "DISGUISE DRILL" tall-card task

import { secure, getSheets } from "./store.js";
import { callGroqJSON } from "./groqJson.js";

const CACHE_PREFIX = "gain:disguise:";

function cacheKey(context) {
  const slug = `${context.sheetName || ""}#${context.rowIndex ?? "x"}#${context.title || ""}`
    .toLowerCase().replace(/[^a-z0-9#]+/g, "-");
  return CACHE_PREFIX + slug;
}

export function getCachedDisguise(context) {
  try {
    const raw = localStorage.getItem(cacheKey(context));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveDisguise(context, data) {
  try {
    localStorage.setItem(cacheKey(context), JSON.stringify(data));
  } catch (_) {}
}

// ============ PUBLIC ============
export async function openDisguiseDrill(context) {
  injectStyles();
  document.querySelectorAll(".dg-scrim").forEach(s => s.remove());

  const scrim = document.createElement("div");
  scrim.className = "dg-scrim";
  scrim.innerHTML = `
    <div class="dg-modal" role="dialog" aria-label="Disguise drill">
      <header class="dg-head">
        <div class="dg-eyebrow">🎭 DISGUISE DRILL</div>
        <h2 class="dg-title">${esc(context.title)}</h2>
        <div class="dg-sub">${esc(context.pattern || "")} ${context.difficulty ? "· " + esc(context.difficulty) : ""}</div>
        <p class="dg-note">Real interviews mask the pattern inside a product story. For each scene below, name the pattern BEFORE flipping to the answer.</p>
      </header>
      <div class="dg-body" id="dg-body">
        <div class="dg-loading">
          <div class="dg-loading-dot"></div>
          <div class="dg-loading-dot"></div>
          <div class="dg-loading-dot"></div>
          <div class="dg-loading-label">Drafting 3 disguises for ${esc(context.title)}…</div>
        </div>
      </div>
      <footer class="dg-foot">
        <button class="dg-btn-ghost" id="dg-close">Done drilling</button>
      </footer>
    </div>
  `;
  document.body.appendChild(scrim);

  const close = () => scrim.remove();
  scrim.querySelector("#dg-close")?.addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  const escH = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", escH); } };
  document.addEventListener("keydown", escH);

  // Load from cache or Groq
  let data = getCachedDisguise(context);
  if (!data) {
    try {
      data = await fetchDisguises(context);
      saveDisguise(context, data);
    } catch (err) {
      scrim.querySelector("#dg-body").innerHTML = `
        <div class="dg-error">
          <div class="dg-error-tag">⚠ Groq failed</div>
          <p>${esc(err.message || String(err))}</p>
        </div>
      `;
      return;
    }
  }

  paintDisguises(scrim, data);
}

async function fetchDisguises(context) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key. Add one in Settings → AI butler.");

  const system = `You are an interview-prep writer who disguises algorithmic/system-design problems inside product stories, the way real senior-level interviews do. The student has mastered the base problem. Your job: give 3 story-mode scenes that each secretly map to this problem's pattern. The student should NEED to think to realize it's the same pattern underneath.

Reply with VALID JSON matching this exact shape:

{
  "oneLineAbout": "ONE sentence naming the underlying pattern/algorithm the student has already mastered (base pattern name).",
  "disguises": [
    {
      "story": "A 4-6 sentence product narrative with a real-sounding company, feature, and constraint (scale, latency, memory). The student reads this cold and should feel 'this is a totally different problem.' Example: 'A Rocketlane PM is complaining that project search autocomplete lags on accounts with 50K+ records. Latency has crept from 40ms to 220ms over 6 months and the designers want it below 60ms. The field is lower-cased, trimmed, and has to tolerate typos within 1 edit distance. The team shipped a basic ngram index but it's not holding. What would you reach for?' Make the story CONCRETE — real feature, real numbers, real stakeholders.",
      "signal": "The ONE phrase or constraint in the story that is the giveaway — the thing a senior candidate would latch onto. Example: 'tolerate typos within 1 edit distance + 50K records' → trie + Levenshtein beam.",
      "revealedPattern": "The pattern name the base problem represents (same as oneLineAbout). This is the 'answer key' the student sees after they commit.",
      "connectingSentence": "ONE sentence that explains why the story reduces to this pattern. Address the student in second person. Example: 'Edit-distance over a dictionary of 50K words is exactly the trie-with-Levenshtein-walk problem you solved — just dressed as search.'"
    }
  ]
}

RULES:
- Return EXACTLY the keys above.
- disguises: EXACTLY 3 entries.
- No code. No pseudocode. Just prose that could appear in a real interview round.
- Each story names a DIFFERENT company/product so they feel distinct.
- The student has already mastered the base pattern — do NOT re-teach it. The reveal is a short confirmation, not a lesson.
- Do NOT include the pattern name INSIDE the story field. The whole point is that it's disguised.`;

  const user = `Base problem: ${context.title}
Pattern tag: ${context.pattern || "(none specified)"}
Difficulty: ${context.difficulty || "(unknown)"}
Kind: ${context.kind || "dsa"}

Write 3 disguises. JSON only.`;

  const res = await callGroqJSON({
    apiKey, system, user, maxTokens: 2048, label: `disguise:${context.title?.slice(0, 24)}`,
    schemaCheck: (obj) => {
      if (!obj || typeof obj !== "object") return "not an object";
      if (!Array.isArray(obj.disguises) || obj.disguises.length < 2) return "need 2+ disguises";
      for (let i = 0; i < obj.disguises.length; i++) {
        const d = obj.disguises[i];
        if (!d?.story || !d?.revealedPattern) return `disguise ${i+1} malformed`;
      }
      return true;
    },
  });
  if (!res.ok) throw new Error(res.error);

  const d = res.data;
  const str = (v) => String(v || "").trim();
  return {
    oneLineAbout: str(d.oneLineAbout),
    disguises: (Array.isArray(d.disguises) ? d.disguises : []).map(x => ({
      story: str(x?.story),
      signal: str(x?.signal),
      revealedPattern: str(x?.revealedPattern),
      connectingSentence: str(x?.connectingSentence),
    })).filter(x => x.story).slice(0, 3),
    createdAt: Date.now(),
  };
}

function paintDisguises(scrim, data) {
  const body = scrim.querySelector("#dg-body");
  body.innerHTML = `
    ${data.oneLineAbout ? `<div class="dg-about"><span class="dg-about-tag">PATTERN UNDER THE MASK</span><p>${esc(data.oneLineAbout)}</p></div>` : ""}
    <div class="dg-list">
      ${data.disguises.map((d, i) => `
        <article class="dg-card" data-i="${i}">
          <header class="dg-card-head">
            <span class="dg-card-num">SCENE ${i + 1}</span>
            <span class="dg-card-sub">Name the pattern before you flip</span>
          </header>
          <div class="dg-story">${esc(d.story)}</div>
          <div class="dg-reveal" hidden>
            ${d.signal ? `<div class="dg-reveal-block">
              <div class="dg-reveal-label">The giveaway</div>
              <div class="dg-reveal-value">${esc(d.signal)}</div>
            </div>` : ""}
            ${d.revealedPattern ? `<div class="dg-reveal-block">
              <div class="dg-reveal-label">The pattern</div>
              <div class="dg-reveal-value dg-reveal-pattern">${esc(d.revealedPattern)}</div>
            </div>` : ""}
            ${d.connectingSentence ? `<div class="dg-reveal-block">
              <div class="dg-reveal-label">Why</div>
              <div class="dg-reveal-value">${esc(d.connectingSentence)}</div>
            </div>` : ""}
          </div>
          <button class="dg-flip-btn" data-flip="${i}">Flip to reveal →</button>
        </article>
      `).join("")}
    </div>
  `;

  body.querySelectorAll("[data-flip]").forEach(btn => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".dg-card");
      const reveal = card.querySelector(".dg-reveal");
      const isHidden = reveal.hasAttribute("hidden");
      if (isHidden) {
        reveal.removeAttribute("hidden");
        btn.textContent = "↑ Hide reveal";
        card.classList.add("revealed");
      } else {
        reveal.setAttribute("hidden", "");
        btn.textContent = "Flip to reveal →";
        card.classList.remove("revealed");
      }
    });
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

function injectStyles() {
  if (document.getElementById("disguise-styles")) return;
  const s = document.createElement("style");
  s.id = "disguise-styles";
  s.textContent = `
    .dg-scrim {
      position: fixed; inset: 0; z-index: 1650;
      background: transparent;
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .dg-modal {
      background: var(--paper); border-radius: 20px;
      width: 100%; max-width: 760px; max-height: 90vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow:
        0 32px 80px rgba(0,0,0,.22),
        0 8px 20px rgba(0,0,0,.08),
        0 0 0 1px var(--line);
      animation: dgPop .26s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes dgPop { from { opacity: 0; transform: translateY(14px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }

    .dg-head {
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--line);
      background: radial-gradient(100% 100% at 0% 0%, color-mix(in oklab, var(--gold) 10%, var(--paper)) 0%, var(--paper) 60%);
    }
    .dg-eyebrow {
      font: 700 10.5px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase;
      color: var(--gold); margin-bottom: 10px;
    }
    .dg-title { margin: 0 0 4px; font: 600 22px/1.25 var(--font-sans); letter-spacing: -.018em; color: var(--ink); }
    .dg-sub { font: 500 12.5px/1.3 var(--font-sans); color: var(--mut); letter-spacing: .01em; margin-bottom: 10px; }
    .dg-note { font: 500 13px/1.55 var(--font-sans); color: var(--mut); margin: 0; }

    .dg-body { padding: 20px 24px; overflow-y: auto; }

    .dg-about {
      padding: 12px 16px; margin-bottom: 20px;
      background: color-mix(in oklab, var(--gold) 7%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--gold) 22%, var(--line));
      border-left: 3px solid var(--gold);
      border-radius: 10px;
    }
    .dg-about-tag {
      font: 800 10px/1 var(--font-sans); letter-spacing: .18em; text-transform: uppercase;
      color: var(--gold); display: block; margin-bottom: 6px;
    }
    .dg-about p { margin: 0; font: 600 14.5px/1.5 var(--font-sans); color: var(--ink); letter-spacing: -.006em; }

    .dg-list { display: flex; flex-direction: column; gap: 14px; }
    .dg-card {
      padding: 16px 18px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 14px;
      transition: box-shadow .18s ease, border-color .18s ease;
    }
    .dg-card.revealed {
      border-color: color-mix(in oklab, var(--gold) 30%, var(--line));
      box-shadow: 0 4px 14px -6px color-mix(in oklab, var(--gold) 40%, transparent);
    }
    .dg-card-head {
      display: flex; justify-content: space-between; align-items: baseline;
      margin-bottom: 10px;
    }
    .dg-card-num {
      font: 800 10.5px/1 var(--font-sans); letter-spacing: .18em;
      color: var(--gold);
      padding: 4px 8px; border-radius: 5px;
      background: color-mix(in oklab, var(--gold) 14%, var(--paper));
    }
    .dg-card-sub { font: 500 11.5px/1.3 var(--font-sans); color: var(--mut); }

    .dg-story { font: 500 14px/1.65 var(--font-sans); color: var(--ink); margin-bottom: 14px; }

    .dg-reveal { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
    .dg-reveal-block {
      padding: 10px 12px; border-radius: 10px;
      background: color-mix(in oklab, var(--mut) 6%, var(--paper));
      border-left: 2px solid color-mix(in oklab, var(--ink) 60%, var(--mut));
    }
    .dg-reveal-label {
      font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase;
      color: var(--mut); margin-bottom: 4px;
    }
    .dg-reveal-value { font: 500 13.5px/1.55 var(--font-sans); color: var(--ink); }
    .dg-reveal-pattern { font-weight: 700; color: var(--gold); }

    .dg-flip-btn {
      width: 100%;
      padding: 10px 14px; border-radius: 10px;
      background: var(--paper); color: var(--ink); border: 1px solid var(--line);
      font: 600 12.5px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: all .14s ease;
    }
    .dg-flip-btn:hover { background: color-mix(in oklab, var(--ink) 4%, var(--paper)); border-color: var(--line2); }
    .dg-card.revealed .dg-flip-btn { background: color-mix(in oklab, var(--gold) 10%, var(--paper)); border-color: color-mix(in oklab, var(--gold) 30%, var(--line)); color: var(--ink); }

    .dg-foot {
      padding: 14px 24px; border-top: 1px solid var(--line);
      display: flex; justify-content: flex-end; gap: 10px;
    }
    .dg-btn-ghost {
      padding: 10px 18px; border-radius: 10px;
      background: var(--ink); color: var(--paper); border: none;
      font: 600 12.5px/1 var(--font-sans); cursor: pointer;
    }
    .dg-btn-ghost:hover { filter: brightness(1.1); }

    .dg-loading { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 50px; }
    .dg-loading-dot {
      width: 10px; height: 10px; border-radius: 50%; background: var(--gold);
      animation: dgBlink 1s ease-in-out infinite;
    }
    .dg-loading-dot:nth-child(2) { animation-delay: .15s; }
    .dg-loading-dot:nth-child(3) { animation-delay: .3s; }
    @keyframes dgBlink { 0%, 100% { opacity: .3; transform: scale(.9); } 50% { opacity: 1; transform: scale(1); } }
    .dg-loading-label { font: 500 13px/1 var(--font-sans); color: var(--mut); margin-top: 4px; }

    .dg-error { padding: 30px; text-align: center; }
    .dg-error-tag {
      display: inline-block; margin-bottom: 10px;
      font: 700 11px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase;
      color: var(--red); padding: 4px 9px; border-radius: 5px;
      background: color-mix(in oklab, var(--red) 10%, var(--paper));
    }
    .dg-error p { color: var(--mut); font: 500 13px/1.6 var(--font-sans); margin: 10px 0; }
  `;
  document.head.appendChild(s);
}
