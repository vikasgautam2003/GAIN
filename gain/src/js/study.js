// Streamlined-study mode.
// When enabled for a sheet, Today's planner and Suggest only pick problems
// from that sheet's CURRENT ACTIVE TOPIC. A topic is active until the user
// has solved ≥ 10 problems inside it AND the average ★ of the last 10 solves
// is ≥ 4. Then the next topic in `topicOrder[sheetName]` unlocks.
//
// Sheets WITHOUT a Pattern column fall back silently to random mode. Sheets
// with no topicOrder yet have one seeded from the sheet's own pattern frequency
// (so an untouched install still has a sensible default).

import { getSettings, updateSettings, getSheets, getDayLog } from "./store.js";

// Sync accessor hook — engine.js reads this at pickNextDsa time to filter by
// the current active topic without having to switch to async plan building.
if (typeof window !== "undefined") {
  window.__gainStudy = {
    getActiveTopic: (name) => getActiveTopic(name),
    isStreamlined: (name) => isStreamlined(name),
    allowCandidate: (sheet, pattern) => allowCandidate(sheet, pattern),
  };
}

const MIN_SOLVES_PER_TOPIC = 10;
const UNLOCK_AVG_STARS = 4;
const WINDOW_SOLVES = 10;

// ============ STATE READERS ============

export function isStreamlined(sheetName) {
  const s = getSettings();
  return Boolean(s?.schedule?.study?.streamlined?.[sheetName]);
}

export function getTopicOrder(sheetName) {
  const s = getSettings();
  const explicit = s?.schedule?.study?.topicOrder?.[sheetName];
  if (Array.isArray(explicit) && explicit.length) return explicit.slice();
  // Fall back to shipped default
  const def = s?.schedule?.study?.defaultOrder?.[sheetName];
  if (Array.isArray(def) && def.length) return def.slice();
  // Last resort: derive from the sheet's own patterns in first-seen Seq order
  return derivePatternsFromSheet(sheetName);
}

