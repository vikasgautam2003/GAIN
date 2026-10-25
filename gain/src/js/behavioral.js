// Behavioral (STAR) — a route-level page where the user writes 8-12 of their
// own stories once, tags them (leadership, ambiguity, conflict, …), and the
// app maps each common Behavioral Question (BQ) to the stories that best
// answer it. Groq lightly polishes a story on request. Night-before mode
// shows the top 5 stories + the 15 common BQ prompts with their mappings.
//
// Everything persists under localStorage keys `gain:behavioral:*`, which the
// backup/restore flow already captures via the `gain:` prefix walk.

import { on, secure } from "./store.js";
import { callGroqJSON } from "./groqJson.js";

const STORIES_KEY = "gain:behavioral:stories";
const PROMPTS_KEY = "gain:behavioral:prompts";

// Curated catalog — a mix of Amazon LPs, Google rubrics, and generic
// FDE/customer-facing behavioral prompts. Users can edit the list from the
// page's "Edit prompts" button; edits persist to localStorage.
const DEFAULT_PROMPTS = [
  { id: "p-amb-01", title: "Tell me about a time you dealt with ambiguity.", tag: "ambiguity" },
  { id: "p-amb-02", title: "Describe a time you had to make a decision with incomplete information.", tag: "ambiguity" },
  { id: "p-ldr-01", title: "Tell me about a time you led a project without formal authority.", tag: "leadership" },
  { id: "p-ldr-02", title: "Describe a time you had to coach or mentor a struggling teammate.", tag: "leadership" },
  { id: "p-cnf-01", title: "Tell me about a disagreement with a stakeholder — how did you resolve it?", tag: "conflict" },
  { id: "p-cnf-02", title: "Describe a time you pushed back on a product/customer ask.", tag: "conflict" },
  { id: "p-cst-01", title: "Tell me about a time you went above and beyond for a customer.", tag: "customer-save" },
  { id: "p-cst-02", title: "Describe a difficult customer escalation and how you handled it.", tag: "customer-save" },
  { id: "p-scp-01", title: "Tell me about a time you had to cut scope aggressively to ship.", tag: "scope-cut" },
  { id: "p-scp-02", title: "Describe a time you shipped something imperfect and iterated.", tag: "scope-cut" },
  { id: "p-fail-01", title: "Tell me about your biggest professional failure.", tag: "failure" },
  { id: "p-fail-02", title: "Describe a project that didn't go as planned — what did you learn?", tag: "failure" },
  { id: "p-own-01", title: "Tell me about a time you took ownership of something outside your role.", tag: "ownership" },
  { id: "p-xfn-01", title: "Describe a time you shipped cross-functionally with design/PM/sales.", tag: "cross-functional" },
  { id: "p-tech-01", title: "Tell me about the hardest technical decision you've made.", tag: "technical" },
];

const TAGS = [
  { id: "ambiguity",       label: "Ambiguity",       color: "var(--gold)" },
  { id: "leadership",      label: "Leadership",      color: "var(--blue, #3870ff)" },
  { id: "conflict",        label: "Conflict",        color: "var(--red)" },
  { id: "customer-save",   label: "Customer-save",   color: "var(--green)" },
  { id: "scope-cut",       label: "Scope-cut",       color: "#8b4bff" },
  { id: "failure",         label: "Failure",         color: "#e65c3b" },
  { id: "ownership",       label: "Ownership",       color: "#1aa5a0" },
  { id: "cross-functional",label: "Cross-functional",color: "#c48c00" },
  { id: "technical",       label: "Technical",       color: "var(--ink)" },
];

