// Shared Adjust-wallet modal. Called from Settings → Wallet section AND from
// the topbar coin indicator. Writes a transparent ledger entry so the change is auditable.

import { getWallet, updateWallet } from "./store.js";
import { openFormModal, confirmDanger } from "./modals.js";

export function openWalletAdjustModal() {
  const w = getWallet();
  const bodyHtml = `
    <style>
      .wa-form { display: flex; flex-direction: column; gap: 16px; }
      .wa-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .wa-grid .wa-stat { padding: 12px 14px; background: var(--bg); border: 1px solid var(--line); border-radius: 12px; }
      .wa-grid .wa-stat b { font: 600 18px/1 var(--font-sans); color: var(--ink); display: block; font-feature-settings: "tnum"; }
      .wa-grid .wa-stat b.gold { color: var(--gold); }
      .wa-grid .wa-stat span { font-size: 10px; letter-spacing: .14em; color: var(--mut); text-transform: uppercase; display: block; margin-bottom: 4px; }
      .wa-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .wa-mode button {
        padding: 11px 14px; border-radius: 12px; cursor: pointer;
        background: var(--bg); border: 1px solid var(--line); color: var(--ink);
        font: 600 12px/1 var(--font-sans); letter-spacing: .04em;
        transition: all .18s;
      }
      .wa-mode button.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
      .wa-amount { font: 600 32px/1 var(--font-sans); letter-spacing: -.02em; color: var(--ink); text-align: center; padding: 18px 12px; font-feature-settings: "tnum"; }
      .wa-amount[data-sign="-"]::before { content: "−"; color: var(--red); margin-right: 6px; }
      .wa-amount[data-sign="+"]::before { content: "+"; color: var(--green); margin-right: 6px; }
      .wa-amount::after { content: " ₹"; color: var(--mut); font-size: 20px; margin-left: 4px; }
      .wa-pills { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
      .wa-pills button {
        padding: 6px 12px; border-radius: 999px; cursor: pointer;
        background: var(--bg); border: 1px solid var(--line); color: var(--mut);
        font: 500 12px/1 var(--font-sans);
        transition: all .18s;
      }
      .wa-pills button:hover { color: var(--ink); border-color: var(--line2); }
      .wa-pills button.zero { color: var(--red); border-color: var(--red); }
      .wa-preview { padding: 12px 14px; background: var(--gold-soft); border: 1px solid var(--gold); border-radius: 12px; font-size: 13px; color: var(--ink); line-height: 1.5; }
      .wa-preview b { color: var(--gold); font-feature-settings: "tnum"; }
      .wa-form label { display: block; font: 500 10.5px/1 var(--font-sans); color: var(--mut); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 8px; }
      .wa-form input {
        width: 100%; padding: 10px 12px; border-radius: 10px;
        background: var(--paper); border: 1px solid var(--line); color: var(--ink);
        font: 14px/1.4 var(--font-sans); outline: none;
        transition: border-color .18s, box-shadow .18s;
      }
      .wa-form input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px var(--gold-soft); }
    </style>
    <div class="wa-form">
      <div class="wa-grid">
        <div class="wa-stat"><span>Earned</span><b>₹${(w.earned||0).toLocaleString()}</b></div>
        <div class="wa-stat"><span>Spent</span><b>₹${(w.spent||0).toLocaleString()}</b></div>
        <div class="wa-stat" style="grid-column: 1 / -1"><span>Available</span><b class="gold">₹${(w.available||0).toLocaleString()}</b></div>
      </div>
      <div class="wa-mode" role="radiogroup">
        <button type="button" data-wa-mode="-" class="active">− Subtract</button>
        <button type="button" data-wa-mode="+">+ Add</button>
      </div>
      <div>
        <label>Amount</label>
        <input type="number" id="wa-input" min="0" step="1" value="100" placeholder="0" />
      </div>
      <div class="wa-amount" data-sign="-" id="wa-display">100</div>
      <div class="wa-pills" id="wa-pills">
        <button type="button" data-wa-amt="100">100</button>
        <button type="button" data-wa-amt="500">500</button>
        <button type="button" data-wa-amt="1000">1,000</button>
        <button type="button" data-wa-amt="5000">5,000</button>
        <button type="button" class="zero" data-wa-zero="1">Set to zero</button>
      </div>
      <div>
        <label>Reason (goes to the ledger)</label>
        <input type="text" id="wa-reason" placeholder="e.g. False week-bonus trigger · Settled Oct 19" />
      </div>
      <div class="wa-preview" id="wa-preview">
        New earned: <b>₹${(w.earned||0).toLocaleString()}</b> · New available: <b>₹${(w.available||0).toLocaleString()}</b>
      </div>
    </div>
  `;

  openFormModal({
    title: "Adjust wallet",
    subtitle: "Writes a transparent line to the ledger. Spent balance never goes negative.",
    bodyHtml,
    saveLabel: "Apply adjustment",
    width: 480,
    onSave: async (modalRoot, close) => {
      const mode = modalRoot.querySelector("[data-wa-mode].active").dataset.waMode;
      const amtRaw = Number(modalRoot.querySelector("#wa-input").value) || 0;
      const reason = (modalRoot.querySelector("#wa-reason").value || "").trim();
      if (amtRaw <= 0) { alert("Amount must be greater than zero."); return; }
      if (!reason) { alert("Please add a short reason — it goes on the ledger."); return; }

      const delta = mode === "+" ? amtRaw : -amtRaw;
      const confirmLabel = mode === "+" ? `Add ₹${amtRaw.toLocaleString()}` : `Subtract ₹${amtRaw.toLocaleString()}`;
      if (delta < 0) {
        const ok = await confirmDanger({
          title: `Subtract ₹${amtRaw.toLocaleString()} from your wallet?`,
          message: `This writes a negative ledger entry labeled "${reason}".`,
          confirmLabel,
          consequences: [
            `Earned drops by ₹${amtRaw.toLocaleString()}`,
            `Available drops (never below 0)`,
            `The ledger keeps the entry forever — this is auditable, not a wipe`
          ]
        });
        if (!ok) return;
      }

      await updateWallet(w2 => {
        const floor = w2.spent || 0;
        w2.earned = Math.max(floor, (w2.earned || 0) + delta);
        w2.ledger = w2.ledger || [];
        w2.ledger.push({
          date: new Date().toISOString(),
          type: "adjust",
          amount: delta,
          label: reason
        });
      });
      close();
    }
  });

  // Wire mode toggle + pills + input preview AFTER modal mounts
  setTimeout(() => {
    const modal = document.querySelector(".form-modal");
    if (!modal) return;
    const input = modal.querySelector("#wa-input");
    const display = modal.querySelector("#wa-display");
    const preview = modal.querySelector("#wa-preview");
    const getMode = () => modal.querySelector("[data-wa-mode].active")?.dataset.waMode || "-";
    const refresh = () => {
      const mode = getMode();
      const amt = Math.max(0, Number(input.value) || 0);
      display.dataset.sign = mode;
      display.textContent = amt.toLocaleString();
      const delta = mode === "+" ? amt : -amt;
      const curW = getWallet();
      const floor = curW.spent || 0;
      const newEarned = Math.max(floor, (curW.earned || 0) + delta);
      const newAvail  = Math.max(0, newEarned - (curW.spent || 0));
      preview.innerHTML = `New earned: <b>₹${newEarned.toLocaleString()}</b> · New available: <b>₹${newAvail.toLocaleString()}</b>`;
    };
    input.addEventListener("input", refresh);
    modal.querySelectorAll("[data-wa-mode]").forEach(b => b.addEventListener("click", () => {
      modal.querySelectorAll("[data-wa-mode]").forEach(x => x.classList.toggle("active", x === b));
      refresh();
    }));
    modal.querySelectorAll("[data-wa-amt]").forEach(b => b.addEventListener("click", () => {
      input.value = b.dataset.waAmt;
      refresh();
    }));
    modal.querySelector("[data-wa-zero]")?.addEventListener("click", () => {
      const curW = getWallet();
      modal.querySelectorAll("[data-wa-mode]").forEach(x => x.classList.toggle("active", x.dataset.waMode === "-"));
      input.value = String(curW.earned || 0);
      refresh();
    });
    refresh();
  }, 60);
}
