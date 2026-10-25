// Settings — Part 2: Profile, AI/Grok, Motivation (incl. CSV upload). More in Part 4.
import {
  getSettings, updateSettings, secure, on,
  getMotivationCounts, addMotivations, clearUserMotivations,
  getShopQuoteCounts, addShopQuotes, clearUserShopQuotes,
  callGrok, resetAllProgress,
  exportBackup, importBackup,
  exportFullBackup, validateFullBackup, importFullBackup,
  getWallet, updateWallet
} from "./store.js";
import { parseCSV } from "./csv.js";
import { confirmDanger, openFormModal } from "./modals.js";
import { openWalletAdjustModal } from "./walletAdjust.js";
import { setTheme, getCurrentMode } from "./theme.js";

const MOT_PROMPT = `You are generating a bank of hard-tone discipline quotes for a Forward Deployed Engineer (FDE) interview-prep app called GAIN. The user is Vikas, a Rocketlane engineer targeting a 10 LPA+ SaaS-product FDE / Palantir-style FDE role within ~24 weeks of grinding DSA + System Design + Integrations prep.

VOICE: David Goggins. Direct. Uncomfortable. Aimed at the user's own discipline — never at other people. No corporate motivation. No TED-talk softness. No LinkedIn clichés. No religious framing. No political takes. No cruelty toward anyone else. The target of every sting is the reader's excuses, lies to themselves, comfort-seeking, and skipped reps.

GOAL: Push the user to show up, be honest with their sheet, stop skipping, keep the streak, and own their results. Specific to the context of grinding DSA/System Design/Integrations toward an interview deadline.

HARD CONSTRAINTS:
- Each line is 8–22 words. One sentence or two short clauses.
- No numbering. No bullets. No quotation marks around lines. One line per row, nothing else.
- No emojis. No hashtags. No headings.
- No clichés ("rise and grind", "no pain no gain", "hustle hard"). Fresh phrasing.
- Vary sentence structure heavily — don't start more than ~2 lines in a row with the same word.
- Vary length — mix short jabs (6–10 words) with longer cuts (15–22 words).
- No repeats; each line must stand alone and be memorable.

THEMES to cycle (don't label them, just rotate through naturally):
morning / show up · discipline over motivation · nobody is coming to save you · honesty with the sheet · time compounds · fear and comfort · own your results · interview-specific sting · FDE / Palantir / Java specifics · the long path · consistency · counter the slide after missing a day · the hard questions · after a win · after a loss / stuck · edge of giving up · the chain / streak · final kick.

OUTPUT: Produce exactly 100 lines. One per line. Nothing else — no intro, no outro, no section labels, no numbering.`;

const SQ_PROMPT = `You are generating a bank of accountability quotes for a rewards shop inside a discipline-tracking app called GAIN. These quotes fire the moment the user is about to spend wallet currency on a reward — the moment they're most tempted to self-deceive about whether they truly earned it.

VOICE: Korean / Chinese murim-jianghu martial-arts webnovel narrator. Think cultivators, sects, dao, qi, cultivation realms (Qi Gathering → Foundation Establishment → Core Formation → Nascent Soul), heavenly tribulation, demonic sects, inner demons, masters and disciples, the jianghu, honor, swords. Dramatic but sharp. Not goofy. Not religious. Not political.

GOAL: Keep the user honest at the moment of spending. The user should feel the gaze of the sect, the dao, the inner demon. If they didn't earn it, the quote should sting. If they did, it should honor them.

HARD CONSTRAINTS:
- Each line is 8–22 words. One sentence or two short clauses.
- No numbering. No bullets. No quotation marks around lines. One per row, nothing else.
- No emojis. No hashtags.
- Use murim vocabulary naturally: dao, sect, master, disciple, cultivator, qi, meridians, dantian, breakthrough, realm, tribulation, forbidden technique, demonic cultivator, inner demon, jianghu, wulin, spirit stones, spirit herbs, sword manual, forms, elders, orthodox vs demonic.
- NO Japanese terms (no "sensei", "dojo", "katana"). Keep it Chinese/Korean murim.
- NO Western fantasy terms (no "mage", "paladin", "magic", "spell").
- Vary structure heavily. Mix declarative, aphoristic, and master-said-X formats.
- No clichés ("may the force be with you", generic fortune-cookie wisdom).
- Each line must sting or honor at the moment of spending — not just sound cool.

THEMES to cycle (don't label, just rotate):
the dao sees · the sect watches · honor and spending · the honest tick · qi deviation from cheating · the long path · the jianghu remembers · hunger and reward · temptation / forbidden techniques · cultivation stages applied to grind · the inner demon · master's wisdom · short + sharp aphorisms.

OUTPUT: Produce exactly 100 lines. One per line. Nothing else.`;

let unsub = null;

export default {
  async mount(root) {
    const s = getSettings();
    const existingKey = (await secure.get("groq_api_key").catch(() => null))
                     || (await secure.get("grok_api_key").catch(() => null))
                     || "";
    const existingSerp = (await secure.get("serpapi_key").catch(() => null)) || "";
    const existingYt   = (await secure.get("youtube_api_key").catch(() => null)) || "";

    root.innerHTML = render(s, existingKey, existingSerp, existingYt);
    paintMotivationCount(root);
    paintShopQuoteCount(root);
    attachHandlers(root);

    if (unsub) unsub();
    unsub = on((ev) => {
      if (ev === "motivations") paintMotivationCount(root);
      if (ev === "shopQuotes") paintShopQuoteCount(root);
    });
  },
  unmount() { if (unsub) { unsub(); unsub = null; } }
};

