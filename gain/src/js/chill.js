// The Hideout — Netflix-shape layout, edge-to-edge, premium.
// Theme switcher in the hero lets the user preview 4 lounge aesthetics live:
//   • London club library (oxblood + brass, serif display)
//   • Tokyo whisky bar (black lacquer + warm amber, hairline serif)
//   • Lisbon wine cellar (stone cream + burgundy, candlelit serif)
//   • New Orleans speakeasy (forest green + antique gold, theatrical serif)
// Chosen theme persists via settings.hideoutTheme.

import {
  getRecreations, addRecreation, updateRecreation, deleteRecreation,
  openRecreation, fetchUrlPreview, getSettings, updateSettings, on,
} from "./store.js";

const BROWSERS = [
  { key: "",              label: "System default" },
  { key: "Brave Browser", label: "Brave" },
  { key: "Google Chrome", label: "Chrome" },
  { key: "Safari",        label: "Safari" },
  { key: "Firefox",       label: "Firefox" },
  { key: "Arc",           label: "Arc" },
];

const CATEGORIES = {
  youtube:   { label: "Video" },
  twitch:    { label: "Live"  },
  reddit:    { label: "Reads" },
  x:         { label: "Feeds" },
  music:     { label: "Music" },
  instagram: { label: "Social"},
  reading:   { label: "Longform" },
  web:       { label: "Web"   },
};

const THEMES = ["london", "tokyo", "lisbon", "neworleans"];
const THEME_LABELS = {
  london: "London Club",
  tokyo: "Tokyo Whisky",
  lisbon: "Lisbon Cellar",
  neworleans: "N.O. Speakeasy",
};

function inferCategory(url) {
  const h = String(url || "").toLowerCase();
  if (/youtube\.com|youtu\.be/.test(h)) return "youtube";
  if (/twitch\.tv/.test(h)) return "twitch";
  if (/reddit\.com/.test(h)) return "reddit";
  if (/twitter\.com|x\.com/.test(h)) return "x";
  if (/spotify\.com|soundcloud\.com|music\.apple|bandcamp|mixcloud/.test(h)) return "music";
  if (/instagram\.com/.test(h)) return "instagram";
  if (/medium\.com|substack\.com|dev\.to|hackernoon|nytimes|theverge/.test(h)) return "reading";
  return "web";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

function hostOf(u) { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } }

let unsub = null;

export default {
  async mount(root) {
    injectFonts();
    injectStyles();
    root.innerHTML = render();
    paint(root);
    wire(root);
    if (unsub) unsub();
    unsub = on((ev) => { if (ev === "recreations" || ev === "settings") paint(root); });
    // Edge-to-edge: strip the view container's padding while mounted
    const view = document.getElementById("view");
    if (view) { view.classList.add("hideout-active"); }
  },
  unmount() {
    if (unsub) { unsub(); unsub = null; }
    const view = document.getElementById("view");
    if (view) view.classList.remove("hideout-active");
  },
};

