// Calendar / Heatmap — month grid + year heatmap, streak + longest + green-day + solved stats,
// per-day hover tooltip with tasks. Filter All/DSA/SD/INT.

import { getDayLog, getSheets, getSettings, on } from "./store.js";
import { todayKey, calendarKey, computeStreak, longestStreak } from "./engine.js";

let unsub = null;
let cursor = new Date();   // month in view
let filter = "all";

export default {
  mount(root) {
    cursor = new Date();
    root.innerHTML = render();
    paint(root);
    attach(root);
    if (unsub) unsub();
    unsub = on((ev) => { if (ev === "dayLog" || ev === "sheet") paint(root); });
  },
  unmount() { if (unsub) { unsub(); unsub = null; } }
};

function render() {
  return `
    <div class="view-inner cal">
      <div class="hero-eyebrow">CALENDAR &amp; HEATMAP</div>
      <h1 class="hero-title">Green days don't lie.</h1>
      <p class="hero-sub">Build the chain. Don't break it. The sheet remembers everything.</p>

      <div class="cal-stats stagger" id="cal-stats"></div>

      <div class="cal-grid-wrap">
        <section class="cal-card month-card">
          <header class="cal-head">
            <div>
              <div class="cal-eyebrow" id="month-eyebrow"></div>
              <h2 class="cal-title" id="month-title"></h2>
            </div>
            <div class="cal-controls">
              <button class="btn-ghost btn-sm" id="prev-month" aria-label="Previous month">‹</button>
              <button class="btn-ghost btn-sm" id="today-btn">Today</button>
              <button class="btn-ghost btn-sm" id="next-month" aria-label="Next month">›</button>
            </div>
          </header>
          <div class="month-grid" id="month-grid"></div>
          <div class="legend">
            <span class="legend-item"><span class="sw sw-missed"></span><small>Missed</small></span>
            <span class="legend-item"><span class="sw sw-1"></span><small>Some</small></span>
            <span class="legend-item"><span class="sw sw-2"></span><small>Most</small></span>
            <span class="legend-item"><span class="sw sw-4"></span><small>Green day</small></span>
            <span class="legend-item"><span class="sw sw-neutral"></span><small>No plan</small></span>
          </div>
        </section>

        <aside class="cal-card year-card">
          <header class="cal-head">
            <div>
              <div class="cal-eyebrow">LAST 365 DAYS</div>
              <h2 class="cal-title">The chain</h2>
            </div>
            <div class="filter-tabs" id="filter-tabs">
              <button class="ft ${filter==='all'?'active':''}" data-filter="all">All</button>
              <button class="ft ${filter==='dsa'?'active':''}" data-filter="dsa">DSA</button>
              <button class="ft ${filter==='sd'?'active':''}" data-filter="sd">SD</button>
              <button class="ft ${filter==='int'?'active':''}" data-filter="int">INT</button>
            </div>
          </header>
          <div class="year-heatmap" id="year-heatmap"></div>
        </aside>
      </div>

      <div id="hover-tooltip" class="hover-tip" hidden></div>

      ${styles()}
    </div>
  `;
}

function paint(root) {
  paintStats(root);
  paintMonth(root);
  paintYear(root);
}

function paintStats(root) {
  const dayLog = getDayLog();
  const sheets = getSheets();
  const el = root.querySelector("#cal-stats");

  const streak = computeStreak(dayLog);
  const longest = longestStreak(dayLog);
  const greenDays = Object.values(dayLog).filter(d => d && d.assigned && d.assigned.length && d.green).length;
  const totalSolved = countSolvedAcrossSheets(sheets);

  el.innerHTML = `
    <div class="stat-pill">
      <div class="s-ic">🔥</div>
      <div>
        <div class="s-val">${streak}</div>
        <div class="s-lb">Current streak</div>
      </div>
    </div>
    <div class="stat-pill">
      <div class="s-ic">👑</div>
      <div>
        <div class="s-val">${longest}</div>
        <div class="s-lb">Longest streak</div>
      </div>
    </div>
    <div class="stat-pill">
      <div class="s-ic">✅</div>
      <div>
        <div class="s-val">${greenDays}</div>
        <div class="s-lb">Green days</div>
      </div>
    </div>
    <div class="stat-pill">
      <div class="s-ic">⚔</div>
      <div>
        <div class="s-val">${totalSolved}</div>
        <div class="s-lb">Problems solved</div>
      </div>
    </div>
  `;
}