function render(s, existingKey, existingSerp = "", existingYt = "") {
  const dyn = (s.grok.dynamicConditions || []).join("\n");
  return `
    <div class="view-inner settings">
      <!-- Editorial headline -->
      <header class="s-headline">
        <div class="s-eyebrow">CONFIGURE</div>
        <h1 class="s-title">Settings.</h1>
        <p class="s-lede">The plan, the pricing, the butler. Every lever that shapes your climb — one page, one click of truth.</p>
        <button class="s-glossary-btn" id="s-glossary-open" title="Open the glossary of every GAIN feature">
          <span class="sg-ic">ⓘ</span>
          <span>What does everything mean?</span>
        </button>
      </header>

      <!-- Thin horizontal section nav — luxury, sticky -->
      <nav class="s-topbar" id="s-topbar">
        <div class="stb-chips">
          <button data-scroll="sec-appearance" class="stb-chip"><span>Appearance</span></button>
          <button data-scroll="sec-profile"    class="stb-chip"><span>Profile</span></button>
          <button data-scroll="sec-schedule"   class="stb-chip"><span>Schedule</span></button>
          <button data-scroll="sec-grok"       class="stb-chip"><span>AI butler</span></button>
          <button data-scroll="sec-media"      class="stb-chip"><span>Media (SerpAPI)</span></button>
          <button data-scroll="sec-motivation" class="stb-chip"><span>Motivation</span></button>
          <button data-scroll="sec-shopq"      class="stb-chip"><span>Shop quotes</span></button>
          <button data-scroll="sec-wallet"     class="stb-chip"><span>Wallet</span></button>
          <button data-scroll="sec-anim"       class="stb-chip"><span>Animations</span></button>
          <button data-scroll="sec-data"       class="stb-chip"><span>Data</span></button>
        </div>
      </nav>

      <div class="s-layout" id="s-layout">
        <div class="s-main">

      <section class="s-card" id="sec-appearance">
        <div class="s-head">
          <h3>Appearance.</h3>
          <span class="s-tag">Jianghu-black at night, paper by day. Pick your side.</span>
        </div>
        <div class="theme-seg" role="radiogroup" aria-label="Theme">
          <button class="theme-opt" data-theme-opt="system" role="radio">
            <span class="theme-opt-ic">◐</span>
            <span class="theme-opt-nm">System</span>
            <span class="theme-opt-sub">Follow macOS</span>
          </button>
          <button class="theme-opt" data-theme-opt="light" role="radio">
            <span class="theme-opt-ic">☀</span>
            <span class="theme-opt-nm">Light</span>
            <span class="theme-opt-sub">Paper &amp; ink</span>
          </button>
          <button class="theme-opt" data-theme-opt="dark" role="radio">
            <span class="theme-opt-ic">●</span>
            <span class="theme-opt-nm">Dark</span>
            <span class="theme-opt-sub">Jianghu black</span>
          </button>
        </div>
      </section>

      <section class="s-card" id="sec-profile">
        <div class="s-head"><h3><span class="h-ic">👤</span>Profile &amp; goal</h3><span class="s-tag">Target date lives here</span></div>
        <div class="grid-2">
          <label>Name<input id="s-name" value="${esc(s.profile.name)}" /></label>
          <label>Target role<input id="s-role" value="${esc(s.profile.targetRole)}" /></label>
          <label>Target date<input id="s-date" type="date" value="${esc(s.profile.targetDate)}" /></label>
          <label>Weekday minutes<input id="s-min" type="number" min="15" max="600" value="${s.profile.weekdayMinutes}" /></label>
        </div>
      </section>

      <section class="s-card" id="sec-schedule">
        <div class="s-head"><h3><span class="h-ic">⏱</span>Schedule &amp; load</h3><span class="s-tag">Hard caps so you can't rip yourself off</span></div>
        <div class="grid-3">
          <label>Max tasks / day
            <input id="s-max" type="number" min="1" max="20" value="${s.schedule.maxTasksPerDay || 5}" />
          </label>
          <label>New DSA / weekday
            <input id="s-dsa" type="number" min="0" max="10" value="${s.schedule.newDsaPerWeekday || 1}" />
          </label>
          <label>SD &amp; INT days
            <input id="s-sdi" value="${esc((s.schedule.sdIntDays||[]).join(', '))}" placeholder="Mon, Thu" />
          </label>
        </div>
        <p class="s-note">Max tasks is the ceiling. Whatever the engine or Grok butler plans gets clamped to this before you ever see it.</p>
      </section>

      <section class="s-card" id="sec-grok">
        <div class="s-head"><h3><span class="h-ic">✦</span>AI butler <span class="chip-provider">GROQ</span></h3><span class="s-tag">Key is kept in macOS Keychain</span></div>
        <div class="grid-3">
          <label>Groq API key
            <input id="s-key" type="password" placeholder="gsk_..." value="${esc(existingKey)}" autocomplete="off" />
          </label>
          <label>Model
            <select id="s-model">
              <option value="llama-3.3-70b-versatile" ${s.grok.model==='llama-3.3-70b-versatile'?'selected':''}>Llama 3.3 70B · best quality (280 t/s)</option>
              <option value="llama-3.1-8b-instant"    ${s.grok.model==='llama-3.1-8b-instant'?'selected':''}>Llama 3.1 8B · fast (560 t/s)</option>
              <option value="openai/gpt-oss-120b" ${s.grok.model==='openai/gpt-oss-120b'?'selected':''}>GPT OSS 120B · $0.15/$0.60 · 500 t/s</option>
              <option value="openai/gpt-oss-20b"  ${s.grok.model==='openai/gpt-oss-20b'?'selected':''}>GPT OSS 20B · $0.075/$0.30 · 1000 t/s</option>
              <option value="__custom__">Custom… (paste model id)</option>
            </select>
          </label>
          <label>Temperature<input id="s-temp" type="number" step="0.1" min="0" max="2" value="${s.grok.temperature}" /></label>
        </div>
        <div class="grid-3" id="s-model-custom-wrap" style="display:${isCustomModel(s.grok.model) ? 'grid' : 'none'};">
          <label class="full">Custom model id
            <input id="s-model-custom" type="text" placeholder="e.g. moonshotai/kimi-k2-instruct, qwen/qwen3-32b, meta-llama/llama-4-scout-17b-16e-instruct" value="${isCustomModel(s.grok.model) ? esc(s.grok.model) : ''}" />
            <p class="s-sub">Paste any model id Groq supports — including preview/beta models not in the dropdown. See <code>console.groq.com/docs/models</code>.</p>
          </label>
        </div>
        <div class="row-right" style="margin-top:10px;">
          <button class="btn-ghost btn-sm" id="btn-test-grok">Test connection</button>
          <span id="test-grok-note" class="s-tag" style="margin-left:10px;"></span>
        </div>
        <label class="full">Master prompt
          <textarea id="s-prompt" rows="8">${esc(s.grok.masterPrompt)}</textarea>
        </label>
        <label class="full">Dynamic conditions (one per line — injected verbatim into every Grok call)
          <textarea id="s-dyn" rows="4" placeholder="e.g. exam week Nov 10–14: revision only">${esc(dyn)}</textarea>
        </label>
      </section>

      <section class="s-card" id="sec-media">
        <div class="s-head">
          <h3><span class="h-ic">🎬</span>Media <span class="chip-provider">SERPAPI · YOUTUBE</span></h3>
          <span class="s-tag">Optional · unlocks images &amp; YouTube in lessons</span>
        </div>
        <p class="s-note">
          The <b>Learn this topic</b> modal can embed 2 diagrams and 1 YouTube video per lesson,
          picked by Groq. SerpAPI resolves image queries; YouTube Data API resolves the video
          (and guarantees it's embeddable — zero <b>Error 153</b>). Keys are stored in macOS Keychain.
        </p>
        <div class="grid-3">
          <label class="full">SerpAPI key
            <input id="s-serp-key" type="password" placeholder="paste your SerpAPI key" value="${esc(existingSerp)}" autocomplete="off" />
            <p class="s-sub">Get one at <code>serpapi.com</code>. Free tier: 100 searches/month. Each lesson uses ~3 searches, cached forever per topic.</p>
          </label>
          <label class="full">YouTube Data API key
            <input id="s-yt-key" type="password" placeholder="paste your YouTube Data API v3 key" value="${esc(existingYt)}" autocomplete="off" />
            <p class="s-sub">Get one free at <code>console.cloud.google.com</code> → enable "YouTube Data API v3" → Credentials → API Key. Free tier: 100 lessons/day. When set, GAIN uses this instead of SerpAPI for videos — only <b>embeddable</b> results are returned, so Error 153 never happens.</p>
          </label>
        </div>
        <div class="row-right" style="margin-top:10px;">
          <button class="btn-ghost btn-sm" id="btn-test-serp">Test SerpAPI</button>
          <span id="test-serp-note" class="s-tag" style="margin-left:10px;"></span>
          <button class="btn-ghost btn-sm" id="btn-test-yt" style="margin-left:12px;">Test YouTube API</button>
          <span id="test-yt-note" class="s-tag" style="margin-left:10px;"></span>
          <button class="btn-ghost btn-sm" id="btn-clear-lessons" style="margin-left:12px;">Clear cached lessons</button>
          <span id="clear-lessons-note" class="s-tag" style="margin-left:10px;"></span>
        </div>
      </section>

      <section class="s-card" id="sec-motivation">
        <div class="s-head">
          <h3><span class="h-ic">🔥</span>Motivation</h3>
          <span class="s-tag" id="mcount">— lines loaded</span>
        </div>
        <p class="s-note"><b>Your lines override the defaults.</b> As soon as you add even one, the ~250 built-in lines go quiet. Clear your lines to bring the defaults back. Any CSV column works; the first non-empty column of each row is read as a line.</p>
        <details class="ai-prompt-wrap">
          <summary>Generate more with AI — copy the prompt</summary>
          <div class="ai-prompt-body">
            <p class="s-sub">Paste the prompt below into Grok / ChatGPT / Claude. Ask for 50–200 lines at a time. Save the output as a CSV (one line per row), then upload via the "Upload CSV" field above.</p>
            <textarea id="ai-prompt-mot" readonly rows="12">${MOT_PROMPT.replace(/</g,"&lt;")}</textarea>
            <div class="row-right">
              <button class="btn-ghost btn-sm" id="copy-mot-prompt">Copy prompt</button>
            </div>
          </div>
        </details>

        <div class="grid-2 align-start">
          <label class="full">Paste new lines (one per line)
            <textarea id="m-paste" rows="5" placeholder="Example:&#10;Showing up is the baseline, not the win.&#10;If it was supposed to be easy, everyone would do it."></textarea>
            <div class="row-right"><button class="btn-ghost" id="m-add-paste">Add lines</button></div>
          </label>
          <div class="full">
            <label>Upload CSV
              <input id="m-file" type="file" accept=".csv,text/csv,text/plain" />
            </label>
            <p class="s-sub">We read the first non-empty column of each row (header row is ignored if it looks like a label). Dupes are skipped.</p>
            <div class="row-right">
              <button class="btn-ghost danger" id="m-clear">Clear user-added lines</button>
            </div>
          </div>
        </div>
        <div id="m-note" class="s-note" aria-live="polite"></div>
      </section>

      <section class="s-card" id="sec-shopq">
        <div class="s-head">
          <h3><span class="h-ic">⟡</span>Shop motivation <span class="chip-murim">MURIM</span></h3>
          <span class="s-tag" id="sqcount">— quotes loaded</span>
        </div>
        <p class="s-note">Jianghu-tone accountability quotes that fire when you're about to spend. Honor your reps when you spend your ₹. <b>Your uploads override the defaults.</b></p>
        <details class="ai-prompt-wrap">
          <summary>Generate more with AI — copy the murim prompt</summary>
          <div class="ai-prompt-body">
            <p class="s-sub">Paste the prompt into Grok / ChatGPT / Claude. Save output as CSV, upload below.</p>
            <textarea id="ai-prompt-sq" readonly rows="12">${SQ_PROMPT.replace(/</g,"&lt;")}</textarea>
            <div class="row-right">
              <button class="btn-ghost btn-sm" id="copy-sq-prompt">Copy prompt</button>
            </div>
          </div>
        </details>
        <div class="grid-2 align-start">
          <label class="full">Paste new quotes (one per line)
            <textarea id="sq-paste" rows="5" placeholder="Example:&#10;The dao sees even when the sect does not.&#10;Earn, then enjoy. In that order."></textarea>
            <div class="row-right"><button class="btn-ghost" id="sq-add-paste">Add quotes</button></div>
          </label>
          <div class="full">
            <label>Upload CSV
              <input id="sq-file" type="file" accept=".csv,text/csv,text/plain" />
            </label>
            <p class="s-sub">First non-empty column of each row is read. Columns named <code>quote/line/text</code> win. Dupes skipped.</p>
            <div class="row-right">
              <button class="btn-ghost danger" id="sq-clear">Clear my shop quotes</button>
            </div>
          </div>
        </div>
        <div id="sq-note" class="s-note" aria-live="polite"></div>
      </section>

      <section class="s-card" id="sec-wallet">
        <div class="s-head"><h3><span class="h-ic">🪙</span>Wallet &amp; rewards</h3><span class="s-tag">Everything the engine prices against</span></div>
        <div class="grid-3">
          <label>Task min ₹<input id="s-tmin" type="number" min="0" value="${s.wallet.taskMin}" /></label>
          <label>Task max ₹<input id="s-tmax" type="number" min="0" value="${s.wallet.taskMax}" /></label>
          <label>Perfect-day bonus ₹<input id="s-pdb" type="number" min="0" value="${s.wallet.perfectDayBonus}" /></label>
          <label>Green-week bonus ₹<input id="s-wb" type="number" min="0" value="${s.wallet.weekBonus}" /></label>
          <label>Green-month bonus ₹<input id="s-mb" type="number" min="0" value="${s.wallet.monthBonus}" /></label>
          <label>30-day streak ₹<input id="s-s30" type="number" min="0" value="${s.wallet.streak30}" /></label>
          <label>100-day streak ₹<input id="s-s100" type="number" min="0" value="${s.wallet.streak100}" /></label>
          <label>Daily withdraw cap<input id="s-cap" type="number" min="0" placeholder="unlimited" value="${s.wallet.withdrawCapValue ?? ""}" /></label>
          <label>Cap mode<select id="s-capmode">
            <option value="tasks" ${s.wallet.withdrawCapMode==='tasks'?'selected':''}>Tasks / day</option>
            <option value="amount" ${s.wallet.withdrawCapMode==='amount'?'selected':''}>₹ / day</option>
          </select></label>
        </div>

        <h4 class="sub-h">Streak freeze token</h4>
        <p class="s-note">A one-time purchase that marks a non-green day as "frozen" — counts as green toward streak + perfect-week bonus. Buy from the 🔥 topbar chip.</p>
        <div class="grid-3">
          <label>Freeze token price ₹<input id="s-sfp" type="number" min="0" value="${s.wallet.streakFreezePrice ?? 500}" /></label>
        </div>

        <h4 class="sub-h">Perfect-week bonus</h4>
        <p class="s-note">N consecutive green days in a row = one-time ₹ bonus. Fires again at every N-th day of the unbroken chain.</p>
        <div class="grid-3">
          <label>Bonus ₹<input id="s-pwb" type="number" min="0" value="${s.wallet.perfectWeekBonus ?? 500}" /></label>
          <label>Consecutive green days needed<input id="s-pwd" type="number" min="2" max="30" value="${s.wallet.perfectWeekDays ?? 5}" /></label>
        </div>

        <h4 class="sub-h">Daily earnings cap</h4>
        <p class="s-note">Max ₹ you can bank from solving problems per day. Caps the solve rate — prevents weekend cramming. Set to 0 to disable the cap.</p>
        <div class="grid-3">
          <label>Daily cap ₹ (0 = off)<input id="s-dec" type="number" min="0" value="${s.wallet.dailyEarningCap ?? 0}" /></label>
        </div>

        <h4 class="sub-h">Shop tier unlock thresholds</h4>
        <p class="s-note">Lifetime ₹ earned to unlock each tier of the rewards shop.</p>
        <div class="grid-3">
          <label>Small unlock ₹<input id="s-tu-small"  type="number" min="0" value="${s.wallet.tierUnlocks?.small  ?? 20}" /></label>
          <label>Medium unlock ₹<input id="s-tu-medium" type="number" min="0" value="${s.wallet.tierUnlocks?.medium ?? 500}" /></label>
          <label>Large unlock ₹<input id="s-tu-large"  type="number" min="0" value="${s.wallet.tierUnlocks?.large  ?? 2000}" /></label>
        </div>

        <h4 class="sub-h">Adjust wallet balance</h4>
        <p class="s-note">Opened the modal, decided a bonus fired by mistake, or just need to settle up with yourself — subtract (or add) a specific amount with a note on the ledger.</p>
        <div class="wallet-adjust-row">
          <div class="wa-stat"><span class="wa-lb">EARNED</span><b id="wa-earned">₹${(getWallet().earned||0).toLocaleString()}</b></div>
          <div class="wa-stat"><span class="wa-lb">SPENT</span><b id="wa-spent">₹${(getWallet().spent||0).toLocaleString()}</b></div>
          <div class="wa-stat"><span class="wa-lb">AVAILABLE</span><b id="wa-avail" class="gold">₹${(getWallet().available||0).toLocaleString()}</b></div>
          <button class="btn-ghost" id="btn-wallet-adjust">Adjust wallet…</button>
        </div>
      </section>

      <section class="s-card" id="sec-anim">
        <div class="s-head"><h3><span class="h-ic">🎆</span>Animations &amp; sound</h3><span class="s-tag">Celebrations respect this</span></div>

        <div class="grid-3">
          <label>Animation style<select id="s-style">
            <option value="confetti"  ${(s.animations.style||'confetti')==='confetti'?'selected':''}>Confetti (classic)</option>
            <option value="fireworks" ${s.animations.style==='fireworks'?'selected':''}>Fireworks</option>
            <option value="sparkles"  ${s.animations.style==='sparkles'?'selected':''}>Sparkles (soft)</option>
            <option value="shockwave" ${s.animations.style==='shockwave'?'selected':''}>Shockwave only</option>
            <option value="minimal"   ${s.animations.style==='minimal'?'selected':''}>Minimal (just the text)</option>
          </select></label>
          <label>Intensity<select id="s-intensity">
            <option value="low"    ${s.animations.intensity==='low'?'selected':''}>Low</option>
            <option value="normal" ${(s.animations.intensity||'normal')==='normal'?'selected':''}>Normal</option>
            <option value="high"   ${s.animations.intensity==='high'?'selected':''}>High (max particles)</option>
          </select></label>
          <label class="chk">
            <input id="s-lottie" type="checkbox" ${s.animations.lottie?'checked':''} />
            Use Lottie for Week / Month tiers
          </label>
        </div>

        <div class="grid-3" style="margin-top: 10px;">
          <label class="chk">
            <input id="s-sound" type="checkbox" ${s.sound.on?'checked':''} />
            Sound on
          </label>
          <label>Volume<input id="s-vol" type="range" min="0" max="1" step="0.05" value="${s.sound.volume}" /></label>
          <label>Motivation tone<select id="s-tone">
            <option value="goggins" ${s.motivation.tone==='goggins'?'selected':''}>Hard tone</option>
            <option value="dao"     ${s.motivation.tone==='dao'?'selected':''}>Dao (quieter)</option>
            <option value="pure"    ${s.motivation.tone==='pure'?'selected':''}>Pure (no profanity)</option>
          </select></label>
        </div>

        <h4 class="sub-h">Custom sound files (≤ 500 KB each)</h4>
        <p class="s-note">Upload your own MP3/WAV for each tier. Clear to fall back to the default <code>assets/sound/</code> files.</p>
        <div class="sound-grid">
          ${["day","week","month","earn"].map(k => `
            <div class="sound-slot">
              <div class="ss-head">
                <b>${k.toUpperCase()}</b>
                <span class="ss-state" id="ss-state-${k}">${s.sound[`custom${cap(k)}`] ? "custom · loaded" : "default"}</span>
              </div>
              <input type="file" accept="audio/*" data-sound-key="${k}" class="snd-file" />
              <div class="ss-ctrls">
                <button class="btn-ghost btn-sm" data-play-sound="${k}">▶ Play</button>
                <button class="btn-ghost btn-sm" data-clear-sound="${k}">Clear</button>
              </div>
            </div>
          `).join("")}
        </div>

        <h4 class="sub-h">Other</h4>
        <label class="chk" style="margin-top: 8px;">
          <input id="s-footer" type="checkbox" ${s.motivation.footerLine?'checked':''} />
          Rotating accountability line in the footer
        </label>
      </section>

      <section class="s-card" id="sec-data">
        <div class="s-head"><h3><span class="h-ic">📂</span>Data &amp; sheets</h3><span class="s-tag">Everything is a file on disk</span></div>
        <p class="s-note">Sheets live in <code>~/Library/Application Support/com.vikas.gain/data/</code> as plain CSVs. Edits in Library write back directly. Timestamped backups land in <code>data/backups/</code> on every write.</p>
        <div class="sheet-list" id="sheet-list">${renderSheetList(s)}</div>

        <h4 class="sub-h">CSV format reference</h4>
        <p class="s-note">If you want to drop in your own files, match these headers. Column order doesn't matter — the loader picks by name (case-insensitive). Missing optional columns stay blank. Reward imports also live in the Shop → Import catalog CSV button.</p>
        <div class="csv-ref">
          ${renderCsvFormat("DSA", "01_DSA_SHEET.csv",
            ["Seq", "Pattern", "Problem", "Difficulty", "Freq", "LC#", "Status", "Confidence", "DateDone", "Notes", "Solution"],
            ["Pattern","Problem","Difficulty","Freq","Status"],
            "Seq: 1-based. Status: TODO | SOLVED | REVIEW. Difficulty drives ₹ pricing. Freq (HIGH/MED/LOW) breaks ties when picking the next TODO.")}
          ${renderCsvFormat("System Design", "02_SYSTEM_DESIGN_SHEET.csv",
            ["Seq", "Category", "Topic", "Status", "Confidence", "DateDone", "Notes"],
            ["Category","Topic","Status"],
            "'Topic' can also be named 'Topic/Skill' or 'Skill' — the loader resolves aliases. Status: TODO | SOLVED | REVIEW.")}
          ${renderCsvFormat("Integrations", "03_INTEGRATIONS_PLATFORMS_SHEET.csv",
            ["Seq", "Category", "Skill or Platform", "Status", "Confidence", "DateDone", "Notes"],
            ["Category","Skill or Platform","Status"],
            "Same shape as System Design. Picked on configured SD/INT days when SD queue is empty.")}
          ${renderCsvFormat("Interview Extras", "04_FDE_INTERVIEW_EXTRAS.csv",
            ["Seq", "Category", "Item", "Priority", "Status", "Confidence", "DateDone", "WhyItMatters", "HowToPractice"],
            ["Category","Item","Priority","Status"],
            "Weekend-only auto-assigner: Sat prefers Behavioral/Decomposition/Learning/Communication; Sun prefers Mock/Take-home/Resume/Negotiation/Domain/SQL. Priority: P1 or P2.")}
          ${renderCsvFormat("Rewards catalog", "rewards_catalog.csv",
            ["id", "name", "type", "category", "tier", "price_inr", "store", "product_url", "image_url", "notes"],
            ["name","tier","price_inr"],
            "tier: small | medium | large | mega. type: canonical bucket for carousels — shoes, apparel, bag, accessory, watches, jewelry, electronics, cameras, food, experience, travel, fitness, wellness, outdoor, home, books, games, music, art, grooming, cars, bikes, kids, space, custom. If type is missing, it's inferred from category + title. image_url: full https URL OR a bare filename (resolved against data/reward-images/). Dedupe by id — re-importing the same id updates the row.")}
        </div>

        <h4 class="sub-h">Backup &amp; restore</h4>
        <div class="backup-zone">
          <div class="bz-top">
            <div class="bz-top-text">
              <div class="bz-title">Portable backup</div>
              <div class="bz-sub">One JSON file holds your entire climb. Keep it anywhere — if this app vanishes, the file brings you back.</div>
            </div>
            <div class="bz-top-actions">
              <button class="btn-primary bz-btn" id="btn-export-full-backup" title="Bulletproof: packs EVERY piece of state (settings, wallet, dayLog, sheets, solutions, lessons, caches) into a single checksummed JSON file. Takes a safety snapshot on restore.">
                <span class="bz-btn-ic">⬇</span> Export full backup
              </button>
              <label class="bz-btn bz-btn-ghost" for="file-import-full-backup" title="Restore from a full backup. We checksum-verify the file first, write a safety snapshot of your current state, then overwrite everything atomically. If anything fails, state rolls back.">
                <span class="bz-btn-ic">⬆</span> Restore full backup
              </label>
              <input type="file" id="file-import-full-backup" accept="application/json,.json" hidden />
              <button class="btn-primary bz-btn" id="btn-export-backup" hidden>
                <span class="bz-btn-ic">↓</span> Export backup (legacy)
              </button>
              <label class="bz-btn bz-btn-ghost" for="file-import-backup" hidden>
                <span class="bz-btn-ic">↑</span> Restore (legacy)
              </label>
              <input type="file" id="file-import-backup" accept="application/json,.json" hidden />
              <button class="bz-btn bz-btn-ghost" id="btn-export-grimoire" title="Download a single .md file of every solution, note, lesson, and key idea you've captured">
                <span class="bz-btn-ic">📖</span> Export grimoire (.md)
              </button>
              <button class="bz-btn bz-btn-ghost" id="btn-export-weekly" title="Groq reflects on your last 7 days — stats + 300-word honest mentor's take, saved as .md">
                <span class="bz-btn-ic">🗓</span> Weekly review (.md)
              </button>
              <button class="bz-btn bz-btn-primary" id="btn-mentor-report" title="Full-screen honest-coach mentor letter — reads every signal from the last 7 days and gives you specific wins, concerns, next-week focus, and the one big ask">
                <span class="bz-btn-ic">✦</span> Open mentor report card
              </button>
            </div>
          </div>

          <details class="bz-details">
            <summary>What's inside, what isn't</summary>
            <div class="bz-grid">
              <div class="bz-col">
                <div class="bz-col-h"><span class="bz-dot bz-dot--include"></span>Included</div>
                <ul class="bz-mini">
                  <li>Wallet — earned, spent, ledger</li>
                  <li>Day log — every past plan &amp; tick</li>
                  <li>Per-row progress on every sheet (keyed by <code>Seq</code>)</li>
                  <li>Rewards catalog + wishlist chain</li>
                  <li>Settings — profile, schedule, pricing, sound</li>
                  <li>Your motivations &amp; shop quotes</li>
                </ul>
              </div>
              <div class="bz-col">
                <div class="bz-col-h"><span class="bz-dot bz-dot--exclude"></span>Not included</div>
                <ul class="bz-mini">
                  <li>Sheet question text — comes back from CSVs</li>
                  <li>Groq API key — stays in macOS Keychain</li>
                </ul>
              </div>
            </div>
            <div class="bz-foot">Row progress is matched by <code>Seq</code>. If a row doesn't match in the new install, it's skipped and the result tells you how many.</div>
          </details>
        </div>

        <h4 class="sub-h">Start from scratch</h4>
        <div class="danger-zone">
          <div class="dz-text">
            <b>Reset all progress.</b>
            <p class="dz-sub">Wipes the climb back to zero. Reversible only if you dig into the backups on disk.</p>

            <div class="dz-group">
              <div class="dz-group-h">What gets wiped</div>
              <ul class="dz-list dz-list--wipe">
                <li><b>Wallet</b> — earned, spent, ledger entries</li>
                <li><b>dayLog</b> — every past plan and every tick</li>
                <li><b>Status / DateDone / Confidence</b> on every sheet row → back to <code>TODO</code></li>
                <li><b>Streak</b> → 0</li>
              </ul>
            </div>

            <div class="dz-group">
              <div class="dz-group-h">What survives</div>
              <ul class="dz-list dz-list--keep">
                <li>Your settings</li>
                <li>Sheet structure (DSA / SD / INT / Extras files on disk)</li>
                <li>Rewards catalog &amp; wishlist</li>
                <li>Motivation lines &amp; shop quotes</li>
                <li>Groq API key</li>
              </ul>
            </div>

            <p class="dz-foot">Timestamped backups land in <code>data/backups/</code> before anything is wiped.</p>
          </div>
          <div class="dz-action">
            <button class="btn-ghost danger" id="btn-reset-all">Reset all progress</button>
          </div>
        </div>
      </section>

      <div class="s-actions">
        <button class="btn-primary" id="save-btn">Save settings</button>
        <span id="save-note" class="s-tag"></span>
      </div>
        </div> <!-- /.s-main -->
      </div> <!-- /.s-layout -->
    </div>

    <style>
      .settings { max-width: 1240px; margin: 0 auto; letter-spacing: -.003em; }

      /* ===== Editorial headline (matches Shop, Dashboard) ===== */
      .settings .s-headline {
        text-align: center;
        padding: 40px 24px 24px;
        max-width: 820px; margin: 0 auto;
      }
      .settings .s-eyebrow {
        font: 700 13px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase;
        color: var(--gold); margin: 0 0 14px;
      }
      .settings .s-title {
        font: 600 52px/1.06 var(--font-sans); letter-spacing: -.028em;
        margin: 0 0 14px; color: var(--ink);
      }
      .settings .s-lede {
        font-size: 18px; color: var(--mut); margin: 0 auto;
        max-width: 620px; line-height: 1.55;
      }
      .settings .s-glossary-btn {
        display: inline-flex; align-items: center; gap: 8px;
        margin-top: 18px;
        padding: 10px 20px;
        background: var(--paper); border: 1px solid color-mix(in oklab, var(--gold) 32%, var(--line));
        color: var(--mut); border-radius: 999px;
        cursor: pointer; font: 600 13px/1 var(--font-sans);
        transition: all .18s;
      }
      .settings .s-glossary-btn:hover {
        color: var(--gold); border-color: var(--gold); transform: translateY(-1px);
      }
      .settings .s-glossary-btn .sg-ic { color: var(--gold); font-size: 15px; }

      /* ===== Thin sticky section nav — shrink-to-fit pill ===== */
      .settings .s-topbar {
        display: flex; align-items: center; justify-content: center;
        width: fit-content; max-width: calc(100% - 32px);
        margin: 0 auto 36px;
        padding: 6px;
        background: color-mix(in oklab, var(--paper) 84%, transparent);
        backdrop-filter: saturate(180%) blur(18px);
        -webkit-backdrop-filter: saturate(180%) blur(18px);
        border: 1px solid var(--line);
        border-radius: 999px;
        position: sticky; top: 12px; z-index: 20;
      }
      .settings .stb-chips {
        display: flex; gap: 2px;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .settings .stb-chips::-webkit-scrollbar { display: none; }
      .settings .stb-chip {
        display: inline-flex; align-items: center;
        padding: 8px 16px; border-radius: 999px; cursor: pointer;
        background: transparent; border: 1px solid transparent;
        color: var(--mut);
        font: 500 13px/1 var(--font-sans); letter-spacing: -.005em;
        transition: all .18s;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .settings .stb-chip:hover { color: var(--ink); background: var(--bg); }
      .settings .stb-chip.active { background: var(--ink); color: var(--paper); }

      /* ===== Sections: NO cards, continuous luxurious scroll — WIDER for breathing room ===== */
      .settings .s-layout { display: block; max-width: 940px; margin: 0 auto; padding: 0 24px; }
      .settings .s-main { min-width: 0; }
      .settings .s-card {
        padding: 48px 0;
        border-top: 1px solid var(--line);
        animation: rise var(--dur-slow) var(--ease) both;
        position: relative;
      }
      .settings .s-card:first-of-type { border-top: none; padding-top: 24px; }
      .settings .s-card:last-of-type  { padding-bottom: 32px; }
      /* 1.5x type scale pass — labels, inputs, notes feel generous now */
      .settings .s-card label { font-size: 16px; }
      .settings .s-card input, .settings .s-card select, .settings .s-card textarea { font-size: 15px; padding: 10px 12px; }
      .settings .s-card select { padding-right: 32px; }
      .settings .s-card input[type="text"],
      .settings .s-card input[type="password"],
      .settings .s-card input[type="number"],
      .settings .s-card input[type="url"],
      .settings .s-card select,
      .settings .s-card textarea { min-width: min(360px, 100%); max-width: 100%; }
      .settings .s-card .grid-2 { gap: 32px; }
      .settings .s-card .grid-3 { gap: 28px; }
      @media (max-width: 560px) {
        .settings .s-layout { padding: 0 14px; }
        .settings .s-card { padding: 32px 0; }
        .settings .s-card .grid-2, .settings .s-card .grid-3 { gap: 18px; grid-template-columns: 1fr !important; }
        .settings .s-card input[type="text"],
        .settings .s-card input[type="password"],
        .settings .s-card input[type="number"],
        .settings .s-card input[type="url"],
        .settings .s-card select,
        .settings .s-card textarea { min-width: 0; width: 100%; }
        .settings .s-topbar { max-width: calc(100% - 20px); }
        .settings .stb-chip { padding: 6px 12px; font-size: 12px; }
      }

      /* Section header: title + sub-tag UNDERNEATH (not stretched to the right edge) */
      .settings .s-head {
        display: block;
        margin-bottom: 22px;
      }
      .settings .s-head h3 {
        margin: 0;
        font: 600 30px/1.2 var(--font-sans); letter-spacing: -.02em;
        color: var(--ink);
        display: flex; align-items: center; gap: 14px;
      }
      .settings .h-ic { display: none; }
      .settings .s-head::before { display: none; }
      .settings .s-tag {
        display: block;
        color: var(--mut); font: 400 15px/1.4 var(--font-sans);
        margin-top: 6px;
      }

      .settings .s-note { color: var(--mut); font-size: 16px; margin: 0 0 24px; line-height: 1.65; max-width: 680px; }
      .settings .s-sub  { color: var(--mut); font-size: 14px; margin: 10px 0 0; line-height: 1.55; }
      .settings .s-card p { line-height: 1.65; }
      .settings .s-card p + p { margin-top: 10px; }

      /* ===== Inline wallet-adjust row (Settings → Wallet section) ===== */
      .settings .wallet-adjust-row {
        display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 10px;
        align-items: stretch; margin-top: 12px;
      }
      .settings .wa-stat {
        padding: 14px 16px; background: var(--bg);
        border: 1px solid var(--line); border-radius: 12px;
      }
      .settings .wa-stat .wa-lb {
        display: block; font: 500 10px/1 var(--font-sans);
        letter-spacing: .18em; text-transform: uppercase; color: var(--mut);
        margin-bottom: 8px;
      }
      .settings .wa-stat b {
        font: 600 20px/1 var(--font-sans); color: var(--ink); letter-spacing: -.015em;
        font-feature-settings: "tnum";
      }
      .settings .wa-stat b.gold { color: var(--gold); }
      .settings #btn-wallet-adjust { align-self: center; }
      @media (max-width: 720px) {
        .settings .wallet-adjust-row { grid-template-columns: 1fr 1fr; }
        .settings #btn-wallet-adjust { grid-column: 1 / -1; margin-top: 6px; }
      }

      /* ===== Appearance segmented control ===== */
      .settings .theme-seg {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
        max-width: 580px;
      }
      .settings .theme-opt {
        display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
        padding: 16px 18px; border-radius: 14px;
        background: var(--paper); border: 1px solid var(--line); cursor: pointer;
        text-align: left;
        transition: border-color .18s, background .18s, transform .18s;
      }
      .settings .theme-opt:hover { border-color: var(--line2); }
      .settings .theme-opt.active {
        border-color: var(--gold); background: var(--gold-soft);
      }
      .settings .theme-opt-ic { font-size: 18px; color: var(--mut); line-height: 1; }
      .settings .theme-opt.active .theme-opt-ic { color: var(--gold); }
      .settings .theme-opt-nm {
        font: 600 14px/1 var(--font-sans); color: var(--ink); letter-spacing: -.012em;
        margin-top: 6px;
      }
      .settings .theme-opt-sub { font-size: 11.5px; color: var(--mut); }
      @media (max-width: 560px) {
        .settings .theme-seg { grid-template-columns: 1fr; }
      }

      /* ===== Form fields (Apple-grade, tight) ===== */
      .settings label {
        display: block;
        font: 500 10.5px/1 var(--font-sans); color: var(--mut);
        letter-spacing: .08em; text-transform: uppercase;
        margin-bottom: 14px;
      }
      .settings input, .settings textarea, .settings select {
        margin: 0; width: 100%;
        border: 1px solid var(--line); background: var(--paper); border-radius: 10px;
        padding: 10px 12px; font: 13.5px/1.4 var(--font-sans); color: var(--ink);
        outline: none; resize: vertical;
        transition: border-color .18s, box-shadow .18s, background .18s;
      }
      /* Inputs nested inside a <label> — real breathing room between label text and field */
      .settings label > input:not([type="file"]):not([hidden]),
      .settings label > textarea:not([hidden]),
      .settings label > select:not([hidden]),
      .settings label > .gain-dd {
        margin-top: 12px;
        display: block;
      }
      .settings input[hidden], .settings textarea[hidden], .settings select[hidden] { display: none !important; }
      .settings input:focus, .settings textarea:focus, .settings select:focus {
        border-color: var(--gold);
        box-shadow: 0 0 0 3px var(--gold-soft);
        background: var(--paper);
      }
      .settings textarea { min-height: 72px; }
      .settings textarea { font-family: var(--font-mono); font-size: 12.5px; line-height: 1.55; }
      .settings .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3) var(--s-4); }
      .settings .grid-3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: var(--s-3) var(--s-4); }
      .settings .grid-2.align-start { align-items: flex-start; }
      .settings .full { grid-column: 1 / -1; }
      .settings .row-right { display: flex; justify-content: flex-end; margin-top: 8px; }
      .settings .btn-ghost.danger { color: var(--red); border-color: var(--line2); }
      .settings .btn-ghost.danger:hover { color: #fff; background: var(--red); border-color: var(--red); }
      .settings .chip-murim {
        display: inline-block; margin-left: 10px;
        font-size: 10px; letter-spacing: .18em; font-weight: 700;
        padding: 2px 8px; border-radius: 999px;
        background: var(--gold-soft); color: var(--gold); border: 1px solid var(--gold);
        vertical-align: middle;
      }
      .settings .chip-provider {
        display: inline-block; margin-left: 10px;
        font-size: 10px; letter-spacing: .22em; font-weight: 700;
        padding: 2px 10px; border-radius: 999px;
        background: var(--gold-soft); color: var(--gold); border: 1px solid var(--gold);
        vertical-align: middle;
      }
      .settings code { background: var(--line); padding: 1px 6px; border-radius: 4px; font-size: 11px; }
      .settings .ai-prompt-wrap {
        margin: 24px 0 16px;
        border: 1px solid var(--line); border-radius: 12px;
        padding: 14px 18px; background: var(--bg);
      }
      .settings .ai-prompt-wrap summary {
        cursor: pointer;
        display: inline-flex; align-items: center; gap: 8px;
        font: 500 12.5px/1.4 var(--font-sans);
        color: var(--ink); letter-spacing: -.005em;
        padding: 2px 0; outline: none;
        list-style: none;
      }
      .settings .ai-prompt-wrap summary::-webkit-details-marker { display: none; }
      .settings .ai-prompt-wrap summary::before {
        content: "▸"; font-size: 10px; color: var(--mut);
        transition: transform .18s;
        display: inline-block;
      }
      .settings .ai-prompt-wrap[open] summary::before { transform: rotate(90deg); }
      .settings .ai-prompt-wrap summary:hover { color: var(--gold); }
      .settings .ai-prompt-wrap[open] summary { margin-bottom: 12px; }
      .settings .ai-prompt-body textarea {
        font-family: var(--font-mono); font-size: 11.5px; line-height: 1.5;
        background: var(--paper); color: var(--ink); border-color: var(--line);
        margin-top: 6px; max-height: 320px;
      }
      .settings label.chk {
        display: flex; align-items: center; gap: 12px;
        text-transform: none; letter-spacing: 0; font-weight: 500;
        font-size: 13.5px; color: var(--ink);
        padding: 12px 16px; background: var(--paper);
        border: 1px solid var(--line); border-radius: 12px;
        transition: border-color .18s, background .18s;
      }
      .settings label.chk:hover { border-color: var(--line2); }
      .settings label.chk input { width: auto; margin: 0; accent-color: var(--gold); }
      .settings input[type="range"] { padding: 0; height: 32px; background: transparent; border: none; accent-color: var(--gold); }

      .settings .sheet-row {
        display: grid; grid-template-columns: 1.4fr 2fr 1fr 1.4fr; gap: 12px;
        padding: 14px 16px; border-top: 1px solid var(--line);
        align-items: center; font-size: 13.5px;
      }
      .settings .sheet-row:first-of-type { border-top: none; }
      .settings .sr-name { font-weight: 500; color: var(--ink); letter-spacing: -.005em; }
      .settings .sr-type { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--mut); }
      .settings .sr-mapped { color: var(--mut); font-size: 12.5px; text-align: right; }
      /* ===== Backup zone — compact, two buttons front & centre ===== */
      .settings .backup-zone {
        padding: 20px 24px;
        background: var(--paper); border: 1px solid var(--line);
        border-left: 3px solid var(--gold); border-radius: 14px;
        margin-top: 20px; margin-bottom: 32px;
      }
      .settings .backup-zone .bz-top {
        display: flex; flex-direction: column; gap: 16px;
      }
      .settings .backup-zone .bz-title {
        font: 600 17px/1.2 var(--font-sans); letter-spacing: -.015em;
        color: var(--ink); margin: 0 0 6px;
      }
      .settings .backup-zone .bz-sub {
        font: 400 13.5px/1.55 var(--font-sans); color: var(--mut); margin: 0;
        max-width: 560px;
      }
      .settings .backup-zone .bz-top-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 4px; }

      /* Buttons */
      .settings .backup-zone .bz-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 10px 18px; border-radius: 999px;
        font: 500 13px/1 var(--font-sans); letter-spacing: -.005em;
        cursor: pointer; white-space: nowrap;
        transition: background .18s, border-color .18s, color .18s, transform .18s;
      }
      .settings .backup-zone .btn-primary.bz-btn {
        background: var(--ink); color: #fff; border: 1px solid var(--ink);
      }
      .settings .backup-zone .btn-primary.bz-btn:hover { background: #000; transform: translateY(-1px); }
      .settings .backup-zone .bz-btn-ghost {
        background: transparent; color: var(--ink);
        border: 1px solid var(--line2);
        /* undo the uppercase .settings label treatment */
        text-transform: none; letter-spacing: -.005em; font-weight: 500;
        margin: 0;
      }
      .settings .backup-zone .bz-btn-ghost:hover { border-color: var(--ink); background: var(--bg); }
      .settings .backup-zone .bz-btn-ic {
        font-size: 14px; line-height: 1; color: var(--gold);
        display: inline-flex;
      }
      .settings .backup-zone .btn-primary.bz-btn .bz-btn-ic { color: #ffd96b; }

      /* Collapsible details — compact */
      .settings .backup-zone .bz-details {
        margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line);
      }
      .settings .backup-zone .bz-details summary {
        cursor: pointer; list-style: none; outline: none;
        display: inline-flex; align-items: center; gap: 6px;
        font: 500 12.5px/1 var(--font-sans); color: var(--ink);
        letter-spacing: -.005em;
      }
      .settings .backup-zone .bz-details summary::-webkit-details-marker { display: none; }
      .settings .backup-zone .bz-details summary::before {
        content: "▸"; color: var(--mut); font-size: 10px;
        transition: transform .18s;
      }
      .settings .backup-zone .bz-details[open] summary::before { transform: rotate(90deg); }
      .settings .backup-zone .bz-details summary:hover { color: var(--gold); }

      .settings .backup-zone .bz-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
        margin-top: 14px;
      }
      .settings .backup-zone .bz-col-h {
        display: inline-flex; align-items: center; gap: 8px;
        font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em;
        text-transform: uppercase; color: var(--mut);
        margin-bottom: 10px;
      }
      .settings .backup-zone .bz-dot {
        width: 7px; height: 7px; border-radius: 50%; display: inline-block;
      }
      .settings .backup-zone .bz-dot--include { background: var(--gold); }
      .settings .backup-zone .bz-dot--exclude { background: var(--line2); }
      .settings .backup-zone .bz-mini {
        list-style: none; padding: 0; margin: 0;
        display: flex; flex-direction: column; gap: 6px;
      }
      .settings .backup-zone .bz-mini li {
        font-size: 12.5px; color: var(--ink); line-height: 1.45;
      }
      .settings .backup-zone .bz-mini code,
      .settings .backup-zone .bz-foot code {
        font: 500 11px/1 var(--font-mono);
        background: var(--line); padding: 1px 5px; border-radius: 4px; color: var(--ink);
      }
      .settings .backup-zone .bz-foot {
        margin-top: 12px; font-size: 11.5px; color: var(--mut); line-height: 1.5;
      }

      @media (max-width: 640px) {
        .settings .backup-zone .bz-top { grid-template-columns: 1fr; gap: 16px; }
        .settings .backup-zone .bz-grid { grid-template-columns: 1fr; }
      }

      .settings .danger-zone {
        display: grid; grid-template-columns: 1fr auto; gap: 28px;
        align-items: start; padding: 28px 32px;
        background: var(--paper); border: 1px solid var(--line);
        border-left: 3px solid var(--red); border-radius: 14px;
        margin-top: 20px;
      }
      .settings .danger-zone .dz-text > b {
        display: block;
        color: var(--ink); font: 600 17px/1.2 var(--font-sans);
        letter-spacing: -.015em; margin-bottom: 12px;
      }
      .settings .danger-zone .dz-sub {
        font: 400 13.5px/1.5 var(--font-sans); color: var(--mut);
        margin: 0 0 24px; max-width: 520px;
      }
      .settings .danger-zone .dz-group { margin-bottom: 20px; }
      .settings .danger-zone .dz-group:last-of-type { margin-bottom: 16px; }
      .settings .danger-zone .dz-group-h {
        font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em;
        text-transform: uppercase; color: var(--mut);
        margin-bottom: 12px;
      }
      .settings .danger-zone .dz-list {
        list-style: none; padding: 0; margin: 0;
        display: flex; flex-direction: column; gap: 8px;
      }
      .settings .danger-zone .dz-list li {
        position: relative; padding-left: 18px;
        font-size: 13.5px; color: var(--ink); line-height: 1.5;
      }
      .settings .danger-zone .dz-list li::before {
        content: ""; position: absolute; left: 0; top: 9px;
        width: 6px; height: 6px; border-radius: 50%;
      }
      .settings .danger-zone .dz-list--wipe li::before { background: var(--red); }
      .settings .danger-zone .dz-list--keep li::before { background: var(--green); }
      .settings .danger-zone .dz-list li b { color: var(--ink); font-weight: 600; }
      .settings .danger-zone .dz-list code,
      .settings .danger-zone .dz-foot code {
        font: 500 11.5px/1 var(--font-mono);
        background: var(--line); padding: 2px 6px; border-radius: 4px; color: var(--ink);
      }
      .settings .danger-zone .dz-foot {
        margin: 0; padding-top: 16px; border-top: 1px solid var(--line);
        font-size: 12.5px; color: var(--mut); line-height: 1.5;
      }
      .settings .danger-zone .dz-action { padding-top: 2px; }
      .settings .danger-zone .btn-ghost.danger { white-space: nowrap; }

      @media (max-width: 640px) {
        .settings .danger-zone { grid-template-columns: 1fr; }
        .settings .danger-zone .dz-action { justify-self: stretch; }
      }
      .settings .sub-h { margin: 32px 0 14px; font-size: 11px; letter-spacing: .18em; font-weight: 700; color: var(--mut); text-transform: uppercase; }

      /* CSV format reference */
      .settings .csv-ref { display: flex; flex-direction: column; gap: 8px; margin: var(--s-3) 0 var(--s-4); }
      .settings .csv-ref-row {
        background: var(--bg); border: 1px solid var(--line); border-radius: 12px;
        padding: 10px 14px; transition: background .18s, border-color .18s;
      }
      .settings .csv-ref-row:hover { background: var(--paper); border-color: var(--line2); }
      .settings .csv-ref-row[open] { background: var(--paper); border-color: var(--line2); }
      .settings .csv-ref-row summary {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        cursor: pointer; list-style: none; outline: none;
      }
      .settings .csv-ref-row summary::-webkit-details-marker { display: none; }
      .settings .csv-ref-row .csv-name { font: 600 13.5px/1 var(--font-sans); color: var(--ink); letter-spacing: -.005em; }
      .settings .csv-ref-row summary code { font-size: 11px; color: var(--mut); background: transparent; padding: 0; }
      .settings .csv-body { padding-top: 12px; }
      .settings .csv-cols { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
      .settings .csv-col {
        font: 500 11.5px/1 var(--font-mono);
        background: var(--line); color: var(--ink);
        padding: 5px 9px; border-radius: 6px;
        letter-spacing: 0;
      }
      .settings .csv-col.req { background: var(--gold-soft); color: var(--gold); font-weight: 700; }
      .settings .csv-col em { font-style: normal; margin-left: 2px; }
      .settings .csv-note { color: var(--mut); font-size: 12.5px; margin: 0; line-height: 1.5; }
      .settings .sound-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
      .settings .sound-slot {
        background: var(--paper); border: 1px solid var(--line); border-radius: 12px;
        padding: 14px 16px; transition: all .18s;
      }
      .settings .sound-slot:hover { border-color: var(--line2); }
      .settings .ss-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; letter-spacing: .12em; }
      .settings .ss-head b { color: var(--ink); font-weight: 600; }
      .settings .ss-state { color: var(--mut); font-weight: 500; letter-spacing: .02em; text-transform: none; }
      .settings .snd-file { width: 100%; margin: 10px 0 8px; font-size: 11px; padding: 0; border: none; background: transparent; }
      .settings .ss-ctrls { display: flex; gap: 6px; }
      .settings .ss-ctrls .btn-ghost.btn-sm { flex: 1; padding: 6px 10px; min-height: 28px; }

      /* ===== Grids used in sections ===== */
      .settings .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; }
      .settings .grid-3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 14px 16px; }
      .settings .grid-2.align-start { align-items: flex-start; }
      .settings .full { grid-column: 1 / -1; }
      .settings .row-right { display: flex; justify-content: flex-end; margin-top: 8px; }

      /* ===== Buttons (consistent luxury language) ===== */
      .settings .btn-primary {
        background: var(--ink); color: #fff; border: none; border-radius: 999px;
        padding: 12px 28px; font: 500 14px/1 var(--font-sans); letter-spacing: -.005em;
        cursor: pointer; transition: background .18s, transform .18s;
      }
      .settings .btn-primary:hover { background: #000; transform: translateY(-1px); }
      .settings .btn-ghost {
        background: transparent; color: var(--ink);
        border: 1px solid var(--line2); border-radius: 999px;
        padding: 11px 22px; font: 500 13.5px/1 var(--font-sans); letter-spacing: -.005em;
        cursor: pointer; transition: all .18s;
      }
      .settings .btn-ghost:hover { border-color: var(--ink); }
      .settings .btn-ghost.btn-sm { padding: 7px 14px; font-size: 12.5px; }
      .settings .btn-ghost.danger { color: var(--red); border-color: var(--line2); }
      .settings .btn-ghost.danger:hover { color: #fff; background: var(--red); border-color: var(--red); }

      /* ===== Save bar — sticky at the bottom-right of content ===== */
      .settings .s-actions {
        display: flex; align-items: center; justify-content: flex-end; gap: 16px;
        margin: 64px 0 24px; padding-top: 24px;
        border-top: 1px solid var(--line);
      }
      .settings #save-note { font-size: 12.5px; }

      @media (max-width: 760px) {
        .settings .grid-2, .settings .grid-3 { grid-template-columns: 1fr; }
        .settings .danger-zone { grid-template-columns: 1fr; }
        .settings .s-title { font-size: 38px; }
        .settings .s-head h3 { font-size: 22px; }
      }
    </style>
  `;
}

