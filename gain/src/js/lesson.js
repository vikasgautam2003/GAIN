// Lesson modal — Groq-powered "Teach me this topic" surface.
// 6-section teaching framework (problem → intuition → dry run → code → edge
// cases + complexity → interview pointers → revision notes) + 5-question
// quiz gate. 3/5 passes → full bounty; fail 3× → 50% effort payout + yellow
// "Needs human help" chip; later pass → remaining 50% + "Comeback win".
// Images (SerpAPI) land inline next to the concept they illustrate.
// YouTube video (Data API, embeddable-guaranteed) sits before the quiz.

import { getSheets, getWallet, callGrok, serpSearch, youtubeSearch, secure, updateSheetRow, updateWallet } from "./store.js";
import { renderMarkdown } from "./info.js";
import { callGroqJSON } from "./groqJson.js";

const CACHE_PREFIX   = "gain:lesson:";
const IMG_CACHE_PREFIX = "gain:lessonImg:";
const STATE_PREFIX   = "gain:lessonState:";    // per-row quiz/bounty state
const QUIZ_PASS      = 3;                       // 3/5 to pass
const MAX_ATTEMPTS   = 3;                       // after this, partial payout + yellow chip
const CODE_DEFAULT_LANG = "java";

// Which sections render for which sheet kind. Order matters.
// DSA/SQL get the full programming track (code + complexity + dry run).
// SD/Int/Ext get the conceptual track (tradeoffs instead of complexity).
const SECTION_PLAN = {
  dsa: ["problem", "intuition", "dryRun", "code", "edgeCases", "complexity", "interviewPointers", "revisionNotes"],
  sql: ["problem", "intuition", "dryRun", "code", "edgeCases", "complexity", "interviewPointers", "revisionNotes"],
  sd:  ["problem", "intuition", "tradeoffs", "edgeCases", "interviewPointers", "revisionNotes"],
  int: ["problem", "intuition", "tradeoffs", "edgeCases", "interviewPointers", "revisionNotes"],
  ext: ["problem", "intuition", "tradeoffs", "interviewPointers", "revisionNotes"],
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

  injectStyles();  // idempotent — ensures new quiz/complexity styles are in the DOM

  const kind = inferKind(sheet, sheetName);
  const title = extractTitle(sheet, row);
  const subtitle = extractSubtitle(sheet, row, kind);
  const plan = SECTION_PLAN[kind] || SECTION_PLAN.dsa;
  const cacheKey = CACHE_PREFIX + `${sheetName}#${rowIndex}`;
  const stateKey = STATE_PREFIX + `${sheetName}#${rowIndex}`;
  const rowValue = computeBounty(row, kind);  // ₹ this lesson is worth

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

  const ctx = { sheetName, rowIndex, kind, title, subtitle, plan, row, cacheKey, stateKey, rowValue, close };

  if (cached && hasValidLessonShape(cached)) {
    paintLesson(scrim, cached, ctx);
    wireActions(scrim, ctx);
  } else {
    paintGate(scrim, { kind, title, subtitle, onGenerate: async () => {
      try {
        paintLoading(scrim);
        const lesson = await fetchLesson({ kind, title, subtitle, row, plan });
        try { localStorage.setItem(cacheKey, JSON.stringify(lesson)); } catch (_) {}
        paintLesson(scrim, lesson, ctx);
        wireActions(scrim, ctx);
      } catch (e) {
        paintError(scrim, e.message || String(e));
      }
    }});
  }
}

