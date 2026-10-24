// Celebrations — radically simplified, perf-first.
//   DAY   → clean CSS check draw + title + ONE small tsParticles burst
//   WEEK  → canvas coin rain + GODLY title
//   MONTH → full tsParticles fireworks + LEGEND title
//
// Vendor globals (loaded by index.html): anime, tsParticles, loadFireworksPreset, Howler
// Per-task "bagged" micro-animation kept lightweight.

import { getSettings, getEarnQuote } from "./store.js";

// -------------------- audio (procedural fallbacks) --------------------
let _ac = null;
function audioCtx() {
  try { if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)(); return _ac; } catch (_) { return null; }
}
function procBang(vol = .4, { freq = 80, decay = .3 } = {}) {
  if (!getSettings().sound.on) return;
  const c = audioCtx(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = "triangle"; o.frequency.setValueAtTime(freq, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(10, freq / 3), c.currentTime + decay * .5);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, c.currentTime + decay);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + decay);
}
function procBrass(vol = .4, dur = 2) {
  if (!getSettings().sound.on) return;
  const c = audioCtx(); if (!c) return;
  const m = c.createGain(); m.gain.setValueAtTime(0, c.currentTime);
  m.gain.linearRampToValueAtTime(vol, c.currentTime + .08);
  m.gain.exponentialRampToValueAtTime(.001, c.currentTime + dur);
  m.connect(c.destination);
  [146.83, 220, 293.66, 369.99].forEach(f => {
    const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(f, c.currentTime);
    const g = c.createGain(); g.gain.setValueAtTime(.25, c.currentTime);
    o.connect(g); g.connect(m); o.start(); o.stop(c.currentTime + dur);
  });
}
function procChord(vol = .3, dur = 3, notes = [220, 329.63, 440, 554.37]) {
  if (!getSettings().sound.on) return;
  const c = audioCtx(); if (!c) return;
  const m = c.createGain(); m.gain.setValueAtTime(0, c.currentTime);
  m.gain.linearRampToValueAtTime(vol, c.currentTime + .3);
  m.gain.exponentialRampToValueAtTime(.001, c.currentTime + dur);
  m.connect(c.destination);
  notes.forEach(n => { const o = c.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(n, c.currentTime); o.connect(m); o.start(); o.stop(c.currentTime + dur); });
}

// -------------------- overlay helpers --------------------
function mountOverlay(id, html) {
  document.querySelectorAll(".cel-overlay").forEach(el => el.remove());
  const root = document.getElementById("celebrate-root") || document.body;
  const el = document.createElement("div");
  el.className = `cel-overlay ${id}`;
  el.innerHTML = html;
  root.appendChild(el);
  return el;
}
function dismiss(el, afterMs) {
  setTimeout(() => {
    el.classList.add("cel-fade-out");
    setTimeout(() => el.remove(), 500);
  }, afterMs);
}