// ============ RENDER ============
function render() {
  return `
    <div class="hideout" id="hideout-root">
      <!-- Hero: full-bleed cinematic cover -->
      <section class="hd-hero">
        <div class="hd-hero-grad"></div>
        <div class="hd-hero-vignette"></div>
        <div class="hd-hero-inner">
          <div class="hd-eyebrow">THE HIDEOUT</div>
          <h1 class="hd-title">After hours.</h1>
          <p class="hd-sub">Your private set. Open a track, come back when you're ready.</p>
          <div class="hd-actions">
            <button class="hd-cta" id="chill-add">
              <span>+</span><span>Add a track</span>
            </button>
            <label class="hd-pref">
              <span class="hd-pref-k">Browser</span>
              <select id="chill-browser-global" class="hd-pref-sel">
                ${BROWSERS.map(b => `<option value="${esc(b.key)}">${esc(b.label)}</option>`).join("")}
              </select>
            </label>
          </div>
        </div>

        <!-- Theme switcher dock: bottom-right of hero -->
        <div class="hd-themes" id="hd-themes" title="Preview lounge styles">
          ${THEMES.map(t => `<button class="hd-theme-chip" data-theme="${t}">${esc(THEME_LABELS[t])}</button>`).join("")}
        </div>
      </section>

      <!-- Content below the fold -->
      <main class="hd-main">
        <!-- Pinned row -->
        <section class="hd-row" id="hd-row-pinned" hidden>
          <header class="hd-row-head">
            <h2 class="hd-row-title">Headliners</h2>
            <span class="hd-row-rule"></span>
          </header>
          <div class="hd-row-scroll" data-row="pinned"></div>
        </section>

        <!-- All tracks row -->
        <section class="hd-row" id="hd-row-all" hidden>
          <header class="hd-row-head">
            <h2 class="hd-row-title">The set list</h2>
            <span class="hd-row-rule"></span>
          </header>
          <div class="hd-row-scroll" data-row="all"></div>
        </section>

        <!-- Per-category rows injected here -->
        <div id="hd-cat-rows"></div>

        <!-- Empty state -->
        <section class="hd-empty" id="hd-empty" hidden>
          <h2>The room is empty.</h2>
          <p>Drop a link below and we'll pour the first drink.</p>
          <button class="hd-cta ghost" id="hd-empty-add"><span>+</span><span>Open the door</span></button>
        </section>
      </main>

      <!-- Add / Edit modal -->
      <div class="hd-scrim" id="hd-scrim" hidden>
        <div class="hd-modal" role="dialog" aria-label="Add track">
          <header class="hd-m-head">
            <div class="hd-m-eyebrow">NEW TRACK</div>
            <button class="hd-m-close" id="hd-m-close" aria-label="Close">×</button>
          </header>
          <div class="hd-m-body">
            <label class="hd-m-field">
              <span class="hd-m-k">Link</span>
              <input id="chill-url" type="url" placeholder="paste any https:// link" autocomplete="off" spellcheck="false" />
            </label>
            <div class="hd-m-preview" id="hd-m-preview" hidden>
              <div class="hd-m-thumb-wrap">
                <img id="hd-m-preview-img" alt="" />
              </div>
              <div class="hd-m-meta">
                <div class="hd-m-ptitle" id="hd-m-preview-title">—</div>
                <div class="hd-m-phost" id="hd-m-preview-host">—</div>
              </div>
            </div>
            <label class="hd-m-field">
              <span class="hd-m-k">Title</span>
              <input id="chill-title" type="text" />
            </label>
            <label class="hd-m-field">
              <span class="hd-m-k">Note <small>optional</small></span>
              <input id="chill-note" type="text" maxlength="120" placeholder="why you come here" />
            </label>
            <div class="hd-m-two">
              <label class="hd-m-field">
                <span class="hd-m-k">Category</span>
                <select id="chill-category">
                  ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("")}
                </select>
              </label>
              <label class="hd-m-field">
                <span class="hd-m-k">Open in</span>
                <select id="chill-browser">
                  ${BROWSERS.map(b => `<option value="${esc(b.key)}">${esc(b.label)}</option>`).join("")}
                </select>
              </label>
            </div>
          </div>
          <footer class="hd-m-foot">
            <button class="hd-m-btn ghost" id="hd-m-cancel">Cancel</button>
            <button class="hd-m-btn primary" id="hd-m-save" disabled>Save</button>
          </footer>
        </div>
      </div>
    </div>
  `;
}

// ============ PAINT ============
function paint(root) {
  const recs = getRecreations();
  const settings = getSettings();
  const theme = settings.hideoutTheme || "london";

  // Apply theme to the root
  const el = root.querySelector("#hideout-root");
  if (el) el.setAttribute("data-theme", theme);
  root.querySelectorAll(".hd-theme-chip").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === theme);
  });

  // Default browser pref
  const globalSel = root.querySelector("#chill-browser-global");
  if (globalSel) globalSel.value = settings.recreationBrowser || "";

  const empty = root.querySelector("#hd-empty");
  const pinnedRow = root.querySelector("#hd-row-pinned");
  const allRow = root.querySelector("#hd-row-all");

  if (!recs.length) {
    if (empty) empty.hidden = false;
    if (pinnedRow) pinnedRow.hidden = true;
    if (allRow) allRow.hidden = true;
    const catWrap = root.querySelector("#hd-cat-rows");
    if (catWrap) catWrap.innerHTML = "";
    return;
  }

  if (empty) empty.hidden = true;

  // Pinned
  const pinned = recs.filter(r => r.pinned).slice(0, 6);
  if (pinnedRow) {
    pinnedRow.hidden = !pinned.length;
    if (pinned.length) {
      const scroll = pinnedRow.querySelector(".hd-row-scroll");
      scroll.innerHTML = pinned.map(r => cardHtml(r)).join("");
    }
  }

  // All (newest + most-played first)
  const sorted = [...recs].sort((a, b) =>
    (b.openedCount || 0) - (a.openedCount || 0) || (b.addedAt || 0) - (a.addedAt || 0)
  );
  if (allRow) {
    allRow.hidden = false;
    allRow.querySelector(".hd-row-scroll").innerHTML = sorted.map(r => cardHtml(r)).join("");
  }

  // Category rows (only categories with ≥ 2 items)
  const catWrap = root.querySelector("#hd-cat-rows");
  if (catWrap) {
    const byCat = {};
    for (const r of recs) {
      const c = r.category || "web";
      (byCat[c] = byCat[c] || []).push(r);
    }
    const html = Object.entries(byCat)
      .filter(([_, items]) => items.length >= 2)
      .map(([cat, items]) => {
        const meta = CATEGORIES[cat] || { label: "Web" };
        return `
          <section class="hd-row">
            <header class="hd-row-head">
              <h2 class="hd-row-title">${esc(meta.label)}</h2>
              <span class="hd-row-rule"></span>
            </header>
            <div class="hd-row-scroll">${items.map(r => cardHtml(r)).join("")}</div>
          </section>
        `;
      }).join("");
    catWrap.innerHTML = html;
  }
}