// Did the cached blob come from the new structured schema (v2)? If it was
// written by the old free-form `sections` schema, treat as missing so we
// re-generate with the richer format.
function hasValidLessonShape(l) {
  return !!(l && l.problem && typeof l.problem === "object" && Array.isArray(l.quiz));
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

function paintLesson(scrim, lesson, ctx) {
  const body = scrim.querySelector("#lsn-body");
  const plan = Array.isArray(lesson.plan) ? lesson.plan : ctx.plan;
  const state = getLessonState(ctx.stateKey);

  const html = [];

  // Status banner — if the user already passed, say so; if they're in the yellow zone, say that too.
  if (state.passed) {
    html.push(`<div class="lsn-status pass"><span>✓</span> Review mode — you've mastered this. Quiz hidden.</div>`);
  } else if (state.attempts.length >= MAX_ATTEMPTS) {
    html.push(`<div class="lsn-status needhelp"><span>⚠</span> After ${MAX_ATTEMPTS} tries the lesson didn't fully land. Give it one more careful read — a passing quiz now releases the remaining bounty.</div>`);
  }

  if (lesson.oneLineGist) {
    html.push(`<div class="lsn-gist"><span class="lsn-gist-tag">GIST</span><span>${renderMarkdown(lesson.oneLineGist)}</span></div>`);
  }

  // Image slot collector — resolveMedia walks these.
  const imageQueries = [];

  for (const sec of plan) {
    const chunk = renderSectionHTML(sec, lesson, { stepIdx: plan.indexOf(sec) + 1 });
    if (!chunk) continue;
    html.push(chunk.html);
    if (chunk.image) imageQueries.push(chunk.image);
  }

  // Video section
  if (lesson.youtubeQuery) {
    html.push(`
      <section class="lsn-sec lsn-video" data-q="${esc(lesson.youtubeQuery)}">
        <h3><span class="lsn-step">▶</span><span>Watch it explained</span></h3>
        <p class="lsn-setup">A tight walkthrough from a top-tier channel. Picked for teaching clarity.</p>
        <div class="lsn-vid-wrap">
          <div class="lsn-vid-slot" id="lsn-vid-slot">
            <div class="lsn-vid-skel"><span></span><span></span><span></span></div>
            <div class="lsn-vid-query">${esc(lesson.youtubeQuery)}</div>
          </div>
        </div>
      </section>
    `);
  }

  // Quiz gate
  if (!state.passed) {
    html.push(`<section class="lsn-sec lsn-quiz-sec"><h3><span class="lsn-step">🎓</span><span>Quiz — ${QUIZ_PASS}/5 to pass</span></h3><div id="lsn-quiz-slot"></div></section>`);
  }

  body.innerHTML = html.join("");
  const foot = scrim.querySelector("#lsn-foot");
  if (foot) foot.hidden = false;

  if (!state.passed) paintQuiz(scrim, lesson, ctx, state);

  Promise.resolve()
    .then(() => resolveMedia(scrim, { imageQueries, youtubeQuery: lesson.youtubeQuery }))
    .catch(err => console.warn("[lesson] media resolve failed:", err));
}

// One section = one HTML chunk + optional image query that resolveMedia will fill.
function renderSectionHTML(sec, lesson, { stepIdx }) {
  const step = `<span class="lsn-step">${stepIdx}</span>`;
  const img = (q) => q ? { afterSelector: `.lsn-sec[data-sec="${sec}"]`, query: q, section: sec } : null;

  if (sec === "problem") {
    const p = lesson.problem || {};
    return {
      html: `<section class="lsn-sec" data-sec="problem">
        <h3>${step}<span>Problem in simple words</span></h3>
        ${p.setup ? `<p class="lsn-setup">${renderMarkdown(p.setup)}</p>` : ""}
        ${p.example ? `<div class="lsn-example"><span class="lsn-example-tag">Example</span><code>${esc(p.example)}</code></div>` : ""}
        ${p.imageQuery ? imageFigureHTML(p.imageQuery) : ""}
      </section>`,
      image: img(p.imageQuery),
    };
  }
  if (sec === "intuition") {
    const i = lesson.intuition || {};
    return {
      html: `<section class="lsn-sec" data-sec="intuition">
        <h3>${step}<span>Core intuition</span></h3>
        ${i.setup ? `<p class="lsn-setup">${renderMarkdown(i.setup)}</p>` : ""}
        ${i.trick ? `<div class="lsn-trick"><span class="lsn-trick-tag">The trick</span>${renderMarkdown(i.trick)}</div>` : ""}
        ${i.whyItWorks ? `<p class="lsn-why">${renderMarkdown(i.whyItWorks)}</p>` : ""}
        ${i.imageQuery ? imageFigureHTML(i.imageQuery) : ""}
      </section>`,
      image: img(i.imageQuery),
    };
  }
  if (sec === "dryRun" && lesson.dryRun) {
    const d = lesson.dryRun;
    return {
      html: `<section class="lsn-sec" data-sec="dryRun">
        <h3>${step}<span>Dry run</span></h3>
        ${d.example ? `<p class="lsn-setup">Tracing: <code>${esc(d.example)}</code></p>` : ""}
        ${d.steps.length ? `<ol class="lsn-steps">
          ${d.steps.map(s => `<li><code class="lsn-step-call">${esc(s.call)}</code><span class="lsn-step-arrow">→</span><span class="lsn-step-ret">${esc(s.returns)}</span></li>`).join("")}
        </ol>` : ""}
        ${d.imageQuery ? imageFigureHTML(d.imageQuery) : ""}
      </section>`,
      image: img(d.imageQuery),
    };
  }
  if (sec === "code" && lesson.code) {
    const c = lesson.code;
    const lang = c.language || CODE_DEFAULT_LANG;
    return {
      html: `<section class="lsn-sec" data-sec="code">
        <h3>${step}<span>Code, line by line</span><span class="lsn-code-badge">${esc(lang.toUpperCase())}</span></h3>
        <div class="lsn-code-wrap">
          <pre class="lsn-code" data-lang="${esc(lang)}"><code>${esc(c.source)}</code></pre>
          <button class="lsn-code-copy" data-copy-code title="Copy">⧉</button>
        </div>
        ${c.lineExplanations.length ? `<ul class="lsn-line-ex">
          ${c.lineExplanations.map(l => `<li><code class="lsn-line-code">${esc(l.line)}</code><span class="lsn-line-why">${renderMarkdown(l.why)}</span></li>`).join("")}
        </ul>` : ""}
      </section>`,
      image: null,
    };
  }
  if (sec === "edgeCases" && lesson.edgeCases?.length) {
    return {
      html: `<section class="lsn-sec" data-sec="edgeCases">
        <h3>${step}<span>Edge cases</span></h3>
        <ul class="lsn-edges">
          ${lesson.edgeCases.map(e => `<li><span class="lsn-edge-dot">⚠</span>${renderMarkdown(e)}</li>`).join("")}
        </ul>
      </section>`,
      image: null,
    };
  }
  if (sec === "complexity" && lesson.complexity) {
    const c = lesson.complexity;
    return {
      html: `<section class="lsn-sec lsn-complexity" data-sec="complexity">
        <h3>${step}<span>Complexity</span></h3>
        <div class="lsn-cmx-grid">
          <div class="lsn-cmx-card">
            <div class="lsn-cmx-label">Time</div>
            <div class="lsn-cmx-big">${esc(c.time || "—")}</div>
            <div class="lsn-cmx-why">${renderMarkdown(c.timeWhy || "")}</div>
          </div>
          <div class="lsn-cmx-card">
            <div class="lsn-cmx-label">Space</div>
            <div class="lsn-cmx-big">${esc(c.space || "—")}</div>
            <div class="lsn-cmx-why">${renderMarkdown(c.spaceWhy || "")}</div>
          </div>
        </div>
      </section>`,
      image: null,
    };
  }
  if (sec === "tradeoffs" && lesson.tradeoffs?.length) {
    return {
      html: `<section class="lsn-sec" data-sec="tradeoffs">
        <h3>${step}<span>Trade-offs</span></h3>
        <div class="lsn-trade-grid">
          ${lesson.tradeoffs.map(t => `
            <div class="lsn-trade-row">
              <div class="lsn-trade-pro"><span>✓</span>${renderMarkdown(t.pro || "")}</div>
              <div class="lsn-trade-con"><span>✗</span>${renderMarkdown(t.con || "")}</div>
            </div>
          `).join("")}
        </div>
      </section>`,
      image: null,
    };
  }
  if (sec === "interviewPointers" && lesson.interviewPointers?.length) {
    return {
      html: `<section class="lsn-sec lsn-pointers" data-sec="interviewPointers">
        <h3>${step}<span>Interview pointers</span></h3>
        <p class="lsn-setup">The angles an interviewer probes next. Rehearse these.</p>
        <ol class="lsn-pointer-list">
          ${lesson.interviewPointers.map(p => `<li>${renderMarkdown(p)}</li>`).join("")}
        </ol>
      </section>`,
      image: null,
    };
  }
  if (sec === "revisionNotes" && lesson.revisionNotes?.length) {
    return {
      html: `<section class="lsn-sec lsn-revision" data-sec="revisionNotes">
        <h3>${step}<span>Revision notes</span></h3>
        <ul class="lsn-notes">
          ${lesson.revisionNotes.map(n => `<li><span class="lsn-note-dot">◆</span>${renderMarkdown(n)}</li>`).join("")}
        </ul>
      </section>`,
      image: null,
    };
  }
  return null;
}

function imageFigureHTML(q) {
  return `<figure class="lsn-img" data-q="${esc(q)}">
    <div class="lsn-img-slot"><span class="lsn-img-skel"></span></div>
    <figcaption>${esc(q)}</figcaption>
  </figure>`;
}

// --------- Quiz gate ---------
// One-at-a-time quiz. Shows a single question card with 4 options + Prev/Next.
// On the last question, Next becomes "Submit all". Picking an option auto-advances
// after a brief highlight (so no click-click-click fatigue). Progress dots at
// the top show which Qs are answered.
function paintQuiz(scrim, lesson, ctx, state) {
  const slot = scrim.querySelector("#lsn-quiz-slot");
  if (!slot) return;
  const total = lesson.quiz.length;
  const attemptNo = state.attempts.length + 1;
  const attemptBanner = attemptNo === MAX_ATTEMPTS
    ? `<div class="lsn-quiz-banner last">Final attempt (${attemptNo} of ${MAX_ATTEMPTS}). A pass here still earns full bounty.</div>`
    : attemptNo > 1
      ? `<div class="lsn-quiz-banner">Attempt ${attemptNo} of ${MAX_ATTEMPTS}.</div>`
      : "";
  const answers = Array(total).fill(null);
  let idx = 0;

  slot.innerHTML = `
    ${attemptBanner}
    <div class="lsn-quiz" id="lsn-quiz">
      <div class="lsn-quiz-dots" id="lsn-quiz-dots">
        ${Array(total).fill(0).map((_, i) => `<span class="lsn-qdot" data-qdot="${i}"></span>`).join("")}
      </div>
      <div id="lsn-quiz-card"></div>
      <div class="lsn-quiz-nav">
        <button class="lsn-btn ghost" id="lsn-q-prev" disabled>← Prev</button>
        <span class="lsn-quiz-counter" id="lsn-quiz-counter">Question 1 of ${total}</span>
        <button class="lsn-btn primary" id="lsn-q-next" disabled>Next →</button>
      </div>
    </div>
  `;

  const dotsEl = slot.querySelector("#lsn-quiz-dots");
  const cardEl = slot.querySelector("#lsn-quiz-card");
  const counterEl = slot.querySelector("#lsn-quiz-counter");
  const prevBtn = slot.querySelector("#lsn-q-prev");
  const nextBtn = slot.querySelector("#lsn-q-next");

  const renderCard = () => {
    const q = lesson.quiz[idx];
    cardEl.innerHTML = `
      <div class="lsn-qbox" data-qi="${idx}">
        <div class="lsn-qnum">Q${idx + 1}</div>
        <div class="lsn-qstem">${renderMarkdown(q.question)}</div>
        <div class="lsn-qopts">
          ${q.options.map((opt, oi) => `
            <button class="lsn-qopt ${answers[idx] === oi ? "picked" : ""}" data-oi="${oi}">
              <span class="lsn-qmark">${String.fromCharCode(65 + oi)}</span>
              <span class="lsn-qtext">${renderMarkdown(opt)}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
    counterEl.textContent = `Question ${idx + 1} of ${total}`;
    prevBtn.disabled = idx === 0;
    const isLast = idx === total - 1;
    const allAnswered = answers.every(a => a != null);
    nextBtn.textContent = isLast ? (allAnswered ? "Submit answers" : "Submit answers") : "Next →";
    nextBtn.classList.toggle("submit-ready", isLast && allAnswered);
    nextBtn.disabled = answers[idx] == null && !isLast;  // next needs this Q answered; submit needs all answered (handled below)
    if (isLast) nextBtn.disabled = !allAnswered;
    paintDots();

    cardEl.querySelectorAll(".lsn-qopt").forEach(btn => {
      btn.addEventListener("click", () => {
        const oi = +btn.dataset.oi;
        answers[idx] = oi;
        cardEl.querySelectorAll(".lsn-qopt").forEach(b => b.classList.remove("picked"));
        btn.classList.add("picked");
        paintDots();
        // Enable Next / Submit immediately.
        if (idx === total - 1) nextBtn.disabled = !answers.every(a => a != null);
        else nextBtn.disabled = false;
      });
    });
  };

  const paintDots = () => {
    [...dotsEl.querySelectorAll(".lsn-qdot")].forEach((d, i) => {
      d.classList.toggle("current", i === idx);
      d.classList.toggle("done", i !== idx && answers[i] != null);
    });
  };

  prevBtn.addEventListener("click", () => { if (idx > 0) { idx--; renderCard(); } });
  nextBtn.addEventListener("click", async () => {
    if (idx < total - 1) { idx++; renderCard(); return; }
    // Last Q — submit
    await submit();
  });

  const submit = async () => {
    const score = answers.reduce((n, a, i) => n + (a === lesson.quiz[i].correctIdx ? 1 : 0), 0);
    const missed = answers
      .map((a, i) => (a !== lesson.quiz[i].correctIdx ? lesson.quiz[i].question : null))
      .filter(Boolean);

    const passed = score >= QUIZ_PASS;
    const next = { ...state };
    next.attempts.push({ score, at: Date.now(), missed });
    if (passed) next.passed = true;
    const bountyMsg = await applyBountyLogic(next, ctx, { passed, isLastAttempt: next.attempts.length >= MAX_ATTEMPTS });
    saveLessonState(ctx.stateKey, next);

    // Replace quiz with per-question review (all 5 at once, correct/wrong revealed) + result card.
    slot.innerHTML = `
      <div class="lsn-quiz" id="lsn-quiz">
        <div class="lsn-quiz-result ${passed ? "pass" : "fail"}">
          <div class="lsn-qr-score">${score}/${total}</div>
          <div class="lsn-qr-verdict">${passed ? "Passed · lesson mastered" : (next.attempts.length >= MAX_ATTEMPTS ? "Didn't pass — needs human help" : "Didn't pass — rebuilding in a simpler shape")}</div>
          ${bountyMsg ? `<div class="lsn-qr-bounty">${esc(bountyMsg)}</div>` : ""}
        </div>
        <details class="lsn-quiz-review" ${passed ? "" : "open"}>
          <summary>Review your answers</summary>
          ${lesson.quiz.map((q, qi) => `
            <div class="lsn-qbox review" data-qi="${qi}">
              <div class="lsn-qnum">Q${qi + 1} · ${answers[qi] === q.correctIdx ? "<span class='qr-ok'>✓</span>" : "<span class='qr-no'>✗</span>"}</div>
              <div class="lsn-qstem">${renderMarkdown(q.question)}</div>
              <div class="lsn-qopts">
                ${q.options.map((opt, oi) => `
                  <div class="lsn-qopt review ${oi === q.correctIdx ? "correct" : (oi === answers[qi] ? "wrong" : "")}">
                    <span class="lsn-qmark">${String.fromCharCode(65 + oi)}</span>
                    <span class="lsn-qtext">${renderMarkdown(opt)}</span>
                  </div>
                `).join("")}
              </div>
              <div class="lsn-qexp"><b>${answers[qi] === q.correctIdx ? "✓" : "✗"}</b> ${renderMarkdown(q.explanation || "")}</div>
            </div>
          `).join("")}
        </details>
        <div class="lsn-quiz-foot">
          ${!passed && next.attempts.length < MAX_ATTEMPTS
            ? `<button class="lsn-btn primary" id="lsn-quiz-rebuild">↻ Rebuild lesson, simpler</button>`
            : (!passed ? `<button class="lsn-btn ghost" id="lsn-quiz-retry">Retry later</button>` : "")}
        </div>
      </div>
    `;
    slot.querySelector("#lsn-quiz-rebuild")?.addEventListener("click", async () => {
      paintLoading(scrim);
      try {
        const lessonV2 = await fetchLesson({ kind: ctx.kind, title: ctx.title, subtitle: ctx.subtitle, row: ctx.row, plan: ctx.plan, rebuildWeakSpots: missed });
        try { localStorage.setItem(ctx.cacheKey, JSON.stringify(lessonV2)); } catch (_) {}
        paintLesson(scrim, lessonV2, ctx);
        wireActions(scrim, ctx);
      } catch (e) {
        paintError(scrim, e.message || String(e));
      }
    });
    slot.querySelector("#lsn-quiz-retry")?.addEventListener("click", () => ctx.close());
  };

  renderCard();
}

// Pay bounty on pass / partial / comeback. Updates ledger, mutates `state`
// in place with payment flags so we never double-pay.
async function applyBountyLogic(state, ctx, { passed, isLastAttempt }) {
  const full = ctx.rowValue;
  if (!full || full <= 0) return "";
  const half = Math.round(full / 2);
  const label = `Lesson: ${ctx.title}`.slice(0, 80);

  if (passed) {
    if (state.partialPaidAt && !state.fullPaidAt) {
      // Comeback win — pay the remaining half
      await updateWallet(w => {
        w.earned = (w.earned || 0) + half;
        w.ledger.push({ date: new Date().toISOString(), type: "lesson-comeback", amount: half, label: `${label} · comeback win` });
      });
      state.fullPaidAt = Date.now();
      return `+ ₹${half} · comeback bounty · total ₹${full} earned`;
    } else if (!state.fullPaidAt) {
      // First-time pass — full bounty
      await updateWallet(w => {
        w.earned = (w.earned || 0) + full;
        w.ledger.push({ date: new Date().toISOString(), type: "lesson-pass", amount: full, label });
      });
      state.fullPaidAt = Date.now();
      return `+ ₹${full} · full bounty earned`;
    }
    return "Already paid";
  }

  // Fail path — pay 50% only on the final (3rd) failed attempt
  if (isLastAttempt && !state.partialPaidAt) {
    await updateWallet(w => {
      w.earned = (w.earned || 0) + half;
      w.ledger.push({ date: new Date().toISOString(), type: "lesson-effort", amount: half, label: `${label} · effort payout` });
    });
    state.partialPaidAt = Date.now();
    return `+ ₹${half} · effort bounty · come back and pass to earn the remaining ₹${full - half}`;
  }
  return "";
}

function getLessonState(stateKey) {
  try {
    const raw = localStorage.getItem(stateKey);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        attempts: Array.isArray(s.attempts) ? s.attempts : [],
        passed: !!s.passed,
        partialPaidAt: s.partialPaidAt || null,
        fullPaidAt: s.fullPaidAt || null,
      };
    }
  } catch (_) {}
  return { attempts: [], passed: false, partialPaidAt: null, fullPaidAt: null };
}
function saveLessonState(stateKey, s) {
  try { localStorage.setItem(stateKey, JSON.stringify(s)); } catch (_) {}
}

