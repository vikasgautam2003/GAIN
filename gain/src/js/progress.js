// Progress — readiness %, completion over time, sheet totals, topic donut, per-pattern bars.
// Dayilog-driven so it fills in as the user grinds.

import { getSheets, getDayLog, getSettings, getWallet, callGrok, secure, on } from "./store.js";
import { computeStreak, longestStreak, todayKey } from "./engine.js";
import { paintYear, setHeatmapFilter, getHeatmapFilter } from "./calendar.js";
import { infoIcon } from "./info.js";

let unsub = null;

export default {
  mount(root) {
    root.innerHTML = render();
    paint(root);
    attach(root);
    if (unsub) unsub();
    unsub = on((ev) => { if (ev === "dayLog" || ev === "sheet" || ev === "wallet") paint(root); });
  },
  unmount() { if (unsub) { unsub(); unsub = null; } }
};

function attach(root) {
  // Filter tabs for the 365-day chain (shared state with Calendar page via calendar.js)
  root.querySelectorAll("#filter-tabs .ft").forEach(btn => {
    btn.addEventListener("click", () => {
      setHeatmapFilter(btn.dataset.filter);
      root.querySelectorAll("#filter-tabs .ft").forEach(b => b.classList.toggle("active", b === btn));
      paintYear(root);
    });
  });

  root.querySelector("#btn-grok-narrative").addEventListener("click", async (e) => {
    const btn = e.target;
    const narrEl = root.querySelector("#eta-narrative");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Thinking…";
    narrEl.innerHTML = `<div class="think-dots"><span></span><span></span><span></span></div>`;
    try {
      const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                     (await secure.get("grok_api_key").catch(() => null));
      if (!apiKey) {
        narrEl.innerHTML = `<p class="err">No Groq API key. Add one in <a href="#settings">Settings → AI butler</a>.</p>`;
        return;
      }
      const ctx = buildInsightsContext();
      const res = await callGrok({
        apiKey,
        system: "You are GAIN's honest FDE prep analyst. Given the user's local stats, write EXACTLY 4 short sentences: (1) honest assessment of where they stand, (2) projected finish vs target, (3) weakest area with pattern/topic name, (4) one concrete next action. Then output 3 bullets '• ...' with sharp recommendations. Terse. No fluff. No headings.",
        user: ctx
      });
      if (res.ok) {
        const html = res.content
          .replace(/</g, "&lt;")
          .replace(/\n/g, "<br>")
          .replace(/•/g, "<br>•");
        narrEl.innerHTML = `<div class="narr-body">${html}</div>`;
      } else {
        narrEl.innerHTML = `<p class="err">${res.error || "Grok call failed."}</p>`;
      }
    } catch (err) {
      narrEl.innerHTML = `<p class="err">${String(err.message || err)}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

function buildInsightsContext() {
  const sheets = getSheets();
  const dayLog = getDayLog();
  const w = getWallet();
  const s = getSettings();
  const readiness = computeReadiness(sheets);
  const rate = computeRate(sheets, 4);
  const eta = computeETA(sheets, rate.perWeek);
  const weak = topWeakPatterns(sheets).slice(0, 3);
  return `
Profile: targeting ${s.profile.targetRole} by ${s.profile.targetDate}; ${s.profile.weekdayMinutes} min/weekday.
Current streak: ${computeStreak(dayLog)} days (longest ${longestStreak(dayLog)}).
Wallet: earned ₹${w.earned}, available ₹${w.available}.
Readiness: ${readiness.pct}% (${readiness.note}).
Pace: ${rate.perWeek} problems/week (last 4w). Required for target: ${eta.requiredPerWeek}/wk.
ETA at current pace: ${eta.etaDate} (${eta.daysToTarget} days vs target).
Weakest patterns: ${weak.map(w => `${w.pattern} (${w.done}/${w.total}, avg conf ${w.avgConf.toFixed(1)})`).join("; ")}.
  `.trim();
}

function computeETA(sheets, perWeek) {
  const total = Object.values(sheets).reduce((a, s) => a + s.rows.length, 0);
  const done = Object.values(sheets).reduce((a, s) => {
    const col = s.headers.find(h => /^status$/i.test(h));
    return a + (col ? s.rows.filter(r => /solved|done/i.test(r[col] || "")).length : 0);
  }, 0);
  const remaining = Math.max(0, total - done);
  const targetDate = new Date(getSettings().profile.targetDate);
  const now = new Date();
  const daysToTarget = Math.max(1, Math.round((targetDate - now) / 86400000));
  const requiredPerWeek = Math.ceil(remaining / (daysToTarget / 7));
  const weeksAtPace = perWeek > 0 ? Math.ceil(remaining / perWeek) : 9999;
  const eta = new Date(); eta.setDate(now.getDate() + weeksAtPace * 7);
  return {
    requiredPerWeek,
    daysToTarget: Math.round((eta - targetDate) / 86400000),
    etaDate: eta.toISOString().slice(0, 10),
    remaining
  };
}

function topWeakPatterns(sheets) {
  const dsa = sheets["DSA"];
  if (!dsa) return [];
  const buckets = {};
  const statusCol = dsa.headers.find(h => /^status$/i.test(h));
  const confCol = dsa.headers.find(h => /^confidence$/i.test(h));
  for (const r of dsa.rows) {
    const p = r.Pattern || "Other";
    if (!buckets[p]) buckets[p] = { total: 0, done: 0, confs: [] };
    buckets[p].total++;
    if (statusCol && /solved|done/i.test(r[statusCol] || "")) buckets[p].done++;
    if (confCol && r[confCol]) buckets[p].confs.push(Number(r[confCol]));
  }
  const rows = Object.entries(buckets).map(([pattern, b]) => {
    const avgConf = b.confs.length ? b.confs.reduce((a,c)=>a+c,0) / b.confs.length : 0;
    const coverage = b.total ? b.done / b.total : 0;
    const risk = (1 - coverage) * .6 + (1 - avgConf / 5) * .4;
    return { pattern, total: b.total, done: b.done, avgConf, risk };
  });
  return rows.sort((a,b) => b.risk - a.risk);
}

function render() {
  return `
    <div class="view-inner prog">
      <div class="hero-eyebrow">PROGRESS</div>
      <h1 class="hero-title">Consistency compounds.</h1>
      <p class="hero-sub">The chart doesn't lie. The sheet keeps score. Keep showing up.</p>

      <div class="prog-top stagger">
        <div class="readiness-card">
          <div class="r-eyebrow">INTERVIEW READINESS</div>
          <div class="r-value"><span id="read-pct">0</span>%</div>
          <div class="r-sub" id="read-sub">—</div>
          <div class="r-bar"><span id="read-bar"></span></div>
        </div>
        <div class="rate-card">
          <div class="r-eyebrow">PROBLEMS / WEEK (last 4w)</div>
          <div class="r-value"><span id="rate-val">0</span></div>
          <div class="r-sub" id="rate-sub">—</div>
        </div>
        <div class="rate-card streak">
          <div class="r-eyebrow">CURRENT STREAK</div>
          <div class="r-value"><span id="streak-val">0</span><span class="r-unit">days</span></div>
          <div class="r-sub"><span id="longest-val">0</span> days longest</div>
        </div>
      </div>

      <section class="calib-card" id="calib-card" aria-expanded="false">
        <div class="calib-head">
          <div class="calib-left">
            <div class="r-eyebrow">SELF-RATING CALIBRATION ${infoIcon({
              title: "Calibration score",
              body: "How well your ★ ratings predict re-solve performance. Compares the first ★ rating of a row to its latest ★ rating. Drift of 0 = perfect; drift of 4 = badly over/under-rating.",
              bullets: [
                "85% or above = sharp (trust your gut)",
                "70-84% = solid (within interview-day range)",
                "55-69% = noisy (you miscalibrate under pressure)",
                "below 55% = shaky (over-rate hard, under-prepare)"
              ]
            })}</div>
            <div class="calib-value">
              <span id="calib-pct">—</span>
              <small class="calib-unit">% accurate</small>
            </div>
            <div class="calib-sub" id="calib-sub">—</div>
          </div>
          <button class="calib-toggle" id="calib-toggle" title="Expand per-pattern breakdown">
            <span class="ct-ic">▾</span>
            <span class="ct-lb">Per-topic</span>
          </button>
        </div>
        <div class="calib-detail" id="calib-detail" hidden></div>
      </section>

      <!-- Predictive analytics (§17) — clean redesign -->
      <section class="insight-card alive" id="insight-card">
        <div class="ic-head">
          <div class="ic-head-left">
            <div class="ic-eyebrow">INSIGHTS · PREDICTIVE</div>
            <h2 class="ic-title">The honest forecast</h2>
          </div>
          <button class="ic-ask-btn" id="btn-grok-narrative">
            <span class="ic-ask-glyph">✦</span>
            <span>Ask the butler for an honest take</span>
          </button>
        </div>

        <div class="ic-stats">
          <div class="ic-stat">
            <div class="ic-stat-lb">REMAINING</div>
            <div class="ic-stat-val" id="eta-remain">—</div>
            <div class="ic-stat-sub" id="eta-remain-sub">items on the sheet</div>
          </div>
          <div class="ic-stat">
            <div class="ic-stat-lb">PACE</div>
            <div class="ic-stat-val" id="eta-pace">—</div>
            <div class="ic-stat-sub" id="eta-pace-sub">per week · last 4w</div>
          </div>
          <div class="ic-stat ic-stat-eta">
            <div class="ic-stat-lb">ETA AT PACE</div>
            <div class="ic-stat-val" id="eta-date">—</div>
            <div class="ic-stat-sub" id="eta-date-sub">target —</div>
          </div>
        </div>

        <div class="ic-weak" id="eta-weak"></div>
        <div class="ic-narrative" id="eta-narrative"></div>
      </section>

      <section class="prog-card wide chain-section">
        <div class="pc-head chain-head">
          <div>
            <h3>The chain · last 365 days</h3>
            <span class="pc-sub">Red = missed · greens = solved intensity · gray = no plan yet</span>
          </div>
          <div class="filter-tabs" id="filter-tabs">
            <button class="ft" data-filter="all">All</button>
            <button class="ft" data-filter="dsa">DSA</button>
            <button class="ft" data-filter="sd">SD</button>
            <button class="ft" data-filter="int">INT</button>
          </div>
        </div>
        <div class="year-heatmap chain-grid" id="year-heatmap"></div>
      </section>

      <div class="prog-grid">
        <section class="prog-card wide">
          <div class="pc-head">
            <h3>Completion over time</h3>
            <span class="pc-sub">Solved problems, cumulative</span>
          </div>
          <div id="burn-up"></div>
        </section>

        <section class="prog-card">
          <div class="pc-head">
            <h3>By sheet</h3>
            <span class="pc-sub">Solved vs total</span>
          </div>
          <div id="sheet-bars"></div>
        </section>

        <section class="prog-card">
          <div class="pc-head">
            <h3>Topic breakdown</h3>
            <span class="pc-sub">Where your reps live</span>
          </div>
          <div class="donut-row">
            <div id="donut"></div>
            <div id="donut-legend"></div>
          </div>
        </section>

        <section class="prog-card wide">
          <div class="pc-head">
            <h3>Per-pattern progress</h3>
            <span class="pc-sub">DSA patterns, solved / total</span>
          </div>
          <div id="pattern-bars"></div>
        </section>

        <section class="prog-card wide pattern-mastery-card">
          <div class="pc-head">
            <h3>Pattern mastery ${infoIcon({
              title: "Pattern mastery",
              body: "Per-pattern average confidence + solve coverage, with a trend arrow comparing your last 5 ratings vs the prior 5. Weakest patterns surface at the top.",
              bullets: [
                "↗ rising = last 5 avg >0.4 ★ higher than prior 5",
                "→ steady = within 0.4 ★ of prior 5",
                "↘ shaky = last 5 avg >0.4 ★ lower (red-tinted row)"
              ]
            })}</h3>
            <span class="pc-sub">Weakest first · confidence from your star ratings · trend from last 5 solves</span>
          </div>
          <div id="pattern-mastery"></div>
        </section>
      </div>

      <div id="hover-tooltip" class="hover-tip" hidden></div>

      ${styles()}
    </div>
  `;
}

function paint(root) {
  const sheets = getSheets();
  const dayLog = getDayLog();

  // --- Readiness: weighted P1/HIGH coverage + confidence average ---
  const readiness = computeReadiness(sheets);
  const readPctEl = root.querySelector("#read-pct");
  if (readiness.unavailable) {
    readPctEl.textContent = "—";
    root.querySelector("#read-bar").style.width = "0%";
  } else {
    animateNumber(readPctEl, readiness.pct || 0);
    root.querySelector("#read-bar").style.width = `${readiness.pct || 0}%`;
  }
  root.querySelector("#read-sub").textContent = readiness.note;

  // --- Rate: avg problems per week over last 4w ---
  const rate = computeRate(sheets, 4);
  const rateValEl = root.querySelector("#rate-val");
  if (rate.unavailable) {
    rateValEl.textContent = "—";
  } else {
    animateNumber(rateValEl, rate.perWeek || 0);
  }
  root.querySelector("#rate-sub").textContent = rate.note;

  // --- Streak ---
  animateNumber(root.querySelector("#streak-val"), computeStreak(dayLog));
  animateNumber(root.querySelector("#longest-val"), longestStreak(dayLog));

  // --- 365-day chain heatmap ---
  // Reflect current filter in tab active state
  const filter = getHeatmapFilter();
  root.querySelectorAll("#filter-tabs .ft").forEach(b => {
    b.classList.toggle("active", b.dataset.filter === filter);
  });
  paintYear(root);

  // --- Burn-up line ---
  root.querySelector("#burn-up").innerHTML = burnUpSvg(sheets);

  // --- Sheet totals bars ---
  root.querySelector("#sheet-bars").innerHTML = sheetBarsHtml(sheets);

  // --- Topic donut ---
  const topics = computeTopics(sheets);
  root.querySelector("#donut").innerHTML = donutSvg(topics);
  root.querySelector("#donut-legend").innerHTML = legendHtml(topics);

  // --- Per-pattern bars (DSA only) ---
  root.querySelector("#pattern-bars").innerHTML = patternBarsHtml(sheets["DSA"]);

  // --- Confidence calibration (self-rating accuracy) ---
  paintCalibration(root, dayLog);

  // --- Pattern mastery (confidence-driven, trend-aware, cross-sheet) ---
  const masteryEl = root.querySelector("#pattern-mastery");
  if (masteryEl) {
    masteryEl.innerHTML = patternMasteryHtml(sheets, dayLog);
    masteryEl.querySelectorAll("[data-pattern-jump]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const sheet = btn.dataset.patternJump;
        location.hash = `#library/${encodeURIComponent(sheet)}`;
      });
    });
  }

  // --- Predictive-analytics card ---
  const r4w = computeRate(sheets, 4);
  const eta = computeETA(sheets, r4w.perWeek);
  const weak = topWeakPatterns(sheets).slice(0, 4);
  const targetDate = getSettings().profile.targetDate;

  root.querySelector("#eta-remain").textContent = String(eta.remaining || 0);
  const need = getSettings().schedule.newDsaPerWeekday * 5 || 5;
  root.querySelector("#eta-remain-sub").textContent = eta.remaining === 0 ? "sheet complete · ascended" : "items on the sheet";

  // r4w.unavailable → sheet has no DateSolved column; honest em-dash + explanation
  if (r4w.unavailable) {
    root.querySelector("#eta-pace").textContent = "—";
    root.querySelector("#eta-pace-sub").innerHTML = `<span class="neg">add DateSolved column to compute pace</span>`;
  } else {
    root.querySelector("#eta-pace").textContent = String(r4w.perWeek || 0);
    const diff = (r4w.perWeek || 0) - need;
    const trailHtml = diff >= 0
      ? `<span class="pos">${diff} above target</span>`
      : `<span class="neg">${Math.abs(diff).toFixed(diff % 1 ? 1 : 0)} below target</span>`;
    const scopeHtml = r4w.earlySignal ? ` <span class="mut">· ${r4w.scopeNote}</span>` : "";
    root.querySelector("#eta-pace-sub").innerHTML = r4w.perWeek === 0
      ? `tick a problem to start the line`
      : `per week · ${trailHtml}${scopeHtml}`;
  }

  const etaDateEl = root.querySelector("#eta-date");
  const etaDateSub = root.querySelector("#eta-date-sub");
  if (eta.remaining === 0) {
    etaDateEl.textContent = "Done";
    etaDateSub.innerHTML = `before target <b>${esc(targetDate)}</b>`;
  } else if (r4w.unavailable || !r4w.perWeek) {
    etaDateEl.textContent = "—";
    etaDateSub.innerHTML = r4w.unavailable
      ? `can't project · needs DateSolved history`
      : `target <b>${esc(targetDate)}</b> · flat extrapolation when pace &gt; 0`;
  } else {
    etaDateEl.textContent = eta.etaDate;
    etaDateSub.innerHTML = eta.daysToTarget > 0
      ? `<span class="neg">${eta.daysToTarget} days behind</span> target <b>${esc(targetDate)}</b> · flat extrapolation at current pace`
      : `<span class="pos">${Math.abs(eta.daysToTarget)} days ahead</span> of target <b>${esc(targetDate)}</b> · flat extrapolation at current pace`;
  }

  const etaWeak = root.querySelector("#eta-weak");
  etaWeak.innerHTML = weak.length ? `
    <div class="weak-head">LIKELY TO SLIP</div>
    <div class="weak-list">
      ${weak.map(w => {
        const risk = Math.round(w.risk * 100);
        const tier = risk >= 80 ? "high" : risk >= 50 ? "mid" : "low";
        return `
          <div class="weak-chip">
            <div class="wc-top">
              <span class="wc-name">${esc(w.pattern)}</span>
              <span class="wc-risk-tier ${tier}">${tier.toUpperCase()}</span>
            </div>
            <div class="wc-bar"><span style="width:${risk}%"></span></div>
            <div class="wc-stat">${w.done}/${w.total} solved · avg conf ${w.avgConf ? w.avgConf.toFixed(1) : "—"}</div>
          </div>
        `;
      }).join("")}
    </div>
  ` : "";
}