function cardHtml(r) {
  const host = hostOf(r.url);
  const img = r.imageUrl
    ? `<img class="hd-card-img" src="${esc(r.imageUrl)}" alt="" loading="lazy"
            onerror="this.closest('.hd-card-thumb').classList.add('no-img');this.remove();" />`
    : "";
  return `
    <article class="hd-card" data-id="${esc(r.id)}" tabindex="0">
      <div class="hd-card-thumb ${r.imageUrl ? "" : "no-img"}">
        ${img}
        <div class="hd-card-gradient"></div>
        <div class="hd-card-badge">${esc((CATEGORIES[r.category] || CATEGORIES.web).label)}</div>
        <div class="hd-card-actions">
          <button class="hd-ca-btn" data-act="pin" title="${r.pinned ? "Unpin" : "Pin"}">${r.pinned ? "★" : "☆"}</button>
          <button class="hd-ca-btn" data-act="edit" title="Edit">✎</button>
          <button class="hd-ca-btn" data-act="del" title="Delete">×</button>
        </div>
      </div>
      <div class="hd-card-info">
        <div class="hd-card-title">${esc(r.title || host)}</div>
        <div class="hd-card-sub">${esc(host)}${r.note ? ` · ${esc(r.note)}` : ""}</div>
      </div>
    </article>
  `;
}

