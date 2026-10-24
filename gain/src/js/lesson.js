// Lesson modal — Groq-powered "Teach me this topic" surface.
// Section = {setup paragraph + bullet points}. Final "Toolkit" section lists
// the exact data structures + algorithms you'll reach for. Optional 2 inline
// images via SerpAPI (user adds key in Settings).
// Groq fires only on explicit click. Cached per sheet row forever.

import { getSheets, callGrok, serpSearch, secure, updateSheetRow } from "./store.js";

const CACHE_PREFIX = "gain:lesson:";
const IMG_CACHE_PREFIX = "gain:lessonImg:";

// Section titles by kind (prompt forces exact match).
const SCHEMAS = {
  dsa: [
    "What's being tested",
    "Recognize the pattern",
    "The logic (algorithmic narrative)",
    "Why it works (the invariant)",
    "Real-world where this appears",
    "Pitfalls & edge cases",
  ],
  sql: [
    "The concept being tested",
    "SQL mental model",
    "Syntax keywords you'll reach for",
    "Example query shape (not the full solution)",
    "Pitfalls (NULL, performance, cardinality)",
    "Where this shape shows up in production",
  ],
  sd: [
    "The problem this concept solves",
    "Real-world setting (with scale)",
    "Mental model (one picture)",
    "How it works",
    "When to use / when to avoid",
    "Interview framing (how to bring it up)",
  ],
  int: [
    "What this is for",
    "When you'd reach for it on the job",
    "Core model (events / webhooks / OAuth / batch)",
    "Trade-offs vs. common alternatives",
    "The 20% that covers 80% of interview questions",
  ],
  ext: [
    "What this is really assessing",
    "The STAR frame to use",
    "A concrete example angle",
    "Common follow-up probes",
    "One phrase worth practicing",
  ],
};

const KIND_LABEL = {
  dsa: "DSA problem",
  sql: "SQL problem",
  sd: "System Design",
  int: "Integration / platform",
  ext: "Interview extra",
};

