// Bulletproof Groq JSON pipeline — used by lesson, warmup, weekly report, and
// anywhere else that needs structured output. One helper, one retry policy,
// one validator contract. Fixes the recurring "json_validate_failed" and the
// "Groq wrapped it in prose / fences" bugs once.
//
// Usage:
//   const res = await callGroqJSON({
//     apiKey, system, user,
//     schemaCheck: (obj) => obj?.quiz?.length === 8 ? true : "quiz must have 8 Qs",
//     maxTokens: 4096,
//     label: "warmup",            // for logs
//   });
//   if (!res.ok) throw new Error(res.error);
//   use(res.data);

import { callGrok } from "./store.js";

const TEMP = 0.3;

export async function callGroqJSON({
  apiKey,
  system,
  user,
  schemaCheck = () => true,
  maxTokens = 4096,
  label = "groq",
}) {
  if (!apiKey) return { ok: false, error: "No Groq API key. Add one in Settings → AI butler." };

  const sysWithFormatHint = system + "\n\nIMPORTANT: Your response must be a single JSON object. No prose before or after. No code fences. Start the response with { and end with }.";

  // --- Attempt 1: json_mode on, generous tokens, low temp (the happy path) ---
  let attempt = 1;
  let lastErr = "";
  try {
    const r = await callGrok({
      apiKey, jsonMode: true, maxTokens, temperature: TEMP,
      system: sysWithFormatHint, user,
    });
    if (r.ok) {
      const parsed = extractJson(r.content);
      if (parsed) {
        const verdict = schemaCheck(parsed);
        if (verdict === true) return { ok: true, data: parsed, attempts: 1 };
        lastErr = `schema check failed: ${verdict}`;
      } else {
        lastErr = "attempt 1: couldn't extract JSON from response";
      }
    } else {
      lastErr = r.error || "attempt 1 failed";
    }
  } catch (e) {
    lastErr = `attempt 1 threw: ${e.message || e}`;
  }
  log(label, 1, lastErr);

  // --- Attempt 2: json_mode OFF, demand JSON in prompt, lower temp ---
  attempt = 2;
  try {
    const r = await callGrok({
      apiKey, jsonMode: false, maxTokens, temperature: 0.2,
      system: sysWithFormatHint + "\n\nREMINDER: Do not wrap the JSON in ``` fences. Do not add explanation sentences. The first character of your reply must be '{'.",
      user: user + "\n\nReply with ONLY the JSON object. Nothing else.",
    });
    if (r.ok) {
      const parsed = extractJson(r.content);
      if (parsed) {
        const verdict = schemaCheck(parsed);
        if (verdict === true) return { ok: true, data: parsed, attempts: 2 };
        lastErr = `attempt 2 schema check failed: ${verdict}`;
      } else {
        lastErr = "attempt 2: couldn't extract JSON";
      }
    } else {
      lastErr = r.error || "attempt 2 failed";
    }
  } catch (e) {
    lastErr = `attempt 2 threw: ${e.message || e}`;
  }
  log(label, 2, lastErr);

  // --- Attempt 3: last-ditch — simpler, tighter, "if you cant return everything return minimal valid JSON" ---
  attempt = 3;
  try {
    const r = await callGrok({
      apiKey, jsonMode: true, maxTokens: Math.min(maxTokens, 2048), temperature: 0.1,
      system: sysWithFormatHint + "\n\nIf you cannot fit every detail, return a MINIMAL JSON object that still matches the schema structurally — shorter strings, fewer bullets. Validity beats richness.",
      user,
    });
    if (r.ok) {
      const parsed = extractJson(r.content);
      if (parsed) {
        const verdict = schemaCheck(parsed);
        if (verdict === true) return { ok: true, data: parsed, attempts: 3 };
        lastErr = `attempt 3 schema check failed: ${verdict}`;
      } else {
        lastErr = "attempt 3: couldn't extract JSON";
      }
    } else {
      lastErr = r.error || "attempt 3 failed";
    }
  } catch (e) {
    lastErr = `attempt 3 threw: ${e.message || e}`;
  }
  log(label, 3, lastErr);

  return { ok: false, error: lastErr || "Groq JSON pipeline exhausted 3 attempts", attempts: 3 };
}

// Multi-strategy JSON extractor. Handles: raw JSON, fenced ```json, prose
// before/after, trailing commentary, nested braces. Last-resort: find first `{`
// and the matching `}` via brace-counting (not just lastIndexOf, which breaks
// on nested objects with text after the real end).
export function extractJson(text) {
  if (!text) return null;
  const raw = String(text).trim();

  // 1. plain parse
  try { return JSON.parse(raw); } catch (_) {}

  // 2. strip surrounding ```json fences and leading non-JSON prose up to the first {
  const defenced = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try { return JSON.parse(defenced); } catch (_) {}

  // 3. brace-balanced extraction — walk the string, find the first `{`,
  // then count braces (respecting strings/escapes) until balance returns to 0.
  const start = defenced.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < defenced.length; i++) {
    const ch = defenced[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = defenced.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch (_) {}
        break;
      }
    }
  }

  // 4. final fallback — the old lastIndexOf cut (occasionally saves us when
  // brace counting fails on malformed strings mid-generation)
  const end = defenced.lastIndexOf("}");
  if (end > start) {
    try { return JSON.parse(defenced.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

function log(label, attempt, msg) {
  console.warn(`[groqJson:${label}] attempt ${attempt} — ${msg}`);
}
