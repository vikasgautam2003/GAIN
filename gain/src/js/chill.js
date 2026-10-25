// Chill Hideout — the lounge.
// Full dark theme, neon accents, DJ-booth energy. The one page in the app
// that's loud. Cards are "tracks" in your set list. Click a card → opens
// in your preferred browser (per-site > global default > system).

import {
  getRecreations, addRecreation, updateRecreation, deleteRecreation,
  openRecreation, fetchUrlPreview, getSettings, updateSettings, on,
} from "./store.js";

// ---- Browser & category tables ----
const BROWSERS = [
  { key: "",              label: "System default" },
  { key: "Brave Browser", label: "Brave" },
  { key: "Google Chrome", label: "Chrome" },
  { key: "Safari",        label: "Safari" },
  { key: "Firefox",       label: "Firefox" },
  { key: "Arc",           label: "Arc" },
];

const CATEGORIES = {
  youtube:   { label: "Video",   accent: "#ff2e9f" },
  twitch:    { label: "Twitch",  accent: "#9147ff" },
  reddit:    { label: "Reddit",  accent: "#ff6a00" },
  x:         { label: "X",       accent: "#00f0ff" },
  music:     { label: "Music",   accent: "#1ed760" },
  instagram: { label: "IG",      accent: "#ff2e9f" },
  reading:   { label: "Read",    accent: "#ffea00" },
  web:       { label: "Web",     accent: "#8a90ff" },
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
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  })[c]);
}

function hostOf(u) {
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; }
}

let activeFilter = "all";
let unsub = null;

export default {
  async mount(root) {
    injectStyles();
    root.innerHTML = render();
    paint(root);
    wire(root);
    if (unsub) unsub();
    unsub = on((ev) => { if (ev === "recreations" || ev === "settings") paint(root); });
  },
  unmount() { if (unsub) { unsub(); unsub = null; } },
};

// ================= RENDER =================
function render() {
  return `
    <div class="lounge">
      <!-- Ambient lighting layer -->
      <div class="lounge-amb" aria-hidden="true">
        <span class="amb amb-1"></span>
        <span class="amb amb-2"></span>
        <span class="amb amb-3"></span>
      </div>

      <!-- Header: velvet rope, neon marquee -->
      <header class="lounge-head">
        <div class="lounge-neon">AFTER&nbsp;HOURS</div>
        <h1 class="lounge-title">The Hideout.</h1>
        <p class="lounge-lede">Your private lounge. Your set list. Drop in, open a track, come back when you're ready.</p>
        <div class="lounge-controls">
          <button class="neon-btn" id="chill-add">
            <span class="nb-plus">+</span>
            <span>Add a track</span>
          </button>
          <label class="browser-pref">
            <span class="bp-k">Default browser</span>
            <select id="chill-browser-global" class="bp-select">
              ${BROWSERS.map(b => `<option value="${esc(b.key)}">${esc(b.label)}</option>`).join("")}
            </select>
          </label>
        </div>
      </header>

      <!-- Filter bar -->
      <nav class="lounge-filters" id="chill-filters"></nav>

      <!-- Pinned (headliners) -->
      <section class="lounge-section" id="chill-pinned" hidden>
        <div class="sec-label">
          <span class="sec-dot"></span>
          <span>Headliners</span>
          <span class="sec-count" id="pin-count">0</span>
        </div>
        <div class="headliners" id="chill-pin-grid"></div>
      </section>

      <!-- Main set list -->
      <section class="lounge-section" id="chill-main-section">
        <div class="sec-label">
          <span class="sec-dot pink"></span>
          <span>The set list</span>
          <span class="sec-count" id="set-count">0</span>
        </div>
        <div class="set-list" id="chill-grid"></div>
      </section>

      <!-- Empty state -->
      <div class="lounge-empty" id="chill-empty" hidden>
        <div class="empty-vinyl" aria-hidden="true">
          <div class="vinyl-ring"></div>
          <div class="vinyl-center"></div>
        </div>
        <h2>Doors are open.</h2>
        <p>No tracks yet. Add a YouTube channel, a mix, a thread, a lofi stream — anything that resets you.</p>
        <button class="neon-btn" id="chill-empty-add">
          <span class="nb-plus">+</span>
          <span>Add the first track</span>
        </button>
      </div>

      <!-- Add / Edit modal -->
      <div class="lm-scrim" id="chill-scrim" hidden>
        <div class="lm-modal" role="dialog" aria-label="Add track">
          <header class="lm-head">
            <div>
              <div class="lm-eyebrow">NEW TRACK</div>
              <h2 id="chill-modal-title">Drop a link</h2>
            </div>
            <button class="lm-close" id="chill-modal-close" aria-label="Close">×</button>
          </header>
          <div class="lm-body">
            <label class="lm-field">
              <span class="lm-k">URL</span>
              <input id="chill-url" type="url" placeholder="https://…" autocomplete="off" spellcheck="false" />
            </label>

            <div class="lm-preview" id="chill-preview" hidden>
              <div class="lmp-thumb">
                <img id="chill-preview-img" alt="" />
                <div class="lmp-vinyl" aria-hidden="true"></div>
              </div>
              <div class="lmp-meta">
                <div class="lmp-title" id="chill-preview-title">—</div>
                <div class="lmp-host" id="chill-preview-host">—</div>
              </div>
            </div>

            <label class="lm-field">
              <span class="lm-k">Title</span>
              <input id="chill-title" type="text" placeholder="What's this track called?" />
            </label>
            <label class="lm-field">
              <span class="lm-k">Note <small>optional</small></span>
              <input id="chill-note" type="text" maxlength="120" placeholder="Why you come here" />
            </label>
            <div class="lm-two">
              <label class="lm-field">
                <span class="lm-k">Category</span>
                <select id="chill-category">
                  ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("")}
                </select>
              </label>
              <label class="lm-field">
                <span class="lm-k">Open in</span>
                <select id="chill-browser">
                  ${BROWSERS.map(b => `<option value="${esc(b.key)}">${esc(b.label)}</option>`).join("")}
                </select>
              </label>
            </div>
          </div>
          <footer class="lm-foot">
            <button class="lm-btn ghost" id="chill-modal-cancel">Cancel</button>
            <button class="lm-btn primary" id="chill-modal-save" disabled>Save track</button>
          </footer>
        </div>
      </div>
    </div>
  `;
}

