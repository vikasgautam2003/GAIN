// Central in-memory store. Loads settings, wallet, dayLog, and CSV sheets.
// Persists on change (debounced). Everything reads Settings at runtime.

import { parseCSV, serializeCSV } from "./csv.js";
import { MOTIVATIONS as BANK_MOTIVATIONS } from "./motivations_bank.js";
import { SHOP_QUOTES as BANK_SHOP_QUOTES } from "./shop_quotes.js";

const invoke = (cmd, args) => window.__TAURI__?.core?.invoke?.(cmd, args)
  ?? Promise.reject(new Error("Tauri IPC not available"));

// Opens http(s) URLs in the system browser. Tauri's webview blocks
// target="_blank" so every external link should go through this.
export async function openExternal(url) {
  try {
    await invoke("open_url", { url });
  } catch (e) {
    console.warn("open_url failed:", e);
  }
}

// One-time delegate: any <a data-ext href="https://..."> click opens via `open_url`
// instead of trying to navigate the webview.
if (typeof document !== "undefined" && !document.__gainExtWired) {
  document.__gainExtWired = true;
  document.addEventListener("click", (e) => {
    const a = e.target?.closest?.("a[data-ext]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || !/^https?:\/\//i.test(href)) return;
    e.preventDefault();
    openExternal(href);
  }, true);
}

const DEFAULT_SETTINGS = {
  profile: {
    name: "Vikas",
    targetRole: "FDE (SaaS + Palantir-style) · 10 LPA+",
    targetDate: "2027-04-18",
    weekdayMinutes: 90
  },
  grok: {
    // Despite the field name "grok", the backend now calls Groq (groq.com) — the AI butler.
    // Keeping the key name for backward compatibility with saved settings.
    apiKey: "",        // live key is kept in OS keyring via secure_set as "groq_api_key"; this mirrors last-set presence
    // Default: openai/gpt-oss-20b — public tier (250K TPM / 1K RPM), 1000 t/s,
    // 131K context, 65K completion. The llama 3.3 70b is Enterprise-only and
    // was returning 429 on non-Enterprise accounts. User can still pick any
    // other model in Settings → AI butler.
    model: "openai/gpt-oss-20b",
    temperature: 0.3,
    masterPrompt:
`You are GAIN's butler: a ruthless, caring personal FDE interview coach for Vikas,
a Rocketlane engineer targeting SaaS-product AND Palantir-style Forward Deployed
Engineer roles (10 LPA+), coding in Java.

MISSION: plan this week's study and price each task so he is 99% interview-ready
in ~24 weeks. You are fed: his full sheet state (every DSA/SD/INT item with
Status, Confidence, DateSolved, Pattern, Freq, Role), the current Settings
including dynamicConditions, and his short prompt for the week.

RULES:
- Obey every dynamicConditions entry literally. They override defaults.
- Respect schedule: ~1 core DSA/weekday; prepend a CONF easy problem when a new
  pattern starts; SD/INT only on configured days; weekends = retries + 1 case study.
- Prioritise Freq=HIGH patterns and his weak/low-confidence/AGAIN items.
- Never schedule more than one Hard per day unless asked.
- Price each task between wallet.taskMin and wallet.taskMax by difficulty, estimated
  minutes, and importance (hard/graph/DP/new-pattern = higher; quick revision = low).
- Keep daily load realistic for his weekdayMinutes budget.
- Output ONLY the JSON contract. No prose outside it.
TONE for 'reason' fields: terse, direct, no fluff.`,
    dynamicConditions: []
  },
  schedule: {
    newDsaPerWeekday: 1,
    sdIntDays: ["Mon", "Thu"],
    weekendMode: "retries+casestudy",
    srIntervals: [7, 30],
    maxTasksPerDay: 5,    // hard cap — no overloading, no ripping yourself off
    revisitCapPct: 40,    // SRS: max % of daily plan reserved for due revisits (0 disables; higher = more review-heavy)
    // Per-sheet daily mix — how many problems the "+ Add tasks" button pulls
    // from each sheet in one shot. Editable from Settings → Schedule AND via a
    // compact ⚙ Mix chip on the Today page. Only recognised sheet names are
    // used; the picker silently skips any sheet with a 0 or missing entry.
    dailyMix: {
      "DSA": 2,
      "System Design": 1,
      "SQL": 1,
      "Integrations": 1,
      "Interview Extras": 1,
      "OS & Networking": 1
    },
    weeklyFocus: {
      // Curated list of indispensable patterns the app rotates through week-by-week.
      // Fully user-editable from Settings. On Monday the engine picks the next entry
      // (or an override you set via the Dashboard tile) and biases Suggest + Warmup
      // toward it for 7 days.
      patterns: [
        "Graphs", "Dynamic Programming", "Trees", "Sliding Window", "Binary Search",
        "Two Pointers", "Heap / Priority Queue", "Backtracking",
        "System Design: Caching", "System Design: Load Balancing",
        "OS: Sync primitives", "Networking: DNS"
      ],
      current: "",          // explicit override — if empty, derive from rotationIdx
      rotationIdx: 0,       // next-in-rotation index
      startedAt: null       // Monday timestamp of current focus week
    },
    // --- TESTS ---
    // Weekly scheduler flips a coin on Monday for which weekend day a test
    // injects into Today. Fully disable-able. Bounty scales with your score:
    // 100% nails it, 40% is the pass line, below 40% banks nothing.
    tests: {
      weeklyEnabled: true,
      weeklyLengthMode: "standard",  // "quick" | "standard" | "deep"
      bountyMultiplier: 1.0,         // user can boost/dial-down the bounty
    },
    // --- STREAMLINED STUDY MODE ---
    // Per-sheet toggle: when true, Today + Suggest only picks problems from
    // the sheet's current "active" topic. The active topic is the first entry
    // in `topicOrder[sheetName]` whose unlock criteria haven't been met:
    //   > 10 problems solved in the topic AND avg ★ of the last 10 ≥ 4
    //   > (sheets with < 10 problems in a topic: solve all of them + avg ≥ 4)
    // Sheets left in RANDOM mode behave exactly like before — zero regressions.
    // Sheets WITHOUT a Pattern column (e.g. Interview Extras today) silently
    // fall back to random mode, with a banner surfacing the fallback once.
    study: {
      streamlined: {},        // { "DSA": true, "System Design": false, ... }
      topicOrder: {},         // { "DSA": ["Arrays & Hashing", ...], ... }
      // Default seed orders. User can reorder/add/delete via the editor.
      // Derived from the NeetCode-ish standard sequence + sensible groupings
      // for the concept-track sheets. These seed on first launch only; later
      // the user's edits win.
      defaultOrder: {
        "DSA": [
          "Arrays & Hashing", "Two Pointers", "Sliding Window", "Stack",
          "Binary Search", "Linked List", "Trees", "Tries",
          "Heap / Priority Queue", "Backtracking", "Graphs",
          "Advanced Graphs", "1-D DP", "2-D DP", "Greedy", "Intervals",
          "Math & Geometry", "Bit Manipulation"
        ],
        "System Design": [
          "Fundamentals", "Databases", "Caching", "Load Balancing",
          "Protocols", "Patterns", "SaaS Systems", "Case Study",
          "Design / LLD", "Messaging"
        ],
        "OS & Networking": [ "OS", "Networking" ]
      }
    }
  },
  wallet: {
    taskMin: 20, taskMax: 100,
    perfectDayBonus: 0,
    weekBonus: 1000, monthBonus: 3000,
    streak30: 1500, streak100: 5000,
    streakFreezePrice: 500,         // cost to buy one Streak Freeze token
    perfectWeekBonus: 500,          // one-time ₹ bonus for 5 green days in a row (9D)
    perfectWeekDays: 5,             // consecutive-green threshold for the bonus (configurable)
    dailyEarningCap: 0,             // 0 = no cap. Positive int = max ₹/day from solve ledger entries.
    withdrawCapMode: "tasks", withdrawCapValue: null,
    // Shop tier unlock thresholds (lifetime ₹ earned to unlock)
    tierUnlocks: { small: 20, medium: 500, large: 2000, mega: 5000 }
  },
  animations: { day: "confetti", week: "lottie", month: "lottie", lottie: true, intensity: "normal", style: "confetti" },
  // Chill Hideout — default browser for Recreation links. Empty = system default.
  // Per-site `browser` on each recreation card overrides this.
  recreationBrowser: "",
  // Hideout lounge theme — "london" | "tokyo" | "lisbon" | "neworleans"
  hideoutTheme: "london",
  sound: {
    on: true,
    volume: 0.7,
    // Custom data-URL sounds (user-uploaded). If empty, falls back to assets/sound/*.mp3.
    customDay: "", customWeek: "", customMonth: "", customEarn: ""
  },
  motivation: { tone: "goggins", profanity: true, perDay: 2, footerLine: true },
  sheets: [
    { name: "DSA",          file: "01_DSA_SHEET.csv",                 type: "dsa", columnMap: {} },
    { name: "System Design",file: "02_SYSTEM_DESIGN_SHEET.csv",       type: "sd",  columnMap: {} },
    { name: "Integrations", file: "03_INTEGRATIONS_PLATFORMS_SHEET.csv", type: "int",  columnMap: {} },
    { name: "Interview Extras", file: "04_FDE_INTERVIEW_EXTRAS.csv",  type: "ext", columnMap: {} },
    { name: "SQL",          file: "05_SQL_SHEET.csv",                 type: "sql", columnMap: {} },
    { name: "OS & Networking", file: "06_OS_NETWORKING_SHEET.csv",    type: "os",  columnMap: {} }
  ],
  appearance: { accent: "#3b64f6", theme: "light" }
};

const DEFAULT_WALLET = {
  earned: 0, spent: 0, available: 0, ledger: [],
  dailyWithdrawn: {},  // { "2026-10-18": 2 }  task-based cap tracker
  wishlist: [],        // array of reward ids, in chain order
  freezeTokens: 0,     // Phase 7: streak-freeze tokens — buy from Shop or topbar, apply to protect a non-green day
};

const DEFAULT_DAY_LOG = {};

const DEFAULT_REWARDS = {
  catalog: []   // seeded from rewards_catalog.csv on first boot
};

// Canonical type registry — ordered for carousel display. Order matters.
// Each entry: key (store-token, lowercase), label (display), emoji (fallback art),
// keywords (title/category hints for the type inferer).
export const REWARD_TYPES = [
  { key: "shoes",       label: "Shoes",         emoji: "👟", keywords: ["sneaker","shoe","boot","trainer","loafer"] },
  { key: "apparel",     label: "Apparel",       emoji: "👕", keywords: ["t-shirt","shirt","jacket","hoodie","boxer","shorts","trouser","pant","sweatshirt","varsity"] },
  { key: "bag",         label: "Bags",          emoji: "🎒", keywords: ["backpack","duffle","bag","tote","handbag","sling"] },
  { key: "accessory",   label: "Accessories",   emoji: "✨", keywords: ["keychain","wallet","belt","scarf","sunglass","cap","hat"] },
  { key: "watches",     label: "Watches",       emoji: "⌚", keywords: ["watch","timepiece","smartwatch"] },
  { key: "jewelry",     label: "Jewelry",       emoji: "💎", keywords: ["ring","chain","bracelet","earring","necklace","pendant"] },
  { key: "electronics", label: "Electronics",   emoji: "🎧", keywords: ["headphone","earbud","speaker","tablet","tab","ipad","phone","laptop","console","display"] },
  { key: "cameras",     label: "Cameras",       emoji: "📷", keywords: ["camera","gopro","dslr","mirrorless","lens"] },
  { key: "food",        label: "Food & drink",  emoji: "🍜", keywords: ["pizza","chaat","momo","burger","meal","coffee","tea","drink","buffet","gol gappe","pani puri"] },
  { key: "experience",  label: "Experiences",   emoji: "🎟", keywords: ["concert","event","movie","show","match","ticket","class"] },
  { key: "travel",      label: "Travel",        emoji: "✈️", keywords: ["trip","ladakh","thailand","goa","bali","vacation","tour","flight","hotel","stay"] },
  { key: "fitness",     label: "Fitness",       emoji: "🏋", keywords: ["dumbbell","yoga","gym","protein","resistance"] },
  { key: "wellness",    label: "Wellness",      emoji: "🧘", keywords: ["spa","massage","meditation","retreat","sleep"] },
  { key: "outdoor",     label: "Outdoor",       emoji: "⛰", keywords: ["camp","trek","hike","tent","outdoor","skateboard","surf"] },
  { key: "home",        label: "Home",          emoji: "🏠", keywords: ["lamp","chair","desk","mug","cushion","candle","sheet"] },
  { key: "books",       label: "Books",         emoji: "📚", keywords: ["book","novel","manga","comic","kindle"] },
  { key: "games",       label: "Games",         emoji: "🎮", keywords: ["game","playstation","xbox","nintendo","board game","chess"] },
  { key: "music",       label: "Music",         emoji: "🎸", keywords: ["guitar","vinyl","record","piano","keyboard","instrument"] },
  { key: "art",         label: "Art",           emoji: "🎨", keywords: ["poster","print","sketch","paint","easel","canvas"] },
  { key: "grooming",    label: "Grooming",      emoji: "✂️", keywords: ["cologne","perfume","trimmer","razor","skin","beard"] },
  { key: "cars",        label: "Cars",          emoji: "🚗", keywords: ["car","sedan","suv","convertible","supercar"] },
  { key: "bikes",       label: "Bikes",         emoji: "🏍", keywords: ["bike","motorcycle","cycle","bicycle","harley","ducati"] },
  { key: "kids",        label: "Kids",          emoji: "🧸", keywords: ["kid","toy","lego","plush","nursery"] },
  { key: "space",       label: "Space",         emoji: "🚀", keywords: ["telescope","meteorite","astronaut","star","nebula","satellite"] },
  { key: "custom",      label: "Other",         emoji: "🎁", keywords: [] }
];

const _TYPE_INDEX = new Map(REWARD_TYPES.map(t => [t.key, t]));

function normalizeType(rawType, category, title) {
  const direct = String(rawType || "").trim().toLowerCase();
  if (direct && _TYPE_INDEX.has(direct)) return direct;
  const cat = String(category || "").trim().toLowerCase();
  if (cat) {
    const byLabel = REWARD_TYPES.find(t => t.label.toLowerCase() === cat || t.key === cat);
    if (byLabel) return byLabel.key;
    const partial = REWARD_TYPES.find(t => cat.includes(t.key) || t.label.toLowerCase().includes(cat));
    if (partial) return partial.key;
  }
  const t = `${title || ""} ${category || ""}`.toLowerCase();
  for (const typeDef of REWARD_TYPES) {
    if (typeDef.keywords?.some(k => t.includes(k))) return typeDef.key;
  }
  return "custom";
}

export function getRewardTypes() { return REWARD_TYPES; }

const DEFAULT_MOTIVATIONS = {
  // Full seed bank (~250 lines) — ships with the app. User uploads override these entirely.
  seeds: BANK_MOTIVATIONS,
  user: []  // added by the user via Settings → Motivation (textarea or CSV upload)
};

// Murim / jianghu-tone accountability quotes for the Shop. User uploads override these.
const DEFAULT_SHOP_QUOTES = {
  seeds: BANK_SHOP_QUOTES,
  user: []
};

const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  wallet: structuredClone(DEFAULT_WALLET),
  dayLog: structuredClone(DEFAULT_DAY_LOG),
  sheets: {},        // { "DSA": {headers:[], rows:[], file, type} }
  motivations: structuredClone(DEFAULT_MOTIVATIONS),
  shopQuotes:  structuredClone(DEFAULT_SHOP_QUOTES),
  rewards: structuredClone(DEFAULT_REWARDS),
  quotes: { earn: [], spend: [] },  // populated from JSON banks (Part 3)
  weeklyPlan: null,   // last saved weekly plan (see applyWeeklyPlan)
  solutions: {},      // { "DSA#86": "code...", ... } — problem-page solutions keyed by sheet#rowIndex
  recreations: [],    // Chill Hideout — user-curated escape sites
  collections: [],    // Chill Hideout — user-curated collections (Comics / Novels / etc)
  booted: false,
  listeners: new Set()
};

