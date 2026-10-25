// The Hideout — Dreamland edition.
// Each category becomes a "Land" with its own illustrated backdrop and accent.
// Cards are postcards, not tiles. Four unique features:
//   1. Mood ring   — tag each site Chill / Laugh / Focus / Energize
//   2. Journal     — on return to the app, prompt a one-line log of the visit
//   3. Opening ritual — 3-second breath overlay before the browser opens
//   4. Surprise me — one-click weighted-random pick from your set

import {
  getRecreations, addRecreation, updateRecreation, deleteRecreation,
  openRecreation, fetchUrlPreview, getSettings, updateSettings,
  addRecreationJournal, on,
} from "./store.js";

const BROWSERS = [
  { key: "",              label: "System default" },
  { key: "Brave Browser", label: "Brave" },
  { key: "Google Chrome", label: "Chrome" },
  { key: "Safari",        label: "Safari" },
  { key: "Firefox",       label: "Firefox" },
  { key: "Arc",           label: "Arc" },
];

// Each category is a "Land" with its own color palette + title + icon motif.
const LANDS = {
  youtube:   { title: "Video Pavilion",  accent: "#ff8aa8", accent2: "#ffb47a", icon: "▸" },
  twitch:    { title: "Live Alley",       accent: "#c9a9ff", accent2: "#8b6cff", icon: "◉" },
  reddit:    { title: "Chatter Grove",    accent: "#ffb47a", accent2: "#ff8aa8", icon: "☁" },
  x:         { title: "The Feed Garden",  accent: "#4ec8c0", accent2: "#9fe8d7", icon: "✦" },
  music:     { title: "Music Land",       accent: "#9fe8d7", accent2: "#4ec8c0", icon: "♪" },
  instagram: { title: "Picture Promenade",accent: "#ff8aa8", accent2: "#c9a9ff", icon: "◇" },
  reading:   { title: "Reading Lane",     accent: "#ffd45e", accent2: "#ffb47a", icon: "✎" },
  web:       { title: "Side Streets",     accent: "#c9a9ff", accent2: "#9fe8d7", icon: "◈" },
};
const LAND_ORDER = ["youtube", "music", "reading", "twitch", "reddit", "x", "instagram", "web"];

const MOODS = [
  { key: "chill",    label: "Chill",    color: "#9fe8d7", emoji: "💭" },
  { key: "laugh",    label: "Laugh",    color: "#ff8aa8", emoji: "😄" },
  { key: "focus",    label: "Focus",    color: "#c9a9ff", emoji: "🎯" },
  { key: "energize", label: "Energize", color: "#ffd45e", emoji: "⚡" },
];
const MOOD_BY_KEY = Object.fromEntries(MOODS.map(m => [m.key, m]));

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
let currentRoot = null;

export default {
  async mount(root) {
    currentRoot = root;
    injectFonts();
    injectStyles();
    root.innerHTML = render();
    paint(root);
    wire(root);
    if (unsub) unsub();
    unsub = on((ev) => { if (ev === "recreations" || ev === "settings") paint(root); });
    const view = document.getElementById("view");
    if (view) view.classList.add("hideout-active");
    // Prompt for pending journal on mount
    maybePromptJournal(root);
    // Also re-check whenever the window regains focus
    window.addEventListener("focus", onFocusCheck);
  },
  unmount() {
    if (unsub) { unsub(); unsub = null; }
    const view = document.getElementById("view");
    if (view) view.classList.remove("hideout-active");
    window.removeEventListener("focus", onFocusCheck);
    currentRoot = null;
  },
};

function onFocusCheck() {
  if (currentRoot) maybePromptJournal(currentRoot);
}

