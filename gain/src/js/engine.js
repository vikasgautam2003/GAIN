// Daily engine — picks today's tasks from the sheets, prices them (₹20–₹100),
// handles green-day/week/month logic, and computes streaks from dayLog.
// Full Grok override lands in Part 4.

import { getSettings, getSheets, getDayLog, updateDayLog } from "./store.js";

// GAIN "day" rolls over at 19:00 IST (7 PM) — not local midnight. Before 19:00 IST
// the key is today's IST calendar date; at/after 19:00 IST it's tomorrow's.
// This gives the user a 24-hour window ending at 7 PM IST to finish a day.
// Keys stay plain calendar dates (YYYY-MM-DD) so historic dayLog entries,
// Progress graphs, and backups all keep working unchanged.
const DAY_BOUNDARY_HOUR_IST = 19;

export function todayKey(d = new Date()) {
  // IST wallclock as a UTC-looking Date; add 5h so the day flips at 19:00 IST.
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const shifted = new Date(ist.getTime() + (24 - DAY_BOUNDARY_HOUR_IST) * 3600 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Next GAIN day's key — used for "preview tomorrow" when today's plan is done.
export function nextDayKey(from = new Date()) {
  const base = new Date(from.getTime() + 24 * 3600 * 1000);
  return todayKey(base);
}

// Plain calendar-date key (YYYY-MM-DD in LOCAL time) — no IST / 3-PM shift.
// Use this when iterating a calendar grid (heatmap, month grid, week bars).
// todayKey() applies the "GAIN day" shift and is only right for current-time;
// using it to label a cell for Oct 19 noon returns Oct 20 because of the +9h.
export function calendarKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// The "working" day for the Today page. Equal to todayKey() most of the time,
// but if the user already finished every task for today, advances to tomorrow
// so the next session appears right away rather than waiting for 7 PM IST.
// Only Today page should use this; Pace, Streak, Calendar etc. use todayKey().
export function activeKey() {
  const base = todayKey();
  try {
    const d = getDayLog()[base];
    if (d && Array.isArray(d.assigned) && d.assigned.length > 0 &&
        Array.isArray(d.done) && d.done.length >= d.assigned.length) {
      return nextDayKey();
    }
  } catch (_) { /* dayLog not loaded yet — fine */ }
  return base;
}

// Human-friendly countdown to the next 19:00 IST rollover (e.g. "4h 12m").
export function hoursToRollover(from = new Date()) {
  const istMs = from.getTime() + 5.5 * 3600 * 1000;
  const ist = new Date(istMs);
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  const nowMin = h * 60 + m;
  const boundaryMin = DAY_BOUNDARY_HOUR_IST * 60;
  const diffMin = nowMin < boundaryMin ? boundaryMin - nowMin : (24 * 60) - nowMin + boundaryMin;
  const hh = Math.floor(diffMin / 60);
  const mm = diffMin % 60;
  return hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
}

export function dayName(d = new Date()) {
  // Day-of-week follows the GAIN key so Mon/Tue labels stay in sync with the plan.
  const key = todayKey(d);
  const parts = key.split("-").map(Number);
  const dd = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dd.getUTCDay()];
}

// Deterministic ₹ pricing clamped to settings range, driven by difficulty/importance.
export function priceTask(task, settings) {
  const { taskMin, taskMax } = settings.wallet;
  const span = Math.max(0, taskMax - taskMin);
  let factor = 0.4; // default
  const diff = (task.difficulty || "").toLowerCase();
  if (diff === "easy") factor = 0.25;
  else if (diff === "medium") factor = 0.6;
  else if (diff === "hard") factor = 1.0;
  if (task.kind === "revision") factor = 0.15;
  if (task.kind === "revisit")  factor = 0.5;  // spaced-rep solve = half a new DSA
  if (task.kind === "log")      factor = 0.1;
  if (task.kind === "sd")       factor = 0.75;
  if (task.kind === "int")      factor = 0.65;
  if (task.kind === "ext")      factor = 0.7;
  if (task.kind === "os")       factor = 0.7;
  if (task.freq === "HIGH")     factor = Math.min(1, factor + 0.1);
  const minutes = task.minutes || 30;
  factor = Math.min(1, factor + Math.max(0, (minutes - 30) / 120));
  const raw = taskMin + span * factor;
  // round to nearest 10
  return Math.max(taskMin, Math.min(taskMax, Math.round(raw / 10) * 10));
}

// --- Carry-over at rollover (Phase 8) ---
// Any TODO task on yesterday's plan auto-rolls into today with `carried: true`.
// Debounced via localStorage so re-mounts don't duplicate. Returns the count added.
export async function carryOverUnfinished(dateKey = todayKey()) {
  const dayLog = getDayLog();
  const today = dayLog[dateKey];
  if (!today || !Array.isArray(today.assigned)) return 0;
  const flagKey = `gain:carriedOn:${dateKey}`;
  try { if (localStorage.getItem(flagKey) === "1") return 0; } catch (_) {}

  // Find yesterday's calendar key by subtracting 1 day from dateKey
  const parts = dateKey.split("-").map(Number);
  const yd = new Date(Date.UTC(parts[0], parts[1]-1, parts[2]));
  yd.setUTCDate(yd.getUTCDate() - 1);
  const yesterdayKey = `${yd.getUTCFullYear()}-${String(yd.getUTCMonth()+1).padStart(2,"0")}-${String(yd.getUTCDate()).padStart(2,"0")}`;
  const yesterday = dayLog[yesterdayKey];
  if (!yesterday || !Array.isArray(yesterday.assigned)) {
    try { localStorage.setItem(flagKey, "1"); } catch (_) {}
    return 0;
  }

  const undone = yesterday.assigned.filter(t => !(yesterday.done || []).includes(t.ref));
  // Skip warm-ups and non-persistent kinds — they're meant to be fresh each day
  const nonSkippable = undone.filter(t => !["warmup", "revision", "log"].includes(t.kind));
  if (!nonSkippable.length) {
    try { localStorage.setItem(flagKey, "1"); } catch (_) {}
    return 0;
  }

  const existingKeys = new Set(today.assigned
    .filter(t => t.sheet && t.rowIndex != null)
    .map(t => `${t.sheet}#${t.rowIndex}`));

  const { updateDayLog } = await import("./store.js");
  let added = 0;
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    for (const t of nonSkippable) {
      const key = t.sheet && t.rowIndex != null ? `${t.sheet}#${t.rowIndex}` : null;
      if (key && existingKeys.has(key)) continue;
      const newRef = `${t.ref}-carried-${dateKey}`;
      if (d.assigned.some(x => x.ref === newRef)) continue;
      d.assigned.push({ ...t, ref: newRef, carried: true });
      d.values[newRef] = t.value;
      added++;
    }
  });
  try { localStorage.setItem(flagKey, "1"); } catch (_) {}
  return added;
}

// Pick today's tasks. Idempotent — stores the plan in dayLog so page refresh keeps it.
export async function ensureDailyPlan(dateKey = todayKey()) {
  const dayLog = getDayLog();
  if (dayLog[dateKey] && dayLog[dateKey].assigned && dayLog[dateKey].assigned.length) {
    // Topping-up: inject newly-due revisits that weren't there when the plan was first built.
    const existing = new Set(dayLog[dateKey].assigned.map(t => `${t.sheet || ""}#${t.rowIndex ?? ""}`));
    const dueNew = getDueRevisits(dateKey).filter(r => !existing.has(`${r.sheet}#${r.rowIndex}`));
    if (dueNew.length) {
      const s = getSettings();
      for (const t of dueNew) t.value = priceTask(t, s);
      await updateDayLog(dl => {
        const d = dl[dateKey];
        if (!d) return;
        d.assigned.unshift(...dueNew);
        for (const t of dueNew) d.values[t.ref] = t.value;
      });
    }
    await maybeInjectWildcard(dateKey);
    return getDayLog()[dateKey];
  }
  const plan = buildPlan(dateKey);
  await updateDayLog(dl => {
    dl[dateKey] = {
      assigned: plan,
      done: [],
      values: Object.fromEntries(plan.map(t => [t.ref, t.value])),
      confidence: {},
      green: false,
      dayEarned: 0
    };
  });
  await maybeInjectWildcard(dateKey);
  return getDayLog()[dateKey];
}

// Wildcard — pick the weakest-pattern lowest-★ problem and inject it into
// today's plan once per day. Deletable like any other task. If no sheets yet,
// no-op. Uses the Pattern Mastery scorer so the signal matches the Mastery view.
export async function maybeInjectWildcard(dateKey) {
  try {
    const day = getDayLog()[dateKey];
    if (!day) return;
    const ref = `WILDCARD-${dateKey}`;
    if (day.assigned.some(t => t.ref === ref)) return;
    // Also skip if the user previously deleted today's wildcard (we leave a tombstone)
    if (day.wildcardSkipped) return;

    const { computePatternMastery, computeWeakestProblems } = await import("./mastery.js");
    const ctx = computePatternMastery();
    if (!ctx.patterns.length) return;

    // Prefer: an unsolved problem in the weakest TOUCHED pattern, falling back to
    // the lowest-★ most-recent solve from computeWeakestProblems.
    const weakPattern = ctx.patterns.find(p => p.score != null && p.score < 3.5);
    const { getSheets } = await import("./store.js");
    const sheets = getSheets();
    let pick = null;

    if (weakPattern) {
      // Find an unsolved problem in weakPattern
      outer: for (const [sheetName, sh] of Object.entries(sheets)) {
        const patternCol = sh.headers?.find(h => /^(pattern|category)$/i.test(h));
        if (!patternCol) continue;
        const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
        const statusCol = sh.headers.find(h => /^status$/i.test(h));
        const diffCol = sh.headers.find(h => /^difficulty$/i.test(h));
        for (let i = 0; i < sh.rows.length; i++) {
          const r = sh.rows[i];
          if (String(r[patternCol] || "").trim() !== weakPattern.name) continue;
          if (statusCol && /^solved$/i.test(String(r[statusCol] || ""))) continue;
          const key = `${sheetName}#${i}`;
          if (day.assigned.some(t => t.sheet === sheetName && t.rowIndex === i)) continue;
          pick = {
            sheet: sheetName,
            rowIndex: i,
            title: String((titleCol && r[titleCol]) || "Wildcard problem").trim(),
            pattern: weakPattern.name,
            difficulty: diffCol ? String(r[diffCol] || "").trim() : "",
            kind: inferKindFromSheetName(sheetName),
          };
          break outer;
        }
      }
    }
    if (!pick) {
      // Fallback: pick the weakest SOLVED problem (so we can revisit it)
      const weak = computeWeakestProblems(ctx, 1)[0];
      if (!weak) return;
      if (day.assigned.some(t => t.sheet === weak.sheetName && t.rowIndex === weak.rowIndex)) return;
      pick = {
        sheet: weak.sheetName,
        rowIndex: weak.rowIndex,
        title: weak.title,
        pattern: weak.pattern,
        difficulty: weak.difficulty,
        kind: inferKindFromSheetName(weak.sheetName),
      };
    }

    const s = getSettings();
    const task = {
      ref,
      kind: pick.kind || "dsa",
      title: pick.title,
      pattern: pick.pattern,
      difficulty: pick.difficulty,
      minutes: 40,
      sheet: pick.sheet,
      rowIndex: pick.rowIndex,
      wildcard: true,
    };
    task.value = priceTask(task, s);

    await updateDayLog(dl => {
      const d = dl[dateKey];
      if (!d) return;
      if (d.assigned.some(t => t.ref === ref)) return;
      d.assigned.push(task);
      d.values[ref] = task.value;
    });
  } catch (e) {
    console.warn("[wildcard] inject failed", e);
  }
}

function inferKindFromSheetName(sheetName) {
  const s = String(sheetName).toLowerCase();
  if (/dsa/.test(s)) return "dsa";
  if (/sql/.test(s)) return "sql";
  if (/system.?design/.test(s)) return "sd";
  if (/integration/.test(s)) return "int";
  if (/extra|interview/.test(s)) return "ext";
  if (/\bos\b|network/.test(s)) return "os";
  return "dsa";
}