function loadStories() {
  try { return JSON.parse(localStorage.getItem(STORIES_KEY) || "[]"); } catch { return []; }
}
function saveStories(list) {
  try { localStorage.setItem(STORIES_KEY, JSON.stringify(list)); return true; } catch { return false; }
}
function loadPrompts() {
  try {
    const raw = localStorage.getItem(PROMPTS_KEY);
    if (!raw) return DEFAULT_PROMPTS.slice();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PROMPTS.slice();
  } catch { return DEFAULT_PROMPTS.slice(); }
}
function savePrompts(list) {
  try { localStorage.setItem(PROMPTS_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

let activeMode = "stories";  // "stories" | "prompts" | "night-before"
let editingId = null;
let unsub = null;

export default {
  async mount(root) {
    injectStyles();
    root.innerHTML = render();
    paint(root);
    wire(root);
    if (unsub) unsub();
    unsub = on(() => { /* reserved for cross-store signals; stories live in LS */ });
  },
  unmount() { if (unsub) { unsub(); unsub = null; } },
};

function render() {
  return `
    <div class="view-inner behav">
      <header class="behav-head">
        <div class="behav-eyebrow">📣 BEHAVIORAL</div>
        <h1 class="behav-title">STAR stories.</h1>
        <p class="behav-sub">Write once. Rehearse before every loop. 40% of your FDE score sits here.</p>
      </header>

      <nav class="behav-tabs" role="tablist">
        <button class="behav-tab" role="tab" data-mode="stories"><span>My stories</span><span class="behav-tab-count" id="behav-c-stories">—</span></button>
        <button class="behav-tab" role="tab" data-mode="prompts"><span>BQ prompts</span><span class="behav-tab-count" id="behav-c-prompts">—</span></button>
        <button class="behav-tab" role="tab" data-mode="night-before"><span>Night-before</span></button>
      </nav>

      <section class="behav-panel" id="behav-panel"></section>
    </div>
  `;
}

function paint(root) {
  const stories = loadStories();
  const prompts = loadPrompts();

  root.querySelector("#behav-c-stories").textContent = String(stories.length);
  root.querySelector("#behav-c-prompts").textContent = String(prompts.length);
  root.querySelectorAll(".behav-tab").forEach(t => t.classList.toggle("active", t.dataset.mode === activeMode));

  const panel = root.querySelector("#behav-panel");
  if (activeMode === "stories") panel.innerHTML = renderStories(stories);
  else if (activeMode === "prompts") panel.innerHTML = renderPrompts(prompts, stories);
  else panel.innerHTML = renderNightBefore(stories, prompts);
  wirePanel(root, panel);
}

function renderStories(stories) {
  const editing = stories.find(s => s.id === editingId);
  return `
    <div class="behav-sec-head">
      <h2>Your stories</h2>
      <button class="behav-btn-primary" id="behav-new-story">+ New story</button>
    </div>
    ${editing ? renderStoryEditor(editing) : ""}
    ${stories.length === 0 ? `
      <div class="behav-empty">
        <h3>No stories yet.</h3>
        <p>Write 8-12 — one per leadership theme. Every behavioral loop reduces to picking the right one.</p>
      </div>
    ` : `
      <div class="behav-stories-grid">
        ${stories.map(s => renderStoryCard(s)).join("")}
      </div>
    `}
  `;
}

function renderStoryCard(s) {
  const tagObj = TAGS.find(t => t.id === s.tag) || TAGS[0];
  const sTeaser = (s.situation || "").slice(0, 160);
  return `
    <article class="behav-card" data-story-id="${esc(s.id)}">
      <header class="behav-card-head">
        <span class="behav-tag" style="--tag-color:${tagObj.color}">${esc(tagObj.label)}</span>
        <div class="behav-card-actions">
          <button class="behav-btn-icon" data-act="polish" title="Polish with Groq">✦</button>
          <button class="behav-btn-icon" data-act="edit" title="Edit">✎</button>
          <button class="behav-btn-icon behav-btn-danger" data-act="delete" title="Delete">×</button>
        </div>
      </header>
      <h3 class="behav-card-title">${esc(s.title || "Untitled")}</h3>
      <p class="behav-card-teaser">${esc(sTeaser)}${s.situation?.length > 160 ? "…" : ""}</p>
      <footer class="behav-card-foot">
        <span class="behav-card-stamp">${s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : ""}</span>
        <span class="behav-card-meta">${s.action ? "✓ A" : "○ A"} ${s.result ? "✓ R" : "○ R"}</span>
      </footer>
    </article>
  `;
}

function renderStoryEditor(s) {
  return `
    <div class="behav-editor" data-story-id="${esc(s.id)}">
      <div class="behav-editor-head">
        <div class="behav-editor-row">
          <input class="behav-input" id="behav-title" placeholder="Story title (short, memorable)" value="${esc(s.title || "")}" />
          <select class="behav-input" id="behav-tag">
            ${TAGS.map(t => `<option value="${esc(t.id)}" ${s.tag === t.id ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="behav-editor-grid">
        ${[
          { key: "situation", label: "S · Situation",  hint: "Set the scene. 2-3 sentences — team, project, scale." },
          { key: "task",      label: "T · Task",       hint: "What was uniquely YOUR responsibility — not 'we' territory." },
          { key: "action",    label: "A · Action",     hint: "The specific moves YOU made. First person. Verbs." },
          { key: "result",    label: "R · Result",     hint: "Measurable where possible. One line of what you learned." },
        ].map(f => `
          <div class="behav-field">
            <label>${esc(f.label)}</label>
            <textarea class="behav-input behav-textarea" data-field="${esc(f.key)}" placeholder="${esc(f.hint)}">${esc(s[f.key] || "")}</textarea>
            <small class="behav-hint">${esc(f.hint)}</small>
          </div>
        `).join("")}
      </div>
      <div class="behav-editor-actions">
        <button class="behav-btn-primary" id="behav-save">Save story</button>
        <button class="behav-btn-ghost" id="behav-cancel">Cancel</button>
        <span class="behav-editor-spacer"></span>
        <button class="behav-btn-ghost" id="behav-polish-full">✦ Polish with Groq</button>
      </div>
    </div>
  `;
}

function renderPrompts(prompts, stories) {
  // Map each prompt to the stories whose tag matches
  const matchFor = (p) => stories.filter(s => s.tag === p.tag);
  return `
    <div class="behav-sec-head">
      <h2>Common BQ prompts</h2>
      <button class="behav-btn-primary" id="behav-new-prompt">+ Add prompt</button>
    </div>
    <div class="behav-prompts-list">
      ${prompts.map(p => {
        const matches = matchFor(p);
        const tagObj = TAGS.find(t => t.id === p.tag) || TAGS[0];
        return `
          <article class="behav-prompt" data-prompt-id="${esc(p.id)}">
            <div class="behav-prompt-main">
              <div class="behav-prompt-head">
                <span class="behav-tag" style="--tag-color:${tagObj.color}">${esc(tagObj.label)}</span>
                <h3>${esc(p.title)}</h3>
              </div>
              ${matches.length ? `
                <div class="behav-prompt-match">
                  <span class="behav-prompt-match-label">Use:</span>
                  ${matches.map(s => `<span class="behav-prompt-match-chip">${esc(s.title || "Untitled")}</span>`).join("")}
                </div>
              ` : `<div class="behav-prompt-nomatch">No story tagged <b>${esc(tagObj.label)}</b> yet.</div>`}
            </div>
            <div class="behav-prompt-actions">
              <button class="behav-btn-icon" data-act="prompt-edit" title="Edit">✎</button>
              <button class="behav-btn-icon behav-btn-danger" data-act="prompt-delete" title="Delete">×</button>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderNightBefore(stories, prompts) {
  const top5 = stories.slice(0, 5);
  // Map tag → prompt titles
  const byTag = {};
  for (const p of prompts) {
    if (!byTag[p.tag]) byTag[p.tag] = [];
    byTag[p.tag].push(p.title);
  }
  return `
    <div class="behav-nb">
      <section class="behav-nb-sec">
        <h2 class="behav-nb-h">Your top 5 stories, cold-ready</h2>
        ${top5.length === 0 ? `<div class="behav-empty"><h3>Write at least 5 stories first.</h3></div>` : `
          <div class="behav-nb-stories">
            ${top5.map((s, i) => {
              const tagObj = TAGS.find(t => t.id === s.tag) || TAGS[0];
              return `
                <article class="behav-nb-story">
                  <header><span class="behav-nb-num">${i + 1}</span><h3>${esc(s.title || "Untitled")}</h3><span class="behav-tag" style="--tag-color:${tagObj.color}">${esc(tagObj.label)}</span></header>
                  <div class="behav-nb-blocks">
                    ${["situation","task","action","result"].map(k => s[k] ? `<div class="behav-nb-block"><span>${k.toUpperCase()[0]}</span><p>${esc(s[k])}</p></div>` : "").join("")}
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        `}
      </section>
      <section class="behav-nb-sec">
        <h2 class="behav-nb-h">BQ prompts mapped to your tags</h2>
        <div class="behav-nb-prompts">
          ${TAGS.map(tag => {
            const list = byTag[tag.id] || [];
            if (!list.length) return "";
            return `
              <div class="behav-nb-ptag">
                <div class="behav-tag" style="--tag-color:${tag.color}">${esc(tag.label)}</div>
                <ul>${list.map(p => `<li>${esc(p)}</li>`).join("")}</ul>
              </div>
            `;
          }).join("")}
        </div>
      </section>
    </div>
  `;
}

function wire(root) {
  root.querySelectorAll(".behav-tab").forEach(t => {
    t.addEventListener("click", () => {
      activeMode = t.dataset.mode;
      editingId = null;
      paint(root);
    });
  });
}

function wirePanel(root, panel) {
  // Stories tab
  panel.querySelector("#behav-new-story")?.addEventListener("click", () => {
    const stories = loadStories();
    const s = { id: `st-${Date.now()}`, title: "", tag: TAGS[0].id, situation: "", task: "", action: "", result: "", createdAt: Date.now(), updatedAt: Date.now() };
    stories.unshift(s);
    saveStories(stories);
    editingId = s.id;
    paint(root);
  });
  panel.querySelectorAll("[data-story-id]").forEach(card => {
    const id = card.dataset.storyId;
    card.querySelector("[data-act=edit]")?.addEventListener("click", () => { editingId = id; paint(root); });
    card.querySelector("[data-act=delete]")?.addEventListener("click", () => {
      if (!confirm("Delete this story? This cannot be undone.")) return;
      const stories = loadStories().filter(s => s.id !== id);
      saveStories(stories);
      if (editingId === id) editingId = null;
      paint(root);
    });
    card.querySelector("[data-act=polish]")?.addEventListener("click", async () => {
      const stories = loadStories();
      const s = stories.find(x => x.id === id);
      if (!s) return;
      await polishStory(s, root);
    });
  });

  // Story editor
  const editor = panel.querySelector(".behav-editor");
  if (editor) {
    const id = editor.dataset.storyId;
    const read = () => ({
      title: panel.querySelector("#behav-title").value,
      tag: panel.querySelector("#behav-tag").value,
      situation: panel.querySelector("[data-field=situation]").value,
      task: panel.querySelector("[data-field=task]").value,
      action: panel.querySelector("[data-field=action]").value,
      result: panel.querySelector("[data-field=result]").value,
    });
    panel.querySelector("#behav-save")?.addEventListener("click", () => {
      const stories = loadStories();
      const idx = stories.findIndex(s => s.id === id);
      if (idx < 0) return;
      stories[idx] = { ...stories[idx], ...read(), updatedAt: Date.now() };
      saveStories(stories);
      editingId = null;
      paint(root);
    });
    panel.querySelector("#behav-cancel")?.addEventListener("click", () => { editingId = null; paint(root); });
    panel.querySelector("#behav-polish-full")?.addEventListener("click", async () => {
      const stories = loadStories();
      const idx = stories.findIndex(s => s.id === id);
      if (idx < 0) return;
      stories[idx] = { ...stories[idx], ...read() };
      saveStories(stories);
      await polishStory(stories[idx], root);
    });
  }

  // Prompts tab
  panel.querySelector("#behav-new-prompt")?.addEventListener("click", () => {
    openPromptEditor(root, null);
  });
  panel.querySelectorAll("[data-prompt-id]").forEach(card => {
    const id = card.dataset.promptId;
    card.querySelector("[data-act=prompt-edit]")?.addEventListener("click", () => {
      const prompts = loadPrompts();
      const p = prompts.find(x => x.id === id);
      if (!p) return;
      openPromptEditor(root, p);
    });
    card.querySelector("[data-act=prompt-delete]")?.addEventListener("click", () => {
      if (!window.confirm("Delete this prompt?")) return;
      savePrompts(loadPrompts().filter(p => p.id !== id));
      paint(root);
    });
  });
}

// Dedicated inline editor overlay for BQ prompts. Tauri's WKWebView disables
// window.prompt() so we ship our own tiny portal with proper inputs.
function openPromptEditor(root, existing) {
  document.querySelectorAll(".behav-pe-scrim").forEach(s => s.remove());
  const scrim = document.createElement("div");
  scrim.className = "behav-pe-scrim";
  scrim.innerHTML = `
    <div class="behav-pe">
      <header><h3>${existing ? "Edit prompt" : "Add a BQ prompt"}</h3></header>
      <div class="behav-pe-body">
        <label class="behav-pe-label">Question</label>
        <textarea id="behav-pe-title" rows="3" placeholder="Tell me about a time you dealt with ambiguity.">${esc(existing?.title || "")}</textarea>
        <label class="behav-pe-label">Tag</label>
        <select id="behav-pe-tag">
          ${TAGS.map(t => `<option value="${esc(t.id)}" ${(existing?.tag || TAGS[0].id) === t.id ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
        </select>
      </div>
      <footer>
        <button class="behav-btn-ghost" id="behav-pe-cancel">Cancel</button>
        <button class="behav-btn-primary" id="behav-pe-save">Save</button>
      </footer>
    </div>
  `;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.querySelector("#behav-pe-cancel")?.addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  const escH = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", escH); } };
  document.addEventListener("keydown", escH);
  // Focus the textarea
  setTimeout(() => scrim.querySelector("#behav-pe-title")?.focus(), 0);
  scrim.querySelector("#behav-pe-save")?.addEventListener("click", () => {
    const title = scrim.querySelector("#behav-pe-title").value.trim();
    const tag = scrim.querySelector("#behav-pe-tag").value;
    if (!title) { scrim.querySelector("#behav-pe-title").focus(); return; }
    const prompts = loadPrompts();
    if (existing) {
      const idx = prompts.findIndex(p => p.id === existing.id);
      if (idx >= 0) { prompts[idx] = { ...prompts[idx], title, tag }; }
    } else {
      prompts.push({ id: `p-${Date.now()}`, title, tag });
    }
    savePrompts(prompts);
    close();
    paint(root);
  });
}

async function polishStory(story, root) {
  try {
    const apiKey = (await secure.get("groq_api_key").catch(() => null)) ||
                   (await secure.get("grok_api_key").catch(() => null));
    if (!apiKey) { alert("No Groq API key — add one in Settings → AI butler."); return; }
    const system = `You are a senior FDE interviewer coach. Lightly polish the student's STAR story so it reads TIGHT and INTERVIEW-READY. Preserve their voice and content — do NOT fabricate specifics. Return VALID JSON matching this shape:
{
  "title": "a short memorable title (3-6 words)",
  "situation": "polished S — 2-3 sentences, set the scene",
  "task": "polished T — ONE sentence naming YOUR specific responsibility",
  "action": "polished A — 3-4 sentences, first-person, verb-forward, specific moves YOU made",
  "result": "polished R — 1-2 sentences, measurable where original data allows, end with one lesson"
}
RULES:
- Keep the student's facts. Rephrase for crispness.
- Avoid filler ("I think", "basically"). Prefer verbs over nouns.
- If a field was blank, return it blank.
- Do NOT include markdown or code fences.`;
    const user = `TITLE: ${story.title || ""}
TAG: ${story.tag}
S: ${story.situation || ""}
T: ${story.task || ""}
A: ${story.action || ""}
R: ${story.result || ""}`;
    const res = await callGroqJSON({ apiKey, system, user, maxTokens: 1024, label: "behavioral-polish" });
    if (!res.ok) { alert("Polish failed: " + res.error); return; }
    const d = res.data;
    const stories = loadStories();
    const idx = stories.findIndex(x => x.id === story.id);
    if (idx < 0) return;
    stories[idx] = { ...stories[idx],
      title: String(d.title || stories[idx].title || "").trim(),
      situation: String(d.situation || stories[idx].situation || "").trim(),
      task: String(d.task || stories[idx].task || "").trim(),
      action: String(d.action || stories[idx].action || "").trim(),
      result: String(d.result || stories[idx].result || "").trim(),
      polishedAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveStories(stories);
    paint(root);
  } catch (e) {
    alert("Polish error: " + (e.message || e));
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
}

function injectStyles() {
  if (document.getElementById("behavioral-styles")) return;
  const s = document.createElement("style");
  s.id = "behavioral-styles";
  s.textContent = `
    .behav { padding: 20px 16px 60px; max-width: 1120px; }
    .behav-head { max-width: 920px; margin: 28px auto 26px; }
    .behav-eyebrow { font: 700 11.5px/1 var(--font-sans); letter-spacing: .22em; text-transform: uppercase; color: var(--gold); margin-bottom: 12px; display: inline-block; }
    .behav-title { margin: 0 0 10px; font: 600 46px/1.02 var(--font-sans); letter-spacing: -.03em; color: var(--ink); }
    .behav-sub { font: 400 15px/1.55 var(--font-sans); color: var(--mut); margin: 0; }

    .behav-tabs {
      display: inline-flex; gap: 2px; max-width: 1120px; margin: 10px auto 24px;
      padding: 5px; border-radius: 14px;
      background: color-mix(in oklab, var(--mut) 8%, var(--paper));
      border: 1px solid var(--line);
    }
    .behav-tab {
      display: inline-flex; align-items: center; gap: 9px;
      padding: 9px 16px; border-radius: 10px; border: none; background: transparent;
      font: 600 13px/1 var(--font-sans); color: var(--mut); cursor: pointer;
      transition: all .2s ease;
    }
    .behav-tab:hover { color: var(--ink); }
    .behav-tab.active { background: var(--paper); color: var(--ink); box-shadow: 0 2px 4px rgba(0,0,0,.06), 0 0 0 1px var(--line); }
    .behav-tab-count {
      font: 700 10.5px/1 var(--font-sans); color: var(--mut);
      background: color-mix(in oklab, var(--mut) 14%, transparent);
      padding: 3px 7px; border-radius: 999px; min-width: 20px; text-align: center;
    }
    .behav-tab.active .behav-tab-count { background: var(--gold); color: var(--paper); }

    .behav-panel { max-width: 1120px; margin: 0 auto; }

    .behav-sec-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 18px; }
    .behav-sec-head h2 { margin: 0; font: 600 22px/1.2 var(--font-sans); letter-spacing: -.018em; color: var(--ink); }

    .behav-btn-primary {
      padding: 9px 16px; border-radius: 10px;
      background: var(--ink); color: var(--paper); border: none;
      font: 600 12.5px/1 var(--font-sans); cursor: pointer; letter-spacing: -.005em;
      transition: filter .14s ease;
    }
    .behav-btn-primary:hover { filter: brightness(1.1); }
    .behav-btn-ghost {
      padding: 9px 16px; border-radius: 10px;
      background: var(--paper); color: var(--mut); border: 1px solid var(--line);
      font: 600 12.5px/1 var(--font-sans); cursor: pointer;
    }
    .behav-btn-ghost:hover { color: var(--ink); border-color: var(--line2); }
    .behav-btn-icon {
      width: 28px; height: 28px; border-radius: 7px;
      background: transparent; border: 1px solid var(--line); color: var(--mut);
      cursor: pointer; font: 400 13px/1 var(--font-sans);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .behav-btn-icon:hover { color: var(--ink); border-color: var(--line2); }
    .behav-btn-icon.behav-btn-danger:hover { color: var(--red); border-color: var(--red); }

    .behav-stories-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;
    }
    .behav-card {
      padding: 14px 16px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 14px;
      transition: box-shadow .18s ease, transform .18s ease;
      box-shadow: 0 1px 2px rgba(0,0,0,.03);
    }
    .behav-card:hover { box-shadow: 0 10px 22px -8px rgba(0,0,0,.1); transform: translateY(-1px); }
    .behav-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 8px; }
    .behav-tag {
      display: inline-flex; align-items: center;
      padding: 3px 9px; border-radius: 999px;
      font: 700 10.5px/1 var(--font-sans); letter-spacing: .06em; text-transform: uppercase;
      background: color-mix(in oklab, var(--tag-color) 14%, var(--paper));
      color: var(--tag-color);
      border: 1px solid color-mix(in oklab, var(--tag-color) 30%, var(--line));
    }
    .behav-card-actions { display: flex; gap: 4px; }
    .behav-card-title { margin: 0 0 6px; font: 600 15.5px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -.012em; }
    .behav-card-teaser { font: 500 12.5px/1.55 var(--font-sans); color: var(--mut); margin: 0; min-height: 36px; }
    .behav-card-foot {
      display: flex; justify-content: space-between; align-items: center;
      margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line);
      font: 500 10.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .04em;
    }

    .behav-editor {
      padding: 20px 22px; margin-bottom: 20px;
      background: color-mix(in oklab, var(--gold) 4%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--gold) 24%, var(--line));
      border-radius: 16px;
    }
    .behav-editor-head { margin-bottom: 16px; }
    .behav-editor-row { display: flex; gap: 10px; align-items: center; }
    .behav-input {
      padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line);
      background: var(--paper); color: var(--ink);
      font: 500 13px/1.5 var(--font-sans);
    }
    .behav-input:focus { outline: 2px solid var(--gold); outline-offset: -2px; }
    #behav-title { flex: 1; }
    #behav-tag { width: 180px; }

    .behav-editor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
    @media (max-width: 720px) { .behav-editor-grid { grid-template-columns: 1fr; } }
    .behav-field { display: flex; flex-direction: column; gap: 6px; }
    .behav-field label { font: 700 10.5px/1 var(--font-sans); letter-spacing: .12em; text-transform: uppercase; color: var(--gold); }
    .behav-textarea { min-height: 90px; resize: vertical; font-family: var(--font-sans); }
    .behav-hint { font: 500 11px/1.45 var(--font-sans); color: var(--mut); margin-top: 2px; }

    .behav-editor-actions { display: flex; gap: 10px; align-items: center; }
    .behav-editor-spacer { flex: 1; }

    .behav-empty {
      padding: 48px 24px; text-align: center;
      background: color-mix(in oklab, var(--mut) 6%, var(--paper));
      border: 1px dashed var(--line2); border-radius: 14px;
    }
    .behav-empty h3 { margin: 0 0 8px; font: 600 18px/1.3 var(--font-sans); color: var(--ink); }
    .behav-empty p { margin: 0; color: var(--mut); font: 500 13.5px/1.55 var(--font-sans); }

    .behav-prompts-list { display: flex; flex-direction: column; gap: 10px; }
    .behav-prompt {
      display: flex; align-items: flex-start; gap: 14px;
      padding: 14px 16px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px;
    }
    .behav-prompt-main { flex: 1; min-width: 0; }
    .behav-prompt-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
    .behav-prompt-head h3 { margin: 0; font: 600 14px/1.4 var(--font-sans); color: var(--ink); letter-spacing: -.008em; }
    .behav-prompt-match { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font: 500 12px/1.3 var(--font-sans); color: var(--mut); }
    .behav-prompt-match-label { font-weight: 700; letter-spacing: .04em; }
    .behav-prompt-match-chip {
      padding: 3px 10px; border-radius: 999px;
      background: color-mix(in oklab, var(--green) 10%, var(--paper));
      border: 1px solid color-mix(in oklab, var(--green) 26%, var(--line));
      color: var(--ink); font: 600 11.5px/1 var(--font-sans);
    }
    .behav-prompt-nomatch { font: 500 12.5px/1.3 var(--font-sans); color: var(--red); }
    .behav-prompt-actions { display: flex; gap: 4px; flex-shrink: 0; }

    /* Night-before */
    .behav-nb { display: flex; flex-direction: column; gap: 28px; }
    .behav-nb-h { margin: 0 0 14px; font: 600 20px/1.2 var(--font-sans); letter-spacing: -.016em; color: var(--ink); }
    .behav-nb-stories { display: flex; flex-direction: column; gap: 12px; }
    .behav-nb-story {
      padding: 16px 18px;
      background: var(--paper); border: 1px solid var(--line); border-radius: 14px;
    }
    .behav-nb-story header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .behav-nb-num {
      font: 800 11px/1 var(--font-sans); letter-spacing: .14em;
      color: var(--gold);
      padding: 5px 9px; border-radius: 6px;
      background: color-mix(in oklab, var(--gold) 14%, var(--paper));
      flex-shrink: 0;
    }
    .behav-nb-story h3 { margin: 0; flex: 1; font: 600 15.5px/1.3 var(--font-sans); color: var(--ink); }
    .behav-nb-blocks { display: flex; flex-direction: column; gap: 6px; }
    .behav-nb-block {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 8px 10px;
      background: color-mix(in oklab, var(--mut) 5%, var(--paper));
      border-radius: 8px;
      font: 500 13px/1.55 var(--font-sans); color: var(--ink);
    }
    .behav-nb-block span {
      font: 800 10.5px/1 var(--font-sans); letter-spacing: .18em;
      color: var(--gold); min-width: 16px; padding-top: 2px;
    }
    .behav-nb-block p { margin: 0; }

    .behav-nb-prompts { display: flex; flex-direction: column; gap: 14px; }
    .behav-nb-ptag { padding: 12px 14px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; }
    .behav-nb-ptag ul { margin: 10px 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
    .behav-nb-ptag li { font: 500 13px/1.5 var(--font-sans); color: var(--ink); }

    /* Prompt editor overlay */
    .behav-pe-scrim {
      position: fixed; inset: 0; z-index: 1750;
      display: flex; align-items: center; justify-content: center; padding: 24px;
      background: transparent;
    }
    .behav-pe {
      background: var(--paper); border-radius: 16px; width: 100%; max-width: 480px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow:
        0 28px 70px rgba(0,0,0,.22),
        0 8px 20px rgba(0,0,0,.08),
        0 0 0 1px var(--line);
      animation: bpePop .22s cubic-bezier(.2,1.2,.3,1) both;
    }
    @keyframes bpePop { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .behav-pe header { padding: 18px 22px 10px; border-bottom: 1px solid var(--line); }
    .behav-pe header h3 { margin: 0; font: 600 17px/1.3 var(--font-sans); color: var(--ink); letter-spacing: -.012em; }
    .behav-pe-body { padding: 18px 22px; display: flex; flex-direction: column; gap: 10px; }
    .behav-pe-label { font: 700 10.5px/1 var(--font-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--mut); margin-top: 4px; }
    .behav-pe textarea, .behav-pe select {
      width: 100%; padding: 10px 12px; border-radius: 10px;
      border: 1px solid var(--line); background: var(--paper); color: var(--ink);
      font: 500 13px/1.55 var(--font-sans); letter-spacing: -.005em;
      resize: vertical; min-height: 36px;
    }
    .behav-pe textarea:focus, .behav-pe select:focus { outline: 2px solid var(--gold); outline-offset: -2px; }
    .behav-pe footer { padding: 14px 22px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; gap: 8px; }
  `;
  document.head.appendChild(s);
}
