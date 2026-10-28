// Test runner — the full-screen test experience + the scorecard.
//
// openTestRunner(paper, onFinish): launches the timed test modal.
// openScorecard(attemptId): opens the walkthrough for a finished attempt.

import { recordAttempt, getAttempt, finalizeAttempt, gradeCode } from "./testGrading.js";

// ============ TEST MODAL ============
export function openTestRunner(paper, onFinish) {
  injectStyles();
  document.querySelectorAll(".tr-scrim").forEach(s => s.remove());

  // Working copy — we mutate paper.answers as the user picks/types.
  const attempt = { ...paper, answers: paper.answers || {} };
  let currentIdx = 0;
  let timerInt = null;
  const endsAt = Date.now() + attempt.lengthMin * 60 * 1000;
  // Persist a "in-progress" marker so refresh doesn't lose state.
  recordAttempt({ ...attempt });

  const scrim = document.createElement("div");
  scrim.className = "tr-scrim";
  scrim.innerHTML = `
    <div class="tr-modal" role="dialog">
      <header class="tr-top">
        <div class="tr-top-left">
          <div class="tr-top-title">${esc(attempt.title || attempt.sheetName)}</div>
          <div class="tr-top-sub">${attempt.questions.length} questions · ${esc(attempt.difficulty || "mixed")}</div>
        </div>
        <div class="tr-top-timer">
          <div class="tr-timer-ic">⏱</div>
          <div class="tr-timer-text" id="tr-timer">${fmtClock(attempt.lengthMin * 60)}</div>
        </div>
        <div class="tr-top-right">
          <button class="tr-btn-ghost" id="tr-exit" title="Submit what you have and finish early">Submit</button>
        </div>
      </header>
      <div class="tr-main">
        <aside class="tr-nav" id="tr-nav"></aside>
        <section class="tr-body" id="tr-body"></section>
      </div>
      <footer class="tr-foot">
        <button class="tr-btn-ghost" id="tr-prev">← Prev</button>
        <div class="tr-foot-stats" id="tr-foot-stats"></div>
        <button class="tr-btn-primary" id="tr-next">Next →</button>
      </footer>
    </div>
  `;
  document.body.appendChild(scrim);

  const paintNav = () => {
    const nav = scrim.querySelector("#tr-nav");
    nav.innerHTML = attempt.questions.map((q, i) => {
      const answered = isAnswered(attempt.answers[q.id], q);
      const current = i === currentIdx;
      return `
        <button class="tr-nav-dot ${current ? "current" : ""} ${answered ? "answered" : ""} type-${q.type}"
                data-nav="${i}" title="${esc(q.topic || "")}">
          <span>${i + 1}</span>
        </button>
      `;
    }).join("");
    nav.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => { currentIdx = Number(b.dataset.nav); paintBody(); }));
    const answered = attempt.questions.filter(q => isAnswered(attempt.answers[q.id], q)).length;
    scrim.querySelector("#tr-foot-stats").textContent = `${answered}/${attempt.questions.length} answered · Q ${currentIdx + 1} of ${attempt.questions.length}`;
  };

  const paintBody = () => {
    const q = attempt.questions[currentIdx];
    const body = scrim.querySelector("#tr-body");
    body.innerHTML = renderQuestion(q, attempt.answers[q.id] || {}, currentIdx + 1);
    wireQuestion(body, q, attempt);
    scrim.querySelector("#tr-prev").disabled = currentIdx === 0;
    scrim.querySelector("#tr-next").textContent = currentIdx === attempt.questions.length - 1 ? "Submit for grading" : "Next →";
    paintNav();
  };

  scrim.querySelector("#tr-prev").addEventListener("click", () => { if (currentIdx > 0) { currentIdx--; paintBody(); } });
  scrim.querySelector("#tr-next").addEventListener("click", async () => {
    if (currentIdx === attempt.questions.length - 1) await submit();
    else { currentIdx++; paintBody(); }
  });
  scrim.querySelector("#tr-exit").addEventListener("click", async () => { await submit(); });

  // Timer tick
  const tickTimer = () => {
    const remainingMs = endsAt - Date.now();
    const el = scrim.querySelector("#tr-timer");
    if (!el) return;
    if (remainingMs <= 0) {
      el.textContent = "00:00";
      el.classList.add("expired");
      clearInterval(timerInt);
      submit(/*timedOut*/ true);
      return;
    }
    el.textContent = fmtClock(Math.ceil(remainingMs / 1000));
    el.classList.toggle("warn", remainingMs < 5 * 60 * 1000);
  };
  tickTimer();
  timerInt = setInterval(tickTimer, 1000);

  // Keyboard shortcuts
  const onKey = (e) => {
    const q = attempt.questions[currentIdx];
    // Don't hijack typing inside inputs/textareas (for written/coding)
    if (e.target.matches("textarea, input")) return;
    if (q.type === "mcq" && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      const idx = Number(e.key) - 1;
      saveAnswer(attempt, q, { response: idx });
      paintBody();
    } else if (e.key === "ArrowRight") {
      if (currentIdx < attempt.questions.length - 1) { currentIdx++; paintBody(); }
    } else if (e.key === "ArrowLeft") {
      if (currentIdx > 0) { currentIdx--; paintBody(); }
    } else if (e.key === "Escape") {
      // No accidental close — require Submit
    }
  };
  document.addEventListener("keydown", onKey);

  const submit = async (timedOut = false) => {
    if (scrim._submitted) return;
    scrim._submitted = true;
    clearInterval(timerInt);
    document.removeEventListener("keydown", onKey);
    // Confirm if there are unanswered questions and user triggered submit manually
    if (!timedOut) {
      const unanswered = attempt.questions.filter(q => !isAnswered(attempt.answers[q.id], q)).length;
      if (unanswered > 0) {
        const { showConfirm } = await import("./modals.js");
        const ok = await showConfirm({
          title: `${unanswered} unanswered — submit anyway?`,
          message: "Unanswered questions score 0. You can still Grade written/coding at review time, but MCQs are final.",
          confirmLabel: "Submit anyway",
          tone: "warn",
        });
        if (!ok) {
          scrim._submitted = false;
          // Restart timer
          timerInt = setInterval(tickTimer, 1000);
          document.addEventListener("keydown", onKey);
          return;
        }
      }
    }
    // Grading overlay
    const body = scrim.querySelector("#tr-body");
    body.innerHTML = `
      <div class="tr-grading">
        <div class="tr-spin-big"></div>
        <h3>Grading…</h3>
        <p>Groq is scoring your written + coding answers. Hold tight.</p>
      </div>
    `;
    try {
      const finished = await finalizeAttempt(attempt);
      scrim.remove();
      if (typeof onFinish === "function") onFinish(finished);
      openScorecard(finished.id);
    } catch (err) {
      const { showAlert } = await import("./modals.js");
      await showAlert({ title: "Grading failed", message: String(err.message || err), tone: "error" });
      scrim._submitted = false;
    }
  };

  paintBody();
}