// -------- public: open the lesson modal --------
export async function openLessonModal({ sheetName, rowIndex }) {
  const sheets = getSheets();
  const sheet = sheets[sheetName];
  if (!sheet) return;
  const row = sheet.rows[rowIndex];
  if (!row) return;

  const kind = inferKind(sheet, sheetName);
  const title = extractTitle(sheet, row);
  const subtitle = extractSubtitle(sheet, row, kind);
  const schema = SCHEMAS[kind] || SCHEMAS.dsa;
  const cacheKey = CACHE_PREFIX + `${sheetName}#${rowIndex}`;

  document.querySelectorAll(".lsn-scrim").forEach(m => m.remove());

  const scrim = document.createElement("div");
  scrim.className = "lsn-scrim";
  scrim.innerHTML = `
    <div class="lsn-modal" role="dialog" aria-label="Lesson">
      <header class="lsn-head">
        <div class="lsn-head-main">
          <div class="lsn-kind">${esc(KIND_LABEL[kind] || "Topic")}</div>
          <h2 class="lsn-title">${esc(title)}</h2>
          ${subtitle ? `<div class="lsn-sub">${esc(subtitle)}</div>` : ""}
        </div>
        <div class="lsn-head-actions">
          <button class="lsn-expand" id="lsn-expand" aria-label="Toggle fullscreen" title="Fullscreen (f)">
            <span class="lsn-expand-ic">⛶</span>
          </button>
          <button class="lsn-close" aria-label="Close">✕</button>
        </div>
      </header>
      <div class="lsn-body" id="lsn-body"></div>
      <footer class="lsn-foot" id="lsn-foot" hidden>
        <button class="lsn-btn ghost" id="lsn-save">💾 Save to Notes</button>
        <div style="flex:1"></div>
        <button class="lsn-btn ghost" id="lsn-regen">↻ Regenerate</button>
        <button class="lsn-btn primary" id="lsn-close-done">Close</button>
      </footer>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.style.overflow = "hidden";

  const close = () => {
    document.body.style.overflow = "";
    document.removeEventListener("keydown", keyHandler);
    scrim.remove();
  };
  scrim.querySelector(".lsn-close").addEventListener("click", close);
  scrim.querySelector("#lsn-close-done")?.addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });

  // Fullscreen toggle — click or press "f"
  const toggleFullscreen = () => {
    const modal = scrim.querySelector(".lsn-modal");
    modal.classList.toggle("fullscreen");
    const expanded = modal.classList.contains("fullscreen");
    const btn = scrim.querySelector("#lsn-expand");
    if (btn) {
      btn.querySelector(".lsn-expand-ic").textContent = expanded ? "⛊" : "⛶";
      btn.title = expanded ? "Exit fullscreen (f)" : "Fullscreen (f)";
    }
  };
  scrim.querySelector("#lsn-expand").addEventListener("click", toggleFullscreen);
  const keyHandler = (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFullscreen(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };
  document.addEventListener("keydown", keyHandler);

  let cached = null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) cached = JSON.parse(raw);
  } catch (_) {}

  if (cached && cached.sections?.length) {
    paintLesson(scrim, cached, { sheetName, rowIndex });
    wireActions(scrim, { sheetName, rowIndex, kind, title, schema, cacheKey, close });
  } else {
    paintGate(scrim, { kind, title, subtitle, onGenerate: async () => {
      try {
        paintLoading(scrim);
        const lesson = await fetchLesson({ kind, title, subtitle, row, schema });
        try { localStorage.setItem(cacheKey, JSON.stringify(lesson)); } catch (_) {}
        paintLesson(scrim, lesson, { sheetName, rowIndex });
        wireActions(scrim, { sheetName, rowIndex, kind, title, schema, cacheKey, close });
      } catch (e) {
        paintError(scrim, e.message || String(e));
      }
    }});
  }
}

// -------- rendering --------
function paintGate(scrim, { kind, title, subtitle, onGenerate }) {
  const body = scrim.querySelector("#lsn-body");
  body.innerHTML = `
    <div class="lsn-gate">
      <div class="lsn-gate-ico">✦</div>
      <div class="lsn-gate-title">Learn ${esc(title)}</div>
      <div class="lsn-gate-sub">${esc(subtitle || KIND_LABEL[kind])}</div>
      <div class="lsn-gate-pitch">
        A structured mini-lesson with a short intro per section and point-form detail.
        Finishes with the exact <b>data structures &amp; algorithms</b> you'll reach for.
        Optional inline diagrams via SerpAPI (add key in Settings).
      </div>
      <button class="lsn-btn primary lsn-gate-cta" id="lsn-generate">✦ Generate lesson</button>
      <div class="lsn-gate-note">One Groq call. Cached forever on this device — reopening is free.</div>
    </div>
  `;
  const foot = scrim.querySelector("#lsn-foot");
  if (foot) foot.hidden = true;
  body.querySelector("#lsn-generate").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Asking Groq…";
    await onGenerate();
  });
}

function paintLoading(scrim) {
  const body = scrim.querySelector("#lsn-body");
  body.innerHTML = `
    <div class="lsn-loading">
      ${[1,2,3,4].map(() => `
        <div class="lsn-skel-sec">
          <div class="skel-h"></div>
          <div class="skel-line"></div>
          <div class="skel-line"></div>
          <div class="skel-line short"></div>
        </div>
      `).join("")}
    </div>
  `;
}

function paintLesson(scrim, lesson, { sheetName, rowIndex }) {
  const body = scrim.querySelector("#lsn-body");
  const sections = Array.isArray(lesson.sections) ? lesson.sections : [];
  const imageQueries = Array.isArray(lesson.imageQueries) ? lesson.imageQueries : [];
  const toolkit = lesson.toolkit || null;

  // Build HTML. Image slots live where imageQueries say.
  const html = [];
  if (lesson.oneLineGist) {
    html.push(`
      <div class="lsn-gist">
        <span class="lsn-gist-tag">GIST</span>
        <span>${esc(lesson.oneLineGist)}</span>
      </div>
    `);
  }

  for (const s of sections) {
    html.push(`
      <section class="lsn-sec">
        <h3>${esc(s.title || "")}</h3>
        ${s.setup ? `<p class="lsn-setup">${esc(s.setup)}</p>` : ""}
        ${Array.isArray(s.bullets) && s.bullets.length ? `
          <ul class="lsn-bullets">
            ${s.bullets.map(b => `<li>${renderInline(b)}</li>`).join("")}
          </ul>
        ` : ""}
      </section>
    `);
    // Image slot after this section if any imageQuery targets it
    const match = imageQueries.find(q => normalize(q.afterSection) === normalize(s.title));
    if (match) {
      html.push(`<figure class="lsn-img" data-q="${esc(match.query)}" data-after="${esc(s.title || "")}">
        <div class="lsn-img-slot"><span class="lsn-img-skel"></span></div>
        <figcaption>${esc(match.query)}</figcaption>
      </figure>`);
    }
  }

  // YouTube video — one carefully-picked explainer, placed just before Toolkit.
  if (lesson.youtubeQuery) {
    html.push(`
      <section class="lsn-sec lsn-video" data-q="${esc(lesson.youtubeQuery)}">
        <h3><span class="lsn-vid-ico">▶</span>Watch it explained</h3>
        <p class="lsn-setup">Groq picked the search query most likely to surface a tight concise walkthrough.</p>
        <div class="lsn-vid-wrap">
          <div class="lsn-vid-slot" id="lsn-vid-slot">
            <div class="lsn-vid-skel"><span></span><span></span><span></span></div>
            <div class="lsn-vid-query">${esc(lesson.youtubeQuery)}</div>
          </div>
        </div>
      </section>
    `);
  }

  // Toolkit — pinned final section
  if (toolkit) {
    const structures = Array.isArray(toolkit.structures) ? toolkit.structures : [];
    const algorithms = Array.isArray(toolkit.algorithms) ? toolkit.algorithms : [];
    html.push(`
      <section class="lsn-sec lsn-toolkit">
        <h3><span class="lsn-tk-ico">🧰</span>Toolkit — use these for this shape</h3>
        ${toolkit.setup ? `<p class="lsn-setup">${esc(toolkit.setup)}</p>` : ""}
        <div class="lsn-tk-grid">
          ${structures.length ? `
            <div class="lsn-tk-group">
              <div class="lsn-tk-label">Data structures</div>
              <ul>
                ${structures.map(it => `<li><b>${esc(it.name || "")}</b> — ${esc(it.why || "")}</li>`).join("")}
              </ul>
            </div>
          ` : ""}
          ${algorithms.length ? `
            <div class="lsn-tk-group">
              <div class="lsn-tk-label">Algorithms / techniques</div>
              <ul>
                ${algorithms.map(it => `<li><b>${esc(it.name || "")}</b> — ${esc(it.why || "")}</li>`).join("")}
              </ul>
            </div>
          ` : ""}
        </div>
      </section>
    `);
  }

  body.innerHTML = html.join("");
  const foot = scrim.querySelector("#lsn-foot");
  if (foot) foot.hidden = false;

  // Fire-and-forget: lesson stays visible with skeleton slots; media drops in
  // as each SerpAPI call resolves. Image fetches are parallel via Promise.all.
  Promise.resolve()
    .then(() => resolveMedia(scrim, { imageQueries, youtubeQuery: lesson.youtubeQuery }))
    .catch(err => console.warn("[lesson] media resolve failed:", err));
}

function paintError(scrim, msg) {
  const body = scrim.querySelector("#lsn-body");
  body.innerHTML = `
    <div class="lsn-err">
      <b>Couldn't fetch lesson.</b>
      <p>${esc(msg)}</p>
      <button class="lsn-btn ghost" id="lsn-retry">Try again</button>
    </div>
  `;
  body.querySelector("#lsn-retry")?.addEventListener("click", () => {
    scrim.remove();
    document.body.style.overflow = "";
  });
}

function wireActions(scrim, { sheetName, rowIndex, kind, title, schema, cacheKey, close }) {
  const regen = scrim.querySelector("#lsn-regen");
  const save = scrim.querySelector("#lsn-save");
  regen?.addEventListener("click", async () => {
    const sheet = getSheets()[sheetName];
    if (!sheet) return;
    const row = sheet.rows[rowIndex];
    if (!row) return;
    const subtitle = extractSubtitle(sheet, row, kind);
    regen.disabled = true;
    const original = regen.textContent;
    regen.textContent = "Thinking…";
    paintLoading(scrim);
    try {
      const lesson = await fetchLesson({ kind, title, subtitle, row, schema });
      try { localStorage.setItem(cacheKey, JSON.stringify(lesson)); } catch (_) {}
      paintLesson(scrim, lesson, { sheetName, rowIndex });
    } catch (e) {
      paintError(scrim, e.message || String(e));
    } finally {
      regen.disabled = false;
      regen.textContent = original;
    }
  });

  save?.addEventListener("click", async () => {
    const sheet = getSheets()[sheetName];
    if (!sheet) return;
    const notesCol = sheet.headers.find(h => /^notes$/i.test(h));
    if (!notesCol) {
      save.textContent = "No Notes column";
      setTimeout(() => { save.textContent = "💾 Save to Notes"; }, 1600);
      return;
    }
    const lesson = (() => { try { return JSON.parse(localStorage.getItem(cacheKey)); } catch { return null; }})();
    if (!lesson) return;
    const text = lessonToMarkdown(lesson, title);
    const existing = String(sheet.rows[rowIndex][notesCol] || "").trim();
    const merged = existing ? existing + "\n\n--- lesson ---\n\n" + text : text;
    await updateSheetRow(sheetName, rowIndex, { [notesCol]: merged });
    save.textContent = "✓ Saved to Notes";
    setTimeout(() => { save.textContent = "💾 Save to Notes"; }, 1800);
  });
}

function renderInline(text) {
  // Allow single "**bold**" markdown markers in bullets; keep everything else escaped.
  let out = esc(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  return out;
}

function normalize(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function lessonToMarkdown(lesson, title) {
  const lines = [];
  lines.push(`# ${title}`);
  if (lesson.oneLineGist) lines.push(`\n> ${lesson.oneLineGist}`);
  for (const s of lesson.sections || []) {
    lines.push(`\n## ${s.title}`);
    if (s.setup) lines.push(`\n${s.setup}`);
    if (Array.isArray(s.bullets) && s.bullets.length) {
      lines.push("");
      for (const b of s.bullets) lines.push(`- ${b}`);
    }
  }
  if (lesson.youtubeQuery) {
    const q = encodeURIComponent(lesson.youtubeQuery);
    lines.push(`\n## ▶ Watch it explained`);
    lines.push(`\nhttps://www.youtube.com/results?search_query=${q}`);
  }
  const tk = lesson.toolkit;
  if (tk) {
    lines.push(`\n## 🧰 Toolkit`);
    if (tk.setup) lines.push(`\n${tk.setup}`);
    if (Array.isArray(tk.structures) && tk.structures.length) {
      lines.push(`\n**Data structures**\n`);
      for (const it of tk.structures) lines.push(`- **${it.name}** — ${it.why}`);
    }
    if (Array.isArray(tk.algorithms) && tk.algorithms.length) {
      lines.push(`\n**Algorithms / techniques**\n`);
      for (const it of tk.algorithms) lines.push(`- **${it.name}** — ${it.why}`);
    }
  }
  return lines.join("\n");
}

