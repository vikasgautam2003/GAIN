# GAIN

**A gamified, Jianghu-styled interview-prep OS for FDE / SaaS engineering roles.**
Built as a native macOS desktop app with Tauri + vanilla JS. One codebase, no bundler, zero cruft — every tick, every rating, every ₹ you bank is written to disk.

> *Discipline builds freedom.*

---

## What it does

GAIN turns FDE interview prep into a daily rhythm you actually keep.

- **Today's plan** — a hand-picked set of DSA / System Design / Integrations / Interview Extras / SQL problems for the day. Weekday themes, weekend review, spaced repetition, never more than N you can finish.
- **Confidence stars** — every solve ends with a required 1–5 rating. That signal drives the entire learning loop.
- **Spaced repetition (`↻ REDO`)** — low-confidence solves auto-reappear 1 / 3 / 7 days later. There's always at least one REDO on your plan — if nothing's technically due, the weakest confidence row gets promoted.
- **Pattern-aware weekly plans** — a Groq-generated weekly theme ("Hashing & Estimation", "Sliding Window & DP") biases Today's picks toward one pattern at a time.
- **The honest butler** — a GPT-oss-120B / Llama-3.3-70B butler on every page via Groq. Ask it to re-plan your week, grade your pace, explain a problem.
- **Shop + wishlist** — your ₹ earned becomes real-world rewards you've pre-committed to. One-button Add a reward / Append CSV / Replace catalog hub.
- **Library** — all sheets, inline edit, one `+ Add` button that opens a picker: Row / Append / Replace / New sheet from CSV with column-role mapping.
- **Progress + Calendar + Dashboard** — pace, burn-up, pattern heatmap, 365-day chain (red = missed, green = solved), ETA honest take.
- **7 PM IST GAIN day** — your "day" rolls over at 19:00 IST, not local midnight. Finish before then or the day isn't banked. Live countdown + at-risk banner + OS notification when < 2h left and tasks undone.
- **Backup / restore** — Full-fidelity v2 JSON export: dayLog, wallet ledger, settings, solutions, weekly plan, user motivation lines, and complete sheet row snapshots so ad-hoc added rows survive a reinstall. Backward-compatible with v1.
- **Dark mode** — Jianghu black palette with gold accents. System / Light / Dark.

---

## Features (full list)

### The study loop
- **Confidence stars inline** on every tick — required, keyboard 1-5 or click, with gold hover + per-rating badge display.
- **Spaced-repetition queue** — SM-ish schedule (`★1→1d, ★2→3d, ★3→7d, ★4/5→skip`). Guaranteed one REDO per day.
- **NEW / REDO pills** — green `✦ NEW` for fresh problems, red `↻ REDO` for revisits. Instant visual recognition.
- **Undo last tick** — one button on the next-day banner reverses the most recently banked task + refunds coins + clears the confidence rating.
- **Row-wide click target** — tap anywhere on a row to tick, not just the checkbox.
- **★5 confetti** — a seven-particle gold sparkle burst on perfect mastery.
- **Problem page** — solve pad with autosave to a dedicated solutions store, confidence dots that honor spaced-repetition schedule, Reset / 25 / 45 / 60 min focus timers.

### Today's rhythm
- **7 PM IST countdown chip** with calm → warn → urgent color escalation.
- **Streak-at-risk banner** at < 2h with "Focus next task →" shortcut.
- **Working-ahead banner** when today's plan is already done — auto-advances to tomorrow's queue with a countdown back to 7 PM.
- **OS notifications** at the critical window (< 2h, tasks undone, debounced per 60 min).

### Library
- **Unified `+ Add` hub** — one button opens a 4-card picker: Add a row / Append rows from CSV file or paste / Replace sheet rows (danger-confirmed) / Create new sheet with column-role mapping.
- **Quick-filter chips** — All / Unsolved / Solved / Low confidence / Solved today / Needs review. One click, no dropdown.
- **Inline edit** every cell, every keystroke syncs to disk.
- **Column visibility toggles** — hide noise.

### Shop
- **One `+ Add` hub** — Add a single reward form / Append CSV / Replace catalog (danger-confirmed).
- **Wishlist with sidebar badge** — star what you want, wishlist count in the left nav.
- **Tier gating** — Small / Medium / Large / Mega / Custom, each unlocks at an earned threshold.

### Daily plan / weekly plan
- Weekly plan with Grok-generated theme + 5 picks.
- Add-a-task menu: fast-path input or expanded config (kind, minutes, bounty, pre-mark done).
- Ad-hoc tasks auto-link to the matching sheet row (DSA / System Design / Integrations / Interview Extras / SQL) so Pace counts them.
- Day log entry stores `confidence[ref] = 1-5` per solve.

### Progress / Calendar
- Real pace calculation (never dilutes under 1 week of data; "early signal" tag when < 7 days).
- Burn-up SVG with target line.
- "Likely to slip" top-4 weakest patterns.
- Pattern heatmap (fixed) + 365-day chain heatmap (red = missed, light-green → deep green progression).
- Streak + longest + green-days hero stats, correct across the 7-PM-IST boundary.

### Sidebar nav
- Live badges: Today (undone count, ✓ if done), Library (`448 · 112` total · solved), Shop (`♡ 3` wishlist).
- All computed from live state via a store subscription.