// Any model id NOT in our dropdown list is treated as "custom"
const KNOWN_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b"
]);
function isCustomModel(id) {
  return id && id !== "__custom__" && !KNOWN_MODELS.has(id);
}

// Resolve the real model id from the Settings form:
//   - if select = "__custom__" → use the custom text input (fall back to current saved model)
//   - if select = a known id → use that
function resolveModelId(root) {
  const selVal = root.querySelector("#s-model")?.value || "";
  const customVal = (root.querySelector("#s-model-custom")?.value || "").trim();
  if (selVal === "__custom__") {
    // user explicitly chose "Custom..." — must have a non-empty custom input
    return customVal || "";
  }
  // otherwise take the dropdown value directly
  return selVal;
}

async function persistAllFields(root) {
  await updateSettings(st => {
    st.profile.name = root.querySelector("#s-name").value;
    st.profile.targetRole = root.querySelector("#s-role").value;
    st.profile.targetDate = root.querySelector("#s-date").value;
    st.profile.weekdayMinutes = Number(root.querySelector("#s-min").value) || 60;

    st.schedule.maxTasksPerDay = Math.max(1, Number(root.querySelector("#s-max").value) || 5);
    st.schedule.newDsaPerWeekday = Math.max(0, Number(root.querySelector("#s-dsa").value) || 1);
    st.schedule.sdIntDays = root.querySelector("#s-sdi").value
      .split(/[\s,]+/).map(x => x.trim()).filter(Boolean);

    // Resolve the actual model id (never write the sentinel "__custom__" to disk).
    const resolved = resolveModelId(root);
    if (resolved) st.grok.model = resolved;
    st.grok.temperature = Number(root.querySelector("#s-temp").value);
    st.grok.masterPrompt = root.querySelector("#s-prompt").value;
    st.grok.dynamicConditions = root.querySelector("#s-dyn").value.split("\n").map(x => x.trim()).filter(Boolean);

    st.wallet.taskMin = Math.max(0, Number(root.querySelector("#s-tmin").value) || 0);
    st.wallet.taskMax = Math.max(st.wallet.taskMin, Number(root.querySelector("#s-tmax").value) || 100);
    st.wallet.perfectDayBonus = Math.max(0, Number(root.querySelector("#s-pdb").value) || 0);
    st.wallet.weekBonus = Math.max(0, Number(root.querySelector("#s-wb").value) || 0);
    st.wallet.monthBonus = Math.max(0, Number(root.querySelector("#s-mb").value) || 0);
    st.wallet.streak30 = Math.max(0, Number(root.querySelector("#s-s30").value) || 0);
    st.wallet.streak100 = Math.max(0, Number(root.querySelector("#s-s100").value) || 0);
    const capVal = root.querySelector("#s-cap").value;
    st.wallet.withdrawCapValue = capVal === "" ? null : Math.max(0, Number(capVal) || 0);
    st.wallet.withdrawCapMode = root.querySelector("#s-capmode").value;
    // Phase 7 — streak freeze + perfect-week + daily cap
    const sfp = root.querySelector("#s-sfp")?.value;
    if (sfp != null && sfp !== "") st.wallet.streakFreezePrice = Math.max(0, Number(sfp) || 0);
    const pwb = root.querySelector("#s-pwb")?.value;
    if (pwb != null && pwb !== "") st.wallet.perfectWeekBonus = Math.max(0, Number(pwb) || 0);
    const pwd = root.querySelector("#s-pwd")?.value;
    if (pwd != null && pwd !== "") st.wallet.perfectWeekDays = Math.max(2, Math.min(30, Number(pwd) || 5));
    const dec = root.querySelector("#s-dec")?.value;
    if (dec != null && dec !== "") st.wallet.dailyEarningCap = Math.max(0, Number(dec) || 0);
    // Shop tier unlocks
    st.wallet.tierUnlocks = st.wallet.tierUnlocks || {};
    const tuSmall  = root.querySelector("#s-tu-small")?.value;
    const tuMedium = root.querySelector("#s-tu-medium")?.value;
    const tuLarge  = root.querySelector("#s-tu-large")?.value;
    if (tuSmall  != null && tuSmall  !== "") st.wallet.tierUnlocks.small  = Math.max(0, Number(tuSmall)  || 0);
    if (tuMedium != null && tuMedium !== "") st.wallet.tierUnlocks.medium = Math.max(0, Number(tuMedium) || 0);
    if (tuLarge  != null && tuLarge  !== "") st.wallet.tierUnlocks.large  = Math.max(0, Number(tuLarge)  || 0);

    st.animations.lottie = root.querySelector("#s-lottie").checked;
    st.animations.intensity = root.querySelector("#s-intensity").value;
    st.animations.style = root.querySelector("#s-style").value;
    st.sound.on = root.querySelector("#s-sound").checked;
    st.sound.volume = Number(root.querySelector("#s-vol").value);
    st.motivation.footerLine = root.querySelector("#s-footer").checked;
    st.motivation.tone = root.querySelector("#s-tone").value;
  });
}