function countSolvedAcrossSheets(sheets) {
  let n = 0;
  for (const name in sheets) {
    const s = sheets[name];
    const col = s.headers.find(h => /^status$/i.test(h));
    if (!col) continue;
    n += s.rows.filter(r => /solved|done/i.test(r[col] || "")).length;
  }
  return n;
}

function paintMonth(root) {
  const grid = root.querySelector("#month-grid");
  const title = root.querySelector("#month-title");
  const eyebrow = root.querySelector("#month-eyebrow");
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  eyebrow.textContent = y;
  title.textContent = new Date(y, m, 1).toLocaleDateString(undefined, { month: "long" });

  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const firstDay = (first.getDay() + 6) % 7; // Monday-start
  const daysInMonth = last.getDate();
  const dayLog = getDayLog();
  const todayStr = calendarKey();

  let html = `
    <div class="dow"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
    <div class="dates">
  `;
  for (let i = 0; i < firstDay; i++) html += `<div class="cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d);
    const key = calendarKey(date);
    const day = dayLog[key];
    const lvl = intensityLevel(day);
    const isToday = key === todayStr;
    const marker = key > todayStr ? "future" : "";
    const cls = marker === "future" ? "future" : lvl === -2 ? "sw-neutral" : lvl === 0 ? "sw-missed" : `sw-${lvl}`;
    html += `
      <div class="cell ${cls} ${isToday ? "today" : ""} ${marker}"
           data-date="${key}" tabindex="0" aria-label="${key}">
        <span class="date-num">${d}</span>
        ${(day && day.assigned && day.assigned.length) ? `<span class="dot-sm"></span>` : ""}
      </div>
    `;
  }
  html += `</div>`;
  grid.innerHTML = html;

  // hover tooltip
  const tip = root.querySelector("#hover-tooltip");
  grid.querySelectorAll(".cell[data-date]").forEach(cell => {
    cell.addEventListener("mouseenter", (e) => showTip(tip, cell));
    cell.addEventListener("mousemove", (e) => positionTip(tip, e));
    cell.addEventListener("mouseleave", () => hideTip(tip));
    cell.addEventListener("focus", () => showTip(tip, cell));
    cell.addEventListener("blur", () => hideTip(tip));
  });
}

function paintYear(root) {
  const el = root.querySelector("#year-heatmap");
  const dayLog = getDayLog();
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 365);
  // Advance to the next Monday from `start` so columns align
  const dow = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() + ((7 - dow) % 7));

  const weeks = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor); d.setDate(cursor.getDate() + i);
      const key = calendarKey(d);
      col.push({ key, day: dayLog[key], future: d > today });
    }
    weeks.push(col);
    cursor.setDate(cursor.getDate() + 7);
  }

  let html = `<div class="year-cols">`;
  for (const col of weeks) {
    html += `<div class="year-col">`;
    for (const { key, day, future } of col) {
      const lvl = future ? -1 : intensityLevel(day, filter);
      const cls = future ? "future" : lvl === -2 ? "sw-neutral" : lvl === 0 ? "sw-missed" : `sw-${lvl}`;
      html += `<div class="ycell ${cls}" data-date="${key}" title="${esc(key)}"></div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  el.innerHTML = html;

  const tip = root.querySelector("#hover-tooltip");
  el.querySelectorAll(".ycell").forEach(cell => {
    cell.addEventListener("mouseenter", () => showTip(tip, cell));
    cell.addEventListener("mousemove", (e) => positionTip(tip, e));
    cell.addEventListener("mouseleave", () => hideTip(tip));
  });
}

// Intensity levels:
//   -2 = neutral (no activity ever this day — pre-user era)
//   -1 = future
//    0 = MISSED — day existed but 0 solved (red)
//    1 = light green (any 1 solve)
//    2 = medium green (33%+)
//    3 = deep green (66%+)
//    4 = full green (100% or green-day flag)
function intensityLevel(day, filterKind = "all") {
  if (!day || !day.assigned || !day.assigned.length) return -2;
  let assigned = day.assigned;
  if (filterKind !== "all") {
    assigned = assigned.filter(t => t.kind === filterKind);
    if (!assigned.length) return -2;
  }
  // Trust the authoritative green flag first (set by tickTask / untickTask in engine.js).
  // Only on the "All" view — filtered views still compute by subset.
  if (filterKind === "all" && day.green === true) return 4;

  const done = assigned.filter(t => day.done.includes(t.ref)).length;
  if (!done) return 0;   // MISSED — tasks existed, none done
  const pct = done / assigned.length;
  if (pct >= 1) return 4;
  if (pct >= .66) return 3;
  if (pct >= .33) return 2;
  return 1;              // at least 1 solved
}