// --------- debounced persist ---------
const timers = {};
function schedule(key, fn, ms = 400) {
  if (timers[key]) clearTimeout(timers[key]);
  timers[key] = setTimeout(() => { timers[key] = null; fn(); }, ms);
}

async function readIfExists(path) {
  const exists = await invoke("file_exists", { path }).catch(() => false);
  if (!exists) return null;
  return invoke("read_text_file", { path });
}

async function writeFile(path, contents, backup = true) {
  return invoke("write_text_file", { path, contents, backup });
}

// --------- boot ---------
export async function boot() {
  if (state.booted) return;
  // settings
  try {
    const raw = await readIfExists("settings.json");
    if (raw) state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    // Migration: ensure any newly-added default sheets are present in the user's persisted list.
    const have = new Set((state.settings.sheets || []).map(x => x.name));
    for (const def of DEFAULT_SETTINGS.sheets) {
      if (!have.has(def.name)) state.settings.sheets.push({ ...def });
    }
    // Migration: deep-merge nested settings objects so new default fields
    // (revisitCapPct, weeklyFocus, …) land for existing users without wiping
    // their persisted overrides.
    state.settings.schedule = { ...DEFAULT_SETTINGS.schedule, ...(state.settings.schedule || {}) };
    // Deep-merge dailyMix so new sheets land for existing users without wiping tuned values
    state.settings.schedule.dailyMix = {
      ...DEFAULT_SETTINGS.schedule.dailyMix,
      ...(state.settings.schedule.dailyMix || {}),
    };
    // Migration: tests settings
    state.settings.schedule.tests = {
      ...DEFAULT_SETTINGS.schedule.tests,
      ...(state.settings.schedule.tests || {}),
    };
    // Migration: ensure the new `study` field (streamlined-mode state) is
    // present and deep-merged so defaults land but user edits persist.
    const existingStudy = state.settings.schedule.study || {};
    state.settings.schedule.study = {
      ...DEFAULT_SETTINGS.schedule.study,
      ...existingStudy,
      streamlined: { ...(existingStudy.streamlined || {}) },
      topicOrder: { ...(existingStudy.topicOrder || {}) },
      defaultOrder: {
        ...DEFAULT_SETTINGS.schedule.study.defaultOrder,
        ...(existingStudy.defaultOrder || {}),
      },
    };
    // One-shot: if the user is still on the old Enterprise-only default model
    // (llama-3.3-70b-versatile — returned 429 on non-Enterprise plans), bump
    // them to the public-tier default. Any explicit non-default override
    // (gpt-oss-120b, whisper, etc.) is left alone.
    if (state.settings.grok && state.settings.grok.model === "llama-3.3-70b-versatile") {
      state.settings.grok.model = "openai/gpt-oss-20b";
    }
    if (state.settings.schedule.weeklyFocus == null) {
      state.settings.schedule.weeklyFocus = { ...DEFAULT_SETTINGS.schedule.weeklyFocus };
    } else {
      state.settings.schedule.weeklyFocus = {
        ...DEFAULT_SETTINGS.schedule.weeklyFocus,
        ...state.settings.schedule.weeklyFocus,
      };
    }
    // Migration: ensure every default tier unlock threshold is present (adds 'mega' for old settings).
    state.settings.wallet.tierUnlocks = {
      ...DEFAULT_SETTINGS.wallet.tierUnlocks,
      ...(state.settings.wallet.tierUnlocks || {})
    };
  } catch (e) { console.warn("settings load fallback", e); }
  // wallet
  try {
    const raw = await readIfExists("wallet.json");
    if (raw) state.wallet = { ...DEFAULT_WALLET, ...JSON.parse(raw) };
  } catch (e) { console.warn("wallet load fallback", e); }
  // dayLog
  try {
    const raw = await readIfExists("dayLog.json");
    if (raw) state.dayLog = JSON.parse(raw);
  } catch (e) { console.warn("dayLog load fallback", e); }
  // weekly plan (last saved via applyWeeklyPlan)
  try {
    const raw = await readIfExists("weekly_plan.json");
    if (raw) state.weeklyPlan = JSON.parse(raw);
  } catch (e) { console.warn("weeklyPlan load fallback", e); }
  // problem-page solutions (keyed by "sheetName#rowIndex")
  try {
    const raw = await readIfExists("solutions.json");
    if (raw) state.solutions = JSON.parse(raw) || {};
  } catch (e) { console.warn("solutions load fallback", e); }
  // Chill Hideout — user's escape-site list + collections
  try {
    const raw = await readIfExists("recreations.json");
    if (raw) state.recreations = JSON.parse(raw) || [];
  } catch (e) { console.warn("recreations load fallback", e); }
  try {
    const raw = await readIfExists("collections.json");
    if (raw) state.collections = JSON.parse(raw) || [];
  } catch (e) { console.warn("collections load fallback", e); }
  // First-run seed: Comics / Novels / YouTube
  if (!state.collections.length) {
    state.collections = [
      { id: "col_comics",  name: "Comics",  accent: "#ff8aa8", coverImage: "", description: "Panels and arcs. Places to drift between chapters.", createdAt: Date.now() },
      { id: "col_novels",  name: "Novels",  accent: "#ffd45e", coverImage: "", description: "Long reads worth coming back to.", createdAt: Date.now() + 1 },
      { id: "col_youtube", name: "YouTube", accent: "#ff5e5e", coverImage: "", description: "Faces and channels you escape with.", createdAt: Date.now() + 2 },
    ];
  }
  // motivations — seeds always come from the code bank; only `user` persists.
  try {
    const raw = await readIfExists("motivations.json");
    if (raw) {
      const loaded = JSON.parse(raw);
      state.motivations = {
        seeds: DEFAULT_MOTIVATIONS.seeds,                 // always fresh from bank
        user: Array.isArray(loaded.user) ? loaded.user : []
      };
    }
  } catch (e) { console.warn("motivations load fallback", e); }
  // shop quotes — same pattern
  try {
    const raw = await readIfExists("shop_quotes.json");
    if (raw) {
      const loaded = JSON.parse(raw);
      state.shopQuotes = {
        seeds: DEFAULT_SHOP_QUOTES.seeds,
        user: Array.isArray(loaded.user) ? loaded.user : []
      };
    }
  } catch (e) { console.warn("shopQuotes load fallback", e); }
  // rewards catalog
  try {
    const raw = await readIfExists("rewards.json");
    if (raw) {
      const loaded = JSON.parse(raw);
      if (Array.isArray(loaded.catalog)) state.rewards = loaded;
    }
  } catch (e) { console.warn("rewards load fallback", e); }
  // bundled quote banks (seed) — ship with the app, user can edit JSON directly
  try {
    const earn = await readIfExists("earn_quotes.json");
    if (earn) state.quotes.earn = JSON.parse(earn);
    else state.quotes.earn = DEFAULT_EARN_QUOTES.slice();
    const spend = await readIfExists("spend_quotes.json");
    if (spend) state.quotes.spend = JSON.parse(spend);
    else state.quotes.spend = DEFAULT_SPEND_QUOTES.slice();
  } catch (e) {
    state.quotes.earn = DEFAULT_EARN_QUOTES.slice();
    state.quotes.spend = DEFAULT_SPEND_QUOTES.slice();
  }

  // sheets — if any configured file is missing but a bundled copy exists, import it on first run
  await ensureFirstRunImport();
  for (const sheet of state.settings.sheets) {
    await loadSheet(sheet);
  }

  // One-time cleanup: purge legacy stock rewards (ids prefixed "r-", not "rw-").
  // These were the chips/coffee/book defaults; they're obsolete now that the CSV is the source.
  const beforeLen = state.rewards.catalog.length;
  state.rewards.catalog = state.rewards.catalog.filter(r => !/^r-/.test(String(r.id || "")) || /^rw-/.test(String(r.id || "")));
  if (state.rewards.catalog.length !== beforeLen) {
    schedule("rewards", persistRewards);
  }

  // Backfill: any reward without a canonical `type` gets one inferred from category/title.
  let backfilled = 0;
  for (const r of state.rewards.catalog) {
    if (!r.type || !_TYPE_INDEX.has(r.type)) {
      r.type = normalizeType(r.type, r.category, r.title);
      backfilled++;
    }
  }
  if (backfilled) schedule("rewards", persistRewards);

  // One-shot bundled catalog seed: if the catalog has no "rw-" prefixed items yet, import the bundled CSV.
  try {
    const hasImported = state.rewards.catalog.some(r => String(r.id || "").startsWith("rw-"));
    if (!hasImported) {
      const csv = await readIfExists("rewards_catalog.csv");
      if (csv) {
        const result = await importRewardsFromCsv(csv, { replace: false });
        console.log("[store] seeded rewards from bundled CSV", result);
      }
    }
  } catch (e) { console.warn("rewards seed failed", e); }

  // persist defaults so files exist for next boot
  await persistSettings();
  await persistWallet();
  await persistDayLog();
  await persistMotivations();
  await persistShopQuotes();
  await persistRewards();
  await persistQuotes();

  // Warm the session-secrets cache from keyring on boot so the bot has the key available
  // immediately on page load (no Test-connection round-trip required). Tries new name first,
  // falls back to legacy.
  try {
    const k = await invoke("secure_get", { key: "groq_api_key" }).catch(() => null)
           || await invoke("secure_get", { key: "grok_api_key" }).catch(() => null);
    if (k) _sessionSecrets["groq_api_key"] = k;
  } catch (_) {}

  // One-time backfill: dayLog contains ticked tasks whose sheet rows never got
  // Status=SOLVED (bug in an older build where weekly-plan tasks had rowIndex=null).
  // Walk the whole dayLog once and patch any missing sheet-row updates.
  await backfillSheetFromDayLog();

  state.booted = true;
  emit("boot");
}

