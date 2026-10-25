// The Hideout — cinematic edition.
// User-created Collections replace fixed categories. Each collection is a
// full-bleed scene with giant display title, floating poster card, and CTAs.
// Sites inside render as smart layered cards (favicon-wash backdrop +
// og:image overlay). GSAP drives entrance reveals + 3D hover tilt.
//
// Four unique features from the Dreamland pass carry over:
//   • Mood ring
//   • Visit journal
//   • Opening ritual (3-second breath)
//   • Surprise me (weighted random)

import {
  getRecreations, addRecreation, updateRecreation, deleteRecreation,
  openRecreation, fetchUrlPreview, getSettings, updateSettings,
  addRecreationJournal, on,
  getCollections, addCollection, updateCollection, deleteCollection,
} from "./store.js";

const BROWSERS = [
  { key: "",              label: "System default" },
  { key: "Brave Browser", label: "Brave" },
  { key: "Google Chrome", label: "Chrome" },
  { key: "Safari",        label: "Safari" },
  { key: "Firefox",       label: "Firefox" },
  { key: "Arc",           label: "Arc" },
];

const MOODS = [
  { key: "chill",    label: "Chill",    color: "#9fe8d7", emoji: "💭" },
  { key: "laugh",    label: "Laugh",    color: "#ff8aa8", emoji: "😄" },
  { key: "focus",    label: "Focus",    color: "#c9a9ff", emoji: "🎯" },
  { key: "energize", label: "Energize", color: "#ffd45e", emoji: "⚡" },
];
const MOOD_BY_KEY = Object.fromEntries(MOODS.map(m => [m.key, m]));

