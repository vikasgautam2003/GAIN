// Shop — v5 design ported in. Preserves: tier-system unlock gating, inline 2-click
// claim with murim quote toast, honor-check feedback, daily withdraw cap, edit/add
// reward CRUD. New: wishlist chain, hero (next unlock), momentum sparkline, star
// toggle on each reward card, elegant tabs.

import {
  getWallet, getSettings, updateWallet, getRewards,
  addReward, updateReward, removeReward, getSpendQuote,
  getShopQuote,
  getWishlist, isWishlisted, toggleWishlist,
  computeMomentum, earningsLast7Days,
  importRewardsFromCsv, clearRewardsCatalog, getRewardTypes,
  getDayLog, on
} from "./store.js";
import { todayKey, priceTask } from "./engine.js";
import { confirmDanger, openFormModal } from "./modals.js";

// --- Tier definitions (settings-driven, with safe defaults) ---
function getTiers() {
  const t = getSettings().wallet.tierUnlocks || {};
  return [
    { key: "small",  label: "Small",  unlockEarn: Number(t.small  ?? 20),   note: "Daily unlock · ₹20–₹500" },
    { key: "medium", label: "Medium", unlockEarn: Number(t.medium ?? 500),  note: "Weekly unlock · ₹500–₹2000" },
    { key: "large",  label: "Large",  unlockEarn: Number(t.large  ?? 2000), note: "Monthly unlock · ₹2000–₹5000" },
    { key: "mega",   label: "Mega",   unlockEarn: Number(t.mega   ?? 5000), note: "Stretch · ₹5000+" }
  ];
}

// Module state (persist across re-renders within a session)
let activeTab = "all";
let editing = null;
let addingTier = null;
let unsub = null;
let quoteTimer = null;
let pendingClaim = null;
let pendingTimer = null;
let reelTimer = null;
let reelIdx = 0;

export default {
  mount(root) {
    root.innerHTML = render();
    paint(root);
    attach(root);
    startQuoteRotation(root);
    if (unsub) unsub();
    unsub = on((ev) => {
      if (ev === "wallet" || ev === "rewards" || ev === "settings" || ev === "shopQuotes") paint(root);
    });
  },
  unmount() {
    if (unsub) { unsub(); unsub = null; }
    if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; }
    if (reelTimer)  { clearInterval(reelTimer);  reelTimer  = null; }
    clearPendingTimer();
  }
};

// -------------------------------------------------------------
// Render shell. paint() fills the dynamic parts.
// -------------------------------------------------------------
function render() {
  return `
    <div class="view-inner shop">

      <!-- Hero carousel + a lean "where you are" status strip underneath -->
      <section class="shop-reel" id="shop-reel" aria-roledescription="carousel"></section>
      <section class="shop-status" id="shop-status"></section>

      <!-- Wallet stat columns -->
      <section class="wallet-sec">
        <div class="wallet" id="wallet-strip"></div>
      </section>

      <!-- Wishlist chain -->
      <section class="chain-wrap">
        <div class="section-head centered">
          <h2>Your <span class="italic">wishlist chain</span>.</h2>
          <p class="section-sub"><span id="chain-count">0 stops</span> · <span id="chain-sub">—</span></p>
        </div>
        <div class="path" id="chain-path"></div>
      </section>

      <!-- Catalog -->
      <section class="catalog-sec">
        <div class="section-head centered">
          <h2>Everything in the shop.</h2>
          <p class="section-sub">Browse. Star what you want. Build your chain.</p>
          <div class="section-actions">
            <div class="section-actions-row">
              <button class="shop-add-btn" id="catalog-add" title="Add a reward, append CSV, or replace the catalog">+ Add</button>
              <button class="clear-btn" id="catalog-clear" title="Delete every item in the shop">Clear catalog</button>
              <input type="file" id="catalog-import" accept=".csv,text/csv" hidden />
              <input type="file" id="catalog-replace" accept=".csv,text/csv" hidden />
            </div>
            <small class="import-hint">CSV columns: <code>id,name,type,category,tier,price_inr,store,product_url,image_url,notes</code> · type auto-infers from category if blank</small>
          </div>
        </div>
        <div class="tabs" id="shop-tabs"></div>
        <div class="grid" id="shop-grid"></div>
      </section>

      <!-- Why columns -->
      <section class="why" id="shop-why">
        <div class="why-col"><div class="num">01</div><h4>Earned, not bought.</h4>
          <p>Rupees here are not real money. They are <em>the honest proof</em> of a problem you solved on a day you did not want to.</p></div>
        <div class="why-col"><div class="num">02</div><h4>A reward is a station.</h4>
          <p>Pick one you want. It becomes the next thing worth climbing toward. The chain of problems between you and it <em>is the entire point</em>.</p></div>
        <div class="why-col"><div class="num">03</div><h4>Claim with honor.</h4>
          <p>When you have earned enough, you tick a box and spend. <em>No audit, no gate.</em> The jianghu remembers only what you banked.</p></div>
      </section>

      <!-- Ledger -->
      <section class="ledger-card">
        <div class="s-head">
          <h3>Recent ledger</h3>
          <span class="s-tag">Nothing earned is ever wiped.</span>
        </div>
        <div id="ledger-rows"></div>
      </section>

      <div id="near-bar-mount"></div>
      ${styles()}
    </div>
  `;
}

// -------------------------------------------------------------
// paint() — recomputes everything from live state
// -------------------------------------------------------------
function paint(root) {
  const w = getWallet();
  const s = getSettings();
  const tiers = getTiers();
  const wishlist = getWishlist();

  paintReel(root, w, wishlist, tiers);
  paintStatus(root, w, wishlist, tiers);
  paintChain(root, w, wishlist, tiers);
  paintWallet(root, w);
  paintTabs(root, wishlist);
  paintGrid(root, w, s, tiers);
  paintLedger(root, w);
  paintNearBar(root, w, wishlist, tiers);
}

// ---------- NETFLIX-STYLE HERO REEL ----------
const REEL_MOTIVATIONS = [
  "This is what the chain is for.",
  "Pay for it in problems solved.",
  "A reward is a station on your climb.",
  "Earn it. Then own it like you earned it.",
  "The jianghu remembers only the ones who finished.",
  "Discipline builds freedom. And this.",
  "Yours when the problems are done.",
  "You know what you came here to do.",
  "The dao does not grant them. You earn them.",
  "No shortcut to this. Only the chain."
];