function renderCsvFormat(label, file, columns, required, note) {
  const req = new Set(required);
  const cells = columns.map(c => {
    const isReq = req.has(c);
    return `<span class="csv-col ${isReq ? "req" : ""}">${esc(c)}${isReq ? "<em>*</em>" : ""}</span>`;
  }).join("");
  return `
    <details class="csv-ref-row">
      <summary>
        <span class="csv-name">${esc(label)}</span>
        <code>${esc(file)}</code>
      </summary>
      <div class="csv-body">
        <div class="csv-cols">${cells}</div>
        <p class="csv-note">${esc(note)}</p>
      </div>
    </details>
  `;
}

function renderSheetList(s) {
  if (!s.sheets.length) return `<p class="s-sub">No sheets configured. Import one from Library.</p>`;
  return s.sheets.map(sh => `
    <div class="sheet-row">
      <div class="sr-name">${esc(sh.name)}</div>
      <div class="sr-file"><code>${esc(sh.file)}</code></div>
      <div class="sr-type">${esc(sh.type || "custom")}</div>
      <div class="sr-mapped">${Object.keys(sh.columnMap || {}).length} roles mapped</div>
    </div>
  `).join("");
}

function paintMotivationCount(root) {
  const el = root.querySelector("#mcount");
  if (!el) return;
  const c = getMotivationCounts();
  if (c.activeSource === "user") {
    el.innerHTML = `Showing <b>${c.user} yours</b> · ${c.seeds} defaults silenced`;
    el.style.color = "var(--gold)";
  } else {
    el.innerHTML = `Showing <b>${c.seeds} defaults</b> · upload yours to override`;
    el.style.color = "var(--mut)";
  }
}

