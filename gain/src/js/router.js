// Hash router. Each screen module exports { mount(root, params) } and optional { unmount() }.

const routes = {};
let current = null;
let currentName = null;

export function register(name, mod) { routes[name] = mod; }

function parse(hash) {
  const h = (hash || location.hash || "#today").replace(/^#/, "");
  const [name, ...rest] = h.split("/");
  return { name, rest };
}

export async function go(hash) {
  const { name, rest } = parse(hash);

  // In-page anchors (not a registered route) → scroll to element, don't re-mount
  if (!routes[name]) {
    const el = document.getElementById(name);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // unknown route → fall through to today
  }

  const route = routes[name] || routes.today;
  const resolvedName = routes[name] ? name : "today";

  // If re-navigating to the same route (e.g. #today → #today), skip remount
  if (resolvedName === currentName && current === route) return;

  const root = document.getElementById("view");
  if (current && current.unmount) try { current.unmount(); } catch (e) { console.error(e); }
  root.innerHTML = "";
  document.querySelectorAll("#nav a").forEach(a => {
    a.classList.toggle("active", a.dataset.route === resolvedName);
  });

  try {
    current = route;
    currentName = resolvedName;
    await route.mount(root, rest);
  } catch (e) {
    console.error("route mount failed", resolvedName, e);
    root.innerHTML = `<div class="view-inner"><div class="card"><h2>Routing error</h2><pre>${String(e)}</pre></div></div>`;
  }
}

window.addEventListener("hashchange", () => go(location.hash));