function computeReadiness(sheets) {
  let anyFreqCol = false;
  let anyStatusCol = false;
  let p1Total = 0, p1Done = 0;
  let confSum = 0, confN = 0;
  for (const name in sheets) {
    const s = sheets[name];
    const statusCol = s.headers.find(h => /^status$/i.test(h));
    const freqCol   = s.headers.find(h => /^(freq|priority)$/i.test(h));
    const confCol   = s.headers.find(h => /^confidence$/i.test(h));
    if (statusCol) anyStatusCol = true;
    if (freqCol) anyFreqCol = true;
    if (!statusCol) continue;
    for (const r of s.rows) {
      const isP1 = freqCol ? /^(HIGH|P1)$/i.test(String(r[freqCol]||"")) : false;
      if (isP1) {
        p1Total++;
        if (/solved|done/i.test(r[statusCol] || "")) p1Done++;
      }
      if (confCol && r[confCol]) { confSum += Number(r[confCol]); confN++; }
    }
  }
  if (!anyStatusCol) return { pct: null, note: "No Status column on any sheet.", unavailable: true };
  if (!anyFreqCol)   return { pct: null, note: "Add a Freq/Priority column (HIGH/MED/LOW or P1/P2) to compute readiness.", unavailable: true };
  if (!p1Total)      return { pct: 0, note: "No HIGH/P1 items yet. Mark some to anchor readiness." };
  const coverage = p1Done / p1Total;
  const confAvg = confN ? confSum / confN : 0;
  const pct = Math.round(100 * (coverage * .7 + (confAvg / 5) * .3));
  return {
    pct,
    note: `${p1Done} / ${p1Total} P1 items solved · avg confidence ${confN ? (confAvg).toFixed(1) : "—"}`
  };
}