const UNCATEGORIZED = { id: "", name: "Side quests", accent: "#c9a9ff", description: "Spots without a collection yet.", coverImage: "" };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}
function hostOf(u) { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } }
function faviconUrl(url, size = 256) { return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=${size}`; }

let unsub = null;
let currentRoot = null;
let gsapReady = null;

export default {
  async mount(root) {
    currentRoot = root;
    injectFonts();
    injectStyles();
    gsapReady = loadGsap();
    root.innerHTML = render();
    paint(root);
    wire(root);
    if (unsub) unsub();
    unsub = on((ev) => { if (ev === "recreations" || ev === "settings" || ev === "collections") paint(root); });
    const view = document.getElementById("view");
    if (view) view.classList.add("hideout-active");
    maybePromptJournal(root);
    window.addEventListener("focus", onFocusCheck);
    // Fire GSAP reveals after gsap loads AND after first paint
    gsapReady.then(gsap => animateInitial(gsap, root)).catch(() => {});
  },
  unmount() {
    if (unsub) { unsub(); unsub = null; }
    const view = document.getElementById("view");
    if (view) view.classList.remove("hideout-active");
    window.removeEventListener("focus", onFocusCheck);
    currentRoot = null;
  },
};

function onFocusCheck() { if (currentRoot) maybePromptJournal(currentRoot); }

// ============ RENDER ============
function render() {
  return `
    <div class="hd" id="hd-root">
      <!-- MAIN HERO -->
      <section class="hd-hero">
        <div class="hd-hero-blobs" aria-hidden="true">
          <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>
        </div>
        <div class="hd-hero-stars" aria-hidden="true">
          ${Array(14).fill('<span class="star"></span>').join("")}
        </div>
        <div class="hd-hero-inner">
          <div class="hd-eyebrow">YOUR PRIVATE PARK · AFTER HOURS</div>
          <h1 class="hd-wordmark" data-split>THE HIDEOUT.</h1>
          <p class="hd-tag">A small park of favourite places. Build a collection, step through, come back when you're ready.</p>
          <div class="hd-cta-row">
            <button class="hd-btn primary" id="hd-add">
              <span class="hd-plus">+</span><span>Add a spot</span>
            </button>
            <button class="hd-btn mystery" id="hd-surprise">
              <span class="hd-spark"></span><span>Surprise me</span>
            </button>
            <button class="hd-btn ghost" id="hd-new-collection">
              <span>⚐</span><span>New collection</span>
            </button>
            <label class="hd-pref">
              <span class="hd-pref-k">Open in</span>
              <select id="hd-browser-global" class="hd-pref-sel">
                ${BROWSERS.map(b => `<option value="${esc(b.key)}">${esc(b.label)}</option>`).join("")}
              </select>
            </label>
          </div>
        </div>
      </section>

      <!-- COLLECTION SCENES -->
      <main class="hd-main" id="hd-main"></main>

      <!-- EMPTY -->
      <section class="hd-empty" id="hd-empty" hidden>
        <div class="hd-empty-illus">✦</div>
        <h2 class="hd-empty-title">The gates are open.</h2>
        <p class="hd-empty-sub">Build your first collection or drop a link to begin.</p>
      </section>

      <!-- SITE ADD/EDIT MODAL -->
      <div class="hd-scrim" id="hd-scrim" hidden>
        <div class="hd-modal" role="dialog">
          <header class="hd-m-head">
            <div class="hd-m-eyebrow">NEW SPOT</div>
            <button class="hd-m-close" id="hd-m-close" aria-label="Close">×</button>
          </header>
          <div class="hd-m-body">
            <label class="hd-m-field">
              <span class="hd-m-k">Link</span>
              <input id="hd-url" type="url" placeholder="paste any https:// link" autocomplete="off" spellcheck="false" />
            </label>
            <div class="hd-m-preview" id="hd-m-preview" hidden>
              <div class="hd-m-thumb-wrap"><img id="hd-m-preview-img" alt="" /></div>
              <div class="hd-m-meta">
                <div class="hd-m-ptitle" id="hd-m-preview-title">—</div>
                <div class="hd-m-phost" id="hd-m-preview-host">—</div>
              </div>
            </div>
            <label class="hd-m-field">
              <span class="hd-m-k">Name</span>
              <input id="hd-title" type="text" />
            </label>
            <label class="hd-m-field">
              <span class="hd-m-k">Note <small>optional</small></span>
              <input id="hd-note" type="text" maxlength="120" placeholder="why you come here" />
            </label>
            <div class="hd-m-two">
              <label class="hd-m-field">
                <span class="hd-m-k">Collection</span>
                <select id="hd-collection"></select>
              </label>
              <label class="hd-m-field">
                <span class="hd-m-k">Open in</span>
                <select id="hd-browser">
                  ${BROWSERS.map(b => `<option value="${esc(b.key)}">${esc(b.label)}</option>`).join("")}
                </select>
              </label>
            </div>
            <div class="hd-m-field">
              <span class="hd-m-k">Mood ring</span>
              <div class="hd-mood-row" id="hd-mood-row">
                ${MOODS.map(m => `<button type="button" class="hd-mood-chip" data-mood="${m.key}" style="--mood: ${m.color}">
                  <span class="hd-mood-dot"></span>${esc(m.emoji)} ${esc(m.label)}
                </button>`).join("")}
                <button type="button" class="hd-mood-chip" data-mood="" style="--mood: #d0cbd4">
                  <span class="hd-mood-dot"></span>No mood
                </button>
              </div>
            </div>
            <label class="hd-m-field">
              <span class="hd-m-k">Cover image <small>paste URL or leave for auto</small></span>
              <input id="hd-cover-url" type="url" placeholder="https://... (optional override)" />
            </label>
          </div>
          <footer class="hd-m-foot">
            <button class="hd-m-btn ghost" id="hd-m-cancel">Cancel</button>
            <button class="hd-m-btn primary" id="hd-m-save" disabled>Save</button>
          </footer>
        </div>
      </div>

      <!-- COLLECTION MODAL -->
      <div class="hd-scrim" id="hd-cscrim" hidden>
        <div class="hd-modal" role="dialog">
          <header class="hd-m-head">
            <div class="hd-m-eyebrow">COLLECTION</div>
            <button class="hd-m-close" id="hd-c-close" aria-label="Close">×</button>
          </header>
          <div class="hd-m-body">
            <label class="hd-m-field">
              <span class="hd-m-k">Name</span>
              <input id="hd-c-name" type="text" placeholder="Comics / Novels / Music / Threads …" />
            </label>
            <label class="hd-m-field">
              <span class="hd-m-k">Tagline <small>optional</small></span>
              <input id="hd-c-desc" type="text" maxlength="140" placeholder="one line about this park" />
            </label>
            <label class="hd-m-field">
              <span class="hd-m-k">Cover image URL <small>optional</small></span>
              <input id="hd-c-cover" type="url" placeholder="https://..." />
            </label>
            <div class="hd-m-field">
              <span class="hd-m-k">Accent colour</span>
              <div class="hd-color-row" id="hd-c-colors">
                ${["#ff8aa8","#ffb47a","#ffd45e","#9fe8d7","#4ec8c0","#c9a9ff","#8b6cff","#ff5e5e","#5ec8ff"].map(c =>
                  `<button type="button" class="hd-color-chip" data-color="${c}" style="--c: ${c}"></button>`).join("")}
              </div>
            </div>
          </div>
          <footer class="hd-m-foot">
            <button class="hd-m-btn danger" id="hd-c-delete" hidden>Delete collection</button>
            <div style="flex:1"></div>
            <button class="hd-m-btn ghost" id="hd-c-cancel">Cancel</button>
            <button class="hd-m-btn primary" id="hd-c-save" disabled>Save</button>
          </footer>
        </div>
      </div>

      <!-- RITUAL -->
      <div class="hd-ritual" id="hd-ritual" hidden>
        <div class="hd-ritual-glow"></div>
        <div class="hd-ritual-inner">
          <div class="hd-ritual-breath"></div>
          <div class="hd-ritual-text">
            <div class="hd-ritual-eyebrow">Opening</div>
            <div class="hd-ritual-title" id="hd-ritual-title">—</div>
            <div class="hd-ritual-sub">Breathe in. Set your table. We'll be here when you're back.</div>
          </div>
        </div>
      </div>

      <!-- JOURNAL PROMPT -->
      <div class="hd-journal" id="hd-journal" hidden>
        <div class="hd-journal-inner">
          <div class="hd-journal-head">
            <span class="hd-journal-eyebrow">Just back from</span>
            <strong id="hd-journal-site">—</strong>
            <button class="hd-journal-close" id="hd-journal-close" aria-label="Dismiss">×</button>
          </div>
          <div class="hd-journal-row">
            <input id="hd-journal-input" type="text" placeholder="one line — what happened there?" maxlength="200" />
            <button class="hd-btn primary small" id="hd-journal-save">Save</button>
            <button class="hd-btn ghost small" id="hd-journal-skip">Skip</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============ PAINT ============
function paint(root) {
  const recs = getRecreations();
  const collections = getCollections();
  const settings = getSettings();

  const globalSel = root.querySelector("#hd-browser-global");
  if (globalSel) globalSel.value = settings.recreationBrowser || "";

  // Keep add-modal collection select in sync
  const collSelect = root.querySelector("#hd-collection");
  if (collSelect) {
    const current = collSelect.value;
    collSelect.innerHTML = collections.map(c =>
      `<option value="${esc(c.id)}">${esc(c.name)}</option>`
    ).join("") + `<option value="">— ${esc(UNCATEGORIZED.name)}</option>`;
    collSelect.value = current || (collections[0]?.id || "");
  }

  const main = root.querySelector("#hd-main");
  const empty = root.querySelector("#hd-empty");

  if (!recs.length && !collections.length) {
    if (empty) empty.hidden = false;
    if (main) main.innerHTML = "";
    return;
  }
  if (empty) empty.hidden = true;

  // Group sites by collection
  const bucket = {};
  for (const r of recs) {
    const cid = r.collectionId || "";
    (bucket[cid] = bucket[cid] || []).push(r);
  }

  const scenes = [];
  for (const c of collections) {
    const items = bucket[c.id] || [];
    scenes.push(renderScene(c, items));
  }
  // Uncategorized bucket shows only when it has items
  if (bucket[""]?.length) {
    scenes.push(renderScene(UNCATEGORIZED, bucket[""], true));
  }

  main.innerHTML = scenes.join("") + `
    <section class="hd-newcol">
      <button class="hd-newcol-btn" id="hd-main-new-collection">
        <span class="hd-newcol-plus">+</span>
        <span>Build another collection</span>
      </button>
    </section>
  `;

  // Attach GSAP-driven effects to new nodes
  if (gsapReady) gsapReady.then(gsap => wireCardTilts(gsap, root)).catch(() => {});
}

function renderScene(col, items, isUncategorized) {
  const accent = col.accent || "#c9a9ff";
  const n = items.length;
  const cover = col.coverImage || (items[0]?.coverImage || items[0]?.imageUrl || "");
  const faviconBg = items[0] ? faviconUrl(items[0].url, 256) : "";
  // Headline poster → most-opened item in this collection
  const topSite = [...items].sort((a, b) => (b.openedCount || 0) - (a.openedCount || 0))[0];

  return `
    <section class="hd-scene" data-col-id="${esc(col.id)}" style="--accent: ${esc(accent)};">
      <div class="hd-scene-art">
        <div class="hd-scene-wash" style="background-image: url('${esc(cover || faviconBg)}');"></div>
        <div class="hd-scene-gradient"></div>
        <div class="hd-scene-grain"></div>
      </div>

      <div class="hd-scene-hero">
        <div class="hd-scene-left">
          <div class="hd-scene-eyebrow">COLLECTION · ${n} ${n === 1 ? "SPOT" : "SPOTS"}</div>
          <h2 class="hd-scene-title" data-split>${esc(col.name)}<span class="hd-scene-dot">.</span></h2>
          ${col.description ? `<p class="hd-scene-sub">${esc(col.description)}</p>` : ""}
          <div class="hd-scene-ctas">
            ${items.length ? `<button class="hd-btn primary small" data-scene-random>▸ Open a random</button>` : `<button class="hd-btn primary small" data-scene-add>+ Add first spot</button>`}
            ${!isUncategorized ? `<button class="hd-btn ghost small" data-scene-edit>⚙ Edit collection</button>` : ""}
            <button class="hd-btn ghost small" data-scene-add-site>+ Add here</button>
          </div>
        </div>

        ${topSite ? `
          <div class="hd-scene-right">
            <article class="hd-featured" data-id="${esc(topSite.id)}">
              <div class="hd-featured-thumb">${renderCardMedia(topSite)}</div>
              <div class="hd-featured-info">
                <div class="hd-featured-eyebrow">★ MOST OPENED</div>
                <div class="hd-featured-title">${esc(topSite.title || hostOf(topSite.url))}</div>
                <div class="hd-featured-host">${esc(hostOf(topSite.url))}</div>
                <button class="hd-featured-cta">Enter →</button>
              </div>
            </article>
          </div>
        ` : ""}
      </div>

      ${items.length > 0 ? `
        <div class="hd-scene-grid">
          ${items.slice(topSite ? 1 : 0).map(r => siteCardHtml(r)).join("")}
        </div>
      ` : `
        <div class="hd-scene-empty">
          <div class="hd-scene-empty-ic">◇</div>
          <div>This park is quiet. Drop a link to open it.</div>
        </div>
      `}
    </section>
  `;
}

function renderCardMedia(r) {
  const favicon = faviconUrl(r.url, 256);
  const cover = r.coverImage || r.imageUrl || "";
  // Layer: favicon-wash as blurred backdrop + sharp cover/favicon on top
  return `
    <div class="hd-media">
      <div class="hd-media-wash" style="background-image: url('${esc(favicon)}');"></div>
      <div class="hd-media-tint"></div>
      ${cover
        ? `<img class="hd-media-cover" src="${esc(cover)}" alt="" loading="lazy" onerror="this.closest('.hd-media').classList.add('no-cover'); this.remove();" />`
        : `<img class="hd-media-fav" src="${esc(favicon)}" alt="" loading="lazy" />`
      }
    </div>
  `;
}

function siteCardHtml(r) {
  const host = hostOf(r.url);
  const mood = MOOD_BY_KEY[r.mood];
  const journalCount = Array.isArray(r.journal) ? r.journal.length : 0;
  return `
    <article class="hd-sitecard" data-id="${esc(r.id)}" tabindex="0">
      <div class="hd-sc-thumb">${renderCardMedia(r)}</div>
      ${mood ? `<div class="hd-sc-mood" style="--mood: ${esc(mood.color)}" title="${esc(mood.label)}">${esc(mood.emoji)}</div>` : ""}
      <div class="hd-sc-info">
        <div class="hd-sc-title">${esc(r.title || host)}</div>
        <div class="hd-sc-host">${esc(host)}</div>
        ${r.note ? `<div class="hd-sc-note">${esc(r.note)}</div>` : ""}
        <div class="hd-sc-stats">
          <span class="hd-sc-plays">${(r.openedCount || 0) > 0 ? `${r.openedCount} visit${r.openedCount === 1 ? "" : "s"}` : "unvisited"}</span>
          ${journalCount ? `<span class="hd-sc-journal">✎ ${journalCount}</span>` : ""}
        </div>
      </div>
      <div class="hd-sc-actions">
        <button class="hd-sc-abtn" data-act="pin" title="${r.pinned ? "Unpin" : "Pin"}">${r.pinned ? "★" : "☆"}</button>
        <button class="hd-sc-abtn" data-act="edit" title="Edit">✎</button>
        <button class="hd-sc-abtn" data-act="del" title="Delete">×</button>
      </div>
    </article>
  `;
}

// ============ WIRE ============
function wire(root) {
  const scrim = root.querySelector("#hd-scrim");
  const cscrim = root.querySelector("#hd-cscrim");
  const urlEl = root.querySelector("#hd-url");
  const previewEl = root.querySelector("#hd-m-preview");
  const previewImg = root.querySelector("#hd-m-preview-img");
  const previewTitle = root.querySelector("#hd-m-preview-title");
  const previewHost = root.querySelector("#hd-m-preview-host");
  const titleEl = root.querySelector("#hd-title");
  const noteEl = root.querySelector("#hd-note");
  const collSelect = root.querySelector("#hd-collection");
  const browserEl = root.querySelector("#hd-browser");
  const saveBtn = root.querySelector("#hd-m-save");
  const moodRow = root.querySelector("#hd-mood-row");
  const coverUrlEl = root.querySelector("#hd-cover-url");

  let editingId = null;
  let editingCollectionId = null;
  let fetched = { imageUrl: "", title: "" };
  let currentMood = "";
  let currentCollectionColor = "";
  let previewToken = 0;

  const setMood = (m) => {
    currentMood = m;
    moodRow.querySelectorAll(".hd-mood-chip").forEach(b => b.classList.toggle("active", b.dataset.mood === m));
  };

  const openSiteModal = (rec = null, preferredColId = null) => {
    editingId = rec?.id || null;
    urlEl.value = rec?.url || "";
    titleEl.value = rec?.title || "";
    noteEl.value = rec?.note || "";
    if (collSelect) collSelect.value = rec?.collectionId || preferredColId || collSelect.options[0]?.value || "";
    browserEl.value = rec?.browser || "";
    setMood(rec?.mood || "");
    coverUrlEl.value = rec?.coverImage || "";
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
  const closeSiteModal = () => { scrim.hidden = true; editingId = null; fetched = { imageUrl: "", title: "" }; };

  root.querySelector("#hd-add")?.addEventListener("click", () => openSiteModal());
  root.querySelector("#hd-m-close")?.addEventListener("click", closeSiteModal);
  root.querySelector("#hd-m-cancel")?.addEventListener("click", closeSiteModal);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeSiteModal(); });

  const openCollectionModal = (col = null) => {
    editingCollectionId = col?.id || null;
    root.querySelector("#hd-c-name").value = col?.name || "";
    root.querySelector("#hd-c-desc").value = col?.description || "";
    root.querySelector("#hd-c-cover").value = col?.coverImage || "";
    currentCollectionColor = col?.accent || "#c9a9ff";
    root.querySelectorAll(".hd-color-chip").forEach(b => b.classList.toggle("active", b.dataset.color === currentCollectionColor));
    root.querySelector("#hd-c-save").disabled = !col?.name;
    root.querySelector("#hd-c-delete").hidden = !col;
    cscrim.hidden = false;
    setTimeout(() => root.querySelector("#hd-c-name").focus(), 20);
  };
  const closeCollectionModal = () => { cscrim.hidden = true; editingCollectionId = null; };

  root.querySelector("#hd-new-collection")?.addEventListener("click", () => openCollectionModal());
  root.querySelector("#hd-c-close")?.addEventListener("click", closeCollectionModal);
  root.querySelector("#hd-c-cancel")?.addEventListener("click", closeCollectionModal);
  cscrim.addEventListener("click", (e) => { if (e.target === cscrim) closeCollectionModal(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!scrim.hidden) closeSiteModal();
      if (!cscrim.hidden) closeCollectionModal();
    }
  });

  // Mood row
  moodRow.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-mood]"); if (!btn) return;
    setMood(btn.dataset.mood);
  });
  // Color row
  root.querySelector("#hd-c-colors")?.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-color]"); if (!btn) return;
    currentCollectionColor = btn.dataset.color;
    root.querySelectorAll(".hd-color-chip").forEach(b => b.classList.toggle("active", b.dataset.color === currentCollectionColor));
  });

  // Preview fetch
  let previewTimer = null;
  const fetchPreview = async () => {
    const u = urlEl.value.trim();
    if (!/^https?:\/\//i.test(u)) { previewEl.hidden = true; saveBtn.disabled = true; return; }
    saveBtn.disabled = false;
    previewEl.hidden = false;
    previewImg.removeAttribute("src");
    previewTitle.textContent = "Loading preview…";
    previewHost.textContent = hostOf(u);
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

  // Save site
  saveBtn.addEventListener("click", async () => {
    const url = urlEl.value.trim(); if (!url) return;
    const payload = {
      url,
      title: titleEl.value.trim() || hostOf(url),
      note: noteEl.value.trim(),
      collectionId: collSelect?.value || "",
      browser: browserEl.value,
      imageUrl: fetched.imageUrl || "",
      coverImage: coverUrlEl.value.trim(),
      mood: currentMood || "",
    };
    if (editingId) await updateRecreation(editingId, payload);
    else await addRecreation(payload);
    closeSiteModal();
  });

  // Save collection
  const cNameEl = root.querySelector("#hd-c-name");
  cNameEl.addEventListener("input", () => { root.querySelector("#hd-c-save").disabled = !cNameEl.value.trim(); });
  root.querySelector("#hd-c-save").addEventListener("click", async () => {
    const name = cNameEl.value.trim();
    if (!name) return;
    const payload = {
      name,
      description: root.querySelector("#hd-c-desc").value.trim(),
      coverImage: root.querySelector("#hd-c-cover").value.trim(),
      accent: currentCollectionColor || "#c9a9ff",
    };
    if (editingCollectionId) await updateCollection(editingCollectionId, payload);
    else await addCollection(payload);
    closeCollectionModal();
  });
  root.querySelector("#hd-c-delete").addEventListener("click", async () => {
    if (!editingCollectionId) return;
    if (confirm("Delete this collection? Sites inside become Side quests.")) {
      await deleteCollection(editingCollectionId);
      closeCollectionModal();
    }
  });

  // Delegated card interactions
  const handleClick = async (ev) => {
    // Scene-level buttons
    const sceneBtn = ev.target.closest?.("[data-scene-random], [data-scene-edit], [data-scene-add-site], [data-scene-add]");
    if (sceneBtn) {
      ev.stopPropagation();
      const scene = sceneBtn.closest(".hd-scene");
      const colId = scene?.dataset.colId;
      if (sceneBtn.hasAttribute("data-scene-random") || sceneBtn.hasAttribute("data-scene-add")) {
        const items = getRecreations().filter(r => (r.collectionId || "") === colId);
        if (!items.length) { openSiteModal(null, colId); return; }
        const weights = items.map(r => Math.max(1, (r.openedCount || 0) + 1));
        const total = weights.reduce((a, b) => a + b, 0);
        let roll = Math.random() * total;
        let pick = items[0];
        for (let i = 0; i < items.length; i++) { roll -= weights[i]; if (roll <= 0) { pick = items[i]; break; } }
        await openWithRitual(pick, root);
      } else if (sceneBtn.hasAttribute("data-scene-edit")) {
        const c = getCollections().find(x => x.id === colId);
        if (c) openCollectionModal(c);
      } else if (sceneBtn.hasAttribute("data-scene-add-site")) {
        openSiteModal(null, colId);
      }
      return;
    }

    // Featured card
    const featured = ev.target.closest?.(".hd-featured");
    if (featured) {
      const id = featured.dataset.id;
      const rec = getRecreations().find(r => r.id === id);
      if (rec) await openWithRitual(rec, root);
      return;
    }

    // Site card actions
    const actBtn = ev.target.closest?.(".hd-sc-abtn[data-act]");
    const card = ev.target.closest?.(".hd-sitecard");
    if (!card) return;
    const id = card.dataset.id;
    const rec = getRecreations().find(r => r.id === id);
    if (!rec) return;
    if (actBtn) {
      ev.stopPropagation();
      const act = actBtn.dataset.act;
      if (act === "pin") await updateRecreation(id, { pinned: !rec.pinned });
      else if (act === "edit") openSiteModal(rec);
      else if (act === "del" && confirm(`Remove "${rec.title || hostOf(rec.url)}"?`)) await deleteRecreation(id);
      return;
    }
    await openWithRitual(rec, root);
  };
  root.querySelector("#hd-root").addEventListener("click", handleClick);

  // Keyboard enter on focused card
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList?.contains?.("hd-sitecard")) {
      e.preventDefault(); e.target.click();
    }
  });

  // Surprise me (hero)
  root.querySelector("#hd-surprise")?.addEventListener("click", async () => {
    const recs = getRecreations();
    if (!recs.length) return;
    const weights = recs.map(r => Math.max(1, (r.openedCount || 0) + 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let pick = recs[0];
    for (let i = 0; i < recs.length; i++) { roll -= weights[i]; if (roll <= 0) { pick = recs[i]; break; } }
    await openWithRitual(pick, root);
  });

  // Browser pref
  root.querySelector("#hd-browser-global")?.addEventListener("change", async (e) => {
    await updateSettings(s => { s.recreationBrowser = e.target.value; });
  });

  // "Build another collection" at main footer uses event delegation; also wire direct
  root.addEventListener("click", (e) => {
    if (e.target.closest?.("#hd-main-new-collection")) openCollectionModal();
  });

  // Journal prompt wiring
  const journal = root.querySelector("#hd-journal");
  const journalInput = root.querySelector("#hd-journal-input");
  const journalSave = root.querySelector("#hd-journal-save");
  const journalSkip = root.querySelector("#hd-journal-skip");
  const journalClose = root.querySelector("#hd-journal-close");
  const closeJournal = () => { journal.hidden = true; journal.dataset.recId = ""; journalInput.value = ""; };
  journalClose?.addEventListener("click", closeJournal);
  journalSkip?.addEventListener("click", async () => {
    const id = journal.dataset.recId;
    if (id) await addRecreationJournal(id, "");
    closeJournal();
  });
  journalSave?.addEventListener("click", async () => {
    const id = journal.dataset.recId;
    const note = journalInput.value.trim();
    if (!id) { closeJournal(); return; }
    await addRecreationJournal(id, note || "");
    closeJournal();
  });
  journalInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); journalSave.click(); }
    if (e.key === "Escape") { e.preventDefault(); closeJournal(); }
  });
}