// Bounty = row's natural task value. Reuses the same ₹ formula as today's plan
// so a Hard DSA earns the same whether you learn it or solve it.
function computeBounty(row, kind) {
  const diff = String(row.difficulty || row.Difficulty || "").toLowerCase();
  const freq = String(row.freq || row.Freq || "").toUpperCase();
  const minutes = Number(row.minutes || row.Minutes || 30);
  let factor = 0.5;
  if (diff === "easy") factor = 0.25;
  else if (diff === "medium") factor = 0.6;
  else if (diff === "hard") factor = 1.0;
  if (kind === "sd") factor = Math.max(factor, 0.75);
  if (kind === "int") factor = Math.max(factor, 0.65);
  if (kind === "ext") factor = Math.max(factor, 0.7);
  if (freq === "HIGH") factor = Math.min(1, factor + 0.1);
  factor = Math.min(1, factor + Math.max(0, (minutes - 30) / 120));
  // Taskmin ₹20, taskmax ₹100 — matches engine defaults; adjusts gracefully.
  const taskMin = 20, taskMax = 100;
  const raw = taskMin + (taskMax - taskMin) * factor;
  return Math.max(taskMin, Math.min(taskMax, Math.round(raw / 10) * 10));
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

function wireActions(scrim, ctx) {
  const { sheetName, rowIndex, kind, title, plan, cacheKey, close } = ctx;
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
      const lesson = await fetchLesson({ kind, title, subtitle, row, plan });
      try { localStorage.setItem(cacheKey, JSON.stringify(lesson)); } catch (_) {}
      paintLesson(scrim, lesson, ctx);
      wireActions(scrim, ctx);
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

  // Code-copy buttons in the Code section
  scrim.querySelectorAll("[data-copy-code]").forEach(btn => {
    btn.addEventListener("click", () => {
      const pre = btn.parentElement.querySelector("pre code");
      if (!pre) return;
      navigator.clipboard?.writeText(pre.textContent).then(() => {
        const orig = btn.textContent;
        btn.textContent = "✓";
        setTimeout(() => { btn.textContent = orig; }, 1400);
      });
    });
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
  const L = [];
  L.push(`# ${title}`);
  if (lesson.oneLineGist) L.push(`\n> ${lesson.oneLineGist}`);
  if (lesson.problem) {
    L.push(`\n## 1 · Problem in simple words\n`);
    if (lesson.problem.setup) L.push(lesson.problem.setup);
    if (lesson.problem.example) L.push(`\n**Example:** \`${lesson.problem.example}\``);
  }
  if (lesson.intuition) {
    L.push(`\n## 2 · Core intuition\n`);
    if (lesson.intuition.setup) L.push(lesson.intuition.setup);
    if (lesson.intuition.trick) L.push(`\n**The trick:** ${lesson.intuition.trick}`);
    if (lesson.intuition.whyItWorks) L.push(`\n${lesson.intuition.whyItWorks}`);
  }
  if (lesson.dryRun) {
    L.push(`\n## 3 · Dry run\n`);
    if (lesson.dryRun.example) L.push(`Tracing: \`${lesson.dryRun.example}\``);
    for (const s of lesson.dryRun.steps || []) L.push(`- \`${s.call}\` → ${s.returns}`);
  }
  if (lesson.code) {
    L.push(`\n## 4 · Code (${lesson.code.language})\n`);
    L.push("```" + lesson.code.language);
    L.push(lesson.code.source);
    L.push("```");
    for (const l of lesson.code.lineExplanations || []) L.push(`- \`${l.line}\` — ${l.why}`);
  }
  if (lesson.edgeCases?.length) {
    L.push(`\n## Edge cases\n`);
    for (const e of lesson.edgeCases) L.push(`- ${e}`);
  }
  if (lesson.complexity) {
    L.push(`\n## Complexity\n`);
    L.push(`**Time:** ${lesson.complexity.time} — ${lesson.complexity.timeWhy}`);
    L.push(`**Space:** ${lesson.complexity.space} — ${lesson.complexity.spaceWhy}`);
  }
  if (lesson.tradeoffs?.length) {
    L.push(`\n## Trade-offs\n`);
    for (const t of lesson.tradeoffs) L.push(`- ✓ ${t.pro} / ✗ ${t.con}`);
  }
  if (lesson.interviewPointers?.length) {
    L.push(`\n## Interview pointers\n`);
    for (const p of lesson.interviewPointers) L.push(`- ${p}`);
  }
  if (lesson.revisionNotes?.length) {
    L.push(`\n## Revision notes\n`);
    for (const n of lesson.revisionNotes) L.push(`- ${n}`);
  }
  if (lesson.youtubeQuery) {
    const q = encodeURIComponent(lesson.youtubeQuery);
    L.push(`\n[▶ Watch on YouTube](https://www.youtube.com/results?search_query=${q})`);
  }
  return L.join("\n");
}

// -------- Groq --------
async function fetchLesson({ kind, title, subtitle, row, plan, rebuildWeakSpots = null }) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key. Add one in Settings → AI butler.");

  const user = buildUserPrompt({ kind, title, subtitle, row, plan, rebuildWeakSpots });
  const system = buildSystemPrompt(kind, plan, { rebuildMode: !!rebuildWeakSpots });

  const res = await callGroqJSON({
    apiKey, system, user, maxTokens: 4096, label: "lesson",
    schemaCheck: (obj) => {
      if (!obj || typeof obj !== "object") return "not an object";
      if (!obj.problem) return "missing problem";
      if (!Array.isArray(obj.quiz) || obj.quiz.length < 5) return "quiz needs 5 questions";
      for (let i = 0; i < 5; i++) {
        const q = obj.quiz[i];
        if (!q?.question || !Array.isArray(q.options) || q.options.length !== 4) return `q${i+1} malformed`;
        if (!Number.isInteger(q.correctIdx) || q.correctIdx < 0 || q.correctIdx > 3) return `q${i+1} bad correctIdx`;
      }
      return true;
    },
  });
  if (!res.ok) throw new Error(res.error);
  return normalizeLesson(res.data, plan);
}

// Validate + normalize into the shape paintLesson expects. Dropped keys become
// safe defaults so a thin Groq response still renders rather than throwing.
function normalizeLesson(p, plan) {
  const str = (v) => String(v || "").trim();
  const arr = (v) => Array.isArray(v) ? v : [];
  const normStr = (v) => str(v);
  const normStrList = (v) => arr(v).map(str).filter(Boolean);

  const lesson = {
    oneLineGist: normStr(p.oneLineGist),
    problem: {
      setup: normStr(p.problem?.setup),
      example: normStr(p.problem?.example),
      imageQuery: normStr(p.problem?.imageQuery),
    },
    intuition: {
      setup: normStr(p.intuition?.setup),
      trick: normStr(p.intuition?.trick),
      whyItWorks: normStr(p.intuition?.whyItWorks),
      imageQuery: normStr(p.intuition?.imageQuery),
    },
    dryRun: p.dryRun ? {
      example: normStr(p.dryRun.example),
      steps: arr(p.dryRun.steps).map(s => ({ call: normStr(s.call), returns: normStr(s.returns) })).filter(s => s.call || s.returns),
      imageQuery: normStr(p.dryRun.imageQuery),
    } : null,
    code: p.code ? {
      language: normStr(p.code.language) || CODE_DEFAULT_LANG,
      source: normStr(p.code.source),
      lineExplanations: arr(p.code.lineExplanations).map(l => ({ line: normStr(l.line), why: normStr(l.why) })).filter(l => l.line),
    } : null,
    edgeCases: normStrList(p.edgeCases),
    complexity: p.complexity ? {
      time: normStr(p.complexity.time),
      timeWhy: normStr(p.complexity.timeWhy),
      space: normStr(p.complexity.space),
      spaceWhy: normStr(p.complexity.spaceWhy),
    } : null,
    tradeoffs: arr(p.tradeoffs).map(t => ({ pro: normStr(t.pro), con: normStr(t.con) })).filter(t => t.pro || t.con),
    interviewPointers: normStrList(p.interviewPointers).slice(0, 4),
    revisionNotes: normStrList(p.revisionNotes).slice(0, 4),
    youtubeQuery: normStr(p.youtubeQuery),
    quiz: arr(p.quiz).map(q => ({
      question: normStr(q.question),
      options: arr(q.options).map(str).filter(Boolean).slice(0, 4),
      correctIdx: Number.isInteger(q.correctIdx) ? q.correctIdx : 0,
      explanation: normStr(q.explanation),
    })).filter(q => q.question && q.options.length === 4).slice(0, 5),
    // what the lesson actually renders in order
    plan,
  };
  if (lesson.quiz.length < 5) throw new Error("Quiz missing — Groq returned fewer than 5 valid questions.");
  return lesson;
}

// Teaching-structure prompt. 6-section pedagogy + 5-question quiz with strict
// distractor rules. Groq fills it as JSON in one shot (~2500-3500 tokens).
function buildSystemPrompt(kind, plan, { rebuildMode = false } = {}) {
  const isProgrammatic = kind === "dsa" || kind === "sql";
  const codeLang = kind === "sql" ? "sql" : CODE_DEFAULT_LANG;

  const schemaParts = [];
  schemaParts.push(`"oneLineGist": "one sentence capturing the key idea"`);
  schemaParts.push(`"problem": {"setup": "plain-English what the problem asks", "example": "one tiny worked example e.g. myPow(2,4)=16", "imageQuery": "google image query for a problem diagram, or empty"}`);
  schemaParts.push(`"intuition": {"setup": "lead-in sentence", "trick": "the key insight in one sentence", "whyItWorks": "2-3 sentences explaining the invariant", "imageQuery": "google image query for an intuition visualization, or empty"}`);
  if (plan.includes("dryRun")) {
    schemaParts.push(`"dryRun": {"example": "the specific input traced", "steps": [{"call": "pow(2,10)", "returns": "32*32 = 1024"}], "imageQuery": "call-stack or trace visualization query, or empty"}`);
  }
  if (plan.includes("code")) {
    schemaParts.push(`"code": {"language": "${codeLang}", "source": "FULL ${codeLang.toUpperCase()} solution with correct indentation and newlines", "lineExplanations": [{"line": "a key line from source", "why": "what it does and why it must be there"}]}`);
  }
  schemaParts.push(`"edgeCases": ["edge case 1", "edge case 2", "edge case 3"]`);
  if (plan.includes("complexity")) {
    schemaParts.push(`"complexity": {"time": "O(log n)", "timeWhy": "1-2 sentences", "space": "O(log n)", "spaceWhy": "1-2 sentences"}`);
  }
  if (plan.includes("tradeoffs")) {
    schemaParts.push(`"tradeoffs": [{"pro": "advantage", "con": "cost"}, ...]`);
  }
  schemaParts.push(`"interviewPointers": ["3 bullets each naming a specific follow-up angle an interviewer probes"]`);
  schemaParts.push(`"revisionNotes": ["3 short flashcard-sized points to remember"]`);
  schemaParts.push(`"youtubeQuery": "4-8 word YouTube search for a top-tier explainer"`);
  schemaParts.push(`"quiz": [
    {"question": "Q1 EASY recall — direct from the problem/example", "options": ["A", "B", "C", "D"], "correctIdx": 0, "explanation": "why"},
    {"question": "Q2 MEDIUM concept check — tests understanding of the intuition", "options": ["A", "B", "C", "D"], "correctIdx": 1, "explanation": "why"},
    {"question": "Q3 MEDIUM dry-run — asks what a specific call returns or what state looks like at a step", "options": ["A", "B", "C", "D"], "correctIdx": 2, "explanation": "why"},
    {"question": "Q4 HARD edge case — tests whether the student caught the gotcha", "options": ["A", "B", "C", "D"], "correctIdx": 3, "explanation": "why"},
    {"question": "Q5 HARD interview follow-up — tests the pointer section", "options": ["A", "B", "C", "D"], "correctIdx": 0, "explanation": "why"}
  ]`);

  const rebuildBlock = rebuildMode ? `
REBUILD MODE — the previous version of this lesson was too abstract. The user failed the quiz.
Rewrite it SIMPLER:
- Shorter sentences (max 15 words).
- Everyday-object analogies (a book, a jar, a staircase, a line of people).
- More concrete numbers in every example.
- Expand the dry run to show EVERY step.
- Add explicit "why this works?" after the trick.
- Replace all jargon with plain words on first use.
` : "";

  return `You are a staff FDE interviewer teaching a motivated student their FIRST exposure to this topic.
Clarity > cleverness. Interview-grade knowledge, student-friendly delivery.
${rebuildBlock}
Reply with VALID JSON matching this shape (no markdown, no code fences, no preamble):

{
${schemaParts.map(p => "  " + p).join(",\n")}
}

RULES:
- Return the EXACT keys above. Do not add or drop keys.
- Images: for every imageQuery, pick a search phrase that returns a TEACHING DIAGRAM (not stock photo, not a person). Return empty string if no diagram helps.
- Code: ${isProgrammatic ? `FULL compilable ${codeLang.toUpperCase()} code block. Correct indentation. Standard idiom (${codeLang === "java" ? "public class Solution with a method named per LeetCode convention" : "a single query"}).` : "no code field needed"}
- Quiz difficulty — a serious student who read the lesson or watched the video gets ≥3/5. A skimmer risks failing.
  * Q1 recall: direct from problem/example. Easy IF read.
  * Q2 concept: tests the "trick" — paraphrased, not quoted.
  * Q3 trace: specific call result or state at step N. Must align with the dryRun section.
  * Q4 edge-case: pick the gotcha the student might miss. Must align with edgeCases list.
  * Q5 interview pointer: ties to interviewPointers section.
- Distractors: all 4 options MUST be plausible — no "banana" throwaways. Wrong options should encode real misconceptions a half-prepared student holds. NO "all/none of the above". NO yes/no. Exactly one correct answer.
- Tone: teacher-first, concrete, keyword-dense. Mention specific products / numbers / data structures.
- Keep oneLineGist to ONE short sentence.
- Keep interviewPointers and revisionNotes to EXACTLY 3 items each.

Reply as JSON.`;
}

function buildUserPrompt({ kind, title, subtitle, row, plan, rebuildWeakSpots }) {
  const bits = [];
  bits.push(`Topic: ${title}`);
  if (subtitle) bits.push(`Context: ${subtitle}`);
  const noisy = /^(status|datesolved|datedone|solution|notes|confidence|seq)$/i;
  const kv = Object.entries(row || {})
    .filter(([k, v]) => v && String(v).trim() && !noisy.test(k))
    .map(([k, v]) => `${k}: ${String(v).trim()}`);
  if (kv.length) bits.push("Row data:\n" + kv.join("\n"));
  if (rebuildWeakSpots && rebuildWeakSpots.length) {
    bits.push(`\nThe student previously missed these quiz questions:\n${rebuildWeakSpots.map((q, i) => `${i + 1}. ${q}`).join("\n")}\nRebuild to make these concepts crystal clear.`);
  }
  bits.push(`\nGenerate the lesson as JSON following the schema exactly.`);
  return bits.join("\n");
}

// -------- Media resolution — images (SerpAPI) + YouTube video (YouTube Data API preferred, SerpAPI fallback) --------
async function resolveMedia(scrim, { imageQueries, youtubeQuery }) {
  const serpKey = await secure.get("serpapi_key").catch(() => null);
  const ytKey   = await secure.get("youtube_api_key").catch(() => null);
  // Image path walks whatever `.lsn-img[data-q]` figures the renderer dropped
  // inline; the imageQueries arg is informational-only (not required).
  const inlineFigures = Array.from(scrim.querySelectorAll(".lsn-img[data-q]"));
  const hasImages = inlineFigures.length > 0 || imageQueries?.length;
  const hasVideo = !!youtubeQuery;

  // Degrade image slots if no SerpAPI key.
  if (hasImages && !serpKey) {
    scrim.querySelectorAll(".lsn-img").forEach(fig => {
      const slot = fig.querySelector(".lsn-img-slot");
      if (slot) slot.innerHTML = `<a href="#settings" class="lsn-img-nokey">Add a SerpAPI key in Settings → Media (optional) to show diagrams</a>`;
    });
  }

  const tasks = [];

  if (hasImages && serpKey) {
    for (const fig of scrim.querySelectorAll(".lsn-img")) {
      tasks.push((async () => {
        const q = fig.dataset.q;
        if (!q) return;
        const slot = fig.querySelector(".lsn-img-slot");
        const imgCacheKey = IMG_CACHE_PREFIX + q.toLowerCase();
        let url = null;
        let fetchErr = null;
        try {
          const cached = localStorage.getItem(imgCacheKey);
          if (cached) url = cached;
        } catch (_) {}
        if (!url) {
          try {
            url = await fetchSerpImage(serpKey, q);
            if (url) { try { localStorage.setItem(imgCacheKey, url); } catch (_) {} }
          } catch (e) { fetchErr = e; }
        }
        if (url && slot) {
          slot.innerHTML = `<img src="${esc(url)}" alt="${esc(q)}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=&quot;lsn-img-fail&quot;>image unavailable</span>'" />`;
        } else if (slot) {
          const msg = fetchErr ? esc(String(fetchErr.message || fetchErr)) : "no image match";
          slot.innerHTML = `<span class="lsn-img-fail" title="${msg}">${fetchErr ? "⚠ " + msg : "no image match"}</span>`;
        }
      })());
    }
  }

  if (hasVideo) {
    tasks.push((async () => {
      const slot = scrim.querySelector("#lsn-vid-slot");
      if (!slot) return;

      // Both keys missing — show the search-on-YouTube nudge immediately.
      if (!ytKey && !serpKey) {
        const q = encodeURIComponent(youtubeQuery);
        slot.innerHTML = `
          <a class="lsn-vid-nokey" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener" data-ext>
            <span>Search YouTube for "<b>${esc(youtubeQuery)}</b>"</span>
            <small>Add a YouTube Data API key (free) in Settings — guarantees embeddable results, zero Error 153.</small>
          </a>
        `;
        return;
      }

      const vidCacheKey = IMG_CACHE_PREFIX + "yt:" + youtubeQuery.toLowerCase();
      let candidates = null;
      try {
        const cached = localStorage.getItem(vidCacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          candidates = Array.isArray(parsed.candidates) ? parsed.candidates : null;
        }
      } catch (_) {}

      if (!candidates || !candidates.length) {
        // Prefer YouTube Data API — guarantees `videoEmbeddable=true`, so
        // Error 101/150 ("153" in some players) is structurally impossible.
        if (ytKey) {
          try {
            const picked = await fetchYouTubeDataAPI(ytKey, youtubeQuery);
            if (picked?.candidates?.length) candidates = picked.candidates;
          } catch (_) {}
        }
        // SerpAPI fallback when Data API key missing or quota-exhausted.
        if ((!candidates || !candidates.length) && serpKey) {
          try {
            const picked = await fetchSerpYouTube(serpKey, youtubeQuery);
            if (picked?.candidates?.length) candidates = picked.candidates;
          } catch (_) {}
        }
        if (candidates?.length) {
          try { localStorage.setItem(vidCacheKey, JSON.stringify({ candidates })); } catch (_) {}
        }
      }

      if (candidates?.length) {
        renderVideo(slot, { candidates, youtubeQuery, currentIdx: 0 });
      } else {
        const q = encodeURIComponent(youtubeQuery);
        slot.innerHTML = `
          <a class="lsn-vid-nokey" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener" data-ext>
            <span>No match found. Search YouTube for "<b>${esc(youtubeQuery)}</b>"</span>
          </a>
        `;
      }
    })());
  }

  await Promise.all(tasks);
}

// Render via YouTube IFrame Player API: catches onError and silently cycles
// to the next candidate. Combined with YouTube Data API's `videoEmbeddable=true`
// filter, this means Error 153 (embed disabled) is structurally impossible AND
// runtime errors (region block, age gate, deleted video) are auto-skipped.
// If every candidate fails, we fall back to a clean "Watch on YouTube ↗" card
// so the user always has a working path.
// Thumbnail-card UX. YouTube's embed endpoint requires a valid public-https
// Referer header, and in a Tauri webview the origin is `tauri://localhost`
// (not an https URL), so YouTube fires Error 153 on every embed. Rather than
// break the whole app chasing a webview-origin workaround (tried useHttpsScheme
// and the localhost plugin — both introduced regressions), we render a rich
// YouTube-style card with the thumbnail + title + channel + a prominent Watch
// button that opens the video in the system browser via the open_url Rust
// command. Zero Error 153, full-screen playback, no embed restrictions.
// User can cycle through the Data-API-filtered picks with "Try next".
function renderVideo(slot, { candidates, youtubeQuery, currentIdx = 0 }) {
  const total = candidates.length;
  const current = candidates[currentIdx];
  if (!current) {
    renderVideoFallback(slot, { candidates, youtubeQuery });
    return;
  }
  const safeTitle = current.title || youtubeQuery;
  const channel = current.channel || "";
  const videoUrl = `https://www.youtube.com/watch?v=${esc(current.videoId)}`;
  const thumbUrl = `https://i.ytimg.com/vi/${esc(current.videoId)}/hqdefault.jpg`;

  slot.innerHTML = `
    <div class="lsn-vid-thumbcard">
      <a class="lsn-vid-thumb-link" href="${videoUrl}" data-ext title="Open on YouTube">
        <img class="lsn-vid-thumb-img" src="${thumbUrl}" alt="${esc(safeTitle)}" loading="lazy" />
        <div class="lsn-vid-thumb-overlay">
          <div class="lsn-vid-play-btn">▶</div>
        </div>
        <div class="lsn-vid-thumb-badge">YouTube ↗</div>
      </a>
      <div class="lsn-vid-thumb-meta">
        <div class="lsn-vid-thumb-title">${esc(safeTitle)}</div>
        ${channel ? `<div class="lsn-vid-thumb-channel">${esc(channel)}</div>` : ""}
      </div>
      <div class="lsn-vid-controls static">
        <span class="lsn-vid-counter">${currentIdx + 1} of ${total}</span>
        ${total > 1 ? `<button class="lsn-vid-ctrl" data-next-vid>↷ Try next pick</button>` : ""}
        <a class="lsn-vid-ctrl lsn-vid-ext" href="${videoUrl}" data-ext>▶ Watch on YouTube ↗</a>
      </div>
    </div>
  `;
  slot.querySelector("[data-next-vid]")?.addEventListener("click", () => {
    const nextIdx = (currentIdx + 1) % total;
    renderVideo(slot, { candidates, youtubeQuery, currentIdx: nextIdx });
  });
}

// Final-fallback card when every candidate errors in the Player API — gives the
// user a working outbound link so the lesson never ends on a broken player.
function renderVideoFallback(slot, { candidates, youtubeQuery }) {
  const first = candidates[0];
  const searchQ = encodeURIComponent(youtubeQuery || "");
  slot.innerHTML = `
    <div class="lsn-vid-fallback">
      <div class="lsn-vid-fb-title">Couldn't embed any of the ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}.</div>
      <div class="lsn-vid-fb-sub">Open the top pick on YouTube — same video, bigger window, no embed restrictions.</div>
      <div class="lsn-vid-fb-actions">
        ${first ? `<a class="lsn-vid-fb-primary" href="https://www.youtube.com/watch?v=${esc(first.videoId)}" target="_blank" rel="noopener" data-ext>▶ Watch "${esc(first.title || youtubeQuery)}" on YouTube ↗</a>` : ""}
        <a class="lsn-vid-fb-secondary" href="https://www.youtube.com/results?search_query=${searchQ}" target="_blank" rel="noopener" data-ext>Browse more results for "${esc(youtubeQuery)}"</a>
      </div>
    </div>
  `;
}

// Lazy-load the YouTube IFrame API exactly once per session. Resolves with
// `window.YT` so each call can `new YT.Player(...)`.
let _ytApiPromise = null;
function ensureYouTubeIframeAPI() {
  if (_ytApiPromise) return _ytApiPromise;
  _ytApiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) { resolve(window.YT); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") { try { prev(); } catch (_) {} }
      resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => reject(new Error("Failed to load YouTube IFrame API"));
    document.head.appendChild(s);
    // Belt-and-braces timeout so a hung load doesn't block the fallback forever.
    setTimeout(() => reject(new Error("YouTube IFrame API load timed out")), 8000);
  });
  return _ytApiPromise;
}