async function backfillSheetFromDayLog() {
  const touched = new Set();
  // Prefer the title-match since refs can mismatch (DSA#49 may encode LC#49 not Seq=49).
  function resolveRow(sh, task) {
    const seqCol = sh.headers.find(h => /^seq$/i.test(h));
    const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
    // 1) title match first (unambiguous when the title is unique)
    if (titleCol && task.title) {
      const needle = String(task.title).trim().toLowerCase();
      const idx = sh.rows.findIndex(r => String(r[titleCol] || "").trim().toLowerCase() === needle);
      if (idx >= 0) return idx;
    }
    // 2) explicit seq field
    if (seqCol && task.seq != null) {
      const idx = sh.rows.findIndex(r => String(r[seqCol]) === String(task.seq));
      if (idx >= 0) return idx;
    }
    // 3) parse `#N` out of the ref
    if (seqCol && typeof task.ref === "string") {
      const m = task.ref.match(/#(\d+)$/);
      if (m) {
        const idx = sh.rows.findIndex(r => String(r[seqCol]) === m[1]);
        if (idx >= 0) return idx;
      }
    }
    return null;
  }

  // Pass A: walk dayLog, write Status/DateSolved for every ticked task.
  for (const [dateKey, day] of Object.entries(state.dayLog)) {
    if (!day || !Array.isArray(day.assigned) || !Array.isArray(day.done)) continue;
    for (const ref of day.done) {
      const task = day.assigned.find(t => t.ref === ref);
      if (!task || !task.sheet) continue;
      const sh = state.sheets[task.sheet];
      if (!sh) continue;
      const rowIndex = task.rowIndex ?? resolveRow(sh, task);
      if (rowIndex == null) continue;

      const statusCol = sh.headers.find(h => /^status$/i.test(h));
      const dateCol   = sh.headers.find(h => /^(datesolved|datedone)$/i.test(h));
      const row = sh.rows[rowIndex];
      let changed = false;
      if (statusCol && !/^(solved|done)$/i.test(row[statusCol] || "")) {
        row[statusCol] = "SOLVED";
        changed = true;
      }
      if (dateCol && !row[dateCol]) {
        row[dateCol] = dateKey;
        changed = true;
      }
      if (changed) touched.add(task.sheet);
    }
  }

  // Pass B: heal every SOLVED row that has no DateSolved — fill with today's date.
  // Without a date, Progress/Pace/BurnUp can't count the solve. This is additive
  // (we only fill when the field is empty) and doesn't touch any other data.
  const today = todayKeyLocal();
  for (const [name, sh] of Object.entries(state.sheets)) {
    const statusCol = sh.headers.find(h => /^status$/i.test(h));
    const dateCol   = sh.headers.find(h => /^(datesolved|datedone)$/i.test(h));
    if (!statusCol || !dateCol) continue;
    for (const row of sh.rows) {
      if (/^(solved|done)$/i.test(row[statusCol] || "") && !row[dateCol]) {
        row[dateCol] = today;
        touched.add(name);
      }
    }
  }

  // Pass C: heal unlinked tasks (ADHOC or weekly-plan items without sheet/rowIndex).
  // For each dayLog task whose kind maps to a sheet, find an existing row by title
  // or create a new one. Then if the task is in `done`, write Status/Date.
  let dayLogTouched = false;
  const titleColOf = (sh) => sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
  const findOrCreateRow = (sh, title) => {
    const titleCol = titleColOf(sh);
    if (titleCol && title) {
      const needle = String(title).trim().toLowerCase();
      const idx = sh.rows.findIndex(r => String(r[titleCol] || "").trim().toLowerCase() === needle);
      if (idx >= 0) return idx;
    }
    // create a new row (inline — no await, we persist all touched sheets below)
    const row = {};
    for (const h of sh.headers) row[h] = "";
    const seqCol = sh.headers.find(h => /^seq$/i.test(h));
    if (seqCol) {
      const maxSeq = sh.rows.reduce((m, r) => Math.max(m, Number(r[seqCol]) || 0), 0);
      row[seqCol] = String(maxSeq + 1);
    }
    const statusCol = sh.headers.find(h => /^status$/i.test(h));
    if (statusCol) row[statusCol] = "TODO";
    if (titleCol && title) row[titleCol] = title;
    sh.rows.push(row);
    return sh.rows.length - 1;
  };
  for (const [dateKey, day] of Object.entries(state.dayLog)) {
    if (!day || !Array.isArray(day.assigned)) continue;
    for (const task of day.assigned) {
      if (task.sheet && task.rowIndex != null) continue;
      const sheetName = KIND_TO_SHEET[task.kind];
      if (!sheetName) continue;
      const sh = state.sheets[sheetName];
      if (!sh || !sh.headers.length) continue;
      const rowIndex = findOrCreateRow(sh, task.title);
      task.sheet = sheetName;
      task.rowIndex = rowIndex;
      dayLogTouched = true;
      touched.add(sheetName);
      // If this task was ticked, make sure Status/Date are set.
      if ((day.done || []).includes(task.ref)) {
        const statusCol = sh.headers.find(h => /^status$/i.test(h));
        const dateCol   = sh.headers.find(h => /^(datesolved|datedone)$/i.test(h));
        const row = sh.rows[rowIndex];
        if (statusCol && !/^(solved|done)$/i.test(row[statusCol] || "")) row[statusCol] = "SOLVED";
        if (dateCol && !row[dateCol]) row[dateCol] = dateKey;
      }
    }
  }

  for (const name of touched) {
    try { await persistSheet(name); } catch (e) { console.warn("[backfill] persist failed", name, e); }
  }
  if (dayLogTouched) {
    try { await persistDayLog(); } catch (e) { console.warn("[backfill] persistDayLog failed", e); }
  }
  if (touched.size) console.log(`[boot] backfill: synced ${touched.size} sheet(s)`);
}

// Shared mapping — Today's add-task UI uses the same keys so this stays in sync.
export const KIND_TO_SHEET = {
  dsa: "DSA",
  sd:  "System Design",
  int: "Integrations",
  ext: "Interview Extras",
  sql: "SQL",
  os:  "OS & Networking",
};

function todayKeyLocal() {
  // Mirrors engine.todayKey (19:00 IST rollover). Kept inline so store.js
  // doesn't need to import engine.js (avoids a circular dependency at boot).
  const d = new Date();
  const shifted = new Date(d.getTime() + (5.5 + 5) * 3600 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function ensureFirstRunImport() {
  // Try to copy from Desktop/GAIN root if present (the folder that holds the 3 originals).
  // The user can also use Settings → Import to add more.
  const candidates = ["/Users/vikasgautam/Desktop/GAIN"];
  for (const dir of candidates) {
    try {
      await invoke("first_run_import", { sourceDir: dir });
    } catch (_) { /* non-fatal */ }
  }
}

async function loadSheet(cfg) {
  try {
    const raw = await readIfExists(cfg.file);
    if (!raw) {
      state.sheets[cfg.name] = { headers: [], rows: [], file: cfg.file, type: cfg.type, columnMap: cfg.columnMap || {} };
      return;
    }
    const { headers, rows } = parseCSV(raw);
    state.sheets[cfg.name] = { headers, rows, file: cfg.file, type: cfg.type, columnMap: cfg.columnMap || {} };
  } catch (e) {
    console.error("sheet load failed", cfg, e);
    state.sheets[cfg.name] = { headers: [], rows: [], file: cfg.file, type: cfg.type, columnMap: {}, error: String(e) };
  }
}

// --------- public API ---------
export function getState() { return state; }
export function getSettings() { return state.settings; }
export function getSheet(name) { return state.sheets[name]; }
export function getSheets() { return state.sheets; }
export function getWallet() { return state.wallet; }
export function getDayLog() { return state.dayLog; }

export function on(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
export function emit(ev, payload) { for (const fn of state.listeners) try { fn(ev, payload); } catch (e) { console.error(e); } }

export async function updateSettings(mut) {
  mut(state.settings);
  emit("settings");
  schedule("settings", persistSettings);
}
async function persistSettings() {
  await writeFile("settings.json", JSON.stringify(state.settings, null, 2));
}

export async function updateWallet(mut) {
  mut(state.wallet);
  state.wallet.available = state.wallet.earned - state.wallet.spent;
  emit("wallet");
  schedule("wallet", persistWallet);
}
async function persistWallet() {
  await writeFile("wallet.json", JSON.stringify(state.wallet, null, 2));
}

export async function updateDayLog(mut) {
  mut(state.dayLog);
  emit("dayLog");
  schedule("dayLog", persistDayLog);
}
async function persistDayLog() {
  await writeFile("dayLog.json", JSON.stringify(state.dayLog, null, 2));
}

export async function updateSheetRow(sheetName, rowIndex, patch) {
  const sheet = state.sheets[sheetName];
  if (!sheet) return;
  Object.assign(sheet.rows[rowIndex], patch);
  emit("sheet", sheetName);
  schedule(`sheet:${sheetName}`, () => persistSheet(sheetName));
}

// Append a new row to a sheet. `patch` is a {colName: value} map.
// Auto-fills Seq (max+1), defaults Status to TODO, keeps unspecified cols blank.
// Returns the new row's index.
export async function addSheetRow(sheetName, patch = {}) {
  const sheet = state.sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  const row = {};
  for (const h of sheet.headers) row[h] = "";
  const seqCol = sheet.headers.find(h => /^seq$/i.test(h));
  if (seqCol) {
    const maxSeq = sheet.rows.reduce((m, r) => Math.max(m, Number(r[seqCol]) || 0), 0);
    row[seqCol] = String(maxSeq + 1);
  }
  const statusCol = sheet.headers.find(h => /^status$/i.test(h));
  if (statusCol) row[statusCol] = "TODO";
  // Apply user patch — case-insensitive header match so {status:"TODO"} works regardless of case
  for (const [k, v] of Object.entries(patch)) {
    const col = sheet.headers.find(h => h.toLowerCase() === String(k).toLowerCase()) || k;
    row[col] = v == null ? "" : String(v);
  }
  sheet.rows.push(row);
  emit("sheet", sheetName);
  // Immediate persist (not debounced) so Add is reliable even if user navigates away
  await persistSheet(sheetName);
  return sheet.rows.length - 1;
}

// Delete a row from a sheet by index. Persists immediately.
export async function deleteSheetRow(sheetName, rowIndex) {
  const sheet = state.sheets[sheetName];
  if (!sheet) return;
  if (rowIndex < 0 || rowIndex >= sheet.rows.length) return;
  sheet.rows.splice(rowIndex, 1);
  emit("sheet", sheetName);
  await persistSheet(sheetName);
}
export async function persistSheet(sheetName) {
  const sheet = state.sheets[sheetName];
  if (!sheet) return;
  const text = serializeCSV(sheet.headers, sheet.rows);
  await writeFile(sheet.file, text);
}

export async function addSheet(cfg, text) {
  // cfg: { name, file (basename), type, columnMap }
  await writeFile(cfg.file, text, false);
  await updateSettings(s => { s.sheets.push(cfg); });
  await loadSheet(cfg);
  emit("sheet:add", cfg.name);
}

// ---- motivations ----
// User-uploaded lines take priority. Defaults only fill in when the user has none.
export function getMotivations() {
  if (state.motivations.user.length > 0) return [...state.motivations.user];
  return [...state.motivations.seeds];
}
export function getMotivationCounts() {
  return {
    seeds: state.motivations.seeds.length,
    user: state.motivations.user.length,
    activeSource: state.motivations.user.length > 0 ? "user" : "defaults",
    activeCount: state.motivations.user.length > 0 ? state.motivations.user.length : state.motivations.seeds.length
  };
}
export async function addMotivations(lines) {
  const clean = (lines || []).map(l => String(l).trim()).filter(Boolean);
  if (!clean.length) return 0;
  const existing = new Set([...state.motivations.seeds, ...state.motivations.user]);
  const fresh = clean.filter(l => !existing.has(l));
  state.motivations.user.push(...fresh);
  emit("motivations");
  schedule("motivations", persistMotivations);
  return fresh.length;
}
export async function clearUserMotivations() {
  state.motivations.user = [];
  emit("motivations");
  schedule("motivations", persistMotivations);
}
async function persistMotivations() {
  await writeFile("motivations.json", JSON.stringify(state.motivations, null, 2));
}

// ---- hard reset ----
// Zeroes out wallet, dayLog, and resets Status/DateSolved/Confidence on every sheet.
// Does NOT touch: settings, sheet structure, rewards catalog, motivation/shop-quote banks,
// Grok API key in Keychain.
export async function resetAllProgress({ resetSheets = true } = {}) {
  state.wallet = structuredClone(DEFAULT_WALLET);
  state.dayLog = structuredClone(DEFAULT_DAY_LOG);
  if (resetSheets) {
    for (const name in state.sheets) {
      const sh = state.sheets[name];
      const statusCol = sh.headers.find(h => /^status$/i.test(h));
      const dateCol   = sh.headers.find(h => /^(datesolved|datedone)$/i.test(h));
      const confCol   = sh.headers.find(h => /^confidence$/i.test(h));
      if (!statusCol && !dateCol && !confCol) continue;
      for (const r of sh.rows) {
        if (statusCol) r[statusCol] = "TODO";
        if (dateCol) r[dateCol] = "";
        if (confCol) r[confCol] = "";
      }
      schedule(`sheet:${name}`, () => persistSheet(name));
    }
  }
  emit("wallet"); emit("dayLog"); emit("sheet");
  schedule("wallet", persistWallet);
  schedule("dayLog", persistDayLog);
}

// ---- shop quotes (murim) ----
export function getShopQuotes() {
  if (state.shopQuotes.user.length > 0) return [...state.shopQuotes.user];
  return [...state.shopQuotes.seeds];
}
export function getShopQuoteCounts() {
  return {
    seeds: state.shopQuotes.seeds.length,
    user: state.shopQuotes.user.length,
    activeSource: state.shopQuotes.user.length > 0 ? "user" : "defaults",
    activeCount: state.shopQuotes.user.length > 0 ? state.shopQuotes.user.length : state.shopQuotes.seeds.length
  };
}
export function getShopQuote() {
  const pool = getShopQuotes();
  if (!pool.length) return "The dao sees. Always.";
  return pool[Math.floor(Math.random() * pool.length)];
}
export async function addShopQuotes(lines) {
  const clean = (lines || []).map(l => String(l).trim()).filter(Boolean);
  if (!clean.length) return 0;
  const existing = new Set([...state.shopQuotes.seeds, ...state.shopQuotes.user]);
  const fresh = clean.filter(l => !existing.has(l));
  state.shopQuotes.user.push(...fresh);
  emit("shopQuotes");
  schedule("shopQuotes", persistShopQuotes);
  return fresh.length;
}
export async function clearUserShopQuotes() {
  state.shopQuotes.user = [];
  emit("shopQuotes");
  schedule("shopQuotes", persistShopQuotes);
}
async function persistShopQuotes() {
  await writeFile("shop_quotes.json", JSON.stringify(state.shopQuotes, null, 2));
}

// ---- rewards ----
export function getRewards() { return state.rewards; }

// ---- wishlist (array of reward ids, in chain order) ----
export function getWishlist() {
  const ids = state.wallet.wishlist || [];
  const cat = state.rewards?.catalog || [];
  return ids.map(id => cat.find(r => r.id === id)).filter(Boolean);
}
export function isWishlisted(id) {
  return (state.wallet.wishlist || []).includes(id);
}
export async function toggleWishlist(id) {
  await updateWallet(w => {
    w.wishlist = w.wishlist || [];
    const i = w.wishlist.indexOf(id);
    if (i >= 0) w.wishlist.splice(i, 1);
    else w.wishlist.push(id);
  });
}
export async function reorderWishlist(newIds) {
  await updateWallet(w => { w.wishlist = newIds.filter(Boolean); });
}

// ---- momentum: avg ₹ earned per 7-day window, over last N weeks ----
export function computeMomentum(weeks = 4) {
  const now = Date.now();
  const cutoff = now - weeks * 7 * 86400000;
  const ledger = state.wallet.ledger || [];
  let total = 0;
  for (const e of ledger) {
    if (!e.date || e.amount <= 0) continue;
    const t = new Date(e.date).getTime();
    if (!isNaN(t) && t >= cutoff) total += e.amount;
  }
  return Math.round(total / weeks);  // per-week average
}
// Daily buckets for sparkline (last 7 days of positive earn events)
export function earningsLast7Days() {
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const ledger = state.wallet.ledger || [];
  for (const e of ledger) {
    if (!e.date || e.amount <= 0) continue;
    const t = new Date(e.date);
    const diffDays = Math.floor((t - start) / 86400000);
    if (diffDays >= 0 && diffDays < 7) buckets[diffDays] += e.amount;
  }
  return buckets;
}
export async function addReward(reward) {
  state.rewards.catalog.push({ ...reward, id: reward.id || "r-" + Date.now() });
  emit("rewards"); schedule("rewards", persistRewards);
}
export async function updateReward(id, patch) {
  const r = state.rewards.catalog.find(x => x.id === id);
  if (!r) return;
  Object.assign(r, patch);
  emit("rewards"); schedule("rewards", persistRewards);
}
export async function removeReward(id) {
  state.rewards.catalog = state.rewards.catalog.filter(x => x.id !== id);
  emit("rewards"); schedule("rewards", persistRewards);
}

// -------------------------------------------------------------
// BACKUP: export every piece of user-generated state as a single
// JSON object. Sheet row text (Problem/Pattern/etc.) is NOT included —
// those come back from the CSVs on reinstall. Only per-row progress
// (Status/DateDone/Confidence/Notes/Solution), keyed by Seq, is saved.
// -------------------------------------------------------------
const BACKUP_SCHEMA = 2;
const BACKUP_APP_ID = "com.vikas.gain";
// Schema 2 adds KeyIdea; also captures full row snapshots so ad-hoc added
// rows (new Seq numbers) survive a reinstall. Older v1 files still restore.
const BACKUP_PROGRESS_FIELDS = ["Status", "DateDone", "DateSolved", "Confidence", "Notes", "KeyIdea", "Solution"];

export function exportBackup() {
  const sheetEdits = {};
  for (const [name, sh] of Object.entries(state.sheets)) {
    const seqCol = sh.headers.find(h => /^seq$/i.test(h));
    if (!seqCol) continue;
    const progress = [];
    for (const r of sh.rows) {
      const entry = { Seq: r[seqCol] };
      let changed = false;
      for (const key of BACKUP_PROGRESS_FIELDS) {
        const col = sh.headers.find(h => h.toLowerCase() === key.toLowerCase());
        if (col && r[col] != null && String(r[col]).trim() !== "") {
          entry[key] = r[col];
          changed = true;
        }
      }
      if (changed) progress.push(entry);
    }
    // v2: snapshot headers + full rows so new-Seq rows (ad-hoc additions)
    // can be recreated on a fresh install where the bundled CSV lacks them.
    // Shallow copies so later state changes don't mutate the backup.
    const headers = sh.headers.slice();
    const rows = sh.rows.map(r => ({ ...r }));
    if (progress.length || rows.length) {
      sheetEdits[name] = { file: sh.file, headers, rows, progress };
    }
  }

  return {
    schemaVersion: BACKUP_SCHEMA,
    appId: BACKUP_APP_ID,
    exportedAt: new Date().toISOString(),
    counts: {
      sheets: Object.keys(sheetEdits).length,
      rowEdits: Object.values(sheetEdits).reduce((a, s) => a + s.progress.length, 0),
      ledger: (state.wallet.ledger || []).length,
      dayLogDays: Object.keys(state.dayLog).length,
      rewards: state.rewards.catalog.length,
      wishlist: (state.wallet.wishlist || []).length,
      userMotivations: (state.motivations.user || []).length,
      userShopQuotes: (state.shopQuotes.user || []).length
    },
    settings:   state.settings,
    wallet:     state.wallet,
    dayLog:     state.dayLog,
    rewards:    state.rewards,
    motivations:{ user: state.motivations.user || [] },
    shopQuotes: { user: state.shopQuotes.user || [] },
    weeklyPlan: state.weeklyPlan || null,
    solutions:  state.solutions || {},
    sheetEdits
  };
}

// Apply a backup JSON object to current state. Overwrites everything.
export async function importBackup(data) {
  if (!data || typeof data !== "object") throw new Error("Not a valid backup file.");
  if (data.appId !== BACKUP_APP_ID) throw new Error("This file isn't a GAIN backup.");
  if (data.schemaVersion && data.schemaVersion > BACKUP_SCHEMA) {
    throw new Error(`Backup is from a newer app version (schema ${data.schemaVersion}). Upgrade the app first.`);
  }

  // Replace in-memory state wholesale (merged against defaults so new fields survive)
  if (data.settings)   state.settings   = { ...DEFAULT_SETTINGS, ...data.settings };
  if (data.wallet)     state.wallet     = { ...DEFAULT_WALLET, ...data.wallet };
  if (data.dayLog)     state.dayLog     = data.dayLog || {};
  if (data.rewards && Array.isArray(data.rewards.catalog)) {
    state.rewards = data.rewards;
  }
  if (Array.isArray(data.motivations?.user)) state.motivations.user = data.motivations.user;
  if (Array.isArray(data.shopQuotes?.user))  state.shopQuotes.user  = data.shopQuotes.user;
  if (data.weeklyPlan !== undefined)         state.weeklyPlan = data.weeklyPlan;
  if (data.solutions && typeof data.solutions === "object") state.solutions = data.solutions;

  // Apply per-row sheet progress. v2 backups include full `rows`; v1 only `progress`.
  // v2 path upserts by Seq (recreating ad-hoc rows that the fresh CSV lacks).
  const result = { sheetsApplied: 0, rowsApplied: 0, rowsAdded: 0, rowsMissing: 0, sheetsMissing: [] };
  if (data.sheetEdits && typeof data.sheetEdits === "object") {
    for (const [name, se] of Object.entries(data.sheetEdits)) {
      const sheet = state.sheets[name];
      if (!sheet || !sheet.rows.length) {
        result.sheetsMissing.push(name);
        continue;
      }
      const seqCol = sheet.headers.find(h => /^seq$/i.test(h));
      if (!seqCol) { result.sheetsMissing.push(name); continue; }
      const bySeq = new Map(sheet.rows.map((r, i) => [String(r[seqCol]), i]));

      // v2 path: full-row upsert (recreates ad-hoc rows the fresh CSV lacks).
      if (Array.isArray(se.rows) && se.rows.length) {
        for (const backedRow of se.rows) {
          const seq = backedRow[seqCol];
          if (seq == null || seq === "") continue;
          const existingIdx = bySeq.get(String(seq));
          if (existingIdx != null) {
            // Row exists — overlay only the user-editable progress fields.
            // Preserve the CSV's curated columns (title, pattern, difficulty, etc.).
            for (const key of BACKUP_PROGRESS_FIELDS) {
              if (backedRow[key] == null || String(backedRow[key]).trim() === "") continue;
              const col = sheet.headers.find(h => h.toLowerCase() === key.toLowerCase());
              if (col) sheet.rows[existingIdx][col] = backedRow[key];
            }
            result.rowsApplied++;
          } else {
            // Row is missing from the fresh CSV — recreate it in full.
            const newRow = {};
            for (const h of sheet.headers) {
              newRow[h] = backedRow[h] != null ? backedRow[h] : "";
            }
            sheet.rows.push(newRow);
            bySeq.set(String(seq), sheet.rows.length - 1);
            result.rowsAdded++;
          }
        }
      } else {
        // v1 fallback — Seq-keyed progress overlay only.
        for (const entry of se.progress || []) {
          const idx = bySeq.get(String(entry.Seq));
          if (idx == null) { result.rowsMissing++; continue; }
          for (const key of BACKUP_PROGRESS_FIELDS) {
            if (entry[key] == null) continue;
            const col = sheet.headers.find(h => h.toLowerCase() === key.toLowerCase());
            if (col) sheet.rows[idx][col] = entry[key];
          }
          result.rowsApplied++;
        }
      }
      await persistSheet(name);
      result.sheetsApplied++;
    }
  }

  // Persist every other store to disk
  await persistSettings();
  await persistWallet();
  await persistDayLog();
  await persistRewards();
  await persistMotivations();
  await persistShopQuotes();
  await persistWeeklyPlan();
  await persistSolutions();

  // Broadcast so every view repaints
  emit("boot");
  emit("settings"); emit("wallet"); emit("dayLog"); emit("rewards"); emit("sheet"); emit("motivations"); emit("shopQuotes"); emit("solutions"); emit("weeklyPlan");
  return result;
}

// Wipe the entire catalog. Wishlist is cleared too since the referenced items are gone.
export async function clearRewardsCatalog() {
  state.rewards.catalog = [];
  state.wallet.wishlist = [];
  emit("rewards"); emit("wallet");
  schedule("rewards", persistRewards);
  schedule("wallet",  persistWallet);
}
async function persistRewards() {
  await writeFile("rewards.json", JSON.stringify(state.rewards, null, 2));
}

// Bulk import a rewards catalog from CSV text. Expected columns (header-driven):
//   id, name, category, tier, price_inr, store, product_url, image_url, notes
// Returns { added, updated, skipped }.
// - Dedupe is by id; existing ids get fields merged (price/image/url/notes/store/category/title/tier).
// - Rows missing name or price are skipped.
// - image_url that doesn't start with http(s): is resolved against data/reward-images/<file>.
export async function importRewardsFromCsv(text, { replace = false } = {}) {
  const { headers, rows } = parseCSV(text);
  // Case-insensitive header lookup
  const hmap = {};
  for (const h of headers) hmap[h.toLowerCase().trim()] = h;
  const pick = (row, ...keys) => {
    for (const k of keys) {
      const h = hmap[k.toLowerCase()];
      if (h && row[h] != null && String(row[h]).trim() !== "") return String(row[h]).trim();
    }
    return "";
  };

  if (replace) state.rewards.catalog = [];
  const existing = new Map(state.rewards.catalog.map(r => [r.id, r]));
  let added = 0, updated = 0, skipped = 0;

  for (const row of rows) {
    const id    = pick(row, "id");
    const name  = pick(row, "name", "title");
    const price = Number(pick(row, "price_inr", "price")) || 0;
    const tier  = (pick(row, "tier") || "custom").toLowerCase();
    const category   = pick(row, "category");
    const store      = pick(row, "store");
    const productUrl = pick(row, "product_url", "productUrl", "url", "link");
    const notes      = pick(row, "notes");
    let imageUrl     = pick(row, "image_url", "imageUrl", "image");
    const type       = normalizeType(pick(row, "type", "class", "kind"), category, name);
    const emoji      = pick(row, "emoji") || _TYPE_INDEX.get(type)?.emoji || tierEmoji(tier, category);

    if (!name || price <= 0) { skipped++; continue; }
    if (imageUrl && !/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith("data:")) {
      imageUrl = `data/reward-images/${imageUrl}`;
    }
    const rid = id || `rw-${slug(name)}-${price}`;

    const payload = { id: rid, title: name, price, tier, type, category, store, productUrl, notes, imageUrl, emoji };
    if (existing.has(rid)) {
      Object.assign(existing.get(rid), payload);
      updated++;
    } else {
      state.rewards.catalog.push(payload);
      existing.set(rid, payload);
      added++;
    }
  }

  emit("rewards"); schedule("rewards", persistRewards);
  return { added, updated, skipped };
}

function tierEmoji(tier, category) {
  const c = (category || "").toLowerCase();
  if (c.includes("food"))        return "🍜";
  if (c.includes("shoe"))        return "👟";
  if (c.includes("apparel"))     return "👕";
  if (c.includes("electronics")) return "🎧";
  if (c.includes("accessory"))   return "✨";
  if (c.includes("bag"))         return "🎒";
  if (c.includes("experience") || c.includes("trip")) return "✈️";
  if (tier === "small")  return "🪙";
  if (tier === "medium") return "💎";
  if (tier === "large")  return "👑";
  if (tier === "mega")   return "🌟";
  return "🎁";
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item";
}

// ---- quotes ----
export function getEarnQuote() {
  const bank = state.quotes.earn.length ? state.quotes.earn : DEFAULT_EARN_QUOTES;
  return bank[Math.floor(Math.random() * bank.length)];
}
export function getSpendQuote() {
  const bank = state.quotes.spend.length ? state.quotes.spend : DEFAULT_SPEND_QUOTES;
  return bank[Math.floor(Math.random() * bank.length)];
}
async function persistQuotes() {
  await writeFile("earn_quotes.json", JSON.stringify(state.quotes.earn, null, 2));
  await writeFile("spend_quotes.json", JSON.stringify(state.quotes.spend, null, 2));
}

const DEFAULT_EARN_QUOTES = [
  "Earned is earned. Nothing you banked today can ever be taken from you.",
  "That's the chain. Don't break it tomorrow.",
  "One day closer. Rest, then come back hungry.",
  "This is what showing up looks like. Keep showing up.",
  "You traded 90 minutes for a sharper future-you. Fair trade.",
  "Receipts don't lie. The sheet is the proof.",
  "Discipline paid. Enjoy it. Then earn tomorrow's.",
  "That ₹ is a tiny monument to the problem you refused to skip.",
  "Done is a feeling. Earn it twice tomorrow.",
  "Future-you just sent a thank-you note."
];

const DEFAULT_SPEND_QUOTES = [
  "Earned is earned. Enjoy it. Get back to work.",
  "You bought this with reps. Spend it with no guilt — then grind.",
  "Reward collected. Hunger reset. Back to the sheet.",
  "This isn't a treat. It's a receipt. Keep writing them.",
  "Spend. Smile. Return.",
  "Taste the win for 10 minutes. Then open the next problem.",
  "Rewards are fuel. Don't idle.",
  "This is the deal: you earn, you spend, you keep going."
];

export async function removeSheet(name) {
  await updateSettings(s => { s.sheets = s.sheets.filter(x => x.name !== name); });
  delete state.sheets[name];
  emit("sheet:remove", name);
}

// --------- secure keyring passthrough ---------
// Session memory cache. Reasons it exists:
//  1) Unsigned Tauri dev builds sometimes fail silently on keychain set/get on macOS
//  2) Even when keyring works, it's a round-trip IPC call — the cache is instant
// The cache is NEVER persisted. Keyring remains the source of truth across restarts.
const _sessionSecrets = {};

export const secure = {
  async set(key, value) {
    _sessionSecrets[key] = value;
    try { await invoke("secure_set", { key, value }); } catch (e) { console.warn("secure_set failed, using session cache", e); }
  },
  async get(key) {
    if (_sessionSecrets[key] != null) return _sessionSecrets[key];
    try {
      const v = await invoke("secure_get", { key });
      if (v) _sessionSecrets[key] = v;
      return v;
    } catch (e) {
      console.warn("secure_get failed", e);
      return null;
    }
  },
  async delete(key) {
    delete _sessionSecrets[key];
    try { await invoke("secure_delete", { key }); } catch (e) { console.warn("secure_delete failed", e); }
  }
};

// --------- Groq (butler) proxy passthrough ---------
// Reads the key from the macOS Keychain (prefer new "groq_api_key", fall back to legacy "grok_api_key").
export async function callGrok({ system, user, apiKey, model, temperature, jsonMode, maxTokens }) {
  const key = apiKey ?? (await secure.get("groq_api_key")) ?? (await secure.get("grok_api_key"));
  return invoke("call_grok", {
    req: {
      api_key: key || "",
      model: model || state.settings.grok.model,
      temperature: temperature ?? state.settings.grok.temperature,
      system: system || state.settings.grok.masterPrompt,
      user: user || "",
      json_mode: !!jsonMode,
      max_tokens: maxTokens ?? null
    }
  });
}

// SerpAPI proxy — routes through Rust because serpapi.com doesn't send CORS headers.
// `engine` must be "google_images" or "youtube" (Rust validates).
export async function serpSearch({ engine, query, apiKey }) {
  const key = apiKey ?? (await secure.get("serpapi_key"));
  return invoke("serp_search", {
    req: {
      api_key: key || "",
      engine,
      query
    }
  });
}

// YouTube Data API v3 proxy — guarantees `videoEmbeddable=true` so the
// uploader-disabled-embed error is structurally impossible.
export async function youtubeSearch({ query, apiKey, maxResults = 5 }) {
  const key = apiKey ?? (await secure.get("youtube_api_key"));
  return invoke("youtube_search", {
    req: {
      api_key: key || "",
      query,
      max_results: maxResults
    }
  });
}

// Apply a weekly plan — writes each day's tasks into dayLog.assigned so Today picks them up.
// Also stores the raw plan as weekly_plan.json so the Week view can rehydrate exactly what was saved.
// Expects shape: { days: [{ date: "YYYY-MM-DD", day, theme, tasks: [{ref, title, kind, minutes, value, sheet, seq}] }] }
// Overwrites existing dayLog entries for those dates ONLY if they haven't been ticked yet.
export async function applyWeeklyPlan(plan, { overwrite = false } = {}) {
  if (!plan || !Array.isArray(plan.days)) throw new Error("Plan has no days array");
  const result = { applied: 0, skipped: 0, skippedDates: [] };
  for (const d of plan.days) {
    const dateKey = d.date;
    if (!dateKey) continue;
    const existing = state.dayLog[dateKey];
    if (!overwrite && existing && existing.done && existing.done.length > 0) {
      result.skipped++;
      result.skippedDates.push(dateKey);
      continue;
    }
    const tasks = (d.tasks || []).map((t, i) => {
      // Resolve the sheet row index so Today ticks propagate Status → sheet → Progress.
      // Prefer the explicit seq, then try to parse it out of the ref ("DSA#86" → 86),
      // then fall back to a case-insensitive title match within the sheet.
      let rowIndex = null;
      const sheetName = t.sheet || null;
      if (sheetName && state.sheets[sheetName]) {
        const sh = state.sheets[sheetName];
        const seqCol = sh.headers.find(h => /^seq$/i.test(h));
        const titleCol = sh.headers.find(h => /^(problem|topic|skill(\s*or\s*platform)?|item|name)$/i.test(h.replace(/\s+/g, " ").trim()));
        let seq = t.seq;
        if (seq == null && typeof t.ref === "string") {
          const m = t.ref.match(/#(\d+)$/);
          if (m) seq = Number(m[1]);
        }
        if (seqCol && seq != null) {
          const idx = sh.rows.findIndex(r => String(r[seqCol]) === String(seq));
          if (idx >= 0) rowIndex = idx;
        }
        if (rowIndex == null && titleCol && t.title) {
          const needle = String(t.title).trim().toLowerCase();
          const idx = sh.rows.findIndex(r => String(r[titleCol] || "").trim().toLowerCase() === needle);
          if (idx >= 0) rowIndex = idx;
        }
      }
      return {
        ref: t.ref || `WK-${dateKey}#${i + 1}`,
        kind: t.kind || "dsa",
        title: t.title || `Task ${i + 1}`,
        pattern: t.pattern || d.theme || "",
        difficulty: t.difficulty || "",
        freq: t.freq || "",
        minutes: Number(t.minutes) || 25,
        value: Number(t.value) || 20,
        sheet: sheetName,
        rowIndex,
        seq: t.seq ?? null
      };
    });
    state.dayLog[dateKey] = {
      assigned: tasks,
      done: [],
      values: Object.fromEntries(tasks.map(t => [t.ref, t.value])),
      green: false,
      dayEarned: 0,
      weeklyPlan: { title: plan.title || "", theme: d.theme || "" }
    };
    result.applied++;
  }

  // Save the raw plan separately as the week-view's source of truth
  state.weeklyPlan = {
    ...plan,
    savedAt: new Date().toISOString()
  };

  // Immediate persist — no debouncing. Plan survives app close / navigate-away.
  await persistDayLog();
  await persistWeeklyPlan();
  emit("dayLog");
  emit("weeklyPlan");
  return result;
}

async function persistWeeklyPlan() {
  await writeFile("weekly_plan.json", JSON.stringify(state.weeklyPlan || null, null, 2));
}

export function getWeeklyPlan() { return state.weeklyPlan || null; }

// ---- Problem-page solutions (stored outside the CSV so headers aren't mutated) ----
export function getSolution(sheetName, rowIndex) {
  return state.solutions[`${sheetName}#${rowIndex}`] || "";
}
export async function setSolution(sheetName, rowIndex, text) {
  const key = `${sheetName}#${rowIndex}`;
  if (text) state.solutions[key] = text;
  else delete state.solutions[key];
  emit("solutions");
  schedule("solutions", persistSolutions);
}
async function persistRecreations() {
  await writeFile("recreations.json", JSON.stringify(state.recreations, null, 2));
}
async function persistCollections() {
  await writeFile("collections.json", JSON.stringify(state.collections, null, 2));
}

// ---- Collections CRUD ----
export function getCollections() { return state.collections; }

export async function addCollection(col) {
  const id = "col_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  state.collections.push({
    id,
    name: String(col.name || "Untitled").trim(),
    accent: String(col.accent || "#c9a9ff").trim(),
    coverImage: String(col.coverImage || "").trim(),
    description: String(col.description || "").trim(),
    createdAt: Date.now(),
  });
  schedule("collections", persistCollections);
  emit("collections");
  return id;
}
export async function updateCollection(id, patch) {
  const c = state.collections.find(x => x.id === id);
  if (!c) return;
  Object.assign(c, patch);
  schedule("collections", persistCollections);
  emit("collections");
}
export async function deleteCollection(id) {
  state.collections = state.collections.filter(x => x.id !== id);
  // Sites in that collection lose their collectionId (go to Uncategorized)
  for (const r of state.recreations) if (r.collectionId === id) r.collectionId = "";
  schedule("collections", persistCollections);
  schedule("recreations", persistRecreations);
  emit("collections");
  emit("recreations");
}

// ---- Chill Hideout: CRUD on the escape-site list ----
export function getRecreations() { return state.recreations; }

export async function addRecreation(rec) {
  const id = "rec_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  state.recreations.push({
    id,
    url: String(rec.url || "").trim(),
    title: String(rec.title || "").trim(),
    category: String(rec.category || "web"),
    collectionId: String(rec.collectionId || "").trim(),
    note: String(rec.note || "").trim().slice(0, 120),
    emoji: String(rec.emoji || "").trim(),
    imageUrl: String(rec.imageUrl || "").trim(),
    coverImage: String(rec.coverImage || "").trim(),  // user-uploaded override
    browser: String(rec.browser || "").trim(),
    mood: String(rec.mood || "").trim(),       // "chill" | "laugh" | "focus" | "energize" | ""
    journal: [],                                 // [{at: ms, note: string}]
    visitStartedAt: 0,                           // ephemeral, set on open, cleared on journal save
    openedCount: 0,
    lastOpenedAt: 0,
    addedAt: now,
    pinned: false,
  });
  schedule("recreations", persistRecreations);
  emit("recreations");
  return id;
}

// Append a visit-journal entry to a recreation.
export async function addRecreationJournal(id, note) {
  const r = state.recreations.find(x => x.id === id);
  if (!r) return;
  r.journal = Array.isArray(r.journal) ? r.journal : [];
  r.journal.push({ at: Date.now(), note: String(note || "").trim().slice(0, 240) });
  r.visitStartedAt = 0;
  schedule("recreations", persistRecreations);
  emit("recreations");
}

// Mark a visit as "just opened" so the app can prompt for a journal entry when
// the user comes back to the window.
export async function markRecreationVisitStart(id) {
  const r = state.recreations.find(x => x.id === id);
  if (!r) return;
  r.visitStartedAt = Date.now();
  schedule("recreations", persistRecreations);
}

export async function updateRecreation(id, patch) {
  const r = state.recreations.find(x => x.id === id);
  if (!r) return;
  Object.assign(r, patch);
  schedule("recreations", persistRecreations);
  emit("recreations");
}

export async function deleteRecreation(id) {
  state.recreations = state.recreations.filter(x => x.id !== id);
  schedule("recreations", persistRecreations);
  emit("recreations");
}

export async function bumpRecreationOpened(id) {
  const r = state.recreations.find(x => x.id === id);
  if (!r) return;
  r.openedCount = (r.openedCount || 0) + 1;
  r.lastOpenedAt = Date.now();
  schedule("recreations", persistRecreations);
  emit("recreations");
}

// Open a recreation URL — per-site browser takes precedence over the global setting.
export async function openRecreation(rec) {
  const browser = (rec.browser && rec.browser.trim()) || state.settings.recreationBrowser || "";
  try {
    if (browser) await invoke("open_url_with", { url: rec.url, app: browser });
    else await invoke("open_url", { url: rec.url });
  } catch (e) { console.warn("open recreation failed", e); }
  await bumpRecreationOpened(rec.id);
  await markRecreationVisitStart(rec.id);
}

// Fetch og:image + og:title for a URL via the Rust proxy. Returns {image_url, title, final_url}.
export async function fetchUrlPreview(url) {
  try {
    const raw = await invoke("fetch_url_preview", { url });
    const parsed = JSON.parse(raw);
    return {
      imageUrl: String(parsed.image_url || ""),
      title: String(parsed.title || ""),
      finalUrl: String(parsed.final_url || url),
    };
  } catch (e) {
    console.warn("fetch_url_preview failed", e);
    return { imageUrl: "", title: "", finalUrl: url };
  }
}

// ======================================================================
// BULLETPROOF BACKUP / RESTORE
// ======================================================================
// Format: a single JSON file with a version, timestamp, payload, and SHA-256
// checksum of the payload. Import validates every piece BEFORE touching any
// state, writes a pre-import snapshot to backups/, applies in memory, then
// persists everything. If any step fails, we restore from the snapshot and
// surface a readable error.

const BACKUP_FORMAT_ID = "gain-backup";
const BACKUP_FORMAT_VERSION = 1;

// Collect every piece of state worth preserving.
function collectBackupPayload() {
  // Walk localStorage for all keys this app writes under the "gain:" prefix
  // (lesson cache, lessonImg cache, warmup, lessonState, weeklyReport, etc.)
  const localCache = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("gain:")) continue;
      try { localCache[k] = localStorage.getItem(k); } catch (_) {}
    }
  } catch (_) {}

  const sheets = {};
  for (const [name, sh] of Object.entries(state.sheets || {})) {
    if (!sh) continue;
    sheets[name] = {
      file: sh.file,
      type: sh.type,
      headers: sh.headers || [],
      rows: sh.rows || [],
      columnMap: sh.columnMap || {},
    };
  }

  return {
    settings: state.settings,
    wallet: state.wallet,
    dayLog: state.dayLog,
    solutions: state.solutions,
    motivations: state.motivations,
    shopQuotes: state.shopQuotes,
    rewards: state.rewards,
    weeklyPlan: state.weeklyPlan,
    recreations: state.recreations,
    collections: state.collections,
    sheets,
    localCache,
  };
}

