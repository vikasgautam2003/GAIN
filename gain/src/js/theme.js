// Theme controller — single source of truth for light/dark/system mode.
// Reads/writes settings.appearance.theme. Sets data-theme="dark" on <html>.
// Listens for prefers-color-scheme changes when mode is "system".

import { getSettings, updateSettings, on } from "./store.js";

let mql = null;
let mqlHandler = null;

export function initTheme() {
  apply(getCurrentMode());
  // React to settings changes (user picks a different mode in Settings)
  on((ev) => {
    if (ev === "settings" || ev === "boot") {
      apply(getCurrentMode());
    }
  });
}

export function getCurrentMode() {
  const s = getSettings();
  return s?.appearance?.theme || "system";
}

// mode: "system" | "light" | "dark"
export async function setTheme(mode) {
  await updateSettings(st => {
    if (!st.appearance) st.appearance = {};
    st.appearance.theme = mode;
  });
  // apply() will also fire via the on("settings") hook, but call directly for instant feedback
  apply(mode);
}

function apply(mode) {
  const html = document.documentElement;
  // Clean up any prior OS-pref listener
  if (mql && mqlHandler) {
    try { mql.removeEventListener("change", mqlHandler); } catch (_) {}
    mql = null; mqlHandler = null;
  }
  let effective = mode;
  if (mode === "system") {
    mql = window.matchMedia("(prefers-color-scheme: dark)");
    effective = mql.matches ? "dark" : "light";
    mqlHandler = (e) => {
      // Only react if the user still has "system" selected
      if (getCurrentMode() === "system") {
        html.setAttribute("data-theme", e.matches ? "dark" : "light");
      }
    };
    try { mql.addEventListener("change", mqlHandler); } catch (_) {}
  }
  html.setAttribute("data-theme", effective);
}

// Convenience export for views that want to render the current effective theme
export function effectiveTheme() {
  const mode = getCurrentMode();
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}