function computeRate(sheets, weeks) {
  const windowCutoff = new Date();
  windowCutoff.setDate(windowCutoff.getDate() - 7 * weeks);
  let count = 0;
  let hasDateCol = false;
  let firstSolveAll = null;         // earliest solve across all sheets, any time
  let firstSolveInWindow = null;    // earliest solve inside the N-week window

  for (const name in sheets) {
    const s = sheets[name];
    const dateCol = s.headers.find(h => /^(datesolved|datedone)$/i.test(h));
    const statusCol = s.headers.find(h => /^status$/i.test(h));
    if (dateCol) hasDateCol = true;
    if (!dateCol || !statusCol) continue;
    for (const r of s.rows) {
      if (!/solved|done/i.test(r[statusCol] || "")) continue;
      const d = new Date(r[dateCol]);
      if (isNaN(d)) continue;
      if (!firstSolveAll || d < firstSolveAll) firstSolveAll = d;
      if (d >= windowCutoff) {
        count++;
        if (!firstSolveInWindow || d < firstSolveInWindow) firstSolveInWindow = d;
      }
    }
  }
  if (!hasDateCol) {
    return { perWeek: null, note: "Add a DateSolved/DateDone column to track pace.", unavailable: true };
  }

  // Dynamic window: if the user started grinding less than `weeks` weeks ago,
  // divide by the actual elapsed weeks so the pace isn't artificially diluted.
  let effectiveWeeks = weeks;
  let scopeNote = `last ${weeks}w`;
  if (firstSolveInWindow) {
    const daysSinceFirst = Math.max(1, Math.ceil((Date.now() - firstSolveInWindow) / 86400000));
    // Minimum 1 full week so a 1-day burst doesn't extrapolate to a wild weekly pace.
    const weeksSinceFirst = Math.max(1, daysSinceFirst / 7);
    if (weeksSinceFirst < weeks) {
      effectiveWeeks = weeksSinceFirst;
      scopeNote = daysSinceFirst <= 7
        ? `last ${daysSinceFirst}d · early signal`
        : `last ${Math.round(weeksSinceFirst * 10) / 10}w`;
    }
  }

  const rawPerWeek = count / effectiveWeeks;
  // Keep a decimal when under 1/week so "0.5" shows instead of rounding to 0
  const perWeek = rawPerWeek >= 1 ? Math.round(rawPerWeek) : Math.round(rawPerWeek * 10) / 10;
  const need = getSettings().schedule.newDsaPerWeekday * 5 || 5;
  const diff = perWeek - need;
  const trail = diff >= 0 ? `${diff} above target` : `${Math.abs(diff).toFixed(diff % 1 ? 1 : 0)} below target`;
  const note = `${perWeek}/wk (${scopeNote}) · ${trail}`;
  const earlySignal = scopeNote.includes("early signal");
  return { perWeek, note, earlySignal, scopeNote };
}