function paintShopQuoteCount(root) {
  const el = root.querySelector("#sqcount");
  if (!el) return;
  const c = getShopQuoteCounts();
  if (c.activeSource === "user") {
    el.innerHTML = `Showing <b>${c.user} yours</b> · ${c.seeds} murim defaults silenced`;
    el.style.color = "var(--gold)";
  } else {
    el.innerHTML = `Showing <b>${c.seeds} murim defaults</b> · upload yours to override`;
    el.style.color = "var(--mut)";
  }
}

function wireToc(root) {
  const links = root.querySelectorAll(".stb-chip[data-scroll]");
  const viewEl = document.getElementById("view");
  const sections = Array.from(links).map(btn => ({
    btn, el: root.querySelector("#" + btn.dataset.scroll)
  })).filter(x => x.el);

  links.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const target = root.querySelector("#" + btn.dataset.scroll);
      if (!target) return;
      // get the top offset relative to the scrolling container (viewEl)
      const rect = target.getBoundingClientRect();
      const parentRect = viewEl.getBoundingClientRect();
      const offset = rect.top - parentRect.top + viewEl.scrollTop - 24;
      viewEl.scrollTo({ top: offset, behavior: "smooth" });
      links.forEach(l => l.classList.toggle("active", l === btn));
    });
  });

  // Auto-highlight TOC item on scroll
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const match = sections.find(s => s.el === e.target);
          if (match) {
            links.forEach(l => l.classList.toggle("active", l === match.btn));
          }
        }
      });
    }, { root: viewEl, rootMargin: "-20% 0px -70% 0px", threshold: 0 });
    sections.forEach(s => io.observe(s.el));
  }
  if (sections[0]) sections[0].btn.classList.add("active");
}