function renderQuestion(q, a, qNum) {
  const header = `
    <header class="tr-q-head">
      <span class="tr-q-num">Q${qNum}</span>
      <span class="tr-q-type type-${q.type}">${q.type === "mcq" ? "MCQ" : q.type === "written" ? "WRITTEN · 5pt" : "CODING · 10pt"}</span>
      <span class="tr-q-topic">${esc(q.topic || "")}</span>
      ${q.isStoryMode ? `<span class="tr-q-story">🎭 Story mode</span>` : ""}
    </header>
  `;
  const stem = `<div class="tr-q-stem">${renderMultiline(q.stem)}</div>`;

  if (q.type === "mcq") {
    const picked = Number.isInteger(a.response) ? a.response : -1;
    return `
      ${header}${stem}
      <div class="tr-mcq-opts">
        ${q.options.map((opt, i) => `
          <button class="tr-mcq-opt ${picked === i ? "picked" : ""}" data-opt-idx="${i}">
            <span class="tr-mcq-mark">${String.fromCharCode(65 + i)}</span>
            <span class="tr-mcq-text">${esc(opt)}</span>
          </button>
        `).join("")}
      </div>
      <p class="tr-q-hint">press <kbd>1</kbd>–<kbd>4</kbd> or click</p>
    `;
  }
  if (q.type === "written") {
    return `
      ${header}${stem}
      <textarea class="tr-written" placeholder="Write your answer here — be specific. Groq grades against a model answer + rubric at submit.">${esc(a.response || "")}</textarea>
      <p class="tr-q-hint">0-5 pts · benchmarked against a model answer</p>
    `;
  }
  if (q.type === "coding") {
    const grade = a.codeGrade;
    const codeValue = a.response || q.starterCode || "";
    const examplesHtml = (q.examples || []).map((ex, i) => `
      <div class="tr-code-example">
        <div class="tr-code-example-head">Example ${i + 1}</div>
        ${ex.input ? `<div class="tr-code-example-row"><span>Input:</span><code>${esc(ex.input)}</code></div>` : ""}
        ${ex.output ? `<div class="tr-code-example-row"><span>Output:</span><code>${esc(ex.output)}</code></div>` : ""}
        ${ex.explanation ? `<div class="tr-code-example-row tr-code-example-exp"><span>Explanation:</span><p>${esc(ex.explanation)}</p></div>` : ""}
      </div>
    `).join("");
    const constraintsHtml = (q.constraints || []).length ? `
      <div class="tr-code-constraints">
        <div class="tr-code-constraints-h">Constraints</div>
        <ul>${q.constraints.map(c => `<li><code>${esc(c)}</code></li>`).join("")}</ul>
      </div>
    ` : "";
    return `
      ${header}
      <div class="tr-code-portal">
        <div class="tr-code-prompt">
          ${q.problemTitle ? `<h2 class="tr-code-title">${esc(q.problemTitle)}</h2>` : ""}
          ${q.stem ? `<div class="tr-code-stem">${renderMultiline(q.stem)}</div>` : ""}
          ${examplesHtml}
          ${constraintsHtml}
          ${q.functionSignature ? `
            <div class="tr-code-sig">
              <div class="tr-code-sig-h">Function signature</div>
              <code>${esc(q.functionSignature)}</code>
            </div>
          ` : ""}
          ${q.complexityExpectation ? `
            <div class="tr-code-target">
              <span class="tr-code-target-h">Target complexity:</span>
              <code>${esc(q.complexityExpectation)}</code>
            </div>
          ` : ""}
        </div>
        <div class="tr-code-editor">
          <div class="tr-code-editor-head">
            <label class="tr-coding-label">YOUR CODE · ${esc(q.topic || "")}</label>
            <button class="tr-code-reset" data-reset-code title="Reset to the starter stub">↺ Reset</button>
          </div>
          <textarea class="tr-coding-input" spellcheck="false" placeholder="// Write your solution here…">${esc(codeValue)}</textarea>
          <div class="tr-coding-actions">
            <button class="tr-btn-primary tr-btn-sm" data-run>▶ Run</button>
            <span class="tr-coding-note">Groq checks correctness + 3 edge cases + complexity + 1 improvement.</span>
          </div>
          <div class="tr-code-grade" id="tr-coding-grade">
            ${grade ? renderCodeGrade(grade) : `<div class="tr-coding-empty">Click Run to grade. You can edit and re-run as many times as you want.</div>`}
          </div>
        </div>
      </div>
    `;
  }
  return "<div>Unknown question type</div>";
}

