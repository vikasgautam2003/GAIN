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
const MAX_429_WAIT_MS = 90_000;   // never pause more than 90s per retry
const MAX_429_RETRIES = 1;        // retry once per attempt — not infinite

// Groq rate-limit error includes "try again in 33.9225s". Parse it so we can
// auto-retry instead of surfacing the raw JSON to the user. Returns ms to wait,
// or 0 if the error isn't a parseable 429.
function parseRetryAfterMs(errText) {
  if (!errText) return 0;
  const s = String(errText);
  if (!/429|rate.?limit|too many requests/i.test(s)) return 0;
  const m = s.match(/try again in ([\d.]+)\s*s/i);
  if (m) {
    const sec = parseFloat(m[1]);
    if (Number.isFinite(sec) && sec > 0) return Math.min(MAX_429_WAIT_MS, Math.ceil(sec * 1000) + 500);
  }
  // Fallback: no number, generic retry — assume 30s
  return 30_000;
}

// Visible countdown toast while we wait out a rate-limit. Idempotent — reuses
// the same DOM node across retries so we don't stack toasts.
function showRetryToast(label, waitMs) {
  const id = "groq-429-toast";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.setAttribute("role", "status");
    el.style.cssText = [
      "position:fixed", "bottom:24px", "left:50%", "transform:translateX(-50%)",
      "z-index:9999", "padding:12px 18px", "border-radius:12px",
      "background:var(--paper, #fff)", "color:var(--ink, #000)",
      "border:1px solid var(--line, rgba(0,0,0,.1))",
      "box-shadow:0 10px 30px rgba(0,0,0,.18)",
      "font:600 13px/1.4 var(--font-sans, -apple-system, BlinkMacSystemFont, sans-serif)",
      "display:flex", "align-items:center", "gap:10px",
      "max-width:90vw",
    ].join(";");
    document.body.appendChild(el);
  }
  let remaining = Math.ceil(waitMs / 1000);
  const render = () => {
    el.innerHTML = `
      <span style="font-size:16px;">⏳</span>
      <span>Groq cooling down (${label}) — retrying in <b>${remaining}s</b>…</span>
    `;
  };
  render();
  const int = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(int); el.remove(); return; }
    render();
  }, 1000);
  return () => { clearInterval(int); el.remove(); };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Wrapper around callGrok that transparently handles 429 with ONE retry per
// outer attempt. If it still fails, the outer pipeline moves to the next
// attempt (attempt 2 / 3) which may use different params and succeed.
async function callGrokWithRetry(args, label) {
  let r = await callGrok(args);
  if (r.ok) return r;
  // Groq errors land on r.error (string). Rust bubbles the body up verbatim.
  const waitMs = parseRetryAfterMs(r.error);
  if (!waitMs) return r;
  // Only retry MAX_429_RETRIES per call. Don't recurse.
  const dismiss = showRetryToast(label, waitMs);
  try {
    await sleep(waitMs);
  } finally {
    dismiss();
  }
  const r2 = await callGrok(args);
  return r2;
}

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
    const r = await callGrokWithRetry({
      apiKey, jsonMode: true, maxTokens, temperature: TEMP,
      system: sysWithFormatHint, user,
    }, label);
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
    const r = await callGrokWithRetry({
      apiKey, jsonMode: false, maxTokens, temperature: 0.2,
      system: sysWithFormatHint + "\n\nREMINDER: Do not wrap the JSON in ``` fences. Do not add explanation sentences. The first character of your reply must be '{'.",
      user: user + "\n\nReply with ONLY the JSON object. Nothing else.",
    }, label);
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
    const r = await callGrokWithRetry({
      apiKey, jsonMode: true, maxTokens: Math.min(maxTokens, 2048), temperature: 0.1,
      system: sysWithFormatHint + "\n\nIf you cannot fit every detail, return a MINIMAL JSON object that still matches the schema structurally — shorter strings, fewer bullets. Validity beats richness.",
      user,
    }, label);
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

  // Last-mile UX: if the final error is a rate limit, surface a human-friendly
  // explanation instead of raw Groq JSON so the "Try again" button makes sense.
  if (lastErr && /429|rate.?limit|too many requests/i.test(lastErr)) {
    const m = String(lastErr).match(/try again in ([\d.]+)\s*s/i);
    const retrySec = m ? parseFloat(m[1]) : null;
    const modelMatch = String(lastErr).match(/model `([^`]+)`/i);
    const model = modelMatch ? modelMatch[1] : null;
    const parts = [
      `Groq hit its per-minute token budget${model ? ` for ${model}` : ""}.`,
      retrySec ? `It wants another ${Math.ceil(retrySec)}s before you try again.` : "",
      model && !/openai\/gpt-oss-20b/i.test(model)
        ? `Tip: switch to \`openai/gpt-oss-20b\` in Settings → AI butler — public tier (250K TPM, 1000 t/s), far more headroom than ${model}.`
        : "",
    ].filter(Boolean);
    return { ok: false, error: parts.join(" "), attempts: 3, rateLimited: true };
  }
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