// -------- Groq --------
async function fetchLesson({ kind, title, subtitle, row, schema }) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key. Add one in Settings → AI butler.");

  const user = buildUserPrompt({ kind, title, subtitle, row, schema });
  const system = buildSystemPrompt(schema);

  // First attempt — JSON mode, generous max_tokens, low temperature for schema stability.
  let res = await callGrok({
    apiKey,
    jsonMode: true,
    maxTokens: 4096,
    temperature: 0.3,
    system,
    user,
  });

  // Fallback — JSON mode failed to validate (common Groq quirk on complex schemas).
  // Retry WITHOUT json_mode and parse the output ourselves. Prompt still demands JSON.
  if (!res.ok && /json_validate_failed|json/i.test(String(res.error || ""))) {
    res = await callGrok({
      apiKey,
      jsonMode: false,
      maxTokens: 4096,
      temperature: 0.3,
      system: system + "\n\nIMPORTANT: Reply with raw JSON only. Start with { and end with }. No preamble, no code fences.",
      user,
    });
  }

  if (!res.ok) throw new Error(res.error || "Groq call failed");

  // Extract JSON — handles raw JSON, ```json fences, or JSON with surrounding prose.
  const parsed = extractJson(res.content);
  if (!parsed || !Array.isArray(parsed.sections)) {
    throw new Error("Response missing sections array.");
  }

  // Enforce schema order — fill in blanks if Groq dropped a section.
  const bySchemaTitle = new Map(parsed.sections.map(s => [normalize(s.title), s]));
  const normalized = schema.map(t => {
    const match = bySchemaTitle.get(normalize(t));
    return match
      ? { title: t, setup: String(match.setup || "").trim(), bullets: Array.isArray(match.bullets) ? match.bullets : [] }
      : { title: t, setup: "", bullets: [] };
  });
  return {
    oneLineGist: String(parsed.oneLineGist || "").trim(),
    sections: normalized,
    toolkit: parsed.toolkit && typeof parsed.toolkit === "object" ? {
      setup: String(parsed.toolkit.setup || "").trim(),
      structures: Array.isArray(parsed.toolkit.structures) ? parsed.toolkit.structures : [],
      algorithms: Array.isArray(parsed.toolkit.algorithms) ? parsed.toolkit.algorithms : [],
    } : null,
    imageQueries: Array.isArray(parsed.imageQueries)
      ? parsed.imageQueries.slice(0, 2).map(q => ({
          query: String(q.query || "").trim(),
          afterSection: String(q.afterSection || "").trim(),
        })).filter(q => q.query && q.afterSection)
      : [],
    youtubeQuery: String(parsed.youtubeQuery || "").trim(),
  };
}