// SerpAPI calls go through the Rust proxy because the public endpoint doesn't
// send CORS headers for browser origins. serpSearch() in store.js wraps invoke.
//
// Bulletproof wrapper: 2 retries on transient failure, validates JSON shape,
// surfaces SerpAPI-level errors (quota, bad key) explicitly, logs each attempt.
async function callSerp(engine, query, apiKey) {
  if (!apiKey) throw new Error("No SerpAPI key set.");
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await serpSearch({ engine, query, apiKey });
      if (!res) throw new Error("empty response");
      if (!res.ok) throw new Error(res.error || "transport failed");
      let json;
      try { json = JSON.parse(res.json); }
      catch (e) { throw new Error(`malformed JSON (${e.message})`); }
      // SerpAPI returns HTTP 200 with a top-level `error` field for
      // quota-exhausted or bad-key failures — these are NOT transient, so we
      // don't retry.
      if (json.error) {
        const msg = String(json.error);
        // "Your searches have run out" / "Invalid API key" are permanent for this call.
        if (/searches|key|credit|quota|unauthorized|invalid/i.test(msg)) {
          throw Object.assign(new Error(`SerpAPI: ${msg}`), { permanent: true });
        }
        throw new Error(`SerpAPI: ${msg}`);
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (e.permanent) throw e;  // no point retrying
      console.warn(`[serp:${engine}] attempt ${attempt} — ${e.message || e}`);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 400 * attempt));  // 400ms, 800ms
      }
    }
  }
  throw lastErr || new Error("SerpAPI exhausted retries");
}