function burnUpSvg(sheets) {
  // Pull all solved dates across sheets, sort, build cumulative-by-day points
  const dates = [];
  let total = 0;
  let hasDateCol = false;
  for (const name in sheets) {
    const s = sheets[name];
    const dateCol = s.headers.find(h => /^(datesolved|datedone)$/i.test(h));
    const statusCol = s.headers.find(h => /^status$/i.test(h));
    if (!statusCol) continue;
    total += s.rows.length;
    if (dateCol) hasDateCol = true;
    if (!dateCol) continue;
    for (const r of s.rows) {
      if (/solved|done/i.test(r[statusCol] || "") && r[dateCol]) {
        const d = new Date(r[dateCol]);
        if (!isNaN(d)) dates.push(d);
      }
    }
  }
  dates.sort((a, b) => a - b);
  const w = 720, h = 180, pad = 24;
  if (!hasDateCol) {
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
      <text x="${w/2}" y="${h/2 - 6}" text-anchor="middle" fill="#8b92a1" font-size="13">Can't draw the burn-up line.</text>
      <text x="${w/2}" y="${h/2 + 14}" text-anchor="middle" fill="#8b92a1" font-size="11">Add a <tspan fill="#3b64f6" font-weight="700">DateSolved</tspan> column to any sheet.</text>
    </svg>`;
  }
  if (!dates.length) {
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
      <text x="${w/2}" y="${h/2}" text-anchor="middle" fill="#8b92a1" font-size="13">No solved items yet. Tick one on Today to start the line.</text>
    </svg>`;
  }
  const first = dates[0];
  const last = new Date();
  const spanDays = Math.max(1, (last - first) / 86400000);
  const pts = dates.map((d, i) => {
    const x = pad + (w - 2*pad) * ((d - first) / 86400000) / spanDays;
    const y = h - pad - (h - 2*pad) * ((i + 1) / total);
    return [x, y];
  });
  // target line to total by target date
  const settings = getSettings();
  const target = new Date(settings.profile.targetDate);
  const targetX = pad + Math.min(1, (target - first) / 86400000 / spanDays) * (w - 2*pad);
  const targetY = h - pad - (h - 2*pad) * 1.0;
  const curPath = `M ${pad},${h-pad} ` + pts.map(p => `L ${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  return `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="burnFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#3b64f6" stop-opacity=".3"/>
          <stop offset="100%" stop-color="#3b64f6" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <!-- target line -->
      <line x1="${pad}" y1="${h-pad}" x2="${targetX}" y2="${targetY}" stroke="#e3a81a" stroke-dasharray="4 4" stroke-width="1.5" />
      <text x="${targetX - 2}" y="${targetY - 6}" fill="#e3a81a" font-size="10" text-anchor="end" font-weight="600">Target: ${total} by ${target.toISOString().slice(0,10)}</text>
      <!-- actual area -->
      <path d="${curPath} L ${pts[pts.length-1][0]},${h-pad} Z" fill="url(#burnFill)" />
      <path d="${curPath}" fill="none" stroke="#3b64f6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      ${pts.length < 60 ? pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#3b64f6" />`).join("") : ""}
    </svg>
  `;
}

function sheetBarsHtml(sheets) {
  return Object.entries(sheets).map(([name, s]) => {
    const col = s.headers.find(h => /^status$/i.test(h));
    const done = col ? s.rows.filter(r => /solved|done/i.test(r[col] || "")).length : 0;
    const total = s.rows.length;
    const pct = total ? Math.round(100 * done / total) : 0;
    return `
      <div class="sb-row">
        <div class="sb-head"><b>${esc(name)}</b><span>${done} / ${total}</span></div>
        <div class="sb-bar"><span style="width:${pct}%"></span></div>
        <div class="sb-sub">${pct}% done</div>
      </div>
    `;
  }).join("");
}

function computeTopics(sheets) {
  const dsa = sheets["DSA"];
  if (!dsa) return [];
  const counts = {};
  for (const r of dsa.rows) {
    const p = r.Pattern || "Other";
    counts[p] = (counts[p] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a,b)=>a+b, 0);
  const list = Object.entries(counts)
    .map(([label, n]) => ({ label, n, pct: Math.round(100 * n / total) }))
    .sort((a,b) => b.n - a.n);
  // top 6, rest as "Other"
  const top = list.slice(0, 6);
  const otherN = list.slice(6).reduce((a, x) => a + x.n, 0);
  if (otherN) top.push({ label: "Other", n: otherN, pct: Math.round(100 * otherN / total) });
  const colors = ["#3b64f6", "#16a34a", "#e3a81a", "#15181d", "#8b92a1", "#eaeffd", "#d2d6dc"];
  return top.map((t, i) => ({ ...t, color: colors[i % colors.length] }));
}

function donutSvg(topics) {
  const size = 180, r = 70, cx = size/2, cy = size/2, thick = 24;
  if (!topics.length) {
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f1f2f5" stroke-width="${thick}" /></svg>`;
  }
  const total = topics.reduce((a, t) => a + t.n, 0);
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const segs = topics.map(t => {
    const len = circ * (t.n / total);
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${t.color}" stroke-width="${thick}"
      stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})" />`;
    offset += len;
    return seg;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f1f2f5" stroke-width="${thick}" />
    ${segs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="800" fill="#15181d">${total}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="#8b92a1" letter-spacing=".1em">PROBLEMS</text>
  </svg>`;
}

function legendHtml(topics) {
  return topics.map(t => `
    <div class="leg-row">
      <span class="leg-sw" style="background:${t.color}"></span>
      <span class="leg-lb">${esc(t.label)}</span>
      <span class="leg-n">${t.pct}%</span>
    </div>
  `).join("");
}

function patternBarsHtml(dsa) {
  if (!dsa) return `<div class="empty-state"><p>No DSA sheet.</p></div>`;
  const buckets = {};
  const statusCol = dsa.headers.find(h => /^status$/i.test(h));
  for (const r of dsa.rows) {
    const p = r.Pattern || "Other";
    if (!buckets[p]) buckets[p] = { total: 0, done: 0 };
    buckets[p].total++;
    if (statusCol && /solved|done/i.test(r[statusCol] || "")) buckets[p].done++;
  }
  const rows = Object.entries(buckets)
    .map(([pattern, { total, done }]) => ({ pattern, total, done, pct: total ? Math.round(100*done/total) : 0 }))
    .sort((a,b) => b.total - a.total);
  return rows.map(r => `
    <div class="pb-row">
      <div class="pb-name">${esc(r.pattern)}</div>
      <div class="pb-bar"><span style="width:${r.pct}%"></span></div>
      <div class="pb-count">${r.done} / ${r.total}</div>
    </div>
  `).join("");
}

// --- Self-rating calibration -------------------------------------------
// For each sheet row with ≥2 confidence ratings (via re-solves / spaced-rep),
// compute absolute drift between the FIRST rating and the LATEST rating.
// Low drift = well-calibrated. High drift = you over-rated or under-rated.
// Score = 100 - clamp(avgDrift * 20, 0, 60) → range 40-100.
function paintCalibration(root, dayLog) {
  const headlineEl = root.querySelector("#calib-pct");
  const subEl      = root.querySelector("#calib-sub");
  const toggleBtn  = root.querySelector("#calib-toggle");
  const detailEl   = root.querySelector("#calib-detail");
  if (!headlineEl) return;

  // Collect per-row rating sequence (chronological).
  // Key: `${sheet}#${rowIndex}` → [{date, rating, pattern}]
  const byRow = {};
  const dates = Object.keys(dayLog).sort();
  for (const d of dates) {
    const entry = dayLog[d];
    if (!entry?.assigned?.length) continue;
    for (const ref of (entry.done || [])) {
      const task = entry.assigned.find(t => t.ref === ref);
      if (!task?.sheet || task.rowIndex == null) continue;
      const rating = entry.confidence?.[ref];
      if (!(rating >= 1 && rating <= 5)) continue;
      const key = `${task.sheet}#${task.rowIndex}`;
      byRow[key] = byRow[key] || { pattern: task.pattern || "(unlabelled)", ratings: [] };
      byRow[key].ratings.push({ date: d, rating });
    }
  }

  // Compute drifts
  const perRow = [];
  for (const [key, data] of Object.entries(byRow)) {
    if (data.ratings.length < 2) continue;
    const first = data.ratings[0].rating;
    const last  = data.ratings[data.ratings.length - 1].rating;
    perRow.push({ key, pattern: data.pattern, drift: Math.abs(first - last), signed: first - last, n: data.ratings.length });
  }

  if (perRow.length < 3) {
    headlineEl.textContent = "—";
    subEl.innerHTML = `Need <b>at least 3 re-solved problems</b> with confidence ratings to calibrate. Keep rating low-confidence solves — spaced-rep brings them back.`;
    toggleBtn.hidden = true;
    detailEl.hidden = true;
    return;
  }

  const avgDrift = perRow.reduce((a, r) => a + r.drift, 0) / perRow.length;
  const avgSigned = perRow.reduce((a, r) => a + r.signed, 0) / perRow.length;
  const score = Math.max(40, Math.round(100 - avgDrift * 20));

  headlineEl.textContent = score;
  const tone = avgSigned > 0.6 ? "over-rating" : avgSigned < -0.6 ? "under-rating" : "well-calibrated";
  const scoreLabel = score >= 85 ? "sharp" : score >= 70 ? "solid" : score >= 55 ? "noisy" : "shaky";
  subEl.innerHTML = `${perRow.length} re-solved problems · you're <b>${esc(tone)}</b> by <b>${avgDrift.toFixed(1)} ★</b> on average · <b>${esc(scoreLabel)}</b>`;

  // Per-pattern breakdown (expandable)
  const byPattern = {};
  for (const r of perRow) {
    byPattern[r.pattern] = byPattern[r.pattern] || { signed: 0, abs: 0, n: 0 };
    byPattern[r.pattern].signed += r.signed;
    byPattern[r.pattern].abs    += r.drift;
    byPattern[r.pattern].n++;
  }
  const patternRows = Object.entries(byPattern)
    .map(([p, s]) => ({
      pattern: p,
      n: s.n,
      avgAbs: s.abs / s.n,
      avgSigned: s.signed / s.n,
      score: Math.max(40, Math.round(100 - (s.abs / s.n) * 20)),
    }))
    .sort((a, b) => a.score - b.score);  // worst first

  detailEl.innerHTML = patternRows.map(p => {
    const biasText = p.avgSigned > 0.4 ? "over-rated" : p.avgSigned < -0.4 ? "under-rated" : "fair";
    const biasCls = p.avgSigned > 0.4 ? "cb-over" : p.avgSigned < -0.4 ? "cb-under" : "cb-fair";
    return `
      <div class="calib-row ${biasCls}">
        <div class="cr-pat">${esc(p.pattern)}</div>
        <div class="cr-score">${p.score}%</div>
        <div class="cr-bias">${biasText} · ${Math.abs(p.avgSigned).toFixed(1)} ★</div>
        <div class="cr-n">n=${p.n}</div>
      </div>
    `;
  }).join("");

  toggleBtn.hidden = false;
  toggleBtn.onclick = () => {
    const expanded = !detailEl.hidden;
    detailEl.hidden = expanded;
    toggleBtn.classList.toggle("expanded", !expanded);
  };
}

// Pattern mastery — one row per pattern across ALL sheets. Weakest first.
// Trend arrow compares the last 5 confidence ratings vs the 5 before.
function patternMasteryHtml(sheets, dayLog) {
  // 1. Collect confidence timeline per pattern from dayLog.
  //    Each entry: {date, rating, title, sheet, rowIndex}
  const timelineByPattern = {};
  const dates = Object.keys(dayLog).sort();   // chronological
  for (const d of dates) {
    const entry = dayLog[d];
    if (!entry?.assigned?.length) continue;
    for (const ref of (entry.done || [])) {
      const task = entry.assigned.find(t => t.ref === ref);
      if (!task || !task.pattern) continue;
      const rating = entry.confidence?.[ref];
      if (!(rating >= 1 && rating <= 5)) continue;
      timelineByPattern[task.pattern] = timelineByPattern[task.pattern] || [];
      timelineByPattern[task.pattern].push({ date: d, rating, title: task.title, sheet: task.sheet });
    }
  }

  // 2. Collect pattern totals (solved / total count) from sheets. Scan every sheet
  //    with a Pattern/Category column — so SQL / SD / Int patterns surface too.
  const bucketsByPattern = {};
  for (const [sheetName, sheet] of Object.entries(sheets)) {
    const patternCol = sheet.headers?.find(h => /^(pattern|category)$/i.test(h));
    const statusCol = sheet.headers?.find(h => /^status$/i.test(h));
    if (!patternCol) continue;
    for (const r of sheet.rows) {
      const p = r[patternCol];
      if (!p || !String(p).trim()) continue;
      if (!bucketsByPattern[p]) bucketsByPattern[p] = { total: 0, solved: 0, sheet: sheetName };
      bucketsByPattern[p].total++;
      if (statusCol && /^(solved|done)$/i.test(r[statusCol] || "")) bucketsByPattern[p].solved++;
    }
  }

  // 3. Merge — compute per-pattern mastery metrics.
  const allPatterns = new Set([
    ...Object.keys(timelineByPattern),
    ...Object.keys(bucketsByPattern),
  ]);
  const rows = [];
  for (const p of allPatterns) {
    const timeline = timelineByPattern[p] || [];
    const bucket = bucketsByPattern[p] || { total: 0, solved: 0, sheet: null };
    const ratings = timeline.map(t => t.rating);
    const avgConf = ratings.length ? ratings.reduce((a,b) => a+b, 0) / ratings.length : null;

    // Trend from the last 5 vs the prior 5
    let trend = "steady";
    let trendDelta = 0;
    if (ratings.length >= 6) {
      const last5 = ratings.slice(-5);
      const prior5 = ratings.slice(-10, -5);
      const lastAvg = last5.reduce((a,b)=>a+b,0) / last5.length;
      const priorAvg = prior5.reduce((a,b)=>a+b,0) / prior5.length;
      trendDelta = lastAvg - priorAvg;
      if (trendDelta > 0.4) trend = "up";
      else if (trendDelta < -0.4) trend = "down";
    } else if (ratings.length >= 2) {
      // Not enough data for 5v5. Use half-vs-half as a soft fallback.
      const half = Math.floor(ratings.length / 2);
      const lastHalf = ratings.slice(-half);
      const firstHalf = ratings.slice(0, half);
      const lastAvg = lastHalf.reduce((a,b)=>a+b,0) / lastHalf.length;
      const firstAvg = firstHalf.reduce((a,b)=>a+b,0) / firstHalf.length;
      trendDelta = lastAvg - firstAvg;
      if (trendDelta > 0.5) trend = "up";
      else if (trendDelta < -0.5) trend = "down";
    }

    // Mastery score: weighted mix of (confidence/5) and (solved/total).
    // Weakest first → sort ascending by score.
    const confScore = avgConf != null ? avgConf / 5 : 0;
    const coverage = bucket.total ? bucket.solved / bucket.total : 0;
    const score = ratings.length ? (confScore * 0.6 + coverage * 0.4) : coverage * 0.3;

    rows.push({
      pattern: p,
      sheet: bucket.sheet,
      total: bucket.total,
      solved: bucket.solved,
      ratingsCount: ratings.length,
      avgConf,
      trend,
      trendDelta,
      score,
    });
  }

  if (!rows.length) {
    return `<div class="empty-state"><p>Rate your first few solves (★ 1–5 after any tick) and this grid lights up.</p></div>`;
  }

  // Sort: weakest first. Patterns with ratings outrank patterns without (we have data).
  rows.sort((a, b) => {
    if (a.ratingsCount === 0 && b.ratingsCount > 0) return 1;
    if (b.ratingsCount === 0 && a.ratingsCount > 0) return -1;
    return a.score - b.score;
  });

  return rows.slice(0, 24).map(r => {
    const pctConf = r.avgConf != null ? Math.round((r.avgConf / 5) * 100) : 0;
    const confLabel = r.avgConf != null ? `★ ${r.avgConf.toFixed(1)}` : `★ —`;
    const trendIco = r.trend === "up" ? "↗" : r.trend === "down" ? "↘" : "→";
    const trendLbl = r.trend === "up" ? "rising" : r.trend === "down" ? "shaky" : (r.ratingsCount ? "steady" : "no data");
    const sheetJump = r.sheet
      ? `<button class="pm-jump" data-pattern-jump="${esc(r.sheet)}" title="Open ${esc(r.sheet)} library">↗</button>`
      : "";
    return `
      <div class="pm-row pm-trend-${r.trend}" title="${r.ratingsCount} rated solve${r.ratingsCount === 1 ? "" : "s"}">
        <div class="pm-name">${esc(r.pattern)}${sheetJump}</div>
        <div class="pm-bar-wrap">
          <div class="pm-bar"><span style="width:${pctConf}%"></span></div>
          <div class="pm-count">${r.solved}/${r.total}</div>
        </div>
        <div class="pm-conf">${confLabel}</div>
        <div class="pm-trend">${trendIco}<small>${trendLbl}</small></div>
      </div>
    `;
  }).join("");
}

function animateNumber(el, to) {
  if (!el) return;
  const from = parseInt(el.textContent.replace(/[^0-9]/g, "") || "0", 10);
  if (from === to) { el.textContent = String(to); return; }
  const start = performance.now();
  const dur = 480;
  function step(t) {
    const p = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = Math.round(from + (to - from) * eased);
    el.textContent = String(val);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }

function styles() {
  return `
  <style>
    .prog { max-width: 1240px; }
    .prog .prog-top {
      display: grid; grid-template-columns: 2fr 1fr 1fr; gap: var(--s-3);
      margin: var(--s-4) 0 var(--s-5);
    }
    .prog .readiness-card, .prog .rate-card {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
      padding: var(--s-5); box-shadow: var(--shadow);
      transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
    }
    .prog .readiness-card:hover, .prog .rate-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
    .prog .r-eyebrow { font-size: 11px; letter-spacing: .18em; font-weight: 700; color: var(--mut); margin-bottom: var(--s-3); }
    .prog .r-value { font-size: 48px; font-weight: 800; letter-spacing: -.025em; line-height: 1; color: var(--ink); }
    .prog .r-value .r-unit { font-size: 14px; font-weight: 500; color: var(--mut); margin-left: 8px; letter-spacing: 0; }
    .prog .r-sub { font-size: 12px; color: var(--mut); margin-top: 8px; }
    .prog .readiness-card .r-bar {
      height: 10px; background: var(--line); border-radius: 999px; margin-top: 14px; overflow: hidden;
    }
    .prog .readiness-card .r-bar span {
      display: block; height: 100%; width: 0%;
      background: linear-gradient(90deg, var(--blue), var(--green));
      border-radius: 999px; transition: width 1s var(--ease);
    }
    .prog .rate-card.streak .r-value { color: #ff6a40; }

    .prog .prog-grid { display: grid; grid-template-columns: 2fr 1fr; gap: var(--s-4); }
    .prog .prog-card {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius);
      padding: var(--s-5); box-shadow: var(--shadow);
    }
    .prog .prog-card.wide { grid-column: 1 / -1; }
    .prog .pc-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: var(--s-4); }
    .prog .pc-head h3 { margin: 0; font-size: 16px; font-weight: 700; }
    .prog .pc-sub { font-size: 12px; color: var(--mut); }

    .prog .sb-row { padding: var(--s-3) 0; border-top: 1px solid var(--line); }
    .prog .sb-row:first-child { border-top: none; padding-top: 0; }
    .prog .sb-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
    .prog .sb-bar { height: 8px; background: var(--line); border-radius: 999px; overflow: hidden; }
    .prog .sb-bar > span { display: block; height: 100%; background: var(--blue); border-radius: 999px; transition: width .8s var(--ease); }
    .prog .sb-sub { font-size: 11px; color: var(--mut); margin-top: 4px; }

    .prog .donut-row { display: flex; align-items: center; gap: var(--s-4); }
    .prog #donut { flex-shrink: 0; }
    .prog #donut-legend { flex: 1; }
    .prog .leg-row { display: grid; grid-template-columns: 14px 1fr auto; gap: 10px; align-items: center; padding: 5px 0; font-size: 12px; }
    .prog .leg-sw { width: 10px; height: 10px; border-radius: 2px; margin: 0 auto; }
    .prog .leg-lb { color: var(--ink); }
    .prog .leg-n  { color: var(--mut); font-weight: 600; }

    .prog .pb-row {
      display: grid; grid-template-columns: 180px 1fr 90px; gap: var(--s-3);
      padding: 8px 0; align-items: center; border-top: 1px solid var(--line);
      font-size: 13px;
    }
    .prog .pb-row:first-child { border-top: none; }
    .prog .pb-bar { height: 6px; background: var(--line); border-radius: 999px; overflow: hidden; }
    .prog .pb-bar > span { display: block; height: 100%; background: linear-gradient(90deg, var(--blue), var(--green)); border-radius: 999px; }
    .prog .pb-count { color: var(--mut); font-size: 12px; text-align: right; font-weight: 600; }

    /* --- predictive-analytics card — paper tone --- */
    .prog .insight-card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-left: 3px solid var(--gold);
      color: var(--ink);
      border-radius: var(--radius-lg);
      padding: var(--s-6);
      margin-bottom: var(--s-5);
      box-shadow: var(--shadow);
      position: relative; overflow: hidden;
      animation: rise var(--dur-slow) var(--ease) both;
    }
    .prog .insight-card::before { display: none; }
    .prog .ic-head {
      display: flex; justify-content: space-between; align-items: center;
      gap: var(--s-4); margin-bottom: var(--s-5);
      position: relative; z-index: 1;
    }
    .prog .ic-eyebrow { font-size: 10px; letter-spacing: .24em; font-weight: 700; color: var(--mut); margin-bottom: 6px; }
    .prog .ic-title { font-size: 22px; font-weight: 700; margin: 0; letter-spacing: -.01em; color: var(--ink); }
    .prog .ic-ask-btn {
      display: inline-flex; align-items: center; gap: 8px;
      background: var(--bg); color: var(--ink);
      border: 1px solid var(--line2); border-radius: 10px;
      padding: 9px 16px; cursor: pointer;
      font: 600 12.5px/1 var(--font-sans); letter-spacing: .02em;
      transition: all var(--dur-fast) var(--ease);
    }
    .prog .ic-ask-btn:hover {
      background: var(--gold-soft); border-color: var(--gold);
      transform: translateY(-1px);
    }
    .prog .ic-ask-glyph { font-size: 14px; color: var(--gold); }

    /* Three clean stat columns */
    .prog .ic-stats {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-4);
      position: relative; z-index: 1;
      padding: var(--s-4) 0; border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    .prog .ic-stat-lb { font-size: 10px; letter-spacing: .18em; font-weight: 700; color: var(--mut); margin-bottom: 8px; }
    .prog .ic-stat-val { font-size: 36px; font-weight: 800; letter-spacing: -.02em; line-height: 1; color: var(--ink); }
    .prog .ic-stat.ic-stat-eta .ic-stat-val { color: var(--gold); font-size: 28px; }
    .prog .ic-stat-sub { margin-top: 8px; font-size: 12px; color: var(--mut); }
    .prog .ic-stat-sub b { color: var(--ink); font-weight: 600; }
    .prog .ic-stat-sub .pos { color: var(--green); font-weight: 600; }
    .prog .ic-stat-sub .neg { color: var(--red); font-weight: 600; }

    /* Likely-to-slip pattern cards */
    .prog .ic-weak { margin-top: var(--s-5); position: relative; z-index: 1; }
    .prog .weak-head { font-size: 10px; letter-spacing: .22em; font-weight: 700; color: var(--mut); margin-bottom: 12px; }
    .prog .weak-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .prog .weak-chip {
      background: var(--bg); border: 1px solid var(--line);
      border-radius: 12px; padding: 12px 14px;
      transition: all var(--dur-fast) var(--ease);
    }
    .prog .weak-chip:hover { background: var(--paper); border-color: var(--line2); transform: translateY(-1px); }
    .prog .wc-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .prog .wc-name { font-weight: 700; color: var(--ink); font-size: 13px; }
    .prog .wc-risk-tier { font-size: 9px; letter-spacing: .14em; font-weight: 700; padding: 3px 8px; border-radius: 999px; }
    .prog .wc-risk-tier.low  { background: var(--green-soft); color: var(--green); }
    .prog .wc-risk-tier.mid  { background: var(--gold-soft); color: var(--gold); }
    .prog .wc-risk-tier.high { background: #fde7e9; color: var(--red); }
    .prog .wc-bar { height: 4px; background: var(--line); border-radius: 999px; overflow: hidden; }
    .prog .wc-bar > span {
      display: block; height: 100%; border-radius: 999px;
      background: linear-gradient(90deg, var(--green), var(--gold), var(--red));
    }
    .prog .wc-stat { font-size: 11px; color: var(--mut); margin-top: 6px; }

    .prog .ic-narrative { margin-top: var(--s-5); position: relative; z-index: 1; }
    .prog .narr-body {
      background: var(--gold-soft); border-left: 3px solid var(--gold);
      padding: 14px 18px; border-radius: 0 10px 10px 0;
      font-size: 14px; line-height: 1.6; color: var(--ink);
    }
    .prog .ic-narrative .err { color: var(--red); font-size: 13px; }
    .prog .think-dots { display: inline-flex; gap: 6px; padding: 12px; }
    .prog .think-dots span { width: 7px; height: 7px; border-radius: 50%; background: var(--gold); animation: thinkDot 1.2s ease-in-out infinite; }
    .prog .think-dots span:nth-child(2) { animation-delay: .18s; }
    .prog .think-dots span:nth-child(3) { animation-delay: .36s; }

    @media (max-width: 760px) {
      .prog .ic-stats { grid-template-columns: 1fr; }
      .prog .ic-head { flex-direction: column; align-items: flex-start; }
    }

    @media (max-width: 960px) {
      .prog .prog-top { grid-template-columns: 1fr; }
      .prog .prog-grid { grid-template-columns: 1fr; }
      .prog .ic-head { flex-direction: column; align-items: flex-start; }
      .prog .ic-side { align-items: flex-start; }
    }

    /* ---- Confidence calibration card ---- */
    .prog .calib-card {
      background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-lg);
      padding: 18px 22px; margin: var(--s-4) 0 var(--s-4);
      box-shadow: var(--shadow);
      transition: all var(--dur-fast) var(--ease);
    }
    .prog .calib-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .prog .calib-left { min-width: 0; flex: 1; }
    .prog .calib-value {
      font-size: 36px; font-weight: 700; color: var(--ink); letter-spacing: -.02em;
      display: inline-flex; align-items: baseline; gap: 6px;
      margin: 4px 0 2px;
    }
    .prog .calib-value small { font-size: 14px; font-weight: 500; color: var(--mut); letter-spacing: 0; }
    .prog .calib-sub { font-size: 13px; color: var(--mut); line-height: 1.5; }
    .prog .calib-sub b { color: var(--ink); font-weight: 700; }
    .prog .calib-toggle {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; background: transparent; border: 1px solid var(--line);
      border-radius: 10px; cursor: pointer; color: var(--mut);
      font: 600 12px/1 var(--font-sans);
      transition: all var(--dur-fast) var(--ease);
    }
    .prog .calib-toggle:hover { color: var(--ink); border-color: var(--line2); }
    .prog .calib-toggle .ct-ic { transition: transform .18s; display: inline-block; }
    .prog .calib-toggle.expanded .ct-ic { transform: rotate(-180deg); }

    .prog .calib-detail {
      margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line);
      display: flex; flex-direction: column; gap: 2px;
      animation: slideDownFade 220ms cubic-bezier(.2,1.2,.3,1) both;
    }
    .prog .calib-row {
      display: grid; grid-template-columns: 1.6fr 60px 140px 60px;
      align-items: center; gap: 12px;
      padding: 8px 12px; border-radius: 8px;
      transition: background .18s;
    }
    .prog .calib-row:hover { background: var(--bg); }
    .prog .calib-row .cr-pat { font-size: 13px; font-weight: 600; color: var(--ink); }
    .prog .calib-row .cr-score { font-size: 13px; font-weight: 700; color: var(--mut); font-variant-numeric: tabular-nums; }
    .prog .calib-row .cr-bias { font-size: 11.5px; color: var(--mut); }
    .prog .calib-row .cr-n { font-size: 11px; color: var(--mut); text-align: right; font-variant-numeric: tabular-nums; }
    .prog .calib-row.cb-over .cr-score { color: var(--red); }
    .prog .calib-row.cb-over .cr-bias { color: var(--red); }
    .prog .calib-row.cb-under .cr-score { color: var(--blue); }
    .prog .calib-row.cb-under .cr-bias { color: var(--blue); }
    .prog .calib-row.cb-fair .cr-score { color: var(--green); }
    .prog .calib-row.cb-fair .cr-bias { color: var(--green); }
    @media (max-width: 640px) {
      .prog .calib-row { grid-template-columns: 1fr 1fr; }
      .prog .calib-row .cr-pat { grid-column: span 2; font-size: 13.5px; }
    }

    /* ---- Pattern mastery grid (confidence + trend) ---- */
    .prog .pattern-mastery-card { margin-top: var(--s-4); }
    .prog .pm-row {
      display: grid; grid-template-columns: minmax(140px, 1.6fr) minmax(0, 2fr) 56px 72px;
      align-items: center; gap: var(--s-3);
      padding: 10px 12px; border-radius: 10px;
      transition: background .18s;
    }
    .prog .pm-row + .pm-row { border-top: 1px solid var(--line); }
    .prog .pm-row:hover { background: var(--bg); }
    .prog .pm-name {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 13.5px; font-weight: 600; color: var(--ink);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .prog .pm-jump {
      opacity: 0; background: transparent; border: none; cursor: pointer;
      color: var(--mut); font-size: 11.5px; padding: 2px 6px; border-radius: 4px;
      transition: opacity .18s, color .18s, background .18s;
    }
    .prog .pm-row:hover .pm-jump { opacity: 1; }
    .prog .pm-jump:hover { color: var(--gold); background: var(--gold-soft); }
    .prog .pm-bar-wrap { display: flex; align-items: center; gap: 10px; }
    .prog .pm-bar {
      flex: 1; height: 6px; background: var(--line); border-radius: 4px; overflow: hidden;
    }
    .prog .pm-bar span {
      display: block; height: 100%; border-radius: 4px;
      background: linear-gradient(90deg,
        color-mix(in oklab, var(--red) 70%, transparent) 0%,
        color-mix(in oklab, var(--gold) 70%, transparent) 50%,
        color-mix(in oklab, var(--green) 70%, transparent) 100%);
      transition: width .4s cubic-bezier(.2,1,.3,1);
    }
    .prog .pm-count { font-size: 11.5px; color: var(--mut); font-variant-numeric: tabular-nums; min-width: 42px; }
    .prog .pm-conf {
      font: 700 12px/1 var(--font-sans); color: var(--gold); letter-spacing: -.01em;
      font-variant-numeric: tabular-nums;
    }
    .prog .pm-trend {
      display: inline-flex; align-items: center; gap: 5px;
      font: 600 14px/1 var(--font-sans);
    }
    .prog .pm-trend small { font-size: 10.5px; font-weight: 500; letter-spacing: .02em; }
    .prog .pm-trend-up    { }
    .prog .pm-trend-up .pm-trend    { color: var(--green); }
    .prog .pm-trend-down .pm-trend  { color: var(--red); }
    .prog .pm-trend-steady .pm-trend { color: var(--mut); }
    .prog .pm-row.pm-trend-down { background: color-mix(in oklab, var(--red) 3%, transparent); }

    @media (max-width: 740px) {
      .prog .pm-row { grid-template-columns: 1fr 1fr; }
      .prog .pm-bar-wrap { grid-column: 1 / span 2; }
      .prog .pm-conf, .prog .pm-trend { font-size: 11.5px; }
    }

    /* ---- 365-day chain heatmap (positioned high — after hero stats) ---- */
    .prog .chain-section { margin: 20px 0 24px; }
    .prog .chain-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .prog .filter-tabs { display: flex; gap: 4px; background: var(--line); padding: 3px; border-radius: 10px; }
    .prog .ft {
      padding: 6px 12px; border: none; background: transparent; cursor: pointer;
      font: 600 11px/1 var(--font-sans); letter-spacing: .04em;
      color: var(--mut); border-radius: 7px; transition: all var(--dur-fast) var(--ease);
    }
    .prog .ft:hover { color: var(--ink); }
    .prog .ft.active { background: var(--paper); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.08); }

    .prog .year-heatmap { overflow-x: auto; padding: 10px 0 4px; margin-top: 10px; }

    /* Grouped layout — month labels above, dow (Mon/Wed/Fri) left column */
    .prog .year-grid { display: inline-flex; flex-direction: column; gap: 6px; min-width: 100%; }
    .prog .year-months {
      display: flex; align-items: center;
      font-size: 10.5px; letter-spacing: .06em; color: var(--mut);
      font-weight: 600;
    }
    .prog .year-dow-spacer { width: 28px; flex-shrink: 0; }
    .prog .year-month-label {
      flex: 0 0 calc(var(--span) * 16px + (var(--span) - 1) * 3px + 10px);
      padding-left: 2px;
      box-sizing: border-box;
    }
    .prog .year-rows { display: flex; align-items: flex-start; gap: 0; }
    .prog .year-dow {
      display: flex; flex-direction: column; gap: 3px;
      width: 28px; flex-shrink: 0; padding-top: 1px;
      font-size: 9.5px; color: var(--mut); font-weight: 600;
    }
    .prog .year-dow span { height: 13px; line-height: 13px; }
    .prog .year-group { display: flex; gap: 3px; align-items: flex-start; }
    .prog .year-group.month-sep { padding-left: 10px; position: relative; }
    .prog .year-group.month-sep::before {
      content: ""; position: absolute; left: 4px; top: 0; bottom: 0;
      width: 1px; background: color-mix(in oklab, var(--line) 70%, transparent);
    }
    .prog .year-col { display: flex; flex-direction: column; gap: 3px; }
    .prog .ycell {
      width: 13px; height: 13px; border-radius: 2px;
      background: var(--line);
      transition: transform var(--dur-fast) var(--ease);
    }
    .prog .ycell:hover { transform: scale(1.6); z-index: 2; box-shadow: 0 0 0 1px var(--ink); }
    .prog .ycell.future { background: transparent; border: 1px dashed var(--line); box-sizing: border-box; }
    /* Palette — identical to Calendar's (red=missed, greens=solved intensity) */
    .prog .ycell.sw-neutral { background: var(--line); }
    .prog .ycell.sw-missed  { background: color-mix(in oklab, var(--red) 42%, var(--paper)); }
    .prog .ycell.sw-0       { background: color-mix(in oklab, var(--red) 42%, var(--paper)); }
    .prog .ycell.sw-1       { background: color-mix(in oklab, var(--green) 32%, var(--paper)); }
    .prog .ycell.sw-2       { background: color-mix(in oklab, var(--green) 60%, var(--paper)); }
    .prog .ycell.sw-3       { background: var(--green); opacity: .9; }
    .prog .ycell.sw-4       { background: var(--green); }

    .prog .hover-tip {
      position: fixed; z-index: 1000;
      background: var(--ink); color: var(--paper);
      padding: 8px 12px; border-radius: 8px;
      font-size: 12px; line-height: 1.5;
      pointer-events: none; max-width: 280px;
      box-shadow: 0 8px 24px rgba(0,0,0,.2);
    }
    .prog .hover-tip .tip-green { color: #4ade80; font-weight: 700; letter-spacing: .04em; }
    .prog .hover-tip .tip-amber { color: #facc15; font-weight: 700; }
    .prog .hover-tip .tip-dim { color: color-mix(in oklab, var(--paper) 60%, transparent); font-size: 11px; }
    .prog .hover-tip ul { margin: 4px 0 0; padding-left: 16px; }
    .prog .hover-tip li.did { color: #4ade80; }
  </style>
  `;
}