### Everything else
- **Backup v2** — Full sheet row snapshots so user-added rows survive reinstall. KeyIdea now preserved. Backward-compatible with v1 files.
- **Dark mode** — complete theme — tokens, inputs, modals, scrollbars.
- **Celebrations** — tsParticles fireworks + anime.js + Howler sound effects for Day / Week / Month green chains, scaled by magnitude.
- **Topbar wallet** — click the coin to open the Adjust-wallet modal (also under Settings).

---

## Tech

- **Tauri 2.x** — Rust shell, WebView2 frontend, custom `invoke` for file I/O.
- **Vanilla JS modules** — no bundler, no React, no build-time magic. Every file loads directly.
- **Groq API** — Llama 3.3 70B / 405B for the butler, weekly plan, honest take, warm-up quiz (phased).
- **CSS custom properties** — all theming on `:root` + `[data-theme="dark"]` override.
- **File-based state** — `~/Library/Application Support/com.vikas.gain/data/` holds everything as JSON + CSV. No DB, no sync, no cloud.

---

## Run it

```bash
cd gain
npm install
npm run tauri dev        # dev
npm run tauri build      # release .app + .dmg
```

Install path on macOS: `/Applications/GAIN.app`
Data: `~/Library/Application Support/com.vikas.gain/data/`

---

## File layout

```
gain/
├── src/
│   ├── index.html             # app shell + sidebar + topbar + bot
│   ├── css/
│   │   ├── tokens.css         # design tokens (light + dark palettes)
│   │   ├── app.css            # layout + sidebar nav badges
│   │   └── celebrate.css      # particle/sound overlays
│   ├── js/
│   │   ├── store.js           # state + persist + first-run import + backup v2
│   │   ├── engine.js          # today's plan + priceTask + streak/green + confidence + spaced-rep
│   │   ├── router.js          # hash routing + lifecycle
│   │   ├── app.js             # bootstrap + chrome + nav badges + rollover reminders
│   │   ├── today.js           # Today page — plan rows, stars, undo, risk banner, countdown
│   │   ├── problem.js         # Problem page — solution pad, confidence dots, related (phased)
│   │   ├── library.js         # All sheets — unified Add hub, quick-filter chips, inline edit
│   │   ├── shop.js            # Shop — unified Add hub, wishlist, claim flow
│   │   ├── progress.js        # Pace, ETA, burn-up, pattern heatmap, honest take
│   │   ├── calendar.js        # Month grid + 365-day heatmap (red/green)
│   │   ├── dashboard.js       # Daily rhythm overview
│   │   ├── week.js            # Weekly plan (Grok-generated theme)
│   │   ├── settings.js        # Appearance, profile, schedule, wallet, backup, reset
│   │   ├── celebrate.js       # Day / Week / Month celebration overlays
│   │   ├── theme.js           # Light/dark/system theme + prefers-color-scheme
│   │   ├── walletAdjust.js    # Shared "Adjust coins" modal (Settings + topbar coin)
│   │   ├── modals.js          # Reusable confirmDanger + openFormModal
│   │   ├── csv.js             # parseCSV + serializeCSV (handles quoted fields)
│   │   ├── motivations_bank.js
│   │   ├── shop_quotes.js
│   │   └── dropdown.js        # custom select look
│   └── vendor/                # tsparticles-fireworks, anime, howler, lottie
└── src-tauri/
    ├── src/lib.rs             # Rust: file I/O, first_run_import, Groq proxy with JSON mode
    ├── tauri.conf.json
    └── icons/
```

---

## State persistence

Everything lives on disk, written on every change (debounced where safe, immediate for critical paths):

| File | What |
|---|---|
| `settings.json` | profile, schedule, wallet config, sheets list, theme |
| `wallet.json` | earned, available, spent, ledger (every tick / untick / claim / adjust) |
| `dayLog.json` | per-date `{assigned, done, values, confidence, green, dayEarned, weeklyPlan}` |
| `solutions.json` | `{sheet#rowIndex → code}` — survives reinstall |
| `weekly_plan.json` | current week's theme + picks |
| `01_DSA_SHEET.csv` … `05_SQL_SHEET.csv` | sheet state (Status, DateSolved, Confidence, KeyIdea, Notes) |
| `rewards.json` | shop catalog + types |
| `motivations.json`, `shop_quotes.json`, `earn_quotes.json`, `spend_quotes.json` | banks |
| `backups/*.bak` | auto-snapshot every sheet write (safety net) |

---

## Design principles

1. **The sheet remembers everything.** Every tick writes to a CSV cell + a dayLog entry. Two sources of truth kept in sync via `backfillSheetFromDayLog` on boot.
2. **Required means required.** Confidence after tick isn't optional — it's the foundation for the SR schedule, pattern mastery, and the honest take.
3. **One button per intent.** `+ Add` opens a modal with a shape picker rather than three ambient buttons.
4. **The 7 PM boundary is sacred.** Not midnight. Gives one usable workday + evening window.
5. **No hidden state.** If it affects the day, it's visible in the countdown chip, the risk banner, or the plan rows.

---

## License

Personal use. Not open-sourced yet — ping [@vikasgautam2003](https://github.com/vikasgautam2003) if you want to adapt it for your own grind.
