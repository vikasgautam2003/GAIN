// Chill Hideout — user's curated list of escape sites.
// Add any URL → auto-fetches og:image + og:title → saves a card.
// Click a card → opens in the preferred browser (per-site > global default > system).
// Pin up to 3 cards; filter by category; delete / edit any time.

import { getRecreations, addRecreation, updateRecreation, deleteRecreation, openRecreation, fetchUrlPreview, getSettings, updateSettings, on } from "./store.js";

const BROWSERS = [
  { key: "",              label: "Default",  icon: "◉" },
  { key: "Brave Browser", label: "Brave",    icon: "🦁" },
  { key: "Google Chrome", label: "Chrome",   icon: "🅖" },
  { key: "Safari",        label: "Safari",   icon: "🧭" },
  { key: "Firefox",       label: "Firefox",  icon: "🦊" },
  { key: "Arc",           label: "Arc",      icon: "⌁" },
];

const CATEGORIES = {
  youtube:    { label: "YouTube",   icon: "🎥" },
  twitch:     { label: "Twitch",    icon: "🎮" },
  reddit:     { label: "Reddit",    icon: "👻" },
  x:          { label: "X",         icon: "𝕏" },
  music:      { label: "Music",     icon: "🎵" },
  instagram:  { label: "Instagram", icon: "📸" },
  reading:    { label: "Reading",   icon: "📖" },
  web:        { label: "Web",       icon: "🌐" },
};

function inferCategory(url) {
  const h = String(url || "").toLowerCase();
  if (/youtube\.com|youtu\.be/.test(h)) return "youtube";
  if (/twitch\.tv/.test(h)) return "twitch";
  if (/reddit\.com/.test(h)) return "reddit";
  if (/twitter\.com|x\.com/.test(h)) return "x";
  if (/spotify\.com|soundcloud\.com|music\.apple|bandcamp/.test(h)) return "music";
  if (/instagram\.com/.test(h)) return "instagram";
  if (/medium\.com|substack\.com|dev\.to|hackernoon/.test(h)) return "reading";
  return "web";
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }

let activeFilter = "all";
let unsub = null;

export default {
  async mount(root) {
    injectStyles();
    root.innerHTML = render();
    paint(root);
    attach(root);
    if (unsub) unsub();
    unsub = on((ev) => { if (ev === "recreations" || ev === "settings") paint(root); });
  },
  unmount() { if (unsub) { unsub(); unsub = null; } }
};

function render() {
  return `
    <div class="view-inner chill">
      <header class="chill-head">
        <div class="disco-ball" aria-hidden="true">🪩</div>
        <div class="disco-sparkles">
          <span>✨</span><span>⭐</span><span>💫</span><span>✨</span><span>🌟</span>
        </div>
        <div class="chill-eyebrow">💃 CHILL HIDEOUT 🕺</div>
        <h1 class="chill-title">Your dance floor.</h1>
        <p class="chill-lede">Burn out? Get down. One click, your browser, pure vibes.</p>
        <div class="chill-head-actions">
          <button class="chill-add-cta" id="chill-add">+ Add an escape</button>
          <div class="chill-browser-pref">
            <span class="cbp-label">Default browser:</span>
            <select id="chill-browser-global">
              ${BROWSERS.map(b => `<option value="${esc(b.key)}">${esc(b.label)}</option>`).join("")}
            </select>
          </div>
        </div>
      </header>

      <section class="chill-pinned" id="chill-pinned" hidden>
        <div class="chill-sec-head">📌 Pinned</div>
        <div class="chill-pin-grid" id="chill-pin-grid"></div>
      </section>

      <nav class="chill-filters" id="chill-filters"></nav>

      <section class="chill-grid-wrap">
        <div class="chill-grid" id="chill-grid"></div>
        <div class="chill-empty" id="chill-empty" hidden>
          <div class="chill-empty-ico">🎧</div>
          <div class="chill-empty-title">No escapes yet.</div>
          <div class="chill-empty-sub">Add a YouTube channel, a Reddit thread, a music playlist — anything that resets you when the work gets heavy.</div>
          <button class="chill-add-cta" id="chill-empty-add">+ Add your first escape</button>
        </div>
      </section>

      <!-- Add/Edit modal -->
      <div class="chill-scrim" id="chill-scrim" hidden>
        <div class="chill-modal" role="dialog" aria-label="Add escape">
          <header class="cm-head">
            <h2 id="chill-modal-title">Add an escape</h2>
            <button class="cm-close" id="chill-modal-close" aria-label="Close">✕</button>
          </header>
          <div class="cm-body">
            <label class="cm-field">
              <span class="cm-k">URL</span>
              <input id="chill-url" type="url" placeholder="https://youtube.com/@…" autocomplete="off" />
              <span class="cm-help" id="chill-url-help">Paste any https:// link. We'll auto-fetch the preview.</span>
            </label>
            <div class="cm-preview" id="chill-preview" hidden>
              <img class="cm-preview-img" id="chill-preview-img" alt="" />
              <div class="cm-preview-meta">
                <div class="cm-preview-title" id="chill-preview-title">—</div>
                <div class="cm-preview-host" id="chill-preview-host">—</div>
              </div>
            </div>
            <label class="cm-field">
              <span class="cm-k">Title</span>
              <input id="chill-title" type="text" placeholder="What to call this?" />
            </label>
            <label class="cm-field">
              <span class="cm-k">Note <small>(optional)</small></span>
              <input id="chill-note" type="text" maxlength="120" placeholder="Why you come here" />
            </label>
            <div class="cm-two">
              <label class="cm-field">
                <span class="cm-k">Category</span>
                <select id="chill-category">
                  ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join("")}
                </select>
              </label>
              <label class="cm-field">
                <span class="cm-k">Open in</span>
                <select id="chill-browser">
                  ${BROWSERS.map(b => `<option value="${esc(b.key)}">${esc(b.label)}</option>`).join("")}
                </select>
              </label>
            </div>
          </div>
          <footer class="cm-foot">
            <button class="cm-btn ghost" id="chill-modal-cancel">Cancel</button>
            <button class="cm-btn primary" id="chill-modal-save" disabled>Save</button>
          </footer>
        </div>
      </div>
    </div>
  `;
}