// ================= PAINT =================
function paint(root) {
  const recs = getRecreations();
  const settings = getSettings();

  // Global browser pref
  const globalSel = root.querySelector("#chill-browser-global");
  if (globalSel) globalSel.value = settings.recreationBrowser || "";

  // Pinned
  const pinSec = root.querySelector("#chill-pinned");
  const pinGrid = root.querySelector("#chill-pin-grid");
  const pinned = recs.filter(r => r.pinned).slice(0, 3);
  if (pinSec && pinGrid) {
    if (pinned.length) {
      pinSec.hidden = false;
      pinGrid.innerHTML = pinned.map(r => cardHtml(r, true)).join("");
      const pc = root.querySelector("#pin-count");
      if (pc) pc.textContent = String(pinned.length);
    } else {
      pinSec.hidden = true;
    }
  }

  // Filter chips
  const nav = root.querySelector("#chill-filters");
  if (nav) {
    const cats = Array.from(new Set(recs.map(r => r.category || "web")));
    const chips = ["all", ...cats];
    nav.innerHTML = chips.map(c => {
      const meta = CATEGORIES[c] || { label: "All", accent: "#ffffff" };
      const label = c === "all" ? "All" : meta.label;
      const n = c === "all" ? recs.length : recs.filter(r => (r.category || "web") === c).length;
      return `<button class="chip ${c === activeFilter ? "active" : ""}" data-cat="${esc(c)}" style="--chip-accent:${esc(meta.accent)}">
        <span class="chip-dot"></span>${esc(label)}<span class="chip-n">${n}</span>
      </button>`;
    }).join("");
    nav.hidden = recs.length === 0;
  }

  // Set list
  const grid = root.querySelector("#chill-grid");
  const empty = root.querySelector("#chill-empty");
  const mainSec = root.querySelector("#chill-main-section");
  const unpinned = recs.filter(r => !r.pinned);
  const visible = activeFilter === "all"
    ? unpinned
    : unpinned.filter(r => (r.category || "web") === activeFilter);
  visible.sort((a, b) => (b.openedCount || 0) - (a.openedCount || 0) || (b.addedAt || 0) - (a.addedAt || 0));

  if (!recs.length) {
    if (grid) grid.innerHTML = "";
    if (empty) empty.hidden = false;
    if (mainSec) mainSec.hidden = true;
    if (nav) nav.hidden = true;
  } else {
    if (empty) empty.hidden = true;
    if (mainSec) mainSec.hidden = false;
    if (grid) grid.innerHTML = visible.map(r => cardHtml(r, false)).join("");
    const sc = root.querySelector("#set-count");
    if (sc) sc.textContent = String(visible.length);
  }
}