// ============ WIRE ============
function wire(root) {
  const scrim = root.querySelector("#hd-scrim");
  const urlEl = root.querySelector("#chill-url");
  const previewEl = root.querySelector("#hd-m-preview");
  const previewImg = root.querySelector("#hd-m-preview-img");
  const previewTitle = root.querySelector("#hd-m-preview-title");
  const previewHost = root.querySelector("#hd-m-preview-host");
  const titleEl = root.querySelector("#chill-title");
  const noteEl = root.querySelector("#chill-note");
  const catEl = root.querySelector("#chill-category");
  const browserEl = root.querySelector("#chill-browser");
  const saveBtn = root.querySelector("#hd-m-save");

  let editingId = null;
  let fetched = { imageUrl: "", title: "" };
  let previewToken = 0;

  const openModal = (rec = null) => {
    editingId = rec?.id || null;
    urlEl.value = rec?.url || "";
    titleEl.value = rec?.title || "";
    noteEl.value = rec?.note || "";
    catEl.value = rec?.category || "web";
    browserEl.value = rec?.browser || "";
    fetched = { imageUrl: rec?.imageUrl || "", title: "" };
    if (rec?.imageUrl) {
      previewEl.hidden = false;
      previewImg.src = rec.imageUrl;
      previewTitle.textContent = rec.title || "";
      previewHost.textContent = hostOf(rec.url);
    } else {
      previewEl.hidden = true;
      previewImg.removeAttribute("src");
    }
    saveBtn.disabled = !urlEl.value.trim();
    scrim.hidden = false;
    setTimeout(() => urlEl.focus(), 20);
  };
  const closeModal = () => { scrim.hidden = true; editingId = null; fetched = { imageUrl: "", title: "" }; };

  root.querySelector("#chill-add")?.addEventListener("click", () => openModal());
  root.querySelector("#hd-empty-add")?.addEventListener("click", () => openModal());
  root.querySelector("#hd-m-close")?.addEventListener("click", closeModal);
  root.querySelector("#hd-m-cancel")?.addEventListener("click", closeModal);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !scrim.hidden) closeModal(); });

  // Preview fetch (debounced)
  let previewTimer = null;
  const fetchPreview = async () => {
    const u = urlEl.value.trim();
    if (!/^https?:\/\//i.test(u)) { previewEl.hidden = true; saveBtn.disabled = true; return; }
    saveBtn.disabled = false;
    previewEl.hidden = false;
    previewImg.removeAttribute("src");
    previewTitle.textContent = "Loading preview…";
    previewHost.textContent = hostOf(u);
    catEl.value = inferCategory(u);
    const token = ++previewToken;
    try {
      const p = await fetchUrlPreview(u);
      if (token !== previewToken) return;
      fetched = { imageUrl: p.imageUrl, title: p.title };
      if (p.imageUrl) previewImg.src = p.imageUrl;
      previewTitle.textContent = p.title || hostOf(u);
      if (!titleEl.value.trim()) titleEl.value = p.title || hostOf(u);
    } catch (_) {
      if (token !== previewToken) return;
      previewTitle.textContent = "Preview unavailable";
    }
  };
  urlEl.addEventListener("input", () => {
    saveBtn.disabled = !urlEl.value.trim();
    clearTimeout(previewTimer); previewTimer = setTimeout(fetchPreview, 400);
  });

  saveBtn.addEventListener("click", async () => {
    const url = urlEl.value.trim(); if (!url) return;
    const payload = {
      url,
      title: titleEl.value.trim() || hostOf(url),
      note: noteEl.value.trim(),
      category: catEl.value,
      browser: browserEl.value,
      imageUrl: fetched.imageUrl || "",
    };
    if (editingId) await updateRecreation(editingId, payload);
    else await addRecreation(payload);
    closeModal();
  });

  // Card interactions (delegated across all rows)
  const handleCard = async (ev) => {
    const actBtn = ev.target.closest?.("[data-act]");
    const card = ev.target.closest?.(".hd-card");
    if (!card) return;
    const id = card.dataset.id;
    const rec = getRecreations().find(r => r.id === id);
    if (!rec) return;
    if (actBtn) {
      ev.stopPropagation();
      const act = actBtn.dataset.act;
      if (act === "pin") {
        const pinnedN = getRecreations().filter(r => r.pinned).length;
        if (!rec.pinned && pinnedN >= 6) return;
        await updateRecreation(id, { pinned: !rec.pinned });
      } else if (act === "edit") openModal(rec);
      else if (act === "del") {
        if (confirm(`Remove "${rec.title || hostOf(rec.url)}"?`)) await deleteRecreation(id);
      }
      return;
    }
    await openRecreation(rec);
  };
  root.querySelector("#hideout-root").addEventListener("click", handleCard);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList?.contains?.("hd-card")) { e.preventDefault(); e.target.click(); }
  });

  // Theme switcher
  root.querySelector("#hd-themes")?.addEventListener("click", async (e) => {
    const btn = e.target.closest?.("[data-theme]");
    if (!btn) return;
    await updateSettings(s => { s.hideoutTheme = btn.dataset.theme; });
  });

  // Global browser pref
  root.querySelector("#chill-browser-global")?.addEventListener("change", async (e) => {
    await updateSettings(s => { s.recreationBrowser = e.target.value; });
  });
}

// ============ FONTS ============
function injectFonts() {
  if (document.getElementById("hideout-fonts")) return;
  const link = document.createElement("link");
  link.id = "hideout-fonts";
  link.rel = "stylesheet";
  // Playfair Display (serif), Cormorant Garamond (serif), Inter (sans), Bebas Neue (display condensed)
  link.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;1,500&family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;500;600;700&family=Bebas+Neue&display=swap";
  document.head.appendChild(link);
}

