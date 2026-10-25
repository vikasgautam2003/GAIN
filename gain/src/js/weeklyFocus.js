// Pattern-of-the-week — curated list of indispensable patterns the app
// rotates through. On Monday morning (first boot of the week) the engine
// advances to the next entry unless the user has set an explicit override.
// Suggest + Warmup bias their picks toward this pattern.
//
// All state lives inside settings.schedule.weeklyFocus so it participates
// in the normal backup/restore pipeline.

import { getSettings, updateSettings } from "./store.js";

// Monday of the ISO week containing `d`, as a yyyy-mm-dd string.
function mondayOf(d) {
  const dt = new Date(d);
  const day = dt.getUTCDay();          // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diff);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Get the current week's focus pattern. Advances the rotation if the stored
// week-start is older than this Monday. Returns null if no patterns are set.
export async function getCurrentFocus() {
  const s = getSettings();
  const wf = s?.schedule?.weeklyFocus;
  if (!wf || !Array.isArray(wf.patterns) || !wf.patterns.length) return null;

  // Explicit override wins
  if (wf.current && wf.patterns.includes(wf.current)) return wf.current;

  const thisMon = mondayOf(new Date());
  if (wf.startedAt === thisMon) {
    return wf.patterns[wf.rotationIdx % wf.patterns.length];
  }

  // Advance rotation and persist
  const nextIdx = (wf.rotationIdx + 1) % wf.patterns.length;
  await updateSettings(st => {
    st.schedule.weeklyFocus.rotationIdx = nextIdx;
    st.schedule.weeklyFocus.startedAt = thisMon;
    st.schedule.weeklyFocus.current = "";    // clear override on week change
  });
  return wf.patterns[nextIdx];
}

// User explicitly picks a pattern for this week (overrides rotation).
export async function setFocusOverride(patternName) {
  await updateSettings(st => {
    if (!st.schedule.weeklyFocus) return;
    st.schedule.weeklyFocus.current = patternName || "";
    if (patternName) st.schedule.weeklyFocus.startedAt = mondayOf(new Date());
  });
}

export function listFocusPatterns() {
  const s = getSettings();
  return s?.schedule?.weeklyFocus?.patterns || [];
}

export async function updateFocusPatterns(list) {
  await updateSettings(st => {
    if (!st.schedule.weeklyFocus) return;
    st.schedule.weeklyFocus.patterns = Array.isArray(list) ? list.filter(x => x && String(x).trim()) : [];
  });
}