// Compact, Groq-friendly system prompt. The old version was ~900 words and
// deeply nested — llama-3.3-70b sometimes failed json_mode on it. This is
// ~250 words with a tighter schema example.
function buildSystemPrompt(schema) {
  const titles = schema.map((t, i) => `  ${i + 1}. "${t}"`).join("\n");
  return `You are a staff FDE interviewer teaching a motivated student.

Reply with VALID JSON matching this shape (no markdown, no code fences, no preamble):

{
  "oneLineGist": "one sentence capturing the key idea",
  "sections": [
    {"title": "exact title from list", "setup": "one lead-in sentence", "bullets": ["3-5 points, 10-20 words each"]}
  ],
  "toolkit": {
    "setup": "one sentence on when to reach for this toolkit",
    "structures": [{"name": "HashMap", "why": "short clause"}],
    "algorithms": [{"name": "Linear scan", "why": "short clause"}]
  },
  "imageQueries": [
    {"query": "google image search query", "afterSection": "exact section title"}
  ],
  "youtubeQuery": "4-8 word search for a top-tier explainer"
}

Section titles MUST match these exact strings in order:
${titles}

Rules:
- EXACTLY ${schema.length} sections, in order. Each section: 1 setup sentence + 3-5 bullets.
- Toolkit: 2-4 structures + 2-4 algorithms. Name specific DS/algos.
- imageQueries: exactly 2 items. Pick educational diagrams, not stock photos. afterSection must exactly match a title above.
- youtubeQuery: concise 4-8 word search that will return a NeetCode / Gaurav Sen / Abdul Bari / ByteByteGo style explainer.
- Tone: teacher-first, keyword-dense. Name specific products, scale numbers, data structures.
- NEVER write full solution code. Give algorithmic narrative (what pointers do, what hashmap holds, the invariant).
- Keep total body text around 500 words.
- Keep bullets flat — no sub-bullets, no nested lists.

Reply as JSON.`;
}