// Pick the most reliable embeddable image URL from a SerpAPI result item.
// Order of preference:
//   1. thumbnail (Google-cached, always https, always fast)
//   2. original — only if https (CSP blocks http)
//   3. source + thumbnail hybrid (some entries have only one)
function pickImageUrl(r) {
  if (!r) return null;
  const t = r.thumbnail;
  if (t && /^https:/.test(t)) return t;
  const o = r.original;
  if (o && /^https:/.test(o)) return o;
  const s = r.source;
  if (s && /^https:/.test(s) && /\.(jpg|jpeg|png|gif|webp|svg)/i.test(s)) return s;
  return null;
}

async function fetchSerpImage(apiKey, query) {
  const json = await callSerp("google_images", query, apiKey);
  const list = Array.isArray(json.images_results) ? json.images_results : [];
  if (!list.length) return null;
  for (const r of list) {
    const u = pickImageUrl(r);
    if (u) return u;
  }
  return null;
}

async function fetchSerpYouTube(apiKey, query) {
  const json = await callSerp("youtube", query, apiKey);
  const list = Array.isArray(json.video_results) ? json.video_results : [];
  if (!list.length) return null;
  const candidates = [];
  for (const r of list.slice(0, 8)) {
    const id = extractYouTubeId(r.link || "");
    if (id && !candidates.find(c => c.videoId === id)) {
      candidates.push({ videoId: id, title: r.title || "", channel: r.channel?.name || "" });
      if (candidates.length >= 5) break;
    }
  }
  if (!candidates.length) return null;
  return { candidates };
}