// ============ OPENING RITUAL ============
async function openWithRitual(rec, root) {
  const ritual = root.querySelector("#hd-ritual");
  const title = root.querySelector("#hd-ritual-title");
  if (!ritual || !title) { await openRecreation(rec); return; }
  title.textContent = rec.title || hostOf(rec.url);
  ritual.hidden = false;
  const openPromise = openRecreation(rec);
  await new Promise(r => setTimeout(r, 2600));
  ritual.hidden = true;
  await openPromise.catch(() => {});
}

// ============ JOURNAL PROMPT ============
function maybePromptJournal(root) {
  const recs = getRecreations();
  const now = Date.now();
  const candidates = recs.filter(r => r.visitStartedAt && (now - r.visitStartedAt) < 6 * 3600 * 1000);
  if (!candidates.length) return;
  candidates.sort((a, b) => b.visitStartedAt - a.visitStartedAt);
  const rec = candidates[0];
  const journal = root.querySelector("#hd-journal");
  const siteEl = root.querySelector("#hd-journal-site");
  const input = root.querySelector("#hd-journal-input");
  if (!journal || !siteEl || !input) return;
  if (journal.dataset.recId === rec.id) return;
  journal.dataset.recId = rec.id;
  siteEl.textContent = rec.title || hostOf(rec.url);
  input.value = "";
  journal.hidden = false;
  setTimeout(() => input.focus(), 60);
}

