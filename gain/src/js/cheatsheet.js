// Pattern cheatsheet — the dojo-wall. For a given pattern, Groq generates:
// invariant, canonical skeleton, when-to-reach-for, when-NOT-to (lookalikes),
// 3 traps, 3 gold problems picked from the user's own sheets, one-line
// complexity. Cached forever under `gain:cheatsheet:{slug}` so it never costs
// a second Groq call. Every section is inline-editable; user edits override
// Groq and are persisted the same way.
//
// Mount points:
//   - Mastery pattern-detail modal header (📄 Cheatsheet button)
//   - Problem page sidebar (📄 Pattern cheatsheet)

import { getSheets, secure } from "./store.js";
import { callGroqJSON } from "./groqJson.js";
import { renderMarkdown } from "./info.js";

const CACHE_PREFIX = "gain:cheatsheet:";

function slugify(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function cacheKey(patternName) {
  return CACHE_PREFIX + slugify(patternName);
}

export function getCachedCheatsheet(patternName) {
  try {
    const raw = localStorage.getItem(cacheKey(patternName));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveCheatsheet(patternName, data) {
  try {
    localStorage.setItem(cacheKey(patternName), JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn("[cheatsheet] save failed", e);
    return false;
  }
}

export function deleteCheatsheet(patternName) {
  try { localStorage.removeItem(cacheKey(patternName)); } catch (_) {}
}

// ============ PUBLIC: open the cheatsheet modal ============
export async function openCheatsheet(patternName) {
  if (!patternName || !String(patternName).trim()) return;
  injectStyles();

  // Clean any stale instance
  document.querySelectorAll(".cs-scrim").forEach(s => s.remove());

  const scrim = document.createElement("div");
  scrim.className = "cs-scrim";
  scrim.innerHTML = `
    <div class="cs-modal" role="dialog" aria-label="Cheatsheet">
      <header class="cs-head">
        <div class="cs-head-left">
          <div class="cs-eyebrow">PATTERN CHEATSHEET</div>
          <h2 class="cs-title">${esc(patternName)}</h2>
          <div class="cs-gist" id="cs-gist">Loading…</div>
        </div>
        <div class="cs-head-actions">
          <button class="cs-btn-ghost" id="cs-regen" title="Regenerate from Groq (your edits will be lost)">↻ Regenerate</button>
          <button class="cs-btn-close" id="cs-close" aria-label="Close">×</button>
        </div>
      </header>
      <div class="cs-body" id="cs-body">
        <div class="cs-loading">
          <div class="cs-loading-dot"></div>
          <div class="cs-loading-dot"></div>
          <div class="cs-loading-dot"></div>
          <div class="cs-loading-label">Building your dojo-wall for ${esc(patternName)}…</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(scrim);

  const closeFn = () => { scrim.remove(); };
  scrim.querySelector("#cs-close")?.addEventListener("click", closeFn);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeFn(); });
  const escHandler = (e) => { if (e.key === "Escape") { closeFn(); document.removeEventListener("keydown", escHandler); } };
  document.addEventListener("keydown", escHandler);

  // Load from cache or Groq
  let sheet = getCachedCheatsheet(patternName);
  const needsFetch = !sheet;

  if (needsFetch) {
    try {
      sheet = await fetchCheatsheet(patternName);
      saveCheatsheet(patternName, sheet);
    } catch (err) {
      scrim.querySelector("#cs-body").innerHTML = `
        <div class="cs-error">
          <div class="cs-error-tag">⚠ Groq failed</div>
          <p>${esc(err.message || String(err))}</p>
          <button class="cs-btn-primary" id="cs-retry">Try again</button>
        </div>
      `;
      scrim.querySelector("#cs-retry")?.addEventListener("click", () => { scrim.remove(); openCheatsheet(patternName); });
      return;
    }
  }

  paintCheatsheet(scrim, patternName, sheet);

  // Regenerate button
  scrim.querySelector("#cs-regen")?.addEventListener("click", async () => {
    const { confirmDanger } = await import("./modals.js");
    const ok = await confirmDanger({
      title: `Regenerate "${patternName}" cheatsheet?`,
      message: "Any inline edits you made will be lost. Groq will build a fresh version from scratch.",
      confirmLabel: "Regenerate",
    });
    if (!ok) return;
    deleteCheatsheet(patternName);
    scrim.remove();
    openCheatsheet(patternName);
  });
}

// ============ FETCH ============
async function fetchCheatsheet(patternName) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key. Add one in Settings → AI butler.");

  // Pick 6-10 unsolved problems in this pattern across the user's sheets
  // so Groq can nominate 3 GOLD problems from a real pool, not inventions.
  const pool = collectPatternProblems(patternName).slice(0, 10);
  const poolText = pool.length
    ? pool.map((p, i) => `${i + 1}. ${p.title}${p.lc ? ` (LC ${p.lc})` : ""}${p.difficulty ? ` [${p.difficulty}]` : ""}`).join("\n")
    : "(no problems found in user's sheets — pick 3 classic LC problems for this pattern)";

  const system = `You are a staff FDE interview coach writing a one-page cheatsheet for a pattern. Every field must be CRISP, SPECIFIC, QUOTABLE. The student will read this at 11pm the night before their interview — no padding, no hedge-words. Reply with VALID JSON matching this exact shape (no markdown, no code fences, no preamble):

{
  "oneLineGist": "ONE sentence a student can quote in the interview to introduce this pattern",
  "invariant": "The invariant as a complete sentence a student can quote back. Example: 'After processing index i, the stack holds exactly the indices whose next-greater element has not yet been found.' This is the single most important field — do not write a vague thing.",
  "skeleton": {
    "language": "java",
    "code": "A canonical 10-20 line Java template with // TODO comments where problem-specific logic goes. It must COMPILE as-is after the TODOs are filled. Standard imports are available (java.util.*). class Solution { ... } with a method signature typical for this pattern."
  },
  "whenToReach": ["3 signal phrases from a problem statement that scream 'use this pattern'. Each is a complete sentence. Example: 'When the problem asks for the longest/shortest subarray/substring with a property.'"],
  "whenNotTo": [
    { "lookalike": "Name of a lookalike pattern that fools students", "howToTell": "ONE sentence that lets you distinguish them in the room — specific signal, not generic advice" }
  ],
  "traps": ["3 SPECIFIC bugs this pattern invites — off-by-one, infinite loop, missed empty case. Each starts with the bug name and ends with how to catch it. Not generic 'check edge cases.'"],
  "goldProblems": [
    { "title": "name of the problem", "lc": "the LC number if from the pool, else empty", "why": "ONE sentence on why THIS problem is a 'gold' rep of the pattern — what it uniquely exercises" }
  ],
  "complexity": "ONE sentence with the pattern's canonical complexity + the one-sentence why it beats brute force. Example: 'O(n) because each element is pushed and popped at most once — beats O(n²) brute force that re-scans the window per index.'"
}

RULES:
- Return EXACTLY the keys above. No extras. No missing keys.
- whenNotTo: 2-3 entries.
- traps: EXACTLY 3.
- goldProblems: EXACTLY 3. Prefer problems from the user's pool below (use their LC number). If the pool is empty, pick 3 well-known LC problems for the pattern.
- Code is a FULL Java method, not pseudocode. Correct indentation.
- No sales language, no "it's important to understand" — go straight to the engineering.`;

  const user = `Pattern: ${patternName}

User's unsolved problems in this pattern (choose 3 of these for goldProblems where possible):
${poolText}

Reply as JSON only.`;

  const res = await callGroqJSON({
    apiKey, system, user, maxTokens: 2048, label: `cheatsheet:${slugify(patternName)}`,
    schemaCheck: (obj) => {
      if (!obj || typeof obj !== "object") return "not an object";
      if (!obj.invariant) return "missing invariant";
      if (!obj.skeleton?.code) return "missing skeleton.code";
      if (!Array.isArray(obj.whenToReach) || obj.whenToReach.length < 1) return "whenToReach must be a non-empty array";
      if (!Array.isArray(obj.traps) || obj.traps.length < 1) return "traps must be a non-empty array";
      if (!Array.isArray(obj.goldProblems) || obj.goldProblems.length < 1) return "goldProblems must be a non-empty array";
      return true;
    },
  });
  if (!res.ok) throw new Error(res.error);
  return normalize(res.data);
}

function normalize(d) {
  const str = (v) => String(v || "").trim();
  const arr = (v) => Array.isArray(v) ? v : [];
  return {
    oneLineGist: str(d.oneLineGist),
    invariant: str(d.invariant),
    skeleton: {
      language: str(d.skeleton?.language) || "java",
      code: str(d.skeleton?.code),
    },
    whenToReach: arr(d.whenToReach).map(str).filter(Boolean).slice(0, 5),
    whenNotTo: arr(d.whenNotTo).map(x => ({
      lookalike: str(x?.lookalike),
      howToTell: str(x?.howToTell),
    })).filter(x => x.lookalike || x.howToTell).slice(0, 4),
    traps: arr(d.traps).map(str).filter(Boolean).slice(0, 5),
    goldProblems: arr(d.goldProblems).map(x => ({
      title: str(x?.title),
      lc: str(x?.lc),
      why: str(x?.why),
    })).filter(x => x.title).slice(0, 5),
    complexity: str(d.complexity),
    createdAt: Date.now(),
  };
}

// Collect ALL problems tagged with this pattern across every sheet, so Groq
// can nominate gold-problems from the user's own pool.
function collectPatternProblems(patternName) {
  const sheets = getSheets();
  const out = [];
  for (const [sheetName, sh] of Object.entries(sheets)) {
    if (!sh?.rows?.length || !sh.headers?.length) continue;
    const patternCol = sh.headers.find(h => /^(pattern|category)$/i.test(h));
    const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
    const lcCol = sh.headers.find(h => /^lc#?$/i.test(h));
    const diffCol = sh.headers.find(h => /^difficulty$/i.test(h));
    const statusCol = sh.headers.find(h => /^status$/i.test(h));
    if (!patternCol || !titleCol) continue;
    for (let i = 0; i < sh.rows.length; i++) {
      const r = sh.rows[i];
      if (String(r[patternCol] || "").trim() !== patternName) continue;
      const title = String(r[titleCol] || "").trim();
      if (!title) continue;
      const status = String(r[statusCol] || "").trim().toUpperCase();
      out.push({
        sheetName, rowIndex: i, title,
        lc: lcCol ? String(r[lcCol] || "").trim() : "",
        difficulty: diffCol ? String(r[diffCol] || "").trim() : "",
        solved: /^(SOLVED|DONE)$/.test(status),
      });
    }
  }
  // Prefer unsolved first, then solved — so Groq's pool is biased toward
  // problems the user hasn't done yet.
  out.sort((a, b) => (a.solved ? 1 : 0) - (b.solved ? 1 : 0));
  return out;
}

// ============ PAINT ============
function paintCheatsheet(scrim, patternName, sheet) {
  const gistEl = scrim.querySelector("#cs-gist");
  if (gistEl) gistEl.textContent = sheet.oneLineGist || "The dojo wall for this pattern";

  const body = scrim.querySelector("#cs-body");
  body.innerHTML = `
    <!-- 1. Invariant -->
    <section class="cs-sec cs-invariant">
      <div class="cs-sec-head">
        <span class="cs-sec-num">01</span>
        <h3>The invariant</h3>
        <span class="cs-sec-sub">The one sentence you can quote back</span>
      </div>
      <div class="cs-editable cs-invariant-text" data-field="invariant" contenteditable="true" spellcheck="false">${esc(sheet.invariant)}</div>
    </section>

    <!-- 2. Skeleton -->
    <section class="cs-sec cs-skeleton">
      <div class="cs-sec-head">
        <span class="cs-sec-num">02</span>
        <h3>The skeleton</h3>
        <span class="cs-sec-sub">Canonical template · ${esc(sheet.skeleton.language.toUpperCase())}</span>
        <button class="cs-code-copy" id="cs-code-copy" title="Copy">⧉</button>
      </div>
      <pre class="cs-code"><code class="cs-editable" data-field="skeleton.code" contenteditable="true" spellcheck="false">${esc(sheet.skeleton.code)}</code></pre>
    </section>

    <!-- 3. When to reach for it -->
    <section class="cs-sec cs-when">
      <div class="cs-sec-head">
        <span class="cs-sec-num">03</span>
        <h3>Reach for it when…</h3>
        <span class="cs-sec-sub">Signal phrases from the problem statement</span>
      </div>
      <ul class="cs-signal-list" data-list="whenToReach">
        ${sheet.whenToReach.map((s, i) => `
          <li>
            <span class="cs-signal-dot">▶</span>
            <span class="cs-editable" data-field="whenToReach.${i}" contenteditable="true" spellcheck="false">${esc(s)}</span>
          </li>
        `).join("")}
      </ul>
    </section>

    <!-- 4. When NOT to -->
    ${sheet.whenNotTo.length ? `
      <section class="cs-sec cs-whennot">
        <div class="cs-sec-head">
          <span class="cs-sec-num">04</span>
          <h3>Don't reach for it when…</h3>
          <span class="cs-sec-sub">Lookalikes that fool you + how to tell them apart</span>
        </div>
        <div class="cs-lookalike-list">
          ${sheet.whenNotTo.map((w, i) => `
            <div class="cs-lookalike">
              <div class="cs-lookalike-name"><span class="cs-editable" data-field="whenNotTo.${i}.lookalike" contenteditable="true" spellcheck="false">${esc(w.lookalike)}</span></div>
              <div class="cs-lookalike-tell">↳ <span class="cs-editable" data-field="whenNotTo.${i}.howToTell" contenteditable="true" spellcheck="false">${esc(w.howToTell)}</span></div>
            </div>
          `).join("")}
        </div>
      </section>
    ` : ""}

    <!-- 5. Traps -->
    <section class="cs-sec cs-traps">
      <div class="cs-sec-head">
        <span class="cs-sec-num">05</span>
        <h3>Traps</h3>
        <span class="cs-sec-sub">The bugs this pattern invites</span>
      </div>
      <ul class="cs-trap-list" data-list="traps">
        ${sheet.traps.map((t, i) => `
          <li>
            <span class="cs-trap-icon">⚠</span>
            <span class="cs-editable" data-field="traps.${i}" contenteditable="true" spellcheck="false">${esc(t)}</span>
          </li>
        `).join("")}
      </ul>
    </section>

    <!-- 6. Gold problems -->
    <section class="cs-sec cs-gold">
      <div class="cs-sec-head">
        <span class="cs-sec-num">06</span>
        <h3>Gold problems</h3>
        <span class="cs-sec-sub">Nail these and you own the pattern</span>
      </div>
      <ol class="cs-gold-list">
        ${sheet.goldProblems.map((g, i) => `
          <li>
            <div class="cs-gold-row">
              <div class="cs-gold-left">
                <span class="cs-editable" data-field="goldProblems.${i}.title" contenteditable="true" spellcheck="false">${esc(g.title)}</span>
                ${g.lc ? `<span class="cs-gold-lc">LC ${esc(g.lc)}</span>` : ""}
              </div>
              <div class="cs-gold-why">— <span class="cs-editable" data-field="goldProblems.${i}.why" contenteditable="true" spellcheck="false">${esc(g.why)}</span></div>
            </div>
          </li>
        `).join("")}
      </ol>
    </section>

    <!-- 7. Complexity -->
    <section class="cs-sec cs-complexity">
      <div class="cs-sec-head">
        <span class="cs-sec-num">07</span>
        <h3>Complexity line</h3>
        <span class="cs-sec-sub">What to say when they ask</span>
      </div>
      <div class="cs-editable cs-complexity-text" data-field="complexity" contenteditable="true" spellcheck="false">${esc(sheet.complexity)}</div>
    </section>

    <footer class="cs-foot">
      <span class="cs-foot-tag">Edit inline. Changes save automatically.</span>
      <span class="cs-foot-stamp" id="cs-foot-stamp">cached ${sheet.createdAt ? new Date(sheet.createdAt).toLocaleDateString() : "just now"}</span>
    </footer>
  `;

  // Autosave on blur for every editable field — writes back into the sheet
  // object and persists to localStorage. No save button needed.
  body.querySelectorAll(".cs-editable").forEach(el => {
    el.addEventListener("blur", () => {
      const field = el.dataset.field;
      const value = el.innerText.trim();
      setDeep(sheet, field, value);
      saveCheatsheet(patternName, sheet);
      const stamp = scrim.querySelector("#cs-foot-stamp");
      if (stamp) stamp.textContent = `edited just now`;
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") el.blur();
    });
  });

  // Copy skeleton button
  body.querySelector("#cs-code-copy")?.addEventListener("click", async () => {
    const code = body.querySelector(".cs-code code")?.innerText || "";
    try {
      await navigator.clipboard.writeText(code);
      const btn = body.querySelector("#cs-code-copy");
      btn.textContent = "✓";
      setTimeout(() => { btn.textContent = "⧉"; }, 1200);
    } catch (_) {}
  });
}

// Dot-path setter: setDeep(obj, "a.b.0.c", v) → obj.a.b[0].c = v
function setDeep(obj, path, value) {
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = parts[i + 1];
    if (cur[key] == null) cur[key] = /^\d+$/.test(next) ? [] : {};
    cur = cur[key];
  }
  const last = parts[parts.length - 1];
  cur[last] = value;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

// ============ STYLES ============
function injectStyles() {
  if (document.getElementById("cheatsheet-styles")) return;
  const s = document.createElement("style");
  s.id = "cheatsheet-styles";
  s.textContent = `
    .cs-scrim {
      position: fixed; inset: 0; z-index: 1600;
      background: transparent;
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .cs-modal {
      position: relative;
      background: var(--paper); border-radius: 20px;
      width: 100%; max-width: 820px; max-height: 90vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow:
        0 32px 80px rgba(0,0,0,.22),
        0 8px 20px rgba(0,0,0,.08),
        0 0 0 1px var(--line);
      animation: csPop .26s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes csPop { from { opacity: 0; transform: translateY(14px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }

    .cs-head {
      padding: 22px 26px 18px;
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 14px;
      border-bottom: 1px solid var(--line);
      background:
        radial-gradient(100% 100% at 0% 0%, color-mix(in oklab, var(--gold) 10%, var(--paper)) 0%, var(--paper) 60%);
    }
    .cs-head-left { min-width: 0; flex: 1; }
    .cs-eyebrow {
      font: 700 10.5px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase;
      color: var(--gold); margin-bottom: 10px;
    }
    .cs-title { margin: 0 0 6px; font: 600 24px/1.2 var(--font-sans); letter-spacing: -.02em; color: var(--ink); }
    .cs-gist { font: 500 13px/1.5 var(--font-sans); color: var(--mut); }

    .cs-head-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: flex-start; }
    .cs-btn-ghost {
      padding: 7px 12px; border-radius: 8px; background: var(--paper); border: 1px solid var(--line);
      color: var(--mut); font: 600 11.5px/1 var(--font-sans); cursor: pointer; letter-spacing: .02em;
      transition: all .14s ease;
    }
    .cs-btn-ghost:hover { color: var(--ink); border-color: var(--line2); }
    .cs-btn-close {
      width: 32px; height: 32px; border-radius: 8px;
      background: transparent; border: 1px solid var(--line); color: var(--mut); cursor: pointer;
      font: 400 18px/1 var(--font-sans);
    }
    .cs-btn-close:hover { color: var(--ink); border-color: var(--line2); }

    .cs-body { padding: 24px 26px 10px; overflow-y: auto; }

    .cs-sec { margin-bottom: 22px; }
    .cs-sec:last-of-type { margin-bottom: 10px; }

    .cs-sec-head {
      display: flex; align-items: baseline; gap: 10px;
      margin-bottom: 10px;
      position: relative;
    }
    .cs-sec-num {
      font: 800 10.5px/1 var(--font-sans); letter-spacing: .14em;
      color: var(--gold);
      padding: 4px 7px; border-radius: 5px;
      background: color-mix(in oklab, var(--gold) 14%, var(--paper));
      flex-shrink: 0;
    }
    .cs-sec-head h3 { margin: 0; font: 600 15.5px/1.2 var(--font-sans); color: var(--ink); letter-spacing: -.012em; }
    .cs-sec-sub { font: 500 11.5px/1.3 var(--font-sans); color: var(--mut); letter-spacing: .01em; }

    .cs-editable {
      display: block; width: 100%;
      padding: 6px 8px; margin: -6px -8px;
      border-radius: 6px;
      outline: none;
      transition: background .14s ease, box-shadow .14s ease;
      word-wrap: break-word;
    }
    .cs-editable:hover { background: color-mix(in oklab, var(--ink) 3%, var(--paper)); }
    .cs-editable:focus {
      background: color-mix(in oklab, var(--gold) 6%, var(--paper));
      box-shadow: 0 0 0 2px color-mix(in oklab, var(--gold) 40%, transparent);
    }

    .cs-invariant-text {
      font: 500 15.5px/1.6 var(--font-sans); color: var(--ink); letter-spacing: -.006em;
      padding: 14px 16px !important; margin: 0 !important;
      background: color-mix(in oklab, var(--gold) 7%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--gold) 24%, var(--line));
      border-left: 3px solid var(--gold);
      border-radius: 10px;
    }
    .cs-invariant-text:hover { background: color-mix(in oklab, var(--gold) 10%, var(--paper)); }

    .cs-skeleton { position: relative; }
    .cs-code {
      position: relative;
      background: color-mix(in oklab, var(--ink) 97%, var(--paper));
      color: #e8edf1; border-radius: 10px;
      padding: 16px 18px; margin: 0;
      font: 500 12.5px/1.65 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      overflow-x: auto;
      box-shadow: 0 1px 2px rgba(0,0,0,.08) inset;
    }
    :root[data-theme="dark"] .cs-code { background: #0e1116; }
    .cs-code code { color: inherit; background: transparent; font: inherit; display: block; }
    .cs-code code:hover { background: transparent !important; }
    .cs-code code:focus { background: rgba(255,255,255,.04) !important; box-shadow: none !important; }
    .cs-code-copy {
      position: absolute; right: 10px; top: 2px;
      background: color-mix(in oklab, var(--ink) 20%, transparent); color: #fff;
      border: none; padding: 4px 8px; border-radius: 6px; cursor: pointer;
      font: 500 12px/1 var(--font-sans);
    }
    .cs-code-copy:hover { background: color-mix(in oklab, var(--gold) 60%, var(--ink)); }

    .cs-signal-list, .cs-trap-list {
      list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 8px;
    }
    .cs-signal-list li, .cs-trap-list li {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 10px 12px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 10px;
      font: 500 13.5px/1.55 var(--font-sans); color: var(--ink);
    }
    .cs-signal-dot { color: var(--blue, #3870ff); flex-shrink: 0; font-weight: 700; }
    .cs-trap-list li { border-left: 3px solid var(--red); }
    .cs-trap-icon { color: var(--red); flex-shrink: 0; font-size: 14px; }

    .cs-lookalike-list { display: flex; flex-direction: column; gap: 10px; }
    .cs-lookalike {
      padding: 12px 14px;
      background: color-mix(in oklab, var(--mut) 6%, var(--paper));
      border: 1px solid var(--line); border-radius: 10px;
    }
    .cs-lookalike-name {
      font: 700 13px/1.3 var(--font-sans); color: var(--ink); margin-bottom: 4px;
    }
    .cs-lookalike-tell {
      font: 500 12.5px/1.55 var(--font-sans); color: var(--mut);
    }

    .cs-gold-list { padding-left: 24px; margin: 0; display: flex; flex-direction: column; gap: 12px; }
    .cs-gold-list li::marker { color: var(--gold); font-weight: 800; }
    .cs-gold-row {
      padding: 10px 12px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 10px;
    }
    .cs-gold-left {
      display: flex; align-items: baseline; gap: 10px;
      font: 600 13.5px/1.4 var(--font-sans); color: var(--ink); margin-bottom: 2px;
    }
    .cs-gold-lc {
      font: 700 10.5px/1 var(--font-sans); letter-spacing: .08em;
      padding: 3px 6px; border-radius: 5px;
      background: color-mix(in oklab, var(--blue, #3870ff) 12%, var(--paper));
      color: var(--blue, #3870ff);
    }
    .cs-gold-why { font: 500 12.5px/1.55 var(--font-sans); color: var(--mut); margin-top: 4px; }

    .cs-complexity-text {
      font: 600 14px/1.55 var(--font-sans); color: var(--ink);
      padding: 12px 14px !important; margin: 0 !important;
      background: color-mix(in oklab, var(--blue, #3870ff) 6%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--blue, #3870ff) 22%, var(--line));
      border-left: 3px solid var(--blue, #3870ff);
      border-radius: 10px;
    }

    .cs-foot {
      display: flex; justify-content: space-between; align-items: center;
      padding: 14px 0 6px; border-top: 1px dashed var(--line); margin-top: 10px;
      font: 500 11.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .02em;
    }

    .cs-loading {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 60px 20px;
    }
    .cs-loading-dot {
      width: 10px; height: 10px; border-radius: 50%; background: var(--gold);
      animation: csBlink 1s ease-in-out infinite;
    }
    .cs-loading-dot:nth-child(2) { animation-delay: .15s; }
    .cs-loading-dot:nth-child(3) { animation-delay: .3s; }
    @keyframes csBlink { 0%, 100% { opacity: .3; transform: scale(.9); } 50% { opacity: 1; transform: scale(1); } }
    .cs-loading-label { font: 500 13px/1 var(--font-sans); color: var(--mut); margin-top: 6px; }

    .cs-error {
      padding: 32px; text-align: center;
    }
    .cs-error-tag {
      display: inline-block; margin-bottom: 10px;
      font: 700 11px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase;
      color: var(--red); padding: 4px 9px; border-radius: 5px;
      background: color-mix(in oklab, var(--red) 10%, var(--paper));
    }
    .cs-error p { color: var(--mut); font: 500 13px/1.6 var(--font-sans); margin: 10px 0 20px; }
    .cs-btn-primary {
      padding: 10px 18px; border-radius: 10px;
      background: var(--ink); color: var(--paper); border: none;
      font: 600 13px/1 var(--font-sans); cursor: pointer;
    }
    .cs-btn-primary:hover { filter: brightness(1.1); }

    @media (max-width: 720px) {
      .cs-modal { max-width: 100%; max-height: 100vh; border-radius: 0; }
      .cs-head { padding: 18px 18px 14px; }
      .cs-body { padding: 18px; }
      .cs-head-actions { flex-direction: column; }
    }
  `;
  document.head.appendChild(s);
}