function wireQuestion(body, q, attempt) {
  if (q.type === "mcq") {
    body.querySelectorAll("[data-opt-idx]").forEach(btn => {
      btn.addEventListener("click", () => {
        saveAnswer(attempt, q, { response: Number(btn.dataset.optIdx) });
        body.querySelectorAll(".tr-mcq-opt").forEach(b => b.classList.remove("picked"));
        btn.classList.add("picked");
        // Update nav state too
        document.querySelectorAll(`[data-nav]`).forEach(n => n.classList.remove());
        document.querySelector(`.tr-scrim [data-nav="${attempt.questions.findIndex(x => x.id === q.id)}"]`)?.classList.add("answered");
      });
    });
  } else if (q.type === "written") {
    const ta = body.querySelector(".tr-written");
    let t;
    ta.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        saveAnswer(attempt, q, { response: ta.value });
      }, 220);
    });
  } else if (q.type === "coding") {
    const ta = body.querySelector(".tr-coding-input");
    let t;
    ta.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        saveAnswer(attempt, q, { response: ta.value });
      }, 220);
    });
    body.querySelector("[data-reset-code]")?.addEventListener("click", () => {
      if (q.starterCode) { ta.value = q.starterCode; saveAnswer(attempt, q, { response: q.starterCode }); }
    });
    body.querySelector("[data-run]")?.addEventListener("click", async (e) => {
      e.preventDefault();
      const btn = body.querySelector("[data-run]");
      const code = ta.value.trim();
      if (!code) return;
      const slot = body.querySelector("#tr-coding-grade");
      btn.disabled = true;
      const original = btn.innerHTML;
      btn.innerHTML = `<span class="t-spin"></span> Grading…`;
      slot.innerHTML = `<div class="tr-coding-empty">Groq is checking…</div>`;
      try {
        const grade = await gradeCode({ question: q, code });
        saveAnswer(attempt, q, { response: code, codeGrade: grade });
        slot.innerHTML = renderCodeGrade(grade);
      } catch (err) {
        slot.innerHTML = `<div class="tr-coding-err">Grading failed — ${esc(err.message || String(err))}</div>`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });
  }
}

function renderCodeGrade(g) {
  const vClass = g.correctness === "pass" ? "pass" : g.correctness === "partial" ? "partial" : "fail";
  return `
    <label class="tr-coding-label">GROQ VERDICT</label>
    <div class="tr-code-verdict ${vClass}">
      <span class="tr-code-badge">${g.correctness === "pass" ? "✓ PASS" : g.correctness === "partial" ? "~ PARTIAL" : "✗ FAIL"}</span>
      <p>${esc(g.verdict)}</p>
    </div>
    <div class="tr-code-block">
      <label>EDGE CASES</label>
      <ul class="tr-code-edges">
        ${g.edgeCases.map(ec => `
          <li class="${ec.pass ? "pass" : "fail"}">
            <span class="tr-code-edge-mark">${ec.pass ? "✓" : "✗"}</span>
            <span class="tr-code-edge-name">${esc(ec.name)}</span>
            ${ec.note ? `<span class="tr-code-edge-note">${esc(ec.note)}</span>` : ""}
          </li>
        `).join("")}
      </ul>
    </div>
    <div class="tr-code-block">
      <label>COMPLEXITY</label>
      <div class="tr-code-cx">
        <span>${esc(g.complexity.time)} time</span>
        <span>${esc(g.complexity.space)} space</span>
        <span class="${g.complexity.matchesExpectation ? "ok" : "miss"}">${g.complexity.matchesExpectation ? "matches expected" : "below expected"}</span>
      </div>
    </div>
    <div class="tr-code-block">
      <label>IMPROVEMENT</label>
      <p class="tr-code-impr">${esc(g.improvement)}</p>
    </div>
  `;
}

function saveAnswer(attempt, q, patch) {
  attempt.answers[q.id] = { ...(attempt.answers[q.id] || {}), ...patch };
  recordAttempt({ ...attempt });
}