// ============ GSAP ============
function loadGsap() {
  if (window.gsap) return Promise.resolve(window.gsap);
  if (window.__gsapLoader__) return window.__gsapLoader__;
  window.__gsapLoader__ = new Promise((resolve, reject) => {
    const s1 = document.createElement("script");
    s1.src = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js";
    s1.onload = () => {
      const s2 = document.createElement("script");
      s2.src = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js";
      s2.onload = () => {
        try { window.gsap.registerPlugin(window.ScrollTrigger); } catch (_) {}
        resolve(window.gsap);
      };
      s2.onerror = () => resolve(window.gsap);  // ScrollTrigger optional
      document.head.appendChild(s2);
    };
    s1.onerror = () => reject(new Error("GSAP load failed"));
    document.head.appendChild(s1);
  });
  return window.__gsapLoader__;
}

function animateInitial(gsap, root) {
  if (!gsap || !root) return;
  // Letter-split the big wordmark + collection titles
  const wordmark = root.querySelector(".hd-wordmark[data-split]");
  if (wordmark) splitAndAnimate(gsap, wordmark);
  root.querySelectorAll(".hd-scene-title[data-split]").forEach(el => splitAndAnimate(gsap, el, 0.5));

  // Fade+rise entrance of hero bits
  gsap.from(".hd-eyebrow", { y: 24, opacity: 0, duration: 1, delay: .1, ease: "power3.out" });
  gsap.from(".hd-tag", { y: 24, opacity: 0, duration: 1, delay: .4, ease: "power3.out" });
  gsap.from(".hd-cta-row > *", { y: 20, opacity: 0, duration: .8, delay: .7, stagger: .07, ease: "power3.out" });

  // Scene reveals when scrolled into view (if ScrollTrigger loaded)
  if (window.ScrollTrigger) {
    gsap.utils.toArray(".hd-scene").forEach(scene => {
      gsap.from(scene.querySelectorAll(".hd-scene-left > *"), {
        scrollTrigger: { trigger: scene, start: "top 72%", once: true },
        y: 30, opacity: 0, duration: .8, stagger: .08, ease: "power3.out",
      });
      gsap.from(scene.querySelector(".hd-featured"), {
        scrollTrigger: { trigger: scene, start: "top 72%", once: true },
        y: 40, opacity: 0, scale: .95, duration: 1, ease: "power3.out", delay: .1,
      });
      gsap.from(scene.querySelectorAll(".hd-sitecard"), {
        scrollTrigger: { trigger: scene.querySelector(".hd-scene-grid"), start: "top 85%", once: true },
        y: 24, opacity: 0, duration: .7, stagger: .05, ease: "power3.out",
      });
      // Parallax wash
      const wash = scene.querySelector(".hd-scene-wash");
      if (wash) {
        gsap.to(wash, {
          scrollTrigger: { trigger: scene, start: "top bottom", end: "bottom top", scrub: true },
          yPercent: -14, ease: "none",
        });
      }
    });
  }
  // Hover tilts on cards
  wireCardTilts(gsap, root);
}