// Date-seeded shuffle so featured items change daily but stay stable within a day.
function dailySeed() {
  const key = todayKey();
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seededShuffle(arr, seed) {
  const out = arr.slice();
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickReelFeatured(catalog, wishlist) {
  // Priority: wishlisted (with image) → mega (with image) → large (with image) → anything with image.
  // Within each bucket, shuffle by today's date so the lineup rotates daily but stays stable all day.
  const seed = dailySeed();
  const haveImage = catalog.filter(r => r.imageUrl);
  const wished = seededShuffle(haveImage.filter(r => wishlist.find(w => w.id === r.id)), seed);
  const mega   = seededShuffle(haveImage.filter(r => r.tier === "mega"),   seed ^ 0x9e3779b1);
  const large  = seededShuffle(haveImage.filter(r => r.tier === "large"),  seed ^ 0x7f4a7c15);
  const rest   = seededShuffle(haveImage,                                  seed ^ 0x85ebca77);
  const seen = new Set();
  const pool = [];
  for (const bucket of [wished, mega, large, rest]) {
    for (const r of bucket) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      pool.push(r);
      if (pool.length >= 6) return pool;
    }
  }
  return pool;
}

function paintReel(root, w, wishlist, tiers) {
  const el = root.querySelector("#shop-reel");
  if (!el) return;
  const catalog = getRewards().catalog;
  const featured = pickReelFeatured(catalog, wishlist);

  if (!featured.length) {
    el.innerHTML = "";
    el.style.display = "none";
    if (reelTimer) { clearInterval(reelTimer); reelTimer = null; }
    return;
  }
  el.style.display = "";

  // Build all slide markup; CSS classes drive which is visible.
  reelIdx = Math.min(reelIdx, featured.length - 1);
  const slides = featured.map((r, i) => renderReelSlide(r, i, w, tiers)).join("");
  const dots = featured.map((_, i) => `<button class="reel-dot ${i === reelIdx ? "on" : ""}" data-reel-dot="${i}" aria-label="Slide ${i+1}"></button>`).join("");

  el.innerHTML = `
    <div class="reel-stage">
      ${slides}
    </div>
    <div class="reel-dots">${dots}</div>
  `;

  // Mark the active slide
  el.querySelectorAll(".reel-slide").forEach((s, i) => s.classList.toggle("on", i === reelIdx));

  // Wire dots
  el.querySelectorAll("[data-reel-dot]").forEach(btn => {
    btn.addEventListener("click", () => {
      reelIdx = Number(btn.dataset.reelDot);
      updateReel(el);
      restartReelTimer(el, featured.length);
    });
  });
  // Wire click-slide (opens item in catalog via scroll + highlight)
  el.querySelectorAll(".reel-slide [data-reel-target]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const rid = btn.dataset.reelTarget;
      const r = catalog.find(x => x.id === rid);
      if (!r) return;
      if (btn.dataset.reelAction === "wish") {
        await toggleWishlist(rid);
        return;
      }
      // Scroll to the item in the catalog
      activeTab = "all";
      paint(root);
      setTimeout(() => {
        const card = document.querySelector(`[data-rid="${rid}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
        card?.animate(
          [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }],
          { duration: 700, easing: "cubic-bezier(.2,.7,.2,1)" }
        );
      }, 60);
    });
  });

  restartReelTimer(el, featured.length);
}

function renderReelSlide(r, i, w, tiers) {
  const motivation = REEL_MOTIVATIONS[i % REEL_MOTIVATIONS.length];
  const store = (r.store || "GAIN").toUpperCase();
  const tier = tiers.find(t => t.key === r.tier);
  const tierUnlocked = !tier || w.earned >= tier.unlockEarn;
  const need = Math.max(0, r.price - w.available);
  const pct = Math.min(100, Math.round(100 * w.available / r.price));
  const wished = isWishlisted(r.id);

  let eyebrow;
  if (!tierUnlocked) eyebrow = `TIER LOCKED · ${tier.label.toUpperCase()}`;
  else if (need === 0) eyebrow = `READY TO CLAIM`;
  else eyebrow = `${pct}% EARNED · ₹${need.toLocaleString()} TO GO`;

  const img = r.imageUrl
    ? `<img src="${esc(encodeImageUrl(r.imageUrl))}" alt="${esc(r.title)}" onerror="this.outerHTML='<div class=&quot;reel-glyph&quot;>${esc(r.emoji||"🎁")}</div>'">`
    : `<div class="reel-glyph">${esc(r.emoji || "🎁")}</div>`;

  return `
    <article class="reel-slide tier-${esc(r.tier || "custom")}" data-slide="${i}">
      <div class="reel-copy">
        <div class="reel-eyebrow">${esc(eyebrow)}</div>
        <div class="reel-store">${esc(store)}</div>
        <h2 class="reel-title">${esc(r.title)}</h2>
        <div class="reel-price">₹${r.price.toLocaleString()}</div>
        <p class="reel-motiv">${esc(motivation)}</p>
        <div class="reel-ctas">
          <button class="reel-cta reel-cta-primary" data-reel-target="${esc(r.id)}">View in shop →</button>
          <button class="reel-cta reel-cta-ghost ${wished ? "on" : ""}" data-reel-target="${esc(r.id)}" data-reel-action="wish">
            ${wished ? "★ On wishlist" : "☆ Add to wishlist"}
          </button>
        </div>
      </div>
      <div class="reel-media">${img}</div>
    </article>
  `;
}

function updateReel(el) {
  el.querySelectorAll(".reel-slide").forEach((s, i) => s.classList.toggle("on", i === reelIdx));
  el.querySelectorAll(".reel-dot").forEach((d, i) => d.classList.toggle("on", i === reelIdx));
}

function restartReelTimer(el, n) {
  if (reelTimer) clearInterval(reelTimer);
  if (n <= 1) return;
  reelTimer = setInterval(() => {
    reelIdx = (reelIdx + 1) % n;
    updateReel(el);
  }, 3400);
}

// --------- STATUS STRIP (thin, state-aware, under the reel) ---------
function paintStatus(root, w, wishlist, tiers) {
  const el = root.querySelector("#shop-status");
  if (!el) return;
  const next = pickNextTarget(w, wishlist, tiers);

  // State 1 — empty wishlist
  if (!wishlist.length) {
    el.innerHTML = `
      <div class="status-strip status-strip--empty">
        <div class="st-left">
          <div class="st-lb">YOUR CHAIN</div>
          <div class="st-main">Unanchored. Star 3 items below to start your climb.</div>
        </div>
        <div class="st-right">
          <div class="st-tally">
            <span class="st-tally-num">${w.available.toLocaleString()}</span>
            <span class="st-tally-lb">₹ ready to spend</span>
          </div>
          <button class="st-cta" id="st-browse">Browse catalog ↓</button>
        </div>
      </div>
    `;
    el.querySelector("#st-browse")?.addEventListener("click", () => {
      document.querySelector("#shop-grid")?.scrollIntoView({ behavior: "smooth" });
    });
    return;
  }

  // State 2+ — a next target exists
  const need = Math.max(0, (next?.price || 0) - w.available);
  const tier = tiers.find(t => t.key === next.tier);
  const tierUnlocked = !tier || w.earned >= tier.unlockEarn;
  const pct = Math.min(100, Math.round(100 * (w.available / next.price)));

  let state, lb, main, right, barPct;
  if (!tierUnlocked) {
    const gap = (tier.unlockEarn || 0) - w.earned;
    state = "locked";
    lb = `TIER LOCKED · ${tier.label.toUpperCase()}`;
    main = `${esc(next.title)}`;
    right = `<span class="st-away"><b>₹${gap.toLocaleString()}</b> earned to unlock</span>`;
    barPct = Math.min(100, Math.round(100 * w.earned / tier.unlockEarn));
  } else if (need === 0) {
    state = "ready";
    lb = `READY TO CLAIM`;
    main = `${esc(next.title)}`;
    right = `<span class="st-away st-away--ready"><b>₹${next.price.toLocaleString()}</b> waiting</span>`;
    barPct = 100;
  } else {
    state = "near";
    lb = `NEXT ON YOUR CHAIN · ${pct}%`;
    main = `${esc(next.title)}`;
    right = `<span class="st-away"><b>₹${need.toLocaleString()}</b> to go</span>`;
    barPct = pct;
  }

  el.innerHTML = `
    <div class="status-strip status-strip--${state}">
      <div class="st-left">
        <div class="st-lb">${lb}</div>
        <div class="st-main">${main}</div>
        <div class="st-bar"><span style="width:${barPct}%"></span></div>
      </div>
      <div class="st-right">
        ${right}
        <button class="st-cta" id="st-act">${state === "ready" ? "Claim it ↓" : state === "locked" ? "Keep earning ↓" : "Open Today ▶"}</button>
      </div>
    </div>
  `;

  el.querySelector("#st-act")?.addEventListener("click", () => {
    if (state === "ready") {
      const card = document.querySelector(`[data-rid="${next.id}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (state === "near") {
      location.hash = "#today";
    } else {
      document.querySelector("#shop-grid")?.scrollIntoView({ behavior: "smooth" });
    }
  });
}

// --------- (legacy) HERO — unused since paintStatus replaced it ---------
function paintHero(root, w, wishlist, tiers) {
  const el = root.querySelector("#shop-hero");
  // "Next unlock" = cheapest wishlisted item they can almost afford (or that unlocks next)
  const next = pickNextTarget(w, wishlist, tiers);

  if (!next) {
    el.innerHTML = `
      <div class="hero-body">
        <div class="hero-tag">Wishlist is empty</div>
        <h2 class="hero-title">Pick what would make you <span class="italic">work</span>.</h2>
        <p class="hero-sub">Scroll the catalog below and tap the <b>★</b> on anything you want. It becomes a station on your climb.</p>
        <div class="hero-ctas">
          <button class="cta-primary" id="hero-cta">Browse catalog</button>
          <button class="cta-ghost" id="hero-cta-sub-btn">About the chain <span class="ar">›</span></button>
        </div>
      </div>
      <div class="hero-media">
        <div class="halo"></div>
        <div class="glyph">⟡</div>
      </div>
    `;
    el.querySelector("#hero-cta")?.addEventListener("click", () => {
      document.querySelector("#shop-grid")?.scrollIntoView({ behavior: "smooth" });
    });
    el.querySelector("#hero-cta-sub-btn")?.addEventListener("click", () => {
      document.querySelector("#shop-why")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return;
  }

  const need = Math.max(0, next.price - w.available);
  const tier = tiers.find(t => t.key === next.tier);
  const tierUnlocked = tier ? w.earned >= tier.unlockEarn : true;
  const pct = Math.min(100, Math.round(100 * (w.available / next.price)));

  let tagText, bodyHtml;
  if (!tierUnlocked) {
    const tierGap = (tier.unlockEarn || 0) - w.earned;
    tagText = `Tier locked · unlocks at ₹${tier.unlockEarn.toLocaleString()} earned`;
    bodyHtml = `
      <h2 class="hero-title">${esc(next.title)}.</h2>
      <p class="hero-sub">You're <span class="lift">₹${tierGap.toLocaleString()}</span> from unlocking the ${tier.label} tier. Then this is yours for ₹${next.price.toLocaleString()}.</p>
      <div class="hero-prog">
        <span class="big">₹${tierGap.toLocaleString()}</span>
        <span class="small">to unlock ${tier.label}</span>
      </div>
      <div class="hero-bar"><span style="width:${Math.min(100, Math.round(100 * w.earned / tier.unlockEarn))}%"></span></div>`;
  } else if (need === 0) {
    tagText = `Ready to claim · 100%`;
    bodyHtml = `
      <h2 class="hero-title">${esc(next.title)}.</h2>
      <p class="hero-sub"><span class="lift">You earned it.</span> Scroll down and claim with honor.</p>
      <div class="hero-prog">
        <span class="big">₹${next.price.toLocaleString()}</span>
        <span class="small">ready</span>
      </div>
      <div class="hero-bar"><span style="width:100%"></span></div>`;
  } else {
    tagText = `On your chain · ${pct}% earned`;
    bodyHtml = `
      <h2 class="hero-title">${esc(next.title)}.</h2>
      <p class="hero-sub">${estimateProblemsCopy(need)}. <span class="lift">Open Today, solve them, come back.</span></p>
      <div class="hero-prog">
        <span class="big">₹${need.toLocaleString()}</span>
        <span class="small">to go of ₹${next.price.toLocaleString()}</span>
      </div>
      <div class="hero-bar"><span style="width:${pct}%"></span></div>`;
  }

  const ctaLabel = need === 0 ? "Claim now" : "Open Today's grind";
  const subLabel = need === 0 ? "See the reward" : "See the math";

  el.innerHTML = `
    <div class="hero-body">
      <div class="hero-tag">${tagText}</div>
      ${bodyHtml}
      <div class="hero-ctas">
        <button class="cta-primary" id="hero-cta">${ctaLabel}</button>
        <button class="cta-ghost" id="hero-cta-sub-btn">${subLabel} <span class="ar">›</span></button>
      </div>
    </div>
    <div class="hero-media">
      <div class="halo"></div>
      <div class="glyph">
        ${next.imageUrl
          ? `<img src="${esc(encodeImageUrl(next.imageUrl))}" alt="" onerror="this.outerHTML='${esc(next.emoji||"⟡")}'">`
          : esc(next.emoji || "⟡")}
      </div>
    </div>
  `;

  el.querySelector("#hero-cta")?.addEventListener("click", () => {
    if (need === 0) {
      document.querySelector(`[data-rid="${next.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      location.hash = "#today";
    }
  });
  el.querySelector("#hero-cta-sub-btn")?.addEventListener("click", () => {
    document.querySelector("#shop-why")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function pickNextTarget(w, wishlist, tiers) {
  if (!wishlist.length) return null;
  // Priority: unlocked-tier wishlisted items the user is CLOSEST to affording
  const unlocked = wishlist.filter(r => {
    const tier = tiers.find(t => t.key === r.tier);
    return !tier || w.earned >= tier.unlockEarn;
  });
  if (unlocked.length) {
    // The one with the smallest shortfall (negative = already affordable, pick cheapest)
    return unlocked.sort((a, b) => (a.price - w.available) - (b.price - w.available))[0];
  }
  // Otherwise return the cheapest wishlisted item (will show tier-locked state)
  return [...wishlist].sort((a, b) => a.price - b.price)[0];
}

function estimateMinutesForEarn(amount) {
  // Rough: assume ₹20-30 per 25-min easy problem
  const perMin = 1; // ₹1/min as rough average
  return Math.max(15, Math.round(amount / perMin));
}
function estimateProblemsCopy(amount) {
  const avgPrice = 30;  // average easy problem bounty
  const n = Math.max(1, Math.round(amount / avgPrice));
  if (n === 1) return "One easy problem at your current pace";
  if (n <= 3) return `${n} easy problems at your current pace`;
  return `${n} problems at your current pace`;
}

// --------- WISHLIST CHAIN ---------
function paintChain(root, w, wishlist, tiers) {
  const pathEl = root.querySelector("#chain-path");
  const countEl = root.querySelector("#chain-count");
  const subEl = root.querySelector("#chain-sub");

  countEl.textContent = `${wishlist.length} STOP${wishlist.length === 1 ? "" : "S"}`;

  if (!wishlist.length) {
    pathEl.className = "path empty";
    pathEl.innerHTML = `
      <div class="big">No stops on your chain yet</div>
      <div class="small">Star rewards below to add them here. The next-nearest becomes NOW.</div>
    `;
    subEl.textContent = "";
    return;
  }

  pathEl.className = "path";
  const totalRemaining = wishlist.reduce((a, r) => a + Math.max(0, r.price - 0), 0);  // sum of prices
  const needForChain = Math.max(0, wishlist.reduce((a, r) => a + r.price, 0) - w.spent - w.available);
  const momentum = computeMomentum(2);
  const etaWeeks = momentum > 0 ? Math.ceil(needForChain / momentum) : null;
  subEl.innerHTML = etaWeeks != null
    ? `ETA to full chain at current pace: <b>${etaWeeks} week${etaWeeks===1?"":"s"}</b>`
    : `Start earning to project an ETA`;

  // Figure out which is NOW: first wishlisted item that user hasn't earned yet (tier-aware)
  // "hit" = user has earned enough to cover its price (ignoring daily cap)
  // "now" = first non-hit item
  let nowFound = false;
  const stations = wishlist.map(r => {
    const tier = tiers.find(t => t.key === r.tier);
    const tierUnlocked = !tier || w.earned >= tier.unlockEarn;
    const affordable = tierUnlocked && w.available >= r.price;
    const hit = affordable;
    const now = !hit && !nowFound;
    if (now) nowFound = true;
    return { r, hit, now, tierUnlocked };
  });

  const parts = [];
  stations.forEach((s, i) => {
    const stateClass = s.hit ? "hit" : (s.now ? "now" : "");
    const lb = s.hit ? "READY" : (s.now ? "NEXT" : "THEN");
    const need = Math.max(0, s.r.price - w.available);
    const eta = s.hit ? "ready to claim"
      : !s.tierUnlocked ? "tier upgrade needed"
      : `₹${need.toLocaleString()} · ${estimateProblemsCopy(need).toLowerCase()}`;

    parts.push(`
      <div class="station ${stateClass}" data-rid="${esc(s.r.id)}">
        <button class="x" title="Remove from wishlist" data-chain-remove="${esc(s.r.id)}">×</button>
        <div class="pt">${s.r.imageUrl ? `<img src="${esc(encodeImageUrl(s.r.imageUrl))}" alt="" onerror="this.outerHTML='${esc(s.r.emoji||"🎁")}'">` : esc(s.r.emoji||"🎁")}</div>
        <div class="lb">${lb}${s.now ? ` · ${Math.min(100, Math.round(100 * w.available / s.r.price))}%` : ""}</div>
        <div class="nm">${esc(s.r.title)} · ₹${s.r.price.toLocaleString()}</div>
        <div class="eta">${esc(eta)}</div>
      </div>
    `);
    if (i < stations.length - 1) {
      const nextIsNow = stations[i + 1].now;
      const connCls = s.hit && stations[i + 1].hit ? "hit" : s.hit && nextIsNow ? "now" : s.hit ? "hit" : "";
      parts.push(`<div class="connector ${connCls}"></div>`);
    }
  });
  // Add-stop slot
  parts.push(`
    <div class="add-slot">
      <button class="pt" id="chain-add" title="Browse the catalog">+</button>
      <div class="lb">ADD STOP</div>
    </div>
  `);

  pathEl.innerHTML = parts.join("");

  // Wire remove buttons
  pathEl.querySelectorAll("[data-chain-remove]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await toggleWishlist(btn.dataset.chainRemove);
    });
  });
  pathEl.querySelector("#chain-add")?.addEventListener("click", () => {
    document.querySelector("#shop-grid")?.scrollIntoView({ behavior: "smooth" });
  });
  // Click a station → scroll to the matching card
  pathEl.querySelectorAll(".station[data-rid]").forEach(stn => {
    stn.addEventListener("click", (e) => {
      if (e.target.closest("[data-chain-remove]")) return;
      const card = document.querySelector(`[data-rid="${stn.dataset.rid}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

// --------- WALLET + MOMENTUM ---------
function paintWallet(root, w) {
  const el = root.querySelector("#wallet-strip");
  const perWeek = computeMomentum(2);
  const buckets = earningsLast7Days();
  const max = Math.max(1, ...buckets);
  const spark = buckets.map((v, i) => {
    const x = (i / 6) * 100;
    const y = 30 - (v / max) * 24;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  el.innerHTML = `
    <div>
      <div class="w-lb">EARNED</div>
      <div class="w-val" id="w-earned">₹${w.earned.toLocaleString()}</div>
      <div class="w-sub">lifetime cultivation</div>
    </div>
    <div>
      <div class="w-lb">SPENT</div>
      <div class="w-val" id="w-spent">₹${w.spent.toLocaleString()}</div>
      <div class="w-sub">honored spoils</div>
    </div>
    <div class="avail">
      <div class="w-lb">AVAILABLE</div>
      <div class="w-val" id="w-avail">₹${w.available.toLocaleString()}</div>
      <div class="w-sub">ready to claim</div>
    </div>
    <div class="momentum">
      <div class="w-lb">14-DAY MOMENTUM ${perWeek > 0 ? '<span class="arrow">↗</span>' : ''}</div>
      <div class="w-val">+₹${perWeek.toLocaleString()}/wk</div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none">
        <polyline fill="none" stroke="#e3a81a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  points="${spark}"/>
        <polyline fill="url(#areaGrad)" stroke="none"
                  points="${spark} 100,30 0,30"/>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#e3a81a" stop-opacity=".3"/>
            <stop offset="100%" stop-color="#e3a81a" stop-opacity="0"/>
          </linearGradient>
        </defs>
      </svg>
    </div>
  `;
}

// --------- TABS ---------
function paintTabs(root, wishlist) {
  const el = root.querySelector("#shop-tabs");
  const tabs = [
    { k: "all",         lb: "All" },
    { k: "wishlist",    lb: `Wishlisted ${wishlist.length ? `<small>●${wishlist.length}</small>` : ""}` },
    { k: "within",      lb: "Within reach" },
    { k: "small",       lb: "Small" },
    { k: "medium",      lb: "Medium" },
    { k: "large",       lb: "Large" },
    { k: "mega",        lb: "Mega" }
  ];
  el.innerHTML = tabs.map(t => `
    <button class="tab ${activeTab === t.k ? "active" : ""}" data-tab="${t.k}">${t.lb}</button>
  `).join("");
  el.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      paint(root);
    });
  });
}

// --------- CATALOG GRID / CAROUSELS ---------
function paintGrid(root, w, s, tiers) {
  const el = root.querySelector("#shop-grid");
  const cat = getRewards().catalog;

  // Default "All" view = Nike-style carousels grouped by canonical type.
  if (activeTab === "all") {
    paintCarousels(el, cat, w, s, tiers);
    wireCardHandlers(el, root);
    return;
  }

  // Filtered views (wishlist / within reach / tier / type) = flat grid.
  const items = cat.filter(r => {
    if (activeTab === "wishlist") return isWishlisted(r.id);
    if (activeTab === "within") {
      const tier = tiers.find(t => t.key === r.tier);
      const tierUnlocked = !tier || w.earned >= tier.unlockEarn;
      return tierUnlocked && w.available >= r.price;
    }
    if (activeTab.startsWith("type:")) return (r.type || "custom") === activeTab.slice(5);
    return r.tier === activeTab;
  });

  // Type-filter chip above the grid when drilled in from a carousel
  let header = "";
  if (activeTab.startsWith("type:")) {
    const typeKey = activeTab.slice(5);
    const typeDef = getRewardTypes().find(t => t.key === typeKey);
    header = `
      <div class="filter-badge">
        <span>Showing <b>${esc(typeDef?.label || typeKey)}</b> · ${items.length} item${items.length === 1 ? "" : "s"}</span>
        <button class="filter-clear" data-clear-filter="1">Clear ×</button>
      </div>
    `;
  }

  if (!items.length) {
    el.className = "grid";
    el.innerHTML = header + `<div class="empty">Nothing in this bucket yet.</div>`;
    wireCardHandlers(el, root);
    return;
  }

  el.className = "grid";   // flat grid mode
  el.innerHTML = header + items.map(r => renderCard(r, w, s, tiers)).join("");
  wireCardHandlers(el, root);
}

function paintCarousels(el, cat, w, s, tiers) {
  el.className = "carousels"; // switch to carousels container
  const types = getRewardTypes();
  const byType = new Map(types.map(t => [t.key, []]));
  for (const r of cat) {
    const k = (r.type && byType.has(r.type)) ? r.type : "custom";
    byType.get(k).push(r);
  }

  const sections = [];
  for (const t of types) {
    const items = byType.get(t.key) || [];
    if (!items.length) continue;
    sections.push(`
      <section class="carousel-row" data-type="${esc(t.key)}">
        <header class="row-head">
          <h3 class="row-title">${esc(t.label)} <span class="row-count">${items.length}</span></h3>
          <button class="row-all" data-view-all="${esc(t.key)}">View all →</button>
        </header>
        <div class="row-track-wrap">
          <div class="row-track">
            ${items.map(r => renderCard(r, w, s, tiers)).join("")}
          </div>
        </div>
      </section>
    `);
  }

  if (!sections.length) {
    el.innerHTML = `<div class="empty">Catalog is empty. Click <b>+ Import catalog CSV</b> above or add a reward.</div>`;
    return;
  }
  el.innerHTML = sections.join("");
}

function wireCardHandlers(el, root) {
  // Wishlist toggle
  el.querySelectorAll("[data-wish]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await toggleWishlist(btn.dataset.wish);
      btn.classList.toggle("on");
      // Re-render just the SVG fill — simpler to repaint whole SVG inline
      const svg = btn.querySelector("svg");
      if (svg) svg.setAttribute("fill", btn.classList.contains("on") ? "currentColor" : "none");
    });
  });

  // Edit buttons — open modal
  el.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = getRewards().catalog.find(x => x.id === btn.dataset.edit);
      if (r) openRewardEditModal(r, root);
    });
  });

  // View all (carousel row -> type filter)
  el.querySelectorAll("[data-view-all]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      activeTab = `type:${btn.dataset.viewAll}`;
      paint(root);
      document.querySelector("#shop-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Clear type filter
  el.querySelectorAll("[data-clear-filter]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      activeTab = "all";
      paint(root);
    });
  });
}

function renderCard(r, w, s, tiers) {
  const tier = tiers.find(t => t.key === r.tier);
  const tierUnlocked = !tier || w.earned >= tier.unlockEarn;
  const affordable = w.available >= r.price;
  const need = Math.max(0, r.price - w.available);
  const canClaim = tierUnlocked && affordable;
  const nearPct = tierUnlocked ? Math.round(100 * w.available / r.price) : 0;
  const isNear = canClaim || (tierUnlocked && nearPct >= 70);
  const wished = isWishlisted(r.id);

  const tierKey = r.tier || "custom";
  const tierLabel = (tier?.label || "Custom");
  const storeLabel = (r.store || "").toUpperCase();
  const category = r.category || "";
  const notes = r.notes || "";

  // Meta row — comma-separated, only non-empty values.
  const metaBits = [tierLabel, category].filter(Boolean);

  // Status text for CTA area — all info present, muted.
  let statusHtml;
  if (canClaim) {
    statusHtml = `<button class="claim-btn" data-claim="${esc(r.id)}">Claim · −₹${r.price.toLocaleString()}</button>`;
  } else if (!tierUnlocked) {
    const gap = (tier.unlockEarn || 0) - w.earned;
    statusHtml = `<div class="status-line">Unlocks ${tierLabel} tier · <b>₹${gap.toLocaleString()}</b> more earned</div>`;
  } else {
    statusHtml = `<div class="status-line"><b>₹${need.toLocaleString()}</b> away · ${nearPct}% earned</div>`;
  }

  const productUrl = r.productUrl || "";
  const linkOpen = productUrl ? `<a class="t-link" href="${esc(normalizeUrl(productUrl))}" target="_blank" rel="noreferrer noopener">` : `<span class="t-link">`;
  const linkClose = productUrl ? `</a>` : `</span>`;

  return `
    <div class="card tier-${esc(tierKey)} ${canClaim ? "" : "locked"} ${isNear ? "near" : ""}" data-rid="${esc(r.id)}">
      <div class="media">
        <button class="wish ${wished ? "on" : ""}" data-wish="${esc(r.id)}" title="${wished ? "Remove from wishlist" : "Add to wishlist"}" aria-label="Wishlist">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="${wished ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
        <div class="art">
          ${r.imageUrl
            ? `<img src="${esc(encodeImageUrl(r.imageUrl))}" alt="${esc(r.title)}" onerror="this.outerHTML='<div class=&quot;art-emoji&quot;>${esc(r.emoji||"🎁")}</div>'">`
            : `<div class="art-emoji">${esc(r.emoji||"🎁")}</div>`
          }
        </div>
      </div>
      <div class="info">
        <div class="store-row">
          <span class="store">${esc(storeLabel || "GAIN")}</span>
          <button class="edit-pill" data-edit="${esc(r.id)}" aria-label="Edit">✎</button>
        </div>
        ${linkOpen}<div class="title">${esc(r.title)}</div>${linkClose}
        ${metaBits.length ? `<div class="meta">${esc(metaBits.join(" · "))}</div>` : ""}
        <div class="price-row">
          <span class="price">₹${r.price.toLocaleString()}</span>
          ${notes ? `<span class="note">${esc(notes)}</span>` : ""}
        </div>
        <div class="cta">${statusHtml}</div>
      </div>
      ${canClaim ? "" : `<div class="progress"><span style="width:${Math.min(100, Math.round(100 * (tierUnlocked ? w.available : w.earned) / (tierUnlocked ? r.price : tier.unlockEarn)))}%"></span></div>`}
    </div>
  `;
}

function normalizeUrl(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return "https://" + u.replace(/^\/+/, "");
}

// Encode local image paths so filenames with spaces/colons/special chars work in the webview.
// Remote URLs (http/https/data:) pass through unchanged.
function encodeImageUrl(u) {
  if (!u) return "";
  if (/^(https?:|data:|asset:)/i.test(u)) return u;
  return u.split("/").map(encodeURIComponent).join("/");
}

// (Inline edit form removed — editing now goes through openRewardEditModal via modals.js.)

// --------- LEDGER ---------
function paintLedger(root, w) {
  const el = root.querySelector("#ledger-rows");
  const rows = (w.ledger || []).slice(-15).reverse();
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state"><p>No entries yet. Tick a task on Today to bank your first ₹.</p></div>`;
    return;
  }
  el.innerHTML = rows.map(e => `
    <div class="ledger-row">
      <div class="led-main">
        <div class="led-title">${esc(e.label)}</div>
        <div class="led-sub">${new Date(e.date).toLocaleString()} · ${esc(e.type)}</div>
      </div>
      <div class="led-amt ${e.amount >= 0 ? "pos" : "neg"}">${e.amount >= 0 ? "+" : ""}₹${Math.abs(e.amount).toLocaleString()}</div>
    </div>
  `).join("");
}

