// Shared modal primitives. One source of truth for destructive-confirm UX and
// generic form modals so every delete/overwrite across the app looks the same.

let activeScrim = null;

function closeActive() {
  if (!activeScrim) return;
  const el = activeScrim;
  activeScrim = null;
  el.classList.remove("show");
  setTimeout(() => el.remove(), 220);
  document.removeEventListener("keydown", onEsc, true);
}

function onEsc(e) {
  if (e.key === "Escape") { e.preventDefault(); closeActive(); }
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); }

// ---- Destructive confirm modal — big red warning, consistent across the app.
// opts: { title, message, confirmLabel?, cancelLabel?, consequences? (string[]) }
// Returns Promise<boolean> — true if user confirmed, false if cancelled/dismissed.
export function confirmDanger(opts = {}) {
  const {
    title = "Are you sure?",
    message = "This action can't be undone.",
    confirmLabel = "Delete",
    cancelLabel = "Cancel",
    consequences = []
  } = opts;

  return new Promise(resolve => {
    closeActive();
    const scrim = document.createElement("div");
    scrim.className = "modal-scrim danger-scrim";
    scrim.innerHTML = `
      <div class="modal danger-modal" role="alertdialog" aria-modal="true" aria-labelledby="dmt">
        <div class="danger-head">
          <div class="danger-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 9v4"/><path d="M12 17h.01"/>
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            </svg>
          </div>
          <h2 id="dmt" class="danger-title">${esc(title)}</h2>
        </div>
        <div class="danger-body">
          <p class="danger-msg">${esc(message)}</p>
          ${consequences.length ? `
            <ul class="danger-cons">
              ${consequences.map(c => `<li>${esc(c)}</li>`).join("")}
            </ul>
          ` : ""}
        </div>
        <div class="danger-actions">
          <button class="danger-cancel" type="button">${esc(cancelLabel)}</button>
          <button class="danger-confirm" type="button">${esc(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(scrim);
    activeScrim = scrim;
    requestAnimationFrame(() => scrim.classList.add("show"));
    document.addEventListener("keydown", onEsc, true);

    const done = (ok) => {
      if (activeScrim !== scrim) return;
      resolve(ok);
      closeActive();
    };

    scrim.querySelector(".danger-cancel").addEventListener("click", () => done(false));
    scrim.querySelector(".danger-confirm").addEventListener("click", () => done(true));
    scrim.addEventListener("click", (e) => { if (e.target === scrim) done(false); });
    // Focus the cancel button by default — safer than auto-focusing the destructive one
    setTimeout(() => scrim.querySelector(".danger-cancel")?.focus(), 50);
  });
}

// ---- Generic form modal.
// opts: { title, subtitle?, bodyHtml, saveLabel?, extraButtons?: [{label, variant, onClick(close)}], onSave(root, close) }
// Returns the modal root so caller can also close/manipulate externally.
export function openFormModal(opts = {}) {
  const {
    title = "Edit",
    subtitle = "",
    bodyHtml = "",
    saveLabel = "Save",
    cancelLabel = "Cancel",
    extraButtons = [],
    width = 520,
    onSave
  } = opts;

  closeActive();
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim form-scrim";
  scrim.innerHTML = `
    <div class="modal form-modal" role="dialog" aria-modal="true" aria-labelledby="fmt" style="width: min(${width}px, 94vw);">
      <header class="form-head">
        <div>
          <h2 id="fmt" class="form-title">${esc(title)}</h2>
          ${subtitle ? `<p class="form-sub">${esc(subtitle)}</p>` : ""}
        </div>
        <button class="form-close" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </header>
      <div class="form-body">${bodyHtml}</div>
      <footer class="form-actions">
        <div class="form-actions-left">
          ${extraButtons.map((b, i) => `<button type="button" class="form-btn form-btn-${esc(b.variant || "ghost")}" data-xbtn="${i}">${esc(b.label)}</button>`).join("")}
        </div>
        <div class="form-actions-right">
          <button type="button" class="form-btn form-btn-ghost" data-close="1">${esc(cancelLabel)}</button>
          <button type="button" class="form-btn form-btn-primary" data-save="1">${esc(saveLabel)}</button>
        </div>
      </footer>
    </div>
  `;
  document.body.appendChild(scrim);
  activeScrim = scrim;
  requestAnimationFrame(() => scrim.classList.add("show"));
  document.addEventListener("keydown", onEsc, true);

  const root = scrim.querySelector(".form-modal");
  const close = () => closeActive();

  scrim.querySelector(".form-close").addEventListener("click", close);
  scrim.querySelector("[data-close]").addEventListener("click", close);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.querySelector("[data-save]").addEventListener("click", async () => {
    try { await onSave?.(root, close); } catch (err) { console.error("[modal] save failed", err); }
  });
  extraButtons.forEach((b, i) => {
    scrim.querySelector(`[data-xbtn="${i}"]`)?.addEventListener("click", () => b.onClick?.(close, root));
  });

  // Focus the first text input
  setTimeout(() => root.querySelector("input, select, textarea")?.focus(), 50);

  return { root, close };
}

// Inject the shared stylesheet on first import. Idempotent.
(function injectStyles() {
  if (document.getElementById("gain-modal-styles")) return;
  const s = document.createElement("style");
  s.id = "gain-modal-styles";
  s.textContent = `
    .modal-scrim {
      position: fixed; inset: 0; z-index: 240;
      display: flex; align-items: center; justify-content: center;
      background: rgba(20, 24, 29, .42);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      opacity: 0; transition: opacity .2s ease;
    }
    .modal-scrim.show { opacity: 1; }
    .modal {
      background: var(--paper); border-radius: 20px; overflow: hidden;
      box-shadow: 0 40px 100px rgba(20,24,29,.28);
      transform: scale(.94); transition: transform .25s cubic-bezier(.2,1.4,.3,1);
      max-height: 90vh; display: flex; flex-direction: column;
      font-family: var(--font-sans);
      color: var(--ink);
    }
    /* Children of .modal — enforce flex contract so body scrolls, header/footer stay put */
    .modal .danger-head, .modal .danger-actions,
    .modal .form-head, .modal .form-actions { flex-shrink: 0; }
    .modal .danger-body, .modal .form-body {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
    }
    .modal-scrim.show .modal { transform: scale(1); }

    /* === Destructive-confirm === */
    .danger-modal { width: min(440px, 94vw); }
    .danger-head {
      display: flex; gap: 14px; align-items: flex-start;
      padding: 28px 28px 0;
    }
    .danger-icon {
      flex-shrink: 0;
      width: 44px; height: 44px; border-radius: 12px;
      background: #fde7e9; color: var(--red);
      display: flex; align-items: center; justify-content: center;
    }
    .danger-title {
      margin: 6px 0 0; font: 600 20px/1.2 var(--font-sans); letter-spacing: -.018em;
      color: var(--ink);
    }
    .danger-body { padding: 16px 28px 0; }
    .danger-msg {
      margin: 0; font-size: 14.5px; line-height: 1.5; color: var(--mut);
      letter-spacing: -.003em;
    }
    .danger-cons {
      margin: 14px 0 0; padding-left: 18px;
      font-size: 13.5px; color: var(--mut); line-height: 1.55;
    }
    .danger-cons li { margin-bottom: 4px; }
    .danger-actions {
      display: flex; gap: 10px; justify-content: flex-end;
      padding: 24px 24px 24px;
    }
    .danger-cancel {
      background: transparent; border: 1px solid var(--line2); color: var(--ink);
      border-radius: 999px; padding: 11px 22px;
      font: 500 14px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: background .18s, border-color .18s;
    }
    .danger-cancel:hover { background: #fafbfc; border-color: var(--mut); }
    .danger-confirm {
      background: var(--red); color: #fff; border: none;
      border-radius: 999px; padding: 11px 26px;
      font: 600 14px/1 var(--font-sans); letter-spacing: -.005em; cursor: pointer;
      transition: background .18s, transform .18s;
    }
    .danger-confirm:hover { background: #c73840; transform: translateY(-1px); }
    .danger-confirm:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }

    /* === Generic form modal === */
    .form-head {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
      padding: 24px 28px 16px;
      border-bottom: 1px solid var(--line);
    }
    .form-title { margin: 0; font: 600 20px/1.2 var(--font-sans); letter-spacing: -.018em; color: var(--ink); }
    .form-sub { margin: 4px 0 0; font-size: 13px; color: var(--mut); }
    .form-close {
      flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%;
      background: transparent; border: none; color: var(--mut); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: color .18s, background .18s;
    }
    .form-close:hover { color: var(--ink); background: #fafbfc; }
    .form-body {
      padding: 24px 28px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 16px;
    }
    .form-body label { display: block; font: 500 11px/1 var(--font-sans); color: var(--mut); letter-spacing: .04em; text-transform: uppercase; margin-bottom: 6px; }
    .form-body .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-body input, .form-body select, .form-body textarea {
      width: 100%; margin: 0; padding: 11px 13px;
      background: #fafbfc; border: 1px solid var(--line); border-radius: 10px;
      font: 14px/1.4 var(--font-sans); color: var(--ink);
      outline: none; transition: border-color .18s, background .18s, box-shadow .18s;
    }
    .form-body input:focus, .form-body select:focus, .form-body textarea:focus {
      background: var(--paper); border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold-soft);
    }
    .form-body .field-hint { font-size: 11.5px; color: var(--mut); margin-top: 4px; letter-spacing: 0; }
    .form-body .file-input { padding: 8px 12px; background: var(--paper); cursor: pointer; }
    .form-actions {
      display: flex; justify-content: space-between; gap: 10px;
      padding: 16px 24px 20px;
      border-top: 1px solid var(--line);
    }
    .form-actions-left, .form-actions-right { display: flex; gap: 8px; align-items: center; }
    .form-btn {
      border-radius: 999px; padding: 10px 20px; cursor: pointer;
      font: 500 13.5px/1 var(--font-sans); letter-spacing: -.005em;
      transition: background .18s, border-color .18s, color .18s, transform .18s;
    }
    .form-btn-ghost {
      background: transparent; border: 1px solid transparent; color: var(--mut);
    }
    .form-btn-ghost:hover { color: var(--ink); background: #fafbfc; }
    .form-btn-primary {
      background: var(--ink); color: #fff; border: 1px solid var(--ink);
    }
    .form-btn-primary:hover { background: #000; transform: translateY(-1px); }
    .form-btn-danger {
      background: transparent; border: 1px solid transparent; color: var(--red);
    }
    .form-btn-danger:hover { background: #fde7e9; }
  `;
  document.head.appendChild(s);
})();