function isAnswered(a, q) {
  if (!a) return false;
  if (q.type === "mcq") return Number.isInteger(a.response) && a.response >= 0 && a.response <= 3;
  if (q.type === "written") return !!(a.response && String(a.response).trim());
  if (q.type === "coding") return !!(a.response && String(a.response).trim());
  return false;
}

function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderMultiline(s) {
  return esc(s).replace(/\n/g, "<br/>");
}

// ============ SCORECARD ============
export function openScorecard(attemptId) {
  injectStyles();
  const attempt = getAttempt(attemptId);
  if (!attempt) return;
  document.querySelectorAll(".sc-scrim").forEach(s => s.remove());

  const scrim = document.createElement("div");
  scrim.className = "sc-scrim";
  const grade = attempt.score?.grade || "—";
  const pct = attempt.score?.pct ?? 0;
  const timeTaken = (attempt.submittedAt && attempt.createdAt) ? Math.round((attempt.submittedAt - attempt.createdAt) / 60000) : 0;

  scrim.innerHTML = `
    <div class="sc-modal" role="dialog">
      <header class="sc-head">
        <div class="sc-head-left">
          <div class="sc-grade grade-${grade.toLowerCase()}">${esc(grade)}</div>
          <div>
            <div class="sc-eyebrow">SCORECARD</div>
            <h2 class="sc-title">${esc(attempt.title || attempt.sheetName)}</h2>
            <div class="sc-stats">
              <span><b>${pct}%</b> score</span>
              <span><b>${attempt.score?.raw ?? 0}</b>/${attempt.score?.max ?? 0} pts</span>
              ${timeTaken ? `<span><b>${timeTaken}m</b> taken</span>` : ""}
              <span class="sc-bounty">+ ₹${attempt.bountyEarned || 0}</span>
            </div>
          </div>
        </div>
        <button class="sc-close" id="sc-close">×</button>
      </header>

      ${attempt.masteryDeltas && attempt.masteryDeltas.length ? `
        <div class="sc-mastery">
          <label>MASTERY UPDATES</label>
          <div class="sc-mastery-list">
            ${attempt.masteryDeltas.map(d => `
              <span class="sc-mastery-chip ${d.delta >= 0 ? "up" : "down"}">
                ${d.delta >= 0 ? "↑" : "↓"} ${esc(d.topic)}
              </span>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <div class="sc-body">
        ${(attempt.perQ || []).map((row, i) => {
          const q = attempt.questions.find(x => x.id === row.qid);
          if (!q) return "";
          const a = attempt.answers[q.id] || {};
          const correctClass = row.correct ? "pass" : "fail";
          let userAnswerHtml = "";
          let correctAnswerHtml = "";
          if (q.type === "mcq") {
            const picked = Number.isInteger(a.response) ? a.response : -1;
            userAnswerHtml = picked >= 0
              ? `<div class="sc-ans"><label>YOUR ANSWER</label><p>${String.fromCharCode(65 + picked)}. ${esc(q.options[picked] || "")}</p></div>`
              : `<div class="sc-ans"><label>YOUR ANSWER</label><p class="sc-nope">— not answered —</p></div>`;
            correctAnswerHtml = `<div class="sc-ans"><label>CORRECT</label><p>${String.fromCharCode(65 + q.correctIdx)}. ${esc(q.options[q.correctIdx] || "")}</p></div>`;
          } else if (q.type === "written") {
            userAnswerHtml = `<div class="sc-ans"><label>YOUR ANSWER (${a.writtenGrade?.score ?? 0}/5)</label><p>${renderMultiline(a.response || "— not answered —")}</p></div>`;
            correctAnswerHtml = `<div class="sc-ans"><label>MODEL ANSWER</label><p>${renderMultiline(q.modelAnswer || "")}</p></div>`;
          } else if (q.type === "coding") {
            userAnswerHtml = `
              <div class="sc-ans"><label>YOUR CODE${a.codeGrade ? ` (${a.codeGrade.correctness})` : ""}</label>
                <pre class="sc-code">${esc(a.response || "— not answered —")}</pre>
              </div>
            `;
            correctAnswerHtml = `
              <div class="sc-ans"><label>REFERENCE SOLUTION</label>
                <pre class="sc-code">${esc(q.exampleSolution || "")}</pre>
              </div>
            `;
          }
          return `
            <article class="sc-q ${correctClass}">
              <header>
                <span class="sc-q-num">Q${i + 1}</span>
                <span class="sc-q-type">${q.type.toUpperCase()}</span>
                <span class="sc-q-topic">${esc(q.topic || "")}</span>
                <span class="sc-q-pts">${row.earned}/${row.points}</span>
              </header>
              <div class="sc-q-stem">${renderMultiline(q.stem)}</div>
              <div class="sc-q-grid">
                ${userAnswerHtml}
                ${correctAnswerHtml}
              </div>
              ${(q.explanation || row.feedback) ? `
                <div class="sc-explain">
                  <label>WHY</label>
                  <p>${esc(q.explanation || row.feedback || "")}</p>
                  ${q.whyAsked ? `<p class="sc-whyasked"><b>Why interviewers ask this:</b> ${esc(q.whyAsked)}</p>` : ""}
                </div>
              ` : ""}
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.querySelector("#sc-close").addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  const onEsc = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); } };
  document.addEventListener("keydown", onEsc);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