function splitAndAnimate(gsap, el, delay = 0) {
  const text = el.textContent;
  el.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const ch of text) {
    const span = document.createElement("span");
    span.className = "hd-letter";
    span.textContent = ch === " " ? " " : ch;
    frag.appendChild(span);
  }
  el.appendChild(frag);
  gsap.from(el.querySelectorAll(".hd-letter"), {
    y: "100%", opacity: 0, duration: .9, delay, stagger: .035, ease: "power4.out",
  });
}

const TILT_WIRED = new WeakSet();
function wireCardTilts(gsap, root) {
  if (!gsap || !root) return;
  root.querySelectorAll(".hd-sitecard, .hd-featured").forEach(card => {
    if (TILT_WIRED.has(card)) return;
    TILT_WIRED.add(card);
    card.style.transformStyle = "preserve-3d";
    card.style.willChange = "transform";
    const onMove = (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(card, { rotationY: px * 8, rotationX: -py * 8, duration: .35, transformPerspective: 1000, ease: "power2.out" });
    };
    const onLeave = () => gsap.to(card, { rotationY: 0, rotationX: 0, duration: .6, ease: "power2.out" });
    card.addEventListener("mousemove", onMove);
    card.addEventListener("mouseleave", onLeave);
  });
}

// ============ FONTS ============
function injectFonts() {
  if (document.getElementById("hd-fonts")) return;
  const link = document.createElement("link");
  link.id = "hd-fonts";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Caprasimo&family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500;1,9..144,700&family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700&display=swap";
  document.head.appendChild(link);
}

