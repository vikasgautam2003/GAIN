// 9E · Weekly review export — Groq reflects on last 7 days + exports .md
// One button, one Groq call, honest-mentor voice. Printable.

import { getDayLog, getSheets, getWallet, callGrok, secure } from "./store.js";
import { calendarKey } from "./engine.js";

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
