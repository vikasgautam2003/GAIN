// 9E · Weekly review — two paths:
//   1. exportWeeklyReview()      — one-call .md download (legacy, kept)
//   2. openWeeklyReportCard()    — full-screen mentor letter modal (NEW)
//      Pulls EVERYTHING from the last 7 days (dayLog, quiz pass/fail,
//      topicConfidence from warmup, ledger velocity, pattern coverage,
//      carry-over, streaks) and asks Groq for a structured mentor letter
//      via the bulletproof pipeline. Rendered as an actual letter, with
//      stat tiles, pattern mastery panel, and 3 crisp recommendations.
//      Cached per week-start-date so re-opening is free.

import { getDayLog, getSheets, getWallet, callGrok, secure } from "./store.js";
import { calendarKey } from "./engine.js";
import { callGroqJSON } from "./groqJson.js";
import { renderMarkdown } from "./info.js";

const REPORT_CACHE_PREFIX = "gain:weeklyReport:";

export async function exportWeeklyReview() {
  // Build the last-7-days context
  const dayLog = getDayLog();
  const sheets = getSheets();
  const ledger = (getWallet().ledger || []);

  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = calendarKey(d);
    const entry = dayLog[key];
    if (!entry) { days.push({ key, empty: true }); continue; }
    const assigned = entry.assigned || [];
    const done = entry.done || [];
    const confidence = entry.confidence || {};
    const solvedTasks = assigned.filter(t => done.includes(t.ref));
    const patterns = {};
    for (const t of solvedTasks) {
      if (t.pattern) {
        patterns[t.pattern] = patterns[t.pattern] || { count: 0, confSum: 0, confN: 0 };
        patterns[t.pattern].count++;
        const c = confidence[t.ref];
        if (c) { patterns[t.pattern].confSum += c; patterns[t.pattern].confN++; }
      }
    }
    const dayEarned = ledger
      .filter(e => e.type === "task" && new Date(e.date).toISOString().slice(0,10) === key)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    days.push({
      key, empty: false,
      green: !!entry.green,
      frozen: !!entry.frozen,
      count: solvedTasks.length,
      total: assigned.length,
      earned: dayEarned,
      patterns: Object.entries(patterns).map(([p, s]) => ({
        pattern: p, count: s.count, avgConf: s.confN ? s.confSum / s.confN : null,
      })),
      minutesDone: solvedTasks.reduce((a, t) => a + (Number(t.minutes) || 0), 0),
    });
  }

  const total = days.reduce((a, d) => a + (d.count || 0), 0);
  const greenCount = days.filter(d => d.green).length;
  const earnedTotal = days.reduce((a, d) => a + (d.earned || 0), 0);
  const patternAgg = {};
  for (const d of days) {
    for (const p of (d.patterns || [])) {
      patternAgg[p.pattern] = patternAgg[p.pattern] || { count: 0, confs: [] };
      patternAgg[p.pattern].count += p.count;
      if (p.avgConf != null) patternAgg[p.pattern].confs.push(p.avgConf);
    }
  }
  const topPatterns = Object.entries(patternAgg)
    .map(([p, s]) => ({ pattern: p, count: s.count, avgConf: s.confs.length ? s.confs.reduce((a,b)=>a+b,0)/s.confs.length : null }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Try Groq for the reflection — gracefully degrade if unavailable
  let reflection = null;
  try {
    const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                   (await secure.get("grok_api_key").catch(() => null));
    if (apiKey) {
      const ctx = buildGroqContext(days, total, greenCount, earnedTotal, topPatterns);
      const res = await callGrok({
        apiKey,
        maxTokens: 800,
        temperature: 0.45,
        system: `You are GAIN's weekly review mentor. Write exactly 300 words of honest reflection on the user's last 7 days.
Structure (plain prose, no markdown headings, no bullets):
Paragraph 1 (~80 words): Honest take on where they stand this week.
Paragraph 2 (~90 words): The strongest signal + the weakest signal (name specific patterns + numbers).
Paragraph 3 (~70 words): Where next week should focus (be specific — pattern names, difficulty, which problems).
Paragraph 4 (~60 words): One sharp, memorable line to close.
Keyword-dense, interview-tone, name real patterns and complexity. No fluff.`,
        user: ctx,
      });
      if (res.ok) reflection = res.content.trim();
    }
  } catch (_) { /* fall through */ }

  // Compose Markdown
  const now = new Date();
  const stamp = now.toISOString().slice(0,10);
  const lines = [];
  lines.push(`# GAIN · Weekly review · ${stamp}`);
  lines.push(``);
  lines.push(`> ${total} problems solved · ${greenCount}/7 green days · ₹${earnedTotal.toLocaleString()} earned`);
  lines.push(``);

  if (reflection) {
    lines.push(`## The honest mentor's take`);
    lines.push(``);
    lines.push(reflection);
    lines.push(``);
  } else {
    lines.push(`> Groq key not set — add one in Settings → AI butler to get the written reflection.`);
    lines.push(``);
  }

  // Day-by-day recap
  lines.push(`## Day by day`);
  lines.push(``);
  for (const d of days) {
    const label = new Date(d.key + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    if (d.empty) {
      lines.push(`- **${label}** — no plan`);
      continue;
    }
    const bits = [];
    bits.push(`${d.count}/${d.total} tasks`);
    if (d.earned) bits.push(`₹${d.earned}`);
    if (d.minutesDone) bits.push(`${d.minutesDone} min`);
    if (d.green) bits.push("✓ green");
    else if (d.frozen) bits.push("❄ frozen");
    lines.push(`- **${label}** — ${bits.join(" · ")}`);
  }
  lines.push(``);

  // Pattern breakdown
  if (topPatterns.length) {
    lines.push(`## Patterns touched`);
    lines.push(``);
    for (const p of topPatterns) {
      const avg = p.avgConf != null ? ` · ★ ${p.avgConf.toFixed(1)}` : "";
      lines.push(`- **${p.pattern}** — ${p.count} solve${p.count === 1 ? "" : "s"}${avg}`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`Generated by GAIN · ${now.toISOString()}`);
  lines.push(``);

  const text = lines.join("\n");
  const filename = `gain-weekly-review-${stamp}.md`;
  downloadFile(filename, text);
  return { filename, total, greenCount, earnedTotal, hasReflection: !!reflection };
}

function buildGroqContext(days, total, greenCount, earnedTotal, topPatterns) {
  const bits = [];
  bits.push(`Totals: ${total} problems · ${greenCount}/7 green days · ₹${earnedTotal} earned`);
  bits.push(``);
  bits.push(`Day-by-day:`);
  for (const d of days) {
    if (d.empty) { bits.push(`- ${d.key}: no plan`); continue; }
    const pat = (d.patterns || []).map(p => `${p.pattern} (${p.count}, ★${p.avgConf?.toFixed(1) || "–"})`).join(", ");
    bits.push(`- ${d.key}: ${d.count}/${d.total} done, ₹${d.earned}, ${d.minutesDone}min${d.green ? ", green" : ""}${pat ? " — " + pat : ""}`);
  }
  bits.push(``);
  bits.push(`Top patterns touched:`);
  for (const p of topPatterns) {
    bits.push(`- ${p.pattern}: ${p.count} solves, avg ★${p.avgConf?.toFixed(1) || "–"}`);
  }
  return bits.join("\n");
}

// ================================================================
// NEW · Full-screen mentor report card
// ================================================================

export async function openWeeklyReportCard() {
  document.querySelectorAll(".wr-scrim").forEach(m => m.remove());
  const scrim = document.createElement("div");
  scrim.className = "wr-scrim";
  scrim.innerHTML = `
    <div class="wr-modal" role="dialog" aria-label="Weekly report card">
      <header class="wr-head">
        <div class="wr-head-main">
          <div class="wr-eyebrow">✦ WEEKLY MENTOR REPORT</div>
          <h2 class="wr-title">Your week in review</h2>
          <div class="wr-sub" id="wr-subtitle">Reading the signal…</div>
        </div>
        <div class="wr-head-actions">
          <button class="wr-btn ghost" id="wr-regen" hidden title="Discard cache and ask Groq again (useful after you've done a warmup confidence check)">↻ Regenerate</button>
          <button class="wr-btn ghost" id="wr-download" hidden>⬇ Download .md</button>
          <button class="wr-close" aria-label="Close">✕</button>
        </div>
      </header>
      <div class="wr-body" id="wr-body">
        <div class="wr-skel">
          <div class="wr-skel-line"></div>
          <div class="wr-skel-line short"></div>
          <div class="wr-skel-line"></div>
          <div class="wr-skel-line"></div>
          <div class="wr-skel-line short"></div>
          <div class="wr-skel-note">Reading last 7 days of dayLog, quizzes, confidence stars, pattern coverage…</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.style.overflow = "hidden";
  injectReportStyles();

  const close = () => { document.body.style.overflow = ""; scrim.remove(); };
  scrim.querySelector(".wr-close").addEventListener("click", close);
  const key = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", key); } };
  document.addEventListener("keydown", key);

  // Build context (same core as .md but with every signal we have)
  const ctx = buildWeeklyContext();
  const weekStart = ctx.weekStartKey;
  const cacheKey = REPORT_CACHE_PREFIX + weekStart;

  let report = null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) report = JSON.parse(raw);
  } catch (_) {}

  if (!report) {
    try {
      const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                     (await secure.get("grok_api_key").catch(() => null));
      if (!apiKey) throw new Error("No Groq API key. Add one in Settings → AI butler.");
      const res = await callGroqJSON({
        apiKey,
        system: HONEST_COACH_SYSTEM,
        user: buildReportUserPrompt(ctx),
        maxTokens: 3072,
        label: "weekly-report",
        schemaCheck: (obj) => {
          if (!obj || typeof obj !== "object") return "not an object";
          const req = ["verdict", "wins", "concerns", "patternMastery", "quizReality", "nextWeekFocus", "oneBigAsk", "closingLine"];
          for (const k of req) if (!(k in obj)) return `missing ${k}`;
          if (!Array.isArray(obj.wins) || obj.wins.length < 1) return "wins empty";
          if (!Array.isArray(obj.concerns) || obj.concerns.length < 1) return "concerns empty";
          if (!Array.isArray(obj.nextWeekFocus) || obj.nextWeekFocus.length < 1) return "nextWeekFocus empty";
          if (!Array.isArray(obj.patternMastery)) return "patternMastery not array";
          return true;
        },
      });
      if (!res.ok) throw new Error(res.error);
      report = res.data;
      try { localStorage.setItem(cacheKey, JSON.stringify(report)); } catch (_) {}
    } catch (e) {
      paintReportError(scrim, e.message || String(e));
      return;
    }
  }

  paintReport(scrim, report, ctx);
}

function paintReport(scrim, report, ctx) {
  const body = scrim.querySelector("#wr-body");
  const subtitle = scrim.querySelector("#wr-subtitle");
  if (subtitle) subtitle.textContent = `${ctx.weekStartKey} → ${ctx.todayKey}`;
  const dl = scrim.querySelector("#wr-download");
  if (dl) {
    dl.hidden = false;
    dl.addEventListener("click", () => {
      const md = reportToMarkdown(report, ctx);
      downloadFile(`gain-weekly-report-${ctx.todayKey}.md`, md);
    });
  }
  const regen = scrim.querySelector("#wr-regen");
  if (regen) {
    regen.hidden = false;
    regen.addEventListener("click", async () => {
      try { localStorage.removeItem(REPORT_CACHE_PREFIX + ctx.weekStartKey); } catch (_) {}
      scrim.remove();
      document.body.style.overflow = "";
      await openWeeklyReportCard();
    });
  }

  const tile = (label, big, sub) => `<div class="wr-tile"><div class="wr-tile-lb">${label}</div><div class="wr-tile-big">${big}</div><div class="wr-tile-sub">${sub || ""}</div></div>`;

  body.innerHTML = `
    <div class="wr-letter">
      <div class="wr-verdict">${renderMarkdown(report.verdict || "")}</div>

      <div class="wr-tiles">
        ${tile("Solved", ctx.totalSolved, `of ${ctx.totalAssigned} assigned`)}
        ${tile("Green days", `${ctx.greenCount}/7`, ctx.greenCount >= 5 ? "strong consistency" : "room to grow")}
        ${tile("Quiz pass", `${ctx.quizPasses}/${Math.max(1, ctx.quizAttempts)}`, ctx.quizAttempts ? `${Math.round(100*ctx.quizPasses/ctx.quizAttempts)}% pass` : "no quizzes yet")}
        ${tile("Earned", `₹${ctx.earnedTotal.toLocaleString()}`, ctx.earnedDelta != null ? (ctx.earnedDelta >= 0 ? `+₹${ctx.earnedDelta} vs last` : `-₹${Math.abs(ctx.earnedDelta)} vs last`) : "")}
        ${tile("Lessons", `${ctx.lessonsPassed}/${ctx.lessonsStarted}`, ctx.lessonsStarted ? `${ctx.lessonRebuilds} rebuild${ctx.lessonRebuilds === 1 ? "" : "s"}` : "none this week")}
        ${tile("Patterns", `${ctx.patternsTouched}`, ctx.patternsAvoided.length ? `${ctx.patternsAvoided.length} ducked` : "no avoidance")}
      </div>

      <section class="wr-sec wr-wins">
        <h3>✓ Wins</h3>
        <ul>${(report.wins || []).map(w => `<li>${renderMarkdown(w)}</li>`).join("")}</ul>
      </section>

      <section class="wr-sec wr-concerns">
        <h3>⚠ Concerns</h3>
        <ul>${(report.concerns || []).map(c => `<li>${renderMarkdown(c)}</li>`).join("")}</ul>
      </section>

      <section class="wr-sec wr-patterns">
        <h3>▣ Pattern mastery</h3>
        <div class="wr-pat-grid">
          ${(report.patternMastery || []).map(p => `
            <div class="wr-pat-card wr-pat-${esc(p.status || "stable")}">
              <div class="wr-pat-name">${esc(p.pattern || "")}</div>
              <div class="wr-pat-status">${esc(p.status || "")}</div>
              <div class="wr-pat-why">${renderMarkdown(p.evidence || "")}</div>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="wr-sec wr-quiz">
        <h3>🎓 Quiz reality check</h3>
        <p>${renderMarkdown(report.quizReality || "")}</p>
      </section>

      <section class="wr-sec wr-focus">
        <h3>→ Next week · focus here</h3>
        <ol>${(report.nextWeekFocus || []).map(f => `<li>${renderMarkdown(f)}</li>`).join("")}</ol>
      </section>

      <section class="wr-sec wr-ask">
        <h3>★ The one big ask</h3>
        <p class="wr-ask-text">${renderMarkdown(report.oneBigAsk || "")}</p>
      </section>

      <div class="wr-closing">${renderMarkdown(report.closingLine || "")}</div>

      <details class="wr-day-detail">
        <summary>Day-by-day numbers</summary>
        <table class="wr-day-table">
          <thead><tr><th>Day</th><th>Done</th><th>₹</th><th>Min</th><th>Status</th></tr></thead>
          <tbody>
            ${ctx.days.map(d => {
              const label = new Date(d.key + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
              if (d.empty) return `<tr><td>${label}</td><td colspan="4" class="wr-day-empty">no plan</td></tr>`;
              const status = d.green ? "✓" : d.frozen ? "❄" : "·";
              return `<tr><td>${label}</td><td>${d.count}/${d.total}</td><td>₹${d.earned || 0}</td><td>${d.minutesDone || 0}</td><td>${status}</td></tr>`;
            }).join("")}
          </tbody>
        </table>
      </details>
    </div>
  `;
}

function paintReportError(scrim, msg) {
  const body = scrim.querySelector("#wr-body");
  body.innerHTML = `
    <div class="wr-err">
      <div class="wr-err-ico">⚠</div>
      <div class="wr-err-title">Couldn't generate the report</div>
      <p>${esc(msg)}</p>
      <div class="wr-err-actions">
        <button class="wr-btn primary" id="wr-err-close">Close</button>
      </div>
    </div>
  `;
  body.querySelector("#wr-err-close")?.addEventListener("click", () => {
    document.body.style.overflow = "";
    scrim.remove();
  });
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }

// --- Context assembly — EVERY signal we have from the last 7 days ---
function buildWeeklyContext() {
  const dayLog = getDayLog();
  const ledger = getWallet().ledger || [];
  const today = new Date();
  const todayK = calendarKey(today);
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - 6);
  const weekStartKey = calendarKey(weekStart);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = calendarKey(d);
    const entry = dayLog[key];
    if (!entry) { days.push({ key, empty: true }); continue; }
    const assigned = entry.assigned || [];
    const done = entry.done || [];
    const confidence = entry.confidence || {};
    const topicConfidence = entry.topicConfidence || {};
    const solvedTasks = assigned.filter(t => done.includes(t.ref));
    const assignedPatterns = new Set();
    const donePatterns = new Set();
    for (const t of assigned) if (t.pattern) assignedPatterns.add(t.pattern);
    for (const t of solvedTasks) if (t.pattern) donePatterns.add(t.pattern);
    const avoidedPatterns = [...assignedPatterns].filter(p => !donePatterns.has(p));
    const dayEarned = ledger
      .filter(e => new Date(e.date).toISOString().slice(0,10) === key && (Number(e.amount) || 0) > 0)
      .reduce((s, e) => s + Number(e.amount), 0);
    const carriedCount = assigned.filter(t => t.carried).length;
    days.push({
      key, empty: false,
      green: !!entry.green, frozen: !!entry.frozen,
      count: solvedTasks.length, total: assigned.length,
      earned: dayEarned,
      patternsDone: [...donePatterns],
      patternsAvoided: avoidedPatterns,
      topicConfidence,
      carried: carriedCount,
      minutesDone: solvedTasks.reduce((a, t) => a + (Number(t.minutes) || 0), 0),
    });
  }

  const totalSolved = days.reduce((a, d) => a + (d.count || 0), 0);
  const totalAssigned = days.reduce((a, d) => a + (d.total || 0), 0);
  const greenCount = days.filter(d => d.green).length;
  const earnedTotal = days.reduce((a, d) => a + (d.earned || 0), 0);
  const patternsTouched = new Set();
  const patternsAvoided = new Set();
  for (const d of days) {
    for (const p of d.patternsDone || []) patternsTouched.add(p);
    for (const p of d.patternsAvoided || []) patternsAvoided.add(p);
  }

  // Quiz pass/fail scan — walk localStorage for lessonState entries in last 7 days
  let quizAttempts = 0, quizPasses = 0, lessonsStarted = 0, lessonsPassed = 0, lessonRebuilds = 0;
  const weekStartMs = new Date(weekStartKey + "T00:00:00").getTime();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("gain:lessonState:")) continue;
      try {
        const s = JSON.parse(localStorage.getItem(k));
        const atts = Array.isArray(s.attempts) ? s.attempts.filter(a => a.at >= weekStartMs) : [];
        if (!atts.length) continue;
        lessonsStarted++;
        if (s.passed && (s.fullPaidAt && s.fullPaidAt >= weekStartMs)) lessonsPassed++;
        quizAttempts += atts.length;
        quizPasses += atts.filter(a => a.score >= 3).length;
        if (atts.length > 1) lessonRebuilds += atts.length - 1;
      } catch (_) {}
    }
  } catch (_) {}

  // Earned delta vs. the 7 days before that
  let earnedDelta = null;
  try {
    const priorStart = new Date(today); priorStart.setDate(today.getDate() - 13);
    const priorEnd = new Date(today); priorEnd.setDate(today.getDate() - 7);
    const inRange = ledger.filter(e => {
      const t = new Date(e.date).getTime();
      return t >= priorStart.getTime() && t < priorEnd.getTime() && (Number(e.amount) || 0) > 0;
    });
    const priorEarned = inRange.reduce((s, e) => s + Number(e.amount), 0);
    earnedDelta = earnedTotal - priorEarned;
  } catch (_) {}

  // Aggregate topic confidence across the week — min star per topic
  const topicConfLow = {};
  for (const d of days) {
    for (const [t, n] of Object.entries(d.topicConfidence || {})) {
      if (topicConfLow[t] == null || n < topicConfLow[t]) topicConfLow[t] = n;
    }
  }

  return {
    days, weekStartKey, todayKey: todayK,
    totalSolved, totalAssigned, greenCount, earnedTotal, earnedDelta,
    quizAttempts, quizPasses, lessonsStarted, lessonsPassed, lessonRebuilds,
    patternsTouched: patternsTouched.size,
    patternsTouchedList: [...patternsTouched],
    patternsAvoided: [...patternsAvoided],
    topicConfidenceLow: topicConfLow,
  };
}

const HONEST_COACH_SYSTEM = `You are a staff FDE engineer serving as the user's honest coach.
Not warm, not cold — direct and respectful. You've seen their week in exhaustive numeric detail.
Call out avoidance. Celebrate real wins. Reference specific patterns, days, numbers.
NO corporate flattery. NO vague encouragement. Every sentence must be verifiable from the data provided.

Reply with VALID JSON matching this schema (no markdown, no code fences):

{
  "verdict": "ONE sentence headline on where they stand this week. Direct.",
  "wins": ["3 concrete wins — reference pattern names, problem titles, or specific numbers"],
  "concerns": ["3 concrete concerns — name the exact behaviour: 'you avoided graphs 4 days running', 'you failed quizzes on sliding-window twice'"],
  "patternMastery": [
    { "pattern": "pattern name", "status": "rising|stable|shaky|cold", "evidence": "one sentence of proof from the data" }
  ],
  "quizReality": "one paragraph (3-4 sentences) comparing self-rated confidence vs quiz pass rate. Name specific topics.",
  "nextWeekFocus": ["3 specific actions — name patterns, difficulty, which days to focus on"],
  "oneBigAsk": "ONE habit change that would 2x next week. Specific and small.",
  "closingLine": "ONE sentence to send them off. Memorable."
}

RULES:
- Every claim must map to a signal in the input. Do not invent patterns the user didn't touch.
- If pattern coverage is thin, say so — don't pad patternMastery with fluff.
- If the user is dodging a difficulty (e.g. zero Hard solves), name it in concerns.
- oneBigAsk must be actionable this week — "do X on Monday morning", not "focus more on consistency".
- Tone: calm, exact, no exclamation marks.`;

function buildReportUserPrompt(ctx) {
  const lines = [];
  lines.push(`Week: ${ctx.weekStartKey} → ${ctx.todayKey}`);
  lines.push(`TOTALS: ${ctx.totalSolved}/${ctx.totalAssigned} tasks solved · ${ctx.greenCount}/7 green days · ₹${ctx.earnedTotal} earned` + (ctx.earnedDelta != null ? ` (${ctx.earnedDelta >= 0 ? "+" : ""}₹${ctx.earnedDelta} vs. prior 7 days)` : ""));
  lines.push(`QUIZZES: ${ctx.quizPasses}/${ctx.quizAttempts} passes · ${ctx.lessonsPassed}/${ctx.lessonsStarted} lessons mastered · ${ctx.lessonRebuilds} rebuilds triggered`);
  lines.push(`PATTERNS TOUCHED (${ctx.patternsTouched}): ${ctx.patternsTouchedList.join(", ") || "none"}`);
  if (ctx.patternsAvoided.length) lines.push(`PATTERNS ASSIGNED BUT NOT DONE: ${ctx.patternsAvoided.join(", ")}`);
  const lowConfTopics = Object.entries(ctx.topicConfidenceLow).filter(([, n]) => n <= 2).map(([t]) => t);
  if (lowConfTopics.length) lines.push(`SELF-REPORTED LOW CONFIDENCE: ${lowConfTopics.join(", ")} (user rated these ≤ 2★ in warm-up)`);
  lines.push(``);
  lines.push(`DAY BY DAY:`);
  for (const d of ctx.days) {
    if (d.empty) { lines.push(`  ${d.key}: no plan`); continue; }
    const bits = [];
    bits.push(`${d.count}/${d.total} done`);
    bits.push(`₹${d.earned}`);
    bits.push(`${d.minutesDone}min`);
    if (d.green) bits.push("green");
    else if (d.frozen) bits.push("frozen");
    if (d.carried) bits.push(`${d.carried} carried`);
    if (d.patternsDone.length) bits.push(`patterns: ${d.patternsDone.join(", ")}`);
    if (d.patternsAvoided.length) bits.push(`avoided: ${d.patternsAvoided.join(", ")}`);
    lines.push(`  ${d.key}: ${bits.join(" · ")}`);
  }
  lines.push(``);
  lines.push(`Write the honest-coach JSON report based on the above.`);
  return lines.join("\n");
}

function reportToMarkdown(report, ctx) {
  const L = [];
  L.push(`# GAIN · Weekly report · ${ctx.weekStartKey} → ${ctx.todayKey}`);
  L.push(``);
  L.push(`> ${report.verdict}`);
  L.push(``);
  L.push(`**${ctx.totalSolved}/${ctx.totalAssigned}** solved · **${ctx.greenCount}/7** green · **${ctx.quizPasses}/${Math.max(1, ctx.quizAttempts)}** quiz pass · **₹${ctx.earnedTotal}** earned`);
  L.push(``);
  L.push(`## ✓ Wins`); for (const w of report.wins || []) L.push(`- ${w}`);
  L.push(``);
  L.push(`## ⚠ Concerns`); for (const c of report.concerns || []) L.push(`- ${c}`);
  L.push(``);
  L.push(`## ▣ Pattern mastery`);
  for (const p of report.patternMastery || []) L.push(`- **${p.pattern}** (${p.status}) — ${p.evidence}`);
  L.push(``);
  L.push(`## 🎓 Quiz reality check`); L.push(``); L.push(report.quizReality || "");
  L.push(``);
  L.push(`## → Next week · focus here`); for (const f of report.nextWeekFocus || []) L.push(`- ${f}`);
  L.push(``);
  L.push(`## ★ The one big ask`); L.push(``); L.push(report.oneBigAsk || "");
  L.push(``);
  L.push(`---`); L.push(report.closingLine || "");
  L.push(``);
  L.push(`_Generated by GAIN · ${new Date().toISOString()}_`);
  return L.join("\n");
}

function injectReportStyles() {
  if (document.getElementById("wr-styles")) return;
  const style = document.createElement("style");
  style.id = "wr-styles";
  style.textContent = `
    .wr-scrim { position: fixed; inset: 0; z-index: 1400; background: rgba(8,10,14,.72); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; padding: 0; animation: wrFade 220ms ease both; }
    @keyframes wrFade { from { opacity: 0; } to { opacity: 1; } }
    .wr-modal { background: var(--paper); width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden; animation: wrPop 240ms cubic-bezier(.2,1.2,.3,1) both; }
    @keyframes wrPop { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
    .wr-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 22px 32px 18px; border-bottom: 1px solid var(--line); }
    .wr-eyebrow { font-size: 10.5px; letter-spacing: .18em; font-weight: 700; text-transform: uppercase; color: var(--mut); margin-bottom: 6px; }
    .wr-title { margin: 0 0 4px; font-size: 26px; font-weight: 800; color: var(--ink); letter-spacing: -.02em; }
    .wr-sub { font-size: 13px; color: var(--mut); }
    .wr-head-actions { display: flex; gap: 8px; align-items: center; }
    .wr-close { border: none; background: transparent; cursor: pointer; color: var(--mut); width: 32px; height: 32px; border-radius: 8px; font: 400 18px/1 var(--font-sans); transition: all .18s; }
    .wr-close:hover { background: var(--bg); color: var(--ink); }
    .wr-btn { padding: 8px 14px; font: 600 12.5px/1 var(--font-sans); border-radius: 8px; cursor: pointer; border: 1px solid var(--line); transition: all .18s; }
    .wr-btn.ghost { background: var(--paper); color: var(--mut); }
    .wr-btn.ghost:hover { color: var(--ink); border-color: var(--line2); }
    .wr-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); padding: 11px 22px; font-size: 13px; }
    .wr-body { padding: 32px 48px; overflow-y: auto; flex: 1; }
    .wr-skel { padding: 60px 0; display: flex; flex-direction: column; gap: 14px; align-items: stretch; max-width: 640px; margin: 0 auto; }
    .wr-skel-line { height: 14px; border-radius: 7px; background: linear-gradient(90deg, var(--bg) 0%, var(--line) 50%, var(--bg) 100%); background-size: 200% 100%; animation: wrSkel 1500ms ease-in-out infinite; }
    .wr-skel-line.short { max-width: 70%; }
    @keyframes wrSkel { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
    .wr-skel-note { font: 400 12.5px/1.5 var(--font-sans); color: var(--mut); text-align: center; margin-top: 10px; }
    .wr-letter { max-width: 760px; margin: 0 auto; }
    .wr-verdict { font: 500 20px/1.5 var(--font-sans); color: var(--ink); margin-bottom: 24px; padding: 20px 24px; background: color-mix(in oklab, var(--gold) 7%, var(--paper)); border-left: 4px solid var(--gold); border-radius: 0 10px 10px 0; }
    .wr-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 32px; }
    .wr-tile { padding: 14px 16px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
    .wr-tile-lb { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; color: var(--mut); text-transform: uppercase; margin-bottom: 6px; }
    .wr-tile-big { font: 700 22px/1.1 var(--font-sans); color: var(--ink); letter-spacing: -.02em; margin-bottom: 2px; }
    .wr-tile-sub { font: 400 11.5px/1.3 var(--font-sans); color: var(--mut); }
    @media (max-width: 640px) { .wr-tiles { grid-template-columns: repeat(2, 1fr); } .wr-pat-grid { grid-template-columns: 1fr; } }
    @media (max-width: 480px) {
      .wr-head { padding: 16px 18px 14px; }
      .wr-title { font-size: 22px; }
      .wr-body { padding: 20px 20px; }
      .wr-letter { max-width: 100%; }
      .wr-verdict { font-size: 16px; padding: 14px 16px; margin-bottom: 20px; }
      .wr-tiles { grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 24px; }
      .wr-tile { padding: 10px 12px; }
      .wr-tile-big { font-size: 18px; }
      .wr-sec h3 { font-size: 14px; }
      .wr-sec ul, .wr-sec ol, .wr-sec p { font-size: 13.5px; }
      .wr-ask { padding: 16px 18px; }
      .wr-ask-text { font-size: 15px !important; }
      .wr-closing { font-size: 14px; padding: 20px 0; }
      .wr-head-actions .wr-btn { padding: 7px 10px; font-size: 11.5px; }
    }
    .wr-sec { margin-bottom: 26px; }
    .wr-sec h3 { font: 700 15px/1.3 var(--font-sans); color: var(--ink); margin: 0 0 10px; letter-spacing: -.01em; }
    .wr-sec ul, .wr-sec ol { padding-left: 22px; margin: 0; font: 400 14px/1.65 var(--font-sans); color: var(--ink); }
    .wr-sec ul li, .wr-sec ol li { margin-bottom: 6px; }
    .wr-sec p { margin: 0; font: 400 14px/1.65 var(--font-sans); color: var(--ink); }
    .wr-wins h3 { color: var(--green); }
    .wr-concerns h3 { color: #c3610c; }
    .wr-pat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .wr-pat-card { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--paper); }
    .wr-pat-name { font: 700 13.5px/1.2 var(--font-sans); color: var(--ink); margin-bottom: 4px; }
    .wr-pat-status { font: 700 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; margin-bottom: 6px; }
    .wr-pat-rising .wr-pat-status { color: var(--green); }
    .wr-pat-stable .wr-pat-status { color: var(--mut); }
    .wr-pat-shaky .wr-pat-status { color: #c3610c; }
    .wr-pat-cold .wr-pat-status  { color: var(--red); }
    .wr-pat-why { font: 400 12.5px/1.5 var(--font-sans); color: var(--ink); opacity: .88; }
    .wr-ask { background: color-mix(in oklab, var(--ink) 5%, var(--paper)); border-radius: 12px; padding: 20px 24px; }
    .wr-ask-text { font: 600 16px/1.5 var(--font-sans) !important; color: var(--ink); }
    .wr-closing { font: 500 16px/1.5 var(--font-sans); color: var(--ink); font-style: italic; text-align: center; padding: 24px 0; border-top: 1px solid var(--line); margin-top: 20px; }
    .wr-day-detail { margin-top: 28px; padding: 14px 18px; background: var(--bg); border-radius: 10px; }
    .wr-day-detail summary { cursor: pointer; font: 600 13px/1 var(--font-sans); color: var(--ink); }
    .wr-day-table { width: 100%; margin-top: 12px; border-collapse: collapse; font: 500 12.5px/1.4 var(--font-mono, ui-monospace,monospace); }
    .wr-day-table th, .wr-day-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--line); }
    .wr-day-table th { font-weight: 700; color: var(--mut); }
    .wr-day-empty { color: var(--mut); font-style: italic; }
    .wr-err { text-align: center; padding: 60px 20px; max-width: 480px; margin: 0 auto; }
    .wr-err-ico { font-size: 48px; color: #e9b100; margin-bottom: 12px; }
    .wr-err-title { font: 700 18px/1.3 var(--font-sans); color: var(--ink); margin-bottom: 10px; }
    .wr-err p { font: 400 13px/1.5 var(--font-sans); color: var(--mut); margin-bottom: 18px; }
  `;
  document.head.appendChild(style);
}

function downloadFile(filename, text) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
}