function paint(root) {
  const recs = getRecreations();
  const settings = getSettings();
  const globalSel = root.querySelector("#chill-browser-global");
  if (globalSel) globalSel.value = settings.recreationBrowser || "";

  const pinned = recs.filter(r => r.pinned).slice(0, 3);
  const pinSec = root.querySelector("#chill-pinned");
  const pinGrid = root.querySelector("#chill-pin-grid");
  if (pinSec && pinGrid) {
    if (pinned.length) {
      pinSec.hidden = false;
      pinGrid.innerHTML = pinned.map(r => cardHtml(r, { big: true })).join("");
    } else {
      pinSec.hidden = true;
      pinGrid.innerHTML = "";
    }
  }

  // Filter chips
  const nav = root.querySelector("#chill-filters");
  if (nav) {
    const cats = Array.from(new Set(recs.map(r => r.category || "web")));
    const chips = ["all", ...cats];
    nav.innerHTML = chips.map(c => {
      const meta = CATEGORIES[c] || { label: "All", icon: "◉" };
      const label = c === "all" ? "All" : meta.label;
      const icon = c === "all" ? "◉" : meta.icon;
      const n = c === "all" ? recs.length : recs.filter(r => (r.category || "web") === c).length;
      return `<button class="chip ${c === activeFilter ? "active" : ""}" data-cat="${esc(c)}"><span class="ci">${icon}</span>${esc(label)}<span class="cn">${n}</span></button>`;
    }).join("");
    nav.hidden = recs.length === 0;
  }

  const grid = root.querySelector("#chill-grid");
  const empty = root.querySelector("#chill-empty");
  const unpinned = recs.filter(r => !r.pinned);
  const visible = activeFilter === "all" ? unpinned : unpinned.filter(r => (r.category || "web") === activeFilter);
  visible.sort((a, b) => (b.openedCount || 0) - (a.openedCount || 0) || (b.addedAt || 0) - (a.addedAt || 0));

  if (!recs.length) {
    grid.hidden = true;
    if (empty) empty.hidden = false;
  } else {
    grid.hidden = false;
    if (empty) empty.hidden = true;
    grid.innerHTML = visible.map(r => cardHtml(r, { big: false })).join("");
  }
}