function injectStyles() {
  if (document.getElementById("test-runner-styles")) return;
  const s = document.createElement("style");
  s.id = "test-runner-styles";
  s.textContent = `
    /* ===== TEST MODAL ===== */
    .tr-scrim { position: fixed; inset: 0; z-index: 2000; background: var(--bg, #f5f6f8);
      display: flex; align-items: stretch; justify-content: stretch; }
    .tr-modal { flex: 1; display: flex; flex-direction: column; background: var(--paper); }
    .tr-top {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 24px; border-bottom: 1px solid var(--line);
      background: color-mix(in oklab, var(--mut) 5%, var(--paper));
    }
    .tr-top-left { min-width: 200px; }
    .tr-top-title { font: 700 15px/1.2 var(--font-sans); color: var(--ink); letter-spacing: -.012em; }
    .tr-top-sub { font: 500 11.5px/1.3 var(--font-sans); color: var(--mut); margin-top: 2px; }
    .tr-top-timer {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 18px; border-radius: 999px;
      background: color-mix(in oklab, var(--ink) 94%, var(--paper));
      color: var(--paper);
      font: 800 18px/1 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      letter-spacing: .04em;
    }
    .tr-top-timer .tr-timer-ic { font-size: 16px; opacity: .8; }
    .tr-top-timer .tr-timer-text.warn { color: var(--gold); }
    .tr-top-timer .tr-timer-text.expired { color: var(--red); }
    .tr-top-right { display: flex; gap: 8px; }
    .tr-btn-ghost { padding: 8px 14px; border-radius: 8px; background: var(--paper);
      border: 1px solid var(--line); color: var(--ink); font: 600 12px/1 var(--font-sans); cursor: pointer; }
    .tr-btn-ghost:hover { border-color: var(--line2); background: color-mix(in oklab, var(--ink) 4%, var(--paper)); }
    .tr-btn-primary { padding: 10px 18px; border-radius: 10px; background: var(--ink); color: var(--paper);
      border: none; font: 700 13px/1 var(--font-sans); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    .tr-btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
    .tr-btn-primary.tr-btn-sm { padding: 7px 12px; font-size: 12px; }

    .tr-main { flex: 1; display: grid; grid-template-columns: 220px 1fr; overflow: hidden; }
    .tr-nav { padding: 20px 16px; border-right: 1px solid var(--line); overflow-y: auto;
      display: flex; flex-wrap: wrap; gap: 6px; align-content: flex-start;
      background: color-mix(in oklab, var(--mut) 3%, var(--paper)); }
    .tr-nav-dot {
      width: 36px; height: 36px; border-radius: 8px;
      background: var(--paper); border: 1px solid var(--line); color: var(--ink);
      font: 700 12.5px/1 var(--font-sans); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all .12s ease;
    }
    .tr-nav-dot:hover { border-color: var(--line2); }
    .tr-nav-dot.answered { background: color-mix(in oklab, var(--green) 12%, var(--paper)); border-color: color-mix(in oklab, var(--green) 36%, var(--line)); color: var(--green); }
    .tr-nav-dot.current {
      box-shadow: 0 0 0 3px color-mix(in oklab, var(--ink) 60%, transparent);
      transform: scale(1.03);
    }
    .tr-nav-dot.type-coding { border-left: 3px solid var(--gold); }
    .tr-nav-dot.type-written { border-left: 3px solid var(--blue, #3870ff); }

    .tr-body { padding: 28px 36px; overflow-y: auto; max-width: 900px; width: 100%; margin: 0 auto; }
    .tr-q-head { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .tr-q-num { font: 800 11px/1 var(--font-sans); letter-spacing: .14em; color: var(--gold);
      padding: 5px 9px; border-radius: 6px; background: color-mix(in oklab, var(--gold) 14%, var(--paper)); }
    .tr-q-type { font: 800 10px/1 var(--font-sans); letter-spacing: .18em; padding: 4px 8px; border-radius: 5px; }
    .tr-q-type.type-mcq { color: var(--ink); background: color-mix(in oklab, var(--ink) 8%, var(--paper)); }
    .tr-q-type.type-written { color: var(--blue, #3870ff); background: color-mix(in oklab, var(--blue, #3870ff) 14%, var(--paper)); }
    .tr-q-type.type-coding { color: var(--gold); background: color-mix(in oklab, var(--gold) 16%, var(--paper)); }
    .tr-q-topic { font: 500 12px/1.3 var(--font-sans); color: var(--mut); }
    .tr-q-story { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; color: #8b4bff; padding: 4px 8px; border-radius: 5px; background: color-mix(in oklab, #8b4bff 12%, var(--paper)); }

    .tr-q-stem { font: 500 15.5px/1.7 var(--font-sans); color: var(--ink); margin-bottom: 18px; letter-spacing: -.005em; }
    .tr-q-hint { font: 500 11.5px/1 var(--font-sans); color: var(--mut); margin-top: 10px; letter-spacing: .02em; }
    .tr-q-hint kbd { background: var(--paper); border: 1px solid var(--line); border-radius: 4px; padding: 1px 6px; font-family: inherit; }

    .tr-mcq-opts { display: flex; flex-direction: column; gap: 8px; }
    .tr-mcq-opt {
      display: flex; align-items: center; gap: 12px; width: 100%;
      padding: 12px 16px; border-radius: 10px;
      background: var(--paper); border: 1px solid var(--line); cursor: pointer;
      text-align: left; transition: all .14s ease;
    }
    .tr-mcq-opt:hover { border-color: var(--line2); background: color-mix(in oklab, var(--ink) 3%, var(--paper)); }
    .tr-mcq-opt.picked { background: color-mix(in oklab, var(--gold) 14%, var(--paper)); border-color: color-mix(in oklab, var(--gold) 44%, var(--line)); }
    .tr-mcq-mark { font: 800 13px/1 var(--font-sans); color: var(--gold); min-width: 20px; }
    .tr-mcq-text { font: 500 13.5px/1.5 var(--font-sans); color: var(--ink); }

    .tr-written {
      width: 100%; min-height: 220px; padding: 14px 16px; border-radius: 10px;
      border: 1px solid var(--line); background: var(--paper); color: var(--ink);
      font: 500 14px/1.6 var(--font-sans); resize: vertical;
    }
    .tr-written:focus { outline: 2px solid var(--gold); outline-offset: -2px; }

    /* Pristine coding portal — LeetCode-shaped */
    .tr-code-portal { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 1100px) { .tr-code-portal { grid-template-columns: 1fr; } }
    .tr-code-prompt {
      padding: 20px 22px; border-radius: 14px;
      background: color-mix(in oklab, var(--mut) 4%, var(--paper));
      border: 1px solid var(--line);
      display: flex; flex-direction: column; gap: 14px;
      overflow-y: auto;
      max-height: calc(100vh - 240px);
    }
    .tr-code-title { margin: 0; font: 700 20px/1.3 var(--font-sans); letter-spacing: -.018em; color: var(--ink); }
    .tr-code-stem { font: 500 14px/1.65 var(--font-sans); color: var(--ink); }
    .tr-code-example {
      padding: 12px 14px; border-radius: 10px;
      background: var(--paper); border: 1px solid var(--line);
    }
    .tr-code-example-head {
      font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut);
      margin-bottom: 8px;
    }
    .tr-code-example-row { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; font: 500 13px/1.55 var(--font-sans); color: var(--ink); }
    .tr-code-example-row > span { font-weight: 700; min-width: 72px; color: var(--mut); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
    .tr-code-example-row code { font: 500 12.5px/1.55 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); background: color-mix(in oklab, var(--ink) 92%, var(--paper)); color: var(--paper); padding: 2px 8px; border-radius: 5px; }
    .tr-code-example-row.tr-code-example-exp { align-items: flex-start; }
    .tr-code-example-row.tr-code-example-exp p { margin: 0; font: 500 13px/1.55 var(--font-sans); color: var(--ink); }

    .tr-code-constraints { padding: 12px 14px; border-radius: 10px; background: var(--paper); border: 1px solid var(--line); }
    .tr-code-constraints-h { font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); margin-bottom: 6px; }
    .tr-code-constraints ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
    .tr-code-constraints li { font: 500 12.5px/1.45 var(--font-sans); color: var(--ink); }
    .tr-code-constraints li code { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); background: color-mix(in oklab, var(--mut) 10%, var(--paper)); padding: 1px 6px; border-radius: 4px; }

    .tr-code-sig { padding: 10px 14px; border-radius: 10px;
      background: color-mix(in oklab, var(--gold) 8%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--gold) 28%, var(--line));
      border-left: 3px solid var(--gold);
    }
    .tr-code-sig-h { font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--gold); margin-bottom: 6px; }
    .tr-code-sig code { font: 600 13px/1.4 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); color: var(--ink); background: transparent; padding: 0; }

    .tr-code-target { display: flex; align-items: center; gap: 8px; }
    .tr-code-target-h { font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }
    .tr-code-target code { font: 500 12px/1 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); color: var(--ink); background: color-mix(in oklab, var(--mut) 10%, var(--paper)); padding: 3px 8px; border-radius: 5px; }

    .tr-code-editor { display: flex; flex-direction: column; gap: 10px; }
    .tr-code-editor-head { display: flex; justify-content: space-between; align-items: baseline; }
    .tr-code-reset { padding: 4px 10px; border-radius: 6px; background: var(--paper); border: 1px solid var(--line); color: var(--mut); font: 600 11px/1 var(--font-sans); cursor: pointer; }
    .tr-code-reset:hover { color: var(--ink); border-color: var(--line2); }
    .tr-code-grade { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }
    .tr-coding-label { font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }
    .tr-coding-input {
      width: 100%; min-height: 300px; padding: 14px 16px; border-radius: 10px;
      background: #0e1116; color: #e8edf1; border: 1px solid var(--line);
      font: 500 13px/1.65 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      resize: vertical;
    }
    .tr-coding-input:focus { outline: 2px solid var(--gold); outline-offset: -2px; }
    .tr-coding-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .tr-coding-note { font: 500 11px/1.4 var(--font-sans); color: var(--mut); }
    .tr-coding-empty { padding: 24px; text-align: center; color: var(--mut); font: 500 13px/1.5 var(--font-sans);
      background: color-mix(in oklab, var(--mut) 6%, var(--paper)); border: 1px dashed var(--line); border-radius: 10px; }
    .tr-coding-err { padding: 14px; color: var(--red); font: 500 12.5px/1.5 var(--font-sans);
      background: color-mix(in oklab, var(--red) 8%, var(--paper)); border: 1px solid color-mix(in oklab, var(--red) 24%, var(--line)); border-radius: 10px; }

    .tr-code-verdict { padding: 14px 16px; border-radius: 10px; }
    .tr-code-verdict.pass { background: color-mix(in oklab, var(--green) 10%, var(--paper)); border: 1px solid color-mix(in oklab, var(--green) 28%, var(--line)); }
    .tr-code-verdict.partial { background: color-mix(in oklab, var(--gold) 10%, var(--paper)); border: 1px solid color-mix(in oklab, var(--gold) 28%, var(--line)); }
    .tr-code-verdict.fail { background: color-mix(in oklab, var(--red) 8%, var(--paper)); border: 1px solid color-mix(in oklab, var(--red) 24%, var(--line)); }
    .tr-code-badge { display: inline-block; font: 800 10.5px/1 var(--font-sans); letter-spacing: .18em; margin-bottom: 6px; }
    .tr-code-verdict.pass .tr-code-badge { color: var(--green); }
    .tr-code-verdict.partial .tr-code-badge { color: var(--gold); }
    .tr-code-verdict.fail .tr-code-badge { color: var(--red); }
    .tr-code-verdict p { margin: 0; font: 600 13.5px/1.55 var(--font-sans); color: var(--ink); }

    .tr-code-block { }
    .tr-code-block label { display: block; font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); margin-bottom: 6px; }
    .tr-code-edges { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .tr-code-edges li { display: grid; grid-template-columns: 20px minmax(120px, auto) 1fr; gap: 8px; padding: 8px 10px; border-radius: 8px;
      background: var(--paper); border: 1px solid var(--line); font: 500 12.5px/1.4 var(--font-sans); color: var(--ink); align-items: center; }
    .tr-code-edges li.pass .tr-code-edge-mark { color: var(--green); font-weight: 800; }
    .tr-code-edges li.fail .tr-code-edge-mark { color: var(--red); font-weight: 800; }
    .tr-code-edge-note { color: var(--mut); font-size: 12px; }
    .tr-code-cx { display: flex; gap: 10px; flex-wrap: wrap; font: 600 12.5px/1.3 var(--font-sans); color: var(--ink); }
    .tr-code-cx span { padding: 5px 10px; border-radius: 6px; background: color-mix(in oklab, var(--mut) 6%, var(--paper)); border: 1px solid var(--line); }
    .tr-code-cx .ok { background: color-mix(in oklab, var(--green) 12%, var(--paper)); color: var(--green); border-color: color-mix(in oklab, var(--green) 28%, var(--line)); }
    .tr-code-cx .miss { background: color-mix(in oklab, var(--gold) 12%, var(--paper)); color: var(--gold); border-color: color-mix(in oklab, var(--gold) 28%, var(--line)); }
    .tr-code-impr { margin: 0; padding: 10px 12px; background: color-mix(in oklab, var(--ink) 94%, var(--paper)); color: var(--paper); border-radius: 8px; font: 500 13px/1.5 var(--font-sans); }

    .tr-foot {
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 14px 24px; border-top: 1px solid var(--line);
      background: var(--paper);
    }
    .tr-foot-stats { font: 600 12px/1 var(--font-sans); color: var(--mut); letter-spacing: .02em; }

    .tr-grading { padding: 60px 30px; text-align: center; }
    .tr-grading h3 { margin: 14px 0 6px; font: 600 20px/1.3 var(--font-sans); color: var(--ink); }
    .tr-grading p { margin: 0; color: var(--mut); font: 500 13.5px/1.55 var(--font-sans); }
    .tr-spin-big {
      display: inline-block; width: 36px; height: 36px; border-radius: 50%;
      border: 3px solid color-mix(in oklab, var(--gold) 30%, transparent);
      border-top-color: var(--gold);
      animation: tSpin 1s linear infinite;
    }

    /* ===== SCORECARD ===== */
    .sc-scrim { position: fixed; inset: 0; z-index: 2050; background: rgba(0,0,0,.45);
      display: flex; align-items: flex-start; justify-content: center; padding: 32px 24px; overflow-y: auto; }
    .sc-modal { background: var(--paper); border-radius: 20px; width: 100%; max-width: 820px;
      box-shadow: 0 32px 80px rgba(0,0,0,.25), 0 0 0 1px var(--line); display: flex; flex-direction: column;
      animation: scPop .3s cubic-bezier(.2,1.2,.3,1) both; }
    @keyframes scPop { from { opacity: 0; transform: translateY(16px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .sc-head { padding: 24px 26px 18px; border-bottom: 1px solid var(--line); display: flex; align-items: flex-start; justify-content: space-between; }
    .sc-head-left { display: flex; gap: 16px; align-items: center; }
    .sc-grade { font: 800 42px/1 var(--font-sans); min-width: 64px; min-height: 64px; display: inline-flex; align-items: center; justify-content: center; border-radius: 14px; letter-spacing: -.02em; }
    .sc-grade.grade-a { background: color-mix(in oklab, var(--green) 20%, var(--paper)); color: var(--green); }
    .sc-grade.grade-b { background: color-mix(in oklab, var(--blue, #3870ff) 18%, var(--paper)); color: var(--blue, #3870ff); }
    .sc-grade.grade-c { background: color-mix(in oklab, var(--gold) 22%, var(--paper)); color: var(--gold); }
    .sc-grade.grade-d { background: color-mix(in oklab, #e65c3b 20%, var(--paper)); color: #e65c3b; }
    .sc-grade.grade-f { background: color-mix(in oklab, var(--red) 20%, var(--paper)); color: var(--red); }
    .sc-eyebrow { font: 700 10.5px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase; color: var(--gold); margin-bottom: 6px; }
    .sc-title { margin: 0 0 8px; font: 600 20px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -.015em; }
    .sc-stats { display: flex; gap: 16px; font: 500 13px/1.3 var(--font-sans); color: var(--mut); flex-wrap: wrap; }
    .sc-stats b { color: var(--ink); font-weight: 700; }
    .sc-stats .sc-bounty { color: var(--gold); font-weight: 700; }
    .sc-close { width: 32px; height: 32px; border-radius: 8px; background: transparent; border: 1px solid var(--line); color: var(--mut); cursor: pointer; font: 400 18px/1 var(--font-sans); flex-shrink: 0; }
    .sc-close:hover { color: var(--ink); border-color: var(--line2); }

    .sc-mastery { padding: 14px 26px; border-bottom: 1px solid var(--line); }
    .sc-mastery label { display: block; font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); margin-bottom: 8px; }
    .sc-mastery-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .sc-mastery-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font: 600 12px/1 var(--font-sans); }
    .sc-mastery-chip.up { background: color-mix(in oklab, var(--green) 12%, var(--paper)); color: var(--green); border: 1px solid color-mix(in oklab, var(--green) 28%, var(--line)); }
    .sc-mastery-chip.down { background: color-mix(in oklab, var(--red) 12%, var(--paper)); color: var(--red); border: 1px solid color-mix(in oklab, var(--red) 28%, var(--line)); }

    .sc-body { padding: 22px 26px 26px; display: flex; flex-direction: column; gap: 16px; }
    .sc-q { padding: 16px 18px; border: 1px solid var(--line); border-radius: 14px; }
    .sc-q.pass { background: color-mix(in oklab, var(--green) 4%, var(--paper)); border-color: color-mix(in oklab, var(--green) 22%, var(--line)); }
    .sc-q.fail { background: color-mix(in oklab, var(--red) 4%, var(--paper)); border-color: color-mix(in oklab, var(--red) 22%, var(--line)); }
    .sc-q header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    .sc-q-num { font: 800 10.5px/1 var(--font-sans); letter-spacing: .14em; color: var(--gold); padding: 4px 7px; border-radius: 5px; background: color-mix(in oklab, var(--gold) 14%, var(--paper)); }
    .sc-q-type { font: 800 9.5px/1 var(--font-sans); letter-spacing: .18em; color: var(--mut); padding: 4px 7px; border-radius: 5px; background: color-mix(in oklab, var(--mut) 10%, var(--paper)); }
    .sc-q-topic { font: 500 11.5px/1.3 var(--font-sans); color: var(--mut); }
    .sc-q-pts { margin-left: auto; font: 800 12px/1 var(--font-sans); color: var(--ink); }
    .sc-q-stem { font: 500 14px/1.6 var(--font-sans); color: var(--ink); margin-bottom: 12px; }
    .sc-q-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
    @media (max-width: 720px) { .sc-q-grid { grid-template-columns: 1fr; } }
    .sc-ans { padding: 10px 12px; border-radius: 8px; background: color-mix(in oklab, var(--mut) 5%, var(--paper)); border: 1px solid var(--line); }
    .sc-ans label { display: block; font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); margin-bottom: 6px; }
    .sc-ans p { margin: 0; font: 500 13px/1.5 var(--font-sans); color: var(--ink); white-space: pre-wrap; }
    .sc-ans p.sc-nope { color: var(--red); font-style: italic; }
    .sc-code { margin: 0; background: #0e1116; color: #e8edf1; padding: 10px 12px; border-radius: 8px; overflow-x: auto;
      font: 500 12px/1.55 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
    .sc-explain { padding: 10px 12px; border-radius: 8px; background: color-mix(in oklab, var(--gold) 7%, var(--paper)); border: 1px solid color-mix(in oklab, var(--gold) 22%, var(--line)); }
    .sc-explain label { display: block; font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--gold); margin-bottom: 6px; }
    .sc-explain p { margin: 0; font: 500 13px/1.55 var(--font-sans); color: var(--ink); }
    .sc-explain p + p { margin-top: 6px; }
    .sc-whyasked { font-size: 12px; color: var(--mut); }
    .sc-whyasked b { color: var(--ink); }
  `;
  document.head.appendChild(s);
}