// ============ STYLES ============
function injectStyles() {
  if (document.getElementById("hideout-styles")) return;
  const s = document.createElement("style");
  s.id = "hideout-styles";
  s.textContent = `
    /* Edge-to-edge: when active, strip the view container's padding */
    #view.hideout-active { padding: 0 !important; max-width: none !important; margin: 0 !important; }

    /* The display: flex / grid rules below override [hidden] in the UA
       stylesheet, so explicitly re-enforce it. Fixes: modal stays open on
       mount; empty state + section rows don't actually hide. */
    .hideout [hidden], .hd-scrim[hidden], .hd-row[hidden], .hd-empty[hidden] { display: none !important; }

    .hideout {
      position: relative;
      min-height: calc(100vh - 56px);
      color: var(--h-ink);
      background: var(--h-bg);
      font-family: 'Inter', -apple-system, system-ui, sans-serif;
      --h-bg: #110c08;
      --h-bg-2: #1a110a;
      --h-ink: #ece4d6;
      --h-dim: #9c8d75;
      --h-mut: #726349;
      --h-line: rgba(236, 228, 214, .09);
      --h-line2: rgba(236, 228, 214, .18);
      --h-accent: #c9a56b;
      --h-accent-glow: 201, 165, 107;
      --h-serif: 'Playfair Display', 'Cormorant Garamond', Georgia, serif;
      --h-body: 'Inter', -apple-system, system-ui, sans-serif;
    }

    /* ============ THEMES ============ */
    /* London — oxblood leather + mahogany + candlelit cream */
    .hideout[data-theme="london"] {
      --h-bg: #15100c; --h-bg-2: #1f1811;
      --h-ink: #efe7d4; --h-dim: #a79880; --h-mut: #7a6a4f;
      --h-accent: #c9a56b;   /* aged brass */
      --h-accent-glow: 201, 165, 107;
      --h-serif: 'Playfair Display', Georgia, serif;
    }
    /* Tokyo — black lacquer + warm amber + hairline */
    .hideout[data-theme="tokyo"] {
      --h-bg: #0a0908; --h-bg-2: #121010;
      --h-ink: #e8e2d4; --h-dim: #8d8575; --h-mut: #5a5447;
      --h-accent: #d9893b;   /* warm amber whisky */
      --h-accent-glow: 217, 137, 59;
      --h-serif: 'Cormorant Garamond', 'Playfair Display', Georgia, serif;
    }
    /* Lisbon — stone cream + burgundy + candlelit */
    .hideout[data-theme="lisbon"] {
      --h-bg: #1a1210; --h-bg-2: #221815;
      --h-ink: #f1e8d6; --h-dim: #b19d7f; --h-mut: #8a7556;
      --h-accent: #a73d33;   /* deep burgundy */
      --h-accent-glow: 167, 61, 51;
      --h-serif: 'Cormorant Garamond', 'Playfair Display', Georgia, serif;
    }
    /* New Orleans — forest green + antique gold + art-nouveau */
    .hideout[data-theme="neworleans"] {
      --h-bg: #0d1510; --h-bg-2: #121c17;
      --h-ink: #ebe4ce; --h-dim: #9fa89a; --h-mut: #6e7a6c;
      --h-accent: #c9a86b;   /* antique gold */
      --h-accent-glow: 201, 168, 107;
      --h-serif: 'Playfair Display', Georgia, serif;
    }

    /* ============ HERO ============ */
    .hd-hero {
      position: relative;
      min-height: 55vh;
      display: flex; flex-direction: column; justify-content: center;
      padding: 80px 56px 60px;
      overflow: hidden;
      border-bottom: 1px solid var(--h-line);
    }
    .hd-hero-grad {
      position: absolute; inset: 0;
      background:
        radial-gradient(ellipse at 20% 30%, color-mix(in oklab, var(--h-accent) 22%, transparent) 0%, transparent 55%),
        radial-gradient(ellipse at 85% 20%, color-mix(in oklab, var(--h-accent) 10%, transparent) 0%, transparent 45%),
        linear-gradient(180deg, var(--h-bg-2) 0%, var(--h-bg) 100%);
    }
    .hd-hero-vignette {
      position: absolute; inset: 0;
      background:
        radial-gradient(ellipse at 50% 100%, transparent 0%, rgba(0,0,0,.4) 100%),
        linear-gradient(180deg, rgba(0,0,0,.1) 0%, transparent 30%, rgba(0,0,0,.3) 100%);
    }
    .hd-hero-inner { position: relative; z-index: 2; max-width: 760px; }
    .hd-eyebrow {
      font: 700 11.5px/1 var(--h-body);
      letter-spacing: .28em; text-transform: uppercase;
      color: var(--h-accent);
      margin-bottom: 20px;
    }
    .hd-title {
      font-family: var(--h-serif);
      font-weight: 500;
      font-size: clamp(56px, 6.5vw, 96px);
      line-height: 1.02; letter-spacing: -.015em;
      margin: 0 0 20px;
      color: var(--h-ink);
    }
    .hd-title::after {
      content: ""; display: block;
      width: 60px; height: 1px; background: var(--h-accent);
      margin: 24px 0 0;
    }
    .hd-sub {
      font-family: var(--h-body);
      font: 400 17px/1.6 var(--h-body);
      color: var(--h-dim);
      margin: 0 0 36px; max-width: 480px;
    }
    .hd-actions { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }

    .hd-cta {
      display: inline-flex; align-items: center; gap: 12px;
      padding: 14px 28px;
      font: 600 13.5px/1 var(--h-body);
      letter-spacing: .14em; text-transform: uppercase;
      color: var(--h-bg);
      background: var(--h-accent);
      border: none; border-radius: 2px;
      cursor: pointer;
      transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
      box-shadow: 0 10px 24px rgba(var(--h-accent-glow), .22);
    }
    .hd-cta:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(var(--h-accent-glow), .36); }
    .hd-cta.ghost {
      background: transparent;
      color: var(--h-accent);
      border: 1px solid var(--h-accent);
      box-shadow: none;
    }
    .hd-cta.ghost:hover { background: rgba(var(--h-accent-glow), .08); }
    .hd-cta span:first-child { font-size: 16px; line-height: 1; opacity: .8; }

    .hd-pref {
      display: inline-flex; align-items: center; gap: 12px;
      padding: 11px 18px;
      border: 1px solid var(--h-line2);
      border-radius: 2px;
      color: var(--h-dim);
      font: 500 12px/1 var(--h-body);
    }
    .hd-pref-k { letter-spacing: .18em; text-transform: uppercase; font-size: 10.5px; color: var(--h-mut); }
    .hd-pref-sel {
      background: transparent; color: var(--h-ink); border: none;
      font: 500 13px/1 var(--h-body); cursor: pointer; outline: none;
    }
    .hd-pref-sel option { background: var(--h-bg-2); color: var(--h-ink); }

    /* Theme switcher dock */
    .hd-themes {
      position: absolute; bottom: 32px; right: 56px; z-index: 3;
      display: flex; gap: 6px;
      padding: 6px; border-radius: 4px;
      background: rgba(0,0,0,.4);
      backdrop-filter: blur(10px);
      border: 1px solid var(--h-line);
    }
    .hd-theme-chip {
      padding: 7px 12px;
      background: transparent; border: none; border-radius: 3px;
      color: var(--h-dim);
      font: 600 10.5px/1 var(--h-body); letter-spacing: .12em; text-transform: uppercase;
      cursor: pointer;
      transition: all .18s ease;
    }
    .hd-theme-chip:hover { color: var(--h-ink); }
    .hd-theme-chip.active { background: var(--h-accent); color: var(--h-bg); }

    /* ============ MAIN ============ */
    .hd-main { padding: 56px 0 100px; }

    .hd-row { margin-bottom: 60px; }
    .hd-row-head {
      display: flex; align-items: baseline; gap: 20px;
      padding: 0 56px;
      margin-bottom: 20px;
    }
    .hd-row-title {
      font-family: var(--h-serif); font-weight: 500;
      font-size: 28px; line-height: 1.1; letter-spacing: -.01em;
      color: var(--h-ink);
      margin: 0;
    }
    .hd-row-rule {
      flex: 1; height: 1px;
      background: linear-gradient(90deg, var(--h-line2) 0%, transparent 100%);
    }

    .hd-row-scroll {
      display: flex; gap: 18px;
      overflow-x: auto; overflow-y: visible;
      padding: 8px 56px 20px;
      scroll-snap-type: x proximity;
      scrollbar-width: thin;
      scrollbar-color: var(--h-line2) transparent;
    }
    .hd-row-scroll::-webkit-scrollbar { height: 6px; }
    .hd-row-scroll::-webkit-scrollbar-thumb { background: var(--h-line2); border-radius: 3px; }
    .hd-row-scroll::-webkit-scrollbar-track { background: transparent; }

    /* ============ CARD ============ */
    .hd-card {
      flex: 0 0 320px;
      scroll-snap-align: start;
      background: var(--h-bg-2);
      border: 1px solid var(--h-line);
      border-radius: 4px;
      overflow: hidden;
      cursor: pointer;
      transition: transform .35s cubic-bezier(.2,.9,.3,1), border-color .25s ease, box-shadow .35s ease;
      display: flex; flex-direction: column;
    }
    .hd-card:hover, .hd-card:focus-visible {
      transform: translateY(-6px);
      border-color: color-mix(in oklab, var(--h-accent) 50%, var(--h-line));
      box-shadow:
        0 24px 48px rgba(0,0,0,.5),
        0 0 0 1px color-mix(in oklab, var(--h-accent) 20%, transparent);
      outline: none;
    }

    .hd-card-thumb {
      position: relative;
      aspect-ratio: 16 / 9;
      overflow: hidden;
      background: linear-gradient(135deg, var(--h-bg-2), var(--h-bg));
    }
    .hd-card-img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .5s cubic-bezier(.2,.9,.3,1); }
    .hd-card:hover .hd-card-img { transform: scale(1.04); }
    .hd-card-thumb.no-img::after {
      content: ""; position: absolute; inset: 0;
      background:
        linear-gradient(135deg, color-mix(in oklab, var(--h-accent) 30%, transparent) 0%, transparent 60%),
        radial-gradient(ellipse at 70% 70%, color-mix(in oklab, var(--h-accent) 15%, transparent) 0%, transparent 60%);
    }
    .hd-card-gradient {
      position: absolute; inset: 0;
      background: linear-gradient(180deg, transparent 50%, rgba(0,0,0,.75) 100%);
      pointer-events: none;
    }
    .hd-card-badge {
      position: absolute; top: 12px; left: 12px;
      padding: 4px 10px;
      font: 600 9.5px/1 var(--h-body);
      letter-spacing: .18em; text-transform: uppercase;
      color: var(--h-ink);
      background: rgba(0,0,0,.5);
      backdrop-filter: blur(6px);
      border-radius: 2px;
      border: 1px solid rgba(255,255,255,.1);
    }
    .hd-card-actions {
      position: absolute; top: 12px; right: 12px;
      display: flex; gap: 4px;
      opacity: 0; transform: translateY(-6px);
      transition: opacity .22s ease, transform .22s ease;
    }
    .hd-card:hover .hd-card-actions, .hd-card:focus-within .hd-card-actions { opacity: 1; transform: translateY(0); }
    .hd-ca-btn {
      width: 28px; height: 28px; border-radius: 2px;
      background: rgba(0,0,0,.6);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255,255,255,.1);
      color: var(--h-ink);
      font-size: 13px;
      cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all .14s ease;
    }
    .hd-ca-btn:hover { background: var(--h-accent); color: var(--h-bg); border-color: var(--h-accent); }

    .hd-card-info { padding: 14px 16px 18px; min-width: 0; }
    .hd-card-title {
      font-family: var(--h-serif); font-weight: 500;
      font-size: 17px; line-height: 1.3; letter-spacing: -.005em;
      color: var(--h-ink);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      margin-bottom: 6px;
    }
    .hd-card-sub {
      font: 500 12px/1.4 var(--h-body);
      color: var(--h-dim);
      display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
      letter-spacing: .01em;
    }

    /* ============ EMPTY ============ */
    .hd-empty {
      text-align: center;
      padding: 100px 56px 160px;
      max-width: 540px; margin: 0 auto;
    }
    .hd-empty h2 {
      font-family: var(--h-serif); font-weight: 500;
      font-size: 40px; line-height: 1.1; letter-spacing: -.015em;
      color: var(--h-ink);
      margin: 0 0 14px;
    }
    .hd-empty p {
      font: 400 15px/1.65 var(--h-body);
      color: var(--h-dim);
      margin: 0 0 32px;
    }

    /* ============ MODAL ============ */
    .hd-scrim {
      position: fixed; inset: 0; z-index: 1500;
      background: rgba(0,0,0,.75);
      backdrop-filter: blur(12px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: hdFade .22s ease both;
    }
    @keyframes hdFade { from { opacity: 0; } to { opacity: 1; } }
    .hd-modal {
      background: var(--h-bg-2);
      border: 1px solid var(--h-line2);
      border-radius: 6px;
      width: 100%; max-width: 540px; max-height: 92vh;
      display: flex; flex-direction: column; overflow: hidden;
      color: var(--h-ink);
      font-family: var(--h-body);
      box-shadow: 0 40px 90px rgba(0,0,0,.7);
      animation: hdPop .28s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes hdPop { from { opacity: 0; transform: translateY(16px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .hd-m-head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 24px 28px 20px; border-bottom: 1px solid var(--h-line);
    }
    .hd-m-eyebrow {
      font: 700 11px/1 var(--h-body);
      letter-spacing: .28em; text-transform: uppercase;
      color: var(--h-accent);
    }
    .hd-m-close {
      width: 30px; height: 30px; border-radius: 2px;
      background: transparent; border: 1px solid var(--h-line);
      color: var(--h-dim); cursor: pointer;
      font-size: 20px; line-height: 1;
      transition: all .14s ease;
    }
    .hd-m-close:hover { color: var(--h-ink); border-color: var(--h-line2); }
    .hd-m-body { padding: 24px 28px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
    .hd-m-field { display: flex; flex-direction: column; gap: 8px; }
    .hd-m-k {
      font: 700 10.5px/1 var(--h-body); letter-spacing: .2em; text-transform: uppercase;
      color: var(--h-mut);
    }
    .hd-m-k small { font-weight: 500; letter-spacing: 0; text-transform: none; margin-left: 6px; opacity: .7; }
    .hd-m-field input, .hd-m-field select {
      width: 100%; padding: 12px 14px;
      background: rgba(255,255,255,.03);
      border: 1px solid var(--h-line);
      border-radius: 2px;
      color: var(--h-ink);
      font: 500 14px/1.3 var(--h-body);
      transition: border-color .18s ease, background .18s ease;
      outline: none;
      box-sizing: border-box;
    }
    .hd-m-field input:focus, .hd-m-field select:focus {
      border-color: var(--h-accent);
      background: rgba(255,255,255,.06);
    }
    .hd-m-field input::placeholder { color: var(--h-mut); }
    .hd-m-field select option { background: var(--h-bg-2); color: var(--h-ink); }
    .hd-m-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 480px) { .hd-m-two { grid-template-columns: 1fr; } }
    .hd-m-preview {
      display: flex; gap: 14px; align-items: center;
      padding: 14px;
      background: rgba(255,255,255,.03);
      border: 1px solid var(--h-line);
      border-radius: 2px;
    }
    .hd-m-thumb-wrap {
      width: 84px; height: 84px; border-radius: 2px;
      overflow: hidden; flex-shrink: 0;
      background: linear-gradient(135deg, color-mix(in oklab, var(--h-accent) 20%, transparent), var(--h-bg));
    }
    .hd-m-thumb-wrap img { width: 100%; height: 100%; object-fit: cover; }
    .hd-m-meta { min-width: 0; }
    .hd-m-ptitle { font-family: var(--h-serif); font: 500 15px/1.3 var(--h-serif); color: var(--h-ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .hd-m-phost { font: 500 12px/1.3 var(--h-body); color: var(--h-dim); margin-top: 4px; }
    .hd-m-foot {
      display: flex; justify-content: flex-end; gap: 10px;
      padding: 18px 28px;
      border-top: 1px solid var(--h-line);
      background: rgba(0,0,0,.25);
    }
    .hd-m-btn {
      padding: 11px 22px; border-radius: 2px;
      font: 600 12px/1 var(--h-body); letter-spacing: .14em; text-transform: uppercase;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all .18s ease;
      background: transparent;
    }
    .hd-m-btn.ghost { color: var(--h-dim); border-color: var(--h-line2); }
    .hd-m-btn.ghost:hover { color: var(--h-ink); border-color: var(--h-ink); }
    .hd-m-btn.primary {
      background: var(--h-accent); color: var(--h-bg); border-color: var(--h-accent);
    }
    .hd-m-btn.primary:hover:not(:disabled) {
      filter: brightness(1.1);
      box-shadow: 0 8px 20px rgba(var(--h-accent-glow), .3);
    }
    .hd-m-btn.primary:disabled { opacity: .35; cursor: not-allowed; }

    /* Mobile */
    @media (max-width: 720px) {
      .hd-hero { padding: 60px 24px 50px; min-height: 50vh; }
      .hd-themes { right: 24px; bottom: 20px; }
      .hd-row-head { padding: 0 24px; }
      .hd-row-scroll { padding: 8px 24px 20px; }
      .hd-row-title { font-size: 22px; }
      .hd-card { flex-basis: 260px; }
    }
  `;
  document.head.appendChild(s);
}