function derivePatternsFromSheet(sheetName) {
  const sh = getSheets()[sheetName];
  if (!sh?.rows?.length || !sh.headers?.length) return [];
  const patternCol = sh.headers.find(h => /^(pattern|category)$/i.test(h));
  if (!patternCol) return [];
  const seen = new Set();
  const out = [];
  for (const r of sh.rows) {
    const p = String(r[patternCol] || "").trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

// Does this sheet have a Pattern column AT ALL? If not, streamlined falls back.
export function sheetHasPatterns(sheetName) {
  const sh = getSheets()[sheetName];
  if (!sh?.headers?.length) return false;
  return !!sh.headers.find(h => /^(pattern|category)$/i.test(h));
}

// Count solves + avg of last 10 ★ in `pattern` on `sheetName` across all time.
// Walks dayLog. Returns { solves, avgLast10 }. If no solves yet, avgLast10 is null.
export function solveStatsFor(sheetName, pattern) {
  const dayLog = getDayLog();
  const dates = Object.keys(dayLog).sort().reverse();
  let totalSolves = 0;
  const stars = [];
  for (const d of dates) {
    const entry = dayLog[d];
    if (!entry?.assigned?.length || !entry?.done?.length) continue;
    for (const task of entry.assigned) {
      if (!entry.done.includes(task.ref)) continue;
      if (task.sheet !== sheetName) continue;
      if ((task.pattern || "") !== pattern) continue;
      totalSolves++;
      const star = Number(entry.confidence?.[task.ref]);
      if (Number.isFinite(star) && star >= 1 && star <= 5) stars.push(star);
    }
  }
  const last10 = stars.slice(0, WINDOW_SOLVES);
  const avgLast10 = last10.length ? (last10.reduce((a, b) => a + b, 0) / last10.length) : null;
  return { solves: totalSolves, avgLast10, lastWindow: last10.length };
}

// Count how many PROBLEMS exist in `sheetName` tagged with `pattern` (the pool size).
function patternPoolSize(sheetName, pattern) {
  const sh = getSheets()[sheetName];
  if (!sh?.rows?.length) return 0;
  const patternCol = sh.headers.find(h => /^(pattern|category)$/i.test(h));
  if (!patternCol) return 0;
  let n = 0;
  for (const r of sh.rows) {
    if (String(r[patternCol] || "").trim() === pattern) n++;
  }
  return n;
}

// Topic is cleared when solves ≥ min(10, poolSize) AND avgLast10 ≥ 4.
export function isTopicCleared(sheetName, pattern) {
  const { solves, avgLast10, lastWindow } = solveStatsFor(sheetName, pattern);
  const needed = Math.min(MIN_SOLVES_PER_TOPIC, Math.max(1, patternPoolSize(sheetName, pattern)));
  if (solves < needed) return false;
  if (lastWindow < Math.min(WINDOW_SOLVES, needed)) return false;
  return (avgLast10 ?? 0) >= UNLOCK_AVG_STARS;
}

// Returns the active topic name, or null if (a) sheet is in random mode,
// (b) sheet has no Pattern column, or (c) every ordered topic is cleared.
export function getActiveTopic(sheetName) {
  if (!isStreamlined(sheetName)) return null;
  if (!sheetHasPatterns(sheetName)) return null;
  const order = getTopicOrder(sheetName);
  for (const p of order) {
    if (!isTopicCleared(sheetName, p)) return p;
  }
  return null;
}

// Progress toward unlocking the CURRENT active topic. Useful for the hero UI.
// Returns { topic, solves, avgLast10, solvesNeeded, avgNeeded, nextTopic }.
export function activeTopicProgress(sheetName) {
  const topic = getActiveTopic(sheetName);
  if (!topic) return null;
  const stats = solveStatsFor(sheetName, topic);
  const order = getTopicOrder(sheetName);
  const idx = order.indexOf(topic);
  const nextTopic = idx >= 0 && idx + 1 < order.length ? order[idx + 1] : null;
  const needed = Math.min(MIN_SOLVES_PER_TOPIC, Math.max(1, patternPoolSize(sheetName, topic)));
  return {
    sheet: sheetName,
    topic,
    nextTopic,
    solves: stats.solves,
    solvesNeeded: needed,
    avgLast10: stats.avgLast10,
    avgNeeded: UNLOCK_AVG_STARS,
    windowSize: WINDOW_SOLVES,
  };
}

// ============ STATE WRITERS ============

export async function setStreamlined(sheetName, on) {
  await updateSettings(st => {
    if (!st.schedule.study) st.schedule.study = { streamlined: {}, topicOrder: {} };
    if (!st.schedule.study.streamlined) st.schedule.study.streamlined = {};
    st.schedule.study.streamlined[sheetName] = !!on;
  });
}

export async function setStreamlinedAll(on) {
  const sheetNames = Object.keys(getSheets());
  await updateSettings(st => {
    if (!st.schedule.study) st.schedule.study = { streamlined: {}, topicOrder: {} };
    if (!st.schedule.study.streamlined) st.schedule.study.streamlined = {};
    for (const n of sheetNames) st.schedule.study.streamlined[n] = !!on;
  });
}

export async function setTopicOrder(sheetName, orderArray) {
  await updateSettings(st => {
    if (!st.schedule.study) st.schedule.study = { streamlined: {}, topicOrder: {} };
    if (!st.schedule.study.topicOrder) st.schedule.study.topicOrder = {};
    st.schedule.study.topicOrder[sheetName] = Array.isArray(orderArray)
      ? orderArray.filter(x => x && String(x).trim())
      : [];
  });
}

// Filter helper used by engine + suggest. Given a candidate row object
// (must have `.pattern`), returns true if it belongs to the active topic
// for the sheet. For random-mode sheets, always true.
export function allowCandidate(sheetName, candidatePattern) {
  const active = getActiveTopic(sheetName);
  if (!active) return true;
  return String(candidatePattern || "").trim() === active;
}

// ============ UI — MODE BAR ============

const SCOPE_ALL = "__all__";

export function openStudyModeBar(root, onChange) {
  injectStyles();
  // The hostEl is a dedicated slot — we only paint INTO it, never create new ones.
  const hostId = "today-study-mode";
  let host = document.getElementById(hostId);
  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    host.className = "sm-bar";
    // Insert it right under the hero / above the task rows. We're a bit
    // defensive about the mount point in case the Today DOM changes.
    const rows = root.querySelector("#plan-rows") || root.querySelector("#today-rows") || root.querySelector(".today-rows") || root.querySelector(".task-rows");
    if (rows && rows.parentNode) rows.parentNode.insertBefore(host, rows);
    else root.appendChild(host);
  }

  const sheetNames = Object.keys(getSheets());
  if (!sheetNames.length) { host.innerHTML = ""; return; }

  // Which sheet is currently in focus for the bar? Default = first sheet.
  // We persist the user's last pick on the host element dataset so re-paints keep it.
  const current = host.dataset.scope || sheetNames[0];
  const scopeIsAll = current === SCOPE_ALL;

  let modeLabel, progressHtml;
  if (scopeIsAll) {
    // Aggregate: if ANY sheet is in streamlined mode, we show "mixed"
    const vals = sheetNames.map(s => isStreamlined(s));
    const allOn = vals.every(Boolean);
    const allOff = vals.every(v => !v);
    modeLabel = allOn ? "streamlined" : allOff ? "random" : "mixed";
    progressHtml = "";
  } else {
    modeLabel = isStreamlined(current) ? "streamlined" : "random";
    if (modeLabel === "streamlined") {
      const prog = activeTopicProgress(current);
      if (prog) {
        const avgTxt = prog.avgLast10 != null ? prog.avgLast10.toFixed(2) : "—";
        progressHtml = `
          <div class="sm-progress">
            <span class="sm-progress-tag">ACTIVE TOPIC</span>
            <span class="sm-progress-topic">${esc(prog.topic)}</span>
            <span class="sm-progress-stat">${prog.solves}/${prog.solvesNeeded} solves</span>
            <span class="sm-progress-stat">avg ★ ${avgTxt} / ${prog.avgNeeded}</span>
            ${prog.nextTopic ? `<span class="sm-progress-next">next: <b>${esc(prog.nextTopic)}</b></span>` : `<span class="sm-progress-next">last topic — one more unlocks the mastery badge</span>`}
          </div>
        `;
      } else {
        progressHtml = sheetHasPatterns(current)
          ? `<div class="sm-progress sm-progress-done">✓ All topics cleared on ${esc(current)}.</div>`
          : `<div class="sm-progress sm-progress-fallback">${esc(current)} has no Pattern column — using random order silently.</div>`;
      }
    } else {
      progressHtml = "";
    }
  }

  host.innerHTML = `
    <div class="sm-bar-row">
      <label class="sm-label">Study mode</label>
      <select class="sm-sheet" id="sm-sheet">
        ${sheetNames.map(n => `<option value="${esc(n)}" ${n === current ? "selected" : ""}>${esc(n)}</option>`).join("")}
        <option value="${SCOPE_ALL}" ${scopeIsAll ? "selected" : ""}>All sheets</option>
      </select>
      <div class="sm-toggle" role="radiogroup" aria-label="Mode">
        <button class="sm-toggle-btn ${modeLabel === "random" ? "active" : ""}" data-mode="random">Random</button>
        <button class="sm-toggle-btn ${modeLabel === "streamlined" ? "active" : ""}" data-mode="streamlined">Streamlined</button>
        ${modeLabel === "mixed" ? `<span class="sm-toggle-mixed">· mixed per sheet</span>` : ""}
      </div>
      <button class="sm-edit" id="sm-edit" ${scopeIsAll ? "disabled title='Pick a specific sheet to edit its topic order'" : ""}>
        <span>⚙</span> Edit order
      </button>
    </div>
    ${progressHtml}
  `;

  host.querySelector("#sm-sheet")?.addEventListener("change", (e) => {
    host.dataset.scope = e.target.value;
    openStudyModeBar(root, onChange);  // re-paint with the new scope
  });

  host.querySelectorAll("[data-mode]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const next = btn.dataset.mode;
      const target = host.dataset.scope || sheetNames[0];
      if (target === SCOPE_ALL) await setStreamlinedAll(next === "streamlined");
      else await setStreamlined(target, next === "streamlined");
      if (typeof onChange === "function") onChange();
      openStudyModeBar(root, onChange);
    });
  });

  host.querySelector("#sm-edit")?.addEventListener("click", () => {
    const target = host.dataset.scope || sheetNames[0];
    if (target === SCOPE_ALL) return;
    openOrderEditorImpl(target, () => {
      if (typeof onChange === "function") onChange();
      openStudyModeBar(root, onChange);
    });
  });
}

