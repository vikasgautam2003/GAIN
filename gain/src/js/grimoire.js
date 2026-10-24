// Grimoire export — one Settings button generates a single Markdown file
// containing every scrap of your work: KeyIdea / Notes / Solution / Lesson /
// Status / Confidence / DateSolved — grouped by Sheet → Pattern → Problem.
//
// Scope: only rows with ANY user content (Solution OR Notes OR KeyIdea OR
// saved lesson OR Status ≠ TODO). Blank rows are skipped so the file stays
// signal, not noise.

import { getSheets, getDayLog } from "./store.js";

const LESSON_CACHE_PREFIX = "gain:lesson:";

export async function exportGrimoire() {
  const sheets = getSheets();
  const dayLog = getDayLog();

  // Pass 1 — collect kept rows by sheet, then by pattern
  const byShelf = {};
  let totalRows = 0;
  let totalWithSolutions = 0;
  let totalWithNotes = 0;
  let totalWithLessons = 0;

  for (const [sheetName, sheet] of Object.entries(sheets)) {
    if (!sheet.rows?.length) continue;
    const headers = sheet.headers;
    const col = {
      title: headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim())),
      pattern: headers.find(h => /^(pattern|category)$/i.test(h)),
      difficulty: headers.find(h => /^difficulty$/i.test(h)),
      status: headers.find(h => /^status$/i.test(h)),
      confidence: headers.find(h => /^confidence$/i.test(h)),
      dateDone: headers.find(h => /^(datesolved|datedone)$/i.test(h)),
      keyIdea: headers.find(h => /^keyidea$/i.test(h)),
      notes: headers.find(h => /^notes$/i.test(h)),
      solution: headers.find(h => /^solution$/i.test(h)),
      lc: headers.find(h => /^lc#?$/i.test(h)),
      freq: headers.find(h => /^(freq|priority)$/i.test(h)),
    };

    for (let i = 0; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const title = row[col.title] || "";
      if (!title.trim()) continue;

      const status = row[col.status] || "";
      const hasSolution = col.solution && (row[col.solution] || "").trim();
      const hasNotes = col.notes && (row[col.notes] || "").trim();
      const hasKeyIdea = col.keyIdea && (row[col.keyIdea] || "").trim();
      const lesson = loadLessonCache(sheetName, i);
      const hasLesson = !!lesson;
      const nonTodoStatus = status && !/^todo$/i.test(status);

      // Only keep rows with ANY user content
      if (!hasSolution && !hasNotes && !hasKeyIdea && !hasLesson && !nonTodoStatus) continue;

      if (hasSolution) totalWithSolutions++;
      if (hasNotes || hasKeyIdea) totalWithNotes++;
      if (hasLesson) totalWithLessons++;
      totalRows++;

      const pattern = row[col.pattern] || "(no pattern)";
      byShelf[sheetName] = byShelf[sheetName] || {};
      byShelf[sheetName][pattern] = byShelf[sheetName][pattern] || [];
      byShelf[sheetName][pattern].push({
        rowIndex: i,
        title,
        status,
        confidence: row[col.confidence] || "",
        dateDone: row[col.dateDone] || "",
        difficulty: row[col.difficulty] || "",
        lc: row[col.lc] || "",
        freq: row[col.freq] || "",
        keyIdea: row[col.keyIdea] || "",
        notes: row[col.notes] || "",
        solution: row[col.solution] || "",
        lesson,
      });
    }
  }

  // Build Markdown
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const lines = [];
  lines.push(`# GAIN · Grimoire · ${stamp}`);
  lines.push(``);
  lines.push(`> ${totalRows} problems · ${totalWithSolutions} with solutions · ${totalWithNotes} with notes · ${totalWithLessons} with saved lessons`);
  lines.push(``);
  lines.push(`Discipline builds freedom. The sheet remembers everything.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // Table of contents
  lines.push(`## Contents`);
  lines.push(``);
  for (const [sheetName, patterns] of Object.entries(byShelf)) {
    lines.push(`- [${sheetName}](#${slug(sheetName)})`);
    for (const [patternName, rows] of Object.entries(patterns)) {
      lines.push(`  - [${patternName}](#${slug(sheetName)}-${slug(patternName)}) · ${rows.length}`);
    }
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // Each sheet
  for (const [sheetName, patterns] of Object.entries(byShelf)) {
    lines.push(`<a id="${slug(sheetName)}"></a>`);
    lines.push(`## ${sheetName}`);
    lines.push(``);

    // Pattern sections, sorted by size descending (biggest first = most studied)
    const sortedPatterns = Object.entries(patterns).sort((a, b) => b[1].length - a[1].length);
    for (const [patternName, rows] of sortedPatterns) {
      lines.push(`<a id="${slug(sheetName)}-${slug(patternName)}"></a>`);
      lines.push(`### ${patternName}  <sub>${rows.length} problem${rows.length === 1 ? "" : "s"}</sub>`);
      lines.push(``);

      for (const r of rows) {
        lines.push(`#### ${r.title}${r.lc ? ` <sub>· LC #${r.lc}</sub>` : ""}`);
        lines.push(``);
        // Compact meta line
        const meta = [];
        if (r.difficulty) meta.push(`**${r.difficulty}**`);
        if (r.status) meta.push(`Status: \`${r.status}\``);
        if (r.confidence) meta.push(`★ ${r.confidence}`);
        if (r.dateDone) meta.push(`solved ${r.dateDone}`);
        if (r.freq) meta.push(`freq ${r.freq}`);
        if (meta.length) {
          lines.push(meta.join(" · "));
          lines.push(``);
        }
        // KeyIdea — the one-line pointer
        if (r.keyIdea.trim()) {
          lines.push(`> **Key idea**: ${r.keyIdea.trim()}`);
          lines.push(``);
        }
        // Notes
        if (r.notes.trim()) {
          lines.push(`**Notes**`);
          lines.push(``);
          lines.push(r.notes.trim());
          lines.push(``);
        }
        // Solution code
        if (r.solution.trim()) {
          lines.push(`**Solution**`);
          lines.push(``);
          lines.push(`\`\`\``);
          lines.push(r.solution.trim());
          lines.push(`\`\`\``);
          lines.push(``);
        }
        // Lesson (if cached)
        if (r.lesson) {
          lines.push(`<details><summary>Lesson</summary>`);
          lines.push(``);
          lines.push(renderLessonMarkdown(r.lesson));
          lines.push(``);
          lines.push(`</details>`);
          lines.push(``);
        }
        lines.push(`---`);
        lines.push(``);
      }
    }
  }

  lines.push(``);
  lines.push(`Generated by GAIN · ${now.toISOString()}`);
  lines.push(``);

  const text = lines.join("\n");
  const filename = `gain-grimoire-${stamp}.md`;
  downloadFile(filename, text);
  return { totalRows, totalWithSolutions, totalWithNotes, totalWithLessons, filename };
}

function loadLessonCache(sheetName, rowIndex) {
  try {
    const raw = localStorage.getItem(LESSON_CACHE_PREFIX + `${sheetName}#${rowIndex}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function renderLessonMarkdown(lesson) {
  const bits = [];
  if (lesson.oneLineGist) bits.push(`> **Gist**: ${lesson.oneLineGist}`);
  for (const s of lesson.sections || []) {
    bits.push(``);
    bits.push(`**${s.title}**`);
    bits.push(``);
    if (s.setup) bits.push(s.setup);
    if (Array.isArray(s.bullets) && s.bullets.length) {
      bits.push(``);
      for (const b of s.bullets) bits.push(`- ${b}`);
    }
  }
  if (lesson.toolkit) {
    bits.push(``);
    bits.push(`**🧰 Toolkit**`);
    bits.push(``);
    if (lesson.toolkit.setup) bits.push(lesson.toolkit.setup);
    if (Array.isArray(lesson.toolkit.structures) && lesson.toolkit.structures.length) {
      bits.push(``);
      bits.push(`*Data structures*`);
      for (const it of lesson.toolkit.structures) bits.push(`- **${it.name}** — ${it.why}`);
    }
    if (Array.isArray(lesson.toolkit.algorithms) && lesson.toolkit.algorithms.length) {
      bits.push(``);
      bits.push(`*Algorithms / techniques*`);
      for (const it of lesson.toolkit.algorithms) bits.push(`- **${it.name}** — ${it.why}`);
    }
  }
  if (lesson.youtubeQuery) {
    const q = encodeURIComponent(lesson.youtubeQuery);
    bits.push(``);
    bits.push(`▶ [Watch it explained](https://www.youtube.com/results?search_query=${q})`);
  }
  return bits.join("\n");
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function downloadFile(filename, text) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 200);
}