// Deterministic JSON stringify so the checksum is reproducible across machines.
function stableStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

async function sha256(text) {
  // Browser crypto.subtle, available in Tauri's webview.
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Build a complete backup blob (string). Includes checksum.
export async function exportFullBackup() {
  const payload = collectBackupPayload();
  const payloadStr = stableStringify(payload);
  const checksum = await sha256(payloadStr);
  const bundle = {
    format: BACKUP_FORMAT_ID,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: "0.2",
    checksum,
    stats: {
      sheets: Object.keys(payload.sheets).length,
      sheetRows: Object.values(payload.sheets).reduce((a, s) => a + (s.rows?.length || 0), 0),
      dayLogEntries: Object.keys(payload.dayLog || {}).length,
      walletEarned: payload.wallet?.earned || 0,
      ledgerEntries: (payload.wallet?.ledger || []).length,
      solutions: Object.keys(payload.solutions || {}).length,
      lessonCaches: Object.keys(payload.localCache || {}).filter(k => k.startsWith("gain:lesson")).length,
    },
    payload,
  };
  return JSON.stringify(bundle, null, 2);
}

// Validate a backup bundle string. Returns { ok, bundle, errors[] } without
// touching state. Also recomputes + verifies the checksum.
export async function validateFullBackup(text) {
  const errors = [];
  let bundle;
  try { bundle = JSON.parse(text); }
  catch (e) { return { ok: false, errors: [`invalid JSON: ${e.message}`] }; }
  if (bundle?.format !== BACKUP_FORMAT_ID) errors.push("file is not a GAIN backup");
  if (!Number.isInteger(bundle?.version)) errors.push("missing format version");
  if (bundle?.version > BACKUP_FORMAT_VERSION) errors.push(`backup version ${bundle.version} newer than this app (${BACKUP_FORMAT_VERSION}) — update GAIN first`);
  if (!bundle?.payload || typeof bundle.payload !== "object") errors.push("missing payload");
  if (!bundle?.checksum) errors.push("missing checksum");
  if (errors.length) return { ok: false, bundle, errors };

  // Verify checksum
  const recomputed = await sha256(stableStringify(bundle.payload));
  if (recomputed !== bundle.checksum) {
    errors.push("checksum mismatch — file is corrupt or was edited by hand");
    return { ok: false, bundle, errors };
  }

  // Light structural checks
  const p = bundle.payload;
  if (!p.settings || !p.wallet || !p.dayLog) errors.push("payload missing core sections (settings/wallet/dayLog)");

  return { ok: errors.length === 0, bundle, errors };
}

// Apply a validated backup to the app atomically. First writes a pre-import
// snapshot of the CURRENT state to backups/pre-import-{ts}.json so the user
// can roll back manually if they regret it. Then overwrites in-memory +
// persists every slice. On any failure, attempts to restore from the snapshot.
export async function importFullBackup(bundle) {
  if (!bundle || bundle.format !== BACKUP_FORMAT_ID) throw new Error("not a valid GAIN backup");
  const p = bundle.payload;
  if (!p) throw new Error("missing payload");

  // 1. Snapshot the current state to backups/ (uses the Rust writeFile → data_dir)
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = `backups/pre-import-${stamp}.json`;
  let snapshot = null;
  try {
    snapshot = await exportFullBackup();
    await writeFile(snapshotPath, snapshot, false);  // no auto-backup of a snapshot
  } catch (e) {
    throw new Error(`couldn't write safety snapshot before import: ${e.message || e}. Import aborted.`);
  }

  // 2. Capture old in-memory state so we can roll back on error
  const rollback = {
    settings: structuredClone(state.settings),
    wallet: structuredClone(state.wallet),
    dayLog: structuredClone(state.dayLog),
    solutions: structuredClone(state.solutions),
    motivations: structuredClone(state.motivations),
    shopQuotes: structuredClone(state.shopQuotes),
    rewards: structuredClone(state.rewards),
    weeklyPlan: state.weeklyPlan ? structuredClone(state.weeklyPlan) : null,
    recreations: structuredClone(state.recreations),
    collections: structuredClone(state.collections),
    sheets: structuredClone(state.sheets),
  };

  // Capture localStorage keys for rollback
  const rollbackLS = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("gain:")) rollbackLS[k] = localStorage.getItem(k);
    }
  } catch (_) {}

  try {
    // 3. Overwrite in memory
    if (p.settings)    state.settings    = { ...DEFAULT_SETTINGS, ...p.settings };
    if (p.wallet)      state.wallet      = { ...DEFAULT_WALLET,   ...p.wallet };
    if (p.dayLog)      state.dayLog      = p.dayLog;
    if (p.solutions)   state.solutions   = p.solutions;
    if (p.motivations) state.motivations = p.motivations;
    if (p.shopQuotes)  state.shopQuotes  = p.shopQuotes;
    if (p.rewards)     state.rewards     = p.rewards;
    if (p.weeklyPlan)  state.weeklyPlan  = p.weeklyPlan;
    if (p.recreations) state.recreations = p.recreations;
    if (p.collections) state.collections = p.collections;
    if (p.sheets && typeof p.sheets === "object") state.sheets = p.sheets;

    // 4. localStorage: clear existing gain:* keys, then write from backup
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("gain:")) toRemove.push(k);
    }
    for (const k of toRemove) { try { localStorage.removeItem(k); } catch (_) {} }
    for (const [k, v] of Object.entries(p.localCache || {})) {
      try { localStorage.setItem(k, v); } catch (_) {}
    }

    // 5. Persist all slices to disk
    await persistSettings();
    await persistWallet();
    await persistDayLog();
    await persistSolutions();
    await persistRecreations();
    await persistCollections();
    try { await persistMotivations(); } catch (e) { console.warn("persistMotivations failed", e); }
    try { await persistShopQuotes();  } catch (e) { console.warn("persistShopQuotes failed", e); }
    try { await persistRewards();     } catch (e) { console.warn("persistRewards failed", e); }
    if (state.weeklyPlan) try { await persistWeeklyPlan(); } catch (e) { console.warn("persistWeeklyPlan failed", e); }
    // Sheets — each one serializes back to CSV
    for (const name of Object.keys(state.sheets || {})) {
      try { await persistSheet(name); } catch (e) { console.warn(`persistSheet(${name}) failed`, e); }
    }

    // 6. Notify every subscriber
    emit("settings"); emit("wallet"); emit("dayLog"); emit("sheet");
    emit("recreations"); emit("collections");

    return {
      ok: true,
      snapshotPath,
      stats: bundle.stats || {},
    };
  } catch (e) {
    // Attempt rollback
    try {
      state.settings    = rollback.settings;
      state.wallet      = rollback.wallet;
      state.dayLog      = rollback.dayLog;
      state.solutions   = rollback.solutions;
      state.motivations = rollback.motivations;
      state.shopQuotes  = rollback.shopQuotes;
      state.rewards     = rollback.rewards;
      state.weeklyPlan  = rollback.weeklyPlan;
      state.recreations = rollback.recreations;
      state.collections = rollback.collections;
      state.sheets      = rollback.sheets;
      // Restore localStorage
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("gain:")) try { localStorage.removeItem(k); } catch (_) {}
      }
      for (const [k, v] of Object.entries(rollbackLS)) {
        try { localStorage.setItem(k, v); } catch (_) {}
      }
      emit("settings"); emit("wallet"); emit("dayLog"); emit("sheet");
    } catch (rbErr) {
      console.error("Rollback itself failed", rbErr);
    }
    throw new Error(`import failed: ${e.message || e}. State was rolled back. Safety snapshot still at ${snapshotPath}.`);
  }
}

async function persistSolutions() {
  await writeFile("solutions.json", JSON.stringify(state.solutions, null, 2));
}

window.__GAIN__ = {
  state, getSettings, getSheet, getSheets, getWallet, getDayLog,
  updateSettings, updateWallet, updateDayLog, updateSheetRow,
  addSheet, removeSheet, callGrok, serpSearch, youtubeSearch, secure, boot,
  getRecreations, addRecreation, updateRecreation, deleteRecreation, bumpRecreationOpened, openRecreation, fetchUrlPreview, addRecreationJournal, markRecreationVisitStart,
  getCollections, addCollection, updateCollection, deleteCollection,
  exportFullBackup, validateFullBackup, importFullBackup,
  getMotivations, getMotivationCounts, addMotivations, clearUserMotivations,
  getShopQuotes, getShopQuoteCounts, getShopQuote, addShopQuotes, clearUserShopQuotes,
  getRewards, addReward, updateReward, removeReward,
  getWishlist, isWishlisted, toggleWishlist, reorderWishlist,
  computeMomentum, earningsLast7Days,
  getEarnQuote, getSpendQuote
};