// --- Confidence capture ---------------------------------------------------
// Confidence (1-5) drives spaced repetition, heatmaps, pace forecast and the
// end-of-day recap. Stored in two places so both views are authoritative:
//   dayLog[date].confidence[ref] = N   (per-tick, per-day timeline)
//   sheet.rows[rowIndex].Confidence = N (per-problem, current state)
export async function setConfidence(dateKey, ref, rating) {
  const r = Math.max(1, Math.min(5, Number(rating) || 3));
  const { updateDayLog, getSheets, updateSheetRow } = await import("./store.js");
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    d.confidence = d.confidence || {};
    d.confidence[ref] = r;
  });
  const task = (getDayLog()[dateKey]?.assigned || []).find(t => t.ref === ref);
  if (task && task.sheet && task.rowIndex != null) {
    const sheet = getSheets()[task.sheet];
    const confCol = sheet?.headers.find(h => /^confidence$/i.test(h));
    if (confCol) await updateSheetRow(task.sheet, task.rowIndex, { [confCol]: String(r) });
  }
  return r;
}

export function getConfidence(dateKey, ref) {
  const day = getDayLog()[dateKey];
  return day?.confidence?.[ref];
}

// --- Review override: user's explicit "when to see this again" choice --
// Note: "default" is stored as an explicit value (not deleted) so the UI knows
// the user has acknowledged the prompt. The engine treats "default" the same
// as missing — falls back to the ★ rating's schedule.
export async function setReviewOverride(dateKey, ref, choice) {
  const valid = ["default", "tomorrow", "in3days", "mastered", "reset"];
  if (!valid.includes(choice)) return;
  const { updateDayLog } = await import("./store.js");
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    d.reviewOverride = d.reviewOverride || {};
    if (choice === "reset") delete d.reviewOverride[ref];
    else d.reviewOverride[ref] = choice;
  });
}

export function getReviewOverride(dateKey, ref) {
  const day = getDayLog()[dateKey];
  return day?.reviewOverride?.[ref];
}

// --- Spaced-repetition queue ---------------------------------------------
// Interval schedule — lower confidence returns sooner. Confidence 4/5 skips.
// Returns the base-interval (days) for FIRST revisit after a solve.
const REVISIT_INTERVAL_DAYS = { 1: 1, 2: 3, 3: 7, 4: -1, 5: -1 };

// Explicit review override — the user can override spaced-rep by clicking a
// chip after rating ("Tomorrow" / "In 3 days" / "Never — mastered"). Default
// means use rating-based schedule above.
export const REVIEW_OVERRIDE_DAYS = {
  tomorrow: 1,
  in3days: 3,
  mastered: -1,
  // "default" => no override, falls back to REVISIT_INTERVAL_DAYS[rating]
};

// Scan every past dayLog entry, newest-first, and surface sheet-linked solves
// whose next-due date is on or before `dateKey`. Only one entry per sheet row
// (the most recent) — so re-solving a row re-schedules it.
// Guarantees AT LEAST ONE revisit per day: if no low-confidence items are due,
// picks the weakest-confidence previously-solved row (or least recently solved)
// so the user always gets one REDO to lock memory in.
export function getDueRevisits(dateKey) {
  const dayLog = getDayLog();
  const target = parseKey(dateKey);
  if (!target) return [];
  const dates = Object.keys(dayLog).sort().reverse();  // newest first

  // Pass 1 — collect ALL most-recent-solve records per sheet row (for scoring + fallback).
  const latestSolve = new Map();  // sheetKey → { task, date, conf, dueOn }
  for (const d of dates) {
    if (d >= dateKey) continue;
    const entry = dayLog[d];
    if (!entry || !Array.isArray(entry.assigned) || !Array.isArray(entry.done)) continue;
    for (const task of entry.assigned) {
      if (!task.sheet || task.rowIndex == null) continue;
      if (!entry.done.includes(task.ref)) continue;
      const key = `${task.sheet}#${task.rowIndex}`;
      if (latestSolve.has(key)) continue;  // already saw a newer solve
      const conf = entry.confidence?.[task.ref] ?? 3;
      const override = entry.reviewOverride?.[task.ref];
      const base = (override && REVIEW_OVERRIDE_DAYS[override] !== undefined)
        ? REVIEW_OVERRIDE_DAYS[override]
        : REVISIT_INTERVAL_DAYS[conf];
      let dueOn = null;
      if (base && base > 0) {
        dueOn = parseKey(d);
        if (dueOn) dueOn.setUTCDate(dueOn.getUTCDate() + base);
      }
      latestSolve.set(key, { task, date: d, conf, dueOn });
    }
  }

  // Pass 2 — split into "actually due" vs "fallback candidates" (not yet due or high-conf).
  const dueNow = [];
  const laterCandidates = [];
  for (const rec of latestSolve.values()) {
    if (rec.dueOn && rec.dueOn <= target) dueNow.push(rec);
    else laterCandidates.push(rec);
  }

  // Rank "actually due" by lowest confidence then oldest solve (urgent first).
  dueNow.sort((a, b) => a.conf - b.conf || a.date.localeCompare(b.date));

  // Cap at 3 revisits/day so the plan doesn't bloat.
  let picks = dueNow.slice(0, 3);

  // GUARANTEE: if nothing's due, promote one fallback — the weakest-conf
  // (or oldest-solved) row the user has already done. If the user has never
  // solved anything, we return empty (nothing to revisit yet).
  if (!picks.length && laterCandidates.length) {
    laterCandidates.sort((a, b) => a.conf - b.conf || a.date.localeCompare(b.date));
    picks = [laterCandidates[0]];
  }

  return picks.map(({ task, date, conf }) => ({
    ref: `REV-${task.sheet}-${task.rowIndex}-${dateKey}`,
    kind: "revisit",
    title: task.title,
    pattern: task.pattern || "",
    sheet: task.sheet,
    rowIndex: task.rowIndex,
    minutes: 15,
    originalConfidence: conf,
    originalDate: date,
    isGuaranteed: dueNow.length === 0  // signal for UI label
  }));
}

function parseKey(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function buildPlan(dateKey) {
  const s = getSettings();
  const sheets = getSheets();
  const dsa = sheets["DSA"] || { headers: [], rows: [] };
  const sd  = sheets["System Design"] || { headers: [], rows: [] };
  const int = sheets["Integrations"] || { headers: [], rows: [] };
  const ext = sheets["Interview Extras"] || { headers: [], rows: [] };
  const d = new Date(dateKey);
  const dn = dayName(d);
  const isWeekend = dn === "Sat" || dn === "Sun";

  const plan = [];

  // --- Due revisits (spaced repetition) — always run first ---
  // Low-confidence past solves whose next-due date <= today. Price-boosted
  // slightly below a new DSA problem (shorter, less novel but valuable).
  const revisits = getDueRevisits(dateKey);
  for (const r of revisits) plan.push(r);

  // --- Weekday: core DSA ---
  if (!isWeekend) {
    const n = s.schedule.newDsaPerWeekday || 1;
    const picks = pickNextDsa(dsa, n);
    for (const p of picks) {
      plan.push({
        ref: `DSA#${p.Seq}`,
        kind: "dsa",
        title: p.Problem,
        pattern: p.Pattern,
        difficulty: p.Difficulty,
        freq: p.Freq,
        minutes: estimateMinutes(p.Difficulty),
        sheet: "DSA",
        rowIndex: p._idx,
        lc: p["LC#"]
      });
    }
    // Revise 2 past patterns
    plan.push({
      ref: `REV-${dateKey}`,
      kind: "revision",
      title: "Revise 2 past patterns",
      sheet: null,
      minutes: 10
    });
    // Log result + confidence
    plan.push({
      ref: `LOG-${dateKey}`,
      kind: "log",
      title: "Log result + confidence",
      sheet: null,
      minutes: 5
    });

    // SD / INT on configured days
    const addDays = s.schedule.sdIntDays || [];
    if (addDays.includes(dn)) {
      const sdPick = pickNext(sd, "Status", ["TODO"]);
      if (sdPick) {
        plan.push({
          ref: `SD#${sdPick.Seq}`,
          kind: "sd",
          title: sdPick.Topic || sdPick["Topic/Skill"] || sdPick.Skill,
          pattern: sdPick.Category,
          minutes: 25,
          sheet: "System Design",
          rowIndex: sdPick._idx
        });
      } else {
        const intPick = pickNext(int, "Status", ["TODO"]);
        if (intPick) {
          plan.push({
            ref: `INT#${intPick.Seq}`,
            kind: "int",
            title: intPick["Skill or Platform"] || intPick.Skill || intPick.Topic,
            pattern: intPick.Category,
            minutes: 25,
            sheet: "Integrations",
            rowIndex: intPick._idx
          });
        }
      }
    }
  } else if (dn === "Sat") {
    // Weekend lever: anything marked REVIEW (user set it in Library) comes back here.
    // No "AGAIN" button anymore — REVIEW status alone drives this.
    const reviews = dsa.rows
      .map((r, i) => ({ ...r, _idx: i }))
      .filter(r => /^review$/i.test(String(r.Status || "")))
      .slice(0, 5);
    for (const r of reviews) {
      plan.push({
        ref: `DSA#${r.Seq}`, kind: "dsa", title: r.Problem, pattern: r.Pattern,
        difficulty: r.Difficulty, freq: r.Freq, minutes: estimateMinutes(r.Difficulty),
        sheet: "DSA", rowIndex: r._idx, lc: r["LC#"]
      });
    }
    if (!plan.length) {
      // Nothing in REVIEW — serve 2 new HIGH-freq problems so Saturday still produces work
      const fresh = pickNextDsa(dsa, 2);
      for (const p of fresh) {
        plan.push({
          ref: `DSA#${p.Seq}`, kind: "dsa", title: p.Problem, pattern: p.Pattern,
          difficulty: p.Difficulty, freq: p.Freq, minutes: estimateMinutes(p.Difficulty),
          sheet: "DSA", rowIndex: p._idx, lc: p["LC#"]
        });
      }
      plan.push({ ref: `REV-${dateKey}`, kind: "revision", title: "Preview next week's patterns", minutes: 10 });
    }
  } else { // Sunday — REVIEW items get second pass + capstone
    const reviews = dsa.rows
      .map((r, i) => ({ ...r, _idx: i }))
      .filter(r => /^review$/i.test(String(r.Status || "")))
      .slice(0, 3);
    for (const r of reviews) {
      plan.push({
        ref: `DSA#${r.Seq}`, kind: "dsa", title: r.Problem, pattern: r.Pattern,
        difficulty: r.Difficulty, freq: r.Freq, minutes: estimateMinutes(r.Difficulty),
        sheet: "DSA", rowIndex: r._idx, lc: r["LC#"]
      });
    }
    plan.push({ ref: `CASE-${dateKey}`, kind: "sd", title: "One system-design case study", minutes: 45 });
    plan.push({ ref: `WRC-${dateKey}`,  kind: "log", title: "Weekly report card", minutes: 10 });
  }

  // Weekend: one soft-skills / mock / resume slot from Extras.
  // Saturday prefers Behavioral + Decomposition + Learning + Communication.
  // Sunday prefers Mock + Take-home + Resume + Negotiation + Domain.
  if (isWeekend && ext.rows.length) {
    const satBuckets = ["Behavioral", "Decomposition", "Learning round", "Communication"];
    const sunBuckets = ["Mock", "Take-home", "Resume", "Negotiation", "Domain", "SQL"];
    const buckets = dn === "Sat" ? satBuckets : sunBuckets;
    const extPick = pickNextExt(ext, buckets);
    if (extPick) {
      const mins = /mock/i.test(extPick.Category) ? 45
                 : /take-home|resume/i.test(extPick.Category) ? 45
                 : 25;
      plan.push({
        ref: `EXT#${extPick.Seq}`,
        kind: "ext",
        title: extPick.Item,
        pattern: extPick.Category,
        minutes: mins,
        sheet: "Interview Extras",
        rowIndex: extPick._idx
      });
    }
  }

  // Price each task via settings range.
  for (const t of plan) t.value = priceTask(t, s);

  // Hard cap — never serve more than Settings allows (no self-ripoff).
  const cap = Math.max(1, Number(s.schedule.maxTasksPerDay) || 5);
  return plan.slice(0, cap);
}

function estimateMinutes(difficulty = "") {
  const d = difficulty.toLowerCase();
  if (d === "easy") return 25;
  if (d === "medium") return 40;
  if (d === "hard") return 55;
  return 30;
}

function pickNextDsa(dsa, n) {
  const todo = dsa.rows
    .map((r, i) => ({ ...r, _idx: i }))
    .filter(r => /^(todo|again)$/i.test(r.Status || "TODO"))
    .sort((a, b) => {
      // HIGH first, then by Seq
      const rank = f => (f === "HIGH" ? 0 : f === "MED" ? 1 : 2);
      const r = rank(a.Freq) - rank(b.Freq);
      if (r) return r;
      return Number(a.Seq) - Number(b.Seq);
    });
  return todo.slice(0, n);
}

function pickNext(sheet, statusCol, allowed) {
  if (!sheet.rows.length) return null;
  const rows = sheet.rows.map((r, i) => ({ ...r, _idx: i }));
  const match = rows.find(r => allowed.includes((r[statusCol] || "TODO").toUpperCase()));
  return match || rows[0];
}

// Interview Extras picker — prefer open items in the given categories, highest priority first.
function pickNextExt(ext, categoryBuckets) {
  if (!ext.rows.length) return null;
  const rows = ext.rows.map((r, i) => ({ ...r, _idx: i }));
  const open = rows.filter(r => /^(todo|again|review)$/i.test(r.Status || "TODO"));
  const inBuckets = open.filter(r => categoryBuckets.some(c => (r.Category || "").toLowerCase() === c.toLowerCase()));
  const pool = inBuckets.length ? inBuckets : open;
  if (!pool.length) return null;
  // P1 first, then by Seq (keeps the sheet's authorial order)
  pool.sort((a, b) => {
    const pri = (String(a.Priority) === "P1" ? 0 : 1) - (String(b.Priority) === "P1" ? 0 : 1);
    if (pri) return pri;
    return Number(a.Seq) - Number(b.Seq);
  });
  return pool[0];
}

// --- Tick / untick ---
export async function tickTask(dateKey, ref) {
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    if (!d.done.includes(ref)) {
      d.done.push(ref);
      d.dayEarned += d.values[ref] || 0;
    }
    d.green = allDone(d);
  });
}