// Extract a JSON object from a response that may be raw JSON, fenced, or wrapped in prose.
function extractJson(text) {
  if (!text) return null;
  const raw = String(text).trim();
  // Try plain parse first
  try { return JSON.parse(raw); } catch (_) {}
  // Strip ```json ... ``` fences
  const fenced = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(fenced); } catch (_) {}
  // Find the first { and the matching last }
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(fenced.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

function buildUserPrompt({ kind, title, subtitle, row, schema }) {
  const bits = [];
  bits.push(`Topic: ${title}`);
  if (subtitle) bits.push(`Context: ${subtitle}`);
  const noisy = /^(status|datesolved|datedone|solution|notes|confidence|seq)$/i;
  const kv = Object.entries(row || {})
    .filter(([k, v]) => v && String(v).trim() && !noisy.test(k))
    .map(([k, v]) => `${k}: ${String(v).trim()}`);
  if (kv.length) bits.push("Row data:\n" + kv.join("\n"));
  // Mention "JSON" in the user prompt — Groq's JSON mode requires it in system OR user.
  bits.push(`\nGenerate the lesson as JSON following the schema. ${schema.length} sections in exact order.`);
  return bits.join("\n");
}

// -------- SerpAPI media resolution — images + YouTube video --------
async function resolveMedia(scrim, { imageQueries, youtubeQuery }) {
  const apiKey = await secure.get("serpapi_key").catch(() => null);
  const hasImages = imageQueries?.length;
  const hasVideo = !!youtubeQuery;

  if (!apiKey) {
    // No key — gracefully degrade: image slots show "add key" nudge, video slot shows search-on-youtube link
    scrim.querySelectorAll(".lsn-img").forEach(fig => {
      const slot = fig.querySelector(".lsn-img-slot");
      if (slot) slot.innerHTML = `<a href="#settings" class="lsn-img-nokey">Add a SerpAPI key in Settings → Media (optional) to show diagrams &amp; videos</a>`;
    });
    const vidSlot = scrim.querySelector("#lsn-vid-slot");
    if (vidSlot && hasVideo) {
      const q = encodeURIComponent(youtubeQuery);
      vidSlot.innerHTML = `
        <a class="lsn-vid-nokey" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">
          <span>Search YouTube for "<b>${esc(youtubeQuery)}</b>"</span>
          <small>Add a SerpAPI key in Settings to embed the video here automatically.</small>
        </a>
      `;
    }
    return;
  }

  // Resolve images (if any) and video in parallel — one SerpAPI call per unique query.
  const tasks = [];

  if (hasImages) {
    for (const fig of scrim.querySelectorAll(".lsn-img")) {
      tasks.push((async () => {
        const q = fig.dataset.q;
        if (!q) return;
        const slot = fig.querySelector(".lsn-img-slot");
        const imgCacheKey = IMG_CACHE_PREFIX + q.toLowerCase();
        let url = null;
        try {
          const cached = localStorage.getItem(imgCacheKey);
          if (cached) url = cached;
        } catch (_) {}
        if (!url) {
          try {
            url = await fetchSerpImage(apiKey, q);
            if (url) { try { localStorage.setItem(imgCacheKey, url); } catch (_) {} }
          } catch (_) { url = null; }
        }
        if (url && slot) {
          slot.innerHTML = `<img src="${esc(url)}" alt="${esc(q)}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=&quot;lsn-img-fail&quot;>image unavailable</span>'" />`;
        } else if (slot) {
          slot.innerHTML = `<span class="lsn-img-fail">no image match</span>`;
        }
      })());
    }
  }

  if (hasVideo) {
    tasks.push((async () => {
      const slot = scrim.querySelector("#lsn-vid-slot");
      if (!slot) return;
      const vidCacheKey = IMG_CACHE_PREFIX + "yt:" + youtubeQuery.toLowerCase();
      let videoId = null;
      let videoTitle = null;
      let candidates = null;
      try {
        const cached = localStorage.getItem(vidCacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          videoId = parsed.videoId || null;
          videoTitle = parsed.title || null;
          candidates = Array.isArray(parsed.candidates) ? parsed.candidates : null;
        }
      } catch (_) {}
      if (!videoId) {
        try {
          const picked = await fetchSerpYouTube(apiKey, youtubeQuery);
          if (picked) {
            videoId = picked.videoId;
            videoTitle = picked.title;
            candidates = picked.candidates;
            try { localStorage.setItem(vidCacheKey, JSON.stringify(picked)); } catch (_) {}
          }
        } catch (_) {}
      }
      if (videoId) {
        renderVideo(slot, {
          videoId,
          videoTitle,
          youtubeQuery,
          candidates: Array.isArray(candidates) && candidates.length ? candidates : [{ videoId, title: videoTitle }],
        });
      } else {
        const q = encodeURIComponent(youtubeQuery);
        slot.innerHTML = `
          <a class="lsn-vid-nokey" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">
            <span>No match found. Search YouTube for "<b>${esc(youtubeQuery)}</b>"</span>
          </a>
        `;
      }
    })());
  }

  await Promise.all(tasks);
}

// Render the YouTube iframe + a "Not playing? Try another" strip when alternates exist.
// Pass candidates so the user can cycle through if YouTube's Error 153 (embed disabled)
// hits on the first video.
function renderVideo(slot, { videoId, videoTitle, youtubeQuery, candidates, currentIdx = 0 }) {
  const total = candidates.length;
  const safeTitle = videoTitle || candidates[currentIdx]?.title || youtubeQuery;
  slot.innerHTML = `
    <iframe
      class="lsn-vid-iframe"
      src="https://www.youtube-nocookie.com/embed/${esc(videoId)}?modestbranding=1&rel=0"
      title="${esc(safeTitle)}"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
      loading="lazy"
      referrerpolicy="strict-origin-when-cross-origin"></iframe>
    ${safeTitle ? `<div class="lsn-vid-caption">${esc(safeTitle)}</div>` : ""}
    <div class="lsn-vid-controls">
      ${total > 1 ? `<button class="lsn-vid-ctrl" data-next-vid>↷ Not playing? Try next (${currentIdx + 1}/${total})</button>` : ""}
      <a class="lsn-vid-ctrl lsn-vid-ext" href="https://www.youtube.com/watch?v=${esc(videoId)}" target="_blank" rel="noopener">Open on YouTube ↗</a>
    </div>
  `;
  const nextBtn = slot.querySelector("[data-next-vid]");
  if (nextBtn && total > 1) {
    nextBtn.addEventListener("click", () => {
      const nextIdx = (currentIdx + 1) % total;
      const next = candidates[nextIdx];
      if (!next) return;
      renderVideo(slot, { videoId: next.videoId, videoTitle: next.title, youtubeQuery, candidates, currentIdx: nextIdx });
    });
  }
}

// SerpAPI calls go through the Rust proxy because the public endpoint doesn't
// send CORS headers for browser origins. serpSearch() in store.js wraps invoke.
async function callSerp(engine, query, apiKey) {
  const res = await serpSearch({ engine, query, apiKey });
  if (!res || !res.ok) throw new Error(res?.error || "SerpAPI call failed");
  return JSON.parse(res.json);
}

async function fetchSerpImage(apiKey, query) {
  const json = await callSerp("google_images", query, apiKey);
  const list = Array.isArray(json.images_results) ? json.images_results : [];
  if (!list.length) return null;
  for (const r of list) {
    const u = r.original || r.thumbnail;
    if (u && /^https?:/.test(u)) return u;
  }
  return null;
}

async function fetchSerpYouTube(apiKey, query) {
  const json = await callSerp("youtube", query, apiKey);
  const list = Array.isArray(json.video_results) ? json.video_results : [];
  if (!list.length) return null;
  // Collect up to 5 candidates. The first is shown; the rest are alternates
  // the user can swap in if YouTube's "Error 153" blocks the first one.
  const candidates = [];
  for (const r of list.slice(0, 8)) {
    const id = extractYouTubeId(r.link || "");
    if (id && !candidates.find(c => c.videoId === id)) {
      candidates.push({ videoId: id, title: r.title || "", channel: r.channel?.name || "" });
      if (candidates.length >= 5) break;
    }
  }
  if (!candidates.length) return null;
  return { ...candidates[0], candidates };  // first + full list
}

function extractYouTubeId(url) {
  if (!url) return null;
  // Match standard watch URLs, shorts, and youtu.be short links.
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = re.exec(url);
    if (m) return m[1];
  }
  return null;
}

// -------- helpers --------
function inferKind(sheet, sheetName) {
  const t = (sheet.type || "").toLowerCase();
  if (t === "dsa" || /dsa/i.test(sheetName)) return "dsa";
  if (t === "sql" || /^sql/i.test(sheetName)) return "sql";
  if (t === "sd" || /system.?design/i.test(sheetName)) return "sd";
  if (t === "int" || /integrations?/i.test(sheetName)) return "int";
  if (t === "ext" || /extras?/i.test(sheetName)) return "ext";
  return "dsa";
}