function attachHandlers(root) {
  wireToc(root);

  // ---- Theme segmented control ----
  const paintThemeOpts = () => {
    const cur = getCurrentMode();
    root.querySelectorAll("[data-theme-opt]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.themeOpt === cur);
    });
  };
  paintThemeOpts();
  root.querySelectorAll("[data-theme-opt]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await setTheme(btn.dataset.themeOpt);
      paintThemeOpts();
    });
  });

  // AUTO-SAVE: any input/change inside the settings pane debounces → updateSettings → disk.
  let autoT;
  const autoSaveNote = root.querySelector("#save-note");
  const scheduleAutoSave = () => {
    clearTimeout(autoT);
    autoT = setTimeout(async () => {
      await persistAllFields(root);
      const key = root.querySelector("#s-key").value.trim();
      if (key) await secure.set("groq_api_key", key);
      const serpKey = root.querySelector("#s-serp-key")?.value.trim();
      if (serpKey) await secure.set("serpapi_key", serpKey);
      const ytKey = root.querySelector("#s-yt-key")?.value.trim();
      if (ytKey) await secure.set("youtube_api_key", ytKey);
      if (autoSaveNote) {
        autoSaveNote.textContent = `Auto-saved · ${new Date().toLocaleTimeString()}`;
        autoSaveNote.style.color = "var(--green)";
      }
    }, 500);
  };
  // Attach the auto-save listener once at a high level
  const mainEl = root.querySelector(".s-main");
  if (mainEl) {
    mainEl.addEventListener("input", (e) => {
      // Ignore file inputs and some editors that trigger too hot
      if (e.target.type === "file") return;
      if (e.target.closest(".ai-prompt-wrap")) return;
      scheduleAutoSave();
    });
    mainEl.addEventListener("change", (e) => {
      if (e.target.type === "file") return;
      scheduleAutoSave();
    });
  }

  // save main form (manual button still works — kept for explicit confirmation)
  root.querySelector("#save-btn").addEventListener("click", async () => {
    await persistAllFields(root);
    const key = root.querySelector("#s-key").value.trim();
    if (key) await secure.set("groq_api_key", key);
    const serpKey = root.querySelector("#s-serp-key")?.value.trim();
    if (serpKey) await secure.set("serpapi_key", serpKey);
    const ytKey = root.querySelector("#s-yt-key")?.value.trim();
    if (ytKey) await secure.set("youtube_api_key", ytKey);
    const note = root.querySelector("#save-note");
    note.textContent = `Saved · ${new Date().toLocaleTimeString()}`;
    note.style.color = "var(--green)";
    setTimeout(() => { note.textContent = ""; }, 2800);
  });

  // SerpAPI test connection — goes through Rust proxy (no CORS from browser).
  root.querySelector("#btn-test-serp")?.addEventListener("click", async () => {
    const noteEl = root.querySelector("#test-serp-note");
    const key = root.querySelector("#s-serp-key").value.trim();
    if (!key) { noteEl.textContent = "Enter a key first."; noteEl.style.color = "var(--red)"; return; }
    noteEl.textContent = "Testing…"; noteEl.style.color = "var(--mut)";
    try {
      await secure.set("serpapi_key", key);
      const { serpSearch } = await import("./store.js");
      const res = await serpSearch({ engine: "google_images", query: "hashmap diagram", apiKey: key });
      if (!res?.ok) throw new Error(res?.error || "SerpAPI call failed");
      const json = JSON.parse(res.json);
      if (json.error) throw new Error(json.error);
      const remaining = json.search_metadata?.credits_left
                    ?? json.search_information?.credits_left
                    ?? json.account?.plan_searches_left;
      const hits = Array.isArray(json.images_results) ? json.images_results.length : 0;
      noteEl.textContent = remaining != null
        ? `✓ Connected · ${remaining} searches left · ${hits} hits`
        : `✓ Connected · ${hits} hits`;
      noteEl.style.color = "var(--green)";
    } catch (e) {
      noteEl.textContent = `✗ ${e.message || e}`;
      noteEl.style.color = "var(--red)";
    }
  });

  // YouTube Data API test connection — proves `videoEmbeddable=true` works.
  root.querySelector("#btn-test-yt")?.addEventListener("click", async () => {
    const noteEl = root.querySelector("#test-yt-note");
    const key = root.querySelector("#s-yt-key").value.trim();
    if (!key) { noteEl.textContent = "Enter a key first."; noteEl.style.color = "var(--red)"; return; }
    noteEl.textContent = "Testing…"; noteEl.style.color = "var(--mut)";
    try {
      await secure.set("youtube_api_key", key);
      const { youtubeSearch } = await import("./store.js");
      const res = await youtubeSearch({ query: "system design LRU cache", apiKey: key, maxResults: 5 });
      if (!res?.ok) throw new Error(res?.error || "YouTube Data API call failed");
      const json = JSON.parse(res.json);
      if (json.error) throw new Error(json.error.message || "API error");
      const hits = Array.isArray(json.items) ? json.items.length : 0;
      noteEl.textContent = `✓ Connected · ${hits} embeddable videos · Error 153 locked out`;
      noteEl.style.color = "var(--green)";
    } catch (e) {
      noteEl.textContent = `✗ ${e.message || e}`;
      noteEl.style.color = "var(--red)";
    }
  });

  // Clear all cached lesson blobs — forces fresh Groq generation next open.
  // Does NOT wipe lessonState (passes/bounties stay honored).
  root.querySelector("#btn-clear-lessons")?.addEventListener("click", () => {
    const noteEl = root.querySelector("#clear-lessons-note");
    let n = 0;
    try {
      const toDel = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("gain:lesson:") || k.startsWith("gain:lessonImg:"))) toDel.push(k);
      }
      for (const k of toDel) { localStorage.removeItem(k); n++; }
    } catch (_) {}
    noteEl.textContent = `✓ Cleared ${n} cached lesson blob${n === 1 ? "" : "s"}. Progress &amp; bounties preserved.`;
    noteEl.style.color = "var(--green)";
    setTimeout(() => { noteEl.textContent = ""; }, 4000);
  });

  // paste-add motivations
  root.querySelector("#m-add-paste").addEventListener("click", async () => {
    const txt = root.querySelector("#m-paste").value;
    const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const added = await addMotivations(lines);
    note(root, added
      ? `Added ${added} line${added === 1 ? "" : "s"}. ${txt.split(/\r?\n/).length - added} skipped (duplicates or blank).`
      : `No new lines — all duplicates or blank.`);
    root.querySelector("#m-paste").value = "";
  });

  // CSV upload
  root.querySelector("#m-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      // Extract: if there's a column literally called "quote"/"motivation"/"line", prefer it.
      const prefer = headers.find(h => /^(quote|motivation|line|text)$/i.test(h));
      const extracted = rows
        .map(r => {
          if (prefer && r[prefer]) return r[prefer];
          // else first non-empty cell in header order
          for (const h of headers) {
            if (r[h] && String(r[h]).trim().length) return r[h];
          }
          return "";
        })
        .map(l => String(l).trim())
        .filter(Boolean);
      // If header row doesn't look like a column label, treat it too as a line
      if (!prefer && headers.length === 1 && headers[0].length > 3 && /[a-z]/i.test(headers[0])) {
        extracted.unshift(headers[0]);
      }
      const added = await addMotivations(extracted);
      note(root, `Imported ${file.name} · ${added} new line${added === 1 ? "" : "s"} added · ${extracted.length - added} duplicate${extracted.length - added === 1 ? "" : "s"} skipped.`);
    } catch (err) {
      note(root, `Failed to read ${file.name}: ${err.message || err}`);
    } finally {
      e.target.value = "";
    }
  });

  // clear user-added
  root.querySelector("#m-clear").addEventListener("click", async () => {
    const c = getMotivationCounts();
    if (!c.user) { note(root, "Nothing to clear — only defaults loaded."); return; }
    const ok = await confirmDanger({
      title: `Clear ${c.user} user motivation line${c.user === 1 ? "" : "s"}?`,
      message: `Only the lines you added yourself will be removed. The default Goggins-tone bank stays.`,
      confirmLabel: `Clear ${c.user} line${c.user === 1 ? "" : "s"}`,
      consequences: [`Your custom lines disappear from the rotation`, `Default seed bank is untouched`]
    });
    if (!ok) return;
    await clearUserMotivations();
    note(root, "Cleared your added lines.");
  });

  // ---- shop quotes handlers ----
  root.querySelector("#sq-add-paste").addEventListener("click", async () => {
    const txt = root.querySelector("#sq-paste").value;
    const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const added = await addShopQuotes(lines);
    noteSQ(root, added
      ? `Added ${added} shop quote${added === 1 ? "" : "s"}. ${txt.split(/\r?\n/).length - added} skipped (dupes/blank).`
      : `No new quotes — all duplicates or blank.`);
    root.querySelector("#sq-paste").value = "";
  });
  root.querySelector("#sq-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const prefer = headers.find(h => /^(quote|line|text|shop)$/i.test(h));
      const extracted = rows
        .map(r => {
          if (prefer && r[prefer]) return r[prefer];
          for (const h of headers) {
            if (r[h] && String(r[h]).trim().length) return r[h];
          }
          return "";
        })
        .map(l => String(l).trim())
        .filter(Boolean);
      if (!prefer && headers.length === 1 && headers[0].length > 3 && /[a-z]/i.test(headers[0])) {
        extracted.unshift(headers[0]);
      }
      const added = await addShopQuotes(extracted);
      noteSQ(root, `Imported ${file.name} · ${added} new shop quote${added === 1 ? "" : "s"} added · ${extracted.length - added} dupes skipped.`);
    } catch (err) {
      noteSQ(root, `Failed to read ${file.name}: ${err.message || err}`);
    } finally {
      e.target.value = "";
    }
  });
  root.querySelector("#sq-clear").addEventListener("click", async () => {
    const c = getShopQuoteCounts();
    if (!c.user) { noteSQ(root, "Nothing to clear — only murim defaults loaded."); return; }
    const ok = await confirmDanger({
      title: `Clear ${c.user} user shop quote${c.user === 1 ? "" : "s"}?`,
      message: `Only the quotes you added yourself will be removed. The murim/jianghu seed bank stays.`,
      confirmLabel: `Clear ${c.user} quote${c.user === 1 ? "" : "s"}`,
      consequences: [`Your custom quotes disappear from the Shop`, `Default murim bank is untouched`]
    });
    if (!ok) return;
    await clearUserShopQuotes();
    noteSQ(root, "Cleared your shop quotes.");
  });

  // ---- Backup: export ----
  // ---- Wallet live stats repaint ----
  const repaintWalletStats = () => {
    const w = getWallet();
    root.querySelector("#wa-earned") && (root.querySelector("#wa-earned").textContent = `₹${(w.earned||0).toLocaleString()}`);
    root.querySelector("#wa-spent")  && (root.querySelector("#wa-spent").textContent  = `₹${(w.spent||0).toLocaleString()}`);
    root.querySelector("#wa-avail")  && (root.querySelector("#wa-avail").textContent  = `₹${(w.available||0).toLocaleString()}`);
  };
  const walletSub = on((ev) => { if (ev === "wallet") repaintWalletStats(); });

  // ---- Adjust wallet modal ----
  root.querySelector("#btn-wallet-adjust")?.addEventListener("click", openWalletAdjustModal);

  // ---- Glossary modal ----
  root.querySelector("#s-glossary-open")?.addEventListener("click", async () => {
    const { openGlossaryModal } = await import("./info.js");
    openGlossaryModal();
  });

  // ---- Weekly review export (Groq reflects on last 7 days) ----
  root.querySelector("#btn-export-weekly")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const original = btn.innerHTML;
    try {
      btn.disabled = true;
      btn.innerHTML = `<span class="bz-btn-ic">⏱</span> Asking Groq…`;
      const { exportWeeklyReview } = await import("./weeklyReview.js");
      const stats = await exportWeeklyReview();
      btn.innerHTML = `✓ ${stats.total} solves · ${stats.greenCount}/7 green · ${stats.hasReflection ? "Groq reflection ✓" : "no key"}`;
      setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 3800);
    } catch (err) {
      btn.innerHTML = `✗ ${err.message || err}`;
      setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 3800);
    }
  });

  // ---- Mentor report card (full-screen, honest-coach letter) ----
  root.querySelector("#btn-mentor-report")?.addEventListener("click", async () => {
    const { openWeeklyReportCard } = await import("./weeklyReview.js");
    openWeeklyReportCard();
  });

  // ---- Grimoire export (one .md file of every scrap) ----
  root.querySelector("#btn-export-grimoire")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const original = btn.innerHTML;
    try {
      btn.disabled = true;
      btn.textContent = "Compiling…";
      const { exportGrimoire } = await import("./grimoire.js");
      const stats = await exportGrimoire();
      btn.innerHTML = `✓ ${stats.totalRows} problems · ${stats.totalWithLessons} lessons`;
      setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 3200);
    } catch (err) {
      btn.innerHTML = `✗ ${err.message || err}`;
      setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 3200);
    }
  });

  // ---- Full backup / restore (bulletproof) ----
  root.querySelector("#btn-export-full-backup")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const originalHTML = btn.innerHTML;
    try {
      btn.disabled = true;
      btn.innerHTML = `<span class="bz-btn-ic">⏱</span> Packing…`;
      const json = await exportFullBackup();
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gain-full-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
      const sizeKb = Math.round(json.length / 1024);
      btn.innerHTML = `<span class="bz-btn-ic">✓</span> Downloaded · ${sizeKb} KB`;
      setTimeout(() => { btn.innerHTML = originalHTML; btn.disabled = false; }, 2600);
    } catch (err) {
      console.error("[settings] full export failed", err);
      btn.innerHTML = `<span class="bz-btn-ic">✗</span> Failed · ${err?.message || err}`;
      setTimeout(() => { btn.innerHTML = originalHTML; btn.disabled = false; }, 3600);
    }
  });

  root.querySelector("#file-import-full-backup")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const flashLabel = (msg) => {
      const label = root.querySelector('label[for="file-import-full-backup"]');
      if (!label) return;
      const original = label.innerHTML;
      label.innerHTML = msg;
      setTimeout(() => { label.innerHTML = original; }, 4000);
    };
    try {
      const text = await file.text();
      const validation = await validateFullBackup(text);
      if (!validation.ok) {
        flashLabel(`<span class="bz-btn-ic">✗</span> ${validation.errors.join("; ").slice(0, 90)}`);
        e.target.value = "";
        return;
      }
      const bundle = validation.bundle;
      const stats = bundle.stats || {};
      const when = new Date(bundle.exportedAt || Date.now()).toLocaleString();
      const ok = await confirmDanger({
        title: "Restore full backup?",
        message: `Overwrites your current state with the backup from ${when}. A safety snapshot of your CURRENT state is saved to backups/ before anything changes.`,
        confirmLabel: "Restore now",
        consequences: [
          `${stats.sheets || 0} sheets · ${stats.sheetRows || 0} rows total`,
          `${stats.dayLogEntries || 0} day-log entries · ₹${(stats.walletEarned || 0).toLocaleString()} earned · ${stats.ledgerEntries || 0} ledger entries`,
          `${stats.solutions || 0} saved solutions · ${stats.lessonCaches || 0} cached lessons`,
          `Safety snapshot: backups/pre-import-{timestamp}.json`,
          `Groq API key is in secure keyring — NOT in the backup — stays as-is.`
        ]
      });
      if (!ok) { e.target.value = ""; return; }

      const result = await importFullBackup(bundle);
      flashLabel(`<span class="bz-btn-ic">✓</span> Restored · snapshot at ${result.snapshotPath.split("/").pop()}`);
      // Small delay then reload UI
      setTimeout(() => { location.reload(); }, 1200);
    } catch (err) {
      console.error("[settings] full import failed", err);
      flashLabel(`<span class="bz-btn-ic">✗</span> ${(err?.message || String(err)).slice(0, 90)}`);
    } finally {
      e.target.value = "";
    }
  });

  root.querySelector("#btn-export-backup")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const original = btn.textContent;
    try {
      btn.disabled = true;
      btn.textContent = "Preparing…";
      const data = exportBackup();
      const json = JSON.stringify(data, null, 2);
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gain-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
      btn.textContent = "✓ Downloaded";
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1800);
    } catch (err) {
      console.error("[settings] export failed", err);
      btn.textContent = "Failed · " + (err?.message || err);
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2600);
    }
  });

  // ---- Backup: import ----
  root.querySelector("#file-import-backup")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let parsed;
      try { parsed = JSON.parse(text); }
      catch { throw new Error("File is not valid JSON."); }
      if (!parsed || parsed.appId !== "com.vikas.gain") throw new Error("Not a GAIN backup file.");

      const c = parsed.counts || {};
      const ok = await confirmDanger({
        title: "Restore from backup?",
        message: `This overwrites your current state with the backup from ${new Date(parsed.exportedAt || Date.now()).toLocaleString()}.`,
        confirmLabel: "Restore now",
        consequences: [
          `${c.ledger || 0} ledger entries, ${c.dayLogDays || 0} day-log days will be restored`,
          `${c.rowEdits || 0} per-row progress edits across ${c.sheets || 0} sheets will be applied`,
          `${c.rewards || 0} rewards, ${c.wishlist || 0} wishlist items, ${c.userMotivations || 0} motivations, ${c.userShopQuotes || 0} shop quotes`,
          `Your current wallet / dayLog / sheet progress / wishlist will be replaced`,
          `Groq API key is NOT in the file — stays as-is`
        ]
      });
      if (!ok) { e.target.value = ""; return; }

      const result = await importBackup(parsed);
      const warn = [];
      if (result.sheetsMissing?.length) warn.push(`${result.sheetsMissing.length} sheet(s) not present in this install: ${result.sheetsMissing.join(", ")}`);
      if (result.rowsMissing) warn.push(`${result.rowsMissing} row progress entries had no matching Seq`);
      if (result.rowsAdded) warn.push(`${result.rowsAdded} ad-hoc rows recreated`);
      flashBtn(root.querySelector("#btn-export-backup"), `✓ Restored · ${result.rowsApplied} row edits · ${result.sheetsApplied} sheets${warn.length ? " · " + warn.join(" · ") : ""}`);
    } catch (err) {
      console.error("[settings] import failed", err);
      flashBtn(root.querySelector("#btn-export-backup"), "Restore failed · " + (err?.message || err));
    } finally {
      e.target.value = "";
    }
  });

  // ---- Reset all progress ----
  root.querySelector("#btn-reset-all")?.addEventListener("click", async (e) => {
    const btn = e.target;
    const ok = await confirmDanger({
      title: "Reset all progress?",
      message: "This wipes every day you've logged, every rupee you've earned or spent, and every row's Status back to TODO. There is no undo — the only safety net is the timestamped backups kept on disk.",
      confirmLabel: "Reset everything",
      consequences: [
        "Wallet earned / spent / ledger → 0",
        "dayLog cleared (every past plan + tick)",
        "Every sheet row: Status back to TODO, DateDone + Confidence cleared",
        "Streak → 0",
        "Kept: settings, sheet structure, rewards catalog, motivation lines, Groq API key",
        "Backups land in data/backups/ before anything is wiped"
      ]
    });
    if (!ok) return;
    btn.disabled = true;
    btn.textContent = "Resetting…";
    try {
      await resetAllProgress({ resetSheets: true });
      btn.textContent = "✓ Reset done";
      btn.style.background = "var(--green)";
      btn.style.color = "#fff";
      btn.style.borderColor = "var(--green)";
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Reset all progress";
        btn.style.cssText = "";
      }, 2000);
    } catch (err) {
      btn.textContent = "Failed · " + (err?.message || err);
      btn.disabled = false;
    }
  });

  // ---- custom sound uploads ----
  root.querySelectorAll(".snd-file").forEach(input => {
    input.addEventListener("change", async (e) => {
      const key = input.dataset.soundKey;
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 500 * 1024) { alert("Audio file too large. Keep it under 500 KB."); input.value = ""; return; }
      const dataUrl = await fileToDataUrl(file);
      await updateSettings(st => { st.sound[`custom${cap(key)}`] = dataUrl; });
      root.querySelector(`#ss-state-${key}`).textContent = "custom · loaded";
      input.value = "";
    });
  });
  root.querySelectorAll("[data-clear-sound]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.clearSound;
      await updateSettings(st => { st.sound[`custom${cap(key)}`] = ""; });
      root.querySelector(`#ss-state-${key}`).textContent = "default";
    });
  });
  root.querySelectorAll("[data-play-sound]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.playSound;
      const s = getSettings();
      const src = s.sound[`custom${cap(key)}`] || `assets/sound/${key}.mp3`;
      try {
        const a = new Audio(src);
        a.volume = Math.min(1, Math.max(0, s.sound.volume || 0.7));
        a.play().catch(() => {});
      } catch (_) {}
    });
  });

  // ---- model dropdown: show custom input when "Custom..." selected ----
  const modelSel = root.querySelector("#s-model");
  const customWrap = root.querySelector("#s-model-custom-wrap");
  const customInput = root.querySelector("#s-model-custom");
  const syncCustom = () => {
    const isCustom = modelSel.value === "__custom__" || isCustomModel(modelSel.value);
    if (customWrap) customWrap.style.display = isCustom ? "grid" : "none";
  };
  modelSel?.addEventListener("change", syncCustom);
  syncCustom();

  // ---- test Groq connection ----
  root.querySelector("#btn-test-grok")?.addEventListener("click", async (e) => {
    const note = root.querySelector("#test-grok-note");
    const btn = e.target;
    const key = root.querySelector("#s-key").value.trim();
    if (!key) {
      note.textContent = "Paste a key first, then click Test.";
      note.style.color = "var(--red)";
      return;
    }
    note.textContent = "Testing Groq…";
    note.style.color = "var(--mut)";
    btn.disabled = true;
    try {
      await secure.set("groq_api_key", key);  // persist first so bot can use it too
      const model = resolveModelId(root);
      if (!model) {
        note.textContent = "Pick a model (or paste a custom id) first.";
        note.style.color = "var(--red)";
        btn.disabled = false;
        return;
      }
      const res = await callGrok({
        apiKey: key,
        model,
        temperature: 0,
        system: "You are a test endpoint. Reply with exactly: OK",
        user: "ping"
      });
      if (res.ok) {
        // persist the resolved model id too so autosave doesn't later overwrite with __custom__
        await updateSettings(st => { st.grok.model = model; });
        note.innerHTML = `✓ Connected · <code>${esc(model)}</code> replied: "${esc(res.content.slice(0, 40))}"`;
        note.style.color = "var(--green)";
      } else {
        note.innerHTML = `✗ ${esc(res.error || "No reply")}`;
        note.style.color = "var(--red)";
      }
    } catch (err) {
      note.textContent = `✗ ${err.message || err}`;
      note.style.color = "var(--red)";
    } finally {
      btn.disabled = false;
    }
  });

  // ---- copy AI prompts ----
  root.querySelector("#copy-mot-prompt")?.addEventListener("click", async (e) => {
    await navigator.clipboard.writeText(MOT_PROMPT);
    flashBtn(e.target, "Copied ✓");
  });
  root.querySelector("#copy-sq-prompt")?.addEventListener("click", async (e) => {
    await navigator.clipboard.writeText(SQ_PROMPT);
    flashBtn(e.target, "Copied ✓");
  });
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
async function fileToDataUrl(file) {
  return await new Promise((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}

function flashBtn(btn, msg) {
  const original = btn.textContent;
  btn.textContent = msg;
  btn.style.background = "var(--green)";
  btn.style.color = "#fff";
  btn.style.borderColor = "var(--green)";
  setTimeout(() => {
    btn.textContent = original;
    btn.style.background = "";
    btn.style.color = "";
    btn.style.borderColor = "";
  }, 1500);
}

function noteSQ(root, msg) {
  const n = root.querySelector("#sq-note");
  if (!n) return;
  n.textContent = msg;
  n.style.color = "var(--ink)";
  setTimeout(() => { n.textContent = ""; }, 4500);
}

function note(root, msg) {
  const n = root.querySelector("#m-note");
  if (!n) return;
  n.textContent = msg;
  n.style.color = "var(--ink)";
  setTimeout(() => { n.textContent = ""; }, 4500);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }
  )[c]);
}