// ============ STYLES ============
function injectStyles() {
  if (document.getElementById("hd-styles")) return;
  const s = document.createElement("style");
  s.id = "hd-styles";
  s.textContent = `
    #view.hideout-active { padding: 0 !important; max-width: none !important; margin: 0 !important; }
    .hd [hidden], .hd-scrim[hidden], .hd-ritual[hidden], .hd-journal[hidden], .hd-m-preview[hidden], .hd-empty[hidden], .hd-featured[hidden] { display: none !important; }

    .hd {
      --peach: #ffb47a; --rose: #ff8aa8; --dawn: #ffd45e; --mint: #9fe8d7; --teal: #4ec8c0;
      --lavender: #c9a9ff; --violet: #8b6cff; --cream: #fff8ec; --cream-2: #fff1dc;
      --ink: #2d2340; --dim: #786990; --mut: #a89cb8;
      --line: rgba(45, 35, 64, .1); --line2: rgba(45, 35, 64, .22);
      font-family: 'Space Grotesk', -apple-system, system-ui, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(ellipse at 10% 0%, color-mix(in oklab, var(--peach) 32%, transparent) 0%, transparent 50%),
        radial-gradient(ellipse at 90% 20%, color-mix(in oklab, var(--lavender) 32%, transparent) 0%, transparent 50%),
        radial-gradient(ellipse at 50% 100%, color-mix(in oklab, var(--mint) 24%, transparent) 0%, transparent 55%),
        linear-gradient(180deg, var(--cream) 0%, var(--cream-2) 70%, var(--cream) 100%);
      min-height: calc(100vh - 56px);
      overflow-x: hidden;
    }

    /* ================ HERO ================ */
    .hd-hero { position: relative; padding: 80px 56px 56px; overflow: hidden; }
    .hd-hero-blobs { position: absolute; inset: 0; pointer-events: none; }
    .hd-hero-blobs .blob {
      position: absolute; border-radius: 50%; filter: blur(80px); opacity: .5;
      animation: blobDrift 20s ease-in-out infinite;
    }
    .hd-hero-blobs .b1 { top: -10%; left: 5%; width: 300px; height: 300px; background: var(--rose); }
    .hd-hero-blobs .b2 { top: 20%; right: 8%; width: 360px; height: 360px; background: var(--mint); animation-delay: -7s; }
    .hd-hero-blobs .b3 { bottom: -10%; left: 40%; width: 320px; height: 320px; background: var(--lavender); animation-delay: -14s; }
    @keyframes blobDrift { 0%, 100% { transform: translate(0,0) scale(1); } 50% { transform: translate(30px, -20px) scale(1.1); } }

    .hd-hero-stars { position: absolute; inset: 0; pointer-events: none; }
    .hd-hero-stars .star {
      position: absolute; width: 5px; height: 5px; border-radius: 50%;
      background: #fff; opacity: .85; box-shadow: 0 0 10px #fff;
      animation: twk 3s ease-in-out infinite;
    }
    .hd-hero-stars .star:nth-child(1) { top: 12%; left: 15%; animation-delay: .2s; }
    .hd-hero-stars .star:nth-child(2) { top: 20%; left: 55%; animation-delay: .6s; }
    .hd-hero-stars .star:nth-child(3) { top: 30%; left: 80%; animation-delay: 1.1s; }
    .hd-hero-stars .star:nth-child(4) { top: 70%; left: 10%; animation-delay: 1.6s; }
    .hd-hero-stars .star:nth-child(5) { top: 80%; left: 90%; animation-delay: 2.1s; }
    .hd-hero-stars .star:nth-child(6) { top: 50%; left: 70%; animation-delay: 1.3s; }
    .hd-hero-stars .star:nth-child(7) { top: 60%; left: 40%; animation-delay: 2.4s; }
    .hd-hero-stars .star:nth-child(8) { top: 15%; left: 85%; animation-delay: .9s; }
    .hd-hero-stars .star:nth-child(9) { top: 85%; left: 60%; animation-delay: 1.8s; }
    .hd-hero-stars .star:nth-child(10) { top: 40%; left: 30%; animation-delay: 2.5s; }
    .hd-hero-stars .star:nth-child(11) { top: 55%; left: 92%; animation-delay: .5s; }
    .hd-hero-stars .star:nth-child(12) { top: 25%; left: 42%; animation-delay: 1.4s; }
    .hd-hero-stars .star:nth-child(13) { top: 90%; left: 25%; animation-delay: 2.0s; }
    .hd-hero-stars .star:nth-child(14) { top: 8%; left: 50%; animation-delay: .3s; }
    @keyframes twk { 0%, 100% { opacity: .3; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.3); } }

    .hd-hero-inner { position: relative; z-index: 2; max-width: 980px; }
    .hd-eyebrow {
      display: inline-block;
      font: 600 11.5px/1 'Space Grotesk', sans-serif;
      letter-spacing: .3em; text-transform: uppercase;
      color: var(--violet);
      margin-bottom: 24px;
      padding: 7px 14px; border-radius: 999px;
      background: color-mix(in oklab, var(--lavender) 24%, transparent);
      border: 1px solid color-mix(in oklab, var(--violet) 30%, transparent);
    }

    .hd-wordmark {
      font-family: 'Caprasimo', serif;
      font-weight: 400;
      font-size: clamp(72px, 11vw, 180px);
      line-height: .9; letter-spacing: -.015em;
      margin: 0 0 24px;
      background: linear-gradient(135deg, var(--rose) 0%, var(--peach) 35%, var(--dawn) 65%, var(--mint) 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent;
      display: inline-block;
      overflow: hidden;
    }
    .hd-wordmark .hd-letter { display: inline-block; }

    .hd-tag {
      font-family: 'Instrument Serif', serif;
      font-style: italic;
      font-size: clamp(18px, 2vw, 26px); line-height: 1.5;
      color: var(--dim);
      max-width: 620px; margin: 0 0 36px;
    }

    .hd-cta-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }

    .hd-btn {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 14px 24px;
      font: 700 14px/1 'Space Grotesk', sans-serif; letter-spacing: .02em;
      border: none; border-radius: 999px;
      cursor: pointer;
      transition: transform .25s cubic-bezier(.2,1.2,.3,1), box-shadow .25s ease, filter .18s ease;
    }
    .hd-btn.primary {
      background: linear-gradient(135deg, var(--rose), var(--peach));
      color: #fff;
      box-shadow: 0 10px 26px color-mix(in oklab, var(--rose) 40%, transparent);
    }
    .hd-btn.primary:hover { transform: translateY(-2px); box-shadow: 0 14px 34px color-mix(in oklab, var(--rose) 55%, transparent); }
    .hd-btn.primary:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }
    .hd-btn.primary.small { padding: 11px 18px; font-size: 13px; }
    .hd-btn.mystery {
      background: linear-gradient(135deg, var(--lavender), var(--violet));
      color: #fff;
      box-shadow: 0 10px 26px color-mix(in oklab, var(--violet) 36%, transparent);
    }
    .hd-btn.mystery:hover { transform: translateY(-2px) rotate(-1deg); }
    .hd-btn.ghost { background: rgba(255,255,255,.6); backdrop-filter: blur(8px); color: var(--ink); border: 1px solid var(--line2); }
    .hd-btn.ghost:hover { background: rgba(255,255,255,.9); border-color: var(--ink); }
    .hd-btn.ghost.small { padding: 11px 16px; font-size: 13px; }
    .hd-plus { font-size: 17px; line-height: 1; }
    .hd-spark {
      display: inline-block; width: 14px; height: 14px;
      background:
        linear-gradient(0deg, transparent 46%, #fff 46% 54%, transparent 54%),
        linear-gradient(90deg, transparent 46%, #fff 46% 54%, transparent 54%),
        linear-gradient(45deg, transparent 46%, #fff 46% 54%, transparent 54%),
        linear-gradient(-45deg, transparent 46%, #fff 46% 54%, transparent 54%);
      animation: sprk 1.8s ease-in-out infinite;
    }
    @keyframes sprk { 0%, 100% { transform: scale(.7) rotate(0); opacity: .7; } 50% { transform: scale(1.2) rotate(90deg); opacity: 1; } }

    .hd-pref {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 11px 18px;
      background: rgba(255,255,255,.6); backdrop-filter: blur(8px);
      border: 1px solid var(--line); border-radius: 999px;
      color: var(--dim); font: 500 12px/1 'Space Grotesk', sans-serif;
    }
    .hd-pref-k { letter-spacing: .14em; text-transform: uppercase; font-size: 10.5px; color: var(--mut); }
    .hd-pref-sel { background: transparent; color: var(--ink); border: none; font: 600 13px/1 'Space Grotesk', sans-serif; cursor: pointer; outline: none; }
    .hd-pref-sel option { background: #fff; color: var(--ink); }

    /* ================ MAIN / SCENES ================ */
    .hd-main { position: relative; z-index: 2; padding: 56px 0 80px; }

    .hd-scene {
      --accent: var(--lavender);
      position: relative;
      margin: 0 24px 48px;
      padding: 48px 48px 56px;
      border-radius: 36px;
      overflow: hidden;
      background: #fff;
      box-shadow: 0 20px 60px rgba(45, 35, 64, .08);
      border: 1px solid var(--line);
    }

    /* Scene background art */
    .hd-scene-art { position: absolute; inset: 0; pointer-events: none; overflow: hidden; border-radius: 36px; }
    .hd-scene-wash {
      position: absolute; inset: -8%; width: 116%; height: 116%;
      background-size: cover; background-position: center;
      filter: blur(70px) saturate(1.3);
      opacity: .6;
    }
    .hd-scene-gradient {
      position: absolute; inset: 0;
      background:
        radial-gradient(ellipse at 20% 10%, color-mix(in oklab, var(--accent) 45%, transparent) 0%, transparent 55%),
        radial-gradient(ellipse at 85% 50%, color-mix(in oklab, var(--accent) 30%, transparent) 0%, transparent 55%),
        linear-gradient(180deg, rgba(255,255,255,.6) 0%, rgba(255,255,255,.85) 100%);
    }
    .hd-scene-grain {
      position: absolute; inset: 0; opacity: .08; pointer-events: none; mix-blend-mode: multiply;
      background-image:
        radial-gradient(circle at 20% 30%, color-mix(in oklab, var(--ink) 30%, transparent) 1px, transparent 2px),
        radial-gradient(circle at 70% 50%, color-mix(in oklab, var(--ink) 30%, transparent) 1px, transparent 2px),
        radial-gradient(circle at 40% 80%, color-mix(in oklab, var(--ink) 30%, transparent) 1px, transparent 2px);
      background-size: 20px 20px, 25px 25px, 30px 30px;
    }

    .hd-scene-hero {
      position: relative; z-index: 2;
      display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
      gap: 36px; align-items: center;
      margin-bottom: 40px;
    }
    @media (max-width: 900px) { .hd-scene-hero { grid-template-columns: 1fr; } }

    .hd-scene-eyebrow {
      display: inline-block;
      font: 700 11px/1 'Space Grotesk', sans-serif;
      letter-spacing: .28em; text-transform: uppercase;
      color: var(--accent); filter: brightness(.75);
      padding: 6px 12px; border-radius: 999px;
      background: color-mix(in oklab, var(--accent) 20%, transparent);
      margin-bottom: 18px;
    }
    .hd-scene-title {
      font-family: 'Fraunces', 'Playfair Display', serif;
      font-weight: 600; font-style: italic;
      font-size: clamp(52px, 7vw, 96px);
      line-height: .95; letter-spacing: -.025em;
      margin: 0 0 18px; color: var(--ink);
      overflow: hidden;
    }
    .hd-scene-title .hd-letter { display: inline-block; }
    .hd-scene-dot { color: var(--accent); }
    .hd-scene-sub {
      font-family: 'Instrument Serif', serif; font-style: italic;
      font-size: 20px; line-height: 1.4; color: var(--dim);
      max-width: 460px; margin: 0 0 26px;
    }
    .hd-scene-ctas { display: flex; gap: 10px; flex-wrap: wrap; }

    /* Featured card (floating "poster") */
    .hd-featured {
      position: relative;
      border-radius: 24px; overflow: hidden;
      background: #fff; cursor: pointer;
      border: 1px solid var(--line);
      box-shadow:
        0 24px 60px color-mix(in oklab, var(--accent) 25%, transparent),
        0 4px 14px rgba(45, 35, 64, .14);
      transition: box-shadow .3s ease;
      aspect-ratio: 4 / 5;
      display: flex; flex-direction: column;
    }
    .hd-featured:hover {
      box-shadow:
        0 32px 72px color-mix(in oklab, var(--accent) 40%, transparent),
        0 6px 20px rgba(45, 35, 64, .18);
    }
    .hd-featured-thumb { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; }
    .hd-featured-info { padding: 18px 20px 20px; background: #fff; position: relative; z-index: 2; }
    .hd-featured-eyebrow {
      font: 700 10px/1 'Space Grotesk', sans-serif;
      letter-spacing: .22em; text-transform: uppercase;
      color: var(--accent); filter: brightness(.8);
      margin-bottom: 10px;
    }
    .hd-featured-title {
      font-family: 'Fraunces', serif; font-weight: 600; font-size: 20px; line-height: 1.25;
      color: var(--ink); margin-bottom: 4px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .hd-featured-host { font: 500 12px/1.3 'Space Grotesk', sans-serif; color: var(--mut); margin-bottom: 14px; }
    .hd-featured-cta {
      padding: 10px 20px; border: none; border-radius: 999px;
      background: var(--ink); color: var(--cream);
      font: 700 12px/1 'Space Grotesk', sans-serif; letter-spacing: .06em;
      cursor: pointer; transition: all .2s ease;
    }
    .hd-featured-cta:hover { background: var(--accent); color: #fff; filter: brightness(.9); }

    /* Smart layered media (reused in featured + sitecards) */
    .hd-media { position: relative; width: 100%; height: 100%; overflow: hidden; background: #fff; }
    .hd-media-wash {
      position: absolute; inset: -20%;
      background-size: 160% 160%; background-position: center;
      filter: blur(50px) saturate(1.4);
      transform: scale(1.6);
    }
    .hd-media-tint {
      position: absolute; inset: 0;
      background: linear-gradient(135deg, color-mix(in oklab, var(--accent) 40%, transparent) 0%, transparent 70%);
    }
    .hd-media-cover {
      position: absolute; inset: 0;
      width: 100%; height: 100%; object-fit: cover; display: block;
      transition: transform .5s ease;
    }
    .hd-media-fav {
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      width: 56px; height: 56px; border-radius: 14px;
      box-shadow: 0 10px 24px rgba(45, 35, 64, .3);
      background: #fff; padding: 10px;
    }
    .hd-sitecard:hover .hd-media-cover, .hd-featured:hover .hd-media-cover { transform: scale(1.05); }

    /* Site grid */
    .hd-scene-grid {
      position: relative; z-index: 2;
      display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 20px;
    }

    /* Site card */
    .hd-sitecard {
      position: relative;
      background: #fff; border-radius: 20px;
      overflow: hidden; cursor: pointer;
      border: 1px solid var(--line);
      box-shadow: 0 10px 24px rgba(45, 35, 64, .06);
      transition: box-shadow .3s ease;
      display: flex; flex-direction: column;
    }
    .hd-sitecard:hover, .hd-sitecard:focus-visible {
      box-shadow:
        0 20px 42px color-mix(in oklab, var(--accent) 24%, transparent),
        0 4px 10px rgba(45, 35, 64, .1);
      outline: none;
    }
    .hd-sc-thumb { position: relative; aspect-ratio: 4 / 3; overflow: hidden; }
    .hd-sc-mood {
      position: absolute; top: 10px; right: 10px; z-index: 3;
      width: 32px; height: 32px; border-radius: 50%;
      background: #fff; border: 2px solid var(--mood);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 14px;
      box-shadow: 0 4px 12px color-mix(in oklab, var(--mood) 40%, transparent);
    }
    .hd-sc-info { padding: 14px 16px 14px; }
    .hd-sc-title {
      font-family: 'Fraunces', serif; font-weight: 500;
      font-size: 16px; line-height: 1.3; letter-spacing: -.01em;
      color: var(--ink);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      margin-bottom: 4px;
    }
    .hd-sc-host { font: 500 11.5px/1.3 'Space Grotesk', sans-serif; color: var(--mut); }
    .hd-sc-note { margin-top: 6px; font: 400 12.5px/1.5 'Space Grotesk', sans-serif; color: var(--dim); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .hd-sc-stats {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      margin-top: 10px; padding-top: 10px;
      border-top: 1px dashed var(--line);
    }
    .hd-sc-plays { font: 600 10.5px/1 'Space Grotesk', sans-serif; letter-spacing: .1em; text-transform: uppercase; color: var(--mut); }
    .hd-sc-journal {
      padding: 3px 7px; border-radius: 10px;
      background: color-mix(in oklab, var(--accent) 15%, transparent);
      font: 600 10px/1 'Space Grotesk', sans-serif; color: var(--ink);
    }
    .hd-sc-actions {
      position: absolute; top: 10px; left: 10px;
      display: flex; gap: 4px;
      opacity: 0; transform: translateY(-4px);
      transition: opacity .2s ease, transform .2s ease;
    }
    .hd-sitecard:hover .hd-sc-actions, .hd-sitecard:focus-within .hd-sc-actions { opacity: 1; transform: translateY(0); }
    .hd-sc-abtn {
      width: 28px; height: 28px; border-radius: 50%;
      background: rgba(255,255,255,.92); backdrop-filter: blur(6px);
      border: 1px solid var(--line);
      color: var(--ink); font-size: 13px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all .14s ease;
    }
    .hd-sc-abtn:hover { background: var(--ink); color: #fff; border-color: var(--ink); }

    .hd-scene-empty {
      position: relative; z-index: 2;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 48px 20px; text-align: center;
      color: var(--dim); font-family: 'Instrument Serif', serif; font-style: italic;
      font-size: 17px;
    }
    .hd-scene-empty-ic { font-size: 36px; margin-bottom: 10px; color: var(--accent); }

    .hd-newcol { padding: 32px 24px 24px; text-align: center; }
    .hd-newcol-btn {
      display: inline-flex; align-items: center; gap: 12px;
      padding: 20px 32px; border-radius: 24px;
      background: rgba(255,255,255,.5); backdrop-filter: blur(10px);
      border: 2px dashed var(--line2); color: var(--ink);
      font: 700 15px/1 'Space Grotesk', sans-serif; letter-spacing: .02em;
      cursor: pointer; transition: all .2s ease;
    }
    .hd-newcol-btn:hover { background: rgba(255,255,255,.8); border-color: var(--violet); transform: translateY(-2px); }
    .hd-newcol-plus { width: 28px; height: 28px; border-radius: 50%; background: var(--violet); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; }

    /* ================ EMPTY STATE ================ */
    .hd-empty { text-align: center; padding: 100px 48px 160px; max-width: 540px; margin: 0 auto; }
    .hd-empty-illus { font-size: 64px; margin-bottom: 20px; color: var(--violet); filter: drop-shadow(0 6px 16px color-mix(in oklab, var(--lavender) 50%, transparent)); animation: twk 3s ease-in-out infinite; }
    .hd-empty-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 36px; line-height: 1.1; margin: 0 0 14px; color: var(--ink); }
    .hd-empty-sub { font: 400 15px/1.65 'Space Grotesk', sans-serif; color: var(--dim); margin: 0 0 28px; }

    /* ================ RITUAL ================ */
    .hd-ritual {
      position: fixed; inset: 0; z-index: 2000;
      background: rgba(255, 248, 236, .97); backdrop-filter: blur(14px);
      display: flex; align-items: center; justify-content: center; padding: 40px;
      animation: ritFade .4s ease both;
    }
    @keyframes ritFade { from { opacity: 0; } to { opacity: 1; } }
    .hd-ritual-glow {
      position: absolute; inset: 0;
      background:
        radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--rose) 35%, transparent) 0%, transparent 55%),
        radial-gradient(circle at 20% 80%, color-mix(in oklab, var(--mint) 25%, transparent) 0%, transparent 55%),
        radial-gradient(circle at 80% 30%, color-mix(in oklab, var(--lavender) 25%, transparent) 0%, transparent 55%);
    }
    .hd-ritual-inner { position: relative; text-align: center; max-width: 420px; }
    .hd-ritual-breath {
      width: 140px; height: 140px; border-radius: 50%;
      margin: 0 auto 32px;
      background: linear-gradient(135deg, var(--rose), var(--peach), var(--dawn));
      box-shadow: 0 0 60px color-mix(in oklab, var(--rose) 50%, transparent), inset 0 2px 10px rgba(255,255,255,.3);
      animation: breath 2.6s ease-in-out;
    }
    @keyframes breath { 0% { transform: scale(.6); opacity: .5; } 40% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(1.15); opacity: .95; } }
    .hd-ritual-eyebrow { font: 700 11.5px/1 'Space Grotesk', sans-serif; letter-spacing: .22em; text-transform: uppercase; color: var(--violet); margin-bottom: 12px; }
    .hd-ritual-title { font-family: 'Fraunces', serif; font-weight: 500; font-style: italic; font-size: 32px; line-height: 1.3; color: var(--ink); margin-bottom: 14px; }
    .hd-ritual-sub { font: 400 15px/1.6 'Space Grotesk', sans-serif; color: var(--dim); max-width: 360px; margin: 0 auto; }

    /* ================ JOURNAL ================ */
    .hd-journal {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      z-index: 1600; min-width: 420px; max-width: 90vw;
      background: #fff; border: 1px solid var(--line2); border-radius: 20px;
      padding: 16px 20px;
      box-shadow: 0 20px 50px rgba(45,35,64,.18);
    }
    .hd-journal-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font: 500 13px/1.3 'Space Grotesk', sans-serif; color: var(--dim); }
    .hd-journal-eyebrow { color: var(--mut); font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; }
    .hd-journal-head strong { color: var(--ink); font-weight: 700; }
    .hd-journal-close { margin-left: auto; width: 24px; height: 24px; border-radius: 50%; background: transparent; border: none; color: var(--mut); cursor: pointer; font-size: 16px; }
    .hd-journal-close:hover { color: var(--ink); }
    .hd-journal-row { display: flex; gap: 8px; align-items: center; }
    .hd-journal-row input { flex: 1; padding: 11px 14px; background: rgba(45,35,64,.04); border: 1px solid var(--line); border-radius: 12px; color: var(--ink); font: 500 14px/1.3 'Space Grotesk', sans-serif; outline: none; }
    .hd-journal-row input:focus { border-color: var(--violet); background: #fff; }

    /* ================ MODAL ================ */
    .hd-scrim {
      position: fixed; inset: 0; z-index: 1500;
      background: rgba(45, 35, 64, .4); backdrop-filter: blur(12px);
      display: flex; align-items: center; justify-content: center; padding: 24px;
      animation: ritFade .22s ease both;
    }
    .hd-modal {
      background: #fff; border-radius: 24px;
      width: 100%; max-width: 560px; max-height: 92vh;
      display: flex; flex-direction: column; overflow: hidden;
      color: var(--ink);
      box-shadow: 0 40px 90px rgba(45,35,64,.3);
      animation: ritPop .3s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes ritPop { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .hd-m-head { display: flex; justify-content: space-between; align-items: center; padding: 22px 26px 18px; border-bottom: 1px solid var(--line); }
    .hd-m-eyebrow { font: 700 11.5px/1 'Space Grotesk', sans-serif; letter-spacing: .22em; text-transform: uppercase; color: var(--violet); }
    .hd-m-close { width: 30px; height: 30px; border-radius: 50%; background: transparent; border: 1px solid var(--line); color: var(--mut); cursor: pointer; font-size: 18px; }
    .hd-m-close:hover { color: var(--ink); border-color: var(--line2); }
    .hd-m-body { padding: 22px 26px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
    .hd-m-field { display: flex; flex-direction: column; gap: 8px; }
    .hd-m-k { font: 700 11px/1 'Space Grotesk', sans-serif; letter-spacing: .14em; text-transform: uppercase; color: var(--mut); }
    .hd-m-k small { font-weight: 500; letter-spacing: 0; text-transform: none; margin-left: 6px; opacity: .8; }
    .hd-m-field input, .hd-m-field select {
      width: 100%; padding: 12px 14px;
      background: rgba(45,35,64,.03); border: 1px solid var(--line); border-radius: 12px;
      color: var(--ink); font: 500 14px/1.3 'Space Grotesk', sans-serif;
      outline: none; box-sizing: border-box;
      transition: border-color .18s ease, background .18s ease;
    }
    .hd-m-field input:focus, .hd-m-field select:focus { border-color: var(--violet); background: #fff; }
    .hd-m-field input::placeholder { color: var(--mut); }
    .hd-m-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 480px) { .hd-m-two { grid-template-columns: 1fr; } }
    .hd-m-preview { display: flex; gap: 14px; align-items: center; padding: 14px; background: rgba(45,35,64,.03); border: 1px solid var(--line); border-radius: 14px; }
    .hd-m-thumb-wrap { width: 84px; height: 84px; border-radius: 10px; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg, var(--rose), var(--peach)); }
    .hd-m-thumb-wrap img { width: 100%; height: 100%; object-fit: cover; }
    .hd-m-meta { min-width: 0; flex: 1; }
    .hd-m-ptitle { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 500; color: var(--ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .hd-m-phost { font: 500 12px/1.3 'Space Grotesk', sans-serif; color: var(--dim); margin-top: 4px; }

    .hd-mood-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .hd-mood-chip {
      --mood: var(--mut);
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: 999px;
      background: rgba(45,35,64,.03); border: 1px solid var(--line);
      color: var(--ink); font: 500 13px/1 'Space Grotesk', sans-serif;
      cursor: pointer; transition: all .14s ease;
    }
    .hd-mood-chip:hover { border-color: var(--mood); background: color-mix(in oklab, var(--mood) 10%, #fff); }
    .hd-mood-chip.active { border-color: var(--mood); background: var(--mood); color: var(--ink); font-weight: 700; }
    .hd-mood-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--mood); box-shadow: 0 0 8px color-mix(in oklab, var(--mood) 50%, transparent); }

    .hd-color-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .hd-color-chip {
      --c: #fff;
      width: 36px; height: 36px; border-radius: 50%;
      background: var(--c);
      border: 2px solid transparent;
      cursor: pointer; transition: all .14s ease;
      box-shadow: 0 2px 6px color-mix(in oklab, var(--c) 50%, transparent);
    }
    .hd-color-chip:hover { transform: scale(1.1); }
    .hd-color-chip.active { border-color: var(--ink); transform: scale(1.1); }

    .hd-m-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 26px; border-top: 1px solid var(--line); background: rgba(255,241,220,.5); align-items: center; }
    .hd-m-btn { padding: 11px 22px; border-radius: 999px; font: 700 13px/1 'Space Grotesk', sans-serif; cursor: pointer; border: 1px solid transparent; transition: all .18s ease; background: transparent; }
    .hd-m-btn.ghost { color: var(--dim); border-color: var(--line2); }
    .hd-m-btn.ghost:hover { color: var(--ink); border-color: var(--ink); }
    .hd-m-btn.primary { background: linear-gradient(135deg, var(--rose), var(--peach)); color: #fff; box-shadow: 0 8px 20px color-mix(in oklab, var(--rose) 40%, transparent); }
    .hd-m-btn.primary:hover:not(:disabled) { transform: translateY(-1px); }
    .hd-m-btn.primary:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }
    .hd-m-btn.danger { color: #c43b3b; }
    .hd-m-btn.danger:hover { background: color-mix(in oklab, #c43b3b 10%, #fff); }

    /* Mobile */
    @media (max-width: 720px) {
      .hd-hero { padding: 60px 24px 48px; }
      .hd-scene { margin: 0 12px 32px; padding: 32px 24px 40px; border-radius: 28px; }
      .hd-scene-art, .hd-scene-art > * { border-radius: 28px; }
      .hd-scene-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(s);
}