export async function untickTask(dateKey, ref) {
  await updateDayLog(dl => {
    const d = dl[dateKey];
    if (!d) return;
    const i = d.done.indexOf(ref);
    if (i >= 0) {
      d.done.splice(i, 1);
      d.dayEarned = Math.max(0, d.dayEarned - (d.values[ref] || 0));
    }
    d.green = allDone(d);
  });
}

function allDone(day) {
  return day.assigned && day.assigned.length > 0 && day.assigned.every(t => day.done.includes(t.ref));
}

// --- Daily earning cap (Phase 7) -----------------------------------------
// Returns {amount, capped, originalAmount} — cap the value a task can bank today.
// Reads today's "task" ledger entries and clamps so the sum never exceeds the cap.
export function capTaskValue(wallet, settings, taskValue, dateKey) {
  const cap = Number(settings?.wallet?.dailyEarningCap || 0);
  if (!cap) return { amount: taskValue, capped: false };
  const key = dateKey || calendarKey();
  const alreadyEarned = (wallet?.ledger || [])
    .filter(e => e.type === "task" && new Date(e.date).toISOString().slice(0, 10) === key)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const remaining = Math.max(0, cap - alreadyEarned);
  if (remaining >= taskValue) return { amount: taskValue, capped: false };
  return { amount: remaining, capped: true, originalAmount: taskValue };
}