function cardHtml(r, big) {
  const cat = CATEGORIES[r.category] || CATEGORIES.web;
  const host = hostOf(r.url);
  const img = r.imageUrl
    ? `<img class="track-img" src="${esc(r.imageUrl)}" alt="" loading="lazy"
            onerror="this.style.display='none';this.closest('.track-thumb').classList.add('no-img');" />`
    : "";
  return `
    <article class="track ${big ? "track-big" : ""}" data-id="${esc(r.id)}" tabindex="0" style="--track-accent:${esc(cat.accent)}">
      <div class="track-thumb ${r.imageUrl ? "" : "no-img"}">
        ${img}
        <div class="track-vinyl" aria-hidden="true"></div>
        <div class="track-cat">${esc(cat.label)}</div>
        <div class="track-play" aria-hidden="true">▶</div>
      </div>
      <div class="track-info">
        <div class="track-title">${esc(r.title || host)}</div>
        <div class="track-host">${esc(host)}</div>
        ${r.note ? `<div class="track-note">${esc(r.note)}</div>` : ""}
      </div>
      <div class="track-meta">
        <span class="track-plays">${(r.openedCount || 0) > 0 ? `${r.openedCount} play${r.openedCount === 1 ? "" : "s"}` : "unplayed"}</span>
        <div class="track-actions">
          <button class="ta-btn" data-act="pin" title="${r.pinned ? "Unpin" : "Pin as headliner"}">${r.pinned ? "★" : "☆"}</button>
          <button class="ta-btn" data-act="edit" title="Edit">✎</button>
          <button class="ta-btn danger" data-act="del" title="Delete">×</button>
        </div>
      </div>
    </article>
  `;
}

// ================= WIRE =================
function wire(root) {
  const scrim = root.querySelector("#chill-scrim");
  const urlEl = root.querySelector("#chill-url");
  const previewEl = root.querySelector("#chill-preview");
  const previewImg = root.querySelector("#chill-preview-img");
  const previewTitle = root.querySelector("#chill-preview-title");
  const previewHost = root.querySelector("#chill-preview-host");
  const titleEl = root.querySelector("#chill-title");
  const noteEl = root.querySelector("#chill-note");
  const catEl = root.querySelector("#chill-category");
  const browserEl = root.querySelector("#chill-browser");
  const saveBtn = root.querySelector("#chill-modal-save");
  const modalTitle = root.querySelector("#chill-modal-title");

  let editingId = null;
  let fetched = { imageUrl: "", title: "" };
  let previewToken = 0;

  const openModal = (rec = null) => {
    editingId = rec?.id || null;
    modalTitle.textContent = rec ? "Edit track" : "Drop a link";
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

  const closeModal = () => {
    scrim.hidden = true;
    editingId = null;
    fetched = { imageUrl: "", title: "" };
  };

  root.querySelector("#chill-add")?.addEventListener("click", () => openModal());
  root.querySelector("#chill-empty-add")?.addEventListener("click", () => openModal());
  root.querySelector("#chill-modal-close")?.addEventListener("click", closeModal);
  root.querySelector("#chill-modal-cancel")?.addEventListener("click", closeModal);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeModal(); });

  // Esc to close
  document.addEventListener("keydown", function escClose(e) {
    if (e.key === "Escape" && !scrim.hidden) closeModal();
  });

  // URL input → debounced preview fetch
  let previewTimer = null;
  const fetchPreview = async () => {
    const u = urlEl.value.trim();
    if (!/^https?:\/\//i.test(u)) {
      previewEl.hidden = true;
      saveBtn.disabled = true;
      return;
    }
    saveBtn.disabled = false;
    previewEl.hidden = false;
    previewImg.removeAttribute("src");
    previewTitle.textContent = "Loading preview…";
    previewHost.textContent = hostOf(u);
    catEl.value = inferCategory(u);
    const myToken = ++previewToken;
    try {
      const p = await fetchUrlPreview(u);
      if (myToken !== previewToken) return; // stale
      fetched = { imageUrl: p.imageUrl, title: p.title };
      if (p.imageUrl) previewImg.src = p.imageUrl;
      previewTitle.textContent = p.title || hostOf(u);
      if (!titleEl.value.trim()) titleEl.value = p.title || hostOf(u);
    } catch (_) {
      if (myToken !== previewToken) return;
      previewTitle.textContent = "Preview unavailable — will use favicon";
    }
  };
  urlEl.addEventListener("input", () => {
    saveBtn.disabled = !urlEl.value.trim();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(fetchPreview, 400);
  });

  // Save
  saveBtn.addEventListener("click", async () => {
    const url = urlEl.value.trim();
    if (!url) return;
    const payload = {
      url,
      title: titleEl.value.trim() || hostOf(url),
      note: noteEl.value.trim(),
      category: catEl.value,
      browser: browserEl.value,
      imageUrl: fetched.imageUrl || "",
    };
    try {
      if (editingId) await updateRecreation(editingId, payload);
      else await addRecreation(payload);
      closeModal();
    } catch (e) { console.warn("save failed", e); }
  });

  // Card interactions — delegated
  const handleCard = async (ev) => {
    const actBtn = ev.target.closest?.("[data-act]");
    const card = ev.target.closest?.(".track");
    if (!card) return;
    const id = card.dataset.id;
    const rec = getRecreations().find(r => r.id === id);
    if (!rec) return;
    if (actBtn) {
      ev.stopPropagation();
      const act = actBtn.dataset.act;
      if (act === "pin") {
        const headlinerCount = getRecreations().filter(r => r.pinned).length;
        if (!rec.pinned && headlinerCount >= 3) { pulseCard(card, "Max 3 headliners"); return; }
        await updateRecreation(id, { pinned: !rec.pinned });
      } else if (act === "edit") { openModal(rec); }
      else if (act === "del") {
        if (confirm(`Remove "${rec.title || hostOf(rec.url)}" from the lounge?`)) {
          await deleteRecreation(id);
        }
      }
      return;
    }
    // Click the card itself → open in preferred browser
    await openRecreation(rec);
    pulseCard(card, "Spinning in your browser");
  };
  root.querySelector("#chill-grid")?.addEventListener("click", handleCard);
  root.querySelector("#chill-pin-grid")?.addEventListener("click", handleCard);

  // Keyboard: Enter on focused card opens it
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList?.contains?.("track")) {
      e.preventDefault();
      e.target.click();
    }
  });

  // Filter chips
  root.querySelector("#chill-filters")?.addEventListener("click", (e) => {
    const chip = e.target.closest?.("[data-cat]");
    if (!chip) return;
    activeFilter = chip.dataset.cat;
    paint(root);
  });

  // Global browser pref
  root.querySelector("#chill-browser-global")?.addEventListener("change", async (e) => {
    await updateSettings(s => { s.recreationBrowser = e.target.value; });
  });
}