// --------- STICKY NEAR-BAR ---------
function paintNearBar(root, w, wishlist, tiers) {
  const mount = root.querySelector("#near-bar-mount");
  const next = pickNextTarget(w, wishlist, tiers);
  if (!next) { mount.innerHTML = ""; return; }
  const need = Math.max(0, next.price - w.available);
  const tier = tiers.find(t => t.key === next.tier);
  const tierUnlocked = !tier || w.earned >= tier.unlockEarn;
  // Only show the near-bar when we're close (unlocked + <= ₹200 away OR exactly affordable)
  if (!tierUnlocked) { mount.innerHTML = ""; return; }
  if (need > 200) { mount.innerHTML = ""; return; }

  mount.innerHTML = `
    <div class="near-bar">
      <div class="nb-ic">⟡</div>
      <span>
        ${need === 0
          ? `<b>₹${next.price.toLocaleString()}</b> ready · ${esc(next.title)}`
          : `<b>₹${need}</b> away from <b>${esc(next.title)}</b> · ${estimateProblemsCopy(need).toLowerCase()}`}
      </span>
      <button id="near-cta">${need === 0 ? "Claim now ✓" : "Open Today ▶"}</button>
    </div>
  `;
  mount.querySelector("#near-cta")?.addEventListener("click", () => {
    if (need === 0) {
      document.querySelector(`[data-rid="${next.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      location.hash = "#today";
    }
  });
}

// -------------------------------------------------------------
// attach() — static handlers (claim, edit save/cancel, add reward)
// -------------------------------------------------------------
function attach(root) {
  root.addEventListener("click", async (e) => {
    const claimBtn = e.target.closest("[data-claim]");
    if (claimBtn) {
      await handleClaim(claimBtn, root);
      return;
    }
  });

  root.addEventListener("change", async (e) => {
    // Catalog CSV import (append)
    if (e.target.id === "catalog-import") {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const result = await importRewardsFromCsv(text, { replace: false });
        shopToast(`Imported ${result.added} new · updated ${result.updated}${result.skipped ? ` · skipped ${result.skipped}` : ""}`);
      } catch (err) {
        shopToast(`Import failed: ${err.message || err}`);
      } finally {
        e.target.value = "";
      }
    }
    // Catalog CSV replace — wipes catalog, then imports; confirms first
    if (e.target.id === "catalog-replace") {
      const file = e.target.files?.[0];
      if (!file) return;
      const n = getRewards().catalog.length;
      const ok = n === 0 ? true : await confirmDanger({
        title: `Replace all ${n} items?`,
        message: `This wipes the current catalog and loads rewards from the CSV. Your wishlist is emptied too.`,
        confirmLabel: `Replace catalog`,
        consequences: [
          `${n} current items will be deleted`,
          `Rewards from "${file.name}" will take their place`,
          `Your wishlist is cleared`
        ]
      });
      if (!ok) { e.target.value = ""; return; }
      try {
        const text = await file.text();
        const result = await importRewardsFromCsv(text, { replace: true });
        shopToast(`Replaced catalog · ${result.added} items loaded`);
      } catch (err) {
        shopToast(`Replace failed: ${err.message || err}`);
      } finally {
        e.target.value = "";
      }
    }
  });

  // Unified "+ Add" hub — one button, picker modal routes to the specific flow
  root.addEventListener("click", (e) => {
    if (e.target.closest("#catalog-add")) openShopAddHubModal(root);
  });

  // Catalog clear — red confirm modal
  root.addEventListener("click", async (e) => {
    const clearBtn = e.target.closest("#catalog-clear");
    if (!clearBtn) return;
    const n = getRewards().catalog.length;
    if (!n) { shopToast("Catalog is already empty."); return; }
    const ok = await confirmDanger({
      title: "Clear the whole catalog?",
      message: `Every reward in your shop will be deleted. This can't be undone.`,
      confirmLabel: `Delete all ${n} items`,
      consequences: [
        "All items disappear from the shop",
        "Your wishlist is emptied",
        "Re-import the CSV to bring items back"
      ]
    });
    if (!ok) return;
    await clearRewardsCatalog();
    shopToast(`Cleared ${n} items.`);
  });
}