function showTip(tip, cell) {
  const key = cell.dataset.date;
  const day = getDayLog()[key];
  const future = cell.classList.contains("future");
  if (future) {
    tip.innerHTML = `<b>${esc(key)}</b><br><span class="tip-dim">In the future — go earn it.</span>`;
  } else if (!day || !day.assigned || !day.assigned.length) {
    tip.innerHTML = `<b>${esc(key)}</b><br><span class="tip-dim">No tasks assigned. 0-task days don't break the chain — but they don't build it either.</span>`;
  } else {
    const done = day.done.length;
    const total = day.assigned.length;
    const green = day.green ? `<span class="tip-green">✓ GREEN DAY</span>` : `<span class="tip-amber">${done}/${total} done</span>`;
    const tasks = day.assigned.map(t => `
      <li class="${day.done.includes(t.ref) ? "did" : ""}">${day.done.includes(t.ref) ? "✓" : "·"} ${esc(t.title)}</li>
    `).join("");
    tip.innerHTML = `
      <div class="tip-head"><b>${esc(key)}</b> ${green}</div>
      <ul class="tip-tasks">${tasks}</ul>
      ${day.dayEarned ? `<div class="tip-earn">+ ₹${day.dayEarned.toLocaleString()} banked</div>` : ""}
    `;
  }
  tip.hidden = false;
}
function positionTip(tip, e) {
  const pad = 14;
  tip.style.left = Math.min(window.innerWidth - 260, e.clientX + pad) + "px";
  tip.style.top  = Math.min(window.innerHeight - 180, e.clientY + pad) + "px";
}
function hideTip(tip) { tip.hidden = true; }

function attach(root) {
  root.querySelector("#prev-month").addEventListener("click", () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    paintMonth(root);
  });
  root.querySelector("#next-month").addEventListener("click", () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    paintMonth(root);
  });
  root.querySelector("#today-btn").addEventListener("click", () => {
    cursor = new Date();
    paintMonth(root);
  });
  root.querySelectorAll("#filter-tabs .ft").forEach(btn => {
    btn.addEventListener("click", () => {
      filter = btn.dataset.filter;
      root.querySelectorAll("#filter-tabs .ft").forEach(b => b.classList.toggle("active", b === btn));
      paintYear(root);
    });
  });
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }

function styles() {
  return `
  <style>
    .cal { max-width: 1240px; }
    .cal .cal-stats { display:grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-3); margin: var(--s-4) 0 var(--s-5); }
    .cal .stat-pill {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
      padding: var(--s-4); display:flex; align-items: center; gap: var(--s-3);
      box-shadow: var(--shadow); transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
    }
    .cal .stat-pill:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
    .cal .stat-pill .s-ic {
      width: 44px; height: 44px; border-radius: 12px;
      background: linear-gradient(135deg, #f7f8fa, #eef1f5);
      display: inline-flex; align-items: center; justify-content: center; font-size: 20px;
    }
    .cal .stat-pill .s-val { font-size: 28px; font-weight: 800; letter-spacing: -.02em; line-height: 1; }
    .cal .stat-pill .s-lb { font-size: 12px; color: var(--mut); margin-top: 4px; }

    .cal .cal-grid-wrap {
      display: grid; grid-template-columns: 1fr 420px;
      gap: var(--s-5);
    }
    .cal .cal-card {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
      padding: var(--s-5); box-shadow: var(--shadow);
    }
    .cal .cal-head { display:flex; justify-content: space-between; align-items: center; margin-bottom: var(--s-4); }
    .cal .cal-eyebrow { font-size: 11px; letter-spacing: .18em; font-weight: 700; color: var(--mut); margin-bottom: 2px; }
    .cal .cal-title { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -.01em; }
    .cal .cal-controls { display: flex; gap: 6px; }
    .cal .cal-controls .btn-ghost.btn-sm { min-width: 36px; padding: 7px 12px; }

    .cal .month-grid .dow { display:grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-bottom: 8px; }
    .cal .month-grid .dow span { font-size: 11px; color: var(--mut); font-weight: 600; letter-spacing: .08em; text-align: center; }
    .cal .month-grid .dates { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
    .cal .month-grid .cell {
      aspect-ratio: 1 / 1; border-radius: 10px; background: var(--line);
      position: relative; cursor: default;
      display: flex; align-items: flex-start; justify-content: flex-end;
      padding: 6px 8px; font-size: 12px; color: var(--mut);
      transition: transform var(--dur-fast) var(--ease), filter var(--dur-fast) var(--ease);
    }
    .cal .month-grid .cell.empty { background: transparent; }
    .cal .month-grid .cell:hover { transform: scale(1.08); filter: brightness(1.08); z-index: 2; }
    .cal .month-grid .cell.today { outline: 2px solid var(--blue); outline-offset: 2px; color: var(--blue); font-weight: 700; }
    .cal .month-grid .cell.future { opacity: .4; }
    .cal .month-grid .cell .dot-sm { position: absolute; left: 8px; bottom: 8px; width: 6px; height: 6px; border-radius: 50%; background: var(--ink); opacity: .4; }

    .cal .legend { display: flex; align-items: center; justify-content: flex-end; gap: 14px; margin-top: var(--s-4); font-size: 11px; color: var(--mut); flex-wrap: wrap; }
    .cal .legend .legend-item { display: inline-flex; align-items: center; gap: 5px; }
    .cal .legend .sw { width: 12px; height: 12px; border-radius: 3px; }
    .cal .legend small { font-size: 11px; color: var(--mut); }

    /* Heatmap palette — red = missed day, greens = solved intensity, neutral = pre-user */
    .cal .sw-neutral { background: var(--line); }
    .cal .sw-missed  { background: color-mix(in oklab, var(--red) 42%, var(--paper)); }
    .cal .sw-0       { background: color-mix(in oklab, var(--red) 42%, var(--paper)); } /* alias for legacy */
    .cal .sw-1       { background: color-mix(in oklab, var(--green) 32%, var(--paper)); }
    .cal .sw-2       { background: color-mix(in oklab, var(--green) 60%, var(--paper)); }
    .cal .sw-3       { background: var(--green); opacity: .9; }
    .cal .sw-4       { background: var(--green); }

    .cal .filter-tabs { display: flex; gap: 4px; background: var(--line); padding: 3px; border-radius: 10px; }
    .cal .ft {
      padding: 6px 12px; border: none; background: transparent; cursor: pointer;
      font: 600 11px/1 var(--font-sans); letter-spacing: .04em;
      color: var(--mut); border-radius: 7px; transition: all var(--dur-fast) var(--ease);
    }
    .cal .ft:hover { color: var(--ink); }
    .cal .ft.active { background: var(--paper); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.08); }

    .cal .year-heatmap { overflow-x: auto; padding-bottom: 4px; }
    .cal .year-cols { display: flex; gap: 3px; }
    .cal .year-col { display: flex; flex-direction: column; gap: 3px; }
    .cal .ycell { width: 11px; height: 11px; border-radius: 2px; background: var(--line); transition: transform var(--dur-fast) var(--ease); }
    .cal .ycell:hover { transform: scale(1.6); z-index: 2; box-shadow: 0 0 0 1px var(--ink); }
    .cal .ycell.future { background: transparent; border: 1px dashed var(--line); box-sizing: border-box; }

    .cal .hover-tip {
      position: fixed; z-index: 100; min-width: 220px; max-width: 320px;
      background: var(--ink); color: var(--paper);
      border-radius: 10px; padding: 10px 12px; font-size: 12px;
      box-shadow: var(--shadow-pop); pointer-events: none;
      animation: fadeIn 120ms ease-out both;
    }
    .cal .hover-tip .tip-head { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .cal .hover-tip .tip-green { color: #4fbb75; font-weight: 700; letter-spacing: .04em; }
    .cal .hover-tip .tip-amber { color: #e3a81a; font-weight: 600; }
    .cal .hover-tip .tip-dim   { color: #8b92a1; }
    .cal .hover-tip .tip-tasks { list-style: none; padding: 0; margin: 0 0 6px; }
    .cal .hover-tip .tip-tasks li { padding: 2px 0; color: #d9ddea; }
    .cal .hover-tip .tip-tasks li.did { color: #4fbb75; }
    .cal .hover-tip .tip-earn { color: #ffd96b; font-weight: 700; margin-top: 6px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 6px; }

    @media (max-width: 980px) {
      .cal .cal-grid-wrap { grid-template-columns: 1fr; }
      .cal .cal-stats { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
  `;
}