function cardHtml(r, { big }) {
  const cat = CATEGORIES[r.category] || CATEGORIES.web;
  const emoji = r.emoji || cat.icon;
  const host = (() => { try { return new URL(r.url).host.replace(/^www\./, ""); } catch { return r.url; }})();
  const img = r.imageUrl
    ? `<img class="rc-thumb" src="${esc(r.imageUrl)}" alt="" onerror="this.style.display='none';this.parentNode.querySelector('.rc-emoji').style.display='flex';" />`
    : "";
  return `
    <article class="rc-card ${big ? "big" : ""}" data-id="${esc(r.id)}" tabindex="0">
      <div class="rc-thumb-wrap">
        ${img}
        <div class="rc-emoji" ${r.imageUrl ? 'style="display:none;"' : ""}>${esc(emoji)}</div>
        <div class="rc-cat-badge">${cat.icon} ${esc(cat.label)}</div>
      </div>
      <div class="rc-body">
        <div class="rc-title">${esc(r.title || host)}</div>
        <div class="rc-host">${esc(host)}</div>
        ${r.note ? `<div class="rc-note">${esc(r.note)}</div>` : ""}
        <div class="rc-foot">
          <span class="rc-opens">${(r.openedCount || 0) > 0 ? `✓ opened ${r.openedCount}×` : "new"}</span>
          <div class="rc-actions">
            <button class="rc-btn" data-act="pin" title="${r.pinned ? "Unpin" : "Pin to top"}">${r.pinned ? "📌" : "📍"}</button>
            <button class="rc-btn" data-act="edit" title="Edit">✎</button>
            <button class="rc-btn" data-act="del" title="Delete">×</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function attach(root) {
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
  let fetchedPreview = { imageUrl: "", title: "" };

  const openModal = (rec = null) => {
    editingId = rec?.id || null;
    modalTitle.textContent = rec ? "Edit escape" : "Add an escape";
    urlEl.value = rec?.url || "";
    titleEl.value = rec?.title || "";
    noteEl.value = rec?.note || "";
    catEl.value = rec?.category || "web";
    browserEl.value = rec?.browser || "";
    fetchedPreview = { imageUrl: rec?.imageUrl || "", title: "" };
    previewEl.hidden = !rec?.imageUrl;
    if (rec?.imageUrl) { previewImg.src = rec.imageUrl; previewTitle.textContent = rec.title || ""; previewHost.textContent = hostOf(rec.url); }
    saveBtn.disabled = !urlEl.value.trim();
    scrim.hidden = false;
    setTimeout(() => urlEl.focus(), 20);
  };
  const closeModal = () => { scrim.hidden = true; editingId = null; };

  root.querySelector("#chill-add")?.addEventListener("click", () => openModal());
  root.querySelector("#chill-empty-add")?.addEventListener("click", () => openModal());
  root.querySelector("#chill-modal-close")?.addEventListener("click", closeModal);
  root.querySelector("#chill-modal-cancel")?.addEventListener("click", closeModal);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeModal(); });

  // URL input: debounced preview fetch
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
    previewTitle.textContent = "Fetching preview…";
    previewHost.textContent = hostOf(u);
    // Infer category immediately
    catEl.value = inferCategory(u);
    try {
      const p = await fetchUrlPreview(u);
      fetchedPreview = { imageUrl: p.imageUrl, title: p.title };
      if (p.imageUrl) previewImg.src = p.imageUrl;
      previewTitle.textContent = p.title || hostOf(u);
      if (!titleEl.value.trim()) titleEl.value = p.title || hostOf(u);
    } catch (e) {
      previewTitle.textContent = "Could not fetch preview (will use favicon)";
    }
  };
  urlEl.addEventListener("input", () => {
    saveBtn.disabled = !urlEl.value.trim();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(fetchPreview, 400);
  });

  saveBtn.addEventListener("click", async () => {
    const url = urlEl.value.trim();
    if (!url) return;
    const payload = {
      url,
      title: titleEl.value.trim() || hostOf(url),
      note: noteEl.value.trim(),
      category: catEl.value,
      browser: browserEl.value,
      imageUrl: fetchedPreview.imageUrl || "",
    };
    if (editingId) await updateRecreation(editingId, payload);
    else await addRecreation(payload);
    closeModal();
  });

  // Delegate click/action on grid + pinned
  const handleCardClick = async (ev) => {
    const actBtn = ev.target.closest?.("[data-act]");
    const card = ev.target.closest?.(".rc-card");
    if (!card) return;
    const id = card.dataset.id;
    const rec = getRecreations().find(r => r.id === id);
    if (!rec) return;
    if (actBtn) {
      ev.stopPropagation();
      const act = actBtn.dataset.act;
      if (act === "pin") {
        if (!rec.pinned && getRecreations().filter(r => r.pinned).length >= 3) {
          flashCard(card, "Max 3 pinned");
          return;
        }
        await updateRecreation(id, { pinned: !rec.pinned });
      } else if (act === "edit") { openModal(rec); }
      else if (act === "del") {
        if (confirm(`Delete "${rec.title || hostOf(rec.url)}"?`)) await deleteRecreation(id);
      }
      return;
    }
    // Click card body → open
    await openRecreation(rec);
    flashCard(card, "Opened in browser");
  };
  root.querySelector("#chill-grid")?.addEventListener("click", handleCardClick);
  root.querySelector("#chill-pin-grid")?.addEventListener("click", handleCardClick);
  // Keyboard: Enter on focused card opens it
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList?.contains?.("rc-card")) {
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

function hostOf(u) {
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; }
}

function flashCard(card, msg) {
  const old = card.querySelector(".rc-flash");
  if (old) old.remove();
  const t = document.createElement("div");
  t.className = "rc-flash";
  t.textContent = msg;
  card.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

function injectStyles() {
  if (document.getElementById("chill-styles")) return;
  const s = document.createElement("style");
  s.id = "chill-styles";
  s.textContent = `
    .chill {
      max-width: 1140px; margin: 0 auto; padding: 0 24px 60px;
      --disco-pink: #ff3399;
      --disco-cyan: #00e0ff;
      --disco-gold: #ffd600;
      --disco-purple: #9c27f0;
      --disco-orange: #ff6a00;
    }
    .chill-head {
      position: relative; text-align: center; padding: 60px 20px 36px;
      overflow: hidden; border-radius: 24px; margin-bottom: 20px;
      background:
        radial-gradient(circle at 15% 20%, color-mix(in oklab, var(--disco-pink) 24%, transparent) 0%, transparent 45%),
        radial-gradient(circle at 85% 20%, color-mix(in oklab, var(--disco-cyan) 24%, transparent) 0%, transparent 45%),
        radial-gradient(circle at 50% 90%, color-mix(in oklab, var(--disco-gold) 20%, transparent) 0%, transparent 50%),
        var(--paper);
    }
    .disco-ball {
      display: inline-block;
      font-size: 68px; line-height: 1;
      margin-bottom: 14px;
      animation: discoSpin 6s linear infinite, discoBob 3s ease-in-out infinite;
      transform-origin: center;
      filter: drop-shadow(0 0 24px color-mix(in oklab, var(--disco-pink) 40%, transparent)) drop-shadow(0 0 14px color-mix(in oklab, var(--disco-cyan) 35%, transparent));
    }
    @keyframes discoSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes discoBob { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-8px) rotate(180deg); } }
    .disco-sparkles {
      position: absolute; inset: 0; pointer-events: none;
      display: flex; justify-content: space-around; align-items: center;
      padding: 0 10%; font-size: 20px;
    }
    .disco-sparkles span {
      opacity: .55; animation: sparkle 2.4s ease-in-out infinite;
    }
    .disco-sparkles span:nth-child(1) { animation-delay: 0s; transform: translateY(-20px); }
    .disco-sparkles span:nth-child(2) { animation-delay: .3s; transform: translateY(30px); }
    .disco-sparkles span:nth-child(3) { animation-delay: .7s; transform: translateY(-10px); }
    .disco-sparkles span:nth-child(4) { animation-delay: 1.1s; transform: translateY(20px); }
    .disco-sparkles span:nth-child(5) { animation-delay: 1.5s; transform: translateY(-24px); }
    @keyframes sparkle { 0%, 100% { opacity: .25; transform: scale(.9) translateY(0); } 50% { opacity: 1; transform: scale(1.3) translateY(-6px); } }

    .chill-eyebrow {
      font: 700 14px/1 var(--font-sans); letter-spacing: .18em;
      background: linear-gradient(90deg, var(--disco-pink), var(--disco-purple), var(--disco-cyan));
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 14px;
    }
    .chill-title {
      font: 800 54px/1.04 var(--font-sans); letter-spacing: -.028em; margin: 0 0 12px;
      background: linear-gradient(135deg, var(--disco-pink) 0%, var(--disco-gold) 50%, var(--disco-cyan) 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .chill-lede { font: 500 17px/1.55 var(--font-sans); color: var(--ink); opacity: .8; margin: 0 auto 24px; max-width: 540px; }
    .chill-head-actions { display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap; position: relative; z-index: 2; }
    .chill-add-cta {
      padding: 14px 28px; border-radius: 999px;
      background: linear-gradient(135deg, var(--disco-pink), var(--disco-purple));
      color: #fff; border: none;
      font: 800 15px/1 var(--font-sans); letter-spacing: .005em;
      cursor: pointer; transition: all .22s;
      box-shadow: 0 8px 24px color-mix(in oklab, var(--disco-pink) 40%, transparent);
    }
    .chill-add-cta:hover { transform: translateY(-2px); box-shadow: 0 14px 32px color-mix(in oklab, var(--disco-pink) 55%, transparent); }
    .chill-browser-pref { display: inline-flex; align-items: center; gap: 8px; font: 500 12.5px/1 var(--font-sans); color: var(--mut); }
    .cbp-label { letter-spacing: .02em; }
    .chill-browser-pref select {
      padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
      background: var(--paper); color: var(--ink); font: 500 12.5px/1 var(--font-sans);
    }

    .chill-pinned { margin: 30px 0; }
    .chill-sec-head { font: 700 11px/1 var(--font-sans); letter-spacing: .18em; text-transform: uppercase; color: var(--mut); margin-bottom: 12px; }
    .chill-pin-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    @media (max-width: 720px) { .chill-pin-grid { grid-template-columns: 1fr; } }

    .chill-filters { display: flex; gap: 8px; margin: 24px 0 18px; overflow-x: auto; padding-bottom: 4px; }
    .chill-filters::-webkit-scrollbar { height: 4px; }
    .chill-filters .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 14px; border-radius: 999px;
      background: var(--paper); border: 1px solid var(--line);
      color: var(--mut); font: 600 12.5px/1 var(--font-sans);
      cursor: pointer; transition: all .18s; white-space: nowrap;
    }
    .chill-filters .chip:hover { color: var(--ink); border-color: var(--line2); }
    .chill-filters .chip.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .chill-filters .chip .cn { opacity: .7; margin-left: 4px; font-weight: 500; }
    .chill-filters .chip .ci { font-size: 13px; }

    .chill-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }

    .rc-card {
      background: var(--paper); border: 1px solid var(--line);
      border-radius: 14px; overflow: hidden; cursor: pointer;
      transition: all .22s; display: flex; flex-direction: column;
      position: relative;
    }
    .rc-card:hover, .rc-card:focus-visible {
      transform: translateY(-4px) rotate(-.4deg);
      box-shadow:
        0 14px 32px color-mix(in oklab, var(--disco-pink) 18%, transparent),
        0 4px 10px color-mix(in oklab, var(--disco-cyan) 14%, transparent);
      border-color: color-mix(in oklab, var(--disco-pink) 40%, var(--line));
      outline: none;
    }
    .rc-card:nth-child(3n+1):hover { transform: translateY(-4px) rotate(.4deg); box-shadow: 0 14px 32px color-mix(in oklab, var(--disco-cyan) 20%, transparent), 0 4px 10px color-mix(in oklab, var(--disco-gold) 14%, transparent); border-color: color-mix(in oklab, var(--disco-cyan) 40%, var(--line)); }
    .rc-card:nth-child(3n+2):hover { box-shadow: 0 14px 32px color-mix(in oklab, var(--disco-gold) 20%, transparent), 0 4px 10px color-mix(in oklab, var(--disco-purple) 14%, transparent); border-color: color-mix(in oklab, var(--disco-gold) 42%, var(--line)); }
    .rc-card.big { grid-column: span 1; }
    .rc-thumb-wrap {
      position: relative; aspect-ratio: 16 / 9;
      background: linear-gradient(135deg, color-mix(in oklab, var(--ink) 6%, var(--paper)), var(--paper));
      overflow: hidden;
    }
    .rc-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
    .rc-emoji {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 52px;
    }
    .rc-cat-badge {
      position: absolute; top: 8px; right: 8px;
      padding: 4px 8px; border-radius: 6px;
      background: rgba(0,0,0,.68); color: #fff;
      font: 700 10px/1 var(--font-sans); letter-spacing: .06em; text-transform: uppercase;
      backdrop-filter: blur(4px);
    }
    .rc-body { padding: 12px 14px 10px; display: flex; flex-direction: column; gap: 4px; }
    .rc-title {
      font: 700 14.5px/1.35 var(--font-sans); color: var(--ink);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .rc-host { font: 500 11.5px/1.3 var(--font-sans); color: var(--mut); }
    .rc-note { font: 500 12.5px/1.4 var(--font-sans); color: var(--ink); opacity: .78; margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .rc-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line); }
    .rc-opens { font: 500 10.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .04em; }
    .rc-actions { display: flex; gap: 2px; opacity: 0; transition: opacity .18s; }
    .rc-card:hover .rc-actions, .rc-card:focus-within .rc-actions { opacity: 1; }
    .rc-btn {
      width: 26px; height: 26px; border-radius: 5px;
      background: transparent; border: 1px solid transparent;
      color: var(--mut); cursor: pointer; font-size: 12px;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all .14s;
    }
    .rc-btn:hover { background: var(--bg); color: var(--ink); border-color: var(--line); }
    .rc-flash {
      position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%);
      padding: 6px 12px; border-radius: 20px;
      background: var(--ink); color: var(--paper);
      font: 600 11px/1 var(--font-sans); letter-spacing: .02em;
      animation: rcFlash 1.6s ease both;
      pointer-events: none;
    }
    @keyframes rcFlash {
      0% { opacity: 0; transform: translate(-50%, 6px); }
      18%, 70% { opacity: 1; transform: translate(-50%, 0); }
      100% { opacity: 0; transform: translate(-50%, -6px); }
    }

    .chill-empty { text-align: center; padding: 80px 20px; }
    .chill-empty-ico { font-size: 56px; margin-bottom: 14px; }
    .chill-empty-title { font: 700 20px/1.3 var(--font-sans); color: var(--ink); margin-bottom: 8px; }
    .chill-empty-sub { font: 500 14px/1.6 var(--font-sans); color: var(--mut); max-width: 400px; margin: 0 auto 24px; }

    /* ---- Add/Edit modal ---- */
    .chill-scrim {
      position: fixed; inset: 0; z-index: 1200;
      background: rgba(8,10,14,.6);
      backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: cmFade .2s ease both;
    }
    @keyframes cmFade { from { opacity: 0; } to { opacity: 1; } }
    .chill-modal {
      background: var(--paper); border-radius: 18px;
      width: 100%; max-width: 540px; max-height: 90vh;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 30px 70px rgba(0,0,0,.35), 0 0 0 1px var(--line);
      animation: cmPop .25s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes cmPop { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .cm-head { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--line); }
    .cm-head h2 { margin: 0; font: 700 18px/1.2 var(--font-sans); color: var(--ink); letter-spacing: -.01em; }
    .cm-close { border: none; background: transparent; color: var(--mut); cursor: pointer; width: 32px; height: 32px; border-radius: 8px; font-size: 18px; transition: all .18s; }
    .cm-close:hover { background: var(--bg); color: var(--ink); }
    .cm-body { padding: 20px 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
    .cm-field { display: flex; flex-direction: column; gap: 6px; }
    .cm-k { font: 700 11px/1 var(--font-sans); letter-spacing: .12em; text-transform: uppercase; color: var(--mut); }
    .cm-k small { font-weight: 500; letter-spacing: 0; text-transform: none; opacity: .8; margin-left: 4px; }
    .cm-field input, .cm-field select {
      padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px;
      background: var(--paper); color: var(--ink);
      font: 500 14px/1 var(--font-sans);
    }
    .cm-field input:focus, .cm-field select:focus { outline: none; border-color: var(--ink); }
    .cm-help { font: 400 11.5px/1.4 var(--font-sans); color: var(--mut); }
    .cm-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 480px) { .cm-two { grid-template-columns: 1fr; } }
    .cm-preview {
      display: flex; gap: 12px; align-items: center;
      padding: 10px 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
    }
    .cm-preview-img { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; background: var(--line); flex-shrink: 0; }
    .cm-preview-meta { min-width: 0; flex: 1; }
    .cm-preview-title { font: 700 13px/1.3 var(--font-sans); color: var(--ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .cm-preview-host { font: 500 11.5px/1.3 var(--font-sans); color: var(--mut); margin-top: 2px; }
    .cm-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 24px; border-top: 1px solid var(--line); background: color-mix(in oklab, var(--bg) 50%, var(--paper)); }
    .cm-btn { padding: 10px 20px; border-radius: 8px; cursor: pointer; font: 600 13px/1 var(--font-sans); border: 1px solid var(--line); transition: all .18s; }
    .cm-btn.ghost { background: var(--paper); color: var(--mut); }
    .cm-btn.ghost:hover { color: var(--ink); border-color: var(--line2); }
    .cm-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .cm-btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
    .cm-btn.primary:disabled { opacity: .45; cursor: not-allowed; }
  `;
  document.head.appendChild(s);
}