// ======================================================
// Per-task "bagged" micro animation (unchanged)
// ======================================================
export function fireTaskBagged({ amount = 0, title = "", sourceEl = null } = {}) {
  if (getSettings().sound.on) procBang(.3, { freq: 320, decay: .15 });

  const rect = sourceEl?.getBoundingClientRect?.();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

  const float = document.createElement("div");
  float.className = "task-bag-float";
  float.textContent = `+ ₹${amount}`;
  float.style.left = `${x}px`; float.style.top = `${y}px`;
  document.body.appendChild(float);
  setTimeout(() => float.remove(), 1600);

  const toast = document.createElement("div");
  toast.className = "task-bag-toast";
  toast.innerHTML = `
    <div class="tbt-ic">✓</div>
    <div class="tbt-body">
      <div class="tbt-title">Task bagged</div>
      <div class="tbt-sub">${esc(title)} · + ₹${amount}</div>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 20);
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 2600);
}

// ======================================================
// DAY — clean CSS + one small particle burst
// ======================================================
export function fireDaySecured({ amount = 0 } = {}) {
  const el = mountOverlay("day", `
    <div class="cel-day-check">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="none" stroke="#0e8e3f" stroke-width="4" class="cel-day-ring"/>
        <path d="M30 50 L45 65 L72 38" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" class="cel-day-tick"/>
      </svg>
    </div>
    <div class="cel-core">
      <h1 class="cel-title cel-gold">DAY SECURED</h1>
      <div class="cel-coin">+ ₹${amount.toLocaleString()} banked</div>
      <div class="cel-quote">"${esc(getEarnQuote())}"</div>
    </div>
  `);

  // One small burst of confetti via tsParticles (not full fireworks preset — much lighter)
  if (window.tsParticles) {
    (async () => {
      try {
        const container = await window.tsParticles.load({
          id: "cel-day-particles",
          options: {
            fullScreen: { enable: true, zIndex: 1 },
            background: { color: "transparent" },
            particles: {
              number: { value: 0 },
              color: { value: ["#ffd96b", "#ffb800", "#ff6a40", "#4ade80", "#60a5fa", "#c084fc"] },
              shape: { type: "square" },
              opacity: { value: 1, animation: { enable: true, speed: 2, startValue: "max", destroy: "min" } },
              size: { value: { min: 3, max: 7 } },
              move: { enable: true, speed: { min: 10, max: 20 }, gravity: { enable: true, acceleration: 12 }, decay: 0.02, outModes: { default: "destroy", top: "none" } }
            },
            emitters: [{
              life: { count: 1, duration: 0.1 },
              rate: { quantity: 80, delay: 0 },
              position: { x: 50, y: 60 },
              size: { width: 20, height: 0 },
              direction: "top",
              particles: { move: { angle: { value: 360, offset: 0 }, direction: "none" } }
            }]
          }
        });
        el.__tsp = container;
      } catch (err) { console.warn("[cel day] tsp failed:", err); }
    })();
  }

  // Sound
  procBang(.5, { freq: 480, decay: .25 });
  setTimeout(() => procBang(.3, { freq: 180, decay: .3 }), 150);

  // Title entrance
  if (window.anime) {
    window.anime.animate(el.querySelector(".cel-core"), {
      scale: [0.6, 1.06, 1], opacity: [0, 1], duration: 700, ease: "outElastic(1, .6)"
    });
  }

  setTimeout(() => { if (el.__tsp) try { el.__tsp.destroy(); } catch (_) {} }, 3500);
  dismiss(el, 4000);
}

// ======================================================
// WEEK — canvas coin rain only (GODLY)
// ======================================================
export function fireWeekGodly({ amount = 0 } = {}) {
  const el = mountOverlay("week", `
    <canvas class="cel-week-canvas"></canvas>
    <div class="cel-core cel-core-week">
      <h1 class="cel-title cel-gold cel-week-title">GODLY</h1>
      <div class="cel-subtitle">WEEK CROWNED</div>
      <div class="cel-coin cel-coin-huge">+ ₹${amount.toLocaleString()} <span class="cel-sub-small">week bonus</span></div>
      <div class="cel-quote">"${esc(getEarnQuote())}"</div>
    </div>
  `);

  // Richer, longer audio stack for Week — more presence than Day
  procBrass(.5, 3.5);
  setTimeout(() => procChord(.35, 4, [220, 277.18, 329.63, 440, 554.37]), 300);
  setTimeout(() => procBrass(.4, 2.5), 3500);
  [1200, 1700, 2300, 2900, 3500, 4100, 4700, 5300, 5900, 6500, 7000].forEach((t, i) =>
    setTimeout(() => procBang(.3, { freq: 65 + (i % 6) * 12 }), t));

  const canvas = el.querySelector(".cel-week-canvas");
  const ctx = canvas.getContext("2d", { alpha: true });
  let W = 0, H = 0;
  function fit() { W = window.innerWidth; H = window.innerHeight; canvas.width = W; canvas.height = H; }
  fit();

  // Pre-render coin sprites
  const SHADES = {
    deep:   ["#8c6400", "#c88a07", "#5a4000"],
    bright: ["#fff5b8", "#ffd96b", "#c88a07"],
    mid:    ["#ffd96b", "#e3a81a", "#8c6400"]
  };
  const RADII = [10, 13, 16, 19];
  const sprites = {};
  for (const sh of Object.keys(SHADES)) {
    for (const r of RADII) {
      const size = r * 2 + 4;
      const off = document.createElement("canvas");
      off.width = size; off.height = size;
      const o = off.getContext("2d");
      const cx = size / 2, cy = size / 2;
      const g = o.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, SHADES[sh][0]); g.addColorStop(.5, SHADES[sh][1]); g.addColorStop(1, SHADES[sh][2]);
      o.fillStyle = g;
      o.beginPath(); o.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2); o.fill();
      o.fillStyle = "rgba(255,255,255,.4)";
      o.beginPath(); o.ellipse(cx - r * .3, cy - r * .3, r * .3, r * .2, 0, 0, Math.PI * 2); o.fill();
      if (r >= 13) {
        o.fillStyle = "rgba(140,100,0,.75)";
        o.font = `bold ${Math.round(r * 1.1)}px -apple-system, Inter, sans-serif`;
        o.textAlign = "center"; o.textBaseline = "middle";
        o.fillText("₹", cx, cy + 1);
      }
      sprites[`${sh}_${r}`] = { canvas: off, size, half: size / 2 };
    }
  }

  // 2× coins vs. before — denser rain
  const COIN_COUNT = 180;
  const coins = [];
  const shadeKeys = Object.keys(SHADES);
  for (let i = 0; i < COIN_COUNT; i++) {
    const sp = sprites[`${shadeKeys[(Math.random() * 3) | 0]}_${RADII[(Math.random() * 4) | 0]}`];
    coins.push({
      x: Math.random() * W,
      y: -40 - Math.random() * H * .8,
      vx: (Math.random() - .5) * 1.6,
      vy: 3.5 + Math.random() * 5,
      sprite: sp,
      half: sp.half,
      spin: Math.random() * Math.PI * 2,
      spd: .08 + Math.random() * .12
    });
  }
  // Secondary burst wave — a second rain surge after 1.5s so the stream never thins
  setTimeout(() => {
    for (let i = 0; i < 80; i++) {
      const sp = sprites[`bright_${RADII[(Math.random() * 4) | 0]}`];
      coins.push({
        x: Math.random() * W, y: -40 - Math.random() * 100,
        vx: (Math.random() - .5) * 2, vy: 5 + Math.random() * 5,
        sprite: sp, half: sp.half,
        spin: Math.random() * Math.PI * 2, spd: .1 + Math.random() * .15
      });
    }
  }, 1500);

  let running = true;
  function draw() {
    if (!running) return;
    ctx.fillStyle = "rgba(10,3,0,.35)";
    ctx.fillRect(0, 0, W, H);
    for (const c of coins) {
      c.x += c.vx; c.y += c.vy; c.vy += 0.05; c.spin += c.spd;
      if (c.y > H + c.half) { c.y = -c.half; c.x = Math.random() * W; c.vy = 3 + Math.random() * 4; }
      const stretch = Math.max(.2, Math.abs(Math.cos(c.spin)));
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(stretch, 1);
      ctx.drawImage(c.sprite.canvas, -c.half, -c.half);
      ctx.restore();
    }
    requestAnimationFrame(draw);
  }
  draw();

  // Title entrance
  if (window.anime) {
    window.anime.animate(el.querySelector(".cel-title"), {
      scale: [0.3, 1.15, 1], opacity: [0, 1], duration: 1100, ease: "outElastic(1, .5)"
    });
    window.anime.animate(el.querySelector(".cel-subtitle"), {
      opacity: [0, 1], translateY: [20, 0], duration: 700, delay: 400, ease: "outExpo"
    });
    window.anime.animate(el.querySelector(".cel-coin-huge"), {
      opacity: [0, 1], scale: [0.85, 1], duration: 600, delay: 800, ease: "outExpo"
    });
  }

  // Longer hold — give the user time to feel it
  setTimeout(() => { running = false; }, 9000);
  dismiss(el, 9500);
}

// ======================================================
// MONTH — tsParticles fireworks preset full-on + LEGEND title
// ======================================================
export function fireMonthLegend({ amount = 0 } = {}) {
  const el = mountOverlay("month", `
    <canvas class="cel-month-coins"></canvas>
    <div id="cel-month-fw" class="cel-canvas-mount"></div>
    <div class="cel-core cel-core-month">
      <div class="cel-pre-title">THE GRIND HAS BEEN WITNESSED</div>
      <h1 class="cel-title cel-month-title">LEGEND</h1>
      <div class="cel-subtitle cel-month-sub">ASCENDED</div>
      <div class="cel-coin cel-coin-huge">+ ₹${amount.toLocaleString()} <span class="cel-sub-small">month bonus</span></div>
      <div class="cel-quote cel-month-quote">"${esc(getEarnQuote())}"</div>
    </div>
  `);

  // Deeper, longer audio stack — Month is HEAVIER than Week
  procBrass(.6, 4);
  setTimeout(() => procChord(.4, 6, [146.83, 196, 246.94, 329.63, 440]), 400);
  setTimeout(() => procBrass(.5, 3.5), 3500);
  setTimeout(() => procChord(.35, 4, [164.81, 220, 277.18, 349.23, 440]), 7000);
  // More bangs across a longer window (25 vs 15, over 13s)
  for (let i = 0; i < 25; i++) {
    setTimeout(() => procBang(.3 + Math.random() * .2, { freq: 45 + Math.random() * 90, decay: .4 }), 1800 + i * 500);
  }

  // Fireworks preset (needs loadFireworksPreset once)
  if (window.tsParticles && window.loadFireworksPreset) {
    (async () => {
      try {
        await window.loadFireworksPreset(window.tsParticles);
        const container = await window.tsParticles.load({
          id: "cel-month-fw",
          options: {
            preset: "fireworks",
            fullScreen: { enable: false, zIndex: 0 },
            background: { color: "transparent" }
          }
        });
        el.__tsp = container;
      } catch (err) { console.warn("[cel month] tsp failed:", err); }
    })();
  }

  // Coin storm — layered UNDER the fireworks (zIndex 0 in CSS). Different from the Week rain:
  //   coins drift UPWARD like embers before falling back, giving an "ascended" feel.
  const canvas = el.querySelector(".cel-month-coins");
  const ctx = canvas.getContext("2d", { alpha: true });
  let W = window.innerWidth, H = window.innerHeight;
  canvas.width = W; canvas.height = H;

  const monthSprites = [];
  for (const sh of [["#fff5b8", "#ffd96b", "#c88a07"], ["#ffd96b", "#e3a81a", "#8c6400"]]) {
    for (const r of [10, 14, 18, 22]) {
      const size = r * 2 + 4;
      const off = document.createElement("canvas"); off.width = size; off.height = size;
      const o = off.getContext("2d");
      const cx = size / 2, cy = size / 2;
      const g = o.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, sh[0]); g.addColorStop(.5, sh[1]); g.addColorStop(1, sh[2]);
      o.fillStyle = g; o.beginPath(); o.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2); o.fill();
      o.fillStyle = "rgba(255,255,255,.4)";
      o.beginPath(); o.ellipse(cx - r * .3, cy - r * .3, r * .3, r * .2, 0, 0, Math.PI * 2); o.fill();
      if (r >= 14) {
        o.fillStyle = "rgba(140,100,0,.75)";
        o.font = `bold ${Math.round(r * 1.1)}px -apple-system, Inter, sans-serif`;
        o.textAlign = "center"; o.textBaseline = "middle";
        o.fillText("₹", cx, cy + 1);
      }
      monthSprites.push({ canvas: off, size, half: size / 2 });
    }
  }

  const PARTICLES = 220;
  const parts = [];
  for (let i = 0; i < PARTICLES; i++) {
    parts.push({
      x: Math.random() * W,
      y: H + Math.random() * 100,
      vx: (Math.random() - .5) * 2.5,
      vy: -4 - Math.random() * 6,
      ay: 0.07,          // gravity pulls them back down after ascent
      sprite: monthSprites[(Math.random() * monthSprites.length) | 0],
      spin: Math.random() * Math.PI * 2,
      spd: .09 + Math.random() * .14
    });
  }

  let running = true;
  function draw() {
    if (!running) return;
    ctx.fillStyle = "rgba(10,3,0,.3)";
    ctx.fillRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += p.ay;
      p.x += p.vx; p.y += p.vy; p.spin += p.spd;
      if (p.y > H + p.sprite.half || p.y < -p.sprite.half - 200) {
        p.y = H + 20; p.x = Math.random() * W; p.vy = -4 - Math.random() * 6; p.vx = (Math.random() - .5) * 2.5;
      }
      const stretch = Math.max(.2, Math.abs(Math.cos(p.spin)));
      ctx.save();
      ctx.translate(p.x, p.y); ctx.scale(stretch, 1);
      ctx.drawImage(p.sprite.canvas, -p.sprite.half, -p.sprite.half);
      ctx.restore();
    }
    requestAnimationFrame(draw);
  }
  draw();

  // Text timeline
  if (window.anime) {
    const tl = window.anime.createTimeline({ ease: "outExpo" });
    tl.add(el.querySelector(".cel-pre-title"), { opacity: [0, 1], translateY: [16, 0], duration: 600, delay: 1600 });
    tl.add(el.querySelector(".cel-month-title"), { scale: [0.4, 1.2, 1], opacity: [0, 1], duration: 1200, ease: "outElastic(1, .4)" }, "-=100");
    tl.add(el.querySelector(".cel-month-sub"), { opacity: [0, 1], translateY: [20, 0], duration: 600 }, "-=400");
    tl.add(el.querySelector(".cel-coin-huge"), { opacity: [0, 1], scale: [0.85, 1], duration: 600 }, "-=200");
    tl.add(el.querySelector(".cel-month-quote"), { opacity: [0, 1], duration: 800 }, "-=200");
  }

  setTimeout(() => { running = false; if (el.__tsp) try { el.__tsp.destroy(); } catch (_) {} }, 13500);
  dismiss(el, 14000);
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }
