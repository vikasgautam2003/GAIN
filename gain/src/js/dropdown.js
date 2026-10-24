// Custom dropdown — replaces every native <select> in the app with a branded
// trigger button + styled option panel. Works as progressive enhancement:
// the real <select> stays in the DOM (invisible), so form behavior / change
// events / existing handlers continue to work exactly as before.

const ENHANCED = Symbol("gain.enhanced");

export function enhanceAll(root = document) {
  const list = root.querySelectorAll('select:not([data-no-enhance])');
  list.forEach(enhance);
  // Observe future mutations so dynamically rendered selects get enhanced too.
  // (Set up once per document.)
  if (!document._gainDropdownObserver) {
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === "SELECT" && !n.hasAttribute("data-no-enhance")) enhance(n);
          n.querySelectorAll && n.querySelectorAll('select:not([data-no-enhance])').forEach(enhance);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    document._gainDropdownObserver = obs;
  }
}

export function enhance(select) {
  if (select[ENHANCED]) return;
  select[ENHANCED] = true;

  // Hide the native select — keep it in the DOM for form value / change events.
  select.classList.add("gain-dd-native");
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;

  // Wrapper
  const wrap = document.createElement("div");
  wrap.className = "gain-dd";
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);

  // Trigger button
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "gain-dd-trigger";
  trigger.innerHTML = `<span class="gain-dd-value"></span><span class="gain-dd-caret">▾</span>`;
  wrap.appendChild(trigger);

  // Panel
  const panel = document.createElement("div");
  panel.className = "gain-dd-panel";
  panel.hidden = true;
  // Panel is appended to body so it escapes any overflow:hidden parent.
  document.body.appendChild(panel);

  const sync = () => {
    const opt = select.options[select.selectedIndex];
    trigger.querySelector(".gain-dd-value").textContent =
      opt?.textContent || select.querySelector("option")?.textContent || "";
    trigger.classList.toggle("gain-dd-placeholder", select.value === "" && !opt?.textContent);
  };

  const rebuild = () => {
    panel.innerHTML = Array.from(select.options).map((o, i) => `
      <button type="button" class="gain-dd-option ${i === select.selectedIndex ? "selected" : ""}"
              data-i="${i}" ${o.disabled ? "disabled" : ""}>
        ${o.textContent.replace(/</g, "&lt;")}
      </button>
    `).join("");
    panel.querySelectorAll(".gain-dd-option").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const i = Number(btn.dataset.i);
        select.selectedIndex = i;
        sync();
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        close();
      });
      btn.addEventListener("mouseenter", () => {
        panel.querySelectorAll(".gain-dd-option").forEach(x => x.classList.remove("hover"));
        btn.classList.add("hover");
      });
    });
  };

  let open = false;
  const position = () => {
    const r = trigger.getBoundingClientRect();
    panel.style.minWidth = `${r.width}px`;
    // Prefer below; flip above if not enough room
    const belowRoom = window.innerHeight - r.bottom;
    const panelH = Math.min(320, select.options.length * 36 + 12);
    panel.style.left = `${r.left}px`;
    if (belowRoom < panelH + 12 && r.top > panelH + 12) {
      panel.style.top = `${r.top - panelH - 6 + window.scrollY}px`;
      panel.classList.add("flip-up");
    } else {
      panel.style.top = `${r.bottom + 6 + window.scrollY}px`;
      panel.classList.remove("flip-up");
    }
  };

  const openPanel = () => {
    if (select.disabled) return;
    rebuild();
    position();
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add("show"));
    trigger.classList.add("open");
    open = true;
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
  };
  const reposition = () => { if (open) position(); };
  const close = () => {
    if (!open) return;
    open = false;
    panel.classList.remove("show");
    trigger.classList.remove("open");
    setTimeout(() => { if (!open) panel.hidden = true; }, 180);
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
  };

  function onDocDown(e) {
    if (panel.contains(e.target) || trigger.contains(e.target)) return;
    close();
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); trigger.focus(); return; }
    if (e.key === "Enter" || e.key === " ") {
      const hovered = panel.querySelector(".gain-dd-option.hover");
      if (hovered) { e.preventDefault(); hovered.click(); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const opts = Array.from(panel.querySelectorAll(".gain-dd-option:not([disabled])"));
      if (!opts.length) return;
      let i = opts.findIndex(o => o.classList.contains("hover"));
      if (i < 0) i = select.selectedIndex;
      i = (i + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
      opts.forEach(o => o.classList.remove("hover"));
      opts[i].classList.add("hover");
      opts[i].scrollIntoView({ block: "nearest" });
    }
  }

  trigger.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    open ? close() : openPanel();
  });
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); openPanel(); }
  });

  // keep in sync if the <select> is updated programmatically
  const mo = new MutationObserver(sync);
  mo.observe(select, { childList: true, attributes: true, attributeFilter: ["value"] });
  select.addEventListener("change", sync);

  sync();
}