// ============ UI — ORDER EDITOR ============

export function openOrderEditor(sheetName, onDone) {
  injectStyles();
  openOrderEditorImpl(sheetName, onDone);
}

function openOrderEditorImpl(sheetName, onDone) {
  document.querySelectorAll(".so-scrim").forEach(s => s.remove());
  const order = getTopicOrder(sheetName);
  // Also surface any patterns FOUND IN THE SHEET that aren't in the order,
  // so the user sees everything.
  const sheetPatterns = derivePatternsFromSheet(sheetName);
  const missing = sheetPatterns.filter(p => !order.includes(p));
  const full = order.concat(missing);

  const scrim = document.createElement("div");
  scrim.className = "so-scrim";
  scrim.innerHTML = `
    <div class="so-modal" role="dialog" aria-label="Topic order">
      <header class="so-head">
        <div class="so-eyebrow">STREAMLINED</div>
        <h2 class="so-title">Topic order · ${esc(sheetName)}</h2>
        <p class="so-sub">In streamlined mode, the planner picks only from the <b>first unlocked topic</b>. A topic clears at 10 solves with average ★ ≥ 4.</p>
      </header>
      <div class="so-body">
        <div class="so-list" id="so-list">
          ${full.map((p, i) => renderRow(p, i, full.length)).join("")}
        </div>
        <div class="so-add-row">
          <input id="so-new" placeholder="Add a topic (e.g. Monotonic Stack)" />
          <button class="so-btn-primary" id="so-add">+ Add</button>
        </div>
      </div>
      <footer class="so-foot">
        <button class="so-btn-ghost" id="so-reset">Reset to default</button>
        <button class="so-btn-ai" id="so-ask-ai" title="Groq looks at the list and recommends an order based on interview-prep priority">✦ Ask AI</button>
        <span class="so-spacer"></span>
        <button class="so-btn-ghost" id="so-cancel">Cancel</button>
        <button class="so-btn-primary" id="so-save">Save</button>
      </footer>
    </div>
  `;
  document.body.appendChild(scrim);

  const close = () => scrim.remove();
  scrim.querySelector("#so-cancel")?.addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  const escH = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", escH); } };
  document.addEventListener("keydown", escH);

  const current = () => Array.from(scrim.querySelectorAll(".so-row")).map(r => r.dataset.name);

  const repaint = (items) => {
    const listEl = scrim.querySelector("#so-list");
    listEl.innerHTML = items.map((p, i) => renderRow(p, i, items.length)).join("");
    wireRows();
    wireDragReorder(listEl, (next) => repaint(next));
  };

  const wireRows = () => {
    scrim.querySelectorAll("[data-so-up]").forEach(btn => btn.addEventListener("click", () => {
      const items = current();
      const i = Number(btn.dataset.soUp);
      if (i <= 0) return;
      [items[i - 1], items[i]] = [items[i], items[i - 1]];
      repaint(items);
    }));
    scrim.querySelectorAll("[data-so-down]").forEach(btn => btn.addEventListener("click", () => {
      const items = current();
      const i = Number(btn.dataset.soDown);
      if (i >= items.length - 1) return;
      [items[i], items[i + 1]] = [items[i + 1], items[i]];
      repaint(items);
    }));
    scrim.querySelectorAll("[data-so-del]").forEach(btn => btn.addEventListener("click", () => {
      const items = current().filter(x => x !== btn.dataset.soDel);
      repaint(items);
    }));
  };

  wireRows();
  wireDragReorder(scrim.querySelector("#so-list"), (next) => repaint(next));

  scrim.querySelector("#so-add")?.addEventListener("click", () => {
    const input = scrim.querySelector("#so-new");
    const name = String(input.value || "").trim();
    if (!name) { input.focus(); return; }
    const items = current();
    if (items.includes(name)) { input.value = ""; input.focus(); return; }
    repaint([...items, name]);
    input.value = "";
    input.focus();
  });
  scrim.querySelector("#so-new")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") scrim.querySelector("#so-add")?.click();
  });

  scrim.querySelector("#so-reset")?.addEventListener("click", () => {
    const s = getSettings();
    const def = s?.schedule?.study?.defaultOrder?.[sheetName] || derivePatternsFromSheet(sheetName);
    repaint(def.slice());
  });

  scrim.querySelector("#so-save")?.addEventListener("click", async () => {
    await setTopicOrder(sheetName, current());
    close();
    if (typeof onDone === "function") onDone();
  });

  // ✦ Ask AI — Groq looks at the current list + sheet context and returns a
  // reordered list with a one-line rationale. The user sees a side-by-side
  // compare overlay with Apply / Dismiss. Non-destructive — nothing is saved
  // until the user also clicks the main Save button on the editor.
  scrim.querySelector("#so-ask-ai")?.addEventListener("click", async () => {
    const btn = scrim.querySelector("#so-ask-ai");
    const items = current();
    if (items.length < 2) {
      flashInline(btn, "Need at least 2 topics");
      return;
    }
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="so-ai-spin"></span> Asking Groq…`;
    try {
      const result = await askAiForOrder(sheetName, items);
      btn.innerHTML = original;
      btn.disabled = false;
      if (!result) return;
      openAiReviewOverlay(scrim, items, result, (nextOrder) => {
        repaint(nextOrder);
      });
    } catch (err) {
      btn.innerHTML = original;
      btn.disabled = false;
      flashInline(btn, "Groq failed · try again");
      console.warn("[study] ask AI failed", err);
    }
  });
}

function flashInline(btn, msg) {
  const original = btn.innerHTML;
  btn.innerHTML = msg;
  setTimeout(() => { btn.innerHTML = original; }, 1800);
}

// Pull a reorder recommendation from Groq. Returns { order: [patterns...], rationale: "..." }
// or null on failure. Caller handles UX.
async function askAiForOrder(sheetName, currentItems) {
  const { secure } = await import("./store.js");
  const { callGroqJSON } = await import("./groqJson.js");
  const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                 (await secure.get("grok_api_key").catch(() => null));
  if (!apiKey) {
    alert("No Groq API key — add one in Settings → AI butler to use ✦ Ask AI.");
    return null;
  }

  const sheetKindHint = /dsa/i.test(sheetName) ? "DSA / algorithms"
                      : /sql/i.test(sheetName) ? "SQL"
                      : /system.?design/i.test(sheetName) ? "system design"
                      : /integration/i.test(sheetName) ? "integrations / platforms"
                      : /extra|interview/i.test(sheetName) ? "interview extras"
                      : /os|network/i.test(sheetName) ? "OS and networking"
                      : "study topics";

  const system = `You are a senior FDE interview-prep coach. The user studies ${sheetKindHint} in STREAMLINED mode: the planner only picks problems from their CURRENT topic until they've nailed it (10 solves, avg ★ ≥ 4). Topic order therefore dictates learning path.

Reorder the user's topic list so that:
  - prerequisites come BEFORE things that depend on them (Arrays → Two Pointers → Sliding Window; Recursion → Backtracking → DP; Trees → Tries; etc.)
  - the topics most-asked in top-tier interviews come EARLY so the user builds a strong base fast
  - niche or advanced topics come LATE
  - every topic in the input appears EXACTLY ONCE in the output (no additions, no deletions, no renames)

Reply with VALID JSON matching this exact shape (no markdown, no code fences):
{
  "order": ["Topic 1", "Topic 2", "Topic 3", ...],
  "rationale": "ONE sentence (max 180 chars) explaining the ordering principle you applied — reference the key moves (e.g. 'Pushed Backtracking after Recursion so the ladder stays intact; DP comes last since it leans on both.')."
}`;

  const user = `Sheet: ${sheetName}
Current topic order (${currentItems.length} items):
${currentItems.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Return the recommended order. Every input topic must appear exactly once in the output.`;

  const res = await callGroqJSON({
    apiKey, system, user, maxTokens: 1024, label: `study-order:${sheetName}`,
    schemaCheck: (obj) => {
      if (!obj || typeof obj !== "object") return "not an object";
      if (!Array.isArray(obj.order)) return "missing order array";
      if (obj.order.length !== currentItems.length) return `order length mismatch (got ${obj.order.length}, expected ${currentItems.length})`;
      // Every input must be in the output exactly once
      const want = new Set(currentItems.map(x => String(x).trim()));
      const got = new Set();
      for (const x of obj.order) {
        const n = String(x || "").trim();
        if (!want.has(n)) return `unknown topic in order: "${n}"`;
        if (got.has(n)) return `duplicate topic in order: "${n}"`;
        got.add(n);
      }
      if (got.size !== want.size) return `order missing topics (${want.size - got.size} short)`;
      return true;
    },
  });
  if (!res.ok) throw new Error(res.error);
  return {
    order: res.data.order.map(x => String(x).trim()),
    rationale: String(res.data.rationale || "").trim(),
  };
}

function openAiReviewOverlay(parentScrim, currentOrder, result, onApply) {
  // Highlight topics whose position changed
  const posMap = new Map(currentOrder.map((p, i) => [p, i]));
  const diffs = result.order.map((p, i) => ({
    name: p,
    fromIdx: posMap.get(p),
    toIdx: i,
    moved: posMap.get(p) !== i,
  }));

  const overlay = document.createElement("div");
  overlay.className = "so-ai-overlay";
  overlay.innerHTML = `
    <div class="so-ai-modal" role="dialog">
      <header>
        <div class="so-ai-eyebrow">✦ GROQ RECOMMENDATION</div>
        <h3>Suggested order</h3>
        ${result.rationale ? `<p class="so-ai-rationale">${esc(result.rationale)}</p>` : ""}
      </header>
      <div class="so-ai-body">
        <ol class="so-ai-list">
          ${diffs.map(d => `
            <li class="${d.moved ? "moved" : ""}">
              <span class="so-ai-num">${d.toIdx + 1}</span>
              <span class="so-ai-name">${esc(d.name)}</span>
              ${d.moved ? `<span class="so-ai-delta">${d.fromIdx + 1} → ${d.toIdx + 1}</span>` : `<span class="so-ai-nochange">no change</span>`}
            </li>
          `).join("")}
        </ol>
      </div>
      <footer>
        <button class="so-btn-ghost" data-so-ai-dismiss>Keep mine</button>
        <button class="so-btn-primary" data-so-ai-apply>Apply this order</button>
      </footer>
    </div>
  `;
  // Append the overlay to the editor modal itself so position:absolute covers
  // only the modal body, not the whole scrim's padding gutters.
  const target = parentScrim.querySelector(".so-modal") || parentScrim;
  target.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("[data-so-ai-dismiss]")?.addEventListener("click", close);
  overlay.querySelector("[data-so-ai-apply]")?.addEventListener("click", () => {
    onApply(result.order);
    close();
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}

function renderRow(name, i, total) {
  return `
    <div class="so-row" data-name="${esc(name)}" draggable="true">
      <span class="so-grip" title="Drag to reorder">⠿</span>
      <span class="so-row-num">${i + 1}</span>
      <span class="so-row-name">${esc(name)}</span>
      <div class="so-row-actions">
        <button class="so-icon" data-so-up="${i}" ${i === 0 ? "disabled" : ""} title="Move up">↑</button>
        <button class="so-icon" data-so-down="${i}" ${i === total - 1 ? "disabled" : ""} title="Move down">↓</button>
        <button class="so-icon so-icon-danger" data-so-del="${esc(name)}" title="Delete">×</button>
      </div>
    </div>
  `;
}

// Enables HTML5 drag reorder on the list. Called after every repaint.
function wireDragReorder(listEl, onReorder) {
  if (!listEl) return;
  let draggingName = null;

  listEl.querySelectorAll(".so-row").forEach(row => {
    row.addEventListener("dragstart", (e) => {
      draggingName = row.dataset.name;
      row.classList.add("so-dragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", draggingName); } catch (_) {}
    });
    row.addEventListener("dragend", () => {
      draggingName = null;
      listEl.querySelectorAll(".so-row").forEach(r => r.classList.remove("so-dragging", "so-drop-before", "so-drop-after"));
    });
    row.addEventListener("dragover", (e) => {
      if (!draggingName || row.dataset.name === draggingName) return;
      e.preventDefault();
      // Choose above/below based on cursor position
      const rect = row.getBoundingClientRect();
      const half = (e.clientY - rect.top) < rect.height / 2;
      row.classList.toggle("so-drop-before", half);
      row.classList.toggle("so-drop-after", !half);
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("so-drop-before", "so-drop-after");
    });
    row.addEventListener("drop", (e) => {
      if (!draggingName || row.dataset.name === draggingName) return;
      e.preventDefault();
      const items = Array.from(listEl.querySelectorAll(".so-row")).map(r => r.dataset.name);
      const from = items.indexOf(draggingName);
      let to = items.indexOf(row.dataset.name);
      if (from < 0 || to < 0) return;
      const [moved] = items.splice(from, 1);
      // After removing, adjust `to` if needed
      if (from < to) to -= 1;
      // Insert before or after based on drop zone
      const after = row.classList.contains("so-drop-after");
      items.splice(after ? to + 1 : to, 0, moved);
      onReorder(items);
    });
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

function injectStyles() {
  if (document.getElementById("study-mode-styles")) return;
  const s = document.createElement("style");
  s.id = "study-mode-styles";
  s.textContent = `
    /* --- MODE BAR on Today --- */
    .sm-bar { max-width: 1200px; margin: 10px auto 18px; padding: 10px 14px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 12px;
      display: flex; flex-direction: column; gap: 10px;
      box-shadow: 0 1px 2px rgba(0,0,0,.03); }
    .sm-bar-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .sm-label { font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); margin-right: 6px; }
    .sm-sheet {
      padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line);
      background: var(--paper); color: var(--ink);
      font: 500 12.5px/1 var(--font-sans); letter-spacing: -.005em;
    }
    .sm-sheet:focus { outline: 2px solid var(--gold); outline-offset: -2px; }
    .sm-toggle {
      display: inline-flex; padding: 3px; border-radius: 10px;
      background: color-mix(in oklab, var(--mut) 8%, var(--paper));
      border: 1px solid var(--line);
    }
    .sm-toggle-btn {
      padding: 6px 14px; border-radius: 7px; border: none; background: transparent;
      font: 600 12px/1 var(--font-sans); color: var(--mut); cursor: pointer;
      transition: all .18s ease;
    }
    .sm-toggle-btn:hover { color: var(--ink); }
    .sm-toggle-btn.active {
      background: var(--paper); color: var(--ink);
      box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 0 0 1px var(--line);
    }
    .sm-toggle-mixed { font: 500 11px/1 var(--font-sans); color: var(--mut); padding-left: 8px; letter-spacing: .02em; }
    .sm-edit {
      margin-left: auto;
      padding: 7px 12px; border-radius: 8px;
      background: var(--paper); border: 1px solid var(--line); color: var(--ink);
      font: 600 12px/1 var(--font-sans); cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .sm-edit:hover:not(:disabled) { border-color: var(--line2); background: color-mix(in oklab, var(--ink) 3%, var(--paper)); }
    .sm-edit:disabled { opacity: .5; cursor: not-allowed; }

    .sm-progress {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 10px 12px; border-radius: 10px;
      background: linear-gradient(135deg, color-mix(in oklab, var(--gold) 10%, var(--paper)) 0%, color-mix(in oklab, var(--gold) 2%, var(--paper)) 100%);
      border: 1px solid color-mix(in oklab, var(--gold) 24%, var(--line));
      font: 500 12.5px/1.3 var(--font-sans); color: var(--ink);
    }
    .sm-progress-tag {
      font: 800 10px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase;
      color: var(--gold);
    }
    .sm-progress-topic { font-weight: 700; letter-spacing: -.008em; }
    .sm-progress-stat { color: var(--mut); font-weight: 600; }
    .sm-progress-next { margin-left: auto; color: var(--mut); font-size: 11.5px; }
    .sm-progress-next b { color: var(--ink); }
    .sm-progress-done { background: color-mix(in oklab, var(--green) 10%, var(--paper)); border-color: color-mix(in oklab, var(--green) 28%, var(--line)); color: var(--green); font-weight: 700; }
    .sm-progress-fallback { background: color-mix(in oklab, var(--mut) 8%, var(--paper)); border-color: var(--line); color: var(--mut); font-size: 12px; }

    /* --- ORDER EDITOR MODAL --- */
    .so-scrim {
      position: fixed; inset: 0; z-index: 1900;
      background: transparent;
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .so-modal {
      position: relative;
      background: var(--paper); border-radius: 18px; width: 100%; max-width: 580px;
      max-height: 86vh; display: flex; flex-direction: column; overflow: hidden;
      box-shadow:
        0 28px 70px rgba(0,0,0,.22),
        0 8px 20px rgba(0,0,0,.08),
        0 0 0 1px var(--line);
      animation: soPop .22s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes soPop { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .so-head { padding: 20px 24px 12px; border-bottom: 1px solid var(--line); }
    .so-eyebrow { font: 700 10.5px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase; color: var(--gold); margin-bottom: 8px; }
    .so-title { margin: 0 0 6px; font: 600 20px/1.25 var(--font-sans); color: var(--ink); letter-spacing: -.015em; }
    .so-sub { margin: 0; font: 500 12.5px/1.55 var(--font-sans); color: var(--mut); }

    .so-body { padding: 16px 20px; overflow-y: auto; }
    .so-list { display: flex; flex-direction: column; gap: 6px; }
    .so-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 10px;
      background: var(--paper); border: 1px solid var(--line);
      transition: border-color .14s ease, box-shadow .14s ease;
      cursor: grab;
    }
    .so-row:active { cursor: grabbing; }
    .so-row:hover { border-color: var(--line2); }
    .so-row.so-dragging { opacity: .4; }
    .so-row.so-drop-before { box-shadow: 0 -2px 0 var(--gold) inset, 0 2px 0 var(--gold); }
    .so-row.so-drop-after  { box-shadow: 0 2px 0 var(--gold) inset, 0 -2px 0 var(--gold); }
    .so-grip {
      color: var(--mut); font: 400 16px/1 var(--font-sans);
      padding: 0 4px; user-select: none;
      opacity: .5; transition: opacity .14s ease;
    }
    .so-row:hover .so-grip { opacity: 1; }
    .so-row-num {
      font: 800 11.5px/1 var(--font-sans); letter-spacing: .06em; color: var(--gold);
      min-width: 24px; text-align: center;
    }
    .so-row-name { flex: 1; font: 600 13.5px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -.008em; }
    .so-row-actions { display: flex; gap: 4px; }
    .so-icon {
      width: 28px; height: 28px; border-radius: 7px;
      background: transparent; border: 1px solid var(--line); color: var(--mut);
      cursor: pointer; font: 600 13px/1 var(--font-sans);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .so-icon:hover:not(:disabled) { color: var(--ink); border-color: var(--line2); }
    .so-icon:disabled { opacity: .3; cursor: not-allowed; }
    .so-icon-danger:hover { color: var(--red); border-color: var(--red); }

    .so-add-row { display: flex; gap: 8px; margin-top: 12px; }
    .so-add-row input {
      flex: 1; padding: 10px 12px; border-radius: 10px;
      border: 1px solid var(--line); background: var(--paper); color: var(--ink);
      font: 500 13px/1.4 var(--font-sans);
    }
    .so-add-row input:focus { outline: 2px solid var(--gold); outline-offset: -2px; }

    .so-foot { padding: 14px 20px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 10px; }
    .so-spacer { flex: 1; }
    .so-btn-primary {
      padding: 10px 18px; border-radius: 10px;
      background: var(--ink); color: var(--paper); border: none;
      font: 600 12.5px/1 var(--font-sans); cursor: pointer;
    }
    .so-btn-primary:hover { filter: brightness(1.1); }
    .so-btn-ghost {
      padding: 10px 18px; border-radius: 10px;
      background: var(--paper); border: 1px solid var(--line); color: var(--ink);
      font: 600 12.5px/1 var(--font-sans); cursor: pointer;
    }
    .so-btn-ghost:hover { border-color: var(--line2); }

    /* ✦ Ask AI button + review overlay */
    .so-btn-ai {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 14px; border-radius: 10px;
      background: linear-gradient(135deg, color-mix(in oklab, var(--gold) 18%, var(--paper)) 0%, color-mix(in oklab, var(--gold) 6%, var(--paper)) 100%);
      border: 1px solid color-mix(in oklab, var(--gold) 36%, var(--line));
      color: var(--ink); font: 600 12.5px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: all .14s ease;
    }
    .so-btn-ai:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 14px -4px color-mix(in oklab, var(--gold) 50%, transparent);
    }
    .so-btn-ai:disabled { opacity: .7; cursor: progress; }
    .so-ai-spin {
      display: inline-block; width: 10px; height: 10px; border-radius: 50%;
      border: 2px solid color-mix(in oklab, var(--gold) 40%, transparent);
      border-top-color: var(--gold);
      animation: soAiSpin .7s linear infinite;
    }
    @keyframes soAiSpin { to { transform: rotate(360deg); } }

    .so-ai-overlay {
      position: absolute; inset: 0; z-index: 2;
      display: flex; align-items: center; justify-content: center; padding: 16px;
      background: color-mix(in oklab, var(--paper) 82%, transparent);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      animation: soAiFade .22s ease both;
    }
    @keyframes soAiFade { from { opacity: 0; } to { opacity: 1; } }
    .so-ai-modal {
      background: var(--paper); border-radius: 16px;
      width: 100%; max-height: 100%;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 24px 60px rgba(0,0,0,.26), 0 0 0 1px var(--line);
      animation: soAiPop .26s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes soAiPop { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .so-ai-modal header { padding: 16px 20px 10px; border-bottom: 1px solid var(--line); }
    .so-ai-eyebrow { font: 800 10px/1 var(--font-sans); letter-spacing: .18em; color: var(--gold); margin-bottom: 6px; }
    .so-ai-modal h3 { margin: 0 0 6px; font: 600 16px/1.25 var(--font-sans); color: var(--ink); letter-spacing: -.012em; }
    .so-ai-rationale { margin: 0; font: 500 12.5px/1.55 var(--font-sans); color: var(--mut); }

    .so-ai-body { padding: 14px 20px; overflow-y: auto; }
    .so-ai-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 5px; }
    .so-ai-list li {
      display: flex; align-items: center; gap: 10px;
      padding: 7px 10px; border-radius: 8px;
      background: var(--paper); border: 1px solid var(--line);
      font: 500 13px/1.3 var(--font-sans); color: var(--ink);
    }
    .so-ai-list li.moved {
      background: color-mix(in oklab, var(--gold) 8%, var(--paper));
      border-color: color-mix(in oklab, var(--gold) 28%, var(--line));
    }
    .so-ai-num {
      font: 800 10.5px/1 var(--font-sans); letter-spacing: .04em; color: var(--gold);
      min-width: 22px; text-align: center;
    }
    .so-ai-name { flex: 1; font-weight: 600; letter-spacing: -.005em; }
    .so-ai-delta { font: 700 10px/1 var(--font-sans); letter-spacing: .08em; color: var(--gold); padding: 3px 7px; border-radius: 5px; background: color-mix(in oklab, var(--gold) 14%, var(--paper)); }
    .so-ai-nochange { font: 500 10px/1 var(--font-sans); letter-spacing: .06em; color: var(--mut); }

    .so-ai-modal footer {
      padding: 12px 20px; border-top: 1px solid var(--line);
      display: flex; justify-content: flex-end; gap: 10px;
    }
  `;
  document.head.appendChild(s);
}