// --------- Add hub: picker modal routes to Add / Append / Replace ---------
function openShopAddHubModal(root) {
  document.querySelectorAll(".shop-hub-scrim").forEach(m => m.remove());
  const scrim = document.createElement("div");
  scrim.className = "shop-hub-scrim";
  scrim.innerHTML = `
    <div class="shop-hub" role="dialog" aria-label="Add to shop">
      <header>
        <h2>What would you like to add?</h2>
        <button class="hub-close" aria-label="Close">✕</button>
      </header>
      <div class="hub-body">
        <p>Pick one — each option opens the exact flow for that task.</p>
        <div class="hub-grid">
          <button class="hub-card" data-mode="single">
            <div class="hub-ico">＋</div>
            <h4>Add a reward</h4>
            <p>Single new item — title, price, tier, image, and more.</p>
          </button>
          <button class="hub-card" data-mode="append">
            <div class="hub-ico">⇪</div>
            <h4>Append from CSV</h4>
            <p>Bulk-add rewards from a CSV file. Existing items are kept.</p>
          </button>
          <button class="hub-card hub-danger" data-mode="replace">
            <div class="hub-ico">⟳</div>
            <h4>Replace catalog</h4>
            <p>Wipe every reward and load fresh ones from a CSV.</p>
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.querySelector(".hub-close").addEventListener("click", close);
  scrim.querySelectorAll(".hub-card").forEach(card => {
    card.addEventListener("click", () => {
      const mode = card.dataset.mode;
      close();
      if (mode === "single") openRewardAddModal(root);
      else if (mode === "append") root.querySelector("#catalog-import")?.click();
      else if (mode === "replace") root.querySelector("#catalog-replace")?.click();
    });
  });
}

// --------- Add reward (single) — reuses the edit-modal shape with addReward on save ---------
function openRewardAddModal(root) {
  const types = getRewardTypes();
  const bodyHtml = `
    <div>
      <label>Title</label>
      <input data-f="title" value="" required placeholder="e.g. Nike running shoes" />
    </div>
    <div class="field-row">
      <div>
        <label>Price (₹)</label>
        <input data-f="price" type="number" min="1" value="500" required />
      </div>
      <div>
        <label>Tier</label>
        <select data-f="tier">
          ${["small","medium","large","mega","custom"].map(t => `<option value="${t}" ${t==="small"?"selected":""}>${t}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div>
        <label>Type</label>
        <select data-f="type">
          ${types.map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Category</label>
        <input data-f="category" value="" placeholder="e.g. Shoes, Food, Travel" />
      </div>
    </div>
    <div>
      <label>Store</label>
      <input data-f="store" value="" placeholder="Amazon, Myntra, The Souled Store…" />
    </div>
    <div>
      <label>Product URL</label>
      <input data-f="productUrl" value="" placeholder="https://…" />
    </div>
    <div>
      <label>Image URL</label>
      <input data-f="imageUrl" value="" placeholder="https://… or data/reward-images/foo.jpg" />
      <input data-f="imageFile" type="file" accept="image/*" class="file-input" style="margin-top:8px" />
      <div class="field-hint">Paste a URL or pick a file (≤1MB) to embed as data-URL. Overrides URL above.</div>
    </div>
    <div class="field-row">
      <div>
        <label>Emoji</label>
        <input data-f="emoji" maxlength="4" value="🎁" placeholder="🎁" />
      </div>
      <div>
        <label>Notes</label>
        <input data-f="notes" value="" placeholder="Short note (optional)" />
      </div>
    </div>
  `;

  openFormModal({
    title: "Add a reward",
    subtitle: "A single new item in your shop catalog",
    bodyHtml,
    saveLabel: "Add reward",
    onSave: async (modalRoot, close) => {
      const patch = {};
      modalRoot.querySelectorAll("[data-f]").forEach(inp => {
        const key = inp.dataset.f;
        if (inp.type === "file") return;
        const v = inp.value;
        patch[key] = (key === "price") ? Number(v) : v;
      });
      if (!patch.title?.trim()) { shopToast("Title is required."); return; }
      const fileInput = modalRoot.querySelector("[data-f=imageFile]");
      const file = fileInput?.files?.[0];
      if (file) {
        if (file.size > 1024 * 1024) { shopToast("Image too large (≤1MB)"); return; }
        patch.imageUrl = await fileToDataUrl(file);
      }
      await addReward(patch);
      close();
      shopToast(`Added "${patch.title}" to the catalog.`);
    }
  });
}

function openRewardEditModal(r, root) {
  const types = getRewardTypes();
  const bodyHtml = `
    <div>
      <label>Title</label>
      <input data-f="title" value="${esc(r.title || "")}" required />
    </div>
    <div class="field-row">
      <div>
        <label>Price (₹)</label>
        <input data-f="price" type="number" min="1" value="${Number(r.price) || 0}" required />
      </div>
      <div>
        <label>Tier</label>
        <select data-f="tier">
          ${["small","medium","large","mega","custom"].map(t => `<option value="${t}" ${r.tier===t?"selected":""}>${t}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div>
        <label>Type</label>
        <select data-f="type">
          ${types.map(t => `<option value="${t.key}" ${r.type===t.key?"selected":""}>${esc(t.label)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Category</label>
        <input data-f="category" value="${esc(r.category || "")}" placeholder="e.g. Shoes, Food, Travel" />
      </div>
    </div>
    <div>
      <label>Store</label>
      <input data-f="store" value="${esc(r.store || "")}" placeholder="Amazon, Myntra, The Souled Store…" />
    </div>
    <div>
      <label>Product URL</label>
      <input data-f="productUrl" value="${esc(r.productUrl || "")}" placeholder="https://…" />
    </div>
    <div>
      <label>Image URL</label>
      <input data-f="imageUrl" value="${esc(r.imageUrl || "")}" placeholder="https://… or data/reward-images/foo.jpg" />
      <input data-f="imageFile" type="file" accept="image/*" class="file-input" style="margin-top:8px" />
      <div class="field-hint">Paste a URL or pick a file (≤1MB) to embed as data-URL. Overrides URL above.</div>
    </div>
    <div class="field-row">
      <div>
        <label>Emoji</label>
        <input data-f="emoji" maxlength="4" value="${esc(r.emoji || "")}" placeholder="🎁" />
      </div>
      <div>
        <label>Notes</label>
        <input data-f="notes" value="${esc(r.notes || "")}" placeholder="Short note (optional)" />
      </div>
    </div>
  `;

  openFormModal({
    title: "Edit reward",
    subtitle: r.title,
    bodyHtml,
    saveLabel: "Save changes",
    extraButtons: [{
      label: "Delete",
      variant: "danger",
      onClick: async (close) => {
        const ok = await confirmDanger({
          title: "Delete this reward?",
          message: `“${r.title}” will be removed from the catalog and from your wishlist.`,
          confirmLabel: "Delete reward",
          consequences: ["The item disappears from the shop", "It also leaves your wishlist chain"]
        });
        if (!ok) return;
        await removeReward(r.id);
        close();
      }
    }],
    onSave: async (modalRoot, close) => {
      const patch = {};
      modalRoot.querySelectorAll("[data-f]").forEach(inp => {
        const key = inp.dataset.f;
        if (inp.type === "file") return;
        const v = inp.value;
        patch[key] = (key === "price") ? Number(v) : v;
      });
      const fileInput = modalRoot.querySelector("[data-f=imageFile]");
      const file = fileInput?.files?.[0];
      if (file) {
        if (file.size > 1024 * 1024) { alert("Image too large (≤1MB)"); return; }
        patch.imageUrl = await fileToDataUrl(file);
      }
      await updateReward(r.id, patch);
      close();
    }
  });
}

async function handleClaim(claimBtn, root) {
  const id = claimBtn.dataset.claim;
  console.log("[shop] handleClaim", { id });
  const r = getRewards().catalog.find(x => x.id === id);
  if (!r) { console.warn("[shop] reward not found for id", id); return; }

  // Check tier/affordability gating
  const w = getWallet();
  const tier = getTiers().find(t => t.key === r.tier);
  const tierUnlocked = tier ? w.earned >= tier.unlockEarn : true;
  if (!tierUnlocked) {
    const need = (tier?.unlockEarn || 0) - w.earned;
    shopToast(`Earn ₹${need.toLocaleString()} more to unlock the ${tier?.label || "next"} tier.`);
    return;
  }
  if (w.available < r.price) {
    shopToast(`Need ₹${(r.price - w.available).toLocaleString()} more available to claim ${r.title}.`);
    return;
  }
  openClaimModal(r);
}

// Full modal popup: image + honor-check + Confirm → Congratulations moment
function openClaimModal(r) {
  console.log("[shop] openClaimModal for", r.title);
  document.querySelectorAll(".claim-modal-scrim").forEach(m => m.remove());
  const quote = getShopQuote();

  const scrim = document.createElement("div");
  scrim.className = "claim-modal-scrim";
  const safeEmoji = r.emoji || "🎁";
  const imgOrEmoji = r.imageUrl
    ? `<img src="${esc(encodeImageUrl(r.imageUrl))}" alt="" />`
    : `<div class="claim-emoji">${esc(safeEmoji)}</div>`;
  scrim.innerHTML = `
    <div class="claim-modal" role="dialog" aria-modal="true">
      <button class="claim-close" aria-label="Close">✕</button>
      <div class="claim-media tier-${esc(r.tier || "custom")}">
        <div class="claim-art">${imgOrEmoji}</div>
      </div>
      <div class="claim-body">
        <div class="claim-eyebrow">HONOR CHECK · MURIM</div>
        <h2 class="claim-title">${esc(r.title)}</h2>
        <div class="claim-price">−₹${r.price.toLocaleString()}</div>
        <blockquote class="claim-quote">"${esc(quote)}"</blockquote>
        <p class="claim-ask">Did you honestly earn these spoils? Think of the ticks. The REVIEW rows. The hints you took.</p>
        <label class="honor-check">
          <input type="checkbox" id="honor-chk" />
          <span>I honored the dao. I earned this with real reps — no self-deception.</span>
        </label>
        <div class="claim-actions">
          <button class="btn-cancel">Not yet</button>
          <button class="btn-confirm" disabled>Claim with honor</button>
        </div>
      </div>
      <!-- Congratulations overlay (shown after confirm) -->
      <div class="claim-congrats" hidden>
        <div class="congrats-burst"></div>
        <div class="congrats-check">✓</div>
        <h1 class="congrats-title">CLAIMED</h1>
        <div class="congrats-price">−₹${r.price.toLocaleString()}</div>
        <div class="congrats-quote">"${esc(getSpendQuote())}"</div>
      </div>
    </div>
  `;
  document.body.appendChild(scrim);
  // Force reflow then add show class so the CSS transition fires reliably
  scrim.getBoundingClientRect();
  setTimeout(() => scrim.classList.add("show"), 10);

  const modal = scrim.querySelector(".claim-modal");
  const chk = scrim.querySelector("#honor-chk");
  const confirmBtn = scrim.querySelector(".btn-confirm");
  const cancelBtn  = scrim.querySelector(".btn-cancel");
  const closeBtn   = scrim.querySelector(".claim-close");

  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    scrim.classList.remove("show");
    document.removeEventListener("keydown", esc);
    setTimeout(() => scrim.parentNode && scrim.remove(), 220);
  };
  const esc = (ev) => { if (ev.key === "Escape") close(); };
  document.addEventListener("keydown", esc);

  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  cancelBtn.addEventListener("click", close);
  closeBtn.addEventListener("click", close);

  // Honor-check gating
  chk.addEventListener("change", () => {
    confirmBtn.disabled = !chk.checked;
    confirmBtn.classList.toggle("ready", chk.checked);
  });

  // Confirm → Congratulations
  confirmBtn.addEventListener("click", async () => {
    if (!chk.checked) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Claiming…";
    try {
      await updateWallet(wal => {
        wal.spent += r.price;
        wal.ledger.push({ date: new Date().toISOString(), type: "claim", amount: -r.price, label: r.title });
        const today = todayKey();
        wal.dailyWithdrawn = wal.dailyWithdrawn || {};
        wal.dailyWithdrawn[today] = (wal.dailyWithdrawn[today] || 0) + 1;
      });
      // Reveal congrats layer
      modal.querySelector(".claim-body").style.opacity = "0";
      const congrats = modal.querySelector(".claim-congrats");
      congrats.hidden = false;
      requestAnimationFrame(() => congrats.classList.add("show"));
      // Auto-close after moment
      setTimeout(close, 3200);
    } catch (err) {
      console.error("[shop] claim failed:", err);
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Retry";
      shopToast(`Claim failed: ${err?.message || err}`);
    }
  });
}

// --------- helpers ---------
function clearPending(root) {
  clearPendingTimer();
  if (!pendingClaim) return;
  const prev = root.querySelector(`[data-claim="${pendingClaim}"]`);
  if (prev) {
    prev.classList.remove("confirming");
    prev.textContent = prev.dataset.originalText || "CLAIM ↗";
  }
  pendingClaim = null;
}
function clearPendingTimer() { if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; } }

function shopToast(msg) {
  document.querySelectorAll(".shop-toast").forEach(t => t.remove());
  const toast = document.createElement("div");
  toast.className = "shop-toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 240); }, 3200);
}

function fireSpendToast(r) {
  const spend = getSpendQuote();
  const murim = getShopQuote();
  const toast = document.createElement("div");
  toast.className = "spend-toast";
  toast.innerHTML = `
    <div class="spend-emoji">${r.imageUrl ? `<img src="${esc(encodeImageUrl(r.imageUrl))}" />` : esc(r.emoji||"🎁")}</div>
    <div>
      <div class="spend-title">Claimed · ${esc(r.title)} · −₹${r.price.toLocaleString()}</div>
      <div class="spend-quote">"${esc(spend)}"</div>
      <div class="spend-murim">⟡ ${esc(murim)}</div>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 20);
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 400); }, 5500);
}

async function readFormPatch(card) {
  return {
    title:    card.querySelector("[data-field=title]").value.trim(),
    price:    Number(card.querySelector("[data-field=price]").value) || 0,
    emoji:    card.querySelector("[data-field=emoji]").value || "🎁",
    tier:     card.querySelector("[data-field=tier]").value,
    imageUrl: card.querySelector("[data-field=imageUrl]").value.trim() || null
  };
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function startQuoteRotation(root) {
  if (quoteTimer) clearInterval(quoteTimer);
  // The murim quote now surfaces inside the sticky callout / claim toast, not as a top banner.
  // We leave the timer in case we want to add a ticker later.
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }

function styles() {
  return `
  <style>
    .shop { max-width: 1240px; margin: 0 auto; letter-spacing: -.003em; }

    /* ===== STATUS STRIP (under reel, state-aware) ===== */
    .shop .shop-status { margin: -32px 0 56px; }
    .shop .status-strip {
      display: grid; grid-template-columns: 1fr auto; gap: 32px;
      align-items: center;
      padding: 20px 28px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .shop .status-strip--ready { border-color: var(--green); background: #f4fbf6; }
    .shop .status-strip--locked { border-color: var(--line); }
    .shop .status-strip .st-left { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .shop .st-lb {
      font: 700 10px/1 var(--font-sans); letter-spacing: .2em; text-transform: uppercase;
      color: var(--mut);
    }
    .shop .status-strip--ready .st-lb { color: var(--green); }
    .shop .st-main {
      font: 500 17px/1.25 var(--font-sans); letter-spacing: -.015em; color: var(--ink);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .shop .st-bar {
      height: 2px; background: var(--line); border-radius: 2px; overflow: hidden;
      margin-top: 4px; max-width: 420px;
    }
    .shop .st-bar > span {
      display: block; height: 100%; background: var(--gold);
      transition: width .8s cubic-bezier(.2,.7,.2,1);
    }
    .shop .status-strip--ready .st-bar > span { background: var(--green); }

    .shop .status-strip .st-right {
      display: flex; align-items: center; gap: 16px; flex-shrink: 0;
    }
    .shop .st-away { font: 500 13.5px/1 var(--font-sans); color: var(--mut); letter-spacing: -.005em; }
    .shop .st-away b { color: var(--ink); font-weight: 600; font-feature-settings: "tnum"; }
    .shop .st-away--ready b { color: var(--green); }
    .shop .st-tally { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .shop .st-tally-num {
      font: 600 20px/1 var(--font-sans); letter-spacing: -.018em; color: var(--ink);
      font-feature-settings: "tnum";
    }
    .shop .st-tally-num::before { content: "₹"; color: var(--gold); margin-right: 2px; }
    .shop .st-tally-lb { font-size: 10px; letter-spacing: .16em; color: var(--mut); text-transform: uppercase; }

    .shop .st-cta {
      background: var(--ink); color: #fff; border: none; border-radius: 999px;
      padding: 11px 20px; font: 500 13.5px/1 var(--font-sans); letter-spacing: -.005em;
      cursor: pointer; transition: background .18s, transform .18s;
    }
    .shop .st-cta:hover { background: #000; transform: translateY(-1px); }
    .shop .status-strip--ready .st-cta { background: var(--green); }
    .shop .status-strip--ready .st-cta:hover { background: #117a39; }

    @media (max-width: 700px) {
      .shop .status-strip { grid-template-columns: 1fr; gap: 16px; }
      .shop .status-strip .st-right { justify-content: space-between; }
    }

    /* ===== HERO REEL — single-canvas e-commerce (Myntra/Nike-style) ===== */
    .shop .shop-reel {
      position: relative;
      margin: 0 0 48px;
      border-radius: 24px;
      overflow: hidden;
      height: 480px;
      border: 1px solid var(--line);
    }
    .shop .reel-stage { position: relative; width: 100%; height: 100%; }
    .shop .reel-slide {
      position: absolute; inset: 0;
      display: grid; grid-template-columns: 1fr 1fr;
      grid-template-rows: 100%;
      align-items: stretch;
      opacity: 0; visibility: hidden;
      transition: opacity .7s cubic-bezier(.2,.7,.2,1);
      box-sizing: border-box;
    }
    .shop .reel-slide.on { opacity: 1; visibility: visible; z-index: 2; }

    /* Uniform white canvas across every tier — product-first, luxury-clean */
    .shop .reel-slide { background: var(--paper); }

    /* === Left half: text, ink on cream, elegant === */
    .shop .reel-slide .reel-copy {
      grid-column: 1;
      padding: 56px 64px;
      display: flex; flex-direction: column; justify-content: center;
      min-width: 0; box-sizing: border-box;
    }
    .shop .reel-eyebrow {
      font: 700 11px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase;
      color: var(--gold); margin-bottom: 20px;
    }
    .shop .reel-store {
      font: 700 11px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase;
      color: var(--mut); margin-bottom: 14px;
    }
    .shop .reel-title {
      font: 600 44px/1.08 var(--font-sans); letter-spacing: -.028em;
      margin: 0 0 14px; color: var(--ink);
      max-width: 500px;
    }
    .shop .reel-price {
      font: 600 26px/1 var(--font-sans); letter-spacing: -.018em; color: var(--ink);
      font-feature-settings: "tnum"; margin-bottom: 22px;
    }
    .shop .reel-motiv {
      font-family: Georgia, "New York", serif; font-style: italic; font-weight: 400;
      font-size: 17px; line-height: 1.5; color: var(--mut);
      margin: 0 0 32px; max-width: 440px;
    }
    .shop .reel-ctas { display: flex; gap: 10px; flex-wrap: wrap; }
    .shop .reel-cta {
      border-radius: 999px; cursor: pointer;
      padding: 12px 24px; font: 500 14px/1 var(--font-sans); letter-spacing: -.005em;
      transition: background .18s, color .18s, transform .18s, border-color .18s;
      border: 1px solid transparent;
    }
    .shop .reel-cta-primary { background: var(--ink); color: #fff; }
    .shop .reel-cta-primary:hover { background: #000; transform: translateY(-1px); }
    .shop .reel-cta-ghost {
      background: transparent; color: var(--ink);
      border: 1px solid var(--ink);
    }
    .shop .reel-cta-ghost:hover { background: var(--ink); color: #fff; }
    .shop .reel-cta-ghost.on { color: var(--gold); border-color: var(--gold); background: var(--gold-soft); }

    /* === Right half: image, multiply-blended into the gradient (no white frame) === */
    .shop .reel-slide .reel-media {
      grid-column: 2;
      width: 100%; height: 100%; min-width: 0; min-height: 0;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden; position: relative;
      box-sizing: border-box;
    }
    .shop .reel-slide .reel-media img {
      width: 100%; height: 100%;
      object-fit: contain;
      padding: 40px 60px;
      box-sizing: border-box;
      mix-blend-mode: multiply;    /* kills the white rectangle around product cutouts */
      transform: scale(1); transition: transform 8s linear;
    }
    .shop .reel-slide.on .reel-media img { transform: scale(1.04); }
    .shop .reel-slide .reel-glyph {
      font-size: 220px; opacity: .4; color: var(--ink);
    }

    /* === Dots at bottom-left === */
    .shop .reel-dots {
      position: absolute; left: 64px; bottom: 28px; z-index: 5;
      display: flex; gap: 8px;
    }
    .shop .reel-dot {
      width: 20px; height: 3px; border-radius: 2px; border: none;
      background: rgba(20,24,29,.2); cursor: pointer;
      padding: 0; transition: background .22s, width .22s;
    }
    .shop .reel-dot.on { background: var(--ink); width: 36px; }
    .shop .reel-dot:hover { background: rgba(20,24,29,.5); }

    @media (max-width: 900px) {
      .shop .shop-reel { height: 560px; }
      .shop .reel-slide { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
      .shop .reel-slide .reel-copy { grid-column: 1; grid-row: 2; padding: 24px 32px; }
      .shop .reel-slide .reel-media { grid-column: 1; grid-row: 1; }
      .shop .reel-title { font-size: 28px; }
      .shop .reel-dots { bottom: 16px; left: 32px; }
    }

    /* ===== HEADLINE STRIP (centered, Apple) ===== */
    .shop .shop-head { text-align: center; padding: 48px 24px 36px; max-width: 920px; margin: 0 auto; }
    .shop .shop-head .eyebrow {
      font: 700 11px/1 var(--font-sans); letter-spacing: .18em; text-transform: uppercase;
      color: var(--gold); margin: 0 0 14px;
    }
    .shop .shop-title {
      font: 600 52px/1.06 var(--font-sans); letter-spacing: -.028em;
      margin: 0 0 16px; color: var(--ink);
    }
    .shop .shop-title .accent {
      font-family: Georgia, "New York", serif; font-style: italic; font-weight: 500; color: var(--gold);
    }
    .shop .shop-lead {
      font-size: 18px; color: var(--mut); margin: 0 auto;
      max-width: 620px; line-height: 1.42;
    }

    /* ===== HERO (focused aspirational item) ===== */
    .shop .hero {
      max-width: 1180px; margin: 24px auto 0;
      background: linear-gradient(180deg, #faf3df 0%, #ffffff 100%);
      border-radius: 32px;
      padding: 64px 56px 56px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 48px;
      align-items: center;
      position: relative; overflow: hidden;
      animation: shopRise .6s cubic-bezier(.2,.7,.2,1) both;
    }
    @keyframes shopRise { from{opacity:0; transform:translateY(16px);} to{opacity:1; transform:none;} }

    .shop .hero-body { position: relative; z-index: 1; }
    .shop .hero-tag {
      font: 700 11px/1 var(--font-sans); letter-spacing: .18em; text-transform: uppercase;
      color: var(--gold); margin-bottom: 18px;
    }
    .shop .hero-title {
      font: 600 44px/1.06 var(--font-sans); letter-spacing: -.025em;
      margin: 0 0 14px; color: var(--ink);
    }
    .shop .hero-title .italic { font-family: Georgia, serif; font-style: italic; font-weight: 500; color: var(--gold); }
    .shop .hero-sub {
      font-size: 18px; color: var(--mut); margin: 0 0 28px; line-height: 1.42; max-width: 440px;
    }
    .shop .hero-sub .lift { color: var(--ink); font-weight: 500; }

    .shop .hero-prog { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
    .shop .hero-prog .big { font: 600 40px/1 var(--font-sans); letter-spacing: -.02em; color: var(--ink); font-feature-settings: "tnum"; }
    .shop .hero-prog .small { color: var(--mut); font-size: 15px; }

    .shop .hero-bar {
      height: 4px; background: #eadcb6; border-radius: 4px; overflow: hidden;
      max-width: 360px; margin-bottom: 28px;
    }
    .shop .hero-bar > span { display: block; height: 100%; background: var(--gold); border-radius: 4px; transition: width .8s cubic-bezier(.2,.7,.2,1); }

    .shop .hero-ctas { display: flex; gap: 10px; align-items: center; }
    .shop .cta-primary {
      background: var(--ink); color: #fff; border: none;
      padding: 13px 26px; border-radius: 999px;
      font: 500 15px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: background .2s, transform .2s;
    }
    .shop .cta-primary:hover { background: #000; transform: translateY(-1px); }
    .shop .cta-ghost {
      background: transparent; color: var(--ink); border: none;
      padding: 13px 18px; border-radius: 999px;
      font: 500 15px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
      transition: color .2s;
    }
    .shop .cta-ghost:hover { color: var(--gold); }
    .shop .cta-ghost .ar { font-size: 13px; }

    .shop .hero-media {
      aspect-ratio: 1; max-height: 400px;
      display: flex; align-items: center; justify-content: center;
      position: relative;
    }
    .shop .hero-media .halo {
      position: absolute; inset: 10%;
      border-radius: 50%;
      background: radial-gradient(circle at 50% 40%, rgba(227,168,26,.10), transparent 60%);
    }
    .shop .hero-media .glyph {
      font-size: 200px; line-height: 1; color: var(--gold); opacity: .92;
      position: relative; z-index: 1;
      filter: drop-shadow(0 20px 36px rgba(227,168,26,.18));
    }
    .shop .hero-media .glyph img {
      max-width: 320px; max-height: 320px; object-fit: contain;
      filter: drop-shadow(0 20px 36px rgba(0,0,0,.15));
    }

    /* ===== SECTION HEADS (centered, Apple-style) ===== */
    .shop .section-head { text-align: center; margin-bottom: 36px; }
    .shop .section-head.centered { text-align: center; }
    .shop .section-head h2 {
      font: 600 36px/1.1 var(--font-sans); letter-spacing: -.022em;
      margin: 0 0 10px; color: var(--ink);
    }
    .shop .section-head h2 .italic { font-family: Georgia, serif; font-style: italic; font-weight: 500; color: var(--gold); }
    .shop .section-sub { font-size: 16px; color: var(--mut); margin: 0; }
    .shop .section-actions { margin-top: 20px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .shop .section-actions-row { display: flex; gap: 8px; align-items: center; }
    .shop .import-btn {
      display: inline-flex; align-items: center; cursor: pointer;
      padding: 9px 18px; border-radius: 999px;
      background: var(--paper); border: 1px solid var(--line);
      color: var(--ink); font: 500 13px/1 var(--font-sans); letter-spacing: -.005em;
      transition: all .18s;
    }
    .shop .import-btn:hover { border-color: var(--gold); background: var(--gold-soft); color: var(--ink); }
    .shop .clear-btn {
      padding: 9px 18px; border-radius: 999px;
      background: transparent; border: 1px solid var(--line);
      color: var(--mut); font: 500 13px/1 var(--font-sans); letter-spacing: -.005em;
      cursor: pointer; transition: all .18s;
    }
    .shop .clear-btn:hover { color: var(--red); border-color: var(--red); background: var(--paper); }
    .shop .shop-add-btn {
      padding: 9px 22px; border-radius: 999px;
      background: var(--gold); color: #111; border: 1px solid var(--gold);
      font: 600 13px/1 var(--font-sans); letter-spacing: -.005em;
      cursor: pointer; transition: all .18s;
    }
    .shop .shop-add-btn:hover { filter: brightness(1.05); transform: translateY(-1px); }
    .shop .import-hint { font-size: 12px; color: var(--mut); letter-spacing: 0; display: block; margin-top: 6px; line-height: 1.5; }
    .shop .import-hint code {
      display: inline-block; max-width: 100%; overflow-x: auto; white-space: nowrap;
      vertical-align: middle;
      background: var(--bg); border: 1px solid var(--line);
      padding: 3px 8px; border-radius: 5px;
      font: 500 11px/1.4 var(--font-mono, ui-monospace,SFMono-Regular,Menlo,monospace);
      color: var(--ink); letter-spacing: 0;
    }
    .shop .import-hint code::-webkit-scrollbar { height: 4px; }

    /* ---- Add hub (picker) modal ---- */
    .shop-hub-scrim {
      position: fixed; inset: 0; z-index: 90;
      background: rgba(8,10,14,.62);
      backdrop-filter: blur(10px) saturate(140%);
      -webkit-backdrop-filter: blur(10px) saturate(140%);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: shopHubFade 180ms ease both;
    }
    html:has(.shop-hub-scrim), body:has(.shop-hub-scrim) { overflow: hidden; }
    @keyframes shopHubFade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .shop-hub {
      background: var(--paper); border-radius: 18px;
      width: 100%; max-width: 640px; max-height: 90vh; overflow: hidden;
      box-shadow: 0 32px 80px rgba(0,0,0,.35), 0 0 0 1px var(--line);
      display: flex; flex-direction: column;
      animation: shopHubPop 180ms cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes shopHubPop {
      from { opacity: 0; transform: translateY(12px) scale(.98); }
      to   { opacity: 1; transform: translateY(0)    scale(1);   }
    }
    .shop-hub header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 24px 16px; border-bottom: 1px solid var(--line);
    }
    .shop-hub header h2 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -.01em; color: var(--ink); }
    .shop-hub .hub-close {
      border: none; background: transparent; cursor: pointer;
      font: 500 20px/1 var(--font-sans); color: var(--mut);
      width: 32px; height: 32px; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all .18s;
    }
    .shop-hub .hub-close:hover { background: var(--bg); color: var(--ink); }
    .shop-hub .hub-body { padding: 24px; }
    .shop-hub .hub-body > p { margin: 0 0 20px; color: var(--mut); font-size: 13.5px; line-height: 1.5; }
    .shop-hub .hub-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .shop-hub .hub-card {
      display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
      padding: 18px; background: var(--paper); border: 1px solid var(--line);
      border-radius: 14px; cursor: pointer; text-align: left;
      transition: all .18s;
      font: inherit; color: var(--ink);
    }
    .shop-hub .hub-card:hover {
      border-color: var(--gold); background: var(--gold-soft);
      transform: translateY(-2px);
      box-shadow: 0 8px 20px color-mix(in oklab, var(--gold) 20%, transparent);
    }
    .shop-hub .hub-card.hub-danger:hover {
      border-color: var(--red); background: color-mix(in oklab, var(--red) 10%, transparent);
      box-shadow: 0 8px 20px rgba(226,69,79,.14);
    }
    .shop-hub .hub-card .hub-ico {
      width: 40px; height: 40px; border-radius: 10px;
      background: var(--gold-soft); color: var(--gold);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 700;
    }
    .shop-hub .hub-card.hub-danger .hub-ico {
      background: color-mix(in oklab, var(--red) 12%, transparent);
      color: var(--red);
    }
    .shop-hub .hub-card h4 { margin: 0; font-size: 15px; font-weight: 700; color: var(--ink); }
    .shop-hub .hub-card p  { margin: 0; color: var(--mut); font-size: 12.5px; line-height: 1.45; }
    .shop-hub .hub-grid > .hub-card:first-child { grid-column: span 2; }
    @media (max-width: 560px) {
      .shop-hub .hub-grid, .shop-hub .hub-grid > .hub-card:first-child { grid-template-columns: 1fr; grid-column: auto; }
    }
    .shop .section-sub #chain-count, .shop .section-sub #chain-sub { color: var(--mut); }
    .shop .section-sub b { color: var(--ink); font-weight: 500; }

    /* ===== WALLET STAT COLUMNS ===== */
    .shop .wallet-sec { max-width: 1180px; margin: 72px auto 0; }
    .shop .wallet {
      background: transparent; border: none; box-shadow: none;
      border-radius: 0; padding: 0;
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 0; align-items: stretch;
    }
    .shop .wallet > div {
      padding: 0 28px; display: flex; flex-direction: column; justify-content: center;
      border-left: 1px solid var(--line); text-align: left;
    }
    .shop .wallet > div:first-child { border-left: none; padding-left: 0; }
    .shop .wallet > div:last-child  { padding-right: 0; }
    .shop .w-lb {
      font: 500 11px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase;
      color: var(--mut); margin-bottom: 10px;
    }
    .shop .w-val {
      font: 600 32px/1 var(--font-sans); letter-spacing: -.022em;
      color: var(--ink); font-feature-settings: "tnum";
    }
    .shop .w-sub { font-size: 12px; color: var(--mut); margin-top: 6px; }
    .shop .wallet .avail .w-val { color: var(--gold); font-family: var(--font-sans); font-style: normal; font-weight: 600; }
    .shop .wallet .momentum { background: transparent; color: var(--ink); padding: 0 0 0 28px; border-left: 1px solid var(--line); margin: 0; border-radius: 0; }
    .shop .wallet .momentum .w-lb { color: var(--mut); }
    .shop .wallet .momentum .w-val { font-size: 24px; color: var(--ink); }
    .shop .wallet .momentum .arrow { display: inline-block; margin-left: 4px; color: var(--green); }
    .shop .wallet .momentum svg { width: 100%; height: 28px; margin-top: 8px; }

    /* ===== CHAIN ===== */
    .shop .chain-wrap { max-width: 1180px; margin: 96px auto 0; padding: 0 24px; }

    .shop .path {
      display: flex; align-items: center; gap: 0; padding: 14px 4px;
      overflow-x: auto;
    }
    .shop .path.empty {
      justify-content: center; align-items: center; padding: 56px 24px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 24px;
      text-align: center; color: var(--mut); flex-direction: column; gap: 10px; overflow: visible;
    }
    .shop .path.empty .big { font: 600 18px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -.012em; }
    .shop .path.empty .small { font-size: 14px; }

    .shop .station { flex: 1; min-width: 160px; display: flex; flex-direction: column; align-items: center; gap: 10px; position: relative; text-align: center; cursor: pointer; padding: 0 8px; }
    .shop .station .pt {
      width: 64px; height: 64px; border-radius: 50%;
      background: var(--bg); border: 1px solid var(--line);
      display: flex; align-items: center; justify-content: center; font-size: 26px;
      position: relative; z-index: 2;
      transition: all .22s cubic-bezier(.2,.7,.2,1);
      overflow: hidden;
    }
    .shop .station .pt img { width: 64px; height: 64px; object-fit: cover; }
    .shop .station:hover .pt { transform: scale(1.06); box-shadow: 0 10px 24px rgba(20,24,29,.08); }
    .shop .station.hit .pt {
      background: var(--gold); border-color: var(--gold);
      color: #fff;
    }
    .shop .station.hit .pt::after {
      content: "✓"; position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; font-weight: 600; color: #fff;
    }
    .shop .station.hit .pt > * { opacity: 0; }
    .shop .station.now .pt {
      border: 1px solid var(--gold); background: var(--gold-soft);
      animation: nowBreathe 2.4s ease-in-out infinite;
    }
    @keyframes nowBreathe {
      0%,100% { box-shadow: 0 0 0 0 rgba(227,168,26,.22); }
      50%     { box-shadow: 0 0 0 10px rgba(227,168,26,0); }
    }
    .shop .station .lb { font: 500 11px/1 var(--font-sans); letter-spacing: .12em; text-transform: uppercase; color: var(--mut); }
    .shop .station.hit .lb, .shop .station.now .lb { color: var(--gold); }
    .shop .station .nm { font-size: 13px; font-weight: 500; color: var(--ink); letter-spacing: -.005em; }
    .shop .station .eta { font-size: 11.5px; color: var(--mut); }
    .shop .station.now .eta { color: var(--gold); font-weight: 500; }

    .shop .station .x {
      position: absolute; top: -4px; right: 50%; transform: translateX(42px);
      width: 22px; height: 22px; border-radius: 50%;
      background: #fff; border: 1px solid var(--line); color: var(--mut);
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; cursor: pointer;
      opacity: 0; transition: all .2s;
    }
    .shop .station:hover .x { opacity: 1; }
    .shop .station .x:hover { background: var(--red); color: #fff; border-color: var(--red); }

    .shop .connector {
      flex: 0 0 auto; width: 48px; height: 1px;
      background: var(--line); position: relative; margin-bottom: 46px;
    }
    .shop .connector.hit { background: var(--gold); }
    .shop .connector.now { background: linear-gradient(90deg, var(--gold), var(--line)); }

    .shop .add-slot { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 0 8px; }
    .shop .add-slot .pt {
      width: 64px; height: 64px; border-radius: 50%;
      background: transparent; border: 1px dashed var(--line);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; color: var(--mut); cursor: pointer; transition: all .2s;
    }
    .shop .add-slot .pt:hover { color: var(--gold); border-color: var(--gold); background: var(--gold-soft); }
    .shop .add-slot .lb { font: 500 11px/1 var(--font-sans); letter-spacing: .12em; text-transform: uppercase; color: var(--mut); }

    /* ===== CATALOG SECTION + TABS (Apple-style pills) ===== */
    .shop .catalog-sec { max-width: 1180px; margin: 96px auto 0; padding: 0 24px; }
    .shop .tabs {
      display: flex; justify-content: center; gap: 6px;
      margin-bottom: 36px; flex-wrap: wrap;
    }
    .shop .tab {
      padding: 9px 18px; border: 1px solid transparent;
      background: transparent;
      font: 500 13.5px/1 var(--font-sans); letter-spacing: -.005em;
      color: var(--mut); cursor: pointer; border-radius: 999px;
      transition: all .18s;
    }
    .shop .tab:hover { color: var(--ink); }
    .shop .tab.active { background: var(--ink); color: #fff; }
    .shop .tab small { color: var(--gold); margin-left: 4px; font-weight: 600; font-size: 11px; }
    .shop .tab.active small { color: var(--gold); }

    /* ===== CATALOG CARDS — luxury-grid aesthetic ===== */
    .shop .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 0;
      border-top: 1px solid var(--line);
    }
    .shop .grid .empty {
      grid-column: 1/-1; padding: 72px 24px; text-align: center;
      color: var(--mut); background: var(--paper);
    }
    .shop .grid .filter-badge {
      grid-column: 1 / -1; padding: 14px 20px;
      display: flex; justify-content: space-between; align-items: center;
      background: var(--paper); border: 1px solid var(--line); border-radius: 999px;
      margin-bottom: 20px;
      font: 400 13.5px/1 var(--font-sans); color: var(--mut);
    }
    .shop .grid .filter-badge b { color: var(--ink); font-weight: 600; }
    .shop .grid .filter-clear {
      background: transparent; border: none; cursor: pointer;
      color: var(--ink); font: 500 13px/1 var(--font-sans); letter-spacing: -.005em;
      transition: color .18s;
    }
    .shop .grid .filter-clear:hover { color: var(--gold); }

    /* ===== Nike-style carousels (one per type) ===== */
    .shop .carousels { display: flex; flex-direction: column; gap: 56px; }
    .shop .carousels .empty { padding: 72px 24px; text-align: center; color: var(--mut); background: var(--paper); border: 1px solid var(--line); border-radius: 20px; }
    .shop .carousel-row { position: relative; }
    .shop .row-head {
      display: flex; align-items: baseline; justify-content: space-between;
      margin-bottom: 20px; padding: 0 2px;
    }
    .shop .row-title {
      font: 600 24px/1.1 var(--font-sans); letter-spacing: -.015em;
      color: var(--ink); margin: 0;
    }
    .shop .row-count { font-size: 13px; color: var(--mut); font-weight: 400; margin-left: 6px; letter-spacing: 0; }
    .shop .row-all {
      background: transparent; border: none; cursor: pointer;
      color: var(--ink); font: 500 13.5px/1 var(--font-sans); letter-spacing: -.005em;
      padding: 6px 2px;
      transition: color .18s;
    }
    .shop .row-all:hover { color: var(--gold); }

    .shop .row-track-wrap { position: relative; margin: 0 -24px; padding: 0 24px; }
    .shop .row-track-wrap::after {
      content: ""; position: absolute; top: 0; right: 0; bottom: 0;
      width: 48px; pointer-events: none;
      background: linear-gradient(90deg, transparent, var(--bg));
    }
    .shop .row-track {
      display: grid; grid-auto-flow: column;
      grid-auto-columns: minmax(240px, 240px);
      gap: 0;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      padding-right: 48px;    /* so the last card isn't hidden by the fade */
    }
    .shop .row-track::-webkit-scrollbar { display: none; }
    .shop .row-track .card {
      scroll-snap-align: start;
      border: 1px solid var(--line);
      border-right: none;
      border-radius: 0;
    }
    .shop .row-track .card:first-child { border-top-left-radius: 16px; border-bottom-left-radius: 16px; }
    .shop .row-track .card:last-child  { border-right: 1px solid var(--line); border-top-right-radius: 16px; border-bottom-right-radius: 16px; }

    @media (max-width: 900px) {
      .shop .row-track { grid-auto-columns: minmax(200px, 200px); }
      .shop .row-title { font-size: 20px; }
      .shop .carousels { gap: 40px; }
    }

    .shop .card {
      background: var(--paper);
      display: flex; flex-direction: column;
      border-right: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      padding: 0;
      position: relative; overflow: hidden;
      transition: background .18s;
    }
    .shop .card:hover { background: color-mix(in oklab, var(--paper) 92%, var(--ink) 8%); }

    /* Netflix-style: image dominates, edge-to-edge, portrait aspect */
    .shop .card .media {
      position: relative;
      aspect-ratio: 4 / 5;
      display: flex; align-items: center; justify-content: center;
      background: var(--paper);
      overflow: hidden;
      border-bottom: 1px solid var(--line);
    }
    .shop .card .art {
      display: flex; align-items: center; justify-content: center;
      width: 100%; height: 100%;
      transition: transform .35s cubic-bezier(.2,.7,.2,1);
    }
    .shop .card:hover .art { transform: scale(1.045); }
    .shop .card .art-emoji { font-size: 96px; line-height: 1; color: var(--mut); opacity: .4; }
    .shop .card .art img {
      width: 100%; height: 100%; object-fit: contain;
      padding: 10px;
    }
    .shop .card.locked .art { opacity: .62; }

    /* Wishlist heart — floats on top of media */
    .shop .card .wish {
      position: absolute; top: 12px; right: 12px; z-index: 2;
      width: 36px; height: 36px; border-radius: 50%;
      background: color-mix(in oklab, var(--paper) 90%, transparent); border: none;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: all .18s;
      color: var(--mut);
      backdrop-filter: blur(10px);
    }
    .shop .card .wish:hover { color: var(--ink); transform: scale(1.08); background: #fff; }
    .shop .card .wish.on {
      color: var(--gold); background: #fff;
      animation: starPop .35s cubic-bezier(.2,1.4,.3,1);
    }
    @keyframes starPop { 0%{transform:scale(1);} 50%{transform:scale(1.25);} 100%{transform:scale(1);} }

    .shop .card .info {
      display: flex; flex-direction: column; gap: 5px; flex: 1;
      padding: 14px 16px 18px;
    }
    .shop .card .store-row { display: flex; justify-content: space-between; align-items: center; }
    .shop .card .store {
      font: 700 11px/1 var(--font-sans); letter-spacing: .14em; color: var(--ink);
      text-transform: uppercase;
    }
    .shop .card .edit-pill {
      width: 24px; height: 24px; border-radius: 6px; border: none;
      background: transparent; color: var(--mut); cursor: pointer; font-size: 11px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      opacity: 0; transition: opacity .18s, color .18s;
    }
    .shop .card:hover .edit-pill { opacity: .9; }
    .shop .card .edit-pill:hover { color: var(--ink); }

    .shop .card .t-link { text-decoration: none; color: inherit; display: block; margin-top: 2px; }
    .shop .card .title {
      font: 500 14px/1.4 var(--font-sans); color: var(--ink);
      letter-spacing: -.008em;
    }
    .shop .card .t-link:hover .title { color: var(--gold); }

    .shop .card .meta {
      font: 400 12px/1.4 var(--font-sans); color: var(--mut);
      letter-spacing: -.002em;
    }

    .shop .card .price-row {
      display: flex; align-items: baseline; gap: 10px;
      margin-top: 10px;
    }
    .shop .card .price {
      font: 600 15px/1 var(--font-sans); color: var(--ink); letter-spacing: -.012em;
      font-feature-settings: "tnum";
    }
    .shop .card .note {
      font: italic 400 11.5px/1.3 var(--font-sans); color: var(--mut);
      flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .shop .card .cta { margin-top: 14px; }
    .shop .card .claim-btn {
      width: 100%;
      background: var(--ink); color: #fff; border: none; border-radius: 999px;
      padding: 10px 14px; font: 500 13px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: background .18s, transform .18s;
    }
    .shop .card .claim-btn:hover { background: #000; transform: translateY(-1px); }
    .shop .card .claim-btn.confirming { background: var(--green); }

    .shop .card .status-line {
      font: 400 12px/1.45 var(--font-sans); color: var(--mut);
      letter-spacing: -.002em;
    }
    .shop .card .status-line b { color: var(--ink); font-weight: 600; }

    /* progress hairline at the bottom edge */
    .shop .card.locked .progress {
      position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: var(--line);
    }
    .shop .card.locked .progress > span { display: block; height: 100%; background: var(--gold); }

    /* clear the trailing right border on the last column so it meets the layout edge cleanly */
    .shop .grid .card:nth-child(4n) { border-right: none; }
    @media (max-width: 1180px) { .shop .grid .card:nth-child(4n) { border-right: 1px solid var(--line); } .shop .grid .card:nth-child(3n) { border-right: none; } }
    @media (max-width: 900px)  { .shop .grid .card:nth-child(3n) { border-right: 1px solid var(--line); } .shop .grid .card:nth-child(2n) { border-right: none; } }
    @media (max-width: 600px)  { .shop .grid .card { border-right: none; } }

    /* edit form */
    .shop .card.editing { padding: 20px; }
    .shop .card.editing .emoji { font-size: 44px; margin-bottom: 10px; }
    .shop .card.editing .edit-fields { display: flex; flex-direction: column; gap: 10px; }
    .shop .card.editing label { display: block; font: 500 11px/1 var(--font-sans); color: var(--mut); letter-spacing: .02em; }
    .shop .card.editing input, .shop .card.editing select {
      width: 100%; margin-top: 4px; border: 1px solid var(--line); border-radius: 10px;
      padding: 10px 12px; font: 14px/1.3 var(--font-sans); outline: none; background: var(--bg);
    }
    .shop .card.editing input:focus { border-color: var(--gold); background: #fff; box-shadow: 0 0 0 3px var(--gold-soft); }
    .shop .card.editing .er-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .shop .card.editing .file-slim { width: 100%; font-size: 11px; padding: 2px 0; border: none; background: transparent; }
    .shop .card.editing .state { display: flex; gap: 8px; margin-top: 14px; justify-content: flex-end; }

    /* ===== WHY columns ===== */
    .shop .why {
      max-width: 1180px; margin: 128px auto 0;
      padding: 80px 24px 0;
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 48px;
      border-top: 1px solid var(--line);
    }
    .shop .why-col .num { font: 600 15px/1 var(--font-sans); color: var(--gold); margin-bottom: 14px; }
    .shop .why-col h4 { font: 600 20px/1.25 var(--font-sans); letter-spacing: -.018em; margin: 0 0 10px; color: var(--ink); }
    .shop .why-col p { font-size: 14.5px; color: var(--mut); line-height: 1.55; margin: 0; }
    .shop .why-col p em { font-family: Georgia, serif; font-style: italic; color: var(--ink); font-weight: 500; }

    /* ===== LEDGER ===== */
    .shop .ledger-card {
      max-width: 1180px; margin: 72px auto 0;
      padding: 32px 36px; background: var(--paper);
      border: 1px solid var(--line); border-radius: 24px;
    }
    .shop .s-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .shop .s-head h3 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -.012em; color: var(--ink); }
    .shop .s-tag { color: var(--mut); font-size: 13px; }
    .shop .ledger-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-top: 1px solid var(--line); }
    .shop .ledger-row:first-of-type { border-top: none; }
    .shop .led-title { font-size: 14px; font-weight: 500; color: var(--ink); }
    .shop .led-sub { font-size: 12px; color: var(--mut); margin-top: 3px; }
    .shop .led-amt { font-weight: 600; font-size: 15px; font-feature-settings: "tnum"; }
    .shop .led-amt.pos { color: var(--green); }
    .shop .led-amt.neg { color: var(--red); }

    /* ===== STICKY NEAR BAR (frosted, Apple) ===== */
    .near-bar {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: color-mix(in oklab, var(--paper) 84%, transparent);
      backdrop-filter: saturate(180%) blur(20px);
      -webkit-backdrop-filter: saturate(180%) blur(20px);
      color: var(--ink);
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 10px 10px 10px 22px;
      display: flex; align-items: center; gap: 14px;
      box-shadow: 0 20px 50px rgba(20,24,29,.15);
      font: 500 13.5px/1 var(--font-sans); letter-spacing: -.005em;
      z-index: 70;
    }
    .near-bar .nb-ic {
      width: 24px; height: 24px; border-radius: 50%;
      background: var(--gold-soft); color: var(--gold);
      display: inline-flex; align-items: center; justify-content: center; font-size: 13px;
    }
    .near-bar b { color: var(--ink); font-weight: 600; }
    .near-bar button {
      background: var(--ink); color: #fff; border: none; border-radius: 999px;
      padding: 9px 18px; font: 500 13px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: background .18s;
    }
    .near-bar button:hover { background: #000; }

    /* ===== CLAIM MODAL + CONGRATULATIONS ===== */
    .claim-modal-scrim {
      position: fixed; inset: 0; z-index: 200;
      display: flex; align-items: center; justify-content: center;
      background: rgba(20, 24, 29, .4);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      opacity: 0; transition: opacity .22s ease;
      pointer-events: auto;
    }
    .claim-modal-scrim.show { opacity: 1; }
    .claim-modal {
      background: var(--paper); border-radius: 28px;
      width: min(500px, 92vw); max-height: 90vh; overflow: hidden;
      box-shadow: 0 40px 100px rgba(20,24,29,.25);
      transform: scale(.92); transition: transform .32s cubic-bezier(.2,1.4,.3,1);
      position: relative;
      display: flex; flex-direction: column;
    }
    .claim-modal-scrim.show .claim-modal { transform: scale(1); }
    .claim-modal > .claim-media { flex-shrink: 0; }
    .claim-modal > .claim-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
    .claim-close {
      position: absolute; top: 14px; right: 14px; z-index: 5;
      width: 32px; height: 32px; border-radius: 50%;
      background: color-mix(in oklab, var(--paper) 90%, transparent); border: none; cursor: pointer;
      font-size: 13px; color: var(--mut);
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(10px);
    }
    .claim-close:hover { color: var(--ink); background: var(--paper); }

    .claim-media {
      aspect-ratio: 16/9;
      display: flex; align-items: center; justify-content: center;
      position: relative;
    }
    .claim-media.tier-small  { background: linear-gradient(180deg, #fdf3d6 0%, #f7e9bf 100%); }
    .claim-media.tier-medium { background: linear-gradient(180deg, #eef1f5 0%, #e3e8ef 100%); }
    .claim-media.tier-large  { background: linear-gradient(180deg, #efeaf7 0%, #e2d8f0 100%); }
    .claim-media.tier-mega   { background: linear-gradient(180deg, #1e2a38 0%, #0c1322 100%); }
    .claim-media.tier-custom { background: linear-gradient(180deg, #f7f7f9 0%, #ececf2 100%); }
    .claim-art { display: flex; align-items: center; justify-content: center; }
    .claim-emoji { font-size: 92px; color: var(--gold); opacity: .9; }
    .claim-media.tier-medium .claim-emoji { color: var(--blue); }
    .claim-media.tier-large  .claim-emoji { color: #6a3cb8; }
    .claim-media.tier-mega   .claim-emoji { color: #ffd96b; }
    .claim-art img { max-width: 60%; max-height: 60%; object-fit: contain; }

    .claim-body { padding: 28px 32px 22px; transition: opacity .3s; }
    .claim-eyebrow {
      font: 600 11px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase;
      color: var(--gold); margin-bottom: 10px;
    }
    .claim-title {
      font: 600 26px/1.15 var(--font-sans); letter-spacing: -.02em;
      margin: 0 0 6px; color: var(--ink);
    }
    .claim-price {
      font: 600 20px/1 var(--font-sans); letter-spacing: -.015em;
      color: var(--ink); margin-bottom: 20px; font-feature-settings: "tnum";
    }
    .claim-quote {
      background: var(--gold-soft);
      border-left: 3px solid var(--gold);
      padding: 14px 16px; margin: 0 0 16px;
      font: italic 500 14px/1.5 Georgia, serif;
      color: var(--ink);
      border-radius: 0 10px 10px 0;
    }
    .claim-ask { color: var(--mut); font-size: 13.5px; margin: 0 0 16px; line-height: 1.5; }
    .honor-check {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 14px 16px; background: var(--bg);
      border: 1px solid var(--line); border-radius: 12px;
      margin-bottom: 20px; cursor: pointer;
      transition: all .18s;
    }
    .honor-check:hover { background: var(--paper); border-color: var(--line2); }
    .honor-check input { margin-top: 2px; accent-color: var(--gold); flex-shrink: 0; }
    .honor-check span { font-size: 13.5px; color: var(--ink); font-weight: 500; line-height: 1.45; }
    .claim-actions { display: flex; gap: 10px; justify-content: flex-end; }
    .btn-cancel {
      background: transparent; border: none; color: var(--mut);
      border-radius: 999px; padding: 11px 20px;
      font: 500 14px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: color .18s;
    }
    .btn-cancel:hover { color: var(--ink); }
    .btn-confirm {
      background: var(--ink); color: #fff; border: none; border-radius: 999px;
      padding: 11px 26px; font: 500 14px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: background .18s, transform .18s;
    }
    .btn-confirm:disabled { opacity: .35; cursor: not-allowed; }
    .btn-confirm:hover:not(:disabled) { background: #000; transform: translateY(-1px); }
    .btn-confirm.ready { background: var(--gold); color: var(--ink); }
    .btn-confirm.ready:hover { background: #b47c15; color: #fff; }

    /* Congratulations overlay (inside modal) */
    .claim-congrats {
      position: absolute; inset: 0; background: var(--paper);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; padding: 32px;
      opacity: 0; transform: scale(.95); transition: all .35s cubic-bezier(.2,1.4,.3,1);
    }
    .claim-congrats.show { opacity: 1; transform: scale(1); }
    .congrats-burst {
      position: absolute; left: 50%; top: 50%; width: 300px; height: 300px;
      transform: translate(-50%, -50%);
      background: radial-gradient(circle, rgba(227,168,26,.18) 0%, transparent 60%);
      animation: congratsBurst 1.4s ease-out;
    }
    @keyframes congratsBurst {
      0%   { transform: translate(-50%, -50%) scale(0); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
    }
    .congrats-check {
      width: 76px; height: 76px; border-radius: 50%;
      background: var(--green);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 38px; font-weight: 600; color: #fff;
      margin-bottom: 20px;
      animation: congratsCheck .5s cubic-bezier(.2,1.4,.3,1);
    }
    @keyframes congratsCheck { from { transform: scale(0); } to { transform: scale(1); } }
    .congrats-title {
      font: 600 36px/1.1 var(--font-sans); letter-spacing: -.028em;
      margin: 0; color: var(--ink);
    }
    .congrats-price { color: var(--gold); font-weight: 600; font-size: 17px; margin-top: 10px; font-feature-settings: "tnum"; }
    .congrats-quote {
      color: var(--mut); font-family: Georgia, serif; font-style: italic;
      font-size: 14px; margin-top: 16px; max-width: 340px; line-height: 1.5;
    }

    /* ===== TOASTS ===== */
    .shop-toast {
      position: fixed; bottom: 100px; left: 50%; transform: translate(-50%, 10px);
      z-index: 85;
      background: var(--ink); color: #fff;
      padding: 12px 22px; border-radius: 999px;
      font: 500 13px/1.3 var(--font-sans); letter-spacing: -.005em;
      box-shadow: 0 20px 50px rgba(20,24,29,.2);
      opacity: 0; transition: all var(--dur) var(--ease);
      pointer-events: none; max-width: 420px; text-align: center;
    }
    .shop-toast.show { opacity: 1; transform: translate(-50%, 0); }

    .spend-toast {
      position: fixed; bottom: 100px; right: 24px; z-index: 70;
      background: var(--paper); border: 1px solid var(--line); border-radius: 20px;
      padding: 16px 18px; box-shadow: 0 20px 50px rgba(20,24,29,.1);
      display: flex; align-items: flex-start; gap: 14px; max-width: 420px;
      opacity: 0; transform: translateX(20px); transition: all var(--dur) var(--ease);
    }
    .spend-toast.show { opacity: 1; transform: none; }
    .spend-toast .spend-emoji { font-size: 28px; width: 44px; height: 44px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; background: var(--gold-soft); color: var(--gold); flex-shrink: 0; overflow: hidden; }
    .spend-toast .spend-emoji img { width: 100%; height: 100%; object-fit: cover; }
    .spend-toast .spend-title { font-weight: 600; font-size: 14px; color: var(--ink); letter-spacing: -.005em; }
    .spend-toast .spend-quote { font-size: 12.5px; color: var(--mut); font-family: Georgia, serif; font-style: italic; margin-top: 4px; }
    .spend-toast .spend-murim { font-size: 11px; color: var(--gold); margin-top: 6px; font-weight: 600; letter-spacing: .02em; }

    @media (max-width: 900px) {
      .shop .hero { grid-template-columns: 1fr; padding: 48px 32px; }
      .shop .hero-media { max-height: 280px; }
      .shop .wallet { grid-template-columns: 1fr 1fr; gap: 24px 0; }
      .shop .wallet > div:nth-child(3) { border-left: none; padding-left: 0; }
      .shop .wallet .momentum { grid-column: 1 / -1; border-left: none; padding-left: 0; padding-top: 24px; border-top: 1px solid var(--line); }
      .shop .grid { grid-template-columns: 1fr 1fr; }
      .shop .why { grid-template-columns: 1fr; gap: 32px; }
      .shop .shop-title { font-size: 38px; }
      .shop .hero-title { font-size: 32px; }
      .shop .section-head h2 { font-size: 28px; }
    }
    @media (max-width: 600px) {
      .shop .grid { grid-template-columns: 1fr; }
      .shop .wallet { grid-template-columns: 1fr; }
      .shop .wallet > div { border-left: none; padding-left: 0; border-top: 1px solid var(--line); padding-top: 24px; }
      .shop .wallet > div:first-child { border-top: none; padding-top: 0; }
    }
  </style>
  `;
}