// ============ RENDER ============
function render() {
  return `
    <div class="dl" id="dl-root">
      <!-- Hero -->
      <section class="dl-hero">
        <div class="dl-hero-bg"></div>
        <div class="dl-hero-stars" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <div class="dl-hero-inner">
          <div class="dl-eyebrow">· The Hideout ·</div>
          <h1 class="dl-title">Open the gates.</h1>
          <p class="dl-sub">A tiny park of your favourite places. Pick a land, step through, come back when you're ready.</p>
          <div class="dl-cta-row">
            <button class="dl-btn primary" id="dl-add">
              <span>+</span><span>Add a spot</span>
            </button>
            <button class="dl-btn surprise" id="dl-surprise" title="Pick one at random, weighted by your most-opened">
              <span class="dl-sparkle"></span>
              <span>Surprise me</span>
            </button>
            <label class="dl-pref">
              <span class="dl-pref-k">Open in</span>
              <select id="dl-browser-global" class="dl-pref-sel">
                ${BROWSERS.map(b => `<option value="${esc(b.key)}">${esc(b.label)}</option>`).join("")}
              </select>
            </label>
          </div>
        </div>
      </section>

      <main class="dl-main" id="dl-main"></main>

      <!-- Empty state -->
      <section class="dl-empty" id="dl-empty" hidden>
        <div class="dl-empty-illus">✦</div>
        <h2>The gates are open, but the park is quiet.</h2>
        <p>Drop a link and your first land will light up.</p>
        <button class="dl-btn primary" id="dl-empty-add"><span>+</span><span>Place your first spot</span></button>
      </section>

      <!-- Add / Edit modal -->
      <div class="dl-scrim" id="dl-scrim" hidden>
        <div class="dl-modal" role="dialog">
          <header class="dl-m-head">
            <div class="dl-m-eyebrow">New spot</div>
            <button class="dl-m-close" id="dl-m-close" aria-label="Close">×</button>
          </header>
          <div class="dl-m-body">
            <label class="dl-m-field">
              <span class="dl-m-k">Link</span>
              <input id="dl-url" type="url" placeholder="paste any https:// link" autocomplete="off" spellcheck="false" />
            </label>
            <div class="dl-m-preview" id="dl-m-preview" hidden>
              <div class="dl-m-thumb-wrap">
                <img id="dl-m-preview-img" alt="" />
              </div>
              <div class="dl-m-meta">
                <div class="dl-m-ptitle" id="dl-m-preview-title">—</div>
                <div class="dl-m-phost" id="dl-m-preview-host">—</div>
              </div>
            </div>
            <label class="dl-m-field">
              <span class="dl-m-k">Name</span>
              <input id="dl-title" type="text" />
            </label>
            <label class="dl-m-field">
              <span class="dl-m-k">A little note <small>optional</small></span>
              <input id="dl-note" type="text" maxlength="120" placeholder="why you come here" />
            </label>
            <div class="dl-m-two">
              <label class="dl-m-field">
                <span class="dl-m-k">Land</span>
                <select id="dl-category">
                  ${Object.entries(LANDS).map(([k, v]) => `<option value="${k}">${esc(v.title)}</option>`).join("")}
                </select>
              </label>
              <label class="dl-m-field">
                <span class="dl-m-k">Open in</span>
                <select id="dl-browser">
                  ${BROWSERS.map(b => `<option value="${esc(b.key)}">${esc(b.label)}</option>`).join("")}
                </select>
              </label>
            </div>
            <div class="dl-m-field">
              <span class="dl-m-k">Mood ring</span>
              <div class="dl-mood-row" id="dl-mood-row">
                ${MOODS.map(m => `<button type="button" class="dl-mood-chip" data-mood="${m.key}" style="--mood-color: ${m.color}">
                  <span class="dl-mood-dot"></span>${esc(m.emoji)} ${esc(m.label)}
                </button>`).join("")}
                <button type="button" class="dl-mood-chip" data-mood="" style="--mood-color: #d0cbd4">
                  <span class="dl-mood-dot"></span>No mood
                </button>
              </div>
            </div>
          </div>
          <footer class="dl-m-foot">
            <button class="dl-m-btn ghost" id="dl-m-cancel">Cancel</button>
            <button class="dl-m-btn primary" id="dl-m-save" disabled>Save spot</button>
          </footer>
        </div>
      </div>

      <!-- Opening ritual overlay -->
      <div class="dl-ritual" id="dl-ritual" hidden>
        <div class="dl-ritual-glow"></div>
        <div class="dl-ritual-inner">
          <div class="dl-ritual-breath"></div>
          <div class="dl-ritual-text">
            <div class="dl-ritual-eyebrow">Opening</div>
            <div class="dl-ritual-title" id="dl-ritual-title">—</div>
            <div class="dl-ritual-sub">Breathe in. Set your table. We'll be here when you're back.</div>
          </div>
        </div>
      </div>

      <!-- Journal prompt (after you return from a visit) -->
      <div class="dl-journal" id="dl-journal" hidden>
        <div class="dl-journal-inner">
          <div class="dl-journal-head">
            <span class="dl-journal-eyebrow">Just back from</span>
            <strong id="dl-journal-site">—</strong>
            <button class="dl-journal-close" id="dl-journal-close" aria-label="Dismiss">×</button>
          </div>
          <div class="dl-journal-row">
            <input id="dl-journal-input" type="text" placeholder="one line — what happened there?" maxlength="200" />
            <button class="dl-btn primary small" id="dl-journal-save">Save</button>
            <button class="dl-btn ghost small" id="dl-journal-skip">Skip</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============ PAINT ============
function paint(root) {
  const recs = getRecreations();
  const settings = getSettings();
  const globalSel = root.querySelector("#dl-browser-global");
  if (globalSel) globalSel.value = settings.recreationBrowser || "";

  const main = root.querySelector("#dl-main");
  const empty = root.querySelector("#dl-empty");

  if (!recs.length) {
    if (empty) empty.hidden = false;
    if (main) main.innerHTML = "";
    return;
  }
  if (empty) empty.hidden = true;

  // Group by category/land
  const byLand = {};
  for (const r of recs) {
    const c = r.category || "web";
    (byLand[c] = byLand[c] || []).push(r);
  }
  // Keep LAND_ORDER order, then any custom cats
  const orderedCats = [...LAND_ORDER.filter(c => byLand[c]?.length), ...Object.keys(byLand).filter(c => !LAND_ORDER.includes(c))];

  // Headliners (pinned) float at top as a special row (if any)
  const pinned = recs.filter(r => r.pinned);
  let html = "";
  if (pinned.length) {
    html += renderLand({ key: "headliners", title: "★ Headliners", accent: "#ffd45e", accent2: "#ff8aa8", icon: "★" }, pinned, true);
  }
  for (const cat of orderedCats) {
    const land = LANDS[cat] || LANDS.web;
    const items = byLand[cat];
    html += renderLand({ key: cat, ...land }, items, false);
  }
  if (main) main.innerHTML = html;
}

function renderLand(land, items, isHeadliners) {
  const cards = items.map((r, i) => cardHtml(r, i)).join("");
  return `
    <section class="land" data-land="${esc(land.key)}" style="--land-accent:${esc(land.accent)}; --land-accent2:${esc(land.accent2)};">
      <div class="land-bg"></div>
      <header class="land-head">
        <div class="land-icon">${esc(land.icon)}</div>
        <h2 class="land-title">${esc(land.title)}</h2>
        <span class="land-count">${items.length} ${items.length === 1 ? "spot" : "spots"}</span>
        <span class="land-rule"></span>
      </header>
      <div class="land-cards">${cards}</div>
    </section>
  `;
}

function cardHtml(r, i) {
  const host = hostOf(r.url);
  const mood = MOOD_BY_KEY[r.mood];
  const img = r.imageUrl
    ? `<img class="postcard-img" src="${esc(r.imageUrl)}" alt="" loading="lazy"
            onerror="this.closest('.postcard-thumb').classList.add('no-img');this.remove();" />`
    : "";
  // Slight natural rotation for scrapbook feel — alternates based on index
  const tilt = (i % 4 === 0) ? -1.2 : (i % 4 === 1) ? 0.8 : (i % 4 === 2) ? -0.6 : 1.4;
  const journalCount = Array.isArray(r.journal) ? r.journal.length : 0;
  return `
    <article class="postcard ${r.pinned ? "pinned" : ""}" data-id="${esc(r.id)}" tabindex="0" style="transform: rotate(${tilt}deg);">
      ${mood ? `<div class="postcard-mood" style="--mood-color:${esc(mood.color)}" title="Mood: ${esc(mood.label)}">${esc(mood.emoji)}</div>` : ""}
      <div class="postcard-thumb ${r.imageUrl ? "" : "no-img"}">
        ${img}
        <div class="postcard-ribbon"></div>
      </div>
      <div class="postcard-info">
        <div class="postcard-title">${esc(r.title || host)}</div>
        <div class="postcard-host">${esc(host)}</div>
        ${r.note ? `<div class="postcard-note">${esc(r.note)}</div>` : ""}
        <div class="postcard-stats">
          <span class="postcard-plays">${(r.openedCount || 0) > 0 ? `${r.openedCount} visit${r.openedCount === 1 ? "" : "s"}` : "unvisited"}</span>
          ${journalCount ? `<span class="postcard-journal-tag" title="${journalCount} entries">✎ ${journalCount}</span>` : ""}
        </div>
      </div>
      <div class="postcard-actions">
        <button class="pc-btn" data-act="pin" title="${r.pinned ? "Unpin" : "Pin"}">${r.pinned ? "★" : "☆"}</button>
        <button class="pc-btn" data-act="edit" title="Edit">✎</button>
        <button class="pc-btn" data-act="del" title="Delete">×</button>
      </div>
    </article>
  `;
}

// ============ WIRE ============
function wire(root) {
  const scrim = root.querySelector("#dl-scrim");
  const urlEl = root.querySelector("#dl-url");
  const previewEl = root.querySelector("#dl-m-preview");
  const previewImg = root.querySelector("#dl-m-preview-img");
  const previewTitle = root.querySelector("#dl-m-preview-title");
  const previewHost = root.querySelector("#dl-m-preview-host");
  const titleEl = root.querySelector("#dl-title");
  const noteEl = root.querySelector("#dl-note");
  const catEl = root.querySelector("#dl-category");
  const browserEl = root.querySelector("#dl-browser");
  const saveBtn = root.querySelector("#dl-m-save");
  const moodRow = root.querySelector("#dl-mood-row");

  let editingId = null;
  let fetched = { imageUrl: "", title: "" };
  let currentMood = "";
  let previewToken = 0;

  const setMood = (m) => {
    currentMood = m;
    moodRow.querySelectorAll(".dl-mood-chip").forEach(b => b.classList.toggle("active", b.dataset.mood === m));
  };

  const openModal = (rec = null) => {
    editingId = rec?.id || null;
    urlEl.value = rec?.url || "";
    titleEl.value = rec?.title || "";
    noteEl.value = rec?.note || "";
    catEl.value = rec?.category || "web";
    browserEl.value = rec?.browser || "";
    setMood(rec?.mood || "");
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

  root.querySelector("#dl-add")?.addEventListener("click", () => openModal());
  root.querySelector("#dl-empty-add")?.addEventListener("click", () => openModal());
  root.querySelector("#dl-m-close")?.addEventListener("click", closeModal);
  root.querySelector("#dl-m-cancel")?.addEventListener("click", closeModal);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !scrim.hidden) closeModal(); });

  moodRow.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-mood]"); if (!btn) return;
    setMood(btn.dataset.mood);
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
      mood: currentMood || "",
    };
    if (editingId) await updateRecreation(editingId, payload);
    else await addRecreation(payload);
    closeModal();
  });

  // Card interactions
  const handleCard = async (ev) => {
    const actBtn = ev.target.closest?.("[data-act]");
    const card = ev.target.closest?.(".postcard");
    if (!card) return;
    const id = card.dataset.id;
    const rec = getRecreations().find(r => r.id === id);
    if (!rec) return;
    if (actBtn) {
      ev.stopPropagation();
      const act = actBtn.dataset.act;
      if (act === "pin") {
        await updateRecreation(id, { pinned: !rec.pinned });
      } else if (act === "edit") openModal(rec);
      else if (act === "del") {
        if (confirm(`Remove "${rec.title || hostOf(rec.url)}"?`)) await deleteRecreation(id);
      }
      return;
    }
    await openWithRitual(rec, root);
  };
  root.querySelector("#dl-root").addEventListener("click", handleCard);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList?.contains?.("postcard")) {
      e.preventDefault(); e.target.click();
    }
  });

  // Surprise me — weighted random pick
  root.querySelector("#dl-surprise")?.addEventListener("click", async () => {
    const recs = getRecreations();
    if (!recs.length) return;
    const weights = recs.map(r => Math.max(1, (r.openedCount || 0) + 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let pick = recs[0];
    for (let i = 0; i < recs.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { pick = recs[i]; break; }
    }
    await openWithRitual(pick, root);
  });

  // Global browser pref
  root.querySelector("#dl-browser-global")?.addEventListener("change", async (e) => {
    await updateSettings(s => { s.recreationBrowser = e.target.value; });
  });

  // Wire journal prompt actions
  const journal = root.querySelector("#dl-journal");
  const journalInput = root.querySelector("#dl-journal-input");
  const journalSave = root.querySelector("#dl-journal-save");
  const journalSkip = root.querySelector("#dl-journal-skip");
  const journalClose = root.querySelector("#dl-journal-close");
  const closeJournal = () => { journal.hidden = true; journal.dataset.recId = ""; journalInput.value = ""; };
  journalClose?.addEventListener("click", closeJournal);
  journalSkip?.addEventListener("click", async () => {
    // Dismiss without saving — but clear the pending flag so we don't keep asking
    const id = journal.dataset.recId;
    if (id) await addRecreationJournal(id, "");  // empty entry clears visitStartedAt
    closeJournal();
  });
  journalSave?.addEventListener("click", async () => {
    const id = journal.dataset.recId;
    const note = journalInput.value.trim();
    if (!id) { closeJournal(); return; }
    if (note) await addRecreationJournal(id, note);
    else await addRecreationJournal(id, "");
    closeJournal();
  });
  journalInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); journalSave.click(); }
    if (e.key === "Escape") { e.preventDefault(); closeJournal(); }
  });
}

// ============ OPENING RITUAL ============
async function openWithRitual(rec, root) {
  const ritual = root.querySelector("#dl-ritual");
  const title = root.querySelector("#dl-ritual-title");
  if (!ritual || !title) {
    await openRecreation(rec);
    return;
  }
  title.textContent = rec.title || hostOf(rec.url);
  ritual.hidden = false;
  // Start opening the browser now in parallel with the ritual
  const openPromise = openRecreation(rec);
  // Hold the overlay for ~2.6s so the breath lands
  await new Promise(r => setTimeout(r, 2600));
  ritual.hidden = true;
  await openPromise.catch(() => {});
}

// ============ JOURNAL PROMPT ============
function maybePromptJournal(root) {
  const recs = getRecreations();
  // Pick the most recent unresolved visit (visitStartedAt set, within last 6 hours)
  const now = Date.now();
  const candidates = recs.filter(r => r.visitStartedAt && (now - r.visitStartedAt) < 6 * 3600 * 1000);
  if (!candidates.length) return;
  candidates.sort((a, b) => b.visitStartedAt - a.visitStartedAt);
  const rec = candidates[0];
  const journal = root.querySelector("#dl-journal");
  const siteEl = root.querySelector("#dl-journal-site");
  const input = root.querySelector("#dl-journal-input");
  if (!journal || !siteEl || !input) return;
  if (journal.dataset.recId === rec.id) return;  // already prompting
  journal.dataset.recId = rec.id;
  siteEl.textContent = rec.title || hostOf(rec.url);
  input.value = "";
  journal.hidden = false;
  setTimeout(() => input.focus(), 60);
}

// ============ FONTS ============
function injectFonts() {
  if (document.getElementById("dl-fonts")) return;
  const link = document.createElement("link");
  link.id = "dl-fonts";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&display=swap";
  document.head.appendChild(link);
}

// ============ STYLES ============
function injectStyles() {
  if (document.getElementById("dl-styles")) return;
  const s = document.createElement("style");
  s.id = "dl-styles";
  s.textContent = `
    /* Edge-to-edge while mounted */
    #view.hideout-active { padding: 0 !important; max-width: none !important; margin: 0 !important; }
    .dl [hidden], .dl-scrim[hidden], .dl-empty[hidden], .dl-ritual[hidden], .dl-journal[hidden],
    .dl-m-preview[hidden] { display: none !important; }

    .dl {
      --peach: #ffb47a;
      --rose: #ff8aa8;
      --dawn: #ffd45e;
      --buttercream: #fff6c4;
      --mint: #9fe8d7;
      --teal: #4ec8c0;
      --lavender: #c9a9ff;
      --violet: #8b6cff;
      --twilight: #1b1245;
      --cream: #fff8ec;
      --cream-2: #fff1dc;
      --ink: #352a4a;
      --dim: #786990;
      --mut: #a89cb8;
      --line: rgba(53, 42, 74, .1);
      --line2: rgba(53, 42, 74, .22);
      min-height: calc(100vh - 56px);
      background:
        radial-gradient(ellipse at 10% 0%, color-mix(in oklab, var(--peach) 40%, transparent) 0%, transparent 50%),
        radial-gradient(ellipse at 90% 10%, color-mix(in oklab, var(--lavender) 40%, transparent) 0%, transparent 50%),
        radial-gradient(ellipse at 50% 100%, color-mix(in oklab, var(--mint) 30%, transparent) 0%, transparent 55%),
        linear-gradient(180deg, var(--cream) 0%, var(--cream-2) 70%, var(--cream) 100%);
      color: var(--ink);
      font-family: 'Poppins', -apple-system, system-ui, sans-serif;
    }

    /* ---- HERO ---- */
    .dl-hero {
      position: relative;
      padding: 72px 56px 56px;
      overflow: hidden;
      border-bottom: 1px dashed var(--line);
    }
    .dl-hero-bg {
      position: absolute; inset: 0;
      background:
        radial-gradient(ellipse at 25% 40%, color-mix(in oklab, var(--rose) 30%, transparent) 0%, transparent 42%),
        radial-gradient(ellipse at 80% 20%, color-mix(in oklab, var(--mint) 32%, transparent) 0%, transparent 45%),
        radial-gradient(ellipse at 55% 90%, color-mix(in oklab, var(--dawn) 25%, transparent) 0%, transparent 50%);
      pointer-events: none;
    }
    .dl-hero-stars { position: absolute; inset: 0; pointer-events: none; }
    .dl-hero-stars span {
      position: absolute; width: 6px; height: 6px; border-radius: 50%;
      background: #fff; opacity: .8;
      box-shadow: 0 0 10px #fff;
      animation: twinkle 3s ease-in-out infinite;
    }
    .dl-hero-stars span:nth-child(1) { top: 18%; left: 12%; animation-delay: 0s; }
    .dl-hero-stars span:nth-child(2) { top: 36%; left: 80%; animation-delay: .6s; }
    .dl-hero-stars span:nth-child(3) { top: 68%; left: 14%; animation-delay: 1.2s; }
    .dl-hero-stars span:nth-child(4) { top: 22%; left: 65%; animation-delay: .9s; }
    .dl-hero-stars span:nth-child(5) { top: 80%; left: 90%; animation-delay: 1.6s; }
    .dl-hero-stars span:nth-child(6) { top: 50%; left: 40%; animation-delay: 2.1s; }
    .dl-hero-stars span:nth-child(7) { top: 10%; left: 50%; animation-delay: 2.5s; }
    @keyframes twinkle { 0%, 100% { opacity: .2; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.2); } }

    .dl-hero-inner { position: relative; z-index: 2; max-width: 760px; }
    .dl-eyebrow {
      font: 500 13px/1 'Poppins', sans-serif;
      letter-spacing: .18em; text-transform: uppercase;
      color: var(--violet);
      margin-bottom: 20px;
    }
    .dl-title {
      font-family: 'Fraunces', 'Playfair Display', Georgia, serif;
      font-weight: 600;
      font-size: clamp(48px, 6vw, 86px);
      line-height: 1.03; letter-spacing: -.015em;
      margin: 0 0 20px;
      color: var(--ink);
    }
    .dl-sub {
      font: 400 17px/1.6 'Poppins', sans-serif;
      color: var(--dim);
      max-width: 500px; margin: 0 0 36px;
    }
    .dl-cta-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }

    .dl-btn {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 13px 24px;
      font: 600 14px/1 'Poppins', sans-serif; letter-spacing: .01em;
      border: none; border-radius: 999px;
      cursor: pointer;
      transition: transform .22s cubic-bezier(.2,1.2,.3,1), box-shadow .22s ease, filter .18s ease;
    }
    .dl-btn.primary {
      background: linear-gradient(135deg, var(--rose), var(--peach));
      color: #fff;
      box-shadow: 0 10px 26px color-mix(in oklab, var(--rose) 40%, transparent);
    }
    .dl-btn.primary:hover { transform: translateY(-2px); box-shadow: 0 14px 32px color-mix(in oklab, var(--rose) 55%, transparent); }
    .dl-btn.primary:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }
    .dl-btn.primary.small { padding: 10px 18px; font-size: 13px; }
    .dl-btn.ghost {
      background: transparent; color: var(--ink);
      border: 1px solid var(--line2);
    }
    .dl-btn.ghost:hover { background: rgba(53,42,74,.06); border-color: var(--ink); }
    .dl-btn.ghost.small { padding: 10px 16px; font-size: 13px; }
    .dl-btn.surprise {
      background: linear-gradient(135deg, var(--lavender), var(--mint));
      color: var(--ink);
      box-shadow: 0 10px 24px color-mix(in oklab, var(--lavender) 36%, transparent);
    }
    .dl-btn.surprise:hover { transform: translateY(-2px) rotate(-1deg); }
    .dl-sparkle {
      display: inline-block; width: 14px; height: 14px;
      background:
        linear-gradient(45deg, transparent 44%, #fff 44% 56%, transparent 56%),
        linear-gradient(-45deg, transparent 44%, #fff 44% 56%, transparent 56%),
        linear-gradient(0deg, transparent 44%, #fff 44% 56%, transparent 56%),
        linear-gradient(90deg, transparent 44%, #fff 44% 56%, transparent 56%);
      filter: drop-shadow(0 0 4px #fff);
      animation: sparkle 1.8s ease-in-out infinite;
    }
    @keyframes sparkle { 0%, 100% { transform: scale(.8) rotate(0deg); opacity: .7; } 50% { transform: scale(1.2) rotate(90deg); opacity: 1; } }

    .dl-pref {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 10px 16px;
      background: rgba(255,255,255,.55);
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--dim);
      font: 500 12px/1 'Poppins', sans-serif;
    }
    .dl-pref-k { letter-spacing: .14em; text-transform: uppercase; font-size: 10.5px; color: var(--mut); }
    .dl-pref-sel { background: transparent; color: var(--ink); border: none; font: 600 13px/1 'Poppins', sans-serif; cursor: pointer; outline: none; }
    .dl-pref-sel option { background: #fff; color: var(--ink); }

    /* ---- MAIN ---- */
    .dl-main { padding: 48px 0 100px; }

    /* ---- LAND ---- */
    .land {
      --land-accent: var(--rose);
      --land-accent2: var(--peach);
      position: relative;
      padding: 48px 0;
      margin: 0 24px 32px;
      border-radius: 32px;
      background:
        radial-gradient(ellipse at 0% 0%, color-mix(in oklab, var(--land-accent) 20%, transparent) 0%, transparent 50%),
        radial-gradient(ellipse at 100% 100%, color-mix(in oklab, var(--land-accent2) 20%, transparent) 0%, transparent 50%),
        rgba(255,255,255,.4);
      overflow: hidden;
    }
    .land-bg {
      position: absolute; inset: 0;
      background-image:
        radial-gradient(circle at 10% 20%, color-mix(in oklab, var(--land-accent) 10%, transparent) 2px, transparent 3px),
        radial-gradient(circle at 90% 30%, color-mix(in oklab, var(--land-accent2) 10%, transparent) 2px, transparent 3px),
        radial-gradient(circle at 30% 85%, color-mix(in oklab, var(--land-accent2) 10%, transparent) 1.5px, transparent 2.5px),
        radial-gradient(circle at 75% 75%, color-mix(in oklab, var(--land-accent) 10%, transparent) 2px, transparent 3px);
      background-size: 100% 100%; opacity: .6; pointer-events: none;
    }

    .land-head {
      display: flex; align-items: baseline; gap: 14px;
      padding: 0 48px 32px;
      position: relative; z-index: 2;
    }
    .land-icon {
      width: 44px; height: 44px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--land-accent), var(--land-accent2));
      color: #fff; font-size: 18px; font-weight: 700;
      box-shadow: 0 8px 20px color-mix(in oklab, var(--land-accent) 40%, transparent);
      align-self: center;
    }
    .land-title {
      font-family: 'Fraunces', 'Playfair Display', serif;
      font-weight: 600;
      font-size: 32px; line-height: 1.1; letter-spacing: -.015em;
      color: var(--ink);
      margin: 0;
    }
    .land-count {
      font: 500 12.5px/1 'Poppins', sans-serif;
      color: var(--dim); letter-spacing: .02em;
    }
    .land-rule {
      flex: 1; height: 2px;
      background: linear-gradient(90deg, var(--land-accent) 0%, transparent 100%);
      opacity: .35;
      border-radius: 1px;
    }

    .land-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 24px 20px;
      padding: 0 48px;
      position: relative; z-index: 2;
    }

    /* ---- POSTCARD ---- */
    .postcard {
      position: relative;
      background: #fff;
      border-radius: 20px;
      overflow: visible;
      cursor: pointer;
      box-shadow:
        0 10px 24px rgba(53,42,74,.08),
        0 2px 6px rgba(53,42,74,.05);
      transition: transform .28s cubic-bezier(.2,1.1,.3,1), box-shadow .28s ease;
      border: 1px solid var(--line);
    }
    .postcard:hover, .postcard:focus-visible {
      transform: translateY(-5px) rotate(0deg) !important;
      box-shadow:
        0 18px 42px rgba(53,42,74,.14),
        0 4px 10px rgba(53,42,74,.08);
      outline: none;
    }
    .postcard.pinned { border-color: color-mix(in oklab, var(--dawn) 50%, var(--line2)); }

    .postcard-mood {
      position: absolute; top: -8px; right: -8px; z-index: 3;
      width: 36px; height: 36px; border-radius: 50%;
      background: #fff;
      border: 2px solid var(--mood-color);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 16px;
      box-shadow: 0 4px 12px color-mix(in oklab, var(--mood-color) 40%, transparent);
    }

    .postcard-thumb {
      position: relative;
      aspect-ratio: 4 / 3;
      border-radius: 20px 20px 0 0;
      overflow: hidden;
      background: linear-gradient(135deg, var(--land-accent) 0%, var(--land-accent2) 100%);
    }
    .postcard-img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .5s ease; }
    .postcard:hover .postcard-img { transform: scale(1.04); }
    .postcard-thumb.no-img::after {
      content: ""; position: absolute; inset: 0;
      background:
        radial-gradient(circle at 30% 30%, rgba(255,255,255,.3) 0%, transparent 40%),
        radial-gradient(circle at 70% 70%, rgba(255,255,255,.2) 0%, transparent 40%);
    }
    .postcard-ribbon {
      position: absolute; bottom: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--land-accent), var(--land-accent2));
    }

    .postcard-info { padding: 14px 16px 14px; }
    .postcard-title {
      font-family: 'Fraunces', 'Playfair Display', serif;
      font-weight: 500;
      font-size: 17px; line-height: 1.3; letter-spacing: -.01em;
      color: var(--ink);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      margin-bottom: 4px;
    }
    .postcard-host {
      font: 500 11.5px/1.3 'Poppins', sans-serif;
      color: var(--mut); letter-spacing: .02em;
    }
    .postcard-note {
      margin-top: 6px;
      font: 400 12.5px/1.5 'Poppins', sans-serif;
      color: var(--dim);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .postcard-stats {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      margin-top: 10px; padding-top: 10px;
      border-top: 1px dashed var(--line);
    }
    .postcard-plays {
      font: 600 10.5px/1 'Poppins', sans-serif;
      letter-spacing: .1em; text-transform: uppercase;
      color: var(--mut);
    }
    .postcard-journal-tag {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 7px; border-radius: 10px;
      background: color-mix(in oklab, var(--land-accent) 15%, transparent);
      color: var(--ink);
      font: 600 10px/1 'Poppins', sans-serif; letter-spacing: .04em;
    }

    .postcard-actions {
      position: absolute; top: 10px; left: 10px;
      display: flex; gap: 4px;
      opacity: 0; transform: translateY(-4px);
      transition: opacity .2s ease, transform .2s ease;
    }
    .postcard:hover .postcard-actions, .postcard:focus-within .postcard-actions { opacity: 1; transform: translateY(0); }
    .pc-btn {
      width: 28px; height: 28px; border-radius: 50%;
      background: rgba(255,255,255,.88);
      backdrop-filter: blur(6px);
      border: 1px solid var(--line);
      color: var(--ink); font-size: 13px;
      cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all .14s ease;
    }
    .pc-btn:hover { background: var(--ink); color: #fff; border-color: var(--ink); }

    /* ---- EMPTY ---- */
    .dl-empty {
      text-align: center;
      padding: 80px 48px 160px;
      max-width: 540px; margin: 0 auto;
    }
    .dl-empty-illus {
      font-size: 56px; margin-bottom: 20px;
      color: var(--violet);
      filter: drop-shadow(0 6px 16px color-mix(in oklab, var(--lavender) 50%, transparent));
      animation: twinkle 3s ease-in-out infinite;
    }
    .dl-empty h2 {
      font-family: 'Fraunces', 'Playfair Display', serif;
      font-weight: 500;
      font-size: 32px; line-height: 1.2; letter-spacing: -.015em;
      color: var(--ink);
      margin: 0 0 14px;
    }
    .dl-empty p { font: 400 15px/1.65 'Poppins', sans-serif; color: var(--dim); margin: 0 0 28px; }

    /* ---- RITUAL OVERLAY ---- */
    .dl-ritual {
      position: fixed; inset: 0; z-index: 2000;
      background: rgba(255, 248, 236, .97);
      backdrop-filter: blur(14px);
      display: flex; align-items: center; justify-content: center;
      padding: 40px;
      animation: ritFade .4s ease both;
    }
    @keyframes ritFade { from { opacity: 0; } to { opacity: 1; } }
    .dl-ritual-glow {
      position: absolute; inset: 0;
      background:
        radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--rose) 35%, transparent) 0%, transparent 55%),
        radial-gradient(circle at 20% 80%, color-mix(in oklab, var(--mint) 25%, transparent) 0%, transparent 55%),
        radial-gradient(circle at 80% 30%, color-mix(in oklab, var(--lavender) 25%, transparent) 0%, transparent 55%);
    }
    .dl-ritual-inner { position: relative; text-align: center; max-width: 420px; }
    .dl-ritual-breath {
      width: 140px; height: 140px; border-radius: 50%;
      margin: 0 auto 32px;
      background: linear-gradient(135deg, var(--rose), var(--peach), var(--dawn));
      box-shadow:
        0 0 60px color-mix(in oklab, var(--rose) 50%, transparent),
        inset 0 2px 10px rgba(255,255,255,.3);
      animation: breath 2.6s ease-in-out;
    }
    @keyframes breath {
      0%   { transform: scale(.6); opacity: .5; }
      40%  { transform: scale(1.1); opacity: 1; }
      100% { transform: scale(1.15); opacity: .95; }
    }
    .dl-ritual-eyebrow {
      font: 600 11.5px/1 'Poppins', sans-serif;
      letter-spacing: .22em; text-transform: uppercase;
      color: var(--violet);
      margin-bottom: 12px;
    }
    .dl-ritual-title {
      font-family: 'Fraunces', 'Playfair Display', serif;
      font-weight: 500;
      font-size: 28px; line-height: 1.3;
      color: var(--ink);
      margin-bottom: 14px;
    }
    .dl-ritual-sub { font: 400 15px/1.6 'Poppins', sans-serif; color: var(--dim); max-width: 360px; margin: 0 auto; }

    /* ---- JOURNAL PROMPT ---- */
    .dl-journal {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      z-index: 1600;
      min-width: 420px; max-width: 90vw;
      background: #fff;
      border: 1px solid var(--line2);
      border-radius: 20px;
      padding: 16px 20px;
      box-shadow: 0 20px 50px rgba(53,42,74,.18);
      animation: jSlide .3s cubic-bezier(.2,1.1,.3,1) both;
    }
    @keyframes jSlide { from { opacity: 0; transform: translate(-50%, 20px); } to { opacity: 1; transform: translate(-50%, 0); } }
    .dl-journal-head {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 12px;
      font: 500 13px/1.3 'Poppins', sans-serif; color: var(--dim);
    }
    .dl-journal-eyebrow { color: var(--mut); font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; }
    .dl-journal-head strong { color: var(--ink); font-weight: 700; }
    .dl-journal-close {
      margin-left: auto; width: 24px; height: 24px; border-radius: 50%;
      background: transparent; border: none; color: var(--mut);
      cursor: pointer; font-size: 16px;
    }
    .dl-journal-close:hover { color: var(--ink); }
    .dl-journal-row { display: flex; gap: 8px; align-items: center; }
    .dl-journal-row input {
      flex: 1; padding: 11px 14px;
      background: rgba(53,42,74,.04); border: 1px solid var(--line);
      border-radius: 12px;
      color: var(--ink);
      font: 500 14px/1.3 'Poppins', sans-serif;
      outline: none;
    }
    .dl-journal-row input:focus { border-color: var(--violet); background: #fff; }

    /* ---- MODAL ---- */
    .dl-scrim {
      position: fixed; inset: 0; z-index: 1500;
      background: rgba(27, 18, 69, .35);
      backdrop-filter: blur(10px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: ritFade .22s ease both;
    }
    .dl-modal {
      background: #fff; border-radius: 24px;
      width: 100%; max-width: 540px; max-height: 92vh;
      display: flex; flex-direction: column; overflow: hidden;
      color: var(--ink);
      box-shadow: 0 40px 90px rgba(53,42,74,.3);
      animation: ritPop .3s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes ritPop { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .dl-m-head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 22px 26px 18px;
      border-bottom: 1px solid var(--line);
    }
    .dl-m-eyebrow {
      font: 600 11.5px/1 'Poppins', sans-serif;
      letter-spacing: .18em; text-transform: uppercase;
      color: var(--violet);
    }
    .dl-m-close {
      width: 30px; height: 30px; border-radius: 50%;
      background: transparent; border: 1px solid var(--line);
      color: var(--mut); cursor: pointer; font-size: 18px;
    }
    .dl-m-close:hover { color: var(--ink); border-color: var(--line2); }
    .dl-m-body { padding: 22px 26px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
    .dl-m-field { display: flex; flex-direction: column; gap: 8px; }
    .dl-m-k {
      font: 600 11px/1 'Poppins', sans-serif;
      letter-spacing: .14em; text-transform: uppercase; color: var(--mut);
    }
    .dl-m-k small { font-weight: 500; letter-spacing: 0; text-transform: none; margin-left: 6px; opacity: .8; }
    .dl-m-field input, .dl-m-field select {
      width: 100%; padding: 12px 14px;
      background: rgba(53,42,74,.03);
      border: 1px solid var(--line);
      border-radius: 12px;
      color: var(--ink);
      font: 500 14px/1.3 'Poppins', sans-serif;
      outline: none; box-sizing: border-box;
      transition: border-color .18s ease, background .18s ease;
    }
    .dl-m-field input:focus, .dl-m-field select:focus {
      border-color: var(--violet); background: #fff;
    }
    .dl-m-field input::placeholder { color: var(--mut); }
    .dl-m-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 480px) { .dl-m-two { grid-template-columns: 1fr; } }

    .dl-m-preview {
      display: flex; gap: 14px; align-items: center;
      padding: 14px;
      background: rgba(53,42,74,.03);
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .dl-m-thumb-wrap { width: 84px; height: 84px; border-radius: 10px; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg, var(--rose), var(--peach)); }
    .dl-m-thumb-wrap img { width: 100%; height: 100%; object-fit: cover; }
    .dl-m-meta { min-width: 0; flex: 1; }
    .dl-m-ptitle { font-family: 'Fraunces', serif; font: 500 15px/1.3 'Fraunces', serif; color: var(--ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .dl-m-phost { font: 500 12px/1.3 'Poppins', sans-serif; color: var(--dim); margin-top: 4px; }

    /* Mood chips in modal */
    .dl-mood-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .dl-mood-chip {
      --mood-color: var(--mut);
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: 999px;
      background: rgba(53,42,74,.03); border: 1px solid var(--line);
      color: var(--ink); font: 500 13px/1 'Poppins', sans-serif;
      cursor: pointer; transition: all .14s ease;
    }
    .dl-mood-chip:hover { border-color: var(--mood-color); background: color-mix(in oklab, var(--mood-color) 10%, #fff); }
    .dl-mood-chip.active { border-color: var(--mood-color); background: var(--mood-color); color: var(--ink); font-weight: 700; }
    .dl-mood-chip .dl-mood-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--mood-color);
      box-shadow: 0 0 8px color-mix(in oklab, var(--mood-color) 50%, transparent);
    }

    .dl-m-foot {
      display: flex; justify-content: flex-end; gap: 10px;
      padding: 16px 26px;
      border-top: 1px solid var(--line);
      background: rgba(255,241,220,.5);
    }
    .dl-m-btn {
      padding: 11px 22px; border-radius: 999px;
      font: 600 13px/1 'Poppins', sans-serif;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all .18s ease;
      background: transparent;
    }
    .dl-m-btn.ghost { color: var(--dim); border-color: var(--line2); }
    .dl-m-btn.ghost:hover { color: var(--ink); border-color: var(--ink); }
    .dl-m-btn.primary {
      background: linear-gradient(135deg, var(--rose), var(--peach));
      color: #fff;
      box-shadow: 0 8px 20px color-mix(in oklab, var(--rose) 40%, transparent);
    }
    .dl-m-btn.primary:hover:not(:disabled) { transform: translateY(-1px); }
    .dl-m-btn.primary:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }

    /* Mobile */
    @media (max-width: 720px) {
      .dl-hero { padding: 56px 24px 44px; }
      .land { margin: 0 12px 24px; padding: 36px 0; }
      .land-head { padding: 0 24px 24px; }
      .land-cards { padding: 0 24px; grid-template-columns: 1fr; }
      .land-title { font-size: 24px; }
    }
  `;
  document.head.appendChild(s);
}