function pulseCard(card, msg) {
  const prev = card.querySelector(".track-pulse");
  if (prev) prev.remove();
  const t = document.createElement("div");
  t.className = "track-pulse";
  t.textContent = msg;
  card.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

// ================= STYLES =================
function injectStyles() {
  if (document.getElementById("chill-styles")) return;
  const s = document.createElement("style");
  s.id = "chill-styles";
  s.textContent = `
    /* ------- Lounge canvas ------- */
    .lounge {
      --neon-pink: #ff2e9f;
      --neon-cyan: #00f0ff;
      --neon-gold: #ffea00;
      --neon-purple: #9b4dff;
      --lounge-bg-1: #0a0b14;
      --lounge-bg-2: #140b1e;
      --lounge-bg-3: #1a0f2e;
      --lounge-ink: #f2f4ff;
      --lounge-dim: #8a8fab;
      --lounge-line: rgba(242, 244, 255, .08);
      --lounge-line2: rgba(242, 244, 255, .16);
      --lounge-card: rgba(242, 244, 255, .03);
      --lounge-card-hover: rgba(242, 244, 255, .055);

      position: relative;
      min-height: calc(100vh - 56px);
      padding: 0 32px 80px;
      color: var(--lounge-ink);
      background:
        radial-gradient(ellipse at 20% 0%, color-mix(in oklab, var(--neon-pink) 28%, transparent) 0%, transparent 42%),
        radial-gradient(ellipse at 80% 10%, color-mix(in oklab, var(--neon-cyan) 22%, transparent) 0%, transparent 48%),
        radial-gradient(ellipse at 50% 90%, color-mix(in oklab, var(--neon-purple) 24%, transparent) 0%, transparent 50%),
        linear-gradient(180deg, var(--lounge-bg-1) 0%, var(--lounge-bg-2) 60%, var(--lounge-bg-3) 100%);
      border-radius: 20px;
      margin: 0 auto;
      max-width: 1240px;
      overflow: hidden;
    }

    /* Dim ambient halos that drift slowly */
    .lounge-amb { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 0; }
    .lounge-amb .amb {
      position: absolute; border-radius: 50%; filter: blur(80px); opacity: .35;
      animation: ambDrift 24s ease-in-out infinite;
    }
    .lounge-amb .amb-1 { top: 10%; left: 8%; width: 280px; height: 280px; background: var(--neon-pink); }
    .lounge-amb .amb-2 { top: 20%; right: 10%; width: 320px; height: 320px; background: var(--neon-cyan); animation-delay: -8s; }
    .lounge-amb .amb-3 { bottom: 10%; left: 40%; width: 360px; height: 360px; background: var(--neon-purple); animation-delay: -16s; }
    @keyframes ambDrift {
      0%, 100% { transform: translate(0, 0) scale(1); opacity: .3; }
      50% { transform: translate(-30px, 30px) scale(1.1); opacity: .45; }
    }

    .lounge > *:not(.lounge-amb) { position: relative; z-index: 1; }

    /* ------- Header ------- */
    .lounge-head { padding: 72px 20px 50px; text-align: center; max-width: 760px; margin: 0 auto; }
    .lounge-neon {
      display: inline-block;
      font: 700 13px/1 "Helvetica Neue", system-ui, sans-serif;
      letter-spacing: .3em; text-transform: uppercase;
      color: var(--neon-cyan);
      padding: 10px 18px; border-radius: 999px;
      border: 1px solid color-mix(in oklab, var(--neon-cyan) 60%, transparent);
      box-shadow: 0 0 24px color-mix(in oklab, var(--neon-cyan) 35%, transparent), inset 0 0 24px color-mix(in oklab, var(--neon-cyan) 15%, transparent);
      text-shadow: 0 0 10px color-mix(in oklab, var(--neon-cyan) 60%, transparent);
      margin-bottom: 28px;
      animation: neonPulse 3s ease-in-out infinite;
    }
    @keyframes neonPulse {
      0%, 100% { box-shadow: 0 0 20px color-mix(in oklab, var(--neon-cyan) 30%, transparent), inset 0 0 20px color-mix(in oklab, var(--neon-cyan) 12%, transparent); }
      50%      { box-shadow: 0 0 32px color-mix(in oklab, var(--neon-cyan) 55%, transparent), inset 0 0 32px color-mix(in oklab, var(--neon-cyan) 22%, transparent); }
    }
    .lounge-title {
      margin: 0 0 16px;
      font: 800 72px/1 "Helvetica Neue", system-ui, sans-serif;
      letter-spacing: -.03em;
      color: var(--lounge-ink);
      text-shadow: 0 0 40px color-mix(in oklab, var(--neon-pink) 30%, transparent);
    }
    .lounge-lede {
      margin: 0 auto 36px; max-width: 520px;
      font: 400 17px/1.6 "Helvetica Neue", system-ui, sans-serif;
      color: var(--lounge-dim);
    }
    .lounge-controls { display: flex; justify-content: center; align-items: center; gap: 20px; flex-wrap: wrap; }

    /* Neon button */
    .neon-btn {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 14px 26px;
      font: 700 14px/1 "Helvetica Neue", system-ui, sans-serif;
      letter-spacing: .06em; text-transform: uppercase;
      color: var(--lounge-ink);
      background: linear-gradient(135deg, var(--neon-pink), var(--neon-purple));
      border: none; border-radius: 999px;
      cursor: pointer;
      box-shadow:
        0 0 28px color-mix(in oklab, var(--neon-pink) 55%, transparent),
        inset 0 1px 0 rgba(255,255,255,.2);
      transition: transform .22s ease, box-shadow .22s ease;
    }
    .neon-btn:hover {
      transform: translateY(-2px);
      box-shadow:
        0 0 36px color-mix(in oklab, var(--neon-pink) 70%, transparent),
        inset 0 1px 0 rgba(255,255,255,.26);
    }
    .nb-plus { font-size: 18px; line-height: 1; opacity: .85; }

    /* Browser preference pill */
    .browser-pref {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 10px 14px;
      background: rgba(242,244,255,.04); border: 1px solid var(--lounge-line);
      border-radius: 999px;
      font: 500 12px/1 "Helvetica Neue", system-ui, sans-serif;
      color: var(--lounge-dim);
    }
    .bp-k { letter-spacing: .06em; text-transform: uppercase; font-size: 11px; }
    .bp-select {
      background: transparent; color: var(--lounge-ink); border: none;
      font: 600 13px/1 "Helvetica Neue", system-ui, sans-serif;
      cursor: pointer; outline: none;
    }
    .bp-select option { background: #140b1e; color: var(--lounge-ink); }

    /* ------- Filter chips ------- */
    .lounge-filters {
      display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
      margin: 8px 0 36px; padding: 0 10px;
    }
    .chip {
      --chip-accent: var(--lounge-ink);
      display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 16px; border-radius: 999px;
      background: rgba(242,244,255,.03);
      border: 1px solid var(--lounge-line);
      color: var(--lounge-dim);
      font: 600 12.5px/1 "Helvetica Neue", system-ui, sans-serif;
      cursor: pointer;
      transition: all .18s ease;
    }
    .chip:hover { color: var(--lounge-ink); border-color: var(--lounge-line2); background: rgba(242,244,255,.055); }
    .chip.active {
      color: #000;
      background: var(--chip-accent);
      border-color: var(--chip-accent);
      box-shadow: 0 0 18px color-mix(in oklab, var(--chip-accent) 50%, transparent);
    }
    .chip-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--chip-accent); box-shadow: 0 0 8px var(--chip-accent); }
    .chip.active .chip-dot { background: rgba(0,0,0,.3); box-shadow: none; }
    .chip-n { opacity: .55; font-weight: 500; }

    /* ------- Sections ------- */
    .lounge-section { margin-bottom: 48px; }
    .sec-label {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 18px;
      font: 700 11px/1 "Helvetica Neue", system-ui, sans-serif;
      letter-spacing: .22em; text-transform: uppercase;
      color: var(--lounge-dim);
    }
    .sec-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--neon-cyan);
      box-shadow: 0 0 10px var(--neon-cyan);
    }
    .sec-dot.pink { background: var(--neon-pink); box-shadow: 0 0 10px var(--neon-pink); }
    .sec-count { margin-left: auto; opacity: .5; font-weight: 500; letter-spacing: .04em; }

    /* ------- Headliners grid (3-up) ------- */
    .headliners { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    @media (max-width: 820px) { .headliners { grid-template-columns: 1fr; } }

    /* ------- Set list grid ------- */
    .set-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }

    /* ------- Track card ------- */
    .track {
      --track-accent: var(--neon-pink);
      position: relative;
      background: var(--lounge-card);
      border: 1px solid var(--lounge-line);
      border-radius: 16px;
      overflow: hidden;
      cursor: pointer;
      transition: transform .25s ease, border-color .25s ease, background .25s ease, box-shadow .25s ease;
      display: flex; flex-direction: column;
    }
    .track:hover, .track:focus-visible {
      transform: translateY(-4px);
      background: var(--lounge-card-hover);
      border-color: color-mix(in oklab, var(--track-accent) 50%, var(--lounge-line));
      box-shadow:
        0 20px 48px color-mix(in oklab, var(--track-accent) 24%, transparent),
        0 0 0 1px color-mix(in oklab, var(--track-accent) 30%, transparent);
      outline: none;
    }

    .track-thumb {
      position: relative;
      aspect-ratio: 16 / 10;
      background: linear-gradient(135deg, rgba(242,244,255,.06), rgba(242,244,255,.02));
      overflow: hidden;
    }
    .track-img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .5s ease; }
    .track:hover .track-img { transform: scale(1.04); }
    .track-thumb.no-img { background: linear-gradient(135deg, color-mix(in oklab, var(--track-accent) 20%, transparent), rgba(0,0,0,0)); }
    .track-thumb.no-img::after {
      content: ""; position: absolute; inset: 0;
      background:
        radial-gradient(circle at 30% 40%, color-mix(in oklab, var(--track-accent) 45%, transparent), transparent 50%),
        radial-gradient(circle at 70% 70%, color-mix(in oklab, var(--neon-cyan) 25%, transparent), transparent 60%);
    }

    /* Rotating vinyl detail — subtle, in the corner */
    .track-vinyl {
      position: absolute; top: 10px; left: 10px;
      width: 32px; height: 32px; border-radius: 50%;
      background:
        radial-gradient(circle, #111 0%, #111 32%, rgba(255,255,255,.12) 33%, #0a0a0a 36%, #050505 100%);
      box-shadow: 0 2px 6px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08);
      animation: vinylSpin 7s linear infinite;
    }
    .track-vinyl::after {
      content: ""; position: absolute; inset: 11px; border-radius: 50%;
      background: var(--track-accent);
      box-shadow: 0 0 10px color-mix(in oklab, var(--track-accent) 70%, transparent);
    }
    @keyframes vinylSpin { to { transform: rotate(360deg); } }

    .track-cat {
      position: absolute; top: 10px; right: 10px;
      padding: 5px 10px; border-radius: 6px;
      background: rgba(0,0,0,.6);
      backdrop-filter: blur(6px);
      font: 700 10px/1 "Helvetica Neue", system-ui, sans-serif;
      letter-spacing: .14em; text-transform: uppercase;
      color: var(--track-accent);
      text-shadow: 0 0 6px color-mix(in oklab, var(--track-accent) 40%, transparent);
    }
    .track-play {
      position: absolute; bottom: 12px; right: 12px;
      width: 42px; height: 42px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: var(--track-accent);
      color: #000; font-size: 16px;
      box-shadow: 0 8px 20px color-mix(in oklab, var(--track-accent) 50%, transparent);
      opacity: 0; transform: translateY(10px);
      transition: opacity .25s ease, transform .25s ease;
    }
    .track:hover .track-play { opacity: 1; transform: translateY(0); }

    .track-info { padding: 16px 18px 10px; flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .track-title {
      font: 700 15px/1.35 "Helvetica Neue", system-ui, sans-serif;
      color: var(--lounge-ink); letter-spacing: -.01em;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .track-host { font: 500 12px/1.3 "Helvetica Neue", system-ui, sans-serif; color: var(--lounge-dim); letter-spacing: .01em; }
    .track-note {
      margin-top: 2px;
      font: 500 12.5px/1.5 "Helvetica Neue", system-ui, sans-serif;
      color: color-mix(in oklab, var(--lounge-ink) 68%, transparent);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .track-meta {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 18px 14px;
      border-top: 1px solid var(--lounge-line);
      margin-top: auto;
    }
    .track-plays {
      font: 600 10.5px/1 "Helvetica Neue", system-ui, sans-serif;
      letter-spacing: .12em; text-transform: uppercase;
      color: var(--lounge-dim);
    }
    .track-actions { display: flex; gap: 2px; opacity: 0; transition: opacity .18s ease; }
    .track:hover .track-actions, .track:focus-within .track-actions { opacity: 1; }
    .ta-btn {
      width: 28px; height: 28px; border-radius: 6px;
      background: transparent; border: 1px solid transparent;
      color: var(--lounge-dim); cursor: pointer; font-size: 13px;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all .14s ease;
    }
    .ta-btn:hover { background: rgba(242,244,255,.06); color: var(--lounge-ink); border-color: var(--lounge-line); }
    .ta-btn.danger:hover { color: var(--neon-pink); border-color: color-mix(in oklab, var(--neon-pink) 40%, transparent); }

    /* Big (headliner) variant — slightly bigger thumbnail, bolder title */
    .track.track-big { grid-column: span 1; }
    .track-big .track-thumb { aspect-ratio: 16 / 9; }
    .track-big .track-title { font-size: 17px; }

    /* Click confirmation pulse */
    .track-pulse {
      position: absolute; left: 50%; bottom: 60px; transform: translateX(-50%);
      padding: 7px 14px; border-radius: 999px;
      background: var(--track-accent); color: #000;
      font: 700 11px/1 "Helvetica Neue", system-ui, sans-serif;
      letter-spacing: .06em; text-transform: uppercase;
      box-shadow: 0 8px 20px color-mix(in oklab, var(--track-accent) 50%, transparent);
      animation: trackPulse 1.8s ease both;
      pointer-events: none; z-index: 2;
    }
    @keyframes trackPulse {
      0%   { opacity: 0; transform: translate(-50%, 10px); }
      20%  { opacity: 1; transform: translate(-50%, 0); }
      80%  { opacity: 1; transform: translate(-50%, 0); }
      100% { opacity: 0; transform: translate(-50%, -8px); }
    }

    /* ------- Empty state ------- */
    .lounge-empty {
      text-align: center; padding: 60px 20px 100px;
      max-width: 520px; margin: 0 auto;
    }
    .empty-vinyl {
      position: relative; width: 160px; height: 160px; margin: 0 auto 32px;
      border-radius: 50%;
      background: radial-gradient(circle, #0d0d12 0%, #050507 60%, #000 100%);
      box-shadow:
        0 0 60px color-mix(in oklab, var(--neon-pink) 25%, transparent),
        inset 0 0 0 2px rgba(255,255,255,.04);
      animation: vinylSpin 10s linear infinite;
    }
    .vinyl-ring {
      position: absolute; inset: 20px; border-radius: 50%;
      border: 1px dashed rgba(255,255,255,.1);
    }
    .vinyl-center {
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      width: 40px; height: 40px; border-radius: 50%;
      background: linear-gradient(135deg, var(--neon-pink), var(--neon-purple));
      box-shadow: 0 0 24px color-mix(in oklab, var(--neon-pink) 60%, transparent);
    }
    .lounge-empty h2 {
      margin: 0 0 10px;
      font: 800 36px/1.1 "Helvetica Neue", system-ui, sans-serif;
      color: var(--lounge-ink); letter-spacing: -.02em;
    }
    .lounge-empty p {
      margin: 0 0 28px;
      font: 400 15px/1.65 "Helvetica Neue", system-ui, sans-serif;
      color: var(--lounge-dim);
    }

    /* ------- Add/Edit modal ------- */
    .lm-scrim {
      position: fixed; inset: 0; z-index: 1500;
      background: rgba(0, 0, 0, .72);
      backdrop-filter: blur(10px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: lmFade .22s ease both;
    }
    @keyframes lmFade { from { opacity: 0; } to { opacity: 1; } }
    .lm-modal {
      background: linear-gradient(180deg, #140b1e 0%, #0a0b14 100%);
      border: 1px solid var(--lounge-line2);
      border-radius: 20px;
      width: 100%; max-width: 540px; max-height: 92vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow:
        0 40px 80px rgba(0, 0, 0, .6),
        0 0 0 1px rgba(255, 46, 159, .06),
        inset 0 1px 0 rgba(255,255,255,.04);
      color: var(--lounge-ink);
      animation: lmPop .28s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes lmPop { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }

    .lm-head {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 24px 28px 18px;
      border-bottom: 1px solid var(--lounge-line);
    }
    .lm-eyebrow { font: 700 10.5px/1 "Helvetica Neue", system-ui, sans-serif; letter-spacing: .22em; color: var(--neon-cyan); margin-bottom: 8px; }
    .lm-head h2 { margin: 0; font: 800 22px/1.2 "Helvetica Neue", system-ui, sans-serif; color: var(--lounge-ink); letter-spacing: -.015em; }
    .lm-close {
      width: 32px; height: 32px; border-radius: 8px;
      background: transparent; border: 1px solid var(--lounge-line);
      color: var(--lounge-dim); cursor: pointer;
      font: 400 20px/1 "Helvetica Neue", system-ui, sans-serif;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all .14s ease;
    }
    .lm-close:hover { color: var(--lounge-ink); border-color: var(--lounge-line2); }

    .lm-body {
      padding: 24px 28px;
      overflow-y: auto;
      display: flex; flex-direction: column; gap: 16px;
    }
    .lm-field { display: flex; flex-direction: column; gap: 8px; }
    .lm-k { font: 700 10.5px/1 "Helvetica Neue", system-ui, sans-serif; letter-spacing: .18em; text-transform: uppercase; color: var(--lounge-dim); }
    .lm-k small { font-weight: 500; letter-spacing: 0; text-transform: none; opacity: .7; margin-left: 6px; }
    .lm-field input, .lm-field select {
      width: 100%;
      padding: 12px 14px;
      background: rgba(242,244,255,.04);
      border: 1px solid var(--lounge-line);
      border-radius: 10px;
      color: var(--lounge-ink);
      font: 500 14px/1.3 "Helvetica Neue", system-ui, sans-serif;
      transition: border-color .18s ease, background .18s ease;
      outline: none;
      box-sizing: border-box;
    }
    .lm-field input:focus, .lm-field select:focus { border-color: color-mix(in oklab, var(--neon-pink) 70%, transparent); background: rgba(242,244,255,.07); }
    .lm-field input::placeholder { color: color-mix(in oklab, var(--lounge-dim) 75%, transparent); }
    .lm-field select option { background: #140b1e; color: var(--lounge-ink); }
    .lm-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 480px) { .lm-two { grid-template-columns: 1fr; } }

    .lm-preview {
      display: flex; gap: 14px; align-items: center;
      padding: 12px 14px;
      background: rgba(242,244,255,.04);
      border: 1px solid var(--lounge-line);
      border-radius: 12px;
    }
    .lmp-thumb {
      position: relative;
      width: 80px; height: 80px; border-radius: 10px;
      overflow: hidden; flex-shrink: 0;
      background: linear-gradient(135deg, color-mix(in oklab, var(--neon-pink) 25%, transparent), rgba(0,0,0,0));
    }
    .lmp-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .lmp-vinyl {
      position: absolute; right: 6px; bottom: 6px;
      width: 20px; height: 20px; border-radius: 50%;
      background: radial-gradient(circle, #111 0%, #111 32%, rgba(255,255,255,.1) 33%, #0a0a0a 36%, #050505 100%);
      box-shadow: 0 1px 4px rgba(0,0,0,.6);
      animation: vinylSpin 6s linear infinite;
    }
    .lmp-meta { flex: 1; min-width: 0; }
    .lmp-title {
      font: 700 14px/1.35 "Helvetica Neue", system-ui, sans-serif;
      color: var(--lounge-ink);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .lmp-host { font: 500 12px/1.3 "Helvetica Neue", system-ui, sans-serif; color: var(--lounge-dim); margin-top: 4px; }

    .lm-foot {
      display: flex; justify-content: flex-end; gap: 10px;
      padding: 18px 28px;
      border-top: 1px solid var(--lounge-line);
      background: rgba(0,0,0,.3);
    }
    .lm-btn {
      padding: 11px 22px; border-radius: 10px;
      font: 700 13px/1 "Helvetica Neue", system-ui, sans-serif;
      letter-spacing: .04em;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all .18s ease;
    }
    .lm-btn.ghost { background: transparent; color: var(--lounge-dim); border-color: var(--lounge-line); }
    .lm-btn.ghost:hover { color: var(--lounge-ink); border-color: var(--lounge-line2); }
    .lm-btn.primary {
      background: linear-gradient(135deg, var(--neon-pink), var(--neon-purple));
      color: #fff;
      box-shadow: 0 0 20px color-mix(in oklab, var(--neon-pink) 45%, transparent);
    }
    .lm-btn.primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 0 28px color-mix(in oklab, var(--neon-pink) 65%, transparent); }
    .lm-btn.primary:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }
  `;
  document.head.appendChild(s);
}