function extractTitle(sheet, row) {
  const cols = sheet.headers;
  const titleCol = cols.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
  return (titleCol ? row[titleCol] : row[cols[0]]) || "Topic";
}

function extractSubtitle(sheet, row, kind) {
  const headers = sheet.headers;
  const parts = [];
  const patternCol = headers.find(h => /^(pattern|category)$/i.test(h));
  if (patternCol && row[patternCol]) parts.push(row[patternCol]);
  if (kind === "dsa" || kind === "sql") {
    const diffCol = headers.find(h => /^difficulty$/i.test(h));
    if (diffCol && row[diffCol]) parts.push(row[diffCol]);
    const lcCol = headers.find(h => /^lc#?$/i.test(h));
    if (lcCol && row[lcCol]) parts.push(`LC #${row[lcCol]}`);
  }
  return parts.filter(Boolean).join(" · ");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }
  )[c]);
}

// -------- styles (injected once) --------
function injectStyles() {
  if (document.getElementById("lesson-styles")) return;
  const style = document.createElement("style");
  style.id = "lesson-styles";
  style.textContent = `
    .lsn-scrim {
      position: fixed; inset: 0; z-index: 1350;
      background: rgba(8,10,14,.68);
      backdrop-filter: blur(10px) saturate(140%);
      -webkit-backdrop-filter: blur(10px) saturate(140%);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: lsnFade 220ms ease both;
    }
    @keyframes lsnFade { from { opacity: 0; } to { opacity: 1; } }
    .lsn-modal {
      background: var(--paper); border-radius: 20px;
      width: 100%; max-width: 760px; max-height: 92vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 32px 80px rgba(0,0,0,.4), 0 0 0 1px var(--line);
      animation: lsnPop 240ms cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes lsnPop {
      from { opacity: 0; transform: translateY(16px) scale(.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .lsn-head {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 22px 26px 18px;
      border-bottom: 1px solid var(--line);
    }
    .lsn-head-main { min-width: 0; flex: 1; }
    .lsn-kind {
      font-size: 10.5px; letter-spacing: .14em; font-weight: 700;
      text-transform: uppercase; color: var(--mut); margin-bottom: 6px;
    }
    .lsn-title { margin: 0 0 4px; font-size: 22px; font-weight: 700; color: var(--ink); letter-spacing: -.015em; line-height: 1.2; }
    .lsn-sub { font-size: 13px; color: var(--mut); }
    .lsn-head-actions { display: flex; align-items: center; gap: 6px; }
    .lsn-close, .lsn-expand {
      border: none; background: transparent; cursor: pointer; color: var(--mut);
      width: 32px; height: 32px; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center;
      font: 400 18px/1 var(--font-sans);
      transition: all .18s;
    }
    .lsn-close:hover, .lsn-expand:hover { background: var(--bg); color: var(--ink); }
    .lsn-expand .lsn-expand-ic { font-size: 15px; display: inline-block; }

    .lsn-body { padding: 20px 26px; overflow-y: auto; flex: 1; }

    /* ---- Gate ---- */
    .lsn-gate { text-align: center; padding: 20px 10px; }
    .lsn-gate-ico {
      display: inline-flex; align-items: center; justify-content: center;
      width: 64px; height: 64px; border-radius: 16px;
      background: color-mix(in oklab, var(--gold) 12%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--gold) 24%, var(--line));
      color: var(--gold); font-size: 28px;
      margin-bottom: 14px;
    }
    .lsn-gate-title { font-size: 18px; font-weight: 700; color: var(--ink); letter-spacing: -.01em; margin-bottom: 4px; }
    .lsn-gate-sub { font-size: 13px; color: var(--mut); margin-bottom: 18px; }
    .lsn-gate-pitch {
      max-width: 520px; margin: 0 auto 18px;
      padding: 14px 16px;
      background: var(--bg); border: 1px solid var(--line);
      border-radius: 10px;
      font-size: 13.5px; color: var(--ink); line-height: 1.55;
      text-align: left;
    }
    .lsn-gate-pitch b { font-weight: 700; }
    .lsn-gate-cta { padding: 12px 28px; font-size: 14px; }
    .lsn-gate-cta:disabled { opacity: .7; cursor: wait; }
    .lsn-gate-note { margin-top: 12px; font-size: 11px; color: var(--mut); }

    /* ---- Lesson content ---- */
    .lsn-gist {
      display: flex; align-items: baseline; gap: 12px;
      padding: 14px 18px; margin-bottom: 22px;
      background: color-mix(in oklab, var(--gold) 7%, var(--paper));
      border-left: 3px solid var(--gold); border-radius: 10px;
      font-size: 14.5px; line-height: 1.55; color: var(--ink);
    }
    .lsn-gist-tag {
      font: 700 10px/1 var(--font-sans); letter-spacing: .14em;
      color: var(--gold); flex-shrink: 0;
    }

    .lsn-sec { margin-bottom: 24px; }
    .lsn-sec h3 {
      margin: 0 0 10px; font-size: 14px; font-weight: 700;
      letter-spacing: .01em; color: var(--mut);
      padding-bottom: 7px; border-bottom: 1px solid var(--line);
      display: flex; align-items: center; gap: 8px;
    }
    .lsn-sec .lsn-setup {
      margin: 0 0 10px; font-size: 14px; line-height: 1.55;
      color: var(--ink);
    }
    .lsn-sec .lsn-bullets {
      margin: 0; padding-left: 0; list-style: none;
    }
    .lsn-sec .lsn-bullets li {
      position: relative; padding: 7px 0 7px 20px;
      font-size: 13.5px; line-height: 1.55; color: var(--ink);
    }
    .lsn-sec .lsn-bullets li::before {
      content: ""; position: absolute; left: 4px; top: 15px;
      width: 5px; height: 5px; border-radius: 50%;
      background: color-mix(in oklab, var(--gold) 70%, transparent);
    }
    .lsn-sec .lsn-bullets li b { color: var(--ink); font-weight: 700; }

    /* ---- Toolkit (final section) ---- */
    .lsn-sec.lsn-toolkit {
      padding: 18px 20px;
      background: color-mix(in oklab, var(--gold) 5%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--gold) 22%, var(--line));
      border-radius: 12px;
    }
    .lsn-sec.lsn-toolkit h3 { border-bottom: none; padding-bottom: 0; margin-bottom: 6px; color: var(--ink); }
    .lsn-sec.lsn-toolkit .lsn-tk-ico { font-size: 16px; }
    .lsn-tk-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 18px;
      margin-top: 10px;
    }
    .lsn-tk-group .lsn-tk-label {
      font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em;
      text-transform: uppercase; color: var(--mut); margin-bottom: 8px;
    }
    .lsn-tk-group ul {
      margin: 0; padding-left: 0; list-style: none;
    }
    .lsn-tk-group ul li {
      position: relative; padding: 6px 0 6px 16px;
      font-size: 13px; line-height: 1.5; color: var(--ink);
    }
    .lsn-tk-group ul li::before {
      content: "›"; position: absolute; left: 0; top: 6px;
      color: var(--gold); font-weight: 700;
    }
    .lsn-tk-group ul li b { font-weight: 700; color: var(--ink); margin-right: 2px; }
    @media (max-width: 560px) {
      .lsn-tk-grid { grid-template-columns: 1fr; gap: 12px; }
    }

    /* ---- Inline SerpAPI figure ---- */
    .lsn-img {
      margin: 0 0 24px; padding: 0;
      border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
      background: var(--bg);
    }
    .lsn-img-slot {
      display: flex; align-items: center; justify-content: center;
      min-height: 180px; max-height: 320px; overflow: hidden;
      background: var(--bg);
    }
    .lsn-img-slot img {
      width: 100%; height: auto; max-height: 320px; object-fit: contain;
      display: block;
    }
    .lsn-img-skel {
      width: 60%; height: 10px; border-radius: 6px;
      background: linear-gradient(90deg, var(--line) 0%, color-mix(in oklab, var(--line) 50%, var(--paper)) 50%, var(--line) 100%);
      background-size: 200% 100%; animation: lsnShim 1200ms ease-in-out infinite;
    }
    .lsn-img figcaption {
      padding: 8px 12px;
      font: 500 11.5px/1.4 var(--font-sans);
      color: var(--mut); background: var(--paper);
      border-top: 1px solid var(--line);
    }
    .lsn-img-nokey {
      font-size: 12.5px; color: var(--mut); text-decoration: none;
      padding: 24px; text-align: center; display: block;
    }
    .lsn-img-nokey:hover { color: var(--gold); }
    .lsn-img-fail { font-size: 11.5px; color: var(--mut); padding: 20px; font-style: italic; }

    /* ---- YouTube video section ---- */
    .lsn-sec.lsn-video h3 { color: var(--ink); }
    .lsn-sec.lsn-video .lsn-vid-ico {
      color: var(--red); font-size: 15px;
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 50%;
      background: color-mix(in oklab, var(--red) 10%, transparent);
    }
    .lsn-vid-wrap {
      position: relative;
      border-radius: 14px; overflow: hidden;
      background: #0a0a0a;
      aspect-ratio: 16 / 9;
      border: 1px solid var(--line);
      box-shadow: 0 8px 24px rgba(0,0,0,.12);
    }
    .lsn-vid-slot {
      position: relative;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 14px;
      width: 100%; height: 100%;
      background: #0a0a0a; color: color-mix(in oklab, #fff 70%, transparent);
      overflow: hidden;
    }
    .lsn-vid-iframe {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      border: none; background: #000;
    }
    .lsn-vid-caption {
      position: absolute; left: 0; right: 0; bottom: 0;
      padding: 10px 14px;
      font: 500 12px/1.4 var(--font-sans);
      color: #fff;
      background: linear-gradient(0deg, rgba(0,0,0,.6) 0%, transparent 100%);
      pointer-events: none;
      opacity: 0;
      transition: opacity .25s ease;
    }
    .lsn-vid-wrap:hover .lsn-vid-caption { opacity: 1; }
    .lsn-vid-skel {
      display: flex; gap: 8px; align-items: center;
    }
    .lsn-vid-skel span {
      width: 8px; height: 8px; border-radius: 50%;
      background: color-mix(in oklab, #fff 40%, transparent);
      animation: lsnVidBounce 1200ms ease-in-out infinite;
    }
    .lsn-vid-skel span:nth-child(2) { animation-delay: 120ms; }
    .lsn-vid-skel span:nth-child(3) { animation-delay: 240ms; }
    @keyframes lsnVidBounce {
      0%, 60%, 100% { transform: scale(1); opacity: .4; }
      30%           { transform: scale(1.3); opacity: 1; }
    }
    .lsn-vid-query {
      font: 500 12.5px/1.5 var(--font-sans);
      color: color-mix(in oklab, #fff 60%, transparent);
      letter-spacing: .02em;
      text-align: center;
      padding: 0 20px;
    }
    .lsn-vid-nokey {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px; padding: 20px 24px;
      text-decoration: none; color: color-mix(in oklab, #fff 80%, transparent);
      text-align: center;
      transition: color .18s ease;
    }
    .lsn-vid-nokey:hover { color: var(--gold); }
    .lsn-vid-nokey b { color: #fff; font-weight: 700; }
    .lsn-vid-nokey small { font-size: 11px; color: color-mix(in oklab, #fff 50%, transparent); line-height: 1.5; }

    /* Video controls strip under the iframe (Error 153 escape hatch) */
    .lsn-vid-controls {
      position: absolute; left: 0; right: 0; bottom: 0;
      display: flex; gap: 6px; padding: 10px 12px;
      background: linear-gradient(0deg, rgba(0,0,0,.72) 0%, transparent 100%);
      opacity: 0; transition: opacity .25s ease;
      pointer-events: none;
    }
    .lsn-vid-wrap:hover .lsn-vid-controls { opacity: 1; pointer-events: auto; }
    .lsn-vid-ctrl {
      padding: 6px 12px; font: 600 11.5px/1 var(--font-sans);
      background: rgba(255,255,255,.14); color: #fff;
      border: 1px solid rgba(255,255,255,.18); border-radius: 8px;
      cursor: pointer; text-decoration: none;
      transition: all .18s;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      white-space: nowrap;
    }
    .lsn-vid-ctrl:hover { background: rgba(255,255,255,.24); border-color: rgba(255,255,255,.3); }
    .lsn-vid-ctrl.lsn-vid-ext { margin-left: auto; }

    /* ---- Fullscreen mode ---- */
    .lsn-scrim:has(.lsn-modal.fullscreen) { padding: 0; }
    .lsn-modal.fullscreen {
      max-width: none; max-height: none;
      width: 100vw; height: 100vh;
      border-radius: 0;
      animation: lsnPopFS 240ms cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes lsnPopFS {
      from { opacity: 0; transform: scale(.98); }
      to   { opacity: 1; transform: scale(1); }
    }
    .lsn-modal.fullscreen .lsn-head {
      padding: 24px 48px 20px;
      background: color-mix(in oklab, var(--paper) 92%, var(--gold));
    }
    .lsn-modal.fullscreen .lsn-title { font-size: 28px; letter-spacing: -.02em; }
    .lsn-modal.fullscreen .lsn-kind { font-size: 11px; }
    .lsn-modal.fullscreen .lsn-sub { font-size: 14px; }
    .lsn-modal.fullscreen .lsn-body {
      padding: 36px 48px;
      background: var(--paper);
    }
    .lsn-modal.fullscreen .lsn-body > .lsn-gist,
    .lsn-modal.fullscreen .lsn-body > .lsn-sec,
    .lsn-modal.fullscreen .lsn-body > .lsn-img {
      max-width: 820px;
      margin-left: auto;
      margin-right: auto;
    }
    .lsn-modal.fullscreen .lsn-sec h3 { font-size: 15px; }
    .lsn-modal.fullscreen .lsn-sec .lsn-setup { font-size: 15.5px; }
    .lsn-modal.fullscreen .lsn-sec .lsn-bullets li { font-size: 15px; padding: 8px 0 8px 22px; }
    .lsn-modal.fullscreen .lsn-sec .lsn-bullets li::before { top: 17px; }
    .lsn-modal.fullscreen .lsn-gist { font-size: 16px; padding: 18px 22px; }
    .lsn-modal.fullscreen .lsn-sec.lsn-video,
    .lsn-modal.fullscreen .lsn-sec.lsn-toolkit {
      max-width: 920px;
      margin-left: auto;
      margin-right: auto;
    }
    .lsn-modal.fullscreen .lsn-vid-wrap {
      border-radius: 18px;
    }
    .lsn-modal.fullscreen .lsn-tk-grid { gap: 24px; }
    .lsn-modal.fullscreen .lsn-tk-group ul li { font-size: 14px; }
    .lsn-modal.fullscreen .lsn-foot {
      padding: 16px 48px;
    }
    .lsn-modal.fullscreen .lsn-img-slot { max-height: 480px; }
    .lsn-modal.fullscreen .lsn-img-slot img { max-height: 480px; }
    @media (max-width: 720px) {
      .lsn-modal.fullscreen .lsn-head { padding: 20px 20px 14px; }
      .lsn-modal.fullscreen .lsn-body { padding: 24px 20px; }
      .lsn-modal.fullscreen .lsn-foot { padding: 14px 20px; }
    }

    /* ---- Loading skeleton ---- */
    .lsn-loading { padding: 10px 0; }
    .lsn-skel-sec { margin-bottom: 20px; }
    .lsn-skel-sec .skel-h {
      width: 180px; height: 12px; border-radius: 6px; margin-bottom: 10px;
      background: linear-gradient(90deg, var(--line) 0%, color-mix(in oklab, var(--line) 50%, var(--paper)) 50%, var(--line) 100%);
      background-size: 200% 100%; animation: lsnShim 1200ms ease-in-out infinite;
    }
    .lsn-skel-sec .skel-line {
      height: 10px; border-radius: 6px; margin-bottom: 8px;
      background: linear-gradient(90deg, var(--line) 0%, color-mix(in oklab, var(--line) 50%, var(--paper)) 50%, var(--line) 100%);
      background-size: 200% 100%; animation: lsnShim 1200ms ease-in-out infinite;
    }
    .lsn-skel-sec .skel-line.short { width: 65%; }
    @keyframes lsnShim { from { background-position: 200% 0; } to { background-position: -200% 0; } }

    /* ---- Error ---- */
    .lsn-err {
      padding: 20px; background: color-mix(in oklab, var(--red) 10%, transparent);
      color: var(--red); border-radius: 10px; font-size: 13.5px;
    }
    .lsn-err p { margin: 8px 0; color: var(--ink); font-size: 13px; }

    /* ---- Footer ---- */
    .lsn-foot {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 26px;
      background: var(--bg); border-top: 1px solid var(--line);
    }
    .lsn-btn {
      padding: 10px 18px; border-radius: 10px; cursor: pointer;
      font: 600 13px/1 var(--font-sans);
      border: 1px solid var(--line);
      transition: all .18s;
    }
    .lsn-btn.ghost { background: var(--paper); color: var(--mut); }
    .lsn-btn.ghost:hover { color: var(--ink); border-color: var(--line2); }
    .lsn-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .lsn-btn.primary:hover { transform: translateY(-1px); filter: brightness(1.08); }
  `;
  document.head.appendChild(style);
}
injectStyles();
