// Tests — paper generation + grading + bounty + Mastery deltas.
// Pure logic. All UI lives in tests.js (route page) and testRunner.js (modal).

import { secure, getSheets, updateWallet, updateSettings, getSettings } from "./store.js";
import { callGroqJSON } from "./groqJson.js";

const CATALOG_KEY = "gain:tests:catalog";
const MAX_HISTORY = 50;    // cap persisted attempts

// ============ CATALOG I/O ============

export function loadCatalog() {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export function saveCatalog(list) {
  try {
    // Keep only the most recent MAX_HISTORY — oldest first, so sort desc then slice.
    const trimmed = list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, MAX_HISTORY);
    localStorage.setItem(CATALOG_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn("[tests] save failed", e);
  }
}

export function recordAttempt(attempt) {
  const list = loadCatalog();
  const idx = list.findIndex(x => x.id === attempt.id);
  if (idx >= 0) list[idx] = attempt;
  else list.unshift(attempt);
  saveCatalog(list);
}

export function getAttempt(id) {
  return loadCatalog().find(x => x.id === id) || null;
}

// ============ PAPER SHAPE ============
// Default per-sheet question mix. User can override via the picker.
// mcq = 4-option multi-choice, written = long-form explanation, coding = full code.
export const PAPER_DEFAULTS = {
  "DSA": {
    quick:    { mcq: 5, written: 0, coding: 1, minutes: 30 },
    standard: { mcq: 8, written: 0, coding: 2, minutes: 90 },
    deep:     { mcq: 10, written: 0, coding: 3, minutes: 150 },
  },
  "SQL": {
    quick:    { mcq: 4, written: 0, coding: 1, minutes: 25 },
    standard: { mcq: 6, written: 0, coding: 2, minutes: 60 },
    deep:     { mcq: 10, written: 0, coding: 3, minutes: 100 },
  },
  "System Design": {
    quick:    { mcq: 6, written: 0, coding: 0, minutes: 25 },
    standard: { mcq: 10, written: 1, coding: 0, minutes: 90 },
    deep:     { mcq: 14, written: 2, coding: 0, minutes: 150 },
  },
  "Integrations": {
    quick:    { mcq: 6, written: 0, coding: 0, minutes: 20 },
    standard: { mcq: 10, written: 2, coding: 0, minutes: 60 },
    deep:     { mcq: 14, written: 3, coding: 0, minutes: 100 },
  },
  "Interview Extras": {
    quick:    { mcq: 8, written: 0, coding: 0, minutes: 15 },
    standard: { mcq: 15, written: 0, coding: 0, minutes: 30 },
    deep:     { mcq: 25, written: 0, coding: 0, minutes: 50 },
  },
  "OS & Networking": {
    quick:    { mcq: 7, written: 0, coding: 0, minutes: 20 },
    standard: { mcq: 15, written: 2, coding: 0, minutes: 60 },
    deep:     { mcq: 22, written: 3, coding: 0, minutes: 100 },
  },
};

export function paperShapeFor(sheetName, lengthMode = "standard") {
  const presets = PAPER_DEFAULTS[sheetName] || PAPER_DEFAULTS["Interview Extras"];
  return { ...(presets[lengthMode] || presets.standard) };
}

// ============ PAPER GENERATION ============

export async function generatePaper({ sheetName, topics, difficulty, lengthMode }) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key. Add one in Settings → AI butler.");

  const shape = paperShapeFor(sheetName, lengthMode);
  const sheetKind = sheetKindFor(sheetName);

  const topicList = Array.isArray(topics) && topics.length ? topics : ["(any pattern in this sheet)"];
  const difficultyLabel = difficulty || "Mixed";

  const system = `You are a senior FDE interview question writer. Build a tight ${sheetKind} test paper that reads like a real coding/interview assessment. The student is studying ${sheetName}. Return ONLY valid JSON matching the schema below.

PAPER REQUIREMENTS:
- Topics: ${topicList.join(", ")}
- Difficulty: ${difficultyLabel}
- EXACTLY ${shape.mcq} multiple-choice questions
- EXACTLY ${shape.written} written-answer questions
- EXACTLY ${shape.coding} coding questions
- ~25% of MCQs should be STORY-DISGUISED — real company/product scenarios that secretly test the same pattern (e.g. "A Rocketlane PM reports account search lagging at 50K rows" → trie/edit-distance MCQ). The remaining 75% ask the concept directly.
- For MCQs: 4 options, exactly ONE correct. All 4 options must be plausible — no "banana" throwaways. Encode real misconceptions.
- For written: ask something specific an interviewer actually asks after this topic. Not vague "explain X" — demand a trade-off or a specific scenario.
- For coding: present PRISTINE / LeetCode-style — the student writes ONLY the function body.

Each question MUST include:
- "topic" — which pattern/topic from the sheet it tests
- "whyAsked" — one sentence on why an interviewer picks this question
- For MCQ: "explanation" — one sentence on why the correct answer is right AND why the wrong options are wrong
- For written: "modelAnswer" — 3-6 sentence benchmark the student's answer is compared against
- For coding: STRUCTURED FIELDS so the UI renders a real coding portal, not a wall of text:
  * "problemTitle" — short name
  * "stem" — 1-2 sentence problem overview, plain language
  * "examples" — 2-3 entries: [{"input":"nums=[2,7,11,15], target=9","output":"[0,1]","explanation":"ONE sentence"}]
  * "constraints" — 2-5 bullet strings
  * "functionSignature" — the Java signature (or SQL template header for SQL sheet)
  * "starterCode" — COMPILABLE stub with the signature + class wrapper + a // TODO comment where the student fills the body
  * "exampleSolution" — the FULL correct ${sheetKind === "SQL" ? "SQL query" : "Java solution"} (shown only on scorecard)
  * "edgeCases" — exactly 3 strings naming tricky inputs
  * "complexityExpectation" — e.g. "O(n log n) time, O(1) space"

Return as JSON (no markdown, no code fences):
{
  "title": "short descriptive title for this paper (e.g. 'Sliding Window + Two Pointers · Standard · Medium')",
  "questions": [
    { "type": "mcq", "topic": "...", "stem": "...", "options": ["A","B","C","D"], "correctIdx": 0, "explanation": "...", "whyAsked": "...", "isStoryMode": false, "points": 1 },
    { "type": "written", "topic": "...", "stem": "...", "modelAnswer": "...", "rubric": "...", "whyAsked": "...", "points": 5 },
    { "type": "coding", "topic": "...", "problemTitle": "...", "stem": "overview", "examples":[{"input":"...","output":"...","explanation":"..."}], "constraints":["..."], "functionSignature":"public ... (...)", "starterCode":"class Solution {\\n    public ... (...) {\\n        // TODO\\n    }\\n}", "exampleSolution":"FULL CORRECT CODE", "edgeCases":["e1","e2","e3"], "complexityExpectation":"O(...) time, O(...) space", "whyAsked":"...", "points": 10 }
  ]
}

Order the questions: all MCQs first, then written, then coding. Numbered 1-N by position.`;

  const user = `Build the paper now. Topic focus: ${topicList.join(", ")}. Difficulty: ${difficultyLabel}. Return ONLY the JSON.`;

  const res = await callGroqJSON({
    apiKey, system, user, maxTokens: 6144, label: `test:${sheetName}:${lengthMode}`,
    schemaCheck: (obj) => {
      if (!obj || typeof obj !== "object") return "not an object";
      if (!Array.isArray(obj.questions)) return "missing questions";
      let mcq = 0, wr = 0, cd = 0;
      for (let i = 0; i < obj.questions.length; i++) {
        const q = obj.questions[i];
        if (!q?.type) return `q${i+1} missing type`;
        if (!q.stem) return `q${i+1} missing stem`;
        if (q.type === "mcq") {
          mcq++;
          if (!Array.isArray(q.options) || q.options.length !== 4) return `q${i+1} needs 4 options`;
          if (!Number.isInteger(q.correctIdx) || q.correctIdx < 0 || q.correctIdx > 3) return `q${i+1} bad correctIdx`;
        } else if (q.type === "written") {
          wr++;
          if (!q.modelAnswer) return `q${i+1} missing modelAnswer`;
        } else if (q.type === "coding") {
          cd++;
          if (!q.exampleSolution) return `q${i+1} missing exampleSolution`;
        } else {
          return `q${i+1} unknown type "${q.type}"`;
        }
      }
      if (mcq !== shape.mcq) return `expected ${shape.mcq} MCQs, got ${mcq}`;
      if (wr !== shape.written) return `expected ${shape.written} written, got ${wr}`;
      if (cd !== shape.coding) return `expected ${shape.coding} coding, got ${cd}`;
      return true;
    },
  });
  if (!res.ok) throw new Error(res.error);

  // Normalise + stamp ids
  const paper = {
    id: `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    createdAt: Date.now(),
    sheetName,
    topics: topicList.filter(t => t !== "(any pattern in this sheet)"),
    difficulty: difficultyLabel,
    lengthMode,
    lengthMin: shape.minutes,
    title: String(res.data.title || `${sheetName} · ${lengthMode}`).trim(),
    questions: res.data.questions.map((q, i) => ({
      id: `q${i + 1}`,
      type: q.type,
      topic: String(q.topic || "").trim(),
      stem: String(q.stem || "").trim(),
      options: q.type === "mcq" ? q.options.map(x => String(x).trim()) : undefined,
      correctIdx: q.type === "mcq" ? Number(q.correctIdx) : undefined,
      modelAnswer: q.type === "written" ? String(q.modelAnswer || "").trim() : undefined,
      rubric: q.type === "written" ? String(q.rubric || "").trim() : undefined,
      exampleSolution: q.type === "coding" ? String(q.exampleSolution || "").trim() : undefined,
      edgeCases: q.type === "coding" ? (Array.isArray(q.edgeCases) ? q.edgeCases.map(x => String(x).trim()) : []) : undefined,
      complexityExpectation: q.type === "coding" ? String(q.complexityExpectation || "").trim() : undefined,
      problemTitle: q.type === "coding" ? String(q.problemTitle || "").trim() : undefined,
      examples: q.type === "coding" ? (Array.isArray(q.examples) ? q.examples.map(e => ({
        input: String(e.input || "").trim(),
        output: String(e.output || "").trim(),
        explanation: String(e.explanation || "").trim(),
      })).filter(e => e.input || e.output) : []) : undefined,
      constraints: q.type === "coding" ? (Array.isArray(q.constraints) ? q.constraints.map(x => String(x).trim()).filter(Boolean) : []) : undefined,
      functionSignature: q.type === "coding" ? String(q.functionSignature || "").trim() : undefined,
      starterCode: q.type === "coding" ? String(q.starterCode || "").trim() : undefined,
      explanation: q.type === "mcq" ? String(q.explanation || "").trim() : undefined,
      whyAsked: String(q.whyAsked || "").trim(),
      isStoryMode: !!q.isStoryMode,
      points: Number(q.points) || (q.type === "mcq" ? 1 : q.type === "written" ? 5 : 10),
    })),
    answers: {},
  };
  return paper;
}

function sheetKindFor(sheetName) {
  const s = String(sheetName).toLowerCase();
  if (/dsa/.test(s)) return "DSA";
  if (/^sql/.test(s)) return "SQL";
  if (/system.?design/.test(s)) return "System Design";
  if (/integration/.test(s)) return "Integrations";
  if (/extra|interview/.test(s)) return "Interview Extras";
  if (/\bos\b|network/.test(s)) return "OS & Networking";
  return "General";
}

// ============ CODING GRADER (▶ Run during a coding test) ============
// Correctness + 3 edge cases + complexity + 1 improvement suggestion. ~400 tokens.
export async function gradeCode({ question, code }) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key.");

  const system = `You are a senior interviewer grading a candidate's code during a timed test. Be ACCURATE, SPECIFIC, and TIGHT. Return VALID JSON only (no markdown fences).

{
  "correctness": "pass" | "fail" | "partial",
  "verdict": "ONE sentence verdict",
  "edgeCases": [
    { "name": "short name (e.g. 'empty input', 'single element')", "pass": true | false, "note": "if fail, ONE sentence what breaks" }
  ],
  "complexity": {
    "time": "O(...)",
    "space": "O(...)",
    "matchesExpectation": true | false
  },
  "improvement": "ONE sentence improvement — pick the single most impactful change. Not nitpicks."
}

RULES:
- edgeCases: EXACTLY 3 entries, probing realistic traps for this problem.
- No code sketches in the response. Verbal only.
- correctness "partial" is for solutions that work on happy path but miss an edge.`;

  const user = `PROBLEM:
${question.stem}

EXPECTED COMPLEXITY: ${question.complexityExpectation || "(not specified)"}
EXAMPLE SOLUTION (reference, do not quote):
${question.exampleSolution || ""}

CANDIDATE'S CODE:
\`\`\`
${code}
\`\`\`

Grade it. JSON only.`;

  const res = await callGroqJSON({
    apiKey, system, user, maxTokens: 768, label: "test-code-grade",
    schemaCheck: (obj) => {
      if (!obj || typeof obj !== "object") return "not an object";
      if (!obj.correctness || !["pass", "fail", "partial"].includes(obj.correctness)) return "bad correctness";
      if (!obj.verdict) return "missing verdict";
      if (!Array.isArray(obj.edgeCases) || obj.edgeCases.length !== 3) return "need exactly 3 edgeCases";
      if (!obj.complexity?.time) return "missing complexity.time";
      if (!obj.improvement) return "missing improvement";
      return true;
    },
  });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// ============ WRITTEN GRADER ============
// Compares the candidate's answer to the model answer + rubric. Returns a 0-5 score.
export async function gradeWritten({ question, answer }) {
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) throw new Error("No Groq API key.");

  const system = `You are a senior interviewer grading a written answer. Be FAIR but STRICT. Score 0-5 where:
0 = empty / nonsense
1 = acknowledges the question
2 = partial understanding
3 = mostly right, misses nuance
4 = correct, with the key points
5 = correct + interview-ready phrasing + bonus insight

Return VALID JSON only:
{
  "score": 0-5,
  "verdict": "ONE sentence judgment",
  "missing": ["bullet point of ONE key thing missing", ...up to 3],
  "praised": ["bullet point of ONE thing done well", ...up to 2]
}`;

  const user = `QUESTION:
${question.stem}

MODEL ANSWER (reference):
${question.modelAnswer}

RUBRIC:
${question.rubric || "(no rubric; use your judgment based on model answer)"}

CANDIDATE'S ANSWER:
${answer || "(no answer provided)"}

Grade it. JSON only.`;

  const res = await callGroqJSON({
    apiKey, system, user, maxTokens: 512, label: "test-written-grade",
    schemaCheck: (obj) => {
      if (!obj || typeof obj !== "object") return "not an object";
      const s = Number(obj.score);
      if (!Number.isFinite(s) || s < 0 || s > 5) return "bad score";
      if (!obj.verdict) return "missing verdict";
      return true;
    },
  });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// ============ FINAL SCORECARD + BOUNTY ============

export async function finalizeAttempt(attempt) {
  // attempt.answers: { [qid]: { response, codeGrade?, writtenGrade? } }
  const summary = { perQ: [], raw: 0, max: 0 };

  for (const q of attempt.questions) {
    const a = attempt.answers[q.id] || {};
    const points = Number(q.points) || 1;
    summary.max += points;
    let earned = 0, correct = false, feedback = "";

    if (q.type === "mcq") {
      correct = Number.isInteger(a.response) && a.response === q.correctIdx;
      earned = correct ? points : 0;
      feedback = q.explanation || "";
    } else if (q.type === "written") {
      if (a.writtenGrade?.score != null) {
        earned = (Number(a.writtenGrade.score) / 5) * points;
        correct = Number(a.writtenGrade.score) >= 3;
        feedback = a.writtenGrade.verdict || "";
      } else if (!a.response || !String(a.response).trim()) {
        earned = 0;
      } else {
        // Response given but ungraded (user didn't tap Grade). Attempt a grade now.
        try {
          const grade = await gradeWritten({ question: q, answer: a.response });
          a.writtenGrade = grade;
          earned = (Number(grade.score) / 5) * points;
          correct = Number(grade.score) >= 3;
          feedback = grade.verdict || "";
        } catch (err) {
          earned = points * 0.5;  // benefit of the doubt if Groq is down
          feedback = "Ungraded — Groq unavailable at scoring time.";
        }
      }
    } else if (q.type === "coding") {
      if (a.codeGrade?.correctness) {
        const c = a.codeGrade.correctness;
        earned = c === "pass" ? points : c === "partial" ? points * 0.6 : 0;
        correct = c === "pass";
        feedback = a.codeGrade.verdict || "";
      } else if (!a.response || !String(a.response).trim()) {
        earned = 0;
      } else {
        try {
          const grade = await gradeCode({ question: q, code: a.response });
          a.codeGrade = grade;
          const c = grade.correctness;
          earned = c === "pass" ? points : c === "partial" ? points * 0.6 : 0;
          correct = c === "pass";
          feedback = grade.verdict || "";
        } catch (err) {
          earned = points * 0.5;
          feedback = "Ungraded — Groq unavailable at scoring time.";
        }
      }
    }

    summary.raw += earned;
    summary.perQ.push({
      qid: q.id, topic: q.topic, type: q.type, points,
      earned: Math.round(earned * 10) / 10, correct, feedback,
    });
  }

  const pct = summary.max > 0 ? Math.round((summary.raw / summary.max) * 100) : 0;
  const grade = pct >= 90 ? "A" : pct >= 80 ? "B" : pct >= 70 ? "C" : pct >= 60 ? "D" : "F";
  summary.pct = pct;
  summary.grade = grade;

  // Bounty — scaled: full at 100%, half at 60%, zero below 40%.
  const s = getSettings();
  const multi = Number(s?.schedule?.tests?.bountyMultiplier) || 1;
  const mcqCount = attempt.questions.filter(q => q.type === "mcq").length;
  const wrCount = attempt.questions.filter(q => q.type === "written").length;
  const cdCount = attempt.questions.filter(q => q.type === "coding").length;
  const base = 100 + 10 * mcqCount + 50 * wrCount + 100 * cdCount;
  let scale;
  if (pct >= 100) scale = 1;
  else if (pct >= 80) scale = 0.8 + (pct - 80) / 100;        // 0.80 → 1.00
  else if (pct >= 60) scale = 0.4 + (pct - 60) / 50;         // 0.40 → 0.80
  else if (pct >= 40) scale = (pct - 40) / 50;               // 0.00 → 0.40
  else scale = 0;
  const bountyEarned = Math.round(base * scale * multi);
  summary.bountyEarned = bountyEarned;
  summary.bountyBase = base;

  // Mastery deltas: wrong demotes pattern ★, right bumps it. Dedup per pattern.
  const touched = new Map();  // pattern → net delta
  for (const row of summary.perQ) {
    if (!row.topic) continue;
    const prev = touched.get(row.topic) || 0;
    touched.set(row.topic, prev + (row.correct ? 1 : -1));
  }
  const masteryDeltas = Array.from(touched.entries()).map(([topic, delta]) => ({ topic, delta }));

  // Save it + bank bounty
  const finished = {
    ...attempt,
    submittedAt: Date.now(),
    score: { raw: Math.round(summary.raw * 10) / 10, max: summary.max, pct, grade },
    bountyEarned,
    masteryDeltas,
    perQ: summary.perQ,
  };
  recordAttempt(finished);

  if (bountyEarned > 0) {
    await updateWallet(w => {
      w.earned = (w.earned || 0) + bountyEarned;
      w.ledger.push({
        date: new Date().toISOString(),
        type: "test",
        amount: bountyEarned,
        label: `${finished.title || finished.sheetName} · ${grade} (${pct}%)`,
      });
    });
  }

  return finished;
}

// ============ WEEKLY SCHEDULE HELPERS ============

export function isoWeekKey(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
  const firstThursday = dt.valueOf();
  dt.setUTCMonth(0, 1);
  if (dt.getUTCDay() !== 4) dt.setUTCMonth(0, 1 + ((4 - dt.getUTCDay()) + 7) % 7);
  const weekNum = 1 + Math.ceil((firstThursday - dt.valueOf()) / 604800000);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export async function setWeeklyPreference(enabled) {
  await updateSettings(st => {
    if (!st.schedule.tests) st.schedule.tests = {};
    st.schedule.tests.weeklyEnabled = !!enabled;
  });
}