// YouTube Data API v3 — the embeddable guarantee layer. Every item it returns
// has videoEmbeddable=true, so uploader-disabled-embed (Error 101/150/"153")
// can't occur. Runtime failures (region/age/privated) are still auto-skipped
// by the Player API's onError.
async function fetchYouTubeDataAPI(apiKey, query) {
  const res = await youtubeSearch({ query, apiKey, maxResults: 5 });
  if (!res || !res.ok) throw new Error(res?.error || "YouTube Data API call failed");
  const json = JSON.parse(res.json);
  if (json.error) throw new Error(json.error.message || "YouTube Data API error");
  const items = Array.isArray(json.items) ? json.items : [];
  const candidates = [];
  for (const item of items) {
    const id = item.id?.videoId;
    if (!id) continue;
    if (candidates.find(c => c.videoId === id)) continue;
    candidates.push({
      videoId: id,
      title: item.snippet?.title || "",
      channel: item.snippet?.channelTitle || "",
    });
    if (candidates.length >= 5) break;
  }
  if (!candidates.length) return null;
  return { candidates };
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
    .lsn-vid-counter {
      padding: 6px 10px; font: 500 11px/1 var(--font-sans);
      color: color-mix(in oklab, #fff 70%, transparent);
      letter-spacing: .02em;
    }
    .lsn-vid-frame {
      position: absolute; inset: 0;
    }
    .lsn-vid-ch { opacity: .75; font-weight: 500; }

    /* Final fallback card — zero-broken-player guarantee */
    /* --- Thumbnail-card UX (replaces broken-in-Tauri iframe embed) --- */
    .lsn-vid-thumbcard {
      display: flex; flex-direction: column; width: 100%; height: 100%;
      background: #000;
    }
    .lsn-vid-thumb-link {
      position: relative; display: block; flex: 1 1 auto; min-height: 0;
      overflow: hidden; cursor: pointer; text-decoration: none;
    }
    .lsn-vid-thumb-img {
      width: 100%; height: 100%; object-fit: cover; display: block;
      transition: transform .4s ease;
    }
    .lsn-vid-thumb-link:hover .lsn-vid-thumb-img { transform: scale(1.03); }
    .lsn-vid-thumb-overlay {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,.3) 100%);
      transition: background .25s ease;
    }
    .lsn-vid-thumb-link:hover .lsn-vid-thumb-overlay { background: linear-gradient(180deg, rgba(0,0,0,.1) 0%, rgba(0,0,0,.45) 100%); }
    .lsn-vid-play-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 68px; height: 48px; border-radius: 12px;
      background: #ff0033; color: #fff;
      font-size: 24px; line-height: 1;
      box-shadow: 0 10px 30px rgba(0,0,0,.5);
      transition: all .22s ease;
    }
    .lsn-vid-thumb-link:hover .lsn-vid-play-btn { background: #ff1744; transform: scale(1.08); box-shadow: 0 14px 36px rgba(255,0,51,.4); }
    .lsn-vid-thumb-badge {
      position: absolute; top: 10px; right: 10px;
      padding: 5px 10px; border-radius: 6px;
      background: rgba(0,0,0,.7); color: #fff;
      font: 700 10px/1 var(--font-sans); letter-spacing: .08em;
      backdrop-filter: blur(6px);
    }
    .lsn-vid-thumb-meta {
      padding: 10px 14px 6px;
      background: #0a0a0a; color: #fff;
    }
    .lsn-vid-thumb-title { font: 600 13px/1.4 var(--font-sans); color: #fff; margin-bottom: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .lsn-vid-thumb-channel { font: 500 11.5px/1.3 var(--font-sans); color: color-mix(in oklab, #fff 68%, transparent); }
    .lsn-vid-controls.static {
      position: static; opacity: 1; pointer-events: auto;
      background: #0a0a0a;
      padding: 8px 14px 12px;
      display: flex; gap: 8px; align-items: center;
    }
    .lsn-vid-controls.static .lsn-vid-ctrl { border-radius: 6px; }
    .lsn-vid-controls.static .lsn-vid-counter { font-size: 11px; }
    .lsn-vid-controls.static .lsn-vid-ctrl.lsn-vid-ext { margin-left: auto; background: #ff0033; border-color: #ff0033; color: #fff; }
    .lsn-vid-controls.static .lsn-vid-ctrl.lsn-vid-ext:hover { background: #e6002e; border-color: #e6002e; }

    .lsn-vid-fallback {
      display: flex; flex-direction: column; align-items: stretch; justify-content: center;
      gap: 10px; padding: 24px 28px;
      background: linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%);
      color: #fff; height: 100%;
    }
    .lsn-vid-fb-title { font: 700 15px/1.3 var(--font-sans); color: #fff; }
    .lsn-vid-fb-sub { font: 400 12.5px/1.5 var(--font-sans); color: color-mix(in oklab, #fff 60%, transparent); }
    .lsn-vid-fb-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
    .lsn-vid-fb-primary {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 11px 16px; font: 700 13px/1 var(--font-sans);
      background: #ff0033; color: #fff; border-radius: 10px;
      text-decoration: none; transition: all .18s;
    }
    .lsn-vid-fb-primary:hover { background: #e6002e; transform: translateY(-1px); }
    .lsn-vid-fb-secondary {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 9px 14px; font: 500 12px/1 var(--font-sans);
      color: color-mix(in oklab, #fff 80%, transparent); text-decoration: none;
      border: 1px solid rgba(255,255,255,.18); border-radius: 10px;
      transition: all .18s;
    }
    .lsn-vid-fb-secondary:hover { border-color: rgba(255,255,255,.35); color: #fff; }

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

    /* ---- v2: structured sections ---- */
    .lsn-step {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 24px; height: 24px; padding: 0 7px; border-radius: 7px;
      background: color-mix(in oklab, var(--gold) 14%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--gold) 26%, var(--line));
      color: var(--gold); font: 700 12.5px/1 var(--font-sans);
      margin-right: 10px; letter-spacing: .02em;
    }
    .lsn-sec h3 { display: flex; align-items: center; gap: 0; font-size: 15.5px; font-weight: 700; color: var(--ink); letter-spacing: -.01em; margin: 0 0 10px; }

    /* Status banners */
    .lsn-status {
      display: flex; align-items: center; gap: 10px;
      padding: 11px 14px; margin-bottom: 18px;
      border-radius: 10px; font: 500 13px/1.4 var(--font-sans);
    }
    .lsn-status.pass { background: color-mix(in oklab, var(--green) 10%, var(--paper)); border: 1px solid color-mix(in oklab, var(--green) 28%, var(--line)); color: var(--ink); }
    .lsn-status.needhelp { background: color-mix(in oklab, #e9b100 10%, var(--paper)); border: 1px solid color-mix(in oklab, #e9b100 32%, var(--line)); color: var(--ink); }
    .lsn-status span { font-size: 15px; font-weight: 700; }

    /* Problem */
    .lsn-example {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; margin: 10px 0 0;
      background: var(--bg); border-left: 3px solid var(--gold); border-radius: 0 8px 8px 0;
    }
    .lsn-example-tag { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }
    .lsn-example code { font: 500 13px/1.4 var(--font-mono, ui-monospace,SFMono-Regular,Menlo,monospace); color: var(--ink); }

    /* Intuition */
    .lsn-trick {
      display: flex; flex-direction: column; gap: 4px;
      padding: 12px 14px; margin: 10px 0;
      background: color-mix(in oklab, var(--blue, #3870ff) 7%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--blue, #3870ff) 20%, var(--line));
      border-radius: 10px; font: 500 13.5px/1.5 var(--font-sans); color: var(--ink);
    }
    .lsn-trick-tag { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--blue, #3870ff); }
    .lsn-why { font: 400 13px/1.6 var(--font-sans); color: var(--ink); opacity: .88; margin: 8px 0 0; }

    /* Dry run */
    .lsn-steps { list-style: none; margin: 10px 0 0; padding: 0; counter-reset: step; }
    .lsn-steps li {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; margin-bottom: 4px;
      background: var(--bg); border-radius: 6px;
      font: 500 12.5px/1.4 var(--font-mono, ui-monospace,monospace);
    }
    .lsn-steps li::before { counter-increment: step; content: counter(step); display: inline-flex; width: 20px; height: 20px; border-radius: 50%; background: var(--paper); border: 1px solid var(--line); align-items: center; justify-content: center; font: 700 10px/1 var(--font-sans); color: var(--mut); flex-shrink: 0; }
    .lsn-step-call { color: var(--ink); }
    .lsn-step-arrow { color: var(--mut); font-weight: 700; }
    .lsn-step-ret { color: var(--green); }

    /* Code block */
    .lsn-code-badge { margin-left: auto; font: 700 10px/1 var(--font-sans); letter-spacing: .14em; padding: 4px 8px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; color: var(--mut); }
    .lsn-code-wrap { position: relative; margin: 6px 0 12px; }
    .lsn-code {
      margin: 0; padding: 16px 18px;
      background: #0d1117; color: #e6edf3;
      border-radius: 10px;
      font: 500 12.5px/1.65 var(--font-mono, ui-monospace,SFMono-Regular,Menlo,monospace);
      overflow-x: auto; white-space: pre;
      max-height: 420px; overflow-y: auto;
      border: 1px solid #1a1f27;
    }
    .lsn-code code { font: inherit; color: inherit; background: transparent; }
    .lsn-code-copy {
      position: absolute; top: 8px; right: 8px;
      width: 28px; height: 28px; border-radius: 6px;
      background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14);
      color: #e6edf3; cursor: pointer;
      font-size: 13px; display: inline-flex; align-items: center; justify-content: center;
      transition: all .18s;
    }
    .lsn-code-copy:hover { background: rgba(255,255,255,.16); }
    .lsn-line-ex { list-style: none; padding: 0; margin: 10px 0 0; }
    .lsn-line-ex li { display: grid; grid-template-columns: minmax(100px, 240px) 1fr; gap: 12px; padding: 6px 0; border-bottom: 1px dashed var(--line); align-items: start; }
    .lsn-line-ex li:last-child { border-bottom: none; }
    .lsn-line-code { font: 500 12px/1.4 var(--font-mono, ui-monospace,monospace); color: var(--ink); background: var(--bg); padding: 3px 7px; border-radius: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lsn-line-why { font: 400 13px/1.5 var(--font-sans); color: var(--ink); opacity: .9; }

    /* Edge cases */
    .lsn-edges { list-style: none; padding: 0; margin: 6px 0 0; }
    .lsn-edges li { display: flex; align-items: flex-start; gap: 10px; padding: 7px 0; border-bottom: 1px dashed var(--line); font: 400 13px/1.5 var(--font-sans); color: var(--ink); }
    .lsn-edges li:last-child { border-bottom: none; }
    .lsn-edge-dot { color: #e9b100; font-size: 13px; flex-shrink: 0; margin-top: 1px; }

    /* Complexity */
    .lsn-complexity { background: color-mix(in oklab, var(--gold) 4%, var(--paper)); border: 1px solid color-mix(in oklab, var(--gold) 16%, var(--line)); border-radius: 12px; padding: 14px 16px; }
    .lsn-cmx-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
    .lsn-cmx-card { padding: 12px 14px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
    .lsn-cmx-label { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); margin-bottom: 6px; }
    .lsn-cmx-big { font: 700 20px/1.2 var(--font-mono, ui-monospace,monospace); color: var(--gold); margin-bottom: 6px; letter-spacing: -.01em; }
    .lsn-cmx-why { font: 400 12px/1.5 var(--font-sans); color: var(--ink); opacity: .85; }
    @media (max-width: 560px) { .lsn-cmx-grid { grid-template-columns: 1fr; } }

    /* Trade-offs */
    .lsn-trade-grid { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
    .lsn-trade-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .lsn-trade-pro, .lsn-trade-con { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 8px; font: 500 12.5px/1.5 var(--font-sans); color: var(--ink); }
    .lsn-trade-pro { background: color-mix(in oklab, var(--green) 8%, var(--paper)); border: 1px solid color-mix(in oklab, var(--green) 22%, var(--line)); }
    .lsn-trade-con { background: color-mix(in oklab, var(--red) 7%, var(--paper)); border: 1px solid color-mix(in oklab, var(--red) 20%, var(--line)); }
    .lsn-trade-pro span { color: var(--green); font-weight: 700; }
    .lsn-trade-con span { color: var(--red); font-weight: 700; }
    @media (max-width: 560px) { .lsn-trade-row { grid-template-columns: 1fr; } }

    /* Mobile — tighten lesson modal across the board */
    @media (max-width: 560px) {
      .lsn-body { padding: 16px 18px; }
      .lsn-sec h3 { font-size: 14.5px; }
      .lsn-step { margin-right: 8px; min-width: 22px; height: 22px; }
      .lsn-code { padding: 12px 14px; font-size: 11.5px; }
      .lsn-code-badge { display: none; }
      .lsn-line-ex li { grid-template-columns: 1fr; gap: 4px; padding: 8px 0; }
      .lsn-line-code { white-space: pre-wrap; word-break: break-word; }
      .lsn-qstem { font-size: 13px; }
      .lsn-qopt { padding: 9px 10px; font-size: 12.5px; }
      .lsn-qr-score { font-size: 24px; }
      .lsn-pointer-list li { padding: 10px 12px 10px 38px; font-size: 12.5px; }
      .lsn-pointer-list li::before { left: 8px; width: 22px; height: 20px; font-size: 9.5px; }
      .lsn-cmx-big { font-size: 18px; }
      .lsn-code-wrap { margin-left: -4px; margin-right: -4px; }
    }

    /* Interview pointers */
    .lsn-pointers { background: color-mix(in oklab, var(--ink) 4%, var(--paper)); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
    .lsn-pointer-list { list-style: none; padding: 0; margin: 8px 0 0; counter-reset: ptr; }
    .lsn-pointer-list li { counter-increment: ptr; position: relative; padding: 10px 14px 10px 44px; margin-bottom: 6px; background: var(--paper); border: 1px solid var(--line); border-radius: 8px; font: 400 13px/1.5 var(--font-sans); color: var(--ink); }
    .lsn-pointer-list li::before { content: "P" counter(ptr); position: absolute; left: 10px; top: 10px; width: 24px; height: 22px; border-radius: 5px; background: var(--ink); color: var(--paper); font: 700 10px/1 var(--font-sans); display: inline-flex; align-items: center; justify-content: center; letter-spacing: .04em; }

    /* Revision notes */
    .lsn-notes { list-style: none; padding: 0; margin: 6px 0 0; }
    .lsn-notes li { display: flex; align-items: flex-start; gap: 10px; padding: 7px 0; font: 400 13px/1.5 var(--font-sans); color: var(--ink); }
    .lsn-note-dot { color: var(--gold); font-size: 10px; flex-shrink: 0; margin-top: 5px; }

    /* --- Quiz --- */
    .lsn-quiz-sec { background: color-mix(in oklab, var(--blue, #3870ff) 4%, var(--paper)); border: 1px solid color-mix(in oklab, var(--blue, #3870ff) 16%, var(--line)); border-radius: 12px; padding: 16px 18px; margin-top: 24px; }
    .lsn-quiz-banner { padding: 10px 12px; margin-bottom: 12px; background: color-mix(in oklab, #e9b100 10%, var(--paper)); border: 1px solid color-mix(in oklab, #e9b100 28%, var(--line)); border-radius: 8px; font: 500 12px/1.4 var(--font-sans); color: var(--ink); }
    .lsn-quiz-banner.last { background: color-mix(in oklab, var(--red) 10%, var(--paper)); border-color: color-mix(in oklab, var(--red) 28%, var(--line)); }
    .lsn-quiz { display: flex; flex-direction: column; gap: 14px; }
    .lsn-qbox { padding: 14px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
    .lsn-qnum { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; color: var(--blue, #3870ff); margin-bottom: 6px; }
    .lsn-qstem { font: 600 14px/1.5 var(--font-sans); color: var(--ink); margin-bottom: 10px; }
    .lsn-qopts { display: flex; flex-direction: column; gap: 6px; }
    .lsn-qopt {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 10px 12px;
      background: var(--bg); color: var(--ink);
      border: 1.5px solid var(--line); border-radius: 8px;
      font: 500 13px/1.4 var(--font-sans); text-align: left; cursor: pointer;
      transition: all .14s;
    }
    .lsn-qopt:hover:not(:disabled) { border-color: var(--blue, #3870ff); background: color-mix(in oklab, var(--blue, #3870ff) 5%, var(--paper)); }
    .lsn-qopt.picked { border-color: var(--blue, #3870ff); background: color-mix(in oklab, var(--blue, #3870ff) 10%, var(--paper)); }
    .lsn-qopt.correct { border-color: var(--green); background: color-mix(in oklab, var(--green) 14%, var(--paper)); }
    .lsn-qopt.wrong { border-color: var(--red); background: color-mix(in oklab, var(--red) 10%, var(--paper)); }
    .lsn-qopt:disabled { cursor: default; }
    .lsn-qmark { display: inline-flex; width: 22px; height: 22px; border-radius: 5px; background: var(--paper); border: 1px solid var(--line); align-items: center; justify-content: center; font: 700 10px/1 var(--font-sans); color: var(--mut); flex-shrink: 0; margin-top: 1px; }
    .lsn-qopt.correct .lsn-qmark { background: var(--green); color: #fff; border-color: var(--green); }
    .lsn-qopt.wrong .lsn-qmark { background: var(--red); color: #fff; border-color: var(--red); }
    .lsn-qtext { flex: 1; }
    .lsn-qexp { margin-top: 8px; padding: 8px 10px; background: var(--bg); border-radius: 6px; font: 400 12px/1.5 var(--font-sans); color: var(--ink); opacity: .9; }
    .lsn-qexp b { font-weight: 700; margin-right: 4px; }
    .lsn-quiz-foot { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; align-items: stretch; }
    .lsn-quiz-result { padding: 14px; border-radius: 10px; text-align: center; }
    .lsn-quiz-result.pass { background: color-mix(in oklab, var(--green) 12%, var(--paper)); border: 1px solid color-mix(in oklab, var(--green) 28%, var(--line)); }
    .lsn-quiz-result.fail { background: color-mix(in oklab, #e9b100 10%, var(--paper)); border: 1px solid color-mix(in oklab, #e9b100 28%, var(--line)); }
    .lsn-qr-score { font: 800 28px/1 var(--font-sans); color: var(--ink); letter-spacing: -.02em; margin-bottom: 4px; }
    .lsn-qr-verdict { font: 600 13px/1.4 var(--font-sans); color: var(--ink); margin-bottom: 6px; }
    .lsn-qr-bounty { font: 500 12px/1.4 var(--font-sans); color: var(--mut); }

    /* --- Quiz v2: one-at-a-time with Prev / Next --- */
    .lsn-quiz-dots { display: flex; justify-content: center; gap: 6px; margin: 4px 0 14px; }
    .lsn-qdot {
      width: 10px; height: 10px; border-radius: 50%;
      background: color-mix(in oklab, var(--mut) 32%, var(--paper));
      border: 1px solid var(--line);
      transition: all .2s;
    }
    .lsn-qdot.done { background: var(--green); border-color: var(--green); }
    .lsn-qdot.current { background: var(--blue, #3870ff); border-color: var(--blue, #3870ff); width: 28px; border-radius: 5px; }
    .lsn-quiz-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; }
    .lsn-quiz-counter { font: 500 12px/1 var(--font-sans); color: var(--mut); letter-spacing: .02em; }
    .lsn-btn#lsn-q-next.submit-ready { background: var(--green); border-color: var(--green); }
    .lsn-btn#lsn-q-next.submit-ready:hover { filter: brightness(1.08); }
    .lsn-quiz-review { margin-top: 14px; }
    .lsn-quiz-review summary { cursor: pointer; font: 600 13px/1 var(--font-sans); color: var(--ink); padding: 10px 12px; background: var(--bg); border-radius: 8px; }
    .lsn-quiz-review summary::marker { color: var(--mut); }
    .lsn-quiz-review .lsn-qbox.review { margin-top: 10px; }
    .lsn-quiz-review .lsn-qbox.review .qr-ok { color: var(--green); }
    .lsn-quiz-review .lsn-qbox.review .qr-no { color: var(--red); }
    .lsn-qopt.review { pointer-events: none; cursor: default; }
    .lsn-qopt.review:hover { background: var(--bg); border-color: var(--line); }
    .lsn-qopt.review.correct { background: color-mix(in oklab, var(--green) 14%, var(--paper)); border-color: var(--green); }
    .lsn-qopt.review.wrong { background: color-mix(in oklab, var(--red) 10%, var(--paper)); border-color: var(--red); }
    .lsn-qopt.review.correct .lsn-qmark { background: var(--green); color: #fff; border-color: var(--green); }
    .lsn-qopt.review.wrong .lsn-qmark { background: var(--red); color: #fff; border-color: var(--red); }
  `;
  document.head.appendChild(style);
}
injectStyles();
