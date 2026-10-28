// Weekly test scheduler. On boot, if a weekend hasn't yet been scheduled this
// ISO week, pick either Sat or Sun at random, write a bookmark into settings
// so we don't re-schedule for the same week, and inject a "⚡ WEEKLY TEST"
// task into that day's plan. The task opens the Tests page when ticked /
// opened; starting the test runs the normal paper flow with isWeekly=true
// so the scorecard knows it's the big bounty.

import { getSettings, updateSettings, getDayLog, updateDayLog } from "./store.js";
import { isoWeekKey } from "./testGrading.js";

const WEEKLY_REF_PREFIX = "WEEKLY-TEST-";

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pickRandomWeekendInWeek(baseDate) {
  // ISO Monday is day index 1. We want this week's Sat (idx 6) or Sun (idx 0 of NEXT week → actually idx 7).
  const d = new Date(baseDate);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();   // 0 = Sun, 1 = Mon, ...
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMon);
  const sat = new Date(monday); sat.setDate(monday.getDate() + 5);
  const sun = new Date(monday); sun.setDate(monday.getDate() + 6);
  return Math.random() < 0.5 ? sat : sun;
}

// Called on boot. Idempotent per ISO week. Non-blocking, catches own errors.
export async function maybeScheduleWeeklyTest() {
  try {
    const settings = getSettings();
    const enabled = settings?.schedule?.tests?.weeklyEnabled !== false;
    if (!enabled) return;

    const nowWeek = isoWeekKey(new Date());
    const lastScheduled = settings?.schedule?.tests?.lastScheduledWeek || "";
    if (lastScheduled === nowWeek) return;  // already placed one for this week

    // Pick a random weekend day in the current ISO week
    const target = pickRandomWeekendInWeek(new Date());
    const dk = dateKey(target);

    // If the target day is in the past (we're past Sun), skip this week.
    const todayDK = dateKey(new Date());
    if (dk < todayDK) {
      await updateSettings(st => {
        if (!st.schedule.tests) st.schedule.tests = {};
        st.schedule.tests.lastScheduledWeek = nowWeek;
      });
      return;
    }

    // Build the WEEKLY TEST task and inject it into the day log for that day.
    const ref = `${WEEKLY_REF_PREFIX}${dk}`;
    await updateDayLog(dl => {
      if (!dl[dk]) {
        dl[dk] = { assigned: [], done: [], values: {}, confidence: {}, green: false, dayEarned: 0 };
      }
      const d = dl[dk];
      // No duplicate injection
      if (d.assigned.some(t => t.ref === ref || t.weeklyTest)) return;
      const bountyMultiplier = Number(getSettings()?.schedule?.tests?.bountyMultiplier) || 1;
      const estBounty = Math.round(300 * bountyMultiplier);  // best-case rough estimate; actual banked at submit
      d.assigned.unshift({
        ref,
        kind: "weekly-test",
        title: "Weekly test — Groq-generated paper",
        pattern: "Weekly",
        difficulty: "Mixed",
        minutes: 60,
        value: 0,     // bounty actually banked by finalizeAttempt
        weeklyTest: true,
        estBounty,
      });
      d.values[ref] = 0;
    });

    await updateSettings(st => {
      if (!st.schedule.tests) st.schedule.tests = {};
      st.schedule.tests.lastScheduledWeek = nowWeek;
      st.schedule.tests.lastScheduledFor = dk;
    });
  } catch (err) {
    console.warn("[tests] weekly schedule failed", err);
  }
}

// Clean up any weekly-test tasks that have been sitting in the plan past their
// scheduled day (if the user ignored them). Non-destructive — just removes
// the row so the day doesn't carry the stale task forever.
export async function pruneStaleWeeklyTests() {
  const dl = getDayLog();
  const now = Date.now();
  await updateDayLog(dlog => {
    for (const [d, entry] of Object.entries(dlog)) {
      if (!entry?.assigned) continue;
      // Keep tasks for the current week — only prune if the day is >9 days old.
      const ageDays = (() => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
        if (!m) return 999;
        const dateMs = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
        return Math.floor((now - dateMs) / 86400000);
      })();
      if (ageDays <= 9) continue;
      const before = entry.assigned.length;
      entry.assigned = entry.assigned.filter(t => !t.weeklyTest || t.ref && entry.done?.includes(t.ref));
      if (entry.assigned.length !== before && entry.values) {
        const kept = new Set(entry.assigned.map(t => t.ref));
        for (const k of Object.keys(entry.values)) if (!kept.has(k)) delete entry.values[k];
      }
    }
  });
}