// --- Perfect-week bonus (9D) ---------------------------------------------
// Counts consecutive green/frozen days ending with `dateKey`. If count >= N
// and count % N === 0 and this milestone hasn't been awarded, returns the bonus.
export function maybeFirePerfectWeek(dayLog, dateKey, settings) {
  const bonus = Number(settings?.wallet?.perfectWeekBonus || 0);
  const days = Number(settings?.wallet?.perfectWeekDays || 5);
  if (bonus <= 0 || days < 2) return null;
  if (dayLog[dateKey]?.perfectWeekAwarded) return null;
  const cursor = new Date(dateKey + "T12:00:00");
  let count = 0;
  for (let i = 0; i < 365; i++) {
    const key = calendarKey(cursor);
    const d = dayLog[key];
    if (!d?.assigned?.length) break;
    if (!(d.green || d.frozen)) break;
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  if (count < days || count % days !== 0) return null;
  return { bonus, count };
}

// --- streak (greenDay chain ending today; 0-task days don't break) ---
// Frozen days (protected by a Streak Freeze token) count as green for the chain.
export function computeStreak(dayLog = getDayLog(), today = new Date()) {
  let streak = 0;
  const cursor = new Date(today);
  for (let i = 0; i < 365 * 3; i++) {
    const key = calendarKey(cursor);
    const d = dayLog[key];
    if (!d || !d.assigned || !d.assigned.length) {
      // 0-task day → neutral, don't break
    } else if (d.green || d.frozen) {
      streak++;
    } else {
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// --- longest streak over the dayLog ---
export function longestStreak(dayLog = getDayLog()) {
  const keys = Object.keys(dayLog).sort();
  let best = 0, cur = 0;
  for (const k of keys) {
    const d = dayLog[k];
    if (!d.assigned || !d.assigned.length) continue;
    if (d.green) { cur++; best = Math.max(best, cur); }
    else cur = 0;
  }
  return best;
}

// --- week / month green check (zero-task days don't count against it) ---
function daysInWeekOf(ref) {
  const d = new Date(ref);
  const day = d.getDay();
  // ISO-ish: week starts Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  const keys = [];
  for (let i = 0; i < 7; i++) {
    const t = new Date(monday); t.setDate(monday.getDate() + i);
    keys.push(calendarKey(t));
  }
  return keys;
}
function daysInMonthOf(ref) {
  const d = new Date(ref);
  const year = d.getFullYear(); const month = d.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  const keys = [];
  for (let i = 1; i <= last; i++) keys.push(calendarKey(new Date(year, month, i)));
  return keys;
}

// A week counts as "green" ONLY when today is the final task-day of that week AND every
// prior task-day of the same week was green. This prevents the Monday-finish from
// erroneously triggering the week/month celebration before the week/month is actually over.
export function isGreenWeek(ref = new Date(), dayLog = getDayLog()) {
  const keys = daysInWeekOf(ref);
  const todayStr = todayKey();
  const upTo = keys.filter(k => k <= todayStr);
  const taskDays = upTo.filter(k => dayLog[k]?.assigned?.length);
  if (!taskDays.length) return false;

  // Must have at least 2 task-days in this week (otherwise it's just a single day secured)
  if (taskDays.length < 2) return false;

  // Today must be the LATEST task-day in the current week — i.e. nothing after today
  // in this week has a plan yet, AND the user has no remaining future task-day to run.
  const lastTaskDay = taskDays[taskDays.length - 1];
  if (lastTaskDay !== todayStr) return false;

  // Every task-day up to and including today must be green
  if (!taskDays.every(k => dayLog[k].green)) return false;

  // One final guard: don't fire mid-week — require today be Sat or Sun, OR all 5 weekday
  // slots (Mon-Fri) to be done. This matches "weekend review" / "plan complete" semantics.
  const todayDay = new Date(todayStr + "T00:00:00").getDay(); // 0=Sun..6=Sat
  if (todayDay === 0 || todayDay === 6) return true;
  const weekdayKeys = keys.slice(0, 5);   // Mon-Fri
  return weekdayKeys.every(k => dayLog[k]?.green);
}

export function isGreenMonth(ref = new Date(), dayLog = getDayLog()) {
  const keys = daysInMonthOf(ref);
  const todayStr = todayKey();
  const upTo = keys.filter(k => k <= todayStr);
  const taskDays = upTo.filter(k => dayLog[k]?.assigned?.length);
  if (!taskDays.length) return false;

  // Must have at least 10 task-days this month (so a tiny week doesn't count as a month)
  if (taskDays.length < 10) return false;

  // Today must be the LAST day of the month, OR the last task-day of the month.
  const d = new Date(todayStr + "T00:00:00");
  const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  if (d.getDate() !== lastDayOfMonth) return false;

  return taskDays.every(k => dayLog[k].green);
}

// Only fire week/month celebration ONCE per week/month — track in dayLog meta.
export async function markWeekFired(ref = new Date()) {
  const key = `__week:${weekTag(ref)}`;
  await updateDayLog(dl => { dl[key] = true; });
}
export async function markMonthFired(ref = new Date()) {
  const key = `__month:${monthTag(ref)}`;
  await updateDayLog(dl => { dl[key] = true; });
}
export function wasWeekFired(ref = new Date(), dayLog = getDayLog()) {
  return !!dayLog[`__week:${weekTag(ref)}`];
}
export function wasMonthFired(ref = new Date(), dayLog = getDayLog()) {
  return !!dayLog[`__month:${monthTag(ref)}`];
}
function weekTag(d) {
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return calendarKey(monday);
}
function monthTag(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
